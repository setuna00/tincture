import { useLayoutEffect, useState, type RefObject } from 'react'

export function useHeight(ref: RefObject<HTMLElement | null>) {
  const [h, setH] = useState(0)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    setH(el.getBoundingClientRect().height)
    const ro = new ResizeObserver(([e]) => setH(e.borderBoxSize?.[0]?.blockSize ?? e.contentRect.height))
    ro.observe(el)
    return () => ro.disconnect()
  }, [ref])
  return h
}
