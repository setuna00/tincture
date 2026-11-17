import type { ContextMenuParams, MenuItemConstructorOptions } from 'electron'

type Params = Pick<ContextMenuParams, 'isEditable'> & { editFlags: Pick<ContextMenuParams['editFlags'], 'canCut' | 'canCopy' | 'canPaste' | 'canSelectAll'> }

export function editMenuTemplate({ isEditable, editFlags: f }: Params): MenuItemConstructorOptions[] | null {
  if (!isEditable) return null
  return [
    { role: 'cut', label: '剪切', enabled: f.canCut },
    { role: 'copy', label: '复制', enabled: f.canCopy },
    { role: 'paste', label: '粘贴', enabled: f.canPaste },
    { type: 'separator' },
    { role: 'selectAll', label: '全选', enabled: f.canSelectAll },
  ]
}
