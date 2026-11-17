import { Fragment, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { usePanelRef } from 'react-resizable-panels'
import { useStore } from 'zustand'
import { ArrowDown01Icon, Clock01Icon, Copy01Icon, Delete02Icon, Download04Icon, FileImportIcon, GridViewIcon, ImageAdd01Icon, Loading03Icon } from '@hugeicons/core-free-icons'
import { FIXED_SHADOW } from '@/components/foot'
import { Icon } from '@/components/icon'
import { Tip } from '@/components/tip'
import { Button } from '@/components/ui/button'
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuShortcut, ContextMenuTrigger } from '@/components/ui/context-menu'
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable'
import { ScrollArea } from '@/components/ui/scroll-area'
import { useHeight } from '@/lib/use-height'
import { cn } from '@/lib/utils'
import { imageUrl, NEXT_VERSION, useFollowing, useGen, useSelectedVersion, useShownHistory, useShownSelectedId, type GenImage, type Running } from '@/store/gen'
import { usePrefs } from '@/store/prefs'
import { useHistoryGrid } from '@/store/right-panel'
import { getDocStore } from '@/store/tabs'
import { isCurrentVersion, nextVersionN, revertToVersion, useMatchedVersion, useVersions, type DocVersion } from '@/store/versions'
import { badgeOf } from './action-meta'
import { dragOutProps } from './drag-out'
import { LostThumb } from './lost-thumb'
import { groupByVersion, historyKey, IMPORT_LABEL, importKey, selectVersion, stripFollow, type HistoryGroup } from './history-nav'
import { copyImage, downloadImage, SAVE_LABEL } from './image-io'
import { HISTORY_DEFAULT, HISTORY_HEAD, HISTORY_MIN, historyMax, THUMB_PAD } from './layout'
import { VersionTag } from './version-tag'

export function HistorySplit({ tabId, docId, children }: { tabId: string; docId: string; children: ReactNode }) {
  const open = usePrefs((s) => s.historyOpen)
  const pref = usePrefs((s) => s.historyH)
  const panel = usePanelRef()
  const wrap = useRef<HTMLDivElement>(null)
  const regionH = useHeight(wrap)
  const max = historyMax(regionH)
  const stripH = Math.min(max, Math.max(HISTORY_MIN, pref))
  const [live, setLive] = useState<number | null>(null)
  const [animate, setAnimate] = useState(false)
  const animating = useRef(false)
  const run = (to: number) => {
    animating.current = true
    setAnimate(true)
    requestAnimationFrame(() => panel.current?.resize(to))
    setTimeout(() => {
      animating.current = false
      setAnimate(false)
    }, 300)
  }
  const mounted = useRef(false)
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true
      return
    }
    run(open ? HISTORY_HEAD + stripH : HISTORY_HEAD)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])
  const save = (h: number) => usePrefs.getState().set({ historyH: Math.round(h) })
  // Changing defaultSize makes the panel library jump immediately; keep it stable so explicit resizes can animate.
  const [initial] = useState(() => (open ? HISTORY_HEAD + stripH : HISTORY_HEAD))
  const thumbH = Math.max(HISTORY_MIN, live ?? stripH) - THUMB_PAD
  return (
    <div ref={wrap} className="min-h-0 flex-1">
      <ResizablePanelGroup
        orientation="vertical"
        className="hist-split"
        data-animate={animate ? '' : undefined}
        resizeTargetMinimumSize={{ fine: 8, coarse: 20 }}
        onLayoutChanged={(_, meta) => {
          if (meta.isUserInteraction && open && panel.current) save(panel.current.getSize().inPixels - HISTORY_HEAD)
        }}
      >
        <ResizablePanel id="image-panel" className="flex h-full flex-col" groupResizeBehavior="preserve-relative-size" style={{ overflow: 'hidden' }}>
          {children}
        </ResizablePanel>
        <ResizableHandle
          className={cn(
            'z-10 bg-line-strong transition-colors duration-150 after:transition-colors after:duration-150 data-[separator=active]:after:bg-(--accent) data-[separator=hover]:after:bg-(--accent) data-[separator=disabled]:cursor-default',
            'before:pointer-events-none before:absolute before:inset-x-0 before:top-0 before:h-7',
            FIXED_SHADOW,
          )}
          disabled={!open}
          disableDoubleClick
          onDoubleClick={() => {
            if (!open) return
            run(HISTORY_HEAD + HISTORY_DEFAULT)
            save(HISTORY_DEFAULT)
          }}
          aria-label="调整历史高度"
          data-testid="history-resize"
        />
        <ResizablePanel
          id="history-panel"
          className="flex h-full flex-col"
          panelRef={panel}
          defaultSize={initial}
          minSize={open ? HISTORY_HEAD + HISTORY_MIN : HISTORY_HEAD}
          maxSize={open ? HISTORY_HEAD + max : HISTORY_HEAD}
          disabled={!open}
          groupResizeBehavior="preserve-pixel-size"
          style={{ overflow: 'hidden' }}
          onResize={(size) => {
            if (open && !animating.current) setLive(size.inPixels - HISTORY_HEAD)
          }}
        >
          <HistoryStrip tabId={tabId} docId={docId} open={open} thumbH={thumbH} />
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  )
}

function HistoryStrip({ tabId, docId, open, thumbH }: { tabId: string; docId: string; open: boolean; thumbH: number }) {
  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="gen-history" data-open={open ? '' : undefined}>
      <HistoryHead tabId={tabId} docId={docId} open={open} />
      <div className="min-h-0 flex-1" aria-hidden={!open} inert={!open}>
        <StripBody tabId={tabId} docId={docId} thumbH={thumbH} />
      </div>
    </div>
  )
}

function HistoryHead({ tabId, docId, open }: { tabId: string; docId: string; open: boolean }) {
  const doc = useStore(getDocStore(tabId), (s) => s.doc)
  const matched = useMatchedVersion(docId, doc)
  const versions = useVersions((s) => s.byDoc[docId])
  const n = matched ? matched.n : nextVersionN(versions)
  return (
    <div className="relative flex h-7 shrink-0 items-center gap-1.5 bg-shell px-3 text-[12px] text-ink-2 transition-colors duration-150 hover:bg-surface-2 hover:text-ink-1">
      <button
        type="button"
        className="absolute inset-0 outline-none focus-visible:ring-2 focus-visible:ring-(--accent-text) focus-visible:ring-inset"
        onClick={() => usePrefs.getState().set({ historyOpen: !open })}
        aria-expanded={open}
        aria-label={open ? '收起历史' : '展开历史'}
        data-row=""
        data-testid="history-head"
      />
      <Icon icon={Clock01Icon} size={14} className="pointer-events-none" />
      <span className="pointer-events-none">历史</span>
      <Tip label="展开全部">
        <Button variant="ghost" size="icon-xs" className="relative size-6 text-ink-2" onClick={() => useHistoryGrid.setState({ open: true })} aria-label="展开全部" data-testid="history-expand">
          <Icon icon={GridViewIcon} size={14} />
        </Button>
      </Tip>
      {matched !== undefined && (
        <span className={cn('pointer-events-none ml-1 inline-flex font-semibold text-ink-1 transition-[opacity,visibility] duration-200', open ? 'invisible opacity-0' : 'opacity-100')} aria-hidden={open} data-testid="gen-version">
          <VersionTag n={n} current next={!matched} ai={matched?.kind === 'ai'} />
        </span>
      )}
      <Icon icon={ArrowDown01Icon} size={14} className={cn('pointer-events-none ml-auto transition-transform duration-200 ease-(--ease-out)', !open && 'rotate-180')} />
    </div>
  )
}

function StripBody({ tabId, docId, thumbH }: { tabId: string; docId: string; thumbH: number }) {
  const list = useShownHistory(docId)
  const versions = useVersions((s) => s.byDoc[docId])
  const selected = useShownSelectedId(docId)
  const viewing = useSelectedVersion(docId)
  const pickedNext = useGen((s) => s.selected[docId] === NEXT_VERSION)
  const running = useGen((s) => (s.running?.docId === docId ? s.running : null))
  const following = useFollowing(docId)
  const doc = useStore(getDocStore(tabId), (s) => s.doc)
  const matched = useMatchedVersion(docId, doc)
  const root = useRef<HTMLDivElement>(null)
  const [target, setTarget] = useState<{ img: GenImage | null; v: DocVersion | null; node: boolean } | null>(null)

  useEffect(() => {
    const box = root.current
    const el = box?.querySelector<HTMLElement>('[data-slot=scroll-area-viewport]')
    if (!box || !el) return
    const onWheel = (e: WheelEvent) => {
      if (useGen.getState().running) stripFollow.held = true
      if (el.scrollWidth <= el.clientWidth || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return
      e.preventDefault()
      el.scrollLeft += e.deltaY
    }
    const onDown = (e: PointerEvent) => {
      if (useGen.getState().running && (e.target as HTMLElement).closest('[data-slot=scroll-area-scrollbar]')) stripFollow.held = true
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    box.addEventListener('pointerdown', onDown)
    return () => (el.removeEventListener('wheel', onWheel), box.removeEventListener('pointerdown', onDown))
  }, [versions, matched])
  const reveal = (smooth: boolean) => {
    const vp = root.current?.querySelector<HTMLElement>('[data-slot=scroll-area-viewport]')
    const el = root.current?.querySelector<HTMLElement>('button[data-current]')
    if (!vp || !el) return
    const v = vp.getBoundingClientRect()
    const r = el.getBoundingClientRect()
    const d = r.left - 12 < v.left ? r.left - 12 - v.left : r.right + 12 > v.right ? r.right + 12 - v.right : 0
    if (d) vp.scrollBy({ left: d, behavior: smooth ? 'smooth' : 'auto' })
  }
  const runOn = !!running
  useEffect(() => {
    if (!runOn || !following) return
    stripFollow.held = false
    const f = requestAnimationFrame(() => reveal(true))
    return () => cancelAnimationFrame(f)
  }, [runOn, following])
  useEffect(() => {
    if (!stripFollow.held) reveal(false)
  }, [selected, viewing, pickedNext, list?.length, following])

  const onKeyDown = (e: KeyboardEvent) => {
    if (historyKey(docId, e)) return
    if ((e.key === 'Delete' || e.key === 'Backspace') && selected) {
      e.preventDefault()
      e.stopPropagation()
      useGen.getState().remove(docId, selected)
    }
  }
  const groups = useMemo(() => {
    const have = groupByVersion(list ?? [], versions)
    const keys = new Set(have.map((g) => g.key))
    const extra = [matched, versions?.find((v) => v.id === running?.versionId)].filter((v): v is DocVersion => !!v && !keys.has(v.id))
    const all: HistoryGroup[] = [...have, ...[...new Set(extra)].map((v) => ({ key: v.id, v, images: [] as GenImage[], at: v.createdAt }))]
    return all.sort((a, b) => a.at - b.at || (a.v?.n ?? -1) - (b.v?.n ?? -1))
  }, [list, versions, matched, running?.versionId])
  const onContextMenu = (e: React.MouseEvent) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-id], [data-vid]')
    if (!el) return e.preventDefault()
    const img = el.dataset.id ? (list?.find((x) => x.id === el.dataset.id) ?? null) : null
    const vid = img ? img.versionId : el.dataset.vid
    const v = versions?.find((x) => x.id === vid) ?? null
    if (!img && !v) return e.preventDefault()
    setTarget({ img: img ?? (v ? (list?.find((x) => x.versionId === v.id) ?? null) : null), v, node: !img })
  }

  if (matched === undefined || !versions) return null
  const pending = running ? running.previews.map((url, i) => ({ url, i })).filter(({ i }) => !running.done[i]) : []
  const runNew = !!running && running.versionId === null && !running.importId && pending.length > 0
  const showNext = matched === null || runNew

  return (
    <ContextMenu onOpenChange={(open) => !open && setTarget(null)}>
      <ContextMenuTrigger asChild onContextMenu={onContextMenu}>
        <div ref={root} className="h-full outline-none" tabIndex={-1} onKeyDown={onKeyDown} data-testid="history-list">
          <ScrollArea orientation="horizontal" className="h-full">
            <div className="flex w-max items-center gap-1.5 px-3" style={{ height: thumbH + THUMB_PAD - 1 }}>
              {groups.map((g, gi) => {
                const v = g.v
                return (
                  <Fragment key={g.key}>
                    {gi > 0 && <Link />}
                    <section className="flex shrink-0 items-center gap-1.5" data-testid="history-group" data-version={v?.n}>
                      {v && (
                        <Node on={v.id === viewing?.id} picked={!selected && v.id === viewing?.id} onClick={() => selectVersion(docId, v)} vid={v.id} count={g.images.length}>
                          <VersionTag n={v.n} current={v.id === matched?.id} ai={v.kind === 'ai'} />
                        </Node>
                      )}
                      {g.imported && <ImportNode docId={docId} img={g.imported} on={g.images.some((x) => x.id === selected)} />}
                      {g.images.map((img) => (
                        <button
                          key={img.id}
                          type="button"
                          className="history-item shrink-0"
                          style={{ height: thumbH, width: 'auto', aspectRatio: `${img.width} / ${img.height}` }}
                          data-current={!following && img.id === selected ? '' : undefined}
                          onClick={() => {
                            stripFollow.held = false
                            useGen.getState().select(docId, img.id)
                          }}
                          aria-label={`${v ? `v${v.n} ` : ''}${badgeOf(img)?.name ?? `seed ${img.seed}`}`}
                          data-testid="history-item"
                          data-id={img.id}
                          data-missing={img.missing ? '' : undefined}
                          {...(img.missing ? {} : dragOutProps(() => [img]))}
                        >
                          {img.missing ? <LostThumb /> : <img src={imageUrl(img)} alt="" loading="lazy" decoding="async" draggable={false} />}
                          <ThumbBadge img={img} />
                        </button>
                      ))}
                      {running && ((v && running.versionId === v.id) || (running.importId && g.key === importKey(running.importId))) && (
                        <Pending running={running} items={pending} docId={docId} thumbH={thumbH} current={following} />
                      )}
                    </section>
                  </Fragment>
                )
              })}
              {showNext && (
                <>
                  {groups.length > 0 && <Link />}
                  <section className="flex shrink-0 items-center gap-1.5" data-testid="history-group-next">
                    <Node on={pickedNext} picked={pickedNext} onClick={() => (runNew ? useGen.getState().follow(docId) : useGen.getState().select(docId, NEXT_VERSION))} count={runNew ? pending.length : 0} testId="history-node-next">
                      <VersionTag n={nextVersionN(versions)} next current={matched === null} />
                    </Node>
                    {runNew && running && <Pending running={running} items={pending} docId={docId} thumbH={thumbH} current={following} />}
                  </section>
                </>
              )}
            </div>
          </ScrollArea>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-44" data-testid="history-menu">
        {target && <MenuItems tabId={tabId} docId={docId} img={target.img} v={target.v} node={target.node} />}
      </ContextMenuContent>
    </ContextMenu>
  )
}

export function ThumbBadge({ img }: { img: GenImage }) {
  const b = badgeOf(img)
  if (!b || img.label === 'import') return null
  return (
    <span className="absolute bottom-[3px] left-[3px] z-[1] grid size-[18px] place-items-center rounded-[4px] bg-black/60 text-white" data-testid="history-badge" data-label={img.label}>
      <Icon icon={b.icon} size={12} />
    </span>
  )
}

function ImportNode({ docId, img, on }: { docId: string; img: GenImage; on: boolean }) {
  return (
    <Node on={on} picked={false} onClick={() => useGen.getState().select(docId, img.id)} count={1} testId="history-node-import">
      <span className="flex items-center gap-1">
        <Icon icon={ImageAdd01Icon} size={14} />
        导入
      </span>
    </Node>
  )
}

function Link() {
  return <span className="h-px w-3 shrink-0 bg-line-strong" aria-hidden />
}

export function Node({ on, picked, onClick, vid, count, testId = 'history-node', children }: { on: boolean; picked: boolean; onClick: () => void; vid?: string; count: number; testId?: string; children: ReactNode }) {
  return (
    <button
      type="button"
      className={cn(
        'flex h-7 shrink-0 items-center rounded-md px-1.5 text-[12px] font-semibold tabular-nums outline-2 outline-offset-1 outline-transparent transition-[color,background-color,outline-color] duration-150 hover:bg-surface-2 focus-visible:outline-(--accent-text)',
        on ? 'text-ink-1' : 'text-ink-2',
        picked && 'outline-(--accent)',
      )}
      onClick={onClick}
      data-current={picked ? '' : undefined}
      data-testid={testId}
      data-vid={vid}
      data-count={count}
    >
      {children}
    </button>
  )
}

export function Pending({ running, items, docId, thumbH, current, onPick }: { running: Running; items: { url: string | null; i: number }[]; docId: string; thumbH: number; current?: boolean; onPick?: () => void }) {
  return (
    <>
      {items.map(({ url, i }, k) => (
        <button
          key={`run${i}`}
          type="button"
          className="history-item shrink-0"
          style={{ height: thumbH, width: 'auto', aspectRatio: `${running.width} / ${running.height}` }}
          onClick={() => {
            stripFollow.held = false
            useGen.getState().follow(docId)
            onPick?.()
          }}
          aria-label="生成中"
          data-current={current && k === 0 ? '' : undefined}
          data-testid="history-pending"
        >
          {url ? (
            <img src={url} alt="" className="opacity-70 blur-[2px]" draggable={false} />
          ) : (
            <>
              {running.source && <img src={imageUrl(running.source)} alt="" className="opacity-45" draggable={false} />}
              <span className="absolute inset-0 grid place-items-center text-ink-2">
                <Icon icon={Loading03Icon} size={16} className="animate-spin" />
              </span>
            </>
          )}
          {running.indeterminate ? (
            <span className="absolute inset-x-0 bottom-0 h-0.5 overflow-hidden">
              <span className="progress-indeterminate absolute inset-y-0 w-[35%] bg-lamp" />
            </span>
          ) : (
            <span className="absolute inset-x-0 bottom-0 h-0.5 bg-lamp transition-[width] duration-300" style={{ width: `${Math.round(running.progress * 100)}%` }} />
          )}
        </button>
      ))}
    </>
  )
}

export function MenuItems({ tabId, docId, img, v, node }: { tabId: string; docId: string; img: GenImage | null; v: DocVersion | null; node: boolean }) {
  const store = getDocStore(tabId)
  const doc = useStore(store, (s) => s.doc)
  const same = v ? isCurrentVersion(doc, v) : true
  return (
    <>
      {v && (
        <ContextMenuItem disabled={same} onSelect={() => revertToVersion(store, v)} data-testid="history-menu-revert">
          <Icon icon={FileImportIcon} size={14} />
          {IMPORT_LABEL}
        </ContextMenuItem>
      )}
      {img && (
        <>
          {v && <ContextMenuSeparator />}
          <ContextMenuItem onSelect={() => void copyImage(img)} data-testid="history-menu-copy">
            <Icon icon={Copy01Icon} size={14} />
            复制图片
          </ContextMenuItem>
          <ContextMenuItem onSelect={() => void downloadImage(img)} data-testid="history-menu-download">
            <Icon icon={Download04Icon} size={14} />
            {SAVE_LABEL}
          </ContextMenuItem>
          {!node && (
            <>
              <ContextMenuSeparator />
              <ContextMenuItem variant="destructive" onSelect={() => useGen.getState().remove(docId, img.id)} data-testid="history-menu-delete">
                <Icon icon={Delete02Icon} size={14} />
                移至回收站
                <ContextMenuShortcut>Del</ContextMenuShortcut>
              </ContextMenuItem>
            </>
          )}
        </>
      )}
    </>
  )
}
