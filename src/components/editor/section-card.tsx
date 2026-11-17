import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  Delete02Icon,
  DicesIcon,
  DragDropVerticalIcon,
  FolderExportIcon,
  FolderLibraryIcon,
  MoreHorizontalIcon,
  PencilEdit02Icon,
  Refresh01Icon,
  SquareLock02Icon,
  SquareUnlock02Icon,
  Tag01Icon,
  TextIcon,
} from '@hugeicons/core-free-icons'
import { EmptySlot, HeadButton } from '@/components/gacha/pool-card'
import { poolHeadLabel, resolveLiveSource } from '@/components/gacha/data'
import { useArtistData, useArtistPopularity } from '@/lib/artist-db'
import { usePrefs } from '@/store/prefs'
import { useCharWorks } from '@/lib/char-works'
import { countLabel, usesPopularity } from '@/lib/gacha'
import { hasScope, poolOfRule, slotsOf } from '@/lib/random-block'
import { lookupTag } from '@/lib/tagdb'
import { useLists } from '@/store/lists'
import { confirmDelete } from '@/store/confirm'
import { Icon } from '@/components/icon'
import { Button } from '@/components/ui/button'
import { ContextMenu, ContextMenuContent, ContextMenuTrigger } from '@/components/ui/context-menu'
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { useAfterMenu } from '@/components/after-menu'
import { useDraftField } from '@/components/draft-field'
import { CONTEXT_KIT, DROPDOWN_KIT, keepNativeMenuOnFields, type MenuKit } from '@/components/menu-kit'
import { KanbanColumn, KanbanColumnHandle } from '@/components/ui/kanban'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { sectionText } from '@/lib/section-text'
import { templateSaved } from '@/components/assistant/template-edit'
import { linkState, templateChips } from '@/lib/template-link'
import { allBoxes, boxKey, charOfSection, findSection } from '@/store/doc'
import { useActions, useDoc, useDocStore } from '@/store/context'
import { useDnd } from '@/store/dnd'
import { useLibrary } from '@/store/library'
import { useUi } from '@/store/ui'
import type { Chip, RandomRule, Section } from '@/types'
import { ChipItem } from './chip-item'
import { playChips } from './flip'
import { lockRandom, rerollRandom } from './random-ops'
import { ColorGrid } from './color-grid'
import { boxLabel, sectionTint, sectionVars } from './labels'
import { SectionRecs, useRecsLinger } from './section-recs'
import { TagInput } from './tag-input'
import { docUndoToast } from '@/components/undo-toast'
import { Tip } from '@/components/tip'

interface Props {
  section: Section
  chips: Chip[]
}

export const SectionCard = memo(function SectionCard({ section, chips }: Props) {
  const actions = useActions()
  const [renaming, setRenaming] = useState(false)
  const menu = useAfterMenu({ refocus: false })
  const active = chips.filter((c) => !c.disabled).length
  const dropEnd = useDnd((s) => s.hint?.sectionId === section.id && s.hint.side === 'end')
  const insert = useDnd((s) => (s.sectionHint && 'sectionId' in s.sectionHint && s.sectionHint.sectionId === section.id ? s.sectionHint.side : null))
  const state = useUi((s) => (s.focusSectionId !== section.id ? null : s.selectedChipId ? 'open' : 'selected'))
  const flash = useUi((s) => s.flashSectionId === section.id)
  const recs = useRecsLinger(!!state)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (flash) ref.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [flash])
  const order = useDnd((s) => (s.order?.sectionId === section.id ? s.order.ids : null))
  const shown = useMemo(() => {
    if (!order) return chips
    const byId = new Map(chips.map((c) => [c.id, c]))
    return order.map((id) => byId.get(id)).filter((c): c is Chip => !!c)
  }, [chips, order])
  const orderKey = shown.map((c) => c.id).join()
  useLayoutEffect(() => playChips(section.id), [orderKey, section.id])

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <KanbanColumn
          onMouseDownCapture={keepNativeMenuOnFields}
          onContextMenuCapture={keepNativeMenuOnFields}
          value={section.id}
          className="section"
          style={sectionVars(section.color)}
          data-muted={section.muted ? '' : undefined}
          data-drop-end={dropEnd ? '' : undefined}
          data-insert={insert ?? undefined}
          data-focused={state ? '' : undefined}
          data-selected={state === 'selected' ? '' : undefined}
          data-flash={flash ? '' : undefined}
          ref={ref}
          data-testid="section"
          data-section-id={section.id}
          onClick={(e) => {
            e.stopPropagation()
            useUi.getState().select(null, section.id)
          }}
        >
          <div className="section-head">
            <KanbanColumnHandle
              className="section-grip -ml-1 grid h-5 w-4 touch-none place-items-center rounded-sm hover:bg-surface-2"
              aria-label="拖动排序"
              data-testid="section-handle"
            >
              <Icon icon={DragDropVerticalIcon} size={16} />
            </KanbanColumnHandle>
            {renaming ? (
              <NameEditor value={section.name} onDone={(name) => (setRenaming(false), name && actions.updateSection(section.id, { name }))} />
            ) : (
              <Tip label="双击重命名">
                <button type="button" className="section-name truncate text-left" onDoubleClick={() => setRenaming(true)} data-testid="section-name">
                  {section.name}
                </button>
              </Tip>
            )}
            <span className="text-[11px] text-ink-2 tabular-nums">
              {active}
              {active !== chips.length && <span className="opacity-60">/{chips.length}</span>}
            </span>
            {section.random && <Icon icon={DicesIcon} size={14} className="random-dice shrink-0 text-ink-2" />}
            {section.muted && <span className="rounded bg-surface-2 px-1.5 text-[11px] text-ink-2">未启用 · 不导出</span>}

            {section.random && <RandomHead id={section.id} rule={section.random} />}
            <div className={section.random ? 'section-tools flex items-center gap-0.5' : 'section-tools ml-auto flex items-center gap-0.5'}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    className="text-ink-2"
                    onClick={() => {
                      const on = !section.textMode
                      actions.setTextMode(section.id, on)
                      const ui = useUi.getState()
                      if (on && chips.some((c) => ui.selectedChipIds.includes(c.id))) ui.select(null, section.id)
                    }}
                    aria-label={section.textMode ? '切换为 tag 显示' : '切换成文本'}
                    aria-pressed={!!section.textMode}
                    data-testid="section-text-toggle"
                  >
                    <Icon icon={section.textMode ? Tag01Icon : TextIcon} size={16} />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{section.textMode ? '切换为 tag 显示' : '切换为文本显示（整段复制、粘贴）'}</TooltipContent>
              </Tooltip>
              <SectionMenu section={section} chips={chips} onRename={() => setRenaming(true)} />
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="section-switch ml-1 grid h-5 place-items-center" onClick={(e) => e.stopPropagation()}>
                    <Switch
                      size="sm"
                      checked={!section.muted}
                      onCheckedChange={(on) => actions.updateSection(section.id, { muted: !on })}
                      aria-label={section.muted ? '启用此区块' : '停用此区块'}
                      data-testid="section-enabled"
                    />
                  </span>
                </TooltipTrigger>
                <TooltipContent>{section.muted ? '已停用，不导出 · 点击启用' : '已启用 · 关闭后不导出（保留在原位）'}</TooltipContent>
              </Tooltip>
            </div>
          </div>

          {section.textMode ? (
            <SectionTextBox sectionId={section.id} chips={chips} />
          ) : (
            <div className="section-body" data-testid="section-body">
              {section.random ? (
                <RandomBody section={section} rule={section.random} shown={shown} />
              ) : (
                <>
                  {shown.map((c) => (
                    <ChipItem key={c.id} chip={c} sectionId={section.id} />
                  ))}
                  <TagInput sectionId={section.id} />
                </>
              )}
            </div>
          )}
          {recs.show && !section.random && <SectionRecs sectionId={section.id} closing={recs.closing} />}
        </KanbanColumn>
      </ContextMenuTrigger>
      {/* React portal clicks bubble into the editor; stop menu actions from clearing selection. */}
      <ContextMenuContent className="w-48" onCloseAutoFocus={menu.onCloseAutoFocus} onClick={(e) => e.stopPropagation()}>
        <SectionMenuItems kit={CONTEXT_KIT} section={section} chips={chips} onRename={() => menu.later(() => setRenaming(true))} />
      </ContextMenuContent>
    </ContextMenu>
  )
})

function RandomHead({ id, rule }: { id: string; rule: RandomRule }) {
  const store = useDocStore()
  const lists = useLists((s) => s.lists)
  useArtistData((s) => s.list)
  useArtistPopularity(usesPopularity(rule.source))
  usePrefs((s) => s.nsfw)
  useCharWorks()
  const scoped = hasScope(rule)
  const pool = scoped ? poolOfRule(rule, resolveLiveSource) : null
  const label = !scoped ? '未选择范围' : pool ? poolHeadLabel(pool, lists, rule.off) : '加载中…'
  return (
    <span className="ml-auto flex min-w-0 items-center gap-1" data-testid="random-head">
      <span className="truncate text-[11px] text-ink-2" data-testid="random-source">
        {label}
      </span>
      <span className="ml-1 flex items-center gap-0.5">
        <HeadButton
          icon={rule.lockAll ? SquareLock02Icon : SquareUnlock02Icon}
          label={rule.lockAll ? '解锁（可重抽）' : '锁定（重抽、修改范围时保持不变）'}
          on={!!rule.lockAll}
          onClick={() => lockRandom(store, id)}
          testId="random-lock"
        />
        <HeadButton icon={Refresh01Icon} label="重抽" disabled={!scoped || !!rule.lockAll} onClick={() => void rerollRandom(store, id)} testId="random-reroll" />
      </span>
      <span className="mx-1 h-3.5 w-px bg-line" />
    </span>
  )
}

function RandomBody({ section, rule, shown }: { section: Section; rule: RandomRule; shown: Chip[] }) {
  const locked = useMemo(() => {
    const set = new Set<string>()
    if (!rule.locked?.length) return set
    for (const slot of slotsOf(rule, section.chips, (t) => lookupTag(t)?.category === 'character')) if (rule.locked.includes(slot.tag)) for (const c of slot.chips) set.add(c.id)
    return set
  }, [rule, section.chips])
  const scoped = hasScope(rule)
  const pool = scoped ? poolOfRule(rule, resolveLiveSource) : null
  const slots = rule.kind === 'char' ? slotsOf(rule, section.chips, (t) => lookupTag(t)?.category === 'character').length : section.chips.length
  const size = pool ? pool.tags.length : 0
  const empty = !scoped ? 1 : pool && rule.count[0] < size ? Math.max(0, Math.min(rule.count[1], size) - slots) : 0
  return (
    <>
      {shown.map((c) => (
        <ChipItem key={c.id} chip={c} sectionId={section.id} locked={locked.has(c.id)} />
      ))}
      {Array.from({ length: empty }, (_, i) => (
        <EmptySlot key={i} label={countLabel({ tags: pool?.tags ?? [] }, rule.count)} hint={scoped ? undefined : '请在左栏选择范围'} />
      ))}
    </>
  )
}

function SectionTextBox({ sectionId, chips }: { sectionId: string; chips: Chip[] }) {
  const actions = useActions()
  const text = useMemo(() => sectionText(chips), [chips])
  const [draft, setDraft] = useState<string | null>(null)
  const ref = useRef<HTMLTextAreaElement>(null)
  const off = chips.filter((c) => c.disabled).length
  // Unmounting a focused input does not fire blur; clear its status hint in cleanup.
  useEffect(() => () => useUi.getState().setTextEditing(false), [])
  return (
    <div className="section-text">
      <Textarea
        ref={ref}
        className="section-textarea"
        value={draft ?? text}
        placeholder="输入或粘贴 prompt，逗号分隔"
        spellCheck={false}
        data-testid="section-text"
        onFocus={() => {
          setDraft(text)
          useUi.getState().select(null, sectionId)
          useUi.getState().setTextEditing(true)
        }}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          useUi.getState().setTextEditing(false)
          if (draft !== null && draft !== text) actions.setSectionText(sectionId, draft)
          setDraft(null)
        }}
        onKeyDown={(e) => {
          if (e.nativeEvent.isComposing) return
          if (e.key === 'Escape' || (e.key === 'Enter' && (e.ctrlKey || e.metaKey))) {
            e.preventDefault()
            ref.current?.blur()
          }
        }}
      />
      {off > 0 && <p className="section-text-note">另有 {off} 个已禁用的 tag 未显示在文本中，切换为 tag 显示可查看</p>}
    </div>
  )
}

function SectionMenu({ section, chips, onRename }: { section: Section; chips: Chip[]; onRename: () => void }) {
  const menu = useAfterMenu({ refocus: false })
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-xs" className="text-ink-2" aria-label="更多" data-testid="section-more" onClick={(e) => e.stopPropagation()}>
          <Icon icon={MoreHorizontalIcon} size={16} />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48" onCloseAutoFocus={menu.onCloseAutoFocus}>
        <SectionMenuItems kit={DROPDOWN_KIT} section={section} chips={chips} onRename={() => menu.later(onRename)} />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function SectionMenuItems({ kit: K, section, chips, onRename }: { kit: MenuKit; section: Section; chips: Chip[]; onRename: () => void }) {
  const actions = useActions()
  const ops = useSectionOps()
  const clean = useLibrary((s) => linkState(section, s.sectionTemplates).state === 'clean')
  return (
    <>
      <K.Item onSelect={onRename}>
        <Icon size={14} icon={PencilEdit02Icon} />
        重命名
      </K.Item>
      <K.Label className="font-normal text-ink-3">颜色</K.Label>
      <FollowCharacter kit={K} section={section} />
      <ColorGrid value={section.color} onPick={(c) => actions.updateSection(section.id, { color: c })} testId="section-color-pick" />
      <K.Separator />
      <K.Sub>
        <K.SubTrigger>
          <Icon size={14} icon={FolderExportIcon} />
          移至
        </K.SubTrigger>
        <K.SubContent className="w-48">
          <MoveTargets kit={K} sectionId={section.id} />
        </K.SubContent>
      </K.Sub>
      <K.Item disabled={clean} onSelect={() => ops.saveTemplate({ ...section, chips })} data-testid="save-template">
        <Icon size={14} icon={FolderLibraryIcon} />
        保存为区块模板
      </K.Item>
      <K.Separator />
      <K.Item variant="destructive" onSelect={() => ops.remove(section)}>
        <Icon size={14} icon={Delete02Icon} />
        删除区块
      </K.Item>
    </>
  )
}

export function useSectionOps() {
  const actions = useActions()
  const store = useDocStore()
  const saveTemplate = useLibrary((s) => s.saveSectionTemplate)
  return {
    saveTemplate: (section: Section) => {
      const t = saveTemplate({ name: section.name, color: section.color, chips: templateChips(section.chips), ...(section.note ? { note: section.note } : {}) })
      actions.updateSection(section.id, { templateId: t.id, templateEdited: undefined })
      templateSaved(t)
    },
    remove: async (section: Section) => {
      const n = section.chips.length
      if (n && !(await confirmDelete({ title: `删除区块「${section.name}」？`, body: `将同时删除其中的 ${n} 个 tag。`, action: '删除区块' }))) return
      actions.removeSection(section.id)
      docUndoToast(store, `已删除区块「${section.name}」`)
    },
  }
}

function FollowCharacter({ kit: K, section }: { kit: MenuKit; section: Section }) {
  const actions = useActions()
  const char = useDoc((s) => {
    const id = charOfSection(s.doc, section.id)
    return id ? (s.doc.characters.find((c) => c.id === id) ?? null) : null
  })
  if (!char) return null
  return (
    <K.CheckboxItem
      checked={!section.ownColor}
      onCheckedChange={(on) => (on ? actions.followCharacterColor(section.id) : actions.updateSection(section.id, { ownColor: true }))}
      data-testid="section-follow-char"
    >
      <span className="size-3 rounded-full" style={{ background: sectionTint(char.color) }} />
      跟随角色
    </K.CheckboxItem>
  )
}

function MoveTargets({ kit: K, sectionId }: { kit: MenuKit; sectionId: string }) {
  const doc = useDoc((s) => s.doc)
  const actions = useActions()
  const here = findSection(doc, sectionId)
  return (
    <>
      {allBoxes(doc).map((b) => (
        <K.Item key={boxKey(b)} disabled={here ? boxKey(here.box) === boxKey(b) : false} onSelect={() => actions.moveSectionToBox(sectionId, b)}>
          {boxLabel(doc, b)}
        </K.Item>
      ))}
    </>
  )
}

function NameEditor({ value, onDone }: { value: string; onDone: (v: string | null) => void }) {
  const field = useDraftField({ value, onCommit: (t) => onDone(t || null), onCancel: () => onDone(null) })
  return (
    <input
      autoFocus
      className="section-name min-w-16 rounded-sm bg-surface-2 px-1 outline-none [field-sizing:content]"
      data-testid="section-name-input"
      {...field.props}
      onKeyDown={(e) => {
        e.stopPropagation()
        field.props.onKeyDown(e)
      }}
    />
  )
}
