import { chromium } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { E2E_URL, isolate, resetStore } from './store.mjs'

const theme = process.argv[2] ?? 'light'
const prefix = process.argv[3] ?? 'rs'
const out = 'e2e/shots'
mkdirSync(out, { recursive: true })

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1920, height: 1000 }, deviceScaleFactor: 1 })
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
await page.waitForTimeout(600)

const width = () => page.getByTestId('export-panel').evaluate((e) => Math.round(e.getBoundingClientRect().width))
const shot = async (name) => {
  await page.mouse.move(400, 980)
  await page.waitForTimeout(400)
  const file = `${out}/${prefix}-${name}-${theme}.png`
  await page.screenshot({ path: file })
  console.log('shot', file, 'right', await width())
}
const sep = page.getByTestId('right-resize')
const drag = async (dx) => {
  const b = await sep.boundingBox()
  await page.mouse.move(b.x + b.width / 2, b.y + 300)
  await page.mouse.down()
  await page.mouse.move(b.x + b.width / 2 + dx, b.y + 300, { steps: 8 })
  await page.mouse.up()
  await page.waitForTimeout(300)
}

await shot('default')
if (await sep.count()) {
  await drag(800)
  await shot('min')
  await drag(-1600)
  await shot('max')
  const b = await sep.boundingBox()
  await page.mouse.move(b.x + b.width / 2, b.y + 300)
  await page.waitForTimeout(300)
  await page.screenshot({ path: `${out}/${prefix}-hover-${theme}.png`, clip: { x: b.x - 60, y: b.y + 200, width: 120, height: 200 } })
  console.log('clip', `${out}/${prefix}-hover-${theme}.png`)
  await sep.dblclick({ position: { x: b.width / 2, y: 300 } })
  await page.waitForTimeout(400)
  await shot('dblclick-default')
}
await page.getByTestId('right-tab-copy').click()
await page.waitForTimeout(400)
await shot('copy')
await page.getByTestId('right-tab-gen').click()
await page.setViewportSize({ width: 1100, height: 1000 })
await page.waitForTimeout(500)
await shot('1100')

console.log('errors', errors.length ? errors : 'none')
await browser.close()
