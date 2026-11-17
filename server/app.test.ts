import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { buildApp, FILE_CSP, PAGE_CSP } from './app.ts'
import type { Config } from './config.ts'
import { Library, LibraryLocked, pngSeed } from './library.ts'

let root: string
let config: Config
let app: Awaited<ReturnType<typeof buildApp>>

beforeEach(async () => {
  root = mkdtempSync(path.join(os.tmpdir(), 'pe-server-'))
  config = { port: 0, appDir: path.join(root, 'app'), defaultLibraryDir: path.join(root, '图库'), test: false }
  app = await buildApp(config)
})
afterEach(async () => {
  await app.close()
  await rm(root, { recursive: true, force: true })
})

const H = { host: '127.0.0.1:4520' }
const boot = async (headers: Record<string, string> = {}) => (await app.inject({ method: 'GET', url: '/api/bootstrap', headers: { ...H, ...headers } })).json()
const put = (id: string, body: unknown, headers: Record<string, string> = {}) =>
  app.inject({ method: 'PUT', url: '/api/kv', headers: { ...H, 'x-pe-library': id, ...headers }, payload: body as object })

function framed(meta: object, doc: object, bytes: Uint8Array) {
  const enc = (s: string) => {
    const b = Buffer.from(s, 'utf8')
    const n = Buffer.alloc(4)
    n.writeUInt32BE(b.length)
    return Buffer.concat([n, b])
  }
  return Buffer.concat([enc(JSON.stringify(meta)), enc(JSON.stringify(doc)), Buffer.from(bytes)])
}
const png = (n: number) => Uint8Array.from({ length: n }, (_, i) => (i * 7) % 256)
const meta = (id: string, extra: object = {}) => ({ id, tabId: 't_a', batch: 'b1', index: 0, createdAt: Date.UTC(2026, 9, 30, 12), seed: 42, width: 832, height: 1216, model: 'nai-diffusion-5-full', mime: 'image/webp', ...extra })
const postImage = (lib: string, id: string, bytes = png(1000), extra: object = {}) =>
  app.inject({ method: 'POST', url: '/api/images', headers: { ...H, 'x-pe-library': lib, 'content-type': 'application/x-pe-image' }, payload: framed(meta(id, extra), { meta: { title: '雨夜' } }, bytes) })

describe('kv', () => {
  it('空库 → 写 → 启动时一次取全；中文原样', async () => {
    const b = await boot()
    expect(b).toMatchObject({ empty: true, kv: {}, imageTabs: [] })
    expect(existsSync(path.join(config.defaultLibraryDir, 'library.db'))).toBe(true)
    expect((await put(b.libraryId, { set: { 'pe:prefs': '{"标题":"芙莉莲"}', 'pe:doc:t1': '{}' } })).statusCode).toBe(204)
    expect((await put(b.libraryId, { del: ['pe:doc:t1'] })).statusCode).toBe(204)
    const b2 = await boot()
    expect(b2).toMatchObject({ libraryId: b.libraryId, empty: false, kv: { 'pe:prefs': '{"标题":"芙莉莲"}' } })
    expect(b2.kv['pe:doc:t1']).toBeUndefined()
  })

  it('库的 id 对不上（换了库 / 旧页面）→ 409，没写进去', async () => {
    const b = await boot()
    expect((await put('old-id', { set: { a: '1' } })).statusCode).toBe(409)
    expect((await put('', { set: { a: '1' } })).statusCode).toBe(409)
    expect((await boot()).kv).toEqual({})
    expect(b.empty).toBe(true)
  })

  it('别的网站发来的 / 不是本机 Host / 测试 cookie 打到普通模式 → 403', async () => {
    const b = await boot()
    expect((await put(b.libraryId, { set: { a: '1' } }, { 'sec-fetch-site': 'cross-site' })).statusCode).toBe(403)
    expect((await app.inject({ method: 'GET', url: '/api/bootstrap', headers: { host: 'evil.example:4520' } })).statusCode).toBe(403)
    expect((await app.inject({ method: 'GET', url: '/api/bootstrap', headers: { ...H, cookie: 'pe-test=abc' } })).statusCode).toBe(403)
    expect((await app.inject({ method: 'POST', url: '/api/test/reset', headers: H })).statusCode).toBe(404)
  })
})

describe('图', () => {
  it('上传 → 列表（带快照）→ 原样读回；文件在 images/年-月/', async () => {
    const { libraryId } = await boot()
    const bytes = png(5000)
    expect((await postImage(libraryId, 'img_a', bytes)).statusCode).toBe(201)
    const list = (await app.inject({ method: 'GET', url: '/api/images', headers: H })).json()
    expect(list).toEqual([{ ...meta('img_a'), size: 5000, doc: { meta: { title: '雨夜' } } }])
    const file = await app.inject({ method: 'GET', url: '/api/images/img_a', headers: H })
    expect(file.headers['content-type']).toBe('image/webp')
    expect(Buffer.compare(file.rawPayload, Buffer.from(bytes))).toBe(0)
    expect(readdirSync(path.join(config.defaultLibraryDir, 'images', '2026-10'))).toEqual(['img_a.webp'])
    expect((await boot()).imageTabs).toEqual(['t_a'])
    expect((await app.inject({ method: 'GET', url: '/api/images?tab=t_b', headers: H })).json()).toEqual([])
  })

  it('/api/images/:id/path = the absolute file path; 404 for an unknown or soft-deleted image', async () => {
    const { libraryId } = await boot()
    await postImage(libraryId, 'img_a')
    const r = await app.inject({ method: 'GET', url: '/api/images/img_a/path', headers: H })
    expect(r.statusCode).toBe(200)
    const p = r.json().path as string
    expect(path.isAbsolute(p)).toBe(true)
    expect(p).toBe(path.resolve(config.defaultLibraryDir, 'images', '2026-10', 'img_a.webp'))
    expect(existsSync(p)).toBe(true)
    expect((await app.inject({ method: 'GET', url: '/api/images/img_x/path', headers: H })).statusCode).toBe(404)
    await app.inject({ method: 'DELETE', url: '/api/images/img_a', headers: { ...H, 'x-pe-library': libraryId } })
    expect((await app.inject({ method: 'GET', url: '/api/images/img_a/path', headers: H })).statusCode).toBe(404)
  })

  it('软删 → 看不到、能恢复；永久删除连文件一起删；软删的下次打开时清掉', async () => {
    const { libraryId } = await boot()
    await postImage(libraryId, 'img_a')
    await postImage(libraryId, 'img_b')
    const del = (id: string, q = '') => app.inject({ method: 'DELETE', url: `/api/images/${id}${q}`, headers: { ...H, 'x-pe-library': libraryId } })
    const ids = async () => (await app.inject({ method: 'GET', url: '/api/images', headers: H })).json().map((x: { id: string }) => x.id).sort()
    await del('img_a')
    expect(await ids()).toEqual(['img_b'])
    expect((await app.inject({ method: 'GET', url: '/api/images/img_a', headers: H })).statusCode).toBe(404)
    expect((await app.inject({ method: 'POST', url: '/api/images/img_a/restore', headers: { ...H, 'x-pe-library': libraryId } })).statusCode).toBe(204)
    expect(await ids()).toEqual(['img_a', 'img_b'])
    await del('img_b', '?purge=1')
    expect(readdirSync(path.join(config.defaultLibraryDir, 'images', '2026-10'))).toEqual(['img_a.webp'])
    await del('img_a')
    await app.close()
    app = await buildApp(config)
    await boot()
    expect(readdirSync(path.join(config.defaultLibraryDir, 'images', '2026-10'))).toEqual([])
    expect((await boot()).empty).toBe(true)
  })

  it('文件在图库文件夹里被改名 / 挪走 → 列图时按哈希认回来；真没了 → missing', async () => {
    const { libraryId } = await boot()
    await postImage(libraryId, 'img_a', png(3000))
    await postImage(libraryId, 'img_b', png(4000))
    await postImage(libraryId, 'img_c', png(5000))
    const dir = path.join(config.defaultLibraryDir, 'images')
    renameSync(path.join(dir, '2026-10', 'img_a.webp'), path.join(dir, '2026-10', '雨夜 s-42.webp'))
    mkdirSync(path.join(dir, '挪过'))
    renameSync(path.join(dir, '2026-10', 'img_b.webp'), path.join(dir, '挪过', 'b.webp'))
    unlinkSync(path.join(dir, '2026-10', 'img_c.webp'))
    const list = async () => (await app.inject({ method: 'GET', url: '/api/images', headers: H })).json() as { id: string; missing?: boolean }[]
    const byId = Object.fromEntries((await list()).map((x) => [x.id, x]))
    expect([byId.img_a.missing, byId.img_b.missing, byId.img_c.missing]).toEqual([undefined, undefined, true])
    const a = await app.inject({ method: 'GET', url: '/api/images/img_a', headers: H })
    expect(a.statusCode).toBe(200)
    expect(Buffer.compare(a.rawPayload, Buffer.from(png(3000)))).toBe(0)
    expect((await app.inject({ method: 'GET', url: '/api/images/img_b', headers: H })).statusCode).toBe(200)
    await postImage(libraryId, 'img_c', png(5000))
    expect((await list()).every((x) => !x.missing)).toBe(true)
  })

  it('之前的图没有哈希：大小一样、只有一对，PNG 里 NAI 写的 seed 对得上才认回来', async () => {
    const { libraryId } = await boot()
    const naiPng = (seed: number, pad: number) => {
      const chunk = (type: string, body: Buffer) => {
        const n = Buffer.alloc(4)
        n.writeUInt32BE(body.length)
        return Buffer.concat([n, Buffer.from(type, 'latin1'), body, Buffer.alloc(4)])
      }
      const comment = Buffer.concat([Buffer.from('Comment\0', 'latin1'), Buffer.from(JSON.stringify({ prompt: '1girl', seed }), 'utf8')])
      return Uint8Array.from(Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('tEXt', comment), chunk('IDAT', Buffer.alloc(pad)), chunk('IEND', Buffer.alloc(0))]))
    }
    expect(pngSeed(naiPng(42, 10))).toBe(42)
    expect(pngSeed(png(100))).toBeUndefined()
    await postImage(libraryId, 'img_p', naiPng(42, 900), { mime: 'image/png' })
    await postImage(libraryId, 'img_q', naiPng(42, 1900), { mime: 'image/png' })
    await app.close()
    const lib = new Library(config.defaultLibraryDir)
    lib.db.prepare('UPDATE images SET hash = NULL').run()
    lib.close()
    app = await buildApp(config)
    const dir = path.join(config.defaultLibraryDir, 'images', '2026-10')
    renameSync(path.join(dir, 'img_p.png'), path.join(dir, 'p 改名.png'))
    unlinkSync(path.join(dir, 'img_q.png'))
    writeFileSync(path.join(dir, 'q 别的图.png'), naiPng(7, 1900))
    const byId = Object.fromEntries(((await app.inject({ method: 'GET', url: '/api/images', headers: H })).json() as { id: string; missing?: boolean }[]).map((x) => [x.id, x]))
    expect(byId.img_p.missing).toBeUndefined()
    expect(byId.img_q.missing).toBe(true)
  })

  it('id 带路径 / 快照不是 JSON → 400，不写文件', async () => {
    const { libraryId } = await boot()
    expect((await postImage(libraryId, '../evil')).statusCode).toBe(400)
    const bad = Buffer.concat([framed(meta('img_c'), {}, png(10)).subarray(0, 4), Buffer.from('{oops')])
    expect((await app.inject({ method: 'POST', url: '/api/images', headers: { ...H, 'x-pe-library': libraryId, 'content-type': 'application/x-pe-image' }, payload: bad })).statusCode).toBe(400)
    expect(existsSync(path.join(config.defaultLibraryDir, 'images'))).toBe(false)
  })
})

describe('配图', () => {
  it('存 → 按前缀列 → 读 → 换图（旧文件删掉）→ 删', async () => {
    const { libraryId } = await boot()
    const putA = (key: string, bytes: Uint8Array) => app.inject({ method: 'PUT', url: `/api/assets/${encodeURIComponent(key)}`, headers: { ...H, 'x-pe-library': libraryId, 'content-type': 'image/webp' }, payload: Buffer.from(bytes) })
    expect((await putA('tpl-img:abc', png(300))).statusCode).toBe(204)
    expect((await putA('artist-img:ningen mame', png(200))).statusCode).toBe(204)
    expect((await app.inject({ method: 'GET', url: '/api/assets?prefix=tpl-img:', headers: H })).json()).toEqual(['tpl-img:abc'])
    expect((await app.inject({ method: 'GET', url: `/api/assets/${encodeURIComponent('artist-img:ningen mame')}`, headers: H })).rawPayload.length).toBe(200)
    await putA('tpl-img:abc', png(400))
    expect(readdirSync(path.join(config.defaultLibraryDir, 'assets'))).toHaveLength(2)
    expect((await app.inject({ method: 'GET', url: '/api/assets/tpl-img%3Aabc', headers: H })).rawPayload.length).toBe(400)
    await app.inject({ method: 'DELETE', url: '/api/assets/tpl-img%3Aabc', headers: { ...H, 'x-pe-library': libraryId } })
    expect((await app.inject({ method: 'GET', url: '/api/assets/tpl-img%3Aabc', headers: H })).statusCode).toBe(404)
    expect(readdirSync(path.join(config.defaultLibraryDir, 'assets'))).toHaveLength(1)
  })
  it('Vibe 的编码：二进制原样存、原样读回', async () => {
    const { libraryId } = await boot()
    const bytes = Buffer.from('demo-vibe nai-diffusion-4-5-full 0.7')
    const key = encodeURIComponent(`vibe-enc:${'a'.repeat(24)}:4-5-full:0.70`)
    const put = await app.inject({ method: 'PUT', url: `/api/assets/${key}`, headers: { ...H, 'x-pe-library': libraryId, 'content-type': 'application/octet-stream' }, payload: bytes })
    expect(put.statusCode).toBe(204)
    const got = await app.inject({ method: 'GET', url: `/api/assets/${key}`, headers: H })
    expect(got.headers['content-type']).toBe('application/octet-stream')
    expect(got.rawPayload.equals(bytes)).toBe(true)
  })
})

describe('迁移', () => {
  const begin = (lib: string) => app.inject({ method: 'POST', url: '/api/migrate/begin', headers: { ...H, 'x-pe-library': lib } })
  const stage = (lib: string, token: string, id: string, bytes: Uint8Array) =>
    app.inject({ method: 'POST', url: `/api/migrate/${token}/image`, headers: { ...H, 'x-pe-library': lib, 'content-type': 'application/x-pe-image' }, payload: framed(meta(id), { meta: { title: id } }, bytes) })
  const stageAsset = (lib: string, token: string, key: string, bytes: Uint8Array) =>
    app.inject({ method: 'POST', url: `/api/migrate/${token}/asset?key=${encodeURIComponent(key)}`, headers: { ...H, 'x-pe-library': lib, 'content-type': 'image/webp' }, payload: Buffer.from(bytes) })
  const commit = (lib: string, token: string, body: object) => app.inject({ method: 'POST', url: `/api/migrate/${token}/commit`, headers: { ...H, 'x-pe-library': lib }, payload: body })

  it('空库：暂存 → 核对 → 一次写进去；之后库不是空的，不能再迁', async () => {
    const { libraryId } = await boot()
    const { token } = (await begin(libraryId)).json()
    await stage(libraryId, token, 'img_1', png(1200))
    await stage(libraryId, token, 'img_2', png(800))
    await stageAsset(libraryId, token, 'tpl-img:x', png(50))
    expect((await boot()).empty).toBe(true)
    const kv = { 'pe:tabs': '{"state":{}}', 'pe:prefs': '{"中":"文"}' }
    const res = await commit(libraryId, token, { kv, expect: { images: 2, imageBytes: 2000, assets: 1, assetBytes: 50 } })
    expect(res.json()).toEqual({ kv: 2, kvBytes: Buffer.byteLength(Object.values(kv).join('')), images: 2, imageBytes: 2000, assets: 1, assetBytes: 50 })
    const b = await boot()
    expect(b).toMatchObject({ empty: false, kv, imageTabs: ['t_a'] })
    expect(existsSync(path.join(config.defaultLibraryDir, '.migrating'))).toBe(false)
    expect((await begin(libraryId)).statusCode).toBe(409)
  })

  it('条数 / 大小对不上 → 整个作废：库还是空的、文件不留；下次从头来能成', async () => {
    const { libraryId } = await boot()
    const { token } = (await begin(libraryId)).json()
    await stage(libraryId, token, 'img_1', png(1200))
    const bad = await commit(libraryId, token, { kv: { a: '1' }, expect: { images: 2, imageBytes: 2400, assets: 0, assetBytes: 0 } })
    expect(bad.statusCode).toBe(500)
    expect((await boot()).empty).toBe(true)
    expect(existsSync(path.join(config.defaultLibraryDir, 'images'))).toBe(false)
    expect(existsSync(path.join(config.defaultLibraryDir, '.migrating'))).toBe(false)
    expect((await stage(libraryId, token, 'img_9', png(1))).statusCode).toBe(404)
    const t2 = (await begin(libraryId)).json().token
    await stage(libraryId, t2, 'img_1', png(10))
    const t3 = (await begin(libraryId)).json().token
    await stage(libraryId, t3, 'img_1', png(1200))
    expect((await commit(libraryId, t3, { kv: {}, expect: { images: 1, imageBytes: 1200, assets: 0, assetBytes: 0 } })).json()).toMatchObject({ images: 1, imageBytes: 1200 })
    expect(readdirSync(path.join(config.defaultLibraryDir, '.migrating', '..', 'images', '2026-10'))).toEqual(['img_1.webp'])
  })
})

describe('图库文件夹', () => {
  const change = (lib: string, dir: string) => app.inject({ method: 'POST', url: '/api/library', headers: { ...H, 'x-pe-library': lib }, payload: { dir } })

  it('换文件夹：校验路径；换成功 = 换一个库（不复制），记进 settings.json；重启后照旧', async () => {
    const { libraryId } = await boot()
    await put(libraryId, { set: { 'pe:prefs': '1' } })
    expect((await change(libraryId, 'relative\\dir')).json().message).toBe('请输入完整路径')
    expect((await change(libraryId, path.join(root, 'no', 'such'))).json().message).toBe('上级文件夹不存在')
    writeFileSync(path.join(root, 'file.txt'), '')
    expect((await change(libraryId, path.join(root, 'file.txt'))).json().message).toBe('该路径不是文件夹')
    const other = path.join(root, '另一个库')
    expect((await change(libraryId, `"${other}"`)).json()).toEqual({ dir: other })
    const b = await boot()
    expect(b).toMatchObject({ dir: other, empty: true, kv: {} })
    expect(b.libraryId).not.toBe(libraryId)
    expect(JSON.parse(readFileSync(path.join(config.appDir, 'settings.json'), 'utf8'))).toEqual({ libraryDir: other })
    expect((await put(libraryId, { set: { x: '1' } })).statusCode).toBe(409)
    await app.close()
    app = await buildApp(config)
    expect((await boot()).dir).toBe(other)
    expect((await change((await boot()).libraryId, config.defaultLibraryDir)).statusCode).toBe(200)
    expect((await boot()).kv).toEqual({ 'pe:prefs': '1' })
    expect(JSON.parse(readFileSync(path.join(config.appDir, 'settings.json'), 'utf8'))).toEqual({})
  })

  it('换过的文件夹不见了：不自己建，启动报 503（带路径）', async () => {
    const gone = path.join(root, '拔掉的盘')
    await app.close()
    mkdirSync(config.appDir, { recursive: true })
    writeFileSync(path.join(config.appDir, 'settings.json'), JSON.stringify({ libraryDir: gone }))
    app = await buildApp(config)
    const r = await app.inject({ method: 'GET', url: '/api/bootstrap', headers: H })
    expect(r.statusCode).toBe(503)
    expect(r.json()).toMatchObject({ dir: gone })
    expect(existsSync(gone)).toBe(false)
  })
})

describe('测试模式', () => {
  it('按 cookie 各用各的图库；清空只清自己的', async () => {
    await app.close()
    app = await buildApp({ ...config, test: true })
    const a = await boot({ cookie: 'pe-test=a' })
    const b = await boot({ cookie: 'pe-test=b' })
    expect(a.libraryId).not.toBe(b.libraryId)
    await put(a.libraryId, { set: { k: 'a' } }, { cookie: 'pe-test=a' })
    await put(b.libraryId, { set: { k: 'b' } }, { cookie: 'pe-test=b' })
    expect((await boot({ cookie: 'pe-test=a' })).kv).toEqual({ k: 'a' })
    const r = (await app.inject({ method: 'POST', url: '/api/test/reset', headers: { ...H, cookie: 'pe-test=a' }, payload: { kv: { 'pe:prefs': 'x' } } })).json()
    expect(r.libraryId).not.toBe(a.libraryId)
    expect((await boot({ cookie: 'pe-test=a' })).kv).toEqual({ 'pe:prefs': 'x' })
    expect((await boot({ cookie: 'pe-test=b' })).kv).toEqual({ k: 'b' })
    expect((await put(a.libraryId, { set: { k: 'late' } }, { cookie: 'pe-test=a' })).statusCode).toBe(409)
    expect(readdirSync(config.defaultLibraryDir).sort()).toEqual(['a', 'b'])
  })
})

describe('同一个图库文件夹只给一个后端用', () => {
  const holder = (dir: string) =>
    new Promise<{ kill(): Promise<void> }>((resolve, reject) => {
      const code = `import { Library } from './server/library.ts'; new Library(process.argv[1]); console.log('held'); setInterval(() => {}, 1000)`
      const kid = spawn(process.execPath, ['--input-type=module', '-e', code, dir], { stdio: ['ignore', 'pipe', 'inherit'] })
      kid.stdout.once('data', () => resolve({ kill: () => new Promise((r) => (kid.once('exit', () => r()), kid.kill())) }))
      kid.once('exit', (c) => reject(new Error(`holder exited ${c}`)))
    })

  it('同一个进程里第二次打开 → LibraryLocked；关了以后能打开', () => {
    const dir = path.join(root, '锁')
    const a = new Library(dir)
    expect(() => new Library(dir)).toThrow(LibraryLocked)
    a.close()
    new Library(dir).close()
  })

  it('另一个进程占着：启动 503 + LIBRARY_LOCKED（前端显示「图库文件夹已被另一个窗口使用」）；它退出后自动能用', async () => {
    const other = await holder(config.defaultLibraryDir)
    const r = await app.inject({ method: 'GET', url: '/api/bootstrap', headers: H })
    expect(r.statusCode).toBe(503)
    expect(r.json()).toMatchObject({ code: 'LIBRARY_LOCKED', dir: config.defaultLibraryDir })
    expect(existsSync(path.join(config.appDir, 'logs', 'server.log'))).toBe(false)
    await other.kill()
    expect((await app.inject({ method: 'GET', url: '/api/bootstrap', headers: H })).statusCode).toBe(200)
  })

  it('换到一个被占着的文件夹 → 400，还用原来的', async () => {
    const { libraryId } = await boot()
    const busy = path.join(root, '被占着的')
    const other = await holder(busy)
    try {
      const r = await app.inject({ method: 'POST', url: '/api/library', headers: { ...H, 'x-pe-library': libraryId }, payload: { dir: busy } })
      expect(r.statusCode).toBe(400)
      expect(r.json().message).toBe('图库文件夹已被另一个窗口使用')
      expect((await boot()).libraryId).toBe(libraryId)
    } finally {
      await other.kill()
    }
  })
})

describe('程序里发前端（staticDir）', () => {
  it('/ = index.html；assets 长期缓存；出了目录、/api 下没有的都 404', async () => {
    const www = path.join(root, 'www')
    mkdirSync(path.join(www, 'assets'), { recursive: true })
    writeFileSync(path.join(www, 'index.html'), '<!doctype html>首页')
    writeFileSync(path.join(www, 'assets', 'a-1.js'), 'x')
    writeFileSync(path.join(root, 'secret.txt'), 's')
    await app.close()
    app = await buildApp({ ...config, staticDir: www })
    const get = (url: string) => app.inject({ method: 'GET', url, headers: H })
    const home = await get('/')
    expect(home.body).toBe('<!doctype html>首页')
    expect(home.headers['content-type']).toBe('text/html; charset=utf-8')
    expect(home.headers['cache-control']).toBe('no-cache')
    expect((await get('/assets/a-1.js')).headers['cache-control']).toContain('immutable')
    expect((await get('/..%2Fsecret.txt')).statusCode).toBe(404)
    expect((await get('/api/nope')).statusCode).toBe(404)
    expect((await get('/api/library')).statusCode).toBe(200)
  })

  it('pages and their assets carry the CSP and nosniff', async () => {
    const www = path.join(root, 'www')
    mkdirSync(path.join(www, 'assets'), { recursive: true })
    writeFileSync(path.join(www, 'index.html'), '<!doctype html>')
    writeFileSync(path.join(www, 'assets', 'a-1.js'), 'x')
    await app.close()
    app = await buildApp({ ...config, staticDir: www })
    for (const url of ['/', '/assets/a-1.js']) {
      const r = await app.inject({ method: 'GET', url, headers: H })
      expect(r.headers['content-security-policy']).toBe(PAGE_CSP)
      expect(r.headers['x-content-type-options']).toBe('nosniff')
    }
    const csp = Object.fromEntries(PAGE_CSP.split('; ').map((d) => [d.split(' ')[0], d.split(' ').slice(1)]))
    expect(csp['script-src']).toEqual(["'self'"])
    expect(csp['connect-src']).toEqual(expect.arrayContaining(['https://image.novelai.net', 'https://*.donmai.us']))
    expect(csp['object-src']).toEqual(["'none'"])
  })
})

describe('nosniff + no scripts in stored files', () => {
  it('images and assets are sandboxed with nosniff; an SVG opened directly cannot run', async () => {
    const { libraryId } = await boot()
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')
    await postImage(libraryId, 'img_s', svg, { mime: 'image/svg+xml' })
    await app.inject({ method: 'PUT', url: '/api/assets/tpl-img%3As', headers: { ...H, 'x-pe-library': libraryId, 'content-type': 'image/svg+xml' }, payload: svg })
    for (const url of ['/api/images/img_s', '/api/assets/tpl-img%3As']) {
      const r = await app.inject({ method: 'GET', url, headers: H })
      expect(r.statusCode).toBe(200)
      expect(r.headers['content-type']).toBe('image/svg+xml')
      expect(r.headers['x-content-type-options']).toBe('nosniff')
      expect(r.headers['content-security-policy']).toBe(FILE_CSP)
    }
    expect(FILE_CSP).toContain('sandbox')
    expect(FILE_CSP).toContain("default-src 'none'")
    expect((await app.inject({ method: 'GET', url: '/api/library', headers: H })).headers['x-content-type-options']).toBe('nosniff')
    expect((await app.inject({ method: 'GET', url: '/api/images/nope', headers: H })).headers['x-content-type-options']).toBe('nosniff')
  })
})

describe('版本', () => {
  const doc = (tag: string, seed: number | null = null, n = 1) => ({
    base: { prompt: [{ id: 's1', name: '场景', chips: [{ id: 'c1', text: tag }] }], uc: [] },
    characters: [],
    settings: { model: 'nai-diffusion-4-5-full', gen: { steps: 23, seed, nSamples: n } },
    meta: { title: '雨夜' },
  })
  const postVersion = (lib: string, body: object) => app.inject({ method: 'POST', url: '/api/versions', headers: { ...H, 'x-pe-library': lib }, payload: body })
  const versions = async (docId: string) => (await app.inject({ method: 'GET', url: `/api/versions?doc=${docId}`, headers: H })).json()
  const images = async () => (await app.inject({ method: 'GET', url: '/api/images', headers: H })).json() as { id: string; versionId?: string; version?: number }[]

  it('记一版 → 按文档列出（带快照）；图带 versionId + 那一版的编号；格式不对 400；库 id 不对 409', async () => {
    const { libraryId } = await boot()
    expect((await postVersion(libraryId, { id: 'ver_1', docId: 'd_a', n: 1, kind: 'gen', createdAt: 5, snapshot: doc('rain') })).statusCode).toBe(201)
    expect((await postVersion(libraryId, { id: 'ver_2', docId: 'd_a', n: 2, kind: 'ai', createdAt: 6, snapshot: doc('snow'), aiRequest: '换成雪天', aiCount: 2 })).statusCode).toBe(201)
    expect((await postVersion(libraryId, { id: 'ver_3', docId: 'd_a', n: 3, kind: 'gen', createdAt: 7, snapshot: doc('fog') })).statusCode).toBe(201)
    expect((await postVersion(libraryId, { id: 'ver_x', docId: 'd_a', n: 0, kind: 'gen', snapshot: doc('x') })).statusCode).toBe(400)
    expect((await postVersion(libraryId, { id: 'ver_x', docId: 'd_a', n: 4, kind: 'oops', snapshot: doc('x') })).statusCode).toBe(400)
    expect((await postVersion('old', { id: 'ver_x', docId: 'd_a', n: 4, kind: 'gen', snapshot: doc('x') })).statusCode).toBe(409)
    const list = await versions('d_a')
    expect(list.map((v: { n: number }) => v.n)).toEqual([1, 2, 3])
    expect(list[1]).toMatchObject({ id: 'ver_2', kind: 'ai', aiRequest: '换成雪天', aiCount: 2, snapshot: { base: { prompt: [{ chips: [{ text: 'snow' }] }] } } })
    expect(await versions('d_none')).toEqual([])
    await postImage(libraryId, 'img_v', png(10), { tabId: 'd_a', versionId: 'ver_2' })
    expect((await images())[0]).toMatchObject({ id: 'img_v', versionId: 'ver_2', version: 2 })
  })

  it('结果图：标签、原图原样存取；格式不对的不存', async () => {
    const { libraryId } = await boot()
    await postImage(libraryId, 'img_u', png(10), { tabId: 'd_a', versionId: 'ver_2', label: 'upscale', sourceId: 'img_v' })
    await postImage(libraryId, 'img_x', png(10), { tabId: 'd_a', label: 'Bad Label!', sourceId: '../x' })
    const byId = Object.fromEntries((await images()).map((x: { id: string }) => [x.id, x]))
    expect(byId.img_u).toMatchObject({ label: 'upscale', sourceId: 'img_v' })
    expect(byId.img_x).not.toHaveProperty('label')
    expect(byId.img_x).not.toHaveProperty('sourceId')
  })

  it('老图归并成版本：按文档、时间排，内容一样（不比 seed、张数）的归到同一版（改回来也是）；导入的图不归并；重开不再归并', async () => {
    const dir = config.defaultLibraryDir
    await app.close()
    const lib = new Library(dir)
    const at = Date.UTC(2026, 9, 30, 12)
    const add = (id: string, tab: string, batch: string, t: number, d: object) =>
      lib.addImage({ id, tabId: tab, batch, index: 0, createdAt: at + t, seed: 1, width: 64, height: 64, model: 'm', mime: 'image/webp', size: 0 }, JSON.stringify(d), png(10))
    await add('i1', 't_a', 'b1', 0, doc('rain', null, 1))
    await add('i2', 't_a', 'b2', 1, doc('rain', 123, 4))
    await add('i3', 't_a', 'b3', 2, doc('snow'))
    await add('i4', 't_a', 'b4', 3, doc('rain'))
    await add('i5', 't_b', 'b5', 0, doc('rain'))
    await add('i6', 'imported', 'b6', 0, doc('rain'))
    await lib.addImage({ id: 'i7', tabId: 't_a', label: 'import', batch: 'b7', index: 0, createdAt: at + 9, seed: 0, width: 64, height: 64, model: '', mime: 'image/png', size: 0 }, JSON.stringify(doc('fog')), png(10))
    lib.close()
    app = await buildApp(config)
    await boot()
    const imgs = Object.fromEntries((await images()).map((x) => [x.id, x.version]))
    expect(imgs).toEqual({ i1: 1, i2: 1, i3: 2, i4: 1, i5: 1, i6: undefined, i7: undefined })
    expect((await versions('t_a')).map((v: { kind: string; createdAt: number }) => [v.kind, v.createdAt - at])).toEqual([
      ['gen', 0],
      ['gen', 2],
    ])
    await app.close()
    app = await buildApp(config)
    await boot()
    expect(await versions('t_a')).toHaveLength(2)
  })
})

describe('问 AI 的对话', () => {
  const post = (lib: string, body: object) => app.inject({ method: 'POST', url: '/api/chats', headers: { ...H, 'x-pe-library': lib }, payload: body })
  const chats = async (docId: string) => (await app.inject({ method: 'GET', url: `/api/chats?doc=${docId}`, headers: H })).json() as { id: string; title?: string }[]

  it('存一段 → 按文档列出（最近改过的在前，整段原样）；同 id 覆盖；格式不对 400；库 id 不对 409', async () => {
    const { libraryId } = await boot()
    const msgs = [{ id: 'm1', role: 'user', text: '背景改成太空', sent: '## Request\n背景改成太空', doc: { meta: { title: '雨夜' } } }]
    expect((await post(libraryId, { id: 'c_1', docId: 'd_a', updatedAt: 5, title: '第一段', msgs })).statusCode).toBe(201)
    expect((await post(libraryId, { id: 'c_2', docId: 'd_a', updatedAt: 9, title: '第二段', msgs: [] })).statusCode).toBe(201)
    expect((await post(libraryId, { id: 'c_3', docId: 'd_b', updatedAt: 7, title: '别的文档', msgs: [] })).statusCode).toBe(201)
    expect((await chats('d_a')).map((c) => c.title)).toEqual(['第二段', '第一段'])
    expect((await chats('d_a'))[1]).toEqual({ id: 'c_1', docId: 'd_a', updatedAt: 5, title: '第一段', msgs })
    expect((await post(libraryId, { id: 'c_1', docId: 'd_a', updatedAt: 12, title: '第一段（改）', msgs })).statusCode).toBe(201)
    expect((await chats('d_a')).map((c) => c.title)).toEqual(['第一段（改）', '第二段'])
    expect(await chats('d_none')).toEqual([])
    expect((await post(libraryId, { id: '../x', docId: 'd_a', updatedAt: 1 })).statusCode).toBe(400)
    expect((await post(libraryId, { id: 'c_4', updatedAt: 1 })).statusCode).toBe(400)
    expect((await post('old', { id: 'c_4', docId: 'd_a', updatedAt: 1 })).statusCode).toBe(409)
    expect((await app.inject({ method: 'GET', url: '/api/chats', headers: H })).statusCode).toBe(400)
  })
})
