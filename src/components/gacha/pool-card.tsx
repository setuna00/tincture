import { memo, useMemo, useState, type MouseEvent, type ReactNode } from 'react'
import { ArrowDown01Icon, PaintBoardIcon, PinIcon, Refresh01Icon, SquareLock02Icon, SquareUnlock02Icon, UserIcon, ZapIcon } from '@hugeicons/core-free-icons'
import { ChipFace, chipAttrs } from '@/components/editor/chip-face'
import { sectionVars } from '@/components/editor/labels'
import { GenderIcon, GenderName } from '@/components/gender'
import { Icon } from '@/components/icon'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Tip } from '@/components/tip'
import { childKey, countLabel, drawChip, isFixed, popBasis, type Count, type Draw, type GachaCollection, type GachaPool } from '@/lib/gacha'
import { toChip } from '@/lib/nai'
import { lookupTag } from '@/lib/tagdb'
import { cn } from '@/lib/utils'
import { nextCharColor } from '@/store/doc'
import { tagKey, useGacha, useGachaRun } from '@/store/gacha'
import { useLists } from '@/store/lists'
import type { SectionColor } from '@/types'
import { CharChipFace, CountControl, PopSlider, PopStepper, popRule, popText } from './controls'
import { charName, countChips, poolHeadLabel, refit, rerollTags, rollPools, toggleLockPools, toggleLockTags, workOf } from './data'

const NO_OFF: never[] = []

const NO_DRAWS: Draw[] = []

const DrawChip = memo(function DrawChip({ pool, d, sel, i, k }: { pool: GachaPool; d: Draw; sel: boolean; i: number; k: string }) {
  const chip = useMemo(() => ({ ...toChip(drawChip(pool, d)), id: d.tag }), [pool, d])
  return (
    <span
      className="relative inline-flex animate-in duration-200 fade-in-0 zoom-in-95"
      style={{ animationDelay: `${i * 25}ms`, animationFillMode: 'backwards' }}
      data-tag-key={k}
      data-testid="gacha-draw"
      data-locked={d.locked ? '' : undefined}
    >
      <span className="chip" {...chipAttrs(chip)} data-selected={sel ? '' : undefined}>
        <ChipFace chip={chip} />
      </span>
      {d.locked && <LockPin />}
    </span>
  )
})

export const LockPin = () => (
  <span className="pointer-events-none absolute -top-2 -right-1.5 grid size-4 place-items-center rounded-full bg-lamp text-lamp-ink shadow-sm" aria-label="已锁定">
    <Icon icon={PinIcon} size={14} />
  </span>
)

export function EmptySlot({ label, hint }: { label: string; hint?: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-block w-11 border border-dashed border-line-strong" style={{ height: 'var(--chip-h)', borderRadius: 'var(--chip-radius)' }} data-testid="gacha-empty-slot" />
      </TooltipTrigger>
      <TooltipContent>{hint ?? `抽 ${label}：本次未抽满`}</TooltipContent>
    </Tooltip>
  )
}

export function HeadButton({ icon, label, on, disabled, onClick, testId }: { icon: typeof PinIcon; label: string; on?: boolean; disabled?: boolean; onClick: () => void; testId: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          className={cn('grid size-6 place-items-center rounded-md transition-colors hover:bg-surface-2 disabled:opacity-40 disabled:hover:bg-transparent', on ? 'text-lamp-text' : 'text-ink-2 hover:text-ink-1')}
          onClick={(e) => {
            e.stopPropagation()
            onClick()
          }}
          aria-label={label}
          aria-pressed={on}
          data-testid={testId}
        >
          <Icon icon={icon} size={16} />
        </button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

function Draws({ p, list, k, selTags }: { p: GachaPool; list: readonly Draw[]; k: string; selTags: readonly string[] }) {
  const maxN = Math.min(p.count[1], p.tags.length)
  const empty = isFixed(p) ? 0 : Math.max(0, maxN - list.length)
  return (
    <>
      {list.map((d, i) => (
        <DrawChip key={d.tag} pool={p} d={d} i={i} k={tagKey(k, d.tag)} sel={selTags.includes(tagKey(k, d.tag))} />
      ))}
      {Array.from({ length: empty }, (_, i) => (
        <EmptySlot key={i} label={countLabel(p, p.count)} />
      ))}
    </>
  )
}

export function PoolCard({ c, p }: { c: GachaCollection; p: GachaPool }) {
  const draws = useGachaRun((s) => s.results[c.id]?.[p.id]) ?? NO_DRAWS
  const selected = useGachaRun((s) => s.selPools.includes(p.id))
  const selTags = useGachaRun((s) => s.selTags)
  const locked = useGachaRun((s) => (s.poolLocks[c.id] ?? []).includes(p.id))
  const lists = useLists((s) => s.lists)
  const off = useGacha((s) => s.excludes[`${c.id}/${p.id}`] ?? NO_OFF)
  const t = useGacha((s) => s.templates[c.id]?.[p.id])
  const count = t?.count ?? p.count
  const pop = t?.popularity ?? p.popularity
  const tuned = !!t?.count || t?.popularity !== undefined
  const [tuneOpen, setTuneOpen] = useState(false)
  const fixed = isFixed({ ...p, count })
  const live = { ...p, count }

  const onClick = (e: MouseEvent) => {
    if ((e.target as Element).closest('[data-tag-key], button, input, [data-tune]')) return
    e.stopPropagation()
    const run = useGachaRun.getState()
    if (e.ctrlKey || e.metaKey || e.shiftKey) {
      const has = run.selPools.includes(p.id)
      run.set({ selPools: has ? run.selPools.filter((x) => x !== p.id) : [...run.selPools, p.id], selTags: [], anchor: null })
    } else run.set({ selPools: [p.id], selTags: [], anchor: null })
  }

  return (
    <div className="section" style={sectionVars(p.color)} data-selected={selected ? '' : undefined} data-pool={p.id} data-kind={p.kind} data-testid="gacha-pool" onClick={onClick}>
      <div className="section-head">
        {p.kind !== 'tag' && <Icon icon={p.kind === 'char' ? UserIcon : PaintBoardIcon} size={14} className="text-(--tint)" />}
        <span className="section-name" data-testid="gacha-pool-name">
          {p.name}
        </span>
        <button
          type="button"
          className="-mx-1 inline-flex h-5 items-center gap-1 rounded px-1 text-[11px] text-ink-2 tabular-nums transition-colors duration-(--dur-fast) hover:bg-surface-2 hover:text-ink-1"
          onClick={() => setTuneOpen((o) => !o)}
          aria-expanded={tuneOpen}
          data-testid="gacha-tune-toggle"
        >
          <span data-testid="gacha-pool-count">{countLabel(p, count)}</span>· {popRule(pop)}
          {tuned && <span className="size-1.5 shrink-0 rounded-full bg-lamp" data-testid="gacha-tune-dot" />}
          <Icon icon={ArrowDown01Icon} size={12} className={cn('transition-transform duration-200', tuneOpen && 'rotate-180')} />
        </button>
        <span className="ml-auto flex min-w-0 items-center gap-1">
          <span className="truncate text-[11px] text-ink-2" data-testid="gacha-pool-source">
            {poolHeadLabel(p, lists, off)}
          </span>
          {!fixed && (
            <span className="ml-1 flex items-center gap-0.5">
              <HeadButton icon={locked ? SquareLock02Icon : SquareUnlock02Icon} label={locked ? '解锁（抽一组时重新抽取）' : '锁定（抽一组时保持不变）'} on={locked} onClick={() => toggleLockPools(c, [p.id])} testId="gacha-pool-lock" />
              <HeadButton icon={Refresh01Icon} label="重抽" onClick={() => rollPools(c, [p.id])} testId="gacha-pool-reroll" />
            </span>
          )}
        </span>
      </div>
      <div
        className="grid transition-[grid-template-rows,opacity] duration-200"
        style={{ gridTemplateRows: tuneOpen ? '1fr' : '0fr', opacity: tuneOpen ? 1 : 0 }}
        inert={!tuneOpen}
        data-open={tuneOpen ? '' : undefined}
        data-testid="gacha-tune-wrap"
      >
        <div className="min-h-0 overflow-hidden">
          <TuneStrip c={c} p={p} />
        </div>
      </div>
      <div className="section-body" style={p.kind === 'char' ? { rowGap: 8 } : undefined}>
        {p.kind === 'char' ? (
          <CharDraws c={c} p={live} draws={draws} selTags={selTags} />
        ) : (
          <>
            <Draws p={live} list={draws} k={p.id} selTags={selTags} />
            {!p.tags.length && <span className="text-[12px] text-ink-3">加载中…</span>}
          </>
        )}
      </div>
    </div>
  )
}

const sameCount = (a: Count, b: Count) => a[0] === b[0] && a[1] === b[1]

function TuneStrip({ c, p }: { c: GachaCollection; p: GachaPool }) {
  const t = useGacha((s) => s.templates[c.id]?.[p.id])
  const count = t?.count ?? p.count
  const pop = t?.popularity ?? p.popularity
  const tune = useGacha.getState().tune
  const setCount = (v: Count) => {
    tune(c.id, p.id, { count: sameCount(v, p.count) ? undefined : v })
    refit(c, p)
  }
  const setPop = (v: number) => tune(c.id, p.id, { popularity: v === p.popularity ? undefined : v })
  return (
    <div className="mt-2 mb-1 grid grid-cols-[auto_auto] justify-start gap-x-7 rounded-md bg-shell px-3 pt-2 pb-2" data-tune="" data-testid="gacha-tune">
      <span className="flex items-center gap-2 pb-2.5 text-[12px] text-ink-2">
        抽
        <CountControl value={count} size={p.tags.length} onChange={setCount} testId="gacha-tune-count" />
      </span>
      <span className="flex items-center gap-2 pb-2.5 text-[12px] text-ink-2">
        抽法
        <PopStepper value={pop} onChange={setPop} testId="gacha-tune-pop" />
        <PopSlider value={pop} onChange={setPop} width={170} basis={popBasis(p)} testId="gacha-tune-pop-slider" />
      </span>
      <Tuned show={!!t?.count} testId="gacha-tune-count-reset" onReset={() => (tune(c.id, p.id, { count: undefined }), refit(c, p))}>
        默认为 {countLabel(p, p.count)}
      </Tuned>
      <Tuned show={t?.popularity !== undefined} testId="gacha-tune-pop-reset" onReset={() => tune(c.id, p.id, { popularity: undefined })}>
        默认为 {popText(p.popularity)}
      </Tuned>
    </div>
  )
}

function Tuned({ show, onReset, testId, children }: { show: boolean; onReset: () => void; testId: string; children: ReactNode }) {
  return (
    <div
      className="grid transition-[grid-template-rows,opacity] duration-200"
      style={{ gridTemplateRows: show ? '1fr' : '0fr', opacity: show ? 1 : 0 }}
      inert={!show}
      data-testid={testId}
      data-on={show ? '' : undefined}
    >
      <p className="flex min-h-0 items-center gap-1.5 overflow-hidden text-[11px] whitespace-nowrap text-ink-2">
        <span className="size-1.5 shrink-0 rounded-full bg-lamp" />
        <span className="py-0.5">
          {children} ·{' '}
          <button type="button" className="text-lamp-text hover:underline" onClick={onReset} data-testid={`${testId}-btn`}>
            恢复
          </button>
        </span>
      </p>
    </div>
  )
}

function charColors(n: number): SectionColor[] {
  const out: SectionColor[] = []
  for (let i = 0; i < n; i++) out.push(nextCharColor(out))
  return out
}

function CharDraws({ c, p, draws, selTags }: { c: GachaCollection; p: GachaPool; draws: readonly Draw[]; selTags: readonly string[] }) {
  const results = useGachaRun((s) => s.results[c.id])
  const maxN = Math.min(p.count[1], p.tags.length)
  const empty = Math.max(0, maxN - draws.length)
  const colors = charColors(draws.length)
  return (
    <>
      {draws.map((d, i) => (
        <CharDrawCard key={d.tag} c={c} p={p} d={d} idx={i + 1} color={colors[i]} selTags={selTags} results={results} />
      ))}
      {empty > 0 && (
        <div
          className="flex h-9 w-full items-center justify-center rounded-(--section-radius) border border-dashed border-line-strong text-[12px] text-ink-2"
          data-testid="gacha-char-empty"
        >
          抽 {countLabel(p, p.count)}：本次少 {empty} 个角色
        </div>
      )}
      {!p.tags.length && <span className="text-[12px] text-ink-3">加载中…</span>}
    </>
  )
}

function CharDrawCard({
  c,
  p,
  d,
  idx,
  color,
  selTags,
  results,
}: {
  c: GachaCollection
  p: GachaPool
  d: Draw
  idx: number
  color: SectionColor
  selTags: readonly string[]
  results: Record<string, Draw[]> | undefined
}) {
  const key = tagKey(p.id, d.tag)
  const sel = selTags.includes(key)
  const work = workOf(p, d.tag)
  const g = d.gender ?? 'other'
  const workChip = work ? { ...toChip({ text: work, type: 'tag', weight: 1 }), id: work } : null
  return (
    <div
      className="char-card w-full animate-in duration-200 fade-in-0 motion-reduce:animate-none"
      data-g={g}
      style={{ ...sectionVars(color), padding: '8px 12px 10px' }}
      data-selected={sel ? '' : undefined}
      data-testid="gacha-char"
      data-char={d.tag}
      data-locked={d.locked ? '' : undefined}
    >
      <header className="char-head" style={{ margin: '-8px -12px 0', padding: '5px 8px 5px 12px' }}>
        <span className="flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 self-stretch" data-tag-key={key} data-testid="gacha-char-head">
          <span className="grid size-5 shrink-0 place-items-center rounded-full bg-surface-3 text-[11px] text-ink-2">{idx}</span>
          <GenderIcon gender={g} />
          <GenderName value={{ gender: g, genderExtra: d.genderExtra }} className="-ml-0.5" />
          <span className="char-name truncate text-[13px] font-semibold">{charName(d.tag)}</span>
          {work && <span className="truncate text-[12px] text-ink-2">{lookupTag(work)?.zh || work}</span>}
          {d.locked && <Icon icon={PinIcon} size={14} className="shrink-0 text-lamp-text" aria-label="已锁定" />}
        </span>
        <HeadButton
          icon={d.locked ? SquareLock02Icon : SquareUnlock02Icon}
          label={d.locked ? '解锁角色' : '锁定角色（抽一组时保留）'}
          on={d.locked}
          onClick={() => toggleLockTags(c, [key])}
          testId="gacha-char-lock"
        />
        <HeadButton icon={Refresh01Icon} label="更换角色" onClick={() => rerollTags(c, [key])} testId="gacha-char-reroll" />
      </header>
      <div className="mt-2 flex flex-col gap-1">
        <Row label="角色">
          <span className="chip" data-cat="character" data-has-zh="" data-testid="gacha-char-chip">
            <CharChipFace tag={d.tag} gender={g} />
          </span>
          {workChip && (
            <span className="chip" {...chipAttrs(workChip)}>
              <ChipFace chip={workChip} />
            </span>
          )}
        </Row>
        {(p.children ?? []).map((k) => {
          const ck = childKey(p.id, d.tag, k.id)
          return (
            <Row key={k.id} label={k.name}>
              <Draws p={k} list={results?.[ck] ?? NO_DRAWS} k={ck} selTags={selTags} />
            </Row>
          )
        })}
      </div>
    </div>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2.5">
      <Tip label={label}>
        <span className="w-7 shrink-0 truncate pt-1 text-[12px] text-ink-2">
          {label}
        </span>
      </Tip>
      <div className="section-body flex-1 p-0!">{children}</div>
    </div>
  )
}

export function CountBlock({ c }: { c: GachaCollection }) {
  const results = useGachaRun((s) => s.results[c.id])
  const tags = countChips(c, results ?? {})
  if (!tags) return null
  return (
    <div className="section border-dashed! bg-transparent!" style={sectionVars('slate')} data-testid="gacha-count">
      <div className="section-head">
        <Icon icon={ZapIcon} size={14} className="text-ink-2" />
        <span className="section-name text-ink-2!">人数</span>
        <span className="text-[11px] text-ink-2">自动</span>
        <span className="ml-auto text-[11px] text-ink-2">跟随角色池</span>
      </div>
      <div className="section-body">
        {tags.map((t) => {
          const chip = { ...toChip({ text: t, type: 'tag', weight: 1 }), id: t }
          return (
            <span key={t} className="chip" {...chipAttrs(chip)} data-testid="gacha-count-chip">
              <ChipFace chip={chip} />
            </span>
          )
        })}
        {!tags.length && <span className="text-[12px] text-ink-2">本次未抽到角色</span>}
      </div>
    </div>
  )
}

