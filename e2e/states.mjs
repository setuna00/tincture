import { chromium } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { E2E_URL, isolate, resetStore } from './store.mjs'

const theme = process.argv[2] ?? 'light'
const prefix = process.argv[3] ?? 'state'
const out = 'e2e/shots'
mkdirSync(out, { recursive: true })

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 })
await isolate(page.context())
const errors = []
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
page.on('pageerror', (e) => errors.push(String(e)))
await page.goto(E2E_URL)
await resetStore(page, { theme })
await page.reload()
await page.waitForLoadState('networkidle')
await page.waitForTimeout(300)

const shot = async (name) => {
  await page.waitForTimeout(250)
  await page.mouse.move(2, 890)
  await page.waitForTimeout(120)
  const file = `${out}/${prefix}-${name}-${theme}.png`
  await page.screenshot({ path: file })
  console.log('shot', file)
}
const sec = (name) => page.getByTestId('section').filter({ has: page.getByTestId('section-name').getByText(name, { exact: true }) }).first()
const clipOf = async (loc, name, pad = 14) => {
  const b = await loc.boundingBox()
  const file = `${out}/${prefix}-${name}-${theme}.png`
  await page.screenshot({ path: file, clip: { x: b.x - pad, y: b.y - pad, width: b.width + pad * 2, height: b.height + pad * 2 } })
  console.log('clip', file)
}

await shot('1-none')

const q = sec('质量')
const qb = await q.boundingBox()
await page.mouse.click(qb.x + qb.width - 60, qb.y + qb.height - 16)
await shot('2-section')
await clipOf(q, '2-section-zoom')

await page.getByTestId('chip').filter({ has: page.locator('.chip-text').getByText('cherry blossoms', { exact: true }) }).first().click()
await shot('3-tag')
await clipOf(sec('场景'), '3-tag-zoom')
await page.getByTestId('chip').filter({ has: page.locator('.chip-text').getByText('high complexity', { exact: true }) }).first().click()
await clipOf(sec('质量'), '4-meta-chip-zoom')

await sec('主体').getByTestId('tag-input').evaluate((el) => {
  const dt = new DataTransfer()
  dt.setData('text', 'text, english text, Text: Hello, world!\n\nIs this ok?')
  el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }))
})
await page.getByTestId('chip').filter({ hasText: 'Hello' }).first().click()
await shot('5-text')
await clipOf(sec('主体'), '5-text-zoom')
await clipOf(page.getByTestId('export-base.prompt'), '5-text-export', 6)
await page.getByTestId('chip').filter({ hasText: 'Hello' }).first().dblclick()
await page.waitForTimeout(200)
await clipOf(sec('主体'), '5-text-edit-zoom')
await page.keyboard.press('Escape')

console.log('errors', errors.length ? errors : 'none')
await browser.close()
