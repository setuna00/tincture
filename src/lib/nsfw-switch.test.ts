import { describe, expect, it } from 'vitest'
import { defaultSettings } from '@/store/doc'
import type { Doc, DocSettings, Section } from '@/types'
import { basePrompt, baseTokens, exportDoc, exportString, parsePrompt, toChip } from './nai'
import { UC_PRESET_TEXT, buildImportedDoc, defaultPicks, importSections, parseNaiImage, takeNsfw } from './nai-image'
import { dupIndex, lengthPlan, naiAdditions } from './nai-length'
import { naiComment, naiMetadata } from './nai-write'

const STANDARD = 'very aesthetic, masterpiece, no text'
const HEAVY = UC_PRESET_TEXT.heavy

let n = 0
const section = (name: string, text: string, o: Partial<Section> = {}): Section => ({ id: `s${n++}`, name, color: 'slate', muted: false, chips: parsePrompt(text).map(toChip), ...o })
const doc = (o: { prompt?: Section[]; uc?: Section[]; s?: Partial<DocSettings> }): Doc => ({
  base: { prompt: o.prompt ?? [], uc: o.uc ?? [] },
  characters: [],
  settings: { ...defaultSettings(), ...o.s },
  meta: { title: 't', createdAt: 0 },
})

describe('导出', () => {
  it('开着：正面最前面加 nsfw（权重 1）；关着、没写（旧文档）不加', () => {
    const p = [section('主体', '1girl, 1.2::smile::')]
    expect(basePrompt(doc({ prompt: p, s: { nsfw: true } }))).toBe('nsfw, 1girl, 1.2::smile::')
    expect(basePrompt(doc({ prompt: p, s: { nsfw: false } }))).toBe('1girl, 1.2::smile::')
    const old = doc({ prompt: p })
    delete old.settings.nsfw
    expect(basePrompt(old)).toBe('1girl, 1.2::smile::')
    expect(basePrompt(doc({ s: { nsfw: true } }))).toBe('nsfw')
  })
  it('导出栏的正面框：第一个 token 标了 nsfw，复制的文本包含它；中文对照页照样翻译', () => {
    const d = doc({ prompt: [section('主体', '1girl')], s: { nsfw: true } })
    const box = exportDoc(d).find((b) => b.key === 'base.prompt')!
    expect(box.text).toBe('nsfw, 1girl')
    expect(box.tokens[0]).toMatchObject({ k: 'tag', t: 'nsfw', lit: 'nsfw', nsfw: true })
    expect(baseTokens(d, { translate: (c) => `「${c.text}」` })[0]).toMatchObject({ t: '「nsfw」', lit: 'nsfw', nsfw: true })
  })
  it('Text: 照旧在最后', () => {
    expect(basePrompt(doc({ prompt: [section('字', 'Text: Hi'), section('主体', '1girl')], s: { nsfw: true } }))).toBe('nsfw, 1girl, Text: Hi')
  })
})

describe('NAI 元数据（复制为 NAI 图 / JSON）', () => {
  it('开着：正面带 nsfw，负面不再加 nsfw', () => {
    const c = naiComment(doc({ prompt: [section('主体', '1girl')], uc: [section('负面', 'bad hands')], s: { nsfw: true } }))
    expect(c.prompt).toBe(`nsfw, 1girl, ${STANDARD}`)
    expect(c.v4_prompt.caption.base_caption).toBe(c.prompt)
    expect(c.uc).toBe(`${HEAVY}, bad hands`)
  })
  it('关着：负面开头 NAI 加 nsfw（就是这一轮要解决的）', () => {
    const c = naiComment(doc({ prompt: [section('主体', '1girl')], s: { nsfw: false } }))
    expect(c.uc.startsWith('nsfw, ')).toBe(true)
  })
  it('Furry：fur dataset 在 nsfw 前面（NAI 最后才加前缀）', () => {
    expect(naiComment(doc({ prompt: [section('主体', 'wolf')], s: { nsfw: true, mode: 'furry' } })).prompt).toBe(`fur dataset, nsfw, wolf, ${STANDARD}`)
  })
})

describe('长度 / 灰字 / 重复', () => {
  it('长度：数的正面带 nsfw；环形图最前面一段「NSFW」', () => {
    const p = lengthPlan(doc({ prompt: [section('主体', '1girl')], s: { nsfw: true } }))
    expect(p.boxes[0].text).toBe(`nsfw, 1girl, ${STANDARD}`)
    expect(p.boxes[0].parts.map((x) => x.name)).toEqual(['NSFW', '主体', 'NAI 追加'])
    expect(p.boxes[0].parts[0]).toMatchObject({ nsfw: true, color: null, text: 'nsfw' })
    expect(p.boxes[1].text).toBe(HEAVY)
  })
  it('灰字：负面不再有 nsfw，只剩 UC 预设；正面的质量标签位置按带 nsfw 的串', () => {
    const a = naiAdditions(doc({ prompt: [section('主体', '1girl')], s: { nsfw: true } }))
    expect(a.uc).toEqual([{ at: 0, text: HEAVY, label: 'UC 预设 Heavy' }])
    expect(a.prompt).toEqual([{ at: 'nsfw, 1girl'.length, text: `, ${STANDARD}`, label: '质量预设 Standard' }])
  })
  it('重复：区块里又写了 nsfw = 和「NSFW」重复（只提示）；关着时不算', () => {
    const s = section('主体', 'nsfw, 1girl')
    expect(dupIndex(doc({ prompt: [s], s: { nsfw: true } })).chips.get(s.chips[0].id)).toEqual(['NSFW'])
    expect(dupIndex(doc({ prompt: [s], s: { nsfw: true } })).boxes.get('base.prompt')!.groups[0]).toMatchObject({ key: 'nsfw', places: ['主体', 'NSFW'] })
    expect(dupIndex(doc({ prompt: [s], s: { nsfw: false } })).chips.has(s.chips[0].id)).toBe(false)
  })
})

describe('takeNsfw：正面开头的 nsfw 认成开关', () => {
  const texts = (list: Section[]) => list.map((s) => exportString([s]))
  it('第一个导出的 tag 是 nsfw（权重 1，大小写不管）：去掉', () => {
    expect(takeNsfw(importSections('nsfw, 1girl'))).toMatchObject({ nsfw: true })
    expect(texts(takeNsfw(importSections('NSFW, 1girl')).sections)).toEqual(['1girl'])
  })
  it('带权重、不在第一个、写成别的：不认', () => {
    for (const t of ['1.2::nsfw::, 1girl', '1girl, nsfw', '{nsfw}, 1girl', 'no nsfw, 1girl', '']) expect(takeNsfw(importSections(t)).nsfw).toBe(false)
  })
  it('停用的区块、禁用的 tag 跳过；区块去掉它以后空了就不要', () => {
    const muted = section('静音', 'smile', { muted: true })
    const off = section('禁用', 'smile')
    off.chips[0].disabled = true
    const only = section('只有它', 'nsfw')
    const rest = section('主体', '1girl')
    const r = takeNsfw([muted, off, only, rest])
    expect(r.nsfw).toBe(true)
    expect(r.sections.map((s) => s.name)).toEqual(['静音', '禁用', '主体'])
  })
})

describe('从 NAI 图导入', () => {
  const written = (s: Partial<DocSettings>) => parseNaiImage(naiMetadata(doc({ prompt: [section('主体', '1girl, smile')], s })))
  it('写出去再读回来：开着 → 开关打开、区块里没有 nsfw，导出一字不差', () => {
    const p = written({ nsfw: true })
    expect(p.prompt).toBe('nsfw, 1girl, smile')
    const { doc: d } = buildImportedDoc(p, defaultPicks(p), { base: null, appendChars: false, nsfw: true }, defaultSettings())
    expect(d.settings.nsfw).toBe(true)
    expect(exportString(d.base.prompt)).toBe('1girl, smile')
    expect(basePrompt(d)).toBe('nsfw, 1girl, smile')
  })
  it('「显示 NSFW 内容」关着：不认，nsfw 照旧是区块里的一个 tag', () => {
    const p = written({ nsfw: true })
    const { doc: d } = buildImportedDoc(p, defaultPicks(p), { base: null, appendChars: false, nsfw: false }, defaultSettings())
    expect(d.settings.nsfw).toBe(false)
    expect(exportString(d.base.prompt)).toBe('nsfw, 1girl, smile')
  })
  it('开关跟着正面走：导入当前文档时正面开头没有 nsfw 就关掉（不看「设置」勾）；不勾正面就不动', () => {
    const p = written({ nsfw: false })
    const base = doc({ prompt: [section('旧', 'x')], s: { nsfw: true } })
    const picks = defaultPicks(p)
    for (const it of ['mode', 'quality', 'coords', 'model', 'size', 'steps', 'scale', 'rescale', 'sampler'] as const) picks.delete(it)
    expect(buildImportedDoc(p, picks, { base, appendChars: false, nsfw: true }, defaultSettings()).doc.settings.nsfw).toBe(false)
    picks.delete('prompt')
    expect(buildImportedDoc(p, picks, { base, appendChars: false, nsfw: true }, defaultSettings()).doc.settings.nsfw).toBe(true)
  })
})
