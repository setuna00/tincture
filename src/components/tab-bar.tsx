import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import { useStore } from 'zustand'
import { MouseSensor, TouchSensor, useSensor, useSensors } from '@dnd-kit/core'
import { toast } from 'sonner'
import { Add01Icon, ArrowDown01Icon, Cancel01Icon, GitForkIcon, PencilEdit02Icon } from '@hugeicons/core-free-icons'
import { useAfterMenu } from '@/components/after-menu'
import { useDraftField } from '@/components/draft-field'
import { Icon } from '@/components/icon'
import { Button } from '@/components/ui/button'
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from '@/components/ui/context-menu'
import { DropdownMenu, DropdownMenuContent, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Sortable, SortableContent, SortableItem } from '@/components/ui/sortable'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Tip } from '@/components/tip'
import { cn } from '@/lib/utils'
import { requestCloseTab } from '@/store/save-close'
import { getDocStore, useTabs, useTabUnsaved } from '@/store/tabs'

const COMPRESSED_WIDTH = 120

export function TabBar() {
  const order = useTabs((s) => s.order)
  const activeId = useTabs((s) => s.activeId)
  const starts = useTabs((s) => s.starts)
  const { newTab, reorder } = useTabs.getState()
  const scroller = useRef<HTMLDivElement>(null)
  const sensors = useSensors(useSensor(MouseSensor, { activationConstraint: { distance: 4 } }), useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 6 } }))

  useEffect(() => {
    const el = scroller.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      if (el.scrollWidth <= el.clientWidth || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return
      e.preventDefault()
      el.scrollLeft += e.deltaY
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])
  useEffect(() => {
    scroller.current?.querySelector(`[data-tab-id="${activeId}"]`)?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [activeId, order.length])

  const [tabW, setTabW] = useState(240)
  const [heldWidth, setHeldWidth] = useState<number | null>(null)
  const width = Math.min(tabW, heldWidth ?? Infinity)
  useLayoutEffect(() => {
    const el = scroller.current
    if (!el) return
    const check = () => {
      const row = el.parentElement!
      const rs = getComputedStyle(row)
      const ss = getComputedStyle(el)
      const others = [...row.children].reduce((w, c) => c === el ? w : w + (c as HTMLElement).offsetWidth, 0)
      const room = row.clientWidth - parseFloat(rs.paddingLeft) - parseFloat(rs.paddingRight) - others
        - parseFloat(ss.paddingLeft) - parseFloat(ss.paddingRight)
      const gaps = parseFloat(ss.columnGap) * Math.max(0, order.length - 1)
      setTabW(Math.min(240, Math.max(96, Math.floor((room - gaps) / Math.max(1, order.length)))))
    }
    check()
    const ro = new ResizeObserver(check)
    ro.observe(el.parentElement!)
    return () => ro.disconnect()
  }, [order.length])

  return (
    <div
      className="app-drag col-span-2 col-start-1 row-start-1 flex h-9 min-w-0 items-end bg-shell pr-[max(0.375rem,var(--wco-w))] pl-1.5 shadow-[inset_0_-1px_0_var(--line)]"
      data-testid="tab-row"
      data-compressed={width < COMPRESSED_WIDTH ? '' : undefined}
      onPointerLeave={() => setHeldWidth(null)}
      onMouseDownCapture={(e) => {
        const el = e.target as HTMLElement
        if (el.closest('.tab-item') && (e.button === 1 || (e.button === 0 && el.closest('.tab-close')))) {
          setHeldWidth(width)
        }
      }}
    >
      <Sortable value={order} onValueChange={reorder} orientation="horizontal" sensors={sensors} flatCursor>
        <SortableContent ref={scroller} style={{ '--tab-w': `${width}px` } as CSSProperties} className="flex min-w-0 items-end gap-0 self-stretch overflow-x-auto px-2 [scrollbar-width:none]" data-testid="tab-bar" role="tablist">
          {order.map((id) => (
            <SortableItem key={id} value={id} asHandle className="tab-item flex shrink-0" data-tab-id={id}>
              {starts.includes(id) ? <StartTabButton id={id} active={id === activeId} /> : <TabButton id={id} active={id === activeId} />}
            </SortableItem>
          ))}
        </SortableContent>
      </Sortable>
      <div className="mb-0.5 flex shrink-0 items-center self-end">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon-sm" className="size-7 rounded-full text-ink-2 hover:bg-(--tab-hover)" onClick={() => newTab()} aria-label="新标签页" data-testid="new-tab">
              <Icon icon={Add01Icon} size={16} />
            </Button>
          </TooltipTrigger>
          <TooltipContent>新标签页：新建 / 我的文档 / 最近关闭</TooltipContent>
        </Tooltip>
      </div>
      <AllTabsMenu />
    </div>
  )
}

function AllTabsMenu() {
  const order = useTabs((s) => s.order)
  const activeId = useTabs((s) => s.activeId)
  const starts = useTabs((s) => s.starts)
  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" className="mb-1 ml-auto shrink-0 self-end text-ink-2 data-[state=open]:bg-surface-2 data-[state=open]:text-ink-1" aria-label="全部 tab" data-testid="all-tabs">
              <Icon icon={ArrowDown01Icon} size={16} />
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>全部 tab</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel>已打开 {order.length} 个</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={activeId} onValueChange={(id) => useTabs.getState().activate(id)}>
          {order.map((id) => (
            <DropdownMenuRadioItem key={id} value={id} className="text-[13px]" data-testid="all-tabs-item">
              <span className="truncate">{starts.includes(id) ? '新标签页' : <DocTitle id={id} />}</span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function DocTitle({ id }: { id: string }) {
  return <>{useStore(getDocStore(id), (s) => s.doc.meta.title)}</>
}

const TAB_CLASS =
  'tab-face group relative isolate mb-0 flex h-8 w-full min-w-0 cursor-default items-center gap-1.5 pr-2 pl-3 text-[12px] text-ink-2 transition-colors duration-(--dur) hover:text-ink-1 data-[active]:font-medium data-[active]:text-ink-1'

function CloseButton({ id, unsaved = false }: { id: string; unsaved?: boolean }) {
  return (
    <button
      type="button"
      className="tab-close ml-auto grid size-[18px] shrink-0 place-items-center rounded-full transition-[background-color,color] duration-(--dur-fast) hover:bg-line-strong hover:text-ink-1"
      onMouseDown={(e) => e.stopPropagation()}
      onClick={() => void requestCloseTab(id)}
      aria-label="关闭 tab"
      data-unsaved={unsaved ? '' : undefined}
      data-testid="close-tab"
    >
      <Icon icon={Cancel01Icon} size={14} className={cn('col-start-1 row-start-1 transition-opacity duration-(--dur-fast)', unsaved && 'opacity-0 group-hover:opacity-100')} />
      <span
        className={cn('col-start-1 row-start-1 size-[7px] rounded-full bg-ink-3/60 transition-opacity duration-(--dur-fast)', unsaved ? 'group-hover:opacity-0' : 'opacity-0')}
        data-testid="tab-unsaved-dot"
      />
    </button>
  )
}

function StartTabButton({ id, active }: { id: string; active: boolean }) {
  const { activate } = useTabs.getState()
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          role="tab"
          aria-selected={active}
          data-testid="tab"
          data-active={active ? '' : undefined}
          className={TAB_CLASS}
          onMouseDown={(e) => (e.button === 1 ? (e.preventDefault(), void requestCloseTab(id)) : e.button === 0 && activate(id))}
        >
          <span className="truncate" data-testid="tab-title">
            新标签页
          </span>
          <CloseButton id={id} />
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-40" onCloseAutoFocus={(e) => e.preventDefault()} data-testid="tab-menu">
        <ContextMenuItem onSelect={() => void requestCloseTab(id)} data-testid="tab-menu-close">
          <Icon size={14} icon={Cancel01Icon} />
          关闭
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}

function TabButton({ id, active }: { id: string; active: boolean }) {
  const store = getDocStore(id)
  const title = useStore(store, (s) => s.doc.meta.title)
  const forkedFrom = useStore(store, (s) => s.doc.meta.forkedFrom)
  const parentTitle = useTabs((s) => {
    if (!forkedFrom) return null
    const open = s.order.find((t) => !s.starts.includes(t) && getDocStore(t).getState().doc.meta.docId === forkedFrom.docId)
    return open ? getDocStore(open).getState().doc.meta.title : (forkedFrom.title ?? null)
  })
  const [renaming, setRenaming] = useState(false)
  const menu = useAfterMenu({ refocus: false })
  const unsaved = useTabUnsaved(id)
  const { activate } = useTabs.getState()

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <Tip label={forkedFrom ? `${title}\nfork 自「${parentTitle ?? '已关闭的 tab'}」` : title}>
          <div
            role="tab"
            aria-selected={active}
            data-testid="tab"
            data-active={active ? '' : undefined}
            data-unsaved={unsaved ? '' : undefined}
            className={TAB_CLASS}
            onMouseDown={(e) => {
              if (e.button === 1) {
                e.preventDefault()
                void requestCloseTab(id)
              } else if (e.button === 0) activate(id)
            }}
            onDoubleClick={() => setRenaming(true)}
          >
            {forkedFrom && <Icon icon={GitForkIcon} size={14} className="shrink-0 text-ink-2" />}
            {renaming ? (
              <RenameInput value={title} onDone={(v) => (setRenaming(false), v && store.getState().setTitle(v))} />
            ) : (
              <span className="truncate" data-testid="tab-title">
                {title}
              </span>
            )}
            <CloseButton id={id} unsaved={unsaved} />
          </div>
        </Tip>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-40" onCloseAutoFocus={menu.onCloseAutoFocus} data-testid="tab-menu">
        <ContextMenuItem onSelect={() => menu.later(() => setRenaming(true))} data-testid="tab-menu-rename">
          <Icon size={14} icon={PencilEdit02Icon} />
          重命名
        </ContextMenuItem>
        <ContextMenuItem
          onSelect={() => {
            useTabs.getState().forkTab(id)
            toast('已 fork 当前 tab', { id: 'fork-tab' })
          }}
          data-testid="tab-menu-fork"
        >
          <Icon size={14} icon={GitForkIcon} />
          fork
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={() => void requestCloseTab(id)} data-testid="tab-menu-close">
          <Icon size={14} icon={Cancel01Icon} />
          关闭
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}

function RenameInput({ value, onDone }: { value: string; onDone: (v: string | null) => void }) {
  const field = useDraftField({ value, onCommit: (t) => onDone(t || null), onCancel: () => onDone(null) })
  return (
    <input
      autoFocus
      className="w-0 min-w-0 flex-1 rounded-sm bg-surface-2 px-1 text-ink-1 outline-none"
      {...field.props}
      onMouseDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation()
        field.props.onKeyDown(e)
      }}
      data-testid="tab-rename"
    />
  )
}
