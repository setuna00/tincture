import { create } from 'zustand'
import { useConnected } from './nai'
import { usePrefs } from './prefs'

export type RightTab = 'gen' | 'copy'

export function useRightTab(): RightTab {
  const pref = usePrefs((s) => s.rightTab)
  const connected = useConnected()
  return pref ?? (connected ? 'gen' : 'copy')
}

export const useParamsPanel = create<{ open: boolean }>()(() => ({ open: false }))

export const useHistoryGrid = create<{ open: boolean }>()(() => ({ open: false }))

export const useLightbox = create<{ open: boolean }>()(() => ({ open: false }))

export const useToolsMenu = create<{ openFor: string | null }>()(() => ({ openFor: null }))
