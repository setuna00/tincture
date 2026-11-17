import { defaultSettings } from '@/store/doc'
import type { DocSettings } from '@/types'

export function fillDocDefaults(saved: DocSettings | null | undefined): DocSettings {
  const def = defaultSettings()
  if (!saved) return def
  return { ...def, ...saved, useCoords: def.useCoords, gen: { ...def.gen, ...saved.gen, seed: null } }
}

export function isV5Default(saved: DocSettings | null | undefined): boolean {
  const { perModel: _, ...s } = fillDocDefaults(saved)
  return JSON.stringify(s) === JSON.stringify(defaultSettings())
}
