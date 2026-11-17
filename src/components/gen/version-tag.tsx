import { AiChat02Icon } from '@hugeicons/core-free-icons'
import { Icon } from '@/components/icon'
import { cn } from '@/lib/utils'

export function VersionTag({ n, current, next, ai, className }: { n: number; current?: boolean; next?: boolean; ai?: boolean; className?: string }) {
  return (
    <span
      className={cn('inline-flex shrink-0 items-center gap-1 tabular-nums', next && 'rounded-[4px] border border-dashed border-line-strong px-1 leading-4', className)}
      data-testid="version-tag"
      data-current={current ? '' : undefined}
      data-next={next ? '' : undefined}
    >
      {current && <span className="size-1.5 shrink-0 rounded-full bg-lamp" role="img" aria-label="当前内容" data-testid="version-dot" />}
      <span>v{n}</span>
      {ai && <AiMark />}
    </span>
  )
}

export function AiMark({ size = 12 }: { size?: number }) {
  return (
    <span role="img" aria-label="AI 修改" className="inline-flex shrink-0 text-lamp-text" data-testid="ai-mark">
      <Icon icon={AiChat02Icon} size={size} />
    </span>
  )
}
