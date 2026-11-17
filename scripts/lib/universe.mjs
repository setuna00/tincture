// Snapshot sources: HDiffusion/historical-danbooru-tag-counts (Apache-2.0), newtextdoc1111/danbooru-tag-csv (MIT).
// NAI V5 recognizes Danbooru spellings absent from today's list, so include renamed and deprecated tags from snapshots.
import { existsSync, readFileSync } from 'node:fs'
import { parseCsv } from './csv.mjs'

/** Underscores in emoticons are literal characters; preserve them when converting Danbooru names to NAI's space-separated spelling. */
export const isKaomoji = (s) => /_/.test(s) && (!/[a-z0-9]{2}/i.test(s) || s.length <= 3)
export const norm = (s) => {
  const t = s.trim().toLowerCase()
  return isKaomoji(t) ? t : t.replace(/_/g, ' ')
}
/** Translation keys replace all underscores, including emoticons; keep this normalization compatible with the TSV keys. */
export const zhKey = (s) => s.replace(/_/g, ' ')
const CAT = { 0: 'general', 3: 'copyright', 4: 'character', 5: 'meta' }
const MIN = { general: 50, meta: 50, copyright: 100, character: 100 }
const RAW = 'data/raw'

export function loadUniverse() {
  const out = new Map()
  const add = (name, category, count, from) => {
    if (!category || out.has(name)) return
    out.set(name, { name, category, count, from })
  }
  for (const f of ['general', 'meta', 'copyright', 'character'])
    for (const t of JSON.parse(readFileSync(`${RAW}/danbooru/tags-${f}.json`, 'utf8'))) add(norm(t.name), CAT[t.category], t.post_count, 'live')
  const csv = (file, from, minHf = 0) => {
    if (!existsSync(file)) return
    for (const r of parseCsv(readFileSync(file, 'utf8'))) {
      const category = CAT[r[1]]
      const count = Number(r[2])
      if (category && count >= Math.max(MIN[category], minHf)) add(norm(r[0]), category, count, from)
    }
  }
  csv(`${RAW}/danbooru/snapshot-2026-01-05.csv`, 'snapshot')
  csv(`${RAW}/danbooru_tags.csv`, 'hf2025', 100)
  for (const t of JSON.parse(readFileSync(`${RAW}/danbooru/tags-deprecated.json`, 'utf8')))
    if (t.category === 0 || t.category === 5) add(norm(t.name), CAT[t.category], t.post_count, 'deprecated')
  return out
}
