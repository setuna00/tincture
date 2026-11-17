import { assetStore } from '@/store/storage'
import { dedupePosts, fromTag, packPosts, pickSiteUrls, POST_FIELDS, relatedFromApi, toTag, type ApiPost, type PackedPost, type RatingMode, type Related } from './danbooru-core'

const API = 'https://danbooru.donmai.us'

export interface LimiterOptions {
  capacity?: number
  perSecond?: number
  concurrent?: number
  timeout?: number
  /** Delay aborts so React StrictMode remounts can reuse the in-flight request. */
  dropAfter?: number
  fetch?: (url: string, init: { signal: AbortSignal }) => Promise<Response>
  now?: () => number
}

interface Job {
  url: string
  priority: number
  seq: number
  refs: number
  started: boolean
  attempts: number
  notBefore: number
  abort?: () => void
  dropTimer?: ReturnType<typeof setTimeout>
  promise: Promise<unknown>
  resolve: (v: unknown) => void
  reject: (e: unknown) => void
}

export class RequestError extends Error {
  status?: number
  constructor(message: string, status?: number) {
    super(message)
    this.status = status
  }
}
export const isAbort = (e: unknown) => e instanceof DOMException && e.name === 'AbortError'
const aborted = () => new DOMException('不要了', 'AbortError')

/** Wall-clock adjustments can corrupt token refill and pause durations; use monotonic time. */
export function createLimiter({
  capacity = 20,
  perSecond = 1,
  concurrent = 3,
  timeout = 15_000,
  dropAfter = 3000,
  fetch: doFetch = (u, init) => fetch(u, init),
  now = () => performance.now(),
}: LimiterOptions = {}) {
  let tokens = capacity
  let last = now()
  let running = 0
  let pausedUntil = 0
  let backoff = 0
  let seq = 0
  let timer: ReturnType<typeof setTimeout> | null = null
  const jobs = new Map<string, Job>()
  const queue: Job[] = []

  const arm = (ms: number) => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(pump, Math.max(1, Math.ceil(ms)))
  }
  function pump() {
    timer = null
    const t = now()
    tokens = Math.min(capacity, tokens + ((t - last) / 1000) * perSecond)
    last = t
    while (running < concurrent && queue.length) {
      if (t < pausedUntil) return arm(pausedUntil - t)
      if (tokens < 1) return arm(((1 - tokens) * 1000) / perSecond)
      const ready = queue.filter((j) => j.notBefore <= t)
      if (!ready.length) return arm(Math.min(...queue.map((j) => j.notBefore)) - t)
      const job = ready.reduce((a, b) => (b.priority < a.priority || (b.priority === a.priority && b.seq < a.seq) ? b : a))
      queue.splice(queue.indexOf(job), 1)
      tokens -= 1
      running++
      job.started = true
      void run(job)
    }
  }
  async function run(job: Job) {
    const ac = new AbortController()
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      ac.abort()
    }, timeout)
    job.abort = () => ac.abort()
    let status: number | undefined
    let body: unknown
    try {
      const res = await doFetch(job.url, { signal: ac.signal })
      status = res.status
      if (res.ok) body = await res.json()
    } catch {
      status = undefined
    }
    clearTimeout(timer)
    job.abort = undefined
    running--
    const ok = status !== undefined && status >= 200 && status < 300
    if (!ok && ac.signal.aborted && !timedOut) {
      drop(job)
    } else if (ok) {
      backoff = 0
      jobs.delete(job.url)
      job.resolve(body)
    } else if (status === undefined || status === 429 || status >= 500) {
      job.attempts++
      if (status === 429) {
        backoff = backoff ? Math.min(backoff * 2, 60_000) : 2000
        pausedUntil = now() + backoff
      } else job.notBefore = now() + 1000 * 2 ** job.attempts
      if (job.refs <= 0) drop(job)
      else if (job.attempts > 4) {
        jobs.delete(job.url)
        job.reject(new RequestError(`Danbooru 请求失败（${status ?? (timedOut ? '超时' : '网络错误')}）：${job.url}`, status))
      } else {
        job.started = false
        queue.push(job)
      }
    } else {
      jobs.delete(job.url)
      job.reject(new RequestError(`Danbooru 请求失败（${status}）：${job.url}`, status))
    }
    pump()
  }
  function drop(job: Job) {
    if (jobs.get(job.url) === job) jobs.delete(job.url)
    job.reject(aborted())
  }
  function release(job: Job) {
    job.refs--
    if (job.refs > 0 || jobs.get(job.url) !== job) return
    if (job.started) {
      job.dropTimer ??= setTimeout(() => {
        job.dropTimer = undefined
        if (job.refs <= 0) job.abort?.()
      }, dropAfter)
      return
    }
    queue.splice(queue.indexOf(job), 1)
    drop(job)
  }

  return {
    request<T>(url: string, { priority = 1, signal }: { priority?: number; signal?: AbortSignal } = {}): Promise<T> {
      if (signal?.aborted) return Promise.reject(aborted())
      let job = jobs.get(url)
      if (job) {
        job.refs++
        job.priority = Math.min(job.priority, priority)
        if (job.dropTimer) {
          clearTimeout(job.dropTimer)
          job.dropTimer = undefined
        }
      } else {
        let resolve!: (v: unknown) => void
        let reject!: (e: unknown) => void
        const promise = new Promise((a, b) => ((resolve = a), (reject = b)))
        job = { url, priority, seq: seq++, refs: 1, started: false, attempts: 0, notBefore: 0, promise, resolve, reject }
        jobs.set(url, job)
        queue.push(job)
        pump()
      }
      const j = job
      signal?.addEventListener('abort', () => release(j), { once: true })
      return j.promise as Promise<T>
    },
    stats: () => ({ queued: queue.length, running, tokens }),
  }
}

export const limiter = createLimiter()

const DAY = 86_400_000
const mem = new Map<string, unknown>()
export async function cached<T>(key: string, days: number, load: () => Promise<T>): Promise<T> {
  if (mem.has(key)) return mem.get(key) as T
  let old: { at: number; v: T } | undefined
  try {
    old = await assetStore.get<{ at: number; v: T }>(`dan:${key}`)
    if (old && Date.now() - old.at < days * DAY) {
      mem.set(key, old.v)
      return old.v
    }
  } catch {
  }
  let v: T
  try {
    v = await load()
  } catch (e) {
    if (!old || isAbort(e)) throw e
    mem.set(key, old.v)
    return old.v
  }
  mem.set(key, v)
  assetStore.set(`dan:${key}`, { at: Date.now(), v }).catch(() => {})
  return v
}
export const peek = <T>(key: string) => mem.get(key) as T | undefined

const ARTIST_KEY = /^dan:(?:posts:(?:sfw|all):|related:(?:sfw|all):|urls:|nsfw:|alias:)(.+)$/
export const artistOfKey = (k: string) => ARTIST_KEY.exec(k)?.[1]

let pruned = false
export async function pruneCache(keep: (name: string) => boolean = () => false) {
  if (pruned) return
  pruned = true
  try {
    const keys = await assetStore.keys('dan:')
    for (const k of keys) {
      const hit = await assetStore.get<{ at: number }>(k)
      const days = k.startsWith('dan:posts:') || k.startsWith('dan:topic:') || k.startsWith('dan:alias:') ? 30 : 90
      if (hit && Date.now() - hit.at < days * DAY) continue
      const name = artistOfKey(k)
      if (hit && name !== undefined && keep(name)) continue
      await assetStore.del(k)
    }
  } catch {
  }
}

const url = (path: string, params: Record<string, string | number>) =>
  `${API}${path}?${new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)])).toString()}`
type Opts = { priority?: number; signal?: AbortSignal }

export const postsKey = (name: string, mode: RatingMode) => `posts:${mode}:${name}`
export function fetchArtistPosts(name: string, mode: RatingMode, opts: Opts): Promise<PackedPost[]> {
  return cached(postsKey(name, mode), 30, async () => {
    const tags = `${toTag(name)}${mode === 'sfw' ? ' rating:g,s' : ''} order:score`
    const list = await limiter.request<ApiPost[]>(url('/posts.json', { tags, limit: 40, only: POST_FIELDS }), opts)
    const packed = packPosts(list)
    return dedupePosts(packed.map((p) => ({ id: p[0], parent: p[7] || undefined, p }))).map((x) => x.p)
  })
}

export function fetchArtistUrls(name: string, opts: Opts): Promise<string[]> {
  return cached(`urls:${name}`, 90, async () => {
    const [a] = await limiter.request<{ urls?: { url: string; is_active: boolean }[] }[]>(url('/artists.json', { 'search[name]': toTag(name), only: 'urls[url,is_active]' }), opts)
    return pickSiteUrls((a?.urls ?? []).filter((u) => u.is_active).map((u) => u.url))
  })
}

export function fetchArtistRelated(name: string, mode: RatingMode, opts: Opts): Promise<Related[]> {
  return cached(`related:${mode}:${name}`, 90, async () => {
    const query = `${toTag(name)}${mode === 'sfw' ? ' rating:g,s' : ''}`
    const lists = await Promise.all(
      ['Frequency', 'Cosine'].map((order) =>
        limiter.request<{ related_tags: { tag: { name: string; post_count: number }; frequency: number }[] }>(
          url('/related_tag.json', { 'search[query]': query, 'search[category]': 'general', 'search[order]': order, limit: 100 }),
          opts,
        ),
      ),
    )
    return relatedFromApi(lists)
  })
}

export function fetchNsfwCount(name: string, opts: Opts): Promise<number> {
  return cached(`nsfw:${name}`, 90, async () => (await limiter.request<{ counts: { posts: number } }>(url('/counts/posts.json', { tags: `${toTag(name)} rating:q,e` }), opts)).counts.posts)
}

const TOPIC_MIN_SHARE = 0.08
export function fetchTopicArtists(topic: string, mode: RatingMode, opts: Opts): Promise<string[]> {
  return cached(`topic:${mode}:${topic}`, 30, async () => {
    const ask = (query: string) =>
      limiter.request<{ related_tags: { tag: { name: string }; overlap_coefficient: number }[] }>(
        url('/related_tag.json', { 'search[query]': query, 'search[category]': 'artist', 'search[order]': 'Cosine', limit: 500 }),
        opts,
      )
    let r = await ask(`${toTag(topic)}${mode === 'sfw' ? ' rating:g,s' : ''}`)
    // Danbooru can time out on common topics with rating filters; retry without them, then filter displayed images.
    if (!r.related_tags.length && mode === 'sfw') r = await ask(toTag(topic))
    return r.related_tags.filter((x) => x.overlap_coefficient >= TOPIC_MIN_SHARE).map((x) => fromTag(x.tag.name))
  })
}

export function fetchAlias(name: string, opts: Opts): Promise<string | null> {
  return cached(`alias:${name}`, 30, async () => {
    const [a] = await limiter.request<{ consequent_name: string }[]>(url('/tag_aliases.json', { 'search[antecedent_name]': toTag(name), 'search[status]': 'active', only: 'consequent_name' }), opts)
    return a ? fromTag(a.consequent_name) : null
  })
}
