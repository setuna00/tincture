import type { ChipType, Doc, Section } from '@/types'
import { chipLiteral } from './nai'

export interface Box {
  w: number
  h: number
}
export interface LaidItem {
  index: number
  x: number
  w: number
}
export interface LaidRow {
  y: number
  h: number
  items: LaidItem[]
}

const aspect = (b: Box) => (b.w > 0 && b.h > 0 ? b.w / b.h : 1)

export function justify(boxes: Box[], width: number, rowH: number, gap: number, gaps?: readonly number[]): LaidRow[] {
  const rows: LaidRow[] = []
  if (width <= 0 || rowH <= 0) return rows
  const g = (i: number) => gaps?.[i] ?? gap
  let y = 0
  const push = (from: number, to: number, h: number) => {
    const items: LaidItem[] = []
    let x = 0
    for (let i = from; i < to; i++) {
      if (i > from) x += g(i)
      const w = aspect(boxes[i]) * h
      items.push({ index: i, x, w })
      x += w
    }
    rows.push({ y, h, items })
    y += h + gap
  }
  let start = 0
  let sum = 0
  let gsum = 0
  for (let i = 0; i < boxes.length; i++) {
    const a = aspect(boxes[i])
    const n = i - start + 1
    const gWith = gsum + (n > 1 ? g(i) : 0)
    if ((sum + a) * rowH + gWith < width) {
      sum += a
      gsum = gWith
      continue
    }
    const hWith = (width - gWith) / (sum + a)
    const hWithout = n > 1 ? (width - gsum) / sum : Infinity
    if (n > 1 && a * rowH >= width) {
      push(start, i, Math.min(hWithout, rowH))
      push(i, i + 1, width / a)
      start = i + 1
      sum = 0
      gsum = 0
    } else if (n > 1 && Math.abs(hWithout - rowH) < Math.abs(hWith - rowH)) {
      push(start, i, hWithout)
      start = i
      sum = a
      gsum = 0
    } else {
      push(start, i + 1, hWith)
      start = i + 1
      sum = 0
      gsum = 0
    }
  }
  if (start < boxes.length) push(start, boxes.length, rowH)
  return rows
}

export function locate(rows: LaidRow[], index: number): { row: number; col: number } | null {
  let lo = 0
  let hi = rows.length - 1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    const r = rows[mid]
    const first = r.items[0].index
    const last = r.items[r.items.length - 1].index
    if (index < first) hi = mid - 1
    else if (index > last) lo = mid + 1
    else return { row: mid, col: index - first }
  }
  return null
}

export function neighbor(rows: LaidRow[], index: number, dir: 'left' | 'right' | 'up' | 'down', total: number): number {
  if (dir === 'left') return Math.max(0, index - 1)
  if (dir === 'right') return Math.min(total - 1, index + 1)
  const at = locate(rows, index)
  if (!at) return index
  const target = rows[at.row + (dir === 'up' ? -1 : 1)]
  if (!target) return index
  const it = rows[at.row].items[at.col]
  const cx = it.x + it.w / 2
  let best = target.items[0]
  for (const c of target.items) if (Math.abs(c.x + c.w / 2 - cx) < Math.abs(best.x + best.w / 2 - cx)) best = c
  return best.index
}

export function hitTest(rows: LaidRow[], r: { x: number; y: number; w: number; h: number }): number[] {
  const out: number[] = []
  for (const row of rows) {
    if (row.y > r.y + r.h) break
    if (row.y + row.h < r.y) continue
    for (const it of row.items) if (it.x <= r.x + r.w && it.x + it.w >= r.x) out.push(it.index)
  }
  return out
}

export interface DocFacts {
  artists: string[]
  tags: string[]
  free: string[]
}

export function factsOf(doc: Pick<Doc, 'base' | 'characters'>): DocFacts {
  const sections: Section[] = [...doc.base.prompt, ...doc.characters.filter((c) => c.enabled).flatMap((c) => c.prompt)]
  const artists = new Set<string>()
  const tags = new Set<string>()
  const free = new Set<string>()
  for (const s of sections) {
    if (s.muted) continue
    for (const c of s.chips) {
      if (c.disabled || !c.text.trim()) continue
      if (c.type === 'artist') artists.add(c.text.trim().toLowerCase())
      else if (c.type === 'text' || c.type === 'textrender') free.add(c.text.trim().toLowerCase())
      else tags.add(chipLiteral(c).trim().toLowerCase())
    }
  }
  return { artists: [...artists], tags: [...tags], free: [...free] }
}

export function splitCharacters(tags: readonly string[], isCharacter: (tag: string) => boolean): { characters: string[]; plain: string[] } {
  const characters: string[] = []
  const plain: string[] = []
  for (const t of tags) (isCharacter(t) ? characters : plain).push(t)
  return { characters, plain }
}

export function tokenFacet(
  tok: { type: ChipType; lit: string; gender?: unknown; nsfw?: true },
  f: { artists: readonly string[]; characters: readonly string[]; plain: readonly string[] },
): { key: 'artist' | 'character' | 'tag'; value: string } | null {
  if (tok.gender || tok.nsfw || tok.type === 'text' || tok.type === 'textrender') return null
  const lit = tok.lit.trim().toLowerCase()
  if (tok.type === 'artist') {
    const v = lit.replace(/^artist:/, '')
    return f.artists.includes(v) ? { key: 'artist', value: v } : null
  }
  if (f.characters.includes(lit)) return { key: 'character', value: lit }
  if (f.plain.includes(lit)) return { key: 'tag', value: lit }
  return null
}

export interface Query {
  all: string[]
  none: string[]
}

export function parseQuery(q: string): Query {
  const all: string[] = []
  const none: string[] = []
  for (const raw of q.trim().toLowerCase().split(/\s+/)) {
    if (!raw) continue
    const neg = raw.startsWith('-') && raw.length > 1
    const word = (neg ? raw.slice(1) : raw).replace(/_/g, ' ')
    if (word) (neg ? none : all).push(word)
  }
  return { all, none }
}

export const emptyQuery = (q: Query) => !q.all.length && !q.none.length

const CJK = /[㐀-鿿]/

export function hasWord(text: string, word: string): boolean {
  if (CJK.test(word)) return text.includes(word)
  let at = text.indexOf(word)
  while (at >= 0) {
    if (at === 0 || !/[a-z0-9]/.test(text[at - 1])) return true
    at = text.indexOf(word, at + 1)
  }
  return false
}

export function matchQuery(text: string, q: Query): boolean {
  return q.all.every((w) => hasWord(text, w)) && !q.none.some((w) => hasWord(text, w))
}

export interface Facet {
  on: string[]
  off: string[]
  any: boolean
}
export type FacetKey = 'model' | 'artist' | 'character' | 'tag'
export type Filters = Record<FacetKey, Facet>

export const emptyFacet = (): Facet => ({ on: [], off: [], any: false })
export const emptyFilters = (): Filters => ({ model: emptyFacet(), artist: emptyFacet(), character: emptyFacet(), tag: emptyFacet() })
export const facetActive = (f: Facet) => f.on.length > 0 || f.off.length > 0

export function passFacet(values: readonly string[], f: Facet): boolean {
  if (f.off.some((v) => values.includes(v))) return false
  if (!f.on.length) return true
  return f.any ? f.on.some((v) => values.includes(v)) : f.on.every((v) => values.includes(v))
}

export function toggleFacet(f: Facet, value: string, exclude: boolean): Facet {
  const on = f.on.filter((v) => v !== value)
  const off = f.off.filter((v) => v !== value)
  const was = f.on.includes(value) ? 'on' : f.off.includes(value) ? 'off' : null
  if (exclude) return { ...f, on, off: was === 'off' ? off : [...off, value] }
  return { ...f, on: was ? on : [...on, value], off }
}

export function countValues(lists: Iterable<readonly string[]>): [string, number][] {
  const n = new Map<string, number>()
  for (const l of lists) for (const v of l) n.set(v, (n.get(v) ?? 0) + 1)
  return [...n].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
}

export function facetRows(lists: readonly (readonly string[])[], f: Facet): [string, number][] {
  const has = (vs: readonly string[], v: string) => vs.includes(v)
  const pre = f.any ? lists : lists.filter((vs) => f.on.every((v) => has(vs, v)))
  const kept = pre.filter((vs) => !f.off.some((v) => has(vs, v)))
  const counted = countValues(kept)
  const counts = new Map(counted)
  const picked = new Set([...f.on, ...f.off])
  const head: [string, number][] = [...f.on.map((v): [string, number] => [v, counts.get(v) ?? 0]), ...f.off.map((v): [string, number] => [v, pre.filter((vs) => has(vs, v)).length])]
  return [...head, ...counted.filter(([v]) => !picked.has(v))]
}

export interface GalleryMarks {
  fav: Record<string, true>
  trash: Record<string, number>
}

export function setFav(m: GalleryMarks, ids: readonly string[], on: boolean): GalleryMarks {
  const fav = { ...m.fav }
  for (const id of ids) {
    if (on) fav[id] = true
    else delete fav[id]
  }
  return { ...m, fav }
}

export function toTrash(m: GalleryMarks, ids: readonly string[], now: number): GalleryMarks {
  const trash = { ...m.trash }
  for (const id of ids) trash[id] ??= now
  return { ...m, trash }
}

export function restore(m: GalleryMarks, ids: readonly string[]): GalleryMarks {
  const trash = { ...m.trash }
  for (const id of ids) delete trash[id]
  return { ...m, trash }
}

export function forget(m: GalleryMarks, ids: readonly string[]): GalleryMarks {
  return setFav(restore(m, ids), ids, false)
}
