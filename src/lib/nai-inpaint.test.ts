import { describe, expect, it } from 'vitest'
import { defaultSettings } from '@/store/doc'
import { blankDoc } from '@/store/sample'
import type { DocSettings } from '@/types'
import type { NaiAccount } from './nai-api'
import {
  applyPixels,
  blendInpaint,
  featherAlpha,
  keepCells,
  brushEdgePath,
  bucketFill,
  buildInpaintRequest,
  dilate,
  fillPolygon,
  inpaintModelId,
  inpaintPrice,
  inpaintSize,
  invertMask,
  maskEdgePath,
  maskEmpty,
  newMask,
  prefillTransparent,
  resampleMask,
  stamp,
  stroke,
  wandSelect,
} from './nai-inpaint'

const settings = (p: Partial<DocSettings> = {}, gen: Partial<DocSettings['gen']> = {}): DocSettings => {
  const d = defaultSettings()
  return { ...d, ...p, gen: { ...d.gen, ...gen } }
}
const opus = (): NaiAccount => ({ tier: 3, active: true, anlas: 1000, usage: { percent: 63, purchasedPercent: 0, timeUntilNextPercent: 1200, isNegative: false } })
const count = (g: Uint8Array) => g.reduce((a, b) => a + b, 0)

describe('蒙版格子', () => {
  it('8px 一格，向上取整', () => {
    const m = newMask(832, 1216)
    expect([m.gw, m.gh]).toEqual([104, 152])
    expect(newMask(830, 1201).gh).toBe(151)
    expect(maskEmpty(m)).toBe(true)
  })
  it('笔刷：直径 32px = 半径 2 格，格子中心在圆里就算', () => {
    const m = newMask(80, 80)
    stamp(m, 5, 5, 32, 1)
    expect(count(m.grid)).toBe(12)
    stamp(m, 5, 5, 32, 0)
    expect(maskEmpty(m)).toBe(true)
  })
  it('拖一笔连成线、不留缝', () => {
    const m = newMask(400, 80)
    stroke(m, { x: 2, y: 5 }, { x: 45, y: 5 }, 16, 1)
    for (let x = 2; x < 45; x++) expect(m.grid[4 * m.gw + x] || m.grid[5 * m.gw + x]).toBe(1)
  })
  it('油漆桶：填满描好的圈的里面，不出圈；Alt（val 0）清掉连着的一整块', () => {
    const m = newMask(80, 80)
    for (let i = 2; i <= 7; i++) for (const [x, y] of [[i, 2], [i, 7], [2, i], [7, i]]) m.grid[y * m.gw + x] = 1
    expect(bucketFill(m, 4, 4, 1)).toBe(true)
    expect(count(m.grid)).toBe(36)
    expect(bucketFill(m, 4, 4, 1)).toBe(false)
    expect(bucketFill(m, 4, 4, 0)).toBe(true)
    expect(maskEmpty(m)).toBe(true)
  })
  it('反选', () => {
    const m = newMask(16, 16)
    m.grid[0] = 1
    invertMask(m)
    expect([...m.grid]).toEqual([0, 1, 1, 1])
  })
  it('多边形：格子中心在里面才算（奇偶规则）', () => {
    const m = newMask(80, 80)
    fillPolygon(m, [{ x: 16, y: 16 }, { x: 64, y: 16 }, { x: 64, y: 64 }, { x: 16, y: 64 }], 1)
    expect(count(m.grid)).toBe(36)
    expect(m.grid[2 * m.gw + 2]).toBe(1)
    expect(m.grid[1 * m.gw + 1]).toBe(0)
    fillPolygon(m, [{ x: 0, y: 0 }, { x: 80, y: 0 }], 1)
    expect(count(m.grid)).toBe(36)
  })
})

describe('边界线', () => {
  it('一个 2 × 1 的块：上下两条横线、左右两条竖线（连着的合成一段）', () => {
    const m = newMask(32, 24)
    m.grid[1 * m.gw + 1] = 1
    m.grid[1 * m.gw + 2] = 1
    expect(maskEdgePath(m)).toBe('M1 1H3M1 2H3M1 1V2M3 1V2')
  })
  it('空蒙版没有线；挨着边的格子边上也画', () => {
    const m = newMask(16, 16)
    expect(maskEdgePath(m)).toBe('')
    m.grid[0] = 1
    expect(maskEdgePath(m)).toBe('M0 0H1M0 1H1M0 0V1M1 0V1')
  })
  it('笔刷轮廓和 stamp 盖到的格子一致', () => {
    const m = newMask(80, 80)
    stamp(m, 5, 5, 32, 1)
    expect(brushEdgePath(5, 5, 32)).toBe(maskEdgePath(m))
  })
})

describe('魔棒 / 透明区域', () => {
  const W = 16
  const H = 8
  const data = new Uint8ClampedArray(W * H * 4)
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const o = (y * W + x) * 4
      const v = x < 8 ? 255 : 0
      data.set([v, v, v, x === 15 && y === 0 ? 0 : 255], o)
    }
  const px = { data, width: W, height: H }
  it('按颜色选连在一起的像素；容差内的算同一块', () => {
    const sel = wandSelect(px, 1, 1, 32)
    expect(count(sel)).toBe(64)
    const m = newMask(W, H)
    applyPixels(m, sel, W, H, 1)
    expect([...m.grid]).toEqual([1, 0])
    expect(count(wandSelect(px, 1, 1, 255))).toBe(W * H)
  })
  it('一格里有明显透明的像素就涂上', () => {
    const m = newMask(W, H)
    expect(prefillTransparent(m, px)).toBe(true)
    expect([...m.grid]).toEqual([0, 1])
  })
})

describe('发出去的蒙版 / 合成', () => {
  it('格子换尺寸：最近邻', () => {
    const m = newMask(16, 16)
    m.grid.set([1, 0, 0, 1])
    expect([...resampleMask(m, 4, 4)]).toEqual([1, 1, 0, 0, 1, 1, 0, 0, 0, 0, 1, 1, 0, 0, 1, 1])
  })
  it('外扩：圆形', () => {
    const g = new Uint8Array(81)
    g[40] = 1
    expect(count(dilate(g, 9, 9, 4))).toBe(49)
  })
})

describe('尺寸 / 模型 / 价格 / 请求', () => {
  it('出图尺寸：合规的不动；不是 64 的倍数往下取；太大等比缩', () => {
    expect(inpaintSize(832, 1216)).toEqual({ width: 832, height: 1216 })
    expect(inpaintSize(1000, 700)).toEqual({ width: 960, height: 640 })
    const s = inpaintSize(1664, 2432)
    expect(s.width * s.height).toBeLessThanOrEqual(3_145_728)
    expect(s.width % 64 + (s.height % 64)).toBe(0)
  })
  it('模型：各自的 -inpainting；V5 Curated 用 V4.5 Curated 的；Medium 是自己的', () => {
    expect(inpaintModelId(settings({ model: 'v5-full' }))).toBe('nai-diffusion-5-full-inpainting')
    expect(inpaintModelId(settings({ model: 'v5-full', effort: 'medium' }))).toBe('nai-diffusion-5-full-medium-inpainting')
    expect(inpaintModelId(settings({ model: 'v5-curated' }))).toBe('nai-diffusion-4-5-curated-inpainting')
    expect(inpaintModelId(settings({ model: 'v4-curated' }))).toBe('nai-diffusion-4-curated-inpainting')
    expect(inpaintModelId(settings({ model: 'v45-full' }))).toBe('nai-diffusion-4-5-full-inpainting')
    expect(inpaintModelId(settings({ model: 'v4-full' }))).toBe('nai-diffusion-4-full-inpainting')
    expect(inpaintModelId(settings({ model: 'v9-unknown' as never }))).toBeNull()
  })
  it('价格 × 强度；Opus 在 1024² 以内照样免费一张；底图不算', () => {
    const s = settings({ model: 'v45-full', baseImage: { image: 'x', width: 832, height: 1216 } }, { steps: 23 })
    const size = { width: 832, height: 1216 }
    const full = inpaintPrice(s, size, 1, 1, null)
    expect(inpaintPrice(s, size, 1, 0.5, null)).toBe(Math.ceil(full / 2))
    expect(inpaintPrice(s, size, 1, 1, opus())).toBe(0)
    expect(inpaintPrice(s, size, 2, 1, opus())).toBe(full)
  })
  it('请求：infill、重绘模型、image / mask 段名、add_original_image false、强度 ≠ 1 才带 img2img；底图不发', () => {
    const doc = blankDoc()
    doc.settings = settings({ model: 'v5-full', baseImage: { image: 'x', width: 832, height: 1216 } }, { width: 1024, height: 1024 })
    const b = buildInpaintRequest(doc, { seed: 100, nSamples: 1, straightAlpha: false, size: { width: 832, height: 1216 }, strength: 1 })
    expect(b.action).toBe('infill')
    expect(b.model).toBe('nai-diffusion-5-full-inpainting')
    const p = b.parameters
    expect([p.width, p.height, p.image, p.mask, p.add_original_image, p.inpaintImg2ImgStrength, p.extra_noise_seed]).toEqual([832, 1216, 'image', 'mask', false, 1, 99])
    expect(p.img2img).toBeUndefined()
    const half = buildInpaintRequest(doc, { seed: 100, nSamples: 1, straightAlpha: false, size: { width: 832, height: 1216 }, strength: 0.5 }).parameters
    expect(half.img2img).toEqual({ strength: 0.5, color_correct: true })
  })
  it('V5 Curated 按 V4.5 Curated 的规矩出（没有 autoText、没有 straight_alpha）', () => {
    const doc = blankDoc()
    doc.settings = settings({ model: 'v5-curated' })
    const b = buildInpaintRequest(doc, { seed: 1, nSamples: 1, straightAlpha: true, size: { width: 832, height: 1216 }, strength: 1 })
    expect(b.model).toBe('nai-diffusion-4-5-curated-inpainting')
    expect(b.parameters.straight_alpha).toBeUndefined()
  })
})

describe('合成', () => {
  it('软蒙版：蒙版里面是 1，外扩 4 格（32px）再模糊；离得远的是 0，边界不变暗', () => {
    const cells = new Uint8Array(32 * 16)
    for (let y = 0; y < 16; y++) for (let x = 0; x < 8; x++) cells[y * 32 + x] = 1
    const a = featherAlpha(cells, 32, 16, 256, 128)
    const at = (x: number) => a[64 * 256 + x]
    expect(at(10)).toBeCloseTo(1, 3)
    expect(a[0]).toBeCloseTo(1, 3)
    expect(at(64)).toBeGreaterThan(0.9)
    expect(at(96)).toBeCloseTo(0.5, 1)
    expect(at(200)).toBeLessThan(1e-4)
  })
  it('叠回原图：a = 0 是原图、a = 1 是结果', () => {
    const orig = new Uint8ClampedArray([10, 20, 30, 255, 10, 20, 30, 255])
    const res = new Uint8ClampedArray([200, 200, 200, 255, 200, 200, 200, 255])
    expect([...blendInpaint(orig, res, new Float32Array([0, 1]))]).toEqual([10, 20, 30, 255, 200, 200, 200, 255])
  })
  it('透明图：原图不透明的像素原样盖回，透明的地方是结果；用户另外涂的格子不盖', () => {
    const W = 16
    const H = 8
    const orig = new Uint8ClampedArray(W * H * 4)
    const res = new Uint8ClampedArray(W * H * 4)
    for (let i = 0; i < W * H; i++) {
      orig.set(i % W < 8 ? [255, 0, 0, 255] : [0, 0, 0, 0], i * 4)
      res.set([0, 0, 255, 255], i * 4)
    }
    const alpha = new Float32Array(W * H).fill(1)
    const m = newMask(W, H)
    m.grid.set([0, 1])
    const prefill = m.grid.slice()
    const keep = { cells: keepCells(m, prefill), gw: 2, gh: 1, W, H }
    const out = blendInpaint(orig, res, alpha, keep)
    expect([...out.slice(0, 4)]).toEqual([255, 0, 0, 255])
    expect([...out.slice(15 * 4, 16 * 4)]).toEqual([0, 0, 255, 255])
    m.grid.set([1, 1])
    const out2 = blendInpaint(orig, res, alpha, { ...keep, cells: keepCells(m, prefill) })
    expect([...out2.slice(0, 4)]).toEqual([0, 0, 255, 255])
  })
})
