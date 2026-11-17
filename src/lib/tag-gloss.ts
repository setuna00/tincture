import type { Chip, TagEntry } from '@/types'

export interface GlossTarget {
  name: string
  nai: boolean
  renamed: boolean
}

export function glossTarget(chip: Pick<Chip, 'type' | 'text'>, base: string | null, lookup: (name: string) => TagEntry | undefined): GlossTarget | null {
  if (chip.type !== 'tag' && chip.type !== 'interaction') return null
  const t = base ? lookup(base) : undefined
  if (!t || t.category === 'artist') return null
  return { name: t.name, nai: !!t.nai, renamed: t.old === 2 }
}
