import type { ComponentType, CSSProperties, ReactNode } from 'react'
import { Add01Icon, Album02Icon, StarIcon } from '@hugeicons/core-free-icons'
import type { AfterMenu } from '@/components/after-menu'
import { Icon } from '@/components/icon'
import { addToDir, createDir, removeFromDir, toggleFav, useMarks } from '@/store/gallery'

interface ItemProps {
  onSelect?: (e: Event) => void
  children?: ReactNode
  className?: string
  'data-testid'?: string
}
interface CheckProps extends ItemProps {
  checked?: boolean | 'indeterminate'
  style?: CSSProperties
  'data-dir'?: string
}

export function DirChoices({ ids, Item, Check, Separator, later }: { ids: readonly string[]; Item: ComponentType<ItemProps>; Check: ComponentType<CheckProps>; Separator: ComponentType; later: AfterMenu['later'] }) {
  const dirs = useMarks((s) => s.dirs)
  const fav = useMarks((s) => s.fav)
  const state = (has: (id: string) => boolean) => {
    const n = ids.filter(has).length
    return n === ids.length ? true : n ? ('indeterminate' as const) : false
  }
  const favState = state((id) => !!fav[id])
  return (
    <>
      <Check
        checked={favState}
        onSelect={(e) => {
          e.preventDefault()
          toggleFav(ids)
        }}
        className="text-[13px]"
        data-testid="gallery-dir-choice"
        data-dir="fav"
      >
        <Icon icon={StarIcon} size={14} />
        <span className="truncate">收藏</span>
      </Check>
      {[...dirs]
        .sort((a, b) => a.createdAt - b.createdAt)
        .map((dir) => {
          const checked = state((id) => !!dir.items[id])
          return (
            <Check
              key={dir.id}
              checked={checked}
              onSelect={(e) => {
                e.preventDefault()
                if (checked === true) removeFromDir(dir.id, ids)
                else addToDir(dir.id, ids)
              }}
              className="text-[13px]"
              data-testid="gallery-dir-choice"
              data-dir={dir.id}
            >
              <Icon icon={Album02Icon} size={14} />
              <span className="truncate">{dir.name}</span>
            </Check>
          )
        })}
      <Separator />
      <Item onSelect={() => later(() => createDir(ids))} className="text-[13px]" data-testid="gallery-dir-new">
        <Icon icon={Add01Icon} size={14} />
        新建合集
      </Item>
    </>
  )
}
