// Bind toast undo to its exact history entry and recheck on click; otherwise later edits or Ctrl+Z could undo unrelated data.
import { toast, type ExternalToast } from 'sonner'
import type { DocStore } from '@/store/doc'

export function docUndoToast(store: DocStore, message: string, opts: ExternalToast = {}) {
  const t = store.temporal
  const mark = t.getState().pastStates.at(-1)
  let unsub = () => {}
  const id = toast(message, {
    ...opts,
    action: {
      label: '撤销',
      onClick: () => {
        if (t.getState().pastStates.at(-1) === mark) t.getState().undo()
      },
    },
    onDismiss: () => unsub(),
    onAutoClose: () => unsub(),
  })
  unsub = t.subscribe((s) => {
    if (s.pastStates.at(-1) === mark) return
    unsub()
    toast.dismiss(id)
  })
  return id
}
