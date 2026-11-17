import { chromium } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { E2E_URL, isolate, resetStore } from './store.mjs'

const theme = process.argv[2] ?? 'light'
const prefix = process.argv[3] ?? 'ai'
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
await page.goto(E2E_URL)
await resetStore(page, { theme })
await page.reload()
await page.waitForLoadState('networkidle')
await page.waitForTimeout(300)

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
const section = (n, nth = 0) => page.getByTestId('section').filter({ has: page.getByTestId('section-name').getByText(n, { exact: true }) }).nth(nth)
const chipTexts = (loc) => loc.getByTestId('chip').evaluateAll((els) => els.map((e) => e.querySelector('.chip-text')?.textContent ?? e.textContent))
const paste = (sel, text) =>
  page.locator(sel).first().evaluate((el, t) => {
    const dt = new DataTransfer()
    dt.setData('text/plain', t)
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }))
  }, text)

await page.mouse.move(2, 890)
const header = page.getByTestId('save-doc').locator('xpath=ancestor::header[1]')
await shot(header, 'header', 8)
await openAiMore()
const menu = page.locator('[data-slot="dropdown-menu-content"]')
await menu.waitFor()
await page.waitForTimeout(250)
{
  const a = await page.getByTestId('ai-chat-more').boundingBox()
  const m = await menu.boundingBox()
  const x = Math.min(a.x, m.x) - 14
  await page.screenshot({ path: name('menu'), clip: { x, y: a.y - 14, width: Math.max(a.x + a.width, m.x + m.width) - x + 14, height: m.y + m.height - a.y + 28 } })
  console.log('shot', name('menu'))
}
await page.keyboard.press('Escape')
await page.waitForTimeout(200)

await page.evaluate(() => navigator.clipboard.writeText('剪贴板里原来的东西'))
await openAiMore()
await menu.waitFor()
check((await page.evaluate(() => navigator.clipboard.readText())) === '剪贴板里原来的东西', '点 ⋯ 只开菜单，不动剪贴板')

await page.getByTestId('ai-menu-copy').click()
await page.waitForTimeout(200)
const copied = await page.evaluate(() => navigator.clipboard.readText())
check(copied.includes('"$schema": "pe-doc-ai/2"') && copied.includes('## Request'), '复制给 AI：剪贴板里有规则、Schema、文档')
check((await page.getByTestId('ai-chat-more').getAttribute('class')).includes('text-lamp-text'), '复制以后 ⋯ 变 ✓')
check(/"color": "teal"/.test(copied), '复制给 AI：区块带颜色')
// Windows clipboard reads use CRLF, so normalize line endings before matching the JSON block.
const docJson = JSON.parse([...copied.matchAll(/```json\r?\n([\s\S]*?)```/g)][1][1])
const sceneId = docJson.prompt.find((s) => s.name === '场景').id
const look = docJson.characters[0].prompt[0]

const reply = {
  $schema: 'pe-doc-ai/2',
  comment: '天空换成黄昏：去掉蓝天和白天，加了夕阳和橙色天空。\n加了屋顶背景，表情加了脸红；「害羞」没有更贴切的 tag，用 embarrassed 代替。',
  prompt: [
    { id: sceneId, color: 'rose', tags: ['outdoors', '1.3::cherry blossoms::', '1.2::petals::', 'depth of field', '0.8::light particles::', 'sunset', 'orange sky'] },
    { name: '背景', after: sceneId, color: 'sky', tags: ['rooftop', 'cityscape', 'railing'] },
  ],
  characters: [{ id: docJson.characters[0].id, prompt: [{ id: look.id, tags: [...look.tags, 'blush', '1.2::embarrassed::'] }] }],
  settings: { width: 1216, height: 832, scale: 12 },
}
const replyV1 = {
  $schema: 'pe-doc-ai/1',
  prompt: reply.prompt.map(({ tags, ...s }) => ({ ...s, text: tags.join(', ') })),
  characters: [{ id: docJson.characters[0].id, prompt: [{ id: look.id, text: [...look.tags, 'blush', '1.2::embarrassed::'].join(', ') }] }],
  settings: reply.settings,
}
const answer = `好的，我把天空换成了黄昏，加了屋顶背景，表情加了脸红：\n\n\`\`\`json\n${JSON.stringify(reply, null, 2)}\n\`\`\`\n`
await page.mouse.click(width / 2, 140)
await paste('body', answer)
const dlg = page.getByTestId('ai-import')
await dlg.waitFor()
await page.waitForTimeout(400)
check((await dlg.getByTestId('ai-change').count()) === 4, '预览：4 处改动')
check((await dlg.getByTestId('ai-import-overview').textContent()).includes('引导 12 超出 NAI 的范围'), '总结里写了未修改的引导')
check((await dlg.getByTestId('ai-change').first().textContent()).includes('颜色 青 → 红'), '行头写「颜色 青 → 红」')
check((await dlg.locator('[data-ai-mark]').count()) === 5, '小点：sunset、orange sky、cherry blossoms、blush、embarrassed')
check((await dlg.getByTestId('ai-import-comment').innerText()).includes('橙色天空。\n加了屋顶背景'), '「AI 的分析」：comment 原文，保留换行')
const sizeRow = dlg.getByTestId('ai-change').filter({ hasText: '尺寸' })
await sizeRow.getByTestId('ai-change-check').click()
await page.waitForTimeout(250)
check((await dlg.getByTestId('ai-import-summary').textContent()).includes('将修改：正面 2 个区块 · 1 个角色'), '底部「将修改」跟着勾走')
await page.mouse.move(2, 890)
const hideToasts = await page.addStyleTag({ content: '[data-sonner-toaster] { visibility: hidden !important }' })
await page.screenshot({ path: name('dialog-full') })
console.log('shot', name('dialog-full'))
await shot(dlg, 'dialog', 10)
await hideToasts.evaluate((el) => el.remove())

const before = await chipTexts(section('场景'))
const ids = () => page.getByTestId('section').evaluateAll((els) => els.map((e) => e.dataset.sectionId))
await dlg.getByTestId('ai-import-apply').dblclick()
await dlg.waitFor({ state: 'detached' }).catch(() => {})
await page.waitForTimeout(400)
const after = await chipTexts(section('场景'))
check(after.some((t) => t.includes('sunset')) && !after.some((t) => t.includes('blue sky')), '应用：场景改了')
check((await section('背景').count()) === 1, '应用：新区块「背景」（连点两下也只有一个）')
check(new Set(await ids()).size === (await ids()).length, '区块 id 没有重复')
check((await section('背景').getAttribute('style'))?.includes('--sh: 235'), '新区块「背景」是 AI 写的蓝色')
check((await section('场景').getAttribute('style'))?.includes('--sh: 12'), '「场景」换成红色')
await shot(section('场景').locator('xpath=..'), 'applied', 8)
const order = await ids()
await section('背景').getByTestId('section-enabled').click()
await page.waitForTimeout(300)
check(JSON.stringify(await ids()) === JSON.stringify(order), '停用「背景」：区块顺序不变')
check((await page.locator('[data-testid=section][data-muted]').count()) === 1 && (await section('背景').getAttribute('data-muted')) === '', '停用「背景」：只有它停用')
await page.keyboard.press('Control+z')
await page.waitForTimeout(200)
const toast = page.locator('[data-sonner-toast]').filter({ hasText: '已应用 AI 的 3 处修改' })
check((await toast.count()) === 1, 'toast「已应用 AI 的 3 处修改」')
await page.mouse.click(width / 2, 140)
await page.keyboard.press('Control+z')
await page.waitForTimeout(300)
check(JSON.stringify(await chipTexts(section('场景'))) === JSON.stringify(before) && (await section('背景').count()) === 0, 'Ctrl+Z 一步回去')

const n0 = await section('主体').getByTestId('chip').count()
await section('主体').getByTestId('tag-input').click()
await paste('[data-testid="tag-input"]:focus', answer)
await dlg.waitFor()
check((await section('主体').getByTestId('chip').count()) === n0, 'tag 输入框里粘回答：没多出 chip')
await page.keyboard.press('Escape')
await page.waitForTimeout(300)

await page.evaluate((t) => navigator.clipboard.writeText(t), answer)
await openAiMore()
await page.getByTestId('ai-menu-paste').click()
await dlg.waitFor()
check((await dlg.getByTestId('ai-change').count()) === 4, '⋯「粘贴」：直接出预览')
await page.keyboard.press('Escape')
await dlg.waitFor({ state: 'detached' })
await page.evaluate(() => navigator.clipboard.writeText('1girl, solo'))
await openAiMore()
await page.getByTestId('ai-menu-paste').click()
await page.getByTestId('ai-paste').waitFor()
await page.waitForTimeout(250)
check((await page.getByTestId('ai-paste-error').textContent()).includes('未找到 AI 的回答'), '剪贴板里不是回答：开粘贴那一步 + 提示')
await page.keyboard.press('Escape')
await page.getByTestId('ai-paste').waitFor({ state: 'detached' })

await openAiMore()
const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByTestId('ai-menu-upload').click()])
await chooser.setFiles({ name: 'reply.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(replyV1)) })
await dlg.waitFor()
check((await dlg.getByTestId('ai-change').count()) === 4, '⋯「从文件导入…」：选了文件出预览（v1 的 text 照旧能读）')
check((await dlg.getByTestId('ai-import-comment').count()) === 0, '没写 comment：没有「AI 的分析」')
await page.keyboard.press('Escape')
await page.waitForTimeout(300)

{
  await page.mouse.click(width / 2, 140)
  await paste('body', '```json\n' + JSON.stringify({ $schema: 'pe-doc-ai/2', comment: '现在的写法已经符合要求，没有需要修改的地方。' }) + '\n```')
  await dlg.waitFor()
  await page.waitForTimeout(400)
  check((await dlg.getByTestId('ai-import-overview').textContent()).includes('AI 未修改任何内容'), '只有分析：总结「AI 未修改任何内容」')
  check(await dlg.getByTestId('ai-import-apply').isDisabled(), '只有分析：应用灰着')
  const hide = await page.addStyleTag({ content: '[data-sonner-toaster] { visibility: hidden !important }' })
  await page.mouse.move(2, 890)
  await shot(dlg, 'comment-only', 10)
  await hide.evaluate((el) => el.remove())
  await page.keyboard.press('Escape')
  await page.waitForTimeout(300)
}

{
  const full = { ...docJson, complete: true, prompt: [docJson.prompt[0], { name: '背景', text: 'rooftop, cityscape, ' }], characters: docJson.characters.filter((c) => c.name !== '菲伦') }
  await page.mouse.click(width / 2, 140)
  await paste('body', '```json\n' + JSON.stringify(full) + '\n```')
  await dlg.waitFor()
  await page.waitForTimeout(400)
  check((await dlg.getByTestId('ai-change').count()) === 5, '完整文档：新区块 1 + 删除区块 3 + 删除角色 1')
  check((await dlg.getByTestId('ai-import-overview').textContent()).includes('删除区块「场景」'), '总结里写「删除区块「场景」」')
  const hide = await page.addStyleTag({ content: '[data-sonner-toaster] { visibility: hidden !important }' })
  await page.mouse.move(2, 890)
  await shot(dlg, 'complete', 10)
  await hide.evaluate((el) => el.remove())
  await page.keyboard.press('Escape')
  await page.waitForTimeout(300)
}

{
  const [p0] = docJson.prompt
  const [u0] = docJson.uc
  const typo = (id) => id.slice(0, -1) + (id.at(-1) === 'x' ? 'y' : 'x')
  const full = {
    ...docJson,
    complete: true,
    prompt: [{ ...p0, id: typo(p0.id), name: '人数构图', tags: [...p0.tags, 'upper body'] }, { id: 's_people0001', name: '光照', tags: ['rim lighting'] }, ...docJson.prompt.slice(1)],
    uc: [{ ...u0, id: u0.id.slice(0, 5) + u0.id.slice(6), tags: [...u0.tags, '3d'] }, ...docJson.uc.slice(1)],
  }
  await page.mouse.click(width / 2, 140)
  await paste('body', '```json\n' + JSON.stringify(full) + '\n```')
  await dlg.waitFor()
  await page.waitForTimeout(400)
  const row = (t) => dlg.getByTestId('ai-change').filter({ hasText: t })
  const on = async (t) => (await row(t).getByTestId('ai-change-check').getAttribute('data-state')) === 'checked'
  check((await row(`删除区块`).count()) === 0, '抄错 id：不出「删除区块」')
  check((await row(`重命名`).count()) === 1 && (await on('人数构图')), '抄错一个字：认成原区块，改名「人数构图」，默认勾')
  check((await row(u0.name).count()) === 1 && (await on(u0.name)), '少抄一个字：认成原区块，默认勾')
  check((await row('光照').count()) === 1 && (await on('光照')), '编的 id：新区块「光照」，别的 id 对得上 → 默认勾')
  const hide = await page.addStyleTag({ content: '[data-sonner-toaster] { visibility: hidden !important }' })
  await page.mouse.move(2, 890)
  await shot(dlg, 'typo-id', 10)
  await hide.evaluate((el) => el.remove())
  await page.keyboard.press('Escape')
  await page.waitForTimeout(300)
}

{
  let i = 0
  const other = (s) => ({ ...s, id: `s_wrongtab${String(i++).padStart(2, '0')}` })
  const full = {
    ...docJson,
    complete: true,
    prompt: docJson.prompt.map(other),
    uc: docJson.uc.map(other),
    characters: docJson.characters.map((c, k) => ({ ...c, id: `ch_wrongtab${k}`, prompt: c.prompt.map(other), uc: c.uc.map(other) })),
    settings: { ...docJson.settings, steps: docJson.settings.steps === 26 ? 27 : 26 },
  }
  await page.mouse.click(width / 2, 140)
  await paste('body', '```json\n' + JSON.stringify(full) + '\n```')
  await dlg.waitFor()
  await page.waitForTimeout(400)
  const states = await dlg.getByTestId('ai-change-check').evaluateAll((els) => els.map((e) => e.dataset.state))
  check(states.length > 0 && states.every((s) => s === 'unchecked'), `贴错 tab：${states.length} 项全都不勾`)
  check((await dlg.innerText()).includes('未勾选任何改动'), '贴错 tab：底部写未勾选任何改动')
  const hide = await page.addStyleTag({ content: '[data-sonner-toaster] { visibility: hidden !important }' })
  await dlg.getByTestId('ai-change').filter({ hasText: '删除区块' }).first().scrollIntoViewIfNeeded()
  await page.mouse.move(2, 890)
  await page.waitForTimeout(250)
  await shot(dlg, 'wrong-tab', 10)
  await hide.evaluate((el) => el.remove())
  await page.keyboard.press('Escape')
  await page.waitForTimeout(300)
}

console.log(errors.length ? `console errors: ${errors.join(' | ')}` : 'console errors: none')
console.log(fails.length ? `FAILED ${fails.length}` : 'all ok')
await browser.close()
process.exit(fails.length || errors.length ? 1 : 0)
