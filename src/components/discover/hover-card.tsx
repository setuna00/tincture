import { useEffect, useMemo, type ReactNode } from 'react'
import { create } from 'zustand'
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover'
import { AutoHeight } from '@/components/wiki-gloss'
import type { Catalog } from '@/lib/discover'
import { useDiscover } from '@/store/discover'
import type { RowTag } from './data'
import { InfoCard } from './info-card'

const OPEN_DELAY = 450
const SWITCH_DELAY = 120
const CLOSE_DELAY = 160

interface HoverState {
  el: HTMLElement | null
  t: RowTag | null
  open: boolean
  switching: boolean
}
const useHover = create<HoverState>(() => ({ el: null, t: null, open: false, switching: false }))
let timer: ReturnType<typeof setTimeout> | undefined
let switchTimer: ReturnType<typeof setTimeout> | undefined

export function hoverIn(el: HTMLElement, t: RowTag) {
  const d = useDiscover.getState()
  if (d.selected.length || d.drag) return
  clearTimeout(timer)
  const s = useHover.getState()
  if (s.open) {
    if (s.el === el) return
    timer = setTimeout(() => {
      clearTimeout(switchTimer)
      useHover.setState({ el, t, switching: true })
      switchTimer = setTimeout(() => useHover.setState({ switching: false }), 220)
    }, SWITCH_DELAY)
  } else timer = setTimeout(() => useHover.setState({ el, t, open: true, switching: false }), OPEN_DELAY)
}
export function hoverOut() {
  clearTimeout(timer)
  timer = setTimeout(() => useHover.setState({ open: false }), CLOSE_DELAY)
}
export function hoverDetached() {
  const { el } = useHover.getState()
  if (el && !el.isConnected) hoverClose()
}
export function hoverClose() {
  clearTimeout(timer)
  if (useHover.getState().open) useHover.setState({ open: false })
}

export function HoverCard({ catalog, usage, official, unknown }: { catalog: Catalog; usage: Map<string, string[]>; official: (t: RowTag) => string; unknown: (t: RowTag) => ReactNode }) {
  const { el, t, open, switching } = useHover()
  // Radix repositions when the anchor object changes; give each hovered row a new anchor object.
  const anchor = useMemo(() => {
    let last: DOMRect | null = null
    return {
      current: {
        getBoundingClientRect: () => {
          if (el?.isConnected) last = el.getBoundingClientRect()
          return last ?? new DOMRect()
        },
      },
    }
  }, [el])
  useEffect(() => () => clearTimeout(timer), [])
  if (!t || !el) return null
  return (
    <Popover open={open} onOpenChange={(o) => !o && hoverClose()}>
      <PopoverAnchor virtualRef={anchor} />
      <PopoverContent
        side="right"
        align="start"
        sideOffset={8}
        collisionPadding={12}
        className="w-80 p-0"
        onOpenAutoFocus={(e) => e.preventDefault()}
        onCloseAutoFocus={(e) => e.preventDefault()}
        onPointerEnter={() => clearTimeout(timer)}
        onPointerLeave={hoverOut}
        data-locate-keep=""
        data-discover-card=""
        data-switching={switching ? '' : undefined}
      >
        <AutoHeight>
          <div key={t.name} className="page-in p-3">
            {t.kind === 'unknown' ? unknown(t) : <InfoCard t={t} catalog={catalog} used={usage.get(official(t))} />}
          </div>
        </AutoHeight>
      </PopoverContent>
    </Popover>
  )
}
