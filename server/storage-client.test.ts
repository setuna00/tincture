import { mkdtempSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildApp } from './app.ts'
import type { Config } from './config.ts'

const shown = new Set<string>()
vi.mock('sonner', () => ({
  toast: Object.assign(() => {}, {
    error: (_: string, o: { id: string }) => shown.add(o.id),
    dismiss: (id: string) => shown.delete(id),
    getToasts: () => [...shown].map((id) => ({ id })),
  }),
}))
const idb = new Map<string, unknown>()
vi.mock('idb-keyval', () => ({
  get: async (k: string) => idb.get(k),
  getMany: async (ks: string[]) => ks.map((k) => idb.get(k)),
  set: async (k: string, v: unknown) => void idb.set(k, v),
  del: async (k: string) => void idb.delete(k),
  keys: async () => [...idb.keys()],
}))

class FakeStorage {
  data = new Map<string, string>()
  get length() {
    return this.data.size
  }
  key = (i: number) => [...this.data.keys()][i] ?? null
  getItem = (k: string) => this.data.get(k) ?? null
  setItem = (k: string, v: string) => void this.data.set(k, v)
  removeItem = (k: string) => void this.data.delete(k)
  clear = () => this.data.clear()
}
let ls: FakeStorage

let root: string
let app: Awaited<ReturnType<typeof buildApp>>
let requests: { method: string; url: string; keepalive: boolean }[]
let failWhen: (method: string, url: string, keepalive: boolean) => boolean

async function fakeFetch(input: string, init: RequestInit = {}) {
  const method = init.method ?? 'GET'
  const url = input.replace(/^\/api/, '/api')
  const keepalive = !!init.keepalive
  requests.push({ method, url, keepalive })
  if (failWhen(method, url, keepalive)) throw new TypeError('Failed to fetch')
  const body = init.body
  const payload = body instanceof Blob ? Buffer.from(await body.arrayBuffer()) : (body as string | undefined)
  const r = await app.inject({ method: method as 'GET', url, headers: { host: '127.0.0.1:4520', ...Object.fromEntries(new Headers(init.headers)) }, payload })
  return new Response(r.statusCode === 204 || !r.rawPayload.length ? null : r.rawPayload, { status: r.statusCode, headers: { 'content-type': String(r.headers['content-type'] ?? '') } })
}

interface StorageModule {
  safeStorage: { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void }
  notStored(k: string): boolean
  startStorage(onMigrate?: () => (done: number, total: number) => void): Promise<Record<string, number> | null>
  settleWrites(): Promise<void>
  assetStore: { get(k: string): Promise<unknown>; set(k: string, v: unknown): Promise<void>; keys(p: string): Promise<string[]> }
  imageStore: {
    list(tab?: string): Promise<{ id: string; size: number; doc: unknown }[]>
    put(img: object, blob: Blob): Promise<void>
    remove(img: object): void
    restore(img: object): void
    blob(id: string): Promise<Blob>
    url(id: string): string
  }
}
async function openPage(peApp?: object): Promise<{ s: StorageModule; win: EventTarget }> {
  vi.resetModules()
  const win = Object.assign(new EventTarget(), peApp ? { peApp } : {})
  vi.stubGlobal('window', win)
  vi.stubGlobal('document', Object.assign(new EventTarget(), { visibilityState: 'visible' }))
  const s = (await import(/* @vite-ignore */ ['..', 'src', 'store', 'storage.ts'].join('/'))) as StorageModule
  return { s, win }
}
const serverKv = async () => (await app.inject({ method: 'GET', url: '/api/bootstrap', headers: { host: '127.0.0.1' } })).json().kv as Record<string, string>
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

beforeEach(async () => {
  root = mkdtempSync(path.join(os.tmpdir(), 'pe-client-'))
  const config: Config = { port: 0, appDir: path.join(root, 'app'), defaultLibraryDir: path.join(root, '图库'), test: false }
  app = await buildApp(config)
  ls = new FakeStorage()
  idb.clear()
  shown.clear()
  requests = []
  failWhen = () => false
  vi.stubGlobal('localStorage', ls)
  vi.stubGlobal('fetch', fakeFetch)
})
afterEach(async () => {
  vi.unstubAllGlobals()
  await app.close()
  await rm(root, { recursive: true, force: true })
})

describe('键值：内存 + 防抖批量写', () => {
  it('读照旧同步；连着改只发一次（停 300ms）；pe:nai 之类照旧 localStorage', async () => {
    const { s } = await openPage()
    expect(await s.startStorage()).toBeNull()
    s.safeStorage.setItem('pe:prefs', '1')
    s.safeStorage.setItem('pe:prefs', '2')
    s.safeStorage.setItem('pe:doc:t1', '{"a":1}')
    s.safeStorage.setItem('pe:nai', 'token')
    expect(s.safeStorage.getItem('pe:prefs')).toBe('2')
    expect(ls.getItem('pe:prefs')).toBeNull()
    expect(ls.getItem('pe:nai')).toBe('token')
    expect(requests.filter((r) => r.method === 'PUT')).toHaveLength(0)
    await wait(400)
    expect(requests.filter((r) => r.method === 'PUT')).toHaveLength(1)
    expect(await serverKv()).toEqual({ 'pe:prefs': '2', 'pe:doc:t1': '{"a":1}' })
    s.safeStorage.setItem('pe:prefs', '2')
    s.safeStorage.removeItem('pe:doc:t1')
    await wait(400)
    expect(requests.filter((r) => r.method === 'PUT')).toHaveLength(2)
    expect(await serverKv()).toEqual({ 'pe:prefs': '2' })
    const { s: s2 } = await openPage()
    await s2.startStorage()
    expect(s2.safeStorage.getItem('pe:prefs')).toBe('2')
  })

  it('一直在改：最多 2 秒发一次', async () => {
    const { s } = await openPage()
    await s.startStorage()
    for (let i = 0; i < 12; i++) {
      s.safeStorage.setItem('pe:doc:t1', String(i))
      await wait(200)
    }
    expect(requests.filter((r) => r.method === 'PUT').length).toBeGreaterThanOrEqual(1)
    await s.settleWrites()
    expect((await serverKv())['pe:doc:t1']).toBe('11')
  })
})

describe('关页面', () => {
  it('没发出去的：keepalive 发掉 + 记补写；keepalive 丢了，下次打开补上', async () => {
    const { s, win } = await openPage()
    await s.startStorage()
    s.safeStorage.setItem('pe:library', '{"docs":["新存的"]}')
    failWhen = (_m, _u, keepalive) => keepalive
    win.dispatchEvent(new Event('pagehide'))
    s.safeStorage.setItem('pe:doc:t9', '{"late":true}')
    await wait(20)
    expect(requests.filter((r) => r.keepalive).length).toBeGreaterThanOrEqual(1)
    expect(JSON.parse(ls.getItem('pe:unsent')!).batch).toEqual([
      ['pe:library', '{"docs":["新存的"]}'],
      ['pe:doc:t9', '{"late":true}'],
    ])
    expect(await serverKv()).toEqual({})
    failWhen = () => false
    const { s: s2 } = await openPage()
    await s2.startStorage()
    expect(s2.safeStorage.getItem('pe:library')).toBe('{"docs":["新存的"]}')
    await s2.settleWrites()
    expect(await serverKv()).toEqual({ 'pe:library': '{"docs":["新存的"]}', 'pe:doc:t9': '{"late":true}' })
    expect(ls.getItem('pe:unsent')).toBeNull()
  })

  it('keepalive 到了：下次打开补写一遍也一样；补写记录是别的库的不用', async () => {
    const { s, win } = await openPage()
    await s.startStorage()
    s.safeStorage.setItem('pe:prefs', 'x')
    win.dispatchEvent(new Event('pagehide'))
    await wait(50)
    expect(await serverKv()).toEqual({ 'pe:prefs': 'x' })
    ls.setItem('pe:unsent', JSON.stringify({ libraryId: 'another-library', batch: [['pe:prefs', 'from-elsewhere']] }))
    const { s: s2 } = await openPage()
    await s2.startStorage()
    expect(s2.safeStorage.getItem('pe:prefs')).toBe('x')
    expect(ls.getItem('pe:unsent')).toBeNull()
  })
})

describe('写失败', () => {
  it('一直提示、自动重试；写进去了提示消失。期间读到的是新的', async () => {
    const { s } = await openPage()
    await s.startStorage()
    failWhen = (m) => m === 'PUT'
    s.safeStorage.setItem('pe:library', 'v1')
    await wait(400)
    expect(shown.has('library-write-failed')).toBe(true)
    expect(s.notStored('pe:library')).toBe(true)
    expect(s.safeStorage.getItem('pe:library')).toBe('v1')
    failWhen = () => false
    await wait(2200)
    expect(shown.has('library-write-failed')).toBe(false)
    expect(s.notStored('pe:library')).toBe(false)
    expect(await serverKv()).toEqual({ 'pe:library': 'v1' })
  })

  it('图库已更换（旧页面）：409 → 提示刷新，不再写', async () => {
    const { s } = await openPage()
    await s.startStorage()
    const id = (await serverKv(), (await app.inject({ method: 'GET', url: '/api/bootstrap', headers: { host: '127.0.0.1' } })).json().libraryId)
    await app.inject({ method: 'POST', url: '/api/library', headers: { host: '127.0.0.1', 'x-pe-library': id }, payload: { dir: path.join(root, '别的库') } })
    s.safeStorage.setItem('pe:prefs', 'late')
    await wait(400)
    expect(shown.has('library-stale')).toBe(true)
    expect(await serverKv()).toEqual({})
    s.safeStorage.setItem('pe:prefs', 'later')
    await wait(400)
    expect(requests.filter((r) => r.method === 'PUT')).toHaveLength(1)
  })
})

describe('图和配图', () => {
  const doc = { meta: { title: '雨夜' } }
  const img = { id: 'img_1', tabId: 't_a', batch: 'b', index: 0, createdAt: 1, seed: 1, width: 8, height: 8, model: 'm', mime: 'image/webp', size: 4, doc }
  it('存了马上能读（内存）、写进图库文件夹；删了能撤销', async () => {
    const { s } = await openPage()
    await s.startStorage()
    const blob = new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'image/webp' })
    await s.imageStore.put(img, blob)
    expect(s.imageStore.url('img_1')).toMatch(/^blob:/)
    await s.settleWrites()
    expect((await s.imageStore.list()).map((x) => [x.id, x.size, x.doc])).toEqual([['img_1', 4, doc]])
    const { s: s2 } = await openPage()
    await s2.startStorage()
    expect(s2.imageStore.url('img_1')).toBe('/api/images/img_1')
    expect([...new Uint8Array(await (await s2.imageStore.blob('img_1')).arrayBuffer())]).toEqual([1, 2, 3, 4])
    s2.imageStore.remove(img)
    await s2.settleWrites()
    expect(await s2.imageStore.list()).toEqual([])
    s2.imageStore.restore(img)
    await s2.settleWrites()
    expect(await s2.imageStore.list('t_a')).toHaveLength(1)
  })

  it('配图（tpl-img:*）进图库文件夹；缓存（dan:*）照旧 IndexedDB', async () => {
    const { s } = await openPage()
    await s.startStorage()
    await s.assetStore.set('tpl-img:abc', new Blob([new Uint8Array(10)], { type: 'image/webp' }))
    await s.assetStore.set('dan:x', { at: 1 })
    await s.settleWrites()
    expect(await s.assetStore.keys('tpl-img:')).toEqual(['tpl-img:abc'])
    expect(idb.has('tpl-img:abc')).toBe(false)
    expect(idb.get('dan:x')).toEqual({ at: 1 })
    const { s: s2 } = await openPage()
    await s2.startStorage()
    expect(((await s2.assetStore.get('tpl-img:abc')) as Blob).size).toBe(10)
  })
})

describe('迁移（浏览器里的老数据 → 图库文件夹）', () => {
  function oldData() {
    ls.setItem('pe:tabs', '{"state":{"order":["t_a"]},"version":3}')
    ls.setItem('pe:doc:t_a', '{"meta":{"title":"芙莉莲 ✨"}}')
    ls.setItem('pe:library', '{"state":{"docs":[]},"version":11}')
    ls.setItem('pe:nai', '{"state":{"token":"pst"}}')
    ls.setItem('pe:seed', 'examples')
    const blob = (n: number) => new Blob([new Uint8Array(n).fill(7)], { type: 'image/webp' })
    idb.set('gen:t_a:img_1', { id: 'img_1', tabId: 't_a', batch: 'b', index: 0, createdAt: Date.UTC(2026, 8, 1), seed: 5, width: 832, height: 1216, model: 'nai-diffusion-5-full', blob: blob(300), doc: { meta: { title: '雨' } } })
    idb.set('gen:imported:img_2', { id: 'img_2', tabId: 'imported', batch: 'b2', index: 0, createdAt: Date.UTC(2026, 9, 1), seed: 0, width: 8, height: 8, model: 'm', blob: blob(200), doc: { meta: { title: '导入' } } })
    idb.set('gen:t_a:broken', { id: 'broken', tabId: 't_a' })
    idb.set('tpl-img:k1', blob(50))
    idb.set('thumb:img_1', blob(5))
    idb.set('dan:x', { at: 1 })
  }

  it('搬全部、核对、浏览器里的不删；再启动不重复搬', async () => {
    oldData()
    const before = new Map(ls.data)
    const { s } = await openPage()
    const progress: string[] = []
    const res = await s.startStorage(() => (d, t) => progress.push(`${d}/${t}`))
    expect(res).toMatchObject({ kv: 3, images: 2, imageBytes: 500, assets: 1, assetBytes: 50 })
    expect(progress.at(-1)).toBe('4/4')
    expect(s.safeStorage.getItem('pe:doc:t_a')).toBe('{"meta":{"title":"芙莉莲 ✨"}}')
    expect(s.safeStorage.getItem('pe:nai')).toBe('{"state":{"token":"pst"}}')
    expect(Object.keys(await serverKv()).sort()).toEqual(['pe:doc:t_a', 'pe:library', 'pe:tabs'])
    expect((await s.imageStore.list()).map((x) => x.id).sort()).toEqual(['img_1', 'img_2'])
    expect(((await s.assetStore.get('tpl-img:k1')) as Blob).size).toBe(50)
    for (const [k, v] of before) expect(ls.getItem(k)).toBe(v)
    expect(idb.has('gen:t_a:img_1') && idb.has('tpl-img:k1')).toBe(true)
    expect(JSON.parse(ls.getItem('pe:migrated')!)).toMatchObject({ images: 2 })
    requests = []
    const { s: s2 } = await openPage()
    expect(await s2.startStorage()).toBeNull()
    expect(requests.some((r) => r.url.includes('/migrate/'))).toBe(false)
  })

  it('搬到一半失败：库还是空的、浏览器里的没动；下次从头来能成。搬过的浏览器（pe:migrated）换了空库也不再搬', async () => {
    oldData()
    let n = 0
    failWhen = (_m, url) => url.includes('/image') && url.includes('/migrate/') && ++n === 2
    const { s } = await openPage()
    await expect(s.startStorage()).rejects.toThrow()
    expect((await app.inject({ method: 'GET', url: '/api/bootstrap', headers: { host: '127.0.0.1' } })).json().empty).toBe(true)
    failWhen = () => false
    const { s: s2 } = await openPage()
    expect(await s2.startStorage()).toMatchObject({ images: 2 })
    const id = (await app.inject({ method: 'GET', url: '/api/bootstrap', headers: { host: '127.0.0.1' } })).json().libraryId
    await app.inject({ method: 'POST', url: '/api/library', headers: { host: '127.0.0.1', 'x-pe-library': id }, payload: { dir: path.join(root, '空库') } })
    const { s: s3 } = await openPage()
    expect(await s3.startStorage()).toBeNull()
    expect(s3.safeStorage.getItem('pe:tabs')).toBeNull()
  })
})

describe('桌面程序：NAI token 用系统加密存', () => {
  function fakeDesktop(initial = '', fail = false) {
    const box = { token: initial, sets: [] as string[] }
    const peApp = {
      setTheme() {},
      pickFolder: async () => null,
      token: {
        get: async () => (fail ? Promise.reject(new Error('系统加密不可用')) : box.token),
        set: async (t: string) => {
          if (fail) throw new Error('系统加密不可用')
          box.sets.push(t)
          box.token = t
        },
      },
    }
    return { box, peApp }
  }
  const nai = (state: object) => JSON.stringify({ state, version: 1 })

  it('localStorage 里的明文搬进加密存储、从 localStorage 删掉；读时拼回去，写时拆出来', async () => {
    ls.setItem('pe:nai', nai({ token: 'pst-old', stream: false }))
    const d = fakeDesktop()
    const { s } = await openPage(d.peApp)
    await s.startStorage()
    expect(d.box.token).toBe('pst-old')
    expect(JSON.parse(ls.getItem('pe:nai')!)).toEqual({ state: { token: '', stream: false }, version: 1 })
    expect(JSON.parse(s.safeStorage.getItem('pe:nai')!)).toEqual({ state: { token: 'pst-old', stream: false }, version: 1 })
    s.safeStorage.setItem('pe:nai', nai({ token: 'pst-new', stream: true }))
    await wait(0)
    expect(d.box.sets).toEqual(['pst-old', 'pst-new'])
    expect(ls.getItem('pe:nai')).not.toContain('pst-')
    s.safeStorage.setItem('pe:nai', nai({ token: 'pst-new', stream: false }))
    await wait(0)
    expect(d.box.sets).toHaveLength(2)
    s.safeStorage.setItem('pe:nai', nai({ token: '', stream: false }))
    await wait(0)
    expect(d.box.token).toBe('')
    expect(requests.some((r) => r.method === 'PUT')).toBe(false)
  })

  it('下次打开：加密的那份拼回去；localStorage 被清过也读得出 token（别的设置回默认）', async () => {
    const d = fakeDesktop('pst-kept')
    ls.setItem('pe:nai', nai({ token: '', stream: false }))
    const { s } = await openPage(d.peApp)
    await s.startStorage()
    expect(JSON.parse(s.safeStorage.getItem('pe:nai')!).state).toEqual({ token: 'pst-kept', stream: false })
    ls.clear()
    const { s: s2 } = await openPage(d.peApp)
    await s2.startStorage()
    expect(JSON.parse(s2.safeStorage.getItem('pe:nai')!)).toEqual({ state: { token: 'pst-kept' } })
    expect(d.box.sets).toEqual([])
  })

  it('系统加密不可用：旧的明文原样留着、读得出；新填的只留在内存，不写进 localStorage', async () => {
    ls.setItem('pe:nai', nai({ token: 'pst-plain' }))
    const { s } = await openPage(fakeDesktop('', true).peApp)
    await s.startStorage()
    expect(s.safeStorage.getItem('pe:nai')).toBe(nai({ token: 'pst-plain' }))
    s.safeStorage.setItem('pe:nai', nai({ token: 'pst-2' }))
    expect(s.safeStorage.getItem('pe:nai')).toBe(nai({ token: 'pst-2' }))
    expect(ls.getItem('pe:nai')).toBe(nai({ token: 'pst-plain' }))
  })
})
