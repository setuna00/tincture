import { characterLabel } from '@/lib/character-label'
import { confirmDelete } from '@/store/confirm'
import { useActions, useDocStore } from '@/store/context'
import { useUi } from '@/store/ui'
import type { GenderValue } from '@/lib/gender'
import type { Character } from '@/types'
import { docUndoToast } from '@/components/undo-toast'

export function useCharacterOps() {
  const actions = useActions()
  const store = useDocStore()
  return {
    add: ({ gender, genderExtra }: GenderValue) => {
      const id = actions.addCharacter(gender, genderExtra)
      if (!id) return
      useUi.getState().selectCharacter(id)
      useUi.getState().flash(id)
    },
    remove: async (c: Character) => {
      const name = characterLabel(store.getState().doc, c)
      const tags = [...c.prompt, ...c.uc].reduce((n, s) => n + s.chips.length, 0)
      const body = `将同时删除正面 ${c.prompt.length} 个、负面 ${c.uc.length} 个区块。`
      if (tags && !(await confirmDelete({ title: `删除角色「${name}」？`, body, action: '删除角色' }))) return
      if (useUi.getState().focusCharacterId === c.id) useUi.getState().selectCharacter(null)
      actions.removeCharacter(c.id)
      docUndoToast(store, `已删除角色「${name}」`)
    },
  }
}
