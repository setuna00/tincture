import { describe, expect, it } from 'vitest'
import type { Chip, Section } from '@/types'
import { exportString, fitSize, isTextBlock, looksLikePromptString, parsePrompt, stepWeight, toChip } from './nai'

const chip = (text: string, weight = 1, extra: Partial<Chip> = {}): Chip => ({
  id: text,
  text,
  type: 'tag',
  weight,
  disabled: false,
  ...extra,
})
const sec = (chips: Chip[], extra: Partial<Section> = {}): Section => ({
  id: 's',
  name: 's',
  color: 'slate',
  muted: false,
  chips,
  ...extra,
})

describe('exportString', () => {
  it('合并相邻同权重', () => {
    expect(exportString([sec([chip('a', 1.2), chip('b', 1.2), chip('c'), chip('d', 1.2)])])).toBe(
      '1.2::a, b::, c, 1.2::d::',
    )
  })
  it('负权重、前缀', () => {
    const s = sec([
      chip('wlop', 1, { type: 'artist' }),
      chip('hat', -1),
      chip('hug', 1, { type: 'interaction', interaction: 'source' }),
      chip('2024', 1, { type: 'year' }),
      chip('novel era', 1, { type: 'meta' }),
    ])
    expect(exportString([s])).toBe('artist:wlop, -1::hat::, source#hug, year 2024, meta:novel era')
  })
  it('组里最后一个以数字 / 小数点 / 减号结尾时，关的 :: 前空一格（NAI 会把紧挨的数字读成新权重）', () => {
    const s = sec([
      chip('bm94199', 0.7, { type: 'artist' }),
      chip('wanke', 1, { type: 'artist' }),
      chip('2024', 1.2, { type: 'year' }),
      chip('ver.', 2),
      chip('x-', -1),
      chip('re0n', 0.6, { type: 'artist' }),
    ])
    const out = exportString([s])
    expect(out).toBe('0.7::artist:bm94199 ::, artist:wanke, 1.2::year 2024 ::, 2::ver. ::, -1::x- ::, 0.6::artist:re0n::')
    const closes = [...out.matchAll(/::/g)].filter((_, i) => i % 2 === 1)
    for (const m of closes) expect(out.slice(0, m.index).match(/-?\d*\.?\d*$/)![0]).toBe('')
    expect(parsePrompt(out).map((c) => [c.text, c.weight])).toEqual([
      ['bm94199', 0.7],
      ['wanke', 1],
      ['2024', 1.2],
      ['ver.', 2],
      ['x-', -1],
      ['re0n', 0.6],
    ])
  })
  it('跳过 disabled chip 和 muted section；跨 section 也合并', () => {
    const out = exportString([
      sec([chip('a', 1.1), chip('x', 1.1, { disabled: true })]),
      sec([chip('m')], { muted: true }),
      sec([chip('b', 1.1)]),
    ])
    expect(out).toBe('1.1::a, b::')
  })
  it('空', () => expect(exportString([])).toBe(''))
  it('Text: 不管在哪个区块，都排在框的最后，不带权重', () => {
    const out = exportString([
      sec([chip('Hello, world!', 1.5, { type: 'textrender' }), chip('text'), chip('english text')]),
      sec([chip('1girl', 1.2)]),
    ])
    expect(out).toBe('text, english text, 1.2::1girl::, Text: Hello, world!')
  })
  it('多个 Text: 合成一个，段之间空一行；禁用的不导出', () => {
    const out = exportString([
      sec([chip('A', 1, { type: 'textrender' }), chip('smile')]),
      sec([chip('B', 1, { type: 'textrender' }), chip('C', 1, { type: 'textrender', disabled: true })]),
    ])
    expect(out).toBe('smile, Text: A\n\nB')
  })
  it('只有 Text:', () => expect(exportString([sec([chip('Hi', 1, { type: 'textrender' })])])).toBe('Text: Hi'))
})

describe('parsePrompt', () => {
  const simple = (s: string) => parsePrompt(s).map((c) => [c.text, c.weight, c.type])
  it('基本逗号', () => {
    expect(simple('1girl, long_hair,  blue eyes ')).toEqual([
      ['1girl', 1, 'tag'],
      ['long hair', 1, 'tag'],
      ['blue eyes', 1, 'tag'],
    ])
  })
  it('数值权重块', () => {
    expect(simple('1.5::rain, night ::, smile, -1::hat::')).toEqual([
      ['rain', 1.5, 'tag'],
      ['night', 1.5, 'tag'],
      ['smile', 1, 'tag'],
      ['hat', -1, 'tag'],
    ])
  })
  it('{} [] 嵌套', () => {
    const r = parsePrompt('{{a}}, [b], {c, [d]}')
    expect(r.map((c) => [c.text, c.weight])).toEqual([
      ['a', 1.1025],
      ['b', 0.9524],
      ['c', 1.05],
      ['d', 1],
    ])
  })
  it(':: 关闭所有括号', () => {
    const r = parsePrompt('2::{a, b::, c')
    expect(r.map((c) => [c.text, c.weight])).toEqual([
      ['a', 2.1],
      ['b', 2.1],
      ['c', 1],
    ])
  })
  it('前缀识别', () => {
    const r = parsePrompt('artist:wlop, source#hug, year 2024, meta:golden era')
    expect(r.map((c) => [c.type, c.text, c.interaction])).toEqual([
      ['artist', 'wlop', undefined],
      ['interaction', 'hug', 'source'],
      ['year', '2024', undefined],
      ['meta', 'golden era', undefined],
    ])
  })
  it('year 2024:: 不会被当成权重', () => {
    expect(simple('1.2::year 2024::')).toEqual([['2024', 1.2, 'year']])
  })
  it('SD 写法和转义括号', () => {
    expect(simple('(smile:1.3), hatsune miku \\(cosplay\\)')).toEqual([
      ['smile', 1.3, 'tag'],
      ['hatsune miku (cosplay)', 1, 'tag'],
    ])
  })
  it('表情 tag 的下划线保留', () => {
    expect(simple('^_^, >_<')).toEqual([
      ['^_^', 1, 'tag'],
      ['>_<', 1, 'tag'],
    ])
  })
  it('自然语言识别为 text', () => {
    expect(simple('a girl standing in the rain at night')[0][2]).toBe('text')
  })
  it('Text: 到结尾整段是一个 chip：逗号保留', () => {
    expect(simple('text, english text, 1girl, Text: Hello, world! Is this ok?')).toEqual([
      ['text', 1, 'tag'],
      ['english text', 1, 'tag'],
      ['1girl', 1, 'tag'],
      ['Hello, world! Is this ok?', 1, 'textrender'],
    ])
  })
  it('Text: 里的换行 / 空行（分段）保留，CRLF 归一；::、括号、下划线都是原文，权重固定 1', () => {
    expect(simple('Text: Line_one\r\n\r\nLine two\n')).toEqual([['Line_one\n\nLine two', 1, 'textrender']])
    expect(simple('1.2::smile, Text: a::b {c}')).toEqual([
      ['smile', 1.2, 'tag'],
      ['a::b {c}', 1, 'textrender'],
    ])
  })
  it('text 这个 tag、text:: 关权重都不是 Text:；小写 text: 算', () => {
    expect(simple('1.2::english text, text::, smile')).toEqual([
      ['english text', 1.2, 'tag'],
      ['text', 1.2, 'tag'],
      ['smile', 1, 'tag'],
    ])
    expect(simple('smile, text: hi')).toEqual([
      ['smile', 1, 'tag'],
      ['hi', 1, 'textrender'],
    ])
  })
  it('Text: 后面是空的：不出 chip', () => expect(simple('smile, Text:  ')).toEqual([['smile', 1, 'tag']]))
  it('Text: 往返：解析再导出原样', () => {
    const src = 'text, english text, 1girl, Text: Hello, world!\n\nIs this ok?'
    expect(exportString([sec(parsePrompt(src).map(toChip))])).toBe(src)
  })
  it('Text: 开头的输入当整串（不搜 tag，逗号不拆）', () => {
    expect(looksLikePromptString('Text: hi')).toBe(true)
    expect(isTextBlock('  text: hi, you')).toBe(true)
    expect(isTextBlock('text::')).toBe(false)
    expect(isTextBlock('english text')).toBe(false)
  })
  it('导出→解析 往返', () => {
    const src = '1.2::a, b::, c, -0.5::d::, artist:wlop, mutual#hug'
    const chips = parsePrompt(src).map(toChip)
    expect(exportString([sec(chips)])).toBe(src)
  })
})

describe('stepWeight', () => {
  it('吸附到 0.05 网格', () => {
    expect(stepWeight(1, 0.05)).toBe(1.05)
    expect(stepWeight(1.1025, 0.05)).toBe(1.15)
    expect(stepWeight(0.05, -0.05)).toBe(0)
    expect(stepWeight(0, -0.25)).toBe(-0.25)
    expect(stepWeight(4.9, 0.25)).toBe(5)
  })
})

describe('fitSize（自定义尺寸，照 NAI）', () => {
  it('按 64 就近取整，至少 64', () => {
    expect(fitSize(1000, 1216)).toEqual([1024, 1216])
    expect(fitSize(10, 1216)).toEqual([64, 1216])
  })
  it('总像素超过 3145728 时压另一边', () => {
    expect(fitSize(2048, 2048)).toEqual([2048, 1536])
    expect(fitSize(1536, 2048)).toEqual([1536, 2048])
  })
})
