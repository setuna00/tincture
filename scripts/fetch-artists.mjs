import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { POP_ALGOS, rankOrder } from '../src/lib/artist-rank.ts'

const API = 'https://danbooru.donmai.us'
const UA = 'PromptEditor/0.37 (artist library build script)'
const DIR = 'data/raw/artists'
const MIN_POSTS = 50
const arg = (name, def) => {
  const i = process.argv.indexOf(name)
  return i >= 0 ? process.argv[i + 1] : def
}
const TOP = Number(arg('--top', 2000))
const POP = Number(arg('--pop', 1000))
const force = new Set(process.argv.flatMap((a, i) => (process.argv[i - 1] === '--force' ? [a] : [])))
mkdirSync(DIR, { recursive: true })

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let last = 0
let requests = 0
async function get(path) {
  for (let attempt = 0; ; attempt++) {
    const wait = last + 1050 - Date.now()
    if (wait > 0) await sleep(wait)
    last = Date.now()
    requests++
    let res
    try {
      res = await fetch(API + path, { headers: { 'User-Agent': UA } })
    } catch (e) {
      res = { ok: false, status: `网络错误 ${e.message}` }
    }
    if (res.ok) return res.json()
    const retry = typeof res.status !== 'number' || res.status === 429 || res.status >= 500
    if (!retry) throw new Error(`${res.status} ${path}`)
    const back = Math.min(2000 * 2 ** attempt, 300_000)
    console.warn(`  ${res.status}，${back / 1000}s 后重试：${path.slice(0, 100)}`)
    await sleep(back)
  }
}
const q = (params) => new URLSearchParams(params).toString()
const file = (name) => `${DIR}/${name}`
const readJson = (name) => JSON.parse(readFileSync(file(name), 'utf8'))
const done = (name) => existsSync(file(name)) && !force.has(name.replace(/\..*$/, ''))

if (!done('list.json')) {
  const rows = []
  for (let page = 1; ; page++) {
    const got = await get(`/tags.json?${q({ 'search[category]': 1, 'search[post_count]': `>=${MIN_POSTS}`, 'search[order]': 'count', limit: 1000, page, only: 'name,post_count' })}`)
    rows.push(...got.map((t) => [t.name, t.post_count]))
    process.stdout.write(`名单 ${rows.length} `)
    if (got.length < 1000) break
  }
  writeFileSync(file('list.json'), JSON.stringify({ fetchedAt: new Date().toISOString().slice(0, 10), rows }))
  console.log(`\n写入 ${file('list.json')}：${rows.length} 个画师`)
}
const list = readJson('list.json')

if (!done('profiles.json')) {
  const out = {}
  for (let page = 1; ; page++) {
    const got = await get(`/artists.json?${q({ 'search[order]': 'post_count', 'search[is_deleted]': 'false', limit: 1000, page, only: 'name,other_names,is_banned,urls[url,is_active],tag[post_count]' })}`)
    for (const a of got) {
      if ((a.tag?.post_count ?? 0) < MIN_POSTS) continue
      out[a.name] = { o: a.other_names ?? [], u: (a.urls ?? []).filter((u) => u.is_active).map((u) => u.url), ...(a.is_banned ? { b: 1 } : {}) }
    }
    process.stdout.write(`档案 ${Object.keys(out).length} `)
    if (got.length < 1000 || (got.at(-1)?.tag?.post_count ?? 0) < MIN_POSTS) break
  }
  writeFileSync(file('profiles.json'), JSON.stringify(out))
  console.log(`\n写入 ${file('profiles.json')}：${Object.keys(out).length} 个档案`)
}

const KIND_GROUPS = [
  ['look', 'body_parts'],
  ['style', 'image_composition'],
  ['scene', 'locations real_world_locations water fire flowers food_tags technology doors_and_gates holding_tags audio_tags cats dogs birds symbols'],
  ['outfit', 'attire accessories headwear eyewear neck_and_neckwear legwear handwear sleeves sexual_attire prints fashion_style patterns'],
  ['look', 'breasts_tags eyes_tags face_tags hair hair_styles hair_color skin_color ears_tags wings ass feet hands shoulders makeup nudity legendary_creatures'],
  ['style', 'visual_aesthetic artistic_license lighting backgrounds'],
]
if (!done('meta.json')) {
  const totalPosts = (await get('/counts/posts.json')).counts.posts
  const kinds = {}
  for (const [kind, groups] of KIND_GROUPS)
    for (const g of groups.split(' ')) {
      const [page] = await get(`/wiki_pages.json?${q({ 'search[title]': 'tag_group:' + g, only: 'body' })}`)
      if (!page) continue
      for (const [, link] of page.body.matchAll(/\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g)) {
        const t = link.trim().toLowerCase().replace(/ /g, '_')
        if (t.includes(':') || (g === 'backgrounds' && !t.includes('background'))) continue
        if (!kinds[t]) kinds[t] = kind
      }
    }
  console.log(`分组：${Object.keys(kinds).length} 个 tag`)
  const implies = {}
  for (let page = 1; ; page++) {
    const got = await get(`/tag_implications.json?${q({ 'search[status]': 'active', limit: 1000, page, only: 'antecedent_name,consequent_name' })}`)
    for (const r of got) (implies[r.antecedent_name] ??= []).push(r.consequent_name)
    process.stdout.write(`蕴含 ${Object.keys(implies).length} `)
    if (got.length < 1000) break
  }
  writeFileSync(file('meta.json'), JSON.stringify({ fetchedAt: new Date().toISOString().slice(0, 10), totalPosts, kinds, implies }))
  console.log(`\n写入 ${file('meta.json')}：全站 ${totalPosts} 张`)
}

const ONLY = 'id,md5,file_ext,rating,image_width,image_height,parent_id,has_large'
/** Post tuples are [id, md5, extension, width, height, hasSample(1/0), rating, parentId(0 if absent)]; preserve this order. */
const usable = (p) => p.md5 && p.file_ext !== 'swf'
const pack = (p) => [p.id, p.md5, p.file_ext, p.image_width, p.image_height, p.has_large ? 1 : 0, p.rating, p.parent_id ?? 0]
async function related(query) {
  const seen = new Map()
  for (const order of ['Frequency', 'Cosine'])
    for (const r of (await get(`/related_tag.json?${q({ 'search[query]': query, 'search[category]': 'general', 'search[order]': order, limit: 100 })}`)).related_tags)
      if (r.frequency >= 0.04 && !seen.has(r.tag.name)) seen.set(r.tag.name, [r.tag.name, Math.round(r.frequency * 1000) / 1000, r.tag.post_count])
  return [...seen.values()]
}

const TOP_FILE = file('top.jsonl')
const have = new Set(
  existsSync(TOP_FILE) && !force.has('top')
    ? readFileSync(TOP_FILE, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((l) => JSON.parse(l).tag)
    : [],
)
if (force.has('top')) writeFileSync(TOP_FILE, '')
const want = new Set(list.rows.slice(0, TOP).map((_, i) => i))
if (existsSync(file('popularity.json'))) {
  const pop = readJson('popularity.json').rows
  for (const algo of POP_ALGOS)
    for (const mode of ['s', 'a']) for (const i of rankOrder(list.rows.map(([tag]) => pop[tag]?.[mode]?.[algo] ?? null)).slice(0, POP)) want.add(i)
}
const targets = [...want].sort((a, b) => a - b).map((i) => list.rows[i])
const todo = targets.filter(([tag]) => !have.has(tag))
console.log(`预存 ${targets.length} 个（作品数前 ${TOP} + 各人气前 ${POP}）：已有 ${have.size}，还要抓 ${todo.length}`)
const t0 = Date.now()
const r0 = requests
for (const [i, [tag, postCount]] of todo.entries()) {
  const top200 = (await get(`/posts.json?${q({ tags: `${tag} order:score`, limit: 200, only: ONLY })}`)).filter(usable)
  const all = top200.slice(0, 40)
  let sfw = top200.filter((p) => p.rating === 'g' || p.rating === 's').slice(0, 40)
  if (sfw.length < 40 && top200.length >= 190) sfw = (await get(`/posts.json?${q({ tags: `${tag} rating:g,s order:score`, limit: 40, only: ONLY })}`)).filter(usable)
  const nsfwCount = (await get(`/counts/posts.json?${q({ tags: `${tag} rating:q,e` })}`)).counts.posts
  const relAll = await related(tag)
  const relSfw = nsfwCount === 0 ? relAll : await related(`${tag} rating:g,s`)
  appendFileSync(TOP_FILE, JSON.stringify({ tag, postCount, nsfwCount, posts: { sfw: sfw.map(pack), all: all.map(pack) }, related: { sfw: relSfw, all: relAll } }) + '\n')
  const n = i + 1
  const per = (Date.now() - t0) / n
  if (n % 10 === 0 || n === todo.length)
    console.log(`${have.size + n}/${targets.length} ${tag}（${postCount} 作品，NSFW ${nsfwCount}，图 ${sfw.length}/${all.length}）· 每人 ${((requests - r0) / n).toFixed(1)} 个请求 · 还要约 ${Math.round((per * (todo.length - n)) / 60000)} 分钟`)
}
if (todo.length) writeFileSync(file('top-fetched-at.txt'), new Date().toISOString())
console.log(`完成：这次 ${requests} 个请求，${Math.round((Date.now() - t0) / 60000)} 分钟`)
