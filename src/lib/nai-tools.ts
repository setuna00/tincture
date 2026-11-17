// NovelAI /ai/upscale fixes model=nai-diffusion-5-curated, declared_blur_sigma=0, and scale=2; it returns a ZIP.
import {
  auth,
  errorOf,
  GENERATE_TIMEOUT,
  HOST,
  imagePrice,
  maxSamplesForSize,
  netError,
  NaiError,
  PRICE_TOO_LONG,
  randomSeed,
  requestForm,
  buildGenerateRequest,
  type GenerateBody,
  type NaiAccount,
} from './nai-api'
import { modelInfo } from './nai-models'
import { activeRefs, refCost, refCostTotal, type RefCost } from './nai-refs'
import { effectiveSettings } from './nai-write'
import { readZip } from './zip'
import type { Doc, DocSettings, VibeRef } from '@/types'

export const UPSCALE_URL = `${HOST}/ai/upscale`
export const AUGMENT_URL = `${HOST}/ai/augment-image`

export type DirectorTool = 'bg-removal' | 'lineart' | 'sketch' | 'colorize' | 'emotion' | 'declutter'
export type ImageAction = 'upscale' | 'enhance' | 'variations' | DirectorTool
export type GenLabel = 'upscale' | 'enhanced' | 'variations' | 'bg-removal' | 'declutter' | 'declutter-keep-bubbles' | 'lineart' | 'sketch' | 'colorize' | 'emotion' | 'inpaint'

export const DIRECTOR_TOOLS: DirectorTool[] = ['bg-removal', 'lineart', 'sketch', 'colorize', 'emotion', 'declutter']

const MAX_SIZE = 3_145_728
const OPUS_SIZE = 1_048_576
const MAX_ENHANCE_AREA = 2_516_582.4
const SIZE_STEP = 64
export const UPSCALE_MODEL = 'nai-diffusion-5-curated'
export const UPSCALE_FACTOR = 2

export const CANNOT = PRICE_TOO_LONG

export function within(w: number, h: number, px: number) {
  const r = w * h
  if (r <= px) return { width: w, height: h }
  const k = Math.sqrt(px / r)
  return { width: Math.floor(w * k), height: Math.floor(h * k) }
}
export function highest(w: number, h: number, px: number) {
  const r = w * h
  if (r >= px) return { width: w, height: h }
  const k = Math.sqrt(px / r)
  return { width: Math.floor(w * k), height: Math.floor(h * k) }
}

/** NovelAI useDoTool caps input at 3,145,728-2000 pixels and enlarges inputs below 1,011,712 to 1024 squared. */
export function toolInputSize(w: number, h: number) {
  const s = within(w, h, MAX_SIZE - 2000)
  return s.width * s.height < 1_011_712 ? highest(s.width, s.height, OPUS_SIZE) : s
}

/** NovelAI Max Enhance targets roughly x2, capped at 3,145,728 pixels and aligned to 32 rather than 64. */
export function maxEnhanceTarget(w: number, h: number) {
  const a = 2
  const r = 8 * a
  const n = Math.floor(w / r) * r * a
  const i = Math.floor(h / r) * r * a
  const o = Math.min(1, Math.sqrt(MAX_SIZE / (n * i)))
  let width = 32 * Math.round((n * o) / 32)
  let height = 32 * Math.round((i * o) / 32)
  if (width * height > MAX_SIZE) {
    width = 32 * Math.floor((n * o) / 32)
    height = 32 * Math.floor((i * o) / 32)
  }
  return { width, height }
}

export type EnhanceScale = number | 'max'

export function enhanceScales(w: number, h: number, v5: boolean): EnhanceScale[] {
  const nums = [1, 1.5, 2].filter((k) => w * k * h * k <= MAX_SIZE && (w * k) % SIZE_STEP === 0 && (h * k) % SIZE_STEP === 0)
  return v5 && w * h > 0 && w * h < MAX_ENHANCE_AREA ? [...nums, 'max'] : nums
}
export const defaultEnhanceScale = (scales: EnhanceScale[]): EnhanceScale => scales.at(-1) ?? 1

export function enhanceSize(w: number, h: number, scale: EnhanceScale) {
  return scale === 'max' ? maxEnhanceTarget(w, h) : { width: Math.floor(w * scale), height: Math.floor(h * scale) }
}

const UPSCALE_PRICES: [number, number][] = [
  [1_048_576, 1],
  [1_747_627, 2],
  [2_446_678, 3],
  [3_145_728, 4],
]
/** Match NovelAI checkUpscalePrice's pixel table; images above 1536x2048 cannot be upscaled. */
export function upscalePrice(w: number, h: number): number {
  const px = w * h
  return UPSCALE_PRICES.find(([max]) => px > 0 && px <= max)?.[1] ?? CANNOT
}

const isV5 = (doc: Doc) => modelInfo(effectiveSettings(doc.settings).model).group === 'new'
const isMedium = (doc: Doc) => {
  const s = effectiveSettings(doc.settings)
  return s.model === 'v5-full' && s.effort === 'medium'
}

export const actionRefSettings = (doc: Doc): DocSettings => {
  const s = effectiveSettings(doc.settings)
  return s.baseImage ? { ...s, baseImage: undefined } : s
}

export type ActionPrice = RefCost & { gen: number; total: number }

function withRefCost(doc: Doc, gen: number, n: number, encoded: (v: VibeRef) => boolean): ActionPrice {
  const cost = refCost(actionRefSettings(doc), n, encoded)
  return { gen, ...cost, total: gen === CANNOT ? CANNOT : gen + refCostTotal(cost) }
}
const charRefs = (doc: Doc) => activeRefs(actionRefSettings(doc)).characters.length > 0

export function enhancePriceParts(
  doc: Doc,
  img: { width: number; height: number },
  o: { scale: EnhanceScale; strength: number },
  account: NaiAccount | null,
  encoded: (v: VibeRef) => boolean = () => false,
): ActionPrice {
  if (!enhanceScales(img.width, img.height, isV5(doc)).length) return withRefCost(doc, CANNOT, 1, encoded)
  const size = enhanceSize(img.width, img.height, o.scale)
  const gen = imagePrice({ ...size, steps: effectiveSettings(doc.settings).gen.steps, n: 1, v5: isV5(doc), medium: isMedium(doc), strength: o.strength, noOpusFree: charRefs(doc), account })
  return withRefCost(doc, gen, 1, encoded)
}
export const enhancePrice = (...a: Parameters<typeof enhancePriceParts>) => enhancePriceParts(...a).total

export const variationsCount = (w: number, h: number) => Math.min(3, maxSamplesForSize(w, h))
export const VARIATIONS_STRENGTH = 0.8
export const VARIATIONS_NOISE = 0.1

export function variationsPriceParts(doc: Doc, img: { width: number; height: number }, account: NaiAccount | null, encoded: (v: VibeRef) => boolean = () => false): ActionPrice {
  const n = variationsCount(img.width, img.height)
  if (img.width * img.height > MAX_SIZE) return withRefCost(doc, CANNOT, n, encoded)
  const gen = imagePrice({
    width: img.width,
    height: img.height,
    steps: effectiveSettings(doc.settings).gen.steps,
    n,
    v5: isV5(doc),
    medium: isMedium(doc),
    strength: VARIATIONS_STRENGTH,
    noOpusFree: charRefs(doc),
    account,
  })
  return withRefCost(doc, gen, n, encoded)
}
export const variationsPrice = (...a: Parameters<typeof variationsPriceParts>) => variationsPriceParts(...a).total

/** NovelAI te prices Director Tools at 1024 squared, V3 rates, 28 steps; background removal disables Opus and costs x3+5. */
export function toolPrice(tool: DirectorTool, w: number, h: number, account: NaiAccount | null): number {
  const s = within(w, h, MAX_SIZE)
  const size = highest(s.width, s.height, OPUS_SIZE)
  const bg = tool === 'bg-removal'
  const p = imagePrice({ ...size, steps: 28, n: 1, v5: false, noOpusFree: bg, account })
  return bg && p >= 0 ? 3 * p + 5 : p
}

/** NovelAI applyEnhancePromptAdd inserts downweighted upscaled/blurry before Text:, outside rendered text. */
export function enhancePromptAdd(prompt: string): string {
  if (prompt.includes('upscaled, blurry')) return prompt
  const add = ', -2::upscaled, blurry::,'
  const m = /(?:^|\s|[,.:[\]{}、。])text:(?!:)/i.exec(prompt)
  return m ? prompt.slice(0, m.index) + add + prompt.slice(m.index) : prompt + add
}

/** NovelAI applyImg2ImgAdjustments requires extra_noise_seed=seed-1 and color_correct=false for img2img. */
function img2img(body: GenerateBody, o: { width: number; height: number; n: number; strength: number; noise: number }): GenerateBody {
  const p = body.parameters
  const seed = p.seed as number
  return { ...body, action: 'img2img', parameters: { ...p, width: o.width, height: o.height, n_samples: o.n, image: 'image', strength: o.strength, noise: o.noise, extra_noise_seed: seed - 1, color_correct: false } }
}

/** NovelAI Max Enhance sends original dimensions with upscaled_enhance and omits the normal enhancement prompt suffix. */
export function buildEnhanceRequest(
  doc: Doc,
  img: { width: number; height: number },
  o: { scale: EnhanceScale; strength: number; noise: number },
  straightAlpha: boolean,
  seed = randomSeed(),
): GenerateBody {
  const base = buildGenerateRequest(doc, { seed, nSamples: 1, straightAlpha })
  const size = o.scale === 'max' ? { width: img.width, height: img.height } : enhanceSize(img.width, img.height, o.scale)
  const body = img2img(base, { ...size, n: 1, strength: o.strength, noise: o.noise })
  if (o.scale === 'max') {
    body.parameters.upscaled_enhance = true
    return body
  }
  const input = enhancePromptAdd(body.input)
  const v4 = body.parameters.v4_prompt as { caption: { base_caption: string } }
  return { ...body, input, parameters: { ...body.parameters, v4_prompt: { ...v4, caption: { ...v4.caption, base_caption: input } } } }
}

export function buildVariationsRequest(doc: Doc, img: { width: number; height: number }, straightAlpha: boolean, seed = randomSeed()): GenerateBody {
  const n = variationsCount(img.width, img.height)
  return img2img(buildGenerateRequest(doc, { seed, nSamples: n, straightAlpha }), { width: img.width, height: img.height, n, strength: VARIATIONS_STRENGTH, noise: VARIATIONS_NOISE })
}

/** NovelAI emotion prompts end in ';;'; preserving speech bubbles changes declutter to declutter-keep-bubbles. */
export interface ToolOptions {
  prompt?: string
  emotion?: Emotion
  defry?: number
  keepBubbles?: boolean
}

export function toolRequest(tool: DirectorTool, size: { width: number; height: number }, o: ToolOptions = {}) {
  const reqType = tool === 'declutter' && o.keepBubbles ? 'declutter-keep-bubbles' : tool
  const extra = tool === 'colorize' ? { prompt: o.prompt ?? '', defry: o.defry ?? 0 } : tool === 'emotion' ? { prompt: `${o.emotion ?? 'neutral'};;`, defry: o.defry ?? 0 } : {}
  return { req_type: reqType, use_new_shared_trial: true, width: size.width, height: size.height, image: 'image', ...extra }
}

export function labelOf(action: ImageAction, o: ToolOptions = {}): GenLabel {
  if (action === 'enhance') return 'enhanced'
  if (action === 'declutter' && o.keepBubbles) return 'declutter-keep-bubbles'
  return action
}

export const EMOTIONS = [
  ['neutral', '平静'],
  ['happy', '开心'],
  ['sad', '难过'],
  ['angry', '生气'],
  ['scared', '害怕'],
  ['surprised', '惊讶'],
  ['tired', '疲惫'],
  ['excited', '兴奋'],
  ['nervous', '紧张'],
  ['thinking', '思考'],
  ['confused', '困惑'],
  ['shy', '害羞'],
  ['disgusted', '嫌弃'],
  ['smug', '得意'],
  ['bored', '无聊'],
  ['laughing', '大笑'],
  ['irritated', '烦躁'],
  ['aroused', '情动'],
  ['embarrassed', '尴尬'],
  ['worried', '担心'],
  ['love', '爱心'],
  ['determined', '坚定'],
  ['hurt', '受伤'],
  ['playful', '俏皮'],
] as const
export type Emotion = (typeof EMOTIONS)[number][0]
export const DEFRY_LABELS = ['正常', '稍弱', '弱', '更弱', '很弱', '最弱']

async function zipRequest(url: string, token: string, body: object, image: Blob): Promise<Blob[]> {
  const ctl = new AbortController()
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    ctl.abort()
  }, GENERATE_TIMEOUT)
  try {
    const res = await fetch(url, { method: 'POST', mode: 'cors', cache: 'no-store', headers: auth(token), body: requestForm(body, { image }), signal: ctl.signal })
    if (!res.ok) throw await errorOf(res)
    const entries = await readZip(await res.arrayBuffer()).catch((e: Error) => {
      throw new NaiError('server', e.message)
    })
    const files = entries.filter((f) => f.name.startsWith('image') && f.name.endsWith('.png')).sort((a, b) => a.name.localeCompare(b.name, 'en', { numeric: true }))
    if (!files.length) throw new NaiError('server', 'no image in response')
    return files.map((f) => new Blob([f.data as BlobPart], { type: 'image/png' }))
  } catch (e) {
    throw netError(e, timedOut)
  } finally {
    clearTimeout(timer)
  }
}

export const upscaleImage = (token: string, png: Blob) => zipRequest(UPSCALE_URL, token, { image: 'image', model: UPSCALE_MODEL, declared_blur_sigma: 0 }, png)

export const augmentImage = (token: string, tool: DirectorTool, png: Blob, size: { width: number; height: number }, o?: ToolOptions) => zipRequest(AUGMENT_URL, token, toolRequest(tool, size, o), png)

export async function toPng(blob: Blob, size?: { width: number; height: number }): Promise<Blob> {
  const bmp = await createImageBitmap(blob)
  const w = size?.width ?? bmp.width
  const h = size?.height ?? bmp.height
  const c = new OffscreenCanvas(w, h)
  const g = c.getContext('2d')!
  g.imageSmoothingQuality = 'high'
  g.drawImage(bmp, 0, 0, w, h)
  bmp.close()
  return c.convertToBlob({ type: 'image/png' })
}

export async function imageSize(blob: Blob): Promise<{ width: number; height: number }> {
  const bmp = await createImageBitmap(blob)
  const s = { width: bmp.width, height: bmp.height }
  bmp.close()
  return s
}
