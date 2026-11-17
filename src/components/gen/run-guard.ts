// Focus moves onto the spend button when confirmation opens; ignore rapid or repeated Enter to prevent accidental Anlas spending.
import { useState, type KeyboardEvent, type MouseEvent } from 'react'

export const GUARD_MS = 350

export function useRunGuard(run: () => void) {
  const [opened] = useState(() => performance.now())
  return {
    onKeyDown: (e: KeyboardEvent<HTMLButtonElement>) => {
      if (e.repeat && e.key === 'Enter') e.preventDefault()
    },
    onClick: (e: MouseEvent<HTMLButtonElement>) => {
      // Keyboard-synthesized clicks have detail 0, allowing the opening guard to exempt mouse clicks.
      if (e.detail === 0 && performance.now() - opened < GUARD_MS) return void e.preventDefault()
      run()
    },
  }
}
