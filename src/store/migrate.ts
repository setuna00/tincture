// Keep browser data as a backup; stage and validate all records before one backend transaction so interrupted migrations can restart safely.
import { get, keys } from 'idb-keyval'
import { apiFetch, framed, isLibraryAsset, isLibraryKey, type GenImage } from './storage'

const DONE = 'pe:migrated'
const ID_RE = /^[A-Za-z0-9_-]{1,80}$/

export interface Migrated {
  kv: number
  kvBytes: number
  images: number
  imageBytes: number
  assets: number
  assetBytes: number
}

type OldImage = Omit<GenImage, 'mime' | 'size'> & { blob: Blob }

/** Replace lone surrogates before counting bytes because SQLite UTF-8 conversion replaces them with U+FFFD. */
const wellFormed = (s: string) => ((s as { toWellFormed?: () => string }).toWellFormed?.() ?? s)
const utf8 = new TextEncoder()

export async function migrateFromBrowser(libraryId: string, onStart?: () => (done: number, total: number) => void): Promise<Migrated | null> {
  const kv: Record<string, string> = {}
  try {
    if (localStorage.getItem(DONE)) return null
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      const v = k && isLibraryKey(k) ? localStorage.getItem(k) : null
      if (k && v !== null) kv[k] = wellFormed(v)
    }
  } catch {
  }
  let idbKeys: string[] = []
  try {
    idbKeys = (await keys()).filter((k): k is string => typeof k === 'string')
  } catch {
  }
  const genKeys = idbKeys.filter((k) => k.startsWith('gen:'))
  const assetKeys = idbKeys.filter(isLibraryAsset)
  if (!Object.keys(kv).length && !genKeys.length && !assetKeys.length) return null

  const progress = onStart?.()
  const total = genKeys.length + assetKeys.length
  let done = 0
  const { token } = (await (await apiFetch('/migrate/begin', { method: 'POST' })).json()) as { token: string }
  const expect = { images: 0, imageBytes: 0, assets: 0, assetBytes: 0 }

  for (const k of genKeys) {
    const r = await get<OldImage>(k).catch(() => undefined)
    if (r && r.blob instanceof Blob && typeof r.id === 'string' && ID_RE.test(r.id) && r.doc && typeof r.doc === 'object') {
      const { blob, ...rest } = r
      const img: GenImage = { ...rest, tabId: rest.tabId ?? k.slice(4).split(':')[0], mime: blob.type || 'image/webp', size: blob.size }
      await apiFetch(`/migrate/${token}/image`, { method: 'POST', headers: { 'content-type': 'application/x-pe-image' }, body: framed(img, blob) })
      expect.images++
      expect.imageBytes += blob.size
    }
    progress?.(++done, total)
  }
  for (const k of assetKeys) {
    const b = await get<Blob>(k).catch(() => undefined)
    if (b instanceof Blob) {
      await apiFetch(`/migrate/${token}/asset?key=${encodeURIComponent(k)}`, { method: 'POST', headers: { 'content-type': b.type || 'image/webp' }, body: b })
      expect.assets++
      expect.assetBytes += b.size
    }
    progress?.(++done, total)
  }

  const res = (await (
    await apiFetch(`/migrate/${token}/commit`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kv, expect }) })
  ).json()) as Migrated
  const want: Migrated = { kv: Object.keys(kv).length, kvBytes: Object.values(kv).reduce((n, v) => n + utf8.encode(v).length, 0), ...expect }
  const off = (Object.keys(want) as (keyof Migrated)[]).filter((k) => res[k] !== want[k])
  if (off.length) throw new Error(`核对不上：${off.map((k) => `${k} ${res[k]} ≠ ${want[k]}`).join('，')}`)
  try {
    localStorage.setItem(DONE, JSON.stringify({ at: Date.now(), libraryId, ...res }))
  } catch {
  }
  return res
}
