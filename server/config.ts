import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export const APP_NAME = 'Tincture'

export const LEGACY_NAMES = ['Prompt台']

export function adoptLegacyDir(dir: string, legacy: string[], fs: { exists: (p: string) => boolean; rename: (a: string, b: string) => void } = { exists: existsSync, rename: renameSync }): string {
  if (fs.exists(dir)) return dir
  const old = legacy.find((p) => fs.exists(p))
  if (!old) return dir
  try {
    fs.rename(old, dir)
    return dir
  } catch {
    return old
  }
}

export const DEFAULT_PORT = 4520

/** Keep the desktop port stable because Chromium scopes browser storage by origin. */
export const APP_PORT = 4530

export interface Config {
  port: number
  appDir: string
  defaultLibraryDir: string
  test: boolean
  staticDir?: string
}

/** Windows may redirect Documents to OneDrive; resolve its system location instead of assuming ~/Documents. */
function documentsDir(): string {
  if (process.platform === 'win32') {
    try {
      const out = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', "[Console]::OutputEncoding=[Text.Encoding]::UTF8; [Environment]::GetFolderPath('MyDocuments')"], { encoding: 'utf8', timeout: 10_000, windowsHide: true }).trim()
      if (out) return out
    } catch {
    }
  }
  return path.join(os.homedir(), 'Documents')
}

/** Cloud synchronization can corrupt SQLite databases and WAL files, so keep the library outside synced folders. */
export function isSynced(dir: string, env: NodeJS.ProcessEnv): boolean {
  const norm = (p: string) => `${path.resolve(p).toLowerCase()}${path.sep}`
  const d = norm(dir)
  const roots = [env.OneDrive, env.OneDriveConsumer, env.OneDriveCommercial].filter((r): r is string => !!r)
  return roots.some((r) => d.startsWith(norm(r))) || /[\\/]onedrive( - [^\\/]+)?[\\/]/i.test(d)
}

export function defaultLibraryDir(documents: string, home: string, env: NodeJS.ProcessEnv, name = APP_NAME): string {
  return path.join(isSynced(documents, env) ? home : documents, name)
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const test = env.PE_TEST === '1'
  // Tests must override both directories to avoid writing into the real library or app settings.
  if (test && (!env.PE_APP_DIR || !env.PE_LIBRARY_DIR)) throw new Error('PE_TEST=1 时必须设置 PE_APP_DIR 和 PE_LIBRARY_DIR')
  const appData = env.APPDATA ?? path.join(os.homedir(), '.config')
  const appDir = env.PE_APP_DIR ?? adoptLegacyDir(path.join(appData, APP_NAME), LEGACY_NAMES.map((n) => path.join(appData, n)))
  let libraryDir = env.PE_LIBRARY_DIR
  if (!libraryDir) {
    const [documents, home] = [documentsDir(), os.homedir()]
    libraryDir = adoptLegacyDir(defaultLibraryDir(documents, home, env), LEGACY_NAMES.map((n) => defaultLibraryDir(documents, home, env, n)))
  }
  return {
    port: Number(env.PE_PORT ?? DEFAULT_PORT),
    appDir: path.resolve(appDir),
    defaultLibraryDir: path.resolve(libraryDir),
    test,
  }
}

export interface Settings {
  libraryDir?: string
}

const settingsFile = (appDir: string) => path.join(appDir, 'settings.json')

export function readSettings(appDir: string): Settings {
  try {
    return JSON.parse(readFileSync(settingsFile(appDir), 'utf8')) as Settings
  } catch {
    return {}
  }
}

export function writeSettings(appDir: string, s: Settings) {
  mkdirSync(appDir, { recursive: true })
  writeFileSync(settingsFile(appDir), `${JSON.stringify(s, null, 2)}\n`)
}

export const dirExists = (dir: string) => existsSync(dir)
