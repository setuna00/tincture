import { newId } from './nai'
import type { Chip, Section } from '@/types'

type TemplateChip = Omit<Chip, 'id'>
export type LinkState = 'clean' | 'edited' | 'none'

export function sameChips(a: readonly TemplateChip[], b: readonly TemplateChip[]): boolean {
  return (
    a.length === b.length &&
    a.every((c, i) => {
      const d = b[i]
      return c.text === d.text && c.type === d.type && Math.abs(c.weight - d.weight) < 1e-9 && !!c.disabled === !!d.disabled && (c.interaction ?? null) === (d.interaction ?? null)
    })
  )
}

export function linkState<T extends { id: string }>(section: Pick<Section, 'templateId' | 'templateEdited'>, templates: readonly T[]): { state: LinkState; template: T | null } {
  const template = section.templateId ? (templates.find((t) => t.id === section.templateId) ?? null) : null
  if (!template) return { state: 'none', template: null }
  return { state: section.templateEdited ? 'edited' : 'clean', template }
}

export const chipsFromTemplate = (chips: readonly TemplateChip[]): Chip[] => chips.map((c) => ({ ...c, id: newId('c') }))

export const templateChips = (chips: readonly Chip[]): TemplateChip[] => chips.map(({ id: _id, ...rest }) => rest)
