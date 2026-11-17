import { makeSection, nextCharColor } from '@/store/doc'
import type { Character, Doc, Effort, GenParams, ModelId, ModelMode, NoiseSchedule, QualityPreset, Section, UcPreset } from '@/types'
import { takeGender, type GenderDef } from './gender'
import { inflate, inflateBudget, TooLargeError, type InflateBudget } from './inflate'
import { checkImageFile, checkImageSize } from './import-budget'
import { NSFW_TAG, newId, parsePrompt, toChip } from './nai'
import { MODELS, defaultGen, mapUcPreset, maxCharacters, modelFromSource, modelInfo, qualityOptions, qualityText, switchModel, ucOptions, ucText } from './nai-models'

export type ImageMeta = Record<string, string>

const PNG_SIG = [137, 80, 78, 71, 13, 10, 26, 10]
const latin1 = new TextDecoder('latin1')
const utf8 = new TextDecoder('utf-8')
const utf8Strict = new TextDecoder('utf-8', { fatal: true })

/** PNG tEXt specifies Latin-1, but some tools write UTF-8; prefer valid UTF-8 to preserve their text. */
const decodeText = (b: Uint8Array) => {
  try {
    return utf8Strict.decode(b)
  } catch {
    return latin1.decode(b)
  }
}

export async function readPngText(file: Blob): Promise<ImageMeta> {
  await checkImageFile(file)
  const buf = new Uint8Array(await file.arrayBuffer())
  return pngText(buf, inflateBudget())
}

async function pngText(buf: Uint8Array, budget: InflateBudget): Promise<ImageMeta> {
  if (!PNG_SIG.every((b, i) => buf[i] === b)) return {}
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  const out: ImageMeta = {}
  let p = 8
  while (p + 8 <= buf.length) {
    const len = view.getUint32(p)
    const type = String.fromCharCode(...buf.subarray(p + 4, p + 8))
    const data = buf.subarray(p + 8, p + 8 + len)
    const z = data.indexOf(0)
    try {
      if (type === 'tEXt' && z > 0) {
        out[latin1.decode(data.subarray(0, z))] = decodeText(data.subarray(z + 1))
      } else if (type === 'zTXt' && z > 0) {
        out[latin1.decode(data.subarray(0, z))] = decodeText(await inflate(data.subarray(z + 2), 'deflate', budget))
      } else if (type === 'iTXt' && z > 0) {
        // iTXt layout: keyword\0, compression flag/method, language\0, translated keyword\0, UTF-8 text.
        const compressed = data[z + 1] === 1
        const lang = data.indexOf(0, z + 3)
        const tk = lang < 0 ? -1 : data.indexOf(0, lang + 1)
        if (tk > 0) {
          const body = data.subarray(tk + 1)
          out[latin1.decode(data.subarray(0, z))] = utf8.decode(compressed ? await inflate(body, 'deflate', budget) : body)
        }
      } else if (type === 'IEND') break
    } catch (e) {
      if (e instanceof TooLargeError) throw e
    }
    p += 12 + len
  }
  return out
}

function findExif(buf: Uint8Array): Uint8Array | null {
  const ascii = (a: number, b: number) => String.fromCharCode(...buf.subarray(a, b))
  const stripHeader = (d: Uint8Array) => (String.fromCharCode(...d.subarray(0, 6)) === 'Exif\0\0' ? d.subarray(6) : d)
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') {
    const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
    let p = 12
    while (p + 8 <= buf.length) {
      const len = view.getUint32(p + 4, true)
      if (ascii(p, p + 4) === 'EXIF') return stripHeader(buf.subarray(p + 8, p + 8 + len))
      p += 8 + len + (len & 1)
    }
    return null
  }
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let p = 2
    while (p + 4 <= buf.length && buf[p] === 0xff) {
      const marker = buf[p + 1]
      const len = (buf[p + 2] << 8) | buf[p + 3]
      if (marker === 0xe1 && ascii(p + 4, p + 10) === 'Exif\0\0') return buf.subarray(p + 10, p + 2 + len)
      if (marker === 0xda) break
      p += 2 + len
    }
  }
  return null
}

/** NovelAI decodes TIFF UserComment (0x9286) using its 8-byte charset prefix and strips trailing NULs. */
export function readExifUserComment(buf: Uint8Array): string | null {
  const tiff = findExif(buf)
  if (!tiff || tiff.length < 8) return null
  const view = new DataView(tiff.buffer, tiff.byteOffset, tiff.byteLength)
  const le = tiff[0] === 0x49
  const u16 = (o: number) => view.getUint16(o, le)
  const u32 = (o: number) => view.getUint32(o, le)
  const findTag = (ifd: number, tag: number) => {
    if (ifd + 2 > tiff.length) return null
    const n = u16(ifd)
    for (let i = 0; i < n; i++) {
      const e = ifd + 2 + i * 12
      if (e + 12 > tiff.length) return null
      if (u16(e) === tag) return { count: u32(e + 4), value: e + 8 }
    }
    return null
  }
  const ifd0 = u32(4)
  const exifPtr = findTag(ifd0, 0x8769)
  const entry = (exifPtr && findTag(u32(exifPtr.value), 0x9286)) || findTag(ifd0, 0x9286)
  if (!entry || entry.count < 8) return null
  const start = entry.count > 4 ? u32(entry.value) : entry.value
  const raw = tiff.subarray(start, start + entry.count)
  const head = String.fromCharCode(...raw.subarray(0, 8))
  let text: string
  if (head === 'UNICODE\0') {
    const body = raw.subarray(8)
    text = new TextDecoder(body[0] === 0xff && body[1] === 0xfe ? 'utf-16le' : 'utf-16be').decode(body)
  } else {
    text = utf8.decode(head === 'ASCII\0\0\0' || head === '\0\0\0\0\0\0\0\0' ? raw.subarray(8) : raw)
  }
  return text.replace(/\0+$/, '')
}

/** NovelAI alpha LSBs run column-first: stealth_pngcomp/stealth_pnginfo, 32-bit big-endian bit length, then payload.
 * pngcomp payloads are gzip-compressed; pnginfo payloads are raw. */
export async function decodeStealthAlpha(rgba: ArrayLike<number>, width: number, height: number, budget: InflateBudget = inflateBudget()): Promise<string | null> {
  const total = width * height
  const bit = (i: number) => rgba[((i % height) * width + Math.floor(i / height)) * 4 + 3] & 1
  const byte = (k: number) => {
    let v = 0
    for (let j = 0; j < 8; j++) v = (v << 1) | bit(k * 8 + j)
    return v
  }
  if (total < (15 + 4) * 8) return null
  const sig = String.fromCharCode(...Array.from({ length: 15 }, (_, k) => byte(k)))
  if (sig !== 'stealth_pngcomp' && sig !== 'stealth_pnginfo') return null
  const bits = ((byte(15) << 24) | (byte(16) << 16) | (byte(17) << 8) | byte(18)) >>> 0
  const n = Math.floor(bits / 8)
  if (!n || (19 + n) * 8 > total) return null
  const payload = Uint8Array.from({ length: n }, (_, k) => byte(19 + k))
  return utf8.decode(sig === 'stealth_pngcomp' ? await inflate(payload, 'gzip', budget) : payload)
}

async function readStealthAlpha(file: Blob, budget: InflateBudget): Promise<string | null> {
  const bmp = await createImageBitmap(file, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' })
  try {
    checkImageSize(bmp.width, bmp.height)
    const canvas = new OffscreenCanvas(bmp.width, bmp.height)
    const g = canvas.getContext('2d', { willReadFrequently: true })
    if (!g) return null
    g.drawImage(bmp, 0, 0)
    const { data } = g.getImageData(0, 0, bmp.width, bmp.height)
    return await decodeStealthAlpha(data, bmp.width, bmp.height, budget)
  } finally {
    bmp.close()
  }
}

function stringFields(json: string): ImageMeta {
  const obj = JSON.parse(json) as Record<string, unknown>
  const out: ImageMeta = {}
  for (const [k, v] of Object.entries(obj)) if (typeof v === 'string') out[k] = v.replaceAll('\0', '')
  return out
}

const hasNaiFields = (m: ImageMeta) => 'Comment' in m || 'Description' in m

/** Prefer PNG text, then EXIF, then alpha; text without NAI fields must not hide recoverable alpha metadata. */
export async function readImageMeta(file: Blob): Promise<ImageMeta | null> {
  await checkImageFile(file)
  const buf = new Uint8Array(await file.arrayBuffer())
  const budget = inflateBudget()
  const text = await pngText(buf, budget)
  if (hasNaiFields(text)) return text
  const rest = await readExifOrAlpha(file, buf, budget)
  return rest ?? (Object.keys(text).length ? text : null)
}

async function readExifOrAlpha(file: Blob, buf: Uint8Array, budget: InflateBudget): Promise<ImageMeta | null> {
  try {
    const exif = readExifUserComment(buf)
    if (exif) {
      const meta = stringFields(exif)
      if (Object.keys(meta).length) return meta
    }
  } catch {
  }
  try {
    const alpha = await readStealthAlpha(file, budget)
    if (alpha) return stringFields(alpha)
  } catch (e) {
    if (e instanceof TooLargeError) throw e
  }
  return null
}

export function metaSource(meta: ImageMeta): 'nai' | 'webui' | 'comfyui' | 'other' {
  if (meta.Software === 'NovelAI' || meta.Source?.startsWith('NovelAI')) return 'nai'
  try {
    const c = JSON.parse(meta.Comment ?? '') as Record<string, unknown>
    if (c && typeof c === 'object' && ('v4_prompt' in c || ('prompt' in c && 'uc' in c))) return 'nai'
  } catch {
  }
  if ('parameters' in meta) return 'webui'
  if ('workflow' in meta || 'prompt' in meta) return 'comfyui'
  return 'other'
}

const HINT_ID = ['none', 'standard', 'heavy', 'light', 'human-focus', 'furry-focus'] as const
type HintId = (typeof HINT_ID)[number]
const hintId = (n: unknown): HintId | undefined => (typeof n === 'number' ? HINT_ID[n] : undefined)
export const hintNumber = (id: QualityPreset | UcPreset) => HINT_ID.indexOf(id)

export const QUALITY_TEXT = MODELS['v5-full'].quality as Record<Exclude<QualityPreset, 'none'>, string>
export const TRANSPARENT = 'transparent background'

export const UC_PRESET_TEXT = MODELS['v5-full'].uc as Record<Exclude<UcPreset, 'none'>, string>

export const SAMPLER_NAMES: Record<string, string> = {
  k_euler_ancestral: 'Euler Ancestral',
  k_euler: 'Euler',
  k_dpmpp_2m: 'DPM++ 2M',
  k_dpmpp_2s_ancestral: 'DPM++ 2S Ancestral',
  k_dpmpp_sde: 'DPM++ SDE',
  k_dpmpp_2m_sde: 'DPM++ 2M SDE',
  k_dpmpp_3m_sde: 'DPM++ 3M SDE',
  k_dpm_2: 'DPM2',
  k_dpm_fast: 'DPM Fast',
  ddim: 'DDIM',
  ddim_v3: 'DDIM',
}

export const TEXT_START = /(?:^|\s|[,.:[\]{}、。])text:(?!:)/i

export interface ImportedCharacter {
  prompt: string
  uc: string
  center: { x: number; y: number }
}

export interface ParsedNaiImage {
  v4: boolean
  source: string
  model: ModelId
  effort: Effort
  mode: ModelMode
  quality: QualityPreset
  transparent: boolean
  ucPreset: UcPreset
  stripped: { mode: string; quality: string; uc: string }
  noise?: NoiseSchedule
  variety?: boolean
  prompt: string
  uc: string
  characters: ImportedCharacter[]
  useCoords: boolean
  gen: GenParams
}

function stripSuffix(text: string, suffix: string): string | null {
  if (text === suffix) return ''
  return text.endsWith(`, ${suffix}`) ? text.slice(0, -(suffix.length + 2)) : null
}

function stripQuality(prompt: string, model: ModelId, qt: HintId | undefined, transparentHint: boolean) {
  const m = TEXT_START.exec(prompt)
  const head = m ? prompt.slice(0, m.index) : prompt
  const tail = m ? prompt.slice(m.index) : ''
  type Cand = { id: QualityPreset; transparent: boolean }
  const suffix = (c: Cand) => {
    const q = qualityText(model, c.id)
    if (!c.transparent) return q
    return q ? `${TRANSPARENT}, ${q}` : TRANSPARENT
  }
  const presets = qualityOptions(model).filter((id) => id !== 'none')
  // A NovelAI quality hint of None permits stripping only the transparency suffix, not guessing another preset.
  const all: Cand[] = [...(transparentHint ? [...presets, 'none' as const].map((id) => ({ id, transparent: true })) : []), ...presets.map((id) => ({ id, transparent: false }))]
  let cands: Cand[]
  if ((qt === 'standard' || qt === 'light') && presets.includes(qt)) cands = [...(transparentHint ? [{ id: qt, transparent: true }] : []), { id: qt, transparent: false }, ...all]
  else if (qt === 'none') cands = transparentHint ? [{ id: 'none', transparent: true }] : []
  else cands = all
  for (const c of cands) {
    const s = suffix(c)
    const rest = stripSuffix(head, s)
    if (rest !== null) return { prompt: rest + tail, quality: c.id, transparent: c.transparent, stripped: s }
  }
  return { prompt, quality: 'none' as const, transparent: false, stripped: '' }
}

function stripUc(raw: string, model: ModelId, hint: HintId | undefined) {
  let uc = raw
  let nsfw = ''
  let preset: UcPreset = 'none'
  let presetText = ''
  if (uc === 'lowres') return { uc: '', preset, stripped: '' }
  if (uc.startsWith('nsfw')) {
    uc = uc.slice(4)
    nsfw = 'nsfw'
    if (uc.startsWith(', ')) {
      uc = uc.slice(2)
      nsfw += ', '
    }
  }
  if (raw) {
    const presets = ucOptions(model).filter((id): id is Exclude<UcPreset, 'none'> => id !== 'none')
    const take = (id: Exclude<UcPreset, 'none'>) => {
      const t = ucText(model, id)
      if (!t || !uc.startsWith(t)) return false
      preset = id
      presetText = t
      uc = uc.slice(t.length)
      if (uc.startsWith(', ')) uc = uc.slice(2)
      return true
    }
    const hinted = hint === 'none' ? 'none' : presets.find((id) => id === hint)
    // Try longer UC presets first after the hinted preset; Human Focus contains Heavy plus four tags.
    if (hinted !== 'none' && !(hinted && take(hinted))) {
      const byLength = [...presets].sort((a, b) => ucText(model, b).length - ucText(model, a).length)
      byLength.some(take)
    }
  }
  // Without a recognized UC preset, nsfw may be user text and must be restored.
  if (preset === 'none') return { uc: nsfw + uc, preset, stripped: '' }
  return { uc, preset, stripped: [nsfw.replace(/, $/, ''), presetText].filter(Boolean).join(', ') }
}

const num = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback)

interface Caption {
  char_caption?: string
  centers?: { x?: number; y?: number }[]
}

export function parseNaiImage(meta: ImageMeta): ParsedNaiImage {
  let c: Record<string, unknown> = {}
  try {
    c = (JSON.parse(meta.Comment ?? '{}') as Record<string, unknown>) ?? {}
  } catch {
    c = {}
  }
  const source = meta.Source ?? [c.model_name, c.model_hash].filter(Boolean).join(' ')
  const known = modelFromSource(source)
  const v4 = !!known
  const model: ModelId = known?.model ?? 'v5-full'
  const effort: Effort = known?.medium ? 'medium' : 'high'

  const v4p = (c.v4_prompt ?? {}) as { caption?: { char_captions?: Caption[] }; use_coords?: boolean }
  const v4n = (c.v4_negative_prompt ?? {}) as { caption?: { char_captions?: Caption[] } }
  const negs = v4n.caption?.char_captions ?? []
  const characters = (v4p.caption?.char_captions ?? []).map((cap, i) => ({
    prompt: cap?.char_caption ?? '',
    uc: negs[i]?.char_caption ?? '',
    center: { x: num(cap?.centers?.[0]?.x, 0.5), y: num(cap?.centers?.[0]?.y, 0.5) },
  }))

  const def = defaultGen(model)
  const gen: GenParams = {
    width: num(c.width, def.width),
    height: num(c.height, def.height),
    steps: num(c.steps, def.steps),
    scale: num(c.scale, def.scale),
    cfgRescale: num(c.cfg_rescale, def.cfgRescale),
    sampler: typeof c.sampler === 'string' ? c.sampler : def.sampler,
    seed: typeof c.seed === 'number' ? c.seed : null,
  }
  // NovelAI imports V4.x schedule/Variety+ (native becomes karras), but its import whitelist excludes Legacy UC.
  const info = modelInfo(model)
  const noiseRaw = c.noise_schedule
  const noise = info.noiseSchedule && typeof noiseRaw === 'string' && ['karras', 'exponential', 'polyexponential', 'native'].includes(noiseRaw) ? (noiseRaw === 'native' ? 'karras' : (noiseRaw as NoiseSchedule)) : undefined
  const variety = info.varietySigma !== null && 'skip_cfg_above_sigma' in c ? typeof c.skip_cfg_above_sigma === 'number' && c.skip_cfg_above_sigma > 0 : undefined

  // NovelAI imports Description as the prompt, even though Comment also carries a prompt field.
  let prompt = meta.Description ?? (typeof c.prompt === 'string' ? c.prompt : '')
  const rawUc = typeof c.uc === 'string' ? c.uc : ''
  const base = { v4, source, model, effort, characters, useCoords: !!v4p.use_coords, gen, ...(noise ? { noise } : {}), ...(variety === undefined ? {} : { variety }) }
  if (!v4) {
    return { ...base, mode: 'anime', quality: 'none', transparent: false, ucPreset: 'none', stripped: { mode: '', quality: '', uc: '' }, prompt, uc: rawUc }
  }

  const FUR = 'fur dataset, '
  const furry = prompt.startsWith(FUR)
  if (furry) prompt = prompt.slice(FUR.length)
  const q = stripQuality(prompt, model, hintId(c.tag_hint_qt), info.transparency && c.tag_hint_transparent_background === true)
  const u = stripUc(rawUc, model, hintId(c.tag_hint_uc_preset))
  return {
    ...base,
    mode: furry ? 'furry' : 'anime',
    quality: q.quality,
    transparent: q.transparent,
    ucPreset: u.preset,
    stripped: { mode: furry ? FUR.trim() : '', quality: q.stripped, uc: u.stripped },
    prompt: q.prompt,
    uc: u.uc,
  }
}

export type ImportItem =
  | 'prompt'
  | 'mode'
  | 'quality'
  | 'uc'
  | 'ucPreset'
  | 'coords'
  | 'model'
  | 'size'
  | 'steps'
  | 'scale'
  | 'rescale'
  | 'sampler'
  | 'noise'
  | 'variety'
  | 'seed'
  | `char:${number}`

export type ImportType = 'prompt' | 'uc' | 'chars' | 'settings' | 'seed'
export const IMPORT_TYPES: { type: ImportType; label: string }[] = [
  { type: 'prompt', label: '正面' },
  { type: 'uc', label: '负面' },
  { type: 'chars', label: '角色' },
  { type: 'settings', label: '参数' },
  { type: 'seed', label: 'Seed' },
]
export const SETTINGS_ITEMS: ImportItem[] = ['mode', 'quality', 'coords', 'model', 'size', 'steps', 'scale', 'rescale', 'sampler', 'noise', 'variety']

export function importItems(p: ParsedNaiImage): Record<ImportType, ImportItem[]> {
  const chars = p.characters.map((_, i) => `char:${i}` as const)
  const settings = p.v4 ? SETTINGS_ITEMS.filter((it) => (it !== 'coords' || p.characters.length) && (it !== 'noise' || p.noise) && (it !== 'variety' || p.variety !== undefined)) : []
  return {
    prompt: ['prompt'],
    uc: p.v4 ? ['uc', 'ucPreset'] : ['uc'],
    chars,
    settings,
    seed: p.gen.seed === null ? [] : ['seed'],
  }
}

export function defaultPicks(p: ParsedNaiImage): Set<ImportItem> {
  const items = Object.values(importItems(p)).flat()
  return new Set(
    items.filter((it) => {
      if (it === 'seed') return false
      if (it === 'prompt') return !!p.prompt.trim()
      if (it === 'uc') return !!p.uc.trim()
      if (it.startsWith('char:')) {
        const ch = p.characters[Number(it.slice(5))]
        return !!(ch.prompt.trim() || ch.uc.trim())
      }
      return true
    }),
  )
}

export function importSections(text: string): Section[] {
  const chips = parsePrompt(text).map(toChip)
  return chips.length ? [makeSection('导入', chips, 'slate')] : []
}

export function takeNsfw(sections: Section[]): { nsfw: boolean; sections: Section[] } {
  const first = sections.find((s) => !s.muted && s.chips.some((c) => !c.disabled && c.text.trim() && c.type !== 'textrender'))
  const chip = first?.chips.find((c) => !c.disabled && c.text.trim() && c.type !== 'textrender')
  if (!first || !chip || chip.type !== 'tag' || chip.interaction || Math.abs(chip.weight - 1) > 1e-9 || chip.text.trim().toLowerCase() !== NSFW_TAG) return { nsfw: false, sections }
  const chips = first.chips.filter((c) => c !== chip)
  return { nsfw: true, sections: chips.length ? sections.map((s) => (s === first ? { ...s, chips } : s)) : sections.filter((s) => s !== first) }
}

export interface ImportTarget {
  base: Doc | null
  appendChars: boolean
  genders?: readonly GenderDef[]
  nsfw?: boolean
}

export function buildImportedDoc(p: ParsedNaiImage, picks: Set<ImportItem>, { base, appendChars, genders, nsfw }: ImportTarget, defaults: Doc['settings']): { doc: Doc; dropped: number } {
  const doc: Doc = base
    ? structuredClone(base)
    : { base: { prompt: [], uc: [] }, characters: [], settings: structuredClone(defaults), meta: { title: '未命名', createdAt: Date.now() } }
  const has = (it: ImportItem) => picks.has(it)
  if (has('prompt')) {
    // Imported positive text controls the NSFW switch, preventing an extra nsfw tag on re-export.
    const n = nsfw ? takeNsfw(importSections(p.prompt)) : { nsfw: false, sections: importSections(p.prompt) }
    doc.base.prompt = n.sections
    doc.settings.nsfw = n.nsfw
  }
  if (has('uc')) doc.base.uc = importSections(p.uc)

  let dropped = 0
  const used = appendChars ? doc.characters.map((c) => c.color) : []
  const chars: Character[] = p.characters.flatMap((ch, i) => {
    if (!has(`char:${i}`)) return []
    const { gender, genderExtra, sections } = takeGender(importSections(ch.prompt), genders)
    const color = nextCharColor(used)
    used.push(color)
    const tint = (list: Section[]) => list.map((s) => ({ ...s, color }))
    return [{ id: newId('ch'), name: '', gender, ...(genderExtra ? { genderExtra } : {}), color, prompt: tint(sections), uc: tint(importSections(ch.uc)), enabled: true, center: { ...ch.center } }]
  })
  if (has('model')) {
    doc.settings = switchModel(doc.settings, p.model)
    doc.settings.effort = p.effort
  }
  if (chars.length) {
    // NovelAI limits characters by the imported model: V5 allows 32, V4.x 6; appending preserves existing characters.
    const max = maxCharacters(doc.settings.model)
    const next = appendChars ? [...doc.characters, ...chars] : chars
    const keep = Math.max(max, appendChars ? doc.characters.length : 0)
    dropped = Math.max(0, next.length - keep)
    doc.characters = next.slice(0, keep)
  }

  const s = doc.settings
  if (has('mode')) s.mode = p.mode
  if (has('quality')) {
    s.qualityTags = p.quality
    s.transparent = p.transparent
  }
  // NovelAI maps unsupported UC presets by category when switching models.
  if (has('ucPreset')) s.ucPreset = mapUcPreset(p.ucPreset, s.model)
  if (has('coords')) s.useCoords = p.useCoords
  if (has('size')) {
    s.gen.width = p.gen.width
    s.gen.height = p.gen.height
  }
  if (has('steps')) s.gen.steps = p.gen.steps
  if (has('scale')) s.gen.scale = p.gen.scale
  if (has('rescale')) s.gen.cfgRescale = p.gen.cfgRescale
  if (has('sampler')) {
    s.gen.sampler = p.gen.sampler
    delete s.gen.noiseSchedule
  }
  if (has('noise') && p.noise) s.gen.noiseSchedule = p.noise
  if (has('variety') && p.variety !== undefined) s.gen.varietyPlus = p.variety
  if (has('seed')) s.gen.seed = p.gen.seed
  return { doc, dropped }
}
