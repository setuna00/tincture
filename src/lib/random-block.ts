import type { Chip, Gender, RandomRule, Section, SectionColor } from '@/types'
import {
  applyWeights,
  candidates,
  CHAR_MIN_OPTIONS,
  clampPop,
  cleanArtistsSource,
  contentOf,
  DEFAULT_ARTIST_SOURCE,
  drawChip,
  drawPool,
  fitDraws,
  genderPickKey,
  isLiveSource,
  normalizeCount,
  pickGender,
  rerollDraws,
  tagChip,
  type Draw,
  type DrawCtx,
  type GachaPool,
  type GenderPick,
  type PoolKind,
  type PoolSource,
} from './gacha'
import { cleanGenderDef, type GenderValue } from './gender'
import { newId, toChip } from './nai'

export interface RandomCtx extends DrawCtx {
  /** Live source sentinels differ: undefined means loading; null means the source no longer exists. */
  live(s: PoolSource): string[] | null | undefined
  workOf?(tag: string): string | null
  canonGender?(tag: string): Gender | null
  isChar?(tag: string): boolean
}

export function defaultRule(kind: PoolKind): RandomRule {
  if (kind === 'char') return { kind, source: [{ kind: 'chars', minCount: 0 }], sourceTags: [[]], count: [1, 1], popularity: 1, genders: ['canon'] }
  if (kind === 'artist') return { kind, source: [DEFAULT_ARTIST_SOURCE], sourceTags: [[]], count: [3, 3], popularity: 0, weight: 'main' }
  return { kind, source: [], sourceTags: [], count: [1, 1], popularity: 0.5 }
}

export const RANDOM_NAME: Record<PoolKind, string> = { char: '角色', artist: '画师', tag: '随机区块' }
export const RANDOM_COLOR: Record<PoolKind, SectionColor> = { char: 'fuchsia', artist: 'rose', tag: 'sky' }

export const hasScope = (r: RandomRule) => r.source.length > 0 || (r.picked?.length ?? 0) > 0

export const charWorksOf = (rule: Pick<RandomRule, 'source'>) => rule.source.flatMap((s) => (s.kind === 'work' ? [s.work] : []))

export function charWorksScope(works: readonly string[], tagsOf: (s: Extract<PoolSource, { kind: 'work' }>) => string[]): Pick<RandomRule, 'source' | 'sourceTags'> {
  if (!works.length) return { source: [{ kind: 'chars', minCount: 0 }], sourceTags: [[]] }
  const source = works.map((work) => ({ kind: 'work', work, minCount: 0 }) as const)
  return { source, sourceTags: source.map(tagsOf) }
}

export function poolOfRule(rule: RandomRule, live: RandomCtx['live']): GachaPool | null {
  const parts = rule.source.map((s, i) => (isLiveSource(s) ? live(s) : (rule.sourceTags?.[i] ?? [])))
  if (parts.some((p) => p === undefined)) return null
  const sourceTags = parts.map((p) => p ?? [])
  const picked = rule.picked ?? []
  return {
    id: 'random',
    name: '',
    color: 'slate',
    kind: rule.kind,
    target: 'prompt',
    source: rule.source,
    sourceTags,
    picked,
    tags: contentOf({ sourceTags, picked }),
    count: rule.count,
    popularity: rule.popularity,
    ...(rule.weight ? { weight: rule.weight } : {}),
    ...(rule.genders ? { genders: rule.genders } : {}),
  }
}

export function scopeOfPool(p: Pick<GachaPool, 'source' | 'sourceTags' | 'picked'>): Pick<RandomRule, 'source' | 'sourceTags' | 'picked'> {
  return { source: p.source, sourceTags: p.source.map((s, i) => (isLiveSource(s) ? [] : (p.sourceTags?.[i] ?? []))), picked: p.picked ?? [] }
}

export function scopeSize(rule: RandomRule, live: RandomCtx['live']): number | null {
  const pool = poolOfRule(rule, live)
  if (!pool) return null
  const off = new Set(rule.off ?? [])
  return off.size ? pool.tags.filter((t) => !off.has(t)).length : pool.tags.length
}

export interface Slot {
  tag: string
  chips: Chip[]
}

/** Random character results group each character tag with following work tags; other result kinds use one chip per draw. */
export function slotsOf(rule: Pick<RandomRule, 'kind'>, chips: readonly Chip[], isChar?: (t: string) => boolean): Slot[] {
  if (rule.kind !== 'char') return chips.map((c) => ({ tag: c.text, chips: [c] }))
  const out: Slot[] = []
  for (const c of chips) {
    if (!out.length || (isChar ? isChar(c.text) : false)) out.push({ tag: c.text, chips: [c] })
    else out[out.length - 1].chips.push(c)
  }
  return out
}

const isLocked = (rule: RandomRule, tag: string) => !!rule.lockAll || !!rule.locked?.includes(tag)

function drawsOf(rule: RandomRule, slots: readonly Slot[]): Draw[] {
  return slots.map((s) => ({ tag: s.tag, ...(isLocked(rule, s.tag) ? { locked: true } : {}), ...(rule.kind === 'artist' ? { w: s.chips[0]?.weight ?? 1 } : {}) }))
}

function newChips(kind: PoolKind, d: Draw, ctx: Pick<RandomCtx, 'workOf'>): Chip[] {
  if (kind === 'char') {
    const work = ctx.workOf?.(d.tag)
    return [d.tag, ...(work ? [work] : [])].map((t) => toChip(tagChip(t)))
  }
  return [toChip(drawChip({ kind }, d))]
}

export type RandomOp =
  | { kind: 'roll' }
  | { kind: 'reroll'; tags: readonly string[] }
  | { kind: 'fit' }
  | { kind: 'range' }
  | { kind: 'reweigh' }
  | { kind: 'regender' }

export interface RandomResult {
  chips: Chip[]
  locked?: string[]
  gender?: GenderValue
}

export function runRandom(rule: RandomRule, chips: readonly Chip[], op: RandomOp, ctx: RandomCtx): RandomResult | null {
  const pool = poolOfRule(rule, ctx.live)
  if (!pool) return null
  const slots = slotsOf(rule, chips, ctx.isChar)
  const prev = drawsOf(rule, slots)
  const exclude = rule.off ?? []
  const opts = { count: rule.count, popularity: rule.popularity, exclude, ctx }
  let next: Draw[]
  let keep: Set<string>
  if (rule.lockAll && op.kind !== 'reweigh') return { chips: [...chips] }
  if (op.kind === 'roll') {
    next = drawPool(pool, prev, opts)
    keep = new Set(prev.filter((d) => d.locked).map((d) => d.tag))
  } else if (op.kind === 'reroll') {
    next = rerollDraws(pool, prev, op.tags, opts)
    keep = new Set(prev.filter((d) => d.locked || !op.tags.includes(d.tag)).map((d) => d.tag))
  } else if (op.kind === 'fit' || op.kind === 'regender') {
    next = op.kind === 'fit' ? fitDraws(pool, prev, opts) : prev
    keep = new Set(prev.map((d) => d.tag))
  } else if (op.kind === 'reweigh') {
    next = applyWeights(pool, prev.map((d) => (d.locked ? d : { tag: d.tag })), ctx.rng)
    keep = new Set(prev.map((d) => d.tag))
  } else {
    if (!prev.length) {
      next = drawPool(pool, [], opts)
      keep = new Set()
    } else {
      const ok = new Set(candidates(pool, ctx, exclude))
      const bad = prev.filter((d) => !d.locked && !ok.has(d.tag)).map((d) => d.tag)
      const swapped = bad.length ? rerollDraws(pool, prev, bad, opts) : prev
      const stay = swapped.filter((d) => d.locked || ok.has(d.tag))
      next = fitDraws(pool, stay, opts)
      keep = new Set(prev.filter((d) => !bad.includes(d.tag)).map((d) => d.tag))
    }
  }
  const bySlot = new Map(slots.map((s) => [s.tag, s]))
  const out = next.flatMap((d) => {
    const s = bySlot.get(d.tag)
    if (!s || !keep.has(d.tag)) return newChips(rule.kind, d, ctx)
    const w = d.w ?? 1
    if (rule.kind === 'artist' && !d.locked && s.chips[0] && Math.abs(s.chips[0].weight - w) > 1e-9) return [{ ...s.chips[0], weight: w }, ...s.chips.slice(1)]
    return s.chips
  })
  const tags = new Set(next.map((d) => d.tag))
  const locked = rule.locked?.filter((t) => tags.has(t))
  const res: RandomResult = { chips: out, ...(rule.locked && locked && locked.length !== rule.locked.length ? { locked } : {}) }
  if (rule.kind === 'char') {
    const first = next[0]
    const changed = first && (op.kind === 'regender' ? !first.locked : first.tag !== prev[0]?.tag)
    if (changed) res.gender = pickGender(rule.genders, ctx.canonGender?.(first.tag) ?? null, ctx.rng)
  }
  return res
}

export function toggleLocked(rule: RandomRule, tags: readonly string[]): string[] {
  const cur = rule.locked ?? []
  const all = tags.every((t) => cur.includes(t))
  return all ? cur.filter((t) => !tags.includes(t)) : [...new Set([...cur, ...tags])]
}

export const charsSourceName = (s: Extract<PoolSource, { kind: 'chars' }>) => (s.minCount ? `角色库 ≥${s.minCount}` : '角色库全部')

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])
const KINDS: readonly string[] = ['tag', 'artist', 'char']

function cleanSource(s: unknown): PoolSource | null {
  if (!isObj(s)) return null
  const min = typeof s.minCount === 'number' ? s.minCount : undefined
  if (s.kind === 'list' && (s.list === 'a' || s.list === 'b' || s.list === 'c') && typeof s.path === 'string') return { kind: 'list', list: s.list, path: s.path, ...(min !== undefined ? { minCount: min } : {}) }
  if (s.kind === 'mylist' && typeof s.list === 'string' && typeof s.node === 'string') return { kind: 'mylist', list: s.list, node: s.node }
  if (s.kind === 'artists') return cleanArtistsSource(s)
  if (s.kind === 'artistColl' && typeof s.coll === 'string') return { kind: 'artistColl', coll: s.coll }
  if (s.kind === 'work' && typeof s.work === 'string') return { kind: 'work', work: s.work, ...(min !== undefined ? { minCount: min } : {}) }
  if (s.kind === 'chars') return { kind: 'chars', ...(min !== undefined ? { minCount: CHAR_MIN_OPTIONS.filter((o) => o <= min).pop() ?? 0 } : {}) }
  return null
}

export function cleanRandomRule(raw: unknown): RandomRule | undefined {
  if (!isObj(raw) || !KINDS.includes(String(raw.kind))) return undefined
  const kind = raw.kind as PoolKind
  const pairs: [PoolSource, string[]][] = []
  const rawSources = Array.isArray(raw.source) ? raw.source : []
  const rawTags = Array.isArray(raw.sourceTags) ? raw.sourceTags : []
  rawSources.forEach((s, i) => {
    const src = cleanSource(s)
    if (src) pairs.push([src, isLiveSource(src) ? [] : strs(rawTags[i])])
  })
  const rule: RandomRule = {
    kind,
    source: pairs.map((p) => p[0]),
    sourceTags: pairs.map((p) => p[1]),
    count: kind === 'char' ? [1, 1] : normalizeCount(raw.count, 1),
    popularity: typeof raw.popularity === 'number' && Number.isFinite(raw.popularity) ? clampPop(raw.popularity) : 0,
  }
  const picked = strs(raw.picked)
  if (picked.length && kind !== 'char') rule.picked = picked
  const off = strs(raw.off)
  if (off.length && kind !== 'char') rule.off = off
  const locked = strs(raw.locked)
  if (locked.length) rule.locked = locked
  if (raw.lockAll === true) rule.lockAll = true
  if (kind === 'artist') rule.weight = raw.weight === 'none' || raw.weight === 'rand' || raw.weight === 'main' ? raw.weight : 'main'
  if (kind === 'char') {
    const gs: GenderPick[] = []
    for (const g of Array.isArray(raw.genders) ? raw.genders : []) {
      const v: GenderPick | undefined = typeof g === 'string' ? (['canon', 'female', 'male', 'other'].includes(g) ? (g as GenderPick) : undefined) : cleanGenderDef(g)
      if (v && !gs.some((x) => genderPickKey(x) === genderPickKey(v))) gs.push(v)
    }
    rule.genders = gs.length ? gs : ['canon']
  }
  return rule
}

export function normalizeRandomSection(s: Section): Section {
  if (!('random' in s)) return s
  const random = cleanRandomRule(s.random)
  if (random) return { ...s, random }
  const { random: _, ...rest } = s
  return rest
}

export function newRandomSection(kind: PoolKind, color?: SectionColor): Section {
  return { id: newId('s'), name: RANDOM_NAME[kind], color: color ?? RANDOM_COLOR[kind], muted: false, chips: [], random: defaultRule(kind) }
}

