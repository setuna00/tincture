import { formatWeight } from '@/lib/nai'

export const PRESETS = [0.5, 0.8, 1, 1.2, 1.5, -1]

export function weightText(w: number) {
  const s = formatWeight(w)
  return (s.split('.')[1]?.length ?? 0) > 2 ? s : w.toFixed(2)
}
