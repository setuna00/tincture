// A null pages[tag] means no wiki page, distinct from an existing page with an empty body.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { pathToFileURL } from 'node:url'

export const MIN_COUNT = 1000
const OUT = 'data/raw/wiki-zh/pages.json'
const BATCH = 100
const UA = 'nai-prompt-editor (local build script)'

export function candidates() {
  const j = JSON.parse(gunzipSync(readFileSync('src/assets/tags/lookup.json.gz')))
  const meta = new Set([j.cats.indexOf('general'), j.cats.indexOf('meta')])
  return j.rows
    .filter((r) => meta.has(r[2]) && r[3] >= MIN_COUNT && r[7] !== 2)
    .map((r) => ({ name: r[0], zh: r[1], count: r[3], group: j.groups[r[4]], domain: j.domains[r[4]], level: r[5] }))
}

const isKaomoji = (s) => /_/.test(s) && (!/[a-z0-9]{2}/i.test(s) || s.length <= 3)
export const wikiTitle = (n) => (isKaomoji(n) ? n : n.replace(/ /g, '_'))

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const list = candidates()
  const pages = {}
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  const get = async (url) => {
    for (let tries = 0; ; tries++) {
      const t0 = Date.now()
      const res = await fetch(url, { headers: { 'User-Agent': UA } })
      const wait = 1000 - (Date.now() - t0)
      if (wait > 0) await sleep(wait)
      if (res.ok) return res.json()
      if (tries >= 4) throw new Error(`HTTP ${res.status}：${url}`)
      await sleep(5000 * (tries + 1))
    }
  }
  const byTitle = new Map(list.map((t) => [wikiTitle(t.name), t.name]))
  const plain = list.filter((t) => !t.name.includes(','))
  for (let i = 0; i < plain.length; i += BATCH) {
    const part = plain.slice(i, i + BATCH)
    const q = encodeURIComponent(part.map((t) => wikiTitle(t.name)).join(','))
    for (const w of await get(`https://danbooru.donmai.us/wiki_pages.json?limit=${BATCH * 2}&only=title,updated_at,is_deleted,body&search[title_comma]=${q}`)) {
      const name = byTitle.get(w.title)
      if (name) pages[name] = { updated_at: w.updated_at, deleted: w.is_deleted, body: w.body ?? '' }
    }
    if ((i / BATCH) % 20 === 0) console.log(`${i + part.length} / ${list.length}`)
  }
  // title_comma treats commas as separators, so names containing commas need individual exact-title requests.
  for (const t of list.filter((t) => t.name.includes(','))) {
    const r = await get(`https://danbooru.donmai.us/wiki_pages.json?only=title,updated_at,is_deleted,body&search[title]=${encodeURIComponent(wikiTitle(t.name))}`)
    if (r[0]) pages[t.name] = { updated_at: r[0].updated_at, deleted: r[0].is_deleted, body: r[0].body ?? '' }
  }
  for (const t of list) pages[t.name] ??= null
  mkdirSync('data/raw/wiki-zh', { recursive: true })
  writeFileSync(OUT, JSON.stringify({ fetchedAt: new Date().toISOString(), pages }))
  const has = Object.values(pages).filter((p) => p && !p.deleted).length
  console.log(`${OUT}：${list.length} 个 tag，有 wiki ${has} 个`)
}
