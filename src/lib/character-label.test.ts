import { describe, expect, it } from 'vitest'
import { sampleDoc } from '@/store/sample'
import { boxLabel } from '@/components/editor/labels'
import { characterLabel } from './character-label'
import { exportDoc } from './nai'

describe('characterLabel', () => {
  it('uses the current document position for an unnamed character', () => {
    const doc = sampleDoc()
    const c = doc.characters[1]
    c.name = '   '
    expect(characterLabel(doc, c)).toBe('角色 2')
    doc.characters.splice(1, 1)
    doc.characters.unshift(c)
    expect(characterLabel(doc, c)).toBe(`角色 ${doc.characters.indexOf(c) + 1}`)
    expect(c.name).toBe('   ')
  })

  it('trims a named character and adds the position only for numbered headings', () => {
    const doc = sampleDoc()
    const c = doc.characters[0]
    c.name = ' 芙莉莲 '
    expect(characterLabel(doc, c)).toBe('芙莉莲')
    expect(characterLabel(doc, c, true)).toBe('角色 1 芙莉莲')
    expect(c.name).toBe(' 芙莉莲 ')
  })

  it('gives an unnamed character a chip context menu title', () => {
    const doc = sampleDoc()
    const c = doc.characters[0]
    c.name = ''
    expect(boxLabel(doc, { kind: 'char', charId: c.id, field: 'prompt' })).toBe('角色 1 · 正面')
    expect(boxLabel(doc, { kind: 'char', charId: c.id, field: 'uc' })).toBe('角色 1 · 负面')
  })

  it.each(['', '   ', '角色 1', '芙莉莲'])('does not repeat the position in copy-all headings for %j', (name) => {
    const doc = sampleDoc()
    const c = doc.characters[0]
    c.name = name
    const boxes = exportDoc(doc).filter((b) => b.char?.id === c.id)
    const heading = name === '芙莉莲' ? '角色 1 芙莉莲' : '角色 1'
    expect(boxes.map((b) => `# ${b.label}`)).toEqual([`# ${heading} · 正面`, `# ${heading} · 负面`])
  })
})
