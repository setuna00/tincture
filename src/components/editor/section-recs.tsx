import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useStore } from 'zustand'
import { ArrowDataTransferHorizontalIcon, Refresh01Icon, SparklesIcon } from '@hugeicons/core-free-icons'
import { Icon } from '@/components/icon'
import { replacedType } from '@/components/assistant/inspector'
import { Tip } from '@/components/tip'
import { newId } from '@/lib/nai'
import { genderTags } from '@/lib/gender'
import type { Recommendation, RecommendOptions, Seed } from '@/lib/recommend'
import { aliasOf, lookupTag, npmi, recommendTags } from '@/lib/tagdb'
import { useActions, useDocStore } from '@/store/context'
import { findChip, findSection } from '@/store/doc'
import { useLibrary, variantBase } from '@/store/library'
import { useLists } from '@/store/lists'
import { siblingIndex } from '@/lib/lists'
import { useUi } from '@/store/ui'
import type { Chip, Doc } from '@/types'
import { ChipFace, chipAttrs } from './chip-face'

const COMMON = 15
const FRESH = 15
const FRESH_ASK = FRESH + 2
const listOfficial = (t: string) => lookupTag(t)?.name ?? aliasOf(t) ?? null
const EXTRA_POOL = 40
function listExtra(siblings: (name: string) => string[], seed: string): string[] {
  return siblings(seed)
    .map((n) => ({ n, s: npmi(seed, n), c: lookupTag(n)?.count ?? 0 }))
    .sort((a, b) => b.s - a.s || b.c - a.c)
    .slice(0, EXTRA_POOL)
    .map((x) => x.n)
}
const LINGER_MS = 350
const CLOSE_MS = 180
const OUT_MS = 120
const IN_MS = 220

function mergeGroup(common: Recommendation[], fresh: Recommendation[], exclude: string[]): RecItem[] {
  const seen = new Set([...exclude, ...common.map((r) => r.name)])
  return [...common.map((rec) => ({ rec, fresh: false })), ...fresh.filter((r) => !seen.has(r.name)).slice(0, FRESH).map((rec) => ({ rec, fresh: true }))]
}
function loadGroup(base: RecContext, prev: string[]): Promise<RecItem[]> {
  const exclude = [...base.exclude, ...prev]
  return Promise.all([
    recommendTags(base.seeds, exclude, COMMON, base.opts).catch(() => []),
    recommendTags(base.seeds, exclude, FRESH, { ...base.opts, fresh: true }).catch(() => []),
  ]).then(([common, fresh]) => mergeGroup(common, fresh, exclude))
}
type Group = { key: string; round: number; items: RecItem[] }

export function useRecsLinger(active: boolean) {
  const [prev, setPrev] = useState(active)
  const [closing, setClosing] = useState(false)
  if (prev !== active) {
    setPrev(active)
    setClosing(!active)
  }
  useEffect(() => {
    if (!closing) return
    const t = setTimeout(() => setClosing(false), LINGER_MS + CLOSE_MS)
    return () => clearTimeout(t)
  }, [closing])
  const lingering = !active && (closing || prev !== active)
  return { show: active || lingering, closing: lingering }
}
const cache = new Map<string, Recommendation[]>()
function remember(key: string, list: Recommendation[]) {
  cache.delete(key)
  cache.set(key, list)
  if (cache.size > 60) cache.delete(cache.keys().next().value!)
}

type Swap = { chipId: string; from: string; to: string }

interface RecContext {
  seeds: Seed[]
  exclude: string[]
  opts: RecommendOptions
  chipId: string | null
  label: string
  swap: Swap | null
}

const isOfficial = (t: string) => !!lookupTag(t)
const seedable = (c: Chip) => !c.disabled && c.weight > 0 && c.type !== 'text' && c.type !== 'textrender' && c.type !== 'year'

function recContext(doc: Doc, sectionId: string, chipId: string | null, variants: Record<string, string[]>): RecContext | null {
  const f = findSection(doc, sectionId)
  if (!f) return null
  const base = (t: string) => variantBase(t, variants, isOfficial) ?? aliasOf(t) ?? t
  const exclude = new Set<string>()
  for (const s of f.list) for (const c of s.chips) exclude.add(c.text).add(base(c.text))
  const box = f.box
  const owner = box.kind === 'char' && box.field === 'prompt' ? doc.characters.find((c) => c.id === box.charId) : undefined
  const auto = owner ? genderTags(owner) : []
  for (const t of auto) exclude.add(t)
  const opts: RecommendOptions = { negative: f.box.field === 'uc', character: f.box.kind === 'char', ...(auto.length ? { context: auto } : {}) }
  const all = f.section.chips.filter(seedable).map((c) => ({ name: base(c.text), weight: Math.min(2, c.weight) }))
  const chip = chipId ? f.section.chips.find((c) => c.id === chipId) : undefined
  const to = chip && (chip.type === 'tag' || chip.type === 'interaction') && !variantBase(chip.text, variants, isOfficial) ? aliasOf(chip.text) : undefined
  const swap = chip && to ? { chipId: chip.id, from: chip.text, to } : null
  if (chip && seedable(chip) && isOfficial(base(chip.text))) {
    const name = base(chip.text)
    return {
      seeds: [{ name, weight: 1 }],
      exclude: [...exclude],
      opts: { ...opts, context: [...(opts.context ?? []), ...all.map((s) => s.name).filter((n) => n !== name)] },
      chipId: chip.id,
      label: chip.text,
      swap,
    }
  }
  return { seeds: all, exclude: [...exclude], opts, chipId: null, label: f.section.name, swap }
}

export function SectionRecs({ sectionId, closing = false }: { sectionId: string; closing?: boolean }) {
  const store = useDocStore()
  const actions = useActions()
  const variants = useLibrary((s) => s.variants)
  const live = useUi((s) => (s.focusSectionId === sectionId ? s.selectedChipId : null))
  const [frozen, setFrozen] = useState(live)
  if (!closing && frozen !== live) setFrozen(live)
  const selectedChip = closing ? frozen : live
  const [opened, setOpened] = useState(false)
  const baseKey = useStore(store, (s) => JSON.stringify(recContext(s.doc, sectionId, selectedChip, variants)))
  const lists = useLists((s) => s.lists)
  const siblings = useMemo(() => siblingIndex(lists, listOfficial), [lists])
  const base = useMemo(() => JSON.parse(baseKey) as RecContext | null, [baseKey])
  const extra = useMemo(() => (base?.chipId && base.seeds[0] ? listExtra(siblings, base.seeds[0].name) : []), [base, siblings])
  const key = extra.length ? `${baseKey}|list:${extra.join(',')}` : baseKey
  const ctx = useMemo(() => (base && extra.length ? { ...base, opts: { ...base.opts, extra } } : base), [key]) // eslint-disable-line react-hooks/exhaustive-deps
  const [recs, setRecs] = useState<{ key: string; list: Recommendation[] } | null>(() => (cache.has(key) ? { key, list: cache.get(key)! } : null))
  const warm = useRef(!!recs)
  const focusKey = `${sectionId}:${ctx?.chipId ?? ''}`
  const freshKey = `${baseKey}|fresh`
  const [fresh, setFresh] = useState<{ key: string; list: Recommendation[] } | null>(() => (cache.has(freshKey) ? { key: freshKey, list: cache.get(freshKey)! } : null))
  const freshWarm = useRef(!!fresh)
  const lastAdded = useRef<{ anchor: string; id: string } | null>(null)

  useEffect(() => {
    if (!ctx?.seeds.length) return
    const hit = cache.get(key)
    if (hit) {
      setRecs({ key, list: hit })
      warm.current = true
      return
    }
    let alive = true
    const timer = setTimeout(
      () =>
        recommendTags(ctx.seeds, ctx.exclude, COMMON, ctx.opts).then((list) => {
          remember(key, list)
          if (!alive) return
          setRecs({ key, list })
          warm.current = true
        }),
      warm.current ? 60 : 0,
    )
    return () => {
      alive = false
      clearTimeout(timer)
    }
  }, [ctx, key])

  useEffect(() => {
    if (!base?.seeds.length) return
    const done = (list: Recommendation[]) => {
      setFresh({ key: freshKey, list })
      freshWarm.current = true
    }
    const hit = cache.get(freshKey)
    if (hit) return done(hit)
    let alive = true
    const timer = setTimeout(
      () =>
        recommendTags(base.seeds, base.exclude, FRESH_ASK, { ...base.opts, fresh: true })
          .catch(() => [])
          .then((list) => {
            remember(freshKey, list)
            if (alive) done(list)
          }),
      freshWarm.current ? 60 : 0,
    )
    return () => {
      alive = false
      clearTimeout(timer)
    }
  }, [base, freshKey])

  const first = useMemo<RecItem[]>(() => mergeGroup(recs?.list ?? [], fresh?.list ?? [], base?.exclude ?? []), [recs, fresh, base])

  const [batch, setBatch] = useState<{ focus: string; round: number; prev: string[] } | null>(null)
  const [cur, setCur] = useState<Group | null>(null)
  const [next, setNext] = useState<Group | null>(null)
  const [anim, setAnim] = useState<{ old: RecItem[]; fadeFrom: number } | 'in' | null>(null)
  if (batch && batch.focus !== focusKey) {
    setBatch(null)
    setCur(null)
    setAnim(null)
  }
  const groupKey = (prev: string[]) => `${baseKey}|${JSON.stringify(prev)}`
  const curKey = batch ? groupKey(batch.prev) : null
  const shown = batch ? (cur?.round === batch.round ? cur.items : NONE) : first
  const settled = batch ? cur?.key === curKey : recs?.key === key && fresh?.key === freshKey
  const nextPrev = useMemo(() => (settled ? [...(batch?.prev ?? []), ...shown.map((i) => i.rec.name)] : null), [settled, batch, shown])
  const nextKey = nextPrev && groupKey(nextPrev)
  const noNext = !!nextKey && next?.key === nextKey && !next.items.length

  useEffect(() => {
    if (!batch || !curKey || !base?.seeds.length || cur?.key === curKey) return
    let alive = true
    const round = batch.round
    const timer = setTimeout(() => void loadGroup(base, batch.prev).then((items) => alive && setCur({ key: curKey, round, items })), cur?.round === round ? 60 : 0)
    return () => {
      alive = false
      clearTimeout(timer)
    }
  }, [curKey]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!nextKey || !nextPrev || !base?.seeds.length || next?.key === nextKey) return
    let alive = true
    void loadGroup(base, nextPrev).then((items) => alive && setNext({ key: nextKey, round: 0, items }))
    return () => {
      alive = false
    }
  }, [nextKey]) // eslint-disable-line react-hooks/exhaustive-deps

  const ready = !batch || cur?.round === batch.round
  useEffect(() => {
    if (!anim || (anim !== 'in' && !ready)) return
    const t = setTimeout(() => setAnim(anim === 'in' ? null : 'in'), anim === 'in' ? IN_MS : OUT_MS)
    return () => clearTimeout(t)
  }, [anim, ready])

  const listRef = useRef<HTMLDivElement>(null)
  const [boxH, setBoxH] = useState<number | null>(null)
  const swapping = !!anim
  useLayoutEffect(() => {
    const el = listRef.current
    if (!swapping || !el) return
    const measure = () => setBoxH(el.offsetHeight)
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => {
      ro.disconnect()
      setBoxH(null)
    }
  }, [swapping])

  const nextGroup = () => {
    if (anim || !nextPrev || !nextKey || noNext) return
    const round = (batch?.round ?? 0) + 1
    setAnim({ old: shown, fadeFrom: batch ? 0 : NO_FADE })
    setBatch({ focus: focusKey, round, prev: nextPrev })
    if (next?.key === nextKey) setCur({ ...next, round })
  }

  if (!ctx) return null
  if (ctx.seeds.length && (!recs || !fresh)) return null
  const add = (n: string) => {
    const tag = lookupTag(n)
    const chip: Chip = { id: newId('c'), text: n, type: tag?.category === 'artist' ? 'artist' : 'tag', weight: 1, disabled: false }
    let index: number | undefined
    if (ctx.chipId) {
      const chips = findSection(store.getState().doc, sectionId)?.section.chips ?? []
      const prev = lastAdded.current?.anchor === ctx.chipId ? lastAdded.current.id : ctx.chipId
      const at = chips.findIndex((c) => c.id === prev)
      index = at >= 0 ? at + 1 : undefined
      lastAdded.current = { anchor: ctx.chipId, id: chip.id }
    }
    actions.addChips(sectionId, [chip], index)
  }
  const swap = (s: Swap) => {
    const c = findChip(store.getState().doc, s.chipId)?.chip
    if (c) actions.updateChip(c.id, { text: s.to, type: replacedType(c, lookupTag(s.to)) })
  }
  const seeds = ctx.seeds.length
  const byTag = !!ctx.chipId
  const stale = batch ? !!cur && cur.round === batch.round && cur.key !== curKey : (recs && recs.key !== key) || (fresh && fresh.key !== freshKey)
  const leaving = anim && anim !== 'in' ? anim : null

  return (
    <div
      className="section-recs"
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation() }
      data-testid={closing ? 'section-recs-closing' : 'section-recs'}
      inert={closing}
      data-closing={closing ? '' : undefined}
      style={{ '--recs-linger': `${LINGER_MS}ms`, '--recs-close': `${CLOSE_MS}ms` } as React.CSSProperties}
      // Reordering cards reinserts their DOM and restarts CSS animations; enable the entrance animation only on first mount.
      data-opened={opened ? '' : undefined}
      onAnimationEnd={(e) => e.target === e.currentTarget && setOpened(true)}
      data-for={sectionId}
      data-mode={byTag ? 'tag' : 'section'}
      data-round={batch?.round ?? 0}
      data-stale={stale ? '' : undefined}
    >
      <SwapRow swap={ctx.swap} onSwap={swap} />
      <div className="section-recs-head">
        <Icon icon={SparklesIcon} size={14} className="section-recs-icon" />
        {byTag ? (
          <span className="min-w-0 truncate" data-testid="section-recs-title">
            与 <b>{ctx.label}</b> 搭配
          </span>
        ) : (
          <span className="min-w-0 truncate" data-testid="section-recs-title">
            补充推荐<span className="text-ink-2"> · 基于本区块{seeds ? ` ${seeds} 个 tag` : ''}</span>
          </span>
        )}
        {seeds > 0 && !!recs?.list.length && <NextGroup disabled={noNext} onClick={nextGroup} />}
      </div>
      {!seeds ? (
        <p className="section-recs-empty">区块中添加 tag 后显示推荐</p>
      ) : recs && !recs.list.length ? (
        <p className="section-recs-empty">暂无推荐</p>
      ) : (
        <div className="recs-list" style={boxH == null ? undefined : { height: boxH }} data-swapping={swapping ? '' : undefined} data-leaving={leaving ? '' : undefined}>
          <div ref={listRef} className="flex flex-wrap items-center gap-x-(--chip-gap-x) gap-y-(--chip-gap-y)">
            <RecList items={leaving?.old ?? shown} onAdd={add} fadeFrom={leaving?.fadeFrom ?? (batch ? 0 : NO_FADE)} />
          </div>
        </div>
      )}
    </div>
  )
}

function SwapRow({ swap, onSwap }: { swap: Swap | null; onSwap: (s: Swap) => void }) {
  const [last, setLast] = useState(swap)
  if (swap && (swap.chipId !== last?.chipId || swap.to !== last.to || swap.from !== last.from)) setLast(swap)
  if (!last) return null
  const chip: Chip = { id: last.to, text: last.to, type: 'tag', weight: 1, disabled: false }
  return (
    <div className="recs-swap" data-on={swap ? '' : undefined} inert={!swap} data-testid="recs-swap">
      <div className="recs-swap-inner">
        <div className="section-recs-head">
          <Icon icon={ArrowDataTransferHorizontalIcon} size={14} className="section-recs-icon" />
          <span className="min-w-0 truncate">
            <b>{last.from}</b> 的正式写法
          </span>
          <span className="ml-auto shrink-0 text-ink-2">点击替换，权重不变</span>
        </div>
        <div className="flex">
          <Tip label={`Danbooru 别名：${last.from} → ${last.to}`}>
            <button
              type="button"
              className="chip rec-chip"
              {...chipAttrs(chip)}
              data-chip-id={undefined}
              onClick={() => onSwap(last)}
              data-testid="recs-swap-chip"
            >
              <span className="rec-plus">
                <Icon icon={ArrowDataTransferHorizontalIcon} size={14} />
              </span>
              <ChipFace chip={chip} />
            </button>
          </Tip>
        </div>
      </div>
    </div>
  )
}

function NextGroup({ disabled, onClick }: { disabled: boolean; onClick: () => void }) {
  return (
    <Tip label={disabled ? '暂无更多推荐' : undefined}>
      <button type="button" className="recs-next" aria-disabled={disabled || undefined} onClick={onClick} data-testid="section-recs-next">
        换一组
        <Icon icon={Refresh01Icon} size={14} />
      </button>
    </Tip>
  )
}

type RecItem = { rec: Recommendation; fresh: boolean }
const NONE: RecItem[] = []
const NO_FADE = Infinity

const RecList = memo(function RecList({ items, onAdd, fadeFrom }: { items: RecItem[]; onAdd: (name: string) => void; fadeFrom: number }) {
  return (
    <>
      {items.map(({ rec: r, fresh }, i) => {
        const tag = lookupTag(r.name)
        const chip: Chip = { id: r.name, text: r.name, type: tag?.category === 'artist' ? 'artist' : 'tag', weight: 1, disabled: false }
        return (
          <Tip key={r.name} label={r.because.startsWith('同组') ? r.because : `推荐依据：${r.because}`}>
            <button
              type="button"
              className="chip rec-chip"
              {...chipAttrs(chip)}
              data-chip-id={undefined}
              onClick={() => onAdd(r.name)}
              data-testid="rec-chip"
              data-src={fresh ? 'fresh' : 'common'}
              data-more={i >= fadeFrom ? '' : undefined}
            >
              <span className="rec-plus">+</span>
              <ChipFace chip={chip} />
            </button>
          </Tip>
        )
      })}
    </>
  )
})
