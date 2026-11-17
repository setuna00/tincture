import { useRef, useState, type ReactNode } from 'react'
import { Dialog as DialogPrimitive } from 'radix-ui'
import { ArrowUp01Icon } from '@hugeicons/core-free-icons'
import { paramsSummary } from '@/components/foot'
import { Icon } from '@/components/icon'
import { SettingsPanel } from '@/components/settings-panel'
import { Tip } from '@/components/tip'
import { ScrollArea } from '@/components/ui/scroll-area'
import { SAMPLER_NAMES } from '@/lib/nai-image'
import { effectiveSettings } from '@/lib/nai-write'
import { cn } from '@/lib/utils'
import { useDoc } from '@/store/context'
import { useParamsPanel } from '@/store/right-panel'

const setOpen = (open: boolean) => useParamsPanel.setState({ open })

export function ParamsRoot({ children }: { children: ReactNode }) {
  const open = useParamsPanel((s) => s.open)
  return (
    <DialogPrimitive.Root open={open} onOpenChange={setOpen} modal={false}>
      {children}
    </DialogPrimitive.Root>
  )
}

type Cell = { key: string; label: string; value: string; muted?: boolean; optional?: boolean; grow?: boolean }

export function ParamsCard() {
  const open = useParamsPanel((s) => s.open)
  const settings = useDoc((s) => s.doc.settings)
  const g = effectiveSettings(settings).gen
  const cells: Cell[] = [
    { key: 'size', label: '尺寸', value: `${g.width} × ${g.height}` },
    { key: 'steps', label: '步数', value: String(g.steps) },
    { key: 'scale', label: '引导', value: String(g.scale), optional: true },
    { key: 'seed', label: 'Seed', value: g.seed == null ? '随机' : String(g.seed), muted: g.seed == null, optional: true },
    ...(g.cfgRescale ? [{ key: 'rescale', label: 'Rescale', value: String(g.cfgRescale) }] : []),
    { key: 'sampler', label: '采样', value: SAMPLER_NAMES[g.sampler] ?? g.sampler, grow: true },
  ]
  const ref = useRef<HTMLDivElement>(null)
  const [cut, setCut] = useState(false)
  const measure = () => {
    const el = ref.current
    if (!el) return setCut(false)
    const hidden = [...el.querySelectorAll<HTMLElement>('[data-optional]')].some((x) => getComputedStyle(x).display === 'none')
    const v = el.querySelector<HTMLElement>('[data-grow] [data-value]')
    setCut(hidden || (!!v && v.scrollWidth > v.clientWidth))
  }
  return (
    // Nest the tooltip inside the trigger so its data-state cannot replace the dialog open/closed state.
    <DialogPrimitive.Trigger asChild>
      <Tip label={cut ? paramsSummary(settings) : '参数'}>
        <button
          type="button"
          className="@container flex w-full min-w-0 items-center gap-2 rounded-lg border border-line-strong bg-work py-2 pr-2.5 pl-3 text-left outline-none transition-colors duration-150 hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-(--accent-text) aria-pressed:bg-line aria-pressed:hover:bg-line"
          onPointerEnter={measure}
          onFocus={measure}
          aria-pressed={open}
          aria-label="参数"
          data-testid="params-button"
        >
          <div ref={ref} className="flex min-w-0 flex-1 gap-4 @max-[400px]:gap-3" data-testid="gen-summary">
            {cells.map((c) => (
              <div
                key={c.key}
                className={cn('flex flex-col gap-0.5', c.grow ? 'min-w-0 flex-1' : 'shrink-0', c.optional && '@max-[400px]:hidden')}
                data-optional={c.optional ? '' : undefined}
                data-grow={c.grow ? '' : undefined}
                data-cell={c.key}
              >
                <span className="text-[11px] leading-4 text-ink-2">{c.label}</span>
                <span className={cn('truncate text-[13px] leading-5 tabular-nums', c.muted ? 'font-medium text-ink-2' : 'font-semibold text-ink-1')} data-value>
                  {c.value}
                </span>
              </div>
            ))}
          </div>
          <Icon icon={ArrowUp01Icon} size={16} className={cn('shrink-0 text-ink-2 transition-transform duration-200 ease-(--ease-out)', open && 'rotate-180')} />
        </button>
      </Tip>
    </DialogPrimitive.Trigger>
  )
}

const focusInParams = () => !!document.activeElement?.closest('[data-testid=params-panel], [data-testid=params-button]')

export function ParamsLayer() {
  return (
    <DialogPrimitive.Content
      className="absolute inset-0 z-20 flex flex-col bg-shell outline-none duration-200 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:slide-out-to-bottom-2 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:slide-in-from-bottom-2 motion-reduce:animate-none"
      onOpenAutoFocus={(e) => e.preventDefault()}
      onInteractOutside={(e) => e.preventDefault()}
      onEscapeKeyDown={(e) => {
        if (!focusInParams()) e.preventDefault()
      }}
      aria-describedby={undefined}
      data-testid="params-panel"
    >
      <DialogPrimitive.Title className="sr-only">参数</DialogPrimitive.Title>
      <ScrollArea className="x-scroll min-h-0 flex-1">
        <SettingsPanel />
      </ScrollArea>
    </DialogPrimitive.Content>
  )
}
