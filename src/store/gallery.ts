import { create } from 'zustand'
import { toast } from 'sonner'
import { emptyFilters, factsOf, forget, restore, setFav, splitCharacters, type DocFacts, type Filters, type GalleryMarks } from '@/lib/gallery'
import { dirImages, dirSubtree } from '@/lib/gallery-stacks'
import { genderOptions } from '@/lib/gender'
import { newId, parsePrompt, toChip } from '@/lib/nai'
import { naiModelId } from '@/lib/nai-api'
import { buildImportedDoc, importItems, metaSource, parseNaiImage, readImageMeta, type ImportItem } from '@/lib/nai-image'
import { modelName } from '@/lib/nai-models'
import { effectiveSettings } from '@/lib/nai-write'
import { aliasOf, chipZh, lookupTag } from '@/lib/tagdb'
import { dropThumb } from '@/lib/thumbs'
import { confirmDelete } from './confirm'
import { byNewest, forgetImages, useGen, type GenImage } from './gen'
import { isImage } from './import'
import { newDocSettings, NSFW_MAX_LEVEL, usePrefs } from './prefs'
import { moveImagesToTrash, useMarks } from './gallery-marks'
import { nameKey } from './gallery-names'
import { useLibrary } from './library'
import { imageStore } from './storage'
import { tabOfDoc, tabOfSaved, useTabs } from './tabs'
import { loadVersions, recordVersion } from './versions'
import type { Doc } from '@/types'

export const IMPORTED = 'imported'
export { useMarks }

interface GalleryData {
  images: GenImage[] | null
  load(): Promise<void>
}

let loading: Promise<void> | null = null

export const useGallery = create<GalleryData>()((set, get) => ({
  images: null,
  load: () =>
    (loading ??= (async () => {
      let list: GenImage[] = []
      try {
        list = await imageStore.list()
      } catch {
      }
      // Merge in-memory results because a generation can finish before its image upload reaches the library.
      const ids = new Set(list.map((x) => x.id))
      for (const l of Object.values(useGen.getState().history)) for (const x of l ?? []) if (!ids.has(x.id)) list.push(x)
      if (!get().images) set({ images: list.sort(byNewest) })
    })()),
}))

useGen.subscribe((s, prev) => {
  if (s.history === prev.history) return
  const images = useGallery.getState().images
  if (!images) return
  const now = new Map<string, GenImage>()
  for (const l of Object.values(s.history)) for (const x of l ?? []) now.set(x.id, x)
  const gone = new Set<string>()
  for (const [tab, l] of Object.entries(prev.history)) {
    if (l === s.history[tab]) continue
    for (const x of l ?? []) if (!now.has(x.id)) gone.add(x.id)
  }
  const have = new Set(images.map((x) => x.id))
  const added = [...now.values()].filter((x) => !have.has(x.id))
  if (!added.length && !gone.size) return
  useGallery.setState({ images: [...images.filter((x) => !gone.has(x.id)), ...added].sort(byNewest) })
})

export interface Facts extends DocFacts {
  model: string
  characters: string[]
  plain: string[]
  text: string
}
const isCharacterTag = (t: string) => {
  const alias = aliasOf(t)
  return (lookupTag(t) ?? (alias ? lookupTag(alias) : undefined))?.category === 'character'
}
const factsCache = new WeakMap<GenImage, Facts>()
export function factsFor(img: GenImage): Facts {
  let f = factsCache.get(img)
  if (!f) {
    const d = factsOf(img.doc)
    const zh = [...d.tags, ...d.artists.map((a) => `artist:${a}`)].flatMap((t) => {
      const parsed = parsePrompt(t)[0]
      const z = parsed ? chipZh(toChip(parsed)) : undefined
      return z ? [z.toLowerCase()] : []
    })
    f = { ...d, ...splitCharacters(d.tags, isCharacterTag), model: modelName(img.doc.settings.model), text: [...d.tags, ...d.artists.map((a) => `artist:${a}`), ...zh, ...d.free].join('\n') }
    factsCache.set(img, f)
  }
  return f
}

const marks = (): GalleryMarks => {
  const { fav, trash } = useMarks.getState()
  return { fav, trash }
}

export function rememberSearch(q: string) {
  const t = q.trim()
  if (!t) return
  useMarks.setState((s) => ({ recent: [t, ...s.recent.filter((x) => x !== t)].slice(0, 5) }))
}
export const forgetSearch = (q: string) => useMarks.setState((s) => ({ recent: s.recent.filter((x) => x !== q) }))

export function toggleFav(ids: readonly string[], force?: boolean) {
  const { fav, trash } = useMarks.getState()
  ids = ids.filter((id) => !(id in trash))
  if (!ids.length) return
  const on = force ?? ids.some((id) => !fav[id])
  useMarks.setState(setFav(marks(), ids, on))
}

export async function trashImages(ids: readonly string[]) {
  if (!ids.length) return
  const fresh = ids.filter((id) => !(id in useMarks.getState().trash))
  if (!fresh.length) return
  const ok = await confirmDelete({ title: fresh.length > 1 ? `将 ${fresh.length} 张图片移至回收站？` : '将这张图片移至回收站？', body: '可在回收站中恢复', action: '移至回收站' })
  if (!ok) return
  moveImagesToTrash(fresh)
  useGalleryUi.getState().set({ selected: [], anchor: null })
}

export function restoreImages(ids: readonly string[]) {
  if (!ids.length) return
  useMarks.setState(restore(marks(), ids))
  useGalleryUi.getState().set({ selected: [], anchor: null })
  toast(ids.length > 1 ? `已恢复 ${ids.length} 张图片` : '已恢复图片', { id: 'gallery-restore' })
}

export async function purgeImages(ids: readonly string[], ask: { title: string; action: string } = { title: ids.length > 1 ? `永久删除 ${ids.length} 张图片？` : '永久删除这张图片？', action: '永久删除' }) {
  if (!ids.length) return
  if (!(await confirmDelete({ ...ask, body: '删除后无法恢复' }))) return
  const set = new Set(ids)
  const images = useGallery.getState().images ?? []
  const gone = images.filter((x) => set.has(x.id))
  useGallery.setState({ images: images.filter((x) => !set.has(x.id)) })
  useMarks.setState(forget(marks(), ids))
  useMarks.setState((s) => ({
    dirs: s.dirs.map((d) => (ids.some((id) => d.items[id]) ? { ...d, items: Object.fromEntries(Object.entries(d.items).filter(([k]) => !set.has(k))) } : d)),
    imageNames: Object.fromEntries(Object.entries(s.imageNames).filter(([k]) => !set.has(k))),
    covers: Object.fromEntries(Object.entries(s.covers ?? {}).filter(([k]) => !set.has(k))),
  }))
  useGalleryUi.getState().set({ selected: [], anchor: null, viewing: null, side: null })
  forgetImages(set)
  for (const img of gone) {
    imageStore.purge(img)
    dropThumb(img.id)
  }
  toast(gone.length > 1 ? `已永久删除 ${gone.length} 张图片` : '已永久删除图片', { id: 'gallery-purge' })
}

export function emptyTrash() {
  const ids = Object.keys(useMarks.getState().trash).filter((id) => useGallery.getState().images?.some((x) => x.id === id))
  return purgeImages(ids, { title: `清空回收站中的 ${ids.length} 张图片？`, action: '清空回收站' })
}

export type Scope = 'all' | 'fav' | 'trash' | `dir:${string}` | `doc:${string}` | `tpl:${string}`

export interface GalleryUi {
  scope: Scope
  query: string
  filters: Filters
  selected: string[]
  anchor: string | null
  cursor: string | null
  viewing: string | null
  inStack: string | null
  side: string[] | null
  renamingDir: string | null
  renamingName: boolean
  menu: 'cell' | 'blank'
  set(patch: Partial<Omit<GalleryUi, 'set'>>): void
}

export const useGalleryUi = create<GalleryUi>()((set) => ({
  scope: 'all',
  query: '',
  filters: emptyFilters(),
  selected: [],
  anchor: null,
  cursor: null,
  viewing: null,
  inStack: null,
  side: null,
  renamingDir: null,
  renamingName: false,
  menu: 'cell',
  set: (patch) => set(patch),
}))

const dirName = (id: string) => useMarks.getState().dirs.find((d) => d.id === id)?.name ?? ''

export function createDir(ids: readonly string[] = []): string {
  const id = newId('dir')
  const now = Date.now()
  const names = new Set(useMarks.getState().dirs.map((d) => d.name))
  let name = '新合集'
  for (let i = 2; names.has(name); i++) name = `新合集 ${i}`
  useMarks.setState((s) => ({ dirs: [...s.dirs, { id, name, parent: null, items: Object.fromEntries(ids.map((x) => [x, now])), createdAt: now }] }))
  useGalleryUi.getState().set({ renamingDir: id })
  if (!usePrefs.getState().galleryLeftOpen) usePrefs.getState().set({ galleryLeftOpen: true })
  return id
}

export function renameDir(id: string, name: string) {
  const n = name.trim()
  useGalleryUi.getState().set({ renamingDir: null })
  if (!n) return
  useMarks.setState((s) => ({ dirs: s.dirs.map((d) => (d.id === id ? { ...d, name: n } : d)) }))
}

export async function deleteDir(id: string) {
  const { dirs } = useMarks.getState()
  const d = dirs.find((x) => x.id === id)
  if (!d) return
  const sub = dirSubtree(dirs, id)
  const n = dirImages(dirs, id).size
  const ok = await confirmDelete({ title: `删除合集「${d.name}」？`, body: `合集中的 ${n} 张图片将从合集中移除，图片本身不受影响。`, action: '删除合集' })
  if (!ok) return
  const gone = dirs.filter((x) => sub.includes(x.id))
  useMarks.setState((s) => ({ dirs: s.dirs.filter((x) => !sub.includes(x.id)) }))
  const ui = useGalleryUi.getState()
  if (ui.scope.startsWith('dir:') && sub.includes(ui.scope.slice(4))) ui.set({ scope: 'all', selected: [], anchor: null, viewing: null, side: null, inStack: null })
  toast(`已删除合集「${d.name}」`, { id: 'gallery-dir-delete', action: { label: '撤销', onClick: () => useMarks.setState((s) => ({ dirs: [...s.dirs, ...gone] })) } })
}

export function addToDir(id: string, ids: readonly string[]) {
  const name = dirName(id)
  const fresh = ids.filter((x) => !useMarks.getState().dirs.find((d) => d.id === id)?.items[x])
  if (!fresh.length) {
    toast(ids.length > 1 ? `${ids.length} 张图片已在「${name}」中` : `图片已在「${name}」中`, { id: 'gallery-dir-add' })
    return
  }
  const now = Date.now()
  useMarks.setState((s) => ({ dirs: s.dirs.map((d) => (d.id === id ? { ...d, items: { ...d.items, ...Object.fromEntries(fresh.map((x) => [x, now])) } } : d)) }))
  toast(fresh.length > 1 ? `已将 ${fresh.length} 张图片加入「${name}」` : `已将图片加入「${name}」`, { id: 'gallery-dir-add', action: { label: '撤销', onClick: () => dropFromDir(id, fresh) } })
}

function dropFromDir(id: string, ids: readonly string[]) {
  const set = new Set(ids)
  useMarks.setState((s) => ({ dirs: s.dirs.map((d) => (d.id === id ? { ...d, items: Object.fromEntries(Object.entries(d.items).filter(([k]) => !set.has(k))) } : d)) }))
}

export function removeFromDir(id: string, ids: readonly string[]) {
  const before = useMarks.getState().dirs.find((d) => d.id === id)
  const set = new Set(ids)
  if (!before || !Object.keys(before.items).some((k) => set.has(k))) return
  dropFromDir(id, ids)
  const n = ids.length
  toast(n > 1 ? `已从「${dirName(id)}」中移除 ${n} 张图片` : `已从「${dirName(id)}」中移除图片`, {
    id: 'gallery-dir-remove',
    action: { label: '撤销', onClick: () => useMarks.setState((s) => ({ dirs: s.dirs.map((d) => (d.id === id ? before : d)) })) },
  })
}

export async function openImage(img: GenImage) {
  if (img.tabId === IMPORTED) return adoptImported(img)
  const docId = img.tabId
  const tabs = useTabs.getState()
  const open = tabOfDoc(docId)
  if (open) tabs.activate(open)
  else {
    const lib = useLibrary.getState()
    const recent = lib.recent.find((r) => r.doc.meta.docId === docId)
    const saved = lib.docs.find((d) => d.doc.meta.docId === docId)
    let doc: Doc
    let link: string | undefined
    if (recent && (!saved || recent.closedAt >= saved.savedAt)) {
      doc = structuredClone(recent.doc)
      link = recent.savedId && lib.docs.some((d) => d.id === recent.savedId) && !tabOfSaved(recent.savedId) ? recent.savedId : undefined
      lib.removeRecent(recent.id)
    } else if (saved) {
      doc = structuredClone(saved.doc)
      link = saved.id
    } else {
      const latest = (await loadVersions(docId)).at(-1)
      doc = structuredClone(latest?.snapshot ?? img.doc)
      doc.meta = { ...doc.meta, docId, createdAt: Date.now() }
    }
    const id = useTabs.getState().newTab()
    useTabs.getState().openInTab(id, doc, link)
  }
  showInEditor(docId, img.id)
}

function showInEditor(docId: string, imgId: string) {
  useGen.getState().select(docId, imgId)
  usePrefs.getState().set({ rightTab: 'gen' })
  location.hash = '/'
}

async function adoptImported(img: GenImage) {
  const docId = newId('d')
  const doc = structuredClone(img.doc)
  doc.meta = { title: img.doc.meta.title, docId, createdAt: Date.now() }
  await loadVersions(docId)
  const v = recordVersion(doc, { kind: 'gen' })
  const moved: GenImage = { ...img, tabId: docId, ...(v ? { versionId: v.id, version: v.n } : {}) }
  const oldKey = nameKey(img)
  const newKey = nameKey(moved)
  const named = oldKey ? useMarks.getState().stackNames[oldKey] : undefined
  if (named && newKey) useMarks.setState((s) => ({ stackNames: { ...s.stackNames, [newKey]: named } }))
  try {
    await imageStore.put(moved, await imageStore.blob(img.id))
  } catch {
  }
  useGallery.setState((s) => ({ images: s.images?.map((x) => (x.id === img.id ? moved : x)) ?? null }))
  useGen.setState((s) => ({ history: { ...s.history, [docId]: [moved] }, imageDocs: s.imageDocs ? new Set([...s.imageDocs, docId]) : s.imageDocs }))
  const tabs = useTabs.getState()
  tabs.openInTab(tabs.newTab(), doc)
  showInEditor(docId, moved.id)
}

/** Images without NAI metadata use an empty document, seed 0 and an empty model as sentinels when any is enabled. */
export async function externalRecord(file: File, tabId: string, any = false): Promise<{ rec: GenImage; blob: Blob } | null> {
  const prefs = usePrefs.getState()
  const meta = await readImageMeta(file).catch(() => null)
  const nai = !!meta && metaSource(meta) === 'nai'
  if (!nai && !any) return null
  let doc: Doc
  let seed = 0
  let model = ''
  let width = 0
  let height = 0
  if (nai) {
    const p = parseNaiImage(meta)
    const genders = genderOptions(prefs, NSFW_MAX_LEVEL[prefs.nsfw], (t) => lookupTag(t)?.level ?? 0)
    const picks = new Set<ImportItem>(Object.values(importItems(p)).flat())
    doc = buildImportedDoc(p, picks, { base: null, appendChars: false, genders, nsfw: prefs.nsfw !== 'off' }, newDocSettings()).doc
    seed = p.gen.seed ?? 0
    model = naiModelId(effectiveSettings(doc.settings))
    width = p.gen.width
    height = p.gen.height
  } else doc = { base: { prompt: [], uc: [] }, characters: [], settings: newDocSettings(), meta: { title: '未命名', createdAt: Date.now() } }
  doc.meta.title = file.name.replace(/\.[^.]+$/, '') || doc.meta.title
  try {
    const bmp = await createImageBitmap(file)
    width = bmp.width
    height = bmp.height
    bmp.close()
  } catch {
    return null
  }
  const blob = new Blob([file], { type: file.type || 'image/png' })
  return { rec: { id: newId('img'), tabId, batch: newId('b'), index: 0, createdAt: Date.now(), seed, width, height, model, mime: blob.type, size: blob.size, doc }, blob }
}

export async function importToGallery(files: File[], any = false): Promise<string[]> {
  const pics = files.filter(isImage)
  const recs: GenImage[] = []
  const blobs = new Map<number, Blob>()
  for (const file of pics) {
    const r = await externalRecord(file, IMPORTED, any)
    if (!r) continue
    blobs.set(recs.length, r.blob)
    recs.push(r.rec)
  }
  const bad = files.length - recs.length
  if (!recs.length) {
    toast.error('未读取到图片信息', { description: '请使用 NAI 下载的原图，或在 NAI 中点击「复制」' })
    return []
  }
  await useGallery.getState().load()
  for (const [i, r] of recs.entries()) await imageStore.put(r, blobs.get(i)!).catch(() => {})
  useGallery.setState((s) => ({ images: [...recs, ...(s.images ?? [])].sort(byNewest) }))
  toast(`已导入 ${recs.length} 张图片`, bad ? { description: `${bad} 个文件不是 NAI 图片，未导入` } : undefined)
  return recs.map((r) => r.id)
}
