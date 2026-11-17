import { memo, useEffect, useMemo, useRef, type CSSProperties, type ReactElement } from 'react'
import { useDraggable, useDroppable } from '@dnd-kit/core'
import { AnimatePresence, motion } from 'motion/react'
import { toast } from 'sonner'
import { Add01Icon, ArrowDown01Icon, ArrowLeft01Icon, ArrowRight01Icon, Cancel01Icon, Delete02Icon, FolderAddIcon, MoreHorizontalIcon, PencilEdit02Icon } from '@hugeicons/core-free-icons'
import { useAfterMenu } from '@/components/after-menu'
import { Icon } from '@/components/icon'
import { Button } from '@/components/ui/button'
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuShortcut, ContextMenuTrigger } from '@/components/ui/context-menu'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tip } from '@/components/tip'
import { nodeCount, type Catalog, type ListNode } from '@/lib/discover'
import { allTags, countNodes, findListNode, type UserList } from '@/lib/lists'
import { openSettings } from '@/lib/settings-nav'
import { cn } from '@/lib/utils'
import { confirmDelete } from '@/store/confirm'
import { NODE_DRAG, NODE_DROP, useDiscover } from '@/store/discover'
import { useLists } from '@/store/lists'
import { usePrefs } from '@/store/prefs'
import { LISTS } from './data'
import { DiscoverSearch } from './search'

export const SEL_BG: CSSProperties = { background: 'color-mix(in srgb, var(--accent) 13%, var(--shell))' }
const INDENT = 14

function customCount(n: ListNode): number {
  const seen = new Set<string>()
  const walk = (x: ListNode) => {
    for (const t of x.tags) seen.add(t.toLowerCase())
    x.children.forEach(walk)
  }
  walk(n)
  return seen.size
}

export function DiscoverTree({
  catalog,
  tree,
  list,
  custom,
  nodePath,
  isOpen,
  onSelect,
  onToggle,
  onLocate,
}: {
  catalog: Catalog | null
  tree: ListNode
  list: string
  custom: UserList | null
  nodePath: string
  isOpen: (path: string) => boolean
  onSelect: (path: string) => void
  onToggle: (path: string) => void
  onLocate: (name: string) => void
}) {
  const nsfw = usePrefs((s) => s.nsfw)
  const maxLevel = nsfw === 'off' ? 1 : nsfw === 'r18' ? 2 : 3
  const counts = useMemo(() => {
    const m = new Map<string, number>()
    if (!catalog && !custom) return m
    const walk = (n: ListNode) => {
      for (const c of n.children) {
        m.set(c.path, custom ? customCount(c) : nodeCount(catalog!, c, maxLevel))
        walk(c)
      }
    }
    walk(tree)
    return m
  }, [catalog, tree, maxLevel, custom])
  const located = useDiscover((s) => s.located)
  const marks = useMemo(() => new Set(located?.paths ?? []), [located])

  const addRoot = () => {
    if (!custom) return
    const n = useLists.getState().addNode(custom.id, null)
    if (n) {
      onSelect(n.id)
      useDiscover.getState().set({ renaming: n.id })
    }
  }

  return (
    <aside className="flex w-(--lib-tree-w) shrink-0 flex-col border-r border-line bg-shell" data-testid="discover-tree">
      <div className="app-drag flex h-9 shrink-0 items-center gap-1 border-b border-line pr-1.5 pl-3">
        <span className="pane-title">百科</span>
        <ListSwitch list={list} custom={custom} />
        {custom && <ListMenu custom={custom} />}
      </div>
      <div className="relative z-30 px-2 pt-2 pb-1">
        <DiscoverSearch catalog={catalog} tree={tree} custom={custom} onLocate={onLocate} />
        <LocateBar onSelect={onSelect} />
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <div className="flex flex-col px-2 pt-1 pb-2" role="tree" data-testid="discover-nodes">
          {catalog || custom ? (
            <Branch node={tree} counts={counts} nodePath={nodePath} marks={marks} isOpen={isOpen} onSelect={onSelect} onToggle={onToggle} custom={custom} />
          ) : (
            <p className="px-2 py-6 text-center text-[12px] text-ink-3">加载中…</p>
          )}
          {custom && (
            <button
              type="button"
              className="mt-0.5 flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2 text-[12px] text-ink-2 transition-colors duration-(--dur-fast) hover:bg-surface-2 hover:text-ink-1"
              onClick={addRoot}
              data-testid="discover-node-add"
            >
              <Icon icon={Add01Icon} size={14} />
              新建节点
            </button>
          )}
        </div>
      </ScrollArea>
      {custom ? (
        <p className="border-t border-line px-3 py-2 text-[11px] leading-relaxed text-ink-2" data-testid="discover-tree-hint">
          双击 / F2 重命名 · 右键新建子节点、删除 · 拖动节点调整位置或移入其他节点 · 将行拖动到节点上 = 移动
        </p>
      ) : (
        <p className="border-t border-line px-3 py-2 text-[11px] leading-relaxed text-ink-2" data-testid="discover-nsfw">
          NSFW {nsfw === 'off' ? '关闭 · 不显示 R18 分类' : nsfw === 'r18' ? '开启（R18）' : '开启（R18 + R18G）'} ·{' '}
          <a
            href="#/settings"
            onClick={(e) => {
              e.preventDefault()
              openSettings('content')
            }}
            className="whitespace-nowrap underline-offset-2 hover:text-ink-1 hover:underline"
            data-testid="discover-to-settings"
          >
            在设置中修改
          </a>
        </p>
      )}
    </aside>
  )
}

function ListSwitch({ list, custom }: { list: string; custom: UserList | null }) {
  const set = usePrefs((s) => s.set)
  const lists = useLists((s) => s.lists)
  const renaming = useDiscover((s) => (custom ? s.renaming === `list:${custom.id}` || s.renaming === `list-new:${custom.id}` : false))
  const builtin = LISTS.find((l) => l.id === list)
  const menu = useAfterMenu()
  const pick = (v: string) => {
    set({ discoverList: v })
    useDiscover.getState().setLocated(null)
  }
  if (custom && renaming) return <ListRename custom={custom} />
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className={cn('h-7 min-w-0 gap-1 px-2 text-[12px] font-normal text-ink-2', !custom && 'ml-auto')} style={custom ? { marginLeft: 'auto' } : undefined} data-testid="discover-list">
          <span className="truncate">{custom ? custom.name : `${builtin!.id.toUpperCase()} · ${builtin!.name}`}</span>
          <Icon icon={ArrowDown01Icon} size={14} className="shrink-0 text-ink-2" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72" onCloseAutoFocus={menu.onCloseAutoFocus}>
        <DropdownMenuLabel className="text-ink-3">内置（同一批小类的三种排列，只读）</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={list} onValueChange={pick}>
          {LISTS.map((l) => (
            <DropdownMenuRadioItem key={l.id} value={l.id} className="items-start py-1.5" data-testid={`discover-list-${l.id}`}>
              <span className="flex flex-col gap-0.5">
                <span className="text-[13px] text-ink-1">
                  {l.id.toUpperCase()} · {l.name}
                </span>
                <span className="text-[11px] leading-snug text-ink-2">{l.hint}</span>
              </span>
            </DropdownMenuRadioItem>
          ))}
          {lists.length > 0 && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuLabel className="text-ink-3">我的 list</DropdownMenuLabel>
              {lists.map((l) => (
                <DropdownMenuRadioItem key={l.id} value={l.id} className="items-start py-1.5" data-testid="discover-list-item" data-id={l.id} data-name={l.name}>
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span className="truncate text-[13px] text-ink-1">{l.name}</span>
                    <span className="text-[11px] text-ink-2">
                      {countNodes(l.nodes)} 个节点 · {new Set(l.nodes.flatMap(allTags).map((t) => t.toLowerCase())).size} 个 tag
                    </span>
                  </span>
                </DropdownMenuRadioItem>
              ))}
            </>
          )}
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          className="text-[13px]"
          onSelect={() => {
            const l = useLists.getState().createList()
            pick(l.id)
            menu.later(() => useDiscover.getState().set({ renaming: `list-new:${l.id}` }))
          }}
          data-testid="discover-list-new"
        >
          <Icon size={14} icon={Add01Icon} className="text-ink-2" />
          新建 list
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function ListRename({ custom }: { custom: UserList }) {
  const fresh = useDiscover((s) => s.renaming === `list-new:${custom.id}`)
  const done = useRef(false)
  const finish = (value: string | null) => {
    if (done.current) return
    done.current = true
    useDiscover.getState().set({ renaming: null })
    const v = value?.trim()
    if (!v || v === custom.name) return
    if (!useLists.getState().renameList(custom.id, v)) return void toast.error(`已存在名为「${v}」的 list`)
    if (fresh) return
    toast(`已重命名为「${v}」`, { action: { label: '撤销', onClick: () => useLists.getState().undo() } })
  }
  return (
    <input
      className="ml-auto h-6 min-w-0 flex-1 rounded-md border border-lamp-text bg-work px-1.5 text-[13px] text-ink-1 outline-none"
      defaultValue={custom.name}
      autoFocus
      onFocus={(e) => e.currentTarget.select()}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Enter' && !e.nativeEvent.isComposing) finish(e.currentTarget.value)
        else if (e.key === 'Escape') finish(null)
      }}
      onBlur={(e) => finish(e.currentTarget.value)}
      aria-label={`重命名 list「${custom.name}」`}
      data-testid="discover-list-rename-input"
    />
  )
}

function ListMenu({ custom }: { custom: UserList }) {
  const menu = useAfterMenu()
  const remove = async () => {
    const tags = new Set(custom.nodes.flatMap(allTags).map((t) => t.toLowerCase())).size
    const n = countNodes(custom.nodes)
    if (n && !(await confirmDelete({ title: `删除 list「${custom.name}」？`, body: `将同时删除其中的 ${n} 个节点、${tags} 个 tag。`, action: '删除 list' }))) return
    useLists.getState().deleteList(custom.id)
    usePrefs.getState().set({ discoverList: 'b' })
    toast(`已删除 list「${custom.name}」`, {
      action: {
        label: '撤销',
        onClick: () => {
          useLists.getState().undo()
          usePrefs.getState().set({ discoverList: custom.id })
        },
      },
    })
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="size-7 shrink-0 text-ink-2" aria-label="这份 list 的操作" data-testid="discover-list-menu">
          <Icon icon={MoreHorizontalIcon} size={16} />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-40" onCloseAutoFocus={menu.onCloseAutoFocus}>
        <DropdownMenuItem className="text-[13px]" onSelect={() => menu.later(() => useDiscover.getState().set({ renaming: `list:${custom.id}` }))} data-testid="discover-list-rename">
          <Icon size={14} icon={PencilEdit02Icon} className="text-ink-2" />
          重命名
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" className="text-[13px]" onSelect={() => void remove()} data-testid="discover-list-delete">
          <Icon size={14} icon={Delete02Icon} />
          删除 list…
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function LocateBar({ onSelect }: { onSelect: (path: string) => void }) {
  const located = useDiscover((s) => s.located)
  const go = (d: number) => {
    const l = useDiscover.getState().located
    if (!l || l.paths.length < 2) return
    const i = (l.i + d + l.paths.length) % l.paths.length
    useDiscover.getState().setLocated({ ...l, i })
    onSelect(l.paths[i])
  }
  const n = located?.paths.length ?? 0
  return (
    <AnimatePresence initial={false}>
      {located && (
        <motion.div
          key="locate"
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ duration: 0.16, ease: [0.2, 0, 0, 1] }}
          className="overflow-hidden"
          data-locate-keep=""
        >
          <div className="mt-1.5 flex h-7 items-center gap-1 rounded-md pr-1 pl-2 text-[12px]" style={SEL_BG} data-testid="discover-locate">
            <span className="min-w-0 flex-1 truncate text-ink-2">
              <b className="font-medium text-ink-1">{located.name}</b> {n === 1 ? '在 1 处' : `在 ${n} 处`}
            </span>
            {n > 1 && (
              <>
                <button type="button" className="grid size-5 place-items-center rounded text-ink-2 hover:bg-surface-2" onClick={() => go(-1)} aria-label="上一处" data-testid="discover-locate-prev">
                  <Icon icon={ArrowLeft01Icon} size={16} />
                </button>
                <span className="text-[11px] text-ink-2 tabular-nums" data-testid="discover-locate-pos">
                  {located.i + 1}/{n}
                </span>
                <button type="button" className="grid size-5 place-items-center rounded text-ink-2 hover:bg-surface-2" onClick={() => go(1)} aria-label="下一处" data-testid="discover-locate-next">
                  <Icon icon={ArrowRight01Icon} size={16} />
                </button>
              </>
            )}
            <button type="button" className="grid size-5 place-items-center rounded text-ink-2 hover:bg-surface-2 hover:text-ink-1" onClick={() => useDiscover.getState().setLocated(null)} aria-label="清除定位" data-testid="discover-locate-clear">
              <Icon icon={Cancel01Icon} size={14} />
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

interface BranchProps {
  node: ListNode
  counts: Map<string, number>
  nodePath: string
  marks: Set<string>
  isOpen: (path: string) => boolean
  onSelect: (path: string) => void
  onToggle: (path: string) => void
  custom: UserList | null
}

const Branch = memo(function Branch({ node, ...p }: BranchProps) {
  return (
    <>
      {node.children
        .filter((c) => p.custom || (p.counts.get(c.path) ?? 0) > 0)
        .map((c) => (
          <TreeNode key={c.path} node={c} {...p} />
        ))}
    </>
  )
})

function TreeNode({ node, ...p }: BranchProps) {
  const branch = node.children.length > 0
  const open = branch && p.isOpen(node.path)
  const selected = node.path === p.nodePath
  const editable = !!p.custom && !!node.id
  const marked = p.marks.has(node.path) || (!open && [...p.marks].some((m) => m.startsWith(`${node.path}/`)))
  const renaming = useDiscover((s) => editable && s.renaming === node.id)
  const dragging = useDiscover((s) => s.drag)
  const over = useDiscover((s) => (s.over && s.over.id === node.id ? s.over.pos : null))
  const drop = useDroppable({ id: `${NODE_DROP}${node.id ?? node.path}`, disabled: !editable || !dragging })
  const drag = useDraggable({ id: `${NODE_DRAG}${node.id ?? node.path}`, disabled: !editable || renaming })
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!selected) return
    const id = setTimeout(() => ref.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }), 200)
    return () => clearTimeout(id)
  }, [selected])
  const overStyle: CSSProperties =
    over === 'inside' ? { ...SEL_BG, outline: '1.5px solid var(--accent-text)', outlineOffset: -1.5 } : over === 'before' ? { boxShadow: 'inset 0 2px 0 var(--accent-text)' } : over === 'after' ? { boxShadow: 'inset 0 -2px 0 var(--accent-text)' } : {}
  const row = (
    <div
      ref={(el) => {
        ref.current = el
        drop.setNodeRef(el)
        drag.setNodeRef(el)
      }}
      {...(editable && !renaming ? { ...drag.attributes, ...drag.listeners } : {})}
      role="treeitem"
      aria-selected={selected}
      aria-expanded={branch ? open : undefined}
      tabIndex={0}
      className={cn(
        'flex h-7 shrink-0 cursor-default items-center gap-1 rounded-md pr-1.5 transition-[background-color,opacity,box-shadow] duration-(--dur-fast) data-[state=open]:bg-surface-2',
        !selected && !over && 'hover:bg-surface-2',
        drag.isDragging && 'opacity-40',
      )}
      style={{ paddingLeft: 4 + (node.depth - 1) * INDENT, ...(selected ? SEL_BG : {}), ...overStyle }}
      onClick={() => {
        if (renaming) return
        p.onSelect(node.path)
        if (branch && !open) p.onToggle(node.path)
      }}
      onDoubleClick={() => editable && useDiscover.getState().set({ renaming: node.id! })}
      onKeyDown={(e) => {
        if (renaming) return
        if (e.key === 'Enter') p.onSelect(node.path)
        if (branch && (e.key === 'ArrowRight' || e.key === 'ArrowLeft') && open !== (e.key === 'ArrowRight')) p.onToggle(node.path)
      }}
      data-testid="discover-node"
      data-node={node.path}
      data-title={node.title}
      data-selected={selected ? '' : undefined}
      data-over={over ?? undefined}
    >
      <span
        className="grid size-4 shrink-0 place-items-center rounded-sm text-ink-2 hover:bg-surface-3"
        onClick={(e) => {
          if (!branch) return
          e.stopPropagation()
          p.onToggle(node.path)
        }}
        onDoubleClick={(e) => e.stopPropagation()}
      >
        {branch && <Icon icon={open ? ArrowDown01Icon : ArrowRight01Icon} size={14} />}
      </span>
      {renaming ? (
        <NodeRename custom={p.custom!} id={node.id!} initial={node.title} />
      ) : (
        <span className={cn('min-w-0 flex-1 truncate text-[13px]', node.atom && !branch ? 'text-ink-2' : 'text-ink-1', selected && 'font-medium text-ink-1')}>{node.title}</span>
      )}
      <Tip label={marked ? '搜索结果所在位置' : undefined}>
        <span
          className="size-1.5 shrink-0 rounded-full transition-opacity duration-(--dur)"
          style={{ background: 'var(--accent-text)', opacity: marked ? 1 : 0 }}
          data-mark={marked ? '' : undefined}
        />
      </Tip>
      {!renaming && <span className="text-[11px] text-ink-2 tabular-nums">{p.counts.get(node.path)}</span>}
    </div>
  )
  return (
    <>
      {editable ? <NodeMenu custom={p.custom!} node={node} onSelect={p.onSelect} nodePath={p.nodePath}>{row}</NodeMenu> : row}
      <AnimatePresence initial={false}>
        {open && (
          <motion.div key="kids" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.16, ease: [0.2, 0, 0, 1] }} className="flex flex-col overflow-hidden">
            <Branch node={node} {...p} />
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}

function NodeMenu({ custom, node, nodePath, onSelect, children }: { custom: UserList; node: ListNode; nodePath: string; onSelect: (path: string) => void; children: ReactElement }) {
  const menu = useAfterMenu()
  const addChild = () => {
    const n = useLists.getState().addNode(custom.id, node.id!)
    if (!n) return
    const s = usePrefs.getState()
    s.set({ discoverOpen: { ...s.discoverOpen, [`${custom.id}:${node.path}`]: true } })
    onSelect(`${node.path}/${n.id}`)
    menu.later(() => useDiscover.getState().set({ renaming: n.id }))
  }
  const remove = async () => {
    const data = findListNode(custom.nodes, node.id!)
    if (!data) return
    const tags = allTags(data).length
    const kids = countNodes(data.children)
    if ((tags || kids) && !(await confirmDelete({ title: `删除节点「${node.title}」？`, body: `将同时删除其中的 ${tags} 个 tag${kids ? `、${kids} 个子节点` : ''}。`, action: '删除节点' }))) return
    useLists.getState().deleteNode(custom.id, node.id!)
    if (nodePath === node.path || nodePath.startsWith(`${node.path}/`)) onSelect(node.path.split('/').slice(0, -1).join('/'))
    toast(`已删除节点「${node.title}」`, { action: { label: '撤销', onClick: () => useLists.getState().undo() } })
  }
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent className="w-44" onCloseAutoFocus={menu.onCloseAutoFocus} data-testid="discover-node-menu">
        <ContextMenuItem onSelect={addChild} data-testid="discover-node-add-child">
          <Icon size={14} icon={FolderAddIcon} />
          新建子节点
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => menu.later(() => useDiscover.getState().set({ renaming: node.id! }))} data-testid="discover-node-rename">
          <Icon size={14} icon={PencilEdit02Icon} />
          重命名
          <ContextMenuShortcut>F2</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem variant="destructive" onSelect={() => void remove()} data-testid="discover-node-delete">
          <Icon size={14} icon={Delete02Icon} />
          删除节点…
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}

function NodeRename({ custom, id, initial }: { custom: UserList; id: string; initial: string }) {
  const done = useRef(false)
  const finish = (value: string | null) => {
    if (done.current) return
    done.current = true
    useDiscover.getState().set({ renaming: null })
    if (value !== null) useLists.getState().renameNode(custom.id, id, value)
  }
  return (
    <input
      className="h-6 min-w-0 flex-1 rounded-md border border-lamp-text bg-work px-1.5 text-[13px] text-ink-1 outline-none"
      defaultValue={initial}
      autoFocus
      onFocus={(e) => e.currentTarget.select()}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Enter' && !e.nativeEvent.isComposing) finish(e.currentTarget.value)
        else if (e.key === 'Escape') finish(null)
      }}
      onBlur={(e) => finish(e.currentTarget.value)}
      aria-label={`重命名「${initial}」`}
      data-testid="discover-node-rename-input"
    />
  )
}
