import { useEffect, useId, useMemo, useSyncExternalStore } from 'react'
import qwenUrl from '@/assets/qwen35-merges.bin?url'
import t5Url from '@/assets/t5-vocab.bin?url'
import TokenWorker from './token.worker?worker&inline'
import type { Tokenizer } from './nai-models'
import type { TokenCounter } from './qwen-tokenizer'

const cache = new Map<string, number>()
const inflight = new Set<string>()
let version = 0
const failed = new Set<Tokenizer>()
const listeners = new Set<() => void>()
const notify = () => {
  version++
  listeners.forEach((l) => l())
}
const keyOf = (tok: Tokenizer, text: string) => `${tok}\0${text}`

let worker: Worker | null = null
let workerBroken = false
let seq = 0
const pending = new Map<number, { tok: Tokenizer; texts: string[] }>()
const mainCounter = new Map<Tokenizer, Promise<TokenCounter>>()

const url = (tok: Tokenizer) => new URL(tok === 't5' ? t5Url : qwenUrl, location.href).href

function store(tok: Tokenizer, texts: string[], counts: number[]) {
  texts.forEach((t, i) => {
    const k = keyOf(tok, t)
    inflight.delete(k)
    cache.set(k, counts[i])
  })
  for (const k of cache.keys()) {
    if (cache.size <= 4000) break
    cache.delete(k)
  }
  notify()
}

function giveUp(tok: Tokenizer, texts: string[]) {
  texts.forEach((t) => inflight.delete(keyOf(tok, t)))
  failed.add(tok)
  notify()
}

async function loadOnMain(tok: Tokenizer): Promise<TokenCounter> {
  const buf = await (await fetch(url(tok))).arrayBuffer()
  if (tok === 't5') {
    const m = await import('./t5-tokenizer')
    return m.createT5Counter(await m.loadT5Def(buf))
  }
  const m = await import('./qwen-tokenizer')
  return m.createQwenCounter(await m.loadQwenDef(buf))
}

async function countOnMain(tok: Tokenizer, texts: string[]) {
  try {
    let p = mainCounter.get(tok)
    if (!p) mainCounter.set(tok, (p = loadOnMain(tok)))
    const c = await p
    store(tok, texts, texts.map((t) => c.count(t)))
  } catch {
    giveUp(tok, texts)
  }
}

function getWorker(): Worker | null {
  if (workerBroken) return null
  if (!worker) {
    try {
      worker = new TokenWorker()
    } catch {
      workerBroken = true
      return null
    }
    worker.onmessage = (e: MessageEvent<{ id: number; counts?: number[]; error?: string }>) => {
      const job = pending.get(e.data.id)
      pending.delete(e.data.id)
      if (!job) return
      if (e.data.counts) store(job.tok, job.texts, e.data.counts)
      else giveUp(job.tok, job.texts)
    }
    worker.onerror = () => {
      workerBroken = true
      worker?.terminate()
      worker = null
      const rest = [...pending.values()]
      pending.clear()
      rest.forEach((j) => void countOnMain(j.tok, j.texts))
    }
  }
  return worker
}

export function requestCounts(texts: string[], tok: Tokenizer = 'qwen') {
  if (failed.has(tok)) return
  const todo = [...new Set(texts)].filter((t) => (t || tok === 't5') && !cache.has(keyOf(tok, t)) && !inflight.has(keyOf(tok, t)))
  if (!todo.length) return
  todo.forEach((t) => inflight.add(keyOf(tok, t)))
  const w = getWorker()
  if (!w) return void countOnMain(tok, todo)
  const id = ++seq
  pending.set(id, { tok, texts: todo })
  w.postMessage({ id, tok, url: url(tok), texts: todo })
}

/** Qwen empty text has 0 tokens; T5 still needs encoding because empty text contains </s>. */
export const tokenCount = (text: string, tok: Tokenizer = 'qwen'): number | undefined => (!text && tok === 'qwen' ? 0 : cache.get(keyOf(tok, text)))

const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => listeners.delete(l)
}

const stale = new Map<string, number>()

export function useTokenCounts(items: { key: string; text: string }[], tok: Tokenizer = 'qwen'): { counts: (number | undefined)[]; failed: boolean } {
  const scope = useId()
  const v = useSyncExternalStore(subscribe, () => version)
  const texts = useMemo(() => items.map((x) => x.text), [items])
  useEffect(() => {
    const t = setTimeout(() => requestCounts(texts, tok), 50)
    return () => clearTimeout(t)
  }, [texts, tok])
  const counts = useMemo(
    () =>
      items.map(({ key, text }) => {
        const k = `${scope}/${key}`
        const n = tokenCount(text, tok)
        if (n === undefined) return stale.get(k)
        stale.set(k, n)
        return n
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- v 变了（有新结果）才重新取
    [items, scope, tok, v],
  )
  return { counts, failed: failed.has(tok) }
}
