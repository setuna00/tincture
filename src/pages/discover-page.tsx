import { useEffect, useMemo, useSyncExternalStore } from 'react'
import { subscribePanelFocus, TEXT_HINT } from '@/lib/status-hints'
import { DndContext, DragOverlay, MouseSensor, pointerWithin, useSensor, useSensors, type DragMoveEvent, type DragStartEvent, type Modifier } from '@dnd-kit/core'
import { getEventCoordinates } from '@dnd-kit/utilities'
import { useHotkeys } from 'react-hotkeys-hook'
import { toast } from 'sonner'
import { DiscoverCart } from '@/components/discover/cart'
import { DiscoverCatalog } from '@/components/discover/catalog'
import { customTree, listTagOf, listTree, loadWikiZh, rowTagOf, useCatalog, useUsage } from '@/components/discover/data'
import { hoverClose } from '@/components/discover/hover-card'
import { PutDialog } from '@/components/discover/put-dialog'
import { placesOf } from '@/components/discover/search'
import { DiscoverTree } from '@/components/discover/tree'
import { ancestors, findNode, type ListNode } from '@/lib/discover'
import { canMoveNode, findListNode, isBuiltinList, type DropPos } from '@/lib/lists'
import { NODE_DRAG, NODE_DROP, overlayOpen, ROW_DRAG, splitRowKey, useDiscover } from '@/store/discover'
import { useLists } from '@/store/lists'
import { NSFW_MAX_LEVEL, usePrefs, type BuiltinListId } from '@/store/prefs'

const nearCursor: Modifier = ({ transform, activatorEvent, draggingNodeRect }) => {
  const p = activatorEvent && getEventCoordinates(activatorEvent)
  if (!p || !draggingNodeRect) return transform
  return { ...transform, x: transform.x + p.x - draggingNodeRect.left + 14, y: transform.y + p.y - draggingNodeRect.top + 12 }
}

const textActive = () => document.activeElement?.getAttribute('data-testid') === 'discover-text'

export function DiscoverHint() {
  const list = usePrefs((s) => s.discoverList)
  const custom = useLists((s) => !isBuiltinList(list) && s.lists.some((l) => l.id === list))
  const selected = useDiscover((s) => s.selected.length > 0)
  const text = useSyncExternalStore(subscribePanelFocus, textActive)
  const hint = text ? TEXT_HINT : selected
    ? `Ctrl+点击 加选 / 取消 · Shift+点击 连选 · Ctrl+A 全选 · 右键 批量操作 · ${custom ? 'Del 移除 · ' : ''}Esc 取消选择`
    : `单击 复制 · + 加入购物车 · Ctrl / Shift+点击 多选 · Ctrl+A 全选${custom ? ' · 拖动到左侧节点 移至 · F2 重命名节点 · Ctrl+Z 撤销' : ''}`
  return <span className="truncate max-sm:hidden" data-testid="status-hint" data-state={text ? 'text' : selected ? 'discover-multi' : 'discover'}>{hint}</span>
}

export function DiscoverPage() {
  const listPref = usePrefs((s) => s.discoverList)
  const nodes = usePrefs((s) => s.discoverNode)
  const openMap = usePrefs((s) => s.discoverOpen)
  const lists = useLists((s) => s.lists)
  const custom = isBuiltinList(listPref) ? null : (lists.find((l) => l.id === listPref) ?? null)
  const list: string = custom ? custom.id : isBuiltinList(listPref) ? listPref : 'b'
  const catalog = useCatalog()
  useEffect(() => void loadWikiZh(), [])
  const usage = useUsage(catalog)
  const tree = useMemo(() => (custom ? customTree(custom) : listTree(list as BuiltinListId)), [custom, list])
  const nodePath = nodes[list]
  const node = nodePath ? findNode(tree, nodePath) : null
  const isOpen = (path: string) => openMap[`${list}:${path}`] ?? tree.children.some((child) => child.path === path)

  const select = (path: string) => {
    const s = usePrefs.getState()
    const open = { ...s.discoverOpen }
    for (const a of ancestors(path)) open[`${list}:${a}`] = true
    s.set({ discoverNode: { ...s.discoverNode, [list]: path }, discoverOpen: open })
    const l = useDiscover.getState().located
    if (l && !l.paths.includes(path)) useDiscover.getState().setLocated(null)
  }
  const toggle = (path: string) => {
    const s = usePrefs.getState()
    s.set({ discoverOpen: { ...s.discoverOpen, [`${list}:${path}`]: !isOpen(path) } })
  }
  const locate = (name: string) => {
    if (!catalog) return
    const where = placesOf(catalog, tree, custom, name, NSFW_MAX_LEVEL[usePrefs.getState().nsfw])
    if (!where.paths.length) return
    useDiscover.getState().setLocated({ name, paths: where.paths, rows: where.rows?.map((r) => rowTagOf(r).name), i: 0 })
    select(where.paths[0])
  }

  useEffect(() => {
    if (catalog && useLists.getState().norm < 2) useLists.getState().normalizeAll((t) => listTagOf(t, catalog))
  }, [catalog])

  useEffect(() => useDiscover.getState().set({ selected: [], anchor: null }), [list, node?.path])

  useEffect(() => {
    const down = (e: PointerEvent) => {
      if (!useDiscover.getState().located) return
      const t = e.target as Element | null
      if (t?.closest?.('[data-locate-keep],[data-located],[data-slot="scroll-area-scrollbar"]')) return
      useDiscover.getState().setLocated(null)
    }
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || !useDiscover.getState().located) return
      const el = document.activeElement
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return
      useDiscover.getState().setLocated(null)
    }
    document.addEventListener('pointerdown', down, true)
    document.addEventListener('keydown', key)
    return () => {
      document.removeEventListener('pointerdown', down, true)
      document.removeEventListener('keydown', key)
    }
  }, [])

  useHotkeys('mod+z', (e) => !overlayOpen() && (e.preventDefault(), useLists.getState().undo()), [])
  useHotkeys(['mod+shift+z', 'mod+y'], (e) => !overlayOpen() && (e.preventDefault(), useLists.getState().redo()), [])
  useHotkeys(
    'f2',
    (e) => {
      if (!custom || overlayOpen() || useDiscover.getState().selected.length || !node?.id) return
      e.preventDefault()
      useDiscover.getState().set({ renaming: node.id })
    },
    [custom, node?.id],
  )

  const sensors = useSensors(useSensor(MouseSensor, { activationConstraint: { distance: 4 } }))
  const onDragStart = ({ active }: DragStartEvent) => {
    hoverClose()
    const id = String(active.id)
    if (id.startsWith(NODE_DRAG)) return useDiscover.getState().set({ drag: { type: 'node', id: id.slice(NODE_DRAG.length) }, over: null })
    const key = id.slice(ROW_DRAG.length)
    const sel = useDiscover.getState().selected
    useDiscover.getState().set({ drag: { type: 'rows', keys: sel.includes(key) ? sel : [key] }, over: null })
  }
  const onDragMove = ({ over, activatorEvent, delta }: DragMoveEvent) => {
    const d = useDiscover.getState()
    if (!over || !custom || !d.drag) return d.over && d.set({ over: null })
    const target = String(over.id).slice(NODE_DROP.length)
    let pos: DropPos = 'inside'
    if (d.drag.type === 'node') {
      if (!canMoveNode(custom.nodes, d.drag.id, target)) return d.over && d.set({ over: null })
      const y = (getEventCoordinates(activatorEvent)?.y ?? 0) + delta.y
      const r = over.rect
      pos = y < r.top + r.height * 0.3 ? 'before' : y > r.top + r.height * 0.7 ? 'after' : 'inside'
    }
    if (d.over?.id !== target || d.over.pos !== pos) d.set({ over: { id: target, pos } })
  }
  const onDragEnd = () => {
    const { drag, over } = useDiscover.getState()
    useDiscover.getState().set({ drag: null, over: null })
    if (!drag || !over || !custom) return
    const lists = useLists.getState()
    if (drag.type === 'node') return lists.moveNode(custom.id, drag.id, over.id, over.pos)
    const items = drag.keys.map(splitRowKey).filter(([from]) => from !== over.id)
    if (!items.length) return
    lists.moveTags(custom.id, items, over.id)
    const title = findListNode(useLists.getState().lists.find((l) => l.id === custom.id)?.nodes ?? [], over.id)?.title ?? ''
    useDiscover.getState().set({ selected: [], anchor: null })
    toast(`已移至「${title}」· ${items.length} 个`, { action: { label: '撤销', onClick: () => useLists.getState().undo() } })
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={pointerWithin}
      onDragStart={onDragStart}
      onDragMove={onDragMove}
      onDragEnd={onDragEnd}
      onDragCancel={() => useDiscover.getState().set({ drag: null, over: null })}
    >
      <div className="flex h-full min-h-0" data-testid="discover-page" data-list={list}>
        <DiscoverTree catalog={catalog} tree={tree} list={list} custom={custom} nodePath={node?.path ?? ''} isOpen={isOpen} onSelect={select} onToggle={toggle} onLocate={locate} />
        {!node ? (
          <div className="flex min-w-0 flex-1 items-center justify-center bg-work pb-16 text-[13px] text-ink-2 animate-in fade-in duration-200" data-testid="discover-empty">请在左栏选择分类</div>
        ) : catalog ? (
          <DiscoverCatalog catalog={catalog} node={node} tree={tree} custom={custom} usage={usage} onSelect={select} />
        ) : (
          <div className="grid min-w-0 flex-1 place-items-center bg-work text-[13px] text-ink-3">加载中…</div>
        )}
        <DiscoverCart />
      </div>
      <DragOverlay dropAnimation={null} modifiers={[nearCursor]}>
        <Ghost tree={tree} />
      </DragOverlay>
      <PutDialog catalog={catalog} />
    </DndContext>
  )
}

function Ghost({ tree }: { tree: ListNode }) {
  const drag = useDiscover((s) => s.drag)
  const over = useDiscover((s) => s.over)
  if (!drag) return null
  const titleOf = (id: string) => {
    let t = ''
    const walk = (n: ListNode) => {
      if (n.id === id) t = n.title
      n.children.forEach(walk)
    }
    walk(tree)
    return t
  }
  const n = drag.type === 'rows' ? new Set(drag.keys.map((k) => splitRowKey(k)[1])).size : 1
  const name = drag.type === 'rows' ? splitRowKey(drag.keys[0])[1] : titleOf(drag.id)
  const hint = over ? (drag.type === 'node' && over.pos !== 'inside' ? `放在「${titleOf(over.id)}」${over.pos === 'before' ? '前面' : '后面'}` : `移至「${titleOf(over.id)}」`) : ''
  return (
    <div className="pointer-events-none w-56" data-testid="discover-ghost">
      <div className="relative">
        {n > 1 && <div className="absolute inset-0 rounded-lg border border-line bg-work" style={{ transform: 'translate(4px, 4px)' }} />}
        <div className="relative flex h-9 items-center gap-2 rounded-lg border border-line bg-work px-2.5 shadow-(--shadow-pop)">
          <span className="truncate text-[13px] font-medium text-ink-1">{name}</span>
          {n > 1 && <span className="shrink-0 text-[11px] text-ink-2">等 {n} 个</span>}
        </div>
        {n > 1 && (
          <span className="absolute grid h-5 place-items-center rounded-full bg-lamp px-1.5 text-[11px] font-semibold text-lamp-ink" style={{ top: -8, right: -8, minWidth: 20 }}>
            {n}
          </span>
        )}
      </div>
      <span
        className="mt-2 inline-block rounded-md px-2 py-1 text-[12px] whitespace-nowrap shadow-(--shadow-pop) transition-opacity duration-(--dur-fast)"
        style={{ background: 'var(--ink-1)', color: 'var(--work)', opacity: over ? 1 : 0 }}
        data-testid="discover-ghost-hint"
      >
        {hint}
      </span>
    </div>
  )
}
