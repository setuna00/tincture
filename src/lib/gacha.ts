import { SECTION_COLORS, type Gender, type GenderExtra, type SectionColor } from '@/types'
import { cleanGenderDef, valueOfDef, type GenderDef, type GenderValue } from './gender'
import { exportString, newId, toChip, type ParsedChip } from './nai'
import { ARTIST_ALGO_LABEL, isPopAlgo, type ArtistAlgo, type PopAlgo } from './artist-rank'

export const POP_MIN = -1
export const POP_MAX = 1
export const POP_STEP = 0.25
export const clampPop = (v: number) => Math.round(Math.min(POP_MAX, Math.max(POP_MIN, v)) * 100) / 100
export const popOfPick = (pick: unknown): number => (pick === 'popular' ? 1 : 0)
/** v3 stores pick (flat/popular); v4 stores popularity (0/1). Preserve an existing popularity value. */
export function withPopularity(p: GachaPool & { pick?: unknown }): GachaPool {
  const { pick, ...rest } = p
  return { ...rest, popularity: typeof p.popularity === 'number' ? p.popularity : popOfPick(pick), ...(p.children ? { children: p.children.map(withPopularity) } : {}) }
}
export type ArtistWeight = 'none' | 'main' | 'rand'
export type PoolKind = 'tag' | 'artist' | 'char'
export type PoolTarget = 'prompt' | 'uc'
export type Count = [number, number]
export type GenderPick = 'canon' | Gender | GenderDef

export const genderPickKey = (g: GenderPick) => (typeof g === 'string' ? g : `x:${g.gender}:${g.name}:${g.tags.join(',')}`)

/** Missing by means post counts; popularity sources use top (0 = all, omitted = default), not minCount. */
export type PoolSource =
  | { kind: 'list'; list: 'a' | 'b' | 'c'; path: string; minCount?: number }
  | { kind: 'mylist'; list: string; node: string }
  | { kind: 'artists'; minCount?: number; by?: PopAlgo; top?: number }
  | { kind: 'artistColl'; coll: string }
  | { kind: 'work'; work: string; minCount?: number }
  | { kind: 'chars'; minCount?: number }

export const ARTIST_MIN_OPTIONS = [0, 100, 500, 1000] as const
export const ARTIST_TOP_OPTIONS = [0, 2000, 1000, 500] as const
export const DEFAULT_ARTIST_TOP = 1000
export const DEFAULT_ARTIST_SOURCE: PoolSource = { kind: 'artists', by: 'rep', top: DEFAULT_ARTIST_TOP }
type ArtistsSource = Extract<PoolSource, { kind: 'artists' }>
export const artistAlgoOf = (s: ArtistsSource): ArtistAlgo => s.by ?? 'count'
export const artistTopOf = (s: ArtistsSource) => s.top ?? DEFAULT_ARTIST_TOP
export const poolArtistAlgo = (source: readonly PoolSource[] = []): ArtistAlgo => {
  const s = source.find((x): x is ArtistsSource => x.kind === 'artists')
  return s ? artistAlgoOf(s) : 'count'
}
export const usesPopularity = (source: readonly PoolSource[] = []) => source.some((s) => s.kind === 'artists' && artistAlgoOf(s) !== 'count')
const snapMin = (n: number) => ARTIST_MIN_OPTIONS.filter((o) => o <= n).pop() ?? 0
const snapTop = (n: number) => (n <= 0 ? 0 : [...ARTIST_TOP_OPTIONS].filter((o) => o > 0).sort((a, b) => Math.abs(a - n) - Math.abs(b - n) || b - a)[0])
export function cleanArtistsSource(s: Record<string, unknown>): ArtistsSource {
  if (isPopAlgo(s.by)) return { kind: 'artists', by: s.by, ...(typeof s.top === 'number' ? { top: snapTop(s.top) } : {}) }
  return { kind: 'artists', ...(typeof s.minCount === 'number' ? { minCount: snapMin(s.minCount) } : {}) }
}
export function artistsSourceName(s: ArtistsSource): string {
  const algo = artistAlgoOf(s)
  if (algo === 'count') {
    const min = s.minCount ?? DEFAULT_MIN_COUNT
    return min ? `画师库 · 作品 ≥${min}` : '画师库全部'
  }
  const top = artistTopOf(s)
  return top ? `画师库 · ${ARTIST_ALGO_LABEL[algo]}前 ${top}` : '画师库全部'
}
export const popBasis = (p: Pick<GachaPool, 'kind' | 'source'>) => ARTIST_ALGO_LABEL[p.kind === 'artist' ? poolArtistAlgo(p.source) : 'count']

export const CHAR_MIN_OPTIONS = [0, 500, 1000, 5000] as const

export function charsAtLeast(names: readonly string[], entry: (t: string) => { count: number; old?: 1 | 2 } | undefined, min: number): string[] {
  const out: [string, number][] = []
  for (const t of names) {
    const e = entry(t)
    if (e && e.count >= min && e.old !== 2) out.push([t, e.count])
  }
  return out.sort((a, b) => b[1] - a[1]).map(([t]) => t)
}

export const isLiveSource = (s: PoolSource) => s.kind === 'artists' || s.kind === 'artistColl' || s.kind === 'chars'

export interface GachaPool {
  id: string
  name: string
  color: SectionColor
  kind: PoolKind
  target: PoolTarget
  tags: string[]
  source: PoolSource[]
  /** sourceTags aligns with sources; missing snapshots are hydrated, but live artist sources persist empty lists. */
  sourceTags?: string[][]
  picked?: string[]
  syncedAt?: number
  count: Count
  popularity: number
  weight?: ArtistWeight
  genders?: GenderPick[]
  children?: GachaPool[]
}

export interface GachaCollection {
  id: string
  name: string
  pools: GachaPool[]
  createdAt: number
}

export interface Draw {
  tag: string
  locked?: boolean
  w?: number
  gender?: Gender
  genderExtra?: GenderExtra
}

export const DEFAULT_MIN_COUNT = 1000

export type Rng = () => number
export interface DrawCtx {
  countOf(tag: string): number
  allowed(tag: string): boolean
  rng: Rng
}

export function rollCount([min, max]: Count, available: number, rng: Rng): number {
  const hi = Math.min(Math.max(min, max), available)
  const lo = Math.min(min, hi)
  return lo + Math.floor(rng() * (hi - lo + 1))
}

export function weightsOf(cands: readonly string[], popularity: number, ctx: Pick<DrawCtx, 'countOf'>): number[] {
  if (!popularity) return cands.map(() => 1)
  const counts = cands.map((t) => ctx.countOf(t))
  let floor = Infinity
  for (const c of counts) if (c > 0 && c < floor) floor = c
  if (floor === Infinity) return cands.map(() => 1)
  return counts.map((c) => Math.pow(c > 0 ? c : floor, popularity))
}

export function sample(cands: readonly string[], k: number, popularity: number, ctx: Omit<DrawCtx, 'allowed'>): string[] {
  const left = [...cands]
  const w = weightsOf(left, popularity, ctx)
  const out: string[] = []
  while (out.length < k && left.length) {
    const sum = w.reduce((a, b) => a + b, 0)
    let r = ctx.rng() * sum
    let i = 0
    for (; i < left.length - 1; i++) {
      r -= w[i]
      if (r < 0) break
    }
    out.push(left[i])
    left.splice(i, 1)
    w.splice(i, 1)
  }
  return out
}

export function candidates(pool: Pick<GachaPool, 'tags'>, ctx: Pick<DrawCtx, 'allowed'>, exclude: readonly string[], taken: readonly string[] = []): string[] {
  const no = new Set([...exclude, ...taken])
  return pool.tags.filter((t) => !no.has(t) && ctx.allowed(t))
}

export interface DrawOpts {
  count: Count
  popularity: number
  exclude: readonly string[]
  ctx: DrawCtx
}

export function drawPool(pool: GachaPool, prev: readonly Draw[], { count, popularity, exclude, ctx }: DrawOpts): Draw[] {
  const kept = prev.filter((d) => d.locked)
  const cands = candidates(pool, ctx, exclude, kept.map((d) => d.tag))
  const n = Math.max(kept.length, rollCount(count, kept.length + cands.length, ctx.rng))
  const order = new Map(pool.tags.map((t, i) => [t, i]))
  const fresh = sample(cands, n - kept.length, popularity, ctx)
    .sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0))
    .map((tag): Draw => ({ tag }))
  const out: Draw[] = []
  for (const d of prev) {
    if (d.locked) out.push(d)
    else if (fresh.length && out.length < n) out.push(fresh.shift()!)
  }
  out.push(...fresh)
  return applyWeights(pool, out, ctx.rng)
}

export function rerollDraws(pool: GachaPool, prev: readonly Draw[], tags: readonly string[], { popularity, exclude, ctx }: Omit<DrawOpts, 'count'>): Draw[] {
  const out = prev.map((d) => ({ ...d }))
  for (const d of out) {
    if (!tags.includes(d.tag) || d.locked) continue
    const [tag] = sample(candidates(pool, ctx, exclude, out.map((x) => x.tag)), 1, popularity, ctx)
    if (tag) {
      d.tag = tag
      delete d.w
    }
  }
  return applyWeights(pool, out, ctx.rng)
}

export function fitDraws(pool: GachaPool, prev: readonly Draw[], { count, popularity, exclude, ctx }: DrawOpts): Draw[] {
  const [min, max] = count
  if (prev.length > max) {
    const out = [...prev]
    for (let i = out.length - 1; i >= 0 && out.length > max; i--) if (!out[i].locked) out.splice(i, 1)
    return applyWeights(pool, out, ctx.rng)
  }
  if (prev.length >= min) return [...prev]
  const extra = sample(candidates(pool, ctx, exclude, prev.map((d) => d.tag)), min - prev.length, popularity, ctx).map((tag): Draw => ({ tag }))
  return applyWeights(pool, [...prev, ...extra], ctx.rng)
}

const roundW = (w: number) => Math.round(w * 20) / 20
export function applyWeights(pool: Pick<GachaPool, 'kind' | 'weight'>, draws: Draw[], rng: Rng): Draw[] {
  if (pool.kind !== 'artist') return draws.map(({ w: _, ...d }) => d)
  const mode = pool.weight ?? 'none'
  return draws.map((d, i) => {
    if (mode === 'main') return { ...d, w: i === 0 ? 1.15 : 0.9 }
    if (mode === 'rand') return { ...d, w: d.w ?? roundW(0.6 + rng() * 0.7) }
    const { w: _, ...rest } = d
    return rest
  })
}

export function drawText(pool: Pick<GachaPool, 'kind'>, d: Draw): string {
  if (pool.kind !== 'artist') return d.tag
  const w = d.w ?? 1
  return Math.abs(w - 1) < 1e-9 ? `artist:${d.tag}` : `${w}::artist:${d.tag}::`
}

/** Pool entries are literal tags; parsing prompt syntax would split bracketed names or misclassify them as sentences. */
export function drawChip(pool: Pick<GachaPool, 'kind'>, d: Pick<Draw, 'tag' | 'w'>): ParsedChip {
  return pool.kind === 'artist' ? { text: d.tag, type: 'artist', weight: d.w ?? 1 } : { text: d.tag, type: 'tag', weight: 1 }
}
export const tagChip = (text: string): ParsedChip => ({ text, type: 'tag', weight: 1 })

export function odds(pool: GachaPool, popularity: number, exclude: readonly string[], ctx: Omit<DrawCtx, 'rng'>): { tag: string; p: number }[] {
  const cands = candidates(pool, ctx, exclude)
  const w = weightsOf(cands, popularity, ctx)
  const sum = w.reduce((a, b) => a + b, 0) || 1
  return cands.map((tag, i) => ({ tag, p: w[i] / sum })).sort((a, b) => b.p - a.p)
}

export function pushCount([lo, hi]: Count, which: 0 | 1, v: number): Count {
  return which === 0 ? [v, Math.max(hi, v)] : [Math.min(lo, v), v]
}

export const isFixed = (pool: Pick<GachaPool, 'count' | 'tags'>) => pool.tags.length > 0 && pool.count[0] >= pool.tags.length

export function countLabel(pool: Pick<GachaPool, 'tags'>, count: Count): string {
  if (pool.tags.length > 0 && count[0] >= pool.tags.length) return '全部'
  return count[0] === count[1] ? String(count[0]) : `${count[0]}–${count[1]}`
}

export function diffTags(old: readonly string[], fresh: readonly string[]): { added: string[]; removed: string[] } {
  const a = new Set(old)
  const b = new Set(fresh)
  return { added: fresh.filter((t) => !a.has(t)), removed: old.filter((t) => !b.has(t)) }
}

export function contentOf(p: Pick<GachaPool, 'sourceTags' | 'picked'>): string[] {
  return [...new Set([...(p.sourceTags ?? []).flat(), ...(p.picked ?? [])])]
}

export function withContent<P extends GachaPool>(p: P, patch: Partial<Pick<GachaPool, 'source' | 'sourceTags' | 'picked'>> = {}): P {
  const next = { ...p, ...patch }
  return { ...next, tags: contentOf(next) }
}

export function addSources<P extends GachaPool>(p: P, add: { source: PoolSource; tags: string[] }[], same: (a: PoolSource, b: PoolSource) => boolean): P {
  const source = [...p.source]
  const sourceTags = [...(p.sourceTags ?? p.source.map(() => []))]
  for (const a of add) {
    if (source.some((s) => same(s, a.source))) continue
    source.push(a.source)
    sourceTags.push(a.tags)
  }
  return withContent(p, { source, sourceTags, syncedAt: Date.now() } as Partial<GachaPool>)
}

export function removeSource<P extends GachaPool>(p: P, i: number): P {
  return withContent(p, { source: p.source.filter((_, k) => k !== i), sourceTags: (p.sourceTags ?? []).filter((_, k) => k !== i) })
}

export function addPicked<P extends GachaPool>(p: P, tags: readonly string[]): { pool: P; added: string[]; inSource: string[]; dup: string[] } {
  const fromSources = new Set((p.sourceTags ?? []).flat())
  const picked = [...(p.picked ?? [])]
  const added: string[] = []
  const inSource: string[] = []
  const dup: string[] = []
  for (const t of tags) {
    if (fromSources.has(t)) inSource.push(t)
    else if (picked.includes(t)) dup.push(t)
    else {
      picked.push(t)
      added.push(t)
    }
  }
  return { pool: withContent(p, { picked }), added, inSource, dup }
}

export const removePicked = <P extends GachaPool>(p: P, tag: string): P => withContent(p, { picked: (p.picked ?? []).filter((t) => t !== tag) })

/** Nested result keys encode character-pool id, character tag, and child-pool id separated by '›'. */
export const CHILD_SEP = '›'
export const childKey = (charPoolId: string, charTag: string, childId: string) => `${charPoolId}${CHILD_SEP}${charTag}${CHILD_SEP}${childId}`
export function parseChildKey(key: string): { charPoolId: string; charTag: string; childId: string } | null {
  const parts = key.split(CHILD_SEP)
  return parts.length === 3 ? { charPoolId: parts[0], charTag: parts[1], childId: parts[2] } : null
}

export function pickGender(genders: readonly GenderPick[] | undefined, canon: Gender | null, rng: Rng): GenderValue {
  const list = genders?.length ? genders : (['canon'] as const)
  const g = list[Math.floor(rng() * list.length)] ?? 'canon'
  return g === 'canon' ? { gender: canon ?? 'other' } : typeof g === 'string' ? { gender: g } : valueOfDef(g)
}

export function countTags(genders: readonly Gender[]): string[] {
  const out: string[] = []
  const n = (g: Gender) => genders.filter((x) => x === g).length
  for (const [g, one, many] of [
    ['female', 'girl', 'girls'],
    ['male', 'boy', 'boys'],
    ['other', 'other', 'others'],
  ] as const) {
    const k = n(g)
    if (k) out.push(k === 1 ? `1${one}` : k >= 6 ? `6+${many}` : `${k}${many}`)
  }
  return out
}

export function resultLineOf(pools: readonly GachaPool[], results: Record<string, readonly Draw[]>, workOf: (p: GachaPool, tag: string) => string | null): string {
  const chipsIn: ParsedChip[] = []
  const chars = pools.filter((p) => p.kind === 'char')
  if (chars.length) chipsIn.push(...countTags(chars.flatMap((p) => (results[p.id] ?? []).map((d) => d.gender ?? 'other'))).map(tagChip))
  for (const p of pools)
    for (const d of results[p.id] ?? []) {
      if (p.kind !== 'char') chipsIn.push(drawChip(p, d))
      else {
        const w = workOf(p, d.tag)
        chipsIn.push(tagChip(d.tag), ...(w ? [tagChip(w)] : []))
      }
    }
  const seen = new Set<string>()
  const chips = chipsIn.map(toChip).filter((x) => {
    const k = `${x.type}:${x.text}`
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
  return exportString([{ id: '', name: '', color: 'slate', muted: false, chips }])
}

export function newPool(kind: PoolKind, target: PoolTarget, patch: Partial<GachaPool> = {}): GachaPool {
  const base: GachaPool = {
    id: newId('gp'),
    name: kind === 'artist' ? '画师' : kind === 'char' ? '角色' : '新池子',
    color: kind === 'artist' ? 'rose' : kind === 'char' ? 'fuchsia' : target === 'uc' ? 'slate' : 'sky',
    kind,
    target: kind === 'tag' ? target : 'prompt',
    tags: [],
    source: kind === 'artist' ? [DEFAULT_ARTIST_SOURCE] : [],
    sourceTags: kind === 'artist' ? [[]] : [],
    picked: [],
    count: [1, 1],
    popularity: 0,
    ...(kind === 'artist' ? { weight: 'main' as const } : {}),
    ...(kind === 'char' ? { genders: ['canon' as const], children: [] } : {}),
  }
  return withContent({ ...base, ...patch })
}

const freshPool = (p: GachaPool): GachaPool => ({ ...structuredClone(p), id: newId('gp'), ...(p.children ? { children: p.children.map(freshPool) } : {}) })

export function stripLive(p: GachaPool): GachaPool {
  const kids = p.children?.map(stripLive)
  if (!p.source.some(isLiveSource)) return kids && kids.some((k, i) => k !== p.children![i]) ? { ...p, children: kids } : p
  return withContent({ ...p, ...(kids ? { children: kids } : {}) }, { sourceTags: p.source.map((s, i) => (isLiveSource(s) ? [] : (p.sourceTags?.[i] ?? []))) })
}

export function cloneCollection(c: GachaCollection, name = c.name): GachaCollection {
  return { id: newId('gc'), name, createdAt: Date.now(), pools: c.pools.map(freshPool) }
}

export const GACHA_SCHEMA_ID = 'pe-gacha/1'

export interface GachaFilePool {
  name: string
  kind?: PoolKind
  target?: PoolTarget
  color?: SectionColor
  tags: string[]
  sources?: { source: PoolSource; tags?: string[] }[]
  count?: number | [number, number]
  popularity?: number
  pick?: 'flat' | 'popular'
  weight?: ArtistWeight
  genders?: GenderPick[]
  children?: GachaFilePool[]
  exclude?: string[]
}
export interface GachaFile {
  $schema: typeof GACHA_SCHEMA_ID
  name: string
  pools: GachaFilePool[]
}

export function toFile(c: GachaCollection, excludeOf: (poolId: string) => readonly string[]): GachaFile {
  const one = (p: GachaPool): GachaFilePool => {
    const f: GachaFilePool = { name: p.name, kind: p.kind, target: p.target, color: p.color, tags: [...(p.picked ?? [])], count: [...p.count] as [number, number], popularity: p.popularity }
    if (p.source.length) f.sources = p.source.map((source, i) => (source.kind === 'artists' ? { source: structuredClone(source) } : { source: structuredClone(source), tags: [...(p.sourceTags?.[i] ?? [])] }))
    if (p.kind === 'artist') f.weight = p.weight ?? 'none'
    if (p.kind === 'char') {
      f.genders = structuredClone(p.genders ?? ['canon'])
      f.children = (p.children ?? []).map(one)
    }
    const ex = excludeOf(p.id)
    if (ex.length) f.exclude = [...ex]
    return f
  }
  return { $schema: GACHA_SCHEMA_ID, name: c.name, pools: c.pools.map(one) }
}

const POOL_KEYS = new Set(['name', 'kind', 'target', 'color', 'tags', 'sources', 'source', 'count', 'popularity', 'pick', 'weight', 'genders', 'children', 'exclude'])
const FILE_KEYS = new Set(['$schema', 'name', 'pools'])
const GENDER_PICKS: readonly string[] = ['canon', 'female', 'male', 'other']
function readGenderPicks(v: unknown): GenderPick[] {
  const out: GenderPick[] = []
  for (const x of Array.isArray(v) ? v : []) {
    const g: GenderPick | undefined = typeof x === 'string' ? (GENDER_PICKS.includes(x.trim()) ? (x.trim() as GenderPick) : undefined) : cleanGenderDef(x)
    if (g && !out.some((o) => genderPickKey(o) === genderPickKey(g))) out.push(g)
  }
  return out
}
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').map((x) => x.trim()).filter(Boolean) : [])

export interface ImportResult {
  collection: GachaCollection
  excludes: Record<string, string[]>
  issues: string[]
}

/** Legacy files store all entries in tags; an unavailable artist collection must fall back to its exported names. */
export function fromFile(raw: unknown, known: (tag: string) => boolean, artistColl: (id: string) => boolean = () => false): ImportResult | { error: string } {
  if (!isObj(raw)) return { error: '不是 JSON 对象' }
  if (!Array.isArray(raw.pools) || !raw.pools.length) return { error: '缺少 pools（池子列表）' }
  const issues: string[] = []
  if (raw.$schema !== undefined && raw.$schema !== GACHA_SCHEMA_ID) issues.push(`$schema 为「${String(raw.$schema)}」，已按 ${GACHA_SCHEMA_ID} 读取`)
  const dropped = new Set(Object.keys(raw).filter((k) => !FILE_KEYS.has(k)))
  const excludes: Record<string, string[]> = {}
  const unknownTags: string[] = []

  const readPool = (rp: Record<string, unknown>, i: number, child: boolean): GachaPool => {
    for (const k of Object.keys(rp)) if (!POOL_KEYS.has(k)) dropped.add(k)
    const name = typeof rp.name === 'string' && rp.name.trim() ? rp.name.trim() : `池子 ${i + 1}`
    let kind: PoolKind = rp.kind === 'artist' || rp.kind === 'char' ? rp.kind : 'tag'
    if (rp.kind !== undefined && !['tag', 'artist', 'char'].includes(String(rp.kind))) issues.push(`「${name}」的类型 ${String(rp.kind)} 无法识别，已按普通池处理`)
    if (child && kind !== 'tag') {
      issues.push(`「${name}」为角色池的子池子，只能是普通池`)
      kind = 'tag'
    }
    const target: PoolTarget = kind === 'tag' && rp.target === 'uc' && !child ? 'uc' : 'prompt'
    const clean = (list: string[]) => [...new Set(list.map((t) => (kind === 'artist' ? t.replace(/^artist:/i, '').trim() : t)))]
    const picked = clean(strs(rp.tags))
    const sources: { source: PoolSource; tags: string[] }[] = []
    if (Array.isArray(rp.sources))
      for (const s of rp.sources) {
        const src = isObj(s) ? normalizeSources([s.source])[0] : undefined
        if (!src) continue
        const tags = clean(strs(isObj(s) ? s.tags : []))
        if (isLiveSource(src) && kind !== 'artist') issues.push(`「${name}」不是画师池，已移除画师库来源`)
        else if (src.kind === 'artistColl' && !artistColl(src.coll)) {
          for (const t of tags) if (!picked.includes(t)) picked.push(t)
          issues.push(`「${name}」的画师库合集在本机不存在，其中的 ${tags.length} 位已加入单独选择的画师`)
        } else sources.push({ source: src, tags: isLiveSource(src) ? [] : tags })
      }
    if (kind !== 'artist') for (const t of [...picked, ...sources.flatMap((s) => s.tags)]) if (!known(t) && !unknownTags.includes(t)) unknownTags.push(t)
    let popularity = 0
    if (typeof rp.popularity === 'number' && Number.isFinite(rp.popularity)) {
      popularity = clampPop(rp.popularity)
      if (popularity !== rp.popularity) issues.push(`「${name}」的抽法 ${rp.popularity} 已调整为 ${popularity}（−1 到 1，保留两位）`)
    } else if (rp.popularity !== undefined) issues.push(`「${name}」的抽法 ${String(rp.popularity)} 不是数字，已按 0（纯随机）处理`)
    else if (rp.pick === 'popular' || rp.pick === 'flat') popularity = popOfPick(rp.pick)
    else if (rp.pick !== undefined) issues.push(`「${name}」的抽法 ${String(rp.pick)} 无法识别，已按纯随机处理`)
    const color = typeof rp.color === 'string' && rp.color in SECTION_COLORS ? (rp.color as SectionColor) : undefined
    const size = new Set([...picked, ...sources.flatMap((s) => s.tags)]).size
    const pool = newPool(kind, target, {
      name,
      ...(color ? { color } : {}),
      popularity,
      count: normalizeCount(rp.count, size),
      source: sources.map((s) => s.source),
      sourceTags: sources.map((s) => s.tags),
      picked,
      syncedAt: Date.now(),
    })
    if (!pool.tags.length && !pool.source.some(isLiveSource)) issues.push(`「${name}」无内容，已创建空池子`)
    if (kind === 'artist') pool.weight = rp.weight === 'main' || rp.weight === 'rand' || rp.weight === 'none' ? rp.weight : 'none'
    if (kind === 'char') {
      const g = readGenderPicks(rp.genders)
      pool.genders = g.length ? g : ['canon']
      pool.children = Array.isArray(rp.children) ? rp.children.filter(isObj).map((c, k) => readPool(c, k, true)) : []
    }
    const ex = strs(rp.exclude)
    if (ex.length) excludes[pool.id] = ex
    return pool
  }

  const pools: GachaPool[] = []
  raw.pools.forEach((rp, i) => {
    if (!isObj(rp)) return issues.push(`第 ${i + 1} 个池子不是对象，已跳过`)
    pools.push(readPool(rp, i, false))
  })
  if (!pools.length) return { error: '没有可用的池子' }
  if (unknownTags.length) issues.push(`${unknownTags.length} 个 tag 不在 tag 库中：${unknownTags.slice(0, 4).join('、')}${unknownTags.length > 4 ? ' …' : ''}，已导入（chip 标记为未识别）`)
  dropped.delete('source')
  if (dropped.size) issues.push(`已忽略无法识别的字段：${[...dropped].join('、')}`)
  const name = typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : '导入的合集'
  return { collection: { id: newId('gc'), name, pools, createdAt: Date.now() }, excludes, issues }
}

export function normalizeCount(v: unknown, size: number): Count {
  if (typeof v === 'number' && Number.isFinite(v)) {
    const n = Math.max(0, Math.round(v))
    return [n, n]
  }
  if (Array.isArray(v) && v.length === 2 && v.every((x) => typeof x === 'number' && Number.isFinite(x))) {
    const [a, b] = (v as number[]).map((x) => Math.max(0, Math.round(x)))
    return [Math.min(a, b), Math.max(a, b)]
  }
  return size === 0 ? [1, 1] : [Math.min(1, size), Math.min(1, size)]
}

function normalizeSources(v: unknown): PoolSource[] {
  if (!Array.isArray(v)) return []
  const out: PoolSource[] = []
  for (const s of v) {
    if (!isObj(s)) continue
    const min = typeof s.minCount === 'number' ? { minCount: s.minCount } : {}
    if (s.kind === 'list' && (s.list === 'a' || s.list === 'b' || s.list === 'c') && typeof s.path === 'string') out.push({ kind: 'list', list: s.list, path: s.path, ...min })
    else if (s.kind === 'mylist' && typeof s.list === 'string' && typeof s.node === 'string') out.push({ kind: 'mylist', list: s.list, node: s.node })
    else if (s.kind === 'artists') out.push(cleanArtistsSource(s))
    else if (s.kind === 'artistColl' && typeof s.coll === 'string') out.push({ kind: 'artistColl', coll: s.coll })
    else if (s.kind === 'work' && typeof s.work === 'string') out.push({ kind: 'work', work: s.work, ...min })
    else if (s.kind === 'chars') out.push({ kind: 'chars', ...(typeof s.minCount === 'number' ? { minCount: CHAR_MIN_OPTIONS.filter((o) => o <= (s.minCount as number)).pop() ?? 0 } : {}) })
  }
  return out
}

const POOL_SCHEMA_PROPS = {
  name: { type: 'string', description: '池子名 = 导出后的区块名，例：地点、光、画师、质量；角色池挂着的池子就是角色框里的一块，例：衣服、表情' },
  target: { enum: ['prompt', 'uc'], default: 'prompt', description: 'prompt = 正面；uc = 负面（画师池、角色池只能正面）' },
  color: { enum: Object.keys(SECTION_COLORS), description: '区块颜色' },
  tags: {
    type: 'array',
    items: { type: 'string' },
    description: '池子里的 tag，Danbooru 写法（空格分隔，例：rooftop, blue sky）；画师池写画师名；角色池写 Danbooru 角色 tag（例：frieren、makima (chainsaw man)）',
  },
  count: {
    description: '抽几个，一定不放回：数字 = 固定这么多；[最少, 最多] = 每次在范围里随机。等于 tags 的个数 = 全部抽出（固定区块，例如质量、通用负面）',
    oneOf: [
      { type: 'integer', minimum: 0 },
      { type: 'array', items: { type: 'integer', minimum: 0 }, minItems: 2, maxItems: 2 },
    ],
  },
  popularity: {
    type: 'number',
    minimum: -1,
    maximum: 1,
    default: 0,
    description: '抽法：概率跟 Danbooru 作品数（画师池按来源的推荐算法：作品数或那种人气的分）的 popularity 次方成正比。0 = 每个一样（纯随机）；1 = 跟作品数成正比（热门的多）；负的偏冷门（-1 = 跟 1 / 作品数成正比）；0.5 介于中间',
  },
  exclude: { type: 'array', items: { type: 'string' }, description: '以后别抽的' },
  sources: {
    type: 'array',
    description:
      '从哪些来源加进来的（可以不写，AI 直接列 tags 就行）。画师池可以写 { "source": { "kind": "artists", "by": "rep", "top": 1000 } } = 画师库里代表作人气前 1000 的画师（by：rep 代表作人气 / hit 好评率 / total 总人气，top 0 = 全部），或 { "source": { "kind": "artists", "minCount": 1000 } } = 作品数 ≥1000 的全部画师（minCount 0 = 全部），不用列名字',
  },
} as const

export const GACHA_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: GACHA_SCHEMA_ID,
  title: 'Prompt 台 · 卡池合集',
  description: '一个合集 = 几个池子；抽一次，每个池子不放回地抽出几个，普通池 / 画师池导出成 NovelAI V5 prompt 里的一个区块，角色池抽到几个角色就导出几个角色框。',
  type: 'object',
  required: ['$schema', 'name', 'pools'],
  additionalProperties: false,
  properties: {
    $schema: { const: GACHA_SCHEMA_ID },
    name: { type: 'string', description: '合集名，例：雨夜屋顶' },
    pools: {
      type: 'array',
      minItems: 1,
      description: '从上往下抽',
      items: {
        type: 'object',
        required: ['name', 'tags'],
        additionalProperties: false,
        properties: {
          ...POOL_SCHEMA_PROPS,
          kind: {
            enum: ['tag', 'artist', 'char'],
            default: 'tag',
            description: 'tag = 普通池；artist = 画师池（tags 写画师名，导出成 artist:名字）；char = 角色池（tags 写角色 tag，抽到一个角色导出一个角色框）',
          },
          weight: { enum: ['none', 'main', 'rand'], default: 'none', description: '画师池：none 都不加；main 第 1 位 1.15、其余 0.9；rand 每位 0.6–1.3' },
          genders: {
            type: 'array',
            items: {
              anyOf: [
                { enum: ['canon', 'female', 'male', 'other'] },
                {
                  type: 'object',
                  required: ['gender', 'name', 'tags'],
                  additionalProperties: false,
                  properties: { gender: { enum: ['female', 'male', 'other'] }, name: { type: 'string' }, tags: { type: 'array', items: { type: 'string' }, minItems: 1 } },
                },
              ],
            },
            description: '角色池：性别在这几个里随机；canon = 角色本来的性别；对象 = 扩展性别（导出时 girl / boy 后面再加 tags，伪娘 = { gender: male, tags: [otoko no ko] }）',
          },
          children: {
            type: 'array',
            description: '角色池：挂在下面的普通池，每个抽到的角色各抽一次（例：衣服、表情）',
            items: { type: 'object', required: ['name', 'tags'], additionalProperties: false, properties: POOL_SCHEMA_PROPS },
          },
        },
      },
    },
  },
} as const
