import { describe, expect, it } from 'vitest'
import { defaultSettings } from '@/store/doc'
import { blankDoc } from '@/store/sample'
import type { CharacterRef, DocSettings, VibeRef } from '@/types'
import { generationPriceParts, type NaiAccount } from './nai-api'
import { refModelFor } from './nai-models'
import { activeRefs, applyRefParams, baseImageSize, characterBlocked, directorLayout, normalizeStrengths, refCost, vibeBlocked, vibeDefaults, vibeExtraPrice, VIBE_EXTRA_PRICE, VIBE_FREE } from './nai-refs'
import { changesText, sameVersion, versionChanges } from './versions'

const img = (image: string, width = 600, height = 800) => ({ image, width, height })
const vibe = (image: string, p: Partial<VibeRef> = {}): VibeRef => ({ ...img(image), informationExtracted: 1, strength: 0.6, enabled: true, ...p })
const char = (image: string, p: Partial<CharacterRef> = {}): CharacterRef => ({ ...img(image), description: 'character&style', strength: 1, fidelity: 1, enabled: true, ...p })
const settings = (p: Partial<DocSettings> = {}, gen: Partial<DocSettings['gen']> = {}): DocSettings => {
  const d = defaultSettings()
  return { ...d, ...p, gen: { ...d.gen, ...gen } }
}
const opus = (): NaiAccount => ({ tier: 3, active: true, anlas: 1000, usage: { percent: 63, purchasedPercent: 0, timeUntilNextPercent: 1200, isNegative: false } })

describe('哪些模型能用', () => {
  it('V5 都没有；V4.5 两个都有；V4 只有 Vibe（getModelSupportInfo）', () => {
    expect(vibeBlocked({ model: 'v5-full' })).toBe('model')
    expect(characterBlocked({ model: 'v5-curated' })).toBe('model')
    expect(vibeBlocked({ model: 'v45-full' })).toBeNull()
    expect(characterBlocked({ model: 'v45-curated' })).toBeNull()
    expect(vibeBlocked({ model: 'v4-full' })).toBeNull()
    expect(characterBlocked({ model: 'v4-full' })).toBe('model')
  })
  it('用不了时切到哪个：V5 Full → V4.5 Full，别的 → V4.5 Curated；能用 = 原样', () => {
    expect(refModelFor('v5-full', 'vibe')).toBe('v45-full')
    expect(refModelFor('v5-curated', 'character')).toBe('v45-curated')
    expect(refModelFor('v4-full', 'character')).toBe('v45-curated')
    expect(refModelFor('v4-full', 'vibe')).toBe('v4-full')
    expect(refModelFor('v45-full', 'character')).toBe('v45-full')
  })
  it('新加的 Vibe：V4.5 Full 信息量 0.7，别的 1（defaultVTSettingsForModel）', () => {
    expect(vibeDefaults('v45-full')).toEqual({ informationExtracted: 0.7, strength: 0.6, enabled: true })
    expect(vibeDefaults('v4-curated').informationExtracted).toBe(1)
  })
})

describe('这次出图用到哪些', () => {
  it('模型用不了的、停用的不算；有精准参考（停用的也算）时没有 Vibe', () => {
    const vs = [vibe('a'), vibe('b', { enabled: false })]
    expect(activeRefs({ model: 'v5-full', vibes: vs, characterRefs: [char('c')] })).toEqual({ base: null, vibes: [], characters: [] })
    expect(activeRefs({ model: 'v4-full', vibes: vs, characterRefs: [] }).vibes.map((v) => v.image)).toEqual(['a'])
    expect(activeRefs({ model: 'v45-full', vibes: vs, characterRefs: [char('c', { enabled: false })] })).toEqual({ base: null, vibes: [], characters: [] })
    expect(vibeBlocked({ model: 'v45-full', characterRefs: [char('c', { enabled: false })] })).toBe('character')
  })
})

describe('价格', () => {
  it('Vibe：没编过的每张 2；启用的超过 4 张每多 1 张 2（vtAdditionalPrice）', () => {
    expect(vibeExtraPrice(4)).toBe(0)
    expect(vibeExtraPrice(6)).toBe(4)
    expect(vibeExtraPrice(VIBE_FREE)).toBe(0)
    expect(vibeExtraPrice(VIBE_FREE + 1)).toBe(VIBE_EXTRA_PRICE)
    const s = settings({ model: 'v45-full', vibes: ['a', 'b', 'c', 'd', 'e', 'f'].map((x) => vibe(x)) })
    expect(refCost(s, 1, (v) => v.image === 'a')).toEqual({ encodeCount: 5, encode: 10, extraVibes: 4, characters: 0 })
  })
  it('精准参考：每张参考图每出 1 张图 5；没有 Opus 免费那张', () => {
    const s = settings({ model: 'v45-full', characterRefs: [char('a'), char('b')] })
    expect(refCost(s, 2, () => true).characters).toBe(20)
    const plain = generationPriceParts(settings({ model: 'v45-full' }), 1, opus())
    expect(plain.gen).toBe(0)
    const p = generationPriceParts(s, 1, opus())
    expect(p.gen).toBeGreaterThan(0)
    expect(p.total).toBe(p.gen + 10)
  })
  it('底图：生成价乘强度（每张至少 2）', () => {
    const full = generationPriceParts(settings({ model: 'v45-full' }, { width: 1216, height: 1216 }), 1, null).gen
    const half = generationPriceParts(settings({ model: 'v45-full', baseImage: img('x') }, { width: 1216, height: 1216, strength: 0.5 }), 1, null).gen
    expect(half).toBe(Math.max(2, Math.ceil(full * 0.5)))
  })
})

describe('请求参数', () => {
  it('底图：img2img、image 段、强度默认 0.7、extra_noise_seed = seed − 1、color_correct false', () => {
    const r = applyRefParams({ action: 'generate', parameters: { seed: 100 } }, settings({ baseImage: img('x') }), { vibes: [], characters: [] })
    expect(r.action).toBe('img2img')
    expect(r.parameters).toMatchObject({ image: 'image', strength: 0.7, noise: 0, extra_noise_seed: 99, color_correct: false })
  })
  it('Vibe：reference_image_multiple_cached（段名 ref_multiple_i）+ 强度按比例缩到 1（normalizeReferenceStrengths）', () => {
    expect(normalizeStrengths([0.6])).toEqual([0.6])
    expect(normalizeStrengths([0.3, 0.2])).toEqual([0.3, 0.2])
    expect(normalizeStrengths([0.6, -0.6])).toEqual([0.5, -0.5])
    const r = applyRefParams({ action: 'generate', parameters: { seed: 1 } }, settings({ model: 'v4-full', vibes: [vibe('a', { strength: 0.6 }), vibe('b', { strength: 0.6 })] }), { vibes: ['k1', 'k2'], characters: [] })
    expect(r.action).toBe('generate')
    expect(r.parameters.reference_image_multiple_cached).toEqual([
      { cache_secret_key: 'k1', data: 'ref_multiple_0' },
      { cache_secret_key: 'k2', data: 'ref_multiple_1' },
    ])
    expect(r.parameters.reference_strength_multiple).toEqual([0.5, 0.5])
  })
  it('平衡强度关了（gen.normalizeRefs = false）：强度原样发', () => {
    expect(normalizeStrengths([0.8, 0.6], false)).toEqual([0.8, 0.6])
    const s = settings({ model: 'v4-full', vibes: [vibe('a', { strength: 0.8 }), vibe('b', { strength: 0.6 })] }, { normalizeRefs: false })
    expect(applyRefParams({ action: 'generate', parameters: { seed: 1 } }, s, { vibes: ['k1', 'k2'], characters: [] }).parameters.reference_strength_multiple).toEqual([0.8, 0.6])
  })
  it('只有编码的 Vibe（encodedFor）只在那个模型上发、算钱', () => {
    const vs = [vibe('a'), vibe('e', { encodedFor: 'v45-full' })]
    expect(activeRefs(settings({ model: 'v45-full', vibes: vs })).vibes.map((v) => v.image)).toEqual(['a', 'e'])
    expect(activeRefs(settings({ model: 'v4-full', vibes: vs })).vibes.map((v) => v.image)).toEqual(['a'])
    expect(refCost(settings({ model: 'v4-full', vibes: vs }), 1, () => false).encodeCount).toBe(1)
  })
  it('精准参考：director_*（类型、信息量 1、强度、1 − Fidelity），不发 Vibe', () => {
    const s = settings({ model: 'v45-full', vibes: [vibe('a')], characterRefs: [char('c', { description: 'style', strength: 0.8, fidelity: 0.75 })] })
    const r = applyRefParams({ action: 'generate', parameters: { seed: 1 } }, s, { vibes: [], characters: ['kc'] })
    expect(r.parameters.reference_image_multiple_cached).toBeUndefined()
    expect(r.parameters).toMatchObject({
      director_reference_images_cached: [{ cache_secret_key: 'kc', data: 'director_ref_0' }],
      director_reference_descriptions: [{ caption: { base_caption: 'style', char_captions: [] }, legacy_uc: false }],
      director_reference_information_extracted: [1],
      director_reference_strength_values: [0.8],
      director_reference_secondary_strength_values: [0.25],
    })
  })
  it('精准参考的图：缩进比例最近的尺寸、居中（resizeDirectorImage）', () => {
    expect(directorLayout(600, 800)).toEqual({ width: 1024, height: 1536, image: { width: 1024, height: 1365, x: 0, y: 86 } })
    expect(directorLayout(1600, 900)).toEqual({ width: 1536, height: 1024, image: { width: 1536, height: 864, x: 0, y: 80 } })
    expect(directorLayout(500, 500).width).toBe(1472)
  })
})

describe('设为底图时的尺寸', () => {
  it('比例和尺寸都对得上 = 不改', () => {
    expect(baseImageSize({ width: 832, height: 1216 }, { width: 832, height: 1216 })).toBeNull()
  })
  it('边长是 64 的倍数、不超上限 = 用图的尺寸', () => {
    expect(baseImageSize({ width: 1024, height: 1536 }, { width: 832, height: 1216 })).toEqual({ width: 1024, height: 1536 })
  })
  it('不是 64 的倍数：按比例取最接近的一档（长边 1216 / 短边 896）；横图转回来', () => {
    expect(baseImageSize({ width: 600, height: 800 }, { width: 832, height: 1216 })).toEqual({ width: 896, height: 1216 })
    expect(baseImageSize({ width: 1600, height: 900 }, { width: 832, height: 1216 })).toEqual({ width: 1600, height: 896 })
  })
})

describe('版本', () => {
  it('没有底图时强度 / 噪声不算内容；有底图时算', () => {
    const a = blankDoc('x')
    const b = structuredClone(a)
    b.settings.gen.strength = 0.4
    expect(sameVersion(a, b)).toBe(true)
    a.settings.baseImage = img('x')
    b.settings.baseImage = img('x')
    expect(sameVersion(a, b)).toBe(false)
  })
  it('改动：底图、Vibe、精准参考', () => {
    const a = blankDoc('x')
    a.settings.vibes = [vibe('a'), vibe('b')]
    const b = structuredClone(a)
    b.settings.baseImage = img('x')
    b.settings.vibes = [vibe('a'), vibe('b', { strength: 0.8, enabled: false })]
    b.settings.characterRefs = [char('c')]
    expect(changesText(versionChanges(a, b))).toBe('添加底图 停用 Vibe Transfer 第 2 张 Vibe Transfer 第 2 张 强度 0.6 → 0.8 添加 精准参考')
    const c = structuredClone(b)
    c.settings.gen.strength = 0.5
    c.settings.characterRefs = [char('c', { description: 'character' })]
    c.settings.vibes = [vibe('a')]
    expect(changesText(versionChanges(b, c))).toBe('底图强度 0.7 → 0.5 移除 Vibe Transfer 精准参考 类型 角色和画风 → 角色')
  })
  it('版本改动：平衡强度 开 → 关', () => {
    const a = { ...blankDoc(), settings: settings({ model: 'v45-full' }) }
    const b = { ...a, settings: settings({ model: 'v45-full' }, { normalizeRefs: false }) }
    expect(changesText(versionChanges(a, b))).toBe('平衡强度 开 → 关')
  })
})
