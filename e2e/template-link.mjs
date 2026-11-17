import { chromium } from '@playwright/test'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { E2E_URL, isolate, resetStore } from './store.mjs'

const theme = process.argv[2] ?? 'light'
const prefix = process.argv[3] ?? 'tl'
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

const shot = async (name, clip) => {
  await page.waitForTimeout(350)
  const file = `${out}/${prefix}-${name}-${theme}${width === 1440 ? '' : `-${width}`}.png`
  await page.screenshot({ path: file, clip })
  console.log('shot', file)
}
const away = () => page.mouse.move(width / 2, 895)
const side = { x: 0, y: 0, width: 360, height: 900 }
const row = (scope, name) => page.getByTestId(scope).getByTestId('template-row').filter({ has: page.getByTestId('template-name').getByText(name, { exact: true }) }).first()
const section = (name) => page.getByTestId('section').filter({ has: page.getByTestId('section-name').getByText(name, { exact: true }) })

const image = process.env.TPL_IMG && existsSync(process.env.TPL_IMG) ? { name: 'tpl.png', mimeType: 'image/png', buffer: readFileSync(process.env.TPL_IMG) } : null

await row('tpl-fav', '柔和逆光').click()
await away()
await shot('0-row-example', side)
const pickSection = async (name) => {
  const b = await section(name).first().boundingBox()
  await page.mouse.click(b.x + b.width * 0.5, b.y + 12)
  await page.waitForTimeout(450)
  await away()
}
await pickSection('场景')
await shot('0b-sample-clean', side)
await pickSection('通用负面')
await shot('0c-sample-edited', side)
await page.keyboard.press('Escape')
await page.keyboard.press('Escape')
await page.waitForTimeout(300)

await row('tpl-fav', '通用负面').click({ button: 'right' })
await page.getByTestId('template-menu-edit').click()
await page.getByTestId('template-edit-name').waitFor()
await shot('1-edit-empty')

const fileDrag = () =>
  page.evaluateHandle(() => {
    const dt = new DataTransfer()
    dt.items.add(new File(['x'], 'a.png', { type: 'image/png' }))
    return dt
  })
await page.getByTestId('template-edit').dispatchEvent('dragenter', { dataTransfer: await fileDrag() })
await shot('2-edit-dragover')
console.log('import overlay shown while dialog open:', await page.getByTestId('drop-overlay').evaluate((e) => e.hasAttribute('data-show')))
await page.getByTestId('template-edit').dispatchEvent('dragleave', { dataTransfer: await fileDrag() })
await page.keyboard.press('Escape')
await page.waitForTimeout(300)

await page.getByTestId('tpl-fav').getByTestId('template-more').click()
await page.getByTestId('template-more-edit').click()
await page.getByTestId('template-edit-name').waitFor()
await page.getByTestId('template-edit-folder').click()
await page.getByTestId('template-edit-folder-menu').waitFor()
await shot('3a-folder-open')
await page.getByTestId('template-edit-folder-search').fill('光照/逆光')
await shot('3b-folder-create')
await page.getByTestId('template-edit-folder-create').click()
if (image) await page.getByTestId('template-edit-file').setInputFiles(image)
await page.mouse.move(width / 2, 60)
await shot('3-edit-image')
await page.getByTestId('template-edit-image').hover()
await shot('3c-image-hover')
await page.getByTestId('template-edit-save').click()
await page.waitForTimeout(400)
await away()
await shot('4-row-image', side)

await page.getByTestId('tpl-fav').getByTestId('template-insert').click()
await page.waitForTimeout(300)
const sec = section('柔和逆光').first()
const pick = async () => {
  const b = await sec.boundingBox()
  await page.mouse.click(b.x + b.width * 0.5, b.y + 12)
  await page.waitForTimeout(400)
}
await pick()
await away()
await shot('5-inspector-clean', side)

await sec.getByTestId('chip').first().click()
await page.mouse.wheel(0, -100)
await page.waitForTimeout(150)
await page.keyboard.press('Escape')
await page.waitForTimeout(400)
await away()
await shot('6-inspector-edited', side)

await page.getByTestId('section-overwrite').click()
await page.getByTestId('section-overwrite-confirm').waitFor()
await shot('7-overwrite-confirm', { x: 0, y: 0, width: 420, height: 600 })
await page.getByTestId('section-overwrite-run').click()
await page.waitForTimeout(400)
await away()
await shot('8-overwritten', { x: 0, y: 0, width, height: 900 })

await page.getByTestId('section-note').hover()
await shot('9-note-hover', { x: 0, y: 0, width: 360, height: 420 })
await page.getByTestId('section-note').click()
await page.keyboard.press('Control+a')
await page.keyboard.type('这里的 light rays 我改成 1.0 了，配夜景时别用。')
await shot('10-note-editing', { x: 0, y: 0, width: 360, height: 420 })
await page.keyboard.press('Tab')

await page.keyboard.press('Control+k')
await page.getByTestId('template-palette-input').fill('逆光')
await page.waitForTimeout(500)
await shot('11-palette-preview')
await page.keyboard.press('ArrowDown')
await page.waitForTimeout(250)
await shot('12-palette-next')
await page.keyboard.press('Escape')
await page.waitForTimeout(300)
console.log('palette closed by Esc:', (await page.getByTestId('template-palette-input').count()) === 0)

const scene = section('场景').first()
const sb = await scene.boundingBox()
await page.mouse.click(sb.x + sb.width * 0.5, sb.y + 12)
await page.waitForTimeout(400)
await away()
await shot('13-inspector-none', side)

const rel = page.getByTestId('related-templates').getByTestId('template-row').filter({ has: page.getByTestId('template-name').getByText('柔和逆光', { exact: true }) })
if (await rel.count()) {
  await rel.first().click()
  await away()
  await shot('14-related-image', side)
}

console.log('errors', errors.length ? errors : 'none')
await browser.close()
