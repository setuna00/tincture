import { DndContext, DragOverlay, MouseSensor, pointerWithin, TouchSensor, useSensor, useSensors, type DragEndEvent, type DragStartEvent, type Modifier } from '@dnd-kit/core'
import { getEventCoordinates } from '@dnd-kit/utilities'
import { useEffect, useMemo } from 'react'
import { useHotkeys } from 'react-hotkeys-hook'
import { Add01Icon, GridViewIcon, Layers01Icon, Menu01Icon, Search01Icon, Cancel01Icon, UserMultipleIcon } from '@hugeicons/core-free-icons'
import { GenderIcon } from '@/components/gender'
import { Icon } from '@/components/icon'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { sectionTint } from '@/components/editor/labels'
import { matchesCharacter } from '@/components/assistant/character-library'
import { openTemplateCreate, openTemplateEdit, TemplateEditDialog } from '@/components/assistant/template-edit'
import { LibraryDetail } from '@/components/library/detail'
import { canDrop, FOLDER_DRAG, ITEM_DRAG, NODE_DROP, useLibDrag } from '@/components/library/drag'
import { ItemGrid, ItemList, type Item } from '@/components/library/items'
import { deleteTemplates, moveFolder, moveTemplates } from '@/components/library/ops'
import { LibraryTree } from '@/components/library/tree'
import { charsIn, isGroupNode, kindOf, NONE, nodeLabel, pathOf, sectionMatches, sectionsIn, useLibPage, validNode, workNode } from '@/components/library/state'
import { baseName, folderPaths, joinPath } from '@/lib/library-ops'
import { chipLiteral } from '@/lib/nai'
import { cn } from '@/lib/utils'
import { chipZh } from '@/lib/tagdb'
import { favCharacter, favTemplate, useLibrary, type CharacterTemplate, type SectionTemplate } from '@/store/library'
import { usePrefs } from '@/store/prefs'

const sectionItem = (t: SectionTemplate): Item => ({
  id: t.id,
  name: t.name,
  imageKey: t.imageKey,
  color: t.color,
  en: t.chips.map((c) => chipLiteral(c)).join(', '),
  zh: t.chips.map((c) => chipZh(c) ?? chipLiteral(c)).join('，'),
  where: t.folder,
  tags: t.chips.length,
  fav: favTemplate(t.id),
})
const charItem = (t: CharacterTemplate): Item => {
  const chips = t.prompt.flatMap((s) => s.chips)
  return {
    id: t.id,
    name: t.name,
    imageKey: t.imageKey,
    color: t.color,
    gender: t.gender,
    genderExtra: t.genderExtra,
    en: chips.map((c) => chipLiteral(c)).join(', '),
    zh: chips.map((c) => chipZh(c) ?? chipLiteral(c)).join('，'),
    where: t.work?.trim() ?? '',
    tags: [...t.prompt, ...t.uc].reduce((n, s) => n + s.chips.length, 0),
    fav: favCharacter(t.id),
  }
}

const nearCursor: Modifier = ({ transform, activatorEvent, draggingNodeRect }) => {
  const p = activatorEvent && getEventCoordinates(activatorEvent)
  if (!p || !draggingNodeRect) return transform
  return { ...transform, x: transform.x + p.x - draggingNodeRect.left + 14, y: transform.y + p.y - draggingNodeRect.top + 12 }
}

const overlayOpen = () => !!document.querySelector('[role=dialog], [role=menu], [role=alertdialog]')

export function LibraryPage() {
  const sections = useLibrary((s) => s.sectionTemplates)
  const chars = useLibrary((s) => s.characterTemplates)
  const rawNode = useLibPage((s) => s.node)
  const q = useLibPage((s) => s.q)
  const selected = useLibPage((s) => s.selected)
  const view = usePrefs((s) => s.libraryView)
  const set = useLibPage((s) => s.set)

  const node = validNode(rawNode, sections, chars)
  useEffect(() => {
    if (node !== rawNode) set({ node, selected: [] })
  }, [node, rawNode, set])
  const kind = kindOf(node)
  const query = q.trim()
  const items = useMemo(
    () =>
      kind === 's'
        ? sectionsIn(node, sections)
            .filter((t) => !query || sectionMatches(t, query))
            .map(sectionItem)
        : charsIn(node, chars)
            .filter((t) => !query || matchesCharacter(t, query))
            .map(charItem),
    [kind, node, sections, chars, query],
  )
  const visibleKey = items.map((i) => i.id).join()
  useEffect(() => {
    const vis = new Set(visibleKey.split(','))
    const s = useLibPage.getState()
    if (s.selected.some((id) => !vis.has(id))) s.set({ selected: s.selected.filter((id) => vis.has(id)) })
  }, [visibleKey])

  useHotkeys('mod+a', (e) => !overlayOpen() && (e.preventDefault(), set({ selected: items.map((i) => i.id) })), { enableOnFormTags: false }, [items])
  useHotkeys('delete', () => !overlayOpen() && selected.length && void deleteTemplates(kind, selected), [kind, selected])
  useHotkeys('escape', () => !overlayOpen() && selected.length && set({ selected: [], anchor: null }), [selected])
  useHotkeys(
    'f2',
    (e) => {
      if (overlayOpen()) return
      e.preventDefault()
      if (selected.length === 1) openTemplateEdit(selected[0], kind === 's' ? 'section' : 'character')
      else if (!selected.length && isGroupNode(node)) set({ renaming: node })
    },
    [selected, node, kind],
  )

  const sensors = useSensors(useSensor(MouseSensor, { activationConstraint: { distance: 4 } }), useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 6 } }))
  const onDragStart = ({ active }: DragStartEvent) => {
    const id = String(active.id)
    if (id.startsWith(FOLDER_DRAG)) useLibDrag.setState({ active: { type: 'folder', path: id.slice(FOLDER_DRAG.length) }, over: null })
    else {
      const item = id.slice(ITEM_DRAG.length)
      const sel = useLibPage.getState().selected
      const ids = sel.includes(item) ? items.map((i) => i.id).filter((x) => sel.includes(x)) : [item]
      useLibDrag.setState({ active: { type: 'items', kind, ids }, over: null })
    }
  }
  const onDragEnd = ({ over }: DragEndEvent) => {
    const { active } = useLibDrag.getState()
    useLibDrag.setState({ active: null, over: null })
    const target = over ? String(over.id).slice(NODE_DROP.length) : null
    if (!active || !target || !canDrop(active, target)) return
    const p = pathOf(target)
    const to = p === NONE ? '' : p
    if (active.type === 'folder') moveFolder(active.path, to)
    else moveTemplates(active.kind, active.ids, to)
  }

  const total = kind === 's' ? sectionsIn(node, sections).length : charsIn(node, chars).length
  const none = (kind === 's' ? sections : chars).length === 0
  const hasSub = kind === 's' && isGroupNode(node) && folderPaths(sections.map((t) => t.folder)).some((f) => f.startsWith(`${pathOf(node)}/`))
  const empty = query
    ? `未找到匹配「${query}」的模板`
    : pathOf(node) === NONE
      ? kind === 's'
        ? '根目录中暂无模板'
        : '暂无无所属作品的角色模板'
      : ''

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={pointerWithin}
      onDragStart={onDragStart}
      onDragOver={({ over }) => useLibDrag.setState({ over: over ? String(over.id).slice(NODE_DROP.length) : null })}
      onDragEnd={onDragEnd}
      onDragCancel={() => useLibDrag.setState({ active: null, over: null })}
    >
      <div className="flex h-full min-h-0" data-testid="library-page">
        <LibraryTree />
        {/* React portal events bubble through the component tree; require DOM containment so menu clicks cannot clear selection. */}
        <section
          className="flex min-w-0 flex-1 flex-col bg-work"
          onClick={(e) => e.currentTarget.contains(e.target as Node) && selected.length && set({ selected: [], anchor: null })}
        >
          <header className="app-drag flex flex-wrap items-center gap-x-3 gap-y-2 px-6 pt-5 pb-3">
            <div className="flex min-w-0 items-baseline gap-2">
              {pathOf(node) !== '' && <span className="shrink-0 text-[13px] text-ink-2">{kind === 's' ? '区块模板' : '角色模板'} /</span>}
              <h1 className="truncate text-[17px] font-semibold text-ink-1" data-testid="lib-title">
                {nodeLabel(node, true)}
              </h1>
              <span className="shrink-0 text-[12px] text-ink-2 tabular-nums" data-testid="lib-count">
                {query ? `${items.length} / ${total}` : total} 个{hasSub ? ' · 含子目录' : ''}
              </span>
            </div>
            <div className="ml-auto flex shrink-0 items-center gap-2" onClick={(e) => e.stopPropagation()}>
              <div className={cn('flex items-center gap-2', none && 'hidden')}>
                <Tabs value={view} onValueChange={(v) => usePrefs.getState().set({ libraryView: v as 'list' | 'grid' })} data-testid="lib-view">
                  <TabsList className="rounded-md p-0.5 group-data-horizontal/tabs:h-7">
                    <TabsTrigger value="list" className="gap-1 rounded-[4px] px-2 text-[12px]" data-testid="lib-view-list">
                      <Icon icon={Menu01Icon} size={14} />
                      列表
                    </TabsTrigger>
                    <TabsTrigger value="grid" className="gap-1 rounded-[4px] px-2 text-[12px]" data-testid="lib-view-grid">
                      <Icon icon={GridViewIcon} size={14} />
                      网格
                    </TabsTrigger>
                  </TabsList>
                </Tabs>
                <div className="relative w-56">
                  <Icon icon={Search01Icon} size={14} className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-ink-3" />
                  <Input
                    className="pr-7 pl-8"
                    placeholder={`搜索「${nodeLabel(node)}」`}
                    value={q}
                    onChange={(e) => set({ q: e.target.value })}
                    onKeyDown={(e) => e.key === 'Escape' && (set({ q: '' }), e.currentTarget.blur())}
                    data-testid="lib-search"
                  />
                  {q && (
                    <button type="button" className="absolute top-1/2 right-2 grid size-4 -translate-y-1/2 place-items-center rounded-sm text-ink-2 hover:text-ink-1" onClick={() => set({ q: '' })} aria-label="清空搜索">
                      <Icon icon={Cancel01Icon} size={14} />
                    </button>
                  )}
                </div>
              </div>
              {kind === 'c' && <NewCharButton node={node} testId="lib-new-char" />}
            </div>
          </header>
          {none ? (
            <div className="page-in m-auto flex flex-col items-center gap-2 pb-16 text-center" data-testid="lib-empty" data-state="none">
              <Icon icon={kind === 's' ? Layers01Icon : UserMultipleIcon} size={32} className="mb-1 text-ink-3" />
              <span className="text-[13px] text-ink-2">{kind === 's' ? '暂无区块模板' : '暂无角色模板'}</span>
              <span className="text-[12px] text-ink-2">{kind === 's' ? '在编辑器中选中区块后点击「保存为区块模板」' : '在编辑器中选中角色后点击「保存为角色模板」'}</span>
              {kind === 'c' && <NewCharButton node={node} testId="lib-empty-new-char" className="mt-2" />}
            </div>
          ) : (
          <ScrollArea className="min-h-0 flex-1" data-testid="lib-body">
            <div className="px-6 pb-6">
              {items.length ? (
                <div key={view} className="page-in">
                  {view === 'grid' ? <ItemGrid kind={kind} items={items} /> : <ItemList kind={kind} items={items} />}
                </div>
              ) : (
                <p className="py-16 text-center text-[13px] text-ink-2" data-testid="lib-empty">
                  {empty}
                </p>
              )}
            </div>
          </ScrollArea>
          )}
        </section>
        <LibraryDetail sections={sections} chars={chars} />
      </div>
      <DragOverlay dropAnimation={null} modifiers={[nearCursor]}>
        <Ghost sections={sections} chars={chars} />
      </DragOverlay>
      <TemplateEditDialog />
    </DndContext>
  )
}

function NewCharButton({ node, testId, className }: { node: string; testId: string; className?: string }) {
  const reveal = (t: CharacterTemplate) => {
    const s = useLibPage.getState()
    const shown = kindOf(s.node) === 'c' && charsIn(s.node, [t]).length > 0
    const q = s.q.trim()
    s.set({ node: shown ? s.node : workNode(t.work ?? ''), q: q && !matchesCharacter(t, q) ? '' : s.q, selected: [t.id], anchor: t.id })
  }
  return (
    <Button variant="outline" size="lg" className={className} onClick={() => openTemplateCreate({ work: isGroupNode(node) ? pathOf(node) : '', onCreated: reveal })} data-testid={testId}>
      <Icon icon={Add01Icon} size={14} />
      新建角色模板
    </Button>
  )
}

export function LibraryHint() {
  const node = useLibPage((s) => s.node)
  const n = useLibPage((s) => s.selected.length)
  const renaming = useLibPage((s) => !!s.renaming)
  const drag = useLibDrag((s) => (s.active ? s.active.type : null))
  const none = useLibrary((s) => (kindOf(node) === 's' ? s.sectionTemplates : s.characterTemplates).length === 0)
  const where = kindOf(node) === 's' ? '目录' : '作品'
  const [state, text] = renaming
    ? ['library-rename', '↵ 完成 · Esc 取消']
    : drag === 'folder'
      ? ['library-drag', '拖动到其他目录 / 根目录上 = 移入 · Esc 取消']
      : drag
        ? ['library-drag', `拖动到左侧${where}上 = 移至 · Esc 取消`]
        : none
          ? ['library', '']
          : n > 1
            ? ['library-multi', `Ctrl+点击 加选 / 取消 · Shift+点击 连选 · 拖动 整组移至左侧${where} · Del 删除 ${n} 个 · Esc 取消选择`]
            : n === 1
              ? ['library-single', `双击 / F2 编辑 · 拖动到左侧${where}上 移至 · Ctrl / Shift+点击 多选 · Del 删除 · Esc 取消选择`]
              : ['library', `单击选中 · Ctrl / Shift+点击 多选 · Ctrl+A 全选 · 双击 编辑 · 拖动到左侧${where}上 移至 · 双击${where} 重命名${isGroupNode(node) ? ' · F2 重命名当前' + where : ''} · 右键${where} 删除`]
  if (!text) return null
  return (
    <span className="truncate max-sm:hidden" data-testid="status-hint" data-state={state}>
      {text}
    </span>
  )
}

function Ghost({ sections, chars }: { sections: SectionTemplate[]; chars: CharacterTemplate[] }) {
  const active = useLibDrag((s) => s.active)
  const over = useLibDrag((s) => s.over)
  if (!active) return null
  const ok = !!over && canDrop(active, over)
  const into = ok && active.type === 'folder' ? joinPath(pathOf(over) === NONE ? '' : pathOf(over), baseName(active.path)) : null
  const merge = !!into && folderPaths(sections.map((t) => t.folder)).includes(into)
  let mark = null
  let name = ''
  let n = 1
  if (active.type === 'folder') {
    name = active.path.slice(active.path.lastIndexOf('/') + 1)
  } else {
    n = active.ids.length
    const s = sections.find((t) => t.id === active.ids[0])
    const c = chars.find((t) => t.id === active.ids[0])
    name = s?.name ?? c?.name ?? ''
    mark = c ? <GenderIcon gender={c.gender} extra={c.genderExtra} size={14} /> : s ? <span className="size-2 shrink-0 rounded-full" style={{ background: sectionTint(s.color) }} /> : null
  }
  return (
    <div className="pointer-events-none w-56" data-testid="lib-ghost">
      <div className="relative">
        {n > 1 && <div className="absolute inset-0 rounded-lg border border-line bg-work" style={{ transform: 'translate(4px, 4px)' }} />}
        <div className="relative flex h-9 items-center gap-2 rounded-lg border border-line bg-work px-2.5 shadow-(--shadow-pop)">
          {mark}
          <span className="truncate text-[13px] font-medium text-ink-1">{name}</span>
          {n > 1 && <span className="shrink-0 text-[11px] text-ink-2">等 {n} 个</span>}
        </div>
        {n > 1 && (
          <span className="absolute grid h-5 place-items-center rounded-full bg-lamp px-1.5 text-[11px] font-semibold text-lamp-ink" style={{ top: -8, right: -8, minWidth: 20 }} data-testid="lib-ghost-count">
            {n}
          </span>
        )}
      </div>
      <span
        className="mt-2 inline-block rounded-md px-2 py-1 text-[12px] whitespace-nowrap shadow-(--shadow-pop) transition-opacity duration-(--dur-fast)"
        style={{ background: 'var(--ink-1)', color: 'var(--work)', opacity: ok ? 1 : 0 }}
        data-testid="lib-ghost-hint"
      >
        {merge ? `并入「${into}」` : `移至「${over ? nodeLabel(over, true) : ''}」`}
      </span>
    </div>
  )
}

