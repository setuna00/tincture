// Preserve NAI's lossless WebP bytes because they carry generation metadata.
import { useMemo } from 'react'
import { create } from 'zustand'
import { useStore } from 'zustand'
import { toast } from 'sonner'
import { composite, maskPng, sourcePng } from '@/lib/inpaint-image'
import { buildInpaintRequest, inpaintModelId, inpaintPrice, inpaintSettings, inpaintSize, noBase, type Mask } from '@/lib/nai-inpaint'
import { readImageMeta } from '@/lib/nai-image'
import {
  buildGenerateRequest,
  generateStream,
  generationPrice,
  maxSamplesForSize,
  naiModelId,
  NaiError,
  PRICE_TOO_LONG,
  randomSeed,
  type NaiErrorKind,
} from '@/lib/nai-api'
import { effectiveSettings } from '@/lib/nai-write'
import type { ImageAction } from '@/lib/nai-tools'
import { newId } from '@/lib/nai'
import { encodeVibe, RefError, withRefs } from '@/lib/ref-request'
import type { VibeRef } from '@/types'
import { moveImagesToTrash, useMarks } from './gallery-marks'
import { accountOf, useNai } from './nai'
import { useParamsPanel } from './right-panel'
import { putVibeCode, refBlob, vibeCode, vibeCodeKey } from './ref-images'
import { imageStore, type GenImage } from './storage'
import { getDocStore } from './tabs'
import { adoptLegacyImages, findVersion, loadVersions, recordVersion, useVersions, type DocVersion } from './versions'

export type { GenImage }

export interface Running {
  tabId: string
  docId: string
  n: number
  width: number
  height: number
  progress: number
  previews: (string | null)[]
  done: boolean[]
  follow: boolean
  versionId: string | null
  action?: ImageAction
  source?: GenImage
  indeterminate?: boolean
  importId?: string
  inpaint?: boolean
}

export type GenFailKind = 'no_token' | 'generating' | 'too_long' | 'unchanged' | 'reference' | 'failed' | NaiErrorKind
export interface GenResult {
  images: GenImage[]
  error?: { kind: GenFailKind; message: string }
}
const genFail = (kind: GenFailKind, message = ''): GenResult => ({ images: [], error: { kind, message } })

export interface InpaintJob {
  source: GenImage
  mask: Mask
  prefill: Uint8Array | null
  strength: number
}

interface GenState {
  history: Record<string, GenImage[] | undefined>
  /** Selection may be an image ID, an empty version ID or the NEXT_VERSION sentinel. */
  selected: Record<string, string | null | undefined>
  imageDocs: Set<string> | null
  running: Running | null
  load(docId: string): Promise<void>
  select(docId: string, id: string | null): void
  follow(docId: string): void
  generate(tabId: string, inpaint?: InpaintJob): Promise<GenResult>
  remove(docId: string, id: string): void
}

export const NEXT_VERSION = 'next'

export const imageUrl = (img: GenImage): string => imageStore.url(img.id)
export const imageBlob = (img: GenImage): Promise<Blob> => imageStore.blob(img.id)
const dropUrl = (id: string) => imageStore.forget(id)

export function mimeOf(b: Uint8Array): string {
  if (b[0] === 0x89 && b[1] === 0x50) return 'image/png'
  if (b[0] === 0xff && b[1] === 0xd8) return 'image/jpeg'
  return 'image/webp'
}

/** NAI HALF_STEP_SAMPLERS count two sampling steps as one progress step. */
export const HALF_STEP = new Set(['k_dpmpp_2s_ancestral', 'k_dpmpp_sde'])

export function withDoc(set: Set<string> | null, docId: string, has: boolean): Set<string> | null {
  if (!set || set.has(docId) === has) return set
  const next = new Set(set)
  if (has) next.add(docId)
  else next.delete(docId)
  return next
}

export const byNewest = (a: GenImage, b: GenImage) => b.createdAt - a.createdAt || a.index - b.index

let lastKey = ''

export const vibeEncoded = (have: Set<string>, model: string) => (v: VibeRef) => have.has(vibeCodeKey(v.image, model, v.informationExtracted))

/** Reuse persisted model-specific Vibe encodings to avoid spending Anlas on the same encoding again. */
export async function vibeFor(token: string, v: VibeRef, model: string): Promise<string> {
  const key = vibeCodeKey(v.image, model, v.informationExtracted)
  const hit = await vibeCode(key)
  if (hit) return hit
  const img = await refBlob(v.image)
  if (!img) throw new RefError('missing')
  await putVibeCode(key, await encodeVibe(token, img, model, v.informationExtracted))
  return (await vibeCode(key))!
}

function refErrorToast(e: RefError) {
  if (e.kind === 'too-many') toast.error('启用的精准参考超过 16 张', { description: '请停用或移除一些后再生成' })
  else toast.error('无法读取参考图', { description: '请移除后重新添加' })
}

export function genErrorToast(e: unknown, failed = '生成失败') {
  if (e instanceof RefError) return refErrorToast(e)
  const err = e instanceof NaiError ? e : new NaiError('network', String(e))
  switch (err.kind) {
    case 'unauthorized':
      toast.error('NAI 令牌无效', { description: '请在设置中重新填写 Persistent API Token' })
      break
    case 'anlas':
      toast.error('Anlas 不足')
      break
    case 'busy':
      toast.error('已有图片在生成或请求过于频繁', { description: '请稍后再试' })
      break
    case 'network':
      toast.error('无法连接 NAI', { description: '请检查网络' })
      break
    case 'timeout':
      toast.error(failed.replace(/失败$/, '超时（120 秒）'))
      break
    default:
      toast.error(failed, { description: err.message.replace(/training steps/g, 'Anlas') })
  }
}

export async function seedOf(blob: Blob, fallback: number): Promise<number> {
  try {
    const meta = await readImageMeta(blob)
    const c = JSON.parse(meta?.Comment ?? '{}') as { seed?: unknown }
    if (typeof c.seed === 'number') return c.seed
  } catch {
  }
  return fallback
}

/** Paid-request checks and acquisition of the shared running state must be synchronous to prevent concurrent charges. */
function prepare(tabId: string, job?: InpaintJob) {
  const nai = useNai.getState()
  if (!nai.token) return { kind: 'no_token' as const }
  if (useGen.getState().running) return { kind: 'generating' as const }
  const doc = structuredClone(getDocStore(tabId).getState().doc)
  const docId = doc.meta.docId ?? tabId
  const eff = effectiveSettings(doc.settings)
  const g = eff.gen
  const size = job ? inpaintSize(job.source.width, job.source.height) : { width: g.width, height: g.height }
  const n = Math.min(doc.settings.gen.nSamples ?? 1, maxSamplesForSize(size.width, size.height))
  const account = accountOf(nai.account)
  if (job && !inpaintModelId(doc.settings)) return { kind: 'failed' as const }
  if ((job ? inpaintPrice(doc.settings, size, n, job.strength, account) : generationPrice(doc.settings, n, account)) === PRICE_TOO_LONG) return { kind: 'too_long' as const }
  const seed = doc.settings.gen.seed ?? randomSeed()
  const plain = job
    ? buildInpaintRequest(doc, { seed, nSamples: n, straightAlpha: nai.straightAlpha, size, strength: job.strength })
    : buildGenerateRequest(doc, { seed, nSamples: n, straightAlpha: nai.straightAlpha })
  const key = job ? '' : JSON.stringify([plain, doc.settings.baseImage, doc.settings.vibes, doc.settings.characterRefs, doc.settings.gen.strength, doc.settings.gen.noise])
  if (!job && doc.settings.gen.seed !== null && key === lastKey) return { kind: 'unchanged' as const }
  return { doc, docId, eff, g, size, n, seed, plain, key }
}

export function genBlocked(tabId: string): GenFailKind | null {
  const p = prepare(tabId)
  return p.kind ?? null
}

export const useGen = create<GenState>()((set, get) => ({
  history: {},
  selected: {},
  imageDocs: null,
  running: null,

  load: async (docId) => {
    if (get().history[docId]) return
    let list: GenImage[] = []
    try {
      list = (await adoptLegacyImages(docId, await imageStore.list(docId))).sort(byNewest)
    } catch {
    }
    if (get().history[docId]) return
    set((s) => ({ history: { ...s.history, [docId]: list }, selected: { ...s.selected, [docId]: s.selected[docId] ?? list[0]?.id ?? null }, imageDocs: withDoc(s.imageDocs, docId, list.length > 0) }))
  },

  select: (docId, id) =>
    set((s) => ({
      selected: { ...s.selected, [docId]: id },
      running: s.running?.docId === docId && s.running.follow ? { ...s.running, follow: false } : s.running,
    })),

  follow: (docId) => set((s) => (s.running?.docId === docId && !s.running.follow ? { running: { ...s.running, follow: true } } : s)),

  generate: async (tabId, job) => {
    const nai = useNai.getState()
    const p = prepare(tabId, job)
    if (p.kind) {
      if (p.kind === 'unchanged') toast('参数与上次生成相同', { description: 'Seed 已固定，请修改参数或清空 Seed' })
      return genFail(p.kind)
    }
    const { doc, docId, eff, g, size, n, seed, plain, key } = p
    await Promise.all([get().load(docId), loadVersions(docId)])
    // Recheck running after awaiting loads, then set it without another await to prevent concurrent paid requests.
    if (get().running) return genFail('generating')
    const batch = newId('b')
    const startedAt = Date.now()
    const model = job ? plain.model : naiModelId(eff)
    const skip = nai.rawIntermediates ? 0 : 5
    const showPreview = nai.stream
    const totalSteps = (HALF_STEP.has(g.sampler) ? g.steps / 2 : g.steps) * n
    const stepsDone: number[] = Array.from({ length: n }, () => 0)
    const progressOf = () => Math.min(1, Math.max(0, stepsDone.reduce((a, b) => a + b, 0) / Math.max(1, totalSteps - n * skip)))
    const matched = findVersion(useVersions.getState().byDoc[docId] ?? [], doc)
    useParamsPanel.setState({ open: false })
    set({ running: { tabId, docId, n, ...size, progress: 0, previews: Array(n).fill(null), done: Array(n).fill(false), follow: true, versionId: matched?.id ?? null, ...(job ? { inpaint: true } : {}) } })
    const patch = (f: (r: Running) => Partial<Running>) => set((s) => (s.running ? { running: { ...s.running, ...f(s.running) } } : s))
    const saves: Promise<void>[] = []
    const made: GenImage[] = []
    let result: GenResult['error']
    let failed = false
    let first = true
    let version: DocVersion | null = null

    try {
      // Acquire running before encoding Vibes because encoding also spends Anlas.
      const token = nai.token
      // Inpainting supplies its own source image; encode Vibes for the generation model rather than the inpainting model.
      const refs = await withRefs(job ? { ...plain, model: naiModelId(inpaintSettings(eff)) } : plain, job ? noBase(inpaintSettings(eff)) : eff, { blob: refBlob, vibe: (v, m) => vibeFor(token, v, m) })
      const body = job ? { ...refs.body, model: plain.model } : refs.body
      const files = refs.files
      const original = job ? await imageBlob(job.source) : null
      if (job && original) {
        files.image = await sourcePng(original, size)
        files.mask = await maskPng(job.mask, size)
      }
      await generateStream(token, body, {
        intermediate(i, step, img) {
          lastKey = key
          if (step < skip) return
          if (step - skip > stepsDone[i]) stepsDone[i] = step - skip
          if (!showPreview) return patch(() => ({ progress: progressOf() }))
          const url = URL.createObjectURL(new Blob([img as BlobPart], { type: mimeOf(img) }))
          patch((r) => {
            const old = r.previews[i]
            if (old) URL.revokeObjectURL(old)
            const previews = [...r.previews]
            previews[i] = url
            return { previews, progress: progressOf() }
          })
        },
        final(i, img) {
          lastKey = key
          stepsDone[i] = g.steps - skip
          const raw = new Blob([img as BlobPart], { type: mimeOf(img) })
          if (!version) {
            version = recordVersion(doc, { kind: 'gen' })
            const id = version?.id ?? null
            patch(() => ({ versionId: id }))
          }
          const v = version
          const show = first
          first = false
          const merged = job && original ? composite(raw, original, job.mask, size, job.prefill) : Promise.resolve(raw)
          saves.push(
            (async () => {
              const blob = await merged
              const rec: GenImage = {
                id: newId('img'),
                tabId: docId,
                ...(v ? { versionId: v.id, version: v.n } : {}),
                ...(job ? { label: 'inpaint' as const, sourceId: job.source.id } : {}),
                batch,
                index: i,
                createdAt: startedAt,
                seed: await seedOf(raw, seed + i),
                ...size,
                model,
                mime: blob.type,
                size: blob.size,
                doc,
              }
              try {
                await imageStore.put(rec, blob)
              } catch {
              }
              made.push(rec)
              set((s) => ({
                history: { ...s.history, [docId]: [rec, ...(s.history[docId] ?? [])].sort(byNewest) },
                imageDocs: withDoc(s.imageDocs, docId, true),
                selected: show && s.running?.follow !== false ? { ...s.selected, [docId]: rec.id } : s.selected,
              }))
            })(),
          )
          void merged.then((blob) => {
            const finalUrl = URL.createObjectURL(blob)
            patch((r) => {
              const old = r.previews[i]
              if (old) URL.revokeObjectURL(old)
              const previews = [...r.previews]
              previews[i] = finalUrl
              const done = [...r.done]
              done[i] = true
              return { previews, done, progress: progressOf() }
            })
          })
        },
        sampleError(i, message) {
          failed = true
          result = { kind: 'failed', message: `image ${i + 1}: ${message}` }
          toast.error(`第 ${i + 1} 张生成失败`, { description: message })
        },
      }, undefined, files)
      await Promise.all(saves)
      const missing = get().running?.done.flatMap((d, i) => (d ? [] : [i + 1])) ?? []
      if (missing.length && !failed) {
        result = { kind: 'failed', message: `no image ${missing.join(', ')} came back` }
        toast.error(`未收到第 ${missing.join('、')} 张图片`)
      }
    } catch (e) {
      genErrorToast(e)
      result = e instanceof RefError ? { kind: 'reference', message: e.kind } : e instanceof NaiError ? { kind: e.kind, message: e.message } : { kind: 'network', message: String(e) }
      await Promise.all(saves)
    } finally {
      get().running?.previews.forEach((u) => u && URL.revokeObjectURL(u))
      // Cleared only after every save above (try and catch): closing the window treats running = null as "images are written".
      set({ running: null })
      void useNai.getState().refresh()
    }
    return { images: made.sort((a, b) => a.index - b.index), ...(result ? { error: result } : {}) }
  },

  remove: (docId, id) => {
    const trash = useMarks.getState().trash
    const list = (get().history[docId] ?? []).filter((x) => !(x.id in trash))
    const at = list.findIndex((x) => x.id === id)
    if (at < 0) return
    const next = list.filter((x) => x.id !== id)
    if (get().selected[docId] === id || (get().selected[docId] ?? '') in trash) {
      set((s) => ({ selected: { ...s.selected, [docId]: (next[at] ?? next[at - 1])?.id ?? null } }))
    }
    moveImagesToTrash([id], () => {
      if (get().history[docId]?.some((x) => x.id === id)) get().select(docId, id)
    })
  },
}))

if (typeof window !== 'undefined')
  void imageStore
    .tabs()
    .catch(() => new Set<string>())
    .then((docs) => useGen.setState((s) => ({ imageDocs: s.imageDocs ? new Set([...docs, ...s.imageDocs]) : docs })))

export function forgetImages(ids: ReadonlySet<string>) {
  useGen.setState((s) => {
    let history = s.history
    let selected = s.selected
    let imageDocs = s.imageDocs
    for (const [docId, list] of Object.entries(s.history)) {
      if (!list?.some((x) => ids.has(x.id))) continue
      const next = list.filter((x) => !ids.has(x.id))
      history = { ...history, [docId]: next }
      imageDocs = withDoc(imageDocs, docId, next.length > 0)
      if (ids.has(selected[docId] ?? '')) selected = { ...selected, [docId]: next[0]?.id ?? null }
    }
    return { history, selected, imageDocs }
  })
  for (const id of ids) dropUrl(id)
}

export function useDocId(tabId: string): string {
  return useStore(getDocStore(tabId), (s) => s.doc.meta.docId ?? tabId)
}

export function useShownHistory(docId: string): GenImage[] | undefined {
  const list = useGen((s) => s.history[docId])
  const trash = useMarks((s) => s.trash)
  return useMemo(() => (list?.some((x) => x.id in trash) ? list.filter((x) => !(x.id in trash)) : list), [list, trash])
}

export function useShownSelectedId(docId: string): string | null {
  const list = useShownHistory(docId)
  const id = useGen((s) => s.selected[docId])
  const isVersion = useVersions((s) => !!id && (id === NEXT_VERSION || !!s.byDoc[docId]?.some((v) => v.id === id)))
  if (list?.some((x) => x.id === id)) return id ?? null
  return isVersion ? null : (list?.[0]?.id ?? null)
}

export function useHasImage(docId: string): boolean | null {
  const running = useGen((s) => s.running?.docId === docId)
  const list = useShownHistory(docId)
  const known = useGen((s) => (s.imageDocs ? s.imageDocs.has(docId) : null))
  if (running) return true
  return list ? list.length > 0 : known
}

export function useSelectedImage(docId: string): GenImage | null {
  const list = useShownHistory(docId)
  const id = useShownSelectedId(docId)
  return (id && list?.find((x) => x.id === id)) || null
}

export function useSelectedVersion(docId: string): DocVersion | null {
  const img = useSelectedImage(docId)
  const sel = useGen((s) => s.selected[docId])
  const list = useVersions((s) => s.byDoc[docId])
  return useMemo(() => {
    const id = img ? img.versionId : sel
    return (id && list?.find((v) => v.id === id)) || null
  }, [img, sel, list])
}

export function useFollowing(docId: string): boolean {
  return useGen((s) => s.running?.docId === docId && s.running.follow)
}
