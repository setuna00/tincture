import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { parsePrompt, toChip } from '@/lib/nai'
import type { Doc } from '@/types'
import { useLibrary } from './library'
import { blankDoc } from './sample'
import { safeStorage } from './storage'
import { flushDocWrites, getDocStore, useTabs } from './tabs'

const key = (id: string) => `pe:doc:${id}`
const storedTitle = (id: string) => (JSON.parse(safeStorage.getItem(key(id)) ?? 'null') as { meta: { title: string } } | null)?.meta.title

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('文档写进 pe:doc（改动后 250ms）', () => {
  it('平时：250ms 后写', () => {
    const id = useTabs.getState().forkTab()
    getDocStore(id).getState().setTitle('雨夜')
    expect(storedTitle(id)).not.toBe('雨夜')
    vi.advanceTimersByTime(250)
    expect(storedTitle(id)).toBe('雨夜')
  })

  it('改完 250ms 内关掉 tab：不再写回（不留孤儿键）', () => {
    const id = useTabs.getState().forkTab()
    getDocStore(id).getState().setTitle('改了')
    useTabs.getState().closeTab(id)
    vi.advanceTimersByTime(1000)
    expect(safeStorage.getItem(key(id))).toBeNull()
  })

  it('关掉 tab 以后它的 store 又改了（导入提示里点「撤销」）：不写回', () => {
    const id = useTabs.getState().forkTab()
    const store = getDocStore(id)
    useTabs.getState().closeTab(id)
    store.getState().setTitle('撤销')
    vi.advanceTimersByTime(1000)
    expect(safeStorage.getItem(key(id))).toBeNull()
  })

  it('关页面 / 刷新（pagehide）：没到 250ms 的改动立刻写掉', () => {
    const a = useTabs.getState().forkTab()
    const b = useTabs.getState().forkTab()
    getDocStore(a).getState().setTitle('最后一下 A')
    getDocStore(b).getState().setTitle('最后一下 B')
    flushDocWrites()
    expect(storedTitle(a)).toBe('最后一下 A')
    expect(storedTitle(b)).toBe('最后一下 B')
  })
})

describe('文档 id：历史跟着文档走', () => {
  it('老存档没有 docId：开着的 tab 补成 tab id；fork 给新的、记 forkedFrom', () => {
    const old = blankDoc('老文档')
    safeStorage.setItem(key('t_legacy'), JSON.stringify(old))
    const doc = getDocStore('t_legacy').getState().doc
    expect(doc.meta.docId).toBe('t_legacy')
    useTabs.setState((s) => ({ order: [...s.order, 't_legacy'] }))
    const f = useTabs.getState().forkTab('t_legacy')
    const fd = getDocStore(f).getState().doc
    expect(fd.meta.docId).not.toBe('t_legacy')
    expect(fd.meta.forkedFrom).toMatchObject({ docId: 't_legacy', title: '老文档' })
  })

  it('老的 forkedFrom 是 tab id（字符串）→ { docId }', () => {
    const old = blankDoc('老 fork') as Doc
    ;(old.meta as unknown as { forkedFrom: string }).forkedFrom = 't_parent'
    safeStorage.setItem(key('t_oldfork'), JSON.stringify(old))
    expect(getDocStore('t_oldfork').getState().doc.meta.forkedFrom).toEqual({ docId: 't_parent' })
  })

  it('新建的给新 docId；同一个 docId 已经开着时后打开的换新 docId、记 forkedFrom', () => {
    const tabs = useTabs.getState()
    const a = tabs.newTab()
    tabs.openInTab(a, blankDoc('雨夜'))
    const docId = getDocStore(a).getState().doc.meta.docId!
    expect(docId).toMatch(/^d_/)
    const b = useTabs.getState().newTab()
    useTabs.getState().openInTab(b, structuredClone(getDocStore(a).getState().doc))
    const bd = getDocStore(b).getState().doc
    expect(bd.meta.docId).not.toBe(docId)
    expect(bd.meta.forkedFrom).toMatchObject({ docId, title: '雨夜' })
  })

  it('关掉再从最近关闭打开：同一个 docId；整份换掉（从图片导入到当前文档）docId 不变', () => {
    const tabs = useTabs.getState()
    const a = tabs.newTab()
    const doc = blankDoc('关了再开')
    doc.base.prompt[0].chips.push(toChip(parsePrompt('1girl')[0]))
    tabs.openInTab(a, doc)
    const docId = getDocStore(a).getState().doc.meta.docId
    useTabs.getState().closeTab(a)
    const r = useLibrary.getState().recent[0]
    expect(r.doc.meta.docId).toBe(docId)
    const b = useTabs.getState().newTab()
    useTabs.getState().openInTab(b, structuredClone(r.doc))
    expect(getDocStore(b).getState().doc.meta.docId).toBe(docId)
    getDocStore(b).getState().replaceDoc(blankDoc('导入的'))
    expect(getDocStore(b).getState().doc.meta).toMatchObject({ title: '导入的', docId })
  })
})
