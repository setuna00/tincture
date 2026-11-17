import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import type { ArtistAlgo } from '@/lib/artist-rank'
import { fillDocDefaults } from '@/lib/doc-defaults'
import type { CustomGender } from '@/lib/gender'
import type { DocSettings } from '@/types'
import { SEED_EXAMPLES } from './seed'
import { safeStorage } from './storage'

export type Theme = 'dark' | 'light' | 'system'
export type ChipLang = 'en-zh' | 'zh-en' | 'en' | 'zh'
export type NsfwMode = 'off' | 'r18' | 'r18g'
export const NSFW_MAX_LEVEL: Record<NsfwMode, number> = { off: 1, r18: 2, r18g: 3 }
export type LibraryTab = 'sections' | 'characters'
export type ChatEntry = 'rail' | 'tab'
export type ChatSendKey = 'enter' | 'shift'
export const ASSIST_W = { def: 296, min: 240, max: 520, aiMin: 360, aiOpen: 380 } as const
export type ArtistSortBy = ArtistAlgo | 'name' | 'added'
export interface ArtistSort {
  by: ArtistSortBy
  desc: boolean
}
export type BuiltinListId = 'a' | 'b' | 'c'
export type DiscoverListId = string
export interface DiscoverSort {
  by: 'count' | 'name'
  desc: boolean
}

export type GallerySortBy = 'time' | 'name' | 'tags'

interface PrefsState {
  theme: Theme
  chipLang: ChipLang
  assistOpen: boolean
  exportOpen: boolean
  rightTab: 'gen' | 'copy' | null
  rightW: number | null
  historyOpen: boolean
  historyH: number
  historyGridH: number
  collapsed: Record<string, boolean>
  openFolders: Record<string, boolean>
  nsfw: NsfwMode
  r18gOn: boolean
  moreGenders: boolean
  genderPresetsOff: string[]
  customGenders: CustomGender[]
  docDefaults: DocSettings | null
  artistSort: ArtistSort
  libraryTab: LibraryTab
  libraryView: 'list' | 'grid'
  discoverList: DiscoverListId
  discoverNode: Record<DiscoverListId, string>
  discoverOpen: Record<string, boolean>
  discoverSort: DiscoverSort
  discoverUnused: boolean
  galleryLeftOpen: boolean
  galleryRightOpen: boolean
  galleryRowH: number
  gallerySortBy: GallerySortBy
  gallerySortDir: 'desc' | 'asc'
  galleryNames: boolean
  galleryStack: boolean
  galleryNear: boolean
  assistW: number
  chatEntry: ChatEntry
  chatSendKey: ChatSendKey
  chatPinned: boolean
  chatEdit: boolean
  set(patch: Partial<Omit<PrefsState, 'set' | 'togglePanel' | 'toggleFolder'>>): void
  togglePanel(id: string): void
  toggleFolder(path: string): void
}

const DEFAULT_OPEN_FOLDERS: Record<string, boolean> = SEED_EXAMPLES ? { 表情: true, '表情/笑': true } : {}

export const usePrefs = create<PrefsState>()(
  persist(
    (set) => ({
      theme: 'dark',
      chipLang: 'en-zh',
      assistOpen: true,
      exportOpen: true,
      rightTab: null,
      rightW: null,
      historyOpen: false,
      historyH: 124,
      historyGridH: 112,
      collapsed: {},
      openFolders: DEFAULT_OPEN_FOLDERS,
      nsfw: 'off',
      r18gOn: false,
      moreGenders: false,
      genderPresetsOff: [],
      customGenders: [],
      docDefaults: null,
      artistSort: { by: 'rep', desc: true },
      libraryTab: 'sections',
      libraryView: 'list',
      discoverList: 'b',
      discoverNode: {},
      discoverOpen: {},
      discoverSort: { by: 'count', desc: true },
      discoverUnused: false,
      galleryLeftOpen: true,
      galleryRightOpen: true,
      galleryRowH: 220,
      gallerySortBy: 'time',
      gallerySortDir: 'desc',
      galleryNames: false,
      galleryStack: true,
      galleryNear: false,
      assistW: ASSIST_W.def,
      chatEntry: 'rail',
      chatSendKey: 'enter',
      chatPinned: false,
      chatEdit: true,
      set: (patch) => set(patch),
      togglePanel: (id) => set((s) => ({ collapsed: { ...s.collapsed, [id]: !s.collapsed[id] } })),
      toggleFolder: (path) => set((s) => ({ openFolders: { ...s.openFolders, [path]: !s.openFolders[path] } })),
    }),
    {
      name: 'pe:prefs',
      version: 11,
      storage: createJSONStorage(() => safeStorage),
      migrate: migratePrefs,
      partialize: (s) => ({ theme: s.theme, chipLang: s.chipLang, assistOpen: s.assistOpen, exportOpen: s.exportOpen, rightTab: s.rightTab, rightW: s.rightW, historyOpen: s.historyOpen, historyH: s.historyH, historyGridH: s.historyGridH, collapsed: s.collapsed, openFolders: s.openFolders, nsfw: s.nsfw, r18gOn: s.r18gOn, moreGenders: s.moreGenders, genderPresetsOff: s.genderPresetsOff, customGenders: s.customGenders, docDefaults: s.docDefaults, artistSort: s.artistSort, libraryTab: s.libraryTab, libraryView: s.libraryView, discoverList: s.discoverList, discoverNode: s.discoverNode, discoverOpen: s.discoverOpen, discoverSort: s.discoverSort, discoverUnused: s.discoverUnused, galleryLeftOpen: s.galleryLeftOpen, galleryRightOpen: s.galleryRightOpen, galleryRowH: s.galleryRowH, gallerySortBy: s.gallerySortBy, gallerySortDir: s.gallerySortDir, galleryNames: s.galleryNames, galleryStack: s.galleryStack, galleryNear: s.galleryNear, assistW: s.assistW, chatEntry: s.chatEntry, chatSendKey: s.chatSendKey, chatPinned: s.chatPinned, chatEdit: s.chatEdit }),
    },
  ),
)

export function migratePrefs(old: unknown): PrefsState {
  const { rightW: oldRightW, gallerySort, ...s } = (old ?? {}) as Omit<Partial<PrefsState>, 'nsfw' | 'rightW'> & { chipLang?: string; nsfw?: NsfwMode | boolean; rightW?: number | { gen?: number }; gallerySort?: 'new' | 'old' }
  const nsfw: NsfwMode = s.nsfw === true ? 'r18' : s.nsfw === 'r18' || s.nsfw === 'r18g' ? s.nsfw : 'off'
  const rightW = typeof oldRightW === 'number' ? oldRightW : oldRightW?.gen
  return {
    ...s,
    // Persisted 640px widths do not distinguish the v9 default from a manually chosen width.
    ...(rightW != null && rightW !== 640 ? { rightW } : {}),
    ...(s.historyH === 136 ? { historyH: 124 } : {}),
    nsfw,
    r18gOn: s.r18gOn ?? nsfw === 'r18g',
    chipLang: s.chipLang === 'en' || s.chipLang === 'zh' || s.chipLang === 'zh-en' ? s.chipLang : 'en-zh',
    assistOpen: s.assistOpen ?? true,
    exportOpen: s.exportOpen ?? true,
    collapsed: s.collapsed ?? {},
    openFolders: s.openFolders ?? DEFAULT_OPEN_FOLDERS,
    docDefaults: s.docDefaults ?? null,
    ...(s.artistSort?.by === 'count' ? { artistSort: { by: 'rep', desc: true } } : {}),
    gallerySortBy: s.gallerySortBy ?? 'time',
    gallerySortDir: s.gallerySortDir ?? (gallerySort === 'old' ? 'asc' : 'desc'),
  } as PrefsState
}

export const newDocSettings = (): DocSettings => {
  const { perModel: _, ...s } = fillDocDefaults(usePrefs.getState().docDefaults)
  return s
}

export const nsfwOf = (on: boolean, r18g: boolean): NsfwMode => (!on ? 'off' : r18g ? 'r18g' : 'r18')

export function applyPrefsToRoot(p: Pick<PrefsState, 'theme' | 'chipLang'>) {
  const root = document.documentElement
  const sysDark = window.matchMedia('(prefers-color-scheme: dark)').matches
  const forced = root.getAttribute('data-theme')
  const dark = forced ? forced === 'dark' : p.theme === 'system' ? sysDark : p.theme === 'dark'
  root.classList.toggle('dark', dark)
  root.dataset.chipLang = p.chipLang
}
