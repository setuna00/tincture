import { useDraggable, useDroppable } from '@dnd-kit/core'
import { useMemo, useRef, useState, type CSSProperties } from 'react'
import type { IconSvgElement } from '@hugeicons/react'
import { ArrowDown01Icon, ArrowRight01Icon, Book02Icon, BookOpen02Icon, Delete02Icon, Folder01Icon, FolderOpenIcon, Layers01Icon, PencilEdit02Icon, UserMultipleIcon } from '@hugeicons/core-free-icons'
import { Icon } from '@/components/icon'
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuShortcut, ContextMenuTrigger } from '@/components/ui/context-menu'
import { ScrollArea } from '@/components/ui/scroll-area'
import { PaneHeader } from '@/components/assistant/panel'
import { folderPaths, inPath, parentPath, workNames } from '@/lib/library-ops'
import { cn } from '@/lib/utils'
import { useLibrary } from '@/store/library'
import { canDrop, FOLDER_DRAG, NODE_DROP, useLibDrag } from './drag'
import { deleteNode, mergeInto, renameNode } from './ops'
import { ALL_CHARACTERS, ALL_SECTIONS, folderNode, kindOf, nodeLabel, openNode, useLibPage, workNode } from './state'

export const SEL_BG: CSSProperties = { background: 'color-mix(in srgb, var(--accent) 13%, var(--shell))' }
const INDENT = 14

export function LibraryTree() {
  const sections = useLibrary((s) => s.sectionTemplates)
  const chars = useLibrary((s) => s.characterTemplates)
  const folders = useMemo(() => folderPaths(sections.map((t) => t.folder)), [sections])
  const works = useMemo(() => workNames(chars.map((t) => t.work)), [chars])
  const closed = useLibPage((s) => s.closed)
  const dragKind = useLibDrag((s) => (s.active ? (s.active.type === 'folder' ? 's' : s.active.kind) : null))
  const shownFolders = folders.filter((f) => !folders.some((g) => closed[folderNode(g)] && inPath(f, g) && f !== g))
  return (
    <aside className="flex w-(--lib-tree-w) shrink-0 flex-col border-r border-line bg-shell" data-testid="lib-tree">
      <PaneHeader title="模板管理" />
      <ScrollArea className="min-h-0 flex-1">
        <div className="flex flex-col gap-3 px-2 py-2">
          <div className={cn('flex flex-col transition-opacity duration-(--dur)', dragKind === 'c' && 'opacity-40')}>
            <RootRow node={ALL_SECTIONS} icon={Layers01Icon} count={sections.length} />
            {!closed[ALL_SECTIONS] && (
              <>
                {shownFolders.map((f) => (
                  <NodeRow key={f} node={folderNode(f)} depth={f.split('/').length} count={sections.filter((t) => inPath(t.folder, f)).length} branch={folders.some((g) => parentPath(g) === f)} />
                ))}
                {sections.length > 0 && <NodeRow node={folderNode('')} depth={1} count={sections.filter((t) => !t.folder).length} />}
              </>
            )}
          </div>
          <div className="mx-1 border-t border-line" />
          <div className={cn('flex flex-col transition-opacity duration-(--dur)', dragKind === 's' && 'opacity-40')}>
            <RootRow node={ALL_CHARACTERS} icon={UserMultipleIcon} count={chars.length} />
            {!closed[ALL_CHARACTERS] && (
              <>
                {works.map((w) => (
                  <NodeRow key={w} node={workNode(w)} depth={1} count={chars.filter((t) => t.work?.trim() === w).length} />
                ))}
                {chars.length > 0 && <NodeRow node={workNode('')} depth={1} count={chars.filter((t) => !t.work?.trim()).length} />}
              </>
            )}
          </div>
        </div>
      </ScrollArea>
    </aside>
  )
}

function Arrow({ node, open }: { node: string; open: boolean }) {
  return (
    <button
      type="button"
      className="grid size-4 shrink-0 place-items-center rounded-sm text-ink-2 hover:bg-surface-3"
      onClick={(e) => {
        e.stopPropagation()
        const s = useLibPage.getState()
        s.set({ closed: { ...s.closed, [node]: open } })
      }}
      onDoubleClick={(e) => e.stopPropagation()}
      aria-label={open ? '收起' : '展开'}
      data-testid="lib-tree-arrow"
    >
      <Icon icon={open ? ArrowDown01Icon : ArrowRight01Icon} size={14} />
    </button>
  )
}

function RootRow({ node, icon, count }: { node: string; icon: IconSvgElement; count: number }) {
  const selected = useLibPage((s) => s.node === node)
  const open = useLibPage((s) => !s.closed[node])
  return (
    <div
      role="button"
      tabIndex={0}
      className={cn('flex h-7 shrink-0 cursor-default items-center gap-1.5 rounded-md px-1 transition-colors duration-(--dur-fast)', selected ? 'text-ink-1' : 'text-ink-2 hover:bg-surface-2')}
      style={selected ? SEL_BG : undefined}
      onClick={() => openNode(node)}
      onKeyDown={(e) => e.key === 'Enter' && openNode(node)}
      aria-current={selected || undefined}
      data-testid="lib-node"
      data-node={node}
    >
      {count > 0 ? <Arrow node={node} open={open} /> : <span className="w-4 shrink-0" />}
      <Icon icon={icon} size={14} className="shrink-0 text-ink-2" />
      <span className="flex-1 truncate text-[12px] font-medium">{nodeLabel(node)}</span>
      <span className="text-[11px] text-ink-2 tabular-nums">{count}</span>
    </div>
  )
}

function NodeRow({ node, depth, count, branch }: { node: string; depth: number; count: number; branch?: boolean }) {
  const kind = kindOf(node)
  const group = node.slice(2) !== '∅'
  const path = node.slice(2)
  const selected = useLibPage((s) => s.node === node || (kind === 's' && group && s.node.startsWith(`s:${path}/`) && !!s.closed[node]))
  const renaming = useLibPage((s) => s.renaming === node)
  const open = useLibPage((s) => !s.closed[node])
  const droppable = useLibDrag((s) => canDrop(s.active, node))
  const { setNodeRef: dropRef, isOver } = useDroppable({ id: `${NODE_DROP}${node}`, disabled: !droppable })
  const drag = useDraggable({ id: `${FOLDER_DRAG}${path}`, disabled: kind !== 's' || !group || renaming })
  const over = isOver && droppable
  const label = nodeLabel(node)
  const [note, setNote] = useState<{ text: string; on: boolean } | null>(null)
  const onDraft = (value: string | null) => {
    const m = value === null ? null : mergeInto(node, value)
    setNote((prev) => (m ? { text: `将并入「${m.name}」· 共 ${m.count} 个`, on: true } : prev && { ...prev, on: false }))
  }
  const icon = kind === 's' ? (selected || (open && branch) ? FolderOpenIcon : Folder01Icon) : selected ? BookOpen02Icon : Book02Icon
  const row = (
      <div
        ref={(el) => {
          dropRef(el)
          if (kind === 's' && group) drag.setNodeRef(el)
        }}
        {...(kind === 's' && group && !renaming ? { ...drag.attributes, ...drag.listeners } : {})}
        role="button"
        tabIndex={0}
        className={cn(
          'relative flex h-7 shrink-0 cursor-default items-center gap-1.5 rounded-md pr-1.5 transition-[background-color,opacity] duration-(--dur-fast) data-[state=open]:bg-surface-2',
          !selected && !over && 'hover:bg-surface-2',
          drag.isDragging && 'opacity-40',
        )}
        style={{ paddingLeft: 4 + (depth - 1) * INDENT + 4, ...(selected || over ? SEL_BG : {}), ...(over ? { outline: '1.5px solid var(--accent-text)', outlineOffset: -1.5 } : {}) }}
        onClick={() => !renaming && openNode(node)}
        onDoubleClick={() => group && useLibPage.getState().set({ renaming: node })}
        onKeyDown={(e) => {
          if (renaming) return
          if (e.key === 'Enter') openNode(node)
        }}
        aria-current={selected || undefined}
        data-testid="lib-node"
        data-node={node}
        data-over={over ? '' : undefined}
        data-droppable={droppable ? '' : undefined}
      >
        <span className="w-4 shrink-0">{branch && <Arrow node={node} open={open} />}</span>
        <Icon icon={icon} size={14} className="shrink-0 text-ink-2" />
        {renaming ? (
          <RenameInput node={node} initial={label} onDraft={onDraft} />
        ) : (
          <span className={cn('min-w-0 flex-1 truncate text-[13px]', group ? 'text-ink-1' : 'text-ink-3', selected && group && 'font-medium')}>{label}</span>
        )}
        {!renaming && <span className="text-[11px] text-ink-2 tabular-nums">{count}</span>}
      </div>
  )
  if (!group) return row
  return (
    <>
    <ContextMenu>
      <ContextMenuTrigger asChild>{row}</ContextMenuTrigger>
      <ContextMenuContent className="w-44" data-testid="lib-node-menu">
        <ContextMenuItem onSelect={() => useLibPage.getState().set({ renaming: node })} data-testid="lib-node-rename">
          <Icon size={14} icon={PencilEdit02Icon} />
          重命名
          <ContextMenuShortcut>F2</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem variant="destructive" onSelect={() => void deleteNode(node)} data-testid="lib-node-delete">
          <Icon size={14} icon={Delete02Icon} />
          删除{kind === 's' ? '目录' : '作品'}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
      {renaming && <MergeNote text={note?.text ?? ''} on={!!note?.on} indent={4 + (depth - 1) * INDENT + 4 + 16 + 6 + 14 + 6 + 7} />}
    </>
  )
}

function MergeNote({ text, on, indent }: { text: string; on: boolean; indent: number }) {
  return (
    <div className={cn('grid transition-[grid-template-rows,opacity] duration-(--dur)', on ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0')} aria-live="polite" data-testid="lib-merge-note" data-state={on ? 'on' : 'off'}>
      <div className="min-h-0 overflow-hidden">
        <p className="pt-0.5 pr-1.5 pb-1 text-[12px] leading-4 text-lamp-text" style={{ paddingLeft: indent }}>
          {text}
        </p>
      </div>
    </div>
  )
}

function RenameInput({ node, initial, onDraft }: { node: string; initial: string; onDraft: (v: string | null) => void }) {
  const done = useRef(false)
  const finish = (value: string | null) => {
    if (done.current) return
    done.current = true
    useLibPage.getState().set({ renaming: null })
    onDraft(null)
    if (value !== null) renameNode(node, value)
  }
  return (
    <input
      className="h-6 min-w-0 flex-1 rounded-md border border-lamp-text bg-work px-1.5 text-[13px] text-ink-1 outline-none"
      defaultValue={initial}
      autoFocus
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => onDraft(e.currentTarget.value)}
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
      data-testid="lib-rename-input"
    />
  )
}
