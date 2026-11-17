import type { Doc } from '@/types'

export function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  if (Array.isArray(a)) {
    const bb = b as unknown[]
    return a.length === bb.length && a.every((x, i) => sameValue(x, bb[i]))
  }
  const ao = a as Record<string, unknown>
  const bo = b as Record<string, unknown>
  const keys = new Set([...Object.keys(ao), ...Object.keys(bo)])
  for (const k of keys) if (!sameValue(ao[k], bo[k])) return false
  return true
}

export function sameDocContent(a: Doc, b: Doc): boolean {
  return a.meta.title === b.meta.title && sameValue(a.base, b.base) && sameValue(a.characters, b.characters) && sameValue(a.settings, b.settings)
}

export const hasChips = (d: Doc) => [...d.base.prompt, ...d.base.uc, ...d.characters.flatMap((c) => [...c.prompt, ...c.uc])].some((s) => s.chips.length > 0)

export const isUnsaved = (doc: Doc, saved: Doc | undefined) => (saved ? !sameDocContent(doc, saved) : hasChips(doc))
