import type { ReactNode } from 'react'
import { ArrowUpRight01Icon, Copy01Icon, Delete02Icon, Download04Icon, FolderAddIcon, FolderRemoveIcon, Layers01Icon, LayoutTwoColumnIcon, PencilEdit02Icon, RestoreBinIcon, StarIcon } from '@hugeicons/core-free-icons'
import { useAfterMenu, type AfterMenu } from '@/components/after-menu'
import { Icon } from '@/components/icon'
import {
  ContextMenu,
  ContextMenuCheckboxItem,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuRadioGroup,
  ContextMenuRadioItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'
import { copyImage, downloadImage, SAVE_LABEL } from '@/components/gen/image-io'
import { SORT_DEFAULT_DIR, type Entry, type SortBy, type SortDir } from '@/lib/gallery-stacks'
import { openImage, purgeImages, removeFromDir, restoreImages, toggleFav, trashImages, useGalleryUi, useMarks } from '@/store/gallery'
import type { GenImage } from '@/store/gen'
import { usePrefs } from '@/store/prefs'
import { DirChoices } from './dirs'
import { DIR_LABEL, enterStack, openSide, selectedStack, SORT_LABEL, useGalleryNamer } from './data'

const T = 'text-[13px]'

export function GalleryMenu({ all, entries, children }: { all: GenImage[]; entries: Entry[]; children: ReactNode }) {
  const menu = useAfterMenu()
  return (
    <ContextMenu>
      <ContextMenuTrigger
        asChild
        onContextMenu={(e) => useGalleryUi.getState().set({ menu: (e.target as HTMLElement).closest('[data-unit]') ? 'cell' : 'blank' })}
      >
        {children}
      </ContextMenuTrigger>
      <ContextMenuContent className="w-56" onCloseAutoFocus={menu.onCloseAutoFocus} data-testid="gallery-menu">
        <Items all={all} entries={entries} later={menu.later} />
      </ContextMenuContent>
    </ContextMenu>
  )
}

function Items({ all, entries, later }: { all: GenImage[]; entries: Entry[]; later: AfterMenu['later'] }) {
  const menu = useGalleryUi((s) => s.menu)
  const selected = useGalleryUi((s) => s.selected)
  const fav = useMarks((s) => s.fav)
  const trash = useMarks((s) => s.trash)
  const scope = useGalleryUi((s) => s.scope)
  const dirs = useMarks((s) => s.dirs)
  const namer = useGalleryNamer()
  if (menu === 'blank') return <BlankItems entries={entries} />
  const ids = selected
  if (!ids.length) return null
  const n = ids.length
  const one = n === 1 ? all.find((x) => x.id === ids[0]) : undefined
  if (ids.every((id) => id in trash))
    return (
      <>
        {n > 1 && <ContextMenuLabel>{n} 张</ContextMenuLabel>}
        <ContextMenuItem className={T} onSelect={() => restoreImages(ids)} data-testid="gallery-menu-restore">
          <Icon icon={RestoreBinIcon} size={14} />
          恢复
        </ContextMenuItem>
        <ContextMenuItem className={T} variant="destructive" onSelect={() => void purgeImages(ids)} data-testid="gallery-menu-purge">
          <Icon icon={Delete02Icon} size={14} />
          永久删除
          <ContextMenuShortcut>Del</ContextMenuShortcut>
        </ContextMenuItem>
      </>
    )
  const stack = selectedStack(entries, ids)
  const allFav = ids.every((id) => fav[id])
  const dir = scope.startsWith('dir:') ? dirs.find((d) => d.id === scope.slice(4)) : undefined
  const head = stack ? `${namer.stack(stack.items, stack.cover)} · ${n} 张` : n > 1 ? `${n} 张` : null
  return (
    <>
      {head && <ContextMenuLabel data-testid="gallery-menu-head">{head}</ContextMenuLabel>}
      {stack && (
        <ContextMenuItem className={T} onSelect={() => enterStack(stack.key)} data-testid="gallery-menu-enter">
          <Icon icon={Layers01Icon} size={14} />
          查看全部 {n} 张
          <ContextMenuShortcut>↵</ContextMenuShortcut>
        </ContextMenuItem>
      )}
      {(stack || one) && (
        <ContextMenuItem className={T} onSelect={() => void openImage(stack ? stack.cover : one!)} data-testid="gallery-menu-open">
          <Icon icon={ArrowUpRight01Icon} size={14} />
          打开
        </ContextMenuItem>
      )}
      <ContextMenuItem className={T} onSelect={() => toggleFav(ids)} data-testid="gallery-menu-fav">
        <Icon icon={StarIcon} size={14} className={allFav ? 'fav-on' : undefined} />
        {allFav ? '取消收藏' : '收藏'}
        <ContextMenuShortcut>F</ContextMenuShortcut>
      </ContextMenuItem>
      {(stack || one) && (
        <ContextMenuItem className={T} onSelect={() => later(() => useGalleryUi.getState().set({ renamingName: true }))} data-testid="gallery-menu-rename">
          <Icon icon={PencilEdit02Icon} size={14} />
          重命名
          <ContextMenuShortcut>F2</ContextMenuShortcut>
        </ContextMenuItem>
      )}
      {one && (
        <>
          <ContextMenuItem className={T} disabled={one.missing} onSelect={() => void copyImage(one)} data-testid="gallery-menu-copy">
            <Icon icon={Copy01Icon} size={14} />
            复制图片
          </ContextMenuItem>
          <ContextMenuItem className={T} disabled={one.missing} onSelect={() => void downloadImage(one)} data-testid="gallery-menu-download">
            <Icon icon={Download04Icon} size={14} />
            {SAVE_LABEL}
          </ContextMenuItem>
        </>
      )}
      {!stack && n > 1 && (
        <ContextMenuItem className={T} onSelect={() => openSide(ids)} data-testid="gallery-menu-side">
          <Icon icon={LayoutTwoColumnIcon} size={14} />
          并排看
          <ContextMenuShortcut>Shift+空格</ContextMenuShortcut>
        </ContextMenuItem>
      )}
      <ContextMenuSeparator />
      <ContextMenuSub>
        <ContextMenuSubTrigger className={T} data-testid="gallery-menu-dirs">
          <Icon icon={FolderAddIcon} size={14} />
          加入合集
        </ContextMenuSubTrigger>
        <ContextMenuSubContent className="max-h-80 w-48 overflow-y-auto" data-testid="gallery-menu-dirs-sub">
          <DirChoices ids={ids} Item={ContextMenuItem} Check={ContextMenuCheckboxItem} Separator={ContextMenuSeparator} later={later} />
        </ContextMenuSubContent>
      </ContextMenuSub>
      {dir && (
        <ContextMenuItem className={T} onSelect={() => removeFromDir(dir.id, ids)} data-testid="gallery-menu-dir-remove">
          <Icon icon={FolderRemoveIcon} size={14} />从「{dir.name}」中移除
        </ContextMenuItem>
      )}
      <ContextMenuSeparator />
      <ContextMenuItem className={T} variant="destructive" onSelect={() => void trashImages(ids)} data-testid="gallery-menu-trash">
        <Icon icon={Delete02Icon} size={14} />
        移至回收站
        <ContextMenuShortcut>Del</ContextMenuShortcut>
      </ContextMenuItem>
    </>
  )
}

function BlankItems({ entries }: { entries: Entry[] }) {
  const stack = usePrefs((s) => s.galleryStack)
  const near = usePrefs((s) => s.galleryNear)
  const by = usePrefs((s) => s.gallerySortBy)
  const dir = usePrefs((s) => s.gallerySortDir)
  const set = usePrefs((s) => s.set)
  return (
    <>
      <ContextMenuCheckboxItem className={T} checked={stack} onCheckedChange={(v) => set({ galleryStack: !!v })} onSelect={(e) => e.preventDefault()} data-testid="gallery-menu-stack">
        叠放图片
      </ContextMenuCheckboxItem>
      <ContextMenuCheckboxItem className={T} checked={stack && near} disabled={!stack} onCheckedChange={(v) => set({ galleryNear: !!v })} onSelect={(e) => e.preventDefault()} data-testid="gallery-menu-near">
        包含相近版本
      </ContextMenuCheckboxItem>
      <ContextMenuSeparator />
      <ContextMenuSub>
        <ContextMenuSubTrigger className={T} data-testid="gallery-menu-sort">
          排序
        </ContextMenuSubTrigger>
        <ContextMenuSubContent className="w-36" data-testid="gallery-menu-sort-sub">
          <ContextMenuRadioGroup value={by} onValueChange={(v) => set({ gallerySortBy: v as SortBy, gallerySortDir: SORT_DEFAULT_DIR[v as SortBy] })}>
            {(['time', 'name', 'tags'] as const).map((k) => (
              <ContextMenuRadioItem key={k} className={T} value={k} onSelect={(e) => e.preventDefault()} data-testid={`gallery-menu-sort-${k}`}>
                {SORT_LABEL[k]}
              </ContextMenuRadioItem>
            ))}
          </ContextMenuRadioGroup>
          <ContextMenuSeparator />
          <ContextMenuRadioGroup value={dir} onValueChange={(v) => set({ gallerySortDir: v as SortDir })}>
            {DIR_LABEL[by].map(([d, label]) => (
              <ContextMenuRadioItem key={d} className={T} value={d} onSelect={(e) => e.preventDefault()} data-testid={`gallery-menu-dir-${d}`}>
                {label}
              </ContextMenuRadioItem>
            ))}
          </ContextMenuRadioGroup>
        </ContextMenuSubContent>
      </ContextMenuSub>
      <ContextMenuSeparator />
      <ContextMenuItem
        className={T}
        disabled={!entries.length}
        onSelect={() => useGalleryUi.getState().set({ selected: entries.flatMap((e) => (e.kind === 'one' ? [e.img.id] : e.stack.items.map((x) => x.id))) })}
        data-testid="gallery-menu-all"
      >
        全选
        <ContextMenuShortcut>Ctrl+A</ContextMenuShortcut>
      </ContextMenuItem>
    </>
  )
}
