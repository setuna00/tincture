import { useEffect, useMemo, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { ArrowDown01Icon, ArrowRight01Icon, Search01Icon, Tick02Icon } from '@hugeicons/core-free-icons'
import { customTree, LISTS, listTree, useCatalog } from '@/components/discover/data'
import { Icon } from '@/components/icon'
import { Seg } from '@/components/seg'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { allWorks, charsOfWork, useCharWorks } from '@/lib/char-works'
import { ancestors, UNASSIGNED_PATH, type ListNode } from '@/lib/discover'
import { addSources, DEFAULT_MIN_COUNT, type GachaPool, type PoolSource } from '@/lib/gacha'
import { lookupTag, searchTags } from '@/lib/tagdb'
import { cn } from '@/lib/utils'
import { useLists } from '@/store/lists'
import type { BuiltinListId } from '@/store/prefs'
import { DEFAULT_CHAR_MIN, resolveSource, sameSource } from './data'

const fmt = (n: number) => n.toLocaleString('en-US')

function Box({ on, done }: { on: boolean; done?: boolean }) {
  return (
    <span
      className={cn('grid size-3.5 shrink-0 place-items-center rounded-sm border transition-colors', on ? 'border-lamp-text bg-lamp text-lamp-ink' : 'border-line-strong', done && 'opacity-45')}
    >
      {on && <Icon icon={Tick02Icon} size={14} />}
    </span>
  )
}

const keyOf = (s: PoolSource) => (s.kind === 'list' ? `${s.list}:${s.path}` : s.kind === 'mylist' ? `m:${s.list}:${s.node}` : s.kind === 'work' ? `w:${s.work}` : 'artists')

export interface SinglePick {
  title: string
  description: string
  action: string
  current?: PoolSource
  onPick: (s: PoolSource, tags: string[], name: string) => void
}

export function AddCategoryDialog({
  open,
  onOpenChange,
  p,
  onChange,
  single,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  p: GachaPool
  onChange: (next: GachaPool) => void
  single?: SinglePick
}) {
  const catalog = useCatalog()
  const lists = useLists((s) => s.lists)
  const already = single ? (single.current ? [single.current] : []) : p.source
  const firstList = already.find((s) => s.kind === 'list') ?? p.source.find((s) => s.kind === 'list')
  const [tab, setTab] = useState<BuiltinListId | 'mine'>(firstList?.kind === 'list' ? firstList.list : 'b')
  const initial = () => new Set(already.flatMap((s) => (s.kind === 'list' ? ancestors(s.path).map((a) => `${s.list}:${a}`) : [])))
  const [opened, setOpened] = useState<Set<string>>(initial)
  const [pending, setPending] = useState<PoolSource[]>([])
  useEffect(() => {
    if (!open) return
    setPending([])
    setOpened(initial())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])
  const added = (s: PoolSource) => !single && p.source.some((x) => sameSource(x, s))
  const isCurrent = (s: PoolSource) => !!single?.current && sameSource(single.current, s)
  const isPending = (s: PoolSource) => pending.some((x) => sameSource(x, s))
  const toggle = (s: PoolSource) => {
    if (single) return setPending(isCurrent(s) ? [] : [s])
    if (!added(s)) setPending((list) => (isPending(s) ? list.filter((x) => !sameSource(x, s)) : [...list, s]))
  }
  const titles = useRef(new Map<string, string>())
  const sizeCache = useRef(new Map<string, number>())
  const size = (s: PoolSource) => {
    const k = keyOf(s)
    let n = sizeCache.current.get(k)
    if (n === undefined && catalog) sizeCache.current.set(k, (n = resolveSource(s, catalog, lists)?.length ?? 0))
    return n ?? 0
  }
  const rows = useMemo(() => {
    const out: { node: ListNode; src: PoolSource; key: string; branch: boolean; header?: boolean }[] = []
    const walkBuiltin = (list: BuiltinListId, n: ListNode) => {
      for (const ch of n.children) {
        if (ch.atom || ch.path.startsWith(UNASSIGNED_PATH)) continue
        const key = `${list}:${ch.path}`
        const branch = ch.children.some((x) => !x.atom)
        out.push({ node: ch, src: { kind: 'list', list, path: ch.path, minCount: DEFAULT_MIN_COUNT }, key, branch })
        if (branch && opened.has(key)) walkBuiltin(list, ch)
      }
    }
    if (tab !== 'mine') walkBuiltin(tab, listTree(tab))
    else
      for (const l of lists) {
        const t = customTree(l)
        out.push({ node: { ...t, title: l.name, depth: 1 }, src: { kind: 'mylist', list: l.id, node: '' }, key: `${l.id}:`, branch: false, header: true })
        const walk = (n: ListNode) => {
          for (const ch of n.children) {
            const key = `${l.id}:${ch.path}`
            const branch = ch.children.length > 0
            out.push({ node: { ...ch, depth: ch.depth + 1 }, src: { kind: 'mylist', list: l.id, node: ch.id! }, key, branch })
            if (branch && opened.has(key)) walk(ch)
          }
        }
        walk(t)
      }
    return out
  }, [tab, opened, lists])
  const total = useMemo(() => {
    if (!catalog) return 0
    const set = new Set<string>()
    for (const s of pending) for (const t of resolveSource(s, catalog, lists) ?? []) set.add(t)
    return set.size
  }, [pending, catalog, lists])
  const confirm = () => {
    if (!catalog || !pending.length) return
    if (single) {
      const s = pending[0]
      single.onPick(s, resolveSource(s, catalog, lists) ?? [], titles.current.get(keyOf(s)) ?? '')
      return onOpenChange(false)
    }
    onChange(
      addSources(
        p,
        pending.map((s) => ({ source: s, tags: resolveSource(s, catalog, lists) ?? [] })),
        sameSource,
      ),
    )
    onOpenChange(false)
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[min(640px,90vh)] flex-col gap-0 p-0 sm:max-w-[560px]" data-testid="gacha-add-category">
        <DialogHeader className="px-4 pt-4 pb-2.5">
          <DialogTitle>{single?.title ?? '添加分类'}</DialogTitle>
          <DialogDescription>{single?.description ?? `添加到「${p.name}」`}</DialogDescription>
        </DialogHeader>
        <div className="px-4 pb-2.5">
          <Seg
            value={tab}
            onChange={setTab}
            options={{ ...(Object.fromEntries(LISTS.map((l) => [l.id, `内置 ${l.id.toUpperCase()}`])) as Record<BuiltinListId, string>), mine: '我的 list' }}
            testId="gacha-add-category-list"
          />
        </div>
        <div className="min-h-[280px] flex-1 overflow-auto border-y border-line p-1.5" data-testid="gacha-add-category-tree">
          {!catalog && <span className="block px-2 py-1.5 text-[12px] text-ink-3">加载中…</span>}
          {catalog && tab === 'mine' && !lists.length && <span className="block px-2 py-1.5 text-[12px] text-ink-2">暂无自建 list（可在百科页新建）</span>}
          {catalog &&
            rows.map(({ node, src, key, branch, header }) => {
              if (header)
                return (
                  <span key={key} className="block px-2 pt-2 pb-1 text-[11px] font-medium text-ink-2">
                    {node.title}
                  </span>
                )
              const done = added(src)
              const on = done || isPending(src)
              titles.current.set(keyOf(src), node.title)
              return (
                <div
                  key={key}
                  className={cn('flex h-[30px] items-center gap-1.5 rounded-md pr-2.5 text-[13px]', isPending(src) && 'bg-surface-2')}
                  style={{ paddingLeft: 8 + (node.depth - 1) * 20 }}
                >
                  <button
                    type="button"
                    className="grid w-3 place-items-center text-ink-2"
                    onClick={() => branch && setOpened((o) => (o.has(key) ? new Set([...o].filter((x) => x !== key)) : new Set([...o, key])))}
                    tabIndex={branch ? 0 : -1}
                    aria-label={branch ? (opened.has(key) ? '收起' : '展开') : undefined}
                  >
                    {branch && <Icon icon={opened.has(key) ? ArrowDown01Icon : ArrowRight01Icon} size={14} />}
                  </button>
                  <button
                    type="button"
                    className="flex min-w-0 flex-1 items-center gap-1.5 text-left disabled:cursor-default"
                    onClick={() => toggle(src)}
                    disabled={done}
                    role="checkbox"
                    aria-checked={on}
                    data-testid="gacha-add-category-node"
                    data-path={src.kind === 'list' ? src.path : src.kind === 'mylist' ? src.node : ''}
                  >
                    <Box on={on} done={done} />
                    <span className={cn('truncate', done ? 'text-ink-3' : 'text-ink-1')}>{node.title}</span>
                    {done && <span className="text-[11px] text-ink-2">已加</span>}
                    {isCurrent(src) && <span className="text-[11px] text-ink-2">当前</span>}
                    <span className="ml-auto text-[11px] text-ink-2 tabular-nums">{fmt(size(src))}</span>
                  </button>
                </div>
              )
            })}
        </div>
        <DialogFooter className="flex-row items-center px-4 py-2.5 sm:justify-start">
          <span className="text-[12px] text-ink-2" data-testid="gacha-add-category-summary">
            {single ? (pending.length ? `${fmt(total)} 个 tag` : '请选择分类') : pending.length ? `已选 ${pending.length} 个分类 · ${fmt(total)} 个 tag` : '请勾选分类'}
          </span>
          <span className="flex-1" />
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button onClick={confirm} disabled={!pending.length} data-testid="gacha-add-category-ok">
            {single?.action ?? '添加'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

const MIN_OPTIONS = { '100': '≥100', '1000': '≥1000', '5000': '≥5000' } as const

export function AddWorksDialog({ open, onOpenChange, p, onChange }: { open: boolean; onOpenChange: (o: boolean) => void; p: GachaPool; onChange: (next: GachaPool) => void }) {
  const ready = useCharWorks()
  const catalog = useCatalog()
  const [q, setQ] = useState('')
  const [min, setMin] = useState<keyof typeof MIN_OPTIONS>(String(DEFAULT_CHAR_MIN) as '1000')
  const [pending, setPending] = useState<string[]>([])
  const [hits, setHits] = useState<string[] | null>(null)
  useEffect(() => {
    if (!open) return
    setPending([])
    setQ('')
  }, [open])
  const minN = Number(min)
  const works = useMemo(() => {
    if (!ready) return []
    return allWorks()
      .map((w) => ({ w, zh: lookupTag(w)?.zh || '', count: lookupTag(w)?.count ?? 0, n: charsOfWork(w).filter((t) => (lookupTag(t)?.count ?? 0) >= minN).length }))
      .filter((x) => x.n > 0)
      .sort((a, b) => b.count - a.count)
  }, [ready, minN])
  useEffect(() => {
    const text = q.trim()
    if (!text) return setHits(null)
    let alive = true
    searchTags(text, 80).then((r) => alive && setHits(r.filter((x) => x.tag.category === 'copyright').map((x) => x.tag.name)))
    return () => {
      alive = false
    }
  }, [q])
  const shown = useMemo(() => {
    if (!hits) return works
    const by = new Map(works.map((x) => [x.w, x]))
    return hits.map((w) => by.get(w)).filter((x): x is (typeof works)[number] => !!x)
  }, [hits, works])
  const added = (w: string) => p.source.some((s) => s.kind === 'work' && s.work === w)
  const toggle = (w: string) => !added(w) && setPending((l) => (l.includes(w) ? l.filter((x) => x !== w) : [...l, w]))
  const scroller = useRef<HTMLDivElement>(null)
  const v = useVirtualizer({ count: shown.length, getScrollElement: () => scroller.current, estimateSize: () => 32, overscan: 8 })
  const nChars = pending.reduce((a, w) => a + (works.find((x) => x.w === w)?.n ?? 0), 0)
  const confirm = () => {
    if (!catalog || !pending.length) return
    const srcs: PoolSource[] = pending.map((w) => ({ kind: 'work', work: w, minCount: minN }))
    onChange(
      addSources(
        p,
        srcs.map((s) => ({ source: s, tags: resolveSource(s, catalog, []) ?? [] })),
        sameSource,
      ),
    )
    onOpenChange(false)
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[min(640px,90vh)] flex-col gap-0 p-0 sm:max-w-[600px]" data-testid="gacha-add-works">
        <DialogHeader className="px-4 pt-4 pb-2.5">
          <DialogTitle>添加作品</DialogTitle>
          <DialogDescription>添加到「{p.name}」</DialogDescription>
        </DialogHeader>
        <div className="flex items-center gap-2.5 px-4 pb-2.5">
          <label className="flex h-7 flex-1 items-center gap-1.5 rounded-md border border-line-strong px-2.5 text-ink-2 focus-within:border-lamp-text">
            <Icon icon={Search01Icon} size={14} />
            <input
              className="min-w-0 flex-1 bg-transparent text-[13px] text-ink-1 outline-none placeholder:text-ink-3"
              placeholder="搜索作品（中 / 英 / 拼音）"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => e.stopPropagation()}
              data-testid="gacha-add-works-search"
            />
          </label>
          <span className="text-[12px] text-ink-2">仅收录作品数</span>
          <Seg value={min} onChange={setMin} options={MIN_OPTIONS} testId="gacha-add-works-min" />
        </div>
        <div ref={scroller} className="h-[400px] overflow-auto border-y border-line p-1.5" data-testid="gacha-add-works-list">
          {!ready && <span className="block px-2 py-1.5 text-[12px] text-ink-3">加载中…</span>}
          {ready && !shown.length && <span className="block px-2 py-1.5 text-[12px] text-ink-2">{q.trim() ? `未找到匹配「${q.trim()}」的作品（或其中没有作品数达标的角色）` : '暂无作品'}</span>}
          <div className="relative" style={{ height: v.getTotalSize() }}>
            {v.getVirtualItems().map((it) => {
              const x = shown[it.index]
              const done = added(x.w)
              const on = done || pending.includes(x.w)
              return (
                <button
                  key={x.w}
                  type="button"
                  className={cn('absolute inset-x-0 flex h-8 items-center gap-2 rounded-md px-2.5 text-left text-[13px] disabled:cursor-default', pending.includes(x.w) && 'bg-surface-2')}
                  style={{ top: it.start }}
                  onClick={() => toggle(x.w)}
                  disabled={done}
                  role="checkbox"
                  aria-checked={on}
                  data-testid="gacha-add-works-row"
                  data-work={x.w}
                >
                  <Box on={on} done={done} />
                  <span className={cn('whitespace-nowrap', done ? 'text-ink-3' : 'text-ink-1')}>{x.zh || x.w}</span>
                  {x.zh && <span className="truncate text-[11px] text-ink-2">{x.w}</span>}
                  {done && <span className="shrink-0 text-[11px] text-ink-2">已加</span>}
                  <span className="ml-auto shrink-0 text-[11px] whitespace-nowrap text-ink-2 tabular-nums">{fmt(x.n)} 个角色</span>
                </button>
              )
            })}
          </div>
        </div>
        <DialogFooter className="flex-row items-center px-4 py-2.5 sm:justify-start">
          <span className="text-[12px] text-ink-2" data-testid="gacha-add-works-summary">
            {pending.length ? `已选 ${pending.length} 部 · ${fmt(nChars)} 个角色` : '请勾选作品'}
          </span>
          <span className="flex-1" />
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button onClick={confirm} disabled={!pending.length} data-testid="gacha-add-works-ok">
            添加
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
