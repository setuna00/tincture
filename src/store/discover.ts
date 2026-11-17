import { create } from 'zustand'
import type { DropPos } from '@/lib/lists'

export interface Located {
  name: string
  paths: string[]
  rows?: string[]
  i: number
}

export type DiscoverDrag = { type: 'rows'; keys: string[] } | { type: 'node'; id: string } | null

interface DiscoverState {
  cart: string[]
  expanded: Record<string, boolean>
  located: Located | null
  selected: string[]
  anchor: string | null
  drag: DiscoverDrag
  over: { id: string; pos: DropPos } | null
  renaming: string | null
  textNodes: Record<string, boolean>
  put: { tags: string[]; from: string } | null
  lastPut: { listId: string; nodeId: string } | null
  toggleCart(name: string): void
  addCart(names: string[]): void
  removeCart(name: string): void
  clearCart(): void
  toggleExpanded(key: string): void
  expand(keys: string[]): void
  setLocated(l: Located | null): void
  set(patch: Partial<Pick<DiscoverState, 'selected' | 'anchor' | 'drag' | 'over' | 'renaming' | 'textNodes' | 'put' | 'lastPut'>>): void
}

export const useDiscover = create<DiscoverState>()((set) => ({
  cart: [],
  expanded: {},
  located: null,
  selected: [],
  anchor: null,
  drag: null,
  over: null,
  renaming: null,
  textNodes: {},
  put: null,
  lastPut: null,
  toggleCart: (name) => set((s) => ({ cart: s.cart.includes(name) ? s.cart.filter((n) => n !== name) : [...s.cart, name] })),
  addCart: (names) => set((s) => ({ cart: [...s.cart, ...names.filter((n, i) => !s.cart.includes(n) && names.indexOf(n) === i)] })),
  removeCart: (name) => set((s) => ({ cart: s.cart.filter((n) => n !== name) })),
  clearCart: () => set({ cart: [] }),
  toggleExpanded: (key) => set((s) => ({ expanded: { ...s.expanded, [key]: !s.expanded[key] } })),
  expand: (keys) => set((s) => ({ expanded: { ...s.expanded, ...Object.fromEntries(keys.map((k) => [k, true])) } })),
  setLocated: (located) => set({ located }),
  set: (patch) => set(patch),
}))

/** Row keys use node-or-atom|tag; split only at the first separator because tags may contain |. */
export function splitRowKey(key: string): [string, string] {
  const i = key.indexOf('|')
  return [key.slice(0, i), key.slice(i + 1)]
}

let cartRef: string[] | null = null
let cartSet = new Set<string>()
export function cartHas(cart: string[], name: string) {
  if (cart !== cartRef) {
    cartRef = cart
    cartSet = new Set(cart)
  }
  return cartSet.has(name)
}

export const selectedNames = (keys: string[]) => [...new Set(keys.map((k) => splitRowKey(k)[1]))]

export const ROW_DRAG = 'row:'
export const NODE_DRAG = 'tnode:'
export const NODE_DROP = 'drop:'

export const overlayOpen = () => !!document.querySelector('[role=dialog], [role=menu], [role=alertdialog]')
