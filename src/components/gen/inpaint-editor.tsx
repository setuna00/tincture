import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import {
  ContrastIcon,
  Delete02Icon,
  EraserIcon,
  FitToScreenIcon,
  LassoTool01Icon,
  MagicWand01Icon,
  MinusSignIcon,
  PaintBucketIcon,
  PenTool01Icon,
  PlusSignIcon,
  RedoIcon,
  UndoIcon,
  ViewIcon,
  ViewOffIcon,
} from '@hugeicons/core-free-icons'
import type { IconSvgElement } from '@hugeicons/react'
import { PricePill } from '@/components/anlas'
import { Icon } from '@/components/icon'
import { Stepper } from '@/components/stepper'
import { Tip } from '@/components/tip'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { PopoverAnchor } from '@/components/ui/popover'
import { PRICE_TOO_LONG } from '@/lib/nai-api'
import { applyPixels, brushEdgePath, bucketFill, CELL, fillPolygon, invertMask, maskEdgePath, maskEmpty, stamp, stroke, wandSelect, type Mask } from '@/lib/nai-inpaint'
import { cn } from '@/lib/utils'
import { imageUrl, type GenImage } from '@/store/gen'
import {
  beginStroke,
  closeInpaint,
  currentSession,
  editMask,
  endStroke,
  redoMask,
  runInpaint,
  SIZE_RANGE,
  TOL_RANGE,
  undoMask,
  useInpaint,
  type InpaintTool,
} from '@/store/inpaint'
import { useNai } from '@/store/nai'
import { INPAINT_ICON } from './action-meta'
import { useInpaintPrice } from './inpaint-price'
import { SpendConfirm, SpendPopover } from './spend-confirm'
import { transparencyStyle } from './zoom-pan'

const TOOLS: { key: InpaintTool; icon: IconSvgElement; name: string; k: string; how?: string; sel?: boolean }[] = [
  { key: 'draw', icon: INPAINT_ICON, name: '画笔', k: 'B' },
  { key: 'erase', icon: EraserIcon, name: '橡皮', k: 'E' },
  { key: 'bucket', icon: PaintBucketIcon, name: '油漆桶', k: 'G', how: '单击填满蒙版上连在一起的区域', sel: true },
  { key: 'wand', icon: MagicWand01Icon, name: '魔棒', k: 'W', sel: true },
  { key: 'pen', icon: PenTool01Icon, name: '钢笔', k: 'P', how: '单击加点，双击或点回起点闭合', sel: true },
  { key: 'lasso', icon: LassoTool01Icon, name: '套索', k: 'L', how: '按住拖动圈出区域，松手闭合', sel: true },
]
const KEY_TOOL: Record<string, InpaintTool> = { b: 'draw', e: 'erase', g: 'bucket', w: 'wand', p: 'pen', l: 'lasso' }
const BRUSH = new Set<InpaintTool>(['draw', 'erase'])
const MASK_RGB = [100, 100, 200]
const PAD = { top: 64, bottom: 72, left: 76, right: 24 }
const PANEL = 'rounded-lg bg-popover text-popover-foreground shadow-md ring-1 ring-foreground/10'

export function InpaintEditor({ tabId }: { tabId: string }) {
  const open = useInpaint((s) => s.open)
  const mine = open?.tabId === tabId ? open : null
  return (
    <Dialog open={!!mine} onOpenChange={(o) => !o && closeInpaint()}>
      {mine && <Editor tabId={tabId} img={mine.img} />}
    </Dialog>
  )
}

function Editor({ tabId, img }: { tabId: string; img: GenImage }) {
  const { tool, size, tol, strength, hide } = useInpaint()
  useInpaint((s) => s.rev)
  const s = currentSession()!
  const m = s.mask
  const nat = { w: s.px.width, h: s.px.height }
  const { price, n } = useInpaintPrice(tabId, img)
  const bg = useNai((x) => x.transparencyBg)
  const bgColor = useNai((x) => x.transparencyColor)

  // Popover content mounts later; a callback ref starts measurement and wheel listeners when the stage actually exists.
  const [stage, setStage] = useState<HTMLDivElement | null>(null)
  const [box, setBox] = useState({ w: 0, h: 0 })
  const [view, setView] = useState({ k: 1, x: 0, y: 0 })
  useLayoutEffect(() => {
    if (!stage) return
    const ro = new ResizeObserver(() => setBox({ w: stage.clientWidth, h: stage.clientHeight }))
    ro.observe(stage)
    return () => ro.disconnect()
  }, [stage])
  const aw = Math.max(1, box.w - PAD.left - PAD.right)
  const ah = Math.max(1, box.h - PAD.top - PAD.bottom)
  const fitScale = Math.min(aw / nat.w, ah / nat.h)
  const cx = PAD.left + aw / 2
  const cy = PAD.top + ah / 2
  const sw = nat.w * fitScale * view.k
  const sh = nat.h * fitScale * view.k
  const sheet: CSSProperties = { left: cx - sw / 2 + view.x, top: cy - sh / 2 + view.y, width: sw, height: sh }
  const zoomAt = (f: number, px: number, py: number) =>
    setView((v) => {
      const k = Math.min(16, Math.max(0.25, v.k * f))
      const g = k / v.k
      const ox = px - cx
      const oy = py - cy
      return { k, x: ox - (ox - v.x) * g, y: oy - (oy - v.y) * g }
    })
  const fit = () => setView({ k: 1, x: 0, y: 0 })
  // A native wheel listener can prevent browser scrolling while zooming.
  const zoomRef = useRef(zoomAt)
  useLayoutEffect(() => {
    zoomRef.current = zoomAt
  })
  useEffect(() => {
    if (!stage) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const r = stage.getBoundingClientRect()
      zoomRef.current(e.deltaY < 0 ? 1.2 : 1 / 1.2, e.clientX - r.left, e.clientY - r.top)
    }
    stage.addEventListener('wheel', onWheel, { passive: false })
    return () => stage.removeEventListener('wheel', onWheel)
  }, [stage])

  const canvas = useRef<HTMLCanvasElement>(null)
  const edgeOuter = useRef<SVGPathElement>(null)
  const edgeInner = useRef<SVGPathElement>(null)
  const paint = () => {
    const c = canvas.current
    if (!c) return
    const g = c.getContext('2d')!
    const im = g.createImageData(m.gw, m.gh)
    for (let i = 0; i < m.grid.length; i++) if (m.grid[i]) im.data.set([MASK_RGB[0], MASK_RGB[1], MASK_RGB[2], 255], i * 4)
    g.putImageData(im, 0, 0)
    const d = maskEdgePath(m)
    edgeOuter.current?.setAttribute('d', d)
    edgeInner.current?.setAttribute('d', d)
  }
  useLayoutEffect(paint)

  const [space, setSpace] = useState(false)
  const [alt, setAlt] = useState(false)
  const [holdHide, setHoldHide] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const [pen, setPen] = useState<{ x: number; y: number }[]>([])
  const [lasso, setLasso] = useState<{ x: number; y: number }[] | null>(null)
  const [pointer, setPointer] = useState<{ x: number; y: number } | null>(null)
  const [panDown, setPanDown] = useState(false)
  const drag = useRef<{ kind: 'paint'; last: { x: number; y: number } } | { kind: 'pan'; x: number; y: number; vx: number; vy: number } | { kind: 'lasso' } | null>(null)
  const lastClick = useRef(0)

  useEffect(() => {
    document.documentElement.dataset.dim = ''
    return () => void delete document.documentElement.dataset.dim
  }, [])
  useEffect(() => {
    const up = (e: KeyboardEvent) => {
      if (e.key === ' ') setSpace(false)
      else if (e.key.toLowerCase() === 'h') setHoldHide(false)
      else if (e.key === 'Alt') {
        setAlt(false)
        e.preventDefault()
      }
    }
    const blur = () => {
      setSpace(false)
      setAlt(false)
      setHoldHide(false)
    }
    addEventListener('keyup', up)
    addEventListener('blur', blur)
    return () => (removeEventListener('keyup', up), removeEventListener('blur', blur))
  }, [])

  const set = useInpaint.setState
  const setTool = (t: InpaintTool) => {
    setPen([])
    set({ tool: t })
  }
  const empty = maskEmpty(m)

  const local = (e: { clientX: number; clientY: number }) => {
    const r = stage!.getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top }
  }
  const toPx = (p: { x: number; y: number }) => ({ x: ((p.x - (sheet.left as number)) / sw) * nat.w, y: ((p.y - (sheet.top as number)) / sh) * nat.h })
  const toCell = (p: { x: number; y: number }) => {
    const q = toPx(p)
    return { x: q.x / CELL, y: q.y / CELL }
  }
  const scale = sw / nat.w

  const closePen = (pts: { x: number; y: number }[], sub: boolean) => {
    setPen([])
    editMask((mm) => fillPolygon(mm, pts, sub ? 0 : 1))
  }

  const onPointerDown = (e: ReactPointerEvent) => {
    const p = local(e)
    e.currentTarget.setPointerCapture(e.pointerId)
    if (space || e.button === 1) {
      e.preventDefault()
      drag.current = { kind: 'pan', x: e.clientX, y: e.clientY, vx: view.x, vy: view.y }
      setPanDown(true)
      return
    }
    if (e.button !== 0) return
    const add: 0 | 1 = e.altKey ? 0 : 1
    if (BRUSH.has(tool)) {
      const c = toCell(p)
      beginStroke()
      stamp(m, c.x, c.y, size, tool === 'draw' ? 1 : 0)
      paint()
      drag.current = { kind: 'paint', last: c }
    } else if (tool === 'bucket') {
      const c = toCell(p)
      editMask((mm) => bucketFill(mm, Math.floor(c.x), Math.floor(c.y), add))
    } else if (tool === 'wand') {
      const q = toPx(p)
      const sel = wandSelect(s.px, Math.floor(q.x), Math.floor(q.y), tol)
      editMask((mm) => applyPixels(mm, sel, nat.w, nat.h, add))
    } else if (tool === 'lasso') {
      setLasso([toPx(p)])
      drag.current = { kind: 'lasso' }
    } else if (tool === 'pen') {
      const q = toPx(p)
      const now = Date.now()
      const last = pen[pen.length - 1]
      const dbl = now - lastClick.current < 300 && !!last && Math.hypot(q.x - last.x, q.y - last.y) * scale < 6
      lastClick.current = now
      if (pen.length > 2 && (dbl || Math.hypot(q.x - pen[0].x, q.y - pen[0].y) * scale < 10)) return closePen(pen, e.altKey)
      if (!dbl) setPen([...pen, q])
    }
  }
  const onPointerMove = (e: ReactPointerEvent) => {
    const p = local(e)
    setPointer(p)
    setAlt(e.altKey)
    const d = drag.current
    if (!d) return
    if (d.kind === 'pan') return setView((v) => ({ ...v, x: d.vx + e.clientX - d.x, y: d.vy + e.clientY - d.y }))
    if (d.kind === 'paint') {
      const c = toCell(p)
      stroke(m, d.last, c, size, tool === 'draw' ? 1 : 0)
      d.last = c
      paint()
    } else if (d.kind === 'lasso') {
      const q = toPx(p)
      setLasso((l) => {
        if (!l) return l
        const z = l[l.length - 1]
        return Math.hypot(q.x - z.x, q.y - z.y) * scale > 2 ? [...l, q] : l
      })
    }
  }
  const onPointerUp = (e: ReactPointerEvent) => {
    const d = drag.current
    drag.current = null
    setPanDown(false)
    if (d?.kind === 'paint') endStroke()
    else if (d?.kind === 'lasso' && lasso) {
      const pts = lasso
      setLasso(null)
      editMask((mm) => fillPolygon(mm, pts, e.altKey ? 0 : 1))
    }
  }

  // Disabling a focused button can move focus to body; capture inpaint shortcuts on window so they still work.
  const onKeyDown = (e: KeyboardEvent) => {
    const t = e.target as HTMLElement
    if (e.key === 'Escape' || t.closest?.('input, textarea')) return
    const k = e.key.toLowerCase()
    const mod = e.ctrlKey || e.metaKey
    let done = true
    if (e.key === 'Alt') setAlt(true)
    else if (mod && k === 'z' && !e.shiftKey) undoMask()
    else if (mod && (k === 'y' || (k === 'z' && e.shiftKey))) redoMask()
    else if (mod && k === 'i') editMask(invertMask)
    else if (mod && k === '0') fit()
    else if (mod) done = false
    else if (KEY_TOOL[k]) setTool(KEY_TOOL[k])
    else if (k === '[' || k === ']') {
      const d = k === '[' ? -1 : 1
      if (tool === 'wand') set({ tol: Math.min(TOL_RANGE[1], Math.max(TOL_RANGE[0], tol + d * 8)) })
      else set({ size: Math.min(SIZE_RANGE[1], Math.max(SIZE_RANGE[0], size + d * 16)) })
    } else if (k === 'h') setHoldHide(true)
    else if (e.key === ' ') setSpace(true)
    else if (e.key === 'Enter' && tool === 'pen' && pen.length > 2) closePen(pen, e.altKey)
    else if (e.key === 'Backspace' && pen.length) setPen(pen.slice(0, -1))
    else done = false
    if (done) {
      e.preventDefault()
      e.stopPropagation()
    }
  }
  const keyRef = useRef(onKeyDown)
  useLayoutEffect(() => {
    keyRef.current = onKeyDown
  })
  useEffect(() => {
    const h = (e: KeyboardEvent) => keyRef.current(e)
    addEventListener('keydown', h, true)
    return () => removeEventListener('keydown', h, true)
  }, [])

  const hidden = hide || holdHide
  const t = TOOLS.find((x) => x.key === tool)!
  const brush = BRUSH.has(tool)
  const panning = space || panDown
  const points = tool === 'lasso' ? (lasso ?? []) : tool === 'pen' ? pen : []
  const live = tool === 'pen' && pointer && pen.length ? toPx(pointer) : null
  const nearStart = !!live && pen.length > 2 && Math.hypot(live.x - pen[0].x, live.y - pen[0].y) * scale < 10
  const k1 = 1 / scale
  const cursorCell = pointer ? toCell(pointer) : { x: 0, y: 0 }

  return (
    <DialogContent
      showCloseButton={false}
      overlayClassName="bg-black/80 supports-backdrop-filter:backdrop-blur-xs"
      className="inset-0 top-0 left-0 block h-dvh w-screen max-w-none translate-x-0 translate-y-0 rounded-none bg-transparent p-0 ring-0 duration-200 outline-none select-none sm:max-w-none"
      onOpenAutoFocus={(e) => {
        e.preventDefault()
        ;(e.currentTarget as HTMLElement).focus()
      }}
      onEscapeKeyDown={(e) => {
        // Radix handles Escape during document capture, before the field can cancel its draft.
        if ((e.target as HTMLElement).closest('input, textarea')) {
          e.preventDefault()
          return
        }
        e.stopPropagation()
        if (!pen.length) return
        e.preventDefault()
        setPen([])
      }}
      data-testid="inpaint-editor"
    >
      <DialogTitle className="sr-only">重绘</DialogTitle>
      <DialogDescription className="sr-only">涂出要重画的区域，Esc 退出</DialogDescription>

      <div
        ref={setStage}
        className={cn('absolute inset-0 overflow-hidden', panning ? (panDown ? 'cursor-grabbing' : 'cursor-grab') : brush ? 'cursor-none' : 'cursor-crosshair')}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onPointerLeave={() => setPointer(null)}
        onAuxClick={(e) => e.preventDefault()}
        data-testid="inpaint-stage"
      >
        <img src={imageUrl(img)} alt="" draggable={false} className="absolute max-w-none rounded-[2px]" style={{ ...sheet, ...transparencyStyle(bg, bgColor) }} data-testid="inpaint-image" />
        <canvas
          ref={canvas}
          width={m.gw}
          height={m.gh}
          className="pointer-events-none absolute transition-opacity duration-150 [image-rendering:pixelated]"
          style={{ ...sheet, opacity: hidden ? 0 : 0.5 }}
          data-testid="mask-canvas"
          data-hide={hidden ? '' : undefined}
        />
        <svg
          className="pointer-events-none absolute overflow-visible transition-opacity duration-150"
          style={{ ...sheet, opacity: hidden ? 0 : 1 }}
          viewBox={`0 0 ${m.gw} ${m.gh}`}
          preserveAspectRatio="none"
          shapeRendering="crispEdges"
          data-testid="mask-edge"
        >
          <path ref={edgeOuter} fill="none" stroke="#000" strokeWidth={3} vectorEffect="non-scaling-stroke" />
          <path ref={edgeInner} fill="none" stroke="#fff" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
        </svg>
        {points.length > 0 && (
          <svg className="pointer-events-none absolute overflow-visible" style={sheet} viewBox={`0 0 ${nat.w} ${nat.h}`} preserveAspectRatio="none" data-testid="inpaint-path">
            <polyline points={points.map((a) => `${a.x},${a.y}`).join(' ')} fill={tool === 'lasso' ? 'rgb(100 100 200 / .25)' : 'none'} stroke="#000" strokeWidth={3 * k1} strokeLinejoin="round" />
            <polyline points={points.map((a) => `${a.x},${a.y}`).join(' ')} fill="none" stroke="#fff" strokeWidth={1.5 * k1} strokeLinejoin="round" />
            {live && <line x1={pen[pen.length - 1].x} y1={pen[pen.length - 1].y} x2={live.x} y2={live.y} stroke="#fff" strokeWidth={k1} strokeDasharray={`${4 * k1} ${3 * k1}`} />}
            {tool === 'pen' &&
              pen.map((a, i) => (
                <circle key={i} cx={a.x} cy={a.y} r={(i === 0 && nearStart ? 5 : 3) * k1} fill={i === 0 && nearStart ? 'var(--accent)' : '#fff'} stroke="#000" strokeWidth={k1} />
              ))}
          </svg>
        )}
        {pointer && !panning && brush && <BrushCursor d={brushEdgePath(cursorCell.x, cursorCell.y, size)} erase={tool === 'erase'} gw={m.gw} gh={m.gh} sheet={sheet} at={pointer} />}
        {pointer && !panning && !brush && alt && (
          <span className="pointer-events-none absolute text-[13px] leading-none font-semibold text-white [text-shadow:0_0_2px_#000,0_0_2px_#000]" style={{ left: pointer.x + 9, top: pointer.y + 7 }}>
            −
          </span>
        )}
      </div>

      <div className="pointer-events-none absolute top-[calc(14px+var(--wco-h,0px))] left-4 flex animate-in items-center gap-2 text-[13px] text-white duration-200 fade-in-0">
        <span className="flex items-center gap-1.5 font-semibold">
          <Icon icon={INPAINT_ICON} size={16} />
          重绘
        </span>
        <span className="text-white/40">·</span>
        <span className="text-white/75">涂出要重画的区域</span>
      </div>

      <div className={cn(PANEL, 'absolute top-1/2 left-4 flex -translate-y-1/2 animate-in flex-col gap-0.5 p-1 duration-200 fade-in-0')} data-testid="inpaint-tools">
        {TOOLS.map((x, i) => (
          <div key={x.key} className="flex flex-col">
            {i === 2 && <span className="mx-auto my-1 h-px w-5 bg-line" />}
            <Tip label={`${x.name}（${x.k}）${x.sel ? '\n按住 Alt 减去' : ''}`} side="right">
              <button
                type="button"
                className={cn(
                  'grid size-9 place-items-center rounded-md text-ink-2 transition-colors duration-150 outline-none hover:bg-muted hover:text-ink-1 focus-visible:ring-2 focus-visible:ring-(--accent-text)',
                  tool === x.key && 'bg-lamp text-lamp-ink hover:bg-lamp hover:text-lamp-ink',
                )}
                onClick={() => setTool(x.key)}
                aria-label={x.name}
                aria-pressed={tool === x.key}
                data-testid={`mask-${x.key}`}
              >
                <Icon icon={x.icon} size={18} />
              </button>
            </Tip>
          </div>
        ))}
      </div>

      <div className={cn(PANEL, 'absolute top-[calc(10px+var(--wco-h,0px))] left-1/2 flex -translate-x-1/2 animate-in items-center gap-1 p-1 duration-200 fade-in-0 slide-in-from-top-1')} data-testid="inpaint-toolbar">
        <div key={tool} className="flex w-[300px] animate-in items-center pl-1 duration-150 fade-in-0" data-testid="inpaint-options">
          {brush ? (
            <Stepper label="大小" tip="笔刷直径（[ ]）" value={size} min={SIZE_RANGE[0]} max={SIZE_RANGE[1]} step={16} fine={1} digits={0} onChange={(v) => set({ size: v })} testId="mask-size" className="h-7" />
          ) : tool === 'wand' ? (
            <Stepper label="容差" tip="颜色相差多少以内算同一块（[ ]）" value={tol} min={TOL_RANGE[0]} max={TOL_RANGE[1]} step={8} fine={1} digits={0} onChange={(v) => set({ tol: v })} testId="mask-tol" className="h-7" />
          ) : (
            <span className="truncate text-[12px] text-ink-2" data-testid="mask-how">
              {t.how}
            </span>
          )}
        </div>
        <Sep />
        <IconAction icon={UndoIcon} label="撤销（Ctrl+Z）" disabled={!s.undo.length} onClick={undoMask} testId="mask-undo" />
        <IconAction icon={RedoIcon} label="重做（Ctrl+Y）" disabled={!s.redo.length} onClick={redoMask} testId="mask-redo" />
        <Sep />
        <TextAction icon={ContrastIcon} label="反选" tip="反选（Ctrl+I）" onClick={() => editMask(invertMask)} testId="mask-invert" />
        <TextAction icon={Delete02Icon} label="清空" tip="清空蒙版" disabled={empty} onClick={() => editMask((mm: Mask) => mm.grid.fill(0))} testId="mask-clear" />
        <Sep />
        <IconAction icon={hide ? ViewOffIcon : ViewIcon} label={hide ? '显示蒙版' : '隐藏蒙版（按住 H 临时隐藏）'} onClick={() => set({ hide: !hide })} on={hide} testId="mask-eye" />
      </div>

      <div className={cn(PANEL, 'absolute bottom-4 left-4 flex animate-in items-center gap-0.5 p-1 duration-200 fade-in-0')} data-testid="inpaint-zoom">
        <IconAction icon={MinusSignIcon} label="缩小" side="top" onClick={() => zoomAt(1 / 1.2, cx, cy)} testId="mask-zoom-out" />
        <Tip label="适合窗口（Ctrl+0）">
          <button type="button" className="h-7 w-[52px] rounded-sm text-[12px] text-ink-1 tabular-nums transition-colors outline-none hover:bg-muted" onClick={fit} data-testid="mask-zoom">
            {Math.round(scale * 100)}%
          </button>
        </Tip>
        <IconAction icon={PlusSignIcon} label="放大" side="top" onClick={() => zoomAt(1.2, cx, cy)} testId="mask-zoom-in" />
        <Sep />
        <IconAction icon={FitToScreenIcon} label="适合窗口（Ctrl+0）" side="top" onClick={fit} testId="mask-fit" />
      </div>

      <div className={cn(PANEL, 'absolute right-4 bottom-4 flex animate-in items-center gap-2 p-1 pl-1 duration-200 fade-in-0')} data-testid="inpaint-actions">
        <Stepper
          label="重绘强度"
          tip="数值越低，重绘结果越接近原图；价格按强度折算"
          value={strength}
          min={0.01}
          max={1}
          onChange={(v) => set({ strength: v })}
          testId="mask-strength"
          className="h-8"
        />
        <Tip label="退出重绘（Esc）">
          <Button variant="outline" className="h-8 px-3 text-[13px]" onClick={closeInpaint} data-testid="mask-exit">
            退出
          </Button>
        </Tip>
        <SpendPopover
          open={confirm}
          onCancel={() => setConfirm(false)}
          anchor={
            <PopoverAnchor asChild>
              <span className="flex">
                <Tip label={empty ? '请先涂出要重画的区域' : price === PRICE_TOO_LONG ? '当前参数生成耗时过长' : null}>
                  <span className="flex">
                    <Button
                      className="h-8 gap-1.5 pr-1.5 pl-3 text-[13px] font-semibold"
                      disabled={empty || price === PRICE_TOO_LONG}
                      onClick={() => setConfirm(true)}
                      data-testid="inpaint-button"
                    >
                      {n > 1 ? `重绘 ${n} 张` : '重绘'}
                      {price !== PRICE_TOO_LONG && <PricePill n={price} tone="on" testId="inpaint-price" />}
                    </Button>
                  </span>
                </Tip>
              </span>
            </PopoverAnchor>
          }
        >
          <SpendConfirm
            title="重绘"
            desc={`将按编辑器当前的 prompt 和参数重画涂出的区域${s.prefill ? '，原图不透明的部分保持不变' : ''}，结果作为新版本加入历史${n > 1 ? `（${n} 张）` : ''}。`}
            label="重绘"
            price={price}
            onRun={() => void runInpaint()}
            onCancel={() => setConfirm(false)}
            align="end"
            ids={{ box: 'inpaint-confirm', cancel: 'inpaint-cancel', run: 'inpaint-run' }}
          />
        </SpendPopover>
      </div>
    </DialogContent>
  )
}

function BrushCursor({ d, erase, gw, gh, sheet, at }: { d: string; erase: boolean; gw: number; gh: number; sheet: CSSProperties; at: { x: number; y: number } }) {
  return (
    <>
      <svg className="pointer-events-none absolute overflow-visible" style={sheet} viewBox={`0 0 ${gw} ${gh}`} preserveAspectRatio="none" shapeRendering="crispEdges" data-testid="inpaint-cursor">
        <path d={d} fill="none" stroke="rgb(0 0 0 / .55)" strokeWidth={2.5} vectorEffect="non-scaling-stroke" />
        <path d={d} fill="none" stroke="#fff" strokeWidth={1} strokeDasharray={erase ? '3 3' : undefined} vectorEffect="non-scaling-stroke" />
      </svg>
      <svg className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2" style={{ left: at.x, top: at.y }} width={11} height={11} viewBox="0 0 11 11">
        <path d="M5.5 0V11M0 5.5H11" stroke="rgb(0 0 0 / .55)" strokeWidth={3} />
        <path d="M5.5 1V10M1 5.5H10" stroke="#fff" strokeWidth={1} />
      </svg>
    </>
  )
}

const Sep = () => <span className="mx-1 h-4 w-px shrink-0 bg-line" />

function IconAction({ icon, label, onClick, disabled, on, side = 'bottom', testId }: { icon: IconSvgElement; label: string; onClick: () => void; disabled?: boolean; on?: boolean; side?: 'top' | 'bottom'; testId: string }) {
  return (
    <Tip label={label} side={side}>
      <span className="flex">
        <Button variant="ghost" size="icon" className={cn('text-ink-1 disabled:opacity-35', on && 'bg-surface-2')} disabled={disabled} onClick={onClick} aria-label={label} data-testid={testId}>
          <Icon icon={icon} size={16} />
        </Button>
      </span>
    </Tip>
  )
}

function TextAction({ icon, label, tip, onClick, disabled, testId }: { icon: IconSvgElement; label: ReactNode; tip: string; onClick: () => void; disabled?: boolean; testId: string }) {
  return (
    <Tip label={tip} side="bottom">
      <span className="flex">
        <Button variant="ghost" className="h-7 gap-1 px-2 text-[12px] font-normal text-ink-1 disabled:opacity-40" disabled={disabled} onClick={onClick} data-testid={testId}>
          <Icon icon={icon} size={16} className="text-ink-2" />
          {label}
        </Button>
      </span>
    </Tip>
  )
}
