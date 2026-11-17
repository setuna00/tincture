import { describe, expect, it } from 'vitest'
import { defaultSettings } from '@/store/doc'
import type { Doc, DocSettings, Gender, Section } from '@/types'
import { exportString, parsePrompt, toChip } from './nai'
import { UC_PRESET_TEXT } from './nai-image'
import { NAI_TOKEN_LIMIT, dupIndex, insertion, lengthPlan, naiAdditions, scaleParts } from './nai-length'
import { composePrompt, composeUc } from './nai-write'

const STANDARD = 'very aesthetic, masterpiece, no text'
const HEAVY = UC_PRESET_TEXT.heavy

let n = 0
const section = (name: string, text: string, o: Partial<Section> = {}): Section => ({
  id: `s${n++}`,
  name,
  color: 'slate',
  muted: false,
  chips: parsePrompt(text).map(toChip),
  ...o,
})
function doc(o: { prompt?: Section[]; uc?: Section[]; chars?: { prompt?: Section[]; uc?: Section[]; enabled?: boolean; name?: string; gender?: Gender }[]; s?: Partial<DocSettings> }): Doc {
  return {
    base: { prompt: o.prompt ?? [], uc: o.uc ?? [] },
    characters: (o.chars ?? []).map((c, i) => ({ id: `c${i}`, name: c.name ?? '', gender: c.gender ?? 'other', color: 'slate', prompt: c.prompt ?? [], uc: c.uc ?? [], enabled: c.enabled ?? true, center: { x: 0.5, y: 0.5 } })),
    settings: { ...defaultSettings(), ...o.s },
    meta: { title: 't', createdAt: 0 },
  }
}

describe('insertion：composed 比 orig 多插了哪一段', () => {
  it('加在后面', () => {
    expect(insertion('1girl', `1girl, ${STANDARD}`, 'start')).toEqual({ at: 5, text: `, ${STANDARD}` })
    expect(insertion('', STANDARD, 'start')).toEqual({ at: 0, text: STANDARD })
    expect(insertion('x, no text', `x, no text, ${STANDARD}`, 'start')).toEqual({ at: 10, text: `, ${STANDARD}` })
  })
  it('插在 Text: 前面', () => {
    const orig = '1girl, Text: Hi, you'
    const c = composePrompt(orig, defaultSettings())
    const ins = insertion(orig, c, 'start')!
    expect(orig.slice(0, ins.at) + ins.text + orig.slice(ins.at)).toBe(c)
    expect(orig.slice(ins.at)).toBe(' Text: Hi, you')
  })
  it('加在前面（UC）：原串开头和预设一样时也认在前面', () => {
    expect(insertion('lowres, bad', `nsfw, ${HEAVY}, lowres, bad`, 'end')).toEqual({ at: 0, text: `nsfw, ${HEAVY}, ` })
    expect(insertion('nsfw, lowres', `nsfw, ${HEAVY}, nsfw, lowres`, 'end')).toEqual({ at: 0, text: `nsfw, ${HEAVY}, ` })
  })
  it('不是单纯插一段 → null', () => {
    expect(insertion('abc', 'abc', 'start')).toBeNull()
    expect(insertion('abc', 'xbcd', 'start')).toBeNull()
  })
})

describe('naiAdditions（灰字）', () => {
  it('质量在末尾、UC 预设和 nsfw 在开头', () => {
    const d = doc({ prompt: [section('主体', '1girl, smile')], uc: [section('负面', 'bad hands')] })
    const a = naiAdditions(d)
    expect(a.prompt).toEqual([{ at: '1girl, smile'.length, text: `, ${STANDARD}`, label: '质量预设 Standard' }])
    expect(a.uc).toEqual([{ at: 0, text: `nsfw, ${HEAVY}, `, label: 'nsfw + UC 预设 Heavy' }])
  })
  it('Furry 前缀单独一段在最前；透明背景并进质量那段', () => {
    const d = doc({ prompt: [section('主体', 'wolf')], s: { mode: 'furry', transparent: true } })
    const a = naiAdditions(d)
    expect(a.prompt[0]).toEqual({ at: 0, text: 'fur dataset, ', label: 'Furry 模式' })
    expect(a.prompt[1]).toEqual({ at: 4, text: `, transparent background, ${STANDARD}`, label: '透明背景 + 质量预设 Standard' })
  })
  it('都是 None：什么都不加', () => {
    const d = doc({ prompt: [section('主体', '1girl')], uc: [section('负面', 'lowres')], s: { qualityTags: 'none', ucPreset: 'none' } })
    expect(naiAdditions(d)).toEqual({ prompt: [], uc: [] })
  })
  it('Curated 不加 nsfw；正面里有 nsfw 也不加', () => {
    expect(naiAdditions(doc({ s: { model: 'v5-curated' } })).uc[0].text).toBe(HEAVY)
    expect(naiAdditions(doc({ prompt: [section('主体', 'nsfw, 1girl')] })).uc[0].label).toBe('UC 预设 Heavy')
  })
})

describe('lengthPlan', () => {
  it('上限按模型；数的文本 = composePrompt（不带 Furry 前缀）/ composeUc', () => {
    const d = doc({ prompt: [section('主体', '1girl')], uc: [section('负面', 'bad hands')], s: { mode: 'furry' } })
    const p = lengthPlan(d)
    expect(p.limit).toBe(NAI_TOKEN_LIMIT['v5-full'])
    expect(p.boxes[0].text).toBe(composePrompt('1girl', { ...d.settings, mode: 'anime' }))
    expect(p.boxes[0].text.startsWith('fur dataset')).toBe(false)
    expect(p.boxes[1].text).toBe(composeUc('bad hands', d.settings, `1girl, ${STANDARD}`))
    expect(lengthPlan(doc({ s: { model: 'v5-curated' } })).limit).toBe(703)
  })
  it('构成：每个有内容的区块一段 + NAI 追加；没启用的角色不算', () => {
    const d = doc({
      prompt: [section('主体', '1girl'), section('空', ''), section('静音', 'x', { muted: true }), section('质量', 'masterpiece')],
      chars: [{ prompt: [section('外观', 'white hair')], name: '芙莉莲' }, { prompt: [section('外观', 'black hair')], enabled: false }],
    })
    const p = lengthPlan(d)
    expect(p.boxes[0].parts.map((x) => x.name)).toEqual(['主体', '质量', 'NAI 追加'])
    expect(p.boxes[1].parts.map((x) => x.name)).toEqual(['NAI 追加'])
    expect(p.boxes.map((b) => b.key)).toEqual(['base.prompt', 'base.uc', 'c0.prompt', 'c0.uc'])
    expect(p.boxes[2]).toMatchObject({ name: '角色 1 芙莉莲', text: exportString(d.characters[0].prompt) })
  })
  it('scaleParts：加起来正好等于总数', () => {
    expect(scaleParts([10, 20, 30], 61)).toEqual([10, 20, 31])
    expect(scaleParts([1, 1, 1], 10).reduce((a, b) => a + b)).toBe(10)
    expect(scaleParts([0, 0], 5)).toEqual([0, 0])
  })
})

describe('dupIndex（重复）', () => {
  it('区块和预设：示例文档的质量区块、通用负面', () => {
    const q = section('质量', 'very aesthetic, 1.2::masterpiece::, high complexity')
    const u = section('通用负面', 'lowres, bad hands, JPEG_artifacts')
    const d = doc({ prompt: [q], uc: [u] })
    const idx = dupIndex(d)
    expect(idx.chips.get(q.chips[0].id)).toEqual(['质量预设 Standard'])
    expect(idx.chips.get(q.chips[1].id)).toEqual(['质量预设 Standard'])
    expect(idx.chips.has(q.chips[2].id)).toBe(false)
    expect(idx.chips.get(u.chips[0].id)).toEqual(['UC 预设 Heavy'])
    expect(idx.chips.get(u.chips[2].id)).toEqual(['UC 预设 Heavy'])
    expect(idx.boxes.get('base.prompt')!.groups).toMatchObject([
      { tag: 'very aesthetic', key: 'very aesthetic', places: ['质量', '质量预设 Standard'] },
      { tag: 'masterpiece', key: 'masterpiece', places: ['质量', '质量预设 Standard'] },
    ])
  })
  it('区块和区块、同一区块两次', () => {
    const a = section('主体', 'smile, Smile')
    const b = section('表情', 'smile')
    const idx = dupIndex(doc({ prompt: [a, b], s: { qualityTags: 'none' } }))
    expect(idx.chips.get(a.chips[0].id)).toEqual(['本区块', '表情'])
    expect(idx.chips.get(b.chips[0].id)).toEqual(['主体'])
    expect(idx.boxes.get('base.prompt')!.groups[0].places).toEqual(['主体', '表情'])
  })
  it('静音、禁用、Text: 不算；不同的框之间不算；没启用的角色不算', () => {
    const a = section('主体', 'smile, Text: smile')
    const m = section('静音', 'smile', { muted: true })
    const dis = section('禁用', 'smile')
    dis.chips[0].disabled = true
    const d = doc({ prompt: [a, m, dis], uc: [section('负面', 'smile')], chars: [{ prompt: [section('外观', 'smile, smile')], enabled: false }], s: { qualityTags: 'none' } })
    const idx = dupIndex(d)
    expect(idx.chips.size).toBe(0)
    expect(idx.boxes.size).toBe(0)
  })
  it('角色框自己里面的重复', () => {
    const c = section('外观', 'white hair, long hair, white hair')
    const idx = dupIndex(doc({ chars: [{ prompt: [c] }] }))
    expect(idx.chips.get(c.chips[0].id)).toEqual(['本区块'])
    expect(idx.boxes.get('c0.prompt')!.groups[0].tag).toBe('white hair')
  })
  it('用户自己写了 nsfw、透明背景', () => {
    const u = section('负面', 'nsfw')
    const p = section('主体', 'transparent background')
    const idx = dupIndex(doc({ prompt: [p], uc: [u], s: { transparent: true } }))
    expect(idx.chips.get(u.chips[0].id)).toEqual(['nsfw（NAI 自动添加）'])
    expect(idx.chips.get(p.chips[0].id)).toEqual(['透明背景'])
  })
  it('同一版文档只算一次', () => {
    const d = doc({ prompt: [section('质量', 'masterpiece')] })
    expect(dupIndex(d)).toBe(dupIndex(d))
  })
})
