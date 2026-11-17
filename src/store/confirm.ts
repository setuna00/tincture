import type { ReactNode } from 'react'
import { create } from 'zustand'

export type ConfirmChoice = 'ok' | 'discard' | 'cancel'

export interface ConfirmAsk {
  kind: 'delete' | 'save' | 'spend'
  title: string
  body: ReactNode
  action: string
  price?: number
  refocus?: HTMLElement | null
  resolve: (choice: ConfirmChoice) => void
}

export const useConfirm = create<{ ask: ConfirmAsk | null }>(() => ({ ask: null }))

export function closeConfirm(choice: ConfirmChoice, ask: ConfirmAsk | null = useConfirm.getState().ask) {
  if (!ask || useConfirm.getState().ask !== ask) return
  useConfirm.setState({ ask: null })
  ask.resolve(choice)
}

function openAsk(o: Omit<ConfirmAsk, 'resolve'>): { ask: ConfirmAsk; choice: Promise<ConfirmChoice> } {
  closeConfirm('cancel')
  let ask!: ConfirmAsk
  // Trap dialog focus so a closing Radix menu cannot restore focus to its trigger outside the dialog.
  const choice = new Promise<ConfirmChoice>((resolve) => {
    ask = { ...o, resolve }
  })
  useConfirm.setState({ ask })
  return { ask, choice }
}

function open(o: Omit<ConfirmAsk, 'resolve'>): Promise<ConfirmChoice> {
  return openAsk(o).choice
}

export async function confirmDelete(o: Omit<ConfirmAsk, 'resolve' | 'kind'>): Promise<boolean> {
  return (await open({ ...o, kind: 'delete' })) === 'ok'
}

export async function confirmSave(title: string): Promise<'save' | 'discard' | 'cancel'> {
  const c = await open({ kind: 'save', title: `保存对「${title}」的更改？`, body: '不保存将移至新标签页的「最近关闭」', action: '保存' })
  return c === 'ok' ? 'save' : c
}

export function confirmSpend(o: { title: string; body: string; action: string; price: number }): { ok: Promise<boolean>; close: () => void } {
  const { ask, choice } = openAsk({ ...o, kind: 'spend' })
  return { ok: choice.then((c) => c === 'ok'), close: () => closeConfirm('cancel', ask) }
}
