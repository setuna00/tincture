import { useEffect, useState } from 'react'
import { matchTags } from '@/lib/tagdb'
import type { Chip, TagEntry } from '@/types'
import { ChipFace, chipAttrs } from './chip-face'

const NONE: TagEntry[] = []

export function useGuesses(text: string, enabled: boolean): TagEntry[] {
  const [got, setGot] = useState<{ text: string; tags: TagEntry[] } | null>(null)
  useEffect(() => {
    if (!enabled) return
    let alive = true
    matchTags(text).then((r) => alive && setGot({ text, tags: r.map((x) => x.tag) }))
    return () => {
      alive = false
    }
  }, [text, enabled])
  return enabled && got?.text === text ? got.tags : NONE
}

export function AltChip({ tag, onPick, testId }: { tag: TagEntry; onPick: (t: TagEntry) => void; testId: string }) {
  const c: Chip = { id: tag.name, text: tag.name, type: tag.category === 'artist' ? 'artist' : 'tag', weight: 1, disabled: false }
  return (
    <button type="button" className="chip alt-chip" {...chipAttrs(c)} data-chip-id={undefined} onClick={() => onPick(tag)} data-testid={testId}>
      <ChipFace chip={c} />
    </button>
  )
}
