export const THUMB_H = 480

export async function makeThumb(blob: Blob): Promise<Blob> {
  const probe = await createImageBitmap(blob)
  const h = Math.min(THUMB_H, probe.height)
  const w = Math.max(1, Math.round((probe.width * h) / probe.height))
  probe.close()
  const bmp = await createImageBitmap(blob, { resizeWidth: w, resizeHeight: h, resizeQuality: 'high' })
  const c = new OffscreenCanvas(w, h)
  c.getContext('2d')!.drawImage(bmp, 0, 0)
  bmp.close()
  return c.convertToBlob({ type: 'image/webp', quality: 0.85 })
}

export async function shrinkJpeg(blob: Blob, long: number): Promise<Blob> {
  const probe = await createImageBitmap(blob)
  const k = Math.min(1, long / Math.max(probe.width, probe.height))
  const w = Math.max(1, Math.round(probe.width * k))
  const h = Math.max(1, Math.round(probe.height * k))
  probe.close()
  const bmp = await createImageBitmap(blob, { resizeWidth: w, resizeHeight: h, resizeQuality: 'high' })
  const c = new OffscreenCanvas(w, h)
  const g = c.getContext('2d')!
  g.fillStyle = '#fff'
  g.fillRect(0, 0, w, h)
  g.drawImage(bmp, 0, 0)
  bmp.close()
  return c.convertToBlob({ type: 'image/jpeg', quality: 0.85 })
}
