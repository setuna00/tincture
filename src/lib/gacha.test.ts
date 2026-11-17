import { describe, expect, it } from 'vitest'
import {
  addPicked,
  addSources,
  applyWeights,
  childKey,
  clampPop,
  cloneCollection,
  contentOf,
  countLabel,
  countTags,
  diffTags,
  drawPool,
  drawText,
  fitDraws,
  fromFile,
  GACHA_SCHEMA,
  isFixed,
  newPool,
  normalizeCount,
  odds,
  parseChildKey,
  pickGender,
  removePicked,
  removeSource,
  rerollDraws,
  rollCount,
  sample,
  stripLive,
  toFile,
  weightsOf,
  withPopularity,
  type Draw,
  type DrawCtx,
  type GachaCollection,
  type PoolSource,
} from './gacha'

function seeded(seed = 1) {
  let a = seed
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const COUNTS: Record<string, number> = { day: 1000000, night: 300000, sunset: 40000, rain: 20000, snow: 10000, fog: 100 }
const ctx = (seed = 1, allowed: (t: string) => boolean = () => true): DrawCtx => ({ countOf: (t) => COUNTS[t] ?? 0, allowed, rng: seeded(seed) })
const pool = (patch = {}) => newPool('tag', 'prompt', { name: '天气时间', picked: Object.keys(COUNTS), count: [1, 1], ...patch })

describe('抽几个', () => {
  it('[最少, 最多] 里均匀取，最多不超过能抽的', () => {
    const rng = seeded(3)
    const seen = new Set(Array.from({ length: 200 }, () => rollCount([0, 2], 10, rng)))
    expect([...seen].sort()).toEqual([0, 1, 2])
    expect(rollCount([3, 5], 2, rng)).toBe(2)
    expect(rollCount([4, 4], 10, rng)).toBe(4)
  })
  it('写法：1 / 0–1 / 全部', () => {
    const p = pool()
    expect(countLabel(p, [1, 1])).toBe('1')
    expect(countLabel(p, [0, 1])).toBe('0–1')
    expect(countLabel(p, [6, 6])).toBe('全部')
    expect(isFixed({ ...p, count: [6, 6] })).toBe(true)
    expect(isFixed(p)).toBe(false)
  })
  it('导入时整理：数字、反过来的范围、负数、不写', () => {
    expect(normalizeCount(2, 5)).toEqual([2, 2])
    expect(normalizeCount([3, 1], 5)).toEqual([1, 3])
    expect(normalizeCount([-2, 1.6], 5)).toEqual([0, 2])
    expect(normalizeCount(undefined, 5)).toEqual([1, 1])
    expect(normalizeCount(undefined, 0)).toEqual([1, 1])
  })
})

describe('不放回抽', () => {
  it('抽出来的不重复，都在池子里', () => {
    const out = sample(Object.keys(COUNTS), 6, 0, ctx(7))
    expect(new Set(out).size).toBe(6)
    expect(out.every((t) => t in COUNTS)).toBe(true)
  })
  it('跟人气（1）：作品数多的常出（day 占一半以上）', () => {
    const c = ctx(11)
    let day = 0
    for (let i = 0; i < 400; i++) if (sample(Object.keys(COUNTS), 1, 1, c)[0] === 'day') day++
    expect(day).toBeGreaterThan(250)
  })
  it('纯随机（0）：每个差不多一样（fog 也抽得到）', () => {
    const c = ctx(5)
    let fog = 0
    for (let i = 0; i < 600; i++) if (sample(Object.keys(COUNTS), 1, 0, c)[0] === 'fog') fog++
    expect(fog).toBeGreaterThan(60)
    expect(fog).toBeLessThan(150)
  })
  it('概率：从高到低，加起来是 1；以后别抽的、不让抽的不算', () => {
    const o = odds(pool(), 1, ['night'], { countOf: (t) => COUNTS[t] ?? 0, allowed: (t) => t !== 'rain' })
    expect(o[0].tag).toBe('day')
    expect(o.map((x) => x.tag)).not.toContain('night')
    expect(o.map((x) => x.tag)).not.toContain('rain')
    expect(o.reduce((a, x) => a + x.p, 0)).toBeCloseTo(1)
  })
})

describe('抽法 = 作品数^k', () => {
  const tags = Object.keys(COUNTS)
  const share = (k: number, n = 6000, seed = 47) => {
    const c = ctx(seed)
    const hit: Record<string, number> = {}
    for (let i = 0; i < n; i++) {
      const [t] = sample(tags, 1, k, c)
      hit[t] = (hit[t] ?? 0) + 1
    }
    return Object.fromEntries(tags.map((t) => [t, (hit[t] ?? 0) / n]))
  }
  const expected = (k: number) => {
    const w = tags.map((t) => Math.pow(COUNTS[t], k))
    const sum = w.reduce((a, b) => a + b, 0)
    return Object.fromEntries(tags.map((t, i) => [t, w[i] / sum]))
  }
  it('k = 0 每个一样，k = 1 跟作品数成正比，k = −1 跟 1 / 作品数成正比，0.5 在中间：抽 6000 次和算出来的差不到 2%', () => {
    for (const k of [0, 1, -1, 0.5, -0.5]) {
      const got = share(k)
      const want = expected(k)
      for (const t of tags) expect(Math.abs(got[t] - want[t]), `k=${k} ${t}`).toBeLessThan(0.02)
    }
    expect(share(0).fog).toBeGreaterThan(0.14)
    expect(share(1).day).toBeGreaterThan(0.7)
    expect(share(-1).fog).toBeGreaterThan(0.95)
    expect(share(0.5).day).toBeGreaterThan(share(0).day)
    expect(share(0.5).day).toBeLessThan(share(1).day)
  })
  it('权重：作品数^k；0 时都是 1', () => {
    const c = { countOf: (t: string) => ({ a: 100, b: 400 })[t] ?? 0 }
    expect(weightsOf(['a', 'b'], 0, c)).toEqual([1, 1])
    expect(weightsOf(['a', 'b'], 1, c)).toEqual([100, 400])
    expect(weightsOf(['a', 'b'], -1, c)).toEqual([0.01, 0.0025])
    expect(weightsOf(['a', 'b'], 0.5, c)).toEqual([10, 20])
  })
  it('查不到作品数的按这批里最小的已知作品数算（k 取负时不会每次都抽到它，k = 1 时也不是几乎抽不到）；整批都查不到就都一样', () => {
    const c = { countOf: (t: string) => COUNTS[t] ?? 0 }
    expect(weightsOf(['mystery', 'fog', 'day'], -1, c)).toEqual([0.01, 0.01, 1e-6])
    expect(weightsOf(['mystery', 'fog', 'day'], 1, c)).toEqual([100, 100, 1e6])
    expect(weightsOf(['x', 'y'], -1, c)).toEqual([1, 1])
  })
  it('夹到 −1…1、保留两位', () => {
    expect(clampPop(1.7)).toBe(1)
    expect(clampPop(-3)).toBe(-1)
    expect(clampPop(0.333)).toBe(0.33)
    expect(clampPop(-0.25)).toBe(-0.25)
  })
  it('存档 v3 → v4：pick 换成 popularity（纯随机 0、跟人气 1），挂着的池子一样；已经有的不动', () => {
    const v3 = <T extends { popularity?: number }>(p: T, pick: string) => {
      const { popularity: _, ...rest } = p
      return { ...rest, pick } as never
    }
    const old = v3(newPool('char', 'prompt', { children: [v3(pool(), 'popular')] }), 'flat')
    const p = withPopularity(old)
    expect(p.popularity).toBe(0)
    expect('pick' in p).toBe(false)
    expect(p.children![0].popularity).toBe(1)
    expect('pick' in p.children![0]).toBe(false)
    expect(withPopularity(pool({ popularity: 0.25 })).popularity).toBe(0.25)
  })
  it('JSON：旧文件的 pick 照读；popularity 越界夹回来、不是数按 0，都记一处改动', () => {
    const r = fromFile(
      {
        name: 'x',
        pools: [
          { name: '旧', tags: ['day'], pick: 'popular' },
          { name: '新', tags: ['day'], popularity: -0.5 },
          { name: '越界', tags: ['day'], popularity: 2 },
          { name: '不是数', tags: ['day'], popularity: 'hot' },
        ],
      },
      () => true,
    )
    if ('error' in r) throw new Error(r.error)
    expect(r.collection.pools.map((p) => p.popularity)).toEqual([1, -0.5, 1, 0])
    expect(r.issues).toHaveLength(2)
    expect(r.issues.join('\n')).toMatch(/越界.*调整为 1/)
    expect(r.issues.join('\n')).toMatch(/hot/)
    const props = GACHA_SCHEMA.properties.pools.items.properties
    expect(props.popularity).toMatchObject({ type: 'number', minimum: -1, maximum: 1, default: 0 })
    expect('pick' in props).toBe(false)
  })
})

describe('抽一个池子', () => {
  it('锁住的留在原位、算在抽数里；以后别抽的不出', () => {
    const p = pool({ count: [3, 3] })
    const prev: Draw[] = [{ tag: 'rain' }, { tag: 'fog', locked: true }, { tag: 'snow' }]
    for (let s = 1; s < 30; s++) {
      const out = drawPool(p, prev, { count: [3, 3], popularity: 0, exclude: ['day'], ctx: ctx(s) })
      expect(out).toHaveLength(3)
      expect(out[1]).toEqual({ tag: 'fog', locked: true })
      expect(out.map((d) => d.tag)).not.toContain('day')
      expect(new Set(out.map((d) => d.tag)).size).toBe(3)
    }
  })
  it('锁住的比抽数多：都留着', () => {
    const p = pool({ count: [1, 1] })
    const prev: Draw[] = [{ tag: 'rain', locked: true }, { tag: 'fog', locked: true }]
    expect(drawPool(p, prev, { count: [1, 1], popularity: 0, exclude: [], ctx: ctx() }).map((d) => d.tag)).toEqual(['rain', 'fog'])
  })
  it('全部抽出（固定区块）：池子里的都在，顺序和池子一样', () => {
    const p = pool({ count: [6, 6] })
    expect(drawPool(p, [], { count: [6, 6], popularity: 0, exclude: [], ctx: ctx() }).map((d) => d.tag)).toEqual(Object.keys(COUNTS))
  })
  it('新抽到的按池子里的先后排', () => {
    const p = pool({ count: [3, 3] })
    for (let s = 1; s < 10; s++) {
      const out = drawPool(p, [], { count: [3, 3], popularity: 0, exclude: [], ctx: ctx(s) }).map((d) => p.tags.indexOf(d.tag))
      expect(out).toEqual([...out].sort((a, b) => a - b))
    }
  })
  it('NSFW 设置以上的不抽', () => {
    const p = pool({ count: [5, 5] })
    const out = drawPool(p, [], { count: [5, 5], popularity: 0, exclude: [], ctx: ctx(2, (t) => t !== 'fog') })
    expect(out.map((d) => d.tag)).not.toContain('fog')
  })
  it('只重抽几个：换成池子里新的、不和这块已有的重复；锁住的不动', () => {
    const p = pool({ count: [3, 3] })
    const prev: Draw[] = [{ tag: 'rain' }, { tag: 'fog', locked: true }, { tag: 'snow' }]
    const out = rerollDraws(p, prev, ['rain', 'fog'], { popularity: 0, exclude: [], ctx: ctx(4) })
    expect(out[0].tag).not.toBe('rain')
    expect(out[1]).toEqual({ tag: 'fog', locked: true })
    expect(out[2].tag).toBe('snow')
    expect(new Set(out.map((d) => d.tag)).size).toBe(3)
  })
})

describe('改了抽几个', () => {
  it('比最少少：补新的（不重复）；比最多多：从后面拿掉没锁的；在范围里不动', () => {
    const p = pool()
    const o = (count: [number, number]) => ({ count, popularity: 0, exclude: [], ctx: ctx(3) })
    const filled = fitDraws(p, [{ tag: 'rain' }], o([3, 3]))
    expect(filled).toHaveLength(3)
    expect(filled[0].tag).toBe('rain')
    expect(new Set(filled.map((d) => d.tag)).size).toBe(3)
    expect(fitDraws(p, [{ tag: 'rain' }, { tag: 'fog', locked: true }, { tag: 'snow' }], o([0, 1])).map((d) => d.tag)).toEqual(['fog'])
    expect(fitDraws(p, [{ tag: 'rain' }, { tag: 'snow' }], o([1, 3])).map((d) => d.tag)).toEqual(['rain', 'snow'])
  })
})

describe('画师池', () => {
  const art = newPool('artist', 'prompt', { source: [], sourceTags: [], picked: ['mika pikazo', 'ciloranko', 'huke'], weight: 'main' })
  it('主次按位置：第 1 位 1.15，其余 0.9；写成 1.15::artist:x::', () => {
    const out = applyWeights(art, [{ tag: 'ciloranko' }, { tag: 'huke' }], seeded())
    expect(out.map((d) => d.w)).toEqual([1.15, 0.9])
    expect(drawText(art, out[0])).toBe('1.15::artist:ciloranko::')
  })
  it('随机：每位 0.6–1.3，按 0.05 取整；锁住的权重留着', () => {
    const p = { ...art, weight: 'rand' as const }
    const out = applyWeights(p, [{ tag: 'a', w: 1.2, locked: true }, { tag: 'b' }, { tag: 'c' }], seeded(9))
    expect(out[0].w).toBe(1.2)
    for (const d of out.slice(1)) {
      expect(d.w!).toBeGreaterThanOrEqual(0.6)
      expect(d.w!).toBeLessThanOrEqual(1.3)
      expect(Math.round(d.w! * 20)).toBeCloseTo(d.w! * 20)
    }
  })
  it('都不加：artist:x；普通池原样', () => {
    const p = { ...art, weight: 'none' as const }
    expect(drawText(p, applyWeights(p, [{ tag: 'huke', w: 0.9 }], seeded())[0])).toBe('artist:huke')
    expect(drawText(pool(), { tag: 'rain' })).toBe('rain')
  })
})

describe('导入导出', () => {
  const c: GachaCollection = {
    id: 'c',
    name: '雨夜屋顶',
    createdAt: 0,
    pools: [
      pool({ id: 'p1', count: [0, 1], popularity: 0.5, source: [{ kind: 'list', list: 'b', path: '场景/天气时间', minCount: 1000 }], sourceTags: [Object.keys(COUNTS)], picked: [] }),
      newPool('artist', 'prompt', { id: 'p2', source: [], sourceTags: [], picked: ['huke'], weight: 'rand' }),
    ],
  }
  it('导出定义再导回来：内容、抽几个、抽法、以后别抽都在，id 换新的', () => {
    const file = toFile(c, (id) => (id === 'p1' ? ['fog'] : []))
    expect(file.$schema).toBe('pe-gacha/1')
    const r = fromFile(JSON.parse(JSON.stringify(file)), () => true)
    if ('error' in r) throw new Error(r.error)
    expect(r.issues).toEqual([])
    expect(r.collection.name).toBe('雨夜屋顶')
    const [a, b] = r.collection.pools
    expect(a.id).not.toBe('p1')
    expect(a.count).toEqual([0, 1])
    expect(a.popularity).toBe(0.5)
    expect(a.source).toEqual(c.pools[0].source)
    expect(a.sourceTags).toEqual([Object.keys(COUNTS)])
    expect(a.tags).toEqual(Object.keys(COUNTS))
    expect(r.excludes[a.id]).toEqual(['fog'])
    expect(b.kind).toBe('artist')
    expect(b.weight).toBe('rand')
  })
  it('AI 写的不规范：不认识的抽法按纯随机、不在 tag 库的照样放、多的字段丢掉、artist: 前缀去掉', () => {
    const r = fromFile(
      {
        name: '雨夜',
        mood: 'sad',
        pools: [
          { name: '光', tags: ['rim light', 'neon alley'], pick: 'cold', count: 1 },
          { name: '画师', kind: 'artist', tags: ['artist:huke'], target: 'uc' },
        ],
      },
      (t) => t !== 'neon alley',
    )
    if ('error' in r) throw new Error(r.error)
    expect(r.collection.pools[0].popularity).toBe(0)
    expect(r.collection.pools[0].tags).toEqual(['rim light', 'neon alley'])
    expect(r.collection.pools[1].tags).toEqual(['huke'])
    expect(r.collection.pools[1].target).toBe('prompt')
    expect(r.issues.join('\n')).toMatch(/cold/)
    expect(r.issues.join('\n')).toMatch(/neon alley/)
    expect(r.issues.join('\n')).toMatch(/mood/)
  })
  it('整个不像合集：给原因', () => {
    expect(fromFile('x', () => true)).toEqual({ error: '不是 JSON 对象' })
    expect(fromFile({ name: 'a', pools: [] }, () => true)).toEqual({ error: '缺少 pools（池子列表）' })
  })
  it('快照和来源比：多了哪些、少了哪些', () => {
    expect(diffTags(['a', 'b', 'c'], ['b', 'c', 'd', 'e'])).toEqual({ added: ['d', 'e'], removed: ['a'] })
  })
})

describe('池子的内容：来源各一份快照 + 单独挑的', () => {
  const same = (a: PoolSource, b: PoolSource) => JSON.stringify(a) === JSON.stringify(b)
  const place: PoolSource = { kind: 'list', list: 'b', path: '场景/地点' }
  const time: PoolSource = { kind: 'list', list: 'b', path: '场景/天气时间' }
  it('tags = 来源合起来 ∪ 单独挑的，同一个只算一个', () => {
    expect(contentOf({ sourceTags: [['a', 'b'], ['b', 'c']], picked: ['c', 'd'] })).toEqual(['a', 'b', 'c', 'd'])
  })
  it('加来源（重复的不加）、拿掉来源（单独挑的不受影响）', () => {
    let p = newPool('tag', 'prompt', { picked: ['x'] })
    p = addSources(p, [{ source: place, tags: ['a', 'b'] }, { source: time, tags: ['b', 'c'] }], same)
    p = addSources(p, [{ source: place, tags: ['zzz'] }], same)
    expect(p.source).toEqual([place, time])
    expect(p.tags).toEqual(['a', 'b', 'c', 'x'])
    p = removeSource(p, 0)
    expect(p.source).toEqual([time])
    expect(p.tags).toEqual(['b', 'c', 'x'])
  })
  it('单独挑：已在来源里的不重复放（交给调用方点亮），挑过的跳过', () => {
    const p = addSources(newPool('tag', 'prompt'), [{ source: time, tags: ['night', 'rain'] }], same)
    const r = addPicked(p, ['night', 'cherry blossoms', 'cherry blossoms'])
    expect(r.inSource).toEqual(['night'])
    expect(r.added).toEqual(['cherry blossoms'])
    expect(r.dup).toEqual(['cherry blossoms'])
    expect(r.pool.picked).toEqual(['cherry blossoms'])
    expect(removePicked(r.pool, 'cherry blossoms').tags).toEqual(['night', 'rain'])
  })
})

describe('角色池', () => {
  it('人数 tag：女 → 男 → 其他，6 个以上写 6+', () => {
    expect(countTags(['female', 'female'])).toEqual(['2girls'])
    expect(countTags(['female', 'male'])).toEqual(['1girl', '1boy'])
    expect(countTags(['other', 'male', 'other'])).toEqual(['1boy', '2others'])
    expect(countTags(Array(7).fill('female'))).toEqual(['6+girls'])
    expect(countTags([])).toEqual([])
  })
  it('性别：原作用角色本来的，猜不出算其他；勾几个就在里面随机', () => {
    expect(pickGender(['canon'], 'male', seeded())).toEqual({ gender: 'male' })
    expect(pickGender(['canon'], null, seeded())).toEqual({ gender: 'other' })
    expect(pickGender([], 'female', seeded())).toEqual({ gender: 'female' })
    const seen = new Set(Array.from({ length: 40 }, (_, i) => pickGender(['female', 'male'], 'other', seeded(i + 1)).gender))
    expect(seen).toEqual(new Set(['female', 'male']))
  })
  it('挂着的池子按角色各一份结果：key 拆得回来（角色 tag 里有空格、括号也行）', () => {
    const k = childKey('gp_1', 'fern (sousou no frieren)', 'gp_2')
    expect(parseChildKey(k)).toEqual({ charPoolId: 'gp_1', charTag: 'fern (sousou no frieren)', childId: 'gp_2' })
    expect(parseChildKey('gp_1')).toBeNull()
  })
  it('新的角色池：只在正面、默认原作；复制合集时挂着的池子也换新 id', () => {
    const p = newPool('char', 'uc', { children: [newPool('tag', 'prompt', { id: 'kid', name: '衣服' })] })
    expect(p.target).toBe('prompt')
    expect(p.genders).toEqual(['canon'])
    const copy = cloneCollection({ id: 'c', name: 'x', createdAt: 0, pools: [p] })
    expect(copy.pools[0].children![0].id).not.toBe('kid')
    expect(copy.pools[0].children![0].name).toBe('衣服')
  })
  it('导出再导回来：作品来源、性别、挂着的池子都在', () => {
    const char = newPool('char', 'prompt', {
      source: [{ kind: 'work', work: 'sousou no frieren', minCount: 1000 }],
      sourceTags: [['frieren', 'fern (sousou no frieren)']],
      picked: ['makima (chainsaw man)'],
      genders: ['canon', 'female'],
      count: [1, 2],
      children: [newPool('tag', 'prompt', { name: '衣服', picked: ['kimono', 'maid'] })],
    })
    const c: GachaCollection = { id: 'c', name: '师徒', createdAt: 0, pools: [char] }
    const r = fromFile(JSON.parse(JSON.stringify(toFile(c, () => []))), () => true)
    if ('error' in r) throw new Error(r.error)
    expect(r.issues).toEqual([])
    const [a] = r.collection.pools
    expect(a.kind).toBe('char')
    expect(a.tags).toEqual(['frieren', 'fern (sousou no frieren)', 'makima (chainsaw man)'])
    expect(a.genders).toEqual(['canon', 'female'])
    expect(a.children!.map((k) => [k.name, k.tags])).toEqual([['衣服', ['kimono', 'maid']]])
  })
  it('文件里 tags 是全部、source 只是记录：都当单独挑的', () => {
    const r = fromFile({ name: 'old', pools: [{ name: '地点', tags: ['rooftop', 'alley'], source: [{ kind: 'list', list: 'b', path: '场景/地点' }] }] }, () => true)
    if ('error' in r) throw new Error(r.error)
    expect(r.collection.pools[0].picked).toEqual(['rooftop', 'alley'])
    expect(r.collection.pools[0].tags).toEqual(['rooftop', 'alley'])
    expect(r.issues).toEqual([])
  })
})

describe('画师池的来源：画师库 · 只收作品数 / 画师库合集（只存规则，名单现拿）', () => {
  const names = ['dairi', 'huke', 'kantoku']
  const art = () =>
    newPool('artist', 'prompt', {
      id: 'a',
      source: [{ kind: 'artists', minCount: 1000 }, { kind: 'artistColl', coll: 'fav' }],
      sourceTags: [names, ['ciloranko']],
      picked: ['wlop'],
    })
  it('新画师池默认是画师库代表作人气前 1000', () => {
    expect(newPool('artist', 'prompt').source).toEqual([{ kind: 'artists', by: 'rep', top: 1000 }])
  })
  it('存档：画师库 / 合集来源的名单不存，tags 只剩单独挑的；普通池不动', () => {
    const s = stripLive(art())
    expect(s.sourceTags).toEqual([[], []])
    expect(s.tags).toEqual(['wlop'])
    const t = pool({ source: [{ kind: 'list', list: 'b', path: 'x' }], sourceTags: [['rain']], picked: [] })
    expect(stripLive(t)).toBe(t)
  })
  it('导出：画师库来源只写规则，合集来源带名字；导回来画师库来源等名单现拿，不报「没有内容」', () => {
    const c: GachaCollection = { id: 'c', name: '画师', createdAt: 0, pools: [art()] }
    const file = toFile(c, () => [])
    expect(file.pools[0].sources).toEqual([{ source: { kind: 'artists', minCount: 1000 } }, { source: { kind: 'artistColl', coll: 'fav' }, tags: ['ciloranko'] }])
    const json = JSON.parse(JSON.stringify(file))
    const here = fromFile(json, () => true, (id) => id === 'fav')
    if ('error' in here) throw new Error(here.error)
    expect(here.issues).toEqual([])
    expect(here.collection.pools[0].source).toEqual(c.pools[0].source)
    expect(here.collection.pools[0].sourceTags).toEqual([[], []])
    expect(here.collection.pools[0].tags).toEqual(['wlop'])
    const there = fromFile(json, () => true)
    if ('error' in there) throw new Error(there.error)
    expect(there.collection.pools[0].source).toEqual([{ kind: 'artists', minCount: 1000 }])
    expect(there.collection.pools[0].picked).toEqual(['wlop', 'ciloranko'])
    expect(there.issues.join(' / ')).toMatch(/合集在本机不存在.*1 位/)
  })
  it('AI 写的档位不在 全部 / 100 / 500 / 1000 里：往下取一档；没写 = 默认；画师库来源放在普通池里丢掉', () => {
    const r = fromFile(
      {
        name: 'x',
        pools: [
          { name: '画师', kind: 'artist', tags: [], sources: [{ source: { kind: 'artists', minCount: 300 } }] },
          { name: '画师 2', kind: 'artist', tags: [], sources: [{ source: { kind: 'artists' } }] },
          { name: '光', tags: ['rim light'], sources: [{ source: { kind: 'artists', minCount: 0 } }] },
        ],
      },
      () => true,
    )
    if ('error' in r) throw new Error(r.error)
    expect(r.collection.pools[0].source).toEqual([{ kind: 'artists', minCount: 100 }])
    expect(r.collection.pools[1].source).toEqual([{ kind: 'artists' }])
    expect(r.collection.pools[2].source).toEqual([])
    expect(r.issues.join(' / ')).toMatch(/「光」不是画师池/)
  })
})
