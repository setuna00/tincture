import { chromium } from '@playwright/test'
import { existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { E2E_URL, isolate, resetStore } from './store.mjs'

const theme = process.argv[2] ?? 'light'
const prefix = process.argv[3] ?? 'paste'
const shotsOnly = process.argv.includes('--shots-only')
const osDark = process.argv.includes('--os-dark')
const out = 'e2e/shots'
mkdirSync(out, { recursive: true })

const dir = process.env.NAI_SAMPLES ?? join(process.env.USERPROFILE ?? '', 'Downloads')
const names = existsSync(dir) ? readdirSync(dir) : []
const c2 = names.find((n) => n.endsWith(' s-1790379537.png'))
const t2 = join(dir, 'nai-import-test', 't2-alpha-only.png')
const PNG_1PX = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, colorScheme: osDark ? 'dark' : 'light' })
await isolate(ctx)
await ctx.grantPermissions(['clipboard-read', 'clipboard-write'])
const page = await ctx.newPage()
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

const dt = await page.evaluateHandle((b64) => {
  const t = new DataTransfer()
  t.items.add(new File([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))], 'screenshot.png', { type: 'image/png' }))
  return t
}, PNG_1PX)
await page.dispatchEvent('main', 'dragenter', { dataTransfer: dt })
await page.dispatchEvent('main', 'dragover', { dataTransfer: dt })
await page.dispatchEvent('main', 'drop', { dataTransfer: dt })
const intake = page.getByTestId('image-intake')
await intake.waitFor()
check((await page.getByTestId('intake-gallery').innerText()).startsWith('只加入图库'), '图库动作叫法统一')
await page.waitForTimeout(300)
const disabledImport = page.getByTestId('intake-import')
check(await disabledImport.isDisabled() && (await disabledImport.innerText()).includes('未读取到图片信息'), '没元数据：导入 prompt 置灰并说明原因')
const box = await intake.boundingBox()
const pad = 24
const file = `${out}/${prefix}-intake-${theme}${osDark ? '-osdark' : ''}.png`
await page.screenshot({ path: file, clip: { x: box.x - pad, y: box.y - pad, width: box.width + pad * 2, height: box.height + pad * 2 } })
console.log('shot', file)
await page.keyboard.press('Escape')
await intake.waitFor({ state: 'detached' })

if (!shotsOnly) {
  const pasteFile = async (path, where) => {
    const b64 = readFileSync(path).toString('base64')
    await page.evaluate(async (b64) => {
      const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': new Blob([bin], { type: 'image/png' }) })])
    }, b64)
    await where()
    await page.keyboard.press('Control+V')
  }
  const dialog = page.getByTestId('import-dialog')
  const blank = () => page.mouse.click(720, 880)
  for (const [label, path] of [
    ['NAI 图片（seed 1790379537，剪贴板会剥掉文本块，读 alpha）', c2 && join(dir, c2)],
    ['t2（只有 alpha）', existsSync(t2) && t2],
  ]) {
    if (!path) {
      console.log('跳过', label, '：找不到样图')
      continue
    }
    await pasteFile(path, blank)
    await page.getByTestId('intake-import').click({ timeout: 5000 }).catch(() => {})
    await dialog.waitFor({ timeout: 5000 }).catch(() => {})
    check(await dialog.isVisible(), `${label}：Ctrl+V 打开导入弹窗`)
    if (label.startsWith('C2')) {
      const text = await dialog.innerText()
      check(text.includes('Custom') && text.includes('Standard'), 'NAI 图片：位置 Custom、质量 Standard 都读出来了')
    }
    await page.keyboard.press('Escape')
    await dialog.waitFor({ state: 'hidden' })
  }
}

check(errors.length === 0, `console 没有报错${errors.length ? '：' + errors.join(' | ') : ''}`)
await browser.close()
if (fails.length) {
  console.log(`\n${fails.length} 项失败`)
  process.exit(1)
}
