// Desktop API keys belong in encrypted app storage, never in the portable image library.
import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { listAiModels, type AiErrorType, type AiKind, type AiServiceReq } from '@/lib/ai-api'
import { newId } from '@/lib/nai'
import { useNai } from './nai'
import { safeStorage } from './storage'

export type AiPresetId = 'novelai' | 'deepseek' | 'openai' | 'anthropic' | 'gemini' | 'openrouter' | 'siliconflow' | 'kimi' | 'zhipu' | 'qwen' | 'doubao' | 'custom'
export interface AiPreset {
  id: AiPresetId
  name: string
  kind: AiKind
  url: string
  model?: string
  maxTokens?: number
  naiToken?: true
}

export const AI_PRESETS: readonly AiPreset[] = [
  { id: 'novelai', name: 'NovelAI', kind: 'compatible', url: 'https://text.novelai.net/oa/v1', model: 'glm-4-6', maxTokens: 2048, naiToken: true },
  { id: 'deepseek', name: 'DeepSeek', kind: 'compatible', url: 'https://api.deepseek.com' },
  { id: 'openai', name: 'OpenAI', kind: 'openai', url: 'https://api.openai.com/v1' },
  { id: 'anthropic', name: 'Anthropic', kind: 'anthropic', url: 'https://api.anthropic.com/v1' },
  { id: 'gemini', name: 'Gemini', kind: 'google', url: 'https://generativelanguage.googleapis.com/v1beta' },
  { id: 'openrouter', name: 'OpenRouter', kind: 'compatible', url: 'https://openrouter.ai/api/v1' },
  { id: 'siliconflow', name: '硅基流动', kind: 'compatible', url: 'https://api.siliconflow.cn/v1' },
  { id: 'kimi', name: 'Kimi', kind: 'compatible', url: 'https://api.moonshot.cn/v1' },
  { id: 'zhipu', name: '智谱', kind: 'compatible', url: 'https://open.bigmodel.cn/api/paas/v4' },
  { id: 'qwen', name: '通义千问', kind: 'compatible', url: 'https://dashscope.aliyuncs.com/compatible-mode/v1' },
  { id: 'doubao', name: '豆包', kind: 'compatible', url: 'https://ark.cn-beijing.volces.com/api/v3' },
  { id: 'custom', name: '自定义', kind: 'compatible', url: '' },
]
export const presetOf = (id: AiPresetId): AiPreset => AI_PRESETS.find((p) => p.id === id) ?? AI_PRESETS[AI_PRESETS.length - 1]

export interface AiServiceConf {
  id: string
  preset: AiPresetId
  url: string
  model: string
  key: string
}

export interface AiRule {
  id: string
  name: string
  body: string
  on: boolean
}

export interface AiSettings {
  services: AiServiceConf[]
  current: string | null
  rules: AiRule[]
  analysis: boolean
  agent: { on: boolean; mode: AgentMode; gen: AgentGen }
}
export type AgentMode = 'preview' | 'direct'
export type AgentGen = 'confirm' | 'direct'
const AGENT_DEFAULTS: AiSettings['agent'] = { on: false, mode: 'preview', gen: 'confirm' }

export type AiConn = { state: 'checking' } | { state: 'done'; models: string[] } | { state: 'error'; error: AiErrorType; message: string }

interface AiState extends AiSettings {
  conn: Record<string, AiConn>
  saveService(s: AiServiceConf): void
  removeService(id: string): void
  setCurrent(id: string): void
  saveRule(r: AiRule): void
  removeRule(id: string): void
  setAnalysis(on: boolean): void
  setAgent(patch: Partial<AiSettings['agent']>): void
  check(id: string): Promise<void>
}

export const serviceUrl = (s: Pick<AiServiceConf, 'preset' | 'url'>) => (s.preset === 'custom' ? s.url.trim() : presetOf(s.preset).url)
export const serviceKey = (s: Pick<AiServiceConf, 'preset' | 'key'>) => (presetOf(s.preset).naiToken ? useNai.getState().token : s.key.trim())
export function serviceName(s: Pick<AiServiceConf, 'preset' | 'url'>): string {
  if (s.preset !== 'custom') return presetOf(s.preset).name
  try {
    return new URL(s.url).host || '自定义'
  } catch {
    return '自定义'
  }
}
export function serviceReq(s: AiServiceConf): AiServiceReq {
  const p = presetOf(s.preset)
  return { kind: p.kind, url: serviceUrl(s), model: s.model.trim(), ...(p.maxTokens ? { maxTokens: p.maxTokens } : {}) }
}
export const AI_ERROR_TEXT: Record<AiErrorType, string> = {
  unauthorized: '无法连接：API Key 无效',
  quota: '无法请求：额度不足或请求过于频繁',
  network: '无法连接：网络错误',
  timeout: '无法连接：网络错误',
  blocked: '已被 AI 服务拒绝（内容审核）',
  server: '无法请求：AI 服务返回错误',
}
export const aiErrorText = (error: AiErrorType, s: Pick<AiServiceConf, 'preset'>) =>
  error === 'unauthorized' && presetOf(s.preset).naiToken ? '无法连接：NAI 令牌无效' : AI_ERROR_TEXT[error]

export const newServiceId = () => newId('ai')
export const newRuleId = () => newId('rule')

const seq: Record<string, number> = {}

export const useAi = create<AiState>()(
  persist(
    (set, get) => ({
      services: [],
      current: null,
      rules: [],
      analysis: false,
      agent: AGENT_DEFAULTS,
      conn: {},
      saveService: (s) =>
        set((st) => {
          const i = st.services.findIndex((x) => x.id === s.id)
          const services = i >= 0 ? st.services.map((x) => (x.id === s.id ? s : x)) : [...st.services, s]
          return { services, current: st.current && services.some((x) => x.id === st.current) ? st.current : s.id }
        }),
      removeService: (id) =>
        set((st) => {
          const services = st.services.filter((x) => x.id !== id)
          const { [id]: _, ...conn } = st.conn
          return { services, conn, current: st.current === id ? (services[0]?.id ?? null) : st.current }
        }),
      setCurrent: (id) => set({ current: id }),
      saveRule: (r) => set((st) => ({ rules: st.rules.some((x) => x.id === r.id) ? st.rules.map((x) => (x.id === r.id ? r : x)) : [...st.rules, r] })),
      removeRule: (id) => set((st) => ({ rules: st.rules.filter((x) => x.id !== id) })),
      setAnalysis: (on) => set({ analysis: on }),
      setAgent: (patch) => set((st) => ({ agent: { ...st.agent, ...patch } })),
      check: async (id) => {
        const s = get().services.find((x) => x.id === id)
        if (!s) return
        const my = (seq[id] = (seq[id] ?? 0) + 1)
        set((st) => ({ conn: { ...st.conn, [id]: { state: 'checking' } } }))
        const r = await listAiModels(serviceReq(s), serviceKey(s))
        if (seq[id] !== my || !get().services.some((x) => x.id === id)) return
        const c: AiConn = r.error ? { state: 'error', error: r.error, message: r.message ?? '' } : { state: 'done', models: r.models }
        set((st) => ({ conn: { ...st.conn, [id]: c } }))
      },
    }),
    {
      name: 'pe:ai',
      version: 1,
      storage: createJSONStorage(() => safeStorage),
      partialize: (s): AiSettings => ({ services: s.services, current: s.current, rules: s.rules, analysis: s.analysis, agent: s.agent }),
      // Merge nested agent defaults because persisted objects may omit newly added fields.
      merge: (saved, cur) => {
        const p = (saved ?? {}) as Partial<AiSettings>
        return { ...cur, ...p, agent: { ...AGENT_DEFAULTS, ...p.agent } }
      },
    },
  ),
)

export const currentService = (st: Pick<AiSettings, 'services' | 'current'>) => st.services.find((s) => s.id === st.current) ?? st.services[0] ?? null
