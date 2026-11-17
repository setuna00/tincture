import { chromium } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { E2E_URL, isolate, resetStore } from './store.mjs'

const theme = process.argv[2] ?? 'light'
const prefix = process.argv[3] ?? 'start'
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
await page.addStyleTag({ content: '[data-sonner-toaster]{visibility:hidden!important}' })

// Vite HMR adds ?t= to module URLs; importing the loaded URL avoids a second, uninitialized store instance.
await page.evaluate(async () => {
  const m = await import(performance.getEntriesByType('resource').map((e) => e.name).find((n) => new URL(n).pathname === '/src/store/library.ts') ?? '/src/store/library.ts')
  const s = m.useLibrary.getState()
  for (const d of s.docs.slice(0, 3).reverse()) s.pushRecent(d.title, d.doc)
})
await page.getByTestId('new-tab').click()
await page.getByTestId('start-page').waitFor()

const tag = width === 1440 ? '' : `-${width}`
const shot = async (name) => {
  await page.mouse.move(width - 2, 898)
  await page.waitForTimeout(350)
  const file = `${out}/${prefix}-${name}${tag}-${theme}.png`
  await page.screenshot({ path: file })
  console.log('shot', file)
}
const clipOf = async (loc, name, pad = 12) => {
  const b = await loc.boundingBox()
  const file = `${out}/${prefix}-${name}${tag}-${theme}.png`
  await page.screenshot({ path: file, clip: { x: b.x - pad, y: b.y - pad, width: b.width + pad * 2, height: b.height + pad * 2 } })
  console.log('clip', file)
}

await shot('1-page')
const sp = page.getByTestId('start-page')
await page.waitForTimeout(200)
await sp.screenshot({ path: `${out}/${prefix}-zoom-page${tag}-${theme}.png` })
console.log('zoom', `${out}/${prefix}-zoom-page${tag}-${theme}.png`)
await page.getByTestId('start-doc').first().hover()
await page.waitForTimeout(350)
await clipOf(page.getByTestId('start-doc').first(), 'zoom-card-hover', 24)
await page.getByTestId('start-search').fill('girl')
await page.getByTestId('start-search').press('ArrowDown')
await shot('2-search')
await page.getByTestId('start-search').fill('')
await page.evaluate(async () => {
  const m = await import(performance.getEntriesByType('resource').map((e) => e.name).find((n) => new URL(n).pathname === '/src/store/library.ts') ?? '/src/store/library.ts')
  m.useLibrary.setState({ docs: [], recent: [] })
})
await page.mouse.move(width - 2, 898)
await page.waitForTimeout(350)
await sp.screenshot({ path: `${out}/${prefix}-zoom-empty${tag}-${theme}.png` })
console.log('zoom', `${out}/${prefix}-zoom-empty${tag}-${theme}.png`)
console.log('errors', errors.length ? errors : 'none')
await browser.close()
