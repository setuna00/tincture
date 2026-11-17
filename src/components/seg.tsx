import type { ReactNode } from 'react'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'

export function Seg<T extends string>({
  value,
  onChange,
  options,
  disabled,
  testId,
}: {
  value: T
  onChange: (v: T) => void
  options: Record<T, ReactNode>
  disabled?: boolean
  testId: string
}) {
  return (
    <Tabs value={value} onValueChange={(v) => onChange(v as T)} data-testid={testId}>
      <TabsList className="rounded-md p-0.5 group-data-horizontal/tabs:h-6">
        {(Object.entries(options) as [T, ReactNode][]).map(([k, label]) => (
          <TabsTrigger key={k} value={k} disabled={disabled} className="rounded-[4px] px-2 text-[12px]" data-testid={`${testId}-${k}`}>
            {label}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  )
}
