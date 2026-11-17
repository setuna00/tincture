import { useState, type DragEvent as ReactDragEvent, type ReactNode } from 'react'
import type { IconSvgElement } from '@hugeicons/react'
import { Add01Icon, Album02Icon, ArrowRight01Icon, Delete02Icon, File01Icon, FileImportIcon, GridViewIcon, Layers01Icon, PencilEdit02Icon, SidebarLeftIcon, SidebarRightIcon, StarIcon, UserIcon } from '@hugeicons/core-free-icons'
import { useAfterMenu } from '@/components/after-menu'
import { useDraftField } from '@/components/draft-field'
import { Icon } from '@/components/icon'
import { PaneHeader } from '@/components/assistant/panel'
import { Tip } from '@/components/tip'
import { Button } from '@/components/ui/button'
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuShortcut, ContextMenuTrigger } from '@/components/ui/context-menu'
import { ScrollArea } from '@/components/ui/scroll-area'
import { draggingOutIds } from '@/components/gen/drag-out'
import { SEL_BG } from '@/components/library/tree'
import type { GalleryDir } from '@/lib/gallery-stacks'
import { cn } from '@/lib/utils'
import { addToDir, createDir, deleteDir, IMPORTED, renameDir, toggleFav, useGalleryUi, useMarks, type Scope } from '@/store/gallery'
import type { GenImage } from '@/store/gen'
import { usePrefs } from '@/store/prefs'
import type { DocGroup, TplGroup } from './data'
import { GALLERY_DRAG } from './grid'

export function GalleryNav({ all, groups, tpls, dirs }: { all: GenImage[]; groups: DocGroup[]; tpls: TplGroup[]; dirs: GalleryDir[] }) {
  const fav = useMarks((s) => s.fav)
  const trash = useMarks((s) => s.trash)
  let nAll = 0
  let nFav = 0
  let nTrash = 0
  for (const img of all) {
    if (img.id in trash) nTrash++
    else {
      nAll++
      if (fav[img.id]) nFav++
    }
  }
  const live = new Set(all.filter((x) => !(x.id in trash)).map((x) => x.id))
  return (
    <aside className="flex h-full min-w-(--lib-tree-w) flex-col border-r border-line bg-shell" data-testid="gallery-nav">
      <PaneHeader title="图库">
        <Tip label="收起左栏">
          <Button variant="ghost" size="icon-sm" className="text-ink-2" onClick={() => usePrefs.getState().set({ galleryLeftOpen: false })} aria-label="收起左栏" data-testid="gallery-left-collapse">
            <Icon icon={SidebarLeftIcon} size={16} />
          </Button>
        </Tip>
      </PaneHeader>
      <ScrollArea className="min-h-0 flex-1">
        <div className="flex flex-col gap-3 px-2 py-2">
          <div className="flex flex-col">
            <Row scope="all" icon={GridViewIcon} label="全部" count={nAll} />
            <Row scope="trash" icon={Delete02Icon} label="回收站" count={nTrash} />
          </div>
          {(groups.length > 0 || tpls.length > 0) && (
            <Section title="智能合集" testId="gallery-smart">
              {groups.length > 0 && (
                <Fold id="gallery-nav-docs" title="按文档">
                  {groups.map((g) => (
                    <Row key={g.tabId} scope={`doc:${g.tabId}`} icon={g.tabId === IMPORTED ? FileImportIcon : File01Icon} label={g.title} count={g.count} />
                  ))}
                </Fold>
              )}
              {tpls.length > 0 && (
                <Fold id="gallery-nav-tpls" title="按模板">
                  {tpls.map((t) => (
                    <Row key={t.id} scope={`tpl:${t.id}`} icon={t.kind === 'section' ? Layers01Icon : UserIcon} label={t.name} count={t.count} tip={t.kind === 'section' ? `使用区块模板「${t.name}」且未改动的图片` : `使用角色模板「${t.name}」且未改动的图片`} />
                  ))}
                </Fold>
              )}
            </Section>
          )}
          {(groups.length > 0 || tpls.length > 0) && <div className="mx-1 border-t border-line" />}
          <Section
            title="合集"
            testId="gallery-dirs"
            action={
              <Tip label="新建合集">
                <Button variant="ghost" size="icon-xs" className="text-ink-2" onClick={() => createDir()} aria-label="新建合集" data-testid="gallery-dir-add">
                  <Icon icon={Add01Icon} size={14} />
                </Button>
              </Tip>
            }
          >
            <DropRow scope="fav" icon={StarIcon} label="收藏" count={nFav} onDrop={(ids) => toggleFav(ids, true)} />
            {[...dirs]
              .sort((a, b) => a.createdAt - b.createdAt)
              .map((dir) => (
                <DirRow key={dir.id} dir={dir} count={Object.keys(dir.items).filter((id) => live.has(id)).length} />
              ))}
          </Section>
        </div>
      </ScrollArea>
    </aside>
  )
}

function Section({ title, action, testId, children }: { title: string; action?: ReactNode; testId: string; children: ReactNode }) {
  return (
    <div className="flex flex-col" data-testid={testId}>
      <div className="flex h-6 items-center pr-1 pb-0.5 pl-2">
        <span className="flex-1 text-[11px] font-medium text-ink-2">{title}</span>
        {action}
      </div>
      {children}
    </div>
  )
}

function Fold({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  const open = usePrefs((s) => !s.collapsed[id])
  return (
    <div className="flex flex-col" data-testid={id} data-collapsed={open ? undefined : ''}>
      <button
        type="button"
        className="flex h-6 items-center gap-1 rounded-md pl-1.5 text-left text-[11px] font-medium text-ink-2 transition-colors duration-(--dur-fast) hover:text-ink-1"
        onClick={() => usePrefs.getState().togglePanel(id)}
        aria-expanded={open}
        data-testid={`${id}-toggle`}
      >
        <Icon icon={ArrowRight01Icon} size={12} className={cn('shrink-0 transition-transform duration-200', open && 'rotate-90')} />
        {title}
      </button>
      <div className={cn('grid transition-[grid-template-rows,opacity] duration-200', open ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0')} inert={!open}>
        <div className="flex min-h-0 flex-col overflow-hidden">{children}</div>
      </div>
    </div>
  )
}

const pick = (scope: Scope) => {
  const ui = useGalleryUi.getState()
  if (ui.scope !== scope || ui.inStack) ui.set({ scope, selected: [], anchor: null, viewing: null, side: null, inStack: null })
}

const rowClass = (on: boolean, over = false) => cn('relative flex h-7 shrink-0 cursor-default items-center gap-2 rounded-md pr-2 transition-colors duration-(--dur-fast)', on ? 'text-ink-1' : 'text-ink-2', !on && !over && 'hover:bg-surface-2')
const rowStyle = (on: boolean, over: boolean) => ({ paddingLeft: 8, ...(on || over ? SEL_BG : {}), ...(over ? { outline: '1.5px solid var(--accent-text)', outlineOffset: -1.5 } : {}) })

function Row({ scope, icon, label, count, tip }: { scope: Scope; icon: IconSvgElement; label: string; count: number; tip?: string }) {
  const on = useGalleryUi((s) => s.scope === scope)
  const row = (
    <div
      role="button"
      tabIndex={0}
      className={rowClass(on)}
      style={rowStyle(on, false)}
      onClick={() => pick(scope)}
      onKeyDown={(e) => e.key === 'Enter' && pick(scope)}
      aria-current={on || undefined}
      data-testid="gallery-scope"
      data-scope={scope}
    >
      <Icon icon={icon} size={14} className="shrink-0 text-ink-2" />
      <span className="flex-1 truncate text-[12px] font-medium">{label}</span>
      <span className="text-[11px] text-ink-2 tabular-nums">{count}</span>
    </div>
  )
  return tip ? <Tip label={tip}>{row}</Tip> : row
}

const draggedIds = (e: ReactDragEvent) => {
  const raw = e.dataTransfer.getData(GALLERY_DRAG)
  return raw ? raw.split(',').filter(Boolean) : draggingOutIds()
}
const carries = (e: ReactDragEvent) => e.dataTransfer.types.includes(GALLERY_DRAG) || draggingOutIds().length > 0

function useDrop(onDrop: (ids: string[]) => void) {
  const [over, setOver] = useState(false)
  return {
    over,
    props: {
      onDragOver: (e: ReactDragEvent) => {
        if (!carries(e)) return
        e.preventDefault()
        e.dataTransfer.dropEffect = 'copy'
        if (!over) setOver(true)
      },
      onDragLeave: (e: ReactDragEvent<HTMLElement>) => !e.currentTarget.contains(e.relatedTarget as Node) && setOver(false),
      onDrop: (e: ReactDragEvent) => {
        setOver(false)
        const ids = draggedIds(e)
        if (!ids.length) return
        e.preventDefault()
        onDrop(ids)
      },
      'data-gallery-drop': '',
    },
  }
}

function DropRow({ scope, icon, label, count, onDrop }: { scope: Scope; icon: IconSvgElement; label: string; count: number; onDrop: (ids: string[]) => void }) {
  const on = useGalleryUi((s) => s.scope === scope)
  const drop = useDrop(onDrop)
  return (
    <div role="button" tabIndex={0} className={rowClass(on, drop.over)} style={rowStyle(on, drop.over)} onClick={() => pick(scope)} onKeyDown={(e) => e.key === 'Enter' && pick(scope)} aria-current={on || undefined} data-testid="gallery-scope" data-scope={scope} {...drop.props}>
      <Icon icon={icon} size={14} className={cn('shrink-0', count ? 'fav-on' : 'text-ink-2')} />
      <span className="flex-1 truncate text-[12px] font-medium">{label}</span>
      <span className="text-[11px] text-ink-2 tabular-nums">{count}</span>
    </div>
  )
}

function DirRow({ dir, count }: { dir: GalleryDir; count: number }) {
  const scope = `dir:${dir.id}` as const
  const on = useGalleryUi((s) => s.scope === scope)
  const renaming = useGalleryUi((s) => s.renamingDir === dir.id)
  const drop = useDrop((ids) => addToDir(dir.id, ids))
  const menu = useAfterMenu()
  const row = (
    <div
      role="button"
      tabIndex={0}
      className={cn(rowClass(on, drop.over), 'data-[state=open]:bg-surface-2')}
      style={rowStyle(on, drop.over)}
      onClick={() => !renaming && pick(scope)}
      onDoubleClick={() => useGalleryUi.getState().set({ renamingDir: dir.id })}
      onKeyDown={(e) => {
        if (renaming) return
        if (e.key === 'Enter') pick(scope)
        if (e.key === 'F2') useGalleryUi.getState().set({ renamingDir: dir.id })
      }}
      aria-current={on || undefined}
      data-testid="gallery-scope"
      data-scope={scope}
      data-over={drop.over ? '' : undefined}
      {...drop.props}
    >
      <Icon icon={Album02Icon} size={14} className="shrink-0 text-ink-2" />
      {renaming ? <RenameInput dir={dir} /> : <span className="min-w-0 flex-1 truncate text-[12px] font-medium">{dir.name}</span>}
      {!renaming && <span className="text-[11px] text-ink-2 tabular-nums">{count}</span>}
    </div>
  )
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{row}</ContextMenuTrigger>
      <ContextMenuContent className="w-44" onCloseAutoFocus={menu.onCloseAutoFocus} data-testid="gallery-dir-menu">
        <ContextMenuItem className="text-[13px]" onSelect={() => menu.later(() => useGalleryUi.getState().set({ renamingDir: dir.id }))} data-testid="gallery-dir-rename">
          <Icon icon={PencilEdit02Icon} size={14} />
          重命名
          <ContextMenuShortcut>F2</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem className="text-[13px]" variant="destructive" onSelect={() => void deleteDir(dir.id)} data-testid="gallery-dir-delete">
          <Icon icon={Delete02Icon} size={14} />
          删除合集
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}

function RenameInput({ dir }: { dir: GalleryDir }) {
  const field = useDraftField({ value: dir.name, onCommit: (t) => renameDir(dir.id, t), onCancel: () => useGalleryUi.getState().set({ renamingDir: null }) })
  return (
    <input
      className="h-6 min-w-0 flex-1 rounded-md border border-lamp-text bg-work px-1.5 text-[12px] text-ink-1 outline-none"
      autoFocus
      {...field.props}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation()
        field.props.onKeyDown(e)
      }}
      data-testid="gallery-dir-name"
    />
  )
}

export function GalleryRail({ side }: { side: 'left' | 'right' }) {
  const left = side === 'left'
  return (
    <button
      type="button"
      className={cn('flex h-full w-full flex-col items-center gap-2 border-line bg-shell text-ink-2 hover:bg-surface-2 hover:text-ink-1', left ? 'border-r pt-2.5' : 'border-l pt-[calc(0.625rem+var(--wco-h))]')}
      onClick={() => usePrefs.getState().set(left ? { galleryLeftOpen: true } : { galleryRightOpen: true })}
      aria-label={left ? '展开左栏' : '展开右栏'}
      data-testid={`gallery-${side}-rail`}
    >
      <Icon icon={left ? SidebarLeftIcon : SidebarRightIcon} size={16} />
      <span className="text-[11px] tracking-[0.3em] [writing-mode:vertical-rl]">{left ? '图库' : '选中的图片'}</span>
    </button>
  )
}
