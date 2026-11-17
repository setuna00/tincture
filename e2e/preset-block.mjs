import { chromium } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { closeParams, openParams } from './right-panel.mjs'
import { E2E_URL, isolate, resetStore } from './store.mjs'

const theme = process.argv[2] ?? 'light'
const width = Number(process.argv[3] ?? 1440)
const out = 'e2e/shots'
mkdirSync(out, { recursive: true })

const browser = await chromium.launch()
const context = await browser.newContext({ viewport: { width, height: 900 }, deviceScaleFactor: 2 })
await isolate(context)
const page = await context.newPage()
const errors = []
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
page.on('pageerror', (e) => errors.push(String(e)))
await page.goto(E2E_URL)
await resetStore(page, { theme })
await page.reload()
await page.waitForLoadState('networkidle')
await page.waitForSelector('[data-testid=preset-block]')

const fails = []
const check = (ok, msg) => (ok ? console.log('ok  ', msg) : (fails.push(msg), console.log('FAIL', msg)))
const suffix = `${theme}${width === 1440 ? '' : `-${width}`}`
const block = (field) => page.locator(`[data-testid=preset-block][data-field=${field}]`)
const chips = async (field) => block(field).getByTestId('preset-chip').allTextContents()
const away = () => page.mouse.move(2, 890)
const undo = async () => {
  await away()
  await page.mouse.click(width / 2, 890)
  await page.keyboard.press('Control+z')
  await page.waitForTimeout(250)
}
const pickIn = async (loc, name) => {
  await loc.click()
  await page.getByRole('option', { name, exact: true }).click()
  await page.waitForTimeout(250)
}
const hoverTip = async (loc) => {
  await away()
  await page.waitForTimeout(300)
  const b = await loc.boundingBox()
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 6 })
  const tip = page.locator('[data-slot=tooltip-content]').last()
  await tip.waitFor({ timeout: 3000 }).catch(() => {})
  return (await tip.textContent().catch(() => '')) ?? ''
}
const clip = async (name) => {
  await away()
  await page.waitForTimeout(350)
  const a = await block('prompt').boundingBox()
  const b = await block('uc').boundingBox()
  const file = `${out}/preset-${name}-${suffix}.png`
  await page.screenshot({ path: file, clip: { x: a.x - 16, y: a.y - 16, width: a.width + 32, height: b.y + b.height - a.y + 32 } })
  console.log('clip', file)
}

const pos = await page.evaluate(() => {
  const boxes = [...document.querySelectorAll('[data-box]')]
  const [p, u] = boxes
  return {
    qualityLast: p.lastElementChild?.getAttribute('data-field') === 'prompt',
    ucFirst: u.querySelector(':scope > header').nextElementSibling?.getAttribute('data-field') === 'uc',
    inChars: boxes.slice(2).some((b) => b.querySelector('[data-testid=preset-block]')),
  }
})
check(pos.qualityLast, 'quality block is last in the positive box')
check(pos.ucFirst, 'UC block is first in the negative box')
check(!pos.inChars, 'no preset blocks in character boxes')
check((await block('prompt').getByTestId('preset-name').textContent()) === '质量预设', 'quality block name')
check((await chips('prompt')).join(', ') === 'very aesthetic, masterpiece, no text', 'quality chips = Standard words')
check((await chips('uc'))[0] === 'nsfw' && (await chips('uc')).length === 8, 'UC: nsfw first, folded to 8')
await clip('default')

await block('uc').getByTestId('preset-fold').click()
await page.waitForTimeout(300)
check((await chips('uc')).length === 18, 'UC unfolds to 18 chips')
check((await block('uc').getByTestId('preset-fold').textContent()) === '收起', 'fold button reads 收起')
await clip('unfolded')
await block('uc').getByTestId('preset-fold').click()
await page.waitForTimeout(300)

await pickIn(block('prompt').getByTestId('preset-select'), 'Light')
check((await chips('prompt')).join(', ') === 'very aesthetic, amazing quality, no text', 'Light words after picking Light')
await openParams(page)
check((await page.getByTestId('quality-preset').textContent()).includes('Light'), 'params panel shows Light too')
await pickIn(page.getByTestId('quality-preset'), 'Standard')
await closeParams(page)
check((await block('prompt').getByTestId('preset-select').textContent()).includes('Standard'), 'block follows the params panel')
await undo()
check((await block('prompt').getByTestId('preset-select').textContent()).includes('Light'), 'undo: back to Light')
await undo()
check((await block('prompt').getByTestId('preset-select').textContent()).includes('Standard'), 'undo: back to Standard')

await block('uc').getByTestId('preset-enabled').click()
await page.waitForTimeout(350)
check((await block('uc').getAttribute('data-off')) === '', 'UC switched off')
check((await chips('uc')).length === 0, 'UC off: no chips')
check((await block('uc').getByTestId('preset-select').textContent()).includes('None'), 'UC off: shows None')
await pickIn(block('uc').getByTestId('preset-select'), 'Light')
await block('uc').getByTestId('preset-enabled').click()
await page.waitForTimeout(250)
await block('uc').getByTestId('preset-enabled').click()
await page.waitForTimeout(250)
check((await block('uc').getByTestId('preset-select').textContent()).includes('Light'), 'switch back on restores Light')
await pickIn(block('uc').getByTestId('preset-select'), 'Heavy')

const dedupe = block('uc').getByTestId('preset-dedupe')
check((await dedupe.textContent()).includes('2'), 'UC dedupe shows 2')
const dupTip = await hoverTip(dedupe)
check(dupTip.includes('lowres') && dupTip.includes('jpeg artifacts'), `dedupe hover lists the tags: ${dupTip}`)
await dedupe.click()
await page.waitForTimeout(300)
const ucText = await page.locator('[data-box]').nth(1).getByTestId('section').first().textContent()
check(!ucText.includes('lowres') && !ucText.includes('jpeg artifacts'), 'dedupe removed lowres / jpeg artifacts from the section')
check((await dedupe.count()) === 0, 'dedupe button gone')
await undo()
check((await block('uc').getByTestId('preset-dedupe').count()) === 1, 'undo brings the duplicates back')

const before = await page.locator('[data-box]').first().getByTestId('section').count()
await block('prompt').getByTestId('preset-more').click()
await page.getByTestId('preset-to-section').click()
await page.waitForTimeout(350)
const secs = page.locator('[data-box]').first().getByTestId('section')
check((await secs.count()) === before + 1, 'convert adds a section')
check((await secs.last().getByTestId('section-name').textContent()) === '质量预设 Standard', 'new section is last, named 质量预设 Standard')
check((await block('prompt').getAttribute('data-off')) === '', 'quality preset is None after convert')
await clip('converted')
await undo()
check((await secs.count()) === before && (await block('prompt').getAttribute('data-off')) === null, 'one undo restores section count and preset')

await openParams(page)
await page.getByTestId('set-effort-medium').click()
await closeParams(page)
await page.waitForTimeout(250)
check(await block('uc').getByTestId('preset-select').isDisabled(), 'Medium: UC select disabled')
check(await block('uc').getByTestId('preset-enabled').isDisabled(), 'Medium: UC switch disabled')
check(await block('uc').getByTestId('preset-more').isDisabled(), 'Medium: UC ⋯ disabled')
check(!(await block('prompt').getByTestId('preset-select').isDisabled()), 'Medium: quality still editable')
const lockTip = await hoverTip(block('uc').getByTestId('preset-select'))
check(lockTip.includes('Effort Medium 固定为 Heavy'), `Medium hover: ${lockTip}`)
await clip('medium')
await openParams(page)
await page.getByTestId('set-effort-high').click()

await pickIn(page.getByTestId('set-model'), 'V4 Full')
await closeParams(page)
await block('prompt').getByTestId('preset-select').click()
const opts = await page.getByRole('option').allTextContents()
check(opts.join('/') === 'Standard/None', `V4 Full quality options: ${opts.join('/')}`)
await page.keyboard.press('Escape')
check((await chips('prompt')).join(', ') === 'no text, best quality, very aesthetic, absurdres', 'V4 Full quality words')

check(errors.length === 0, `no console errors ${errors.join(' | ')}`)
console.log(fails.length ? `\n${fails.length} FAILED` : '\nall ok')
await browser.close()
process.exit(fails.length ? 1 : 0)
