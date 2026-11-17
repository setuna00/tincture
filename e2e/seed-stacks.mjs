import { chromium } from '@playwright/test'
import { seedStacks } from './gallery-stacks-seed.mjs'
import { E2E_URL, resetStore } from './store.mjs'

const theme = process.argv[2]
const browser = await chromium.launch()
const context = await browser.newContext()
await context.addInitScript(() => {
  performance.setResourceTimingBufferSize(10000)
  window.__peImport = (path) => import(performance.getEntriesByType('resource').map((e) => e.name).find((n) => new URL(n).pathname === path) ?? path)
})
const page = await context.newPage()
await page.goto(E2E_URL)
await resetStore(page, theme ? { theme } : {})
await page.reload()
await page.waitForSelector('[data-testid=app-rail]')
const { ids } = await seedStacks(page)
console.log(`已写入 ${Object.keys(ids).length} 张图：${E2E_URL}#/gallery`)
await browser.close()
