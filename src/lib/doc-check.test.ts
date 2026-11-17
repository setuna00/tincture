import { describe, expect, it, vi } from 'vitest'
import { defaultSettings } from '@/store/doc'
import type { Character, Doc, DocSettings, Section } from '@/types'
import { checkDocument, withSimilar } from './doc-check'
import { parsePrompt, toChip } from './nai'

const match = vi.hoisted(() => vi.fn())
vi.mock('./tagdb', () => {
  const official: Record<string, string> = {
    smile: 'general',
    'hair ornament': 'general',
    'long hair': 'general',
    twintail: 'general',
    twintails: 'general',
    hug: 'general',
    '1girl': 'general',
    girl: 'general',
    lowres: 'general',
    masterpiece: 'meta',
    'very aesthetic': 'meta',
    'blonde hair': 'general',
  }
  const alias: Record<string, string> = { smiling: 'smile', blond: 'blonde hair', hugging: 'hug' }
  return {
    lookupTag: (n: string) => (official[n.toLowerCase()] ? { name: n.toLowerCase(), category: official[n.toLowerCase()] } : undefined),
    aliasOf: (n: string) => alias[n.toLowerCase()],
    matchTags: match,
  }
})

let n = 0
const section = (name: string, text: string, o: Partial<Section> = {}): Section => ({ id: `s${n++}`, name, color: 'slate', muted: false, chips: parsePrompt(text).map(toChip), ...o })
const character = (o: Partial<Character>): Character => ({ id: `ch${n++}`, name: '', gender: 'other', color: 'slate', prompt: [], uc: [], enabled: true, center: { x: 0.5, y: 0.5 }, ...o })
function doc(o: { prompt?: Section[]; uc?: Section[]; chars?: Character[]; s?: Partial<DocSettings> }): Doc {
  return {
    base: { prompt: o.prompt ?? [], uc: o.uc ?? [] },
    characters: o.chars ?? [],
    settings: { ...defaultSettings(), qualityTags: 'none', ucPreset: 'none', ...o.s },
    meta: { title: 't', createdAt: 0 },
  }
}
const ctx = (o: { variants?: Record<string, string[]>; renamed?: [string, string][] } = {}) => ({ variants: o.variants ?? {}, renamedTo: new Map(o.renamed ?? [['twintail', 'twintails']]) })

describe('checkDocument: unknown', () => {
  it('a misspelling, with its place: section id / name, box, character', () => {
    const main = section('外观', 'long hair, hair ornamant')
    const fern = section('外观', 'cheery blossoms')
    const d = doc({ prompt: [main], chars: [character({ id: 'chF', name: '菲伦', prompt: [fern] })] })
    const r = checkDocument(d, ctx())
    expect(r.unknown).toMatchObject([
      { tag: 'hair ornamant', text: 'hair ornamant', chipId: main.chips[1].id, sectionId: main.id, sectionName: '外观', field: 'prompt', weight: 1, disabled: false },
      { tag: 'cheery blossoms', sectionId: fern.id, field: 'prompt', character: { id: 'chF', name: '菲伦' } },
    ])
    expect(r.unknown[0].character).toBeUndefined()
  })

  it('sentences, artists, years, meta and Text: are never unknown; neither are saved custom spellings', () => {
    const s = section('场景', 'a girl sitting by the window looking at the rain')
    s.chips.push(...parsePrompt('rain on glass., artist:nobody here, year 2024, meta:whatever, blondy, Text: hello wrold').map(toChip))
    const d = doc({ prompt: [s] })
    expect(s.chips.map((c) => c.type)).toEqual(['text', 'text', 'artist', 'year', 'meta', 'tag', 'textrender'])
    expect(checkDocument(d, ctx({ variants: { 'blonde hair': ['blondy'] } })).unknown).toEqual([])
    expect(checkDocument(d, ctx()).unknown.map((u) => u.tag)).toEqual(['blondy'])
  })

  it('weight, switched-off chips, the uc, muted sections and characters all count (it is about how a tag is written)', () => {
    const p = section('主体', '1.2::hair ornamant::, mutual#hugg')
    p.chips[1].disabled = true
    const u = section('负面', 'lowress')
    const m = section('静音', 'smille', { muted: true })
    const off = character({ name: '', enabled: false, uc: [section('角色负面', 'bad handz')] })
    const r = checkDocument(doc({ prompt: [p, m], uc: [u], chars: [off] }), ctx())
    expect(r.unknown.map((x) => [x.tag, x.text, x.weight, x.disabled, x.field, x.character?.name ?? ''])).toEqual([
      ['hair ornamant', 'hair ornamant', 1.2, false, 'prompt', ''],
      ['mutual#hugg', 'hugg', 1, true, 'prompt', ''],
      ['smille', 'smille', 1, false, 'prompt', ''],
      ['lowress', 'lowress', 1, false, 'uc', ''],
      ['bad handz', 'bad handz', 1, false, 'uc', '角色 1'],
    ])
  })
})

describe('checkDocument: alias and old name', () => {
  it('aliases → official name; old names → new name, reported as old_name and not as unknown or alias', () => {
    const s = section('主体', 'smiling, twintail, twintails, mutual#hugging')
    const r = checkDocument(doc({ prompt: [s] }), ctx())
    expect(r.alias.map((x) => [x.tag, x.official, x.sectionId])).toEqual([
      ['smiling', 'smile', s.id],
      ['mutual#hugging', 'hug', s.id],
    ])
    expect(r.oldName.map((x) => [x.tag, x.newName, x.sectionId])).toEqual([['twintail', 'twintails', s.id]])
    expect(r.unknown).toEqual([])
  })
})

describe('checkDocument: duplicate and nai_duplicate', () => {
  it('the same tag in two sections of one box, or twice in one section: one group with each copy', () => {
    const a = section('主体', 'smile, long hair, Long_Hair')
    const b = section('表情', '1.1::smile::')
    const r = checkDocument(doc({ prompt: [a, b] }), ctx())
    expect(r.duplicate.map((g) => [g.tag, g.copies.map((c) => `${c.sectionName}:${c.tag}:${c.weight}`)])).toEqual([
      ['smile', ['主体:smile:1', '表情:smile:1.1']],
      ['long hair', ['主体:long hair:1', '主体:Long Hair:1']],
    ])
    expect(r.naiDuplicate).toEqual([])
  })

  it('different boxes are not duplicates; muted sections and switched-off chips are left out (as in the editor)', () => {
    const a = section('主体', 'smile, lowres')
    const off = section('表情', 'smile')
    off.chips[0].disabled = true
    const m = section('静音', 'smile', { muted: true })
    const r = checkDocument(doc({ prompt: [a, off, m], uc: [section('负面', 'smile')], chars: [character({ prompt: [section('角色', 'smile')] })] }), ctx())
    expect(r.duplicate).toEqual([])
  })

  it('against what is added automatically: quality / UC preset, the NSFW switch, a character’s gender; weighted ones too', () => {
    const q = section('质量', 'very aesthetic, 1.2::masterpiece::, nsfw')
    const u = section('负面', 'lowres')
    const girl = section('角色', 'girl, smile')
    const d = doc({ prompt: [q], uc: [u], chars: [character({ id: 'chA', name: '芙莉莲', gender: 'female', prompt: [girl] })], s: { qualityTags: 'standard', ucPreset: 'heavy', nsfw: true } })
    const r = checkDocument(d, ctx())
    expect(r.naiDuplicate.map((x) => [x.tag, x.weight, x.addedBy, x.character?.name ?? x.field])).toEqual([
      ['very aesthetic', 1, ['质量预设 Standard'], 'prompt'],
      ['masterpiece', 1.2, ['质量预设 Standard'], 'prompt'],
      ['nsfw', 1, ['NSFW'], 'prompt'],
      ['lowres', 1, ['UC 预设 Heavy'], 'uc'],
      ['girl', 1, ['性别 女'], '芙莉莲'],
    ])
    expect(r.duplicate).toEqual([])
  })

  it('both at once: two copies of the user’s and one from the preset', () => {
    const a = section('质量', 'masterpiece')
    const b = section('风格', 'masterpiece')
    const r = checkDocument(doc({ prompt: [a, b], s: { qualityTags: 'standard' } }), ctx())
    expect(r.duplicate.map((g) => g.copies.map((c) => c.sectionId))).toEqual([[a.id, b.id]])
    expect(r.naiDuplicate.map((x) => [x.sectionId, x.addedBy])).toEqual([
      [a.id, ['质量预设 Standard']],
      [b.id, ['质量预设 Standard']],
    ])
  })
})

describe('withSimilar', () => {
  it('close library spellings per unknown word (one search per word, artists with artist:)', async () => {
    match.mockReset()
    match.mockImplementation(async (q: string, limit: number) =>
      q === 'hair ornamant' ? [{ tag: { name: 'hair ornament', category: 'general' } }, { tag: { name: 'hair ornamant fan', category: 'artist' } }].slice(0, limit) : [],
    )
    const d = doc({ prompt: [section('外观', 'hair ornamant, zzqq'), section('其他', 'Hair Ornamant')] })
    const r = await withSimilar(checkDocument(d, ctx()))
    expect(r.unknown.map((u) => [u.tag, u.similar])).toEqual([
      ['hair ornamant', ['hair ornament', 'artist:hair ornamant fan']],
      ['zzqq', []],
      ['Hair Ornamant', ['hair ornament', 'artist:hair ornamant fan']],
    ])
    expect(match.mock.calls).toEqual([
      ['hair ornamant', 5],
      ['zzqq', 5],
    ])
  })
})
