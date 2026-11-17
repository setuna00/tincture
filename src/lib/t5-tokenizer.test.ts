import { beforeAll, describe, expect, it } from 'vitest'
import { createT5Counter, loadT5Def, splitPromptMix, type T5Def } from './t5-tokenizer'

const { readFileSync, existsSync } = (await import(/* @vite-ignore */ `node:${'fs'}`)) as { readFileSync(p: URL): Uint8Array; existsSync(p: URL): boolean }
const { inflateRawSync } = (await import(/* @vite-ignore */ `node:${'zlib'}`)) as { inflateRawSync(b: Uint8Array): { toString(enc: string): string } }
const FILE = new URL('../assets/t5-vocab.bin', import.meta.url)
const NAI_DEF = new URL('../../data/raw/t5_tokenizer.def', import.meta.url)

type Cfg = { type: string; add_prefix_space?: boolean; replacement?: string; str_rep?: string; pretokenizers?: Cfg[] }
interface TokJson {
  added_tokens: { id: number; content: string }[]
  normalizer: Cfg
  pre_tokenizer: Cfg
  decoder: Cfg
  model: { unk_id: number; vocab: [string, number][] }
}

/** Reference encoding follows NovelAI loadEncoder's Unigram implementation, retaining token ids for independent count checks. */
function naiReference(json: TokJson) {
  type Proc = { normalize?(e: string): string; preTokenize?(e: string[]): string[] }
  const fromConfig = (e: Cfg): Proc => {
    switch (e.type) {
      case 'Metaspace': {
        const replacement = e.replacement!
        const strRep = e.str_rep || replacement
        return {
          preTokenize(list) {
            const t: string[] = []
            for (const n of list) {
              let s = n.replace(' ', strRep)
              if (e.add_prefix_space && !s.startsWith(replacement)) s = strRep + s
              t.push(s)
            }
            return t
          },
        }
      }
      case 'Precompiled':
        return { normalize: (s) => s }
      case 'Sequence': {
        const subs = e.pretokenizers!.map(fromConfig)
        return {
          preTokenize(list) {
            let t = list
            for (const p of subs) t = p.preTokenize!(t)
            return t
          },
        }
      }
      case 'WhitespaceSplit':
        return {
          preTokenize(list) {
            const t: string[] = []
            for (const n of list) t.push(...n.split(/\s+/))
            return t
          },
        }
      default:
        throw new Error('Unknown token processor type: ' + e.type)
    }
  }
  type TNode = { isLeaf: boolean; children: Map<string, TNode> }
  const node = (): TNode => ({ isLeaf: false, children: new Map() })
  const root = node()
  const push = (e: string) => {
    let t = root
    for (const n of e) {
      let c = t.children.get(n)
      if (c === undefined) t.children.set(n, (c = node()))
      t = c
    }
    t.isLeaf = true
  }
  function* commonPrefixSearch(e: string) {
    let t: TNode | undefined = root
    let n = ''
    for (let r = 0; r < e.length && t !== undefined; r++) {
      const i = e[r]
      n += i
      t = t.children.get(i)
      if (t !== undefined && t.isLeaf) yield n
    }
  }
  type LNode = { tokenId: number; nodeId: number; pos: number; length: number; score: number; prev: LNode | null; backtraceScore: number }
  const clone = (x: LNode): LNode => ({ ...x })
  const vocab = json.model.vocab.map(([p, s]) => [p, s] as [string, number])
  const unkTokenId = json.model.unk_id
  const normalizer = fromConfig(json.normalizer)
  const preTokenizer = fromConfig(json.pre_tokenizer)
  const normalize = (e: string) => normalizer.normalize!(e)
  const tokenToIds = new Map(vocab.map((e, t) => [normalize(e[0]), t]))
  const getTokenId = (e: string) => tokenToIds.get(e)!
  const bosTokenId = getTokenId(normalize(' '))
  const eosTokenId = getTokenId('</s>')
  let minScore = 1e6
  vocab.forEach((e) => (minScore = Math.min(minScore, e[1])))
  const unkScore = minScore - 10
  vocab[unkTokenId][1] = unkScore
  vocab.forEach((e) => push(e[0]))

  const tokenize = (sentence: string): number[] => {
    const len = sentence.length
    const nodes: LNode[] = []
    const beginNodes: LNode[][] = Array.from({ length: len + 1 }, () => [])
    const endNodes: LNode[][] = Array.from({ length: len + 1 }, () => [])
    const mk = (tokenId: number, nodeId: number, pos: number, length: number, score: number): LNode => ({ tokenId, nodeId, pos, length, score, prev: null, backtraceScore: 0 })
    const bos = mk(bosTokenId, 0, 0, 0, 0)
    const eos = mk(eosTokenId, 1, len, 0, 0)
    nodes.push(clone(bos), clone(eos))
    beginNodes[len].push(eos)
    endNodes[0].push(bos)
    const insert = (e: number, t: number, n: number, r: number) => {
      const i = mk(r, nodes.length, e, t, n)
      beginNodes[e].push(i)
      endNodes[e + t].push(i)
      nodes.push(i)
    }
    let r = 0
    while (r < len) {
      let n = false
      for (const s of commonPrefixSearch(sentence.slice(r))) {
        const t = getTokenId(s)
        const o = vocab[t][1]
        const a = s.length
        insert(r, a, o, t)
        if (!n && a === 1) n = true
      }
      if (!n) insert(r, 1, unkScore, unkTokenId)
      r += 1
    }
    let t = 0
    while (t <= len) {
      if (beginNodes[t].length === 0) return []
      for (const e of beginNodes[t]) {
        e.prev = null
        let n = 0
        let best: LNode | null = null
        for (const i of endNodes[t]) {
          const v = i.backtraceScore + e.score
          if (best === null || v > n) {
            best = clone(i)
            n = v
          }
        }
        if (best === null) return []
        e.prev = best
        e.backtraceScore = n
      }
      t++
    }
    const out: LNode[] = []
    const last = beginNodes[len][0].prev
    if (last === null) return []
    let i = clone(last)
    while (i.prev !== null) {
      out.push(clone(i))
      i = clone(clone(i).prev!)
    }
    out.reverse()
    return out.map((x) => x.tokenId)
  }

  return {
    encode(e: string): number[] {
      if (e == null || e.length === 0) return [eosTokenId]
      e = e.replace(/[[\]{}]/g, '').replace(/-?\d*\.?\d*::/g, '')
      const t = normalize(e)
      const n = preTokenizer.preTokenize!([t])
      const r: number[] = []
      for (const w of n) r.push(...tokenize(w))
      r.push(eosTokenId)
      return r
    },
  }
}

function jsonFromDef(def: T5Def): TokJson {
  return {
    added_tokens: [],
    normalizer: { type: 'Precompiled' },
    pre_tokenizer: { type: 'Sequence', pretokenizers: [{ type: 'WhitespaceSplit' }, { type: 'Metaspace', replacement: '▁', add_prefix_space: true }] },
    decoder: { type: 'Metaspace', replacement: '▁', add_prefix_space: true },
    model: { unk_id: def.unkId, vocab: def.pieces.map((p, i) => [p, def.scores[i]]) },
  }
}

let def: T5Def
let json: TokJson
const hasNai = existsSync(NAI_DEF)
beforeAll(async () => {
  def = await loadT5Def(readFileSync(FILE))
  json = hasNai ? (JSON.parse(inflateRawSync(readFileSync(NAI_DEF)).toString('utf8')) as TokJson) : jsonFromDef(def)
})

const SAMPLES = [
  '',
  '1girl',
  '1girl, solo, long hair, looking at viewer, smile, blue eyes, very aesthetic, masterpiece, no text',
  '1.2::artist:wlop, year 2024::, {{best quality}}, [[bad hands]], -0.8::feet::, rating:general',
  'girl, frieren, elf, white hair, twintails, pointy ears, 0::ai-generated::',
  '  leading and trailing spaces  ',
  'multi\nline\n\nText: Hello, World!',
  '芙莉莲, 精灵, 白发, 双马尾',
  'emoji 😀🎉 and ½ ﬁ ligature, ①②, ＡＢＣ full-width',
  'source#hug, target#hug, mutual#holding hands',
  'nsfw, lowres, artistic error, film grain, scan artifacts, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration',
  '</s> <unk> <pad> literal specials',
  '▁already▁prefixed',
  'a | b | c',
  'tab\there',
  'café naïve résumé',
]

describe('T5 计数和 NAI 的 Unigram 一样', () => {
  it(`词表${hasNai ? '和 NAI 的原文件一模一样' : '能读出来（没有 data/raw/t5_tokenizer.def，跳过逐条核对）'}`, () => {
    expect(def.pieces).toHaveLength(32100)
    expect(def.unkId).toBe(2)
    if (!hasNai) return
    expect(def.pieces).toEqual(json.model.vocab.map((v) => v[0]))
    expect(def.scores).toEqual(json.model.vocab.map((v) => v[1]))
  })
  it('一段（encode）的个数：样例', () => {
    const ref = naiReference(json)
    const mine = createT5Counter(def)
    for (const t of SAMPLES) expect(mine.encodeLength(t), JSON.stringify(t)).toBe(ref.encode(t).length)
  })
  it('一段的个数：随机拼的 tag 串（含权重、括号、中文、空白）', () => {
    const ref = naiReference(json)
    const mine = createT5Counter(def)
    const words = ['1girl', 'solo', 'long hair', 'artist:wlop', '1.25::', '::', '{', '}', '[', ']', '芙莉莲', 'Text:', '\n', ' ', ', ', 'masterpiece', 'very aesthetic', '-0.5::', 'x', '😀', 'ß', 'Ⅻ']
    let seed = 7
    const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648)
    for (let k = 0; k < 300; k++) {
      const n = 1 + Math.floor(rnd() * 25)
      const t = Array.from({ length: n }, () => words[Math.floor(rnd() * words.length)]).join(rnd() < 0.5 ? ', ' : '')
      expect(mine.encodeLength(t), JSON.stringify(t)).toBe(ref.encode(t).length)
    }
  })
  it('长度条的数 = 按 | 切成最多 6 段各自 encode 再加起来（每段一个 </s>，空框也是 1）', () => {
    const ref = naiReference(json)
    const mine = createT5Counter(def)
    for (const t of ['', '1girl', 'a | b', 'a|b|c|d|e|f|g|h', '||x|y|| and | z']) {
      const want = splitPromptMix(t).reduce((n, s) => n + ref.encode(s).length, 0)
      expect(mine.count(t), JSON.stringify(t)).toBe(want)
    }
    expect(mine.count('')).toBe(1)
    // NovelAI encodes each pipe-separated segment independently, including its own </s> and boundary whitespace.
    expect(mine.count('1girl | 1girl')).toBe(mine.encodeLength('1girl ') + mine.encodeLength(' 1girl'))
  })
  it('splitPromptMix 照 NAI', () => {
    expect(splitPromptMix('a')).toEqual(['a'])
    expect(splitPromptMix('a|b')).toEqual(['a', 'b'])
    expect(splitPromptMix('1|2|3|4|5|6|7|8')).toEqual(['1', '2', '3', '4', '5', '6|7|8'])
    expect(splitPromptMix('x ||a|b|| y|z')).toEqual(['x ||a|b|| y', 'z'])
  })
  it('权重写法不算 token，括号不算', () => {
    const c = createT5Counter(def)
    expect(c.encodeLength('1.2::1girl::')).toBe(c.encodeLength('1girl'))
    expect(c.encodeLength('{{1girl}}')).toBe(c.encodeLength('1girl'))
  })
})
