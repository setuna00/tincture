import { toast } from 'sonner'
import { listTree } from '@/components/discover/data'
import { allChars, canonGender, charsOfWork, charWorksReady, worksOf } from '@/lib/char-works'
import { findNode, nodeAtoms, type Catalog } from '@/lib/discover'
import { artistCount as artistPosts, artistScore, artistsAtLeast, artistsTopBy, isNsfwOnlyArtist, useArtistData } from '@/lib/artist-db'
import {
  artistAlgoOf,
  artistsSourceName,
  artistTopOf,
  charsAtLeast,
  childKey,
  countTags,
  DEFAULT_MIN_COUNT,
  drawChip,
  drawPool,
  fitDraws,
  isLiveSource,
  parseChildKey,
  poolArtistAlgo,
  pickGender,
  rerollDraws,
  resultLineOf,
  tagChip,
  withContent,
  type ArtistWeight,
  type Count,
  type Draw,
  type DrawCtx,
  type GachaCollection,
  type GachaPool,
  type GenderPick,
  type PoolSource,
} from '@/lib/gacha'
import { allTags, findListNode, type UserList } from '@/lib/lists'
import { newId, toChip } from '@/lib/nai'
import { naiImageBlob } from '@/lib/nai-write'
import { charsSourceName } from '@/lib/random-block'
import { lookupTag } from '@/lib/tagdb'
import { makeSection, nextCharColor } from '@/store/doc'
import { findPool, splitTagKey, useGacha, useGachaRun, type Results } from '@/store/gacha'
import { FAV_COLLECTION, useLibrary } from '@/store/library'
import { NSFW_MAX_LEVEL, newDocSettings, usePrefs } from '@/store/prefs'
import { getDocStore, useTabs } from '@/store/tabs'
import type { Character, Chip, Doc, Section } from '@/types'
import { maxCharacters } from '@/lib/nai-models'
import type { GenderValue } from '@/lib/gender'
import { docUndoToast } from '@/components/undo-toast'

export const artistCount = (name: string) => artistPosts(name) ?? 0

export const artistMin = (s: Extract<PoolSource, { kind: 'artists' }>) => s.minCount ?? DEFAULT_MIN_COUNT
export const charMin = (s: Extract<PoolSource, { kind: 'chars' }>) => s.minCount ?? 0

const charCache = new Map<number, string[]>()
function resolveChars(s: Extract<PoolSource, { kind: 'chars' }>): string[] | undefined {
  if (!charWorksReady()) return undefined
  const min = charMin(s)
  let hit = charCache.get(min)
  if (!hit) {
    hit = charsAtLeast(allChars(), lookupTag, min)
    if (hit.length) charCache.set(min, hit)
  }
  return hit
}

/** undefined means source data is pending; null means the source is absent, so callers must not treat both as empty results. */
export function resolveLiveSource(s: PoolSource): string[] | null | undefined {
  if (s.kind === 'artists') {
    const { list, pop } = useArtistData.getState()
    if (!list) return undefined
    const algo = artistAlgoOf(s)
    if (algo === 'count') return artistsAtLeast(list, artistMin(s))
    return pop ? artistsTopBy(list, pop, algo, ratingMode(), artistTopOf(s)) : undefined
  }
  if (s.kind === 'artistColl') return useLibrary.getState().artistCollections.find((c) => c.id === s.coll)?.items.map((x) => x.name) ?? null
  if (s.kind === 'chars') return resolveChars(s)
  return null
}

export const waitingForLive = (p: Pick<GachaPool, 'source'>) => p.source.some((s) => isLiveSource(s) && resolveLiveSource(s) === undefined)

export const DEFAULT_CHAR_MIN = 1000

export function workChars(s: Extract<PoolSource, { kind: 'work' }>): string[] | undefined {
  if (!charWorksReady()) return undefined
  const min = s.minCount ?? DEFAULT_CHAR_MIN
  return charsOfWork(s.work)
    .map((t) => [t, lookupTag(t)] as const)
    .filter(([, e]) => e && e.count >= min && e.old !== 2)
    .sort((a, b) => b[1]!.count - a[1]!.count)
    .map(([t]) => t)
}

/** undefined means source data is pending; null means the source is absent, so callers must not treat both as empty results. */
export function resolveSource(s: PoolSource, catalog: Catalog, lists: readonly UserList[]): string[] | null | undefined {
  if (isLiveSource(s)) return resolveLiveSource(s)
  if (s.kind === 'work') return workChars(s)
  if (s.kind === 'mylist') {
    const l = lists.find((x) => x.id === s.list)
    const n = l && findListNode(l.nodes, s.node)
    return n ? allTags(n) : null
  }
  if (s.kind !== 'list') return null
  const node = findNode(listTree(s.list), s.path)
  if (!node) return null
  const min = s.minCount ?? DEFAULT_MIN_COUNT
  const seen = new Map<string, number>()
  for (const a of nodeAtoms(node)) for (const t of catalog.byAtom.get(a) ?? []) if (t.count >= min && t.old !== 2 && !seen.has(t.name)) seen.set(t.name, t.count)
  return [...seen.entries()].sort((a, b) => b[1] - a[1]).map(([n]) => n)
}

export const sameSource = (a: PoolSource, b: PoolSource) =>
  a.kind === b.kind &&
  (a.kind === 'list'
    ? b.kind === 'list' && a.list === b.list && a.path === b.path
    : a.kind === 'mylist'
      ? b.kind === 'mylist' && a.list === b.list && a.node === b.node
      : a.kind === 'work'
        ? b.kind === 'work' && a.work === b.work
        : a.kind === 'artistColl'
          ? b.kind === 'artistColl' && a.coll === b.coll
          : true)

export const artistCollTitle = (id: string) => useLibrary.getState().artistCollections.find((c) => c.id === id)?.title ?? '（已删除的合集）'

const pathLabel = (path: string, sep = ' / ') => path.split('/').map((x) => x.replace(/^@/, '')).join(sep)

export function sourceName(s: PoolSource, lists: readonly UserList[]): string {
  if (s.kind === 'artists') return artistsSourceName(s)
  if (s.kind === 'chars') return charsSourceName(s)
  if (s.kind === 'artistColl') return s.coll === FAV_COLLECTION ? '收藏' : artistCollTitle(s.coll)
  if (s.kind === 'work') return lookupTag(s.work)?.zh || s.work
  if (s.kind === 'list') return pathLabel(s.path)
  const l = lists.find((x) => x.id === s.list)
  const n = l && findListNode(l.nodes, s.node)
  return l && n ? `${l.name} / ${n.title}` : '（已删除的 list）'
}

export const sourceTag = (s: PoolSource) => (s.kind === 'list' ? `分类 ${s.list.toUpperCase()}` : s.kind === 'mylist' ? '我的 list' : '')

export const liveCount = (p: Pick<GachaPool, 'tags'>, off: readonly string[] = []) => (off.length ? p.tags.filter((t) => !off.includes(t)).length : p.tags.length)

export const fmtN = (n: number) => n.toLocaleString('en-US')

export function poolHeadLabel(p: Pick<GachaPool, 'kind' | 'source' | 'picked' | 'tags'>, lists: readonly UserList[], off: readonly string[] = []): string {
  const n = `${fmtN(liveCount(p, off))}${p.kind === 'artist' ? ' 位' : ''}`
  if (!p.source.length) return `单独选择 · ${n}`
  if (p.source.length === 1 && !p.picked?.length) return `${p.source[0].kind === 'list' ? pathLabel(p.source[0].path, '/') : sourceName(p.source[0], lists)} · ${n}`
  const extra = p.picked?.length ? ` + ${p.picked.length}` : ''
  if (p.kind === 'char' && p.source.every((s) => s.kind === 'work')) return `${p.source.length} 部作品${extra} · ${n}`
  return `${p.source.length} 个${p.kind === 'artist' || p.kind === 'char' ? '来源' : '分类'}${extra} · ${n}`
}

export const ratingMode = () => (usePrefs.getState().nsfw === 'off' ? 'sfw' : 'all')

export function drawCtx(p: Pick<GachaPool, 'kind'> & Partial<Pick<GachaPool, 'source'>>): DrawCtx {
  const max = NSFW_MAX_LEVEL[usePrefs.getState().nsfw]
  if (p.kind === 'artist') {
    const nsfw = usePrefs.getState().nsfw !== 'off'
    const algo = poolArtistAlgo(p.source)
    const mode = ratingMode()
    const countOf = algo === 'count' ? artistCount : (n: string) => artistScore(n, algo, mode) ?? 0
    return { countOf, allowed: (n) => nsfw || !isNsfwOnlyArtist(n), rng: Math.random }
  }
  if (p.kind === 'char') return { countOf: (t) => lookupTag(t)?.count ?? 0, allowed: () => true, rng: Math.random }
  return { countOf: (t) => lookupTag(t)?.count ?? 0, allowed: (t) => (lookupTag(t)?.level ?? 0) <= max, rng: Math.random }
}

export function effective(collId: string, p: GachaPool): { count: Count; popularity: number; weight?: ArtistWeight; genders?: GenderPick[] } {
  const t = useGacha.getState().templates[collId]?.[p.id]
  return {
    count: t?.count ?? p.count,
    popularity: t?.popularity ?? p.popularity,
    weight: p.kind === 'artist' ? (p.weight ?? 'none') : undefined,
    genders: p.kind === 'char' ? (p.genders ?? ['canon']) : undefined,
  }
}

const exclude = (collId: string, poolId: string) => useGacha.getState().excludeOf(collId, poolId)

export function poolOf(c: GachaCollection, key: string): { pool: GachaPool; exId: string; charPool?: GachaPool; charTag?: string } | null {
  const ck = parseChildKey(key)
  if (ck) {
    const parent = c.pools.find((p) => p.id === ck.charPoolId)
    const child = parent?.children?.find((k) => k.id === ck.childId)
    return parent && child ? { pool: child, exId: child.id, charPool: parent, charTag: ck.charTag } : null
  }
  const hit = findPool(c.pools, key)
  return hit ? { pool: hit.pool, exId: hit.pool.id } : null
}

export function charRows(results: Results, p: GachaPool, tag: string): { pool: GachaPool; key: string; draws: Draw[] }[] {
  return (p.children ?? []).map((k) => {
    const key = childKey(p.id, tag, k.id)
    return { pool: k, key, draws: results[key] ?? [] }
  })
}

const drawGender = (v: GenderValue): Pick<Draw, 'gender' | 'genderExtra'> => ({ gender: v.gender, genderExtra: v.genderExtra ? structuredClone(v.genderExtra) : undefined })

function syncChars(c: GachaCollection, prev: Results, next: Results, rollKids: ReadonlySet<string>) {
  for (const p of c.pools) {
    if (p.kind !== 'char') continue
    const eff = effective(c.id, p)
    const draws = (next[p.id] ?? []).map((d) => (d.gender ? d : { ...d, ...drawGender(pickGender(eff.genders, canonGender(d.tag), Math.random)) }))
    if (next[p.id]) next[p.id] = draws
    const keep = new Set<string>()
    for (const d of draws)
      for (const k of p.children ?? []) {
        const key = childKey(p.id, d.tag, k.id)
        keep.add(key)
        if (!(key in next) || rollKids.has(p.id)) next[key] = drawPool(k, prev[key] ?? [], { ...effective(c.id, k), exclude: exclude(c.id, k.id), ctx: drawCtx(k) })
      }
    for (const key of Object.keys(next)) if (parseChildKey(key)?.charPoolId === p.id && !keep.has(key)) delete next[key]
  }
}

function commit(c: GachaCollection, results: Results, push = true, rollKids: ReadonlySet<string> = new Set()) {
  const run = useGachaRun.getState()
  syncChars(c, run.results[c.id] ?? {}, results, rollKids)
  const history = push ? [{ at: Date.now(), results }, ...(run.history[c.id] ?? [])].slice(0, 12) : run.history[c.id]
  run.set({ results: { ...run.results, [c.id]: results }, history: { ...run.history, ...(history ? { [c.id]: history } : {}) }, rollSeq: run.rollSeq + 1 })
}

export function rollPools(c: GachaCollection, ids?: string[]) {
  const run = useGachaRun.getState()
  const prev = run.results[c.id] ?? {}
  const locks = run.poolLocks[c.id] ?? []
  const next: Results = { ...prev }
  const rollKids = new Set<string>()
  for (const p of c.pools) {
    if (ids ? !ids.includes(p.id) : locks.includes(p.id)) continue
    if (waitingForLive(p)) continue
    next[p.id] = drawPool(p, prev[p.id] ?? [], { ...effective(c.id, p), exclude: exclude(c.id, p.id), ctx: drawCtx(p) })
    if (p.kind === 'char') rollKids.add(p.id)
  }
  commit(c, next, true, rollKids)
}

export function ensureResults(c: GachaCollection) {
  const prev = useGachaRun.getState().results[c.id]
  const missing = c.pools.filter((p) => !prev?.[p.id] && !waitingForLive(p))
  const kidsMissing = c.pools.some((p) => p.kind === 'char' && (prev?.[p.id] ?? []).some((d) => !d.gender || (p.children ?? []).some((k) => !prev?.[childKey(p.id, d.tag, k.id)])))
  if (!missing.length && !kidsMissing) return
  const next: Results = { ...prev }
  for (const p of missing) next[p.id] = drawPool(p, [], { ...effective(c.id, p), exclude: exclude(c.id, p.id), ctx: drawCtx(p) })
  commit(c, next, !prev)
}

function byPool(keys: readonly string[]): Map<string, string[]> {
  const m = new Map<string, string[]>()
  for (const k of keys) {
    const [pid, tag] = splitTagKey(k)
    m.set(pid, [...(m.get(pid) ?? []), tag])
  }
  return m
}

export function rerollTags(c: GachaCollection, keys: readonly string[]) {
  const prev = useGachaRun.getState().results[c.id] ?? {}
  const next: Results = { ...prev }
  const newKeys: string[] = []
  for (const [pid, tags] of byPool(keys)) {
    const hit = poolOf(c, pid)
    if (!hit) continue
    const before = prev[pid] ?? []
    const after = rerollDraws(hit.pool, before, tags, { popularity: effective(c.id, hit.pool).popularity, exclude: exclude(c.id, hit.exId), ctx: drawCtx(hit.pool) })
    next[pid] = hit.pool.kind === 'char' ? after.map((d, i) => (d.tag !== before[i]?.tag ? { tag: d.tag, ...(d.locked ? { locked: true } : {}) } : d)) : after
    after.forEach((d, i) => tags.includes(before[i]?.tag ?? '') && newKeys.push(`${pid}|${d.tag}`))
  }
  commit(c, next)
  if (useGachaRun.getState().selTags.length) useGachaRun.getState().set({ selTags: newKeys, anchor: newKeys[0] ?? null })
}

export function toggleLockTags(c: GachaCollection, keys: readonly string[]) {
  const prev = useGachaRun.getState().results[c.id] ?? {}
  const groups = byPool(keys)
  const all = [...groups].every(([pid, tags]) => (prev[pid] ?? []).filter((d) => tags.includes(d.tag)).every((d) => d.locked))
  const next: Results = { ...prev }
  for (const [pid, tags] of groups) next[pid] = (prev[pid] ?? []).map((d) => (tags.includes(d.tag) ? { ...d, locked: all ? undefined : true } : d))
  commit(c, next, false)
}

export function toggleLockPools(c: GachaCollection, ids: readonly string[]) {
  const run = useGachaRun.getState()
  const locks = run.poolLocks[c.id] ?? []
  const all = ids.every((id) => locks.includes(id))
  run.set({ poolLocks: { ...run.poolLocks, [c.id]: all ? locks.filter((x) => !ids.includes(x)) : [...new Set([...locks, ...ids])] } })
}

export function refit(c: GachaCollection, p: GachaPool) {
  const prev = useGachaRun.getState().results[c.id] ?? {}
  if (!prev[p.id]) return
  commit(c, { ...prev, [p.id]: fitDraws(p, prev[p.id], { ...effective(c.id, p), exclude: exclude(c.id, p.id), ctx: drawCtx(p) }) }, false)
}

export function dropTags(c: GachaCollection, keys: readonly string[]) {
  const prev = useGachaRun.getState().results[c.id] ?? {}
  const next: Results = { ...prev }
  for (const [pid, tags] of byPool(keys)) next[pid] = (prev[pid] ?? []).filter((d) => !tags.includes(d.tag))
  commit(c, next, false)
  useGachaRun.getState().set({ selTags: [], anchor: null })
}

export function drawChips(p: Pick<GachaPool, 'kind'>, draws: readonly Draw[]): Chip[] {
  return draws.map((d) => toChip(drawChip(p, d)))
}

export function workOf(p: Pick<GachaPool, 'source' | 'sourceTags'>, tag: string): string | null {
  const i = (p.sourceTags ?? []).findIndex((list) => list.includes(tag))
  const s = i >= 0 ? p.source[i] : null
  return s?.kind === 'work' ? s.work : (worksOf(tag)[0] ?? null)
}

export const charName = (tag: string) => lookupTag(tag)?.zh || tag

const charChips = (p: GachaPool, tag: string) => {
  const work = workOf(p, tag)
  return [tag, ...(work ? [work] : [])].map((t) => toChip(tagChip(t)))
}

export function drawnCharacter(results: Results, p: GachaPool, d: Draw, color: Character['color']): Character {
  const work = workOf(p, d.tag)
  const first = makeSection('角色', charChips(p, d.tag), color)
  const kids = charRows(results, p, d.tag)
    .filter((r) => r.draws.length)
    .map((r) => makeSection(r.pool.name, drawChips(r.pool, r.draws), color))
  const ch: Character = { id: newId('ch'), name: charName(d.tag), gender: d.gender ?? 'other', color, prompt: [first, ...kids], uc: [], enabled: true, center: { x: 0.5, y: 0.5 } }
  if (d.genderExtra) ch.genderExtra = structuredClone(d.genderExtra)
  if (work) ch.work = lookupTag(work)?.zh || work
  return ch
}

export function drawnCharacters(c: GachaCollection, results: Results, ids?: readonly string[], used: Character['color'][] = []): Character[] {
  const out: Character[] = []
  const taken = [...used]
  for (const p of c.pools) {
    if (p.kind !== 'char' || (ids && !ids.includes(p.id))) continue
    for (const d of results[p.id] ?? []) {
      const color = nextCharColor(taken)
      taken.push(color)
      out.push(drawnCharacter(results, p, d, color))
    }
  }
  return out
}

export function countChips(c: GachaCollection, results: Results, ids?: readonly string[]): string[] | null {
  const pools = c.pools.filter((p) => p.kind === 'char' && (!ids || ids.includes(p.id)))
  if (!pools.length) return null
  return countTags(pools.flatMap((p) => (results[p.id] ?? []).map((d) => d.gender ?? 'other')))
}

const poolSections = (c: GachaCollection, results: Results, ids?: readonly string[]): Section[] =>
  c.pools.filter((p) => p.kind !== 'char' && p.target === 'prompt' && (!ids || ids.includes(p.id)) && (results[p.id]?.length ?? 0) > 0).map((p) => makeSection(p.name, drawChips(p, results[p.id] ?? []), p.color))

export function resultsDoc(c: GachaCollection, results: Results, ids?: readonly string[]): Doc {
  const count = countChips(c, results, ids)
  const countSec: Section[] = count?.length ? [makeSection('人数', count.map((t) => toChip(tagChip(t))), 'slate')] : []
  const settings = newDocSettings()
  return {
    base: { prompt: [...countSec, ...poolSections(c, results, ids)], uc: [] },
    characters: drawnCharacters(c, results, ids).slice(0, maxCharacters(settings.model)),
    settings,
    meta: { title: c.name, createdAt: Date.now() },
  }
}

export const resultLine = (c: GachaCollection, results: Results): string => resultLineOf(c.pools, results, workOf)

const goEditor = () => (location.hash = '/')

export async function copyLine(c: GachaCollection) {
  const text = resultLine(c, useGachaRun.getState().results[c.id] ?? {})
  if (!text) return void toast.error('本次未抽到内容')
  try {
    await navigator.clipboard.writeText(text)
    toast.success('已复制', { description: text })
  } catch {
    toast.error('复制失败：无剪贴板权限')
  }
}

export async function copyNaiImage(c: GachaCollection) {
  const doc = resultsDoc(c, useGachaRun.getState().results[c.id] ?? {})
  try {
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': naiImageBlob(doc) })])
    toast.success('已复制 NAI 图', { description: '在 NAI 中按 Ctrl+V，选择 Import Metadata；导入位置和生成参数需勾选 Settings' })
  } catch {
    toast.error('复制失败：无剪贴板权限')
  }
}

export function openInNewTab(c: GachaCollection) {
  const results = useGachaRun.getState().results[c.id] ?? {}
  const doc = resultsDoc(c, results)
  const tabs = useTabs.getState()
  const id = tabs.newTab()
  useTabs.getState().openInTab(id, doc)
  goEditor()
  toast(`已在新 tab 中打开 · ${doc.base.prompt.length} 个区块${doc.characters.length ? ` · ${doc.characters.length} 个角色` : ''}`)
}

export function insertIntoCurrent(c: GachaCollection) {
  const tabs = useTabs.getState()
  if (tabs.starts.includes(tabs.activeId)) return openInNewTab(c)
  const results = useGachaRun.getState().results[c.id] ?? {}
  const store = getDocStore(tabs.activeId)
  const sections = poolSections(c, results)
  const chars = drawnCharacters(c, results, undefined, store.getState().doc.characters.map((x) => x.color))
  if (!sections.length && !chars.length) return void toast.error('本次未抽到内容')
  const n = store.getState().insertMany({ prompt: sections, characters: chars })
  goEditor()
  if (n < chars.length) return void toast(`角色数已达上限（${maxCharacters(store.getState().doc.settings.model)}），已添加 ${n} 个`)
  const what = [sections.length ? `${sections.length} 个区块` : '', n ? `${n} 个角色` : ''].filter(Boolean).join(' · ')
  docUndoToast(store, `已插入 ${what}`)
}

export const asText = (c: GachaCollection, keys: readonly string[]) =>
  keys.map((k) => {
    const [pid, tag] = splitTagKey(k)
    return poolOf(c, pid)?.pool.kind === 'artist' ? `artist:${tag}` : tag
  })

export const withLiveContent = (p: GachaPool): GachaPool =>
  p.source.some(isLiveSource) ? withContent(p, { sourceTags: p.source.map((s, i) => (isLiveSource(s) ? (resolveLiveSource(s) ?? []) : (p.sourceTags?.[i] ?? []))) }) : p
