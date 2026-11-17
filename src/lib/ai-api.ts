export type AiKind = 'openai' | 'anthropic' | 'google' | 'compatible'
export interface AiServiceReq {
  kind: AiKind
  url: string
  model: string
  maxTokens?: number
}
export type AiErrorType = 'unauthorized' | 'quota' | 'network' | 'timeout' | 'blocked' | 'server'
export interface AiError {
  error: AiErrorType
  status?: number
  message: string
}
export type AiFinishReason = 'stop' | 'length' | 'content-filter' | 'tool-calls' | 'error' | 'interrupted' | 'other'
export type AiEvent =
  | { type: 'delta'; text: string }
  | { type: 'reasoning'; text: string }
  | { type: 'done'; reason: AiFinishReason; raw?: string; usage?: { input: number; cacheRead: number; output: number } }
  | ({ type: 'error' } & AiError)
export interface AiMessage {
  role: 'user' | 'assistant'
  content: string
}
export interface AiAsk {
  service: AiServiceReq
  key: string
  system: string
  messages: AiMessage[]
}

const offline = (e: unknown): AiError => ({ error: 'network', message: `无法连接本地服务：${e instanceof Error ? e.message : String(e)}` })

export async function askAi(req: AiAsk, onEvent: (e: AiEvent) => void, signal?: AbortSignal): Promise<void> {
  let r: Response
  try {
    r = await fetch('/api/ai/ask', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(req), signal })
  } catch (e) {
    if (!signal?.aborted) onEvent({ type: 'error', ...offline(e) })
    return
  }
  if (!r.ok || !r.body) {
    const j = (await r.json().catch(() => ({}))) as { message?: string }
    onEvent({ type: 'error', error: 'server', status: r.status, message: j.message ?? r.statusText })
    return
  }
  const reader = r.body.pipeThrough(new TextDecoderStream()).getReader()
  let buf = ''
  try {
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      buf += value
      for (let i = buf.indexOf('\n'); i >= 0; i = buf.indexOf('\n')) {
        const line = buf.slice(0, i).trim()
        buf = buf.slice(i + 1)
        if (line) onEvent(JSON.parse(line) as AiEvent)
      }
    }
  } catch (e) {
    if (!signal?.aborted) onEvent({ type: 'error', ...offline(e) })
  }
}

export async function listAiModels(service: AiServiceReq, key: string, signal?: AbortSignal): Promise<{ models: string[] } & Partial<AiError>> {
  try {
    const r = await fetch('/api/ai/models', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ service, key }), signal })
    const j = (await r.json()) as { models?: string[]; message?: string } & Partial<AiError>
    if (!r.ok) return { models: [], error: 'server', status: r.status, message: j.message ?? r.statusText }
    return { ...j, models: j.models ?? [] }
  } catch (e) {
    return { models: [], ...offline(e) }
  }
}
