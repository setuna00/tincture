import { readImageMeta } from './nai-image'

const TEXT_KEYS = ['Title', 'Description', 'Software', 'Source', 'Generation time', 'Comment']

export const isPng = (b: Uint8Array) => b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47
export const isWebp = (b: Uint8Array) => b.length > 12 && String.fromCharCode(...b.subarray(0, 4)) === 'RIFF' && String.fromCharCode(...b.subarray(8, 12)) === 'WEBP'

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

function crc32(data: Uint8Array): number {
  let c = 0xffffffff
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length)
  const v = new DataView(out.buffer)
  v.setUint32(0, data.length)
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i)
  out.set(data, 8)
  v.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)))
  return out
}

const latin1Bytes = (s: string) => Uint8Array.from([...s].map((c) => c.charCodeAt(0)))
const concat = (parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let at = 0
  for (const p of parts) {
    out.set(p, at)
    at += p.length
  }
  return out
}

/** PNG tEXt requires Latin-1; use uncompressed UTF-8 iTXt when characters fall outside that encoding. */
export function textChunk(keyword: string, text: string): Uint8Array {
  const key = latin1Bytes(keyword.slice(0, 79))
  const latin = [...text].every((c) => c.codePointAt(0)! < 256)
  if (latin) return chunk('tEXt', concat([key, new Uint8Array([0]), latin1Bytes(text)]))
  return chunk('iTXt', concat([key, new Uint8Array([0, 0, 0, 0, 0]), new TextEncoder().encode(text)]))
}

export function insertTextChunks(png: Uint8Array, entries: [string, string][]): Uint8Array {
  const ihdrEnd = 8 + 12 + new DataView(png.buffer, png.byteOffset).getUint32(8)
  return concat([png.subarray(0, ihdrEnd), ...entries.map(([k, v]) => textChunk(k, v)), png.subarray(ihdrEnd)])
}

async function deflate(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new CompressionStream('deflate'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

export async function encodePng(rgba: Uint8Array | Uint8ClampedArray, width: number, height: number): Promise<Uint8Array> {
  const stride = width * 4
  const raw = new Uint8Array((stride + 1) * height)
  for (let y = 0; y < height; y++) {
    const row = y * stride
    const out = y * (stride + 1)
    raw[out] = 4
    for (let x = 0; x < stride; x++) {
      const a = x >= 4 ? rgba[row + x - 4] : 0
      const b = y > 0 ? rgba[row - stride + x] : 0
      const c = x >= 4 && y > 0 ? rgba[row - stride + x - 4] : 0
      const p = a + b - c
      const pa = Math.abs(p - a)
      const pb = Math.abs(p - b)
      const pc = Math.abs(p - c)
      const pred = pa <= pb && pa <= pc ? a : pb <= pc ? b : c
      raw[out + 1 + x] = (rgba[row + x] - pred) & 0xff
    }
  }
  const ihdr = new Uint8Array(13)
  const v = new DataView(ihdr.buffer)
  v.setUint32(0, width)
  v.setUint32(4, height)
  ihdr.set([8, 6, 0, 0, 0], 8)
  return concat([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', await deflate(raw)), chunk('IEND', new Uint8Array(0))])
}

/** Canvas 2D premultiplication loses RGB precision in translucent pixels; prefer unpremultiplied WebGL reads. */
async function decodeRgba(blob: Blob): Promise<{ data: Uint8Array | Uint8ClampedArray; width: number; height: number }> {
  const bmp = await createImageBitmap(blob, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' })
  const { width, height } = bmp
  try {
    const canvas = new OffscreenCanvas(width, height)
    const gl = canvas.getContext('webgl2', { premultipliedAlpha: false, antialias: false })
    if (gl) {
      const tex = gl.createTexture()
      gl.bindTexture(gl.TEXTURE_2D, tex)
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false)
      gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, bmp)
      const fb = gl.createFramebuffer()
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb)
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0)
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE) {
        const data = new Uint8Array(width * height * 4)
        gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, data)
        gl.deleteFramebuffer(fb)
        gl.deleteTexture(tex)
        return { data, width, height }
      }
    }
    const c2 = new OffscreenCanvas(width, height)
    const g = c2.getContext('2d', { willReadFrequently: true })
    if (!g) throw new Error('canvas 2d 不可用')
    g.drawImage(bmp, 0, 0)
    return { data: g.getImageData(0, 0, width, height).data, width, height }
  } finally {
    bmp.close()
  }
}

export async function toPngBlob(blob: Blob): Promise<Blob> {
  const head = new Uint8Array(await blob.slice(0, 16).arrayBuffer())
  if (isPng(head)) return blob.type === 'image/png' ? blob : new Blob([blob], { type: 'image/png' })
  const meta = (await readImageMeta(blob)) ?? {}
  const { data, width, height } = await decodeRgba(blob)
  const png = await encodePng(data, width, height)
  const entries = TEXT_KEYS.filter((k) => typeof meta[k] === 'string').map((k) => [k, meta[k]] as [string, string])
  return new Blob([insertTextChunks(png, entries) as BlobPart], { type: 'image/png' })
}
