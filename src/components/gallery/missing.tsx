import type { CSSProperties } from 'react'
import { ImageNotFound01Icon } from '@hugeicons/core-free-icons'
import { Icon } from '@/components/icon'
import { cn } from '@/lib/utils'

export function MissingFile({ className, style, dark }: { className?: string; style?: CSSProperties; dark?: boolean }) {
  return (
    <div className={cn('flex flex-col items-center justify-center gap-2 rounded-md text-[12px]', dark ? 'text-white/70' : 'bg-surface-2 text-ink-3', className)} style={style} data-testid="gallery-missing">
      <Icon icon={ImageNotFound01Icon} size={24} />
      图片文件已丢失
    </div>
  )
}
