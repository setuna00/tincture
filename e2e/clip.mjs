import { chromium } from '@playwright/test'
import { E2E_URL, isolate } from './store.mjs'
const [hash, x, y, w, h, out, theme = 'dark'] = process.argv.slice(2)
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 })
await isolate(page.context())
await page.goto(`${E2E_URL}${hash ? `#/${hash}` : ""}`)
await page.evaluate(async (t) => (await window.__peImport('/src/store/storage.ts')).safeStorage.setItem('pe:prefs', JSON.stringify({ state: { theme: t }, version: 0 })), theme)
await page.reload()
await page.waitForLoadState('networkidle')
await page.waitForTimeout(300)
await page.screenshot({ path: out, clip: { x: +x, y: +y, width: +w, height: +h } })
await browser.close()
