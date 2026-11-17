import { describe, expect, it } from 'vitest'
import { createDocStore } from '@/store/doc'
import type { CharacterTemplate } from '@/store/library'
import { exampleCharacters, sampleDoc } from '@/store/sample'
import type { Section } from '@/types'
import { characterDisplay, characterFromTemplate, characterTags, knownWorks, relatedCharacters, sameCharacterContent, templateFromCharacter, templateFromPrompt, workSuggestions, type WorkContext } from './char-template'
import { characterPrompt, parsePrompt, toChip } from './nai'
import { decodeChars, type CharsFile } from './char-works'
import { decodeAliases, type LookupFile } from './tag-data'
import { BY_NAME, npmiOf } from './tag-fixture'

const { readFileSync } = (await import(/* @vite-ignore */ `node:${'fs'}`)) as { readFileSync(p: URL): Uint8Array }
const { gunzipSync } = (await import(/* @vite-ignore */ `node:${'zlib'}`)) as { gunzipSync(b: Uint8Array): Uint8Array }
const works = decodeChars(JSON.parse(new TextDecoder().decode(gunzipSync(readFileSync(new URL('../assets/tags/chars.json.gz', import.meta.url))))) as CharsFile, new Map())
const aliases = decodeAliases(JSON.parse(new TextDecoder().decode(gunzipSync(readFileSync(new URL('../assets/tags/lookup.json.gz', import.meta.url))))) as LookupFile)

const CTX: WorkContext = {
  isCharTag: (n) => BY_NAME.get(n)?.category === 'character',
  worksOf: (t) => works.get(t) ?? [],
  workLabel: (w) => BY_NAME.get(w)?.zh || w,
  npmi: npmiOf,
  charLabel: (t) => BY_NAME.get(t)?.zh || t,
  canonical: (n) => aliases.get(n.toLowerCase()) ?? n.toLowerCase(),
}

const asTemplate = (c: ReturnType<typeof exampleCharacters>[keyof ReturnType<typeof exampleCharacters>], id: string): CharacterTemplate => ({ ...templateFromCharacter(c, c.name), id, createdAt: 0 })
const ex = exampleCharacters()
const T = { frieren: asTemplate(ex.芙莉莲, 't-frieren'), fern: asTemplate(ex.菲伦, 't-fern'), stark: asTemplate(ex.修塔尔克, 't-stark'), himmel: asTemplate(ex.辛美尔, 't-himmel') }

describe('chars.json（角色 → 作品）', () => {
  it('角色的性别（单人图猜的）、作品 → 角色', () => {
    const more = { chars: new Map<string, string[]>(), gender: new Map<string, 'female' | 'male' | 'other'>() }
    decodeChars(JSON.parse(new TextDecoder().decode(gunzipSync(readFileSync(new URL('../assets/tags/chars.json.gz', import.meta.url))))) as CharsFile, new Map(), more)
    expect(more.gender.get('frieren')).toBe('female')
    expect(more.gender.get('stark (sousou no frieren)')).toBe('male')
    expect(more.gender.get('himmel (sousou no frieren)')).toBe('male')
    expect(more.gender.has('pikachu')).toBe(false)
    expect(more.gender.size).toBeGreaterThan(15000)
    expect(more.chars.get('sousou no frieren')).toEqual(expect.arrayContaining(['frieren', 'fern (sousou no frieren)', 'stark (sousou no frieren)']))
  })
  it('芙莉莲一家都在葬送的芙莉莲；作品显示中文名', () => {
    for (const t of ['frieren', 'fern (sousou no frieren)', 'stark (sousou no frieren)', 'himmel (sousou no frieren)']) expect(works.get(t)).toEqual(['sousou no frieren'])
    expect(CTX.workLabel('sousou no frieren')).toBe('葬送的芙莉莲')
    expect(works.get('hatsune miku')).toEqual(['vocaloid'])
  })
  it('覆盖 tag 库里九成以上的角色', () => {
    const chars = [...BY_NAME.values()].filter((t) => t.category === 'character')
    expect(chars.filter((t) => works.has(t.name)).length / chars.length).toBeGreaterThan(0.9)
  })
})

describe('从模板添加 / 存为模板', () => {
  it('添加：换新 id（角色、区块、chip），带来源 / 备注 / 作品，启用、位置在正中；区块带着各自的来源', () => {
    const t = { ...T.fern, uc: [{ ...T.fern.prompt[0], id: 's-uc', name: '防串色', templateId: 'st-x', templateEdited: true }] }
    const c = characterFromTemplate(t)
    expect(c.templateId).toBe('t-fern')
    expect(c.templateEdited).toBeUndefined()
    expect(c.note).toBe(t.note)
    expect(c.work).toBe('葬送的芙莉莲')
    expect(c.enabled).toBe(true)
    expect(c.prompt[0].id).not.toBe(t.prompt[0].id)
    expect(c.prompt[0].chips[0].id).not.toBe(t.prompt[0].chips[0].id)
    expect(c.prompt[0].chips.map((x) => x.text)).toEqual(t.prompt[0].chips.map((x) => x.text))
    expect(c.uc[0]).toMatchObject({ name: '防串色', templateId: 'st-x', templateEdited: true })
    expect(characterFromTemplate(t).prompt[0].id).not.toBe(c.prompt[0].id)
  })
  it('存为模板：区块原样（去掉文本显示），不带 id 以外的角色字段（位置、开关、来源）', () => {
    const c = { ...ex.芙莉莲, enabled: false, templateId: 'x', prompt: [{ ...ex.芙莉莲.prompt[0], textMode: true }] }
    const t = templateFromCharacter(c, '芙莉莲')
    expect(t).not.toHaveProperty('enabled')
    expect(t).not.toHaveProperty('center')
    expect(t).not.toHaveProperty('templateId')
    expect(t.prompt[0]).not.toHaveProperty('textMode')
    expect(t.prompt[0].chips).toEqual(ex.芙莉莲.prompt[0].chips)
  })
})

describe('什么算改过（sameCharacterContent）', () => {
  const base = ex.菲伦
  it('性别、区块的增删 / 排序 / 跨正负面 / 开关、tag 算', () => {
    const s = base.prompt[0]
    const extra = { ...s, id: 's2', name: '服装', chips: [] }
    const variants = [
      { ...base, gender: 'male' as const },
      { ...base, prompt: [s, extra] },
      { ...base, prompt: [extra, s] },
      { ...base, prompt: [], uc: [s] },
      { ...base, prompt: [{ ...s, muted: true }] },
      { ...base, prompt: [{ ...s, chips: s.chips.map((x, i) => (i === 0 ? { ...x, weight: 1.2 } : x)) }] },
    ]
    for (const v of variants) expect(sameCharacterContent(base, v)).toBe(false)
  })
  it('名字、颜色、备注、作品、自己的开关、位置、区块的名字 / 颜色 / 备注 / 文本显示不算', () => {
    const s = base.prompt[0]
    const v = { ...base, name: 'x', color: 'pink' as const, note: 'y', work: 'z', enabled: false, center: { x: 0.1, y: 0.2 }, prompt: [{ ...s, name: '外表', color: 'teal' as const, note: 'n', textMode: true }] }
    expect(sameCharacterContent(base, v)).toBe(true)
  })
  it('doc store：改 tag 记成改过、和那次改动同一步撤销；改名字不算', () => {
    const doc = sampleDoc()
    doc.characters[0].templateId = 't-frieren'
    const store = createDocStore(doc)
    const c0 = () => store.getState().doc.characters[0]
    store.getState().updateCharacter(c0().id, { name: '芙莉莲 · 夏装', color: 'pink', work: '别的' })
    expect(c0().templateEdited).toBeUndefined()
    store.getState().adjustWeight([c0().prompt[0].chips[0].id], 0.05)
    expect(c0().templateEdited).toBe(true)
    store.temporal.getState().undo()
    expect(c0().templateEdited).toBeUndefined()
    store.getState().updateCharacter(c0().id, { gender: 'male' })
    expect(c0().templateEdited).toBe(true)
  })
  it('doc store：insertCharacter 插到某个角色后面 / 第 i 个 / 末尾，满 32 个不插', () => {
    const store = createDocStore(sampleDoc())
    const ids = () => store.getState().doc.characters.map((c) => c.name)
    store.getState().insertCharacter(characterFromTemplate(T.himmel), { after: store.getState().doc.characters[0].id })
    expect(ids()).toEqual(['芙莉莲', '辛美尔', '菲伦', '修塔尔克'])
    store.getState().insertCharacter(characterFromTemplate(T.himmel), { index: 0 })
    expect(ids()[0]).toBe('辛美尔')
    store.getState().insertCharacter(characterFromTemplate(T.himmel))
    expect(ids().at(-1)).toBe('辛美尔')
    while (store.getState().doc.characters.length < 32) store.getState().insertCharacter(characterFromTemplate(T.himmel))
    expect(store.getState().insertCharacter(characterFromTemplate(T.himmel))).toBe(false)
  })
})

describe('作品建议、相关角色', () => {
  it('角色 tag：启用区块里、没禁用、正权重的', () => {
    expect(characterTags(ex.芙莉莲, CTX.isCharTag)).toEqual(['frieren'])
    const off = { ...ex.芙莉莲, prompt: [{ ...ex.芙莉莲.prompt[0], muted: true }] }
    expect(characterTags(off, CTX.isCharTag)).toEqual([])
  })
  it('作品建议：按角色 tag 查出来，显示中文名', () => {
    expect(workSuggestions(ex.芙莉莲, CTX)).toEqual([{ label: '葬送的芙莉莲', work: 'sousou no frieren', from: 'frieren' }])
  })
  it('相关角色：只列库里的；同作品优先；文档里已经有的（来自它 / 同一个角色 tag）不列', () => {
    const lib = [T.himmel, T.stark, T.fern, T.frieren]
    const frieren = { ...ex.芙莉莲, templateId: 't-frieren' }
    expect(relatedCharacters(frieren, lib, [frieren], CTX).map((r) => [r.template.name, r.why, r.work])).toEqual([
      ['辛美尔', 'work', '葬送的芙莉莲'],
      ['修塔尔克', 'work', '葬送的芙莉莲'],
      ['菲伦', 'work', '葬送的芙莉莲'],
    ])
    const doc = sampleDoc()
    expect(relatedCharacters(doc.characters[0], lib, doc.characters, CTX).map((r) => r.template.name)).toEqual(['辛美尔'])
  })
  it('相关角色：原创角色（没有角色 tag）按自己填的作品对上', () => {
    const oc = (name: string) => ({ ...ex.辛美尔, name, work: '星之子', prompt: [{ ...ex.辛美尔.prompt[0], chips: ex.辛美尔.prompt[0].chips.slice(1) }] })
    const a = oc('阿星')
    const b = { ...templateFromCharacter(oc('小星'), '小星'), id: 't-b', createdAt: 0 }
    expect(relatedCharacters(a, [b, T.fern], [a], CTX).map((r) => [r.template.name, r.work])).toEqual([['小星', '星之子']])
    expect(relatedCharacters({ ...a, work: undefined }, [b, T.fern], [a], CTX)).toEqual([])
  })
  it('已有作品：模板库 + 文档里填过的，去重排序', () => {
    expect(knownWorks([{ work: '葬送的芙莉莲' }, { work: ' 迷宫饭 ' }, {}], [{ work: '葬送的芙莉莲' }])).toEqual(['葬送的芙莉莲', '迷宫饭'].sort((a, b) => a.localeCompare(b, 'zh')))
  })
})

describe('卡头的名字和作品（characterDisplay）', () => {
  let k = 0
  const chip = (t: string) => {
    const m = t.match(/^(-?[\d.]+)::(.*)::$/)
    return { id: `c${++k}`, text: m ? m[2] : t, type: 'tag' as const, weight: m ? Number(m[1]) : 1, disabled: false }
  }
  const sec = (tags: string, more: Partial<Section> = {}): Section => ({ id: `s${++k}`, name: '外观', color: 'slate', muted: false, chips: tags.split(', ').map(chip), ...more })
  const ch = (name: string, sections: Section[], work?: string) => ({ name, work, prompt: sections })
  const show = (c: Parameters<typeof characterDisplay>[0]) => {
    const d = characterDisplay(c, CTX)
    return [d.name ?? null, d.work ?? null, d.nameFromTag, d.workFromTag]
  }

  it('手填的为准；没填的从第一个角色 tag 读（拼版的 10 种情况）', () => {
    expect(show(ex.芙莉莲)).toEqual(['芙莉莲', '葬送的芙莉莲', false, false])
    expect(show(ch('阿乌拉', [sec('aura (sousou no frieren), sousou no frieren')], '葬送的芙莉莲'))).toEqual(['阿乌拉', '葬送的芙莉莲', false, false])
    expect(show(ch('雪奈', [sec('silver hair, long hair, school uniform')]))).toEqual(['雪奈', null, false, false])
    expect(show(ch('', [sec('hatsune miku, kagamine rin, aqua hair')]))).toEqual(['初音未来', 'VOCALOID', true, true])
    expect(show(ch('师父', [sec('frieren, elf, white hair')]))).toEqual(['师父', '葬送的芙莉莲', false, true])
    expect(show(ch('', [sec('alisa mikhailovna kujou, silver hair')]))).toEqual(['艾莉莎·米哈伊洛夫娜·九条', '不时轻声地以俄语遮羞的邻座艾莉同学', true, true])
    expect(show(ch('', [sec('hatsune miku (cosplay), fern (sousou no frieren), purple hair')]))).toEqual(['菲伦', '葬送的芙莉莲', true, true])
    expect(show(ch('', [sec('hatsune miku (cosplay), brown hair')]))).toEqual([null, null, false, false])
    expect(show(ch('', [sec('frieren')], '同人设定'))).toEqual(['芙莉莲', '同人设定', true, false])
  })

  it('作品：区块里写了这个角色的作品之一就用它，否则图最多的那部', () => {
    expect(works.get('artoria pendragon (fate)')?.slice(0, 2)).toEqual(['fate (series)', 'fate/grand order'])
    expect(show(ch('', [sec('artoria pendragon (fate), blonde hair')]))).toEqual(['阿尔托莉雅·潘德拉贡', 'Fate系列', true, true])
    expect(show(ch('', [sec('artoria pendragon (fate)'), sec('fate/grand order, armor')]))).toEqual(['阿尔托莉雅·潘德拉贡', 'FGO', true, true])
    expect(show(ch('', [sec('frieren, vocaloid')]))).toEqual(['芙莉莲', '葬送的芙莉莲', true, true])
  })

  it('停用的区块、禁用的 tag、负权重的不算；别名按正式写法认；大小写不敏感', () => {
    expect(show(ch('', [sec('frieren', { muted: true }), sec('fern (sousou no frieren)')]))[0]).toBe('菲伦')
    const off = sec('frieren, fern (sousou no frieren)')
    off.chips[0].disabled = true
    expect(show(ch('', [off]))[0]).toBe('菲伦')
    expect(show(ch('', [sec('-1::frieren::, fern (sousou no frieren)')]))[0]).toBe('菲伦')
    expect(show(ch('', [sec('kotiya sanae')]))).toEqual(['东风谷早苗', '东方Project', true, true])
    expect(show(ch('', [sec('Frieren')]))[0]).toBe('芙莉莲')
  })

  it('作品表没到：名字照样读，作品先空着', () => {
    const d = characterDisplay(ch('', [sec('frieren')]), { ...CTX, worksOf: () => [] })
    expect([d.name, d.work, d.workFromTag]).toEqual(['芙莉莲', undefined, false])
  })
})

describe('新建角色模板（templateFromPrompt）', () => {
  const base = { name: '  后藤一里  ', gender: { gender: 'female' as const }, positive: '', negative: '', color: 'rose' as const }
  const asPasted = (text: string) => characterPrompt({ gender: 'other', prompt: [{ id: 'p', name: '', color: 'slate', muted: false, chips: parsePrompt(text).map(toChip) }] })

  it('each box = ONE section (外观 / 负面) in the character color; no splitting; name / note / work trimmed', () => {
    const t = templateFromPrompt({ ...base, gender: { gender: 'other' }, positive: 'pink hair, long hair,\nblue eyes, school uniform', negative: 'bad hands, extra fingers', note: ' 校服 ', work: ' 孤独摇滚！ ', imageKey: 'img:1' })
    expect(t.prompt.map((s) => [s.name, s.color, s.chips.length])).toEqual([['外观', 'rose', 4]])
    expect(t.uc.map((s) => [s.name, s.color, s.chips.map((c) => c.text)])).toEqual([['负面', 'rose', ['bad hands', 'extra fingers']]])
    expect([t.name, t.color, t.note, t.work, t.imageKey]).toEqual(['后藤一里', 'rose', '校服', '孤独摇滚！', 'img:1'])
    expect(new Set([...t.prompt, ...t.uc].flatMap((s) => [s.id, ...s.chips.map((c) => c.id)])).size).toBe(8)
  })

  it('empty positive = an empty 外观 section (like a new character); empty negative = no section', () => {
    const t = templateFromPrompt({ ...base, gender: { gender: 'other' }, negative: ' ,  \n' })
    expect(t.prompt.map((s) => [s.name, s.chips.length])).toEqual([['外观', 0]])
    expect(t.uc).toEqual([])
    expect('note' in t || 'work' in t || 'imageKey' in t || 'genderExtra' in t).toBe(false)
  })

  it('a leading girl / boy matching the chosen gender becomes the gender (dropped); the export reads the same as the paste', () => {
    const paste = 'girl, gotoh hitori (bocchi the rock!), pink hair'
    const t = templateFromPrompt({ ...base, positive: paste })
    expect(t.gender).toBe('female')
    expect(t.prompt[0].chips.map((c) => c.text)).toEqual(['gotoh hitori (bocchi the rock!)', 'pink hair'])
    expect(characterPrompt(t)).toBe(asPasted(paste))
    expect(templateFromPrompt({ ...base, gender: { gender: 'male' }, positive: 'boy, short hair' }).prompt[0].chips.map((c) => c.text)).toEqual(['short hair'])
  })

  it('a leading girl that does not match the chosen gender stays a chip; girl elsewhere / weighted / 1girl are not the gender', () => {
    const chips = (gender: 'female' | 'male' | 'other', positive: string) => templateFromPrompt({ ...base, gender: { gender }, positive }).prompt[0].chips.map((c) => c.text)
    expect(chips('male', 'girl, long hair')).toEqual(['girl', 'long hair'])
    expect(chips('other', 'girl, long hair')).toEqual(['girl', 'long hair'])
    expect(chips('female', 'long hair, girl')).toEqual(['long hair', 'girl'])
    expect(chips('female', '1.2::girl::, long hair')).toEqual(['girl', 'long hair'])
    expect(chips('female', '1girl, long hair')).toEqual(['1girl', 'long hair'])
  })

  it('extended gender: girl + its tags right after are dropped together', () => {
    const futa = { gender: 'female' as const, genderExtra: { name: '扶她', tags: ['futanari'] } }
    const paste = 'girl, futanari, long hair'
    const t = templateFromPrompt({ ...base, gender: futa, positive: paste })
    expect([t.gender, t.genderExtra]).toEqual(['female', futa.genderExtra])
    expect(t.prompt[0].chips.map((c) => c.text)).toEqual(['long hair'])
    expect(characterPrompt(t)).toBe(asPasted(paste))
  })

  it('weights, artist: and other prefixes stay as chips the way a paste parses them', () => {
    const t = templateFromPrompt({ ...base, gender: { gender: 'other' }, positive: '1.2::school uniform::, {smile}, artist:hiroe rei, (blush:1.1), long_hair' })
    expect(t.prompt[0].chips.map((c) => [c.text, c.type, Math.round(c.weight * 1000) / 1000])).toEqual([
      ['school uniform', 'tag', 1.2],
      ['smile', 'tag', 1.05],
      ['hiroe rei', 'artist', 1],
      ['blush', 'tag', 1.1],
      ['long hair', 'tag', 1],
    ])
  })
})
