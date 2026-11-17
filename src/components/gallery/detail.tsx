import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { ArrowUpRight01Icon, Copy01Icon, Delete02Icon, Download04Icon, FolderAddIcon, LayoutTwoColumnIcon, RestoreBinIcon, SidebarRightIcon, StarIcon, Tick02Icon } from '@hugeicons/core-free-icons'
import { useAfterMenu } from '@/components/after-menu'
import { useDraftField } from '@/components/draft-field'
import { Icon } from '@/components/icon'
import { PaneHeader } from '@/components/assistant/panel'
import { Tip } from '@/components/tip'
import { Button } from '@/components/ui/button'
import { Carousel, CarouselContent, CarouselItem, CarouselNext, CarouselPrevious, type CarouselApi } from '@/components/ui/carousel'
import { Dialog } from '@/components/ui/dialog'
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { dragOutProps } from '@/components/gen/drag-out'
import { LightboxContent } from '@/components/gen/lightbox'
import { copyImage, downloadImage, SAVE_LABEL } from '@/components/gen/image-io'
import { SIDE_MAX, type Entry, type Stack } from '@/lib/gallery-stacks'
import { formatTime } from '@/lib/format-time'
import { thumbUrl, wantThumb } from '@/lib/thumbs'
import { cn } from '@/lib/utils'
import { IMPORTED, openImage, purgeImages, restoreImages, toggleFav, trashImages, useGalleryUi, useMarks } from '@/store/gallery'
import { renameImage, renameStack } from '@/store/gallery-names'
import { imageBlob, imageUrl, type GenImage } from '@/store/gen'
import { usePrefs } from '@/store/prefs'
import { openSide, selectedStack, useGalleryNamer } from './data'
import { MissingFile } from './missing'
import { DirChoices } from './dirs'
import { ImageParams, ImagePrompts, ImageProps, InfoSection } from './image-info'

export function GalleryDetail({ all, entries, scopeLabel, scopeCount }: { all: GenImage[]; entries: Entry[]; scopeLabel: string; scopeCount: number }) {
  const selected = useGalleryUi((s) => s.selected)
  const picked = useMemo(() => {
    const set = new Set(selected)
    return all.filter((x) => set.has(x.id))
  }, [all, selected])
  const n = picked.length
  const inStack = useGalleryUi((s) => s.inStack)
  const stack = useMemo(() => selectedStack(entries, selected) ?? (!selected.length && inStack ? (entries.find((e) => e.kind === 'stack' && e.stack.key === inStack) as { kind: 'stack'; stack: Stack } | undefined)?.stack : null), [entries, selected, inStack])
  const viewing = useGalleryUi((s) => !!s.viewing)
  const key = (n === 1 ? picked[0].id : stack ? `stack:${stack.key}` : n ? 'multi' : 'none') + (viewing ? ':view' : '')
  const namer = useGalleryNamer()
  useEffect(() => {
    if (useGalleryUi.getState().renamingName) useGalleryUi.getState().set({ renamingName: false })
  }, [key])
  return (
    <aside className="flex h-full min-w-(--gallery-detail-w) flex-col border-l border-line bg-shell" data-testid="gallery-detail">
      <PaneHeader title={stack ? (n ? '选中的叠' : namer.stack(stack.items, stack.cover)) : n ? '选中的图片' : scopeLabel} corner>
        <Tip label="收起右栏">
          <Button variant="ghost" size="icon-sm" className="text-ink-2" onClick={() => usePrefs.getState().set({ galleryRightOpen: false })} aria-label="收起右栏" data-testid="gallery-right-collapse">
            <Icon icon={SidebarRightIcon} size={16} />
          </Button>
        </Tip>
      </PaneHeader>
      <ScrollArea className="min-h-0 flex-1">
        <div key={key} className="page-in flex flex-col gap-4 p-4" data-testid="gallery-detail-body" data-state={n === 1 ? 'single' : stack ? 'stack' : n > 1 ? 'multi' : 'none'}>
          {n === 1 ? <Single img={picked[0]} all={all} /> : stack ? <StackInfo key={stack.key} stack={stack} all={all} /> : n > 1 ? <Multi picked={picked} /> : <None count={scopeCount} />}
        </div>
      </ScrollArea>
    </aside>
  )
}

const FRAME = 'relative block aspect-[4/5] w-full overflow-hidden rounded-md bg-surface-2'

function None({ count }: { count: number }) {
  return (
    <span className="text-[16px] leading-6 font-semibold text-ink-1 tabular-nums" data-testid="gallery-detail-count">
      {count} 张
    </span>
  )
}

function Thumb({ img, className }: { img: GenImage; className?: string }) {
  const [url, setUrl] = useState<string | null | undefined>(() => (img.missing ? null : thumbUrl(img.id)))
  useEffect(() => (img.missing ? undefined : wantThumb(img.id, () => imageBlob(img), setUrl)), [img])
  return url ? <img src={url} alt="" draggable={false} className={cn('object-cover', className)} /> : <span className={cn('block bg-surface-2', className)} />
}

const batchOf = (all: GenImage[], img: GenImage) => all.filter((x) => x.batch === img.batch && x.tabId === img.tabId).sort((a, b) => a.index - b.index)

function Single({ img, all }: { img: GenImage; all: GenImage[] }) {
  const viewing = useGalleryUi((s) => s.viewing === img.id)
  const fav = useMarks((s) => !!s.fav[img.id])
  const trashed = useMarks((s) => img.id in s.trash)
  const batch = useMemo(() => batchOf(all, img), [all, img])
  const imported = img.tabId === IMPORTED
  const [zoom, setZoom] = useState<string | null>(null)
  const group = batch.length > 1 ? batch : [img]
  const namer = useGalleryNamer()
  return (
    <>
      {!viewing && (
        <div data-testid="gallery-detail-preview">
          {img.missing ? (
            <MissingFile className={FRAME} />
          ) : (
            <button type="button" className={cn(FRAME, 'cursor-zoom-in')} onClick={() => setZoom(img.id)} aria-label="看大图" data-testid="gallery-detail-zoom">
              <img src={imageUrl(img)} alt="" draggable={false} {...dragOutProps(() => [img])} className="h-full w-full object-contain" />
            </button>
          )}
        </div>
      )}
      <Title img={img} name={namer.image(img)} doc={namer.custom(img) ? namer.doc(img) : undefined} onRename={(v) => renameImage(img, v)} />
      {trashed ? (
        <div className="flex items-center gap-1" data-testid="gallery-detail-actions">
          <TrashActions ids={[img.id]} />
        </div>
      ) : (
        <Actions open={img} trash={{ label: '移至回收站（Del）', run: () => void trashImages([img.id]) }}>
          <IconAction label={fav ? '取消收藏（F）' : '收藏（F）'} onClick={() => toggleFav([img.id])} on={fav} testId="gallery-fav">
            <Icon icon={StarIcon} size={16} />
          </IconAction>
          <AddToDir ids={[img.id]} />
          <CopyAction img={img} />
          <IconAction label={SAVE_LABEL} onClick={() => void downloadImage(img)} disabled={img.missing} testId="gallery-download">
            <Icon icon={Download04Icon} size={16} />
          </IconAction>
        </Actions>
      )}
      <Zoom
        items={group}
        id={zoom}
        onPick={setZoom}
        onClose={(id) => {
          setZoom(null)
          if (id !== img.id) useGalleryUi.getState().set({ selected: [id], anchor: id, cursor: id })
        }}
      />
      {!viewing && batch.length > 1 && (
        <InfoSection id="img-sec-batch" title={`同一批 ${batch.length} 张`}>
          <div className="flex flex-wrap gap-1.5" data-testid="gallery-batch">
            {batch.map((x) => (
              <button
                key={x.id}
                type="button"
                className={cn('h-14 overflow-hidden rounded-[4px] outline-2 outline-offset-1 transition-[outline-color] duration-150', x.id === img.id ? 'outline-(--accent)' : 'outline-transparent hover:outline-line-strong')}
                style={{ aspectRatio: `${x.width} / ${x.height}` }}
                onClick={() => {
                  const ui = useGalleryUi.getState()
                  ui.set({ selected: [x.id], anchor: x.id, cursor: x.id, ...(ui.viewing ? { viewing: x.id } : {}) })
                }}
                aria-label={`第 ${x.index + 1} 张`}
                data-current={x.id === img.id ? '' : undefined}
                data-testid="gallery-batch-item"
                {...dragOutProps(() => [x])}
              >
                <Thumb img={x} className="size-full" />
              </button>
            ))}
          </div>
        </InfoSection>
      )}
      <ImagePrompts img={img} filterable />
      <ImageParams img={img} />
      <ImageProps img={img} batch={batch.length} imported={imported} />
    </>
  )
}

function Title({ img, name, doc, extra, onRename }: { img: GenImage; name: string; doc?: string; extra?: ReactNode; onRename: (name: string) => void }) {
  const asked = useGalleryUi((s) => s.renamingName)
  const [local, setLocal] = useState(false)
  const editing = local || asked
  const stop = () => {
    setLocal(false)
    if (useGalleryUi.getState().renamingName) useGalleryUi.getState().set({ renamingName: false })
  }
  return (
    <div className="flex flex-col gap-1">
      {editing ? (
        <NameInput
          value={name}
          onDone={(v) => {
            if (v !== null) onRename(v)
            stop()
          }}
        />
      ) : (
        <Tip label="重命名（F2）" side="left">
          <button type="button" className="-mx-1.5 cursor-text rounded-md px-1.5 text-left text-[16px] leading-8 font-semibold break-words text-ink-1 transition-colors duration-(--dur-fast) hover:bg-surface-2" onClick={() => setLocal(true)} data-testid="gallery-detail-title">
            {name}
          </button>
        </Tip>
      )}
      <span className="text-[12px] text-ink-2 tabular-nums" data-testid="gallery-detail-sub">
        {doc && <span>{doc} · </span>}
        {extra}
        {img.tabId === IMPORTED ? '导入于 ' : ''}
        {formatTime(img.createdAt)}
      </span>
    </div>
  )
}

function StackInfo({ stack, all }: { stack: Stack; all: GenImage[] }) {
  const items = stack.items
  const home = Math.max(0, items.indexOf(stack.cover))
  const [api, setApi] = useState<CarouselApi>()
  const [index, setIndex] = useState(home)
  useEffect(() => {
    if (!api) return
    const onSelect = () => setIndex(api.selectedScrollSnap())
    api.on('select', onSelect).on('reInit', onSelect)
    return () => {
      api.off('select', onSelect).off('reInit', onSelect)
    }
  }, [api])
  const cur = items[index] ?? stack.cover
  const fav = useMarks((s) => s.fav)
  const trash = useMarks((s) => s.trash)
  const ids = items.map((x) => x.id)
  const allFav = ids.every((id) => fav[id])
  const trashed = ids.every((id) => id in trash)
  const n = ids.length
  const batch = useMemo(() => batchOf(all, cur), [all, cur])
  const [zoom, setZoom] = useState<string | null>(null)
  const namer = useGalleryNamer()
  return (
    <>
      <section className="flex flex-col gap-2">
        <Carousel setApi={setApi} opts={{ loop: n > 1, startIndex: home }} className="group/gallery" data-testid="gallery-stack-carousel">
          <CarouselContent className="ml-0">
            {items.map((img, i) => (
              <CarouselItem key={img.id} className="pl-0" data-testid="gallery-stack-slide">
                <button type="button" className={cn(FRAME, 'cursor-zoom-in')} onClick={() => setZoom(img.id)} aria-label={`看大图：第 ${i + 1} 张`}>
                  {img.missing ? (
                    <MissingFile className="h-full w-full" />
                  ) : Math.abs(i - index) <= 1 || (index === 0 && i === n - 1) || (index === n - 1 && i === 0) ? (
                    <img src={imageUrl(img)} alt="" draggable={false} className="h-full w-full object-contain" />
                  ) : (
                    <Thumb img={img} className="h-full w-full object-contain" />
                  )}
                </button>
              </CarouselItem>
            ))}
          </CarouselContent>
          {n > 1 && (
            <>
              <CarouselPrevious variant="secondary" className="left-2 opacity-0 shadow-sm transition-opacity duration-(--dur) group-hover/gallery:opacity-100 focus-visible:opacity-100" data-testid="gallery-stack-prev" />
              <CarouselNext variant="secondary" className="right-2 opacity-0 shadow-sm transition-opacity duration-(--dur) group-hover/gallery:opacity-100 focus-visible:opacity-100" data-testid="gallery-stack-next" />
            </>
          )}
          <span className="pointer-events-none absolute right-2 bottom-2 rounded bg-black/55 px-1.5 py-0.5 text-[11px] text-white tabular-nums" data-testid="gallery-stack-counter">
            {index + 1} / {n}
          </span>
        </Carousel>
        {n > 1 && n <= 24 && (
          <div className="flex flex-wrap justify-center gap-1.5">
            {items.map((img, i) => (
              <button
                key={img.id}
                type="button"
                className="size-1.5 rounded-full bg-ink-3/35 transition-[background,transform] duration-(--dur) hover:bg-ink-3 data-[on]:scale-125 data-[on]:bg-ink-1"
                data-on={i === index ? '' : undefined}
                onClick={() => api?.scrollTo(i)}
                aria-label={`第 ${i + 1} 张`}
              />
            ))}
          </div>
        )}
      </section>
      <Zoom
        items={items}
        id={zoom}
        onPick={setZoom}
        onClose={(id) => {
          setZoom(null)
          api?.scrollTo(Math.max(0, items.findIndex((x) => x.id === id)), true)
        }}
      />
      <Title img={cur} name={namer.stack(items, stack.cover)} doc={namer.stack(items, stack.cover) !== namer.doc(stack.cover) ? namer.doc(stack.cover) : undefined} extra={<span>{n} 张 · </span>} onRename={(v) => renameStack(items, stack.cover, v)} />
      {trashed ? (
        <div className="flex items-center gap-1" data-testid="gallery-detail-actions">
          <TrashActions ids={ids} />
        </div>
      ) : (
        <Actions open={cur} trash={{ label: `移至回收站 ${n} 张（Del）`, run: () => void trashImages(ids) }}>
          <IconAction label={allFav ? `取消收藏 ${n} 张（F）` : `收藏 ${n} 张（F）`} onClick={() => toggleFav(ids)} on={allFav} testId="gallery-fav">
            <Icon icon={StarIcon} size={16} />
          </IconAction>
          <AddToDir ids={ids} />
          <CopyAction img={cur} />
          <IconAction label={SAVE_LABEL} onClick={() => void downloadImage(cur)} disabled={cur.missing} testId="gallery-download">
            <Icon icon={Download04Icon} size={16} />
          </IconAction>
        </Actions>
      )}
      <ImagePrompts img={cur} filterable />
      <ImageParams img={cur} />
      <ImageProps img={cur} batch={batch.length} imported={cur.tabId === IMPORTED} />
    </>
  )
}

function Actions({ open, trash, children }: { open?: GenImage; trash: { label: string; run: () => void }; children: ReactNode }) {
  return (
    <div className="flex items-center gap-1" data-testid="gallery-detail-actions">
      {open && <OpenButton img={open} />}
      <div className="flex items-center gap-1">{children}</div>
      <div className="ml-auto">
        <IconAction label={trash.label} onClick={trash.run} testId="gallery-trash">
          <Icon icon={Delete02Icon} size={16} />
        </IconAction>
      </div>
    </div>
  )
}

function OpenButton({ img }: { img: GenImage }) {
  const doc = useGalleryNamer().doc(img)
  const tip = img.tabId === IMPORTED ? `新建文档「${doc}」，在历史中选中此图` : `跳至「${doc}」，在历史中选中此图`
  return (
    <Tip label={tip}>
      <Button variant="outline" className="h-7 gap-1 px-2.5 text-[12px] text-ink-2" onClick={() => void openImage(img)} data-testid="gallery-open">
        <Icon icon={ArrowUpRight01Icon} size={14} />
        打开
      </Button>
    </Tip>
  )
}

export function Zoom({ items, id, onPick, onClose }: { items: GenImage[]; id: string | null; onPick: (id: string) => void; onClose: (id: string) => void }) {
  const at = id ? items.findIndex((x) => x.id === id) : -1
  return (
    <Dialog open={at >= 0} onOpenChange={(o) => !o && id && onClose(id)}>
      {at >= 0 && <LightboxContent items={items} at={at} onPick={(x) => onPick(x.id)} onClose={() => onClose(id!)} testId="gallery-lightbox" />}
    </Dialog>
  )
}

function IconAction({ label, onClick, disabled, on, testId, children }: { label: string; onClick: () => void; disabled?: boolean; on?: boolean; testId: string; children: ReactNode }) {
  return (
    <Tip label={label}>
      <Button variant="outline" size="icon" className={cn('size-7', on ? 'fav-on hover:text-(--fav)' : 'text-ink-2')} onClick={onClick} disabled={disabled} aria-label={label} aria-pressed={on} data-testid={testId}>
        {children}
      </Button>
    </Tip>
  )
}

function AddToDir({ ids }: { ids: string[] }) {
  const menu = useAfterMenu()
  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="icon" className="size-7 text-ink-2" aria-label="加入合集" data-testid="gallery-add-dir">
              <Icon icon={FolderAddIcon} size={16} />
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>加入合集</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="start" className="max-h-80 w-44 overflow-y-auto" onCloseAutoFocus={menu.onCloseAutoFocus} data-testid="gallery-add-dir-menu">
        <DropdownMenuLabel className="text-ink-3">加入合集</DropdownMenuLabel>
        <DirChoices ids={ids} Item={DropdownMenuItem} Check={DropdownMenuCheckboxItem} Separator={DropdownMenuSeparator} later={menu.later} />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function CopyAction({ img }: { img: GenImage }) {
  const [done, setDone] = useState(false)
  useEffect(() => {
    if (!done) return
    const t = setTimeout(() => setDone(false), 1200)
    return () => clearTimeout(t)
  }, [done])
  return (
    <IconAction label="复制图片" onClick={() => void copyImage(img).then((ok) => ok && setDone(true))} disabled={img.missing} testId="gallery-copy">
      <Icon icon={done ? Tick02Icon : Copy01Icon} size={16} className={done ? 'text-lamp-text' : undefined} />
    </IconAction>
  )
}

function NameInput({ value, onDone }: { value: string; onDone: (v: string | null) => void }) {
  const field = useDraftField({ value, onCommit: onDone, onCancel: () => onDone(null) })
  return (
    <input
      className="-mx-1.5 h-8 rounded-md border border-lamp-text bg-work px-1.5 text-[16px] font-semibold text-ink-1 outline-none"
      autoFocus
      {...field.props}
      onKeyDown={(e) => {
        e.stopPropagation()
        field.props.onKeyDown(e)
      }}
      aria-label="名称"
      data-testid="gallery-name-input"
    />
  )
}

function TrashActions({ ids }: { ids: string[] }) {
  const n = ids.length
  return (
    <>
      <Button variant="outline" size="sm" className="h-7 gap-1 text-[12px]" onClick={() => restoreImages(ids)} data-testid="gallery-restore">
        <Icon icon={RestoreBinIcon} size={14} />
        {n > 1 ? `恢复 ${n} 张` : '恢复'}
      </Button>
      <Button variant="outline" size="sm" className="h-7 gap-1 text-[12px] text-(--danger)" onClick={() => void purgeImages(ids)} data-testid="gallery-purge">
        <Icon icon={Delete02Icon} size={14} />
        {n > 1 ? `永久删除 ${n} 张` : '永久删除'}
      </Button>
    </>
  )
}

function Multi({ picked }: { picked: GenImage[] }) {
  const fav = useMarks((s) => s.fav)
  const trash = useMarks((s) => s.trash)
  const ids = picked.map((x) => x.id)
  const n = ids.length
  const allFav = ids.every((id) => fav[id])
  const inTrash = ids.every((id) => id in trash)
  return (
    <>
      <Pile imgs={picked.slice(0, 3)} />
      <span className="text-center text-[16px] font-semibold text-ink-1 tabular-nums" data-testid="gallery-detail-count">
        已选 {n} 张
      </span>
      {inTrash ? (
        <div className="flex items-center gap-1" data-testid="gallery-detail-actions">
          <TrashActions ids={ids} />
        </div>
      ) : (
        <Actions trash={{ label: `移至回收站 ${n} 张（Del）`, run: () => void trashImages(ids) }}>
          <IconAction label={allFav ? `取消收藏 ${n} 张（F）` : `收藏 ${n} 张（F）`} onClick={() => toggleFav(ids)} on={allFav} testId="gallery-fav">
            <Icon icon={StarIcon} size={16} />
          </IconAction>
          <AddToDir ids={ids} />
          <IconAction label={n > SIDE_MAX ? `并排看前 ${SIDE_MAX} 张（Shift+空格）` : '并排看（Shift+空格）'} onClick={() => openSide(ids)} testId="gallery-side-open">
            <Icon icon={LayoutTwoColumnIcon} size={16} />
          </IconAction>
        </Actions>
      )}
    </>
  )
}

function Pile({ imgs }: { imgs: GenImage[] }) {
  return (
    <div className="relative mx-auto mt-2 mb-1 h-40 w-32" data-testid="gallery-detail-pile">
      {imgs
        .map((img, i) => (
          <div key={img.id} className="absolute inset-0 overflow-hidden rounded-md border border-line bg-work shadow-(--shadow-pop)" style={{ transform: `translate(${(i - (imgs.length - 1) / 2) * 10}px, ${i * -4}px) rotate(${(i - (imgs.length - 1) / 2) * 5}deg)` }}>
            <Thumb img={img} className="size-full" />
          </div>
        ))
        .reverse()}
    </div>
  )
}
