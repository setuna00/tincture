import { useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react'
import { cn } from 'cn'
import { useHotkeys } from 'react-hotkeys-hook'
import { toast } from 'sonner'
import { FloppyDiskIcon, GitForkIcon } from '@hugeicons/core-free-icons'
import { CleanupMenu } from '@/components/cleanup-menu'
import { TemplateEditDialog } from '@/components/assistant/template-edit'
import { AssistantColumn, AssistantRail } from '@/components/assistant/assistant'
import { TabBar } from '@/components/tab-bar'
import { EditorBoard, EditorDnd } from '@/components/editor/editor'
import { ExportRail } from '@/components/export-panel'
import { requestGenerate } from '@/components/gen/gen-request'
import { rightFits, useAreaWidth } from '@/components/gen/layout'
import { RightPanel } from '@/components/right-panel'
import { RightSplit } from '@/components/right-split'
import { Icon } from '@/components/icon'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Kbd } from '@/components/ui/kbd'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { DocStoreContext, useActions, useDoc } from '@/store/context'
import { charOfSection, findSection } from '@/store/doc'
import { lockRandom, rerollRandom, selectedRandomTags } from '@/components/editor/random-ops'
import { useDnd } from '@/store/dnd'
import { useConnected } from '@/store/nai'
import { ASSIST_W, usePrefs } from '@/store/prefs'
import { saveTab } from '@/store/save-close'
import { getDocStore, useTabs, useTabUnsaved } from '@/store/tabs'
import { useUi } from '@/store/ui'
import { StartPage } from './start-page'

function forkActive() {
  useTabs.getState().forkTab()
  toast('已 fork 当前 tab', { id: 'fork-tab' })
}

const SLIDE = 'transition-[grid-template-columns] duration-200 ease-(--ease-out) motion-reduce:transition-none'

export function EditorPage() {
  const activeId = useTabs((s) => s.activeId)
  const isStart = useTabs((s) => s.starts.includes(s.activeId))
  const assistOpen = usePrefs((s) => s.assistOpen)
  const assistW = usePrefs((s) => s.assistW)
  return (
    <div
      className={cn(
        'grid h-full min-h-0 grid-cols-[var(--as)_minmax(0,1fr)] grid-rows-[auto_minmax(0,1fr)] [--as:0px]',
        SLIDE,
        assistOpen ? 'lg:[--as:var(--assist-w)]' : 'lg:[--as:30px]',
      )}
      style={{ '--assist-w': `${assistW}px` } as CSSProperties}
      data-testid="editor-grid"
    >
      <TabBar />
      <TemplateEditDialog />
      {isStart ? <StartArea key={activeId} tabId={activeId} /> : <DocArea key={activeId} tabId={activeId} />}
    </div>
  )
}

function AssistSlot() {
  const assistOpen = usePrefs((s) => s.assistOpen)
  return (
    <>
      <div className="editor-assistant col-start-1 row-start-2 min-h-0 overflow-hidden *:max-lg:hidden">
        {assistOpen ? (
          <div className="h-full min-w-(--assist-w)">
            <AssistantColumn />
          </div>
        ) : (
          <AssistantRail />
        )}
      </div>
      {assistOpen && <AssistGrip />}
    </>
  )
}

function AssistGrip() {
  const [drag, setDrag] = useState(false)
  const onDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    e.preventDefault()
    const el = e.currentTarget
    const grid = el.parentElement
    if (!grid) return
    el.setPointerCapture(e.pointerId)
    setDrag(true)
    grid.style.transition = 'none'
    const x0 = e.clientX
    const w0 = usePrefs.getState().assistW
    let w = w0
    const move = (ev: PointerEvent) => {
      w = Math.round(Math.max(ASSIST_W.min, Math.min(ASSIST_W.max, w0 + ev.clientX - x0)))
      grid.style.setProperty('--assist-w', `${w}px`)
    }
    const up = () => {
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
      el.removeEventListener('pointercancel', up)
      setDrag(false)
      if (w !== w0) usePrefs.getState().set({ assistW: w })
      requestAnimationFrame(() => (grid.style.transition = ''))
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
    el.addEventListener('pointercancel', up)
  }
  return (
    <div
      className="assist-grip col-start-1 row-start-2 justify-self-end max-lg:hidden"
      role="separator"
      aria-orientation="vertical"
      aria-label="调整助手栏宽度"
      data-drag={drag ? '' : undefined}
      onPointerDown={onDown}
      onDoubleClick={() => usePrefs.getState().set({ assistW: ASSIST_W.def })}
      data-testid="assist-resize"
    />
  )
}

function StartArea({ tabId }: { tabId: string }) {
  return (
    <>
      <div className="col-span-2 col-start-1 row-start-2 min-h-0 bg-work">
        <StartPage tabId={tabId} />
      </div>
    </>
  )
}

function DocArea({ tabId }: { tabId: string }) {
  const store = getDocStore(tabId)
  const exportOpen = usePrefs((s) => s.exportOpen)
  const connected = useConnected()
  const area = useRef<HTMLDivElement>(null)
  const areaW = useAreaWidth(area)
  const fits = rightFits(areaW)

  useHotkeys(
    'mod+enter',
    (e) => {
      if (e.repeat || !connected) return
      e.preventDefault()
      void requestGenerate(tabId, fits && window.innerWidth >= 768)
    },
    { enableOnFormTags: ['input', 'select'] },
    [tabId, connected, fits],
  )

  useHotkeys('mod+z', () => store.temporal.getState().undo(), { preventDefault: true }, [store])
  useHotkeys(['mod+shift+z', 'mod+y'], () => store.temporal.getState().redo(), { preventDefault: true }, [store])
  useHotkeys('mod+d', forkActive, { preventDefault: true })
  useHotkeys('mod+s', () => saveTab(tabId), { preventDefault: true, enableOnFormTags: true, enableOnContentEditable: true }, [tabId])
  useHotkeys('escape', () => !useDnd.getState().dragging && useUi.getState().escape((id) => charOfSection(store.getState().doc, id)), [store])
  useHotkeys(
    'r',
    (e) => {
      const ui = useUi.getState()
      if (useDnd.getState().dragging) return
      if (ui.selectedChipIds.length) {
        const by = selectedRandomTags(store, ui.selectedChipIds)
        if (!by.size) return
        e.preventDefault()
        const doc = store.getState().doc
        const at = [...by.keys()].map((sid) => {
          const chips = findSection(doc, sid)?.section.chips ?? []
          return { sid, idx: chips.flatMap((c, i) => (ui.selectedChipIds.includes(c.id) ? [i] : [])) }
        })
        void Promise.all([...by].map(([sid, tags]) => rerollRandom(store, sid, tags))).then(() => {
          const now = store.getState().doc
          const ids = at.flatMap(({ sid, idx }) => {
            const chips = findSection(now, sid)?.section.chips ?? []
            return idx.flatMap((i) => (chips[i] ? [chips[i].id] : []))
          })
          if (ids.length === 1) useUi.getState().select(ids[0], at[0].sid)
          else if (ids.length) useUi.getState().setSelection(ids)
        })
        return
      }
      const s = ui.focusSectionId ? findSection(store.getState().doc, ui.focusSectionId)?.section : null
      if (!s?.random) return
      e.preventDefault()
      void rerollRandom(store, s.id)
    },
    [store],
  )
  useHotkeys(
    'l',
    (e) => {
      const ui = useUi.getState()
      if (useDnd.getState().dragging) return
      if (ui.selectedChipIds.length) {
        const by = selectedRandomTags(store, ui.selectedChipIds)
        if (!by.size) return
        e.preventDefault()
        for (const [sid, tags] of by) lockRandom(store, sid, tags)
        return
      }
      const s = ui.focusSectionId ? findSection(store.getState().doc, ui.focusSectionId)?.section : null
      if (!s?.random) return
      e.preventDefault()
      lockRandom(store, s.id)
    },
    [store],
  )
  useHotkeys(
    ['delete', 'backspace'],
    () => {
      const ui = useUi.getState()
      if (!ui.selectedChipIds.length || useDnd.getState().dragging) return
      store.getState().removeChips(ui.selectedChipIds)
      if (ui.selectedChipIds.length > 1) ui.setSelection([])
      else ui.select(null)
    },
    [store],
  )

  return (
    <DocStoreContext.Provider value={store}>
      <EditorDnd>
        <AssistSlot />
        <div ref={area} className="group/area relative col-start-2 row-start-2 min-h-0">
          <RightSplit
            open={exportOpen && fits}
            areaW={areaW}
            editor={
              <ScrollArea className="h-full min-h-0 bg-work" data-testid="editor-scroll" data-board="" onClick={() => useUi.getState().blur()}>
                <div className="mx-auto flex max-w-(--editor-max-w) flex-col gap-4 px-6 pt-5 max-md:px-4">
                  <DocHeader tabId={tabId} />
                  <EditorBoard />
                </div>
              </ScrollArea>
            }
            right={exportOpen && fits ? <RightPanel tabId={tabId} /> : <ExportRail blocked={!fits} />}
          />
        </div>
      </EditorDnd>
    </DocStoreContext.Provider>
  )
}

function DocHeader({ tabId }: { tabId: string }) {
  const meta = useDoc((s) => s.doc.meta)
  const actions = useActions()
  const unsaved = useTabUnsaved(tabId)
  return (
    <header className="flex items-center gap-4" onClick={(e) => e.stopPropagation()}>
      <input
        className="min-w-0 flex-1 truncate bg-transparent text-[16px] font-semibold text-ink-1 outline-none placeholder:text-ink-3"
        value={meta.title}
        onChange={(e) => actions.setTitle(e.target.value)}
        onBlur={(e) => (e.currentTarget.scrollLeft = 0)}
        aria-label="标题"
        data-testid="doc-title"
      />
      <div className="flex shrink-0 items-center gap-3 text-[12px] text-ink-2">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="sm" className="text-ink-2" onClick={forkActive} data-testid="fork-tab">
              <Icon icon={GitForkIcon} size={14} />
              fork
            </Button>
          </TooltipTrigger>
          <TooltipContent className="flex items-center gap-2">
            在新 tab 中创建副本<Kbd>Ctrl D</Kbd>
          </TooltipContent>
        </Tooltip>
        {/* Disabled buttons do not receive hover events, so attach the tooltip to their wrapper. */}
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="inline-flex">
              <Button variant="ghost" size="sm" className="text-ink-2" disabled={!unsaved} onClick={() => saveTab(tabId)} data-testid="save-doc">
                <Icon icon={FloppyDiskIcon} size={14} />
                保存
              </Button>
            </span>
          </TooltipTrigger>
          <TooltipContent className="flex items-center gap-2">
            保存至「我的文档」<Kbd>Ctrl S</Kbd>
          </TooltipContent>
        </Tooltip>
        <CleanupMenu />
      </div>
    </header>
  )
}
