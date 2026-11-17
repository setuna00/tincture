import { chromium } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { E2E_URL, isolate, resetStore } from './store.mjs'

const theme = process.argv[2] ?? 'light'
const prefix = process.argv[3] ?? 'ailong'
const width = Number(process.argv[4] ?? 1440)
const height = Number(process.argv[5] ?? 900)
const out = 'e2e/shots'
mkdirSync(out, { recursive: true })

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2 })
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
const name = (n) => `${out}/${prefix}-${n}-${theme}${width === 1440 && height === 900 ? '' : `-${width}x${height}`}.png`
const paste = (sel, text) =>
  page.locator(sel).first().evaluate((el, t) => {
    const dt = new DataTransfer()
    dt.setData('text/plain', t)
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }))
  }, text)

await openAiMore()
await page.getByTestId('ai-menu-copy').click()
await page.waitForTimeout(200)
const copied = await page.evaluate(() => navigator.clipboard.readText())
const docJson = JSON.parse([...copied.matchAll(/```json\r?\n([\s\S]*?)```/g)][1][1])
const sceneId = docJson.prompt.find((s) => s.name === '场景').id

const tags = (stem, n) => Array.from({ length: n }, (_, i) => `${stem} ${String.fromCharCode(97 + (i % 26))}${i}`).join(', ') + ', '
const artists = Array.from({ length: 16 }, (_, i) => `artist:painter${'x'.repeat(i % 5)}${i}`).join(', ') + ', '
const reply = {
  $schema: 'pe-doc-ai/1',
  prompt: [
    { id: sceneId, text: 'outdoors, ' },
    { name: '角色主体', text: 'aria (zenless zone zero), 1girl, solo, ' },
    { name: '视角与构图', text: 'pov, 2::facing viewer::, face to face, 5::from below::, 3::looking at viewer::, 3::head down::, looking down, ' },
    { name: '姿态', text: tags('standing pose', 12) },
    { name: '神态与口型', text: 'open mouth, tongue out, lowered eyelids, cold expression, ' + tags('expression', 8) },
    { name: '场景与妆容', text: 'night, dark ambiance, purple eyeshadow, shiny eyeshadow, runny makeup, ' + tags('makeup detail', 10) },
    { name: '画师混合', text: artists },
    { name: '媒介与画面质感', text: 'ash echoes, blender (medium), game cg, novel illustration, high detail, high complexity, thin lines, ' + tags('texture', 10) },
    { name: '年代标签', text: 'year 2026, year 2024, year 2025, ' },
    { name: '这是一个名字特别特别长的区块用来测试行头会不会把弹窗撑开', text: tags('verylongtagwithoutanyspacesatallsoitcannotwrap', 3) + 'x'.repeat(160) + ', ' },
  ],
  uc: [
    { name: '反向权重与文字排除', text: 'simple illustration, artist collaboration, censored, thick rips, flat color, rips, no text, ' + tags('exclude', 6) },
    { name: '画质与成像瑕疵', text: 'lowres, worst quality, bad quality, blurry, artistic error, scan artifacts, jpeg artifacts, film grain, ' + tags('artifact', 14) },
    { name: '文字与水印', text: 'text, logo, watermark, reference, signature, artist name, subtitles, captions, ' + tags('mark', 5) },
    { name: '版面与构图', text: 'multiple views, negative space, blank page, 4koma, 2koma, duplicate, distorted composition, bad perspective, ' + tags('layout', 6) },
    { name: '身体结构与比例', text: 'mutated, deformed, distorted, disfigured, bad anatomy, bad proportions, distorted body, long neck, ' + tags('body', 8) },
    { name: '手部与手指', text: 'bad hands, malformed hands, extra fingers, fewer digits, fused fingers, ' + tags('hand', 6) },
    { name: '脸部、眼睛与头发', text: 'unnatural hair, bad face, mob face, cloned face, distorted face, ugly, bad eyes, empty eyes, ' + tags('face', 8) },
    { name: '色彩与画风屏蔽', text: 'disorganized colors, unrealistic colors, chibi, ' + artists },
    { name: '其他内容排除', text: 'sweat, character hair ornament, ' },
  ],
  settings: { scale: 12, steps: 99 },
}
const answer = `好的，重写如下：\n\n\`\`\`json\n${JSON.stringify(reply, null, 2)}\n\`\`\`\n`
await page.mouse.click(width / 2, 140)
await paste('body', answer)
const dlg = page.getByTestId('ai-import')
await dlg.waitFor()
await page.waitForTimeout(500)
const hide = await page.addStyleTag({ content: '[data-sonner-toaster] { visibility: hidden !important }' })
await page.mouse.move(2, height - 10)

const n = await dlg.getByTestId('ai-change').count()
check(n === 19, `预览：19 处改动（${n}）`)
const box = await dlg.boundingBox()
check(box.x >= 0 && box.x + box.width <= width + 0.5 && box.y >= 0 && box.y + box.height <= height + 0.5, `弹窗在窗口里（${Math.round(box.x)},${Math.round(box.y)} ${Math.round(box.width)}×${Math.round(box.height)}）`)
const apply = await dlg.getByTestId('ai-import-apply').boundingBox()
check(apply && apply.x + apply.width <= box.x + box.width && apply.y + apply.height <= box.y + box.height, `「应用」在弹窗里（右边 ${Math.round(apply.x + apply.width)} ≤ ${Math.round(box.x + box.width)}）`)
const over = await dlg.evaluate((el) => {
  const r = el.getBoundingClientRect()
  const bad = []
  for (const e of el.querySelectorAll('*')) {
    const b = e.getBoundingClientRect()
    if (b.width && b.right > r.right + 0.5 && !e.closest('[data-slot="scroll-area-scrollbar"]')) bad.push(`${e.tagName.toLowerCase()}.${String(e.className).slice(0, 30)} → ${Math.round(b.right - r.right)}px`)
  }
  return bad.slice(0, 5)
})
check(over.length === 0, `没有内容超出弹窗右边${over.length ? '：' + over.join(' | ') : ''}`)
const ell = await dlg.getByTestId('ai-import-overview').locator('> div.truncate').evaluateAll((els) => els.filter((e) => e.scrollWidth > e.clientWidth + 1).length)
check(ell > 0, `总结里放不下的行有省略号（${ell} 行）`)
await page.screenshot({ path: name('full') })
console.log('shot', name('full'))
await page.screenshot({ path: name('dialog'), clip: { x: box.x - 8, y: box.y - 8, width: Math.min(box.width + 16, width - box.x + 8), height: box.height + 16 } })
console.log('shot', name('dialog'))
await dlg.locator('[data-slot="scroll-area-viewport"]').evaluate((el) => (el.scrollTop = el.scrollHeight))
await page.waitForTimeout(700)
await page.screenshot({ path: name('bottom') })
console.log('shot', name('bottom'))
await dlg.getByTestId('ai-import-apply').click()
await dlg.waitFor({ state: 'detached' }).catch(() => {})
await page.waitForTimeout(300)
check((await page.getByTestId('ai-import').count()) === 0, '点「应用」关掉弹窗')
await hide.evaluate((el) => el.remove())

console.log(errors.length ? `console errors: ${errors.join(' | ')}` : 'console errors: none')
console.log(fails.length ? `FAILED ${fails.length}` : 'all ok')
await browser.close()
process.exit(fails.length || errors.length ? 1 : 0)
