import type { Chip, Doc, Section } from '@/types'
import type { GenImage } from '@/store/storage'
import { factsOf } from './gallery'
import { versionKey } from './versions'

export type StackMode = 'off' | 'version' | 'near'

export interface Stack {
  key: string
  items: GenImage[]
  cover: GenImage
  versions: number[]
  frames: GenImage[]
}

export type Entry = { kind: 'one'; img: GenImage } | { kind: 'stack'; stack: Stack }

const byTime = (a: GenImage, b: GenImage) => a.createdAt - b.createdAt || a.index - b.index

const tagSet = (doc: Pick<Doc, 'base' | 'characters'>) => {
  const f = factsOf(doc)
  return new Set([...f.tags, ...f.artists.map((a) => `artist:${a}`)])
}

export function tagChanges(a: Pick<Doc, 'base' | 'characters'>, b: Pick<Doc, 'base' | 'characters'>): { changes: number; size: number } {
  const A = tagSet(a)
  const B = tagSet(b)
  let changes = 0
  for (const x of A) if (!B.has(x)) changes++
  for (const x of B) if (!A.has(x)) changes++
  return { changes, size: Math.max(A.size, B.size) }
}

export function isNear(a: Pick<Doc, 'base' | 'characters'>, b: Pick<Doc, 'base' | 'characters'>): boolean {
  const { changes, size } = tagChanges(a, b)
  return changes <= Math.max(3, Math.ceil(size * 0.15))
}

export function seriesOf(images: readonly GenImage[], importedTab = 'imported'): Map<string, number> {
  const docs = new Map<string, Map<number, Doc>>()
  for (const img of images) {
    if (img.tabId === importedTab || img.version == null) continue
    let vs = docs.get(img.tabId)
    if (!vs) docs.set(img.tabId, (vs = new Map()))
    if (!vs.has(img.version)) vs.set(img.version, img.doc)
  }
  const out = new Map<string, number>()
  for (const [tab, vs] of docs) {
    const ns = [...vs.keys()].sort((a, b) => a - b)
    let s = 0
    ns.forEach((n, i) => {
      if (i > 0 && !isNear(vs.get(ns[i - 1])!, vs.get(n)!)) s++
      out.set(`${tab}:${n}`, s)
    })
  }
  return out
}

/** Legacy processed-image records lack a version; inherit the source image's version to preserve stack membership. */
export function adoptSource(images: readonly GenImage[]): GenImage[] {
  const byId = new Map(images.map((x) => [x.id, x]))
  let changed = false
  const out = images.map((img) => {
    if (img.versionId || !img.sourceId) return img
    let src = byId.get(img.sourceId)
    for (let i = 0; src && !src.versionId && src.sourceId && i < 16; i++) src = byId.get(src.sourceId)
    if (!src?.versionId || src.tabId !== img.tabId) return img
    changed = true
    return { ...img, versionId: src.versionId, version: src.version }
  })
  return changed ? out : (images as GenImage[])
}

export function stackKey(img: GenImage, mode: StackMode, series: Map<string, number>, importedTab = 'imported'): string | null {
  if (mode === 'off') return null
  if (img.tabId === importedTab) return `imp:${versionKey(img.doc)}`
  if (!img.versionId) return null
  if (mode === 'near' && img.version != null) {
    const s = series.get(`${img.tabId}:${img.version}`)
    if (s != null) return `${img.tabId}:s${s}`
  }
  return `${img.tabId}:v${img.versionId}`
}

function coverOf(list: GenImage[], fav: Record<string, true>, covers: Record<string, number>): GenImage {
  let picked: GenImage | undefined
  for (const x of list) if (covers[x.id] && (!picked || covers[x.id] > covers[picked.id])) picked = x
  return picked ?? [...list].reverse().find((x) => fav[x.id]) ?? list[list.length - 1]
}

export function makeStack(key: string, items: readonly GenImage[], fav: Record<string, true>, covers: Record<string, number> = {}): Stack {
  const sorted = [...items].sort(byTime)
  const versions = [...new Set(sorted.flatMap((x) => (x.version == null ? [] : [x.version])))].sort((a, b) => a - b)
  const frames = versions.length > 1 ? versions.map((v) => coverOf(sorted.filter((x) => x.version === v), fav, covers)) : sorted
  return { key, items: sorted, cover: coverOf(sorted, fav, covers), versions, frames }
}

export function buildEntries(visible: readonly GenImage[], mode: StackMode, fav: Record<string, true>, series: Map<string, number>, importedTab = 'imported', covers: Record<string, number> = {}): Entry[] {
  if (mode === 'off') return visible.map((img) => ({ kind: 'one', img }))
  const groups = new Map<string, GenImage[]>()
  const order: (string | GenImage)[] = []
  for (const img of visible) {
    const k = stackKey(img, mode, series, importedTab)
    if (!k) {
      order.push(img)
      continue
    }
    let g = groups.get(k)
    if (!g) {
      groups.set(k, (g = []))
      order.push(k)
    }
    g.push(img)
  }
  const all = order.map((o): Entry => {
    if (typeof o !== 'string') return { kind: 'one', img: o }
    const items = groups.get(o)!
    return items.length === 1 ? { kind: 'one', img: items[0] } : { kind: 'stack', stack: makeStack(o, items, fav, covers) }
  })
  return [...all.filter((e) => e.kind === 'stack'), ...all.filter((e) => e.kind === 'one')]
}

export type SortBy = 'time' | 'name' | 'tags'
export type SortDir = 'desc' | 'asc'

export const SORT_DEFAULT_DIR: Record<SortBy, SortDir> = { time: 'desc', name: 'asc', tags: 'desc' }

const collator = new Intl.Collator('zh-CN', { numeric: true, sensitivity: 'base' })
const HAN = /^\p{Script=Han}/u
export const compareNames = (a: string, b: string) => Number(HAN.test(a)) - Number(HAN.test(b)) || collator.compare(a, b)

export function sortEntries(entries: readonly Entry[], by: SortBy, dir: SortDir, nameOf: (e: Entry) => string, tagsOf: (e: Entry) => number): Entry[] {
  if (by === 'time') return [...entries]
  const k = dir === 'asc' ? 1 : -1
  const keyed = entries.map((e, i) => ({ e, i, stack: e.kind === 'stack' ? 0 : 1, name: by === 'name' ? nameOf(e) : '', tags: by === 'tags' ? tagsOf(e) : 0 }))
  keyed.sort((a, b) => a.stack - b.stack || (by === 'name' ? compareNames(a.name, b.name) : a.tags - b.tags) * k || a.i - b.i)
  return keyed.map((x) => x.e)
}

type ChipLike = Pick<Chip, 'text' | 'type' | 'weight' | 'disabled'>
const chipSig = (c: ChipLike) => `${c.type}\u0001${c.text.trim().toLowerCase()}\u0001${c.weight}\u0001${c.disabled ? 1 : 0}`
export const chipsSig = (chips: readonly ChipLike[]) => chips.map(chipSig).join('\u0002')

export function templatesUsed(doc: Pick<Doc, 'base' | 'characters'>, sectionSigs: ReadonlyMap<string, string>, sectionIds: ReadonlySet<string>, charIds: ReadonlySet<string>): string[] {
  const out = new Set<string>()
  const look = (s: Section) => {
    if (s.muted || !s.chips.length) return
    if (s.templateId && !s.templateEdited && sectionIds.has(s.templateId)) out.add(s.templateId)
    const hit = sectionSigs.get(chipsSig(s.chips))
    if (hit) out.add(hit)
  }
  for (const s of [...doc.base.prompt, ...doc.base.uc]) look(s)
  for (const c of doc.characters) {
    if (!c.enabled) continue
    if (c.templateId && !c.templateEdited && charIds.has(c.templateId)) out.add(c.templateId)
    for (const s of [...c.prompt, ...c.uc]) look(s)
  }
  return [...out]
}

export interface GalleryDir {
  id: string
  name: string
  parent: string | null
  items: Record<string, number>
  createdAt: number
}

export function dirSubtree(dirs: readonly GalleryDir[], id: string): string[] {
  const out = [id]
  for (let i = 0; i < out.length; i++) for (const d of dirs) if (d.parent === out[i]) out.push(d.id)
  return out
}

export function dirImages(dirs: readonly GalleryDir[], id: string): Set<string> {
  const ids = new Set(dirSubtree(dirs, id))
  const out = new Set<string>()
  for (const d of dirs) if (ids.has(d.id)) for (const k of Object.keys(d.items)) out.add(k)
  return out
}

export function dirTree(dirs: readonly GalleryDir[]): { dir: GalleryDir; depth: number; branch: boolean }[] {
  const out: { dir: GalleryDir; depth: number; branch: boolean }[] = []
  const walk = (parent: string | null, depth: number) => {
    for (const d of dirs.filter((x) => x.parent === parent).sort((a, b) => a.createdAt - b.createdAt)) {
      out.push({ dir: d, depth, branch: dirs.some((x) => x.parent === d.id) })
      walk(d.id, depth + 1)
    }
  }
  walk(null, 1)
  return out
}

export const SIDE_MAX = 9

export interface Tile {
  index: number
  x: number
  y: number
  w: number
  h: number
}

export function tileLayout(boxes: readonly { w: number; h: number }[], width: number, height: number, gap: number): Tile[] {
  const n = boxes.length
  if (!n || width <= 0 || height <= 0) return []
  const a = boxes.map((b) => (b.w > 0 && b.h > 0 ? b.w / b.h : 1))
  let best: { rows: number[][]; hs: number[]; score: number } | null = null
  for (let r = 1; r <= n; r++) {
    const per = Math.ceil(n / r)
    const rows: number[][] = []
    for (let i = 0; i < n; i += per) rows.push(Array.from({ length: Math.min(per, n - i) }, (_, k) => i + k))
    if (rows.length !== r) continue
    const hs = rows.map((row) => (width - gap * (row.length - 1)) / row.reduce((s, i) => s + a[i], 0))
    const total = hs.reduce((s, h) => s + h, 0)
    const k = Math.min(1, (height - gap * (rows.length - 1)) / total)
    const scaled = hs.map((h) => h * k)
    const score = Math.min(...rows.flatMap((row, ri) => row.map((i) => scaled[ri] ** 2 * a[i])))
    if (!best || score > best.score) best = { rows, hs: scaled, score }
  }
  const out: Tile[] = []
  const totalH = best!.hs.reduce((s, h) => s + h, 0) + gap * (best!.rows.length - 1)
  let y = (height - totalH) / 2
  best!.rows.forEach((row, ri) => {
    const h = best!.hs[ri]
    const rw = row.reduce((s, i) => s + a[i] * h, 0) + gap * (row.length - 1)
    let x = (width - rw) / 2
    for (const i of row) {
      out.push({ index: i, x, y, w: a[i] * h, h })
      x += a[i] * h + gap
    }
    y += h + gap
  })
  return out
}
