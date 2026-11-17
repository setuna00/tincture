import { TooLargeError } from './inflate'

export const IMAGE_FILE_LIMIT = 32 * 1024 * 1024
export const ZIP_FILE_LIMIT = 128 * 1024 * 1024
export const IMAGE_MAX_PIXELS = 16_777_216

export function checkFileSize(file: Pick<Blob, 'size'>, limit: number) {
  if (file.size > limit) throw new TooLargeError()
}

export function checkImageSize(width: number, height: number) {
  if (width * height > IMAGE_MAX_PIXELS) throw new TooLargeError()
}

function headerSize(b: Uint8Array): [number, number] | null {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength)
  const ascii = (a: number, z: number) => String.fromCharCode(...b.subarray(a, z))
  if (b.length >= 24 && [137, 80, 78, 71, 13, 10, 26, 10].every((n, i) => b[i] === n) && v.getUint32(8) === 13 && ascii(12, 16) === 'IHDR') {
    return [v.getUint32(16), v.getUint32(20)]
  }
  if (b.length >= 20 && ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') {
    const kind = ascii(12, 16)
    const u24 = (p: number) => b[p] | (b[p + 1] << 8) | (b[p + 2] << 16)
    if (kind === 'VP8X' && b.length >= 30) return [1 + u24(24), 1 + u24(27)]
    if (kind === 'VP8L' && b.length >= 25 && b[20] === 0x2f) return [1 + (v.getUint32(21, true) & 0x3fff), 1 + ((v.getUint32(21, true) >>> 14) & 0x3fff)]
    if (kind === 'VP8 ' && b.length >= 30 && b[23] === 0x9d && b[24] === 1 && b[25] === 0x2a) return [v.getUint16(26, true) & 0x3fff, v.getUint16(28, true) & 0x3fff]
  }
  if (b[0] === 0xff && b[1] === 0xd8) {
    let p = 2
    while (p + 4 <= b.length && b[p] === 0xff) {
      if (b[p + 1] === 0xff) { p++; continue }
      const marker = b[p + 1]
      if (marker === 0xda || marker === 0xd9) break
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { p += 2; continue }
      const len = v.getUint16(p + 2)
      if (len < 2 || p + 2 + len > b.length) break
      if (len >= 7 && marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return [v.getUint16(p + 7), v.getUint16(p + 5)]
      p += 2 + len
    }
  }
  return null
}

export async function checkImageFile(file: Blob) {
  checkFileSize(file, IMAGE_FILE_LIMIT)
  // A bounded prefix covers PNG/WebP and ordinary JPEG headers without reading the full file.
  const size = headerSize(new Uint8Array(await file.slice(0, 64 * 1024).arrayBuffer()))
  if (size) checkImageSize(...size)
}
