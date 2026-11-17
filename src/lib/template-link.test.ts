import { describe, expect, it } from 'vitest'
import { createDocStore, findSection } from '@/store/doc'
import { blankDoc } from '@/store/sample'
import type { Chip, Section } from '@/types'
import { chipsFromTemplate, linkState, sameChips, templateChips } from './template-link'

const c = (text: string, extra: Partial<Chip> = {}): Chip => ({ id: `c-${text}`, text, type: 'tag', weight: 1, disabled: false, ...extra })
const tpl = { id: 'st1', chips: templateChips([c('smile'), c('blush', { weight: 0.8 }), c('hug', { type: 'interaction', interaction: 'mutual' })]) }

describe('sameChips', () => {
  it('chip id 不同不算不一样；文字 / 类型 / 权重 / 互动前缀 / 禁用 / 顺序 任何一样变了都算', () => {
    const base = chipsFromTemplate(tpl.chips)
    expect(sameChips(base, tpl.chips)).toBe(true)
    const variants: Chip[][] = [
      base.map((x, i) => (i === 0 ? { ...x, text: 'smiling' } : x)),
      base.map((x, i) => (i === 0 ? { ...x, type: 'artist' as const } : x)),
      base.map((x, i) => (i === 1 ? { ...x, weight: 0.85 } : x)),
      base.map((x, i) => (i === 2 ? { ...x, interaction: 'source' as const } : x)),
      base.map((x, i) => (i === 0 ? { ...x, disabled: true } : x)),
      [base[1], base[0], base[2]],
      base.slice(0, 2),
      [...base, c('tears')],
    ]
    for (const chips of variants) expect(sameChips(chips, tpl.chips)).toBe(false)
  })

  it('浮点权重按值比（1.1 和 1.1000000000000001 一样）', () => {
    expect(sameChips([c('a', { weight: 1.1 })], [{ ...c('a'), weight: 1.1000000000000001 }])).toBe(true)
  })
})

describe('linkState', () => {
  it('来自模板 / 改过 / 无关联（没有 templateId、模板被删）', () => {
    expect(linkState({ templateId: 'st1' }, [tpl]).state).toBe('clean')
    expect(linkState({ templateId: 'st1', templateEdited: true }, [tpl]).state).toBe('edited')
    expect(linkState({}, [tpl])).toEqual({ state: 'none', template: null })
    expect(linkState({ templateId: 'gone', templateEdited: true }, [tpl])).toEqual({ state: 'none', template: null })
  })
})

describe('doc store 记下「改过」', () => {
  const setup = () => {
    const doc = blankDoc()
    const sec: Section = { ...doc.base.prompt[0], id: 's-tpl', templateId: 'st1', chips: chipsFromTemplate(tpl.chips) }
    doc.base.prompt[0] = sec
    const store = createDocStore(doc)
    const edited = () => !!findSection(store.getState().doc, 's-tpl')?.section.templateEdited
    const chipId = (i: number) => findSection(store.getState().doc, 's-tpl')!.section.chips[i].id
    return { store, edited, chipId }
  }

  it('改 tag 记下改过；改回一模一样也还是改过', () => {
    const { store, edited, chipId } = setup()
    expect(edited()).toBe(false)
    store.getState().setWeight([chipId(0)], 1.2)
    expect(edited()).toBe(true)
    store.getState().setWeight([chipId(0)], 1)
    expect(edited()).toBe(true)
  })

  it('和那次改动是同一步：Ctrl+Z 撤回到改之前，标记也没了', () => {
    const { store, edited, chipId } = setup()
    store.getState().toggleDisabled([chipId(1)])
    expect(edited()).toBe(true)
    store.temporal.getState().undo()
    expect(edited()).toBe(false)
    expect(findSection(store.getState().doc, 's-tpl')!.section.chips[1].disabled).toBe(false)
  })

  it('只改名字 / 颜色 / 备注 / 折叠不算；删、加、拖走 tag 都算', () => {
    const { store, edited, chipId } = setup()
    store.getState().updateSection('s-tpl', { name: '改名', color: 'rose', note: '备注' })
    expect(edited()).toBe(false)
    store.getState().removeChips([chipId(2)])
    expect(edited()).toBe(true)

    const b = setup()
    b.store.getState().addChips('s-tpl', [c('tears')])
    expect(b.edited()).toBe(true)

    const m = setup()
    const other = m.store.getState().doc.base.prompt[1].id
    m.store.getState().moveChip(m.chipId(0), other, null)
    expect(m.edited()).toBe(true)
  })

  it('存为新模板 / 覆盖以后清掉（updateSection 带 templateEdited: undefined）', () => {
    const { store, edited, chipId } = setup()
    store.getState().setWeight([chipId(0)], 1.3)
    store.getState().updateSection('s-tpl', { templateId: 'st2', templateEdited: undefined })
    expect(edited()).toBe(false)
  })
})
