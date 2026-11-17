import { chromium } from '@playwright/test'
import { existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { E2E_URL, isolate, resetStore } from './store.mjs'

const theme = process.argv[2] ?? 'light'
const prefix = process.argv[3] ?? 'imp'
const width = Number(process.argv[4] ?? 1440)
const out = 'e2e/shots'
mkdirSync(out, { recursive: true })

const dir = process.env.NAI_SAMPLES ?? join(process.env.USERPROFILE ?? '', 'Downloads')
const files = existsSync(dir) ? readdirSync(dir) : []
const sample = (seed) => {
  const f = files.find((n) => n.endsWith(` s-${seed}.png`))
  return f ? join(dir, f) : null
}
const SEEDS = [735531459, 1209116790, 2405716865, 2463236771, 4079949417, 2012579807]
if (!SEEDS.every(sample)) {
  console.log(`跳过：${dir} 里找不到样图（文件名以 s-<seed>.png 结尾：${SEEDS.join(', ')}）`)
  process.exit(0)
}

function stripText(buf) {
  const parts = [buf.subarray(0, 8)]
  let p = 8
  while (p < buf.length) {
    const len = buf.readUInt32BE(p)
    const type = buf.toString('latin1', p + 4, p + 8)
    if (!['tEXt', 'iTXt', 'zTXt'].includes(type)) parts.push(buf.subarray(p, p + 12 + len))
    if (type === 'IEND') break
    p += 12 + len
  }
  return Buffer.concat(parts)
}

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width, height: width < 1200 ? 800 : 900 }, deviceScaleFactor: 2 })
await isolate(page.context())
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
const shot = async (name, { mouse = true } = {}) => {
  await page.waitForTimeout(300)
  if (mouse) await page.mouse.move(2, 2)
  await page.waitForTimeout(200)
  const file = `${out}/${prefix}-${name}-${theme}${width === 1440 ? '' : `-${width}`}.png`
  await page.screenshot({ path: file })
  console.log('shot', file)
}

async function dragFiles(list, { drop = true } = {}) {
  const dt = await page.evaluateHandle((list) => {
    const dt = new DataTransfer()
    for (const f of list) dt.items.add(new File([Uint8Array.from(atob(f.b64), (c) => c.charCodeAt(0))], f.name, { type: f.type }))
    return dt
  }, list)
  await page.dispatchEvent('main', 'dragenter', { dataTransfer: dt })
  await page.dispatchEvent('main', 'dragover', { dataTransfer: dt })
  if (drop) await page.dispatchEvent('main', 'drop', { dataTransfer: dt })
  return dt
}
const png = (seed, buf = readFileSync(sample(seed))) => ({ b64: buf.toString('base64'), name: `s-${seed}.png`, type: 'image/png' })
const dialog = page.getByTestId('import-dialog')
const pickImport = async () => {
  await page.getByTestId('intake-import').click({ timeout: 5000 })
}
const openWith = async (file) => {
  await dragFiles([file])
  await pickImport()
  await dialog.waitFor({ state: 'visible', timeout: 5000 })
  await page.waitForTimeout(250)
}
const activeDoc = async () => {
  await page.waitForTimeout(400)
  return page.evaluate(async () => {
    const tabs = JSON.parse((await window.__peImport('/src/store/storage.ts')).safeStorage.getItem('pe:tabs')).state
    return { id: tabs.activeId, count: tabs.order.length, doc: JSON.parse((await window.__peImport('/src/store/storage.ts')).safeStorage.getItem(`pe:doc:${tabs.activeId}`)) }
  })
}
const texts = (sections) => sections.flatMap((s) => s.chips.map((c) => c.text))
const typeState = (t) => page.getByTestId(`import-type-${t}`).getAttribute('data-state')
const submit = async () => {
  await page.getByTestId('import-submit').click()
  await dialog.waitFor({ state: 'hidden' })
}

const dt0 = await dragFiles([png(735531459)], { drop: false })
await page.waitForTimeout(250)
check((await page.getByTestId('drop-overlay').getAttribute('data-show')) === '', '从外面拖文件进来：出现提示层')
await shot('0-drop-overlay', { mouse: false })
await page.dispatchEvent('main', 'dragleave', { dataTransfer: dt0 })
await page.waitForTimeout(250)
check((await page.getByTestId('drop-overlay').getAttribute('data-show')) === null, '拖出窗口：提示层淡出')

const before = await activeDoc()
await openWith(png(735531459))
check((await page.getByTestId('import-dot').count()) === 3, 'Custom：缩略图上 3 个位置点')
check((await typeState('uc')) === 'mixed', '负面：文本是空的不勾，类型勾是 ▣')
check((await page.getByTestId('import-type-uc').innerText()).includes('1/2'), '负面类型勾旁边写 1/2')
check((await typeState('seed')) === 'off', 'Seed 默认不勾')
check((await page.getByTestId('import-stripped').first().innerText()).includes('very aesthetic, masterpiece, no text'), '正面那行写出剥掉的质量标签')
await shot('1-dialog')
await page.getByTestId('import-type-settings').hover()
await shot('2-hover-settings', { mouse: false })
check((await page.locator('[data-testid=import-dialog] [data-hl]').count()) === 9, '悬停「设置」：它管的 9 项都描出来')
await page.getByTestId('import-item-steps').click()
check((await typeState('settings')) === 'mixed', '设置全勾时点掉「步数」→ ▣')
check((await page.getByTestId('import-type-settings').innerText()).includes('8/9'), '设置旁边写 8/9')
await page.getByTestId('import-item-steps').click()
check((await typeState('settings')) === 'on', '点回来 → ☑')
await page.getByTestId('import-type-settings').click()
check((await typeState('settings')) === 'off', '点 ☑ 的类型勾 → 全不勾')
check((await page.getByTestId('import-item-model').getAttribute('data-state')) === 'unchecked', '它管的项都不勾了')
await page.getByTestId('import-type-settings').click()
check((await typeState('settings')) === 'on', '再点 → 全勾')
await page.getByTestId('import-type-uc').click()
check((await typeState('uc')) === 'on', '点 ▣ 的类型勾 → 全勾')
await page.getByTestId('import-type-uc').click()
await page.getByTestId('import-item-ucPreset').click()
check((await typeState('uc')) === 'mixed', '负面回到 ▣')
await submit()
let a = await activeDoc()
check(a.count === before.count + 1 && a.id !== before.id, '默认导入到新标签页')
check(a.doc.meta.title === '未命名', '新标签页标题「未命名」')
check(a.doc.base.prompt.length === 1 && a.doc.base.prompt[0].name === '导入' && a.doc.base.prompt[0].color === 'slate', '正面 = 一个灰色「导入」区块')
check(!texts(a.doc.base.prompt).some((t) => ['very aesthetic', 'masterpiece', 'no text'].includes(t)), '正面里没有质量标签')
check(a.doc.base.uc.length === 0, '负面是空的（不勾 = 空框）')
check(a.doc.settings.qualityTags === 'standard' && a.doc.settings.ucPreset === 'heavy' && a.doc.settings.useCoords === true, '质量 Standard · UC Heavy · Custom')
check(a.doc.characters.length === 3 && a.doc.characters.every((c) => c.name === ''), '3 个角色，名字留空')
check(JSON.stringify(a.doc.characters.map((c) => c.center)) === JSON.stringify([{ x: 0.512, y: 0.706 }, { x: 0.137, y: 0.311 }, { x: 0.773, y: 0.704 }]), '角色中心点进了 character.center')
check(a.doc.settings.gen.steps === 28 && a.doc.settings.gen.width === 832 && a.doc.settings.gen.seed === null, '步数 28、尺寸 832×1216 进了 settings.gen，Seed 没勾 = 随机')
check((await page.locator('[data-testid=character] input[aria-label=角色名]').first().getAttribute('placeholder')) === '角色 1', '没名字的角色显示「角色 1」')
await shot('3-imported')

await openWith(png(4079949417))
await submit()
a = await activeDoc()
check(a.doc.settings.mode === 'furry', 'Furry 那张：模式 furry')
check(texts(a.doc.base.prompt)[0] === '2girls', 'Furry 那张：正面开头的 fur dataset 剥掉了')
check(a.doc.settings.qualityTags === 'none' && a.doc.settings.ucPreset === 'none', 'Furry 那张：质量 None · UC None')
check(JSON.stringify(texts(a.doc.base.uc)) === '["bad hands"]', 'Furry 那张：UC 框只有 bad hands')

await openWith(png(2405716865))
await submit()
a = await activeDoc()
check(a.doc.settings.model === 'v5-curated', 'Curated 那张：模型 v5-curated')
check(!texts(a.doc.base.uc).includes('nsfw') && JSON.stringify(texts(a.doc.base.uc)) === '["bad hands"]', 'Curated 那张：UC 没有 nsfw，只剩 bad hands')
check(a.doc.settings.gen.steps === 23, 'Curated 那张：23 步')

for (const seed of [1209116790, 2463236771]) {
  await openWith(png(seed))
  check((await page.getByTestId('import-dot').count()) === 0, `${seed}：AI's Choice 不画位置点`)
  await submit()
  a = await activeDoc()
  const smile = a.doc.base.prompt[0].chips.find((c) => c.text === 'smile')
  check(a.doc.settings.qualityTags === 'light' && smile?.weight === 1.2 && a.doc.settings.useCoords === false, `${seed}：Light · smile 1.2 · AI's Choice`)
}

await openWith(png(2012579807, stripText(readFileSync(sample(2012579807)))))
check((await page.getByTestId('import-stripped').first().innerText()).includes('fur dataset'), '只剩 alpha 的图也能读（Furry 前缀写在剥掉的原文里）')
await submit()
a = await activeDoc()
check(a.doc.settings.mode === 'furry' && a.doc.settings.qualityTags === 'light' && a.doc.settings.gen.steps === 20 && a.doc.settings.gen.scale === 6, '2012579807（alpha）：Furry · Light · 20 步 · 引导 6')
check(JSON.stringify(texts(a.doc.characters[1].uc)) === '["test t3 char2 uc"]', '2012579807：角色 2 的负面')

const cur = await activeDoc()
await openWith(png(1209116790))
await page.getByTestId('import-target-current').click()
await page.getByTestId('import-type-chars').click()
await page.getByTestId('import-type-settings').click()
const sum = await page.getByTestId('import-summary').innerText()
check(sum.includes('将替换') && sum.includes('正面 1 个区块') && sum.includes('UC 预设') && !sum.includes('角色') && !sum.includes('参数'), `底部写会替换什么：「${sum}」`)
await page.getByTestId('import-type-chars').click()
await page.getByTestId('import-append-append').click()
check((await page.getByTestId('import-summary').innerText()).includes('追加 3 个角色'), '角色 [追加] → 底部写追加')
await shot('4-current-doc')
await page.getByTestId('import-type-chars').click()
await page.keyboard.press('Enter')
await dialog.waitFor({ state: 'hidden' })
a = await activeDoc()
check(a.id === cur.id && a.count === cur.count, '↵ 导入到当前文档：不开新标签页')
check(texts(a.doc.base.prompt).includes('smile') && a.doc.characters.length === cur.doc.characters.length, '正面换了，角色没动')
check(a.doc.settings.mode === 'furry', '设置没勾：模式还是原来的 furry')
await page.getByRole('button', { name: '撤销' }).last().click()
a = await activeDoc()
check(JSON.stringify(texts(a.doc.base.prompt)) === JSON.stringify(texts(cur.doc.base.prompt)), 'toast 里的「撤销」：一步回到导入前')

await page.getByTestId('new-tab').click()
await page.waitForTimeout(300)
const startBefore = await page.evaluate(async () => JSON.parse((await window.__peImport('/src/store/storage.ts')).safeStorage.getItem('pe:tabs')).state)
if ((await page.getByTestId('start-page').count()) && startBefore.starts.length) {
  await page.getByTestId('start-import-input').setInputFiles(sample(735531459))
  await dialog.waitFor({ state: 'visible' })
  check((await page.getByTestId('import-target').count()) === 0, '开始页导入：没有「导入到」')
  await submit()
  const after = await page.evaluate(async () => JSON.parse((await window.__peImport('/src/store/storage.ts')).safeStorage.getItem('pe:tabs')).state)
  check(after.order.length === startBefore.order.length && after.starts.length === 0, '开始页导入：放进这个标签页，不多开')
} else {
  check(false, '开始页：没找到新标签页按钮')
}

const toastText = async () => (await page.locator('[data-sonner-toast]').allInnerTexts()).join(' | ')
await dragFiles([{ b64: Buffer.from('hello').toString('base64'), name: 'a.txt', type: 'text/plain' }])
await page.waitForTimeout(300)
check((await toastText()).includes('不是图片') && !(await dialog.isVisible()) && !(await page.getByTestId('image-intake').count()), '不是图片：toast，不开弹窗')
await page.waitForTimeout(4500)
const tiny = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
await dragFiles([{ b64: tiny.toString('base64'), name: 'shot.png', type: 'image/png' }])
await page.getByTestId('image-intake').waitFor()
const disabledImport = page.getByTestId('intake-import')
check(await disabledImport.isDisabled() && (await disabledImport.innerText()).includes('未读取到图片信息'), '没有元数据：导入 prompt 置灰并说明原因')
await disabledImport.click({ force: true })
check(!(await dialog.isVisible()) && await page.getByTestId('image-intake').isVisible(), '点击置灰项仍停在用途弹窗')
await page.keyboard.press('Escape')
await dragFiles([png(735531459), png(4079949417)])
await pickImport()
await dialog.waitFor({ state: 'visible' })
check((await page.locator('[data-sonner-toast]').allInnerTexts()).some((t) => t.includes('一次只能处理一张')), '一次拖两张：读第一张并提示')
await page.keyboard.press('Escape')
await dialog.waitFor({ state: 'hidden' })
check(true, 'Esc 关闭弹窗')

console.log(fails.length ? `\n${fails.length} 项失败` : '\n全部通过')
console.log('errors', errors.length ? errors : 'none')
await browser.close()
