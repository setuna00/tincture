import { describe, expect, it } from 'vitest'
import { parsePrompt, toChip } from '@/lib/nai'
import { blankDoc } from '@/store/sample'
import type { GenImage } from '@/store/storage'
import type { Doc } from '@/types'
import { buildEntries, chipsSig, dirImages, dirSubtree, dirTree, isNear, makeStack, seriesOf, sortEntries, stackKey, templatesUsed, tileLayout, type Entry, type GalleryDir } from './gallery-stacks'

const chips = (text: string) => parsePrompt(text).map((c, i) => ({ ...toChip(c), id: `c${i}` }))
const doc = (text: string): Doc => {
  const d = blankDoc()
  d.base.prompt = [{ ...d.base.prompt[0], chips: chips(text) }]
  return d
}
let t = 0
const img = (tabId: string, version: number | null, text: string, extra: Partial<GenImage> = {}): GenImage => ({
  id: `i${++t}`,
  tabId,
  versionId: version == null ? undefined : `${tabId}-v${version}`,
  version: version ?? undefined,
  batch: `b${t}`,
  index: 0,
  createdAt: t * 1000,
  seed: t,
  width: 832,
  height: 1216,
  model: 'nai-diffusion-4-5-full',
  mime: 'image/webp',
  size: 1,
  doc: doc(text),
  ...extra,
})

const BASE = '1girl, solo, frieren, white hair, long hair, rain, night, umbrella, cityscape, artist:wlop'

describe('相近版本', () => {
  it('增删 ≤ max(3, 15%) 算相近，改权重不算改动', () => {
    expect(isNear(doc(BASE), doc(`${BASE}, smile`))).toBe(true)
    expect(isNear(doc(BASE), doc(BASE.replace('rain', '1.2::rain::')))).toBe(true)
    expect(isNear(doc(BASE), doc('1girl, solo, frieren, standing, holding umbrella, street, day, smile, artist:wlop'))).toBe(false)
  })
  it('同一份文档按版本号接成串，大改另起一串', () => {
    const imgs = [img('d', 1, BASE), img('d', 2, `${BASE}, smile`), img('d', 3, `${BASE}, smile, closed eyes`), img('d', 4, '1girl, beach, sunset, white dress'), img('d', 5, '1girl, beach, sunset, white dress, smile')]
    const s = seriesOf(imgs)
    expect([1, 2, 3, 4, 5].map((n) => s.get(`d:${n}`))).toEqual([0, 0, 0, 1, 1])
  })
})

describe('排序', () => {
  const one = (title: string): Entry => ({ kind: 'one', img: img('d', 1, BASE, { doc: { ...doc(BASE), meta: { ...doc(BASE).meta, title } } }) })
  const name = (e: Entry) => (e.kind === 'one' ? e.img.doc.meta.title : 'stack')
  it('名称：英文 / 数字在前、中文按拼音，A → Z / Z → A；叠照旧在前；一样的照原来的顺序', () => {
    const st = buildEntries([img('s', 1, BASE), img('s', 1, BASE)], 'version', {}, new Map())[0]
    const list = [one('雨夜芙莉莲'), one('海边日落'), st, one('猫耳少女'), one('海边日落'), one('NAI 下载 10'), one('NAI 下载 2')]
    const asc = sortEntries(list, 'name', 'asc', name, () => 0)
    expect(asc.map(name)).toEqual(['stack', 'NAI 下载 2', 'NAI 下载 10', '海边日落', '海边日落', '猫耳少女', '雨夜芙莉莲'])
    expect(asc[3]).toBe(list[1])
    expect(sortEntries(list, 'name', 'desc', name, () => 0).map(name)).toEqual(['stack', '雨夜芙莉莲', '猫耳少女', '海边日落', '海边日落', 'NAI 下载 10', 'NAI 下载 2'])
  })
  it('tag 数：多的在前 / 少的在前；按时间原样', () => {
    const list = [one('a'), one('b'), one('c')]
    const tags = (e: Entry) => ({ a: 3, b: 9, c: 5 })[name(e) as 'a']
    expect(sortEntries(list, 'tags', 'desc', name, tags).map(name)).toEqual(['b', 'c', 'a'])
    expect(sortEntries(list, 'tags', 'asc', name, tags).map(name)).toEqual(['a', 'c', 'b'])
    expect(sortEntries(list, 'time', 'asc', name, tags)).toEqual(list)
  })
})

describe('叠', () => {
  it('同一版本叠为一组，只有一张的不算叠；位置在第一张出现的地方', () => {
    const a = img('d', 1, BASE)
    const b = img('d', 1, BASE)
    const c = img('d', 2, `${BASE}, smile`)
    const e = buildEntries([b, c, a], 'version', {}, new Map())
    expect(e.map((x) => x.kind)).toEqual(['stack', 'one'])
    expect(e[0].kind === 'stack' && e[0].stack.items.map((x) => x.id)).toEqual([a.id, b.id])
  })
  it('相近版本：几个版本一组，frames = 每版的封面；封面 = 收藏过的里最新的', () => {
    const v1a = img('d', 1, BASE)
    const v1b = img('d', 1, BASE)
    const v2 = img('d', 2, `${BASE}, smile`)
    const big = img('d', 3, '1girl, beach, sunset, white dress')
    const s = seriesOf([v1a, v1b, v2, big])
    const e = buildEntries([big, v2, v1b, v1a], 'near', { [v1a.id]: true }, s)
    expect(e.map((x) => x.kind)).toEqual(['stack', 'one'])
    const st = e[0].kind === 'stack' ? e[0].stack : null
    expect(st?.versions).toEqual([1, 2])
    expect(st?.cover.id).toBe(v1a.id)
    expect(st?.frames.map((x) => x.id)).toEqual([v1a.id, v2.id])
  })
  it('加工出来的图挂在原图那一版下，跟着那一组；导入的图按内容一样的叠；不叠 = 每张一格', () => {
    const src = img('d', 1, BASE)
    const up = img('d', 1, BASE, { label: 'upscale', sourceId: src.id, width: 1664, height: 2432 })
    expect(stackKey(src, 'version', new Map())).toBe(stackKey(up, 'version', new Map()))
    const i1 = img('imported', null, BASE)
    const i2 = img('imported', null, BASE)
    const i3 = img('imported', null, 'scenery')
    expect(stackKey(i1, 'version', new Map())).toBe(stackKey(i2, 'version', new Map()))
    expect(stackKey(i1, 'version', new Map())).not.toBe(stackKey(i3, 'version', new Map()))
    expect(buildEntries([src, up], 'off', {}, new Map()).length).toBe(2)
  })
  it('只有一个版本时 frames = 每一张', () => {
    const a = img('d', 1, BASE)
    const b = img('d', 1, BASE)
    expect(makeStack('k', [b, a], {}).frames.map((x) => x.id)).toEqual([a.id, b.id])
  })
  it('flipped-to covers: a pick beats a favorite, the latest pick wins; in a multi-version stack the frame of that version is the pick', () => {
    const a = img('d', 1, BASE)
    const b = img('d', 1, BASE)
    const c = img('d', 1, BASE)
    expect(makeStack('k', [a, b, c], { [c.id]: true }).cover.id).toBe(c.id)
    expect(makeStack('k', [a, b, c], { [c.id]: true }, { [a.id]: 1 }).cover.id).toBe(a.id)
    expect(makeStack('k', [a, b, c], {}, { [a.id]: 1, [b.id]: 2 }).cover.id).toBe(b.id)
    const v2a = img('d', 2, BASE)
    const v2b = img('d', 2, BASE)
    const st = makeStack('k', [a, v2a, v2b], {}, { [v2a.id]: 5 })
    expect(st.cover.id).toBe(v2a.id)
    expect(st.frames.map((x) => x.id)).toEqual([a.id, v2a.id])
  })
})

describe('和模板一模一样', () => {
  it('从模板插入后没改过 / 内容和模板一样 = 算；改过的不算；停用的区块不算', () => {
    const tplChips = chips('artist:wlop, painterly, thick paint')
    const sigs = new Map([[chipsSig(tplChips), 'T1']])
    const ids = new Set(['T1', 'T2'])
    const d = doc(BASE)
    d.base.prompt.push({ ...d.base.prompt[0], id: 's2', chips: chips('artist:wlop, painterly, thick paint') })
    expect(templatesUsed(d, sigs, ids, new Set())).toEqual(['T1'])
    const edited = doc(BASE)
    edited.base.prompt[0] = { ...edited.base.prompt[0], templateId: 'T2', templateEdited: true }
    expect(templatesUsed(edited, sigs, ids, new Set())).toEqual([])
    const linked = doc(BASE)
    linked.base.prompt[0] = { ...linked.base.prompt[0], templateId: 'T2' }
    expect(templatesUsed(linked, sigs, ids, new Set())).toEqual(['T2'])
    const muted = doc('artist:wlop, painterly, thick paint')
    muted.base.prompt[0] = { ...muted.base.prompt[0], muted: true }
    expect(templatesUsed(muted, sigs, ids, new Set())).toEqual([])
  })
})

describe('目录', () => {
  const dirs: GalleryDir[] = [
    { id: 'a', name: '风格', parent: null, items: { x: 1 }, createdAt: 1 },
    { id: 'b', name: '水彩', parent: 'a', items: { y: 1 }, createdAt: 2 },
    { id: 'c', name: '壁纸', parent: null, items: { x: 1, z: 1 }, createdAt: 3 },
  ]
  it('子树、含子目录的图、按树排', () => {
    expect(dirSubtree(dirs, 'a')).toEqual(['a', 'b'])
    expect([...dirImages(dirs, 'a')].sort()).toEqual(['x', 'y'])
    expect(dirTree(dirs).map((d) => [d.dir.id, d.depth, d.branch])).toEqual([
      ['a', 1, true],
      ['b', 2, false],
      ['c', 1, false],
    ])
  })
})

describe('并排看的平铺', () => {
  it('不超出区域，最小那张尽量大；两张竖图并排一行', () => {
    const P = { w: 832, h: 1216 }
    const two = tileLayout([P, P], 1000, 600, 10)
    expect(two.map((x) => Math.round(x.y))).toEqual([0, 0])
    const nine = tileLayout(Array(9).fill(P), 1200, 800, 10)
    for (const x of nine) {
      expect(x.x).toBeGreaterThanOrEqual(-0.01)
      expect(x.y + x.h).toBeLessThanOrEqual(800.01)
      expect(x.x + x.w).toBeLessThanOrEqual(1200.01)
    }
    expect(new Set(nine.map((x) => Math.round(x.y))).size).toBeGreaterThan(1)
  })
})
