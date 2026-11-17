import type { ArtistWeight, Count, GenderPick, PoolKind, PoolSource } from '@/lib/gacha'

/** textrender uses NAI's Text: syntax for text drawn inside the image. */
export type ChipType = 'tag' | 'artist' | 'meta' | 'year' | 'text' | 'interaction' | 'textrender'
export type Interaction = 'source' | 'target' | 'mutual'

export interface Chip {
  id: string
  /** Store text without type prefixes; Text: content may contain commas and newlines. */
  text: string
  type: ChipType
  /** V4.5+ accepts negative weights. */
  weight: number
  disabled: boolean
  interaction?: Interaction
}

export interface Section {
  id: string
  name: string
  color: SectionColor
  ownColor?: boolean
  muted: boolean
  textMode?: boolean
  note?: string
  templateId?: string
  templateEdited?: boolean
  chips: Chip[]
  random?: RandomRule
}

/** sourceTags parallels source; artist and character sources use empty snapshots because their tags are resolved when opened. */
export interface RandomRule {
  kind: PoolKind
  source: PoolSource[]
  sourceTags?: string[][]
  picked?: string[]
  off?: string[]
  count: Count
  popularity: number
  weight?: ArtistWeight
  genders?: GenderPick[]
  locked?: string[]
  lockAll?: boolean
}

/** NAI prepends girl/boy to character positives but stores no gender field; import infers gender from that leading tag. */
export type Gender = 'female' | 'male' | 'other'
export const GENDER_TAG: Record<Gender, string | null> = { female: 'girl', male: 'boy', other: null }

export interface GenderExtra {
  name: string
  tags: string[]
}

export interface Character {
  id: string
  name: string
  gender: Gender
  genderExtra?: GenderExtra
  color: SectionColor
  note?: string
  work?: string
  templateId?: string
  templateEdited?: boolean
  prompt: Section[]
  uc: Section[]
  enabled: boolean
  /** NAI centers[0] uses normalized 0-1 coordinates with y increasing downward; only Custom positioning sends them. */
  center: { x: number; y: number }
}

export type UcPreset = 'heavy' | 'light' | 'furry-focus' | 'human-focus' | 'none'
export type ModelId = 'v5-curated' | 'v5-full' | 'v45-curated' | 'v45-full' | 'v4-curated' | 'v4-full'
export type QualityPreset = 'standard' | 'light' | 'none'
/** V5 always sends karras; only V4.x exposes the other noise schedules. */
export type NoiseSchedule = 'native' | 'karras' | 'exponential' | 'polyexponential'
/** NAI furry mode prepends "fur dataset, " to the positive prompt. */
export type ModelMode = 'anime' | 'furry'
/** V5 Full medium effort uses the separate API model ID nai-diffusion-5-full-medium. */
export type Effort = 'high' | 'medium'
export interface GenParams {
  width: number
  height: number
  steps: number
  scale: number
  cfgRescale: number
  sampler: string
  /** null requests a random seed. */
  seed: number | null
  /** NAI clamps n_samples by image size; per-image metadata still records one sample. */
  nSamples?: number
  noiseSchedule?: NoiseSchedule
  /** V4.x Variety+ sends the model sigma threshold scaled by resolution as skip_cfg_above_sigma. */
  varietyPlus?: boolean
  /** Only V4 supports NAI legacy_uc. */
  legacyUc?: boolean
  strength?: number
  noise?: number
  /** NAI defaults normalization on: if absolute Vibe strengths sum above one, scale them proportionally to sum to one. */
  normalizeRefs?: boolean
}

/** NAI image metadata omits reference pixels; persist them separately by SHA-256. */
export interface RefImage {
  image: string
  width: number
  height: number
}

export interface VibeRef extends RefImage {
  informationExtracted: number
  strength: number
  enabled: boolean
  /** Encoding-only .naiv4vibe entries are bound to one model and information level; image is the encoding hash, with at most a thumbnail stored. */
  encodedFor?: ModelId
}

export type CharacterRefType = 'character&style' | 'character' | 'style'

export interface CharacterRef extends RefImage {
  description: CharacterRefType
  strength: number
  fidelity: number
  enabled: boolean
}

export type ModelParams = Pick<DocSettings, 'qualityTags' | 'ucPreset' | 'transparent' | 'useCoords' | 'gen'>

export interface DocSettings {
  qualityTags: QualityPreset
  ucPreset: UcPreset
  model: ModelId
  mode: ModelMode
  effort: Effort
  transparent: boolean
  useCoords: boolean
  gen: GenParams
  /** NAI adds nsfw to the negative prompt when it is absent from the positive prompt; enabling this prepends it to the positive prompt. */
  nsfw?: boolean
  perModel?: Partial<Record<ModelId, ModelParams>>
  baseImage?: RefImage
  /** Only V4/V4.5 support Vibe; retain original pixels so model-specific encodings can be regenerated after switching models. */
  vibes?: VibeRef[]
  /** Only V4.5 supports CharacterReferences; NAI omits Vibe when these are present. */
  characterRefs?: CharacterRef[]
}

export interface Doc {
  base: { prompt: Section[]; uc: Section[] }
  characters: Character[]
  settings: DocSettings
  meta: DocMeta
}

export interface ForkedFrom {
  docId: string
  version?: number
  title?: string
}

export interface DocMeta {
  title: string
  /** Migrated open tabs use their tab ID as docId so existing image history remains attached. */
  docId?: string
  forkedFrom?: ForkedFrom
  createdAt: number
}

/** NAI frontend maxCharacters is 32 for V5 and 6 for V4.x. */
export const MAX_CHARACTERS = 32

export type BoxField = 'prompt' | 'uc'
export type BoxRef = { kind: 'base'; field: BoxField } | { kind: 'char'; charId: string; field: BoxField }

export const SECTION_COLORS = {
  slate: { h: 275, c: 0.02, label: '灰' },
  rose: { h: 12, c: 0.13, label: '红' },
  orange: { h: 45, c: 0.13, label: '橙' },
  amber: { h: 75, c: 0.13, label: '琥珀' },
  lime: { h: 125, c: 0.13, label: '青柠' },
  green: { h: 152, c: 0.12, label: '绿' },
  teal: { h: 185, c: 0.11, label: '青' },
  sky: { h: 235, c: 0.12, label: '蓝' },
  indigo: { h: 268, c: 0.12, label: '靛' },
  violet: { h: 295, c: 0.13, label: '紫' },
  fuchsia: { h: 322, c: 0.13, label: '品红' },
  pink: { h: 350, c: 0.13, label: '粉' },
} as const
export type SectionColor = keyof typeof SECTION_COLORS

/** Danbooru category codes: 0 general, 1 artist, 3 copyright, 4 character, 5 meta. */
export type TagCategory = 'general' | 'artist' | 'copyright' | 'character' | 'meta'

/** Rating codes: 0 all ages, 1 suggestive, 2 explicit, 3 extreme content. */
export type NsfwLevel = 0 | 1 | 2 | 3

export interface TagEntry {
  name: string
  zh: string
  category: TagCategory
  count: number
  group?: string
  domain?: string
  level?: NsfwLevel
  nai?: boolean
  /** Legacy tag codes: 1 deprecated, 2 renamed; renamed entries inherit the current tag's count, translation and group. */
  old?: 1 | 2
}

export interface SearchEntry extends TagEntry {
  aliases: string[]
  zhAlt: string[]
  py: string
  pyi: string
}

export type ChipCategory = TagCategory | 'text'
