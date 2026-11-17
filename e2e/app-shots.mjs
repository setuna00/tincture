import { _electron as electron } from '@playwright/test'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { routeDanbooru } from './danbooru-mock.mjs'
import { resetStore } from './store.mjs'

const theme = process.argv[2] ?? 'light'
const prefix = process.argv[3] ?? 'app'
const out = 'e2e/shots'
mkdirSync(out, { recursive: true })

const root = mkdtempSync(path.join(os.tmpdir(), 'pe-app-shots-'))
const exe = process.env.EXE
const app = await electron.launch({
  ...(exe ? { executablePath: exe, args: [] } : { args: ['electron/main.ts'] }),
  env: { ...process.env, PE_TEST: '1', PE_NO_FOCUS: '1', PE_APP_DIR: path.join(root, 'app'), PE_LIBRARY_DIR: path.join(root, 'library'), PE_PORT: process.env.PE_PORT ?? '4562', ...(exe ? {} : { PE_WWW: 'dist' }) },
})
const page = await app.firstWindow()
const errors = []
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
page.on('pageerror', (e) => errors.push(String(e)))
await routeDanbooru(page)
await app.evaluate(({ BrowserWindow }, width) => {
  const w = BrowserWindow.getAllWindows()[0]
  w.unmaximize()
  w.setContentSize(width, 900)
}, Number(process.env.W ?? 1440))
await page.waitForSelector('[data-testid="status-bar"]')
await resetStore(page, { theme })
await page.reload()
await page.waitForSelector('[data-testid="status-bar"]')
errors.length = 0

async function capture() {
  const b64 = await app.evaluate(async ({ desktopCapturer, BrowserWindow, screen }) => {
    const w = BrowserWindow.getAllWindows()[0]
    const { width, height } = w.getBounds()
    const scale = screen.getDisplayMatching(w.getBounds()).scaleFactor
    const srcs = await desktopCapturer.getSources({ types: ['window'], thumbnailSize: { width: Math.round(width * scale), height: Math.round(height * scale) } })
    return srcs.find((s) => s.id === w.getMediaSourceId())?.thumbnail.toPNG().toString('base64') ?? null
  })
  if (!b64) throw new Error('拍不到窗口')
  return Buffer.from(b64, 'base64')
}

const shot = async (name) => {
  await page.mouse.move(700, 600)
  await page.waitForTimeout(450)
  const png = await capture()
  const file = `${out}/${prefix}-${name}-${theme}.png`
  writeFileSync(file, png)
  const corner = await page.evaluate(async (b64) => {
    const img = new Image()
    img.src = `data:image/png;base64,${b64}`
    await img.decode()
    const s = img.width / window.innerWidth
    const c = document.createElement('canvas')
    c.width = Math.round(760 * s)
    c.height = Math.round(120 * s)
    c.getContext('2d').drawImage(img, img.width - c.width, 0, c.width, c.height, 0, 0, c.width, c.height)
    return c.toDataURL('image/png').slice(22)
  }, png.toString('base64'))
  writeFileSync(`${out}/${prefix}-${name}-corner-${theme}.png`, Buffer.from(corner, 'base64'))
  console.log('shot', file)
}
const go = async (hash) => {
  await page.evaluate((h) => (location.hash = h), hash)
  await page.waitForTimeout(400)
}
const setPrefs = (patch) => page.evaluate(async (patch) => {
  // Packaged builds have no source-module URLs to import, so seed preferences through storage before reloading.
  const r = await fetch('/api/kv/pe%3Aprefs')
  const cur = r.ok ? JSON.parse((await r.json()).value) : { state: {}, version: 0 }
  Object.assign(cur.state, patch)
  const boot = await (await fetch('/api/bootstrap')).json()
  await fetch('/api/kv', { method: 'PUT', headers: { 'content-type': 'application/json', 'x-pe-library': boot.libraryId }, body: JSON.stringify({ set: { 'pe:prefs': JSON.stringify(cur) }, del: [] }) })
}, patch)

await shot('editor')
await page.getByTestId('new-tab').click()
await page.waitForTimeout(300)
await shot('start')
await go('/gallery')
await shot('gallery')
await go('/discover')
await shot('discover')
await go('/gacha')
await shot('gacha')
await go('/artists')
await page.waitForTimeout(800)
await shot('artists')
await page.getByTestId('artist-card').first().waitFor()
await page.mouse.move(700, 500)
await page.mouse.wheel(0, 900)
await shot('artists-scrolled')
await page.getByTestId('artist-card').first().click()
await page.waitForTimeout(400)
await shot('artists-detail')
const thumb = page.locator('[data-testid="artist-detail"] button.cursor-zoom-in, [data-testid="artists-page"] button.cursor-zoom-in').first()
if (await thumb.count()) {
  await thumb.click()
  await page.waitForTimeout(500)
  await shot('artists-lightbox')
  await page.keyboard.press('Escape')
}
await go('/library')
await shot('library')
await go('/playground')
await shot('playground')
await go('/settings')
await shot('settings')
await page.mouse.move(900, 500)
await page.mouse.wheel(0, 700)
await shot('settings-scrolled')

await setPrefs({ assistOpen: false, exportOpen: false, galleryLeftOpen: false, galleryRightOpen: false })
await page.reload()
await page.waitForSelector('[data-testid="status-bar"]')
await go('/')
await page.getByRole('tab').first().click().catch(() => {})
await shot('editor-collapsed')
await go('/gallery')
await shot('gallery-collapsed')

console.log(errors.length ? `console 报错 ${errors.length} 条：\n${errors.join('\n')}` : 'console 无报错')
await app.close()
