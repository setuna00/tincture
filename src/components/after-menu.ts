// Radix restores trigger focus after its exit animation; defer new inputs and popovers to onCloseAutoFocus to avoid blur or dismissal.
import { useRef } from 'react'

export function useAfterMenu({ refocus = true }: { refocus?: boolean } = {}) {
  const next = useRef<(() => void) | null>(null)
  return {
    later: (fn: () => void) => {
      next.current = fn
    },
    onCloseAutoFocus: (e: Event) => {
      const fn = next.current
      next.current = null
      if (fn || !refocus) e.preventDefault()
      fn?.()
    },
  }
}

export type AfterMenu = ReturnType<typeof useAfterMenu>
