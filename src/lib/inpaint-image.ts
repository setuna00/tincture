import { readImageMeta } from './nai-image'
import { blendInpaint, CELL, featherAlpha, keepCells, resampleMask, type Mask, type Pixels } from './nai-inpaint'
import { stealthPayload } from './nai-write'

export async function readPixels(blob: Blob, size?: { width: number; height: number }): Promise<Pixels> {
  const bmp = await createImageBitmap(blob)
  const W = size?.width ?? bmp.width
  const H = size?.height ?? bmp.height
  const c = new OffscreenCanvas(W, H)
  const g = c.getContext('2d', { willReadFrequently: true })!
  g.imageSmoothingQuality = 'high'
  g.drawImage(bmp, 0, 0, W, H)
  bmp.close()
  return g.getImageData(0, 0, W, H)
}

export async function sourcePng(blob: Blob, size: { width: number; height: number }): Promise<Blob> {
  const bmp = await createImageBitmap(blob)
  const c = new OffscreenCanvas(size.width, size.height)
  const g = c.getContext('2d')!
  g.fillStyle = '#808080'
  g.fillRect(0, 0, size.width, size.height)
  g.imageSmoothingQuality = 'high'
  g.drawImage(bmp, 0, 0, size.width, size.height)
  bmp.close()
  return c.convertToBlob({ type: 'image/png' })
}

/** NovelAI masks use output dimensions / 8; painted cells are opaque white and untouched cells transparent. */
export async function maskPng(m: Mask, size: { width: number; height: number }): Promise<Blob> {
  const cw = size.width / CELL
  const ch = size.height / CELL
  const cells = resampleMask(m, cw, ch)
  const c = new OffscreenCanvas(cw, ch)
  const g = c.getContext('2d')!
  const im = g.createImageData(cw, ch)
  for (let i = 0; i < cells.length; i++) if (cells[i]) im.data.set([255, 255, 255, 255], i * 4)
  g.putImageData(im, 0, 0)
  return c.convertToBlob({ type: 'image/png' })
}

/** NovelAI composites the blurred mask over the original, then restores original alpha in prefill-only cells.
 * Stealth metadata occupies alpha LSBs, preserving opacity apart from the lowest bit. */
export async function composite(result: Blob, original: Blob, m: Mask, size: { width: number; height: number }, prefill: Uint8Array | null): Promise<Blob> {
  const { width: W, height: H } = size
  const [orig, res] = await Promise.all([readPixels(original, size), readPixels(result, size)])
  const cw = W / CELL
  const ch = H / CELL
  const alpha = featherAlpha(resampleMask(m, cw, ch), cw, ch, W, H)
  const keep = prefill ? { cells: keepCells(m, prefill), gw: m.gw, gh: m.gh, W, H } : undefined
  const out = blendInpaint(orig.data as Uint8ClampedArray, res.data as Uint8ClampedArray, alpha, keep)
  const meta = await readImageMeta(result).catch(() => null)
  if (meta) {
    const payload = await stealthPayload(meta)
    const bits = payload.length * 8
    if (bits <= W * H)
      for (let i = 0; i < bits; i++) {
        const idx = ((i % H) * W + Math.floor(i / H)) * 4 + 3
        out[idx] = (out[idx] & 0xfe) | ((payload[i >> 3] >> (7 - (i & 7))) & 1)
      }
  }
  const c = new OffscreenCanvas(W, H)
  c.getContext('2d')!.putImageData(new ImageData(out, W, H), 0, 0)
  return c.convertToBlob({ type: 'image/png' })
}
