import { useEffect, useRef, useState } from 'react'
import { useHotkeys } from 'react-hotkeys-hook'
import { ArrowLeft01Icon } from '@hugeicons/core-free-icons'
import { Icon } from '@/components/icon'
import { Button } from '@/components/ui/button'
import { dragOutProps } from '@/components/gen/drag-out'
import { fitStyle, transparencyStyle, useZoomPan } from '@/components/gen/zoom-pan'
import { thumbUrl } from '@/lib/thumbs'
import { cn } from '@/lib/utils'
import { useGalleryUi } from '@/store/gallery'
import { imageUrl, type GenImage } from '@/store/gen'
import { useNai } from '@/store/nai'
import { usePrefs } from '@/store/prefs'
import { overlayOpen, RIGHT_EDGE_PR } from './data'
import { MissingFile } from './missing'
import { Zoom } from './detail'

const back = () => useGalleryUi.getState().set({ viewing: null })

export function ViewerBar({ items, id }: { items: GenImage[]; id: string }) {
  const i = items.findIndex((x) => x.id === id)
  const rightOpen = usePrefs((s) => s.galleryRightOpen)
  return (
    <header className={cn('app-drag flex items-center gap-2 pt-5 pb-2.5 pl-6', rightOpen ? 'pr-6' : RIGHT_EDGE_PR)} data-testid="gallery-viewer-bar">
      <Button variant="ghost" size="sm" className="-ml-2 h-7 gap-1 text-[13px] text-ink-2" onClick={back} data-testid="gallery-viewer-back">
        <Icon icon={ArrowLeft01Icon} size={14} />
        返回
      </Button>
      <span className="text-[13px] text-ink-2 tabular-nums" data-testid="gallery-viewer-index">
        {i + 1} / {items.length}
      </span>
    </header>
  )
}

export function GalleryViewer({ items, id }: { items: GenImage[]; id: string }) {
  const [zoom, setZoom] = useState(false)
  const pick = (id: string) => useGalleryUi.getState().set({ viewing: id, selected: [id], anchor: id, cursor: id })
  const i = items.findIndex((x) => x.id === id)
  const img = items[i]
  const go = (d: number) => {
    if (overlayOpen()) return
    const next = items[i + d]
    if (next) useGalleryUi.getState().set({ viewing: next.id, selected: [next.id], anchor: next.id, cursor: next.id })
  }
  useHotkeys('left', (e) => (e.preventDefault(), go(-1)), [items, i])
  useHotkeys('right', (e) => (e.preventDefault(), go(1)), [items, i])
  useHotkeys(['escape', 'enter', 'space'], (e) => !overlayOpen() && (e.preventDefault(), back()))
  if (!img) return null
  return (
    <div className="page-in absolute inset-0">
      <Stage key={img.id} img={img} onZoom={() => setZoom(true)} />
      <Zoom items={items} id={zoom ? id : null} onPick={pick} onClose={() => setZoom(false)} />
    </div>
  )
}

function Stage({ img, onZoom }: { img: GenImage; onZoom: () => void }) {
  const { box, fit, zoomed, panning, transform, handlers, moved } = useZoomPan()
  const clickTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const cancelClick = () => {
    if (clickTimer.current) clearTimeout(clickTimer.current)
    clickTimer.current = null
  }
  useEffect(() => () => {
    if (clickTimer.current) clearTimeout(clickTimer.current)
  }, [])
  const bg = useNai((s) => s.transparencyBg)
  const color = useNai((s) => s.transparencyColor)
  const [full, setFull] = useState(false)
  if (img.missing)
    return (
      <div ref={box} className="absolute inset-0 overflow-hidden" data-testid="gallery-viewer">
        <div ref={fit} className="absolute inset-x-6 top-1 bottom-6 grid place-items-center">
          <MissingFile className="h-60 w-80" />
        </div>
      </div>
    )
  const small = thumbUrl(img.id)
  const style = { ...fitStyle(img.width, img.height, true), transform }
  return (
    <div
      ref={box}
      className={cn('absolute inset-0 overflow-hidden', panning && 'cursor-grabbing')}
      {...handlers}
      onPointerDown={(e) => { cancelClick(); handlers.onPointerDown(e) }}
      onDoubleClick={() => { cancelClick(); handlers.onDoubleClick() }}
      data-zoomed={zoomed ? '' : undefined}
      data-testid="gallery-viewer"
    >
      <div ref={fit} className="absolute inset-x-6 top-1 bottom-6 grid place-items-center" style={{ containerType: 'size' }}>
        <div className="relative max-w-none" style={style} {...(zoomed ? {} : dragOutProps(() => [img]))}>
          {small && !full && <img src={small} alt="" draggable={false} className="absolute inset-0 size-full rounded-sm select-none" />}
          <img
            src={imageUrl(img)}
            alt=""
            draggable={false}
            decoding="async"
            className={cn('relative size-full rounded-sm select-none', panning ? 'cursor-grabbing' : zoomed ? 'cursor-grab' : 'cursor-zoom-in')}
            onClick={(e) => {
              if (e.button !== 0 || e.shiftKey || moved.current) return
              cancelClick()
              if (!zoomed) onZoom()
              else if (e.detail < 2) clickTimer.current = setTimeout(onZoom, 250)
            }}
            style={{ ...transparencyStyle(bg, color), opacity: full || !small ? 1 : 0 }}
            onLoad={() => setFull(true)}
            data-testid="gallery-viewer-image"
            data-id={img.id}
          />
        </div>
      </div>
    </div>
  )
}
