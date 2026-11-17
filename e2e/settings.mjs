import { chromium } from '@playwright/test'
import { openParams, toTab } from './right-panel.mjs'
import { mkdirSync, writeFileSync } from 'node:fs'
import { E2E_URL, isolate, resetStore } from './store.mjs'

const theme = process.argv[2] ?? 'light'
const prefix = process.argv[3] ?? 'set'
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
await page.waitForTimeout(300)

const fails = []
const check = (ok, msg) => (ok ? console.log('ok  ', msg) : (fails.push(msg), console.log('FAIL', msg)))
const suffix = `${theme}${width === 1440 ? '' : `-${width}`}`
const shot = async (name, { mouse = true } = {}) => {
  await page.waitForTimeout(300)
  if (mouse) await page.mouse.move(2, 2)
  await page.waitForTimeout(200)
  const file = `${out}/${prefix}-${name}-${suffix}.png`
  await page.screenshot({ path: file })
  console.log('shot', file)
}
const clip = async (loc, name, pad = 0) => {
  await page.waitForTimeout(250)
  const b = await loc.boundingBox()
  const file = `${out}/${prefix}-${name}-${suffix}.png`
  await page.screenshot({ path: file, clip: { x: Math.max(0, b.x - pad), y: Math.max(0, b.y - pad), width: b.width + pad * 2, height: b.height + pad * 2 } })
  console.log('clip', file)
}
const activeDoc = async () => {
  await page.waitForTimeout(400)
  return page.evaluate(async () => {
    const tabs = JSON.parse((await window.__peImport('/src/store/storage.ts')).safeStorage.getItem('pe:tabs')).state
    return { id: tabs.activeId, count: tabs.order.length, doc: JSON.parse((await window.__peImport('/src/store/storage.ts')).safeStorage.getItem(`pe:doc:${tabs.activeId}`)) }
  })
}
const gen = async () => (await activeDoc()).doc.settings.gen
const pick = async (trigger, name) => {
  await page.getByTestId(trigger).click()
  await page.getByRole('option', { name, exact: true }).click()
  await page.waitForTimeout(150)
}
const undo = async () => {
  const open = (await page.getByTestId('params-panel').count()) > 0
  await page.mouse.click(width / 2, 880) // Inputs retain native undo, so move focus outside them before checking document undo.
  await page.keyboard.press('Control+z')
  if (open) await openParams(page)
}
const panel = page.getByTestId('export-panel')
const shots = true

check((await page.locator('[aria-label=模型]').count()) === 0, '文档工具栏里没有模型 / 质量 / UC 下拉了')
check((await page.getByTestId('export-panel').getAttribute('data-tab')) === 'copy', '没 token：默认提示词复制')
await openParams(page)
await page.getByTestId('settings-page').waitFor()
await page.waitForTimeout(250)
check(await page.getByTestId('export-tab-en').evaluate((e) => {
  const r = e.getBoundingClientRect()
  return !!document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)?.closest('[data-testid=params-panel]')
}), '参数面板盖住 EN / 中文 / JSON')
await shot('1-settings')

if (shots) {
  await pick('set-model', 'V5 Curated')
  check(await page.getByTestId('set-effort-medium').isDisabled(), 'Curated：Effort 置灰')
  await pick('set-model', 'V5 Full')
  await page.getByTestId('set-effort-medium').click()
  await page.waitForTimeout(200)
  check(await page.getByTestId('medium-hint').isVisible(), 'Medium：出现锁定说明')
  check((await page.locator('[data-testid=set-steps] input').inputValue()) === '14', 'Medium：步数显示 14')
  check(await page.locator('[data-testid=set-steps] input').isDisabled(), 'Medium：步数不能改')
  check(await page.getByTestId('set-steps-slider-dec').isDisabled() && await page.getByTestId('set-steps-slider-inc').isDisabled(), 'Medium: both step buttons disabled')
  check(await page.getByTestId('set-sampler').isDisabled(), 'Medium：采样不能改')
  check((await page.getByTestId('uc-preset').innerText()).includes('Heavy') && (await page.getByTestId('uc-preset').isDisabled()), 'Medium：UC 预设锁在 Heavy')
  await clip(panel, '2-medium')
  await page.getByTestId('set-effort-high').click()
  check((await page.locator('[data-testid=set-steps] input').inputValue()) === '23', '切回 High：步数还是 23')

  await page.locator('[data-testid=set-steps] [role=slider]').focus()
  for (let i = 0; i < 5; i++) await page.keyboard.press('ArrowRight')
  check((await gen()).steps === 28, '步数滑杆 → 28')
  await undo()
  check((await gen()).steps === 23, '连续拖滑杆是一步撤销')
  await page.locator('[data-testid=set-scale] input').fill('5.55')
  await page.keyboard.press('Enter')
  check((await gen()).scale === 5.6, '引导输入 5.55 → 5.6')

  const stepsInput = page.locator('[data-testid=set-steps] input')
  await page.getByTestId('set-steps-slider-dec').click()
  check((await gen()).steps === 22, 'Steps minus subtracts 1')
  await page.getByTestId('set-steps-slider-inc').click()
  check((await gen()).steps === 23, 'Steps plus adds 1')
  await page.waitForTimeout(1000)
  for (let i = 0; i < 3; i++) await page.getByTestId('set-steps-slider-inc').click()
  check((await gen()).steps === 26, 'Three clicks add 3')
  await undo()
  check((await gen()).steps === 23, 'Three clicks undo in one step')
  for (const [value, side] of [[1, 'dec'], [50, 'inc']]) {
    await stepsInput.fill(String(value)); await stepsInput.press('Enter')
    check(await page.getByTestId('set-steps-slider-'+side).isDisabled(), 'Steps boundary '+value)
  }
  await stepsInput.fill('23'); await stepsInput.press('Enter')
  await page.getByTestId('set-scale-slider-inc').click()
  check((await gen()).scale === 5.7, 'Guidance plus adds 0.1')
  const scaleInput = page.locator('[data-testid=set-scale] input')
  await scaleInput.fill('12'); await scaleInput.press('Enter')
  check(await page.getByTestId('set-scale-slider-inc').isDisabled(), 'Uncapped guidance disables plus')
  await page.getByTestId('set-scale-slider-dec').click()
  check((await gen()).scale === 11.9, 'Uncapped guidance minus keeps current range')
  await scaleInput.fill('5.6'); await scaleInput.press('Enter')

  const shapeOn = () => page.getByTestId('set-shape').locator('[data-state=active]').getAttribute('data-testid')
  await pick('set-size', 'Large')
  let g = await gen()
  check(g.width === 1024 && g.height === 1536 && (await shapeOn()) === 'set-shape-Portrait', `换档位：Large 里同方向（竖）→ 1024×1536（${g.width}×${g.height}）`)
  await page.getByTestId('set-shape-Landscape').click()
  g = await gen()
  check(g.width === 1536 && g.height === 1024, '点横图 → Large 横 1536×1024')
  check((await page.getByTestId('set-size').innerText()).includes('Large') && (await shapeOn()) === 'set-shape-Landscape', '下拉显示 Large、横那一格按下')
  await pick('set-size', 'Wallpaper')
  check(await page.getByTestId('set-shape-Square').isDisabled(), 'Wallpaper：方图那一格置灰')
  await page.getByTestId('set-shape-Square').locator('..').hover()
  check(await page.waitForFunction(() => [...document.querySelectorAll('[data-slot=tooltip-content]')].some((x) => x.textContent.trim() === 'Wallpaper 无方图'), null, { timeout: 2000 }).then(() => true, () => false), '悬停置灰的方图：「Wallpaper 无方图」')
  await page.mouse.move(2, 300)
  await page.mouse.move(4, 320)
  await pick('set-size', 'Large')
  await page.getByTestId('set-width').fill('1000')
  await page.getByTestId('set-width').press('Enter')
  g = await gen()
  check(g.width === 1024 && g.height === 1024, '宽输入 1000 → 按 64 取整 1024')
  await page.getByTestId('set-height').fill('3000')
  await page.getByTestId('set-height').press('Enter')
  g = await gen()
  check(g.height === 3008 && g.width === 1024 && g.width * g.height <= 3145728, `高 3000 → 3008，总像素没超（${g.width}×${g.height}）`)
  check((await page.getByTestId('set-size').innerText()).includes('自定义') && (await shapeOn()) === 'set-shape-Portrait', '不是预设时下拉写「自定义」，方向照现在的宽高（竖）')
  await page.getByTestId('set-swap').click()
  g = await gen()
  check(g.width === 3008 && g.height === 1024, '宽高对调')
  await page.getByTestId('set-shape-Portrait').click()
  g = await gen()
  check(g.width === 1024 && g.height === 3008, `自定义点竖图：长短边对调（${g.width}×${g.height}）`)
  await page.getByTestId('set-shape-Square').click()
  g = await gen()
  check(g.width === 1728 && g.height === 1728, `自定义点方图：√(1024×3008) 按 64 取整、不超过上限（${g.width}×${g.height}）`)
  await pick('set-size', 'Normal')
  g = await gen()
  check(g.width === 1024 && g.height === 1024, `从自定义（方）换到 Normal：Normal 的方图（${g.width}×${g.height}）`)
  await page.getByTestId('set-shape-Portrait').click()

  await page.getByTestId('set-seed').fill('12345')
  await page.getByTestId('set-seed').press('Enter')
  check((await gen()).seed === 12345, 'Seed 12345')
  await page.getByTestId('set-seed').fill('-3')
  await page.getByTestId('set-seed').press('Enter')
  check((await gen()).seed === 12345, 'Seed 不合法（负数）不改')
  await page.getByTestId('set-seed').fill('')
  await page.getByTestId('set-seed').press('Enter')
  check((await gen()).seed === null, '清空 = 随机')

  const hintOf = async (label) => {
    const el = page.locator('[data-hint]').filter({ hasText: new RegExp(`^${label}$`) }).first()
    await el.hover()
    const text = await page.waitForFunction(() => document.querySelector('[data-slot=tooltip-content]')?.textContent.trim(), null, { timeout: 2000 }).then((h) => h.jsonValue(), () => '')
    if (label === '步数') {
      await page.waitForTimeout(250)
      const a = await el.boundingBox()
      const t = await page.locator('[data-slot=tooltip-content]').boundingBox()
      const x = Math.min(a.x, t.x) - 12
      const y = Math.min(a.y, t.y) - 12
      const file = `${out}/${prefix}-2b-hint-${suffix}.png`
      await page.screenshot({ path: file, clip: { x, y, width: Math.max(a.x + a.width, t.x + t.width) - x + 12, height: Math.max(a.y + a.height, t.y + t.height) - y + 12 } })
      console.log('clip', file)
    }
    await page.mouse.move(2, 300)
    await page.mouse.move(4, 320)
    await page.waitForFunction(() => !document.querySelector('[data-slot=tooltip-content]'), null, { timeout: 2000 }).catch(() => {})
    return text
  }
  const HINT_CASES = {
    模型: '生成所用的模型；各模型的参数分别保存',
    质量: '生成时在正面 prompt 末尾添加一组质量 tag',
    步数: '去噪的步数，步数越多细节越多、耗时越长；Opus 订阅下超过 28 步需花费 Anlas',
    Seed: '参数相同时，同一个 Seed 生成同一张图；留空为随机',
    位置: "AI's Choice：由 AI 决定角色位置；Custom：手动指定每个角色的位置",
  }
  for (const [label, want] of Object.entries(HINT_CASES)) {
    const got = await hintOf(label)
    check(got === want, `悬停「${label}」：${got}`)
  }
  const deco = await page.locator('[data-hint]').first().evaluate((e) => ({ line: getComputedStyle(e).textDecorationLine, svg: e.querySelector('svg') !== null }))
  check(deco.line === 'none' && !deco.svg, '参数名不加下划线、不加图标')
  check(!(await page.getByTestId('settings-position').innerText()).includes('位置由 AI 决定'), "「位置」下面没有「AI's Choice：位置由 AI 决定」")

  check(await page.getByTestId('pos-open').isDisabled(), "AI's Choice：「调整位置」不能点")
  await page.getByTestId('set-coords-custom').click()
  await page.waitForTimeout(200)
  check((await page.locator('[data-testid=pos-mini] .pos-dot').count()) === 3, 'Custom：示意图上画 3 个启用的角色')
  await clip(page.getByTestId('settings-position'), '3-position-card', 6)
  await page.getByTestId('pos-mini').click()
  const dlg = page.getByTestId('pos-dialog')
  await dlg.waitFor({ state: 'visible' })
  await page.waitForTimeout(250)
  await shot('4-pos-dialog')
  check((await dlg.locator('footer').innerText()).trim().startsWith('拖动圆点调整位置') && !(await dlg.locator('footer').innerText()).includes('·'), `弹窗底部只写「拖动圆点调整位置」（${(await dlg.locator('footer').innerText()).trim().replace(/\s+/g, ' ')}）`)
  const before = (await activeDoc()).doc.characters[2].center
  const dot = dlg.getByTestId('pos-dot').last()
  const b = await dot.boundingBox()
  const cb = await dlg.getByTestId('pos-canvas').boundingBox()
  await page.mouse.move(b.x + b.width / 2 + 6, b.y + b.height / 2 + 4)
  await page.mouse.down()
  for (let i = 1; i <= 8; i++) await page.mouse.move(b.x + b.width / 2 + 6 + i * 10, b.y + b.height / 2 + 4 + i * 5)
  check((await dot.getAttribute('data-drag')) === '', '拖动中圆点高亮')
  await shot('5-pos-dragging', { mouse: false })
  await page.mouse.up()
  const after = (await activeDoc()).doc.characters[2].center
  const dx = (after.x - before.x) * cb.width
  const dy = (after.y - before.y) * cb.height
  check(Math.abs(dx - 80) < 2 && Math.abs(dy - 40) < 2, `拖动后中心点挪了 80, 40（${dx.toFixed(1)}, ${dy.toFixed(1)}）`)
  await dlg.getByTestId('pos-row').nth(0).hover()
  check((await dlg.getByTestId('pos-dot').nth(0).getAttribute('data-hl')) === '', '悬停右边第 1 行：画布上 1 号点高亮、提到最上面')
  await shot('5b-pos-hover-row', { mouse: false })
  await dlg.getByTestId('pos-done').click()
  await dlg.waitFor({ state: 'hidden' })
  await undo()
  const back = (await activeDoc()).doc.characters[1].center
  check(back.x === before.x && back.y === before.y, '一次拖动是一步撤销')
  await page.keyboard.press('Control+Shift+z')

  await page.getByTestId('set-seed').fill('777')
  await page.getByTestId('set-seed').press('Enter')
  await page.getByTestId('copy-nai-image').click()
  await page.waitForTimeout(600)
  check((await page.getByTestId('copy-nai-image').innerText()).includes('已复制'), '按钮变成 ✓ 已复制')
  check((await page.locator('[data-testid=params-panel][data-state=open]').count()) === 1, '点了底栏的「复制」：参数面板不收')
  const res = await page.evaluate(async () => {
    const items = await navigator.clipboard.read()
    const blob = await items[0].getType('image/png')
    const m = await import('/src/lib/nai-image.ts')
    const meta = await m.readImageMeta(blob)
    const p = m.parseNaiImage(meta)
    const bmp = await createImageBitmap(blob)
    const bytes = new Uint8Array(await blob.arrayBuffer())
    let b64 = ''
    for (let i = 0; i < bytes.length; i += 0x8000) b64 += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
    const chunk = (type, data) => {
      const out = new Uint8Array(12 + data.length)
      new DataView(out.buffer).setUint32(0, data.length)
      out.set([...type].map((c) => c.charCodeAt(0)), 4)
      out.set(data, 8)
      return out
    }
    const text = chunk('tEXt', new TextEncoder().encode('Software\0GIMP'))
    const ihdrEnd = 8 + 12 + new DataView(bytes.buffer).getUint32(8)
    const gimp = new Blob([bytes.subarray(0, ihdrEnd), text, bytes.subarray(ihdrEnd)], { type: 'image/png' })
    const gimpMeta = await m.readImageMeta(gimp)
    return { meta, p, w: bmp.width, h: bmp.height, b64: btoa(b64), gimp: gimpMeta && 'Comment' in gimpMeta }
  })
  writeFileSync(`${out}/${prefix}-nai-image.png`, Buffer.from(res.b64, 'base64'))
  console.log('png', `${out}/${prefix}-nai-image.png`, `${res.w}×${res.h}`)
  const d = (await activeDoc()).doc
  check(res.meta?.Software === 'NovelAI' && res.meta.Source === 'NovelAI Diffusion V5 0ADF9AB7', '剪贴板里的图读得到元数据（Software / Source）')
  check(res.p.quality === d.settings.qualityTags && res.p.ucPreset === d.settings.ucPreset && res.p.mode === d.settings.mode, '质量 / UC 预设 / 模式 对得上')
  check(JSON.stringify(res.p.gen) === JSON.stringify(d.settings.gen), `生成参数对得上（${JSON.stringify(res.p.gen)}）`)
  check(res.p.useCoords === true && JSON.stringify(res.p.characters.map((c) => c.center)) === JSON.stringify(d.characters.filter((c) => c.enabled).map((c) => c.center)), '位置 Custom + 每个角色的中心点对得上')
  check(Math.abs(res.w / res.h - 832 / 1216) < 0.01, `图按出图比例（${res.w}×${res.h}）`)
  check(res.gimp === true, '读图兜底：文本块里只有 Software: GIMP 时继续读 alpha')

  const docBefore = (await activeDoc()).doc
  const dt = await page.evaluateHandle((b64) => {
    const dt = new DataTransfer()
    dt.items.add(new File([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))], 'image.png', { type: 'image/png' }))
    return dt
  }, res.b64)
  await page.dispatchEvent('main', 'dragenter', { dataTransfer: dt })
  await page.dispatchEvent('main', 'dragover', { dataTransfer: dt })
  await page.dispatchEvent('main', 'drop', { dataTransfer: dt })
  await page.getByTestId('intake-import').click()
  const imp = page.getByTestId('import-dialog')
  await imp.waitFor({ state: 'visible', timeout: 5000 })
  check((await page.getByTestId('import-dot').count()) === 3, '拖回来：导入弹窗缩略图上 3 个位置点')
  await shot('6-reimport', { mouse: false })
  await page.getByTestId('import-target-current').click()
  await page.getByTestId('import-submit').click()
  await imp.waitFor({ state: 'hidden' })
  const toastUndo = page.getByRole('button', { name: '撤销' })
  await toastUndo.waitFor()
  const imported = (await activeDoc()).doc
  check(imported.base.prompt.length === 1 && imported.base.prompt[0].name === '导入', '导到当前文档：正面换成一个「导入」区块')
  await page.getByTestId('doc-title').fill('导入后又改了标题')
  await page.waitForTimeout(300)
  await toastUndo.click()
  const restored = (await activeDoc()).doc
  check(JSON.stringify(restored.base) === JSON.stringify(docBefore.base) && restored.meta.title === docBefore.meta.title, 'toast「撤销」：导入后又改过，也只撤这次导入（整份换回导入前）')
  await undo()
  check((await activeDoc()).doc.meta.title === '导入后又改了标题', '再 Ctrl+Z：导入后的改动还找得回来')
}

await toTab(page, 'copy')
await page.getByTestId('export-cards').waitFor()
await shot('7-export')
if (shots) {
  await page.getByTestId('export-tab-json').click()
  const json = JSON.parse(await page.getByTestId('export-json').innerText())
  check(json.v4_prompt && json.tag_hint_qt !== undefined && json.request_type === 'PromptGenerateRequest', 'JSON 页 = 复制为 NAI 图写进去的那份 Comment')
  await clip(panel, '8-json')
}

await page.evaluate(async () => {
  const { usePrefs } = await window.__peImport('/src/store/prefs.ts')
  usePrefs.setState({ nsfw: 'r18' })
  location.hash = '/settings'
})
await page.getByTestId('settings-nav-defaults').click()
await page.getByTestId('doc-defaults').waitFor()
const defaults = page.getByTestId('doc-defaults')
check((await defaults.getByTestId('settings-model').getByTestId('doc-nsfw').count()) === 1 && (await defaults.getByTestId('settings-preset').getByTestId('doc-nsfw').count()) === 0, '默认设置：NSFW 也在模型卡，不在 Prompt 预设卡')
await defaults.locator('[data-hint]').filter({ hasText: /^模型$/ }).hover()
await page.getByRole('tooltip').first().waitFor()
check((await page.getByRole('tooltip').first().innerText()) === '生成所用的模型；各模型的参数分别保存', '默认设置：参数名同样有解释')

console.log('errors', errors.length ? errors : 'none')
console.log(fails.length ? `FAILED ${fails.length}: ${fails.join(' / ')}` : 'ALL OK')
await browser.close()
process.exit(fails.length ? 1 : 0)
