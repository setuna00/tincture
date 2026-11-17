import { create } from 'zustand'
import { toast } from 'sonner'
import { metaSource, parseNaiImage, type ParsedNaiImage } from '@/lib/nai-image'
import { externalRecord, importToGallery } from './gallery'
import { byNewest, useGen, withDoc } from './gen'
import { IMPORT_ISSUE, isImage, readMetaOrLarge, useImport } from './import'
import { usePrefs, newDocSettings } from './prefs'
import { useNai } from './nai'
import { importCharacterZip, importVibeFiles } from './ref-files'
import { addReference, type RefKind } from './refs'
import { useToolsMenu } from './right-panel'
import { imageStore } from './storage'
import { getDocStore, useTabs } from './tabs'

export interface PendingIntake {
  file: File
  url: string
  source: ReturnType<typeof metaSource> | 'large'
  parsed: ParsedNaiImage | null
}
export const useIntake = create<{ pending: PendingIntake | null; open: boolean }>(() => ({ pending: null, open: false }))
export const closeIntake = () => useIntake.setState({ open: false })

export async function askImageFiles(files: File[]) {
  const file = files[0]
  if (!file) return
  if (files.length > 1) toast('一次只能处理一张图片，已读取第一张')
  if (!isImage(file)) return void toast.error('不是图片文件', { description: '支持 PNG、WebP、JPG' })
  const meta = await readMetaOrLarge(file)
  if (meta === 'large') return void toast.error(IMPORT_ISSUE.large.title, { description: IMPORT_ISSUE.large.description })
  const source = meta ? metaSource(meta) : 'other'
  const parsed = meta && source === 'nai' ? parseNaiImage(meta) : null
  const prev = useIntake.getState().pending
  if (prev) URL.revokeObjectURL(prev.url)
  useIntake.setState({ pending: { file, url: URL.createObjectURL(file), source, parsed }, open: true })
}

export function intakeImportPrompt() {
  const p = useIntake.getState().pending
  if (!p?.parsed) return
  closeIntake()
  const prev = useImport.getState().pending
  if (prev) URL.revokeObjectURL(prev.url)
  useImport.setState({ pending: { file: p.file, url: URL.createObjectURL(p.file), parsed: p.parsed }, open: true })
}

function editorTab(): string {
  const tabs = useTabs.getState()
  const tabId = tabs.activeId
  if (tabs.starts.includes(tabId)) tabs.openInTab(tabId, { base: { prompt: [], uc: [] }, characters: [], settings: newDocSettings(), meta: { title: '未命名', createdAt: Date.now() } })
  return tabId
}

export async function intakeRef(kind: RefKind) {
  const p = useIntake.getState().pending
  if (!p) return
  closeIntake()
  const tabId = editorTab()
  if (location.hash.replace(/^#\/?/, '')) location.hash = '/'
  if (kind === 'vibe') return importVibeFiles(getDocStore(tabId), [p.file])
  await addReference(getDocStore(tabId), kind, p.file)
}

export async function intakeRefFiles(vibes: File[], zip: File | undefined) {
  if (!useNai.getState().token) return void toast.error('未设置 NAI 令牌')
  const tabId = editorTab()
  if (location.hash.replace(/^#\/?/, '')) location.hash = '/'
  const store = getDocStore(tabId)
  if (vibes.length) await importVibeFiles(store, vibes)
  if (zip) await importCharacterZip(store, zip)
}

export async function intakeDirectorTools() {
  const p = useIntake.getState().pending
  if (!p) return
  closeIntake()
  const tabId = editorTab()
  const docId = getDocStore(tabId).getState().doc.meta.docId ?? tabId
  const r = await externalRecord(p.file, docId, true)
  if (!r) return void toast.error('无法读取图片')
  const rec = { ...r.rec, label: 'import' as const }
  await useGen.getState().load(docId)
  try {
    await imageStore.put(rec, r.blob)
  } catch {
  }
  useGen.setState((s) => ({ history: { ...s.history, [docId]: [rec, ...(s.history[docId] ?? [])].sort(byNewest) }, imageDocs: withDoc(s.imageDocs, docId, true) }))
  useGen.getState().select(docId, rec.id)
  usePrefs.getState().set({ rightTab: 'gen' })
  if (location.hash.replace(/^#\/?/, '')) location.hash = '/'
  setTimeout(() => useToolsMenu.setState({ openFor: rec.id }), 250)
}

export function intakeGallery() {
  const p = useIntake.getState().pending
  if (!p) return
  closeIntake()
  void importToGallery([p.file], true)
}
