import { describe, expect, it } from 'vitest'
import { defaultSettings } from '@/store/doc'
import type { Doc, DocSettings, Gender, Section } from '@/types'
import { exportString, parsePrompt, toChip } from './nai'
import { UC_PRESET_TEXT, buildImportedDoc, decodeStealthAlpha, defaultPicks, importItems, parseNaiImage, type ImportItem } from './nai-image'
import { composePrompt, composeUc, effectiveSettings, naiComment, naiMetadata, stealthPayload, writeStealthAlpha } from './nai-write'

const STANDARD = 'very aesthetic, masterpiece, no text'
const LIGHT = 'very aesthetic, amazing quality, no text'
const HEAVY = UC_PRESET_TEXT.heavy
const settings = (p: Partial<DocSettings> = {}): DocSettings => ({ ...defaultSettings(), ...p })
const sec = (text: string): Section[] => {
  const chips = parsePrompt(text).map(toChip)
  return chips.length ? [{ id: 's', name: 's', color: 'slate', muted: false, chips }] : []
}

interface CharIn {
  prompt: string
  uc?: string
  center?: { x: number; y: number }
  enabled?: boolean
  gender?: Gender
}
function doc(o: { prompt?: string; uc?: string; chars?: CharIn[]; s?: Partial<DocSettings> }): Doc {
  return {
    base: { prompt: sec(o.prompt ?? ''), uc: sec(o.uc ?? '') },
    characters: (o.chars ?? []).map((c, i) => ({ id: `c${i}`, name: '', gender: c.gender ?? 'other', color: 'slate', prompt: sec(c.prompt), uc: sec(c.uc ?? ''), enabled: c.enabled ?? true, center: c.center ?? { x: 0.5, y: 0.5 } })),
    settings: settings(o.s),
    meta: { title: 't', createdAt: 0 },
  }
}

describe('composePrompt（照 NAI 出图时）', () => {
  it('质量标签接在末尾', () => {
    expect(composePrompt('1girl, smile', settings())).toBe(`1girl, smile, ${STANDARD}`)
    expect(composePrompt('1girl', settings({ qualityTags: 'light' }))).toBe(`1girl, ${LIGHT}`)
    expect(composePrompt('1girl', settings({ qualityTags: 'none' }))).toBe('1girl')
    expect(composePrompt('', settings())).toBe(STANDARD)
  })
  it('透明背景在质量标签前面；质量 None 时就它一个', () => {
    expect(composePrompt('1girl', settings({ transparent: true }))).toBe(`1girl, transparent background, ${STANDARD}`)
    expect(composePrompt('1girl', settings({ transparent: true, qualityTags: 'none' }))).toBe('1girl, transparent background')
  })
  it('有 Text: 时接在它前面那段末尾（NAI 按 Text: 切开，第一段加完再按原样接回去）', () => {
    expect(composePrompt('1girl, Text: Hi, you', settings())).toBe(`1girl,, ${STANDARD} Text: Hi, you`)
  })
  it('Furry 在质量标签之后加前缀；已经有了不重复', () => {
    expect(composePrompt('1girl', settings({ mode: 'furry' }))).toBe(`fur dataset, 1girl, ${STANDARD}`)
    expect(composePrompt('', settings({ mode: 'furry' }))).toBe(`fur dataset, ${STANDARD}`)
    expect(composePrompt('fur dataset, wolf', settings({ mode: 'furry', qualityTags: 'none' }))).toBe('fur dataset, wolf')
    expect(composePrompt('background dataset, forest', settings({ mode: 'furry', qualityTags: 'none' }))).toBe('background dataset, forest')
  })
})

describe('composeUc（照 NAI 出图时）', () => {
  it('预设在前、自己写的在后；开头加 nsfw', () => {
    expect(composeUc('', settings(), '1girl')).toBe(`nsfw, ${HEAVY}`)
    expect(composeUc('bad hands', settings(), '1girl')).toBe(`nsfw, ${HEAVY}, bad hands`)
  })
  it('Curated、预设 None、正面里有 nsfw 时都不加 nsfw', () => {
    expect(composeUc('bad hands', settings({ model: 'v5-curated' }), '1girl')).toBe(`${HEAVY}, bad hands`)
    expect(composeUc('bad hands', settings({ ucPreset: 'none' }), '1girl')).toBe('bad hands')
    expect(composeUc('', settings({ ucPreset: 'none' }), '1girl')).toBe('')
    expect(composeUc('', settings(), 'NSFW, 1girl')).toBe(HEAVY)
  })
})

describe('effectiveSettings', () => {
  it('Effort Medium 锁住 14 步 / Euler Ancestral / UC Heavy，没有 Rescale；文档里存的值不动', () => {
    const s = settings({ effort: 'medium', ucPreset: 'light', gen: { ...defaultSettings().gen, steps: 28, sampler: 'k_euler', cfgRescale: 0.4 } })
    const e = effectiveSettings(s)
    expect(e.gen).toMatchObject({ steps: 14, sampler: 'k_euler_ancestral', cfgRescale: 0 })
    expect(e.ucPreset).toBe('heavy')
    expect(s.gen.steps).toBe(28)
  })
  it('Curated 没有 Effort', () => {
    expect(effectiveSettings(settings({ model: 'v5-curated', effort: 'medium' })).effort).toBe('high')
  })
})

describe('naiComment', () => {
  it('没启用的角色不写；位置写 centers（三位小数）和 use_coords', () => {
    const c = naiComment(
      doc({
        prompt: '2girls',
        chars: [
          { prompt: 'girl, red hair', center: { x: 0.31234, y: 0.7 } },
          { prompt: 'girl, blue hair', enabled: false },
        ],
        s: { useCoords: true },
      }),
    )
    expect(c.v4_prompt.use_coords).toBe(true)
    expect(c.v4_prompt.caption.char_captions).toEqual([{ char_caption: 'girl, red hair', centers: [{ x: 0.312, y: 0.7 }] }])
    expect(c.v4_negative_prompt.caption.char_captions).toHaveLength(1)
  })
  it('seed 随机时不写', () => {
    expect('seed' in naiComment(doc({}))).toBe(false)
    expect(naiComment(doc({ s: { gen: { ...defaultSettings().gen, seed: 42 } } })).seed).toBe(42)
  })
  it('tag_hint 编号：质量 Light = 3、UC Human Focus = 4', () => {
    const c = naiComment(doc({ s: { qualityTags: 'light', ucPreset: 'human-focus', transparent: true } }))
    expect(c).toMatchObject({ tag_hint_qt: 3, tag_hint_uc_preset: 4, tag_hint_transparent_background: true })
  })
  it('Source 按模型 + Effort 选 hash', () => {
    expect(naiMetadata(doc({})).Source).toBe('NovelAI Diffusion V5 0ADF9AB7')
    expect(naiMetadata(doc({ s: { effort: 'medium' } })).Source).toBe('NovelAI Diffusion V5 93F4BD30')
    expect(naiMetadata(doc({ s: { model: 'v5-curated' } })).Source).toBe('NovelAI Diffusion V5 DB276663')
  })
})

describe('写出去再读回来 = 原样（parseNaiImage 是逆运算）', () => {
  const cases: [string, Parameters<typeof doc>[0]][] = [
    ['默认设置', { prompt: '2girls, 1.2::cherry blossoms, petals::, outdoors', uc: 'bad hands', chars: [{ prompt: 'girl, red hair', uc: 'blue eyes', center: { x: 0.25, y: 0.6 } }] }],
    ['Furry · Light · 透明背景 · Custom', { prompt: 'wolf, forest', s: { mode: 'furry', qualityTags: 'light', transparent: true, useCoords: true }, chars: [{ prompt: 'male', center: { x: 0.8, y: 0.1 } }] }],
    ['Curated · 质量 None · Human Focus', { prompt: '1girl', uc: 'blurry', s: { model: 'v5-curated', qualityTags: 'none', ucPreset: 'human-focus' } }],
    ['UC None：自己写的 nsfw 留着', { prompt: '1girl', uc: 'nsfw, bad hands', s: { ucPreset: 'none' } }],
    ['Text: 文字渲染', { prompt: 'text, 1girl, Text: Hello, world!\n\nBye', s: { qualityTags: 'standard' } }],
    ['空正面 + Furry', { prompt: '', s: { mode: 'furry' } }],
    ['生成参数全改', { prompt: '1girl', s: { gen: { width: 1024, height: 1536, steps: 40, scale: 5.5, cfgRescale: 0.3, sampler: 'k_dpmpp_2m_sde', seed: 123456789 } } }],
  ]
  for (const [name, input] of cases) {
    it(name, () => {
      const d = doc(input)
      const p = parseNaiImage(naiMetadata(d))
      expect(p.prompt).toBe(exportString(d.base.prompt))
      expect(p.uc).toBe(exportString(d.base.uc))
      const s = d.settings
      expect(p).toMatchObject({ v4: true, model: s.model, effort: s.effort, mode: s.mode, quality: s.qualityTags, transparent: s.transparent, ucPreset: s.ucPreset, useCoords: s.useCoords })
      expect(p.gen).toEqual(s.gen)
      expect(p.characters).toEqual(d.characters.map((c) => ({ prompt: exportString(c.prompt), uc: exportString(c.uc), center: c.center })))
    })
  }
  it('Effort Medium：读回来是锁住的值', () => {
    const p = parseNaiImage(naiMetadata(doc({ prompt: '1girl', s: { effort: 'medium', ucPreset: 'light' } })))
    expect(p).toMatchObject({ effort: 'medium', ucPreset: 'heavy' })
    expect(p.gen).toMatchObject({ steps: 14, sampler: 'k_euler_ancestral', cfgRescale: 0 })
  })
})

describe('真图读进来再写出去，和 NAI 写的逐字一样（735531459 的设置）', () => {
  const BASE =
    '2girls, 1boy, three characters, full body, wide shot, outdoors, stone staircase, daytime, blue sky, distinct outfits, all characters clearly visible, detailed background, high complexity'
  const centers = [
    { x: 0.512, y: 0.706 },
    { x: 0.137, y: 0.311 },
    { x: 0.773, y: 0.704 },
  ]
  const comment = {
    prompt: `${BASE}, ${STANDARD}`,
    steps: 28,
    height: 1216,
    width: 832,
    scale: 7,
    cfg_rescale: 0,
    seed: 735531459,
    sampler: 'k_euler_ancestral',
    v4_prompt: { caption: { base_caption: `${BASE}, ${STANDARD}`, char_captions: centers.map((c, i) => ({ char_caption: `girl ${i}, smiling`, centers: [c] })) }, use_coords: true, use_order: true },
    v4_negative_prompt: { caption: { base_caption: `nsfw, ${HEAVY}`, char_captions: centers.map((c) => ({ char_caption: '', centers: [c] })) } },
    tag_hint_transparent_background: null,
    tag_hint_uc_preset: 2,
    tag_hint_qt: 1,
    uc: `nsfw, ${HEAVY}`,
  }
  it('Description / uc / 角色 / 参数', () => {
    const p = parseNaiImage({ Description: comment.prompt, Software: 'NovelAI', Source: 'NovelAI Diffusion V5 0ADF9AB7', Comment: JSON.stringify(comment) })
    const all = new Set<ImportItem>(Object.values(importItems(p)).flat())
    expect(all.size).toBeGreaterThan(defaultPicks(p).size)
    const { doc: d } = buildImportedDoc(p, all, { base: null, appendChars: false }, defaultSettings())
    const out = naiMetadata(d)
    const c = JSON.parse(out.Comment)
    expect(out.Description).toBe(comment.prompt)
    expect(out.Source).toBe('NovelAI Diffusion V5 0ADF9AB7')
    expect(c.uc).toBe(comment.uc)
    expect(c.v4_prompt.caption).toEqual(comment.v4_prompt.caption)
    expect(c.v4_prompt.use_coords).toBe(true)
    expect(c.v4_negative_prompt.caption).toEqual(comment.v4_negative_prompt.caption)
    expect(c).toMatchObject({ steps: 28, width: 832, height: 1216, scale: 7, cfg_rescale: 0, seed: 735531459, sampler: 'k_euler_ancestral', tag_hint_qt: 1, tag_hint_uc_preset: 2 })
  })
})

describe('alpha 低位', () => {
  it('写进去再读出来一样；alpha 只有 254 / 255', async () => {
    const meta = naiMetadata(doc({ prompt: '2girls, 中文也行', chars: [{ prompt: 'girl' }] }))
    const payload = await stealthPayload(meta)
    const w = 64
    const h = Math.ceil((payload.length * 8) / w) + 3
    const rgba = new Uint8ClampedArray(w * h * 4).fill(200)
    expect(writeStealthAlpha(rgba, w, h, payload)).toBe(true)
    expect(new Set(rgba.filter((_, i) => i % 4 === 3))).toEqual(new Set([254, 255]))
    expect(JSON.parse((await decodeStealthAlpha(rgba, w, h))!)).toEqual(meta)
  })
  it('像素不够放返回 false', async () => {
    const payload = await stealthPayload({ a: 'b' })
    expect(writeStealthAlpha(new Uint8ClampedArray(4 * 4 * 4), 4, 4, payload)).toBe(false)
  })
})
