import type { KeyboardEvent } from 'react'

export function isSendKey(e: KeyboardEvent, key: 'enter' | 'shift') {
  return e.key === 'Enter' && !e.nativeEvent.isComposing && e.keyCode !== 229 && !e.ctrlKey && !e.altKey && !e.metaKey && (key === 'enter' ? !e.shiftKey : e.shiftKey)
}

export function grow(t: HTMLTextAreaElement | null, max = 200) {
  if (!t) return
  t.style.height = 'auto'
  t.style.height = `${Math.min(max, t.scrollHeight)}px`
}
