// Motion layout transforms conflict with dnd-kit inline transforms; animate chip reordering with WAAPI.

const DURATION = 140
const EASING = 'cubic-bezier(0.2, 0, 0, 1)'
const ID = 'chip-flip'

const FRESH_MS = 200

const snaps = new Map<string, { t: number; rects: Map<string, DOMRect> }>()

const chipsOf = (sectionId: string) =>
  [...document.querySelectorAll<HTMLElement>(`[data-section-id="${CSS.escape(sectionId)}"] .section-body > .chip[data-chip-id]`)]

export function captureChips(sectionId: string) {
  snaps.set(sectionId, { t: performance.now(), rects: new Map(chipsOf(sectionId).map((el) => [el.dataset.chipId!, el.getBoundingClientRect()])) })
}

export function playChips(sectionId: string) {
  const entry = snaps.get(sectionId)
  snaps.delete(sectionId)
  const snap = entry && performance.now() - entry.t < FRESH_MS ? entry.rects : null
  if (!snap || matchMedia('(prefers-reduced-motion: reduce)').matches) return
  const els = chipsOf(sectionId)
  for (const el of els) for (const a of el.getAnimations()) if (a.id === ID) a.cancel()
  const moves = els.map((el) => {
    const from = snap.get(el.dataset.chipId!)
    const to = el.getBoundingClientRect()
    return { el, dx: from ? from.left - to.left : 0, dy: from ? from.top - to.top : 0 }
  })
  for (const { el, dx, dy } of moves) {
    if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) continue
    el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'translate(0, 0)' }], { duration: DURATION, easing: EASING, id: ID })
  }
}

export function layoutRect(el: HTMLElement): DOMRect {
  const r = el.getBoundingClientRect()
  const t = getComputedStyle(el).transform
  if (!t || t === 'none') return r
  const m = new DOMMatrixReadOnly(t)
  return new DOMRect(r.left - m.e, r.top - m.f, r.width, r.height)
}

export { chipsOf }
