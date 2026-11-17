import { cn } from '@/lib/utils'

export function AnlasIcon({ className }: { className?: string }) {
  return (
    // shadcn overrides SVG dimensions unless the class name contains size-.
    <svg className={cn('anlas-size-fixed block h-[9px] w-[10px] shrink-0 -translate-y-[0.5px]', className)} viewBox="0 0 10 9" fill="currentColor" aria-hidden>
      <path d="M4.4 0h1.2l1.6 1.6L5.5 9h-1L2.8 1.6z" />
      <path d="M7.4 9L10 5V4.4L8.7 3.1l-.5.1L6.9 9z" />
      <path d="M2.6 9L0 5V4.4l1.3-1.3.5.1L3.1 9z" />
    </svg>
  )
}

const fmtAnlas = (n: number) => n.toLocaleString('en-US')

export function Anlas({ n, className, testId }: { n: number; className?: string; testId?: string }) {
  return (
    <span className={cn('inline-flex h-4 items-center gap-[3px] text-[12px] leading-4 font-medium tracking-normal whitespace-nowrap tabular-nums', className)} aria-label={`${fmtAnlas(n)} Anlas`} data-testid={testId}>
      <span aria-hidden>{fmtAnlas(n)}</span>
      <AnlasIcon />
    </span>
  )
}

export function PricePill({ n, tone, className, testId }: { n: number; tone?: 'on'; className?: string; testId?: string }) {
  return (
    <span
      className={cn('inline-flex h-[18px] shrink-0 items-center rounded-[4px] px-[5px]', tone === 'on' ? 'bg-(--price-on-bg) text-(--price-on)' : 'bg-(--price-bg) text-(--price)', className)}
      data-testid={testId}
    >
      <Anlas n={n} />
    </span>
  )
}
