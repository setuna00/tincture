import { allSections } from '@/store/doc'
import { variantBase } from '@/store/library'
import type { Chip, Doc, Section } from '@/types'
import { naiAdditions, dupKey } from './nai-length'
import { parsePrompt } from './nai'
import { aliasOf, lookupTag } from './tagdb'

export interface AliasFix {
  id: string
  from: string
  to: string
  type: Chip['type']
}

export function aliasFixes(doc: Doc, variants: Record<string, string[]>): AliasFix[] {
  const out: AliasFix[] = []
  for (const s of allSections(doc))
    for (const c of s.chips) {
      if (c.type !== 'tag' && c.type !== 'interaction') continue
      if (variantBase(c.text, variants, (t) => !!lookupTag(t))) continue
      const to = aliasOf(c.text)
      if (to) out.push({ id: c.id, from: c.text, to, type: lookupTag(to)?.category === 'artist' ? 'artist' : c.type })
    }
  return out
}

export function naiDupChips(doc: Doc): Chip[] {
  const add = naiAdditions(doc)
  const scan = (sections: Section[], extra: { text: string }[]) => {
    const keys = new Set(extra.flatMap((x) => parsePrompt(x.text)).filter((p) => p.type !== 'textrender').map(dupKey))
    if (!keys.size) return []
    return sections.flatMap((s) => (s.muted ? [] : s.chips.filter((c) => !c.disabled && c.weight === 1 && c.type !== 'textrender' && keys.has(dupKey(c)))))
  }
  return [...scan(doc.base.prompt, add.prompt), ...scan(doc.base.uc, add.uc)]
}
