// Alias rows share the artist list's row order; reordering either independently associates aliases with the wrong artist.
// pre contains artist-list row indices in cached-shard order; it need not be a contiguous prefix of the list.
// Popularity columns share the artist list's row order; s covers general/sensitive posts and a covers all ratings.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { gunzipSync, gzipSync } from 'node:zlib'
import { artistTopics, cleanOtherNames, dedupePosts, fromTag, pickSiteUrls } from '../src/lib/danbooru-core.ts'
import { POP_ALGOS } from '../src/lib/artist-rank.ts'
import { writeDataDates } from './lib/data-dates.mjs'

const RAW = 'data/raw/artists'
const OUT = 'src/assets/artists'
const SHARD = 100
const read = (f) => JSON.parse(readFileSync(`${RAW}/${f}`, 'utf8'))
const list = read('list.json')
const profiles = read('profiles.json')
const meta = read('meta.json')
mkdirSync(OUT, { recursive: true })
const write = (name, obj) => {
  const buf = gzipSync(JSON.stringify(obj), { level: 9 })
  writeFileSync(`${OUT}/${name}`, buf)
  return buf.length
}
const kb = (n) => `${(n / 1024).toFixed(0)} KB`

const tags = list.rows.map(([tag]) => tag)
const index = new Map(tags.map((t, i) => [t, i]))
const nsfwOnly = new Set(
  readFileSync('data/artists/nsfw-only.txt', 'utf8')
    .split('\n')
    .filter((l) => l && !l.startsWith('#')),
)
const flagged = (pred) => tags.flatMap((t, i) => (pred(t) ? [i] : []))
const top = existsSync(`${RAW}/top.jsonl`)
  ? new Map(
      readFileSync(`${RAW}/top.jsonl`, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((l) => JSON.parse(l))
        .map((r) => [r.tag, r]),
    )
  : new Map()
const pre = tags.flatMap((t, i) => (top.has(t) ? [i] : []))
const onlyNsfw = (t) => (top.has(t) ? top.get(t).posts.sfw.length === 0 : nsfwOnly.has(fromTag(t)))
const listSize = write('list.json.gz', {
  v: 1,
  fetchedAt: list.fetchedAt,
  names: tags.map(fromTag).join('\n'),
  counts: list.rows.map(([, n]) => n),
  nsfwOnly: flagged(onlyNsfw),
  banned: flagged((t) => profiles[t]?.b),
  pre,
  shard: SHARD,
})

const aliasSize = write('aliases.json.gz', { v: 1, rows: tags.map((t) => cleanOtherNames(profiles[t]?.o ?? []).join('\t')).join('\n') })

const lookup = JSON.parse(gunzipSync(readFileSync('src/assets/tags/lookup.json.gz')))
const general = new Set(lookup.rows.filter((r) => ['general', 'meta'].includes(lookup.cats[r[2]])).map((r) => r[0].replace(/ /g, '_')))
const implies = Object.fromEntries(
  Object.entries(meta.implies)
    .filter(([a]) => general.has(a))
    .map(([a, bs]) => [a, bs.filter((b) => general.has(b))])
    .filter(([, bs]) => bs.length),
)
const topicMeta = { totalPosts: meta.totalPosts, kinds: meta.kinds, implies }
const metaSize = write('topic-meta.json.gz', { v: 1, fetchedAt: meta.fetchedAt, ...topicMeta })

// Packed scores use rep x100 and hit x1000; total is unscaled and null means unranked.
const POP_FILE = `${RAW}/popularity.json`
const SCALE = { rep: 100, hit: 1000, total: 1 }
let popSize = 0
if (existsSync(POP_FILE)) {
  const pop = read('popularity.json')
  const col = (algo, mode) => tags.map((t) => {
    const v = pop.rows[t]?.[mode]?.[algo]
    return typeof v === 'number' ? Math.round(v * SCALE[algo]) : null
  })
  popSize = write('popularity.json.gz', { v: 1, until: pop.until, algos: Object.fromEntries(POP_ALGOS.map((a) => [a, { s: col(a, 's'), a: col(a, 'a') }])) })
}

const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i])
let shardBytes = 0
const shards = Math.ceil(pre.length / SHARD)
for (let k = 0; k < shards; k++) {
  const rows = pre.slice(k * SHARD, (k + 1) * SHARD).map((i) => {
    const t = tags[i]
    const r = top.get(t)
    // s and a index a shared post table; parent ids can be zeroed only after parent-family deduplication.
    const asPost = (p) => ({ id: p[0], parent: p[7] || undefined, p })
    const sfw = dedupePosts(r.posts.sfw.map(asPost)).map((x) => x.p)
    const all = dedupePosts(r.posts.all.map(asPost)).map((x) => x.p)
    const posts = []
    const at = new Map()
    for (const p of [...all, ...sfw])
      if (!at.has(p[0])) {
        at.set(p[0], posts.length)
        posts.push([...p.slice(0, 7), 0])
      }
    const topicsAll = artistTopics(r.related.all, topicMeta)
    const topicsSfw = artistTopics(r.related.sfw, topicMeta)
    return {
      p: posts,
      s: sfw.map((p) => at.get(p[0])),
      a: all.map((p) => at.get(p[0])),
      // Omitted t.a means both modes share t.s; consumers depend on this fallback.
      t: same(topicsSfw, topicsAll) ? { s: topicsSfw } : { s: topicsSfw, a: topicsAll },
      n: r.nsfwCount,
      u: pickSiteUrls(profiles[t]?.u ?? []),
    }
  })
  shardBytes += write(`top-${k}.json.gz`, { v: 1, rows })
}
console.log(
  `名单 ${tags.length} 个（只有 NSFW ${flagged(onlyNsfw).length}、被封 ${flagged((t) => profiles[t]?.b).length}）${kb(listSize)} · 别名 ${kb(aliasSize)} · 题材数据 ${kb(metaSize)}（分组 ${Object.keys(meta.kinds).length}、蕴含 ${Object.keys(implies).length}）· 人气 ${kb(popSize)} · 预存 ${pre.length} 个 ${shards} 片 ${kb(shardBytes)}`,
)
writeDataDates(['artists', ...(existsSync(`${RAW}/top.jsonl`) ? ['artistsTop'] : []), ...(popSize ? ['artistsPop'] : [])])
