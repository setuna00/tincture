import { assetStore } from '@/store/storage'
import ThumbWorker from './thumb.worker?worker&inline'
import { makeThumb } from './thumb-core'

export const thumbKey = (id: string) => `thumb:${id}`

const urls = new Map<string, string>()
const shown = new Set<string>()
const inflight = new Map<string, Promise<string | null | 'skip'>>()
const wanted = new Map<string, number>()

export const thumbUrl = (id: string) => urls.get(id)
export const wasShown = (id: string) => shown.has(id)
export const markShown = (id: string) => void shown.add(id)

let worker: Worker | null = null
let broken = false
let seq = 0
const jobs = new Map<number, (r: { blob?: Blob; error?: string }) => void>()

function shrink(blob: Blob): Promise<Blob> {
  if (!broken && !worker) {
    try {
      worker = new ThumbWorker()
      worker.onmessage = (e: MessageEvent<{ id: number; blob?: Blob; error?: string }>) => {
        jobs.get(e.data.id)?.(e.data)
        jobs.delete(e.data.id)
      }
    } catch {
      broken = true
    }
  }
  if (!worker) return makeThumb(blob)
  const id = ++seq
  return new Promise((resolve, reject) => {
    jobs.set(id, (r) => (r.blob ? resolve(r.blob) : reject(new Error(r.error))))
    worker!.postMessage({ id, blob })
  })
}

type Job = { id: string; src: () => Promise<Blob>; done: (b: Blob | null | 'skip') => void }
const queue: Job[] = []
let running = 0
function pump() {
  while (running < 2 && queue.length) {
    const job = queue.pop()!
    if (!wanted.get(job.id)) {
      job.done('skip')
      continue
    }
    running++
    job
      .src()
      .then(shrink)
      .then(
        (b) => job.done(b),
        () => job.done(null),
      )
      .finally(() => {
        running--
        pump()
      })
  }
}

async function load(id: string, src: () => Promise<Blob>): Promise<string | null | 'skip'> {
  let small: Blob | null | undefined | 'skip'
  try {
    small = await assetStore.get<Blob>(thumbKey(id))
  } catch {
    small = undefined
  }
  if (!small) {
    small = await new Promise<Blob | null | 'skip'>((done) => {
      queue.push({ id, src, done })
      pump()
    })
    if (!small || small === 'skip') return small
    void assetStore.set(thumbKey(id), small).catch(() => {})
  }
  const u = URL.createObjectURL(small)
  urls.set(id, u)
  return u
}

function loadOnce(id: string, src: () => Promise<Blob>) {
  let p = inflight.get(id)
  if (!p) {
    p = load(id, src).finally(() => inflight.delete(id))
    inflight.set(id, p)
  }
  return p
}

export function wantThumb(id: string, src: () => Promise<Blob>, cb: (url: string | null) => void): () => void {
  wanted.set(id, (wanted.get(id) ?? 0) + 1)
  let live = true
  const hit = urls.get(id)
  const attempt = () =>
    void loadOnce(id, src).then((u) => {
      if (!live) return
      if (u === 'skip') attempt()
      else cb(u)
    })
  if (hit) cb(hit)
  else attempt()
  return () => {
    live = false
    const n = (wanted.get(id) ?? 1) - 1
    if (n > 0) wanted.set(id, n)
    else wanted.delete(id)
  }
}

export function dropThumb(id: string) {
  const u = urls.get(id)
  if (u) URL.revokeObjectURL(u)
  urls.delete(id)
  shown.delete(id)
  void assetStore.del(thumbKey(id)).catch(() => {})
}
