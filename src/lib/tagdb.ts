// Vite turns large imported JSON into huge development JS modules; load these assets by URL.
import coocUrl from '@/assets/tags/cooc.json.gz?url'
import lookupUrl from '@/assets/tags/lookup.json.gz?url'
import searchUrl from '@/assets/tags/search.json.gz?url'
import type { Chip, ChipCategory, TagEntry } from '@/types'
import { isNegativeTag, isNoiseTag, siblingsOf, type CoocTable, type Recommendation, type RecommendOptions, type Seed } from './recommend'
import type { SearchHit } from './search-core'
import type { TagDataUrls } from './search.worker'
import SearchWorker from './search.worker?worker&inline'
import { artistListUrl, loadArtistList } from './artist-db'
import { buildEngine, decodeAliases, decodeArtists, decodeLookup, fetchJsonGz, searchEntries, type ArtistListFile, type CoocFile, type LookupFile, type SearchFile, type TagEngine } from './tag-data'

export const TAGS: TagEntry[] = []
const byName = new Map<string, TagEntry>()
const aliases = new Map<string, string>()

const abs = (u: string) => new URL(u, location.href).href
const urls = (): TagDataUrls => ({ lookup: abs(lookupUrl), search: abs(searchUrl), cooc: abs(coocUrl), artists: artistListUrl() })

let lookupFile: Promise<LookupFile> | null = null
const getLookup = () => (lookupFile ??= fetchJsonGz<LookupFile>(urls().lookup))
let initing: Promise<void> | null = null

export function initTagDb(): Promise<void> {
  return (initing ??= Promise.all([getLookup(), loadCooc().catch((e) => console.error('共现表加载失败', e))])
    .then(([f]) => {
      for (const t of decodeLookup(f)) TAGS.push(t)
      for (const [a, b] of decodeAliases(f)) aliases.set(a, b)
      for (const t of TAGS) if (!byName.has(t.name)) byName.set(t.name, t)
      setTimeout(() => {
        getWorker()
        void loadArtists()
      }, 0)
    })
    .catch((e) => console.error('tag 库加载失败', e)))
}

let artistsLoading: Promise<void> | null = null
function loadArtists() {
  return (artistsLoading ??= loadArtistList()
    .then((l) => {
      l.names.forEach((name, i) => byName.has(name) || byName.set(name, { name, zh: '', category: 'artist', count: l.counts[i] }))
    })
    .catch((e) => console.error('画师名单加载失败（编辑器里不认画师，手打 artist: 照常能用）', e)))
}

export const lookupTag = (name: string) => byName.get(name.toLowerCase())
export const aliasOf = (name: string) => aliases.get(name.toLowerCase())

export function chipCategory(chip: Pick<Chip, 'type' | 'text'>): ChipCategory {
  switch (chip.type) {
    case 'artist':
      return 'artist'
    case 'meta':
    case 'year':
      return 'meta'
    case 'text':
    case 'textrender':
      return 'text'
    default:
      return lookupTag(chip.text)?.category ?? 'general'
  }
}

export function chipZh(chip: Pick<Chip, 'type' | 'text'>): string | undefined {
  if (chip.type === 'year') return `${chip.text} 年`
  if (chip.type === 'text' || chip.type === 'textrender') return undefined
  const alias = chip.type === 'tag' || chip.type === 'interaction' ? aliasOf(chip.text) : undefined
  const zh = (lookupTag(chip.text) ?? (alias ? lookupTag(alias) : undefined))?.zh
  return zh && zh !== chip.text ? zh : undefined
}

export const countLabel = (t: Pick<TagEntry, 'count' | 'nai'>) => (t.nai ? 'NAI' : formatCount(t.count))

let maxLevel = 3
export function setNsfwLevel(level: number) {
  maxLevel = level
}
const allowedLevel = (t: TagEntry) => (t.level ?? 0) <= maxLevel

export function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1000) return `${Math.round(n / 1000)}k`
  return String(n)
}

let cooc: CoocTable | null = null
let coocIndex: Map<string, number> | null = null
let coocLoading: Promise<CoocTable> | null = null
function loadCooc(): Promise<CoocTable> {
  return (coocLoading ??= Promise.all([getLookup(), fetchJsonGz<CoocFile>(urls().cooc)]).then(([l, c]) => {
    cooc = { n: c.n, names: l.rows.map((r) => r[0]), nb: c.nb }
    coocIndex = new Map(cooc.names.map((n, i) => [n, i]))
    return cooc
  }))
}

/** NPMI values are scaled by 1000; missing records use 0. */
export function npmi(a: string, b: string): number {
  if (!cooc || !coocIndex) return 0
  const i = coocIndex.get(a)
  const j = coocIndex.get(b)
  if (i === undefined || j === undefined) return 0
  const list = cooc.nb[i]
  for (let k = 0; k < list.length; k += 2) if (list[k] === j) return list[k + 1]
  return 0
}

export interface Suggestion {
  tag: TagEntry
  via: SearchHit['via']
}

type Pending = { resolve: (r: unknown) => void; fallback: () => Promise<unknown> }

let worker: Worker | null = null
let workerBroken = false
let seq = 0
const pending = new Map<number, Pending>()

let mainEngine: Promise<TagEngine> | null = null
function engineOnMain() {
  return (mainEngine ??= Promise.all([
    getLookup(),
    fetchJsonGz<SearchFile>(urls().search),
    loadCooc(),
    fetchJsonGz<ArtistListFile>(urls().artists)
      .then(decodeArtists)
      .catch(() => [] as TagEntry[]),
  ]).then(([l, s, c, a]) => buildEngine(searchEntries(decodeLookup(l), s, a), c)))
}
const toSuggestions = (hits: { name: string; via: SearchHit['via'] }[]) => hits.flatMap((h) => (byName.has(h.name) ? [{ tag: byName.get(h.name)!, via: h.via }] : []))

function fallBack() {
  workerBroken = true
  worker?.terminate()
  worker = null
  for (const [id, p] of pending) {
    pending.delete(id)
    p.fallback().then(p.resolve)
  }
}

function getWorker(): Worker | null {
  if (workerBroken) return null
  if (!worker) {
    try {
      worker = new SearchWorker()
    } catch {
      workerBroken = true
      return null
    }
    worker.onmessage = (e: MessageEvent<{ id: number; hits?: { name: string; via: SearchHit['via'] }[]; recs?: Recommendation[]; error?: string }>) => {
      const p = pending.get(e.data.id)
      pending.delete(e.data.id)
      if (!p) return
      if (e.data.error) {
        console.error('tag Worker 出错，退回主线程', e.data.error)
        p.fallback().then(p.resolve)
        fallBack()
      } else if (e.data.hits) p.resolve(toSuggestions(e.data.hits))
      else p.resolve(e.data.recs)
    }
    worker.onerror = fallBack
    worker.postMessage({ type: 'init', urls: urls() })
  }
  return worker
}

function ask<T>(msg: Record<string, unknown>, fallback: () => Promise<T>): Promise<T> {
  const w = getWorker()
  if (!w) return fallback()
  const id = ++seq
  return new Promise<T>((resolve) => {
    pending.set(id, { resolve: resolve as (r: unknown) => void, fallback })
    w.postMessage({ ...msg, id })
  })
}

export function searchTags(q: string, limit = 12): Promise<Suggestion[]> {
  return ask({ type: 'search', q, limit, maxLevel }, () => engineOnMain().then((e) => e.search(q, limit, maxLevel).map((h) => ({ tag: byName.get(h.tag.name) ?? h.tag, via: h.via }))))
}

export function matchTags(q: string, limit = 24): Promise<Suggestion[]> {
  return ask({ type: 'match', q, limit, maxLevel }, () => engineOnMain().then((e) => e.match(q, limit, maxLevel).map((t) => ({ tag: byName.get(t.name) ?? t, via: 'name' as const }))))
}

export function recommendTags(seeds: Seed[], exclude: string[], limit = 24, opts?: RecommendOptions): Promise<Recommendation[]> {
  const o = { maxLevel, ...opts }
  return ask({ type: 'recommend', seeds, exclude, limit, opts: o }, () => engineOnMain().then((e) => e.recommend(seeds, exclude, limit, o)))
}

let related: { byGroup: Map<string, TagEntry[]>; byHead: Map<string, TagEntry[]> } | null = null
function relatedIndex() {
  if (related && TAGS.length) return related
  const byGroup = new Map<string, TagEntry[]>()
  const byHead = new Map<string, TagEntry[]>()
  for (const t of TAGS) {
    if (isNoiseTag(t.name, t) || t.old) continue
    if (t.group) {
      const k = `${t.category}|${t.group}`
      ;(byGroup.get(k) ?? byGroup.set(k, []).get(k)!).push(t)
    }
    if (t.name.includes(' ')) {
      const k = `${t.category}|${t.name.split(' ').pop()}`
      ;(byHead.get(k) ?? byHead.set(k, []).get(k)!).push(t)
    }
  }
  for (const list of [...byGroup.values(), ...byHead.values()]) list.sort((a, b) => b.count - a.count)
  return (related = { byGroup, byHead })
}

export function relatedTags(name: string, limit = 10, opts: { negative?: boolean; exclude?: string[] } = {}): TagEntry[] {
  const t = byName.get(name)
  if (!t || t.category === 'artist') return []
  const ex = new Set(opts.exclude)
  const siblings = siblingsOf(t.name, TAGS).filter((x) => !ex.has(x.name) && allowedLevel(x) && !x.old)
  const taken = new Set([t.name, ...ex, ...siblings.map((x) => x.name)])
  const ok = (x: TagEntry) => !taken.has(x.name) && x.category === t.category && allowedLevel(x) && (opts.negative || !isNegativeTag(x.name, x))
  const { byGroup, byHead } = relatedIndex()
  const head = t.name.split(' ').pop()!
  const sameHead = (byHead.get(`${t.category}|${head}`) ?? []).filter((x) => ok(x) && (!t.group || x.group === t.group))
  let rest: TagEntry[] = []
  if (sameHead.length < 3) {
    const pool = t.group ? (byGroup.get(`${t.category}|${t.group}`) ?? []) : neighbors(t.name)
    rest = pool
      .filter((x) => ok(x) && !sameHead.includes(x))
      .map((x) => ({ x, s: npmi(t.name, x.name) }))
      .sort((p, q) => q.s - p.s || q.x.count - p.x.count)
      .map((p) => p.x)
  }
  return [...siblings, ...sameHead, ...rest].slice(0, limit)
}

function neighbors(name: string): TagEntry[] {
  const i = coocIndex?.get(name)
  if (!cooc || i === undefined) return []
  const list = cooc.nb[i]
  const out: TagEntry[] = []
  for (let k = 0; k < list.length; k += 2) {
    const t = byName.get(cooc.names[list[k]])
    if (t && !isNoiseTag(t.name, t) && !t.old) out.push(t)
  }
  return out
}
