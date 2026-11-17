// Cloudflare challenges headless browsers, so mock Danbooru wiki responses instead of relying on live requests.
import { chromium } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { E2E_URL, isolate, resetStore } from './store.mjs'
import { routeDanbooru } from './danbooru-mock.mjs'

const theme = process.argv[2] ?? 'light'
const prefix = process.argv[3] ?? 'gloss'
const width = Number(process.argv[4] ?? 1440)
const out = 'e2e/shots'
mkdirSync(out, { recursive: true })
const url = E2E_URL
const suffix = `${theme}${width === 1440 ? '' : `-${width}`}`

const WIKI = {
  cherry_blossoms:
    'Small flowers of the [[cherry tree]] (sakura). Usually pink and often seen falling/scattered as [[petals]].\r\n\r\nIn anime, they symbolize spring, the fleeting nature of life, youth, affectionate or gentle characters.\r\n\r\nNot to be confused with [[plum blossoms]]. Cherry blossoms have a slit/cleft at the tip, plum blossoms have round tips.\r\n\r\nh4. See also',
  frieren: 'Frieren is the main character of [[Sousou no Frieren]]. She is an [[elf]] mage who was part of the hero party.',
}

const browser = await chromium.launch()
const context = await browser.newContext({ viewport: { width, height: width < 1200 ? 800 : 900 }, deviceScaleFactor: 2 })
await isolate(context)
const page = await context.newPage()
const errors = []
page.on('console', (m) => m.type() === 'error' && !m.text().includes('404') && errors.push(m.text()))
page.on('pageerror', (e) => errors.push(String(e)))
const wikiReqs = []
await routeDanbooru(page)
await page.route('https://danbooru.donmai.us/wiki_pages/**', (r) => {
  const name = decodeURIComponent(new URL(r.request().url()).pathname.split('/').pop().replace(/\.json$/, ''))
  wikiReqs.push(name)
  const body = WIKI[name]
  return body ? r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ title: name, body, is_deleted: false }) }) : r.fulfill({ status: 404, body: '{}' })
})
// Vite's ?url and ?import requests only export URLs; count the separate asset fetch to measure actual loading.
const files = []
page.on('request', (r) => {
  const u = r.url()
  if (/\/(wiki|tree)\.json\.gz/.test(u) && !u.includes('?')) files.push(u.includes('/wiki.') ? 'wiki' : 'tree')
})

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
const gloss = inspector.getByTestId('gloss')
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
async function shot(name) {
  await away()
  await page.waitForTimeout(350)
  const a = await page.getByTestId('assistant').boundingBox()
  const file = `${out}/${prefix}-${name}-${suffix}.png`
  await page.screenshot({ path: file, clip: { x: 0, y: 0, width: a.x + a.width + 300, height: a.height } })
  console.log('shot', file)
}
async function pickLang(v) {
  await page.getByTestId('chip-lang').click()
  await page.getByTestId(`chip-lang-${v}`).click()
  await page.locator('[data-slot=dropdown-menu-content]').waitFor({ state: 'detached' })
}
const visibleText = (loc) => loc.evaluate((el) => el.innerText.replace(/\s+/g, ' ').trim())

check(!files.length, `首屏不取 wiki.json.gz / tree.json.gz（取了：${files.join(', ') || '无'}）`)

const recordFrames = () =>
  page.evaluate(
    () =>
      new Promise((resolve) => {
        const hs = []
        const t0 = performance.now()
        const tick = () => {
          const g = document.querySelector('[data-testid=inspector-panel] [data-testid=gloss]')
          const box = g?.parentElement?.parentElement?.parentElement
          hs.push(box ? Math.round(box.getBoundingClientRect().height) : document.querySelector('[data-testid=inspector-panel]') ? 0 : -1)
          if (performance.now() - t0 < 700) requestAnimationFrame(tick)
          else resolve(hs.filter((h) => h >= 0))
        }
        requestAnimationFrame(tick)
      }),
  )
const chipEl = (text) => `[...document.querySelectorAll('[data-testid=chip]')].find((e) => e.querySelector('.chip-text')?.textContent === ${JSON.stringify(text)})`

{
  const frames = recordFrames()
  await page.evaluate(`${chipEl('cherry blossoms')}.click()`)
  const hs = await frames
  const final = hs.at(-1)
  const mids = hs.filter((h) => h > 0 && h < final)
  check(final > 40 && hs[0] === 0 && mids.length >= 2, `没悬停就选中：释义块从 0 展开到 ${final}px，中间 ${mids.length} 帧（${[...new Set(hs)].join(' → ')}）`)
  check(files.filter((f) => f === 'wiki').length === 1, '选中时取了 wiki.json.gz（一次）')
}

files.length = 0
await page.reload()
await page.getByTestId('chip').first().waitFor()
await page.waitForLoadState('networkidle')
check(!files.length, '刷新后首屏同样不取')
const packDone = page.waitForResponse((r) => /\/wiki\.json\.gz/.test(r.url()) && !r.url().includes('?'))
await chip('cherry blossoms').hover()
await packDone
check(files.filter((f) => f === 'wiki').length === 1, '鼠标移到 chip 上（还没点）就取了 wiki.json.gz')
await page.waitForTimeout(100)
{
  const frames = recordFrames()
  await chip('cherry blossoms').click()
  const hs = await frames
  check(hs[0] > 40 && hs.every((h) => h === hs[0]), `悬停过再点：释义和面板同一帧出来、不展开（${[...new Set(hs)].join(' → ')}）`)
}
check(!files.includes('tree'), '普通 tag 不取 tree.json.gz')
await gloss.waitFor()
check((await visibleText(gloss.getByTestId('gloss-zh'))).startsWith('樱花，粉色小花'), 'cherry blossoms 的中文释义')
const yMeta = (await inspector.getByTestId('inspector-source').boundingBox()).y
const yGloss = (await gloss.boundingBox()).y
const yWeight = (await inspector.getByTestId('inspector-weight').boundingBox()).y
check(yMeta < yGloss && yGloss < yWeight, '释义在头部（类别）下面、权重上面')
check((await inspector.getByTestId('gloss-wiki').count()) === 0 && !wikiReqs.length, '英文原文折着，没去取')
await shot('1-gloss')

await inspector.getByTestId('gloss-en-toggle').click()
await inspector.locator('[data-testid=gloss-wiki][data-state=ok]').waitFor()
check(wikiReqs.length === 1 && wikiReqs[0] === 'cherry_blossoms', `点开才取英文（${wikiReqs.join(', ')}）`)
check((await visibleText(inspector.getByTestId('gloss-wiki'))).includes('Not to be confused with plum blossoms'), '英文原文 3 段（小标题前）')
await shot('2-en-open')
await select('petals')
check((await inspector.getByTestId('gloss-wiki').count()) === 0, '换一个 tag：英文又折着')
const t1 = Date.now()
await select('cherry blossoms')
check(Date.now() - t1 < 2000 && (await gloss.count()) === 1, '第二次选中：释义马上就在')
await inspector.getByTestId('gloss-en-toggle').click()
await inspector.locator('[data-testid=gloss-wiki][data-state=ok]').waitFor()
check(wikiReqs.length === 1, '再点开英文不再请求')

const tagText = () => visibleText(gloss.locator('.gloss-tag').first()).then((t) => t.replace(/\s/g, ''))
check((await tagText()) === 'plumblossoms梅花', `英文在前：plum blossoms 梅花（${await tagText()}）`)
await pickLang('zh-en')
check((await tagText()) === '梅花plumblossoms', `中文在前：梅花 plum blossoms（${await tagText()}）`)
await shot('3-lang-zh-en')
await pickLang('zh')
check((await tagText()) === '梅花', `只中文：梅花（${await tagText()}）`)
await pickLang('en')
check((await tagText()) === 'plumblossoms', `只英文：plum blossoms（${await tagText()}）`)
await pickLang('en-zh')

await select('smiling')
check((await gloss.locator('xpath=..').getAttribute('data-name')) === 'smile' && (await visibleText(gloss)).includes('嘴角上扬'), '别名 smiling 用 smile 的释义')
await select('white capelet')
check((await visibleText(gloss.locator('[data-compound]'))).startsWith('white + capelet') && (await visibleText(gloss)).includes('小披肩'), '组合词 white capelet：white + capelet + capelet 的释义')
await shot('4-compound')
await addTag('场景', 'twintail')
await select('twintail')
await gloss.waitFor()
check((await gloss.locator('xpath=..').getAttribute('data-name')) === 'twintails' && (await visibleText(gloss)).includes('头发全部扎成左右两束'), '改了名的旧写法 twintail 用 twintails 的释义')
check(files.includes('tree'), '移到 / 选中改了名的旧写法时才取 tree.json.gz')
await select('hair blowing')
check((await gloss.locator('xpath=..').getAttribute('data-name')) === 'floating hair', '示例文档里的 hair blowing 也是改了名的旧写法：用 floating hair 的释义')
await select('masterpiece')
check((await gloss.count()) === 1 && (await gloss.getAttribute('data-has-zh')) !== null, 'NAI 标了但有中文释义的（masterpiece）照常显示')

await select('frieren')
await gloss.waitFor()
check((await gloss.getAttribute('data-has-zh')) === null && (await gloss.getByTestId('gloss-en-toggle').count()) === 1, '角色 frieren：只有「英文原文」一行')
await shot('5-no-zh')
await gloss.getByTestId('gloss-en-toggle').click()
await inspector.locator('[data-testid=gloss-wiki][data-state=ok]').waitFor()
check(wikiReqs.includes('frieren'), '点开取 frieren 的 wiki')
await select('extra digits')
check((await gloss.count()) === 1 && (await gloss.getAttribute('data-has-zh')) === null, '通用 extra digits（作品数 544，没中文释义）：只有「英文原文」一行')
await gloss.getByTestId('gloss-en-toggle').click()
await inspector.locator('[data-testid=gloss-wiki][data-state=missing]').waitFor()
check(true, 'Danbooru 上没有 wiki 的：写「没有 wiki 说明」')

for (const t of ['very aesthetic', 'missing fingers', '2024', 'mika pikazo']) {
  await select(t)
  await page.waitForTimeout(150)
  check((await gloss.count()) === 0, `${t}：没有释义块`)
}
await select('very aesthetic')
await shot('6-none-nai')

await addTag('场景', 'object on head')
await select('object on head')
const p = gloss.getByTestId('gloss-zh')
check(await p.evaluate((el) => el.scrollHeight <= el.clientHeight + 1 && el.getBoundingClientRect().height > 80), '长释义（object on head）全部显示、折行')
await shot('7-long')

await select('cherry blossoms')
await inspector.getByTestId('weight-preset').filter({ hasText: '1.5' }).click()
check((await inspector.getByTestId('inspector-weight-input').inputValue()) === '1.50', '释义下面的权重照常能改')

console.log(errors.length ? `console 报错：\n${errors.join('\n')}` : '  ✓ 控制台没有报错')
if (errors.length) fails.push('console')
console.log(fails.length ? `\n${fails.length} 项没过` : '\n全过')
await browser.close()
process.exit(fails.length ? 1 : 0)
