import { useMemo, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { ArrowDown01Icon, Cancel01Icon, Search01Icon, SquaresIntersectIcon, SquaresUniteIcon } from '@hugeicons/core-free-icons'
import { Icon } from '@/components/icon'
import { Tip } from '@/components/tip'
import { TagName } from '@/components/tag-name'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { emptyFacet, emptyFilters, facetActive, facetRows, toggleFacet, type Facet, type FacetKey } from '@/lib/gallery'
import { parsePrompt, toChip } from '@/lib/nai'
import { chipZh } from '@/lib/tagdb'
import { cn } from '@/lib/utils'
import { useGalleryUi } from '@/store/gallery'
import type { GenImage } from '@/store/gen'
import { FACET_KEYS, facetValues, passFilters } from './data'

const LABEL: Record<FacetKey, string> = { model: '模型', artist: '画师', character: '角色', tag: 'tag' }

export function FilterPills({ searched }: { searched: GenImage[] }) {
  const filters = useGalleryUi((s) => s.filters)
  const any = FACET_KEYS.some((k) => facetActive(filters[k]))
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1.5" data-testid="gallery-filters">
      {FACET_KEYS.map((k) => (
        <Pill key={k} k={k} facet={filters[k]} searched={searched} />
      ))}
      {any && (
        <button
          type="button"
          className="h-7 rounded-md px-2 text-[12px] text-ink-2 transition-colors duration-(--dur-fast) hover:bg-surface-2 hover:text-ink-1"
          onClick={() => useGalleryUi.getState().set({ filters: emptyFilters() })}
          data-testid="gallery-filters-clear"
        >
          清空
        </button>
      )}
    </div>
  )
}

const setFacet = (k: FacetKey, f: Facet) => {
  const ui = useGalleryUi.getState()
  ui.set({ filters: { ...ui.filters, [k]: f } })
}

function Pill({ k, facet, searched }: { k: FacetKey; facet: Facet; searched: GenImage[] }) {
  const [open, setOpen] = useState(false)
  const active = facetActive(facet)
  const n = facet.on.length + facet.off.length
  const summary = n === 1 ? `：${facet.on[0] ?? `-${facet.off[0]}`}` : n > 1 ? ` ${n}` : ''
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <div
        className={cn(
          'flex h-7 items-center rounded-md border text-[12px] shadow-xs transition-colors duration-(--dur-fast)',
          active ? 'border-transparent text-ink-1' : 'border-border bg-background text-ink-2 hover:bg-surface-2 hover:text-ink-1',
          open && !active && 'bg-surface-2 text-ink-1',
        )}
        style={active ? { background: 'color-mix(in srgb, var(--accent) 22%, var(--work))' } : undefined}
        data-active={active ? '' : undefined}
        data-testid={`gallery-pill-${k}`}
      >
        <PopoverTrigger asChild>
          <button type="button" className={cn('flex h-full max-w-56 items-center gap-1 pl-2.5', active ? 'pr-1' : 'pr-2')}>
            <span className="truncate">
              {LABEL[k]}
              <span className="tabular-nums">{summary}</span>
            </span>
            {!active && <Icon icon={ArrowDown01Icon} size={14} className="shrink-0 text-ink-2" />}
          </button>
        </PopoverTrigger>
        {active && (
          <button type="button" className="mr-0.5 grid size-5 place-items-center rounded-[4px] text-ink-2 hover:bg-[color-mix(in_srgb,var(--accent)_30%,var(--work))] hover:text-ink-1" onClick={() => setFacet(k, emptyFacet())} aria-label={`清除${LABEL[k]}筛选`} data-testid={`gallery-pill-${k}-clear`}>
            <Icon icon={Cancel01Icon} size={14} />
          </button>
        )}
      </div>
      <PopoverContent align="start" className="w-80 p-0" data-testid={`gallery-facet-${k}`}>
        {open && <FacetPanel k={k} facet={facet} searched={searched} />}
      </PopoverContent>
    </Popover>
  )
}

const zhOf = (k: FacetKey, v: string) => {
  if (k === 'model') return undefined
  const p = parsePrompt(k === 'artist' ? `artist:${v}` : v)[0]
  return p ? chipZh(toChip(p)) : undefined
}

function FacetPanel({ k, facet, searched }: { k: FacetKey; facet: Facet; searched: GenImage[] }) {
  const [q, setQ] = useState('')
  const filters = useGalleryUi((s) => s.filters)
  const all = useMemo(
    () =>
      facetRows(
        searched.filter((img) => passFilters(img, filters, k)).map((img) => facetValues(img, k)),
        k === 'model' ? { ...facet, any: true } : facet,
      ),
    [searched, filters, facet, k],
  )
  const shown = useMemo(() => {
    const t = q.trim().toLowerCase()
    return t ? all.filter(([v]) => v.includes(t) || zhOf(k, v)?.includes(t)) : all
  }, [all, q, k])
  const scroller = useRef<HTMLDivElement>(null)
  const v = useVirtualizer({ count: shown.length, getScrollElement: () => scroller.current, estimateSize: () => 28, overscan: 8 })
  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-2 border-b border-line p-2">
        <div className="relative min-w-0 flex-1">
          <Icon icon={Search01Icon} size={14} className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-ink-3" />
          <Input className="pl-8" placeholder={`搜索${LABEL[k]}`} value={q} onChange={(e) => setQ(e.target.value)} autoFocus data-testid="gallery-facet-search" />
        </div>
        {k !== 'model' && (
          <ToggleGroup type="single" value={facet.any ? 'any' : 'all'} onValueChange={(x) => x && setFacet(k, { ...facet, any: x === 'any' })} spacing={0.5} data-testid="gallery-facet-rule">
            <Tip label="包含全部选中项">
              <ToggleGroupItem value="all" size="sm" className="size-7 min-w-0 p-0 text-ink-2 aria-checked:bg-[color-mix(in_srgb,var(--accent)_24%,var(--work))] aria-checked:text-ink-1" aria-label="包含全部选中项" data-testid="gallery-facet-all">
                <Icon icon={SquaresIntersectIcon} size={16} />
              </ToggleGroupItem>
            </Tip>
            <Tip label="包含任一选中项">
              <ToggleGroupItem value="any" size="sm" className="size-7 min-w-0 p-0 text-ink-2 aria-checked:bg-[color-mix(in_srgb,var(--accent)_24%,var(--work))] aria-checked:text-ink-1" aria-label="包含任一选中项" data-testid="gallery-facet-any">
                <Icon icon={SquaresUniteIcon} size={16} />
              </ToggleGroupItem>
            </Tip>
          </ToggleGroup>
        )}
      </div>
      {shown.length ? (
        <div ref={scroller} className="max-h-[336px] overflow-y-auto py-1" data-testid="gallery-facet-list">
          <div className="relative" style={{ height: v.getTotalSize() }}>
            {v.getVirtualItems().map((r) => {
              const [value, count] = shown[r.index]
              const state = facet.on.includes(value) ? 'on' : facet.off.includes(value) ? 'off' : null
              return (
                <div
                  key={value}
                  role="option"
                  aria-selected={state === 'on'}
                  className="absolute inset-x-1 flex h-7 cursor-default items-center gap-2 rounded-[4px] px-2 text-[13px] hover:bg-surface-2"
                  style={{ top: r.start }}
                  onClick={() => setFacet(k, toggleFacet(facet, value, false))}
                  onContextMenu={(e) => (e.preventDefault(), setFacet(k, toggleFacet(facet, value, true)))}
                  data-state={state ?? undefined}
                  data-testid="gallery-facet-row"
                  data-value={value}
                >
                  {state === 'off' ? (
                    <span className="grid size-4 shrink-0 place-items-center rounded-[4px] bg-(--danger) text-white">
                      <Icon icon={Cancel01Icon} size={12} />
                    </span>
                  ) : (
                    <Checkbox checked={state === 'on'} tabIndex={-1} className="pointer-events-none" />
                  )}
                  <TagName en={value} zh={zhOf(k, value)} className={cn('min-w-0 flex-1 truncate', state === 'off' ? 'text-ink-2 line-through' : 'text-ink-1')} />
                  <span className="text-[11px] text-ink-2 tabular-nums">{count}</span>
                </div>
              )
            })}
          </div>
        </div>
      ) : (
        <p className="px-3 py-6 text-center text-[12px] text-ink-2">{q.trim() ? `未找到匹配「${q.trim()}」的${LABEL[k]}` : `暂无${LABEL[k]}`}</p>
      )}
      <div className="flex items-center gap-3 border-t border-line px-3 py-1.5 text-[11px] text-ink-2">
        <span>单击 选中</span>
        <span>右键 排除</span>
        <span className="ml-auto">Esc 关闭</span>
      </div>
    </div>
  )
}
