import { describe, expect, it } from 'vitest'
import { parsePrompt, toChip } from '@/lib/nai'
import type { Doc } from '@/types'
import { useLibrary } from './library'
import { blankDoc } from './sample'
import { safeStorage } from './storage'
import { isTabUnsaved, useTabs } from './tabs'

describe('library v10 → v11：我的文档、最近关闭补默认值', () => {
  it('老的「我的文档」缺后来加的设置（settings.nsfw）：打开不算未保存', async () => {
    const old = blankDoc('雨夜')
    old.base.prompt[0].chips.push(toChip(parsePrompt('1girl')[0]))
    delete (old.settings as Partial<Doc['settings']>).nsfw
    const state = {
      docs: [{ id: 'dt-old', title: '雨夜', doc: old, createdAt: 1, savedAt: 1 }],
      recent: [{ id: 'r-old', title: '雨夜', doc: old, closedAt: 1, savedId: 'dt-old' }],
    }
    safeStorage.setItem('pe:library', JSON.stringify({ state, version: 10 }))
    await useLibrary.persist.rehydrate()

    const lib = useLibrary.getState()
    expect(lib.docs[0].doc.settings.nsfw).toBe(false)
    expect(lib.recent[0].doc.settings.nsfw).toBe(false)

    const tabs = useTabs.getState()
    const tab = tabs.newTab()
    tabs.openInTab(tab, structuredClone(lib.docs[0].doc), 'dt-old')
    expect(isTabUnsaved(tab)).toBe(false)
  })
})

describe('library v12 → v13：文档 id', () => {
  it('被开着的 tab 链着的那份用那个 tab 的 docId（老 tab = tab id）；别的、最近关闭给新的', async () => {
    const a = blankDoc('开着的')
    const b = blankDoc('没开的')
    safeStorage.setItem('pe:tabs', JSON.stringify({ state: { order: ['t_open'], activeId: 't_open', starts: [], links: { t_open: 'dt-a' } }, version: 0 }))
    safeStorage.setItem('pe:doc:t_open', JSON.stringify(a))
    const state = {
      docs: [
        { id: 'dt-a', title: '开着的', doc: a, createdAt: 1, savedAt: 1 },
        { id: 'dt-b', title: '没开的', doc: b, createdAt: 1, savedAt: 1 },
      ],
      recent: [{ id: 'r-1', title: '没开的', doc: b, closedAt: 1, savedId: 'dt-b' }],
    }
    safeStorage.setItem('pe:library', JSON.stringify({ state, version: 12 }))
    await useLibrary.persist.rehydrate()
    const lib = useLibrary.getState()
    expect(lib.docs[0].doc.meta.docId).toBe('t_open')
    expect(lib.docs[1].doc.meta.docId).toMatch(/^d_/)
    expect(lib.recent[0].doc.meta.docId).toMatch(/^d_/)
    expect(lib.recent[0].doc.meta.docId).not.toBe(lib.docs[1].doc.meta.docId)
  })
})
