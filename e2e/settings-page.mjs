import { chromium } from '@playwright/test'
import { openParams } from './right-panel.mjs'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { E2E_URL, isolate, resetStore } from './store.mjs'

const theme = process.argv[2] ?? 'light'
const prefix = process.argv[3] ?? 'settings-page'
const width = Number(process.argv[4] ?? 1440)
const out = 'e2e/shots'
mkdirSync(out, { recursive: true })
const url = E2E_URL
const DATES = 'src/assets/data-dates.json'
const dates = existsSync(DATES) ? JSON.parse(readFileSync(DATES, 'utf8')) : {}

const browser = await chromium.launch()
const context = await browser.newContext({ viewport: { width, height: width < 1200 ? 800 : 900 }, deviceScaleFactor: 2 })
await isolate(context)
const page = await context.newPage()
const errors = []
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
page.on('pageerror', (e) => errors.push(String(e)))
await page.goto(url)
await resetStore(page, { theme })
await page.reload()
await page.getByTestId('chip').first().waitFor()

const fails = []
const check = (ok, msg) => (ok ? console.log('ok  ', msg) : (fails.push(msg), console.log('FAIL', msg)))
const suffix = `${theme}${width === 1440 ? '' : `-${width}`}`

await page.getByTestId('rail-settings').click()
await page.getByTestId('app-settings').waitFor()
await page.mouse.move(2, 2)
await page.waitForTimeout(400)
await page.screenshot({ path: `${out}/${prefix}-page-${suffix}.png` })
const navIds = await page.locator('[data-testid^=settings-nav-]').evaluateAll((els) => els.map((e) => e.dataset.testid.replace('settings-nav-', '')))
check(navIds.join(' ') === 'account gen defaults content ai library about', `侧栏 7 类、顺序固定（${navIds.join(' ')}）`)
check((await page.locator('[data-testid^=settings-nav-] svg').count()) === 7, '每一类带图标')
check((await page.getByTestId('app-settings').getAttribute('data-page')) === 'account', '从竖条进 =「NAI 账号」页')
check((await page.getByTestId('settings-nav-account').getAttribute('data-active')) === '', '侧栏亮「NAI 账号」')
const navW = (await page.getByTestId('settings-nav').boundingBox()).width
if (width < 768) {
  check(Math.round(navW) === 56, `窄窗口侧栏只剩图标（${navW}px）`)
  check((await page.locator('[data-testid^=settings-nav-] span:visible').count()) === 0, '窄窗口不显示名字')
  await page.getByTestId('settings-nav-gen').hover()
  await page.waitForTimeout(800)
  check((await page.getByRole('tooltip').filter({ hasText: '出图' }).count()) === 1, '窄窗口悬停出名字')
  await page.mouse.move(2, 2)
  await page.waitForTimeout(300)
} else check(Math.round(navW) === 220, `侧栏 220 宽（${navW}px）`)
const pageNames = { account: 'NAI 账号', gen: '出图', defaults: '新文档的默认设置', content: '内容', ai: 'AI', library: '图库', about: '关于' }
for (const id of navIds) {
  await page.getByTestId(`settings-nav-${id}`).click()
  await page.waitForTimeout(250)
  const body = page.getByTestId('app-settings')
  const animation = await body.evaluate(el => ({ name: getComputedStyle(el).animationName, duration: parseFloat(getComputedStyle(el).animationDuration), opacity: getComputedStyle(el).getPropertyValue('--tw-enter-opacity') }))
  check(animation.name !== 'none' && animation.duration >= .15 && animation.duration <= .3 && animation.opacity.trim() === '0', '换页有 150–300ms 淡入')
  const h1 = await body.locator('h1').innerText()
  check((await body.getAttribute('data-page')) === id && h1 === pageNames[id], `点「${id}」：只显示这一页（${h1}）`)
  const box = await body.locator('section').first().evaluate((el) => {
    const cs = getComputedStyle(el.lastElementChild)
    return { w: cs.borderTopWidth, bg: cs.backgroundColor }
  })
  check(box.w === '1px' && box.bg === 'rgba(0, 0, 0, 0)', `「${id}」的节是描边框（${box.w} · ${box.bg}）`)
  const overflow = await body.evaluate((el) => el.scrollWidth - el.clientWidth)
  check(overflow <= 0, `「${id}」没有横向溢出（${overflow}px）`)
}
const vp = () => page.locator('[data-testid=settings-page] [data-slot=scroll-area-viewport]')
await page.getByTestId('settings-nav-about').click()
await vp().evaluate((el) => (el.scrollTop = el.scrollHeight))
await page.getByTestId('settings-nav-content').click()
await page.waitForTimeout(250)
check((await vp().evaluate((el) => el.scrollTop)) === 0, '换页以后从顶上开始')

await page.getByTestId('settings-nav-about').click()
await page.waitForTimeout(250)
const ver = await page.getByTestId('about-version').innerText()
check(/^v\d/.test(ver) && (await page.getByTestId('status-bar').innerText()).includes(ver), `「关于」页显示版本，同状态栏（${ver}）`)
const card = page.getByTestId('data-dates')
check((await card.count()) === 1, '「关于」页有「数据日期」')
if (await card.count()) {
  await card.screenshot({ path: `${out}/${prefix}-zoom-dates-${suffix}.png` })
  const rows = card.getByTestId('data-date-row')
  const n = await rows.count()
  check(n === Object.keys(dates).length, `每份数据一行（${n} / ${Object.keys(dates).length}）`)
  for (let i = 0; i < n; i++) {
    const row = rows.nth(i)
    const key = await row.getAttribute('data-key')
    const date = (await row.getByTestId('data-date-value').innerText()).trim()
    check(date === dates[key], `${key}：显示 ${date}，产物里是 ${dates[key]}`)
  }
  const tagsRow = card.locator('[data-key="tags"]')
  check((await tagsRow.innerText()).includes('Danbooru'), 'tag 名单那行写着来源 Danbooru')
}

await page.getByTestId('page-discover').click()
await page.getByTestId('discover-to-settings').click()
await page.getByTestId('app-settings').waitFor()
check((await page.getByTestId('app-settings').getAttribute('data-page')) === 'content', '发现页「在设置中修改」→「内容」页')
const jt = page.locator('[data-jump-target]')
check((await jt.getByTestId('set-nsfw').count()) === 1 && (await jt.evaluate((el) => el.getAnimations().length)) === 1, 'NSFW 那一行闪一下')
await page.waitForTimeout(300)
await jt.screenshot({ path: `${out}/${prefix}-zoom-flash-${suffix}.png` })
const bg = await jt.evaluate((el) => getComputedStyle(el).backgroundColor)
check(bg !== 'rgba(0, 0, 0, 0)', `闪的时候有灯黄浅底（${bg}）`)
await page.waitForTimeout(1500)
check((await jt.evaluate((el) => getComputedStyle(el).backgroundColor)) === 'rgba(0, 0, 0, 0)', '1.6s 后淡掉')
await page.getByTestId('settings-nav-defaults').click()
await page.waitForTimeout(250)

const defs = page.getByTestId('doc-defaults')
const prefsDefaults = () => page.evaluate(async () => JSON.parse((await window.__peImport('/src/store/storage.ts')).safeStorage.getItem('pe:prefs')).state.docDefaults)
const activeSettings = () => page.evaluate(async () => {
  const { useTabs, getDocStore } = await window.__peImport('/src/store/tabs.ts')
  return getDocStore(useTabs.getState().activeId).getState().doc.settings
})
const pick = async (scope, trigger, name) => {
  await scope.getByTestId(trigger).click()
  await page.getByRole('option', { name, exact: true }).click()
  await page.waitForTimeout(150)
}
const toPage = async (id) => {
  await page.getByTestId(id).click()
  await page.waitForTimeout(300)
}
check((await defs.count()) === 1, '设置页有「新文档的默认设置」')
const secs = await defs.getByTestId('doc-defaults-cards').locator('section').evaluateAll((els) =>
  els.map((el) => ({ title: el.querySelector('h2')?.textContent, border: getComputedStyle(el).borderTopWidth, box: getComputedStyle(el.lastElementChild).borderTopWidth })),
)
check(secs.map((x) => x.title).join(' ') === '模型 Prompt 预设 图像' && secs.every((x) => x.border === '0px' && x.box === '1px'), `「新文档」三节描边框（${JSON.stringify(secs)}）`)
check((await defs.getByTestId('settings-preset').locator('header').innerText()).includes('生成时由 NAI 添加至 prompt'), 'Prompt 预设的灰字在节标题后面')
check(await defs.getByTestId('doc-defaults-reset').isDisabled(), '没改过时「恢复 V5 默认」置灰')
check((await defs.getByTestId('set-seed').count()) === 0, '默认设置里没有 Seed')
check((await defs.getByTestId('settings-position').count()) === 0 && (await defs.getByTestId('set-coords').count()) === 0, '默认设置里没有角色位置')
check((await prefsDefaults()) === null, '没改过时偏好里是 null')

await pick(defs, 'set-model', 'V5 Curated')
await pick(defs, 'uc-preset', 'Light')
await pick(defs, 'quality-preset', 'None')
await pick(defs, 'set-size', 'Normal')
await defs.getByTestId('set-shape-Square').click()
const steps = defs.getByTestId('set-steps').locator('input')
await steps.fill('28')
await steps.press('Enter')
await pick(defs, 'set-sampler', 'DPM++ 2M')
await page.waitForTimeout(250)
const d1 = await prefsDefaults()
const want = { model: 'v5-curated', ucPreset: 'light', qualityTags: 'none', useCoords: false, width: 1024, height: 1024, steps: 28, sampler: 'k_dpmpp_2m' }
const flat = (s) => ({ model: s?.model, ucPreset: s?.ucPreset, qualityTags: s?.qualityTags, useCoords: s?.useCoords, width: s?.gen.width, height: s?.gen.height, steps: s?.gen.steps, sampler: s?.gen.sampler })
check(JSON.stringify(flat(d1)) === JSON.stringify(want), `偏好里存了改过的默认（${JSON.stringify(flat(d1))}）`)
await page.reload()
await page.getByTestId('settings-nav-defaults').click()
await page.getByTestId('doc-defaults').waitFor()
check(JSON.stringify(flat(await prefsDefaults())) === JSON.stringify(want), '刷新后新文档默认设置仍在')
check(d1?.gen.seed === null, '默认里 seed 是随机')
check(!(await defs.getByTestId('doc-defaults-reset').isDisabled()), '改过以后「恢复 V5 默认」能点')
await pick(defs, 'set-model', 'V5 Full')
await defs.getByTestId('set-effort').getByText('Medium', { exact: true }).click()
await page.waitForTimeout(250)
check((await defs.getByTestId('medium-hint').count()) === 1 && (await steps.isDisabled()), 'Effort Medium：显示锁定说明、步数置灰')
await defs.getByTestId('set-effort').getByText('High', { exact: true }).click()
await pick(defs, 'set-model', 'V5 Curated')
await page.mouse.move(2, 2)
await defs.screenshot({ path: `${out}/${prefix}-zoom-defaults-${suffix}.png` })

await toPage('page-editor')
check((await activeSettings()).model === 'v5-full', '已经开着的文档照旧（V5 Full）')
for (const what of ['空白', '单人']) {
  await page.getByTestId('new-tab').click()
  await page.getByTestId('start-new').click()
  await page.getByTestId('start-preset').filter({ hasText: what }).click()
  await page.getByTestId('export-panel').waitFor()
  const s = await activeSettings()
  check(JSON.stringify(flat(s)) === JSON.stringify(want) && s.gen.seed === null, `新建「${what}」用默认设置（${JSON.stringify(flat(s))}）`)
}
await openParams(page)
await page.waitForTimeout(250)
check((await page.getByTestId('export-panel').getByTestId('set-model').innerText()).includes('V5 Curated'), '参数面板显示 V5 Curated')
await page.getByTestId('export-panel').getByTestId('settings-page').screenshot({ path: `${out}/${prefix}-zoom-newdoc-panel-${suffix}.png` })
check((await page.getByTestId('export-panel').getByTestId('settings-model').evaluate((el) => getComputedStyle(el).borderTopWidth)) === '1px', '参数面板照旧是卡片')
await toPage('page-gacha')
await page.getByTestId('gacha-roll').first().click()
await page.getByTestId('gacha-open').click()
await page.getByTestId('export-panel').waitFor()
check(JSON.stringify(flat(await activeSettings())) === JSON.stringify(want), '抽卡「在新 tab 中打开」用默认设置')

await toPage('rail-settings')
await toPage('settings-nav-defaults')
await defs.getByTestId('doc-defaults-reset').click()
await page.waitForTimeout(250)
check((await prefsDefaults()) === null, '「恢复 V5 默认」以后偏好里是 null')
check((await defs.getByTestId('set-model').innerText()).includes('V5 Full'), '卡上回到 V5 Full')
check((await defs.getByTestId('set-size').innerText()).includes('Normal') && (await defs.getByTestId('set-shape-Portrait').getAttribute('data-state')) === 'active' && (await steps.inputValue()) === '23', '恢复 V5 默认：Normal Portrait、23 步')
check(await defs.getByTestId('doc-defaults-reset').isDisabled(), '恢复以后按钮置灰')
const toast = page.locator('[data-sonner-toast]').filter({ hasText: '已恢复 V5 默认' })
check((await toast.count()) === 1, '出 toast「已恢复 V5 默认」')
await toast.getByRole('button', { name: '撤销' }).click()
await page.waitForTimeout(250)
check(JSON.stringify(flat(await prefsDefaults())) === JSON.stringify(want), 'toast 撤销：默认设置回来了')
await defs.getByTestId('doc-defaults-reset').click()
await toPage('page-editor')
await page.getByTestId('new-tab').click()
await page.getByTestId('start-new').click()
await page.getByTestId('start-preset').filter({ hasText: '基础' }).click()
await page.getByTestId('export-panel').waitFor()
check((await activeSettings()).model === 'v5-full', '恢复以后新建的是 V5 默认')

check(errors.length === 0, `控制台没报错${errors.length ? '：' + errors.join(' | ') : ''}`)
await browser.close()
console.log(fails.length ? `\n${fails.length} 条失败` : '\n全部通过')
process.exit(fails.length ? 1 : 0)
