import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { remapFavorites, revertFavorites } from '@/lib/library-ops'
import { newId, parsePrompt } from '@/lib/nai'
import type { Chip, Doc, Gender, GenderExtra, Section, SectionColor } from '@/types'
import { normalizeDoc } from './doc'
import { exampleCharacters, exampleDocTemplates, libraryOnlyCharacters } from './sample'
import { fingerprint, SEED_EXAMPLES, withoutUntouched } from './seed'
import { safeStorage } from './storage'

export interface SectionTemplate {
  id: string
  name: string
  color: SectionColor
  chips: Omit<Chip, 'id'>[]
  folder: string
  note?: string
  imageKey?: string
  createdAt: number
}

export interface CharacterTemplate {
  id: string
  name: string
  gender: Gender
  genderExtra?: GenderExtra
  color: SectionColor
  note?: string
  work?: string
  imageKey?: string
  prompt: Section[]
  uc: Section[]
  createdAt: number
}

export interface SavedDoc {
  id: string
  title: string
  doc: Doc
  createdAt: number
  savedAt: number
}

export interface RecentDoc {
  id: string
  title: string
  doc: Doc
  closedAt: number
  savedId?: string
}

export interface ArtistMeta {
  pixiv?: string
  twitter?: string
  other?: string
  imageKey?: string
  note?: string
}

export interface ArtistCollection {
  id: string
  title: string
  description?: string
  items: { name: string; addedAt: number }[]
  createdAt: number
}

export const FAV_COLLECTION = 'fav'

export const isFavArtist = (s: { artistCollections: ArtistCollection[] }, name: string) =>
  !!s.artistCollections.find((c) => c.id === FAV_COLLECTION)?.items.some((x) => x.name === name)

export function nextCollectionTitle(list: ArtistCollection[]) {
  const titles = new Set(list.map((c) => c.title))
  if (!titles.has('新合集')) return '新合集'
  let i = 2
  while (titles.has(`新合集 ${i}`)) i++
  return `新合集 ${i}`
}
const LEGACY_RENAMES: Record<string, string> = { askzy: 'ask (askzy)', 'sho (sho lwlw)': 'todoroki masaru' }

const favCollection = (items: ArtistCollection['items'] = []): ArtistCollection => ({ id: FAV_COLLECTION, title: '收藏', items, createdAt: 0 })

export type FavoriteKey = `template:${string}` | `folder:${string}` | `character:${string}`
export const favTemplate = (id: string): FavoriteKey => `template:${id}`
export const favFolder = (path: string): FavoriteKey => `folder:${path}`
export const favCharacter = (id: string): FavoriteKey => `character:${id}`

/** Undo only the templates touched by this operation so subsequent unrelated edits survive. */
export interface LibraryUndo {
  count: number
  folders?: Record<string, string>
  works?: Record<string, string | undefined>
  removed?: { sections: { t: SectionTemplate; index: number }[]; chars: { t: CharacterTemplate; index: number }[] }
  favs?: { before: FavoriteKey[]; after: FavoriteKey[] }
}

const withWork = (t: CharacterTemplate, work: string | undefined): CharacterTemplate => {
  const { work: _old, ...rest } = t
  return work ? { ...rest, work } : rest
}

interface LibraryState {
  variants: Record<string, string[]>
  sectionTemplates: SectionTemplate[]
  characterTemplates: CharacterTemplate[]
  /** Favorite references use template:<id> or folder:<path>; folder references do not imply favorites for their contents. */
  favorites: FavoriteKey[]
  docs: SavedDoc[]
  recent: RecentDoc[]
  artists: Record<string, ArtistMeta>
  artistCollections: ArtistCollection[]

  addVariant(base: string, text: string): void
  removeVariant(base: string, text: string): void
  restoreVariant(base: string, text: string, index: number): void
  saveSectionTemplate(t: Omit<SectionTemplate, 'id' | 'createdAt' | 'folder'> & { folder?: string }): SectionTemplate
  updateSectionTemplate(id: string, patch: Partial<Omit<SectionTemplate, 'id' | 'createdAt'>>): SectionTemplate | null
  putSectionTemplate(t: SectionTemplate): void
  removeSectionTemplate(id: string): void
  restoreSectionTemplate(t: SectionTemplate, index: number, favIndex: number): void
  saveCharacterTemplate(t: Omit<CharacterTemplate, 'id' | 'createdAt'>): CharacterTemplate
  updateCharacterTemplate(id: string, patch: Partial<Omit<CharacterTemplate, 'id' | 'createdAt'>>): CharacterTemplate | null
  putCharacterTemplate(t: CharacterTemplate): void
  removeCharacterTemplate(id: string): void
  restoreCharacterTemplate(t: CharacterTemplate, index: number, favIndex: number): void
  moveSectionTemplates(ids: string[], folder: string): LibraryUndo
  moveCharacterTemplates(ids: string[], work: string): LibraryUndo
  remapFolders(fn: (folder: string) => string): LibraryUndo
  remapWorks(fn: (work: string) => string): LibraryUndo
  removeTemplates(sectionIds: string[], characterIds: string[]): LibraryUndo
  undoLibrary(u: LibraryUndo): void
  toggleFavorite(key: FavoriteKey): void
  saveDoc(doc: Doc, id?: string): SavedDoc
  removeDoc(id: string): void
  renameDoc(id: string, title: string): void
  restoreDoc(d: SavedDoc, index: number): void
  pushRecent(title: string, doc: Doc, savedId?: string): RecentDoc[]
  restoreRecent(doc: RecentDoc): void
  removeRecent(id: string): void
  updateArtist(name: string, patch: Partial<ArtistMeta>): void
  renameArtist(from: string, to: string): void
  toggleInCollection(id: string, name: string): void
  createCollection(title: string, names?: string[]): ArtistCollection
  updateCollection(id: string, patch: Partial<Pick<ArtistCollection, 'title' | 'description'>>): void
  removeCollection(id: string): { c: ArtistCollection; index: number } | null
  restoreCollection(c: ArtistCollection, index: number): void
}

export const useLibrary = create<LibraryState>()(
  persist(
    (set, get) => ({
      variants: SEED_EXAMPLES ? exampleVariants() : {},
      sectionTemplates: SEED_EXAMPLES ? exampleTemplates() : [],
      characterTemplates: SEED_EXAMPLES ? exampleCharacterTemplates() : [],
      favorites: [],
      docs: SEED_EXAMPLES ? exampleDocs() : [],
      recent: [],
      artists: {},
      artistCollections: [favCollection()],

      addVariant: (base, text) =>
        set((s) => {
          const t = text.trim()
          const list = s.variants[base] ?? []
          if (!t || t === base || list.includes(t)) return s
          return { variants: { ...s.variants, [base]: [...list, t] } }
        }),
      removeVariant: (base, text) =>
        set((s) => ({ variants: { ...s.variants, [base]: (s.variants[base] ?? []).filter((v) => v !== text) } })),
      restoreVariant: (base, text, index) =>
        set((s) => {
          const list = [...(s.variants[base] ?? [])]
          if (list.includes(text)) return s
          list.splice(index, 0, text)
          return { variants: { ...s.variants, [base]: list } }
        }),
      saveSectionTemplate: (t) => {
        const tpl: SectionTemplate = { folder: '', ...t, id: newId('st'), createdAt: Date.now() }
        set((s) => ({ sectionTemplates: [tpl, ...s.sectionTemplates] }))
        return tpl
      },
      updateSectionTemplate: (id, patch) => {
        const old = get().sectionTemplates.find((t) => t.id === id) ?? null
        if (old) set((s) => ({ sectionTemplates: s.sectionTemplates.map((t) => (t.id === id ? { ...t, ...patch } : t)) }))
        return old
      },
      putSectionTemplate: (t) => set((s) => ({ sectionTemplates: s.sectionTemplates.map((x) => (x.id === t.id ? t : x)) })),
      removeSectionTemplate: (id) =>
        set((s) => ({
          sectionTemplates: s.sectionTemplates.filter((t) => t.id !== id),
          favorites: s.favorites.filter((f) => f !== favTemplate(id)),
        })),
      restoreSectionTemplate: (t, index, favIndex) =>
        set((s) => {
          const list = s.sectionTemplates.filter((x) => x.id !== t.id)
          list.splice(Math.min(index, list.length), 0, t)
          const favs = s.favorites.filter((f) => f !== favTemplate(t.id))
          if (favIndex >= 0) favs.splice(Math.min(favIndex, favs.length), 0, favTemplate(t.id))
          return { sectionTemplates: list, favorites: favs }
        }),
      saveCharacterTemplate: (t) => {
        const tpl: CharacterTemplate = { ...structuredClone(t), id: newId('ct'), createdAt: Date.now() }
        set((s) => ({ characterTemplates: [tpl, ...s.characterTemplates] }))
        return tpl
      },
      updateCharacterTemplate: (id, patch) => {
        const old = get().characterTemplates.find((t) => t.id === id) ?? null
        if (old) set((s) => ({ characterTemplates: s.characterTemplates.map((t) => (t.id === id ? { ...t, ...structuredClone(patch) } : t)) }))
        return old
      },
      putCharacterTemplate: (t) => set((s) => ({ characterTemplates: s.characterTemplates.map((x) => (x.id === t.id ? t : x)) })),
      removeCharacterTemplate: (id) =>
        set((s) => ({
          characterTemplates: s.characterTemplates.filter((t) => t.id !== id),
          favorites: s.favorites.filter((f) => f !== favCharacter(id)),
        })),
      restoreCharacterTemplate: (t, index, favIndex) =>
        set((s) => {
          const list = s.characterTemplates.filter((x) => x.id !== t.id)
          list.splice(Math.min(index, list.length), 0, t)
          const favs = s.favorites.filter((f) => f !== favCharacter(t.id))
          if (favIndex >= 0) favs.splice(Math.min(favIndex, favs.length), 0, favCharacter(t.id))
          return { characterTemplates: list, favorites: favs }
        }),
      moveSectionTemplates: (ids, folder) => {
        const folders: Record<string, string> = {}
        const set_ = new Set(ids)
        set((s) => ({
          sectionTemplates: s.sectionTemplates.map((t) => {
            if (!set_.has(t.id) || t.folder === folder) return t
            folders[t.id] = t.folder
            return { ...t, folder }
          }),
        }))
        return { count: Object.keys(folders).length, folders }
      },
      moveCharacterTemplates: (ids, work) => {
        const works: Record<string, string | undefined> = {}
        const set_ = new Set(ids)
        const w = work.trim()
        set((s) => ({
          characterTemplates: s.characterTemplates.map((t) => {
            if (!set_.has(t.id) || (t.work?.trim() ?? '') === w) return t
            works[t.id] = t.work
            return withWork(t, w || undefined)
          }),
        }))
        return { count: Object.keys(works).length, works }
      },
      remapFolders: (fn) => {
        const folders: Record<string, string> = {}
        const before = get().favorites
        const after = remapFavorites(before, fn)
        set((s) => ({
          sectionTemplates: s.sectionTemplates.map((t) => {
            const f = fn(t.folder)
            if (f === t.folder) return t
            folders[t.id] = t.folder
            return { ...t, folder: f }
          }),
          favorites: after,
        }))
        return { count: Object.keys(folders).length, folders, favs: { before, after } }
      },
      remapWorks: (fn) => {
        const works: Record<string, string | undefined> = {}
        set((s) => ({
          characterTemplates: s.characterTemplates.map((t) => {
            const w = fn(t.work?.trim() ?? '').trim()
            if (w === (t.work?.trim() ?? '')) return t
            works[t.id] = t.work
            return withWork(t, w || undefined)
          }),
        }))
        return { count: Object.keys(works).length, works }
      },
      removeTemplates: (sectionIds, characterIds) => {
        const s0 = get()
        const sIds = new Set(sectionIds)
        const cIds = new Set(characterIds)
        const sections = s0.sectionTemplates.flatMap((t, index) => (sIds.has(t.id) ? [{ t, index }] : []))
        const chars = s0.characterTemplates.flatMap((t, index) => (cIds.has(t.id) ? [{ t, index }] : []))
        const gone = new Set<FavoriteKey>([...sections.map(({ t }) => favTemplate(t.id)), ...chars.map(({ t }) => favCharacter(t.id))])
        const before = s0.favorites
        const after = before.filter((k) => !gone.has(k))
        set((s) => ({
          sectionTemplates: s.sectionTemplates.filter((t) => !sIds.has(t.id)),
          characterTemplates: s.characterTemplates.filter((t) => !cIds.has(t.id)),
          favorites: after,
        }))
        return { count: sections.length + chars.length, removed: { sections, chars }, favs: { before, after } }
      },
      undoLibrary: (u) =>
        set((s) => {
          let sectionTemplates = s.sectionTemplates
          let characterTemplates = s.characterTemplates
          if (u.removed) {
            sectionTemplates = [...sectionTemplates]
            for (const { t, index } of [...u.removed.sections].sort((a, b) => a.index - b.index))
              if (!sectionTemplates.some((x) => x.id === t.id)) sectionTemplates.splice(Math.min(index, sectionTemplates.length), 0, t)
            characterTemplates = [...characterTemplates]
            for (const { t, index } of [...u.removed.chars].sort((a, b) => a.index - b.index))
              if (!characterTemplates.some((x) => x.id === t.id)) characterTemplates.splice(Math.min(index, characterTemplates.length), 0, t)
          }
          const folders = u.folders
          if (folders) sectionTemplates = sectionTemplates.map((t) => (t.id in folders ? { ...t, folder: folders[t.id] } : t))
          const works = u.works
          if (works) characterTemplates = characterTemplates.map((t) => (t.id in works ? withWork(t, works[t.id]) : t))
          const favorites = u.favs ? revertFavorites(s.favorites, u.favs.before, u.favs.after) : s.favorites
          return { sectionTemplates, characterTemplates, favorites }
        }),
      toggleFavorite: (key) => set((s) => ({ favorites: s.favorites.includes(key) ? s.favorites.filter((f) => f !== key) : [...s.favorites, key] })),
      saveDoc: (doc, id) => {
        const now = Date.now()
        const old = id ? get().docs.find((d) => d.id === id) : undefined
        const next: SavedDoc = { id: old?.id ?? newId('dt'), title: doc.meta.title, doc: structuredClone(doc), createdAt: old?.createdAt ?? now, savedAt: now }
        set((s) => ({ docs: old ? s.docs.map((d) => (d.id === old.id ? next : d)) : [next, ...s.docs] }))
        return next
      },
      removeDoc: (id) => set((s) => ({ docs: s.docs.filter((d) => d.id !== id) })),
      renameDoc: (id, title) =>
        set((s) => ({ docs: s.docs.map((d) => (d.id === id ? { ...d, title, doc: { ...d.doc, meta: { ...d.doc.meta, title } } } : d)) })),
      restoreDoc: (d, index) =>
        set((s) => {
          const list = s.docs.filter((x) => x.id !== d.id)
          list.splice(Math.min(index, list.length), 0, d)
          return { docs: list }
        }),
      pushRecent: (title, doc, savedId) => {
        const recent = [{ id: newId('r'), title, doc: structuredClone(doc), closedAt: Date.now(), ...(savedId ? { savedId } : {}) }, ...get().recent]
        set({ recent: recent.slice(0, 20) })
        return recent.slice(20)
      },
      restoreRecent: (doc) => set((s) => ({ recent: [...s.recent.filter((r) => r.id !== doc.id), doc] })),
      removeRecent: (id) => set((s) => ({ recent: s.recent.filter((r) => r.id !== id) })),
      updateArtist: (name, patch) => set((s) => ({ artists: { ...s.artists, [name]: { ...s.artists[name], ...patch } } })),
      renameArtist: (from, to) => set((s) => renamedArtist(s, from, to)),
      toggleInCollection: (id, name) =>
        set((s) => ({
          artistCollections: s.artistCollections.map((c) =>
            c.id !== id ? c : { ...c, items: c.items.some((x) => x.name === name) ? c.items.filter((x) => x.name !== name) : [...c.items, { name, addedAt: Date.now() }] },
          ),
        })),
      createCollection: (title, names = []) => {
        const now = Date.now()
        const c: ArtistCollection = { id: newId('ac'), title, items: names.map((name) => ({ name, addedAt: now })), createdAt: now }
        set((s) => ({ artistCollections: [...s.artistCollections, c] }))
        return c
      },
      updateCollection: (id, patch) =>
        set((s) => ({ artistCollections: s.artistCollections.map((c) => (c.id === id && id !== FAV_COLLECTION ? { ...c, ...patch } : c)) })),
      removeCollection: (id) => {
        const index = get().artistCollections.findIndex((c) => c.id === id)
        if (index < 0 || id === FAV_COLLECTION) return null
        const c = get().artistCollections[index]
        set((s) => ({ artistCollections: s.artistCollections.filter((x) => x.id !== id) }))
        return { c, index }
      },
      restoreCollection: (c, index) =>
        set((s) => {
          const list = s.artistCollections.filter((x) => x.id !== c.id)
          list.splice(Math.min(Math.max(index, 1), list.length), 0, c)
          return { artistCollections: list }
        }),
    }),
    {
      name: 'pe:library',
      version: 13,
      storage: createJSONStorage(() => safeStorage),
      // Normalize saved and open documents together so added defaults cannot create false unsaved changes; bump this migration when defaults change.
      migrate: (old, version) => {
        const s = (old ?? {}) as Partial<LibraryState> & { favoriteTemplates?: string[]; artists?: Record<string, ArtistMeta & { favoritedAt?: number }>; docTemplates?: Omit<SavedDoc, 'savedAt'>[] }
        if (version < 1) {
          const own = (s.sectionTemplates ?? []).filter((t) => t.createdAt !== 0).map((t) => ({ ...t, folder: t.folder ?? '' }))
          const examples = exampleTemplates()
          s.sectionTemplates = [...examples, ...own]
          s.favorites = defaultFavorites(examples)
        } else if (version < 2) {
          s.favorites = (s.favoriteTemplates ?? []).map(favTemplate)
        }
        if (version < 3) s.docTemplates = [...(s.docTemplates ?? []), ...exampleDocs()]
        if (version < 4) {
          const artists = s.artists ?? {}
          const items = Object.entries(artists)
            .flatMap(([name, m]) => (m.favoritedAt ? [{ name, addedAt: m.favoritedAt }] : []))
            .sort((a, b) => a.addedAt - b.addedAt)
          for (const m of Object.values(artists)) delete m.favoritedAt
          s.artistCollections = [favCollection(items)]
        }
        if (version < 5 && s.sectionTemplates) {
          const examples = exampleTemplates()
          for (const t of s.sectionTemplates) {
            const e = t.createdAt === 0 ? examples.find((x) => x.name === t.name) : undefined
            if (!e) continue
            if (t.note === undefined && e.note) t.note = e.note
            if (t.imageKey === undefined && e.imageKey) t.imageKey = e.imageKey
          }
          if (!s.sectionTemplates.some((t) => t.createdAt === 0 && t.name === '樱花晴天')) {
            const at = s.sectionTemplates.findIndex((t) => t.createdAt === 0 && t.name === '和风场景')
            s.sectionTemplates.splice(at < 0 ? s.sectionTemplates.length : at + 1, 0, examples.find((x) => x.name === '樱花晴天')!)
          }
        }
        if (version < 6 && !s.characterTemplates) s.characterTemplates = exampleCharacterTemplates()
        if (version < 7) {
          const has = (list: { name: string; createdAt: number }[], name: string) => list.some((t) => t.createdAt === 0 && t.name === name)
          const secs = s.sectionTemplates ?? []
          s.sectionTemplates = [...secs, ...exampleTemplates().filter((t) => !t.folder && !has(secs, t.name))]
          const chars = s.characterTemplates ?? []
          const extra = new Set(libraryOnlyCharacters().map((c) => c.name))
          s.characterTemplates = [...chars, ...exampleCharacterTemplates().filter((t) => extra.has(t.name) && !has(chars, t.name))]
        }
        if (version < 8) {
          let r = { artists: s.artists ?? {}, artistCollections: s.artistCollections ?? [] }
          for (const [from, to] of Object.entries(LEGACY_RENAMES)) r = renamedArtist(r, from, to)
          Object.assign(s, r)
        }
        if (version < 9 && !SEED_EXAMPLES) removeUntouchedExamples(s)
        if (version < 10) {
          s.docs = (s.docTemplates ?? []).map((t) => ({ ...t, savedAt: t.createdAt }))
          delete s.docTemplates
        }
        if (version < 12) {
          s.docs = s.docs?.map((d) => ({ ...d, doc: tidyDoc(d.doc) }))
          s.recent = s.recent?.map((r) => ({ ...r, doc: tidyDoc(r.doc) }))
        }
        if (version < 13) {
          const tabOf = linkedTabs()
          const withId = (doc: Doc, docId: string): Doc => (doc.meta.docId ? doc : { ...doc, meta: { ...doc.meta, docId } })
          s.docs = s.docs?.map((d) => ({ ...d, doc: tidyDoc(withId(d.doc, tabOf.get(d.id) ?? newId('d'))) }))
          s.recent = s.recent?.map((r) => ({ ...r, doc: tidyDoc(withId(r.doc, newId('d'))) }))
        }
        delete s.favoriteTemplates
        return s as LibraryState
      },
      merge: (persisted, current) => {
        const merged = { ...current, ...(persisted as Partial<LibraryState>) }
        if (!persisted && SEED_EXAMPLES) merged.favorites = defaultFavorites(merged.sectionTemplates)
        if (!merged.artistCollections?.some((c) => c.id === FAV_COLLECTION)) merged.artistCollections = [favCollection(), ...(merged.artistCollections ?? [])]
        return merged
      },
    },
  ),
)

/** Reuse linked tabs' docId (or tab ID) during migration to retain image history; read raw pe:tabs to avoid the tabs-store import cycle. */
function linkedTabs(): Map<string, string> {
  const out = new Map<string, string>()
  try {
    const tabs = JSON.parse(safeStorage.getItem('pe:tabs') ?? 'null') as { state?: { links?: Record<string, string> } } | null
    for (const [tab, saved] of Object.entries(tabs?.state?.links ?? {})) {
      const doc = JSON.parse(safeStorage.getItem(`pe:doc:${tab}`) ?? 'null') as Doc | null
      out.set(saved, doc?.meta?.docId ?? tab)
    }
  } catch {
  }
  return out
}

/** Preserve any document that fails normalization; throwing would let a later write replace the unreadable library with empty state. */
function tidyDoc(d: Doc): Doc {
  try {
    return normalizeDoc(d)
  } catch {
    return d
  }
}

function renamedArtist<T extends Pick<LibraryState, 'artists' | 'artistCollections'>>(s: T, from: string, to: string): T {
  if (from === to) return s
  const artists = { ...s.artists }
  if (artists[from]) {
    artists[to] = { ...artists[from], ...artists[to] }
    delete artists[from]
  }
  const artistCollections = s.artistCollections.map((c) =>
    !c.items.some((x) => x.name === from)
      ? c
      : { ...c, items: c.items.some((x) => x.name === to) ? c.items.filter((x) => x.name !== from) : c.items.map((x) => (x.name === from ? { ...x, name: to } : x)) },
  )
  return { ...s, artists, artistCollections }
}

function exampleTemplate(folder: string, name: string, color: SectionColor, prompt: string, extra: { note?: string; imageKey?: string; off?: string[] } = {}): SectionTemplate {
  const chips = parsePrompt(prompt).map((p) => ({ ...p, disabled: !!extra.off?.includes(p.text) }))
  const t: SectionTemplate = { id: newId('st'), name, color, folder, chips, createdAt: 0 }
  if (extra.note) t.note = extra.note
  if (extra.imageKey) t.imageKey = extra.imageKey
  return t
}

function exampleTemplates(): SectionTemplate[] {
  return [
    exampleTemplate('表情/笑', '温柔微笑', 'pink', 'smile, closed mouth, 0.8::blush::, looking at viewer', { note: 'blush 在 0.8 左右最自然；要露齿笑用「大笑」。' }),
    exampleTemplate('表情/笑', '坏笑', 'pink', 'smirk, grin, fang, 1.1::looking at viewer::', { note: 'fang 是虎牙，不想要就禁用；侧脸构图时把看向镜头去掉。' }),
    exampleTemplate('表情/笑', '大笑', 'pink', 'laughing, open mouth, :d, closed eyes, happy'),
    exampleTemplate('表情/哭', '啜泣', 'sky', 'crying, tears, sad, frown'),
    exampleTemplate('表情/生气', '鼓脸生气', 'rose', 'angry, pout, frown, 0.8::blush::'),
    exampleTemplate('光照', '柔和逆光', 'amber', 'backlighting, 1.1::light rays::, dappled sunlight, light particles, depth of field', {
      note: '户外白天的逆光。light rays 超过 1.2 容易过曝；要背景清楚就删掉 depth of field。',
      imageKey: 'ex:backlight',
    }),
    exampleTemplate('光照', '日落轮廓光', 'amber', 'sunset, backlighting, rim lighting, sky, cloud', {
      note: '黄昏专用，别和 day 一起用；人物边缘那圈光靠 rim lighting。',
      imageKey: 'ex:sunset',
    }),
    exampleTemplate('光照', '霓虹夜', 'violet', 'neon lights, night, dramatic lighting', { note: '夜景城市，配 rain、wet ground 倒影更明显。', imageKey: 'ex:neon' }),
    exampleTemplate('构图', '特写', 'teal', 'close-up, portrait, depth of field'),
    exampleTemplate('构图', '全身远景', 'teal', 'full body, wide shot, scenery'),
    exampleTemplate('构图', '俯视倾斜', 'teal', 'from above, dutch angle'),
    exampleTemplate('质量', '高质量', 'lime', 'masterpiece, best quality, very aesthetic, absurdres', {
      note: 'NAI 的质量预设 Standard 已经带了 very aesthetic、masterpiece，导出栏会标重复，可以点「NAI 去重」。',
    }),
    exampleTemplate('质量', '通用负面', 'slate', 'lowres, bad anatomy, bad hands, missing fingers, extra digits, jpeg artifacts, signature, watermark, blurry', {
      note: 'UC 预设 Heavy 已经包含 lowres、jpeg artifacts，留着只是重复，不影响出图。',
    }),
    exampleTemplate('场景', '和风场景', 'rose', 'cherry blossoms, petals, shrine, lantern, kimono, wide sleeves', {
      note: '神社 + 灯笼会把镜头拉远，要特写就删掉 shrine；kimono 是衣服，放进角色里更好。',
      imageKey: 'ex:wafu',
    }),
    exampleTemplate('场景', '樱花晴天', 'teal', 'outdoors, 1.2::cherry blossoms, petals::, blue sky, cloud, day, depth of field, 0.8::light particles', {
      note: '樱花那组权重别超过 1.3，不然整张图都是粉的；cloud 关着，要云就打开。',
      imageKey: 'ex:sakura',
      off: ['cloud'],
    }),
    exampleTemplate('', '雨天', 'sky', 'rain, wet hair, wet clothes, puddle, overcast'),
    exampleTemplate('', '圆眼镜', 'slate', 'round eyewear, glasses'),
  ]
}

export function findExampleTemplate(name: string): SectionTemplate | undefined {
  return useLibrary.getState().sectionTemplates.find((t) => t.createdAt === 0 && t.name === name)
}

export function findExampleCharacter(name: string): CharacterTemplate | undefined {
  return useLibrary.getState().characterTemplates.find((t) => t.createdAt === 0 && t.name === name)
}

export const exampleLinks = { section: findExampleTemplate, character: findExampleCharacter }

function exampleCharacterTemplates(): CharacterTemplate[] {
  // Build avatars lazily because store initialization runs before module-level constants are initialized.
  const EXAMPLE_CHAR_IMAGE: Record<string, string> = {
    芙莉莲: 'ex:frieren',
    菲伦: 'ex:fern',
    修塔尔克: 'ex:stark',
    辛美尔: 'ex:himmel',
    后藤一里: 'ex:hitori',
    伊地知虹夏: 'ex:nijika',
    狐耳巫女: 'ex:kitsune',
  }
  return [...Object.values(exampleCharacters()), ...libraryOnlyCharacters()].map(({ id: _id, enabled: _e, center: _c, templateId: _t, templateEdited: _te, ...c }) => ({
    ...c,
    id: newId('ct'),
    imageKey: EXAMPLE_CHAR_IMAGE[c.name],
    createdAt: 0,
  }))
}

function exampleDocs(): SavedDoc[] {
  return exampleDocTemplates().map((t) => ({ id: newId('dt'), title: t.title, doc: t.doc, createdAt: 0, savedAt: 0 }))
}

function exampleVariants(): Record<string, string[]> {
  return { 'long hair': ['long flowing hair', 'messy long hair'], smile: ['gentle smile', 'shy smile'] }
}

/** Delete only untouched examples during migration; preserve user edits and ignore settings whose defaults change across schemas. */
function removeUntouchedExamples(s: Partial<LibraryState> & { docTemplates?: Omit<SavedDoc, 'savedAt'>[] }) {
  s.sectionTemplates = withoutUntouched(s.sectionTemplates, exampleTemplates())
  s.characterTemplates = withoutUntouched(s.characterTemplates, exampleCharacterTemplates())
  s.docTemplates = withoutUntouched(s.docTemplates, exampleDocs(), (t) => fingerprint({ title: t.title, base: t.doc.base, characters: t.doc.characters }))
  if (s.variants) {
    const variants = { ...s.variants }
    for (const [base, list] of Object.entries(exampleVariants())) if (fingerprint(variants[base]) === fingerprint(list)) delete variants[base]
    s.variants = variants
  }
  const secs = s.sectionTemplates
  const ids = new Set([...secs, ...s.characterTemplates].map((t) => t.id))
  s.favorites = (s.favorites ?? []).filter((f) => {
    const [kind, rest] = [f.slice(0, f.indexOf(':')), f.slice(f.indexOf(':') + 1)]
    return kind === 'folder' ? secs.some((t) => t.folder === rest || t.folder.startsWith(rest + '/')) : ids.has(rest)
  })
}

function defaultFavorites(templates: SectionTemplate[]): FavoriteKey[] {
  const tpl = ['柔和逆光', '通用负面'].flatMap((n) => templates.filter((t) => t.createdAt === 0 && t.name === n).map((t) => favTemplate(t.id)))
  return [favFolder('光照'), ...tpl]
}

export function variantBase(text: string, variants: Record<string, string[]>, isOfficial: (t: string) => boolean): string | null {
  if (isOfficial(text)) return text
  for (const [base, list] of Object.entries(variants)) if (list.includes(text)) return base
  return null
}
