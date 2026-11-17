// NovelAI shares one token budget across base and character positive prompts, and another across their negative prompts.
import { useState } from 'react'
import { Alert02Icon, AlertCircleIcon } from '@hugeicons/core-free-icons'
import { Icon } from '@/components/icon'
import { sectionTint } from '@/components/editor/labels'
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import type { DupGroup } from '@/lib/nai-length'
import { isOver, type MeterData, type MeterSeg } from '@/lib/use-meters'

const NAI_GREY = 'color-mix(in oklch, var(--ink-3) 60%, transparent)'
const partFill = (p: Pick<MeterSeg, 'color' | 'gender' | 'nsfw'>) =>
  p.color ? sectionTint(p.color) : p.gender ? `var(--gender-${p.gender})` : p.nsfw ? 'var(--nsfw-ink)' : NAI_GREY
const OTHER_GREY = 'color-mix(in oklch, var(--ink-3) 26%, transparent)'

export function TokenNum({ m, failed }: { m: MeterData; failed: boolean }) {
  return (
    <span className="shrink-0 text-[11px] text-ink-2 tabular-nums data-[over]:font-medium data-[over]:text-danger" data-over={isOver(m) ? '' : undefined} data-testid="token-count">
      {m.own === undefined || failed ? '—' : m.own} token
    </span>
  )
}

export function OverIcon({ m }: { m: MeterData }) {
  if (!isOver(m)) return null
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="grid size-4 shrink-0 place-items-center text-danger" data-testid="token-over">
          <Icon icon={Alert02Icon} size={14} />
        </span>
      </TooltipTrigger>
      <TooltipContent side="left">
        超出 {m.total! - m.limit} token（{m.total} / {m.limit}），NAI 将截断超出部分
      </TooltipContent>
    </Tooltip>
  )
}

export function DupIcon({ groups }: { groups?: DupGroup[] }) {
  if (!groups?.length) return null
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="grid size-4 shrink-0 place-items-center text-warn" data-testid="export-dup">
          <Icon icon={AlertCircleIcon} size={14} />
        </span>
      </TooltipTrigger>
      <TooltipContent side="left" className="block max-w-sm py-2" data-testid="export-dup-tip">
        <table className="border-separate border-spacing-x-0 border-spacing-y-0.5">
          <tbody>
            {groups.map((g) => (
              <tr key={g.key}>
                <td className="pr-3.5 font-medium">{g.tag}</td>
                <td className="opacity-75">{g.places.join(' · ')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </TooltipContent>
    </Tooltip>
  )
}

export function LengthMeter({ m, failed }: { m: MeterData; failed: boolean }) {
  const [open, setOpen] = useState(false)
  const over = isOver(m)
  const ready = m.own !== undefined && m.total !== undefined && !failed
  const scale = Math.max(m.limit, m.total ?? 0)
  const pct = (n: number) => `${(n / scale) * 100}%`
  const bar = (
    <div className="-mt-0.5 mb-1.5 cursor-default py-1" data-testid="length-meter" data-over={over ? '' : undefined}>
      <div className="meter-track">
        {ready && (
          <>
            <i className="meter-seg" style={{ width: pct(m.own!), background: over ? 'var(--danger)' : 'color-mix(in oklch, var(--ink-2) 72%, transparent)' }} />
            <i className="meter-seg" style={{ width: pct(m.total! - m.own!), background: over ? 'var(--danger)' : OTHER_GREY }} />
          </>
        )}
      </div>
    </div>
  )
  return (
    <HoverCard openDelay={120} closeDelay={80} open={ready && open} onOpenChange={setOpen}>
      <HoverCardTrigger asChild>{bar}</HoverCardTrigger>
      <HoverCardContent side="left" align="start" sideOffset={14} className="flex w-auto items-center gap-4 px-4 py-3.5" data-testid="length-donut">
        <Donut m={m} />
      </HoverCardContent>
    </HoverCard>
  )
}

function Donut({ m }: { m: MeterData }) {
  const over = isOver(m)
  const segs = [...m.parts.map((p) => ({ ...p, fill: partFill(p) })), ...m.others.map((o) => ({ ...o, color: null, fill: OTHER_GREY }))]
  const total = m.total ?? 0
  const R = 40
  const W = 13
  const C = 2 * Math.PI * R
  let off = 0
  return (
    <>
      <svg width="112" height="112" viewBox="0 0 112 112" className="shrink-0" aria-hidden>
        <circle r={R} cx="56" cy="56" fill="none" stroke="var(--line)" strokeWidth={W} />
        {total > 0 &&
          segs.map((s, i) => {
            const len = (s.n / total) * C
            const gap = segs.length > 1 && len > 3 ? 1.5 : 0
            const el = (
              <circle
                key={i}
                r={R}
                cx="56"
                cy="56"
                fill="none"
                stroke={over ? 'var(--danger)' : s.fill}
                strokeWidth={W}
                strokeDasharray={`${Math.max(0, len - gap)} ${C}`}
                strokeDashoffset={-off}
                transform="rotate(-90 56 56)"
              />
            )
            off += len
            return el
          })}
        <text x="56" y="54" textAnchor="middle" className="fill-ink-1 text-[16px] font-semibold data-[over]:fill-danger" data-over={over ? '' : undefined}>
          {total}
        </text>
        <text x="56" y="70" textAnchor="middle" className="fill-ink-3 text-[11px]">
          / {m.limit}
        </text>
      </svg>
      <div className="grid grid-cols-[9px_auto_auto] items-center gap-x-2 gap-y-[3px] text-[12px] text-ink-2">
        {m.parts.map((p, i) => (
          <Legend key={i} fill={partFill(p)} name={p.name} n={p.n} />
        ))}
        {m.others.length > 0 && <span className="col-span-3 my-[3px] h-px bg-line" />}
        {m.others.map((o, i) => (
          <Legend key={`o${i}`} fill={OTHER_GREY} name={o.name} n={o.n} />
        ))}
      </div>
    </>
  )
}

function Legend({ fill, name, n }: { fill: string; name: string; n: number }) {
  return (
    <>
      <i className="size-[9px] rounded-sm" style={{ background: fill }} />
      <span className="max-w-40 truncate">{name}</span>
      <span className="text-right text-[11px] text-ink-2 tabular-nums">{n}</span>
    </>
  )
}
