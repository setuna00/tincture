import { chromium } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { E2E_URL, isolate, resetStore } from './store.mjs'

const theme = process.argv[2] ?? 'light'
const prefix = process.argv[3] ?? 'multi'
const width = Number(process.argv[4] ?? 1440)
const out = 'e2e/shots'
mkdirSync(out, { recursive: true })

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width, height: 900 }, deviceScaleFactor: 2 })
await isolate(page.context())
const errors = []
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
page.on('pageerror', (e) => errors.push(String(e)))
await page.goto(E2E_URL)
await resetStore(page, { theme })
await page.reload()
await page.waitForLoadState('networkidle')
await page.waitForTimeout(300)

const sec = (name) => page.getByTestId('section').filter({ has: page.getByTestId('section-name').getByText(name, { exact: true }) }).first()
const chip = (t) => page.getByTestId('chip').filter({ has: page.locator('.chip-text').getByText(t, { exact: true }) }).first()
const name = (n) => `${out}/${prefix}-${n}-${theme}${width !== 1440 ? `-${width}` : ''}.png`
const shot = async (n, { mouseAway = true } = {}) => {
  await page.waitForTimeout(250)
  if (mouseAway) {
    await page.mouse.move(2, 890)
    await page.waitForTimeout(120)
  }
  await page.screenshot({ path: name(n) })
  console.log('shot', name(n))
}
const clip = async (loc, n, pad = 14) => {
  const b = await loc.boundingBox()
  await page.screenshot({ path: name(n), clip: { x: b.x - pad, y: b.y - pad, width: b.width + pad * 2, height: b.height + pad * 2 } })
  console.log('clip', name(n))
}
const grab = async (loc) => {
  const a = await loc.boundingBox()
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2)
  await page.mouse.down()
  await page.mouse.move(a.x + a.width / 2 + 6, a.y + a.height / 2 + 1, { steps: 3 })
  await page.waitForFunction(() => !!document.documentElement.dataset.dnd)
}

const smile = await chip('smile').boundingBox()
await grab(chip('looking at viewer'))
await page.mouse.move(smile.x + smile.width * 0.15, smile.y + smile.height / 2, { steps: 6 })
await page.waitForTimeout(60)
await clip(sec('主体'), '1-live-mid', 18)
await page.waitForTimeout(250)
await clip(sec('主体'), '1-live', 18)
await page.keyboard.press('Escape')
await page.mouse.up()
await page.waitForTimeout(300)

await chip('smile').click()
await page.waitForTimeout(400) // Playwright scrolls moving targets with changing alignment; wait for expansion to settle before selecting across sections.
await chip('outdoors').click({ modifiers: ['Control'] })
await chip('light particles').click({ modifiers: ['Control'] })
await page.waitForTimeout(700)
await shot('2-multi')
await clip(page.getByTestId('assistant'), '2-multi-panel', 0)

const m = await chip('masterpiece').boundingBox()
await grab(chip('outdoors'))
await page.mouse.move(m.x + m.width * 0.75, m.y + m.height / 2, { steps: 12 })
await page.waitForTimeout(200)
await shot('3-group-drag', { mouseAway: false })
const ov = await page.getByTestId('drag-stack').boundingBox()
await page.screenshot({ path: name('3-group-drag-zoom'), clip: { x: ov.x - 40, y: ov.y - 40, width: ov.width + 80, height: ov.height + 80 } })
console.log('clip', name('3-group-drag-zoom'))
await page.keyboard.press('Escape')
await page.mouse.up()
await page.waitForTimeout(300)

await chip('smile').click({ button: 'right' })
await page.waitForTimeout(200)
const menu = await page.getByTestId('chip-menu').boundingBox()
const sb = await chip('smile').boundingBox()
await page.screenshot({
  path: name('4-group-menu'),
  clip: { x: Math.min(sb.x, menu.x) - 16, y: sb.y - 16, width: Math.max(menu.x + menu.width, sb.x + sb.width) - Math.min(sb.x, menu.x) + 32, height: menu.y + menu.height - sb.y + 32 },
})
console.log('clip', name('4-group-menu'))
await page.keyboard.press('Escape')

await page.getByTestId('multi-extract').click()
await shot('5-extracted')

console.log('errors', errors.length ? errors : 'none')
await browser.close()
