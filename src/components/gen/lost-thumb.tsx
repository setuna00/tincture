import { ImageNotFound01Icon } from '@hugeicons/core-free-icons'
import { Icon } from '@/components/icon'
import { Tip } from '@/components/tip'

export function LostThumb() {
  return (
    <Tip label="图片文件已丢失">
      <span className="absolute inset-0 grid place-items-center bg-surface-2 text-ink-3" data-testid="history-lost">
        <Icon icon={ImageNotFound01Icon} size={16} />
      </span>
    </Tip>
  )
}
