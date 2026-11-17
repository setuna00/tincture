import { chromium } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { E2E_URL, isolate, resetStore } from './store.mjs'

const theme = process.argv[2] ?? 'light'
const prefix = process.argv[3] ?? 'r40'
const W = Number(process.argv[4] ?? 1440)
const H = 900
const out = 'e2e/shots'
mkdirSync(out, { recursive: true })
const sfx = `${theme}${W === 1440 ? '' : `-${W}`}`

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 2 })
await isolate(page.context())
const errors = []
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
page.on('pageerror', (e) => errors.push(String(e)))
const base = E2E_URL

let fails = 0
const check = (ok, what) => {
  if (!ok) fails++
  console.log(ok ? '  ✓' : '  ✗', what)
}

await page.goto(base)
await resetStore(page, { theme })
await page.reload()
await page.locator('[data-testid=character]').first().waitFor()
await page.waitForTimeout(400)
let n = 0
const id = (p) => `${p}_r40_${++n}`
const chip = (text) => ({ id: id('c'), text, type: 'tag', weight: 1, disabled: false })
const ch = (name, gender, color, sections, work) => ({
  id: id('ch'), name, gender, color, enabled: true, center: { x: 0.5, y: 0.5 }, uc: [],
  ...(work ? { work } : {}),
  prompt: sections.map(([sname, tags]) => ({ id: id('s'), name: sname, color, muted: false, chips: tags.split(', ').map(chip) })),
})
const extra = [
  ch('阿乌拉', 'female', 'rose', [['角色', 'aura (sousou no frieren), sousou no frieren'], ['衣服', 'layered kimono'], ['表情', 'open mouth']], '葬送的芙莉莲'),
  ch('雪奈', 'female', 'pink', [['外观', 'silver hair, long hair, blue eyes, hair ribbon, school uniform, smile']]),
  ch('', 'female', 'teal', [['外观', 'hatsune miku, kagamine rin, aqua hair, twintails, headset, detached sleeves']]),
  ch('师父', 'female', 'green', [['外观', 'frieren, elf, pointy ears, white hair, twintails, green eyes']]),
  ch('', 'female', 'sky', [['外观', 'alisa mikhailovna kujou, silver hair, long hair, blue eyes, school uniform']]),
  ch('', 'female', 'fuchsia', [['外观', 'hatsune miku (cosplay), fern (sousou no frieren), purple hair, twintails, detached sleeves']]),
  ch('', 'female', 'indigo', [['外观', 'hatsune miku (cosplay), brown hair, twintails, detached sleeves, necktie']]),
  ch('', 'female', 'amber', [['外观', 'artoria pendragon (fate), fate/grand order, blonde hair, ahoge, armor']]),
]
await page.evaluate(async (extra) => {
  const tabs = JSON.parse((await window.__peImport('/src/store/storage.ts')).safeStorage.getItem('pe:tabs'))
  const key = `pe:doc:${tabs.state.activeId}`
  const doc = JSON.parse((await window.__peImport('/src/store/storage.ts')).safeStorage.getItem(key))
  doc.characters.push(...extra)
  ;(await window.__peImport('/src/store/storage.ts')).safeStorage.setItem(key, JSON.stringify(doc))
}, extra)
const charsReq = []
// Vite's ?import&url requests only export a URL; count the separate asset fetch to measure actual loading.
page.on('request', (r) => r.url().includes('chars.json.gz') && !r.url().includes('import') && charsReq.push(r.url()))
await page.reload()
const cards = page.locator('[data-testid=character]')
await cards.nth(10).waitFor()
await page.waitForTimeout(800)
const away = () => page.mouse.move(W - 4, H - 4)

const head = async (i) => {
  const card = cards.nth(i)
  const input = card.getByTestId('character-name')
  const name = (await input.inputValue()) || (await input.getAttribute('placeholder'))
  const work = (await card.getByTestId('character-work-label').count()) ? await card.getByTestId('character-work-label').innerText() : ''
  return { name, work, derived: (await input.getAttribute('data-derived')) !== null }
}

console.log('卡头：名字、作品（没手填的从角色 tag 读）')
check(charsReq.length === 1, `作品表首帧后就取（${charsReq.length} 次）`)
if (charsReq.length !== 1) console.log(charsReq)
const expected = [
  ['芙莉莲', '葬送的芙莉莲', false, '示例：名字、作品都填过'],
  ['菲伦', '葬送的芙莉莲', false, '示例'],
  ['修塔尔克', '葬送的芙莉莲', false, '示例（♂）'],
  ['阿乌拉', '葬送的芙莉莲', false, '从抽卡页加进来的'],
  ['雪奈', '', false, '原创、没有角色 tag：只有名字'],
  ['初音未来', 'VOCALOID', true, '两个角色 tag 按第一个'],
  ['师父', '葬送的芙莉莲', false, '名字用手填的，作品从 tag 读'],
  ['艾莉莎·米哈伊洛夫娜·九条', '不时轻声地以俄语遮羞的邻座艾莉同学', true, '很长'],
  ['菲伦', '葬送的芙莉莲', true, '(cosplay) 是通用 tag，按后面的 fern 读'],
  ['角色 10', '', false, '只有 (cosplay)：照旧「角色 N」'],
  ['阿尔托莉雅·潘德拉贡', 'FGO', true, '区块里写了作品 tag（这个角色的作品之一）就用它'],
]
for (const [i, [name, work, derived, what]] of expected.entries()) {
  const h = await head(i)
  check(h.name === name && h.work === work && h.derived === derived, `${i + 1} ${what}：「${h.name}　${h.work}」${h.derived ? '（读出来的）' : ''}`)
}

const gap = await cards.nth(1).evaluate((card) => {
  const a = card.querySelector('[data-testid=character-name]').getBoundingClientRect()
  const b = card.querySelector('[data-testid=character-work-label]')?.getBoundingClientRect()
  return b ? Math.round(b.left - a.right) : null
})
check(gap === 6, `名字和作品之间 6px（${gap}）`)
const longCase = await cards.nth(7).evaluate((card) => {
  const w = card.querySelector('[data-testid=character-work-label]')
  const nm = card.querySelector('[data-testid=character-name]')
  return { workCut: !!w && w.scrollWidth > w.clientWidth, nameCut: nm.scrollWidth > nm.clientWidth + 1 }
})
console.log('  ·', W, '宽：作品省略了', longCase.workCut, '· 名字被截', longCase.nameCut)
check(!longCase.nameCut, '名字不截')
if (W <= 1100) check(longCase.workCut, '窄窗口：作品先省略')

await away()
for (const i of [3, 5, 7, 8, 9, 10]) {
  const hd = cards.nth(i).locator('.char-head')
  await hd.evaluate((el) => el.scrollIntoView({ block: 'center' }))
  await page.waitForTimeout(80)
  const b = await cards.nth(i).boundingBox()
  const hb = await hd.boundingBox()
  await page.screenshot({ path: `${out}/${prefix}-head${i + 1}-${sfx}.png`, clip: { x: b.x - 6, y: b.y - 6, width: b.width + 12, height: hb.height + 12 } })
}
await cards.nth(3).evaluate((el) => el.scrollIntoView({ block: 'start' }))
await page.waitForTimeout(200)
await page.screenshot({ path: `${out}/${prefix}-full-${sfx}.png` })
console.log('shot', `${prefix}-full-${sfx}.png`)

console.log('打名字 = 手填；清空 = 回到读出来的')
const miku = cards.nth(5)
const mikuName = miku.getByTestId('character-name')
await mikuName.click()
await page.keyboard.type('米库')
await page.waitForTimeout(150)
let h = await head(5)
check(h.name === '米库' && h.work === 'VOCALOID' && !h.derived, `打了「米库」：${h.name}　${h.work}`)
await page.keyboard.press('Control+a')
await page.keyboard.press('Backspace')
await page.waitForTimeout(150)
h = await head(5)
check(h.name === '初音未来' && h.derived, `清空：回到读出来的「${h.name}」`)
await page.keyboard.press('Escape')
await page.evaluate(() => document.activeElement?.blur())

console.log('停用区块 / 禁用 chip 里的角色 tag 不算')
const shifu = cards.nth(6)
await shifu.getByTestId('section').first().getByTestId('section-enabled').click()
await page.waitForTimeout(150)
h = await head(6)
check(h.name === '师父' && h.work === '', `外观停用：作品不再读（「${h.name}　${h.work}」）`)
await page.keyboard.press('Control+z')
await page.waitForTimeout(150)
h = await head(6)
check(h.work === '葬送的芙莉莲', `Ctrl+Z：作品回来（${h.work}）`)

console.log('左栏「选中的角色」跟卡头一致')
await away()
const mh = miku.locator('.char-head')
const mb = await mh.boundingBox()
await mh.evaluate((el) => el.scrollIntoView({ block: 'center' }))
await page.waitForTimeout(100)
const mb2 = await mh.boundingBox()
await page.mouse.click(mb2.x + mb2.width - 140, mb2.y + mb2.height / 2)
await page.getByTestId('character-inspector-name').waitFor()
await page.waitForTimeout(250)
const ip = await page.getByTestId('character-inspector-name').getAttribute('placeholder')
const iv = await page.getByTestId('character-inspector-name').inputValue()
check(iv === '' && ip === '初音未来', `名字框没填，灰字「${ip}」`)
const wv = await page.getByTestId('character-work-value').innerText()
check(wv === 'VOCALOID', `作品按钮没填，灰字「${wv}」`)
await page.getByTestId('character-work').click()
await page.getByTestId('character-work-menu').waitFor()
await page.waitForTimeout(250)
const panel = page.locator('[data-testid=character-inspector-name]').locator('xpath=ancestor::*[contains(@class,"flex-col")][1]')
const pb = await panel.boundingBox()
await page.screenshot({ path: `${out}/${prefix}-inspector-${sfx}.png`, clip: { x: pb.x - 12, y: pb.y - 12, width: Math.min(360, W - pb.x), height: 360 } })
console.log('shot', `${prefix}-inspector-${sfx}.png`)
await page.keyboard.press('Escape')
await page.waitForTimeout(150)
const filled = await page.getByTestId('character-work-value').innerText()
check(filled === 'VOCALOID', '打开再关掉不会填进去（照旧点了才填）')
const docWork = await page.evaluate(async () => {
  const tabs = JSON.parse((await window.__peImport('/src/store/storage.ts')).safeStorage.getItem('pe:tabs'))
  return JSON.parse((await window.__peImport('/src/store/storage.ts')).safeStorage.getItem(`pe:doc:${tabs.state.activeId}`)).characters[5].work ?? null
})
check(docWork === null, `读出来的不写进文档（work = ${docWork}）`)

console.log('按住把手：只剩头部，作品照常')
await page.keyboard.press('Escape')
await cards.first().evaluate((el) => el.scrollIntoView({ block: 'start' }))
await page.waitForTimeout(150)
const grip = await cards.first().getByTestId('character-handle').boundingBox()
await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2)
await page.mouse.down()
await page.waitForTimeout(400)
const f0 = await cards.first().boundingBox()
const f1 = await cards.nth(10).boundingBox()
await page.screenshot({ path: `${out}/${prefix}-folded-${sfx}.png`, clip: { x: f0.x - 6, y: f0.y - 1, width: f0.width + 12, height: Math.min(H - f0.y, f1.y + f1.height - f0.y + 7) } })
check((await cards.nth(5).getByTestId('character-work-label').count()) === 1, '折起来时作品照常显示')
await page.keyboard.press('Escape')
await page.mouse.up()

console.log(errors.length ? `console 报错：\n${errors.join('\n')}` : '没有 console 报错')
console.log(fails ? `✗ ${fails} 项没过` : '全部通过')
await browser.close()
process.exit(fails || errors.length ? 1 : 0)
