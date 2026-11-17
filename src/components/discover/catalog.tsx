import { createContext, memo, useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from 'react'
import { useDraggable } from '@dnd-kit/core'
import { useVirtualizer } from '@tanstack/react-virtual'
import { AnimatePresence, motion } from 'motion/react'
import { useHotkeys } from 'react-hotkeys-hook'
import { Add01Icon, ArrowDown01Icon, ArrowDown02Icon, ArrowRight01Icon, ArrowUp02Icon, Cancel01Icon, Copy01Icon, Delete02Icon, ListViewIcon, ShoppingBasket01Icon, Sorting01Icon, Tag01Icon, TextIcon, Tick02Icon } from '@hugeicons/core-free-icons'
import { useContext } from 'react'
import { toast } from 'sonner'
import { useAfterMenu } from '@/components/after-menu'
import { Icon } from '@/components/icon'
import { Button } from '@/components/ui/button'
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuLabel, ContextMenuSeparator, ContextMenuShortcut, ContextMenuTrigger } from '@/components/ui/context-menu'
import { DropdownMenu, DropdownMenuContent, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { TagSuggest, useTagSuggest } from '@/components/editor/tag-suggest'
import { Tip } from '@/components/tip'
import { looksLikePromptString } from '@/lib/nai'
import { countLabel } from '@/lib/tagdb'
import { atomVisible, findNode, foldItems, groupHolding, itemSize, leafOf, nodeAtoms, pathTo, sorter, UNASSIGNED, UNASSIGNED_PATH, type Catalog, type Item, type ListNode } from '@/lib/discover'
import { nodeChain, nodeText, parseNodeText, type UserList } from '@/lib/lists'
import { cn } from '@/lib/utils'
import { confirmDelete } from '@/store/confirm'
import { cartHas, overlayOpen, ROW_DRAG, selectedNames, splitRowKey, useDiscover } from '@/store/discover'
import { useLists } from '@/store/lists'
import { NSFW_MAX_LEVEL, usePrefs, type DiscoverSort } from '@/store/prefs'
import type { TagEntry } from '@/types'
import { mergedNote, normalizeListTags, officialOf, rowTagOf, type RowTag } from './data'
import { HoverCard, hoverClose, hoverDetached, hoverIn, hoverOut } from './hover-card'

const PER_ATOM = 24
const BREAK_KIDS = 12
const COL_W = 300
const COL_GAP = 20
const ROW_H = 28
const VIRTUAL_ROWS = 500
const LAZY_MARGIN = 1200

const viewportOf = (el: Element | null) => el?.closest<HTMLElement>('[data-slot=scroll-area-viewport]') ?? null

export async function copyTag(name: string) {
  try {
    await navigator.clipboard.writeText(name)
    return true
  } catch {
    toast.error('复制失败：无剪贴板权限')
    return false
  }
}

interface CardModel {
  key: string
  title: string
  note: string
  tags: RowTag[]
  path: string
  nodeId?: string
}

interface RowCtx {
  official: (t: RowTag) => string
  usage: Map<string, string[]>
  locatedKey: string | null
  selected: Set<string>
  listId: string | null
}
const Ctx = createContext<RowCtx | null>(null)

const withUnknownLast = (cmp: (a: TagEntry, b: TagEntry) => number) => (a: TagEntry, b: TagEntry) => Number((a as RowTag).kind === 'unknown') - Number((b as RowTag).kind === 'unknown') || cmp(a, b)

const flatten = (items: Item[]): TagEntry[] => items.flatMap((i) => [i.t, ...flatten(i.kids)])

function customCards(node: ListNode, keep: (t: RowTag) => boolean): CardModel[] {
  const out: CardModel[] = []
  const visit = (n: ListNode, title: string) => {
    if (n.tags.length || !n.children.length) {
      const seen = new Set<string>()
      const rows = n.tags.map(rowTagOf).filter((t) => !seen.has(t.name) && seen.add(t.name))
      const unknown = rows.filter((t) => t.kind === 'unknown').length
      out.push({ key: n.id!, nodeId: n.id, title, note: unknown ? `${unknown} 个未识别（不在 tag 库中）` : '', tags: rows.filter(keep), path: n.path })
    }
    for (const c of n.children) visit(c, n === node ? c.title : `${title} / ${c.title}`)
  }
  if (node.depth === 0) node.children.forEach((c) => visit(c, c.title))
  else visit(node, node.title)
  return out
}

function cardGroups(card: CardModel, items: Item[], single: boolean, editable: boolean, catalog: Catalog) {
  const limited = !single && items.length > PER_ATOM
  const top = limited ? items.slice(0, PER_ATOM) : items
  const groups = single && card.key === '拿着' && !editable ? groupHolding(top, catalog.holdingAtom) : [{ atom: '', items: top }]
  return { limited, groups }
}

function shownRows(items: Item[], scope: string, expanded: Record<string, boolean>): string[] {
  return items.flatMap((it) => {
    const key = `${scope}|${it.t.name}`
    return [key, ...(expanded[key] ? shownRows(it.kids, scope, expanded) : [])]
  })
}

let rowOrder: () => string[] = () => []

export function DiscoverCatalog({ catalog, node, tree, custom, usage, onSelect }: { catalog: Catalog; node: ListNode; tree: ListNode; custom: UserList | null; usage: Map<string, string[]>; onSelect: (path: string) => void }) {
  const nsfw = usePrefs((s) => s.nsfw)
  const maxLevel = NSFW_MAX_LEVEL[nsfw]
  const sort = usePrefs((s) => s.discoverSort)
  const unused = usePrefs((s) => s.discoverUnused)
  const located = useDiscover((s) => s.located)
  const selectedKeys = useDiscover((s) => s.selected)
  const selected = useMemo(() => new Set(selectedKeys), [selectedKeys])
  const unassigned = node.path === UNASSIGNED_PATH
  const official = useMemo(() => (custom ? (t: RowTag) => officialOf(t.name, catalog) : (t: RowTag) => t.name), [custom, catalog])

  const { cards, total, used } = useMemo(() => {
    let cards: CardModel[]
    if (custom) cards = customCards(node, (t) => !unused || !usage.has(official(t)))
    else {
      const atoms = unassigned ? [UNASSIGNED] : nodeAtoms(node).filter((a) => atomVisible(catalog, a, maxLevel))
      cards = atoms.map((a) => ({
        key: a,
        title: a,
        note: a === UNASSIGNED ? '未归入小类的通用 / 元信息 tag（多为作品数较少的专有名词）' : (catalog.atomInfo.get(a)?.note ?? ''),
        tags: (a === UNASSIGNED ? catalog.unassigned : (catalog.byAtom.get(a) ?? [])).filter((t) => (t.level ?? 0) <= maxLevel && (!unused || !usage.has(t.name))),
        path: leafOf(node, a) ?? node.path,
      }))
    }
    const seen = new Set<string>()
    let used = 0
    for (const c of cards)
      for (const t of c.tags)
        if (!seen.has(t.name)) {
          seen.add(t.name)
          if (usage.has(official(t))) used++
        }
    return { cards, total: seen.size, used }
  }, [custom, node, unassigned, catalog, maxLevel, unused, usage, official])

  const cmp = useMemo(() => withUnknownLast(sorter(sort.by, sort.desc)), [sort])
  const single = cards.length === 1
  const lazy = useMemo(() => {
    let y = 0
    return cards.map((c) => {
      const n = single ? c.tags.length : Math.min(c.tags.length, PER_ATOM)
      const height = 36 + Math.ceil(n / 2) * ROW_H + (!single && c.tags.length > PER_ATOM ? 28 : 0) + 14
      const eager = y < 2000
      y += height + 12
      return { height, eager }
    })
  }, [cards, single])
  useLayoutEffect(() => {
    rowOrder = () => {
      const { expanded, textNodes } = useDiscover.getState()
      return cards.flatMap((c) => {
        const editable = !!custom && !!c.nodeId
        if (editable && textNodes[c.nodeId!]) return []
        const { groups } = cardGroups(c, foldItems(c.tags, catalog.parents, cmp), single, editable, catalog)
        return groups.flatMap((g) => shownRows(g.items, c.key, expanded))
      })
    }
  })

  const locScope = located && located.paths.length ? (custom ? located.paths[located.i].split('/').pop()! : located.paths[located.i] === UNASSIGNED_PATH ? UNASSIGNED : located.paths[located.i].split('/@').pop()!) : null
  const locRow = located ? (located.rows?.[located.i] ?? located.name) : null
  const locatedKey = locScope && locRow ? `${locScope}|${locRow}` : null
  useEffect(() => {
    if (!located || !locScope || !locRow) return
    if (usage.has(located.name) && usePrefs.getState().discoverUnused) usePrefs.getState().set({ discoverUnused: false })
    const card = cards.find((c) => c.key === locScope)
    const chain = card ? (pathTo(foldItems(card.tags, catalog.parents, cmp), locRow) ?? []) : []
    useDiscover.getState().expand(chain.map((p) => `${locScope}|${p}`))
    let raf = requestAnimationFrame(() => {
      raf = requestAnimationFrame(() => {
        const el = document.querySelector(`[data-row="${CSS.escape(`${locScope}|${locRow}`)}"]`)
        el?.scrollIntoView({ block: 'center', behavior: 'smooth' })
      })
    })
    return () => cancelAnimationFrame(raf)
  }, [located?.name, located?.i, locScope]) // eslint-disable-line react-hooks/exhaustive-deps

  const ctx = useMemo<RowCtx>(() => ({ official, usage, locatedKey, selected, listId: custom?.id ?? null }), [official, usage, locatedKey, selected, custom])
  useEffect(() => hoverClose(), [node.path])
  useEffect(() => {
    if (selectedKeys.length) hoverClose()
  }, [selectedKeys.length])

  const allKeys = () => cards.flatMap((c) => flatten(foldItems(c.tags, catalog.parents, cmp)).map((t) => `${c.key}|${t.name}`))
  useHotkeys('mod+a', (e) => !overlayOpen() && (e.preventDefault(), useDiscover.getState().set({ selected: allKeys() })), { enableOnFormTags: false }, [cards, cmp])
  useHotkeys('escape', () => !overlayOpen() && useDiscover.getState().selected.length && useDiscover.getState().set({ selected: [], anchor: null }), [])
  useHotkeys('delete', () => custom && !overlayOpen() && removeRows(custom.id, useDiscover.getState().selected), [custom])

  const crumbs = useMemo(() => {
    if (unassigned) return [UNASSIGNED]
    if (!custom) return node.path.split('/').map((s) => s.replace(/^@/, ''))
    if (!node.path) return [custom.name]
    const ids = node.path.split('/')
    return ids.map((_, i) => findNode(tree, ids.slice(0, i + 1).join('/'))?.title ?? '')
  }, [unassigned, custom, node.path, tree])
  const nSel = selectedNames(selectedKeys).length
  return (
    <Ctx.Provider value={ctx}>
      {/* React portal clicks bubble through the component tree; require DOM containment before clearing selection. */}
      <div
        className="flex min-w-0 flex-1 flex-col bg-work"
        onClick={(e) => {
          const el = e.target as Element
          if (!e.currentTarget.contains(el) || !useDiscover.getState().selected.length) return
          if (el.closest('[data-row],button,input,textarea,a,[role=switch],[role=menuitem]')) return
          useDiscover.getState().set({ selected: [], anchor: null })
        }}
        data-testid="discover-catalog"
      >
        <header className="app-drag flex flex-wrap items-center gap-x-3 gap-y-2 px-6 pt-5 pb-3">
          <div className="flex min-w-0 items-baseline gap-2">
            {crumbs.length > 1 && <span className="min-w-0 shrink truncate text-[13px] text-ink-2">{crumbs.slice(0, -1).join(' / ')} /</span>}
            <h1 className="shrink-0 text-[17px] font-semibold text-ink-1" data-testid="discover-title">
              {crumbs[crumbs.length - 1]}
            </h1>
            <span className="shrink-0 text-[12px] text-ink-2 tabular-nums" data-testid="discover-count">
              {cards.length > 1 ? `${cards.length} 个${custom ? '节点' : '小类'} · ` : ''}
              {total} 个 tag{unused ? '（未使用）' : ` · 已使用 ${used}`}
            </span>
            <AnimatePresence>
              {nSel > 0 && (
                <motion.span
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.15 }}
                  className="ml-1 shrink-0 self-center rounded-md px-2 py-0.5 text-[12px] text-ink-1"
                  style={{ background: 'color-mix(in srgb, var(--accent) 22%, transparent)' }}
                  data-testid="discover-selected"
                >
                  已选 {nSel} 个 · Esc 取消
                </motion.span>
              )}
            </AnimatePresence>
          </div>
          <div className="ml-auto flex shrink-0 items-center gap-3">
            <label className="flex cursor-pointer items-center gap-1.5 text-[12px] text-ink-2">
              <Switch size="sm" checked={unused} onCheckedChange={(v) => usePrefs.getState().set({ discoverUnused: v })} data-testid="discover-unused" />
              仅显示未使用
            </label>
            <SortControl sort={sort} />
          </div>
        </header>
        <SelectionMenu custom={custom}>
          <ScrollArea className="min-h-0 flex-1" data-testid="discover-body">
            <div key={`${custom?.id ?? ''}:${node.path}`} className="page-in flex flex-col gap-3 px-6 pb-6">
              {cards.map((c, i) =>
                c.tags.length || (custom && c.nodeId) ? (
                  <LazyCard key={c.key} atom={c.key} eager={lazy[i].eager || c.key === locScope} height={lazy[i].height}>
                    <Card card={c} catalog={catalog} cmp={cmp} single={single} custom={custom} onAll={() => onSelect(c.path)} />
                  </LazyCard>
                ) : null,
              )}
              {custom && !cards.length && (
                <p className="py-16 text-center text-[13px] leading-relaxed text-ink-2" data-testid="discover-empty">
                  此 list 为空：点击左侧「新建节点」，
                  <br />
                  或在其他 list 中选中 tag，右键选择「加入 list…」
                </p>
              )}
              {!custom && total === 0 && <p className="py-16 text-center text-[13px] text-ink-2">{unused ? '此处的 tag 均已使用' : '暂无 tag（超出 NSFW 设置的不显示）'}</p>}
            </div>
          </ScrollArea>
        </SelectionMenu>
      </div>
      <HoverCard catalog={catalog} usage={usage} official={official} unknown={(t) => <UnknownCard t={t} />} />
    </Ctx.Provider>
  )
}

function LazyCard({ eager, height, atom, children }: { eager: boolean; height: number; atom: string; children: ReactNode }) {
  const [shown, setShown] = useState(eager)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (eager) setShown(true)
  }, [eager])
  useEffect(() => {
    if (shown || !ref.current) return
    const io = new IntersectionObserver((es) => es.some((e) => e.isIntersecting) && setShown(true), { root: viewportOf(ref.current), rootMargin: `${LAZY_MARGIN}px 0px` })
    io.observe(ref.current)
    return () => io.disconnect()
  }, [shown])
  return shown || eager ? children : <div ref={ref} className="rounded-lg border border-line-strong bg-work" style={{ height }} aria-hidden data-atom={atom} data-lazy="" />
}

const BULK_REMOVE = 10

function confirmRemove(listId: string, nodeIds: string[], names: string[], refocus?: HTMLElement | null) {
  const list = useLists.getState().lists.find((l) => l.id === listId)
  const paths = [...new Set(nodeIds)].map((id) => `「${(list ? nodeChain(list.nodes, id) : []).map((n) => n.title).join(' / ')}」`)
  const where = paths.length > 3 ? `${paths.slice(0, 3).join('')}等 ${paths.length} 个节点` : paths.join('')
  const sample = names.length > 3 ? `${names.slice(0, 3).join('、')} 等 ${names.length} 个` : names.join('、')
  return confirmDelete({ title: `移除 ${names.length} 个 tag？`, body: `将从${where}中移除 ${sample}。`, action: '移除', refocus })
}

async function removeRows(listId: string, keys: string[]) {
  if (!keys.length) return
  const names = selectedNames(keys)
  if (names.length >= BULK_REMOVE && !(await confirmRemove(listId, keys.map((k) => splitRowKey(k)[0]), names))) return
  useLists.getState().removeTags(listId, keys.map(splitRowKey))
  useDiscover.getState().set({ selected: [], anchor: null })
  toast(`已移除 ${names.length} 个`, { action: { label: '撤销', onClick: () => useLists.getState().undo() } })
}

function SelectionMenu({ custom, children }: { custom: UserList | null; children: ReactNode }) {
  const [keys, setKeys] = useState<string[]>([])
  const hasLists = useLists((s) => s.lists.length > 0)
  const menu = useAfterMenu()
  const names = selectedNames(keys)
  return (
    <ContextMenu onOpenChange={(o) => o && setKeys(useDiscover.getState().selected)}>
      <ContextMenuTrigger asChild>
        <div
          className="flex min-h-0 flex-1 flex-col"
          onContextMenu={(e) => {
            const row = (e.target as Element).closest<HTMLElement>('[data-row]')
            const d = useDiscover.getState()
            if (row?.dataset.row) {
              if (!d.selected.includes(row.dataset.row)) d.set({ selected: [row.dataset.row], anchor: row.dataset.row })
            } else if (!d.selected.length) e.preventDefault()
          }}
        >
          {children}
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-48" onCloseAutoFocus={menu.onCloseAutoFocus} data-testid="discover-sel-menu">
        <ContextMenuLabel className="font-normal text-ink-3">{names.length} 个 tag</ContextMenuLabel>
        <ContextMenuItem onSelect={() => useDiscover.getState().set({ selected: [], anchor: null })} data-testid="discover-sel-clear">
          <Icon size={14} icon={Cancel01Icon} />
          取消选择
          <ContextMenuShortcut>Esc</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={() => useDiscover.getState().addCart(names)} data-testid="discover-sel-cart">
          <Icon size={14} icon={ShoppingBasket01Icon} />
          加入购物车
        </ContextMenuItem>
        {hasLists && (
          <ContextMenuItem
            onSelect={() => menu.later(() => useDiscover.getState().set({ put: { tags: names, from: `选中的 ${names.length} 个` } }))}
            data-testid="discover-sel-put"
          >
            <Icon size={14} icon={ListViewIcon} />
            加入 list…
          </ContextMenuItem>
        )}
        <ContextMenuItem
          onSelect={() => copyTag(names.join(', ')).then((ok) => ok && toast.success(`已复制 ${names.length} 个 tag`))}
          data-testid="discover-sel-copy"
        >
          <Icon size={14} icon={Copy01Icon} />
          复制 {names.length} 个
        </ContextMenuItem>
        {custom && (
          <>
            <ContextMenuSeparator />
            <ContextMenuItem variant="destructive" onSelect={() => removeRows(custom.id, keys)} data-testid="discover-sel-remove">
              <Icon size={14} icon={Delete02Icon} />
              移除 {names.length} 个
              <ContextMenuShortcut>Del</ContextMenuShortcut>
            </ContextMenuItem>
          </>
        )}
      </ContextMenuContent>
    </ContextMenu>
  )
}

function SortControl({ sort }: { sort: DiscoverSort }) {
  const set = (patch: Partial<DiscoverSort>) => usePrefs.getState().set({ discoverSort: { ...sort, ...patch } })
  const dir = sort.by === 'name' ? (sort.desc ? 'Z → A' : 'A → Z') : sort.desc ? '作品多的在前' : '作品少的在前'
  return (
    <div className="flex h-7 items-center rounded-md border border-border bg-background shadow-xs" data-testid="discover-sort-group">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" className="h-full gap-1.5 rounded-r-none pr-2 pl-2.5 text-[12px] font-normal text-ink-2" data-testid="discover-sort">
            <Icon icon={Sorting01Icon} size={14} className="text-ink-2" />
            {sort.by === 'count' ? '作品数' : '名称'}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-32">
          <DropdownMenuLabel className="text-ink-3">排序方式</DropdownMenuLabel>
          <DropdownMenuRadioGroup value={sort.by} onValueChange={(v) => set({ by: v as DiscoverSort['by'], desc: v === 'count' })}>
            <DropdownMenuRadioItem value="count" className="text-[13px]">
              作品数
            </DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="name" className="text-[13px]" data-testid="discover-sort-name">
              名称
            </DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      <span className="h-4 w-px bg-line" />
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="ghost" size="icon" className="h-full w-7 rounded-l-none text-ink-2" onClick={() => set({ desc: !sort.desc })} aria-label={dir} data-testid="discover-sort-dir">
            <Icon icon={sort.desc ? ArrowDown02Icon : ArrowUp02Icon} size={16} />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{dir}（点击反转）</TooltipContent>
      </Tooltip>
    </div>
  )
}

function UnknownCard({ t }: { t: RowTag }) {
  return (
    <div className="flex flex-col gap-1.5" data-testid="discover-unknown-card" data-name={t.name}>
      <div className="flex items-baseline gap-2">
        <span className="text-[13px] font-semibold text-ink-2 underline decoration-ink-3 decoration-dotted decoration-[1.5px] underline-offset-[3px]">{t.name}</span>
        <span className="meta-chip">未识别</span>
      </div>
      <p className="text-[12px] leading-relaxed text-ink-2">不在 tag 库中，NAI 可能按普通英文处理</p>
      <p className="text-[11px] text-ink-2">点击 = 复制 · + = 加入购物车 · 修改：点击卡片右上角 T 切换为文本</p>
    </div>
  )
}

function Card({ card, catalog, cmp, single, custom, onAll }: { card: CardModel; catalog: Catalog; cmp: (a: TagEntry, b: TagEntry) => number; single: boolean; custom: UserList | null; onAll: () => void }) {
  const items = useMemo(() => foldItems(card.tags, catalog.parents, cmp), [card.tags, catalog, cmp])
  const textOn = useDiscover((s) => !!card.nodeId && !!s.textNodes[card.nodeId])
  const editable = !!custom && !!card.nodeId
  if (!card.tags.length && !editable) return null
  const { limited, groups } = cardGroups(card, items, single, editable, catalog)
  return (
    <section className="rounded-lg border border-line-strong bg-work" data-testid="discover-atom" data-atom={card.key} data-title={card.title}>
      <div className="flex items-center gap-2 px-3.5 pt-2.5 pb-1.5">
        <h2 className="shrink-0 text-[13px] font-semibold text-ink-1">{card.title}</h2>
        <span className="shrink-0 text-[11px] text-ink-2">{card.tags.length}</span>
        <Tip label={card.note}>
          <span className="min-w-0 truncate text-[12px] text-ink-2">
            {card.note}
          </span>
        </Tip>
        {editable && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className={cn('-my-1 ml-auto size-6 shrink-0 text-ink-2', textOn && 'bg-surface-2 text-ink-1')}
                onClick={() => {
                  const d = useDiscover.getState()
                  d.set({ textNodes: { ...d.textNodes, [card.nodeId!]: !textOn } })
                }}
                aria-label={textOn ? '切换为 tag 显示' : '切换成文本'}
                aria-pressed={textOn}
                data-testid="discover-text-toggle"
              >
                <Icon icon={textOn ? Tag01Icon : TextIcon} size={16} />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{textOn ? '切换为 tag 显示' : '切换为文本显示（整段复制、粘贴）'}</TooltipContent>
          </Tooltip>
        )}
      </div>
      <div className="px-3.5 pb-3">
        {editable && textOn ? (
          <NodeTextBox listId={custom!.id} nodeId={card.nodeId!} catalog={catalog} />
        ) : (
          <>
            {groups.map((g) => (
              <div key={g.atom || '-'} className={cn(groups.length > 1 && 'mb-2 last:mb-0')}>
                {groups.length > 1 && (
                  <p className="mt-1 mb-0.5 text-[11px] text-ink-2">
                    拿着 · {g.atom || '其他'} <span className="tabular-nums">{g.items.reduce((n, i) => n + itemSize(i), 0)}</span>
                  </p>
                )}
                <Columns items={g.items} scope={card.key} nodeId={card.nodeId} />
              </div>
            ))}
            {limited && (
              <button type="button" className="mt-2 text-[12px] text-ink-2 hover:text-ink-1" onClick={onAll} data-testid="discover-all">
                全部 {card.tags.length} 个 →
              </button>
            )}
            {editable && (!limited || single) && <ListTagInput listId={custom!.id} nodeId={card.nodeId!} title={card.title} catalog={catalog} />}
          </>
        )}
      </div>
    </section>
  )
}

const shownCount = (items: Item[], scope: string, expanded: Record<string, boolean>): number =>
  items.reduce((n, it) => n + 1 + (expanded[`${scope}|${it.t.name}`] ? shownCount(it.kids, scope, expanded) : 0), 0)

function Columns({ items, scope, nodeId }: { items: Item[]; scope: string; nodeId?: string }) {
  const expanded = useDiscover((s) => s.expanded)
  if (!items.length) return null
  if (shownCount(items, scope, expanded) > VIRTUAL_ROWS) return <VirtualColumns items={items} scope={scope} nodeId={nodeId} expanded={expanded} />
  return (
    <div style={{ columnWidth: COL_W, columnGap: COL_GAP }} data-testid="discover-rows">
      {items.map((it) => {
        const open = !!expanded[`${scope}|${it.t.name}`]
        return (
          <div key={it.t.name} style={{ breakInside: open && itemSize(it) > BREAK_KIDS ? 'auto' : 'avoid' }}>
            <Group it={it} scope={scope} depth={0} expanded={expanded} nodeId={nodeId} />
          </div>
        )
      })}
    </div>
  )
}

interface VRow {
  it: Item
  depth: number
  key: string
  anim?: 'in' | 'out'
}

function layoutColumns(items: Item[], scope: string, isOpen: (key: string) => boolean, anim: Record<string, 'in' | 'out'>, cols: number): VRow[][] {
  const walk = (it: Item, depth: number, inherited: VRow['anim'], out: VRow[]) => {
    const key = `${scope}|${it.t.name}`
    out.push({ it, depth, key, anim: inherited })
    if (isOpen(key)) for (const k of it.kids) walk(k, depth + 1, anim[key] ?? inherited, out)
    return out
  }
  const groups = items.map((it) => walk(it, 0, undefined, []))
  const target = Math.ceil(groups.reduce((n, g) => n + g.length, 0) / cols)
  const columns: VRow[][] = [[]]
  for (const g of groups) {
    let cur = columns[columns.length - 1]
    if (g.length - 1 <= BREAK_KIDS) {
      if (cur.length && cur.length + g.length > target && columns.length < cols) columns.push((cur = []))
      cur.push(...g)
    } else
      for (const r of g) {
        if (cur.length >= target && columns.length < cols) columns.push((cur = []))
        cur.push(r)
      }
  }
  return columns
}

function VirtualColumns({ items, scope, nodeId, expanded }: { items: Item[]; scope: string; nodeId?: string; expanded: Record<string, boolean> }) {
  const ctx = useContext(Ctx)!
  const wrap = useRef<HTMLDivElement>(null)
  const [box, setBox] = useState({ width: 0, top: 0 })
  const [track, setTrack] = useState({ expanded, anim: {} as Record<string, 'in' | 'out'> })
  if (track.expanded !== expanded) {
    const anim = { ...track.anim }
    for (const k of new Set([...Object.keys(track.expanded), ...Object.keys(expanded)]))
      if (k.startsWith(`${scope}|`) && !!track.expanded[k] !== !!expanded[k]) anim[k] = expanded[k] ? 'in' : 'out'
    setTrack({ expanded, anim })
  }
  useEffect(() => {
    const keys = Object.keys(track.anim)
    if (!keys.length) return
    const id = setTimeout(() => setTrack((t) => ({ ...t, anim: Object.fromEntries(Object.entries(t.anim).filter(([k, v]) => !keys.includes(k) || v !== track.anim[k])) })), 170)
    return () => clearTimeout(id)
  }, [track.anim])
  useLayoutEffect(() => {
    const el = wrap.current
    const vp = viewportOf(el)
    if (!el || !vp) return
    const measure = () => {
      const top = el.getBoundingClientRect().top - vp.getBoundingClientRect().top + vp.scrollTop
      setBox((b) => (b.width === el.clientWidth && b.top === top ? b : { width: el.clientWidth, top }))
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    if (vp.firstElementChild) ro.observe(vp.firstElementChild)
    vp.addEventListener('scroll', hoverDetached, { passive: true })
    return () => {
      ro.disconnect()
      vp.removeEventListener('scroll', hoverDetached)
    }
  }, [])
  const isOpen = (key: string) => !!expanded[key] || track.anim[key] === 'out'
  const cols = Math.max(1, Math.floor((box.width + COL_GAP) / (COL_W + COL_GAP)))
  const colW = (box.width - (cols - 1) * COL_GAP) / cols
  const columns = useMemo(() => layoutColumns(items, scope, isOpen, track.anim, cols), [items, scope, expanded, track.anim, cols]) // eslint-disable-line react-hooks/exhaustive-deps
  const count = Math.max(...columns.map((c) => c.length))
  const v = useVirtualizer({ count, getScrollElement: () => viewportOf(wrap.current), estimateSize: () => ROW_H, overscan: 10, scrollMargin: box.top })
  const loc = ctx.locatedKey?.startsWith(`${scope}|`) ? ctx.locatedKey : null
  const locIndex = loc ? columns.reduce((r, c) => (r >= 0 ? r : c.findIndex((x) => x.key === loc)), -1) : -1
  useEffect(() => {
    if (locIndex < 0 || !loc) return
    let raf = requestAnimationFrame(() => {
      raf = requestAnimationFrame(() => {
        const vp = viewportOf(wrap.current)
        if (!vp || document.querySelector(`[data-row="${CSS.escape(loc)}"]`)) return
        vp.scrollTo({ top: box.top + locIndex * ROW_H - vp.clientHeight / 2 + ROW_H / 2, behavior: 'smooth' })
      })
    })
    return () => cancelAnimationFrame(raf)
  }, [loc, locIndex]) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div ref={wrap} className="relative" style={{ height: count * ROW_H }} data-testid="discover-rows" data-virtual="">
      {v.getVirtualItems().map((vi) =>
        columns.map((col, c) => {
          const r = col[vi.index]
          if (!r) return null
          return (
            <div key={r.key} className={cn('absolute', r.anim === 'in' && 'kids-in', r.anim === 'out' && 'kids-out')} style={{ top: vi.index * ROW_H, left: c * (colW + COL_GAP), width: colW }}>
              <Row t={r.it.t as RowTag} scope={scope} depth={r.depth} kids={r.it.kids.length} open={!!expanded[r.key]} nodeId={nodeId} />
            </div>
          )
        }),
      )}
    </div>
  )
}

function Group({ it, scope, depth, expanded, nodeId }: { it: Item; scope: string; depth: number; expanded: Record<string, boolean>; nodeId?: string }): ReactNode {
  const open = !!expanded[`${scope}|${it.t.name}`]
  return (
    <>
      <Row t={it.t as RowTag} scope={scope} depth={depth} kids={it.kids.length} open={open} nodeId={nodeId} />
      <AnimatePresence initial={false}>
        {open && (
          <motion.div key="kids" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.16 }}>
            {it.kids.map((k) => (
              <Group key={k.t.name} it={k} scope={scope} depth={depth + 1} expanded={expanded} nodeId={nodeId} />
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}

function clickRow(key: string, e: MouseEvent): boolean {
  const d = useDiscover.getState()
  if (e.ctrlKey || e.metaKey) {
    d.set({ selected: d.selected.includes(key) ? d.selected.filter((k) => k !== key) : [...d.selected, key], anchor: key })
    return true
  }
  if (e.shiftKey && d.anchor) {
    const keys = rowOrder()
    const a = keys.indexOf(d.anchor)
    const b = keys.indexOf(key)
    if (a >= 0 && b >= 0) {
      const [x, y] = a < b ? [a, b] : [b, a]
      d.set({ selected: keys.slice(x, y + 1) })
      return true
    }
  }
  d.set({ selected: [], anchor: key })
  return false
}

const Row = memo(function Row({ t, scope, depth, kids, open, nodeId }: { t: RowTag; scope: string; depth: number; kids: number; open: boolean; nodeId?: string }) {
  const ctx = useContext(Ctx)!
  const inCart = useDiscover((s) => cartHas(s.cart, t.name))
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const id = setTimeout(() => setCopied(false), 1200)
    return () => clearTimeout(id)
  }, [copied])
  const key = `${scope}|${t.name}`
  const editable = !!ctx.listId && !!nodeId
  const drag = useDraggable({ id: `${ROW_DRAG}${key}`, disabled: !editable })
  const dragging = useDiscover((s) => (s.drag?.type === 'rows' ? s.drag.keys.includes(key) : false))
  const located = ctx.locatedKey === key
  const selected = ctx.selected.has(key)
  const used = ctx.usage.has(ctx.official(t))
  const unknown = t.kind === 'unknown'
  const copy = () => copyTag(t.name).then((ok) => ok && setCopied(true))
  return (
    <div
      ref={drag.setNodeRef}
      {...(editable ? { ...drag.attributes, ...drag.listeners } : {})}
      role="button"
      tabIndex={0}
      className={cn('discover-row group/row relative flex h-7 cursor-default items-center gap-1.5 rounded-md pr-0.5', !selected && 'hover:bg-surface-2', dragging && 'opacity-40')}
      style={{ paddingLeft: depth * 20 }}
      onMouseDown={(e) => {
        if (e.shiftKey) e.preventDefault()
        if (editable) drag.listeners?.onMouseDown?.(e)
      }}
      onClick={(e) => {
        if (clickRow(key, e)) return
        copy()
      }}
      onKeyDown={(e) => e.key === 'Enter' && copy()}
      onPointerEnter={(e) => hoverIn(e.currentTarget, t)}
      onPointerLeave={hoverOut}
      data-row={key}
      data-located={located ? '' : undefined}
      data-selected={selected ? '' : undefined}
      data-testid="discover-row"
      data-name={t.name}
      data-used={used ? '' : undefined}
      data-kind={t.kind}
    >
      <span
        className={cn('grid w-4 shrink-0 place-items-center self-stretch text-ink-2', kids && 'rounded-sm hover:bg-surface-3 hover:text-ink-1')}
        onClick={(e) => {
          if (!kids) return
          e.stopPropagation()
          useDiscover.getState().toggleExpanded(key)
        }}
        data-testid={kids ? 'discover-expand' : undefined}
      >
        {kids ? <Icon icon={open ? ArrowDown01Icon : ArrowRight01Icon} size={14} /> : depth ? <span className="h-3 w-px bg-line-strong" /> : null}
      </span>
      <span className="tn min-w-0 flex-1 text-[13px]" data-has-zh={t.zh ? '' : undefined}>
        <span className={cn('tn-en', unknown ? 'text-ink-2 underline decoration-ink-3 decoration-dotted decoration-[1.5px] underline-offset-[3px]' : 'text-ink-1')}>{t.name}</span>
        {t.zh && <span className="tn-zh text-[12px]">{t.zh}</span>}
      </span>
      {kids > 0 && !open && <span className="text-[11px] text-ink-2">+{kids}</span>}
      {used && <span className="size-1.5 shrink-0 rounded-full bg-ink-2" aria-label="已使用" data-testid="discover-used" />}
      <span className="relative grid h-6 w-11 shrink-0 justify-items-end">
        <span className={cn('row-count pointer-events-none col-start-1 row-start-1 self-center text-[11px] text-ink-2 tabular-nums transition-opacity duration-(--dur)', unknown && 'font-sans', copied && 'opacity-0', editable && 'group-hover/row:opacity-0')}>{unknown ? '未识别' : countLabel(t)}</span>
        {editable && (
          <Tip label="从 list 中移除（Ctrl+Z 撤销）">
            <button
              type="button"
              className={cn('pointer-events-none col-start-1 row-start-1 grid size-6 place-items-center rounded-md text-ink-2 opacity-0 transition-[opacity,background-color,color] duration-(--dur-fast) hover:bg-surface-3 hover:text-ink-1 focus-visible:pointer-events-auto focus-visible:opacity-100', !copied && 'group-hover/row:pointer-events-auto group-hover/row:opacity-100')}
              onClick={(e) => {
                e.stopPropagation()
                useLists.getState().removeTags(ctx.listId!, [[nodeId!, t.name]])
              }}
              onPointerDown={(e) => e.stopPropagation()}
              aria-label={`从 list 中移除 ${t.name}`}
              data-testid="discover-row-remove"
            >
              <Icon icon={Cancel01Icon} size={14} />
            </button>
          </Tip>
        )}
        <span className={cn('pointer-events-none col-start-1 row-start-1 flex items-center gap-0.5 text-[11px] whitespace-nowrap text-lamp-text opacity-0 transition-opacity duration-(--dur)', copied && 'opacity-100')} data-testid={copied ? 'discover-copied' : undefined}>
          <Icon icon={Tick02Icon} size={14} />
          已复制
        </span>
      </span>
      <Tip label={selected && ctx.selected.size > 1 ? `将选中的 ${ctx.selected.size} 个加入购物车` : inCart ? '已在购物车中 · 再次点击移除' : '加入购物车'}>
        <button
          type="button"
          className={cn('grid size-6 shrink-0 place-items-center rounded-md transition-colors duration-(--dur-fast) hover:bg-surface-3', inCart ? 'text-lamp-text' : 'text-ink-2 hover:text-ink-1')}
          onClick={(e) => {
            e.stopPropagation()
            const d = useDiscover.getState()
            if (selected && d.selected.length > 1) d.addCart(selectedNames(d.selected))
            else d.toggleCart(t.name)
          }}
          onPointerDown={(e) => e.stopPropagation()}
          aria-label={inCart ? '从购物车中移除' : '加入购物车'}
          data-testid="discover-plus"
          data-on={inCart ? '' : undefined}
        >
          <Icon icon={inCart ? Tick02Icon : Add01Icon} size={16} />
        </button>
      </Tip>
    </div>
  )
})

function ListTagInput({ listId, nodeId, title, catalog }: { listId: string; nodeId: string; title: string; catalog: Catalog }) {
  const [q, setQ] = useState('')
  const [focused, setFocused] = useState(false)
  const s = useTagSuggest(q)
  const composing = useRef(false)
  const input = useRef<HTMLInputElement>(null)
  const open = focused && s.searching && s.results.length > 0
  const add = (names: string[]) => {
    if (!names.length) return
    const { tags, merged } = normalizeListTags(names, catalog)
    const added = useLists.getState().addTags(listId, nodeId, tags)
    setQ('')
    const note = mergedNote(merged)
    if (!added.length) toast(`${note ? `${note}。` : ''}${tags.length === 1 ? `「${tags[0]}」已在「${title}」中` : `均已在「${title}」中`}`)
    else if (note) toast(note)
  }
  const addRaw = () => add(parseNodeText(q))
  const accept = (tag = s.pick()) => (tag ? add([tag.name]) : addRaw())
  const confirm = () => {
    if (!q.trim()) return
    if (!s.searching) return addRaw()
    const apply = (tag: TagEntry | undefined) => (tag ? add([tag.name]) : addRaw())
    const r = s.enterPickLatest()
    if (r instanceof Promise) r.then(apply)
    else apply(r)
  }
  return (
    <div className="mt-1.5" onClick={(e) => e.stopPropagation()}>
      <TagSuggest
        s={s}
        open={focused}
        onPick={(tag) => accept(tag)}
        hints={
          <>
            <span>Tab / ↓ 选择候选</span>
            <span>↵ 补全英文，否则保留原文</span>
          </>
        }
      >
        <input
          ref={input}
          className="tag-input"
          style={{ minWidth: 120 }}
          placeholder="+ tag"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onCompositionStart={() => (composing.current = true)}
          onCompositionEnd={() => (composing.current = false)}
          onPaste={(e) => {
            const text = e.clipboardData.getData('text')
            if (!looksLikePromptString(text)) return
            e.preventDefault()
            const names = parseNodeText(text)
            add(names)
            toast.success(`已拆分为 ${names.length} 个 tag`)
          }}
          onKeyDown={(e) => {
            if (composing.current || e.nativeEvent.isComposing) return
            if (e.key === 'Enter') {
              e.preventDefault()
              if (e.shiftKey) addRaw()
              else confirm()
            } else if (e.key === 'Tab' && open) {
              e.preventDefault()
              accept()
            } else if (e.key === ',' || e.key === '，') {
              e.preventDefault()
              confirm()
            } else if (e.key === 'Escape') {
              setQ('')
              input.current?.blur()
            }
          }}
          data-testid="discover-add-input"
        />
      </TagSuggest>
    </div>
  )
}

function NodeTextBox({ listId, nodeId, catalog }: { listId: string; nodeId: string; catalog: Catalog }) {
  const tags = useLists((s) => {
    let found: string[] = []
    const l = s.lists.find((x) => x.id === listId)
    const walk = (ns: { id: string; tags: string[]; children: typeof ns }[]) => {
      for (const n of ns) {
        if (n.id === nodeId) found = n.tags
        walk(n.children)
      }
    }
    if (l) walk(l.nodes)
    return found
  })
  const text = nodeText(tags)
  const [draft, setDraft] = useState<string | null>(null)
  const ref = useRef<HTMLTextAreaElement>(null)
  const keep = useRef<string | null>(null)
  return (
    <div className="pt-0.5">
      <Textarea
        ref={ref}
        className="section-textarea"
        value={draft ?? text}
        placeholder="输入或粘贴 tag，逗号分隔"
        spellCheck={false}
        data-testid="discover-text"
        onFocus={() => {
          setDraft(keep.current ?? text)
          keep.current = null
        }}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={async () => {
          if (draft !== null && draft !== text) {
            const { tags: next, merged } = normalizeListTags(parseNodeText(draft), catalog)
            const left = new Set(next.map((t) => t.toLowerCase()))
            const gone = tags.filter((t) => !left.has(t.toLowerCase()))
            if (gone.length >= BULK_REMOVE) {
              keep.current = draft
              if (!(await confirmRemove(listId, [nodeId], gone, ref.current))) return
              keep.current = null
            }
            useLists.getState().setTags(listId, nodeId, next)
            const note = mergedNote(merged)
            if (note) toast(note)
          }
          setDraft(null)
        }}
        onKeyDown={(e) => {
          if (e.nativeEvent.isComposing) return
          if (e.key === 'Escape' || (e.key === 'Enter' && (e.ctrlKey || e.metaKey))) {
            e.preventDefault()
            e.stopPropagation()
            ref.current?.blur()
          }
        }}
      />
    </div>
  )
}
