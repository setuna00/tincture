import { describe, expect, it } from 'vitest'
import { pasteAiReply, pasteImports, type PasteInfo } from './paste-import'

const p = (o: Partial<PasteInfo>): PasteInfo => ({ handled: false, hasText: false, images: 0, dialog: 'none', ...o })

describe('pasteImports：这次 Ctrl+V 归不归导入', () => {
  it('只有图（NAI 的「复制」、截图、复制的图片文件）→ 导入，焦点在不在输入框都一样', () => {
    expect(pasteImports(p({ images: 1 }))).toBe(true)
    expect(pasteImports(p({ images: 3 }))).toBe(true)
  })
  it('有文字就按文字粘贴：只有文字、Word 复制的文字 + 渲染图', () => {
    expect(pasteImports(p({ hasText: true }))).toBe(false)
    expect(pasteImports(p({ hasText: true, images: 1 }))).toBe(false)
  })
  it('没有图片（剪贴板空、复制的是别的文件）→ 不管', () => {
    expect(pasteImports(p({}))).toBe(false)
  })
  it('别人已经接了（模板编辑弹窗收了配图）→ 不管', () => {
    expect(pasteImports(p({ images: 1, handled: true }))).toBe(false)
  })
  it('弹窗：导入弹窗本身开着 → 换成新的；别的弹窗开着 → 归那个弹窗', () => {
    expect(pasteImports(p({ images: 1, dialog: 'import' }))).toBe(true)
    expect(pasteImports(p({ images: 1, dialog: 'other' }))).toBe(false)
    expect(pasteImports(p({ images: 1, dialog: 'ai' }))).toBe(false)
  })
})

describe('pasteAiReply：这次 Ctrl+V 是不是导入 AI 的回答', () => {
  const a = (o: Partial<Parameters<typeof pasteAiReply>[0]>) => pasteAiReply({ handled: false, aiReply: true, dialog: 'none', onEditor: true, ...o })
  it('编辑器页、文字是 AI 的回答 → 开预览；弹窗开着又粘一份 → 换成新的', () => {
    expect(a({})).toBe(true)
    expect(a({ dialog: 'ai' })).toBe(true)
  })
  it('不是回答、在别的页面、别的弹窗开着、别人已经接了 → 不管', () => {
    expect(a({ aiReply: false })).toBe(false)
    expect(a({ onEditor: false })).toBe(false)
    expect(a({ dialog: 'other' })).toBe(false)
    expect(a({ dialog: 'import' })).toBe(false)
    expect(a({ handled: true })).toBe(false)
  })
})
