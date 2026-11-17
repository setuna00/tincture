// The pinned Apache-2.0 google/t5_xxl_true_nli_mixture tokenizer supplies the T5 vocabulary used by NAI V4/V4.5.
// Keep the printed scores at full precision; t5-base float32 scores differ in the last digit and can change NAI token counts.
// NAI's T5 normalizer returns input unchanged despite declaring Precompiled; applying the charsmap would change token counts.
// The raw-deflate UTF-8 payload starts with a JSON header, then score<TAB>piece lines in token-id order; preserve this layout.
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { deflateRawSync } from 'node:zlib'
import { writeDataDates } from './lib/data-dates.mjs'

const SRC = 'https://huggingface.co/google/t5_xxl_true_nli_mixture/resolve/aa6cfe1dd4257853bfdd772992045f41bfc14988/tokenizer.json'
const SHA256 = '5f0ed8ab5b8cfa9812bb73752f1d80c292e52bcf5a87a144dc9ab2d251056cbb'
const input = process.argv[2] ?? 'data/raw/t5-tokenizer.json'
const output = 'src/assets/t5-vocab.bin'

if (!existsSync(input)) {
  console.log('下载', SRC)
  const r = await fetch(SRC, { headers: { 'user-agent': 'tincture-build-script' } })
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  const bytes = Buffer.from(await r.arrayBuffer())
  const sha = createHash('sha256').update(bytes).digest('hex')
  if (sha !== SHA256) throw new Error(`sha256 不对：${sha}`)
  mkdirSync('data/raw', { recursive: true })
  writeFileSync(input, bytes)
}
const def = JSON.parse(readFileSync(input, 'utf8'))

const fail = (msg) => {
  throw new Error(`词表不满足前提：${msg}`)
}
if (def.normalizer?.type !== 'Precompiled') fail(`normalizer 是 ${def.normalizer?.type}`)
const pre = def.pre_tokenizer
if (pre?.type !== 'Sequence' || pre.pretokenizers?.[0]?.type !== 'WhitespaceSplit' || pre.pretokenizers?.[1]?.type !== 'Metaspace' || pre.pretokenizers[1].replacement !== '▁' || pre.pretokenizers[1].add_prefix_space !== true || pre.pretokenizers.length !== 2)
  fail(`pre_tokenizer 变了：${JSON.stringify(pre)}`)
if (def.model?.vocab?.[def.model.unk_id]?.[0] !== '<unk>') fail('unk_id 不是 <unk>')
if (def.model.vocab[1]?.[0] !== '</s>') fail('</s> 不是 1')
for (const [p, score] of def.model.vocab) {
  if (/[\n\r\t]/.test(p)) fail(`piece 里有换行 / tab：${JSON.stringify(p)}`)
  if ([...p].length !== p.length) fail(`piece 里有 BMP 以外的字：${JSON.stringify(p)}`)
  if (!Number.isFinite(score)) fail(`分数不是数：${JSON.stringify([p, score])}`)
}

const head = { unkId: def.model.unk_id, source: SRC, pieces: def.model.vocab.length }
const body = `${JSON.stringify(head)}\n${def.model.vocab.map(([p, score]) => `${score}\t${p}`).join('\n')}`
const out = deflateRawSync(Buffer.from(body, 'utf8'), { level: 9 })
writeFileSync(output, out)
console.log(output, `${(out.length / 1024).toFixed(0)} KB`, `${def.model.vocab.length} pieces`)
if (!process.argv[2]) writeDataDates(['tokenizerT5'])
