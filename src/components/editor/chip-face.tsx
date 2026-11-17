import type { CSSProperties } from 'react'
import { ArrowDataTransferHorizontalIcon } from '@hugeicons/core-free-icons'
import { Icon } from '@/components/icon'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { chipStatus, type TagStatus } from '@/lib/doc-check'
import { formatWeightShort } from '@/lib/nai'
import { chipCategory, chipZh } from '@/lib/tagdb'
import { useLibrary } from '@/store/library'
import type { Chip } from '@/types'

export type { TagStatus }

export function tagStatus(chip: Pick<Chip, 'type' | 'text'>): { status: TagStatus; base: string | null } {
  return chipStatus(chip, useLibrary.getState().variants)
}

export function weightIntensity(w: number) {
  if (w < 0) return 1
  return Math.min(1, Math.abs(w - 1) / 0.5)
}

export function chipAttrs(chip: Chip) {
  const zh = chipZh(chip)
  const st = tagStatus(chip)
  return {
    'data-cat': st.status === 'variant' || st.status === 'alias' ? chipCategory({ ...chip, text: st.base! }) : st.status === 'unknown' ? 'text' : chipCategory(chip),
    'data-unknown': st.status === 'unknown' ? '' : undefined,
    'data-alias': st.status === 'alias' ? '' : undefined,
    'data-neg': chip.weight < 0 ? '' : undefined,
    'data-disabled': chip.disabled ? '' : undefined,
    'data-has-zh': zh ? '' : undefined,
    'data-chip-id': chip.id,
  }
}

const PREFIX: Partial<Record<Chip['type'], (c: Chip) => string>> = {
  artist: () => 'artist:',
  meta: () => 'meta:',
  year: () => 'year ',
  interaction: (c) => `${c.interaction ?? 'mutual'}#`,
  textrender: () => 'Text:',
}

export function WeightSeg({ weight }: { weight: number }) {
  if (weight === 1) return null
  const dir = weight < 0 ? 'neg' : weight > 1 ? 'up' : 'down'
  return (
    <span className="chip-w" data-dir={dir} style={{ '--wi': weightIntensity(weight) } as CSSProperties} data-testid="chip-weight">
      {formatWeightShort(weight)}
    </span>
  )
}

function AliasMark({ base }: { base: string | null }) {
  const icon = <Icon icon={ArrowDataTransferHorizontalIcon} size={14} />
  return (
    <span className="chip-alias" data-on={base ? '' : undefined} aria-hidden={!base} data-testid="chip-alias">
      {base ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="grid place-items-center">{icon}</span>
          </TooltipTrigger>
          <TooltipContent side="top" data-testid="chip-alias-tip">
            Danbooru 别名，正式写法为 {base}
          </TooltipContent>
        </Tooltip>
      ) : (
        icon
      )}
    </span>
  )
}

export function ChipFace({ chip }: { chip: Chip }) {
  const zh = chipZh(chip)
  const prefix = PREFIX[chip.type]?.(chip)
  const st = tagStatus(chip)
  return (
    <>
      <AliasMark base={st.status === 'alias' ? st.base : null} />
      <WeightSeg weight={chip.weight} />
      <span className="chip-body">
        <span className="chip-en">
          {prefix && <span className="chip-prefix">{prefix}</span>}
          <span className="chip-text">{chip.text}</span>
        </span>
        {zh && <span className="chip-zh">{zh}</span>}
      </span>
    </>
  )
}
