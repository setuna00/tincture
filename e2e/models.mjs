// Keep the network abort even with a fake fetch: a mock miss must never reach paid NovelAI endpoints.
import { chromium } from '@playwright/test'
import { closeParams, openParams, toTab } from './right-panel.mjs'
import { Packr } from 'msgpackr'
import { mkdirSync } from 'node:fs'
import { E2E_URL, isolate, resetStore } from './store.mjs'

const theme = process.argv[2] ?? 'light'
const prefix = process.argv[3] ?? 'models'
const width = 1920
const height = 1000
const out = 'e2e/shots'
mkdirSync(out, { recursive: true })
const url = E2E_URL
const onlyShots = !!process.env.ONLY_SHOTS

const browser = await chromium.launch()
const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 })
await isolate(context)
const page = await context.newPage()
const errors = []
page.on('console', (m) => m.type() === 'error' && !/novelai\.net|Failed to load resource/.test(m.text()) && errors.push(m.text()))
page.on('pageerror', (e) => errors.push(String(e)))

const SUB = { tier: 3, active: true, expiresAt: 4102444800, trainingStepsLeft: 2340, usage: { percent: 63, purchasedPercent: 0, timeUntilNextPercent: 4320, isNegative: false } }
await context.route(/novelai\.net/, (route) => {
  const u = route.request().url()
  if (u.endsWith('/user/subscription')) return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(SUB) })
  return route.abort()
})
await context.addInitScript(() => {
  const real = window.fetch.bind(window)
  window.__naiRequests = []
  window.fetch = async (input, init) => {
    const u = typeof input === 'string' ? input : input.url
    if (!u.includes('novelai.net/ai/generate-image-stream')) return real(input, init)
    const form = init?.body
    window.__naiRequests.push(form instanceof FormData ? JSON.parse(await form.get('request').text()) : null)
    const frames = (window.__naiMock?.frames ?? []).map((b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)))
    const body = new ReadableStream({
      async start(ctl) {
        for (const f of frames) {
          await new Promise((r) => setTimeout(r, 20))
          ctl.enqueue(f)
        }
        ctl.close()
      },
    })
    return new Response(body, { status: 200 })
  }
})

const fails = []
const check = (ok, msg) => (ok ? console.log('ok  ', msg) : (fails.push(msg), console.log('FAIL', msg)))
const clip = async (loc, name, pad = 0) => {
  await page.mouse.move(2, height - 60)
  await page.waitForTimeout(300)
  const b = await loc.boundingBox()
  const file = `${out}/${prefix}-${name}-${theme}.png`
  await page.screenshot({ path: file, clip: { x: Math.max(0, b.x - pad), y: Math.max(0, b.y - pad), width: b.width + pad * 2, height: b.height + pad * 2 } })
  console.log('clip', file)
}
const pick = async (trigger, name) => {
  await page.getByTestId(trigger).click()
  await page.getByRole('option', { name, exact: true }).click()
  await page.waitForTimeout(250)
}
const options = async (trigger) => {
  await page.getByTestId(trigger).click()
  const list = await page.getByRole('option').allTextContents()
  await page.keyboard.press('Escape')
  await page.waitForTimeout(150)
  return list
}
const activeDoc = async () => {
  await page.waitForTimeout(400)
  return page.evaluate(async () => {
    const tabs = JSON.parse((await window.__peImport('/src/store/storage.ts')).safeStorage.getItem('pe:tabs')).state
    return JSON.parse((await window.__peImport('/src/store/storage.ts')).safeStorage.getItem(`pe:doc:${tabs.activeId}`))
  })
}
const open_ = async (testId) => (await page.getByTestId(testId).getAttribute('data-open')) === ''
const undo = async () => {
  const open = (await page.getByTestId('params-panel').count()) > 0
  await page.mouse.click(width / 2, height - 12)
  await page.keyboard.press('Control+z')
  await page.waitForTimeout(300)
  if (open) await openParams(page)
}

async function open() {
  await page.goto(url)
  await resetStore(page, { kv: { 'pe:prefs': { state: { theme }, version: 0 } }, nai: { state: { token: 'pst-test' }, version: 1 } })
  await page.reload()
  await page.waitForSelector('[data-testid=params-button]', { timeout: 60000 })
  await openParams(page)
  await page.waitForSelector('[data-testid=settings-page]')
  await page.waitForTimeout(600)
  await page.addStyleTag({ content: '[data-sonner-toaster]{visibility:hidden!important}' })
}

const MODELS = [
  { id: 'v5-curated', name: 'V5 Curated', scale: '7', quality: ['Standard', 'Light', 'None'], uc: ['Heavy', 'Light', 'Furry Focus', 'Human Focus', 'None'], legacy: false, v4: false },
  { id: 'v5-full', name: 'V5 Full', scale: '7', quality: ['Standard', 'Light', 'None'], uc: ['Heavy', 'Light', 'Furry Focus', 'Human Focus', 'None'], legacy: false, v4: false },
  { id: 'v45-curated', name: 'V4.5 Curated', scale: '5', quality: ['Standard', 'None'], uc: ['Heavy', 'Light', 'Human Focus', 'None'], legacy: false, v4: true },
  { id: 'v45-full', name: 'V4.5 Full', scale: '5', quality: ['Standard', 'None'], uc: ['Heavy', 'Light', 'Furry Focus', 'Human Focus', 'None'], legacy: false, v4: true },
  { id: 'v4-curated', name: 'V4 Curated', scale: '5.5', quality: ['Standard', 'None'], uc: ['Heavy', 'Light', 'None'], legacy: true, v4: true },
  { id: 'v4-full', name: 'V4 Full', scale: '5.5', quality: ['Standard', 'None'], uc: ['Heavy', 'Light', 'None'], legacy: true, v4: true },
]

await open()
const settings = page.getByTestId('settings-page')

if (onlyShots) {
  for (const { id, name } of MODELS) {
    await page.getByTestId('set-model').click()
    const opt = page.getByRole('option', { name, exact: true })
    if (!(await opt.count())) {
      await page.keyboard.press('Escape')
      continue
    }
    await opt.click()
    await page.waitForTimeout(250)
    await clip(settings, `settings-${id}`)
  }
  await browser.close()
  console.log(errors.length ? `console 报错 ${errors.length}：\n${errors.join('\n')}` : 'console 无报错')
  process.exit(0)
}

await page.getByTestId('set-model').click()
await page.waitForTimeout(250)
const groups = await page.locator('[data-slot=select-label]').allTextContents()
const names = await page.getByRole('option').allTextContents()
check(JSON.stringify(groups) === JSON.stringify(['新模型', '旧模型']), `下拉分组 ${groups.join(' / ')}`)
check(JSON.stringify(names) === JSON.stringify(MODELS.map((m) => m.name)), `下拉顺序 ${names.join(' · ')}`)
await clip(page.locator('[data-slot=select-content]'), 'model-dropdown', 4)
await page.keyboard.press('Escape')
await page.waitForTimeout(200)

for (const m of MODELS) {
  await pick('set-model', m.name)
  const doc = await activeDoc()
  check(doc.settings.model === m.id, `${m.name}：文档里的模型 ${doc.settings.model}`)
  check((await open_('transparent-row')) === !m.v4, `${m.name}：透明背景${m.v4 ? '没有' : '有'}`)
  check((await open_('variety-row')) === m.v4, `${m.name}：Variety+ ${m.v4 ? '有' : '没有'}`)
  check((await open_('noise-row')) === m.v4, `${m.name}：噪声调度 ${m.v4 ? '有' : '没有'}`)
  check((await open_('legacy-uc-row')) === m.legacy, `${m.name}：Legacy UC ${m.legacy ? '有' : '没有'}`)
  const q = await options('quality-preset')
  check(JSON.stringify(q) === JSON.stringify(m.quality), `${m.name}：质量下拉 ${q.join(' / ')}`)
  const u = await options('uc-preset')
  check(JSON.stringify(u) === JSON.stringify(m.uc), `${m.name}：UC 预设下拉 ${u.join(' / ')}`)
  check((await page.getByTestId('set-scale').locator('input[inputmode=decimal]').inputValue()) === m.scale, `${m.name}：第一次切到时引导是默认 ${m.scale}`)
  check((await page.getByTestId('set-effort').locator('button').first().isDisabled()) === (m.id !== 'v5-full'), `${m.name}：Effort ${m.id === 'v5-full' ? '能选' : '置灰'}`)
  if (m.v4) {
    const n = await options('set-noise')
    check(JSON.stringify(n) === JSON.stringify(['karras推荐', 'exponential', 'polyexponential']), `${m.name}：噪声调度 ${n.join(' / ')}`)
  }
  await clip(settings, `settings-${m.id}`)
}

await pick('set-model', 'V5 Full')
await page.getByTestId('set-steps').locator('input[inputmode=decimal]').fill('30')
await page.getByTestId('set-steps').locator('input[inputmode=decimal]').press('Enter')
await pick('uc-preset', 'Furry Focus')
await pick('set-model', 'V4.5 Curated')
check((await page.getByTestId('set-steps').locator('input[inputmode=decimal]').inputValue()) === '23', '切到 V4.5 Curated：步数是它自己的 23')
check((await page.getByTestId('uc-preset').textContent()).includes('Heavy'), 'V4.5 Curated：UC 预设是它自己的 Heavy')
await pick('set-model', 'V5 Full')
check((await page.getByTestId('set-steps').locator('input[inputmode=decimal]').inputValue()) === '30', '切回 V5 Full：步数还原 30')
check((await page.getByTestId('uc-preset').textContent()).includes('Furry Focus'), '切回 V5 Full：UC 预设还原 Furry Focus')
await pick('set-model', 'V4 Full')
await undo()
const afterUndo = await activeDoc()
check(afterUndo.settings.model === 'v5-full' && afterUndo.settings.gen.steps === 30, `撤销切模型：回到 V5 Full、30 步（${afterUndo.settings.model} ${afterUndo.settings.gen.steps}）`)

await pick('set-model', 'V4 Full')
check(!(await open_('scale-warning')), 'V4 Full 5.5：没有引导提示')
await page.getByTestId('set-scale').locator('input[inputmode=decimal]').fill('7')
await page.getByTestId('set-scale').locator('input[inputmode=decimal]').press('Enter')
await page.waitForTimeout(300)
check(await open_('scale-warning'), 'V4 Full 引导 7：滑杆下面出现提示')
check((await page.getByTestId('scale-warning').textContent()).includes('引导过高'), '提示写「引导过高」')
await clip(page.getByTestId('settings-image'), 'v4-scale-warning')
await page.getByTestId('scale-reset').click()
await page.waitForTimeout(300)
check((await page.getByTestId('set-scale').locator('input[inputmode=decimal]').inputValue()) === '5.5' && !(await open_('scale-warning')), '点「重置为默认」：引导回 5.5、提示收起')
await page.getByTestId('set-scale').locator('input[inputmode=decimal]').fill('1')
await page.getByTestId('set-scale').locator('input[inputmode=decimal]').press('Enter')
await page.waitForTimeout(300)
check((await page.getByTestId('scale-warning').textContent()).includes('引导过低'), 'V4 Full 引导 1：「引导过低」')
await page.getByTestId('scale-reset').click()
await pick('set-sampler', 'DPM++ 2M')
check((await page.getByTestId('set-noise').textContent()).trim() === 'exponential', '换成 DPM++ 2M：噪声调度跟着变 exponential')
await pick('set-noise', 'polyexponential')
check((await activeDoc()).settings.gen.noiseSchedule === 'polyexponential', '选 polyexponential 存进文档')
await pick('set-sampler', 'Euler')
check((await page.getByTestId('set-noise').textContent()).trim() === 'karras', '再换采样器：回到这个采样器的默认 karras')
await page.getByTestId('set-legacy-uc').click()
await page.getByTestId('set-variety').click()
const g4 = (await activeDoc()).settings.gen
check(g4.legacyUc === true && g4.varietyPlus === true, 'Legacy UC、Variety+ 开关存进文档')
await page.getByTestId('gen-reset').click()
await page.waitForTimeout(300)
const g4r = (await activeDoc()).settings.gen
check(!g4r.legacyUc && !g4r.varietyPlus && g4r.sampler === 'k_euler_ancestral' && g4r.scale === 5.5, `↺ 重置也关掉 Legacy UC / Variety+（${JSON.stringify(g4r)}）`)

const addChar = page.getByTestId('add-character')
for (let i = 0; i < 5 && !(await addChar.isDisabled()); i++) {
  await addChar.click()
  await page.getByTestId('add-character-female').click()
  await page.waitForTimeout(200)
}
const nChars = (await activeDoc()).characters.length
check(nChars === 6 && (await addChar.isDisabled()), `V4 Full：加到 6 个角色后「添加角色」置灰（${nChars} 个）`)
await addChar.hover({ force: true })
await page.getByRole('tooltip').waitFor({ timeout: 3000 }).catch(() => {})
const addTip = await page.getByRole('tooltip').textContent().catch(() => null)
check(addTip === '6 / 6 个角色', `悬停写「6 / 6 个角色」（${addTip}）`)
await page.mouse.move(2, 890)

await openParams(page)
await page.getByTestId('set-coords').getByText('Custom').click()
await page.waitForTimeout(250)
check((await page.getByTestId('pos-mini').getAttribute('data-grid')) === '', '示意图画 5×5 格')
await page.getByTestId('pos-open').click()
await page.getByTestId('pos-dialog').waitFor()
await page.waitForTimeout(400)
const canvas = page.getByTestId('pos-canvas')
const cb = await canvas.boundingBox()
const dot = page.getByTestId('pos-dot').first()
const db = await dot.boundingBox()
await page.mouse.move(db.x + db.width / 2, db.y + db.height / 2)
await page.mouse.down()
await page.mouse.move(cb.x + cb.width * 0.13, cb.y + cb.height * 0.86, { steps: 8 })
await page.waitForTimeout(150)
await clip(page.getByTestId('pos-dialog'), 'v4-position-dragging')
await page.mouse.up()
await page.waitForTimeout(300)
const centers = (await activeDoc()).characters.map((c) => c.center)
check(centers.filter((c) => c.x === 0.1 && c.y === 0.9).length === 1 && centers.filter((c) => c.x === 0.5 && c.y === 0.5).length === centers.length - 1, `拖到左下角附近：吸到格心 (0.1, 0.9)（${JSON.stringify(centers)}）`)
await page.keyboard.press('Escape')
await page.waitForTimeout(300)

await toTab(page, 'copy')
await page.waitForTimeout(200)
const meter = async () => {
  await page.waitForFunction(() => [...document.querySelectorAll('[data-testid=token-count]')].every((e) => /^\d/.test(e.textContent)), null, { timeout: 20000 })
  await page.waitForTimeout(400)
  return page.evaluate(async () => {
    const tabs = JSON.parse((await window.__peImport('/src/store/storage.ts')).safeStorage.getItem('pe:tabs')).state
    const doc = JSON.parse((await window.__peImport('/src/store/storage.ts')).safeStorage.getItem(`pe:doc:${tabs.activeId}`))
    const { lengthPlan } = await import('/src/lib/nai-length.ts')
    const plan = lengthPlan(doc)
    const shown = Number(document.querySelector('[data-testid="export-base.prompt"] [data-testid=token-count]').textContent.replace(/\D/g, ''))
    const limit = document.querySelector('[data-testid="export-base.prompt"] [data-testid=length-meter]')?.textContent ?? ''
    let want = null
    if (plan.tokenizer === 't5') {
      const m = await import('/src/lib/t5-tokenizer.ts')
      const bin = await (await fetch('/src/assets/t5-vocab.bin')).arrayBuffer()
      want = m.createT5Counter(await m.loadT5Def(bin)).count(plan.boxes[0].text)
    }
    return { shown, want, tok: plan.tokenizer, limit: plan.limit, text: plan.boxes[0].text, meterText: limit }
  })
}
await openParams(page)
await pick('set-model', 'V4.5 Full')
await closeParams(page)
const m45 = await meter()
check(m45.tok === 't5' && m45.limit === 512 && m45.shown === m45.want, `V4.5 Full：正面 ${m45.shown} token = T5 算的 ${m45.want}（上限 ${m45.limit}）`)
await clip(page.getByTestId('export-panel'), 'v45-export')
await openParams(page)
await pick('set-model', 'V5 Full')
await closeParams(page)
const m5 = await meter()
check(m5.tok === 'qwen' && m5.limit === 1471 && m5.shown !== m45.shown, `V5 Full：换回 Qwen（${m5.shown} token，上限 ${m5.limit}）`)

await openParams(page)
await pick('set-model', 'V4.5 Full')
await page.getByTestId('set-variety').click()
const img = await page.evaluate(async () => {
  const { stealthPayload, writeStealthAlpha } = await import('/src/lib/nai-write.ts')
  const c = new OffscreenCanvas(832, 1216)
  const g = c.getContext('2d')
  g.fillStyle = 'hsl(200 60% 55%)'
  g.fillRect(0, 0, 832, 1216)
  const meta = { Description: '1girl', Software: 'NovelAI', Source: 'NovelAI Diffusion V4.5 4BDE2A90', Comment: JSON.stringify({ prompt: '1girl', seed: 5, steps: 23, width: 832, height: 1216 }) }
  const d = g.getImageData(0, 0, 832, 1216)
  writeStealthAlpha(d.data, 832, 1216, await stealthPayload(meta))
  g.putImageData(d, 0, 0)
  const b = new Uint8Array(await (await c.convertToBlob({ type: 'image/webp', quality: 1 })).arrayBuffer())
  let s = ''
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000))
  return btoa(s)
})
const packr = new Packr({ useRecords: false })
const body = packr.pack({ event_type: 'final', samp_ix: 0, gen_id: 'g', image: Buffer.from(img, 'base64') })
const frame = Buffer.alloc(4 + body.length)
frame.writeUInt32BE(body.length, 0)
body.copy(frame, 4)
await page.evaluate((f) => (window.__naiMock = { frames: [f] }), frame.toString('base64'))
await toTab(page, 'gen')
const price = (await page.getByTestId('gen-price').textContent()).trim()
check(/^(0|17)$/.test(price), `V4.5 Full 按钮价格（Opus 0 / 17；免费写 0）：${price}`)
await page.getByTestId('gen-button').click()
await page.getByTestId('gen-image').waitFor({ timeout: 15000 })
const req = await page.evaluate(() => window.__naiRequests[0])
const p = req?.parameters ?? {}
check(req?.model === 'nai-diffusion-4-5-full', `请求模型 ${req?.model}`)
check(p.skip_cfg_above_sigma === 58 && p.noise_schedule === 'karras' && p.legacy_uc === false, `Variety+ 58、noise karras、legacy_uc false（${p.skip_cfg_above_sigma} ${p.noise_schedule} ${p.legacy_uc}）`)
check(!('straight_alpha' in p) && !('tag_hint_transparent_background' in p), '没有 straight_alpha / 透明背景')
check(req?.input?.endsWith('very aesthetic, masterpiece, no text') && !/teXt:/.test(req?.input ?? ''), `正面接 V4.5 Full 的质量标签、不自动补 Text（…${req?.input?.slice(-40)}）`)
check(p.characterPrompts?.every((c) => [0.1, 0.3, 0.5, 0.7, 0.9].includes(c.center.x) && [0.1, 0.3, 0.5, 0.7, 0.9].includes(c.center.y)), '角色位置都在格心')

await browser.close()
console.log(errors.length ? `console 报错 ${errors.length}：\n${errors.join('\n')}` : 'console 无报错')
console.log(fails.length ? `\n${fails.length} 项失败：\n${fails.join('\n')}` : '\n全部通过')
process.exit(fails.length || errors.length ? 1 : 0)
