import { chromium } from '@playwright/test'
import { E2E_URL, isolate, resetStore } from './store.mjs'

const theme = process.argv[2] ?? 'light'
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
await isolate(page.context())
const errors = []
page.on('pageerror', (e) => errors.push(String(e)))
let fails = 0
const check = (ok, what) => {
  if (!ok) fails++
  console.log(ok ? '  ✓' : '  ✗', what)
}
await page.goto(E2E_URL)
await resetStore(page, { theme })
await page.reload()
await page.waitForLoadState('networkidle')

const tplName = await page.evaluate(async () => {
  const lib = (await window.__peImport('/src/store/library.ts')).useLibrary.getState()
  const t = lib.sectionTemplates[0]
  ;(await window.__peImport('/src/components/assistant/template-edit.tsx')).openTemplateEdit(t.id)
  return t.name
})
const dialog = page.getByTestId('template-edit')
await dialog.waitFor()
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
await page.getByTestId('template-edit-file').setInputFiles({ name: 'a.png', mimeType: 'image/png', buffer: png })
await page.getByTestId('template-edit-replace').waitFor({ state: 'attached' })
await page.getByTestId('template-edit-name').fill('改过的名字')
await page.evaluate(async () => {
  const { assetStore } = await window.__peImport('/src/store/storage.ts')
  window.__realSet = assetStore.set
  assetStore.set = async () => {
    throw new Error('disk full')
  }
})
await page.getByTestId('template-edit-save').click()
await page.locator('[data-sonner-toast]').filter({ hasText: '无法保存配图' }).waitFor({ timeout: 3000 }).catch(() => {})
check((await page.locator('[data-sonner-toast]').filter({ hasText: '无法保存配图' }).count()) === 1, '存配图失败：toast「无法保存配图」')
check(await dialog.isVisible(), '弹窗还开着')
check((await page.getByTestId('template-edit-name').inputValue()) === '改过的名字', '填的名字还在')

await page.evaluate(async () => {
  const { assetStore } = await window.__peImport('/src/store/storage.ts')
  assetStore.set = window.__realSet
})
await page.getByTestId('template-edit-save').click()
await dialog.waitFor({ state: 'hidden', timeout: 3000 }).catch(() => {})
check(!(await dialog.isVisible()), '再点「保存」：存好、关掉')
const saved = await page.evaluate(async (old) => {
  const t = (await window.__peImport('/src/store/library.ts')).useLibrary.getState().sectionTemplates.find((x) => x.name === '改过的名字')
  return !!t?.imageKey && old !== '改过的名字'
}, tplName)
check(saved, '模板改了名字、带配图')
check(errors.length === 0, `页面无报错 ${errors.join(' | ')}`)
await browser.close()
process.exit(fails ? 1 : 0)
