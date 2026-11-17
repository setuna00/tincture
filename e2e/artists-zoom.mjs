import { chromium } from '@playwright/test'
import { routeDanbooru } from './danbooru-mock.mjs'
import { E2E_URL, isolate, resetStore } from './store.mjs'
const theme = process.argv[2] ?? 'light'
const prefix = process.argv[3] ?? 'artists'
const base = E2E_URL
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 })
await isolate(page.context())
await routeDanbooru(page)
await page.goto(base)
await resetStore(page, { kv: { 'pe:prefs': { state: { theme: theme }, version: 3 } } })
await page.goto(base + '#/artists')
await page.reload()
await page.getByTestId('artist-card').first().waitFor()
await page.waitForLoadState('networkidle')
await page.waitForTimeout(800)
const first = await page.getByTestId('artist-card').first().boundingBox()
const header = await page.locator('[data-testid="artists-page"] header').boundingBox()
await page.screenshot({ path: `e2e/shots/${prefix}-zoom-grid-${theme}.png`, clip: { x: header.x - 16, y: header.y - 12, width: header.width + 32, height: first.y - header.y + first.height * 2 + 60 } })
await page.getByTestId('artist-card').nth(1).click()
await page.getByTestId('artist-detail').waitFor()
await page.waitForTimeout(900)
const d = await page.getByTestId('artist-detail').boundingBox()
await page.screenshot({ path: `e2e/shots/${prefix}-zoom-detail-${theme}.png`, clip: { x: d.x, y: d.y, width: d.width, height: Math.min(d.height, 900) } })
console.log('ok', prefix, theme)
await browser.close()
