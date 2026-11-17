import type { Character, Doc } from '@/types'

export function characterLabel(doc: Pick<Doc, 'characters'>, c: Pick<Character, 'id' | 'name'>, numbered = false): string {
  const position = `角色 ${doc.characters.findIndex((x) => x.id === c.id) + 1}`
  const name = c.name.trim()
  return numbered && name && name !== position ? `${position} ${name}` : name || position
}
