import { assetStore } from '@/store/storage'
import { nanoid } from 'nanoid'
import { useEffect, useState } from 'react'
import { isExampleImage, paintExampleImage } from './example-images'

const PREFIX = 'tpl-img:'
const MAX_EDGE = 1024

export async function prepareImage(file: Blob): Promise<Blob> {
  const bmp = await createImageBitmap(file)
  const k = Math.min(1, MAX_EDGE / Math.max(bmp.width, bmp.height))
  const w = Math.max(1, Math.round(bmp.width * k))
  const h = Math.max(1, Math.round(bmp.height * k))
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('canvas 不可用')
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(bmp, 0, 0, w, h)
  bmp.close()
  const out = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/webp', 0.85))
  if (!out) throw new Error('图片编码失败')
  return out
}

/** Keep images created this session even without references; toast undo may still restore them. */
const savedThisSession = new Set<string>()

export async function saveTemplateImage(blob: Blob): Promise<string> {
  const key = `${PREFIX}${nanoid(10)}`
  savedThisSession.add(key)
  await assetStore.set(key, blob)
  return key
}

const urls = new Map<string, string>()
const pending = new Map<string, Promise<string | null>>()

function loadUrl(key: string): Promise<string | null> {
  const hit = pending.get(key)
  if (hit) return hit
  const p = (isExampleImage(key) ? paintExampleImage(key) : assetStore.get<Blob>(key).then((blob) => (blob ? URL.createObjectURL(blob) : null)))
    .then((url) => {
      if (url) urls.set(key, url)
      return url
    })
    .catch(() => null)
  pending.set(key, p)
  return p
}

export function useTemplateImage(key: string | undefined): string | null {
  const [loaded, setLoaded] = useState<{ key: string; url: string | null } | null>(null)
  useEffect(() => {
    if (!key || urls.has(key)) return
    let alive = true
    void loadUrl(key).then((url) => alive && setLoaded({ key, url }))
    return () => {
      alive = false
    }
  }, [key])
  if (!key) return null
  return urls.get(key) ?? (loaded?.key === key ? loaded.url : null)
}

/** Collect only images unreferenced both at startup and now; retain session-created images for undo. */
export async function gcTemplateImages(atStart: Iterable<string>, used: () => Iterable<string>) {
  try {
    const all = await assetStore.keys(PREFIX)
    const keep = new Set([...atStart, ...used(), ...savedThisSession])
    await Promise.all(all.filter((k) => !keep.has(k)).map((k) => assetStore.del(k)))
  } catch {
  }
}
