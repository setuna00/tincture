// Keep the network abort even with a fake fetch: a mock miss must never reach paid NovelAI endpoints.
import { chromium } from '@playwright/test'
import { mkdirSync, readFileSync } from 'node:fs'
import { E2E_URL, isolate, resetStore } from './store.mjs'

const theme = process.argv[2] ?? 'light'
const prefix = process.argv[3] ?? 'ref-files'
const width = Number(process.argv[4] ?? 1600)
const height = 960
const out = 'e2e/shots'
mkdirSync(out, { recursive: true })

const browser = await chromium.launch()
const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, acceptDownloads: true })
await isolate(context)
await context.route(/novelai\.net/, (route) => route.abort())
await context.addInitScript(() => {
  const real = window.fetch.bind(window)
  let fake = null
  window.__naiRequests = []
  window.fetch = async (input, init) => {
    const u = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if (!u.includes('novelai.net')) return real(input, init)
    if (!fake) {
      const mine = window.fetch
      fake = import('/scripts/try-nai-fake.js').then(() => {
        const theirs = window.fetch
        window.fetch = mine
        return theirs
      })
    }
    return (await fake)(input, init)
  }
})
const page = await context.newPage()
const errors = []
page.on('console', (m) => m.type() === 'error' && !/novelai\.net|Failed to load resource/.test(m.text()) && errors.push(m.text()))
page.on('pageerror', (e) => errors.push(String(e)))

const fails = []
const check = (ok, msg) => (ok ? console.log('ok  ', msg) : (fails.push(msg), console.log('FAIL', msg)))
const suffix = `${theme}-${width}`
const clip = async (loc, name, pad = 0) => {
  await page.waitForTimeout(300)
  const b = await loc.boundingBox()
  const file = `${out}/${prefix}-${name}-${suffix}.png`
  await page.screenshot({ path: file, clip: { x: Math.max(0, b.x - pad), y: Math.max(0, b.y - pad), width: b.width + pad * 2, height: b.height + pad * 2 } })
  console.log('clip', file)
}
const tid = (id) => page.getByTestId(id)
const requests = () => page.evaluate(() => window.__naiRequests)
const idle = () => page.waitForFunction(() => !document.querySelector('[data-testid=gen-button][data-running]'), null, { timeout: 30000 })
const settings = () =>
  page.evaluate(async () => {
    const { getDocStore, useTabs } = await window.__peImport('/src/store/tabs.ts')
    return getDocStore(useTabs.getState().activeId).getState().doc.settings
  })
const toastText = async () => (await page.locator('[data-sonner-toast]').allInnerTexts().catch(() => [])).join(' | ').replace(/\s+/g, ' ')
const clearToasts = async () => {
  await page.evaluate(async () => (await window.__peImport('/node_modules/.vite/deps/sonner.js').catch(() => null))?.toast.dismiss())
  await page.waitForTimeout(450)
}
const generate = async () => {
  await page.evaluate(() => (window.__naiRequests.length = 0))
  await tid('gen-button').click()
  await idle()
  await page.waitForTimeout(300)
  return requests()
}

const pngB64 = (hue) =>
  page.evaluate(async (hue) => {
    const c = new OffscreenCanvas(300, 400)
    const g = c.getContext('2d')
    g.fillStyle = `hsl(${hue} 60% 60%)`
    g.fillRect(0, 0, 300, 400)
    g.fillStyle = '#fff8'
    g.beginPath()
    g.arc(150, 150, 60, 0, 7)
    g.fill()
    const b = new Uint8Array(await (await c.convertToBlob({ type: 'image/png' })).arrayBuffer())
    let s = ''
    for (const x of b) s += String.fromCharCode(x)
    return btoa(s)
  }, hue)
const sha = (s) => page.evaluate(async (s) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))].map((b) => b.toString(16).padStart(2, '0')).join(''), s)
const ENC_DATA = Buffer.from('fake-encoding-from-nai').toString('base64')
const naiVibe = async (img, strength = 0.45, enc = ENC_DATA) => ({
  identifier: 'novelai-vibe-transfer',
  version: 1,
  type: 'image',
  image: img,
  id: await sha(img),
  encodings: { 'v4-5full': { [await sha('information_extracted:0.7')]: { encoding: enc, params: { information_extracted: 0.7 } } } },
  name: 'test',
  createdAt: Date.now(),
  importInfo: { model: 'nai-diffusion-4-5-full', information_extracted: 0.7, strength },
})
const file = (name, obj) => ({ name, mimeType: '', buffer: Buffer.from(typeof obj === 'string' ? obj : JSON.stringify(obj)) })
const pickFiles = async (kind, files) => {
  await tid('refs-add').click()
  await page.waitForSelector(`[data-testid=refs-add-${kind}]`)
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), tid(`refs-add-${kind}`).click()])
  await chooser.setFiles(files)
  await page.waitForTimeout(800)
  return chooser
}
const download = async (click) => {
  const [d] = await Promise.all([page.waitForEvent('download'), click()])
  return { name: d.suggestedFilename(), bytes: readFileSync(await d.path()) }
}
const dropFiles = async (files) => {
  await page.evaluate(async (files) => {
    const dt = new DataTransfer()
    for (const f of files) dt.items.add(new File([Uint8Array.from(atob(f.b64), (c) => c.charCodeAt(0))], f.name, { type: f.type }))
    for (const t of ['dragenter', 'dragover', 'drop']) window.dispatchEvent(new DragEvent(t, { dataTransfer: dt, bubbles: true, cancelable: true }))
  }, files)
  await page.waitForTimeout(800)
}

await page.goto(E2E_URL)
await page.waitForLoadState('networkidle')
await page.waitForTimeout(500)
await resetStore(page, { theme, nai: { state: { token: 'pst-test' }, version: 1 } })
await page.reload()
await page.waitForSelector('[data-testid=account-status][data-state=ok]', { timeout: 60000 })
await page.waitForTimeout(400)

await tid('refs-add').click()
await page.waitForSelector('[data-testid=refs-add-vibe]')
check((await tid('refs-add-vibe').innerText()).includes('图片、.naiv4vibe 或 .naiv4vibebundle，可多选'), '添加菜单：Vibe 的说明')
check((await tid('refs-add-character').innerText()).includes('图片或 ZIP'), '添加菜单：精准参考的说明')
await page.waitForTimeout(300)
await clip(page.locator('[role=menu][data-state=open]'), '1-add-menu', 4)
await page.keyboard.press('Escape')
await page.waitForTimeout(400)

const imgA = await pngB64(20)
const imgB = await pngB64(200)
const vibeA = await naiVibe(imgA)
const chooser = await pickFiles('vibe', [file('夕阳.naiv4vibe', vibeA)])
check(chooser.isMultiple(), 'Vibe 的文件框可多选')
let s = await settings()
check(s.model === 'v45-full' && s.vibes?.length === 1 && s.vibes[0].strength === 0.45 && s.vibes[0].informationExtracted === 0.7, `导入：V4.5 Full、强度 0.45、信息量 0.7（${s.model} ${JSON.stringify(s.vibes?.map((v) => [v.strength, v.informationExtracted]))}）`)
check((await toastText()).includes('已导入 1 张 Vibe Transfer，模型已切换为 V4.5 Full'), `toast：${await toastText()}`)
check((await tid('ref-cost').count()) === 0 && (await tid('refs-vibe-price').count()) === 0, '文件带了编码：不显示要花钱')
await page.locator('[data-sonner-toast] button', { hasText: '撤销' }).last().click()
await page.waitForTimeout(300)
s = await settings()
check(s.model === 'v5-full' && !s.vibes?.length, `撤销：V5 Full、没有 Vibe（${s.model}）`)
await clearToasts()

const bundle = { identifier: 'novelai-vibe-transfer-bundle', version: 1, vibes: [vibeA, await naiVibe(imgB, 0.6, Buffer.from('enc-b').toString('base64'))] }
await pickFiles('vibe', [file('夕阳.naiv4vibe', vibeA), file('两张.naiv4vibebundle', bundle)])
s = await settings()
check(s.vibes?.length === 2, `.naiv4vibe + bundle：同一张不再加，共 2 张（${s.vibes?.length}）`)
check((await toastText()).includes('已导入 2 张 Vibe Transfer'), `toast：${await toastText()}`)
let reqs = await generate()
const gen1 = reqs.find((r) => r.url === 'ai/generate-image-stream')?.req.parameters
check(!reqs.some((r) => r.url === 'ai/encode-vibe'), '生成：文件带的编码直接用，不调编码接口')
check(JSON.stringify(gen1?.reference_strength_multiple) === JSON.stringify([0.45 / 1.05, 0.6 / 1.05]) && gen1?.normalize_reference_strength_multiple === true, `平衡强度开着：0.45 + 0.6 按比例缩到 1（${JSON.stringify(gen1?.reference_strength_multiple)}）`)

check((await tid('refs-normalize-check').getAttribute('data-state')) === 'checked', '平衡强度默认勾着')
await tid('refs-normalize-check').click()
await page.waitForTimeout(200)
s = await settings()
check(s.gen.normalizeRefs === false, '取消勾：gen.normalizeRefs = false')
reqs = await generate()
const gen2 = reqs.find((r) => r.url === 'ai/generate-image-stream')?.req.parameters
check(JSON.stringify(gen2?.reference_strength_multiple) === '[0.45,0.6]' && gen2?.normalize_reference_strength_multiple === false, `关了：强度原样发（${JSON.stringify(gen2?.reference_strength_multiple)}）`)
await page.keyboard.press('Control+z')
await page.waitForTimeout(200)
check((await settings()).gen.normalizeRefs !== false, 'Ctrl+Z：平衡强度回到开')
await page.mouse.move(2, height - 40)
await clearToasts()
await clip(tid('box-refs'), '2-box', 8)

const encOnlyData = Buffer.from('enc-only-curated').toString('base64')
const thumb = `data:image/png;base64,${await pngB64(120)}`
const encOnly = {
  identifier: 'novelai-vibe-transfer',
  version: 1,
  type: 'encoding',
  id: await sha(encOnlyData),
  encodings: { 'v4-5full': { unknown: { encoding: encOnlyData } } },
  thumbnail: thumb,
  createdAt: Date.now(),
  importInfo: { model: 'nai-diffusion-4-5-full', information_extracted: 0.5, strength: 0.3 },
}
await pickFiles('vibe', [file('仅编码.naiv4vibe', encOnly)])
s = await settings()
const eo = s.vibes?.[2]
check(eo?.encodedFor === 'v45-full' && eo.informationExtracted === 0.5 && eo.strength === 0.3, `只有编码：encodedFor V4.5 Full、信息量 0.5（${JSON.stringify(eo)}）`)
const tile3 = tid('refs-vibe').getByTestId('ref-tile').nth(2)
check((await tile3.getByTestId('ref-badge').innerText()) === '仅编码', '左上「仅编码」')
check((await tile3.getByTestId('ref-vibe-info').getAttribute('data-disabled')) === '' && (await tile3.getByTestId('ref-vibe-info-input').isDisabled()), '信息量不能改')
check((await tile3.locator('img').count()) === 1, '用文件带的缩略图')
await page.mouse.move(2, height - 40)
await clip(tid('refs-vibe'), '3-encoded-only', 8)
reqs = await generate()
check((reqs.find((r) => r.url === 'ai/generate-image-stream')?.req.parameters.reference_image_multiple_cached?.length ?? 0) === 3, 'V4.5 Full 上：3 张都发')
await page.evaluate(async () => {
  const { getDocStore, useTabs } = await window.__peImport('/src/store/tabs.ts')
  getDocStore(useTabs.getState().activeId).getState().updateSettings({ model: 'v4-full' })
})
await page.waitForTimeout(400)
check((await tile3.getByTestId('ref-note').innerText()) === '仅适用于 V4.5 Full' && (await tile3.getAttribute('data-off')) === '', '换到 V4 Full：变淡，写「仅适用于 V4.5 Full」')
check((await tile3.getByTestId('ref-cost').count()) === 0, '不算编码费')
await page.mouse.move(2, height - 40)
await clip(tid('refs-vibe'), '4-encoded-only-other-model', 8)
reqs = await generate()
check((reqs.find((r) => r.url === 'ai/generate-image-stream')?.req.parameters.reference_image_multiple_cached?.length ?? 0) === 2, 'V4 Full 上：只发 2 张')
await page.evaluate(async () => {
  const { getDocStore, useTabs } = await window.__peImport('/src/store/tabs.ts')
  getDocStore(useTabs.getState().activeId).getState().updateSettings({ model: 'v45-full' })
})
await page.waitForTimeout(300)

const tile1 = tid('refs-vibe').getByTestId('ref-tile').first()
await tile1.hover()
await tile1.getByTestId('ref-more').click()
await page.waitForSelector('[data-testid=ref-export]')
await page.waitForTimeout(250)
await clip(page.locator('[role=menu][data-state=open]'), '5-tile-menu', 4)
const d1 = await download(() => tid('ref-export').click())
const o1 = JSON.parse(d1.bytes.toString())
check(/^[0-9a-f]{6}-[0-9a-f]{6}\.naiv4vibe$/.test(d1.name) && o1.identifier === 'novelai-vibe-transfer' && o1.type === 'image', `导出 .naiv4vibe：${d1.name}，type image`)
check(o1.id === (await sha(o1.image)) && o1.encodings['v4-5full']?.[await sha('information_extracted:0.7')]?.encoding === ENC_DATA, 'id = sha256(原图 base64)、带着导入时的编码')
check(o1.importInfo.model === 'nai-diffusion-4-5-full' && o1.importInfo.strength === 0.45 && o1.thumbnail?.startsWith('data:image/jpeg;base64,'), `importInfo、缩略图（${JSON.stringify(o1.importInfo)}）`)
const tile3b = tid('refs-vibe').getByTestId('ref-tile').nth(2)
await tile3b.hover()
await tile3b.getByTestId('ref-more').click()
const d3 = await download(() => tid('ref-export').click())
const o3 = JSON.parse(d3.bytes.toString())
check(o3.type === 'encoding' && !o3.image && o3.encodings['v4-5full']?.unknown?.encoding === encOnlyData, '只有编码的：导出成 encoding 类型')

await tid('refs-vibe').getByTestId('ref-tile').nth(1).getByTestId('ref-enabled').click()
await page.waitForTimeout(200)
await tid('refs-vibe-export').hover()
await page.waitForTimeout(700)
check((await page.locator('[data-slot=tooltip-content]').last().innerText().catch(() => '')).includes('不含停用的'), '有停用的：悬停写「不含停用的」')
const d2 = await download(() => tid('refs-vibe-export').click())
const o2 = JSON.parse(d2.bytes.toString())
check(/^\d{4}-\d{2}-\d{2}\.naiv4vibebundle$/.test(d2.name) && o2.identifier === 'novelai-vibe-transfer-bundle' && o2.vibes.length === 2, `导出 bundle：${d2.name}，${o2.vibes?.length} 张（停用的不带）`)

await page.evaluate(async () => {
  const { useTabs } = await window.__peImport('/src/store/tabs.ts')
  const { newDocSettings } = await window.__peImport('/src/store/prefs.ts')
  const t = useTabs.getState()
  t.openInTab(t.newTab(), { base: { prompt: [], uc: [] }, characters: [], settings: { ...newDocSettings(), model: 'v4-full' }, meta: { title: '导入测试', createdAt: Date.now() } })
})
await page.waitForTimeout(600)
await pickFiles('vibe', [{ name: d1.name, mimeType: '', buffer: d1.bytes }])
s = await settings()
check(s.model === 'v45-full' && s.vibes?.length === 1 && (await tid('ref-cost').count()) === 0, `再导入自己导出的：V4.5 Full、不显示要花钱（${s.model}）`)

const dropImage = async (hue, kind) => {
  await dropFiles([{ name: 'ref.png', type: 'image/png', b64: await pngB64(hue) }])
  await page.waitForSelector('[data-testid=image-intake]')
  await tid(`intake-ref-${kind}`).click()
  await page.waitForTimeout(500)
}
await dropImage(300, 'character')
await dropImage(80, 'character')
await tid('refs-character').getByTestId('ref-char-type').nth(1).click()
await tid('ref-char-type-style').click()
await page.waitForTimeout(200)
const dz = await download(() => tid('refs-character-export').click())
const zipNames = await page.evaluate(async (b64) => {
  const { readZip } = await window.__peImport('/src/lib/zip.ts')
  const es = await readZip(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)))
  return { names: es.map((e) => e.name), meta: JSON.parse(new TextDecoder().decode(es.find((e) => e.name === 'metadata.json').data)) }
}, dz.bytes.toString('base64'))
check(dz.name === 'reference_images.zip' && JSON.stringify(zipNames.names) === JSON.stringify(['reference_1.png', 'reference_2.png', 'metadata.json']), `导出 ZIP：${dz.name} ${JSON.stringify(zipNames.names)}`)
check(zipNames.meta[1].description === 'style' && zipNames.meta[0].information_extracted === 1, 'metadata.json：类型、信息量 1')
await page.mouse.move(2, height - 40)
await clip(tid('refs-character'), '6-character', 8)
await pickFiles('character', [{ name: dz.name, mimeType: 'application/zip', buffer: dz.bytes }])
s = await settings()
check(s.characterRefs?.length === 4 && s.characterRefs[3].description === 'style', `导入 ZIP：共 4 张，第 4 张是画风（${s.characterRefs?.length}）`)
check((await toastText()).includes('已导入 2 张精准参考'), `toast：${await toastText()}`)
await pickFiles('character', [{ name: 'bad.zip', mimeType: 'application/zip', buffer: Buffer.from('not a zip') }])
check((await toastText()).includes('无法导入精准参考 ZIP'), '坏的 ZIP：报错')
await clearToasts()

await page.evaluate(async () => {
  const { useTabs } = await window.__peImport('/src/store/tabs.ts')
  const { newDocSettings } = await window.__peImport('/src/store/prefs.ts')
  const t = useTabs.getState()
  t.openInTab(t.newTab(), { base: { prompt: [], uc: [] }, characters: [], settings: newDocSettings(), meta: { title: '拖进来', createdAt: Date.now() } })
})
await page.waitForTimeout(600)
await page.evaluate(() => {
  const dt = new DataTransfer()
  dt.items.add(new File(['{}'], 'x.naiv4vibe', { type: '' }))
  window.dispatchEvent(new DragEvent('dragenter', { dataTransfer: dt, bubbles: true, cancelable: true }))
})
await page.waitForTimeout(300)
check((await tid('drop-overlay').innerText()).includes('松开以导入文件'), `拖着不是图片的文件：「松开以导入文件」（${(await tid('drop-overlay').innerText()).replace(/\s+/g, ' ')}）`)
await clip(page.locator('.imp-drop-card'), '7-drop-overlay', 8)
await dropFiles([{ name: '夕阳.naiv4vibe', type: '', b64: Buffer.from(JSON.stringify(vibeA)).toString('base64') }])
check((await tid('image-intake').count()) === 0, '拖 .naiv4vibe：不弹「用这张图做什么」')
s = await settings()
check(s.vibes?.length === 1 && s.model === 'v45-full', `拖 .naiv4vibe：直接加进 Vibe（${s.vibes?.length}）`)

const embedded = await page.evaluate(
  async ([img, bundleText]) => {
    const png = Uint8Array.from(atob(img), (c) => c.charCodeAt(0))
    const crcT = Array.from({ length: 256 }, (_, n) => {
      let c = n
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      return c >>> 0
    })
    const crc = (b) => {
      let c = 0xffffffff
      for (const x of b) c = crcT[(c ^ x) & 0xff] ^ (c >>> 8)
      return (c ^ 0xffffffff) >>> 0
    }
    const text = btoa(String.fromCharCode(...new TextEncoder().encode(bundleText)))
    const body = new TextEncoder().encode(`naidata\0${text}`)
    const chunk = new Uint8Array(12 + body.length)
    const dv = new DataView(chunk.buffer)
    dv.setUint32(0, body.length)
    chunk.set(new TextEncoder().encode('tEXt'), 4)
    chunk.set(body, 8)
    dv.setUint32(8 + body.length, crc(chunk.subarray(4, 8 + body.length)))
    const iend = png.length - 12
    const outB = new Uint8Array(png.length + chunk.length)
    outB.set(png.subarray(0, iend))
    outB.set(chunk, iend)
    outB.set(png.subarray(iend), iend + chunk.length)
    let s = ''
    for (const x of outB) s += String.fromCharCode(x)
    return btoa(s)
  },
  [await pngB64(260), JSON.stringify(bundle)],
)
await dropFiles([{ name: 'cover.naiv4vibebundle.png', type: 'image/png', b64: embedded }])
await page.waitForSelector('[data-testid=image-intake]')
await tid('intake-ref-vibe').click()
await page.waitForTimeout(900)
s = await settings()
check(s.vibes?.length === 2, `藏了 Vibe 的 PNG：加进图里的那两张（重复的不加，共 ${s.vibes?.length}）`)

await clearToasts()
await page.mouse.move(2, height - 40)
await clip(tid('box-refs'), '8-box-final', 8)

check(errors.length === 0, `没有 console 报错（${errors.slice(0, 3).join(' | ')}）`)
console.log(fails.length ? `\n${fails.length} 项失败` : '\n全部通过')
await browser.close()
process.exit(fails.length ? 1 : 0)
