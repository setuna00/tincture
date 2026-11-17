import { useEffect, useMemo, useReducer } from 'react'
import { versionKey } from '@/lib/versions'
import type { GenImage } from './storage'
import { useMarks } from './gallery-marks'
import { useLibrary } from './library'
import { getDocStore, useTabs } from './tabs'

const IMPORTED = 'imported'
const snapTitle = (img: Pick<GenImage, 'doc'>) => img.doc.meta.title.trim() || '未命名'

export function nameKey(img: GenImage): string | null {
  if (img.tabId === IMPORTED) return `imp:${versionKey(img.doc)}`
  return img.versionId ? `v:${img.versionId}` : null
}

export function currentDocTitles(): Map<string, string> {
  const out = new Map<string, string>()
  const at = new Map<string, number>()
  const put = (docId: string | undefined, title: string, t: number) => {
    if (!docId || (at.get(docId) ?? -1) > t) return
    at.set(docId, t)
    out.set(docId, title.trim() || '未命名')
  }
  const lib = useLibrary.getState()
  for (const r of lib.recent) put(r.doc.meta.docId, r.doc.meta.title, r.closedAt)
  for (const d of lib.docs) put(d.doc.meta.docId, d.doc.meta.title, d.savedAt)
  const tabs = useTabs.getState()
  for (const t of tabs.order) {
    if (tabs.starts.includes(t)) continue
    const meta = getDocStore(t).getState().doc.meta
    put(meta.docId, meta.title, Number.POSITIVE_INFINITY)
  }
  return out
}

export function useDocTitles(): Map<string, string> {
  const order = useTabs((s) => s.order)
  const starts = useTabs((s) => s.starts)
  const docs = useLibrary((s) => s.docs)
  const recent = useLibrary((s) => s.recent)
  const [tick, bump] = useReducer((x: number) => x + 1, 0)
  useEffect(() => {
    const offs = order.filter((t) => !starts.includes(t)).map((t) => getDocStore(t).subscribe((s, p) => s.doc.meta.title !== p.doc.meta.title && bump()))
    return () => offs.forEach((off) => off())
  }, [order, starts])
  // eslint-disable-next-line react-hooks/exhaustive-deps -- tick / docs / recent 只是重算的时机
  return useMemo(() => currentDocTitles(), [order, starts, docs, recent, tick])
}

export interface Namer {
  doc(img: GenImage): string
  stack(items: readonly GenImage[], cover: GenImage): string
  image(img: GenImage): string
  custom(img: GenImage): boolean
}

export function makeNamer(titles: Map<string, string>, stackNames: Record<string, string>, imageNames: Record<string, string>): Namer {
  const doc = (img: GenImage) => (img.tabId === IMPORTED ? snapTitle(img) : (titles.get(img.tabId) ?? snapTitle(img)))
  const own = (img: GenImage) => {
    const k = nameKey(img)
    return k ? stackNames[k] : undefined
  }
  return {
    doc,
    stack(items, cover) {
      for (const img of [cover, ...[...items].reverse()]) {
        const n = own(img)
        if (n) return n
      }
      return doc(cover)
    },
    image: (img) => imageNames[img.id] ?? own(img) ?? doc(img),
    custom: (img) => !!(imageNames[img.id] ?? own(img)),
  }
}

export function useNamer(): Namer {
  const titles = useDocTitles()
  const stackNames = useMarks((s) => s.stackNames)
  const imageNames = useMarks((s) => s.imageNames)
  return useMemo(() => makeNamer(titles, stackNames, imageNames), [titles, stackNames, imageNames])
}

export function nameNow(img: GenImage): string {
  const m = useMarks.getState()
  return makeNamer(currentDocTitles(), m.stackNames, m.imageNames).image(img)
}

export function renameStack(items: readonly GenImage[], cover: GenImage, name: string) {
  const keys = [...new Set(items.map(nameKey).filter((k): k is string => !!k))]
  if (!keys.length) return
  const m = useMarks.getState()
  const v = name.trim()
  const fallback = makeNamer(currentDocTitles(), {}, {}).doc(cover)
  const next = { ...m.stackNames }
  for (const k of keys) {
    if (!v || v === fallback) delete next[k]
    else next[k] = v
  }
  useMarks.setState({ stackNames: next })
}

export function renameImage(img: GenImage, name: string) {
  const m = useMarks.getState()
  const v = name.trim()
  const inherited = makeNamer(currentDocTitles(), m.stackNames, {}).image(img)
  const next = { ...m.imageNames }
  if (!v || v === inherited) delete next[img.id]
  else next[img.id] = v
  useMarks.setState({ imageNames: next })
}
