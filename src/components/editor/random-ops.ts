import { toast } from 'sonner'
import { drawCtx, resolveLiveSource, waitingForLive } from '@/components/gacha/data'
import { loadArtistList, loadArtistPopularity } from '@/lib/artist-db'
import { canonGender, loadCharWorks, worksOf } from '@/lib/char-works'
import { usesPopularity, type PoolKind } from '@/lib/gacha'
import { hasScope, newRandomSection, runRandom, slotsOf, toggleLocked, type RandomCtx, type RandomOp } from '@/lib/random-block'
import { newId } from '@/lib/nai'
import { lookupTag } from '@/lib/tagdb'
import { findSection, nextCharColor, type DocStore } from '@/store/doc'
import { useUi } from '@/store/ui'
import type { BoxRef, Character, RandomRule, Section } from '@/types'
import { maxCharacters } from '@/lib/nai-models'
import { docUndoToast } from '@/components/undo-toast'
import { useDoc, useDocStore } from '@/store/context'

export const RANDOM_DRAG_PREFIX = 'rnd:'
export const randomKindFromDrag = (id: string) => id.slice(RANDOM_DRAG_PREFIX.length) as PoolKind
export const RANDOM_ROWS: { kind: PoolKind; name: string; hint: string; desc: string }[] = [
  { kind: 'char', name: '角色随机', hint: '全部角色 · 抽 1', desc: '从角色库全部中抽取 1 个角色，添加为新角色框' },
  { kind: 'artist', name: '画师随机', hint: '代表作人气前 1000 · 抽 3', desc: '从画师库代表作人气前 1000 的画师中抽取 3 位' },
  { kind: 'tag', name: '随机区块', hint: '选择范围后抽取', desc: '插入后在左栏选择范围，选择后自动抽取' },
]

export function randomCtx(rule: Pick<RandomRule, 'kind' | 'source'>): RandomCtx {
  return {
    ...drawCtx(rule),
    live: resolveLiveSource,
    workOf: (t) => worksOf(t)[0] ?? null,
    canonGender,
    isChar: (t) => lookupTag(t)?.category === 'character',
  }
}

async function ensureLive(rule: RandomRule) {
  const jobs: Promise<unknown>[] = []
  if (rule.source.some((s) => s.kind === 'artists')) jobs.push(loadArtistList().catch(() => undefined))
  if (usesPopularity(rule.source)) jobs.push(loadArtistPopularity().catch(() => undefined))
  if (rule.source.some((s) => s.kind === 'chars')) jobs.push(loadCharWorks())
  await Promise.all(jobs)
}

const sameList = <T>(a: readonly T[], b: readonly T[]) => a.length === b.length && a.every((x, i) => x === b[i])

export async function applyRandom(store: DocStore, id: string, op: RandomOp, patch?: Partial<RandomRule>, coalesce?: string) {
  const f = findSection(store.getState().doc, id)
  if (!f?.section.random) return
  const rule: RandomRule = { ...f.section.random, ...patch }
  const res = runRandom(rule, f.section.chips, op, randomCtx(rule))
  if (!res) {
    if (patch) store.getState().setRandom(id, { rule }, coalesce)
    await ensureLive(rule)
    const g = findSection(store.getState().doc, id)
    if (!g?.section.random || waitingForLive(g.section.random)) return
    return applyRandom(store, id, op)
  }
  const next = res.locked ? { ...rule, locked: res.locked } : rule
  const chips = sameList(res.chips, f.section.chips) ? undefined : res.chips
  if (!patch && !chips && !res.locked && !res.gender) return
  store.getState().setRandom(id, { rule: patch || res.locked ? next : undefined, chips, gender: res.gender }, coalesce)
}

export const rerollRandom = (store: DocStore, id: string, tags?: readonly string[]) => applyRandom(store, id, tags?.length ? { kind: 'reroll', tags } : { kind: 'roll' })

export function lockRandom(store: DocStore, id: string, tags?: readonly string[], coalesce?: string) {
  const s = findSection(store.getState().doc, id)?.section
  if (!s?.random) return
  const rule = tags?.length
    ? s.random.lockAll
      ? { ...s.random, lockAll: undefined, locked: slotsOf(s.random, s.chips, (tag) => lookupTag(tag)?.category === 'character').map((slot) => slot.tag).filter((tag) => !tags.includes(tag)) }
      : { ...s.random, locked: toggleLocked(s.random, tags) }
    : { ...s.random, lockAll: !s.random.lockAll || undefined }
  store.getState().setRandom(id, { rule }, coalesce)
}

export function lockSelected(store: DocStore, chipIds: readonly string[]) {
  const key = newId('lock')
  for (const [id, tags] of selectedRandomTags(store, chipIds)) lockRandom(store, id, tags, key)
}

export function useSelectedLock(chipIds: readonly string[]) {
  const store = useDocStore()
  const state = useDoc(() => {
    const groups = selectedRandomTags(store, chipIds)
    if (!groups.size) return null
    return [...groups].every(([id, tags]) => {
      const rule = findSection(store.getState().doc, id)!.section.random!
      return rule.lockAll || tags.every((tag) => rule.locked?.includes(tag))
    })
  })
  return { visible: state !== null, locked: state === true, toggle: () => lockSelected(store, chipIds) }
}

export function selectedRandomTags(store: DocStore, chipIds: readonly string[]): Map<string, string[]> {
  const out = new Map<string, string[]>()
  const doc = store.getState().doc
  const want = new Set(chipIds)
  const visit = (list: Section[]) => {
    for (const s of list) {
      if (!s.random || !s.chips.some((c) => want.has(c.id))) continue
      const tags: string[] = []
      let cur = ''
      for (const c of s.chips) {
        if (s.random.kind !== 'char' || lookupTag(c.text)?.category === 'character' || !cur) cur = c.text
        if (want.has(c.id) && !tags.includes(cur)) tags.push(cur)
      }
      out.set(s.id, tags)
    }
  }
  visit(doc.base.prompt)
  visit(doc.base.uc)
  for (const c of doc.characters) {
    visit(c.prompt)
    visit(c.uc)
  }
  return out
}

export type RandomDrop = { near: string; side: 'before' | 'after' } | { box: BoxRef }

export async function insertRandom(store: DocStore, kind: PoolKind, at: RandomDrop | null, opts: { toast?: boolean } = {}): Promise<string | null> {
  if (kind === 'char') {
    const max = maxCharacters(store.getState().doc.settings.model)
    if (store.getState().doc.characters.length >= max) {
      toast.error(`角色数已达上限（${max}）`)
      return null
    }
    const color = nextCharColor(store.getState().doc.characters.map((c) => c.color))
    const sec = newRandomSection('char', color)
    await ensureLive(sec.random!)
    const res = runRandom(sec.random!, [], { kind: 'roll' }, randomCtx(sec.random!))
    if (res) sec.chips = res.chips
    const ch: Character = { id: newId('ch'), name: '', gender: res?.gender?.gender ?? 'other', color, prompt: [sec], uc: [], enabled: true, center: { x: 0.5, y: 0.5 } }
    if (res?.gender?.genderExtra) ch.genderExtra = structuredClone(res.gender.genderExtra)
    if (!store.getState().insertCharacter(ch)) return null
    useUi.getState().flash(ch.id)
    if (opts.toast) docUndoToast(store, '已添加随机角色')
    return ch.id
  }
  const sec = newRandomSection(kind)
  if (hasScope(sec.random!)) {
    await ensureLive(sec.random!)
    const res = runRandom(sec.random!, [], { kind: 'roll' }, randomCtx(sec.random!))
    if (res) sec.chips = res.chips
  }
  const target = at ?? { box: { kind: 'base', field: 'prompt' } as BoxRef }
  store.getState().insertSection(sec, target)
  useUi.getState().flash(sec.id)
  if (opts.toast) docUndoToast(store, `已插入随机区块「${sec.name}」`)
  return sec.id
}
