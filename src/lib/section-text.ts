import type { Chip } from '@/types'
import { chipLiteral, exportString, parsePrompt, toChip, type ParsedChip } from './nai'

/** A trailing separator after Text: would become rendered text, so omit it for text-rendering prompts. */
export function sectionText(chips: Chip[]): string {
  const s = exportString([{ id: '', name: '', color: 'slate', muted: false, chips }])
  if (!s) return ''
  return chips.some((c) => c.type === 'textrender' && !c.disabled && c.text.trim()) ? s : `${s}, `
}

const chipKey = (c: Pick<Chip, 'text' | 'type' | 'interaction'>) => chipLiteral(c).toLowerCase()

/** Disabled chips are absent from editable text; preserve them when reconciling edits so hidden content is not lost. */
export const applySectionText = (old: Chip[], text: string): Chip[] => applyParsedChips(old, parsePrompt(text))

export function applyParsedChips(old: Chip[], parsed: ParsedChip[]): Chip[] {
  const pool = new Map<string, Chip[]>()
  for (const c of old) {
    if (c.disabled) continue
    const k = chipKey(c)
    pool.set(k, [...(pool.get(k) ?? []), c])
  }
  const kept = new Set<string>()
  const next = parsed.map((p): Chip => {
    const reuse = pool.get(chipKey(p))?.shift()
    if (!reuse) return toChip(p)
    kept.add(reuse.id)
    return { id: reuse.id, disabled: false, ...p }
  })

  const after = new Map<string | null, Chip[]>()
  let anchor: string | null = null
  for (const c of old) {
    if (c.disabled) after.set(anchor, [...(after.get(anchor) ?? []), c])
    else if (kept.has(c.id)) anchor = c.id
  }
  const out = [...(after.get(null) ?? [])]
  for (const c of next) out.push(c, ...(kept.has(c.id) ? (after.get(c.id) ?? []) : []))
  return out
}

export function sameChips(a: Chip[], b: Chip[]): boolean {
  return (
    a.length === b.length &&
    a.every((c, i) => {
      const d = b[i]
      return c.id === d.id && c.text === d.text && c.type === d.type && c.weight === d.weight && c.disabled === d.disabled && c.interaction === d.interaction
    })
  )
}
