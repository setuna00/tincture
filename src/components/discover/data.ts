import { useEffect, useMemo, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import treeUrl from '@/assets/tags/tree.json.gz?url'
import aText from '../../../data/tags/tree/a.txt?raw'
import bText from '../../../data/tags/tree/b.txt?raw'
import cText from '../../../data/tags/tree/c.txt?raw'
import { fetchJsonGz } from '@/lib/tag-data'
import { aliasOf, initTagDb, lookupTag, TAGS } from '@/lib/tagdb'
import { buildCatalog, parseList, UNASSIGNED, UNASSIGNED_PATH, type Catalog, type ListNode, type TreeFile } from '@/lib/discover'
import { collectUsage, type UsageSource } from '@/lib/usage'
import { allSections } from '@/store/doc'
import { useLibrary, variantBase } from '@/store/library'
import { toListTree, type UserList } from '@/lib/lists'
import type { BuiltinListId } from '@/store/prefs'
import { getDocStore, useTabs } from '@/store/tabs'
import type { Doc, TagEntry } from '@/types'

export const LISTS: { id: BuiltinListId; name: string; hint: string }[] = [
  { id: 'a', name: '按维度', hint: 'Danbooru 分法：人物 / 身体 / 头发 / 五官表情 / 服装……平铺' },
  { id: 'b', name: '按区块', hint: '与编辑器的区块一致：画面 / 主体 / 外观 / 表情动作 / 场景' },
  { id: 'c', name: '按身体部位', hint: '外貌按身体部位划分：头部 / 颈肩 / 上身 / 手臂手 / 下身 / 腿脚 / 全身' },
]
const TEXT: Record<BuiltinListId, string> = { a: aText, b: bText, c: cText }

const trees = new Map<BuiltinListId, ListNode>()
export function listTree(id: BuiltinListId): ListNode {
  let t = trees.get(id)
  if (!t) {
    t = parseList(TEXT[id])
    t.children.push({ title: UNASSIGNED, path: UNASSIGNED_PATH, depth: 1, children: [], tags: [] })
    trees.set(id, t)
  }
  return t
}

export const customTree = (l: UserList): ListNode => toListTree(l)

export function listTagOf(text: string, c: Catalog): string {
  const raw = text.trim()
  const k = raw.toLowerCase()
  const t = lookupTag(k)
  if (t) return c.renamedTo.get(t.name) ?? t.name
  const a = aliasOf(k)
  if (a) return c.renamedTo.get(a) ?? a
  return raw
}

export function normalizeListTags(texts: string[], c: Catalog): { tags: string[]; merged: [string, string][] } {
  const tags: string[] = []
  const merged: [string, string][] = []
  const seen = new Set<string>()
  for (const x of texts) {
    const from = x.trim()
    const to = listTagOf(from, c)
    if (to.toLowerCase() !== from.toLowerCase() && !merged.some(([f]) => f === from)) merged.push([from, to])
    const k = to.toLowerCase()
    if (!from || seen.has(k)) continue
    seen.add(k)
    tags.push(to)
  }
  return { tags, merged }
}

export function mergedNote(merged: [string, string][]): string | null {
  if (!merged.length) return null
  if (merged.length === 1) {
    const [from, to] = merged[0]
    return `${from} 是 ${to} 的${lookupTag(from.toLowerCase()) ? '旧写法' : '别名'}，已按 ${to} 加入`
  }
  const head = merged
    .slice(0, 3)
    .map(([f, t]) => `${f} → ${t}`)
    .join('、')
  return `${merged.length} 个已按正式写法加入：${head}${merged.length > 3 ? '…' : ''}`
}

export interface RowTag extends TagEntry {
  kind?: 'unknown'
}
export function rowTagOf(text: string): RowTag {
  return lookupTag(text) ?? { name: text, zh: '', category: 'general', count: -1, kind: 'unknown' }
}
export function officialOf(text: string, c: Catalog | null): string {
  const k = text.toLowerCase()
  if (lookupTag(k)) return c?.renamedTo.get(k) ?? k
  return aliasOf(k) ?? k
}
export function customPlaces(tree: ListNode, name: string, c: Catalog | null): { paths: string[]; rows: string[] } {
  const paths: string[] = []
  const rows: string[] = []
  const walk = (n: ListNode) => {
    for (const t of n.tags)
      if (officialOf(t, c) === name || t.toLowerCase() === name) {
        paths.push(n.path)
        rows.push(t)
        break
      }
    n.children.forEach(walk)
  }
  tree.children.forEach(walk)
  return { paths, rows }
}

let loading: Promise<Catalog> | null = null
export function loadCatalog(): Promise<Catalog> {
  return (loading ??= Promise.all([initTagDb(), fetchJsonGz<TreeFile>(new URL(treeUrl, location.href).href)]).then(([, f]) => buildCatalog(TAGS, f)))
}

export function useCatalog(): Catalog | null {
  const [c, setC] = useState<Catalog | null>(null)
  useEffect(() => {
    let alive = true
    loadCatalog()
      .then((x) => alive && setC(x))
      .catch((e) => console.error('分类数据加载失败', e))
    return () => {
      alive = false
    }
  }, [])
  return c
}

export { loadWikiZh, useWikiZh } from '@/lib/wiki-zh-pack'

const docChips = (d: Doc) => [...allSections(d)].flatMap((s) => s.chips)

export function useUsage(c: Catalog | null): Map<string, string[]> {
  const [st, ct, dt, recent, variants] = useLibrary(useShallow((s) => [s.sectionTemplates, s.characterTemplates, s.docs, s.recent, s.variants] as const))
  const tabs = useTabs((s) => s.order.filter((id) => !s.starts.includes(id)).join('|'))
  return useMemo(() => {
    const sources: UsageSource[] = []
    for (const id of tabs ? tabs.split('|') : []) {
      const d = getDocStore(id).getState().doc
      sources.push({ place: `文档「${d.meta.title || '未命名'}」`, chips: docChips(d) })
    }
    for (const r of recent) sources.push({ place: `最近关闭「${r.title || '未命名'}」`, chips: docChips(r.doc) })
    for (const t of st) sources.push({ place: `区块模板「${t.name}」`, chips: t.chips })
    for (const t of ct) sources.push({ place: `角色模板「${t.name}」`, chips: [...t.prompt, ...t.uc].flatMap((s) => s.chips) })
    for (const t of dt) sources.push({ place: `我的文档「${t.title}」`, chips: docChips(t.doc) })
    const official = (text: string) => {
      const k = text.toLowerCase()
      if (lookupTag(k)) return c?.renamedTo.get(k) ?? k
      return variantBase(k, variants, (x) => !!lookupTag(x)) ?? aliasOf(k) ?? k
    }
    return collectUsage(sources, official)
  }, [st, ct, dt, recent, variants, tabs, c])
}
