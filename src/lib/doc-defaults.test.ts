import { afterEach, describe, expect, it } from 'vitest'
import { defaultSettings } from '@/store/doc'
import { migratePrefs, newDocSettings, usePrefs } from '@/store/prefs'
import { blankDoc, exampleDocTemplates, sampleDoc } from '@/store/sample'
import type { DocSettings } from '@/types'
import { fillDocDefaults, isV5Default } from './doc-defaults'
import { buildImportedDoc, parseNaiImage } from './nai-image'
import { naiMetadata } from './nai-write'

const mine = (): DocSettings => ({
  ...defaultSettings(),
  model: 'v5-curated',
  ucPreset: 'light',
  qualityTags: 'none',
  useCoords: true,
  gen: { width: 1024, height: 1024, steps: 28, scale: 6, cfgRescale: 0.2, sampler: 'k_dpmpp_2m', seed: 42 },
})

afterEach(() => usePrefs.getState().set({ docDefaults: null }))

describe('新文档的默认设置', () => {
  it('没设过 = V5 默认', () => {
    expect(fillDocDefaults(null)).toEqual(defaultSettings())
    expect(newDocSettings()).toEqual(defaultSettings())
    expect(isV5Default(null)).toBe(true)
  })

  it("设过的照用，seed 一律随机、角色位置一律 AI's Choice", () => {
    const s = fillDocDefaults(mine())
    expect(s).toEqual({ ...mine(), useCoords: false, gen: { ...mine().gen, seed: null } })
    expect(isV5Default({ ...defaultSettings(), gen: { ...defaultSettings().gen, seed: 7 } })).toBe(true)
    expect(isV5Default({ ...defaultSettings(), useCoords: true })).toBe(true)
    expect(isV5Default(mine())).toBe(false)
    expect(isV5Default({ ...defaultSettings(), transparent: true })).toBe(false)
  })

  it('旧存档里没有的设置项补 V5 默认；每次给新对象', () => {
    const { transparent: _, ...old } = mine()
    const s = fillDocDefaults(old as DocSettings)
    expect(s.transparent).toBe(false)
    expect(s.model).toBe('v5-curated')
    const saved = mine()
    const a = fillDocDefaults(saved)
    a.gen.steps = 1
    a.model = 'v5-full'
    expect(saved.gen.steps).toBe(28)
    expect(saved.model).toBe('v5-curated')
    expect(fillDocDefaults(saved).gen).not.toBe(fillDocDefaults(saved).gen)
  })

  it('偏好 v5 → v6：没有默认设置 = null；已有的照留', () => {
    expect(migratePrefs({ theme: 'light', nsfw: 'r18' }).docDefaults).toBeNull()
    expect(migratePrefs({ docDefaults: mine() }).docDefaults).toEqual(mine())
    expect(migratePrefs(undefined).docDefaults).toBeNull()
  })

  it('偏好 v6 → v7：右栏宽度两个 tab 各一份 → 一份（用图片生成那份）；没记过的不写（用默认）', () => {
    expect(migratePrefs({ rightW: { gen: 720, copy: 300 } }).rightW).toBe(720)
    expect(migratePrefs({ rightW: 500 }).rightW).toBe(500)
    expect('rightW' in migratePrefs({ theme: 'light' })).toBe(false)
  })

  it('prefs v9 → v10: the old default becomes automatic; manual widths survive', () => {
    expect('rightW' in migratePrefs({ rightW: 640 })).toBe(false)
    expect('rightW' in migratePrefs({ rightW: { gen: 640 } })).toBe(false)
    expect(migratePrefs({ rightW: 500 }).rightW).toBe(500)
    expect(migratePrefs({ rightW: 720 }).rightW).toBe(720)
    expect('rightW' in migratePrefs({ rightW: null })).toBe(false)
  })

  it('空白 / 示例用设置页里的默认；示例模板照旧 V5 默认', () => {
    usePrefs.getState().set({ docDefaults: mine() })
    const want = fillDocDefaults(mine())
    expect(blankDoc().settings).toEqual(want)
    expect(sampleDoc().settings).toEqual(want)
    for (const t of exampleDocTemplates()) expect(t.doc.settings).toEqual(defaultSettings())
    const a = blankDoc()
    a.settings.gen.steps = 3
    expect(blankDoc().settings.gen.steps).toBe(28)
  })

  it('从图片导入到新 tab：没勾的项用默认，勾了的用图里的', () => {
    usePrefs.getState().set({ docDefaults: mine() })
    const src = sampleDoc()
    src.settings = { ...defaultSettings(), gen: { ...defaultSettings().gen, steps: 40, seed: 123 } }
    const p = parseNaiImage(naiMetadata(src))!
    const { doc } = buildImportedDoc(p, new Set(['prompt', 'steps']), { base: null, appendChars: false }, newDocSettings())
    expect(doc.settings.gen.steps).toBe(40)
    expect(doc.settings.gen.width).toBe(1024)
    expect(doc.settings.gen.sampler).toBe('k_dpmpp_2m')
    expect(doc.settings.model).toBe('v5-curated')
    expect(doc.settings.gen.seed).toBeNull()
  })
})
