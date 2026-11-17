// pe-doc-ai/2 tags are indivisible chips, including embedded commas; v1 text is comma-separated NAI syntax.
import { characterLabel } from '@/lib/character-label'
import { produce } from 'immer'
import JSON5 from 'json5'
import { QUALITY_LABEL, UC_LABEL } from '@/components/editor/labels'
import { cleanGenderExtra, genderLabel, sameGender, type GenderValue } from './gender'
import { GEN_LIMITS, NSFW_TAG, V5_SAMPLERS, V5_SIZES, basePrompt, chipLiteral, formatWeight, newId, parsePrompt, parseTagItem, toChip, type ParsedChip } from './nai'
import { SAMPLER_NAMES, TRANSPARENT } from './nai-image'
import { MODEL_IDS, MODELS as MODEL_INFO, maxCharacters, modelName, qualityText, switchModel, ucText } from './nai-models'
import { composePrompt, composeUc, effectiveSettings } from './nai-write'
import { hasScope } from './random-block'
import { applyParsedChips, sameChips } from './section-text'
import { allSections, nextCharColor } from '@/store/doc'
import {
  MAX_CHARACTERS,
  type BoxField,
  type BoxRef,
  type Character,
  type Chip,
  type Doc,
  type DocSettings,
  type Effort,
  type Gender,
  type GenParams,
  type ModelId,
  type ModelMode,
  type QualityPreset,
  SECTION_COLORS,
  type Section,
  type SectionColor,
  type UcPreset,
} from '@/types'

export const AI_DOC_SCHEMA_ID = 'pe-doc-ai/2'
export const AI_DOC_SCHEMA_IDS: readonly string[] = [AI_DOC_SCHEMA_ID, 'pe-doc-ai/1']

export interface AiSection {
  id?: string
  name?: string
  color?: SectionColor
  enabled?: boolean
  note?: string
  tags?: string[]
  text?: string
  disabled?: string[]
  after?: string
  delete?: boolean
}
export interface AiCharacter {
  id?: string
  name?: string
  gender?: Gender
  genderExtra?: { name: string; tags: string[] } | null
  enabled?: boolean
  center?: { x: number; y: number }
  note?: string
  prompt?: AiSection[]
  uc?: AiSection[]
  delete?: boolean
}
export interface AiSettings {
  model?: ModelId
  mode?: ModelMode
  effort?: Effort
  qualityTags?: QualityPreset
  ucPreset?: UcPreset
  transparent?: boolean
  useCoords?: boolean
  width?: number
  height?: number
  steps?: number
  scale?: number
  cfgRescale?: number
  sampler?: string
  seed?: number | null
  nsfw?: boolean
}

export interface AiOptions {
  nsfw?: boolean
}
export interface AiDoc {
  $schema: typeof AI_DOC_SCHEMA_ID
  comment?: string
  title?: string
  prompt?: AiSection[]
  uc?: AiSection[]
  characters?: AiCharacter[]
  settings?: AiSettings
}

const MODELS: readonly ModelId[] = MODEL_IDS
const MODES: readonly ModelMode[] = ['anime', 'furry']
const EFFORTS: readonly Effort[] = ['high', 'medium']
const QUALITIES = Object.keys(QUALITY_LABEL) as QualityPreset[]
const UC_PRESETS = Object.keys(UC_LABEL) as UcPreset[]
const GENDERS: readonly Gender[] = ['female', 'male', 'other']
const COLORS = Object.keys(SECTION_COLORS) as SectionColor[]
const colorOf = (v: unknown) => (COLORS.includes(v as SectionColor) ? (v as SectionColor) : undefined)
const SAMPLERS = [...V5_SAMPLERS.recommended, ...V5_SAMPLERS.other]

export const chipWithWeight = (c: Chip) => (c.weight === 1 ? chipLiteral(c) : `${formatWeight(c.weight)}::${chipLiteral(c)}::`)
const chipKey = (c: Pick<Chip, 'text' | 'type' | 'interaction'>) => chipLiteral(c).toLowerCase()

export function toAiSection(s: Section): AiSection {
  const tags = s.chips.filter((c) => !c.disabled && c.text.trim()).map(chipWithWeight)
  const o: AiSection = { id: s.id, name: s.name, color: s.color, enabled: !s.muted, tags }
  if (s.note?.trim()) o.note = s.note
  const off = s.chips.filter((c) => c.disabled && c.text.trim())
  if (off.length) o.disabled = off.map(chipWithWeight)
  return o
}

export function toAiDoc(doc: Doc, opts: AiOptions = {}): AiDoc {
  const { gen, nsfw, ...rest } = doc.settings
  const s: Omit<AiSettings, keyof GenParams> = { ...rest, ...(opts.nsfw ? { nsfw: !!nsfw } : {}) }
  return {
    $schema: AI_DOC_SCHEMA_ID,
    title: doc.meta.title,
    prompt: doc.base.prompt.map(toAiSection),
    uc: doc.base.uc.map(toAiSection),
    characters: doc.characters.map((c) => {
      const o: AiCharacter = { id: c.id, name: c.name, gender: c.gender, enabled: c.enabled, center: { ...c.center } }
      if (c.genderExtra) o.genderExtra = structuredClone(c.genderExtra)
      if (c.note?.trim()) o.note = c.note
      return { ...o, prompt: c.prompt.map(toAiSection), uc: c.uc.map(toAiSection) }
    }),
    settings: { ...s, width: gen.width, height: gen.height, steps: gen.steps, scale: gen.scale, cfgRescale: gen.cfgRescale, sampler: gen.sampler, seed: gen.seed },
  }
}

const sectionSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'string' },
    name: { type: 'string' },
    color: { enum: COLORS },
    enabled: { type: 'boolean', description: 'false = the whole section is off (not exported)' },
    note: { type: 'string', description: "The user's note; read-only" },
    tags: { type: 'array', items: { type: 'string' }, description: 'Enabled tags, one per item' },
    disabled: { type: 'array', items: { type: 'string' }, description: 'Tags switched off in this section (not exported), one per item' },
    after: { type: 'string', description: 'New section: id of the section to place it after; omitted = last' },
    delete: { const: true },
  },
} as const
const sectionList = { type: 'array', items: { $ref: '#/$defs/section' } } as const

export const AI_DOC_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: AI_DOC_SCHEMA_ID,
  title: 'NovelAI prompt in sections',
  type: 'object',
  required: ['$schema'],
  additionalProperties: false,
  properties: {
    $schema: { const: AI_DOC_SCHEMA_ID },
    comment: { type: 'string' },
    complete: { const: true },
    title: { type: 'string', description: 'Document title; read-only' },
    prompt: sectionList,
    uc: sectionList,
    characters: {
      type: 'array',
      maxItems: MAX_CHARACTERS,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          gender: { enum: GENDERS, description: "female / male: girl / boy is added at the start of this character's prompt; other: nothing" },
          genderExtra: {
            type: ['object', 'null'],
            additionalProperties: false,
            required: ['name', 'tags'],
            properties: { name: { type: 'string' }, tags: { type: 'array', items: { type: 'string' }, minItems: 1 } },
            description: 'Tags added right after girl / boy (e.g. male + ["otoko no ko"]); null = none. When gender changes, write it too, or it is removed',
          },
          enabled: { type: 'boolean', description: 'false = the character is not exported' },
          center: {
            type: 'object',
            additionalProperties: false,
            required: ['x', 'y'],
            properties: { x: { type: 'number', minimum: 0, maximum: 1 }, y: { type: 'number', minimum: 0, maximum: 1 } },
            description: 'Position in the image, 0–1, y down; used only when settings.useCoords is true',
          },
          note: { type: 'string', description: "The user's note; read-only" },
          prompt: sectionList,
          uc: sectionList,
          delete: { const: true },
        },
      },
    },
    settings: {
      type: 'object',
      additionalProperties: false,
      properties: {
        model: { enum: MODELS, description: MODELS.map((m) => `${m} = NAI Diffusion ${MODEL_INFO[m].name}`).join('; ') },
        mode: { enum: MODES, description: 'furry adds fur dataset at the start of the prompt' },
        effort: { enum: EFFORTS, description: 'v5-full only; medium fixes steps 14, sampler k_euler_ancestral, ucPreset heavy, and ignores uc' },
        qualityTags: { enum: QUALITIES, description: 'Quality tags preset, added at the end of the prompt at generation' },
        ucPreset: { enum: UC_PRESETS, description: 'UC preset, added at the start of uc at generation' },
        transparent: { type: 'boolean', description: 'Transparent background' },
        nsfw: { type: 'boolean', description: 'true = nsfw is added at the start of the prompt. Can be changed only when the document has it' },
        useCoords: { type: 'boolean', description: "true = each character's center is used (Custom); false = AI's Choice" },
        width: { type: 'integer', multipleOf: GEN_LIMITS.sizeStep, minimum: GEN_LIMITS.sizeStep, description: `Multiple of 64; width × height ≤ ${GEN_LIMITS.maxPixels}. Presets: ${V5_SIZES.map((g) => `${g.group} ${g.sizes.map(([w, h]) => `${w}×${h}`).join(' / ')}`).join('; ')}` },
        height: { type: 'integer', multipleOf: GEN_LIMITS.sizeStep, minimum: GEN_LIMITS.sizeStep, description: 'Same rules as width' },
        steps: { type: 'integer', minimum: GEN_LIMITS.steps.min, maximum: GEN_LIMITS.steps.max },
        scale: { type: 'number', minimum: GEN_LIMITS.scale.min, maximum: GEN_LIMITS.scale.max, description: 'Prompt Guidance' },
        cfgRescale: { type: 'number', minimum: GEN_LIMITS.cfgRescale.min, maximum: GEN_LIMITS.cfgRescale.max, description: 'Prompt Guidance Rescale' },
        sampler: { enum: SAMPLERS, description: SAMPLERS.map((k) => `${k} = ${SAMPLER_NAMES[k] ?? k}`).join('; ') },
        seed: { type: ['integer', 'null'], minimum: 0, maximum: GEN_LIMITS.seedMax, description: 'null = random' },
      },
    },
  },
  $defs: { section: sectionSchema },
} as const

export function autoTagsRule(doc: Doc, opts: AiOptions = {}): string {
  const s = effectiveSettings(doc.settings)
  const on = !!doc.settings.nsfw
  const parts: string[] = []
  const head = [s.mode === 'furry' && 'fur dataset', on && NSFW_TAG].filter(Boolean).join(', ')
  const headFrom = [s.mode === 'furry' && 'mode furry', on && 'nsfw true'].filter(Boolean).join(', ')
  if (head) parts.push(`prompt start: ${head} (${headFrom})`)
  const tail = [s.transparent && TRANSPARENT, qualityText(s.model, s.qualityTags)].filter(Boolean).join(', ')
  const tailFrom = [s.transparent && 'transparent true', s.qualityTags !== 'none' && `qualityTags ${s.qualityTags}`].filter(Boolean).join(', ')
  if (tail) parts.push(`prompt end: ${tail} (${tailFrom})`)
  if (s.ucPreset !== 'none') {
    const ucNsfw = !!opts.nsfw && !on && composeUc('', s, composePrompt(basePrompt(doc), { ...s, mode: 'anime' })).startsWith(`${NSFW_TAG}, `)
    parts.push(`uc start: ${ucNsfw ? `${NSFW_TAG}, ` : ''}${ucText(s.model, s.ucPreset)} (ucPreset ${s.ucPreset}${ucNsfw ? '; NovelAI adds nsfw while the prompt has none, not when settings.nsfw is true' : ''})`)
  }
  return parts.length ? `\n- Added automatically at generation (don't add them to tags; change settings to drop them): ${parts.join('; ')}.` : ''
}

export const aiRules = (doc: Doc, opts: AiOptions = {}, to: 'reply' | 'agent' = 'reply') => `Task: edit a NovelAI image prompt as the user requests. It comes from an editor that organizes the prompt in sections and is given as JSON (fields in the JSON Schema); reply with your changes in the same JSON format.
- Change only what the request touches: add, remove or edit tags to fulfil it (including existing tags that conflict with it); leave everything else (other tags, order, weights, grouping, settings) unchanged.
- If unsure, go with the most reasonable reading and make the edit${to === 'agent' ? '.' : "; don't ask questions."}

Structure
- prompt (positive) and uc (negative) are each a list of sections. Sections just group tags; the user decides how (by content, by priority, …); name and color are only labels. On export, the enabled tags in enabled sections are joined in order with commas; that order is their order in the prompt.
- tags: one tag per item (["long hair", "blue eyes"], not ["long hair, blue eyes"]); an item has commas only when it is one descriptive sentence. Syntax: 1.2::tag:: for weight (below 1 weakens, negative inverts); parentheses are part of tag names, as in fern (sousou no frieren), not weights; artist:name; year 2024; source#action / target#action / mutual#action for actions between characters (doer / receiver / both); Text: words to draw in the image (always put last on export).
- characters: each has its own prompt / uc; this model allows up to ${maxCharacters(doc.settings.model)}. Tags for one character (identity, looks, clothing, expression, actions) go in that character; tags for the whole image (count such as 1girl / 2girls, composition, background, style, artists) go in the top-level prompt. gender adds girl / boy automatically, and genderExtra adds its tags; don't write them.${autoTagsRule(doc, opts)}

Reply
- ${to === 'agent' ? `Pass the JSON object, with "$schema": "${AI_DOC_SCHEMA_ID}", as \`reply\` to edit_document (an object, not a code block).` : `Exactly one \`\`\`json code block with "$schema": "${AI_DOC_SCHEMA_ID}", nothing outside it.`}
- Partial edit (the default): write only the sections, characters and settings you change; anything left out stays as is. For an existing one, write its id and only the changed fields; tags and disabled, when written, are the full list after the edit (keep the unchanged tags in it). New ones get no id (don't make one up): a new section takes name, color, tags, after; a new character takes name, gender, prompt / uc; name them in the language of the existing names. To delete: {"id": "…", "delete": true}.
- Full rewrite, only when the request asks to redo the whole prompt: set "complete": true and return the whole document, copying existing ids; sections and characters missing from a list you write are deleted.
- If the request asks for analysis, add a top-level comment: why you made these changes, and what you couldn't do or weren't sure about; don't list the tag changes; write it in the request's language.
- Example of the format (change a section, add one after it, delete one): {"$schema": "${AI_DOC_SCHEMA_ID}", "prompt": [{"id": "s_aaaaaaaaaa", "tags": ["outdoors", "night", "1.2::starry sky::"]}, {"name": "Light", "color": "amber", "tags": ["moonlight"], "after": "s_aaaaaaaaaa"}, {"id": "s_bbbbbbbbbb", "delete": true}]}`

const SCHEMA_TEXT = ['## JSON Schema', '```json', JSON.stringify(AI_DOC_SCHEMA), '```'].join('\n')
export const docText = (doc: Doc, opts: AiOptions) => ['## Current document', '```json', JSON.stringify(toAiDoc(doc, opts), null, 2), '```'].join('\n')
const REQUEST_HEAD = '## Request'

export function aiPromptText(doc: Doc, opts: AiOptions = {}): string {
  return [aiRules(doc, opts), SCHEMA_TEXT, docText(doc, opts), `${REQUEST_HEAD}\n`].join('\n\n')
}

export function aiAgentText(doc: Doc, opts: AiOptions = {}): string {
  const tool = 'Write tag names exactly as search_tags / lookup_tags return them.'
  return [aiRules(doc, opts, 'agent'), tool, SCHEMA_TEXT, docText(doc, opts), randomSectionsText(doc)].filter(Boolean).join('\n\n')
}

export function randomLocked(s: Section): string[] {
  return (s.random?.locked ?? []).map((t) => {
    const c = s.chips.find((x) => x.text === t)
    return c ? chipLiteral(c) : t
  })
}

export function randomSectionsText(doc: Doc): string {
  const rows: string[] = []
  const visit = (list: Section[], place: string) => {
    for (const s of list) {
      const r = s.random
      if (!r) continue
      const [lo, hi] = r.count
      const noun = r.kind === 'artist' ? 'artist' : r.kind === 'char' ? 'character' : 'tag'
      const draws = `draws ${lo === hi ? lo : `${lo}–${hi}`} ${noun}${hi === 1 ? '' : 's'}${r.kind === 'char' ? ' (with its work tag)' : ''}`
      const locked = randomLocked(s)
      const state = !hasScope(r)
        ? 'no range chosen yet (the user chooses it in Tincture; reroll_random cannot draw)'
        : r.lockAll
          ? 'the whole section is locked (reroll_random changes nothing)'
          : locked.length
            ? `locked: ${locked.join(', ')}`
            : 'nothing locked'
      rows.push(`- ${s.id} "${s.name}" in ${place}: ${draws}; ${state}`)
    }
  }
  visit(doc.base.prompt, 'prompt')
  visit(doc.base.uc, 'uc')
  for (const c of doc.characters) {
    visit(c.prompt, `character ${c.id} prompt`)
    visit(c.uc, `character ${c.id} uc`)
  }
  if (!rows.length) return ''
  return ['## Random sections', "Tincture draws these sections' tags from a range the user chose; reroll_random draws a section again (locked tags stay).", ...rows].join('\n')
}

export const AI_ANALYSIS_ASK = '请附带分析。'

export function aiAskMessages(doc: Doc, opts: AiOptions, ask: { rules: string[]; request: string; analysis: boolean }): { system: string; user: string } {
  const rules = ask.rules.map((r) => r.trim()).filter(Boolean)
  const request = [ask.request.trim(), ask.analysis ? AI_ANALYSIS_ASK : ''].filter(Boolean).join('\n\n')
  return { system: [...rules, aiRules(doc, opts), SCHEMA_TEXT].join('\n\n'), user: [docText(doc, opts), `${REQUEST_HEAD}\n${request}`].join('\n\n') }
}

export function diagnoseReply(text: string): { kind: 'nojson' } | { kind: 'format'; zh: string; en: string } {
  const block = /```[\w-]*[^\S\n]*\n([\s\S]*?)(```|$)/.exec(text)?.[1]
  const part = block ?? text
  const start = part.indexOf('{')
  if (start < 0) return { kind: 'nojson' }
  const end = part.lastIndexOf('}')
  try {
    const o = parseLoose(part.slice(start, end + 1))
    if (!isObj(o) || !AI_DOC_SCHEMA_IDS.includes(o.$schema as string))
      return { kind: 'format', zh: `缺少 "$schema": "${AI_DOC_SCHEMA_ID}"`, en: `the JSON has no "$schema": "${AI_DOC_SCHEMA_ID}"` }
    return { kind: 'format', zh: 'JSON 无法读取', en: 'the JSON could not be read' }
  } catch (e) {
    return { kind: 'format', zh: 'JSON 无法解析', en: `the JSON is invalid (${e instanceof Error ? e.message : String(e)})` }
  }
}

export const aiRetryAsk = (en: string) => `Your reply could not be used: ${en}. Reply again with exactly one \`\`\`json code block with "$schema": "${AI_DOC_SCHEMA_ID}", nothing outside it.`

export function aiPromptFile(doc: Doc, opts: AiOptions = {}): string {
  return JSON.stringify({ instructions: aiRules(doc, opts), schema: AI_DOC_SCHEMA, document: toAiDoc(doc, opts) }, null, 2)
}

export const aiFileName = (title: string) => `${title.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim() || '未命名'}.json`

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

function parseLoose(s: string): unknown {
  try {
    return JSON.parse(s)
  } catch (e) {
    try {
      return JSON5.parse(s)
    } catch {
      throw e
    }
  }
}

function* jsonObjects(s: string): Generator<unknown> {
  let i = s.indexOf('{')
  let tries = 0
  while (i >= 0 && tries++ < 50) {
    let depth = 0
    let inStr = false
    let end = -1
    for (let j = i; j < s.length; j++) {
      const ch = s[j]
      if (inStr) {
        if (ch === '\\') j++
        else if (ch === '"') inStr = false
      } else if (ch === '"') inStr = true
      else if (ch === '{') depth++
      else if (ch === '}' && --depth === 0) {
        end = j
        break
      }
    }
    if (end < 0) return
    try {
      yield parseLoose(s.slice(i, end + 1))
    } catch {
    }
    i = s.indexOf('{', end + 1)
  }
}

export function findAiJson(text: string): Record<string, unknown> | null {
  if (!AI_DOC_SCHEMA_IDS.some((id) => text.includes(id))) return null
  const blocks = [...text.matchAll(/```[\w-]*[^\S\n]*\n([\s\S]*?)```/g)].map((m) => m[1])
  for (const part of [...blocks, text]) for (const o of jsonObjects(part)) if (isObj(o) && AI_DOC_SCHEMA_IDS.includes(o.$schema as string)) return o
  return null
}

export interface SectionDiff {
  added: Chip[]
  removed: Chip[]
  reweighted: { chip: Chip; from: number }[]
  enabled: Chip[]
  disabled: Chip[]
  rename?: [string, string]
  color?: [SectionColor, SectionColor]
  muted?: boolean
  reordered: boolean
}

export type AiGroup = 'prompt' | 'uc' | 'char' | 'settings'

interface Base {
  key: string
  group: AiGroup
  title: string
  line: string
  defaultOn: boolean
}
export type AiChange =
  | (Base & { kind: 'section'; box: BoxRef; before: Section; after: Section; diff: SectionDiff; counts: string })
  | (Base & { kind: 'newSection'; box: BoxRef; section: Section; afterId: string | null; afterName: string | null })
  | (Base & { kind: 'deleteSection'; box: BoxRef; section: Section })
  | (Base & { kind: 'char'; charId: string; patch: Partial<Pick<Character, 'name' | 'gender' | 'genderExtra' | 'enabled' | 'center'>>; parts: string[] })
  | (Base & { kind: 'newChar'; character: Character })
  | (Base & { kind: 'deleteChar'; character: Character })
  | (Base & { kind: 'setting'; patch: Partial<Omit<DocSettings, 'gen'>>; gen: Partial<GenParams>; from: string; to: string })

export interface AiPlan {
  changes: AiChange[]
  skipped: string[]
  comment?: string
}

export function markedChips(d: SectionDiff): Set<string> {
  return new Set([...d.added, ...d.reweighted.map((r) => r.chip), ...d.enabled, ...d.disabled].map((c) => c.id))
}

const list = (chips: Chip[], max = 8) => {
  const names = chips.map((c) => chipLiteral(c))
  return names.length > max ? `${names.slice(0, max).join('、')} 等 ${names.length} 个` : names.join('、')
}

export function diffSection(before: Section, after: Section): SectionDiff {
  const pool = new Map<string, Chip[]>()
  for (const c of before.chips) pool.set(chipKey(c), [...(pool.get(chipKey(c)) ?? []), c])
  const d: SectionDiff = { added: [], removed: [], reweighted: [], enabled: [], disabled: [], reordered: false }
  const kept: string[] = []
  const keptBefore = new Set<string>()
  for (const c of after.chips) {
    const cands = pool.get(chipKey(c)) ?? []
    const i = cands.findIndex((x) => x.disabled === c.disabled)
    const j = i >= 0 ? i : cands.length ? 0 : -1
    if (j < 0) {
      d.added.push(c)
      continue
    }
    const [b] = cands.splice(j, 1)
    keptBefore.add(b.id)
    if (b.disabled !== c.disabled) (c.disabled ? d.disabled : d.enabled).push(c)
    else {
      kept.push(b.id)
      if (b.weight !== c.weight) d.reweighted.push({ chip: c, from: b.weight })
    }
  }
  d.removed = before.chips.filter((c) => !keptBefore.has(c.id))
  const same = new Set(kept)
  d.reordered = before.chips.filter((c) => same.has(c.id)).map((c) => c.id).join('\n') !== kept.join('\n')
  if (before.name !== after.name) d.rename = [before.name, after.name]
  if (before.color !== after.color) d.color = [before.color, after.color]
  if (before.muted !== after.muted) d.muted = after.muted
  return d
}

const colorChange = ([a, b]: [SectionColor, SectionColor]) => `颜色 ${SECTION_COLORS[a].label} → ${SECTION_COLORS[b].label}`
const diffParts = (d: SectionDiff) => {
  const p: string[] = []
  if (d.added.length) p.push(`添加 ${list(d.added)}`)
  if (d.removed.length) p.push(`移除 ${list(d.removed)}`)
  for (const r of d.reweighted) p.push(`${chipLiteral(r.chip)} ${formatWeight(r.from)} → ${formatWeight(r.chip.weight)}`)
  if (d.disabled.length) p.push(`禁用 ${list(d.disabled)}`)
  if (d.enabled.length) p.push(`启用 ${list(d.enabled)}`)
  if (d.rename) p.push(`重命名「${d.rename[0]}」→「${d.rename[1]}」`)
  if (d.color) p.push(colorChange(d.color))
  if (d.muted !== undefined) p.push(d.muted ? '停用此区块' : '启用此区块')
  if (d.reordered && !d.added.length && !d.removed.length) p.push('调整顺序')
  return p
}
const diffCounts = (d: SectionDiff) => {
  const p: string[] = []
  if (d.added.length) p.push(`添加 ${d.added.length}`)
  if (d.removed.length) p.push(`移除 ${d.removed.length}`)
  if (d.reweighted.length) p.push(`调整权重 ${d.reweighted.length}`)
  if (d.disabled.length) p.push(`禁用 ${d.disabled.length}`)
  if (d.enabled.length) p.push(`启用 ${d.enabled.length}`)
  if (d.rename) p.push('重命名')
  if (d.color) p.push(colorChange(d.color))
  if (d.muted !== undefined) p.push(d.muted ? '停用' : '启用')
  if (d.reordered && !d.added.length && !d.removed.length) p.push('调整顺序')
  return p.join(' · ')
}

const strs = (v: unknown): string[] | undefined => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : undefined)

function applyDisabled(chips: Chip[], wanted: string[], old: Chip[] = []): Chip[] {
  const want = new Map<string, ParsedChip[]>()
  for (const s of wanted) {
    const p = parseTagItem(s)[0]
    if (p) want.set(chipKey(p), [...(want.get(chipKey(p)) ?? []), p])
  }
  const out: Chip[] = []
  for (const c of chips) {
    if (!c.disabled) {
      out.push(c)
      continue
    }
    const q = want.get(chipKey(c))?.shift()
    if (q) out.push(q.weight === c.weight ? c : { ...c, weight: q.weight })
  }
  for (const [k, qs] of want)
    for (const q of qs) {
      const i = out.findIndex((c) => !c.disabled && chipKey(c) === k)
      if (i >= 0) {
        out[i] = { ...out[i], disabled: true, weight: q.weight }
        continue
      }
      const o = old.find((c) => !c.disabled && chipKey(c) === k && !out.some((x) => x.id === c.id))
      if (!o) {
        out.push({ ...toChip(q), disabled: true })
        continue
      }
      let at = 0
      for (let j = old.indexOf(o) - 1; j >= 0; j--) {
        const prev = out.findIndex((x) => x.id === old[j].id)
        if (prev >= 0) {
          at = prev + 1
          break
        }
      }
      out.splice(at, 0, { ...o, disabled: true, weight: q.weight })
    }
  return out
}

function withColor(s: Section, color: SectionColor, charColor: SectionColor | null): Section {
  const { ownColor: _, ...rest } = s
  return charColor && color !== charColor ? { ...rest, color, ownColor: true } : { ...rest, color }
}

const enabledOf = (p: Record<string, unknown>): ParsedChip[] | null => {
  const tags = strs(p.tags)
  if (tags) return tags.flatMap(parseTagItem)
  return typeof p.text === 'string' ? parsePrompt(p.text) : null
}

function patchSection(old: Section, p: Record<string, unknown>, charColor: SectionColor | null): Section {
  let chips = old.chips
  const on = enabledOf(p)
  const dis = strs(p.disabled)
  if (on || dis) {
    if (on) chips = applyParsedChips(old.chips, on)
    chips = applyDisabled(chips, dis ?? old.chips.filter((c) => c.disabled).map(chipWithWeight), old.chips)
  }
  const name = typeof p.name === 'string' && p.name.trim() ? p.name.trim() : old.name
  const muted = typeof p.enabled === 'boolean' ? !p.enabled : old.muted
  const color = colorOf(p.color) ?? old.color
  const next = { ...old, name, muted, chips: sameChips(old.chips, chips) ? old.chips : chips }
  return color === old.color ? next : withColor(next, color, charColor)
}

function newSectionOf(p: Record<string, unknown>, charColor: SectionColor | null): Section | null {
  const chips = (enabledOf(p) ?? []).map(toChip)
  const dis = strs(p.disabled)
  const all = dis ? applyDisabled(chips, dis) : chips
  if (!all.length) return null
  const name = typeof p.name === 'string' && p.name.trim() ? p.name.trim() : '新区块'
  return withColor({ id: newId('s'), name, color: 'slate', muted: p.enabled === false, chips: all }, colorOf(p.color) ?? charColor ?? 'slate', charColor)
}

function editDistance(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
    prev = cur
  }
  return prev[b.length]
}

function nearId<T extends { id: string }>(id: string, list: readonly T[]): T | undefined {
  let best: T | undefined
  let bestD = 3
  let tie = false
  for (const x of list) {
    const d = editDistance(id, x.id)
    if (d < bestD) [best, bestD, tie] = [x, d, false]
    else if (d === bestD) tie = true
  }
  return tie ? undefined : best
}

const looksLikeOurId = (id: unknown, prefix: 's' | 'ch') => {
  if (typeof id !== 'string' || !id.startsWith(`${prefix}_`)) return false
  const rest = id.slice(prefix.length + 1)
  return /^[\w-]{10}$/.test(rest) && !/^[a-z_]+$/.test(rest)
}

const fmtCenter = (p: { x: number; y: number }) => `(${p.x.toFixed(2)}, ${p.y.toFixed(2)})`
const validCenter = (v: unknown): v is { x: number; y: number } =>
  isObj(v) && typeof v.x === 'number' && typeof v.y === 'number' && v.x >= 0 && v.x <= 1 && v.y >= 0 && v.y <= 1

export function planReply(doc: Doc, raw: Record<string, unknown>, opts: AiOptions = {}): AiPlan {
  const changes: AiChange[] = []
  const skipped: string[] = []
  let n = 0
  const key = () => `k${n++}`
  const sections = new Map<string, { box: BoxRef; section: Section; owner: Character | null }>()
  const boxOf = (owner: Character | null, field: BoxField): BoxRef => (owner ? { kind: 'char', charId: owner.id, field } : { kind: 'base', field })
  for (const field of ['prompt', 'uc'] as const) for (const s of doc.base[field]) sections.set(s.id, { box: boxOf(null, field), section: s, owner: null })
  for (const c of doc.characters) for (const field of ['prompt', 'uc'] as const) for (const s of c[field]) sections.set(s.id, { box: boxOf(c, field), section: s, owner: c })
  const deletedChars = new Set<string>()
  let idsWritten = 0
  let idHits = 0

  const titleOf = (owner: Character | null, name: string) => (owner ? `${characterLabel(doc, owner)} › ${name}` : name)
  const groupOf = (owner: Character | null, field: BoxField): AiGroup => (owner ? 'char' : field)

  const seen = new Set<string>()
  // Missing boxes must stay untouched even in complete replies, so an omitted key cannot erase their contents.
  const complete = raw.complete === true
  const rawChars = Array.isArray(raw.characters) ? raw.characters.filter(isObj) : []
  const rawCharById = new Map<string, Record<string, unknown>>()
  for (const rc of rawChars) if (typeof rc.id === 'string' && !rawCharById.has(rc.id)) rawCharById.set(rc.id, rc)
  for (const rc of rawChars) if (rc.delete === true && typeof rc.id === 'string' && doc.characters.some((c) => c.id === rc.id)) deletedChars.add(rc.id)
  const omittedChars = complete && Array.isArray(raw.characters) ? doc.characters.filter((c) => !rawCharById.has(c.id)) : []
  for (const c of omittedChars) deletedChars.add(c.id)
  const handleBox = (raws: unknown, owner: Character | null, field: BoxField) => {
    if (!Array.isArray(raws)) return
    const own = owner ? owner[field] : doc.base[field]
    for (const p of raws) {
      if (!isObj(p)) continue
      if (looksLikeOurId(p.id, 's')) idsWritten++
      const hit = typeof p.id === 'string' ? sections.get(p.id) ?? sections.get(nearId(p.id, own)?.id ?? '') : undefined
      if (hit) idHits++
      if (hit && seen.has(hit.section.id)) continue
      if (hit) {
        seen.add(hit.section.id)
        if (hit.owner && deletedChars.has(hit.owner.id)) continue
        const { box, section: old, owner: o } = hit
        if (p.delete === true) {
          changes.push({ kind: 'deleteSection', key: key(), group: groupOf(o, box.field), title: titleOf(o, old.name), line: `${o ? `${characterLabel(doc, o)} › ` : ''}删除区块「${old.name}」`, defaultOn: true, box, section: old })
          continue
        }
        const next = patchSection(old, p, o?.color ?? null)
        if (next.chips === old.chips && next.name === old.name && next.muted === old.muted && next.color === old.color) continue
        const diff = diffSection(old, next)
        changes.push({
          kind: 'section',
          key: key(),
          group: groupOf(o, box.field),
          title: titleOf(o, old.name),
          line: `${titleOf(o, old.name)}：${diffParts(diff).join('，')}`,
          defaultOn: true,
          box,
          before: old,
          after: next,
          diff,
          counts: diffCounts(diff),
        })
        continue
      }
      if (p.delete === true) continue
      const sec = newSectionOf(p, owner?.color ?? null)
      if (!sec) continue
      const anchor = typeof p.after === 'string' ? (own.find((s) => s.id === p.after) ?? nearId(p.after, own) ?? null) : null
      changes.push({
        kind: 'newSection',
        key: key(),
        group: groupOf(owner, field),
        title: sec.name,
        line: `${owner ? `${characterLabel(doc, owner)} › ` : ''}新区块「${sec.name}」：${list(sec.chips)}`,
        defaultOn: true,
        box: boxOf(owner, field),
        section: sec,
        afterId: anchor?.id ?? null,
        afterName: anchor?.name ?? null,
      })
    }
  }

  handleBox(raw.prompt, null, 'prompt')
  handleBox(raw.uc, null, 'uc')

  let room = maxCharacters(doc.settings.model) - doc.characters.length
  const newColors: SectionColor[] = []
  for (const rc of rawChars) {
    if (looksLikeOurId(rc.id, 'ch')) idsWritten++
    const c = typeof rc.id === 'string' ? doc.characters.find((x) => x.id === rc.id) : undefined
    if (c) {
      idHits++
      if (deletedChars.has(c.id)) {
        changes.push({ kind: 'deleteChar', key: key(), group: 'char', title: characterLabel(doc, c), line: `删除角色「${characterLabel(doc, c)}」`, defaultOn: true, character: c })
        continue
      }
      const patch: Partial<Pick<Character, 'name' | 'gender' | 'genderExtra' | 'enabled' | 'center'>> = {}
      const parts: string[] = []
      if (typeof rc.name === 'string' && rc.name.trim() !== c.name.trim()) {
        patch.name = rc.name.trim()
        parts.push(`重命名「${characterLabel(doc, c)}」→「${patch.name || '（空）'}」`)
      }
      const g = GENDERS.includes(rc.gender as Gender) ? (rc.gender as Gender) : c.gender
      const next: GenderValue = { gender: g, genderExtra: 'genderExtra' in rc ? cleanGenderExtra(rc.genderExtra) : g === c.gender ? c.genderExtra : undefined }
      if (!sameGender(next, c)) {
        patch.gender = next.gender
        patch.genderExtra = next.genderExtra
        parts.push(`性别 ${genderLabel(c)} → ${genderLabel(next)}`)
      }
      if (typeof rc.enabled === 'boolean' && rc.enabled !== c.enabled) {
        patch.enabled = rc.enabled
        parts.push(rc.enabled ? '启用' : '停用')
      }
      if (rc.center !== undefined) {
        if (!validCenter(rc.center)) skipped.push(`${characterLabel(doc, c)} 的位置 ${JSON.stringify(rc.center)} 超出 0–1，未修改`)
        else if (rc.center.x !== c.center.x || rc.center.y !== c.center.y) {
          patch.center = { x: rc.center.x, y: rc.center.y }
          parts.push(`位置 ${fmtCenter(c.center)} → ${fmtCenter(patch.center)}`)
        }
      }
      if (parts.length) changes.push({ kind: 'char', key: key(), group: 'char', title: characterLabel(doc, c), line: `${characterLabel(doc, c)}：${parts.join('，')}`, defaultOn: true, charId: c.id, patch, parts })
      handleBox(rc.prompt, c, 'prompt')
      handleBox(rc.uc, c, 'uc')
      continue
    }
    if (rc.delete === true) continue
    const gender: Gender = GENDERS.includes(rc.gender as Gender) ? (rc.gender as Gender) : 'other'
    const genderExtra = cleanGenderExtra(rc.genderExtra)
    const color = nextCharColor([...doc.characters.map((x) => x.color), ...newColors])
    newColors.push(color)
    const secs = (v: unknown) => (Array.isArray(v) ? v.filter(isObj).map((p) => newSectionOf(p, color)).filter((s): s is Section => !!s) : [])
    const prompt = secs(rc.prompt)
    const uc = secs(rc.uc)
    const name = typeof rc.name === 'string' ? rc.name.trim() : ''
    if (!prompt.length && !uc.length && !name) continue
    if (room <= 0) {
      skipped.push(`角色数已达上限（${maxCharacters(doc.settings.model)}），未添加新角色「${name || '未命名'}」`)
      continue
    }
    room--
    const character: Character = {
      id: newId('ch'),
      name,
      gender,
      ...(genderExtra ? { genderExtra } : {}),
      color,
      prompt,
      uc,
      enabled: rc.enabled !== false,
      center: validCenter(rc.center) ? { x: rc.center.x, y: rc.center.y } : { x: 0.5, y: 0.5 },
    }
    const label = name || '未命名'
    changes.push({
      kind: 'newChar',
      key: key(),
      group: 'char',
      title: label,
      line: `新角色「${label}」（${genderLabel(character)}）：${[...prompt, ...uc].length} 个区块`,
      defaultOn: true,
      character,
    })
  }

  if (complete) {
    for (const c of omittedChars) changes.push({ kind: 'deleteChar', key: key(), group: 'char', title: characterLabel(doc, c), line: `删除角色「${characterLabel(doc, c)}」`, defaultOn: true, character: c })
    for (const { box, section: s, owner: o } of sections.values()) {
      if (seen.has(s.id) || (o && deletedChars.has(o.id))) continue
      const listed = o ? rawCharById.get(o.id)?.[box.field] : raw[box.field]
      if (!Array.isArray(listed)) continue
      changes.push({ kind: 'deleteSection', key: key(), group: groupOf(o, box.field), title: titleOf(o, s.name), line: `${o ? `${characterLabel(doc, o)} › ` : ''}删除区块「${s.name}」`, defaultOn: true, box, section: s })
    }
  }

  if (isObj(raw.settings)) planSettings(doc, raw.settings, changes, skipped, key, opts)
  if (idsWritten && !idHits) for (const c of changes) c.defaultOn = false
  const comment = typeof raw.comment === 'string' ? raw.comment.trim() : ''
  return { changes, skipped, ...(comment ? { comment } : {}) }
}

const ON_OFF = (v: boolean) => (v ? '开' : '关')

function planSettings(doc: Doc, s: Record<string, unknown>, changes: AiChange[], skipped: string[], key: () => string, opts: AiOptions) {
  const cur = doc.settings
  const push = (title: string, from: string, to: string, patch: Partial<Omit<DocSettings, 'gen'>>, gen: Partial<GenParams> = {}) =>
    changes.push({ kind: 'setting', key: key(), group: 'settings', title, line: `${title}：${from} → ${to}`, defaultOn: true, patch, gen, from, to })
  const pick = <T extends string>(k: keyof Omit<DocSettings, 'gen'>, title: string, options: readonly T[], label: (v: T) => string) => {
    if (s[k] === undefined) return
    const v = s[k] as T
    if (!options.includes(v)) return void skipped.push(`${title}「${String(s[k])}」不是 NAI 的可选值，未修改`)
    if (v !== cur[k]) push(title, label(cur[k] as T), label(v), { [k]: v } as Partial<Omit<DocSettings, 'gen'>>)
  }
  pick('model', '模型', MODELS, modelName)
  pick('effort', 'Effort', EFFORTS, (v) => (v === 'high' ? 'High' : 'Medium'))
  pick('mode', '模式', MODES, (v) => (v === 'anime' ? 'Anime' : 'Furry'))
  pick('qualityTags', '质量', QUALITIES, (v) => QUALITY_LABEL[v])
  pick('ucPreset', 'UC 预设', UC_PRESETS, (v) => UC_LABEL[v])
  for (const [k, title, label] of [
    ['transparent', '透明背景', ON_OFF],
    ['useCoords', '角色位置', (v: boolean) => (v ? 'Custom' : "AI's Choice")],
  ] as const) {
    if (s[k] === undefined) continue
    if (typeof s[k] !== 'boolean') skipped.push(`${title}「${String(s[k])}」不是 NAI 的可选值，未修改`)
    else if (s[k] !== cur[k]) push(title, label(cur[k]), label(s[k] as boolean), { [k]: s[k] } as Partial<Omit<DocSettings, 'gen'>>)
  }
  if (s.nsfw !== undefined) {
    const was = !!cur.nsfw
    if (typeof s.nsfw !== 'boolean') skipped.push(`NSFW「${String(s.nsfw)}」不是可选值，未修改`)
    else if (s.nsfw !== was && !opts.nsfw) skipped.push(`NSFW ${ON_OFF(was)} → ${ON_OFF(s.nsfw)}：设置中未开启「显示 NSFW 内容」，未修改`)
    else if (s.nsfw !== was) push('NSFW', ON_OFF(was), ON_OFF(s.nsfw), { nsfw: s.nsfw })
  }

  const g = cur.gen
  if (s.width !== undefined || s.height !== undefined) {
    const w = s.width ?? g.width
    const h = s.height ?? g.height
    const st = GEN_LIMITS.sizeStep
    const ok = Number.isInteger(w) && Number.isInteger(h) && (w as number) >= st && (h as number) >= st && (w as number) % st === 0 && (h as number) % st === 0 && (w as number) * (h as number) <= GEN_LIMITS.maxPixels
    if (!ok) skipped.push(`尺寸 ${String(w)} × ${String(h)} 不符合 NAI 要求（64 的倍数，宽 × 高不超过 ${GEN_LIMITS.maxPixels.toLocaleString('en')}），未修改`)
    else if (w !== g.width || h !== g.height) push('尺寸', `${g.width} × ${g.height}`, `${w} × ${h}`, {}, { width: w as number, height: h as number })
  }
  const num = (k: 'steps' | 'scale' | 'cfgRescale', title: string, lim: { min: number; max: number }, int = false) => {
    if (s[k] === undefined) return
    const v = s[k]
    if (typeof v !== 'number' || !Number.isFinite(v) || (int && !Number.isInteger(v)) || v < lim.min || v > lim.max)
      return void skipped.push(`${title} ${String(v)} 超出 NAI 的范围（${lim.min}–${lim.max}），未修改`)
    if (v !== g[k]) push(title, String(g[k]), String(v), {}, { [k]: v })
  }
  num('steps', '步数', GEN_LIMITS.steps, true)
  num('scale', '引导', GEN_LIMITS.scale)
  num('cfgRescale', 'Rescale', GEN_LIMITS.cfgRescale)
  if (s.sampler !== undefined) {
    const v = s.sampler
    if (typeof v !== 'string' || !SAMPLERS.includes(v)) skipped.push(`采样「${String(v)}」不是 NAI V5 的可选值，未修改`)
    else if (v !== g.sampler) push('采样', SAMPLER_NAMES[g.sampler] ?? g.sampler, SAMPLER_NAMES[v] ?? v, {}, { sampler: v })
  }
  if (s.seed !== undefined) {
    const v = s.seed
    if (v !== null && (typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v > GEN_LIMITS.seedMax)) skipped.push(`Seed ${String(v)} 超出 0–${GEN_LIMITS.seedMax}，未修改`)
    else if (v !== g.seed) push('Seed', g.seed === null ? '随机' : String(g.seed), v === null ? '随机' : String(v), {}, { seed: v as number | null })
  }
}

export const planTitle = (p: AiPlan) => (p.changes.length ? `AI 修改了 ${p.changes.length} 处` : 'AI 未修改任何内容')

export function applyPlan(doc: Doc, plan: AiPlan, picked: ReadonlySet<string>): Doc {
  const on = plan.changes.filter((c) => picked.has(c.key))
  if (!on.length) return doc
  return produce(doc, (d) => {
    const boxList = (b: BoxRef): Section[] | null => (b.kind === 'base' ? d.base[b.field] : (d.characters.find((c) => c.id === b.charId)?.[b.field] ?? null))
    for (const c of on)
      if (c.kind === 'section') {
        const l = boxList(c.box)
        const i = l?.findIndex((s) => s.id === c.before.id) ?? -1
        if (!l || i < 0) continue
        l[i].name = c.after.name
        l[i].muted = c.after.muted
        l[i].color = c.after.color
        if (c.after.ownColor) l[i].ownColor = true
        else delete l[i].ownColor
        l[i].chips = structuredClone(c.after.chips)
      }
    const lastAfter = new Map<string, string>()
    const have = new Set(allSections(d).map((s) => s.id))
    for (const c of on)
      if (c.kind === 'newSection') {
        const l = boxList(c.box)
        if (!l || have.has(c.section.id)) continue
        const anchor = c.afterId ? (lastAfter.get(c.afterId) ?? c.afterId) : null
        const i = anchor ? l.findIndex((s) => s.id === anchor) : -1
        const sec = structuredClone(c.section)
        if (i >= 0) l.splice(i + 1, 0, sec)
        else l.push(sec)
        if (c.afterId) lastAfter.set(c.afterId, c.section.id)
      }
    for (const c of on)
      if (c.kind === 'deleteSection') {
        const l = boxList(c.box)
        const i = l?.findIndex((s) => s.id === c.section.id) ?? -1
        if (l && i >= 0) l.splice(i, 1)
      }
    for (const c of on)
      if (c.kind === 'char') {
        const ch = d.characters.find((x) => x.id === c.charId)
        if (!ch) continue
        Object.assign(ch, structuredClone(c.patch))
        if ('genderExtra' in c.patch && !c.patch.genderExtra) delete ch.genderExtra
      }
    for (const c of on)
      if (c.kind === 'newChar' && d.characters.length < maxCharacters(d.settings.model) && !d.characters.some((x) => x.id === c.character.id)) d.characters.push(structuredClone(c.character))
    const gone = new Set(on.filter((c) => c.kind === 'deleteChar').map((c) => c.character.id))
    if (gone.size) d.characters = d.characters.filter((c) => !gone.has(c.id))
    for (const c of on) if (c.kind === 'setting' && c.patch.model) d.settings = switchModel(d.settings, c.patch.model)
    for (const c of on)
      if (c.kind === 'setting') {
        const { model: _, ...patch } = c.patch
        Object.assign(d.settings, patch)
        Object.assign(d.settings.gen, c.gen)
      }
  })
}

const charOf = (c: AiChange): string => {
  if (c.kind === 'char') return c.charId
  if (c.kind === 'newChar' || c.kind === 'deleteChar') return c.character.id
  if (c.kind === 'setting') return ''
  return c.box.kind === 'char' ? c.box.charId : ''
}

export function pickedSummary(plan: AiPlan, picked: ReadonlySet<string>): string {
  const on = plan.changes.filter((c) => picked.has(c.key))
  const n = (g: AiGroup) => on.filter((c) => c.group === g).length
  const chars = new Set(on.filter((c) => c.group === 'char').map(charOf))
  const out: string[] = []
  if (n('prompt')) out.push(`正面 ${n('prompt')} 个区块`)
  if (n('uc')) out.push(`负面 ${n('uc')} 个区块`)
  if (chars.size) out.push(`${chars.size} 个角色`)
  if (n('settings')) out.push(`参数 ${n('settings')} 项`)
  return out.join(' · ')
}
