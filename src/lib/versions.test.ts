import { describe, expect, it } from 'vitest'
import { blankDoc } from '@/store/sample'
import type { Character, Doc } from '@/types'
import { parsePrompt, toChip } from './nai'
import { changesText, groupBatches, sameVersion, versionChanges } from './versions'

const chips = (s: string) => parsePrompt(s).map(toChip)
function doc(prompt: string, uc = ''): Doc {
  const d = blankDoc('雨夜')
  d.base.prompt[0].chips = chips(prompt)
  d.base.uc[0].chips = chips(uc)
  return d
}
const next = (d: Doc, f: (x: Doc) => void) => {
  const x = structuredClone(d)
  f(x)
  return x
}

describe('同一版', () => {
  it('不比 seed、张数、标题、meta、perModel、区块名 / 颜色 / 备注、chip id', () => {
    const a = doc('1girl, rain')
    const b = next(a, (x) => {
      x.settings.gen.seed = 123
      x.settings.gen.nSamples = 4
      x.meta = { title: '改了', docId: 'd_x', createdAt: 9 }
      x.settings.perModel = { 'v45-full': structuredClone({ ...x.settings, perModel: undefined }) }
      x.base.prompt[0].name = '新名字'
      x.base.prompt[0].color = 'rose'
      x.base.prompt[0].note = '备注'
      x.base.prompt[0].chips = x.base.prompt[0].chips.map((c, i) => ({ ...c, id: `c${i}` }))
    })
    expect(sameVersion(a, b)).toBe(true)
  })

  it('tag、权重、开关、区块停用、步数、角色都算', () => {
    const a = doc('1girl, rain')
    expect(sameVersion(a, next(a, (x) => x.base.prompt[0].chips.pop()))).toBe(false)
    expect(sameVersion(a, next(a, (x) => (x.base.prompt[0].chips[1].weight = 1.2)))).toBe(false)
    expect(sameVersion(a, next(a, (x) => (x.base.prompt[0].chips[1].disabled = true)))).toBe(false)
    expect(sameVersion(a, next(a, (x) => (x.base.prompt[0].muted = true)))).toBe(false)
    expect(sameVersion(a, next(a, (x) => (x.settings.gen.steps = 28)))).toBe(false)
  })
})

describe('老图并成版本', () => {
  const img = (id: string, batch: string, t: number, d: Doc) => ({ id, batch, createdAt: t, index: 0, doc: d })
  it('内容一样的归到同一版（不只比相邻的，改回来 = 回到那一版）；和已有的版本比，接着编号', () => {
    const rain = doc('rain')
    const seedOnly = next(rain, (x) => (x.settings.gen.seed = 5))
    const snow = doc('snow')
    const r = groupBatches([img('i3', 'b3', 3, snow), img('i1', 'b1', 1, rain), img('i2', 'b2', 2, seedOnly), img('i4', 'b4', 4, rain)])
    expect(r.versions.map((v) => v.n)).toEqual([1, 2])
    expect(Object.fromEntries(r.of)).toEqual({ i1: 1, i2: 1, i3: 2, i4: 1 })
    const fog = doc('fog')
    const after = groupBatches([img('i5', 'b5', 5, rain), img('i6', 'b6', 6, fog)], [{ n: 7, snapshot: rain }, { n: 3, snapshot: snow }])
    expect(after.versions.map((v) => v.n)).toEqual([8])
    expect(Object.fromEntries(after.of)).toEqual({ i5: 7, i6: 8 })
  })
})

describe('两版之间改了什么', () => {
  it('删 / 加 / 关掉 / 权重 / 负面 / 设置', () => {
    const a = doc('1girl, cloud, petals', 'lowres')
    const b = next(a, (x) => {
      const p = x.base.prompt[0].chips
      x.base.prompt[0].chips = [p[0], p[2], ...chips('light particles')]
      p[2].weight = 1.2
      x.base.uc[0].chips[0].disabled = true
      x.settings.gen.steps = 28
      x.settings.gen.seed = 99
    })
    expect(changesText(versionChanges(a, b))).toBe('-cloud petals 1 → 1.2 +light particles · 负面：-lowres · 步数 23 → 28')
  })

  it('角色前面写角色名；加 / 删角色；停用区块；加的带权重写法', () => {
    const a = doc('1girl')
    const frieren: Character = { id: 'ch1', name: '芙莉莲', gender: 'female', color: 'teal', prompt: [{ ...blankDoc().base.prompt[0], id: 's_f', chips: chips('smile') }], uc: [], enabled: true, center: { x: 0.5, y: 0.5 } }
    a.characters = [frieren]
    const b = next(a, (x) => {
      x.characters[0].prompt[0].chips.push(...chips('1.2::blush::'))
      x.base.prompt[0].muted = true
      x.characters.push({ ...structuredClone(frieren), id: 'ch2', name: '菲伦' })
    })
    expect(changesText(versionChanges(a, b))).toBe(`停用「${a.base.prompt[0].name}」 · 芙莉莲：+1.2::blush:: · 添加角色「菲伦」`)
  })

  it('一样 = 没有改动', () => {
    const a = doc('rain')
    expect(versionChanges(a, structuredClone(a))).toEqual([])
  })
})
