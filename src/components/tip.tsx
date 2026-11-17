// Forward outer trigger props over the tooltip props so tooltip data-state cannot replace menu or dialog state.
import type { ReactElement, ReactNode } from 'react'
import { Slot } from 'radix-ui'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

type Side = 'top' | 'right' | 'bottom' | 'left'

export function Tip({ label, side, sideOffset, children, ...rest }: { label?: ReactNode; side?: Side; sideOffset?: number; children: ReactElement } & Record<string, unknown>) {
  if (!label) return <Slot.Root {...rest}>{children}</Slot.Root>
  return (
    <Tooltip>
      <TooltipTrigger asChild {...rest}>
        {children}
      </TooltipTrigger>
      <TooltipContent side={side} sideOffset={sideOffset} className="whitespace-pre-line">
        {label}
      </TooltipContent>
    </Tooltip>
  )
}
