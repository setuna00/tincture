import { describe, expect, it } from 'vitest'
import { defaultSettings } from '@/store/doc'
import type { CharacterRef, Doc, DocSettings, VibeRef } from '@/types'
import type { NaiAccount } from './nai-api'
import {
  actionRefSettings,
  buildEnhanceRequest,
  buildVariationsRequest,
  CANNOT,
  defaultEnhanceScale,
  enhancePrice,
  enhancePriceParts,
  enhancePromptAdd,
  enhanceScales,
  labelOf,
  maxEnhanceTarget,
  toolInputSize,
  toolPrice,
  toolRequest,
  upscalePrice,
  variationsCount,
  variationsPrice,
  variationsPriceParts,
} from './nai-tools'
import { readZip } from './zip'

const settings = (p: Partial<DocSettings> = {}, gen: Partial<DocSettings['gen']> = {}): DocSettings => {
  const d = defaultSettings()
  return { ...d, ...p, gen: { ...d.gen, ...gen } }
}
const doc = (s = settings()): Doc => ({ base: { prompt: [], uc: [] }, characters: [], settings: s, meta: { title: 't', createdAt: 0 } })
const opus: NaiAccount = { tier: 3, active: true, anlas: 1000, usage: { percent: 63, purchasedPercent: 0, timeUntilNextPercent: 1200, isNegative: false } }
const img = { width: 832, height: 1216 }

describe('价格（照 NAI 源码）', () => {
  it('放大按像素查表，大于 1536 × 2048 不能放大', () => {
    expect(upscalePrice(832, 1216)).toBe(1)
    expect(upscalePrice(1024, 1536)).toBe(2)
    expect(upscalePrice(1536, 2048)).toBe(4)
    expect(upscalePrice(1664, 2432)).toBe(CANNOT)
  })
  it('Enhance：放大后的尺寸 × 强度，Opus 在 1024² 以内免费', () => {
    expect(enhancePrice(doc(), img, { scale: 1, strength: 0.5 }, null)).toBe(13)
    expect(enhancePrice(doc(), img, { scale: 1, strength: 0.5 }, opus)).toBe(0)
    expect(maxEnhanceTarget(832, 1216)).toEqual({ width: 1440, height: 2144 })
    expect(enhancePrice(doc(), img, { scale: 'max', strength: 0.5 }, opus)).toBe(38)
    expect(enhancePrice(doc(), { width: 1664, height: 2432 }, { scale: 1, strength: 0.5 }, opus)).toBe(CANNOT)
    expect(variationsPrice(doc(), { width: 1664, height: 2432 }, opus)).toBe(CANNOT)
  })
  it('变体：3 张、强度 0.8；Opus 少算 1 张', () => {
    expect(variationsCount(832, 1216)).toBe(3)
    expect(variationsPrice(doc(), img, null)).toBe(63)
    expect(variationsPrice(doc(), img, opus)).toBe(42)
    expect(variationsPrice(doc(settings({ model: 'v45-full' })), img, null)).toBe(42)
  })
  it('Enhance / 变体带参考图：同出图加价，模型用不了的不算，文档里的底图不算', () => {
    const vibe = (image: string): VibeRef => ({ image, width: 600, height: 800, informationExtracted: 1, strength: 0.6, enabled: true })
    const char = (image: string): CharacterRef => ({ image, width: 600, height: 800, description: 'character&style', strength: 1, fidelity: 1, enabled: true })
    const v45 = (p: Partial<DocSettings>) => doc(settings({ model: 'v45-full', ...p }))
    expect(enhancePrice(v45({}), img, { scale: 1, strength: 0.5 }, null)).toBe(9)
    const two = v45({ vibes: [vibe('a'), vibe('b')] })
    expect(enhancePriceParts(two, img, { scale: 1, strength: 0.5 }, null)).toMatchObject({ gen: 9, encodeCount: 2, encode: 4, total: 13 })
    expect(enhancePrice(two, img, { scale: 1, strength: 0.5 }, null, () => true)).toBe(9)
    const withChar = v45({ vibes: [vibe('a')], characterRefs: [char('c')] })
    expect(enhancePriceParts(withChar, img, { scale: 1, strength: 0.5 }, opus)).toMatchObject({ gen: 9, encode: 0, characters: 5, total: 14 })
    expect(variationsPriceParts(withChar, img, opus)).toMatchObject({ gen: 42, characters: 15, total: 57 })
    expect(enhancePrice(doc(settings({ vibes: [vibe('a')], characterRefs: [char('c')] })), img, { scale: 1, strength: 0.5 }, null)).toBe(13)
    expect(actionRefSettings(v45({ baseImage: { image: 'x', width: 1, height: 1 } })).baseImage).toBeUndefined()
    expect(variationsPrice(two, { width: 1664, height: 2432 }, opus)).toBe(CANNOT)
  })
  it('Director Tools：缩到 1024² 像素按 28 步算 20；Opus 免费；去背景 3 × 价 + 5 且不免费', () => {
    expect(toolPrice('lineart', 832, 1216, null)).toBe(20)
    expect(toolPrice('lineart', 832, 1216, opus)).toBe(0)
    expect(toolPrice('bg-removal', 832, 1216, null)).toBe(65)
    expect(toolPrice('bg-removal', 832, 1216, opus)).toBe(65)
    expect(toolPrice('colorize', 1664, 2432, opus)).toBe(60)
  })
})

describe('尺寸', () => {
  it('Enhance 的倍数按尺寸筛，Max 只有 V5', () => {
    expect(enhanceScales(832, 1216, true)).toEqual([1, 'max'])
    expect(enhanceScales(832, 1216, false)).toEqual([1])
    expect(enhanceScales(1024, 1024, true)).toEqual([1, 1.5, 'max'])
    expect(enhanceScales(512, 768, false)).toEqual([1, 1.5, 2])
    expect(defaultEnhanceScale([1, 1.5, 'max'])).toBe('max')
  })
  it('Director Tools 的图：小图放到 1024² 像素，大图缩到上限以内', () => {
    expect(toolInputSize(832, 1216)).toEqual({ width: 832, height: 1216 })
    expect(toolInputSize(512, 768)).toEqual({ width: 836, height: 1254 })
    const big = toolInputSize(1664, 2432)
    expect(big.width * big.height).toBeLessThanOrEqual(3_145_728 - 2000)
  })
})

describe('请求体', () => {
  it('Enhance：img2img、原图 × 倍数、强度 / 噪声、extra_noise_seed、正面加降权的 upscaled, blurry', () => {
    const b = buildEnhanceRequest(doc(), img, { scale: 1, strength: 0.5, noise: 0 }, false, 100)
    expect(b.action).toBe('img2img')
    expect(b.parameters).toMatchObject({ width: 832, height: 1216, n_samples: 1, image: 'image', strength: 0.5, noise: 0, seed: 100, extra_noise_seed: 99 })
    expect(b.input.endsWith(', -2::upscaled, blurry::,')).toBe(true)
    expect((b.parameters.v4_prompt as { caption: { base_caption: string } }).caption.base_caption).toBe(b.input)
    const m = buildEnhanceRequest(doc(), img, { scale: 'max', strength: 0.5, noise: 0 }, false, 100)
    expect(m.parameters).toMatchObject({ width: 832, height: 1216, upscaled_enhance: true })
    expect(m.input).not.toContain('upscaled, blurry')
  })
  it('enhancePromptAdd：有 Text: 时加在它前面，加过不再加', () => {
    expect(enhancePromptAdd('1girl')).toBe('1girl, -2::upscaled, blurry::,')
    expect(enhancePromptAdd('1girl, Text: hi')).toBe('1girl,, -2::upscaled, blurry::, Text: hi')
    expect(enhancePromptAdd('a, -2::upscaled, blurry::,')).toBe('a, -2::upscaled, blurry::,')
  })
  it('变体：原图尺寸、3 张、强度 0.8 噪声 0.1', () => {
    const b = buildVariationsRequest(doc(), img, false, 7)
    expect(b.parameters).toMatchObject({ width: 832, height: 1216, n_samples: 3, strength: 0.8, noise: 0.1, extra_noise_seed: 6, image: 'image' })
  })
  it('Director Tools：上色 prompt + defry；改表情发「表情;;」；保留对话框换 req_type', () => {
    expect(toolRequest('colorize', { width: 1, height: 2 }, { prompt: 'red hair', defry: 2 })).toMatchObject({
      req_type: 'colorize',
      prompt: 'red hair',
      defry: 2,
      width: 1,
      height: 2,
      image: 'image',
    })
    expect(toolRequest('emotion', { width: 1, height: 2 }, { emotion: 'happy', defry: 1 })).toMatchObject({ req_type: 'emotion', prompt: 'happy;;', defry: 1 })
    expect(toolRequest('declutter', { width: 1, height: 2 }, { keepBubbles: true }).req_type).toBe('declutter-keep-bubbles')
    expect(toolRequest('lineart', { width: 1, height: 2 })).not.toHaveProperty('prompt')
    expect(labelOf('enhance')).toBe('enhanced')
    expect(labelOf('declutter', { keepBubbles: true })).toBe('declutter-keep-bubbles')
  })
})

async function makeZip(files: { name: string; data: Uint8Array; deflate?: boolean }[]): Promise<Uint8Array> {
  const enc = new TextEncoder()
  const parts: Uint8Array[] = []
  const dir: Uint8Array[] = []
  let off = 0
  for (const f of files) {
    const body = f.deflate ? new Uint8Array(await new Response(new Blob([f.data as BlobPart]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer()) : f.data
    const name = enc.encode(f.name)
    const local = new Uint8Array(30 + name.length)
    const lv = new DataView(local.buffer)
    lv.setUint32(0, 0x04034b50, true)
    lv.setUint16(8, f.deflate ? 8 : 0, true)
    lv.setUint32(18, body.length, true)
    lv.setUint32(22, f.data.length, true)
    lv.setUint16(26, name.length, true)
    local.set(name, 30)
    const cd = new Uint8Array(46 + name.length)
    const cv = new DataView(cd.buffer)
    cv.setUint32(0, 0x02014b50, true)
    cv.setUint16(10, f.deflate ? 8 : 0, true)
    cv.setUint32(20, body.length, true)
    cv.setUint32(24, f.data.length, true)
    cv.setUint16(28, name.length, true)
    cv.setUint32(42, off, true)
    cd.set(name, 46)
    parts.push(local, body)
    dir.push(cd)
    off += local.length + body.length
  }
  const dirLen = dir.reduce((a, d) => a + d.length, 0)
  const end = new Uint8Array(22)
  const ev = new DataView(end.buffer)
  ev.setUint32(0, 0x06054b50, true)
  ev.setUint16(8, files.length, true)
  ev.setUint16(10, files.length, true)
  ev.setUint32(12, dirLen, true)
  ev.setUint32(16, off, true)
  const all = [...parts, ...dir, end]
  const out = new Uint8Array(all.reduce((a, p) => a + p.length, 0))
  let at = 0
  for (const p of all) {
    out.set(p, at)
    at += p.length
  }
  return out
}

describe('readZip', () => {
  it('存储和 deflate 都读得出', async () => {
    const a = new Uint8Array([1, 2, 3, 4])
    const b = new TextEncoder().encode('hello hello hello hello')
    const z = await makeZip([
      { name: 'image_0.png', data: a },
      { name: 'image_1.png', data: b, deflate: true },
    ])
    const got = await readZip(z)
    expect(got.map((f) => f.name)).toEqual(['image_0.png', 'image_1.png'])
    expect([...got[0].data]).toEqual([...a])
    expect(new TextDecoder().decode(got[1].data)).toBe('hello hello hello hello')
  })
})
