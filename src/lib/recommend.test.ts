import { describe, expect, it } from 'vitest'
import type { TagEntry } from '@/types'
import { createRecommender, isNegativeTag, siblingsOf } from './recommend'
import { BY_NAME as T, COOC, ENTRIES } from './tag-fixture'

const rec = createRecommender(COOC, ENTRIES)
const names = (seeds: string[], exclude: string[] = seeds, opts?: Parameters<typeof rec>[3]) => rec(seeds.map((name) => ({ name, weight: 1 })), exclude, 12, opts).map((r) => r.name)
const groupOf = (n: string) => T.get(n)?.group
const domainOf = (n: string) => T.get(n)?.domain

describe('共现推荐', () => {
  it('芙莉莲 → 作品、同伴、精灵特征', () => {
    const r = names(['frieren'])
    expect(r).toContain('sousou no frieren')
    expect(r).toContain('elf')
  })
  it('校服 → 校服相关的服装', () => {
    const r = names(['school uniform', '1girl'])
    expect(r.slice(0, 6)).toContain('serafuku')
  })
  it('排除已有 tag', () => {
    expect(names(['frieren'], ['frieren', 'elf'])).not.toContain('elf')
  })
  it('1girl 这种万金油 tag 权重被压低，不会主导结果', () => {
    const r = rec([{ name: 'kimono', weight: 1 }, { name: '1girl', weight: 1 }], ['kimono', '1girl'], 5)
    expect(r[0].because).toBe('kimono')
  })
  it('同一个域不超过 6 个，同一个槽不超过 3 个', () => {
    const r = rec([{ name: 'long hair', weight: 1 }, { name: 'blonde hair', weight: 1 }], ['long hair', 'blonde hair'], 30)
    expect(r.filter((x) => domainOf(x.name) === '头发').length).toBeLessThanOrEqual(6)
    const perSlot = new Map<string, number>()
    for (const x of r) perSlot.set(groupOf(x.name) ?? '', (perSlot.get(groupOf(x.name) ?? '') ?? 0) + 1)
    expect(Math.max(...[...perSlot].filter(([g]) => g).map(([, n]) => n))).toBeLessThanOrEqual(3)
  })
})

describe('区块级推荐', () => {
  const scene = ['outdoors', 'cherry blossoms', 'petals', 'blue sky', 'day', 'depth of field', 'light particles']
  it('场景区块 → 场景 / 光影为主，不推 UC 词，不推和 day 冲突的 night', () => {
    const r = names(scene)
    expect(r).not.toContain('blurry')
    expect(r).not.toContain('night')
    expect(r).not.toContain('indoors')
    const themed = r.slice(0, 8).filter((n) => ['场景', '光影色彩', '构图镜头', '生物'].includes(domainOf(n) ?? ''))
    expect(themed.length).toBeGreaterThanOrEqual(6)
  })
  it('质量区块（共现表里没有 NAI 质量词）→ 用同组元数据补，且不推负向质量词', () => {
    const r = names(['very aesthetic', 'masterpiece', 'high complexity', 'absurdres'])
    expect(r.length).toBeGreaterThanOrEqual(5)
    expect(r.every((n) => groupOf(n) === '质量美学')).toBe(true)
    for (const x of ['has alpha', 'fur dataset', 'visual novel sprite']) expect(r).not.toContain(x)
    for (const bad of ['lowres', 'worst quality', 'bad quality', 'jpeg artifacts', 'commentary request', 'commentary', 'bad id']) expect(r).not.toContain(bad)
    for (const x of ['aesthetic', 'top aesthetic', 'medium complexity', 'ultra complexity']) expect(r).not.toContain(x)
  })
  it('主体有 2girls → 不推 solo / 1girl 这些人数 tag', () => {
    const r = names(['2girls', 'multiple girls', 'looking at viewer', 'smile', 'cowboy shot'])
    expect(r.filter((n) => groupOf(n) === '人数')).toEqual([])
    expect(r).not.toContain('frown')
  })
  it('角色框外观 → 不推别的角色', () => {
    const r = names(['girl', 'frieren', 'elf', 'pointy ears', 'white hair', 'twintails', 'green eyes', 'earrings', 'white capelet'], undefined, { character: true })
    expect(r.filter((n) => T.get(n)?.category === 'character')).toEqual([])
    expect(r).toContain('sousou no frieren')
    expect(r.filter((n) => / hair$/.test(n) && /black|blonde|brown|silver|grey|pink|purple|blue/.test(n))).toEqual([])
  })
  it('负面区块 → UC 词为主，不推 masterpiece 这类正向质量词', () => {
    const r = names(['lowres', 'bad anatomy', 'bad hands', 'missing fingers', 'watermark'], undefined, { negative: true })
    expect(r.slice(0, 5).every((n) => isNegativeTag(n, T.get(n)))).toBe(true)
    expect(r).not.toContain('masterpiece')
  })
})

describe('按单个 tag 推荐（选中 tag 时）', () => {
  it('cherry blossoms → 和它搭配的场景 tag；区块里有 day 就不推 night（context 参与冲突判断）', () => {
    const scene = ['outdoors', 'petals', 'blue sky', 'day', 'depth of field', 'light particles']
    const r = rec([{ name: 'cherry blossoms', weight: 1 }], ['cherry blossoms', ...scene], 12, { context: scene }).map((x) => x.name)
    expect(r.length).toBeGreaterThanOrEqual(6)
    expect(r).not.toContain('night')
    expect(r).not.toContain('indoors')
    expect(r.slice(0, 6).filter((n) => ['场景', '生物'].includes(domainOf(n) ?? '')).length).toBeGreaterThanOrEqual(3)
  })
})

describe('自建 list 的补充', () => {
  const scene = ['outdoors', 'petals', 'blue sky', 'day']
  const run = (extra?: string[]) => rec([{ name: 'cherry blossoms', weight: 1 }], ['cherry blossoms', ...scene], 30, { context: scene, extra }).map((x) => x.name)
  it('最多补 2 个，插在第 4、第 8 位；前 3 个还是共现推的', () => {
    const plain = run()
    const extra = ['hanfu', 'paper lantern', 'kimono']
    const r = run(extra)
    expect(r.slice(0, 3)).toEqual(plain.slice(0, 3))
    expect(extra).toContain(r[3])
    expect(extra).toContain(r[7])
    expect(r.filter((n) => extra.includes(n) && !plain.includes(n)).length).toBe(2)
  })
  it('过同一套过滤：区块里已有的、冲突的（有 day 不补 night）、不认得的都不补；已经推出来的不重复', () => {
    const plain = run()
    const r = run(['petals', 'night', 'gentle smile', plain[0]])
    expect(r).not.toContain('night')
    expect(r).not.toContain('gentle smile')
    expect(r.filter((n) => n === 'petals')).toHaveLength(0)
    expect(r.filter((n) => n === plain[0])).toHaveLength(1)
    expect(r).toEqual(plain)
  })
})

describe('换点新的', () => {
  const seedsOf = (names: string[]) => names.map((name) => ({ name, weight: 1 }))
  const fresh = (c: string[], context?: string[]) => rec(seedsOf(c), [...c, ...(context ?? [])], 30, { maxLevel: 1, fresh: true, ...(context ? { context } : {}) })
  const common = (c: string[]) => rec(seedsOf(c), c, 30, { maxLevel: 1 }).map((r) => r.name)
  const slotOf = (n: string) => T.get(n)?.group ?? ''

  it('和常见搭配一个都不重复，也不出区块里已有的', () => {
    for (const c of [['long hair', 'blue eyes'], ['outdoors', 'cherry blossoms', 'day'], ['sitting', 'crossed legs']]) {
      const r = fresh(c).map((x) => x.name)
      expect(r.length).toBeGreaterThanOrEqual(8)
      const cm = common(c)
      expect(r.filter((n) => cm.includes(n) || c.includes(n))).toEqual([])
    }
  })
  it('同维度：前 8 个大半和种子同域', () => {
    const r = fresh(['long hair', 'blue eyes']).slice(0, 8)
    expect(r.filter((x) => ['头发', '五官表情'].includes(T.get(x.name)?.domain ?? '')).length).toBeGreaterThanOrEqual(5)
  })
  it('少见：作品数 1000 – 20 万，比常见搭配冷门', () => {
    const c = ['school uniform', 'pleated skirt']
    const r = fresh(c)
    expect(r.every((x) => { const n = T.get(x.name)?.count ?? 0; return n >= 1000 && n <= 200_000 })).toBe(true)
    const median = (xs: number[]) => xs.sort((a, b) => a - b)[Math.floor(xs.length / 2)]
    const count = (n: string) => T.get(n)?.count ?? 0
    expect(median(r.slice(0, 8).map((x) => count(x.name)))).toBeLessThan(median(common(c).slice(0, 8).map(count)))
  })
  it('单选槽：有 jeans 不推裙子 / 裤子，有 white shirt 不推别的上衣，推出来的同组只留 1 个', () => {
    const r = fresh(['white shirt', 'black jacket', 'jeans'])
    const groups = r.map((x) => slotOf(x.name))
    for (const g of ['上衣', '连衣裙', '制服', '裙', '裤', '外套']) expect(groups).not.toContain(g)
    expect(r.map((x) => x.name)).not.toContain('no pants')
    const hair = fresh(['long hair', 'blue eyes'])
    expect(hair.filter((x) => slotOf(x.name) === '发色').length).toBeLessThanOrEqual(1)
    expect(hair.filter((x) => ['发长', '眼睛颜色'].includes(slotOf(x.name)))).toEqual([])
  })
  it('同一个槽最多 2 个；不出角色、作品、人数、质量', () => {
    for (const c of [['frieren'], ['smile', 'open mouth'], ['outdoors', 'cherry blossoms', 'day']]) {
      const r = fresh(c)
      const per = new Map<string, number>()
      for (const x of r) per.set(slotOf(x.name), (per.get(slotOf(x.name)) ?? 0) + 1)
      expect(Math.max(...[...per].filter(([g]) => g).map(([, n]) => n))).toBeLessThanOrEqual(2)
      expect(r.filter((x) => ['character', 'copyright'].includes(T.get(x.name)?.category ?? '') || ['人数', '质量美学', '年份分级'].includes(slotOf(x.name)))).toEqual([])
    }
    expect(fresh(['masterpiece', 'best quality'])).toEqual([])
  })
  it('按单个 tag：区块里的其他 tag 照样排除冲突（有 day 不推 night 一类）', () => {
    const r = fresh(['cherry blossoms'], ['outdoors', 'day']).map((x) => x.name)
    expect(r.length).toBeGreaterThanOrEqual(4)
    for (const n of ['night', 'indoors', 'sunset', 'night sky', 'starry sky']) expect(r).not.toContain(n)
  })
  it('悬停依据是带出它的 tag（种子或常见搭配）', () => {
    const c = ['long hair', 'blue eyes']
    const allowed = new Set([...c, ...common(c)])
    expect(fresh(c).every((x) => allowed.has(x.because))).toBe(true)
  })
})

describe('siblingsOf（替换候选里排最前的同档 tag）', () => {
  const T = (name: string, count = 1, group = '质量'): TagEntry => ({ name, zh: name, category: 'meta', count, group })
  const tags = [T('lowres', 900), T('very aesthetic'), T('aesthetic'), T('top aesthetic'), T('displeasing'), T('masterpiece'), T('blue eyes', 50, '眼睛'), T('red eyes', 80, '眼睛'), T('blue sky', 99, '背景')]
  it('有档位的按档位顺序，不含自己', () => {
    expect(siblingsOf('very aesthetic', tags).map((t) => t.name)).toEqual(['top aesthetic', 'aesthetic', 'displeasing'])
  })
  it('互斥家族按热度', () => {
    expect(siblingsOf('blue eyes', tags).map((t) => t.name)).toEqual(['red eyes'])
  })
  it('没有家族的返回空', () => {
    expect(siblingsOf('blue sky', tags)).toEqual([])
  })
})
