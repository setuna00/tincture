import { characterLabel } from '@/lib/character-label'
import { nanoid } from 'nanoid'
import type { Character, Chip, ChipType, Doc, Gender, GenderExtra, GenParams, Interaction, Section } from '@/types'
import { GENDER_TAG } from '@/types'

export const WEIGHT_STEP = 0.05
export const WEIGHT_STEP_COARSE = 0.25
export const WEIGHT_MIN = -5
export const WEIGHT_MAX = 5
const BRACKET = 1.05

export const newId = (prefix: string) => `${prefix}_${nanoid(10)}`

export const V5_DEFAULT_GEN: GenParams = { width: 832, height: 1216, steps: 23, scale: 7, cfgRescale: 0, sampler: 'k_euler_ancestral', seed: null }

export const V5_SIZES: { group: string; sizes: [number, number][] }[] = [
  { group: 'Normal', sizes: [[832, 1216], [1216, 832], [1024, 1024]] },
  { group: 'Large', sizes: [[1024, 1536], [1536, 1024], [1472, 1472]] },
  { group: 'Wallpaper', sizes: [[1088, 1920], [1920, 1088]] },
  { group: 'Small', sizes: [[512, 768], [768, 512], [640, 640]] },
]
export const sizeShape = (w: number, h: number) => (w === h ? 'Square' : w > h ? 'Landscape' : 'Portrait')

export const V5_SAMPLERS = {
  recommended: ['k_euler_ancestral'],
  other: ['k_euler', 'k_dpmpp_2s_ancestral', 'k_dpmpp_2m_sde', 'k_dpmpp_2m', 'k_dpmpp_sde'],
}

export const GEN_LIMITS = {
  sizeStep: 64,
  maxPixels: 3_145_728,
  steps: { min: 1, max: 50, step: 1 },
  scale: { min: 0, max: 10, step: 0.1 },
  cfgRescale: { min: 0, max: 1, step: 0.02 },
  seedMax: 4_294_967_295,
}

export function fitSize(edited: number, other: number): [number, number] {
  const st = GEN_LIMITS.sizeStep
  const e = Math.max(st, Math.round(edited / st) * st)
  if (e * other <= GEN_LIMITS.maxPixels) return [e, other]
  return [e, Math.max(st, st * Math.floor(Math.floor(GEN_LIMITS.maxPixels / e) / st))]
}

export const NAI_SPECIAL_TAGS = new Set([
  'best quality', 'amazing quality', 'great quality', 'normal quality', 'bad quality', 'worst quality',
  'masterpiece', 'top aesthetic', 'very aesthetic', 'aesthetic', 'displeasing', 'very displeasing',
  'low complexity', 'medium complexity', 'high complexity', 'ultra complexity',
  'fur dataset', 'background dataset',
  'transparent background', 'has alpha', 'alpha transparency',
  'location', 'depthness', 'attractive male', 'visual novel art', 'visual novel bg', 'visual novel cg', 'visual novel chibi', 'visual novel sprite',
  'no text',
])

export function stepWeight(weight: number, delta: number): number {
  const snapped = Math.round((weight + delta) / WEIGHT_STEP) * WEIGHT_STEP
  return clampWeight(snapped)
}

export function clampWeight(w: number): number {
  const c = Math.min(WEIGHT_MAX, Math.max(WEIGHT_MIN, w))
  return Math.round(c * 10000) / 10000
}

export function formatWeightShort(w: number): string {
  return String(Math.round(w * 100) / 100)
}

export function formatWeight(w: number): string {
  return String(Math.round(w * 10000) / 10000)
}

export function chipLiteral(chip: Pick<Chip, 'text' | 'type' | 'interaction'>, text = chip.text): string {
  switch (chip.type) {
    case 'artist':
      return `artist:${text}`
    case 'meta':
      return `meta:${text}`
    case 'year':
      return `year ${text}`
    case 'interaction':
      return `${chip.interaction ?? 'mutual'}#${text}`
    case 'textrender':
      return `Text: ${text}`
    default:
      return text
  }
}

export type OutToken =
  | { k: 'tag'; t: string; type: ChipType; lit: string; gender?: Gender; gname?: string; nsfw?: true }
  | { k: 'open'; t: string; neg: boolean }
  | { k: 'close'; t: string; neg: boolean }
  | { k: 'sep'; t: string }

export interface ExportOptions {
  translate?: (chip: Chip) => string | undefined
}

export function exportTokens(sections: Section[], opts: ExportOptions = {}): OutToken[] {
  const all = sections.filter((s) => !s.muted).flatMap((s) => s.chips.filter((c) => !c.disabled && c.text.trim()))
  // NovelAI renders everything after Text: literally, so text chips must be last and unweighted.
  const chips = all.filter((c) => c.type !== 'textrender')
  const texts = all.filter((c) => c.type === 'textrender')
  const out: OutToken[] = []
  let i = 0
  while (i < chips.length) {
    const w = chips[i].weight
    let j = i
    while (j < chips.length && chips[j].weight === w) j++
    if (out.length) out.push({ k: 'sep', t: ', ' })
    const neg = w < 0
    if (w !== 1) out.push({ k: 'open', t: `${formatWeight(w)}::`, neg })
    let last = ''
    for (let n = i; n < j; n++) {
      if (n > i) out.push({ k: 'sep', t: ', ' })
      const c = chips[n]
      const text = opts.translate?.(c) ?? c.text
      last = chipLiteral(c, text)
      out.push({ k: 'tag', t: last, type: c.type, lit: chipLiteral(c) })
    }
    // NovelAI parses digits immediately before closing :: as another weight; add a space after numeric-looking tag endings.
    if (w !== 1) out.push({ k: 'close', t: /[\d.-]$/.test(last) ? ' ::' : '::', neg })
    i = j
  }
  if (texts.length) {
    // NovelAI permits one Text: marker; separate multiple text passages with a blank line.
    if (out.length) out.push({ k: 'sep', t: ', ' })
    const text = texts.map((c) => opts.translate?.(c) ?? c.text).join('\n\n')
    out.push({ k: 'tag', t: chipLiteral({ type: 'textrender', text }), type: 'textrender', lit: '' })
  }
  return out
}

export const exportString = (sections: Section[], opts?: ExportOptions) =>
  exportTokens(sections, opts)
    .map((t) => t.t)
    .join('')

const autoGenderTags = (c: { gender: Gender; genderExtra?: GenderExtra }) => [GENDER_TAG[c.gender], ...(c.genderExtra?.tags ?? [])].filter((t): t is string => !!t)

export function characterTokens(c: Pick<Character, 'gender' | 'genderExtra' | 'prompt'>, opts: ExportOptions = {}): OutToken[] {
  const toks = exportTokens(c.prompt, opts)
  const head: OutToken[] = []
  for (const tag of autoGenderTags(c)) {
    if (head.length) head.push({ k: 'sep', t: ', ' })
    const t = opts.translate?.({ id: '', text: tag, type: 'tag', weight: 1, disabled: false }) ?? tag
    head.push({ k: 'tag', t, type: 'tag', lit: tag, gender: c.gender, ...(c.genderExtra ? { gname: c.genderExtra.name } : {}) })
  }
  if (!head.length) return toks
  return toks.length ? [...head, { k: 'sep', t: ', ' }, ...toks] : head
}

export const characterPrompt = (c: Pick<Character, 'gender' | 'genderExtra' | 'prompt'>, opts?: ExportOptions) =>
  characterTokens(c, opts)
    .map((t) => t.t)
    .join('')

export const NSFW_TAG = 'nsfw'

export function baseTokens(doc: Pick<Doc, 'base' | 'settings'>, opts: ExportOptions = {}): OutToken[] {
  const toks = exportTokens(doc.base.prompt, opts)
  if (!doc.settings.nsfw) return toks
  const t = opts.translate?.({ id: '', text: NSFW_TAG, type: 'tag', weight: 1, disabled: false }) ?? NSFW_TAG
  const head: OutToken = { k: 'tag', t, type: 'tag', lit: NSFW_TAG, nsfw: true }
  return toks.length ? [head, { k: 'sep', t: ', ' }, ...toks] : [head]
}

export const basePrompt = (doc: Pick<Doc, 'base' | 'settings'>, opts?: ExportOptions) =>
  baseTokens(doc, opts)
    .map((t) => t.t)
    .join('')

export interface BoxExport {
  key: string
  label: string
  field: 'prompt' | 'uc'
  char?: { id: string; index: number; name: string; gender: Gender; genderExtra?: GenderExtra }
  text: string
  tokens: OutToken[]
}

export function exportDoc(doc: Doc, opts?: ExportOptions): BoxExport[] {
  const box = (key: string, label: string, field: 'prompt' | 'uc', tokens: OutToken[], char?: BoxExport['char']): BoxExport => ({
    key,
    label,
    field,
    char,
    tokens,
    text: tokens.map((t) => t.t).join(''),
  })
  const out = [box('base.prompt', '正面', 'prompt', baseTokens(doc, opts)), box('base.uc', '负面 UC', 'uc', exportTokens(doc.base.uc, opts))]
  doc.characters.forEach((c, i) => {
    if (!c.enabled) return
    const char = { id: c.id, index: i + 1, name: characterLabel(doc, c), gender: c.gender, ...(c.genderExtra ? { genderExtra: c.genderExtra } : {}) }
    out.push(box(`${c.id}.prompt`, `${characterLabel(doc, c, true)} · 正面`, 'prompt', characterTokens(c, opts), char))
    out.push(box(`${c.id}.uc`, `${characterLabel(doc, c, true)} · 负面`, 'uc', exportTokens(c.uc, opts), char))
  })
  return out
}

export interface ParsedChip {
  text: string
  type: ChipType
  weight: number
  interaction?: Interaction
}

const NUM_BEFORE = /(-?\d*\.?\d+)\s*$/
/** text:: closes a weighted tag; it must not be mistaken for the Text: rendering marker. */
const TEXT_BLOCK = /^text:(?!:)/i

/** NovelAI brace/bracket levels scale by x/divide 1.05; :: closes all active levels.
 * After Text:, commas, newlines, and :: are literal rendered text with weight 1. */
export function parsePrompt(input: string, { split = true }: { split?: boolean } = {}): ParsedChip[] {
  const out: ParsedChip[] = []
  let buf = ''
  let block = 1
  let curly = 0
  let square = 0
  const edge = split ? /^\s+|\s+$/g : /^[\s,|]+|[\s,|]+$/g
  const blank = (s: string) => !s.replace(edge, '')

  const flush = () => {
    const raw = buf.replace(edge, '')
    buf = ''
    if (!raw) return
    const w = block * Math.pow(BRACKET, curly - square)
    const chip = classify(raw, w)
    if (chip) out.push(chip)
  }

  for (let i = 0; i < input.length; i++) {
    const ch = input[i]
    if ((ch === 'T' || ch === 't') && blank(buf) && TEXT_BLOCK.test(input.slice(i, i + 6))) {
      const text = input.slice(i + 5).replace(/\r\n?/g, '\n').trim()
      if (text) out.push({ text, type: 'textrender', weight: 1 })
      return out
    }
    if (ch === ':' && input[i + 1] === ':') {
      i++
      const m = buf.match(NUM_BEFORE)
      // Require whitespace before a numeric weight so year 2024:: remains a tag rather than becoming weight 2024.
      if (m && blank(buf.slice(0, m.index))) {
        buf = buf.slice(0, m.index)
        flush()
        block = Number(m[1])
      } else {
        flush()
        block = 1
        curly = 0
        square = 0
      }
      continue
    }
    if (ch === '{' || ch === '[') {
      flush()
      if (ch === '{') curly++
      else square++
      continue
    }
    if (ch === '}' || ch === ']') {
      flush()
      if (ch === '}') curly = Math.max(0, curly - 1)
      else square = Math.max(0, square - 1)
      continue
    }
    if (split && (ch === ',' || ch === '\n' || ch === '|')) {
      flush()
      continue
    }
    buf += ch
  }
  flush()
  return out
}

function normalizeTag(s: string): string {
  return s
    .replace(/\\([()])/g, '$1')
    .replace(/(?<=[\p{L}\p{N})])_(?=[\p{L}\p{N}(])/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function classify(raw: string, weight: number): ParsedChip | null {
  let s = raw
  let w = weight
  const sd = s.match(/^\((.+):\s*(-?\d*\.?\d+)\)$/)
  if (sd) {
    s = sd[1]
    w *= Number(sd[2])
  }
  w = clampWeight(w)
  let m: RegExpMatchArray | null
  if ((m = s.match(/^artist:\s*(.+)$/i))) return { text: normalizeTag(m[1]), type: 'artist', weight: w }
  if ((m = s.match(/^meta:\s*(.+)$/i))) return { text: m[1].trim(), type: 'meta', weight: w }
  if ((m = s.match(/^year\s+(\d{3,4})$/i))) return { text: m[1], type: 'year', weight: w }
  if ((m = s.match(/^(source|target|mutual)#\s*(.+)$/i)))
    return { text: normalizeTag(m[2]), type: 'interaction', interaction: m[1].toLowerCase() as Interaction, weight: w }
  const text = normalizeTag(s)
  if (!text) return null
  const isSentence = text.split(' ').length > 4 || /[.!?。！？]$/.test(text)
  return { text, type: isSentence ? 'text' : 'tag', weight: w }
}

/** pe-doc-ai/2 items preserve embedded commas as one chip, but explicit weight groups still split into separate chips. */
export const parseTagItem = (item: string) => parsePrompt(item, { split: false })

export function toChip(p: ParsedChip): Chip {
  return { id: newId('c'), disabled: false, ...p }
}

export const isTextBlock = (s: string) => TEXT_BLOCK.test(s.trimStart())

export function looksLikePromptString(s: string): boolean {
  return /[,\n{}[\]]|::/.test(s) || isTextBlock(s)
}
