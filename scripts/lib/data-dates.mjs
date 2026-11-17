import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const OUT = 'src/assets/data-dates.json'
const RAW = 'data/raw'

const pad = (n) => String(n).padStart(2, '0')
const localDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const stamp = (s) => (/^\d{4}-\d{2}-\d{2}$/.test(s.trim()) ? s.trim() : localDate(new Date(s.trim())))
const mtime = (file) => localDate(statSync(file).mtime)
const git = (args) => execFileSync('git', args, { encoding: 'utf8' }).trim()
const gitDate = (paths) => (git(['status', '--porcelain', '--', ...paths]) ? localDate(new Date()) : git(['log', '-1', '--format=%cs', '--', ...paths]))

export const SOURCES = {
  tags: () => stamp(readFileSync(`${RAW}/danbooru/fetched-at.txt`, 'utf8')),
  naiOld: () => gitDate(['data/tags/nai-old.tsv']),
  ratings: () => '2024-12',
  cooc: () => '2025-05',
  tree: () => gitDate(['data/tags/tree', 'data/tags/nsfw.tsv']),
  zh: () => gitDate(['data/zh', ':!data/zh/wiki.tsv', ':!data/zh/wiki-style.md']),
  wiki: () => gitDate(['data/zh/wiki.tsv', 'data/zh/wiki-style.md']),
  chars: () => '2024-12',
  artists: () => stamp(JSON.parse(readFileSync(`${RAW}/artists/list.json`, 'utf8')).fetchedAt),
  artistsPop: () => '2024-12',
  artistsTop: () => (existsSync(`${RAW}/artists/top-fetched-at.txt`) ? stamp(readFileSync(`${RAW}/artists/top-fetched-at.txt`, 'utf8')) : mtime(`${RAW}/artists/top.jsonl`)),
  tokenizer: () => mtime(`${RAW}/qwen35-tokenizer.json`),
  tokenizerT5: () => mtime(`${RAW}/t5-tokenizer.json`),
}

export function writeDataDates(keys) {
  const cur = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : {}
  for (const k of keys) {
    if (!SOURCES[k]) throw new Error(`data-dates：没有 ${k}`)
    cur[k] = SOURCES[k]()
  }
  const ordered = Object.fromEntries(Object.keys(SOURCES).filter((k) => k in cur).map((k) => [k, cur[k]]))
  writeFileSync(OUT, `${JSON.stringify(ordered, null, 2)}\n`)
  console.log(`${OUT}：${keys.map((k) => `${k} ${cur[k]}`).join(' · ')}`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const keys = process.argv.slice(2)
  writeDataDates(keys.length ? keys : Object.keys(SOURCES))
}
