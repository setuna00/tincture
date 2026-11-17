// Match NovelAI Qwen BPE: NFC, special-token split, regex split, then byte-level ranked merges; keep weights and omit boundary tokens.
// Every byte symbol and merge result exists in NovelAI's vocab, so counting final segments needs no vocab lookup.

export interface QwenDef {
  config: { splitRegex: string; normalization?: string }
  specialTokens: string[]
  merges: [string, string][]
}

function byteChars(): string[] {
  const keep: number[] = []
  for (let b = 0x21; b <= 0x7e; b++) keep.push(b)
  for (let b = 0xa1; b <= 0xac; b++) keep.push(b)
  for (let b = 0xae; b <= 0xff; b++) keep.push(b)
  const out: string[] = new Array(256)
  let extra = 0
  for (let b = 0; b < 256; b++) out[b] = keep.includes(b) ? String.fromCodePoint(b) : String.fromCodePoint(256 + extra++)
  return out
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

export interface TokenCounter {
  count(text: string): number
}

export function createQwenCounter(def: QwenDef): TokenCounter {
  const ranks = new Map<string, number>()
  def.merges.forEach(([a, b], i) => ranks.set(`${a}\0${b}`, i))
  const split = new RegExp(def.config.splitRegex, 'gu')
  const specials = def.specialTokens.length
    ? new RegExp(`(${[...def.specialTokens].sort((a, b) => b.length - a.length).map(escapeRe).join('|')})`)
    : null
  const norm = def.config.normalization
  const toChar = byteChars()
  const enc = new TextEncoder()
  const cache = new Map<string, number>()

  const bpe = (word: string): number => {
    const hit = cache.get(word)
    if (hit !== undefined) return hit
    let parts = Array.from(enc.encode(word), (b) => toChar[b])
    while (parts.length > 1) {
      let best = Infinity
      let at = -1
      for (let i = 0; i < parts.length - 1; i++) {
        const r = ranks.get(`${parts[i]}\0${parts[i + 1]}`)
        if (r !== undefined && r < best) {
          best = r
          at = i
        }
      }
      if (at < 0) break
      const a = parts[at]
      const b = parts[at + 1]
      const next: string[] = []
      for (let i = 0; i < parts.length; ) {
        if (i < parts.length - 1 && parts[i] === a && parts[i + 1] === b) {
          next.push(a + b)
          i += 2
        } else next.push(parts[i++])
      }
      parts = next
    }
    if (cache.size > 50_000) cache.clear()
    cache.set(word, parts.length)
    return parts.length
  }

  return {
    count(text) {
      if (!text) return 0
      const s = norm ? text.normalize(norm) : text
      let n = 0
      const chunks = specials ? s.split(specials) : [s]
      chunks.forEach((chunk, i) => {
        if (i % 2 === 1) return void n++
        if (!chunk) return
        for (const m of chunk.matchAll(split)) n += bpe(m[0])
      })
      return n
    },
  }
}

/** qwen35-merges.bin is raw deflate: one JSON config/special-token header line, then one 'a b' merge per line. */
export async function loadQwenDef(bytes: ArrayBuffer | Uint8Array): Promise<QwenDef> {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
  const text = await new Response(stream).text()
  const nl = text.indexOf('\n')
  const head = JSON.parse(text.slice(0, nl)) as Omit<QwenDef, 'merges'>
  const merges = text
    .slice(nl + 1)
    .split('\n')
    .map((l) => {
      const sp = l.indexOf(' ')
      return [l.slice(0, sp), l.slice(sp + 1)] as [string, string]
    })
  return { config: head.config, specialTokens: head.specialTokens, merges }
}
