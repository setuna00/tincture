import { readFileSync, writeFileSync } from 'node:fs'
import { gunzipSync, gzipSync } from 'node:zlib'
import { candidates } from './fetch-wiki.mjs'
import { writeDataDates } from './lib/data-dates.mjs'
import { compoundOf } from '../src/lib/wiki-zh.ts'

const rows = readFileSync('data/zh/wiki.tsv', 'utf8')
  .split(/\r?\n/)
  .map((l) => l.split('\t'))
  .filter(([en, zh]) => en && zh)
  .map(([en, zh]) => [en, zh])
const has = new Set(rows.map(([en]) => en))

const lk = JSON.parse(gunzipSync(readFileSync('src/assets/tags/lookup.json.gz')))
const domain = new Map(lk.rows.map((r) => [r[0], lk.domains[r[4]]]))
const parts = []
const kinds = {}
for (const t of candidates()) {
  if (has.has(t.name)) continue
  const c = compoundOf(t.name, (n) => domain.get(n))
  if (!c) continue
  parts.push([t.name, c.mod, c.base])
  kinds[c.kind] = (kinds[c.kind] ?? 0) + 1
}

const s = JSON.stringify({ v: 1, rows, parts })
const gz = gzipSync(s, { level: 9 })
writeFileSync('src/assets/tags/wiki.json.gz', gz)
const baseHas = parts.filter(([, , b]) => has.has(b)).length
console.log(`src/assets/tags/wiki.json.gz  ${(s.length / 1e6).toFixed(2)} MB → gzip ${(gz.length / 1e3).toFixed(0)} KB`)
console.log(`释义 ${rows.length} 个；组合词 ${parts.length} 个`, kinds, `（base 有释义的 ${baseHas} 个）`)
writeDataDates(['wiki'])
