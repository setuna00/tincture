// Sources: Danbooru API, newtextdoc1111/danbooru-tag-csv (MIT, co-occurrence), DominikDoom tagcomplete history (MIT, old counts), Aaalice translations (MIT). No GPL / AGPL data.
// lookup, search and cooc share count-sorted row indices; reordering one file independently corrupts their joins.
// lookup rows are [name, Chinese name, category index, post count, group index, NSFW level, NAI flag, old flag]; preserve column order.
// Alias tuples are [alias text, canonical lookup-row index]; the numeric value is an index, not a tag id.
// Search tuples are [English aliases[], Chinese aliases[], full pinyin, pinyin initials]; keep them aligned with lookup rows.
// Cooccurrence rows alternate [neighbor row index, NPMI x1000, ...]; readers rely on the stride and scale.
// NAI-only tags have estimated counts for sorting; renamed Danbooru tags inherit their canonical tag's count.
// old=2 marks a recognized renamed spelling whose count, Chinese name, group and level follow the canonical tag.
// old=1 marks a recognized deprecated tag; recover its count from ratings, then tagcomplete snapshots, then NAI.
// NSFW levels encode all-ages/suggestive/R18/R18G as 0/1/2/3; character and work rows use 0.
import { createReadStream, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createInterface } from 'node:readline'
import { gzipSync } from 'node:zlib'
import { pinyin } from 'pinyin-pro'
import { parseCsv } from './lib/csv.mjs'
import { LEVELS } from './lib/nsfw.mjs'
import { assignTree, atoms as treeAtoms } from './lib/tree.mjs'
import { writeDataDates } from './lib/data-dates.mjs'
import { loadUniverse, norm, zhKey } from './lib/universe.mjs'

const RAW = 'data/raw'
const OUT = 'src/assets/tags'
const CATS = ['general', 'artist', 'copyright', 'character', 'meta']
const N = 9_000_000
const MIN_COOC = 150
const MAX_NEIGHBORS = 40
const MIN_NPMI = 0.04

const read = (f) => readFileSync(f, 'utf8').replace(/^﻿/, '')
const tsv = (f) => (existsSync(f) ? read(f).split(/\r?\n/).filter((l) => l && !l.startsWith('#')).map((l) => l.split('\t')) : [])
const json = (f) => JSON.parse(read(f))
const han = /[一-鿿]/
const kana = /[぀-ヿ]/

const universe = loadUniverse()
const renamed = new Map(json(`${RAW}/danbooru/aliases.json`).map((r) => [norm(r.antecedent_name), norm(r.consequent_name)]))
for (const [name, zh, category, , count] of tsv('data/tags/nai.tsv')) {
  if (universe.has(name) && universe.get(name).count > 0) continue
  const now = universe.get(renamed.get(name))
  universe.set(name, now ? { name, category, count: now.count, from: 'nai', zh } : { name, category, count: Number(count), from: 'nai', zh, nai: true })
}

const ratingTotal = new Map(tsv('data/tags/ratings.tsv').map(([t, ...c]) => [t, c.slice(0, 4).reduce((a, b) => a + Number(b), 0)]))
const tagcomplete = new Map()
for (const f of ['2022-11', '2024-02', '2025-01']) {
  const file = `${RAW}/tagcomplete/danbooru-${f}.csv`
  if (!existsSync(file)) throw new Error(`缺 ${file}：DominikDoom/a1111-sd-webui-tagcomplete 的 tags/danbooru.csv 历史版本，见 THIRD_PARTY_NOTICES.md`)
  for (const r of parseCsv(read(file))) if (r[1] === '0' || r[1] === '5') tagcomplete.set(norm(r[0]), Math.max(tagcomplete.get(norm(r[0])) ?? 0, Number(r[2]) || 0))
}
const oldCount = (name, naiCount) => ratingTotal.get(name) || tagcomplete.get(name) || naiCount
const naiMissing = new Set()
const oldStat = { renamed: 0, deprecated: 0, ratings: 0, tagcomplete: 0, nai: 0 }
for (const [name, kind, to, found, naiCount, toNaiCount = ''] of tsv('data/tags/nai-old.tsv').slice(1)) {
  if (kind === 'renamed') {
    const now = universe.get(to)
    if (found !== '1' || universe.has(name) || !now) continue
    const swap = toNaiCount !== '' && Number(toNaiCount) > Number(naiCount)
    universe.set(name, { name, category: now.category, count: now.count, from: 'renamed', to, old: 2, ...(swap ? { swap } : {}) })
    oldStat.renamed++
  } else {
    const t = universe.get(name)
    if (!t || t.from !== 'deprecated' || t.count > 0) continue
    if (found !== '1') {
      naiMissing.add(name)
      continue
    }
    t.count = oldCount(name, Number(naiCount))
    t.old = 1
    oldStat.deprecated++
    oldStat[ratingTotal.get(name) ? 'ratings' : tagcomplete.get(name) ? 'tagcomplete' : 'nai']++
  }
}
const names = [...universe.keys()]

const ours = new Map()
for (const f of ['general', 'proper', 'glossary']) for (const [k, v = ''] of tsv(`data/zh/${f}.tsv`)) ours.set(k, v.trim())
const oursOf = (n) => ours.get(n) ?? ours.get(zhKey(n))
const alt = new Map()
const addAlt = (name, zh) => {
  for (const z of String(zh).split(/[|/、]/)) {
    const v = z.trim()
    if (v && han.test(v) && v.length <= 24) (alt.get(name) ?? alt.set(name, new Set()).get(name)).add(v)
  }
}
for (const [k, v = ''] of tsv('data/zh/search-alt.tsv')) addAlt(norm(k), v)
const community = new Map()
if (existsSync(`${RAW}/zh/aaalice/all_tags_cn.json`))
  for (const [k, v] of Object.entries(json(`${RAW}/zh/aaalice/all_tags_cn.json`))) {
    addAlt(norm(k), v)
    community.set(norm(k), v.split('|')[0].trim())
  }
for (const r of existsSync(`${RAW}/zh/aaalice/danbooru.csv`) ? parseCsv(read(`${RAW}/zh/aaalice/danbooru.csv`)) : [])
  if (r.length >= 2) {
    addAlt(norm(r[0]), r[1])
    if (!community.has(norm(r[0]))) community.set(norm(r[0]), r[1].trim())
  }
for (const r of existsSync(`${RAW}/zh/aaalice/wai_characters.csv`) ? parseCsv(read(`${RAW}/zh/aaalice/wai_characters.csv`)) : [])
  if (r.length >= 2) {
    addAlt(norm(r[1]), r[0])
    community.set(norm(r[1]), r[0].trim())
  }
if (existsSync(`${RAW}/zh/physton/zh_CN.yaml`))
  for (const line of read(`${RAW}/zh/physton/zh_CN.yaml`).split('\n')) {
    const m = line.match(/^ {8}(.+?): (.*)$/)
    if (m) addAlt(norm(m[1].replace(/^['"]|['"]$/g, '')), m[2].replace(/^['"]|['"]$/g, ''))
  }
const otherHan = new Map()
const hfCount = new Map()
for (const r of parseCsv(read(`${RAW}/danbooru_tags.csv`)).slice(1)) {
  if (r.length < 3) continue
  const n = norm(r[0])
  hfCount.set(n, Number(r[2]))
  const h = (r[3] ?? '').split(',').filter((a) => han.test(a) && !kana.test(a))
  if (h.length) otherHan.set(n, h[0].trim())
  for (const a of h) addAlt(n, a)
}

const bareName = (zh) => {
  const m = zh.match(/^(.+?)\s*[(（]([^()（）]+)[)）]$/)
  return m && !/cosplay|服|装|泳/.test(m[2]) ? m[1] : zh
}
const zhOf = (t) => {
  if (t.to) return zhOf(universe.get(t.to))
  const mine = t.zh ?? oursOf(t.name)
  if (mine) return mine
  const fallback = community.get(t.name) ?? otherHan.get(t.name) ?? ''
  if (t.category === 'character') return bareName(fallback)
  if (t.category === 'copyright') return fallback
  return ''
}

const tree = assignTree(new Map(names.map((n) => universe.get(n)).filter((t) => (t.category === 'general' || t.category === 'meta') && !t.to).map((t) => [t.name, t])))
const groupOf = (t) => {
  if (t.to) return groupOf(universe.get(t.to))
  if (t.category === 'character') return '角色'
  if (t.category === 'copyright') return '作品'
  return tree.assigned.get(t.name)?.atoms[0] ?? ''
}
const levelOf = (t) => (t.to ? levelOf(universe.get(t.to)) : Math.max(0, LEVELS.indexOf(tree.levels.get(t.name) ?? '全年龄')))
// Unauthenticated NAI suggestions hide NSFW tags, so an absent suggestion cannot disqualify an adult tag.
const dropped = [...naiMissing].filter((n) => levelOf(universe.get(n)) <= 1)
for (const n of dropped) universe.delete(n)
const kept = [...naiMissing].filter((n) => universe.has(n))

const aliases = new Map()
const addAlias = (name, a) => {
  if (a && a !== name && !universe.has(a)) (aliases.get(name) ?? aliases.set(name, new Set()).get(name)).add(a)
}
for (const r of json(`${RAW}/danbooru/aliases.json`)) {
  const c = norm(r.consequent_name)
  if (universe.has(c)) addAlias(c, norm(r.antecedent_name))
}
for (const [name, list] of tsv('data/tags/aliases.tsv')) for (const a of list.split(';')) addAlias(name, a.trim().toLowerCase())

const rows = names
  .filter((n) => universe.has(n))
  .map((n) => universe.get(n))
  .sort((a, b) => b.count - a.count || (a.name < b.name ? -1 : 1))
const groups = ['']
const gi = (g) => (groups.includes(g) ? groups.indexOf(g) : groups.push(g) - 1)
const py = (zh) => [
  pinyin(zh, { toneType: 'none', type: 'array', nonZh: 'removed' }).join(' ').replace(/ü/g, 'v'),
  pinyin(zh, { pattern: 'first', toneType: 'none', type: 'array', nonZh: 'removed' }).join('').replace(/ü/g, 'v'),
]
const lookup = []
const search = []
for (const t of rows) {
  const zh = zhOf(t)
  const others = t.to ? [] : [...(alt.get(t.name) ?? [])].filter((z) => z !== zh).slice(0, 6)
  lookup.push([t.name, zh, CATS.indexOf(t.category), t.count, gi(groupOf(t)), levelOf(t), t.nai ? 1 : 0, t.old ?? 0])
  search.push([t.to ? [] : [...(aliases.get(t.name) ?? [])], others, ...(zh && !t.to ? py(zh) : ['', ''])])
}

const index = new Map(rows.map((t, i) => [t.name, i]))
const nb = rows.map(() => new Map())
const rl = createInterface({ input: createReadStream(`${RAW}/danbooru_tags_cooccurrence.csv`), crlfDelay: Infinity })
let first = true
for await (const line of rl) {
  if (first) {
    first = false
    continue
  }
  const [a0, b0, cs] = line.split(',')
  const a = norm(a0)
  const b = norm(b0)
  const ia = index.get(a)
  const ib = index.get(b)
  const cab = Number(cs)
  if (ia === undefined || ib === undefined || ia === ib || cab < MIN_COOC) continue
  const ca = hfCount.get(a)
  const cb = hfCount.get(b)
  if (!ca || !cb) continue
  const pab = cab / N
  const npmi = Math.log(pab / ((ca / N) * (cb / N))) / -Math.log(pab)
  if (npmi < MIN_NPMI) continue
  const s = Math.round(npmi * 1000)
  nb[ia].set(ib, Math.max(nb[ia].get(ib) ?? 0, s))
  nb[ib].set(ia, Math.max(nb[ib].get(ia) ?? 0, s))
}
const cooc = nb.map((m) => [...m].sort((x, y) => y[1] - x[1]).slice(0, MAX_NEIGHBORS).flat())

mkdirSync(OUT, { recursive: true })
const write = (file, data) => {
  const s = JSON.stringify(data)
  const gz = gzipSync(s, { level: 9 })
  writeFileSync(`${OUT}/${file}.json.gz`, gz)
  console.log(`${OUT}/${file}.json.gz  ${(s.length / 1e6).toFixed(2)} MB → gzip ${(gz.length / 1e6).toFixed(2)} MB`)
}
const domains = groups.map((g) => treeAtoms.get(g)?.domain ?? g)
const aliasRows = []
const aliasSeen = new Set()
for (const r of json(`${RAW}/danbooru/aliases.json`)) {
  const a = norm(r.antecedent_name)
  const i = index.get(norm(r.consequent_name))
  if (i === undefined || universe.has(a) || aliasSeen.has(a)) continue
  aliasSeen.add(a)
  aliasRows.push([a, i])
}
write('lookup', { v: 3, cats: CATS, groups, domains, rows: lookup, aliases: aliasRows })
write('search', { v: 1, rows: search })
write('cooc', { v: 1, n: N, nb: cooc })

// Atom tuples are [name, domain, note] in atoms.tsv order; all atom indices refer to this table.
// more tuples are [lookup row index, ...secondary atom indices]; the primary atom remains in lookup's group field.
// parent tuples are [child lookup-row index, parent lookup-row index]; reversing them inverts the hierarchy.
// holding tuples are [lookup row index, held object's atom index]; the second field is not a tag index.
// renamed tuples are [old lookup-row index, canonical row index, 1?]; the optional 1 means NAI suggests the canonical name more often.
const atomList = [...treeAtoms.keys()]
const atomIdx = new Map(atomList.map((a, i) => [a, i]))
const atomsOfRow = (t) => (t.to ? atomsOfRow(universe.get(t.to)) : (tree.assigned.get(t.name)?.atoms ?? []))
const more = []
const holding = []
for (const [i, t] of rows.entries()) {
  if (t.category !== 'general' && t.category !== 'meta') continue
  const list = atomsOfRow(t)
  if (list.length > 1 && !t.to) more.push([i, ...list.slice(1).map((a) => atomIdx.get(a))])
  if (list[0] === '拿着' && !t.to) {
    const m = t.name.match(/^holding (.+)$/)
    const held = m && universe.get(m[1]) ? groupOf(universe.get(m[1])) : ''
    if (held && held !== '拿着' && atomIdx.has(held)) holding.push([i, atomIdx.get(held)])
  }
}
const parentPairs = []
const seenPair = new Set()
for (const r of json(`${RAW}/danbooru/implications.json`)) {
  const a = index.get(norm(r.antecedent_name))
  const c = index.get(norm(r.consequent_name))
  if (a === undefined || c === undefined || a === c || rows[a].to || rows[c].to) continue
  const sa = atomsOfRow(rows[a])
  const sc = new Set(atomsOfRow(rows[c]))
  if (!sa.some((x) => sc.has(x)) || seenPair.has(`${a}|${c}`)) continue
  seenPair.add(`${a}|${c}`)
  parentPairs.push([a, c])
}
parentPairs.sort((x, y) => x[0] - y[0] || x[1] - y[1])
const renamedRows = rows.flatMap((t, i) => (t.to && index.has(t.to) ? [t.swap ? [i, index.get(t.to), 1] : [i, index.get(t.to)]] : []))
write('tree', { v: 1, atoms: atomList.map((a) => [a, treeAtoms.get(a).domain, treeAtoms.get(a).note]), more, parent: parentPairs, holding, renamed: renamedRows })
console.log(`发现页：挂多个原子的 ${more.length} 个 · 同原子的蕴含 ${parentPairs.length} 对 · 拿着按拿的东西分 ${holding.length} 个 · 改了名的旧写法 ${renamedRows.length} 个（tag 面板给换的 ${renamedRows.filter((r) => r[2]).length} 个）`)

const byCat = {}
for (const r of lookup) byCat[CATS[r[2]]] = (byCat[CATS[r[2]]] ?? 0) + 1
const pct = (a, b) => `${((100 * a) / b).toFixed(0)}%`
console.log(`${lookup.length} 个 tag`, byCat)
const gen = lookup.filter((r) => r[2] === 0)
for (const [label, list] of [['通用 前 2000', gen.slice(0, 2000)], ['通用 ≥1000', gen.filter((r) => r[3] >= 1000)], ['通用 全部', gen]])
  console.log(`${label}：${list.length} 个，有中文 ${pct(list.filter((r) => r[1]).length, list.length)}，有原子 ${pct(list.filter((r) => r[4]).length, list.length)}`)
console.log('NSFW 档（通用 + 元信息）：', LEVELS.map((l, i) => `${l} ${lookup.filter((r) => (r[2] === 0 || r[2] === 4) && r[5] === i).length}`).join(' · '), '· NAI 特殊词', lookup.filter((r) => r[6]).length)
console.log(`NAI 认的旧词：改了名的旧写法进库 ${oldStat.renamed} 个；已弃用的补上作品数 ${oldStat.deprecated} 个（ratings.tsv ${oldStat.ratings} · tagcomplete ${oldStat.tagcomplete} · NAI 给的数 ${oldStat.nai}）；已弃用、NAI 查不到：去掉 ${dropped.length} 个（全年龄 / 擦边），留着 ${kept.length} 个（R18 / R18G，判不了）`)
const proper = lookup.filter((r) => r[2] === 2 || r[2] === 3)
console.log(`角色 / 作品：${proper.length} 个，有中文 ${pct(proper.filter((r) => r[1]).length, proper.length)}（≥1000：${pct(proper.filter((r) => r[3] >= 1000 && r[1]).length, proper.filter((r) => r[3] >= 1000).length)}）`)
console.log(`Danbooru 别名（库里没有的旧写法）${aliasRows.length} 个；有共现邻居 ${cooc.filter((l) => l.length).length} 个；有英文别名 ${search.filter((s) => s[0].length).length} 个；有其他中文叫法 ${search.filter((s) => s[1].length).length} 个`)
const noZh = gen.filter((r) => !r[1] && universe.get(r[0]).from !== 'deprecated').slice(0, 15).map((r) => r[0])
if (noZh.length) console.log('还没中文的通用 tag（作品数最高的几个）：', noZh.join(', '))
writeDataDates(['tags', 'naiOld', 'ratings', 'cooc', 'tree', 'zh'])
