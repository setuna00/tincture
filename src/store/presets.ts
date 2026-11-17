import type { Character, Doc, Section, SectionColor } from '@/types'
import { makeSection, nextCharColor } from './doc'
import { newDocSettings } from './prefs'
import { newId } from '@/lib/nai'

type Spec = [name: string, color: SectionColor][]

export interface DocPreset {
  id: 'blank' | 'basic' | 'single' | 'multi' | 'scenery'
  name: string
  pos: Spec
  characters: number
}

export const DOC_PRESETS: DocPreset[] = [
  { id: 'blank', name: '空白', pos: [['新区块', 'sky']], characters: 0 },
  { id: 'basic', name: '基础', pos: [['主体', 'sky'], ['画风', 'rose'], ['质量', 'amber']], characters: 0 },
  {
    id: 'single',
    name: '单人',
    pos: [['主体', 'sky'], ['外观', 'lime'], ['服装', 'violet'], ['表情动作', 'pink'], ['场景', 'teal'], ['画风', 'rose'], ['质量', 'amber']],
    characters: 0,
  },
  { id: 'multi', name: '多人', pos: [['主体', 'sky'], ['场景', 'teal'], ['画风', 'rose'], ['质量', 'amber']], characters: 2 },
  { id: 'scenery', name: '风景', pos: [['场景', 'teal'], ['光影', 'orange'], ['构图', 'indigo'], ['画风', 'rose'], ['质量', 'amber']], characters: 0 },
]

const sections = (spec: Spec): Section[] => spec.map(([name, color]) => makeSection(name, [], color))

function blankCharacters(n: number): Character[] {
  const list: Character[] = []
  for (let i = 0; i < n; i++) {
    const color = nextCharColor(list.map((c) => c.color))
    list.push({ id: newId('ch'), name: '', gender: 'female', color, prompt: [makeSection('外观', [], color)], uc: [], enabled: true, center: { x: 0.5, y: 0.5 } })
  }
  return list
}

export function presetDoc(p: DocPreset, title = '未命名'): Doc {
  return {
    base: { prompt: sections(p.pos), uc: [makeSection('负面', [], 'slate')] },
    characters: blankCharacters(p.characters),
    settings: newDocSettings(),
    meta: { title, createdAt: Date.now() },
  }
}
