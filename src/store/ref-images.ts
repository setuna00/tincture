// Encoding keys use vibe-enc:<first 24 hash characters>:<model without nai-diffusion->:<information level> to fit the 100-character path limit.
import { useEffect, useState } from 'react'
import { create } from 'zustand'
import { checkImageFile, checkImageSize } from '@/lib/import-budget'
import type { RefImage } from '@/types'
import { assetStore } from './storage'

const REF = 'ref-img:'
const ENC = 'vibe-enc:'

export async function sha256Hex(data: BufferSource): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', data)
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

const blobs = new Map<string, Blob>()
const urls = new Map<string, string>()

export async function putRefImage(blob: Blob): Promise<RefImage> {
  await checkImageFile(blob)
  const image = await sha256Hex(await blob.arrayBuffer())
  const size = await referenceSize(blob)
  if (!blobs.has(image)) {
    blobs.set(image, blob)
    await assetStore.set(REF + image, blob)
  }
  return { image, ...size }
}

export async function putRefImageAs(image: string, blob: Blob): Promise<{ width: number; height: number }> {
  await checkImageFile(blob)
  const size = await referenceSize(blob)
  if (!blobs.has(image)) {
    blobs.set(image, blob)
    await assetStore.set(REF + image, blob)
  }
  return size
}

async function referenceSize(blob: Blob) {
  const bmp = await createImageBitmap(blob)
  try {
    checkImageSize(bmp.width, bmp.height)
    return { width: bmp.width, height: bmp.height }
  } finally {
    bmp.close()
  }
}

export async function refBlob(image: string): Promise<Blob | undefined> {
  const hit = blobs.get(image)
  if (hit) return hit
  const b = await assetStore.get<Blob>(REF + image).catch(() => undefined)
  if (b) blobs.set(image, b)
  return b
}

export function useRefUrl(image: string): string | null {
  const [got, setGot] = useState<{ image: string; url: string } | null>(null)
  useEffect(() => {
    if (urls.has(image)) return
    let live = true
    void refBlob(image).then((b) => {
      if (!b || !live) return
      let u = urls.get(image)
      if (!u) urls.set(image, (u = URL.createObjectURL(b)))
      setGot({ image, url: u })
    })
    return () => {
      live = false
    }
  }, [image])
  return urls.get(image) ?? (got?.image === image ? got.url : null)
}

/** NAI encodings depend on both model and information level; neither can share an encoding with another value. */
export const vibeCodeKey = (image: string, model: string, info: number) => `${image.slice(0, 24)}:${model.replace(/^nai-diffusion-/, '')}:${info.toFixed(2)}`

export const useVibeCodes = create<{ have: Set<string> }>(() => ({ have: new Set() }))

const codes = new Map<string, string>()

let loading: Promise<void> | null = null
export function loadVibeCodes(): Promise<void> {
  loading ??= assetStore
    .keys(ENC)
    .then((ks) => useVibeCodes.setState((s) => ({ have: new Set([...s.have, ...ks.map((k) => k.slice(ENC.length))]) })))
    .catch(() => {
      loading = null
    })
  return loading
}

export async function vibeCode(key: string): Promise<string | null> {
  const hit = codes.get(key)
  if (hit) return hit
  await loadVibeCodes()
  if (!useVibeCodes.getState().have.has(key)) return null
  const b = await assetStore.get<Blob>(ENC + key).catch(() => undefined)
  if (!b) return null
  const s = await blobBase64(b)
  codes.set(key, s)
  return s
}

export async function vibeCodesOf(image: string): Promise<{ model: string; info: number; key: string }[]> {
  await loadVibeCodes()
  const head = `${image.slice(0, 24)}:`
  return [...useVibeCodes.getState().have]
    .filter((k) => k.startsWith(head))
    .map((key) => {
      const [, model, info] = key.split(':')
      return { model, info: Number(info), key }
    })
}

export async function putVibeCode(key: string, data: Blob) {
  codes.set(key, await blobBase64(data))
  useVibeCodes.setState((s) => ({ have: new Set([...s.have, key]) }))
  await assetStore.set(ENC + key, new Blob([data], { type: 'application/octet-stream' }))
}

export async function blobBase64(b: Blob): Promise<string> {
  const bytes = new Uint8Array(await b.arrayBuffer())
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}
