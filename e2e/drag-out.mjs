import { chromium } from '@playwright/test'
import { writeFileSync } from 'node:fs'
import { E2E_URL, isolate, resetStore } from './store.mjs'

const url = E2E_URL
const browser = await chromium.launch()
const context = await browser.newContext({ viewport: { width: 1600, height: 960 }, deviceScaleFactor: 1 })
await isolate(context)
await context.route(/novelai\.net/, (route) => route.abort())
await context.addInitScript(() => {
  const real = window.fetch.bind(window)
  let fake = null
  window.fetch = async (input, init) => {
    const u = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if (!u.includes('novelai\u002enet')) return real(input, init)
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
  const files = new Map()
  let end = () => {}
  window.__writes = []
  window.__starts = []
  window.peApp = {
    setTheme() {},
    token: { get: async () => 'pst-test', set: async () => {} },
    aiKeys: { get: async () => '', set: async () => {} },
    pickFolder: async () => null,
    onBeforeClose() {},
    dragOut: {
      find: async (key) => files.get(key) ?? null,
      write: async (f) => {
        const p = `C:\\drag\\${window.__writes.length}\\${f.name}.${f.ext}`
        const head = String.fromCharCode(...f.bytes.subarray(0, 4))
        const text = new TextDecoder('latin1').decode(f.bytes.subarray(0, 4096))
        window.__writes.push({ key: f.key, name: f.name, ext: f.ext, head, hasText: /tEXt|iTXt/.test(text), size: f.bytes.length })
        files.set(f.key, p)
        return p
      },
      start: (paths, icon, scale) => {
        window.__starts.push({ paths, icon: icon.length, scale, png: icon[0] === 0x89 && icon[1] === 0x50 })
        window.__icons = [...(window.__icons ?? []), btoa(String.fromCharCode(...icon))]
        if (window.__hold) window.__end = end
        else setTimeout(() => end(), 50)
      },
      onEnd: (cb) => (end = cb),
    },
  }
})
const page = await context.newPage()
const errors = []
page.on('console', (m) => m.type() === 'error' && !/novelai\.net|Failed to load resource/.test(m.text()) && errors.push(m.text()))
page.on('pageerror', (e) => errors.push(String(e)))

const fails = []
const check = (ok, msg) => (ok ? console.log('ok  ', msg) : (fails.push(msg), console.log('FAIL', msg)))
const tid = (id) => page.getByTestId(id)
const idle = () => page.waitForFunction(() => !document.querySelector('[data-testid=gen-button][data-running]'), null, { timeout: 30000 })
const starts = () => page.evaluate(() => window.__starts)
const writes = () => page.evaluate(() => window.__writes)
const dragStart = (loc, opts = {}) => loc.evaluate((el, o) => el.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: new DataTransfer(), ...o })), opts)
const nthStart = async (n) => {
  await page.waitForFunction((n) => window.__starts.length >= n, n, { timeout: 10000 }).catch(() => {})
  await page.waitForTimeout(120)
  return (await starts())[n - 1]
}

await page.goto(url)
await resetStore(page, { theme: 'light', prefs: { historyOpen: true, galleryStack: false }, nai: { state: { token: 'pst-test' }, version: 1 } })
await page.reload()
await page.waitForSelector('[data-testid=export-panel]', { timeout: 60000 })
await page.waitForSelector('[data-testid=account-status][data-state=ok]')
await page.addStyleTag({ content: '[data-sonner-toaster]{visibility:hidden!important}' })

await tid('gen-button').click()
await idle()
await tid('gen-button').click()
await idle()
await page.waitForSelector('[data-testid=gen-image]')

const img = tid('gen-image')
check((await img.getAttribute('draggable')) === 'true', '出图区的图 draggable')
const seed = await img.getAttribute('data-seed')
const t0 = Date.now()
await dragStart(img)
await page.waitForFunction(() => window.__starts.length >= 1, null, { timeout: 10000 })
console.log(`     第一次准备（转 PNG + 写文件 + 拖影）${Date.now() - t0} ms`)
let s = await nthStart(1)
let w = await writes()
check(s?.paths.length === 1 && w.length === 1, `出图区：拖一个文件（${JSON.stringify(s)}）`)
check(w[0]?.ext === 'png' && w[0].head === '\u0089PNG' && w[0].hasText, `默认 PNG：转成 PNG、带文本块（${JSON.stringify(w[0])}）`)
check(w[0]?.name.endsWith(` s-${seed}`), `文件名 = 「prompt s-seed」（${w[0]?.name}）`)
check(s?.png && s.icon > 200 && s.scale === 1, `拖影是 PNG（${s?.icon} 字节，scale ${s?.scale}）`)
await dragStart(img)
s = await nthStart(2)
check((await writes()).length === 1 && s?.paths[0] === (await starts())[0].paths[0], '同一张再拖：用写好的文件，不再转一次')
await dragStart(img, { shiftKey: true })
await page.waitForTimeout(400)
check((await starts()).length === 2, 'Shift+拖（平移）不拖出去')

await page.evaluate(() => (window.__hold = true))
const during = await img.evaluate(async (el) => {
  el.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: new DataTransfer() }))
  const dt = new DataTransfer()
  dt.items.add(new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], 'x.png', { type: 'image/png' }))
  const fire = (type) => document.body.dispatchEvent(new DragEvent(type, { dataTransfer: dt, bubbles: true, cancelable: true }))
  fire('dragenter')
  fire('dragover')
  await new Promise((r) => setTimeout(r, 250))
  const shown = document.querySelector('[data-testid=drop-overlay]').hasAttribute('data-show')
  fire('drop')
  return { shown, effect: dt.dropEffect }
})
await page.waitForTimeout(500)
check(!during.shown && during.effect === 'none', `拖着的时候拖回窗口：不出拖入提示、光标禁止（${JSON.stringify(during)}）`)
check((await page.locator('[data-testid=image-intake], [data-testid=import-dialog]').count()) === 0, '拖着的时候拖回窗口松手：不问用途、不导入')
await nthStart(3)
await page.evaluate(() => ((window.__hold = false), window.__end()))
await page.waitForTimeout(100)
const after = await page.evaluate(async () => {
  const dt = new DataTransfer()
  dt.items.add(new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], 'x.png', { type: 'image/png' }))
  const fire = (type) => document.body.dispatchEvent(new DragEvent(type, { dataTransfer: dt, bubbles: true, cancelable: true }))
  fire('dragenter')
  fire('dragover')
  await new Promise((r) => setTimeout(r, 250))
  const shown = document.querySelector('[data-testid=drop-overlay]').hasAttribute('data-show')
  fire('dragleave')
  return shown
})
check(after, '拖完以后从外面拖进来（拖出去的文件再拖回来）：照常出拖入提示')

const items = page.locator('[data-testid=gen-history] [data-testid=history-item]')
check((await items.count()) === 2, '历史两张')
const cur0 = await page.locator('[data-testid=gen-history] [data-testid=history-item][data-current]').getAttribute('data-id')
const other = (await items.nth(0).getAttribute('data-id')) === cur0 ? items.nth(1) : items.nth(0)
check((await other.getAttribute('draggable')) === 'true', '历史缩略图 draggable')
await dragStart(other)
s = await nthStart(4)
check(s?.paths.length === 1, '历史横条：拖一个文件')
await other.evaluate((el) => el.click())
await page.waitForTimeout(200)
check((await page.locator('[data-testid=gen-history] [data-testid=history-item][data-current]').getAttribute('data-id')) === cur0, '拖完浏览器补的 click 不换选中')
await other.click()
check((await page.locator('[data-testid=gen-history] [data-testid=history-item][data-current]').getAttribute('data-id')) === (await other.getAttribute('data-id')), '再点一下照常选中')

await tid('history-expand').click()
const gridItem = tid('history-grid-item').first()
await gridItem.waitFor()
check((await gridItem.getAttribute('draggable')) === 'true', '展开全部的缩略图 draggable')
await dragStart(gridItem)
s = await nthStart(5)
check(s?.paths.length === 1, '展开全部：拖一个文件')
await tid('history-grid-close').click()
await page.waitForTimeout(300)

await tid('gen-image').click()
const big = tid('gen-lightbox-image')
await big.waitFor()
check((await big.getAttribute('draggable')) === 'true', '看大图（没缩放）draggable')
await dragStart(big)
s = await nthStart(6)
check(s?.paths.length === 1, '看大图：拖一个文件')
const box = await big.boundingBox()
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
await page.mouse.wheel(0, -300)
await page.waitForTimeout(200)
check((await big.getAttribute('draggable')) !== 'true', '看大图放大了：不能拖出去（拖 = 平移）')
const lightboxTransform = await big.evaluate((el) => el.style.transform)
await page.mouse.down()
await page.mouse.move(box.x + box.width / 2 + 40, box.y + box.height / 2 + 20, { steps: 6 })
await page.mouse.up()
check(await big.evaluate((el) => el.style.transform) !== lightboxTransform && await tid('gen-lightbox').isVisible(), '共用弹层：放大后直接拖仍然平移，不关闭')
await page.keyboard.press('Escape')
await page.waitForTimeout(300)

await page.evaluate(async () => {
  const { useNai } = await window.__peImport('/src/store/nai.ts')
  useNai.setState({ imageFormat: 'webp' })
})
await dragStart(tid('gen-image'))
await nthStart(7)
w = await writes()
check(w.at(-1)?.ext === 'webp' && w.at(-1).head === 'RIFF', `格式 WebP：原图（${JSON.stringify(w.at(-1))}）`)

await page.evaluate(() => (location.hash = '/gallery'))
const cells = tid('gallery-cell')
await cells.first().waitFor()
check((await cells.count()) === 2 && (await cells.first().getAttribute('draggable')) === 'true', '图库网格 draggable')
await cells.first().click()
await page.keyboard.press('Control+a')
const selCount = () => page.locator('[data-testid=gallery-cell][data-selected]').count()
check((await selCount()) === 2, '全选 2 张')
const c0 = await cells.nth(1).boundingBox()
await page.mouse.move(c0.x + c0.width / 2, c0.y + c0.height / 2)
await page.mouse.down()
check((await selCount()) === 2, '按住多选里的一张：选中不变')
await dragStart(cells.nth(1))
// Native drag requires the pointer to remain pressed while files are prepared; releasing sooner cancels the drag.
s = await nthStart(8)
await page.mouse.up()
check(s?.paths.length === 2 && new Set(s.paths).size === 2, `多选拖：拖选中的 2 个文件（${JSON.stringify(s?.paths)}）`)
check((await selCount()) === 2, '拖完松手：选中不变')
await cells.nth(1).click()
check((await selCount()) === 1, '松手没拖过：只选它')
await dragStart(cells.nth(0))
s = await nthStart(9)
check(s?.paths.length === 1, '按住没选中的一张拖：只拖它')
await page.evaluate(async () => {
  const { useNai } = await window.__peImport('/src/store/nai.ts')
  useNai.setState({ imageFormat: 'png', filenameTemplateOn: true, filenameTemplate: 'quick {seed}' })
})
await cells.nth(1).evaluate((el) => {
  el.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: new DataTransfer() }))
  window.dispatchEvent(new PointerEvent('pointerup'))
})
await page.waitForTimeout(1500)
check((await starts()).length === 9, '准备文件时就松了手：不拖')
check((await writes()).at(-1)?.name.startsWith('quick '), `文件名模板（${(await writes()).at(-1)?.name}）`)
await dragStart(cells.nth(1))
s = await nthStart(10)
check(s?.paths.length === 1, '松手以后再拖：照常（文件已写好）')
await cells.nth(0).click()
const preview = page.locator('[data-testid=gallery-detail-preview] img')
check((await preview.getAttribute('draggable')) === 'true', '右栏预览 draggable')
await dragStart(preview)
s = await nthStart(11)
check(s?.paths.length === 1, '右栏预览：拖一个文件')
await cells.nth(0).dblclick()
const viewerImg = tid('gallery-viewer-image')
await viewerImg.waitFor()
await page.waitForTimeout(400)
await dragStart(viewerImg)
s = await nthStart(12)
check(s?.paths.length === 1 && s.icon > 200, '图库看大图：拖一个文件')
await viewerImg.evaluate((el) => el.click())
check(await tid('gallery-lightbox').count() === 0, '图库拖出后补的 click 不打开弹层')

async function zoomAndPan(image, stage, label) {
  await page.waitForTimeout(400)
  const b = await stage.boundingBox()
  const x = b.x + b.width / 2, y = b.y + b.height / 2
  await page.mouse.move(x, y)
  await page.keyboard.down('Control')
  await page.mouse.wheel(0, -100)
  await page.keyboard.up('Control')
  await page.waitForTimeout(150)
  const transform = () => image.evaluate((el) => el.style.transform || el.parentElement.style.transform)
  const before = await transform()
  const n = (await starts()).length
  await page.mouse.down()
  await page.mouse.move(x + 50, y + 30, { steps: 8 })
  await page.mouse.up()
  await dragStart(image)
  await page.waitForTimeout(300)
  check(await transform() !== before && (await starts()).length === n, `${label}：放大后直接拖平移，不拖出文件（${before} → ${await transform()}，start ${n} → ${(await starts()).length}）`)
  check(await page.locator('[data-testid=gallery-lightbox], [data-testid=gen-lightbox]').count() === 0, `${label}：拖动不开弹层`)
}
await zoomAndPan(viewerImg, tid('gallery-viewer'), '图库看大图')
await page.evaluate(() => (location.hash = '/'))
await tid('gen-image').waitFor()
await tid('gen-scroll').locator('[data-slot=scroll-area-viewport]').evaluate((el) => (el.scrollTop = 0))
await zoomAndPan(tid('gen-image'), tid('gen-viewer'), '编辑器图区')

if (process.env.ICON_DIR) for (const [i, b64] of (await page.evaluate(() => window.__icons)).entries()) writeFileSync(`${process.env.ICON_DIR}/drag-icon-${i + 1}.png`, Buffer.from(b64, 'base64'))
check(!errors.length, `没有 console 报错${errors.length ? `：${errors.join(' | ')}` : ''}`)

const plain = await browser.newContext({ viewport: { width: 1600, height: 960 } })
await isolate(plain)
await plain.route(/novelai\.net/, (route) => route.abort())
const p2 = await plain.newPage()
await p2.goto(`${url}#/gallery`)
await p2.waitForSelector('[data-testid=status-bar]', { timeout: 60000 })
check((await p2.evaluate(() => typeof window.peApp)) === 'undefined', '浏览器里没有 peApp')
check(
  await p2.evaluate(async () => {
    const { dragOutProps } = await window.__peImport('/src/components/gen/drag-out.ts')
    return Object.keys(dragOutProps(() => [])).length === 0
  }),
  '浏览器里不给 draggable / onDragStart',
)
await plain.close()

await browser.close()
console.log(fails.length ? `\n${fails.length} 项失败` : '\n全部通过')
process.exit(fails.length ? 1 : 0)
