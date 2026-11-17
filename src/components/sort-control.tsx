import { ArrowDown02Icon, ArrowUp02Icon, Sorting01Icon } from '@hugeicons/core-free-icons'
import { Icon } from '@/components/icon'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

export function SortControl<T extends string>({
  by,
  options,
  labels,
  desc,
  dirLabel,
  onBy,
  onFlip,
  testId,
}: {
  by: T
  options: readonly T[]
  labels: Record<T, string>
  desc: boolean
  dirLabel: string
  onBy: (by: T) => void
  onFlip: () => void
  testId: string
}) {
  return (
    <div className="flex h-7 shrink-0 items-center rounded-md border border-border bg-background shadow-xs" data-testid={`${testId}-sort-group`}>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" className="h-full gap-1.5 rounded-r-none pr-2 pl-2.5 text-[12px] font-normal text-ink-2" aria-label={`排序：${labels[by]}`} data-testid={`${testId}-sort`}>
            <Icon icon={Sorting01Icon} size={14} className="text-ink-2" />
            {labels[by]}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-36" data-testid={`${testId}-sort-menu`}>
          <DropdownMenuLabel className="text-ink-3">排序方式</DropdownMenuLabel>
          <DropdownMenuRadioGroup value={by} onValueChange={(v) => onBy(v as T)}>
            {options.map((o) => (
              <DropdownMenuRadioItem key={o} value={o} className="text-[13px]" data-testid={`${testId}-sort-${o}`}>
                {labels[o]}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      <span className="h-4 w-px bg-line" />
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="ghost" size="icon" className="h-full w-7 rounded-l-none text-ink-2" onClick={onFlip} aria-label={dirLabel} data-testid={`${testId}-sort-dir`} data-desc={desc ? '' : undefined}>
            <Icon icon={desc ? ArrowDown02Icon : ArrowUp02Icon} size={16} />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{dirLabel}（点击反转）</TooltipContent>
      </Tooltip>
    </div>
  )
}
