import { create } from 'zustand'

interface UiState {
  selectedChipIds: string[]
  selectedChipId: string | null
  anchorChipId: string | null
  focusSectionId: string | null
  focusCharacterId: string | null
  flashSectionId: string | null
  textEditing: boolean
  setTextEditing(on: boolean): void
  select(chipId: string | null, sectionId?: string): void
  toggleChip(chipId: string): void
  selectRange(chipIds: string[], anchor?: string): void
  setSelection(chipIds: string[]): void
  focusSection(sectionId: string | null): void
  selectCharacter(charId: string | null): void
  blur(): void
  escape(charOf?: (sectionId: string) => string | null): void
  flash(sectionId: string): void
}

let flashTimer: ReturnType<typeof setTimeout> | undefined

const chips = (ids: string[]) => ({ selectedChipIds: ids, selectedChipId: ids.length === 1 ? ids[0] : null })

export const useUi = create<UiState>()((set, get) => ({
  selectedChipIds: [],
  selectedChipId: null,
  anchorChipId: null,
  focusSectionId: null,
  focusCharacterId: null,
  flashSectionId: null,
  textEditing: false,
  setTextEditing: (textEditing) => set({ textEditing }),
  select: (chipId, sectionId) =>
    set((s) => ({
      ...chips(chipId ? [chipId] : []),
      anchorChipId: chipId ?? s.anchorChipId,
      focusSectionId: sectionId ?? s.focusSectionId,
      focusCharacterId: chipId || sectionId ? null : s.focusCharacterId,
    })),
  toggleChip: (chipId) =>
    set((s) => {
      const on = s.selectedChipIds.includes(chipId)
      const ids = on ? s.selectedChipIds.filter((id) => id !== chipId) : [...s.selectedChipIds, chipId]
      return { ...chips(ids), anchorChipId: on ? s.anchorChipId : chipId, focusSectionId: null, focusCharacterId: null }
    }),
  selectRange: (ids, anchor) => set((s) => ({ ...chips(ids), anchorChipId: anchor ?? s.anchorChipId, focusSectionId: null, focusCharacterId: null })),
  setSelection: (ids) => set({ ...chips(ids), focusSectionId: null, focusCharacterId: null }),
  focusSection: (focusSectionId) => set((s) => ({ focusSectionId, focusCharacterId: focusSectionId ? null : s.focusCharacterId })),
  selectCharacter: (focusCharacterId) => set({ ...chips([]), focusSectionId: null, focusCharacterId }),
  blur: () => set({ ...chips([]), focusSectionId: null, focusCharacterId: null }),
  escape: (charOf) => {
    const s = get()
    if (s.selectedChipIds.length) return set(chips([]))
    if (s.focusSectionId) return set({ focusSectionId: null, focusCharacterId: charOf?.(s.focusSectionId) ?? null })
    set({ focusCharacterId: null })
  },
  flash: (flashSectionId) => {
    clearTimeout(flashTimer)
    set({ flashSectionId })
    flashTimer = setTimeout(() => set({ flashSectionId: null }), 1200)
  },
}))
