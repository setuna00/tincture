// Sources: Danbooru API (rate-limited, honest User-Agent); HDiffusion/historical-danbooru-tag-counts (Apache-2.0) for the oldest snapshot.
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'

const API = 'https://danbooru.donmai.us'
const UA = 'PromptEditor-tags/0.1 (local dev tool)'
const OUT = 'data/raw/danbooru'
const force = process.argv.includes('--force')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const q = (params) => new URLSearchParams(params).toString()

async function get(path) {
  for (let attempt = 0; ; attempt++) {
    await sleep(1100 * 2 ** attempt)
    const res = await fetch(API + path, { headers: { 'User-Agent': UA } })
    if (res.ok) return res.json()
    if (attempt >= 3 || (res.status < 500 && res.status !== 429)) throw new Error(`${res.status} ${path}`)
  }
}

/** Danbooru id-cursor pagination avoids skipped or repeated tags when post counts change during a download. */
async function all(path, params) {
  const out = []
  let cursor = ''
  for (;;) {
    const rows = await get(`${path}?${q({ ...params, limit: 1000, ...(cursor ? { page: 'b' + cursor } : {}) })}`)
    out.push(...rows)
    process.stdout.write('.')
    if (rows.length < 1000) return out
    cursor = rows[rows.length - 1].id
  }
}

let fetched = false
async function save(file, fetcher) {
  const path = `${OUT}/${file}`
  if (existsSync(path) && !force) return console.log('跳过（已有）', path)
  fetched = true
  const rows = await fetcher()
  writeFileSync(path, JSON.stringify(rows))
  console.log(`\n${path}：${rows.length} 条`)
}

mkdirSync(OUT, { recursive: true })
const tagFields = { only: 'id,name,post_count,category,is_deprecated' }
const tags = (category, min) => () =>
  all('/tags.json', { 'search[category]': category, 'search[post_count]': `>=${min}`, 'search[is_deprecated]': 'false', ...tagFields })

await save('tags-general.json', tags(0, 50))
await save('tags-meta.json', tags(5, 50))
await save('tags-copyright.json', tags(3, 100))
await save('tags-character.json', tags(4, 100))
// NAI V5 recognizes deprecated Danbooru tags even when current post counts are zero; keep them in the source universe.
await save('tags-deprecated.json', () => all('/tags.json', { 'search[is_deprecated]': 'true', ...tagFields }))
await save('aliases.json', () => all('/tag_aliases.json', { 'search[status]': 'active', only: 'id,antecedent_name,consequent_name,created_at' }))
await save('implications.json', () => all('/tag_implications.json', { 'search[status]': 'active', only: 'id,antecedent_name,consequent_name' }))
await save('tag-groups.json', () => all('/wiki_pages.json', { 'search[title_like]': 'tag_group:*', 'search[is_deleted]': 'false', only: 'id,title,body,other_names' }))
const SNAPSHOT = `${OUT}/snapshot-2026-01-05.csv`
if (!existsSync(SNAPSHOT) || force) {
  const res = await fetch('https://huggingface.co/datasets/HDiffusion/historical-danbooru-tag-counts/resolve/main/danbooru-2026-01-05.csv')
  if (!res.ok) throw new Error(`${res.status} 快照下载失败`)
  writeFileSync(SNAPSHOT, Buffer.from(await res.arrayBuffer()))
  console.log(SNAPSHOT)
}
if (fetched) writeFileSync(`${OUT}/fetched-at.txt`, new Date().toISOString())
console.log('完成')
