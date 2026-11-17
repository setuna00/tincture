const OPEN = '[data-testid=params-panel][data-state=open]'

export async function openParams(page) {
  await page.getByTestId('params-button').waitFor()
  await page.waitForTimeout(100)
  if (await page.locator(OPEN).count()) return
  await page.waitForSelector('[data-testid=params-panel]', { state: 'detached' })
  await page.getByTestId('params-button').click()
  await page.waitForSelector(OPEN)
}

export async function closeParams(page) {
  if (!(await page.locator(OPEN).count())) return
  await page.getByTestId('params-button').click()
  await page.waitForSelector('[data-testid=params-panel]', { state: 'detached' })
}

export async function toTab(page, tab) {
  await closeParams(page)
  if ((await page.getByTestId('export-panel').getAttribute('data-tab')) === tab) return
  await page.getByTestId(`right-tab-${tab}`).click()
  await page.waitForSelector(`[data-testid=export-panel][data-tab=${tab}]`)
  await page.waitForTimeout(260)
}
