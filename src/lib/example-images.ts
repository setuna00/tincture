export const EXAMPLE_IMAGE_PREFIX = 'ex:'

const W = 512
const H = 768

type Ctx = CanvasRenderingContext2D
type Painter = (g: Ctx, rnd: () => number) => void

function seeded(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const vertical = (g: Ctx, stops: [number, string][]) => {
  const lg = g.createLinearGradient(0, 0, 0, H)
  for (const [o, c] of stops) lg.addColorStop(o, c)
  g.fillStyle = lg
  g.fillRect(0, 0, W, H)
}

const glow = (g: Ctx, x: number, y: number, r: number, color: string, alpha = 1) => {
  const rg = g.createRadialGradient(x, y, 0, x, y, r)
  rg.addColorStop(0, color)
  rg.addColorStop(1, color.replace(/,\s*[\d.]+\)$/, ',0)'))
  g.globalAlpha = alpha
  g.fillStyle = rg
  g.fillRect(x - r, y - r, r * 2, r * 2)
  g.globalAlpha = 1
}

const particles = (g: Ctx, rnd: () => number, n: number, color: string, area = { x: 0, y: 0, w: W, h: H }) => {
  for (let i = 0; i < n; i++) {
    const x = area.x + rnd() * area.w
    const y = area.y + rnd() * area.h
    const r = 1 + rnd() * 3.2
    glow(g, x, y, r * 4, color, 0.35 + rnd() * 0.4)
    g.fillStyle = 'rgba(255,255,255,0.9)'
    g.beginPath()
    g.arc(x, y, r * 0.55, 0, Math.PI * 2)
    g.fill()
  }
}

const petals = (g: Ctx, rnd: () => number, n: number, colors: string[]) => {
  for (let i = 0; i < n; i++) {
    g.save()
    g.translate(rnd() * W, rnd() * H)
    g.rotate(rnd() * Math.PI)
    g.globalAlpha = 0.55 + rnd() * 0.45
    g.fillStyle = colors[Math.floor(rnd() * colors.length)]
    g.beginPath()
    g.ellipse(0, 0, 3 + rnd() * 5, 2 + rnd() * 2.5, 0, 0, Math.PI * 2)
    g.fill()
    g.restore()
  }
}

const cluster = (g: Ctx, rnd: () => number, cx: number, cy: number, spread: number, n: number, colors: string[], rMin: number, rMax: number) => {
  for (let i = 0; i < n; i++) {
    const a = rnd() * Math.PI * 2
    const d = Math.sqrt(rnd()) * spread
    g.globalAlpha = 0.5 + rnd() * 0.5
    g.fillStyle = colors[Math.floor(rnd() * colors.length)]
    g.beginPath()
    g.arc(cx + Math.cos(a) * d, cy + Math.sin(a) * d * 0.75, rMin + rnd() * (rMax - rMin), 0, Math.PI * 2)
    g.fill()
  }
  g.globalAlpha = 1
}

const backlight: Painter = (g, rnd) => {
  vertical(g, [
    [0, '#fff3d6'],
    [0.45, '#f6d49a'],
    [1, '#b98a52'],
  ])
  const sx = W * 0.78
  const sy = H * 0.12
  glow(g, sx, sy, 520, 'rgba(255,250,230,0.95)')
  g.save()
  g.globalCompositeOperation = 'screen'
  for (let i = 0; i < 9; i++) {
    const a = Math.PI * (0.58 + i * 0.045 + rnd() * 0.02)
    const spread = 0.012 + rnd() * 0.02
    const len = 1100
    const lg = g.createLinearGradient(sx, sy, sx + Math.cos(a) * len, sy + Math.sin(a) * len)
    lg.addColorStop(0, 'rgba(255,248,225,0.55)')
    lg.addColorStop(1, 'rgba(255,248,225,0)')
    g.fillStyle = lg
    g.beginPath()
    g.moveTo(sx, sy)
    g.lineTo(sx + Math.cos(a - spread) * len, sy + Math.sin(a - spread) * len)
    g.lineTo(sx + Math.cos(a + spread) * len, sy + Math.sin(a + spread) * len)
    g.closePath()
    g.fill()
  }
  g.restore()
  g.filter = 'blur(6px)'
  cluster(g, rnd, -20, H * 0.15, 150, 60, ['#5c6b2e', '#6f7d38', '#47552a'], 14, 36)
  cluster(g, rnd, W * 0.15, H * 1.02, 210, 70, ['#4d5a27', '#61702f', '#3b4720'], 18, 44)
  g.filter = 'none'
  particles(g, rnd, 38, 'rgba(255,240,200,0.9)')
}

const sunset: Painter = (g, rnd) => {
  vertical(g, [
    [0, '#2b2d6e'],
    [0.38, '#8a4f93'],
    [0.6, '#f07a62'],
    [0.74, '#ffc46b'],
    [1, '#ffc46b'],
  ])
  const hy = H * 0.74
  glow(g, W * 0.5, hy, 420, 'rgba(255,200,120,0.85)')
  g.fillStyle = '#fff1c4'
  g.beginPath()
  g.arc(W * 0.5, hy, 62, Math.PI, 0)
  g.fill()
  for (let i = 0; i < 6; i++) {
    g.globalAlpha = 0.35 + rnd() * 0.3
    g.fillStyle = i % 2 ? '#f6a3a0' : '#ffd6b0'
    g.beginPath()
    g.ellipse(rnd() * W, H * (0.25 + rnd() * 0.35), 70 + rnd() * 110, 5 + rnd() * 6, 0, 0, Math.PI * 2)
    g.fill()
  }
  g.globalAlpha = 1
  const hills: [string, number, number][] = [
    ['#7a3f6e', hy - 8, 26],
    ['#4b2a55', hy + 30, 40],
    ['#24183a', hy + 80, 54],
  ]
  for (const [color, base, amp] of hills) {
    g.fillStyle = color
    g.beginPath()
    g.moveTo(0, H)
    const phase = rnd() * 6
    for (let x = 0; x <= W; x += 8) g.lineTo(x, base - Math.sin(x / 70 + phase) * amp - Math.sin(x / 23 + phase * 2) * amp * 0.25)
    g.lineTo(W, H)
    g.closePath()
    g.fill()
  }
}

const neon: Painter = (g, rnd) => {
  vertical(g, [
    [0, '#0b0f2a'],
    [0.6, '#1b1446'],
    [1, '#0a0a1c'],
  ])
  const ground = H * 0.78
  let x = -10
  while (x < W) {
    const w = 60 + rnd() * 70
    const top = H * (0.18 + rnd() * 0.3)
    g.fillStyle = rnd() > 0.5 ? '#141634' : '#191b3e'
    g.fillRect(x, top, w, ground - top)
    for (let wy = top + 14; wy < ground - 14; wy += 16)
      for (let wx = x + 8; wx < x + w - 8; wx += 12)
        if (rnd() > 0.72) {
          g.fillStyle = rnd() > 0.5 ? 'rgba(255,214,140,0.8)' : 'rgba(150,200,255,0.6)'
          g.fillRect(wx, wy, 5, 7)
        }
    x += w + 4
  }
  const sign = (sx: number, sy: number, w: number, h: number, color: string) => {
    g.save()
    g.shadowColor = color
    g.shadowBlur = 28
    g.strokeStyle = color
    g.lineWidth = 5
    g.beginPath()
    g.roundRect(sx, sy, w, h, 10)
    g.stroke()
    g.lineWidth = 3
    g.beginPath()
    g.moveTo(sx + 14, sy + h / 2)
    g.lineTo(sx + w - 14, sy + h / 2)
    g.stroke()
    g.restore()
    glow(g, sx + w / 2, sy + h / 2, w, color, 0.25)
  }
  sign(W * 0.12, H * 0.42, 130, 54, 'rgba(255,79,180,1)')
  sign(W * 0.58, H * 0.3, 54, 150, 'rgba(56,225,255,1)')
  g.fillStyle = '#0c0b22'
  g.fillRect(0, ground, W, H - ground)
  for (const [cx, color] of [
    [W * 0.12 + 65, 'rgba(255,79,180,0.45)'],
    [W * 0.58 + 27, 'rgba(56,225,255,0.4)'],
  ] as const) {
    const lg = g.createLinearGradient(0, ground, 0, H)
    lg.addColorStop(0, color)
    lg.addColorStop(1, 'rgba(0,0,0,0)')
    g.fillStyle = lg
    g.fillRect(cx - 36, ground, 72, H - ground)
  }
  for (let i = 0; i < 40; i++) {
    g.fillStyle = `rgba(200,210,255,${0.05 + rnd() * 0.12})`
    g.fillRect(rnd() * W, ground + rnd() * (H - ground), 1, 14 + rnd() * 30)
  }
}

const wafu: Painter = (g, rnd) => {
  vertical(g, [
    [0, '#f3d4dc'],
    [0.55, '#c9a6d6'],
    [1, '#6d5a8c'],
  ])
  glow(g, W * 0.5, H * 0.35, 380, 'rgba(255,236,220,0.7)')
  g.fillStyle = '#4e3f62'
  g.fillRect(0, H * 0.82, W, H * 0.18)
  const red = '#c7372f'
  const dark = '#2c1f2a'
  const px1 = W * 0.27
  const px2 = W * 0.73 - 26
  g.fillStyle = red
  g.fillRect(px1, H * 0.3, 26, H * 0.52)
  g.fillRect(px2, H * 0.3, 26, H * 0.52)
  g.fillRect(W * 0.2, H * 0.36, W * 0.6, 20)
  g.fillStyle = dark
  g.beginPath()
  g.moveTo(W * 0.1, H * 0.25)
  g.quadraticCurveTo(W * 0.5, H * 0.29, W * 0.9, H * 0.25)
  g.lineTo(W * 0.88, H * 0.28)
  g.quadraticCurveTo(W * 0.5, H * 0.315, W * 0.12, H * 0.28)
  g.closePath()
  g.fill()
  g.fillStyle = red
  g.fillRect(W * 0.14, H * 0.28, W * 0.72, 16)
  for (const lx of [W * 0.12, W * 0.88]) {
    glow(g, lx, H * 0.6, 90, 'rgba(255,190,110,0.9)')
    g.fillStyle = '#ffb35c'
    g.beginPath()
    g.ellipse(lx, H * 0.6, 18, 26, 0, 0, Math.PI * 2)
    g.fill()
    g.fillStyle = dark
    g.fillRect(lx - 12, H * 0.6 - 30, 24, 6)
    g.fillRect(lx - 12, H * 0.6 + 24, 24, 6)
  }
  petals(g, rnd, 70, ['#ffd1dc', '#ffb7c9', '#fff0f4'])
}

const sakura: Painter = (g, rnd) => {
  vertical(g, [
    [0, '#5aa9e6'],
    [0.6, '#9fd1f4'],
    [1, '#dff0fb'],
  ])
  g.filter = 'blur(10px)'
  cluster(g, rnd, W * 0.7, H * 0.55, 90, 26, ['#ffffff', '#f1f7ff'], 24, 52)
  cluster(g, rnd, W * 0.2, H * 0.72, 70, 18, ['#ffffff', '#eef6ff'], 20, 40)
  g.filter = 'none'
  g.strokeStyle = '#4a2f2a'
  g.lineCap = 'round'
  const branch = (x0: number, y0: number, x1: number, y1: number, w: number) => {
    g.lineWidth = w
    g.beginPath()
    g.moveTo(x0, y0)
    g.quadraticCurveTo((x0 + x1) / 2 + (rnd() - 0.5) * 80, (y0 + y1) / 2 + (rnd() - 0.5) * 80, x1, y1)
    g.stroke()
  }
  branch(-20, H * 0.05, W * 0.55, H * 0.2, 14)
  branch(W * 0.25, H * 0.12, W * 0.45, H * 0.42, 7)
  branch(W + 20, H * 0.32, W * 0.62, H * 0.38, 10)
  const pinks = ['#ffc0d3', '#ffd6e2', '#f7a8c2', '#ffe9f0', '#f191b2']
  for (const [cx, cy, s] of [
    [W * 0.1, H * 0.06, 110],
    [W * 0.42, H * 0.17, 120],
    [W * 0.62, H * 0.08, 90],
    [W * 0.44, H * 0.4, 70],
    [W * 0.86, H * 0.35, 95],
  ] as const)
    cluster(g, rnd, cx, cy, s, 140, pinks, 5, 13)
  petals(g, rnd, 90, pinks)
  particles(g, rnd, 22, 'rgba(255,255,255,0.9)')
}

interface Look {
  bg: [string, string, string]
  hair: string
  back: string
  eye: string
  skin: string
  cloth: string
  trim: string
  elf?: boolean
  tails?: boolean
  long?: boolean
  short?: boolean
  axe?: boolean
  cape?: string
  sideTail?: boolean
  cubes?: boolean
  star?: string
  foxEars?: string
}

const portrait =
  (L: Look): Painter =>
  (g, rnd) => {
    vertical(g, [
      [0, L.bg[0]],
      [0.55, L.bg[1]],
      [1, L.bg[2]],
    ])
    glow(g, W / 2, 250, 300, 'rgba(255,255,255,0.55)')
    particles(g, rnd, 14, 'rgba(255,255,255,0.8)', { x: 0, y: 0, w: W, h: H * 0.55 })
    const cx = W / 2
    const cy = 300
    if (L.axe) {
      g.save()
      g.translate(cx + 150, 420)
      g.rotate(-0.5)
      g.fillStyle = '#5b4636'
      g.fillRect(-10, -260, 20, 520)
      g.fillStyle = '#9aa3ad'
      g.beginPath()
      g.moveTo(10, -250)
      g.quadraticCurveTo(120, -220, 110, -120)
      g.lineTo(10, -150)
      g.closePath()
      g.fill()
      g.restore()
    }
    g.fillStyle = L.back
    if (L.long) {
      g.beginPath()
      g.ellipse(cx, cy + 120, 150, 260, 0, 0, Math.PI * 2)
      g.fill()
    }
    if (L.tails || L.sideTail)
      for (const k of L.sideTail ? [1] : [-1, 1]) {
        g.beginPath()
        g.moveTo(cx + k * 95, cy - 70)
        g.bezierCurveTo(cx + k * 210, cy + 10, cx + k * 170, cy + 260, cx + k * 205, cy + 420)
        g.bezierCurveTo(cx + k * 140, cy + 300, cx + k * 120, cy + 120, cx + k * 70, cy - 10)
        g.closePath()
        g.fillStyle = L.hair
        g.fill()
      }
    if (L.cape) {
      g.fillStyle = L.cape
      g.beginPath()
      g.moveTo(cx - 120, cy + 140)
      g.lineTo(cx - 260, H)
      g.lineTo(cx + 260, H)
      g.lineTo(cx + 120, cy + 140)
      g.closePath()
      g.fill()
    }
    g.fillStyle = L.cloth
    g.beginPath()
    g.moveTo(cx - 70, cy + 110)
    g.bezierCurveTo(cx - 200, cy + 170, cx - 230, cy + 330, cx - 240, H)
    g.lineTo(cx + 240, H)
    g.bezierCurveTo(cx + 230, cy + 330, cx + 200, cy + 170, cx + 70, cy + 110)
    g.closePath()
    g.fill()
    g.strokeStyle = L.trim
    g.lineWidth = 8
    g.beginPath()
    g.moveTo(cx - 150, cy + 200)
    g.quadraticCurveTo(cx, cy + 260, cx + 150, cy + 200)
    g.stroke()
    g.fillStyle = L.skin
    g.fillRect(cx - 28, cy + 70, 56, 60)
    if (L.elf)
      for (const k of [-1, 1]) {
        g.fillStyle = L.skin
        g.beginPath()
        g.moveTo(cx + k * 88, cy - 10)
        g.lineTo(cx + k * 175, cy - 60)
        g.lineTo(cx + k * 92, cy + 30)
        g.closePath()
        g.fill()
        g.fillStyle = '#c0392b'
        g.beginPath()
        g.arc(cx + k * 98, cy + 42, 7, 0, Math.PI * 2)
        g.fill()
      }
    if (L.foxEars)
      for (const k of [-1, 1]) {
        g.fillStyle = L.hair
        g.beginPath()
        g.moveTo(cx + k * 30, cy - 130)
        g.lineTo(cx + k * 105, cy - 215)
        g.lineTo(cx + k * 110, cy - 90)
        g.closePath()
        g.fill()
        g.fillStyle = L.foxEars
        g.beginPath()
        g.moveTo(cx + k * 52, cy - 128)
        g.lineTo(cx + k * 98, cy - 185)
        g.lineTo(cx + k * 100, cy - 112)
        g.closePath()
        g.fill()
      }
    g.fillStyle = L.skin
    g.beginPath()
    g.ellipse(cx, cy, 98, 112, 0, 0, Math.PI * 2)
    g.fill()
    for (const k of [-1, 1]) {
      g.fillStyle = '#fff'
      g.beginPath()
      g.ellipse(cx + k * 40, cy + 18, 20, 24, 0, 0, Math.PI * 2)
      g.fill()
      g.fillStyle = L.eye
      g.beginPath()
      g.ellipse(cx + k * 40, cy + 22, 14, 19, 0, 0, Math.PI * 2)
      g.fill()
      g.fillStyle = 'rgba(255,255,255,0.9)'
      g.beginPath()
      g.arc(cx + k * 35, cy + 13, 5, 0, Math.PI * 2)
      g.fill()
      g.fillStyle = 'rgba(230,120,120,0.35)'
      g.beginPath()
      g.ellipse(cx + k * 58, cy + 55, 16, 8, 0, 0, Math.PI * 2)
      g.fill()
    }
    g.fillStyle = L.hair
    g.beginPath()
    g.moveTo(cx - 108, cy + 10)
    g.bezierCurveTo(cx - 120, cy - 120, cx - 40, cy - 150, cx, cy - 145)
    g.bezierCurveTo(cx + 60, cy - 150, cx + 125, cy - 110, cx + 108, cy + 10)
    const fringe = L.short
      ? [80, -40, 55, -10, 30, -55, 0, -20, -30, -60, -60, -15, -85, -45]
      : [70, -30, 40, -5, 15, -40, -15, -5, -45, -35, -75, -5]
    for (let i = 0; i < fringe.length; i += 2) g.lineTo(cx + fringe[i], cy + fringe[i + 1])
    g.closePath()
    g.fill()
    if (L.short) {
      g.beginPath()
      for (let i = -3; i <= 3; i++) {
        g.moveTo(cx + i * 30 - 18, cy - 130)
        g.lineTo(cx + i * 34, cy - 185 + Math.abs(i) * 8)
        g.lineTo(cx + i * 30 + 18, cy - 130)
      }
      g.fill()
    }
    if (L.long)
      for (const k of [-1, 1]) {
        g.beginPath()
        g.moveTo(cx + k * 100, cy - 30)
        g.quadraticCurveTo(cx + k * 125, cy + 80, cx + k * 110, cy + 150)
        g.lineTo(cx + k * 80, cy + 60)
        g.closePath()
        g.fill()
      }
    if (L.cubes) {
      const cubes: [number, number, string][] = [
        [-78, -92, '#f2c94c'],
        [-50, -112, '#56a3e0'],
      ]
      for (const [x, y, c] of cubes) {
        g.save()
        g.translate(cx + x, cy + y)
        g.rotate(0.35)
        g.fillStyle = c
        g.fillRect(-12, -12, 24, 24)
        g.restore()
      }
    }
    if (L.star) {
      g.fillStyle = L.star
      g.beginPath()
      for (let i = 0; i < 10; i++) {
        const r = i % 2 ? 9 : 22
        const a = -Math.PI / 2 + (i * Math.PI) / 5
        g.lineTo(cx + 72 + r * Math.cos(a), cy - 98 + r * Math.sin(a))
      }
      g.closePath()
      g.fill()
    }
  }

const SKIN = '#f6e3d6'
const frieren = portrait({ bg: ['#cfe3d6', '#9fc3b4', '#5e8c84'], hair: '#eef0f4', back: '#c9cdd8', eye: '#3f9a63', skin: SKIN, cloth: '#f4f4f2', trim: '#c9a24a', elf: true, tails: true })
const fern = portrait({ bg: ['#e5d9ef', '#b7a2cf', '#6d5a8f'], hair: '#7a4f9c', back: '#5b3a78', eye: '#8a5bb5', skin: SKIN, cloth: '#22222b', trim: '#e9e6ef', long: true })
const stark = portrait({ bg: ['#f3dcc4', '#d9a37a', '#8a5a43'], hair: '#b8372f', back: '#8c2621', eye: '#b8372f', skin: '#f1d6c2', cloth: '#26262c', trim: '#7b6a58', short: true, axe: true })
const himmel = portrait({ bg: ['#d8e6f6', '#9fbde0', '#5b7aa6'], hair: '#cfe0f3', back: '#9ab3d1', eye: '#4f7fc4', skin: SKIN, cloth: '#3f5f8f', trim: '#e8edf5', short: true, cape: '#f2f2f4' })

const hitori = portrait({ bg: ['#f6dbe6', '#e7a9c2', '#9c5b7a'], hair: '#f2a7c3', back: '#e08aae', eye: '#4f8fd0', skin: SKIN, cloth: '#e9779f', trim: '#f7f1f4', long: true, cubes: true })
const nijika = portrait({ bg: ['#fbefc9', '#f2d27a', '#b88f3a'], hair: '#f4d35e', back: '#e2b93f', eye: '#c0392b', skin: SKIN, cloth: '#f7f4ec', trim: '#3b4a6b', sideTail: true, star: '#f7f1d0' })
const kitsune = portrait({ bg: ['#f7e1dc', '#e6a99c', '#a2574c'], hair: '#f3f1ee', back: '#d9d5cf', eye: '#d9a92b', skin: SKIN, cloth: '#fbfaf8', trim: '#c8382f', long: true, foxEars: '#f2b8a8' })

const PAINTERS: Record<string, Painter> = { backlight, sunset, neon, wafu, sakura, frieren, fern, stark, himmel, hitori, nijika, kitsune }

export const isExampleImage = (key: string) => key.startsWith(EXAMPLE_IMAGE_PREFIX)

export async function paintExampleImage(key: string): Promise<string | null> {
  const name = key.slice(EXAMPLE_IMAGE_PREFIX.length)
  const paint = PAINTERS[name]
  if (!paint) return null
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const g = canvas.getContext('2d')
  if (!g) return null
  let seed = 0
  for (const ch of name) seed = (seed * 31 + ch.charCodeAt(0)) >>> 0
  paint(g, seeded(seed))
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/webp', 0.9))
  return blob ? URL.createObjectURL(blob) : null
}
