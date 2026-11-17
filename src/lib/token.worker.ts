import { createQwenCounter, loadQwenDef, type TokenCounter } from './qwen-tokenizer'
import { createT5Counter, loadT5Def } from './t5-tokenizer'
import type { Tokenizer } from './nai-models'

type Req = { id: number; tok: Tokenizer; url: string; texts: string[] }

const ready = new Map<Tokenizer, Promise<TokenCounter>>()

const load = (tok: Tokenizer, url: string) => {
  let p = ready.get(tok)
  if (!p) {
    p = fetch(url)
      .then((r) => {
        if (!r.ok) throw new Error(`词表下载失败：HTTP ${r.status}`)
        return r.arrayBuffer()
      })
      .then((buf): Promise<TokenCounter> => (tok === 't5' ? loadT5Def(buf).then(createT5Counter) : loadQwenDef(buf).then(createQwenCounter)))
    ready.set(tok, p)
  }
  return p
}

self.onmessage = async (e: MessageEvent<Req>) => {
  const { id, tok, url, texts } = e.data
  try {
    const counter = await load(tok, url)
    self.postMessage({ id, counts: texts.map((t) => counter.count(t)) })
  } catch (err) {
    ready.delete(tok)
    self.postMessage({ id, error: String(err) })
  }
}
