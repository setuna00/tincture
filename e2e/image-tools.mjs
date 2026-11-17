// Keep the network abort even with a fake fetch: a mock miss must never reach paid NovelAI endpoints.
import { chromium } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { E2E_URL, isolate, resetStore } from './store.mjs'

const theme = process.argv[2] ?? 'light'
const prefix = process.argv[3] ?? 'tools'
const width = Number(process.argv[4] ?? 1600)
const height = 960
const out = 'e2e/shots'
mkdirSync(out, { recursive: true })
const url = E2E_URL
const only = process.env.ONLY ?? ''

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
  await page.waitForTimeout(250)
  const b = await loc.boundingBox()
  const file = `${out}/${prefix}-${name}-${suffix}.png`
  await page.screenshot({ path: file, clip: { x: Math.max(0, b.x - pad), y: Math.max(0, b.y - pad), width: b.width + pad * 2, height: b.height + pad * 2 } })
  console.log('clip', file)
}
const shot = async (name) => {
  await page.waitForTimeout(300)
  const file = `${out}/${prefix}-${name}-${suffix}.png`
  await page.screenshot({ path: file })
  console.log('shot', file)
}
const tid = (id) => page.getByTestId(id)
const requests = () => page.evaluate(() => window.__naiRequests)
const historyIds = () => page.locator('[data-testid=gen-history] [data-testid=history-item]').evaluateAll((els) => els.map((e) => e.dataset.id))
const selectedId = () => page.locator('[data-testid=gen-history] [data-testid=history-item][data-current]').getAttribute('data-id')
const idle = () => page.waitForFunction(() => !document.querySelector('[data-testid=gen-button][data-running]'), null, { timeout: 30000 })

await page.goto(url)
await resetStore(page, { theme, prefs: { historyOpen: true }, nai: { state: { token: 'pst-test' }, version: 1 } })
await page.reload()
await page.waitForSelector('[data-testid=export-panel]', { timeout: 60000 })
await page.waitForSelector('[data-testid=account-status][data-state=ok]')
await page.addStyleTag({ content: '[data-sonner-toaster]{visibility:hidden!important}' })

await tid('gen-button').click()
await page.waitForSelector('[data-testid=gen-image]', { timeout: 30000 }).catch(async (e) => {
  console.log('errors:', errors, await page.evaluate(() => JSON.stringify(window.__naiRequests?.map((r) => r.url))))
  throw e
})
await idle()
const first = (await historyIds())[0]
if (only === 'base') {
  await page.mouse.move(2, height - 40)
  await clip(tid('export-panel'), 'panel', 0)
  await clip(tid('version-bar'), 'bar', 4)
  await browser.close()
  process.exit(0)
}
if (only === 'batch3') {
  const container = tid('version-bar').locator('..')
  const saved = await container.getAttribute('style')
  for (const [w, priceVisible, moreVisible, nameVisible] of [[600, true, true, true], [500, false, true, true], [400, false, false, true], [280, false, false, false]]) {
    await container.evaluate((e, w) => { e.style.width = `${w}px`; e.style.maxWidth = 'none' }, w)
    await page.waitForTimeout(100)
    check((await tid('tool-upscale-price').isVisible()) === priceVisible && (await tid('tool-more').locator('span').first().isVisible()) === moreVisible && (await tid('tool-upscale').locator('span').first().isVisible()) === nameVisible, `动作容器 ${w}px：价格、更多、名字依次隐藏`)
  }
  await container.evaluate((e, s) => s === null ? e.removeAttribute('style') : e.setAttribute('style', s), saved)
  await page.evaluate(async () => {
    const { useTabs, getDocStore } = await window.__peImport('/src/store/tabs.ts')
    getDocStore(useTabs.getState().activeId).getState().updateGen({ steps: 28 })
  })
  await tid('tool-enhance').click()
  await tid('tool-confirm').waitFor()
  const beforePrice = await tid('tool-run-price').innerText()
  await tid('tool-enhance-strength').getByRole('slider').focus()
  await page.keyboard.press('End')
  check((await tid('tool-run-price').innerText()) !== beforePrice && await tid('tool-enhance-noise').isVisible(), 'Enhance 强度改变价格，噪声控件可见')
  await tid('tool-cancel').click()
  await tid('tool-variations').click()
  await tid('tool-run').click()
  await idle()
  const variant = (await requests()).filter((r) => r.url === 'ai/generate-image-stream').at(-1)?.req
  check(variant?.parameters.steps === 23 && variant?.parameters.n_samples === 3 && (await historyIds()).length === 4, '变体仍用原图 23 步，生成三张')
  await page.locator(`[data-testid=history-item][data-id="${first}"]`).click()
  for (const [action, control] of [['colorize', 'tool-colorize-defry'], ['emotion', 'tool-emotion-defry'], ['declutter', 'tool-declutter-keep']]) {
    await tid('tool-more').click()
    await tid(`tool-${action}`).click()
    await tid(control).waitFor({ state: 'visible' })
    check(await tid(control).isVisible(), `${action} 的强度 / 程度 / 保留对话框选项可见`)
    await tid('tool-cancel').click()
  }
  check(errors.length === 0, '补充路径没有 console 报错')
  await browser.close()
  process.exit(fails.length ? 1 : 0)
}
check((await tid('image-tools').count()) === 1, '信息条第二行有动作')
await tid('history-head').click()
for (const id of ['img-sec-prompt', 'img-sec-params', 'img-sec-props']) {
  const section = tid(id)
  await section.locator('button').first().click()
  check((await section.getAttribute('data-collapsed')) === '' && (await section.locator(':scope > div').count()) === 0, `${id} 图片生成详情可收起`)
  await section.locator('button').first().click()
  check((await section.getAttribute('data-collapsed')) === null, `${id} 图片生成详情可展开`)
}
await tid('history-head').click()
const btns = await tid('image-tools')
  .locator('button[data-testid^=tool-]')
  .evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')))
check(JSON.stringify(btns) === JSON.stringify(['放大', 'Enhance', '变体', '重绘', '更多']), `第二行：放大 · Enhance · 变体 · 重绘 · 更多（${JSON.stringify(btns)}）`)
const price = (id) => tid(`tool-${id}-price`).innerText()
check(
  (await price('upscale')) === '1' && (await price('enhance')) === '38' && (await price('variations')) === '42',
  `价格：放大 1 · Enhance 38 · 变体 42（${await price('upscale')} / ${await price('enhance')} / ${await price('variations')}）`,
)
await clip(tid('version-bar'), '1-bar', 4)

await tid('tool-more').click()
await tid('tool-colorize').click()
await tid('tool-confirm').waitFor()
for (let i = 0; i < 5; i++) await tid('tool-colorize-defry-inc').click()
check(await tid('tool-colorize-defry-inc').isDisabled(), 'Colorize plus disabled at 5')
await tid('tool-cancel').click()
await tid('tool-confirm').waitFor({state: 'detached'})

await tid('tool-upscale').click()
await page.waitForSelector('[data-testid=tool-confirm]')
const conf = await tid('tool-confirm').innerText()
check(
  conf.includes('放大') && conf.includes('将这张图放大 2 倍') && (await tid('tool-run').innerText()).replace(/\s+/g, ' ') === '放大 1',
  `确认框：名字 + 说明 + [放大 1◆]（${conf.replace(/\s+/g, ' ')}）`,
)
check(await tid('tool-run').evaluate((e) => e === document.activeElement), '确认框打开时焦点在运行按钮上')
await clip(tid('tool-confirm'), '2-confirm-upscale', 6)
await tid('tool-cancel').click()
await page.waitForSelector('[data-testid=tool-confirm]', { state: 'detached' })
check((await requests()).filter((r) => r.url === 'ai/upscale').length === 0, '取消：没发请求')
await tid('tool-upscale').click()
await tid('tool-run').click()
await page.waitForSelector('[data-testid=gen-action-running]')
check((await tid('gen-action-text').innerText()) === '放大中…', '跑的时候：图区「放大中…」')
check((await tid('gen-button').innerText()).startsWith('放大中…'), `底栏按钮同样的字（${await tid('gen-button').innerText()}）`)
check((await tid('gen-button').locator('.progress-indeterminate').count()) === 1, '底栏按钮上来回走的一段')
check((await page.locator('[data-testid=gen-history] [data-testid=history-pending] .animate-spin').count()) === 1, '横条里占位格转圈')
check((await page.locator('[data-testid=gen-history] [data-testid=history-pending][data-current]').count()) === 1, '环在占位格上')
check(await tid('tool-upscale').isDisabled(), '跑的时候第二行不能点')
await clip(page.locator('[data-testid=gen-scroll]'), '3-running', 0)
await clip(tid('gen-footer'), '3b-running-footer', 0)
await idle()
await page.waitForTimeout(300)
const afterUp = await historyIds()
const up = afterUp.at(-1)
check(afterUp.length === 2 && afterUp[0] === first, '出完：结果挂在原图那一版的最后')
check((await selectedId()) === up, '出完：选中结果')
check((await page.locator(`[data-testid=history-item][data-id="${up}"] [data-testid=history-badge]`).getAttribute('data-label')) === 'upscale', '结果缩略图：角标（upscale）')
check(
  (await tid('version-bar-label').innerText()).trim() === '放大' && (await tid('version-bar-size').innerText()) === '1664 × 2432',
  `信息条：[放大] 1664 × 2432（${await tid('version-bar-size').innerText()}）`,
)
check((await page.getByTestId('version-bar-seed').count()) === 0 && (await tid('version-revert').count()) === 0, '结果图的第一行没有 seed、导入 prompt')
const upReq = (await requests()).find((r) => r.url === 'ai/upscale')?.req
check(upReq?.model === 'nai-diffusion-5-curated' && upReq.image === 'image' && upReq.declared_blur_sigma === 0, `放大的请求体（${JSON.stringify(upReq)}）`)
check((await tid('tool-upscale').isDisabled()) && (await tid('tool-enhance').isDisabled()) && (await tid('tool-variations').isDisabled()), '结果图大于 1536 × 2048：放大、Enhance、变体都不能点')
await clip(tid('version-bar'), '4-result-bar', 4)
await clip(tid('gen-history'), '4b-strip', 0)
await tid('version-bar-source').click()
await page.waitForTimeout(200)
check((await selectedId()) === first, '「原图」跳回原图')

await page.evaluate(async () => {
  const { useTabs, getDocStore } = await window.__peImport('/src/store/tabs.ts')
  getDocStore(useTabs.getState().activeId).getState().updateGen({ steps: 28 })
})
await page.waitForTimeout(200)
check((await price('enhance')) === '45', `改了编辑器的步数：Enhance 的价格跟着变（38 → ${await price('enhance')}）`)
await tid('tool-enhance').click()
await page.waitForSelector('[data-testid=tool-confirm]')
await tid('tool-enhance-strength-inc').click()
check(await tid('tool-enhance-strength').getByRole('slider').getAttribute('aria-valuenow') === '0.51', 'Enhance strength plus adds 0.01')
await tid('tool-enhance-strength-dec').click()
const scales = await tid('tool-enhance-scale').locator('[role=tab]').allInnerTexts()
check(JSON.stringify(scales) === JSON.stringify(['1×', 'Max']), `Enhance 倍数按尺寸筛（${JSON.stringify(scales)}）`)
check((await tid('tool-run-price').innerText()) === '45', 'Enhance 默认 Max：45（28 步）')
await tid('tool-enhance-scale-1').click()
check((await tid('tool-run-price').innerText()) === '0', `1×、Opus：免费写 0（${await tid('tool-run-price').innerText()}）`)
await tid('tool-enhance-scale-max').click()
await clip(tid('tool-confirm'), '5-confirm-enhance', 6)
await tid('tool-run').click()
await page.waitForSelector('[data-testid=gen-action-running][data-action=enhance]')
const pct = await page
  .waitForFunction(
    () => /^Enhance 中 \d+%$/.test(document.querySelector('[data-testid=gen-action-text]')?.textContent ?? '') && document.querySelector('[data-testid=gen-action-text]').textContent,
    null,
    { timeout: 10000 },
  )
  .then(
    (h) => h.jsonValue(),
    () => null,
  )
check(!!pct, `Enhance 跑的时候写百分比（${pct}）`)
await idle()
const enReq = (await requests()).filter((r) => r.url === 'ai/generate-image-stream').at(-1)?.req
check(
  enReq?.action === 'img2img' &&
    enReq.parameters.upscaled_enhance === true &&
    enReq.parameters.strength === 0.5 &&
    enReq.parameters.image === 'image' &&
    enReq.parameters.extra_noise_seed === enReq.parameters.seed - 1 && enReq.parameters.steps === 28,
  `Enhance 请求体（${JSON.stringify(enReq && { a: enReq.action, ...Object.fromEntries(['width', 'height', 'strength', 'noise', 'upscaled_enhance'].map((k) => [k, enReq.parameters[k]])) })}）`,
)
check((await tid('version-bar-label').innerText()).trim() === 'Enhance', '结果：[Enhance]')
await tid('version-bar-source').click()

await tid('tool-more').click()
await page.waitForSelector('[data-testid=tool-more-menu]')
const items = await tid('tool-more-menu').innerText()
check(
  items.includes('Director Tools') && ['去背景', '线稿', '草图', '上色', '改表情', '去文字和对话框'].every((x) => items.includes(x)) && !items.includes('像素'),
  `更多：Director Tools 6 个（${items.replace(/\s+/g, ' ')}）`,
)
check(/去背景\s*65/.test(items) && /线稿\s*0/.test(items), '更多里写价格：去背景 65、别的 Opus 免费写 0')
await clip(tid('tool-more-menu'), '6-more', 4)
await tid('tool-lineart').click()
await page.waitForSelector('[data-testid=gen-action-running][data-action=lineart]')
check((await tid('tool-confirm').count()) === 0, '免费且没有选项：不确认，直接跑')
await idle()
check((await tid('version-bar-label').innerText()).trim() === '线稿', '结果：[线稿]')
const lrReq = (await requests()).find((r) => r.url === 'ai/augment-image')?.req
check(lrReq?.req_type === 'lineart' && lrReq.width === 832 && lrReq.height === 1216 && lrReq.image === 'image', `线稿请求体（${JSON.stringify(lrReq)}）`)
await tid('version-bar-source').click()
await tid('tool-more').click()
await tid('tool-bg-removal').click()
await page.waitForSelector('[data-testid=tool-confirm][data-action=bg-removal]')
check((await tid('tool-run').innerText()).replace(/\s+/g, ' ') === '去背景 65', '去背景：确认框 65◆')
const before = (await historyIds()).length
await tid('tool-run').click()
await idle()
await page.waitForTimeout(300)
check((await historyIds()).length === before + 3, '去背景出 3 张（masked / generated / blend）')
await tid('version-bar-source').click()
await tid('tool-more').click()
await tid('tool-emotion').click()
await page.waitForSelector('[data-testid=tool-confirm][data-action=emotion]')
await tid('tool-emotion-pick').click()
await page.getByRole('option', { name: '开心', exact: true }).click()
await page.waitForTimeout(150)
await clip(tid('tool-confirm'), '7-confirm-emotion', 6)
await tid('tool-run').click()
await idle()
const emReq = (await requests()).filter((r) => r.url === 'ai/augment-image').at(-1)?.req
check(emReq?.req_type === 'emotion' && emReq.prompt === 'happy;;' && emReq.defry === 0, `改表情请求体（${JSON.stringify(emReq)}）`)

const augmentRequests = async () => (await requests()).filter((r) => r.url === 'ai/augment-image')
const priorAugments = (await augmentRequests()).length
await tid('tool-more').click()
await tid('tool-colorize').click()
const prompt = tid('tool-colorize-prompt')
await prompt.press('Enter')
check(await prompt.isVisible() && (await augmentRequests()).length === priorAugments, '刚打开上色框时按 ↵：没有请求')
await prompt.fill('粉色天空')
await page.waitForTimeout(400)
for (const event of [{ isComposing: true }, { keyCode: 229 }, { repeat: true }]) {
  await prompt.dispatchEvent('keydown', { key: 'Enter', ...event })
  check(await prompt.isVisible() && (await augmentRequests()).length === priorAugments, `上色输入框忽略 ↵（${Object.keys(event)[0]}）`)
}
await prompt.press('Enter')
await page.waitForFunction(() => window.__naiRequests.some((r) => r.url === 'ai/augment-image' && r.req.req_type === 'colorize'))
await idle()
const colorize = await augmentRequests()
check(colorize.length === priorAugments + 1 && colorize.at(-1).req.prompt === '粉色天空', '确认后按 ↵：只发一次上色请求，带输入的 prompt')

await page.locator('[data-testid=gen-image]').click()
await page.waitForSelector('[data-testid=gen-lightbox]')
const lb0 = await tid('gen-lightbox-image').getAttribute('data-id')
check(lb0 === (await selectedId()), '点图区的图 = 看大图（同一张）')
await shot('8-lightbox')
await page.keyboard.press('ArrowLeft')
await page.waitForTimeout(250)
const lb1 = await tid('gen-lightbox-image').getAttribute('data-id')
check(lb1 !== lb0 && lb1 === (await selectedId()), '← 翻到前一张（历史里跟着选中）')
const t0 = await tid('gen-lightbox-image').evaluate((e) => e.style.transform)
const ib = await tid('gen-lightbox-image').boundingBox()
await page.mouse.move(ib.x + ib.width / 2, ib.y + ib.height / 2)
await page.mouse.wheel(0, -300)
await page.waitForTimeout(150)
check((await tid('gen-lightbox-image').evaluate((e) => e.style.transform)) !== t0, '滚轮缩放')
await page.mouse.dblclick(ib.x + ib.width / 2, ib.y + ib.height / 2)
await page.waitForTimeout(150)
check((await tid('gen-lightbox-image').evaluate((e) => e.style.transform)) === t0, '双击贴合')
await page.keyboard.press('Escape')
await page.waitForSelector('[data-testid=gen-lightbox]', { state: 'detached' })
check(true, 'Esc 关')
await page.locator('[data-testid=gen-image]').click()
await page.waitForSelector('[data-testid=gen-lightbox]')
await page.mouse.click(width / 2, 12)
await page.waitForSelector('[data-testid=gen-lightbox]', { state: 'detached', timeout: 3000 }).then(
  () => check(true, '点空白处关'),
  () => check(false, '点空白处关'),
)

const dropFile = async (kind) => {
  await page.evaluate(async (kind) => {
    let blob
    if (kind === 'nai') {
      const id = document.querySelector('[data-testid=gen-history] [data-testid=history-item]').dataset.id
      blob = await (await window.__peImport('/src/store/storage.ts')).imageStore.blob(id)
    } else {
      const c = new OffscreenCanvas(600, 800)
      const g = c.getContext('2d')
      g.fillStyle = '#7aa'
      g.fillRect(0, 0, 600, 800)
      blob = await c.convertToBlob({ type: 'image/png' })
    }
    const file = new File([blob], kind === 'nai' ? 'nai.webp' : 'plain.png', { type: blob.type })
    const dt = new DataTransfer()
    dt.items.add(file)
    for (const t of ['dragenter', 'dragover', 'drop']) window.dispatchEvent(new DragEvent(t, { dataTransfer: dt, bubbles: true, cancelable: true }))
  }, kind)
  await page.waitForSelector('[data-testid=image-intake]')
}
await dropFile('nai')
const opts = await tid('image-intake')
  .locator('button[data-testid^=intake-]')
  .evaluateAll((els) => els.map((e) => e.dataset.testid))
const REFS = ['intake-ref-base', 'intake-ref-vibe', 'intake-ref-character']
check(JSON.stringify(opts) === JSON.stringify(['intake-import', ...REFS, 'intake-tools', 'intake-gallery']), `有元数据：导入 prompt · 参考图三项 · 用 Director Tools 处理… · 只放进图库（${JSON.stringify(opts)}）`)
await clip(tid('image-intake'), '9-intake', 8)
await tid('intake-import').click()
await tid('import-dialog').waitFor()
await page.keyboard.press('Escape')
await tid('import-dialog').waitFor({ state: 'detached' })
await dropFile('plain')
const opts2 = await tid('image-intake')
  .locator('button[data-testid^=intake-]')
  .evaluateAll((els) => els.map((e) => e.dataset.testid))
check(JSON.stringify(opts2) === JSON.stringify(opts), '没有元数据：选项顺序相同')
const disabledImport = tid('intake-import')
check(await disabledImport.isDisabled() && (await disabledImport.innerText()).includes('未读取到图片信息'), '导入 prompt 置灰并说明原因')
await disabledImport.click({ force: true })
check(await tid('image-intake').isVisible() && !(await tid('import-dialog').isVisible()), '点击置灰项仍停在用途弹窗')
await tid('intake-tools').click()
await page.waitForSelector('[data-testid=history-node-import]')
await page.waitForSelector('[data-testid=tool-more-menu]', { timeout: 3000 }).then(
  () => check(true, '选了 Director Tools：自动打开「更多」'),
  () => check(false, '选了 Director Tools：自动打开「更多」'),
)
check((await tid('version-bar-label').innerText()).trim() === '导入' && (await tid('version-bar-size').innerText()) === '600 × 800', '信息条：[导入] 600 × 800')
check((await tid('tool-enhance').count()) === 1 && (await tid('tool-variations').count()) === 0, '没有元数据的外部图：有 Enhance（用当前 prompt）、没有变体')
await page.keyboard.press('Escape')
await page.waitForSelector('[data-testid=tool-more-menu]', { state: 'detached' })
await tid('tool-more').click()
await tid('tool-sketch').click()
await page.waitForSelector('[data-testid=gen-action-running]')
await idle()
await page.waitForTimeout(300)
const grp = await page
  .locator('[data-testid=gen-history] [data-testid=history-group]')
  .last()
  .evaluate((g) => ({ node: !!g.querySelector('[data-testid=history-node-import]'), n: g.querySelectorAll('[data-testid=history-item]').length }))
check(grp.node && grp.n === 2, `加工导入的图：结果跟在「导入」节点后面（${JSON.stringify(grp)}）`)
await clip(tid('gen-history'), '10-strip-import', 0)

await page.waitForTimeout(800)
await page.reload()
await page.waitForSelector('[data-testid=gen-history] [data-testid=history-item]', { timeout: 30000 })
await page.waitForTimeout(600)
const badges = await page.locator('[data-testid=gen-history] [data-testid=history-badge]').evaluateAll((els) => els.map((e) => e.dataset.label))
check(
  ['upscale', 'enhanced', 'lineart', 'bg-removal', 'emotion', 'sketch'].every((x) => badges.includes(x)) && (await tid('history-node-import').count()) === 1,
  `刷新后标签、导入节点都在（${JSON.stringify(badges)}）`,
)

for (const kind of ['nai', 'plain']) {
  await dropFile(kind)
  await tid('intake-gallery').click()
  await tid('image-intake').waitFor({ state: 'detached' })
}
await page.evaluate(() => (location.hash = '/gallery'))
await tid('gallery-grid').waitFor()
await page.locator('[data-scope="doc:imported"]').click()
await page.waitForTimeout(400)
check((await page.locator('[data-gid]').count()) === 2, '只加入图库：NAI 图和无元数据截图各加入一张')

check(errors.length === 0, `没有 console 报错${errors.length ? `：${errors.slice(0, 3).join(' | ')}` : ''}`)
console.log(fails.length ? `\n${fails.length} 项失败：\n- ${fails.join('\n- ')}` : '\n全部通过')
await browser.close()
process.exit(fails.length ? 1 : 0)
