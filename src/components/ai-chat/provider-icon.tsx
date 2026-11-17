import { SparklesIcon } from '@hugeicons/core-free-icons'
import { Icon } from '@/components/icon'
import { cn } from '@/lib/utils'
import { PROVIDER_ICONS } from './provider-icons'

export function ProviderIcon({ preset, size = 20, className }: { preset: string | undefined; size?: number; className?: string }) {
  const svg = preset ? PROVIDER_ICONS[preset] : undefined
  return (
    <span className={cn('grid shrink-0 place-items-center text-ink-1 [&>svg]:size-full', className)} style={{ width: size, height: size }} data-testid="ai-provider-icon" data-preset={preset ?? ''}>
      {svg ? <span className="contents" dangerouslySetInnerHTML={{ __html: svg }} /> : <Icon icon={SparklesIcon} size={size} />}
    </span>
  )
}
