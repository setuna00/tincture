// API keys are request-scoped secrets: never persist or log them.
import { createAnthropic } from '@ai-sdk/anthropic'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { createOpenAI } from '@ai-sdk/openai'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { APICallError, RetryError, StreamProviderError, streamText, type FinishReason, type LanguageModel, type LanguageModelUsage, type ModelMessage } from 'ai'
import type { FastifyInstance, FastifyReply } from 'fastify'
import { Readable } from 'node:stream'

export type AiKind = 'openai' | 'anthropic' | 'google' | 'compatible'
export interface AiService {
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
export interface AiUsage {
  input: number
  cacheRead: number
  output: number
}
export type AiEvent =
  | { type: 'delta'; text: string }
  | { type: 'reasoning'; text: string }
  | { type: 'done'; reason: FinishReason; raw?: string; usage?: AiUsage }
  | ({ type: 'error' } & AiError)

const KINDS: readonly AiKind[] = ['openai', 'anthropic', 'google', 'compatible']
export const AI_TIMEOUTS = { firstChunkMs: 120_000, chunkMs: 60_000, listMs: 15_000 }

const BLOCKED_CODE = /^(1301|data_inspection_failed|DataInspectionFailed)$|SensitiveContentDetected|RiskDetection/
const QUOTA_CODE = /^(1113|Arrearage|AccountOverdueError|insufficient_quota)$/

class BadRequest extends Error {
  statusCode = 400
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

function serviceOf(v: unknown, needModel: boolean): AiService {
  if (!isObj(v) || !KINDS.includes(v.kind as AiKind) || typeof v.url !== 'string' || !/^https?:\/\/[^/]/i.test(v.url)) throw new BadRequest('服务不对')
  const model = typeof v.model === 'string' ? v.model.trim() : ''
  if (needModel && !model) throw new BadRequest('没有模型')
  const maxTokens = typeof v.maxTokens === 'number' && Number.isInteger(v.maxTokens) && v.maxTokens > 0 ? v.maxTokens : undefined
  return { kind: v.kind as AiKind, url: v.url.trim().replace(/\/+$/, ''), model, ...(maxTokens ? { maxTokens } : {}) }
}

function messagesOf(v: unknown): ModelMessage[] {
  if (!Array.isArray(v) || !v.length) throw new BadRequest('没有要求')
  return v.map((m) => {
    if (!isObj(m) || (m.role !== 'user' && m.role !== 'assistant') || typeof m.content !== 'string') throw new BadRequest('消息格式不对')
    return { role: m.role, content: m.content }
  })
}

const keyOf = (v: unknown) => (typeof v === 'string' ? v.trim() : '')
/** HTTP headers cannot carry non-ASCII API keys. */
const badKey = (key: string): AiError | null => (/[^\x21-\x7e]/.test(key) ? { error: 'unauthorized', message: 'API Key 含有无法使用的字符' } : null)

/** An explicit string prevents the SDK from silently using environment API keys. */
export function modelOf(s: AiService, key: string): LanguageModel {
  const baseURL = s.url
  if (s.kind === 'openai') return createOpenAI({ apiKey: key, baseURL })(s.model)
  if (s.kind === 'anthropic') return createAnthropic({ apiKey: key, baseURL })(s.model)
  if (s.kind === 'google') return createGoogleGenerativeAI({ apiKey: key, baseURL })(s.model)
  // Omit Authorization for keyless local servers such as Ollama and LM Studio.
  return createOpenAICompatible({ name: 'compatible', baseURL, ...(key ? { apiKey: key } : {}) })(s.model)
}

function errorBody(e: APICallError | StreamProviderError): Record<string, unknown> {
  let d: unknown = e.data
  if (d === undefined && APICallError.isInstance(e) && e.responseBody) {
    try {
      d = JSON.parse(e.responseBody)
    } catch {
      d = undefined
    }
  }
  const o = isObj(d) ? (isObj(d.error) ? d.error : d) : {}
  return StreamProviderError.isInstance(e) ? { ...o, code: e.code ?? o.code, type: e.type ?? o.type } : o
}

const isTimeout = (e: unknown) => e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError')

export function classify(err: unknown): AiError {
  const e = RetryError.isInstance(err) ? err.lastError : err
  if (APICallError.isInstance(e) || StreamProviderError.isInstance(e)) {
    const status = e.statusCode
    const body = errorBody(e)
    const codes = [body.code, body.type].filter((c) => c !== undefined && c !== null).map(String)
    const message = typeof body.message === 'string' && body.message.trim() ? body.message.trim() : e.message
    const at = status === undefined ? {} : { status }
    if (codes.some((c) => BLOCKED_CODE.test(c))) return { error: 'blocked', ...at, message }
    if (codes.some((c) => QUOTA_CODE.test(c)) || status === 402 || status === 429) return { error: 'quota', ...at, message }
    if (status === 401 || status === 403) return { error: 'unauthorized', ...at, message }
    if (status === undefined && APICallError.isInstance(e)) return { error: isTimeout(e.cause) ? 'timeout' : 'network', message }
    return { error: 'server', ...at, message }
  }
  if (isTimeout(e)) return { error: 'timeout', message: (e as Error).message }
  return { error: 'server', message: e instanceof Error ? e.message : String(e) }
}

const line = (e: AiEvent) => `${JSON.stringify(e)}\n`

/** Anthropic requires explicit cache breakpoints; OpenAI and DeepSeek cache prefixes automatically. */
const ANTHROPIC_CACHE = { anthropic: { cacheControl: { type: 'ephemeral' as const } } }

function usageOf(u: LanguageModelUsage | undefined): AiUsage | undefined {
  if (!u || (u.inputTokens === undefined && u.outputTokens === undefined)) return undefined
  return { input: u.inputTokens ?? 0, cacheRead: u.inputTokenDetails?.cacheReadTokens ?? 0, output: u.outputTokens ?? 0 }
}

async function* askLines(service: AiService, key: string, system: string, messages: ModelMessage[], signal: AbortSignal): AsyncGenerator<string> {
  const bad = badKey(key)
  if (bad) return yield line({ type: 'error', ...bad })
  try {
    const anthropic = service.kind === 'anthropic'
    const r = streamText({
      model: modelOf(service, key),
      instructions: anthropic ? { role: 'system', content: system, providerOptions: ANTHROPIC_CACHE } : system,
      messages,
      ...(anthropic ? { providerOptions: ANTHROPIC_CACHE } : {}),
      maxRetries: 0,
      onError: ({ error }) => {
        const { error: category, status } = classify(error)
        console.error('AI request failed', { category, ...(status === undefined ? {} : { status }) })
      },
      abortSignal: signal,
      timeout: { firstChunkMs: AI_TIMEOUTS.firstChunkMs, chunkMs: AI_TIMEOUTS.chunkMs },
      ...(service.maxTokens ? { maxOutputTokens: service.maxTokens } : {}),
    })
    for await (const p of r.stream) {
      if (p.type === 'text-delta') yield line({ type: 'delta', text: p.text })
      else if (p.type === 'reasoning-delta') yield line({ type: 'reasoning', text: p.text })
      else if (p.type === 'finish') {
        const usage = usageOf(p.totalUsage)
        yield line({ type: 'done', reason: p.finishReason, ...(p.rawFinishReason ? { raw: p.rawFinishReason } : {}), ...(usage ? { usage } : {}) })
      }
      else if (p.type === 'error') return yield line({ type: 'error', ...classify(p.error) })
      else if (p.type === 'abort') {
        if (!signal.aborted) yield line({ type: 'error', error: 'timeout', message: p.reason ?? '' })
        return
      }
    }
  } catch (e) {
    if (!signal.aborted) yield line({ type: 'error', ...classify(e) })
  }
}

function abortOnClose(reply: FastifyReply): AbortController {
  const ctrl = new AbortController()
  reply.raw.on('close', () => {
    if (!reply.raw.writableFinished) ctrl.abort()
  })
  return ctrl
}

async function listModels(s: AiService, key: string, signal: AbortSignal): Promise<string[]> {
  const headers: Record<string, string> =
    s.kind === 'anthropic' ? { 'x-api-key': key, 'anthropic-version': '2023-06-01' } : s.kind === 'google' ? { 'x-goog-api-key': key } : key ? { authorization: `Bearer ${key}` } : {}
  const url = `${s.url}/models${s.kind === 'anthropic' ? '?limit=1000' : s.kind === 'google' ? '?pageSize=1000' : ''}`
  let res: Response
  try {
    res = await fetch(url, { headers, signal })
  } catch (e) {
    throw new APICallError({ message: `Cannot connect to API: ${e instanceof Error ? e.message : String(e)}`, url, requestBodyValues: {}, cause: e })
  }
  const text = await res.text()
  if (res.status === 404) return []
  if (!res.ok) throw new APICallError({ message: text.slice(0, 500) || res.statusText, url, requestBodyValues: {}, statusCode: res.status, responseBody: text })
  let j: unknown
  try {
    j = JSON.parse(text)
  } catch {
    throw new APICallError({ message: '模型列表不是 JSON', url, requestBodyValues: {}, statusCode: res.status, responseBody: text.slice(0, 500) })
  }
  if (!isObj(j)) return []
  if (s.kind === 'google' && Array.isArray(j.models))
    return j.models
      .filter((m): m is Record<string, unknown> => isObj(m) && Array.isArray(m.supportedGenerationMethods) && m.supportedGenerationMethods.includes('generateContent'))
      .map((m) => String(m.name).replace(/^models\//, ''))
  return Array.isArray(j.data) ? j.data.filter(isObj).map((m) => m.id).filter((id): id is string => typeof id === 'string' && !!id) : []
}

export function registerAi(app: FastifyInstance) {
  app.post<{ Body: unknown }>('/api/ai/ask', async (req, reply) => {
    const b = isObj(req.body) ? req.body : {}
    const service = serviceOf(b.service, true)
    const messages = messagesOf(b.messages)
    const system = typeof b.system === 'string' ? b.system : ''
    const ctrl = abortOnClose(reply)
    return reply
      .header('content-type', 'application/x-ndjson; charset=utf-8')
      .header('cache-control', 'no-store')
      .send(Readable.from(askLines(service, keyOf(b.key), system, messages, ctrl.signal), { objectMode: false }))
  })

  app.post<{ Body: unknown }>('/api/ai/models', async (req, reply) => {
    const b = isObj(req.body) ? req.body : {}
    const service = serviceOf(b.service, false)
    const key = keyOf(b.key)
    const ctrl = abortOnClose(reply)
    reply.header('cache-control', 'no-store')
    const bad = badKey(key)
    if (bad) return { models: [], ...bad }
    try {
      return { models: await listModels(service, key, AbortSignal.any([ctrl.signal, AbortSignal.timeout(AI_TIMEOUTS.listMs)])) }
    } catch (e) {
      return { models: [], ...classify(e) }
    }
  })
}
