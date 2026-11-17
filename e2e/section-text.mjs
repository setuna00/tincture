import { chromium } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { E2E_URL, isolate, resetStore } from './store.mjs'

const theme = process.argv[2] ?? 'light'
const prefix = process.argv[3] ?? 'st'
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

const fails = []
const check = (ok, msg) => (ok ? console.log('ok  ', msg) : (fails.push(msg), console.log('FAIL', msg)))
const sec = (name) => page.getByTestId('section').filter({ has: page.getByTestId('section-name').getByText(name, { exact: true }) }).first()
const chipTexts = (loc) => loc.locator('[data-testid=chip] .chip-text').allInnerTexts()
const shot = async (name) => {
  await page.waitForTimeout(250)
  await page.mouse.move(2, 890)
  await page.waitForTimeout(150)
  const file = `${out}/${prefix}-${name}-${theme}.png`
  await page.screenshot({ path: file })
  console.log('shot', file)
}
const clipOf = async (loc, name, pad = 14, padL = 40) => {
  const b = await loc.boundingBox()
  const file = `${out}/${prefix}-${name}-${theme}.png`
  await page.screenshot({ path: file, clip: { x: b.x - padL, y: b.y - pad, width: b.width + pad + padL, height: b.height + pad * 2 } })
  console.log('clip', file)
}
const undo = () => page.keyboard.press('Control+z')

await sec('画师').getByTestId('section-enabled').click()
await shot('1-overview')
await clipOf(page.getByTestId('box-base.prompt'), '1-prompt-box', 10, 34)
check(await sec('画师').evaluate((el) => el.hasAttribute('data-muted')), '关掉开关 = 停用')
await sec('画师').getByTestId('section-enabled').click()
const char = page.getByTestId('character').first()
await char.scrollIntoViewIfNeeded()
await clipOf(char, '1-character', 10, 10)

const scene = sec('场景')
await scene.scrollIntoViewIfNeeded()
const before = await chipTexts(scene)
await scene.getByTestId('section-text-toggle').click()
const ta = scene.getByTestId('section-text')
const txt = await ta.inputValue()
console.log('text:', JSON.stringify(txt))
check(!txt.includes('cloud') && txt.includes('1.2::cherry blossoms, petals::') && txt.endsWith(', '), '文本 = NAI 写法，禁用的不在，末尾带逗号')
check((await scene.locator('.section-text-note').innerText()).includes('1 个已禁用'), '提示有 1 个已禁用的 tag')
await shot('2-text')
await clipOf(scene, '2-text-zoom')

await scene.getByTestId('section-text-toggle').click()
check(JSON.stringify(await chipTexts(scene)) === JSON.stringify(before), '原样切回，chip 不变')

await scene.getByTestId('section-text-toggle').click()
await ta.click()
await page.keyboard.press('Control+a')
await page.keyboard.insertText('outdoors, 1.3::cherry blossoms::, falling petals, blue sky, day')
await clipOf(scene, '4-editing-zoom')
check((await page.getByTestId('status-hint').getAttribute('data-state')) === 'text', '打字时状态栏是文本提示')
await page.mouse.click(width / 2, 30)
await page.waitForTimeout(150)
check((await page.getByTestId('status-hint').getAttribute('data-state')) !== 'text', '失焦后状态栏提示收回')
check((await ta.inputValue()) === 'outdoors, 1.3::cherry blossoms::, falling petals, blue sky, day, ', '失焦后文本按文档重新生成（带末尾逗号）')
await scene.getByTestId('section-text-toggle').click()
const after = await chipTexts(scene)
console.log('chips:', after.join(' | '))
check(after.join('|') === 'outdoors|cherry blossoms|falling petals|blue sky|cloud|day', '拆成 chip；禁用的 cloud 留在 blue sky 后面')
await clipOf(scene, '4-back-zoom')

await page.mouse.click(width / 2, 30)
await undo()
await page.waitForTimeout(100)
check((await scene.getByTestId('section-text').count()) === 1 && (await ta.inputValue()).includes('1.2::cherry blossoms, petals::'), '撤销一次：回到文本显示 + 原来的 tag（写回和紧接着的切回是一步）')
await undo()
await page.waitForTimeout(100)
check((await scene.getByTestId('section-text').count()) === 0, '再撤销：撤掉「切到文本」')
check(JSON.stringify(await chipTexts(scene)) === JSON.stringify(before), '回到最初的 chip')

await scene.getByTestId('section-text-toggle').click()
await ta.click()
await page.keyboard.press('Control+End')
await page.keyboard.insertText('sunset')
await scene.getByTestId('section-text-toggle').click()
check((await chipTexts(scene)).includes('sunset'), '改完直接点切回：新 tag 进来')
await page.mouse.click(width / 2, 30)
await undo()
await page.waitForTimeout(100)
check((await scene.getByTestId('section-text').count()) === 1 && !(await ta.inputValue()).includes('sunset'), '撤销一次：写回和切换一起撤掉')
await undo()

await page.getByTestId('box-base.prompt').getByTestId('add-section').click()
const empty = page.getByTestId('section').filter({ has: page.getByTestId('section-name').getByText('新区块', { exact: true }) }).first()
await empty.getByTestId('section-text-toggle').click()
await page.mouse.click(width / 2, 30)
await clipOf(empty, '7-empty-zoom')

await sec('主体').getByTestId('section-text-toggle').hover()
await page.waitForTimeout(700)
await clipOf(sec('主体'), '8-tooltip', 40, 40)

console.log('errors', errors.length ? errors : 'none')
console.log(fails.length ? `FAILED ${fails.length}` : 'ALL OK')
await browser.close()
