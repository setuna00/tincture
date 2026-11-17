import { describe, expect, it } from 'vitest'
import { introDoc, sampleDoc } from './sample'
import { allSections, normalizeDoc } from './doc'
import { exportDoc } from '@/lib/nai'
import { naiDupChips } from '@/lib/cleanup'

describe('release introduction', () => {
  it('keeps an immediately usable two-character sample through normalization', () => {
    const doc = normalizeDoc(introDoc())
    expect(doc.characters.map((c) => [c.name, c.gender, c.color])).toEqual([['芙莉莲', 'female', 'lime'], ['菲伦', 'female', 'violet']])
    const artist = allSections(doc).find((s) => s.random?.kind === 'artist')!
    expect(artist.chips).toHaveLength(3)
    expect(artist.chips.map((c) => c.weight)).toEqual([1.1, 1, 0.7])
    expect(artist.random?.count).toEqual([3, 3])
    expect(allSections(doc).some((s) => s.muted)).toBe(true)
    expect(allSections(doc).every((s) => !!s.note)).toBe(true)
    expect(doc.characters.every((c) => !!c.note)).toBe(true)
    expect(doc.settings.gen).toMatchObject({ width: 832, height: 1216, steps: 23 })
    expect(doc.settings.gen.nSamples ?? 1).toBe(1)
    const text = exportDoc(doc)[0].text
    expect(text).toContain('2girls')
    for (const excluded of ['cloud', 'sunlight', '1boy']) expect(text).not.toContain(excluded)
    expect(doc.characters[1].uc[0].name).toBe('防串色')
    expect(naiDupChips(doc)).toEqual([])
    expect(doc.characters[1].prompt[0].chips.map((c) => c.text)).not.toContain('princess cut')
    expect(sampleDoc().characters).toHaveLength(3)
  })
})
