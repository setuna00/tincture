// Source: isek-ai/danbooru-tags-2024 on Hugging Face (CC0-1.0); querying Danbooru per artist would take about 14 hours.
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { asyncBufferFromFile, parquetReadObjects } from 'hyparquet'
import { compressors } from 'hyparquet-compressors'

const SRC = process.env.POSTS_DIR ?? 'data/raw/posts-2024'
const MIN = 10
// Dataset artist names use spaces; preserve the same normalization as the artist list when matching them.
const names = new Set(JSON.parse(readFileSync('data/raw/artists/list.json', 'utf8')).rows.map(([tag]) => tag.replace(/_/g, ' ')))
const counts = new Map()
let total = 0
for (const f of readdirSync(SRC).filter((f) => f.endsWith('.parquet')).sort()) {
  const rows = await parquetReadObjects({ file: await asyncBufferFromFile(`${SRC}/${f}`), columns: ['rating', 'artist'], compressors })
  for (const r of rows) {
    const sfw = r.rating === 'g' || r.rating === 's'
    if (!sfw && r.rating !== 'q' && r.rating !== 'e') continue
    total++
    for (const a of String(r.artist ?? '').split(', ')) {
      if (!names.has(a)) continue
      let c = counts.get(a)
      if (!c) counts.set(a, (c = [0, 0]))
      c[0]++
      if (sfw) c[1]++
    }
  }
  process.stdout.write('.')
}
const only = [...counts].filter(([, [n, sfw]]) => n >= MIN && sfw === 0).map(([a]) => a).sort()
mkdirSync('data/artists', { recursive: true })
writeFileSync(
  'data/artists/nsfw-only.txt',
  `# 一张一般 / 敏感作品都没有的画师（数据集里至少 ${MIN} 张）：scripts/build-artist-nsfw.mjs，HF isek-ai/danbooru-tags-2024（CC0，${total} 张，到 2024-12）\n` +
    `# 名单 ${names.size} 个里数据集有 ${counts.size} 个\n` +
    only.join('\n') +
    '\n',
)
console.log(`\n写入 data/artists/nsfw-only.txt：${only.length} 个（名单 ${names.size} 个，数据集里有 ${counts.size} 个）`)
