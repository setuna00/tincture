import { characterLabel } from '@/lib/character-label'
import { MouseSensor, TouchSensor, useSensor, useSensors, type Modifier, type UniqueIdentifier } from '@dnd-kit/core'
import { arrayMove, SortableContext, useSortable, verticalListSortingStrategy, type SortingStrategy } from '@dnd-kit/sortable'
import { CSS as DndCSS } from '@dnd-kit/utilities'
import { memo, useCallback, useEffect, useMemo, useRef, type ReactNode } from 'react'
import { flushSync } from 'react-dom'
import { useStore } from 'zustand'
import { Add01Icon, Delete02Icon, DragDropVerticalIcon, FolderLibraryIcon, MoreHorizontalIcon } from '@hugeicons/core-free-icons'
import { GenderIcon, GenderName, GenderRadioItems } from '@/components/gender'
import { useAfterMenu } from '@/components/after-menu'
import { Icon } from '@/components/icon'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { ContextMenu, ContextMenuContent, ContextMenuTrigger } from '@/components/ui/context-menu'
import { CONTEXT_KIT, DROPDOWN_KIT, keepNativeMenuOnFields, type MenuKit } from '@/components/menu-kit'
import { Kanban, KanbanBoard, KanbanOverlay } from '@/components/ui/kanban'
import { Switch } from '@/components/ui/switch'
import { RefImages } from './ref-images'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { defTags, GENDER_LABEL, genderLabel, GENDERS, genderTags, valueOfDef, type GenderValue } from '@/lib/gender'
import { useGenderOptions } from '@/lib/use-gender-options'
import { characterPrompt, newId } from '@/lib/nai'
import { RANDOM_COLOR } from '@/lib/random-block'
import { ARTIST_DRAG_PREFIX, ArtistGhost, artistFromDrag } from '@/components/assistant/artist-folder'
import { sectionFromTemplate } from '@/components/assistant/focus'
import { CHAR_TEMPLATE_DRAG_PREFIX, CharacterGhost, charTemplateIdFromDrag } from '@/components/assistant/character-library'
import { openCharacterLibrary, RandomGhost, TEMPLATE_DRAG_PREFIX, TemplateGhost, templateIdFromDrag } from '@/components/assistant/template-panel'
import { Tip } from '@/components/tip'
import { characterDisplay, characterFromTemplate } from '@/lib/char-template'
import { useCharWorks, WORK_CTX } from '@/lib/char-works'
import { allBoxes, allSections, boxKey, findChip, findSection, makeSection, sectionList } from '@/store/doc'
import { useActions, useDoc, useDocStore } from '@/store/context'
import { useDnd, type CharHint, type DropHint, type SectionHint } from '@/store/dnd'
import { useLibrary } from '@/store/library'
import { useUi } from '@/store/ui'
import type { BoxRef, Character, Chip, Doc, Section } from '@/types'
import { GENDER_TAG } from '@/types'
import { maxCharacters } from '@/lib/nai-models'
import { useCharacterOps } from './character-ops'
import { ChipFace, chipAttrs } from './chip-face'
import { captureChips, chipsOf, layoutRect } from './flip'
import { sectionVars } from './labels'
import { ColorGrid } from './color-grid'
import { PresetBlock } from './preset-block'
import { insertRandom, RANDOM_DRAG_PREFIX, randomKindFromDrag } from './random-ops'
import { SectionCard } from './section-card'

/** dnd-kit grid transforms overlap wrapping chips of unequal widths; use DOM reordering and FLIP instead. */
const NO_SHIFT: SortingStrategy = () => null

const CHAR_DRAG = 'char:'
const isCharDrag = (id: UniqueIdentifier) => String(id).startsWith(CHAR_DRAG)

/** Collapse synchronously before dnd-kit measures the cards, and preserve scroll so the grabbed header stays under the pointer. */
function foldCharacters(card: HTMLElement) {
  const viewport = card.closest<HTMLElement>('[data-radix-scroll-area-viewport]')
  const board = card.closest<HTMLElement>('[data-testid=board]')
  const top = card.getBoundingClientRect().top
  if (board) board.style.minHeight = `${board.offsetHeight}px`
  flushSync(() => useDnd.getState().setCharFold(true))
  if (viewport) viewport.scrollTop += card.getBoundingClientRect().top - top
}

function unfoldCharacters(anchorId?: string) {
  if (!useDnd.getState().charFold) return
  const card = anchorId ? document.querySelector<HTMLElement>(`[data-char-id="${CSS.escape(anchorId)}"]`) : null
  const viewport = card?.closest<HTMLElement>('[data-radix-scroll-area-viewport]')
  const top = card?.getBoundingClientRect().top ?? 0
  flushSync(() => useDnd.getState().setCharFold(false))
  if (card && viewport) viewport.scrollTop += card.getBoundingClientRect().top - top
  const board = document.querySelector<HTMLElement>('[data-testid=board]')
  if (board) board.style.minHeight = ''
}

const SWAP_PX = 6
const SWAP_MS = 90

const ARTIST_EDGE = 8

interface LiveDrag {
  id: string
  ids: string[]
  sectionId: string
  order: string[]
  zone: 'own' | 'other' | 'none'
  swap: { id: string; x: number; y: number; t: number; left: boolean } | null
}

const inside = (r: DOMRect, x: number, y: number) => x >= r.left && x <= r.right && y >= r.top && y <= r.bottom

function elementUnder(x: number, y: number, attr: string): HTMLElement | null {
  for (const el of document.elementsFromPoint(x, y)) {
    if (el.closest('[data-overlay]')) continue
    const hit = el.closest<HTMLElement>(`[${attr}]`)
    if (hit) return hit
  }
  return null
}

/** The structure key encodes sections as sectionId:chipId,chipId|sectionId:; an empty suffix means no chips. */
const parseStructKey = (key: string): Record<string, string[]> =>
  Object.fromEntries(
    key
      .split('|')
      .filter(Boolean)
      .map((part) => {
        const [sid, ids] = part.split(':')
        return [sid, ids ? ids.split(',') : []]
      }),
  )

const structKey = (doc: Doc) =>
  allSections(doc)
    .map((s) => `${s.id}:${s.chips.map((c) => c.id).join(',')}`)
    .join('|')

/** Disable section auto-scroll: dnd-kit restores handle focus on drop, causing the browser to scroll back abruptly. */
let draggingSection = false
const AUTO_SCROLL = { threshold: { x: 0, y: 0.08 }, acceleration: 2.5, canScroll: () => !draggingSection }

/** Subscribe only to structure: Kanban recreates measuring/accessibility objects on render, forcing all sortable chips to update. */
export function EditorDnd({ children }: { children: ReactNode }) {
  const store = useDocStore()
  const actions = useActions()
  const key = useStore(store, (s) => structKey(s.doc))
  const cols = useMemo(() => parseStructKey(key), [key])
  const doc = () => store.getState().doc
  const colOfChip = useMemo(() => {
    const m = new Map<string, string>()
    for (const [sid, ids] of Object.entries(cols)) for (const id of ids) m.set(id, sid)
    return m
  }, [cols])
  const templates = useLibrary((s) => s.sectionTemplates)
  const charTemplates = useLibrary((s) => s.characterTemplates)
  const pointer = useRef({ x: 0, y: 0 })
  const sectionBounds = useRef<{ top: number; bottom: number; reachTop: number; reachBottom: number } | null>(null)
  const { setHint, setSectionHint, setCharHint, setDragging, setOrder, setGhosts } = useDnd.getState()
  const live = useRef<LiveDrag | null>(null)
  const recheck = useRef<ReturnType<typeof setTimeout>>(undefined)

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 6 } }),
  )

  useEffect(() => {
    const onMove = (e: PointerEvent | TouchEvent) => {
      const p = 'touches' in e ? e.touches[0] : e
      if (p) pointer.current = { x: p.clientX, y: p.clientY }
    }
    window.addEventListener('pointermove', onMove, { passive: true })
    window.addEventListener('touchmove', onMove, { passive: true })
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('touchmove', onMove)
    }
  }, [])

  /** KanbanOverlay applies modifiers again; compute the artist offset from the pointer rather than accumulating transforms. */
  const modifiers = useMemo<Modifier[]>(
    () => [
      ({ transform, active, activeNodeRect }) => {
        if (!active || !activeNodeRect || !String(active.id).startsWith(ARTIST_DRAG_PREFIX)) return transform
        const { x, y } = pointer.current
        return { ...transform, x: x - activeNodeRect.left + 8, y: y - activeNodeRect.top + 14 }
      },
      ({ transform, active, activeNodeRect }) => {
        if (!active || !activeNodeRect || !(String(active.id) in cols || isCharDrag(active.id))) return transform
        const b = sectionBounds.current
        if (!b) return { ...transform, x: 0 }
        const center = activeNodeRect.top + activeNodeRect.height / 2
        const min = Math.min(b.top - activeNodeRect.top, b.reachTop - center)
        const max = Math.max(b.bottom - activeNodeRect.bottom, b.reachBottom - center)
        return { ...transform, x: 0, y: Math.min(max, Math.max(min, transform.y)) }
      },
    ],
    [cols],
  )

  const canDropColumn = useCallback((a: UniqueIdentifier, b: UniqueIdentifier) => {
    const fa = findSection(store.getState().doc, String(a))
    const fb = findSection(store.getState().doc, String(b))
    return !!fa && !!fb && fa.list === fb.list
  }, [store])

  const chipHint = (activeId: string, overId: string | null): DropHint | null => {
    if (!overId || overId === activeId) return null
    if (overId in cols) {
      const rest = cols[overId].filter((id) => id !== activeId)
      if (!rest.length) return { sectionId: overId, beforeId: null, markId: null, side: 'end' }
      return { sectionId: overId, beforeId: null, markId: rest[rest.length - 1], side: 'after' }
    }
    const sectionId = colOfChip.get(overId)
    if (!sectionId) return null
    const el = document.querySelector(`[data-chip-id="${CSS.escape(overId)}"]`)
    if (!el) return null
    const r = el.getBoundingClientRect()
    const list = cols[sectionId]
    const i = list.indexOf(overId)
    if (pointer.current.x < r.left + r.width / 2) return { sectionId, beforeId: overId, markId: overId, side: 'before' }
    const next = list[i + 1]
    return { sectionId, beforeId: next && next !== activeId ? next : (list[i + 2] ?? null), markId: overId, side: 'after' }
  }

  const templateHint = (): SectionHint | null => {
    const { x, y } = pointer.current
    const secEl = elementUnder(x, y, 'data-section-id')
    if (secEl) {
      const r = secEl.getBoundingClientRect()
      return { sectionId: secEl.dataset.sectionId!, side: y < r.top + r.height / 2 ? 'before' : 'after' }
    }
    const boxEl = elementUnder(x, y, 'data-box')
    if (!boxEl) return null
    const d = doc()
    const box = allBoxes(d).find((b) => boxKey(b) === boxEl.dataset.box)
    if (!box) return null
    const list = sectionList(d, box)
    return list.length ? { sectionId: list[list.length - 1].id, side: 'after' } : { boxKey: boxEl.dataset.box! }
  }

  const charTemplateHint = (): CharHint | null => {
    const { x, y } = pointer.current
    if (!elementUnder(x, y, 'data-char-area')) return null
    const cards = [...document.querySelectorAll<HTMLElement>('[data-testid=characters] > [data-char-id]')]
    if (!cards.length) return { index: 0, markId: null, side: 'after' }
    const i = cards.findIndex((el) => {
      const r = el.getBoundingClientRect()
      return y < r.top + r.height / 2
    })
    return i < 0 ? { index: cards.length, markId: cards[cards.length - 1].dataset.charId!, side: 'after' } : { index: i, markId: cards[i].dataset.charId!, side: 'before' }
  }

  const randomCharHint = (): CharHint | null => {
    const { x, y } = pointer.current
    if (!elementUnder(x, y, 'data-board')) return null
    const chars = doc().characters
    return { index: chars.length, markId: chars.length ? chars[chars.length - 1].id : null, side: 'after' }
  }

  const artistHint = (): { chip: DropHint } | { section: SectionHint } | null => {
    const { x, y } = pointer.current
    const secEl = elementUnder(x, y, 'data-section-id')
    if (secEl) {
      const r = secEl.getBoundingClientRect()
      const sectionId = secEl.dataset.sectionId!
      if (y < r.top + ARTIST_EDGE) return { section: { sectionId, side: 'before' } }
      if (y > r.bottom - ARTIST_EDGE) return { section: { sectionId, side: 'after' } }
      const els = chipsOf(sectionId)
      if (!els.length) return { chip: { sectionId, beforeId: null, markId: null, side: 'end' } }
      const rects = els.map((el) => el.getBoundingClientRect())
      const line = rects.flatMap((c, i) => (y >= c.top - 3 && y <= c.bottom + 3 ? [i] : []))
      const last = els[els.length - 1].dataset.chipId!
      if (!line.length) return { chip: { sectionId, beforeId: null, markId: last, side: 'after' } }
      const j = line.find((i) => x < rects[i].left + rects[i].width / 2)
      if (j !== undefined) return { chip: { sectionId, beforeId: els[j].dataset.chipId!, markId: els[j].dataset.chipId!, side: 'before' } }
      const k = line[line.length - 1]
      return { chip: { sectionId, beforeId: els[k + 1]?.dataset.chipId ?? null, markId: els[k].dataset.chipId!, side: 'after' } }
    }
    const boxEl = elementUnder(x, y, 'data-box')
    if (!boxEl) return null
    const d = doc()
    const box = allBoxes(d).find((b) => boxKey(b) === boxEl.dataset.box)
    if (!box) return null
    const list = sectionList(d, box)
    if (!list.length) return { section: { boxKey: boxEl.dataset.box! } }
    const below = list.find((s) => {
      const el = document.querySelector(`[data-section-id="${CSS.escape(s.id)}"]`)
      return el && y < el.getBoundingClientRect().top + el.getBoundingClientRect().height / 2
    })
    return { section: below ? { sectionId: below.id, side: 'before' } : { sectionId: list[list.length - 1].id, side: 'after' } }
  }

  const liveSwap = (L: LiveDrag, x: number, y: number) => {
    const els = chipsOf(L.sectionId)
    const later = (ms: number) => {
      clearTimeout(recheck.current)
      recheck.current = setTimeout(() => live.current === L && liveSwap(L, pointer.current.x, pointer.current.y), ms)
    }
    if (els.map((el) => el.dataset.chipId).join() !== L.order.join()) return later(16)
    const hit = els.find((el) => inside(layoutRect(el), x, y))
    const hitId = hit?.dataset.chipId ?? null
    const s = L.swap
    if (s && hitId !== s.id) s.left = true
    if (!hit || !hitId || hitId === L.id) return
    const from = L.order.indexOf(L.id)
    const to = L.order.indexOf(hitId)
    if (from < 0 || to < 0) return
    if (s && hitId === s.id && !s.left) {
      const r = layoutRect(hit)
      const mid = r.left + r.width / 2
      if (from > to ? x >= mid : x <= mid) return
    } else if (s) {
      if (Math.hypot(x - s.x, y - s.y) < SWAP_PX) return
      const wait = SWAP_MS - (performance.now() - s.t)
      if (wait > 0) return later(wait + 5)
    }
    captureChips(L.sectionId)
    L.order = arrayMove(L.order, from, to)
    L.swap = { id: hitId, x, y, t: performance.now(), left: false }
    setOrder({ sectionId: L.sectionId, ids: L.order })
  }

  const chipMove = (id: string, overId: string | null) => {
    const L = live.current
    if (!L) return setHint(chipHint(id, overId))
    const { x, y } = pointer.current
    const own = document.querySelector(`[data-section-id="${CSS.escape(L.sectionId)}"]`)
    if (own && inside(own.getBoundingClientRect(), x, y)) {
      L.zone = 'own'
      setHint(null)
      liveSwap(L, x, y)
      return
    }
    const orig = cols[L.sectionId] ?? []
    if (L.order.join() !== orig.join()) {
      captureChips(L.sectionId)
      L.order = orig.slice()
      setOrder(null)
    }
    L.swap = null
    const hint = chipHint(id, overId)
    L.zone = hint && hint.sectionId !== L.sectionId ? 'other' : 'none'
    setHint(L.zone === 'other' ? hint : null)
  }

  const chipDrop = (id: string) => {
    const L = live.current
    if (!L) return
    const hint = useDnd.getState().hint
    let to: string | null = null
    if (L.zone === 'other' && hint) {
      captureChips(L.sectionId)
      captureChips(hint.sectionId)
      actions.placeChips(L.ids, hint.sectionId, hint.beforeId)
      to = hint.sectionId
    } else if (L.zone === 'own') {
      const i = L.order.indexOf(id)
      const before = L.order.slice(i + 1).find((c) => !L.ids.includes(c)) ?? null
      for (const sid of new Set([L.sectionId, ...L.ids.map((c) => colOfChip.get(c)!)])) captureChips(sid)
      actions.placeChips(L.ids, L.sectionId, before)
      to = L.sectionId
    }
    const ui = useUi.getState()
    if (to && ui.selectedChipId === id && ui.focusSectionId) ui.select(id, to)
  }

  const endDrag = (activeId?: UniqueIdentifier) => {
    // Wait one frame for dnd-kit to clear its drag transform before restoring the expanded card and scroll anchor.
    if (activeId !== undefined && isCharDrag(activeId)) requestAnimationFrame(() => unfoldCharacters(String(activeId).slice(CHAR_DRAG.length)))
    const L = live.current
    if (L && useDnd.getState().order) captureChips(L.sectionId)
    clearTimeout(recheck.current)
    live.current = null
    setHint(null)
    setSectionHint(null)
    setCharHint(null)
    setDragging(null)
    setOrder(null)
    setGhosts([])
    sectionBounds.current = null
    draggingSection = false
    delete document.documentElement.dataset.dnd
  }

  return (
    <Kanban<string>
      value={cols}
      orientation="vertical"
      itemDrop="end"
      sensors={sensors}
      modifiers={modifiers}
      autoScroll={AUTO_SCROLL}
      canDropColumn={canDropColumn}
      isExtraSortable={isCharDrag}
      onDragStart={({ active }) => {
        const id = String(active.id)
        const isChar = isCharDrag(id)
        if (isChar || id in cols) {
          const f = isChar ? null : findSection(doc(), id)
          const list = isChar ? document.querySelector('[data-testid=characters]') : f && document.querySelector(`[data-box-list="${boxKey(f.box)}"]`)
          const self = isChar ? id.slice(CHAR_DRAG.length) : id
          if (list) {
            const r = list.getBoundingClientRect()
            const sibs = [...list.querySelectorAll<HTMLElement>(isChar ? ':scope > [data-char-id]' : ':scope > [data-section-id]')]
              .filter((el) => (isChar ? el.dataset.charId : el.dataset.sectionId) !== self)
              .map((el) => el.getBoundingClientRect())
            const mid = (x: DOMRect) => x.top + x.height / 2
            sectionBounds.current = {
              top: r.top,
              bottom: r.bottom,
              reachTop: sibs.length ? mid(sibs[0]) - 1 : r.top,
              reachBottom: sibs.length ? mid(sibs[sibs.length - 1]) + 1 : r.bottom,
            }
          } else sectionBounds.current = null
          draggingSection = !isChar
          document.documentElement.dataset.dnd = isChar ? 'character' : 'section'
          setDragging(isChar ? 'character' : 'section')
        } else {
          const kind = id.startsWith(RANDOM_DRAG_PREFIX)
            ? randomKindFromDrag(id) === 'char'
              ? 'random-char'
              : 'template'
            : id.startsWith(TEMPLATE_DRAG_PREFIX)
              ? 'template'
              : id.startsWith(CHAR_TEMPLATE_DRAG_PREFIX)
                ? 'char-template'
                : id.startsWith(ARTIST_DRAG_PREFIX)
                  ? 'artist'
                  : 'chip'
          if (kind === 'chip') {
            const sectionId = colOfChip.get(id)
            const sel = useUi.getState().selectedChipIds
            const ids = sel.length > 1 && sel.includes(id) ? Object.values(cols).flat().filter((c) => sel.includes(c)) : [id]
            live.current = sectionId ? { id, ids, sectionId, order: cols[sectionId].slice(), zone: 'own', swap: null } : null
            setGhosts(ids.filter((c) => c !== id))
          }
          document.documentElement.dataset.dnd = kind
          setDragging(kind)
        }
      }}
      onDragMove={({ active, over }) => {
        const id = String(active.id)
        if (id in cols || isCharDrag(id)) return
        if (id.startsWith(TEMPLATE_DRAG_PREFIX)) setSectionHint(templateHint())
        else if (id.startsWith(CHAR_TEMPLATE_DRAG_PREFIX)) setCharHint(charTemplateHint())
        else if (id.startsWith(RANDOM_DRAG_PREFIX)) {
          if (randomKindFromDrag(id) === 'char') setCharHint(randomCharHint())
          else setSectionHint(templateHint())
        } else if (id.startsWith(ARTIST_DRAG_PREFIX)) {
          const h = artistHint()
          setHint(h && 'chip' in h ? h.chip : null)
          setSectionHint(h && 'section' in h ? h.section : null)
        }
        else chipMove(id, over ? String(over.id) : null)
      }}
      onMove={({ active, over }) => {
        if (over && String(active.id) in cols && canDropColumn(active.id, over.id)) actions.moveSectionTo(String(active.id), String(over.id))
      }}
      onDragEnd={({ active, over }) => {
        const id = String(active.id)
        if (isCharDrag(id)) {
          const ids = store.getState().doc.characters.map((c) => CHAR_DRAG + c.id)
          const to = over ? ids.indexOf(String(over.id)) : -1
          if (to >= 0) flushSync(() => actions.moveCharacter(id.slice(CHAR_DRAG.length), to))
        } else if (id in cols) {
        } else if (id.startsWith(TEMPLATE_DRAG_PREFIX)) {
          const t = templates.find((x) => x.id === templateIdFromDrag(id))
          const h = templateHint()
          if (t && h) {
            const sec = sectionFromTemplate(t)
            if ('boxKey' in h) {
              const box = allBoxes(doc()).find((b) => boxKey(b) === h.boxKey)
              if (box) actions.insertSection(sec, { box })
            } else actions.insertSection(sec, { near: h.sectionId, side: h.side })
            useUi.getState().flash(sec.id)
          }
        } else if (id.startsWith(RANDOM_DRAG_PREFIX)) {
          const kind = randomKindFromDrag(id)
          if (kind === 'char') {
            if (randomCharHint()) void insertRandom(store, 'char', null)
          } else {
            const h = templateHint()
            if (h) {
              const box = 'boxKey' in h ? allBoxes(doc()).find((b) => boxKey(b) === h.boxKey) : null
              if (!('boxKey' in h)) void insertRandom(store, kind, { near: h.sectionId, side: h.side })
              else if (box) void insertRandom(store, kind, { box })
            }
          }
        } else if (id.startsWith(CHAR_TEMPLATE_DRAG_PREFIX)) {
          const t = charTemplates.find((x) => x.id === charTemplateIdFromDrag(id))
          const h = charTemplateHint()
          if (t && h) {
            const c = characterFromTemplate(t)
            if (actions.insertCharacter(c, { index: h.index })) useUi.getState().flash(c.id)
          }
        } else if (id.startsWith(ARTIST_DRAG_PREFIX)) {
          const chip: Chip = { id: newId('c'), text: artistFromDrag(id), type: 'artist', weight: 1, disabled: false }
          const h = artistHint()
          if (h && 'chip' in h) {
            const f = findSection(doc(), h.chip.sectionId)
            const i = h.chip.beforeId && f ? f.section.chips.findIndex((c) => c.id === h.chip.beforeId) : -1
            actions.addChips(h.chip.sectionId, [chip], i < 0 ? undefined : i)
          } else if (h) {
            const sec = makeSection('画师', [chip], RANDOM_COLOR.artist)
            if ('boxKey' in h.section) {
              const box = allBoxes(doc()).find((b) => 'boxKey' in h.section && boxKey(b) === h.section.boxKey)
              if (box) actions.insertSection(sec, { box })
            } else actions.insertSection(sec, { near: h.section.sectionId, side: h.section.side })
            useUi.getState().flash(sec.id)
          }
        } else chipDrop(id)
        endDrag(active.id)
      }}
      onDragCancel={({ active }) => endDrag(active.id)}
      strategy={NO_SHIFT}
    >
      {children}
      <KanbanOverlay>
        {({ value, variant }) => {
          if (variant === 'column') return null
          const id = String(value)
          if (id.startsWith(TEMPLATE_DRAG_PREFIX)) {
            const t = templates.find((x) => x.id === templateIdFromDrag(id))
            return t ? <TemplateGhost t={t} /> : null
          }
          if (id.startsWith(CHAR_TEMPLATE_DRAG_PREFIX)) {
            const t = charTemplates.find((x) => x.id === charTemplateIdFromDrag(id))
            return t ? <CharacterGhost t={t} /> : null
          }
          if (id.startsWith(RANDOM_DRAG_PREFIX)) return <RandomGhost kind={randomKindFromDrag(id)} />
          if (id.startsWith(ARTIST_DRAG_PREFIX)) return <ArtistGhost name={artistFromDrag(id)} />
          const f = findChip(doc(), id)
          if (!f) return null
          const n = live.current?.ids.length ?? 1
          const face = (
            <div className="chip" style={sectionVars(f.section.color)} {...chipAttrs(f.chip)} data-chip-id={undefined} data-overlay="">
              <ChipFace chip={f.chip} />
            </div>
          )
          if (n < 2) return face
          return (
            <div className="chip-stack" style={sectionVars(f.section.color)} data-overlay="" data-testid="drag-stack">
              <div className="chip chip-stack-back" {...chipAttrs(f.chip)} data-chip-id={undefined} aria-hidden />
              {face}
              <span className="chip-stack-count" data-testid="drag-count">
                {n}
              </span>
            </div>
          )
        }}
      </KanbanOverlay>
    </Kanban>
  )
}

const BASE_PROMPT: BoxRef = { kind: 'base', field: 'prompt' }
const BASE_UC: BoxRef = { kind: 'base', field: 'uc' }

export function EditorBoard() {
  const doc = useDoc((s) => s.doc)
  const charIds = useMemo(() => doc.characters.map((c) => CHAR_DRAG + c.id), [doc.characters])
  const charTags = doc.characters.reduce((n, c) => n + [...c.prompt, ...c.uc].reduce((m, s) => m + s.chips.length, 0), 0)
  return (
    <KanbanBoard className="gap-(--box-gap) pb-24" data-testid="board">
      <RefImages />
      <BoxPanel box={BASE_PROMPT} sections={doc.base.prompt} title="正面 Prompt" />
      <BoxPanel box={BASE_UC} sections={doc.base.uc} title="负面 UC" uc />
      <section className="flex flex-col gap-(--section-gap)" data-testid="box-characters" data-char-area="">
        <header className="flex items-center gap-2 pt-1">
          <span className="label-caps">角色</span>
          <span className="text-[11px] text-ink-2 tabular-nums" data-testid="characters-count">
            {charTags}
          </span>
          <CharAreaLine />
          <AddCharacter count={doc.characters.length} />
        </header>
        {doc.characters.length > 0 && (
          <SortableContext items={charIds} strategy={verticalListSortingStrategy}>
            <div className="flex flex-col gap-(--box-gap)" data-testid="characters">
              {doc.characters.map((c, i) => (
                <CharacterCard key={c.id} character={c} index={i} />
              ))}
            </div>
          </SortableContext>
        )}
      </section>
    </KanbanBoard>
  )
}

function CharAreaLine() {
  const hint = useDnd((s) => !!s.charHint && s.charHint.markId === null)
  return <span className="h-px flex-1 bg-line transition-colors duration-(--dur-fast) data-[hint]:h-0.5 data-[hint]:bg-(--accent-text)" data-hint={hint ? '' : undefined} />
}

function AddCharacter({ count }: { count: number }) {
  // NovelAI allows 32 characters in V5 and 6 in V4.x; switching to a lower limit must preserve existing characters.
  const max = useDoc((s) => maxCharacters(s.doc.settings.model))
  const templates = useLibrary((s) => s.characterTemplates.length)
  const ops = useCharacterOps()
  const exts = useGenderOptions()
  const menu = useAfterMenu()
  return (
    <div onClick={(e) => e.stopPropagation()}>
      <DropdownMenu>
        <Tip label={`${count} / ${max} 个角色`}>
          <span className="inline-flex">
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="xs" className="text-ink-2" disabled={count >= max} data-testid="add-character">
                <Icon icon={Add01Icon} size={14} />
                添加角色
              </Button>
            </DropdownMenuTrigger>
          </span>
        </Tip>
        <DropdownMenuContent
          align="end"
          className={exts.length ? 'w-76' : 'w-52'}
          onCloseAutoFocus={menu.onCloseAutoFocus}
        >
          <DropdownMenuLabel className="flex font-normal text-ink-3">
            新角色的性别
            <span className="ml-auto">
              {count}/{max}
            </span>
          </DropdownMenuLabel>
          {GENDERS.map((g) => (
            <DropdownMenuItem key={g} onSelect={() => ops.add({ gender: g })} data-testid={`add-character-${g}`}>
              <GenderIcon gender={g} size={14} />
              {GENDER_LABEL[g]}
              <span className="ml-auto text-[11px] text-ink-2">{GENDER_TAG[g] ? `添加 ${GENDER_TAG[g]}` : '不添加'}</span>
            </DropdownMenuItem>
          ))}
          {exts.length > 0 && <DropdownMenuSeparator />}
          {exts.map((d, i) => (
            <DropdownMenuItem key={i} onSelect={() => ops.add(valueOfDef(d))} data-testid={`add-character-ext-${d.name}`}>
              <GenderIcon gender={d.gender} size={14} />
              <span className="shrink-0 whitespace-nowrap">{d.name}</span>
              <span className="ml-auto min-w-0 truncate pl-3 text-[11px] text-ink-2">添加 {defTags(d)}</span>
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={() => menu.later(openCharacterLibrary)}
            data-testid="add-character-library"
          >
            <Icon size={14} icon={FolderLibraryIcon} />
            从模板库选择…
            <span className="ml-auto text-[12px] text-ink-2 tabular-nums">{templates} 个角色</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

interface BoxPanelProps {
  box: BoxRef
  sections: Section[]
  title: string
  uc?: boolean
}

const BoxPanel = memo(BoxPanelImpl, (a, b) => a.sections === b.sections && boxKey(a.box) === boxKey(b.box) && a.title === b.title && a.uc === b.uc)

function BoxPanelImpl({ box, sections, title, uc }: BoxPanelProps) {
  const actions = useActions()
  const key = boxKey(box)
  const total = sections.reduce((n, s) => n + s.chips.length, 0)
  const emptyHint = useDnd((s) => !!s.sectionHint && 'boxKey' in s.sectionHint && s.sectionHint.boxKey === key)
  const ids = useMemo(() => sections.map((s) => s.id), [sections])

  return (
    <section className="flex flex-col gap-(--section-gap)" data-testid={`box-${key}`} data-box={key}>
      <header className="flex items-center gap-2 pt-1">
        <span className="label-caps" style={uc ? { color: 'oklch(var(--section-tint-l) 0.12 var(--hue-uc))' } : undefined}>
          {title}
        </span>
        <span className="text-[11px] text-ink-2 tabular-nums">{total}</span>
        <span className="h-px flex-1 bg-line" />
        <Button variant="ghost" size="xs" className="text-ink-2" onClick={() => actions.addSection(box)} data-testid="add-section">
          <Icon icon={Add01Icon} size={14} />
          区块
        </Button>
      </header>
      {/* NovelAI prepends UC presets and appends quality presets; keep sortable sections inside those boundaries. */}
      {box.kind === 'base' && box.field === 'uc' && <PresetBlock field="uc" />}
      {sections.length > 0 ? (
        <SortableContext items={ids} strategy={verticalListSortingStrategy}>
          <div className="flex flex-col gap-(--section-gap)" data-box-list={key}>
            {sections.map((s) => (
              <SectionCard key={s.id} section={s} chips={s.chips} />
            ))}
          </div>
        </SortableContext>
      ) : (
        <button
          type="button"
          className="rounded-(--section-radius) border border-dashed border-line-strong px-3 py-2.5 text-left text-[12px] text-ink-2 hover:text-ink-1 data-[hint]:border-lamp-text data-[hint]:text-lamp-text"
          data-hint={emptyHint ? '' : undefined}
          onClick={() => actions.addSection(box, { name: uc ? '负面' : '新区块' })}
        >
          暂无区块。点击此处新建，或将区块模板拖动到此处
        </button>
      )}
      {box.kind === 'base' && box.field === 'prompt' && <PresetBlock field="prompt" />}
    </section>
  )
}

const CharacterCard = memo(function CharacterCard({ character: c, index }: { character: Character; index: number }) {
  const label = useDoc((s) => characterLabel(s.doc, c))
  const actions = useActions()
  const ops = useCharacterOps()
  const selected = useUi((s) => s.focusCharacterId === c.id)
  const flash = useUi((s) => s.flashSectionId === c.id)
  const folded = useDnd((s) => s.charFold)
  const insert = useDnd((s) => (s.charHint?.markId === c.id ? s.charHint.side : null))
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: CHAR_DRAG + c.id })
  const ref = useRef<HTMLDivElement | null>(null)
  useCharWorks()
  const shown = characterDisplay(c, WORK_CTX)
  useEffect(() => {
    if (flash) ref.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [flash])
  const setRefs = useCallback(
    (el: HTMLDivElement | null) => {
      ref.current = el
      setNodeRef(el)
    },
    [setNodeRef],
  )
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          onMouseDownCapture={keepNativeMenuOnFields}
          onContextMenuCapture={keepNativeMenuOnFields}
          ref={setRefs}
          className="char-card"
          style={{ ...sectionVars(c.color), transform: DndCSS.Translate.toString(transform), transition }}
          data-g={c.gender}
          data-off={c.enabled ? undefined : ''}
          data-selected={selected ? '' : undefined}
          data-flash={flash ? '' : undefined}
          data-folded={folded ? '' : undefined}
          data-dragging={isDragging ? '' : undefined}
          data-insert={insert ?? undefined}
          data-char-id={c.id}
          data-testid="character"
          onClick={(e) => {
            e.stopPropagation()
            useUi.getState().selectCharacter(c.id)
          }}
        >
          <header className="char-head">
            <button
              type="button"
              ref={setActivatorNodeRef}
              className="char-grip -ml-1 grid h-5 w-4 shrink-0 cursor-grab touch-none place-items-center rounded-sm hover:bg-surface-2 data-[dragging]:cursor-grabbing"
              aria-label="拖动排序"
              data-dragging={isDragging ? '' : undefined}
              data-testid="character-handle"
              {...attributes}
              {...listeners}
              onPointerDown={(e) => {
                if (e.button !== 0) return
                foldCharacters(e.currentTarget.closest<HTMLElement>('[data-char-id]')!)
                const up = () => {
                  window.removeEventListener('pointerup', up)
                  if (useDnd.getState().dragging !== 'character') unfoldCharacters(c.id)
                }
                window.addEventListener('pointerup', up)
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <Icon icon={DragDropVerticalIcon} size={16} />
            </button>
            <span className="grid size-5 shrink-0 place-items-center rounded-full bg-surface-3 text-[11px] text-ink-2" data-testid="character-index">
              {index + 1}
            </span>
            <GenderButton character={c} />
            <input
              className="char-name max-w-60 min-w-[1em] shrink-0 bg-transparent text-[13px] font-semibold outline-none [field-sizing:content] placeholder:opacity-70 focus:underline focus:decoration-line-strong focus:underline-offset-4"
              value={c.name}
              placeholder={shown.nameFromTag ? shown.name : label}
              onChange={(e) => actions.updateCharacter(c.id, { name: e.target.value })}
              aria-label="角色名"
              data-derived={shown.nameFromTag ? '' : undefined}
              data-testid="character-name"
            />
            {shown.work && (
              <span className="char-work" data-testid="character-work-label">
                {shown.work}
              </span>
            )}
            <span className="char-preview" data-testid="character-preview">
              {folded ? characterPrompt(c) || '（正面为空）' : ''}
            </span>
            <CharacterMenu character={c} onDelete={() => ops.remove(c)} />
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="char-switch ml-1 grid h-5 place-items-center" onClick={(e) => e.stopPropagation()}>
                  <Switch
                    checked={c.enabled}
                    onCheckedChange={(v) => actions.updateCharacter(c.id, { enabled: v })}
                    aria-label={c.enabled ? '停用这个角色' : '启用这个角色'}
                    data-testid="character-enabled"
                  />
                </span>
              </TooltipTrigger>
              <TooltipContent>{c.enabled ? '已启用 · 关闭后整个角色不导出' : '已停用，不导出 · 点击启用'}</TooltipContent>
            </Tooltip>
          </header>
          <div className="char-body">
            <BoxPanel box={{ kind: 'char', charId: c.id, field: 'prompt' }} sections={c.prompt} title="角色正面" />
            <BoxPanel box={{ kind: 'char', charId: c.id, field: 'uc' }} sections={c.uc} title="角色负面" uc />
          </div>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-48" onCloseAutoFocus={(e) => e.preventDefault()} onClick={(e) => e.stopPropagation()}>
        <CharacterMenuItems kit={CONTEXT_KIT} character={c} onDelete={() => ops.remove(c)} />
      </ContextMenuContent>
    </ContextMenu>
  )
})

const genderPatch = (v: GenderValue) => ({ gender: v.gender, genderExtra: v.genderExtra })

function GenderButton({ character: c }: { character: Character }) {
  const actions = useActions()
  const exts = useGenderOptions()
  const tags = genderTags(c)
  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size={c.genderExtra ? 'xs' : 'icon-xs'}
              className={c.genderExtra ? '-mx-0.5 gap-1 px-1' : '-mx-0.5'}
              aria-label={`性别：${genderLabel(c)}`}
              data-testid="character-gender"
              onClick={(e) => e.stopPropagation()}
            >
              <GenderIcon gender={c.gender} />
              <GenderName value={c} />
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>{tags.length ? `${genderLabel(c)} · 导出时在最前面添加 ${tags.join(', ')}` : '其他 · 不添加性别词'}</TooltipContent>
      </Tooltip>
      {/* React portal clicks bubble to the card; stop menu actions from selecting the character. */}
      <DropdownMenuContent align="start" className={exts.length || c.genderExtra ? 'w-76' : 'w-44'} onClick={(e) => e.stopPropagation()}>
        <DropdownMenuLabel className="font-normal text-ink-3">性别</DropdownMenuLabel>
        <GenderRadioItems value={c} onChange={(v) => actions.updateCharacter(c.id, genderPatch(v))} />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function CharacterMenu({ character: c, onDelete }: { character: Character; onDelete: () => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-xs" className="text-ink-2" aria-label="更多" data-testid="character-more" onClick={(e) => e.stopPropagation()}>
          <Icon icon={MoreHorizontalIcon} size={16} />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48" onClick={(e) => e.stopPropagation()}>
        <CharacterMenuItems kit={DROPDOWN_KIT} character={c} onDelete={onDelete} />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function CharacterMenuItems({ kit: K, character: c, onDelete }: { kit: MenuKit; character: Character; onDelete: () => void }) {
  const actions = useActions()
  const exts = useGenderOptions()
  return (
    <>
      <K.Label className="font-normal text-ink-3">颜色 · 其中的区块默认跟随角色颜色</K.Label>
      <ColorGrid value={c.color} onPick={(color) => actions.updateCharacter(c.id, { color })} testId="character-color" />
      <K.Separator />
      <K.Sub>
        <K.SubTrigger>
          <GenderIcon gender={c.gender} extra={c.genderExtra} size={14} />
          性别
        </K.SubTrigger>
        <K.SubContent className={exts.length || c.genderExtra ? 'w-76' : 'w-44'} onClick={(e) => e.stopPropagation()}>
          <GenderRadioItems kit={K} value={c} onChange={(v) => actions.updateCharacter(c.id, genderPatch(v))} />
        </K.SubContent>
      </K.Sub>
      <K.Separator />
      <K.Item variant="destructive" onSelect={onDelete} data-testid="character-delete">
        <Icon size={14} icon={Delete02Icon} />
        删除角色
      </K.Item>
    </>
  )
}
