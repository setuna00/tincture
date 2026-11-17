import { Unpackr } from 'msgpackr'
import { basePrompt, characterPrompt, exportString } from './nai'
import { modelCenter, modelInfo } from './nai-models'
import { activeRefs, DEFAULT_STRENGTH, refCost, refCostTotal, type RefCost } from './nai-refs'
import { composeUc, effectiveSettings, naiComment } from './nai-write'
import type { Doc, DocSettings, UcPreset, VibeRef } from '@/types'

export const HOST = 'https://image.novelai.net'
export const SUBSCRIPTION_URL = `${HOST}/user/subscription`
export const GENERATE_URL = `${HOST}/ai/generate-image-stream`
export const GENERATE_TIMEOUT = 120_000

export interface OpusUsage {
  percent: number
  purchasedPercent: number
  timeUntilNextPercent: number
  isNegative: boolean
}

export interface NaiAccount {
  /** NovelAI tier ids: 0 = none, 1 = Tablet, 2 = Scroll, 3 = Opus. */
  tier: number
  active: boolean
  anlas: number
  usage: OpusUsage | null
}

export const TIER_NAME: Record<number, string> = { 1: 'Tablet', 2: 'Scroll', 3: 'Opus' }

const num = (v: unknown, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d)

/** NovelAI accepts trainingStepsLeft as either a number or fixedTrainingStepsLeft + purchasedTrainingSteps. */
export function parseSubscription(j: unknown): NaiAccount {
  const o = (j ?? {}) as Record<string, unknown>
  const steps = o.trainingStepsLeft
  const anlas =
    typeof steps === 'object' && steps
      ? num((steps as Record<string, unknown>).fixedTrainingStepsLeft) + num((steps as Record<string, unknown>).purchasedTrainingSteps)
      : num(steps)
  const tier = num(o.tier)
  const active = o.active === true || (num(o.expiresAt) > Date.now() / 1000 && tier > 0)
  const u = o.usage as Record<string, unknown> | undefined
  const usage: OpusUsage | null =
    u && typeof u === 'object'
      ? { percent: num(u.percent), purchasedPercent: num(u.purchasedPercent), timeUntilNextPercent: num(u.timeUntilNextPercent), isNegative: u.isNegative === true }
      : null
  return { tier, active, anlas, usage }
}

export const hasOpus = (a: NaiAccount | null | undefined): a is NaiAccount => !!a && a.tier >= 3 && a.active
export const usagePercent = (u: OpusUsage, cap = true) => {
  const p = u.isNegative ? 0 : Math.max(0, u.percent)
  return cap ? Math.min(100, p) : p
}
export const usagePurchased = (u: OpusUsage) => Math.max(0, u.purchasedPercent)
/** NovelAI converts 1% of Opus usage to approximately 17.3 images. */
export const usageImages = (percent: number) => Math.round(17.3 * percent)
export const usageIsLow = (u: OpusUsage) => (u.isNegative || u.percent < 5) && usagePurchased(u) < 5
export const usageRefillPerDay = (u: OpusUsage) => (u.timeUntilNextPercent <= 0 ? 0 : Math.round((86400 / u.timeUntilNextPercent) * 10) / 10)

export function maxSamplesForSize(w: number, h: number): number {
  const px = w * h
  return px <= 360_448 ? 8 : px <= 409_600 ? 6 : 4
}

export const imageIsOpusFree = (g: { width: number; height: number; steps: number }) => g.width * g.height <= 1_048_576 && g.steps <= 28

/** NovelAI rejects per-image prices above 140 Anlas; -3 is its too-long sentinel. */
export const PRICE_TOO_LONG = -3

export function generationPrice(s: DocSettings, nSamples: number, account: NaiAccount | null, encoded?: (v: VibeRef) => boolean): number {
  return generationPriceParts(s, nSamples, account, encoded).total
}

export function generationPriceParts(s: DocSettings, nSamples: number, account: NaiAccount | null, encoded: (v: VibeRef) => boolean = () => false): RefCost & { gen: number; total: number } {
  const eff = effectiveSettings(s)
  const { width, height, steps } = eff.gen
  const v5 = modelInfo(eff.model).group === 'new'
  const refs = activeRefs(eff)
  const gen = imagePrice({
    width,
    height,
    steps,
    n: nSamples,
    v5,
    medium: eff.model === 'v5-full' && eff.effort === 'medium',
    strength: refs.base ? (eff.gen.strength ?? DEFAULT_STRENGTH) : undefined,
    noOpusFree: refs.characters.length > 0,
    account,
  })
  const cost = refCost(eff, nSamples, encoded)
  return { gen, ...cost, total: gen === PRICE_TOO_LONG ? PRICE_TOO_LONG : gen + refCostTotal(cost) }
}

/** Match NovelAI checkStableDiffusionPrice: V5 costs x1.5 and checks Opus usage before discounting one image.
 * Img2img scales cost by strength; precise references and background removal disable the Opus discount. */
export function imagePrice(o: { width: number; height: number; steps: number; n: number; v5: boolean; medium?: boolean; strength?: number; noOpusFree?: boolean; account: NaiAccount | null }): number {
  const px = o.width * o.height
  let n = o.n
  if (!o.noOpusFree && imageIsOpusFree(o) && hasOpus(o.account) && !(o.v5 && o.account.usage?.isNegative)) n -= 1
  const d = Math.ceil(2951823174884865e-21 * px + 5753298233447344e-22 * px * o.steps * (o.medium ? 1 / 1.06521739 : 1)) * (o.v5 ? 1.5 : 1)
  const per = Math.max(Math.ceil(d * (o.strength ?? 1)), 2)
  return per > 140 ? PRICE_TOO_LONG : per * n
}

export function naiModelId(s: DocSettings): string {
  if (s.model === 'v5-full' && s.effort === 'medium') return 'nai-diffusion-5-full-medium'
  return modelInfo(s.model).api
}

const UC_PRESET_ID: Record<UcPreset, string> = { heavy: 'heavy', light: 'light', 'furry-focus': 'furryFocus', 'human-focus': 'humanFocus', none: 'none' }

export const randomSeed = () => Math.floor(Math.random() * 0x100000000) >>> 0

// NovelAI autoText appends quoted text as `teXt:` only when neither the base nor character prompts contain `Text:`.
const TEXT_ANY = /(?:^|\s|[,.:[\]{}、。])text:(?!:)/i
const QUOTES: Record<string, string> = { '"': '"', '“': '”', '「': '」', "'": "'", '‘': '’' }
const CJK = /[　-〿぀-ゟ゠-ヿ＀-ﾟ一-龯㐀-䶿]/gu
const wordChar = (c: string | undefined) => c !== undefined && /[\p{L}\p{N}]/u.test(c)
const sepChar = (c: string | undefined) => c === undefined || /[\s,.]/.test(c)

/** NovelAI treats apostrophes as opening quotes only after whitespace, a comma, or the start, preserving contractions. */
function quoted(s: string): string[] {
  const out: string[] = []
  let i = 0
  while (i < s.length) {
    const close = QUOTES[s[i]]
    if (close === undefined || (s[i] === "'" && !sepChar(s[i - 1]))) {
      i++
      continue
    }
    const apos = close === "'" || close === '’'
    let j = i + 1
    while (j < s.length && (s[j] !== close || (apos && wordChar(s[j + 1])))) j++
    if (j >= s.length) {
      i++
      continue
    }
    const t = s.slice(i + 1, j).trim()
    if (t) out.push(t)
    i = j + 1
  }
  return out
}

type CharPos = { prompt: string; center: { x: number; y: number } }

/** NovelAI orders custom-position characters by rows, then left to right; this also orders automatic text. */
function readingOrder(cs: CharPos[]): CharPos[] {
  const rows = (l: CharPos[]): CharPos[][] => {
    if (l.length <= 1) return [l]
    const span = l[l.length - 1].center.y - l[0].center.y
    let at = 1
    let gap = -1
    for (let i = 1; i < l.length; i++) {
      const d = l[i].center.y - l[i - 1].center.y
      if (d > gap) {
        gap = d
        at = i
      }
    }
    return span <= 0.15 && gap <= 0.1 ? [l] : [...rows(l.slice(0, at)), ...rows(l.slice(at))]
  }
  return rows([...cs].sort((a, b) => a.center.y - b.center.y)).flatMap((r) => r.sort((a, b) => a.center.x - b.center.x))
}

export function addAutoText(prompt: string, chars: CharPos[], useCoords: boolean): string {
  const live = chars.filter((c) => c.prompt.length > 0)
  if (TEXT_ANY.test(prompt) || live.some((c) => TEXT_ANY.test(c.prompt))) return prompt
  const segs = prompt.split('|')
  const groups = [quoted(segs[0] ?? ''), ...(useCoords ? readingOrder(live) : live).map((c) => quoted(c.prompt))]
  const flat = groups.flat().join('')
  if (flat && (flat.match(CJK)?.length ?? 0) / flat.length > 0.3) groups.forEach((g) => g.reverse())
  const texts = groups.flat()
  if (!texts.length) return prompt
  const add = `teXt: ${texts.join('\n\n')}`
  const head = (segs[0] ?? '').replace(/[\s,]+$/, '')
  segs[0] = head ? `${head}, ${add}` : add
  return segs.join('|')
}

export interface GenerateBody {
  input: string
  model: string
  action: 'generate' | 'img2img' | 'infill'
  parameters: Record<string, unknown>
  use_new_shared_trial: true
}

/** NovelAI V4.x snaps centers to a 5x5 grid and uses skip_cfg_above_sigma/legacy_uc; V5 forces karras. */
export function buildGenerateRequest(doc: Doc, opt: { seed: number; nSamples: number; straightAlpha: boolean }): GenerateBody {
  const s = effectiveSettings(doc.settings)
  const info = modelInfo(s.model)
  const c = naiComment(doc)
  const medium = s.model === 'v5-full' && s.effort === 'medium'
  const live = doc.characters.filter((ch) => ch.enabled && characterPrompt(ch).length > 0)
  const chars = live.map((ch) => ({
    prompt: characterPrompt(ch),
    uc: medium ? '' : exportString(ch.uc),
    center: modelCenter(s.model, ch.center),
    enabled: true,
  }))
  const input = info.autoText ? addAutoText(c.prompt, chars, s.useCoords) : c.prompt
  // NovelAI Medium replaces custom UC with only the preset; nsfw still depends on the positive prompt.
  const uc = medium ? composeUc('', s, c.prompt) : c.uc
  const g = s.gen
  const parameters: Record<string, unknown> = {
    params_version: 4,
    width: g.width,
    height: g.height,
    scale: g.scale,
    sampler: g.sampler,
    steps: g.steps,
    seed: opt.seed,
    n_samples: opt.nSamples,
    ucPresetId: UC_PRESET_ID[s.ucPreset],
    qualityPresetId: s.qualityTags,
    autoSmea: false,
    dynamic_thresholding: false,
    controlnet_strength: 1,
    legacy: false,
    add_original_image: true,
    ...(medium ? {} : { cfg_rescale: g.cfgRescale }),
    noise_schedule: c.noise_schedule,
    ...('skip_cfg_above_sigma' in c ? { skip_cfg_above_sigma: c.skip_cfg_above_sigma } : {}),
    legacy_v3_extend: false,
    use_coords: s.useCoords,
    legacy_uc: !!g.legacyUc,
    normalize_reference_strength_multiple: g.normalizeRefs !== false,
    inpaintImg2ImgStrength: 1,
    characterPrompts: chars,
    negative_prompt: uc,
    v4_prompt: {
      caption: { base_caption: input, char_captions: chars.map((ch) => ({ char_caption: ch.prompt, centers: [ch.center] })) },
      use_coords: s.useCoords,
      use_order: true,
    },
    v4_negative_prompt: {
      caption: { base_caption: uc, char_captions: chars.map((ch) => ({ char_caption: ch.uc, centers: [ch.center] })) },
      legacy_uc: !!g.legacyUc,
    },
    ...(s.transparent ? { tag_hint_transparent_background: true } : {}),
    tag_hint_qt: c.tag_hint_qt,
    tag_hint_uc_preset: c.tag_hint_uc_preset,
    ...(info.transparency ? { straight_alpha: opt.straightAlpha } : {}),
    ...(g.sampler === 'k_euler_ancestral' && c.noise_schedule !== 'native' ? { deliberate_euler_ancestral_bug: false, prefer_brownian: true } : {}),
    image_format: 'webp',
    stream: 'msgpack',
  }
  return { input, model: naiModelId(s), action: 'generate', parameters, use_new_shared_trial: true }
}

export const promptForName = (doc: Doc) => basePrompt(doc)

export type NaiErrorKind = 'unauthorized' | 'anlas' | 'busy' | 'network' | 'timeout' | 'server'

export class NaiError extends Error {
  kind: NaiErrorKind
  status?: number
  constructor(kind: NaiErrorKind, message: string, status?: number) {
    super(message)
    this.kind = kind
    this.status = status
  }
}

export async function errorOf(res: Response): Promise<NaiError> {
  let message = res.statusText
  try {
    const j = (await res.json()) as { message?: string }
    if (j?.message) message = j.message
  } catch {
  }
  if (res.status === 401) return new NaiError('unauthorized', message, 401)
  if (res.status === 402 || /not enough anlas/i.test(message)) return new NaiError('anlas', message, res.status)
  if (res.status === 429) return new NaiError('busy', message, 429)
  return new NaiError('server', message, res.status)
}

export const netError = (e: unknown, timedOut: boolean) =>
  e instanceof NaiError ? e : timedOut ? new NaiError('timeout', 'timeout') : new NaiError('network', e instanceof Error ? e.message : String(e))

export const auth = (token: string) => ({ Authorization: `Bearer ${token.trim()}` })

export async function fetchSubscription(token: string, signal?: AbortSignal): Promise<NaiAccount> {
  let res: Response
  try {
    res = await fetch(SUBSCRIPTION_URL, { headers: auth(token), cache: 'no-store', signal })
  } catch (e) {
    throw netError(e, false)
  }
  if (!res.ok) throw await errorOf(res)
  return parseSubscription(await res.json())
}

export interface StreamHandlers {
  intermediate(sample: number, step: number, image: Uint8Array): void
  final(sample: number, image: Uint8Array): void
  sampleError(sample: number, message: string): void
}

const field = (m: unknown, k: string): unknown => (m instanceof Map ? m.get(k) : (m as Record<string, unknown> | null)?.[k])
const bytes = (v: unknown): Uint8Array | null => (v instanceof Uint8Array ? v : v instanceof ArrayBuffer ? new Uint8Array(v) : null)

/** NovelAI frames each msgpack event with a 4-byte big-endian payload length, independent of network chunks. */
export function frameReader(onEvent: (e: unknown) => void) {
  const unpackr = new Unpackr({ mapsAsObjects: true })
  let buf = new Uint8Array(0)
  return (chunk: Uint8Array) => {
    const next = new Uint8Array(buf.length + chunk.length)
    next.set(buf)
    next.set(chunk, buf.length)
    buf = next
    while (buf.length >= 4) {
      const len = new DataView(buf.buffer, buf.byteOffset, 4).getUint32(0)
      if (buf.length < 4 + len) break
      const msg = unpackr.unpack(buf.subarray(4, 4 + len))
      buf = buf.subarray(4 + len)
      onEvent(msg)
    }
  }
}

export function dispatchEvent(e: unknown, h: StreamHandlers): void {
  const type = field(e, 'event_type')
  const sample = Number(field(e, 'samp_ix') ?? 0)
  if (type === 'error') h.sampleError(sample, String(field(e, 'message') ?? ''))
  const img = bytes(field(e, 'image'))
  if (type === 'intermediate' && img) h.intermediate(sample, Number(field(e, 'step_ix') ?? 0), img)
  if (type === 'final' && img) h.final(sample, img)
}

/** NovelAI multipart JSON names the image/mask parts; their values are part names, not embedded image data. */
export function requestForm(body: object, files: Record<string, Blob> = {}): FormData {
  const form = new FormData()
  for (const [name, blob] of Object.entries(files)) form.append(name, new Blob([blob], { type: 'image/png' }))
  form.append('request', new Blob([JSON.stringify(body)], { type: 'application/json' }))
  return form
}

export async function generateStream(token: string, body: GenerateBody, h: StreamHandlers, timeout = GENERATE_TIMEOUT, files?: Record<string, Blob>): Promise<void> {
  const ctl = new AbortController()
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    ctl.abort()
  }, timeout)
  try {
    const res = await fetch(GENERATE_URL, { method: 'POST', mode: 'cors', cache: 'no-store', headers: auth(token), body: requestForm(body, files), signal: ctl.signal })
    if (!res.ok) throw await errorOf(res)
    if (!res.body) throw new NaiError('server', 'no response body')
    const reader = res.body.getReader()
    const feed = frameReader((e) => dispatchEvent(e, h))
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      feed(value)
    }
  } catch (e) {
    throw netError(e, timedOut)
  } finally {
    clearTimeout(timer)
  }
}
