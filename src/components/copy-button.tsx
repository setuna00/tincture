import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Copy01Icon, Tick02Icon } from '@hugeicons/core-free-icons'
import { Icon } from '@/components/icon'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export async function copyText(text: string, what: string) {
  try {
    await navigator.clipboard.writeText(text)
    toast.success(`已复制${what}`)
    return true
  } catch {
    toast.error('复制失败：无剪贴板权限')
    return false
  }
}

export function CopyButton({
  text,
  what,
  label = '复制',
  size = 'xs',
  className,
  testId,
}: {
  text: string
  what: string
  label?: string
  size?: 'xs' | 'default'
  className?: string
  testId?: string
}) {
  const [done, setDone] = useState(false)
  useEffect(() => {
    if (!done) return
    const t = setTimeout(() => setDone(false), 1200)
    return () => clearTimeout(t)
  }, [done])
  return (
    <Button
      variant="outline"
      size={size}
      className={cn('gap-1 text-ink-2 data-[done]:border-lamp-text data-[done]:text-lamp-text', className)}
      data-done={done ? '' : undefined}
      disabled={!text}
      onClick={async (e) => {
        e.stopPropagation()
        setDone(await copyText(text, what))
      }}
      data-testid={testId}
    >
      <Icon icon={done ? Tick02Icon : Copy01Icon} size={14} />
      {done ? '已复制' : label}
    </Button>
  )
}
