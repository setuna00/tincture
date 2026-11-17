import { create } from 'zustand'
import { canMoveFolder } from '@/lib/library-ops'
import { kindOf, NONE, pathOf, type Kind } from './state'

export type Dragging = { type: 'items'; kind: Kind; ids: string[] } | { type: 'folder'; path: string } | null

export const useLibDrag = create<{ active: Dragging; over: string | null }>()(() => ({ active: null, over: null }))

export const ITEM_DRAG = 'item:'
export const FOLDER_DRAG = 'folder:'
export const NODE_DROP = 'node:'

export function canDrop(active: Dragging, node: string): boolean {
  if (!active) return false
  const p = pathOf(node)
  if (p === '') return false
  if (active.type === 'items') return kindOf(node) === active.kind
  if (kindOf(node) !== 's') return false
  return canMoveFolder(active.path, p === NONE ? '' : p)
}
