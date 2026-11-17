import { artistsSourceName, DEFAULT_ARTIST_SOURCE, DEFAULT_MIN_COUNT, withContent, type ArtistWeight, type Count, type GachaCollection, type GachaPool, type GenderPick, type PoolKind, type PoolSource } from './gacha'
import type { SectionColor } from '@/types'

export interface GachaTemplate extends GachaCollection {
  summary: string
}

export type Resolve = (s: PoolSource) => string[] | null | undefined

interface PoolDef {
  id: string
  name: string
  color: SectionColor
  kind?: PoolKind
  path?: string
  source?: PoolSource
  count: Count
  popularity: number
  weight?: ArtistWeight
  genders?: GenderPick[]
}

const list = (path: string): PoolSource => ({ kind: 'list', list: 'b', path, minCount: DEFAULT_MIN_COUNT })

const DEFS: { id: string; name: string; pools: PoolDef[] }[] = [
  {
    id: 'tpl:char',
    name: '角色',
    pools: [{ id: 'tpl-char', name: '角色', color: 'fuchsia', kind: 'char', source: { kind: 'chars', minCount: 0 }, count: [1, 1], popularity: 1, genders: ['canon'] }],
  },
  {
    id: 'tpl:artist',
    name: '画师',
    pools: [{ id: 'tpl-artist', name: '画师', color: 'rose', kind: 'artist', source: DEFAULT_ARTIST_SOURCE, count: [2, 2], popularity: 0, weight: 'main' }],
  },
  {
    id: 'tpl:scene',
    name: '场景',
    pools: [
      { id: 'tpl-scene-place', name: '地点', color: 'teal', path: '场景/地点', count: [1, 1], popularity: 0.5 },
      { id: 'tpl-scene-time', name: '天气时间', color: 'green', path: '场景/天气时间', count: [0, 1], popularity: 0.5 },
      { id: 'tpl-scene-light', name: '光', color: 'indigo', path: '画面/光影色彩/光', count: [1, 1], popularity: 0.5 },
      { id: 'tpl-scene-camera', name: '构图镜头', color: 'sky', path: '画面/构图镜头', count: [0, 1], popularity: 0.5 },
    ],
  },
  {
    id: 'tpl:people',
    name: '人物',
    pools: [
      { id: 'tpl-people-outfit', name: '服装', color: 'violet', path: '外观/服装/按类型/成套服装', count: [1, 1], popularity: 0.5 },
      { id: 'tpl-people-hair', name: '发型', color: 'pink', path: '外观/头发/发型', count: [0, 1], popularity: 0.5 },
      { id: 'tpl-people-face', name: '表情', color: 'amber', path: '表情动作/表情', count: [1, 1], popularity: 0.5 },
      { id: 'tpl-people-pose', name: '姿势', color: 'orange', path: '表情动作/姿势', count: [1, 1], popularity: 0.5 },
      { id: 'tpl-people-gaze', name: '视线', color: 'lime', path: '表情动作/视线', count: [0, 1], popularity: 0.5 },
    ],
  },
]

export const TEMPLATE_IDS = DEFS.map((d) => d.id)
export const DEFAULT_TEMPLATE = DEFS[0].id

const fmt = (n: number) => n.toLocaleString('en-US')

export function gachaTemplates(resolve: Resolve): GachaTemplate[] {
  return DEFS.map((d) => {
    const pools = d.pools.map((p): GachaPool => {
      const source = p.source ?? list(p.path!)
      return withContent({
        id: p.id,
        name: p.name,
        color: p.color,
        kind: p.kind ?? 'tag',
        target: 'prompt',
        tags: [],
        source: [source],
        sourceTags: [resolve(source) ?? []],
        picked: [],
        syncedAt: 0,
        count: p.count,
        popularity: p.popularity,
        ...(p.weight ? { weight: p.weight } : {}),
        ...(p.genders ? { genders: p.genders } : {}),
      })
    })
    const one = pools.length === 1 ? pools[0] : null
    const summary = one?.kind === 'char' ? `角色库全部 · ${fmt(one.tags.length)}` : one?.kind === 'artist' ? artistsSourceName(one.source[0] as Extract<PoolSource, { kind: 'artists' }>) : pools.map((p) => p.name).join(' · ')
    return { id: d.id, name: d.name, createdAt: 0, pools, summary }
  })
}
