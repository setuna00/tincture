import { describe, expect, it } from 'vitest'
import { parsePrompt, toChip } from '@/lib/nai'
import { blankDoc } from '@/store/sample'
import { DOC_PRESETS, presetDoc } from '@/store/presets'
import { hasChips, isUnsaved, sameDocContent } from './doc-equal'

const chip = (text: string) => toChip(parsePrompt(text)[0])

describe('未保存怎么算', () => {
  it('没存过：有 tag 才算未保存', () => {
    const d = blankDoc()
    expect(isUnsaved(d, undefined)).toBe(false)
    d.base.prompt[0].chips.push(chip('1girl'))
    expect(hasChips(d)).toBe(true)
    expect(isUnsaved(d, undefined)).toBe(true)
  })

  it('存过：按内容比，键的顺序、undefined 和没有这个键不算改动；createdAt / forkedFrom / docId 不算内容', () => {
    const saved = blankDoc('雨夜')
    saved.base.prompt[0].chips.push(chip('1girl'))
    const cur = structuredClone(saved)
    cur.meta = { title: '雨夜', createdAt: 1, docId: 'd_other', forkedFrom: { docId: 'x', version: 3 } }
    const s0 = cur.base.prompt[0]
    cur.base.prompt[0] = { chips: s0.chips, muted: s0.muted, color: s0.color, name: s0.name, id: s0.id, note: undefined }
    expect(sameDocContent(cur, saved)).toBe(true)
    expect(isUnsaved(cur, saved)).toBe(false)
  })

  it('改了 tag、权重、标题、设置都算', () => {
    const saved = blankDoc('雨夜')
    const a = structuredClone(saved)
    a.base.uc[0].chips.push(chip('lowres'))
    expect(isUnsaved(a, saved)).toBe(true)
    const b = structuredClone(saved)
    b.meta.title = '雨夜 2'
    expect(isUnsaved(b, saved)).toBe(true)
    const c = structuredClone(saved)
    c.settings.gen.steps += 1
    expect(isUnsaved(c, saved)).toBe(true)
  })

  it('存过的清空了 tag 也算未保存（和存的那份不一样）', () => {
    const saved = blankDoc('雨夜')
    saved.base.prompt[0].chips.push(chip('1girl'))
    const cur = structuredClone(saved)
    cur.base.prompt[0].chips = []
    expect(isUnsaved(cur, saved)).toBe(true)
  })
})

describe('新建的预设', () => {
  it('只有区块名、没有 tag；负面一个「负面」；多人带两个女角色', () => {
    for (const p of DOC_PRESETS) {
      const d = presetDoc(p)
      expect(hasChips(d)).toBe(false)
      expect(d.base.prompt.map((s) => s.name)).toEqual(p.pos.map(([n]) => n))
      expect(d.base.uc.map((s) => s.name)).toEqual(['负面'])
      expect(d.characters).toHaveLength(p.characters)
    }
    const multi = presetDoc(DOC_PRESETS.find((p) => p.id === 'multi')!)
    expect(multi.characters.map((c) => [c.gender, c.prompt.map((s) => s.name)])).toEqual([
      ['female', ['外观']],
      ['female', ['外观']],
    ])
    expect(multi.characters[0].color).not.toBe(multi.characters[1].color)
  })
})
