import { describe, expect, it } from 'vitest'
import { useGacha } from './gacha'

describe('gacha store migration', () => {
  it('migrates v5 active R18 selection without deleting tuned values', async () => {
    const templates = { 'tpl:r18': { old: { count: [2, 2] } } }
    const expected = structuredClone(templates)
    const saved = { activeTemplate: 'tpl:r18', templates }
    const migrated = await useGacha.persist.getOptions().migrate!(saved, 5) as typeof saved
    expect(migrated.activeTemplate).toBe('tpl:char')
    expect(migrated.templates).toEqual(expected)
  })
})
