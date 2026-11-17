// Keep the network abort even with a fake fetch: a mock miss must never reach paid NovelAI endpoints.
import { chromium } from '@playwright/test'
import { E2E_URL, isolate, resetStore } from './store.mjs'

const theme = process.argv[2] ?? 'light'
const browser = await chromium.launch()
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 })
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
const tid = (id) => page.getByTestId(id)
const sent = () => page.evaluate(() => window.__naiRequests.filter((r) => !/subscription|encode-vibe/.test(r.url)).length)
const idle = () => page.waitForFunction(() => !document.querySelector('[data-testid=gen-button][data-running]'), null, { timeout: 30000 })
const setCount = async (n) => {
  await tid('params-button').click()
  await tid('set-count-seg').getByText(String(n), { exact: true }).click()
  await tid('params-button').click()
  await page.waitForTimeout(400)
}

async function open(prefs = {}) {
  await page.goto(E2E_URL)
  await resetStore(page, { theme, prefs: { historyOpen: true, ...prefs }, nai: { state: { token: 'pst-test' }, version: 1 } })
  await page.reload()
  await page.waitForSelector('[data-testid=export-panel]', { timeout: 60000 })
  await page.waitForSelector('[data-testid=account-status][data-state=ok]')
  await page.addStyleTag({ content: '[data-sonner-toaster]{visibility:hidden!important}' })
}

await open({ rightTab: 'copy' })
check((await tid('copy-nai-image').innerText()).trim() === '复制为 NAI 图', `提示词复制底栏写「复制为 NAI 图」（${await tid('copy-nai-image').innerText()}）`)
await page.getByTestId('right-tab-gen').click()

check((await tid('gen-price').innerText()).trim() === '0', '默认 1 张：价格 0')
await tid('gen-button').click()
await page.waitForSelector('[data-testid=gen-image]', { timeout: 30000 })
await idle()
check((await tid('gen-confirm').count()) === 0 && (await sent()) === 1, '价格 0：不确认，直接发出 1 个请求')

await setCount(4)
const price = (await tid('gen-price').innerText()).trim()
check(Number(price) > 0, `4 张：价格 ${price}`)
await tid('gen-button').click()
await page.waitForSelector('[data-testid=gen-confirm]')
check((await tid('gen-confirm').innerText()).includes('将按当前 prompt 和参数生成 4 张图片，结果加入历史'), '确认框：一句说明带张数')
check((await tid('gen-confirm-price').innerText()).trim() === price, `确认框按钮上的价格 = 底栏的 ${price}`)
check(await tid('gen-confirm-run').evaluate((el) => el === document.activeElement), '确认框：焦点在「生成」上')
check((await sent()) === 1, '弹确认框时还没发请求')
await tid('gen-confirm-cancel').click()
await page.waitForSelector('[data-testid=gen-confirm]', { state: 'detached' })
check((await sent()) === 1, '取消：不发请求')
for (const dismiss of ['escape', 'outside']) {
  await tid('gen-button').click()
  await tid('gen-confirm').waitFor()
  if (dismiss === 'escape') await page.keyboard.press('Escape')
  else await page.mouse.click(600, 40)
  await tid('gen-confirm').waitFor({ state: 'detached' })
  check((await sent()) === 1, `${dismiss} 收起确认且不发请求`)
}
for (const input of [tid('doc-title'), page.getByTestId('tag-input').first()]) {
  await input.focus()
  await page.keyboard.press('Control+Enter')
  await tid('gen-confirm').waitFor()
  await page.keyboard.press('Escape')
  await tid('gen-confirm').waitFor({ state: 'detached' })
  await page.waitForTimeout(250)
  check(await input.evaluate((el) => el === document.activeElement) && (await sent()) === 1, 'Ctrl+Enter 从输入框打开，Esc 返回原焦点且不发请求')
}

await page.getByTestId('right-tab-copy').click()
const title = page.getByTestId('doc-title')
await title.click()
await page.keyboard.press('Control+Enter')
await page.waitForSelector('[data-testid=gen-confirm]')
check((await tid('export-panel').getAttribute('data-tab')) === 'gen', 'Ctrl+↵（在提示词复制）：切到图片生成再问')
await page.keyboard.press('Enter')
await page.waitForTimeout(150)
check((await sent()) === 1 && (await tid('gen-confirm').count()) === 1, '刚弹出马上按 ↵：不算，确认框还在')
await page.waitForTimeout(400)
await page.keyboard.down('Enter')
await page.keyboard.down('Enter')
await page.keyboard.down('Enter')
await page.keyboard.up('Enter')
await page.waitForTimeout(300)
await idle()
check((await sent()) === 2, `过了 350ms 按 ↵：发出 1 个请求，按住的自动重复不再发（共 ${await sent()}）`)
check(await title.evaluate((el) => el === document.activeElement), 'Ctrl+↵ 问完：焦点回到标题框')

const before = await sent()
await tid('tool-variations').focus()
await page.keyboard.press('Enter')
await page.waitForTimeout(120)
await page.keyboard.press('Enter')
await page.waitForTimeout(200)
check((await tid('tool-confirm').count()) === 1 && (await sent()) === before, '变体：↵ 后 120ms 再 ↵，确认框还在、没发请求')
await page.keyboard.press('Escape')
await page.waitForSelector('[data-testid=tool-confirm]', { state: 'detached' })
await tid('tool-variations').focus()
await page.keyboard.down('Enter')
for (let i = 0; i < 4; i++) await page.keyboard.down('Enter')
await page.keyboard.up('Enter')
await page.waitForTimeout(200)
check((await sent()) === before, '变体：按住 ↵ 越不过确认框')
await page.waitForTimeout(300)
await page.keyboard.press('Enter')
await idle()
check((await sent()) === before + 1, '变体：过一会儿 ↵ 才跑')

const startElsewhere = () =>
  page.evaluate(async () => {
    const { useGen } = await window.__peImport('/src/store/gen.ts')
    const { useTabs } = await window.__peImport('/src/store/tabs.ts')
    void useGen.getState().generate(useTabs.getState().activeId)
  })
const asked = await page.locator('[data-testid=history-item][data-current]').getAttribute('data-id')
await tid('tool-enhance').click()
await tid('tool-confirm').waitFor()
await startElsewhere()
await page.waitForSelector('[data-testid=tool-confirm]', { state: 'detached' })
await idle()
await page.waitForTimeout(500)
check((await tid('tool-confirm').count()) === 0, 'Enhance 确认框开着时别处开始出图：收起，出完不再弹出')
await page.locator(`[data-testid=history-item][data-id="${asked}"]`).click()
await page.waitForTimeout(500)
check((await tid('tool-confirm').count()) === 0, '切回问的那张图：确认框也不再弹出')
await tid('gen-button').click()
await tid('gen-confirm').waitFor()
await startElsewhere()
await page.waitForSelector('[data-testid=gen-confirm]', { state: 'detached' })
await idle()
await page.waitForTimeout(500)
check((await tid('gen-confirm').count()) === 0, '生成确认框同样：出完不再弹出')

await tid('tool-inpaint').click()
await tid('inpaint-editor').waitFor()
await page.evaluate(async () => (await window.__peImport('/src/store/inpaint.ts')).editMask((m) => m.grid.fill(1)))
await page.waitForTimeout(1000)
const before2 = await sent()
await tid('inpaint-button').click()
await tid('inpaint-confirm').waitFor()
await page.keyboard.press('Enter')
await page.waitForTimeout(150)
await page.keyboard.press('Enter')
await page.waitForTimeout(200)
check((await tid('inpaint-confirm').count()) === 1 && (await sent()) === before2, '重绘：编辑界面开了 1 秒后点「重绘」，马上 ↵↵ 不跑，确认框还在')
await page.waitForTimeout(300)
await page.keyboard.press('Enter')
await idle()
check((await sent()) === before2 + 1 && (await tid('inpaint-editor').count()) === 0, '重绘：过一会儿 ↵ 才跑')

await page.evaluate(async () => (await window.__peImport('/src/lib/settings-nav.ts')).openSettings('gen'))
await page.waitForSelector('[data-testid=set-confirm-spend]')
const row = tid('gen-settings')
check((await row.innerText()).includes('生成前确认') && (await row.innerText()).includes('需花费 Anlas 时先确认'), '设置 → 出图：「生成前确认」默认开')
await tid('set-confirm-spend').click()
check((await row.innerText()).includes('直接生成；放大、Enhance 等仍先确认'), '关了：说明换成「直接生成；放大、Enhance 等仍先确认」')
await page.evaluate(() => (location.hash = '#/'))
await page.waitForSelector('[data-testid=gen-button]')
const n0 = await sent()
await tid('gen-button').click()
await page.waitForTimeout(300)
check((await tid('gen-confirm').count()) === 0 && (await sent()) === n0 + 1, '关了：价格 > 0 直接生成')
await idle()

await open({ assistW: 520 })
await setCount(4)
await page.setViewportSize({ width: 1100, height: 900 })
await page.waitForTimeout(500)
const railed = (await tid('export-rail').count()) === 1
check(railed, '1100 宽、左栏 520：右栏收成窄边')
await page.getByTestId('doc-title').click()
await page.keyboard.press('Control+Enter')
await page.waitForSelector('[data-testid=confirm-dialog]')
const dlg = tid('confirm-dialog')
check((await dlg.innerText()).includes('将按当前 prompt 和参数生成 4 张图片'), '弹窗：同一句说明')
check(await tid('confirm-ok').evaluate((el) => el === document.activeElement && el.innerText.includes('生成')), '弹窗：焦点在「生成 N◆」上')
const n1 = await sent()
await tid('confirm-cancel').click()
await page.waitForTimeout(300)
check((await sent()) === n1, '弹窗取消：不发请求')

console.log(fails.length ? `\n${fails.length} FAIL` : '\nall ok', 'errors', errors.length ? errors : 'none')
await browser.close()
process.exit(fails.length ? 1 : 0)
