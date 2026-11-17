import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft01Icon, ArrowRight01Icon, Cancel01Icon, Clock01Icon, Delete02Icon, LayoutGridIcon, Search01Icon } from '@hugeicons/core-free-icons'
import { Icon } from '@/components/icon'
import { SortControl } from '@/components/sort-control'
import { TagName } from '@/components/tag-name'
import { Tip } from '@/components/tip'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import { countValues, hasWord } from '@/lib/gallery'
import { SORT_DEFAULT_DIR, type Stack } from '@/lib/gallery-stacks'
import { parsePrompt, toChip } from '@/lib/nai'
import { chipZh, searchTags } from '@/lib/tagdb'
import { cn } from '@/lib/utils'
import { emptyTrash, factsFor, forgetSearch, rememberSearch, useGalleryUi, useMarks } from '@/store/gallery'
import type { GenImage } from '@/store/gen'
import { usePrefs } from '@/store/prefs'
import { dirLabel, RIGHT_EDGE_PR, ROW_MAX, ROW_MIN, SORT_LABEL, useGalleryNamer } from './data'
import { FilterPills } from './filter-bar'

export function GalleryHeader({ label, total, shown, narrowed, scoped, searched, stack }: { label: string; total: number; shown: number; narrowed: boolean; scoped: GenImage[]; searched: GenImage[]; stack?: Stack }) {
  const rowH = usePrefs((s) => s.galleryRowH)
  const trash = useGalleryUi((s) => s.scope === 'trash')
  const rightOpen = usePrefs((s) => s.galleryRightOpen)
  const namer = useGalleryNamer()
  const empty = scoped.length === 0
  const controls = (
    <div className="ml-auto flex min-w-0 flex-wrap items-center justify-end gap-3">
      <GallerySort />
      <ViewButton />
      <Tip label="缩略图大小（Ctrl+滚轮）">
        <div className="flex h-7 w-24 items-center px-1" data-testid="gallery-size">
          <Slider min={ROW_MIN} max={ROW_MAX} step={4} value={[rowH]} onValueChange={([v]) => usePrefs.getState().set({ galleryRowH: v })} aria-label="缩略图大小" />
        </div>
      </Tip>
      <SearchBox scoped={scoped} />
    </div>
  )
  return (
    <header className={cn('app-drag flex flex-col gap-3 pt-5 pb-3 pl-6', rightOpen ? 'pr-6' : RIGHT_EDGE_PR)} data-testid="gallery-header">
      <div className={cn('flex min-h-7 min-w-0 items-center', empty ? 'flex-wrap gap-x-4 gap-y-3' : 'gap-3')}>
        {stack ? (
          <div className="flex min-w-0 items-center gap-1" data-testid="gallery-crumbs">
            <Button variant="ghost" size="sm" className="-ml-2 h-7 shrink-0 gap-1 px-2 text-[13px] text-ink-2" onClick={() => useGalleryUi.getState().set({ inStack: null })} data-testid="gallery-stack-back">
              <Icon icon={ArrowLeft01Icon} size={14} />
              {label}
            </Button>
            <Icon icon={ArrowRight01Icon} size={14} className="shrink-0 text-ink-3" />
            <h1 className="ml-1 truncate text-[17px] font-semibold text-ink-1" data-testid="gallery-title">
              {namer.stack(stack.items, stack.cover)}
            </h1>
            <span className="ml-1 shrink-0 text-[12px] text-ink-2 tabular-nums" data-testid="gallery-count">
              {stack.items.length} 张
            </span>
          </div>
        ) : (
          <div className="flex min-w-0 items-baseline gap-3">
            <h1 className="truncate text-[17px] font-semibold text-ink-1" data-testid="gallery-title">
              {label}
            </h1>
            <span className="shrink-0 text-[12px] text-ink-2 tabular-nums" data-testid="gallery-count">
              {narrowed ? `${shown} / ${total}` : total} 张
            </span>
          </div>
        )}
        {trash && total > 0 && (
          <Button variant="outline" size="sm" className="ml-auto h-7 gap-1 text-[12px] text-ink-2" onClick={() => void emptyTrash()} data-testid="gallery-empty-trash">
            <Icon icon={Delete02Icon} size={14} />
            清空回收站
          </Button>
        )}
        {empty && controls}
      </div>
      {!empty && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
          <div className="flex min-w-0 flex-[1_1_auto] items-center">
            <FilterPills searched={searched} />
          </div>
          {controls}
        </div>
      )}
    </header>
  )
}

function GallerySort() {
  const by = usePrefs((s) => s.gallerySortBy)
  const dir = usePrefs((s) => s.gallerySortDir)
  const set = usePrefs((s) => s.set)
  return (
    <SortControl
      by={by}
      options={['time', 'name', 'tags'] as const}
      labels={SORT_LABEL}
      desc={dir === 'desc'}
      dirLabel={dirLabel(by, dir)}
      onBy={(v) => set({ gallerySortBy: v, gallerySortDir: SORT_DEFAULT_DIR[v] })}
      onFlip={() => set({ gallerySortDir: dir === 'desc' ? 'asc' : 'desc' })}
      testId="gallery"
    />
  )
}

function ViewButton() {
  const stack = usePrefs((s) => s.galleryStack)
  const near = usePrefs((s) => s.galleryNear)
  const names = usePrefs((s) => s.galleryNames)
  const set = usePrefs((s) => s.set)
  const [open, setOpen] = useState(false)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tip label="视图">
        <PopoverTrigger asChild>
          <Button variant="outline" size="icon" className={cn('size-7 text-ink-2', open && 'bg-surface-2 text-ink-1')} aria-label="视图" data-testid="gallery-view-button">
            <Icon icon={LayoutGridIcon} size={16} />
          </Button>
        </PopoverTrigger>
      </Tip>
      <PopoverContent align="end" className="w-64 p-1.5" data-testid="gallery-view-pop">
        <SwitchRow label="叠放图片" tip="同一版本的图片叠为一组" checked={stack} onChange={(v) => set({ galleryStack: v })} testId="gallery-stack-switch" />
        <SwitchRow label="包含相近版本" tip="相邻版本只增删少量 tag 时也叠为一组" checked={stack && near} disabled={!stack} onChange={(v) => set({ galleryNear: v })} testId="gallery-near-switch" />
        <div className="mx-1 my-1 border-t border-line" />
        <SwitchRow label="显示名称" tip="在每张图片下方显示名称" checked={names} onChange={(v) => set({ galleryNames: v })} testId="gallery-names-switch" />
      </PopoverContent>
    </Popover>
  )
}

function SwitchRow({ label, tip, checked, disabled, onChange, testId }: { label: string; tip: string; checked: boolean; disabled?: boolean; onChange: (v: boolean) => void; testId: string }) {
  return (
    <Tip label={tip} side="left">
      <label className={cn('flex h-8 cursor-default items-center gap-2 rounded-[4px] px-2 text-[13px] text-ink-1 hover:bg-surface-2', disabled && 'pointer-events-none text-ink-3')}>
        <span className="flex-1">{label}</span>
        <Switch checked={checked} disabled={disabled} onCheckedChange={onChange} data-testid={testId} />
      </label>
    </Tip>
  )
}

type Pick = { value: string; zh?: string; count: number }
const NO_NAMES: string[] = []

function lastWord(q: string): { head: string; neg: boolean; word: string } {
  const at = q.search(/\S*$/)
  const raw = q.slice(at)
  const neg = raw.startsWith('-')
  return { head: q.slice(0, at), neg, word: (neg ? raw.slice(1) : raw).replace(/_/g, ' ').toLowerCase() }
}

const zhOf = (literal: string) => {
  const p = parsePrompt(literal)[0]
  return p ? chipZh(toChip(p)) : undefined
}

function SearchBox({ scoped }: { scoped: GenImage[] }) {
  const query = useGalleryUi((s) => s.query)
  const recent = useMarks((s) => s.recent)
  const [focus, setFocus] = useState(false)
  const [hiFor, setHiFor] = useState({ q: '', i: -1 })
  const hi = hiFor.q === query ? hiFor.i : -1
  const setHi = (f: (i: number) => number) => setHiFor({ q: query, i: f(hi) })
  const input = useRef<HTMLInputElement>(null)
  const { head, neg, word } = lastWord(query)

  const counts = useMemo(() => (focus ? new Map(countValues(scoped.map((img) => [...factsFor(img).tags, ...factsFor(img).artists.map((a) => `artist:${a}`)]))) : null), [focus, scoped])
  const [libFor, setLibFor] = useState<{ word: string; names: string[] }>({ word: '', names: [] })
  useEffect(() => {
    if (!word || !counts) return
    let live = true
    void searchTags(word, 24).then((r) => live && setLibFor({ word, names: r.map((s) => s.tag.name.toLowerCase()) }))
    return () => {
      live = false
    }
  }, [word, counts])
  const lib = libFor.word === word ? libFor.names : NO_NAMES
  const picks: Pick[] = useMemo(() => {
    if (!word || !counts) return []
    const out = new Map<string, Pick>()
    for (const n of [...lib, ...lib.map((x) => `artist:${x}`)]) if (counts.has(n)) out.set(n, { value: n, count: counts.get(n)! })
    for (const [n, c] of counts) {
      if (out.size >= 8) break
      if (!out.has(n) && hasWord(n, word)) out.set(n, { value: n, count: c })
    }
    return [...out.values()].slice(0, 8).map((p) => ({ ...p, zh: zhOf(p.value) }))
  }, [word, counts, lib])

  const rows = query.trim() ? picks.map((p) => ({ kind: 'pick' as const, ...p })) : recent.map((r) => ({ kind: 'recent' as const, value: r }))
  const open = focus && rows.length > 0

  const set = (q: string) => useGalleryUi.getState().set({ query: q })
  const choose = (row: (typeof rows)[number]) => {
    if (row.kind === 'recent') set(row.value)
    else set(`${head}${neg ? '-' : ''}${row.value.replace(/ /g, '_')} `)
    input.current?.focus()
  }
  return (
    <Popover open={open}>
      <PopoverAnchor asChild>
        <div className="relative w-60 min-w-40 shrink">
          <Icon icon={Search01Icon} size={14} className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-ink-3" />
          <Input
            ref={input}
            className="pr-7 pl-8"
            placeholder="搜索名称或 prompt"
            value={query}
            onChange={(e) => set(e.target.value)}
            onFocus={() => setFocus(true)}
            onBlur={() => {
              setFocus(false)
              rememberSearch(query)
            }}
            onKeyDown={(e) => {
              if (open && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
                e.preventDefault()
                setHi((h) => (e.key === 'ArrowDown' ? (h + 1) % rows.length : h <= 0 ? rows.length - 1 : h - 1))
              } else if ((e.key === 'Enter' || e.key === 'Tab') && open && hi >= 0) {
                e.preventDefault()
                choose(rows[hi])
              } else if (e.key === 'Enter') {
                rememberSearch(query)
                e.currentTarget.blur()
              } else if (e.key === 'Escape') {
                set('')
                e.currentTarget.blur()
              }
            }}
            data-testid="gallery-search"
          />
          {query && (
            <button type="button" className="absolute top-1/2 right-2 grid size-4 -translate-y-1/2 place-items-center rounded-sm text-ink-2 hover:text-ink-1" onClick={() => set('')} aria-label="清空搜索">
              <Icon icon={Cancel01Icon} size={14} />
            </button>
          )}
        </div>
      </PopoverAnchor>
      <PopoverContent align="end" className="w-72 p-1" onOpenAutoFocus={(e) => e.preventDefault()} onMouseDown={(e) => e.preventDefault()} data-testid="gallery-search-menu">
        {!query.trim() && <div className="px-2 pt-1 pb-1 text-[11px] text-ink-3">最近搜索</div>}
        {rows.map((row, i) => (
          <div
            key={row.value}
            role="option"
            aria-selected={i === hi}
            className={cn('group flex h-7 cursor-default items-center gap-2 rounded-[4px] px-2 text-[13px] text-ink-1', i === hi ? 'bg-surface-2' : 'hover:bg-surface-2')}
            onClick={() => choose(row)}
            data-testid={row.kind === 'recent' ? 'gallery-recent' : 'gallery-suggest'}
          >
            {row.kind === 'recent' ? (
              <>
                <Icon icon={Clock01Icon} size={14} className="shrink-0 text-ink-2" />
                <span className="flex-1 truncate">{row.value}</span>
                <button
                  type="button"
                  className="grid size-5 place-items-center rounded-sm text-ink-2 opacity-0 transition-opacity duration-(--dur-fast) group-hover:opacity-100 hover:bg-surface-3 hover:text-ink-1"
                  onClick={(e) => (e.stopPropagation(), forgetSearch(row.value))}
                  aria-label="移除"
                  data-testid="gallery-recent-remove"
                >
                  <Icon icon={Cancel01Icon} size={14} />
                </button>
              </>
            ) : (
              <>
                <TagName en={row.value} zh={row.zh} className="min-w-0 flex-1 truncate" />
                <span className="text-[11px] text-ink-2 tabular-nums">{row.count}</span>
              </>
            )}
          </div>
        ))}
      </PopoverContent>
    </Popover>
  )
}
