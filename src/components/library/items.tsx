import { useDraggable } from '@dnd-kit/core'
import type { CSSProperties, MouseEvent, ReactNode } from 'react'
import { toast } from 'sonner'
import { Book02Icon, Delete02Icon, FolderExportIcon, Folder01Icon, PencilEdit02Icon, StarIcon } from '@hugeicons/core-free-icons'
import { useAfterMenu } from '@/components/after-menu'
import { GenderIcon } from '@/components/gender'
import { Icon } from '@/components/icon'
import { Checkbox } from '@/components/ui/checkbox'
import { SelMark } from '@/components/sel-mark'
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from '@/components/ui/context-menu'
import { LangText } from '@/components/tag-name'
import { sectionTint } from '@/components/editor/labels'
import { openTemplateEdit } from '@/components/assistant/template-edit'
import { TemplateImage } from '@/components/assistant/template-preview'
import { cn } from '@/lib/utils'
import { useLibrary, type FavoriteKey } from '@/store/library'
import type { Gender, GenderExtra, SectionColor } from '@/types'
import { ITEM_DRAG, useLibDrag } from './drag'
import { deleteTemplates } from './ops'
import { useLibPage, type Kind } from './state'
import { SEL_BG } from './tree'

export interface Item {
  id: string
  name: string
  imageKey?: string
  color: SectionColor
  gender?: Gender
  genderExtra?: GenderExtra
  en: string
  zh: string
  where: string
  tags: number
  fav: FavoriteKey
}

const COLS = 'grid-cols-[28px_44px_minmax(0,1fr)_140px_44px_28px] @max-[480px]:grid-cols-[28px_44px_minmax(0,1fr)_44px_28px]'
const WHERE_COL = '@max-[480px]:hidden'

export function clickItem(id: string, e: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }, visible: string[], toggle = false) {
  const s = useLibPage.getState()
  if (toggle || e.ctrlKey || e.metaKey) {
    const on = s.selected.includes(id)
    s.set({ selected: on ? s.selected.filter((x) => x !== id) : [...s.selected, id], anchor: id })
  } else if (e.shiftKey && s.anchor && visible.includes(s.anchor)) {
    const [a, b] = [visible.indexOf(s.anchor), visible.indexOf(id)].sort((x, y) => x - y)
    s.set({ selected: visible.slice(a, b + 1) })
  } else s.set({ selected: [id], anchor: id })
}

const whereLabel = (kind: Kind, w: string) => w || (kind === 's' ? '根目录' : '无所属作品')

function Thumb({ item, size }: { item: Item; size: number }) {
  if (item.imageKey) return <TemplateImage imageKey={item.imageKey} className="shrink-0 rounded-md" style={{ width: size, height: size }} testId="lib-thumb" />
  return (
    <span className="grid shrink-0 place-items-center rounded-md" style={{ width: size, height: size, background: `color-mix(in srgb, ${sectionTint(item.color)} 16%, var(--work))` }}>
      {item.gender && <GenderIcon gender={item.gender} extra={item.genderExtra} size={14} />}
    </span>
  )
}

const Mark = ({ item }: { item: Item }) =>
  item.gender ? <GenderIcon gender={item.gender} extra={item.genderExtra} size={14} /> : <span className="size-2 shrink-0 rounded-full" style={{ background: sectionTint(item.color) }} />

function Star({ item }: { item: Item }) {
  const on = useLibrary((s) => s.favorites.includes(item.fav))
  return (
    <button
      type="button"
      className={cn('grid size-6 place-items-center rounded-sm hover:bg-surface-3', on ? 'fav-on' : 'text-ink-3/50 hover:!text-(--fav)')}
      onClick={(e) => {
        e.stopPropagation()
        useLibrary.getState().toggleFavorite(item.fav)
        toast(on ? `已取消收藏「${item.name}」` : `已收藏「${item.name}」`)
      }}
      onDoubleClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      aria-label={on ? `取消收藏 ${item.name}` : `收藏 ${item.name}`}
      aria-pressed={on}
      data-testid="lib-star"
    >
      <Icon icon={StarIcon} size={14} />
    </button>
  )
}

function ItemShell({
  item,
  kind,
  visible,
  className,
  style,
  selStyle,
  children,
}: {
  item: Item
  kind: Kind
  visible: string[]
  className: string
  style?: CSSProperties
  selStyle?: CSSProperties
  children: (on: boolean) => ReactNode
}) {
  const on = useLibPage((s) => s.selected.includes(item.id))
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: `${ITEM_DRAG}${item.id}` })
  const dimmed = useLibDragDim(item.id, on)
  const fav = useLibrary((s) => s.favorites.includes(item.fav))
  const edit = () => openTemplateEdit(item.id, kind === 's' ? 'section' : 'character')
  const ids = () => useLibPage.getState().selected
  const menu = useAfterMenu({ refocus: false })
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
            ref={setNodeRef}
            {...attributes}
            {...listeners}
            role="row"
            aria-selected={on}
            className={cn(className, 'transition-[background-color,opacity,outline-color] duration-(--dur-fast)', (isDragging || dimmed) && 'opacity-40')}
            style={on ? { ...style, ...selStyle } : style}
            onClick={(e: MouseEvent) => {
              e.stopPropagation()
              clickItem(item.id, e, visible)
            }}
            onDoubleClick={edit}
            onContextMenu={() => !on && useLibPage.getState().set({ selected: [item.id], anchor: item.id })}
            data-testid="lib-item"
            data-id={item.id}
            data-name={item.name}
            data-selected={on ? '' : undefined}
          >
            {children(on)}
          </div>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-44" onCloseAutoFocus={menu.onCloseAutoFocus} data-testid="lib-item-menu">
        <ContextMenuItem onSelect={edit} disabled={ids().length > 1} data-testid="lib-item-edit">
          <Icon size={14} icon={PencilEdit02Icon} />
          编辑
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => menu.later(() => useLibPage.getState().set({ moveOpen: true }))} data-testid="lib-item-move">
          <Icon size={14} icon={FolderExportIcon} />
          移至{kind === 's' ? '目录' : '作品'}
        </ContextMenuItem>
        <ContextMenuItem
          onSelect={() => {
            useLibrary.getState().toggleFavorite(item.fav)
            toast(fav ? `已取消收藏「${item.name}」` : `已收藏「${item.name}」`)
          }}
          disabled={ids().length > 1}
        >
          <Icon size={14} icon={StarIcon} />
          {fav ? '取消收藏' : '收藏'}
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem variant="destructive" onSelect={() => void deleteTemplates(kind, ids())} data-testid="lib-item-delete">
          <Icon size={14} icon={Delete02Icon} />
          {ids().length > 1 ? `删除 ${ids().length} 个` : '删除模板'}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}

function useLibDragDim(id: string, on: boolean) {
  return useLibDrag((s) => on && s.active?.type === 'items' && s.active.ids.length > 1 && s.active.ids.includes(id))
}

export function ItemList({ kind, items }: { kind: Kind; items: Item[] }) {
  const selected = useLibPage((s) => s.selected)
  const visible = items.map((i) => i.id)
  const all = items.length > 0 && items.every((i) => selected.includes(i.id))
  const some = items.some((i) => selected.includes(i.id))
  return (
    <div className="@container rounded-lg border border-line-strong bg-work" role="grid" data-testid="lib-list">
      <div className={cn('sticky top-0 z-10 grid h-8 items-center rounded-t-lg border-b border-line bg-work px-2 text-[11px] text-ink-2', COLS)} role="row" onClick={(e) => e.stopPropagation()}>
        <Checkbox
          className="ml-1"
          checked={all ? true : some ? 'indeterminate' : false}
          onCheckedChange={() => useLibPage.getState().set({ selected: all ? [] : visible })}
          aria-label={all ? '全不选' : '全选'}
          data-testid="lib-select-all"
        />
        <span />
        <span>名字</span>
        <span className={WHERE_COL}>{kind === 's' ? '目录' : '作品'}</span>
        <span className="text-right">tag</span>
        <span />
      </div>
      {items.map((item) => (
        <ItemShell key={item.id} item={item} kind={kind} visible={visible} className={cn('grid h-12 cursor-default items-center border-b border-line px-2 last:rounded-b-lg last:border-0', COLS)} selStyle={SEL_BG}>
          {(on) => (
            <>
              <Checkbox
                className="ml-1"
                checked={on}
                onClick={(e) => {
                  e.stopPropagation()
                  clickItem(item.id, e, visible, true)
                }}
                onPointerDown={(e) => e.stopPropagation()}
                onDoubleClick={(e) => e.stopPropagation()}
                aria-label={`选中 ${item.name}`}
                data-testid="lib-item-check"
              />
              <Thumb item={item} size={34} />
              <span className="flex min-w-0 flex-col gap-0.5 pr-4">
                <span className="flex min-w-0 items-center gap-1.5">
                  <Mark item={item} />
                  <span className="truncate text-[13px] font-medium text-ink-1" data-testid="lib-item-name">
                    {item.name}
                  </span>
                </span>
                <span className="truncate text-[12px] text-ink-2">
                  <LangText en={item.en} zh={item.zh} />
                </span>
              </span>
              <span className={cn('flex min-w-0 items-center gap-1 pr-2 text-[12px]', item.where ? 'text-ink-2' : 'text-ink-3', WHERE_COL)} data-testid="lib-item-where">
                <Icon icon={kind === 's' ? Folder01Icon : Book02Icon} size={14} className="shrink-0 text-ink-2" />
                <span className="truncate">{whereLabel(kind, item.where)}</span>
              </span>
              <span className="text-right text-[11px] text-ink-2 tabular-nums">{item.tags}</span>
              <Star item={item} />
            </>
          )}
        </ItemShell>
      ))}
    </div>
  )
}

export function ItemGrid({ kind, items }: { kind: Kind; items: Item[] }) {
  const visible = items.map((i) => i.id)
  return (
    <div className="grid content-start gap-3 pt-1" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(156px, 1fr))' }} data-testid="lib-grid">
      {items.map((item) => (
        <ItemShell key={item.id} item={item} kind={kind} visible={visible} className="lib-card group/card relative flex cursor-default flex-col overflow-hidden rounded-lg border border-line-strong bg-work">
          {(on) => (
            <>
              <div className="relative h-[104px]">
                {item.imageKey ? (
                  <TemplateImage imageKey={item.imageKey} className="w-full" style={{ height: 104 }} testId="lib-thumb" />
                ) : (
                  <div className="flex w-full flex-col gap-1 overflow-hidden p-2.5" style={{ height: 104, background: `color-mix(in srgb, ${sectionTint(item.color)} 10%, var(--surface-2))` }}>
                    {item.gender && <span className="ml-6"><GenderIcon gender={item.gender} extra={item.genderExtra} size={14} /></span>}
                    <span className="line-clamp-4 indent-6 text-[12px] leading-snug text-ink-2">
                      <LangText en={item.en} zh={item.zh} />
                    </span>
                  </div>
                )}
                <SelMark />
              </div>
              {on && <button
                type="button"
                className="absolute top-1 left-1 z-10 size-6 rounded-full"
                aria-label={`取消选中 ${item.name}`}
                data-testid="lib-item-uncheck"
                onClick={(e) => { e.stopPropagation(); clickItem(item.id, e, visible, true) }}
                onPointerDown={(e) => e.stopPropagation()}
                onDoubleClick={(e) => e.stopPropagation()}
              />}
              <span className={cn('absolute top-1.5 left-1.5 transition-opacity duration-(--dur-fast)', on ? 'invisible opacity-0' : 'opacity-0 group-hover/card:opacity-100 group-focus-within/card:opacity-100')}>
                <Checkbox
                  className="bg-work shadow-xs"
                  checked={on}
                  onClick={(e) => {
                    e.stopPropagation()
                    clickItem(item.id, e, visible, true)
                  }}
                  onPointerDown={(e) => e.stopPropagation()}
                  onDoubleClick={(e) => e.stopPropagation()}
                  aria-label={`选中 ${item.name}`}
                  data-testid="lib-item-check"
                />
              </span>
              <span className="absolute top-1 right-1 opacity-0 transition-opacity duration-(--dur-fast) group-hover/card:opacity-100 has-[[aria-pressed=true]]:opacity-100">
                <Star item={item} />
              </span>
              <div className="flex flex-col gap-0.5 px-2.5 py-2">
                <span className="flex min-w-0 items-center gap-1.5">
                  <Mark item={item} />
                  <span className="truncate text-[13px] font-medium text-ink-1" data-testid="lib-item-name">
                    {item.name}
                  </span>
                </span>
                <span className="truncate text-[11px] text-ink-2" data-testid="lib-item-where">
                  {whereLabel(kind, item.where)} · {item.tags} 个 tag
                </span>
              </div>
            </>
          )}
        </ItemShell>
      ))}
    </div>
  )
}
