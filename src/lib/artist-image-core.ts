import type { DanbooruPost } from './danbooru-core'

export type Tier = 360 | 720
export const IMG_CAP = 300 * 1024 * 1024

/** Persisted fields: a = artist names, s = byte size, t = last-viewed timestamp. */
export interface IndexEntry {
  a: string[]
  s: number
  t: number
}
/** Index keys omit the `dan-img:` prefix used by the corresponding image assets. */
export type ImageIndex = Record<string, IndexEntry>
export interface Touch {
  t: number
  a?: string
  s?: number
}

export const postMd5 = (p: DanbooruPost) => /([0-9a-f]{32})\.webp$/.exec(p.large)?.[1]
export const imageId = (md5: string, tier: Tier) => `${md5}:${tier}`
export const tierUrl = (p: DanbooruPost, tier: Tier) => (tier === 360 ? p.thumb : p.large)

const fit = (p: DanbooruPost, box: number) => Math.round(p.w * Math.min(1, box / Math.max(p.w, p.h)))
export function cardTier(p: DanbooruPost, shown: number, dpr: number): Tier {
  const w360 = fit(p, 360)
  return shown * dpr <= w360 || fit(p, 720) === w360 ? 360 : 720
}
export const galleryFits720 = (p: DanbooruPost, shown: number, dpr: number) => !p.sample || shown * dpr <= fit(p, 720)

export function mergeIndex(index: ImageIndex, pending: Iterable<[string, Touch]>): ImageIndex {
  const out = { ...index }
  for (const [id, x] of pending) {
    const old = out[id]
    const s = x.s ?? old?.s
    if (s === undefined) continue
    const a = old?.a ?? []
    out[id] = { a: x.a && !a.includes(x.a) ? [...a, x.a] : a, s, t: Math.max(x.t, old?.t ?? 0) }
  }
  return out
}

export function evict(index: ImageIndex, keep: (name: string) => boolean, cap = IMG_CAP): string[] {
  const rest = Object.entries(index).filter(([, e]) => !e.a.some(keep))
  let total = rest.reduce((n, [, e]) => n + e.s, 0)
  const out: string[] = []
  for (const [id, e] of rest.sort((x, y) => x[1].t - y[1].t)) {
    if (total <= cap) break
    out.push(id)
    total -= e.s
  }
  return out
}

export async function shrinkForCache(blob: Blob, encode: (b: Blob) => Promise<Blob>): Promise<Blob> {
  if (blob.type === 'image/webp') return blob
  try {
    const webp = await encode(blob)
    return webp.size < blob.size ? webp : blob
  } catch {
    return blob
  }
}

export async function toWebp(blob: Blob): Promise<Blob> {
  const bmp = await createImageBitmap(blob)
  const c = new OffscreenCanvas(bmp.width, bmp.height)
  c.getContext('2d')!.drawImage(bmp, 0, 0)
  bmp.close()
  return c.convertToBlob({ type: 'image/webp', quality: 0.8 })
}
