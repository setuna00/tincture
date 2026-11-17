// Share one decompression budget across a file's entries and chunks to prevent decompression bombs.

export const INFLATE_LIMIT = 64 * 1024 * 1024

export class TooLargeError extends Error {
  constructor() {
    super('decompressed data exceeds the limit')
    this.name = 'TooLargeError'
  }
}

export interface InflateBudget {
  left: number
}

export const inflateBudget = (limit = INFLATE_LIMIT): InflateBudget => ({ left: limit })

export function spend(budget: InflateBudget, n: number) {
  if (n > budget.left) throw new TooLargeError()
  budget.left -= n
}

export async function inflate(data: Uint8Array, format: CompressionFormat, budget: InflateBudget = inflateBudget()): Promise<Uint8Array> {
  const reader = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream(format)).getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > budget.left) {
      await reader.cancel().catch(() => {})
      throw new TooLargeError()
    }
    chunks.push(value)
  }
  budget.left -= size
  if (chunks.length === 1) return chunks[0]
  const out = new Uint8Array(size)
  let at = 0
  for (const c of chunks) {
    out.set(c, at)
    at += c.byteLength
  }
  return out
}
