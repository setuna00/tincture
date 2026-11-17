import { useEffect, useSyncExternalStore } from 'react'
import charsUrl from '@/assets/tags/chars.json.gz?url'
import type { Gender } from '@/types'
import type { WorkContext } from './char-template'
import { fetchJsonGz } from './tag-data'
import { aliasOf, lookupTag, npmi } from './tagdb'

export interface CharsFile {
  v: 1 | 2
  works: string[]
  /** Numbers index works; v2 also permits rows with gender data but no work indices. */
  rows: [string, ...number[]][]
  /** One code per row: f/m/o = female/male/other, '-' = unknown; inferred from Danbooru solo posts. */
  g?: string
}

const GENDER: Record<string, Gender> = { f: 'female', m: 'male', o: 'other' }

export interface CharsIndex {
  works: Map<string, string[]>
  chars: Map<string, string[]>
  gender: Map<string, Gender>
  all?: string[]
}

const index: CharsIndex = { works: new Map(), chars: new Map(), gender: new Map(), all: [] }
let ready = false
let loading: Promise<void> | null = null
const listeners = new Set<() => void>()

export function decodeChars(f: CharsFile, into = index.works, more: Omit<CharsIndex, 'works'> = index) {
  f.rows.forEach(([name, ...ws], i) => {
    const list = ws.map((k) => f.works[k])
    if (list.length) into.set(name, list)
    for (const w of list) (more.chars.get(w) ?? more.chars.set(w, []).get(w)!).push(name)
    const g = GENDER[f.g?.[i] ?? '-']
    if (g) more.gender.set(name, g)
    more.all?.push(name)
  })
  return into
}

export function loadCharWorks(): Promise<void> {
  return (loading ??= fetchJsonGz<CharsFile>(new URL(charsUrl, location.href).href)
    .then((f) => {
      decodeChars(f)
      ready = true
      for (const l of listeners) l()
    })
    .catch((e) => console.error('角色 → 作品表加载失败', e)))
}

export const worksOf = (tag: string) => index.works.get(tag.toLowerCase()) ?? []
export const charsOfWork = (work: string) => index.chars.get(work.toLowerCase()) ?? []
export const allWorks = () => [...index.chars.keys()]
export const canonGender = (tag: string): Gender | null => index.gender.get(tag.toLowerCase()) ?? null
export const allChars = (): readonly string[] => index.all ?? []
export const charWorksReady = () => ready

export function useCharWorks(): boolean {
  useEffect(() => void loadCharWorks(), [])
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => ready,
  )
}

export const WORK_CTX: WorkContext = {
  isCharTag: (n) => lookupTag(n)?.category === 'character',
  worksOf,
  workLabel: (w) => lookupTag(w)?.zh || w,
  npmi,
  charLabel: (t) => lookupTag(t)?.zh || t,
  canonical: (n) => aliasOf(n) ?? n.toLowerCase(),
}
