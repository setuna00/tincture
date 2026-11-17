import { useLayoutEffect, useState, type RefObject } from 'react'

export const RIGHT_DEFAULT_MAX = 640
const RIGHT_DEFAULT_RATIO = 0.4
export function rightDefault(areaW: number): number {
  return Math.min(RIGHT_DEFAULT_MAX, Math.max(RIGHT_MIN, Math.round(areaW * RIGHT_DEFAULT_RATIO)))
}
export const RIGHT_MIN = 360
export const EDITOR_MIN = 560
export const EDITOR_FLOOR = 320
export const RAIL_W = 30

const EDGE_W = 1

export function rightMax(areaW: number): number {
  return areaW ? Math.max(RIGHT_MIN, areaW - EDITOR_MIN - EDGE_W) : Infinity
}

export function rightFits(areaW: number): boolean {
  return !areaW || areaW >= EDITOR_FLOOR + EDGE_W + RIGHT_MIN
}

export function useAreaWidth(ref: RefObject<HTMLElement | null>) {
  const [w, setW] = useState(0)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    setW(el.getBoundingClientRect().width)
    const ro = new ResizeObserver(([e]) => setW(e.contentRect.width))
    ro.observe(el)
    return () => ro.disconnect()
  }, [ref])
  return w
}

export const HISTORY_HEAD = 28
export const HISTORY_DEFAULT = 124
export const HISTORY_MIN = 64
const HISTORY_MAX = 240
const HISTORY_MAX_RATIO = 0.35
export const THUMB_PAD = 12

export function historyMax(regionH: number): number {
  return regionH ? Math.max(HISTORY_MIN, Math.min(HISTORY_MAX, Math.round(regionH * HISTORY_MAX_RATIO))) : HISTORY_MAX
}
