import { toast } from 'sonner'
import { confirmSave } from './confirm'
import { notStored } from './storage'
import { getDocStore, isTabUnsaved, useTabs } from './tabs'

export function saveTab(id: string) {
  if (!isTabUnsaved(id)) return
  if (useTabs.getState().saveTab(id) && !notStored('pe:library')) toast.success('已保存至「我的文档」')
}

export async function requestCloseTab(id: string) {
  if (!isTabUnsaved(id)) return useTabs.getState().closeTab(id)
  const choice = await confirmSave(getDocStore(id).getState().doc.meta.title)
  if (choice === 'cancel') return
  if (choice === 'save') useTabs.getState().saveTab(id)
  useTabs.getState().closeTab(id)
}
