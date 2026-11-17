// Node IDs use s: for all sections, s:<path> for folders, c: for all characters, and c:<work> for works; suffix ∅ means root or no work.
import { create } from 'zustand'
import { chipZh } from '@/lib/tagdb'
import { folderPaths, inPath, workNames } from '@/lib/library-ops'
import type { CharacterTemplate, SectionTemplate } from '@/store/library'

export type Kind = 's' | 'c'
export const NONE = '∅'
export const ALL_SECTIONS = 's:'
export const ALL_CHARACTERS = 'c:'

export const kindOf = (node: string): Kind => (node[0] === 'c' ? 'c' : 's')
export const pathOf = (node: string) => node.slice(2)
export const folderNode = (path: string) => `s:${path || NONE}`
export const workNode = (work: string) => `c:${work || NONE}`
export const isGroupNode = (node: string) => pathOf(node) !== '' && pathOf(node) !== NONE

export function nodeLabel(node: string, full = false) {
  const p = pathOf(node)
  if (p === '') return kindOf(node) === 's' ? '区块模板' : '角色模板'
  if (p === NONE) return kindOf(node) === 's' ? '根目录' : '无所属作品'
  return full ? p : p.slice(p.lastIndexOf('/') + 1)
}

interface PageState {
  node: string
  selected: string[]
  anchor: string | null
  q: string
  renaming: string | null
  moveOpen: boolean
  closed: Record<string, boolean>
  set(patch: Partial<Omit<PageState, 'set'>>): void
}

export const useLibPage = create<PageState>()((set) => ({
  node: ALL_SECTIONS,
  selected: [],
  anchor: null,
  q: '',
  renaming: null,
  moveOpen: false,
  closed: {},
  set: (patch) => set(patch),
}))

export const openNode = (node: string) => useLibPage.getState().set({ node, selected: [], anchor: null, q: '', moveOpen: false })

export function validNode(node: string, sections: SectionTemplate[], chars: CharacterTemplate[]): string {
  const p = pathOf(node)
  if (p === '' || p === NONE) return node
  if (kindOf(node) === 'c') return workNames(chars.map((t) => t.work)).includes(p) ? node : ALL_CHARACTERS
  const all = folderPaths(sections.map((t) => t.folder))
  let cur = p
  while (cur && !all.includes(cur)) cur = cur.includes('/') ? cur.slice(0, cur.lastIndexOf('/')) : ''
  return cur ? folderNode(cur) : ALL_SECTIONS
}

export function sectionsIn(node: string, list: SectionTemplate[]) {
  const p = pathOf(node)
  return p === '' ? list : p === NONE ? list.filter((t) => !t.folder) : list.filter((t) => inPath(t.folder, p))
}
export function charsIn(node: string, list: CharacterTemplate[]) {
  const p = pathOf(node)
  return p === '' ? list : p === NONE ? list.filter((t) => !t.work?.trim()) : list.filter((t) => t.work?.trim() === p)
}

const words = (q: string) => q.toLowerCase().split(/\s+/).filter(Boolean)
export function sectionMatches(t: SectionTemplate, q: string) {
  const hay = [t.name, t.folder, t.note ?? '', ...t.chips.flatMap((c) => [c.text, chipZh(c) ?? ''])].join('\n').toLowerCase()
  return words(q).every((w) => hay.includes(w))
}
