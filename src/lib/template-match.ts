import type { SectionTemplate } from '@/store/library'

export interface TemplateMatch {
  template: SectionTemplate
  score: number
  shared: string[]
  added: string[]
}

export interface MatchContext {
  group: (name: string) => string | undefined
  /** NPMI inputs use x1000 scaling; 0 means no recorded cooccurrence. */
  npmi: (a: string, b: string) => number
  isNegative: (name: string) => boolean
  conflicts?: (present: string[]) => (name: string) => boolean
}

const norm = (t: string) => t.trim().toLowerCase()
const MIN_REL = 0.3

export function matchTemplates(sectionTags: string[], templates: SectionTemplate[], negative: boolean, ctx: MatchContext, limit = 6): TemplateMatch[] {
  const have = new Set(sectionTags.map(norm))
  if (!have.size) return []
  const groups = new Set([...have].map(ctx.group).filter(Boolean))
  const conflict = ctx.conflicts?.([...have])
  const out: TemplateMatch[] = []
  for (const t of templates) {
    const names = [...new Set(t.chips.map((c) => norm(c.text)))]
    if (!names.length) continue
    const shared = names.filter((n) => have.has(n))
    const added = names.filter((n) => !have.has(n))
    if (!added.length) continue
    const negShare = names.filter(ctx.isNegative).length / names.length
    if (!negative && negShare > 0.5) continue
    if (negative && negShare <= 0.5 && !shared.length) continue
    const groupHits = added.filter((n) => groups.has(ctx.group(n))).length
    let cooc = 0
    for (const a of added) cooc += Math.max(0, ...[...have].map((h) => ctx.npmi(h, a))) / 1000
    const clash = conflict && added.some(conflict) ? 0.35 : 1
    const score = ((shared.length + groupHits * 0.6 + cooc * 1.5) / Math.sqrt(names.length)) * clash
    if (score <= 0.05) continue
    out.push({ template: t, score: Math.round(score * 1000) / 1000, shared, added })
  }
  out.sort((a, b) => b.score - a.score)
  const top = out[0]?.score ?? 0
  return out.filter((m) => m.score >= top * MIN_REL).slice(0, limit)
}
