import { chromium } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { E2E_URL, isolate, resetStore } from './store.mjs'

const theme = process.argv[2] ?? 'light'
const prefix = process.argv[3] ?? 'renamed'
const width = Number(process.argv[4] ?? 1440)
const before = process.argv[5] === 'before'
const out = 'e2e/shots'
mkdirSync(out, { recursive: true })
const url = E2E_URL
const suffix = `${theme}${width === 1440 ? '' : `-${width}`}`

const browser = await chromium.launch()
const context = await browser.newContext({ viewport: { width, height: width < 1200 ? 800 : 900 }, deviceScaleFactor: 2 })
await isolate(context)
const page = await context.newPage()
const errors = []
page.on('console', (m) => m.type() === 'error' && !m.text().includes('404') && errors.push(m.text()))
page.on('pageerror', (e) => errors.push(String(e)))
// Cloudflare challenges headless browsers, so mock wiki responses and use the bundled Chinese definitions.
await context.route('https://danbooru.donmai.us/**', (r) => r.fulfill({ status: 404, body: '{}' }))

await page.goto(url)
await resetStore(page, { theme })
await page.reload()
await page.getByTestId('chip').first().waitFor()
await page.waitForLoadState('networkidle')

const fails = []
const check = (ok, msg) => (ok ? console.log('ok  ', msg) : (fails.push(msg), console.log('FAIL', msg)))
const chip = (text) => page.getByTestId('chip').filter({ has: page.locator('.chip-text').getByText(text, { exact: true }) }).first()
const section = (name) => page.getByTestId('section').filter({ has: page.getByTestId('section-name').getByText(name, { exact: true }) }).first()
const inspector = page.getByTestId('inspector-panel')
const hint = inspector.getByTestId('alias-hint')
const away = () => page.mouse.move(width - 5, 300)
async function select(text) {
  for (let i = 0; i < 3; i++) await page.keyboard.press('Escape')
  await chip(text).scrollIntoViewIfNeeded()
  await chip(text).click()
  await inspector.getByTestId('inspector-literal').filter({ hasText: text }).waitFor()
}
async function addTag(sec, text) {
  for (let i = 0; i < 3; i++) await page.keyboard.press('Escape')
  const input = section(sec).getByTestId('tag-input')
  await input.click()
  await input.fill(text)
  await input.press('Shift+Enter')
  await page.keyboard.press('Escape')
  await chip(text).waitFor()
}
async function panelShot(name) {
  await away()
  await page.waitForTimeout(400)
  const p = await inspector.boundingBox()
  const r = await inspector.getByTestId('replace-input').boundingBox()
  const file = `${out}/${prefix}-${name}-zoom-${suffix}.png`
  await page.screenshot({ path: file, clip: { x: p.x, y: p.y, width: p.width, height: r.y + r.height + 56 - p.y } })
  console.log('shot', file)
}
async function fullShot(name) {
  await away()
  await page.waitForTimeout(400)
  const file = `${out}/${prefix}-${name}-${suffix}.png`
  await page.screenshot({ path: file })
  console.log('shot', file)
}
const hintState = () =>
  page.evaluate(() => {
    const h = document.querySelector('[data-testid=inspector-panel] [data-testid=alias-hint]')
    const w = h?.closest('.swap-hint')
    if (!h) return { h: -1, o: 0 }
    const box = (w ?? h).getBoundingClientRect()
    return { h: Math.round(box.height), o: Number(getComputedStyle(w ?? h).opacity) }
  })
const visibleHint = async () => {
  const s = await hintState()
  return s.h > 10 && s.o > 0.9
}

await chip('hair blowing').scrollIntoViewIfNeeded()
if (!before) {
  check((await chip('hair blowing').getAttribute('data-alias')) === null, 'hair blowing 的 chip 没有 data-alias')
  check((await chip('hair blowing').locator('.chip-alias').getAttribute('data-on')) === null, 'hair blowing 前面没有 ⇄')
  check((await chip('smiling').locator('.chip-alias').getAttribute('data-on')) === '', '别名 smiling 前面照旧有 ⇄')
}

if (!before) {
  const fr = await page.evaluate(
    () =>
      new Promise((resolve) => {
        const el = [...document.querySelectorAll('[data-testid=chip]')].find((e) => e.querySelector('.chip-text')?.textContent === 'hair blowing')
        el.click()
        const out = []
        const t0 = performance.now()
        const tick = () => {
          const w = document.querySelector('[data-testid=inspector-panel] .swap-hint')
          out.push(w ? [Math.round(w.getBoundingClientRect().height), +Number(getComputedStyle(w).opacity).toFixed(2)] : [-1, 0])
          if (performance.now() - t0 < 700) requestAnimationFrame(tick)
          else resolve(out)
        }
        requestAnimationFrame(tick)
      }),
  )
  check(fr[0][1] < 0.05 && fr.at(-1)[1] > 0.95 && fr.some(([h, o]) => h > 0 && o > 0.05 && o < 0.95), `对照表晚到：展开 + 淡入有过渡帧（${fr.map(([h, o]) => `${h}/${o}`).join(' ')}）`)
}
await select('hair blowing')
await page.waitForTimeout(700)
await panelShot('1-hair-blowing')
await fullShot('1-hair-blowing')
if (!before) {
  check(await visibleHint(), 'hair blowing：tag 面板有这一行')
  check((await hint.innerText()).includes('正式写法 floating hair'), `写的是正式写法 floating hair（${(await hint.innerText()).replace(/\s+/g, ' ')}）`)
  check((await inspector.getByTestId('inspector-source').innerText()) === '官方', 'tag 面板来源照旧「官方」')
  check((await page.locator('[data-testid=recs-swap][data-on]').count()) === 0, '推荐区最上面不出「hair blowing 的正式写法」')
  await page.getByTestId('cleanup-button').click()
  await page.getByTestId('cleanup-menu').waitFor()
  const cleanup = await page.getByTestId('fix-aliases').innerText().catch(() => '')
  const cb = await page.getByTestId('cleanup-button').boundingBox()
  await page.mouse.click(cb.x + cb.width / 2, cb.y + cb.height / 2)
  await page.getByTestId('cleanup-menu').waitFor({ state: 'detached' })
  check(/2\s*$/.test(cleanup.trim()), `「别名替换为正式写法」照旧 2 个（${cleanup.replace(/\s+/g, ' ')}）`)

  const frames = page.evaluate(
    () =>
      new Promise((resolve) => {
        const out = []
        const t0 = performance.now()
        const tick = () => {
          const w = document.querySelector('[data-testid=inspector-panel] .swap-hint')
          out.push(w ? [Math.round(w.getBoundingClientRect().height), +Number(getComputedStyle(w).opacity).toFixed(2)] : [-1, 0])
          if (performance.now() - t0 < 500) requestAnimationFrame(tick)
          else resolve(out)
        }
        requestAnimationFrame(tick)
      }),
  )
  await hint.getByTestId('alias-replace').click()
  const fr = await frames
  check(await chip('floating hair').isVisible(), '换成了 floating hair')
  check(fr.some(([h, o]) => h > 0 && o > 0.05 && o < 0.95), `收起有过渡帧（${fr.map(([h, o]) => `${h}/${o}`).join(' ')}）`)
  check(!(await visibleHint()), '换完这一行收起了')
  await page.keyboard.press('Escape')
  await page.keyboard.press('Control+z')
  await chip('hair blowing').waitFor()
  check(true, 'Ctrl+Z 撤回成 hair blowing')
}

await addTag('外观', 'twintail')
await select('twintail')
await page.waitForTimeout(500)
if (!before) check(await visibleHint() && (await hint.innerText()).includes('twintails'), 'twintail：正式写法 twintails')
await addTag('外观', 'ear biting')
await select('ear biting')
await page.waitForTimeout(500)
await panelShot('2-ear-biting')
if (!before) check(!(await visibleHint()), 'ear biting：旧写法在 NAI 里更常见，不给这一行')
await select('smiling')
await page.waitForTimeout(500)
await panelShot('3-smiling')
if (!before) check(await visibleHint() && (await hint.innerText()).includes('正式写法 smile'), '别名 smiling 照旧有这一行')

if (!before) {
  await select('twintail')
  await inspector.getByTestId('weight-preset').filter({ hasText: /^1\.2$/ }).click()
  await page.waitForTimeout(200)
  await hint.getByTestId('alias-replace').click()
  await chip('twintails').nth(0).waitFor()
  const w = await page.getByTestId('chip').filter({ has: page.locator('.chip-text').getByText('twintails', { exact: true }) }).locator('[data-testid=chip-weight]').allInnerTexts()
  check(w.includes('1.2'), `twintail 1.2 换完是 twintails 1.2（${w.join(', ')}）`)
}

check(!errors.length, `没有控制台报错${errors.length ? '：' + errors.join(' | ') : ''}`)
await browser.close()
if (fails.length) {
  console.log(`\n${fails.length} 项失败`)
  process.exit(1)
}
console.log('\n全部通过')
