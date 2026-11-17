import { describe, expect, it } from 'vitest'
import { exportDoc, parsePrompt, toChip } from '@/lib/nai'
import { blankDoc } from '@/store/sample'
import type { Character, Doc } from '@/types'
import {
  countValues,
  emptyFacet,
  facetRows,
  factsOf,
  forget,
  hasWord,
  hitTest,
  justify,
  locate,
  matchQuery,
  neighbor,
  parseQuery,
  passFacet,
  restore,
  setFav,
  splitCharacters,
  toggleFacet,
  tokenFacet,
  toTrash,
  type GalleryMarks,
} from './gallery'

const chips = (text: string) => parsePrompt(text).map((c, i) => ({ ...toChip(c), id: `c${i}` }))

describe('等高按行（图库）', () => {
  const P = { w: 832, h: 1216 }
  const L = { w: 1216, h: 832 }

  it('放满一行就缩放到正好撑满宽度，最后一行按目标行高不拉伸', () => {
    const rows = justify(Array(6).fill(P), 600, 200, 8)
    expect(rows.length).toBe(2)
    const [a, b] = rows
    expect(a.items.length).toBe(4)
    const right = a.items[3].x + a.items[3].w
    expect(right).toBeCloseTo(600, 6)
    expect(a.h).toBeCloseTo((600 - 3 * 8) / (4 * (832 / 1216)), 6)
    expect(b.y).toBeCloseTo(a.h + 8, 6)
    expect(b.h).toBe(200)
    expect(b.items.map((i) => i.index)).toEqual([4, 5])
  })

  it('同一行的高度一样、宽按各自的比例；顺序不变', () => {
    const rows = justify([P, L, P, L, P], 900, 220, 8)
    const flat = rows.flatMap((r) => r.items.map((i) => i.index))
    expect(flat).toEqual([0, 1, 2, 3, 4])
    for (const r of rows) for (const it of r.items) expect(it.w / r.h).toBeCloseTo([P, L, P, L, P][it.index].w / [P, L, P, L, P][it.index].h, 6)
  })

  it('一张就比整行宽的单独一行、按宽度缩', () => {
    const wide = { w: 4000, h: 500 }
    const rows = justify([P, wide, P], 600, 200, 8)
    const r = rows.find((x) => x.items.some((i) => i.index === 1))!
    expect(r.items.length).toBe(1)
    expect(r.items[0].w).toBeCloseTo(600, 6)
    expect(r.h).toBeCloseTo(75, 6)
    expect(rows[0].h).toBe(200)
    expect(rows.map((x) => x.items.length)).toEqual([1, 1, 1])
  })

  it('宽度 0（还没量出来）不排', () => {
    expect(justify([P], 0, 200, 8)).toEqual([])
  })

  it('方向键：←→ 前后一张，↑↓ 上 / 下一行横向最近的；到头不动', () => {
    const rows = justify(Array(10).fill(P), 600, 200, 8)
    expect(locate(rows, 5)).toEqual({ row: 1, col: 1 })
    expect(neighbor(rows, 5, 'up', 10)).toBe(1)
    expect(neighbor(rows, 1, 'down', 10)).toBe(5)
    expect(neighbor(rows, 0, 'left', 10)).toBe(0)
    expect(neighbor(rows, 9, 'right', 10)).toBe(9)
    expect(neighbor(rows, 2, 'up', 10)).toBe(2)
    expect(neighbor(rows, 7, 'down', 10)).toBe(9)
  })

  it('框选：和矩形相交的都算', () => {
    const rows = justify(Array(8).fill(P), 600, 200, 8)
    const a = rows[0].items
    const hit = hitTest(rows, { x: a[1].x + 10, y: 50, w: a[2].x - a[1].x, h: rows[1].y + 20 - 50 })
    expect(hit.sort((x, y) => x - y)).toEqual([1, 2, 5, 6])
    expect(hitTest(rows, { x: 0, y: rows[1].y + rows[1].h + 100, w: 600, h: 10 })).toEqual([])
  })
})

describe('从快照取 tag / 画师', () => {
  it('启用的区块和 tag；画师去掉前缀；自然语言、文字渲染、负面不算；角色只算启用的', () => {
    const d: Doc = blankDoc()
    d.base.prompt[0].chips = chips('1girl, artist:wlop, Long Hair, {rain}, Text: Hello')
    d.base.prompt.push({ ...d.base.prompt[0], id: 's2', muted: true, chips: chips('night') })
    d.base.uc[0].chips = chips('lowres')
    d.base.prompt[0].chips.push({ ...chips('smile')[0], id: 'x', disabled: true })
    const char = (enabled: boolean, text: string): Character => ({ id: `ch${text}`, name: '', gender: 'female', color: 'rose', prompt: [{ ...d.base.prompt[0], id: `p${text}`, chips: chips(text) }], uc: [], enabled, center: { x: 0.5, y: 0.5 } })
    d.characters = [char(true, 'frieren, artist:ask'), char(false, 'fern')]
    const f = factsOf(d)
    expect(f.artists.sort()).toEqual(['ask', 'wlop'])
    expect(f.tags.sort()).toEqual(['1girl', 'frieren', 'long hair', 'rain'])
  })

  it('全文：启用的区块里自然语言和 Text: 的原文另给一份（小写），tags / artists 不变；负面、停用的不算', () => {
    const d: Doc = blankDoc()
    d.base.prompt[0].chips = chips('1girl, sunlight filtering through ancient pine trees, Text: Neon Dreams')
    d.base.prompt.push({ ...d.base.prompt[0], id: 's2', muted: true, chips: chips('a quiet morning by the old harbor') })
    d.base.uc[0].chips = chips('ugly hands drawn in a hurry by someone')
    const char = (enabled: boolean, text: string): Character => ({ id: `ch${text}`, name: '', gender: 'female', color: 'rose', prompt: [{ ...d.base.prompt[0], id: `p${text}`, chips: chips(text) }], uc: [], enabled, center: { x: 0.5, y: 0.5 } })
    d.characters = [char(true, 'frieren, holding a cup of warm tea'), char(false, 'walking alone under the falling snow')]
    const f = factsOf(d)
    expect(f.tags.sort()).toEqual(['1girl', 'frieren'])
    expect(f.free.sort()).toEqual(['holding a cup of warm tea', 'neon dreams', 'sunlight filtering through ancient pine trees'])
  })
})

describe('角色筛选', () => {
  it('认作角色的拿出来，其余（含查不到的）留在 plain，顺序不变', () => {
    const known = new Set(['frieren', 'fern'])
    expect(splitCharacters(['1girl', 'frieren', 'white hair', 'fern', 'my oc'], (t) => known.has(t))).toEqual({ characters: ['frieren', 'fern'], plain: ['1girl', 'white hair', 'my oc'] })
  })
})

describe('详情里的 tag 能点', () => {
  it('画师 → 画师、角色 → 角色、其余 → tag；自动加的 girl / nsfw、自然语言、Text:、这张图筛不到的不能点', () => {
    const d: Doc = blankDoc()
    d.settings.nsfw = true
    d.base.prompt[0].chips = chips('artist:wlop, Frieren, 1.3::rain::, a girl standing alone in the rain, Text: Hi')
    const char: Character = { id: 'ch', name: '', gender: 'female', color: 'rose', prompt: [{ ...d.base.prompt[0], id: 'p', chips: chips('smile') }], uc: [], enabled: true, center: { x: 0.5, y: 0.5 } }
    d.characters = [char]
    const facts = { ...factsOf(d), ...splitCharacters(factsOf(d).tags, (t) => t === 'frieren') }
    const toks = exportDoc(d)
      .filter((b) => b.field === 'prompt')
      .flatMap((b) => b.tokens)
      .filter((t) => t.k === 'tag')
    const got = toks.map((t) => [t.t, tokenFacet(t, facts)])
    expect(got).toEqual([
      ['nsfw', null],
      ['artist:wlop', { key: 'artist', value: 'wlop' }],
      ['Frieren', { key: 'character', value: 'frieren' }],
      ['rain', { key: 'tag', value: 'rain' }],
      ['a girl standing alone in the rain', null],
      ['Text: Hi', null],
      ['girl', null],
      ['smile', { key: 'tag', value: 'smile' }],
    ])
    expect(tokenFacet({ type: 'tag', lit: 'night' }, facts)).toBeNull()
  })
})

describe('搜索语法', () => {
  it('空格 = 且，-词 = 排除，下划线当空格', () => {
    expect(parseQuery('  Frieren   rain -night long_hair -')).toEqual({ all: ['frieren', 'rain', 'long hair', '-'], none: ['night'] })
  })
  it('英文在词首才算，中文直接包含', () => {
    expect(hasWord('1girl\nrainbow', 'rain')).toBe(true)
    expect(hasWord('brain', 'rain')).toBe(false)
    expect(hasWord('long hair\n长发', '长发')).toBe(true)
    const text = 'frieren\nrain\nlong hair\n芙莉莲'
    expect(matchQuery(text, parseQuery('frieren rain'))).toBe(true)
    expect(matchQuery(text, parseQuery('frieren -rain'))).toBe(false)
    expect(matchQuery(text, parseQuery('long_hair 芙莉莲'))).toBe(true)
    expect(matchQuery(text, parseQuery('fern'))).toBe(false)
  })
})

describe('筛选条', () => {
  it('且 / 或 / 排除', () => {
    const v = ['a', 'b']
    expect(passFacet(v, { on: ['a', 'b'], off: [], any: false })).toBe(true)
    expect(passFacet(v, { on: ['a', 'c'], off: [], any: false })).toBe(false)
    expect(passFacet(v, { on: ['a', 'c'], off: [], any: true })).toBe(true)
    expect(passFacet(v, { on: [], off: ['b'], any: false })).toBe(false)
    expect(passFacet(v, emptyFacet())).toBe(true)
  })
  it('左键选中 / 去掉，右键排除 / 取消排除，两边互斥', () => {
    let f = emptyFacet()
    f = toggleFacet(f, 'a', false)
    expect(f.on).toEqual(['a'])
    f = toggleFacet(f, 'a', true)
    expect(f).toMatchObject({ on: [], off: ['a'] })
    f = toggleFacet(f, 'a', false)
    expect(f).toMatchObject({ on: [], off: [] })
    f = toggleFacet(toggleFacet(f, 'b', true), 'b', true)
    expect(f.off).toEqual([])
  })
  describe('筛选项跟着收窄（facetRows）', () => {
    const lists = [['a', 'b'], ['a', 'c'], ['b', 'c'], ['d']]
    it('没选：按起点数，多的在前', () => {
      expect(facetRows(lists, emptyFacet())).toEqual([
        ['a', 2],
        ['b', 2],
        ['c', 2],
        ['d', 1],
      ])
    })
    it('包含全部：选中的要满足，列表只剩和它同时出现过的，0 张的不列', () => {
      expect(facetRows(lists, { on: ['a'], off: [], any: false })).toEqual([
        ['a', 2],
        ['b', 1],
        ['c', 1],
      ])
    })
    it('包含任一：选中的不收窄（不然选了一个其他选项就没了）', () => {
      expect(facetRows(lists, { on: ['a'], off: [], any: true })).toEqual([
        ['a', 2],
        ['b', 2],
        ['c', 2],
        ['d', 1],
      ])
    })
    it('排除的一律去掉；排除的那行写它挡掉了几张', () => {
      expect(facetRows(lists, { on: [], off: ['c'], any: false })).toEqual([
        ['c', 2],
        ['a', 1],
        ['b', 1],
        ['d', 1],
      ])
      expect(facetRows(lists, { on: ['a'], off: ['c'], any: false })).toEqual([
        ['a', 1],
        ['c', 1],
        ['b', 1],
      ])
    })
    it('选中的、排除的排最前，0 张也留着', () => {
      expect(facetRows(lists, { on: ['d', 'a'], off: [], any: false })).toEqual([
        ['d', 0],
        ['a', 0],
      ])
      expect(facetRows([['x']], { on: [], off: ['zzz'], any: false })).toEqual([
        ['zzz', 0],
        ['x', 1],
      ])
    })
  })

  it('计数：多的在前', () => {
    expect(countValues([['a', 'b'], ['b'], ['c', 'b']])).toEqual([
      ['b', 3],
      ['a', 1],
      ['c', 1],
    ])
  })
})

describe('★ 和回收站', () => {
  it('移入记时间（再移不改）、恢复、永久删除连 ★ 一起去掉', () => {
    let m: GalleryMarks = { fav: {}, trash: {} }
    m = setFav(m, ['a', 'b'], true)
    m = toTrash(m, ['a'], 100)
    m = toTrash(m, ['a', 'c'], 200)
    expect(m.trash).toEqual({ a: 100, c: 200 })
    m = restore(m, ['c'])
    expect(m.trash).toEqual({ a: 100 })
    m = forget(m, ['a'])
    expect(m).toEqual({ fav: { b: true }, trash: {} })
    expect(setFav(m, ['b'], false).fav).toEqual({})
  })
})
