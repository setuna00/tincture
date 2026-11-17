import { describe, expect, it } from 'vitest'
import { createDocStore, defaultSettings, makeSection } from '@/store/doc'
import type { Doc, Section } from '@/types'
import { basePrompt, exportString, parsePrompt, toChip } from './nai'
import { composePrompt, composeUc, effectiveSettings } from './nai-write'
import { presetChips, presetDupChips, presetParts, presetView } from './preset-block'

const sec = (text: string, extra: Partial<Section> = {}): Section => ({ ...makeSection('s', parsePrompt(text).map(toChip), 'slate'), ...extra })
const doc = (prompt: Section[], uc: Section[], settings: Partial<Doc['settings']> = {}): Doc => ({
  base: { prompt, uc },
  characters: [],
  settings: { ...defaultSettings(), ...settings },
  meta: { title: 't', createdAt: 0 },
})
const sent = (d: Doc) => {
  const s = effectiveSettings(d.settings)
  const pos = composePrompt(basePrompt(d), { ...s, mode: 'anime' })
  return { pos, uc: composeUc(exportString(d.base.uc), s, pos) }
}

describe('presetView', () => {
  it('V5 Full: quality Standard words, UC Heavy with the nsfw NAI adds first', () => {
    const d = doc([sec('1girl')], [sec('bad hands')])
    const q = presetView(d, 'prompt')
    expect(q).toMatchObject({ id: 'standard', label: 'Standard', text: 'very aesthetic, masterpiece, no text', nsfw: false, locked: false })
    expect(q.options).toEqual(['standard', 'light', 'none'])
    const u = presetView(d, 'uc')
    expect(u).toMatchObject({ id: 'heavy', label: 'Heavy', nsfw: true, locked: false })
    expect(presetParts(u)[0].text).toBe('nsfw')
    expect(presetParts(u)).toHaveLength(18)
  })

  it('no nsfw when the positive already has it or the model is safe', () => {
    expect(presetView(doc([sec('1girl, nsfw')], []), 'uc').nsfw).toBe(false)
    expect(presetView(doc([sec('1girl')], [], { model: 'v5-curated' }), 'uc').nsfw).toBe(false)
    expect(presetView(doc([sec('1girl')], [], { nsfw: true }), 'uc').nsfw).toBe(false)
  })

  it('None: no words', () => {
    const d = doc([], [], { qualityTags: 'none', ucPreset: 'none' })
    expect(presetView(d, 'prompt')).toMatchObject({ id: 'none', label: 'None', text: '' })
    expect(presetView(d, 'uc')).toMatchObject({ id: 'none', text: '', nsfw: false })
    expect(presetParts(presetView(d, 'uc'))).toEqual([])
  })

  it('Effort Medium locks UC to Heavy', () => {
    const v = presetView(doc([], [], { effort: 'medium', ucPreset: 'light' }), 'uc')
    expect(v).toMatchObject({ id: 'heavy', locked: true })
  })

  it('older models list fewer presets', () => {
    expect(presetView(doc([], [], { model: 'v4-full' }), 'prompt').options).toEqual(['standard', 'none'])
    expect(presetView(doc([], [], { model: 'v4-full' }), 'uc').options).toEqual(['heavy', 'light', 'none'])
  })
})

describe('presetDupChips', () => {
  it('only chips in this box: weight 1, enabled, section not muted', () => {
    const d = doc(
      [sec('very aesthetic, 1.2::masterpiece::, no text'), sec('no text', { muted: true })],
      [sec('lowres, bad hands'), sec('very aesthetic')],
    )
    const q = presetDupChips(d, presetView(d, 'prompt'))
    expect(q.map((c) => c.text)).toEqual(['very aesthetic', 'no text'])
    const u = presetDupChips(d, presetView(d, 'uc'))
    expect(u.map((c) => c.text)).toEqual(['lowres'])
  })

  it('disabled chips and None presets are left alone', () => {
    const s = sec('very aesthetic')
    s.chips[0].disabled = true
    const d = doc([s], [])
    expect(presetDupChips(d, presetView(d, 'prompt'))).toEqual([])
    const off = doc([sec('very aesthetic')], [], { qualityTags: 'none' })
    expect(presetDupChips(off, presetView(off, 'prompt'))).toEqual([])
  })
})

describe('presetToSection', () => {
  const convert = (d: Doc, field: 'prompt' | 'uc') => {
    const store = createDocStore(d)
    const v = presetView(store.getState().doc, field)
    store.getState().presetToSection(field, makeSection(`x ${v.label}`, presetChips(v)))
    return store
  }

  it('quality: section at the end of the positive, preset None, one undo step, same prompt sent', () => {
    const d = doc([sec('1girl'), sec('smile')], [sec('bad hands')])
    const store = convert(d, 'prompt')
    const after = store.getState().doc
    expect(after.settings.qualityTags).toBe('none')
    expect(after.base.prompt).toHaveLength(3)
    expect(after.base.prompt[2].chips.map((c) => c.text)).toEqual(['very aesthetic', 'masterpiece', 'no text'])
    expect(sent(after)).toEqual(sent(d))
    expect(store.temporal.getState().pastStates).toHaveLength(1)
    store.temporal.getState().undo()
    expect(store.getState().doc.settings.qualityTags).toBe('standard')
    expect(store.getState().doc.base.prompt).toHaveLength(2)
  })

  it('UC: section first in the negative, with the nsfw NAI added, same UC sent', () => {
    const d = doc([sec('1girl')], [sec('bad hands')])
    const store = convert(d, 'uc')
    const after = store.getState().doc
    expect(after.settings.ucPreset).toBe('none')
    expect(after.base.uc[0].chips[0].text).toBe('nsfw')
    expect(after.base.uc[1].chips[0].text).toBe('bad hands')
    expect(sent(after)).toEqual(sent(d))
  })

  it('UC on a safe model: no nsfw added, same UC sent', () => {
    const d = doc([sec('1girl')], [], { model: 'v5-curated', ucPreset: 'light' })
    const after = convert(d, 'uc').getState().doc
    expect(after.base.uc[0].chips.some((c) => c.text === 'nsfw')).toBe(false)
    expect(sent(after)).toEqual(sent(d))
  })
})
