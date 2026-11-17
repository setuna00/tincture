import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { mkdtempSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AGENT_PROMPTS, AGENT_TIMEOUTS, NOT_ACCEPTING } from './agent.ts'
import { buildApp } from './app.ts'
import { fetchablePort } from './test-port.ts'

let root: string
let app: Awaited<ReturnType<typeof buildApp>>
let base: string

beforeEach(async () => {
  root = mkdtempSync(path.join(os.tmpdir(), 'pe-agent-'))
  const port = await fetchablePort(
    async () => {
      app = await buildApp({ port: 0, appDir: path.join(root, 'app'), defaultLibraryDir: path.join(root, 'lib'), test: false })
      return Number(new URL(await app.listen({ port: 0, host: '127.0.0.1' })).port)
    },
    () => app.close(),
  )
  base = `http://127.0.0.1:${port}`
})
afterEach(async () => {
  // Undici leaves an idle spare socket after SSE aborts; destroy it after close stops new connections to avoid waiting for keep-alive.
  let closed = false
  const closing = app.close().finally(() => (closed = true))
  while (!closed && app.server.listening) await new Promise((ok) => setImmediate(ok))
  app.server.closeAllConnections()
  await closing
  await rm(root, { recursive: true, force: true })
})

type Answer = { ok: boolean; text: string; images?: unknown[] }
async function fakePage(handle: (tool: string, args: unknown) => Answer | null | Promise<Answer | null>) {
  const ctl = new AbortController()
  const res = await fetch(`${base}/api/agent/events`, { signal: ctl.signal })
  const reader = res.body!.pipeThrough(new TextDecoderStream()).getReader()
  const calls: { tool: string; args: unknown; client: string }[] = []
  const waiters: { tool: string; ok: () => void }[] = []
  const received = (tool: string) => (calls.some((x) => x.tool === tool) ? Promise.resolve() : new Promise<void>((ok) => waiters.push({ tool, ok })))
  let ready!: () => void
  const isReady = new Promise<void>((r) => (ready = r))
  void (async () => {
    let buf = ''
    for (;;) {
      const { value, done } = await reader.read().catch(() => ({ value: '', done: true }))
      if (done) return
      buf += value
      let i
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const line = buf.slice(0, i)
        buf = buf.slice(i + 2)
        if (!line.startsWith('data: ')) continue
        const m = JSON.parse(line.slice(6))
        if (m.type === 'ready') ready()
        if (m.type !== 'call') continue
        calls.push(m)
        for (const w of waiters) if (w.tool === m.tool) w.ok()
        const r = await handle(m.tool, m.args)
        if (r) await fetch(`${base}/api/agent/result`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: m.id, ...r }) })
      }
    }
  })()
  await isReady
  return { calls, received, close: () => ctl.abort() }
}
const connect = async () => {
  const c = new Client({ name: 'test-agent', version: '1' })
  await c.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`)))
  return c
}
type Content = { type: string; text?: string; data?: string; mimeType?: string }[]
const text = (r: Awaited<ReturnType<Client['callTool']>>) => (r.content as Content).flatMap((x) => (x.type === 'text' ? [x.text] : [])).join('')
const JPEG = '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q=='

describe('/mcp', () => {
  it('没有页面订阅：503 + 原因（代理那边看得到）', async () => {
    await expect(connect()).rejects.toThrow(/not accepting AI agent connections/)
    const r = await fetch(`${base}/mcp`, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: '{}' })
    expect(r.status).toBe(503)
    expect(((await r.json()) as { error: { message: string } }).error.message).toBe(NOT_ACCEPTING)
  })

  it('页面订阅着：列出 14 个工具、调用转给页面、页面的结果原样回去（出错的带 isError）', async () => {
    const page = await fakePage((tool, args) => (tool === 'search_tags' ? { ok: true, text: `hits for ${(args as { query: string }).query}` } : { ok: false, text: 'nope' }))
    const c = await connect()
    const tools = (await c.listTools()).tools
    expect(tools).toHaveLength(14)
    expect(tools.map((t) => t.name).slice(0, 5)).toEqual(['get_editor_state', 'new_document', 'read_document', 'edit_document', 'reroll_random'])
    const gen = tools.find((t) => t.name === 'generate')!
    expect(Object.keys(gen.inputSchema.properties ?? {})).toEqual(['tab'])
    expect(gen.description).toMatch(/confirm/)
    expect(gen.description).toMatch(/Anlas/)
    expect(gen.description).toMatch(/One call at a time/)
    expect(gen.description).toMatch(/waited_seconds/)
    expect(gen.description).toMatch(/absolute file path/)
    expect(gen.description).not.toMatch(/not call it in a loop/)
    const r = await c.callTool({ name: 'search_tags', arguments: { query: '长发' } })
    expect(text(r)).toBe('hits for 长发')
    expect(r.isError).toBeFalsy()
    const bad = await c.callTool({ name: 'list_lists', arguments: {} })
    expect(bad.isError).toBe(true)
    expect(text(bad)).toBe('nope')
    expect(page.calls.map((x) => x.client)).toEqual(['test-agent', 'test-agent'])
    expect((await c.callTool({ name: 'generate_image', arguments: {} })).isError).toBe(true)
    expect(page.calls).toHaveLength(2)
    await c.close()
    page.close()
  })

  it('页面没回：报超时；页面中途断开：等着的调用收到原因', async () => {
    const old = AGENT_TIMEOUTS.callMs
    AGENT_TIMEOUTS.callMs = 300
    try {
      const page = await fakePage(() => null)
      const c = await connect()
      expect(text(await c.callTool({ name: 'get_editor_state', arguments: {} }))).toMatch(/did not answer in time/)
      AGENT_TIMEOUTS.callMs = old
      const pending = c.callTool({ name: 'list_lists', arguments: {} })
      await page.received('list_lists')
      page.close()
      expect(text(await pending)).toMatch(/closed or stopped accepting/)
      await c.close()
    } finally {
      AGENT_TIMEOUTS.callMs = old
    }
  })

  it('generate：转给页面（只带 tab），结果 = 文字 + 图片内容；不是图片的不收', async () => {
    const page = await fakePage((tool) =>
      tool === 'generate'
        ? { ok: true, text: '{"version":3}', images: [{ data: JPEG, mimeType: 'image/jpeg' }, { data: 'x', mimeType: 'text/html' }, { data: 1, mimeType: 'image/png' }, 'junk'] }
        : null,
    )
    const c = await connect()
    const r = await c.callTool({ name: 'generate', arguments: { tab: 't1' } })
    expect(page.calls).toEqual([{ type: 'call', id: expect.any(String), tool: 'generate', args: { tab: 't1' }, client: 'test-agent' }])
    expect(r.isError).toBeFalsy()
    expect(r.content).toEqual([
      { type: 'text', text: '{"version":3}' },
      { type: 'image', data: JPEG, mimeType: 'image/jpeg' },
    ])
    await c.close()
    page.close()
  })

  it('generate 出错（忙、没令牌、402……）：isError + 页面写的原因', async () => {
    const page = await fakePage(() => ({ ok: false, text: 'Tincture is already generating; nothing was queued.' }))
    const c = await connect()
    const r = await c.callTool({ name: 'generate', arguments: {} })
    expect(r.isError).toBe(true)
    expect(r.content).toEqual([{ type: 'text', text: 'Tincture is already generating; nothing was queued.' }])
    await c.close()
    page.close()
  })

  it('generate 等用户：按 reviewMs（15 分钟）等，不按 callMs；到点了回「没完成」', async () => {
    const old = { ...AGENT_TIMEOUTS }
    expect(AGENT_TIMEOUTS.reviewMs).toBe(15 * 60_000)
    AGENT_TIMEOUTS.callMs = 200
    try {
      let release!: () => void
      const released = new Promise<void>((ok) => (release = ok))
      const page = await fakePage(async (tool) => (tool === 'generate' ? (await released, { ok: true, text: 'done' }) : null))
      const c = await connect()
      const late = c.callTool({ name: 'generate', arguments: {} })
      await page.received('generate')
      expect(text(await c.callTool({ name: 'list_lists', arguments: {} }))).toMatch(/did not answer in time/)
      release()
      expect(text(await late)).toBe('done')
      AGENT_TIMEOUTS.reviewMs = 300
      const never = await fakePage(() => null)
      const c2 = await connect()
      const r = await c2.callTool({ name: 'generate', arguments: {} })
      expect(r.isError).toBe(true)
      expect(text(r)).toMatch(/did not finish in time/)
      await c.close()
      await c2.close()
      page.close()
      never.close()
    } finally {
      Object.assign(AGENT_TIMEOUTS, old)
    }
  })

  it('check_document: only a tab, forwarded to the page as it is; the description names every list', async () => {
    const page = await fakePage((tool) => (tool === 'check_document' ? { ok: true, text: '{"unknown":[]}' } : null))
    const c = await connect()
    const def = (await c.listTools()).tools.find((t) => t.name === 'check_document')!
    expect(Object.keys(def.inputSchema.properties ?? {})).toEqual(['tab'])
    for (const w of ['unknown', 'similar', 'alias', 'old_name', 'NovelAI knows the old name', 'duplicate', 'nai_duplicate', 'Sentences, artists and years are never unknown']) expect(def.description).toContain(w)
    expect(c.getInstructions()).toMatch(/check_document/)
    const r = await c.callTool({ name: 'check_document', arguments: { tab: 't2' } })
    expect(text(r)).toBe('{"unknown":[]}')
    expect(page.calls).toEqual([{ type: 'call', id: expect.any(String), tool: 'check_document', args: { tab: 't2' }, client: 'test-agent' }])
    await c.close()
    page.close()
  })

  it('new_document (optional title) and reroll_random (tab + section) are forwarded as they are; the page\'s errors come back', async () => {
    const page = await fakePage((tool, args) =>
      tool === 'new_document'
        ? { ok: true, text: JSON.stringify({ tab: 't9', title: (args as { title?: string }).title ?? '未命名' }) }
        : tool === 'reroll_random' && (args as { section?: string }).section === 's_art'
          ? { ok: true, text: '{"tags":["artist:a"]}' }
          : { ok: false, text: 'Section "s_x" is not a random section.' },
    )
    const c = await connect()
    const defs = (await c.listTools()).tools
    const nd = defs.find((t) => t.name === 'new_document')!
    expect(Object.keys(nd.inputSchema.properties ?? {})).toEqual(['title'])
    expect(nd.inputSchema.required ?? []).toEqual([])
    const rr = defs.find((t) => t.name === 'reroll_random')!
    expect(Object.keys(rr.inputSchema.properties ?? {})).toEqual(['tab', 'section'])
    expect(rr.inputSchema.required).toEqual(['section'])
    expect(rr.description).toMatch(/locked tags stay/)
    expect(rr.description).toMatch(/one undo step/)
    expect(c.getInstructions()).toMatch(/new_document/)
    expect(c.getInstructions()).toMatch(/reroll_random/)
    expect(JSON.parse(text(await c.callTool({ name: 'new_document', arguments: { title: '雨夜' } })))).toEqual({ tab: 't9', title: '雨夜' })
    expect(text(await c.callTool({ name: 'new_document', arguments: {} }))).toContain('未命名')
    const ok = await c.callTool({ name: 'reroll_random', arguments: { tab: 't9', section: 's_art' } })
    expect(ok.isError).toBeFalsy()
    expect(text(ok)).toBe('{"tags":["artist:a"]}')
    const bad = await c.callTool({ name: 'reroll_random', arguments: { section: 's_x' } })
    expect(bad.isError).toBe(true)
    expect(text(bad)).toMatch(/not a random section/)
    expect(page.calls.map((x) => [x.tool, x.args])).toEqual([
      ['new_document', { title: '雨夜' }],
      ['new_document', {}],
      ['reroll_random', { tab: 't9', section: 's_art' }],
      ['reroll_random', { section: 's_x' }],
    ])
    await c.close()
    page.close()
  })

  it('prompts: 3 one-click actions, Chinese descriptions, no arguments, English bodies; answered without the page', async () => {
    const page = await fakePage(() => ({ ok: true, text: '' }))
    const c = await connect()
    expect(c.getServerCapabilities()?.prompts).toBeDefined()
    const { prompts } = await c.listPrompts()
    expect(prompts.map((p) => [p.name, p.title, p.arguments ?? []])).toEqual([
      ['check_spelling', '核对写法', []],
      ['dedupe', '去重', []],
      ['find_conflicts', '查冲突', []],
    ])
    for (const p of prompts) expect(p.description).toMatch(new RegExp(`^${p.title}：`))
    const spell = await c.getPrompt({ name: 'check_spelling' })
    expect(spell.messages).toHaveLength(1)
    expect(spell.messages[0].role).toBe('user')
    const body = (spell.messages[0].content as { type: string; text: string }).text
    expect(body).toBe(AGENT_PROMPTS[0].text)
    expect(body).toMatch(/check_document/)
    expect(body).toMatch(/one edit_document/)
    expect(body).toMatch(/request "核对写法"/)
    for (const p of AGENT_PROMPTS) expect(p.text).toMatch(/do not generate images/i)
    expect(AGENT_PROMPTS[1].text).toMatch(/request "去重"/)
    expect(AGENT_PROMPTS[2].text).toMatch(/do not call edit_document/)
    await expect(c.getPrompt({ name: 'add_detail' })).rejects.toThrow(/Unknown prompt/)
    expect(page.calls).toEqual([])
    await c.close()
    page.close()
  })

  it('别的网站（带 Origin）发来的 403；GET /mcp 405', async () => {
    const page = await fakePage(() => ({ ok: true, text: '' }))
    const evil = await fetch(`${base}/mcp`, { method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://evil.example' }, body: '{}' })
    expect(evil.status).toBe(403)
    expect((await fetch(`${base}/mcp`)).status).toBe(405)
    page.close()
  })
})
