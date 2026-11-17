import { expect, test } from '@playwright/test'
import { isolate, resetStore } from './store.mjs'

test.use({ screenshot: 'off' })

test('add-category dialog excludes the unassigned sentinel from every builtin list', async ({ page, context, baseURL }) => {
  const errors: string[] = []
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
  page.on('pageerror', (e) => errors.push(String(e)))
  await context.route(/novelai\.net/, (route) => route.abort())
  await isolate(context, baseURL)
  await page.goto('/')
  await page.getByTestId('status-bar').waitFor()
  await resetStore(page)
  await page.reload()
  await page.getByTestId('status-bar').waitFor()
  await page.locator('[data-testid=lib-folder][data-folder=random]').click()
  await page.locator('[data-testid=random-row][data-kind=tag]').click()
  await page.getByTestId('random-insert').click()
  const section = page.getByTestId('section').filter({ has: page.getByTestId('random-head') }).last()
  await section.locator('.section-head').click({ position: { x: 200, y: 8 } })
  await page.getByTestId('scope-add-source').click()
  const dialog = page.getByTestId('gacha-add-category')
  await expect(dialog).toBeVisible()
  for (const name of ['内置 A', '内置 B', '内置 C']) {
    await dialog.getByTestId('gacha-add-category-list').getByText(name, { exact: true }).click()
    await expect(dialog.getByTestId('gacha-add-category-node').first()).toBeVisible()
    const sentinel = await page.evaluate(async () => {
      const { UNASSIGNED_PATH } = await window.__peImport('/src/lib/discover.ts')
      return UNASSIGNED_PATH
    })
    await expect(dialog.locator(`[data-path^="${sentinel}"]`)).toHaveCount(0)
    await expect(dialog.getByText('未归类', { exact: true })).toHaveCount(0)
  }
  expect(errors).toEqual([])
})
