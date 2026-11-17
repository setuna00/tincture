import { describe, expect, it } from 'vitest'
import { createDocStore, defaultSettings, normalizeDoc } from '@/store/doc'
import type { Character, Doc, Gender, Section } from '@/types'
import { genderOfPrompt, genderValueOfPrompt, takeGender } from './gender'
import { characterPrompt, exportDoc, exportString, parsePrompt, toChip } from './nai'
import { buildImportedDoc, importItems, parseNaiImage, type ImportItem } from './nai-image'
import { dupIndex, lengthPlan } from './nai-length'
import { naiComment, naiMetadata } from './nai-write'

let n = 0
const sec = (text: string, o: Partial<Section> = {}): Section => ({ id: `s${n++}`, name: '外观', color: 'slate', muted: false, chips: parsePrompt(text).map(toChip), ...o })
const char = (prompt: Section[], o: Partial<Character> = {}): Character => ({ id: `c${n++}`, name: '', gender: 'other', prompt, uc: [], enabled: true, center: { x: 0.5, y: 0.5 }, ...o, color: o.color ?? 'slate' })
const doc = (characters: Character[]): Doc => ({ base: { prompt: [sec('2girls')], uc: [] }, characters, settings: defaultSettings(), meta: { title: 't', createdAt: 0 } })
const texts = (s: Section[]) => s.flatMap((x) => x.chips.map((c) => c.text))

describe('takeGender：第一个导出的 tag 是 girl / boy 才认', () => {
  it('girl → 女、boy → 男，去掉那个 chip', () => {
    const a = takeGender([sec('girl, frieren, elf')])
    expect(a.gender).toBe('female')
    expect(texts(a.sections)).toEqual(['frieren', 'elf'])
    expect(takeGender([sec('boy, stark (sousou no frieren)')]).gender).toBe('male')
  })
  it('带权重的、不在第一个的、1girl：不认（性别「其他」，chip 不动）', () => {
    for (const p of ['1.2::girl::, frieren', 'frieren, girl', '1girl, frieren', 'girls, frieren']) {
      const r = takeGender([sec(p)])
      expect(r.gender, p).toBe('other')
      expect(exportString(r.sections), p).toBe(exportString([sec(p)]))
    }
  })
  it('跳过停用的区块、禁用的 tag（按导出看第一个）', () => {
    const muted = sec('boy', { muted: true })
    const r = takeGender([muted, sec('girl, frieren')])
    expect(r.gender).toBe('female')
    expect(texts(r.sections)).toEqual(['boy', 'frieren'])
    const off = sec('girl, boy, x')
    off.chips[0].disabled = true
    const r2 = takeGender([off])
    expect(r2.gender).toBe('male')
    expect(r2.sections[0].chips.map((c) => c.text)).toEqual(['girl', 'x'])
  })
  it('导出结果一字不差；不改传进来的对象；从模板插入的区块记成改过', () => {
    const s = sec('girl, frieren, 1.2::green eyes::', { templateId: 'tpl' })
    const before = exportString([s])
    const r = takeGender([s])
    expect(characterPrompt({ gender: r.gender, prompt: r.sections })).toBe(before)
    expect(s.chips).toHaveLength(3)
    expect(r.sections[0].templateEdited).toBe(true)
  })
  it('genderOfPrompt（导入弹窗的预览）', () => {
    expect(genderOfPrompt('girl, frieren')).toBe('female')
    expect(genderOfPrompt('Boy, x')).toBe('male')
    expect(genderOfPrompt('1girl')).toBe('other')
    expect(genderOfPrompt('')).toBe('other')
  })
  it('genderValueOfPrompt (new character template dialog): extended gender read from the tags after girl / boy', () => {
    const defs = [{ gender: 'female' as const, name: '扶她', tags: ['futanari'] }]
    expect(genderValueOfPrompt('girl, futanari, long hair', defs)).toEqual({ gender: 'female', genderExtra: { name: '扶她', tags: ['futanari'] } })
    expect(genderValueOfPrompt('girl, long hair', defs)).toEqual({ gender: 'female' })
    expect(genderValueOfPrompt('girl, futanari')).toEqual({ gender: 'female' })
    expect(genderValueOfPrompt('long hair, girl', defs)).toEqual({ gender: 'other' })
  })
})

describe('characterPrompt：性别词在最前面', () => {
  it('女 / 男 / 其他；只有性别也有一串', () => {
    expect(characterPrompt(char([sec('frieren, elf')], { gender: 'female' }))).toBe('girl, frieren, elf')
    expect(characterPrompt(char([sec('stark (sousou no frieren)')], { gender: 'male' }))).toBe('boy, stark (sousou no frieren)')
    expect(characterPrompt(char([sec('mimic')], { gender: 'other' }))).toBe('mimic')
    expect(characterPrompt(char([], { gender: 'female' }))).toBe('girl')
  })
  it('导出栏：girl 是单独标出来的 token；复制的文本里有它', () => {
    const d = doc([char([sec('frieren')], { gender: 'female', name: '芙莉莲' })])
    const box = exportDoc(d).find((b) => b.char && b.field === 'prompt')!
    expect(box.text).toBe('girl, frieren')
    expect(box.tokens[0]).toMatchObject({ k: 'tag', t: 'girl', gender: 'female' })
    expect(box.char?.gender).toBe('female')
  })
})

describe('旧存档迁移（normalizeDoc）', () => {
  it('补性别、删掉开头的 girl；导出不变；自动起的「角色 N」名字清空；区块的 collapsed 去掉', () => {
    const old = {
      ...doc([]),
      characters: [
        { id: 'a', name: '角色 1', prompt: [{ ...sec('girl, frieren'), collapsed: true }], uc: [], enabled: true, center: { x: 0.5, y: 0.5 } },
        { id: 'b', name: '修塔尔克', prompt: [sec('stark (sousou no frieren), boy')], uc: [], enabled: true, center: { x: 0.5, y: 0.5 } },
      ],
    } as unknown as Doc
    const before = exportDoc(old as Doc).map((b) => b.text)
    const d = normalizeDoc(old)
    expect(d.characters.map((c) => c.gender)).toEqual(['female', 'other'])
    expect(texts(d.characters[0].prompt)).toEqual(['frieren'])
    expect(d.characters.map((c) => c.name)).toEqual(['', '修塔尔克'])
    expect('collapsed' in d.characters[0].prompt[0]).toBe(false)
    expect(exportDoc(d).map((b) => b.text)).toEqual(before)
  })
  it('已经有性别的不再动（区块里再写的 girl 留着）', () => {
    const d = normalizeDoc(doc([char([sec('girl, x')], { gender: 'female' })]))
    expect(texts(d.characters[0].prompt)).toEqual(['girl', 'x'])
  })
})

describe('长度 / 重复', () => {
  it('长度按带 girl 的整串算，环形图多一段「性别 女」', () => {
    const c = char([sec('frieren')], { gender: 'female', name: '芙莉莲' })
    const box = lengthPlan(doc([c])).boxes.find((b) => b.key === `${c.id}.prompt`)!
    expect(box.text).toBe('girl, frieren')
    expect(box.parts[0]).toMatchObject({ id: 'gender', name: '性别 女', gender: 'female', text: 'girl' })
  })
  it('区块里又写了 girl = 和「性别 女」重复（只提示）；其他性别不算', () => {
    const c = char([sec('girl, frieren')], { gender: 'female' })
    const d = doc([c])
    const girl = c.prompt[0].chips[0]
    expect(dupIndex(d).chips.get(girl.id)).toEqual(['性别 女'])
    expect(dupIndex(d).boxes.get(`${c.id}.prompt`)?.keys.has('girl')).toBe(true)
    const d2 = doc([char([sec('girl, frieren')], { gender: 'other' })])
    expect(dupIndex(d2).chips.size).toBe(0)
  })
})

describe('复制为 NAI 图 / 从图片导入：性别来回不丢', () => {
  it('char_caption 带 girl / boy；读回来性别还在、区块里没有 girl', () => {
    const genders: Gender[] = ['female', 'male', 'other']
    const d = doc(genders.map((g) => char([sec('x, y')], { gender: g })))
    const caps = naiComment(d).v4_prompt.caption.char_captions.map((c) => c.char_caption)
    expect(caps).toEqual(['girl, x, y', 'boy, x, y', 'x, y'])
    const p = parseNaiImage(naiMetadata(d))
    const all = new Set<ImportItem>(Object.values(importItems(p)).flat())
    const back = buildImportedDoc(p, all, { base: null, appendChars: false }, defaultSettings()).doc
    expect(back.characters.map((c) => c.gender)).toEqual(genders)
    expect(back.characters.map((c) => texts(c.prompt))).toEqual([['x', 'y'], ['x', 'y'], ['x', 'y']])
  })
})

describe('doc store：角色', () => {
  it('新角色名字空着、带性别；拖动排序一步撤销，原地不动不写', () => {
    const store = createDocStore(doc([]))
    const a = store.getState().addCharacter('female')!
    const b = store.getState().addCharacter('male')!
    expect(store.getState().doc.characters.map((c) => [c.name, c.gender])).toEqual([
      ['', 'female'],
      ['', 'male'],
    ])
    const steps = store.temporal.getState().pastStates.length
    store.getState().moveCharacter(a, 0)
    expect(store.temporal.getState().pastStates.length).toBe(steps)
    store.getState().moveCharacter(a, 1)
    expect(store.getState().doc.characters.map((c) => c.id)).toEqual([b, a])
    store.temporal.getState().undo()
    expect(store.getState().doc.characters.map((c) => c.id)).toEqual([a, b])
  })
})

describe('角色的颜色：里面的区块默认跟着它', () => {
  const setup = () => {
    const a = char([sec('外观', { color: 'lime' }), sec('服装', { color: 'rose', ownColor: true })], { color: 'lime' })
    a.uc = [sec('防串色', { color: 'lime' })]
    const store = createDocStore(doc([a]))
    return { store, a, c: () => store.getState().doc.characters[0] }
  }
  it('角色改色：跟随的区块一起换，自己选过的不动；一步撤销', () => {
    const { store, a, c } = setup()
    store.getState().updateCharacter(a.id, { color: 'violet' })
    expect([...c().prompt, ...c().uc].map((s) => s.color)).toEqual(['violet', 'rose', 'violet'])
    store.temporal.getState().undo()
    expect([...c().prompt, ...c().uc].map((s) => s.color)).toEqual(['lime', 'rose', 'lime'])
  })
  it('区块自己选颜色 = 不跟了（选的正好是角色的颜色 = 跟随）；「跟随角色」回去', () => {
    const { store, a, c } = setup()
    const look = a.prompt[0].id
    store.getState().updateSection(look, { color: 'sky' })
    expect(c().prompt[0]).toMatchObject({ color: 'sky', ownColor: true })
    store.getState().followCharacterColor(look)
    expect(c().prompt[0].color).toBe('lime')
    expect(c().prompt[0].ownColor).toBeUndefined()
    store.getState().updateSection(c().prompt[1].id, { color: 'lime' })
    expect(c().prompt[1].ownColor).toBeUndefined()
  })
  it('新建 / 移进角色的区块跟着角色；移出去去掉 ownColor、颜色留着', () => {
    const { store, a, c } = setup()
    const id = store.getState().addSection({ kind: 'char', charId: a.id, field: 'prompt' })
    expect(c().prompt.find((s) => s.id === id)?.color).toBe('lime')
    const own = c().prompt[1].id
    store.getState().moveSectionToBox(own, { kind: 'base', field: 'prompt' })
    const moved = store.getState().doc.base.prompt.find((s) => s.id === own)!
    expect(moved.color).toBe('rose')
    expect('ownColor' in moved).toBe(false)
  })
  it('新角色挑一个别的角色没用的颜色', () => {
    const store = createDocStore(doc([]))
    store.getState().addCharacter('female')
    store.getState().addCharacter('male')
    const [x, y] = store.getState().doc.characters
    expect(x.color).not.toBe(y.color)
    expect(x.prompt[0].color).toBe(x.color)
  })
  it('旧存档：角色的颜色 = 第一个区块的颜色，同色的跟随、别的算自己选的', () => {
    const old = { ...doc([]), characters: [{ id: 'a', name: '', gender: 'female', prompt: [sec('x', { color: 'lime' }), sec('y', { color: 'rose' })], uc: [], enabled: true, center: { x: 0.5, y: 0.5 } }] } as unknown as Doc
    const d = normalizeDoc(old)
    expect(d.characters[0].color).toBe('lime')
    expect(d.characters[0].prompt.map((s) => [s.color, !!s.ownColor])).toEqual([
      ['lime', false],
      ['rose', true],
    ])
  })
})
