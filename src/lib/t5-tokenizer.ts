// NovelAI T5 ignores []{}, numeric :: weights, and normalization; even empty input contributes an </s> token.
// NovelAI prepends the SentencePiece marker (U+2581) to whitespace-split segments and encodes each independently.
import type { TokenCounter } from './qwen-tokenizer'

export interface T5Def {
  unkId: number
  pieces: string[]
  scores: number[]
}

interface Trie {
  next: Map<string, Trie>
  id: number
}

/** NovelAI splits at most six prompt-mix segments; pipes inside ||...|| do not split and segment six keeps the remainder. */
const MAX_PROMPT_MIX = 6
const KEEP = '\u{103b9}'
const KEEP2 = '\u{12137}'
export function splitPromptMix(text: string): string[] {
  const s = text
    .split('||')
    .map((x, i) => (i % 2 === 1 ? x.split('|').join(KEEP) : x))
    .join(KEEP2)
  const parts = s.split('|')
  const out = parts.slice(0, MAX_PROMPT_MIX - 1)
  if (parts.length > MAX_PROMPT_MIX - 1) out.push(parts.slice(MAX_PROMPT_MIX - 1).join('|'))
  return out.map((x) => x.replaceAll(KEEP, '|').replaceAll(KEEP2, '||'))
}

export function createT5Counter(def: T5Def): TokenCounter & { encodeLength(text: string): number } {
  const scores = Float64Array.from(def.scores)
  // NovelAI scores unknown pieces at the vocabulary's minimum score minus 10.
  let min = 1e6
  for (const s of def.scores) min = Math.min(min, s)
  const unkScore = min - 10
  scores[def.unkId] = unkScore
  const root: Trie = { next: new Map(), id: -1 }
  def.pieces.forEach((p, id) => {
    let node = root
    for (const ch of p) {
      let n = node.next.get(ch)
      if (!n) node.next.set(ch, (n = { next: new Map(), id: -1 }))
      node = n
    }
    // NovelAI tokenToIds uses the last occurrence of a duplicate piece.
    node.id = id
  })
  const cache = new Map<string, number>()

  const viterbi = (s: string): number => {
    const hit = cache.get(s)
    if (hit !== undefined) return hit
    const len = s.length
    const start: number[] = [0]
    const score: number[] = [0]
    const ends: number[][] = Array.from({ length: len + 1 }, () => [])
    const begins: number[][] = Array.from({ length: len + 1 }, () => [])
    ends[0].push(0)
    const insert = (pos: number, n: number, sc: number) => {
      const k = start.length
      start.push(pos)
      score.push(sc)
      begins[pos].push(k)
      ends[pos + n].push(k)
    }
    for (let r = 0; r < len; r++) {
      let single = false
      let node: Trie | undefined = root
      for (let k = r; k < len; k++) {
        node = node.next.get(s[k])
        if (!node) break
        if (node.id >= 0) {
          insert(r, k - r + 1, scores[node.id])
          if (k === r) single = true
        }
      }
      if (!single) insert(r, 1, unkScore)
    }
    const bt = new Float64Array(start.length)
    const cnt = new Int32Array(start.length)
    // NovelAI keeps the first inserted path on equal scores; changing tie-breaking can change token counts.
    const pick = (t: number, sc: number) => {
      let best = -1
      let val = 0
      for (const i of ends[t]) {
        const v = bt[i] + sc
        if (best < 0 || v > val) {
          best = i
          val = v
        }
      }
      return { best, val }
    }
    for (let t = 0; t < len; t++) {
      for (const k of begins[t]) {
        const { best, val } = pick(t, score[k])
        bt[k] = val
        cnt[k] = cnt[best] + 1
      }
    }
    const { best } = pick(len, 0)
    const n = len ? cnt[best] : 0
    if (cache.size > 50_000) cache.clear()
    cache.set(s, n)
    return n
  }

  const encodeLength = (text: string): number => {
    if (!text) return 1
    const t = text.replace(/[[\]{}]/g, '').replace(/-?\d*\.?\d*::/g, '')
    let n = 0
    for (const w of t.split(/\s+/)) {
      let p = w.replace(' ', '▁')
      if (!p.startsWith('▁')) p = `▁${p}`
      n += viterbi(p)
    }
    return n + 1
  }

  return {
    encodeLength,
    count: (text) => splitPromptMix(text).reduce((n, seg) => n + encodeLength(seg), 0),
  }
}

/** t5-vocab.bin is raw deflate: a JSON header (unkId, etc.), then one score-tab-piece record per line. */
export async function loadT5Def(bytes: ArrayBuffer | Uint8Array): Promise<T5Def> {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
  const text = await new Response(stream).text()
  const nl = text.indexOf('\n')
  const head = JSON.parse(text.slice(0, nl)) as { unkId: number }
  const pieces: string[] = []
  const scores: number[] = []
  for (const line of text.slice(nl + 1).split('\n')) {
    const tab = line.indexOf('\t')
    scores.push(Number(line.slice(0, tab)))
    pieces.push(line.slice(tab + 1))
  }
  return { unkId: head.unkId, pieces, scores }
}
