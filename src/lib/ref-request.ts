import { auth, errorOf, GENERATE_TIMEOUT, HOST, netError, requestForm, type GenerateBody } from './nai-api'
import { modelInfo } from './nai-models'
import { activeRefs, applyRefParams, directorLayout, MAX_CHARACTER_REFS } from './nai-refs'
import type { DocSettings, VibeRef } from '@/types'

export const ENCODE_VIBE_URL = `${HOST}/ai/encode-vibe`

export class RefError extends Error {
  kind: 'missing' | 'too-many'
  constructor(kind: 'missing' | 'too-many') {
    super(kind)
    this.kind = kind
  }
}

export async function encodeVibe(token: string, image: Blob, model: string, info: number): Promise<Blob> {
  const ctl = new AbortController()
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    ctl.abort()
  }, GENERATE_TIMEOUT)
  try {
    const body = requestForm({ image: 'image', information_extracted: info, model }, { image })
    const res = await fetch(ENCODE_VIBE_URL, { method: 'POST', mode: 'cors', cache: 'no-store', headers: auth(token), body, signal: ctl.signal })
    if (!res.ok) throw await errorOf(res)
    return await res.blob()
  } catch (e) {
    throw netError(e, timedOut)
  } finally {
    clearTimeout(timer)
  }
}

async function draw(blob: Blob, width: number, height: number, paint: (g: OffscreenCanvasRenderingContext2D, bmp: ImageBitmap) => void, bg: string | null): Promise<Blob> {
  const bmp = await createImageBitmap(blob)
  const c = new OffscreenCanvas(width, height)
  const g = c.getContext('2d')!
  if (bg) {
    g.fillStyle = bg
    g.fillRect(0, 0, width, height)
  }
  g.imageSmoothingQuality = 'high'
  paint(g, bmp)
  bmp.close()
  return c.convertToBlob({ type: 'image/png' })
}

/** NovelAI img2img stretches the base to output size and fills white unless the model supports transparency. */
export const baseImagePng = (blob: Blob, width: number, height: number, transparent: boolean) => draw(blob, width, height, (g, bmp) => g.drawImage(bmp, 0, 0, width, height), transparent ? null : '#ffffff')

/** NovelAI precise references use the nearest canvas ratio, centered with black padding unless transparency is supported. */
export async function directorPng(blob: Blob, transparent: boolean): Promise<Blob> {
  const bmp = await createImageBitmap(blob)
  const l = directorLayout(bmp.width, bmp.height)
  bmp.close()
  return draw(blob, l.width, l.height, (g, b) => g.drawImage(b, l.image.x, l.image.y, l.image.width, l.image.height), transparent ? null : '#000000')
}

// NovelAI cache_secret_key is HMAC-SHA256 of base64 image data with a random key scoped to this app session.
let hmacKey: Promise<CryptoKey> | null = null
async function cacheKey(b64: string): Promise<string> {
  hmacKey ??= crypto.subtle.importKey('raw', crypto.getRandomValues(new Uint8Array(32)), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sig = await crypto.subtle.sign('HMAC', await hmacKey, new TextEncoder().encode(b64))
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export const toBase64 = async (b: Blob) => {
  const bytes = new Uint8Array(await b.arrayBuffer())
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}
const fromBase64 = (s: string) => {
  const bin = atob(s)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return new Blob([out], { type: 'application/octet-stream' })
}

/** deps.vibe may spend Anlas encoding a Vibe; reuse its model/information-specific cached encoding when available. */
export async function withRefs(
  body: GenerateBody,
  s: DocSettings,
  deps: { blob(image: string): Promise<Blob | undefined>; vibe(v: VibeRef, model: string): Promise<string> },
): Promise<{ body: GenerateBody; files: Record<string, Blob> }> {
  const { base, vibes, characters } = activeRefs(s)
  if (characters.length > MAX_CHARACTER_REFS) throw new RefError('too-many')
  if (!base && !vibes.length && !characters.length) return { body, files: {} }
  const transparent = modelInfo(s.model).transparency
  const read = async (image: string) => {
    const b = await deps.blob(image)
    if (!b) throw new RefError('missing')
    return b
  }
  const files: Record<string, Blob> = {}
  if (base) files.image = await baseImagePng(await read(base.image), body.parameters.width as number, body.parameters.height as number, transparent)
  const vibeKeys: string[] = []
  for (const [i, v] of vibes.entries()) {
    const code = await deps.vibe(v, body.model)
    vibeKeys.push(await cacheKey(code))
    files[`ref_multiple_${i}`] = fromBase64(code)
  }
  const charKeys: string[] = []
  for (const [i, c] of characters.entries()) {
    const png = await directorPng(await read(c.image), transparent)
    charKeys.push(await cacheKey(await toBase64(png)))
    files[`director_ref_${i}`] = png
  }
  return { body: { ...body, ...applyRefParams(body, s, { vibes: vibeKeys, characters: charKeys }) }, files }
}
