// GDI+ and older ICO loaders misread small PNG entries, so sizes below 256 use BMP; 256 uses PNG.
import { copyFileSync, readFileSync, writeFileSync } from 'node:fs'
import { chromium } from '@playwright/test'

const src = (n) => `assets/logo/${n === 16 ? 'tincture-16' : n === 24 ? 'tincture-24' : n <= 48 ? 'tincture-32' : 'tincture'}.svg`
const sizes = [16, 24, 32, 48, 64, 128, 256]

const browser = await chromium.launch()
const page = await browser.newPage({ deviceScaleFactor: 1, viewport: { width: 600, height: 600 } })
const png = {}
const rgba = {}
for (const n of sizes) {
  const svg = readFileSync(src(n), 'utf8').replace('<svg ', `<svg width="${n}" height="${n}" `)
  await page.setContent(`<style>html,body{margin:0;background:transparent}svg{display:block}</style>${svg}`)
  png[n] = await page.locator('svg').screenshot({ omitBackground: true })
  rgba[n] = Buffer.from(
    await page.evaluate(async (url) => {
      const img = new Image()
      img.src = url
      await img.decode()
      const c = document.createElement('canvas')
      c.width = img.width
      c.height = img.height
      const ctx = c.getContext('2d')
      ctx.drawImage(img, 0, 0)
      return [...ctx.getImageData(0, 0, img.width, img.height).data]
    }, `data:image/png;base64,${png[n].toString('base64')}`),
  )
}
await browser.close()

/** ICO BMP entries double the header height and store bottom-up BGRA followed by a 1-bit AND mask; loaders require this layout. */
function bmp(n) {
  const head = Buffer.alloc(40)
  head.writeUInt32LE(40, 0)
  head.writeInt32LE(n, 4)
  head.writeInt32LE(n * 2, 8)
  head.writeUInt16LE(1, 12)
  head.writeUInt16LE(32, 14)
  const px = Buffer.alloc(n * n * 4)
  const src = rgba[n]
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const s = (y * n + x) * 4
      const d = ((n - 1 - y) * n + x) * 4
      px[d] = src[s + 2]
      px[d + 1] = src[s + 1]
      px[d + 2] = src[s]
      px[d + 3] = src[s + 3]
    }
  const stride = Math.ceil(n / 32) * 4
  const mask = Buffer.alloc(stride * n)
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (src[(y * n + x) * 4 + 3] === 0) mask[(n - 1 - y) * stride + (x >> 3)] |= 0x80 >> (x & 7)
  head.writeUInt32LE(px.length + mask.length, 20)
  return Buffer.concat([head, px, mask])
}

function ico(list) {
  const head = Buffer.alloc(6)
  head.writeUInt16LE(1, 2)
  head.writeUInt16LE(list.length, 4)
  let offset = 6 + 16 * list.length
  const dir = []
  const data = []
  for (const n of list) {
    const d = n >= 256 ? png[n] : bmp(n)
    const e = Buffer.alloc(16)
    e.writeUInt8(n >= 256 ? 0 : n, 0)
    e.writeUInt8(n >= 256 ? 0 : n, 1)
    e.writeUInt16LE(1, 4)
    e.writeUInt16LE(32, 6)
    e.writeUInt32LE(d.length, 8)
    e.writeUInt32LE(offset, 12)
    offset += d.length
    dir.push(e)
    data.push(d)
  }
  return Buffer.concat([head, ...dir, ...data])
}

writeFileSync('electron/icon.ico', ico(sizes))
copyFileSync('assets/logo/tincture-32.svg', 'public/favicon.svg')
console.log(`electron/icon.ico (${sizes.join(' / ')}), public/favicon.svg`)
