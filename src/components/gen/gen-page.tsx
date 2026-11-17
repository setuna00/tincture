import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode, type Ref } from 'react'
import { cn } from 'cn'
import { ImageParams, ImagePrompts, ImageProps } from '@/components/gallery/image-info'
import { FIXED_TOP, FOOT, MAIN_BUTTON } from '@/components/foot'
import { ParamsCard, ParamsLayer } from '@/components/params-panel'
import { ProgressFill } from '@/components/progress-fill'
import { Anlas } from '@/components/anlas'
import { Tip } from '@/components/tip'
import { Button } from '@/components/ui/button'
import { PopoverAnchor } from '@/components/ui/popover'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { PRICE_TOO_LONG } from '@/lib/nai-api'
import { effectiveSettings } from '@/lib/nai-write'
import { openSettings } from '@/lib/settings-nav'
import { useHeight } from '@/lib/use-height'
import { useDoc } from '@/store/context'
import { imageUrl, useFollowing, useGen, useSelectedImage, useShownHistory, type GenImage, type Running } from '@/store/gen'
import { accountOf, useConnected, useNai } from '@/store/nai'
import { usePrefs } from '@/store/prefs'
import { useVibeCodes } from '@/store/ref-images'
import { useLightbox } from '@/store/right-panel'
import { MissingFile } from '@/components/gallery/missing'
import { dragOutProps } from './drag-out'
import { GenConfirm } from './gen-confirm'
import { SpendPopover } from './spend-confirm'
import { closeGenConfirm, genPrice, requestGenerate, useGenConfirm } from './gen-request'
import { HistorySplit } from './history'
import { HistoryGridLayer } from './history-grid'
import { historyKey } from './history-nav'
import { runningText } from './action-meta'
import { InpaintEditor } from './inpaint-editor'
import { GenLightbox } from './lightbox'
import { PriceParts } from './price-parts'
import { VersionBar } from './version-bar'
import { fitStyle, transparencyStyle, useZoomPan } from './zoom-pan'

export function GenPane({ tabId, docId }: { tabId: string; docId: string }) {
  const connected = useConnected()
  return (
    <>
      <div className="relative flex min-h-0 flex-1 flex-col">
        {connected ? (
          <>
            <HistorySplit tabId={tabId} docId={docId}>
              <ImageScroll tabId={tabId} docId={docId} />
            </HistorySplit>
            <HistoryGridLayer tabId={tabId} docId={docId} />
            <GenLightbox docId={docId} />
            <InpaintEditor tabId={tabId} />
          </>
        ) : (
          <NoToken />
        )}
        <ParamsLayer />
      </div>
      <GenFooter tabId={tabId} connected={connected} />
    </>
  )
}

function ImageScroll({ tabId, docId }: { tabId: string; docId: string }) {
  const img = useSelectedImage(docId)
  const following = useFollowing(docId)
  const running = useGen((s) => (following ? s.running : null))
  const root = useRef<HTMLDivElement>(null)
  const bar = useRef<HTMLDivElement>(null)
  const viewH = useHeight(root)
  const barH = useHeight(bar)
  const [stuck, setStuck] = useState(false)
  useEffect(() => {
    const el = root.current?.querySelector<HTMLElement>('[data-slot=scroll-area-viewport]')
    if (!el) return
    const onScroll = () => setStuck(el.scrollTop > 0)
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [])
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.target === e.currentTarget || !(e.target as HTMLElement).closest('button, input, textarea, [contenteditable]')) historyKey(docId, e)
  }
  const historyOpen = usePrefs((s) => s.historyOpen)
  const details = !following && !historyOpen && img
  return (
    <ScrollArea ref={root} className="x-scroll min-h-0 flex-1" data-testid="gen-scroll" data-top={stuck ? undefined : ''}>
      <div className="relative outline-none" style={{ height: Math.max(120, viewH - barH) }} tabIndex={-1} onKeyDown={onKeyDown} data-testid="gen-stage">
        {running?.action && running.source ? <ActionRunning r={running} /> : running ? <RunningView r={running} /> : img ? <ImageView key={img.id} img={img} /> : <EmptyFrame />}
      </div>
      <VersionBar tabId={tabId} docId={docId} barRef={bar} stuck={stuck} />
      {details && <Details img={img} docId={docId} minH={viewH - barH} />}
    </ScrollArea>
  )
}

function Details({ img, docId, minH }: { img: GenImage; docId: string; minH: number }) {
  const list = useShownHistory(docId)
  const batch = list?.filter((x) => x.batch === img.batch).length ?? 1
  return (
    <div key={img.id} className="page-in flex flex-col gap-4 px-3 pb-4" style={{ minHeight: minH }} data-testid="gen-details">
      <ImagePrompts img={img} />
      <ImageParams img={img} />
      <ImageProps img={img} batch={batch} />
    </div>
  )
}

function NoToken() {
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 p-6" data-testid="gen-no-token">
      <span className="text-[13px] text-ink-2">未设置 NAI 令牌</span>
      <Button variant="outline" onClick={() => openSettings('account')} data-testid="gen-to-settings">
        前往设置
      </Button>
    </div>
  )
}

function FitBox({ children, boxRef }: { children: ReactNode; boxRef?: Ref<HTMLDivElement> }) {
  return (
    <div ref={boxRef} className="absolute inset-3.5 grid place-items-center" style={{ containerType: 'size' }}>
      {children}
    </div>
  )
}
function EmptyFrame() {
  const s = effectiveSettings(useDoc((d) => d.doc.settings)).gen
  return (
    <FitBox>
      <div className="pos-canvas flex flex-col items-center justify-center gap-1.5" style={{ ...fitStyle(s.width, s.height), borderStyle: 'dashed' }} data-testid="gen-empty">
        <span className="text-[16px] text-ink-2 tabular-nums">
          {s.width} × {s.height}
        </span>
        <span className="text-[12px] text-ink-2">暂无图片</span>
      </div>
    </FitBox>
  )
}

function RunningView({ r }: { r: Running }) {
  const raw = useNai((s) => s.rawIntermediates)
  const cols = r.n === 1 ? 1 : r.n <= 4 ? 2 : 3
  const rows = Math.ceil(r.n / cols)
  const cell = { w: r.width * cols, h: r.height * rows }
  return (
    <div className="absolute inset-0" data-testid="gen-running">
      <FitBox>
        <div className="grid gap-1.5" style={{ ...fitStyle(cell.w, cell.h), gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
          {r.previews.map((url, i) => (
            <div key={i} className="relative overflow-hidden rounded-sm" style={{ aspectRatio: `${r.width} / ${r.height}` }}>
              {url ? (
                <>
                  <img src={url} alt="" className="absolute inset-0 size-full object-contain" draggable={false} data-testid={r.done[i] ? 'gen-preview-final' : 'gen-preview'} />
                  <div className="absolute inset-0 backdrop-blur-[5px] transition-opacity duration-500" style={{ opacity: !raw && !r.done[i] ? 1 : 0 }} />
                </>
              ) : (
                <div className="absolute inset-0">
                  <div className="pos-canvas grid size-full place-items-center" style={{ borderStyle: 'dashed' }}>
                    <span className="text-[12px] text-ink-2">生成中…</span>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </FitBox>
      <div className="absolute inset-x-0 bottom-0 h-0.5 bg-line" />
      <div className="absolute bottom-0 left-0 h-0.5 bg-lamp transition-[width] duration-300 ease-(--ease-out)" style={{ width: `${Math.round(r.progress * 100)}%` }} data-testid="gen-progress" />
    </div>
  )
}

function ActionRunning({ r }: { r: Running }) {
  const src = r.source!
  const bg = useNai((s) => s.transparencyBg)
  const color = useNai((s) => s.transparencyColor)
  return (
    <div className="absolute inset-0 overflow-hidden" data-testid="gen-action-running" data-action={r.action}>
      <FitBox>
        <div className="relative overflow-hidden rounded-sm" style={fitStyle(src.width, src.height, true)}>
          <img src={imageUrl(src)} alt="" draggable={false} className="absolute inset-0 size-full object-contain select-none" style={transparencyStyle(bg, color)} />
          <div className="absolute inset-0 animate-in bg-black/45 duration-200 fade-in-0" />
        </div>
      </FitBox>
      <div className="absolute inset-0 grid place-items-center">
        <span className="animate-in rounded-md bg-work/95 px-3 py-1.5 text-[13px] font-semibold text-ink-1 tabular-nums shadow-sm duration-200 fade-in-0" data-testid="gen-action-text">
          {runningText(r.action!, r.indeterminate ? null : r.progress)}
        </span>
      </div>
      <div className="absolute inset-x-0 bottom-0 h-0.5 overflow-hidden bg-line">
        {r.indeterminate ? (
          <span className="progress-indeterminate absolute inset-y-0 w-[35%] bg-lamp" data-testid="gen-progress" />
        ) : (
          <span className="absolute inset-y-0 left-0 bg-lamp transition-[width] duration-300 ease-(--ease-out)" style={{ width: `${Math.round(r.progress * 100)}%` }} data-testid="gen-progress" />
        )}
      </div>
    </div>
  )
}

function ImageView({ img }: { img: GenImage }) {
  const { box, fit, zoomed, transform, handlers, moved } = useZoomPan({ fitOnDoubleClick: false })
  const bg = useNai((s) => s.transparencyBg)
  const color = useNai((s) => s.transparencyColor)
  if (img.missing)
    return (
      <div ref={box} className="absolute inset-0 overflow-hidden" data-testid="gen-viewer">
        <FitBox boxRef={fit}>
          <MissingFile style={fitStyle(img.width, img.height, true)} />
        </FitBox>
      </div>
    )
  return (
    <div ref={box} className="absolute inset-0 overflow-hidden" {...handlers} data-zoomed={zoomed ? '' : undefined} data-testid="gen-viewer">
      <FitBox boxRef={fit}>
        <img
          src={imageUrl(img)}
          alt=""
          draggable={false}
          {...(zoomed ? {} : dragOutProps(() => [img]))}
          onClick={(e) => !moved.current && !e.shiftKey && useLightbox.setState({ open: true })}
          className="max-w-none cursor-zoom-in rounded-sm select-none"
          style={{ ...fitStyle(img.width, img.height, true), ...transparencyStyle(bg, color), transform }}
          data-testid="gen-image"
          data-seed={img.seed}
        />
      </FitBox>
    </div>
  )
}

function useSettled<T>(value: T, ms: number): [T, boolean] {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return [v, v !== value]
}

function GenFooter({ tabId, connected }: { tabId: string; connected: boolean }) {
  const settings = useDoc((s) => s.doc.settings)
  const account = useNai((s) => accountOf(s.account))
  const running = useGen((s) => s.running)
  // NovelAI charges Vibe encoding only when no reusable code exists.
  const have = useVibeCodes((v) => v.have)
  const { n, parts } = genPrice(settings, account, have)
  const [price, pending] = useSettled(parts.total, 300)
  const mine = running?.tabId === tabId
  const busy = !!running
  const asking = useGenConfirm((s) => s.tabId === tabId) && connected
  // Validate against live settings; a debounced price must not enable generation for settings that will incur a different charge.
  const tooLong = parts.total === PRICE_TOO_LONG
  const action = mine ? running?.action : undefined
  const label = action
    ? runningText(action, running?.indeterminate ? null : (running?.progress ?? 0))
    : mine
      ? `${running?.inpaint ? '重绘中' : '生成中'} ${Math.round((running?.progress ?? 0) * 100)}%`
      : n > 1
        ? `生成 ${n} 张`
        : '生成'
  const button = (
    <PopoverAnchor asChild>
      <Button
        className={cn(MAIN_BUTTON, 'relative justify-between gap-2 overflow-hidden pr-2 pl-4', mine && 'disabled:opacity-100')}
        disabled={!connected || busy || tooLong}
        onClick={() => void requestGenerate(tabId)}
        data-testid="gen-button"
        data-running={mine ? '' : undefined}
      >
        {mine && running && <ProgressFill value={running.indeterminate ? 'indeterminate' : running.progress} />}
        <span className="relative tabular-nums">{tooLong ? '无法生成' : label}</span>
        {connected && !tooLong && !mine && (
          <Tip label={parts.total !== parts.gen && !pending ? <PriceParts parts={parts} /> : null}>
            <span
              className={cn('relative inline-flex h-6 items-center rounded-[5px] bg-(--price-on-bg) px-2 text-(--price-on) transition-opacity duration-150', pending && 'opacity-50')}
              data-testid="gen-price"
            >
              <Anlas n={price === PRICE_TOO_LONG ? parts.total : price} className="translate-y-[0.5px]" />
            </span>
          </Tip>
        )}
      </Button>
    </PopoverAnchor>
  )
  const tip = !connected ? '未设置 NAI 令牌' : tooLong ? '当前参数生成耗时过长' : busy && !mine ? '已有图片在生成' : null
  return (
    <footer className={cn(FOOT, 'pt-3', !connected && FIXED_TOP)} data-testid="gen-footer" data-tab={tabId}>
      <ParamsCard />
      <SpendPopover
        open={asking}
        onCancel={() => closeGenConfirm()}
        onBusy={() => closeGenConfirm('busy')}
        anchor={
          tip ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="flex w-full">{button}</span>
              </TooltipTrigger>
              <TooltipContent>{tip}</TooltipContent>
            </Tooltip>
          ) : (
            button
          )
        }
      >
        <GenConfirm tabId={tabId} n={n} parts={parts} />
      </SpendPopover>
    </footer>
  )
}
