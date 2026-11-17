// NovelAI precise references use information_extracted=1 and secondary_strength_values=1-Fidelity.
// NovelAI suppresses Vibe requests and charges whenever any precise reference exists, including disabled ones.
import { modelInfo } from './nai-models'
import type { CharacterRef, CharacterRefType, DocSettings, VibeRef } from '@/types'

export const MAX_CHARACTER_REFS = 16
export const VIBE_ENCODE_PRICE = 2
export const CHARACTER_REF_PRICE = 5
/** NovelAI vtAdditionalPrice charges VIBE_EXTRA_PRICE per enabled Vibe beyond VIBE_FREE. */
export const VIBE_FREE = 4
export const VIBE_EXTRA_PRICE = 2
export const vibeExtraPrice = (n: number) => VIBE_EXTRA_PRICE * Math.max(0, n - VIBE_FREE)

export const DEFAULT_STRENGTH = 0.7
export const DEFAULT_NOISE = 0

/** NovelAI defaultVTSettingsForModel uses information 0.7 for V4.5 Full, 1 otherwise; strength is 0.6. */
export const vibeDefaults = (model: DocSettings['model']) => ({ informationExtracted: model === 'v45-full' ? 0.7 : 1, strength: 0.6, enabled: true })
export const CHARACTER_REF_DEFAULT = { description: 'character&style' as CharacterRefType, strength: 1, fidelity: 1, enabled: true }

export const CHARACTER_REF_TYPES: CharacterRefType[] = ['character&style', 'character', 'style']
export const CHARACTER_REF_LABEL: Record<CharacterRefType, string> = { 'character&style': '角色和画风', character: '角色', style: '画风' }
export const CHARACTER_REF_DESC: Record<CharacterRefType, string> = { 'character&style': '参考人物外观和画风', character: '只参考人物外观', style: '只参考画风' }

const MAX_SIZE = 3_145_728
const near64 = (x: number) => Math.round(x / 64) * 64

/** NovelAI preserves matching sizes unless the base is larger; otherwise use aligned dimensions or the nearest aspect preset. */
export function baseImageSize(img: { width: number; height: number }, cur: { width: number; height: number }): { width: number; height: number } | null {
  const land = img.width / img.height > 1
  let [w, h] = land ? [img.height, img.width] : [img.width, img.height]
  if (cur.width / cur.height === img.width / img.height && w <= cur.width && h <= cur.height) return null
  if (!(w % 64 === 0 && h % 64 === 0 && w * h <= MAX_SIZE)) {
    const r = w / h
    const a = near64(1216 * r)
    const b = near64(896 / r)
    if (Math.abs(a / 1216 - r) < Math.abs(896 / b - r) && a * 1216 <= MAX_SIZE) [w, h] = [a, 1216]
    else if (896 * b <= MAX_SIZE) [w, h] = [896, b]
    else [w, h] = [512, 512]
  }
  const out = land ? { width: h, height: w } : { width: w, height: h }
  return out.width === cur.width && out.height === cur.height ? null : out
}

/** NovelAI validDirectorSizes chooses the closest aspect ratio from these canvases. */
export const DIRECTOR_SIZES: [number, number][] = [
  [1024, 1536],
  [1536, 1024],
  [1472, 1472],
]

export function directorLayout(w: number, h: number) {
  const r = w / h
  let [cw, ch] = DIRECTOR_SIZES[0]
  for (const [a, b] of DIRECTOR_SIZES) if (Math.abs(a / b - r) < Math.abs(cw / ch - r)) [cw, ch] = [a, b]
  let iw = w
  let ih = h
  if (r > cw / ch) [iw, ih] = [cw, Math.round(cw / r)]
  else [iw, ih] = [Math.round(ch * r), ch]
  return { width: cw, height: ch, image: { width: iw, height: ih, x: Math.round((cw - iw) / 2), y: Math.round((ch - ih) / 2) } }
}

/** NovelAI normalizes multiple Vibe strengths by their absolute sum only when that sum exceeds 1. */
export function normalizeStrengths(xs: number[], on = true): number[] {
  if (!on || xs.length < 2) return xs
  const sum = xs.reduce((a, b) => a + Math.abs(b), 0)
  return sum > 1 ? xs.map((x) => x / sum) : xs
}

export const vibeFitsModel = (v: VibeRef, model: DocSettings['model']) => !v.encodedFor || v.encodedFor === model

export function activeRefs(s: Pick<DocSettings, 'model' | 'baseImage' | 'vibes' | 'characterRefs'>) {
  const info = modelInfo(s.model)
  const anyChar = (s.characterRefs?.length ?? 0) > 0
  return {
    base: s.baseImage ?? null,
    vibes: info.vibeTransfer && !anyChar ? (s.vibes ?? []).filter((v) => v.enabled && vibeFitsModel(v, s.model)) : [],
    characters: info.characterRefs ? (s.characterRefs ?? []).filter((c) => c.enabled) : [],
  }
}

export function vibeBlocked(s: Pick<DocSettings, 'model' | 'characterRefs'>): 'model' | 'character' | null {
  if (!modelInfo(s.model).vibeTransfer) return 'model'
  return (s.characterRefs?.length ?? 0) > 0 ? 'character' : null
}
export const characterBlocked = (s: Pick<DocSettings, 'model'>): 'model' | null => (modelInfo(s.model).characterRefs ? null : 'model')

export interface RefCost {
  encodeCount: number
  encode: number
  extraVibes: number
  characters: number
}

/** Cached Vibe encodings are valid only for the same image, model, and information-extraction amount. */
export function refCost(s: DocSettings, nSamples: number, encoded: (v: VibeRef) => boolean): RefCost {
  const { vibes, characters } = activeRefs(s)
  const encodeCount = vibes.filter((v) => !encoded(v)).length
  return { encodeCount, encode: VIBE_ENCODE_PRICE * encodeCount, extraVibes: vibeExtraPrice(vibes.length), characters: CHARACTER_REF_PRICE * characters.length * nSamples }
}
export const refCostTotal = (c: RefCost) => c.encode + c.extraVibes + c.characters

/** Reference key arrays must follow activeRefs order; NovelAI resolves each cached key to its multipart image part. */
export function applyRefParams(
  body: { action: string; parameters: Record<string, unknown> },
  s: DocSettings,
  keys: { vibes: string[]; characters: string[] },
): { action: 'generate' | 'img2img' | 'infill'; parameters: Record<string, unknown> } {
  const { base, vibes, characters } = activeRefs(s)
  const p: Record<string, unknown> = { ...body.parameters }
  let action = body.action as 'generate' | 'img2img' | 'infill'
  if (base) {
    action = 'img2img'
    p.image = 'image'
    p.strength = s.gen.strength ?? DEFAULT_STRENGTH
    p.noise = s.gen.noise ?? DEFAULT_NOISE
    p.extra_noise_seed = (p.seed as number) - 1
    p.color_correct = false
  }
  if (vibes.length) {
    p.reference_image_multiple_cached = vibes.map((_, i) => ({ cache_secret_key: keys.vibes[i], data: `ref_multiple_${i}` }))
    p.reference_strength_multiple = normalizeStrengths(vibes.map((v) => v.strength), s.gen.normalizeRefs !== false)
  }
  if (characters.length) {
    p.director_reference_images_cached = characters.map((_, i) => ({ cache_secret_key: keys.characters[i], data: `director_ref_${i}` }))
    p.director_reference_descriptions = characters.map((c: CharacterRef) => ({ caption: { base_caption: c.description, char_captions: [] }, legacy_uc: false }))
    p.director_reference_information_extracted = characters.map(() => 1)
    p.director_reference_strength_values = characters.map((c) => c.strength)
    p.director_reference_secondary_strength_values = characters.map((c) => Math.round((1 - c.fidelity) * 100) / 100)
  }
  return { action, parameters: p }
}
