import { chromium, expect } from '@playwright/test'
import { mkdtempSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Packr } from 'msgpackr'
import { isolate, resetStore } from './store.mjs'
const arg = process.argv[2] ?? '5198'
const theme = process.argv[3] ?? 'light'
const shots = path.resolve('e2e/shots')
mkdirSync(shots, { recursive: true })
let app
if (!/^\d+$/.test(arg)) {
  const dir = mkdtempSync(path.join(tmpdir(), 'tincture-h7-'))
  process.env.PE_TEST = '1'
  process.env.PE_APP_DIR = path.join(dir, 'app')
  process.env.PE_LIBRARY_DIR = path.join(dir, 'library')
  process.env.PE_PORT = '5198'
  const { buildApp } = await import('../server/app.ts')
  const { loadConfig } = await import('../server/config.ts')
  app = await buildApp({ ...loadConfig(), staticDir: path.resolve(arg) })
  await app.listen({ port: 5198, host: '127.0.0.1' })
}
const url = `http://localhost:${/^\d+$/.test(arg) ? arg : 5198}/`
const browser = await chromium.launch()
let checks = 0
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1600 } })
  await isolate(context, url)
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  let request
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==', 'base64')
  const payload = new Packr({ useRecords: false }).pack({ event_type: 'final', samp_ix: 0, gen_id: 'h7', image: png })
  const frame = Buffer.alloc(4 + payload.length); frame.writeUInt32BE(payload.length); payload.copy(frame, 4)
  await context.route(/novelai\.net/, async (route) => {
    if (route.request().url().endsWith('/user/subscription')) return route.fulfill({ json: { tier: 3, active: true, expiresAt: 4102444800, trainingStepsLeft: { fixedTrainingStepsLeft: 1000, purchasedTrainingSteps: 0 } } })
    if (route.request().url().includes('/ai/generate-image-stream')) {
      const body = route.request().postDataBuffer().toString()
      request = JSON.parse(body.slice(body.indexOf('{'), body.lastIndexOf('}') + 1))
      return route.fulfill({ status: 200, body: frame, contentType: 'application/octet-stream' })
    }
    return route.abort()
  })
  await page.goto(url)
  await page.getByTestId('export-panel').waitFor()
  await resetStore(page, { theme, seed: null, nai: { state: { token: 'pst-test' }, version: 1 } })
  await page.reload()
  await expect(page.getByTestId('tab').first()).toContainText('樱花下的师徒'); checks++
  const random = page.getByTestId('section').filter({ has: page.getByTestId('random-head') })
  await expect(random.getByTestId('chip')).toHaveCount(3); checks++
  const original = await random.getByTestId('chip').allTextContents()
  await page.waitForTimeout(1200)
  expect(await random.getByTestId('chip').allTextContents()).toEqual(original); checks++
  await page.screenshot({ path: path.join(shots, `release-intro-sample-${theme}.png`) })
  await random.locator('.section-head').click({ position: { x: 130, y: 10 } })
  await expect(page.getByTestId('section-note')).toContainText('按 L'); checks++
  await page.getByTestId('random-inspector').screenshot({ path: path.join(shots, `release-intro-note-${theme}.png`) })
  await page.getByTestId('right-tab-gen').click()
  await page.getByTestId('gen-button').click()
  await expect.poll(() => request).toBeTruthy()
  expect(request.parameters).toMatchObject({ steps: 23, width: 832, height: 1216, n_samples: 1 }); checks++
  expect(request.input).toContain('2girls'); checks++
  for (const text of ['cloud', 'sunlight', '1boy']) { expect(request.input).not.toContain(text); checks++ }
  expect(request.parameters.v4_prompt.caption.char_captions).toHaveLength(2); checks++
  expect(errors).toEqual([]); checks++
  console.log(`PASS release-intro ${theme}: ${checks} assertions; requests mocked`)
} finally {
  await browser.close()
  if (app) await app.close()
}
