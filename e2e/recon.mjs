import { chromium } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { E2E_URL, isolate } from './store.mjs'

const hash = process.argv[2] ?? ''
const [w, h] = (process.argv[3] ?? '1440x900').split('x').map(Number)
const theme = process.argv[4] ?? 'dark'
const out = 'e2e/shots'
mkdirSync(out, { recursive: true })

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: w, height: h } })
await isolate(page.context())
const errors = []
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
page.on('pageerror', (e) => errors.push(String(e)))
await page.goto(`${E2E_URL}${hash}`)
await page.evaluate(async (t) => {
  ;(await window.__peImport('/src/store/storage.ts')).safeStorage.setItem('pe:prefs', JSON.stringify({ state: { ...(JSON.parse((await window.__peImport('/src/store/storage.ts')).safeStorage.getItem('pe:prefs') ?? '{}').state ?? {}), theme: t }, version: 0 }))
}, theme)
await page.reload()
await page.waitForLoadState('networkidle')
await page.waitForTimeout(300)
const name = `${out}/recon-${hash.replace(/\W/g, '') || 'editor'}-${w}-${theme}.png`
await page.screenshot({ path: name, fullPage: false })
console.log('shot', name)
console.log('errors', errors.length ? errors : 'none')
await browser.close()
