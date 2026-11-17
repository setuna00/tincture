// lookup/search/cooc share row indices and are gzip files; cross-file references depend on preserving that order.
// Content-Encoding may already have decompressed the response; check gzip magic before decompressing again.
import { createRecommender, type CoocTable } from './recommend'
import { createMatcher, createSearcher } from './search-core'
import type { NsfwLevel, SearchEntry, TagCategory, TagEntry } from '@/types'

export interface LookupFile {
  v: 3
  cats: TagCategory[]
  groups: string[]
  domains: string[]
  /** Lookup row: [English, Chinese, category index, count, group index, NSFW level, NAI flag, old-name code].
 * Old-name codes are 0=current, 1=deprecated, 2=renamed. */
  rows: [string, string, number, number, number, NsfwLevel, 0 | 1, (0 | 1 | 2)?][]
  /** Alias rows pair an absent spelling with the canonical tag's lookup row index. */
  aliases?: [string, number][]
}
export interface SearchFile {
  v: 1
  /** Search row: [English aliases, alternate Chinese names, full pinyin, pinyin initials]. */
  rows: [string[], string[], string, string][]
}
export interface CoocFile {
  v: 1
  n: number
  /** Cooccurrence rows are flat [neighbor row, NPMI x1000, ...] pairs in descending NPMI order. */
  nb: number[][]
}

export function decodeLookup(f: LookupFile): TagEntry[] {
  return f.rows.map(([name, zh, c, count, g, level, nai, old]) => ({
    name,
    zh,
    category: f.cats[c],
    count,
    group: f.groups[g],
    domain: f.domains[g],
    level,
    ...(nai ? { nai: true } : {}),
    ...(old ? { old } : {}),
  }))
}

export function decodeAliases(f: LookupFile): Map<string, string> {
  return new Map((f.aliases ?? []).map(([a, i]) => [a, f.rows[i][0]]))
}

export function decodeSearch(tags: TagEntry[], f: SearchFile): SearchEntry[] {
  return tags.map((t, i) => {
    const [aliases, zhAlt, py, pyi] = f.rows[i]
    return { ...t, aliases, zhAlt, py, pyi }
  })
}

export function decodeCooc(tags: TagEntry[], f: CoocFile): CoocTable {
  return { n: f.n, names: tags.map((t) => t.name), nb: f.nb }
}

export interface ArtistListFile {
  names: string
  counts: number[]
}
export const decodeArtists = (f: ArtistListFile): TagEntry[] => f.names.split('\n').map((name, i) => ({ name, zh: '', category: 'artist', count: f.counts[i] }))
export const artistSearchEntry = (t: TagEntry): SearchEntry => ({ ...t, aliases: [], zhAlt: [], py: '', pyi: '' })

export function searchEntries(tags: TagEntry[], f: SearchFile, artists: TagEntry[]): SearchEntry[] {
  const known = new Set(tags.map((t) => t.name))
  return [...decodeSearch(tags, f), ...artists.filter((t) => !known.has(t.name)).map(artistSearchEntry)]
}

export function buildEngine(entries: SearchEntry[], cooc: CoocTable) {
  const search = createSearcher(entries)
  return { search, match: createMatcher(entries, search), recommend: createRecommender(cooc, entries) }
}
export type TagEngine = ReturnType<typeof buildEngine>

export async function fetchJsonGz<T>(url: string): Promise<T> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`tag 数据下载失败：HTTP ${res.status} ${url}`)
  const buf = await res.arrayBuffer()
  const head = new Uint8Array(buf, 0, 2)
  const text =
    head[0] === 0x1f && head[1] === 0x8b
      ? await new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'))).text()
      : new TextDecoder().decode(buf)
  return JSON.parse(text) as T
}
