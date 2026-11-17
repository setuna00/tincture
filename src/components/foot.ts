import { SAMPLER_NAMES } from '@/lib/nai-image'
import { effectiveSettings } from '@/lib/nai-write'
import type { DocSettings } from '@/types'

export const FOOT = 'flex shrink-0 flex-col gap-2 px-3 pt-2.5 pb-3'
export const FIXED_TOP = 'relative z-[1] border-t border-line-strong shadow-[0_-10px_14px_-12px_oklch(0_0_0/.35)]'
export const FIXED_SHADOW = 'before:shadow-[0_-10px_14px_-12px_oklch(0_0_0/.35)]'
export const MAIN_BUTTON = 'h-11 w-full rounded-md text-[14px] font-semibold'

export function paramsSummary(s: DocSettings): string {
  const g = effectiveSettings(s).gen
  const parts = [`${g.width} × ${g.height}`, `${g.steps} 步`, `引导 ${g.scale}`, SAMPLER_NAMES[g.sampler] ?? g.sampler]
  if (g.seed != null) parts.push(`seed ${g.seed}`)
  if (g.cfgRescale) parts.push(`Rescale ${g.cfgRescale}`)
  return parts.join(' · ')
}
