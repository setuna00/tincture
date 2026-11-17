import { beforeAll, describe, expect, it } from 'vitest'
import { createQwenCounter, loadQwenDef, type QwenDef, type TokenCounter } from './qwen-tokenizer'

const { readFileSync, existsSync } = (await import(/* @vite-ignore */ `node:${'fs'}`)) as { readFileSync(p: URL): Uint8Array; existsSync(p: URL): boolean }
const FILE = new URL('../assets/qwen35-merges.bin', import.meta.url)
const NAI_DEF = new URL('../../data/raw/qwen35_tokenizer.def', import.meta.url)

/** Reference encoding follows NovelAI's encoder Worker BPE, retaining vocab lookup to check the count-only implementation. */
function naiReference(def: QwenDef, vocab?: Record<string, number>) {
  const has = (p: string) => !vocab || vocab[p] !== undefined
  const id = (p: string) => (vocab ? vocab[p] : -1)
  const encoder: Record<string, number> = Object.assign(Object.create(null), vocab ?? Object.fromEntries(def.specialTokens.map((t) => [t, -1])))
  const specials: Record<string, number> = Object.create(null)
  for (const s of def.specialTokens) specials[s] = encoder[s]
  const range = (a: number, b: number) => [...Array.from({ length: b }).keys()].slice(a)
  const code = (c: string) => c.charCodeAt(0)
  const byteToChar: Record<number, string> = (() => {
    const e = [...range(code('!'), code('~') + 1), ...range(code('\xa1'), code('\xac') + 1), ...range(code('\xae'), code('\xff') + 1)]
    const t = [...e]
    let r = 0
    for (let s = 0; s < 256; s++) {
      if (e.includes(s)) continue
      e.push(s)
      t.push(256 + r)
      r += 1
    }
    const out: Record<number, string> = {}
    e.forEach((b, i) => (out[b] = String.fromCodePoint(t[i])))
    return out
  })()
  const ranks = new Map<string, number>()
  def.merges.forEach(([a, b], i) => ranks.set(a + '\0' + b, i))
  type Node = { char: string; children: Node[]; value?: string }
  const tree: Node = { char: '', children: [] }
  for (const [tok] of Object.entries(specials).sort((a, b) => b[0].length - a[0].length)) {
    let n = tree
    for (const ch of tok) {
      let next = n.children.find((c) => c.char === ch)
      if (!next) n.children.push((next = { char: ch, children: [] }))
      n = next
    }
    n.value = tok
  }
  const splitRegex = new RegExp(def.config.splitRegex, 'gu')
  const splitWords = (e: string) => {
    let t: Node | undefined
    const r: string[] = []
    let i = ''
    let o = ''
    let l = tree
    const h = () => {
      if (i) {
        for (const m of [...i.matchAll(splitRegex)].map((x) => x[0])) r.push(m)
        i = ''
      }
      if (o) {
        r.push(o)
        o = ''
        l = tree
      }
    }
    let c = 0
    while (c < e.length) {
      const ch = e[c]
      let n = false
      for (const child of l.children)
        if (child.char === ch) {
          l = child
          n = true
          break
        }
      if (n) {
        o += ch
        c++
      } else if (o.length === 0) {
        i += ch
        c++
      } else if (t) {
        if (t.value) {
          const rest = o.slice(t.value.length)
          o = t.value
          c -= rest.length
          t = undefined
          h()
        }
      } else {
        i += o[0]
        c -= o.length - 1
        o = ''
        l = tree
      }
      if (l.value && o === l.value) t = l
    }
    if (o)
      if (t?.value) {
        const rest = o.slice(t.value.length)
        o = t.value
        h()
        i = rest
      } else {
        i += o
        o = ''
      }
    h()
    return r
  }
  const rankedPairs = (word: string[]) => {
    const out: { rank: number; left: string; right: string }[] = []
    let prev = word[0]
    for (let s = 1; s < word.length; s++) {
      const cur = word[s]
      const rank = ranks.get(prev + '\0' + cur) ?? Infinity
      let k = 0
      while (k < out.length && out[k].rank < rank) k++
      if (!(k < out.length && out[k].rank === rank)) out.splice(k, 0, { rank, left: prev, right: cur })
      prev = cur
    }
    return out
  }
  const toBPE = (e: string): number[] => {
    let t = [...e]
    let r = rankedPairs(t)
    if (r.length === 0) return has(e) ? [id(e)] : []
    for (;;) {
      const { left, right } = r[0]
      if (!ranks.has(left + '\0' + right)) break
      let next: string[] = []
      let o = 0
      while (o < t.length) {
        const at = t.indexOf(left, o)
        if (at === -1) {
          next = [...next, ...t.slice(o)]
          break
        }
        next = [...next, ...t.slice(o, at)]
        o = at
        if (t[o] === left && o < t.length - 1 && t[o + 1] === right) {
          next.push(left + right)
          o += 2
        } else {
          next.push(t[o])
          o += 1
        }
      }
      t = next
      if (t.length === 1) break
      r = rankedPairs(t)
    }
    return t.filter(has).map(id)
  }
  const enc = new TextEncoder()
  return (text: string): number[] => {
    const s = def.config.normalization ? text.normalize(def.config.normalization) : text
    const ids: number[] = []
    for (const w of splitWords(s)) {
      if (specials[w] !== undefined) ids.push(specials[w])
      else ids.push(...toBPE([...enc.encode(w)].map((b) => byteToChar[b]).join('')))
    }
    return ids
  }
}

let def: QwenDef
let nai: (QwenDef & { vocab: Record<string, number> }) | null = null
let counter: TokenCounter
let ref: (s: string) => number[]

beforeAll(async () => {
  def = await loadQwenDef(readFileSync(FILE))
  counter = createQwenCounter(def)
  if (existsSync(NAI_DEF)) {
    const stream = new Blob([readFileSync(NAI_DEF) as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
    nai = JSON.parse(await new Response(stream).text())
  }
  ref = naiReference(nai ?? def, nai?.vocab)
}, 60_000)

const CORPUS = [
  '',
  '1girl',
  'very aesthetic, masterpiece, no text',
  '2girls, multiple girls, looking at viewer, smile, cowboy shot, outdoors, 1.2::cherry blossoms, petals::, blue sky, day, depth of field, 0.8::light particles::, 1.1::artist:mika pikazo::, artist:ciloranko, 0.7::artist:kantoku::, year 2024, very aesthetic, masterpiece, high complexity, absurdres, very aesthetic, masterpiece, no text',
  'nsfw, lowres, artistic error, film grain, scan artifacts, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, dithering, halftone, screentone, multiple views, logo, too many watermarks, negative space, blank page, -1::monochrome::, sketch, 3d',
  '{worst quality}, {{grandfathered content}}, [sketch background], [[horror (theme)]], ych (character), 0::ai-generated::',
  'girl, fern (sousou no frieren), purple hair, mutual#hug, source#kiss, target#hug',
  'Text: Hello, world!\n\nIs this ok?',
  '樱花下的少女，银色长发，看着镜头',
  '桜の下で、銀髪の少女が微笑む',
  'café, naïve, Ｆｕｌｌ　ｗｉｄｔｈ, é',
  '😀 emoji, 👩‍👩‍👧 family, ✨sparkles✨',
  '   leading spaces,,, trailing   \t\n',
  "it's, they're, I'd, we'll, you've",
  '<|endoftext|>1girl<|im_start|>smile<think>',
  'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  '12345678901234567890, 1.05::a::, -0.5::b::, ::',
]

describe('Qwen 计数（V5）', () => {
  it('和 NAI 的原文件一样（有原文件时）：merges、special token、切词规则', ({ skip }) => {
    if (!nai) return skip()
    expect(def.merges).toEqual(nai.merges)
    expect(def.specialTokens).toEqual(nai.specialTokens)
    expect(def.config).toEqual(nai.config)
    expect(nai.merges.every(([a, b]) => nai!.vocab[a + b] !== undefined)).toBe(true)
  })

  it('和 NAI 原算法逐条一致', () => {
    for (const s of CORPUS) expect(counter.count(s), JSON.stringify(s)).toBe(ref(s).length)
  })

  it('已知的数（NAI 原算法跑出来的）', () => {
    expect(counter.count('very aesthetic, masterpiece, no text')).toBe(7)
    expect(counter.count('1girl')).toBe(2)
    expect(counter.count('樱花下的少女，银色长发')).toBe(6)
  })

  it('qwen35-merges.bin 解压出来的结构', () => {
    expect(def.config.normalization).toBe('NFC')
    expect(def.specialTokens).toContain('<|endoftext|>')
    expect(def.merges.length).toBe(247_587)
    expect(def.merges.every((m) => m.length === 2 && m[0] && m[1])).toBe(true)
  })
})
