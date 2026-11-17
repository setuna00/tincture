import { chromium } from '@playwright/test'
import { mkdirSync, readdirSync, unlinkSync } from 'node:fs'
import path from 'node:path'
import { seed } from './gallery-seed.mjs'
import { E2E_URL, isolate, resetStore } from './store.mjs'

const theme = process.argv[2] ?? 'light'
const prefix = process.argv[3] ?? 'gallery-history'
const width = Number(process.argv[4] ?? 1920)
const height = width >= 1920 ? 1000 : 900
const out = 'e2e/shots'
mkdirSync(out, { recursive: true })
const url = E2E_URL

const browser = await chromium.launch()
const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 })
await isolate(context)
const SUB = { tier: 3, active: true, expiresAt: 4102444800, trainingStepsLeft: { fixedTrainingStepsLeft: 1000, purchasedTrainingSteps: 0 }, usage: { percent: 63, purchasedPercent: 0, timeUntilNextPercent: 4320, isNegative: false } }
const naiHits = []
await context.route(/novelai\.net/, (route) => {
  const u = route.request().url()
  naiHits.push(u)
  if (u.endsWith('/user/subscription')) return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(SUB) })
  return route.abort()
})
const page = await context.newPage()
const errors = []
page.on('console', (m) => m.type() === 'error' && !/novelai\.net|Failed to load resource/.test(m.text()) && errors.push(m.text()))
page.on('pageerror', (e) => errors.push(String(e)))
const fails = []
const check = (ok, msg) => (ok ? console.log('ok  ', msg) : (fails.push(msg), console.log('FAIL', msg)))
const clip = async (name) => {
  await page.mouse.move(2, height - 60)
  await page.waitForTimeout(400)
  const style = await page.addStyleTag({ content: '[data-sonner-toaster]{visibility:hidden!important}' })
  const b = await page.getByTestId('export-panel').boundingBox()
  const file = `${out}/${prefix}-${name}-${theme}-${width}.png`
  await page.screenshot({ path: file, clip: b })
  await style.evaluate((el) => el.remove())
  console.log('clip', file)
}

await page.goto(url)
await resetStore(page, { theme, prefs: { historyOpen: true, galleryStack: false }, nai: { state: { token: 'pst-test' }, version: 1 } })
await page.reload()
await page.waitForSelector('[data-testid=export-panel]')
const tab = await page.evaluate(async () => (await import('/src/store/tabs.ts')).useTabs.getState().activeId)
await seed(page, 3, { tab })
await page.reload()
await page.waitForSelector('[data-testid=history-item]')
const items = () => page.getByTestId('history-item')
check((await items().count()) === 3, `历史栏 3 张（${await items().count()}）`)
const newest = await items().last().getAttribute('data-id')
check((await page.getByTestId('gen-image').count()) === 1, '图区显示最新那张')
await clip('1-before-trash')

await page.getByTestId('page-gallery').click()
await page.waitForSelector(`[data-gid=${newest}]`)
await page.locator(`[data-gid=${newest}]`).click()
await page.keyboard.press('Delete')
await page.getByTestId('confirm-ok').click()
await page.getByTestId('page-editor').click()
await page.waitForSelector('[data-testid=history-item]')
await page.waitForTimeout(300)
const ids = await page.$$eval('[data-testid=history-item]', (els) => els.map((e) => e.dataset.id))
check(ids.length === 2 && !ids.includes(newest), `回收站里的那张不在历史栏里（${ids.length} 张）`)
check((await page.getByTestId('history-group').count()) === 1 && (await page.getByTestId('history-group').locator('[data-testid=history-item]').count()) === 2, '版本跟着变（最新那一版没有图了不显示）')
check((await page.locator('[data-testid=history-item][data-current]').count()) === 1, '当前那张换成没进回收站的')
const shown = await page.getByTestId('gen-image').getAttribute('data-seed')
const shownId = await page.locator('[data-testid=history-item][data-current]').getAttribute('data-id')
check(shownId !== newest && !!shown, `图区换成没进回收站的那张（seed ${shown}）`)
await clip('2-after-trash')

await page.locator('[data-testid=history-item][data-current]').click()
await page.keyboard.press('Delete')
await page.waitForTimeout(200)
const left = await page.evaluate(async (id) => (await (await window.__peImport('/src/store/storage.ts')).imageStore.list()).some((x) => x.id === id), newest)
check(left, '历史栏 Del 不会删到回收站里的那张')
check((await items().count()) === 1, `历史栏 Del 删的是当前那张（剩 ${await items().count()}）`)

await page.getByTestId('page-gallery').click()
await page.locator('[data-scope=trash]').click()
await page.locator(`[data-gid=${newest}]`).click()
await page.getByTestId('gallery-restore').click()
await page.getByTestId('page-editor').click()
await page.waitForSelector('[data-testid=history-item]')
await page.waitForTimeout(300)
check((await items().count()) === 2, `恢复后回到历史栏（${await items().count()}）`)

const lostId = await items().last().getAttribute('data-id')
const libDir = await page.evaluate(async () => (await (await fetch('/api/bootstrap')).json()).dir)
const imgDir = path.join(libDir, 'images')
for (const m of readdirSync(imgDir)) for (const f of readdirSync(path.join(imgDir, m))) if (f.startsWith(lostId)) unlinkSync(path.join(imgDir, m, f))
await page.reload()
await page.waitForSelector('[data-testid=history-item]')
await page.waitForTimeout(500)
const lost = page.locator(`[data-testid=history-item][data-id="${lostId}"]`)
check((await lost.getAttribute('data-missing')) === '' && (await lost.getByTestId('history-lost').count()) === 1 && (await page.locator('[data-testid=history-item][data-missing]').count()) === 1, '历史横条：文件丢了的那一格灰底 + 图标（别的照常）')
await lost.click()
await page.waitForTimeout(300)
check((await page.getByTestId('gen-viewer').getByTestId('gallery-missing').count()) === 1 && (await page.getByTestId('gen-image').count()) === 0, '图区写「图片文件已丢失」')
check((await page.getByTestId('gen-copy').isDisabled()) && (await page.getByTestId('gen-download').isDisabled()) && (await page.getByTestId('tool-upscale').isDisabled()) && (await page.getByTestId('tool-more').isDisabled()), '复制 / 另存为 / 放大 / 更多 不能点')
await clip('2b-missing')

await page.getByTestId('page-gallery').click()
await page.locator('[data-scope=all]').click()
await page.waitForSelector('[data-testid=gallery-grid] :is([data-testid=gallery-cell], [data-testid=gallery-stack])')
await page.keyboard.press('Control+a')
await page.keyboard.press('Delete')
await page.getByTestId('confirm-ok').click()
await page.getByTestId('page-editor').click()
await page.waitForFunction(() => document.querySelectorAll('[data-testid=history-item]').length === 0 && !!document.querySelector('[data-testid=history-group-next]'))
check((await page.getByTestId('gen-empty').count()) === 1, '都进了回收站：图区是生成前的框')
await clip('3-all-trashed')

check(naiHits.every((u) => u.endsWith('/user/subscription')), '只取了订阅（假数据），没出图')
console.log(errors.length ? `console 报错：\n${errors.join('\n')}` : 'console 无报错')
console.log(fails.length ? `\n${fails.length} 项失败：\n${fails.join('\n')}` : '\n全部通过')
await browser.close()
process.exit(fails.length || errors.length ? 1 : 0)
