// Keep the network abort even with a fake fetch: a mock miss must never reach paid NovelAI endpoints.
import { chromium } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { E2E_URL, isolate, resetStore } from './store.mjs'

const theme = process.argv[2] ?? 'light'
const prefix = process.argv[3] ?? 'refs'
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
  await page.waitForTimeout(250)
  const b = await loc.boundingBox()
  const file = `${out}/${prefix}-${name}-${suffix}.png`
  await page.screenshot({ path: file, clip: { x: Math.max(0, b.x - pad), y: Math.max(0, b.y - pad), width: b.width + pad * 2, height: b.height + pad * 2 } })
  console.log('clip', file)
}
const tid = (id) => page.getByTestId(id)
const generate = async () => {
  const paid = Number((await tid('gen-price').innerText()).trim()) > 0
  await tid('gen-button').click()
  if (paid) await tid('gen-confirm-run').click()
}
const requests = () => page.evaluate(() => window.__naiRequests)
const idle = () => page.waitForFunction(() => !document.querySelector('[data-testid=gen-button][data-running]'), null, { timeout: 30000 })
const settings = () =>
  page.evaluate(async () => {
    const { getDocStore, useTabs } = await window.__peImport('/src/store/tabs.ts')
    return getDocStore(useTabs.getState().activeId).getState().doc.settings
  })
const toastText = async () => (await page.locator('[data-sonner-toast]').allInnerTexts().catch(() => [])).join(' | ').replace(/\s+/g, ' ')
const dropFile = async (color, w = 600, h = 800) => {
  await page.evaluate(
    async ([color, w, h]) => {
      const c = new OffscreenCanvas(w, h)
      const g = c.getContext('2d')
      g.fillStyle = color
      g.fillRect(0, 0, w, h)
      g.fillStyle = '#fff8'
      g.beginPath()
      g.arc(w / 2, h / 2.6, w / 5, 0, 7)
      g.fill()
      const blob = await c.convertToBlob({ type: 'image/png' })
      const dt = new DataTransfer()
      dt.items.add(new File([blob], 'ref.png', { type: 'image/png' }))
      for (const t of ['dragenter', 'dragover', 'drop']) window.dispatchEvent(new DragEvent(t, { dataTransfer: dt, bubbles: true, cancelable: true }))
    },
    [color, w, h],
  )
  await page.waitForSelector('[data-testid=image-intake]')
}

await page.goto(E2E_URL)
await page.waitForLoadState('networkidle')
await page.waitForTimeout(500)
await resetStore(page, { theme })
await page.reload()
await page.waitForSelector('[data-testid=board]', { timeout: 60000 })
await page.waitForTimeout(400)
check((await tid('box-refs').count()) === 0, '没填令牌：没有参考图框')

await resetStore(page, { theme, nai: { state: { token: 'pst-test' }, version: 1 } })
await page.reload()
await page.waitForSelector('[data-testid=export-panel]', { timeout: 60000 })
await page.waitForSelector('[data-testid=account-status][data-state=ok]')
check((await tid('box-refs').count()) === 1, '填了令牌：有参考图框')
const firstBox = await page.locator('[data-testid=board] > *').first().getAttribute('data-testid')
check(firstBox === 'box-refs', `参考图框在编辑器最上面（第一个是 ${firstBox}）`)
check((await tid('refs-count').innerText()) === '0', '计数 0')
check((await tid('history-head').getAttribute('aria-expanded')) === 'false', '历史横条默认收起')

await tid('gen-button').click()
await page.waitForSelector('[data-testid=gen-image]', { timeout: 30000 })
await idle()
await page.waitForTimeout(300)

const bar = await tid('version-bar').evaluate((el) => {
  const cs = getComputedStyle(el)
  return { radius: cs.borderTopLeftRadius, left: cs.borderLeftWidth, top: cs.borderTopWidth }
})
check(bar.radius === '0px' && bar.left === '0px' && bar.top === '1px', `信息条平铺：上面一条线、没有框（${JSON.stringify(bar)}）`)
const gap = await page.evaluate(() => {
  const vp = document.querySelector('[data-testid=gen-scroll] [data-slot=scroll-area-viewport]').getBoundingClientRect()
  const b = document.querySelector('[data-testid=version-bar]').getBoundingClientRect()
  return Math.round(vp.bottom - b.bottom)
})
check(Math.abs(gap) <= 1, `历史收起：信息条贴着滚动区的底（差 ${gap}px）`)
const mask = await page.evaluate(() => getComputedStyle(document.querySelector('[data-testid=gen-scroll] [data-slot=scroll-area-viewport]')).maskImage)
check(mask === 'none', `停在顶上不渐隐（${mask}）`)
const closedHeight = (await tid('version-bar').boundingBox()).height
check(await tid('version-bar').evaluate((el) => {
  const bar = el.getBoundingClientRect()
  const stage = document.querySelector('[data-testid=gen-stage]').getBoundingClientRect()
  return Math.abs(stage.bottom - bar.top) <= 1 && Math.abs(stage.width - bar.width) <= 1
}), '图区与信息条相接且同宽')
await tid('history-head').click()
await page.waitForTimeout(350)
check(Math.abs((await tid('version-bar').boundingBox()).height - closedHeight) <= 1, '历史展开不改变信息条高度')
await tid('history-head').click()
await page.waitForTimeout(350)
check(Math.abs((await tid('version-bar').boundingBox()).height - closedHeight) <= 1, '历史收起不改变信息条高度')
const viewport = tid('gen-scroll').locator('[data-slot=scroll-area-viewport]')
check((await tid('gen-details').boundingBox()).y >= (await viewport.boundingBox()).y + (await viewport.boundingBox()).height - 1, 'Prompt 详情开始时在可视区下方')
await viewport.evaluate((el) => { el.scrollTop = el.scrollHeight })
await page.waitForTimeout(200)
check((await tid('gen-details').boundingBox()).y < (await viewport.boundingBox()).y + (await viewport.boundingBox()).height, '下滑后可看到详情')
await viewport.evaluate((el) => { el.scrollTop = 0 })
await page.waitForTimeout(200)

const pills = await page.evaluate(() => ['upscale', 'enhance', 'variations'].map((k) => document.querySelector(`[data-testid=tool-${k}-price]`)?.innerText.trim()))
check(JSON.stringify(pills) === JSON.stringify(['1', '38', '42']), `信息条价格是数字（${JSON.stringify(pills)}）`)
check((await tid('tool-upscale-price').locator('svg').count()) === 1, '价格后面一个 Anlas 图标')
check((await tid('gen-price').innerText()).trim() === '0', `Opus 免费写 0（${await tid('gen-price').innerText()}）`)
const priceStyle = (loc, on = false) => loc.evaluate((el, on) => {
  const probe = document.createElement('span')
  probe.style.color = `var(--price${on ? '-on' : ''})`
  probe.style.backgroundColor = `var(--price${on ? '-on' : ''}-bg)`
  el.append(probe)
  const actual = getComputedStyle(el)
  const expected = getComputedStyle(probe)
  const ok = actual.color === expected.color && actual.backgroundColor === expected.backgroundColor && !!el.querySelector('svg') && /^\d+$/.test(el.textContent.trim())
  probe.remove()
  return ok
}, on)
check(await priceStyle(tid('tool-upscale-price')), '信息条价格采用当前主题的黄色牌子、数字和晶体')
check(await priceStyle(tid('gen-price'), true), '生成按钮价格采用深底奶黄字、数字和晶体')
await tid('tool-upscale').click()
await tid('tool-confirm').waitFor()
check(await priceStyle(tid('tool-run-price'), true), '确认按钮价格采用深底奶黄字、数字和晶体')
await tid('tool-cancel').click()

await tid('tool-more').click()
await page.waitForSelector('[data-testid=tool-more-menu]')
const items = await tid('tool-more-menu')
  .locator('[role=menuitem]')
  .evaluateAll((els) => els.map((e) => e.dataset.testid))
check(items.slice(0, 3).join() === 'tool-ref-base,tool-ref-vibe,tool-ref-character', `更多：前三项是参考图（${items.slice(0, 4).join()}）`)
const hint = await tid('tool-ref-vibe').innerText()
check(hint.includes('添加为 Vibe Transfer') && hint.includes('将切换到 V4.5'), `V5 上写将切换到 V4.5（${hint.replace(/\s+/g, ' ')}）`)
const nowrap = await tid('tool-more-menu').evaluate((m) => [...m.querySelectorAll('[role=menuitem]')].every((e) => e.getBoundingClientRect().height <= 34))
check(nowrap, '菜单项都不折行')
check(await tid('tool-more-menu').locator('[aria-label$=" Anlas"]').evaluateAll((els) => els.length > 0 && els.every((el) => /^\d+$/.test(el.textContent.trim()) && el.querySelector('svg'))), '更多菜单价格都是数字和晶体')
await tid('tool-ref-vibe').hover()
await page.waitForTimeout(200)
check((await tid('tool-ref-vibe').evaluate((e) => getComputedStyle(e).backgroundColor)) !== 'rgba(0, 0, 0, 0)', '前三项悬停有底色')
await clip(tid('tool-more-menu'), '1-more', 4)

await tid('tool-ref-base').click()
await page.waitForSelector('[data-testid=refs-base] [data-testid=ref-tile]')
await page.waitForTimeout(300)
check((await toastText()).includes('已设为底图'), `toast：${await toastText()}`)
let s = await settings()
check(!!s.baseImage && s.baseImage.width === 832 && s.gen.width === 832 && s.gen.height === 1216, '底图 832 × 1216，尺寸不变')
check((await tid('ref-base-strength-input').inputValue()) === '0.70', '底图强度默认 0.70')
const originalStrength = (await settings()).gen.strength
await tid('ref-base-strength-input').fill('0.12')
await tid('ref-base-strength-input').press('Escape')
const actual = await tid('ref-base-strength-input').inputValue()
check(actual === '0.70' && (await settings()).gen.strength === originalStrength, `Esc restores strength 0.70 without changing storage (actual ${actual})`)
await tid('ref-base-strength-inc').click()
check((await tid('ref-base-strength-input').inputValue()) === '0.75', '＋ 一次 0.05')
await tid('ref-base-strength-input').fill('0.3')
await tid('ref-base-strength-input').press('Enter')
check((await tid('ref-base-strength-input').inputValue()) === '0.30', '输入 0.3 ↵')
await tid('ref-base-strength-input').focus()
await page.keyboard.press('ArrowUp')
check((await tid('ref-base-strength-input').inputValue()) === '0.31', '↑ 一次 0.01')
await tid('ref-base-strength-input').fill('5')
await tid('ref-base-strength-input').press('Enter')
check((await tid('ref-base-strength-input').inputValue()) === '0.99', '超出范围按边界 0.99')
await tid('ref-base-strength-input').fill('0.5')
await tid('ref-base-strength-input').press('Enter')
s = await settings()
check(s.gen.strength === 0.5, `文档里 gen.strength = ${s.gen.strength}`)
const stepper = await tid('ref-base-strength').evaluate((e) => ({ h: e.getBoundingClientRect().height, bg: getComputedStyle(e).backgroundColor }))
check(stepper.h === 24 && stepper.bg !== 'rgba(0, 0, 0, 0)', `数值是实心的格子（${JSON.stringify(stepper)}）`)

await dropFile('#c87')
const opts = await tid('image-intake')
  .locator('button[data-testid^=intake-]')
  .evaluateAll((els) => els.map((e) => e.dataset.testid))
check(JSON.stringify(opts) === JSON.stringify(['intake-import', 'intake-ref-base', 'intake-ref-vibe', 'intake-ref-character', 'intake-tools', 'intake-gallery']), `拖图弹窗：导入 prompt 后三项在 Director Tools 前面（${JSON.stringify(opts)}）`)
check((await tid('intake-ref-vibe').innerText()).includes('将切换到 V4.5'), '拖图弹窗：说明里写将切换到 V4.5')
await clip(tid('image-intake'), '2-intake', 8)
await tid('intake-ref-vibe').click()
await page.waitForSelector('[data-testid=refs-vibe] [data-testid=ref-tile]')
await page.waitForTimeout(300)
s = await settings()
check(s.model === 'v45-full' && s.vibes?.length === 1 && s.vibes[0].informationExtracted === 0.7 && s.vibes[0].strength === 0.6, `切到 V4.5 Full，Vibe 默认信息量 0.7 强度 0.6（${s.model}）`)
check((await toastText()).includes('模型已切换为 V4.5 Full'), `toast：${await toastText()}`)
await page.locator('[data-sonner-toast] button', { hasText: '撤销' }).last().click()
await page.waitForTimeout(300)
s = await settings()
check(s.model === 'v5-full' && !s.vibes?.length, `撤销：回到 V5 Full、没有 Vibe（${s.model}）`)
await dropFile('#c87')
await tid('intake-ref-vibe').click()
await page.waitForSelector('[data-testid=refs-vibe] [data-testid=ref-tile]')
await page.waitForTimeout(400)
check((await tid('ref-cost').count()) === 1 && (await tid('refs-vibe-price').innerText()).trim() === '2', '没编码：图上角标 2、组标题小牌子 2')
await tid('gen-price').hover()
await page.waitForTimeout(500)
const partsText = (await tid('gen-price-parts').innerText().catch(() => '')).replace(/\s+/g, ' ')
check(partsText.includes('Vibe 编码 1 张'), `底栏悬停拆开写（${partsText}）`)
await clip(tid('gen-footer'), '3-footer', 60)
await page.mouse.move(2, height - 40)

await page.evaluate(() => (window.__naiRequests.length = 0))
await generate()
await idle()
await page.waitForTimeout(500)
let reqs = await requests()
const enc = reqs.filter((r) => r.url === 'ai/encode-vibe')
const gen = reqs.find((r) => r.url === 'ai/generate-image-stream')?.req
check(enc.length === 1 && enc[0].req.model === 'nai-diffusion-4-5-full' && enc[0].req.information_extracted === 0.7, `先编码 1 次（${JSON.stringify(enc.map((r) => r.req))}）`)
check(gen?.action === 'img2img' && gen.parameters.image === 'image' && gen.parameters.strength === 0.7 && gen.parameters.extra_noise_seed === gen.parameters.seed - 1, `有底图：img2img、强度 0.7（V4.5 Full 的）、extra_noise_seed（${gen?.parameters.strength}）`)
check(gen?.parameters.reference_image_multiple_cached?.[0]?.data === 'ref_multiple_0' && JSON.stringify(gen.parameters.reference_strength_multiple) === '[0.6]', 'Vibe：reference_image_multiple_cached + 强度 [0.6]')
check((await tid('ref-cost').count()) === 0 && (await tid('refs-vibe-price').count()) === 0, '编过以后：角标、小牌子都没了')
await page.evaluate(() => (window.__naiRequests.length = 0))
await generate()
await idle()
reqs = await requests()
check(!reqs.some((r) => r.url === 'ai/encode-vibe'), '再生成：不再编码')
await page.evaluate(async () => (await window.__peImport('/src/store/storage.ts')).settleWrites(10_000))
await page.reload()
await page.waitForSelector('[data-testid=refs-vibe] [data-testid=ref-tile]', { timeout: 30000 })
await page.waitForTimeout(800)
check((await tid('ref-cost').count()) === 0 && (await tid('refs-vibe-price').count()) === 0, '刷新以后：编过的照样不花钱（编码在图库文件夹里）')
await page.waitForSelector('[data-testid=refs-base] img', { timeout: 10000 }).then(
  () => check(true, '刷新以后：参考图从图库文件夹读回来'),
  () => check(false, '刷新以后：参考图从图库文件夹读回来'),
)

await dropFile('#99c', 600, 900)
check(!(await tid('intake-ref-character').innerText()).includes('将切换'), 'V4.5 上精准参考不用切换')
await tid('intake-ref-character').click()
await page.waitForSelector('[data-testid=refs-character] [data-testid=ref-tile]')
await page.waitForTimeout(400)
check((await tid('refs-vibe-off').innerText()) === '有精准参考时无法使用 Vibe Transfer', 'Vibe 那一组灰着，写原因')
check((await tid('refs-character-price').innerText()).trim() === '5', '精准参考：小牌子 5')
await tid('ref-char-type').click()
check((await page.locator('[data-testid^="ref-char-type-"]').allTextContents()).length === 3, '精准参考有三种类型')
await tid('ref-char-type-style').click()
await page.waitForTimeout(200)
check((await tid('ref-char-type').innerText()).trim() === '画风', '类型改成画风')
await clip(tid('box-refs'), '4-box', 8)
await page.evaluate(() => (window.__naiRequests.length = 0))
await generate()
await idle()
reqs = await requests()
const g2 = reqs.find((r) => r.url === 'ai/generate-image-stream')?.req.parameters
check(
  g2 &&
    !g2.reference_image_multiple_cached &&
    g2.director_reference_images_cached?.[0]?.data === 'director_ref_0' &&
    g2.director_reference_descriptions?.[0]?.caption?.base_caption === 'style' &&
    JSON.stringify(g2.director_reference_secondary_strength_values) === '[0]',
  `精准参考：director_*、不发 Vibe（${JSON.stringify(g2 && { d: g2.director_reference_descriptions, s: g2.director_reference_secondary_strength_values })}）`,
)

await page.mouse.move(2, height - 40)
await page.waitForTimeout(300)
await tid('version-bar-n').hover()
await page.waitForSelector('[data-testid=version-bar-changes-tip]', { timeout: 5000 }).catch(() => {})
const tip = (await tid('version-bar-changes-tip').first().innerText().catch(() => '')).replace(/\s+/g, ' ')
check(tip.includes('添加 精准参考'), `版本号悬停：改动（${tip}）`)
check((await tid('version-bar-changes').count()) === 0, '改动那一行不常驻')
await clip(tid('version-bar'), '5-bar', 4)
await page.mouse.move(2, height - 40)

await tid('history-head').click()
await page.waitForTimeout(400)
await page.locator('[data-testid=gen-history] [data-testid=history-group][data-version="1"] [data-testid=history-item]').first().click()
await page.waitForTimeout(300)
await tid('version-revert').click()
await page.waitForTimeout(300)
s = await settings()
check(!s.baseImage && !s.vibes?.length && !s.characterRefs?.length && s.model === 'v5-full', '导入 v1 的 prompt：没有参考图、V5 Full')
await page.keyboard.press('Control+z')
await page.waitForTimeout(300)
s = await settings()
check(!!s.baseImage && s.vibes?.length === 1 && s.characterRefs?.length === 1, 'Ctrl+Z：参考图回来')

const update = (patch) => page.evaluate(async (patch) => {
  const t = await window.__peImport('/src/store/tabs.ts')
  t.getDocStore(t.useTabs.getState().activeId).getState().updateSettings(patch)
}, patch)
await update({ model: 'v5-full' })
await page.waitForTimeout(250)
check((await tid('refs-vibe-off').innerText()).includes('V5 Full 无法使用') && (await tid('refs-character-off').innerText()).includes('V5 Full 无法使用'), 'V5 两组均显示无法使用的原因')
for (const kind of ['base', 'vibe', 'character']) {
  await tid('refs-add').click()
  const item = tid(`refs-add-${kind}`)
  check((await item.locator('span.text-ink-2').count()) === 1 || (await item.innerText()).split('\n').length >= 2, `${kind} 添加项有说明`)
  if (kind !== 'base') check((await item.innerText()).includes('将切换到 V4.5'), `${kind} 添加项提示切换模型`)
  const picker = page.waitForEvent('filechooser')
  await item.click()
  await picker
  check(true, `${kind} 选择后才打开文件选择器`)
}
await update({ model: 'v45-full' })
await page.waitForTimeout(250)
const strength = tid('ref-base-strength-input')
const initial = await strength.inputValue()
await strength.focus()
await strength.press('ArrowDown')
check(Math.abs(Number(await strength.inputValue()) - Number(initial) + .01) < .0001, '向下键减 0.01')
await strength.blur()
await page.waitForTimeout(1000)
const beforeClicks = await strength.inputValue()
await tid('ref-base-strength-inc').click()
await tid('ref-base-strength-inc').click()
await page.keyboard.press('Control+z')
await page.waitForTimeout(250)
check((await strength.inputValue()) === beforeClicks, '连续点加号后 Ctrl+Z 一步回去')
await tid('ref-base-strength-dec').click()
check(Math.abs(Number(await strength.inputValue()) - Number(beforeClicks) + .05) < .0001, '减号一次减 0.05')

const base = tid('refs-base').getByTestId('ref-tile')
const vibeTile = tid('refs-vibe').getByTestId('ref-tile')
await vibeTile.getByTestId('ref-enabled').click()
check((await settings()).vibes[0].enabled === false, '停用参考图')
await vibeTile.getByTestId('ref-enabled').click()
check((await settings()).vibes[0].enabled === true, '启用参考图')
await base.hover()
await base.getByTestId('ref-more').click()
const replacePicker = page.waitForEvent('filechooser')
await tid('ref-replace').click()
const replaceFile = await replacePicker
const png = await page.evaluate(async () => {
  const canvas = new OffscreenCanvas(256, 320)
  canvas.getContext('2d').fillRect(0, 0, 256, 320)
  return Array.from(new Uint8Array(await (await canvas.convertToBlob({ type: 'image/png' })).arrayBuffer()))
})
await replaceFile.setFiles({ name: 'replacement.png', mimeType: 'image/png', buffer: Buffer.from(png) })
await page.waitForFunction(async () => {
  const t = await window.__peImport('/src/store/tabs.ts')
  return t.getDocStore(t.useTabs.getState().activeId).getState().doc.settings.baseImage?.width === 256
})
check((await settings()).baseImage.height === 320, '替换图片写入新尺寸')
await base.hover()
await base.getByTestId('ref-more').click()
await tid('ref-remove').click()
check(!(await settings()).baseImage, '移除参考图')

const refs = await settings()
await update({ gen: { ...refs.gen, nSamples: 3 } })
check((await tid('refs-character-price').innerText()).trim() === '15', '精准参考费用 = 5 × 3 张')
await update({ characterRefs: [], vibes: Array.from({ length: 5 }, (_, i) => ({ ...refs.vibes[0], informationExtracted: .21 + i * .01 })) })
check((await tid('refs-vibe-price').innerText()).trim() === '12', '5 张未编码 Vibe：编码 10 + 超额 2')
await tid('refs-vibe-price').hover()
await page.waitForTimeout(600)
check((await page.locator('[data-slot=tooltip-content]').last().innerText()).includes('每多 1 张'), '超额 Vibe 小牌子悬停说明每张费用')
await update(refs)
await dropFile('#387', 600, 800)
await tid('intake-ref-base').click()
await page.waitForTimeout(300)
check((await toastText()).includes('尺寸已改为'), '添加不同尺寸的底图时提示尺寸已改')

await page.mouse.move(2, height - 40)
await clip(tid('box-refs'), '6-box-final', 8)

check(errors.length === 0, `没有 console 报错（${errors.slice(0, 3).join(' | ')}）`)
console.log(fails.length ? `\n${fails.length} 项失败` : '\n全部通过')
await browser.close()
process.exit(fails.length ? 1 : 0)
