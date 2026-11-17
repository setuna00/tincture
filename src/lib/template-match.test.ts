import { describe, expect, it } from 'vitest'
import { parsePrompt } from '@/lib/nai'
import type { SectionTemplate } from '@/store/library'
import { conflictChecker, isNegativeTag } from './recommend'
import { BY_NAME as T, npmiOf } from './tag-fixture'
import { matchTemplates, type MatchContext } from './template-match'

const ctx: MatchContext = { group: (n) => T.get(n)?.group, npmi: npmiOf, isNegative: (n) => isNegativeTag(n, T.get(n)), conflicts: (p) => conflictChecker(p, (n) => T.get(n)) }
const tpl = (name: string, prompt: string): SectionTemplate => ({ id: name, name, color: 'slate', folder: '', createdAt: 0, chips: parsePrompt(prompt).map((p) => ({ ...p, disabled: false })) })
const LIB = [
  tpl('温柔微笑', 'smile, closed mouth, 0.8::blush::, looking at viewer'),
  tpl('柔和逆光', 'backlighting, 1.1::light rays::, dappled sunlight, light particles, depth of field'),
  tpl('特写', 'close-up, portrait, depth of field'),
  tpl('高质量', 'masterpiece, best quality, very aesthetic, absurdres'),
  tpl('通用负面', 'lowres, bad anatomy, bad hands, missing fingers, extra digits, jpeg artifacts, signature, watermark, blurry'),
  tpl('和风场景', 'cherry blossoms, petals, shrine, lantern, kimono, wide sleeves'),
  tpl('日落轮廓光', 'sunset, backlighting, rim lighting, sky, cloud'),
]
const names = (tags: string[], negative = false) => matchTemplates(tags, LIB, negative, ctx).map((m) => m.template.name)

describe('相关区块模板', () => {
  it('场景区块 → 和风场景、柔和逆光排在前面（日落和 day 冲突，排后面），不推表情 / 负面', () => {
    const r = names(['outdoors', 'cherry blossoms', 'petals', 'blue sky', 'day', 'depth of field', 'light particles'])
    expect(r.slice(0, 2).sort()).toEqual(['和风场景', '柔和逆光'])
    expect(r).not.toContain('通用负面')
    expect(r).not.toContain('温柔微笑')
  })
  it('质量区块 → 高质量；正面区块不推以负面词为主的模板（lowres 也在「质量」分组）', () => {
    const r = names(['very aesthetic', 'masterpiece', 'high complexity', 'absurdres'])
    expect(r[0]).toBe('高质量')
    expect(r).not.toContain('通用负面')
  })
  it('负面区块 → 只推负面模板', () => {
    expect(names(['lowres', 'bad hands', 'blurry'], true)).toEqual(['通用负面'])
  })
  it('模板里的 tag 全都已经有了 → 不推（插进来什么也不加）', () => {
    expect(names(['close-up', 'portrait', 'depth of field'])).not.toContain('特写')
  })
  it('空区块不推', () => {
    expect(names([])).toEqual([])
  })
})
