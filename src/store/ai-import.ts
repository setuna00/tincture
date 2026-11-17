// Keep state exports outside component modules so React Fast Refresh does not reload the entire page.
import { create } from 'zustand'
import { toast } from 'sonner'
import { aiFileName, aiPromptFile, aiPromptText, findAiJson, planReply, type AiOptions, type AiPlan } from '@/lib/ai-doc'
import type { Doc } from '@/types'
import { usePrefs } from './prefs'
import { getDocStore, useTabs } from './tabs'

interface AiImportState {
  open: boolean
  plan: AiPlan | null
  source: string
  request: string
  tabId: string
  error: string | null
  agent: ((r: AgentReview) => void) | null
  onApplied: ((picked: number, total: number, after: Doc) => void) | null
}

export type AgentReview = { applied: string[] } | 'cancelled' | 'replaced'

export const useAiImport = create<AiImportState>(() => ({ open: false, plan: null, source: '', request: '', tabId: '', error: null, agent: null, onApplied: null }))

export function settleAgent(r: AgentReview) {
  const agent = useAiImport.getState().agent
  if (!agent) return
  useAiImport.setState({ agent: null })
  agent(r)
}

export const closeAiImport = () => {
  settleAgent('cancelled')
  useAiImport.setState({ open: false })
}

export const AGENT_SOURCE = 'AI 代理'

export function reviewAgentPlan(tabId: string, plan: AiPlan, request: string): Promise<AgentReview> {
  settleAgent('replaced')
  return new Promise((resolve) => useAiImport.setState({ open: true, plan, source: AGENT_SOURCE, request, tabId, error: null, agent: resolve, onApplied: null }))
}

export const openAiPaste = (error: string | null = null) => {
  settleAgent('replaced')
  useAiImport.setState({ open: true, plan: null, source: '', request: '', error, onApplied: null })
}

export const aiOptions = (): AiOptions => ({ nsfw: usePrefs.getState().nsfw !== 'off' })

export const NOT_AI_REPLY = '未找到 AI 的回答（需包含 "$schema": "pe-doc-ai/2" 的 JSON）'

export function importAiText(text: string, source: string, request = '', onApplied: AiImportState['onApplied'] = null): boolean {
  const raw = findAiJson(text)
  if (!raw) return false
  const tabId = useTabs.getState().activeId
  const plan = planReply(getDocStore(tabId).getState().doc, raw, aiOptions())
  if (!plan.changes.length && !plan.skipped.length && !plan.comment) {
    toast('AI 的回答与当前文档相同，无需修改')
    closeAiImport()
    return true
  }
  settleAgent('replaced')
  useAiImport.setState({ open: true, plan, source, request, tabId, error: null, onApplied })
  return true
}

export const previewAiPlan = (raw: string, request: string, onApplied: NonNullable<AiImportState['onApplied']>) => importAiText(raw, 'AI 的回答', request, onApplied)

export async function importAiFile(file: File) {
  const text = await file.text()
  if (!importAiText(text, file.name)) {
    if (useAiImport.getState().open) useAiImport.setState({ error: NOT_AI_REPLY })
    else toast.error(`「${file.name}」不是 AI 的回答`, { description: '需包含 "$schema": "pe-doc-ai/2" 的 JSON；格式见问 AI 标题条 ⋯ 里的「复制」' })
  }
}

export const isJsonFile = (f: File) => f.type === 'application/json' || /\.json$/i.test(f.name)

export async function copyAiPrompt(doc: Doc): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(aiPromptText(doc, aiOptions()))
    toast.success('已复制给 AI 的内容', { description: '粘贴给 AI，并在末尾写明修改要求；将回答粘贴回此处（Ctrl+V）' })
    return true
  } catch {
    toast.error('复制失败：无剪贴板权限')
    return false
  }
}

export function saveAiPrompt(doc: Doc) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([aiPromptFile(doc, aiOptions())], { type: 'application/json' }))
  a.download = aiFileName(doc.meta.title)
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}

export async function pasteAiReply() {
  let text: string
  try {
    text = await navigator.clipboard.readText()
  } catch {
    return openAiPaste()
  }
  if (!importAiText(text, '粘贴的回答')) openAiPaste(NOT_AI_REPLY)
}

export function importAiPicked(f: File | undefined) {
  if (!f) return
  if (!isJsonFile(f)) return void toast.error(`「${f.name}」不是 .json 文件`)
  void importAiFile(f)
}
