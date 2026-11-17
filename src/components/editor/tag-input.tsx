import { useRef, useState } from 'react'
import { toast } from 'sonner'
import { findAiJson } from '@/lib/ai-doc'
import { isTextBlock, looksLikePromptString, newId, parsePrompt, toChip } from '@/lib/nai'
import { useActions } from '@/store/context'
import { useUi } from '@/store/ui'
import type { Chip, TagEntry } from '@/types'
import { TagSuggest, useTagSuggest } from './tag-suggest'

export function tagToChip(tag: TagEntry): Chip {
  return { id: newId('c'), text: tag.name, type: tag.category === 'artist' ? 'artist' : 'tag', weight: 1, disabled: false }
}

export function TagInput({ sectionId }: { sectionId: string }) {
  const actions = useActions()
  const [q, setQ] = useState('')
  const [focused, setFocused] = useState(false)
  const s = useTagSuggest(q)
  const inputRef = useRef<HTMLInputElement>(null)
  const composing = useRef(false)
  const open = focused && s.searching && s.results.length > 0

  const add = (chips: Chip[]) => {
    if (!chips.length) return
    actions.addChips(sectionId, chips)
    setQ('')
  }

  const acceptSuggestion = (tag = s.pick()) => (tag ? add([tagToChip(tag)]) : addRaw())
  const addRaw = () => add(parsePrompt(q).map(toChip))
  const confirm = () => {
    if (!q.trim()) return
    if (!s.searching) return addRaw()
    const apply = (tag: TagEntry | undefined) => (tag ? add([tagToChip(tag)]) : addRaw())
    const r = s.enterPickLatest()
    if (r instanceof Promise) r.then(apply)
    else apply(r)
  }

  return (
    <TagSuggest
      s={s}
      open={focused}
      onPick={(tag) => acceptSuggestion(tag)}
      hints={
        <>
          <span>Tab / ↓ 选择候选</span>
          <span>↵ 补全英文，否则保留原文</span>
        </>
      }
    >
      <input
        ref={inputRef}
        className="tag-input"
        data-testid="tag-input"
        placeholder="+ tag"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onFocus={() => {
          setFocused(true)
          useUi.getState().focusSection(sectionId)
        }}
        onBlur={() => setFocused(false)}
        onCompositionStart={() => (composing.current = true)}
        onCompositionEnd={() => (composing.current = false)}
        onPaste={(e) => {
          const text = e.clipboardData.getData('text')
          if (findAiJson(text)) return
          if (!looksLikePromptString(text)) return
          e.preventDefault()
          const chips = parsePrompt(text).map(toChip)
          add(chips)
          toast.success(`已拆分为 ${chips.length} 个 tag`)
        }}
        onKeyDown={(e) => {
          if (composing.current || e.nativeEvent.isComposing) return
          if (e.key === 'Enter') {
            e.preventDefault()
            if (e.shiftKey) addRaw()
            else confirm()
          } else if (e.key === 'Tab' && open) {
            e.preventDefault()
            acceptSuggestion()
          } else if ((e.key === ',' || e.key === '，') && !isTextBlock(q)) {
            // Commas after Text: are literal text to render, not tag separators.
            e.preventDefault()
            confirm()
          } else if (e.key === 'Escape') {
            setQ('')
            inputRef.current?.blur()
          }
        }}
      />
    </TagSuggest>
  )
}
