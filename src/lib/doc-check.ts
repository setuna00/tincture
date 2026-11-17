import { characterLabel } from '@/lib/character-label'
import { variantBase } from '@/store/library'
import type { Chip, Doc, Section } from '@/types'
import { dupIndex } from './nai-length'
import { chipLiteral } from './nai'
import { aliasOf, lookupTag, matchTags } from './tagdb'

export type TagStatus = 'official' | 'variant' | 'alias' | 'unknown' | 'other'

export function chipStatus(chip: Pick<Chip, 'type' | 'text'>, variants: Record<string, string[]>): { status: TagStatus; base: string | null } {
  if (chip.type !== 'tag' && chip.type !== 'interaction') return { status: 'other', base: null }
  if (lookupTag(chip.text)) return { status: 'official', base: chip.text }
  const base = variantBase(chip.text, variants, (t) => !!lookupTag(t))
  if (base) return { status: 'variant', base }
  const alias = aliasOf(chip.text)
  return alias ? { status: 'alias', base: alias } : { status: 'unknown', base: null }
}

export interface CheckPlace {
  sectionId: string
  sectionName: string
  field: 'prompt' | 'uc'
  character?: { id: string; name: string }
}
export interface CheckChip extends CheckPlace {
  chipId: string
  tag: string
  text: string
  weight: number
  disabled: boolean
}
export interface DocCheck {
  unknown: (CheckChip & { similar?: string[] })[]
  alias: (CheckChip & { official: string })[]
  oldName: (CheckChip & { newName: string })[]
  duplicate: { tag: string; copies: CheckChip[] }[]
  naiDuplicate: (CheckChip & { addedBy: string[] })[]
}
export interface CheckContext {
  variants: Record<string, string[]>
  renamedTo: ReadonlyMap<string, string>
}

function boxesOf(doc: Doc) {
  const out: { key: string; field: 'prompt' | 'uc'; character?: { id: string; name: string }; sections: Section[] }[] = []
  for (const field of ['prompt', 'uc'] as const) out.push({ key: `base.${field}`, field, sections: doc.base[field] })
  doc.characters.forEach((c) => {
    const character = { id: c.id, name: characterLabel(doc, c) }
    for (const field of ['prompt', 'uc'] as const) out.push({ key: `${c.id}.${field}`, field, character, sections: c[field] })
  })
  return out
}

export function checkDocument(doc: Doc, ctx: CheckContext): DocCheck {
  const out: DocCheck = { unknown: [], alias: [], oldName: [], duplicate: [], naiDuplicate: [] }
  const dups = dupIndex(doc).boxes
  for (const b of boxesOf(doc)) {
    const chips = new Map<string, CheckChip>()
    for (const s of b.sections)
      for (const c of s.chips) {
        if (!c.text.trim()) continue
        const item: CheckChip = {
          chipId: c.id,
          tag: chipLiteral(c),
          text: c.text,
          weight: c.weight,
          disabled: c.disabled,
          sectionId: s.id,
          sectionName: s.name,
          field: b.field,
          ...(b.character ? { character: b.character } : {}),
        }
        chips.set(c.id, item)
        const st = chipStatus(c, ctx.variants)
        if (st.status === 'unknown') out.unknown.push(item)
        else if (st.status === 'alias') out.alias.push({ ...item, official: st.base! })
        else if (st.status === 'official') {
          const to = ctx.renamedTo.get(lookupTag(c.text)!.name)
          if (to) out.oldName.push({ ...item, newName: to })
        }
      }
    for (const g of dups.get(b.key)?.groups ?? []) {
      const mine = g.occ.flatMap((o) => (o.chipId && chips.has(o.chipId) ? [chips.get(o.chipId)!] : []))
      const auto = [...new Set(g.occ.filter((o) => !o.chipId).map((o) => o.place))]
      if (mine.length > 1) out.duplicate.push({ tag: g.tag, copies: mine })
      if (auto.length) for (const m of mine) out.naiDuplicate.push({ ...m, addedBy: auto })
    }
  }
  return out
}

const written = (t: { name: string; category: string }) => (t.category === 'artist' ? chipLiteral({ type: 'artist', text: t.name }) : t.name)

export async function withSimilar(check: DocCheck, limit = 5): Promise<DocCheck> {
  const words = [...new Set(check.unknown.map((u) => u.text.toLowerCase()))]
  const found = new Map(await Promise.all(words.map(async (w) => [w, (await matchTags(w, limit)).map((s) => written(s.tag))] as const)))
  return { ...check, unknown: check.unknown.map((u) => ({ ...u, similar: found.get(u.text.toLowerCase()) ?? [] })) }
}
