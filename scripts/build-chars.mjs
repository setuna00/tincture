// Sources: isek-ai/danbooru-tags-2024 (CC0-1.0) for character/copyright pairs; newtextdoc1111/danbooru-tag-csv (MIT) co-occurrence for newer characters.
import { createReadStream, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { createInterface } from 'node:readline'
import { gunzipSync, gzipSync } from 'node:zlib'
import { asyncBufferFromFile, parquetReadObjects } from 'hyparquet'
import { compressors } from 'hyparquet-compressors'
import { writeDataDates } from './lib/data-dates.mjs'
import { norm } from './lib/universe.mjs'

const RAW = 'data/raw'
const OUT = 'src/assets/tags/chars.json.gz'
const SHARE = 0.5
const MIN_POSTS = 5
const GENDER_MIN = 5
const GENDER_SHARE = 0.9

const lookup = JSON.parse(gunzipSync(readFileSync('src/assets/tags/lookup.json.gz')))
const catOf = new Map(lookup.rows.map((r) => [r[0], lookup.cats[r[2]]]))
const chars = lookup.rows.filter((r) => lookup.cats[r[2]] === 'character').map((r) => r[0])
const isWork = (t) => catOf.get(t) === 'copyright'
const charSet = new Set(chars)
const alias = new Map(JSON.parse(readFileSync(`${RAW}/danbooru/aliases.json`, 'utf8')).map((a) => [norm(a.antecedent_name), norm(a.consequent_name)]))
const canon = (c) => alias.get(c) ?? c
const up = new Map()
for (const r of JSON.parse(readFileSync(`${RAW}/danbooru/implications.json`, 'utf8'))) {
  const a = canon(norm(r.antecedent_name))
  const b = canon(norm(r.consequent_name))
  if (a !== b && charSet.has(a) && charSet.has(b)) (up.get(a) ?? up.set(a, new Set()).get(a)).add(b)
}
const ancestors = (c, seen = new Set()) => {
  for (const b of up.get(c) ?? []) if (!seen.has(b)) seen.add(b), ancestors(b, seen)
  return seen
}
const ANC = new Map([...up.keys()].map((c) => [c, ancestors(c)]))
/** The count tuple is [1girl, 1boy, 1other]; its indices must match the f/m/o output encoding. */
const sex = new Map()
const SWAP = ['genderswap', 'genderswap (mtf)', 'genderswap (ftm)', 'genderswap (otf)']
function countSex(raw, general) {
  const cs = [...new Set(raw.map(canon))]
  const implied = new Set(cs.flatMap((c) => [...(ANC.get(c) ?? [])]))
  const people = cs.filter((c) => !implied.has(c))
  if (people.length !== 1 || !charSet.has(people[0])) return
  const gen = new Set(general.split(', '))
  if (!gen.has('solo') || SWAP.some((t) => gen.has(t))) return
  const g = gen.has('1girl')
  const b = gen.has('1boy')
  const o = gen.has('1other')
  const i = g && !b && !o ? 0 : b && !g && !o ? 1 : o && !g && !b ? 2 : -1
  if (i < 0) return
  for (const c of cs) if (charSet.has(c)) (sex.get(c) ?? sex.set(c, [0, 0, 0]).get(c))[i]++
}

const stats = new Map()
const stat = (c) => stats.get(c) ?? stats.set(c, { n: 0, w: new Map() }).get(c)
const out = new Map()
const from = { parquet: 0, hf: 0, implication: 0, paren: 0 }
const pick = (s) =>
  [...s.w]
    .filter(([w, k]) => isWork(w) && k / s.n >= SHARE)
    .sort((a, b) => b[1] - a[1])
    .map(([w]) => w)

const SRC = `${RAW}/posts-2024`
for (const f of readdirSync(SRC).filter((x) => x.endsWith('.parquet')).sort()) {
  const t0 = Date.now()
  const file = await asyncBufferFromFile(`${SRC}/${f}`)
  const rows = await parquetReadObjects({ file, columns: ['character', 'copyright', 'general'], compressors })
  for (const r of rows) {
    const cs = String(r.character ?? '').split(', ').filter(Boolean)
    if (!cs.length) continue
    countSex(cs, String(r.general ?? ''))
    const ws = String(r.copyright ?? '').split(', ').filter(Boolean)
    for (const c of cs) {
      const s = stat(c)
      s.n++
      for (const w of ws) s.w.set(w, (s.w.get(w) ?? 0) + 1)
    }
  }
  console.log(`${f}：${rows.length} 张，${Date.now() - t0}ms`)
}
for (const c of chars) {
  const s = stats.get(c)
  if (!s || s.n < MIN_POSTS) continue
  const w = pick(s)
  if (w.length) out.set(c, w), from.parquet++
}

const hfCount = new Map()
for (const line of readFileSync(`${RAW}/danbooru_tags.csv`, 'utf8').split(/\r?\n/).slice(1)) {
  const m = line.match(/^(.*?),(\d),(\d+)/)
  if (m) hfCount.set(norm(m[1]), +m[3])
}
const hf = new Map()
const rl = createInterface({ input: createReadStream(`${RAW}/danbooru_tags_cooccurrence.csv`) })
let header = true
for await (const line of rl) {
  if (header) {
    header = false
    continue
  }
  const i = line.lastIndexOf(',')
  const n = +line.slice(i + 1)
  const [a, b] = line.slice(0, i).split(',').map(norm)
  for (const [x, y] of [
    [a, b],
    [b, a],
  ])
    if (catOf.get(x) === 'character' && !out.has(x) && isWork(y)) (hf.get(x) ?? hf.set(x, new Map()).get(x)).set(y, n)
}
for (const [c, w] of hf) {
  const n = hfCount.get(c)
  if (!n || n < MIN_POSTS) continue
  const list = pick({ n, w })
  if (list.length) out.set(c, list), from.hf++
}

const impl = JSON.parse(readFileSync(`${RAW}/danbooru/implications.json`, 'utf8'))
for (let round = 0; round < 2; round++)
  for (const r of impl) {
    const a = norm(r.antecedent_name)
    const b = norm(r.consequent_name)
    if (catOf.get(a) === 'character' && !out.has(a) && out.has(b)) out.set(a, out.get(b)), from.implication++
  }

for (const c of chars) {
  if (out.has(c)) continue
  const m = c.match(/\(([^()]+)\)$/)
  if (m && isWork(m[1])) out.set(c, [m[1]]), from.paren++
}

// The gender string uses f/m/o and '-' for unknown; preserve the sentinel when no reliable estimate exists.
const genderOf = new Map()
for (const c of chars) {
  const k = sex.get(canon(c)) ?? sex.get(c)
  if (!k) continue
  const n = k[0] + k[1] + k[2]
  const top = Math.max(...k)
  if (n < GENDER_MIN || top / n < GENDER_SHARE) continue
  genderOf.set(c, 'fmo'[k.indexOf(top)])
}
const gStat = { f: 0, m: 0, o: 0 }
for (const g of genderOf.values()) gStat[g]++

const works = [...new Set([...out.values()].flat())].sort()
const idx = new Map(works.map((w, i) => [w, i]))
// Version 2 aligns g with rows, including characters with gender but no works; each row is [name, ...work indices].
const names = [...new Set([...out.keys(), ...genderOf.keys()])].sort()
const file = { v: 2, works, rows: names.map((c) => [c, ...(out.get(c) ?? []).map((x) => idx.get(x))]), g: names.map((c) => genderOf.get(c) ?? '-').join('') }
const gz = gzipSync(JSON.stringify(file), { level: 9 })
writeFileSync(OUT, gz)
console.log(`角色 ${chars.length} 个，定了作品的 ${out.size} 个（${((out.size / chars.length) * 100).toFixed(1)}%）：`, from)
console.log(`作品 ${works.length} 个；${OUT} ${(gz.length / 1024).toFixed(0)} KB`)
writeDataDates(['chars'])
console.log(`性别猜出 ${genderOf.size} 个（${((genderOf.size / chars.length) * 100).toFixed(1)}%）：`, gStat)
for (const c of ['frieren', 'fern (sousou no frieren)', 'stark (sousou no frieren)', 'himmel (sousou no frieren)', 'hatsune miku', 'saber (fate)', 'raiden shogun', 'pikachu'])
  console.log('  ', c, '→', out.get(c), genderOf.get(c) ?? '-')
