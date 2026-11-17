import type { CharacterTemplate } from '@/store/library'
import type { Character, Chip, Section, SectionColor } from '@/types'
import { defOfValue, sameGender, sameGenderExtra, takeGender, type GenderValue } from './gender'
import { newId, parsePrompt, toChip } from './nai'
import { sameChips } from './template-link'

type Content = Pick<Character, 'gender' | 'genderExtra' | 'prompt' | 'uc'>

export function sameSections(a: readonly Section[], b: readonly Section[]): boolean {
  return a.length === b.length && a.every((s, i) => s.id === b[i].id && !!s.muted === !!b[i].muted && sameChips(s.chips, b[i].chips))
}

export const sameCharacterContent = (a: Content, b: Content) =>
  a.gender === b.gender && sameGenderExtra(a.genderExtra, b.genderExtra) && sameSections(a.prompt, b.prompt) && sameSections(a.uc, b.uc)

function freshSections(list: readonly Section[]): Section[] {
  return list.map(({ textMode: _, ...s }) => ({ ...structuredClone(s), id: newId('s'), chips: s.chips.map((c) => ({ ...c, id: newId('c') })) }))
}

export function characterFromTemplate(t: CharacterTemplate): Character {
  const c: Character = {
    id: newId('ch'),
    name: t.name,
    gender: t.gender,
    ...(t.genderExtra ? { genderExtra: structuredClone(t.genderExtra) } : {}),
    color: t.color,
    prompt: freshSections(t.prompt),
    uc: freshSections(t.uc),
    enabled: true,
    center: { x: 0.5, y: 0.5 },
    templateId: t.id,
  }
  if (t.note) c.note = t.note
  if (t.work) c.work = t.work
  return c
}

export function templateFromCharacter(c: Character, name: string): Omit<CharacterTemplate, 'id' | 'createdAt'> {
  const strip = (list: readonly Section[]) => list.map(({ textMode: _, random: __, ...s }) => structuredClone(s))
  const t: Omit<CharacterTemplate, 'id' | 'createdAt'> = { name, gender: c.gender, color: c.color, prompt: strip(c.prompt), uc: strip(c.uc) }
  if (c.genderExtra) t.genderExtra = structuredClone(c.genderExtra)
  if (c.note) t.note = c.note
  if (c.work?.trim()) t.work = c.work.trim()
  return t
}

export interface NewCharacterInput {
  name: string
  gender: GenderValue
  positive: string
  negative: string
  color: SectionColor
  note?: string
  work?: string
  imageKey?: string
}

export function templateFromPrompt(input: NewCharacterInput): Omit<CharacterTemplate, 'id' | 'createdAt'> {
  const { color } = input
  const section = (name: string, chips: Chip[]): Section => ({ id: newId('s'), name, color, muted: false, chips })
  const pos = [section('外观', parsePrompt(input.positive).map(toChip))]
  const negChips = parsePrompt(input.negative).map(toChip)
  const def = defOfValue(input.gender)
  const taken = takeGender(pos, def ? [def] : [])
  const t: Omit<CharacterTemplate, 'id' | 'createdAt'> = {
    name: input.name.trim(),
    gender: input.gender.gender,
    color,
    prompt: sameGender(taken, input.gender) ? taken.sections : pos,
    uc: negChips.length ? [section('负面', negChips)] : [],
  }
  if (input.gender.genderExtra) t.genderExtra = structuredClone(input.gender.genderExtra)
  if (input.note?.trim()) t.note = input.note.trim()
  if (input.work?.trim()) t.work = input.work.trim()
  if (input.imageKey) t.imageKey = input.imageKey
  return t
}

export function characterTags(c: Pick<Character, 'prompt'>, isCharTag: (name: string) => boolean): string[] {
  const out: string[] = []
  for (const s of c.prompt) {
    if (s.muted) continue
    for (const x of s.chips) if (!x.disabled && x.weight > 0 && (x.type === 'tag' || x.type === 'interaction') && isCharTag(x.text) && !out.includes(x.text)) out.push(x.text)
  }
  return out
}

export interface WorkContext {
  isCharTag(name: string): boolean
  worksOf(tag: string): string[]
  workLabel(work: string): string
  npmi(a: string, b: string): number
  charLabel(tag: string): string
  canonical(name: string): string
}

export interface CharacterDisplay {
  name?: string
  nameFromTag: boolean
  work?: string
  workFromTag: boolean
}

export function characterDisplay(c: Pick<Character, 'name' | 'work' | 'prompt'>, ctx: WorkContext): CharacterDisplay {
  const tags: string[] = []
  for (const s of c.prompt) {
    if (s.muted) continue
    for (const x of s.chips) if (!x.disabled && x.weight > 0 && (x.type === 'tag' || x.type === 'interaction')) tags.push(ctx.canonical(x.text))
  }
  const tag = tags.find((t) => ctx.isCharTag(t))
  const name = c.name.trim()
  const work = c.work?.trim()
  let read: string | undefined
  if (!work && tag) {
    const ws = ctx.worksOf(tag)
    const w = ws.find((x) => tags.includes(x)) ?? ws[0]
    if (w) read = ctx.workLabel(w)
  }
  const random = c.prompt.some((s) => s.random?.kind === 'char')
  const label = tag ? ctx.charLabel(tag) : undefined
  return {
    name: name || (random ? (label ? `随机角色 · ${label}` : '随机角色') : label),
    nameFromTag: !name && (!!tag || random),
    work: work || read,
    workFromTag: !work && !!read,
  }
}

export function workSuggestions(c: Pick<Character, 'prompt'>, ctx: WorkContext): { label: string; work: string; from: string }[] {
  const out: { label: string; work: string; from: string }[] = []
  for (const tag of characterTags(c, ctx.isCharTag))
    for (const work of ctx.worksOf(tag)) if (!out.some((x) => x.work === work)) out.push({ label: ctx.workLabel(work), work, from: tag })
  return out
}

function workKeys(c: Pick<Character, 'prompt' | 'work'>, ctx: WorkContext): Set<string> {
  const keys = new Set<string>()
  if (c.work?.trim()) keys.add(c.work.trim().toLowerCase())
  for (const tag of characterTags(c, ctx.isCharTag))
    for (const w of ctx.worksOf(tag)) {
      keys.add(w.toLowerCase())
      keys.add(ctx.workLabel(w).toLowerCase())
    }
  return keys
}

export interface RelatedCharacter {
  template: CharacterTemplate
  why: 'work' | 'cooc'
  work?: string
}

export function relatedCharacters(c: Character, templates: readonly CharacterTemplate[], docChars: readonly Character[], ctx: WorkContext): RelatedCharacter[] {
  const seeds = characterTags(c, ctx.isCharTag)
  const mine = workKeys(c, ctx)
  if (!seeds.length && !mine.size) return []
  const linked = new Set(docChars.flatMap((x) => (x.templateId ? [x.templateId] : [])))
  const present = new Set(docChars.flatMap((x) => characterTags(x, ctx.isCharTag)))
  const work: RelatedCharacter[] = []
  const cooc: (RelatedCharacter & { score: number })[] = []
  for (const t of templates) {
    if (t.id === c.templateId || linked.has(t.id)) continue
    const tags = characterTags(t, ctx.isCharTag)
    if (tags.some((x) => present.has(x))) continue
    const keys = workKeys(t, ctx)
    if ([...keys].some((k) => mine.has(k))) {
      const fromTag = tags.flatMap((x) => ctx.worksOf(x)).find((w) => mine.has(w.toLowerCase()) || mine.has(ctx.workLabel(w).toLowerCase()))
      work.push({ template: t, why: 'work', work: t.work?.trim() || (fromTag ? ctx.workLabel(fromTag) : undefined) })
      continue
    }
    let score = 0
    for (const a of seeds) for (const b of tags) score = Math.max(score, ctx.npmi(a, b))
    if (score > 0) cooc.push({ template: t, why: 'cooc', score })
  }
  return [...work, ...cooc.sort((a, b) => b.score - a.score).map(({ score: _, ...r }) => r)]
}

export function knownWorks(templates: readonly Pick<CharacterTemplate, 'work'>[], docChars: readonly Pick<Character, 'work'>[]): string[] {
  const all = new Set<string>()
  for (const x of [...templates, ...docChars]) if (x.work?.trim()) all.add(x.work.trim())
  return [...all].sort((a, b) => a.localeCompare(b, 'zh'))
}
