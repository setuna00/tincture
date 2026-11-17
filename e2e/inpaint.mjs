// Keep the network abort even with a fake fetch: a mock miss must never reach paid NovelAI endpoints.
import { chromium } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { E2E_URL, isolate, resetStore } from './store.mjs'

const theme = process.argv[2] ?? 'light'
const prefix = process.argv[3] ?? 'inpaint'
const width = 1600
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
const shot = async (name, loc) => {
  await page.waitForTimeout(300)
  const file = `${out}/${prefix}-${name}-${theme}.png`
  if (loc) {
    const b = await loc.boundingBox()
    await page.screenshot({ path: file, clip: { x: Math.max(0, b.x - 6), y: Math.max(0, b.y - 6), width: b.width + 12, height: b.height + 12 } })
  } else await page.screenshot({ path: file })
  console.log('shot', file)
}
const tid = (id) => page.getByTestId(id)
const requests = () => page.evaluate(() => window.__naiRequests)
const idle = () => page.waitForFunction(() => !document.querySelector('[data-testid=gen-button][data-running]'), null, { timeout: 30000 })
const painted = () =>
  page.evaluate(() => {
    const c = document.querySelector('[data-testid=mask-canvas]')
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data
    let n = 0
    for (let i = 3; i < d.length; i += 4) if (d[i]) n++
    return n
  })
const cells = () => page.evaluate(() => { const c = document.querySelector('[data-testid=mask-canvas]'); return c.width * c.height })

await page.goto(E2E_URL)
await resetStore(page, { theme, prefs: { historyOpen: true }, nai: { state: { token: 'pst-test' }, version: 1 } })
await page.reload()
await page.waitForSelector('[data-testid=export-panel]', { timeout: 60000 })
await page.waitForSelector('[data-testid=account-status][data-state=ok]')
await page.addStyleTag({ content: '[data-sonner-toaster]{visibility:hidden!important}' })

await tid('gen-button').click()
await page.waitForSelector('[data-testid=gen-image]', { timeout: 30000 })
await idle()
const btns = await tid('image-tools').locator('button[data-testid^=tool-]').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')))
check(JSON.stringify(btns) === JSON.stringify(['放大', 'Enhance', '变体', '重绘', '更多']), `第二行：放大 · Enhance · 变体 · 重绘 · 更多（${JSON.stringify(btns)}）`)
check((await tid('tool-inpaint-price').innerText()) === '0', `重绘价格 0（Opus 免费一张）（${await tid('tool-inpaint-price').innerText()}）`)
await shot('1-bar', tid('version-bar'))

await tid('tool-inpaint').click()
await page.waitForSelector('[data-testid=inpaint-editor]')
await page.waitForTimeout(300)
check(await tid('inpaint-button').isDisabled(), '没涂：重绘不能点')
check(await tid('mask-undo').isDisabled(), '没涂：撤销不能点')
check((await tid('mask-draw').getAttribute('aria-pressed')) === 'true', '默认画笔')
await shot('2-editor')
const img = tid('inpaint-image')
let box = await img.boundingBox()
check(box.height > 700, `图放大到 ${Math.round(box.width)} × ${Math.round(box.height)}`)
const at = (fx, fy) => [box.x + box.width * fx, box.y + box.height * fy]

await page.mouse.move(...at(0.7, 0.5))
await page.mouse.down()
for (let i = 1; i <= 40; i++) {
  const a = (i / 40) * Math.PI * 2
  await page.mouse.move(...at(0.5 + 0.2 * Math.cos(a), 0.5 + 0.14 * Math.sin(a)))
}
await page.mouse.up()
const ring = await painted()
check(ring > 0 && !(await tid('inpaint-button').isDisabled()), `画笔涂了 ${ring} 格，重绘能点`)
const edges = page.locator('[data-testid=mask-edge] path')
const contour = await edges.first().getAttribute('d')
check((contour ?? '').length > 20, '蒙版沿格子描边')
check((await edges.count()) === 2 && (await edges.last().getAttribute('d')) === contour &&
  (await edges.first().getAttribute('stroke')) === '#000' && (await edges.last().getAttribute('stroke')) === '#fff', '同一条蒙版轮廓先画黑线，再画白线')
await page.mouse.move(...at(0.5, 0.2))
check(((await page.locator('[data-testid=inpaint-cursor] path').first().getAttribute('d')) ?? '').startsWith('M'), '笔刷指针是格子形状的线框')
await page.keyboard.press('e')
await page.mouse.move(...at(0.68, 0.48))
await page.mouse.down()
await page.mouse.move(...at(0.72, 0.52), { steps: 3 })
await page.mouse.up()
const erased = await painted()
check(erased < ring, `E 橡皮擦掉 ${ring} → ${erased}`)
await tid('mask-undo').click()
check((await painted()) === ring, '撤销按钮')
await tid('mask-redo').click()
check((await painted()) === erased, '重做按钮')
await page.keyboard.press('Control+z')
check((await painted()) === ring, 'Ctrl+Z')
await page.keyboard.press('Control+y')
await page.keyboard.press('Control+z')
check((await painted()) === ring, 'Ctrl+Y 再 Ctrl+Z')
await page.keyboard.press('b')
await page.keyboard.press(']')
check((await tid('mask-size-input').inputValue()) === '48', '] 大小 48')
await page.keyboard.press('g')
check((await tid('mask-how').innerText()).includes('单击'), '油漆桶：上面一条写用法')
await page.mouse.click(...at(0.5, 0.5))
const filled = await painted()
check(filled > ring * 2, `油漆桶填心 ${ring} → ${filled}`)
await page.keyboard.down('Alt')
await page.mouse.click(...at(0.5, 0.5))
await page.keyboard.up('Alt')
check((await painted()) === 0, 'Alt + 油漆桶清掉连着的一整块')
await page.keyboard.press('Control+z')
const total = await cells()
await page.keyboard.press('Control+i')
check((await painted()) === total - filled, 'Ctrl+I 反选')
await tid('mask-invert').click()
check((await painted()) === filled, '反选按钮反回来')
await shot('3-filled')
await tid('mask-clear').click()
check((await painted()) === 0 && (await tid('inpaint-button').isDisabled()), '清空：重绘又不能点')
await page.keyboard.press('w')
check(await tid('mask-tol').isVisible(), '魔棒：上面一条是容差')
await page.mouse.click(...at(0.03, 0.03))
const wand = await painted()
check(wand > 50 && wand < total, `魔棒点角落选了 ${wand} 格`)
await page.keyboard.press(']')
check((await tid('mask-tol-input').inputValue()) === '40', '] 容差 40')
await tid('mask-clear').click()
await page.keyboard.press('p')
for (const [x, y] of [[0.2, 0.2], [0.6, 0.25], [0.55, 0.6], [0.25, 0.55]]) await page.mouse.click(...at(x, y))
await page.mouse.move(...at(0.4, 0.4))
check((await page.locator('[data-testid=inpaint-path] circle').count()) === 4, '钢笔：4 个点')
await shot('4-pen')
await page.keyboard.press('Backspace')
check((await page.locator('[data-testid=inpaint-path] circle').count()) === 3, 'Backspace 删上一个点')
await page.mouse.click(...at(0.25, 0.55))
await page.mouse.click(...at(0.2, 0.2))
const pen = await painted()
check(pen > 100, `点回起点闭合，填了 ${pen} 格`)
await page.mouse.click(...at(0.7, 0.7))
await page.mouse.click(...at(0.8, 0.7))
await page.keyboard.press('Escape')
check((await tid('inpaint-editor').count()) === 1 && (await page.locator('[data-testid=inpaint-path]').count()) === 0, 'Esc 先取消画了一半的钢笔，不退出')
await page.keyboard.press('l')
await page.keyboard.down('Alt')
await page.mouse.move(...at(0.3, 0.3))
await page.mouse.down()
for (const [x, y] of [[0.45, 0.3], [0.45, 0.45], [0.3, 0.45], [0.3, 0.3]]) await page.mouse.move(...at(x, y), { steps: 4 })
await page.mouse.up()
await page.keyboard.up('Alt')
const lasso = await painted()
check(lasso < pen, `Alt + 套索减掉一块 ${pen} → ${lasso}`)
await page.keyboard.down('h')
check((await tid('mask-canvas').getAttribute('data-hide')) !== null, '按住 H 隐藏')
await page.keyboard.up('h')
check((await tid('mask-canvas').getAttribute('data-hide')) === null, '松开 H 回来')
await tid('mask-eye').click()
check((await tid('mask-canvas').getAttribute('data-hide')) !== null, '眼睛开关隐藏')
await tid('mask-eye').click()
await page.keyboard.press('b')
const z0 = await tid('mask-zoom').innerText()
await page.mouse.move(...at(0.5, 0.5))
await page.mouse.wheel(0, -300)
await page.waitForTimeout(100)
const z1 = await tid('mask-zoom').innerText()
box = await img.boundingBox()
const cb = await tid('mask-canvas').boundingBox()
check(z1 !== z0 && Math.abs(cb.width - box.width) < 1 && Math.abs(cb.x - box.x) < 1, `滚轮缩放 ${z0} → ${z1}，蒙版跟着`)
await page.keyboard.down(' ')
await page.mouse.down()
await page.mouse.move(box.x + 300, box.y + 300, { steps: 5 })
await page.mouse.up()
await page.keyboard.up(' ')
const b2 = await img.boundingBox()
check(Math.abs(b2.x - box.x) > 20 && (await painted()) === lasso, '空格拖 = 平移不涂')
await page.keyboard.press('Control+0')
check((await tid('mask-zoom').innerText()) === z0, `Ctrl+0 适合 ${z0}`)
box = await img.boundingBox()
check((await page.locator('text=撤销 0').count()) === 1, '编辑器撤销栈没变')
await shot('5-tools')
await page.keyboard.press('Escape')
await page.waitForSelector('[data-testid=inpaint-editor]', { state: 'detached' })
await tid('tool-inpaint').click()
await page.waitForSelector('[data-testid=inpaint-editor]')
check((await painted()) === lasso, '退出再进：蒙版还在')
await tid('mask-strength-input').fill('0.5')
await tid('mask-strength-input').press('Escape')
check((await tid('mask-strength-input').inputValue()) === '1.00' && await tid('inpaint-editor').isVisible(), 'Esc restores strength and keeps inpaint open')
await tid('mask-strength-input').fill('0.5')
await tid('mask-strength-input').press('Enter')
check((await tid('mask-strength-input').inputValue()) === '0.50', 'Enter commits strength 0.50')
await tid('mask-strength-input').fill('1')
await tid('mask-strength-input').blur()
check((await tid('mask-strength-input').inputValue()) === '1.00', 'Blur commits strength 1.00')
await tid('mask-strength-dec').click()
check((await tid('mask-strength-input').inputValue()) === '0.95', '重绘强度 − → 0.95')
await tid('inpaint-button').click()
await page.waitForSelector('[data-testid=inpaint-confirm]')
const conf = await tid('inpaint-confirm').innerText()
check(conf.includes('将按编辑器当前的 prompt 和参数重画涂出的区域') && !conf.includes('不透明'), `确认框（${conf.replace(/\s+/g, ' ')}）`)
check(await tid('inpaint-run').evaluate((e) => e === document.activeElement), '确认框打开时焦点在「重绘」上')
await shot('6-confirm')
await page.keyboard.press('Escape')
await page.waitForTimeout(300)
check((await tid('inpaint-confirm').count()) === 0 && (await tid('inpaint-editor').count()) === 1, 'Esc 先收确认框')
await tid('inpaint-button').click()
await tid('inpaint-run').click()
await page.waitForSelector('[data-testid=inpaint-editor]', { state: 'detached' })
await page.waitForSelector('[data-testid=gen-button][data-running]')
check((await tid('gen-button').innerText()).startsWith('重绘中'), `底栏「重绘中」（${await tid('gen-button').innerText()}）`)
await idle()
await page.waitForTimeout(500)
const req = (await requests()).filter((r) => r.req.action === 'infill').at(-1)?.req
check(!!req, '发了 infill')
check(req?.model === 'nai-diffusion-5-full-inpainting' || req?.model?.endsWith('-inpainting'), `重绘模型（${req?.model}）`)
check(req?.parameters.mask === 'mask' && req?.parameters.image === 'image' && req?.parameters.add_original_image === false, 'image / mask 段、add_original_image false')
check(req?.parameters.inpaintImg2ImgStrength === 0.95 && req?.parameters.img2img?.strength === 0.95, '强度 0.95 → img2img')
const badge = page.locator('[data-testid=gen-history] [data-testid=history-item][data-current] [data-testid=history-badge]')
check((await badge.getAttribute('data-label')) === 'inpaint', '新图角标 = 重绘')
check((await tid('version-bar-seed').count()) === 1, '信息条照常有 seed')
const same = await page.evaluate(async () => {
  const items = [...document.querySelectorAll('[data-testid=gen-history] [data-testid=history-item] img')]
  const load = async (src) => {
    const b = await createImageBitmap(await (await fetch(src)).blob())
    const c = new OffscreenCanvas(b.width, b.height)
    const g = c.getContext('2d')
    g.drawImage(b, 0, 0)
    return g.getImageData(0, b.height - 40, 40, 40).data
  }
  const srcs = items.map((x) => x.src)
  if (srcs.length < 2) return 'n=' + srcs.length
  const [a, b] = await Promise.all([load(srcs[0]), load(srcs[srcs.length - 1])])
  let diff = 0
  for (let i = 0; i < a.length; i += 4) diff = Math.max(diff, Math.abs(a[i] - b[i]), Math.abs(a[i + 1] - b[i + 1]), Math.abs(a[i + 2] - b[i + 2]))
  return diff
})
check(typeof same === 'number' && same <= 3, `蒙版外和原图一样（最大差 ${same}）`)
await shot('7-done')

await page.locator('[data-testid=gen-history] [data-testid=history-item]').first().click()
await tid('tool-more').click()
await tid('tool-bg-removal').click()
await tid('tool-run').click()
await page.waitForSelector('[data-testid=gen-action-running]')
await page.waitForSelector('[data-testid=gen-action-running]', { state: 'detached', timeout: 30000 })
await page.waitForTimeout(500)
await tid('tool-inpaint').click()
await page.waitForSelector('[data-testid=inpaint-editor]')
await page.waitForTimeout(300)
const auto = await painted()
check(auto > 0, `去背景的图：自动涂了 ${auto} 格`)
await shot('8-cutout')
await tid('inpaint-button').click()
check((await tid('inpaint-confirm').innerText()).includes('原图不透明的部分保持不变'), '透明图的确认框多一句')
await tid('inpaint-run').click()
await page.waitForSelector('[data-testid=gen-button][data-running]')
await idle()
await page.waitForTimeout(500)
const keep = await page.evaluate(async () => {
  const items = [...document.querySelectorAll('[data-testid=gen-history] [data-testid=history-item]')]
  const cur = items.find((x) => x.hasAttribute('data-current'))
  const src = cur.querySelector('img').src
  const srcs = items.map((x) => x.querySelector('img').src)
  const cut = srcs[srcs.indexOf(src) - 1] ?? srcs[0]
  const load = async (u) => {
    const b = await createImageBitmap(await (await fetch(u)).blob())
    const c = new OffscreenCanvas(b.width, b.height)
    const g = c.getContext('2d')
    g.drawImage(b, 0, 0)
    return { d: g.getImageData(0, 0, b.width, b.height).data, w: b.width, h: b.height }
  }
  const [a, b] = await Promise.all([load(cut), load(src)])
  let diff = 0
  let corner = 0
  const cx = a.w >> 1
  const cy = a.h >> 1
  for (let y = cy - 20; y < cy + 20; y++)
    for (let x = cx - 20; x < cx + 20; x++) {
      const i = (y * a.w + x) * 4
      for (let c = 0; c < 3; c++) diff = Math.max(diff, Math.abs(a.d[i + c] - b.d[i + c]))
    }
  corner = b.d[3]
  return { diff, corner }
})
check(keep.diff <= 3, `主体不变（最大差 ${keep.diff}）`)
check(keep.corner > 200, `原来透明的角上画了新背景（alpha ${keep.corner}）`)
await shot('9-cutout-done')

check(!errors.length, `console 没有报错 ${errors.join(' | ')}`)
await browser.close()
console.log(fails.length ? `\n${fails.length} 项没过` : '\n全部通过')
process.exit(fails.length ? 1 : 0)
