import { Command as CommandPrimitive } from 'cmdk'
import { Fragment, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { CommandItem, CommandList } from '@/components/ui/command'
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover'
import { looksLikePromptString } from '@/lib/nai'
import { SUGGEST_MAX, SUGGEST_PAGE, pageCount, pageKey, pageMove, pageOf } from '@/lib/suggest-paging'
import { TagName } from '@/components/tag-name'
import { countLabel, searchTags, type Suggestion } from '@/lib/tagdb'
import type { TagEntry } from '@/types'

const VIA_LABEL: Record<Suggestion['via'], string | null> = {
  name: null,
  alias: '别名',
  zh: null,
  pinyin: '拼音',
  fuzzy: '近似',
}

export interface TagSuggestState {
  searching: boolean
  results: Suggestion[]
  selected: string
  setSelected(v: string): void
  pick(name?: string): TagEntry | undefined
  enterPick(): TagEntry | undefined
  enterPickLatest(): TagEntry | undefined | Promise<TagEntry | undefined>
  pickLatest(): TagEntry | undefined | Promise<TagEntry | undefined>
  markNav(): void
}

export function useTagSuggest(query: string, exclude?: string, only?: (t: TagEntry) => boolean): TagSuggestState {
  const [results, setResults] = useState<Suggestion[]>([])
  const [resultsFor, setResultsFor] = useState('')
  const [selected, setSelected] = useState('')
  const [navAt, setNavAt] = useState<string | null>(null)
  const q = query.trim()
  const searching = !!q && !looksLikePromptString(q)

  const search = (text: string) =>
    searchTags(text, only ? SUGGEST_MAX * 6 : SUGGEST_MAX + (exclude ? 1 : 0)).then((r) => {
      const out = exclude ? r.filter((x) => x.tag.name !== exclude) : r
      return (only ? out.filter((x) => only(x.tag)) : out).slice(0, SUGGEST_MAX)
    })

  useEffect(() => {
    if (!searching) return
    let alive = true
    search(q).then((r) => {
      if (!alive) return
      setResults(r)
      setResultsFor(q)
      setSelected(r[0]?.tag.name ?? '')
    })
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, searching, exclude])

  const pick = (name = selected) => (searching ? results.find((r) => r.tag.name === name)?.tag : undefined)
  const typed = q.toLowerCase().replace(/_/g, ' ').replace(/^artist:\s*/, '')
  const enterPick = () => {
    const tag = pick()
    if (!tag) return undefined
    if (navAt === q) return tag
    return resultsFor === q && tag.name.startsWith(typed) ? tag : undefined
  }
  return {
    searching,
    results: searching ? results : [],
    selected,
    setSelected,
    pick,
    enterPick,
    enterPickLatest: () => {
      if (!searching || navAt === q || resultsFor === q) return enterPick()
      return search(q).then((r) => {
        const tag = r[0]?.tag
        return tag && tag.name.startsWith(typed) ? tag : undefined
      })
    },
    pickLatest: () => {
      if (!searching) return undefined
      if (navAt === q || resultsFor === q) return pick()
      return search(q).then((r) => r[0]?.tag)
    },
    markNav: () => setNavAt(q),
  }
}

interface Props {
  s: TagSuggestState
  open: boolean
  onPick(tag: TagEntry): void
  idle?: ReactNode
  hints: ReactNode
  children: ReactNode
  isolate?: boolean
  extra?: { value: string; node: ReactNode }[]
  contentClassName?: string
  sideOffset?: number
  testId?: string
}

type Row = { value: string; hit?: Suggestion; node?: ReactNode }

export function TagSuggest({ s, open, onPick, idle, hints, children, isolate, extra = [], contentClassName = 'w-80', sideOffset = 6, testId = 'tag-suggest' }: Props) {
  const hits: Row[] = s.searching ? s.results.map((hit) => ({ value: hit.tag.name, hit })) : []
  const rows: Row[] = s.searching ? [...hits.slice(0, SUGGEST_PAGE), ...extra, ...hits.slice(SUGGEST_PAGE)] : []
  const show = open && (s.searching ? rows.length > 0 : !!idle)
  const index = rows.findIndex((r) => r.value === s.selected)
  const page = pageOf(index)
  const pages = pageCount(rows.length)
  const shown = rows.slice(page * SUGGEST_PAGE, (page + 1) * SUGGEST_PAGE)
  const go = (to: number | null) => {
    if (to === null) return false
    s.markNav()
    s.setSelected(rows[to].value)
    return true
  }

  const list = useRef<HTMLDivElement>(null)
  const fullH = useRef(0)
  useLayoutEffect(() => {
    const el = list.current
    if (!el) return
    el.style.minHeight = ''
    if (shown.length === SUGGEST_PAGE) fullH.current = el.offsetHeight
    if (pages > 1 && fullH.current) el.style.minHeight = `${fullH.current}px`
  })

  // React wheel listeners are passive; use a native listener to prevent scrolling while paging suggestions.
  const [pop, setPop] = useState<HTMLDivElement | null>(null)
  const turn = useRef<(dir: 1 | -1) => void>(() => {})
  useLayoutEffect(() => {
    turn.current = (dir) => void go(pageMove(index, rows.length, dir > 0 ? 'pageDown' : 'pageUp'))
  })
  useEffect(() => {
    if (!pop) return
    let acc = 0
    const onWheel = (e: WheelEvent) => {
      if (!pop.querySelector('[cmdk-list]')) return
      e.preventDefault()
      const d = (e.deltaY || e.deltaX) * (e.deltaMode === 1 ? 40 : 1)
      if (!d) return
      if (Math.sign(d) !== Math.sign(acc)) acc = 0
      acc += d
      if (Math.abs(acc) < 40) return
      turn.current(acc > 0 ? 1 : -1)
      acc = 0
    }
    pop.addEventListener('wheel', onWheel, { passive: false })
    return () => pop.removeEventListener('wheel', onWheel)
  }, [pop])

  return (
    <CommandPrimitive
      shouldFilter={false}
      value={s.selected}
      onValueChange={s.setSelected}
      loop
      className="contents"
      // cmdk handles arrows after this callback; preventDefault skips its move, while stopPropagation alone does not skip its local handler.
      onKeyDown={(e) => {
        const key = pageKey(e.key)
        if (key === 'down' || key === 'up') s.markNav()
        if (key && show && s.searching && !e.altKey && !e.ctrlKey && !e.metaKey && !e.nativeEvent.isComposing) {
          if (go(pageMove(index, rows.length, key)) || key === 'pageDown' || key === 'pageUp') e.preventDefault()
        }
        if (isolate) e.stopPropagation()
      }}
    >
      <Popover open={show}>
        <PopoverAnchor asChild>{children}</PopoverAnchor>
        <PopoverContent
          ref={setPop}
          align="start"
          sideOffset={sideOffset}
          className={`${contentClassName} gap-0 p-1`}
          onOpenAutoFocus={(e) => e.preventDefault()}
          onCloseAutoFocus={(e) => e.preventDefault()}
          onMouseDown={(e) => e.preventDefault() }
          data-testid={testId}
        >
          {s.searching ? (
            <CommandList ref={list} className="max-h-none">
              <div key={page} className="animate-in fade-in-40 duration-150 motion-reduce:animate-none" data-page={page + 1}>
                {shown.map((r) =>
                  r.hit ? (
                    <CommandItem key={r.value} value={r.value} onSelect={(v) => onPick(s.pick(v) ?? r.hit!.tag)} className="gap-2 [&>svg:last-child]:hidden">
                      <TagName en={r.hit.tag.name} zh={r.hit.tag.zh} className="min-w-0" />
                      <span className="ml-auto flex shrink-0 items-center gap-1.5">
                        {r.hit.tag.category === 'artist' && <span className="rounded bg-surface-2 px-1 text-[11px] text-ink-2">画师</span>}
                        {VIA_LABEL[r.hit.via] && <span className="rounded bg-surface-2 px-1 text-[11px] text-ink-2">{VIA_LABEL[r.hit.via]}</span>}
                        <span className="text-[11px] text-ink-2 tabular-nums">{countLabel(r.hit.tag)}</span>
                      </span>
                    </CommandItem>
                  ) : (
                    <Fragment key={r.value}>{r.node}</Fragment>
                  ),
                )}
              </div>
            </CommandList>
          ) : (
            idle
          )}
          <div className="flex flex-wrap gap-x-3 border-t border-line px-2 pt-1.5 pb-1 text-[11px] text-ink-2 *:whitespace-nowrap">
            {hints}
            {s.searching && pages > 1 && (
              <span className="ml-auto tabular-nums" data-testid="suggest-page">
                {page + 1} / {pages}
              </span>
            )}
          </div>
        </PopoverContent>
      </Popover>
    </CommandPrimitive>
  )
}
