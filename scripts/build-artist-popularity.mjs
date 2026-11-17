// Source: isek-ai/danbooru-tags-2024 on Hugging Face (CC0-1.0), per-post score and rating.
// null means insufficient posts to rank in that mode; it must not become a score of zero.
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { asyncBufferFromFile, parquetReadObjects } from 'hyparquet'
import { compressors } from 'hyparquet-compressors'

const SRC = process.env.POSTS_DIR ?? 'data/raw/posts-2024'
const OUT = 'data/raw/artists/popularity.json'
const MIN_POSTS = 20
const TOP_N = 20
const HIT_SHARE = 0.2
const PRIOR = 20

const rows0 = JSON.parse(readFileSync('data/raw/artists/list.json', 'utf8')).rows
// Dataset artist names use spaces but the input list uses underscores; normalize before joining them.
const names = rows0.map(([tag]) => tag.replace(/_/g, ' '))
const idx = new Map(names.map((n, i) => [n, i]))

// A, S, FAM, M and SFW share one index per artist-post pair; keep all five arrays aligned when growing or sorting.
let cap = 8_000_000
let A = new Int32Array(cap), S = new Int32Array(cap), FAM = new Int32Array(cap), M = new Int16Array(cap), SFW = new Uint8Array(cap)
let n = 0
const grow = () => {
  cap *= 2
  const g = (Ctor, old) => {
    const a = new Ctor(cap)
    a.set(old)
    return a
  }
  A = g(Int32Array, A), S = g(Int32Array, S), FAM = g(Int32Array, FAM), M = g(Int16Array, M), SFW = g(Uint8Array, SFW)
}
const SKIP_EXT = new Set(['mp4', 'webm', 'zip', 'swf', 'gif'])
const has = (list, t) => (', ' + list + ', ').includes(', ' + t + ', ')
const skip = (r) => {
  const g = String(r.general ?? '')
  const m = String(r.meta ?? '')
  return SKIP_EXT.has(String(r.file_ext)) || has(m, 'animated') || has(m, 'video') || has(g, 'comic') || has(m, 'comic') || has(g, '4koma') || has(m, '4koma') || has(g, '3d')
}
let posts = 0
for (const f of readdirSync(SRC).filter((f) => f.endsWith('.parquet')).sort()) {
  const rows = await parquetReadObjects({
    file: await asyncBufferFromFile(`${SRC}/${f}`),
    columns: ['id', 'created_at', 'score', 'rating', 'parent_id', 'is_deleted', 'file_ext', 'general', 'meta', 'artist'],
    compressors,
  })
  for (const r of rows) {
    posts++
    if (!r.artist || r.is_deleted || !'gsqe'.includes(r.rating) || skip(r)) continue
    const ca = String(r.created_at)
    const month = (Number(ca.slice(0, 4)) - 2005) * 12 + Number(ca.slice(5, 7)) - 1
    for (const a of String(r.artist).split(', ')) {
      const i = idx.get(a)
      if (i === undefined) continue
      if (n === cap) grow()
      A[n] = i
      S[n] = Number(r.score)
      FAM[n] = Number(r.parent_id ?? r.id)
      M[n] = month
      SFW[n] = r.rating === 'g' || r.rating === 's' ? 1 : 0
      n++
    }
  }
  process.stdout.write('.')
}
console.log(`\n${posts} 张图，名单里的画师 × 作品 ${n} 条`)

let months = 0
for (let k = 0; k < n; k++) if (M[k] >= months) months = M[k] + 1
function monthStats(sfwOnly) {
  const buckets = Array.from({ length: months }, () => [])
  for (let k = 0; k < n; k++) if (!sfwOnly || SFW[k]) buckets[M[k]].push(S[k])
  return buckets.map((b) => {
    if (!b.length) return [1, 1]
    const a = Float64Array.from(b).sort()
    return [Math.max(1, a[Math.floor(a.length / 2)]), Math.max(1, a[Math.floor(a.length * (1 - HIT_SHARE))])]
  })
}
const stats = { s: monthStats(true), a: monthStats(false) }

const start = new Int32Array(names.length + 1)
for (let k = 0; k < n; k++) start[A[k] + 1]++
for (let i = 0; i < names.length; i++) start[i + 1] += start[i]
const fill = start.slice()
const order = new Int32Array(n)
for (let k = 0; k < n; k++) order[fill[A[k]]++] = k

const median = (a) => {
  const b = [...a].sort((x, y) => x - y)
  const h = b.length >> 1
  return b.length % 2 ? b[h] : (b[h - 1] + b[h]) / 2
}
const round = (x, d) => Math.round(x * 10 ** d) / 10 ** d
const out = {}
let ranked = 0
for (let i = 0; i < names.length; i++) {
  const row = {}
  for (const mode of ['s', 'a']) {
    const ks = []
    for (let p = start[i]; p < start[i + 1]; p++) if (mode === 'a' || SFW[order[p]]) ks.push(order[p])
    if (ks.length < MIN_POSTS) continue
    const st = stats[mode]
    const norm = ks.map((k) => [S[k] / st[M[k]][0], FAM[k]]).sort((x, y) => y[0] - x[0])
    const fams = new Set()
    const best = []
    for (const [v, f] of norm) {
      if (fams.has(f)) continue
      fams.add(f)
      best.push(v)
      if (best.length >= TOP_N) break
    }
    let hits = 0
    let total = 0
    for (const k of ks) {
      total += S[k]
      if (S[k] >= st[M[k]][1]) hits++
    }
    row[mode] = { rep: round(median(best), 2), hit: round((hits + PRIOR * HIT_SHARE) / (ks.length + PRIOR), 3), total }
  }
  if (row.s || row.a) {
    out[rows0[i][0]] = row
    ranked++
  }
}
mkdirSync('data/raw/artists', { recursive: true })
writeFileSync(OUT, JSON.stringify({ v: 1, source: 'isek-ai/danbooru-tags-2024', until: '2024-12', rows: out }))
console.log(`写入 ${OUT}：${ranked} 个画师（名单 ${names.length} 个）`)
