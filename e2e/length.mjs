import { chromium } from '@playwright/test'
import { openParams, toTab } from './right-panel.mjs'
import { mkdirSync } from 'node:fs'
import { E2E_URL, isolate, resetStore } from './store.mjs'

const theme = process.argv[2] ?? 'light'
const prefix = process.argv[3] ?? 'len'
const width = Number(process.argv[4] ?? 1440)
const out = 'e2e/shots'
mkdirSync(out, { recursive: true })
const url = E2E_URL

const browser = await chromium.launch()
const context = await browser.newContext({ viewport: { width, height: width < 1200 ? 800 : 900 }, deviceScaleFactor: 2 })
await isolate(context)
await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(url).origin })
const page = await context.newPage()
const errors = []
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
page.on('pageerror', (e) => errors.push(String(e)))
await page.goto(url)
await resetStore(page, { theme })
await page.reload()
await page.waitForLoadState('networkidle')

const fails = []
const check = (ok, msg) => (ok ? console.log('ok  ', msg) : (fails.push(msg), console.log('FAIL', msg)))
const suffix = `${theme}${width === 1440 ? '' : `-${width}`}`
const away = () => page.mouse.move(2, width < 1200 ? 790 : 890)
const shot = async (name, { keep = false } = {}) => {
  if (!keep) await away()
  await page.waitForTimeout(350)
  const file = `${out}/${prefix}-${name}-${suffix}.png`
  await page.screenshot({ path: file })
  console.log('shot', file)
}
const clip = async (loc, name, pad = 8) => {
  await page.waitForTimeout(300)
  const b = await loc.boundingBox()
  const file = `${out}/${prefix}-${name}-${suffix}.png`
  await page.screenshot({ path: file, clip: { x: Math.max(0, b.x - pad), y: Math.max(0, b.y - pad), width: b.width + pad * 2, height: b.height + pad * 2 } })
  console.log('clip', file)
}
// Radix can retain the previous tooltip's pointer grace area; move in steps so the next hover is recognized.
const hover = async (loc) => {
  // A wrapped inline element's bounding-box center may fall between lines; target its first line instead.
  const b = await loc.first().evaluate((e) => e.getClientRects()[0].toJSON())
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 6 })
}
const row = (key) => page.locator(`[data-testid="export-${key}"]`)
const count = async (key) => Number((await row(key).getByTestId('token-count').textContent()).replace(/\D/g, '')) || null
const ready = () =>
  page.waitForFunction(() => {
    const els = [...document.querySelectorAll('[data-testid=token-count]')]
    return els.length > 0 && els.every((e) => /^\d/.test(e.textContent))
  }, null, { timeout: 20_000 })
const sec = (name) => page.getByTestId('section').filter({ has: page.getByTestId('section-name').getByText(name, { exact: true }) }).first()
const chip = (text) => page.getByTestId('chip').filter({ has: page.locator('.chip-text').getByText(text, { exact: true }) })
const paste = async (secName, text) => {
  await sec(secName).getByTestId('tag-input').evaluate((el, t) => {
    const dt = new DataTransfer()
    dt.setData('text', t)
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }))
  }, text)
  await page.waitForTimeout(200)
}
const undo = async () => {
  await page.mouse.click(width / 2, width < 1200 ? 790 : 880)
  await page.keyboard.press('Control+z')
  await page.waitForTimeout(250)
}
const pick = async (trigger, name) => {
  await page.getByTestId(trigger).click()
  await page.getByRole('option', { name, exact: true }).click()
  await page.waitForTimeout(150)
}
const toPage = async (p) => {
  if (p === 'settings') await openParams(page)
  else await toTab(page, 'copy')
  await page.waitForTimeout(250)
}
const charIds = await page.evaluate(async () => {
  const tabs = JSON.parse((await window.__peImport('/src/store/storage.ts')).safeStorage.getItem('pe:tabs')).state
  return JSON.parse((await window.__peImport('/src/store/storage.ts')).safeStorage.getItem(`pe:doc:${tabs.activeId}`)).characters.map((c) => c.id)
})

const t0 = Date.now()
await ready()
console.log('     词表加载 + 第一次算完', Date.now() - t0, 'ms')
check((await count('base.prompt')) === 105, `正面 105 token（含质量标签）：${await count('base.prompt')}`)
check((await count('base.uc')) === 99, `负面 99 token（含 nsfw + Heavy）：${await count('base.uc')}`)
check((await count(`${charIds[0]}.prompt`)) === 44 && (await count(`${charIds[1]}.prompt`)) === 31 && (await count(`${charIds[2]}.prompt`)) === 27, '三个角色的正面 44 / 31 / 27（含自动加的 girl / boy）')
check((await row(`${charIds[0]}.uc`).getByTestId('export-empty').count()) === 1, '角色 1 负面空：压成一行，没有数')
check((await page.getByText('字符', { exact: false }).count()) === 0, '「N 字符」都换成了 token')

const segs = await row('base.prompt').locator('.meter-seg').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().width))
const track = await row('base.prompt').locator('.meter-track').evaluate((e) => e.getBoundingClientRect().width)
check(Math.abs(segs[0] / track - 105 / 1471) < 0.01 && Math.abs(segs[1] / track - 102 / 1471) < 0.01, `正面长度条：自己 105、角色 102，从左往右（${segs.map((w) => (w / track).toFixed(3))}）`)
const segsC = await row(`${charIds[0]}.prompt`).locator('.meter-seg').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().width))
check(Math.abs(segsC[0] + segsC[1] - segs[0] - segs[1]) < 1.5, '同一份额度的长度条总长一样（角色 1 的条也是 207）')

const added = row('base.prompt').getByTestId('export-added')
check((await added.textContent()) === ', very aesthetic, masterpiece, no text', `正面末尾灰字 = 质量标签：${await added.textContent()}`)
const ucText = await row('base.uc').getByTestId('export-text').textContent()
check(ucText.startsWith('nsfw, lowres, artistic error') && ucText.includes('blank page, lowres, bad anatomy'), '负面开头灰字 = nsfw + Heavy，后面接自己写的')
await row('base.prompt').getByTestId('export-copy').click()
const copied = await page.evaluate(() => navigator.clipboard.readText())
check(copied.endsWith('high complexity, absurdres') && !copied.includes('no text'), `复制正面不带灰字：…${copied.slice(-30)}`)
await hover(added)
await page.waitForTimeout(700)
check((await page.getByRole('tooltip').first().textContent())?.includes('质量预设 Standard · NAI 出图时添加'), '灰字悬停：质量预设 Standard · NAI 出图时添加，复制时不包含')
await away()

const dupChips = await page.$$eval('.chip[data-dup]', (els) => els.map((e) => e.querySelector('.chip-text').textContent))
check(JSON.stringify(dupChips) === JSON.stringify(['very aesthetic', 'masterpiece', 'lowres', 'jpeg artifacts']), `重复的 chip：${dupChips}`)
const markW = await chip('very aesthetic').first().getByTestId('chip-dup').evaluate((e) => e.getBoundingClientRect().width)
const offW = await chip('high complexity').first().getByTestId('chip-dup').evaluate((e) => e.getBoundingClientRect().width)
check(markW > 15 && offW === 0, `重复的 chip 前面有感叹号（${markW}px），不重复的没有（${offW}px）`)
const deco = await chip('masterpiece').first().locator('.chip-text').evaluate((e) => getComputedStyle(e).textDecorationStyle)
check(deco === 'wavy', '重复 chip 文字波浪线')
const border = await chip('masterpiece').first().evaluate((e) => getComputedStyle(e).borderTopColor)
const border2 = await chip('high complexity').first().evaluate((e) => getComputedStyle(e).borderTopColor)
check(border === border2, '不动边框（和同区块不重复的 chip 一样）')
await hover(chip('very aesthetic').first().getByTestId('chip-dup'))
await page.waitForTimeout(700)
check((await page.getByTestId('chip-dup-tip').first().textContent()) === '与 质量预设 Standard 重复', `chip 悬停：${await page.getByTestId('chip-dup-tip').first().textContent()}`)
await clip(sec('质量'), 'chip-tip', 40)
await away()
await page.waitForTimeout(300)

check((await row('base.prompt').getByTestId('export-dup-tag').allTextContents()).join('|') === 'very aesthetic|masterpiece', '导出正面：自己写的重复 tag 画波浪线')
check((await row('base.prompt').getByTestId('export-added').locator('.x-dup').allTextContents()).join('|') === 'very aesthetic|masterpiece', '导出正面：灰字里的也画')
await hover(row('base.uc').getByTestId('export-dup'))
await page.waitForTimeout(700)
const tip = await page.getByTestId('export-dup-tip').first().innerText()
check(tip.includes('lowres') && tip.includes('通用负面 · UC 预设 Heavy') && tip.includes('jpeg artifacts'), `导出栏感叹号悬停：${tip.replace(/\s+/g, ' ')}`)
await shot('dup-tip', { keep: true })
await away()
await page.waitForTimeout(300)

await hover(row('base.prompt').getByTestId('length-meter'))
await page.waitForTimeout(600)
const donut = page.getByTestId('length-donut')
const dt = await donut.innerText()
check(['主体', '场景', '画师', '质量', 'NAI 追加', '角色 1 芙莉莲', '角色 2 菲伦', '角色 3 修塔尔克', '207', '/ 1471'].every((s) => dt.includes(s)), `环形图图例 + 中间 207 / 1471：${dt.replace(/\s+/g, ' ')}`)
const legendSum = await donut.evaluate((el) => [...el.querySelectorAll('.text-right.tabular-nums')].slice(0, 5).reduce((a, e) => a + Number(e.textContent), 0))
check(legendSum === 105, `图例里正面各段加起来 = 105（${legendSum}）`)
await shot('donut', { keep: true })
await away()
await page.waitForTimeout(300)

await shot('1-overview')
await clip(page.getByTestId('export-panel'), 'export', 0)

await paste('场景', 'smile, ')
const smile = await page.$$eval('.chip[data-dup]', (els) => els.filter((e) => e.querySelector('.chip-text').textContent === 'smile').length)
check(smile === 2, '主体和场景都有 smile：两个都标重复')
await hover(chip('smile').last().getByTestId('chip-dup'))
await page.waitForTimeout(700)
check((await page.getByTestId('chip-dup-tip').last().textContent()) === '与 主体 重复', `场景里的 smile：${await page.getByTestId('chip-dup-tip').last().textContent()}`)
await away()
await chip('masterpiece').first().click()
for (let i = 0; i < 4; i++) {
  await page.mouse.wheel(0, -100)
  await page.waitForTimeout(60)
}
await page.waitForTimeout(300)
const order = await chip('masterpiece').first().evaluate((e) => [...e.children].map((c) => c.className.split(' ')[0]))
check(order.filter((c) => c !== 'chip-alias').slice(0, 2).join() === 'chip-dup,chip-w', `感叹号在权重段前面：${order.join(' > ')}`)
check((await chip('masterpiece').first().getAttribute('data-dup')) === '', '加了权重也算重复')
await clip(sec('质量'), 'chip-weight', 12)
await undo()
await undo()
await page.keyboard.press('Escape')
await page.keyboard.press('Escape')

await toPage('settings')
await pick('quality-preset', 'None')
await toPage('export')
await ready()
check((await row('base.prompt').getByTestId('export-added').count()) === 0, '质量 None：正面没有灰字')
check((await count('base.prompt')) === 97, `质量 None：正面 97 token（少了质量标签的 8）：${await count('base.prompt')}`)
check((await chip('very aesthetic').first().getAttribute('data-dup')) === null, '质量 None：very aesthetic 不再重复')
await page.waitForTimeout(200)
const fadeW = await chip('very aesthetic').first().getByTestId('chip-dup').evaluate((e) => e.getBoundingClientRect().width)
check(fadeW === 0, '感叹号收起（宽度过渡到 0）')
await toPage('settings')
await page.getByTestId('set-mode-furry').click()
await pick('quality-preset', 'Standard')
await toPage('export')
await ready()
const adds = await row('base.prompt').getByTestId('export-added').allTextContents()
check(adds[0] === 'fur dataset, ' && adds[1] === ', very aesthetic, masterpiece, no text', `Furry：开头灰字 fur dataset，末尾质量：${JSON.stringify(adds)}`)
check((await count('base.prompt')) === 105, 'Furry 前缀不算进长度（和 NAI 的长度条一样）')
await toPage('settings')
await page.getByTestId('set-mode-anime').click()
await toPage('export')

await paste('主体', 'Text: Hello, world!')
await ready()
const seq = await row('base.prompt').getByTestId('export-text').evaluate((el) => el.textContent)
check(/absurdres,, very aesthetic, masterpiece, no text Text: Hello, world!$/.test(seq), `Text: 在最后，灰字插在它前面：…${seq.slice(-70)}`)
await clip(row('base.prompt'), 'textrender', 4)
await undo()

await page.getByTestId('export-tab-zh').click()
await page.waitForTimeout(250)
check((await row('base.prompt').getByTestId('export-added').count()) === 1 && (await row('base.uc').getByTestId('export-added').count()) === 1, '中文对照：灰字还在')
await page.getByTestId('export-tab-en').click()

await page.getByTestId('character').first().getByTestId('character-enabled').click()
await ready()
await hover(row('base.prompt').getByTestId('length-meter'))
await page.waitForTimeout(600)
check(!(await page.getByTestId('length-donut').innerText()).includes('芙莉莲') && (await page.getByTestId('length-donut').innerText()).includes('163'), '关掉角色 1：合计 163，环形图里没有它')
await away()
await undo()

await toPage('settings')
await pick('set-model', 'V5 Curated')
await toPage('export')
await paste('主体', Array.from({ length: 160 }, (_, i) => `very long descriptive phrase number ${i}`).join(', '))
await ready()
const over = row('base.prompt').getByTestId('token-over')
check((await over.count()) === 1, '超出上限：红色三角')
check((await row('base.prompt').getByTestId('length-meter').getAttribute('data-over')) === '', '长度条变红')
check((await row(`${charIds[0]}.prompt`).getByTestId('length-meter').getAttribute('data-over')) === '', '共用额度的角色条也变红')
await hover(over)
await page.waitForTimeout(700)
const overTip = await page.getByRole('tooltip').first().textContent()
check(/超出 \d+ token（\d+ \/ 703），NAI 将截断/.test(overTip), `悬停：${overTip}`)
await shot('over', { keep: true })
await away()
await hover(row('base.prompt').getByTestId('length-meter'))
await page.waitForTimeout(600)
await shot('over-donut', { keep: true })
await away()
await undo()
await ready()
check((await row('base.prompt').getByTestId('token-over').count()) === 0, '撤销后不超了')

console.log('errors', errors.length ? errors : 'none')
console.log(fails.length ? `\n${fails.length} FAIL` : '\nall ok')
await browser.close()
process.exit(fails.length || errors.length ? 1 : 0)
