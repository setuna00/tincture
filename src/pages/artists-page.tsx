import { AnimatePresence, motion } from 'motion/react'
import { memo, useCallback, useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { toast } from 'sonner'
import { confirmDelete } from '@/store/confirm'
import {
  Add01Icon,
  Copy01Icon,
  Delete02Icon,
  FolderAddIcon,
  LinkSquare02Icon,
  MoreHorizontalIcon,
  Search01Icon,
  SidebarRightIcon,
  GridViewIcon,
  StarIcon,
} from '@hugeicons/core-free-icons'
import { PaneHeader, SubSection } from '@/components/assistant/panel'
import { ArtistMedia, CollectionChecklist, CollectionIcon, CollectionsButton, FavButton, GalleryImg, Lightbox } from '@/components/artist-media'
import { SortControl } from '@/components/sort-control'
import { CopyButton, copyText } from '@/components/copy-button'
import { ChipFace, chipAttrs } from '@/components/editor/chip-face'
import { Icon } from '@/components/icon'
import { Button } from '@/components/ui/button'
import {
  ContextMenu,
  ContextMenuCheckboxItem,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Carousel, CarouselContent, CarouselItem, CarouselNext, CarouselPrevious, type CarouselApi } from '@/components/ui/carousel'
import { Input } from '@/components/ui/input'
import { Pagination, PaginationContent, PaginationEllipsis, PaginationItem, PaginationLink, PaginationNext, PaginationPrevious } from '@/components/ui/pagination'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { SelMark } from '@/components/sel-mark'
import { Tip } from '@/components/tip'
import { loadAliases, popOrder, popScore, resolveRenamed, useArtistData, useArtistDetail, useArtistList, useArtistPopularity, useArtistPosts, type ArtistList } from '@/lib/artist-db'
import { ARTIST_ALGO_LABEL, ARTIST_ALGOS, isPopAlgo } from '@/lib/artist-rank'
import { pruneImages, saveGalleryRest } from '@/lib/artist-image-cache'
import { fetchTopicArtists, isAbort, pruneCache } from '@/lib/danbooru-api'
import { artistLinks, coverFirstPosts, isNsfwMain, pickPosts, type DanbooruPost, type RatingMode } from '@/lib/danbooru-core'
import { formatCount, lookupTag, TAGS } from '@/lib/tagdb'
import { useArtistNav, useArtistStatus } from '@/store/artist-nav'
import { useAfterMenu } from '@/components/after-menu'
import { useDraftField } from '@/components/draft-field'
import { FAV_COLLECTION, isFavArtist, nextCollectionTitle, useLibrary, type ArtistCollection } from '@/store/library'
import { usePrefs, type ArtistSort, type ArtistSortBy } from '@/store/prefs'
import type { Chip } from '@/types'

const EASE = [0.2, 0.8, 0.2, 1] as const

interface Row {
  name: string
  count: number
  missing?: boolean
}

const SORT_LABEL: Record<ArtistSortBy, string> = { ...ARTIST_ALGO_LABEL, name: '名称', added: '加入时间' }
const SORT_DEFAULT_DESC: Record<ArtistSortBy, boolean> = { count: true, rep: true, hit: true, total: true, name: false, added: true }

const nameOrders = new WeakMap<ArtistList, Int32Array>()
function nameOrder(l: ArtistList): Int32Array {
  let o = nameOrders.get(l)
  if (!o) {
    o = Int32Array.from(l.names.keys()).sort((a, b) => (l.names[a] < l.names[b] ? -1 : l.names[a] > l.names[b] ? 1 : l.counts[b] - l.counts[a]))
    nameOrders.set(l, o)
  }
  return o
}

const lowerAliases = new WeakMap<string[][], string[]>()
const norm = (s: string) => s.toLowerCase().replace(/_/g, ' ')
function nameMatches(l: ArtistList, aliases: string[][] | null, q: string): Set<number> {
  const s = norm(q.trim())
  const out = new Set<number>()
  let al: string[] | undefined
  if (aliases) {
    al = lowerAliases.get(aliases)
    if (!al) lowerAliases.set(aliases, (al = aliases.map((a) => norm(a.join('\t')))))
  }
  for (let i = 0; i < l.names.length; i++) if (l.names[i].includes(s) || al?.[i].includes(s)) out.add(i)
  return out
}

let zhIndex: Map<string, string> | null = null
function topicOf(q: string): string | null {
  const s = q.trim()
  if (!s) return null
  const t = lookupTag(norm(s))
  if (t && (t.category === 'general' || t.category === 'meta')) return t.name
  zhIndex ??= new Map(TAGS.filter((x) => (x.category === 'general' || x.category === 'meta') && x.zh && !x.old).map((x) => [x.zh, x.name]))
  return zhIndex.get(s) ?? null
}

function useTopicSearch(q: string, mode: RatingMode): { topic: string | null; names?: Set<string>; failed?: boolean } {
  const topic = topicOf(q)
  const key = topic ? `${mode}:${topic}` : ''
  const [got, setGot] = useState<{ key: string; names?: Set<string>; failed?: boolean } | null>(null)
  useEffect(() => {
    if (!topic) return
    const ac = new AbortController()
    const t = setTimeout(
      () =>
        fetchTopicArtists(topic, mode, { priority: 0, signal: ac.signal }).then(
          (names) => setGot({ key, names: new Set(names) }),
          (e) => isAbort(e) || setGot({ key, failed: true }),
        ),
      300,
    )
    return () => {
      clearTimeout(t)
      ac.abort()
    }
  }, [topic, mode, key])
  return got?.key === key ? { topic, names: got.names, failed: got.failed } : { topic }
}

export function ArtistsHint() {
  const detail = useArtistStatus((s) => s.detail)
  const zoom = useArtistStatus((s) => s.zoom)
  return (
    <span className="truncate max-sm:hidden" data-testid="status-hint" data-state={zoom ? 'artists-zoom' : detail ? 'artists-detail' : 'artists'}>
      {zoom ? '← → 上一张 / 下一张 · Esc 关闭' : `单击 查看详情 · F 收藏 · 右键 加入合集${detail ? ' · 单击作品图 看大图 · Esc 收起详情' : ''}`}
    </span>
  )
}

export function ArtistsPage() {
  const list = useArtistList()
  const aliases = useArtistData((s) => s.aliases)
  const [nav] = useState(() => useArtistNav.getState())
  useEffect(() => useArtistNav.setState({ open: null, collection: null }), [])
  const [q, setQ] = useState(nav.open ?? '')
  const dq = useDeferredValue(q)
  const [view, setView] = useState(nav.collection ?? 'all')
  const [selected, setSelected] = useState<string | null>(nav.open)
  const [fresh, setFresh] = useState<string | null>(nav.collection)
  const [missing, setMissing] = useState<Set<string>>(() => new Set())
  const nsfw = usePrefs((s) => s.nsfw !== 'off')
  const sort = usePrefs((s) => s.artistSort)
  const collections = useLibrary((s) => s.artistCollections)
  const mode: RatingMode = nsfw ? 'all' : 'sfw'
  const pop = useArtistPopularity()

  const coll = view === 'all' ? undefined : collections.find((c) => c.id === view)
  const viewId = coll ? view : 'all'
  const sortBy: ArtistSortBy = sort.by === 'added' && !coll ? 'count' : sort.by
  const desc = sort.by === sortBy ? sort.desc : SORT_DEFAULT_DESC[sortBy]

  useEffect(() => {
    const t = setTimeout(() => {
      const inColl = new Set(useLibrary.getState().artistCollections.flatMap((c) => c.items.map((x) => x.name)))
      void pruneImages((n) => inColl.has(n)).then((left) => pruneCache((n) => inColl.has(n) || left.has(n)))
    }, 5000)
    return () => clearTimeout(t)
  }, [])
  const collNames = useMemo(() => [...new Set(collections.flatMap((c) => c.items.map((x) => x.name)))].sort().join('\n'), [collections])
  useEffect(() => {
    if (!list) return
    const names = collNames.split('\n').filter((n) => n && !list.index.has(n))
    if (!names.length) return
    let alive = true
    void resolveRenamed(names, (from, to) => useLibrary.getState().renameArtist(from, to)).then((m) => alive && setMissing(m))
    return () => {
      alive = false
    }
  }, [list, collNames])

  const topic = useTopicSearch(dq, mode)
  const hidden = useCallback((name: string) => !nsfw && !!list && list.nsfwOnly.has(list.index.get(name) ?? -1), [nsfw, list])
  const ready = !!list && (!isPopAlgo(sortBy) || !!pop)
  const rows = useMemo((): Row[] => {
    if (!list || (isPopAlgo(sortBy) && !pop)) return []
    const scoreOf = (i: number) => (isPopAlgo(sortBy) && pop ? popScore(pop, sortBy, mode, i) : list.counts[i])
    const matched = dq.trim() ? nameMatches(list, aliases, dq) : null
    if (matched && topic.names) for (const n of topic.names) if (list.index.has(n)) matched.add(list.index.get(n)!)
    const keep = (i: number) => (nsfw || !list.nsfwOnly.has(i)) && (!matched || matched.has(i))
    if (coll) {
      const dir = desc ? -1 : 1
      return coll.items
        .flatMap((x): (Row & { at: number; score: number | null })[] => {
          const i = list.index.get(x.name)
          if (i === undefined) return !matched || norm(x.name).includes(norm(dq.trim())) ? [{ name: x.name, count: 0, missing: missing.has(x.name), at: x.addedAt, score: null }] : []
          return keep(i) ? [{ name: x.name, count: list.counts[i], at: x.addedAt, score: scoreOf(i) }] : []
        })
        .sort(
          (a, b) =>
            (sortBy === 'name' || sortBy === 'added' ? 0 : Number(a.score === null) - Number(b.score === null)) ||
            (sortBy === 'name' ? (a.name < b.name ? -1 : a.name > b.name ? 1 : 0) : sortBy === 'added' ? a.at - b.at : (a.score ?? 0) - (b.score ?? 0)) * dir ||
            b.count - a.count,
        )
    }
    const out: Row[] = []
    const push = (i: number) => keep(i) && out.push({ name: list.names[i], count: list.counts[i] })
    if (sortBy === 'name') {
      const o = nameOrder(list)
      if (desc) for (let k = o.length - 1; k >= 0; k--) push(o[k])
      else for (let k = 0; k < o.length; k++) push(o[k])
    } else if (isPopAlgo(sortBy) && pop) {
      const o = popOrder(pop, sortBy, mode)
      if (desc) for (let k = 0; k < o.length; k++) push(o[k])
      else for (let k = o.length - 1; k >= 0; k--) push(o[k])
      for (let i = 0; i < list.names.length; i++) if (scoreOf(i) === null) push(i)
    } else if (desc) for (let i = 0; i < list.names.length; i++) push(i)
    else for (let i = list.names.length - 1; i >= 0; i--) push(i)
    return out
  }, [list, pop, mode, aliases, dq, topic.names, nsfw, coll, sortBy, desc, missing])
  const current = selected ? rows.find((r) => r.name === selected) ?? (list?.index.has(selected) ? { name: selected, count: list.counts[list.index.get(selected)!] } : undefined) : undefined
  const detailOpen = !!current
  useEffect(() => {
    useArtistStatus.setState({ detail: detailOpen })
    return () => { useArtistStatus.setState({ detail: false }) }
  }, [detailOpen])
  const pageKey = `${viewId}|${sortBy}|${desc}|${dq}|${nsfw}`
  const [pageAt, setPageAt] = useState({ key: pageKey, page: 1 })
  if (pageAt.key !== pageKey) setPageAt({ key: pageKey, page: 1 })
  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE))
  const page = Math.min(pageAt.key === pageKey ? pageAt.page : 1, pageCount)
  const pageRows = useMemo(() => rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE), [rows, page])

  const newCollection = useCallback((names: string[] = []) => {
    const lib = useLibrary.getState()
    const c = lib.createCollection(nextCollectionTitle(lib.artistCollections), names)
    setView(c.id)
    setFresh(c.id)
  }, [])
  const onSelect = useCallback((name: string) => setSelected((s) => (s === name ? null : name)), [])
  const removeCollection = async (id: string) => {
    const c = useLibrary.getState().artistCollections.find((x) => x.id === id)
    if (!c) return
    const body = `合集中的 ${c.items.length} 个画师将从合集中移除，画师本身不受影响。`
    if (!(await confirmDelete({ title: `删除合集「${c.title}」？`, body, action: '删除合集' }))) return
    const r = useLibrary.getState().removeCollection(id)
    if (!r) return
    setView('all')
    toast(`已删除合集「${r.c.title}」`, {
      action: {
        label: '撤销',
        onClick: () => {
          useLibrary.getState().restoreCollection(r.c, r.index)
          setView(r.c.id)
        },
      },
    })
  }

  useEffect(() => {
    if (!selected) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return
      const t = e.target as HTMLElement
      if (t.closest('input, textarea, [contenteditable]') || document.querySelector('[data-slot="dialog-content"], [role="menu"]')) return
      setSelected(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selected])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== 'f' || e.ctrlKey || e.metaKey || e.altKey || e.repeat || e.defaultPrevented) return
      const t = e.target as HTMLElement
      if (t.closest('input, textarea, [contenteditable]') || document.querySelector('[data-slot="dialog-content"], [role="menu"]')) return
      const name = t.closest<HTMLElement>('[data-testid="artist-card"]')?.dataset.name ?? selected
      if (!name) return
      e.preventDefault()
      useLibrary.getState().toggleInCollection(FAV_COLLECTION, name)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selected])

  const scrollRoot = useRef<HTMLDivElement>(null)
  const [scrollEl, setScrollEl] = useState<HTMLElement | null>(null)
  useLayoutEffect(() => setScrollEl(scrollRoot.current?.querySelector<HTMLElement>('[data-slot="scroll-area-viewport"]') ?? null), [])
  const goPage = (p: number) => {
    setPageAt({ key: pageKey, page: p })
    scrollEl?.scrollTo({ top: 0 })
  }

  const searchingTopic = !!dq.trim() && !!topic.topic && !topic.names && !topic.failed
  const empty =
    coll?.id === FAV_COLLECTION && !coll.items.length
      ? { title: '暂无收藏的画师', sub: '选中画师后按 F 收藏' }
      : coll && !coll.items.length
        ? { title: '此合集暂无画师', sub: '右键卡片选择「加入合集」' }
        : dq.trim()
          ? { title: `未找到匹配「${dq.trim()}」的画师`, sub: null }
          : { title: '暂无画师', sub: null }

  return (
    <div className="relative flex h-full min-h-0" data-testid="artists-page">
      {!current && <div className="wco-backdrop bg-work" />}
      <ScrollArea ref={scrollRoot} className={`h-full min-w-0 flex-1 bg-work ${!ready || !rows.length ? '[&_[data-slot=scroll-area-viewport]>div]:h-full' : ''}`}>
        <div className="flex min-h-full flex-col gap-5 px-8 py-7 max-md:px-4">
          <header className="flex flex-col gap-3">
            <div className="flex items-baseline gap-3">
              <h1 className="text-[17px] font-semibold">画师库</h1>
              <span className="text-[12px] text-ink-2 tabular-nums" data-testid="artist-count">
                {!ready
                  ? ''
                  : searchingTopic
                    ? `正在查找常画「${dq.trim()}」的画师…`
                    : topic.failed && dq.trim()
                      ? `${rows.length.toLocaleString()} 位 · 无法按题材查找「${dq.trim()}」`
                      : `${rows.length.toLocaleString()} 位 · 图片和题材来自 Danbooru`}
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
              <CollectionTabs view={viewId} onView={setView} collections={collections} hidden={hidden} onNew={() => newCollection()} />
              <div className="ml-auto flex shrink-0 items-center gap-3 max-md:w-full">
                <ArtistSort by={sortBy} desc={desc} withAdded={!!coll} />
                <div className="relative w-60 max-md:flex-1">
                  <Icon icon={Search01Icon} size={14} className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-ink-3" />
                  <Input className="pl-8" placeholder="搜索名字 / 中文名 / 题材" value={q} onChange={(e) => setQ(e.target.value)} onFocus={() => void loadAliases().catch(() => {})} data-testid="artist-search" />
                </div>
              </div>
            </div>
          </header>
          {coll && coll.id !== FAV_COLLECTION && (
            <CollectionHeader key={coll.id} c={coll} editTitle={fresh === coll.id} onEdited={() => setFresh(null)} onRemove={() => void removeCollection(coll.id)} />
          )}
          {!ready ? (
            <p className="m-auto text-center text-[13px] text-ink-3" data-testid="artist-list-loading">
              加载中…
            </p>
          ) : rows.length > 0 ? (
            <>
              <ArtistGrid key={page} rows={pageRows} mode={mode} selected={selected} scrollEl={scrollEl} onSelect={onSelect} onPick={setSelected} onNewCollection={newCollection} />
              <ArtistPager page={page} count={pageCount} onPage={goPage} />
            </>
          ) : (
            !searchingTopic && (
              <div className="page-in m-auto flex flex-col items-center gap-2 pb-16 text-center" data-testid="artist-empty">
                <p className="text-[13px] text-ink-2">{empty.title}</p>
                {empty.sub && <p className="text-[12px] text-ink-2">{empty.sub}</p>}
              </div>
            )
          )}
        </div>
      </ScrollArea>
      <AnimatePresence>
        {current && (
          <motion.aside
            key="artist-detail"
            initial={{ opacity: 0, x: 16 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 16 }}
            transition={{ duration: 0.18, ease: EASE }}
            className="flex w-(--artist-detail-w) shrink-0 flex-col border-l border-line bg-shell"
            data-testid="artist-detail"
          >
            <PaneHeader title="画师" corner>
              <Tip label="收起右栏">
                <Button variant="ghost" size="icon-sm" className="text-ink-2" onClick={() => setSelected(null)} aria-label="收起右栏" data-testid="artist-detail-close">
                  <Icon icon={SidebarRightIcon} size={16} />
                </Button>
              </Tip>
            </PaneHeader>
            <ScrollArea className="min-h-0 flex-1">
              <ArtistDetail key={current.name} row={current} mode={mode} onTopic={setQ} onNewCollection={() => newCollection([current.name])} />
            </ScrollArea>
          </motion.aside>
        )}
      </AnimatePresence>
    </div>
  )
}

const CARD_MIN = 176
const GAP = 16
const PAGE_SIZE = 60

/** Keep cards in one name-keyed layer so Motion preserves element identity and animates positions when the column count changes. */
function ArtistGrid({
  rows,
  mode,
  selected,
  scrollEl,
  onSelect,
  onPick,
  onNewCollection,
}: {
  rows: Row[]
  mode: RatingMode
  selected: string | null
  scrollEl: HTMLElement | null
  onSelect: (name: string) => void
  onPick: (name: string) => void
  onNewCollection: (names: string[]) => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  const [top, setTop] = useState(0)
  const [extra, setExtra] = useState(38)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el || !scrollEl) return
    const update = () => {
      setWidth(el.clientWidth)
      setTop(el.getBoundingClientRect().top - scrollEl.getBoundingClientRect().top + scrollEl.scrollTop)
    }
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    ro.observe(scrollEl.firstElementChild ?? scrollEl)
    return () => ro.disconnect()
  }, [scrollEl])
  const cols = Math.max(1, Math.floor((width + GAP) / (CARD_MIN + GAP)))
  const cardW = width ? (width - GAP * (cols - 1)) / cols : CARD_MIN
  const rowH = Math.round(cardW + extra)
  const virt = useVirtualizer({
    count: Math.ceil(rows.length / cols),
    getScrollElement: () => scrollEl,
    estimateSize: () => rowH + GAP,
    overscan: 2,
    scrollMargin: top,
  })
  useLayoutEffect(() => virt.measure(), [rowH, cols, virt])
  useLayoutEffect(() => {
    const card = ref.current?.querySelector<HTMLElement>('[data-testid="artist-card"]')
    if (card && Math.abs(card.offsetHeight - card.offsetWidth - extra) > 0.5) setExtra(card.offsetHeight - card.offsetWidth)
  })
  const selectedIndex = selected ? rows.findIndex((r) => r.name === selected) : -1
  const scrolledFor = useRef<{ selected: string | null; cols: number } | null>(null)
  const measured = width > 0
  useEffect(() => {
    if (!measured) return
    const last = scrolledFor.current
    scrolledFor.current = { selected, cols }
    if (!last || selectedIndex < 0 || (last.selected === selected && last.cols === cols)) return
    const t = setTimeout(() => virt.scrollToIndex(Math.floor(selectedIndex / cols), { align: 'auto' }), 260)
    return () => clearTimeout(t)
  }, [measured, selected, selectedIndex, cols, virt])

  const [cursor, setCursor] = useState<string | null>(null)
  const tabStop = selectedIndex >= 0 ? selected : cursor && rows.some((r) => r.name === cursor) ? cursor : (rows[0]?.name ?? null)
  const focusName = useRef<string | null>(null)
  const move = (name: string, key: string) => {
    const at = rows.findIndex((r) => r.name === name)
    const d = key === 'ArrowLeft' ? -1 : key === 'ArrowRight' ? 1 : key === 'ArrowUp' ? -cols : key === 'ArrowDown' ? cols : 0
    const to = at + d
    if (!d || at < 0 || to < 0 || to >= rows.length) return
    const next = rows[to].name
    setCursor(next)
    if (selected) onPick(next)
    focusName.current = next
    virt.scrollToIndex(Math.floor(to / cols), { align: 'auto' })
  }
  const moveRef = useRef(move)
  useLayoutEffect(() => {
    moveRef.current = move
  })
  const onMove = useCallback((name: string, key: string) => moveRef.current(name, key), [])
  useEffect(() => {
    const name = focusName.current
    if (!name) return
    const el = ref.current?.querySelector<HTMLElement>(`[data-testid="artist-card"][data-name="${CSS.escape(name)}"]`)
    if (!el) return
    focusName.current = null
    el.focus({ preventScroll: true })
  })

  const items = virt.getVirtualItems()
  return (
    <motion.div
      ref={ref}
      className="relative"
      style={{ height: Math.max(0, virt.getTotalSize() - GAP) }}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.18, ease: EASE }}
      data-testid="artist-grid"
    >
      {items.flatMap((vr) =>
        rows.slice(vr.index * cols, vr.index * cols + cols).map((r, c) => (
          <ArtistCard
            key={r.name}
            row={r}
            mode={mode}
            top={vr.start - top}
            left={c * (cardW + GAP)}
            width={cardW}
            selected={r.name === selected}
            tabbable={r.name === tabStop}
            onSelect={onSelect}
            onMove={onMove}
            onNewCollection={onNewCollection}
          />
        )),
      )}
    </motion.div>
  )
}

function pageItems(page: number, count: number): (number | null)[] {
  if (count <= 7) return Array.from({ length: count }, (_, i) => i + 1)
  if (page <= 4) return [1, 2, 3, 4, 5, null, count]
  if (page >= count - 3) return [1, null, count - 4, count - 3, count - 2, count - 1, count]
  return [1, null, page - 1, page, page + 1, null, count]
}

function ArtistPager({ page, count, onPage }: { page: number; count: number; onPage: (p: number) => void }) {
  const [jump, setJump] = useState('')
  if (count <= 1) return null
  const go = (p: number) => {
    const to = Math.min(count, Math.max(1, p))
    if (to !== page) onPage(to)
  }
  return (
    <Pagination className="flex-wrap items-center gap-x-5 gap-y-2" data-testid="artist-pager">
      <PaginationContent>
        <PaginationItem>
          <PaginationPrevious text="上一页" aria-label="上一页" disabled={page <= 1} onClick={() => go(page - 1)} className="text-ink-2" data-testid="artist-page-prev" />
        </PaginationItem>
        {pageItems(page, count).map((p, i) =>
          p === null ? (
            <PaginationItem key={`gap-${i}`}>
              <PaginationEllipsis className="text-ink-3" />
            </PaginationItem>
          ) : (
            <PaginationItem key={p}>
              <PaginationLink
                isActive={p === page}
                onClick={() => go(p)}
                aria-label={`第 ${p} 页`}
                className={`w-auto min-w-7 px-1.5 text-[12px] tabular-nums ${p === page ? 'text-ink-1' : 'text-ink-2'}`}
                data-testid="artist-page"
              >
                {p}
              </PaginationLink>
            </PaginationItem>
          ),
        )}
        <PaginationItem>
          <PaginationNext text="下一页" aria-label="下一页" disabled={page >= count} onClick={() => go(page + 1)} className="text-ink-2" data-testid="artist-page-next" />
        </PaginationItem>
      </PaginationContent>
      <label className="flex items-center gap-1.5 text-[12px] text-ink-2">
        跳至
        <Input
          value={jump}
          onChange={(e) => setJump(e.target.value.replace(/\D/g, ''))}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && jump) {
              go(Number(jump))
              setJump('')
            } else if (e.key === 'Escape') setJump('')
          }}
          onBlur={() => setJump('')}
          inputMode="numeric"
          aria-label="跳至页码"
          className="h-7 w-14 px-1.5 text-center text-[12px]"
          data-testid="artist-page-jump"
        />
        页
      </label>
    </Pagination>
  )
}

const seen = new Map<Element, (v: boolean) => void>()
let io: IntersectionObserver | null = null
function useInView(ref: React.RefObject<Element | null>): boolean {
  const [inView, setInView] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    io ??= new IntersectionObserver((entries) => {
      for (const e of entries) seen.get(e.target)?.(e.isIntersecting)
    })
    seen.set(el, setInView)
    io.observe(el)
    return () => {
      io?.unobserve(el)
      seen.delete(el)
    }
  }, [ref])
  return inView
}

function CollectionTabs({
  view,
  onView,
  collections,
  hidden,
  onNew,
}: {
  view: string
  onView: (v: string) => void
  collections: ArtistCollection[]
  hidden: (name: string) => boolean
  onNew: () => void
}) {
  const scroller = useRef<HTMLDivElement>(null)
  const [fade, setFade] = useState({ l: false, r: false })
  useEffect(() => {
    const el = scroller.current
    if (!el) return
    const update = () => {
      const l = el.scrollLeft > 1
      const r = el.scrollLeft + el.clientWidth < el.scrollWidth - 1
      setFade((f) => (f.l === l && f.r === r ? f : { l, r }))
    }
    update()
    el.addEventListener('scroll', update, { passive: true })
    const ro = new ResizeObserver(update)
    ro.observe(el)
    for (const c of el.children) ro.observe(c)
    return () => {
      el.removeEventListener('scroll', update)
      ro.disconnect()
    }
  }, [collections.length])
  useEffect(() => {
    const el = scroller.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      if (el.scrollWidth <= el.clientWidth || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return
      e.preventDefault()
      el.scrollLeft += e.deltaY
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])
  useEffect(() => {
    const el = scroller.current
    const t = el?.querySelector('[data-state="active"]')
    if (!el || !t) return
    const pad = 28
    const box = el.getBoundingClientRect()
    const r = t.getBoundingClientRect()
    if (r.left - pad < box.left) el.scrollLeft -= box.left - r.left + pad
    else if (r.right + pad > box.right) el.scrollLeft += r.right + pad - box.right
  }, [view, collections.length])
  return (
    <div className="flex min-w-0 flex-[1_1_320px] items-center gap-1">
      <Tabs value={view} onValueChange={onView} className="min-w-0">
        <TabsList
          ref={scroller}
          className="max-w-full justify-start overflow-x-auto rounded-md p-0.5 [scrollbar-width:none] group-data-horizontal/tabs:h-7"
          style={{ maskImage: `linear-gradient(to right, ${fade.l ? 'transparent' : '#000'}, #000 24px, #000 calc(100% - 24px), ${fade.r ? 'transparent' : '#000'})` }}
          data-testid="artist-collections"
        >
          <TabsTrigger value="all" className="flex-none gap-1 px-2.5 text-[12px]" data-testid="artist-filter-all">
            <Icon icon={GridViewIcon} size={14} />
            全部
          </TabsTrigger>
          {collections.map((c) => (
            <TabsTrigger key={c.id} value={c.id} className="flex-none gap-1 px-2.5 text-[12px]" data-testid={c.id === FAV_COLLECTION ? 'artist-filter-fav' : 'artist-filter-collection'}>
              <CollectionIcon id={c.id} size={12} />
              <span className="max-w-40 truncate">{c.title}</span>
              <span className="text-[11px] text-ink-2 tabular-nums">{c.items.filter((x) => !hidden(x.name)).length}</span>
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      <Button variant="ghost" size="sm" className="shrink-0 gap-1 text-[12px] text-ink-2 hover:text-ink-1" onClick={onNew} data-testid="artist-collection-new">
        <Icon icon={Add01Icon} size={14} />
        新建合集
      </Button>
    </div>
  )
}

function ArtistSort({ by, desc, withAdded }: { by: ArtistSortBy; desc: boolean; withAdded: boolean }) {
  const set = (patch: Partial<ArtistSort>) => usePrefs.getState().set({ artistSort: { by, desc, ...patch } })
  const options: ArtistSortBy[] = [...ARTIST_ALGOS, 'name', ...(withAdded ? (['added'] as const) : [])]
  const dirLabel =
    by === 'name' ? (desc ? 'Z → A' : 'A → Z') : by === 'added' ? (desc ? '新加入的在前' : '早加入的在前') : by === 'count' ? (desc ? '作品多的在前' : '作品少的在前') : desc ? '人气高的在前' : '人气低的在前'
  return <SortControl by={by} options={options} labels={SORT_LABEL} desc={desc} dirLabel={dirLabel} onBy={(v) => set({ by: v, desc: SORT_DEFAULT_DESC[v] })} onFlip={() => set({ desc: !desc })} testId="artist" />
}

function CollectionHeader({ c, editTitle, onEdited, onRemove }: { c: ArtistCollection; editTitle: boolean; onEdited: () => void; onRemove: () => void }) {
  const update = useLibrary.getState().updateCollection
  return (
    <div className="-mt-1 flex flex-col items-start gap-0.5" data-testid="collection-header">
      <div className="flex max-w-full min-w-0 items-center gap-1">
        <InlineEdit
          value={c.title}
          autoEdit={editTitle}
          onDone={(v) => {
            onEdited()
            if (v) update(c.id, { title: v })
          }}
          className="text-[16px] leading-7 font-semibold text-ink-1"
          label="合集名"
          testId="collection-title"
        />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" className="shrink-0 text-ink-2" aria-label="合集操作" data-testid="collection-menu">
              <Icon icon={MoreHorizontalIcon} size={16} />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-36">
            <DropdownMenuItem variant="destructive" onSelect={onRemove} data-testid="collection-delete">
              <Icon size={14} icon={Delete02Icon} />
              删除合集
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <InlineEdit
        value={c.description ?? ''}
        placeholder="添加描述…"
        onDone={(v) => v !== null && update(c.id, { description: v || undefined })}
        className="text-[13px] leading-6 text-ink-2"
        label="合集描述"
        testId="collection-desc"
      />
    </div>
  )
}

function InlineEdit({
  value,
  placeholder,
  autoEdit = false,
  onDone,
  className,
  label,
  testId,
}: {
  value: string
  placeholder?: string
  autoEdit?: boolean
  onDone: (v: string | null) => void
  className: string
  label: string
  testId: string
}) {
  const [editing, setEditing] = useState(autoEdit)
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (!editing) return
    ref.current?.focus()
    ref.current?.select()
  }, [editing])
  const field = useDraftField({
    value,
    onCommit: (t) => {
      setEditing(false)
      onDone(!t && !placeholder ? null : t)
    },
    onCancel: () => {
      setEditing(false)
      onDone(null)
    },
  })
  const box = '-mx-1.5 rounded-md border px-1.5'
  if (editing)
    return (
      <input
        ref={ref}
        placeholder={placeholder}
        aria-label={label}
        {...field.props}
        onKeyDown={(e) => {
          if (e.key === 'Escape') e.preventDefault()
          field.props.onKeyDown(e)
        }}
        className={`${box} max-w-full min-w-24 border-lamp-text [field-sizing:content] bg-work outline-none placeholder:text-ink-3 ${className}`}
        data-testid={`${testId}-input`}
      />
    )
  return (
    <Tip label={`点击编辑${label}`}>
      <button
        type="button"
        onClick={() => setEditing(true)}
        className={`${box} max-w-full truncate border-transparent text-left transition-colors duration-(--dur-fast) hover:border-line-strong ${value ? '' : '!text-ink-3'} ${className}`}
        data-testid={testId}
      >
        {value || placeholder}
      </button>
    </Tip>
  )
}

const ArtistCard = memo(function ArtistCard({
  row,
  mode,
  top,
  left,
  width,
  selected,
  tabbable,
  onSelect,
  onMove,
  onNewCollection,
}: {
  row: Row
  mode: RatingMode
  top: number
  left: number
  width: number
  selected: boolean
  tabbable: boolean
  onSelect: (name: string) => void
  onMove: (name: string, key: string) => void
  onNewCollection: (names: string[]) => void
}) {
  const { name, count, missing } = row
  const ref = useRef<HTMLElement>(null)
  const inView = useInView(ref)
  const got = useArtistPosts(name, mode, inView && !missing)
  const posts = Array.isArray(got) ? pickPosts(name, mode, got) : []
  const menu = useAfterMenu()
  const fav = useLibrary((s) => isFavArtist(s, name))
  const label = `${name}，${missing ? 'Danbooru 上未找到' : `${count.toLocaleString()} 作品`}${fav ? '，已收藏' : ''}`
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <motion.article
          ref={ref}
          layout="position"
          transition={{ duration: 0.22, ease: EASE }}
          style={{ position: 'absolute', top, left, width }}
          role="button"
          tabIndex={tabbable ? 0 : -1}
          aria-pressed={selected}
          aria-label={label}
          onClick={() => onSelect(name)}
          onKeyDown={(e) => {
            if (e.target !== e.currentTarget || e.altKey || e.ctrlKey || e.metaKey) return
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              onSelect(name)
            } else if (e.key.startsWith('Arrow')) {
              e.preventDefault()
              onMove(name, e.key)
            }
          }}
          data-selected={selected ? '' : undefined}
          data-name={name}
          className="artist-card group flex cursor-pointer flex-col overflow-hidden rounded-lg border border-line-strong bg-work hover:border-ink-3/60"
          data-testid="artist-card"
        >
          <div className="relative">
            <ArtistMedia name={name} posts={posts} pool={Array.isArray(got) ? got : undefined} loading={got === undefined && !missing} failed={got === 'failed'} width={width} />
            <SelMark />
          </div>
          <StarToggle name={name} className="artist-star" testId="artist-star" />
          <div className="flex items-center gap-0.5 py-1.5 pr-1.5 pl-2.5">
            <span className="min-w-0 truncate text-[13px] text-ink-1" data-testid="artist-name">
              {name}
            </span>
            <CopyIconButton name={name} testId="artist-copy" />
            <Tip label={missing ? 'Danbooru 上未找到此画师' : undefined}>
              <span className={`ml-auto shrink-0 pl-1 text-[11px] text-ink-2 tabular-nums`} data-testid="artist-card-count">
                {missing ? '未找到' : count ? formatCount(count) : ''}
              </span>
            </Tip>
          </div>
        </motion.article>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-40" onCloseAutoFocus={menu.onCloseAutoFocus} data-testid="artist-card-menu">
        <ContextMenuSub>
          <ContextMenuSubTrigger className="text-[13px]" data-testid="artist-menu-collections">
            <Icon size={14} icon={FolderAddIcon} />
            加入合集
          </ContextMenuSubTrigger>
          <ContextMenuSubContent className="w-44">
            <CollectionChecklist name={name} Item={ContextMenuCheckboxItem} Separator={ContextMenuSeparator} NewItem={ContextMenuItem} onNew={() => menu.later(() => onNewCollection([name]))} />
          </ContextMenuSubContent>
        </ContextMenuSub>
      </ContextMenuContent>
    </ContextMenu>
  )
})

function CopyIconButton({ name, testId }: { name: string; testId: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon-xs"
          tabIndex={-1}
          className="shrink-0 text-ink-2 hover:text-ink-1"
          onClick={(e) => {
            e.stopPropagation()
            copyText(`artist:${name}`, ` artist:${name}`)
          }}
          aria-label={`复制 artist:${name}`}
          data-testid={testId}
        >
          <Icon icon={Copy01Icon} size={16} />
        </Button>
      </TooltipTrigger>
      <TooltipContent>复制 artist:{name}</TooltipContent>
    </Tooltip>
  )
}

function StarToggle({ name, className, testId }: { name: string; className: string; testId: string }) {
  const on = useLibrary((s) => isFavArtist(s, name))
  return (
    <button
      type="button"
      tabIndex={-1}
      className={className}
      onClick={(e) => {
        e.stopPropagation()
        useLibrary.getState().toggleInCollection(FAV_COLLECTION, name)
      }}
      aria-label={on ? `取消收藏 ${name}` : `收藏 ${name}`}
      aria-pressed={on}
      data-testid={testId}
    >
      <Icon icon={StarIcon} size={16} />
    </button>
  )
}

function ArtistDetail({ row, mode, onTopic, onNewCollection }: { row: Row; mode: RatingMode; onTopic: (t: string) => void; onNewCollection: () => void }) {
  const { name, count, missing } = row
  const got = useArtistPosts(name, mode, !missing, 0)
  const detail = useArtistDetail(name, mode)
  useEffect(() => {
    if (Array.isArray(got)) void saveGalleryRest(coverFirstPosts(name, mode, got).slice(3), name)
  }, [got, name, mode])
  const otherNames = useArtistData((s) => {
    const i = s.list?.index.get(name)
    return i === undefined ? undefined : s.aliases?.[i]
  })
  const loading = <p className="text-[11px] text-ink-3">加载中…</p>
  return (
    <div className="detail-swap flex flex-col px-3 pt-3 pb-6">
      <div className="flex flex-col gap-2">
        <div className="flex items-start gap-2">
          <h2 className="min-w-0 flex-1 text-[16px] leading-7 font-semibold tracking-[-0.005em] break-words text-ink-1" data-testid="artist-detail-name">
            <span className="font-mono text-[13px] font-normal text-ink-2">artist:</span>
            {name}
          </h2>
          <div className="flex shrink-0 items-center gap-1">
            <CopyButton text={`artist:${name}`} what={` artist:${name}`} size="default" testId="artist-detail-copy" />
            <FavButton name={name} testId="artist-detail-star" hotkey="F" />
            <CollectionsButton name={name} testId="artist-detail-collections" onNewCollection={onNewCollection} />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {missing ? <span className="meta-chip">Danbooru 上未找到</span> : <span className="meta-chip tabular-nums">{count.toLocaleString()} 作品</span>}
          {detail.nsfwCount !== undefined && isNsfwMain(count, detail.nsfwCount) && <span className="detail-swap meta-chip">NSFW 为主</span>}
        </div>
        {otherNames && otherNames.length > 0 && <OtherNames names={otherNames} />}
      </div>
      <div className="mt-3">
        <Gallery name={name} posts={Array.isArray(got) ? coverFirstPosts(name, mode, got) : got} />
      </div>
      <div className="my-4 border-t border-line" />
      <div className="flex flex-col gap-4">
        <SubSection id="artist-sec-topics" title="常画题材" hint={detail.topics?.length ? '点击按题材查找画师' : undefined}>
          {detail.topics ? (
            detail.topics.length ? (
              <div className="detail-swap flex flex-wrap gap-1.5" data-testid="artist-topics">
                {detail.topics.map((t) => (
                  <TopicChip key={t} tag={t} onClick={() => onTopic(t)} />
                ))}
              </div>
            ) : (
              <p className="text-[11px] text-ink-2">暂无</p>
            )
          ) : missing ? (
            <p className="text-[11px] text-ink-2">暂无</p>
          ) : detail.failed ? (
            <p className="text-[11px] text-ink-2" data-testid="artist-topics-failed">
              无法连接 Danbooru
            </p>
          ) : (
            loading
          )}
        </SubSection>
        <Links name={name} urls={detail.urls ?? []} />
        <Note name={name} />
      </div>
    </div>
  )
}

function TopicChip({ tag, onClick }: { tag: string; onClick: () => void }) {
  const c: Chip = { id: tag, text: tag, type: 'tag', weight: 1, disabled: false }
  return (
    <Tip label={`搜索常画「${tag}」的画师`}>
      <button
        type="button"
        className="chip alt-chip"
        {...chipAttrs(c)}
        data-cat={lookupTag(tag)?.category ?? 'general'}
        data-unknown={undefined}
        data-chip-id={undefined}
        onClick={onClick}
        data-testid="artist-topic"
      >
        <ChipFace chip={c} />
      </button>
    </Tip>
  )
}

function OtherNames({ names }: { names: string[] }) {
  const [all, setAll] = useState(false)
  const LIMIT = 6
  const list = all ? names : names.slice(0, LIMIT)
  return (
    <p className="text-[12px] leading-relaxed break-words text-ink-2" data-testid="artist-other-names">
      {list.map((n) => n.replace(/_/g, ' ')).join(' · ')}
      {names.length > LIMIT && (
        <button type="button" className="ml-1.5 text-ink-2 hover:text-ink-1" onClick={() => setAll((v) => !v)} aria-expanded={all}>
          {all ? '收起' : `等 ${names.length} 个`}
        </button>
      )}
    </p>
  )
}

function Gallery({ name, posts }: { name: string; posts: DanbooruPost[] | 'failed' | undefined }) {
  if (posts === undefined)
    return (
      <div className="grid aspect-[4/5] place-items-center rounded-md bg-surface-2 text-[12px] text-ink-2" data-testid="artist-gallery-loading">
        加载中…
      </div>
    )
  if (posts === 'failed') return <div className="grid aspect-[4/5] place-items-center rounded-md bg-surface-2 text-[12px] text-ink-2">无法连接 Danbooru，请稍后重试</div>
  if (!posts.length) return <div className="grid aspect-[4/5] place-items-center rounded-md bg-surface-2 text-[12px] text-ink-2">Danbooru 上暂无此分级的作品</div>
  return <GalleryCarousel name={name} posts={posts} />
}

function GalleryCarousel({ name, posts }: { name: string; posts: DanbooruPost[] }) {
  const [api, setApi] = useState<CarouselApi>()
  const [index, setIndex] = useState(0)
  const [zoom, setZoom] = useState<number | null>(null)
  const zoomOpen = zoom !== null
  useEffect(() => {
    useArtistStatus.setState({ zoom: zoomOpen })
    return () => { useArtistStatus.setState({ zoom: false }) }
  }, [zoomOpen])
  const [seenSlides, setSeen] = useState<Set<number>>(() => new Set([0, 1]))
  useEffect(() => {
    if (!api) return
    const onSelect = () => {
      const i = api.selectedScrollSnap()
      const n = api.scrollSnapList().length
      setIndex(i)
      setSeen((s) => (s.has(i) && s.has((i + 1) % n) && s.has((i - 1 + n) % n) ? s : new Set([...s, i, (i + 1) % n, (i - 1 + n) % n])))
    }
    onSelect()
    api.on('select', onSelect).on('reInit', onSelect)
    return () => {
      api.off('select', onSelect).off('reInit', onSelect)
    }
  }, [api])
  const go = (to: number | 'prev' | 'next') => {
    if (!api) return
    if (to === 'prev') api.scrollPrev()
    else if (to === 'next') api.scrollNext()
    else api.scrollTo(to)
  }
  const openZoom = (i: number) => setZoom(i)
  const closeZoom = (i: number) => {
    setZoom(null)
    api?.scrollTo(i, true)
  }

  return (
    <section className="flex flex-col gap-2">
      <Carousel setApi={setApi} opts={{ loop: posts.length > 1 }} className="group/gallery" data-testid="artist-gallery">
        <CarouselContent className="ml-0">
          {posts.map((p, i) => (
            <CarouselItem key={p.id} className="pl-0" data-testid="artist-slide">
              <button type="button" className="relative block aspect-[4/5] w-full cursor-zoom-in overflow-hidden rounded-md bg-surface-2" onClick={() => openZoom(i)} aria-label={`放大第 ${i + 1} 张`}>
                {seenSlides.has(i) && <GalleryImg p={p} name={name} />}
              </button>
            </CarouselItem>
          ))}
        </CarouselContent>
        {posts.length > 1 && (
          <>
            <CarouselPrevious
              variant="secondary"
              className="left-2 opacity-0 shadow-sm transition-opacity duration-(--dur) group-hover/gallery:opacity-100 focus-visible:opacity-100"
              onClick={() => go('prev')}
              aria-label="上一张"
              data-testid="gallery-prev"
            />
            <CarouselNext
              variant="secondary"
              className="right-2 opacity-0 shadow-sm transition-opacity duration-(--dur) group-hover/gallery:opacity-100 focus-visible:opacity-100"
              onClick={() => go('next')}
              aria-label="下一张"
              data-testid="gallery-next"
            />
          </>
        )}
        <span className="pointer-events-none absolute right-2 bottom-2 rounded bg-black/55 px-1.5 py-0.5 text-[11px] text-white tabular-nums" data-testid="gallery-counter">
          {index + 1} / {posts.length}
        </span>
      </Carousel>
      {posts.length > 1 && (
        <div className="-my-1.5 flex flex-wrap justify-center" aria-hidden>
          {posts.map((p, i) => (
            <button
              key={p.id}
              type="button"
              tabIndex={-1}
              className="group/dot grid h-6 w-3 place-items-center"
              data-on={i === index ? '' : undefined}
              onClick={() => go(i)}
            >
              <span className="size-1.5 rounded-full bg-ink-3/35 transition-[background,transform] duration-(--dur) group-hover/dot:bg-ink-3 group-data-[on]/dot:scale-125 group-data-[on]/dot:bg-ink-1" />
            </button>
          ))}
        </div>
      )}
      {zoom !== null && <Lightbox name={name} posts={posts} start={zoom} onClose={closeZoom} />}
    </section>
  )
}

function Links({ name, urls }: { name: string; urls: string[] }) {
  const meta = useLibrary((s) => s.artists[name])
  const list = artistLinks(name, [...urls, meta?.pixiv, meta?.twitter, meta?.other].filter((u): u is string => !!u))
  return (
    <SubSection id="artist-sec-links" title="链接">
      <div className="flex flex-wrap gap-1.5" data-testid="artist-links">
        {list.map((l) => (
          <Button key={l.label} variant="outline" size="sm" className="detail-swap gap-1.5 text-[12px]" asChild>
            <Tip label={l.url}>
              <a href={l.url} target="_blank" rel="noopener noreferrer" data-testid={l.label === 'Danbooru' ? 'artist-danbooru' : 'artist-link'}>
                <SiteIcon src={l.icon} />
                {l.label}
              </a>
            </Tip>
          </Button>
        ))}
      </div>
    </SubSection>
  )
}

function SiteIcon({ src }: { src: string }) {
  const [broken, setBroken] = useState(false)
  return broken ? <Icon icon={LinkSquare02Icon} size={14} /> : <img src={src} alt="" className="size-3.5 rounded-sm" onError={() => setBroken(true)} />
}

function Note({ name }: { name: string }) {
  const saved = useLibrary((s) => s.artists[name]?.note ?? '')
  const field = useDraftField({ value: saved, multiline: true, select: false, onCommit: (t) => useLibrary.getState().updateArtist(name, { note: t || undefined }) })
  return (
    <SubSection id="artist-sec-note" title="备注" hint="仅保存在本地">
      <Textarea
        rows={3}
        placeholder="画风特点、适合的权重……"
        {...field.props}
        onKeyDown={(e) => {
          if (e.key === 'Escape') e.preventDefault()
          field.props.onKeyDown(e)
        }}
        className="text-[13px]"
        data-testid="artist-note"
      />
    </SubSection>
  )
}
