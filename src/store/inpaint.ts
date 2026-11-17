import { toast } from 'sonner'
import { create } from 'zustand'
import { readPixels } from '@/lib/inpaint-image'
import { inpaintModelId, maskEmpty, newMask, prefillTransparent, type Mask, type Pixels } from '@/lib/nai-inpaint'
import { imageBlob, useGen, type GenImage } from './gen'
import { getDocStore } from './tabs'

export type InpaintTool = 'draw' | 'erase' | 'bucket' | 'wand' | 'pen' | 'lasso'

export interface InpaintSession {
  mask: Mask
  undo: Uint8Array[]
  redo: Uint8Array[]
  prefill: Uint8Array | null
  px: Pixels
}

interface InpaintState {
  open: { tabId: string; docId: string; img: GenImage } | null
  tool: InpaintTool
  /** Diameter is in source-image pixels and must be a multiple of 16. */
  size: number
  tol: number
  strength: number
  hide: boolean
  rev: number
}

export const useInpaint = create<InpaintState>()(() => ({ open: null, tool: 'draw', size: 32, tol: 32, strength: 1, hide: false, rev: 0 }))

export const SIZE_RANGE = [16, 256] as const
export const TOL_RANGE = [0, 255] as const

const sessions = new Map<string, InpaintSession>()
const UNDO_MAX = 100

export const currentSession = (): InpaintSession | null => {
  const o = useInpaint.getState().open
  return o ? (sessions.get(o.img.id) ?? null) : null
}

export async function openInpaint(tabId: string, docId: string, img: GenImage) {
  if (useInpaint.getState().open || useGen.getState().running) return
  if (!inpaintModelId(getDocStore(tabId).getState().doc.settings)) return
  let s = sessions.get(img.id)
  let prefilled = false
  if (!s) {
    const px = await readPixels(await imageBlob(img))
    const mask = newMask(px.width, px.height)
    prefilled = prefillTransparent(mask, px)
    s = { mask, undo: [], redo: [], prefill: prefilled ? mask.grid.slice() : null, px }
    sessions.set(img.id, s)
  }
  useInpaint.setState((st) => ({ open: { tabId, docId, img }, hide: false, rev: st.rev + 1 }))
  if (prefilled) toast('已按透明区域涂好蒙版', { id: 'inpaint-prefill' })
}

export const closeInpaint = () => useInpaint.setState({ open: null })

const bump = () => useInpaint.setState((st) => ({ rev: st.rev + 1 }))

export function editMask(f: (m: Mask) => void) {
  const s = currentSession()
  if (!s) return
  const before = s.mask.grid.slice()
  f(s.mask)
  if (before.every((x, i) => x === s.mask.grid[i])) return
  s.undo.push(before)
  if (s.undo.length > UNDO_MAX) s.undo.shift()
  s.redo = []
  bump()
}

export function beginStroke() {
  const s = currentSession()
  if (!s) return
  s.undo.push(s.mask.grid.slice())
  if (s.undo.length > UNDO_MAX) s.undo.shift()
}
export function endStroke() {
  const s = currentSession()
  if (!s) return
  const last = s.undo[s.undo.length - 1]
  if (last && last.every((x, i) => x === s.mask.grid[i])) s.undo.pop()
  else s.redo = []
  bump()
}

export function undoMask() {
  const s = currentSession()
  if (!s?.undo.length) return
  s.redo.push(s.mask.grid.slice())
  s.mask.grid.set(s.undo.pop()!)
  bump()
}
export function redoMask() {
  const s = currentSession()
  if (!s?.redo.length) return
  s.undo.push(s.mask.grid.slice())
  s.mask.grid.set(s.redo.pop()!)
  bump()
}

export async function runInpaint() {
  const o = useInpaint.getState().open
  const s = currentSession()
  if (!o || !s || maskEmpty(s.mask)) return
  const { strength } = useInpaint.getState()
  closeInpaint()
  const before = new Set((useGen.getState().history[o.docId] ?? []).map((x) => x.id))
  await useGen.getState().generate(o.tabId, { source: o.img, mask: { ...s.mask, grid: s.mask.grid.slice() }, prefill: s.prefill, strength })
  if ((useGen.getState().history[o.docId] ?? []).some((x) => !before.has(x.id) && x.sourceId === o.img.id)) sessions.delete(o.img.id)
}
