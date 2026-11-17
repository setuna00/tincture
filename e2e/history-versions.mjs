// Keep the network abort even with a fake fetch: a mock miss must never reach paid NovelAI endpoints.
import { chromium } from '@playwright/test'
import { Packr } from 'msgpackr'
import { mkdirSync } from 'node:fs'
import { E2E_URL, isolate, resetStore, settled } from './store.mjs'

const theme = process.argv[2] ?? 'light'
const prefix = process.argv[3] ?? 'hv'
const width = Number(process.argv[4] ?? 1920)
const height = 1000
const out = 'e2e/shots'
mkdirSync(out, { recursive: true })
const url = E2E_URL
const only = process.env.ONLY ?? ''

const browser = await chromium.launch()
const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, acceptDownloads: true })
await isolate(context)
await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(url).origin })
const page = await context.newPage()
const errors = []
page.on('console', (m) => m.type() === 'error' && !/novelai\.net|Failed to load resource/.test(m.text()) && errors.push(m.text()))
page.on('pageerror', (e) => errors.push(String(e)))

const SUB = { tier: 3, active: true, expiresAt: 4102444800, trainingStepsLeft: { fixedTrainingStepsLeft: 1000, purchasedTrainingSteps: 1340 }, usage: { percent: 63, purchasedPercent: 0, timeUntilNextPercent: 4320, isNegative: false } }
const naiHits = []
await context.route(/novelai\.net/, (route) => {
  const u = route.request().url()
  naiHits.push(`${route.request().method()} ${u}`)
  if (u.endsWith('/user/subscription')) return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(SUB) })
  return route.abort()
})
await context.addInitScript(() => {
  const real = window.fetch.bind(window)
  window.fetch = async (input, init) => {
    const u = typeof input === 'string' ? input : input.url
    if (!u.includes('novelai.net/ai/generate-image-stream')) return real(input, init)
    const m = window.__naiMock ?? {}
    const frames = (m.frames ?? []).map((b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)))
    const delay = m.delay ?? 30
    const body = new ReadableStream({
      async start(ctl) {
        for (const f of frames) {
          await new Promise((r) => setTimeout(r, delay))
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
const suffix = `${theme}-${width}`
const file = (name) => `${out}/${prefix}-${name}-${suffix}.png`
const clip = async (loc, name, pad = 0) => {
  await page.mouse.move(2, height - 60)
  await page.waitForTimeout(350)
  const b = await loc.boundingBox()
  await page.screenshot({ path: file(name), clip: { x: Math.max(0, b.x - pad), y: Math.max(0, b.y - pad), width: b.width + pad * 2, height: b.height + pad * 2 } })
  console.log('clip', file(name))
}
const rightCol = () => page.getByTestId('export-panel')

async function open() {
  count = 1
  await page.goto(url)
  await resetStore(page, { theme, prefs: { historyOpen: true, galleryStack: false }, nai: { state: { token: 'pst-test' }, version: 1 } })
  await page.reload()
  await page.waitForSelector('[data-testid=export-panel]', { timeout: 60000 })
  await page.waitForSelector('[data-testid=account-status][data-state=ok]')
  await page.waitForTimeout(400)
  await page.addStyleTag({ content: '[data-sonner-toaster]{visibility:hidden!important}' })
}

let seedNext = 1000
async function makeImages(n) {
  const seed0 = seedNext
  seedNext += 100
  return page.evaluate(
    async ({ n, seed0 }) => {
      const { stealthPayload, writeStealthAlpha } = await import('/src/lib/nai-write.ts')
      const toB64 = async (blob) => {
        const b = new Uint8Array(await blob.arrayBuffer())
        let s = ''
        for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000))
        return btoa(s)
      }
      const finals = []
      for (let i = 0; i < n; i++) {
        const seed = seed0 + i
        const c = new OffscreenCanvas(832, 1216)
        const g = c.getContext('2d')
        const hue = (seed * 37) % 360
        const grd = g.createLinearGradient(0, 0, 832, 1216)
        grd.addColorStop(0, `hsl(${hue} 60% 66%)`)
        grd.addColorStop(1, `hsl(${(hue + 60) % 360} 55% 40%)`)
        g.fillStyle = grd
        g.fillRect(0, 0, 832, 1216)
        g.fillStyle = 'rgba(255,255,255,.85)'
        g.font = '600 92px sans-serif'
        g.textAlign = 'center'
        g.fillText(`s-${seed}`, 416, 608)
        const meta = { Description: '1girl', Software: 'NovelAI', Source: 'NovelAI Diffusion V5 0ADF9AB7', Comment: JSON.stringify({ prompt: '1girl', seed, steps: 23, width: 832, height: 1216 }) }
        const img = g.getImageData(0, 0, 832, 1216)
        writeStealthAlpha(img.data, 832, 1216, await stealthPayload(meta))
        g.putImageData(img, 0, 0)
        finals.push(await toB64(await c.convertToBlob({ type: 'image/webp', quality: 1 })))
      }
      return finals
    },
    { n, seed0 },
  )
}
const packr = new Packr({ useRecords: false })
const frame = (obj) => {
  const body = packr.pack(obj)
  const f = Buffer.alloc(4 + body.length)
  f.writeUInt32BE(body.length, 0)
  body.copy(f, 4)
  return f.toString('base64')
}
const framesFor = (finals, steps = 6) => [
  ...Array.from({ length: steps }, (_, s) => finals.map((_, i) => frame({ event_type: 'intermediate', samp_ix: i, step_ix: s, gen_id: 'g', sigma: 1, image: Buffer.from(finals[i], 'base64') }))).flat(),
  ...finals.map((f, i) => frame({ event_type: 'final', samp_ix: i, gen_id: 'g', image: Buffer.from(f, 'base64') })),
]
const items = () => page.getByTestId('history-item')
await context.addInitScript(() => {
  window.__peCount = async () => {
    const t = await window.__peImport('/src/store/tabs.ts')
    const g = await window.__peImport('/src/store/gen.ts')
    const doc = t.getDocStore(t.useTabs.getState().activeId).getState().doc
    return g.useGen.getState().history[doc.meta.docId]?.length ?? 0
  }
})
const shownCount = () => page.evaluate(() => window.__peCount())
let count = 1
async function generate(n = 1, { delay = 30, wait = true, steps = 6 } = {}) {
  if (n !== count) {
    await setCount(n)
    count = n
  }
  const before = await shownCount()
  await page.evaluate((m) => (window.__naiMock = m), { frames: framesFor(await makeImages(n), steps), delay })
  await page.getByTestId('gen-button').click()
  if (!wait) return
  await page.waitForFunction(async (k) => (await window.__peCount()) === k, before + n, { timeout: 20000 })
  await page.waitForSelector('[data-testid=gen-button]:not([disabled])')
  await page.waitForTimeout(200)
}
const chip = (text) => page.getByTestId('chip').filter({ has: page.locator('.chip-text').getByText(text, { exact: true }) }).first()
async function removeTag(text) {
  await chip(text).click()
  await page.keyboard.press('Delete')
  await page.waitForTimeout(150)
}
const bar = () => page.getByTestId('version-bar')
const barText = async () => ((await bar().count()) ? (await bar().innerText()).replace(/\s+/g, ' ') : '')
const changes = async () => {
  const n = page.getByTestId('version-bar-n')
  if (!(await n.getAttribute('data-changes')) && !(await n.locator('[aria-label="AI 修改"]').count())) return ''
  await page.mouse.move(2, 2)
  await n.hover()
  const tip = page.getByTestId('version-bar-changes-tip').first()
  await tip.waitFor({ timeout: 3000 })
  const t = (await tip.innerText()).replace(/\s+/g, ' ')
  await page.mouse.move(2, 2)
  await page.waitForTimeout(250)
  return t
}
const groups = () => page.getByTestId('history-group').evaluateAll((els) => els.map((e) => ({ v: e.dataset.version, n: e.querySelectorAll('[data-testid=history-item]').length })))
const node = (n) => page.locator(`[data-testid=history-group][data-version="${n}"] [data-testid=history-node]`)
const scrollTop = () => page.getByTestId('gen-scroll').locator('[data-slot=scroll-area-viewport]').evaluate((el) => el.scrollTop)
const dotOn = () =>
  page.evaluate(() => {
    const d = document.querySelector('[data-testid=gen-history] [data-testid=version-dot]')
    if (!d) return ''
    const tag = d.closest('[data-testid=version-tag]')
    return tag.hasAttribute('data-next') ? 'next' : tag.textContent.replace('v', '')
  })
const nextTag = async () => ((await page.getByTestId('history-group-next').count()) ? (await page.getByTestId('history-group-next').getByTestId('version-tag').innerText()).trim() : '')
const footerTag = async () => {
  const t = page.getByTestId('gen-version').getByTestId('version-tag')
  if (!(await t.count())) return ''
  return `${(await t.getAttribute('data-next')) !== null ? 'next' : 'cur'}:${(await t.textContent()).trim()}`
}
const activeDoc = () =>
  page.evaluate(async () => {
    const t = await window.__peImport('/src/store/tabs.ts')
    return t.getDocStore(t.useTabs.getState().activeId).getState().doc
  })
const tipShows = (text) =>
  page.waitForFunction((t) => [...document.querySelectorAll('[data-slot=tooltip-content]')].some((x) => x.textContent.trim() === t), text, { timeout: 2000 }).then(
    () => true,
    () => false,
  )
const waitToast = (text) => page.waitForFunction((t) => [...document.querySelectorAll('[data-sonner-toast]')].some((x) => x.textContent.includes(t)), text, { timeout: 3000 }).then(
  () => true,
  () => false,
)
async function setCount(n) {
  if (await page.getByTestId('params-button').count()) {
    await page.getByTestId('params-button').click()
    await page.getByTestId(`set-count-seg-${n}`).click()
    await page.keyboard.press('Escape')
    await page.waitForSelector('[data-testid=params-panel]', { state: 'detached' })
  } else {
    await page.getByTestId('page-settings').click()
    await page.getByTestId(`set-count-seg-${n}`).click()
    await page.getByTestId('page-image').click()
  }
}

if (!only || only.includes('shots')) {
  const seedWas = seedNext
  seedNext = 1563273200
  await open()
  await generate(2)
  await removeTag('cherry blossoms')
  await generate(1)
  if (await items().nth(1).isVisible()) await items().nth(1).click()
  await page.waitForTimeout(300)
  await clip(rightCol(), 'cmp-column')
  {
    const s = page.getByTestId('version-bar-seed').locator('span').first()
    const cut = await s.evaluate((e) => e.scrollWidth > e.clientWidth)
    check(!cut, `信息条第一行：10 位 seed 不截断（右栏 ${Math.round((await rightCol().boundingBox()).width)}）`)
  }
  await page.screenshot({ path: file('cmp-page') })
  console.log('shot', file('cmp-page'))
  if (await page.getByTestId('right-tab-copy').count()) {
    const histTall = (await page.getByTestId('history-resize').count()) > 0
    if (histTall) {
      await page.getByTestId('history-head').click()
      await page.waitForTimeout(300)
    }
    await page.getByTestId('gen-stage').hover()
    await page.mouse.wheel(0, 600)
    await page.waitForTimeout(400)
    await clip(rightCol(), 'cmp-details')
    await page.getByTestId('gen-scroll').locator('[data-slot=scroll-area-viewport]').evaluate((el) => (el.scrollTop = 0))
    if (histTall) {
      await page.getByTestId('history-head').click()
      await page.waitForTimeout(300)
    }
    await page.getByTestId('params-button').click()
    await page.waitForTimeout(300)
    await clip(rightCol(), 'cmp-params')
    await page.keyboard.press('Escape')
    await page.getByTestId('history-head').click()
    await page.waitForTimeout(300)
    await clip(rightCol(), 'cmp-history-off')
    await page.getByTestId('history-head').click()
    await page.getByTestId('right-tab-copy').click()
    await page.waitForTimeout(400)
    await clip(rightCol(), 'cmp-copy')
    await page.getByTestId('copy-more').click()
    await page.waitForTimeout(250)
    await page.screenshot({ path: file('cmp-copy-menu'), clip: { ...(await rightCol().boundingBox()) } })
    await page.keyboard.press('Escape')
    await page.getByTestId('right-tab-gen').click()
    await page.waitForTimeout(300)
  }
  seedNext = seedWas
}

if (!only || only.includes('flow')) {
  await open()
  check((await page.getByTestId('history-group-next').count()) === 1 && (await nextTag()) === 'v1', `新文档：历史顶上虚线框 v1（${await nextTag()}）`)
  check((await page.locator('[data-testid=history-group-next] [data-testid=version-dot]').count()) === 1, '虚线框带 ●')
  check((await footerTag()) === 'next:v1', `标题行：虚线框 v1（${await footerTag()}）`)
  check((await page.getByTestId('history-empty').count()) === 0, '没有「暂无图片」')
  await generate(1)
  check((await barText()).startsWith('v1') && (await changes()) === '', `第一次出图：信息条 v1，第二行空着（${await barText()}）`)
  const seed1 = await page.getByTestId('gen-image').getAttribute('data-seed')
  check((await page.getByTestId('version-bar-seed').innerText()) === seed1, `信息条的 seed = 这张的 seed（${seed1}）`)
  check((await page.getByTestId('version-bar-index').count()) === 0, '一张时不写第几张')
  check((await page.getByTestId('version-revert').count()) === 0, '这一版就是当前内容：没有「导入 prompt」')
  check((await page.getByTestId('gen-actions').count()) === 0, '图上方没有浮动条')
  check((await page.getByTestId('version-bar-changes').count()) === 0, '改动不常驻（悬停版本号看）')
  check((await page.getByTestId('history-group-next').count()) === 0 && (await dotOn()) === '1', `出了图：虚线框变成真的 v1，● 在 v1（${await dotOn()}）`)
  check((await footerTag()) === 'cur:v1', `标题行：● v1（${await footerTag()}）`)
  check((await page.getByTestId('version-bar-seed').evaluate((e) => getComputedStyle(e).textDecorationStyle)) === 'dashed', 'seed 数字虚线下划线')
  await page.getByTestId('version-bar-seed').hover()
  check(await tipShows('复制 Seed'), '悬停 seed：「复制 Seed」')
  await page.getByTestId('version-bar-seed').click()
  check((await page.evaluate(() => navigator.clipboard.readText())) === seed1, '点 seed 数字复制')
  check((await page.getByTestId('version-bar-seed').getAttribute('data-done')) === '', '复制后数字变色、后面 ✓')
  await generate(1)
  let g = await groups()
  check(g.length === 1 && g[0].v === '1' && g[0].n === 2, `连出两次不改：一版两张（${JSON.stringify(g)}）`)
  check((await page.getByTestId('version-bar-index').innerText()) === '2 / 2', '两张时写「2 / 2」（新的在右）')

  await removeTag('cherry blossoms')
  check((await nextTag()) === 'v2' && (await dotOn()) === 'next', `改了没出图：虚线框 v2 带 ●（${await nextTag()} / ${await dotOn()}）`)
  check((await footerTag()) === 'next:v2', `标题行：虚线框 v2（${await footerTag()}）`)
  check((await page.getByTestId('version-revert').innerText()) === '导入 prompt', '当前内容和 v1 不一样：信息条出「导入 prompt」')
  await clip(rightCol(), 'column-dirty')
  const panelOpen = () => page.locator('[data-testid=params-panel][data-state=open]').count()
  await page.getByTestId('params-button').click()
  await page.waitForSelector('[data-testid=params-panel]')
  await page.waitForTimeout(250)
  const pb = await page.getByTestId('params-panel').boundingBox()
  const sb = await page.getByTestId('gen-scroll').boundingBox()
  check(Math.abs(pb.y - sb.y) < 2 && Math.abs(pb.width - sb.width) < 2 && pb.height > sb.height, `参数面板盖住图区和历史（${Math.round(pb.y)} / ${Math.round(pb.height)}）`)
  check((await page.getByTestId('params-button').getAttribute('aria-pressed')) === 'true', '参数卡片按下的样子')
  await page.getByTestId('set-steps').getByRole('textbox').fill('28')
  await page.keyboard.press('Enter')
  await page.keyboard.press('Escape')
  await page.waitForSelector('[data-testid=params-panel]', { state: 'detached' })
  check(true, '焦点在面板里：Esc 收')
  await page.getByTestId('params-button').click()
  await page.waitForSelector('[data-testid=params-panel]')
  await page.getByTestId('params-button').click()
  await page.waitForSelector('[data-testid=params-panel]', { state: 'detached' })
  check(true, '再点卡片收')
  await page.getByTestId('params-button').click()
  await page.waitForSelector('[data-testid=params-panel]')
  await page.getByTestId('editor-scroll').click({ position: { x: 20, y: 400 } })
  await page.waitForTimeout(300)
  check((await panelOpen()) === 1, '点编辑器：不收')
  await chip('outdoors').click()
  await page.keyboard.press('Escape')
  await page.waitForTimeout(300)
  check((await panelOpen()) === 1 && (await page.locator('[data-testid=chip][data-selected]').count()) === 0, '焦点在编辑器里按 Esc：只退出选中，面板不收')
  await page.getByTestId('right-tab-copy').click()
  await page.waitForTimeout(300)
  check((await panelOpen()) === 1, '切到提示词复制：面板还开着')
  await page.getByTestId('right-tab-gen').click()
  await page.waitForTimeout(300)
  check((await panelOpen()) === 1, '切回图片生成：还开着')
  await generate(1)
  check((await page.getByTestId('params-panel').count()) === 0, '开始出图：面板收起')
  g = await groups()
  check(g.length === 2 && g[0].v === '1' && g[1].v === '2' && (await dotOn()) === '2', `改了再出：新的一版在右、● 在 v2（${JSON.stringify(g)}）`)
  const ch2 = await changes()
  check(ch2.startsWith('与 v1 相比') && ch2.includes('cherry blossoms') && ch2.includes('步数 23 → 28'), `悬停版本号：和 v1 比的改动（${ch2}）`)
  await page.getByTestId('version-bar-n').hover()
  await page.waitForSelector('[data-testid=version-bar-changes-tip]')
  check((await page.locator('[data-testid=version-bar-changes-tip] [data-kind=del]').first().evaluate((e) => getComputedStyle(e).textDecorationLine)) === 'line-through', '删掉的 tag 删除线')
  check((await page.getByTestId('version-bar-changes-tip').first().innerText()).includes('与 v1 相比'), '悬停版本号：写和谁比')
  await page.mouse.move(2, height - 60)
  await clip(bar(), 'bar-v2')
  await clip(rightCol(), 'column-images')

  const doc = await activeDoc()
  const sec = doc.base.prompt.find((s) => s.chips.length)
  const reply = '```json\n' + JSON.stringify({ $schema: 'pe-doc-ai/2', prompt: [{ id: sec.id, tags: [...sec.chips.filter((c) => !c.disabled).map((c) => (c.type === 'artist' ? `artist:${c.text}` : c.text)), 'snow'] }] }) + '\n```'
  await page.evaluate(async (t) => (await window.__peImport('/src/store/ai-import.ts')).importAiText(t, '测试服务', '加上雪'), reply)
  await page.getByTestId('ai-import-apply').click()
  await page.waitForTimeout(400)
  g = await groups()
  check(g.length === 3 && g[2].v === '3' && g[2].n === 0 && (await dotOn()) === '3', `AI 应用后：最右 v3 光一个节点、带 ●（${JSON.stringify(g)}）`)
  check((await page.getByTestId('history-group-next').count()) === 0, 'AI 改完 = 当前内容就是 v3：没有虚线框')
  check((await node(3).locator('[aria-label="AI 修改"]').count()) === 1, 'v3 节点带 ✦')
  await node(3).click()
  await page.waitForTimeout(250)
  check((await page.getByTestId('gen-empty').count()) === 1, '点没图的版本：图区是生成前的框')
  check((await node(3).getAttribute('data-current')) === '', '选中的版本节点描灯黄环')
  const ch3 = await changes()
  check(ch3.includes('加上雪') && !ch3.includes('修改了') && ch3.includes('+snow'), `AI 版本：✦ 要求 · 改动（${ch3}）`)
  check((await page.getByTestId('version-revert').count()) === 0, 'AI 改完：当前内容 = v3，没有「导入 prompt」')
  check((await page.getByTestId('gen-copy').count()) === 0, '没有图的版本：信息条右边没有图片的按钮')
  await clip(rightCol(), 'column-ai-node')
  await clip(bar(), 'bar-ai')
  await generate(1)
  g = await groups()
  check(g[2].v === '3' && g[2].n === 1 && g.length === 3, `AI 改完接着出图：图挂在 v3 下（${JSON.stringify(g)}）`)
  await clip(page.getByTestId('gen-history'), 'history-groups')

  await page.locator('[data-testid=history-group][data-version="1"] [data-testid=history-item]').first().click()
  await page.waitForTimeout(200)
  check((await page.getByTestId('version-bar-n').innerText()) === 'v1', '点 v1 的图：信息条 v1（只是看，编辑器不变）')
  check((await chip('snow').count()) === 1 && (await dotOn()) === '3', '点图不改编辑器：● 还在 v3')
  await page.getByTestId('version-revert').click()
  check(await waitToast('已导入 v1 的 prompt'), 'toast「已导入 v1 的 prompt」')
  check((await chip('cherry blossoms').count()) === 1 && (await chip('snow').count()) === 0, '导入 v1：cherry blossoms 回来了、snow 没了')
  check((await page.getByTestId('doc-title').inputValue()) === doc.meta.title, '标题不变')
  check((await page.getByTestId('version-revert').count()) === 0 && (await dotOn()) === '1', '导入以后：● 到 v1、「导入 prompt」不显示')
  await page.mouse.click(700, 900)
  await page.keyboard.press('Control+z')
  await page.waitForTimeout(200)
  check((await chip('snow').count()) === 1 && (await dotOn()) === '3', 'Ctrl+Z 一步撤回（● 回到 v3）')
  await page.getByTestId('version-revert').click()
  await page.waitForTimeout(150)
  const v1Before = (await groups()).find((x) => x.v === '1').n
  await generate(1)
  g = await groups()
  const nVersions = await page.evaluate(async () => {
    const t = await window.__peImport('/src/store/tabs.ts')
    const v = await window.__peImport('/src/store/versions.ts')
    return v.useVersions.getState().byDoc[t.getDocStore(t.useTabs.getState().activeId).getState().doc.meta.docId].length
  })
  check(nVersions === 3 && g.find((x) => x.v === '1').n === v1Before + 1, `导入 v1 再出图：图归 v1，还是 3 版（${JSON.stringify(g)}）`)
  check((await page.getByTestId('version-bar-n').innerText()) === 'v1', '新图选中、信息条 v1')
  check((await page.locator('[data-testid=history-group][data-version="1"] [data-testid=history-item][data-current]').count()) === 1, '新图在 v1 那一组里描边')
  check(await page.locator('[data-testid=history-item][data-current]').evaluate((e) => {
    const r = e.getBoundingClientRect()
    const box = e.closest('[data-slot=scroll-area-viewport]')?.getBoundingClientRect() ?? document.body.getBoundingClientRect()
    return r.left >= box.left - 1 && r.right <= box.right + 1
  }), '新图滚进视野')
  check(g[0].v === '1' && g[g.length - 1].v === '3', '版本照版本号排（旧的在左）')

  const order = await items().evaluateAll((els) => els.map((e) => e.dataset.id))
  const cur = () => page.locator('[data-testid=history-item][data-current]').getAttribute('data-id')
  await items().first().click()
  await page.keyboard.press('ArrowRight')
  check((await cur()) === order[1], '历史横条 →：右边一张')
  await page.keyboard.press('ArrowRight')
  check((await cur()) === order[2], '历史横条 →：再右一张')
  await page.getByTestId('gen-stage').click({ position: { x: 30, y: 300 } })
  await page.keyboard.press('ArrowLeft')
  check((await cur()) === order[1], '出图区 ←：左边一张')
  await page.keyboard.press('ArrowLeft')
  await page.keyboard.press('ArrowLeft')
  check((await cur()) === order[0], '出图区 ←：到最左停住')

  check((await page.getByTestId('gen-details').count()) === 0, '历史开着：没有详情')
  {
    const st0 = await page.getByTestId('gen-stage').boundingBox()
    const bb0 = await bar().boundingBox()
    const sv0 = await page.getByTestId('gen-scroll').boundingBox()
    check(Math.abs(st0.height + bb0.height - sv0.height) < 2, `历史开着：图 + 信息条 = 可见高度，不留空（${Math.round(st0.height)} + ${Math.round(bb0.height)} / ${Math.round(sv0.height)}）`)
    const box = await bar().evaluate((e) => { const c = getComputedStyle(e); return { t: c.borderTopWidth, l: c.borderLeftWidth, r: c.borderTopLeftRadius, mt: c.marginTop, ml: c.marginLeft, bg: c.backgroundColor } })
    check(box.t === '1px' && box.l === '0px' && box.r === '0px' && box.mt === '0px' && box.ml === '0px' && box.bg === 'rgba(0, 0, 0, 0)', `信息条平铺：上面 1px 线、没有框和外边距、没有底色（${JSON.stringify(box)}）`)
  }
  await page.getByTestId('gen-stage').hover()
  await page.mouse.wheel(0, 3000)
  await page.waitForTimeout(300)
  check((await scrollTop()) === 0, '历史开着：滚不动')
  await page.getByTestId('history-head').click()
  await page.waitForTimeout(400)
  await page.getByTestId('gen-stage').hover()
  await page.mouse.wheel(0, 3000)
  await page.waitForTimeout(400)
  check((await scrollTop()) > 0 && (await page.getByTestId('gen-viewer').getAttribute('data-zoomed')) === null, `历史收起：普通滚轮 = 滚动，不缩放（scrollTop ${await scrollTop()}）`)
  check((await page.getByTestId('gen-details').getByTestId('gallery-prompts').count()) === 1 && (await page.getByTestId('gen-details').getByTestId('gallery-params').count()) === 1, '详情：Prompt 框 + 参数 chip')
  const barTop = (await bar().boundingBox()).y
  const viewTop = (await page.getByTestId('gen-scroll').boundingBox()).y
  check(Math.abs(barTop - viewTop) < 3, `滑到底：信息条贴在顶上（${Math.round(barTop)} / ${Math.round(viewTop)}）`)
  await clip(rightCol(), 'column-details')
  await page.getByTestId('gen-scroll').locator('[data-slot=scroll-area-viewport]').evaluate((el) => (el.scrollTop = 0))
  await page.waitForTimeout(200)
  const st = await page.getByTestId('gen-stage').boundingBox()
  const bb = await bar().boundingBox()
  const sv = await page.getByTestId('gen-scroll').boundingBox()
  check(Math.abs(st.height + bb.height - sv.height) < 2, `历史收起：图 + 信息条 = 可见高度，不留空（${Math.round(st.height)} + ${Math.round(bb.height)} / ${Math.round(sv.height)}）`)
  await page.getByTestId('gen-stage').hover()
  await page.keyboard.down('Control')
  await page.mouse.wheel(0, -200)
  await page.keyboard.up('Control')
  await page.waitForTimeout(150)
  check((await page.getByTestId('gen-viewer').getAttribute('data-zoomed')) === '' && (await scrollTop()) === 0, 'Ctrl+滚轮 = 缩放图，不滚动')
  await page.getByTestId('history-head').click()
  await page.waitForTimeout(400)

  const stripH = () => page.evaluate(() => Math.round(document.querySelector('#history-panel').getBoundingClientRect().height) - 28)
  const thumbH = () => items().first().evaluate((e) => Math.round(e.getBoundingClientRect().height))
  const histPref = () => page.evaluate(async () => (await window.__peImport('/src/store/prefs.ts')).usePrefs.getState().historyH)
  check((await stripH()) === 124 && (await thumbH()) === 112, `横条默认 124，缩略图 112（${await stripH()} / ${await thumbH()}）`)
  {
    const lb = await page.getByTestId('history-list').boundingBox()
    const ib = await items().first().boundingBox()
    const top = Math.round(ib.y - lb.y)
    const bottom = Math.round(lb.y + lb.height - ib.y - ib.height)
    check(Math.abs(top - 6) <= 1 && Math.abs(bottom - 6) <= 1, `缩略图在横条里上下各留 6（上 ${top} / 下 ${bottom}），灯黄环不被切`)
  }
  const rb = await page.getByTestId('history-resize').boundingBox()
  await page.mouse.move(rb.x + 200, rb.y + rb.height / 2 + 3)
  await page.waitForTimeout(250)
  check((await page.getByTestId('history-resize').getAttribute('data-separator')) === 'hover', '悬停上边线（偏 3px 也算）：可以拖')
  const glow = await page.getByTestId('history-resize').evaluate((e) => getComputedStyle(e, '::after').backgroundColor)
  check(glow !== 'rgba(0, 0, 0, 0)', `悬停：边线亮起来（${glow}）`)
  await page.mouse.move(rb.x + 200, rb.y + rb.height / 2)
  await page.mouse.down()
  await page.mouse.move(rb.x + 200, rb.y - 30, { steps: 4 })
  const midH = await stripH()
  await page.mouse.move(rb.x + 200, rb.y - 60, { steps: 4 })
  await page.mouse.up()
  await page.waitForTimeout(300)
  const region = await page.getByTestId('gen-scroll').evaluate((e) => Math.round(e.closest('[data-group]').getBoundingClientRect().height))
  const hmax = Math.min(240, Math.round(region * 0.35))
  const near = (a, b) => Math.abs(a - b) <= 2
  check(near(midH, 154) && near(await stripH(), Math.min(184, hmax)) && (await thumbH()) === (await stripH()) - 12, `拖的时候实时变（中途 ${midH}），松手 ${await stripH()}，缩略图 ${await thumbH()}`)
  check((await histPref()) === (await stripH()), `记进偏好（${await histPref()}）`)
  const rb2 = await page.getByTestId('history-resize').boundingBox()
  await page.mouse.move(rb2.x + 200, rb2.y + 1)
  await page.mouse.down()
  await page.mouse.move(rb2.x + 200, rb2.y - 400, { steps: 6 })
  await page.mouse.up()
  await page.waitForTimeout(300)
  check((await stripH()) === hmax, `往上拖过头：最大 ${hmax}（那一块 ${region} 的 35%、≤ 240）`)
  await clip(rightCol(), 'history-tall')
  await page.setViewportSize({ width, height: 700 })
  await page.waitForTimeout(400)
  const short = await stripH()
  check(short < hmax && (await histPref()) === hmax, `窗口变矮：横条压到 ${short}，记住的还是 ${await histPref()}`)
  await page.setViewportSize({ width, height })
  await page.waitForTimeout(400)
  check((await stripH()) === hmax, '窗口变回来：恢复')
  const rb3 = await page.getByTestId('history-resize').boundingBox()
  await page.evaluate(() => {
    window.__th = []
    const t0 = performance.now()
    const tick = () => {
      window.__th.push([Math.round(document.querySelector('#history-panel').getBoundingClientRect().height) - 28, document.querySelector('.hist-split').hasAttribute('data-animate')])
      if (performance.now() - t0 < 500) requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  })
  await page.mouse.dblclick(rb3.x + 200, rb3.y + 1)
  await page.waitForTimeout(600)
  const th = await page.evaluate(() => window.__th)
  check((await stripH()) === 124 && (await histPref()) === 124 && th.some(([h, an]) => an && h > 125), `双击回 124，过渡中（${[...new Set(th.map(([h]) => h))].slice(0, 8).join(' ')}）`)

  await page.getByTestId('history-expand').click()
  await page.waitForSelector('[data-testid=history-grid]')
  await page.waitForTimeout(300)
  const gb = await page.getByTestId('history-grid').boundingBox()
  const sb2 = await page.getByTestId('gen-scroll').boundingBox()
  check(Math.abs(gb.y - sb2.y) < 2 && gb.height > sb2.height, '展开全部：盖住图区和历史')
  check((await page.getByTestId('history-grid-count').innerText()).includes(`${await items().count()} 张`), `头一行写张数（${await page.getByTestId('history-grid-count').innerText()}）`)
  const gv = await page.getByTestId('history-grid-group').evaluateAll((els) => els.map((e) => e.dataset.version))
  check(gv[0] === String(Math.max(...gv.map(Number))), `新的版本在上（${gv.join(',')}）`)
  const gh0 = await page.getByTestId('history-grid-item').first().evaluate((e) => Math.round(e.getBoundingClientRect().height))
  await page.getByTestId('history-grid-item').first().hover()
  await page.keyboard.down('Control')
  await page.mouse.wheel(0, -100)
  await page.keyboard.up('Control')
  await page.waitForTimeout(200)
  const gh1 = await page.getByTestId('history-grid-item').first().evaluate((e) => Math.round(e.getBoundingClientRect().height))
  check(gh0 === 112 && gh1 > gh0, `缩略图 112，Ctrl+滚轮放大（${gh0} → ${gh1}）`)
  await clip(rightCol(), 'history-grid')
  const pickId = await page.getByTestId('history-grid-item').last().getAttribute('data-id')
  await page.getByTestId('history-grid-item').last().click()
  await page.waitForSelector('[data-testid=history-grid]', { state: 'detached' })
  check((await page.locator('[data-testid=history-item][data-current]').getAttribute('data-id')) === pickId, '点一张：选中这张、收回')
  await page.getByTestId('history-expand').click()
  await page.waitForSelector('[data-testid=history-grid]')
  await page.keyboard.press('Escape')
  await page.waitForSelector('[data-testid=history-grid]', { state: 'detached' })
  check(true, 'Esc 收回')
  await page.evaluate(async () => (await window.__peImport('/src/store/prefs.ts')).usePrefs.getState().set({ historyGridH: 112 }))

  const last = order[order.length - 1]
  await generate(1, { delay: 60, wait: false, steps: 30 })
  await page.waitForSelector('[data-testid=gen-running]')
  await page.waitForTimeout(400)
  check((await page.locator('[data-testid=history-pending][data-current]').count()) === 1 && (await page.locator('[data-testid=history-item][data-current]').count()) === 0, '出图开始：环在占位格上，上一张没有环')
  await page.waitForFunction(() => (document.querySelector('[data-testid=gen-button] [data-testid=progress-fill]')?.getBoundingClientRect().width ?? 0) > 0, null, { timeout: 5000 }).catch(() => {})
  const btn = await page.getByTestId('gen-button').evaluate((e) => ({ op: getComputedStyle(e).opacity, run: e.hasAttribute('data-running'), fill: Math.round(e.querySelector('[data-testid=progress-fill]')?.getBoundingClientRect().width ?? -1) }))
  check(btn.run && btn.op === '1' && btn.fill > 0, `生成按钮：不是置灰的样子，底下一层走进度（${JSON.stringify(btn)}）`)
  await clip(page.getByTestId('gen-footer'), 'button-running')
  await page.locator(`[data-testid=history-item][data-id="${last}"]`).click()
  await page.waitForTimeout(150)
  check((await page.getByTestId('gen-running').count()) === 0 && (await page.getByTestId('gen-image').count()) === 1, '出图中点旧图：图区显示那张（不被出图中的画面盖住）')
  await page.waitForSelector('[data-testid=gen-button]:not([disabled])', { timeout: 20000 })
  await page.waitForTimeout(300)
  check((await page.locator('[data-testid=history-item][data-current]').getAttribute('data-id')) === last, '出完不跳：还是点的那张')
  check((await items().count()) === order.length + 1, '新图照样进了历史')
  const vp = page.getByTestId('history-list').locator('[data-slot=scroll-area-viewport]')
  const idsBefore = await items().evaluateAll((els) => els.map((e) => e.dataset.id))
  await generate(1, { delay: 120, wait: false })
  await page.waitForSelector('[data-testid=history-pending]')
  await page.waitForTimeout(500)
  const atStart = await vp.evaluate((e) => [Math.round(e.scrollLeft), e.scrollWidth - e.clientWidth])
  await page.getByTestId('history-list').hover()
  await page.mouse.wheel(0, -2000)
  await page.waitForTimeout(200)
  const scrolled = await vp.evaluate((e) => Math.round(e.scrollLeft))
  await page.waitForSelector('[data-testid=gen-button]:not([disabled])', { timeout: 20000 })
  await page.waitForTimeout(500)
  const after = await vp.evaluate((e) => Math.round(e.scrollLeft))
  const newest = (await items().evaluateAll((els) => els.map((e) => e.dataset.id))).find((id) => !idsBefore.includes(id))
  check(atStart[1] > 0 && atStart[0] > 0 && scrolled === 0 && after === 0, `出图开始滚到占位格（${atStart[0]} / ${atStart[1]}），自己往回滚了以后出完不再拉回去（${after}）`)
  check(!!newest && (await page.locator('[data-testid=history-item][data-current]').getAttribute('data-id')) === newest && (await page.getByTestId('gen-image').count()) === 1, '…出完环落在新图上，图区显示新图')
  await vp.evaluate((e) => (e.scrollLeft = e.scrollLeft > 0 ? 0 : e.scrollWidth))
  await page.getByTestId('gen-stage').click({ position: { x: 30, y: 300 } })
  await page.keyboard.press('ArrowLeft')
  await page.waitForTimeout(300)
  const inView = await page.locator('[data-testid=history-item][data-current]').evaluate((e) => {
    const r = e.getBoundingClientRect()
    const b = e.closest('[data-slot=scroll-area-viewport]').getBoundingClientRect()
    return [r.left >= b.left - 1 && r.right <= b.right + 1, Math.round(r.left), Math.round(r.right), Math.round(b.left), Math.round(b.right)]
  })
  check(inView[0], `再按 ← ：横条跟着选中滚过去（${JSON.stringify(inView)}）`)

  const nItems = await items().count()
  await page.keyboard.press('Control+s')
  await page.waitForTimeout(200)
  await page.getByTestId('tab').first().getByTestId('close-tab').click()
  await page.getByTestId('start-page').waitFor()
  await page.getByTestId('start-doc').first().getByRole('button').first().click()
  await page.waitForSelector('[data-testid=history-item]')
  await page.waitForTimeout(300)
  check((await items().count()) === nItems, `从我的文档重开：历史还在（${await items().count()} 张）`)
  await removeTag('cherry blossoms')
  await page.getByTestId('tab').first().getByTestId('close-tab').click()
  await page.getByTestId('confirm-dialog').waitFor()
  await page.getByTestId('confirm-discard').click()
  await page.getByTestId('start-page').waitFor()
  await page.waitForTimeout(300)
  await page.getByTestId('start-doc').first().getByRole('button').first().click()
  await page.waitForSelector('[data-testid=history-item]')
  check((await items().count()) === nItems, '我的文档那份：历史还在')
  const firstDocId = (await activeDoc()).meta.docId
  await page.getByTestId('new-tab').click()
  await page.getByTestId('start-recent').first().getByRole('button').first().click()
  await page.waitForTimeout(400)
  const second = await activeDoc()
  check(second.meta.docId !== firstDocId && second.meta.forkedFrom?.docId === firstDocId, `同一 docId 开两份：后开的换新 docId、记 forkedFrom（${second.meta.docId}）`)
  check((await items().count()) === 0, '后开的那份：历史为空')
  await page.getByTestId('tab').last().getByTestId('close-tab').click()
  await page.getByTestId('confirm-dialog').waitFor()
  await page.getByTestId('confirm-discard').click()
  await page.waitForTimeout(300)
  await removeTag('cherry blossoms')
  await page.getByTestId('tab').first().getByTestId('close-tab').click()
  await page.getByTestId('confirm-dialog').waitFor()
  await page.getByTestId('confirm-discard').click()
  await page.getByTestId('start-page').waitFor()
  await page.waitForTimeout(300)
  await page.getByTestId('start-recent').first().getByRole('button').first().click()
  await page.waitForSelector('[data-testid=history-item]')
  check((await activeDoc()).meta.docId === firstDocId && (await items().count()) === nItems, '从最近关闭重开：同一个 docId、历史还在')

  const title = (await activeDoc()).meta.title
  await page.getByTestId('fork-tab').click()
  await page.waitForTimeout(300)
  check((await items().count()) === 0, 'fork：新文档历史为空')
  await generate(1)
  check((await page.getByTestId('version-bar-n').innerText()) === 'v1', 'fork 后第一次出图：v1')
  await page.getByTestId('version-bar-n').hover()
  await page.waitForSelector('[data-testid=version-bar-changes-tip]')
  const tipf = await page.getByTestId('version-bar-changes-tip').first().innerText()
  check(tipf.includes(`与「${title}」v`), `fork 的第一版：悬停写和「${title}」那一版比（${tipf.split('\n')[0]}）`)
  await page.mouse.move(2, height - 60)
  await clip(bar(), 'bar-fork')

  await page.getByTestId('tab').first().click()
  await page.waitForTimeout(200)
  const target = await items().nth(2).getAttribute('data-id')
  await page.getByTestId('tab').last().click()
  await page.evaluate(() => (location.hash = '/gallery'))
  await page.waitForSelector('[data-testid=gallery-grid]')
  await page.locator(`[data-gid="${target}"]`).click()
  await page.waitForTimeout(250)
  check(!/^v\d+/.test(await page.getByTestId('gallery-detail-title').innerText()) && /版本\s*v\d+/.test(await page.getByTestId('gallery-props').innerText()), `图库右栏：标题是文档名，版本在属性里（${await page.getByTestId('gallery-detail-title').innerText()}）`)
  check((await page.getByTestId('gallery-open-version').count()) === 0 && (await page.getByTestId('gallery-open-editor').count()) === 0, '图库右栏：没有「在新标签页打开」「在编辑器中打开」')
  await page.getByTestId('gallery-open').hover()
  check(await page.waitForFunction(() => [...document.querySelectorAll('[data-slot=tooltip-content]')].some((x) => /^跳至「.+」，在历史中选中此图$/.test(x.textContent.trim())), null, { timeout: 2000 }).then(() => true, () => false), '悬停「打开」：跳至「文档名」，在历史中选中此图')
  await clip(page.getByTestId('gallery-detail'), 'gallery-detail', 0)
  await page.getByTestId('gallery-open').click()
  await page.waitForSelector('[data-testid=gen-scroll]')
  await page.waitForTimeout(400)
  const opened = await activeDoc()
  check(opened.meta.docId === firstDocId, '打开：切到那份文档的 tab')
  check((await page.locator('[data-testid=history-item][data-current]').getAttribute('data-id')) === target, '打开：历史里选中这张')
  await page.keyboard.press('Control+s')
  await page.getByTestId('tab').first().getByTestId('close-tab').click()
  await page.waitForTimeout(300)
  const tabsBefore = await page.getByTestId('tab').count()
  await page.evaluate(() => (location.hash = '/gallery'))
  await page.waitForSelector('[data-testid=gallery-grid]')
  await page.locator(`[data-gid="${target}"]`).click({ button: 'right' })
  const menu = await page.getByTestId('gallery-menu').innerText()
  check(menu.includes('打开') && !menu.includes('新标签页') && !menu.includes('编辑器'), `右键菜单只有「打开」（${menu.replace(/\s+/g, ' ')}）`)
  await page.getByTestId('gallery-menu-open').click()
  await page.waitForSelector('[data-testid=history-item]')
  await page.waitForTimeout(400)
  check((await activeDoc()).meta.docId === firstDocId && (await page.getByTestId('tab').count()) === tabsBefore + 1, '关掉以后「打开」：从我的文档打开同一份')
  check((await page.locator('[data-testid=history-item][data-current]').getAttribute('data-id')) === target, '…并选中这张')
  check((await page.locator('[data-testid=tab][data-active][data-unsaved]').count()) === 0, '…打开的是存的那份（没有 ●，没自动恢复）')
  await items().first().click({ button: 'right' })
  const hm = await page.getByTestId('history-menu').innerText()
  check(hm.includes('导入 prompt') && hm.includes('移至回收站') && !hm.includes('新标签页') && !hm.includes('fork'), `历史右键：导入 prompt · 复制 · 下载 · 移至回收站（${hm.replace(/\s+/g, ' ')}）`)
  await page.keyboard.press('Escape')

  await page.evaluate(() => (location.hash = '/gallery'))
  await page.waitForSelector('[data-testid=gallery-grid]')
  const imported = await page.evaluate(async () => {
    const { naiImageBlob } = await import('/src/lib/nai-write.ts')
    const { blankDoc } = await import('/src/store/sample.ts')
    const { parsePrompt, toChip } = await import('/src/lib/nai.ts')
    const { importToGallery } = await window.__peImport('/src/store/gallery.ts')
    const d = blankDoc('x')
    d.base.prompt[0].chips = parsePrompt('1girl, inpainting test').map((c, i) => ({ ...toChip(c), id: `d${i}` }))
    d.settings.gen.seed = 777
    const png = await naiImageBlob(d)
    return (await importToGallery([new File([png], 'NAI 局部重绘.png', { type: 'image/png' })]))[0]
  })
  await page.locator(`[data-gid="${imported}"]`).click()
  await page.waitForTimeout(250)
  const tabsB = await page.getByTestId('tab').count()
  await page.getByTestId('gallery-open').click()
  await page.waitForSelector('[data-testid=gen-scroll]')
  await page.waitForSelector('[data-testid=history-item]')
  await page.waitForTimeout(400)
  const newDoc = await activeDoc()
  const tabsA = await page.getByTestId('tab').count()
  console.log('tabs', tabsB, '→', tabsA)
  check(newDoc.meta.title === 'NAI 局部重绘' && newDoc.meta.docId !== firstDocId && !newDoc.meta.forkedFrom, `导入的图「打开」：开一份新文档「${newDoc.meta.title}」`)
  g = await groups()
  check(g.length === 1 && g[0].v === '1' && g[0].n === 1 && (await page.locator('[data-testid=history-item][data-current]').getAttribute('data-id')) === imported, `…这张图在它的 v1 下、选中（${JSON.stringify(g)}）`)
  check((await dotOn()) === '1', '…当前内容就是 v1（●）')
  await page.evaluate(() => (location.hash = '/gallery'))
  await page.waitForSelector('[data-testid=gallery-grid]')
  await page.waitForTimeout(300)
  check((await page.locator('[data-scope="doc:imported"]').count()) === 0, '图库：「导入的图」那一组没了（归到新文档）')
  await page.locator(`[data-gid="${imported}"]`).click()
  check((await page.getByTestId('gallery-detail-title').innerText()) === 'NAI 局部重绘' && /版本\s*v1/.test(await page.getByTestId('gallery-props').innerText()), `图库右栏：NAI 局部重绘，属性里版本 v1（${await page.getByTestId('gallery-detail-title').innerText()}）`)
  await page.getByTestId('gallery-open').click()
  await page.waitForSelector('[data-testid=gen-scroll]')
  await page.waitForTimeout(300)
  check((await page.getByTestId('tab').count()) === tabsA && (await activeDoc()).meta.docId === newDoc.meta.docId, '再「打开」：切过去，不再开新的')
  await page.reload()
  await page.waitForSelector('[data-testid=history-item]')
  await page.waitForTimeout(300)
  check((await items().count()) === 1 && (await groups())[0].v === '1', '刷新后：这张图还在新文档的 v1 下（写进图库文件夹了）')
}

if ((!only || only.includes('narrow')) && width < 1600) {
  await open()
  await generate(1)
  await removeTag('cherry blossoms')
  await generate(1)
  const box = (id) => page.getByTestId(id).boundingBox()
  const w0 = (await box('export-panel')).width
  check(Math.round(w0) >= 360 && (await box('editor-scroll')).width >= 300, `窄窗口：图片生成 ${Math.round(w0)}、编辑区 ${Math.round((await box('editor-scroll')).width)}`)
  check((await page.getByTestId('version-bar-n').innerText()) === 'v2', '窄窗口：信息条照常')
  check((await page.getByTestId('history-head').getAttribute('aria-expanded')) === 'true', '历史标题行：开着')
  const stage1 = (await box('gen-stage')).height
  const sh = await page.evaluate(() => Math.round(document.querySelector('#history-panel').getBoundingClientRect().height) - 28)
  await clip(rightCol(), 'narrow-open')
  await page.getByTestId('history-head').click()
  await page.waitForTimeout(400)
  const stage2 = (await box('gen-stage')).height
  check(Math.round(stage2 - stage1) === sh && Math.abs((await box('export-panel')).width - w0) < 1, `收起：图高 +${sh}（${Math.round(stage1)} → ${Math.round(stage2)}），宽度不变`)
  check(Math.round((await box('gen-history')).height) === 28, '收起后只剩标题行（28 高）')
  await page.waitForTimeout(250)
  const vis = await page.getByTestId('gen-version').evaluate((e) => getComputedStyle(e).visibility === 'visible' && getComputedStyle(e).opacity === '1')
  check(vis && (await footerTag()) === 'cur:v2', `收起后标题行写当前版本（${await footerTag()}）`)
  const top = await page.getByTestId('history-resize').evaluate((e) => ({ shadow: getComputedStyle(e, '::before').boxShadow, z: getComputedStyle(e).zIndex, line: getComputedStyle(e).backgroundColor, h: e.getBoundingClientRect().height }))
  check((await page.getByTestId('gen-scroll').getAttribute('class')).includes('x-scroll') && top.shadow !== 'none' && top.z === '10' && top.h === 1, `渐隐 + 固定区顶上的阴影（${JSON.stringify(top)}）`)
  await clip(rightCol(), 'narrow-closed')
  await page.getByTestId('history-head').click()
  await page.waitForTimeout(400)
  check(Math.round((await box('gen-stage')).height) === Math.round(stage1), '⏱ 再点：展开回横条')
  await page.reload()
  await page.waitForSelector('[data-testid=history-item]')
  check((await page.getByTestId('history-head').getAttribute('aria-expanded')) === 'true', '刷新：还是展开（偏好 historyOpen）')
}

if (!only || only.includes('legacy')) {
  await open()
  const docId = (await activeDoc()).meta.docId
  await page.evaluate(async (docId) => {
    const { imageStore, settleWrites } = await window.__peImport('/src/store/storage.ts')
    const t = await window.__peImport('/src/store/tabs.ts')
    const doc = t.getDocStore(t.useTabs.getState().activeId).getState().doc
    const cv = new OffscreenCanvas(64, 96)
    cv.getContext('2d').fillRect(0, 0, 64, 96)
    const blob = await cv.convertToBlob({ type: 'image/webp' })
    const put = (id, batch, at, d) => imageStore.put({ id, tabId: docId, batch, index: 0, createdAt: at, seed: at % 1000, width: 64, height: 96, model: 'nai-diffusion-5-full', mime: blob.type, size: blob.size, doc: d }, blob)
    const a = structuredClone(doc)
    const a2 = structuredClone(doc)
    a2.settings.gen.seed = 42
    const b = structuredClone(doc)
    b.base.prompt[0].chips = b.base.prompt[0].chips.slice(1)
    await put('img_l1', 'b1', 1000, a)
    await put('img_l2', 'b2', 2000, a2)
    await put('img_l3', 'b3', 3000, b)
    await put('img_l4', 'b4', 4000, structuredClone(doc))
    await settleWrites()
  }, docId)
  await page.evaluate(() => fetch('/api/test/reopen', { method: 'POST' }))
  await page.reload()
  await page.waitForSelector('[data-testid=history-item]')
  await page.waitForTimeout(300)
  const g = await groups()
  check(JSON.stringify(g.map((x) => [x.v, x.n])) === JSON.stringify([['1', 3], ['2', 1]]), `老图：内容一样的并成一版（改回来的也归 v1）（${JSON.stringify(g)}）`)
  await settled(page)
}

console.log(fails.length ? `\n${fails.length} FAIL` : '\nall ok', 'errors', errors.length ? errors : 'none', 'nai hits', naiHits.filter((h) => !h.endsWith('/user/subscription')))
await browser.close()
