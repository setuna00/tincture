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
await resetStore(page, { theme })
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
const chars = () => page.locator('[data-testid=gacha-char]')
const charTags = () => chars().evaluateAll((els) => els.map((e) => e.dataset.char))
const countTags = async () => (await page.getByTestId('gacha-count-chip').allInnerTexts()).map((t) => t.split(/\s/)[0])
const expectCount = (gs) => {
  const n = (g) => gs.filter((x) => x === g).length
  return [n('female') ? (n('female') === 1 ? '1girl' : `${n('female')}girls`) : null, n('male') ? (n('male') === 1 ? '1boy' : `${n('male')}boys`) : null, n('other') ? (n('other') === 1 ? '1other' : `${n('other')}others`) : null].filter(Boolean)
}
const stepVal = (which) => page.getByTestId(`gacha-tune-count-${which}-value`).first().innerText()

console.log('角色模板')
check((await page.getByTestId('gacha-title').innerText()) === '角色', '默认停在「角色」')
check((await page.getByTestId('gacha-pool').count()) === 1, '一个池子')
check((await page.getByTestId('gacha-pool-source').innerText()) === '角色库全部 · 22,223', '来源：角色库全部 · 22,223')
check((await chars().count()) === 1, '抽 1 个角色 = 一张小卡')
check((await page.getByTestId('gacha-tune-pop').inputValue()) === '1', '抽法默认 1（按人气）')
const first = chars().first()
check((await first.locator('.char-name').innerText()).length > 0, '小卡头部有名字')
check((await first.locator('.mt-2 > div').count()) === 1, '只有「角色」那一行（没有挂着的池子）')
const ft = (await charTags())[0]
check((await first.getByTestId('gacha-char-chip').innerText()).includes(ft), `「角色」一行：角色 tag（${ft}）`)
const g0 = await chars().evaluateAll((els) => els.map((e) => e.dataset.g))
check(JSON.stringify(await countTags()) === JSON.stringify(expectCount(g0)), `人数 · 自动跟着性别：${(await countTags()).join(', ')}`)
await away()
await shot('char')

console.log('抽 2 个')
await page.getByTestId('gacha-tune-toggle').click()
await page.getByTestId('gacha-tune-count-min').getByLabel('最少加一').click()
await page.waitForTimeout(400)
check((await stepVal('min')) === '2' && (await stepVal('max')) === '2', '2 至 2（推另一个）')
check((await chars().count()) === 2, '两张小卡')
const g2 = await chars().evaluateAll((els) => els.map((e) => e.dataset.g))
check(JSON.stringify(await countTags()) === JSON.stringify(expectCount(g2)), `人数跟着：${(await countTags()).join(', ')}`)
await chars().first().getByTestId('gacha-char-lock').click()
await page.waitForTimeout(150)
const [a, b] = await charTags()
await chars().nth(1).getByTestId('gacha-char-head').click()
await page.waitForTimeout(150)
await page.keyboard.press('r')
await page.waitForTimeout(300)
const [a2, b2] = await charTags()
check(a2 === a && b2 !== b, 'R：只换选中的角色，锁住的不动')
await page.keyboard.press('Escape')
await page.keyboard.press('Escape')
for (let i = 0; i < 2; i++) {
  await page.keyboard.press('Space')
  await page.waitForTimeout(250)
}
check((await charTags())[0] === a, 'Space 两次：锁住的角色一直在')
await away()
await shot('char2')

console.log('导出')
await page.getByTestId('gacha-copy').click()
await page.waitForTimeout(300)
const line = await page.evaluate(() => navigator.clipboard.readText())
const tagsNow = await charTags()
check(line.startsWith((await countTags()).join(', ')) && tagsNow.every((t) => line.includes(t)), `复制：人数 + 角色 + 作品（${line}）`)
const charCards = () => page.getByTestId('character')
await page.goto(`${base}#/`)
await page.waitForTimeout(500)
const c0 = await charCards().count()
const p0 = await page.locator('[data-box-list="base.prompt"] > [data-section-id]').count()
await page.goto(`${base}#/gacha`)
await page.getByTestId('gacha-pool').first().waitFor()
await page.waitForTimeout(300)
await page.getByTestId('gacha-insert').click()
await page.waitForTimeout(600)
check((await charCards().count()) === c0 + 2 && (await page.locator('[data-box-list="base.prompt"] > [data-section-id]').count()) === p0, '插入到当前 tab：只加 2 个角色框（不带人数块）')
const last = charCards().last()
check((await last.getByTestId('character-name').inputValue()).length > 0 && (await last.getByTestId('section').filter({ has: page.getByTestId('random-head') }).count()) === 0, '角色框是普通的（名字填好、不带规则）')
await page.keyboard.press('Control+z')
await page.waitForTimeout(300)
check((await charCards().count()) === c0, '一步撤销')
await page.goto(`${base}#/gacha`)
await page.getByTestId('gacha-pool').first().waitFor()
await page.waitForTimeout(300)
await noToast()
await page.getByTestId('gacha-open').click()
await page.waitForTimeout(600)
check((await charCards().count()) === 2, '在新 tab 中打开：2 个角色框')
check((await page.getByTestId('section').first().getByTestId('section-name').innerText()) === '人数', '正面第一块「人数」')

console.log('画师模板')
await page.goto(`${base}#/gacha`)
await page.getByTestId('gacha-pool').first().waitFor()
await page.locator('[data-testid=gacha-template][data-tpl="tpl:artist"]').click()
await page.waitForTimeout(500)
check((await page.getByTestId('gacha-pool-source').innerText()) === '画师库 · 代表作人气前 1000 · 1,000 位', '来源：画师库 · 代表作人气前 1000 · 1,000 位')
check((await page.locator('[data-testid=gacha-draw]').count()) === 2, '抽 2 位')
check((await page.getByTestId('gacha-tune-pop').inputValue()) === '0', '抽法默认 0')
await page.getByTestId('gacha-copy').click()
await page.waitForTimeout(300)
const aline = await page.evaluate(() => navigator.clipboard.readText())
check(/^1\.15::artist:.+::, 0\.9::artist:.+::$/.test(aline), `复制：主次权重写法（${aline}）`)
await away()
await shot('artist')

check(!errors.length, `没有报错${errors.length ? '：' + errors.join(' | ') : ''}`)
await browser.close()
console.log(fails ? `✗ ${fails} 处失败` : '✓ 全部通过')
process.exit(fails ? 1 : 0)
