import { describe, expect, it } from 'vitest'
import { introDoc } from '@/store/sample'
import { createDocStore } from '@/store/doc'
import { lockSelected } from './random-ops'

describe('selected random locks', () => {
  it('locks selections across sections in one undo step', () => {
    const doc = introDoc()
    const first = doc.base.prompt[2]
    const second = structuredClone(first)
    second.id += '-second'
    second.chips.forEach((c) => { c.id += '-second' })
    doc.base.prompt.push(second)
    const store = createDocStore(doc)
    lockSelected(store, [first.chips[0].id, second.chips[1].id])
    expect(store.getState().doc.base.prompt[2].random?.locked).toEqual([first.chips[0].text])
    expect(store.getState().doc.base.prompt.at(-1)?.random?.locked).toEqual([second.chips[1].text])
    expect(store.temporal.getState().pastStates).toHaveLength(1)
    store.temporal.getState().undo()
    expect(store.getState().doc).toEqual(doc)
  })
  it('unlocks a subset of lockAll while preserving other slots and undo', () => {
    const doc = introDoc()
    const section = doc.base.prompt[2]
    section.random!.lockAll = true
    const store = createDocStore(doc)
    lockSelected(store, [section.chips[0].id])
    const rule = store.getState().doc.base.prompt[2].random!
    expect(rule.lockAll).toBeUndefined()
    expect(rule.locked).toEqual(section.chips.slice(1).map((c) => c.text))
    store.temporal.getState().undo()
    expect(store.getState().doc.base.prompt[2].random?.lockAll).toBe(true)
  })
})
