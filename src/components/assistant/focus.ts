import { useMemo } from 'react'
import { chipsFromTemplate } from '@/lib/template-link'
import { findChip, makeSection } from '@/store/doc'
import { useDoc } from '@/store/context'
import { useUi } from '@/store/ui'
import type { Section } from '@/types'
import type { SectionTemplate } from '@/store/library'

/** Memoize outside the store selector so repeated snapshot reads do not create new objects. */
export function useSelectedChip() {
  const doc = useDoc((s) => s.doc)
  const id = useUi((s) => s.selectedChipId)
  return useMemo(() => (id ? findChip(doc, id) : null), [doc, id])
}

export function sectionFromTemplate(t: SectionTemplate): Section {
  const s = makeSection(t.name, chipsFromTemplate(t.chips), t.color)
  s.templateId = t.id
  if (t.note) s.note = t.note
  return s
}

