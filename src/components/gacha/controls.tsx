import { useMemo, useState } from 'react'
import { Add01Icon, Cancel01Icon, MinusSignIcon, Refresh01Icon, SquareLock02Icon, SquareUnlock02Icon, Tick02Icon } from '@hugeicons/core-free-icons'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { ChipFace, chipAttrs } from '@/components/editor/chip-face'
import { GenderIcon } from '@/components/gender'
import { useGenderOptions } from '@/lib/use-gender-options'
import { Icon } from '@/components/icon'
import { Seg } from '@/components/seg'
import { Slider } from '@/components/ui/slider'
import { Tip } from '@/components/tip'
import { clampPop, drawChip, genderPickKey, POP_MAX, POP_MIN, POP_STEP, pushCount, type ArtistWeight, type Count, type GachaPool, type GenderPick } from '@/lib/gacha'
import { lookupTag } from '@/lib/tagdb'
import { toChip } from '@/lib/nai'
import { cn } from '@/lib/utils'
import type { Gender } from '@/types'

const STEP_BTN = 'grid h-full w-[30px] shrink-0 place-items-center bg-surface-2 text-ink-1 transition-colors duration-(--dur-fast) hover:bg-line-strong disabled:pointer-events-none disabled:opacity-40'

export function Stepper({ value, min, max, onChange, label, testId }: { value: number; min: number; max: number; onChange: (v: number) => void; label: string; testId: string }) {
  return (
    <span className="inline-flex h-7 items-stretch overflow-hidden rounded-md border border-line-strong bg-work" data-testid={testId}>
      <button type="button" className={cn(STEP_BTN, 'border-r border-line')} disabled={value <= min} onClick={() => onChange(value - 1)} aria-label={`${label}减一`}>
        <Icon icon={MinusSignIcon} size={16} />
      </button>
      <span className="grid min-w-[30px] place-items-center px-1 text-[13px] font-semibold text-ink-1 tabular-nums" data-testid={`${testId}-value`}>
        {value}
      </span>
      <button type="button" className={cn(STEP_BTN, 'border-l border-line')} disabled={value >= max} onClick={() => onChange(value + 1)} aria-label={`${label}加一`}>
        <Icon icon={Add01Icon} size={16} />
      </button>
    </span>
  )
}

export function CountControl({ value, size, onChange, testId = 'gacha-count' }: { value: Count; size: number; onChange: (v: Count) => void; testId?: string }) {
  const cap = Math.max(size, 1)
  return (
    <span className="flex items-center gap-1.5">
      <Stepper value={value[0]} min={0} max={cap} onChange={(v) => onChange(pushCount(value, 0, v))} label="最少" testId={`${testId}-min`} />
      <span className="text-[12px] text-ink-2">至</span>
      <Stepper value={value[1]} min={0} max={cap} onChange={(v) => onChange(pushCount(value, 1, v))} label="最多" testId={`${testId}-max`} />
    </span>
  )
}

const popNum = (v: number) => (v < 0 ? `−${Math.abs(v)}` : String(v))
export const popText = (v: number) => (v === 0 ? '纯随机' : v === 1 ? '按人气' : v === -1 ? '冷门' : popNum(v))
export const popRule = (v: number) => (v === 0 || v === 1 || v === -1 ? popText(v) : `抽法 ${popNum(v)}`)

const popStep = (v: number, dir: 1 | -1) => clampPop((dir > 0 ? Math.floor(v / POP_STEP + 1e-6) + 1 : Math.ceil(v / POP_STEP - 1e-6) - 1) * POP_STEP)

export function PopStepper({ value, onChange, testId }: { value: number; onChange: (v: number) => void; testId: string }) {
  const [draft, setDraft] = useState<string | null>(null)
  const commit = () => {
    if (draft === null) return
    const v = Number(draft.trim().replace('−', '-'))
    if (draft.trim() && Number.isFinite(v)) onChange(clampPop(v))
    setDraft(null)
  }
  return (
    <input
      className="h-7 w-14 shrink-0 rounded-md border border-line-strong bg-surface-2/60 text-center text-[13px] font-semibold text-ink-1 tabular-nums transition-colors duration-(--dur-fast) outline-none focus:border-lamp-text"
      value={draft ?? popNum(value)}
      inputMode="decimal"
      onChange={(e) => setDraft(e.target.value)}
      onFocus={(e) => e.currentTarget.select()}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur()
        else if (e.key === 'Escape') {
          setDraft(null)
          e.currentTarget.blur()
        } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
          e.preventDefault()
          setDraft(null)
          onChange(popStep(value, e.key === 'ArrowUp' ? 1 : -1))
        }
      }}
      aria-label="抽法数值"
      data-testid={testId}
    />
  )
}

const popPos = (v: number) => ((v - POP_MIN) / (POP_MAX - POP_MIN)) * 100
const popHint = (basis: string) => `0：每个概率相同 · 1：概率与${basis}成正比`

export function PopSlider({ value, onChange, width, basis = '作品数', testId }: { value: number; onChange: (v: number) => void; width?: number; basis?: string; testId: string }) {
  const from = Math.min(popPos(0), popPos(value))
  const to = Math.max(popPos(0), popPos(value))
  return (
    <Tip label={popHint(basis)}>
      <div
        className="relative flex h-7 shrink-0 items-center"
        style={width ? { width } : { width: '100%' }}
        // react-hotkeys-hook ignores focused sliders; blur after mouse drags so page shortcuts work, but retain keyboard focus.
        onPointerUp={(e) => {
          const a = document.activeElement
          if (a instanceof HTMLElement && e.currentTarget.contains(a)) a.blur()
        }}
        data-testid={testId}
      >
        <span className="pointer-events-none absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-line-strong" />
        <span className="pointer-events-none absolute top-1/2 h-1 -translate-y-1/2 rounded-full bg-lamp-text" style={{ left: `${from}%`, width: `${to - from}%` }} data-testid={`${testId}-fill`} />
        <span className="pointer-events-none absolute top-1/2 h-3 w-px -translate-y-1/2 bg-ink-3" style={{ left: `${popPos(0)}%` }} />
        <Slider
          className="relative z-[1] **:data-[slot=slider-range]:opacity-0 **:data-[slot=slider-thumb]:size-3.5 **:data-[slot=slider-thumb]:rounded-full **:data-[slot=slider-thumb]:border-lamp-text **:data-[slot=slider-thumb]:bg-lamp **:data-[slot=slider-track]:bg-transparent"
          value={[value]}
          min={POP_MIN}
          max={POP_MAX}
          step={POP_STEP}
          onValueChange={([v]) => onChange(clampPop(v))}
          aria-label="抽法"
        />
        <span className="pointer-events-none absolute inset-x-0 top-[22px] h-3.5 text-[11px] leading-[14px] whitespace-nowrap text-ink-2" aria-hidden>
          <span className="absolute left-0">冷门</span>
          <span className="absolute left-1/2 -translate-x-1/2">纯随机</span>
          <span className="absolute right-0">按人气</span>
        </span>
      </div>
    </Tip>
  )
}
export function MainActions({
  label,
  onRoll,
  rollTestId,
  rollDisabled,
  locked,
  onLock,
  lockTestId,
}: {
  label: string
  onRoll: () => void
  rollTestId: string
  rollDisabled?: boolean
  locked: boolean
  onLock: () => void
  lockTestId: string
}) {
  return (
    <div className="flex gap-2">
      <Button className="h-7 min-w-0 flex-1 gap-2 text-[13px] font-semibold" onClick={onRoll} disabled={rollDisabled} data-testid={rollTestId}>
        <Icon icon={Refresh01Icon} size={14} />
        {label}
        <kbd className="ml-1 rounded-sm bg-black/15 px-1 text-[11px]">R</kbd>
      </Button>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="outline"
            className={cn('size-10 shrink-0 p-0', locked && 'border-lamp-text text-lamp-text')}
            onClick={onLock}
            aria-label={locked ? '解锁' : '锁定'}
            aria-pressed={locked}
            data-testid={lockTestId}
          >
            <Icon icon={locked ? SquareLock02Icon : SquareUnlock02Icon} size={16} />
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          {locked ? '已锁定 · 点击解锁' : '锁定'} <kbd className="ml-1 text-[11px] opacity-70">L</kbd>
        </TooltipContent>
      </Tooltip>
    </div>
  )
}

export const WEIGHT_LABEL: Record<ArtistWeight, string> = { none: '不加权', main: '主次', rand: '随机' }
export const WeightSeg = ({ value, onChange }: { value: ArtistWeight; onChange: (v: ArtistWeight) => void }) => <Seg value={value} onChange={onChange} options={WEIGHT_LABEL} testId="gacha-weight" />

const PICK_LABEL = { canon: '原作', female: '女', male: '男', other: '其他' } as const
export const genderPickLabel = (g: GenderPick) => (typeof g === 'string' ? PICK_LABEL[g] : g.name)
const PICKS: GenderPick[] = ['canon', 'female', 'male', 'other']

export function GenderToggles({ value, onChange, testId = 'gacha-genders' }: { value: readonly GenderPick[]; onChange: (v: GenderPick[]) => void; testId?: string }) {
  const exts = useGenderOptions()
  const keys = new Set(value.map(genderPickKey))
  const shown: GenderPick[] = [...PICKS, ...exts]
  for (const g of value) if (!shown.some((x) => genderPickKey(x) === genderPickKey(g))) shown.push(g)
  const toggle = (g: GenderPick) => {
    const on = keys.has(genderPickKey(g))
    if (on && value.length === 1) return
    onChange(shown.filter((x) => (genderPickKey(x) === genderPickKey(g) ? !on : keys.has(genderPickKey(x)))))
  }
  return (
    <span className="flex flex-wrap justify-end gap-1" role="group" aria-label="性别" data-testid={testId}>
      {shown.map((g) => {
        const on = keys.has(genderPickKey(g))
        return (
          <button
            key={genderPickKey(g)}
            type="button"
            aria-pressed={on}
            className={cn(
              'inline-flex h-6 items-center gap-1 rounded-md border px-2 text-[12px] font-medium transition-colors',
              on ? 'border-line-strong bg-work text-ink-1 shadow-xs' : 'border-line text-ink-2 hover:text-ink-1',
            )}
            onClick={() => toggle(g)}
            data-testid={`${testId}-${typeof g === 'string' ? g : g.name}`}
          >
            {on && <Icon icon={Tick02Icon} size={14} className="text-lamp-text" />}
            {g !== 'canon' && <GenderIcon gender={typeof g === 'string' ? g : g.gender} size={14} />}
            {genderPickLabel(g)}
          </button>
        )
      })}
    </span>
  )
}

export function CharChipFace({ tag, gender }: { tag: string; gender?: Gender | null }) {
  const zh = lookupTag(tag)?.zh
  return (
    <>
      {gender && (
        <span className="chip-alias opacity-100!" data-on="" aria-hidden>
          <GenderIcon gender={gender} size={14} />
        </span>
      )}
      <span className="chip-body">
        <span className="chip-en">
          <span className="chip-text">{tag}</span>
        </span>
        {zh && <span className="chip-zh">{zh}</span>}
      </span>
    </>
  )
}

export function RuleChip({
  pool,
  tag,
  off,
  gender,
  onToggle,
  onRemove,
}: {
  pool: Pick<GachaPool, 'kind'>
  tag: string
  off?: boolean
  gender?: Gender | null
  onToggle?: () => void
  onRemove?: () => void
}) {
  const chip = useMemo(() => ({ ...toChip(drawChip(pool, { tag })), id: tag }), [pool, tag])
  return (
    <Tip label={onToggle ? (off ? '点击恢复' : '点击排除') : undefined}>
      <span
        className={cn('chip group relative transition-opacity duration-150', onToggle && 'cursor-pointer', off && 'opacity-35 [&_.chip-text]:line-through')}
        {...chipAttrs(chip)}
        data-cat={pool.kind === 'char' ? 'character' : chipAttrs(chip)['data-cat']}
        data-off={off ? '' : undefined}
        onClick={onToggle}
        role={onToggle ? 'switch' : undefined}
        aria-checked={onToggle ? !off : undefined}
        data-testid="gacha-rule-chip"
        data-tag={tag}
      >
        {pool.kind === 'char' ? <CharChipFace tag={tag} gender={gender} /> : <ChipFace chip={chip} />}
        {onRemove && (
          <button
            type="button"
            className="chip-x"
            onClick={(e) => {
              e.stopPropagation()
              onRemove()
            }}
            aria-label={`移除 ${tag}`}
            data-testid="gacha-rule-chip-remove"
          >
            <Icon icon={Cancel01Icon} size={14} />
          </button>
        )}
      </span>
    </Tip>
  )
}
