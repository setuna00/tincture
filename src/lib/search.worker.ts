// Inline Workers cannot resolve relative asset URLs; init must supply absolute URLs.
import type { RecommendOptions, Seed } from './recommend'
import { buildEngine, decodeArtists, decodeCooc, decodeLookup, fetchJsonGz, searchEntries, type ArtistListFile, type CoocFile, type LookupFile, type SearchFile } from './tag-data'

export interface TagDataUrls {
  lookup: string
  search: string
  cooc: string
  artists: string
}

type Req =
  | { type: 'init'; urls: TagDataUrls }
  | { id: number; type: 'search'; q: string; limit?: number; maxLevel?: number }
  | { id: number; type: 'match'; q: string; limit?: number; maxLevel?: number }
  | { id: number; type: 'recommend'; seeds: Seed[]; exclude: string[]; limit?: number; opts?: RecommendOptions }

function load(urls: TagDataUrls) {
  const artists = fetchJsonGz<ArtistListFile>(urls.artists)
    .then(decodeArtists)
    .catch(() => [])
  return Promise.all([fetchJsonGz<LookupFile>(urls.lookup), fetchJsonGz<SearchFile>(urls.search), fetchJsonGz<CoocFile>(urls.cooc), artists]).then(([l, s, c, a]) => {
    const base = decodeLookup(l)
    return buildEngine(searchEntries(base, s, a), decodeCooc(base, c))
  })
}
let ready: ReturnType<typeof load> | null = null

self.onmessage = async (e: MessageEvent<Req>) => {
  const r = e.data
  if (r.type === 'init') {
    ready ??= load(r.urls)
    ready.catch(() => {})
    return
  }
  try {
    if (!ready) throw new Error('tag 库还没初始化')
    const { search, match, recommend } = await ready
    if (r.type === 'search') {
      self.postMessage({ id: r.id, hits: search(r.q, r.limit, r.maxLevel).map((h) => ({ name: h.tag.name, via: h.via })) })
    } else if (r.type === 'match') {
      self.postMessage({ id: r.id, hits: match(r.q, r.limit, r.maxLevel).map((t) => ({ name: t.name, via: 'name' })) })
    } else {
      self.postMessage({ id: r.id, recs: recommend(r.seeds, r.exclude, r.limit, r.opts) })
    }
  } catch (err) {
    self.postMessage({ id: r.id, error: String(err) })
  }
}
