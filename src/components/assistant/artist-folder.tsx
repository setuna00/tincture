import { useDraggable } from '@dnd-kit/core'
import { useEffect, useMemo } from 'react'
import { create } from 'zustand'
import { Copy01Icon, PaintBoardIcon } from '@hugeicons/core-free-icons'
import { ArtistMedia, CollectionIcon } from '@/components/artist-media'
import { copyText } from '@/components/copy-button'
import { ChipFace, chipAttrs } from '@/components/editor/chip-face'
import { sectionVars } from '@/components/editor/labels'
import { Icon } from '@/components/icon'
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from '@/components/ui/context-menu'
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card'
import { loadArtistList, popScore, useArtistData, useArtistPopularity, useArtistPosts } from '@/lib/artist-db'
import { isPopAlgo } from '@/lib/artist-rank'
import { coverFirstPosts, type RatingMode } from '@/lib/danbooru-core'
import { formatCount } from '@/lib/tagdb'
import { cn } from '@/lib/utils'
import { openInArtistLibrary } from '@/store/artist-nav'
import { FAV_COLLECTION, useLibrary, type ArtistCollection } from '@/store/library'
import { usePrefs } from '@/store/prefs'
import type { Chip } from '@/types'
import { INDENT, LibFolderRow, nameHit } from './template-panel'

export const ARTIST_DRAG_PREFIX = 'art:'
/** dnd-kit requires unique IDs even when the same artist appears in multiple collections; include the collection scope. */
const artistDragId = (coll: string, name: string) => `${ARTIST_DRAG_PREFIX}${coll}|${name}`
export const artistFromDrag = (id: string) => id.slice(id.indexOf('|') + 1)

const ARTISTS_KEY = '@artists'
const collKey = (id: string) => `@artists/${id}`

interface ArtistItem {
  name: string
  count: number
  at: number
  score: number | null
}
interface ArtistGroup {
  c: ArtistCollection
  items: ArtistItem[]
}
export interface ArtistGroups {
  groups: ArtistGroup[]
  total: number
}

const hit = (name: string, q: string) => nameHit(name.replace(/_/g, ' '), q.replace(/_/g, ' '))

export function useArtistGroups(q: string): ArtistGroups | null {
  const collections = useLibrary((s) => s.artistCollections)
  const list = useArtistData((s) => s.list)
  const nsfw = usePrefs((s) => s.nsfw !== 'off')
  const sort = usePrefs((s) => s.artistSort)
  const pop = useArtistPopularity(isPopAlgo(sort.by))
  return useMemo(() => {
    const all = !q || nameHit('画师', q)
    const dir = sort.desc ? -1 : 1
    const mode = nsfw ? 'all' : 'sfw'
    const byPop = isPopAlgo(sort.by) && pop ? sort.by : null
    const scoreOf = (i: number | undefined, count: number) => (i === undefined ? null : byPop ? popScore(pop!, byPop, mode, i) : count)
    const groups = collections.flatMap((c): ArtistGroup[] => {
      const whole = all || hit(c.title, q)
      const items = c.items
        .flatMap((x): ArtistItem[] => {
          const i = list?.index.get(x.name)
          if (i !== undefined && !nsfw && list!.nsfwOnly.has(i)) return []
          if (!whole && !hit(x.name, q)) return []
          const count = i !== undefined ? list!.counts[i] : 0
          return [{ name: x.name, count, at: x.addedAt, score: scoreOf(i, count) }]
        })
        .sort(
          (a, b) =>
            (sort.by === 'name' || sort.by === 'added' ? 0 : Number(a.score === null) - Number(b.score === null)) ||
            (sort.by === 'name' ? (a.name < b.name ? -1 : a.name > b.name ? 1 : 0) : sort.by === 'added' ? a.at - b.at : (a.score ?? 0) - (b.score ?? 0)) * dir ||
            b.count - a.count,
        )
      return whole || items.length ? [{ c, items }] : []
    })
    if (!all && !groups.length) return null
    return { groups, total: new Set(groups.flatMap((g) => g.items.map((x) => x.name))).size }
  }, [collections, list, pop, nsfw, sort, q])
}

export function ArtistFolder({ data, forceOpen }: { data: ArtistGroups; forceOpen: boolean }) {
  const open = usePrefs((s) => forceOpen || !!s.openFolders[ARTISTS_KEY])
  useEffect(() => {
    if (open) loadArtistList().catch(() => undefined)
  }, [open])
  return (
    <div className="flex flex-col" data-testid="artist-folder">
      <LibFolderRow name="画师" count={data.total} open={open} onToggle={() => usePrefs.getState().toggleFolder(ARTISTS_KEY)} depth={0} testId="lib-folder" folder="artists" />
      {open && data.groups.map((g) => <CollectionFolder key={g.c.id} g={g} forceOpen={forceOpen} />)}
    </div>
  )
}

function CollectionFolder({ g, forceOpen }: { g: ArtistGroup; forceOpen: boolean }) {
  const key = collKey(g.c.id)
  const open = usePrefs((s) => forceOpen || !!s.openFolders[key])
  const fav = g.c.id === FAV_COLLECTION
  return (
    <>
      <LibFolderRow
        name={g.c.title}
        icon={
          <span className={cn('grid w-[13px] shrink-0 place-items-center', fav ? 'fav-on' : 'text-ink-2')}>
            <CollectionIcon id={g.c.id} size={fav ? 12 : 13} />
          </span>
        }
        count={g.items.length}
        open={open}
        onToggle={() => usePrefs.getState().toggleFolder(key)}
        depth={1}
        testId="artist-collection-folder"
        folder={`coll:${g.c.id}`}
      />
      {open &&
        (g.items.length ? (
          g.items.map((a) => <ArtistRow key={a.name} a={a} coll={g.c.id} depth={2} />)
        ) : (
          <p className="py-1 text-[11px] text-ink-2" style={{ paddingLeft: 2 + 2 * INDENT + 40 }} data-testid="artist-collection-empty">
            {fav ? '暂无收藏的画师' : '暂无画师'}
          </p>
        ))}
    </>
  )
}

const usePeek = create<{ shown: string | null }>(() => ({ shown: null }))
let target: string | null = null
let timer: ReturnType<typeof setTimeout> | undefined
function peekEnter(id: string) {
  target = id
  clearTimeout(timer)
  if (usePeek.getState().shown) usePeek.setState({ shown: id })
  else timer = setTimeout(() => target === id && usePeek.setState({ shown: id }), 300)
}
function peekLeave(id: string) {
  if (target !== id) return
  target = null
  clearTimeout(timer)
  timer = setTimeout(() => !target && usePeek.setState({ shown: null }), 120)
}
function peekClear() {
  target = null
  clearTimeout(timer)
  usePeek.setState({ shown: null })
}

function ArtistRow({ a, coll, depth }: { a: ArtistItem; coll: string; depth: number }) {
  const id = artistDragId(coll, a.name)
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id })
  const shown = usePeek((s) => s.shown === id)
  useEffect(() => {
    if (isDragging) peekClear()
  }, [isDragging])
  useEffect(
    () => () => {
      if (target === id || usePeek.getState().shown === id) peekClear()
    },
    [id],
  )
  return (
    <HoverCard open={shown}>
      <ContextMenu onOpenChange={(o) => o && peekClear()}>
        <ContextMenuTrigger asChild>
          <HoverCardTrigger asChild>
            <div
              ref={setNodeRef}
              {...attributes}
              {...listeners}
              className="flex h-7 shrink-0 cursor-grab items-center gap-1.5 rounded-md pr-1 transition-opacity duration-(--dur) hover:bg-surface-2 data-[dragging]:opacity-40 data-[state=open]:bg-surface-2 [[data-nodoc]_&]:cursor-default [[data-nodoc]_&]:opacity-50"
              style={{ paddingLeft: 2 + depth * INDENT }}
              onPointerEnter={() => peekEnter(id)}
              onPointerLeave={() => peekLeave(id)}
              data-dragging={isDragging ? '' : undefined}
              data-lib-nav="artist"
              data-testid="artist-row"
              data-name={a.name}
              data-count={a.count}
            >
              <span className="size-5 shrink-0" aria-hidden />
              <span className="flex w-2 shrink-0 justify-center">
                <Icon icon={PaintBoardIcon} size={14} className="artist-row-icon -mx-0.5 shrink-0 text-ink-2" />
              </span>
              <span className="min-w-0 flex-1 truncate text-[13px] text-ink-1" data-testid="artist-name">
                {a.name}
              </span>
              <span className="shrink-0 text-[11px] text-ink-2 tabular-nums">{a.count ? formatCount(a.count) : ''}</span>
            </div>
          </HoverCardTrigger>
        </ContextMenuTrigger>
        <ContextMenuContent className="w-52">
          <ContextMenuItem onSelect={() => openInArtistLibrary(a.name)} data-testid="artist-row-menu-open">
            <Icon size={14} icon={PaintBoardIcon} />
            在画师库中查看
          </ContextMenuItem>
          <ContextMenuItem onSelect={() => void copyText(`artist:${a.name}`, ` artist:${a.name}`)} data-testid="artist-row-menu-copy">
            <Icon size={14} icon={Copy01Icon} />
            <span className="truncate">复制 artist:{a.name}</span>
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
      <HoverCardContent
        side="right"
        align="start"
        sideOffset={20}
        collisionPadding={8}
        className="w-[248px] bg-surface-3 p-2 text-ink-1 shadow-(--shadow-pop) ring-line"
        data-testid="artist-preview"
        data-name={a.name}
      >
        <ArtistPeek name={a.name} count={a.count} />
      </HoverCardContent>
    </HoverCard>
  )
}

function ArtistPeek({ name, count }: { name: string; count: number }) {
  const mode: RatingMode = usePrefs((s) => s.nsfw !== 'off') ? 'all' : 'sfw'
  const got = useArtistPosts(name, mode, true, 0)
  const posts = Array.isArray(got) ? coverFirstPosts(name, mode, got).slice(0, 3) : []
  return (
    <div className="flex flex-col gap-2">
      <ArtistMedia name={name} posts={posts} pool={Array.isArray(got) ? got : undefined} loading={got === undefined} failed={got === 'failed'} width={232} className="rounded-md" />
      <div className="flex items-baseline gap-2 px-0.5">
        <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">{name}</span>
        {count > 0 && <span className="shrink-0 text-[11px] text-ink-2 tabular-nums">{formatCount(count)} 张作品</span>}
      </div>
      <p className="px-0.5 text-[11px] text-ink-2">拖动到区块中添加</p>
    </div>
  )
}

export function ArtistGhost({ name }: { name: string }) {
  const chip: Chip = { id: '', text: name, type: 'artist', weight: 1, disabled: false }
  return (
    <div className="chip" style={sectionVars('slate')} {...chipAttrs(chip)} data-chip-id={undefined} data-overlay="" data-testid="drag-artist">
      <ChipFace chip={chip} />
    </div>
  )
}
