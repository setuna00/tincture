// Journal unacknowledged unload writes for replay because keepalive requests are size-limited and delivery is not guaranteed.
import { del, get, getMany, keys, set, update } from 'idb-keyval'
import { toast } from 'sonner'
import { desktop } from '@/lib/desktop'
import type { GenLabel } from '@/lib/nai-tools'
import type { Doc } from '@/types'

export const BROWSER_ONLY = import.meta.env.VITE_BROWSER_ONLY === '1'

const SERVER_KEYS = new Set(['pe:tabs', 'pe:library', 'pe:lists', 'pe:gacha', 'pe:gallery', 'pe:prefs', 'pe:tokens'])
export const isLibraryKey = (key: string) => SERVER_KEYS.has(key) || key.startsWith('pe:doc:')
export const isLibraryAsset = (key: string) => key.startsWith('tpl-img:') || key.startsWith('artist-img:') || key.startsWith('ref-img:') || key.startsWith('vibe-enc:')
const onServer = (key: string) => !BROWSER_ONLY && isLibraryKey(key)

// Privacy modes and preview sandboxes may deny localStorage; retain an in-memory fallback.

const mem = new Map<string, string>()
const unstored = new Map<string, string>()
const FULL_TOAST = 'storage-full'

const isQuotaError = (e: unknown) => e instanceof DOMException && (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED')

function storeFailed(key: string, value: string) {
  unstored.set(key, value)
  if (toast.getToasts().some((t) => t.id === FULL_TOAST)) return
  toast.error('浏览器存储空间已满，刷新后更改将丢失', { id: FULL_TOAST, description: '请删除不用的我的文档或模板', duration: Infinity })
}

function retryUnstored(key: string) {
  if (!unstored.size) return
  unstored.delete(key)
  for (const [k, v] of unstored) {
    try {
      localStorage.setItem(k, v)
      unstored.delete(k)
    } catch {
      return
    }
  }
  toast.dismiss(FULL_TOAST)
}

const local = {
  getItem(key: string): string | null {
    const pending = unstored.get(key)
    if (pending !== undefined) return pending
    try {
      return localStorage.getItem(key)
    } catch {
      return mem.get(key) ?? null
    }
  },
  setItem(key: string, value: string) {
    try {
      localStorage.setItem(key, value)
    } catch (e) {
      if (isQuotaError(e)) storeFailed(key, value)
      else mem.set(key, value)
      return
    }
    retryUnstored(key)
  },
  removeItem(key: string) {
    try {
      localStorage.removeItem(key)
    } catch {
      mem.delete(key)
      return
    }
    retryUnstored(key)
  },
}

/** Bind writes to this library ID so stale pages cannot write into a switched or reset library. */
let libraryId = ''
/** Do not send writes before storage startup; a page waiting for the app lock must not modify persisted data. */
let started = false
let stale = false
let switching = false

class Stale extends Error {}
class Rejected extends Error {}

async function api(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers)
  if (init.method && init.method !== 'GET') headers.set('x-pe-library', libraryId)
  const r = await fetch(`/api${path}`, { ...init, headers })
  if (r.ok) return r
  const msg = await r.text().catch(() => '')
  if (r.status === 409) throw new Stale(msg)
  if (r.status >= 400 && r.status < 500) throw new Rejected(`${r.status} ${msg}`)
  throw new Error(`${r.status} ${msg}`)
}

const FAIL_TOAST = 'library-write-failed'
let retryTimer: ReturnType<typeof setTimeout> | null = null
let retryDelay = 2000
let kvFailing = false
let opsFailing = false

function onWriteError(e: unknown) {
  if (e instanceof Stale) return goStale()
  console.warn('无法写入图库文件夹', e)
  if (!toast.getToasts().some((t) => t.id === FAIL_TOAST))
    toast.error('无法写入图库文件夹', { id: FAIL_TOAST, description: '更改尚未保存，将自动重试', duration: Infinity })
  if (retryTimer) return
  retryTimer = setTimeout(() => {
    retryTimer = null
    void flush()
    void runOps()
  }, retryDelay)
  retryDelay = Math.min(retryDelay * 2, 30_000)
}

function onWriteOk() {
  if (kvFailing || opsFailing) return
  retryDelay = 2000
  toast.dismiss(FAIL_TOAST)
}

function goStale() {
  if (stale) return
  stale = true
  pending.clear()
  ops.length = 0
  if (!switching) toast.error('图库文件夹已更换', { id: 'library-stale', description: '请刷新页面', duration: Infinity })
}

const cache = new Map<string, string>()
/** null is a deletion tombstone, not an absent pending value. */
const pending = new Map<string, string | null>()
let inflight: Map<string, string | null> | null = null
let debounce: ReturnType<typeof setTimeout> | null = null
let maxWait: ReturnType<typeof setTimeout> | null = null
const JOURNAL = 'pe:unsent'

const toBody = (batch: Map<string, string | null>) => {
  const body: { set: Record<string, string>; del: string[] } = { set: {}, del: [] }
  for (const [k, v] of batch) {
    if (v === null) body.del.push(k)
    else body.set[k] = v
  }
  return JSON.stringify(body)
}

function schedule() {
  if (!started || stale) return
  if (unloading) return void queueMicrotask(sendOnUnload)
  if (debounce) clearTimeout(debounce)
  debounce = setTimeout(() => void flush(), 300)
  maxWait ??= setTimeout(() => void flush(), 2000)
}

async function flush() {
  if (debounce) clearTimeout(debounce)
  if (maxWait) clearTimeout(maxWait)
  debounce = maxWait = null
  if (!started || stale || unloading || inflight || !pending.size) return
  const batch = new Map(pending)
  pending.clear()
  inflight = batch
  try {
    await api('/kv', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: toBody(batch) })
    inflight = null
    kvFailing = false
    if (pending.size) schedule()
    else clearJournal()
    onWriteOk()
  } catch (e) {
    inflight = null
    // Retry failed values only when no newer value is pending, so retries cannot overwrite subsequent edits.
    for (const [k, v] of batch) if (!pending.has(k)) pending.set(k, v)
    if (!(e instanceof Stale)) kvFailing = true
    onWriteError(e)
  }
}

// Keep desktop secrets in OS-encrypted app storage; localStorage retains only non-secret settings.
type PersistedState = Record<string, unknown>
interface Secret {
  store(): { get(): Promise<string>; set(v: string): Promise<void> } | undefined
  take(state: PersistedState): string | null
  put(state: PersistedState, secret: string): void
  label: string
  value: string | null
  volatile?: string
}

const objs = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is PersistedState => !!x && typeof x === 'object') : [])

const SECRETS = new Map<string, Secret>([
  [
    'pe:nai',
    {
      store: () => desktop?.token,
      take(state) {
        const token = state.token
        if (typeof token !== 'string') return null
        state.token = ''
        return token
      },
      put: (state, secret) => void (state.token = secret),
      label: 'NAI 令牌',
      value: null,
    },
  ],
  [
    'pe:ai',
    {
      store: () => desktop?.aiKeys,
      take(state) {
        if (!Array.isArray(state.services)) return null
        const keys: Record<string, string> = {}
        for (const s of objs(state.services)) {
          if (typeof s.key === 'string' && s.key && typeof s.id === 'string') keys[s.id] = s.key
          s.key = ''
        }
        return Object.keys(keys).length ? JSON.stringify(keys) : ''
      },
      put(state, secret) {
        let keys: Record<string, unknown> = {}
        try {
          keys = secret ? (JSON.parse(secret) as Record<string, unknown>) : {}
        } catch {
          keys = {}
        }
        for (const s of objs(state.services)) s.key = typeof keys[s.id as string] === 'string' ? keys[s.id as string] : ''
      },
      label: 'API Key',
      value: null,
    },
  ],
])

/** Remove plaintext secrets from localStorage only after encrypted storage accepts them. */
export async function startSecrets() {
  if (!desktop) return
  for (const [key, s] of SECRETS) {
    const store = s.store()
    if (s.value !== null) continue
    try {
      if (!store) throw new Error('Encrypted storage unavailable')
      let value = await store.get()
      const raw = local.getItem(key)
      const saved = raw ? (JSON.parse(raw) as { state?: PersistedState }) : null
      const plain = saved?.state ? s.take(saved.state) : null
      if (plain) {
        await store.set(plain)
        value = plain
        local.setItem(key, JSON.stringify(saved))
      }
      s.value = value
    } catch {
      secretFailed(key, s)
    }
  }
}

function secretFailed(key: string, s: Secret) {
  toast.error(`无法用系统加密保存 ${s.label}，仅在本次运行中保留`, { id: `secret-failed:${key}` })
}

function readSecret(key: string, s: Secret): string | null {
  if (desktop && s.volatile !== undefined) return s.volatile
  const raw = local.getItem(key)
  if (s.value === null) return raw
  try {
    const saved = (raw ? JSON.parse(raw) : { state: {} }) as { state: PersistedState }
    s.put(saved.state, s.value)
    return JSON.stringify(saved)
  } catch {
    return raw
  }
}

function writeSecret(key: string, s: Secret, value: string) {
  if (!desktop) return local.setItem(key, value)
  // Preserve the original entry for migration next launch without persisting subsequent edits in plaintext.
  if (s.value === null) {
    s.volatile = value
    secretFailed(key, s)
    return
  }
  try {
    const saved = JSON.parse(value) as { state?: PersistedState }
    const secret = saved.state ? s.take(saved.state) : null
    if (secret !== null) {
      if (secret !== s.value) {
        s.value = secret
        s.store()!.set(secret).catch(() => secretFailed(key, s))
      }
      value = JSON.stringify(saved)
    }
    local.setItem(key, value)
    s.volatile = undefined
  } catch {
    s.volatile = value
    secretFailed(key, s)
  }
}

export const notStored = (key: string) => (onServer(key) ? kvFailing && (pending.has(key) || !!inflight?.has(key)) : unstored.has(key))

export const safeStorage = {
  getItem(key: string): string | null {
    const secret = SECRETS.get(key)
    if (secret) return readSecret(key, secret)
    return onServer(key) ? (cache.get(key) ?? null) : local.getItem(key)
  },
  setItem(key: string, value: string) {
    const secret = SECRETS.get(key)
    if (secret) return writeSecret(key, secret, value)
    if (!onServer(key)) return local.setItem(key, value)
    if (cache.get(key) === value && !pending.has(key)) return
    cache.set(key, value)
    pending.set(key, value)
    schedule()
  },
  removeItem(key: string) {
    if (!onServer(key)) return local.removeItem(key)
    if (!cache.has(key) && !pending.has(key)) return
    cache.delete(key)
    pending.set(key, null)
    schedule()
  },
}

let unloading = false
/** Keep unload requests in the journal until acknowledged; sending them does not prove they reached disk. */
const unloadSent = new Map<string, string | null>()
let inflightResent = false

function sendOnUnload() {
  if (!started || stale) return
  const send = new Map<string, string | null>()
  // Normal in-flight requests can be aborted on unload, so include them in the keepalive retry.
  if (inflight && !inflightResent) {
    inflightResent = true
    for (const [k, v] of inflight) send.set(k, v)
  }
  for (const [k, v] of pending) send.set(k, v)
  for (const [k, v] of pending) unloadSent.set(k, v)
  pending.clear()
  const all = new Map([...(inflight ?? []), ...unloadSent])
  if (all.size) writeJournal(all)
  if (!send.size) return
  const body = toBody(send)
  // Keepalive requests share a 64 KiB budget; larger batches must rely on journal replay.
  if (body.length > 60_000) return
  void fetch('/api/kv', { method: 'PUT', keepalive: true, headers: { 'content-type': 'application/json', 'x-pe-library': libraryId }, body }).catch(() => {})
}

function writeJournal(batch: Map<string, string | null>) {
  try {
    localStorage.setItem(JOURNAL, JSON.stringify({ libraryId, batch: [...batch] }))
  } catch {
  }
}
function clearJournal() {
  try {
    localStorage.removeItem(JOURNAL)
  } catch {
  }
}
/** Replay only into the matching library so unacknowledged writes cannot contaminate a switched library. */
function replayJournal(): boolean {
  let j: { libraryId: string; batch: [string, string | null][] } | null = null
  try {
    j = JSON.parse(localStorage.getItem(JOURNAL) ?? 'null')
  } catch {
    j = null
  }
  if (!j) return false
  if (j.libraryId !== libraryId || !Array.isArray(j.batch)) {
    clearJournal()
    return false
  }
  for (const [k, v] of j.batch) {
    if (!isLibraryKey(k)) continue
    if (v === null) cache.delete(k)
    else cache.set(k, v)
    pending.set(k, v)
  }
  schedule()
  return true
}

if (typeof window !== 'undefined' && !BROWSER_ONLY) {
  // Other pagehide handlers can enqueue document writes after this handler; unloading writes must still be sent and journaled.
  window.addEventListener('pagehide', () => {
    unloading = true
    sendOnUnload()
  })
  // A back-forward cache restore resumes this page; requeue unload writes whose delivery was never acknowledged.
  window.addEventListener('pageshow', (e) => {
    if (!e.persisted || !unloading) return
    unloading = false
    inflightResent = false
    for (const [k, v] of unloadSent) if (!pending.has(k)) pending.set(k, v)
    unloadSent.clear()
    schedule()
  })
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') void flush()
  })
}

// Serialize image and asset writes; keep retryable failures at the queue head so later operations cannot overtake them.
type Op = () => Promise<void>
const ops: Op[] = []
let opsRunning = false

async function runOps() {
  if (opsRunning || stale) return
  opsRunning = true
  try {
    while (ops.length) {
      try {
        await ops[0]()
      } catch (e) {
        if (e instanceof Rejected) console.warn('图库文件夹拒绝了这次写入', e)
        else {
          if (!(e instanceof Stale)) opsFailing = true
          onWriteError(e)
          return
        }
      }
      ops.shift()
    }
    opsFailing = false
    onWriteOk()
  } finally {
    opsRunning = false
  }
}
function enqueue(op: Op) {
  if (!started) return
  ops.push(op)
  void runOps()
}

interface Bootstrap {
  libraryId: string
  dir: string
  empty: boolean
  kv: Record<string, string>
  imageTabs: string[]
}

export class BootError extends Error {
  kind: 'offline' | 'library' | 'locked'
  dir?: string
  constructor(kind: 'offline' | 'library' | 'locked', message: string, dir?: string) {
    super(message)
    this.kind = kind
    this.dir = dir
  }
}

let boot: Bootstrap | null = null

async function fetchBootstrap(): Promise<Bootstrap> {
  let r: Response
  try {
    r = await fetch('/api/bootstrap', { cache: 'no-store' })
  } catch (e) {
    throw new BootError('offline', String(e))
  }
  if (r.status === 503) {
    const j = (await r.json().catch(() => ({}))) as { message?: string; dir?: string; code?: string }
    throw new BootError(j.code === 'LIBRARY_LOCKED' ? 'locked' : 'library', j.message ?? '', j.dir)
  }
  if (!r.ok) throw new BootError('offline', `${r.status}`)
  return (await r.json()) as Bootstrap
}

function fill(b: Bootstrap) {
  boot = b
  libraryId = b.libraryId
  cache.clear()
  for (const [k, v] of Object.entries(b.kv)) cache.set(k, v)
}

export async function loadStorage() {
  if (BROWSER_ONLY) return
  fill(await fetchBootstrap())
}

export async function startStorage(onMigrate?: () => (done: number, total: number) => void) {
  if (BROWSER_ONLY) return null
  await startSecrets()
  fill(await fetchBootstrap())
  started = true
  if (replayJournal() || !boot!.empty) return null
  const { migrateFromBrowser } = await import('./migrate')
  const migrated = await migrateFromBrowser(libraryId, onMigrate)
  if (migrated) fill(await fetchBootstrap())
  return migrated
}

export const libraryDir = () => boot?.dir ?? ''

export async function changeLibraryDir(dir: string): Promise<{ dir: string } | { error: string }> {
  await flush()
  switching = true
  try {
    const r = await fetch('/api/library', { method: 'POST', headers: { 'content-type': 'application/json', 'x-pe-library': libraryId }, body: JSON.stringify({ dir }) })
    const j = (await r.json().catch(() => ({}))) as { dir?: string; message?: string }
    if (!r.ok || !j.dir) {
      switching = false
      return { error: j.message || '无法使用该文件夹' }
    }
    return { dir: j.dir }
  } catch {
    switching = false
    return { error: '无法连接本地服务' }
  }
}

export async function revealLibraryDir() {
  await api('/library/reveal', { method: 'POST' })
}

export const apiFetch = api

const localBlobs = new Map<string, Blob>()
const droppedAssets = new Set<string>()
const assetPath = (key: string) => `/assets/${encodeURIComponent(key)}`
const serverAsset = (key: string) => !BROWSER_ONLY && isLibraryAsset(key)

export const assetStore = {
  async get<T>(key: string): Promise<T | undefined> {
    if (!serverAsset(key)) return get<T>(key)
    const hit = localBlobs.get(`asset:${key}`)
    if (hit) return hit as T
    if (droppedAssets.has(key) || !started) return undefined
    try {
      return (await (await api(assetPath(key))).blob()) as T
    } catch (e) {
      if (e instanceof Rejected) return undefined
      throw e
    }
  },
  getMany: <T>(keys: string[]) => getMany<T>(keys),
  /** Read and update the cache index in one transaction so concurrent pages cannot overwrite each other's additions. */
  update: <T>(key: string, fn: (old: T | undefined) => T) => update<T>(key, fn),
  async set(key: string, value: unknown) {
    if (!serverAsset(key)) return set(key, value)
    if (!(value instanceof Blob)) throw new Error('配图只能存图片')
    localBlobs.set(`asset:${key}`, value)
    droppedAssets.delete(key)
    enqueue(async () => {
      await api(assetPath(key), { method: 'PUT', headers: { 'content-type': value.type || 'image/webp' }, body: value })
      if (localBlobs.get(`asset:${key}`) === value) localBlobs.delete(`asset:${key}`)
    })
  },
  async del(key: string) {
    if (!serverAsset(key)) return del(key)
    localBlobs.delete(`asset:${key}`)
    droppedAssets.add(key)
    enqueue(() => api(assetPath(key), { method: 'DELETE' }).then(() => {}))
  },
  async keys(prefix: string): Promise<string[]> {
    if (!serverAsset(prefix)) return (await keys()).filter((k): k is string => typeof k === 'string' && k.startsWith(prefix))
    const onDisk = started ? ((await (await api(`/assets?prefix=${encodeURIComponent(prefix)}`)).json()) as string[]) : []
    const mine = [...localBlobs.keys()].filter((k) => k.startsWith(`asset:${prefix}`)).map((k) => k.slice(6))
    return [...new Set([...onDisk, ...mine])].filter((k) => !droppedAssets.has(k))
  },
}

export interface GenImage {
  id: string
  /** This field stores document IDs; "imported" is the sentinel for images without an owning document. */
  tabId: string
  versionId?: string
  version?: number
  /** import is a local label for external images with no version; NAI action labels identify results attached to the source version. */
  label?: GenLabel | 'import'
  sourceId?: string
  batch: string
  index: number
  createdAt: number
  seed: number
  width: number
  height: number
  model: string
  mime: string
  size: number
  doc: Doc
  missing?: boolean
}

type IdbImage = Omit<GenImage, 'mime' | 'size'> & { blob: Blob }
const GEN = 'gen:'
const idbKey = (img: Pick<GenImage, 'tabId' | 'id'>) => `${GEN}${img.tabId}:${img.id}`
const fromIdb = ({ blob, ...rest }: IdbImage): GenImage => {
  localBlobs.set(rest.id, blob)
  return { ...rest, mime: blob.type || 'image/webp', size: blob.size }
}

/** Upload layout: [u32 big-endian record byte length][UTF-8 record JSON][u32 big-endian snapshot byte length][UTF-8 snapshot JSON][raw image]. */
export function framed(img: GenImage, blob: Blob): Blob {
  const { doc, version: _, ...meta } = img
  const enc = new TextEncoder()
  const part = (s: string) => {
    const b = enc.encode(s)
    const n = new Uint8Array(4)
    new DataView(n.buffer).setUint32(0, b.length)
    return [n, b]
  }
  return new Blob([...part(JSON.stringify(meta)), ...part(JSON.stringify(doc)), blob], { type: 'application/x-pe-image' })
}

const objectUrls = new Map<string, string>()
const droppedImages = new Set<string>()

export const imageStore = {
  async list(tabId?: string): Promise<GenImage[]> {
    if (BROWSER_ONLY) {
      const ks = (await keys()).filter((k): k is string => typeof k === 'string' && k.startsWith(tabId ? `${GEN}${tabId}:` : GEN))
      return (await getMany<IdbImage>(ks)).filter((x): x is IdbImage => !!x?.blob).map(fromIdb)
    }
    if (!started) return []
    const all = (await (await api(tabId ? `/images?tab=${encodeURIComponent(tabId)}` : '/images')).json()) as GenImage[]
    return droppedImages.size ? all.filter((x) => !droppedImages.has(x.id)) : all
  },
  async tabs(): Promise<Set<string>> {
    if (!BROWSER_ONLY) return new Set(boot?.imageTabs ?? [])
    return new Set((await keys()).filter((k): k is string => typeof k === 'string' && k.startsWith(GEN)).map((k) => k.slice(GEN.length).split(':')[0]))
  },
  async put(img: GenImage, blob: Blob) {
    localBlobs.set(img.id, blob)
    droppedImages.delete(img.id)
    if (BROWSER_ONLY) return set(idbKey(img), { ...img, mime: undefined, size: undefined, blob })
    enqueue(() => api('/images', { method: 'POST', headers: { 'content-type': 'application/x-pe-image' }, body: framed(img, blob) }).then(() => {}))
  },
  remove(img: GenImage) {
    droppedImages.add(img.id)
    if (BROWSER_ONLY) return void del(idbKey(img)).catch(() => {})
    enqueue(() => api(`/images/${img.id}`, { method: 'DELETE' }).then(() => {}))
  },
  restore(img: GenImage) {
    droppedImages.delete(img.id)
    if (BROWSER_ONLY) {
      const blob = localBlobs.get(img.id)
      if (blob) void set(idbKey(img), { ...img, mime: undefined, size: undefined, blob }).catch(() => {})
      return
    }
    enqueue(() =>
      api(`/images/${img.id}/restore`, { method: 'POST' }).then(
        () => {},
        (e) => {
          if (!(e instanceof Rejected)) throw e
        },
      ),
    )
  },
  purge(img: GenImage) {
    droppedImages.add(img.id)
    imageStore.forget(img.id)
    if (BROWSER_ONLY) return void del(idbKey(img)).catch(() => {})
    enqueue(() => api(`/images/${img.id}?purge=1`, { method: 'DELETE' }).then(() => {}))
  },
  url(id: string): string {
    let u = objectUrls.get(id)
    if (u) return u
    const b = localBlobs.get(id)
    if (!b) return `/api/images/${id}`
    objectUrls.set(id, (u = URL.createObjectURL(b)))
    return u
  },
  async blob(id: string): Promise<Blob> {
    const b = localBlobs.get(id)
    if (b) return b
    return (await api(`/images/${id}`)).blob()
  },
  async path(id: string, timeout = 15_000): Promise<string | null> {
    if (BROWSER_ONLY || !started) return null
    const end = Date.now() + timeout
    for (;;) {
      const r = await fetch(`/api/images/${encodeURIComponent(id)}/path`).catch(() => null)
      if (r?.ok) return ((await r.json()) as { path: string }).path
      if (Date.now() >= end) return null
      await new Promise((res) => setTimeout(res, 100))
    }
  },
  forget(id: string) {
    const u = objectUrls.get(id)
    if (u) URL.revokeObjectURL(u)
    objectUrls.delete(id)
    if (!BROWSER_ONLY) localBlobs.delete(id)
  },
}

export interface DocVersion {
  id: string
  docId: string
  n: number
  kind: 'gen' | 'ai'
  createdAt: number
  snapshot: Doc
  aiRequest?: string
  aiCount?: number
}

const VER = 'ver:'
const unsentVersions = new Map<string, DocVersion>()

export const versionStore = {
  async list(docId: string): Promise<DocVersion[]> {
    let all: DocVersion[] = []
    if (BROWSER_ONLY) {
      const ks = (await keys()).filter((k): k is string => typeof k === 'string' && k.startsWith(`${VER}${docId}:`))
      all = (await getMany<DocVersion>(ks)).filter((v): v is DocVersion => !!v)
    } else if (started) all = (await (await api(`/versions?doc=${encodeURIComponent(docId)}`)).json()) as DocVersion[]
    const have = new Set(all.map((v) => v.id))
    for (const v of unsentVersions.values()) if (v.docId === docId && !have.has(v.id)) all.push(v)
    return all.sort((a, b) => a.n - b.n)
  },
  async put(v: DocVersion) {
    if (BROWSER_ONLY) return set(`${VER}${v.docId}:${v.id}`, v)
    if (!started) return
    unsentVersions.set(v.id, v)
    enqueue(async () => {
      await api('/versions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(v) })
      unsentVersions.delete(v.id)
    })
  },
}

export interface StoredChat {
  id: string
  docId: string
  updatedAt: number
}

const unsentChats = new Map<string, StoredChat>()

export const chatStore = {
  async list<T extends StoredChat>(docId: string): Promise<T[]> {
    if (BROWSER_ONLY || !started) return [...unsentChats.values()].filter((c): c is T => c.docId === docId)
    const all = (await (await api(`/chats?doc=${encodeURIComponent(docId)}`)).json()) as T[]
    const byId = new Map(all.map((c) => [c.id, c]))
    for (const c of unsentChats.values()) if (c.docId === docId) byId.set(c.id, c as T)
    return [...byId.values()].sort((a, b) => b.updatedAt - a.updatedAt)
  },
  put(c: StoredChat) {
    unsentChats.set(c.id, c)
    if (BROWSER_ONLY || !started) return
    enqueue(async () => {
      const now = unsentChats.get(c.id)
      if (!now) return
      await api('/chats', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(now) })
      if (unsentChats.get(c.id) === now) unsentChats.delete(c.id)
    })
  },
}

/** Pending key-value and object writes must be drained before exit to avoid losing unsaved data. */
export async function settleWrites(timeout = 120_000) {
  const end = Date.now() + timeout
  while ((pending.size || inflight || ops.length || opsRunning) && Date.now() < end) {
    await flush()
    await new Promise((r) => setTimeout(r, 20))
  }
}
