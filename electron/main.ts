import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, nativeTheme, safeStorage, screen, session, shell, type IpcMainEvent, type IpcMainInvokeEvent, type Rectangle } from 'electron'
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { APP_NAME, APP_PORT, loadConfig } from '../server/config.ts'
import { DragFiles } from './drag-out.ts'
import { editMenuTemplate } from './edit-menu.ts'
import { TokenStore } from './token.ts'

const config = loadConfig()
const devUrl = process.env.PE_DEV_URL
const port = process.env.PE_PORT ? config.port : APP_PORT
const here = import.meta.dirname
const www = process.env.PE_WWW ?? path.join(here, 'www')

const SHELL = { light: '#eff0f4', dark: '#080910' }
const BAR_H = 36

app.setName(APP_NAME)
app.setPath('userData', path.join(config.appDir, 'electron'))

// Electron scopes the instance lock to userData, so isolated test profiles do not collide with the real app.
// Reopening must cancel the pending close so its completion cannot destroy the restored window.
if (!app.requestSingleInstanceLock()) app.quit()
else {
  app.on('second-instance', () => {
    if (!win) return
    cancelClose(win)
    if (win.isMinimized()) win.restore()
    if (process.env.PE_NO_FOCUS === '1') return win.showInactive()
    win.show()
    win.focus()
  })
  // Electron ready waits for the ESM entry to finish; top-level await would deadlock startup.
  app
    .whenReady()
    .then(start)
    .catch((e: Error) => fail(e.message))
}

let win: BrowserWindow | null = null
let server: { close(): Promise<unknown> } | null = null
/** Reject IPC from other origins to keep privileged preload operations confined to the app. */
let origin = ''

const appVersion = () => (app.isPackaged ? app.getVersion() : (JSON.parse(readFileSync(path.join(here, '..', 'package.json'), 'utf8')) as { version: string }).version)

// Danbooru's API rules require a unique User-Agent per application, not a library or browser default.
function setDanbooruUserAgent() {
  const ua = `${APP_NAME}/${appVersion()}`
  session.defaultSession.webRequest.onBeforeSendHeaders({ urls: ['*://*.donmai.us/*'] }, (d, done) => done({ requestHeaders: { ...d.requestHeaders, 'User-Agent': ua } }))
}

async function start() {
  dragFiles.clear()
  setDanbooruUserAgent()
  // Electron's default menu enables Ctrl+W and Ctrl+R, bypassing the app's shortcut handling.
  Menu.setApplicationMenu(null)
  let url = devUrl
  if (!url) {
    const { buildApp } = await import('../server/app.ts')
    const fastify = await buildApp({ ...config, port, staticDir: www }, { reveal: (dir) => shell.openPath(dir) })
    try {
      await fastify.listen({ host: '127.0.0.1', port })
    } catch (e) {
      const err = e as NodeJS.ErrnoException
      return fail(err.code === 'EADDRINUSE' ? `端口 ${port} 已被占用` : err.message)
    }
    server = fastify
    url = `http://127.0.0.1:${port}/`
  }
  origin = new URL(url).origin
  // Confine clipboard access to the app's main frame so untrusted frames cannot read it.
  const clipboardAllowed = (wc: Electron.WebContents | null, permission: string, requestingUrl: string, mainFrame: boolean) => {
    if (!win || wc !== win.webContents || !mainFrame || !['clipboard-read', 'clipboard-sanitized-write'].includes(permission)) return false
    try { return new URL(requestingUrl).origin === origin } catch { return false }
  }
  session.defaultSession.setPermissionCheckHandler((wc, permission, requestingOrigin, details) =>
    clipboardAllowed(wc, permission, details.requestingUrl ?? requestingOrigin, details.isMainFrame))
  session.defaultSession.setPermissionRequestHandler((wc, permission, callback, details) =>
    callback(clipboardAllowed(wc, permission, details.requestingUrl, details.isMainFrame)))
  win = await createWindow(url)
}

const fromPage = (e: IpcMainEvent | IpcMainInvokeEvent) => !!e.senderFrame && new URL(e.senderFrame.url).origin === origin
const HEX = /^#[0-9a-f]{6}$/i

ipcMain.on('pe:theme', (e, t: { shell?: unknown; symbol?: unknown }) => {
  const w = BrowserWindow.fromWebContents(e.sender)
  if (!w || !fromPage(e) || typeof t?.shell !== 'string' || typeof t.symbol !== 'string' || !HEX.test(t.shell) || !HEX.test(t.symbol)) return
  w.setBackgroundColor(t.shell)
  w.setTitleBarOverlay({ color: '#00000000', symbolColor: t.symbol, height: BAR_H })
})

// Only a fully loaded renderer can acknowledge a flush; startup error pages cannot.
const canFlush = new Set<number>()
ipcMain.on('pe:can-flush', (e) => fromPage(e) && canFlush.add(e.sender.id))

// Keep the renderer alive until generation and library writes finish; accept only the current close attempt's acknowledgement.
// Bound a stuck shutdown: pe:unsent recovers document writes, but images not yet saved can be lost at this timeout.
const CLOSE_MAX = 5 * 60_000
let closeSeq = 0
let closing: { id: number; timer: NodeJS.Timeout } | null = null
let closeNow = false

function startClose(w: BrowserWindow) {
  const id = ++closeSeq
  closing = { id, timer: setTimeout(() => finishClose(w, id), CLOSE_MAX) }
  // Hidden renderers throttle timers; generation and pending writes must keep running during shutdown.
  w.webContents.setBackgroundThrottling(false)
  w.hide()
  w.webContents.send('pe:before-close', id)
}
function finishClose(w: BrowserWindow, id: number) {
  if (closing?.id !== id || w.isDestroyed()) return
  clearTimeout(closing.timer)
  closing = null
  closeNow = true
  w.close()
}
function cancelClose(w: BrowserWindow) {
  if (!closing) return
  clearTimeout(closing.timer)
  closing = null
  w.webContents.setBackgroundThrottling(true)
}
ipcMain.on('pe:close-ready', (e, id: unknown) => {
  const w = BrowserWindow.fromWebContents(e.sender)
  if (w && fromPage(e) && typeof id === 'number') finishClose(w, id)
})

// OS-backed encryption protects NAI tokens and AI keys; AI keys are serialized as { serviceId: key }.
const cipher = {
  available: () => safeStorage.isEncryptionAvailable(),
  encrypt: (s: string) => safeStorage.encryptString(s),
  decrypt: (b: Buffer) => safeStorage.decryptString(b),
}
const tokens = new TokenStore(path.join(config.appDir, 'nai-token.bin'), cipher)
const aiKeys = new TokenStore(path.join(config.appDir, 'ai-keys.bin'), cipher)
ipcMain.handle('pe:token-get', (e) => (fromPage(e) ? tokens.get() : ''))
ipcMain.handle('pe:token-set', (e, token: unknown) => {
  if (!fromPage(e) || typeof token !== 'string') throw new Error('不认这个请求')
  tokens.set(token.trim())
})
ipcMain.handle('pe:ai-keys-get', (e) => (fromPage(e) ? aiKeys.get() : ''))
ipcMain.handle('pe:ai-keys-set', (e, keys: unknown) => {
  if (!fromPage(e) || typeof keys !== 'string') throw new Error('不认这个请求')
  aiKeys.set(keys)
})

ipcMain.handle('pe:pick-folder', async (e, current: unknown) => {
  const w = BrowserWindow.fromWebContents(e.sender)
  if (!w || !fromPage(e)) return null
  const r = await dialog.showOpenDialog(w, { title: '选择图库文件夹', defaultPath: typeof current === 'string' ? current : undefined, properties: ['openDirectory', 'createDirectory'] })
  return r.canceled ? null : (r.filePaths[0] ?? null)
})

ipcMain.on('pe:flash', (e) => {
  const w = BrowserWindow.fromWebContents(e.sender)
  if (!w || !fromPage(e) || w.isFocused()) return
  w.flashFrame(true)
  w.once('focus', () => w.flashFrame(false))
})

const dragFiles = new DragFiles(path.join(config.appDir, 'drag'))
ipcMain.handle('pe:drag-find', (e, key: unknown) => (fromPage(e) && typeof key === 'string' ? dragFiles.find(key) : null))
ipcMain.handle('pe:drag-write', (e, f: { key?: unknown; name?: unknown; ext?: unknown; bytes?: unknown }) => {
  if (!fromPage(e) || typeof f?.key !== 'string' || typeof f.name !== 'string' || typeof f.ext !== 'string' || !(f.bytes instanceof Uint8Array)) throw new Error('不认这个请求')
  return dragFiles.write(f.key, f.name, f.ext, f.bytes)
})
ipcMain.on('pe:drag-start', (e, d: { paths?: unknown; icon?: unknown; scale?: unknown }) => {
  const paths = Array.isArray(d?.paths) ? d.paths.filter((p): p is string => typeof p === 'string' && dragFiles.owns(p)) : []
  if (!fromPage(e) || !paths.length) return void e.sender.send('pe:drag-end')
  const scale = typeof d.scale === 'number' && d.scale > 0 && d.scale <= 4 ? d.scale : 1
  const icon = d.icon instanceof Uint8Array ? nativeImage.createFromBuffer(Buffer.from(d.icon), { scaleFactor: scale }) : nativeImage.createEmpty()
  try {
    // On Windows, startDrag returns only after release or Escape, so drag-end must be sent afterward.
    e.sender.startDrag({ file: paths[0], files: paths, icon })
  } finally {
    if (!e.sender.isDestroyed()) e.sender.send('pe:drag-end')
  }
})

function fail(detail: string) {
  dialog.showErrorBox(APP_NAME, `无法启动本地服务\n${detail}`)
  app.exit(1)
}

async function storedDark(url: string): Promise<boolean> {
  try {
    const r = await fetch(new URL('/api/kv/pe%3Aprefs', url))
    if (r.status === 404) return true
    if (r.ok) {
      const theme = (JSON.parse(((await r.json()) as { value: string }).value) as { state?: { theme?: string } }).state?.theme ?? 'dark'
      if (theme === 'dark' || theme === 'light') return theme === 'dark'
    }
  } catch {
  }
  return nativeTheme.shouldUseDarkColors
}

interface WindowState {
  bounds?: Rectangle
  maximized?: boolean
}
const stateFile = path.join(config.appDir, 'window.json')

function readState(): WindowState {
  try {
    const s = JSON.parse(readFileSync(stateFile, 'utf8')) as WindowState
    const b = s.bounds
    if (b && !screen.getAllDisplays().some((d) => b.x < d.workArea.x + d.workArea.width && b.x + b.width > d.workArea.x && b.y >= d.workArea.y - 8 && b.y < d.workArea.y + d.workArea.height)) delete s.bounds
    return s
  } catch {
    return {}
  }
}

async function createWindow(url: string) {
  const dark = await storedDark(url)
  const state = readState()
  const work = screen.getPrimaryDisplay().workAreaSize
  const w = new BrowserWindow({
    title: APP_NAME,
    icon: path.join(here, 'icon.ico'),
    ...(state.bounds ?? { width: Math.min(1600, work.width), height: Math.min(1000, work.height) }),
    minWidth: 960,
    minHeight: 600,
    show: false,
    backgroundColor: dark ? SHELL.dark : SHELL.light,
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#00000000', symbolColor: dark ? '#e9ebf1' : '#1a1c26', height: BAR_H },
    webPreferences: {
      preload: path.join(here, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      additionalArguments: dark ? ['--pe-dark'] : [],
    },
  })
  w.on('page-title-updated', (e) => e.preventDefault())
  w.once('ready-to-show', () => {
    if (state.maximized) w.maximize()
    if (process.env.PE_NO_FOCUS === '1') w.showInactive()
    else w.show()
  })
  w.on('close', (e) => {
    if (closeNow) return
    if (closing) return e.preventDefault()
    try {
      writeFileSync(stateFile, JSON.stringify({ bounds: w.getNormalBounds(), maximized: w.isMaximized() } satisfies WindowState))
    } catch {
    }
    if (!canFlush.has(w.webContents.id)) return
    e.preventDefault()
    startClose(w)
  })

  // Keep external content outside the privileged app renderer; open only HTTP(S) links in the system browser.
  const external = (target: string) => {
    if (/^https?:/.test(target)) void shell.openExternal(target)
  }
  w.webContents.setWindowOpenHandler(({ url: target }) => {
    external(target)
    return { action: 'deny' }
  })
  w.webContents.on('will-navigate', (e, target) => {
    if (new URL(target).origin === origin) return
    e.preventDefault()
    external(target)
  })
  w.webContents.on('context-menu', (_e, params) => {
    const template = editMenuTemplate(params)
    if (template) Menu.buildFromTemplate(template).popup({ window: w })
  })
  if (!app.isPackaged)
    w.webContents.on('before-input-event', (e, input) => {
      if (input.type !== 'keyDown') return
      if (input.key === 'F12' || (input.control && input.shift && input.key.toLowerCase() === 'i')) w.webContents.toggleDevTools()
      else if (input.control && input.key.toLowerCase() === 'r') w.webContents.reload()
      else return
      e.preventDefault()
    })

  await w.loadURL(url)
  return w
}

// Drain backend requests and release the library lock before exiting to avoid interrupting writes.
// Preventing will-quit and later calling app.quit() can leave Electron running indefinitely.
app.on('will-quit', () => dragFiles.clear())
app.on('window-all-closed', () => {
  void (server?.close() ?? Promise.resolve()).finally(() => app.quit())
})
