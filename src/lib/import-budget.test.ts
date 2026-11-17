import { afterEach, describe, expect, it, vi } from 'vitest'
import { checkFileSize, checkImageFile, IMAGE_FILE_LIMIT, IMAGE_MAX_PIXELS, ZIP_FILE_LIMIT } from './import-budget'
import { TooLargeError } from './inflate'
import { readImageMeta, readPngText } from './nai-image'

afterEach(() => vi.unstubAllGlobals())

function png(width: number, height: number) {
  const b = new Uint8Array(33)
  b.set([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82])
  const v = new DataView(b.buffer)
  v.setUint32(16, width)
  v.setUint32(20, height)
  return new Blob([b])
}

function jpeg(width: number, height: number) {
  const b = new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0, 2, 0xff, 0xc2, 0, 17, 8, 0, 0, 0, 0, 3, 1, 0x11, 0, 2, 0x11, 0, 3, 0x11, 0])
  const v = new DataView(b.buffer)
  v.setUint16(11, height)
  v.setUint16(13, width)
  return new Blob([b])
}

function webp(kind: string, width: number, height: number) {
  const b = new Uint8Array(30)
  const v = new DataView(b.buffer)
  b.set(new TextEncoder().encode('RIFF'), 0)
  b.set(new TextEncoder().encode(`WEBP${kind}`), 8)
  if (kind === 'VP8X') {
    for (let i = 0; i < 3; i++) { b[24 + i] = (width - 1) >>> (i * 8); b[27 + i] = (height - 1) >>> (i * 8) }
  } else if (kind === 'VP8L') {
    b[20] = 0x2f
    v.setUint32(21, (width - 1) | ((height - 1) << 14), true)
  } else {
    b.set([0x9d, 1, 0x2a], 23)
    v.setUint16(26, width, true)
    v.setUint16(28, height, true)
  }
  return new Blob([b])
}

describe('raw import budgets', () => {
  it.each([IMAGE_FILE_LIMIT, ZIP_FILE_LIMIT])('accepts just under and at %i bytes; rejects one byte over', (limit) => {
    expect(() => checkFileSize({ size: limit - 1 }, limit)).not.toThrow()
    expect(() => checkFileSize({ size: limit }, limit)).not.toThrow()
    expect(() => checkFileSize({ size: limit + 1 }, limit)).toThrow(TooLargeError)
  })

  it.each([readPngText, readImageMeta])('rejects oversized image files before any read', async (read) => {
    const file = new Blob()
    Object.defineProperty(file, 'size', { value: IMAGE_FILE_LIMIT + 1 })
    const full = vi.spyOn(file, 'arrayBuffer')
    const slice = vi.spyOn(file, 'slice')
    await expect(read(file)).rejects.toBeInstanceOf(TooLargeError)
    expect(full).not.toHaveBeenCalled()
    expect(slice).not.toHaveBeenCalled()
  })

  it('reads an image just under the raw cap', async () => {
    const file = png(1, 1)
    Object.defineProperty(file, 'size', { value: IMAGE_FILE_LIMIT - 1 })
    const full = vi.spyOn(file, 'arrayBuffer')
    await expect(readPngText(file)).resolves.toEqual({})
    expect(full).toHaveBeenCalledOnce()
  })
})

describe('image dimensions before decoding', () => {
  it('accepts PNG at one pixel under and at the cap, rejects one pixel over before full read or decode', async () => {
    await expect(checkImageFile(png(IMAGE_MAX_PIXELS - 1, 1))).resolves.toBeUndefined()
    await expect(checkImageFile(png(4096, 4096))).resolves.toBeUndefined()
    const file = png(IMAGE_MAX_PIXELS + 1, 1)
    const full = vi.spyOn(file, 'arrayBuffer')
    const decode = vi.fn()
    vi.stubGlobal('createImageBitmap', decode)
    await expect(readImageMeta(file)).rejects.toBeInstanceOf(TooLargeError)
    await expect(readPngText(file)).rejects.toBeInstanceOf(TooLargeError)
    expect(full).not.toHaveBeenCalled()
    expect(decode).not.toHaveBeenCalled()
  })

  it.each(['JPEG', 'VP8X', 'VP8L', 'VP8 '])('checks %s headers around the pixel cap', async (kind) => {
    const image = kind === 'JPEG' ? jpeg : (w: number, h: number) => webp(kind, w, h)
    await expect(checkImageFile(image(4096, 4095))).resolves.toBeUndefined()
    await expect(checkImageFile(image(4096, 4096))).resolves.toBeUndefined()
    await expect(checkImageFile(image(4096, 4097))).rejects.toBeInstanceOf(TooLargeError)
  })

  it('keeps the post-decode fallback and closes an oversized bitmap', async () => {
    const close = vi.fn()
    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue({ width: IMAGE_MAX_PIXELS + 1, height: 1, close }))
    await expect(readImageMeta(new Blob(['unknown header']))).rejects.toBeInstanceOf(TooLargeError)
    expect(close).toHaveBeenCalledOnce()
  })

  it('allows an unknown header below the fallback cap and closes its bitmap', async () => {
    const close = vi.fn()
    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue({ width: IMAGE_MAX_PIXELS - 1, height: 1, close }))
    vi.stubGlobal('OffscreenCanvas', class {
      getContext() { return { drawImage() {}, getImageData: () => ({ data: [] }) } }
    })
    await expect(readImageMeta(new Blob(['unknown header']))).resolves.toBeNull()
    expect(close).toHaveBeenCalledOnce()
  })

  it('leaves truncated headers to the decoder fallback', async () => {
    for (let i = 0; i < 30; i++) await expect(checkImageFile(webp('VP8X', 4096, 4096).slice(0, i))).resolves.toBeUndefined()
  })
})
