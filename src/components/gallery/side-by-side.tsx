import { useLayoutEffect, useRef, useState } from 'react'
import { useHotkeys } from 'react-hotkeys-hook'
import { ArrowLeft01Icon, Cancel01Icon } from '@hugeicons/core-free-icons'
import { Icon } from '@/components/icon'
import { Tip } from '@/components/tip'
import { Button } from '@/components/ui/button'
import { tileLayout } from '@/lib/gallery-stacks'
import { thumbUrl } from '@/lib/thumbs'
import { cn } from '@/lib/utils'
import { useGalleryUi } from '@/store/gallery'
import { imageUrl, type GenImage } from '@/store/gen'
import { usePrefs } from '@/store/prefs'
import { overlayOpen, RIGHT_EDGE_PR, useGalleryNamer } from './data'

const close = () => useGalleryUi.getState().set({ side: null })

export function SideBar({ shown, total }: { shown: number; total: number }) {
  const rightOpen = usePrefs((s) => s.galleryRightOpen)
  return (
    <header className={cn('app-drag flex items-center gap-2 pt-5 pb-2.5 pl-6', rightOpen ? 'pr-6' : RIGHT_EDGE_PR)} data-testid="gallery-side-bar">
      <Button variant="ghost" size="sm" className="-ml-2 h-7 gap-1 text-[13px] text-ink-2" onClick={close} data-testid="gallery-side-back">
        <Icon icon={ArrowLeft01Icon} size={14} />
        返回
      </Button>
      <span className="text-[13px] font-medium text-ink-1">并排看</span>
      <span className="text-[13px] text-ink-2 tabular-nums" data-testid="gallery-side-count">
        {total > shown ? `前 ${shown} 张 / 已选 ${total} 张` : `${shown} 张`}
      </span>
    </header>
  )
}

export function SideBySide({ imgs }: { imgs: GenImage[] }) {
  const namer = useGalleryNamer()
  const stage = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })
  useLayoutEffect(() => {
    const el = stage.current
    if (!el) return
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const [view, setView] = useState({ z: 1, x: 0, y: 0 })
  const pan = useRef<{ x: number; y: number; ox: number; oy: number; w: number; h: number } | null>(null)
  useHotkeys('escape', (e) => !overlayOpen() && (e.preventDefault(), close()))
  useHotkeys('shift+space', (e) => !overlayOpen() && (e.preventDefault(), close()))
  useLayoutEffect(() => {
    const el = stage.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return
      e.preventDefault()
      const cell = (e.target as HTMLElement).closest<HTMLElement>('[data-side-cell]')
      setView((v) => {
        const z = Math.min(16, Math.max(1, v.z * (e.deltaY < 0 ? 1.15 : 1 / 1.15)))
        if (z === 1) return { z, x: 0, y: 0 }
        if (!cell) return { ...v, z }
        const r = cell.getBoundingClientRect()
        const u = (e.clientX - r.left) / r.width - 0.5
        const w = (e.clientY - r.top) / r.height - 0.5
        return { z, x: u - (u - v.x) * (z / v.z), y: w - (w - v.y) * (z / v.z) }
      })
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])
  const tiles = tileLayout(
    imgs.map((x) => ({ w: x.width, h: x.height })),
    Math.max(0, size.w - 48),
    Math.max(0, size.h - 28),
    10,
  )
  const remove = (id: string) => {
    const ui = useGalleryUi.getState()
    const side = (ui.side ?? []).filter((x) => x !== id)
    ui.set({ side: side.length > 1 ? side : null, selected: ui.selected.filter((x) => x !== id) })
  }
  return (
    <div
      ref={stage}
      className="page-in absolute inset-0 overflow-hidden"
      onPointerDown={(e) => {
        if (!e.shiftKey || e.button !== 0) return
        const cell = (e.target as HTMLElement).closest<HTMLElement>('[data-side-cell]')
        if (!cell) return
        const r = cell.getBoundingClientRect()
        pan.current = { x: e.clientX, y: e.clientY, ox: view.x, oy: view.y, w: r.width, h: r.height }
        e.currentTarget.setPointerCapture(e.pointerId)
      }}
      onPointerMove={(e) => {
        const p = pan.current
        if (!p) return
        setView((v) => ({ ...v, x: p.ox + (e.clientX - p.x) / p.w, y: p.oy + (e.clientY - p.y) / p.h }))
      }}
      onPointerUp={() => (pan.current = null)}
      onPointerCancel={() => (pan.current = null)}
      data-zoomed={view.z > 1 ? '' : undefined}
      data-testid="gallery-side"
    >
      {tiles.map((t) => {
        const img = imgs[t.index]
        return (
          <div
            key={img.id}
            className="group absolute overflow-hidden rounded-md bg-surface-2 transition-[left,top,width,height] duration-200 ease-(--ease-out)"
            style={{ left: 24 + t.x, top: 4 + t.y, width: t.w, height: t.h }}
            onDoubleClick={() => useGalleryUi.getState().set({ viewing: img.id, selected: [img.id], anchor: img.id, cursor: img.id })}
            data-side-cell=""
            data-id={img.id}
            data-testid="gallery-side-cell"
          >
            <Picture img={img} transform={`translate(${view.x * t.w}px, ${view.y * t.h}px) scale(${view.z})`} />
            <span className="pointer-events-none absolute bottom-1.5 left-1.5 flex h-5 items-center rounded-[5px] bg-[oklch(0_0_0/0.42)] px-1.5 text-[11px] font-semibold text-white tabular-nums opacity-0 transition-opacity duration-150 group-hover:opacity-100">
              {namer.image(img)}
            </span>
            <Tip label="移除">
              <button
                type="button"
                className="absolute top-1.5 right-1.5 grid size-6 place-items-center rounded-md bg-[oklch(0_0_0/0.42)] text-white opacity-0 transition-[opacity,background-color] duration-150 group-hover:opacity-100 hover:bg-[oklch(0_0_0/0.62)]"
                onPointerDown={(e) => e.stopPropagation()}
                onDoubleClick={(e) => e.stopPropagation()}
                onClick={() => remove(img.id)}
                aria-label="移除"
                data-testid="gallery-side-remove"
              >
                <Icon icon={Cancel01Icon} size={14} />
              </button>
            </Tip>
          </div>
        )
      })}
    </div>
  )
}

function Picture({ img, transform }: { img: GenImage; transform: string }) {
  const [full, setFull] = useState(false)
  const small = thumbUrl(img.id)
  return (
    <div className="absolute inset-0 will-change-transform" style={{ transform, transformOrigin: 'center' }}>
      {small && !full && <img src={small} alt="" draggable={false} className="absolute inset-0 size-full object-contain select-none" />}
      <img src={imageUrl(img)} alt="" draggable={false} decoding="async" className="relative size-full object-contain select-none" style={{ opacity: full || !small ? 1 : 0 }} onLoad={() => setFull(true)} data-testid="gallery-side-image" />
    </div>
  )
}
