// Temporary paths protect real libraries; intercepted NAI requests prevent paid network calls.
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { flipFuses, FuseVersion, FuseV1Options, FuseState, getCurrentFuseWire } from '@electron/fuses'
import { execFileSync, execSync, spawn, type ChildProcess } from 'node:child_process'
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import os from 'node:os'
import { Packr } from 'msgpackr'
import path from 'node:path'

const APP_NAME = readFileSync('server/config.ts', 'utf8').match(/export const APP_NAME = '([^']+)'/)![1]
const exe = process.env.PE_APP_EXE ?? path.resolve('release', `${APP_NAME}-win32-x64`, `${APP_NAME}.exe`)
const packaged = existsSync(exe)
const PORT = 4571

function newestSource(): number {
  let newest = 0
  const walk = (p: string) => {
    const st = statSync(p)
    if (st.isDirectory()) for (const name of readdirSync(p)) walk(path.join(p, name))
    else newest = Math.max(newest, st.mtimeMs)
  }
  for (const p of ['src', 'electron', 'server', 'public', 'index.html', 'vite.config.ts', 'package.json']) if (existsSync(p)) walk(p)
  return newest
}
const builtAt = (file: string) => (existsSync(file) ? statSync(file).mtimeMs : 0)

let root: string
let env: Record<string, string>
/** Close failed test instances too: surviving processes keep the library locked and block temporary-directory cleanup. */
let running: ElectronApplication | null = null
let automationExe = exe
let hardened: ReturnType<typeof spawn> | null = null
let secondInstance: ChildProcess | null = null

test.beforeAll(() => {
  const source = newestSource()
  if (packaged) {
    const res = path.join(path.dirname(exe), 'resources')
    const packedAt = builtAt(path.join(res, 'app.asar')) || builtAt(path.join(res, 'app', 'main.mjs'))
    if (packedAt < source) throw new Error(`打包好的程序比源码旧：先 npm run release -- --dir，或删掉 ${path.dirname(exe)} 改测源码`)
  } else if (builtAt('dist/index.html') < source) {
    test.setTimeout(240_000)
    execSync('npx vite build', { stdio: 'inherit' })
  }
  root = mkdtempSync(path.join(os.tmpdir(), 'pe-smoke-'))
  env = { PE_APP_DIR: path.join(root, '程序目录'), PE_LIBRARY_DIR: path.join(root, '图库'), PE_PORT: String(PORT), PE_NO_FOCUS: '1' }
})
async function cleanup() {
  // Allow graceful shutdown and the fallback to finish even after a test times out.
  test.setTimeout(90_000)
  if (secondInstance) await killTree(secondInstance)
  secondInstance = null
  if (running) {
    const app = running
    // Capture the process before closing: Playwright cannot return it after the app has closed.
    const proc = app.process()
    try {
      if (proc.exitCode === null && proc.signalCode === null) {
        // A closing inspector can reject evaluate before the OS reports process exit.
        const closed = closeWindow(app).catch(() => processExit(proc))
        try { await within(closed, 30_000, 'Test cleanup') }
        catch {
          test.info().annotations.push({ type: 'cleanup', description: 'Window shutdown did not finish; waiting for process-tree cleanup.' })
          await killTree(proc)
        }
      }
      await within(processExit(proc), 10_000, 'Test cleanup process exit')
    } finally {
      running = null
    }
  }
  if (hardened) await killTree(hardened)
  hardened = null
}

test.afterEach(cleanup)

test.afterAll(async () => {
  await cleanup()
  if (root) await rm(root, { recursive: true, force: true })
})

async function launch(): Promise<{ app: ElectronApplication; page: Page }> {
  if (packaged && automationExe === exe) {
    // Playwright needs the main-process inspector; never weaken the release binary.
    const copy = path.join(root, 'automation')
    cpSync(path.dirname(exe), copy, { recursive: true })
    automationExe = path.join(copy, path.basename(exe))
    await flipFuses(automationExe, { version: FuseVersion.V1, [FuseV1Options.EnableNodeCliInspectArguments]: true })
  }
  const app = await electron.launch({
    ...(packaged ? { executablePath: automationExe, args: [] } : { args: ['electron/main.ts'] }),
    env: { ...process.env, ...env, ...(packaged ? {} : { PE_WWW: 'dist' }) } as Record<string, string>,
  })
  running = app
  const page = await app.firstWindow()
  await page.route('https://*.novelai.net/**', (r) => r.fulfill({ status: 401, body: '{}' }))
  await page.waitForSelector('[data-testid="status-bar"]')
  return { app, page }
}

/** Bound non-Playwright waits so failures identify the stalled step instead of timing out the whole test. */
function within<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: NodeJS.Timeout
  return Promise.race([p, new Promise<never>((_, no) => (timer = setTimeout(() => no(new Error(`${what}：${ms / 1000} 秒没等到`)), ms)))]).finally(() => clearTimeout(timer))
}

function processExit(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve()
  return new Promise((resolve, reject) => {
    const onExit = () => { child.off('error', onError); resolve() }
    const onError = (error: Error) => { child.off('exit', onExit); reject(error) }
    child.once('exit', onExit)
    child.once('error', onError)
  })
}

async function killTree(child: ChildProcess) {
  if (child.pid === undefined || child.exitCode !== null || child.signalCode !== null) return
  const exited = processExit(child)
  // Wait for taskkill's entire tree operation and the parent's exit before removing its files.
  try {
    execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, timeout: 10_000, stdio: 'pipe' })
  } catch (error) {
    // It may have exited between the liveness check and taskkill; verify that race.
    await within(exited, 10_000, 'Process tree cleanup').catch(() => { throw error })
    return
  }
  await within(exited, 10_000, 'Process tree cleanup')
}

async function closeWindow(app: ElectronApplication) {
  const exited = processExit(app.process())
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close())
  await within(exited, 30_000, '关窗口后进程退出')
  if (running === app) running = null
}

async function corner(app: ElectronApplication, page: Page) {
  const b64 = await app.evaluate(async ({ desktopCapturer, BrowserWindow, screen }) => {
    const w = BrowserWindow.getAllWindows()[0]
    const { width, height } = w.getBounds()
    const s = screen.getDisplayMatching(w.getBounds()).scaleFactor
    for (let attempt = 0; attempt < 5; attempt++) {
      const srcs = await desktopCapturer.getSources({ types: ['window'], thumbnailSize: { width: Math.round(width * s), height: Math.round(height * s) } })
      const source = srcs.find((x) => x.id === w.getMediaSourceId())
      if (source && !source.thumbnail.isEmpty()) return source.thumbnail.toPNG().toString('base64')
      if (attempt < 4) await new Promise((r) => setTimeout(r, 250))
    }
    throw new Error('Window thumbnail unavailable after 5 attempts')
  })
  return page.evaluate(async (b64) => {
    const img = new Image()
    img.src = `data:image/png;base64,${b64}`
    await img.decode()
    const s = img.width / window.innerWidth
    const c = document.createElement('canvas')
    c.width = Math.round(138 * s)
    c.height = Math.round(36 * s)
    const ctx = c.getContext('2d')!
    ctx.drawImage(img, img.width - c.width, 0, c.width, c.height, 0, 0, c.width, c.height)
    const d = ctx.getImageData(0, 0, c.width, c.height).data
    const lum: number[] = []
    for (let i = 0; i < d.length; i += 4) lum.push((0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) / 255)
    const bg = [...lum].sort((a, b) => a - b)[lum.length >> 1]
    const far = lum.reduce((m, l) => (Math.abs(l - bg) > Math.abs(m - bg) ? l : m), bg)
    return { bg, glyph: far }
  }, b64)
}

const isDark = (page: Page) => page.evaluate(() => document.documentElement.classList.contains('dark'))

test('Packaged app starts with all three fuses disabled', async () => {
  test.skip(!packaged, 'Requires a packaged app')
  const wire = await getCurrentFuseWire(exe)
  for (const fuse of [FuseV1Options.RunAsNode, FuseV1Options.EnableNodeOptionsEnvironmentVariable, FuseV1Options.EnableNodeCliInspectArguments]) expect(wire[fuse]).toBe(FuseState.DISABLE)
  hardened = spawn(exe, [], {
    env: { ...process.env, PE_APP_DIR: path.join(root, 'hardened-app'), PE_LIBRARY_DIR: path.join(root, 'hardened-library'), PE_PORT: String(PORT + 2), PE_NO_FOCUS: '1' },
    stdio: 'ignore',
  })
  await expect.poll(async () => {
    try { return (await fetch(`http://127.0.0.1:${PORT + 2}/api/bootstrap`)).status } catch { return 0 }
  }).toBe(200)
  expect(await (await fetch(`http://127.0.0.1:${PORT + 2}/`)).text()).toContain('<html')
  expect(hardened.exitCode).toBeNull()
})

test('Renderer permissions allow clipboard and deny unused capabilities', async () => {
  const { page } = await launch()
  const permissions = await page.evaluate(async () => {
    const names = ['clipboard-read', 'clipboard-write', 'camera', 'microphone', 'geolocation', 'notifications']
    return Promise.all(names.map(async (name) => [name, (await navigator.permissions.query({ name: name as PermissionName })).state]))
  })
  expect(Object.fromEntries(permissions)).toEqual({
    'clipboard-read': 'granted', 'clipboard-write': 'granted', camera: 'denied', microphone: 'denied', geolocation: 'denied', notifications: 'denied',
  })
})

test('打开 → 无边框 + 窗口按钮 + 拖动区 → 主题跟着换 → token、API Key 加密存 → 图库被占着 → 关掉', async () => {
  test.setTimeout(180_000)
  let { app, page } = await launch()
  expect(await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; return [w.isVisible(), w.isFocused()] })).toEqual([true, false])

  expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getTitle())).toBe(APP_NAME)
  const wco = await page.evaluate(() => ({ visible: navigator.windowControlsOverlay?.visible, rect: navigator.windowControlsOverlay?.getTitlebarAreaRect().toJSON(), w: innerWidth }))
  expect(wco.visible).toBe(true)
  const controlsW = wco.w - wco.rect.x - wco.rect.width
  expect(controlsW).toBeGreaterThan(100)
  expect(wco.rect.height).toBe(36)

  const region = (sel: string) => page.locator(sel).first().evaluate((e) => getComputedStyle(e).getPropertyValue('-webkit-app-region') || getComputedStyle(e).getPropertyValue('app-region'))
  expect(await region('[data-testid="tab-row"]')).toBe('drag')
  expect(await region('[data-testid="new-tab"]')).toBe('no-drag')
  expect(await region('[data-testid="tab"]')).toBe('no-drag')
  const allTabs = await page.getByTestId('all-tabs').boundingBox()
  expect(allTabs!.x + allTabs!.width).toBeLessThanOrEqual(wco.w - controlsW + 1)

  if (await isDark(page)) await page.getByTestId('theme-toggle').click()
  await page.waitForTimeout(500)
  const light = await corner(app, page)
  expect(light.bg).toBeGreaterThan(0.8)
  expect(light.glyph).toBeLessThan(light.bg - 0.3)
  await page.getByTestId('theme-toggle').click()
  await page.waitForTimeout(500)
  expect(await isDark(page)).toBe(true)
  const dark = await corner(app, page)
  expect(dark.bg).toBeLessThan(0.2)
  expect(dark.glyph).toBeGreaterThan(dark.bg + 0.3)

  const tokenFile = path.join(env.PE_APP_DIR, 'nai-token.bin')
  const decrypt = () => app.evaluate(({ safeStorage }, b64) => safeStorage.decryptString(Buffer.from(b64, 'base64')), readFileSync(tokenFile).toString('base64'))
  await page.evaluate(() => (location.hash = '/settings'))
  await page.getByTestId('set-token').fill('pst-smoke-123456')
  await page.getByTestId('set-token').press('Enter')
  await expect.poll(() => existsSync(tokenFile)).toBe(true)
  expect(readFileSync(tokenFile).toString('latin1')).not.toContain('pst-smoke')
  expect(await decrypt()).toBe('pst-smoke-123456')
  await expect.poll(() => page.evaluate(() => localStorage.getItem('pe:nai') ?? '')).toContain('"token":""')
  // Wait for the subscription failure to rewrite pe:nai before injecting the migration fixture, or it can overwrite the fixture.
  await expect(page.getByTestId('token-status')).toHaveAttribute('data-state', 'error')

  await page.evaluate(() => localStorage.setItem('pe:nai', JSON.stringify({ state: { token: 'pst-old-999', stream: false }, version: 1 })))
  await page.reload()
  await page.waitForSelector('[data-testid="status-bar"]')
  await expect.poll(decrypt).toBe('pst-old-999')
  const kept = JSON.parse((await page.evaluate(() => localStorage.getItem('pe:nai')))!)
  expect(kept.state).toMatchObject({ token: '', stream: false })

  // An unused loopback endpoint keeps model discovery from contacting external services.
  const aiKeyFile = path.join(env.PE_APP_DIR, 'ai-keys.bin')
  const decryptAi = () => app.evaluate(({ safeStorage }, b64) => safeStorage.decryptString(Buffer.from(b64, 'base64')), readFileSync(aiKeyFile).toString('base64'))
  await page.evaluate(() => (location.hash = '/settings'))
  await page.getByTestId('settings-nav-ai').click()
  await page.getByTestId('ai-add-service').click()
  await page.getByTestId('ai-service-preset').click()
  await page.getByRole('option', { name: '自定义' }).click()
  await page.getByTestId('ai-service-url').fill('http://127.0.0.1:9/v1')
  await page.getByTestId('ai-service-url').press('Enter')
  await page.getByTestId('ai-service-key').fill('sk-smoke-ai-123')
  await page.getByTestId('ai-service-key').press('Enter')
  await expect.poll(() => existsSync(aiKeyFile)).toBe(true)
  expect(readFileSync(aiKeyFile).toString('latin1')).not.toContain('sk-smoke')
  expect(Object.values(JSON.parse(await decryptAi()))).toEqual(['sk-smoke-ai-123'])
  await expect.poll(() => page.evaluate(() => localStorage.getItem('pe:ai') ?? '')).toContain('"key":""')
  expect(await page.evaluate(() => localStorage.getItem('pe:ai'))).not.toContain('sk-smoke')
  await expect(page.getByTestId('ai-service-status')).toHaveText('无法连接：网络错误')

  const other = await backend()
  const busy = await fetch(`http://127.0.0.1:${PORT + 1}/api/bootstrap`)
  expect(busy.status).toBe(503)
  expect((await busy.json()).code).toBe('LIBRARY_LOCKED')
  await other.stop()

  const picked = path.join(root, '换的图库')
  await app.evaluate(({ dialog }, p) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [p] })) as typeof dialog.showOpenDialog
  }, picked)
  await page.getByTestId('settings-nav-library').click()
  await page.getByTestId('library-change').click()
  await expect(page.getByTestId('library-input')).toHaveValue(picked)
  await page.getByTestId('library-cancel').click()

  await closeWindow(app)
  ;({ app, page } = await launch())
  const first = await within(app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0]
    // Electron bitmap pixels are BGRA, four bytes per pixel.
    const shot = () =>
      w.webContents.capturePage().then((img) => {
        const b = img.resize({ width: 40 }).toBitmap()
        let sum = 0
        for (let i = 0; i < b.length; i += 4) sum += (b[i] + b[i + 1] + b[i + 2]) / 3
        return sum / (b.length / 4)
      })
    return w.isVisible() ? shot() : new Promise<number>((r) => w.once('show', () => void shot().then(r)))
  }), 15_000, '窗口显示后的第一帧')
  expect(first).toBeLessThan(60)
  await page.evaluate(() => (location.hash = '/settings'))
  await expect(page.getByTestId('set-token')).toHaveValue('pst-old-999')
  await page.getByTestId('settings-nav-ai').click()
  await page.getByTestId('ai-service-head').click()
  await expect(page.getByTestId('ai-service-key')).toHaveValue('sk-smoke-ai-123')
  await closeWindow(app)

  const after = await backend()
  expect((await fetch(`http://127.0.0.1:${PORT + 1}/api/bootstrap`)).status).toBe(200)
  await after.stop()
})

// Native drag requires a physical mouse gesture; record startDrag arguments so the remaining path can run under automation.
test('拖到窗口外：主进程写临时文件 + startDrag 收到对的文件；拖着的时候拖回窗口不导入；关掉清空', async () => {
  test.setTimeout(120_000)
  const { app, page } = await launch()
  await app.evaluate(({ ipcMain }) => {
    const g = globalThis as { __drags?: unknown[] }
    g.__drags = []
    // Patch the WebContents prototype because IPC sender wrappers may differ between events.
    ipcMain.prependListener('pe:drag-start', (e) => {
      const proto = Object.getPrototypeOf(e.sender) as { startDrag: (item: { file: string; files?: string[]; icon: Electron.NativeImage }) => void }
      proto.startDrag = (item) => void g.__drags!.push({ file: item.file, files: item.files, icon: item.icon.getSize(), empty: item.icon.isEmpty() })
    })
  })
  const drags = () => app.evaluate(() => (globalThis as { __drags?: { file: string; files?: string[]; icon: { width: number; height: number }; empty: boolean }[] }).__drags!)

  await page.evaluate(() => (location.hash = '/gallery'))
  await page.getByTestId('gallery-view-button').click()
  await page.getByTestId('gallery-stack-switch').click()
  await page.getByTestId('gallery-view-button').click()
  // The grid ignores Ctrl+A while overlayOpen is true; wait for the popover's exit animation.
  await expect(page.getByTestId('gallery-view-pop')).toHaveCount(0)
  await page.evaluate(async () => {
    const crcTable = Array.from({ length: 256 }, (_, n) => {
      let c = n
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      return c >>> 0
    })
    const crc = (d: Uint8Array) => {
      let c = 0xffffffff
      for (const b of d) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8)
      return (c ^ 0xffffffff) >>> 0
    }
    const text = (key: string, value: string) => {
      const data = new TextEncoder().encode(`${key}\0${value}`)
      const out = new Uint8Array(12 + data.length)
      const v = new DataView(out.buffer)
      v.setUint32(0, data.length)
      out.set(new TextEncoder().encode('tEXt'), 4)
      out.set(data, 8)
      v.setUint32(8 + data.length, crc(out.subarray(4, 8 + data.length)))
      return out
    }
    const make = async (seed: number, hue: number) => {
      const c = document.createElement('canvas')
      c.width = 256
      c.height = 384
      const g = c.getContext('2d')!
      g.fillStyle = `hsl(${hue} 60% 55%)`
      g.fillRect(0, 0, 256, 384)
      const png = new Uint8Array(await (await new Promise<Blob>((r) => c.toBlob((b) => r(b!), 'image/png'))).arrayBuffer())
      const comment = JSON.stringify({ prompt: '1girl, smoke drag', uc: 'lowres', seed, width: 256, height: 384, steps: 28, scale: 5, sampler: 'k_euler_ancestral', n_samples: 1 })
      const parts = [png.subarray(0, 33), text('Software', 'NovelAI'), text('Source', 'NovelAI Diffusion V4.5 4BDE2A90'), text('Comment', comment), png.subarray(33)]
      return new File(parts, `smoke-${seed}.png`, { type: 'image/png' })
    }
    const dt = new DataTransfer()
    dt.items.add(await make(111, 20))
    dt.items.add(await make(222, 200))
    const fire = (type: string) => window.dispatchEvent(new DragEvent(type, { dataTransfer: dt, bubbles: true, cancelable: true }))
    fire('dragenter')
    fire('dragover')
    fire('drop')
  })
  const cells = page.getByTestId('gallery-cell')
  await expect(cells).toHaveCount(2)
  await expect(cells.first()).toHaveAttribute('draggable', 'true')
  const dragStart = (i: number) => cells.nth(i).evaluate((el) => el.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: new DataTransfer() })))

  await cells.first().click()
  await dragStart(0)
  await expect.poll(async () => (await drags()).length).toBe(1)
  const one = (await drags())[0]
  const dragDir = path.join(env.PE_APP_DIR, 'drag')
  expect(one.files).toHaveLength(1)
  expect(path.relative(dragDir, one.file).startsWith('..')).toBe(false)
  expect(path.basename(one.file)).toMatch(/^1girl, smoke drag s-(111|222)\.png$/)
  const bytes = readFileSync(one.file)
  expect(bytes.subarray(1, 4).toString('latin1')).toBe('PNG')
  expect(bytes.toString('latin1')).toContain('NovelAI Diffusion V4.5')
  expect(one.empty).toBe(false)
  expect(Math.max(one.icon.width, one.icon.height)).toBe(128)

  await page.keyboard.press('Control+a')
  await dragStart(1)
  await expect.poll(async () => (await drags()).length).toBe(2)
  const two = (await drags())[1]
  expect(two.files).toHaveLength(2)
  expect(new Set(two.files!.map((f) => path.basename(f))).size).toBe(2)
  expect(two.files!.every((f) => existsSync(f))).toBe(true)
  expect(Math.max(two.icon.width, two.icon.height)).toBeGreaterThan(128)

  await page.waitForTimeout(200)
  const overlay = await page.evaluate(async () => {
    const dt = new DataTransfer()
    dt.items.add(new File([new Uint8Array([1])], 'x.png', { type: 'image/png' }))
    const fire = (type: string) => document.body.dispatchEvent(new DragEvent(type, { dataTransfer: dt, bubbles: true, cancelable: true }))
    fire('dragenter')
    fire('dragover')
    await new Promise((r) => setTimeout(r, 250))
    const shown = document.querySelector('[data-testid=drop-overlay]')!.hasAttribute('data-show')
    fire('dragleave')
    return shown
  })
  expect(overlay).toBe(true)

  expect(existsSync(dragDir)).toBe(true)
  await closeWindow(app)
  expect(existsSync(dragDir)).toBe(false)
})

test('输入框右键：主进程弹原生「剪切 / 复制 / 粘贴 / 全选」；应用自己的右键菜单不经过主进程', async () => {
  const { app, page } = await launch()
  // Record native context-menu events because opening the real menu blocks automation.
  const real = await app.evaluate(({ BrowserWindow, clipboard }) => {
    const wc = BrowserWindow.getAllWindows()[0].webContents
    const n = wc.listenerCount('context-menu')
    wc.removeAllListeners('context-menu')
    const seen: { editable: boolean; canPaste: boolean }[] = []
    ;(globalThis as { __cm?: typeof seen }).__cm = seen
    wc.on('context-menu', (_e, p) => seen.push({ editable: p.isEditable, canPaste: p.editFlags.canPaste }))
    clipboard.writeText('pe-native-paste')
    return n
  })
  expect(real).toBe(1)
  const seen = () => app.evaluate(() => (globalThis as { __cm?: { editable: boolean; canPaste: boolean }[] }).__cm ?? [])

  if ((await page.getByTestId('tag-input').count()) === 0) await page.getByRole('button', { name: /暂无区块/ }).first().click()
  const input = page.getByTestId('tag-input').first()
  await page.getByTestId('status-bar').click()
  await input.click({ button: 'right' })
  await expect.poll(async () => (await seen()).length).toBe(1)
  expect((await seen())[0]).toEqual({ editable: true, canPaste: true })
  await expect(page.getByRole('menu')).toHaveCount(0)
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.paste())
  await expect(input).toHaveValue('pe-native-paste')

  await page.getByTestId('tab').first().click({ button: 'right' })
  await expect(page.getByRole('menu')).toHaveCount(1)
  await page.waitForTimeout(300)
  expect((await seen()).length).toBe(1)
  await page.keyboard.press('Escape')

  await page.getByTestId('status-bar').click({ button: 'right' })
  await expect.poll(async () => (await seen()).length).toBe(2)
  expect((await seen())[1].editable).toBe(false)
  await closeWindow(app)
})

// Delay both generation and image writes to expose shutdowns that would discard an in-flight result.
test('关窗口：藏起来，等出图和写盘做完再退出；还在关时再打开 = 拿回同一个窗口', async () => {
  test.setTimeout(150_000)
  const GEN_MS = 4000
  // Backend shutdown is expected while polling; -1 means unavailable, not an empty library.
  const images = async () => {
    try {
      return ((await (await fetch(`http://127.0.0.1:${PORT}/api/images`)).json()) as unknown[]).length
    } catch {
      return -1
    }
  }
  const visible = (app: ElectronApplication) => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.isVisible() ?? false)
  let gens = 0

  async function generate(page: Page) {
    const sub = { tier: 3, active: true, expiresAt: 4102444800, trainingStepsLeft: { fixedTrainingStepsLeft: 1000, purchasedTrainingSteps: 1340 }, usage: { percent: 0, purchasedPercent: 0, timeUntilNextPercent: 0, isNegative: false } }
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' }
    // An Opus subscription makes a single image with default parameters free, avoiding the paid-generation confirmation.
    await page.route('https://image.novelai.net/user/subscription', (r) => r.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: JSON.stringify(sub) }))
    const png = await page.evaluate(async () => {
      const c = new OffscreenCanvas(64, 96)
      const g = c.getContext('2d')!
      g.fillStyle = 'hsl(200 60% 50%)'
      g.fillRect(0, 0, 64, 96)
      return [...new Uint8Array(await (await c.convertToBlob({ type: 'image/png' })).arrayBuffer())]
    })
    const body = new Packr({ useRecords: false }).pack({ event_type: 'final', samp_ix: 0, gen_id: 'g', image: Buffer.from(png) })
    const frame = Buffer.alloc(4 + body.length)
    frame.writeUInt32BE(body.length, 0)
    body.copy(frame, 4)
    await page.route('https://image.novelai.net/ai/generate-image-stream', async (r) => {
      gens++
      await new Promise((ok) => setTimeout(ok, GEN_MS))
      await r.fulfill({ status: 200, headers: cors, body: frame }).catch(() => {})
    })
    await page.route(`http://127.0.0.1:${PORT}/api/images`, async (r) => {
      if (r.request().method() === 'POST') await new Promise((ok) => setTimeout(ok, 1500))
      await r.continue().catch(() => {})
    })
    await page.evaluate(() => (location.hash = '/settings'))
    await page.getByTestId('settings-nav-account').click()
    await page.getByTestId('set-token').fill('pst-smoke-close')
    await page.getByTestId('set-token').press('Enter')
    await page.evaluate(() => (location.hash = '/'))
    await page.getByTestId('export-panel').waitFor()
    if ((await page.getByTestId('export-panel').getAttribute('data-tab')) !== 'gen') await page.getByTestId('right-tab-gen').click()
    await expect(page.getByTestId('gen-button')).toBeEnabled()
    await page.getByTestId('gen-button').click()
    // Generation is intercepted, so confirming a non-free parameter set cannot spend Anlas.
    const confirm = page.getByTestId('gen-confirm-run')
    await expect(page.locator('[data-testid="gen-button"][data-running]').or(confirm)).toBeVisible()
    if (await confirm.isVisible()) await confirm.click()
    await expect(page.getByTestId('gen-button')).toHaveAttribute('data-running', '')
  }

  let { app, page } = await launch()
  const before = await images()
  await generate(page)
  const exited = new Promise((r) => app.process().once('exit', r))
  const t0 = Date.now()
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close())
  await expect.poll(() => visible(app), { timeout: 1000 }).toBe(false)
  await new Promise((r) => setTimeout(r, 2500))
  expect(app.process().exitCode).toBeNull()
  await exited
  running = null
  expect(Date.now() - t0).toBeGreaterThan(GEN_MS)
  expect(gens).toBe(1)
  ;({ app, page } = await launch())
  expect(await images()).toBe(before + 1)

  // app.evaluate can hang after process exit; check liveness before querying the closing app.
  let quit = false
  app.process().once('exit', () => (quit = true))
  await app.evaluate(({ BrowserWindow, app, ipcMain }) => {
    const events: string[] = []
    ;(globalThis as { __closeEvents?: string[] }).__closeEvents = events
    const record = (event: string) => events.push(`${Date.now()} ${event}`)
    for (const event of ['show', 'hide', 'close', 'closed', 'minimize', 'restore'] as const)
      BrowserWindow.getAllWindows()[0].on(event, () => record(event))
    app.on('second-instance', () => record('second-instance'))
    ipcMain.on('pe:close-ready', (_e, id) => record(`close-ready ${id}`))
  })
  await generate(page)
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close())
  await expect.poll(() => visible(app), { timeout: 1000 }).toBe(false)
  // A second launch needs no inspector, so use the hardened release executable rather than the automation copy.
  secondInstance = spawn(packaged ? exe : (createRequire(import.meta.url)('electron') as string), packaged ? [] : ['electron/main.ts'], {
    env: { ...process.env, ...env, ...(packaged ? {} : { PE_WWW: 'dist' }) },
    stdio: 'ignore',
  })
  await within(processExit(secondInstance), 10_000, 'Second instance exit')
  expect(secondInstance.exitCode, 'The second instance should hand off to the running app').toBe(0)
  secondInstance = null
  await expect.poll(() => visible(app), { timeout: 5000 }).toBe(true)
  await expect(page.getByTestId('gen-button')).not.toHaveAttribute('data-running', '', { timeout: GEN_MS + 5000 })
  await expect.poll(async () => (quit ? 'exited' : await images()), { timeout: 10_000 }).toBe(before + 2)
  await new Promise((r) => setTimeout(r, 1500))
  expect(quit, '重新打开后，后台那次关闭不该再把程序关掉').toBe(false)
  expect(await visible(app), JSON.stringify(await app.evaluate(() => (globalThis as { __closeEvents?: string[] }).__closeEvents))).toBe(true)
  await closeWindow(app)
})

async function backend() {
  const kid = spawn(process.execPath, ['server/main.ts'], {
    env: { ...process.env, PE_PORT: String(PORT + 1), PE_LIBRARY_DIR: env.PE_LIBRARY_DIR, PE_APP_DIR: path.join(root, '另一个程序目录') },
    stdio: 'ignore',
  })
  await expect
    .poll(async () => {
      try {
        return (await fetch(`http://127.0.0.1:${PORT + 1}/api/library`)).status
      } catch {
        return 0
      }
    })
    .toBe(200)
  return { stop: () => within(new Promise<void>((r) => (kid.once('exit', () => r()), kid.kill())), 10_000, '另一个后端退出') }
}
