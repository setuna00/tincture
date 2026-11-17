import { describe, expect, it } from 'vitest'
import { Packr } from 'msgpackr'
import { defaultSettings } from '@/store/doc'
import type { Doc, DocSettings, Gender, Section } from '@/types'
import { parsePrompt, toChip } from './nai'
import { UC_PRESET_TEXT } from './nai-image'
import {
  addAutoText,
  buildGenerateRequest,
  dispatchEvent,
  frameReader,
  generationPrice,
  hasOpus,
  imageIsOpusFree,
  maxSamplesForSize,
  naiModelId,
  parseSubscription,
  PRICE_TOO_LONG,
  usageImages,
  usageIsLow,
  usagePercent,
  usageRefillPerDay,
  type NaiAccount,
  type StreamHandlers,
} from './nai-api'
import { naiComment } from './nai-write'

const settings = (p: Partial<DocSettings> = {}, gen: Partial<DocSettings['gen']> = {}): DocSettings => {
  const d = defaultSettings()
  return { ...d, ...p, gen: { ...d.gen, ...gen } }
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

const opus = (p: Partial<NaiAccount> = {}): NaiAccount => ({ tier: 3, active: true, anlas: 1000, usage: { percent: 63, purchasedPercent: 0, timeUntilNextPercent: 1200, isNegative: false }, ...p })

describe('价格（照 NAI 的 checkStableDiffusionPrice，未登录实测的数）', () => {
  const p = (s: DocSettings, n = 1) => generationPrice(s, n, null)
  it('V5 Curated / Full High 一样', () => {
    expect(p(settings())).toBe(26)
    expect(p(settings({ model: 'v5-curated' }))).toBe(26)
    expect(p(settings(), 2)).toBe(52)
    expect(p(settings(), 4)).toBe(104)
  })
  it('步数、尺寸', () => {
    expect(p(settings({}, { steps: 28 }))).toBe(30)
    expect(p(settings({}, { steps: 29 }))).toBe(30)
    expect(p(settings({}, { steps: 50 }))).toBe(50)
    expect(p(settings({}, { width: 1024, height: 1536 }))).toBe(39)
    expect(p(settings({}, { width: 1088, height: 1920 }))).toBe(51)
    expect(p(settings({}, { width: 512, height: 768 }))).toBe(11)
  })
  it('Full Medium 17（步数固定 14）', () => {
    expect(p(settings({ effort: 'medium' }))).toBe(17)
    expect(p(settings({ effort: 'medium' }, { steps: 50 }))).toBe(17)
  })
  it('单张超过 140：耗时过长', () => {
    expect(p(settings({}, { width: 1536, height: 2048, steps: 50 }))).toBe(PRICE_TOO_LONG)
  })
  it('Opus：免费条件内少算 1 张；超出条件、额度用超了照常算', () => {
    expect(generationPrice(settings(), 1, opus())).toBe(0)
    expect(generationPrice(settings(), 2, opus())).toBe(26)
    expect(generationPrice(settings({}, { steps: 29 }), 1, opus())).toBe(30)
    expect(generationPrice(settings({}, { width: 1024, height: 1536 }), 1, opus())).toBe(39)
    expect(generationPrice(settings(), 1, opus({ usage: { percent: 0, purchasedPercent: 0, timeUntilNextPercent: 0, isNegative: true } }))).toBe(26)
    expect(generationPrice(settings(), 1, opus({ tier: 2 }))).toBe(26)
    expect(generationPrice(settings(), 1, opus({ active: false }))).toBe(26)
  })
  it('免费条件、张数上限', () => {
    expect(imageIsOpusFree({ width: 1024, height: 1024, steps: 28 })).toBe(true)
    expect(imageIsOpusFree({ width: 1024, height: 1088, steps: 28 })).toBe(false)
    expect(maxSamplesForSize(832, 1216)).toBe(4)
    expect(maxSamplesForSize(512, 768)).toBe(6)
    expect(maxSamplesForSize(640, 640)).toBe(6)
    expect(maxSamplesForSize(512, 512)).toBe(8)
  })
})

describe('订阅 / Opus 额度', () => {
  it('trainingStepsLeft 两种写法', () => {
    expect(parseSubscription({ tier: 3, active: true, trainingStepsLeft: { fixedTrainingStepsLeft: 1000, purchasedTrainingSteps: 1340 } }).anlas).toBe(2340)
    expect(parseSubscription({ tier: 1, active: true, trainingStepsLeft: 500 }).anlas).toBe(500)
  })
  it('有效 = active 或没过期且有订阅', () => {
    expect(parseSubscription({ tier: 3, active: false, expiresAt: Date.now() / 1000 + 100 }).active).toBe(true)
    expect(parseSubscription({ tier: 0, active: false, expiresAt: Date.now() / 1000 + 100 }).active).toBe(false)
    expect(hasOpus(parseSubscription({ tier: 3, active: true }))).toBe(true)
    expect(hasOpus(parseSubscription({ tier: 2, active: true }))).toBe(false)
  })
  it('额度显示、低、回复速度', () => {
    const u = { percent: 63, purchasedPercent: 0, timeUntilNextPercent: 4320, isNegative: false }
    expect(usagePercent(u)).toBe(63)
    expect(usagePercent({ ...u, percent: 130 })).toBe(100)
    expect(usagePercent({ ...u, percent: 130 }, false)).toBe(130)
    expect(usagePercent({ ...u, isNegative: true })).toBe(0)
    expect(usageImages(63)).toBe(1090)
    expect(usageRefillPerDay(u)).toBe(20)
    expect(usageRefillPerDay({ ...u, timeUntilNextPercent: 0 })).toBe(0)
    expect(usageIsLow(u)).toBe(false)
    expect(usageIsLow({ ...u, percent: 4 })).toBe(true)
    expect(usageIsLow({ ...u, percent: 4, purchasedPercent: 10 })).toBe(false)
    expect(usageIsLow({ ...u, isNegative: true })).toBe(true)
  })
})

describe('请求体（和 naiComment 一致，再照 NAI 补字段）', () => {
  const opt = { seed: 1234, nSamples: 1, straightAlpha: true }
  it('V5 Full：input / 负面 / v4_prompt 都是 naiComment 那份', () => {
    const d = doc({ prompt: '1girl, smile', uc: 'bad hands' })
    const b = buildGenerateRequest(d, opt)
    const c = naiComment(d)
    expect(b.model).toBe('nai-diffusion-5-full')
    expect(b.action).toBe('generate')
    expect(b.use_new_shared_trial).toBe(true)
    expect(b.input).toBe(c.prompt)
    const p = b.parameters as Record<string, any>
    expect(p.negative_prompt).toBe(c.uc)
    expect(p.v4_prompt.caption.base_caption).toBe(c.prompt)
    expect(p.v4_negative_prompt.caption.base_caption).toBe(c.uc)
    expect(p).toMatchObject({ params_version: 4, width: 832, height: 1216, scale: 7, steps: 23, sampler: 'k_euler_ancestral', seed: 1234, n_samples: 1, cfg_rescale: 0, noise_schedule: 'karras' })
    expect(p).toMatchObject({ tag_hint_qt: c.tag_hint_qt, tag_hint_uc_preset: c.tag_hint_uc_preset, ucPresetId: 'heavy', qualityPresetId: 'standard' })
    expect(p).toMatchObject({ deliberate_euler_ancestral_bug: false, prefer_brownian: true, image_format: 'webp', stream: 'msgpack', straight_alpha: true })
    expect('uc' in p).toBe(false)
    expect('tag_hint_transparent_background' in p).toBe(false)
  })
  it('Curated：模型 id；负面不加 nsfw（和 naiComment 一样）', () => {
    const d = doc({ prompt: '1girl', s: settings({ model: 'v5-curated' }) })
    const b = buildGenerateRequest(d, opt)
    expect(b.model).toBe('nai-diffusion-5-curated')
    expect((b.parameters as any).negative_prompt).toBe(UC_PRESET_TEXT.heavy)
  })
  it('Medium：另一个模型、14 步、没有 cfg_rescale、自己写的 UC 和角色 UC 都不发', () => {
    const d = doc({ prompt: '1girl', uc: 'bad hands', chars: [{ prompt: 'frieren', uc: 'blurry' }], s: settings({ effort: 'medium' }, { steps: 30, cfgRescale: 0.4, sampler: 'k_euler' }) })
    const b = buildGenerateRequest(d, opt)
    const p = b.parameters as Record<string, any>
    expect(b.model).toBe('nai-diffusion-5-full-medium')
    expect(p.steps).toBe(14)
    expect(p.sampler).toBe('k_euler_ancestral')
    expect('cfg_rescale' in p).toBe(false)
    expect(p.negative_prompt).toBe(`nsfw, ${UC_PRESET_TEXT.heavy}`)
    expect(p.v4_negative_prompt.caption.char_captions[0].char_caption).toBe('')
  })
  it('角色：AI\'s Choice / Custom；没启用、正面空的不发；centers 和 naiComment 一样', () => {
    const chars: CharIn[] = [
      { prompt: 'frieren, elf', gender: 'female', center: { x: 0.3, y: 0.5 } },
      { prompt: 'fern', enabled: false },
      { prompt: 'himmel', uc: 'smile', gender: 'male', center: { x: 0.7, y: 0.4 } },
    ]
    for (const useCoords of [false, true]) {
      const d = doc({ prompt: '2girls', chars, s: settings({ useCoords }) })
      const b = buildGenerateRequest(d, opt)
      const c = naiComment(d)
      const p = b.parameters as Record<string, any>
      expect(p.v4_prompt.caption.char_captions).toEqual(c.v4_prompt.caption.char_captions)
      expect(p.v4_negative_prompt.caption.char_captions).toEqual(c.v4_negative_prompt.caption.char_captions)
      expect(p.v4_prompt.use_coords).toBe(useCoords)
      expect(p.use_coords).toBe(useCoords)
      expect(p.v4_prompt.use_order).toBe(true)
      expect(p.characterPrompts).toEqual([
        { prompt: 'girl, frieren, elf', uc: '', center: { x: 0.3, y: 0.5 }, enabled: true },
        { prompt: 'boy, himmel', uc: 'smile', center: { x: 0.7, y: 0.4 }, enabled: true },
      ])
    }
  })
  it('n_samples、透明背景、Alpha 模式、别的采样器不带 Euler A 的两项', () => {
    const d = doc({ prompt: '1girl', s: settings({ transparent: true }, { sampler: 'k_dpmpp_2m' }) })
    const p = buildGenerateRequest(d, { seed: 1, nSamples: 3, straightAlpha: false }).parameters as Record<string, any>
    expect(p.n_samples).toBe(3)
    expect(p.tag_hint_transparent_background).toBe(true)
    expect(p.straight_alpha).toBe(false)
    expect('deliberate_euler_ancestral_bug' in p).toBe(false)
  })
})

describe('autoText（引号里的字补成 teXt:）', () => {
  it('收集正面和角色里引号中的字', () => {
    expect(addAutoText('1girl, sign, "Hello"', [], false)).toBe('1girl, sign, "Hello", teXt: Hello')
    expect(addAutoText('1girl, “Hi” and 「你好」', [{ prompt: 'girl, "Bye"', center: { x: 0.5, y: 0.5 } }], false)).toBe('1girl, “Hi” and 「你好」, teXt: Hi\n\n你好\n\nBye')
  })
  it('已经写了 Text: / 没有引号：不动；don\'t 不算引号', () => {
    expect(addAutoText('1girl, Text: "Hi"', [], false)).toBe('1girl, Text: "Hi"')
    expect(addAutoText('1girl', [{ prompt: 'Text: yo', center: { x: 0, y: 0 } }], false)).toBe('1girl')
    expect(addAutoText("don't stop", [], false)).toBe("don't stop")
  })
  it('Custom 位置时按画面从上到下、从左到右排角色', () => {
    const cs = [
      { prompt: '"B"', center: { x: 0.8, y: 0.2 } },
      { prompt: '"A"', center: { x: 0.2, y: 0.2 } },
      { prompt: '"C"', center: { x: 0.5, y: 0.9 } },
    ]
    expect(addAutoText('x', cs, true)).toBe('x, teXt: A\n\nB\n\nC')
    expect(addAutoText('x', cs, false)).toBe('x, teXt: B\n\nA\n\nC')
  })
})

describe('事件流（4 字节长度 + msgpack）', () => {
  const packr = new Packr({ useRecords: false })
  const frame = (obj: unknown) => {
    const body = packr.pack(obj)
    const out = new Uint8Array(4 + body.length)
    new DataView(out.buffer).setUint32(0, body.length)
    out.set(body, 4)
    return out
  }
  it('分块到达、一块里几帧、帧被切开都能拼回来', () => {
    const img = new Uint8Array([1, 2, 3])
    const all = new Uint8Array([
      ...frame({ event_type: 'intermediate', samp_ix: 0, step_ix: 6, image: img }),
      ...frame({ event_type: 'final', samp_ix: 0, image: img }),
      ...frame({ event_type: 'error', samp_ix: 1, message: 'boom' }),
    ])
    const got: string[] = []
    const h: StreamHandlers = {
      intermediate: (i, s, b) => got.push(`i${i}:${s}:${b.length}`),
      final: (i, b) => got.push(`f${i}:${b.length}`),
      sampleError: (i, m) => got.push(`e${i}:${m}`),
    }
    const feed = frameReader((e) => dispatchEvent(e, h))
    for (const cut of [3, 10, 25, all.length]) {
      got.length = 0
      const f = frameReader((e) => dispatchEvent(e, h))
      f(all.subarray(0, cut))
      f(all.subarray(cut))
      expect(got).toEqual(['i0:6:3', 'f0:3', 'e1:boom'])
    }
    got.length = 0
    for (const b of all) feed(new Uint8Array([b]))
    expect(got).toEqual(['i0:6:3', 'f0:3', 'e1:boom'])
  })
  it('Map 形式的事件也认', () => {
    const got: string[] = []
    dispatchEvent(new Map<string, unknown>([['event_type', 'final'], ['samp_ix', 2], ['image', new Uint8Array([9])]]), {
      intermediate: () => {},
      final: (i) => got.push(`f${i}`),
      sampleError: () => {},
    })
    expect(got).toEqual(['f2'])
  })
})

describe('模型 id', () => {
  it('Effort 只对 Full 生效', () => {
    expect(naiModelId(settings({ model: 'v5-curated', effort: 'medium' }))).toBe('nai-diffusion-5-curated')
    expect(naiModelId(settings({ effort: 'medium' }))).toBe('nai-diffusion-5-full-medium')
  })
})
