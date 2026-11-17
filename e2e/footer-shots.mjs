import { chromium } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { E2E_URL, isolate, resetStore } from './store.mjs'

const theme = process.argv[2] ?? 'light'
const prefix = process.argv[3] ?? 'foot'
const width = Number(process.argv[4] ?? 1440)
const out = 'e2e/shots'
mkdirSync(out, { recursive: true })

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width, height: 900 }, deviceScaleFactor: 2 })
await isolate(ctx)
const SUB = { tier: 3, active: true, expiresAt: 4102444800, trainingStepsLeft: { fixedTrainingStepsLeft: 1000, purchasedTrainingSteps: 1340 }, usage: { percent: 63, purchasedPercent: 0, timeUntilNextPercent: 4320, isNegative: false } }
await ctx.route(/novelai\.net/, (r) => (r.request().url().endsWith('/user/subscription') ? r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(SUB) }) : r.abort()))
const page = await ctx.newPage()
const errors = []
page.on('console', (m) => m.type() === 'error' && !/novelai\.net|Failed to load resource/.test(m.text()) && errors.push(m.text()))
page.on('pageerror', (e) => errors.push(String(e)))
await page.goto(E2E_URL)
await resetStore(page, { theme, nai: { state: { token: 'pst-test' }, version: 1 } })
await page.reload()
await page.waitForSelector('[data-testid=gen-footer]', { timeout: 60000 })
await page.waitForSelector('[data-testid=account-status][data-state=ok]')
await page.addStyleTag({ content: '[data-sonner-toaster]{visibility:hidden!important}' })
await page.waitForTimeout(500)

const clip = async (loc, name, pad = 0) => {
  await page.mouse.move(2, 600)
  await page.waitForTimeout(300)
  const b = await loc.boundingBox()
  const file = `${out}/${prefix}-${name}-${theme}-${width}.png`
  await page.screenshot({ path: file, clip: { x: b.x - pad, y: b.y - pad, width: b.width + pad * 2, height: b.height + pad * 2 } })
  console.log('clip', file)
}

await clip(page.getByTestId('gen-footer'), 'gen-footer')
await clip(page.locator('header:has([data-testid=doc-title])'), 'title-row', 6)
if (await page.getByTestId('cleanup-button').count()) {
  await page.getByTestId('cleanup-button').click()
  await page.waitForSelector('[data-testid=cleanup-menu]')
  await page.waitForTimeout(250)
  const b = await page.getByTestId('cleanup-button').boundingBox()
  const m = await page.getByTestId('cleanup-menu').boundingBox()
  const x = Math.min(b.x, m.x) - 8
  const file = `${out}/${prefix}-cleanup-menu-${theme}-${width}.png`
  await page.screenshot({ path: file, clip: { x, y: b.y - 8, width: Math.max(b.x + b.width, m.x + m.width) - x + 8, height: m.y + m.height - b.y + 16 } })
  console.log('clip', file)
  await page.keyboard.press('Escape')
}
await page.getByTestId('right-tab-copy').click()
await page.waitForTimeout(400)
await clip(page.getByTestId('copy-footer'), 'copy-footer')
const top = page.getByTestId('export-tab-en').locator('xpath=ancestor::div[contains(@class,"h-10")][1]')
if (await top.count()) await clip(top, 'copy-top')
await page.getByTestId('right-tab-gen').click()
await page.waitForTimeout(300)
await page.setViewportSize({ width: 1100, height: 900 })
await page.waitForTimeout(500)
await clip(page.getByTestId('gen-footer'), 'gen-footer-narrow')
await clip(page.locator('header:has([data-testid=doc-title])'), 'title-row-narrow', 6)

console.log('errors', errors.length ? errors : 'none')
await browser.close()
