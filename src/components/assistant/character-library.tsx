import { useDraggable } from '@dnd-kit/core'
import { useContext, useMemo, type ReactNode } from 'react'
import { toast } from 'sonner'
import { Add01Icon, ArrowDown01Icon, ArrowRight01Icon, Book02Icon, BookOpen02Icon, Delete02Icon, MoreHorizontalIcon, PencilEdit02Icon, StarIcon } from '@hugeicons/core-free-icons'
import { AnimatePresence, motion } from 'motion/react'
import { GenderIcon } from '@/components/gender'
import { Icon } from '@/components/icon'
import { Button } from '@/components/ui/button'
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from '@/components/ui/context-menu'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { characterLabel } from '@/lib/character-label'
import { sectionVars } from '@/components/editor/labels'
import { LangText } from '@/components/tag-name'
import { characterFromTemplate } from '@/lib/char-template'
import { chipLiteral } from '@/lib/nai'
import { chipZh } from '@/lib/tagdb'
import { cn } from '@/lib/utils'
import { confirmDelete } from '@/store/confirm'
import { DocStoreContext, useMaybeDoc } from '@/store/context'
import { charOfSection, type DocState } from '@/store/doc'
import { favCharacter, useLibrary, type CharacterTemplate } from '@/store/library'
import { usePrefs } from '@/store/prefs'
import { useUi } from '@/store/ui'
import type { Doc } from '@/types'
import { maxCharacters } from '@/lib/nai-models'
import { openTemplateCreate, openTemplateEdit } from './template-edit'
import { CharacterSections, charTemplateCounts, TemplateImage } from './template-preview'
import { Group, INDENT, noDrag, StarButton, useTemplateQuery } from './template-panel'
import { docUndoToast } from '@/components/undo-toast'
import { Tip } from '@/components/tip'

export const CHAR_TEMPLATE_DRAG_PREFIX = 'ctpl:'
/** dnd-kit requires unique IDs even when the same template appears in multiple groups; include the group scope. */
export const charDragId = (scope: string, id: string) => `${CHAR_TEMPLATE_DRAG_PREFIX}${scope}|${id}`
export const charTemplateIdFromDrag = (id: string) => id.slice(id.lastIndexOf('|') + 1)

const preview = (t: CharacterTemplate) => t.prompt.flatMap((s) => s.chips.map((c) => chipLiteral(c))).join(', ')
const previewZh = (t: CharacterTemplate) => t.prompt.flatMap((s) => s.chips.map((c) => chipZh(c) ?? chipLiteral(c))).join('，')
export const CharPreview = ({ t }: { t: CharacterTemplate }) => <LangText en={preview(t)} zh={previewZh(t)} />
export const charKeywords = (t: CharacterTemplate) => [t.name, t.work ?? '', t.note ?? '', preview(t), previewZh(t)]

export function matchesCharacter(t: CharacterTemplate, q: string) {
  const hay = [t.name, t.work ?? '', t.note ?? '', ...[...t.prompt, ...t.uc].flatMap((s) => s.chips.flatMap((c) => [c.text, chipZh(c) ?? '']))].join('\n').toLowerCase()
  return q
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((w) => hay.includes(w))
}

function defaultTarget(doc: Doc): { after: string } | undefined {
  const ui = useUi.getState()
  const id = ui.focusCharacterId ?? (ui.focusSectionId ? charOfSection(doc, ui.focusSectionId) : null)
  return id && doc.characters.some((c) => c.id === id) ? { after: id } : undefined
}

function useAddLabel(): string {
  const target = useUi((s) => s.focusCharacterId ?? s.focusSectionId)
  return useMaybeDoc((s: DocState) => {
    const id = target && (s.doc.characters.some((c) => c.id === target) ? target : charOfSection(s.doc, target))
    const i = id ? s.doc.characters.findIndex((c) => c.id === id) : -1
    return i >= 0 ? `添加到「${characterLabel(s.doc, s.doc.characters[i])}」后面` : '添加到角色末尾'
  }, '添加角色')
}

export function useAddCharacter() {
  const store = useContext(DocStoreContext)
  return (t: CharacterTemplate, at?: { after: string } | { index: number }) => {
    if (!store) return void toast.error('请先新建或打开文档')
    const actions = store.getState()
    const c = characterFromTemplate(t)
    if (!actions.insertCharacter(c, at ?? defaultTarget(actions.doc))) return void toast.error(`最多 ${maxCharacters(actions.doc.settings.model)} 个角色`)
    useUi.getState().flash(c.id)
    docUndoToast(store, `已添加角色「${t.name}」`)
  }
}

export function useRemoveCharacterTemplate() {
  return async (t: CharacterTemplate) => {
    const ok = await confirmDelete({
      title: `删除角色模板「${t.name}」？`,
      body: '已添加到文档的角色不受影响。',
      action: '删除模板',
    })
    if (!ok) return
    const lib = useLibrary.getState()
    const index = lib.characterTemplates.findIndex((x) => x.id === t.id)
    const favIndex = lib.favorites.indexOf(favCharacter(t.id))
    lib.removeCharacterTemplate(t.id)
    toast(`已删除角色模板「${t.name}」`, { action: { label: '撤销', onClick: () => useLibrary.getState().restoreCharacterTemplate(t, index, favIndex) } })
  }
}

const NO_WORK = ''
function byWork(list: CharacterTemplate[]) {
  const groups = new Map<string, CharacterTemplate[]>()
  for (const t of list) {
    const w = t.work?.trim() || NO_WORK
    groups.set(w, [...(groups.get(w) ?? []), t])
  }
  return [...groups].sort(([a], [b]) => (a === NO_WORK ? 1 : b === NO_WORK ? -1 : a.localeCompare(b, 'zh')))
}

function revealInLibrary(t: CharacterTemplate) {
  const work = t.work?.trim() || NO_WORK
  const prefs = usePrefs.getState()
  if (prefs.openFolders[`work-closed:${work}`]) prefs.toggleFolder(`work-closed:${work}`)
  const query = useTemplateQuery.getState()
  if (query.q.trim() && !matchesCharacter(t, query.q.trim())) query.setQ('')
  query.setOpen(charDragId(`w:${work}`, t.id))
}

export function CharacterLibrary({ q }: { q: string }) {
  const all = useLibrary((s) => s.characterTemplates)
  const favKeys = useLibrary((s) => s.favorites)
  const add = useAddCharacter()
  const visible = useMemo(() => (q ? all.filter((t) => matchesCharacter(t, q)) : all), [all, q])
  const favs = useMemo(() => {
    const byId = new Map(visible.map((t) => [t.id, t]))
    return favKeys.flatMap((k) => (k.startsWith('character:') ? (byId.get(k.slice(10)) ?? []) : []))
  }, [visible, favKeys])
  const groups = useMemo(() => byWork(visible), [visible])
  if (!all.length)
    return (
      <div className="flex flex-col items-start gap-2 px-1">
        <p className="text-[12px] leading-relaxed text-ink-2" data-testid="char-library-empty">
          暂无角色模板。选中角色后点击「保存为角色模板」。
        </p>
        <Button variant="outline" size="sm" onClick={() => openTemplateCreate({ work: '', onCreated: revealInLibrary })} data-testid="char-library-new">
          <Icon icon={Add01Icon} size={14} />
          新建角色模板
        </Button>
      </div>
    )
  if (!visible.length) return <p className="px-1 text-[12px] text-ink-2">未找到匹配「{q}」的角色</p>
  return (
    <div className="flex flex-col gap-2" data-testid="char-library">
      <Group id="chr-fav" title="收藏" count={favs.length} star forceOpen={!!q} hidden={!!q && !favs.length}>
        {favs.length ? (
          favs.map((t) => <CharacterTemplateRow key={t.id} t={t} depth={0} dragId={charDragId('★', t.id)} onAdd={add} note={t.work?.trim() || '无所属作品'} />)
        ) : (
          <p className="py-1 pl-6 text-[11px] leading-relaxed text-ink-2">点击角色旁的 ☆ 收藏</p>
        )}
      </Group>
      <div className="mx-1 border-t border-line" />
      <Group id="chr-works" title="全部作品" count={visible.length} forceOpen={!!q}>
        {groups.map(([work, list]) => (
          <WorkGroup key={work || '∅'} work={work} list={list} forceOpen={!!q} onAdd={add} />
        ))}
      </Group>
    </div>
  )
}

function WorkGroup({ work, list, forceOpen, onAdd }: { work: string; list: CharacterTemplate[]; forceOpen: boolean; onAdd: (t: CharacterTemplate) => void }) {
  const key = `work-closed:${work}`
  const closed = usePrefs((s) => !!s.openFolders[key])
  const toggle = usePrefs((s) => s.toggleFolder)
  const open = forceOpen || !closed
  return (
    <>
      <button
        type="button"
        className="flex h-7 shrink-0 items-center gap-1.5 rounded-md pr-1 text-left hover:bg-surface-2"
        style={{ paddingLeft: 4 }}
        onClick={() => toggle(key)}
        aria-expanded={open}
        data-lib-nav="toggle"
        data-testid="work-row"
        data-work={work}
      >
        <Icon icon={open ? ArrowDown01Icon : ArrowRight01Icon} size={14} className="-mx-0.5 shrink-0 text-ink-2" />
        <Icon icon={open ? BookOpen02Icon : Book02Icon} size={14} className="-mr-px shrink-0 text-ink-2" />
        <span className={cn('min-w-0 flex-1 truncate text-[13px]', work ? 'text-ink-1' : 'text-ink-3')}>{work || '无所属作品'}</span>
        <span className="w-5 shrink-0 text-right text-[11px] text-ink-2 tabular-nums">{list.length}</span>
      </button>
      {open && list.map((t) => <CharacterTemplateRow key={t.id} t={t} depth={1} dragId={charDragId(`w:${work}`, t.id)} onAdd={onAdd} />)}
    </>
  )
}

interface RowProps {
  t: CharacterTemplate
  depth: number
  dragId: string
  onAdd: (t: CharacterTemplate) => void
  note?: ReactNode
  onActivate?: () => void
}

export function CharacterTemplateRow({ t, depth, dragId, onAdd, note, onActivate }: RowProps) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: dragId })
  const fav = useLibrary((s) => s.favorites.includes(favCharacter(t.id)))
  const toggleFav = useLibrary((s) => s.toggleFavorite)
  const open = useTemplateQuery((s) => !onActivate && s.open === dragId)
  const setOpen = useTemplateQuery((s) => s.setOpen)
  const remove = useRemoveCharacterTemplate()
  const star = () => {
    toggleFav(favCharacter(t.id))
    toast(fav ? `已取消收藏「${t.name}」` : `已收藏「${t.name}」`)
  }
  return (
    <div className={cn('flex shrink-0 flex-col rounded-md transition-colors duration-(--dur)', open && 'bg-surface-2')} data-testid="char-tpl-item" data-open={open ? '' : undefined}>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div
            ref={setNodeRef}
            {...attributes}
            {...listeners}
            className="group flex h-7 shrink-0 cursor-grab items-center gap-1.5 rounded-md pr-1 transition-opacity duration-(--dur) hover:bg-surface-2 data-[dragging]:opacity-40 data-[state=open]:bg-surface-2 [[data-nodoc]_&]:cursor-pointer [[data-nodoc]_&]:opacity-50"
            style={{ paddingLeft: 2 + depth * INDENT }}
            data-dragging={isDragging ? '' : undefined}
            onClick={() => (onActivate ? onActivate() : setOpen(open ? null : dragId))}
            aria-expanded={onActivate ? undefined : open}
            data-lib-nav="detail"
            data-testid="char-tpl-row"
            data-fav={fav ? '' : undefined}
          >
            <StarButton on={fav} label={t.name} onToggle={star} testId="char-tpl-star" />
            <GenderIcon gender={t.gender} extra={t.genderExtra} size={14} />
            <span className="shrink-0 text-[13px] text-ink-1" data-testid="char-tpl-name">
              {t.name}
            </span>
            <span className={cn('min-w-0 flex-1 truncate text-[12px] text-ink-2 transition-opacity duration-(--dur)', open && 'opacity-0')} aria-hidden={open}>
              {note ?? <CharPreview t={t} />}
            </span>
            {open && <CharacterMore t={t} onRemove={remove} />}
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent className="w-44">
          <ContextMenuItem onSelect={() => (onActivate ? onActivate() : onAdd(t))} data-testid="char-tpl-menu-add">
            <Icon size={14} icon={Add01Icon} />
            {onActivate ? '插入到此角色后面' : '添加角色'}
          </ContextMenuItem>
          <ContextMenuItem onSelect={() => openTemplateEdit(t.id, 'character')} data-testid="char-tpl-menu-edit">
            <Icon size={14} icon={PencilEdit02Icon} />
            编辑
          </ContextMenuItem>
          <ContextMenuItem onSelect={star}>
            <Icon size={14} icon={StarIcon} />
            {fav ? '取消收藏' : '收藏'}
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem variant="destructive" onSelect={() => void remove(t)} data-testid="char-tpl-menu-delete">
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
            <CharacterDetails t={t} indent={2 + depth * INDENT + 26} onAdd={onAdd} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function CharacterDetails({ t, indent, onAdd }: { t: CharacterTemplate; indent: number; onAdd: (t: CharacterTemplate) => void }) {
  const hasDoc = !!useContext(DocStoreContext)
  const label = useAddLabel()
  return (
    <div className="flex flex-col gap-2 pt-0.5 pr-1 pb-1.5" style={{ paddingLeft: indent }} data-testid="char-tpl-details">
      {t.imageKey && <TemplateImage imageKey={t.imageKey} className="h-[150px] w-full rounded-md" />}
      {t.note && (
        <p className="text-[12px] leading-[1.55] whitespace-pre-wrap text-ink-2" data-testid="char-tpl-note">
          {t.note}
        </p>
      )}
      <CharacterSections t={t} />
      <span className="truncate text-[11px] text-ink-2">{charTemplateCounts(t)}</span>
      <Tip label={hasDoc ? label : '请先新建或打开文档'}>
        <span className="flex">
          <Button variant="outline" size="sm" className="h-7 w-full bg-work" disabled={!hasDoc} onClick={() => onAdd(t)} data-lib-insert="" data-testid="char-tpl-add">
            <Icon icon={Add01Icon} size={14} />
            <span className="truncate">{label}</span>
          </Button>
        </span>
      </Tip>
    </div>
  )
}

function CharacterMore({ t, onRemove }: { t: CharacterTemplate; onRemove: (t: CharacterTemplate) => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" className="tpl-more shrink-0 text-ink-2" aria-label={`更多操作 ${t.name}`} {...noDrag} onClick={(e) => e.stopPropagation()} data-testid="char-tpl-more">
          <Icon icon={MoreHorizontalIcon} size={16} />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-36" onClick={(e) => e.stopPropagation()}>
        <DropdownMenuItem onSelect={() => openTemplateEdit(t.id, 'character')} data-testid="char-tpl-more-edit">
          <Icon size={14} icon={PencilEdit02Icon} />
          编辑
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onSelect={() => void onRemove(t)} data-testid="char-tpl-delete">
          <Icon size={14} icon={Delete02Icon} />
          删除模板
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function CharacterGhost({ t }: { t: CharacterTemplate }) {
  return (
    <div className="char-card w-80 shadow-(--shadow-pop)" style={sectionVars(t.color)} data-overlay="" data-testid="char-tpl-ghost">
      <header className="char-head" style={{ marginBottom: -12, borderRadius: 'calc(var(--section-radius) + 3px)', borderBottomColor: 'transparent' }}>
        <GenderIcon gender={t.gender} extra={t.genderExtra} />
        <span className="char-name text-[13px] font-semibold">{t.name}</span>
        <span className="char-preview">{charTemplateCounts(t)}</span>
      </header>
    </div>
  )
}
