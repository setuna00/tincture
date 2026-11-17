// NAI image streams prefix each msgpack frame with a 4-byte length; mock streams must preserve that framing.
// NAI embeds metadata in alpha low bits; include the actual prompt, parameters and seed so mock images round-trip through import.
// NAI infill masks use width/8 by height/8 pixels; scale them back up when compositing the mock image.
const real = window.fetch.bind(window)
const HOST = 'https://image.novelai.net'
const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms))
const STEP_MS = 140

let anlas = 2340
const subscription = () => ({
  tier: 3,
  active: true,
  expiresAt: 4102444800,
  trainingStepsLeft: { fixedTrainingStepsLeft: Math.min(anlas, 1000), purchasedTrainingSteps: Math.max(0, anlas - 1000) },
  usage: { percent: 63, purchasedPercent: 0, timeUntilNextPercent: 4320, isNegative: false },
})

/** Match generationPrice in src/lib/nai-api.ts so the mock charges the same Anlas and Opus free-image allowance as NAI. */
function charge(model, p) {
  const px = p.width * p.height
  const v5 = model.startsWith('nai-diffusion-5')
  const medium = model.endsWith('-medium')
  const d = Math.ceil(2951823174884865e-21 * px + 5753298233447344e-22 * px * p.steps * (medium ? 1 / 1.06521739 : 1)) * (v5 ? 1.5 : 1)
  const free = px <= 1_048_576 && p.steps <= 28 ? 1 : 0
  const refs = p.director_reference_images_cached?.length ?? 0
  const vibes = p.reference_image_multiple_cached?.length ?? 0
  const extra = 5 * refs * p.n_samples + 2 * Math.max(0, vibes - 4)
  anlas = Math.max(0, anlas - Math.max(Math.ceil(d * (p.strength ?? 1)), 2) * Math.max(0, p.n_samples - (refs ? 0 : free)) - extra)
}

async function encodeVibe(init) {
  const req = JSON.parse(await init.body.get('request').text())
  window.__naiRequests.push({ url: 'ai/encode-vibe', req })
  await sleep(600)
  anlas = Math.max(0, anlas - 2)
  return new Response(new TextEncoder().encode(`demo-vibe ${req.model} ${req.information_extracted}`), { status: 200, headers: { 'content-type': 'application/octet-stream' } })
}

/** These stored ZIP fixtures omit CRC because the reader does not validate it; do not assume they are general-purpose archives. */
function makeZip(files) {
  const enc = new TextEncoder()
  const parts = []
  const dir = []
  let off = 0
  for (const f of files) {
    const name = enc.encode(f.name)
    const local = new Uint8Array(30 + name.length)
    const lv = new DataView(local.buffer)
    lv.setUint32(0, 0x04034b50, true)
    lv.setUint32(18, f.data.length, true)
    lv.setUint32(22, f.data.length, true)
    lv.setUint16(26, name.length, true)
    local.set(name, 30)
    const cd = new Uint8Array(46 + name.length)
    const cv = new DataView(cd.buffer)
    cv.setUint32(0, 0x02014b50, true)
    cv.setUint32(20, f.data.length, true)
    cv.setUint32(24, f.data.length, true)
    cv.setUint16(28, name.length, true)
    cv.setUint32(42, off, true)
    cd.set(name, 46)
    parts.push(local, f.data)
    dir.push(cd)
    off += local.length + f.data.length
  }
  const end = new Uint8Array(22)
  const ev = new DataView(end.buffer)
  ev.setUint32(0, 0x06054b50, true)
  ev.setUint16(8, files.length, true)
  ev.setUint16(10, files.length, true)
  ev.setUint32(12, dir.reduce((a, d) => a + d.length, 0), true)
  ev.setUint32(16, off, true)
  return new Blob([...parts, ...dir, end], { type: 'application/zip' })
}

const png = async (c) => new Uint8Array(await (await c.convertToBlob({ type: 'image/png' })).arrayBuffer())

async function redraw(image, k, f, label) {
  const bmp = await createImageBitmap(image)
  const w = Math.round(bmp.width * k)
  const h = Math.round(bmp.height * k)
  const c = new OffscreenCanvas(w, h)
  const g = c.getContext('2d')
  if (typeof f === 'string') g.filter = f
  g.drawImage(bmp, 0, 0, w, h)
  g.filter = 'none'
  bmp.close()
  if (typeof f === 'function') f(g, w, h)
  if (label) {
    const s = Math.min(w, h)
    g.textAlign = 'center'
    g.fillStyle = 'rgba(0,0,0,.55)'
    g.fillRect(0, h - s / 7, w, s / 7)
    g.fillStyle = '#fff'
    g.font = `600 ${Math.round(s / 18)}px system-ui, "Microsoft YaHei", sans-serif`
    g.fillText(label, w / 2, h - s / 18)
  }
  return c
}

function cutout(g, w, h) {
  g.globalCompositeOperation = 'destination-in'
  g.beginPath()
  g.ellipse(w / 2, h * 0.55, w * 0.36, h * 0.42, 0, 0, Math.PI * 2)
  g.fill()
  g.globalCompositeOperation = 'source-over'
}
function cutoutOnBg(g, w, h) {
  cutout(g, w, h)
  g.globalCompositeOperation = 'destination-over'
  g.fillStyle = '#d8e4f0'
  g.fillRect(0, 0, w, h)
  g.globalCompositeOperation = 'source-over'
}

const TOOL_LOOK = {
  lineart: ['grayscale(1) contrast(6) brightness(1.7)', '演示 线稿'],
  sketch: ['grayscale(1) contrast(1.8) brightness(1.25)', '演示 草图'],
  colorize: ['saturate(2.4) hue-rotate(15deg)', '演示 上色'],
  emotion: ['hue-rotate(-12deg) brightness(1.06)', '演示 改表情'],
  declutter: ['blur(1px)', '演示 去文字'],
  'declutter-keep-bubbles': ['blur(.6px)', '演示 去文字（保留对话框）'],
}

async function tool(url, init) {
  const req = JSON.parse(await init.body.get('request').text())
  const image = init.body.get('image')
  window.__naiRequests.push({ url: url.slice(HOST.length + 1), req })
  const { upscalePrice, toolPrice } = await import('/src/lib/nai-tools.ts')
  const bmp = await createImageBitmap(image)
  const [w, h] = [bmp.width, bmp.height]
  bmp.close()
  await sleep(1500)
  let outs
  if (url.endsWith('/ai/upscale')) {
    anlas = Math.max(0, anlas - Math.max(0, upscalePrice(w, h)))
    outs = [await redraw(image, 2, 'contrast(1.05)', '演示 放大 ×2')]
  } else if (req.req_type === 'bg-removal') {
    anlas = Math.max(0, anlas - toolPrice('bg-removal', w, h, null))
    outs = [await redraw(image, 1, cutout, null), await redraw(image, 1, cutoutOnBg, '演示 去背景'), await redraw(image, 1, 'opacity(.8)', '演示 去背景 · 混合')]
  } else {
    const [f, label] = TOOL_LOOK[req.req_type] ?? ['none', `演示 ${req.req_type}`]
    outs = [await redraw(image, 1, f, req.req_type === 'emotion' ? `${label}：${String(req.prompt).split(';;')[0]}` : label)]
  }
  const files = await Promise.all(outs.map(async (c, i) => ({ name: `image_${i}.png`, data: await png(c) })))
  return new Response(makeZip(files), { status: 200, headers: { 'content-type': 'application/zip' } })
}

async function paintFrom(image, w, h, seed, label) {
  const c = await redraw(image, 1, 'none', null)
  const out = new OffscreenCanvas(w, h)
  const g = out.getContext('2d')
  g.drawImage(c, 0, 0, w, h)
  g.fillStyle = `hsla(${(seed * 47) % 360} 70% 50% / .28)`
  g.fillRect(0, 0, w, h)
  const s = Math.min(w, h)
  g.textAlign = 'center'
  g.fillStyle = 'rgba(255,255,255,.92)'
  g.font = `600 ${Math.round(s / 12)}px system-ui, "Microsoft YaHei", sans-serif`
  g.fillText(label, w / 2, h * 0.82)
  g.font = `500 ${Math.round(s / 30)}px ui-monospace, Consolas, monospace`
  g.fillText(`seed ${seed} · ${w} × ${h}`, w / 2, h * 0.82 + s / 14)
  return out
}

function paint(w, h, seed, prompt, index) {
  const c = new OffscreenCanvas(w, h)
  const g = c.getContext('2d')
  const hue = (seed * 47) % 360
  const grd = g.createLinearGradient(0, 0, w, h)
  grd.addColorStop(0, `hsl(${hue} 60% 70%)`)
  grd.addColorStop(1, `hsl(${(hue + 70) % 360} 55% 35%)`)
  g.fillStyle = grd
  g.fillRect(0, 0, w, h)
  for (let i = 0; i < 6; i++) {
    const x = ((seed * (i + 3) * 97) % 1000) / 1000
    const y = ((seed * (i + 7) * 61) % 1000) / 1000
    const r = Math.min(w, h) * (0.12 + ((seed * (i + 1)) % 5) * 0.04)
    const spot = g.createRadialGradient(x * w, y * h, 0, x * w, y * h, r)
    spot.addColorStop(0, `hsla(${(hue + i * 40) % 360} 80% 85% / .55)`)
    spot.addColorStop(1, 'transparent')
    g.fillStyle = spot
    g.fillRect(0, 0, w, h)
  }
  const s = Math.min(w, h)
  g.textAlign = 'center'
  g.fillStyle = 'rgba(255,255,255,.92)'
  g.font = `600 ${Math.round(s / 9)}px system-ui, "Microsoft YaHei", sans-serif`
  g.fillText(`演示图 #${index + 1}`, w / 2, h * 0.42)
  g.font = `500 ${Math.round(s / 26)}px ui-monospace, Consolas, monospace`
  g.fillText(`seed ${seed}`, w / 2, h * 0.42 + s / 12)
  g.fillStyle = 'rgba(255,255,255,.75)'
  g.font = `400 ${Math.round(s / 34)}px system-ui, sans-serif`
  const words = prompt.split(/,\s*/).filter(Boolean)
  const lines = []
  let line = ''
  for (const word of words) {
    const next = line ? `${line}, ${word}` : word
    if (g.measureText(next).width > w * 0.8 && line) {
      lines.push(line)
      line = word
    } else line = next
    if (lines.length === 4) break
  }
  if (lines.length < 4 && line) lines.push(line)
  lines.forEach((l, i) => g.fillText(l, w / 2, h * 0.6 + i * (s / 24)))
  return c
}

async function paintInfill(image, mask, w, h, seed, fresh) {
  const c = await redraw(image, 1, 'none', null)
  const out = new OffscreenCanvas(w, h)
  const g = out.getContext('2d')
  g.drawImage(c, 0, 0, w, h)
  const m = await createImageBitmap(mask)
  const layer = new OffscreenCanvas(w, h)
  const lg = layer.getContext('2d')
  lg.imageSmoothingEnabled = false
  lg.drawImage(m, 0, 0, w, h)
  m.close()
  lg.globalCompositeOperation = 'source-in'
  lg.drawImage(fresh, 0, 0, w, h)
  g.drawImage(layer, 0, 0)
  return out
}

async function intermediate(full, t) {
  const w = Math.max(16, Math.round(full.width / 8))
  const h = Math.max(16, Math.round(full.height / 8))
  const c = new OffscreenCanvas(w, h)
  const g = c.getContext('2d')
  g.drawImage(full, 0, 0, w, h)
  const img = g.getImageData(0, 0, w, h)
  const d = img.data
  const k = (1 - t) ** 1.5
  for (let i = 0; i < d.length; i += 4) {
    const n = Math.random() * 255
    d[i] = d[i] * (1 - k) + n * k
    d[i + 1] = d[i + 1] * (1 - k) + n * k
    d[i + 2] = d[i + 2] * (1 - k) + n * k
  }
  g.putImageData(img, 0, 0)
  return new Uint8Array(await (await c.convertToBlob({ type: 'image/jpeg', quality: 0.6 })).arrayBuffer())
}

async function generate(init) {
  const [{ Packr }, { stealthPayload, writeStealthAlpha }, { MODELS, MEDIUM_HASHES }, { maxEnhanceTarget }] = await Promise.all([
    import('msgpackr'),
    import('/src/lib/nai-write.ts'),
    import('/src/lib/nai-models.ts'),
    import('/src/lib/nai-tools.ts'),
  ])
  const req = JSON.parse(await init.body.get('request').text())
  window.__naiRequests.push({ url: 'ai/generate-image-stream', req })
  const p = { ...req.parameters }
  if (p.upscaled_enhance) Object.assign(p, maxEnhanceTarget(p.width, p.height))
  const n = p.n_samples ?? 1
  const steps = p.steps ?? 23
  const medium = req.model.endsWith('-medium')
  const model = medium ? MODELS['v5-full'] : Object.values(MODELS).find((m) => m.api === req.model)
  const source = model ? `${model.source} ${medium ? MEDIUM_HASHES[0] : model.hashes[0]}` : 'NovelAI Diffusion V5 0ADF9AB7'
  const packr = new Packr({ useRecords: false })
  const frame = (o) => {
    const body = packr.pack(o)
    const f = new Uint8Array(4 + body.length)
    new DataView(f.buffer).setUint32(0, body.length)
    f.set(body, 4)
    return f
  }
  const seeds = Array.from({ length: n }, (_, i) => p.seed + i)
  const base = req.action === 'img2img' || req.action === 'infill' ? init.body.get('image') : null
  const mask = req.action === 'infill' ? init.body.get('mask') : null
  const vibes = p.reference_image_multiple_cached?.length ?? 0
  const refs = p.director_reference_images_cached?.length ?? 0
  const tag = [vibes ? `Vibe ×${vibes}` : '', refs ? `精准参考 ×${refs}` : ''].filter(Boolean).join(' · ')
  const what = p.upscaled_enhance || req.input?.includes('upscaled, blurry') ? 'Enhance' : p.strength === 0.8 && p.noise === 0.1 ? '变体' : '图生图'
  const fulls = mask
    ? await Promise.all(seeds.map((seed, i) => paintInfill(base, mask, p.width, p.height, seed, paint(p.width, p.height, seed, req.input ?? '', i))))
    : base
    ? await Promise.all(seeds.map((seed, i) => paintFrom(base, p.width, p.height, seed, `演示 ${what}${n > 1 ? ` #${i + 1}` : ''}${tag ? ` · ${tag}` : ''}`)))
    : seeds.map((seed, i) => paint(p.width, p.height, seed, tag ? `【${tag}】, ${req.input ?? ''}` : (req.input ?? ''), i))
  charge(req.model, { ...p, width: p.width, height: p.height, steps, n_samples: n, strength: mask ? (p.inpaintImg2ImgStrength ?? 1) : base ? p.strength : 1 })
  for (const k of ['image', 'mask', 'reference_image_multiple_cached', 'director_reference_images_cached']) delete p[k]

  const body = new ReadableStream({
    async start(ctl) {
      const send = (o) => ctl.enqueue(frame(o))
      for (let s = 0; s < steps; s++) {
        const t0 = performance.now()
        const images = await Promise.all(fulls.map((f) => intermediate(f, s / steps)))
        await sleep(Math.max(20, STEP_MS - (performance.now() - t0)))
        if (init.signal?.aborted) return ctl.error(init.signal.reason)
        images.forEach((image, i) => send({ event_type: 'intermediate', samp_ix: i, step_ix: s, gen_id: 'demo', sigma: 1 - s / steps, image }))
      }
      for (let i = 0; i < n; i++) {
        const c = fulls[i]
        const g = c.getContext('2d')
        const meta = {
          Title: 'NovelAI generated image',
          Description: req.input ?? '',
          Software: 'NovelAI',
          Source: source,
          Comment: JSON.stringify({ prompt: req.input ?? '', ...p, seed: seeds[i], n_samples: 1 }),
        }
        const img = g.getImageData(0, 0, c.width, c.height)
        writeStealthAlpha(img.data, c.width, c.height, await stealthPayload(meta))
        g.putImageData(img, 0, 0)
        send({ event_type: 'final', samp_ix: i, gen_id: 'demo', image: new Uint8Array(await (await c.convertToBlob({ type: 'image/webp', quality: 1 })).arrayBuffer()) })
      }
      ctl.close()
    },
  })
  return new Response(body, { status: 200 })
}

window.fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  if (url === `${HOST}/user/subscription`) return new Response(JSON.stringify(subscription()), { status: 200, headers: { 'content-type': 'application/json' } })
  if (url === `${HOST}/ai/generate-image-stream`) return generate(init)
  if (url === `${HOST}/ai/upscale` || url === `${HOST}/ai/augment-image`) return tool(url, init)
  if (url === `${HOST}/ai/encode-vibe`) return encodeVibe(init)
  return real(input, init)
}
window.__naiRequests = []
console.info('[体验] 已接上假 NAI：出图、参考图、放大、Director Tools、余额都是模拟的')
