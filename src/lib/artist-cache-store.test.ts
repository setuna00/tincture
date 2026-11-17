import { beforeEach, describe, expect, it, vi } from 'vitest'

const db = new Map<string, unknown>()
vi.mock('@/store/storage', () => ({
  assetStore: {
    get: async (k: string) => db.get(k),
    getMany: async (ks: string[]) => ks.map((k) => db.get(k)),
    set: async (k: string, v: unknown) => void db.set(k, v),
    del: async (k: string) => void db.delete(k),
    keys: async (prefix: string) => [...db.keys()].filter((k) => k.startsWith(prefix)),
    update: async (k: string, fn: (old: unknown) => unknown) => void db.set(k, fn(db.get(k))),
  },
}))

const DAY = 86_400_000
const fresh = () => import('./danbooru-api')

beforeEach(() => {
  db.clear()
  vi.resetModules()
})

describe('cached()：过期了、请求又失败就先用旧的', () => {
  it('没过期：不发请求', async () => {
    const { cached } = await fresh()
    db.set('dan:k1', { at: Date.now() - DAY, v: 'old' })
    const load = vi.fn(async () => 'new')
    expect(await cached('k1', 30, load)).toBe('old')
    expect(load).not.toHaveBeenCalled()
  })

  it('过期了、请求成功：用新的、存下来', async () => {
    const { cached } = await fresh()
    db.set('dan:k2', { at: Date.now() - 40 * DAY, v: 'old' })
    expect(await cached('k2', 30, async () => 'new')).toBe('new')
    expect((db.get('dan:k2') as { v: string }).v).toBe('new')
  })

  it('过期了、请求失败（连不上）：用旧的，这次打开期间不再问', async () => {
    const { cached } = await fresh()
    db.set('dan:k3', { at: Date.now() - 40 * DAY, v: 'old' })
    expect(await cached('k3', 30, async () => Promise.reject(new Error('网络错误')))).toBe('old')
    const load = vi.fn(async () => 'new')
    expect(await cached('k3', 30, load)).toBe('old')
    expect(load).not.toHaveBeenCalled()
    expect((db.get('dan:k3') as { at: number }).at).toBeLessThan(Date.now() - 30 * DAY)
  })

  it('没有旧的：照旧报错；不要了（abort）：照旧是 AbortError', async () => {
    const { cached, isAbort } = await fresh()
    await expect(cached('k4', 30, async () => Promise.reject(new Error('网络错误')))).rejects.toThrow('网络错误')
    db.set('dan:k5', { at: Date.now() - 40 * DAY, v: 'old' })
    const e = await cached('k5', 30, async () => Promise.reject(new DOMException('不要了', 'AbortError'))).catch((x) => x)
    expect(isAbort(e)).toBe(true)
  })
})

describe('pruneCache：过期的删掉，要留的画师留着旧的', () => {
  it('留 keep 里的画师；别的过期的删；没过期的不动；按题材找的照旧删', async () => {
    const { pruneCache, artistOfKey } = await fresh()
    const old = { at: Date.now() - 100 * DAY, v: 1 }
    const now = { at: Date.now(), v: 1 }
    db.set('dan:posts:sfw:kept one', old)
    db.set('dan:related:all:kept one', old)
    db.set('dan:urls:kept one', old)
    db.set('dan:posts:sfw:gone one', old)
    db.set('dan:nsfw:gone one', old)
    db.set('dan:posts:all:fresh one', now)
    db.set('dan:topic:sfw:mecha', old)
    expect(artistOfKey('dan:posts:sfw:a:b')).toBe('a:b')
    expect(artistOfKey('dan:topic:sfw:mecha')).toBeUndefined()
    await pruneCache((n) => n === 'kept one' || n === 'mecha')
    expect([...db.keys()].sort()).toEqual(['dan:posts:all:fresh one', 'dan:posts:sfw:kept one', 'dan:related:all:kept one', 'dan:urls:kept one'])
  })
})

describe('pruneImages：图的清理', () => {
  const blob = (n: number) => new Blob([new Uint8Array(n)], { type: 'image/webp' })

  it('收藏 / 合集的不清；其余超过上限挤掉最久没看过的；图没了的索引去掉；索引里没有的图补上、算刚看过', async () => {
    const { pruneImages } = await import('./artist-image-cache')
    db.set('dan-img:fav:360', blob(50))
    db.set('dan-img:old:720', blob(40))
    db.set('dan-img:new:720', blob(30))
    db.set('dan-img:orphan:360', blob(20))
    db.set('dan-img-index', {
      'fav:360': { a: ['fav artist'], s: 50, t: 1 },
      'old:720': { a: ['someone'], s: 40, t: 2 },
      'new:720': { a: ['other'], s: 30, t: 3 },
      'gone:720': { a: ['someone'], s: 99, t: 4 },
    })
    const left = await pruneImages((n) => n === 'fav artist', 60)
    expect([...db.keys()].filter((k) => k.startsWith('dan-img:')).sort()).toEqual(['dan-img:fav:360', 'dan-img:new:720', 'dan-img:orphan:360'])
    const index = db.get('dan-img-index') as Record<string, { a: string[]; s: number; t: number }>
    expect(Object.keys(index).sort()).toEqual(['fav:360', 'new:720', 'orphan:360'])
    expect(index['orphan:360']).toMatchObject({ a: [], s: 20 })
    expect(index['orphan:360'].t).toBeGreaterThan(3)
    expect([...left].sort()).toEqual(['fav artist', 'other'])
  })
})
