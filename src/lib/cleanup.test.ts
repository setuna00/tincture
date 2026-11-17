import { describe, expect, it, vi } from 'vitest'
import { defaultSettings } from '@/store/doc'
import type { Doc, DocSettings, Section } from '@/types'
import { aliasFixes, naiDupChips } from './cleanup'
import { parsePrompt, toChip } from './nai'

vi.mock('./tagdb', () => {
  const official: Record<string, string> = { smile: 'general', 'blonde hair': 'general', 'genshin impact': 'copyright', hug: 'general', '1girl': 'general', lowres: 'general', masterpiece: 'meta' }
  const alias: Record<string, string> = { smiling: 'smile', blond: 'blonde hair', genshin: 'genshin impact', hugging: 'hug' }
  return {
    lookupTag: (n: string) => (official[n.toLowerCase()] ? { name: n.toLowerCase(), category: official[n.toLowerCase()] } : undefined),
    aliasOf: (n: string) => alias[n.toLowerCase()],
  }
})

let n = 0
const section = (text: string, o: Partial<Section> = {}): Section => ({ id: `s${n++}`, name: '区块', color: 'slate', muted: false, chips: parsePrompt(text).map(toChip), ...o })
function doc(o: { prompt?: Section[]; uc?: Section[]; char?: Section[]; s?: Partial<DocSettings> }): Doc {
  return {
    base: { prompt: o.prompt ?? [], uc: o.uc ?? [] },
    characters: o.char ? [{ id: 'c0', name: '', gender: 'other', color: 'slate', prompt: o.char, uc: [], enabled: true, center: { x: 0.5, y: 0.5 } }] : [],
    settings: { ...defaultSettings(), ...o.s },
    meta: { title: 't', createdAt: 0 },
  }
}

describe('aliasFixes：别名换成正式写法', () => {
  it('整份文档的别名都换，类型跟着（互动还是互动）；官方 tag、未识别的不动', () => {
    const off = section('blond')
    off.chips[0].disabled = true
    const d = doc({ prompt: [section('smiling, 1.2::blond::, rim lighting, smile, genshin')], uc: [off], char: [section('girl, mutual#hugging')] })
    expect(aliasFixes(d, {}).map((f) => `${f.from}→${f.to}:${f.type}`)).toEqual(['smiling→smile:tag', 'blond→blonde hair:tag', 'genshin→genshin impact:tag', 'blond→blonde hair:tag', 'hugging→hug:interaction'])
  })
  it('存过的自定义写法不算别名', () => {
    const d = doc({ prompt: [section('blond, smiling')] })
    expect(aliasFixes(d, { 'blonde hair': ['blond'] }).map((f) => f.from)).toEqual(['smiling'])
  })
})

describe('naiDupChips：和 NAI 会加的重复的', () => {
  it('质量标签 / UC 预设：权重 1 的去掉，带权重的、禁用的、静音区块里的、角色框里的不动', () => {
    const off = section('masterpiece')
    off.chips[0].disabled = true
    const d = doc({
      prompt: [section('1girl, very aesthetic, 1.2::masterpiece::'), off, section('masterpiece', { muted: true })],
      uc: [section('lowres, bad anatomy, -1::monochrome::')],
      char: [section('masterpiece')],
    })
    expect(naiDupChips(d).map((c) => c.text)).toEqual(['very aesthetic', 'lowres'])
  })
  it('预设关掉就不算重复；区块之间互相重复的不管', () => {
    const d = doc({ prompt: [section('very aesthetic, smile'), section('smile')], uc: [section('lowres')], s: { qualityTags: 'none', ucPreset: 'none' } })
    expect(naiDupChips(d)).toEqual([])
  })
})
