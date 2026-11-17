import { produce } from 'immer'
import { temporal } from 'zundo'
import { immer } from 'zustand/middleware/immer'
import { createStore } from 'zustand/vanilla'
import { V5_DEFAULT_GEN, clampWeight, newId, stepWeight } from '@/lib/nai'
import { applySectionText, sameChips as sameChipsWithIds } from '@/lib/section-text'
import { sameChips } from '@/lib/template-link'
import { sameCharacterContent } from '@/lib/char-template'
import { cleanGenderExtra, takeGender, type GenderValue } from '@/lib/gender'
import { normalizeRandomSection } from '@/lib/random-block'
import type { BoxField, BoxRef, Character, Chip, Doc, Gender, GenderExtra, GenParams, RandomRule, Section, SectionColor } from '@/types'
import { SECTION_COLORS } from '@/types'
import { isModelId, maxCharacters, switchModel } from '@/lib/nai-models'

export interface DocActions {
  setTitle(title: string): void
  updateSettings(patch: Partial<Doc['settings']>, coalesce?: string): void
  updateGen(patch: Partial<GenParams>, coalesce?: string): void
  replaceDoc(doc: Doc): void
  applyDoc(doc: Doc): void

  addSection(box: BoxRef, opts?: { name?: string; index?: number; chips?: Chip[] }): string
  updateSection(id: string, patch: Partial<Pick<Section, 'name' | 'color' | 'muted' | 'note' | 'templateId' | 'templateEdited' | 'ownColor'>>): void
  setTextMode(id: string, on: boolean): void
  setSectionText(id: string, text: string): void
  removeSection(id: string): void
  moveSectionTo(id: string, targetId: string): void
  reorderSections(box: BoxRef, ids: string[]): void
  moveSectionToBox(id: string, box: BoxRef): void
  insertSection(section: Section, at: { near: string; side: 'before' | 'after' } | { box: BoxRef }): void
  setRandom(id: string, patch: { rule?: RandomRule; chips?: Chip[]; gender?: GenderValue }, coalesce?: string): void
  insertMany(add: { prompt?: Section[]; characters?: Character[] }): number
  presetToSection(field: BoxField, section: Section): void

  addChips(sectionId: string, chips: Chip[], index?: number): void
  updateChip(id: string, patch: Partial<Omit<Chip, 'id'>>): void
  updateChips(patches: { id: string; patch: Partial<Omit<Chip, 'id'>> }[]): void
  replaceChip(id: string, chips: Chip[]): void
  removeChips(ids: string[]): void
  adjustWeight(ids: string[], delta: number): void
  setWeight(ids: string[], weight: number, coalesce?: boolean): void
  toggleDisabled(ids: string[]): void
  moveChips(ids: string[], toSectionId: string): void
  moveChip(id: string, toSectionId: string, beforeId: string | null): void
  placeChips(ids: string[], toSectionId: string, beforeId: string | null): void
  extractChips(ids: string[]): string | null
  applyDrag(cols: Record<string, Chip[]> | null, move?: { id: string; targetId: string } | null): void

  addCharacter(gender: Gender, genderExtra?: GenderExtra): string | null
  updateCharacter(id: string, patch: Partial<Pick<Character, 'name' | 'enabled' | 'center' | 'gender' | 'genderExtra' | 'note' | 'color' | 'work' | 'templateId' | 'templateEdited'>>): void
  insertCharacter(c: Character, at?: { after: string } | { index: number }): boolean
  followCharacterColor(sectionId: string): void
  moveCharacter(id: string, toIndex: number): void
  removeCharacter(id: string): void
}

export type DocState = { doc: Doc } & DocActions

export function defaultSettings(): Doc['settings'] {
  return { qualityTags: 'standard', ucPreset: 'heavy', model: 'v5-full', mode: 'anime', effort: 'high', transparent: false, useCoords: false, gen: { ...V5_DEFAULT_GEN }, nsfw: false }
}

const DEFAULT_CENTER = { x: 0.5, y: 0.5 }

const unfold = (list: Section[]) =>
  list.map((s) => {
    if (!('collapsed' in s)) return normalizeRandomSection(s)
    const { collapsed: _, ...rest } = s as Section & { collapsed?: boolean }
    return normalizeRandomSection(rest)
  })

/** Persisted qualityTags may be boolean and forkedFrom may be a tab-ID string; normalize both before stores use them. */
export function normalizeDoc(doc: Doc): Doc {
  const fork = doc.meta.forkedFrom as Doc['meta']['forkedFrom'] | string | undefined
  const q = doc.settings.qualityTags as Doc['settings']['qualityTags'] | boolean | undefined
  const qualityTags = q === true || q === undefined ? 'standard' : q === false ? 'none' : q
  const def = defaultSettings()
  const model = isModelId(doc.settings.model) ? doc.settings.model : def.model
  const perModel = doc.settings.perModel ? Object.fromEntries(Object.entries(doc.settings.perModel).filter(([k, v]) => isModelId(k) && k !== model && v && typeof v === 'object')) : undefined
  return freshIds({
    ...doc,
    meta: typeof fork === 'string' ? { ...doc.meta, forkedFrom: { docId: fork } } : doc.meta,
    base: { prompt: unfold(doc.base.prompt), uc: unfold(doc.base.uc) },
    settings: { ...def, ...doc.settings, model, qualityTags, gen: { ...def.gen, ...doc.settings.gen }, ...(perModel ? { perModel } : {}) },
    characters: doc.characters.map((c) => {
      const { position: _, genderExtra: rawExtra, ...rest } = c as Character & { position?: unknown }
      const genderExtra = cleanGenderExtra(rawExtra)
      const prompt = unfold(rest.prompt)
      const g = rest.gender ? { gender: rest.gender, sections: prompt } : takeGender(prompt)
      const color = rest.color ?? [...rest.prompt, ...rest.uc][0]?.color ?? 'slate'
      const own = (list: Section[]) => (rest.color ? list : list.map((x) => (x.color === color ? x : { ...x, ownColor: true })))
      return {
        ...rest,
        name: /^角色 \d+$/.test(rest.name.trim()) ? '' : rest.name,
        gender: g.gender,
        ...(genderExtra ? { genderExtra } : {}),
        color,
        prompt: own(g.sections),
        uc: own(unfold(rest.uc)),
        center: rest.center ?? { ...DEFAULT_CENTER },
      }
    }),
  })
}

/** Persisted documents may contain duplicate IDs; replace later duplicates to preserve both entries without ambiguous edits or React keys. */
function freshIds(doc: Doc): Doc {
  const seen = { s: new Set<string>(), c: new Set<string>(), ch: new Set<string>() }
  const fresh = (kind: keyof typeof seen, id: string) => {
    const out = seen[kind].has(id) ? newId(kind) : id
    seen[kind].add(out)
    return out
  }
  const fixList = (list: Section[]) => {
    const next = list.map((s) => {
      const id = fresh('s', s.id)
      const chips = s.chips.map((c) => {
        const cid = fresh('c', c.id)
        return cid === c.id ? c : { ...c, id: cid }
      })
      return id === s.id && chips.every((c, i) => c === s.chips[i]) ? s : { ...s, id, chips }
    })
    return next.every((s, i) => s === list[i]) ? list : next
  }
  const prompt = fixList(doc.base.prompt)
  const uc = fixList(doc.base.uc)
  const characters = doc.characters.map((c) => {
    const id = fresh('ch', c.id)
    const p = fixList(c.prompt)
    const u = fixList(c.uc)
    return id === c.id && p === c.prompt && u === c.uc ? c : { ...c, id, prompt: p, uc: u }
  })
  if (prompt === doc.base.prompt && uc === doc.base.uc && characters.every((c, i) => c === doc.characters[i])) return doc
  return { ...doc, base: { prompt, uc }, characters }
}

export function sectionList(doc: Doc, box: BoxRef): Section[] {
  if (box.kind === 'base') return doc.base[box.field]
  const c = doc.characters.find((c) => c.id === box.charId)
  if (!c) throw new Error(`character ${box.charId} not found`)
  return c[box.field]
}

export function allBoxes(doc: Doc): BoxRef[] {
  const out: BoxRef[] = [
    { kind: 'base', field: 'prompt' },
    { kind: 'base', field: 'uc' },
  ]
  for (const c of doc.characters) {
    out.push({ kind: 'char', charId: c.id, field: 'prompt' }, { kind: 'char', charId: c.id, field: 'uc' })
  }
  return out
}

export function allSections(doc: Doc): Section[] {
  return allBoxes(doc).flatMap((b) => sectionList(doc, b))
}

export function findSection(doc: Doc, id: string) {
  for (const box of allBoxes(doc)) {
    const list = sectionList(doc, box)
    const index = list.findIndex((s) => s.id === id)
    if (index >= 0) return { box, list, index, section: list[index] }
  }
  return null
}

export function findChip(doc: Doc, id: string) {
  for (const section of allSections(doc)) {
    const index = section.chips.findIndex((c) => c.id === id)
    if (index >= 0) return { section, index, chip: section.chips[index] }
  }
  return null
}

export function charOfSection(doc: Doc, sectionId: string): string | null {
  const box = findSection(doc, sectionId)?.box
  return box?.kind === 'char' ? box.charId : null
}

export const boxKey = (b: BoxRef) => (b.kind === 'base' ? `base.${b.field}` : `${b.charId}.${b.field}`)

function moveSectionInDoc(d: Doc, id: string, targetId: string) {
  if (id === targetId) return
  const flat = allSections(d).map((s) => s.id)
  const movingDown = flat.indexOf(id) < flat.indexOf(targetId)
  const from = findSection(d, id)
  if (!from) return
  const [sec] = from.list.splice(from.index, 1)
  const t = findSection(d, targetId)
  if (!t) return from.list.splice(from.index, 0, sec)
  t.list.splice(movingDown ? t.index + 1 : t.index, 0, sec)
}

const COLOR_CYCLE = Object.keys(SECTION_COLORS) as SectionColor[]

function pendingFixes(prev: Doc, next: Doc) {
  let before: Map<string, Section> | null = null
  const sections: string[] = []
  for (const s of allSections(next)) {
    if (!s.templateId || s.templateEdited) continue
    before ??= new Map(allSections(prev).map((x) => [x.id, x]))
    const p = before.get(s.id)
    if (p && p.chips !== s.chips && !sameChips(p.chips, s.chips)) sections.push(s.id)
  }
  const chars: string[] = []
  for (const c of next.characters) {
    if (!c.templateId || c.templateEdited) continue
    const p = prev.characters.find((x) => x.id === c.id)
    if (p && p !== c && (p.prompt !== c.prompt || p.uc !== c.uc || p.gender !== c.gender || p.genderExtra !== c.genderExtra) && !sameCharacterContent(p, c)) chars.push(c.id)
  }
  const colors =
    next.characters.some((c) => [...c.prompt, ...c.uc].some((x) => !x.ownColor && x.color !== c.color)) || [...next.base.prompt, ...next.base.uc].some((x) => x.ownColor)
  return sections.length || chars.length || colors ? { sections, chars, colors } : null
}

/** Apply derived markers and colors in the same state update so undo restores the entire edit. */
/** Preserve docId and forkedFrom when replacing content so image history remains attached to this document. */
function keepIdentity(prev: Doc, next: Doc): Doc {
  const { docId, forkedFrom } = prev.meta
  if (next.meta.docId === docId && next.meta.forkedFrom === forkedFrom) return next
  const meta = { ...next.meta, docId }
  if (forkedFrom) meta.forkedFrom = forkedFrom
  else delete meta.forkedFrom
  return { ...next, meta }
}

function finish(prev: Doc, next: Doc): Doc {
  const f = pendingFixes(prev, next)
  if (!f) return next
  return produce(next, (d) => {
    for (const id of f.sections) {
      const t = findSection(d, id)
      if (t) t.section.templateEdited = true
    }
    for (const c of d.characters) if (f.chars.includes(c.id)) c.templateEdited = true
    if (f.colors) syncCharColors(d)
  })
}

function syncCharColors(d: Doc) {
  for (const c of d.characters)
    for (const s of [...c.prompt, ...c.uc]) if (!s.ownColor && s.color !== c.color) s.color = c.color
  for (const s of [...d.base.prompt, ...d.base.uc]) if (s.ownColor) delete s.ownColor
}

export function nextCharColor(used: SectionColor[]): SectionColor {
  const order = [...COLOR_CYCLE.filter((c) => c !== 'slate'), 'slate' as const]
  return order.find((c) => !used.includes(c)) ?? order[used.length % order.length]
}

export function makeSection(name: string, chips: Chip[] = [], color?: SectionColor): Section {
  return { id: newId('s'), name, color: color ?? COLOR_CYCLE[Math.floor(Math.random() * COLOR_CYCLE.length)], muted: false, chips }
}

export type DocStore = ReturnType<typeof createDocStore>

const COALESCE_MS = 900

export function createDocStore(initial: Doc) {
  let nextKey: string | null = null
  let last: { key: string; t: number } | null = null
  const coalesce = (key: string) => {
    nextKey = key
  }

  const store = createStore<DocState>()(
    temporal(
      immer((set, get) => {
        // Do not return fn's value from the Immer recipe: Immer interprets a returned value as replacement state.
        const mut = (fn: (doc: Doc) => void) => {
          const prev = get().doc
          const next = produce(prev, (d) => {
            fn(d)
          })
          if (next !== prev) set({ doc: finish(prev, next) })
          // No-op edits skip handleSet; clear their coalescing key here so the next unrelated edit keeps its own undo step.
          nextKey = null
        }

        const eachChip = (doc: Doc, ids: string[], fn: (c: Chip) => void) => {
          const want = new Set(ids)
          for (const s of allSections(doc)) for (const c of s.chips) if (want.has(c.id)) fn(c)
        }

        return {
          doc: initial,

          setTitle: (title) => mut((d) => void (d.meta.title = title)),
          updateSettings: (patch, key) => {
            if (key) coalesce(key)
            const { model, ...rest } = patch
            const switched = model && model !== get().doc.settings.model ? switchModel(get().doc.settings, model) : null
            mut((d) => {
              if (switched) d.settings = switched
              Object.assign(d.settings, rest)
            })
          },
          updateGen: (patch, key) => {
            if (key) coalesce(key)
            mut((d) => {
              // NAI resets Noise Schedule to the new sampler's default when the sampler changes.
              if (patch.sampler !== undefined && patch.sampler !== d.settings.gen.sampler && !('noiseSchedule' in patch)) delete d.settings.gen.noiseSchedule
              Object.assign(d.settings.gen, patch)
            })
          },
          replaceDoc: (doc) =>
            set((s) => {
              s.doc = keepIdentity(get().doc, doc)
            }),
          applyDoc: (doc) => {
            const prev = get().doc
            if (doc !== prev) set({ doc: finish(prev, keepIdentity(prev, doc)) })
          },

          addSection: (box, opts = {}) => {
            const sec = makeSection(opts.name ?? '新区块', opts.chips ?? [])
            mut((d) => {
              const list = sectionList(d, box)
              list.splice(opts.index ?? list.length, 0, sec)
            })
            return sec.id
          },
          updateSection: (id, patch) =>
            mut((d) => {
              const f = findSection(d, id)
              if (!f) return
              Object.assign(f.section, patch)
              if (patch.color && f.box.kind === 'char') {
                const box = f.box
                const c = d.characters.find((x) => x.id === box.charId)
                f.section.ownColor = c && patch.color !== c.color ? true : undefined
              }
            }),
          followCharacterColor: (id) =>
            mut((d) => {
              const f = findSection(d, id)
              if (f) delete f.section.ownColor
            }),
          setTextMode: (id, on) => {
            if (!on) coalesce(`text:${id}`)
            mut((d) => {
              const f = findSection(d, id)
              if (f) f.section.textMode = on || undefined
            })
          },
          setSectionText: (id, text) => {
            const f = findSection(get().doc, id)
            if (!f) return
            const chips = applySectionText(f.section.chips, text)
            if (sameChipsWithIds(chips, f.section.chips)) return
            coalesce(`text:${id}`)
            mut((d) => {
              const t = findSection(d, id)
              if (t) t.section.chips = chips
            })
          },
          removeSection: (id) =>
            mut((d) => {
              const f = findSection(d, id)
              if (f) f.list.splice(f.index, 1)
            }),
          moveSectionTo: (id, targetId) => mut((d) => moveSectionInDoc(d, id, targetId)),
          reorderSections: (box, ids) =>
            mut((d) => {
              const list = sectionList(d, box)
              const cur = list.map((s) => s.id).join()
              if (cur === ids.join()) return
              const byId = new Map(list.map((s) => [s.id, s]))
              const next = ids.map((id) => byId.get(id)).filter((s): s is Section => !!s)
              if (next.length !== list.length) return
              list.splice(0, list.length, ...next)
            }),
          moveSectionToBox: (id, box) =>
            mut((d) => {
              const from = findSection(d, id)
              if (!from) return
              const [sec] = from.list.splice(from.index, 1)
              sectionList(d, box).push(sec)
            }),
          insertSection: (section, at) =>
            mut((d) => {
              if ('box' in at) return void sectionList(d, at.box).push(section)
              const f = findSection(d, at.near)
              if (!f) return void d.base.prompt.push(section)
              f.list.splice(at.side === 'after' ? f.index + 1 : f.index, 0, section)
            }),

          setRandom: (id, patch, key) => {
            if (key) coalesce(key)
            mut((d) => {
              const f = findSection(d, id)
              if (!f) return
              if (patch.rule) f.section.random = patch.rule
              if (patch.chips) f.section.chips = patch.chips
              if (patch.gender && f.box.kind === 'char') {
                const box = f.box
                const c = d.characters.find((x) => x.id === box.charId)
                if (c) {
                  c.gender = patch.gender.gender
                  if (patch.gender.genderExtra) c.genderExtra = structuredClone(patch.gender.genderExtra)
                  else delete c.genderExtra
                }
              }
            })
          },
          presetToSection: (field, section) =>
            mut((d) => {
              if (field === 'prompt') {
                d.base.prompt.push(section)
                d.settings.qualityTags = 'none'
              } else {
                d.base.uc.unshift(section)
                d.settings.ucPreset = 'none'
              }
            }),
          insertMany: (add) => {
            const room = Math.max(0, maxCharacters(get().doc.settings.model) - get().doc.characters.length)
            const chars = (add.characters ?? []).slice(0, room)
            if (!add.prompt?.length && !chars.length) return 0
            mut((d) => {
              d.base.prompt.push(...(add.prompt ?? []))
              d.characters.push(...chars)
            })
            return chars.length
          },

          addChips: (sectionId, chips, index) =>
            mut((d) => {
              const f = findSection(d, sectionId)
              if (!f) return
              f.section.chips.splice(index ?? f.section.chips.length, 0, ...chips)
            }),
          updateChip: (id, patch) =>
            mut((d) => {
              const f = findChip(d, id)
              if (f) Object.assign(f.chip, patch)
            }),
          updateChips: (patches) =>
            mut((d) => {
              const by = new Map(patches.map((p) => [p.id, p.patch]))
              for (const s of allSections(d)) for (const c of s.chips) if (by.has(c.id)) Object.assign(c, by.get(c.id))
            }),
          replaceChip: (id, chips) =>
            mut((d) => {
              const f = findChip(d, id)
              if (f) f.section.chips.splice(f.index, 1, ...chips)
            }),
          removeChips: (ids) =>
            mut((d) => {
              const want = new Set(ids)
              for (const s of allSections(d)) if (s.chips.some((c) => want.has(c.id))) s.chips = s.chips.filter((c) => !want.has(c.id))
            }),
          adjustWeight: (ids, delta) => {
            coalesce(`w:${ids.join(',')}`)
            mut((d) => eachChip(d, ids, (c) => void (c.weight = stepWeight(c.weight, delta))))
          },
          setWeight: (ids, weight, merge) => {
            if (merge) coalesce(`w:${ids.join(',')}`)
            mut((d) => eachChip(d, ids, (c) => void (c.weight = clampWeight(weight))))
          },
          toggleDisabled: (ids) =>
            mut((d) => {
              const chips: Chip[] = []
              eachChip(d, ids, (c) => chips.push(c))
              const to = !chips.every((c) => c.disabled)
              chips.forEach((c) => (c.disabled = to))
            }),
          moveChips: (ids, toSectionId) =>
            mut((d) => {
              const want = new Set(ids)
              const moving: Chip[] = []
              for (const s of allSections(d)) {
                s.chips = s.chips.filter((c) => (want.has(c.id) ? (moving.push(c), false) : true))
              }
              const t = findSection(d, toSectionId)
              t?.section.chips.push(...moving)
            }),
          moveChip: (id, toSectionId, beforeId) =>
            mut((d) => {
              if (beforeId === id) return
              const from = findChip(d, id)
              const to = findSection(d, toSectionId)
              if (!from || !to) return
              if (from.section.id === toSectionId) {
                const next = from.section.chips[from.index + 1]?.id ?? null
                if (next === beforeId) return
              }
              const [chip] = from.section.chips.splice(from.index, 1)
              const idx = beforeId ? to.section.chips.findIndex((c) => c.id === beforeId) : -1
              to.section.chips.splice(idx < 0 ? to.section.chips.length : idx, 0, chip)
            }),
          placeChips: (ids, toSectionId, beforeId) => {
            const d = get().doc
            const target = findSection(d, toSectionId)
            if (!target) return
            const want = new Set(ids)
            const moving = allSections(d).flatMap((s) => s.chips.filter((c) => want.has(c.id)))
            if (!moving.length) return
            const rest = target.section.chips.filter((c) => !want.has(c.id))
            const from = beforeId ? target.section.chips.findIndex((c) => c.id === beforeId) : -1
            const before = from < 0 ? null : (target.section.chips.slice(from).find((c) => !want.has(c.id))?.id ?? null)
            const at = before ? rest.findIndex((c) => c.id === before) : rest.length
            const next = [...rest.slice(0, at), ...moving, ...rest.slice(at)]
            const others = allSections(d).filter((s) => s.id !== toSectionId && s.chips.some((c) => want.has(c.id)))
            if (!others.length && next.map((c) => c.id).join() === target.section.chips.map((c) => c.id).join()) return
            mut((doc) => {
              for (const s of allSections(doc)) {
                if (s.id === toSectionId) s.chips = next
                else if (s.chips.some((c) => want.has(c.id))) s.chips = s.chips.filter((c) => !want.has(c.id))
              }
            })
          },
          extractChips: (ids) => {
            const d = get().doc
            const want = new Set(ids)
            const first = allSections(d).find((s) => s.chips.some((c) => want.has(c.id)))
            if (!first) return null
            const sec = makeSection('新区块', allSections(d).flatMap((s) => s.chips.filter((c) => want.has(c.id))))
            mut((doc) => {
              for (const s of allSections(doc)) if (s.chips.some((c) => want.has(c.id))) s.chips = s.chips.filter((c) => !want.has(c.id))
              const f = findSection(doc, first.id)
              f?.list.splice(f.index + 1, 0, sec)
            })
            return sec.id
          },
          applyDrag: (cols, move) =>
            mut((d) => {
              if (cols) for (const s of allSections(d)) if (cols[s.id]) s.chips = cols[s.id]
              if (move) moveSectionInDoc(d, move.id, move.targetId)
            }),

          addCharacter: (gender, genderExtra) => {
            if (get().doc.characters.length >= maxCharacters(get().doc.settings.model)) return null
            const id = newId('ch')
            mut((d) => {
              const color = nextCharColor(d.characters.map((c) => c.color))
              d.characters.push({
                id,
                name: '',
                gender,
                ...(genderExtra ? { genderExtra: structuredClone(genderExtra) } : {}),
                color,
                prompt: [makeSection('外观', [], color)],
                uc: [],
                enabled: true,
                center: { ...DEFAULT_CENTER },
              })
            })
            return id
          },
          updateCharacter: (id, patch) =>
            mut((d) => {
              const c = d.characters.find((c) => c.id === id)
              if (!c) return
              Object.assign(c, patch)
              if ('genderExtra' in patch && !patch.genderExtra) delete c.genderExtra
            }),
          insertCharacter: (c, at) => {
            if (get().doc.characters.length >= maxCharacters(get().doc.settings.model)) return false
            mut((d) => {
              const after = at && 'after' in at ? d.characters.findIndex((x) => x.id === at.after) : -1
              const i = after >= 0 ? after + 1 : at && 'index' in at ? Math.max(0, Math.min(at.index, d.characters.length)) : d.characters.length
              d.characters.splice(i, 0, c)
            })
            return true
          },
          moveCharacter: (id, toIndex) => {
            const from = get().doc.characters.findIndex((c) => c.id === id)
            if (from < 0 || from === toIndex) return
            mut((d) => {
              const [c] = d.characters.splice(from, 1)
              d.characters.splice(Math.max(0, Math.min(toIndex, d.characters.length)), 0, c)
            })
          },
          removeCharacter: (id) =>
            mut((d) => {
              d.characters = d.characters.filter((c) => c.id !== id)
            }),
        }
      }),
      {
        limit: 300,
        partialize: (s) => ({ doc: s.doc }),
        equality: (a, b) => a.doc === b.doc,
        handleSet: (handleSet) => (pastState, replace, currentState, deltaState) => {
          const key = nextKey
          nextKey = null
          const now = performance.now()
          // After undo, the previous edit is no longer atop the undo stack; coalescing would make the new edit irreversible and redo could overwrite it.
          const fresh = !store.temporal.getState().futureStates.length
          if (key && fresh && last && last.key === key && now - last.t < COALESCE_MS) {
            last.t = now
            return
          }
          last = key ? { key, t: now } : null
          // Zundo types handleSet as setState, but calls it with four arguments.
          ;(handleSet as unknown as (...a: unknown[]) => void)(pastState, replace, currentState, deltaState)
        },
      },
    ),
  )
  return store
}
