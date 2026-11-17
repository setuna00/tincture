import { describe, expect, it } from 'vitest'
import { ARTIST_ALGO_LABEL, ARTIST_ALGOS, isPopAlgo, POP_ALGOS, rankOrder } from './artist-rank'
import { artistAlgoOf, artistsSourceName, artistTopOf, cleanArtistsSource, DEFAULT_ARTIST_SOURCE, popBasis, poolArtistAlgo, usesPopularity } from './gacha'
import { cleanRandomRule } from './random-block'
import { migratePrefs } from '@/store/prefs'

describe('画师推荐算法', () => {
  it('名次：分高的在前，同分按名单行序（作品数多的在前），不排的（null）不在里面', () => {
    expect(rankOrder([5, null, 9, 5, 0, null])).toEqual([2, 0, 3, 4])
    expect(rankOrder([])).toEqual([])
  })
  it('作品数 + 三种人气，界面上的叫法', () => {
    expect(ARTIST_ALGOS).toEqual(['count', ...POP_ALGOS])
    expect(ARTIST_ALGOS.map((a) => ARTIST_ALGO_LABEL[a])).toEqual(['作品数', '代表作人气', '好评率', '总人气'])
    expect(isPopAlgo('rep')).toBe(true)
    expect(isPopAlgo('count')).toBe(false)
    expect(isPopAlgo('nope')).toBe(false)
  })
})

describe('画师库来源按推荐算法', () => {
  it('没有 by = 作品数，by = 一种人气 + 前几位', () => {
    expect(artistAlgoOf({ kind: 'artists', minCount: 1000 })).toBe('count')
    expect(artistAlgoOf(DEFAULT_ARTIST_SOURCE as never)).toBe('rep')
    expect(artistTopOf({ kind: 'artists', by: 'hit' })).toBe(1000)
    expect(artistTopOf({ kind: 'artists', by: 'hit', top: 0 })).toBe(0)
  })
  it('来源的名字：作品 ≥1000 / 代表作人气前 1000 / 全部', () => {
    expect(artistsSourceName({ kind: 'artists', minCount: 1000 })).toBe('画师库 · 作品 ≥1000')
    expect(artistsSourceName({ kind: 'artists' })).toBe('画师库 · 作品 ≥1000')
    expect(artistsSourceName({ kind: 'artists', minCount: 0 })).toBe('画师库全部')
    expect(artistsSourceName({ kind: 'artists', by: 'rep', top: 1000 })).toBe('画师库 · 代表作人气前 1000')
    expect(artistsSourceName({ kind: 'artists', by: 'total', top: 500 })).toBe('画师库 · 总人气前 500')
    expect(artistsSourceName({ kind: 'artists', by: 'hit', top: 0 })).toBe('画师库全部')
  })
  it('整理存档 / 导入：人气的前几位取最近的一档，认不出的 by 当作品数，旧的 minCount 照旧', () => {
    expect(cleanArtistsSource({ kind: 'artists', by: 'rep', top: 1500 })).toEqual({ kind: 'artists', by: 'rep', top: 2000 })
    expect(cleanArtistsSource({ kind: 'artists', by: 'rep', top: 700 })).toEqual({ kind: 'artists', by: 'rep', top: 500 })
    expect(cleanArtistsSource({ kind: 'artists', by: 'hit', top: 99999 })).toEqual({ kind: 'artists', by: 'hit', top: 2000 })
    expect(cleanArtistsSource({ kind: 'artists', by: 'total', top: -3 })).toEqual({ kind: 'artists', by: 'total', top: 0 })
    expect(cleanArtistsSource({ kind: 'artists', by: 'total' })).toEqual({ kind: 'artists', by: 'total' })
    expect(cleanArtistsSource({ kind: 'artists', by: 'likes', minCount: 700 })).toEqual({ kind: 'artists', minCount: 500 })
    expect(cleanArtistsSource({ kind: 'artists', minCount: 1000 })).toEqual({ kind: 'artists', minCount: 1000 })
    const r = cleanRandomRule({ kind: 'artist', source: [{ kind: 'artists', by: 'rep', top: 1000 }], sourceTags: [[]], count: [3, 3], popularity: 0 })!
    expect(r.source).toEqual([{ kind: 'artists', by: 'rep', top: 1000 }])
  })
  it('抽法的权重跟第一个画师库来源的算法；滑条悬停写它的名字', () => {
    expect(poolArtistAlgo([{ kind: 'artistColl', coll: 'fav' }, { kind: 'artists', by: 'total', top: 500 }])).toBe('total')
    expect(poolArtistAlgo([{ kind: 'artistColl', coll: 'fav' }])).toBe('count')
    expect(popBasis({ kind: 'artist', source: [DEFAULT_ARTIST_SOURCE] })).toBe('代表作人气')
    expect(popBasis({ kind: 'artist', source: [{ kind: 'artists', minCount: 1000 }] })).toBe('作品数')
    expect(popBasis({ kind: 'tag', source: [] })).toBe('作品数')
    expect(usesPopularity([DEFAULT_ARTIST_SOURCE])).toBe(true)
    expect(usesPopularity([{ kind: 'artists', minCount: 0 }])).toBe(false)
  })
})

describe('画师库默认排序（偏好 v11）', () => {
  it('按作品数的偏好迁移成代表作人气，按名称的不动', () => {
    expect(migratePrefs({ artistSort: { by: 'count', desc: false } }).artistSort).toEqual({ by: 'rep', desc: true })
    expect(migratePrefs({ artistSort: { by: 'name', desc: false } }).artistSort).toEqual({ by: 'name', desc: false })
  })
})
