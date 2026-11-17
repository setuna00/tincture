import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type DragEvent as ReactDragEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { useHotkeys } from 'react-hotkeys-hook'
import { useVirtualizer } from '@tanstack/react-virtual'
import { ImageNotFound01Icon, StarIcon } from '@hugeicons/core-free-icons'
import { canDragOut, dragOutProps } from '@/components/gen/drag-out'
import { Icon } from '@/components/icon'
import { SelMark } from '@/components/sel-mark'
import { Tip } from '@/components/tip'
import { ScrollArea } from '@/components/ui/scroll-area'
import { hitTest, justify, locate, neighbor, type LaidRow } from '@/lib/gallery'
import type { Entry, Stack } from '@/lib/gallery-stacks'
import { markShown, thumbUrl, wantThumb, wasShown } from '@/lib/thumbs'
import { cn } from '@/lib/utils'
import { toggleFav, useGalleryUi, useMarks } from '@/store/gallery'
import { pickCover } from '@/store/gallery-marks'
import { imageBlob, type GenImage } from '@/store/gen'
import { usePrefs } from '@/store/prefs'
import { enterStack, overlayOpen, ROW_MAX, ROW_MIN, selectIds, useGalleryNamer } from './data'

const GAP = 8
const PAD_X = 24
const PAD_TOP = 4
const PAD_BOTTOM = 24

export const GALLERY_DRAG = 'application/x-pe-gallery'

interface Unit {
  key: string
  ids: string[]
  img: GenImage
  stack?: Stack
}

const HEAD_H = 28
const GROUP_GAP = 12
const CAPTION_H = 22

function layout(units: Unit[], width: number, rowH: number, caption: number): { rows: LaidRow[]; heads: { label: string; count: number; y: number }[] } {
  const boxes = units.map((u) => ({ w: u.img.width, h: u.img.height }))
  const lay = (list: typeof boxes) => justify(list, width, rowH, GAP).map((r, k) => (caption ? { ...r, y: r.y + k * caption } : r))
  const split = units.findIndex((u) => !u.stack)
  if (split <= 0) return { rows: lay(boxes), heads: [] }
  const a = lay(boxes.slice(0, split))
  const b = lay(boxes.slice(split))
  if (!a.length || !b.length) return { rows: [...a, ...b], heads: [] }
  const last = a[a.length - 1]
  const bHead = HEAD_H + last.y + last.h + caption + GAP + GROUP_GAP
  return {
    rows: [...a.map((r) => ({ ...r, y: r.y + HEAD_H })), ...b.map((r) => ({ ...r, y: r.y + bHead + HEAD_H, items: r.items.map((it) => ({ ...it, index: it.index + split })) }))],
    heads: [
      { label: '叠', count: split, y: 0 },
      { label: '单张', count: units.length - split, y: bHead },
    ],
  }
}

function range(units: Unit[], a: number, b: number): string[] {
  if (a < 0 || b < 0) return units[b]?.ids ?? []
  return units.slice(Math.min(a, b), Math.max(a, b) + 1).flatMap((u) => u.ids)
}

let lastScroll = 0

export function GalleryGrid({ entries, resetKey, hidden }: { entries: Entry[]; resetKey: string; hidden: boolean }) {
  const root = useRef<HTMLDivElement>(null)
  const content = useRef<HTMLDivElement>(null)
  const [scrollEl, setScrollEl] = useState<HTMLElement | null>(null)
  useLayoutEffect(() => setScrollEl(root.current?.querySelector<HTMLElement>('[data-slot="scroll-area-viewport"]') ?? null), [])
  const [width, setWidth] = useState(0)
  const outerTop = useRef(0)
  useLayoutEffect(() => {
    if (!scrollEl) return
    const ro = new ResizeObserver(() => setWidth(Math.max(0, scrollEl.clientWidth - PAD_X * 2)))
    ro.observe(scrollEl)
    const onScroll = () => {
      lastScroll = performance.now()
      // Entering a stack shrinks the content and clamps scrollTop; restore from the position saved before that shrink.
      if (!useGalleryUi.getState().inStack) outerTop.current = scrollEl.scrollTop
    }
    scrollEl.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      ro.disconnect()
      scrollEl.removeEventListener('scroll', onScroll)
    }
  }, [scrollEl])
  const rowH = usePrefs((s) => s.galleryRowH)
  const caption = usePrefs((s) => s.galleryNames) ? CAPTION_H : 0
  const namer = useGalleryNamer()
  const units: Unit[] = useMemo(() => entries.map((e) => (e.kind === 'one' ? { key: `i:${e.img.id}`, ids: [e.img.id], img: e.img } : { key: `s:${e.stack.key}`, ids: e.stack.items.map((x) => x.id), img: e.stack.cover, stack: e.stack })), [entries])
  const { rows, heads } = useMemo(() => layout(units, width, rowH, caption), [units, width, rowH, caption])
  const unitOf = useMemo(() => {
    const m = new Map<string, number>()
    units.forEach((u, i) => u.ids.forEach((id) => m.set(id, i)))
    return m
  }, [units])
  const virt = useVirtualizer({ count: rows.length, getScrollElement: () => scrollEl, estimateSize: (i) => (rows[i + 1]?.y ?? rows[i].y + rows[i].h + caption + GAP) - rows[i].y, overscan: 3, paddingStart: PAD_TOP + (rows[0]?.y ?? 0), paddingEnd: PAD_BOTTOM - GAP })

  const prev = useRef<{ rows: LaidRow[]; units: Unit[] }>({ rows, units })
  const anchor = useRef<{ vx: number; vy: number } | null>(null)
  useLayoutEffect(() => {
    const old = prev.current
    prev.current = { rows, units }
    virt.measure()
    if (!scrollEl || old.units !== units || old.rows === rows || !old.rows.length || !rows.length) return
    const { vx, vy } = anchor.current ?? { vx: 0, vy: 0 }
    anchor.current = null
    if (scrollEl.scrollTop <= 0 && !vy) return
    const y = scrollEl.scrollTop + vy - PAD_TOP
    const row = old.rows.find((r) => r.y + r.h + GAP > y) ?? old.rows[old.rows.length - 1]
    const it = row.items.find((c) => c.x + c.w + GAP > vx) ?? row.items[row.items.length - 1]
    const frac = Math.min(1, Math.max(0, (y - row.y) / row.h))
    const at = locate(rows, it.index)
    if (!at) return
    const nr = rows[at.row]
    scrollEl.scrollTop = PAD_TOP + nr.y + frac * nr.h - vy
  }, [rows, units, scrollEl, virt])

  const firstKey = useRef(resetKey)
  useLayoutEffect(() => {
    if (firstKey.current === resetKey) return
    firstKey.current = resetKey
    if (scrollEl) scrollEl.scrollTop = 0
  }, [resetKey, scrollEl])
  const inStack = useGalleryUi((s) => s.inStack)
  const outer = useRef<{ key: string; top: number; reset: string } | null>(null)
  const was = useRef(inStack)
  useLayoutEffect(() => {
    if (was.current === inStack || !scrollEl) return
    if (inStack && !was.current) {
      outer.current = { key: inStack, top: outerTop.current, reset: resetKey }
      scrollEl.scrollTop = 0
    } else if (!inStack && outer.current) {
      const back = outer.current
      outer.current = null
      if (back.reset !== resetKey) return void (was.current = inStack)
      // Virtualized content regains its full height next frame; restore scroll both now and after measurement to avoid clamping.
      scrollEl.scrollTop = back.top
      requestAnimationFrame(() => (scrollEl.scrollTop = back.top))
      const u = units.find((x) => x.stack?.key === back.key)
      if (u) selectIds(u.ids)
    }
    was.current = inStack
  }, [inStack, scrollEl, units, resetKey])

  useEffect(() => {
    if (!scrollEl) return
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return
      e.preventDefault()
      const r = scrollEl.getBoundingClientRect()
      anchor.current = { vx: e.clientX - r.left - PAD_X, vy: e.clientY - r.top }
      const cur = usePrefs.getState().galleryRowH
      const next = Math.round(Math.min(ROW_MAX, Math.max(ROW_MIN, cur * (e.deltaY < 0 ? 1.1 : 1 / 1.1))))
      if (next !== cur) usePrefs.getState().set({ galleryRowH: next })
      else anchor.current = null
    }
    scrollEl.addEventListener('wheel', onWheel, { passive: false })
    return () => scrollEl.removeEventListener('wheel', onWheel)
  }, [scrollEl])

  const reveal = (index: number) => {
    const at = locate(rows, index)
    if (!at || !scrollEl) return
    const r = rows[at.row]
    const top = PAD_TOP + r.y
    if (top < scrollEl.scrollTop) scrollEl.scrollTop = top - GAP
    else if (top + r.h > scrollEl.scrollTop + scrollEl.clientHeight) scrollEl.scrollTop = top + r.h - scrollEl.clientHeight + GAP
  }
  const viewing = useGalleryUi((s) => s.viewing)
  const lastViewed = useRef<string | null>(null)
  useLayoutEffect(() => {
    if (viewing) lastViewed.current = viewing
    else if (lastViewed.current) {
      const i = unitOf.get(lastViewed.current)
      lastViewed.current = null
      if (i != null) reveal(i)
    }
  })

  const keys = { enabled: !hidden }
  const move = (dir: 'left' | 'right' | 'up' | 'down', extend: boolean) => {
    if (overlayOpen() || !units.length) return
    const ui = useGalleryUi.getState()
    const cur = ui.cursor ? (unitOf.get(ui.cursor) ?? -1) : -1
    const next = cur < 0 ? 0 : neighbor(rows, cur, dir, units.length)
    const u = units[next]
    if (extend && ui.anchor) ui.set({ selected: range(units, unitOf.get(ui.anchor) ?? -1, next), cursor: u.ids[0] })
    else selectIds(u.ids)
    reveal(next)
  }
  useHotkeys('left', (e) => (e.preventDefault(), move('left', false)), keys, [units, rows])
  useHotkeys('right', (e) => (e.preventDefault(), move('right', false)), keys, [units, rows])
  useHotkeys('up', (e) => (e.preventDefault(), move('up', false)), keys, [units, rows])
  useHotkeys('down', (e) => (e.preventDefault(), move('down', false)), keys, [units, rows])
  useHotkeys('shift+left', (e) => (e.preventDefault(), move('left', true)), keys, [units, rows])
  useHotkeys('shift+right', (e) => (e.preventDefault(), move('right', true)), keys, [units, rows])
  useHotkeys('shift+up', (e) => (e.preventDefault(), move('up', true)), keys, [units, rows])
  useHotkeys('shift+down', (e) => (e.preventDefault(), move('down', true)), keys, [units, rows])
  useHotkeys('mod+a', (e) => !overlayOpen() && (e.preventDefault(), useGalleryUi.getState().set({ selected: units.flatMap((u) => u.ids) })), keys, [units])
  useHotkeys(
    ['enter', 'space'],
    (e) => {
      if (overlayOpen()) return
      const ui = useGalleryUi.getState()
      if (!ui.selected.length) return
      e.preventDefault()
      const set = new Set(ui.selected)
      const stack = units.find((u) => u.stack && u.ids.length === set.size && u.ids.every((id) => set.has(id)))?.stack
      if (stack) return enterStack(stack.key)
      const id = ui.cursor && ui.selected.includes(ui.cursor) ? ui.cursor : ui.selected[0]
      ui.set({ viewing: id, selected: [id], anchor: id, cursor: id })
    },
    keys,
    [units],
  )
  useHotkeys(
    'f2',
    (e) => {
      if (overlayOpen() || document.activeElement?.closest('[data-testid=gallery-nav]')) return
      const set = new Set(useGalleryUi.getState().selected)
      if (!set.size || !units.some((u) => u.ids.length === set.size && u.ids.every((id) => set.has(id)))) return
      e.preventDefault()
      useGalleryUi.getState().set({ renamingName: true })
    },
    keys,
    [units],
  )
  useHotkeys(
    'escape',
    () => {
      if (overlayOpen()) return
      const ui = useGalleryUi.getState()
      if (ui.selected.length) ui.set({ selected: [], anchor: null })
      else if (ui.inStack) ui.set({ inStack: null })
    },
    keys,
  )

  const [box, setBox] = useState<{ x: number; y: number; w: number; h: number } | null>(null)
  const drag = useRef<{ x: number; y: number; base: string[]; moved: boolean } | null>(null)
  const pendingOne = useRef<number | null>(null)
  const dragImgs = useCallback(
    (unit: number) => {
      const sel = new Set(useGalleryUi.getState().selected)
      const u = units[unit]
      if (u && u.ids.every((id) => sel.has(id))) return units.flatMap((x) => (x.stack ? x.stack.items : [x.img])).filter((x) => sel.has(x.id))
      return u?.stack ? u.stack.items : u ? [u.img] : []
    },
    [units],
  )
  const onDragOut = useCallback(() => void (pendingOne.current = null), [])
  const point = (e: { clientX: number; clientY: number }) => {
    const r = content.current!.getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top - PAD_TOP }
  }
  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 && e.button !== 2) return
    const ui = useGalleryUi.getState()
    const cell = (e.target as HTMLElement).closest<HTMLElement>('[data-unit]')
    if (cell) {
      const ui0 = Number(cell.dataset.unit)
      const ids = units[ui0]?.ids ?? []
      const all = ids.every((id) => ui.selected.includes(id))
      if (e.button === 2) {
        if (!all) selectIds(ids)
        return
      }
      if (e.ctrlKey || e.metaKey) {
        const set = new Set(ui.selected)
        for (const id of ids) {
          if (all) set.delete(id)
          else set.add(id)
        }
        ui.set({ selected: [...set], anchor: ids[0], cursor: ids[0] })
      } else if (e.shiftKey && ui.anchor) ui.set({ selected: range(units, unitOf.get(ui.anchor) ?? -1, ui0), cursor: ids[0] })
      else if (all && ui.selected.length > ids.length) pendingOne.current = ui0
      else selectIds(ids)
      return
    }
    if (e.button !== 0) return
    e.currentTarget.setPointerCapture(e.pointerId)
    const p = point(e)
    drag.current = { ...p, base: e.ctrlKey || e.metaKey ? ui.selected : [], moved: false }
  }
  const onPointerMove = (e: ReactPointerEvent) => {
    const d = drag.current
    if (!d) return
    const p = point(e)
    if (!d.moved && Math.hypot(p.x - d.x, p.y - d.y) < 4) return
    d.moved = true
    const r = { x: Math.min(d.x, p.x), y: Math.min(d.y, p.y), w: Math.abs(p.x - d.x), h: Math.abs(p.y - d.y) }
    setBox(r)
    const hit = hitTest(rows, r).flatMap((i) => units[i].ids)
    const sel = [...new Set([...d.base, ...hit])]
    const ui = useGalleryUi.getState()
    if (sel.join() !== ui.selected.join()) ui.set({ selected: sel, anchor: hit[0] ?? ui.anchor, cursor: hit[hit.length - 1] ?? ui.cursor })
  }
  const onPointerUp = () => {
    if (pendingOne.current != null) selectIds(units[pendingOne.current]?.ids ?? [])
    pendingOne.current = null
    const d = drag.current
    drag.current = null
    setBox(null)
    if (d && !d.moved && !d.base.length) useGalleryUi.getState().set({ selected: [], anchor: null })
  }
  const onDoubleClick = (e: React.MouseEvent) => {
    const cell = (e.target as HTMLElement).closest<HTMLElement>('[data-unit]')
    if (!cell) return
    const u = units[Number(cell.dataset.unit)]
    if (!u) return
    if (u.stack) return enterStack(u.stack.key)
    const id = u.img.id
    useGalleryUi.getState().set({ viewing: id, selected: [id], anchor: id, cursor: id })
  }
  const onDragStart = useCallback(
    (e: ReactDragEvent<HTMLElement>, unit: number) => {
      const imgs = dragImgs(unit)
      e.dataTransfer.setData(GALLERY_DRAG, imgs.map((x) => x.id).join(','))
      e.dataTransfer.effectAllowed = 'copy'
      pendingOne.current = null
    },
    [dragImgs],
  )

  const selected = useGalleryUi((s) => s.selected)
  const selSet = useMemo(() => new Set(selected), [selected])
  const fav = useMarks((s) => s.fav)
  const vitems = virt.getVirtualItems()
  return (
    <ScrollArea ref={root} className={cn('min-h-0 flex-1', hidden && 'invisible')} inert={hidden} data-testid="gallery-grid" data-rowh={rowH}>
      <div className="px-6">
        <div
          ref={content}
          className="relative select-none"
          style={{ height: Math.max(virt.getTotalSize(), 0) }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onDoubleClick={onDoubleClick}
          data-testid="gallery-grid-body"
        >
          {vitems.map((vr) => {
            const row = rows[vr.index]
            if (!row) return null
            return row.items.map((it) => {
              const u = units[it.index]
              if (u.stack)
                return (
                  <StackCell
                    key={u.key}
                    unit={it.index}
                    stack={u.stack}
                    x={it.x}
                    y={vr.start}
                    w={it.w}
                    h={row.h}
                    selected={u.ids.every((id) => selSet.has(id))}
                    solo={selSet.size === u.ids.length && u.ids.every((id) => selSet.has(id))}
                    fav={u.ids.some((id) => fav[id])}
                    name={caption ? namer.stack(u.stack.items, u.stack.cover) : undefined}
                    dragImgs={dragImgs}
                    onDragOut={onDragOut}
                    onDragStart={onDragStart}
                  />
                )
              return <Cell key={u.key} unit={it.index} img={u.img} x={it.x} y={vr.start} w={it.w} h={row.h} selected={selSet.has(u.img.id)} fav={!!fav[u.img.id]} name={caption ? namer.image(u.img) : undefined} dragImgs={dragImgs} onDragOut={onDragOut} onDragStart={onDragStart} />
            })
          })}
          {heads.map((h) => (
            <div key={h.label} className="gal-group" style={{ top: PAD_TOP + h.y, height: HEAD_H }} data-testid="gallery-group">
              <span>{h.label}</span>
              <span className="tabular-nums">{h.count}</span>
            </div>
          ))}
          {box && <div className="gal-marquee" style={{ left: box.x, top: box.y + PAD_TOP, width: box.w, height: box.h }} data-testid="gallery-marquee" />}
        </div>
      </div>
    </ScrollArea>
  )
}

function useThumb(img: GenImage | undefined) {
  const [url, setUrl] = useState<string | null | undefined>(() => (img ? thumbUrl(img.id) : undefined))
  const [ready, setReady] = useState(() => (img ? wasShown(img.id) : false))
  const [for_, setFor] = useState(img?.id)
  if (img?.id !== for_) {
    setFor(img?.id)
    setUrl(img ? thumbUrl(img.id) : undefined)
    setReady(img ? wasShown(img.id) : false)
  }
  useEffect(() => (img ? wantThumb(img.id, () => imageBlob(img), setUrl) : undefined), [img])
  const onLoad = () => {
    if (!img) return
    markShown(img.id)
    setReady(true)
  }
  return { url, ready, onLoad }
}

function dragProps(unit: number, dragImgs: (unit: number) => GenImage[], onDragOut: () => void, onDragStart: (e: ReactDragEvent<HTMLElement>, unit: number) => void) {
  if (canDragOut) return dragOutProps(() => dragImgs(unit), onDragOut)
  return { draggable: true as const, onDragStart: (e: ReactDragEvent<HTMLElement>) => onDragStart(e, unit) }
}

const Cell = memo(function Cell({
  unit,
  img,
  x,
  y,
  w,
  h,
  selected,
  fav,
  name,
  dragImgs,
  onDragOut,
  onDragStart,
}: {
  unit: number
  img: GenImage
  x: number
  y: number
  w: number
  h: number
  selected: boolean
  fav: boolean
  name?: string
  dragImgs: (unit: number) => GenImage[]
  onDragOut: () => void
  onDragStart: (e: ReactDragEvent<HTMLElement>, unit: number) => void
}) {
  const inTrash = useGalleryUi((s) => s.scope === 'trash')
  const { url, ready, onLoad } = useThumb(img.missing ? undefined : img)
  return (
    <div
      className="gal-cell"
      style={{ left: x, top: y, width: w, height: h }}
      data-unit={unit}
      data-gid={img.id}
      data-selected={selected ? '' : undefined}
      data-fav={fav ? '' : undefined}
      data-testid="gallery-cell"
      {...dragProps(unit, dragImgs, onDragOut, onDragStart)}
    >
      {img.missing ? <Missing /> : url ? <img src={url} alt="" draggable={false} decoding="async" className="gal-img" data-ready={ready ? '' : undefined} onLoad={onLoad} /> : url === null ? <span className="gal-fail">无法显示</span> : null}
      <SelMark />
      {name !== undefined && (
        <span className="gal-caption" data-testid="gallery-caption">
          {name}
        </span>
      )}
      {!inTrash && (
        <button
          type="button"
          tabIndex={-1}
          className="gal-star"
          onPointerDown={(e) => e.stopPropagation()}
          onDoubleClick={(e) => e.stopPropagation()}
          onClick={() => toggleFav([img.id])}
          aria-label={fav ? '取消收藏' : '收藏'}
          data-testid="gallery-star"
        >
          <Icon icon={StarIcon} size={14} className={fav ? 'fav-on' : undefined} />
        </button>
      )}
    </div>
  )
})

const StackCell = memo(function StackCell({
  unit,
  stack,
  x,
  y,
  w,
  h,
  selected,
  solo,
  fav,
  name,
  dragImgs,
  onDragOut,
  onDragStart,
}: {
  unit: number
  stack: Stack
  x: number
  y: number
  w: number
  h: number
  selected: boolean
  solo: boolean
  fav: boolean
  name?: string
  dragImgs: (unit: number) => GenImage[]
  onDragOut: () => void
  onDragStart: (e: ReactDragEvent<HTMLElement>, unit: number) => void
}) {
  const inTrash = useGalleryUi((s) => s.scope === 'trash')
  const el = useRef<HTMLDivElement>(null)
  const frames = stack.frames
  const home = Math.max(0, frames.indexOf(stack.cover))
  const [frame, setFrame] = useState({ key: stack.key, n: frames.length, i: home })
  const cur = frame.key === stack.key && frame.n === frames.length ? frame.i : home
  const [out, setOut] = useState<{ i: number; dir: 1 | -1; t: number } | null>(null)
  const armed = solo && frames.length > 1
  const acc = useRef(0)
  const pending = useRef<{ id: string; timer: number } | null>(null)
  const save = () => {
    const p = pending.current
    if (!p) return
    window.clearTimeout(p.timer)
    pending.current = null
    pickCover(p.id)
  }
  const shown = frames[cur] ?? stack.cover
  const face = useThumb(shown.missing ? undefined : shown)
  const prev = useThumb(out && !frames[out.i]?.missing ? frames[out.i] : undefined)
  useEffect(() => {
    const node = el.current
    if (!node || !armed) return
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || performance.now() - lastScroll < 150) return
      e.preventDefault()
      acc.current += e.deltaY
      if (Math.abs(acc.current) < 40) return
      const dir = acc.current > 0 ? 1 : -1
      acc.current = 0
      const next = (cur + dir + frames.length) % frames.length
      if (!matchMedia('(prefers-reduced-motion: reduce)').matches) setOut({ i: cur, dir, t: performance.now() })
      setFrame({ key: stack.key, n: frames.length, i: next })
      if (pending.current) window.clearTimeout(pending.current.timer)
      pending.current = { id: frames[next].id, timer: window.setTimeout(save, 400) }
    }
    node.addEventListener('wheel', onWheel, { passive: false })
    return () => node.removeEventListener('wheel', onWheel)
  }, [armed, frames, stack.key, cur])
  useEffect(() => () => save(), [])
  useEffect(() => {
    if (!armed) return
    for (const d of [1, -1]) {
      const img = frames[(cur + d + frames.length) % frames.length]
      if (img) wantThumb(img.id, () => imageBlob(img), () => {})
    }
  }, [armed, cur, frames])
  const n = stack.items.length
  return (
    <div
      ref={el}
      className="gal-stack"
      style={{ left: x, top: y, width: w, height: h }}
      data-unit={unit}
      data-key={stack.key}
      data-selected={selected ? '' : undefined}
      data-fav={fav ? '' : undefined}
      data-armed={armed ? '' : undefined}
      data-shuffling={out ? '' : undefined}
      data-frame={cur}
      data-testid="gallery-stack"
      onPointerLeave={save}
      {...dragProps(unit, dragImgs, onDragOut, onDragStart)}
    >
      <div className="gal-stack-face">
        {shown.missing ? <Missing /> : face.url ? <img src={face.url} alt="" draggable={false} decoding="async" className={cn('gal-img', out && 'gal-shuffle-in')} data-ready={face.ready ? '' : undefined} onLoad={face.onLoad} /> : face.url === null ? <span className="gal-fail">无法显示</span> : null}
        {out && prev.url && <img key={out.t} src={prev.url} alt="" draggable={false} className="gal-img gal-shuffle-out" data-ready="" data-dir={out.dir} onAnimationEnd={() => setOut(null)} />}
        <SelMark />
        {frames.length > 1 && (
          <span className="gal-stack-dots" aria-hidden>
            {frames.slice(0, 12).map((f, i) => (
              <i key={f.id} data-on={i === cur ? '' : undefined} />
            ))}
          </span>
        )}
        {!inTrash && (
          <button
            type="button"
            tabIndex={-1}
            className="gal-star"
            onPointerDown={(e) => e.stopPropagation()}
            onDoubleClick={(e) => e.stopPropagation()}
            onClick={() => toggleFav(stack.items.map((x) => x.id))}
            aria-label={fav ? `取消收藏 ${n} 张` : `收藏 ${n} 张`}
            data-testid="gallery-star"
          >
            <Icon icon={StarIcon} size={14} className={fav ? 'fav-on' : undefined} />
          </button>
        )}
        <Tip label={`查看全部 ${n} 张（双击）`}>
          <button
            type="button"
            tabIndex={-1}
            className="gal-stack-count"
            onPointerDown={(e) => e.stopPropagation()}
            onDoubleClick={(e) => e.stopPropagation()}
            onClick={() => enterStack(stack.key)}
            aria-label={`查看全部 ${n} 张`}
            data-testid="gallery-stack-open"
          >
            ×{n}
          </button>
        </Tip>
      </div>
      {name !== undefined && (
        <span className="gal-caption gal-stack-caption" data-testid="gallery-caption">
          {name}
        </span>
      )}
    </div>
  )
})

function Missing() {
  return (
    <span className="gal-missing" data-testid="gallery-cell-missing">
      <Icon icon={ImageNotFound01Icon} size={18} />
      图片文件已丢失
    </span>
  )
}
