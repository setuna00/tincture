// Loopback Host validation prevents DNS rebinding; Sec-Fetch-Site rejects requests initiated by other websites.
// Require the current library ID so stale pages cannot write into a switched or reset library.
// Reject test cookies outside test mode so misdirected tests cannot modify the real library.
import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify'
import { spawn } from 'node:child_process'
import { createReadStream, existsSync, mkdirSync, statSync } from 'node:fs'
import { appendFile, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { registerAgent } from './agent.ts'
import { registerAi } from './ai.ts'
import { readSettings, writeSettings, type Config } from './config.ts'
import { ID_RE, Library, LibraryLocked, type ImageMeta, type VersionMeta } from './library.ts'

const TEST_COOKIE = 'pe-test'
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1'])

interface Scope {
  dir: string
  lib: Library | null
  opening: Promise<Library> | null
}

class HttpError extends Error {
  statusCode: number
  code?: string
  constructor(statusCode: number, message: string, code?: string) {
    super(message)
    this.statusCode = statusCode
    this.code = code
  }
}

function openLibrary(dir: string, status: number): Library {
  try {
    return new Library(dir)
  } catch (e) {
    if (e instanceof LibraryLocked) throw new HttpError(status, '图库文件夹已被另一个窗口使用', e.code)
    throw e
  }
}

const STATIC_MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.wasm': 'application/wasm',
  '.txt': 'text/plain; charset=utf-8',
}

const LINK_ICONS = ['https://www.pixiv.net', 'https://abs.twimg.com', 'https://bsky.app', 'https://www.fanbox.cc', 'https://*.patreon.com', 'https://weibo.com', 'https://www.lofter.com', 'https://www.artstation.com']

/** Blob workers and inline React/Radix styles require these CSP allowances; AI requests stay on this backend. */
export const PAGE_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  `img-src 'self' blob: data: https://*.donmai.us ${LINK_ICONS.join(' ')}`,
  "font-src 'self' data:",
  "connect-src 'self' blob: data: https://image.novelai.net https://*.donmai.us",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "frame-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ')

/** Library files must never execute scripts, including SVG files opened directly. */
export const FILE_CSP = "default-src 'none'; style-src 'unsafe-inline'; sandbox"

export interface Hooks {
  reveal?: (dir: string) => unknown
}

function cookie(req: FastifyRequest, name: string): string | undefined {
  const raw = req.headers.cookie
  if (!raw) return undefined
  for (const part of raw.split(';')) {
    const [k, ...v] = part.trim().split('=')
    if (k === name) return decodeURIComponent(v.join('='))
  }
  return undefined
}

/** Upload layout: [u32 big-endian record byte length][UTF-8 record JSON][u32 big-endian snapshot byte length][UTF-8 snapshot JSON][raw image]. */
function parseFramed(buf: Buffer): { meta: ImageMeta; doc: string; bytes: Uint8Array } {
  let at = 0
  const take = () => {
    if (at + 4 > buf.length) throw new HttpError(400, '格式不对')
    const n = buf.readUInt32BE(at)
    const s = buf.subarray(at + 4, at + 4 + n).toString('utf8')
    at += 4 + n
    return s
  }
  const json = (s: string) => {
    try {
      return JSON.parse(s) as unknown
    } catch {
      throw new HttpError(400, '格式不对')
    }
  }
  const m = (json(take()) ?? {}) as Partial<ImageMeta>
  const doc = take()
  const parsed = json(doc)
  if (!parsed || typeof parsed !== 'object') throw new HttpError(400, '快照不对')
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
  const str = (v: unknown) => (typeof v === 'string' ? v : '')
  if (!m.id || !ID_RE.test(m.id)) throw new HttpError(400, 'id 不对')
  const bytes = buf.subarray(at)
  const meta: ImageMeta = {
    id: m.id,
    tabId: str(m.tabId),
    ...(m.versionId && ID_RE.test(m.versionId) ? { versionId: m.versionId } : {}),
    ...(m.label && /^[a-z-]{1,40}$/.test(m.label) ? { label: m.label } : {}),
    ...(m.sourceId && ID_RE.test(m.sourceId) ? { sourceId: m.sourceId } : {}),
    batch: str(m.batch),
    index: num(m.index),
    createdAt: num(m.createdAt) || Date.now(),
    seed: num(m.seed),
    width: num(m.width),
    height: num(m.height),
    model: str(m.model),
    mime: /^image\/[a-z0-9.+-]+$/.test(str(m.mime)) ? str(m.mime) : 'application/octet-stream',
    size: bytes.byteLength,
  }
  return { meta, doc, bytes }
}

export async function buildApp(config: Config, hooks: Hooks = {}) {
  const app = Fastify({ logger: false, bodyLimit: 256 * 1024 * 1024 })
  const logFile = path.join(config.appDir, 'logs', 'server.log')
  const log = (msg: string) => {
    mkdirSync(path.dirname(logFile), { recursive: true })
    void appendFile(logFile, `${new Date().toISOString()} ${msg}\n`).catch(() => {})
  }

  const settings = config.test ? {} : readSettings(config.appDir)
  const main: Scope = { dir: settings.libraryDir ?? config.defaultLibraryDir, lib: null, opening: null }
  const tests = new Map<string, Scope>()

  function scopeOf(req: FastifyRequest): Scope {
    if (!config.test) return main
    const id = cookie(req, TEST_COOKIE) ?? 'default'
    if (!ID_RE.test(id)) throw new HttpError(400, 'cookie 不对')
    let s = tests.get(id)
    if (!s) tests.set(id, (s = { dir: path.join(config.defaultLibraryDir, id), lib: null, opening: null }))
    return s
  }
  const defaultDirOf = (req: FastifyRequest) => (config.test ? path.join(config.defaultLibraryDir, cookie(req, TEST_COOKIE) ?? 'default') : config.defaultLibraryDir)

  async function libOf(req: FastifyRequest): Promise<Library> {
    const s = scopeOf(req)
    if (s.lib) return s.lib
    s.opening ??= (async () => {
      // A missing selected library may be on a disconnected drive; do not silently replace it with an empty folder.
      if (s.dir !== defaultDirOf(req) && !existsSync(s.dir)) throw new HttpError(503, `图库文件夹不存在：${s.dir}`)
      const lib = openLibrary(s.dir, 503)
      await lib.tidy()
      s.lib = lib
      return lib
    })().finally(() => (s.opening = null))
    return s.opening
  }

  async function writable(req: FastifyRequest): Promise<Library> {
    const lib = await libOf(req)
    if (req.headers['x-pe-library'] !== lib.id) throw new HttpError(409, '图库已更换')
    return lib
  }

  app.addHook('onRequest', async (req, reply) => {
    // Prevent MIME sniffing from turning a stored file into executable content.
    reply.header('x-content-type-options', 'nosniff')
    const site = req.headers['sec-fetch-site']
    if (site && site !== 'same-origin' && site !== 'none') return reply.code(403).send()
    const host = (req.headers.host ?? '').replace(/:\d+$/, '')
    if (!LOCAL_HOSTS.has(host)) return reply.code(403).send()
    if (!config.test && cookie(req, TEST_COOKIE) !== undefined) return reply.code(403).send({ message: '不是测试模式' })
  })

  app.setErrorHandler((err: Error & { statusCode?: number; code?: string }, req, reply) => {
    const status = err.statusCode && err.statusCode >= 400 ? err.statusCode : 500
    if (status >= 500) log(`${req.method} ${req.url} ${status} ${err.code ?? ''} ${err.stack ?? err.message}`)
    void reply.code(status).send({ message: err.message, code: err.code })
  })

  app.addContentTypeParser('application/x-pe-image', { parseAs: 'buffer' }, (_req, body, done) => done(null, body))
  app.addContentTypeParser(/^image\//, { parseAs: 'buffer' }, (_req, body, done) => done(null, body))
  app.addContentTypeParser('application/octet-stream', { parseAs: 'buffer' }, (_req, body, done) => done(null, body))

  const sendFile = (reply: FastifyReply, f: { file: string; mime: string } | null) => {
    if (!f || !existsSync(f.file)) return reply.code(404).send({ message: '没有这张图' })
    return reply
      .header('content-type', f.mime)
      .header('content-length', statSync(f.file).size)
      .header('cache-control', 'private, max-age=31536000, immutable')
      .header('content-security-policy', FILE_CSP)
      .send(createReadStream(f.file))
  }

  app.get('/api/bootstrap', async (req, reply) => {
    let lib: Library
    try {
      lib = await libOf(req)
    } catch (e) {
      const err = e as Error & { statusCode?: number; code?: string }
      if (err.code !== 'LIBRARY_LOCKED') log(`bootstrap ${err.stack ?? err.message}`)
      return reply.code(503).send({ message: err.message, dir: scopeOf(req).dir, code: err.code })
    }
    reply.header('cache-control', 'no-store')
    return { libraryId: lib.id, dir: lib.dir, empty: lib.isEmpty(), kv: lib.kvAll(), imageTabs: lib.imageTabs() }
  })

  app.get<{ Params: { key: string } }>('/api/kv/:key', async (req, reply) => {
    const v = (await libOf(req)).kvGet(req.params.key)
    reply.header('cache-control', 'no-store')
    return v === undefined ? reply.code(404).send({ message: '没有这个键' }) : { value: v }
  })

  app.put<{ Body: { set?: Record<string, string>; del?: string[] } }>('/api/kv', async (req, reply) => {
    const lib = await writable(req)
    const set = req.body?.set ?? {}
    const del = req.body?.del ?? []
    if (Object.values(set).some((v) => typeof v !== 'string') || !Array.isArray(del)) throw new HttpError(400, '格式不对')
    lib.kvApply(set, del)
    return reply.code(204).send()
  })

  app.get<{ Querystring: { tab?: string } }>('/api/images', async (req, reply) => {
    const lib = await libOf(req)
    await lib.checkFiles()
    return reply.header('content-type', 'application/json; charset=utf-8').header('cache-control', 'no-store').send(lib.imagesJson(req.query.tab))
  })

  app.get<{ Params: { id: string } }>('/api/images/:id', async (req, reply) => sendFile(reply, (await libOf(req)).imageFile(req.params.id)))

  app.get<{ Params: { id: string } }>('/api/images/:id/path', async (req, reply) => {
    const f = (await libOf(req)).imageFile(req.params.id)
    reply.header('cache-control', 'no-store')
    return f && existsSync(f.file) ? { path: path.resolve(f.file) } : reply.code(404).send({ message: '没有这张图' })
  })

  app.post('/api/images', { bodyLimit: 128 * 1024 * 1024 }, async (req, reply) => {
    const lib = await writable(req)
    const { meta, doc, bytes } = parseFramed(req.body as Buffer)
    await lib.addImage(meta, doc, bytes)
    return reply.code(201).send({ id: meta.id, size: bytes.byteLength })
  })

  app.delete<{ Params: { id: string }; Querystring: { purge?: string } }>('/api/images/:id', async (req, reply) => {
    const lib = await writable(req)
    if (req.query.purge) await lib.purge(req.params.id)
    else lib.softDelete(req.params.id)
    return reply.code(204).send()
  })

  app.post<{ Params: { id: string } }>('/api/images/:id/restore', async (req, reply) => {
    const lib = await writable(req)
    return lib.restore(req.params.id) ? reply.code(204).send() : reply.code(404).send({ message: '没有这张图' })
  })

  app.get<{ Querystring: { doc?: string } }>('/api/versions', async (req, reply) => {
    const lib = await libOf(req)
    if (!req.query.doc) throw new HttpError(400, '缺少 doc')
    return reply.header('content-type', 'application/json; charset=utf-8').header('cache-control', 'no-store').send(lib.versionsJson(req.query.doc))
  })

  app.post<{ Body: Partial<VersionMeta> & { snapshot?: unknown } }>('/api/versions', async (req, reply) => {
    const lib = await writable(req)
    const b = req.body ?? {}
    const int = (v: unknown) => (typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : undefined)
    if (!b.id || !ID_RE.test(b.id) || typeof b.docId !== 'string' || !b.docId || !int(b.n) || (b.kind !== 'gen' && b.kind !== 'ai') || !b.snapshot || typeof b.snapshot !== 'object')
      throw new HttpError(400, '格式不对')
    const v: VersionMeta = {
      id: b.id,
      docId: b.docId,
      n: b.n!,
      kind: b.kind,
      createdAt: int(b.createdAt) || Date.now(),
      ...(typeof b.aiRequest === 'string' ? { aiRequest: b.aiRequest } : {}),
      ...(int(b.aiCount) !== undefined ? { aiCount: b.aiCount } : {}),
    }
    lib.addVersion(v, JSON.stringify(b.snapshot))
    return reply.code(201).send({ id: v.id })
  })

  app.get<{ Querystring: { doc?: string } }>('/api/chats', async (req, reply) => {
    const lib = await libOf(req)
    if (!req.query.doc) throw new HttpError(400, '缺少 doc')
    return reply.header('content-type', 'application/json; charset=utf-8').header('cache-control', 'no-store').send(lib.chatsJson(req.query.doc))
  })

  // Chats embed the whole document in every message, so one chat can reach many MB.
  app.post<{ Body: { id?: unknown; docId?: unknown; updatedAt?: unknown } }>('/api/chats', { bodyLimit: 64 * 1024 * 1024 }, async (req, reply) => {
    const lib = await writable(req)
    const b = req.body ?? {}
    if (typeof b.id !== 'string' || !ID_RE.test(b.id) || typeof b.docId !== 'string' || !b.docId || typeof b.updatedAt !== 'number') throw new HttpError(400, '格式不对')
    lib.putChat(b.id, b.docId, b.updatedAt, JSON.stringify(b))
    return reply.code(201).send({ id: b.id })
  })

  app.get<{ Querystring: { prefix?: string } }>('/api/assets', async (req, reply) => {
    reply.header('cache-control', 'no-store')
    return (await libOf(req)).assetKeys(req.query.prefix ?? '')
  })

  app.get<{ Params: { key: string } }>('/api/assets/:key', async (req, reply) => {
    const f = (await libOf(req)).assetFile(req.params.key)
    // Asset keys survive image replacement, so caching by key can serve stale content.
    if (!f || !existsSync(f.file)) return reply.code(404).send({ message: '没有这张图' })
    return reply.header('content-type', f.mime).header('cache-control', 'no-store').header('content-security-policy', FILE_CSP).send(createReadStream(f.file))
  })

  app.put<{ Params: { key: string } }>('/api/assets/:key', { bodyLimit: 128 * 1024 * 1024 }, async (req, reply) => {
    const lib = await writable(req)
    const body = req.body
    if (!Buffer.isBuffer(body)) throw new HttpError(415, '只收图片')
    await lib.putAsset(req.params.key, String(req.headers['content-type']), body)
    return reply.code(204).send()
  })

  app.delete<{ Params: { key: string } }>('/api/assets/:key', async (req, reply) => {
    await (await writable(req)).delAsset(req.params.key)
    return reply.code(204).send()
  })

  app.get('/api/library', async (req) => ({ dir: scopeOf(req).dir, defaultDir: defaultDirOf(req) }))

  app.post<{ Body: { dir?: string } }>('/api/library', async (req) => {
    await writable(req)
    const s = scopeOf(req)
    const dir = await checkLibraryDir(req.body?.dir ?? '')
    if (path.resolve(dir) === path.resolve(s.dir)) return { dir: s.dir }
    const next = openLibrary(dir, 400)
    await next.tidy()
    s.lib?.close()
    s.lib = next
    s.dir = dir
    if (!config.test) writeSettings(config.appDir, { ...readSettings(config.appDir), libraryDir: dir === config.defaultLibraryDir ? undefined : dir })
    return { dir }
  })

  app.post('/api/library/reveal', async (req) => {
    await writable(req)
    const dir = scopeOf(req).dir
    if (config.test) return { dir }
    if (hooks.reveal) await hooks.reveal(dir)
    else {
      const cmd = process.platform === 'win32' ? 'explorer.exe' : process.platform === 'darwin' ? 'open' : 'xdg-open'
      spawn(cmd, [dir], { detached: true, stdio: 'ignore' }).unref()
    }
    return { dir }
  })

  app.post('/api/migrate/begin', async (req) => ({ token: await (await writable(req)).beginMigration() }))

  app.post<{ Params: { token: string } }>('/api/migrate/:token/image', { bodyLimit: 128 * 1024 * 1024 }, async (req, reply) => {
    const lib = await writable(req)
    const { meta, doc, bytes } = parseFramed(req.body as Buffer)
    await lib.stageImage(req.params.token, meta, doc, bytes)
    return reply.code(204).send()
  })

  app.post<{ Params: { token: string }; Querystring: { key: string } }>('/api/migrate/:token/asset', { bodyLimit: 128 * 1024 * 1024 }, async (req, reply) => {
    const lib = await writable(req)
    if (!Buffer.isBuffer(req.body) || !req.query.key) throw new HttpError(400, '格式不对')
    await lib.stageAsset(req.params.token, req.query.key, String(req.headers['content-type']), req.body)
    return reply.code(204).send()
  })

  app.post<{ Params: { token: string }; Body: { kv: Record<string, string>; expect: { images: number; imageBytes: number; assets: number; assetBytes: number } } }>(
    '/api/migrate/:token/commit',
    async (req) => {
      const lib = await writable(req)
      const kv = req.body?.kv ?? {}
      if (Object.values(kv).some((v) => typeof v !== 'string')) throw new HttpError(400, '格式不对')
      return lib.commitMigration(req.params.token, kv, req.body.expect)
    },
  )

  registerAi(app)
  registerAgent(app)

  if (config.test) {
    app.post<{ Body: { kv?: Record<string, string> } | null }>('/api/test/reset', async (req) => {
      const s = scopeOf(req)
      if (s.opening) await s.opening.catch(() => {})
      s.lib?.close()
      s.lib = null
      s.dir = defaultDirOf(req)
      await Library.wipe(s.dir)
      const lib = await libOf(req)
      if (req.body?.kv) lib.kvApply(req.body.kv, [])
      return { libraryId: lib.id, dir: lib.dir }
    })

    app.post('/api/test/reopen', async (req) => {
      const s = scopeOf(req)
      if (s.opening) await s.opening.catch(() => {})
      s.lib?.close()
      s.lib = null
      const lib = await libOf(req)
      return { libraryId: lib.id, dir: lib.dir }
    })
  }

  if (config.staticDir) {
    const root = path.resolve(config.staticDir)
    app.get('/*', async (req, reply) => {
      const rel = decodeURIComponent((req.params as { '*': string })['*'] || 'index.html')
      const file = path.resolve(root, rel)
      if (rel.startsWith('api/') || !file.startsWith(root + path.sep) || !existsSync(file) || !statSync(file).isFile()) return reply.code(404).send({ message: '没有这个文件' })
      const ext = path.extname(file).toLowerCase()
      return reply
        .header('content-type', STATIC_MIME[ext] ?? 'application/octet-stream')
        .header('cache-control', rel.startsWith('assets/') ? 'public, max-age=31536000, immutable' : 'no-cache')
        .header('content-security-policy', PAGE_CSP)
        .send(createReadStream(file))
    })
  }

  app.addHook('onClose', async () => {
    main.lib?.close()
    for (const s of tests.values()) s.lib?.close()
  })

  return app
}

async function checkLibraryDir(raw: string): Promise<string> {
  const dir = raw.trim().replace(/^"(.*)"$/, '$1')
  if (!dir || !path.isAbsolute(dir) || (process.platform === 'win32' && !/^([a-zA-Z]:[\\/]|\\\\)/.test(dir))) throw new HttpError(400, '请输入完整路径')
  const abs = path.resolve(dir)
  if (existsSync(abs)) {
    if (!statSync(abs).isDirectory()) throw new HttpError(400, '该路径不是文件夹')
  } else {
    if (!existsSync(path.dirname(abs))) throw new HttpError(400, '上级文件夹不存在')
    try {
      mkdirSync(abs)
    } catch {
      throw new HttpError(400, '无法在此处新建文件夹')
    }
  }
  const probe = path.join(abs, `.write-test-${process.pid}`)
  try {
    await writeFile(probe, '')
    await unlink(probe)
  } catch {
    throw new HttpError(400, '无法写入该文件夹')
  }
  return abs
}
