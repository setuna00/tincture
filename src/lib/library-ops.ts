// Folders exist only as template paths: '/' separates levels and '' denotes the root; empty folders are not stored.

export const parentPath = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '')
export const baseName = (p: string) => p.slice(p.lastIndexOf('/') + 1)
export const joinPath = (a: string, b: string) => (a && b ? `${a}/${b}` : a || b)
export const inPath = (folder: string, path: string) => !!path && (folder === path || folder.startsWith(`${path}/`))

export const relocate = (from: string, to: string) => (folder: string) => (inPath(folder, from) ? joinPath(to, folder.slice(from.length + 1)) : folder)

export const dissolve = (path: string) => (folder: string) => (inPath(folder, path) ? joinPath(parentPath(path), folder.slice(path.length + 1)) : folder)

export const renamedPath = (path: string, name: string) => joinPath(parentPath(path), cleanName(name))
export const cleanName = (name: string) => name.replace(/\//g, '').trim()

export const canMoveFolder = (from: string, into: string) => !inPath(into, from) && parentPath(from) !== into

export function folderPaths(folders: Iterable<string>): string[] {
  const all = new Set<string>()
  for (const f of folders) {
    const parts = f.split('/').filter(Boolean)
    parts.forEach((_, i) => all.add(parts.slice(0, i + 1).join('/')))
  }
  return [...all].sort((a, b) => a.localeCompare(b, 'zh'))
}

export function workNames(works: Iterable<string | undefined>): string[] {
  return [...new Set([...works].map((w) => w?.trim() ?? '').filter(Boolean))].sort((a, b) => a.localeCompare(b, 'zh'))
}

const FOLDER = 'folder:'
export function remapFavorites<K extends string>(favs: K[], fn: (folder: string) => string): K[] {
  const out: K[] = []
  for (const k of favs) {
    const next = (k.startsWith(FOLDER) ? `${FOLDER}${fn(k.slice(FOLDER.length))}` : k) as K
    if (next === FOLDER || out.includes(next)) continue
    out.push(next)
  }
  return out
}

/** Undo only this operation's favorite changes, so later additions and removals survive. */
export function revertFavorites<K extends string>(current: K[], before: K[], after: K[]): K[] {
  const added = new Set(after.filter((k) => !before.includes(k)))
  const out = current.filter((k) => !added.has(k))
  before.forEach((k, i) => {
    if (!after.includes(k) && !out.includes(k)) out.splice(Math.min(i, out.length), 0, k)
  })
  return out
}

export function remapOpenFolders(open: Record<string, boolean>, fn: (folder: string) => string): Record<string, boolean> {
  const out: Record<string, boolean> = {}
  for (const [k, v] of Object.entries(open)) {
    if (k.startsWith('work-closed:')) out[k] = v
    else if (k.startsWith('★')) {
      const p = fn(k.slice(1))
      if (p) out[`★${p}`] = out[`★${p}`] || v
    } else {
      const p = fn(k)
      if (p) out[p] = out[p] || v
    }
  }
  return out
}
