// The pinned Apache-2.0 Qwen3.5 tokenizer supplies the vocabulary, merges and added tokens used by NAI V5.
// NAI expects the split regex translated to JavaScript and all added tokens in id order; preserve both when rebuilding.
// Counting needs only merges because every byte symbol and merge result exists in the vocabulary; retain the checks proving this.
// The raw-deflate UTF-8 payload starts with a JSON config/specialTokens/source header, then a b merge lines; readers require that layout.
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { deflateRawSync } from 'node:zlib'
import { writeDataDates } from './lib/data-dates.mjs'

const SRC = 'https://huggingface.co/Qwen/Qwen3.5-0.8B/resolve/2fc06364715b967f1860aea9cf38778875588b17/tokenizer.json'
const SHA256 = '5f9e4d4901a92b997e463c1f46055088b6cca5ca61a6522d1b9f64c4bb81cb42'
const input = process.argv[2] ?? 'data/raw/qwen35-tokenizer.json'
const output = 'src/assets/qwen35-merges.bin'

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
const tok = JSON.parse(readFileSync(input, 'utf8'))

/** Rust and JavaScript disagree on whitespace (U+0085/U+FEFF), and JavaScript lacks scoped (?i:...) here; translate both to preserve tokenization. */
const WS = '\\t-\\r \\u0085\\u00A0\\u1680\\u2000-\\u200A\\u2028\\u2029\\u202F\\u205F\\u3000'
function rustRegexToJs(re) {
  const CI = "(?i:'s|'t|'re|'ve|'m|'ll|'d)"
  if (!re.includes(CI)) throw new Error(`切词规则变了：${re}`)
  re = re.replace(CI, "(?:'([sS]|[tT]|[rR][eE]|[vV][eE]|[mM]|[lL][lL]|[dD]))")
  let out = ''
  let inClass = false
  for (let i = 0; i < re.length; i++) {
    const c = re[i]
    if (c === '\\') {
      const n = re[i + 1]
      if (n === 's') out += inClass ? WS : `[${WS}]`
      else if (n === 'S') {
        if (inClass) throw new Error('\\S inside a character class')
        out += `[^${WS}]`
      } else out += c + n
      i++
      continue
    }
    if (c === '[' && !inClass) inClass = true
    else if (c === ']' && inClass) inClass = false
    out += c
  }
  return out
}

const fail = (msg) => {
  throw new Error(`词表不满足前提：${msg}`)
}
if (tok.normalizer?.type !== 'NFC') fail(`normalizer 是 ${JSON.stringify(tok.normalizer)}`)
const pre = tok.pre_tokenizer
const [split, byteLevel] = pre?.pretokenizers ?? []
if (pre?.type !== 'Sequence' || pre.pretokenizers.length !== 2 || split.type !== 'Split' || split.behavior !== 'Isolated' || split.invert !== false || byteLevel.type !== 'ByteLevel' || byteLevel.use_regex !== false)
  fail(`pre_tokenizer 变了：${JSON.stringify(pre)}`)
const model = tok.model
if (model?.type !== 'BPE' || model.byte_fallback || model.dropout != null || model.continuing_subword_prefix || model.end_of_word_suffix) fail('不是普通的 byte-level BPE')
const added = [...tok.added_tokens].sort((a, b) => a.id - b.id)
const vocab = { ...model.vocab }
for (const t of added) vocab[t.content] = t.id
const def = {
  config: { splitRegex: rustRegexToJs(split.pattern.Regex), ignoreMerges: model.ignore_merges ?? false, normalization: tok.normalizer.type },
  specialTokens: added.map((t) => t.content),
  merges: model.merges.map((m) => (Array.isArray(m) ? m : m.split(' '))),
}
const keep = []
for (let b = 0x21; b <= 0x7e; b++) keep.push(b)
for (let b = 0xa1; b <= 0xac; b++) keep.push(b)
for (let b = 0xae; b <= 0xff; b++) keep.push(b)
let extra = 0
for (let b = 0; b < 256; b++) {
  const ch = keep.includes(b) ? String.fromCodePoint(b) : String.fromCodePoint(256 + extra++)
  if (vocab[ch] === undefined) fail(`字节 ${b} 的字符不在 vocab 里`)
}
if (Object.keys(vocab).some((k) => k.startsWith('0x'))) fail('vocab 里有 0x.. 字节 token')
for (const [a, b] of def.merges) {
  if (vocab[a + b] === undefined) fail(`合并结果 ${a}${b} 不在 vocab 里`)
  if (/[ \n]/.test(a + b)) fail(`merge 里有空格 / 换行：${JSON.stringify([a, b])}`)
}

const head = { config: def.config, specialTokens: def.specialTokens, source: SRC, merges: def.merges.length }
const body = `${JSON.stringify(head)}\n${def.merges.map(([a, b]) => `${a} ${b}`).join('\n')}`
const out = deflateRawSync(Buffer.from(body, 'utf8'), { level: 9 })
writeFileSync(output, out)
console.log(output, `${(out.length / 1024).toFixed(0)} KB`, `${def.merges.length} merges`, `vocab ${Object.keys(vocab).length}`)
if (!process.argv[2]) writeDataDates(['tokenizer'])
