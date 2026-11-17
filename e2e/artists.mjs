import { chromium } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { routeDanbooru } from './danbooru-mock.mjs'
import { E2E_URL, isolate, resetStore } from './store.mjs'

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'))
const theme = args[0] ?? 'light'
const prefix = args[1] ?? 'artists'
const width = Number(args[2] ?? 1440)
const layouts = process.argv.includes('--layouts')
const stars = process.argv.includes('--stars')
const out = 'e2e/shots'
mkdirSync(out, { recursive: true })

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width, height: 900 }, deviceScaleFactor: 2 })
await isolate(page.context())
const errors = []
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
page.on('pageerror', (e) => errors.push(String(e)))
const base = E2E_URL
// Cloudflare challenges headless browsers, so real Danbooru images and API responses are unavailable here.
const api = []
await routeDanbooru(page, { log: api })
await page.goto(base)
await resetStore(page, { kv: { 'pe:prefs': { state: { theme: theme }, version: 3 } } })
await page.goto(base + '#/artists')
await page.reload()
await page.getByTestId('artist-card').first().waitFor()
await page.waitForTimeout(600)

const tag = `${prefix}-${theme}${width === 1440 ? '' : '-' + width}`
const shot = async (name) => {
  await page.waitForTimeout(300)
  const file = `${out}/${tag}-${name}.png`
  await page.screenshot({ path: file })
  console.log('shot', file)
}
const toTop = async () => {
  await page.evaluate(() => document.querySelector('[data-testid="artists-page"] [data-slot="scroll-area-viewport"]')?.scrollTo(0, 0))
  await page.waitForTimeout(200)
}
/** Radix restores trigger focus after the exit animation; typing sooner blurs and commits the new rename input. */
const menuClosed = async (trigger) => {
  await page.locator('[data-slot=dropdown-menu-content]').waitFor({ state: 'detached' })
  await page.waitForFunction((id) => document.activeElement?.getAttribute('data-testid') === id, trigger)
}
const card = (name) => page.getByTestId('artist-card').filter({ has: page.getByTestId('artist-name').getByText(name, { exact: true }) })
const check = (ok, msg) => console.log(ok ? '  ✓' : '  ✗ FAIL', msg)
const search = async (q) => {
  await page.getByTestId('artist-search').fill(q)
  await page.waitForTimeout(500)
}

if (stars) {
  const css = {
    'A 现状：实心金，同色描边': '',
    'B 旧版：亮金 + 深描边': ':root{--fav:oklch(0.84 0.16 85)}.fav-on{color:oklch(0.62 0.14 70)}',
    'C 实心金，细线': '.fav-on svg path,.artist-star[aria-pressed=true] svg path{stroke-width:1.2}',
    'D 墨色实心（中性）': ':root{--fav:var(--ink-1)}.artist-star[aria-pressed=true]{color:#fff}.artist-star[aria-pressed=true] path{fill:#fff}',
    'E 实心金 + 按钮整体着色': '[data-testid=artist-detail-star].fav-on{background:oklch(0.8 0.16 78 / 0.16);border-color:oklch(0.8 0.16 78 / 0.5)}',
    'F 金色描边，不填': ':root{--fav:transparent}.fav-on{color:oklch(0.72 0.16 72)}.artist-star[aria-pressed=true]{color:oklch(0.86 0.16 85)}.fav-on svg path,.artist-star[aria-pressed=true] svg path{stroke-width:2.3}',
  }
  const clips = {}
  const grab = async (loc, pad) => {
    const b = await loc.boundingBox()
    return (await page.screenshot({ clip: { x: b.x - pad.l, y: b.y - pad.t, width: b.width + pad.l + pad.r, height: b.height + pad.t + pad.b } })).toString('base64')
  }
  const cardPad = { l: 70, t: 10, r: 10, b: 30 }
  const btnPad = { l: 90, t: 10, r: 50, b: 10 }
  await card('ebifurya').getByTestId('artist-star').click()
  await card('dairi').click()
  await page.getByTestId('artist-detail').waitFor()
  await page.mouse.move(2, 890)
  await page.waitForTimeout(900)
  const detailStar = page.getByTestId('artist-detail-star')
  for (const [k, v] of Object.entries(css)) {
    const h = await page.addStyleTag({ content: v || '.x{}' })
    await page.waitForTimeout(350)
    const shots = []
    await card('dairi').hover()
    await page.waitForTimeout(350)
    shots.push(await grab(card('dairi').getByTestId('artist-star'), cardPad))
    await page.mouse.move(2, 890)
    await page.waitForTimeout(350)
    shots.push(await grab(card('ebifurya').getByTestId('artist-star'), cardPad))
    shots.push(await grab(detailStar, btnPad))
    await detailStar.click()
    await page.mouse.move(2, 890)
    await page.waitForTimeout(350)
    shots.push(await grab(detailStar, btnPad))
    await detailStar.click()
    await page.mouse.move(2, 890)
    clips[k] = shots
    await h.evaluate((el) => el.remove())
  }
  await page.goto(base + '#/')
  await page.waitForTimeout(800)
  const lib = page.getByTestId('template-library')
  for (const [k, v] of Object.entries(css)) {
    const h = await page.addStyleTag({ content: v || '.x{}' })
    await page.waitForTimeout(350)
    const b = await lib.getByText('构图', { exact: true }).last().boundingBox()
    const panel = await lib.boundingBox()
    clips[k].push((await page.screenshot({ clip: { x: panel.x, y: b.y - 40, width: panel.width, height: 110 } })).toString('base64'))
    await h.evaluate((el) => el.remove())
  }
  const bg = theme === 'dark' ? '#16171c' : '#e9e9ee'
  const fg = theme === 'dark' ? '#ddd' : '#222'
  const html = `<body style="margin:0;padding:16px;background:${bg};font:14px system-ui;color:${fg}"><div style="display:grid;grid-template-columns:1fr;gap:14px 18px;align-items:start">${Object.entries(clips)
    .map(
      ([k, imgs]) =>
        `<div style="display:flex;flex-direction:column;gap:6px"><b>${k}</b><span style="opacity:.6;font-size:12px">卡片：没收藏（悬停）| 已收藏　　详情按钮：没收藏 | 已收藏　　模板栏：光照 = 已收藏，构图 / 质量 = 没收藏</span><div style="display:flex;gap:8px;align-items:flex-start">${imgs.map((d, i) => `${i === 2 || i === 4 ? '<span style="width:18px"></span>' : ''}<img src="data:image/png;base64,${d}" style="zoom:.75;border:1px solid #8884;border-radius:6px">`).join('')}</div></div>`,
    )
    .join('')}</div></body>`
  const sheet = await browser.newPage({ viewport: { width: 1500, height: 400 }, deviceScaleFactor: 2 })
  await sheet.setContent(html)
  await sheet.waitForTimeout(300)
  await sheet.screenshot({ path: `${out}/${tag}-stars.png`, fullPage: true })
  console.log('shot', `${out}/${tag}-stars.png`)
} else if (layouts) {
  const css = {
    A: '.x{}',
    B: '.artist-media{grid-template-columns:1fr 1fr 1fr!important;grid-template-rows:1fr!important;aspect-ratio:3/2!important}.artist-media>:first-child{grid-row:auto!important}',
    C: '.artist-media{grid-template-columns:1fr!important;grid-template-rows:1fr!important;aspect-ratio:3/4!important}.artist-media>:not(:first-child){display:none}.artist-media>:first-child{grid-row:auto!important}',
  }
  for (const [k, v] of Object.entries(css)) {
    const h = await page.addStyleTag({ content: v })
    await page.waitForTimeout(500)
    await shot(`layout-${k}`)
    await h.evaluate((el) => el.remove())
  }
} else {
  check((await page.getByTestId('status-hint').innerText()).includes('F 收藏'), '画师库状态栏：收藏快捷键')
  await page.getByTestId('artist-filter-fav').click()
  const empty = page.getByTestId('artist-empty')
  await empty.waitFor()
  check((await empty.innerText()).includes('选中画师后按 F 收藏'), '收藏空状态分标题与说明')
  const center = await empty.evaluate(el => {
    const viewport = el.closest('[data-slot=scroll-area-viewport]').getBoundingClientRect()
    const box = el.getBoundingClientRect()
    return (box.y + box.height / 2 - viewport.y) / viewport.height
  })
  check(center >= .35 && center <= .65, `空状态竖直居中：${center.toFixed(3)}`)
  await page.getByTestId('artist-filter-all').click()
  await page.mouse.move(2, 890)
  await shot('1-grid')
  check((await page.getByTestId('artist-name').first().textContent()) === 'bluefield', '默认按代表作人气：第一个是 bluefield')
  check(api.length === 0, `第一屏都是预存的，没问 Danbooru（问了 ${api.length} 个）`)
  await page.getByTestId('artist-sort').click()
  await page.getByTestId('artist-sort-count').click()
  await toTop()
  check((await page.getByTestId('artist-name').first().textContent()) === 'dairi', '按作品数：第一个是作品数最多的 dairi')
  await card('dairi').hover()
  await shot('2-hover')
  await card('dairi').click()
  await page.getByTestId('artist-detail').waitFor()
  await page.mouse.move(2, 890)
  await page.waitForTimeout(800)
  await shot('3-detail')
  check((await page.getByTestId('status-hint').innerText()).includes('Esc 收起详情'), '画师详情状态栏')
  check((await page.getByTestId('artist-topic').count()) > 5, '预存的题材')
  check(api.length === 0, '预存的详情不问 Danbooru')
  await page.getByTestId('artist-gallery').hover()
  await page.getByTestId('gallery-next').click()
  await page.waitForTimeout(500)
  await shot('4-gallery-hover')
  const panel = await page.getByTestId('artist-detail').boundingBox()
  await page.mouse.move(panel.x + panel.width / 2, panel.y + panel.height / 2)
  await page.mouse.wheel(0, 1200)
  await page.waitForTimeout(900)
  await shot('4b-detail-bottom')
  await page.mouse.wheel(0, -1200)
  await page.getByTestId('artist-gallery').click()
  await page.getByTestId('artist-lightbox').waitFor()
  await page.mouse.move(2, 890)
  await page.waitForTimeout(500)
  await shot('4c-lightbox')
  await page.keyboard.press('Escape')
  {
    await page.getByTestId('artist-gallery').click()
    await page.getByTestId('artist-lightbox').waitFor()
    const b = await page.getByTestId('lightbox-frame').boundingBox()
    const ok = b.x >= 0 && b.y >= 0 && b.x + b.width <= width && b.y + b.height <= 900
    check(ok, `放大框 ${Math.round(b.width)} x ${Math.round(b.height)} 完整在屏幕里`)
    await page.keyboard.press('Escape')
    await page.waitForTimeout(300)
  }
  await search('纪奈啾')
  check((await page.getByTestId('artist-name').allTextContents()).includes('ciloranko'), '搜「纪奈啾」（Danbooru 上的其他名字）找到 ciloranko')
  await page.mouse.move(2, 890)
  await shot('3a-alias-search')
  await card('ciloranko').click()
  await page.getByTestId('artist-topics').waitFor()
  await page.mouse.move(2, 890)
  await page.waitForTimeout(600)
  await shot('3b-detail-api')
  check(api.some((u) => u.startsWith('/related_tag.json') && u.includes('ciloranko')), '不在预存里的题材现问 Danbooru')
  await search('')
  await toTop()
  await page.getByTestId('artist-detail-close').click()
  await card('dairi').getByTestId('artist-star').click()
  await card('ebifurya').getByTestId('artist-star').click()
  await page.getByTestId('artist-filter-fav').click()
  await page.mouse.move(2, 890)
  await shot('5-fav')
  await page.getByTestId('artist-filter-all').click()
  await page.waitForTimeout(400)
  await toTop()
  await page.getByTestId('artist-sort').click()
  await shot('5b-sort-menu')
  await page.getByTestId('artist-sort-name').click()
  await page.mouse.move(2, 890)
  await shot('5c-sort-name')
  await page.getByTestId('artist-sort-dir').click()
  await page.mouse.move(2, 890)
  await shot('5d-sort-name-desc')
  await page.getByTestId('artist-sort').click()
  await page.getByTestId('artist-sort-count').click()
  await toTop()
  await card('dairi').click({ button: 'right' })
  await page.getByTestId('artist-menu-collections').hover()
  await page.waitForTimeout(300)
  await shot('8-context-menu')
  await page.getByTestId('collection-check-new').click()
  await page.getByTestId('collection-title-input').waitFor()
  await shot('9a-new-collection-editing')
  await page.keyboard.type('厚涂')
  await page.keyboard.press('Enter')
  await page.getByTestId('collection-desc').click()
  await page.keyboard.type('笔触明显、颜色厚重的画师')
  await page.keyboard.press('Enter')
  await page.getByTestId('artist-filter-all').click()
  await toTop()
  await card('ebifurya').click({ button: 'right' })
  await page.getByTestId('artist-menu-collections').hover()
  await page.getByTestId('collection-check').filter({ hasText: '厚涂' }).click()
  await page.keyboard.press('Escape')
  await page.keyboard.press('Escape')
  await page.getByTestId('artist-filter-collection').first().click()
  await page.getByTestId('collection-title').hover()
  await shot('9b-collection')
  await card('dairi').click()
  await page.getByTestId('artist-detail').waitFor()
  await page.waitForTimeout(400)
  await page.getByTestId('artist-detail-collections').click()
  await shot('10-detail-collections')
  await page.keyboard.press('Escape')
  await menuClosed('artist-detail-collections')
  for (let i = 0; i < 7; i++) {
    await page.getByTestId('artist-collection-new').click()
    await page.getByTestId('collection-title-input').waitFor()
    await page.keyboard.press('Escape')
  }
  await page.mouse.move(2, 890)
  await shot('11-many-collections')
  await page.getByTestId('collection-menu').click()
  await page.getByTestId('collection-delete').click()
  await page.getByTestId('confirm-ok').click()
  await page.getByTestId('confirm-dialog').waitFor({ state: 'detached' })
  await page.mouse.move(2, 890)
  await shot('12-deleted')
  await search('')
  await page.getByTestId('artist-filter-all').click()
  const topic = await page.getByTestId('artist-topic').first().innerText()
  await page.getByTestId('artist-topic').first().click()
  await page.waitForTimeout(900)
  await page.mouse.move(2, 890)
  await shot('6-topic-search')
  check(api.some((u) => u.startsWith('/related_tag.json') && u.includes('category%5D=artist')), `按题材找问了 Danbooru（${topic}）`)
  await search('')
  await page.getByTestId('rail-settings').click()
  await page.getByTestId('settings-nav-content').click()
  await page.getByTestId('set-nsfw').click()
  await page.getByTestId('page-artists').click()
  await search('as109')
  await card('as109').click()
  await page.mouse.move(2, 890)
  await page.waitForTimeout(800)
  await shot('7-nsfw')
  check((await page.getByTestId('artist-detail').getByText('NSFW 为主').count()) === 1, 'as109 标「NSFW 为主」')
  const slow = async (route) => {
    await new Promise((r) => setTimeout(r, 3000))
    return route.fallback()
  }
  await page.route(/danbooru\.donmai\.us\/[\w/]+\.json/, slow)
  await search('wlop')
  await card('wlop').click()
  await page.mouse.move(2, 890)
  await page.waitForTimeout(300)
  await shot('14-loading')
  check((await page.getByTestId('artist-gallery-loading').count()) === 1 && (await card('wlop').locator('[data-loading]').count()) === 1, '等 Danbooru 时：卡片中性底色、图集「载入中…」')
  await page.getByTestId('artist-gallery').waitFor({ timeout: 10_000 })
  await page.unroute(/danbooru\.donmai\.us\/[\w/]+\.json/, slow)
  await page.getByTestId('artist-detail-close').click()
  await search('')
  await page.evaluate(async () => {
    const s = JSON.parse((await window.__peImport('/src/store/storage.ts')).safeStorage.getItem('pe:library'))
    const fav = s.state.artistCollections.find((c) => c.id === 'fav')
    fav.items.push({ name: 'sho (sho lwlw)', addedAt: 1 }, { name: 'no such artist zz', addedAt: 2 })
    ;(await window.__peImport('/src/store/storage.ts')).safeStorage.setItem('pe:library', JSON.stringify(s))
  })
  await page.reload()
  await page.getByTestId('artist-filter-fav').click()
  await page.waitForTimeout(1500)
  const names = await page.getByTestId('artist-name').allTextContents()
  check(names.includes('todoroki masaru') && !names.includes('sho (sho lwlw)'), `改了名的跟过去：${names.join(', ')}`)
  check((await card('no such artist zz').getByTestId('artist-card-count').textContent()) === '未找到', '查不到的写「未找到」（全句在悬停提示里）')
  await page.mouse.move(2, 890)
  await shot('13-renamed-missing')
  await page.getByTestId('artist-filter-all').click()
  await page.evaluate(() => document.querySelector('[data-testid="artists-page"] [data-slot="scroll-area-viewport"]')?.scrollTo(0, 1e6))
  await shot('15-pager')
  await page.getByTestId('artist-page-jump').fill('400')
  await page.getByTestId('artist-page-jump').press('Enter')
  await page.evaluate(() => document.querySelector('[data-testid="artists-page"] [data-slot="scroll-area-viewport"]')?.scrollTo(0, 1e6))
  check((await page.getByTestId('artist-pager').locator('[aria-current="page"]').textContent()) === '400', '跳至 400 页')
  await shot('15b-pager-middle')
  await page.getByTestId('artist-page').first().click()
  await toTop()
  const active = () => page.evaluate(() => document.activeElement?.getAttribute('data-name'))
  check((await page.locator('[data-testid="artist-card"][tabindex="0"]').count()) === 1, '网格只有一个 Tab 停点')
  await page.getByTestId('artist-search').focus()
  await page.keyboard.press('Tab')
  const first = await active()
  await page.waitForTimeout(200)
  check(await card(first).evaluate((el) => getComputedStyle(el).outlineWidth === '2px' && !el.hasAttribute('data-selected') && getComputedStyle(el).outlineColor === getComputedStyle(el).getPropertyValue('--ink-2').trim()), '键盘焦点是 2px 灰环')
  await page.keyboard.press('ArrowRight')
  const second = await active()
  check(first && second && first !== second && (await page.getByTestId('artist-detail').count()) === 0, `→ 换卡片、不打开详情（${first} → ${second}）`)
  for (const key of ['ArrowDown', 'ArrowLeft', 'ArrowUp']) {
    const from = await active()
    await page.keyboard.press(key)
    check((await active()) !== from && (await page.getByTestId('artist-detail').count()) === 0, `${key} 移动焦点而不打开详情`)
  }
  await page.keyboard.press('Enter')
  await page.getByTestId('artist-detail').waitFor()
  await page.keyboard.press('ArrowRight')
  await page.waitForTimeout(400)
  const third = await active()
  check((await page.getByTestId('artist-detail-name').textContent()).endsWith(third), `详情开着时选中跟着方向键走（${third}）`)
  check(await card(third).evaluate((el) => {
    const s = getComputedStyle(el)
    const tint = getComputedStyle(el.querySelector('.gal-tint'))
    const tick = getComputedStyle(el.querySelector('.gal-check'))
    return s.outlineWidth === '2px' && s.outlineColor === s.getPropertyValue('--accent').trim() && tint.opacity === '1' && tick.opacity === '1' && parseFloat(tick.borderRadius) >= parseFloat(tick.width) / 2
  }), '选中卡片 2px 灯黄环、淡黄蒙层和圆勾')
  if ((await card(third).getByTestId('artist-star').getAttribute('aria-pressed')) === 'true') await page.keyboard.press('f')
  await page.keyboard.press('f')
  await page.waitForTimeout(250)
  check((await card(third).getByTestId('artist-star').getAttribute('aria-pressed')) === 'true', 'F 收藏')
  check(await card(third).getByTestId('artist-star').evaluate((el) => getComputedStyle(el).color === getComputedStyle(el).getPropertyValue('--fav').trim()), '收藏星为金色')
  await page.keyboard.press('f')
  check((await card(third).getByTestId('artist-star').getAttribute('aria-pressed')) === 'false', '再按 F 取消收藏')
  await page.getByTestId('artist-search').focus()
  await page.keyboard.press('f')
  check(await page.evaluate(async (name) => { const m = await window.__peImport('/src/store/library.ts'); return !m.isFavArtist(m.useLibrary.getState(), name) }, third), '搜索框输入 f 不触发收藏')
  await search('')
  await page.waitForTimeout(4600)
  check((await page.getByTestId('gallery-counter').textContent()).trim() === '1 / 20', '作品图不自动翻')
  await page.getByTestId('artist-detail-close').click()
  await page.route(/danbooru\.donmai\.us\/[\w/]+\.json/, (r) => r.fulfill({ status: 403, body: '' }))
  await search('quasarcake')
  await card('quasarcake').locator('[data-failed]').waitFor({ timeout: 10_000 })
  await card('quasarcake').click()
  await page.getByTestId('artist-topics-failed').waitFor({ timeout: 10_000 })
  await page.mouse.move(2, 890)
  await shot('16-failed')
  check(true, '连不上 Danbooru：卡片灰底 + 图标、常画题材「无法连接 Danbooru」')
  check((await page.getByTestId('artist-topics-failed').innerText()) === '无法连接 Danbooru', '常画题材显示连接失败')
  const failedMedia = card('quasarcake').locator('[data-failed]')
  check(await failedMedia.locator('.fade-img-fail').evaluate((el) => getComputedStyle(el).backgroundImage === 'none' && getComputedStyle(el).backgroundColor === getComputedStyle(el).getPropertyValue('--surface-2').trim()), '连接失败是中性灰底，没有渐变')
  check((await failedMedia.locator('svg').count()) === 1 && !(await card('quasarcake').locator('[data-placeholder]').count()), '失败卡片有断网图标，没有彩色占位')
  await failedMedia.hover()
  await page.getByRole('tooltip').waitFor()
  check((await page.getByRole('tooltip').innerText()) === '无法连接 Danbooru', '失败卡片悬停提示')
  await search('机甲')
  await page.getByText(/位 · 无法按题材查找「机甲」/).waitFor()
  check((await page.getByText(/位 · 无法按题材查找「机甲」/).count()) === 1, '题材查找失败写在数量行')

  const ctx = await browser.newContext({ viewport: { width, height: 900 }, deviceScaleFactor: 2 })
  await isolate(ctx)
  const p2 = await ctx.newPage()
  p2.on('pageerror', (e) => errors.push(String(e)))
  await routeDanbooru(p2)
  await p2.goto(base)
  await resetStore(p2, { kv: { 'pe:prefs': { state: { theme }, version: 3 } } })
  await p2.goto(base + '#/artists')
  await p2.reload()
  const card2 = (name) => p2.getByTestId('artist-card').filter({ has: p2.getByTestId('artist-name').getByText(name, { exact: true }) })
  const imgKeys = () => p2.evaluate(async () => (await (await window.__peImport('/src/store/storage.ts')).assetStore.keys('dan-img:')).sort())
  const settle = async () => {
    let last = -1
    for (let i = 0; i < 40; i++) {
      await p2.waitForTimeout(700)
      const n = (await imgKeys()).length
      if (n === last) return n
      last = n
    }
    return last
  }
  await p2.waitForFunction(() => document.querySelectorAll('[data-testid=artist-card] img[data-state=ok]').length >= 30, null, { timeout: 15_000 })
  await p2.getByTestId('artist-search').fill('ciloranko')
  await card2('ciloranko').locator('img[data-state=ok]').nth(2).waitFor({ timeout: 10_000 })
  await card2('ciloranko').click()
  await p2.getByTestId('artist-gallery').waitFor()
  const saved = await settle()
  const kinds = await p2.evaluate(async () => {
    const s = (await window.__peImport('/src/store/storage.ts')).assetStore
    await (await window.__peImport('/src/lib/artist-image-cache.ts')).flushIndex()
    const ks = await s.keys('dan-img:')
    const blobs = await s.getMany(ks)
    const index = await s.get('dan-img-index')
    return { types: [...new Set(blobs.map((b) => b?.type))], n360: ks.filter((k) => k.endsWith(':360')).length, indexed: Object.keys(index ?? {}).length, named: Object.values(index ?? {}).filter((e) => e.a.length).length }
  })
  check(saved >= 90 && kinds.n360 > 0 && kinds.types.length === 1 && kinds.types[0] === 'image/webp', `卡片的图存下了：${saved} 张，360 那档 ${kinds.n360} 张，jpg 转成了 WebP（${kinds.types.join(' / ')}）`)
  check(kinds.indexed === saved && kinds.named === saved, `索引记了每一张和画师（${kinds.indexed} / ${kinds.named}）`)
  const rest = await p2.evaluate(async () => {
    const db = await window.__peImport('/src/lib/artist-db.ts')
    const core = await window.__peImport('/src/lib/danbooru-core.ts')
    const s = (await window.__peImport('/src/store/storage.ts')).assetStore
    const posts = core.coverFirstPosts('ciloranko', 'sfw', db.useArtistData.getState().posts['posts:sfw:ciloranko'])
    const keys = posts.slice(3).map((p) => `dan-img:${/([0-9a-f]{32})\.webp$/.exec(p.large)[1]}:720`)
    const got = await s.getMany(keys)
    return { want: keys.length, have: got.filter((b) => b?.type === 'image/webp').length }
  })
  check(rest.want === 17 && rest.have === 17, `打开详情后其余的存下了（720 那档）：${rest.have} / ${rest.want}`)
  await p2.getByTestId('artist-detail-star').click()
  await p2.getByTestId('artist-detail-close').click()
  await p2.getByTestId('artist-search').fill('')
  await p2.waitForTimeout(2600)
  await p2.unrouteAll({ behavior: 'ignoreErrors' })
  await ctx.route(/donmai\.us|pixiv|twimg|bsky|fanbox|patreon|weibo|lofter|artstation/, (r) => r.abort('internetdisconnected'))
  await p2.reload()
  await p2.getByTestId('artist-card').first().waitFor()
  await p2.waitForTimeout(2500)
  const firstScreen = await p2.evaluate(() =>
    [...document.querySelectorAll('[data-testid=artist-card]')].slice(0, 12).map((c) => ({ blob: c.querySelectorAll('img[data-state=ok][src^="blob:"]').length, fail: c.querySelectorAll('[data-testid=img-fail]').length })),
  )
  check(firstScreen.every((c) => c.blob === 3 && c.fail === 0), `断网：看过的卡片照常显示（前 12 张每张 3 格本地图：${firstScreen.map((c) => c.blob).join('')}）`)
  await p2.mouse.move(2, 890)
  await p2.screenshot({ path: `${out}/${tag}-17-offline-seen.png` })
  console.log('shot', `${out}/${tag}-17-offline-seen.png`)
  await p2.getByTestId('artist-page-jump').fill('3')
  await p2.getByTestId('artist-page-jump').press('Enter')
  await p2.waitForTimeout(2000)
  const unseen = await p2.evaluate(() => {
    const c = document.querySelector('[data-testid=artist-card]')
    return { blob: c.querySelectorAll('img[src^="blob:"]').length, fail: c.querySelectorAll('[data-testid=img-fail]').length }
  })
  check(unseen.blob === 0 && unseen.fail === 3, `断网：没看过的是灰卡（第 3 页第一张：${unseen.fail} 格灰底图标）`)
  await p2.getByTestId('artist-page').first().click()
  await p2.getByTestId('artist-filter-fav').click()
  await card2('ciloranko').click()
  await p2.getByTestId('artist-gallery').waitFor({ timeout: 10_000 })
  await p2.waitForTimeout(800)
  const offGallery = await p2.evaluate(async () => {
    const out = []
    for (let i = 0; i < 4; i++) {
      out.push(document.querySelectorAll('[data-testid=artist-gallery] img[data-state=ok][src^="blob:"]').length > 0)
      document.querySelector('[data-testid=gallery-next]')?.click()
      await new Promise((r) => setTimeout(r, 500))
    }
    return out
  })
  check(offGallery.every(Boolean) && (await p2.getByTestId('artist-topics').count()) === 1, '断网：收藏画师（不在预存里）的详情有图、有题材')
  const ciloKeys = await p2.evaluate(async () => {
    const s = (await window.__peImport('/src/store/storage.ts')).assetStore
    const cache = await window.__peImport('/src/lib/artist-image-cache.ts')
    await cache.flushIndex()
    let mine = []
    await s.update('dan-img-index', (idx) => {
      for (const [k, e] of Object.entries(idx)) {
        e.t = 1
        if (e.a.includes('ciloranko')) {
          e.s = 400 * 1024 * 1024
          mine.push(k)
        }
      }
      idx['fake:720'] = { a: ['nobody'], s: 400 * 1024 * 1024, t: Date.now() - 1000 }
      return idx
    })
    await s.set('dan-img:fake:720', new Blob(['x'], { type: 'image/webp' }))
    return mine
  })
  await p2.reload()
  await p2.getByTestId('artist-card').first().waitFor()
  await p2.waitForTimeout(7000)
  const after = new Set(await imgKeys())
  check(ciloKeys.length >= 20 && ciloKeys.every((k) => after.has(`dan-img:${k}`)) && !after.has('dan-img:fake:720'), `收藏的画师超过上限也不清（${ciloKeys.length} 张都在），其余超了挤掉`)
  await ctx.close()
}

console.log(errors.length ? 'console errors:\n' + errors.join('\n') : 'no console errors')
await browser.close()
