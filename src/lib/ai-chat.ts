import type { Doc } from '@/types'
import type { AiErrorType, AiMessage } from './ai-api'
import { aiAskMessages, docText, toAiDoc, type AiOptions } from './ai-doc'
import { checkDocument, type CheckPlace, type DocCheck } from './doc-check'

export const CHAT_RULE = `

Chat
- This is a chat. Each user message ends with an [Editor] Mode line: "edit" = reply with an edit as one \`\`\`json code block (a short note before it is fine); "chat" = answer in text only, don't write JSON and don't make an edit.
- Lines starting with [Editor] are notes from the editor about what the user did with your earlier edits. Always edit the latest "## Current document"; ids come from it. Don't propose again what the user rejected unless asked.`

export const MODE_LINE = { edit: '[Editor] Mode: edit', chat: '[Editor] Mode: chat' } as const
export const DOC_UNCHANGED = '(The document is unchanged since your last reply.)'

export type CardStatus = 'none' | 'applied' | 'reviewed' | 'branch' | 'here'
export interface ChatCard {
  status: CardStatus
  /** Undo is safe only while the document still matches this post-apply key. */
  afterKey?: string
  expanded?: boolean
}
export interface ChatUsage {
  input: number
  cacheRead: number
  output: number
}
export interface ChatAlt {
  raw: string
  label: string
  preset: string
  card?: ChatCard
  hidden?: true
  usage?: ChatUsage
  at: number
}
export interface ChatUserMsg {
  id: string
  role: 'user'
  text: string
  edit: boolean
  sent: string
  doc: Doc
  at: number
  failed?: string
  failureKind?: AiErrorType | 'stopped' | 'nojson' | 'format'
  failedReply?: { raw: string; label: string; preset: string; retryReason?: string }
  action?: ChatAction
}
export interface ChatAiMsg {
  id: string
  role: 'ai'
  alts: ChatAlt[]
  alt: number
}
export interface ChatNote {
  id: string
  role: 'note'
  text: string
}
export type ChatMsg = ChatUserMsg | ChatAiMsg | ChatNote
export interface ChatConv {
  id: string
  docId: string
  title: string
  createdAt: number
  updatedAt: number
  msgs: ChatMsg[]
}

export const docKey = (doc: Doc, opts: AiOptions) => JSON.stringify(toAiDoc(doc, opts))
export const altOf = (m: ChatAiMsg) => m.alts[m.alt] ?? m.alts[m.alts.length - 1]

export function lastSentUser(msgs: readonly ChatMsg[]): ChatUserMsg | undefined {
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i]
    if (m.role === 'user' && !m.failed) return m
  }
  return undefined
}

export function userOf(msgs: readonly ChatMsg[], ai: ChatAiMsg): ChatUserMsg | undefined {
  for (let i = msgs.indexOf(ai) - 1; i >= 0; i--) {
    const m = msgs[i]
    if (m.role === 'user') return m
  }
  return undefined
}

export function editorNote(msgs: readonly ChatMsg[], doc: Doc, opts: AiOptions): string {
  const lastAi = [...msgs].reverse().find((m): m is ChatAiMsg => m.role === 'ai')
  if (!lastAi) return ''
  const now = docKey(doc, opts)
  const prev = lastSentUser(msgs)
  const changed = !!prev && docKey(prev.doc, opts) !== now
  const a = altOf(lastAi)
  if (a.card) {
    const s = a.card.status
    if (s === 'applied') return changed && a.card.afterKey !== now ? '[Editor] The user applied your last edit, then edited the document by hand.' : '[Editor] The user applied your last edit.'
    if (s === 'reviewed') return '[Editor] The user reviewed your last edit and applied part of it.'
    if (s === 'branch') return '[Editor] The user opened your last edit in a new tab; this document did not get it.' + (changed ? ' The user then edited this document by hand.' : '')
    if (s === 'here') return '[Editor] This chat continues in a new tab, where the user applied your last edit.'
    return changed ? "[Editor] The user didn't apply your last edit and edited the document by hand." : "[Editor] The user didn't apply your last edit."
  }
  return changed ? '[Editor] The document changed since your last reply.' : ''
}

export function userTurn(msgs: readonly ChatMsg[], doc: Doc, text: string, edit: boolean, opts: AiOptions, note = ''): string {
  const prev = lastSentUser(msgs)
  const same = !!prev && docKey(prev.doc, opts) === docKey(doc, opts)
  const request = [`## Request\n${text.trim()}`, note.trim(), edit ? MODE_LINE.edit : MODE_LINE.chat].filter(Boolean).join('\n\n')
  return [editorNote(msgs, doc, opts), same ? DOC_UNCHANGED : docText(doc, opts), request].filter(Boolean).join('\n\n')
}

export type ChatActionId = 'spelling' | 'dedupe' | 'conflicts'
export interface ChatAction {
  id: ChatActionId
  found: string[]
}
export const CHAT_ACTIONS: readonly { id: ChatActionId; name: string; edit: boolean }[] = [
  { id: 'spelling', name: '核对写法', edit: true },
  { id: 'dedupe', name: '去重', edit: true },
  { id: 'conflicts', name: '查冲突', edit: false },
]

export const chatCheck = (doc: Doc, variants: Record<string, string[]>) => checkDocument(doc, { variants, renamedTo: new Map() })

export function unknownWords(check: DocCheck): string[] {
  const seen = new Map<string, string>()
  for (const u of check.unknown) if (!seen.has(u.text.toLowerCase())) seen.set(u.text.toLowerCase(), u.tag)
  return [...seen.values()]
}

export function placeOf(x: CheckPlace & { disabled?: boolean }): string {
  const box = x.character ? (x.field === 'uc' ? `${x.character.name} uc` : x.character.name) : x.field
  return `${box} / ${x.sectionName.trim() || 'untitled'}${x.disabled ? ', disabled' : ''}`
}

const SPELLING = `[Editor] One-click action. The words below are not in Tincture's tag library (Danbooru tags NovelAI knows). For each one: if it is a misspelling or another site's way of writing a library tag, replace it with the library name and keep its weight; if it is written on purpose, keep it. Change nothing else. In "comment", say what you kept and why.`
const DEDUPE = `[Editor] One-click action. In each box (the prompt, the uc, or one character's prompt or uc), keep one of each tag: merge tags that mean the same thing written differently (smile + smiling face; the same hair length written two ways) into the library tag, and of a tag written more than once keep the copy in the section where it fits best, with its weight. Not duplicates, leave them: the same tag in different boxes; a tag and a narrower one (long hair + very long hair). Change nothing else. In "comment", say what you merged and which copy you kept.`
const CONFLICTS = `[Editor] One-click action. Only report, don't edit: find tags that contradict each other, such as short hair + long hair on one character, day + night, or a count tag (solo, 1girl, 2girls …) that doesn't match the characters. Look only at the enabled tags of enabled sections and characters. List each one with where it is (section and character names) and a short suggestion; a tag and a narrower one (long hair + very long hair) is not a conflict. If nothing contradicts, say so.`

export function actionNote(id: ChatActionId, check?: DocCheck): { note: string; found: string[] } {
  if (id === 'conflicts' || !check) return { note: CONFLICTS, found: [] }
  if (id === 'spelling') {
    const words = new Map<string, { tag: string; places: string[]; similar: string[] }>()
    for (const u of check.unknown) {
      const k = u.text.toLowerCase()
      const w = words.get(k) ?? { tag: u.tag, places: [], similar: u.similar ?? [] }
      w.places.push(placeOf(u))
      words.set(k, w)
    }
    const lines = [...words.values()].map((w) => `- "${w.tag}" (${w.places.join('; ')}) → ${w.similar.length ? w.similar.join(', ') : '(no close library tag)'}`)
    return { note: [SPELLING, 'Not in the library → close library tags:', ...lines].join('\n'), found: [...words.values()].map((w) => w.tag) }
  }
  const lines = check.duplicate.map((d) => `- "${d.copies[0].tag}" (${d.copies.map(placeOf).join('; ')})`)
  const found = [...new Set(check.duplicate.map((d) => d.copies[0].tag))]
  return { note: [DEDUPE, ...(lines.length ? ['Written more than once in one box:', ...lines] : ['No tag is written twice in one box.'])].join('\n'), found }
}

export const chatSystem = (doc: Doc, opts: AiOptions, rules: readonly string[]) => aiAskMessages(doc, opts, { rules: [...rules], request: '', analysis: false }).system + CHAT_RULE

export function chatMessages(msgs: readonly ChatMsg[], uptoId: string): AiMessage[] {
  const end = msgs.findIndex((m) => m.id === uptoId)
  const list = msgs.slice(0, end + 1)
  const out: AiMessage[] = []
  list.forEach((m, i) => {
    if (m.role === 'user') {
      if (m.id === uptoId) return void out.push({ role: 'user', content: m.sent })
      if (m.failed) return
      const next = list.slice(i + 1).find((x) => x.role !== 'note')
      if (next?.role === 'ai') out.push({ role: 'user', content: m.sent })
    } else if (m.role === 'ai') out.push({ role: 'assistant', content: altOf(m).raw })
  })
  return out
}

export const proseOf = (out: string) => out.replace(/```[\w-]*[^\S\n]*\n[\s\S]*?(```|$)/g, '').trim()

export const altText = (a: ChatAlt, edit: boolean) => (edit ? proseOf(a.raw) : proseOf(a.raw) || (a.hidden ? '' : a.raw.trim()))

export const chatTitle = (text: string) => text.trim().replace(/\s+/g, ' ').slice(0, 24)

export function chatTokens(c: ChatConv): number {
  for (let i = c.msgs.length - 1; i >= 0; i--) {
    const m = c.msgs[i]
    if (m.role === 'ai') {
      const u = altOf(m).usage
      if (u) return u.input + u.output
      break
    }
  }
  const chars = c.msgs.reduce((n, m) => n + (m.role === 'user' ? m.sent.length : m.role === 'ai' ? altOf(m).raw.length : 0), 0)
  return Math.round((chars + 9000) / 3)
}

export function formatTokens(n: number): string {
  return n >= 10000 ? `约 ${(n / 10000).toFixed(1)} 万 token` : `约 ${(n / 1000).toFixed(1)} 千 token`
}

export function lastUsage(c: ChatConv): ChatUsage | undefined {
  for (let i = c.msgs.length - 1; i >= 0; i--) {
    const m = c.msgs[i]
    if (m.role === 'ai') return altOf(m).usage
  }
  return undefined
}
