// Keep the network abort even with a fake fetch: a mock miss must never reach paid NovelAI endpoints.
import { chromium } from '@playwright/test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { mkdirSync } from 'node:fs'
import { E2E_URL, isolate, resetStore } from './store.mjs'

const theme = process.argv[2] ?? 'light'
const out = process.argv[3] ?? 'e2e/shots'
mkdirSync(out, { recursive: true })
const MCP = new URL('/mcp', E2E_URL)

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 })
await isolate(ctx)
await ctx.route(/novelai\.net/, (route) => route.abort())
await ctx.addInitScript(() => {
  const real = window.fetch.bind(window)
  let fake = null
  window.__naiRequests = []
  window.__inflight = 0
  window.__maxInflight = 0
  window.__naiFail = 0
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
    const f = await fake
    if (!/generate-image|upscale|augment-image/.test(u)) return f(input, init)
    window.__inflight++
    window.__maxInflight = Math.max(window.__maxInflight, window.__inflight)
    const done = () => window.__inflight--
    if (window.__naiFail) {
      const status = window.__naiFail
      window.__naiFail = 0
      await new Promise((r) => setTimeout(r, 300))
      done()
      return new Response(JSON.stringify({ statusCode: status, message: status === 402 ? 'Not enough Anlas' : 'Too many requests' }), { status })
    }
    const res = await f(input, init)
    if (!res.body) return done(), res
    // Count a request as busy until its stream ends, or overlapping paid requests can escape detection.
    const body = res.body.pipeThrough(new TransformStream({ flush: done }))
    return new Response(body, { status: res.status, headers: res.headers })
  }
})
const page = await ctx.newPage()
const errors = []
page.on('console', (m) => m.type() === 'error' && !/novelai\.net|Failed to load resource|503|Service Unavailable/.test(m.text()) && errors.push(m.text()))
page.on('pageerror', (e) => errors.push(String(e)))
const fails = []
const check = (ok, msg) => (ok ? console.log('ok  ', msg) : (fails.push(msg), console.log('FAIL', msg)))
const tid = (id) => page.getByTestId(id)
const sent = () => page.evaluate(() => window.__naiRequests.filter((r) => !/subscription|encode-vibe/.test(r.url)).length)
const idle = () => page.waitForFunction(() => !document.querySelector('[data-testid=gen-button][data-running]'), null, { timeout: 30000 })
const store = (path) => `(await window.__peImport('${path}'))`
const setAgent = (patch) => page.evaluate(`(async () => ${store('/src/store/ai.ts')}.useAi.getState().setAgent(${JSON.stringify(patch)}))()`)
const shot = async (loc, name) => {
  await loc.screenshot({ path: `${out}/${name}-${theme}.png` })
  console.log('shot', `${out}/${name}-${theme}.png`)
}

async function open({ token = 'pst-test', prefs = {} } = {}) {
  await page.goto(E2E_URL)
  await resetStore(page, { theme, prefs: { historyOpen: true, ...prefs }, nai: token ? { state: { token }, version: 1 } : undefined })
  await page.reload()
  await page.waitForSelector('[data-testid=export-panel]', { timeout: 60000 })
  if (token) await page.waitForSelector('[data-testid=account-status][data-state=ok]')
  await page.addStyleTag({ content: '[data-sonner-toaster]{visibility:hidden!important}' })
  await setAgent({ on: true })
  await page.evaluate(`(async () => { ${store('/src/store/agent.ts')}.AGENT_GEN.gapMs = 0 })()`)
  await page.waitForFunction(async () => (await fetch('/mcp', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status !== 503, null, { timeout: 10000 })
}
async function connect(name = 'e2e-agent') {
  const c = new Client({ name, version: '1.0.0' })
  await c.connect(new StreamableHTTPClientTransport(MCP))
  return c
}
const call = async (c, name, args = {}) => {
  const r = await c.callTool({ name, arguments: args }, undefined, { timeout: 120000 })
  return { error: !!r.isError, text: r.content.filter((x) => x.type === 'text').map((x) => x.text).join(''), images: r.content.filter((x) => x.type === 'image') }
}
const jpegSize = (b64) =>
  page.evaluate(async (d) => {
    const img = new Image()
    img.src = `data:image/jpeg;base64,${d}`
    await img.decode()
    return [img.naturalWidth, img.naturalHeight]
  }, b64)

await open()
const c = await connect()
const tools = (await c.listTools()).tools
const gen = tools.find((t) => t.name === 'generate')
check(tools.length === 14 && !!gen && Object.keys(gen.inputSchema.properties ?? {}).join() === 'tab', `14 个工具，generate 只收 tab（${tools.map((t) => t.name).join(' ')}）`)

await page.evaluate(`(async () => ${store('/src/lib/settings-nav.ts')}.openSettings('ai'))()`)
const section = tid('agent-settings')
await section.waitFor()
await section.scrollIntoViewIfNeeded()
check((await tid('agent-gen').innerText()).includes('每次确认') && (await section.innerText()).includes('先确认再生成，0 Anlas 时也确认'), '设置：「出图时」默认每次确认 + 灰字')
await page.mouse.move(2, 890)
await page.waitForTimeout(300)
await shot(section, 'agent-gen-settings')
await tid('agent-gen').getByText('直接出图', { exact: true }).click()
check((await section.innerText()).includes('直接生成，可能花费 Anlas'), '切到直接出图：灰字换成「直接生成，可能花费 Anlas」')
await tid('agent-gen').getByText('每次确认', { exact: true }).click()
await tid('agent-on').click()
await page.waitForTimeout(300)
check((await tid('agent-sub').getAttribute('data-off')) === '' && (await tid('agent-sub').evaluate((el) => el.inert)), '开关关着：「出图时」跟着变淡、点不了')
await page.mouse.move(2, 890)
await shot(section, 'agent-gen-settings-off')
await tid('agent-on').click()
await page.waitForFunction(async () => (await fetch('/mcp', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status !== 503, null, { timeout: 10000 })

await page.evaluate(`(async () => ${store('/src/store/nai.ts')}.useNai.getState().set({ confirmSpend: false }))()`)
await page.evaluate(`(async () => ${store('/src/store/prefs.ts')}.usePrefs.getState().set({ rightTab: 'copy' }))()`)
const tabs = JSON.parse((await call(c, 'get_editor_state')).text).tabs
const target = tabs.find((t) => !t.active) ?? tabs[0]
check(/settings/.test(await page.evaluate(() => location.hash)), `开始时在设置页（${await page.evaluate(() => location.hash)}）`)
const n0 = await sent()
const pending = call(c, 'generate', { tab: target.tab })
await tid('gen-confirm').waitFor({ timeout: 10000 })
const pop = tid('gen-confirm')
check((await pop.getAttribute('data-agent')) === '' && (await pop.innerText()).startsWith('AI 代理请求生成'), `气泡：「AI 代理请求生成」（${(await pop.innerText()).split('\n')[0]}）`)
check((await pop.innerText()).includes('将按当前 prompt 和参数生成图片，结果加入历史') && (await tid('gen-confirm-price').innerText()).trim() === '0', '气泡：同一句说明，价格 0 照常显示')
check((await page.evaluate(() => location.hash.replace(/^#\/?/, ''))) === '' && (await tid('export-panel').getAttribute('data-tab')) === 'gen', '切到编辑器 + 右栏「图片生成」')
check(await page.evaluate(`(async () => ${store('/src/store/tabs.ts')}.useTabs.getState().activeId === ${JSON.stringify(target.tab)})()`), `切到那个 tab（${target.title}）`)
check((await sent()) === n0, '弹气泡时还没发请求')
const c2 = await connect('e2e-agent-2')
const second = await call(c2, 'generate', { tab: target.tab })
check(second.error && /already asking the user to confirm/.test(second.text), `问着的时候再调一次：立刻拒绝（${second.text.slice(0, 60)}）`)
await page.mouse.move(2, 890)
await page.waitForTimeout(300)
const box = await pop.boundingBox()
const btn = await tid('gen-button').boundingBox()
await page.screenshot({
  path: `${out}/agent-gen-confirm-${theme}.png`,
  clip: { x: Math.min(box.x, btn.x) - 16, y: box.y - 16, width: Math.max(box.x + box.width, btn.x + btn.width) - Math.min(box.x, btn.x) + 32, height: btn.y + btn.height - box.y + 32 },
})
console.log('shot', `${out}/agent-gen-confirm-${theme}.png`)
await tid('gen-confirm-run').click()
const done = await pending
const res = JSON.parse(done.text)
await idle()
const seedShown = Number(await tid('gen-image').getAttribute('data-seed'))
check(!done.error && res.tab === target.tab && typeof res.version === 'number', `点了生成：代理拿到 tab、版本 v${res.version}`)
check(res.images.length === 1 && res.images[0].seed === seedShown && res.images[0].width === 832 && res.images[0].height === 1216, `seed ${res.images[0]?.seed} = 历史里那张的 ${seedShown}，尺寸 832×1216`)
check(res.anlas_spent === 0 && typeof res.anlas_left === 'number', `花了 ${res.anlas_spent}，剩 ${res.anlas_left}`)
const [w, h] = done.images.length ? await jpegSize(done.images[0].data) : [0, 0]
check(done.images.length === 1 && done.images[0].mimeType === 'image/jpeg' && h === 768 && w === 525, `一张 JPEG，长边 768（${w}×${h}）`)
check((await sent()) === n0 + 1, '发了 1 个请求')

for (const how of ['cancel', 'escape']) {
  const n1 = await sent()
  const p = call(c, 'generate')
  await tid('gen-confirm').waitFor({ timeout: 10000 })
  if (how === 'cancel') await tid('gen-confirm-cancel').click()
  else await page.keyboard.press('Escape')
  const r = await p
  check(!r.error && /did not confirm/.test(JSON.parse(r.text).note) && (await sent()) === n1, `${how} 关掉：回「没有确认」，没发请求`)
}

await setAgent({ gen: 'direct' })
await tid('gen-button').click()
await page.waitForSelector('[data-testid=gen-button][data-running]')
const t0 = Date.now()
const busy = await call(c, 'generate')
check(busy.error && /already generating/.test(busy.text) && Date.now() - t0 < 3000, `正在出图时调：立刻回 busy（${Date.now() - t0}ms）`)
await idle()

await tid('params-button').click()
await tid('set-count-seg').getByText('2', { exact: true }).click()
await tid('params-button').click()
await page.waitForTimeout(500)
const price = Number((await tid('gen-price').innerText()).trim())
const n2 = await sent()
const pd = call(c, 'generate')
await page.waitForSelector('[data-testid=gen-button][data-running]', { timeout: 10000 })
check((await tid('gen-confirm').count()) === 0, '直接出图：不弹气泡')
const direct = await pd
const dres = JSON.parse(direct.text)
check(!direct.error && dres.images.length === 2 && direct.images.length === 2 && (await sent()) === n2 + 1, `直接出图：一个请求出 2 张，代理拿到 2 张图`)
check(price > 0 && dres.anlas_spent === price, `花的 Anlas = 底栏价格 ${price}（${dres.anlas_spent}）`)
await idle()

for (const [status, re] of [[402, /Not enough Anlas \(402\)/], [429, /\(429\)/]]) {
  await page.evaluate((s) => (window.__naiFail = s), status)
  const r = await call(c, 'generate')
  check(r.error && re.test(r.text) && r.images.length === 0, `${status}：${r.text.slice(0, 70)}`)
  await idle()
}

await setAgent({ gen: 'confirm' })
await page.evaluate(`(async () => ${store('/src/store/prefs.ts')}.usePrefs.getState().set({ assistW: 520 }))()`)
await page.setViewportSize({ width: 1100, height: 900 })
await page.waitForTimeout(500)
const pn = call(c, 'generate')
await tid('confirm-dialog').waitFor({ timeout: 10000 })
check((await tid('confirm-dialog').innerText()).includes('AI 代理请求生成') && (await tid('gen-confirm').count()) === 0, '右栏放不下：弹确认框「AI 代理请求生成」')
await tid('confirm-cancel').click()
const narrow = await pn
check(!narrow.error && /did not confirm/.test(narrow.text), '确认框取消：回「没有确认」')
await page.setViewportSize({ width: 1440, height: 900 })

check((await page.evaluate(() => window.__maxInflight)) === 1, `全程同一时间最多 1 个出图请求（${await page.evaluate(() => window.__maxInflight)}）`)
await c.close()
await c2.close()

await open({ token: '' })
const c3 = await connect()
const nt = await call(c3, 'generate')
check(nt.error && /No NovelAI token/.test(nt.text) && (await tid('gen-confirm').count()) === 0, `没令牌：${nt.text.slice(0, 60)}`)
await c3.close()

console.log(fails.length ? `\n${fails.length} FAIL` : '\nall ok', 'errors', errors.length ? errors : 'none')
await browser.close()
process.exit(fails.length ? 1 : 0)
