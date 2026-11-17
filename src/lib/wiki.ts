import { assetStore } from '@/store/storage'
import { wikiLead } from './wiki-zh'

export { wikiLead }

export type WikiResult = { paras: string[] } | { missing: true }
interface Cached {
  at: number
  paras?: string[]
}

const TTL = 90 * 24 * 3600 * 1000
const KEY = (name: string) => `wiki:${name}`
const title = (name: string) => name.trim().replace(/ /g, '_')

export const wikiPageUrl = (name: string) => `https://danbooru.donmai.us/wiki_pages/${encodeURIComponent(title(name))}`
const apiUrl = (name: string) => `${wikiPageUrl(name)}.json`

const mem = new Map<string, WikiResult>()
export const peekWiki = (name: string) => mem.get(name)

let last = 0
let chain: Promise<unknown> = Promise.resolve()
function throttled<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(async () => {
    const wait = last + 1000 - Date.now()
    if (wait > 0) await new Promise((r) => setTimeout(r, wait))
    last = Date.now()
    return fn()
  })
  chain = run.catch(() => undefined)
  return run
}

const inflight = new Map<string, Promise<WikiResult>>()

export function getWiki(name: string): Promise<WikiResult> {
  const hit = mem.get(name)
  if (hit) return Promise.resolve(hit)
  const pending = inflight.get(name)
  if (pending) return pending
  const p = (async () => {
    try {
      const c = await assetStore.get<Cached>(KEY(name))
      if (c && Date.now() - c.at < TTL) return c.paras ? { paras: c.paras } : { missing: true as const }
    } catch {
    }
    const res = await throttled(() => fetch(apiUrl(name)))
    let out: WikiResult
    if (res.status === 404) out = { missing: true }
    else if (!res.ok) throw new Error(`Danbooru wiki：HTTP ${res.status}`)
    else {
      const j = (await res.json()) as { body?: string; is_deleted?: boolean }
      const paras = j.is_deleted || !j.body ? [] : wikiLead(j.body)
      out = paras.length ? { paras } : { missing: true }
    }
    assetStore.set(KEY(name), { at: Date.now(), ...('paras' in out ? { paras: out.paras } : {}) } satisfies Cached).catch(() => undefined)
    return out
  })()
    .then((r) => {
      mem.set(name, r)
      return r
    })
    .finally(() => inflight.delete(name))
  inflight.set(name, p)
  return p
}
