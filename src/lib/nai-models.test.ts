import { describe, expect, it } from 'vitest'
import { defaultSettings } from '@/store/doc'
import type { Doc, DocSettings, Gender, ModelId, Section } from '@/types'
import { parsePrompt, toChip } from './nai'
import { buildGenerateRequest, generationPrice, naiModelId, type NaiAccount } from './nai-api'
import { buildImportedDoc, defaultPicks, importItems, parseNaiImage } from './nai-image'
import { NAI_TOKEN_LIMIT, lengthPlan } from './nai-length'
import {
  MODELS,
  canPosition,
  defaultModelParams,
  effectiveNoise,
  mapUcPreset,
  maxCharacters,
  modelCenter,
  modelFromSource,
  noiseOptions,
  qualityOptions,
  snapCenter,
  snrMultiplier,
  sourceString,
  switchModel,
  ucOptions,
  varietySigma,
} from './nai-models'
import { composePrompt, composeUc, effectiveSettings, naiComment, naiMetadata } from './nai-write'

const settings = (p: Partial<DocSettings> = {}, gen: Partial<DocSettings['gen']> = {}): DocSettings => {
  const d = defaultSettings()
  return { ...d, ...p, gen: { ...d.gen, ...gen } }
}
const on = (m: ModelId, p: Partial<DocSettings> = {}, gen: Partial<DocSettings['gen']> = {}): DocSettings => {
  const s = switchModel(defaultSettings(), m)
  return { ...s, ...p, gen: { ...s.gen, ...gen } }
}
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
function doc(o: { prompt?: string; uc?: string; chars?: CharIn[]; s?: DocSettings }): Doc {
  return {
    base: { prompt: sec(o.prompt ?? ''), uc: sec(o.uc ?? '') },
    characters: (o.chars ?? []).map((c, i) => ({ id: `c${i}`, name: '', gender: c.gender ?? 'other', color: 'slate', prompt: sec(c.prompt), uc: sec(c.uc ?? ''), enabled: c.enabled ?? true, center: c.center ?? { x: 0.5, y: 0.5 } })),
    settings: o.s ?? settings(),
    meta: { title: 't', createdAt: 0 },
  }
}
const LEGACY: ModelId[] = ['v45-curated', 'v45-full', 'v4-curated', 'v4-full']

describe('预设原文（qualityPresetsForModel / getModelUcPreset）', () => {
  const V5_HEAVY =
    'lowres, artistic error, film grain, scan artifacts, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, dithering, halftone, screentone, multiple views, logo, too many watermarks, negative space, blank page'
  const V45C_HEAVY =
    'blurry, lowres, upscaled, artistic error, film grain, scan artifacts, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, halftone, multiple views, logo, too many watermarks, negative space, blank page'
  it('质量标签：V4.5 / V4 只有 Standard / None', () => {
    expect(MODELS['v45-full'].quality).toEqual({ standard: 'very aesthetic, masterpiece, no text' })
    expect(MODELS['v45-curated'].quality).toEqual({ standard: 'very aesthetic, masterpiece, no text, -0.8::feet::, rating:general' })
    expect(MODELS['v4-full'].quality).toEqual({ standard: 'no text, best quality, very aesthetic, absurdres' })
    expect(MODELS['v4-curated'].quality).toEqual({ standard: 'rating:general, best quality, very aesthetic, absurdres' })
    for (const m of LEGACY) expect(qualityOptions(m)).toEqual(['standard', 'none'])
    expect(qualityOptions('v5-curated')).toEqual(['standard', 'light', 'none'])
  })
  it('UC 预设：V4.5 Full 只有 Light 和 V5 不同；V4.5 Curated 没有 Furry；V4 只有 Heavy / Light', () => {
    expect(ucOptions('v45-full')).toEqual(['heavy', 'light', 'furry-focus', 'human-focus', 'none'])
    expect(ucOptions('v45-curated')).toEqual(['heavy', 'light', 'human-focus', 'none'])
    expect(ucOptions('v4-full')).toEqual(['heavy', 'light', 'none'])
    expect(ucOptions('v4-curated')).toEqual(['heavy', 'light', 'none'])
    const f = MODELS['v45-full'].uc
    expect(f.heavy).toBe(V5_HEAVY)
    expect(f['furry-focus']).toBe(MODELS['v5-full'].uc['furry-focus'])
    expect(f['human-focus']).toBe(MODELS['v5-full'].uc['human-focus'])
    expect(f.light).toBe('lowres, artistic error, scan artifacts, worst quality, bad quality, jpeg artifacts, multiple views, very displeasing, too many watermarks, negative space, blank page')
    const c = MODELS['v45-curated'].uc
    expect(c.heavy).toBe(V45C_HEAVY)
    expect(c.light).toBe('blurry, lowres, upscaled, artistic error, scan artifacts, jpeg artifacts, logo, too many watermarks, negative space, blank page')
    expect(c['human-focus']).toBe(V45C_HEAVY.replace('scan artifacts, ', 'scan artifacts, bad anatomy, bad hands, ').replace('too many watermarks, ', 'too many watermarks, @_@, mismatched pupils, glowing eyes, '))
    expect(MODELS['v4-full'].uc).toEqual({
      heavy: 'blurry, lowres, error, film grain, scan artifacts, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, multiple views, logo, too many watermarks, white blank page, blank page',
      light: 'blurry, lowres, error, worst quality, bad quality, jpeg artifacts, very displeasing, white blank page, blank page',
    })
    expect(MODELS['v4-curated'].uc).toEqual({
      heavy: 'blurry, lowres, error, film grain, scan artifacts, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, logo, dated, signature, multiple views, gigantic breasts, white blank page, blank page',
      light: 'blurry, lowres, error, worst quality, bad quality, jpeg artifacts, very displeasing, logo, dated, signature, white blank page, blank page',
    })
  })
  it('拼进 prompt：质量接末尾（Text: 前面）、UC 在开头；nsfw 只在 Full 加（三个 Curated 是 safe）', () => {
    const s = effectiveSettings(on('v4-full'))
    expect(composePrompt('1girl, Text: Hi', s)).toBe('1girl,, no text, best quality, very aesthetic, absurdres Text: Hi')
    expect(composeUc('bad hands', s, '1girl')).toBe(`nsfw, ${MODELS['v4-full'].uc.heavy}, bad hands`)
    for (const m of ['v45-curated', 'v4-curated'] as const) expect(composeUc('', effectiveSettings(on(m)), '1girl')).toBe(MODELS[m].uc.heavy)
    expect(composeUc('', effectiveSettings(on('v45-full')), '1girl')).toBe(`nsfw, ${V5_HEAVY}`)
    const plan = lengthPlan(doc({ prompt: '1girl', s: on('v45-curated') }))
    expect(plan.boxes[0].text).toBe(`1girl, ${MODELS['v45-curated'].quality.standard}`)
  })
})

describe('模型没有的预设 / 设置（effectiveSettings）', () => {
  it('UC 预设按类别回退（getModelUcMapping），质量没有就是 None', () => {
    expect(mapUcPreset('furry-focus', 'v45-curated')).toBe('heavy')
    expect(mapUcPreset('human-focus', 'v4-full')).toBe('heavy')
    expect(mapUcPreset('light', 'v4-full')).toBe('light')
    expect(mapUcPreset('furry-focus', 'v45-full')).toBe('furry-focus')
    const e = effectiveSettings({ ...on('v4-curated'), qualityTags: 'light', ucPreset: 'furry-focus', transparent: true })
    expect(e).toMatchObject({ qualityTags: 'none', ucPreset: 'heavy', transparent: false })
  })
  it('没有要改的时原样返回（引用不变）', () => {
    const s = on('v45-full')
    expect(effectiveSettings(s)).toBe(s)
  })
  it('V5 不带 Variety+ / Legacy UC；V4.5 没有 Legacy UC', () => {
    expect(effectiveSettings(settings({}, { varietyPlus: true, legacyUc: true })).gen).toMatchObject({ varietyPlus: false, legacyUc: false })
    expect(effectiveSettings(on('v45-full', {}, { varietyPlus: true, legacyUc: true })).gen).toMatchObject({ varietyPlus: true, legacyUc: false })
  })
})

describe('切模型（照 NAI 每个模型各存一份参数）', () => {
  it('第一次切到 = 那个模型的默认值；切回来还原；Mode / NSFW 不跟模型走', () => {
    const a = settings({ mode: 'furry', nsfw: true, ucPreset: 'light', useCoords: true }, { steps: 30, scale: 6, width: 1216, height: 832, seed: 42 })
    const b = switchModel(a, 'v4-full')
    expect(b).toMatchObject({ model: 'v4-full', mode: 'furry', nsfw: true, ...defaultModelParams('v4-full') })
    expect(b.gen).toEqual({ width: 832, height: 1216, steps: 23, scale: 5.5, cfgRescale: 0, sampler: 'k_euler_ancestral', seed: null })
    const c = switchModel({ ...b, gen: { ...b.gen, varietyPlus: true } }, 'v5-full')
    expect(c).toMatchObject({ model: 'v5-full', ucPreset: 'light', useCoords: true, gen: a.gen })
    expect(Object.keys(c.perModel ?? {})).toEqual(['v4-full'])
    expect(switchModel(c, 'v4-full').gen.varietyPlus).toBe(true)
    expect(switchModel(c, 'v5-full')).toBe(c)
  })
  it('默认引导：V4.5 5、V4 5.5、V5 7；都是 23 步、Euler Ancestral', () => {
    expect(on('v45-curated').gen.scale).toBe(5)
    expect(on('v45-full').gen.scale).toBe(5)
    expect(on('v4-curated').gen.scale).toBe(5.5)
    expect(on('v5-curated').gen.scale).toBe(7)
  })
})

describe('Noise Schedule / Variety+', () => {
  it('V4.x 能选 karras / exponential / polyexponential，默认跟采样器；V5 没有、发 karras', () => {
    expect(noiseOptions('v4-full', 'k_euler_ancestral')).toEqual(['karras', 'exponential', 'polyexponential'])
    expect(noiseOptions('v5-full', 'k_euler_ancestral')).toEqual([])
    expect(effectiveNoise('v4-full', { sampler: 'k_dpmpp_2m' })).toBe('exponential')
    expect(effectiveNoise('v4-full', { sampler: 'k_euler' })).toBe('karras')
    expect(effectiveNoise('v4-full', { sampler: 'k_euler', noiseSchedule: 'polyexponential' })).toBe('polyexponential')
    expect(effectiveNoise('v5-full', { sampler: 'k_dpmpp_2m', noiseSchedule: 'exponential' })).toBe('karras')
  })
  it('Variety+：V4.5 58、V4 19，× 按分辨率的系数（832×1216 = 1）；关着 null；V5 不发', () => {
    expect(snrMultiplier(832, 1216)).toBe(1)
    expect(varietySigma('v45-full', { width: 832, height: 1216, varietyPlus: true })).toBe(58)
    expect(varietySigma('v4-curated', { width: 832, height: 1216, varietyPlus: true })).toBe(19)
    expect(varietySigma('v4-curated', { width: 832, height: 1216 })).toBeNull()
    expect(varietySigma('v5-full', { width: 832, height: 1216, varietyPlus: true })).toBeUndefined()
    expect(varietySigma('v45-full', { width: 1024, height: 1536, varietyPlus: true })).toBeCloseTo(58 * Math.sqrt((128 * 192) / (104 * 152)), 10)
  })
})

describe('请求体逐模型（t8 构造函数）', () => {
  const opt = { seed: 1234, nSamples: 1, straightAlpha: true }
  const req = (s: DocSettings, o: Partial<Parameters<typeof doc>[0]> = {}) => {
    const b = buildGenerateRequest(doc({ prompt: '1girl, "Hi"', uc: 'bad hands', ...o, s }), opt)
    return { model: b.model, input: b.input, p: b.parameters as Record<string, any> }
  }
  it('模型 id', () => {
    expect(LEGACY.map((m) => naiModelId(on(m)))).toEqual(['nai-diffusion-4-5-curated', 'nai-diffusion-4-5-full', 'nai-diffusion-4-curated-preview', 'nai-diffusion-4-full'])
  })
  it('V4.x：发实际的 noise_schedule、skip_cfg_above_sigma（关着 null）、legacy_uc；不发 straight_alpha / 透明背景；不自动补 Text', () => {
    for (const m of LEGACY) {
      const { model, input, p } = req(on(m, { transparent: true }, { sampler: 'k_dpmpp_2m' }))
      expect(model).toBe(MODELS[m].api)
      expect(input).toBe(`1girl, "Hi", ${MODELS[m].quality.standard}`)
      expect(p.noise_schedule).toBe('exponential')
      expect(p.skip_cfg_above_sigma).toBeNull()
      expect(p.legacy_uc).toBe(false)
      expect(p.v4_negative_prompt.legacy_uc).toBe(false)
      expect(p.scale).toBe(MODELS[m].defaultScale)
      expect('straight_alpha' in p).toBe(false)
      expect('tag_hint_transparent_background' in p).toBe(false)
      expect('deliberate_euler_ancestral_bug' in p).toBe(false)
    }
  })
  it('Variety+ 开：值 × SNR；Noise 选了别的；V4 的 Legacy UC', () => {
    const a = req(on('v45-full', {}, { varietyPlus: true, noiseSchedule: 'polyexponential', width: 1216, height: 832 })).p
    expect(a.skip_cfg_above_sigma).toBe(58)
    expect(a.noise_schedule).toBe('polyexponential')
    expect(a).toMatchObject({ deliberate_euler_ancestral_bug: false, prefer_brownian: true })
    const b = req(on('v4-full', {}, { varietyPlus: true, legacyUc: true, width: 1024, height: 1024 })).p
    expect(b.skip_cfg_above_sigma).toBeCloseTo(19 * Math.sqrt((128 * 128) / (104 * 152)), 10)
    expect(b.legacy_uc).toBe(true)
    expect(b.v4_negative_prompt.legacy_uc).toBe(true)
  })
  it('V5 照旧：noise karras、没有 skip_cfg_above_sigma、有 straight_alpha、自动补 Text', () => {
    const { input, p } = req(settings({}, { sampler: 'k_dpmpp_2m' }))
    expect(p.noise_schedule).toBe('karras')
    expect('skip_cfg_above_sigma' in p).toBe(false)
    expect(p.straight_alpha).toBe(true)
    expect(input).toContain('teXt: Hi')
  })
  it('角色位置：V4.x 吸到 5×5 格心（请求和元数据一样）', () => {
    const chars = [
      { prompt: 'a', center: { x: 0.33, y: 0.71 } },
      { prompt: 'b', center: { x: 0.99, y: 0.0 } },
    ]
    const d = doc({ prompt: '2girls', chars, s: on('v4-full', { useCoords: true }) })
    const p = buildGenerateRequest(d, opt).parameters as Record<string, any>
    expect(p.characterPrompts.map((c: any) => c.center)).toEqual([
      { x: 0.3, y: 0.7 },
      { x: 0.9, y: 0.1 },
    ])
    expect(naiComment(d).v4_prompt.caption.char_captions.map((c) => c.centers[0])).toEqual([
      { x: 0.3, y: 0.7 },
      { x: 0.9, y: 0.1 },
    ])
    expect(modelCenter('v5-full', { x: 0.33333, y: 0.5 })).toEqual({ x: 0.333, y: 0.5 })
    expect(snapCenter({ x: 0.2, y: 0.5999 })).toEqual({ x: 0.3, y: 0.5 })
  })
})

describe('价格（checkStableDiffusionPrice：V4.x 不 × 1.5）', () => {
  const opus = (isNegative: boolean): NaiAccount => ({ tier: 3, active: true, anlas: 100, usage: { percent: 0, purchasedPercent: 0, timeUntilNextPercent: 1, isNegative } })
  it('默认 17，2 张 34，50 步 33；Large 26', () => {
    for (const m of LEGACY) expect(generationPrice(on(m), 1, null)).toBe(17)
    expect(generationPrice(on('v45-full'), 2, null)).toBe(34)
    expect(generationPrice(on('v4-full', {}, { steps: 50 }), 1, null)).toBe(33)
    expect(generationPrice(on('v4-full', {}, { width: 1024, height: 1536 }), 1, null)).toBe(26)
  })
  it('Opus 免费那一张：V4.x 不看额度用没用超（opusUsageLimit 只有 V5）', () => {
    expect(generationPrice(on('v45-full'), 1, opus(true))).toBe(0)
    expect(generationPrice(settings(), 1, opus(true))).toBe(26)
    expect(generationPrice(settings(), 1, opus(false))).toBe(0)
  })
})

describe('Source ↔ 模型（functionGetModelFromSourceString）', () => {
  it('写出去的 Source 读回来是同一个模型', () => {
    for (const m of Object.keys(MODELS) as ModelId[]) expect(modelFromSource(sourceString({ model: m, effort: 'high' }))).toEqual({ model: m, medium: false })
    expect(modelFromSource(sourceString({ model: 'v5-full', effort: 'medium' }))).toEqual({ model: 'v5-full', medium: true })
  })
  it('写的是每个模型的第一个 hash', () => {
    expect(sourceString({ model: 'v45-full', effort: 'high' })).toBe('NovelAI Diffusion V4.5 4BDE2A90')
    expect(sourceString({ model: 'v45-curated', effort: 'high' })).toBe('NovelAI Diffusion V4.5 C02D4F98')
    expect(sourceString({ model: 'v4-full', effort: 'high' })).toBe('NovelAI Diffusion V4 37442FCA')
    expect(sourceString({ model: 'v4-curated', effort: 'high' })).toBe('NovelAI Diffusion V4 7ABFFA2A')
    expect(sourceString({ model: 'v5-full', effort: 'high' })).toBe('NovelAI Diffusion V5 0ADF9AB7')
  })
  it('表里的每个 hash + 特例 + 没见过的', () => {
    const cases: [string, ModelId][] = [
      ['NovelAI Diffusion V4.5 F3D95188', 'v45-full'],
      ['DiffusionModelMetaName.NAIv4next 4BDE2A90', 'v45-full'],
      ['NovelAI Diffusion V4.5 B5A2A797', 'v45-curated'],
      ['NovelAI Diffusion V4 5AB81C7C', 'v45-curated'],
      ['DiffusionModelMetaName.NAIv4next C02D4F98', 'v45-curated'],
      ['NovelAI Diffusion V4 F6302A9D', 'v4-full'],
      ['NovelAI Diffusion V4 770A9E12', 'v4-curated'],
      ['NovelAI Diffusion V4.5 12345678', 'v45-curated'],
      ['NovelAI Diffusion V4 12345678', 'v4-curated'],
      ['NovelAI Diffusion V5 12345678', 'v5-curated'],
      ['NovelAI Diffusion V5 657484A5', 'v5-full'],
    ]
    for (const [src, m] of cases) expect(modelFromSource(src)?.model, src).toBe(m)
    expect(modelFromSource('Stable Diffusion XL C1E1DE52')).toBeNull()
    expect(modelFromSource('')).toBeNull()
  })
})

describe('导入 V4.x 的图', () => {
  it('写出去再读回来 = 原样（每个旧模型）', () => {
    for (const m of LEGACY) {
      const s = on(m, { mode: 'furry', ucPreset: 'light', useCoords: true }, { sampler: 'k_dpmpp_2m', noiseSchedule: 'polyexponential', varietyPlus: true, steps: 28 })
      const d = doc({ prompt: '1girl, smile, Text: Hi', uc: 'bad hands', chars: [{ prompt: 'frieren', center: { x: 0.3, y: 0.7 } }], s })
      const p = parseNaiImage(naiMetadata(d))
      expect(p, m).toMatchObject({ v4: true, model: m, mode: 'furry', quality: 'standard', ucPreset: 'light', prompt: '1girl, smile, Text: Hi', uc: 'bad hands', noise: 'polyexponential', variety: true, useCoords: true })
      expect(p.gen).toMatchObject({ steps: 28, sampler: 'k_dpmpp_2m', scale: MODELS[m].defaultScale })
      expect(importItems(p).settings).toEqual(['mode', 'quality', 'coords', 'model', 'size', 'steps', 'scale', 'rescale', 'sampler', 'noise', 'variety'])
    }
  })
  it('导进新文档：换成图的模型，Noise / Variety+ 跟着；角色超过 6 个截掉', () => {
    const chars = Array.from({ length: 8 }, (_, i) => ({ prompt: `c${i}` }))
    const d = doc({ prompt: '1girl', chars, s: on('v45-full', {}, { varietyPlus: true, noiseSchedule: 'exponential' }) })
    const p = parseNaiImage(naiMetadata(d))
    const { doc: out, dropped } = buildImportedDoc(p, defaultPicks(p), { base: null, appendChars: false }, defaultSettings())
    expect(out.settings.model).toBe('v45-full')
    expect(out.settings.gen).toMatchObject({ varietyPlus: true, noiseSchedule: 'exponential', scale: 5 })
    expect(out.characters).toHaveLength(maxCharacters('v45-full'))
    expect(dropped).toBe(2)
  })
  it('不勾模型、导进 V5 文档：UC 预设按类别回退，质量没有的不加', () => {
    const p = parseNaiImage(naiMetadata(doc({ prompt: '1girl', s: on('v45-full', { ucPreset: 'furry-focus' }) })))
    const picks = defaultPicks(p)
    picks.delete('model')
    const base = doc({ prompt: 'x', s: on('v4-full') })
    const { doc: out } = buildImportedDoc(p, picks, { base, appendChars: false }, defaultSettings())
    expect(out.settings.model).toBe('v4-full')
    expect(out.settings.ucPreset).toBe('heavy')
  })
})

describe('角色上限 / 位置', () => {
  it('V5 32、V4.x 6', () => {
    expect(maxCharacters('v5-curated')).toBe(32)
    for (const m of LEGACY) expect(maxCharacters(m)).toBe(6)
  })
  it('V4.x 只有 1 个角色时不能调位置（canPositionOneCharacter）', () => {
    expect(canPosition('v5-full', 1)).toBe(true)
    expect(canPosition('v4-full', 1)).toBe(false)
    expect(canPosition('v4-full', 2)).toBe(true)
    expect(canPosition('v5-full', 0)).toBe(false)
  })
})

describe('长度上限', () => {
  it('V4.x 512（T5），V5 照旧', () => {
    for (const m of LEGACY) expect(NAI_TOKEN_LIMIT[m]).toBe(512)
    expect(NAI_TOKEN_LIMIT['v5-full']).toBe(1471)
    expect(lengthPlan(doc({ s: on('v4-curated') }))).toMatchObject({ limit: 512, tokenizer: 't5' })
    expect(lengthPlan(doc({}))).toMatchObject({ limit: 1471, tokenizer: 'qwen' })
  })
})
