import { chromium } from '@playwright/test'
import { toTab } from './right-panel.mjs'
import { mkdirSync } from 'node:fs'
import { E2E_URL, isolate, resetStore } from './store.mjs'

const theme = process.argv[2] ?? 'light'
const prefix = process.argv[3] ?? 'ai-nsfw'
const width = Number(process.argv[4] ?? 1440)
const out = 'e2e/shots'
mkdirSync(out, { recursive: true })

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width, height: 900 }, deviceScaleFactor: 2 })
await isolate(ctx)
await ctx.grantPermissions(['clipboard-read', 'clipboard-write'])
const page = await ctx.newPage()
const errors = []
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
page.on('pageerror', (e) => errors.push(String(e)))
const url = E2E_URL
const open = async (nsfw) => {
  await page.goto(url)
  await resetStore(page, { kv: { 'pe:prefs': { state: { theme, nsfw }, version: 0 } } })
  await page.reload()
  await page.waitForLoadState('networkidle')
  await page.waitForTimeout(300)
}

const fails = []
const check = (ok, msg) => (ok ? console.log('ok  ', msg) : (fails.push(msg), console.log('FAIL', msg)))
const openAiMore = async () => {
  if (!(await page.getByTestId('ai-chat').isVisible())) {
    await page.getByTestId('rail-ai').click()
    await page.getByTestId('ai-chat').waitFor()
  }
  await page.getByTestId('ai-chat-more').click()
}
const name = (n) => `${out}/${prefix}-${n}-${theme}${width === 1440 ? '' : `-${width}`}.png`
const shot = async (loc, n, pad = 12) => {
  const b = await loc.boundingBox()
  await page.screenshot({ path: name(n), clip: { x: Math.max(0, b.x - pad), y: Math.max(0, b.y - pad), width: b.width + pad * 2, height: b.height + pad * 2 } })
  console.log('shot', name(n))
}
const paste = (text) =>
  page.locator('body').evaluate((el, t) => {
    const dt = new DataTransfer()
    dt.setData('text/plain', t)
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }))
  }, text)
const copyToAi = async () => {
  await openAiMore()
  await page.getByTestId('ai-menu-copy').click()
  await page.waitForTimeout(200)
  const text = await page.evaluate(() => navigator.clipboard.readText())
  return { text, doc: JSON.parse([...text.matchAll(/```json\r?\n([\s\S]*?)```/g)][1][1]) }
}
const answer = (o) => `改好了：\n\n\`\`\`json\n${JSON.stringify({ $schema: 'pe-doc-ai/1', ...o }, null, 2)}\n\`\`\`\n`
const dlg = page.getByTestId('ai-import')
const hideToasts = () => page.addStyleTag({ content: '[data-sonner-toaster] { visibility: hidden !important }' })

await open('r18')
{
  const { text, doc } = await copyToAi()
  check(doc.settings.nsfw === false, '开着：文档的 settings 里有 nsfw: false')
  check(text.includes('"nsfw":{') && text.includes('true = nsfw is added at the start of the prompt'), 'Schema 里有 nsfw')
  check(text.includes('uc start: nsfw, lowres') && text.includes('not when settings.nsfw is true'), '规则：负面开头写上 NAI 会加的 nsfw')
}
await page.mouse.click(width / 2, 140)
await paste(answer({ settings: { nsfw: true } }))
await dlg.waitFor()
await page.waitForTimeout(400)
const row = dlg.getByTestId('ai-change')
check((await row.count()) === 1, '预览：1 处改动')
check(/^NSFW\s*关 → 开$/.test((await row.first().textContent()).trim()), '那一行写「NSFW　关 → 开」')
check((await dlg.getByTestId('ai-import-summary').textContent()).includes('参数 1 项'), '底部「将修改：参数 1 项」')
await page.mouse.move(2, 890)
const hidden = await hideToasts()
await shot(dlg, 'dialog', 10)
await shot(row.first(), 'row', 8)
await hidden.evaluate((el) => el.remove())
await page.getByTestId('ai-import-apply').click()
await dlg.waitFor({ state: 'hidden' })
await toTab(page, 'copy')
check((await page.getByTestId('export-base.prompt').getByTestId('export-nsfw').count()) === 1, '应用后导出栏正面开头有 nsfw')
check(/^lowres/.test(await page.getByTestId('export-base.uc').getByTestId('export-text').textContent()), '负面开头不再有 nsfw')
{
  const { text, doc } = await copyToAi()
  check(doc.settings.nsfw === true, '再复制：settings.nsfw 是 true')
  check(text.includes('prompt start: nsfw (nsfw true)') && !text.includes('uc start: nsfw,'), '规则：正面开头 nsfw，负面不写 nsfw')
}

await open('off')
{
  const { text, doc } = await copyToAi()
  check(!('nsfw' in doc.settings), '关着：文档的 settings 里没有 nsfw')
  check(!text.includes('uc start: nsfw,'), '关着：规则里不提 NAI 往负面加的 nsfw')
}
await page.mouse.click(width / 2, 140)
await paste(answer({ settings: { nsfw: true } }))
await dlg.waitFor()
await page.waitForTimeout(400)
check((await dlg.getByTestId('ai-change').count()) === 0, '关着：AI 改了 nsfw 也不列成改动')
check((await dlg.getByTestId('ai-import-overview').textContent()).includes('NSFW 关 → 开：设置中未开启「显示 NSFW 内容」，未修改'), '总结里写了未修改的 NSFW')
await page.mouse.move(2, 890)
const hidden2 = await hideToasts()
await shot(dlg.getByTestId('ai-import-overview'), 'skipped', 8)
await hidden2.evaluate((el) => el.remove())
await page.keyboard.press('Escape')

check(errors.length === 0, `console 无报错${errors.length ? `：${errors.join(' | ')}` : ''}`)
await browser.close()
if (fails.length) {
  console.log(`\n${fails.length} 处没过`)
  process.exit(1)
}
console.log('\n全过')
