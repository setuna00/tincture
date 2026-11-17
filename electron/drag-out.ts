// Drop targets may read files after the drag ends, so retain them until application startup or shutdown.
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const EXTS = new Set(['png', 'webp', 'jpg'])
/** Windows treats these device names as reserved even when a file extension is present. */
const RESERVED = /^(con|prn|aux|nul|com\d|lpt\d)$/i

export function safeName(name: string): string {
  // oxlint-disable-next-line no-control-regex -- 控制字符正是要换掉的
  let s = name.replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').replace(/[. ]+$/, '').trim()
  if (!s) s = 'image'
  if (RESERVED.test(s)) s = `_${s}`
  return s.slice(0, 180)
}

/** Node 24 rmSync can silently leave paths containing Chinese characters; remove entries explicitly instead. */
function removeTree(p: string) {
  let entries
  try {
    entries = readdirSync(p, { withFileTypes: true })
  } catch {
    return
  }
  for (const e of entries) {
    const child = path.join(p, e.name)
    try {
      if (e.isDirectory()) removeTree(child)
      else unlinkSync(child)
    } catch {
    }
  }
  try {
    rmdirSync(p)
  } catch {
  }
}

export class DragFiles {
  private known = new Map<string, string>()
  readonly root: string
  constructor(root: string) {
    this.root = root
  }

  clear() {
    this.known.clear()
    removeTree(this.root)
  }

  find(key: string): string | null {
    const p = this.known.get(key)
    return p && existsSync(p) ? p : null
  }

  write(key: string, name: string, ext: string, bytes: Uint8Array): string {
    if (!EXTS.has(ext)) throw new Error(`不认的格式 ${ext}`)
    const dir = path.join(this.root, createHash('sha1').update(key).digest('hex').slice(0, 16))
    mkdirSync(dir, { recursive: true })
    const file = path.join(dir, `${safeName(name)}.${ext}`)
    writeFileSync(file, bytes)
    this.known.set(key, file)
    return file
  }

  /** Only export files inside the drag directory so a renderer-supplied path cannot expose arbitrary local files. */
  owns(p: string): boolean {
    const rel = path.relative(this.root, path.resolve(p))
    return !!rel && !rel.startsWith('..') && !path.isAbsolute(rel) && existsSync(p)
  }
}
