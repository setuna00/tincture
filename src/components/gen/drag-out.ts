import type { DragEvent as ReactDragEvent } from 'react'
import { toast } from 'sonner'
import { desktop } from '@/lib/desktop'
import { thumbUrl } from '@/lib/thumbs'
import { imageUrl, type GenImage } from '@/store/gen'
import { useNai } from '@/store/nai'
import { exportFile, exportName } from './image-io'

const api = desktop?.dragOut
export const canDragOut = !!api

let out = false
export const draggingOut = () => out
let outIds: string[] = []
export const draggingOutIds = () => (out ? outIds : [])
let swallowClick = false

if (api) {
  api.onEnd(() => (out = false))
  const block = (e: DragEvent) => {
    if (!out) return
    if ((e.target as Element | null)?.closest?.('[data-gallery-drop]')) return
    e.stopImmediatePropagation()
    e.preventDefault()
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'none'
  }
  for (const t of ['dragenter', 'dragover', 'dragleave', 'drop']) window.addEventListener(t, block as EventListener, true)
  // The browser may synthesize a click after a native drag or an early release; consume it to avoid opening or selecting the image.
  window.addEventListener(
    'click',
    (e) => {
      if (!swallowClick) return
      swallowClick = false
      e.stopImmediatePropagation()
      e.preventDefault()
    },
    true,
  )
  window.addEventListener(
    'pointerdown',
    () => {
      out = false
      swallowClick = false
    },
    true,
  )
}

const ICON = 128
const BADGE = 11
async function dragIcon(src: HTMLImageElement | undefined, img: GenImage, count: number): Promise<{ bytes: Uint8Array; scale: number }> {
  const scale = Math.max(1, window.devicePixelRatio || 1)
  const k = ICON / Math.max(img.width, img.height)
  const w = Math.max(1, Math.round(img.width * k))
  const h = Math.max(1, Math.round(img.height * k))
  const m = count > 1 ? BADGE - 3 : 0
  const c = document.createElement('canvas')
  c.width = Math.round((w + m * 2) * scale)
  c.height = Math.round((h + m * 2) * scale)
  const ctx = c.getContext('2d')!
  ctx.scale(scale, scale)
  ctx.save()
  ctx.beginPath()
  ctx.roundRect(m, m, w, h, 6)
  ctx.clip()
  const pic = src?.complete && src.naturalWidth ? src : await loadImage(thumbUrl(img.id) ?? imageUrl(img))
  if (pic) ctx.drawImage(pic, m, m, w, h)
  else {
    ctx.fillStyle = '#808080'
    ctx.fillRect(m, m, w, h)
  }
  ctx.restore()
  ctx.beginPath()
  ctx.roundRect(m + 0.5, m + 0.5, w - 1, h - 1, 6)
  ctx.strokeStyle = 'rgb(0 0 0 / .25)'
  ctx.lineWidth = 1
  ctx.stroke()
  if (count > 1) {
    const css = getComputedStyle(document.documentElement)
    const cx = m + w
    const cy = m
    ctx.beginPath()
    ctx.arc(cx, cy, BADGE, 0, Math.PI * 2)
    ctx.fillStyle = css.getPropertyValue('--accent').trim() || '#f5d76e'
    ctx.fill()
    ctx.fillStyle = css.getPropertyValue('--accent-ink').trim() || '#2a2414'
    const label = count > 99 ? '99+' : String(count)
    ctx.font = `600 ${label.length > 2 ? 9 : 12}px system-ui, sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(label, cx, cy + 0.5)
  }
  const blob = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/png'))
  return { bytes: blob ? new Uint8Array(await blob.arrayBuffer()) : new Uint8Array(), scale }
}

async function loadImage(url: string): Promise<HTMLImageElement | null> {
  const el = new Image()
  el.src = url
  try {
    await el.decode()
    return el
  } catch {
    return null
  }
}

async function fileFor(img: GenImage, taken: Set<string>): Promise<string> {
  const base = exportName(img)
  let name = base
  for (let n = 2; taken.has(name.toLowerCase()); n++) name = `${base} (${n})`
  taken.add(name.toLowerCase())
  const key = `${img.id}|${useNai.getState().imageFormat}|${name}`
  const hit = await api!.find(key)
  if (hit) return hit
  const f = await exportFile(img)
  if (f.pngFailed) toast.error('无法转换为 PNG', { description: '已使用原图' })
  return api!.write({ key, name, ext: f.ext, bytes: new Uint8Array(await f.blob.arrayBuffer()) })
}

function sourceImage(el: HTMLElement): HTMLImageElement | undefined {
  if (el instanceof HTMLImageElement) return el
  const imgs = [...el.querySelectorAll('img')].filter((i) => i.complete && i.naturalWidth)
  return imgs[imgs.length - 1]
}

async function start(e: ReactDragEvent<HTMLElement>, imgs: GenImage[]) {
  e.preventDefault()
  e.stopPropagation()
  if (e.shiftKey || !imgs.length || out) return
  out = true
  outIds = imgs.map((x) => x.id)
  swallowClick = true
  // Native dragging requires the mouse button to remain held; abort if file preparation outlasted the press.
  let released = false
  const up = () => (released = true)
  window.addEventListener('pointerup', up, { once: true })
  const src = sourceImage(e.currentTarget)
  try {
    const taken = new Set<string>()
    const paths: string[] = []
    // PNG conversion uses WebGL; serialize conversions to avoid exhausting browser contexts.
    for (const img of imgs) paths.push(await fileFor(img, taken))
    const icon = await dragIcon(src, imgs[0], imgs.length)
    if (released) out = false
    else api!.start(paths, icon.bytes, icon.scale)
  } catch {
    out = false
    toast.error('无法读取图片')
  } finally {
    window.removeEventListener('pointerup', up)
  }
}

export function dragOutProps(imgs: () => GenImage[], onStart?: () => void): { draggable?: true; onDragStart?: (e: ReactDragEvent<HTMLElement>) => void } {
  if (!api) return {}
  return {
    draggable: true,
    onDragStart: (e) => {
      onStart?.()
      void start(e, imgs())
    },
  }
}
