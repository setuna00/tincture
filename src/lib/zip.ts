// Bound total entries and decompressed bytes across the entire ZIP to prevent resource exhaustion.
import { inflate, inflateBudget, spend, TooLargeError } from './inflate'

export interface ZipEntry {
  name: string
  data: Uint8Array
}

export const ZIP_MAX_ENTRIES = 1000

export async function readZip(buf: ArrayBuffer | Uint8Array): Promise<ZipEntry[]> {
  const b = buf instanceof Uint8Array ? buf : new Uint8Array(buf)
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength)
  // ZIP comments follow EOCD, so search backward for its signature instead of assuming a fixed final offset.
  let eocd = -1
  for (let i = b.length - 22; i >= Math.max(0, b.length - 22 - 0xffff); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) {
      eocd = i
      break
    }
  }
  if (eocd < 0) throw new Error('not a zip')
  const count = dv.getUint16(eocd + 10, true)
  if (count > ZIP_MAX_ENTRIES) throw new TooLargeError()
  let at = dv.getUint32(eocd + 16, true)
  const dec = new TextDecoder()
  const budget = inflateBudget()
  const out: ZipEntry[] = []
  for (let k = 0; k < count; k++) {
    if (dv.getUint32(at, true) !== 0x02014b50) throw new Error('bad zip directory')
    const method = dv.getUint16(at + 10, true)
    const size = dv.getUint32(at + 20, true)
    const nameLen = dv.getUint16(at + 28, true)
    const extraLen = dv.getUint16(at + 30, true)
    const commentLen = dv.getUint16(at + 32, true)
    const local = dv.getUint32(at + 42, true)
    const name = dec.decode(b.subarray(at + 46, at + 46 + nameLen))
    at += 46 + nameLen + extraLen + commentLen
    // Local filename/extra lengths may differ from central-directory lengths; use the local lengths for the data offset.
    const start = local + 30 + dv.getUint16(local + 26, true) + dv.getUint16(local + 28, true)
    const raw = b.subarray(start, start + size)
    if (name.endsWith('/')) continue
    if (method === 8) out.push({ name, data: await inflate(raw, 'deflate-raw', budget) })
    else {
      spend(budget, raw.byteLength)
      out.push({ name, data: raw.slice() })
    }
  }
  return out
}

let crcTable: Uint32Array | null = null
function crc32(b: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256)
    for (let n = 0; n < 256; n++) {
      let c = n
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      crcTable[n] = c >>> 0
    }
  }
  let c = 0xffffffff
  for (let i = 0; i < b.length; i++) c = crcTable[(c ^ b[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

export function writeZip(entries: ZipEntry[]): Uint8Array {
  const enc = new TextEncoder()
  const locals: Uint8Array[] = []
  const centrals: Uint8Array[] = []
  let offset = 0
  for (const e of entries) {
    const name = enc.encode(e.name)
    const crc = crc32(e.data)
    const head = new Uint8Array(30 + name.length)
    const h = new DataView(head.buffer)
    h.setUint32(0, 0x04034b50, true)
    h.setUint16(4, 20, true)
    h.setUint16(6, 0x0800, true)
    h.setUint32(14, crc, true)
    h.setUint32(18, e.data.length, true)
    h.setUint32(22, e.data.length, true)
    h.setUint16(26, name.length, true)
    head.set(name, 30)
    const cen = new Uint8Array(46 + name.length)
    const c = new DataView(cen.buffer)
    c.setUint32(0, 0x02014b50, true)
    c.setUint16(4, 20, true)
    c.setUint16(6, 20, true)
    c.setUint16(8, 0x0800, true)
    c.setUint32(16, crc, true)
    c.setUint32(20, e.data.length, true)
    c.setUint32(24, e.data.length, true)
    c.setUint16(28, name.length, true)
    c.setUint32(42, offset, true)
    cen.set(name, 46)
    locals.push(head, e.data)
    centrals.push(cen)
    offset += head.length + e.data.length
  }
  const cenSize = centrals.reduce((a, b) => a + b.length, 0)
  const end = new Uint8Array(22)
  const d = new DataView(end.buffer)
  d.setUint32(0, 0x06054b50, true)
  d.setUint16(8, entries.length, true)
  d.setUint16(10, entries.length, true)
  d.setUint32(12, cenSize, true)
  d.setUint32(16, offset, true)
  const out = new Uint8Array(offset + cenSize + 22)
  let p = 0
  for (const part of [...locals, ...centrals, end]) {
    out.set(part, p)
    p += part.length
  }
  return out
}
