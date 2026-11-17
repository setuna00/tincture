import type { SearchEntry } from '@/types'
import { decodeArtists, decodeCooc, decodeLookup, searchEntries, type ArtistListFile, type CoocFile, type LookupFile, type SearchFile } from './tag-data'

const { readFileSync } = (await import(/* @vite-ignore */ `node:${'fs'}`)) as { readFileSync(p: URL): Uint8Array }
const { gunzipSync } = (await import(/* @vite-ignore */ `node:${'zlib'}`)) as { gunzipSync(b: Uint8Array): Uint8Array }
const read = <T>(file: string) => JSON.parse(new TextDecoder().decode(gunzipSync(readFileSync(new URL(`../assets/${file}.json.gz`, import.meta.url))))) as T

const base = decodeLookup(read<LookupFile>('tags/lookup'))
export const ENTRIES: SearchEntry[] = searchEntries(base, read<SearchFile>('tags/search'), decodeArtists(read<ArtistListFile>('artists/list')))
export const COOC = decodeCooc(base, read<CoocFile>('tags/cooc'))
export const BY_NAME = new Map<string, SearchEntry>(ENTRIES.map((t) => [t.name, t]))

const index = new Map(COOC.names.map((n, i) => [n, i]))
export function npmiOf(a: string, b: string): number {
  const i = index.get(a)
  const j = index.get(b)
  if (i === undefined || j === undefined) return 0
  const list = COOC.nb[i]
  for (let k = 0; k < list.length; k += 2) if (list[k] === j) return list[k + 1]
  return 0
}
