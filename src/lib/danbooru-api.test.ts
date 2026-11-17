import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createLimiter, isAbort, type RequestError } from './danbooru-api'

const ok = (body: unknown = {}) => ({ ok: true, status: 200, json: async () => body }) as Response
const fail = (status: number) => ({ ok: false, status, json: async () => ({}) }) as Response
const flush = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve()
}

describe('Danbooru 请求的令牌桶', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('容量 20：前 20 个马上发，第 21 个等补上一个令牌（约 1 秒）', async () => {
    const calls: string[] = []
    const l = createLimiter({ fetch: async (u) => (calls.push(u), ok()) })
    for (let i = 0; i < 22; i++) void l.request(`/a/${i}`)
    for (let i = 0; i < 20; i++) await flush()
    expect(calls).toHaveLength(20)
    await vi.advanceTimersByTimeAsync(1000)
    await flush()
    expect(calls).toHaveLength(21)
    await vi.advanceTimersByTimeAsync(1000)
    await flush()
    expect(calls).toHaveLength(22)
  })

  it('同时最多 3 个', async () => {
    const pending: ((r: Response) => void)[] = []
    const l = createLimiter({ fetch: () => new Promise((r) => pending.push(r)) })
    for (let i = 0; i < 6; i++) void l.request(`/b/${i}`)
    await flush()
    expect(pending).toHaveLength(3)
    pending[0](ok())
    await flush()
    expect(pending).toHaveLength(4)
  })

  it('还没发出去就不要了（abort）：出队、不发，promise 是 AbortError', async () => {
    const calls: string[] = []
    const l = createLimiter({ capacity: 1, fetch: async (u) => (calls.push(u), ok()) })
    void l.request('/c/0')
    const ac = new AbortController()
    const p = l.request('/c/1', { signal: ac.signal })
    ac.abort()
    await expect(p).rejects.toSatisfy(isAbort)
    await vi.advanceTimersByTimeAsync(3000)
    expect(calls).toEqual(['/c/0'])
    expect(l.stats().queued).toBe(0)
  })

  it('同一个地址只发一次；一个不要了、另一个还要，照样发', async () => {
    const calls: string[] = []
    const l = createLimiter({ capacity: 1, fetch: async (u) => (calls.push(u), ok({ n: 1 })) })
    void l.request('/d/0')
    const ac = new AbortController()
    const a = l.request('/d/1', { signal: ac.signal })
    const b = l.request('/d/1')
    ac.abort()
    await vi.advanceTimersByTimeAsync(1000)
    await expect(b).resolves.toEqual({ n: 1 })
    await expect(a).resolves.toEqual({ n: 1 })
    expect(calls.filter((c) => c === '/d/1')).toHaveLength(1)
  })

  it('优先级小的先发（详情插在卡片前面）', async () => {
    const calls: string[] = []
    const l = createLimiter({ capacity: 1, fetch: async (u) => (calls.push(u), ok()) })
    void l.request('/e/first')
    void l.request('/e/card', { priority: 1 })
    void l.request('/e/detail', { priority: 0 })
    await vi.advanceTimersByTimeAsync(2100)
    expect(calls).toEqual(['/e/first', '/e/detail', '/e/card'])
  })

  it('429：整个队列停 2 秒再重发，成功后照常', async () => {
    const calls: [string, number][] = []
    let first = true
    const l = createLimiter({
      fetch: async (u) => {
        calls.push([u, Date.now()])
        if (u === '/f/0' && first) return (first = false), fail(429)
        return ok()
      },
    })
    const p = l.request('/f/0')
    await flush()
    const t0 = Date.now()
    void l.request('/f/1')
    await flush()
    expect(calls.map((c) => c[0])).toEqual(['/f/0'])
    await vi.advanceTimersByTimeAsync(2000)
    await expect(p).resolves.toEqual({})
    expect(calls.map((c) => c[0]).sort()).toEqual(['/f/0', '/f/0', '/f/1'])
    expect(calls[1][1] - t0).toBeGreaterThanOrEqual(1999)
  })

  const hanging = (calls: string[], hang: (u: string) => boolean) => (u: string, { signal }: { signal: AbortSignal }) => {
    calls.push(u)
    if (!hang(u)) return Promise.resolve(ok({ u }))
    return new Promise<Response>((_, reject) => signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))))
  }

  it('挂住不回的请求 15 秒算超时、让出位置，隔一会儿重试', async () => {
    const calls: string[] = []
    let stalled = true
    const l = createLimiter({ fetch: hanging(calls, () => stalled) })
    const ps = [0, 1, 2, 3].map((i) => l.request(`/h/${i}`))
    await flush()
    expect(calls).toEqual(['/h/0', '/h/1', '/h/2'])
    stalled = false
    await vi.advanceTimersByTimeAsync(15_000)
    await expect(ps[3]).resolves.toEqual({ u: '/h/3' })
    await vi.advanceTimersByTimeAsync(2000)
    await expect(Promise.all(ps.slice(0, 3))).resolves.toEqual([{ u: '/h/0' }, { u: '/h/1' }, { u: '/h/2' }])
  })

  it('发出去了的没人要了：再等 3 秒还是没人要就掐掉，让出位置；这 3 秒里又要了就接着等', async () => {
    const calls: string[] = []
    const l = createLimiter({ fetch: hanging(calls, (u) => u.startsWith('/i/old')) })
    const acs = [0, 1, 2].map(() => new AbortController())
    const old = acs.map((ac, i) => l.request(`/i/old${i}`, { signal: ac.signal }).then(() => 'ok', (e: unknown) => (isAbort(e) ? 'abort' : e)))
    const fresh = l.request('/i/new')
    await flush()
    expect(calls).toHaveLength(3)
    acs.forEach((ac) => ac.abort())
    const again = l.request('/i/old2')
    await vi.advanceTimersByTimeAsync(2900)
    expect(calls).not.toContain('/i/new')
    await vi.advanceTimersByTimeAsync(200)
    await expect(fresh).resolves.toEqual({ u: '/i/new' })
    expect(await old[0]).toBe('abort')
    expect(await old[1]).toBe('abort')
    expect(calls.filter((c) => c === '/i/old0')).toHaveLength(1)
    expect(l.stats().running).toBe(1)
    void again.catch(() => {})
  })

  it('5xx 重试 4 次还不行就报错；404 不重试', async () => {
    const calls: string[] = []
    const l = createLimiter({ fetch: async (u) => (calls.push(u), fail(u.includes('404') ? 404 : 502)) })
    const a = l.request('/g/502')
    const b = l.request('/g/404')
    const ea = a.then(() => null, (e: RequestError) => e)
    const eb = b.then(() => null, (e: RequestError) => e)
    await vi.advanceTimersByTimeAsync(60_000)
    expect((await ea)?.status).toBe(502)
    expect((await eb)?.status).toBe(404)
    expect(calls.filter((c) => c === '/g/502')).toHaveLength(5)
    expect(calls.filter((c) => c === '/g/404')).toHaveLength(1)
  })
})
