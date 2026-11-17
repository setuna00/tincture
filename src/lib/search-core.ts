import uFuzzy from '@leeoniya/ufuzzy'
import { isNoiseTag } from './recommend'
import type { SearchEntry } from '@/types'

const PROPER_PENALTY = 300
const DEPRECATED_PENALTY = 400

export interface SearchHit {
  tag: SearchEntry
  score: number
  via: 'name' | 'alias' | 'zh' | 'pinyin' | 'fuzzy'
}

export function createSearcher(tags: SearchEntry[]) {
  const names = tags.map((t) => t.name)
  const proper = tags.map((t) => t.category === 'character' || t.category === 'copyright')
  const renamed = tags.map((t) => t.old === 2)
  const noise = tags.map((t) => isNoiseTag(t.name, t))
  const pyFull = tags.map((t) => t.py.replace(/ /g, ''))
  const pyWords = tags.map((t) => t.py.split(' '))
  const uf = new uFuzzy({ intraMode: 1, intraIns: 1 })
  const generalWords = new Set<string>()
  tags.forEach((t, i) => {
    if (proper[i] || renamed[i] || t.category === 'artist') return
    for (const z of [t.zh, ...t.zhAlt]) if (z) generalWords.add(z)
    if (pyFull[i]) generalWords.add(pyFull[i])
  })

  return function search(raw: string, limit = 12, maxLevel = 3): SearchHit[] {
    const q = raw.trim().toLowerCase().replace(/_/g, ' ')
    if (!q) return []
    const qNoSpace = q.replace(/ /g, '')
    const hits = new Map<number, SearchHit>()
    const penalizeProper = generalWords.has(raw.trim()) || generalWords.has(qNoSpace) || /^[一-鿿]$/.test(raw.trim())
    const add = (i: number, score: number, via: SearchHit['via']) => {
      const t = tags[i]
      let s = score + Math.log10(t.count + 10) * 28
      if (penalizeProper && proper[i] && (via === 'zh' || via === 'pinyin')) s -= PROPER_PENALTY
      if (t.count === 0 && score < 1000) s -= DEPRECATED_PENALTY
      const prev = hits.get(i)
      if (!prev || prev.score < s) hits.set(i, { tag: tags[i], score: s, via })
    }
    const isAscii = /^[\x20-\x7e]+$/.test(q)

    const zq = raw.trim()
    tags.forEach((t, i) => {
      const name = names[i]
      if (noise[i]) {
        if (name === q) add(i, 1000, 'name')
        return
      }
      if (name === q) add(i, 1000, 'name')
      else if (name.startsWith(q)) add(i, 820, 'name')
      else if (name.split(/[\s(]/).some((w) => w.startsWith(q))) add(i, 600, 'name')
      else if (q.length >= 2 && name.includes(q)) add(i, 420, 'name')
      if (renamed[i]) return

      for (const a of t.aliases) {
        const al = a.toLowerCase()
        if (al === q) add(i, 900, 'alias')
        else if (q.length >= 3 && al.startsWith(q)) add(i, 700, 'alias')
      }

      if (t.zh) {
        if (t.zh === zq) add(i, 980, 'zh')
        else if (t.zh.startsWith(zq)) add(i, 800, 'zh')
        else if (t.zh.includes(zq)) add(i, 560, 'zh')
      }
      for (const z of t.zhAlt) {
        if (z === zq) add(i, 960, 'zh')
        else if (zq.length >= 2 && z.startsWith(zq)) add(i, 780, 'zh')
        else if (zq.length >= 2 && z.includes(zq)) add(i, 540, 'zh')
      }

      if (isAscii && /^[a-z ]+$/.test(q)) {
        if (pyFull[i] && pyFull[i].startsWith(qNoSpace)) add(i, 650, 'pinyin')
        else if (t.pyi && qNoSpace.length >= 2 && t.pyi.startsWith(qNoSpace)) add(i, 620, 'pinyin')
        else if (qNoSpace.length >= 2 && matchPinyinMixed(pyWords[i], qNoSpace)) add(i, 580, 'pinyin')
      }
    })

    if (isAscii && q.length >= 3 && hits.size < limit) {
      const idxs = uf.filter(names, q)
      if (idxs) for (const i of idxs.slice(0, 200)) if (!hits.has(i)) add(i, 200, 'fuzzy')
    }

    return [...hits.values()]
      .filter((h) => (h.tag.level ?? 0) <= maxLevel || h.tag.name === q)
      .sort((a, b) => b.score - a.score || Number(a.tag.old === 2) - Number(b.tag.old === 2))
      .slice(0, limit)
  }
}

export type Searcher = ReturnType<typeof createSearcher>

const CJK = /[㐀-鿿豈-﫿぀-ヿ]/
const CJK_G = new RegExp(CJK.source, 'g')
const ZH_STOP = new Set('的之了着和与色'.split(''))
const EN_STOP = new Set(['a', 'an', 'the', 'of', 'on', 'in', 'at', 'to', 'and', 'with', 'for', 'is'])
const stem = (w: string) => (w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w)

export function createMatcher(tags: SearchEntry[], search: Searcher) {
  const zhChars = tags.map((t) => [t.zh, ...t.zhAlt].map((z) => [...new Set([...z].filter((c) => CJK.test(c) && !ZH_STOP.has(c)))]))
  const literal = tags.map((t) => (t.category === 'general' || t.category === 'meta') && !isNoiseTag(t.name, t) && t.count > 0 && t.old !== 2)
  const words = tags.map((t) => t.name.split(/[\s_()]+/).filter(Boolean).map(stem))

  return function match(raw: string, limit = 24, maxLevel = 3): SearchEntry[] {
    const q = raw.trim().toLowerCase().replace(/_/g, ' ')
    if (!q) return []
    const qChars = new Set([...q].filter((c) => CJK.test(c) && !ZH_STOP.has(c)))
    const qWords = new Set(
      q
        .replace(CJK_G, ' ')
        .split(/[\s,()]+/)
        .filter((w) => w.length >= 2 && !EN_STOP.has(w))
        .map(stem),
    )
    const scored: { i: number; s: number }[] = []
    tags.forEach((t, i) => {
      if (!literal[i] || (t.level ?? 0) > maxLevel) return
      let s = 0
      if (qChars.size)
        zhChars[i].forEach((zc, k) => {
          if (!zc.length) return
          const m = zc.filter((c) => qChars.has(c)).length
          if (m >= (k === 0 ? 2 : 3) && m / zc.length >= 0.7) s = Math.max(s, (0.7 * m) / zc.length + (0.3 * m) / qChars.size)
        })
      const tw = words[i]
      if (qWords.size && tw.length) {
        const m = tw.filter((w) => qWords.has(w)).length
        if (m && m / tw.length >= 0.5) s = Math.max(s, (0.7 * m) / tw.length + (0.3 * m) / qWords.size)
      }
      if (s) scored.push({ i, s: s + Math.log10(t.count + 10) * 0.01 })
    })
    scored.sort((a, b) => b.s - a.s)
    const out = new Map<string, SearchEntry>()
    for (const h of search(raw, limit, maxLevel)) if (h.tag.old !== 2) out.set(h.tag.name, h.tag)
    for (const { i } of scored) {
      if (out.size >= limit) break
      out.set(tags[i].name, tags[i])
    }
    return [...out.values()]
  }
}

function matchPinyinMixed(words: string[], q: string): boolean {
  const go = (wi: number, qi: number): boolean => {
    if (qi === q.length) return true
    if (wi === words.length) return false
    const w = words[wi]
    for (let n = Math.min(w.length, q.length - qi); n >= 1; n--) {
      if (q.startsWith(w.slice(0, n), qi) && go(wi + 1, qi + n)) return true
    }
    return false
  }
  return go(0, 0)
}
