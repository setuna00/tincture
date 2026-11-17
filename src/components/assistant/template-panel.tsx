import { useDraggable } from '@dnd-kit/core'
import { useContext, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react'
import { flushSync } from 'react-dom'
import { useHotkeys } from 'react-hotkeys-hook'
import { toast } from 'sonner'
import { create } from 'zustand'
import { Add01Icon, ArrowDown01Icon, ArrowRight01Icon, Cancel01Icon, Delete02Icon, DicesIcon, Folder01Icon, FolderOpenIcon, MoreHorizontalIcon, PencilEdit02Icon, Search01Icon, StarIcon } from '@hugeicons/core-free-icons'
import { AnimatePresence, motion } from 'motion/react'
import { GenderIcon } from '@/components/gender'
import { Icon } from '@/components/icon'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card'
import { useCommandState } from 'cmdk'
import { Command, CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from '@/components/ui/context-menu'
import { Kbd } from '@/components/ui/kbd'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { sectionTint } from '@/components/editor/labels'
import { chipLiteral } from '@/lib/nai'
import type { PoolKind } from '@/lib/gacha'
import { insertRandom, RANDOM_DRAG_PREFIX, RANDOM_ROWS } from '@/components/editor/random-ops'
import { chipZh } from '@/lib/tagdb'
import { LangText } from '@/components/tag-name'
import { cn } from '@/lib/utils'
import { confirmDelete } from '@/store/confirm'
import { DocStoreContext, useMaybeDoc } from '@/store/context'
import { findSection, type DocState } from '@/store/doc'
import { favFolder, favTemplate, useLibrary, type CharacterTemplate, type SectionTemplate } from '@/store/library'
import { usePrefs, type LibraryTab } from '@/store/prefs'
import { useUi } from '@/store/ui'
import { sectionFromTemplate } from './focus'
import { ArtistFolder, useArtistGroups } from './artist-folder'
import { CharacterLibrary, charKeywords, CharPreview, matchesCharacter, useAddCharacter } from './character-library'
import { openTemplateEdit } from './template-edit'
import { CharacterPreview, TemplateChips, TemplateImage, TemplatePreview } from './template-preview'
import { AssistTabs } from '@/components/ai-chat/chat-panel'
import { AssistCollapse, PaneHeader } from './panel'
import { docUndoToast } from '@/components/undo-toast'
import { Tip } from '@/components/tip'

export const TEMPLATE_DRAG_PREFIX = 'tpl:'
/** dnd-kit requires unique IDs for repeated templates; scope IDs by tree, favorite, or favorite-folder instance. */
export const dragId = (scope: string, id: string) => `${TEMPLATE_DRAG_PREFIX}${scope}|${id}`
export const templateIdFromDrag = (id: string) => id.slice(id.lastIndexOf('|') + 1)
const TREE = 'tree'
const openKey = (scope: string, path: string) => (scope === TREE ? path : `★${path}`)

export const useTemplateQuery = create<{
  q: string
  setQ(q: string): void
  open: string | null
  setOpen(id: string | null): void
  palette: boolean
  setPalette(on: boolean): void
}>()((set) => ({
  q: '',
  setQ: (q) => set({ q }),
  open: null,
  setOpen: (open) => set({ open }),
  palette: false,
  setPalette: (palette) => set({ palette }),
}))

export function openCharacterLibrary() {
  flushSync(() => {
    usePrefs.getState().set({ libraryTab: 'characters', assistOpen: true })
    useUi.getState().blur()
  })
  const el = document.querySelector<HTMLInputElement>('[data-testid=template-filter]')
  if (el && el.offsetParent !== null && !el.closest('[inert]')) {
    el.focus()
    el.select()
  } else useTemplateQuery.getState().setPalette(true)
}

export function useInsertTemplate() {
  const store = useContext(DocStoreContext)
  return (t: SectionTemplate) => {
    if (!store) return void toast.error('请先新建或打开文档')
    const actions = store.getState()
    const doc = actions.doc
    const sec = sectionFromTemplate(t)
    const focusId = useUi.getState().focusSectionId
    actions.insertSection(sec, focusId && findSection(doc, focusId) ? { near: focusId, side: 'after' } : { box: { kind: 'base', field: 'prompt' } })
    useUi.getState().flash(sec.id)
    docUndoToast(store, `已插入区块「${t.name}」`)
  }
}

const preview = (t: SectionTemplate) => t.chips.map((c) => chipLiteral(c)).join(', ')
const previewZh = (t: SectionTemplate) => t.chips.map((c) => chipZh(c) ?? chipLiteral(c)).join('，')
const Preview = ({ t }: { t: SectionTemplate }) => <LangText en={preview(t)} zh={previewZh(t)} />

interface FolderNode {
  name: string
  path: string
  folders: FolderNode[]
  items: SectionTemplate[]
  total: number
}

function findFolder(node: FolderNode, path: string): FolderNode | null {
  if (node.path === path) return node
  for (const f of node.folders) if (path === f.path || path.startsWith(`${f.path}/`)) return findFolder(f, path)
  return null
}

function buildTree(templates: SectionTemplate[]): FolderNode {
  const root: FolderNode = { name: '', path: '', folders: [], items: [], total: 0 }
  for (const t of templates) {
    let node = root
    node.total++
    for (const part of t.folder.split('/').filter(Boolean)) {
      const path = node.path ? `${node.path}/${part}` : part
      let next = node.folders.find((f) => f.name === part)
      if (!next) node.folders.push((next = { name: part, path, folders: [], items: [], total: 0 }))
      node = next
      node.total++
    }
    node.items.push(t)
  }
  return root
}

function matches(t: SectionTemplate, q: string) {
  const hay = [t.name, t.folder, ...t.chips.flatMap((c) => [c.text, chipZh(c) ?? ''])].join('\n').toLowerCase()
  return q
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((w) => hay.includes(w))
}

export function TemplatePanel() {
  const templates = useLibrary((s) => s.sectionTemplates)
  const characters = useLibrary((s) => s.characterTemplates)
  const favKeys = useLibrary((s) => s.favorites)
  const q = useTemplateQuery((s) => s.q)
  const setQ = useTemplateQuery((s) => s.setQ)
  const tab = usePrefs((s) => s.libraryTab)
  const chatEntry = usePrefs((s) => s.chatEntry)
  const insert = useInsertTemplate()
  const addCharacter = useAddCharacter()
  const palette = useTemplateQuery((s) => s.palette)
  const setPalette = useTemplateQuery((s) => s.setPalette)
  const searchRef = useRef<HTMLInputElement>(null)
  useHotkeys(
    'mod+k',
    () => {
      const el = searchRef.current
      if (el && el.offsetParent !== null && !el.closest('[inert]')) {
        el.focus()
        el.select()
      } else setPalette(true)
    },
    { preventDefault: true, enableOnFormTags: true },
  )

  function navigate(e: React.KeyboardEvent<HTMLDivElement>) {
    const row = e.target
    if (!(row instanceof HTMLElement) || !e.currentTarget.contains(row) || row.closest('[inert]') || e.nativeEvent.isComposing) return
    const search = searchRef.current
    const kind = row.dataset.libNav
    if (row !== search && !kind) return

    if (e.key === 'ArrowDown' || (kind && e.key === 'ArrowUp')) {
      e.preventDefault()
      e.stopPropagation()
      const rows = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('[data-lib-nav]')).filter((el) => el.checkVisibility())
      const next = rows.indexOf(row) + (e.key === 'ArrowUp' ? -1 : 1)
      if (next < 0) search?.focus()
      else if (rows[next]) {
        rows[next].focus({ preventScroll: true })
        rows[next].scrollIntoView({ block: 'nearest' })
      }
    } else if (kind && e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      if (e.currentTarget.querySelector('[data-lib-nav="detail"][aria-expanded="true"]')) useTemplateQuery.getState().setOpen(null)
      else search?.focus()
    } else if (kind === 'detail' && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault()
      e.stopPropagation()
      if (e.key === 'Enter' && row.ariaExpanded === 'true') row.parentElement?.querySelector<HTMLButtonElement>('[data-lib-insert]')?.click()
      else row.click()
    }
  }

  const query = q.trim()
  const visible = useMemo(() => (query ? templates.filter((t) => matches(t, query)) : templates), [templates, query])
  const charCount = useMemo(() => (query ? characters.filter((t) => matchesCharacter(t, query)).length : characters.length), [characters, query])
  const tree = useMemo(() => buildTree(visible), [visible])
  const favorites = useMemo(() => {
    const byId = new Map(visible.map((t) => [t.id, t]))
    const folders = favKeys.flatMap((k) => (k.startsWith('folder:') ? (findFolder(tree, k.slice(7)) ?? []) : []))
    const items = favKeys.flatMap((k) => (k.startsWith('template:') ? (byId.get(k.slice(9)) ?? []) : []))
    return { folders, items, count: folders.length + items.length }
  }, [visible, tree, favKeys])

  return (
    <>
      {chatEntry === 'tab' ? (
        <AssistTabs active="library" />
      ) : (
        <PaneHeader title="模板库" count={templates.length + characters.length} testId="template-header">
          <AssistCollapse />
        </PaneHeader>
      )}
      <ScrollArea className="min-h-0 flex-1" data-testid="template-body">
        <div className="px-3 pt-2 pb-3" onKeyDown={navigate}>
        <SearchBox value={q} onChange={setQ} inputRef={searchRef}>
          <LibraryTabs tab={tab} sections={visible.length} characters={charCount} />
        </SearchBox>
        {tab === 'characters' ? (
          <div key="characters" className="page-in pt-2" data-testid="template-library-characters">
            <CharacterLibrary q={query} />
          </div>
        ) : (
          <div key="sections" className="page-in flex flex-col gap-2 pt-2" data-testid="template-library">
            <TopFolders q={query} />
            {!templates.length ? (
              <p className="px-1 text-[12px] leading-relaxed text-ink-2">暂无区块模板。选中区块后点击「保存为区块模板」。</p>
            ) : !visible.length ? (
              <p className="px-1 text-[12px] text-ink-2">未找到匹配「{query}」的模板</p>
            ) : (
              <>
                <Group id="tpl-fav" title="收藏" count={favorites.count} star forceOpen={!!query} hidden={!!query && !favorites.count}>
                  {favorites.count ? (
                    <>
                      {favorites.folders.map((f) => (
                        <Folder key={f.path} node={f} depth={0} scope={`★${f.path}`} onInsert={insert} forceOpen={!!query} favRoot />
                      ))}
                      {favorites.items.map((t) => (
                        <TemplateRow key={t.id} t={t} depth={0} dragId={dragId('★', t.id)} onInsert={insert} inFavorites />
                      ))}
                    </>
                  ) : (
                    <p className="py-1 pl-6 text-[11px] leading-relaxed text-ink-2">点击模板或目录旁的 ☆ 收藏</p>
                  )}
                </Group>
                <div className="mx-1 border-t border-line" />
                <Group id="tpl-tree" title="全部目录" count={visible.length} forceOpen={!!query}>
                  <FolderChildren node={tree} depth={0} scope={TREE} onInsert={insert} forceOpen={!!query} />
                </Group>
              </>
            )}
          </div>
        )}
        </div>
      </ScrollArea>
      <TemplatePalette open={palette} onOpenChange={setPalette} onPick={insert} onPickCharacter={addCharacter} />
    </>
  )
}

export const nameHit = (name: string, q: string) =>
  q
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((w) => name.toLowerCase().includes(w))

const RANDOM_KEY = '@random'

function TopFolders({ q }: { q: string }) {
  const rows = q && !nameHit('随机', q) ? RANDOM_ROWS.filter((r) => nameHit(r.name, q)) : RANDOM_ROWS
  const artists = useArtistGroups(q)
  if (!rows.length && !artists) return null
  return (
    <>
      <div className="flex flex-col">
        {rows.length > 0 && <RandomFolder rows={rows} forceOpen={!!q} />}
        {artists && <ArtistFolder data={artists} forceOpen={!!q} />}
      </div>
      <div className="mx-1 border-t border-line" />
    </>
  )
}

function RandomFolder({ rows, forceOpen }: { rows: typeof RANDOM_ROWS; forceOpen: boolean }) {
  const open = usePrefs((s) => forceOpen || !!s.openFolders[RANDOM_KEY])
  return (
    <div className="flex flex-col" data-testid="random-rows">
      <LibFolderRow name="随机" count={rows.length} open={open} onToggle={() => usePrefs.getState().toggleFolder(RANDOM_KEY)} depth={0} testId="lib-folder" folder="random" />
      {open && rows.map((r) => <RandomRow key={r.kind} row={r} depth={1} />)}
    </div>
  )
}

export function LibFolderRow({
  name,
  icon,
  count,
  open,
  onToggle,
  depth,
  testId,
  folder,
}: {
  name: string
  icon?: ReactNode
  count: number
  open: boolean
  onToggle: () => void
  depth: number
  testId: string
  folder: string
}) {
  return (
    <button
      type="button"
      className="flex h-7 w-full shrink-0 items-center gap-1.5 rounded-md pr-1 text-left hover:bg-surface-2"
      style={{ paddingLeft: 4 + depth * INDENT }}
      onClick={onToggle}
      aria-expanded={open}
      data-testid={testId}
      data-lib-nav="toggle"
      data-folder={folder}
    >
      <Icon icon={open ? ArrowDown01Icon : ArrowRight01Icon} size={14} className="-mx-0.5 shrink-0 text-ink-2" />
      {icon ?? <Icon icon={open ? FolderOpenIcon : Folder01Icon} size={14} className="-mr-px shrink-0 text-ink-2" />}
      <span className="min-w-0 flex-1 truncate text-[13px] text-ink-1" data-testid="lib-folder-name">
        {name}
      </span>
      <span className="w-5 shrink-0 text-right text-[11px] text-ink-2 tabular-nums">{count}</span>
    </button>
  )
}

function useInsertRandom() {
  const store = useContext(DocStoreContext)
  return (kind: PoolKind) => {
    if (!store) return void toast.error('请先新建或打开文档')
    const focusId = useUi.getState().focusSectionId
    const at = kind !== 'char' && focusId && findSection(store.getState().doc, focusId) ? { near: focusId, side: 'after' as const } : null
    void insertRandom(store, kind, at, { toast: true })
  }
}

function RandomRow({ row, depth }: { row: (typeof RANDOM_ROWS)[number]; depth: number }) {
  const id = RANDOM_DRAG_PREFIX + row.kind
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id })
  const open = useTemplateQuery((s) => s.open === id)
  const setOpen = useTemplateQuery((s) => s.setOpen)
  const insert = useInsertRandom()
  const hasDoc = !!useContext(DocStoreContext)
  const label = useInsertLabel()
  const action = row.kind === 'char' ? '添加为新角色' : label
  return (
    <div className={cn('flex shrink-0 flex-col rounded-md transition-colors duration-(--dur)', open && 'bg-surface-2')} data-testid="random-item" data-open={open ? '' : undefined}>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div
            ref={setNodeRef}
            {...attributes}
            {...listeners}
            className="group flex h-7 shrink-0 cursor-grab items-center gap-1.5 rounded-md pr-1 transition-opacity duration-(--dur) hover:bg-surface-2 data-[dragging]:opacity-40 data-[state=open]:bg-surface-2 [[data-nodoc]_&]:cursor-pointer [[data-nodoc]_&]:opacity-50"
            style={{ paddingLeft: 2 + depth * INDENT }}
            data-dragging={isDragging ? '' : undefined}
            onClick={() => setOpen(open ? null : id)}
            aria-expanded={open}
            data-lib-nav="detail"
            data-testid="random-row"
            data-kind={row.kind}
          >
            <span className="size-5 shrink-0" aria-hidden />
            <span className="flex w-2 shrink-0 justify-center">
              <Icon icon={DicesIcon} size={14} className="random-row-dice -mx-0.5 shrink-0 text-ink-2" />
            </span>
            <span className="shrink-0 text-[13px] text-ink-1" data-testid="random-name">
              {row.name}
            </span>
            <span className={cn('min-w-0 flex-1 truncate text-[12px] text-ink-2 transition-opacity duration-(--dur)', open && 'opacity-0')} aria-hidden={open}>
              {row.hint}
            </span>
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent className="w-44">
          <ContextMenuItem onSelect={() => insert(row.kind)} data-testid="random-menu-insert">
            {row.kind === 'char' ? '添加为新角色' : '插入到当前区块后面'}
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="details"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18, ease: [0.2, 0, 0, 1] }}
            className="overflow-hidden"
          >
            <div className="flex flex-col gap-2 pt-0.5 pr-1 pb-1.5" style={{ paddingLeft: 2 + depth * INDENT + 26 }} data-testid="random-details">
              <p className="text-[12px] leading-[1.55] text-ink-2">{row.desc}</p>
              <Tip label={hasDoc ? action : '请先新建或打开文档'}>
                <span className="flex">
                  <Button variant="outline" size="sm" className="h-7 w-full bg-work" disabled={!hasDoc} onClick={() => insert(row.kind)} data-lib-insert="" data-testid="random-insert">
                    <Icon icon={Add01Icon} size={14} />
                    <span className="truncate">{action}</span>
                  </Button>
                </span>
              </Tip>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

export function RandomGhost({ kind }: { kind: PoolKind }) {
  const row = RANDOM_ROWS.find((r) => r.kind === kind)!
  return (
    <div className="section w-72" style={{ '--sh': 275 } as React.CSSProperties} data-overlay="">
      <div className="section-head">
        <span className="section-name text-ink-1!">{row.name}</span>
        <Icon icon={DicesIcon} size={14} className="random-dice text-ink-2" />
      </div>
      <div className="mt-1 truncate text-[12px] text-ink-2">{row.hint}</div>
    </div>
  )
}

function LibraryTabs({ tab, sections, characters }: { tab: LibraryTab; sections: number; characters: number }) {
  return (
    <Tabs value={tab} onValueChange={(v) => usePrefs.getState().set({ libraryTab: v as LibraryTab })} className="mt-2" data-testid="library-tabs">
      <TabsList className="w-full rounded-md p-0.5 group-data-horizontal/tabs:h-6">
        {(
          [
            ['sections', '区块', sections],
            ['characters', '角色', characters],
          ] as const
        ).map(([k, label, n]) => (
          <TabsTrigger key={k} value={k} className="rounded-[4px] text-[12px]" data-testid={`library-tab-${k}`}>
            {label}
            <span className="text-[11px] text-ink-2 tabular-nums">{n}</span>
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  )
}

function SearchBox({ value, onChange, inputRef, children }: { value: string; onChange: (v: string) => void; inputRef: RefObject<HTMLInputElement | null>; children?: ReactNode }) {
  return (
    <div className="sticky top-0 z-10 -mx-3 bg-shell px-3 pb-1">
      <div className="flex h-7 items-center gap-2 rounded-md border border-input bg-input/20 pr-2 pl-2.5 transition-colors focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/30 dark:bg-input/30">
        <Icon icon={Search01Icon} size={14} className="shrink-0 text-ink-3" />
        <input
          ref={inputRef}
          className="min-w-0 flex-1 bg-transparent text-[12px] text-ink-1 outline-none placeholder:text-ink-3"
          placeholder="搜索区块、角色"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => e.key === 'Escape' && (onChange(''), e.currentTarget.blur())}
          data-testid="template-filter"
        />
        {value ? (
          <button type="button" className="grid size-4 place-items-center rounded-sm text-ink-2 hover:text-ink-1" onClick={() => onChange('')} aria-label="清空搜索">
            <Icon icon={Cancel01Icon} size={14} />
          </button>
        ) : (
          <Kbd className="shrink-0">Ctrl K</Kbd>
        )}
      </div>
      {children}
    </div>
  )
}

export function Group({ id, title, count, star, forceOpen, hidden, children }: { id: string; title: string; count: number; star?: boolean; forceOpen?: boolean; hidden?: boolean; children: React.ReactNode }) {
  const collapsed = usePrefs((s) => !!s.collapsed[id])
  const toggle = usePrefs((s) => s.togglePanel)
  if (hidden) return null
  const open = forceOpen || !collapsed
  return (
    <div className="flex flex-col" data-testid={id} data-collapsed={open ? undefined : ''}>
      <button type="button" className="flex h-6 items-center gap-1 rounded-sm px-1 text-left hover:bg-surface-2" onClick={() => toggle(id)} aria-expanded={open} data-lib-nav="toggle" data-testid={`${id}-toggle`}>
        <Icon icon={open ? ArrowDown01Icon : ArrowRight01Icon} size={14} className="text-ink-2" />
        {star && <Icon icon={StarIcon} size={14} className="fav-on" />}
        <span className="text-[12px] font-medium text-ink-2">{title}</span>
        <span className="text-[11px] text-ink-2 tabular-nums">{count}</span>
      </button>
      {open && <div className="flex flex-col">{children}</div>}
    </div>
  )
}

export const INDENT = 14

interface FolderProps {
  node: FolderNode
  depth: number
  scope: string
  onInsert: (t: SectionTemplate) => void
  forceOpen: boolean
}

function FolderChildren({ node, depth, scope, onInsert, forceOpen }: FolderProps) {
  return (
    <>
      {node.folders.map((f) => (
        <Folder key={f.path} node={f} depth={depth} scope={scope} onInsert={onInsert} forceOpen={forceOpen} />
      ))}
      {node.items.map((t) => (
        <TemplateRow key={t.id} t={t} depth={depth} dragId={dragId(scope, t.id)} onInsert={onInsert} />
      ))}
    </>
  )
}

function Folder({ favRoot, ...props }: FolderProps & { favRoot?: boolean }) {
  const { node, depth, scope, forceOpen } = props
  const key = openKey(scope, node.path)
  const stored = usePrefs((s) => !!s.openFolders[key])
  const toggle = usePrefs((s) => s.toggleFolder)
  const fav = useLibrary((s) => s.favorites.includes(favFolder(node.path)))
  const toggleFav = useLibrary((s) => s.toggleFavorite)
  const open = forceOpen || stored
  const parent = favRoot && node.path.includes('/') ? node.path.slice(0, node.path.lastIndexOf('/')) : ''
  const star = () => {
    toggleFav(favFolder(node.path))
    toast(fav ? `已取消收藏目录「${node.name}」` : `已收藏目录「${node.name}」`)
  }
  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div
            className="group flex h-7 shrink-0 items-center rounded-md pr-1 hover:bg-surface-2 data-[state=open]:bg-surface-2"
            style={{ paddingLeft: 4 + depth * INDENT }}
            data-testid="folder-row"
            data-path={node.path}
            data-scope={scope === TREE ? 'tree' : 'fav'}
            data-fav={fav ? '' : undefined}
          >
            <button
              type="button"
              className="flex h-full min-w-0 flex-1 items-center gap-1.5 text-left"
              onClick={() => toggle(key)}
              aria-expanded={open}
              data-lib-nav="toggle"
              data-testid="template-folder"
              data-path={node.path}
            >
              <Icon icon={open ? ArrowDown01Icon : ArrowRight01Icon} size={14} className="-mx-0.5 shrink-0 text-ink-2" />
              <Icon icon={open ? FolderOpenIcon : Folder01Icon} size={14} className="-mr-px shrink-0 text-ink-2" />
              <span className="truncate text-[13px] text-ink-1">{node.name}</span>
              {parent && <span className="truncate text-[11px] text-ink-2">{parent}</span>}
            </button>
            <StarButton on={fav} label={node.name} onToggle={star} testId="folder-star" />
            <span className="w-5 shrink-0 text-right text-[11px] text-ink-2 tabular-nums">{node.total}</span>
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent className="w-44">
          <ContextMenuItem onSelect={() => toggle(key)}>
            <Icon size={14} icon={open ? ArrowRight01Icon : ArrowDown01Icon} />
            {open ? '收起' : '展开'}
          </ContextMenuItem>
          <ContextMenuItem onSelect={star} data-testid="folder-menu-fav">
            <Icon size={14} icon={StarIcon} />
            {fav ? '取消收藏目录' : '收藏目录'}
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
      {open && <FolderChildren {...props} depth={depth + 1} />}
    </>
  )
}

export function StarButton({ on, label, onToggle, testId }: { on: boolean; label: string; onToggle: () => void; testId: string }) {
  return (
    <button
      type="button"
      className={cn(
        'grid size-5 shrink-0 place-items-center rounded-sm hover:bg-surface-3',
        on ? 'fav-on' : 'text-ink-3/50 group-hover:text-ink-3 hover:!text-(--fav)',
      )}
      {...noDrag}
      onClick={(e) => {
        e.stopPropagation()
        onToggle()
      }}
      aria-label={on ? `取消收藏 ${label}` : `收藏 ${label}`}
      aria-pressed={on}
      data-testid={testId}
    >
      <Icon icon={StarIcon} size={14} />
    </button>
  )
}

export const noDrag = {
  onPointerDown: (e: React.PointerEvent) => e.stopPropagation(),
  onMouseDown: (e: React.MouseEvent) => e.stopPropagation(),
  onTouchStart: (e: React.TouchEvent) => e.stopPropagation(),
}

interface TemplateRowProps {
  t: SectionTemplate
  depth: number
  dragId: string
  onInsert: (t: SectionTemplate) => void
  inFavorites?: boolean
  note?: ReactNode
}

export function useRemoveTemplate() {
  return async (t: SectionTemplate) => {
    const ok = await confirmDelete({
      title: `删除区块模板「${t.name}」？`,
      body: '文档中已插入的区块不受影响。',
      action: '删除模板',
    })
    if (!ok) return
    const lib = useLibrary.getState()
    const index = lib.sectionTemplates.findIndex((x) => x.id === t.id)
    const favIndex = lib.favorites.indexOf(favTemplate(t.id))
    lib.removeSectionTemplate(t.id)
    toast(`已删除区块模板「${t.name}」`, { action: { label: '撤销', onClick: () => useLibrary.getState().restoreSectionTemplate(t, index, favIndex) } })
  }
}

export function TemplateRow({ t, depth, dragId, onInsert, inFavorites, note }: TemplateRowProps) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: dragId })
  const fav = useLibrary((s) => s.favorites.includes(favTemplate(t.id)))
  const toggleFav = useLibrary((s) => s.toggleFavorite)
  const open = useTemplateQuery((s) => s.open === dragId)
  const setOpen = useTemplateQuery((s) => s.setOpen)
  const remove = useRemoveTemplate()
  const toggle = () => {
    toggleFav(favTemplate(t.id))
    toast(fav ? `已取消收藏「${t.name}」` : `已收藏「${t.name}」`)
  }
  return (
    <div className={cn('flex shrink-0 flex-col rounded-md transition-colors duration-(--dur)', open && 'bg-surface-2')} data-testid="template-item" data-open={open ? '' : undefined}>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div
            ref={setNodeRef}
            {...attributes}
            {...listeners}
            className="group flex h-7 shrink-0 cursor-grab items-center gap-1.5 rounded-md pr-1 transition-opacity duration-(--dur) hover:bg-surface-2 data-[dragging]:opacity-40 data-[state=open]:bg-surface-2 [[data-nodoc]_&]:cursor-pointer [[data-nodoc]_&]:opacity-50"
            style={{ paddingLeft: 2 + depth * INDENT }}
            data-dragging={isDragging ? '' : undefined}
            onClick={() => setOpen(open ? null : dragId)}
            aria-expanded={open}
            data-lib-nav="detail"
            data-testid="template-row"
            data-fav={fav ? '' : undefined}
            data-in-favorites={inFavorites ? '' : undefined}
          >
            <StarButton on={fav} label={t.name} onToggle={toggle} testId="template-star" />
            <span className="size-2 shrink-0 rounded-full" style={{ background: sectionTint(t.color) }} />
            <span className="shrink-0 text-[13px] text-ink-1" data-testid="template-name">
              {t.name}
            </span>
            <span className={cn('min-w-0 flex-1 truncate text-[12px] text-ink-2 transition-opacity duration-(--dur)', open && 'opacity-0')} aria-hidden={open}>
              {note ?? (inFavorites && t.folder ? t.folder : <Preview t={t} />)}
            </span>
            {open && <TemplateMore t={t} onRemove={remove} />}
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent className="w-44">
          <ContextMenuItem onSelect={() => onInsert(t)}>
            <Icon size={14} icon={Add01Icon} />
            插入到当前区块后面
          </ContextMenuItem>
          <ContextMenuItem onSelect={() => openTemplateEdit(t.id)} data-testid="template-menu-edit">
            <Icon size={14} icon={PencilEdit02Icon} />
            编辑
          </ContextMenuItem>
          <ContextMenuItem onSelect={toggle} data-testid="template-menu-fav">
            <Icon size={14} icon={StarIcon} />
            {fav ? '取消收藏' : '收藏'}
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem variant="destructive" onSelect={() => void remove(t)} data-testid="template-menu-delete">
            <Icon size={14} icon={Delete02Icon} />
            删除模板
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="details"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18, ease: [0.2, 0, 0, 1] }}
            className="overflow-hidden"
          >
            <TemplateDetails t={t} indent={2 + depth * INDENT + 26} onInsert={onInsert} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function useInsertLabel(): string {
  const focus = useUi((s) => s.focusSectionId)
  return useMaybeDoc((s: DocState) => {
    const f = focus ? findSection(s.doc, focus) : null
    return f ? `插入到「${f.section.name}」后面` : '插入到正面末尾'
  }, '插入')
}

function TemplateDetails({ t, indent, onInsert }: { t: SectionTemplate; indent: number; onInsert: (t: SectionTemplate) => void }) {
  const hasDoc = !!useContext(DocStoreContext)
  const label = useInsertLabel()
  return (
    <div className="flex flex-col gap-2 pt-0.5 pr-1 pb-1.5" style={{ paddingLeft: indent }} data-testid="template-details">
      {t.imageKey && <TemplateImage imageKey={t.imageKey} className="h-[150px] w-full rounded-md" />}
      {t.note && (
        <p className="text-[12px] leading-[1.55] whitespace-pre-wrap text-ink-2" data-testid="template-note">
          {t.note}
        </p>
      )}
      <TemplateChips t={t} />
      <span className="truncate text-[11px] text-ink-2">
        {t.folder && `${t.folder} · `}
        {t.chips.length} 个 tag
      </span>
      <Tip label={hasDoc ? label : '请先新建或打开文档'}>
        <span className="flex">
          <Button variant="outline" size="sm" className="h-7 w-full bg-work" disabled={!hasDoc} onClick={() => onInsert(t)} data-lib-insert="" data-testid="template-insert">
            <Icon icon={Add01Icon} size={14} />
            <span className="truncate">{label}</span>
          </Button>
        </span>
      </Tip>
    </div>
  )
}

function TemplateMore({ t, onRemove }: { t: SectionTemplate; onRemove: (t: SectionTemplate) => Promise<void> }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          className="tpl-more shrink-0 text-ink-2"
          aria-label={`更多操作 ${t.name}`}
          {...noDrag}
          onClick={(e) => e.stopPropagation()}
          data-testid="template-more"
        >
          <Icon icon={MoreHorizontalIcon} size={16} />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-36" onClick={(e) => e.stopPropagation()}>
        <DropdownMenuItem onSelect={() => openTemplateEdit(t.id)} data-testid="template-more-edit">
          <Icon size={14} icon={PencilEdit02Icon} />
          编辑
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onSelect={() => void onRemove(t)} data-testid="template-delete">
          <Icon size={14} icon={Delete02Icon} />
          删除模板
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function usePreviewTarget(open: boolean, highlighted: string) {
  const [shown, setShown] = useState<string | null>(null)
  const target = open && highlighted ? highlighted : null
  if (shown && shown !== target) setShown(target)
  useEffect(() => {
    if (shown || !target) return
    const t = setTimeout(() => setShown(target), 300)
    return () => clearTimeout(t)
  }, [shown, target])
  return shown
}

export function TemplatePalette({
  open,
  onOpenChange,
  onPick,
  onPickCharacter,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  onPick: (t: SectionTemplate) => void
  onPickCharacter: (t: CharacterTemplate) => void
}) {
  const templates = useLibrary((s) => s.sectionTemplates)
  const characters = useLibrary((s) => s.characterTemplates)
  const [highlighted, setHighlighted] = useState('')
  const shown = usePreviewTarget(open, highlighted)
  return (
    <CommandDialog open={open} onOpenChange={onOpenChange} title="搜索模板" description="↵ 插入区块 / 添加角色">
      <Command value={highlighted} onValueChange={setHighlighted}>
        <CommandInput placeholder="搜索区块、角色：名字、目录、作品或其中的 tag" data-testid="template-palette-input" />
        <CommandList>
          <CommandEmpty>
            <PaletteEmpty />
          </CommandEmpty>
          <CommandGroup heading="区块模板">
            {templates.map((t) => (
              <HoverCard key={t.id} open={shown === t.id}>
                <HoverCardTrigger asChild>
                  <CommandItem
                    value={t.id}
                    keywords={[t.name, t.folder, preview(t), previewZh(t)]}
                    onSelect={() => {
                      onPick(t)
                      onOpenChange(false)
                    }}
                    className="flex-col items-start gap-0.5"
                    data-testid="template-palette-item"
                  >
                    <span className="flex items-center gap-1.5">
                      <span className="size-2 rounded-full" style={{ background: sectionTint(t.color) }} />
                      {t.name}
                      {t.folder && <span className="text-[11px] text-ink-2">{t.folder}</span>}
                    </span>
                    <span className="w-full truncate text-[12px] text-ink-2">
                      <Preview t={t} />
                    </span>
                  </CommandItem>
                </HoverCardTrigger>
                <HoverCardContent
                  side="right"
                  align="start"
                  sideOffset={14}
                  collisionPadding={8}
                  className="w-[268px] bg-surface-3 p-2.5 text-ink-1 shadow-(--shadow-pop) ring-line"
                  onEscapeKeyDown={() => onOpenChange(false)}
                  data-testid="template-palette-preview"
                >
                  <TemplatePreview t={t} />
                </HoverCardContent>
              </HoverCard>
            ))}
          </CommandGroup>
          {characters.length > 0 && (
            <CommandGroup heading="角色模板">
              {characters.map((t) => (
                <HoverCard key={t.id} open={shown === `c:${t.id}`}>
                  <HoverCardTrigger asChild>
                    <CommandItem
                      value={`c:${t.id}`}
                      keywords={charKeywords(t)}
                      onSelect={() => {
                        onPickCharacter(t)
                        onOpenChange(false)
                      }}
                      className="flex-col items-start gap-0.5"
                      data-testid="template-palette-character"
                    >
                      <span className="flex items-center gap-1.5">
                        <GenderIcon gender={t.gender} extra={t.genderExtra} size={14} />
                        {t.name}
                        {t.work && <span className="text-[11px] text-ink-2">{t.work}</span>}
                      </span>
                      <span className="w-full truncate text-[12px] text-ink-2">
                        <CharPreview t={t} />
                      </span>
                    </CommandItem>
                  </HoverCardTrigger>
                  <HoverCardContent
                    side="right"
                    align="start"
                    sideOffset={14}
                    collisionPadding={8}
                    className="w-[268px] bg-surface-3 p-2.5 text-ink-1 shadow-(--shadow-pop) ring-line"
                    onEscapeKeyDown={() => onOpenChange(false)}
                    data-testid="template-palette-preview"
                  >
                    <CharacterPreview t={t} />
                  </HoverCardContent>
                </HoverCard>
              ))}
            </CommandGroup>
          )}
        </CommandList>
      </Command>
    </CommandDialog>
  )
}

export function TemplateGhost({ t }: { t: SectionTemplate }) {
  return (
    <div className="section w-72" style={{ '--sh': 275 } as React.CSSProperties} data-overlay="">
      <div className="section-head">
        <span className="size-2 rounded-full" style={{ background: sectionTint(t.color) }} />
        <span className="section-name" style={{ color: sectionTint(t.color) }}>
          {t.name}
        </span>
        <span className="text-[11px] text-ink-2">{t.chips.length}</span>
      </div>
      <div className="mt-1 truncate text-[12px] text-ink-2">
        <Preview t={t} />
      </div>
    </div>
  )
}

function PaletteEmpty() {
  const q = useCommandState((s) => s.search).trim()
  return <>未找到匹配「{q}」的模板</>
}
