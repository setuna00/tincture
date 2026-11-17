import { describe, expect, it } from 'vitest'
import { decodeLookup, type LookupFile } from './tag-data'
import { checkBlock, checkGloss, compoundOf, englishIn, glossLen, hasDisambig, MAX_GLOSS, parseWikiZh, type WikiZhFile } from './wiki-zh'

const { readFileSync } = (await import(/* @vite-ignore */ `node:${'fs'}`)) as { readFileSync(p: URL): Uint8Array }
const { gunzipSync } = (await import(/* @vite-ignore */ `node:${'zlib'}`)) as { gunzipSync(b: Uint8Array): Uint8Array }
const gz = <T>(file: string) => JSON.parse(new TextDecoder().decode(gunzipSync(readFileSync(new URL(`../assets/tags/${file}.json.gz`, import.meta.url))))) as T

const LK = gz<LookupFile>('lookup')
const ROWS = decodeLookup(LK)
const byName = new Map(ROWS.map((t) => [t.name, t]))
const domainOf = (n: string) => {
  const r = LK.rows.find((x) => x[0] === n)
  return r ? LK.domains[r[4]] : undefined
}
const aliases = new Set((LK.aliases ?? []).map((a) => a[0]))
const known = (s: string) => byName.has(s)

describe('组合词判定', () => {
  it('颜色 / 图案 / 状态 + 服装或物品', () => {
    expect(compoundOf('blue jacket', domainOf)).toEqual({ kind: 'color', mod: 'blue', base: 'jacket' })
    expect(compoundOf('light blue dress', domainOf)).toEqual({ kind: 'color', mod: 'light blue', base: 'dress' })
    expect(compoundOf('striped shirt', domainOf)).toEqual({ kind: 'pattern', mod: 'striped', base: 'shirt' })
    expect(compoundOf('torn thighhighs', domainOf)).toEqual({ kind: 'state', mod: 'torn', base: 'thighhighs' })
  })
  it('holding X（X 是物品 / 服装 / 生物）、X (cosplay)', () => {
    expect(compoundOf('holding umbrella', domainOf)).toEqual({ kind: 'holding', mod: 'holding', base: 'umbrella' })
    expect(compoundOf('hatsune miku (cosplay)', domainOf)).toEqual({ kind: 'cosplay', mod: 'cosplay', base: 'hatsune miku' })
  })
  it('后半截是身体 / 五官的不算：blue eyes、open mouth、holding hands、black hair', () => {
    for (const n of ['blue eyes', 'open mouth', 'holding hands', 'black hair']) expect(compoundOf(n, domainOf)).toBeNull()
  })
  it('后半截库里没有的不算', () => {
    expect(compoundOf('blue nonexistentthing', domainOf)).toBeNull()
    expect(compoundOf('holding nonexistentthing', domainOf)).toBeNull()
  })
  it('wiki 开头有辨析的照样写释义（不当组合词）', () => {
    expect(hasDisambig('A leotard that\'s colored white. ¶ Not to be confused with white bodysuit.')).toBe(true)
    expect(hasDisambig('If the food is held in the mouth, use food in mouth instead.')).toBe(true)
    expect(hasDisambig('so be careful not to confuse the two.')).toBe(true)
    expect(hasDisambig('An apron that\'s colored pink instead of white.')).toBe(false)
    expect(hasDisambig('A jacket that is colored blue.')).toBe(false)
  })
})

describe('合并校验', () => {
  it('整块：行数、顺序、英文一样，每行有 TAB', () => {
    expect(checkBlock(['a', 'b'], [['a', 'x'], ['b', '']])).toEqual([])
    expect(checkBlock(['a', 'b'], [['a', 'x']])).toEqual(['行数 1 ≠ 2'])
    expect(checkBlock(['a', 'b'], [['b', 'x'], ['a', 'y']])[0]).toBe('第 1 行英文「b」≠「a」')
    expect(checkBlock(['a'], [['a']])).toEqual(['第 1 行没有 TAB'])
  })
  it('长度：汉字标点各算 1，英文每个词算 1', () => {
    expect(glossLen('头发全部扎成左右两束。')).toBe(11)
    expect(glossLen('散着的是 two side up。')).toBe(8)
    expect(checkGloss('长'.repeat(MAX_GLOSS), known)).toEqual([])
    expect(checkGloss('长'.repeat(MAX_GLOSS + 1), known)).toEqual([`${MAX_GLOSS + 1} 字，超过 ${MAX_GLOSS}`])
  })
  it('辨析里的英文要在 tag 库里；Q 版、T 恤这类不算 tag', () => {
    expect(englishIn('全部扎起来的是 twintails，只扎一部分的是 two side up。')).toEqual(['twintails', 'two side up'])
    expect(checkGloss('全部扎起来的是 twintails，只扎一部分的是 two side up。', known)).toEqual([])
    expect(checkGloss('穿着 T 恤的 Q 版角色，3D 建模。', known)).toEqual([])
    expect(englishIn('另一种吐舌是 :q。')).toEqual([':q'])
    expect(checkGloss('另一种吐舌是 :q。', known)).toEqual([])
    expect(checkGloss('别和 made up hair thing 混。', known)).toEqual(['「made up hair thing」不在 tag 库里'])
  })
  it('不出现「该标签 / 这个 tag / 打标 / 弃用」', () => {
    expect(checkGloss('该标签表示双马尾。', known)).toEqual(['有「该标签」'])
    expect(checkGloss('这个 tag 已弃用。', known)[0]).toBe('有「这个 tag」')
    expect(checkGloss('只在能看到时才打标。', known)).toEqual(['有「打标」'])
  })
  it('空的（原文看不出画面）合格', () => {
    expect(checkGloss('', known)).toEqual([])
  })
})

describe('载入', () => {
  const f: WikiZhFile = {
    v: 1,
    rows: [
      ['jacket', '有袖子的短外套。'],
      ['twintails', '头发全部扎成左右两束。'],
    ],
    parts: [
      ['blue jacket', 'blue', 'jacket'],
      ['blue scarf', 'blue', 'scarf'],
      ['hatsune miku (cosplay)', 'cosplay', 'hatsune miku'],
    ],
  }
  const z = parseWikiZh(f)
  it('有释义的直接给；组合词给 mod + base + base 的释义；base 没有释义就只有 mod + base', () => {
    expect(z.gloss('twintails')).toEqual({ text: '头发全部扎成左右两束。' })
    expect(z.gloss('blue jacket')).toEqual({ mod: 'blue', base: 'jacket', text: '有袖子的短外套。' })
    expect(z.gloss('blue scarf')).toEqual({ mod: 'blue', base: 'scarf' })
    expect(z.gloss('hatsune miku (cosplay)')).toEqual({ mod: 'cosplay', base: 'hatsune miku' })
    expect(z.gloss('ponytail')).toBeUndefined()
  })
  it('构建产物：释义都不空、都过合并校验（长度、禁用词、英文都在库里）；组合词自己没有释义、base 在库里', () => {
    const real = gz<WikiZhFile>('wiki')
    expect(real.v).toBe(1)
    expect(real.rows.length).toBeGreaterThan(7500)
    const has = new Set(real.rows.map(([n]) => n))
    for (const [n, t] of real.rows) {
      expect(byName.has(n), n).toBe(true)
      expect(t.length, n).toBeGreaterThan(0)
      expect(checkGloss(t, (x) => byName.has(x) || aliases.has(x)), n).toEqual([])
    }
    for (const [n, , base] of real.parts) {
      expect(has.has(n), n).toBe(false)
      expect(byName.has(base) || n.endsWith('(cosplay)'), n).toBe(true)
    }
    const zz = parseWikiZh(real)
    expect(zz.gloss('blue jacket')).toMatchObject({ mod: 'blue', base: 'jacket', text: expect.any(String) })
    expect(zz.gloss('twintails')).toMatchObject({ text: expect.stringContaining('two side up') })
  })
})
