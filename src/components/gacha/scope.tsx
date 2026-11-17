import { useEffect, useRef, useState, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { toast } from 'sonner'
import { Album02Icon, ArrowDown01Icon, ArrowRight01Icon, Cancel01Icon, Search01Icon, StarIcon } from '@hugeicons/core-free-icons'
import { sectionVars } from '@/components/editor/labels'
import { TagSuggest, useTagSuggest } from '@/components/editor/tag-suggest'
import { isSuggestKey } from '@/lib/suggest-paging'
import { Icon } from '@/components/icon'
import { Seg } from '@/components/seg'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { canonGender, charsOfWork, useCharWorks } from '@/lib/char-works'
import {
  addPicked,
  addSources,
  ARTIST_MIN_OPTIONS,
  ARTIST_TOP_OPTIONS,
  artistAlgoOf,
  artistTopOf,
  CHAR_MIN_OPTIONS,
  DEFAULT_ARTIST_SOURCE,
  DEFAULT_ARTIST_TOP,
  DEFAULT_MIN_COUNT,
  removePicked,
  removeSource,
  withContent,
  type GachaPool,
  type PoolSource,
} from '@/lib/gacha'
import { ARTIST_ALGO_LABEL, ARTIST_ALGOS, type ArtistAlgo } from '@/lib/artist-rank'
import { parseNodeText } from '@/lib/lists'
import { looksLikePromptString } from '@/lib/nai'
import { cn } from '@/lib/utils'
import { FAV_COLLECTION, useLibrary } from '@/store/library'
import { useLists } from '@/store/lists'
import type { SectionColor, TagEntry } from '@/types'
import { AddCategoryDialog, AddWorksDialog } from './add-dialogs'
import { RuleChip } from './controls'
import { artistMin, charMin, fmtN, resolveLiveSource, sameSource, sourceName, sourceTag } from './data'

const minLabels = (opts: readonly number[]) => Object.fromEntries(opts.map((n) => [String(n), n ? `≥${n}` : '全部'])) as Record<string, string>
const ARTIST_MIN_LABEL = minLabels(ARTIST_MIN_OPTIONS)
const CHAR_MIN_LABEL = minLabels(CHAR_MIN_OPTIONS)
/** Prefix numeric option keys because JavaScript enumerates integer keys numerically rather than in insertion order. */
const ARTIST_TOP_LABEL = Object.fromEntries(ARTIST_TOP_OPTIONS.map((n) => [`t${n}`, n ? `前 ${n}` : '全部'])) as Record<string, string>
type ArtistsSource = Extract<PoolSource, { kind: 'artists' }>
function withAlgo(s: ArtistsSource, algo: ArtistAlgo): ArtistsSource {
  const all = artistAlgoOf(s) === 'count' ? artistMin(s) === 0 : artistTopOf(s) === 0
  return algo === 'count' ? { kind: 'artists', minCount: all ? 0 : DEFAULT_MIN_COUNT } : { kind: 'artists', by: algo, top: all ? 0 : DEFAULT_ARTIST_TOP }
}

function AlgoMenu({ value, onChange }: { value: ArtistAlgo; onChange: (a: ArtistAlgo) => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex h-6 shrink-0 items-center gap-0.5 rounded-md pr-0.5 pl-1.5 text-[12px] text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink-1 data-[state=open]:bg-surface-2 data-[state=open]:text-ink-1"
          data-testid="scope-algo"
        >
          {ARTIST_ALGO_LABEL[value]}
          <Icon icon={ArrowDown01Icon} size={12} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-32" data-testid="scope-algo-menu">
        <DropdownMenuRadioGroup value={value} onValueChange={(v) => onChange(v as ArtistAlgo)}>
          {ARTIST_ALGOS.map((a) => (
            <DropdownMenuRadioItem key={a} value={a} className="text-[13px]" data-testid={`scope-algo-${a}`}>
              {ARTIST_ALGO_LABEL[a]}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
const isCharEntry = (t: TagEntry) => t.category === 'character'
const isArtistEntry = (t: TagEntry) => t.category === 'artist'

const CollIcon = ({ id }: { id: string }) =>
  id === FAV_COLLECTION ? <Icon icon={StarIcon} size={14} className="shrink-0 text-(--fav)" /> : <Icon icon={Album02Icon} size={14} className="shrink-0 text-ink-2" />

const BATCH = 600
function ChipList({ tags, render }: { tags: readonly string[]; render: (t: string) => ReactNode }) {
  const [limit, setLimit] = useState(BATCH)
  const more = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    const el = more.current
    if (!el) return
    const io = new IntersectionObserver((es) => es.some((e) => e.isIntersecting) && setLimit((l) => l + BATCH), { rootMargin: '600px' })
    io.observe(el)
    return () => io.disconnect()
  }, [limit, tags.length])
  return (
    <>
      {tags.slice(0, limit).map(render)}
      {limit < tags.length && <span ref={more} className="h-px w-full" aria-hidden data-testid="scope-chips-more" />}
    </>
  )
}

function Sub({ title, n, right }: { title: string; n: number; right?: ReactNode }) {
  return (
    <div className="mt-3.5 mb-2 flex items-center gap-2">
      <span className="text-[12px] font-semibold text-ink-2">{title}</span>
      <span className="text-[11px] text-ink-2">{n}</span>
      <span className="h-px flex-1 bg-line" />
      {right}
    </div>
  )
}

export interface ScopeProps {
  pool: GachaPool
  color: SectionColor
  off: readonly string[]
  onPool: (next: GachaPool) => void
  onOff: (next: string[]) => void
  undo: () => void
}

export function Scope({ pool: p, color, off: excluded, onPool, onOff, undo }: ScopeProps) {
  useCharWorks()
  const lists = useLists((s) => s.lists)
  const colls = useLibrary((s) => s.artistCollections)
  const [open, setOpen] = useState<Set<number>>(new Set())
  const [mounted, setMounted] = useState<Set<number>>(new Set())
  const [adding, setAdding] = useState(false)
  const off = new Set(excluded)
  const offN = p.tags.filter((t) => off.has(t)).length
  const isChar = p.kind === 'char'
  const unit = p.kind === 'artist' ? '位' : '个'
  const toggleOff = (t: string) => onOff(off.has(t) ? excluded.filter((x) => x !== t) : [...excluded, t])
  const toggleOpen = (i: number) => {
    setOpen((s) => (s.has(i) ? new Set([...s].filter((x) => x !== i)) : new Set([...s, i])))
    setMounted((s) => new Set([...s, i]))
  }
  const settle = (i: number) => !open.has(i) && setMounted((s) => new Set([...s].filter((x) => x !== i)))
  const removeSrc = (i: number) => {
    onPool(removeSource(p, i))
    setOpen(new Set())
    setMounted(new Set())
    toast(`已移除「${sourceName(p.source[i], lists)}」`, { action: { label: '撤销', onClick: undo } })
  }
  const addLive = (s: PoolSource) => onPool(addSources(p, [{ source: s, tags: resolveLiveSource(s) ?? [] }], sameSource))
  const setMin = (i: number, s: PoolSource) => onPool(withContent(p, { source: p.source.map((x, k) => (k === i ? s : x)), sourceTags: (p.sourceTags ?? []).map((x, k) => (k === i ? (resolveLiveSource(s) ?? []) : x)) }))
  const has = (kind: PoolSource['kind']) => p.source.some((s) => s.kind === kind)
  const addBtn =
    p.kind === 'artist' ? (
      <>
        {!has('artists') && (
          <Button variant="outline" size="sm" onClick={() => addLive(DEFAULT_ARTIST_SOURCE)} data-testid="scope-add-artists">
            + 画师库
          </Button>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" data-testid="scope-add-coll">
              + 画师库合集
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-[240px]" data-testid="scope-coll-menu">
            {colls.map((col) => {
              const added = p.source.some((s) => s.kind === 'artistColl' && s.coll === col.id)
              return (
                <DropdownMenuItem key={col.id} disabled={added} onSelect={() => addLive({ kind: 'artistColl', coll: col.id })} data-testid="scope-coll-opt" data-coll={col.id}>
                  <CollIcon id={col.id} />
                  <span className="truncate">{col.title}</span>
                  <span className="ml-auto shrink-0 text-[11px] text-ink-2 tabular-nums">
                    {col.items.length} 位{added ? ' · 已加' : ''}
                  </span>
                </DropdownMenuItem>
              )
            })}
          </DropdownMenuContent>
        </DropdownMenu>
      </>
    ) : (
      <>
        {isChar && !has('chars') && (
          <Button variant="outline" size="sm" onClick={() => addLive({ kind: 'chars', minCount: 0 })} data-testid="scope-add-chars">
            + 角色库
          </Button>
        )}
        <Button variant="outline" size="sm" onClick={() => setAdding(true)} data-testid="scope-add-source">
          {isChar ? '+ 添加作品' : '+ 添加分类'}
        </Button>
      </>
    )
  return (
    <div data-testid="scope">
      <div className="flex items-center gap-3">
        <div className="flex-1 text-[13px] font-semibold text-ink-1">范围</div>
        <span className="text-[12px] text-ink-2" data-testid="scope-total">
          共 <b className="font-semibold text-ink-1">{fmtN(p.tags.length - offN)}</b> {unit}
        </span>
      </div>
      <Sub title={p.kind === 'tag' ? '分类' : '来源'} n={p.source.length} right={addBtn} />
      <div className="flex flex-col gap-1.5">
        {p.source.map((s, i) => {
          const tags = p.sourceTags?.[i] ?? []
          const sOff = tags.filter((t) => off.has(t)).length
          const isOpen = open.has(i)
          const pre = sourceTag(s)
          const tier = s.kind === 'artists' || s.kind === 'chars'
          return (
            <div key={i} className="rounded-lg border border-line" data-testid="scope-source" data-kind={s.kind}>
              <div className="flex h-9 cursor-pointer items-center gap-2 pr-1 pl-2.5 text-[13px]" onClick={() => toggleOpen(i)} role="button" aria-expanded={isOpen} data-testid="scope-source-head">
                <Icon icon={isOpen ? ArrowDown01Icon : ArrowRight01Icon} size={14} className="shrink-0 text-ink-2" />
                {pre && <span className="shrink-0 text-[11px] text-ink-2">{pre}</span>}
                {s.kind === 'artistColl' && <CollIcon id={s.coll} />}
                <span className="min-w-0 truncate font-medium text-ink-1">{s.kind === 'artists' ? '画师库' : s.kind === 'chars' ? '角色库' : sourceName(s, lists)}</span>
                <span className="shrink-0 text-[11px] text-ink-2" data-testid="scope-source-n">
                  {fmtN(tags.length - sOff)} {unit}
                </span>
                {s.kind === 'artists' && (
                  <span className="ml-auto flex shrink-0" onClick={(e) => e.stopPropagation()}>
                    <AlgoMenu value={artistAlgoOf(s)} onChange={(a) => setMin(i, withAlgo(s, a))} />
                  </span>
                )}
                <button
                  type="button"
                  className={cn('grid size-6 shrink-0 place-items-center rounded-md text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink-1', s.kind !== 'artists' && 'ml-auto')}
                  onClick={(e) => (e.stopPropagation(), removeSrc(i))}
                  aria-label={`移除 ${sourceName(s, lists)}`}
                  data-testid="scope-source-remove"
                >
                  <Icon icon={Cancel01Icon} size={14} />
                </button>
              </div>
              {tier && (
                <div className="flex items-center gap-2 pr-2 pb-2 pl-2.5" onClick={(e) => e.stopPropagation()}>
                  {s.kind === 'chars' && <span className="shrink-0 text-[12px] text-ink-2">作品数</span>}
                  {s.kind === 'artists' && artistAlgoOf(s) !== 'count' ? (
                    <Seg value={`t${artistTopOf(s)}`} onChange={(v) => setMin(i, { kind: 'artists', by: s.by, top: Number(v.slice(1)) })} options={ARTIST_TOP_LABEL} testId="scope-top" />
                  ) : s.kind === 'artists' ? (
                    <Seg value={String(artistMin(s))} onChange={(v) => setMin(i, { kind: 'artists', minCount: Number(v) })} options={ARTIST_MIN_LABEL} testId="scope-min" />
                  ) : s.kind === 'chars' ? (
                    <Seg value={String(charMin(s))} onChange={(v) => setMin(i, { kind: 'chars', minCount: Number(v) })} options={CHAR_MIN_LABEL} testId="scope-min" />
                  ) : null}
                </div>
              )}
              <div className="grid transition-[grid-template-rows] duration-200" style={{ gridTemplateRows: isOpen ? '1fr' : '0fr' }} onTransitionEnd={(e) => e.target === e.currentTarget && settle(i)}>
                <div className="min-h-0 overflow-hidden">
                  {(isOpen || mounted.has(i)) && (
                    <div className="flex max-h-[320px] flex-wrap gap-x-(--chip-gap-x) gap-y-(--chip-gap-y) overflow-auto px-2.5 pt-0.5 pb-3" style={sectionVars(color)} data-testid="scope-source-chips">
                      <ChipList tags={tags} render={(t) => <RuleChip key={t} pool={p} tag={t} off={off.has(t)} gender={isChar ? canonGender(t) : undefined} onToggle={() => toggleOff(t)} />} />
                      {!tags.length && (
                        <span className="text-[12px] text-ink-2">
                          {s.kind === 'work'
                            ? '此作品中没有作品数达标的角色'
                            : s.kind === 'artistColl'
                              ? colls.some((x) => x.id === s.coll)
                                ? '此合集为空，请在画师库中添加画师'
                                : '画师库中已无此合集'
                              : tier
                                ? '加载中…'
                                : '此分类中暂无 tag'}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )
        })}
        {!p.source.length && (
          <span className="text-[12px] text-ink-2" data-testid="scope-empty">
            {isChar ? '暂无来源。点击「+ 添加作品」添加整部作品' : p.kind === 'artist' ? '无来源：仅从下方单独选择的画师中抽取' : '暂无分类。点击「+ 添加分类」添加整个分类'}
          </span>
        )}
      </div>
      <Sub title={isChar ? '单独选择的角色' : p.kind === 'artist' ? '单独选择的画师' : '单独选择的 tag'} n={p.picked?.length ?? 0} />
      <div className="flex flex-wrap items-center gap-x-(--chip-gap-x) gap-y-(--chip-gap-y)" style={sectionVars(color)} data-testid="scope-picked">
        {(p.picked ?? []).map((t) => (
          <RuleChip key={t} pool={p} tag={t} gender={isChar ? canonGender(t) : undefined} onRemove={() => onPool(removePicked(p, t))} />
        ))}
        <PickInput p={p} off={excluded} onPool={onPool} onOff={onOff} />
      </div>
      {isChar ? <AddWorksDialog open={adding} onOpenChange={setAdding} p={p} onChange={onPool} /> : <AddCategoryDialog open={adding} onOpenChange={setAdding} p={p} onChange={onPool} />}
    </div>
  )
}

function PickInput({ p, off, onPool, onOff }: { p: GachaPool; off: readonly string[]; onPool: (next: GachaPool) => void; onOff: (next: string[]) => void }) {
  const [q, setQ] = useState('')
  const [focused, setFocused] = useState(false)
  const isChar = p.kind === 'char'
  const s = useTagSuggest(q, undefined, isChar ? isCharEntry : p.kind === 'artist' ? isArtistEntry : undefined)
  const composing = useRef(false)
  const open = focused && s.searching && s.results.length > 0
  const lists = useLists((x) => x.lists)
  const add = (names: string[]) => {
    const clean = names.map((n) => (p.kind === 'artist' ? n.replace(/^artist:/i, '') : n).trim()).filter(Boolean)
    setQ('')
    if (!clean.length) return
    const r = addPicked(p, clean)
    if (r.added.length) onPool(r.pool)
    if (r.inSource.length) {
      const lit = r.inSource.filter((t) => off.includes(t))
      if (lit.length) onOff(off.filter((t) => !lit.includes(t)))
      const where = (t: string) => {
        const i = (p.sourceTags ?? []).findIndex((l) => l.includes(t))
        return i >= 0 ? sourceName(p.source[i], lists) : ''
      }
      toast(
        r.inSource.length === 1
          ? `「${r.inSource[0]}」已在「${where(r.inSource[0])}」中${lit.length ? '，已恢复' : '，不重复添加'}`
          : `${r.inSource.length} 个已在来源中，不重复添加${lit.length ? `（已恢复 ${lit.length} 个）` : ''}`,
      )
    } else if (r.dup.length && !r.added.length) toast(r.dup.length === 1 ? `「${r.dup[0]}」已选择` : '均已选择')
  }
  const addRaw = () => add(parseNodeText(q))
  const accept = (tag?: TagEntry) => (tag ? add([tag.name]) : isChar ? undefined : addRaw())
  const confirm = () => {
    if (!q.trim()) return
    if (!s.searching) return isChar ? undefined : addRaw()
    const r = s.enterPickLatest()
    if (r instanceof Promise) r.then(accept)
    else accept(r)
  }
  return (
    <TagSuggest
      s={s}
      open={focused}
      isolate
      onPick={(tag) => accept(tag)}
      hints={
        <>
          <span>Tab / ↓ 选择候选</span>
          <span>{isChar ? '↵ 添加此角色' : '↵ 补全英文，否则保留原文'}</span>
        </>
      }
    >
      <input
        className={cn('tag-input', isChar && 'min-w-[96px]')}
        placeholder={isChar ? '+ 角色' : p.kind === 'artist' ? '+ 画师' : '+ tag'}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onCompositionStart={() => (composing.current = true)}
        onCompositionEnd={() => (composing.current = false)}
        onPaste={(e) => {
          const text = e.clipboardData.getData('text')
          if (isChar || !looksLikePromptString(text)) return
          e.preventDefault()
          add(parseNodeText(text))
        }}
        onKeyDown={(e) => {
          if (composing.current || e.nativeEvent.isComposing) return
          if (!isSuggestKey(e.key)) e.stopPropagation()
          if (e.key === 'Enter') {
            e.preventDefault()
            if (e.shiftKey && !isChar) addRaw()
            else confirm()
          } else if (e.key === 'Tab' && open) {
            e.preventDefault()
            accept(s.pick())
          } else if ((e.key === ',' || e.key === '，') && !isChar) {
            e.preventDefault()
            confirm()
          } else if (e.key === 'Escape') {
            setQ('')
            ;(e.target as HTMLInputElement).blur()
          }
        }}
        data-testid="scope-pick-input"
      />
    </TagSuggest>
  )
}

const isWorkEntry = (t: TagEntry) => t.category === 'copyright' && charsOfWork(t.name).length > 0
const EASE = [0.2, 0, 0, 1] as const

export function CharWorks({ works, total, color, onChange }: { works: readonly string[]; total: number | null; color: SectionColor; onChange: (works: string[]) => void }) {
  return (
    <div className="flex flex-col gap-1.5" data-testid="random-works">
      <div className="flex min-h-[30px] items-center gap-3">
        <span className="shrink-0 text-[12px] font-medium text-ink-2">作品</span>
        <span className="ml-auto text-[12px] text-ink-2" data-testid="random-works-total">
          {!works.length && <span className="text-ink-2">全部作品 · </span>}
          <b className="font-semibold text-ink-1">{total === null ? '…' : fmtN(total)}</b> 个角色
        </span>
      </div>
      <AnimatePresence initial={false}>
        {works.length > 0 && (
          <motion.div
            key="chips"
            initial={{ height: 0, opacity: 0, overflow: 'hidden' }}
            animate={{ height: 'auto', opacity: 1, transitionEnd: { overflow: 'visible' } }}
            exit={{ height: 0, opacity: 0, overflow: 'hidden' }}
            transition={{ duration: 0.18, ease: EASE }}
          >
            <div className="flex flex-wrap gap-x-(--chip-gap-x) gap-y-(--chip-gap-y) pt-0.5 pb-1" style={sectionVars(color)} data-testid="random-works-chips">
              <AnimatePresence initial={false} mode="popLayout">
                {works.map((w) => (
                  <motion.span key={w} layout initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.9 }} transition={{ duration: 0.16, ease: EASE }} className="inline-flex">
                    <RuleChip pool={{ kind: 'tag' }} tag={w} onRemove={() => onChange(works.filter((x) => x !== w))} />
                  </motion.span>
                ))}
              </AnimatePresence>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      <WorkSearch works={works} onAdd={(w) => onChange([...works, w])} />
    </div>
  )
}

function WorkSearch({ works, onAdd }: { works: readonly string[]; onAdd: (work: string) => void }) {
  const [q, setQ] = useState('')
  const [focused, setFocused] = useState(false)
  const s = useTagSuggest(q, undefined, (t) => isWorkEntry(t) && !works.includes(t.name))
  const composing = useRef(false)
  const accept = (tag?: TagEntry) => {
    if (!tag) return
    setQ('')
    onAdd(tag.name)
  }
  const confirm = () => {
    const r = s.pickLatest()
    if (r instanceof Promise) r.then(accept)
    else accept(r)
  }
  return (
    <TagSuggest
      s={s}
      open={focused}
      onPick={accept}
      hints={
        <>
          <span>↑↓ 选择候选</span>
          <span>↵ 添加此作品</span>
        </>
      }
      contentClassName="w-(--radix-popover-trigger-width) min-w-64"
      sideOffset={4}
      testId="random-works-suggest"
    >
      <div className="flex h-7 items-center gap-1.5 rounded-md border border-line bg-surface-2/60 px-2 transition-colors focus-within:border-lamp-text">
        <Icon icon={Search01Icon} size={14} className="shrink-0 text-ink-3" />
        <input
          className="min-w-0 flex-1 bg-transparent text-[12px] text-ink-1 outline-none placeholder:text-ink-3"
          placeholder="搜索作品（中 / 英 / 拼音）"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onCompositionStart={() => (composing.current = true)}
          onCompositionEnd={() => (composing.current = false)}
          onKeyDown={(e) => {
            if (composing.current || e.nativeEvent.isComposing) return
            if (e.key === 'Enter') {
              e.preventDefault()
              if (s.searching) confirm()
            } else if (e.key === 'Tab' && s.searching && s.results.length) {
              e.preventDefault()
              accept(s.pick())
            } else if (e.key === 'Escape') {
              e.stopPropagation()
              setQ('')
              ;(e.target as HTMLInputElement).blur()
            }
          }}
          data-testid="random-works-search"
        />
      </div>
    </TagSuggest>
  )
}
