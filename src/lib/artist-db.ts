import aliasesUrl from '@/assets/artists/aliases.json.gz?url'
import listUrl from '@/assets/artists/list.json.gz?url'
import popUrl from '@/assets/artists/popularity.json.gz?url'
import metaUrl from '@/assets/artists/topic-meta.json.gz?url'
import { useEffect, useLayoutEffect } from 'react'
import { create } from 'zustand'
import { rankOrder, type ArtistAlgo, type PopAlgo, type PopularityFile } from './artist-rank'
import { artistTopics, unpackPost, type DanbooruPost, type PackedPost, type RatingMode, type TopicMeta } from './danbooru-core'
import { fetchAlias, fetchArtistPosts, fetchArtistRelated, fetchArtistUrls, fetchNsfwCount, isAbort, peek, postsKey } from './danbooru-api'
import { fetchJsonGz } from './tag-data'

const shardUrls = import.meta.glob<string>('../assets/artists/top-*.json.gz', { query: '?url', import: 'default', eager: true })
const abs = (u: string) => new URL(u, location.href).href
export const artistListUrl = () => abs(listUrl)

export interface ArtistList {
  /** File row indices are post-count ranks; names use spaces and follow descending post counts. */
  names: string[]
  counts: number[]
  index: Map<string, number>
  nsfwOnly: Set<number>
  banned: Set<number>
  /** Maps list row indices to packed positions; shard files contain `shard` consecutive positions. */
  pre: Map<number, number>
  shard: number
  fetchedAt: string
}
interface ListFile {
  v: number
  fetchedAt: string
  names: string
  counts: number[]
  nsfwOnly: number[]
  banned: number[]
  pre: number[]
  shard: number
}
/** s/a index p for sfw/all posts; missing t.a means reuse t.s, not an empty topic list. */
interface TopRow {
  p: PackedPost[]
  s: number[]
  a: number[]
  t: { s: string[]; a?: string[] }
  n: number
  u: string[]
}

export interface ArtistDetail {
  topics?: string[]
  urls?: string[]
  nsfwCount?: number
  failed?: boolean
}

export interface ArtistPopularity {
  until: string
  algos: PopularityFile['algos']
  orders: Map<string, number[]>
}

interface State {
  list: ArtistList | null
  pop: ArtistPopularity | null
  aliases: string[][] | null
  shards: Record<number, TopRow[]>
  posts: Record<string, DanbooruPost[] | 'failed'>
  detail: Record<string, ArtistDetail>
}
export const useArtistData = create<State>(() => ({ list: null, pop: null, aliases: null, shards: {}, posts: {}, detail: {} }))

let listP: Promise<ArtistList> | null = null
export function loadArtistList(): Promise<ArtistList> {
  return (listP ??= fetchJsonGz<ListFile>(artistListUrl()).then((f) => {
    const names = f.names.split('\n')
    const list: ArtistList = {
      names,
      counts: f.counts,
      index: new Map(names.map((n, i) => [n, i])),
      nsfwOnly: new Set(f.nsfwOnly),
      banned: new Set(f.banned),
      pre: new Map(f.pre.map((i, k) => [i, k])),
      shard: f.shard,
      fetchedAt: f.fetchedAt,
    }
    useArtistData.setState({ list })
    return list
  }))
}

let popP: Promise<ArtistPopularity> | null = null
export function loadArtistPopularity(): Promise<ArtistPopularity> {
  return (popP ??= fetchJsonGz<PopularityFile>(abs(popUrl)).then(
    (f) => {
      const pop: ArtistPopularity = { until: f.until, algos: f.algos, orders: new Map() }
      useArtistData.setState({ pop })
      return pop
    },
    (e) => {
      popP = null
      throw e
    },
  ))
}
export function useArtistPopularity(enabled = true): ArtistPopularity | null {
  const pop = useArtistData((s) => s.pop)
  useEffect(() => {
    if (enabled) loadArtistPopularity().catch((e) => console.error('画师人气下载失败', e))
  }, [enabled])
  return pop
}

const modeKey = (mode: RatingMode) => (mode === 'sfw' ? 's' : 'a')
export function popOrder(pop: ArtistPopularity, algo: PopAlgo, mode: RatingMode): number[] {
  const key = `${algo}:${mode}`
  let o = pop.orders.get(key)
  if (!o) pop.orders.set(key, (o = rankOrder(pop.algos[algo][modeKey(mode)])))
  return o
}
export const popScore = (pop: ArtistPopularity, algo: PopAlgo, mode: RatingMode, i: number) => pop.algos[algo][modeKey(mode)][i] ?? null

export function artistsTopBy(list: ArtistList, pop: ArtistPopularity, algo: PopAlgo, mode: RatingMode, n: number): string[] {
  if (n <= 0) return list.names
  return popOrder(pop, algo, mode)
    .slice(0, n)
    .map((i) => list.names[i])
}

export function artistScore(name: string, algo: ArtistAlgo, mode: RatingMode): number | undefined {
  const { list, pop } = useArtistData.getState()
  const i = list?.index.get(name)
  if (i === undefined) return undefined
  if (algo === 'count') return list!.counts[i]
  return pop ? (popScore(pop, algo, mode, i) ?? undefined) : undefined
}

let aliasesP: Promise<string[][]> | null = null
export function loadAliases(): Promise<string[][]> {
  return (aliasesP ??= fetchJsonGz<{ rows: string }>(abs(aliasesUrl)).then((f) => {
    const aliases = f.rows.split('\n').map((l) => (l ? l.split('\t') : []))
    useArtistData.setState({ aliases })
    return aliases
  }))
}

const shardP = new Map<number, Promise<void>>()
function loadShard(k: number) {
  if (shardP.has(k)) return
  const u = shardUrls[`../assets/artists/top-${k}.json.gz`]
  if (!u) return
  shardP.set(
    k,
    fetchJsonGz<{ rows: TopRow[] }>(abs(u))
      .then((f) => useArtistData.setState((s) => ({ shards: { ...s.shards, [k]: f.rows } })))
      .catch((e) => {
        shardP.delete(k)
        console.error('画师库预存数据下载失败', e)
      }),
  )
}

let metaP: Promise<TopicMeta> | null = null
const loadTopicMeta = () => (metaP ??= fetchJsonGz<TopicMeta>(abs(metaUrl)))

export function useArtistList(): ArtistList | null {
  const list = useArtistData((s) => s.list)
  useLayoutEffect(() => {
    loadShard(0)
    loadArtistList().catch((e) => console.error('画师名单下载失败', e))
    const idle = window.requestIdleCallback ?? ((f: () => void) => setTimeout(f, 1500))
    const cancel = window.cancelIdleCallback ?? clearTimeout
    const h = idle(() => void loadAliases().catch((e) => console.error('画师别名下载失败', e)), { timeout: 3000 })
    return () => cancel(h as number)
  }, [])
  return list
}

export function artistCount(name: string): number | undefined {
  const l = useArtistData.getState().list
  const i = l?.index.get(name)
  return i !== undefined ? l!.counts[i] : undefined
}

export function artistsAtLeast(list: ArtistList, min: number): string[] {
  if (min <= 0) return list.names
  let lo = 0
  let hi = list.counts.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (list.counts[mid] >= min) lo = mid + 1
    else hi = mid
  }
  return list.names.slice(0, lo)
}

export function isNsfwOnlyArtist(name: string): boolean {
  const l = useArtistData.getState().list
  const i = l?.index.get(name)
  return i !== undefined && l!.nsfwOnly.has(i)
}

/** -1 means not preloaded; undefined means the list is not loaded yet. */
function topRank(s: State, name: string): number | undefined {
  if (!s.list) return undefined
  const i = s.list.index.get(name)
  return i !== undefined ? (s.list.pre.get(i) ?? -1) : -1
}
function useTopRow(name: string): { rank: number | undefined; row: TopRow | undefined } {
  const rank = useArtistData((s) => topRank(s, name))
  const k = rank !== undefined && rank >= 0 ? Math.floor(rank / useArtistData.getState().list!.shard) : -1
  const row = useArtistData((s) => (k >= 0 ? s.shards[k]?.[rank! % s.list!.shard] : undefined))
  useEffect(() => {
    if (k >= 0) loadShard(k)
  }, [k])
  return { rank, row }
}

const unpacked = new Map<string, DanbooruPost[]>()
function unpackOnce(key: string, list: PackedPost[]) {
  let got = unpacked.get(key)
  if (!got) unpacked.set(key, (got = list.map(unpackPost)))
  return got
}

const RETRY_FAILED_AFTER = 30_000
const failedAt = new Map<string, number>()

export function useArtistPosts(name: string, mode: RatingMode, wanted: boolean, priority = 1): DanbooruPost[] | 'failed' | undefined {
  const key = postsKey(name, mode)
  const { rank, row } = useTopRow(name)
  const fetched = useArtistData((s) => s.posts[key])
  useEffect(() => {
    const cur = useArtistData.getState().posts[key]
    if (rank !== -1 || !wanted || Array.isArray(cur) || (cur === 'failed' && performance.now() - (failedAt.get(key) ?? 0) < RETRY_FAILED_AFTER)) return
    const ac = new AbortController()
    fetchArtistPosts(name, mode, { priority, signal: ac.signal })
      .then((list) => useArtistData.setState((s) => ({ posts: { ...s.posts, [key]: unpackOnce(key, list) } })))
      .catch((e) => {
        if (isAbort(e)) return
        console.warn(e)
        failedAt.set(key, performance.now())
        useArtistData.setState((s) => ({ posts: { ...s.posts, [key]: 'failed' } }))
      })
    return () => ac.abort()
  }, [rank, wanted, key, name, mode, priority])
  if (row) return unpackOnce(`top:${key}`, (mode === 'sfw' ? row.s : row.a).map((i) => row.p[i]))
  if (fetched) return fetched
  const hit = peek<PackedPost[]>(key)
  return hit ? unpackOnce(key, hit) : undefined
}

export function useArtistDetail(name: string, mode: RatingMode): ArtistDetail {
  const key = `${mode}:${name}`
  const { rank, row } = useTopRow(name)
  const got = useArtistData((s) => s.detail[key])
  useEffect(() => {
    if (rank !== -1) return
    const ac = new AbortController()
    const opts = { priority: 0, signal: ac.signal }
    const put = (patch: ArtistDetail) => useArtistData.setState((s) => ({ detail: { ...s.detail, [key]: { ...s.detail[key], ...patch } } }))
    const fail = (e: unknown) => {
      if (isAbort(e)) return
      console.warn(e)
      put({ failed: true })
    }
    if (useArtistData.getState().detail[key]?.failed) put({ failed: false })
    fetchArtistUrls(name, opts).then((urls) => put({ urls }), fail)
    fetchNsfwCount(name, opts).then((nsfwCount) => put({ nsfwCount }), fail)
    Promise.all([fetchArtistRelated(name, mode, opts), loadTopicMeta()]).then(([rel, meta]) => put({ topics: artistTopics(rel, meta) }), fail)
    return () => ac.abort()
  }, [rank, key, name, mode])
  if (row) return { topics: mode === 'sfw' ? row.t.s : (row.t.a ?? row.t.s), urls: row.u, nsfwCount: row.n }
  return got ?? {}
}

export async function resolveRenamed(names: string[], rename: (from: string, to: string) => void): Promise<Set<string>> {
  const missing = new Set<string>()
  const list = await loadArtistList()
  for (const n of names) {
    if (list.index.has(n)) continue
    try {
      const to = await fetchAlias(n, { priority: 2 })
      if (to && to !== n) rename(n, to)
      else missing.add(n)
    } catch (e) {
      if (!isAbort(e)) missing.add(n)
    }
  }
  return missing
}
