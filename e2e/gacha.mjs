import { chromium } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { E2E_URL, isolate, resetStore } from './store.mjs'

const theme = process.argv[2] ?? 'light'
const prefix = process.argv[3] ?? 'r54-gacha'
const W = Number(process.argv[4] ?? 1440)
const H = 900
const out = 'e2e/shots'
mkdirSync(out, { recursive: true })

const browser = await chromium.launch()
const context = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 2 })
await isolate(context)
const base = E2E_URL
await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(base).origin })
const page = await context.newPage()
const errors = []
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
page.on('pageerror', (e) => errors.push(String(e)))
await page.goto(base)
const V4 = {
  state: {
    collections: [{ id: 'gc-old', name: '我的旧合集', createdAt: 1, pools: [{ id: 'p1', name: '地点', color: 'teal', kind: 'tag', target: 'prompt', tags: ['rooftop'], source: [], sourceTags: [], picked: ['rooftop'], count: [1, 1], popularity: 0 }] }],
    excludes: { 'gc-old/p1': ['alley'] },
    activeId: 'gc-old',
  },
  version: 4,
}
await resetStore(page, { theme, kv: { 'pe:gacha': V4 } })
await page.goto(`${base}#/gacha`)
await page.reload()
await page.getByTestId('gacha-pool').first().waitFor()
await page.locator('[data-testid=gacha-char]').first().waitFor({ timeout: 15000 })
await page.waitForTimeout(400)

let fails = 0
const check = (ok, what) => {
  if (!ok) fails++
  console.log(ok ? '  ✓' : '  ✗', what)
}
const shot = async (name) => {
  await page.waitForTimeout(350)
  const file = `${out}/${prefix}-${name}-${theme}${W === 1440 ? '' : `-${W}`}.png`
  await page.screenshot({ path: file })
  console.log('shot', file)
}
const away = () => page.mouse.move(W - 4, H - 4)
const noToast = async () => {
  await page.mouse.move(W - 4, 4)
  await page.waitForFunction(() => !document.querySelector('[data-sonner-toast]'), null, { timeout: 15000 })
}
const tpl = (id) => page.locator(`[data-testid=gacha-template][data-tpl="${id}"]`)
const pool = (name) => page.locator('[data-testid=gacha-pool]').filter({ has: page.locator(`[data-testid=gacha-pool-name]:text-is("${name}")`) })
const draws = (name) => pool(name).locator('[data-testid=gacha-draw]')
const drawTags = (name) => draws(name).evaluateAll((els) => els.map((e) => e.dataset.tagKey.split('|')[1]))
const allDraws = () => page.locator('[data-testid=gacha-draw]').evaluateAll((els) => els.map((e) => e.dataset.tagKey).join())
const lastToast = () => page.locator('[data-sonner-toast]').last()
const stepVal = (p, which) => pool(p).getByTestId(`gacha-tune-count-${which}-value`).innerText()

console.log('模板列表')
check((await page.getByTestId('gacha-template').count()) === 4, 'NSFW 关着：4 个模板')
check((await page.getByTestId('gacha-template').evaluateAll((els) => els.map((e) => e.querySelector('span').textContent))).join() === '角色,画师,场景,人物', '角色 · 画师 · 场景 · 人物')
check((await tpl('tpl:char').innerText()).includes('角色库全部 · 22,223'), '角色：角色库全部 · 22,223')
check((await tpl('tpl:artist').innerText()).includes('画师库 · 代表作人气前 1000'), '画师：画师库 · 代表作人气前 1000')
check((await tpl('tpl:scene').innerText()).includes('地点 · 天气时间 · 光 · 构图镜头'), '场景：地点 · 天气时间 · 光 · 构图镜头')
check((await tpl('tpl:people').innerText()).includes('服装 · 发型 · 表情 · 姿势 · 视线'), '人物：服装 · 发型 · 表情 · 姿势 · 视线')
check((await tpl('tpl:char').getAttribute('aria-current')) === 'true', '默认停在「角色」')
check((await page.getByTestId('gacha-title').innerText()) === '角色' && (await page.getByTestId('gacha-summary').innerText()) === '角色库全部 · 22,223', '标题 + 一行灰字')
for (const gone of ['gacha-panel', 'gacha-edit', 'gacha-more', 'gacha-new', 'gacha-coll']) check((await page.getByTestId(gone).count()) === 0, `没有 ${gone}（右栏 / 编辑规则 / ⋯ / 新建 / 合集）`)
check(!(await page.getByTestId('gacha-center').innerText()).includes('负面'), '没有负面那一组')
check(!(await page.locator('body').innerText()).includes('范例'), '没有范例')

console.log('场景模板')
await tpl('tpl:scene').click()
await page.waitForTimeout(500)
check((await page.getByTestId('gacha-pool').count()) === 4, '4 个池子')
check((await page.getByTestId('gacha-pool-name').allInnerTexts()).join() === '地点,天气时间,光,构图镜头', '地点 · 天气时间 · 光 · 构图镜头')
check((await pool('地点').getByTestId('gacha-pool-source').innerText()) === '场景/地点 · 285', '地点：场景/地点 · 285')
check((await pool('天气时间').getByTestId('gacha-pool-count').innerText()) === '0–1', '天气时间抽 0–1')
check((await draws('地点').count()) === 1 && (await draws('光').count()) === 1, '地点、光各抽 1 个')
check((await pool('地点').getByTestId('gacha-tune').count()) === 1, '卡头下面一条：抽几个 / 抽法')
check((await pool('地点').getByTestId('gacha-tune-wrap').getAttribute('data-open')) === null, '调参条默认收起')
check((await pool('地点').getByTestId('gacha-tune-toggle').innerText()).includes('抽法 0.5'), '卡头「1 · 抽法 0.5」')
check((await pool('地点').getByTestId('gacha-tune-pop').inputValue()) === '0.5', '抽法默认 0.5')
check((await pool('地点').getByTestId('gacha-tune').innerText()).includes('至'), '「至」')
check((await pool('地点').getByLabel('抽法往热门调一格').count()) === 0, '抽法没有 −/+')
check((await pool('地点').getByTestId('gacha-tune-count-reset').getAttribute('data-on')) === null, '没调过：没有「恢复」那一行')
await away()
await shot('scene')

console.log('调抽几个 / 抽法：记住 + 恢复')
const openTune = async (n) => {
  await pool(n).getByTestId('gacha-tune-toggle').click()
  await page.waitForTimeout(250)
}
await openTune('地点')
await openTune('光')
check((await pool('地点').getByTestId('gacha-tune-wrap').getAttribute('data-open')) === '', '点卡头展开')
await pool('地点').getByTestId('gacha-tune-count-min').getByLabel('最少加一').click()
await page.waitForTimeout(250)
check((await stepVal('地点', 'min')) === '2' && (await stepVal('地点', 'max')) === '2', '最少 + 把最多一起推上去：2 至 2')
check((await draws('地点').count()) === 2, '马上对上这一组：补了 1 个')
check((await pool('地点').getByTestId('gacha-pool-count').innerText()) === '2', '卡头写 2')
check((await pool('地点').getByTestId('gacha-tune-count-reset').getAttribute('data-on')) === '' && (await pool('地点').getByTestId('gacha-tune-count-reset').innerText()).includes('默认为 1'), '下面一行「默认为 1 · 恢复」')
const popIn = pool('光').getByTestId('gacha-tune-pop')
await popIn.fill('0')
await popIn.press('Enter')
await page.waitForTimeout(200)
check(await page.evaluate(() => document.activeElement === document.body), '↵ 提交后焦点离开抽法框（Space 照样抽一组）')
check((await pool('光').getByTestId('gacha-tune-pop-reset').innerText()).includes('默认为 0.5'), '抽法打 0：「默认为 0.5 · 恢复」')
await popIn.press('ArrowUp')
await page.waitForTimeout(150)
check((await popIn.inputValue()) === '0.25', '↑ 一格 0.25')
await popIn.blur()
await page.reload()
await page.getByTestId('gacha-pool').first().waitFor()
await page.waitForTimeout(800)
check((await page.getByTestId('gacha-title').innerText()) === '场景', '刷新后还停在「场景」')
check((await stepVal('地点', 'min')) === '2' && (await pool('光').getByTestId('gacha-tune-pop').inputValue()) === '0.25', '刷新后调过的还在')
check((await draws('地点').count()) === 2, '刷新后按调过的抽：地点 2 个')
check((await pool('地点').getByTestId('gacha-tune-dot').count()) === 1 && (await pool('天气时间').getByTestId('gacha-tune-dot').count()) === 0, '刷新后收起，调过的卡头带灯黄点')
await openTune('地点')
await openTune('光')
await pool('地点').getByTestId('gacha-tune-count-reset-btn').click()
await pool('光').getByTestId('gacha-tune-pop-reset-btn').click()
await page.waitForTimeout(400)
check((await stepVal('地点', 'min')) === '1' && (await draws('地点').count()) === 1 && (await pool('光').getByTestId('gacha-tune-pop').inputValue()) === '0.5', '恢复：回到 1 至 1、0.5，地点马上剩 1 个')
check((await pool('地点').getByTestId('gacha-tune-count-reset').getAttribute('data-on')) === null, '「恢复」那一行收起')
const stored = await page.evaluate(async () => JSON.parse((await window.__peImport('/src/store/storage.ts')).safeStorage.getItem('pe:gacha')))
check(stored.version === 6 && stored.state.collections[0]?.id === 'gc-old' && stored.state.excludes['gc-old/p1']?.[0] === 'alley' && stored.state.activeTemplate === 'tpl:scene', 'pe:gacha v6：旧合集原样留着、记着停在「场景」')

console.log('抽一组 / 最近 / 选中')
const before = await allDraws()
await page.getByTestId('gacha-roll').click()
await page.waitForTimeout(300)
const rolled = await allDraws()
check(rolled !== before, '抽一组：结果变了')
await page.keyboard.press('Space')
await page.waitForTimeout(300)
check((await allDraws()) !== rolled, 'Space 再抽一组（焦点在按钮上也只抽一次）')
await page.getByTestId('gacha-history').click()
await page.waitForTimeout(250)
const nHist = await page.getByTestId('gacha-history-row').count()
check(nHist >= 3, `最近 ▾：${nHist} 组`)
await page.getByTestId('gacha-history-row').nth(1).click()
await page.waitForTimeout(300)
check((await allDraws()) === rolled, '点最近的一组：恢复那一组')
await page.keyboard.press('Space')
await page.waitForTimeout(300)
await draws('地点').first().click()
await page.waitForTimeout(150)
const placed = (await drawTags('地点'))[0]
await page.keyboard.press('l')
await page.waitForTimeout(150)
check((await draws('地点').first().getAttribute('data-locked')) === '', 'L：锁住（角上图钉）')
await page.keyboard.press('Escape')
await page.keyboard.press('Escape')
let kept = true
for (let i = 0; i < 3; i++) {
  await page.keyboard.press('Space')
  await page.waitForTimeout(200)
  kept &&= (await drawTags('地点'))[0] === placed
}
check(kept, '抽一组 3 次：锁住的不变')
await draws('光').first().click({ button: 'right' })
await page.waitForTimeout(250)
const menu = await page.getByTestId('gacha-menu').innerText()
check(menu.includes('重抽') && menu.includes('锁定') && menu.includes('本次移除') && menu.includes('加入购物车') && !menu.includes('移出池子'), '右键：重抽 · 锁定 · 本次移除 · 加入购物车 · 复制')
await page.keyboard.press('Escape')
await page.waitForTimeout(150)
await draws('光').first().click()
await page.keyboard.press('Delete')
await page.waitForTimeout(200)
check((await draws('光').count()) === 0, 'Del：这次移除（不补）')
await away()
await shot('use')

console.log('导出')
await page.keyboard.press('Space')
await page.waitForTimeout(300)
const tags = [...(await drawTags('地点')), ...(await drawTags('天气时间')), ...(await drawTags('光')), ...(await drawTags('构图镜头'))]
await page.getByTestId('gacha-copy').click()
await page.waitForTimeout(300)
const line = await page.evaluate(() => navigator.clipboard.readText())
check(line === tags.join(', '), `复制：拼成一行（${line}）`)
await page.getByTestId('gacha-copy-more').click()
await page.waitForTimeout(200)
await page.getByTestId('gacha-copy-nai-image').click()
await page.waitForTimeout(900)
const meta = await page.evaluate(async () => {
  const items = await navigator.clipboard.read()
  const blob = await items[0].getType('image/png')
  const m = await import('/src/lib/nai-image.ts')
  return (await m.readImageMeta(blob))?.Comment ?? ''
})
check(tags.every((t) => meta.includes(t)), '▾ 复制为 NAI 图：剪贴板里的图带着这一组的 tag')
const editorPrompt = () => page.locator('[data-box-list="base.prompt"] > [data-section-id]')
await page.goto(`${base}#/`)
await page.waitForTimeout(500)
const n0 = await editorPrompt().count()
await page.goto(`${base}#/gacha`)
await page.getByTestId('gacha-pool').first().waitFor()
await page.waitForTimeout(300)
const nonEmpty = (await Promise.all(['地点', '天气时间', '光', '构图镜头'].map((p) => draws(p).count()))).filter((n) => n > 0).length
await page.getByTestId('gacha-insert').click()
await page.waitForTimeout(600)
check(page.url().endsWith('#/'), '插入到当前 tab：回到编辑器')
check((await editorPrompt().count()) === n0 + nonEmpty, `每个池子一个区块接在正面最后（+${nonEmpty}）`)
check((await page.getByTestId('section').filter({ has: page.getByTestId('random-head') }).count()) === 0, '插进来的是普通区块（不带规则）')
await page.keyboard.press('Control+z')
await page.waitForTimeout(300)
check((await editorPrompt().count()) === n0, '一步撤销')
await page.goto(`${base}#/gacha`)
await page.getByTestId('gacha-pool').first().waitFor()
await page.waitForTimeout(300)
const tabs0 = await page.getByTestId('tab').count().catch(() => 0)
await noToast()
await page.getByTestId('gacha-open').click()
await page.waitForTimeout(600)
check(page.url().endsWith('#/'), '在新 tab 中打开：回到编辑器')
check((await editorPrompt().count()) === nonEmpty, `新 tab 里 ${nonEmpty} 个区块`)
check((await page.getByTestId('tab').count().catch(() => 0)) >= tabs0, '多一个 tab')

console.log('NSFW 开着仍为四个模板；旧存档迁移')
await resetStore(page, { theme, prefs: { nsfw: 'r18' }, kv: { 'pe:gacha': { version: 5, state: { activeTemplate: 'tpl:r18', templates: { 'tpl:r18': { old: { count: [2, 2] } } } } } } })
await page.goto(`${base}#/gacha`)
await page.reload()
await page.getByTestId('gacha-pool').first().waitFor()
check((await page.getByTestId('gacha-template').count()) === 4, 'NSFW 开着也是 4 个模板')
check((await page.getByTestId('gacha-pool-name').first().innerText()) === '角色', '旧 R18 存档停在第一个模板')
const migrated = await page.evaluate(async () => (await window.__peImport('/src/store/gacha.ts')).useGacha.getState())
check(migrated.activeTemplate === 'tpl:char' && migrated.templates['tpl:r18'].old.count[0] === 2, '迁移只更改选择，保留旧模板调值')

check(!errors.length, `没有报错${errors.length ? '：' + errors.join(' | ') : ''}`)
await browser.close()
console.log(fails ? `✗ ${fails} 处失败` : '✓ 全部通过')
process.exit(fails ? 1 : 0)
