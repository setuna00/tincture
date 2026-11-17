import { useEffect, useRef, type ReactNode, type Ref, type RefObject } from 'react'
import { PricePill } from '@/components/anlas'
import { Tip } from '@/components/tip'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent } from '@/components/ui/popover'
import { PRICE_TOO_LONG } from '@/lib/nai-api'
import { useGen } from '@/store/gen'
import { useRunGuard } from './run-guard'

export function SpendPopover({ open, onCancel, onBusy = onCancel, anchor, children }: { open: boolean; onCancel: () => void; onBusy?: () => void; anchor: ReactNode; children: ReactNode }) {
  const running = useGen((s) => !!s.running)
  useEffect(() => {
    if (open && running) onBusy()
  }, [open, running, onBusy])
  return (
    <Popover open={open && !running} onOpenChange={(o) => !o && onCancel()}>
      {anchor}
      {children}
    </Popover>
  )
}

export function SpendConfirm({
  title,
  desc,
  notes,
  children,
  label,
  price,
  runTip,
  onRun,
  onCancel,
  refocus,
  runRef,
  align,
  ids,
  data,
}: {
  title: ReactNode
  desc: ReactNode
  notes?: ReactNode
  children?: ReactNode
  label: string
  price: number
  runTip?: ReactNode
  onRun: () => void
  onCancel: () => void
  refocus?: HTMLElement | null
  runRef?: RefObject<HTMLButtonElement | null>
  align: 'start' | 'end'
  ids: { box: string; cancel: string; run: string; price?: string }
  data?: Record<`data-${string}`, string | undefined>
}) {
  const own = useRef<HTMLButtonElement>(null)
  const go = runRef ?? own
  const back = useRef<HTMLElement | null>(null)
  return (
    <PopoverContent
      align={align}
      side="top"
      className="flex w-[300px] flex-col gap-3 p-3"
      onOpenAutoFocus={(e) => {
        e.preventDefault()
        back.current = refocus ?? null
        go.current?.focus()
      }}
      onCloseAutoFocus={(e) => {
        const el = back.current
        back.current = null
        if (!el?.isConnected) return
        e.preventDefault()
        el.focus()
      }}
      data-testid={ids.box}
      {...data}
    >
      <div className="flex flex-col gap-1">
        <span className="text-[13px] font-semibold text-ink-1">{title}</span>
        <p className="text-[12px] leading-[18px] text-pretty text-ink-2">{desc}</p>
        {notes}
      </div>
      {children}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" size="sm" className="h-7 px-2.5 text-[12px]" onClick={onCancel} data-testid={ids.cancel}>
          取消
        </Button>
        <RunButton ref={go} label={label} price={price} tip={runTip} onRun={onRun} testId={ids.run} priceTestId={ids.price} />
      </div>
    </PopoverContent>
  )
}

/** Mount the guard with the popover content so its protection window starts when Anlas confirmation becomes visible. */
function RunButton({ ref, label, price, tip, onRun, testId, priceTestId }: { ref: Ref<HTMLButtonElement>; label: string; price: number; tip?: ReactNode; onRun: () => void; testId: string; priceTestId?: string }) {
  const guard = useRunGuard(onRun)
  const cannot = price === PRICE_TOO_LONG
  return (
    <Tip label={tip}>
      <Button ref={ref} size="sm" className="h-7 gap-1.5 px-2.5 text-[12px] font-semibold" disabled={cannot} {...guard} data-testid={testId}>
        {label}
        {!cannot && <PricePill n={price} tone="on" testId={priceTestId} />}
      </Button>
    </Tip>
  )
}
