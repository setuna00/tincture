import { createContext, useContext } from 'react'
import { useStore, type StoreApi } from 'zustand'
import { createStore } from 'zustand/vanilla'
import type { TemporalState } from 'zundo'
import type { DocState, DocStore } from './doc'

export const DocStoreContext = createContext<DocStore | null>(null)

export function useDocStore(): DocStore {
  const s = useContext(DocStoreContext)
  if (!s) throw new Error('useDocStore 必须在 DocStoreContext 里使用')
  return s
}

export function useDoc<T>(selector: (s: DocState) => T): T {
  return useStore(useDocStore(), selector)
}

const NO_DOC = createStore<DocState | null>(() => null)

export function useMaybeDoc<T>(selector: (s: DocState) => T, fallback: T): T {
  const store = useContext(DocStoreContext)
  return useStore((store ?? NO_DOC) as StoreApi<DocState | null>, (s) => (s ? selector(s) : fallback))
}

export function useActions() {
  return useDocStore().getState()
}

export function useHistory<T>(selector: (s: TemporalState<{ doc: DocState['doc'] }>) => T): T {
  return useStore(useDocStore().temporal, selector)
}
