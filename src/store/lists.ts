import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { addNode, addTags, deleteNode, ensurePath, exampleLists, moveNode, moveTags, newList, normalizeNodes, packHistory, removeTags, renameNode, setTags, unpackHistory, type DropPos, type PackedHistory, type UserList, type UserListNode } from '@/lib/lists'
import { untitledName } from '@/lib/discover'
import { SEED_EXAMPLES, withoutUntouched } from './seed'
import { safeStorage } from './storage'

type Nodes = UserListNode[]

interface ListsState {
  lists: UserList[]
  past: UserList[][]
  future: UserList[][]
  /** Naming-rule version 2 means aliases and renamed tags have been normalized; version 1 waits for the tag database before conversion. */
  norm: number
  normalizeAll(fn: (text: string) => string): void
  createList(name?: string): UserList
  renameList(id: string, name: string): boolean
  deleteList(id: string): void
  replaceLists(lists: UserList[]): void
  editNodes(listId: string, fn: (nodes: Nodes) => Nodes): void
  addTags(listId: string, nodeId: string, tags: string[]): string[]
  removeTags(listId: string, items: [string, string][]): void
  moveTags(listId: string, items: [string, string][], to: string): void
  setTags(listId: string, nodeId: string, tags: string[]): void
  addNode(listId: string, parentId: string | null, title?: string): UserListNode | null
  ensurePath(listId: string, parentId: string | null, path: string): UserListNode | null
  renameNode(listId: string, id: string, title: string): void
  deleteNode(listId: string, id: string): void
  moveNode(listId: string, id: string, target: string, pos: DropPos): void
  undo(): boolean
  redo(): boolean
}

const MAX_HISTORY = 100
const SAVED_HISTORY = 20

export const useLists = create<ListsState>()(
  persist(
    (set, get) => {
      const commit = (next: UserList[]) => {
        const prev = get().lists
        if (next === prev) return
        set({ lists: next, past: [...get().past.slice(-(MAX_HISTORY - 1)), prev], future: [] })
      }
      const mapList = (listId: string, fn: (l: UserList) => UserList) => {
        let changed = false
        const next = get().lists.map((l) => {
          if (l.id !== listId) return l
          const n = fn(l)
          if (n !== l) changed = true
          return n
        })
        if (changed) commit(next)
      }
      const withNodes = (listId: string, fn: (nodes: Nodes) => Nodes) => mapList(listId, (l) => {
        const nodes = fn(l.nodes)
        return nodes === l.nodes ? l : { ...l, nodes }
      })
      return {
        lists: SEED_EXAMPLES ? exampleLists() : [],
        past: [],
        future: [],
        norm: 2,
        normalizeAll: (fn) => {
          const lists = get().lists.map((l) => {
            const nodes = normalizeNodes(l.nodes, fn)
            return nodes === l.nodes ? l : { ...l, nodes }
          })
          set({ lists, norm: 2, past: [], future: [] })
        },
        createList: (name) => {
          const l = newList(name?.trim() || untitledName(get().lists.map((x) => x.name), '未命名 list'))
          commit([...get().lists, l])
          return l
        },
        renameList: (id, name) => {
          const n = name.trim()
          if (!n || get().lists.some((l) => l.id !== id && l.name === n)) return false
          mapList(id, (l) => (l.name === n ? l : { ...l, name: n }))
          return true
        },
        deleteList: (id) => commit(get().lists.filter((l) => l.id !== id)),
        replaceLists: commit,
        editNodes: withNodes,
        addTags: (listId, nodeId, tags) => {
          let added: string[] = []
          withNodes(listId, (nodes) => {
            const r = addTags(nodes, nodeId, tags)
            added = r.added
            return r.nodes
          })
          return added
        },
        removeTags: (listId, items) => withNodes(listId, (n) => removeTags(n, items)),
        moveTags: (listId, items, to) => withNodes(listId, (n) => moveTags(n, items, to)),
        setTags: (listId, nodeId, tags) => withNodes(listId, (n) => setTags(n, nodeId, tags)),
        addNode: (listId, parentId, title) => {
          let node: UserListNode | null = null
          withNodes(listId, (nodes) => {
            const r = addNode(nodes, parentId, title)
            node = r.node
            return r.nodes
          })
          return node
        },
        ensurePath: (listId, parentId, path) => {
          let node: UserListNode | null = null
          withNodes(listId, (nodes) => {
            const r = ensurePath(nodes, parentId, path)
            node = r.node
            return r.nodes
          })
          return node
        },
        renameNode: (listId, id, title) => withNodes(listId, (n) => renameNode(n, id, title)),
        deleteNode: (listId, id) => withNodes(listId, (n) => deleteNode(n, id)),
        moveNode: (listId, id, target, pos) => withNodes(listId, (n) => moveNode(n, id, target, pos)),
        undo: () => {
          const { past, lists, future } = get()
          if (!past.length) return false
          set({ lists: past[past.length - 1], past: past.slice(0, -1), future: [lists, ...future] })
          return true
        },
        redo: () => {
          const { past, lists, future } = get()
          if (!future.length) return false
          set({ lists: future[0], past: [...past, lists], future: future.slice(1) })
          return true
        },
      }
    },
    {
      name: 'pe:lists',
      version: 3,
      storage: createJSONStorage(() => safeStorage),
      // Persist lists and packed history in the same record so every saved history ID resolves against the matching list state.
      partialize: (s) => ({
        lists: s.lists,
        norm: s.norm,
        history: { past: packHistory(s.past.slice(-SAVED_HISTORY), s.lists), future: packHistory(s.future.slice(0, SAVED_HISTORY), s.lists) },
      }),
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<ListsState> & { history?: { past: PackedHistory; future: PackedHistory } }
        const lists = p.lists ?? current.lists
        const past = p.history ? unpackHistory(p.history.past, lists) : null
        const future = past && p.history ? unpackHistory(p.history.future, lists) : null
        return { ...current, lists, norm: p.norm ?? current.norm, past: past ?? [], future: future ?? [] }
      },
      migrate: (old, version) => {
        const s = old as Partial<ListsState>
        const lists = version < 3 && !SEED_EXAMPLES ? withoutUntouched(s.lists, exampleLists()) : (s.lists ?? [])
        return { ...s, lists, norm: version < 2 ? 1 : (s.norm ?? 2) } as ListsState
      },
    },
  ),
)

export const getList = (id: string) => useLists.getState().lists.find((l) => l.id === id)
