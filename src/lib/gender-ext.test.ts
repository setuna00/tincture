import { describe, expect, it } from 'vitest'
import { createDocStore, defaultSettings, normalizeDoc } from '@/store/doc'
import { nsfwOf } from '@/store/prefs'
import type { Character, Doc, Section } from '@/types'
import { AI_DOC_SCHEMA_ID, applyPlan, planReply, toAiDoc } from './ai-doc'
import { sameCharacterContent } from './char-template'
import { fromFile, GACHA_SCHEMA, genderPickKey, newPool, pickGender, toFile, type GachaCollection } from './gacha'
import { cleanGenderExtra, GENDER_PRESETS, genderOptions, genderTags, takeGender, valueOfDef, type GenderDef } from './gender'
import { characterPrompt, exportDoc, parsePrompt, toChip } from './nai'
import { buildImportedDoc, importItems, parseNaiImage, type ImportItem } from './nai-image'
import { dupIndex, lengthPlan } from './nai-length'
import { naiMetadata } from './nai-write'

let n = 0
const sec = (text: string, o: Partial<Section> = {}): Section => ({ id: `s${n++}`, name: '外观', color: 'slate', muted: false, chips: parsePrompt(text).map(toChip), ...o })
const char = (prompt: Section[], o: Partial<Character> = {}): Character => ({ id: `c${n++}`, name: '', gender: 'other', prompt, uc: [], enabled: true, center: { x: 0.5, y: 0.5 }, ...o, color: o.color ?? 'slate' })
const doc = (characters: Character[]): Doc => ({ base: { prompt: [sec('2girls')], uc: [] }, characters, settings: defaultSettings(), meta: { title: 't', createdAt: 0 } })
const texts = (s: Section[]) => s.flatMap((x) => x.chips.map((c) => c.text))
const preset = (name: string): GenderDef => GENDER_PRESETS.find((p) => p.name === name)!
const trap = valueOfDef(preset('伪娘'))
const ambiguous = valueOfDef(preset('性别不明'))
const longTrap: GenderDef = { gender: 'male', name: '女装少年', tags: ['otoko no ko', 'crossdressing (mtf)'] }
const LEVEL: Record<string, number> = { futanari: 2, cuntboy: 2 }
const levelOf = (t: string) => LEVEL[t] ?? 0

describe('导出：girl / boy 后面接扩展性别的 tag', () => {
  it('伪娘 = boy, otoko no ko；其他 + 性别不明 = ambiguous gender；只有性别也有一串', () => {
    expect(characterPrompt(char([sec('stark (sousou no frieren)')], trap))).toBe('boy, otoko no ko, stark (sousou no frieren)')
    expect(characterPrompt(char([sec('mimic')], ambiguous))).toBe('ambiguous gender, mimic')
    expect(characterPrompt(char([], trap))).toBe('boy, otoko no ko')
    expect(genderTags({ gender: 'female', genderExtra: { name: 'x', tags: ['a', 'b'] } })).toEqual(['girl', 'a', 'b'])
  })
  it('导出栏：每个自动加的 tag 都是性别 token，带扩展性别的名字；卡片头带扩展性别', () => {
    const c = char([sec('stark')], { ...trap, name: '修塔尔克' })
    const box = exportDoc(doc([c])).find((b) => b.char && b.field === 'prompt')!
    expect(box.tokens.filter((t) => t.k === 'tag' && t.gender).map((t) => t.k === 'tag' && [t.t, t.gname])).toEqual([
      ['boy', '伪娘'],
      ['otoko no ko', '伪娘'],
    ])
    expect(box.char?.genderExtra?.name).toBe('伪娘')
  })
})

describe('设置里列哪些（genderOptions）', () => {
  const base = { moreGenders: true, genderPresetsOff: [] as string[], customGenders: [] }
  it('总开关关着：一个都没有', () => {
    expect(genderOptions({ ...base, moreGenders: false }, 3, levelOf)).toEqual([])
  })
  it('预设按顺序；R18 的跟着 NSFW 档（关 = 1 时不列扶她、有阴道的男性）；关掉的不列', () => {
    expect(genderOptions(base, 1, levelOf).map((d) => d.name)).toEqual(['女体化', '男装女子', '男体化', '伪娘', '性别不明'])
    expect(genderOptions(base, 2, levelOf).map((d) => d.name)).toEqual(['女体化', '男装女子', '扶她', '男体化', '伪娘', '有阴道的男性', '性别不明'])
    expect(genderOptions({ ...base, genderPresetsOff: ['otoko-no-ko'] }, 1, levelOf).map((d) => d.name)).not.toContain('伪娘')
  })
  it('自己加的接在后面（不看 NSFW 档）；没有 tag 的不列；名字空的用 tag 当名字', () => {
    const customGenders = [
      { id: 'a', gender: 'male' as const, name: '女装少年', tags: ['otoko no ko', 'crossdressing (mtf)'] },
      { id: 'b', gender: 'female' as const, name: '空的', tags: [] },
      { id: 'c', gender: 'female' as const, name: ' ', tags: ['futanari', 'flat chest'] },
    ]
    const r = genderOptions({ ...base, genderPresetsOff: GENDER_PRESETS.map((p) => p.id), customGenders }, 1, levelOf)
    expect(r).toEqual([
      { gender: 'male', name: '女装少年', tags: ['otoko no ko', 'crossdressing (mtf)'] },
      { gender: 'female', name: 'futanari, flat chest', tags: ['futanari', 'flat chest'] },
    ])
  })
})

describe('从图片导入：girl / boy 后面紧跟着开着的扩展性别的 tag 才认', () => {
  it('认出来、一起去掉；导出一字不差；不给扩展性别时只认 boy', () => {
    const s = [sec('boy, otoko no ko, stark, red hair')]
    const r = takeGender(s, [preset('伪娘')])
    expect(r.gender).toBe('male')
    expect(r.genderExtra).toEqual({ name: '伪娘', tags: ['otoko no ko'] })
    expect(texts(r.sections)).toEqual(['stark', 'red hair'])
    expect(r.taken).toEqual(['boy', 'otoko no ko'])
    expect(characterPrompt({ ...r, prompt: r.sections })).toBe('boy, otoko no ko, stark, red hair')
    const plain = takeGender(s)
    expect(plain.genderExtra).toBeUndefined()
    expect(texts(plain.sections)).toEqual(['otoko no ko', 'stark', 'red hair'])
  })
  it('NAI 性别对不上、不紧跟着、带权重的不认；对得上几个取 tag 最多的', () => {
    expect(takeGender([sec('girl, otoko no ko, x')], [preset('伪娘')]).genderExtra).toBeUndefined()
    expect(takeGender([sec('boy, x, otoko no ko')], [preset('伪娘')]).genderExtra).toBeUndefined()
    expect(takeGender([sec('boy, 1.2::otoko no ko::, x')], [preset('伪娘')]).genderExtra).toBeUndefined()
    const r = takeGender([sec('boy, otoko no ko'), sec('crossdressing (mtf), x')], [preset('伪娘'), longTrap])
    expect(r.genderExtra?.name).toBe('女装少年')
    expect(texts(r.sections)).toEqual(['x'])
  })
  it('「其他」类看开头：ambiguous gender 开头 = 性别不明', () => {
    const r = takeGender([sec('ambiguous gender, mimic')], [preset('性别不明')])
    expect([r.gender, r.genderExtra?.name, texts(r.sections)]).toEqual(['other', '性别不明', ['mimic']])
  })
  it('复制为 NAI 图再读回来：开着伪娘就认回伪娘，没开就是男 + 区块里的 otoko no ko', () => {
    const d = doc([char([sec('stark')], trap)])
    const p = parseNaiImage(naiMetadata(d))
    const all = new Set<ImportItem>(Object.values(importItems(p)).flat())
    const back = buildImportedDoc(p, all, { base: null, appendChars: false, genders: [preset('伪娘')] }, defaultSettings()).doc
    expect(back.characters[0].genderExtra?.name).toBe('伪娘')
    expect(texts(back.characters[0].prompt)).toEqual(['stark'])
    const off = buildImportedDoc(p, all, { base: null, appendChars: false }, defaultSettings()).doc
    expect([off.characters[0].gender, off.characters[0].genderExtra, texts(off.characters[0].prompt)]).toEqual(['male', undefined, ['otoko no ko', 'stark']])
  })
})

describe('长度 / 重复', () => {
  it('环形图一段「性别 伪娘」= boy, otoko no ko', () => {
    const c = char([sec('stark')], trap)
    const box = lengthPlan(doc([c])).boxes.find((b) => b.key === `${c.id}.prompt`)!
    expect(box.text).toBe('boy, otoko no ko, stark')
    expect(box.parts[0]).toMatchObject({ id: 'gender', name: '性别 伪娘', gender: 'male', text: 'boy, otoko no ko' })
  })
  it('区块里又写了 otoko no ko = 和「性别 伪娘」重复', () => {
    const c = char([sec('otoko no ko, stark')], trap)
    expect(dupIndex(doc([c])).chips.get(c.prompt[0].chips[0].id)).toEqual(['性别 伪娘'])
  })
})

describe('存档 / 角色模板', () => {
  it('旧存档里不合法的扩展性别去掉（没有 tag）；合法的留着、tag 整理过', () => {
    const d = normalizeDoc(
      doc([
        char([sec('x')], { gender: 'male', genderExtra: { name: '伪娘', tags: [' otoko no ko ', '', 'otoko no ko'] } }),
        char([sec('x')], { gender: 'male', genderExtra: { name: '空', tags: [] } }),
      ]),
    )
    expect(d.characters[0].genderExtra).toEqual({ name: '伪娘', tags: ['otoko no ko'] })
    expect('genderExtra' in d.characters[1]).toBe(false)
    expect(cleanGenderExtra({ tags: ['a'] })).toEqual({ name: 'a', tags: ['a'] })
  })
  it('改扩展性别算「改过」；改回普通的男去掉字段；一步撤销', () => {
    const c = char([sec('stark')], { gender: 'male', templateId: 'tpl' })
    expect(sameCharacterContent(c, { ...c, ...trap })).toBe(false)
    const store = createDocStore(doc([c]))
    store.getState().updateCharacter(c.id, trap)
    expect(store.getState().doc.characters[0]).toMatchObject({ genderExtra: { name: '伪娘' }, templateEdited: true })
    store.getState().updateCharacter(c.id, { gender: 'male', genderExtra: undefined })
    expect('genderExtra' in store.getState().doc.characters[0]).toBe(false)
    store.temporal.getState().undo()
    expect(store.getState().doc.characters[0].genderExtra?.name).toBe('伪娘')
  })
  it('新建角色带扩展性别', () => {
    const store = createDocStore(doc([]))
    store.getState().addCharacter('male', trap.genderExtra)
    expect(characterPrompt(store.getState().doc.characters[0])).toBe('boy, otoko no ko')
  })
})

describe('复制给 AI', () => {
  const reply = (o: object) => ({ $schema: AI_DOC_SCHEMA_ID, ...o })
  it('发出去带扩展性别；原样粘回 = 0 处改动', () => {
    const d = doc([char([sec('stark')], { ...trap, name: '修塔尔克' })])
    const a = toAiDoc(d)
    expect(a.characters?.[0].genderExtra).toEqual({ name: '伪娘', tags: ['otoko no ko'] })
    expect(planReply(d, JSON.parse(JSON.stringify(a))).changes).toEqual([])
  })
  it('AI 把男改成伪娘：一处「性别 男 → 伪娘」，应用后导出带 otoko no ko；只写 gender 改性别时扩展性别去掉', () => {
    const c = char([sec('stark')], { gender: 'male', name: '修塔尔克' })
    const d = doc([c])
    const p = planReply(d, reply({ characters: [{ id: c.id, genderExtra: { name: '伪娘', tags: ['otoko no ko'] } }] }))
    expect(p.changes.map((x) => x.line)).toEqual(['修塔尔克：性别 男 → 伪娘'])
    const after = applyPlan(d, p, new Set(p.changes.map((x) => x.key)))
    expect(characterPrompt(after.characters[0])).toBe('boy, otoko no ko, stark')
    const p2 = planReply(after, reply({ characters: [{ id: c.id, gender: 'female' }] }))
    expect(p2.changes.map((x) => x.line)).toEqual(['修塔尔克：性别 伪娘 → 女'])
    const back = applyPlan(after, p2, new Set(p2.changes.map((x) => x.key)))
    expect('genderExtra' in back.characters[0]).toBe(false)
    expect(characterPrompt(back.characters[0])).toBe('girl, stark')
  })
  it('新角色可以带扩展性别；null = 去掉', () => {
    const c = char([sec('stark')], { ...trap, name: '修塔尔克' })
    const d = doc([c])
    const p = planReply(d, reply({ characters: [{ id: c.id, genderExtra: null }, { name: '新', gender: 'other', genderExtra: { name: '性别不明', tags: ['ambiguous gender'] }, prompt: [{ name: 'a', text: 'x' }] }] }))
    expect(p.changes.map((x) => x.line)).toEqual(['修塔尔克：性别 伪娘 → 男', '新角色「新」（性别不明）：1 个区块'])
  })
})

describe('抽卡：角色池的扩展性别', () => {
  it('抽到扩展性别 = NAI 性别 + 快照', () => {
    expect(pickGender([preset('伪娘')], 'female', () => 0)).toEqual(trap)
  })
  it('JSON 往返：对象形式的性别留着，认不出的丢掉、重复的去掉；Schema 里写了对象', () => {
    const p = { ...newPool('char', 'prompt'), id: 'p1', genders: ['canon', preset('伪娘')] as GachaCollection['pools'][number]['genders'] }
    const c: GachaCollection = { id: 'c', name: '合集', createdAt: 0, pools: [p] }
    const file = JSON.parse(JSON.stringify(toFile(c, () => [])))
    file.pools[0].genders.push('x', { gender: 'male', name: '伪娘', tags: ['otoko no ko'] }, { gender: 'nope', tags: ['a'] })
    const r = fromFile(file, () => true)
    if ('error' in r) throw new Error(r.error)
    const g = r.collection.pools[0].genders!
    expect(g.map(genderPickKey)).toEqual(['canon', 'x:male:伪娘:otoko no ko'])
    expect(JSON.stringify(GACHA_SCHEMA)).toContain('anyOf')
  })
})

describe('设置页的两个 NSFW 开关', () => {
  it('NSFW 关着就是关；开着看 R18G', () => {
    expect(nsfwOf(false, true)).toBe('off')
    expect(nsfwOf(true, false)).toBe('r18')
    expect(nsfwOf(true, true)).toBe('r18g')
  })
})
