import { describe, expect, it } from 'vitest'
import { buildCatalog, findNode, nodeAtoms, parseList, type TreeFile } from './discover'
import { characterDisplay, templateFromCharacter, type WorkContext } from './char-template'
import { decodeChars, type CharsFile } from './char-works'
import { charsAtLeast, isLiveSource, pushCount, resultLineOf, stripLive, newPool, type Draw, type PoolSource } from './gacha'
import { gachaTemplates } from './gacha-templates'
import { exportDoc, parsePrompt, toChip } from './nai'
import { charWorksOf, charWorksScope, cleanRandomRule, defaultRule, hasScope, newRandomSection, poolOfRule, runRandom, scopeOfPool, scopeSize, slotsOf, toggleLocked, type RandomCtx } from './random-block'
import { BY_NAME } from './tag-fixture'
import { decodeLookup, type LookupFile } from './tag-data'
import { createDocStore, defaultSettings, normalizeDoc } from '@/store/doc'
import type { Chip, Doc, RandomRule, Section } from '@/types'

const { readFileSync } = (await import(/* @vite-ignore */ `node:${'fs'}`)) as { readFileSync(p: URL, enc?: string): Uint8Array & string }
const { gunzipSync } = (await import(/* @vite-ignore */ `node:${'zlib'}`)) as { gunzipSync(b: Uint8Array): Uint8Array }
const gz = <T>(file: string) => JSON.parse(new TextDecoder().decode(gunzipSync(readFileSync(new URL(`../assets/tags/${file}.json.gz`, import.meta.url))))) as T

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
const WEATHER = Object.keys(COUNTS)
const LIST: PoolSource = { kind: 'list', list: 'b', path: '场景/天气时间', minCount: 1000 }
const ARTISTS = ['dairi', 'huke', 'kantoku', 'wlop', 'ciloranko']
const CHARS: Record<string, { work: string; gender: 'female' | 'male' }> = {
  frieren: { work: 'sousou no frieren', gender: 'female' },
  'fern (sousou no frieren)': { work: 'sousou no frieren', gender: 'female' },
  'stark (sousou no frieren)': { work: 'sousou no frieren', gender: 'male' },
}
const ctx = (seed = 1, ready = true): RandomCtx => ({
  countOf: (t) => COUNTS[t] ?? 100,
  allowed: () => true,
  rng: seeded(seed),
  live: (s) => (!ready ? undefined : s.kind === 'artists' ? ARTISTS : s.kind === 'chars' ? Object.keys(CHARS) : null),
  workOf: (t) => CHARS[t]?.work ?? null,
  canonGender: (t) => CHARS[t]?.gender ?? null,
  isChar: (t) => t in CHARS,
})
const tagRule = (patch: Partial<RandomRule> = {}): RandomRule => ({ ...defaultRule('tag'), source: [LIST], sourceTags: [WEATHER], ...patch })
const texts = (chips: readonly Chip[]) => chips.map((c) => c.text)

describe('随机区块：规则 → 池子', () => {
  it('三种默认：角色随机 = 角色库全部抽 1（按人气），画师随机 = 画师库代表作人气前 1000 抽 3（主次），随机区块 = 没有范围', () => {
    expect(defaultRule('char')).toMatchObject({ source: [{ kind: 'chars', minCount: 0 }], count: [1, 1], popularity: 1, genders: ['canon'] })
    expect(defaultRule('artist')).toMatchObject({ source: [{ kind: 'artists', by: 'rep', top: 1000 }], count: [3, 3], weight: 'main' })
    expect(hasScope(defaultRule('tag'))).toBe(false)
    expect(newRandomSection('artist')).toMatchObject({ name: '画师', color: 'rose', chips: [], random: { kind: 'artist' } })
  })
  it('活的来源现拿，快照用存着的；活的来源还没到 = null（先不抽）', () => {
    const r: RandomRule = { ...defaultRule('artist'), source: [{ kind: 'artists', minCount: 1000 }], sourceTags: [[]], picked: ['mika pikazo'] }
    expect(poolOfRule(r, ctx().live)!.tags).toEqual([...ARTISTS, 'mika pikazo'])
    expect(poolOfRule(r, ctx(1, false).live)).toBeNull()
    expect(poolOfRule(tagRule(), ctx().live)!.tags).toEqual(WEATHER)
    expect(scopeSize(tagRule({ off: ['fog', 'snow'] }), ctx().live)).toBe(4)
  })
  it('面板改了范围写回：活的来源不存快照', () => {
    const p = poolOfRule({ ...defaultRule('char'), picked: ['frieren'] }, ctx().live)!
    expect(scopeOfPool(p)).toEqual({ source: [{ kind: 'chars', minCount: 0 }], sourceTags: [[]], picked: ['frieren'] })
  })
})

describe('随机区块：抽 / 重抽 / 锁 / 对上新范围', () => {
  it('抽：固定种子结果固定、在范围里、不重复；chips 是普通 tag', () => {
    const rule = tagRule({ count: [2, 2] })
    const a = runRandom(rule, [], { kind: 'roll' }, ctx(7))!
    const b = runRandom(rule, [], { kind: 'roll' }, ctx(7))!
    expect(texts(a.chips)).toEqual(texts(b.chips))
    expect(a.chips).toHaveLength(2)
    expect(new Set(texts(a.chips)).size).toBe(2)
    for (const t of texts(a.chips)) expect(WEATHER).toContain(t)
    expect(a.chips.every((c) => c.type === 'tag' && c.weight === 1)).toBe(true)
  })
  it('重抽：锁住的留在原位（chip 原样：id、权重、禁用都在），其余换掉', () => {
    const chips = [toChip({ text: 'day', type: 'tag', weight: 1.2 }), toChip({ text: 'night', type: 'tag', weight: 1 })]
    chips[0].disabled = true
    const rule = tagRule({ count: [2, 2], locked: ['day'] })
    for (let seed = 1; seed <= 20; seed++) {
      const r = runRandom(rule, chips, { kind: 'roll' }, ctx(seed))!
      expect(r.chips[0]).toBe(chips[0])
      expect(r.chips).toHaveLength(2)
      expect(r.chips[1].text).not.toBe('day')
    }
  })
  it('整块锁住：重抽、改范围、改抽几个都不动结果', () => {
    const chips = parsePrompt('day, night').map(toChip)
    const rule = tagRule({ count: [2, 2], lockAll: true, off: ['day'] })
    for (const op of [{ kind: 'roll' }, { kind: 'range' }, { kind: 'fit' }] as const) expect(runRandom({ ...rule, count: [1, 1] }, chips, op, ctx())!.chips).toEqual(chips)
  })
  it('只换选中的几个：各自换一个、不和这块已有的重复，没选的原样留着', () => {
    const chips = parsePrompt('day, night, rain').map(toChip)
    const r = runRandom(tagRule({ count: [3, 3] }), chips, { kind: 'reroll', tags: ['night'] }, ctx(3))!
    expect(r.chips[0]).toBe(chips[0])
    expect(r.chips[2]).toBe(chips[2])
    expect(['day', 'night', 'rain']).not.toContain(r.chips[1].text)
  })
  it('改抽几个：少了补、多了从后面拿掉没锁的，在范围里的不动', () => {
    const chips = parsePrompt('day, night, rain').map(toChip)
    const less = runRandom(tagRule({ count: [1, 1], locked: ['rain'] }), chips, { kind: 'fit' }, ctx())!
    expect(texts(less.chips)).toEqual(['rain'])
    const more = runRandom(tagRule({ count: [4, 4] }), chips, { kind: 'fit' }, ctx())!
    expect(more.chips.slice(0, 3)).toEqual(chips)
    expect(more.chips).toHaveLength(4)
  })
  it('改范围：点暗了 / 拿掉了来源的换掉，范围里没别的了就拿掉；原来是空的整块抽（刚加了范围）', () => {
    const chips = parsePrompt('day, night').map(toChip)
    const r = runRandom(tagRule({ count: [2, 2], off: ['night'] }), chips, { kind: 'range' }, ctx(2))!
    expect(r.chips[0]).toBe(chips[0])
    expect(['day', 'night']).not.toContain(r.chips[1].text)
    const gone = runRandom(tagRule({ count: [2, 2], source: [], sourceTags: [], picked: ['day'] }), chips, { kind: 'range' }, ctx())!
    expect(texts(gone.chips)).toEqual(['day'])
    const fresh = runRandom(tagRule(), [], { kind: 'range' }, ctx())!
    expect(fresh.chips).toHaveLength(1)
  })
  it('锁 / 解锁：有没锁的全锁上，全锁着全解开；结果里没了的锁去掉', () => {
    expect(toggleLocked(tagRule({ locked: ['day'] }), ['day', 'night'])).toEqual(['day', 'night'])
    expect(toggleLocked(tagRule({ locked: ['day', 'night'] }), ['day', 'night'])).toEqual([])
    const r = runRandom(tagRule({ count: [1, 1], locked: ['fog'] }), parsePrompt('day').map(toChip), { kind: 'roll' }, ctx())!
    expect(r.locked).toEqual([])
  })
  it('画师：写成 artist:x，主次权重 1.15 + 0.9；改成不加权不重抽', () => {
    const rule: RandomRule = { ...defaultRule('artist'), sourceTags: [[]] }
    const r = runRandom(rule, [], { kind: 'roll' }, ctx(5))!
    expect(r.chips.map((c) => [c.type, c.weight])).toEqual([
      ['artist', 1.15],
      ['artist', 0.9],
      ['artist', 0.9],
    ])
    const plain = runRandom({ ...rule, weight: 'none' }, r.chips, { kind: 'reweigh' }, ctx())!
    expect(texts(plain.chips)).toEqual(texts(r.chips))
    expect(plain.chips.every((c) => c.weight === 1)).toBe(true)
  })
  it('角色：角色 tag + 作品 tag 一组；原作性别跟着抽到的人；只换角色时作品跟着换，性别重新定', () => {
    const rule: RandomRule = { ...defaultRule('char'), sourceTags: [[]], picked: [] }
    const r = runRandom(rule, [], { kind: 'roll' }, ctx(4))!
    const [tag, work] = texts(r.chips)
    expect(CHARS[tag].work).toBe(work)
    expect(r.gender).toEqual({ gender: CHARS[tag].gender })
    expect(slotsOf(rule, r.chips, (t) => t in CHARS)).toEqual([{ tag, chips: r.chips }])
    const kept = runRandom({ ...rule, locked: [tag] }, r.chips, { kind: 'roll' }, ctx(9))!
    expect(kept.chips).toEqual(r.chips)
    expect(kept.gender).toBeUndefined()
    const g = runRandom({ ...rule, genders: ['female'] }, r.chips, { kind: 'regender' }, ctx())!
    expect(g.chips).toEqual(r.chips)
    expect(g.gender).toEqual({ gender: 'female' })
  })
  it('角色随机选作品：没选 = 角色库全部；选了 = 作品来源（不设下限、存快照），抽到的不在里面就换，在里面不动', () => {
    const tagsOf = (s: { work: string }) => Object.keys(CHARS).filter((t) => CHARS[t].work === s.work)
    expect(charWorksScope([], tagsOf)).toEqual({ source: [{ kind: 'chars', minCount: 0 }], sourceTags: [[]] })
    expect(charWorksOf(defaultRule('char'))).toEqual([])
    const scope = charWorksScope(['sousou no frieren', 'other'], tagsOf)
    expect(scope).toEqual({
      source: [
        { kind: 'work', work: 'sousou no frieren', minCount: 0 },
        { kind: 'work', work: 'other', minCount: 0 },
      ],
      sourceTags: [Object.keys(CHARS), []],
    })
    expect(charWorksOf(scope)).toEqual(['sousou no frieren', 'other'])
    const rule: RandomRule = { ...defaultRule('char'), ...scope }
    const chips = parsePrompt('frieren, sousou no frieren').map(toChip)
    expect(runRandom(rule, chips, { kind: 'range' }, ctx())!.chips).toEqual(chips)
    const elsewhere = parsePrompt('glalie, pokemon').map(toChip)
    const r = runRandom(rule, elsewhere, { kind: 'range' }, { ...ctx(3), isChar: (t) => t in CHARS || t === 'glalie' })!
    expect(r.chips).toHaveLength(2)
    expect(Object.keys(CHARS)).toContain(r.chips[0].text)
    expect(r.gender).toEqual({ gender: CHARS[r.chips[0].text].gender })
  })
  it('chip 直接按 tag 建：括号多的角色名、带 [t] 的不会被当成自然语言或拆开', () => {
    const names = ['abigail williams (emerald float) (fate)', '00 qan[t]']
    const r = runRandom(tagRule({ source: [], sourceTags: [], picked: names, count: [2, 2] }), [], { kind: 'roll' }, ctx())!
    expect(r.chips.map((c) => [c.type, c.text, c.weight])).toEqual(names.map((t) => ['tag', t, 1]))
  })
  it('活的来源还没到：返回 null（等数据到了再抽）', () => {
    expect(runRandom(defaultRule('artist'), [], { kind: 'roll' }, ctx(1, false))).toBeNull()
  })
})

describe('角色库来源', () => {
  const f = gz<CharsFile>('chars')
  const more = { chars: new Map<string, string[]>(), gender: new Map<string, 'female' | 'male' | 'other'>(), all: [] as string[] }
  decodeChars(f, new Map(), more)
  const entry = (t: string) => BY_NAME.get(t)
  it('全部 22,223 · ≥500 6,348 · ≥1000 3,442 · ≥5000 551，按作品数从高到低', () => {
    const all = charsAtLeast(more.all, entry, 0)
    expect(all.length).toBe(22223)
    expect(charsAtLeast(more.all, entry, 500).length).toBe(6348)
    expect(charsAtLeast(more.all, entry, 1000).length).toBe(3442)
    expect(charsAtLeast(more.all, entry, 5000).length).toBe(551)
    expect(entry(all[0])!.count).toBeGreaterThanOrEqual(entry(all[1])!.count)
  })
  it('只存规则：存档 / 文档里角色库来源的快照是空的', () => {
    const s: PoolSource = { kind: 'chars', minCount: 1000 }
    expect(isLiveSource(s)).toBe(true)
    const p = newPool('char', 'prompt', { source: [s], sourceTags: [['frieren', 'fern (sousou no frieren)']] })
    expect(stripLive(p).sourceTags).toEqual([[]])
    expect(cleanRandomRule({ kind: 'char', source: [s], sourceTags: [['frieren']], count: [1, 1], popularity: 1 })!.sourceTags).toEqual([[]])
  })
  it('角色随机只抽 1 个、没有单独选择的和点暗的：旧存档整理掉', () => {
    const r = cleanRandomRule({ kind: 'char', source: [{ kind: 'chars' }], sourceTags: [[]], count: [2, 3], popularity: 1, picked: ['frieren'], off: ['fern (sousou no frieren)'] })!
    expect(r.count).toEqual([1, 1])
    expect(r.picked).toBeUndefined()
    expect(r.off).toBeUndefined()
    expect(cleanRandomRule({ kind: 'tag', source: [], sourceTags: [], count: [2, 3], popularity: 0, picked: ['day'] })).toMatchObject({ count: [2, 3], picked: ['day'] })
  })
})

describe('抽卡页的 4 个模板', () => {
  const ROWS = decodeLookup(gz<LookupFile>('lookup'))
  const catalog = buildCatalog(ROWS, gz<TreeFile>('tree'))
  const tree = parseList(readFileSync(new URL('../../data/tags/tree/b.txt', import.meta.url), 'utf8') as unknown as string)
  const resolve = (s: PoolSource) => {
    if (s.kind === 'chars') return ['frieren']
    if (s.kind === 'artists') return ARTISTS
    if (s.kind !== 'list') return null
    const node = findNode(tree, s.path)
    if (!node) return null
    const seen = new Map<string, number>()
    for (const a of nodeAtoms(node)) for (const t of catalog.byAtom.get(a) ?? []) if (t.count >= (s.minCount ?? 1000) && t.old !== 2 && !seen.has(t.name)) seen.set(t.name, t.count)
    return [...seen.keys()]
  }
  it('四个固定模板；池子个数、默认抽几个 / 抽法', () => {
    const all = gachaTemplates(resolve)
    expect(all.map((t) => t.name)).toEqual(['角色', '画师', '场景', '人物'])
    const sizes = Object.fromEntries(all.flatMap((t) => t.pools.map((p) => [p.name, p.tags.length])))
    for (const [name, n] of Object.entries(sizes)) expect(n, name).toBeGreaterThan(0)
    expect(sizes['地点']).toBe(285)
    const scene = all.find((t) => t.id === 'tpl:scene')!
    expect(scene.pools.map((p) => [p.name, p.count, p.popularity])).toEqual([
      ['地点', [1, 1], 0.5],
      ['天气时间', [0, 1], 0.5],
      ['光', [1, 1], 0.5],
      ['构图镜头', [0, 1], 0.5],
    ])
    expect(all[0].pools[0]).toMatchObject({ kind: 'char', count: [1, 1], popularity: 1, genders: ['canon'] })
    expect(all[1].pools[0]).toMatchObject({ kind: 'artist', count: [2, 2], popularity: 0, weight: 'main' })
    expect(all[1].summary).toBe('画师库 · 代表作人气前 1000')
    console.log('模板池子个数', JSON.stringify(sizes))
  })
  it('does not expose the removed template', () => {
    expect(gachaTemplates(resolve).some((t) => t.id === 'tpl:r18')).toBe(false)
  })
})

describe('步进器 + 复制那一行', () => {
  it('两个数一样时推另一个：最少 + 把最多一起推上去，最多 − 把最少一起拉下来', () => {
    expect(pushCount([1, 1], 0, 2)).toEqual([2, 2])
    expect(pushCount([1, 3], 0, 2)).toEqual([2, 3])
    expect(pushCount([2, 2], 1, 1)).toEqual([1, 1])
    expect(pushCount([0, 2], 1, 1)).toEqual([0, 1])
  })
  it('复制：人数 + 角色 tag + 作品 tag + 画师权重写法，同一个 tag 只写一次', () => {
    const char = newPool('char', 'prompt', { id: 'c', source: [{ kind: 'chars' }], sourceTags: [['frieren', 'fern (sousou no frieren)']] })
    const art = newPool('artist', 'prompt', { id: 'a', weight: 'main' })
    const place = newPool('tag', 'prompt', { id: 'p', picked: ['rooftop'] })
    const results: Record<string, Draw[]> = {
      c: [
        { tag: 'frieren', gender: 'female' },
        { tag: 'fern (sousou no frieren)', gender: 'female' },
      ],
      a: [
        { tag: 'huke', w: 1.15 },
        { tag: 'wlop', w: 0.9 },
      ],
      p: [{ tag: 'rooftop' }],
    }
    expect(resultLineOf([char, art, place], results, (_p, t) => CHARS[t]?.work ?? null)).toBe(
      '2girls, frieren, sousou no frieren, fern (sousou no frieren), 1.15::artist:huke::, 0.9::artist:wlop::, rooftop',
    )
    expect(resultLineOf([char], { c: [{ tag: 'frieren', gender: 'female' }] }, () => 'sousou no frieren')).toBe('1girl, frieren, sousou no frieren')
  })
})

describe('pe:gacha v4 → v5', () => {
  it('合集、不抽的、停在哪个合集原样留着；加上模板调过的值（空）和停在哪个模板；调过的值能恢复', async () => {
    const { useGacha } = await import('@/store/gacha')
    const v4 = { collections: [{ id: 'gc1', name: '我的', createdAt: 1, pools: [newPool('tag', 'prompt', { id: 'p1', picked: ['day'] })] }], excludes: { 'gc1/p1': ['night'] }, activeId: 'gc1' }
    const v5 = (await useGacha.persist.getOptions().migrate!(structuredClone(v4), 4)) as Record<string, unknown>
    expect(v5.collections).toEqual(v4.collections)
    expect(v5.excludes).toEqual(v4.excludes)
    expect(v5.activeId).toBe('gc1')
    expect(v5.templates).toEqual({})
    expect(v5.activeTemplate).toBe('tpl:char')
    const g = useGacha.getState()
    g.tune('tpl:scene', 'tpl-scene-place', { count: [2, 3] })
    g.tune('tpl:scene', 'tpl-scene-place', { popularity: 0 })
    expect(useGacha.getState().templates).toEqual({ 'tpl:scene': { 'tpl-scene-place': { count: [2, 3], popularity: 0 } } })
    g.tune('tpl:scene', 'tpl-scene-place', { count: undefined, popularity: undefined })
    expect(useGacha.getState().templates).toEqual({})
  })
})

const sec = (patch: Partial<Section> = {}): Section => ({ id: 's1', name: '画师', color: 'rose', muted: false, chips: parsePrompt('1.15::artist:huke::, 0.9::artist:wlop::').map(toChip), ...patch })
const doc = (prompt: Section[]): Doc => ({ base: { prompt, uc: [] }, characters: [], settings: defaultSettings(), meta: { title: 't', createdAt: 0 } })

describe('文档里的随机区块', () => {
  it('normalizeDoc 认 random：整理好的留着，不像规则的去掉（= 普通区块）', () => {
    const ok = normalizeDoc(doc([sec({ random: { kind: 'artist', source: [{ kind: 'artists', minCount: 777 }, { kind: 'bogus' }], count: [5, 2], popularity: 9 } as unknown as RandomRule })]))
    expect(ok.base.prompt[0].random).toEqual({ kind: 'artist', source: [{ kind: 'artists', minCount: 500 }], sourceTags: [[]], count: [2, 5], popularity: 1, weight: 'main' })
    const bad = normalizeDoc(doc([sec({ random: { hello: 1 } as unknown as RandomRule })]))
    expect('random' in bad.base.prompt[0]).toBe(false)
  })
  it('导出给 NAI 的只看 chips：带不带规则一样', () => {
    const withRule = doc([sec({ random: defaultRule('artist') })])
    expect(exportDoc(withRule)).toEqual(exportDoc(doc([sec()])))
  })
  it('重抽 = 一次文档改动：Ctrl+Z 回到上一次抽的结果', () => {
    const s = sec({ random: { ...defaultRule('artist'), sourceTags: [[]] } })
    const store = createDocStore(doc([s]))
    const before = store.getState().doc.base.prompt[0].chips
    const r = runRandom(s.random!, s.chips, { kind: 'roll' }, ctx(11))!
    store.getState().setRandom('s1', { chips: r.chips })
    expect(store.getState().doc.base.prompt[0].chips).not.toBe(before)
    store.temporal.getState().undo()
    expect(store.getState().doc.base.prompt[0].chips).toBe(before)
  })
  it('角色随机：同一步改框的性别；框头「随机角色 · 名字」，手填了名字用手填的；保存为角色模板不带规则', () => {
    const chips = parsePrompt('frieren, sousou no frieren').map(toChip)
    const rs: Section = { id: 'r', name: '角色', color: 'rose', muted: false, chips, random: defaultRule('char') }
    const d = doc([])
    d.characters = [{ id: 'ch', name: '', gender: 'other', color: 'rose', prompt: [rs], uc: [], enabled: true, center: { x: 0.5, y: 0.5 } }]
    const store = createDocStore(d)
    store.getState().setRandom('r', { gender: { gender: 'female' } })
    expect(store.getState().doc.characters[0].gender).toBe('female')
    const W: WorkContext = { isCharTag: (t) => t in CHARS, worksOf: (t) => (CHARS[t] ? [CHARS[t].work] : []), workLabel: (w) => (w === 'sousou no frieren' ? '葬送的芙莉莲' : w), npmi: () => 0, charLabel: (t) => (t === 'frieren' ? '芙莉莲' : t), canonical: (t) => t }
    const c = store.getState().doc.characters[0]
    expect(characterDisplay(c, W)).toMatchObject({ name: '随机角色 · 芙莉莲', nameFromTag: true, work: '葬送的芙莉莲' })
    expect(characterDisplay({ ...c, prompt: [{ ...rs, chips: [] }] }, W).name).toBe('随机角色')
    expect(characterDisplay({ ...c, name: '师父' }, W).name).toBe('师父')
    expect('random' in templateFromCharacter(c, 'x').prompt[0]).toBe(false)
  })
})
