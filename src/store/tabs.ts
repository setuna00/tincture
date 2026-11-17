import { useMemo } from 'react'
import { create, useStore } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { toast } from 'sonner'
import { isUnsaved } from '@/lib/doc-equal'
import { newId } from '@/lib/nai'
import type { Doc } from '@/types'
import { createDocStore, normalizeDoc, type DocStore } from './doc'
import { exampleLinks, useLibrary } from './library'
import { blankDoc, introDoc, sampleDoc } from './sample'
import { RELEASE, SEED_EXAMPLES } from './seed'
import { safeStorage } from './storage'
import { latestVersion } from './versions'

const registry = new Map<string, DocStore>()
const docKey = (id: string) => `pe:doc:${id}`

// Cancel debounced writes when closing a tab to avoid resurrecting deleted keys; flush on pagehide to preserve the final edit.
const pending = new Map<string, { timer: ReturnType<typeof setTimeout>; write: () => void }>()

function cancelWrite(id: string) {
  clearTimeout(pending.get(id)?.timer)
  pending.delete(id)
}

export function flushDocWrites() {
  for (const p of [...pending.values()]) p.write()
}

if (typeof window !== 'undefined') window.addEventListener('pagehide', flushDocWrites)

function register(id: string, raw: Doc): DocStore {
  cancelWrite(id)
  let doc = normalizeDoc(raw)
  // Use tab IDs as missing document IDs so migrated tabs retain image history keyed by tab ID.
  if (!doc.meta.docId) doc = { ...doc, meta: { ...doc.meta, docId: id } }
  const store = createDocStore(doc)
  const write = () => {
    cancelWrite(id)
    safeStorage.setItem(docKey(id), JSON.stringify(store.getState().doc))
  }
  store.subscribe((s, prev) => {
    // Undo callbacks may retain closed or replaced stores; only the registered store may persist this tab.
    if (s.doc === prev.doc || registry.get(id) !== store) return
    cancelWrite(id)
    pending.set(id, { timer: setTimeout(write, 250), write })
  })
  // Persist new documents immediately so a reload cannot find a saved tab without its document.
  write()
  registry.set(id, store)
  return store
}

export function getDocStore(id: string): DocStore {
  const hit = registry.get(id)
  if (hit) return hit
  let doc: Doc | null = null
  try {
    const raw = safeStorage.getItem(docKey(id))
    if (raw) doc = JSON.parse(raw) as Doc
  } catch {
    doc = null
  }
  return register(id, doc ?? blankDoc())
}

interface TabsState {
  order: string[]
  activeId: string
  starts: string[]
  links: Record<string, string>
  newTab(): string
  openInTab(id: string, doc: Doc, savedId?: string): void
  saveTab(id: string): boolean
  forkTab(id?: string): string
  closeTab(id: string): void
  activate(id: string): void
  reorder(order: string[]): void
}

const firstId = newId('t')
// Check before creating persist: Zustand v5 can immediately write initial state.
const isFirstVisit = !safeStorage.getItem('pe:tabs')

export const useTabs = create<TabsState>()(
  persist(
    (set, get) => ({
      order: [firstId],
      activeId: firstId,
      starts: [],
      links: {},

      newTab: () => {
        const open = get().starts[0]
        if (open) {
          set({ activeId: open })
          return open
        }
        const id = newId('t')
        set((s) => ({ order: [...s.order, id], activeId: id, starts: [...s.starts, id] }))
        return id
      },
      openInTab: (id, doc, savedId) => {
        const docId = doc.meta.docId
        if (!docId) doc = { ...doc, meta: { ...doc.meta, docId: newId('d') } }
        else if (tabOfDoc(docId, id)) doc = { ...doc, meta: { ...doc.meta, docId: newId('d'), forkedFrom: { docId, version: latestVersion(docId), title: doc.meta.title } } }
        registry.delete(id)
        register(id, doc)
        set((s) => ({ starts: s.starts.filter((x) => x !== id), activeId: id, links: withLink(s.links, id, savedId) }))
      },
      saveTab: (id) => {
        const doc = getDocStore(id).getState().doc
        const lib = useLibrary.getState()
        const linked = get().links[id]
        const first = !linked || !lib.docs.some((d) => d.id === linked)
        const saved = lib.saveDoc(doc, first ? undefined : linked)
        if (first) set((s) => ({ links: withLink(s.links, id, saved.id) }))
        return first
      },
      forkTab: (srcId = get().activeId) => {
        const src = getDocStore(srcId).getState().doc
        const id = newId('t')
        const doc: Doc = structuredClone(src)
        const from = src.meta.docId ?? srcId
        doc.meta = { title: forkTitle(src.meta.title), docId: newId('d'), forkedFrom: { docId: from, version: latestVersion(from), title: src.meta.title }, createdAt: Date.now() }
        register(id, doc)
        set((s) => {
          const order = [...s.order]
          order.splice(order.indexOf(srcId) + 1, 0, id)
          return { order, activeId: id }
        })
        return id
      },
      closeTab: (id) => {
        const { order, activeId, starts, links } = get()
        if (!starts.includes(id)) {
          const doc = getDocStore(id).getState().doc
          const saved = savedOf(links[id])
          if (isUnsaved(doc, saved?.doc)) {
            const removed = useLibrary.getState().pushRecent(doc.meta.title, doc, saved?.id)
            for (const recent of removed) {
              toast(`已从「最近关闭」中移除「${recent.title || '未命名'}」`, {
                action: { label: '撤销', onClick: () => useLibrary.getState().restoreRecent(recent) },
              })
            }
          }
        }
        set((s) => ({ starts: s.starts.filter((x) => x !== id), links: withLink(s.links, id) }))
        if (order.length === 1) {
          const nid = get().newTab()
          set({ order: [nid], activeId: nid })
        } else {
          const i = order.indexOf(id)
          const next = order.filter((x) => x !== id)
          set({ order: next, activeId: activeId === id ? next[Math.min(i, next.length - 1)] : activeId })
        }
        registry.delete(id)
        cancelWrite(id)
        safeStorage.removeItem(docKey(id))
      },
      activate: (id) => set({ activeId: id }),
      reorder: (order) => set({ order }),
    }),
    {
      name: 'pe:tabs',
      storage: createJSONStorage(() => safeStorage),
      partialize: (s) => ({ order: s.order, activeId: s.activeId, starts: s.starts, links: s.links }),
    },
  ),
)

function forkTitle(t: string) {
  const m = t.match(/^(.*) ⑂(\d*)$/)
  if (!m) return `${t} ⑂`
  return `${m[1]} ⑂${(Number(m[2]) || 1) + 1}`
}

// Persist the initial tab list explicitly; otherwise reload treats it as a fresh launch and discards edits to its document.
if (isFirstVisit && !registry.has(firstId)) {
  register(firstId, SEED_EXAMPLES ? sampleDoc(exampleLinks) : RELEASE ? introDoc() : blankDoc('未命名'))
  useTabs.setState({})
}

export const useActiveDocStore = () => getDocStore(useTabs((s) => s.activeId))

function withLink(links: Record<string, string>, tab: string, savedId?: string) {
  const next = { ...links }
  if (savedId) next[tab] = savedId
  else delete next[tab]
  return next
}

const savedOf = (savedId: string | undefined) => (savedId ? useLibrary.getState().docs.find((d) => d.id === savedId) : undefined)

export function isTabUnsaved(id: string) {
  const s = useTabs.getState()
  if (s.starts.includes(id)) return false
  return isUnsaved(getDocStore(id).getState().doc, savedOf(s.links[id])?.doc)
}

export function useTabUnsaved(id: string) {
  const doc = useStore(getDocStore(id), (s) => s.doc)
  const savedId = useTabs((s) => s.links[id])
  const saved = useLibrary((s) => (savedId ? s.docs.find((d) => d.id === savedId) : undefined))
  return useMemo(() => isUnsaved(doc, saved?.doc), [doc, saved])
}

export function tabOfDoc(docId: string, except?: string) {
  const s = useTabs.getState()
  return s.order.find((t) => t !== except && !s.starts.includes(t) && getDocStore(t).getState().doc.meta.docId === docId)
}

export function tabOfSaved(savedId: string) {
  const s = useTabs.getState()
  return s.order.find((t) => s.links[t] === savedId && !s.starts.includes(t))
}
