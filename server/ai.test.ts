import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { inspect } from 'node:util'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { AI_TIMEOUTS, type AiEvent } from './ai.ts'
import { buildApp } from './app.ts'
import type { Config } from './config.ts'
import { fetchablePort } from './test-port.ts'

interface Seen {
  method: string
  url: string
  headers: http.IncomingHttpHeaders
  body: Record<string, unknown> | null
  cut: boolean
}
type Handler = (req: http.IncomingMessage, res: http.ServerResponse, seen: Seen) => void

let upstream: http.Server
let base: string
let seen: Seen[] = []
let handler: Handler = (_req, res) => res.end()

beforeAll(async () => {
  upstream = http.createServer(async (req, res) => {
    const chunks: Buffer[] = []
    for await (const c of req) chunks.push(c as Buffer)
    const raw = Buffer.concat(chunks).toString('utf8')
    const s: Seen = { method: req.method ?? '', url: req.url ?? '', headers: req.headers, body: raw ? JSON.parse(raw) : null, cut: false }
    seen.push(s)
    res.on('close', () => (s.cut = !res.writableFinished))
    handler(req, res, s)
  })
  const port = await fetchablePort(
    () => new Promise((ok) => upstream.listen(0, '127.0.0.1', () => ok((upstream.address() as AddressInfo).port))),
    () => new Promise((ok) => upstream.close(() => ok())),
  )
  base = `http://127.0.0.1:${port}`
})
afterAll(() => new Promise<void>((ok) => upstream.close(() => ok())))

let root: string
let config: Config
let app: Awaited<ReturnType<typeof buildApp>>
beforeEach(async () => {
  seen = []
  root = mkdtempSync(path.join(os.tmpdir(), 'pe-ai-'))
  config = { port: 0, appDir: path.join(root, 'app'), defaultLibraryDir: path.join(root, '图库'), test: false }
  app = await buildApp(config)
})
afterEach(async () => {
  await app.close()
  await rm(root, { recursive: true, force: true })
})

const KEY = 'sk-test-0123456789'
const H = { host: '127.0.0.1:4520' }
const service = (o: object = {}) => ({ kind: 'compatible', url: `${base}/v1`, model: 'glm-4-6', ...o })
const chunk = (delta: object, finish: string | null = null) =>
  `data: ${JSON.stringify({ id: 'c1', object: 'chat.completion.chunk', created: 1, model: 'glm-4-6', choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`
const sse = (pieces: string[], finish = 'stop'): Handler => (_req, res) => {
  res.writeHead(200, { 'content-type': 'text/event-stream' })
  for (const p of pieces) res.write(chunk({ content: p }))
  res.write(chunk({}, finish))
  res.end('data: [DONE]\n\n')
}
const fail = (status: number, body: object): Handler => (_req, res) => {
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(JSON.stringify(body))
}
const events = (body: string) =>
  body
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as AiEvent)
const ask = async (o: object = {}) => {
  const res = await app.inject({
    method: 'POST',
    url: '/api/ai/ask',
    headers: H,
    payload: { service: service(), key: KEY, system: 'RULES', messages: [{ role: 'user', content: '背景改成太空' }], ...o },
  })
  return { res, ev: events(res.body) }
}
const textOf = (ev: AiEvent[]) => ev.map((e) => (e.type === 'delta' ? e.text : '')).join('')

describe('/api/ai/ask', () => {
  it('401 的控制台日志只含类别和状态，不含提示词、对话、key 或服务原文', async () => {
    const prompt = 'private-user-prompt-marker'
    const system = 'private-system-prompt-marker'
    const conversation = 'private-conversation-marker'
    const response = `private-provider-response-marker ${KEY}`
    handler = fail(401, { error: { message: response } })
    const spies = (['error', 'warn', 'log', 'info', 'debug'] as const).map((method) => vi.spyOn(console, method).mockImplementation(() => {}))
    try {
      const { ev } = await ask({ system, messages: [{ role: 'assistant', content: conversation }, { role: 'user', content: prompt }] })
      expect(ev).toEqual([{ type: 'error', error: 'unauthorized', status: 401, message: response }])
      expect(seen[0].body).toMatchObject({ messages: [{ role: 'system', content: system }, { role: 'assistant', content: conversation }, { role: 'user', content: prompt }] })
      expect(spies[0]).toHaveBeenCalledWith('AI request failed', { category: 'unauthorized', status: 401 })
      const output = inspect(spies.flatMap((spy) => spy.mock.calls), { depth: null })
      for (const secret of [prompt, system, conversation, KEY, 'private-provider-response-marker', 'authorization', 'requestBodyValues'])
        expect(output).not.toContain(secret)
    } finally {
      for (const spy of spies) spy.mockRestore()
    }
  })

  it('流式收字：一段一行 delta，最后 done；system、对话、key、模型、max_tokens 照发', async () => {
    handler = sse(['```json\n{"$schema": "pe-doc-ai/2", ', '"comment": "改成太空"}\n```'])
    const messages = [
      { role: 'user', content: '文档 + 要求' },
      { role: 'assistant', content: '上一次的回答' },
      { role: 'user', content: '回答格式错误：缺 $schema，请重写' },
    ]
    const { res, ev } = await ask({ service: service({ maxTokens: 2048 }), messages })
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toBe('application/x-ndjson; charset=utf-8')
    expect(ev.filter((e) => e.type === 'delta')).toHaveLength(2)
    expect(textOf(ev)).toBe('```json\n{"$schema": "pe-doc-ai/2", "comment": "改成太空"}\n```')
    expect(ev.at(-1)).toEqual({ type: 'done', reason: 'stop', raw: 'stop' })
    const [s] = seen
    expect(s.url).toBe('/v1/chat/completions')
    expect(s.headers.authorization).toBe(`Bearer ${KEY}`)
    expect(s.body).toMatchObject({ model: 'glm-4-6', stream: true, max_tokens: 2048, messages: [{ role: 'system', content: 'RULES' }, ...messages] })
    expect(s.body).not.toHaveProperty('response_format')
  })

  it('结束原因：截断 length、审核 content_filter → content-filter；思考过程单独一种（只算字数）', async () => {
    handler = sse(['{"$schema": "pe-doc-ai/2", "prompt": ['], 'length')
    expect((await ask()).ev.at(-1)).toEqual({ type: 'done', reason: 'length', raw: 'length' })
    handler = sse([], 'content_filter')
    expect((await ask()).ev).toEqual([{ type: 'done', reason: 'content-filter', raw: 'content_filter' }])
    handler = (_req, res) => {
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      res.write(chunk({ reasoning_content: '用户要太空背景' }))
      res.write(chunk({ content: '{}' }))
      res.write(chunk({}, 'stop'))
      res.end('data: [DONE]\n\n')
    }
    const { ev } = await ask()
    expect(ev.find((e) => e.type === 'reasoning')).toEqual({ type: 'reasoning', text: '用户要太空背景' })
    expect(textOf(ev)).toBe('{}')
  })

  it.each([
    ['key 不对', 401, { error: { message: 'Authentication Fails', type: 'authentication_error' } }, 'unauthorized'],
    ['DeepSeek 余额不足', 402, { error: { message: 'Insufficient Balance' } }, 'quota'],
    ['频率', 429, { error: { code: '1302', message: '您的账户已达到速率限制，请您控制请求频率' } }, 'quota'],
    ['通义欠费（400）', 400, { error: { code: 'Arrearage', message: 'Access denied, please make sure your account is in good standing.' } }, 'quota'],
    ['豆包欠费（403）', 403, { error: { code: 'AccountOverdueError', message: 'The request failed because your account has an overdue balance.' } }, 'quota'],
    ['智谱审核 1301', 400, { error: { code: '1301', message: '系统检测到输入或生成内容可能包含不安全或敏感内容' } }, 'blocked'],
    ['通义审核', 400, { error: { code: 'data_inspection_failed', type: 'data_inspection_failed', message: 'Input data may contain inappropriate content.' } }, 'blocked'],
    ['豆包审核', 400, { error: { code: 'InputTextSensitiveContentDetected', type: 'BadRequest', message: 'The request failed because the input text may contain sensitive information.' } }, 'blocked'],
    ['模型不存在', 400, { error: { message: 'Model Not Exist' } }, 'server'],
    ['服务出错', 500, { error: { message: 'Internal error' } }, 'server'],
  ])('错误分类：%s（%i）→ %s，错误原文照带', async (_name, status, body, type) => {
    handler = fail(status, body)
    const { res, ev } = await ask()
    expect(res.statusCode).toBe(200)
    expect(ev).toEqual([{ type: 'error', error: type, status, message: body.error.message }])
  })

  it('key 里有 HTTP 头放不下的字符（全角空格、中文）→ API Key 无效，不发出去', async () => {
    for (const key of ['sk-1　2', 'sk-密钥']) {
      const { ev } = await ask({ key })
      expect(ev).toEqual([{ type: 'error', error: 'unauthorized', message: 'API Key 含有无法使用的字符' }])
    }
    expect(seen).toHaveLength(0)
    handler = sse(['{}'])
    await ask({ key: ` ${KEY}　` })
    expect(seen[0].headers.authorization).toBe(`Bearer ${KEY}`)
  })

  it('等太久 → timeout（第一段、两段之间各有上限）', async () => {
    const was = { ...AI_TIMEOUTS }
    Object.assign(AI_TIMEOUTS, { firstChunkMs: 300, chunkMs: 300 })
    try {
      handler = (_req, res) => void res.writeHead(200, { 'content-type': 'text/event-stream' }).flushHeaders()
      expect((await ask()).ev).toEqual([expect.objectContaining({ type: 'error', error: 'timeout' })])
      handler = (_req, res) => void res.writeHead(200, { 'content-type': 'text/event-stream' }).write(chunk({ content: '第一段' }))
      const { ev } = await ask()
      expect(ev[0]).toEqual({ type: 'delta', text: '第一段' })
      expect(ev.at(-1)).toMatchObject({ type: 'error', error: 'timeout' })
      for (let i = 0; i < 40 && !seen.every((s) => s.cut); i++) await new Promise((ok) => setTimeout(ok, 50))
      expect(seen.map((s) => s.cut)).toEqual([true, true])
    } finally {
      Object.assign(AI_TIMEOUTS, was)
    }
  })

  it('连不上 → network', async () => {
    const { ev } = await ask({ service: service({ url: 'http://127.0.0.1:1/v1' }) })
    expect(ev).toHaveLength(1)
    expect(ev[0]).toMatchObject({ type: 'error', error: 'network' })
  })

  it('token 用量：服务在流里带了 usage 就随 done 回来（输入 / 其中缓存 / 输出）；没带不写', async () => {
    handler = (_req, res) => {
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      res.write(chunk({ content: '好' }))
      res.write(chunk({}, 'stop'))
      res.write(`data: ${JSON.stringify({ id: 'c1', object: 'chat.completion.chunk', created: 1, model: 'glm-4-6', choices: [], usage: { prompt_tokens: 1200, completion_tokens: 30, prompt_tokens_details: { cached_tokens: 1024 } } })}\n\n`)
      res.end('data: [DONE]\n\n')
    }
    expect((await ask()).ev.at(-1)).toEqual({ type: 'done', reason: 'stop', raw: 'stop', usage: { input: 1200, cacheRead: 1024, output: 30 } })
    handler = sse(['好'])
    expect((await ask()).ev.at(-1)).toEqual({ type: 'done', reason: 'stop', raw: 'stop' })
  })

  it('Anthropic：system 打缓存点 + 顶层自动缓存；缓存命中随 usage 回来', async () => {
    const ev = (type: string, data: object) => `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`
    handler = (_req, res) => {
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      res.write(ev('message_start', { message: { id: 'm1', type: 'message', role: 'assistant', model: 'claude-x', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 20, output_tokens: 1, cache_read_input_tokens: 900, cache_creation_input_tokens: 0 } } }))
      res.write(ev('content_block_start', { index: 0, content_block: { type: 'text', text: '' } }))
      res.write(ev('content_block_delta', { index: 0, delta: { type: 'text_delta', text: '好的' } }))
      res.write(ev('content_block_stop', { index: 0 }))
      res.write(ev('message_delta', { delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 7 } }))
      res.end(ev('message_stop', {}))
    }
    const messages = [
      { role: 'user', content: '第一轮' },
      { role: 'assistant', content: '第一轮的回答' },
      { role: 'user', content: '第二轮' },
    ]
    const { ev: got } = await ask({ service: service({ kind: 'anthropic', model: 'claude-x' }), messages })
    expect(textOf(got)).toBe('好的')
    expect(got.at(-1)).toMatchObject({ type: 'done', reason: 'stop', usage: { cacheRead: 900, output: 7 } })
    const [s] = seen
    expect(s.url).toBe('/v1/messages')
    expect(s.body?.system).toEqual([{ type: 'text', text: 'RULES', cache_control: { type: 'ephemeral' } }])
    expect(s.body?.cache_control).toEqual({ type: 'ephemeral' })
    expect((s.body?.messages as { role: string }[]).map((m) => m.role)).toEqual(['user', 'assistant', 'user'])
  })

  it('格式不对 400（服务、模型、对话）；别的网站发来 403；key 不进日志', async () => {
    const bad = (payload: object) => app.inject({ method: 'POST', url: '/api/ai/ask', headers: H, payload })
    expect((await bad({ service: { kind: 'x', url: base }, messages: [{ role: 'user', content: 'a' }] })).statusCode).toBe(400)
    expect((await bad({ service: service({ model: ' ' }), messages: [{ role: 'user', content: 'a' }] })).statusCode).toBe(400)
    expect((await bad({ service: service(), messages: [] })).statusCode).toBe(400)
    expect((await bad({ service: service(), messages: [{ role: 'system', content: 'a' }] })).statusCode).toBe(400)
    const cross = await app.inject({ method: 'POST', url: '/api/ai/ask', headers: { ...H, 'sec-fetch-site': 'cross-site' }, payload: { service: service(), key: KEY } })
    expect(cross.statusCode).toBe(403)
    handler = fail(500, { error: { message: 'Internal error' } })
    await ask()
    const log = path.join(config.appDir, 'logs', 'server.log')
    expect(!existsSync(log) || !readFileSync(log, 'utf8').includes(KEY)).toBe(true)
    expect(seen).toHaveLength(1)
  })

  it('OpenAI 的 key 留空也不去读环境变量 OPENAI_API_KEY', async () => {
    const was = process.env.OPENAI_API_KEY
    process.env.OPENAI_API_KEY = 'env-key-不该用'
    try {
      handler = fail(401, { error: { message: 'Missing key' } })
      const { ev } = await ask({ service: service({ kind: 'openai', model: 'gpt-x' }), key: '' })
      expect(ev[0]).toMatchObject({ type: 'error', error: 'unauthorized' })
      expect(String(seen[0].headers.authorization ?? '')).not.toContain('env-key')
    } finally {
      if (was === undefined) delete process.env.OPENAI_API_KEY
      else process.env.OPENAI_API_KEY = was
    }
  })

  it('页面断开 → 上游请求也断', async () => {
    handler = (_req, res) => {
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      res.write(chunk({ content: '第一段' }))
    }
    const port = await fetchablePort(
      async () => {
        await app.listen({ port: 0, host: '127.0.0.1' })
        return (app.server.address() as AddressInfo).port
      },
      async () => {
        await app.close()
        app = await buildApp(config)
      },
    )
    const ctrl = new AbortController()
    const res = await fetch(`http://127.0.0.1:${port}/api/ai/ask`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ service: service(), key: KEY, system: '', messages: [{ role: 'user', content: 'a' }] }),
      signal: ctrl.signal,
    })
    const reader = res.body!.getReader()
    const first = new TextDecoder().decode((await reader.read()).value)
    expect(JSON.parse(first.split('\n')[0])).toEqual({ type: 'delta', text: '第一段' })
    expect(seen[0].cut).toBe(false)
    ctrl.abort()
    for (let i = 0; i < 40 && !seen[0].cut; i++) await new Promise((ok) => setTimeout(ok, 50))
    expect(seen[0].cut).toBe(true)
  })
})

describe('/api/ai/models', () => {
  const models = (o: object) => app.inject({ method: 'POST', url: '/api/ai/models', headers: H, payload: o }).then((r) => r.json())

  it('OpenAI 兼容：GET /models 的 id；没填 key 不带 Authorization', async () => {
    handler = (_req, res) => res.end(JSON.stringify({ object: 'list', data: [{ id: 'glm-4-6' }, { id: 'glm-4-5' }] }))
    expect(await models({ service: service({ model: '' }), key: KEY })).toEqual({ models: ['glm-4-6', 'glm-4-5'] })
    expect(seen[0]).toMatchObject({ method: 'GET', url: '/v1/models' })
    expect(seen[0].headers.authorization).toBe(`Bearer ${KEY}`)
    await models({ service: service(), key: '' })
    expect(seen[1].headers.authorization).toBeUndefined()
  })

  it('Anthropic、Gemini 各自的列表接口和 key 头；Gemini 只要能生成文字的', async () => {
    handler = (_req, res) => res.end(JSON.stringify({ data: [{ id: 'claude-x', display_name: 'Claude X' }], has_more: false }))
    expect(await models({ service: service({ kind: 'anthropic' }), key: KEY })).toEqual({ models: ['claude-x'] })
    expect(seen[0].url).toBe('/v1/models?limit=1000')
    expect(seen[0].headers).toMatchObject({ 'x-api-key': KEY, 'anthropic-version': '2023-06-01' })
    handler = (_req, res) =>
      res.end(
        JSON.stringify({
          models: [
            { name: 'models/gemini-x', supportedGenerationMethods: ['generateContent', 'countTokens'] },
            { name: 'models/embedding-x', supportedGenerationMethods: ['embedContent'] },
          ],
        }),
      )
    expect(await models({ service: service({ kind: 'google', url: `${base}/v1beta` }), key: KEY })).toEqual({ models: ['gemini-x'] })
    expect(seen[1].url).toBe('/v1beta/models?pageSize=1000')
    expect(seen[1].headers['x-goog-api-key']).toBe(KEY)
  })

  it('取不到：空列表 + 原因（key 不对 / 连不上）', async () => {
    handler = fail(401, { error: { message: 'Invalid token' } })
    expect(await models({ service: service(), key: KEY })).toEqual({ models: [], error: 'unauthorized', status: 401, message: 'Invalid token' })
    expect(await models({ service: service({ url: 'http://127.0.0.1:1/v1' }), key: KEY })).toMatchObject({ models: [], error: 'network' })
    handler = fail(404, { error: { message: 'Not Found' } })
    expect(await models({ service: service(), key: KEY })).toEqual({ models: [] })
  })
})
