import { produce } from 'immer'
import { create } from 'zustand'
import { toast } from 'sonner'
import { askAi, type AiError, type AiFinishReason } from '@/lib/ai-api'
import {
  actionNote,
  altOf,
  CHAT_ACTIONS,
  chatCheck,
  chatMessages,
  chatSystem,
  chatTitle,
  docKey,
  userOf,
  userTurn,
  type CardStatus,
  type ChatAction,
  type ChatActionId,
  type ChatAiMsg,
  type ChatAlt,
  type ChatConv,
  type ChatMsg,
  type ChatUsage,
  type ChatUserMsg,
} from '@/lib/ai-chat'
import { aiRetryAsk, applyPlan, diagnoseReply, findAiJson, planReply, type AiPlan } from '@/lib/ai-doc'
import { withSimilar } from '@/lib/doc-check'
import { newId } from '@/lib/nai'
import type { Doc } from '@/types'
import { AI_ERROR_TEXT, aiErrorText, currentService, serviceKey, serviceName, serviceReq, useAi, type AiServiceConf } from './ai'
import { aiOptions, previewAiPlan } from './ai-import'
import { ASSIST_W, usePrefs } from './prefs'
import { assistantMode } from './assistant-mode'
import { chatStore } from './storage'
import { getDocStore, useTabs } from './tabs'
import { useLibrary } from './library'
import { useUi } from './ui'
import { recordAiVersion } from './versions'

export interface ChatSending {
  docId: string
  convId: string
  userId: string
  regenOf: string | null
  edit: boolean
  label: string
  preset: string
  text: string
  thinking: number
  ctrl: AbortController
}

interface ChatState {
  open: boolean
  openedSidebar: boolean
  byDoc: Record<string, ChatConv[] | undefined>
  /** null explicitly selects a new conversation; a missing entry selects the most recently updated conversation. */
  cur: Record<string, string | null>
  sending: ChatSending | null
  picked: string[] | null
  draft: string
  editing: string | null
  focusTick: number
}

export const useChat = create<ChatState>()(() => ({ open: false, openedSidebar: false, byDoc: {}, cur: {}, sending: null, picked: null, draft: '', editing: null, focusTick: 0 }))

usePrefs.subscribe((s, prev) => {
  if (prev.assistOpen && !s.assistOpen && useChat.getState().openedSidebar) useChat.setState({ openedSidebar: false })
})

export function withoutSlide(fn: () => void) {
  const grid = document.querySelector<HTMLElement>('[data-testid="editor-grid"]')
  if (grid) grid.style.transition = 'none'
  fn()
  if (grid) setTimeout(() => (grid.style.transition = ''), 260)
}

export function openChat() {
  const p = usePrefs.getState()
  const widen = p.assistW < ASSIST_W.aiMin
  const expand = !p.assistOpen
  if (widen || expand) withoutSlide(() => usePrefs.getState().set({ ...(expand ? { assistOpen: true } : {}), ...(widen ? { assistW: ASSIST_W.aiOpen } : {}) }))
  useChat.setState((s) => ({ open: true, openedSidebar: expand || s.openedSidebar, focusTick: s.focusTick + 1 }))
}

export function closeChat({ restore = true } = {}) {
  const s = useChat.getState()
  if (s.openedSidebar && restore) usePrefs.getState().set({ assistOpen: false })
  useChat.setState({ open: false, openedSidebar: false, editing: null })
}

export function toggleChat(onEditor: boolean, toEditor: () => void) {
  const tabs = useTabs.getState()
  if (tabs.starts.includes(tabs.activeId)) return
  if (!onEditor) {
    toEditor()
    return openChat()
  }
  if (useChat.getState().open && usePrefs.getState().assistOpen) {
    const covered = !usePrefs.getState().chatPinned && assistantMode(getDocStore(tabs.activeId).getState().doc, useUi.getState()) !== 'library'
    if (covered) useUi.getState().blur()
    else closeChat()
  }
  else openChat()
}

const activeStore = () => getDocStore(useTabs.getState().activeId)
export const docIdOf = (doc: Doc, tabId: string) => doc.meta.docId ?? tabId
const activeDocId = () => docIdOf(activeStore().getState().doc, useTabs.getState().activeId)

const loading = new Map<string, Promise<void>>()
export function loadChats(docId: string): Promise<void> {
  if (useChat.getState().byDoc[docId]) return Promise.resolve()
  let p = loading.get(docId)
  if (!p) {
    p = chatStore
      .list<ChatConv>(docId)
      .catch(() => [] as ChatConv[])
      .then((list) => {
        if (useChat.getState().byDoc[docId]) return
        useChat.setState((s) => ({ byDoc: { ...s.byDoc, [docId]: list } }))
      })
      .finally(() => loading.delete(docId))
    loading.set(docId, p)
  }
  return p
}

export function currentConv(s: Pick<ChatState, 'byDoc' | 'cur'>, docId: string): ChatConv | null {
  const list = s.byDoc[docId] ?? []
  const cur = s.cur[docId]
  if (cur === null) return null
  return list.find((c) => c.id === cur) ?? list[0] ?? null
}

function putConv(c: ChatConv, { touch = true, save = true } = {}) {
  const conv = touch ? { ...c, updatedAt: Date.now() } : c
  useChat.setState((s) => {
    const list = (s.byDoc[conv.docId] ?? []).filter((x) => x.id !== conv.id)
    return { byDoc: { ...s.byDoc, [conv.docId]: [conv, ...list].sort((a, b) => b.updatedAt - a.updatedAt) } }
  })
  if (save) chatStore.put(conv)
  return conv
}

function updateConv(docId: string, convId: string, fn: (c: ChatConv) => void, opts?: { touch?: boolean }) {
  const c = useChat.getState().byDoc[docId]?.find((x) => x.id === convId)
  if (!c) return null
  return putConv(produce(c, fn), opts)
}

export function newConv() {
  const docId = activeDocId()
  useChat.setState((s) => ({ cur: { ...s.cur, [docId]: null }, editing: null, focusTick: s.focusTick + 1 }))
}

export function selectConv(id: string) {
  const docId = activeDocId()
  useChat.setState((s) => ({ cur: { ...s.cur, [docId]: id }, editing: null }))
}

export function pickedRules(): Set<string> {
  const picked = useChat.getState().picked
  return new Set(picked ?? useAi.getState().rules.filter((r) => r.on).map((r) => r.id))
}
export function toggleRule(id: string) {
  const p = pickedRules()
  if (p.has(id)) p.delete(id)
  else p.add(id)
  useChat.setState({ picked: [...p] })
}

const label = (s: AiServiceConf) => `${serviceName(s)} · ${s.model.trim()}`

async function run(o: { text?: string; edit?: boolean; retry?: string; regen?: string; conv?: ChatConv; note?: string; action?: ChatAction }) {
  const st = useAi.getState()
  const s = currentService(st)
  if (!s || useChat.getState().sending) return
  const tabId = useTabs.getState().activeId
  const store = getDocStore(tabId)
  const doc = store.getState().doc
  const docId = docIdOf(doc, tabId)
  const opts = aiOptions()
  let conv = o.conv ?? currentConv(useChat.getState(), docId)
  if (!conv) {
    const now = Date.now()
    conv = { id: newId('chat'), docId, title: '', createdAt: now, updatedAt: now, msgs: [] }
  }
  let um: ChatUserMsg | undefined
  let regenOf: ChatAiMsg | undefined
  let retryReply: ChatUserMsg['failedReply']
  if (o.retry) {
    um = conv.msgs.find((m): m is ChatUserMsg => m.id === o.retry && m.role === 'user')
    if (!um) return
    if (um.failureKind === 'format') retryReply = um.failedReply
    const id = um.id
    conv = produce(conv, (c) => {
      const m = c.msgs.find((x) => x.id === id) as ChatUserMsg
      delete m.failed
      delete m.failureKind
      delete m.failedReply
    })
    um = conv.msgs.find((m) => m.id === id) as ChatUserMsg
  } else if (o.regen) {
    regenOf = conv.msgs.find((m): m is ChatAiMsg => m.id === o.regen && m.role === 'ai')
    um = regenOf && userOf(conv.msgs, regenOf)
    if (!um) return
  } else {
    const text = (o.text ?? '').trim()
    if (!text) return
    const edit = o.edit ?? usePrefs.getState().chatEdit
    const msg: ChatUserMsg = { id: newId('m'), role: 'user', text, edit, sent: userTurn(conv.msgs, doc, text, edit, opts, o.note), doc, at: Date.now(), ...(o.action ? { action: o.action } : {}) }
    um = msg
    conv = produce(conv, (c) => {
      c.msgs.push(msg)
      if (!c.title) c.title = chatTitle(text)
    })
  }
  conv = putConv(conv)
  useChat.setState((x) => ({ cur: { ...x.cur, [docId]: conv!.id } }))

  const rules = st.rules.filter((r) => pickedRules().has(r.id)).map((r) => r.body)
  const system = chatSystem(um.doc, opts, rules)
  const messages = chatMessages(conv.msgs, um.id)
  if (retryReply?.retryReason) {
    messages.push({ role: 'assistant', content: retryReply.raw }, { role: 'user', content: aiRetryAsk(retryReply.retryReason) })
  }
  const ctrl = new AbortController()
  const userId = um.id
  const edit = um.edit
  useChat.setState({ sending: { docId, convId: conv.id, userId, regenOf: regenOf?.id ?? null, edit, label: label(s), preset: s.preset, text: '', thinking: 0, ctrl } })
  let reason: AiFinishReason | null = null
  let usage: ChatUsage | undefined
  let error: AiError | null = null
  let out = ''
  await askAi(
    { service: serviceReq(s), key: serviceKey(s), system, messages },
    (e) => {
      if (e.type === 'delta' || e.type === 'reasoning') {
        if (e.type === 'delta') out += e.text
        useChat.setState((x) => (x.sending ? { sending: e.type === 'delta' ? { ...x.sending, text: out } : { ...x.sending, thinking: x.sending.thinking + e.text.length } } : {}))
      } else if (e.type === 'done') {
        reason = e.reason
        usage = e.usage
      } else error = e
    },
    ctrl.signal,
  )
  useChat.setState({ sending: null })
  const fail = (line: string, kind?: ChatUserMsg['failureKind'], reply?: ChatUserMsg['failedReply']) => {
    if (regenOf) return void (line !== '已停止' && toast.error(line))
    updateConv(docId, conv!.id, (c) => {
      const m = c.msgs.find((x) => x.id === userId) as ChatUserMsg | undefined
      if (m) {
        m.failed = line
        m.failureKind = kind
        m.failedReply = reply
      }
    })
  }
  if (ctrl.signal.aborted) return fail('已停止', 'stopped')
  if (error) return fail(aiErrorText((error as AiError).error, s), (error as AiError).error)
  if (reason === 'content-filter') return fail(AI_ERROR_TEXT.blocked)
  if (reason === 'length') return fail('回答过长，已被截断')
  const json = findAiJson(out)
  if (edit && !json) {
    const d = diagnoseReply(out)
    return fail(d.kind === 'format' ? `回答格式错误：${d.zh}` : 'AI 未返回修改', d.kind, {
      raw: out,
      label: label(s),
      preset: s.preset,
      ...(d.kind === 'format' ? { retryReason: d.en } : {}),
    })
  }
  const alt: ChatAlt = { raw: out, label: label(s), preset: s.preset, at: Date.now(), ...(usage ? { usage } : {}), ...(edit && json ? { card: { status: 'none' as CardStatus } } : {}), ...(!edit && json ? { hidden: true as const } : {}) }
  updateConv(docId, conv.id, (c) => {
    const r = regenOf && (c.msgs.find((x) => x.id === regenOf!.id) as ChatAiMsg | undefined)
    if (r) {
      r.alts.push(alt)
      r.alt = r.alts.length - 1
    } else c.msgs.push({ id: newId('m'), role: 'ai', alts: [alt], alt: 0 })
  })
}

export function sendChat(text: string) {
  if (!text.trim()) return
  useChat.setState({ draft: '' })
  void run({ text })
}
let preparing = false
export async function sendAction(id: ChatActionId) {
  const a = CHAT_ACTIONS.find((x) => x.id === id)
  if (!a || preparing || useChat.getState().sending || !currentService(useAi.getState())) return
  preparing = true
  let r: ReturnType<typeof actionNote>
  try {
    const check = id === 'conflicts' ? undefined : chatCheck(activeStore().getState().doc, useLibrary.getState().variants)
    r = actionNote(id, check && id === 'spelling' ? await withSimilar(check) : check)
  } finally {
    preparing = false
  }
  void run({ text: a.name, edit: a.edit, note: r.note, action: { id, found: r.found } })
}

export const retryChat = (userId: string) => void run({ retry: userId })
export const regenChat = (aiId: string) => void run({ regen: aiId })
export const stopChat = () => useChat.getState().sending?.ctrl.abort()

export function resendEdited(userId: string, text: string) {
  const docId = activeDocId()
  const conv = currentConv(useChat.getState(), docId)
  const i = conv?.msgs.findIndex((m) => m.id === userId) ?? -1
  const m = conv?.msgs[i]
  if (!conv || !m || m.role !== 'user' || !text.trim() || useChat.getState().sending) return
  const nth = conv.msgs.slice(0, i + 1).filter((x) => x.role === 'user').length
  const now = Date.now()
  const nc: ChatConv = {
    id: newId('chat'),
    docId,
    title: chatTitle(text),
    createdAt: now,
    updatedAt: now,
    msgs: [...structuredClone(conv.msgs.slice(0, i)), { id: newId('m'), role: 'note', text: `从「${conv.title || '未命名对话'}」第 ${nth} 条编辑后分出` }],
  }
  useChat.setState({ editing: null })
  void run({ text, edit: m.edit, conv: nc })
}

export function setAlt(aiId: string, alt: number) {
  const docId = activeDocId()
  const conv = currentConv(useChat.getState(), docId)
  if (conv) updateConv(docId, conv.id, (c) => void ((c.msgs.find((x) => x.id === aiId) as ChatAiMsg).alt = alt), { touch: false })
}

interface CardCtx {
  docId: string
  conv: ChatConv
  ai: ChatAiMsg
  alt: ChatAlt
  user: ChatUserMsg
  plan: AiPlan
}
export function cardPlan(user: ChatUserMsg, alt: ChatAlt): AiPlan {
  return planReply(user.doc, findAiJson(alt.raw) ?? {}, aiOptions())
}
function cardCtx(aiId: string): CardCtx | null {
  const docId = activeDocId()
  const conv = currentConv(useChat.getState(), docId)
  const ai = conv?.msgs.find((m): m is ChatAiMsg => m.id === aiId && m.role === 'ai')
  const user = conv && ai && userOf(conv.msgs, ai)
  if (!conv || !ai || !user) return null
  const alt = altOf(ai)
  return { docId, conv, ai, alt, user, plan: cardPlan(user, alt) }
}
const allOn = (plan: AiPlan) => new Set(plan.changes.filter((c) => c.defaultOn).map((c) => c.key))
const cardResult = (x: CardCtx) => applyPlan(x.user.doc, x.plan, allOn(x.plan))

function setCard(x: CardCtx, patch: Partial<NonNullable<ChatAlt['card']>>) {
  updateConv(x.docId, x.conv.id, (c) => {
    const a = altOf(c.msgs.find((m) => m.id === x.ai.id) as ChatAiMsg)
    if (a.card) Object.assign(a.card, patch)
  }, { touch: false })
}

/** Require the document to match the sent snapshot so applying an AI reply cannot overwrite intervening edits. */
export function applyCard(aiId: string) {
  const x = cardCtx(aiId)
  if (!x || !x.plan.changes.length) return
  const store = activeStore()
  const opts = aiOptions()
  if (docKey(store.getState().doc, opts) !== docKey(x.user.doc, opts)) return previewCard(aiId)
  useUi.getState().blur()
  store.getState().applyDoc({ ...cardResult(x), meta: store.getState().doc.meta })
  const after = store.getState().doc
  setCard(x, { status: 'applied', afterKey: docKey(after, aiOptions()) })
  void recordAiVersion(after, x.plan.changes.filter((c) => c.defaultOn).length, x.user.text)
}

export function undoCard(aiId: string) {
  const x = cardCtx(aiId)
  if (!x) return
  const store = activeStore()
  if (x.alt.card?.afterKey === docKey(store.getState().doc, aiOptions())) store.temporal.getState().undo()
  setCard(x, { status: 'none', afterKey: undefined })
}

export function previewCard(aiId: string) {
  const x = cardCtx(aiId)
  if (!x) return
  previewAiPlan(x.alt.raw, x.user.text, (picked, total, after) => {
    const y = cardCtx(aiId)
    if (y) setCard(y, { status: picked < total ? 'reviewed' : 'applied', afterKey: docKey(after, aiOptions()) })
  })
}

export function openCardInTab(aiId: string) {
  const x = cardCtx(aiId)
  if (!x) return
  const from = useTabs.getState().activeId
  const fromTitle = getDocStore(from).getState().doc.meta.title || '未命名'
  const result = cardResult(x)
  const tab = useTabs.getState().forkTab(from)
  const ns = getDocStore(tab)
  ns.getState().applyDoc({ ...result, meta: ns.getState().doc.meta })
  const newDocId = docIdOf(ns.getState().doc, tab)
  const upto = structuredClone(x.conv.msgs.slice(0, x.conv.msgs.indexOf(x.ai) + 1)) as ChatMsg[]
  const last = upto[upto.length - 1] as ChatAiMsg
  const card = altOf(last).card
  if (card) Object.assign(card, { status: 'here', afterKey: docKey(ns.getState().doc, aiOptions()) })
  const now = Date.now()
  const nc: ChatConv = { id: newId('chat'), docId: newDocId, title: x.conv.title, createdAt: now, updatedAt: now, msgs: [...upto, { id: newId('m'), role: 'note', text: `从「${fromTitle}」分出` }] }
  putConv(nc, { touch: false })
  useChat.setState((s) => ({ cur: { ...s.cur, [newDocId]: nc.id } }))
  setCard(x, { status: 'branch' })
}

export function toggleCardExpanded(aiId: string) {
  const x = cardCtx(aiId)
  if (x) setCard(x, { expanded: !x.alt.card?.expanded })
}
