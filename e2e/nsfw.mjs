import { chromium } from '@playwright/test'
import { openParams, toTab } from './right-panel.mjs'
import { mkdirSync } from 'node:fs'
import { E2E_URL, isolate, resetStore } from './store.mjs'

const theme = process.argv[2] ?? 'light'
const prefix = process.argv[3] ?? 'r51'
const W = Number(process.argv[4] ?? 1440)
const H = 900
const out = 'e2e/shots'
mkdirSync(out, { recursive: true })

const browser = await chromium.launch()
const context = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 2 })
await isolate(context)
await context.grantPermissions(['clipboard-read', 'clipboard-write'])
const page = await context.newPage()
const errors = []
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
page.on('pageerror', (e) => errors.push(String(e)))
await page.goto(E2E_URL)
await resetStore(page, { kv: { 'pe:prefs': { state: { theme }, version: 0 } } })
await page.reload()
await page.getByTestId('chip').first().waitFor()
await openParams(page)
await page.addStyleTag({ content: '[data-sonner-toaster]{visibility:hidden}' })
await page.waitForTimeout(300)

let fails = 0
const check = (ok, what) => {
  if (!ok) fails++
  console.log(ok ? '  ✓' : '  ✗', what)
}
const suffix = `${theme}${W === 1440 ? '' : `-${W}`}`
const clip = async (loc, name, pad = 8, loc2) => {
  await page.waitForTimeout(300)
  let b = await loc.boundingBox()
  if (loc2) {
    const b2 = await loc2.boundingBox()
    b = { x: Math.min(b.x, b2.x), y: b.y, width: Math.max(b.x + b.width, b2.x + b2.width) - Math.min(b.x, b2.x), height: b2.y + b2.height - b.y }
  }
  const file = `${out}/${prefix}-${name}-${suffix}.png`
  await page.screenshot({ path: file, clip: { x: Math.max(0, b.x - pad), y: Math.max(0, b.y - pad), width: b.width + pad * 2, height: b.height + pad * 2 } })
  console.log('clip', file)
}
const away = async () => {
  await page.mouse.move(2, H - 4, { steps: 4 })
  await page.waitForTimeout(350)
}
const hover = async (loc) => {
  const b = await loc.first().evaluate((e) => e.getClientRects()[0].toJSON())
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 6 })
  await page.waitForTimeout(700)
}
const toPage = async (p) => {
  if (p === 'settings') await openParams(page)
  else await toTab(page, 'copy')
  await page.waitForTimeout(300)
}
const row = (key) => page.locator(`[data-testid="export-${key}"]`)
const text = (key) => row(key).getByTestId('export-text').textContent()
const count = async (key) => Number((await row(key).getByTestId('token-count').textContent()).replace(/\D/g, '')) || null
const ready = () =>
  page.waitForFunction(() => {
    const els = [...document.querySelectorAll('[data-testid=token-count]')]
    return els.length > 0 && els.every((e) => /^\d/.test(e.textContent))
  }, null, { timeout: 20_000 })
const sw = () => page.getByTestId('doc-nsfw')
const checked = async () => (await sw().getAttribute('aria-checked')) === 'true'
const shown = async () => (await page.getByTestId('doc-nsfw-row').getAttribute('data-open')) === ''
const sec = (name) => page.getByTestId('section').filter({ has: page.getByTestId('section-name').getByText(name, { exact: true }) }).first()
const chip = (t) => page.getByTestId('chip').filter({ has: page.locator('.chip-text').getByText(t, { exact: true }) })
const statusBar = () => page.mouse.click(W / 2, H - 10)
const docSettings = () =>
  page.evaluate(async () => {
    const tabs = JSON.parse((await window.__peImport('/src/store/storage.ts')).safeStorage.getItem('pe:tabs')).state
    return JSON.parse((await window.__peImport('/src/store/storage.ts')).safeStorage.getItem(`pe:doc:${tabs.activeId}`)).settings
  })
const globalNsfw = async (on) => {
  await page.getByTestId('rail-settings').click()
  await page.getByTestId('settings-nav-content').click()
  const g = page.getByTestId('set-nsfw')
  await g.waitFor()
  if (((await g.getAttribute('aria-checked')) === 'true') !== on) await g.click()
  await page.getByTestId('page-editor').click()
  await page.getByTestId('chip').first().waitFor()
  await page.waitForTimeout(300)
}

await page.getByTestId('settings-model').waitFor()
check(!(await shown()) && (await page.getByTestId('doc-nsfw-row').evaluate((e) => e.getBoundingClientRect().height)) === 0, '「显示 NSFW 内容」关着：模型卡里没有 NSFW 开关（收起，高 0）')
await globalNsfw(true)
await toPage('settings')
check((await shown()) && !(await checked()), '打开「显示 NSFW 内容」：有 NSFW 开关，默认关')
{
  const at = await page.getByTestId('doc-nsfw-row').evaluate((e) => ({ card: e.closest('[data-testid^=settings-]')?.dataset.testid, prev: e.previousElementSibling?.textContent.trim().slice(0, 2), line: getComputedStyle(e.querySelector('div > div')).borderTopWidth }))
  check(at.card === 'settings-model' && at.prev === '模式' && at.line === '0px', `NSFW 在模型卡「模式」下面一行，没有细线（${JSON.stringify(at)}）`)
  check((await page.getByTestId('settings-preset').getByTestId('doc-nsfw').count()) === 0, 'Prompt 预设卡里没有 NSFW')
}
await clip(page.getByTestId('settings-model'), 'settings-off', 8, page.getByTestId('settings-preset'))

await toPage('export')
await ready()
const p0 = await count('base.prompt')
const u0 = await count('base.uc')
check((await text('base.uc')).startsWith('nsfw, lowres'), '关着：负面开头灰字 nsfw（NAI 出图时加）')
check((await row('base.prompt').getByTestId('export-nsfw').count()) === 0, '关着：正面没有 nsfw')

await toPage('settings')
await sw().click()
await page.waitForTimeout(250)
check(await checked(), '点开关：打开')
check((await docSettings()).nsfw === true, '存在文档设置里（settings.nsfw）')
await clip(page.getByTestId('settings-model'), 'settings-on', 8, page.getByTestId('settings-preset'))
await toPage('export')
await ready()
await page.waitForFunction((p) => Number(document.querySelector('[data-testid="export-base.prompt"] [data-testid=token-count]')?.textContent.replace(/\D/g, '')) !== p, p0, { timeout: 10_000 })
check((await text('base.prompt')).startsWith('nsfw, 2girls'), `正面最前面 nsfw：${(await text('base.prompt')).slice(0, 24)}`)
check((await text('base.uc')).startsWith('lowres, artistic error'), `负面不再有 nsfw：${(await text('base.uc')).slice(0, 24)}`)
const p1 = await count('base.prompt')
const u1 = await count('base.uc')
check(p1 > p0 && u1 < u0, `token：正面 ${p0} → ${p1}，负面 ${u0} → ${u1}`)
const color = await row('base.prompt').getByTestId('export-nsfw').evaluate((e) => getComputedStyle(e).color)
const plain = await row('base.prompt').getByTestId('export-text').evaluate((e) => getComputedStyle(e).color)
check(color !== plain, `nsfw 有自己的颜色（${color}）`)
await row('base.prompt').getByTestId('export-copy').click()
const copied = await page.evaluate(() => navigator.clipboard.readText())
check(copied.startsWith('nsfw, 2girls') && !copied.includes('no text'), `复制正面包含 nsfw、不带灰字：${copied.slice(0, 24)}…`)
await hover(row('base.prompt').getByTestId('export-nsfw'))
check((await page.getByRole('tooltip').first().textContent())?.includes('NSFW 自动添加 · 复制时包含'), `悬停：${await page.getByRole('tooltip').first().textContent()}`)
await away()
await hover(row('base.prompt').getByTestId('length-meter'))
const donut = page.getByTestId('length-donut')
await donut.waitFor()
check((await donut.innerText()).includes('NSFW'), '环形图图例有「NSFW」一段')
await clip(donut, 'donut', 6)
await away()
await clip(row('base.prompt').locator('..'), 'export', 8, row('base.uc').locator('..'))

await statusBar()
await page.keyboard.press('Control+z')
await page.waitForTimeout(300)
check(!(await text('base.prompt')).startsWith('nsfw'), 'Ctrl+Z：正面没有 nsfw 了')
await page.keyboard.press('Control+y')
await page.waitForTimeout(300)
check((await text('base.prompt')).startsWith('nsfw, '), 'Ctrl+Y：回来')

await sec('主体').getByTestId('tag-input').evaluate((el) => {
  const dt = new DataTransfer()
  dt.setData('text', 'nsfw,')
  el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }))
})
await page.waitForTimeout(300)
const nc = chip('nsfw').first()
await hover(nc.getByTestId('chip-dup'))
check((await page.getByTestId('chip-dup-tip').first().textContent()) === '与 NSFW 重复', `区块里的 nsfw：${await page.getByTestId('chip-dup-tip').first().textContent()}`)
check((await row('base.prompt').getByTestId('export-nsfw').getAttribute('class')).includes('x-dup'), '导出栏开头的 nsfw 画波浪线')
await away()
await clip(sec('主体'), 'dup-chip')
await clip(row('base.prompt'), 'dup-export')
await statusBar()
await page.keyboard.press('Control+z')
await page.waitForTimeout(300)
check((await chip('nsfw').count()) === 0, '撤销粘贴')

await page.getByTestId('export-tab-json').click()
await page.waitForTimeout(250)
const json = JSON.parse(await page.getByTestId('export-json').textContent())
check(json.prompt.startsWith('nsfw, 2girls') && !json.uc.startsWith('nsfw'), 'JSON：prompt 开头 nsfw，uc 没有 nsfw')
await page.getByTestId('export-tab-en').click()

const btn = page.getByTestId('copy-nai-image')
await btn.click()
await page.waitForFunction(() => document.querySelector('[data-testid=copy-nai-image]')?.hasAttribute('data-done'))
await page.waitForFunction(() => !document.querySelector('[data-testid=copy-nai-image]')?.hasAttribute('data-done'), null, { timeout: 5000 })
await statusBar()
await page.keyboard.press('Control+v')
await page.getByTestId('intake-import').click()
const dialog = page.getByTestId('import-dialog')
await dialog.waitFor()
await page.waitForTimeout(300)
const stripped = await dialog.getByTestId('import-stripped').allTextContents()
check(stripped.some((s) => s.includes('NSFW：已从开头移除') && s.includes('nsfw')), `导入弹窗：${stripped.join(' / ')}`)
const firstPrev = await dialog.getByTestId('import-preview-prompt').locator('.chip').first().innerText()
check(!firstPrev.startsWith('nsfw'), `预览里没有 nsfw：第一个是 ${firstPrev.split('\n')[0]}`)
await clip(dialog.locator('section').filter({ has: page.getByTestId('import-preview-prompt') }), 'import', 6)
await dialog.getByTestId('import-submit').click()
await dialog.waitFor({ state: 'detached' })
await page.waitForTimeout(400)
check((await docSettings()).nsfw === true, '导入的新文档：NSFW 开着')
check((await chip('nsfw').count()) === 0, '导入的新文档：区块里没有 nsfw')
await ready()
check((await text('base.prompt')).startsWith('nsfw, 2girls'), '导入的新文档：导出和原来一样')

await globalNsfw(false)
await toPage('settings')
check(!(await shown()), '关掉「显示 NSFW 内容」：没有 NSFW 开关')
await toPage('export')
check((await text('base.prompt')).startsWith('nsfw, '), '开着的文档照样导出 nsfw（不悄悄改）')

console.log(errors.length ? `console 报错：${errors.join(' | ')}` : 'console 无报错')
await browser.close()
if (fails || errors.length) process.exit(1)
