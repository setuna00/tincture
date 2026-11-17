import { useRef, useState, type ChangeEvent, type FocusEvent, type KeyboardEvent } from 'react'

type Field = HTMLInputElement | HTMLTextAreaElement

export const composing = (e: KeyboardEvent) => e.nativeEvent.isComposing || e.keyCode === 229

export function useDraftField({
  value,
  onCommit,
  onCancel,
  enterBlurs = false,
  multiline = false,
  select = true,
}: {
  value: string
  onCommit: (text: string) => void
  onCancel?: () => void
  enterBlurs?: boolean
  multiline?: boolean
  select?: boolean
}) {
  const [draft, setDraft] = useState<string | null>(null)
  // React batches state updates; the ref lets an Escape-triggered blur read the cancelled draft immediately.
  const live = useRef<string | null>(null)
  const settled = useRef(false)
  const put = (t: string | null) => {
    live.current = t
    setDraft(t)
  }
  const end = (commit: boolean) => {
    if (settled.current) return
    settled.current = true
    const t = live.current === null ? null : live.current.trim()
    put(null)
    if (commit && t !== null && t !== value.trim()) onCommit(t)
    else onCancel?.()
  }
  return {
    draft,
    reset: () => put(null),
    props: {
      value: draft ?? value,
      onChange: (e: ChangeEvent<Field>) => {
        settled.current = false
        put(e.target.value)
      },
      onFocus: (e: FocusEvent<Field>) => {
        settled.current = false
        if (select) e.currentTarget.select()
      },
      onBlur: () => end(true),
      onKeyDown: (e: KeyboardEvent<Field>) => {
        if (composing(e)) return
        if (e.key === 'Enter' && !multiline) {
          e.preventDefault()
          if (enterBlurs) e.currentTarget.blur()
          else end(true)
        } else if (e.key === 'Escape') {
          end(false)
          e.currentTarget.blur()
        }
      },
    },
  }
}
