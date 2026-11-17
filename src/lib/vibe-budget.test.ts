import { describe, expect, it, vi } from 'vitest'
import { TooLargeError } from './inflate'
import { BUNDLE_ID, embeddedVibeText, parseVibeText, readVibeFile, VIBE_ENCODED_LIMIT, VIBE_ID, VIBE_MAX_ENTRIES, VIBE_TEXT_LIMIT, vibeImportBudget } from './vibe-file'

const image = (data = 'AAAA') => ({ identifier: VIBE_ID, type: 'image', image: data })
const bundle = (vibes: unknown[]) => JSON.stringify({ identifier: BUNDLE_ID, vibes })

describe('Vibe raw text budget', () => {
  it('checks File.size before text()', async () => {
    const file = new Blob(['{}'])
    Object.defineProperty(file, 'size', { value: VIBE_TEXT_LIMIT + 1 })
    const read = vi.spyOn(file, 'text')
    await expect(readVibeFile(file)).rejects.toBeInstanceOf(TooLargeError)
    expect(read).not.toHaveBeenCalled()
  })

  it('reads a file whose reported size is just under the cap', async () => {
    const file = new Blob([JSON.stringify(image())])
    Object.defineProperty(file, 'size', { value: VIBE_TEXT_LIMIT - 1 })
    await expect(readVibeFile(file)).resolves.toHaveLength(1)
  })

  it('checks string input before parsing at the text boundary', () => {
    const under = '{}'.padEnd(VIBE_TEXT_LIMIT - 1, ' ')
    expect(parseVibeText(under)).toBeNull()
    expect(parseVibeText(under + ' ')).toBeNull()
    expect(() => parseVibeText(under + '  ')).toThrow(TooLargeError)
  })

  it('rejects oversized embedded base64 before decoding', () => {
    expect(() => embeddedVibeText('A'.repeat(Math.ceil(VIBE_TEXT_LIMIT / 3) * 4 + 1))).toThrow(TooLargeError)
  })

  it('allows embedded base64 just below its cap without changing its decoded JSON', () => {
    const text = JSON.stringify(image())
    const decode = vi.spyOn(globalThis, 'atob').mockReturnValue(text)
    try {
      expect(embeddedVibeText('A'.repeat(Math.ceil(VIBE_TEXT_LIMIT / 3) * 4 - 1))).toBe(text)
      expect(decode).toHaveBeenCalledOnce()
    } finally {
      decode.mockRestore()
    }
  })
})

describe('Vibe structure budgets', () => {
  it('checks bundle entries just under, at and over the cap, including invalid entries', () => {
    expect(parseVibeText(bundle(Array.from({ length: VIBE_MAX_ENTRIES - 1 }, () => image())))).toHaveLength(VIBE_MAX_ENTRIES - 1)
    expect(parseVibeText(bundle(Array.from({ length: VIBE_MAX_ENTRIES }, () => image())))).toHaveLength(VIBE_MAX_ENTRIES)
    expect(() => parseVibeText(bundle(Array(VIBE_MAX_ENTRIES + 1).fill(null)))).toThrow(TooLargeError)
  })

  it('counts encoding entries even for unknown models or masked encodings', () => {
    const file = (n: number) => JSON.stringify({ ...image(), encodings: { unknown: Object.fromEntries(Array.from({ length: n }, (_, i) => [i, { encoding: 'A', params: { mask: 'M' } }])) } })
    expect(parseVibeText(file(VIBE_MAX_ENTRIES - 3))).toHaveLength(1)
    expect(parseVibeText(file(VIBE_MAX_ENTRIES - 2))).toHaveLength(1)
    expect(() => parseVibeText(file(VIBE_MAX_ENTRIES - 1))).toThrow(TooLargeError)
  })

  it('bounds the combined encoded strings including thumbnails and ignored encodings', () => {
    const data = 'A'.repeat(VIBE_ENCODED_LIMIT - 2)
    const file = (extra: string) => JSON.stringify({ ...image(data), thumbnail: 'T', encodings: { unknown: { key: { encoding: extra } } } })
    expect(parseVibeText(file(''))).toHaveLength(1)
    expect(parseVibeText(file('A'))).toHaveLength(1)
    expect(() => parseVibeText(file('AA'))).toThrow(TooLargeError)
  })

  it('shares entry and encoded budgets across files in one selection', () => {
    const budget = vibeImportBudget()
    budget.entries.left = 2
    budget.encoded.left = 6
    expect(parseVibeText(JSON.stringify(image('AAA')), budget)).toHaveLength(1)
    expect(parseVibeText(JSON.stringify(image('AAA')), budget)).toHaveLength(1)
    expect(() => parseVibeText(JSON.stringify(image('A')), budget)).toThrow(TooLargeError)
    const encoded = vibeImportBudget()
    encoded.encoded.left = 5
    expect(parseVibeText(JSON.stringify(image('AAA')), encoded)).toHaveLength(1)
    expect(() => parseVibeText(JSON.stringify(image('AAA')), encoded)).toThrow(TooLargeError)
  })

  it('still returns null for malformed JSON', () => {
    expect(parseVibeText('{broken')).toBeNull()
    expect(embeddedVibeText(btoa('{broken'))).toBeNull()
  })

  it('ignores malformed string encodings without expanding them into character entries', () => {
    expect(parseVibeText(JSON.stringify({ ...image(), encodings: 'A'.repeat(VIBE_MAX_ENTRIES + 1) }))).toHaveLength(1)
  })

  it('bounds model groups even if all are unknown and empty', () => {
    const file = (n: number) => JSON.stringify({ ...image(), encodings: Object.fromEntries(Array.from({ length: n }, (_, i) => [i, {}])) })
    expect(parseVibeText(file(VIBE_MAX_ENTRIES - 2))).toHaveLength(1)
    expect(() => parseVibeText(file(VIBE_MAX_ENTRIES))).toThrow(TooLargeError)
  })
})
