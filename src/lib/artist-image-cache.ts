// The CDN rejects requests without Referer; Chromium also supplies the system proxy.
import { useEffect, useReducer } from 'react'
import { assetStore } from '@/store/storage'
import { evict, IMG_CAP, imageId, mergeIndex, postMd5, shrinkForCache, tierUrl, toWebp, type ImageIndex, type Tier, type Touch } from './artist-image-core'
import type { DanbooruPost } from './danbooru-core'

const PREFIX = 'dan-img:'
const INDEX = 'dan-img-index'

const urls = new Map<string, string>()
const sizes = new Map<string, number>()
const absent = new Set<string>()
const looking = new Map<string, Promise<void>>()
const known = (id: string) => urls.has(id) || absent.has(id)

function keep(id: string, blob: unknown) {
  if (!(blob instanceof Blob)) return void absent.add(id)
  urls.set(id, URL.createObjectURL(blob))
  sizes.set(id, blob.size)
  absent.delete(id)
}

async function lookup(ids: string[]) {
  const todo = ids.filter((id) => !known(id) && !looking.has(id))
  if (todo.length) {
    const p = assetStore
      .getMany<Blob>(todo.map((id) => PREFIX + id))
      .then(
        (blobs) => todo.forEach((id, i) => keep(id, blobs[i])),
        () => todo.forEach((id) => absent.add(id)),
      )
      .finally(() => todo.forEach((id) => looking.delete(id)))
    for (const id of todo) looking.set(id, p)
  }
  await Promise.all(ids.map((id) => looking.get(id)))
}

export function useLocalImages(ids: string[]): boolean {
  const [, bump] = useReducer((x: number) => x + 1, 0)
  const key = ids.join(' ')
  const ready = ids.every(known)
  useEffect(() => {
    if (ready) return
    let live = true
    void lookup(key.split(' ')).then(() => live && bump())
    return () => {
      live = false
    }
  }, [key, ready])
  return ready
}

export function pickLocal(md5: string, tiers: Tier[]): { id: string; url: string } | undefined {
  for (const t of tiers) {
    const id = imageId(md5, t)
    const url = urls.get(id)
    if (url) return { id, url }
  }
  return undefined
}

export function useLocalSpares(pool: DanbooruPost[], exclude: DanbooruPost[], enabled: boolean): DanbooruPost[] {
  const skip = new Set(exclude.map((p) => p.id))
  const cand = enabled ? pool.filter((p) => !skip.has(p.id) && postMd5(p)) : []
  const ready = useLocalImages(cand.flatMap((p) => [imageId(postMd5(p)!, 720), imageId(postMd5(p)!, 360)]))
  return ready ? cand.filter((p) => pickLocal(postMd5(p)!, [720, 360])) : []
}

const pending = new Map<string, Touch>()
let timer: ReturnType<typeof setTimeout> | null = null
const FLUSH_AFTER = 2000

function note(id: string, x: Touch) {
  const old = pending.get(id)
  pending.set(id, { t: x.t, a: x.a ?? old?.a, s: x.s ?? old?.s })
  timer ??= setTimeout(() => void flushIndex(), FLUSH_AFTER)
}

export function touchImage(id: string, artist: string) {
  note(id, { t: Date.now(), a: artist, s: sizes.get(id) })
}

export async function flushIndex() {
  if (timer) clearTimeout(timer)
  timer = null
  if (!pending.size) return
  const batch = [...pending]
  pending.clear()
  try {
    await assetStore.update<ImageIndex>(INDEX, (old) => mergeIndex(old ?? {}, batch))
  } catch {
  }
}
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && void flushIndex())
  window.addEventListener('pagehide', () => void flushIndex())
}

interface Job {
  id: string
  url: string
  tier: Tier
  artist: string
}
const queues: [Job[], Job[]] = [[], []]
const queued = new Set<string>()
let running = 0

export function saveImage(p: DanbooruPost, tier: Tier, artist: string, priority: 0 | 1 = 0) {
  const md5 = postMd5(p)
  if (!md5) return
  const id = imageId(md5, tier)
  if (urls.has(id) || queued.has(id)) return
  queued.add(id)
  queues[priority].push({ id, url: tierUrl(p, tier), tier, artist })
  pump()
}

export async function saveGalleryRest(posts: DanbooruPost[], artist: string) {
  const md5s = posts.map(postMd5).filter((m): m is string => !!m)
  await lookup(md5s.map((m) => imageId(m, 720)))
  for (const p of posts) saveImage(p, 720, artist, 1)
}

function pump() {
  while (running < 3) {
    const job = queues[0].shift() ?? queues[1].shift()
    if (!job) return
    running++
    void run(job).finally(() => {
      running--
      queued.delete(job.id)
      pump()
    })
  }
}

async function run({ id, url, tier, artist }: Job) {
  try {
    await lookup([id])
    if (urls.has(id)) return
    const res = await fetch(url)
    if (!res.ok) return
    const got = await res.blob()
    if (!got.type.startsWith('image/')) return
    const blob = tier === 360 ? await shrinkForCache(got, toWebp) : got
    await assetStore.set(PREFIX + id, blob)
    keep(id, await assetStore.get<Blob>(PREFIX + id))
    note(id, { t: Date.now(), a: artist, s: blob.size })
  } catch {
  }
}

let pruneP: Promise<Set<string>> | null = null
export function pruneImages(keepArtist: (name: string) => boolean, cap = IMG_CAP): Promise<Set<string>> {
  return (pruneP ??= doPrune(keepArtist, cap).catch(() => new Set<string>()))
}

async function doPrune(keepArtist: (name: string) => boolean, cap: number): Promise<Set<string>> {
  await flushIndex()
  const stored = new Set((await assetStore.keys(PREFIX)).map((k) => k.slice(PREFIX.length)))
  const index = (await assetStore.get<ImageIndex>(INDEX)) ?? {}
  const stale = Object.keys(index).filter((id) => !stored.has(id))
  const orphans: [string, Touch][] = []
  for (const id of stored) {
    if (index[id]) continue
    const b = await assetStore.get<Blob>(PREFIX + id)
    if (b instanceof Blob) orphans.push([id, { t: Date.now(), s: b.size }])
  }
  const now = mergeIndex(index, orphans)
  for (const id of stale) delete now[id]
  const drop = evict(now, keepArtist, cap)
  for (const id of drop) {
    await assetStore.del(PREFIX + id)
    const u = urls.get(id)
    if (u) URL.revokeObjectURL(u)
    urls.delete(id)
    sizes.delete(id)
    absent.add(id)
  }
  const gone = new Set([...drop, ...stale])
  let left = new Set<string>()
  await assetStore.update<ImageIndex>(INDEX, (old) => {
    const next = mergeIndex(old ?? {}, orphans)
    for (const id of gone) delete next[id]
    left = new Set(Object.values(next).flatMap((e) => e.a))
    return next
  })
  return left
}
