// One-off README screenshots: node e2e/shots/_readme.mjs <zh|en> <editor|ai> [outDir]
// Needs a test server (E2E_URL, e.g. node scripts/dev.mjs --test --port 5191). NAI and the AI service are mocked.
import { chromium } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { Packr } from 'msgpackr'
import { GOOD_KEY, startFakeAi } from '../fake-ai.mjs'
import { E2E_URL, isolate, resetStore } from '../store.mjs'

const lang = process.argv[2] ?? 'zh'
const shot = process.argv[3] ?? 'editor'
const out = process.argv[4] ?? 'assets/readme'
const chipLang = lang === 'en' ? 'en' : (process.env.ZH_CHIP ?? 'en-zh')
// Both shots come out 1600x1000; the AI shot needs a wider window so the editor column does not truncate.
const W = Number(process.env.SHOT_W ?? (shot === 'ai' ? 1440 : 1280))
const H = W * 0.625
const DSF = Number(process.env.SHOT_DSF ?? 1600 / W)
mkdirSync(out, { recursive: true })

const fake = await startFakeAi()
const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: DSF })
await isolate(ctx)
const page = await ctx.newPage()
const errors = []
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
page.on('pageerror', (e) => errors.push(String(e)))
if (process.env.DEBUG) page.on('console', (m) => console.log('[console]', m.type(), m.text()))

// Generated images are the app's own painted examples, served through a mocked NAI stream.
const images = []
const packr = new Packr({ useRecords: false })
await ctx.route(/novelai\.net/, async (route) => {
  const u = route.request().url()
  if (u.endsWith('/user/subscription'))
    return route.fulfill({ json: { tier: 3, active: true, expiresAt: 4102444800, trainingStepsLeft: { fixedTrainingStepsLeft: 10000, purchasedTrainingSteps: 0 } }, headers: { 'access-control-allow-origin': '*' } })
  if (u.includes('/ai/generate-image-stream')) {
    const payload = packr.pack({ event_type: 'final', samp_ix: 0, gen_id: `r${images.length}`, image: images.shift() })
    const frame = Buffer.alloc(4 + payload.length)
    frame.writeUInt32BE(payload.length)
    payload.copy(frame, 4)
    return route.fulfill({ status: 200, body: frame, contentType: 'application/octet-stream', headers: { 'access-control-allow-origin': '*' } })
  }
  return route.abort()
})

// The chat shows the DeepSeek preset; its requests are redirected to the local fake service.
await ctx.route('**/api/ai/**', (route) => {
  const body = route.request().postDataJSON()
  if (body?.url) body.url = fake.url
  if (body?.service?.url) body.service.url = fake.url
  return route.continue({ postData: JSON.stringify(body) })
})

const T = (id) => page.getByTestId(id)
await page.goto(E2E_URL)
await T('status-bar').waitFor()
await resetStore(page, { theme: 'dark', prefs: { chipLang, rightTab: 'gen', assistOpen: process.env.ASSIST === '1', historyOpen: process.env.HISTORY !== '0' }, seed: null, nai: { state: { token: 'pst-readme' }, version: 1 } })
await page.reload()
await T('status-bar').waitFor()

// The dev build opens a blank tab; release opens introDoc, so swap it in.
await page.evaluate(async () => {
  const { introDoc } = await window.__peImport('/src/store/sample.ts')
  const tabs = await window.__peImport('/src/store/tabs.ts')
  const s = tabs.useTabs.getState()
  const blank = s.activeId
  const id = s.newTab()
  tabs.useTabs.getState().openInTab(id, introDoc())
  tabs.useTabs.getState().closeTab(blank)
})
await page.waitForTimeout(400)

// Flat "SAMPLE" placeholders, so the screenshots don't suggest what real output looks like.
// Three neutral tones keep the history thumbnails distinguishable; the last one is the large preview.
const paint = (tones) =>
  page.evaluate((tones) => {
    return tones.map(([bg, fg]) => {
      const c = document.createElement('canvas')
      c.width = 832
      c.height = 1216
      const g = c.getContext('2d')
      g.fillStyle = bg
      g.fillRect(0, 0, 832, 1216)
      g.fillStyle = fg
      g.font = '700 150px "Segoe UI", Arial, sans-serif'
      g.textAlign = 'center'
      g.textBaseline = 'middle'
      g.fillText('SAMPLE', 416, 608)
      return c.toDataURL('image/png').split(',')[1]
    })
  }, tones)
const TONES = [
  ['#a7abb2', '#2b2e33'],
  ['#4a4e55', '#d9dce0'],
  ['#6e737b', '#eceef0'],
]
for (const b64 of await paint(TONES)) images.push(Buffer.from(b64, 'base64'))

if (await T('right-tab-gen').count()) await T('right-tab-gen').click()
await page.waitForSelector('[data-testid=account-status][data-state=ok]', { timeout: 15000 }).catch(async () => {
  await page.screenshot({ path: `${out}/debug-${lang}.png` })
  throw new Error('NAI account not ready')
})
const total = images.length
for (let i = 0; i < total; i++) {
  await T('gen-button').click()
  if (await T('gen-confirm').isVisible().catch(() => false)) await T('gen-confirm-run').click()
  await page.waitForSelector('[data-testid=gen-image]', { timeout: 15000 })
  await page.waitForFunction(() => !document.querySelector('[data-testid=gen-button][data-running]'), null, { timeout: 15000 })
  await page.waitForTimeout(600)
}
await page.addStyleTag({ content: '[data-sonner-toaster] { visibility: hidden !important }' })
await page.mouse.move(W / 2, H - 4)
await page.waitForTimeout(500)
if (shot === 'editor') {
  await page.screenshot({ path: `${out}/editor-${lang}.png` })
  console.log('shot', `${out}/editor-${lang}.png`)
}

// AI edit preview.
await page.evaluate(
  async ({ url, key }) => {
    const { useAi } = await window.__peImport('/src/store/ai.ts')
    useAi.getState().saveService({ id: 'ai_fake', preset: 'deepseek', url: '', model: 'deepseek-chat', key })
    useAi.getState().setCurrent('ai_fake')
  },
  { url: fake.url, key: GOOD_KEY },
)
if (shot === 'editor') {
  console.log(errors.length ? `console errors:\n${errors.join('\n')}` : 'no console errors')
  await browser.close()
  await fake.close()
  process.exit(0)
}
await T('rail-ai').click()
await T('ai-chat').waitFor()
const doc = await page.evaluate(async () => {
  const t = await window.__peImport('/src/store/tabs.ts')
  return t.getDocStore(t.useTabs.getState().activeId).getState().doc
})
const fmt = (c) => (c.weight !== 1 ? `${c.weight}::${c.text}::` : c.text)
const scene = doc.base.prompt.find((s) => s.name === '场景')
const sceneTags = scene.chips.filter((c) => !c.disabled).map(fmt)
const light = doc.base.prompt.find((s) => s.name === '光照')
const change = {
  $schema: 'pe-doc-ai/2',
  prompt: [
    { id: scene.id, tags: [...sceneTags.filter((t) => !/blue sky|day/.test(t)), 'night', 'starry sky', 'falling petals'] },
    ...(light ? [{ id: light.id, tags: ['moonlight', 'soft lighting'] }] : []),
  ],
}
// The en set uses English conversation text; the interface itself stays Chinese.
const chat =
  lang === 'en'
    ? {
        ask: 'Change the background to night, with cherry blossoms falling in the moonlight',
        reply: 'Changed to a night scene:\n\n- Scene: removed the daytime sky and added `night`, `starry sky` and `falling petals`\n- Lighting: replaced with moonlight and soft lighting',
      }
    : {
        ask: '背景改成夜晚，樱花在月光下飘落',
        reply: '改为夜景：\n\n- 场景：去掉白天的天空，加入 `night`、`starry sky` 和 `falling petals`\n- 光照：改为月光与柔光',
      }
const text = `${chat.reply}\n\n\`\`\`json\n${JSON.stringify(change)}\n\`\`\``
fake.reply({ text, chunks: 6, delayMs: 30 })
await T('ai-chat-input').fill(chat.ask)
await T('ai-chat-input').press('Enter')
await page.waitForFunction(() => document.querySelectorAll('[data-testid=ai-chat-ai]').length === 1 && !document.querySelector('[data-testid=ai-chat-streaming]'), null, { timeout: 10000 })
if (process.env.PREVIEW_DIALOG === '1') {
  await T('ai-change-card').last().getByTestId('ai-chat-card-preview').click()
  await T('ai-import').waitFor()
}
await page.mouse.move(W / 2, H - 4)
await page.waitForTimeout(600)
await page.screenshot({ path: `${out}/ai-edit-${lang}.png` })
console.log('shot', `${out}/ai-edit-${lang}.png`)

console.log(errors.length ? `console errors:\n${errors.join('\n')}` : 'no console errors')
await browser.close()
await fake.close()
