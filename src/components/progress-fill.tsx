export function ProgressFill({ value }: { value: number | 'indeterminate' }) {
  if (value === 'indeterminate') return <span aria-hidden className="progress-indeterminate pointer-events-none absolute inset-y-0 w-[35%] bg-black/14" data-testid="progress-fill" />
  return (
    <span
      aria-hidden
      className="pointer-events-none absolute inset-y-0 left-0 bg-black/14 transition-[width] duration-300 ease-linear motion-reduce:transition-none"
      style={{ width: `${Math.round(Math.min(1, Math.max(0, value)) * 100)}%` }}
      data-testid="progress-fill"
    />
  )
}
