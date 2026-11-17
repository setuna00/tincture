import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react'
import type { TransparencyBg } from '@/store/nai'

const ZOOM_STEP = 1.2
const ZOOM_MAX = 16

export interface ZoomView {
  k: number
  x: number
  y: number
}
const FIT: ZoomView = { k: 1, x: 0, y: 0 }

export function useZoomPan({
  wheel = false,
  drag: freeDrag = false,
  fitOnDoubleClick = true,
  dragOutAtFit = false,
}: { wheel?: boolean; drag?: boolean; fitOnDoubleClick?: boolean; dragOutAtFit?: boolean } = {}) {
  const box = useRef<HTMLDivElement>(null)
  const fit = useRef<HTMLDivElement>(null)
  const [view, setView] = useState<ZoomView>(FIT)
  const drag = useRef<{ x: number; y: number; vx: number; vy: number } | null>(null)
  const moved = useRef(false)
  const zoomed = view.k !== 1 || view.x !== 0 || view.y !== 0
  const [panning, setPanning] = useState(false)

  useEffect(() => {
    const el = box.current!
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !wheel) return
      e.preventDefault()
      const r = fit.current!.getBoundingClientRect()
      const px = e.clientX - r.left - r.width / 2
      const py = e.clientY - r.top - r.height / 2
      setView((v) => {
        const k = Math.min(ZOOM_MAX, Math.max(1, v.k * (e.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP)))
        if (k === 1) return FIT
        const f = k / v.k
        return { k, x: px - (px - v.x) * f, y: py - (py - v.y) * f }
      })
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [wheel])

  const handlers = {
    onPointerDown(e: ReactPointerEvent) {
      moved.current = false
      if (e.button !== 0 || (!e.shiftKey && !zoomed && (!freeDrag || dragOutAtFit))) return
      e.preventDefault()
      drag.current = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y }
    },
    onPointerMove(e: ReactPointerEvent) {
      const d = drag.current
      if (!d) return
      if (!e.buttons) {
        drag.current = null
        setPanning(false)
        return
      }
      if (!moved.current) {
        if (Math.abs(e.clientX - d.x) + Math.abs(e.clientY - d.y) <= 3) return
        moved.current = true
        e.currentTarget.setPointerCapture(e.pointerId)
        setPanning(true)
      }
      setView((v) => ({ ...v, x: d.vx + e.clientX - d.x, y: d.vy + e.clientY - d.y }))
    },
    onPointerUp: () => {
      drag.current = null
      setPanning(false)
    },
    onPointerCancel: () => {
      drag.current = null
      setPanning(false)
    },
    onDoubleClick: () => fitOnDoubleClick && setView(FIT),
  }
  const transform = `translate(${view.x}px, ${view.y}px) scale(${view.k})`
  return { box, fit, view, zoomed, panning, transform, handlers, moved, reset: () => setView(FIT) }
}

export const fitStyle = (w: number, h: number, cap?: boolean): CSSProperties => ({
  aspectRatio: `${w} / ${h}`,
  width: `min(100cqw, calc(100cqh * ${(w / h).toFixed(5)})${cap ? `, ${w}px` : ''})`,
})

export function transparencyStyle(bg: TransparencyBg, color: string): CSSProperties {
  const checker = (a: string, b: string): CSSProperties => ({
    backgroundColor: a,
    backgroundImage: `linear-gradient(45deg, ${b} 25%, transparent 25%, transparent 75%, ${b} 75%), linear-gradient(45deg, ${b} 25%, transparent 25%, transparent 75%, ${b} 75%)`,
    backgroundSize: '16px 16px',
    backgroundPosition: '0 0, 8px 8px',
  })
  switch (bg) {
    case 'checker':
      return checker('var(--work)', 'var(--surface-2)')
    case 'checkerLight':
      return checker('#ffffff', '#e4e4e7')
    case 'checkerDark':
      return checker('#27272a', '#3f3f46')
    case 'none':
      return {}
    case 'custom':
      return { backgroundColor: color }
    default:
      return { backgroundColor: { black: '#000', white: '#fff', gray: '#808080', red: '#ff0000', green: '#00ff00', blue: '#0000ff' }[bg] }
  }
}
