import { produce } from 'immer'
import { newId, parsePrompt, chipLiteral } from './nai'
import { untitledName, type ListNode } from './discover'

export interface UserListNode {
  /** References store node ids, so renaming or moving a node must not replace its id. */
  id: string
  title: string
  tags: string[]
  children: UserListNode[]
}

export interface UserList {
  id: string
  name: string
  nodes: UserListNode[]
  createdAt: number
}

export interface ListsFile {
  version: 1
  lists: UserList[]
}

export const BUILTIN_LISTS = ['a', 'b', 'c'] as const
export const isBuiltinList = (id: string) => (BUILTIN_LISTS as readonly string[]).includes(id)

export function newNode(title: string, tags: string[] = []): UserListNode {
  return { id: newId('n'), title, tags, children: [] }
}

export function newList(name: string, nodes: UserListNode[] = []): UserList {
  return { id: newId('l'), name, nodes, createdAt: Date.now() }
}

export function walk(nodes: UserListNode[], fn: (n: UserListNode, parent: UserListNode | null, depth: number) => void, parent: UserListNode | null = null, depth = 1) {
  for (const n of nodes) {
    fn(n, parent, depth)
    walk(n.children, fn, n, depth + 1)
  }
}

export function findListNode(nodes: UserListNode[], id: string): UserListNode | undefined {
  for (const n of nodes) {
    if (n.id === id) return n
    const hit = findListNode(n.children, id)
    if (hit) return hit
  }
  return undefined
}

export function nodeChain(nodes: UserListNode[], id: string): UserListNode[] {
  for (const n of nodes) {
    if (n.id === id) return [n]
    const sub = nodeChain(n.children, id)
    if (sub.length) return [n, ...sub]
  }
  return []
}

export function allTags(n: UserListNode): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  walk([n], (x) => {
    for (const t of x.tags) {
      const k = t.toLowerCase()
      if (!seen.has(k)) {
        seen.add(k)
        out.push(t)
      }
    }
  })
  return out
}

export function countNodes(nodes: UserListNode[]): number {
  let n = 0
  walk(nodes, () => n++)
  return n
}

export function toListTree(list: UserList): ListNode {
  const conv = (n: UserListNode, parentPath: string, depth: number): ListNode => {
    const path = parentPath ? `${parentPath}/${n.id}` : n.id
    return { title: n.title, path, depth, tags: n.tags, children: n.children.map((c) => conv(c, path, depth + 1)), id: n.id }
  }
  return { title: list.name, path: '', depth: 0, tags: [], children: list.nodes.map((n) => conv(n, '', 1)) }
}

type Nodes = UserListNode[]
const edit = (nodes: Nodes, fn: (draft: Nodes) => void): Nodes => produce(nodes, fn)

function findIn(draft: Nodes, id: string): { node: UserListNode; siblings: UserListNode[]; index: number } | null {
  for (let i = 0; i < draft.length; i++) {
    if (draft[i].id === id) return { node: draft[i], siblings: draft, index: i }
    const hit = findIn(draft[i].children, id)
    if (hit) return hit
  }
  return null
}

/** Deduplicate outside Immer drafts; repeated proxy-array scans make large tag batches quadratic. */
export function addTags(nodes: Nodes, nodeId: string, tags: string[]): { nodes: Nodes; added: string[] } {
  const cur = findListNode(nodes, nodeId)
  if (!cur) return { nodes, added: [] }
  const seen = new Set(cur.tags.map((x) => x.toLowerCase()))
  const added: string[] = []
  for (const t of tags) {
    const text = t.trim()
    const k = text.toLowerCase()
    if (!text || seen.has(k)) continue
    seen.add(k)
    added.push(text)
  }
  if (!added.length) return { nodes, added }
  const next = edit(nodes, (d) => {
    const f = findIn(d, nodeId)
    if (f) f.node.tags = [...cur.tags, ...added]
  })
  return { nodes: next, added }
}

export function removeTags(nodes: Nodes, items: [string, string][]): Nodes {
  if (!items.length) return nodes
  const byNode = new Map<string, Set<string>>()
  for (const [id, text] of items) (byNode.get(id) ?? byNode.set(id, new Set()).get(id)!).add(text.toLowerCase())
  const kept = new Map<string, string[]>()
  for (const [id, drop] of byNode) {
    const cur = findListNode(nodes, id)
    if (cur) kept.set(id, cur.tags.filter((x) => !drop.has(x.toLowerCase())))
  }
  return edit(nodes, (d) => {
    for (const [id, tags] of kept) {
      const f = findIn(d, id)
      if (f) f.node.tags = tags
    }
  })
}

export function moveTags(nodes: Nodes, items: [string, string][], to: string): Nodes {
  const moving = items.filter(([id]) => id !== to)
  if (!moving.length) return nodes
  const removed = removeTags(nodes, moving)
  return addTags(removed, to, moving.map(([, t]) => t)).nodes
}

export const nodeText = (tags: string[]) => (tags.length ? `${tags.join(', ')}, ` : '')

export function parseNodeText(text: string): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const p of parsePrompt(text)) {
    const t = p.type === 'tag' || p.type === 'text' ? p.text : chipLiteral(p)
    if (t && !seen.has(t.toLowerCase())) {
      seen.add(t.toLowerCase())
      out.push(t)
    }
  }
  return out
}

export function normalizeNodes(nodes: Nodes, fn: (text: string) => string): Nodes {
  let changed = false
  const conv = (n: UserListNode): UserListNode => {
    const seen = new Set<string>()
    const tags: string[] = []
    for (const t of n.tags) {
      const to = fn(t)
      const k = to.toLowerCase()
      if (seen.has(k)) continue
      seen.add(k)
      tags.push(to)
    }
    const children = n.children.map(conv)
    const same = tags.length === n.tags.length && tags.every((t, i) => t === n.tags[i]) && children.every((c, i) => c === n.children[i])
    if (same) return n
    changed = true
    return { ...n, tags, children }
  }
  const next = nodes.map(conv)
  return changed ? next : nodes
}

export function setTags(nodes: Nodes, nodeId: string, tags: string[]): Nodes {
  const cur = findListNode(nodes, nodeId)
  if (!cur || (cur.tags.length === tags.length && cur.tags.every((t, i) => t === tags[i]))) return nodes
  return edit(nodes, (d) => {
    const f = findIn(d, nodeId)
    if (f) f.node.tags = tags
  })
}

export function addNode(nodes: Nodes, parentId: string | null, title?: string): { nodes: Nodes; node: UserListNode } {
  const siblings = parentId ? (findListNode(nodes, parentId)?.children ?? []) : nodes
  const node = newNode(title?.trim() || untitledName(siblings.map((s) => s.title)))
  const next = edit(nodes, (d) => {
    if (!parentId) d.push(node)
    else findIn(d, parentId)?.node.children.push(node)
  })
  return { nodes: next, node }
}

export function ensurePath(nodes: Nodes, parentId: string | null, path: string): { nodes: Nodes; node: UserListNode | null } {
  const parts = path
    .split('/')
    .map((s) => s.trim())
    .filter(Boolean)
  let cur = nodes
  let parent = parentId
  let node: UserListNode | null = null
  for (const part of parts) {
    const siblings = parent ? (findListNode(cur, parent)?.children ?? []) : cur
    const hit = siblings.find((s) => s.title === part)
    if (hit) node = hit
    else {
      const r = addNode(cur, parent, part)
      cur = r.nodes
      node = r.node
    }
    parent = node.id
  }
  return { nodes: cur, node }
}

export function renameNode(nodes: Nodes, id: string, title: string): Nodes {
  const t = title.trim()
  const cur = findListNode(nodes, id)
  if (!t || !cur || cur.title === t) return nodes
  return edit(nodes, (d) => {
    const f = findIn(d, id)
    if (f) f.node.title = t
  })
}

export function deleteNode(nodes: Nodes, id: string): Nodes {
  if (!findListNode(nodes, id)) return nodes
  return edit(nodes, (d) => {
    const f = findIn(d, id)
    if (f) f.siblings.splice(f.index, 1)
  })
}

export type DropPos = 'before' | 'after' | 'inside'

export function canMoveNode(nodes: Nodes, id: string, target: string): boolean {
  if (id === target) return false
  const n = findListNode(nodes, id)
  return !!n && !findListNode(n.children, target)
}

export function moveNode(nodes: Nodes, id: string, target: string, pos: DropPos): Nodes {
  if (!canMoveNode(nodes, id, target)) return nodes
  return edit(nodes, (d) => {
    const from = findIn(d, id)!
    const [node] = from.siblings.splice(from.index, 1)
    const to = findIn(d, target)!
    if (pos === 'inside') to.node.children.push(node)
    else to.siblings.splice(pos === 'before' ? to.index : to.index + 1, 0, node)
  })
}

export function siblingIndex(lists: UserList[], official: (text: string) => string | null): (name: string) => string[] {
  const nodes: string[][] = []
  const byTag = new Map<string, number[]>()
  for (const l of lists)
    walk(l.nodes, (n) => {
      const names = [...new Set(n.tags.map(official).filter((x): x is string => !!x))]
      if (names.length < 2) return
      const i = nodes.push(names) - 1
      for (const a of names) (byTag.get(a) ?? byTag.set(a, []).get(a)!).push(i)
    })
  return (name) => {
    const out = new Set<string>()
    for (const i of byTag.get(name) ?? []) for (const b of nodes[i]) if (b !== name) out.add(b)
    return [...out]
  }
}

/** Saved undo snapshots use $ref ids for lists/nodes identical to the current objects; changed objects are stored in full. */
type Ref = { $ref: string }
type PackedNode = Ref | (Omit<UserListNode, 'children'> & { children: PackedNode[] })
type PackedList = Ref | (Omit<UserList, 'nodes'> & { nodes: PackedNode[] })
export type PackedHistory = PackedList[][]

const isRef = (x: unknown): x is Ref => typeof x === 'object' && x !== null && typeof (x as Ref).$ref === 'string'

export function packHistory(snaps: UserList[][], current: UserList[]): PackedHistory {
  const lists = new Map(current.map((l) => [l.id, l]))
  const nodes = new Map<string, UserListNode>()
  for (const l of current) walk(l.nodes, (n) => nodes.set(`${l.id}/${n.id}`, n))
  const node = (lid: string, n: UserListNode): PackedNode => (nodes.get(`${lid}/${n.id}`) === n ? { $ref: n.id } : { ...n, children: n.children.map((c) => node(lid, c)) })
  return snaps.map((s) => s.map((l) => (lists.get(l.id) === l ? { $ref: l.id } : { ...l, nodes: l.nodes.map((n) => node(l.id, n)) })))
}

/** An unresolved saved reference invalidates the whole history; partial recovery could undo against the wrong data. */
export function unpackHistory(packed: unknown, current: UserList[]): UserList[][] | null {
  if (!Array.isArray(packed)) return null
  const lists = new Map(current.map((l) => [l.id, l]))
  const nodes = new Map<string, UserListNode>()
  for (const l of current) walk(l.nodes, (n) => nodes.set(`${l.id}/${n.id}`, n))
  const fail = () => {
    throw new Error('bad history')
  }
  const node = (lid: string, n: PackedNode): UserListNode => (isRef(n) ? (nodes.get(`${lid}/${n.$ref}`) ?? fail()) : { ...n, children: n.children.map((c) => node(lid, c)) })
  try {
    return packed.map((s: PackedList[]) => s.map((l) => (isRef(l) ? (lists.get(l.$ref) ?? fail()) : { ...l, nodes: l.nodes.map((n) => node(l.id, n)) })))
  } catch {
    return null
  }
}

export function exampleLists(): UserList[] {
  const n = (title: string, tags: string, children: UserListNode[] = []): UserListNode => ({ ...newNode(title, tags ? tags.split(', ') : []), children })
  return [
    {
      ...newList('樱花场景'),
      createdAt: 0,
      nodes: [
        n('人物', '', [n('发型', 'hime cut, sidelocks, bangs, hair flower, hair ornament, floating hair'), n('表情', 'smile, light smile, gentle smile, closed eyes, half-closed eyes, blush')]),
        n('场景', '', [n('樱花', 'cherry blossoms, petals, falling petals, petals on liquid, under tree, spring (season)'), n('光', 'backlighting, sunlight, dappled sunlight, light rays, rim lighting, lens flare')]),
      ],
    },
  ]
}

export interface ListOp {
  op: 'add_node' | 'add_tags' | 'remove_tags' | 'move_tags' | 'rename_node' | 'delete_node' | 'rename_list'
  node?: string
  to?: string
  tags?: string[]
  title?: string
}

export function resolveNode(nodes: Nodes, ref: string): UserListNode | undefined {
  const byId = findListNode(nodes, ref)
  if (byId) return byId
  let level = nodes
  let hit: UserListNode | undefined
  for (const part of ref.split('/').map((s) => s.trim()).filter(Boolean)) {
    hit = level.find((n) => n.title === part)
    if (!hit) return undefined
    level = hit.children
  }
  return hit
}

export function applyListOps(list: UserList, ops: ListOp[], normalize: (tags: string[]) => { tags: string[]; merged: [string, string][] }): { list: UserList; log: string[] } {
  let nodes = list.nodes
  let name = list.name
  const log: string[] = []
  const need = (ref: string | undefined, what: string) => {
    const n = ref ? resolveNode(nodes, ref) : undefined
    if (!n) throw new Error(`${what} not found: ${ref ?? '(missing node)'}`)
    return n
  }
  ops.forEach((o, i) => {
    const at = `#${i + 1} ${o.op}`
    try {
      switch (o.op) {
        case 'add_node': {
          if (!o.node?.trim()) throw new Error('node (the new path) is required')
          const r = ensurePath(nodes, null, o.node)
          nodes = r.nodes
          log.push(`${at}: node ${r.node?.id} "${o.node}"`)
          break
        }
        case 'add_tags': {
          if (!o.node?.trim()) throw new Error('node is required')
          let n = resolveNode(nodes, o.node)
          if (!n) {
            const r = ensurePath(nodes, null, o.node)
            nodes = r.nodes
            n = r.node!
          }
          const { tags, merged } = normalize(o.tags ?? [])
          const r = addTags(nodes, n.id, tags)
          nodes = r.nodes
          const skipped = tags.length - r.added.length
          log.push(
            `${at}: added ${r.added.length} to ${n.id} "${n.title}"${skipped ? `, ${skipped} already there` : ''}${merged.length ? `, stored as official names: ${merged.map(([a, b]) => `${a} → ${b}`).join(', ')}` : ''}`,
          )
          break
        }
        case 'remove_tags': {
          const n = need(o.node, 'Node')
          const { tags } = normalize(o.tags ?? [])
          const drop = new Set([...tags, ...(o.tags ?? [])].map((t) => t.trim().toLowerCase()))
          const hit = n.tags.filter((t) => drop.has(t.toLowerCase()))
          nodes = removeTags(nodes, hit.map((t) => [n.id, t] as [string, string]))
          log.push(`${at}: removed ${hit.length} from ${n.id} "${n.title}"`)
          break
        }
        case 'move_tags': {
          const from = need(o.node, 'Node')
          const to = need(o.to, 'Target node')
          const { tags } = normalize(o.tags ?? [])
          const want = new Set([...tags, ...(o.tags ?? [])].map((t) => t.trim().toLowerCase()))
          const hit = from.tags.filter((t) => want.has(t.toLowerCase()))
          nodes = moveTags(nodes, hit.map((t) => [from.id, t] as [string, string]), to.id)
          log.push(`${at}: moved ${hit.length} from ${from.id} to ${to.id}`)
          break
        }
        case 'rename_node': {
          const n = need(o.node, 'Node')
          if (!o.title?.trim()) throw new Error('title is required')
          nodes = renameNode(nodes, n.id, o.title)
          log.push(`${at}: ${n.id} renamed`)
          break
        }
        case 'delete_node': {
          const n = need(o.node, 'Node')
          nodes = deleteNode(nodes, n.id)
          log.push(`${at}: ${n.id} "${n.title}" deleted`)
          break
        }
        case 'rename_list': {
          if (!o.title?.trim()) throw new Error('title is required')
          name = o.title.trim()
          log.push(`${at}: list renamed`)
          break
        }
        default:
          throw new Error(`unknown op`)
      }
    } catch (e) {
      log.push(`${at}: skipped (${e instanceof Error ? e.message : String(e)})`)
    }
  })
  return { list: nodes === list.nodes && name === list.name ? list : { ...list, nodes, name }, log }
}

export const listForAgent = (l: UserList) => ({ id: l.id, name: l.name, nodes: l.nodes })
