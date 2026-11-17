import { useEffect, useState } from 'react'
import { loadCatalog } from '@/components/discover/data'
import type { Catalog } from '@/lib/discover'

let catalog: Catalog | null = null
let loading = false

export function prefetchRenamedCatalog() {
  if (catalog || loading) return
  loading = true
  loadCatalog().then(
    (c) => (catalog = c),
    () => (loading = false),
  )
}
export const renamedCatalogReady = () => !!catalog

export function useRenamedCatalog(need: boolean): { catalog: Catalog | null; done: boolean } {
  const [st, setSt] = useState(() => ({ catalog, done: !!catalog }))
  useEffect(() => {
    let alive = true
    if (need && !st.done)
      loadCatalog().then(
        (c) => {
          catalog = c
          if (alive) setSt({ catalog, done: true })
        },
        () => alive && setSt({ catalog: null, done: true }),
      )
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [need])
  return st
}
