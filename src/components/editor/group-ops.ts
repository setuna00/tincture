import { allSections } from '@/store/doc'
import { useActions, useDocStore } from '@/store/context'
import { useUi } from '@/store/ui'
import type { Doc } from '@/types'
import { docUndoToast } from '@/components/undo-toast'

export function targetsOf(chipId: string): string[] {
  const ids = useUi.getState().selectedChipIds
  return ids.length > 1 && ids.includes(chipId) ? ids : [chipId]
}

/** NovelAI does not apply tag weights to Text:. */
export const weighable = (doc: Doc, ids: string[]) => {
  const want = new Set(ids)
  return allSections(doc).flatMap((s) => s.chips.filter((c) => want.has(c.id) && c.type !== 'textrender').map((c) => c.id))
}

export function useGroupOps() {
  const actions = useActions()
  const store = useDocStore()
  return {
    remove(ids: string[]) {
      actions.removeChips(ids)
      const ui = useUi.getState()
      if (!ids.some((id) => ui.selectedChipIds.includes(id))) return
      if (ui.selectedChipIds.length > 1) ui.setSelection(ui.selectedChipIds.filter((id) => !ids.includes(id)))
      else ui.select(null)
    },
    extract(ids: string[]) {
      const id = actions.extractChips(ids)
      if (!id) return
      const ui = useUi.getState()
      ui.select(null, id)
      ui.flash(id)
      docUndoToast(store, `已将 ${ids.length} 个 tag 提取为新区块`)
    },
  }
}
