// Source: isek-ai/danbooru-tags-2024 on Hugging Face (CC0-1.0).
// TSV columns are tag, g/s/q/e counts, then g/s/q/e counts since June 2022; consumers depend on both groups.
// Only posts since June 2022 distinguish general from sensitive; older 's' means safe and cannot measure sensitive share.
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { asyncBufferFromFile, parquetReadObjects } from 'hyparquet'
import { compressors } from 'hyparquet-compressors'

const SRC = 'data/raw/posts-2024'
const R = { g: 0, s: 1, q: 2, e: 3 }
const SINCE = '2022-06'
const lookup = JSON.parse(gunzipSync(readFileSync('src/assets/tags/lookup.json.gz')))
const known = new Set(lookup.rows.filter((r) => ['general', 'meta'].includes(lookup.cats[r[2]])).map((r) => r[0]))

const counts = new Map()
const total = [0, 0, 0, 0, 0, 0, 0, 0]
const files = readdirSync(SRC).filter((f) => f.endsWith('.parquet')).sort()
for (const f of files) {
  const t0 = Date.now()
  const file = await asyncBufferFromFile(`${SRC}/${f}`)
  const rows = await parquetReadObjects({ file, columns: ['created_at', 'rating', 'general', 'meta'], compressors })
  for (const r of rows) {
    const i = R[r.rating]
    if (i === undefined) continue
    const recent = String(r.created_at) >= SINCE
    total[i]++
    if (recent) total[i + 4]++
    for (const col of [r.general, r.meta])
      for (const t of String(col ?? '').split(', ')) {
        if (!t) continue
        let c = counts.get(t)
        if (!c) counts.set(t, (c = [0, 0, 0, 0, 0, 0, 0, 0]))
        c[i]++
        if (recent) c[i + 4]++
      }
  }
  console.log(`${f}：${rows.length} 张，${Date.now() - t0}ms`)
}
const n = total.slice(0, 4).reduce((a, b) => a + b, 0)
const n2 = total.slice(4).reduce((a, b) => a + b, 0)
console.log(`2022-06 以后 ${n2} 张：g ${((total[4] / n2) * 100).toFixed(1)}% · s ${((total[5] / n2) * 100).toFixed(1)}% · q ${((total[6] / n2) * 100).toFixed(1)}% · e ${((total[7] / n2) * 100).toFixed(1)}%`)
console.log(`共 ${n} 张：g ${((total[0] / n) * 100).toFixed(1)}% · s ${((total[1] / n) * 100).toFixed(1)}% · q ${((total[2] / n) * 100).toFixed(1)}% · e ${((total[3] / n) * 100).toFixed(1)}%`)
const out = [...counts].filter(([t]) => known.has(t)).sort((a, b) => (a[0] < b[0] ? -1 : 1))
writeFileSync(
  'data/tags/ratings.tsv',
  `# 每个 tag 出现在 g / s / q / e 分级图里的次数；后四列只算 2022-06 以后的 ${n2} 张（scripts/build-ratings.mjs；数据 HF isek-ai/danbooru-tags-2024，CC0，${n} 张，2005 → 2024-12）\n` +
    out.map(([t, c]) => [t, ...c].join('\t')).join('\n') +
    '\n',
)
console.log(`写入 data/tags/ratings.tsv：${out.length} 个（tag 库通用 + 元信息共 ${known.size} 个）`)
