import type { Doc, DocSettings, VibeRef } from '@/types'
import { buildGenerateRequest, imagePrice, PRICE_TOO_LONG, type GenerateBody, type NaiAccount } from './nai-api'
import { isModelId, modelInfo, MODELS } from './nai-models'
import { activeRefs, refCost, refCostTotal, DEFAULT_NOISE, DEFAULT_STRENGTH } from './nai-refs'
import { effectiveSettings } from './nai-write'

export const CELL = 8
const MAX_SIZE = 3_145_728
export const INPAINT_STRENGTH = 1

/** NovelAI masks use ceil(width/8) x ceil(height/8) cells; 1 marks a cell for regeneration. */
export interface Mask {
  gw: number
  gh: number
  grid: Uint8Array
}

export const newMask = (w: number, h: number): Mask => {
  const gw = Math.ceil(w / CELL)
  const gh = Math.ceil(h / CELL)
  return { gw, gh, grid: new Uint8Array(gw * gh) }
}
export const maskEmpty = (m: Mask) => !m.grid.some(Boolean)

/** Brush centers use mask-cell units, but diameter uses original-image pixels. */
export function stamp(m: Mask, cx: number, cy: number, diameter: number, val: 0 | 1) {
  const r = diameter / CELL / 2
  for (let y = Math.max(0, Math.floor(cy - r)); y < Math.min(m.gh, Math.ceil(cy + r)); y++)
    for (let x = Math.max(0, Math.floor(cx - r)); x < Math.min(m.gw, Math.ceil(cx + r)); x++) if ((x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 <= r * r) m.grid[y * m.gw + x] = val
}

export function stroke(m: Mask, a: { x: number; y: number }, b: { x: number; y: number }, diameter: number, val: 0 | 1) {
  const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 0.5))
  for (let i = 1; i <= n; i++) stamp(m, a.x + ((b.x - a.x) * i) / n, a.y + ((b.y - a.y) * i) / n, diameter, val)
}

export function edgePath(on: (x: number, y: number) => boolean, x0: number, y0: number, x1: number, y1: number): string {
  const d: string[] = []
  for (let y = y0; y <= y1; y++) {
    let start = -1
    for (let x = x0; x <= x1; x++) {
      const edge = x < x1 && on(x, y - 1) !== on(x, y)
      if (edge && start < 0) start = x
      if (!edge && start >= 0) {
        d.push(`M${start} ${y}H${x}`)
        start = -1
      }
    }
  }
  for (let x = x0; x <= x1; x++) {
    let start = -1
    for (let y = y0; y <= y1; y++) {
      const edge = y < y1 && on(x - 1, y) !== on(x, y)
      if (edge && start < 0) start = y
      if (!edge && start >= 0) {
        d.push(`M${x} ${start}V${y}`)
        start = -1
      }
    }
  }
  return d.join('')
}

export function maskEdgePath(m: Mask): string {
  const on = (x: number, y: number) => x >= 0 && y >= 0 && x < m.gw && y < m.gh && m.grid[y * m.gw + x] === 1
  return edgePath(on, 0, 0, m.gw, m.gh)
}

export function brushEdgePath(cx: number, cy: number, diameter: number): string {
  const r = diameter / CELL / 2
  const in_ = (x: number, y: number) => (x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 <= r * r
  return edgePath(in_, Math.floor(cx - r) - 1, Math.floor(cy - r) - 1, Math.ceil(cx + r) + 1, Math.ceil(cy + r) + 1)
}

export function bucketFill(m: Mask, x: number, y: number, val: 0 | 1): boolean {
  const { gw, gh, grid } = m
  if (x < 0 || y < 0 || x >= gw || y >= gh) return false
  const start = y * gw + x
  const from = grid[start]
  if (from === val) return false
  const stack = [start]
  grid[start] = val
  while (stack.length) {
    const i = stack.pop()!
    const cx = i % gw
    for (const j of [cx > 0 ? i - 1 : -1, cx < gw - 1 ? i + 1 : -1, i >= gw ? i - gw : -1, i < gw * (gh - 1) ? i + gw : -1]) {
      if (j < 0 || grid[j] !== from) continue
      grid[j] = val
      stack.push(j)
    }
  }
  return true
}

export function invertMask(m: Mask) {
  for (let i = 0; i < m.grid.length; i++) m.grid[i] = m.grid[i] ? 0 : 1
}

export function fillPolygon(m: Mask, pts: { x: number; y: number }[], val: 0 | 1) {
  if (pts.length < 3) return
  for (let gy = 0; gy < m.gh; gy++) {
    const y = gy * CELL + CELL / 2
    const xs: number[] = []
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i]
      const b = pts[(i + 1) % pts.length]
      if (a.y <= y !== b.y <= y) xs.push(a.x + ((y - a.y) / (b.y - a.y)) * (b.x - a.x))
    }
    xs.sort((p, q) => p - q)
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const from = Math.max(0, Math.ceil(xs[k] / CELL - 0.5))
      const to = Math.min(m.gw - 1, Math.floor(xs[k + 1] / CELL - 0.5))
      for (let gx = from; gx <= to; gx++) m.grid[gy * m.gw + gx] = val
    }
  }
}

export interface Pixels {
  data: Uint8ClampedArray | Uint8Array
  width: number
  height: number
}

export function wandSelect(px: Pixels, x: number, y: number, tol: number): Uint8Array {
  const { data: d, width: W, height: H } = px
  const sel = new Uint8Array(W * H)
  if (x < 0 || y < 0 || x >= W || y >= H) return sel
  const o = (y * W + x) * 4
  const [r, g, b, a] = [d[o], d[o + 1], d[o + 2], d[o + 3]]
  const same = (i: number) => Math.abs(d[i * 4] - r) <= tol && Math.abs(d[i * 4 + 1] - g) <= tol && Math.abs(d[i * 4 + 2] - b) <= tol && Math.abs(d[i * 4 + 3] - a) <= tol
  const stack = [y * W + x]
  sel[stack[0]] = 1
  while (stack.length) {
    const i = stack.pop()!
    const cx = i % W
    for (const j of [cx > 0 ? i - 1 : -1, cx < W - 1 ? i + 1 : -1, i >= W ? i - W : -1, i < W * (H - 1) ? i + W : -1]) {
      if (j < 0 || sel[j] || !same(j)) continue
      sel[j] = 1
      stack.push(j)
    }
  }
  return sel
}

export function applyPixels(m: Mask, sel: Uint8Array, W: number, H: number, val: 0 | 1) {
  for (let gy = 0; gy < m.gh; gy++)
    for (let gx = 0; gx < m.gw; gx++) {
      let n = 0
      let tot = 0
      for (let y = gy * CELL; y < Math.min(H, gy * CELL + CELL); y++)
        for (let x = gx * CELL; x < Math.min(W, gx * CELL + CELL); x++) {
          tot++
          n += sel[y * W + x]
        }
      if (tot && n * 2 >= tot) m.grid[gy * m.gw + gx] = val
    }
}

export function prefillTransparent(m: Mask, px: Pixels): boolean {
  const { data: d, width: W, height: H } = px
  let any = false
  for (let gy = 0; gy < m.gh; gy++)
    for (let gx = 0; gx < m.gw; gx++) {
      let hit = false
      for (let y = gy * CELL; y < Math.min(H, gy * CELL + CELL) && !hit; y++)
        for (let x = gx * CELL; x < Math.min(W, gx * CELL + CELL); x++)
          if (d[(y * W + x) * 4 + 3] < 128) {
            hit = true
            break
          }
      if (!hit) continue
      m.grid[gy * m.gw + gx] = 1
      any = true
    }
  return any
}

export function resampleMask(m: Mask, tw: number, th: number): Uint8Array {
  if (tw === m.gw && th === m.gh) return m.grid.slice()
  const out = new Uint8Array(tw * th)
  for (let y = 0; y < th; y++) for (let x = 0; x < tw; x++) out[y * tw + x] = m.grid[Math.min(m.gh - 1, Math.floor(((y + 0.5) * m.gh) / th)) * m.gw + Math.min(m.gw - 1, Math.floor(((x + 0.5) * m.gw) / tw))]
  return out
}

export function dilate(grid: Uint8Array, w: number, h: number, r: number): Uint8Array {
  const out = new Uint8Array(grid.length)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      if (!grid[y * w + x]) continue
      for (let dy = -r; dy <= r; dy++)
        for (let dx = -r; dx <= r; dx++) {
          const nx = x + dx
          const ny = y + dy
          if (nx >= 0 && ny >= 0 && nx < w && ny < h && dx * dx + dy * dy <= r * r) out[ny * w + nx] = 1
        }
    }
  return out
}

export function inpaintSize(w: number, h: number): { width: number; height: number } {
  const k = Math.min(1, Math.sqrt(MAX_SIZE / (w * h)))
  const fit = (x: number) => Math.max(64, Math.floor((x * k) / 64) * 64)
  return { width: fit(w), height: fit(h) }
}

/** NovelAI V5 Curated uses the V4.5 Curated inpainting model and prompt rules. */
export function inpaintSettings(s: DocSettings): DocSettings {
  return s.model === 'v5-curated' ? { ...s, model: 'v45-curated' } : s
}

/** Unsupported models must fail instead of spending Anlas on a different model's inpainting. */
export function inpaintModelId(s: DocSettings): string | null {
  if (!isModelId(s.model)) return null
  if (s.model === 'v5-full' && s.effort === 'medium') return 'nai-diffusion-5-full-medium-inpainting'
  return MODELS[s.model].inpaintApi
}

/** NovelAI checkStableDiffusionPrice scales masked generation cost by inpaintImg2ImgStrength. */
export function inpaintPrice(s: DocSettings, size: { width: number; height: number }, nSamples: number, strength: number, account: NaiAccount | null, encoded: (v: VibeRef) => boolean = () => false): number {
  const eff = noBase(effectiveSettings(s))
  const gen = imagePrice({
    ...size,
    steps: eff.gen.steps,
    n: nSamples,
    v5: modelInfo(eff.model).group === 'new',
    medium: eff.model === 'v5-full' && eff.effort === 'medium',
    strength,
    noOpusFree: activeRefs(eff).characters.length > 0,
    account,
  })
  return gen === PRICE_TOO_LONG ? PRICE_TOO_LONG : gen + refCostTotal(refCost(eff, nSamples, encoded))
}

/** NovelAI accepts one base image; inpainting must replace the document's img2img base. */
export const noBase = (s: DocSettings): DocSettings => (s.baseImage ? { ...s, baseImage: undefined } : s)

/** NovelAI infill uses image/mask part names and add_original_image=false because the client composites the result.
 * Nondefault inpaint strength adds img2img; strength/noise remain present with an image. */
export function buildInpaintRequest(doc: Doc, o: { seed: number; nSamples: number; straightAlpha: boolean; size: { width: number; height: number }; strength: number }): GenerateBody {
  const s = noBase(inpaintSettings(doc.settings))
  const d: Doc = { ...doc, settings: { ...s, gen: { ...s.gen, width: o.size.width, height: o.size.height } } }
  const body = buildGenerateRequest(d, o)
  const p: Record<string, unknown> = {
    ...body.parameters,
    image: 'image',
    mask: 'mask',
    add_original_image: false,
    inpaintImg2ImgStrength: o.strength,
    strength: s.gen.strength ?? DEFAULT_STRENGTH,
    noise: s.gen.noise ?? DEFAULT_NOISE,
    extra_noise_seed: o.seed - 1,
  }
  if (o.strength !== 1) p.img2img = { strength: o.strength, color_correct: true }
  const model = inpaintModelId(doc.settings)
  if (!model) throw new Error(`no inpainting model for ${doc.settings.model}`)
  return { ...body, model, action: 'infill', parameters: p }
}

function boxLine(a: Float32Array, start: number, stride: number, n: number, r: number, tmp: Float32Array) {
  let sum = 0
  for (let i = -r; i <= r; i++) sum += a[start + Math.min(n - 1, Math.max(0, i)) * stride]
  for (let i = 0; i < n; i++) {
    tmp[i] = sum / (2 * r + 1)
    sum += a[start + Math.min(n - 1, i + r + 1) * stride] - a[start + Math.max(0, i - r) * stride]
  }
  for (let i = 0; i < n; i++) a[start + i * stride] = tmp[i]
}

/** Match NovelAI compositing: dilate 4 cells, upscale x8, then apply a radius-20 box blur twice. */
export function featherAlpha(cells: Uint8Array, cw: number, ch: number, W: number, H: number): Float32Array {
  const grown = dilate(cells, cw, ch, 4)
  const a = new Float32Array(W * H)
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) a[y * W + x] = grown[Math.min(ch - 1, Math.floor((y * ch) / H)) * cw + Math.min(cw - 1, Math.floor((x * cw) / W))]
  const tmp = new Float32Array(Math.max(W, H))
  for (let pass = 0; pass < 2; pass++) {
    for (let y = 0; y < H; y++) boxLine(a, y * W, 1, W, 20, tmp)
    for (let x = 0; x < W; x++) boxLine(a, x, W, H, 20, tmp)
  }
  return a
}

export function keepCells(m: Mask, prefill: Uint8Array): Uint8Array {
  const out = new Uint8Array(m.grid.length)
  for (let i = 0; i < out.length; i++) out[i] = m.grid[i] && !prefill[i] ? 0 : 1
  return out
}

export function blendInpaint(orig: Uint8ClampedArray, res: Uint8ClampedArray, alpha: Float32Array, keep?: { cells: Uint8Array; gw: number; gh: number; W: number; H: number }): Uint8ClampedArray<ArrayBuffer> {
  const out = new Uint8ClampedArray(orig.length)
  for (let i = 0, p = 0; p < orig.length; i++, p += 4) {
    const a = alpha[i]
    for (let c = 0; c < 4; c++) out[p + c] = orig[p + c] * (1 - a) + res[p + c] * a
    if (!keep) continue
    const x = i % keep.W
    const y = (i - x) / keep.W
    if (!keep.cells[Math.min(keep.gh - 1, Math.floor((y * keep.gh) / keep.H)) * keep.gw + Math.min(keep.gw - 1, Math.floor((x * keep.gw) / keep.W))]) continue
    const oa = orig[p + 3] / 255
    if (oa === 0) continue
    const ba = out[p + 3] / 255
    const na = oa + ba * (1 - oa)
    for (let c = 0; c < 3; c++) out[p + c] = (orig[p + c] * oa + out[p + c] * ba * (1 - oa)) / na
    out[p + 3] = na * 255
  }
  return out
}
