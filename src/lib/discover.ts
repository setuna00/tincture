// List files use # depth for headings, commas for items, @atom for atom membership, and // for comments.
import type { TagEntry } from '@/types'

export interface TreeFile {
  v: 1
  /** Packed atom rows: [name, domain, description]. */
  atoms: [string, string, string][]
  /** Rows index lookup; extra atom indices supplement the primary atom stored in lookup. */
  more: number[][]
  /** Both indices address lookup rows; the second is the implied parent tag. */
  parent: [number, number][]
  /** Pair: lookup row for a holding tag, then the atom index of the held object. */
  holding: [number, number][]
  /** NovelAI still accepts these renamed tags; a third value of 1 means it knows the new name more often. */
  renamed?: ([number, number] | [number, number, 1])[]
}

export interface ListNode {
  title: string
  /** Paths join headings with '/'; atom leaves end in '/@atom', and the root sentinel is ''. */
  path: string
  depth: number
  children: ListNode[]
  atom?: string
  tags: string[]
  id?: string
}

export const UNASSIGNED = '未归类'
export const UNASSIGNED_PATH = '@未归类'

export function parseList(text: string): ListNode {
  const root: ListNode = { title: '', path: '', depth: 0, children: [], tags: [] }
  const atomsOf = new Map<ListNode, string[]>([[root, []]])
  const stack = [root]
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('//')) continue
    const m = line.match(/^(#+)\s*(.+)$/)
    if (m) {
      const depth = m[1].length
      while (stack.length > depth) stack.pop()
      const parent = stack[stack.length - 1]
      const title = m[2].trim()
      const n: ListNode = { title, path: parent.path ? `${parent.path}/${title}` : title, depth: parent.depth + 1, children: [], tags: [] }
      parent.children.push(n)
      atomsOf.set(n, [])
      stack.push(n)
      continue
    }
    const at = stack[stack.length - 1]
    for (const tok of line.split(',').map((s) => s.trim()).filter(Boolean)) {
      if (tok.startsWith('@')) atomsOf.get(at)!.push(tok.slice(1).trim())
      else at.tags.push(tok)
    }
  }
  const fix = (n: ListNode) => {
    n.children.forEach(fix)
    const atoms = atomsOf.get(n) ?? []
    if (n.depth > 0 && n.children.length === 0 && n.tags.length === 0 && atoms.length === 1) {
      n.atom = atoms[0]
      return
    }
    for (const a of atoms) n.children.push({ title: a, path: `${n.path ? `${n.path}/` : ''}@${a}`, depth: n.depth + 1, children: [], atom: a, tags: [] })
  }
  fix(root)
  return root
}

export function nodeAtoms(n: ListNode): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  const walk = (x: ListNode) => {
    if (x.atom && !seen.has(x.atom)) {
      seen.add(x.atom)
      out.push(x.atom)
    }
    x.children.forEach(walk)
  }
  walk(n)
  return out
}

export function findNode(root: ListNode, path: string): ListNode | undefined {
  if (root.path === path) return root
  for (const c of root.children) {
    if (path === c.path || path.startsWith(`${c.path}/`)) {
      const hit = findNode(c, path)
      if (hit) return hit
    }
  }
  return undefined
}

export function ancestors(path: string): string[] {
  const parts = path.split('/')
  return parts.slice(0, -1).map((_, i) => parts.slice(0, i + 1).join('/'))
}

export function leafOf(n: ListNode, atom: string): string | undefined {
  if (n.atom === atom) return n.path
  for (const c of n.children) {
    const hit = leafOf(c, atom)
    if (hit) return hit
  }
  return undefined
}

export function occurrences(root: ListNode, tagAtoms: string[]): string[] {
  if (!tagAtoms.length) return []
  const byAtom = new Map<string, string[]>()
  const walk = (x: ListNode) => {
    if (x.atom && tagAtoms.includes(x.atom)) (byAtom.get(x.atom) ?? byAtom.set(x.atom, []).get(x.atom)!).push(x.path)
    x.children.forEach(walk)
  }
  walk(root)
  return tagAtoms.flatMap((a) => byAtom.get(a) ?? [])
}

export interface Catalog {
  atomInfo: Map<string, { domain: string; note: string }>
  byAtom: Map<string, TagEntry[]>
  atomsOf: Map<string, string[]>
  parents: Map<string, string[]>
  children: Map<string, string[]>
  holdingAtom: Map<string, string>
  unassigned: TagEntry[]
  renamedTo: Map<string, string>
  swapTo: Map<string, string>
}

const byCount = (a: TagEntry, b: TagEntry) => b.count - a.count || (a.name < b.name ? -1 : 1)

export function buildCatalog(rows: TagEntry[], f: TreeFile): Catalog {
  const atomInfo = new Map(f.atoms.map(([a, domain, note]) => [a, { domain, note }]))
  const atomName = f.atoms.map((a) => a[0])
  const ok = (t: TagEntry | undefined): t is TagEntry => !!t && (t.category === 'general' || t.category === 'meta') && t.old !== 2
  const atomsOf = new Map<string, string[]>()
  const unassigned: TagEntry[] = []
  for (const t of rows) {
    if (!ok(t)) continue
    if (t.group && atomInfo.has(t.group)) atomsOf.set(t.name, [t.group])
    else unassigned.push(t)
  }
  for (const [row, ...rest] of f.more) {
    const t = rows[row]
    if (!ok(t)) continue
    const list = atomsOf.get(t.name) ?? []
    for (const i of rest) if (!list.includes(atomName[i])) list.push(atomName[i])
    atomsOf.set(t.name, list)
  }
  const byAtom = new Map<string, TagEntry[]>()
  for (const t of rows) {
    if (!ok(t)) continue
    for (const a of atomsOf.get(t.name) ?? []) (byAtom.get(a) ?? byAtom.set(a, []).get(a)!).push(t)
  }
  for (const l of byAtom.values()) l.sort(byCount)
  unassigned.sort(byCount)
  const parents = new Map<string, string[]>()
  const children = new Map<string, string[]>()
  for (const [c, p] of f.parent) {
    const a = rows[c]
    const b = rows[p]
    if (!ok(a) || !ok(b)) continue
    ;(parents.get(a.name) ?? parents.set(a.name, []).get(a.name)!).push(b.name)
    ;(children.get(b.name) ?? children.set(b.name, []).get(b.name)!).push(a.name)
  }
  const holdingAtom = new Map<string, string>()
  for (const [row, i] of f.holding) if (ok(rows[row])) holdingAtom.set(rows[row].name, atomName[i])
  const renamed = (f.renamed ?? []).filter(([a, b]) => rows[a] && rows[b])
  const renamedTo = new Map(renamed.map(([a, b]) => [rows[a].name, rows[b].name]))
  const swapTo = new Map(renamed.filter((r) => r[2] === 1).map(([a, b]) => [rows[a].name, rows[b].name]))
  return { atomInfo, byAtom, atomsOf, parents, children, holdingAtom, unassigned, renamedTo, swapTo }
}

export function atomVisible(c: Catalog, atom: string, maxLevel: number): boolean {
  const d = c.atomInfo.get(atom)?.domain
  return d === 'R18' ? maxLevel >= 2 : d === 'R18G' ? maxLevel >= 3 : true
}

export function nodeCount(c: Catalog, n: ListNode, maxLevel: number): number {
  if (n.path === UNASSIGNED_PATH) return c.unassigned.filter((t) => (t.level ?? 0) <= maxLevel).length
  const seen = new Set<string>()
  for (const a of nodeAtoms(n)) if (atomVisible(c, a, maxLevel)) for (const t of c.byAtom.get(a) ?? []) if ((t.level ?? 0) <= maxLevel) seen.add(t.name)
  return seen.size
}

export interface Item {
  t: TagEntry
  kids: Item[]
}

export type SortBy = 'count' | 'name'
export function sorter(by: SortBy, desc: boolean) {
  const base = by === 'count' ? (a: TagEntry, b: TagEntry) => a.count - b.count || (a.name < b.name ? 1 : -1) : (a: TagEntry, b: TagEntry) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)
  return desc ? (a: TagEntry, b: TagEntry) => base(b, a) : base
}

export function foldItems(list: TagEntry[], parentsOf: Map<string, string[]>, cmp: (a: TagEntry, b: TagEntry) => number): Item[] {
  const items = new Map(list.map((t) => [t.name, { t, kids: [] as Item[] }]))
  const up = new Map<string, string>()
  for (const t of list) {
    const ps = (parentsOf.get(t.name) ?? []).map((p) => items.get(p)?.t).filter((p): p is TagEntry => !!p)
    if (ps.length) up.set(t.name, ps.reduce((a, b) => (b.count < a.count ? b : a)).name)
  }
  const loops = (name: string) => {
    const seen = new Set([name])
    for (let p = up.get(name); p; p = up.get(p)) {
      if (seen.has(p)) return true
      seen.add(p)
    }
    return false
  }
  const roots: Item[] = []
  for (const t of list) {
    const p = up.get(t.name)
    if (p && !loops(t.name)) items.get(p)!.kids.push(items.get(t.name)!)
    else roots.push(items.get(t.name)!)
  }
  const sortRec = (l: Item[]) => {
    l.sort((a, b) => cmp(a.t, b.t))
    for (const i of l) sortRec(i.kids)
  }
  sortRec(roots)
  return roots
}

export const itemSize = (i: Item): number => 1 + i.kids.reduce((n, k) => n + itemSize(k), 0)

export function pathTo(items: Item[], name: string): string[] | null {
  for (const i of items) {
    if (i.t.name === name) return []
    const sub = pathTo(i.kids, name)
    if (sub) return [i.t.name, ...sub]
  }
  return null
}

export function groupHolding(items: Item[], holdingAtom: Map<string, string>): { atom: string; items: Item[] }[] {
  const groups = new Map<string, Item[]>()
  for (const i of items) {
    const a = holdingAtom.get(i.t.name) ?? ''
    ;(groups.get(a) ?? groups.set(a, []).get(a)!).push(i)
  }
  return [...groups.entries()]
    .map(([atom, list]) => ({ atom, items: list }))
    .sort((a, b) => (a.atom === '' ? 1 : b.atom === '' ? -1 : b.items.reduce((n, i) => n + itemSize(i), 0) - a.items.reduce((n, i) => n + itemSize(i), 0)))
}

export function untitledName(taken: Iterable<string>, base = '未命名'): string {
  const set = new Set(taken)
  if (!set.has(base)) return base
  for (let i = 2; ; i++) if (!set.has(`${base} ${i}`)) return `${base} ${i}`
}
