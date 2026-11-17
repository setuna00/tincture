// Persist imported Vibe encodings so subsequent generation does not pay to encode them again.
import { toast } from 'sonner'
import { TooLargeError } from '@/lib/inflate'
import { checkFileSize, ZIP_FILE_LIMIT } from '@/lib/import-budget'
import { MODELS, modelInfo, modelName, refModelFor } from '@/lib/nai-models'
import { CHARACTER_REF_DEFAULT, vibeDefaults } from '@/lib/nai-refs'
import { readPngText } from '@/lib/nai-image'
import { bundleFile, CHARACTER_ZIP_NAME, characterZipEntries, embeddedVibeText, isVibeFileName, isZipFile, parseCharacterZip, parseVibeText, readVibeFile, sha256Text, vibeFile, vibeImportBudget, type ParsedVibe, type VibeExport } from '@/lib/vibe-file'
import { readZip, writeZip, type ZipEntry } from '@/lib/zip'
import type { CharacterRef, Doc, DocSettings, ModelId, VibeRef } from '@/types'
import type { DocStore } from './doc'
import { blobBase64, putRefImage, putRefImageAs, putVibeCode, refBlob, vibeCode, vibeCodeKey, vibeCodesOf } from './ref-images'
import { addReference, useRefFlash } from './refs'

const fromBase64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0))

/** NAI reference files store raw base64 without a MIME type, so infer the image type from its signature. */
function imageType(b: Uint8Array): string {
  if (b[0] === 0x89 && b[1] === 0x50) return 'image/png'
  if (b[0] === 0xff && b[1] === 0xd8) return 'image/jpeg'
  if (b[0] === 0x52 && b[1] === 0x49 && b[8] === 0x57 && b[9] === 0x45) return 'image/webp'
  return 'application/octet-stream'
}
const imageBlob = (b: Uint8Array) => new Blob([b as BlobPart], { type: imageType(b) })

const dataUrlBlob = (url: string) => {
  const [head, b64] = url.split(',')
  return new Blob([fromBase64(b64) as BlobPart], { type: /data:([^;]+)/.exec(head)?.[1] ?? 'image/png' })
}

function saveFile(blob: Blob, name: string) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}

const MODEL_OF_SHORT = Object.fromEntries(Object.values(MODELS).map((m) => [m.api.replace(/^nai-diffusion-/, ''), m.id])) as Record<string, ModelId>

const vibeModelFor = (m: ModelId) => (modelInfo(m).vibeTransfer ? m : refModelFor(m, 'vibe'))

function applyImport(store: DocStore, patch: Partial<DocSettings>, kind: 'vibe' | 'character', text: string) {
  const before = store.getState().doc
  store.getState().updateSettings(patch)
  const after = store.getState().doc
  useRefFlash.setState((f) => ({ kind, n: f.n + 1 }))
  if (!patch.model || patch.model === before.settings.model) return void toast(text)
  const undo = () => {
    if (store.getState().doc === after) return store.temporal.getState().undo()
    const keep: Partial<Doc['settings']> = kind === 'vibe' ? { vibes: before.settings.vibes } : { characterRefs: before.settings.characterRefs }
    store.getState().updateSettings({ model: before.settings.model, ...keep })
  }
  toast(`${text}，模型已切换为 ${modelName(patch.model)}`, { action: { label: '撤销', onClick: undo } })
}

async function vibeRefOf(p: ParsedVibe, model: ModelId): Promise<VibeRef> {
  const d = vibeDefaults(model)
  if (p.image) {
    const ref = await putRefImage(imageBlob(fromBase64(p.image)))
    for (const e of p.encodings) await putVibeCode(vibeCodeKey(ref.image, MODELS[e.model].api, e.info), new Blob([fromBase64(e.data) as BlobPart]))
    return { ...ref, informationExtracted: p.info ?? d.informationExtracted, strength: p.strength ?? d.strength, enabled: true }
  }
  // Encoding-only entries use the encoding hash as image identity; the stored pixels, if any, are only a thumbnail.
  const e = p.encodings[0]
  const image = await sha256Text(e.data)
  const size = p.thumbnail ? await putRefImageAs(image, dataUrlBlob(p.thumbnail)).catch((e) => {
    if (e instanceof TooLargeError) throw e
    return { width: 0, height: 0 }
  }) : { width: 0, height: 0 }
  await putVibeCode(vibeCodeKey(image, MODELS[e.model].api, e.info), new Blob([fromBase64(e.data) as BlobPart]))
  return { image, ...size, informationExtracted: e.info, strength: p.strength ?? d.strength, enabled: true, encodedFor: e.model }
}

export async function importVibeFiles(store: DocStore, files: File[]) {
  const parsed: ParsedVibe[] = []
  const plain: File[] = []
  const budget = vibeImportBudget()
  let bad = 0
  for (const f of files) {
    try {
      if (isVibeFileName(f.name) || !f.type.startsWith('image/')) {
        const got = await readVibeFile(f, budget)
        if (got?.length) parsed.push(...got)
        else bad++
        continue
      }
      const hidden = f.type === 'image/png' ? embeddedVibeText((await readPngText(f)).naidata) : null
      const got = hidden ? parseVibeText(hidden, budget) : null
      if (got?.length) parsed.push(...got)
      else plain.push(f)
    } catch (e) {
      if (e instanceof TooLargeError) return void toast.error('无法导入 Vibe Transfer 文件', { description: '文件过大' })
      if (f.type.startsWith('image/') && !isVibeFileName(f.name)) plain.push(f)
      else bad++
    }
  }
  if (!parsed.length && plain.length === 1 && !bad) return addReference(store, 'vibe', plain[0])
  const s = store.getState().doc.settings
  const last = [...parsed].reverse().find((p) => p.model)?.model
  const model = vibeModelFor(last ?? s.model)
  const have = new Set((s.vibes ?? []).map((v) => v.image))
  const added: VibeRef[] = []
  let dup = 0
  let large = false
  const push = (v: VibeRef) => {
    if (have.has(v.image)) return void dup++
    have.add(v.image)
    added.push(v)
  }
  for (const p of parsed) {
    try {
      push(await vibeRefOf(p, model))
    } catch (e) {
      large ||= e instanceof TooLargeError
      bad++
    }
  }
  for (const f of plain) {
    try {
      push({ ...(await putRefImage(f)), ...vibeDefaults(model) })
    } catch (e) {
      large ||= e instanceof TooLargeError
      bad++
    }
  }
  if (!added.length) {
    if (dup && !bad) return void toast(dup > 1 ? '这些图已添加为 Vibe Transfer' : '这张图已添加为 Vibe Transfer')
    return void toast.error('无法导入 Vibe Transfer 文件', large ? { description: '文件过大' } : undefined)
  }
  applyImport(store, { model, vibes: [...(s.vibes ?? []), ...added] }, 'vibe', `已导入 ${added.length} 张 Vibe Transfer`)
  if (bad) toast.error(`无法读取 ${bad} 个文件`, large ? { description: '文件过大' } : undefined)
}

export async function importCharacterZip(store: DocStore, file: File) {
  let entries: ZipEntry[] = []
  try {
    checkFileSize(file, ZIP_FILE_LIMIT)
    entries = await readZip(await file.arrayBuffer())
  } catch (e) {
    if (e instanceof TooLargeError) return void toast.error('无法导入精准参考 ZIP', { description: '文件过大' })
  }
  const items = parseCharacterZip(entries)
  if (!items) return void toast.error('无法导入精准参考 ZIP', { description: '缺少 metadata.json' })
  const refs: CharacterRef[] = []
  let large = false
  for (const it of items) {
    try {
      const ref = await putRefImage(imageBlob(it.data))
      refs.push({ ...ref, ...CHARACTER_REF_DEFAULT, description: it.description, strength: it.strength, fidelity: it.fidelity, enabled: it.enabled })
    } catch (e) {
      large ||= e instanceof TooLargeError
    }
  }
  if (!refs.length) return void toast.error('无法导入精准参考 ZIP', { description: large ? '文件过大' : '没有可读取的图片' })
  const s = store.getState().doc.settings
  applyImport(store, { model: refModelFor(s.model, 'character'), characterRefs: [...(s.characterRefs ?? []), ...refs] }, 'character', `已导入 ${refs.length} 张精准参考`)
  if (large) toast.error('无法导入精准参考 ZIP', { description: '文件过大' })
}

export const refFilesIn = (files: File[]) => ({ vibes: files.filter((f) => isVibeFileName(f.name)), zip: files.find(isZipFile) })

const exportModel = (s: DocSettings) => vibeModelFor(s.model)

async function thumbnail(blob: Blob): Promise<string | undefined> {
  try {
    const bmp = await createImageBitmap(blob)
    const k = Math.min(1, 256 / Math.max(bmp.width, bmp.height))
    const c = new OffscreenCanvas(Math.max(1, Math.round(bmp.width * k)), Math.max(1, Math.round(bmp.height * k)))
    c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height)
    bmp.close()
    return `data:image/jpeg;base64,${await blobBase64(await c.convertToBlob({ type: 'image/jpeg', quality: 0.85 }))}`
  } catch {
    return undefined
  }
}

async function vibeExport(v: VibeRef, s: DocSettings): Promise<VibeExport | null> {
  const blob = await refBlob(v.image)
  if (v.encodedFor) {
    const code = await vibeCode(vibeCodeKey(v.image, MODELS[v.encodedFor].api, v.informationExtracted))
    if (!code) return null
    const thumb = blob ? `data:${blob.type || 'image/jpeg'};base64,${await blobBase64(blob)}` : undefined
    return { thumbnail: thumb, encodings: [{ model: v.encodedFor, info: v.informationExtracted, data: code }], model: v.encodedFor, info: v.informationExtracted, strength: v.strength, createdAt: Date.now() }
  }
  if (!blob) return null
  const encodings = []
  for (const c of await vibeCodesOf(v.image)) {
    const model = MODEL_OF_SHORT[c.model]
    const data = model ? await vibeCode(c.key) : null
    if (model && data) encodings.push({ model, info: c.info, data })
  }
  return { image: await blobBase64(blob), thumbnail: await thumbnail(blob), encodings, model: exportModel(s), info: v.informationExtracted, strength: v.strength, createdAt: Date.now() }
}

const json = (text: string) => new Blob([text], { type: 'application/json' })

export async function exportVibe(s: DocSettings, v: VibeRef) {
  const e = await vibeExport(v, s)
  if (!e) return void toast.error('无法读取参考图')
  const f = await vibeFile(e)
  saveFile(json(f.text), f.name)
}

export async function exportVibeBundle(s: DocSettings) {
  const list: VibeExport[] = []
  for (const v of (s.vibes ?? []).filter((x) => x.enabled)) {
    const e = await vibeExport(v, s)
    if (!e) return void toast.error('无法读取参考图')
    list.push(e)
  }
  if (!list.length) return
  const f = await bundleFile(list)
  saveFile(json(f.text), f.name)
}

export async function exportCharacterZip(s: DocSettings) {
  const items = []
  for (const c of s.characterRefs ?? []) {
    const blob = await refBlob(c.image)
    if (!blob) return void toast.error('无法读取参考图')
    const data = new Uint8Array(await blob.arrayBuffer())
    items.push({ type: blob.type || imageType(data), data, description: c.description, strength: c.strength, fidelity: c.fidelity, enabled: c.enabled })
  }
  if (!items.length) return
  saveFile(new Blob([writeZip(characterZipEntries(items)) as BlobPart], { type: 'application/zip' }), CHARACTER_ZIP_NAME)
}
