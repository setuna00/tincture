// Playwright route fulfillment buffers the body, so mock fetch must emit incremental length-prefixed msgpack frames.
import { chromium } from '@playwright/test'
import { Packr } from 'msgpackr'
import { mkdirSync, readFileSync } from 'node:fs'
import { E2E_URL, isolate, resetStore } from './store.mjs'

const theme = process.argv[2] ?? 'light'
const prefix = process.argv[3] ?? 'gen'
const width = Number(process.argv[4] ?? 1920)
const height = width >= 1920 ? 1000 : 900
const out = 'e2e/shots'
mkdirSync(out, { recursive: true })
const url = E2E_URL
const only = process.env.ONLY ?? ''

const browser = await chromium.launch()
const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, acceptDownloads: true })
await isolate(context)
await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(url).origin })
const page = await context.newPage()
const errors = []
page.on('console', (m) => m.type() === 'error' && !/novelai\.net|Failed to load resource/.test(m.text()) && errors.push(m.text()))
page.on('pageerror', (e) => errors.push(String(e)))

// Keep the network abort even with a fake fetch: a mock miss must never reach paid NovelAI endpoints.
const SUB = { tier: 3, active: true, expiresAt: 4102444800, trainingStepsLeft: { fixedTrainingStepsLeft: 1000, purchasedTrainingSteps: 1340 }, usage: { percent: 63, purchasedPercent: 0, timeUntilNextPercent: 4320, isNegative: false } }
let subscription = SUB
let subStatus = 200
const naiHits = []
await context.route(/novelai\.net/, (route) => {
  const u = route.request().url()
  naiHits.push(`${route.request().method()} ${u}`)
  if (u.endsWith('/user/subscription')) return route.fulfill({ status: subStatus, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(subStatus === 200 ? subscription : { statusCode: subStatus, message: 'Unauthorized' }) })
  return route.abort()
})

await context.addInitScript(() => {
  const real = window.fetch.bind(window)
  window.__naiRequests = []
  window.fetch = async (input, init) => {
    const u = typeof input === 'string' ? input : input.url
    if (!u.includes('novelai.net/ai/generate-image-stream')) return real(input, init)
    const form = init?.body
    const req = form instanceof FormData ? JSON.parse(await form.get('request').text()) : null
    window.__naiRequests.push({ headers: init?.headers, req })
    const m = window.__naiMock ?? {}
    if (m.status && m.status !== 200) return new Response(JSON.stringify({ statusCode: m.status, message: m.message ?? 'error' }), { status: m.status })
    const frames = (m.frames ?? []).map((b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)))
    const delay = m.delay ?? 60
    const body = new ReadableStream({
      async start(ctl) {
        for (const f of frames) {
          await new Promise((r) => setTimeout(r, delay))
          const cut = Math.floor(f.length / 2)
          ctl.enqueue(f.subarray(0, cut))
          ctl.enqueue(f.subarray(cut))
        }
        ctl.close()
      },
    })
    return new Response(body, { status: 200 })
  }
})

const fails = []
const check = (ok, msg) => (ok ? console.log('ok  ', msg) : (fails.push(msg), console.log('FAIL', msg)))
const suffix = `${theme}-${width}`
const shot = async (name) => {
  await page.waitForTimeout(350)
  await page.mouse.move(2, height - 60)
  await page.waitForTimeout(200)
  const file = `${out}/${prefix}-${name}-${suffix}.png`
  await page.screenshot({ path: file })
  console.log('shot', file)
}
const clip = async (loc, name, pad = 0) => {
  await page.waitForTimeout(250)
  const b = await loc.boundingBox()
  const file = `${out}/${prefix}-${name}-${suffix}.png`
  await page.screenshot({ path: file, clip: { x: Math.max(0, b.x - pad), y: Math.max(0, b.y - pad), width: b.width + pad * 2, height: b.height + pad * 2 } })
  console.log('clip', file)
}

async function open({ token = '' } = {}) {
  await page.goto(url)
  await resetStore(page, { theme, prefs: { historyOpen: true }, nai: token ? { state: { token }, version: 1 } : undefined })
  await page.reload()
  await page.waitForSelector('[data-testid=export-panel]', { timeout: 60000 })
  await page.waitForTimeout(600)
  await page.addStyleTag({ content: '[data-sonner-toaster]{visibility:hidden!important}' })
}

// NAI stores image metadata in alpha low bits; mock WebP images must retain it for import round trips.
async function makeImages(n, seed0) {
  return page.evaluate(
    async ({ n, seed0 }) => {
      const { stealthPayload, writeStealthAlpha } = await import('/src/lib/nai-write.ts')
      const toB64 = async (blob) => {
        const b = new Uint8Array(await blob.arrayBuffer())
        let s = ''
        for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000))
        return btoa(s)
      }
      const draw = (w, h, hue, label, blur) => {
        const c = new OffscreenCanvas(w, h)
        const g = c.getContext('2d')
        const grd = g.createLinearGradient(0, 0, w, h)
        grd.addColorStop(0, `hsl(${hue} 70% 62%)`)
        grd.addColorStop(1, `hsl(${(hue + 60) % 360} 70% 40%)`)
        g.fillStyle = grd
        g.fillRect(0, 0, w, h)
        g.fillStyle = 'rgba(255,255,255,.85)'
        g.font = `600 ${Math.round(w / 9)}px sans-serif`
        g.textAlign = 'center'
        g.fillText(label, w / 2, h / 2)
        if (blur) g.filter = 'blur(6px)'
        return { c, g }
      }
      const finals = []
      const inter = []
      for (let i = 0; i < n; i++) {
        const seed = seed0 + i
        const { c, g } = draw(832, 1216, 200 + i * 50, `#${i + 1} s-${seed}`)
        const meta = { Description: '1girl', Software: 'NovelAI', Source: 'NovelAI Diffusion V5 0ADF9AB7', Comment: JSON.stringify({ prompt: '1girl', seed, steps: 23, width: 832, height: 1216 }) }
        const img = g.getImageData(0, 0, 832, 1216)
        writeStealthAlpha(img.data, 832, 1216, await stealthPayload(meta))
        g.putImageData(img, 0, 0)
        finals.push(await toB64(await c.convertToBlob({ type: 'image/webp', quality: 1 })))
        const small = draw(208, 304, 200 + i * 50, `${i + 1}`).c
        inter.push(await toB64(await small.convertToBlob({ type: 'image/jpeg', quality: 0.6 })))
      }
      return { finals, inter }
    },
    { n, seed0 },
  )
}

const packr = new Packr({ useRecords: false })
const frame = (obj) => {
  const body = packr.pack(obj)
  const f = Buffer.alloc(4 + body.length)
  f.writeUInt32BE(body.length, 0)
  body.copy(f, 4)
  return f.toString('base64')
}
function framesFor({ finals, inter }, steps = 23) {
  const fs = []
  for (let s = 0; s < steps; s++) for (let i = 0; i < finals.length; i++) fs.push(frame({ event_type: 'intermediate', samp_ix: i, step_ix: s, gen_id: 'g', sigma: 1, image: Buffer.from(inter[i], 'base64') }))
  for (let i = 0; i < finals.length; i++) fs.push(frame({ event_type: 'final', samp_ix: i, gen_id: 'g', image: Buffer.from(finals[i], 'base64') }))
  return fs
}
const mock = (m) => page.evaluate((m) => (window.__naiMock = m), m)
const openParams = async () => {
  await page.getByTestId('params-button').click()
  await page.waitForSelector('[data-testid=params-panel]')
}
const closeParams = async () => {
  await page.getByTestId('params-button').click()
  await page.waitForSelector('[data-testid=params-panel]', { state: 'detached' })
}

export { browser, page, check, fails, errors, shot, clip, open, makeImages, framesFor, mock, naiHits, readFileSync }

if (!only || only.includes('layout')) {
  const defW = Math.min(Math.max(360, Math.round((width - 48 - 296) * 0.4)), 640, width - 48 - 296 - 561)
  await open()
  check((await page.getByTestId('export-panel').getAttribute('data-tab')) === 'copy', '没 token：默认提示词复制')
  check(Math.round((await page.getByTestId('export-panel').boundingBox()).width) === defW, `没 token：右栏 ${defW} 宽（和图片生成同一个宽度）`)
  check((await page.getByTestId('account-status').count()) === 0, '没 token：状态栏没有余额')
  await shot('0-no-token')
  await page.getByTestId('right-tab-gen').click()
  await page.waitForTimeout(400)
  check((await page.getByTestId('gen-no-token').innerText()).includes('未设置 NAI 令牌'), '没 token 的图片生成：「未设置 NAI 令牌」')
  check(await page.getByTestId('gen-button').isDisabled(), '没 token：生成不能点')
  check((await page.getByTestId('history-head').count()) === 0, '没 token：没有历史那一行')
  await shot('0b-no-token-gen')
  await page.getByTestId('gen-to-settings').click()
  await page.waitForSelector('[data-testid=app-settings][data-page=account]')
  check((await page.getByTestId('settings-nav-account').getAttribute('data-active')) === '', '「前往设置」：设置页「NAI 账号」页')
  check(await page.getByTestId('set-token').evaluate((el) => el === document.activeElement), '「前往设置」：光标在令牌框里')
  check((await page.locator('[data-jump-target]').evaluate((el) => el.getAnimations().length)) === 1, '「前往设置」：令牌那一行闪一下')
  await page.goto(url)
  await page.waitForSelector('[data-testid=export-panel]')
  check((await page.getByTestId('export-panel').getAttribute('data-tab')) === 'gen', '选过的 tab 记住（刷新还是图片生成）')

  await open({ token: 'pst-test' })
  await page.waitForSelector('[data-testid=gen-empty]')
  await page.waitForSelector('[data-testid=account-status][data-state=ok]')
  const ed = await page.getByTestId('editor-scroll').boundingBox()
  const col = await page.getByTestId('export-panel').boundingBox()
  console.log('editor', Math.round(ed.width), 'right', Math.round(col.width))
  check((await page.getByTestId('export-panel').getAttribute('data-tab')) === 'gen', '有 token、没选过：默认图片生成')
  const foot = await page.getByTestId('gen-footer').evaluate((f) => [...f.children].map((c) => ({ id: c.dataset.testid, w: Math.round(c.getBoundingClientRect().width), h: Math.round(c.getBoundingClientRect().height) })))
  const fw = Math.round((await page.getByTestId('gen-footer').boundingBox()).width)
  check(foot.map((x) => x.id).join() === 'params-button,gen-button' && foot[1].h === 44 && foot.every((x) => x.w === fw - 24), `底栏：参数卡片 + 整宽生成 44 高（${JSON.stringify(foot)}）`)
  const fs = await page.getByTestId('gen-footer').evaluate((f) => { const c = getComputedStyle(f); return { b: c.borderTopWidth, pt: c.paddingTop } })
  check(fs.b === '0px' && fs.pt === '12px', `底栏顶上没有整宽的线、上内边距 12（${JSON.stringify(fs)}）`)
  const cells = await page.getByTestId('gen-summary').locator('[data-cell]').evaluateAll((els) => els.filter((e) => getComputedStyle(e).display !== 'none').map((e) => e.innerText.replace(/\s+/g, ' ')))
  const narrowCard = defW - 48 <= 400
  const expectedCells = ['尺寸 832 × 1216', '步数 23', ...(narrowCard ? [] : ['引导 7', 'Seed 随机']), '采样 Euler Ancestral']
  check(JSON.stringify(cells) === JSON.stringify(expectedCells), `Parameter cells at ${defW}px: ${JSON.stringify(cells)}`)
  const pb = await page.getByTestId('gen-price').boundingBox()
  const gb = await page.getByTestId('gen-button').boundingBox()
  check(gb.x + gb.width - (pb.x + pb.width) < 12, '价格小牌子在按钮右边')
  const headBox = await page.getByTestId('history-head').boundingBox()
  const expandBox = await page.getByTestId('history-expand').boundingBox()
  check(expandBox.x + expandBox.width / 2 < headBox.x + headBox.width / 2, '展开全部位于历史标题行左半边')
  check((await page.getByTestId('gen-history').innerText()).trim().startsWith('历史') && (await page.getByTestId('history-head').getAttribute('aria-expanded')) === 'true' && (await page.getByTestId('history-expand').count()) === 1, '历史标题行「⏱ 历史 ⊞ ⌄」（开着）')
  await page.getByTestId('params-button').hover()
  check(await page.waitForFunction((narrow) => [...document.querySelectorAll('[data-slot=tooltip-content]')].some((x) => narrow ? x.textContent.trim().startsWith('832 × 1216 · 23 步 · 引导') : x.textContent.trim() === '参数'), narrowCard, { timeout: 2000 }).then(() => true, () => false), 'Parameter tooltip matches available space')
  await page.mouse.move(2, 300)
  await page.mouse.move(4, 320)
  await page.waitForTimeout(400)
  check((await page.getByTestId('account-status').innerText()).includes('2,340 Anlas'), '状态栏：Anlas')
  check((await page.getByTestId('account-status').innerText()).includes('Opus 额度 63%'), '状态栏：Opus 额度')
  check((await page.getByTestId('gen-price').innerText()) === '0', 'Opus 免费条件内：按钮写 0（图标）')
  await shot('1-before')
  await openParams()
  await shot('1b-params')
  await closeParams()
  await page.getByTestId('right-tab-copy').click()
  await page.waitForTimeout(320)
  check(Math.round((await page.getByTestId('export-panel').boundingBox()).width) === defW, `提示词复制：宽度不变（${defW}）`)
  await shot('1c-export')
  await page.getByTestId('right-tab-gen').click()
  await page.waitForTimeout(320)
  await page.getByTestId('account-status').hover()
  await page.waitForSelector('[data-testid=opus-detail]')
  check((await page.getByTestId('opus-detail').innerText()).includes('剩余 63%（约 1,090 张）'), '悬停余额：剩余约 N 张')
  check((await page.getByTestId('opus-detail').innerText()).includes('每天回复 20%'), '悬停余额：每天回复')
  await clip(page.getByTestId('status-bar'), '1d-status', 0)
  await page.screenshot({ path: `${out}/${prefix}-1e-opus-tip-${suffix}.png`, clip: { x: width - 420, y: height - 110, width: 420, height: 110 } })
  // Radix keeps the tooltip open inside its pointer grace area; move again before clicking controls underneath.
  await page.mouse.move(2, 300)
  await page.mouse.move(4, 320, { steps: 8 })
  await page.waitForSelector('[data-testid=opus-detail]', { state: 'detached' })
  await openParams()
  await page.getByTestId('set-effort-medium').click()
  await page.waitForTimeout(450)
  await closeParams()
  check((await page.getByTestId('gen-price').innerText()) === '0', 'Medium + Opus：免费写 0')
  await openParams()
  await page.getByTestId('set-effort-high').click()
  await page.getByTestId('set-size').click()
  await page.getByRole('option', { name: 'Large', exact: true }).click()
  await closeParams()
  await page.waitForTimeout(450)
  check((await page.getByTestId('gen-price').innerText()) === '39', `Large：39（${await page.getByTestId('gen-price').innerText()}）`)
  await openParams()
  await page.getByTestId('set-width').fill('1536')
  await page.keyboard.press('Enter')
  await page.getByTestId('set-height').fill('2048')
  await page.keyboard.press('Enter')
  await page.getByTestId('set-steps').getByRole('textbox').fill('50')
  await page.keyboard.press('Enter')
  check(await page.getByTestId('gen-button').isDisabled(), '耗时过长：改完参数立刻不能点（不等 300ms）')
  await closeParams()
  await page.waitForTimeout(450)
  check((await page.getByTestId('gen-button').innerText()).includes('无法生成') && (await page.getByTestId('gen-button').isDisabled()), '耗时过长：无法生成、按钮不能点')
  await clip(page.getByTestId('gen-footer'), '1f-too-long')

  await page.getByTestId('rail-settings').click()
  await page.waitForSelector('[data-testid=app-settings][data-page=account]')
  check((await page.getByTestId('token-status').innerText()).includes('已连接 · Opus · 2,340 Anlas'), '设置页：已连接 · Opus · Anlas')
  await page.getByTestId('settings-nav-gen').click()
  await page.waitForSelector('[data-testid=gen-settings]')
  await page.getByTestId('set-filename-on').click()
  await page.waitForTimeout(300)
  await page.getByTestId('set-filename').fill('{date}_{prompt|tags:2}_{seed}')
  check(/^预览：\d{4}-\d\d-\d\d_1girl, cherry blossoms_1431428736\.png$/.test(await page.getByTestId('filename-preview').innerText()), '文件名模板：预览')
  await page.getByTestId('set-filename').fill('{nope}')
  check((await page.getByTestId('filename-preview').innerText()).includes('未知的 token'), '文件名模板：写错了报错')
  await page.getByTestId('set-filename').fill('{prompt} s-{seed}')
  await clip(page.getByTestId('gen-settings'), '1g-settings-card', 0)
  await page.getByTestId('settings-nav-account').click()
  subStatus = 401
  await page.getByTestId('set-token').fill('pst-bad')
  await page.waitForSelector('[data-testid=token-status][data-state=error]', { timeout: 5000 })
  check((await page.getByTestId('token-status').innerText()) === '无法连接：令牌无效', '设置页：令牌无效')
  check((await page.getByTestId('account-status').innerText()) === 'NAI 令牌无效', '状态栏：令牌无效')
  subStatus = 200
  await page.getByTestId('set-token').fill('')
  await page.getByTestId('set-token').blur()
  await page.waitForTimeout(300)
  check((await page.evaluate(() => JSON.parse(localStorage.getItem('pe:nai')).state.token)) === '', '清空 token')
  await page.goto(url)
  await page.waitForSelector('[data-testid=export-panel]')
  check((await page.getByTestId('gen-no-token').count()) === 1, '清空 token：图片生成回到「未设置 NAI 令牌」')
}

const toasts = () => page.locator('[data-sonner-toast]').allTextContents()
const waitToast = async (text, ms = 5000) => {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) {
    if ((await toasts()).some((x) => x.includes(text))) return true
    await page.waitForTimeout(100)
  }
  return false
}
const widths = async () => {
  await page.waitForTimeout(320)
  const w = async (id) => ((await page.getByTestId(id).count()) ? Math.round((await page.getByTestId(id).boundingBox()).width) : 0)
  return { editor: await w('editor-scroll'), gen: await w('right-panel') }
}
const historyIds = () => page.getByTestId('history-item').evaluateAll((els) => els.map((e) => e.dataset.id))
const stageH = async () => Math.round((await page.getByTestId('gen-stage').boundingBox()).height)

if ((!only || only.includes('gen')) && width >= 1600) {
  await open({ token: 'pst-test' })
  await page.waitForSelector('[data-testid=account-status][data-state=ok]')
  const one = await makeImages(1, 1431428736)
  await mock({ frames: framesFor(one), delay: 160 })
  await page.getByTestId('gen-button').click()
  await page.waitForSelector('[data-testid=gen-preview]', { timeout: 5000 })
  await page.waitForTimeout(1200)
  check((await page.getByTestId('gen-button').innerText()).startsWith('生成中'), '出图中：按钮写生成中')
  check(await page.getByTestId('gen-button').isDisabled(), '出图中：按钮不能点')
  const prog = await page.getByTestId('gen-progress').evaluate((e) => parseFloat(e.style.width))
  check(prog > 0 && prog < 100, `出图中：进度 ${prog}%`)
  check((await page.getByTestId('history-pending').count()) === 1, '出图中：历史横条里的占位')
  await shot('2-running')
  await page.waitForSelector('[data-testid=gen-image]', { timeout: 10000 })
  await page.waitForTimeout(300)
  const req = await page.evaluate(() => window.__naiRequests.at(-1))
  check(req.headers.Authorization === 'Bearer pst-test', '请求带 Bearer token')
  check(req.req.model === 'nai-diffusion-5-full' && req.req.parameters.n_samples === 1 && req.req.parameters.stream === 'msgpack', '请求体：模型 / n_samples / stream')
  check(typeof req.req.parameters.seed === 'number', `seed 随机时前端给一个：${req.req.parameters.seed}`)
  check((await page.getByTestId('history-item').count()) === 1, '出完：历史多一张')
  check((await page.getByTestId('gen-image').getAttribute('data-seed')) === '1431428736', '出完：seed 从图里读出来')
  check((await page.getByTestId('gen-actions').count()) === 0 && (await page.getByTestId('version-bar-actions').getByRole('button').count()) === 3 && (await page.getByTestId('gen-use-seed').count()) === 1, '出完：没有浮动条，信息条 seed 后面 🌱、右边复制 / 下载 / 回收站')
  await shot('3-done')

  await openParams()
  await page.getByTestId('set-size').click()
  await page.getByRole('option', { name: 'Small', exact: true }).click()
  await page.getByTestId('set-count-seg-3').click()
  check((await page.getByTestId('set-count-seg').locator('[role=tab]').count()) === 6, 'Small：张数 1–6')
  await clip(page.getByTestId('settings-image'), '4-params-card', 4)
  await closeParams()
  check((await page.getByTestId('gen-button').innerText()).includes('生成 3 张'), '按钮：生成 3 张')
  const three = await makeImages(3, 777)
  await mock({ frames: framesFor(three, 12), delay: 110 })
  await page.keyboard.press('Control+Enter')
  await page.waitForSelector('[data-testid=gen-confirm]')
  check((await page.getByTestId('gen-confirm').innerText()).includes('生成 3 张图片') && (await page.getByTestId('gen-confirm-run').evaluate((el) => el === document.activeElement)), 'Ctrl+↵ 3 张：先确认（说明带张数、焦点在「生成」）')
  await page.waitForTimeout(400)
  await page.keyboard.press('Enter')
  await page.waitForSelector('[data-testid=gen-preview]', { timeout: 5000 })
  await page.waitForTimeout(500)
  await shot('5-running-3')
  const previewGrid = await page.getByTestId('gen-preview').first().evaluate(el => {
    const grid = el.parentElement.parentElement
    return { display: getComputedStyle(grid).display, cells: grid.children.length }
  })
  check(previewGrid.display === 'grid' && previewGrid.cells === 3, '多张出图中使用三格网格')
  await page.waitForFunction(() => document.querySelectorAll('[data-testid=history-item]').length === 4, null, { timeout: 15000 })
  await page.waitForSelector('[data-testid=gen-button]:not([disabled])')
  check((await page.evaluate(() => window.__naiRequests.at(-1).req.parameters.n_samples)) === 3, 'Ctrl+↵ 生成：n_samples 3')
  check((await page.getByTestId('gen-image').getAttribute('data-seed')) === '777', '一次几张：显示第一张')
  const ids = await historyIds()
  check(ids.length === 4 && (await page.getByTestId('history-item').first().getAttribute('aria-label')).endsWith('1431428736'), '历史横条：旧的在左')
  check((await page.locator('[data-testid=history-item][data-current]').getAttribute('data-id')) === ids[1], '一次几张：选中这一次的第一张（同一次的按顺序）')
  await page.getByTestId('history-item').nth(3).click()
  check((await page.getByTestId('gen-image').getAttribute('data-seed')) === '779', '点历史：切到那一张')
  check((await page.locator('[data-testid=history-item][data-current]').getAttribute('data-id')) === ids[3], '点历史：当前描边')
  check((await page.getByTestId('version-bar-index').innerText()) === '3 / 3', '信息条：3 / 3')
  await shot('6-history')
  await page.keyboard.press('Delete')
  await page.waitForTimeout(200)
  check((await page.getByTestId('history-item').count()) === 3, 'Del：删掉一张')
  check(!(await historyIds()).includes(ids[3]), 'Del：删的是选中的那张')
  check(await waitToast('已将图片移至回收站'), 'Del：toast')
  check(await page.evaluate(async (id) => id in (await window.__peImport('/src/store/gallery-marks.ts')).useMarks.getState().trash, ids[3]), 'Del persists gallery trash mark')
  await page.evaluate(() => [...document.querySelectorAll('[data-sonner-toast]')].find((t) => t.textContent.includes('已将图片移至回收站')).querySelector('button[data-button]').click())
  await page.waitForTimeout(200)
  check(JSON.stringify(await historyIds()) === JSON.stringify(ids), '撤销：放回原处')
  check((await page.locator('[data-testid=history-item][data-current]').getAttribute('data-id')) === ids[3], 'Undo reselects the trashed image')
  await page.getByTestId('gen-trash').click()
  check(await page.getByTestId('confirm-ok').count() === 0, 'History trash button does not confirm')
  await page.evaluate(async () => {
    await (await window.__peImport('/src/store/storage.ts')).settleWrites()
    const response = await fetch('/api/test/reopen', {method: 'POST'})
    if (!response.ok) throw new Error('Test library reopen failed')
  })
  await page.reload()
  await page.getByTestId('history-item').first().waitFor()
  check(!(await historyIds()).includes(ids[3]), 'Library reopen preserves hidden trash image')
  await page.getByTestId('page-gallery').click()
  await page.locator('[data-scope=trash]').click()
  await page.locator('[data-gid="'+ids[3]+'"]').waitFor()
  check(await page.locator('[data-gid="'+ids[3]+'"]').isVisible(), 'History trash button moves image into gallery trash')
  await page.locator('[data-gid="'+ids[3]+'"]').click()
  await page.getByTestId('gallery-restore').click()
  await page.getByTestId('page-editor').click()
  await page.getByTestId('history-item').nth(3).click({button:'right'})
  check((await page.getByTestId('history-menu-delete').innerText()).replace(/\s/g, '') === '移至回收站Del', 'History menu says move to trash')
  await page.keyboard.press('Escape')
  await page.waitForTimeout(300)
  await page.reload()
  await page.waitForSelector('[data-testid=history-item]')
  await page.waitForTimeout(400)
  check(JSON.stringify(await historyIds()) === JSON.stringify(ids), '刷新：历史还在')
  await page.getByTestId('history-item').nth(1).click()
  await page.getByTestId('gen-use-seed').hover()
  check(await page.waitForFunction(() => [...document.querySelectorAll('[data-slot=tooltip-content]')].some((x) => x.textContent.trim() === '使用此 Seed'), null, { timeout: 2000 }).then(() => true, () => false), '悬停 🌱：「使用此 Seed」')
  await page.getByTestId('gen-use-seed').click()
  check((await page.locator('[data-testid=gen-summary] [data-cell=seed]').innerText()).replace(/\s+/g, ' ') === 'Seed 777', '使用此 Seed：参数卡片 Seed 777')
  await openParams()
  check((await page.getByTestId('seed-clear').count()) === 1, 'Seed 填了：按钮变「清空」')
  await page.getByTestId('seed-clear').click()
  check((await page.getByTestId('set-seed').inputValue()) === '', '清空：seed 随机')
  await page.getByTestId('seed-use-current').click()
  check((await page.getByTestId('set-seed').inputValue()) === '777', '使用当前图的 Seed')
  await page.getByTestId('set-steps').getByRole('textbox').fill('30')
  await page.keyboard.press('Enter')
  await page.getByTestId('gen-reset').click()
  check((await page.getByTestId('set-steps').getByRole('textbox').inputValue()) === '23' && (await page.getByTestId('set-seed').inputValue()) === '', '↺ 重置：步数 23、seed 随机')
  check(await page.getByTestId('gen-reset').isDisabled(), '↺ 重置后置灰')
  await page.getByTestId('set-scale').getByRole('textbox').fill('12')
  await page.keyboard.press('Enter')
  check((await page.getByTestId('set-scale').getByRole('textbox').inputValue()) === '12', '引导数字框：12')
  await closeParams()

  const dl = page.waitForEvent('download')
  await page.getByTestId('gen-download').click()
  const d = await dl
  const path = await d.path()
  const buf = readFileSync(path)
  const fname = d.suggestedFilename()
  check(/^2girls, 1boy, multiple girls/.test(fname) && fname.endsWith(' s-777.png') && [...fname.slice(0, -' s-777.png'.length)].length === 80, `下载：默认文件名（prompt 前 80 个字 s-seed）${fname}`)
  check(buf.subarray(1, 4).toString() === 'PNG', '下载：是 PNG')
  check(buf.includes(Buffer.from('tEXtComment')) || buf.includes(Buffer.from('iTXtComment')), '下载：Comment 文本块')
  check(buf.includes(Buffer.from('"seed":777')), '下载：文本块里有 seed')
  await page.getByTestId('gen-copy').click()
  check(await waitToast('已复制图片'), '复制：toast')
  const clip0 = await page.evaluate(async () => {
    const items = await navigator.clipboard.read()
    const blob = await items[0].getType('image/png')
    const { readImageMeta } = await import('/src/lib/nai-image.ts')
    return { types: items[0].types, seed: JSON.parse((await readImageMeta(blob)).Comment).seed }
  })
  check(clip0.types.includes('image/png') && clip0.seed === 777, `复制：剪贴板 PNG，seed ${clip0.seed}`)
  await page.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem('pe:nai'))
    raw.state = { ...raw.state, imageFormat: 'webp', filenameTemplateOn: true, filenameTemplate: '{seed}_{resolution}_{index|pad:2}' }
    localStorage.setItem('pe:nai', JSON.stringify(raw))
  })
  await page.reload()
  await page.waitForSelector('[data-testid=gen-image]')
  const dl2 = page.waitForEvent('download')
  await page.getByTestId('gen-download').click()
  const d2 = await dl2
  const buf2 = readFileSync(await d2.path())
  check(d2.suggestedFilename() === '777_512x768_01.webp' && buf2.subarray(8, 12).toString() === 'WEBP', `WebP + 文件名模板：${d2.suggestedFilename()}`)

  // Playwright may scroll the container to avoid a toast covering the target; restore the scroll position before zoom checks.
  await page.getByTestId('gen-scroll').locator('[data-slot=scroll-area-viewport]').evaluate((el) => (el.scrollTop = 0))
  const ib = await page.getByTestId('gen-image').boundingBox()
  await page.mouse.move(ib.x + ib.width * 0.3, ib.y + ib.height * 0.3)
  await page.keyboard.down('Control')
  await page.mouse.wheel(0, -100)
  await page.mouse.wheel(0, -100)
  await page.keyboard.up('Control')
  await page.waitForTimeout(150)
  const zoomed = await page.getByTestId('gen-image').evaluate((e) => e.style.transform)
  check(/scale\(1\.44\)/.test(zoomed), `Ctrl+滚轮两格：放大 1.44 倍（${zoomed}）`)
  await page.keyboard.down('Shift')
  await page.mouse.down()
  await page.mouse.move(ib.x + ib.width * 0.3 + 60, ib.y + ib.height * 0.3 + 40, { steps: 4 })
  await page.mouse.up()
  await page.keyboard.up('Shift')
  let panned = await page.getByTestId('gen-image').evaluate((e) => e.style.transform)
  check(panned !== zoomed, `Shift+拖：平移（${panned}）`)
  const beforeFreePan = panned
  await page.mouse.down()
  await page.mouse.move(ib.x + ib.width * 0.3 + 95, ib.y + ib.height * 0.3 + 65, { steps: 5 })
  await page.mouse.up()
  panned = await page.getByTestId('gen-image').evaluate((e) => e.style.transform)
  check(panned !== beforeFreePan && await page.getByTestId('gen-lightbox').count() === 0, '放大后直接拖平移，不开弹层')
  await shot('6b-zoomed')
  await page.getByTestId('gen-image').click()
  await page.waitForSelector('[data-testid=gen-lightbox]')
  check((await page.getByTestId('gen-image').evaluate((e) => e.style.transform)) === panned, '单击：看大图（右栏的缩放不变）')
  await page.keyboard.press('Escape')
  await page.waitForSelector('[data-testid=gen-lightbox]', { state: 'detached' })

  const reqs = await page.evaluate(() => window.__naiRequests.length)
  await page.getByTestId('section').first().hover()
  await page.getByTestId('section-text-toggle').first().click()
  await page.getByTestId('section-text').first().focus()
  await page.keyboard.press('Control+Enter')
  await page.waitForTimeout(400)
  check(await page.evaluate(() => document.activeElement?.dataset.testid !== 'section-text'), '区块文本框：Ctrl+↵ 完成编辑（失焦）')
  await page.getByTestId('section-text-toggle').first().click()
  check((await page.evaluate(() => window.__naiRequests.length)) === reqs, '区块文本框：Ctrl+↵ 不生成')

  await page.getByTestId('fork-tab').click()
  await page.waitForTimeout(400)
  check((await page.getByTestId('history-item').count()) === 0 && (await page.getByTestId('gen-empty').count()) === 1, 'fork：新 tab 历史为空、生成前')
  await page.getByTestId('tab').first().click()
  await page.waitForTimeout(300)
  check((await page.getByTestId('history-item').count()) === 4, '切回原 tab：历史还在')

  for (const [status, text] of [
    [401, 'NAI 令牌无效'],
    [402, 'Anlas 不足'],
    [429, '已有图片在生成或请求过于频繁'],
  ]) {
    await mock({ status })
    await page.getByTestId('gen-button').click()
    await page.getByTestId('gen-confirm-run').click()
    check(await waitToast(text), `${status}：toast「${text}」`)
    await page.waitForSelector('[data-testid=gen-button]:not([disabled])')
  }
}

async function dragEdge(dx) {
  const b = await page.getByTestId('right-resize').boundingBox()
  await page.mouse.move(b.x + b.width / 2, b.y + 300)
  await page.mouse.down()
  await page.mouse.move(b.x + b.width / 2 + dx, b.y + 300, { steps: 8 })
  await page.mouse.up()
}
const savedW = () => page.evaluate(async () => (await window.__peImport('/src/store/prefs.ts')).usePrefs.getState().rightW)
async function traceW(act) {
  await page.evaluate(() => {
    window.__tw = []
    const t0 = performance.now()
    const tick = () => {
      window.__tw.push(Math.round(document.querySelector('#right-panel').getBoundingClientRect().width))
      if (performance.now() - t0 < 500) requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  })
  await act()
  await page.waitForTimeout(600)
  return page.evaluate(() => window.__tw)
}
const between = (ws, a, b) => ws.some((w) => w > Math.min(a, b) + 2 && w < Math.max(a, b) - 2)

if ((!only || only.includes('narrow')) && width < 1600) {
  await open({ token: 'pst-test' })
  const w0 = await widths()
  check(w0.editor === 657 && w0.gen === 438, `1440: default right 438, editor 657 (${JSON.stringify(w0)})`)
  await mock({ frames: framesFor(await makeImages(1, 42)), delay: 20 })
  await page.getByTestId('gen-button').click()
  await page.waitForSelector('[data-testid=gen-image]')
  check(JSON.stringify(await widths()) === JSON.stringify(w0), '出了图：宽度不变（没有大 / 小两档了）')
  await shot('8b-narrow-max')
  await dragEdge(-300)
  check((await widths()).gen === 535, '往左拖过头：停在最大 535')
  await dragEdge(400)
  const w2 = await widths()
  check(w2.gen === 360 && w2.editor === 735, `往右拖过头：停在最小 360，编辑区 735（${JSON.stringify(w2)}）`)
  await shot('8c-narrow-min')
  const vis = await page.getByTestId('gen-summary').locator('[data-cell]').evaluateAll((els) => els.filter((e) => getComputedStyle(e).display !== 'none').map((e) => e.dataset.cell))
  check(vis.join() === 'size,steps,sampler', `卡片窄：藏引导和 Seed（${vis.join()}）`)
  await page.getByTestId('params-button').hover()
  check(await page.waitForFunction(() => [...document.querySelectorAll('[data-slot=tooltip-content]')].some((x) => x.textContent.trim().startsWith('832 × 1216 · 23 步 · 引导')), null, { timeout: 2000 }).then(() => true, () => false), '卡片窄：悬停出全文摘要')
  await page.mouse.move(2, 300)
  await page.mouse.move(4, 320)
  await page.waitForTimeout(400)
  const h1 = await stageH()
  const sh = await page.evaluate(() => Math.round(document.querySelector('#history-panel').getBoundingClientRect().height) - 28)
  await page.getByTestId('history-head').click()
  const w3 = await widths()
  const h2 = await stageH()
  check(w3.gen === 360 && h2 - h1 === sh, `收起历史：宽度不变，图高 +${sh}（${h1} → ${h2}）`)
  await shot('8-narrow-collapsed')
  await page.getByTestId('history-head').click()
  await page.waitForTimeout(320)
  check((await stageH()) === h1, '时钟再点：展开回横条')
  await page.setViewportSize({ width: 1100, height })
  const w4 = await widths()
  check(w4.gen === 360 && w4.editor < 560, `1100：右栏最小 360、编辑区被挤窄（${JSON.stringify(w4)}）`)
  await page.setViewportSize({ width: 1024, height })
  const w5 = await widths()
  const rail = page.getByTestId('export-rail')
  check(w5.gen === 30 && (await rail.getAttribute('aria-disabled')) === 'true', `1024：右栏自动收成窄边（${JSON.stringify(w5)}）`)
  await rail.hover()
  check(await page.waitForFunction(() => [...document.querySelectorAll('[data-slot=tooltip-content]')].some((x) => x.textContent.trim() === '窗口过窄，无法展开右栏'), null, { timeout: 2000 }).then(() => true, () => false), '悬停窄边：「窗口过窄，无法展开右栏」')
  await page.screenshot({ path: `e2e/shots/${prefix}-9-narrow-rail-${theme}-1024.png` })
  await rail.click({ force: true })
  check((await widths()).gen === 30 && (await page.evaluate(async () => (await window.__peImport('/src/store/prefs.ts')).usePrefs.getState().exportOpen)) === true, '点窄边不展开；记住的开关还是开着')
  await page.mouse.move(700, 400)
  await page.setViewportSize({ width: 1100, height })
  check((await widths()).gen === 360 && (await page.getByTestId('export-rail').count()) === 0, '窗口变回 1100：右栏自己展开回 360')
  await page.setViewportSize({ width, height })
}

if ((!only || only.includes('narrow')) && width >= 1600) {
  await open({ token: 'pst-test' })
  const h0 = await stageH()
  await page.getByTestId('history-head').click()
  await page.waitForTimeout(300)
  check((await page.getByTestId('gen-history').getAttribute('data-open')) === null && (await stageH()) === h0 + 124, '手动收起历史：横条收起、图变高')
  await clip(page.getByTestId('export-panel'), '7-history-collapsed')
  await page.getByTestId('history-head').click()
  await page.waitForTimeout(300)
  check((await page.getByTestId('gen-history').getAttribute('data-open')) === '', '点时钟：展开回横条')
  const n0 = await widths()
  check(n0.editor === 945 && n0.gen === 630 && (await page.getByTestId('gen-size').count()) === 0, `1920: default right 630, editor 945 (${JSON.stringify(n0)})`)
  const sb = await page.getByTestId('right-resize').boundingBox()
  await page.mouse.move(sb.x + sb.width / 2 + 2, sb.y + 300)
  await page.waitForTimeout(250)
  check((await page.getByTestId('right-resize').getAttribute('data-separator')) === 'hover', '悬停边线（偏 2px 也算）：data-separator=hover')
  const glow = await page.getByTestId('right-resize').evaluate((e) => getComputedStyle(e, '::after').backgroundColor)
  check(glow !== 'rgba(0, 0, 0, 0)', `悬停边线：亮起来（${glow}）`)
  const cursor = await page.evaluate(() => getComputedStyle(document.body).cursor + ' ' + getComputedStyle(document.documentElement).cursor)
  check(/resize/.test(cursor), `悬停边线：光标左右拖（${cursor}）`)
  await page.mouse.move(sb.x - 40, sb.y + 300)
  await page.waitForTimeout(200)
  check((await page.getByTestId('right-resize').getAttribute('data-separator')) !== 'hover', '移开 6px 以外：不算悬停（热区约 4px）')
  const b = await page.getByTestId('right-resize').boundingBox()
  await page.mouse.move(b.x + b.width / 2, b.y + 300)
  await page.mouse.down()
  await page.mouse.move(b.x + b.width / 2 - 100, b.y + 300, { steps: 5 })
  const mid = Math.round((await page.getByTestId('export-panel').boundingBox()).width)
  await page.mouse.move(b.x + b.width / 2 - 200, b.y + 300, { steps: 5 })
  await page.mouse.up()
  const n1 = await widths()
  check(mid === 730 && n1.gen === 830 && n1.editor === 745, `Drag: intermediate ${mid}, right 830, editor 745 (${JSON.stringify(n1)})`)
  check((await savedW()) === 830, `记进偏好：${await savedW()}`)
  await dragEdge(-600)
  check((await widths()).gen === 1015, `往左拖过头：最大 1015（1576 − 560 − 边线 1）`)
  await shot('9a-max')
  await dragEdge(900)
  check((await widths()).gen === 360, '往右拖过头：最小 360')
  await shot('9b-min')
  await page.reload()
  await page.waitForSelector('[data-testid=gen-footer]')
  check((await widths()).gen === 360, '刷新：还是拖过的宽度')
  const d = await page.getByTestId('right-resize').boundingBox()
  const dw = await traceW(() => page.mouse.dblclick(d.x + d.width / 2, d.y + 300))
  check((await widths()).gen === 630 && (await savedW()) === null && between(dw, 360, 630), `Double-click: automatic 630 with transition (${dw.join(" ")})`)
  const tw = await traceW(() => page.getByTestId('right-tab-copy').click())
  const c0 = await widths()
  check(c0.gen === 630 && tw.every((w) => w === 630), `Copy tab: stable 630 (${[...new Set(tw)].join(" ")})`)
  await dragEdge(400)
  check((await widths()).gen === 360, '提示词复制里拖：最小也是 360')
  await page.getByTestId('right-tab-gen').click()
  check((await widths()).gen === 360 && (await savedW()) === 360, `切回图片生成：同一个宽度 360（${await savedW()}）`)
  await dragEdge(-280)
  await dragEdge(-100)
  await page.getByTestId('export-collapse').click()
  const r0 = await widths()
  check(r0.gen === 30 && (await page.getByTestId('right-resize').getAttribute('data-separator')) === 'disabled', `收起：30px 窄边、边线不能拖（${JSON.stringify(r0)}）`)
  await page.getByTestId('export-rail').click()
  check((await widths()).gen === 740, '展开：回到拖过的 740')
  await shot('9c-dragged')
}

console.log(fails.length ? `\n${fails.length} FAIL` : '\nall ok', 'errors', errors.length ? errors : 'none', 'nai hits', naiHits)
await browser.close()
