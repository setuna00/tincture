import { useEffect, useMemo, type ReactNode } from 'react'
import { Cancel01Icon } from '@hugeicons/core-free-icons'
import { LightboxButton } from '@/components/artist-media'
import { Icon } from '@/components/icon'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { imageUrl, useGen, useSelectedImage, useShownHistory, type GenImage } from '@/store/gen'
import { useNai } from '@/store/nai'
import { useLightbox } from '@/store/right-panel'
import { useVersions } from '@/store/versions'
import { MissingFile } from '@/components/gallery/missing'
import { badgeOf } from './action-meta'
import { canDragOut, dragOutProps } from './drag-out'
import { historyOrder } from './history-nav'
import { transparencyStyle, useZoomPan } from './zoom-pan'

export function GenLightbox({ docId }: { docId: string }) {
  const open = useLightbox((s) => s.open)
  const img = useSelectedImage(docId)
  useEffect(() => {
    if (open && !img) useLightbox.setState({ open: false })
  }, [open, img])
  return (
    <Dialog open={open && !!img} onOpenChange={(o) => !o && useLightbox.setState({ open: false })}>
      {img && <Body docId={docId} />}
    </Dialog>
  )
}

function Stage({ img, onClose, testId }: { img: GenImage; onClose: () => void; testId: string }) {
  const { box, fit, transform, handlers, moved, zoomed } = useZoomPan({ wheel: true, drag: true, dragOutAtFit: canDragOut })
  const bg = useNai((s) => s.transparencyBg)
  const color = useNai((s) => s.transparencyColor)
  return (
    <div
      ref={box}
      className="absolute inset-0 overflow-hidden"
      {...handlers}
      onClick={(e) => !moved.current && !(e.target as HTMLElement).closest('img') && onClose()}
      data-testid={`${testId}-stage`}
    >
      <div ref={fit} className="absolute inset-[6dvh_6vw] grid place-items-center" style={{ containerType: 'size' }}>
        <img
          src={imageUrl(img)}
          alt=""
          draggable={false}
          {...(zoomed ? {} : dragOutProps(() => [img]))}
          className="max-w-none animate-in rounded-sm duration-150 fade-in-0 select-none"
          style={{
            aspectRatio: `${img.width} / ${img.height}`,
            width: `min(100cqw, calc(100cqh * ${(img.width / img.height).toFixed(5)}), ${img.width}px)`,
            ...transparencyStyle(bg, color),
            transform,
          }}
          data-testid={`${testId}-image`}
          data-id={img.id}
        />
      </div>
    </div>
  )
}

function Body({ docId }: { docId: string }) {
  const img = useSelectedImage(docId)!
  const list = useShownHistory(docId)
  const versions = useVersions((s) => s.byDoc[docId])
  const order = useMemo(() => historyOrder(list ?? [], versions), [list, versions])
  const at = order.findIndex((x) => x.id === img.id)
  const v = img.versionId ? versions?.find((x) => x.id === img.versionId) : undefined
  const badge = badgeOf(img)
  return (
    <LightboxContent
      items={order}
      at={at}
      onPick={(next) => useGen.getState().select(docId, next.id)}
      onClose={() => useLightbox.setState({ open: false })}
      caption={
        <>
          {v && <span className="font-semibold">v{v.n}</span>}
          {badge && (
            <span className="flex items-center gap-1">
              <Icon icon={badge.icon} size={14} />
              {badge.name}
            </span>
          )}
        </>
      }
    />
  )
}

export function LightboxContent({ items, at, onPick, onClose, caption, testId = 'gen-lightbox' }: { items: GenImage[]; at: number; onPick: (img: GenImage) => void; onClose: () => void; caption?: ReactNode; testId?: string }) {
  const img = items[at]
  const n = items.length
  const step = (d: number) => {
    if (n < 2) return
    onPick(items[(at + d + n) % n])
  }
  useEffect(() => {
    document.documentElement.dataset.dim = ''
    return () => void delete document.documentElement.dataset.dim
  }, [])
  if (!img) return null
  return (
    <DialogContent
      showCloseButton={false}
      overlayClassName="bg-black/80 supports-backdrop-filter:backdrop-blur-xs"
      className="inset-0 top-0 left-0 block h-dvh w-screen max-w-none translate-x-0 translate-y-0 rounded-none bg-transparent p-0 ring-0 duration-200 sm:max-w-none"
      onEscapeKeyDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === 'ArrowLeft') step(-1)
        else if (e.key === 'ArrowRight') step(1)
      }}
      data-testid={testId}
    >
      <DialogTitle className="sr-only">看大图</DialogTitle>
      <DialogDescription className="sr-only">左右方向键翻页，滚轮缩放，Esc 关闭</DialogDescription>
      {img.missing ? (
        <div className="absolute inset-0 grid place-items-center" onClick={(e) => e.target === e.currentTarget && onClose()} data-testid={`${testId}-stage`}>
          <MissingFile dark className="h-60 w-80 bg-white/8" />
        </div>
      ) : (
        <Stage key={img.id} img={img} onClose={onClose} testId={testId} />
      )}
      {n > 1 && (
        <>
          <LightboxButton side="left" onClick={() => step(-1)} />
          <LightboxButton side="right" onClick={() => step(1)} />
        </>
      )}
      <span
        className="absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-1.5 rounded bg-black/60 px-2 py-0.5 text-[12px] whitespace-nowrap text-white tabular-nums"
        data-testid="lightbox-counter"
      >
        {caption}
        <span>
          {at + 1} / {n}
        </span>
      </span>
      <button
        type="button"
        className="absolute top-[calc(1rem+var(--wco-h))] right-4 grid size-9 place-items-center rounded-full bg-black/45 text-white transition-colors hover:bg-black/70"
        onClick={onClose}
        aria-label="关闭"
        data-testid="lightbox-close"
      >
        <Icon icon={Cancel01Icon} size={16} />
      </button>
    </DialogContent>
  )
}
