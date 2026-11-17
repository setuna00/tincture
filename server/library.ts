// images.tab_id stores document IDs; migrated open tabs retain their tab ID as the document ID.
// Publish files by temporary-file rename before committing records; keep soft-deleted images until restart so undo can restore them.
import Database from 'better-sqlite3'
import { createHash, randomUUID } from 'node:crypto'
import { existsSync, mkdirSync } from 'node:fs'
import { readdir, readFile, rename, rm, stat, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'

export interface ImageMeta {
  id: string
  /** The sentinel "imported" identifies images with no owning document. */
  tabId: string
  versionId?: string
  label?: string
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
}

interface ImageRow {
  id: string
  tab_id: string
  batch: string
  idx: number
  created_at: number
  seed: number
  width: number
  height: number
  model: string
  file: string
  mime: string
  size: number
  doc: string
  version_id: string | null
  version_n: number | null
  label: string | null
  source_id: string | null
}

export interface VersionMeta {
  id: string
  docId: string
  n: number
  kind: 'gen' | 'ai'
  createdAt: number
  aiRequest?: string
  aiCount?: number
}

interface VersionRow {
  id: string
  doc_id: string
  n: number
  kind: string
  created_at: number
  snapshot: string
  ai_request: string | null
  ai_count: number | null
}

const IMPORTED = 'imported'

export interface Counts {
  kv: number
  kvBytes: number
  images: number
  imageBytes: number
  assets: number
  assetBytes: number
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS images (
  id TEXT PRIMARY KEY, tab_id TEXT NOT NULL, batch TEXT NOT NULL, idx INTEGER NOT NULL, created_at INTEGER NOT NULL,
  seed INTEGER NOT NULL, width INTEGER NOT NULL, height INTEGER NOT NULL, model TEXT NOT NULL,
  file TEXT NOT NULL, mime TEXT NOT NULL, size INTEGER NOT NULL, doc TEXT NOT NULL, deleted_at INTEGER
);
CREATE INDEX IF NOT EXISTS images_tab ON images (tab_id);
CREATE TABLE IF NOT EXISTS versions (
  id TEXT PRIMARY KEY, doc_id TEXT NOT NULL, n INTEGER NOT NULL, kind TEXT NOT NULL, created_at INTEGER NOT NULL,
  snapshot TEXT NOT NULL, ai_request TEXT, ai_count INTEGER, from_n INTEGER -- from_n 不再用
);
CREATE INDEX IF NOT EXISTS versions_doc ON versions (doc_id);
CREATE TABLE IF NOT EXISTS assets (key TEXT PRIMARY KEY, file TEXT NOT NULL, mime TEXT NOT NULL, size INTEGER NOT NULL, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS chats (id TEXT PRIMARY KEY, doc_id TEXT NOT NULL, updated_at INTEGER NOT NULL, data TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS chats_doc ON chats (doc_id);
`

export class LibraryLocked extends Error {
  readonly code = 'LIBRARY_LOCKED'
  constructor(dir: string) {
    super(`图库文件夹已被另一个窗口使用：${dir}`)
  }
}

/** IDs become filenames, so path separators and traversal characters must be rejected. */
export const ID_RE = /^[A-Za-z0-9_-]{1,80}$/

const EXT: Record<string, string> = { 'image/webp': 'webp', 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif' }
export const extOf = (mime: string) => EXT[mime] ?? 'bin'

const pad = (n: number) => String(n).padStart(2, '0')
const monthOf = (t: number) => {
  const d = new Date(t)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`
}

/** Rename a temporary file atomically so an interrupted write cannot publish a partial image. */
async function writeAtomic(file: string, data: Uint8Array) {
  mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.${randomUUID().slice(0, 8)}.tmp`
  await writeFile(tmp, data)
  await rename(tmp, file)
}

/** Stage migration files separately and commit their records in one transaction so interrupted imports can restart safely. */
interface Staging {
  token: string
  dir: string
  images: { meta: ImageMeta; doc: string; tmp: string }[]
  assets: { key: string; mime: string; size: number; tmp: string }[]
}

export class Library {
  readonly dir: string
  readonly db: Database.Database
  readonly id: string
  private staging: Staging | null = null

  constructor(dir: string) {
    this.dir = dir
    mkdirSync(dir, { recursive: true })
    // Hold an OS-backed exclusive lock for the library lifetime to prevent concurrent backends from overwriting data.
    this.db = new Database(path.join(dir, 'library.db'), { timeout: 0 })
    try {
      this.db.pragma('locking_mode = EXCLUSIVE')
      this.db.pragma('journal_mode = WAL')
      this.db.pragma('synchronous = NORMAL')
      this.db.exec(SCHEMA)
      const cols = new Set((this.db.pragma('table_info(images)') as { name: string }[]).map((c) => c.name))
      if (!cols.has('version_id')) this.db.exec('ALTER TABLE images ADD COLUMN version_id TEXT')
      if (!cols.has('label')) this.db.exec('ALTER TABLE images ADD COLUMN label TEXT')
      if (!cols.has('source_id')) this.db.exec('ALTER TABLE images ADD COLUMN source_id TEXT')
      if (!cols.has('hash')) this.db.exec('ALTER TABLE images ADD COLUMN hash TEXT')
      this.db.exec('BEGIN EXCLUSIVE; COMMIT')
    } catch (e) {
      this.db.close()
      if ((e as { code?: string }).code === 'SQLITE_BUSY') throw new LibraryLocked(dir)
      throw e
    }
    let id = this.metaGet('id')
    if (!id) {
      id = randomUUID()
      this.metaSet('id', id)
    }
    this.id = id
  }

  close() {
    this.db.close()
  }

  async tidy() {
    this.versionOrphans()
    const gone = this.db.prepare('SELECT file FROM images WHERE deleted_at IS NOT NULL').all() as { file: string }[]
    this.db.prepare('DELETE FROM images WHERE deleted_at IS NOT NULL').run()
    for (const g of gone) await unlink(path.join(this.dir, g.file)).catch(() => {})
    await rm(path.join(this.dir, '.migrating'), { recursive: true, force: true }).catch(() => {})
  }

  metaGet(key: string): string | undefined {
    return (this.db.prepare('SELECT value FROM meta WHERE key = ?').get(key) as { value: string } | undefined)?.value
  }
  metaSet(key: string, value: string) {
    this.db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value').run(key, value)
  }

  isEmpty(): boolean {
    const n = (sql: string) => (this.db.prepare(sql).get() as { n: number }).n
    return n('SELECT COUNT(*) n FROM kv') + n('SELECT COUNT(*) n FROM images') + n('SELECT COUNT(*) n FROM assets') === 0
  }

  counts(): Counts {
    const kv = this.db.prepare('SELECT COUNT(*) n, COALESCE(SUM(LENGTH(CAST(value AS BLOB))), 0) b FROM kv').get() as { n: number; b: number }
    const im = this.db.prepare('SELECT COUNT(*) n, COALESCE(SUM(size), 0) b FROM images WHERE deleted_at IS NULL').get() as { n: number; b: number }
    const as = this.db.prepare('SELECT COUNT(*) n, COALESCE(SUM(size), 0) b FROM assets').get() as { n: number; b: number }
    return { kv: kv.n, kvBytes: kv.b, images: im.n, imageBytes: im.b, assets: as.n, assetBytes: as.b }
  }

  kvAll(): Record<string, string> {
    const out: Record<string, string> = {}
    for (const r of this.db.prepare('SELECT key, value FROM kv').all() as { key: string; value: string }[]) out[r.key] = r.value
    return out
  }

  kvGet(key: string): string | undefined {
    return (this.db.prepare('SELECT value FROM kv WHERE key = ?').get(key) as { value: string } | undefined)?.value
  }

  kvApply(set: Record<string, string>, del: string[]) {
    const up = this.db.prepare('INSERT INTO kv (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at')
    const rm = this.db.prepare('DELETE FROM kv WHERE key = ?')
    const now = Date.now()
    this.db.transaction(() => {
      for (const [k, v] of Object.entries(set)) up.run(k, v, now)
      for (const k of del) rm.run(k)
    })()
  }

  imageTabs(): string[] {
    return (this.db.prepare('SELECT DISTINCT tab_id FROM images WHERE deleted_at IS NULL').all() as { tab_id: string }[]).map((r) => r.tab_id)
  }

  imagesJson(tabId?: string): string {
    const sql = 'SELECT images.*, versions.n AS version_n FROM images LEFT JOIN versions ON versions.id = images.version_id WHERE images.deleted_at IS NULL'
    const rows = (tabId ? this.db.prepare(`${sql} AND images.tab_id = ?`).all(tabId) : this.db.prepare(sql).all()) as ImageRow[]
    return `[${rows.map((r) => `${JSON.stringify({ ...toMeta(r), ...(r.version_n !== null ? { version: r.version_n } : {}), ...(this.missing.has(r.id) ? { missing: true } : {}) }).slice(0, -1)},"doc":${r.doc}}`).join(',')}]`
  }

  private missing = new Set<string>()

  /** Recover renamed files by hash; without a hash, require a unique size match and matching readable NAI seed to avoid attaching the wrong image. */
  async checkFiles(): Promise<{ relinked: number; missing: number }> {
    const root = path.join(this.dir, 'images')
    const files = new Set<string>()
    if (existsSync(root))
      for (const f of await readdir(root, { recursive: true, withFileTypes: true })) {
        if (!f.isFile() || f.name.endsWith('.tmp')) continue
        files.add(path.relative(this.dir, path.join(f.parentPath, f.name)).split(path.sep).join('/'))
      }
    const rows = this.db.prepare('SELECT id, file, size, mime, seed, hash, deleted_at FROM images').all() as { id: string; file: string; size: number; mime: string; seed: number; hash: string | null; deleted_at: number | null }[]
    const lost = rows.filter((r) => r.deleted_at === null && !files.has(r.file))
    let relinked = 0
    if (lost.length) {
      const known = new Set(rows.map((r) => r.file))
      const unknown: { rel: string; size: number }[] = []
      for (const rel of files) if (!known.has(rel)) unknown.push({ rel, size: (await stat(path.join(this.dir, rel))).size })
      const taken = new Set<string>()
      const hashes = new Map<string, string>()
      const hashOf = async (rel: string) => {
        let h = hashes.get(rel)
        if (!h) hashes.set(rel, (h = createHash('sha256').update(await readFile(path.join(this.dir, rel))).digest('hex')))
        return h
      }
      const relink = this.db.prepare('UPDATE images SET file = ? WHERE id = ?')
      for (const r of lost) {
        const same = unknown.filter((u) => !taken.has(u.rel) && u.size === r.size && u.rel.endsWith(`.${extOf(r.mime)}`))
        let hit: string | undefined
        if (r.hash) {
          for (const u of same) if ((await hashOf(u.rel)) === r.hash) hit = u.rel
        } else if (same.length === 1 && lost.filter((x) => !x.hash && x.size === r.size).length === 1) {
          const seed = r.mime === 'image/png' ? pngSeed(await readFile(path.join(this.dir, same[0].rel))) : undefined
          if (seed === undefined || seed === r.seed) hit = same[0].rel
        }
        if (!hit) continue
        relink.run(hit, r.id)
        taken.add(hit)
        r.file = hit
        relinked++
      }
    }
    this.missing = new Set(lost.filter((r) => !files.has(r.file)).map((r) => r.id))
    return { relinked, missing: this.missing.size }
  }

  imageFile(id: string): { file: string; mime: string } | null {
    const r = this.db.prepare('SELECT file, mime FROM images WHERE id = ? AND deleted_at IS NULL').get(id) as { file: string; mime: string } | undefined
    return r ? { file: path.join(this.dir, r.file), mime: r.mime } : null
  }

  private imagePath(meta: ImageMeta) {
    return path.posix.join('images', monthOf(meta.createdAt), `${meta.id}.${extOf(meta.mime)}`)
  }

  private insertImage(meta: ImageMeta, file: string, doc: string, hash: string | null = null) {
    this.db
      .prepare(
        `INSERT INTO images (id, tab_id, batch, idx, created_at, seed, width, height, model, file, mime, size, doc, deleted_at, version_id, label, source_id, hash)
         VALUES (@id, @tabId, @batch, @index, @createdAt, @seed, @width, @height, @model, @file, @mime, @size, @doc, NULL, @versionId, @label, @sourceId, @hash)
         ON CONFLICT (id) DO UPDATE SET tab_id = excluded.tab_id, batch = excluded.batch, idx = excluded.idx, created_at = excluded.created_at,
           seed = excluded.seed, width = excluded.width, height = excluded.height, model = excluded.model, file = excluded.file,
           mime = excluded.mime, size = excluded.size, doc = excluded.doc, deleted_at = NULL, version_id = excluded.version_id,
           label = excluded.label, source_id = excluded.source_id, hash = COALESCE(excluded.hash, images.hash)`,
      )
      .run({ ...meta, versionId: meta.versionId ?? null, label: meta.label ?? null, sourceId: meta.sourceId ?? null, file, doc, hash })
  }

  async addImage(meta: ImageMeta, doc: string, bytes: Uint8Array) {
    const rel = this.imagePath(meta)
    await writeAtomic(path.join(this.dir, rel), bytes)
    this.insertImage({ ...meta, size: bytes.byteLength }, rel, doc, createHash('sha256').update(bytes).digest('hex'))
    this.missing.delete(meta.id)
  }

  softDelete(id: string) {
    this.db.prepare('UPDATE images SET deleted_at = ? WHERE id = ?').run(Date.now(), id)
  }
  restore(id: string): boolean {
    return this.db.prepare('UPDATE images SET deleted_at = NULL WHERE id = ?').run(id).changes > 0
  }
  async purge(id: string) {
    const r = this.db.prepare('SELECT file FROM images WHERE id = ?').get(id) as { file: string } | undefined
    this.db.prepare('DELETE FROM images WHERE id = ?').run(id)
    if (r) await unlink(path.join(this.dir, r.file)).catch(() => {})
  }

  chatsJson(docId: string): string {
    const rows = this.db.prepare('SELECT data FROM chats WHERE doc_id = ? ORDER BY updated_at DESC').all(docId) as { data: string }[]
    return `[${rows.map((r) => r.data).join(',')}]`
  }

  putChat(id: string, docId: string, updatedAt: number, data: string) {
    this.db
      .prepare('INSERT INTO chats (id, doc_id, updated_at, data) VALUES (?, ?, ?, ?) ON CONFLICT (id) DO UPDATE SET doc_id = excluded.doc_id, updated_at = excluded.updated_at, data = excluded.data')
      .run(id, docId, updatedAt, data)
  }

  versionsJson(docId: string): string {
    const rows = this.db.prepare('SELECT * FROM versions WHERE doc_id = ? ORDER BY n').all(docId) as VersionRow[]
    return `[${rows.map((r) => `${JSON.stringify(toVersion(r)).slice(0, -1)},"snapshot":${r.snapshot}}`).join(',')}]`
  }

  addVersion(v: VersionMeta, snapshot: string) {
    this.db
      .prepare(
        `INSERT INTO versions (id, doc_id, n, kind, created_at, snapshot, ai_request, ai_count)
         VALUES (@id, @docId, @n, @kind, @createdAt, @snapshot, @aiRequest, @aiCount)
         ON CONFLICT (id) DO UPDATE SET doc_id = excluded.doc_id, n = excluded.n, kind = excluded.kind, created_at = excluded.created_at,
           snapshot = excluded.snapshot, ai_request = excluded.ai_request, ai_count = excluded.ai_count`,
      )
      .run({ id: v.id, docId: v.docId, n: v.n, kind: v.kind, createdAt: v.createdAt, snapshot, aiRequest: v.aiRequest ?? null, aiCount: v.aiCount ?? null })
  }

  versionOrphans() {
    const rows = this.db
      .prepare('SELECT id, tab_id, batch, created_at, doc FROM images WHERE version_id IS NULL AND label IS NULL AND tab_id != ? ORDER BY tab_id, created_at, batch, idx')
      .all(IMPORTED) as Pick<ImageRow, 'id' | 'tab_id' | 'batch' | 'created_at' | 'doc'>[]
    if (!rows.length) return
    const existing = this.db.prepare('SELECT id, n, snapshot FROM versions WHERE doc_id = ?')
    const assign = this.db.prepare('UPDATE images SET version_id = ? WHERE id = ?')
    this.db.transaction(() => {
      let doc = ''
      let batch = ''
      let byKey = new Map<string, string>()
      let max = 0
      let cur = ''
      for (const r of rows) {
        if (r.tab_id !== doc) {
          doc = r.tab_id
          batch = ''
          const list = existing.all(doc) as { id: string; n: number; snapshot: string }[]
          byKey = new Map(list.map((v) => [versionKey(v.snapshot), v.id]))
          max = Math.max(0, ...list.map((v) => v.n))
        }
        if (r.batch !== batch) {
          batch = r.batch
          const key = versionKey(r.doc)
          const hit = byKey.get(key)
          if (hit) cur = hit
          else {
            cur = `ver_${randomUUID().replace(/-/g, '').slice(0, 10)}`
            this.addVersion({ id: cur, docId: doc, n: ++max, kind: 'gen', createdAt: r.created_at }, r.doc)
            byKey.set(key, cur)
          }
        }
        assign.run(cur, r.id)
      }
    })()
  }

  assetKeys(prefix: string): string[] {
    return (this.db.prepare("SELECT key FROM assets WHERE substr(key, 1, length(?)) = ?").all(prefix, prefix) as { key: string }[]).map((r) => r.key)
  }

  assetFile(key: string): { file: string; mime: string } | null {
    const r = this.db.prepare('SELECT file, mime FROM assets WHERE key = ?').get(key) as { file: string; mime: string } | undefined
    return r ? { file: path.join(this.dir, r.file), mime: r.mime } : null
  }

  private insertAsset(key: string, file: string, mime: string, size: number) {
    this.db
      .prepare('INSERT INTO assets (key, file, mime, size, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT (key) DO UPDATE SET file = excluded.file, mime = excluded.mime, size = excluded.size')
      .run(key, file, mime, size, Date.now())
  }

  async putAsset(key: string, mime: string, bytes: Uint8Array) {
    const old = this.assetFile(key)
    const rel = path.posix.join('assets', `${randomUUID()}.${extOf(mime)}`)
    await writeAtomic(path.join(this.dir, rel), bytes)
    this.insertAsset(key, rel, mime, bytes.byteLength)
    if (old) await unlink(old.file).catch(() => {})
  }

  async delAsset(key: string) {
    const old = this.assetFile(key)
    this.db.prepare('DELETE FROM assets WHERE key = ?').run(key)
    if (old) await unlink(old.file).catch(() => {})
  }

  async beginMigration(): Promise<string> {
    if (!this.isEmpty()) throw Object.assign(new Error('图库文件夹不是空的'), { statusCode: 409 })
    const root = path.join(this.dir, '.migrating')
    await rm(root, { recursive: true, force: true })
    const token = randomUUID()
    const dir = path.join(root, token)
    mkdirSync(dir, { recursive: true })
    this.staging = { token, dir, images: [], assets: [] }
    return token
  }

  private stage(token: string): Staging {
    if (this.staging?.token !== token) throw Object.assign(new Error('迁移已失效'), { statusCode: 404 })
    return this.staging
  }

  async stageImage(token: string, meta: ImageMeta, doc: string, bytes: Uint8Array) {
    const s = this.stage(token)
    const tmp = path.join(s.dir, `i-${s.images.length}`)
    await writeFile(tmp, bytes)
    s.images.push({ meta: { ...meta, size: bytes.byteLength }, doc, tmp })
  }

  async stageAsset(token: string, key: string, mime: string, bytes: Uint8Array) {
    const s = this.stage(token)
    const tmp = path.join(s.dir, `a-${s.assets.length}`)
    await writeFile(tmp, bytes)
    s.assets.push({ key, mime, size: bytes.byteLength, tmp })
  }

  /** Validate staged counts and byte totals before moving files and committing records; reject incomplete migrations. */
  async commitMigration(token: string, kv: Record<string, string>, expect: Pick<Counts, 'images' | 'imageBytes' | 'assets' | 'assetBytes'>): Promise<Counts> {
    const s = this.stage(token)
    this.staging = null
    const moved: string[] = []
    try {
      const imageBytes = s.images.reduce((a, x) => a + x.meta.size, 0)
      const assetBytes = s.assets.reduce((a, x) => a + x.size, 0)
      if (s.images.length !== expect.images || imageBytes !== expect.imageBytes || s.assets.length !== expect.assets || assetBytes !== expect.assetBytes)
        throw new Error(`暂存的和发来的对不上：图 ${s.images.length}/${expect.images} 张 ${imageBytes}/${expect.imageBytes} 字节，配图 ${s.assets.length}/${expect.assets} 张 ${assetBytes}/${expect.assetBytes} 字节`)
      for (const x of [...s.images.map((i) => ({ tmp: i.tmp, size: i.meta.size })), ...s.assets]) {
        if ((await stat(x.tmp)).size !== x.size) throw new Error('暂存文件大小不对')
      }
      const images = s.images.map((i) => ({ ...i, rel: this.imagePath(i.meta) }))
      const assets = s.assets.map((a) => ({ ...a, rel: path.posix.join('assets', `${randomUUID()}.${extOf(a.mime)}`) }))
      for (const x of [...images, ...assets]) {
        const to = path.join(this.dir, x.rel)
        mkdirSync(path.dirname(to), { recursive: true })
        await rename(x.tmp, to)
        moved.push(to)
      }
      this.db.transaction(() => {
        if (!this.isEmpty()) throw new Error('图库文件夹不是空的')
        this.kvApply(kv, [])
        for (const i of images) this.insertImage(i.meta, i.rel, i.doc)
        for (const a of assets) this.insertAsset(a.key, a.rel, a.mime, a.size)
        this.metaSet('migratedAt', String(Date.now()))
      })()
      this.versionOrphans()
    } catch (e) {
      for (const f of moved) await unlink(f).catch(() => {})
      throw e
    } finally {
      await rm(path.join(this.dir, '.migrating'), { recursive: true, force: true }).catch(() => {})
    }
    return this.counts()
  }

  static async wipe(dir: string) {
    if (!existsSync(dir)) return
    for (const name of await readdir(dir)) {
      if (name === 'library.db' || name.startsWith('library.db-') || name === 'images' || name === 'assets' || name === '.migrating')
        await rm(path.join(dir, name), { recursive: true, force: true })
    }
  }
}

/** NAI stores the seed in the JSON of the PNG tEXt chunk named "Comment". */
export function pngSeed(buf: Uint8Array): number | undefined {
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
  if (buf.length < 8 || sig.some((b, i) => buf[i] !== b)) return undefined
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  const dec = new TextDecoder('latin1')
  for (let at = 8; at + 8 <= buf.length; ) {
    const len = view.getUint32(at)
    const type = dec.decode(buf.subarray(at + 4, at + 8))
    if (type === 'IEND' || at + 12 + len > buf.length) break
    if (type === 'tEXt') {
      const body = buf.subarray(at + 8, at + 8 + len)
      const nul = body.indexOf(0)
      if (nul > 0 && dec.decode(body.subarray(0, nul)) === 'Comment') {
        try {
          const seed = (JSON.parse(new TextDecoder().decode(body.subarray(nul + 1))) as { seed?: unknown }).seed
          return typeof seed === 'number' ? seed : undefined
        } catch {
          return undefined
        }
      }
    }
    at += 12 + len
  }
  return undefined
}

function toMeta(r: ImageRow): ImageMeta {
  return {
    id: r.id,
    tabId: r.tab_id,
    ...(r.version_id ? { versionId: r.version_id } : {}),
    ...(r.label ? { label: r.label } : {}),
    ...(r.source_id ? { sourceId: r.source_id } : {}),
    batch: r.batch,
    index: r.idx,
    createdAt: r.created_at,
    seed: r.seed,
    width: r.width,
    height: r.height,
    model: r.model,
    mime: r.mime,
    size: r.size,
  }
}

function toVersion(r: VersionRow): VersionMeta {
  return {
    id: r.id,
    docId: r.doc_id,
    n: r.n,
    kind: r.kind === 'ai' ? 'ai' : 'gen',
    createdAt: r.created_at,
    ...(r.ai_request !== null ? { aiRequest: r.ai_request } : {}),
    ...(r.ai_count !== null ? { aiCount: r.ai_count } : {}),
  }
}

type Obj = Record<string, unknown>
const list = (v: unknown): Obj[] => (Array.isArray(v) ? (v as Obj[]) : [])
const sectionContent = (s: Obj) => ({ muted: s.muted, chips: list(s.chips).map((c) => ({ text: c.text, type: c.type, weight: c.weight, disabled: c.disabled, interaction: c.interaction })) })

export function versionKey(snapshot: string): string {
  let d: { base?: Obj; characters?: unknown; settings?: Obj }
  try {
    d = JSON.parse(snapshot) as typeof d
  } catch {
    return snapshot
  }
  const { perModel: _p, gen, ...settings } = d.settings ?? {}
  const { seed: _s, nSamples: _n, strength, noise, ...g } = (gen ?? {}) as Obj
  if (settings.baseImage) Object.assign(g, { strength, noise })
  return stable({
    base: { prompt: list(d.base?.prompt).map(sectionContent), uc: list(d.base?.uc).map(sectionContent) },
    characters: list(d.characters).map((c) => ({ gender: c.gender, genderExtra: c.genderExtra, enabled: c.enabled, center: c.center, prompt: list(c.prompt).map(sectionContent), uc: list(c.uc).map(sectionContent) })),
    settings: { ...settings, gen: g },
  })
}

function stable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>
    const keys = Object.keys(o).filter((k) => o[k] !== undefined).sort()
    return `{${keys.map((k) => `${JSON.stringify(k)}:${stable(o[k])}`).join(',')}}`
  }
  return JSON.stringify(v) ?? 'null'
}
