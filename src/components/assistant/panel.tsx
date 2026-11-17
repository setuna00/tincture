import { useState, type ReactNode } from 'react'
import { ArrowDown01Icon, ArrowRight01Icon, SidebarLeftIcon } from '@hugeicons/core-free-icons'
import { Icon } from '@/components/icon'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { usePrefs } from '@/store/prefs'

export function PaneHeader({ title, count, children, testId, corner }: { title: ReactNode; count?: number; children?: ReactNode; testId?: string; corner?: boolean }) {
  return (
    <header className={cn('app-drag flex h-9 shrink-0 items-center gap-1.5 border-b border-line pl-3', corner ? 'pr-[max(0.375rem,var(--wco-w))]' : 'pr-1.5')} data-testid={testId}>
      <span className="pane-title">{title}</span>
      {count !== undefined && <span className="text-[11px] text-ink-2 tabular-nums">{count}</span>}
      <div className="ml-auto flex min-w-0 items-center gap-0.5">{children}</div>
    </header>
  )
}

export function AssistCollapse() {
  return (
    <>
      <span className="mx-1 h-4 w-px bg-line" />
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="ghost" size="icon-sm" className="text-ink-2" onClick={() => usePrefs.getState().set({ assistOpen: false })} aria-label="收起助手栏" data-testid="assist-collapse">
            <Icon icon={SidebarLeftIcon} size={16} />
          </Button>
        </TooltipTrigger>
        <TooltipContent>收起助手栏</TooltipContent>
      </Tooltip>
    </>
  )
}

export function SubSection({ id, title, hint, children }: { id: string; title: string; hint?: string; children: ReactNode }) {
  const collapsed = usePrefs((s) => !!s.collapsed[id])
  const toggle = usePrefs((s) => s.togglePanel)
  return (
    <div className="flex flex-col gap-1.5" data-testid={id} data-collapsed={collapsed ? '' : undefined}>
      <button type="button" className="-ml-1 flex items-baseline gap-1.5 rounded-sm px-1 text-left hover:bg-surface-2" onClick={() => toggle(id)} aria-expanded={!collapsed} data-testid={`${id}-toggle`}>
        <Icon icon={collapsed ? ArrowRight01Icon : ArrowDown01Icon} size={14} className="self-center text-ink-2" />
        <span className="shrink-0 text-[12px] font-medium whitespace-nowrap text-ink-2">{title}</span>
        {hint && <span className="truncate text-[11px] text-ink-2">{hint}</span>}
      </button>
      {!collapsed && children}
    </div>
  )
}

export function useShowMore<T>(items: T[], limit: number, resetKey: string) {
  const [openFor, setOpenFor] = useState<string | null>(null)
  const expanded = openFor === resetKey
  const shown = expanded ? items : items.slice(0, limit)
  return { shown, hidden: items.length - shown.length, expand: () => setOpenFor(resetKey) }
}

export function ShowMore({ hidden, onClick, testId }: { hidden: number; onClick: () => void; testId?: string }) {
  if (hidden <= 0) return null
  return (
    <button type="button" className="text-[11px] text-ink-2 hover:text-lamp-text" onClick={onClick} data-testid={testId}>
      … 显示更多（{hidden}）
    </button>
  )
}
