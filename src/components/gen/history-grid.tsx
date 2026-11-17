import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from 'zustand'
import { Dialog as DialogPrimitive } from 'radix-ui'
import { ArrowDown01Icon, Clock01Icon, ImageAdd01Icon } from '@hugeicons/core-free-icons'
import { Icon } from '@/components/icon'
import { Tip } from '@/components/tip'
import { Button } from '@/components/ui/button'
import { ContextMenu, ContextMenuContent, ContextMenuTrigger } from '@/components/ui/context-menu'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Slider } from '@/components/ui/slider'
import { imageUrl, NEXT_VERSION, useFollowing, useGen, useShownHistory, useShownSelectedId, useSelectedVersion, type GenImage } from '@/store/gen'
import { usePrefs } from '@/store/prefs'
import { useHistoryGrid } from '@/store/right-panel'
import { getDocStore } from '@/store/tabs'
import { nextVersionN, useMatchedVersion, useVersions, type DocVersion } from '@/store/versions'
import { badgeOf } from './action-meta'
import { dragOutProps } from './drag-out'
import { LostThumb } from './lost-thumb'
import { MenuItems, Node, Pending, ThumbBadge } from './history'
import { groupByVersion, importKey, selectVersion, stripFollow, type HistoryGroup } from './history-nav'
import { VersionTag } from './version-tag'

const GRID_MIN = 80
const GRID_MAX = 240

const close = () => useHistoryGrid.setState({ open: false })

export function HistoryGridLayer({ tabId, docId }: { tabId: string; docId: string }) {
  const open = useHistoryGrid((s) => s.open)
  return (
    <DialogPrimitive.Root open={open} onOpenChange={(o) => useHistoryGrid.setState({ open: o })} modal={false}>
      <DialogPrimitive.Content
        className="absolute inset-0 z-10 flex flex-col bg-shell outline-none duration-200 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:slide-out-to-bottom-2 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:slide-in-from-bottom-2 motion-reduce:animate-none"
        onOpenAutoFocus={(e) => {
          e.preventDefault()
          ;(e.currentTarget as HTMLElement | null)?.focus()
        }}
        onInteractOutside={(e) => e.preventDefault()}
        aria-describedby={undefined}
        data-testid="history-grid"
      >
        <DialogPrimitive.Title className="sr-only">历史</DialogPrimitive.Title>
        <GridBody tabId={tabId} docId={docId} />
      </DialogPrimitive.Content>
    </DialogPrimitive.Root>
  )
}

function GridBody({ tabId, docId }: { tabId: string; docId: string }) {
  const list = useShownHistory(docId)
  const versions = useVersions((s) => s.byDoc[docId])
  const selected = useShownSelectedId(docId)
  const viewing = useSelectedVersion(docId)
  const pickedNext = useGen((s) => s.selected[docId] === NEXT_VERSION)
  const running = useGen((s) => (s.running?.docId === docId ? s.running : null))
  const following = useFollowing(docId)
  const doc = useStore(getDocStore(tabId), (s) => s.doc)
  const matched = useMatchedVersion(docId, doc)
  const gridH = usePrefs((s) => s.historyGridH)
  const scroll = useRef<HTMLDivElement>(null)
  const [target, setTarget] = useState<{ img: GenImage | null; v: DocVersion | null; node: boolean } | null>(null)

  const groups = useMemo(() => {
    const have = groupByVersion(list ?? [], versions)
    const keys = new Set(have.map((g) => g.key))
    const extra = [matched, versions?.find((v) => v.id === running?.versionId)].filter((v): v is DocVersion => !!v && !keys.has(v.id))
    const all: HistoryGroup[] = [...have, ...[...new Set(extra)].map((v) => ({ key: v.id, v, images: [] as GenImage[], at: v.createdAt }))]
    return all.sort((a, b) => b.at - a.at || (b.v?.n ?? -1) - (a.v?.n ?? -1))
  }, [list, versions, matched, running?.versionId])

  useEffect(() => {
    const el = scroll.current?.querySelector<HTMLElement>('[data-slot=scroll-area-viewport]')
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return
      e.preventDefault()
      const cur = usePrefs.getState().historyGridH
      const next = Math.round(Math.min(GRID_MAX, Math.max(GRID_MIN, cur * (e.deltaY < 0 ? 1.1 : 1 / 1.1))))
      if (next !== cur) usePrefs.getState().set({ historyGridH: next })
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])
  useEffect(() => {
    const f = requestAnimationFrame(() => scroll.current?.querySelector('button[data-current]')?.scrollIntoView({ block: 'nearest' }))
    return () => cancelAnimationFrame(f)
  }, [])

  const onContextMenu = (e: React.MouseEvent) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-id], [data-vid]')
    if (!el) return e.preventDefault()
    const img = el.dataset.id ? (list?.find((x) => x.id === el.dataset.id) ?? null) : null
    const vid = img ? img.versionId : el.dataset.vid
    const v = versions?.find((x) => x.id === vid) ?? null
    if (!img && !v) return e.preventDefault()
    setTarget({ img: img ?? (v ? (list?.find((x) => x.versionId === v.id) ?? null) : null), v, node: !img })
  }
  const pick = (f: () => void) => {
    stripFollow.held = false
    f()
    close()
  }

  if (matched === undefined || !versions) return null
  const pending = running ? running.previews.map((url, i) => ({ url, i })).filter(({ i }) => !running.done[i]) : []
  const runNew = !!running && running.versionId === null && !running.importId && pending.length > 0
  const showNext = matched === null || runNew
  const row = (key: string, node: React.ReactNode, body: React.ReactNode, testId: string, n?: number) => (
    <section key={key} className="grid grid-cols-[52px_minmax(0,1fr)] gap-3" data-testid={testId} data-version={n}>
      <div className="flex items-center" style={{ height: gridH }}>
        {node}
      </div>
      <div className="flex flex-wrap gap-2">{body}</div>
    </section>
  )

  return (
    <>
      <header className="flex h-9 shrink-0 items-center gap-1.5 border-b border-line pr-1.5 pl-3 text-[12px] text-ink-2">
        <Icon icon={Clock01Icon} size={14} />
        <span>历史</span>
        <span className="tabular-nums" data-testid="history-grid-count">
          · {list?.length ?? 0} 张
        </span>
        <Tip label="缩略图大小（Ctrl+滚轮）">
          <div className="ml-auto flex h-7 w-28 items-center px-1" data-testid="history-grid-size">
            <Slider min={GRID_MIN} max={GRID_MAX} step={4} value={[gridH]} onValueChange={([v]) => usePrefs.getState().set({ historyGridH: v })} aria-label="缩略图大小" />
          </div>
        </Tip>
        <Tip label="收回">
          <Button variant="ghost" size="icon-sm" className="text-ink-2" onClick={close} aria-label="收回" data-testid="history-grid-close">
            <Icon icon={ArrowDown01Icon} size={16} />
          </Button>
        </Tip>
      </header>
      <ContextMenu onOpenChange={(o) => !o && setTarget(null)}>
        <ContextMenuTrigger asChild onContextMenu={onContextMenu}>
          <div ref={scroll} className="min-h-0 flex-1">
            <ScrollArea className="h-full">
              <div className="flex flex-col gap-3 p-3">
                {showNext &&
                  row(
                    'next',
                    <Node on={pickedNext} picked={pickedNext} onClick={() => pick(() => (runNew ? useGen.getState().follow(docId) : useGen.getState().select(docId, NEXT_VERSION)))} count={runNew ? pending.length : 0} testId="history-node-next">
                      <VersionTag n={nextVersionN(versions)} next current={matched === null} />
                    </Node>,
                    runNew && running ? <Pending running={running} items={pending} docId={docId} thumbH={gridH} current={following} onPick={close} /> : null,
                    'history-grid-next',
                  )}
                {groups.map((g) => {
                  const v = g.v
                  return row(
                    g.key,
                    v ? (
                      <Node on={v.id === viewing?.id} picked={!selected && v.id === viewing?.id} onClick={() => pick(() => selectVersion(docId, v))} vid={v.id} count={g.images.length}>
                        <VersionTag n={v.n} current={v.id === matched?.id} ai={v.kind === 'ai'} />
                      </Node>
                    ) : (
                      g.imported && (
                        <Node on={g.images.some((x) => x.id === selected)} picked={false} onClick={() => pick(() => useGen.getState().select(docId, g.imported!.id))} count={1} testId="history-node-import">
                          <span className="flex items-center gap-1">
                            <Icon icon={ImageAdd01Icon} size={14} />
                            导入
                          </span>
                        </Node>
                      )
                    ),
                    <>
                      {g.images.map((img) => (
                        <button
                          key={img.id}
                          type="button"
                          className="history-item shrink-0"
                          style={{ height: gridH, width: 'auto', aspectRatio: `${img.width} / ${img.height}` }}
                          data-current={!following && img.id === selected ? '' : undefined}
                          onClick={() => pick(() => useGen.getState().select(docId, img.id))}
                          aria-label={`${v ? `v${v.n} ` : ''}${badgeOf(img)?.name ?? `seed ${img.seed}`}`}
                          data-testid="history-grid-item"
                          data-id={img.id}
                          data-missing={img.missing ? '' : undefined}
                          {...(img.missing ? {} : dragOutProps(() => [img]))}
                        >
                          {img.missing ? <LostThumb /> : <img src={imageUrl(img)} alt="" loading="lazy" decoding="async" draggable={false} />}
                          <ThumbBadge img={img} />
                        </button>
                      ))}
                      {running && ((v && running.versionId === v.id) || (running.importId && g.key === importKey(running.importId))) && (
                        <Pending running={running} items={pending} docId={docId} thumbH={gridH} current={following} onPick={close} />
                      )}
                    </>,
                    'history-grid-group',
                    v?.n,
                  )
                })}
              </div>
            </ScrollArea>
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent className="w-44" data-testid="history-menu">
          {target && <MenuItems tabId={tabId} docId={docId} img={target.img} v={target.v} node={target.node} />}
        </ContextMenuContent>
      </ContextMenu>
    </>
  )
}
