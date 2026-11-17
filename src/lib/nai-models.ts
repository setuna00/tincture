// Model data follows NovelAI getModelSupportInfo/getModelDefaultParams and qualityPresetsForModel/getModelUcPreset.
import type { DocSettings, GenParams, ModelId, ModelParams, NoiseSchedule, QualityPreset, UcPreset } from '@/types'

export type Tokenizer = 'qwen' | 't5'
type QualityText = Partial<Record<Exclude<QualityPreset, 'none'>, string>>
type UcText = Partial<Record<Exclude<UcPreset, 'none'>, string>>

export interface ModelInfo {
  id: ModelId
  api: string
  inpaintApi: string | null
  name: string
  group: 'new' | 'legacy'
  source: string
  /** NovelAI identifies models by Source hashes; exports use the first recognized hash. */
  hashes: string[]
  defaultScale: number
  scaleRecommended: [number, number]
  noiseSchedule: boolean
  varietySigma: number | null
  legacyUc: boolean
  transparency: boolean
  maxCharacters: number
  freePosition: boolean
  autoText: boolean
  vibeTransfer: boolean
  characterRefs: boolean
  tokenizer: Tokenizer
  tokenLimit: number
  /** NovelAI safe models omit the automatic nsfw prefix from negative prompts. */
  safe: boolean
  quality: QualityText
  uc: UcText
}

const V5_QUALITY: QualityText = {
  standard: 'very aesthetic, masterpiece, no text',
  light: 'very aesthetic, amazing quality, no text',
}
const V5_HEAVY =
  'lowres, artistic error, film grain, scan artifacts, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, dithering, halftone, screentone, multiple views, logo, too many watermarks, negative space, blank page'
const V5_FURRY =
  '{worst quality}, distracting watermark, unfinished, bad quality, {widescreen}, upscale, {sequence}, {{grandfathered content}}, blurred foreground, chromatic aberration, sketch, everyone, [sketch background], simple, [flat colors], ych (character), outline, multiple scenes, [[horror (theme)]], comic'
const V5_HUMAN = `${V5_HEAVY}, @_@, mismatched pupils, glowing eyes, bad anatomy`
const V5_UC: UcText = {
  heavy: V5_HEAVY,
  light: 'lowres, bad hands, bad anatomy, artistic error, sepia, white haze, worst quality, very displeasing, jpeg artifacts, 0::ai-generated::',
  'furry-focus': V5_FURRY,
  'human-focus': V5_HUMAN,
}

const V5_COMMON = {
  group: 'new',
  source: 'NovelAI Diffusion V5',
  defaultScale: 7,
  scaleRecommended: [0, Infinity],
  noiseSchedule: false,
  varietySigma: null,
  legacyUc: false,
  transparency: true,
  maxCharacters: 32,
  freePosition: true,
  autoText: true,
  vibeTransfer: false,
  characterRefs: false,
  tokenizer: 'qwen',
  quality: V5_QUALITY,
  uc: V5_UC,
} as const

const V4_COMMON = {
  group: 'legacy',
  noiseSchedule: true,
  legacyUc: false,
  transparency: false,
  maxCharacters: 6,
  freePosition: false,
  autoText: false,
  vibeTransfer: true,
  tokenizer: 't5',
  tokenLimit: 512,
} as const

export const MODELS: Record<ModelId, ModelInfo> = {
  'v5-curated': { ...V5_COMMON, id: 'v5-curated', api: 'nai-diffusion-5-curated', inpaintApi: 'nai-diffusion-4-5-curated-inpainting', name: 'V5 Curated', hashes: ['DB276663'], tokenLimit: 703, safe: true, scaleRecommended: [0, Infinity] },
  'v5-full': { ...V5_COMMON, id: 'v5-full', api: 'nai-diffusion-5-full', inpaintApi: 'nai-diffusion-5-full-inpainting', name: 'V5 Full', hashes: ['0ADF9AB7', '657484A5'], tokenLimit: 1471, safe: false, scaleRecommended: [0, Infinity] },
  'v45-curated': {
    ...V4_COMMON,
    id: 'v45-curated',
    characterRefs: true,
    api: 'nai-diffusion-4-5-curated',
    inpaintApi: 'nai-diffusion-4-5-curated-inpainting',
    name: 'V4.5 Curated',
    source: 'NovelAI Diffusion V4.5',
    hashes: ['C02D4F98', '5AB81C7C', 'B5A2A797'],
    defaultScale: 5,
    scaleRecommended: [0, Infinity],
    varietySigma: 58,
    safe: true,
    quality: { standard: 'very aesthetic, masterpiece, no text, -0.8::feet::, rating:general' },
    uc: {
      heavy:
        'blurry, lowres, upscaled, artistic error, film grain, scan artifacts, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, halftone, multiple views, logo, too many watermarks, negative space, blank page',
      light: 'blurry, lowres, upscaled, artistic error, scan artifacts, jpeg artifacts, logo, too many watermarks, negative space, blank page',
      'human-focus':
        'blurry, lowres, upscaled, artistic error, film grain, scan artifacts, bad anatomy, bad hands, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, halftone, multiple views, logo, too many watermarks, @_@, mismatched pupils, glowing eyes, negative space, blank page',
    },
  },
  'v45-full': {
    ...V4_COMMON,
    id: 'v45-full',
    characterRefs: true,
    api: 'nai-diffusion-4-5-full',
    inpaintApi: 'nai-diffusion-4-5-full-inpainting',
    name: 'V4.5 Full',
    source: 'NovelAI Diffusion V4.5',
    hashes: ['4BDE2A90', '1229B44F', 'B9F340FD', 'F3D95188'],
    defaultScale: 5,
    scaleRecommended: [0, Infinity],
    varietySigma: 58,
    safe: false,
    quality: { standard: V5_QUALITY.standard },
    uc: {
      heavy: V5_HEAVY,
      light: 'lowres, artistic error, scan artifacts, worst quality, bad quality, jpeg artifacts, multiple views, very displeasing, too many watermarks, negative space, blank page',
      'furry-focus': V5_FURRY,
      'human-focus': V5_HUMAN,
    },
  },
  'v4-curated': {
    ...V4_COMMON,
    id: 'v4-curated',
    characterRefs: false,
    api: 'nai-diffusion-4-curated-preview',
    inpaintApi: 'nai-diffusion-4-curated-inpainting',
    name: 'V4 Curated',
    source: 'NovelAI Diffusion V4',
    hashes: ['7ABFFA2A', 'C1CCBA86', '770A9E12'],
    defaultScale: 5.5,
    scaleRecommended: [2, 6],
    varietySigma: 19,
    legacyUc: true,
    safe: true,
    quality: { standard: 'rating:general, best quality, very aesthetic, absurdres' },
    uc: {
      heavy:
        'blurry, lowres, error, film grain, scan artifacts, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, logo, dated, signature, multiple views, gigantic breasts, white blank page, blank page',
      light: 'blurry, lowres, error, worst quality, bad quality, jpeg artifacts, very displeasing, logo, dated, signature, white blank page, blank page',
    },
  },
  'v4-full': {
    ...V4_COMMON,
    id: 'v4-full',
    characterRefs: false,
    api: 'nai-diffusion-4-full',
    inpaintApi: 'nai-diffusion-4-full-inpainting',
    name: 'V4 Full',
    source: 'NovelAI Diffusion V4',
    hashes: ['37442FCA', '4F49EC75', 'CA4B7203', '79F47848', 'F6302A9D'],
    defaultScale: 5.5,
    scaleRecommended: [2, 6],
    varietySigma: 19,
    legacyUc: true,
    safe: false,
    quality: { standard: 'no text, best quality, very aesthetic, absurdres' },
    uc: {
      heavy:
        'blurry, lowres, error, film grain, scan artifacts, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, multiple views, logo, too many watermarks, white blank page, blank page',
      light: 'blurry, lowres, error, worst quality, bad quality, jpeg artifacts, very displeasing, white blank page, blank page',
    },
  },
}

export const MODEL_IDS = Object.keys(MODELS) as ModelId[]
export const isModelId = (v: unknown): v is ModelId => typeof v === 'string' && v in MODELS
export const modelInfo = (m: ModelId): ModelInfo => MODELS[m] ?? MODELS['v5-full']
export const modelName = (m: ModelId) => modelInfo(m).name

/** NovelAI Medium has its own Source hashes despite sharing the V5 Full UI model. */
export const MEDIUM_HASHES = ['93F4BD30', '70AB5786']

export const qualityText = (m: ModelId, id: QualityPreset) => (id === 'none' ? '' : (modelInfo(m).quality[id] ?? ''))
export const ucText = (m: ModelId, id: UcPreset) => (id === 'none' ? '' : (modelInfo(m).uc[id] ?? ''))

export const qualityOptions = (m: ModelId): QualityPreset[] => [...(Object.keys(modelInfo(m).quality) as QualityPreset[]), 'none']
export const ucOptions = (m: ModelId): UcPreset[] => [...(Object.keys(modelInfo(m).uc) as UcPreset[]), 'none']

/** Match NovelAI getModelUcMapping: unsupported focus presets fall back through Heavy, Light, then None. */
const UC_FALLBACK: Record<UcPreset, UcPreset[]> = {
  none: ['none', 'light', 'heavy'],
  light: ['light', 'none', 'heavy'],
  heavy: ['heavy', 'light', 'none'],
  'human-focus': ['human-focus', 'heavy', 'light', 'none'],
  'furry-focus': ['furry-focus', 'heavy', 'light', 'none'],
}
export function mapUcPreset(id: UcPreset, m: ModelId): UcPreset {
  const have = ucOptions(m)
  return UC_FALLBACK[id]?.find((x) => have.includes(x)) ?? 'none'
}
/** NovelAI treats an unsupported quality preset as None rather than substituting another preset. */
export const mapQuality = (id: QualityPreset, m: ModelId): QualityPreset => (qualityOptions(m).includes(id) ? id : 'none')

export const maxCharacters = (m: ModelId) => modelInfo(m).maxCharacters

/** NovelAI switches unsupported reference models to V4.5 Full from V5 Full, otherwise V4.5 Curated. */
export function refModelFor(m: ModelId, kind: 'vibe' | 'character'): ModelId {
  const info = modelInfo(m)
  if (kind === 'vibe' ? info.vibeTransfer : info.characterRefs) return m
  return m === 'v5-full' ? 'v45-full' : 'v45-curated'
}

export const defaultGen = (m: ModelId): GenParams => ({ width: 832, height: 1216, steps: 23, scale: modelInfo(m).defaultScale, cfgRescale: 0, sampler: 'k_euler_ancestral', seed: null })

export const defaultModelParams = (m: ModelId): ModelParams => ({ qualityTags: 'standard', ucPreset: 'heavy', transparent: false, useCoords: false, gen: defaultGen(m) })

const pickParams = (s: DocSettings): ModelParams => ({ qualityTags: s.qualityTags, ucPreset: s.ucPreset, transparent: s.transparent, useCoords: s.useCoords, gen: s.gen })

/** NovelAI stores separate parameters per model; switching restores the target model's saved set or its defaults. */
export function switchModel(s: DocSettings, to: ModelId): DocSettings {
  if (s.model === to) return s
  const { perModel, ...rest } = s
  const stash: Partial<Record<ModelId, ModelParams>> = { ...perModel, [s.model]: pickParams(s) }
  const next = stash[to] ?? defaultModelParams(to)
  delete stash[to]
  return { ...rest, ...next, gen: { ...next.gen }, model: to, perModel: stash }
}

export const SAMPLERS = {
  recommended: ['k_euler_ancestral'],
  other: ['k_euler', 'k_dpmpp_2s_ancestral', 'k_dpmpp_2m_sde', 'k_dpmpp_2m', 'k_dpmpp_sde'],
}

export function defaultNoise(sampler: string): NoiseSchedule {
  switch (sampler) {
    case 'k_euler':
    case 'k_euler_ancestral':
    case 'k_dpmpp_sde':
    case 'k_dpmpp_2s_ancestral':
    case 'k_dpmpp_2m_sde':
      return 'karras'
    case 'k_dpm_2':
    case 'k_dpmpp_2m':
      return 'exponential'
    default:
      return 'native'
  }
}

export function noiseOptions(m: ModelId, sampler: string): NoiseSchedule[] {
  if (!modelInfo(m).noiseSchedule) return []
  const all: NoiseSchedule[] = sampler === 'k_dpm_2' ? ['exponential', 'polyexponential'] : SAMPLERS.recommended.includes(sampler) || SAMPLERS.other.includes(sampler) ? ['native', 'karras', 'exponential', 'polyexponential'] : []
  return all.filter((n) => n !== 'native')
}

export function effectiveNoise(m: ModelId, g: Pick<GenParams, 'sampler' | 'noiseSchedule'>): NoiseSchedule {
  if (!modelInfo(m).noiseSchedule) return 'karras'
  const opts = noiseOptions(m, g.sampler)
  if (g.noiseSchedule && opts.includes(g.noiseSchedule)) return g.noiseSchedule
  const def = defaultNoise(g.sampler)
  return opts.includes(def) ? def : (opts[0] ?? 'karras')
}

/** Match NovelAI getSNRMultiplierForResolution(4, pixelToLatentResolution([w,h], 8)); 832x1216 yields 1. */
export const snrMultiplier = (w: number, h: number) => Math.sqrt((Math.floor(w / 8) * Math.floor(h / 8)) / (104 * 152))

/** NovelAI uses null for disabled Variety+; V5 omits skip_cfg_above_sigma entirely. */
export function varietySigma(m: ModelId, g: Pick<GenParams, 'width' | 'height' | 'varietyPlus'>): number | null | undefined {
  const base = modelInfo(m).varietySigma
  if (base === null) return undefined
  return g.varietyPlus ? base * snrMultiplier(g.width, g.height) : null
}

export const GRID_CENTERS = [0.1, 0.3, 0.5, 0.7, 0.9]
const snap1 = (v: number) => GRID_CENTERS[Math.min(4, Math.max(0, Math.floor(5 * v)))]
export const snapCenter = (c: { x: number; y: number }) => ({ x: snap1(c.x), y: snap1(c.y) })
export const modelCenter = (m: ModelId, c: { x: number; y: number }) =>
  modelInfo(m).freePosition ? { x: Math.round(c.x * 1000) / 1000, y: Math.round(c.y * 1000) / 1000 } : snapCenter(c)
export const canPosition = (m: ModelId, enabledCount: number) => enabledCount >= 2 || (enabledCount === 1 && modelInfo(m).freePosition)

/** NovelAI maps unknown V5 hashes to Curated; V4.x uses exact matches, then V4.5/V4 Curated by Source prefix. */
export function modelFromSource(source: string): { model: ModelId; medium: boolean } | null {
  const s = source.trim()
  const hash = (s.match(/([0-9A-F]{8})$/i)?.[1] ?? '').toUpperCase()
  if (s.includes('NovelAI Diffusion V5')) {
    if (MEDIUM_HASHES.includes(hash)) return { model: 'v5-full', medium: true }
    return { model: MODELS['v5-full'].hashes.includes(hash) ? 'v5-full' : 'v5-curated', medium: false }
  }
  if (!s.includes('NovelAI Diffusion V4') && !s.includes('DiffusionModelMetaName.NAIv4next')) return null
  const exact: Record<string, ModelId> = {
    'DiffusionModelMetaName.NAIv4next 4BDE2A90': 'v45-full',
    'DiffusionModelMetaName.NAIv4next C02D4F98': 'v45-curated',
    'NovelAI Diffusion V4 5AB81C7C': 'v45-curated',
    'NovelAI Diffusion V4 B5A2A797': 'v45-curated',
  }
  for (const id of ['v45-full', 'v45-curated', 'v4-full', 'v4-curated'] as const) for (const h of MODELS[id].hashes) exact[`${MODELS[id].source} ${h}`] = id
  const hit = exact[s]
  if (hit) return { model: hit, medium: false }
  return { model: s.includes('V4.5') ? 'v45-curated' : 'v4-curated', medium: false }
}

export function sourceString(s: Pick<DocSettings, 'model' | 'effort'>): string {
  const info = modelInfo(s.model)
  const hash = s.model === 'v5-full' && s.effort === 'medium' ? MEDIUM_HASHES[0] : info.hashes[0]
  return `${info.source} ${hash}`
}
