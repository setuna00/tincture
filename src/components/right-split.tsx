import { useEffect, useRef, useState, type ReactNode } from 'react'
import { usePanelRef } from 'react-resizable-panels'
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable'
import { cn } from '@/lib/utils'
import { usePrefs } from '@/store/prefs'
import { RAIL_W, RIGHT_MIN, rightDefault, rightMax } from './gen/layout'

export function RightSplit({ open, areaW, editor, right }: { open: boolean; areaW: number; editor: ReactNode; right: ReactNode }) {
  const pref = usePrefs((s) => s.rightW)
  const panel = usePanelRef()
  const min = open ? RIGHT_MIN : RAIL_W
  const max = open ? rightMax(areaW) : RAIL_W
  const target = Math.min(max, Math.max(min, pref ?? rightDefault(areaW)))

  // Wait one frame for new panel constraints to register; resizing earlier is clamped by the previous minimum.
  const [animate, setAnimate] = useState(false)
  const mounted = useRef(false)
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true
      return
    }
    setAnimate(true)
    const f = requestAnimationFrame(() => panel.current?.resize(target))
    const t = setTimeout(() => setAnimate(false), 300)
    return () => (cancelAnimationFrame(f), clearTimeout(t))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  useEffect(() => {
    if (!areaW || !open) return
    const f = requestAnimationFrame(() => panel.current?.resize(target))
    return () => cancelAnimationFrame(f)
  }, [areaW, open, pref, target, panel])

  const save = (w: number) => usePrefs.getState().set({ rightW: Math.round(w) })
  if (!areaW) return null
  const rightPercent = (target / (areaW - 1)) * 100
  return (
    <ResizablePanelGroup
      defaultLayout={{ 'editor-panel': 100 - rightPercent, 'right-panel': rightPercent }}
      orientation="horizontal"
      className={cn('right-split', 'max-md:[&>[data-panel]:last-child]:hidden! max-md:[&>[data-separator]]:hidden!')}
      data-animate={animate ? '' : undefined}
      resizeTargetMinimumSize={{ fine: 4, coarse: 20 }}
      onLayoutChanged={(_, meta) => {
        if (meta.isUserInteraction && open && panel.current) save(panel.current.getSize().inPixels)
      }}
    >
      <ResizablePanel id="editor-panel" groupResizeBehavior="preserve-relative-size" style={{ overflow: 'hidden' }}>
        {editor}
      </ResizablePanel>
      <ResizableHandle
        className="z-10 bg-line transition-colors duration-150 after:transition-colors after:duration-150 data-[separator=active]:after:bg-(--accent) data-[separator=hover]:after:bg-(--accent) data-[separator=disabled]:cursor-default"
        disabled={!open}
        disableDoubleClick
        onDoubleClick={() => {
          if (!open) return
          setAnimate(true)
          requestAnimationFrame(() => panel.current?.resize(Math.min(max, rightDefault(areaW))))
          usePrefs.getState().set({ rightW: null })
          setTimeout(() => setAnimate(false), 300)
        }}
        aria-label="调整右栏宽度"
        data-testid="right-resize"
      />
      <ResizablePanel
        id="right-panel"
        panelRef={panel}
        defaultSize={target}
        minSize={min}
        maxSize={Number.isFinite(max) ? max : undefined}
        disabled={!open}
        groupResizeBehavior="preserve-pixel-size"
        style={{ overflow: 'hidden' }}
      >
        <div className="h-full" style={{ minWidth: animate ? target : undefined }}>
          {right}
        </div>
      </ResizablePanel>
    </ResizablePanelGroup>
  )
}
