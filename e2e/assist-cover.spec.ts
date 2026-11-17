// transition-all also animates inherited visibility; freeze animations to catch controls leaking through the covering panel.
import { expect, test, type Page } from '@playwright/test'
import { isolate, resetStore } from './store.mjs'

let errors: string[] = []

test.beforeEach(async ({ page, context, baseURL }) => {
  errors = []
  await isolate(context, baseURL)
  await context.route(/novelai\.net|\/api\/ai\//, (route) => route.abort())
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
  page.on('pageerror', (e) => errors.push(String(e)))
  // The app starts after load; wait for its status bar before resetting storage to avoid racing startup.
  await page.goto('/')
  await page.getByTestId('status-bar').waitFor()
  await resetStore(page)
  await page.reload()
  await page.getByTestId('status-bar').waitFor()
  await page.waitForLoadState('networkidle')
})

test('tab row spans the assistant; AI entries reveal covered chat and preserve pin behavior', async ({ page }) => {
  const by = (id: string) => page.getByTestId(id)
  const row = (await by('tab-row').boundingBox())!
  const rail = (await by('app-rail').boundingBox())!
  const assistant = (await by('assistant').boundingBox())!
  expect(row.x).toBe(rail.x + rail.width)
  expect(row.x + row.width).toBe(page.viewportSize()!.width)
  expect(assistant.y).toBe(row.y + row.height)
  expect(await by('tab-row').evaluate((el) => getComputedStyle(el).getPropertyValue('-webkit-app-region'))).toBe('drag')
  const headerRegions = () => by('assistant').locator('.app-drag').evaluateAll((els) => els.map((el) => getComputedStyle(el).getPropertyValue('-webkit-app-region')))
  expect(await headerRegions()).toEqual(['no-drag'])

  const chat = by('ai-chat')
  const ai = by('rail-ai')
  const chip = by('chip').filter({ has: page.locator('.chip-text').getByText('cherry blossoms', { exact: true }) }).first()
  await ai.click()
  await expect(chat).toBeVisible()
  await chip.click()
  await expect(chat).toBeHidden()
  await expect(by('assistant')).toHaveAttribute('data-mode', 'tag')
  await expect(ai).toHaveAttribute('aria-pressed', 'false')
  await ai.click()
  await expect(by('assistant')).toHaveAttribute('data-mode', 'library')
  await expect(page.locator('[data-testid="chip"][data-selected]')).toHaveCount(0)
  await expect(chat).toBeVisible()
  await expect(ai).toHaveAttribute('aria-pressed', 'true')
  expect((await headerRegions()).every((r) => r === 'no-drag')).toBe(true)
  await ai.click()
  await expect(chat).toHaveCount(0)

  await page.keyboard.press('Control+l')
  await chip.click()
  await page.keyboard.press('Escape')
  await expect(by('assistant')).toHaveAttribute('data-mode', 'section')
  await expect(chat).toBeHidden()
  await page.keyboard.press('Control+l')
  await expect(by('assistant')).toHaveAttribute('data-mode', 'library')
  await expect(chat).toBeVisible()
  await page.keyboard.press('Control+l')
  await expect(chat).toHaveCount(0)

  await ai.click()
  await by('ai-chat-pin').click()
  await chip.click()
  await expect(chat).toBeVisible()
  await expect(ai).toHaveAttribute('aria-pressed', 'true')
  await ai.click()
  await expect(chat).toHaveCount(0)
})

test.afterEach(() => {
  expect(errors, 'console 不应有报错').toEqual([])
})

test('tab entry clears multi-selection; stale IDs do not cover AI; reduced motion keeps the tab row fixed', async ({ page }) => {
  const by = (id: string) => page.getByTestId(id)
  await page.evaluate(async () => {
    const { usePrefs } = await (window as any).__peImport('/src/store/prefs.ts')
    usePrefs.getState().set({ chatEntry: 'tab' })
  })
  await by('assist-tab-ai').click()
  const chip = (name: string) => by('chip').filter({ has: page.locator('.chip-text').getByText(name, { exact: true }) }).first()
  await chip('cherry blossoms').click()
  await chip('petals').click({ modifiers: ['Control'] })
  await expect(by('assistant')).toHaveAttribute('data-mode', 'multi')
  await expect(by('ai-chat')).toBeHidden()
  await page.keyboard.press('Control+l')
  await expect(by('ai-chat')).toBeVisible()
  await expect(by('assistant')).toHaveAttribute('data-mode', 'library')
  await expect(page.locator('[data-testid="chip"][data-selected]')).toHaveCount(0)
  await page.evaluate(async () => {
    const { useUi } = await (window as any).__peImport('/src/store/ui.ts')
    useUi.getState().setSelection(['missing-chip-1', 'missing-chip-2'])
  })
  await expect(by('assistant')).toHaveAttribute('data-mode', 'library')
  await page.keyboard.press('Control+l')
  await expect(by('ai-chat')).toHaveCount(0)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  expect(await by('editor-grid').evaluate((el) => getComputedStyle(el).transitionProperty)).toBe('none')
  const x = (await by('tab-row').boundingBox())!.x
  await by('new-tab').click()
  await expect(by('start-page')).toBeVisible()
  expect((await by('tab-row').boundingBox())!.x).toBe(x)
})

const visibleInLibrary = (page: Page) =>
  page.evaluate(() =>
    [...document.querySelectorAll('[data-testid=assist-library] [data-testid]')]
      .filter((el) => getComputedStyle(el).visibility === 'visible')
      .map((el) => (el as HTMLElement).dataset.testid),
  )

test('Inspector 盖住模板库的那一帧起库就看不见（分段、按钮没有残影）；回到库时分段和按钮同一帧出来', async ({ page }) => {
  await page.getByTestId('template-item').first().locator('> *').first().click()
  await expect(page.getByTestId('template-insert')).toBeVisible()

  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Animation.enable')
  await cdp.send('Animation.setPlaybackRate', { playbackRate: 0 })

  await page.getByTestId('chip').filter({ has: page.locator('.chip-text').getByText('cherry blossoms', { exact: true }) }).first().click()
  await expect(page.getByTestId('assistant')).toHaveAttribute('data-mode', 'tag')
  expect(await visibleInLibrary(page)).toEqual([])

  await page.keyboard.press('Escape')
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('assistant')).toHaveAttribute('data-mode', 'library')
  const shown = await visibleInLibrary(page)
  for (const id of ['library-tab-sections', 'library-tab-characters', 'assist-collapse', 'template-insert']) expect(shown).toContain(id)

  await cdp.send('Animation.setPlaybackRate', { playbackRate: 1 })
})
