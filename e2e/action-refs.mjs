// Keep the network abort even with a fake fetch: a mock miss must never reach paid NovelAI endpoints.
import { chromium } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { E2E_URL, isolate, resetStore } from './store.mjs'

const theme = process.argv[2] ?? 'light'
const prefix = process.argv[3] ?? 'action-refs'
const width = Number(process.argv[4] ?? 1600)
const height = 960
const out = 'e2e/shots'
mkdirSync(out, { recursive: true })

const browser = await chromium.launch()
const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 })
await isolate(context)
await context.route(/novelai\.net/, (route) => route.abort())
await context.addInitScript(() => {
  const real = window.fetch.bind(window)
  let fake = null
  window.__naiRequests = []
  window.fetch = async (input, init) => {
    const u = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if (!u.includes('novelai.net')) return real(input, init)
    if (!fake) {
      const mine = window.fetch
      fake = import('/scripts/try-nai-fake.js').then(() => {
        const theirs = window.fetch
        window.fetch = mine
        return theirs
      })
    }
    return (await fake)(input, init)
  }
})
const page = await context.newPage()
const errors = []
page.on('console', (m) => m.type() === 'error' && !/novelai\.net|Failed to load resource/.test(m.text()) && errors.push(m.text()))
page.on('pageerror', (e) => errors.push(String(e)))

const fails = []
const check = (ok, msg) => (ok ? console.log('ok  ', msg) : (fails.push(msg), console.log('FAIL', msg)))
const suffix = `${theme}-${width}`
const clip = async (loc, name, pad = 0) => {
  await page.waitForTimeout(300)
  const b = await loc.boundingBox()
  const file = `${out}/${prefix}-${name}-${suffix}.png`
  await page.screenshot({ path: file, clip: { x: Math.max(0, b.x - pad), y: Math.max(0, b.y - pad), width: b.width + pad * 2, height: b.height + pad * 2 } })
  console.log('clip', file)
}
const tid = (id) => page.getByTestId(id)
const requests = () => page.evaluate(() => window.__naiRequests)
const idle = () => page.waitForFunction(() => !document.querySelector('[data-testid=gen-button][data-running]'), null, { timeout: 30000 })
const away = () => page.mouse.move(2, height - 40)
const dropFile = async (color, w = 600, h = 800) => {
  await page.evaluate(
    async ([color, w, h]) => {
      const c = new OffscreenCanvas(w, h)
      const g = c.getContext('2d')
      g.fillStyle = color
      g.fillRect(0, 0, w, h)
      const blob = await c.convertToBlob({ type: 'image/png' })
      const dt = new DataTransfer()
      dt.items.add(new File([blob], 'ref.png', { type: 'image/png' }))
      for (const t of ['dragenter', 'dragover', 'drop']) window.dispatchEvent(new DragEvent(t, { dataTransfer: dt, bubbles: true, cancelable: true }))
    },
    [color, w, h],
  )
  await page.waitForSelector('[data-testid=image-intake]')
}
const openConfirm = async (action) => {
  await tid(`tool-${action}`).click()
  await page.waitForSelector(`[data-testid=tool-confirm][data-action=${action}]`)
  await page.waitForTimeout(250)
  const refs = (await tid('tool-confirm-refs').count()) ? await tid('tool-confirm-refs').innerText() : null
  return { refs, price: (await tid('tool-run-price').innerText()).trim() }
}
const runConfirm = async () => {
  await page.evaluate(() => (window.__naiRequests.length = 0))
  await tid('tool-run').click()
  await page.waitForTimeout(300)
  await idle()
  await page.waitForTimeout(400)
  return requests()
}
const genReq = (reqs) => reqs.find((r) => r.url === 'ai/generate-image-stream')?.req
const pickVersion = async (v) => {
  if ((await tid('history-head').getAttribute('aria-expanded')) === 'false') await tid('history-head').click()
  await page.waitForTimeout(300)
  await page.locator(`[data-testid=gen-history] [data-testid=history-group][data-version="${v}"] [data-testid=history-item]`).first().click()
  await page.waitForTimeout(300)
}

await page.goto(E2E_URL)
await page.waitForLoadState('networkidle')
await resetStore(page, { theme, nai: { state: { token: 'pst-test' }, version: 1 } })
await page.reload()
await page.waitForSelector('[data-testid=account-status][data-state=ok]', { timeout: 60000 })

await tid('gen-button').click()
await page.waitForSelector('[data-testid=gen-image]', { timeout: 30000 })
await idle()
await page.waitForTimeout(300)
let c = await openConfirm('enhance')
check(c.refs === null, `V5 没有参考图：确认框没有那一行（${c.refs}）`)
await clip(tid('tool-confirm'), '0-enhance-plain', 8)
await tid('tool-cancel').click()

await dropFile('#c87')
await tid('intake-ref-vibe').click()
await page.waitForSelector('[data-testid=refs-vibe] [data-testid=ref-tile]')
await page.waitForTimeout(400)
await away()
c = await openConfirm('enhance')
check(c.refs === '将带上 Vibe Transfer 1 张', `Enhance 用当前的参考图：确认框写「${c.refs}」`)
const enhancePlain = Number(c.price)
const confirmParts = tid('tool-confirm').getByTestId('gen-price-parts')
const parts = (await confirmParts.innerText()).replace(/\s+/g, ' ')
check(parts.includes('Enhance') && parts.includes('Vibe 编码 1 张'), `确认框正文拆价（${parts}）`)
check(/Vibe 编码 1 张 2/.test(parts) && Number(c.price) === Number(parts.match(/Enhance (\d+)/)?.[1]) + 2, 'Enhance 的总价 = 动作价 + 编码 2')
check((await confirmParts.boundingBox()).y > (await tid('tool-confirm-refs').boundingBox()).y, '额外费用列在参考图说明下')
check(await tid('tool-enhance-noise').isVisible() && (await tid('tool-enhance-noise').locator('../..').innerText()).includes('0'), 'Enhance 噪声滑杆和数值可见')
check((await page.locator('[data-slot=tooltip-content]').count()) === 0, '打开确认框时没有悬停提示')
await clip(tid('tool-confirm'), '1-enhance-vibe', 8)
let reqs = await runConfirm()
const enc = reqs.filter((r) => r.url === 'ai/encode-vibe')
let g = genReq(reqs)
check(enc.length === 1 && enc[0].req.model === 'nai-diffusion-4-5-full', `Enhance：先编码 1 次（${JSON.stringify(enc.map((r) => r.req.model))}）`)
check(g?.action === 'img2img' && g.model === 'nai-diffusion-4-5-full' && g.parameters.reference_image_multiple_cached?.[0]?.data === 'ref_multiple_0', `Enhance：img2img + reference_*（${g?.model}）`)
check(g?.parameters.strength === 0.5, `Enhance：强度是 Enhance 的 0.5，不是文档底图的（${g?.parameters.strength}）`)

await away()
await pickVersion(1)
c = await openConfirm('variations')
check(c.refs === null, `变体用原图那一版的：v1 没有参考图，不写那一行（${c.refs}）`)
reqs = await runConfirm()
g = genReq(reqs)
check(g && !g.parameters.reference_image_multiple_cached && !g.parameters.director_reference_images_cached && g.model === 'nai-diffusion-5-full', `变体 v1：请求不带参考图、V5（${g?.model}）`)

await away()
await tid('gen-button').click()
await idle()
await page.waitForTimeout(400)
c = await openConfirm('variations')
check(c.refs === '将带上 Vibe Transfer 1 张', `变体 v2：写「${c.refs}」`)
check((await confirmParts.count()) === 0, '编过的 Vibe（1 张）不加钱：确认框没有拆价')
await clip(tid('tool-confirm'), '2-variations-vibe', 8)
reqs = await runConfirm().catch(async () => (await openConfirm('variations'), runConfirm()))
g = genReq(reqs)
check(!reqs.some((r) => r.url === 'ai/encode-vibe') && g?.parameters.reference_image_multiple_cached?.length === 1, '变体 v2：不再编码、带 Vibe')

await away()
await dropFile('#99c', 600, 900)
await tid('intake-ref-character').click()
await page.waitForSelector('[data-testid=refs-character] [data-testid=ref-tile]')
await page.waitForTimeout(400)
await away()
c = await openConfirm('enhance')
check(c.refs === '将带上精准参考 1 张', `有精准参考：Vibe 不算（${c.refs}）`)
check(Number(c.price) >= 5, `价格含精准参考 5（${c.price}，没有时 ${enhancePlain}）`)
const charParts = (await confirmParts.innerText()).replace(/\s+/g, ' ')
check(/精准参考 5/.test(charParts) && Number(c.price) === Number(charParts.match(/Enhance (\d+)/)?.[1]) + 5, 'Opus Enhance 总价 = 动作价 + 精准参考 5')
await clip(tid('tool-confirm'), '3-enhance-char', 8)
reqs = await runConfirm()
g = genReq(reqs)
check(g?.parameters.director_reference_images_cached?.[0]?.data === 'director_ref_0' && !g.parameters.reference_image_multiple_cached, 'Enhance：director_*、不发 Vibe')

await page.evaluate(async () => {
  const t = await window.__peImport('/src/store/tabs.ts')
  t.getDocStore(t.useTabs.getState().activeId).getState().updateSettings({ model: 'v5-full' })
})
await page.waitForTimeout(300)
c = await openConfirm('enhance')
check(c.refs === null && (await confirmParts.count()) === 0, 'V5 保留参考图但不带上、不加参考图费用')
await tid('tool-cancel').click()

check(errors.length === 0, `没有 console 报错（${errors.slice(0, 3).join(' | ')}）`)
console.log(fails.length ? `\n${fails.length} 项失败` : '\n全部通过')
await browser.close()
process.exit(fails.length ? 1 : 0)
