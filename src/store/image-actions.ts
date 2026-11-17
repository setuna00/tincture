// Share useGen.running with generation; check and set it without an await so paid requests cannot overlap.
import { toast } from 'sonner'
import { generateStream, naiModelId, type GenerateBody } from '@/lib/nai-api'
import {
  actionRefSettings,
  augmentImage,
  buildEnhanceRequest,
  buildVariationsRequest,
  enhanceSize,
  imageSize,
  labelOf,
  toolInputSize,
  toPng,
  upscaleImage,
  UPSCALE_FACTOR,
  UPSCALE_MODEL,
  variationsCount,
  type DirectorTool,
  type EnhanceScale,
  type GenLabel,
  type ImageAction,
  type ToolOptions,
} from '@/lib/nai-tools'
import { effectiveSettings } from '@/lib/nai-write'
import { newId } from '@/lib/nai'
import { withRefs } from '@/lib/ref-request'
import { byNewest, genErrorToast, HALF_STEP, imageBlob, mimeOf, seedOf, useGen, vibeFor, withDoc, type GenImage, type Running } from './gen'
import { refBlob } from './ref-images'
import { useNai } from './nai'
import { useParamsPanel } from './right-panel'
import { imageStore } from './storage'
import { getDocStore } from './tabs'
import type { Doc } from '@/types'

export interface ActionOptions extends ToolOptions {
  scale?: EnhanceScale
  strength?: number
  noise?: number
}

export const ACTION_NAME: Record<ImageAction, string> = {
  upscale: '放大',
  enhance: 'Enhance',
  variations: '变体',
  'bg-removal': '去背景',
  lineart: '线稿',
  sketch: '草图',
  colorize: '上色',
  emotion: '改表情',
  declutter: '去文字和对话框',
}

export function importRootOf(list: readonly GenImage[], img: GenImage): GenImage | null {
  let cur: GenImage | undefined = img
  for (let i = 0; cur && i < 64; i++) {
    if (cur.label === 'import') return cur
    if (cur.versionId || !cur.sourceId) return null
    const id: string = cur.sourceId
    cur = list.find((x) => x.id === id)
  }
  return null
}

function placeholder(src: GenImage, action: ImageAction, o: ActionOptions) {
  if (action === 'upscale') return { n: 1, width: src.width * UPSCALE_FACTOR, height: src.height * UPSCALE_FACTOR }
  if (action === 'enhance') return { n: 1, ...enhanceSize(src.width, src.height, o.scale ?? 1) }
  if (action === 'variations') return { n: variationsCount(src.width, src.height), width: src.width, height: src.height }
  return { n: 1, width: src.width, height: src.height }
}

async function saveResult(docId: string, src: GenImage, blob: Blob, extra: Pick<GenImage, 'batch' | 'index' | 'createdAt' | 'seed' | 'model' | 'label'>, doc = src.doc): Promise<GenImage> {
  const size = await imageSize(blob).catch(() => ({ width: src.width, height: src.height }))
  const rec: GenImage = {
    id: newId('img'),
    tabId: docId,
    ...(src.versionId ? { versionId: src.versionId, version: src.version } : {}),
    sourceId: src.id,
    ...extra,
    ...size,
    mime: blob.type || 'image/png',
    size: blob.size,
    doc,
  }
  try {
    await imageStore.put(rec, blob)
  } catch {
  }
  useGen.setState((s) => ({ history: { ...s.history, [docId]: [rec, ...(s.history[docId] ?? [])].sort(byNewest) }, imageDocs: withDoc(s.imageDocs, docId, true) }))
  return rec
}

export async function runAction(tabId: string, docId: string, src: GenImage, action: ImageAction, o: ActionOptions = {}) {
  const nai = useNai.getState()
  if (!nai.token || useGen.getState().running) return
  const gen = useGen.getState()
  const list = gen.history[docId] ?? []
  const root = importRootOf(list, src)
  const batch = newId('b')
  const createdAt = Date.now()
  const label = labelOf(action, o)
  const stream = action === 'enhance' || action === 'variations'
  const ph = placeholder(src, action, o)
  useParamsPanel.setState({ open: false })
  useGen.setState({
    running: {
      tabId,
      docId,
      ...ph,
      progress: 0,
      previews: Array(ph.n).fill(null),
      done: Array(ph.n).fill(false),
      follow: true,
      versionId: src.versionId ?? null,
      action,
      source: src,
      indeterminate: !stream,
      ...(root ? { importId: root.id } : {}),
    },
  })
  const patch = (f: (r: Running) => Partial<Running>) => useGen.setState((s) => (s.running ? { running: { ...s.running, ...f(s.running) } } : s))
  const results: GenImage[] = []
  try {
    const blob = await imageBlob(src)
    if (stream) {
      const png = await toPng(blob)
      // NAI Enhance uses the current editor prompt; variations use the source image's prompt snapshot.
      const doc = action === 'enhance' ? structuredClone(getDocStore(tabId).getState().doc) : src.doc
      const body =
        action === 'enhance'
          ? buildEnhanceRequest(doc, src, { scale: o.scale ?? 1, strength: o.strength ?? 0.5, noise: o.noise ?? 0 }, nai.straightAlpha)
          : buildVariationsRequest(doc, src, nai.straightAlpha)
      await streamResults(docId, src, doc, body, png, { label, batch, createdAt }, patch, results)
    } else {
      const outs = action === 'upscale' ? await upscaleImage(nai.token, await toPng(blob)) : await runTool(nai.token, action, blob, src, o)
      const model = action === 'upscale' ? UPSCALE_MODEL : src.model
      for (const [i, b] of outs.entries()) results.push(await saveResult(docId, src, b, { batch, index: i, createdAt, seed: src.seed, model, label }))
    }
  } catch (e) {
    genErrorToast(e, `${ACTION_NAME[action]}失败`)
  } finally {
    get().running?.previews.forEach((u) => u && URL.revokeObjectURL(u))
    const follow = get().running?.follow !== false
    useGen.setState((s) => ({ running: null, selected: follow && results[0] ? { ...s.selected, [docId]: results[0].id } : s.selected }))
    void useNai.getState().refresh()
  }
}

const get = () => useGen.getState()

async function runTool(token: string, tool: DirectorTool, blob: Blob, src: GenImage, o: ToolOptions) {
  const size = toolInputSize(src.width, src.height)
  return augmentImage(token, tool, await toPng(blob, size), size, o)
}

async function streamResults(
  docId: string,
  src: GenImage,
  doc: Doc,
  body: GenerateBody,
  png: Blob,
  rec: { label: GenLabel; batch: string; createdAt: number },
  patch: (f: (r: Running) => Partial<Running>) => void,
  out: GenImage[],
) {
  const nai = useNai.getState()
  const g = effectiveSettings(doc.settings).gen
  const n = body.parameters.n_samples as number
  const seed = body.parameters.seed as number
  const skip = nai.rawIntermediates ? 0 : 5
  const totalSteps = (HALF_STEP.has(g.sampler) ? g.steps / 2 : g.steps) * n
  const stepsDone: number[] = Array.from({ length: n }, () => 0)
  const progressOf = () => Math.min(1, Math.max(0, stepsDone.reduce((a, b) => a + b, 0) / Math.max(1, totalSteps - n * skip)))
  const model = naiModelId(effectiveSettings(doc.settings))
  const saves: Promise<GenImage>[] = []
  let failed = false
  const refs = await withRefs(body, actionRefSettings(doc), { blob: refBlob, vibe: (v, m) => vibeFor(nai.token, v, m) })
  try {
    await generateStream(
      nai.token,
      refs.body,
      {
        intermediate(i, step, img) {
          if (step < skip) return
          if (step - skip > stepsDone[i]) stepsDone[i] = step - skip
          if (!nai.stream) return patch(() => ({ progress: progressOf() }))
          const url = URL.createObjectURL(new Blob([img as BlobPart], { type: mimeOf(img) }))
          patch((r) => {
            const previews = [...r.previews]
            if (previews[i]) URL.revokeObjectURL(previews[i]!)
            previews[i] = url
            return { previews, progress: progressOf() }
          })
        },
        final(i, img) {
          stepsDone[i] = g.steps - skip
          const blob = new Blob([img as BlobPart], { type: mimeOf(img) })
          saves.push((async () => saveResult(docId, src, blob, { ...rec, index: i, seed: await seedOf(blob, seed + i), model }, doc))())
          patch((r) => {
            const done = [...r.done]
            done[i] = true
            return { done, progress: progressOf() }
          })
        },
        sampleError(i, message) {
          failed = true
          toast.error(`第 ${i + 1} 张生成失败`, { description: message })
        },
      },
      undefined,
      { ...refs.files, image: png },
    )
  } finally {
    out.push(...(await Promise.all(saves)).sort((a, b) => a.index - b.index))
  }
  if (!out.length && !failed) toast.error('未收到图片')
}
