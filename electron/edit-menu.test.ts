import { expect, it } from 'vitest'
import { editMenuTemplate } from './edit-menu.ts'

const flags = (on: boolean) => ({ canCut: on, canCopy: on, canPaste: on, canSelectAll: on })

it('不可编辑的地方（选中的普通文字、图片、空白）：不弹', () => {
  expect(editMenuTemplate({ isEditable: false, editFlags: flags(true) })).toBeNull()
})

it('可编辑：剪切 / 复制 / 粘贴 / 全选，全选前一条分隔线', () => {
  const t = editMenuTemplate({ isEditable: true, editFlags: flags(true) })!
  expect(t.map((x) => x.role ?? x.type)).toEqual(['cut', 'copy', 'paste', 'separator', 'selectAll'])
  expect(t.filter((x) => x.label).map((x) => x.label)).toEqual(['剪切', '复制', '粘贴', '全选'])
  expect(t.filter((x) => x.role).every((x) => x.enabled)).toBe(true)
})

it('没选中文字、剪贴板空：剪切 / 复制 / 粘贴灰着，全选照 editFlags', () => {
  const t = editMenuTemplate({ isEditable: true, editFlags: { canCut: false, canCopy: false, canPaste: false, canSelectAll: true } })!
  expect(Object.fromEntries(t.filter((x) => x.role).map((x) => [x.role, x.enabled]))).toEqual({ cut: false, copy: false, paste: false, selectAll: true })
})
