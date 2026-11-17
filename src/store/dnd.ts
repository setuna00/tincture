import { create } from 'zustand'

export interface DropHint {
  sectionId: string
  beforeId: string | null
  markId: string | null
  side: 'before' | 'after' | 'end'
}

export type SectionHint = { sectionId: string; side: 'before' | 'after' } | { boxKey: string }

export interface CharHint {
  index: number
  markId: string | null
  side: 'before' | 'after'
}

export type DragKind = 'chip' | 'section' | 'template' | 'character' | 'char-template' | 'random-char' | 'artist'

export interface DraftOrder {
  sectionId: string
  ids: string[]
}

interface DndState {
  hint: DropHint | null
  sectionHint: SectionHint | null
  charHint: CharHint | null
  dragging: DragKind | null
  order: DraftOrder | null
  ghosts: string[]
  charFold: boolean
  setCharFold(on: boolean): void
  setHint(h: DropHint | null): void
  setSectionHint(h: SectionHint | null): void
  setCharHint(h: CharHint | null): void
  setDragging(k: DragKind | null): void
  setOrder(o: DraftOrder | null): void
  setGhosts(ids: string[]): void
}

const same = (a: object | null, b: object | null) => JSON.stringify(a) === JSON.stringify(b)

export const useDnd = create<DndState>()((set) => ({
  hint: null,
  sectionHint: null,
  charHint: null,
  dragging: null,
  order: null,
  ghosts: [],
  charFold: false,
  setCharFold: (charFold) => set({ charFold }),
  setDragging: (dragging) => set({ dragging }),
  setHint: (hint) => set((s) => (same(s.hint, hint) ? s : { hint })),
  setSectionHint: (sectionHint) => set((s) => (same(s.sectionHint, sectionHint) ? s : { sectionHint })),
  setCharHint: (charHint) => set((s) => (same(s.charHint, charHint) ? s : { charHint })),
  setOrder: (order) => set({ order }),
  setGhosts: (ghosts) => set({ ghosts }),
}))
