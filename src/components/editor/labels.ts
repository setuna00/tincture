import { characterLabel } from '@/lib/character-label'
import type { BoxRef, Doc, QualityPreset, SectionColor, UcPreset } from '@/types'
import { SECTION_COLORS } from '@/types'

export function boxLabel(doc: Doc, box: BoxRef): string {
  const field = box.field === 'prompt' ? '正面' : '负面'
  if (box.kind === 'base') return box.field === 'prompt' ? '正面 Prompt' : '负面 UC'
  const c = doc.characters.find((c) => c.id === box.charId)
  return `${c ? characterLabel(doc, c) : '角色'} · ${field}`
}

export function sectionVars(color: SectionColor) {
  const { h, c } = SECTION_COLORS[color]
  return { '--sh': h, '--sc': c } as React.CSSProperties
}

export function sectionTint(color: SectionColor) {
  const { h, c } = SECTION_COLORS[color]
  return `oklch(var(--section-tint-l) calc(${(c / 0.13).toFixed(3)} * var(--section-chroma)) ${h})`
}

export const UC_LABEL: Record<UcPreset, string> = {
  heavy: 'Heavy',
  light: 'Light',
  'furry-focus': 'Furry Focus',
  'human-focus': 'Human Focus',
  none: 'None',
}
export const QUALITY_LABEL: Record<QualityPreset, string> = { standard: 'Standard', light: 'Light', none: 'None' }
