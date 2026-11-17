import { useEffect, useState } from 'react'
import { Add01Icon, Album02Icon, ArrowLeft01Icon, ArrowRight01Icon, Cancel01Icon, CloudOffIcon, FolderAddIcon, ImageNotFound01Icon, StarIcon } from '@hugeicons/core-free-icons'
import { Icon } from '@/components/icon'
import { Button } from '@/components/ui/button'
import { ContextMenuCheckboxItem, ContextMenuItem, ContextMenuSeparator } from '@/components/ui/context-menu'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Tip } from '@/components/tip'
import { cardTier, galleryFits720, imageId, postMd5 } from '@/lib/artist-image-core'
import { pickLocal, saveImage, touchImage, useLocalImages, useLocalSpares } from '@/lib/artist-image-cache'
import { placeholderStyle } from '@/lib/artist-images'
import { cardCell, galleryShown, gallerySrc, postSrcSet, shownWidth, type DanbooruPost } from '@/lib/danbooru-core'
import { useAfterMenu } from '@/components/after-menu'
import { FAV_COLLECTION, isFavArtist, useLibrary } from '@/store/library'

/** Danbooru CDN rejects requests without a Referer; retain the browser default referrer policy. */
export function FadeImg({
  src,
  srcSet,
  sizes,
  alt,
  className = '',
  fallback = 'icon',
  onLoad,
  onError,
}: {
  src: string
  srcSet?: string
  sizes?: string
  alt: string
  className?: string
  fallback?: 'icon' | 'text' | 'none'
  onLoad?: () => void
  onError?: () => void
}) {
  const [state, setState] = useState<'loading' | 'ok' | 'error'>('loading')
  const [failed, setFailed] = useState<string | null>(null)
  if (failed === src && fallback !== 'none')
    return (
      <Tip label="无法加载图片">
        <span className={`fade-img-fail ${className}`} data-testid="img-fail">
          <Icon icon={ImageNotFound01Icon} size={fallback === 'text' ? 22 : 16} />
          {fallback === 'text' && <span>无法加载图片</span>}
        </span>
      </Tip>
    )
  return (
    <img
      src={src}
      srcSet={srcSet}
      sizes={sizes}
      alt={alt}
      loading="lazy"
      decoding="async"
      draggable={false}
      onLoad={() => (setState('ok'), onLoad?.())}
      onError={() => (setState('error'), setFailed(src), onError?.())}
      data-state={state}
      className={`fade-img ${className}`}
    />
  )
}

export function ArtistMedia({
  name,
  posts,
  pool,
  loading,
  failed = false,
  width,
  onOpen,
  className = '',
}: {
  name: string
  posts: DanbooruPost[]
  pool?: DanbooruPost[]
  loading: boolean
  failed?: boolean
  width: number
  onOpen?: (i: number) => void
  className?: string
}) {
  const [down, setDown] = useState<number[]>([])
  const spares = useLocalSpares(pool ?? [], posts, down.length > 0)
  let k = 0
  const cells = posts.map((p) => (down.includes(p.id) && k < spares.length ? spares[k++] : p))
  const onDown = (id: number) => setDown((d) => (d.includes(id) ? d : [...d, id]))
  if (posts.length)
    return (
      <div className={`artist-media bg-surface-2 ${className}`} data-count={posts.length} data-testid="artist-media">
        {cells.map((p, i) => {
          const [w, h] = cardCell(posts.length, i, width)
          const img = <CardImg key={p.id} p={p} name={name} w={w} h={h} onDown={onDown} />
          if (!onOpen) return img
          return (
            <button key={p.id} type="button" className="block cursor-zoom-in overflow-hidden transition-opacity duration-(--dur-fast) hover:opacity-85" onClick={() => onOpen(i)} aria-label={`放大第 ${i + 1} 张`} data-testid="artist-media-open">
              {img}
            </button>
          )
        })}
      </div>
    )
  if (loading) return <div className={`artist-media bg-surface-2 ${className}`} data-count={1} data-loading="" data-testid="artist-media" />
  if (failed)
    return (
      <Tip label="无法连接 Danbooru">
        <div className={`artist-media ${className}`} data-count={1} data-failed="" data-testid="artist-media">
          <span className="fade-img-fail">
            <Icon icon={CloudOffIcon} size={18} />
          </span>
        </div>
      </Tip>
    )
  return (
    <div className={`artist-media grid place-items-end p-2 text-[13px] font-bold text-white/90 ${className}`} data-count={1} data-placeholder="" style={placeholderStyle(name)} data-testid="artist-media">
      {name.slice(0, 2).toUpperCase()}
    </div>
  )
}

function CardImg({ p, name, w, h, onDown }: { p: DanbooruPost; name: string; w: number; h: number; onDown: (id: number) => void }) {
  const shown = shownWidth(p, w, h, 'cover')
  const tier = cardTier(p, shown, window.devicePixelRatio || 1)
  const md5 = postMd5(p)
  const ready = useLocalImages(md5 ? [imageId(md5, 360), imageId(md5, 720)] : [])
  const [cdnFailed, setCdnFailed] = useState(false)
  const local = md5 ? (pickLocal(md5, tier === 360 ? [360, 720] : [720]) ?? (cdnFailed ? pickLocal(md5, [360]) : undefined)) : undefined
  const localId = local?.id
  useEffect(() => {
    if (localId) touchImage(localId, name)
  }, [localId, name])
  const cls = 'h-full w-full object-cover'
  if (!ready) return <span />
  if (local) return <FadeImg src={local.url} alt="" className={cls} />
  return (
    <FadeImg
      src={p.thumb}
      srcSet={postSrcSet(p, { thumb: true, large: true })}
      sizes={`${shown}px`}
      alt=""
      className={cls}
      onLoad={() => saveImage(p, tier, name)}
      onError={() => {
        setCdnFailed(true)
        if (!md5 || !pickLocal(md5, [360, 720])) onDown(p.id)
      }}
    />
  )
}

export function GalleryImg({ p, name }: { p: DanbooruPost; name: string }) {
  const md5 = postMd5(p)
  const ready = useLocalImages(md5 ? [imageId(md5, 720), imageId(md5, 360)] : [])
  const [cdnFailed, setCdnFailed] = useState(false)
  const l720 = md5 ? pickLocal(md5, [720]) : undefined
  const local = l720 ?? (md5 && cdnFailed ? pickLocal(md5, [360]) : undefined)
  const localId = local?.id
  useEffect(() => {
    if (localId) touchImage(localId, name)
  }, [localId, name])
  const cls = 'h-full w-full object-contain'
  if (!ready) return null
  if (l720 && !galleryFits720(p, galleryShown(p), window.devicePixelRatio || 1))
    return (
      <>
        <FadeImg src={l720.url} alt="" className={`absolute inset-0 ${cls}`} fallback="text" />
        <FadeImg src={p.large} {...gallerySrc(p)} alt="" className={`absolute inset-0 ${cls}`} fallback="none" />
      </>
    )
  if (local) return <FadeImg src={local.url} alt="" className={cls} fallback="text" />
  return <FadeImg src={p.large} {...gallerySrc(p)} alt="" className={cls} fallback="text" onError={() => setCdnFailed(true)} />
}

export function Lightbox({ name, posts, start, onClose }: { name: string; posts: DanbooruPost[]; start: number; onClose: (i: number) => void }) {
  const [i, setI] = useState(start)
  const n = posts.length
  const p = posts[i]
  const step = (d: number) => setI((x) => (x + d + n) % n)
  const frameW = Math.round(Math.min(window.innerWidth * 0.88, window.innerHeight * 0.88 * (p.w / p.h), p.w))
  useEffect(() => {
    document.documentElement.dataset.dim = ''
    return () => void delete document.documentElement.dataset.dim
  }, [])
  return (
    <Dialog open onOpenChange={(o) => !o && onClose(i)}>
      <DialogContent
        showCloseButton={false}
        overlayClassName="bg-black/80 supports-backdrop-filter:backdrop-blur-xs"
        className="inset-0 top-0 left-0 grid h-dvh w-screen max-w-none translate-x-0 translate-y-0 place-items-center rounded-none bg-transparent p-0 ring-0 duration-200 sm:max-w-none"
        onClick={(e) => e.target === e.currentTarget && onClose(i)}
        onEscapeKeyDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'ArrowLeft') step(-1)
          else if (e.key === 'ArrowRight') step(1)
        }}
        data-testid="artist-lightbox"
      >
        <DialogTitle className="sr-only">{name} 的作品</DialogTitle>
        <DialogDescription className="sr-only">左右方向键翻页，Esc 关闭</DialogDescription>
        <div
          key={p.id}
          className="relative overflow-hidden rounded-md"
          style={{ aspectRatio: `${p.w} / ${p.h}`, width: `min(88vw, calc(88dvh * ${p.w / p.h}), ${p.w}px)` }}
          data-testid="lightbox-frame"
        >
          <img src={p.large} {...gallerySrc(p)} alt="" className="absolute inset-0 h-full w-full object-contain" draggable={false} />
          <FadeImg src={p.sample ?? p.large} srcSet={postSrcSet(p, { large: true, sample: true, orig: true })} sizes={`${frameW}px`} alt="" className="absolute inset-0 h-full w-full object-contain" fallback="none" />
        </div>
        {n > 1 && (
          <>
            <LightboxButton side="left" onClick={() => step(-1)} />
            <LightboxButton side="right" onClick={() => step(1)} />
          </>
        )}
        <span className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded bg-black/60 px-2 py-0.5 text-[12px] text-white tabular-nums" data-testid="lightbox-counter">
          {i + 1} / {n}
        </span>
        <button
          type="button"
          className="absolute top-[calc(1rem+var(--wco-h))] right-4 grid size-9 place-items-center rounded-full bg-black/45 text-white transition-colors hover:bg-black/70"
          onClick={() => onClose(i)}
          aria-label="关闭"
          data-testid="lightbox-close"
        >
          <Icon icon={Cancel01Icon} size={16} />
        </button>
      </DialogContent>
    </Dialog>
  )
}

export function LightboxButton({ side, onClick }: { side: 'left' | 'right'; onClick: () => void }) {
  return (
    <button
      type="button"
      className={`absolute top-1/2 grid size-11 -translate-y-1/2 place-items-center rounded-full bg-black/45 text-white transition-colors hover:bg-black/70 ${side === 'left' ? 'left-4' : 'right-4'}`}
      onClick={onClick}
      aria-label={side === 'left' ? '上一张' : '下一张'}
      data-testid={side === 'left' ? 'lightbox-prev' : 'lightbox-next'}
    >
      <Icon icon={side === 'left' ? ArrowLeft01Icon : ArrowRight01Icon} size={18} />
    </button>
  )
}

export function CollectionIcon({ id, size }: { id: string; size?: number }) {
  return <Icon icon={id === FAV_COLLECTION ? StarIcon : Album02Icon} size={size} />
}

export function CollectionChecklist({
  name,
  Item,
  Separator,
  NewItem,
  onNew,
}: {
  name: string
  Item: typeof ContextMenuCheckboxItem | typeof DropdownMenuCheckboxItem
  Separator: typeof ContextMenuSeparator | typeof DropdownMenuSeparator
  NewItem: typeof ContextMenuItem | typeof DropdownMenuItem
  onNew: () => void
}) {
  const collections = useLibrary((s) => s.artistCollections)
  return (
    <>
      {collections.map((c) => (
        <Item
          key={c.id}
          checked={c.items.some((x) => x.name === name)}
          onSelect={(e: Event) => {
            e.preventDefault()
            useLibrary.getState().toggleInCollection(c.id, name)
          }}
          className="text-[13px]"
          data-testid="collection-check"
        >
          <CollectionIcon id={c.id} />
          <span className="truncate">{c.title}</span>
        </Item>
      ))}
      <Separator />
      <NewItem onSelect={onNew} className="text-[13px]" data-testid="collection-check-new">
        <Icon size={14} icon={Add01Icon} />
        新建合集
      </NewItem>
    </>
  )
}

export function FavButton({ name, testId, hotkey }: { name: string; testId: string; hotkey?: string }) {
  const on = useLibrary((s) => isFavArtist(s, name))
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="outline"
          size="icon"
          className={`size-7 ${on ? 'fav-on hover:text-(--fav)' : 'text-ink-2'}`}
          onClick={() => useLibrary.getState().toggleInCollection(FAV_COLLECTION, name)}
          aria-label={on ? `取消收藏 ${name}` : `收藏 ${name}`}
          aria-pressed={on}
          data-testid={testId}
        >
          <Icon icon={StarIcon} size={16} />
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        {on ? '取消收藏' : '收藏'}
        {hotkey && `（${hotkey}）`}
      </TooltipContent>
    </Tooltip>
  )
}

export function CollectionsButton({ name, testId, onNewCollection }: { name: string; testId: string; onNewCollection: () => void }) {
  const menu = useAfterMenu()
  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="icon" className="size-7 text-ink-2" aria-label="加入合集" data-testid={testId}>
              <Icon icon={FolderAddIcon} size={16} />
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>加入合集</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end" className="w-44" onCloseAutoFocus={menu.onCloseAutoFocus} onEscapeKeyDown={(e) => e.stopPropagation()}>
        <DropdownMenuLabel className="text-ink-3">加入合集</DropdownMenuLabel>
        <CollectionChecklist name={name} Item={DropdownMenuCheckboxItem} Separator={DropdownMenuSeparator} NewItem={DropdownMenuItem} onNew={() => menu.later(onNewCollection)} />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
