import { chromium } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { routeDanbooru } from './danbooru-mock.mjs'
import { E2E_URL, isolate, resetStore } from './store.mjs'

const theme = process.argv[2] ?? 'light'
const prefix = process.argv[3] ?? 'libf'
const width = Number(process.argv[4] ?? 1440)
const out = 'e2e/shots'
mkdirSync(out, { recursive: true })

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width, height: 900 }, deviceScaleFactor: 2 })
await isolate(page.context())
const errors = []
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
page.on('pageerror', (e) => errors.push(String(e)))
await routeDanbooru(page)
const base = E2E_URL
await page.goto(base)
await resetStore(page, { kv: { 'pe:prefs': { state: { theme: theme }, version: 3 } } })
await page.reload()
await page.waitForLoadState('networkidle')
await page.waitForTimeout(500)
const star = page.getByTestId('template-star').first()
await star.click()
await star.click()
await page.waitForTimeout(200)
await page.evaluate(async () => {
  const raw = JSON.parse((await window.__peImport('/src/store/storage.ts')).safeStorage.getItem('pe:library'))
  const now = Date.now()
  const items = (names) => names.map((name, i) => ({ name, addedAt: now - i * 1000 }))
  raw.state.artistCollections = [
    { id: 'fav', title: '收藏', items: items(['mika pikazo', 'ciloranko', 'wlop']), createdAt: 0 },
    { id: 'ac-e2e', title: '厚涂', items: items(['huke', 'redjuice']), createdAt: now },
    { id: 'ac-empty', title: '空合集', items: [], createdAt: now + 1 },
  ]
  ;(await window.__peImport('/src/store/storage.ts')).safeStorage.setItem('pe:library', JSON.stringify(raw))
})
await page.reload()
await page.waitForLoadState('networkidle')
await page.waitForTimeout(600)

const fails = []
async function inkMids(els) {
  const rects = await Promise.all(els.map((l) => l.boundingBox()))
  const x0 = Math.min(...rects.map((r) => r.x)) - 2
  const y0 = Math.min(...rects.map((r) => r.y)) - 2
  const x1 = Math.max(...rects.map((r) => r.x + r.width)) + 2
  const y1 = Math.max(...rects.map((r) => r.y + r.height)) + 2
  const buf = await page.screenshot({ clip: { x: x0, y: y0, width: x1 - x0, height: y1 - y0 } })
  const p2 = await browser.newPage()
  const res = await p2.evaluate(
    async ({ b64, rects, x0, y0, dsf }) => {
      const img = new Image()
      img.src = 'data:image/png;base64,' + b64
      await img.decode()
      const c = document.createElement('canvas')
      c.width = img.width
      c.height = img.height
      const g = c.getContext('2d')
      g.drawImage(img, 0, 0)
      const d = g.getImageData(0, 0, c.width, c.height).data
      const bg = [d[0], d[1], d[2]]
      return rects.map((r) => {
        let top = Infinity
        let bot = -Infinity
        const xa = Math.round((r.x - x0) * dsf)
        const xb = Math.round((r.x + r.width - x0) * dsf)
        for (let y = 0; y < c.height; y++)
          for (let x = xa; x < xb; x++) {
            const i = (y * c.width + x) * 4
            if (Math.abs(d[i] - bg[0]) + Math.abs(d[i + 1] - bg[1]) + Math.abs(d[i + 2] - bg[2]) > 90) {
              if (y < top) top = y
              if (y > bot) bot = y
            }
          }
        return (top + bot) / 2 / dsf + y0
      })
    },
    { b64: buf.toString('base64'), rects, x0, y0, dsf: 2 },
  )
  await p2.close()
  return res
}
const check = (ok, msg) => (ok ? console.log('ok  ', msg) : (fails.push(msg), console.log('FAIL', msg)))
const name = (n) => `${out}/${prefix}-lib-folders-${n}-${theme}${width === 1440 ? '' : `-${width}`}.png`
const lib = page.getByTestId('template-library')
const shotTop = async (n, h = 420) => {
  await page.mouse.move(width / 2, 880)
  await page.waitForTimeout(300)
  const a = await page.getByTestId('assistant').boundingBox()
  await page.screenshot({ path: name(n), clip: { x: a.x, y: 0, width: a.width + 12, height: h } })
  console.log('shot', name(n))
}

await shotTop('top')
const randomFolder = page.getByTestId('lib-folder').and(page.locator('[data-folder=random]'))
if (!(await randomFolder.count())) {
  console.log('（还没有文件夹：只拍改前）')
  await browser.close()
  process.exit(0)
}

const artistFolder = page.getByTestId('lib-folder').and(page.locator('[data-folder=artists]'))
check((await randomFolder.getAttribute('aria-expanded')) === 'false', '「随机」默认收起')
check((await artistFolder.getAttribute('aria-expanded')) === 'false', '「画师」默认收起')
check((await page.getByTestId('random-row').count()) === 0, '收起时看不到三行随机')
check((await randomFolder.textContent()).includes('3'), '「随机」写 3')
check((await artistFolder.textContent()).includes('5'), '「画师」写 5（收藏 3 + 厚涂 2，不重复的画师）')
const firstTop = await lib.locator('[data-testid=lib-folder], [data-testid=tpl-fav]').first().getAttribute('data-folder')
check(firstTop === 'random', '「随机」在最上面，「画师」在它下面，收藏 / 全部目录照旧在后面')

await randomFolder.click()
await page.waitForTimeout(250)
check((await page.getByTestId('random-row').count()) === 3, '展开「随机」：三行')
const rx = await page.getByTestId('random-name').first().boundingBox()
const fx = await randomFolder.getByTestId('lib-folder-name').boundingBox()
check(rx.x > fx.x, '三行比文件夹名缩进一层')
await shotTop('random-open')

await artistFolder.click()
await page.waitForTimeout(250)
const subs = page.getByTestId('artist-collection-folder')
check((await subs.count()) === 3, '「画师」下面 3 个子文件夹')
check((await subs.allTextContents()).map((t) => t.replace(/\d+$/, '')).join('|') === '收藏|厚涂|空合集', '顺序：收藏 · 厚涂 · 空合集')
await subs.nth(0).click()
await page.waitForTimeout(250)
const rows = page.getByTestId('artist-row')
check((await rows.count()) === 3, '展开收藏：3 个画师')
{
  const nx = (await rows.first().getByTestId('artist-name').boundingBox()).x
  const fx2 = (await subs.nth(0).getByTestId('lib-folder-name').boundingBox()).x
  check(Math.abs(nx - fx2 - 17) < 0.75, `画师名比「收藏」往里一层，同目录里的模板行（${nx.toFixed(2)} − ${fx2.toFixed(2)}）`)
  await page.mouse.move(width / 2, 880)
  await page.waitForTimeout(200)
  const [icon, nm, cnt] = await inkMids([rows.first().locator('svg').first(), rows.first().getByTestId('artist-name'), rows.first().locator('span.tabular-nums')])
  console.log('    墨迹中心 图标 / 名字 / 作品数', icon.toFixed(2), nm.toFixed(2), cnt.toFixed(2))
  check(Math.abs(icon - (nm + cnt) / 2) < 0.75, `调色板墨迹中心和名字 / 作品数对齐（差 ${(icon - (nm + cnt) / 2).toFixed(2)}px）`)
}
const counts = (await rows.evaluateAll((els) => els.map((e) => Number(e.dataset.count))))
check(counts.every((c, i) => !i || counts[i - 1] >= c) && counts[0] > 0, `按作品数从多到少（画师库默认排序）：${counts.join(' ')}`)
await subs.nth(2).click()
await page.waitForTimeout(250)
check((await page.getByTestId('artist-collection-empty').count()) === 1, '空合集：一行提示')
await shotTop('artists-open', 560)

await rows.first().hover()
const card = page.getByTestId('artist-preview')
await card.waitFor({ timeout: 3000 }).catch(() => {})
check((await card.count()) === 1, '悬停画师行：浮出预览卡')
await page.waitForFunction(() => document.querySelectorAll('[data-testid=artist-preview] [data-testid=artist-media] img[data-state=ok]').length === 3, null, { timeout: 8000 }).catch(() => {})
check((await card.locator('[data-testid=artist-media] img[data-state=ok]').count()) === 3, '预览卡：3 张作品图（预存的）')
const cb = await card.boundingBox()
const ab = await page.getByTestId('assistant').boundingBox()
check(cb.x >= ab.x + ab.width - 4, '预览卡在左栏右边（不盖住列表）')
await page.waitForTimeout(250)
{
  const r = await rows.first().boundingBox()
  await page.screenshot({ path: name('hover'), clip: { x: ab.x, y: Math.max(0, r.y - 120), width: cb.x + cb.width - ab.x + 16, height: Math.max(cb.height, 200) + 160 } })
  console.log('shot', name('hover'))
}
await rows.nth(1).hover()
await page.waitForTimeout(700)
check((await card.getAttribute('data-name')) === (await rows.nth(1).getAttribute('data-name')), '换一行：预览卡马上跟着换')
await page.mouse.move(width / 2, 880)
await page.waitForTimeout(400)
check((await card.count()) === 0, '移开：预览卡收起')

const sec = (n) => page.getByTestId('section').filter({ has: page.getByTestId('section-name').getByText(n, { exact: true }) }).first()
const target = sec('主体')
const before = await target.getByTestId('chip').count()
const drag = async (row, to, step = 12) => {
  const r = await row.boundingBox()
  await page.mouse.move(r.x + r.width / 2, r.y + r.height / 2)
  await page.mouse.down()
  await page.mouse.move(r.x + r.width / 2 + 10, r.y + r.height / 2, { steps: 3 })
  await page.mouse.move(to.x, to.y, { steps: step })
  await page.waitForTimeout(150)
}
const lastChip = target.getByTestId('chip').last()
const lc = await lastChip.boundingBox()
const dragged = await rows.nth(2).getAttribute('data-name')
await drag(rows.nth(2), { x: lc.x + lc.width - 4, y: lc.y + lc.height / 2 })
check((await page.getByTestId('drag-artist').count()) === 1, '拖动中：浮层是 artist: 的 chip')
check((await target.locator('.chip[data-drop]').count()) === 1, '拖动中：区块里有竖的插入线')
check((await page.locator('.section[data-insert]').count()) === 0, '拖动中：没有区块之间的横线')
await page.screenshot({ path: name('drag-chip') })
await page.mouse.up()
await page.waitForTimeout(300)
check((await target.getByTestId('chip').count()) === before + 1, '拖进「主体」：多了一个 chip')
check((await target.getByTestId('chip').last().locator('.chip-text').textContent()).trim() === dragged, `加在落点（最后一个 chip 后面）：${dragged}`)
check((await target.getByTestId('chip').last().getAttribute('data-cat')) === 'artist', '是画师 chip（artist:）')
await page.keyboard.press('Control+z')
await page.waitForTimeout(200)
check((await target.getByTestId('chip').count()) === before, 'Ctrl+Z 一步撤回')

const nSec = await page.getByTestId('section').count()
const tb = await target.boundingBox()
const gapBelow = await target.evaluate((el) => {
  const n = el.nextElementSibling?.getBoundingClientRect()
  const r = el.getBoundingClientRect()
  return n ? (r.bottom + n.top) / 2 : r.bottom + 4
})
const draggedSec = await rows.first().getAttribute('data-name')
await drag(rows.first(), { x: tb.x + tb.width / 2, y: gapBelow })
const next = target.locator('xpath=following-sibling::*[1]')
check((await target.getAttribute('data-insert')) === 'after' || (await next.getAttribute('data-insert')) === 'before', '拖到缝里：「主体」和下一个区块之间一条横线')
check((await page.locator('.chip[data-drop]').count()) === 0, '拖到缝里：没有竖的插入线')
await page.screenshot({ path: name('drag-section') })
await page.mouse.up()
await page.waitForTimeout(300)
check((await page.getByTestId('section').count()) === nSec + 1, '拖到区块之间：多了一个区块')
const fresh = target.locator('xpath=following-sibling::*[1]')
check((await fresh.getByTestId('section-name').textContent()) === '画师' && (await fresh.locator('.chip-text').allTextContents()).join() === draggedSec, `「主体」下面新区块「画师」，里面只有 artist:${draggedSec}`)
await page.keyboard.press('Control+z')
await page.waitForTimeout(200)
check((await page.getByTestId('section').count()) === nSec, 'Ctrl+Z 撤回新区块')

await rows.first().click({ button: 'right' })
const viewItem = page.getByTestId('artist-row-menu-open')
check((await viewItem.count()) === 1, '右键：在画师库中查看')
await page.keyboard.press('Escape')

await page.getByTestId('template-filter').fill('redju')
await page.waitForTimeout(300)
check((await page.getByTestId('artist-row').count()) === 1 && (await page.getByTestId('artist-row').first().getAttribute('data-name')) === 'redjuice', '搜「redju」：只剩 redjuice（厚涂里），自动展开')
check((await page.getByTestId('random-row').count()) === 0, '搜「redju」：随机文件夹整个不出')
await shotTop('search')
await page.getByTestId('template-filter').fill('画师')
await page.waitForTimeout(300)
check((await page.getByTestId('random-row').count()) === 1, '搜「画师」：随机文件夹里只剩「画师随机」')
await page.getByTestId('template-filter').fill('')
await page.waitForTimeout(200)

await page.reload()
await page.waitForLoadState('networkidle')
await page.waitForTimeout(500)
check((await page.getByTestId('random-row').count()) === 3, '刷新后「随机」还展开着')
check((await page.getByTestId('artist-row').count()) === 3, '刷新后「画师 › 收藏」还展开着')

console.log(errors.length ? `console 报错 ${errors.length} 条：\n${errors.join('\n')}` : '没有 console 报错')
console.log(fails.length ? `\n${fails.length} 项没过` : '\n全部通过')
await browser.close()
process.exit(fails.length || errors.length ? 1 : 0)
