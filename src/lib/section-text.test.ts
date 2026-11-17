import { describe, expect, it } from 'vitest'
import type { Chip } from '@/types'
import { applySectionText, sameChips, sectionText } from './section-text'

const chip = (text: string, weight = 1, extra: Partial<Chip> = {}): Chip => ({ id: text, text, type: 'tag', weight, disabled: false, ...extra })
const view = (chips: Chip[]) => chips.map((c) => `${c.disabled ? '~' : ''}${c.text}${c.weight !== 1 ? `@${c.weight}` : ''}`).join(' | ')

describe('sectionText', () => {
  it('NAI 写法，末尾带逗号', () => {
    expect(sectionText([chip('2girls'), chip('smile', 1.2), chip('cowboy shot', 1.2)])).toBe('2girls, 1.2::smile, cowboy shot::, ')
  })
  it('禁用的不进文本；空区块是空串', () => {
    expect(sectionText([chip('a'), chip('b', 1, { disabled: true })])).toBe('a, ')
    expect(sectionText([chip('a', 1, { disabled: true })])).toBe('')
    expect(sectionText([])).toBe('')
  })
  it('有 Text: 时末尾不加逗号（逗号会被画出来）', () => {
    expect(sectionText([chip('Hi, you', 1, { type: 'textrender' }), chip('a')])).toBe('a, Text: Hi, you')
  })
})

describe('applySectionText', () => {
  const old = [chip('2girls'), chip('multiple girls'), chip('smile'), chip('cowboy shot')]

  it('没改的保留原 chip（同一个 id），新的是新 chip', () => {
    const next = applySectionText(old, '2girls, multiple girls, looking at viewer, smile, cowboy shot, ')
    expect(view(next)).toBe('2girls | multiple girls | looking at viewer | smile | cowboy shot')
    expect(next.filter((c) => old.some((o) => o.id === c.id)).map((c) => c.id)).toEqual(['2girls', 'multiple girls', 'smile', 'cowboy shot'])
    expect(next[2].id).not.toBe('looking at viewer')
  })
  it('末尾有没有逗号都行；权重按文本', () => {
    expect(view(applySectionText(old, '2girls, 1.3::smile::'))).toBe('2girls | smile@1.3')
    expect(view(applySectionText(old, '2girls, {smile},'))).toBe('2girls | smile@1.05')
  })
  it('重复的 tag 按先后一一对上', () => {
    const next = applySectionText([chip('a'), { ...chip('a'), id: 'a2' }], 'a, a, a')
    expect(next.map((c) => c.id).slice(0, 2)).toEqual(['a', 'a2'])
    expect(next).toHaveLength(3)
  })
  it('禁用的 tag 留在原位置：跟着前面最近一个还在的 tag', () => {
    const withOff = [chip('x', 1, { disabled: true }), chip('a'), chip('b'), chip('y', 1, { disabled: true }), chip('c')]
    expect(view(applySectionText(withOff, 'a, b, c'))).toBe('~x | a | b | ~y | c')
    expect(view(applySectionText(withOff, 'a, new, c'))).toBe('~x | a | ~y | new | c')
    expect(view(applySectionText(withOff, ''))).toBe('~x | ~y')
  })
  it('同名 tag 禁用一个、文本里又写了一个：禁用的不被拿来复用', () => {
    const next = applySectionText([chip('a', 1, { disabled: true })], 'a')
    expect(view(next)).toBe('~a | a')
    expect(next[1].id).not.toBe('a')
  })
  it('原样切回来 = 没改动', () => {
    const chips = [chip('2girls'), chip('smile', 1.2), chip('hat', -1), chip('wlop', 1, { type: 'artist' }), chip('off', 1, { disabled: true })]
    expect(sameChips(applySectionText(chips, sectionText(chips)), chips)).toBe(true)
  })
})
