import { describe, expect, it } from 'vitest'
import { parsePrompt, toChip } from '@/lib/nai'
import type { Doc } from '@/types'
import { createDocStore, defaultSettings } from './doc'

const setup = (weight: number) => {
  const chip = { ...toChip(parsePrompt('1girl')[0]), weight }
  const doc: Doc = {
    base: { prompt: [{ id: 's0', name: '人物', color: 'slate', muted: false, chips: [chip] }], uc: [] },
    characters: [],
    settings: defaultSettings(),
    meta: { title: 't', createdAt: 0 },
  }
  const store = createDocStore(doc)
  const t = () => store.temporal.getState()
  const cur = () => store.getState().doc.base.prompt[0].chips[0]
  return { store, id: chip.id, t, cur }
}

describe('合并撤销', () => {
  it('连着滚两下只记一步', () => {
    const { store, id, t, cur } = setup(1)
    store.getState().adjustWeight([id], 0.05)
    store.getState().adjustWeight([id], 0.05)
    expect(cur().weight).toBe(1.1)
    expect(t().pastStates.length).toBe(1)
    t().undo()
    expect(cur().weight).toBe(1)
  })

  it('滚到顶没改动，紧接着禁用：禁用单独一步，撤销只撤禁用', () => {
    const { store, id, t, cur } = setup(4.9)
    store.getState().adjustWeight([id], 0.1)
    store.getState().adjustWeight([id], 0.1)
    store.getState().toggleDisabled([id])
    expect(t().pastStates.length).toBe(2)
    t().undo()
    expect(cur()).toMatchObject({ weight: 5, disabled: false })
  })

  it('撤销后马上再滚：这一步进撤销栈，重做栈清空', () => {
    const { store, id, t, cur } = setup(1)
    store.getState().adjustWeight([id], 0.05)
    t().undo()
    store.getState().adjustWeight([id], 0.05)
    expect(cur().weight).toBe(1.05)
    expect(t().pastStates.length).toBe(1)
    expect(t().futureStates.length).toBe(0)
    t().undo()
    expect(cur().weight).toBe(1)
  })
})
