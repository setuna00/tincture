import type { TagEntry } from '@/types'

export interface CoocTable {
  n: number
  names: string[]
  /** Neighbors are flat [row, NPMI x1000, ...] pairs sorted by descending NPMI, not nested tuples. */
  nb: number[][]
}

export interface Seed {
  name: string
  weight: number
}

export interface Recommendation {
  name: string
  score: number
  because: string
}

export interface RecommendOptions {
  negative?: boolean
  character?: boolean
  context?: string[]
  maxLevel?: number
  extra?: string[]
  fresh?: boolean
}

const FRESH_MIN_COUNT = 1000
const FRESH_MAX_COUNT = 200_000
const FRESH_PER_SLOT = 2
const FRESH_NEVER = new Set(['人数', '质量美学', '年份分级'])
const PICK_ONE: Record<string, string> = {
  人数: '人数', 性别: '性别', 年龄: '年龄', 体型: '体型', 肤色: '肤色',
  发长: '发长', 发色: '发色', 眼睛颜色: '眼睛颜色',
  取景: '取景', 视角: '视角', 时间: '时间', 室内室外: '室内室外',
  上衣: '上身', 连衣裙: '上身', 连体紧身: '上身', 泳装: '上身', 制服: '上身',
  裙: '下身', 裤: '下身', 外套: '外套', 鞋: '鞋', 袜: '袜',
}

const qualifierOf = (name: string) => name.match(/ \(([^()]+)\)$/)?.[1]

const MAX_PER_SLOT = 3
const MAX_PER_DOMAIN = 6
const MIN_REL = 0.1
const FALLBACK_MIN = 8
const LIST_EXTRA_MAX = 2
const LIST_EXTRA_AT = [3, 7]

const NEGATIVE_QUALITY = new Set(['lowres', 'jpeg artifacts', 'normal quality', 'bad quality', 'worst quality', 'displeasing', 'very displeasing', 'low complexity'])
export const isNegativeTag = (name: string, t?: TagEntry) => NEGATIVE_QUALITY.has(name) || t?.group === '瑕疵'
export const NOISE = new Set([
  'commentary request', 'translated', 'fur dataset', 'background dataset', 'location', 'depthness',
  'visual novel cg', 'visual novel sprite', 'visual novel art', 'visual novel bg', 'visual novel chibi', 'has alpha',
])
const NOISE_SLOTS = new Set(['站务', '签名水印', '梗与联动'])
export const isNoiseTag = (name: string, t?: TagEntry) => NOISE.has(name) || NOISE_SLOTS.has(t?.group ?? '')
const CONFLICT_PAIRS: [string, string][] = [
  ['day', 'night'],
  ['indoors', 'outdoors'],
  ['open mouth', 'closed mouth'],
  ['smile', 'frown'],
  ['sunset', 'night'],
  ['day', 'sunset'],
  ['day', 'full moon'],
  ['day', 'moon'],
  ['day', 'starry sky'],
  ['day', 'night sky'],
  ['from above', 'from below'],
  ['multiple girls', 'solo'],
  ['multiple boys', 'solo'],
]
const EXCLUSIVE_FAMILIES: ((name: string, t?: TagEntry) => string | null)[] = [
  (_, t) => (t?.group === '人数' ? 'count' : null),
  (n) => (/^(black|blonde|brown|white|grey|silver|red|pink|purple|blue|green|aqua|orange|multicolored) hair$/.test(n) ? 'hair-color' : null),
  (n) => (/^(very short|short|medium|long|very long|absurdly long) hair$/.test(n) ? 'hair-length' : null),
  (n) => (/^(black|brown|red|pink|purple|blue|green|aqua|yellow|orange|grey) eyes$/.test(n) ? 'eye-color' : null),
  (n) => (/^(low|medium|high|ultra) complexity$/.test(n) ? 'complexity' : null),
  (n) => (/^(aesthetic|very aesthetic|top aesthetic|displeasing|very displeasing)$/.test(n) ? 'aesthetic' : null),
  (n) => (/^(open|closed) mouth$/.test(n) ? 'mouth' : null),
]

export const LADDERS: string[][] = [
  ['top aesthetic', 'very aesthetic', 'aesthetic', 'displeasing', 'very displeasing'],
  ['masterpiece', 'best quality', 'amazing quality', 'great quality', 'good quality', 'normal quality', 'bad quality', 'worst quality'],
  ['ultra complexity', 'high complexity', 'medium complexity', 'low complexity'],
  ['incredibly absurdres', 'absurdres', 'highres', 'lowres'],
  ['absurdly long hair', 'very long hair', 'long hair', 'medium hair', 'short hair', 'very short hair'],
]

export function siblingsOf(name: string, tags: TagEntry[]): TagEntry[] {
  const { byName, byFamily } = familyIndex(tags)
  const ladder = LADDERS.find((l) => l.includes(name))
  if (ladder) return ladder.filter((n) => n !== name).flatMap((n) => byName.get(n) ?? [])
  const mine = familyOf(name, byName.get(name))
  if (!mine || mine === 'count') return []
  return (byFamily.get(mine) ?? []).filter((t) => t.name !== name)
}

const familyOf = (n: string, t?: TagEntry) => EXCLUSIVE_FAMILIES.map((f) => f(n, t)).find((x) => !!x) ?? null
const familyCache = new WeakMap<TagEntry[], { byName: Map<string, TagEntry>; byFamily: Map<string, TagEntry[]> }>()
function familyIndex(tags: TagEntry[]) {
  let hit = familyCache.get(tags)
  if (hit && hit.byName.size === tags.length) return hit
  const byName = new Map<string, TagEntry>()
  const byFamily = new Map<string, TagEntry[]>()
  for (const t of tags) {
    if (!byName.has(t.name)) byName.set(t.name, t)
    const f = familyOf(t.name, t)
    if (f) (byFamily.get(f) ?? byFamily.set(f, []).get(f)!).push(t)
  }
  for (const list of byFamily.values()) list.sort((a, b) => b.count - a.count)
  hit = { byName, byFamily }
  familyCache.set(tags, hit)
  return hit
}

export function conflictChecker(present: string[], lookup: (name: string) => TagEntry | undefined) {
  const fam = (n: string) => EXCLUSIVE_FAMILIES.map((f) => f(n, lookup(n))).filter((x): x is string => !!x)
  const taken = new Set(present.flatMap(fam))
  const pairs = new Set(CONFLICT_PAIRS.flatMap(([a, b]) => (present.includes(a) ? [b] : present.includes(b) ? [a] : [])))
  return (name: string) => pairs.has(name) || fam(name).some((f) => taken.has(f))
}

export function createRecommender(cooc: CoocTable, tags: TagEntry[]) {
  const index = new Map(cooc.names.map((n, i) => [n, i]))
  const byName = new Map(tags.map((t) => [t.name, t]))
  const idf = cooc.names.map((n) => Math.max(0.3, Math.log(cooc.n / Math.max(1, byName.get(n)?.count ?? 1))))
  const isNegative = (name: string) => isNegativeTag(name, byName.get(name))
  const families = (name: string) => EXCLUSIVE_FAMILIES.map((f) => f(name, byName.get(name))).filter((x): x is string => !!x)

  const isWork = (name: string) => {
    const c = byName.get(name)?.category
    return c === 'character' || c === 'copyright'
  }
  let franchiseCache: Set<string> | null = null
  function franchiseQualifiers() {
    if (franchiseCache) return franchiseCache
    const set = new Set<string>()
    for (const t of tags) {
      if (t.category !== 'character' && t.category !== 'copyright') continue
      const q = qualifierOf(t.name)
      if (q) set.add(q)
      if (t.category === 'copyright') set.add(t.name)
    }
    for (const q of [...set]) if (byName.get(q)?.category === 'general') set.delete(q)
    return (franchiseCache = set)
  }

  function fresh(seeds: Seed[], exclude: string[], limit: number, opts: RecommendOptions): Recommendation[] {
    const common = recommend(seeds, exclude, 30, { ...opts, fresh: false, extra: undefined })
    const ex = new Set([...exclude, ...common.map((r) => r.name)])
    const seedNames = seeds.map((s) => s.name)
    const seedTags = seedNames.map((n) => byName.get(n)).filter((t): t is TagEntry => !!t)
    const domains = new Set(seedTags.map((t) => t.domain).filter((d): d is string => !!d))
    const present = [...seedNames, ...(opts.context ?? [])]
    const takenGroups = new Set(present.map((n) => PICK_ONE[byName.get(n)?.group ?? '']).filter(Boolean))
    const allowed = gate(seeds, ex, opts)

    const hubs = [
      ...seeds.map((s) => ({ name: s.name, w: s.weight })),
      ...common.map((r, i) => ({ name: r.name, w: 1 - i / common.length })).filter((h) => !isWork(h.name)),
    ]
    const franchise = franchiseQualifiers()
    const acc = new Map<string, { score: number; best: number; because: string }>()
    for (const h of hubs) {
      const s = index.get(h.name)
      if (s === undefined) continue
      const list = cooc.nb[s]
      for (let k = 0; k < list.length; k += 2) {
        const name = cooc.names[list[k]]
        const contrib = h.w * (list[k + 1] / 1000)
        const cur = acc.get(name)
        if (cur) {
          cur.score += contrib
          if (contrib > cur.best) Object.assign(cur, { best: contrib, because: h.name })
        } else acc.set(name, { score: contrib, best: contrib, because: h.name })
      }
    }
    const scored: { name: string; score: number; because: string }[] = []
    for (const [name, v] of acc) {
      const t = byName.get(name)
      if (!t || t.count < FRESH_MIN_COUNT || t.count > FRESH_MAX_COUNT || isWork(name) || franchise.has(qualifierOf(name) ?? '')) continue
      const slot = t.group ?? ''
      if (FRESH_NEVER.has(slot) || takenGroups.has(PICK_ONE[slot]) || !allowed(name)) continue
      const theme = !domains.size || domains.has(t.domain ?? '') ? 1 : 0.3
      scored.push({ name, score: v.score * theme * Math.log(cooc.n / t.count), because: v.because })
    }
    scored.sort((a, b) => b.score - a.score)
    const top = scored[0]?.score ?? 0

    const perSlot = new Map<string, number>()
    const taken = new Set<string>()
    const out: Recommendation[] = []
    for (const r of scored) {
      if (out.length >= limit || r.score < top * MIN_REL) break
      const slot = byName.get(r.name)?.group ?? ''
      const group = PICK_ONE[slot]
      const fam = families(r.name)
      if (fam.some((f) => taken.has(f)) || (group && taken.has(group))) continue
      if (slot && (perSlot.get(slot) ?? 0) >= FRESH_PER_SLOT) continue
      for (const f of fam) taken.add(f)
      if (group) taken.add(group)
      perSlot.set(slot, (perSlot.get(slot) ?? 0) + 1)
      out.push({ name: r.name, score: Math.round(r.score * 1000) / 1000, because: r.because })
    }
    return out
  }

  function gate(seeds: Seed[], ex: Set<string>, opts: RecommendOptions) {
    const seedNames = seeds.map((s) => s.name)
    const seedTags = seedNames.map((n) => byName.get(n)).filter((t): t is TagEntry => !!t)
    const groups = new Set(seedTags.map((t) => t.group).filter((g): g is string => !!g))
    const cats = new Set(seedTags.map((t) => t.category))
    const present = [...seedNames, ...(opts.context ?? [])]
    const takenFamilies = new Set(present.flatMap(families))
    const conflicts = new Set(CONFLICT_PAIRS.flatMap(([a, b]) => (present.includes(a) ? [b] : present.includes(b) ? [a] : [])))
    const hasCharacter = opts.character || cats.has('character') || present.some((n) => byName.get(n)?.category === 'character')
    return (name: string) => {
      if (ex.has(name) || conflicts.has(name)) return false
      const t = byName.get(name)
      if (!t || isNoiseTag(name, t) || t.old) return false
      if ((t.level ?? 0) > (opts.maxLevel ?? 3)) return false
      if (!opts.negative && isNegative(name)) return false
      if (opts.negative && !isNegative(name) && (t.category === 'meta' || !groups.has(t.group ?? ''))) return false
      if (hasCharacter && t.category === 'character') return false
      if (t.category === 'artist' && !cats.has('artist')) return false
      return !families(name).some((f) => takenFamilies.has(f))
    }
  }

  return recommend

  function recommend(seeds: Seed[], exclude: Iterable<string>, limit = 24, opts: RecommendOptions = {}): Recommendation[] {
    if (opts.fresh) return fresh(seeds, [...exclude], limit, opts)
    const ex = new Set(exclude)
    const seedNames = seeds.map((s) => s.name)
    const seedTags = seedNames.map((n) => byName.get(n)).filter((t): t is TagEntry => !!t)
    const groups = new Set(seedTags.map((t) => t.group).filter((g): g is string => !!g))
    const domains = new Set(seedTags.map((t) => t.domain).filter((d): d is string => !!d))
    const cats = new Set(seedTags.map((t) => t.category))
    const present = [...seedNames, ...(opts.context ?? [])]
    const takenFamilies = new Set(present.flatMap(families))
    const allowed = gate(seeds, ex, opts)
    const affinity = (name: string) => {
      const t = byName.get(name)!
      if (opts.negative && isNegative(name)) return 1
      return groups.has(t.group ?? '') || domains.has(t.domain ?? '') ? 1 : cats.has(t.category) ? 0.55 : 0.3
    }

    const acc = new Map<string, { score: number; best: number; because: string }>()
    for (const seed of seeds) {
      const s = index.get(seed.name)
      if (s === undefined) continue
      const list = cooc.nb[s]
      for (let k = 0; k < list.length; k += 2) {
        const name = cooc.names[list[k]]
        const npmi = list[k + 1]
        if (!allowed(name)) continue
        const contrib = seed.weight * idf[s] * (npmi / 1000)
        const cur = acc.get(name) ?? { score: 0, best: 0, because: seed.name }
        cur.score += contrib
        if (contrib > cur.best) {
          cur.best = contrib
          cur.because = seed.name
        }
        acc.set(name, cur)
      }
    }
    const scored = [...acc].map(([name, v]) => ({ name, score: v.score * affinity(name), because: v.because })).sort((a, b) => b.score - a.score)
    const top = scored[0]?.score ?? 0

    const perSlot = new Map<string, number>()
    const perDomain = new Map<string, number>()
    const picked = new Set<string>()
    const out: Recommendation[] = []
    const push = (name: string, score: number, because: string, fallback = false) => {
      const slot = byName.get(name)?.group ?? ''
      const domain = byName.get(name)?.domain ?? ''
      const n = perSlot.get(slot) ?? 0
      const d = perDomain.get(domain) ?? 0
      if ((slot && !fallback && n >= MAX_PER_SLOT) || (domain && d >= MAX_PER_DOMAIN) || picked.has(name)) return
      for (const f of families(name)) takenFamilies.add(f)
      perSlot.set(slot, n + 1)
      perDomain.set(domain, d + 1)
      picked.add(name)
      out.push({ name, score: Math.round(score * 1000) / 1000, because })
    }
    for (const r of scored) {
      if (out.length >= limit || r.score < top * MIN_REL) break
      if (families(r.name).some((f) => takenFamilies.has(f))) continue
      push(r.name, r.score, r.because)
    }

    const uncovered = new Set(seedTags.filter((t) => !index.has(t.name) && t.group).map((t) => t.group!))
    const fallback = out.length < FALLBACK_MIN ? groups : uncovered
    if (out.length < limit && fallback.size) {
      const pool = tags
        .filter((t) => fallback.has(t.group ?? '') && !picked.has(t.name) && allowed(t.name) && !families(t.name).some((f) => takenFamilies.has(f)))
        .sort((a, b) => b.count - a.count)
      for (const t of pool) {
        if (out.length >= limit) break
        if (families(t.name).some((f) => takenFamilies.has(f))) continue
        push(t.name, 0, `同组：${t.group}`, true)
      }
    }

    if (opts.extra?.length && seeds.length) {
      const seed = seeds[0].name
      const s = index.get(seed)
      const npmiTo = new Map<string, number>()
      if (s !== undefined) for (let k = 0; k < cooc.nb[s].length; k += 2) npmiTo.set(cooc.names[cooc.nb[s][k]], cooc.nb[s][k + 1])
      const extra = [...new Set(opts.extra)]
        .filter((n) => n !== seed && !picked.has(n) && allowed(n) && !families(n).some((f) => takenFamilies.has(f)))
        .sort((a, b) => (npmiTo.get(b) ?? 0) - (npmiTo.get(a) ?? 0) || (byName.get(b)?.count ?? 0) - (byName.get(a)?.count ?? 0))
      const taken: string[] = []
      for (const n of extra) {
        if (taken.length >= LIST_EXTRA_MAX) break
        if (families(n).some((f) => takenFamilies.has(f))) continue
        for (const f of families(n)) takenFamilies.add(f)
        taken.push(n)
      }
      taken.forEach((n, i) => out.splice(Math.min(LIST_EXTRA_AT[i], out.length), 0, { name: n, score: 0, because: seed }))
      if (out.length > limit) out.length = limit
    }
    return out
  }
}
