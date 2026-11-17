import { chromium } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { E2E_URL, isolate, resetStore } from './store.mjs'

const theme = process.argv[2] ?? 'light'
const prefix = process.argv[3] ?? 'tpl'
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
await page.getByTestId('status-bar').waitFor()
await resetStore(page, { theme })
await page.reload()
await page.getByTestId('template-row').first().waitFor()
await page.waitForTimeout(300)

const shot = async (name, clip) => {
  await page.waitForTimeout(300)
  const file = `${out}/${prefix}-${name}-${theme}.png`
  await page.screenshot({ path: file, clip })
  console.log('shot', file)
}
const away = () => page.mouse.move(width / 2, 890)
const sideClip = async () => {
  const b = await page.getByTestId('template-body').boundingBox()
  return { x: 0, y: 0, width: b.x + b.width + 8, height: 900 }
}
const row = (scope, name) => page.getByTestId(scope).getByTestId('template-row').filter({ has: page.getByTestId('template-name').getByText(name, { exact: true }) }).first()

for (const path of ['表情', '表情/笑']) {
  const f = page.locator(`[data-testid=tpl-tree] [data-testid=template-folder][data-path="${path}"]`)
  if ((await f.getAttribute('aria-expanded')) !== 'true') await f.click()
}
await row('tpl-tree', '坏笑').click()
await away()
await shot('1-open', await sideClip())
await row('tpl-fav', '柔和逆光').click()
await away()
await shot('2-switch', await sideClip())

await page.getByTestId('template-more').click()
await shot('3-more', await sideClip())
await page.getByTestId('template-delete').click()
await page.getByTestId('confirm-ok').click()
await shot('4-deleted')
await page.getByRole('button', { name: '撤销' }).click()
await page.waitForTimeout(200)
await shot('5-undone', await sideClip())

await row('tpl-tree', '温柔微笑').hover()
await shot('6-hover', await sideClip())

const sec = page.getByTestId('section').filter({ has: page.getByTestId('section-name').getByText('场景', { exact: true }) }).first()
const b = await sec.boundingBox()
await page.mouse.click(b.x + b.width - 60, b.y + b.height - 16)
await page.waitForTimeout(200)
await page.getByTestId('related-templates').getByTestId('template-row').first().click()
await away()
await shot('7-related', await sideClip())

console.log('errors', errors.length ? errors : 'none')
await browser.close()
process.exitCode = errors.length ? 1 : 0
