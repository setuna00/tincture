import { createContext, useContext, useDeferredValue, useMemo } from 'react'
import { emptyQuery, facetActive, matchQuery, parseQuery, passFacet, type FacetKey, type Filters, type GalleryMarks } from '@/lib/gallery'
import { adoptSource, buildEntries, chipsSig, dirImages, seriesOf, sortEntries, templatesUsed, type Entry, type GalleryDir, type SortBy, type SortDir, type StackMode } from '@/lib/gallery-stacks'
import { factsFor, IMPORTED, useGallery, useGalleryUi, useMarks, type Scope } from '@/store/gallery'
import { makeNamer, useDocTitles, type Namer } from '@/store/gallery-names'
import type { GenImage } from '@/store/gen'
import { useLibrary } from '@/store/library'
import { usePrefs } from '@/store/prefs'

const NO_COVERS: Record<string, number> = {}

export interface DocGroup {
  tabId: string
  title: string
  count: number
  latest: number
}

export function docGroups(images: readonly GenImage[], trash: GalleryMarks['trash']): DocGroup[] {
  const by = new Map<string, DocGroup>()
  for (const img of images) {
    if (img.id in trash) continue
    const g = by.get(img.tabId)
    if (!g) by.set(img.tabId, { tabId: img.tabId, title: img.doc.meta.title.trim() || '未命名', count: 1, latest: img.createdAt })
    else {
      g.count++
      if (img.createdAt > g.latest) {
        g.latest = img.createdAt
        g.title = img.doc.meta.title.trim() || '未命名'
      }
    }
  }
  const imp = by.get(IMPORTED)
  if (imp) imp.title = '导入的图'
  return [...by.values()].sort((a, b) => (a.tabId === IMPORTED ? 1 : b.tabId === IMPORTED ? -1 : b.latest - a.latest))
}

export interface TplGroup {
  id: string
  name: string
  kind: 'section' | 'character'
  count: number
}

export function useTemplateUse(images: readonly GenImage[] | null) {
  const sections = useLibrary((s) => s.sectionTemplates)
  const chars = useLibrary((s) => s.characterTemplates)
  return useMemo(() => {
    const sigs = new Map<string, string>()
    for (const t of sections) if (t.chips.length) sigs.set(chipsSig(t.chips), t.id)
    const sIds = new Set(sections.map((t) => t.id))
    const cIds = new Set(chars.map((t) => t.id))
    const use = new Map<string, string[]>()
    for (const img of images ?? []) {
      const ids = templatesUsed(img.doc, sigs, sIds, cIds)
      if (ids.length) use.set(img.id, ids)
    }
    const names = new Map<string, { name: string; kind: TplGroup['kind'] }>([
      ...sections.map((t) => [t.id, { name: t.name, kind: 'section' as const }] as const),
      ...chars.map((t) => [t.id, { name: t.name, kind: 'character' as const }] as const),
    ])
    return { use, names }
  }, [images, sections, chars])
}

export function tplGroups(images: readonly GenImage[], use: Map<string, string[]>, names: Map<string, { name: string; kind: TplGroup['kind'] }>, trash: GalleryMarks['trash']): TplGroup[] {
  const n = new Map<string, number>()
  for (const img of images) {
    if (img.id in trash) continue
    for (const id of use.get(img.id) ?? []) n.set(id, (n.get(id) ?? 0) + 1)
  }
  return [...n]
    .flatMap(([id, count]) => {
      const t = names.get(id)
      return t ? [{ id, name: t.name, kind: t.kind, count }] : []
    })
    .sort((a, b) => (a.kind === b.kind ? b.count - a.count || a.name.localeCompare(b.name) : a.kind === 'section' ? -1 : 1))
}

export interface ScopeCtx {
  dirs: readonly GalleryDir[]
  tplUse: Map<string, string[]>
}

export function inScope(img: GenImage, scope: Scope, m: GalleryMarks, ctx: ScopeCtx, dirSet?: Set<string>): boolean {
  const trashed = img.id in m.trash
  if (scope === 'trash') return trashed
  if (trashed) return false
  if (scope === 'all') return true
  if (scope === 'fav') return !!m.fav[img.id]
  if (scope.startsWith('dir:')) return (dirSet ?? dirImages(ctx.dirs, scope.slice(4))).has(img.id)
  if (scope.startsWith('tpl:')) return !!ctx.tplUse.get(img.id)?.includes(scope.slice(4))
  return img.tabId === scope.slice(4)
}

export const SCOPE_LABEL = { all: '全部', fav: '收藏', trash: '回收站' } as const

export function scopeLabel(scope: Scope, groups: DocGroup[], dirs: readonly GalleryDir[], tpls: TplGroup[]): string {
  if (scope === 'all' || scope === 'fav' || scope === 'trash') return SCOPE_LABEL[scope]
  if (scope.startsWith('dir:')) return dirs.find((d) => d.id === scope.slice(4))?.name ?? ''
  if (scope.startsWith('tpl:')) return tpls.find((t) => t.id === scope.slice(4))?.name ?? ''
  return groups.find((g) => g.tabId === scope.slice(4))?.title ?? '未命名'
}

const filtersActive = (f: Filters) => facetActive(f.model) || facetActive(f.artist) || facetActive(f.character) || facetActive(f.tag)

export const FACET_KEYS: FacetKey[] = ['model', 'artist', 'character', 'tag']

export function facetValues(img: GenImage, key: FacetKey): readonly string[] {
  const f = factsFor(img)
  return key === 'model' ? [f.model] : key === 'artist' ? f.artists : key === 'character' ? f.characters : f.plain
}

export function passFilters(img: GenImage, filters: Filters, except?: FacetKey): boolean {
  return FACET_KEYS.every((k) => k === except || passFacet(facetValues(img, k), k === 'model' ? { ...filters.model, any: true } : filters[k]))
}

export const SORT_LABEL: Record<SortBy, string> = { time: '生成时间', name: '名称', tags: 'tag 数' }
export const DIR_LABEL: Record<SortBy, [SortDir, string][]> = {
  time: [
    ['desc', '最新的在前'],
    ['asc', '最早的在前'],
  ],
  name: [
    ['asc', 'A → Z'],
    ['desc', 'Z → A'],
  ],
  tags: [
    ['desc', 'tag 多的在前'],
    ['asc', 'tag 少的在前'],
  ],
}
export const dirLabel = (by: SortBy, dir: SortDir) => DIR_LABEL[by].find(([d]) => d === dir)![1]

export const NamerContext = createContext<Namer>(makeNamer(new Map(), {}, {}))
export const useGalleryNamer = () => useContext(NamerContext)

export const tagCount = (img: GenImage) => {
  const f = factsFor(img)
  return f.tags.length + f.artists.length
}

export const entryName = (namer: Namer, e: Entry) => (e.kind === 'one' ? namer.image(e.img) : namer.stack(e.stack.items, e.stack.cover))
export const entryTags = (e: Entry) => tagCount(e.kind === 'one' ? e.img : e.stack.cover)

export function stackMode(stack: boolean, near: boolean): StackMode {
  return !stack ? 'off' : near ? 'near' : 'version'
}

export function useGalleryView() {
  const raw = useGallery((s) => s.images)
  const images = useMemo(() => (raw ? adoptSource(raw) : raw), [raw])
  const fav = useMarks((s) => s.fav)
  const trash = useMarks((s) => s.trash)
  const covers = useMarks((s) => s.covers ?? NO_COVERS)
  const dirs = useMarks((s) => s.dirs)
  const scope = useGalleryUi((s) => s.scope)
  const filters = useGalleryUi((s) => s.filters)
  const query = useDeferredValue(useGalleryUi((s) => s.query))
  const sortBy = usePrefs((s) => s.gallerySortBy)
  const sortDir = usePrefs((s) => s.gallerySortDir)
  const titles = useDocTitles()
  const stackNames = useMarks((s) => s.stackNames)
  const imageNames = useMarks((s) => s.imageNames)
  const namer = useMemo(() => makeNamer(titles, stackNames, imageNames), [titles, stackNames, imageNames])
  const mode = stackMode(
    usePrefs((s) => s.galleryStack),
    usePrefs((s) => s.galleryNear),
  )
  const { use: tplUse, names } = useTemplateUse(images)
  const scoped = useMemo(() => {
    const dirSet = scope.startsWith('dir:') ? dirImages(dirs, scope.slice(4)) : undefined
    return (images ?? []).filter((img) => inScope(img, scope, { fav, trash }, { dirs, tplUse }, dirSet))
  }, [images, scope, fav, trash, dirs, tplUse])
  const searched = useMemo(() => {
    const q = parseQuery(query)
    return emptyQuery(q) ? scoped : scoped.filter((img) => matchQuery(`${factsFor(img).text}\n${namer.image(img).toLowerCase()}`, q))
  }, [scoped, query, namer])
  const visible = useMemo(() => {
    const out = filtersActive(filters) ? searched.filter((img) => passFilters(img, filters)) : searched
    return sortBy === 'time' && sortDir === 'asc' ? [...out].sort((a, b) => a.createdAt - b.createdAt || a.index - b.index) : out
  }, [searched, filters, sortBy, sortDir])
  const series = useMemo(() => seriesOf((images ?? []).filter((x) => !(x.id in trash)), IMPORTED), [images, trash])
  const order = useMemo(() => (list: readonly Entry[]) => sortEntries(list, sortBy, sortDir, (e) => entryName(namer, e), entryTags), [sortBy, sortDir, namer])
  const entries: Entry[] = useMemo(() => order(buildEntries(visible, mode, fav, series, IMPORTED, covers)), [visible, mode, fav, series, order, covers])
  const groups = useMemo(() => docGroups(images ?? [], trash).map((g) => (g.tabId !== IMPORTED && titles.has(g.tabId) ? { ...g, title: titles.get(g.tabId)! } : g)), [images, trash, titles])
  const tpls = useMemo(() => tplGroups(images ?? [], tplUse, names, trash), [images, tplUse, names, trash])
  return { loaded: images !== null, all: images ?? [], scoped, searched, visible, entries, mode, groups, tpls, dirs, tplUse, namer, order, narrowed: !emptyQuery(parseQuery(query)) || filtersActive(filters) }
}

export const ROW_MIN = 120
export const ROW_MAX = 360

export const overlayOpen = () => !!document.querySelector('[role=dialog], [role=menu], [role=alertdialog], [data-slot=popover-content]')

export function selectOne(id: string) {
  useGalleryUi.getState().set({ selected: [id], anchor: id, cursor: id })
}

export function selectIds(ids: readonly string[]) {
  useGalleryUi.getState().set({ selected: [...ids], anchor: ids[0] ?? null, cursor: ids[0] ?? null })
}

export function enterStack(key: string) {
  useGalleryUi.getState().set({ inStack: key, selected: [], anchor: null, cursor: null })
}

export function openSide(ids: readonly string[]) {
  if (ids.length < 2) return
  useGalleryUi.getState().set({ side: [...ids], viewing: null })
}

export function selectedStack(entries: readonly Entry[], selected: readonly string[]) {
  if (selected.length < 2) return null
  const set = new Set(selected)
  for (const e of entries) if (e.kind === 'stack' && e.stack.items.length === set.size && e.stack.items.every((x) => set.has(x.id))) return e.stack
  return null
}

export const RIGHT_EDGE_PR = 'pr-[max(1.5rem,calc(var(--wco-w)-30px))]'
