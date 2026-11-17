import { useDraftField } from '@/components/draft-field'
import { StepButton } from '@/components/step-button'
import { Tip } from '@/components/tip'
import { cn } from '@/lib/utils'

export function Stepper({
  label,
  tip,
  value,
  min,
  max,
  onChange,
  testId,
  step = 0.05,
  fine = 0.01,
  digits = 2,
  className,
  disabled = false,
}: {
  label: string
  tip: string
  value: number
  min: number
  max: number
  onChange: (v: number) => void
  testId: string
  step?: number
  fine?: number
  digits?: number
  className?: string
  disabled?: boolean
}) {
  const put = (x: number) => {
    const v = Math.min(max, Math.max(min, Math.round(x * 10 ** digits) / 10 ** digits))
    if (v !== value) onChange(v)
    field.reset()
  }
  const field = useDraftField({
    value: value.toFixed(digits),
    enterBlurs: true,
    onCommit: (t) => {
      const x = Number(t)
      if (t !== '' && Number.isFinite(x)) put(x)
    },
  })
  return (
    <div className={cn('flex h-6 items-center rounded-md bg-surface-2 pr-0.5 pl-2 text-[12px]', disabled && '[&_button]:invisible', className)} data-testid={testId} data-disabled={disabled ? '' : undefined}>
      <Tip label={tip}>
        <span className="mr-1 min-w-0 flex-1 cursor-default truncate text-ink-2 transition-colors duration-150 hover:text-ink-1">{label}</span>
      </Tip>
      <StepButton label={label} direction="dec" disabled={disabled || value <= min} onClick={() => put(value - step)} testId={testId} />
      <input
        className="h-5 w-[34px] rounded-[4px] border border-transparent bg-transparent p-0 text-center text-[12px] text-ink-1 tabular-nums outline-none transition-colors duration-150 hover:border-line-strong focus:border-(--accent-text) focus:bg-work"
        inputMode="decimal"
        disabled={disabled}
        aria-label={label}
        {...field.props}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === 'Escape') field.props.onKeyDown(e)
          else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault()
            put(value + (e.key === 'ArrowUp' ? fine : -fine))
          } else return
          e.stopPropagation()
        }}
        data-testid={`${testId}-input`}
      />
      <StepButton label={label} direction="inc" disabled={disabled || value >= max} onClick={() => put(value + step)} testId={testId} />
    </div>
  )
}
