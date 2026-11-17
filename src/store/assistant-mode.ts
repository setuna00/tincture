import { createStore, useStore } from 'zustand'
import type { Doc } from '@/types'
import { findChip, findSection } from './doc'
import { getDocStore, useTabs } from './tabs'
import { useUi } from './ui'

type Selection = Pick<ReturnType<typeof useUi.getState>, 'selectedChipIds' | 'selectedChipId' | 'focusSectionId' | 'focusCharacterId'>

export function assistantMode(doc: Doc, selection: Selection) {
  const { selectedChipIds, selectedChipId, focusSectionId, focusCharacterId } = selection
  return selectedChipIds.filter((id) => findChip(doc, id)).length > 1 ? 'multi'
    : selectedChipId && findChip(doc, selectedChipId) ? 'tag'
    : focusSectionId && findSection(doc, focusSectionId) ? 'section'
    : focusCharacterId && doc.characters.some((c) => c.id === focusCharacterId) ? 'character'
    : 'library'
}

const NO_DOC = createStore<{ doc: Doc | null }>(() => ({ doc: null }))

export function useAssistantMode() {
  const activeId = useTabs((s) => s.activeId)
  const isStart = useTabs((s) => s.starts.includes(s.activeId))
  const selectedChipIds = useUi((s) => s.selectedChipIds)
  const selectedChipId = useUi((s) => s.selectedChipId)
  const focusSectionId = useUi((s) => s.focusSectionId)
  const focusCharacterId = useUi((s) => s.focusCharacterId)
  return useStore(isStart ? NO_DOC : getDocStore(activeId), (s) => s.doc ? assistantMode(s.doc, { selectedChipIds, selectedChipId, focusSectionId, focusCharacterId }) : 'library')
}
