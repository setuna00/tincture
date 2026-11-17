import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import {
  AddSquareIcon,
  AlertCircleIcon,
  ArrowUpDownIcon,
  Copy01Icon,
  Delete02Icon,
  FolderExportIcon,
  HashtagIcon,
  LinkSquare02Icon,
  PencilEdit02Icon,
  PinIcon,
  PinOffIcon,
  ViewIcon,
  ViewOffSlashIcon,
} from '@hugeicons/core-free-icons'
import { useSelectedLock } from './random-ops'
import { useAfterMenu } from '@/components/after-menu'
import { Icon } from '@/components/icon'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuRadioGroup,
  ContextMenuRadioItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'
import { KanbanItem } from '@/components/ui/kanban'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { chipLiteral, exportString, parsePrompt, toChip, WEIGHT_STEP, WEIGHT_STEP_COARSE } from '@/lib/nai'
import { dupIndex } from '@/lib/nai-length'
import { lookupTag, relatedTags } from '@/lib/tagdb'
import { allBoxes, boxKey, findChip, findSection, sectionList, type DocActions } from '@/store/doc'
import { useActions, useDoc, useDocStore } from '@/store/context'
import { useDnd } from '@/store/dnd'
import { useUi } from '@/store/ui'
import type { Chip, Interaction, TagEntry } from '@/types'
import { boxLabel, sectionTint, sectionVars } from './labels'
import { ChipFace, WeightSeg, chipAttrs, tagStatus } from './chip-face'
import { targetsOf, useGroupOps, weighable } from './group-ops'
import { AltChip, useGuesses } from './guesses'
import { TagSuggest, useTagSuggest } from './tag-suggest'

const WEIGHT_PRESETS = [1.5, 1.2, 1.1, 0.9, 0.8, 0.5, -1]

function DupMark({ places }: { places?: string }) {
  const icon = <Icon icon={AlertCircleIcon} size={14} />
  return (
    <span className="chip-dup" data-on={places ? '' : undefined} aria-hidden={!places} data-testid="chip-dup">
      {places ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="grid place-items-center">{icon}</span>
          </TooltipTrigger>
          <TooltipContent side="top" data-testid="chip-dup-tip">
            与 {places} 重复
          </TooltipContent>
        </Tooltip>
      ) : (
        icon
      )}
    </span>
  )
}

export const ChipItem = memo(function ChipItem({ chip, sectionId, locked }: { chip: Chip; sectionId: string; locked?: boolean }) {
  const actions = useActions()
  const [editW, setEditW] = useState<number | null>(null)
  const editing = editW !== null
  const ref = useRef<HTMLDivElement>(null)
  const startEdit = () => setEditW(ref.current?.getBoundingClientRect().width ?? 0)
  const menu = useAfterMenu({ refocus: false })
  const stopEdit = () => setEditW(null)
  const literal = chipLiteral(chip)
  const store = useDocStore()
  const ops = useGroupOps()
  const drop = useDnd((s) => (s.hint?.markId === chip.id ? s.hint.side : null))
  const ghost = useDnd((s) => s.ghosts.includes(chip.id))
  const selected = useUi((s) => s.selectedChipIds.includes(chip.id))
  const dup = useDoc((s) => dupIndex(s.doc).chips.get(chip.id)?.join('、'))
  // NovelAI exports Text: without weights or interaction prefixes, so do not offer those controls.
  const textBlock = chip.type === 'textrender'

  // React wheel listeners are passive; a native listener is required to prevent page scrolling.
  useEffect(() => {
    const el = ref.current
    if (!el || editing || !selected || textBlock) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      // Windows reports Shift+wheel as horizontal deltaX.
      const d = e.deltaY || e.deltaX
      if (!d) return
      const step = e.shiftKey ? WEIGHT_STEP_COARSE : WEIGHT_STEP
      const ids = targetsOf(chip.id)
      actions.adjustWeight(ids.length > 1 ? weighable(store.getState().doc, ids) : ids, d < 0 ? step : -step)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [actions, store, chip.id, editing, selected, textBlock])

  const copy = async () => {
    const text = exportString([{ id: '', name: '', color: 'slate', muted: false, chips: [{ ...chip, disabled: false }] }])
    try {
      await navigator.clipboard.writeText(text)
      toast.success(`已复制 ${text}`)
    } catch {
      toast.error('复制失败：无剪贴板权限')
    }
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild disabled={editing}>
        <KanbanItem
          value={chip.id}
          asHandle={!editing}
          asChild
          ref={ref}
          className="chip"
          {...chipAttrs(chip)}
          data-editing={editing ? '' : undefined}
          data-multiline={editing && textBlock ? '' : undefined}
          data-drop={drop ?? undefined}
          data-selected={selected ? '' : undefined}
          data-ghost={ghost ? '' : undefined}
          data-dup={dup ? '' : undefined}
          data-locked={locked ? '' : undefined}
          data-testid="chip"
          style={editing ? { minWidth: editW } : undefined}
          onClick={(e) => {
            e.stopPropagation()
            const ui = useUi.getState()
            if (e.ctrlKey || e.metaKey) return ui.toggleChip(chip.id)
            if (e.shiftKey) {
              const list = findSection(store.getState().doc, sectionId)?.section.chips ?? []
              const a = list.findIndex((c) => c.id === ui.anchorChipId)
              const b = list.findIndex((c) => c.id === chip.id)
              return a < 0 ? ui.selectRange([chip.id], chip.id) : ui.selectRange(list.slice(Math.min(a, b), Math.max(a, b) + 1).map((c) => c.id))
            }
            ui.select(chip.id, sectionId)
          }}
          onDoubleClick={(e) => {
            if (editing || e.ctrlKey || e.metaKey || e.shiftKey) return
            if ((e.target as HTMLElement).closest('.chip-w')) actions.setWeight([chip.id], 1)
            else startEdit()
          }}
          onKeyDown={(e) => {
            if (editing) return
            if (e.key === 'Delete' || e.key === 'Backspace') {
              e.stopPropagation()
              ops.remove(targetsOf(chip.id))
            }
            if (e.key === 'Enter' || e.key === 'F2') startEdit()
          }}
        >
          <div>
            <DupMark places={dup} />
            {editing ? (
              <>
                <WeightSeg weight={chip.weight} />
                <span className="chip-body">
                  {textBlock ? <TextBlockEditor chip={chip} onDone={stopEdit} /> : <ChipEditor chip={chip} sectionId={sectionId} onDone={stopEdit} />}
                </span>
              </>
            ) : (
              <ChipFace chip={chip} />
            )}
            {locked && (
              <span className="chip-pin" aria-label="已锁定" data-testid="chip-pin">
                <Icon icon={PinIcon} size={14} />
              </span>
            )}
            <button
              type="button"
              className="chip-x"
              aria-label="删除"
              tabIndex={-1}
              onMouseDown={(e) => e.stopPropagation()}
              onDoubleClick={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation()
                ops.remove([chip.id])
              }}
            >
              <svg width="8" height="8" viewBox="0 0 8 8" aria-hidden>
                <path d="M1 1l6 6M7 1L1 7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
              </svg>
            </button>
          </div>
        </KanbanItem>
      </ContextMenuTrigger>
      <ContextMenuContent
        className="w-52"
        onCloseAutoFocus={menu.onCloseAutoFocus}
        onEscapeKeyDown={(e) => e.stopPropagation()}
        // React portal clicks still bubble to the section; stop them from replacing the chip selection.
        onClick={(e) => e.stopPropagation()}
        data-testid="chip-menu"
      >
        <ChipMenuBody chipId={chip.id}>
        <ContextMenuLabel className="truncate text-ink-3">{literal}</ContextMenuLabel>
        <ContextMenuItem onSelect={() => menu.later(startEdit)}>
          <Icon size={14} icon={PencilEdit02Icon} />
          编辑
          <ContextMenuShortcut>双击</ContextMenuShortcut>
        </ContextMenuItem>
        {!textBlock && (
          <ContextMenuSub>
            <ContextMenuSubTrigger>
              <Icon size={14} icon={ArrowUpDownIcon} />
              权重
              <span className="ml-auto font-mono text-[11px] text-ink-2">{chip.weight}</span>
            </ContextMenuSubTrigger>
            <ContextMenuSubContent className="w-36">
              <ContextMenuItem onSelect={() => actions.setWeight([chip.id], 1)}>
                重置为 1<ContextMenuShortcut>双击数字</ContextMenuShortcut>
              </ContextMenuItem>
              <ContextMenuSeparator />
              {WEIGHT_PRESETS.map((w) => (
                <ContextMenuItem key={w} onSelect={() => actions.setWeight([chip.id], w)} className="font-mono">
                  {w}
                </ContextMenuItem>
              ))}
              <ContextMenuSeparator />
              <ContextMenuLabel className="font-normal text-ink-3">选中后滚轮 ±0.05 · Shift ±0.25</ContextMenuLabel>
            </ContextMenuSubContent>
          </ContextMenuSub>
        )}
        <ContextMenuItem onSelect={() => actions.toggleDisabled([chip.id])}>
          <Icon size={14} icon={chip.disabled ? ViewIcon : ViewOffSlashIcon} />
          {chip.disabled ? '启用' : '禁用（不导出）'}
        </ContextMenuItem>
        <LockMenu ids={[chip.id]} />
        <ContextMenuSub>
          <ContextMenuSubTrigger>
            <Icon size={14} icon={FolderExportIcon} />
            移至
          </ContextMenuSubTrigger>
          <ContextMenuSubContent className="max-h-80 w-56 overflow-y-auto">
            <MoveTargets ids={[chip.id]} />
          </ContextMenuSubContent>
        </ContextMenuSub>
        {!textBlock && (
          <ContextMenuSub>
            <ContextMenuSubTrigger>
              <Icon size={14} icon={HashtagIcon} />
              互动前缀
            </ContextMenuSubTrigger>
            <ContextMenuSubContent className="w-40">
              <ContextMenuRadioGroup
                value={chip.type === 'interaction' ? (chip.interaction ?? 'mutual') : 'none'}
                onValueChange={(v) =>
                  v === 'none'
                    ? actions.updateChip(chip.id, { type: 'tag', interaction: undefined })
                    : actions.updateChip(chip.id, { type: 'interaction', interaction: v as Interaction })
                }
              >
                <ContextMenuRadioItem value="none">无</ContextMenuRadioItem>
                <ContextMenuRadioItem value="source">
                  <span className="font-mono">source#</span> 主动
                </ContextMenuRadioItem>
                <ContextMenuRadioItem value="target">
                  <span className="font-mono">target#</span> 被动
                </ContextMenuRadioItem>
                <ContextMenuRadioItem value="mutual">
                  <span className="font-mono">mutual#</span> 相互
                </ContextMenuRadioItem>
              </ContextMenuRadioGroup>
            </ContextMenuSubContent>
          </ContextMenuSub>
        )}
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={copy}>
          <Icon size={14} icon={Copy01Icon} />
          复制
        </ContextMenuItem>
        {(chip.type === 'tag' || chip.type === 'artist' || chip.type === 'interaction') && (
          <ContextMenuItem
            onSelect={() =>
              window.open(`https://danbooru.donmai.us/wiki_pages/${encodeURIComponent(chip.text.replace(/ /g, '_'))}`, '_blank', 'noopener')
            }
          >
            <Icon size={14} icon={LinkSquare02Icon} />
            查看 wiki
          </ContextMenuItem>
        )}
        <ContextMenuSeparator />
        <ContextMenuItem variant="destructive" onSelect={() => ops.remove([chip.id])}>
          <Icon size={14} icon={Delete02Icon} />
          删除
          <ContextMenuShortcut>Del</ContextMenuShortcut>
        </ContextMenuItem>
        </ChipMenuBody>
      </ContextMenuContent>
    </ContextMenu>
  )
})

function ChipMenuBody({ chipId, children }: { chipId: string; children: React.ReactNode }) {
  const group = useUi((s) => (s.selectedChipIds.length > 1 && s.selectedChipIds.includes(chipId) ? s.selectedChipIds : null))
  return group ? <GroupMenu ids={group} /> : children
}

function GroupMenu({ ids }: { ids: string[] }) {
  const actions = useActions()
  const store = useDocStore()
  const ops = useGroupOps()
  const allOff = useDoc((s) => ids.every((id) => findChip(s.doc, id)?.chip.disabled))
  const weights = () => weighable(store.getState().doc, ids)
  return (
    <>
      <ContextMenuLabel className="text-ink-3" data-testid="chip-menu-group">
        {ids.length} 个 tag
      </ContextMenuLabel>
      <ContextMenuSub>
        <ContextMenuSubTrigger>
          <Icon size={14} icon={ArrowUpDownIcon} />
          权重
        </ContextMenuSubTrigger>
        <ContextMenuSubContent className="w-40">
          <ContextMenuItem onSelect={() => actions.setWeight(weights(), 1)}>全部重置为 1</ContextMenuItem>
          <ContextMenuSeparator />
          {WEIGHT_PRESETS.map((w) => (
            <ContextMenuItem key={w} onSelect={() => actions.setWeight(weights(), w)} className="font-mono">
              {w}
            </ContextMenuItem>
          ))}
          <ContextMenuSeparator />
          <ContextMenuLabel className="font-normal text-ink-3">滚轮 各自 ±0.05 · Shift ±0.25</ContextMenuLabel>
        </ContextMenuSubContent>
      </ContextMenuSub>
      <ContextMenuItem onSelect={() => actions.toggleDisabled(ids)}>
        <Icon size={14} icon={allOff ? ViewIcon : ViewOffSlashIcon} />
        {allOff ? '启用' : '禁用（不导出）'}
      </ContextMenuItem>
      <LockMenu ids={ids} />
      <ContextMenuSub>
        <ContextMenuSubTrigger>
          <Icon size={14} icon={FolderExportIcon} />
          移至
        </ContextMenuSubTrigger>
        <ContextMenuSubContent className="max-h-80 w-56 overflow-y-auto">
          <MoveTargets ids={ids} />
        </ContextMenuSubContent>
      </ContextMenuSub>
      <ContextMenuItem onSelect={() => ops.extract(ids)} data-testid="chip-menu-extract">
        <Icon size={14} icon={AddSquareIcon} />
        提取为新区块
      </ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem variant="destructive" onSelect={() => ops.remove(ids)}>
        <Icon size={14} icon={Delete02Icon} />
        删除 {ids.length} 个
        <ContextMenuShortcut>Del</ContextMenuShortcut>
      </ContextMenuItem>
    </>
  )
}

function MoveTargets({ ids }: { ids: string[] }) {
  const doc = useDoc((s) => s.doc)
  const actions = useActions()
  return (
    <>
      {allBoxes(doc).map((box) => {
        const list = sectionList(doc, box)
        if (!list.length) return null
        return (
          <div key={boxKey(box)}>
            <ContextMenuLabel className="font-normal text-ink-3">{boxLabel(doc, box)}</ContextMenuLabel>
            {list.map((s) => (
              <ContextMenuItem key={s.id} disabled={ids.every((id) => s.chips.some((c) => c.id === id))} onSelect={() => actions.moveChips(ids, s.id)}>
                <span className="size-2 rounded-full" style={{ background: sectionTint(s.color) }} />
                {s.name}
              </ContextMenuItem>
            ))}
          </div>
        )
      })}
    </>
  )
}

function commitEdit(actions: DocActions, chip: Chip, value: string) {
  const parsed = parsePrompt(value)
  if (!parsed.length) actions.removeChips([chip.id])
  else if (parsed.length === 1) {
    const p = parsed[0]
    actions.updateChip(chip.id, {
      text: p.text,
      type: p.type,
      interaction: p.interaction,
      weight: p.type === 'textrender' ? 1 : p.weight !== 1 ? p.weight : chip.weight,
    })
  } else actions.replaceChip(chip.id, parsed.map(toChip))
}

function TextBlockEditor({ chip, onDone }: { chip: Chip; onDone: () => void }) {
  const actions = useActions()
  const [value, setValue] = useState(() => chipLiteral(chip))
  const ref = useRef<HTMLTextAreaElement>(null)
  const done = useRef(false)
  const composing = useRef(false)

  useEffect(() => {
    ref.current?.focus()
    ref.current?.select()
  }, [])

  const commit = () => {
    if (done.current) return
    done.current = true
    commitEdit(actions, chip, value)
    onDone()
  }

  return (
    <textarea
      ref={ref}
      className="chip-edit"
      data-testid="chip-edit"
      rows={1}
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onMouseDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onBlur={commit}
      onCompositionStart={() => (composing.current = true)}
      onCompositionEnd={() => (composing.current = false)}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (composing.current || e.nativeEvent.isComposing) return
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault()
          commit()
        } else if (e.key === 'Escape') {
          done.current = true
          onDone()
        }
      }}
    />
  )
}

function ChipEditor({ chip, sectionId, onDone }: { chip: Chip; sectionId: string; onDone: () => void }) {
  const actions = useActions()
  const initial = chipLiteral(chip)
  const [value, setValue] = useState(initial)
  const touched = value !== initial
  const s = useTagSuggest(touched ? value : '')
  const inputRef = useRef<HTMLInputElement>(null)
  const done = useRef(false)
  const composing = useRef(false)
  const negative = useDoc((st) => findSection(st.doc, sectionId)?.box.field === 'uc')
  const present = useDoc((st) => findSection(st.doc, sectionId)?.section.chips.map((c) => c.text).join('\n') ?? '')
  const sectionColor = useDoc((st) => findSection(st.doc, sectionId)?.section.color)
  const { status, base } = tagStatus(chip)
  const guesses = useGuesses(chip.text, status === 'unknown')
  const exclude = useMemo(() => present.split('\n'), [present])
  const alts = useMemo(() => {
    if (status === 'official') return relatedTags(chip.text, 8, { negative, exclude })
    if ((status === 'variant' || status === 'alias') && base) return [lookupTag(base)!, ...relatedTags(base, 7, { negative, exclude })]
    return guesses.filter((t) => !exclude.includes(t.name)).slice(0, 8)
  }, [status, base, chip.text, negative, exclude, guesses])
  const suggesting = s.searching && s.results.length > 0

  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])

  const commit = () => {
    if (done.current) return
    done.current = true
    commitEdit(actions, chip, value)
    onDone()
  }

  const replaceWith = (tag: TagEntry) => {
    if (done.current) return
    done.current = true
    actions.updateChip(chip.id, { text: tag.name, type: tag.category === 'artist' ? 'artist' : chip.type === 'interaction' ? 'interaction' : 'tag' })
    onDone()
  }

  const idleTitle =
    status === 'unknown' ? '不在 tag 库中 · 可能是（点击替换）'
    : status === 'variant' ? `「${base}」的自定义写法 · 替换为官方写法或同档`
    : status === 'alias' ? `Danbooru 别名，正式写法为「${base}」· 替换为正式写法或同档`
    : '替换为 · 同档在前'
  const idle = alts.length ? (
      <div className="flex flex-col gap-1.5 px-1.5 pt-1 pb-1.5">
        <span className="text-[11px] text-ink-2" data-testid="edit-alt-title">
          {idleTitle}，权重不变
        </span>
        <div className="flex flex-wrap gap-1" style={sectionColor && sectionVars(sectionColor)}>
          {alts.map((t) => (
            <AltChip key={t.name} tag={t} onPick={replaceWith} testId="edit-alt" />
          ))}
        </div>
      </div>
    ) : null

  return (
    <TagSuggest
      s={s}
      open
      isolate
      onPick={replaceWith}
      testId="chip-edit-suggest"
      contentClassName="w-88"
      idle={idle}
      hints={
        <>
          <span>Tab / ↓ 选择候选</span>
          <span>↵ 补全英文，否则保留原文</span>
          <span>Esc 取消</span>
        </>
      }
    >
      <input
        ref={inputRef}
        className="chip-edit"
        data-testid="chip-edit"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onMouseDown={(e) => e.stopPropagation()}
        onDoubleClick={(e) => e.stopPropagation()}
        onBlur={commit}
        onCompositionStart={() => (composing.current = true)}
        onCompositionEnd={() => (composing.current = false)}
        onKeyDown={(e) => {
          if (composing.current || e.nativeEvent.isComposing) return
          if (e.key === 'Enter') {
            e.preventDefault()
            if (!s.searching || e.shiftKey) commit()
            else {
              const apply = (tag: TagEntry | undefined) => (tag ? replaceWith(tag) : commit())
              const r = s.enterPickLatest()
              if (r instanceof Promise) r.then(apply)
              else apply(r)
            }
          } else if (e.key === 'Tab' && suggesting) {
            e.preventDefault()
            const tag = s.pick()
            if (tag) replaceWith(tag)
          } else if (e.key === 'Escape') {
            done.current = true
            onDone()
          }
        }}
      />
    </TagSuggest>
  )
}

function LockMenu({ ids }: { ids: string[] }) {
  const lock = useSelectedLock(ids)
  if (!lock.visible) return null
  return (
    <ContextMenuItem onSelect={lock.toggle} data-testid="chip-menu-lock">
      <Icon icon={lock.locked ? PinOffIcon : PinIcon} size={14} />
      {lock.locked ? '解锁' : '锁定'}
      <ContextMenuShortcut>L</ContextMenuShortcut>
    </ContextMenuItem>
  )
}
