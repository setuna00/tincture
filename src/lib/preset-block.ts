import { QUALITY_LABEL, UC_LABEL } from '@/components/editor/labels'
import type { BoxField, Chip, Doc, QualityPreset, UcPreset } from '@/types'
import { basePrompt, parsePrompt, toChip } from './nai'
import { dupKey } from './nai-length'
import { qualityOptions, qualityText, ucOptions, ucText } from './nai-models'
import { composePrompt, effectiveSettings, naiAddsNsfw } from './nai-write'

export interface PresetView {
  field: BoxField
  id: QualityPreset | UcPreset
  label: string
  options: (QualityPreset | UcPreset)[]
  text: string
  nsfw: boolean
  locked: boolean
}

type DocPart = Pick<Doc, 'base' | 'settings'>

export function presetView(doc: DocPart, field: BoxField): PresetView {
  const s = effectiveSettings(doc.settings)
  if (field === 'prompt') {
    const id = s.qualityTags
    return { field, id, label: QUALITY_LABEL[id], options: qualityOptions(s.model), text: qualityText(s.model, id), nsfw: false, locked: false }
  }
  const id = s.ucPreset
  const head = ucText(s.model, id)
  // Same check as composeUc (positive with quality tags, without the Furry prefix), or the preview differs from the sent UC.
  const nsfw = naiAddsNsfw(s, composePrompt(basePrompt(doc), { ...s, mode: 'anime' }))
  return { field, id, label: UC_LABEL[id], options: ucOptions(s.model), text: nsfw ? `nsfw, ${head}` : head, nsfw, locked: s.effort === 'medium' }
}

export const presetParts = (v: PresetView) => (v.text ? parsePrompt(v.text) : [])

export const presetChips = (v: PresetView): Chip[] => presetParts(v).map(toChip)

export function presetDupChips(doc: DocPart, v: PresetView): Chip[] {
  const keys = new Set(presetParts(v).map(dupKey))
  if (!keys.size) return []
  return doc.base[v.field].flatMap((s) => (s.muted ? [] : s.chips.filter((c) => !c.disabled && c.weight === 1 && c.type !== 'textrender' && keys.has(dupKey(c)))))
}
