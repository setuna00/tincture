// NovelAI metadata has no gender field; infer it from the leading girl/boy tag when importing.
import type { Chip, Gender, GenderExtra, Section } from '@/types'
import { GENDER_TAG } from '@/types'
import { parsePrompt } from './nai'

export const GENDER_LABEL: Record<Gender, string> = { female: '女', male: '男', other: '其他' }
export const GENDERS: Gender[] = ['female', 'male', 'other']

export interface GenderValue {
  gender: Gender
  genderExtra?: GenderExtra
}

export interface GenderDef {
  gender: Gender
  name: string
  tags: string[]
}

export interface GenderPreset extends GenderDef {
  id: string
}
export const GENDER_PRESETS: readonly GenderPreset[] = [
  { id: 'genderswap-mtf', gender: 'female', name: '女体化', tags: ['genderswap (mtf)'] },
  { id: 'reverse-trap', gender: 'female', name: '男装女子', tags: ['reverse trap'] },
  { id: 'futanari', gender: 'female', name: '扶她', tags: ['futanari'] },
  { id: 'genderswap-ftm', gender: 'male', name: '男体化', tags: ['genderswap (ftm)'] },
  { id: 'otoko-no-ko', gender: 'male', name: '伪娘', tags: ['otoko no ko'] },
  { id: 'cuntboy', gender: 'male', name: '有阴道的男性', tags: ['cuntboy'] },
  { id: 'ambiguous-gender', gender: 'other', name: '性别不明', tags: ['ambiguous gender'] },
]

export interface CustomGender extends GenderDef {
  id: string
}

export function genderTags(v: GenderValue): string[] {
  const base = GENDER_TAG[v.gender]
  return [...(base ? [base] : []), ...(v.genderExtra?.tags ?? [])]
}

export const genderLabel = (v: GenderValue) => v.genderExtra?.name || GENDER_LABEL[v.gender]

const sameTags = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((t, i) => t === b[i])
export const sameGenderExtra = (a?: GenderExtra, b?: GenderExtra) => (!a || !b ? !a === !b : a.name === b.name && sameTags(a.tags, b.tags))
export const sameGender = (a: GenderValue, b: GenderValue) => a.gender === b.gender && sameGenderExtra(a.genderExtra, b.genderExtra)

export const valueOfDef = (d: GenderDef): GenderValue => ({ gender: d.gender, genderExtra: { name: d.name, tags: [...d.tags] } })
export const defOfValue = (v: GenderValue): GenderDef | null => (v.genderExtra ? { gender: v.gender, name: v.genderExtra.name, tags: [...v.genderExtra.tags] } : null)

export function cleanTags(tags: unknown): string[] {
  if (!Array.isArray(tags)) return []
  const seen = new Set<string>()
  const out: string[] = []
  for (const t of tags) {
    if (typeof t !== 'string') continue
    const s = t.trim()
    if (!s || seen.has(s.toLowerCase())) continue
    seen.add(s.toLowerCase())
    out.push(s)
  }
  return out
}

export function cleanGenderExtra(x: unknown): GenderExtra | undefined {
  if (!x || typeof x !== 'object') return undefined
  const o = x as Record<string, unknown>
  const tags = cleanTags(o.tags)
  if (!tags.length) return undefined
  const name = typeof o.name === 'string' && o.name.trim() ? o.name.trim() : tags.join(', ')
  return { name, tags }
}

export function cleanGenderDef(x: unknown): GenderDef | undefined {
  const e = cleanGenderExtra(x)
  const g = (x as { gender?: unknown } | null)?.gender
  return e && GENDERS.includes(g as Gender) ? { gender: g as Gender, ...e } : undefined
}

export interface GenderSettings {
  moreGenders: boolean
  genderPresetsOff: readonly string[]
  customGenders: readonly CustomGender[]
}

export function genderOptions(s: GenderSettings, maxLevel: number, levelOf: (tag: string) => number): GenderDef[] {
  if (!s.moreGenders) return []
  const presets = GENDER_PRESETS.filter((p) => !s.genderPresetsOff.includes(p.id) && presetVisible(p, maxLevel, levelOf))
  return [...presets, ...s.customGenders.filter((c) => c.tags.length)].map(({ gender, name, tags }) => ({ gender, name: name.trim() || tags.join(', '), tags: [...tags] }))
}

export const defTags = (d: Pick<GenderDef, 'gender' | 'tags'>) => genderTags({ gender: d.gender, genderExtra: { name: '', tags: d.tags } }).join(', ')

export function menuDefs(options: readonly GenderDef[], current?: GenderValue): GenderDef[] {
  const cur = current && defOfValue(current)
  return cur && !options.some((d) => sameGender(valueOfDef(d), current)) ? [cur, ...options] : [...options]
}

export const presetVisible = (p: GenderDef, maxLevel: number, levelOf: (tag: string) => number) => Math.max(0, ...p.tags.map(levelOf)) <= maxLevel

export function genderOfChip(c: Pick<Chip, 'text' | 'type' | 'weight' | 'disabled'>): Gender | null {
  if (!plainTag(c)) return null
  const t = c.text.trim().toLowerCase()
  return t === GENDER_TAG.female ? 'female' : t === GENDER_TAG.male ? 'male' : null
}
const plainTag = (c: Pick<Chip, 'type' | 'weight' | 'disabled'>) => c.type === 'tag' && !c.disabled && Math.abs(c.weight - 1) <= 1e-9

function exported(sections: Section[]): { section: Section; chip: Chip }[] {
  const out: { section: Section; chip: Chip }[] = []
  for (const section of sections) {
    if (section.muted) continue
    for (const chip of section.chips) if (!chip.disabled && chip.text.trim() && chip.type !== 'textrender') out.push({ section, chip })
  }
  return out
}

/** Only consume unweighted leading gender tags, so reinserting them during export preserves the original prompt. */
export function takeGender(sections: Section[], defs: readonly GenderDef[] = []): GenderValue & { sections: Section[]; taken: string[] } {
  const list = exported(sections)
  const base = list.length ? genderOfChip(list[0].chip) : null
  const gender: Gender = base ?? 'other'
  const start = base ? 1 : 0
  const norm = (t: string) => t.trim().toLowerCase()
  let def: GenderDef | null = null
  for (const d of defs) {
    if (d.gender !== gender || !d.tags.length || (def && def.tags.length >= d.tags.length)) continue
    const run = list.slice(start, start + d.tags.length)
    if (run.length === d.tags.length && run.every((x, i) => plainTag(x.chip) && norm(x.chip.text) === norm(d.tags[i]))) def = d
  }
  const drop = list.slice(0, start + (def?.tags.length ?? 0))
  if (!drop.length) return { gender, sections, taken: [] }
  const chips = new Set(drop.map((x) => x.chip))
  return {
    gender,
    ...(def ? { genderExtra: { name: def.name, tags: [...def.tags] } } : {}),
    taken: drop.map((x) => x.chip.text.trim()),
    sections: sections.map((s) =>
      s.chips.some((c) => chips.has(c)) ? { ...s, chips: s.chips.filter((c) => !chips.has(c)), ...(s.templateId ? { templateEdited: true } : {}) } : s,
    ),
  }
}

export function genderValueOfPrompt(text: string, defs: readonly GenderDef[] = []): GenderValue {
  const chips: Chip[] = parsePrompt(text).map((p, i) => ({ ...p, id: `g${i}`, disabled: false }))
  const { gender, genderExtra } = takeGender([{ id: 'g', name: '', color: 'slate', muted: false, chips }], defs)
  return genderExtra ? { gender, genderExtra } : { gender }
}

export function genderOfPrompt(text: string): Gender {
  const first = parsePrompt(text).find((c) => c.type !== 'textrender')
  return (first && genderOfChip({ ...first, disabled: false })) || 'other'
}
