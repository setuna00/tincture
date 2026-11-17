import { describe, expect, it } from 'vitest'
import { inflate, inflateBudget, INFLATE_LIMIT, TooLargeError } from './inflate'
import { decodeStealthAlpha, readImageMeta, readPngText } from './nai-image'
import { readZip, writeZip, ZIP_MAX_ENTRIES } from './zip'

const enc = (s: string) => new TextEncoder().encode(s)
const compress = async (data: Uint8Array, format: CompressionFormat) => new Uint8Array(await new Response(new Blob([data as BlobPart]).stream().pipeThrough(new CompressionStream(format))).arrayBuffer())
const bomb = () => new Uint8Array(INFLATE_LIMIT + 1)

function png(chunks: { type: string; data: Uint8Array }[]): Blob {
  const parts: Uint8Array[] = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])]
  for (const c of [...chunks, { type: 'IEND', data: new Uint8Array() }]) {
    const head = new Uint8Array(8)
    new DataView(head.buffer).setUint32(0, c.data.length)
    head.set([...c.type].map((ch) => ch.charCodeAt(0)), 4)
    parts.push(head, c.data, new Uint8Array(4))
  }
  return new Blob(parts as BlobPart[])
}
const ztxt = async (key: string, body: Uint8Array) => ({ type: 'zTXt', data: new Uint8Array([...enc(key), 0, 0, ...(await compress(body, 'deflate'))]) })

async function deflatedZip(entries: { name: string; data: Uint8Array }[]): Promise<Uint8Array> {
  const parts: Uint8Array[] = []
  const central: Uint8Array[] = []
  let offset = 0
  for (const e of entries) {
    const name = enc(e.name)
    const packed = await compress(e.data, 'deflate-raw')
    const local = new Uint8Array(30 + name.length)
    const l = new DataView(local.buffer)
    l.setUint32(0, 0x04034b50, true)
    l.setUint16(8, 8, true)
    l.setUint32(18, packed.length, true)
    l.setUint32(22, e.data.length, true)
    l.setUint16(26, name.length, true)
    local.set(name, 30)
    const cen = new Uint8Array(46 + name.length)
    const c = new DataView(cen.buffer)
    c.setUint32(0, 0x02014b50, true)
    c.setUint16(10, 8, true)
    c.setUint32(20, packed.length, true)
    c.setUint32(24, e.data.length, true)
    c.setUint16(28, name.length, true)
    c.setUint32(42, offset, true)
    cen.set(name, 46)
    parts.push(local, packed)
    central.push(cen)
    offset += local.length + packed.length
  }
  const size = central.reduce((n, b) => n + b.length, 0)
  const end = new Uint8Array(22)
  const d = new DataView(end.buffer)
  d.setUint32(0, 0x06054b50, true)
  d.setUint16(8, entries.length, true)
  d.setUint16(10, entries.length, true)
  d.setUint32(12, size, true)
  d.setUint32(16, offset, true)
  const out = new Uint8Array(offset + size + 22)
  let at = 0
  for (const p of [...parts, ...central, end]) {
    out.set(p, at)
    at += p.length
  }
  return out
}

describe('inflate', () => {
  it('decompresses and takes the output from the budget', async () => {
    const budget = inflateBudget(100)
    expect(new TextDecoder().decode(await inflate(await compress(enc('hello hello'), 'deflate-raw'), 'deflate-raw', budget))).toBe('hello hello')
    expect(budget.left).toBe(89)
  })
  it('stops past the budget', async () => {
    await expect(inflate(await compress(new Uint8Array(101), 'deflate-raw'), 'deflate-raw', inflateBudget(100))).rejects.toBeInstanceOf(TooLargeError)
    await expect(inflate(await compress(bomb(), 'gzip'), 'gzip')).rejects.toBeInstanceOf(TooLargeError)
  })
})

describe('readZip limits', () => {
  it('more entries than the limit', async () => {
    const many = Array.from({ length: ZIP_MAX_ENTRIES + 1 }, (_, i) => ({ name: `${i}.txt`, data: new Uint8Array([i & 0xff]) }))
    await expect(readZip(writeZip(many))).rejects.toBeInstanceOf(TooLargeError)
    expect(await readZip(writeZip(many.slice(0, ZIP_MAX_ENTRIES)))).toHaveLength(ZIP_MAX_ENTRIES)
  })
  it('one entry expanding past the limit', async () => {
    await expect(readZip(await deflatedZip([{ name: 'image_0.png', data: bomb() }]))).rejects.toBeInstanceOf(TooLargeError)
  })
  it('entries together past the limit', async () => {
    const half = new Uint8Array(INFLATE_LIMIT / 2 + 1)
    await expect(readZip(await deflatedZip([{ name: 'a', data: half }]))).resolves.toHaveLength(1)
    await expect(readZip(await deflatedZip([{ name: 'a', data: half }, { name: 'b', data: half }]))).rejects.toBeInstanceOf(TooLargeError)
  })
})

describe('PNG metadata limits', () => {
  it('a zTXt chunk expanding past the limit is an error, not a skipped chunk', async () => {
    const file = png([await ztxt('Comment', bomb())])
    await expect(readPngText(file)).rejects.toBeInstanceOf(TooLargeError)
    await expect(readImageMeta(file)).rejects.toBeInstanceOf(TooLargeError)
  })
  it('chunks share one budget', async () => {
    const half = new Uint8Array(INFLATE_LIMIT / 2 + 1)
    expect(Object.keys(await readPngText(png([await ztxt('A', half)])))).toEqual(['A'])
    await expect(readPngText(png([await ztxt('A', half), await ztxt('B', half)]))).rejects.toBeInstanceOf(TooLargeError)
  })
  it('the stealth alpha payload is bounded too', async () => {
    const payload = await compress(bomb(), 'gzip')
    const bytes = [...enc('stealth_pngcomp'), ...[24, 16, 8, 0].map((s) => ((payload.length * 8) >>> s) & 0xff), ...payload]
    const h = bytes.length * 8
    const rgba = new Uint8ClampedArray(h * 4)
    for (let i = 0; i < h; i++) rgba[i * 4 + 3] = 254 | ((bytes[i >> 3] >> (7 - (i & 7))) & 1)
    await expect(decodeStealthAlpha(rgba, 1, h)).rejects.toBeInstanceOf(TooLargeError)
  })
})
