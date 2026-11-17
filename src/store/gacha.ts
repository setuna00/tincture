// Retain inactive collection and exclusion data so loading this schema cannot erase saved user content.
import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { DEFAULT_TEMPLATE } from '@/lib/gacha-templates'
import { stripLive, withPopularity, type Count, type Draw, type GachaCollection, type GachaPool } from '@/lib/gacha'
import { safeStorage } from './storage'

const exKey = (collId: string, poolId: string) => `${collId}/${poolId}`

export function mapPool(pools: GachaPool[], id: string, fn: (p: GachaPool) => GachaPool): GachaPool[] {
  return pools.map((p) => (p.id === id ? fn(p) : p.children?.some((c) => c.id === id) ? { ...p, children: p.children.map((c) => (c.id === id ? fn(c) : c)) } : p))
}
export function findPool(pools: readonly GachaPool[], id: string): { pool: GachaPool; parent: GachaPool | null } | null {
  for (const p of pools) {
    if (p.id === id) return { pool: p, parent: null }
    const c = p.children?.find((x) => x.id === id)
    if (c) return { pool: c, parent: p }
  }
  return null
}

/** Zero is an explicit tuning value; only undefined means use the template default. */
export interface Tuned {
  count?: Count
  popularity?: number
}

interface GachaState {
  collections: GachaCollection[]
  excludes: Record<string, string[]>
  activeId: string
  templates: Record<string, Record<string, Tuned>>
  activeTemplate: string
  setActiveTemplate(id: string): void
  tune(tplId: string, poolId: string, patch: Tuned): void
  excludeOf(collId: string, poolId: string): string[]
}

export const useGacha = create<GachaState>()(
  persist(
    (set, get) => ({
      collections: [],
      excludes: {},
      activeId: 'builtin:example',
      templates: {},
      activeTemplate: DEFAULT_TEMPLATE,
      setActiveTemplate: (id) => set({ activeTemplate: id }),
      tune: (tplId, poolId, patch) =>
        set((s) => {
          const cur: Tuned = { ...s.templates[tplId]?.[poolId], ...patch }
          for (const k of Object.keys(cur) as (keyof Tuned)[]) if (cur[k] === undefined) delete cur[k]
          const tpl = { ...s.templates[tplId] }
          if (Object.keys(cur).length) tpl[poolId] = cur
          else delete tpl[poolId]
          const templates = { ...s.templates }
          if (Object.keys(tpl).length) templates[tplId] = tpl
          else delete templates[tplId]
          return { templates }
        }),
      excludeOf: (collId, poolId) => get().excludes[exKey(collId, poolId)] ?? [],
    }),
    {
      name: 'pe:gacha',
      version: 6,
      storage: createJSONStorage(() => safeStorage),
      partialize: (s) => ({ collections: s.collections, excludes: s.excludes, activeId: s.activeId, templates: s.templates, activeTemplate: s.activeTemplate }),
      migrate: (persisted, version) => {
        const s = persisted as { collections?: GachaCollection[]; templates?: unknown; activeTemplate?: unknown }
        if (version < 2) for (const c of s.collections ?? []) c.pools = c.pools.map((p) => (p.source.length ? { ...p, picked: [] } : { ...p, picked: [...p.tags], sourceTags: [] }))
        if (version < 3) for (const c of s.collections ?? []) c.pools = c.pools.map((p) => (p.sourceTags?.length === p.source.length ? stripLive(p) : p))
        if (version < 4) for (const c of s.collections ?? []) c.pools = c.pools.map(withPopularity)
        if (version < 5) {
          s.templates = {}
          s.activeTemplate = DEFAULT_TEMPLATE
        }
        if (version < 6 && s.activeTemplate === 'tpl:r18') s.activeTemplate = DEFAULT_TEMPLATE
        return persisted as GachaState
      },
    },
  ),
)

export type Results = Record<string, Draw[]>

interface RunState {
  selPools: string[]
  selTags: string[]
  anchor: string | null
  results: Record<string, Results>
  poolLocks: Record<string, string[]>
  history: Record<string, { at: number; results: Results }[]>
  rollSeq: number
  set(patch: Partial<Omit<RunState, 'set'>>): void
}

export const useGachaRun = create<RunState>()((set) => ({
  selPools: [],
  selTags: [],
  anchor: null,
  results: {},
  poolLocks: {},
  history: {},
  rollSeq: 0,
  set: (patch) => set(patch),
}))

export const tagKey = (poolId: string, tag: string) => `${poolId}|${tag}`
export function splitTagKey(key: string): [string, string] {
  const i = key.indexOf('|')
  return [key.slice(0, i), key.slice(i + 1)]
}
export const clearSelection = () => useGachaRun.getState().set({ selPools: [], selTags: [], anchor: null })
