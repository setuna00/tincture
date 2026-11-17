import { assetStore } from '@/store/storage'
import { exportDoc } from './nai'
import { readPngText } from './nai-image'
import { naiComment } from './nai-write'
import type { Doc } from '@/types'

interface DirHandle {
  name: string
  queryPermission(o: { mode: 'readwrite' }): Promise<PermissionState>
  requestPermission(o: { mode: 'readwrite' }): Promise<PermissionState>
  getFileHandle(name: string, o: { create: boolean }): Promise<{ createWritable(): Promise<{ write(d: Blob | string): Promise<void>; close(): Promise<void> }> }>
}
type Picker = (o?: { id?: string; mode?: 'readwrite' }) => Promise<DirHandle>

const KEY = 'image-dir'

export const fsSupported = () => typeof (window as unknown as { showDirectoryPicker?: Picker }).showDirectoryPicker === 'function'

export async function savedDir(): Promise<DirHandle | null> {
  try {
    return (await assetStore.get<DirHandle>(KEY)) ?? null
  } catch {
    return null
  }
}

export async function pickDir(): Promise<DirHandle> {
  const dir = await (window as unknown as { showDirectoryPicker: Picker }).showDirectoryPicker({ id: 'pe-images', mode: 'readwrite' })
  await assetStore.set(KEY, dir)
  return dir
}

/** Browser folder authorization requires a user gesture. */
export async function ensurePermission(dir: DirHandle): Promise<boolean> {
  if ((await dir.queryPermission({ mode: 'readwrite' })) === 'granted') return true
  return (await dir.requestPermission({ mode: 'readwrite' })) === 'granted'
}

export async function hasPermission(dir: DirHandle) {
  return (await dir.queryPermission({ mode: 'readwrite' })) === 'granted'
}

const pad = (n: number) => String(n).padStart(2, '0')
function stamp(d = new Date()) {
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
}
const safeName = (s: string) => s.replace(/[\\/:*?"<>|]+/g, '_').trim().slice(0, 40) || 'prompt'

export interface SavedImage {
  file: string
  json: string
}

export async function saveImageWithPrompt(dir: DirHandle, image: File, doc: Doc): Promise<SavedImage> {
  const ext = image.name.match(/\.[a-z0-9]+$/i)?.[0] ?? '.png'
  const base = `${stamp()}-${safeName(doc.meta.title)}`
  const file = `${base}${ext}`
  const json = `${base}.prompt.json`
  let embedded: Record<string, string> = {}
  try {
    embedded = await readPngText(image)
  } catch {
    embedded = {}
  }
  const record = {
    savedAt: new Date().toISOString(),
    image: { file, originalName: image.name, size: image.size },
    title: doc.meta.title,
    prompt: Object.fromEntries(exportDoc(doc).map((b) => [b.label, b.text])),
    nai: naiComment(doc),
    doc,
    embedded,
  }
  const w1 = await (await dir.getFileHandle(file, { create: true })).createWritable()
  await w1.write(image)
  await w1.close()
  const w2 = await (await dir.getFileHandle(json, { create: true })).createWritable()
  await w2.write(JSON.stringify(record, null, 2))
  await w2.close()
  return { file, json }
}
