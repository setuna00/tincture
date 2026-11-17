import type { Chip } from '@/types'

export interface UsageSource {
  place: string
  chips: Pick<Chip, 'type' | 'text'>[]
}

export function collectUsage(sources: UsageSource[], official: (text: string) => string): Map<string, string[]> {
  const out = new Map<string, string[]>()
  for (const s of sources)
    for (const c of s.chips) {
      if (c.type !== 'tag' && c.type !== 'interaction') continue
      const k = official(c.text)
      const list = out.get(k) ?? out.set(k, []).get(k)!
      if (!list.includes(s.place)) list.push(s.place)
    }
  return out
}
