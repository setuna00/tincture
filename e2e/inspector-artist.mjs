import { chromium } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { routeDanbooru } from './danbooru-mock.mjs'
import { E2E_URL, isolate, resetStore } from './store.mjs'

const theme = process.argv[2] ?? 'light'
const prefix = process.argv[3] ?? 'insp'
const width = Number(process.argv[4] ?? 1440)
const out = 'e2e/shots'
mkdirSync(out, { recursive: true })

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width, height: 900 }, deviceScaleFactor: 2 })
await isolate(page.context())
const errors = []
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
page.on('pageerror', (e) => errors.push(String(e)))
const api = []
await routeDanbooru(page, { log: api })
const base = E2E_URL
await page.goto(base)
await resetStore(page, { kv: { 'pe:prefs': { state: { theme: theme }, version: 3 } } })
await page.reload()
await page.waitForLoadState('networkidle')
await page.waitForTimeout(800)

const fails = []
const check = (ok, msg) => (ok ? console.log('ok  ', msg) : (fails.push(msg), console.log('FAIL', msg)))
const name = (n) => `${out}/${prefix}-inspector-artist-${n}-${theme}${width === 1440 ? '' : `-${width}`}.png`
const chip = (text) => page.getByTestId('chip').filter({ has: page.locator('.chip-text').getByText(text, { exact: true }) }).first()
const head = page.getByTestId('inspector-artist')
const loadedImgs = () => head.locator('[data-testid=artist-media] img[data-state=ok]').count()
const shotHead = async (n) => {
  await page.mouse.move(width / 2, 880)
  await page.waitForTimeout(300)
  const h = await head.boundingBox()
  const w = await page.getByTestId('inspector-weight').boundingBox()
  await page.screenshot({ path: name(n), clip: { x: h.x - 14, y: 0, width: h.width + 28, height: Math.ceil(w.y + w.height + 14) } })
  console.log('shot', name(n))
}

await chip('mika pikazo').click()
await head.waitFor()
await page.waitForFunction(() => document.querySelectorAll('[data-testid=inspector-artist] [data-testid=artist-media] img[data-state=ok]').length === 3, null, { timeout: 10_000 }).catch(() => {})
check((await loadedImgs()) === 3, '预存的画师（mika pikazo）：3 张作品图')
check((await head.getByTestId('inspector-literal').textContent()) === 'artist:mika pikazo', '标题 artist:mika pikazo')
await shotHead('mika')

await head.getByTestId('artist-media-open').nth(1).click()
await page.getByTestId('artist-lightbox').waitFor()
check((await page.getByTestId('lightbox-counter').textContent()).trim().startsWith('2 /'), '点第 2 张：放大从第 2 张开始')
await page.keyboard.press('ArrowRight')
check((await page.getByTestId('lightbox-counter').textContent()).trim().startsWith('3 /'), '→ 翻到第 3 张')
await page.screenshot({ path: name('lightbox') })
await page.keyboard.press('Escape')
await page.getByTestId('artist-lightbox').waitFor({ state: 'detached' }).catch(() => {})
await page.waitForTimeout(250)
check((await head.count()) === 1, 'Esc 只关放大，tag 还选中着')

const star = head.getByTestId('inspector-artist-star')
await star.click()
check((await star.getAttribute('aria-pressed')) === 'true', '☆：收藏了')
const favIn = () => page.evaluate(async () => JSON.parse((await window.__peImport('/src/store/storage.ts')).safeStorage.getItem('pe:library') ?? '{}').state?.artistCollections?.find((c) => c.id === 'fav')?.items.map((x) => x.name) ?? [])
await page.waitForTimeout(300)
check((await favIn()).includes('mika pikazo'), '收藏存进画师库的「收藏」合集')
await head.getByTestId('inspector-artist-collections').click()
const menu = page.getByRole('menu')
await menu.waitFor()
check((await menu.getByTestId('collection-check').first().getAttribute('data-state')) === 'checked', '⊕ 菜单：收藏勾着')
await page.waitForTimeout(200)
await page.screenshot({ path: name('collections') })
await page.keyboard.press('Escape')
await star.click()
await page.waitForTimeout(200)

await chip('ciloranko').click()
await page.waitForFunction(() => document.querySelectorAll('[data-testid=inspector-artist] [data-testid=artist-media] img[data-state=ok]').length === 3, null, { timeout: 10_000 }).catch(() => {})
check((await loadedImgs()) === 3, '不在预存里的画师（ciloranko）：问 Danbooru 拿到 3 张')
check(api.some((p) => p.includes('posts.json')), '发了 posts.json 请求')
await shotHead('ciloranko')

const sec = page.getByTestId('section').filter({ has: page.getByTestId('section-name').getByText('画师', { exact: true }) }).first()
await sec.getByTestId('tag-input').click()
await page.keyboard.type('artist:nobody here', { delay: 5 })
await page.keyboard.press('Enter')
await page.waitForTimeout(200)
await chip('nobody here').click()
await page.waitForTimeout(300)
check((await head.count()) === 0 && (await page.getByTestId('inspector-artist-image').count()) === 1, '名单里没有的画师：照旧占位图、没有 ☆ / ⊕')

await chip('mika pikazo').click()
await head.getByTestId('inspector-artist-open').click()
await page.getByTestId('artist-detail').waitFor()
await page.waitForTimeout(600)
check((await page.getByTestId('artist-detail-name').textContent()) === 'artist:mika pikazo', '「在画师库中查看」：画师库打开 mika pikazo 的详情')
check((await page.getByTestId('artist-search').inputValue()) === 'mika pikazo', '搜索框里是名字')
check((await page.locator('[data-testid=artist-card][data-selected]').count()) === 1, '网格里这张卡片选中')
await page.screenshot({ path: name('library') })
await page.goto(base + '#/')
await page.waitForTimeout(400)
await page.goto(base + '#/artists')
await page.waitForTimeout(600)
check((await page.getByTestId('artist-detail').count()) === 0 && (await page.getByTestId('artist-search').inputValue()) === '', '之后再进画师库：不再自动打开详情')

await page.goto(base + '#/')
await page.waitForTimeout(500)
await chip('kantoku').click()
await head.getByTestId('inspector-artist-collections').click()
await page.getByTestId('collection-check-new').click()
await page.getByTestId('artists-page').waitFor()
await page.waitForTimeout(500)
const title = page.locator('[data-testid=artists-page] input:focus')
check((await title.count()) === 1 && (await title.inputValue()).startsWith('新合集'), '新建合集：画师库切到新合集，标题在编辑')
check((await page.getByTestId('artist-card').count()) === 1 && (await page.getByTestId('artist-name').first().textContent()) === 'kantoku', '新合集里只有 kantoku')

console.log(errors.length ? `console errors:\n${errors.join('\n')}` : 'console errors: none')
console.log(fails.length || errors.length ? `${fails.length} failed` : 'all ok')
await browser.close()
process.exit(fails.length || errors.length ? 1 : 0)
