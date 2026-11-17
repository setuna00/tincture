import { Slider } from '@/components/ui/slider'
import { StepButton } from '@/components/step-button'

export function SliderSteps({ label, value, min, max, step, disabled, onChange, className, testId }: { label: string; value: number; min: number; max: number; step: number; disabled?: boolean; onChange: (value: number) => void; className?: string; testId: string }) {
  return (
    <div className="flex min-w-0 flex-1 items-center gap-1">
      <StepButton label={label} direction="dec" disabled={disabled || value <= min} onClick={() => onChange(Math.max(min, value - step))} testId={testId} />
      <Slider className={className} value={[Math.min(max, value)]} min={min} max={max} step={step} disabled={disabled} onValueChange={([v]) => onChange(v)} aria-label={label} data-testid={testId} />
      <StepButton label={label} direction="inc" disabled={disabled || value >= max} onClick={() => onChange(Math.min(max, value + step))} testId={testId} />
    </div>
  )
}
