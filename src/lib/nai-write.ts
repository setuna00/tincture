// Clipboard handling strips PNG text chunks; alpha metadata also avoids Latin-1 corruption of non-Latin text.
import { basePrompt, characterPrompt, exportString } from './nai'
import { TEXT_START, TRANSPARENT, hintNumber } from './nai-image'
import { effectiveNoise, mapQuality, mapUcPreset, modelCenter, modelInfo, qualityText, sourceString, ucText, varietySigma } from './nai-models'
import type { Doc, DocSettings, GenParams } from '@/types'

export const MEDIUM_FIXED = { steps: 14, sampler: 'k_euler_ancestral', ucPreset: 'heavy' } as const

/** NovelAI Medium applies only to V5 Full and fixes steps/sampler/UC while disabling rescale. */
export function effectiveSettings(s: DocSettings): DocSettings {
  const info = modelInfo(s.model)
  const medium = s.model === 'v5-full' && s.effort === 'medium'
  const effort = s.model === 'v5-full' ? s.effort : 'high'
  const qualityTags = mapQuality(s.qualityTags, s.model)
  const ucPreset = medium ? MEDIUM_FIXED.ucPreset : mapUcPreset(s.ucPreset, s.model)
  const transparent = s.transparent && info.transparency
  const dropVariety = !!s.gen.varietyPlus && info.varietySigma === null
  const dropLegacy = !!s.gen.legacyUc && !info.legacyUc
  if (!medium && !dropVariety && !dropLegacy && effort === s.effort && qualityTags === s.qualityTags && ucPreset === s.ucPreset && transparent === s.transparent) return s
  let gen = s.gen
  if (medium) gen = { ...gen, steps: MEDIUM_FIXED.steps, sampler: MEDIUM_FIXED.sampler, cfgRescale: 0 }
  if (dropVariety) gen = { ...gen, varietyPlus: false }
  if (dropLegacy) gen = { ...gen, legacyUc: false }
  return { ...s, effort, qualityTags, ucPreset, transparent, gen }
}

/** NovelAI appends transparency then quality before Text:, and adds the Furry prefix last; settings must be effective. */
export function composePrompt(prompt: string, s: DocSettings): string {
  const q = qualityText(s.model, s.qualityTags)
  const suffix = s.transparent ? (q ? `${TRANSPARENT}, ${q}` : TRANSPARENT) : q
  let out = prompt
  if (suffix) {
    const m = TEXT_START.exec(out)
    const head = m ? out.slice(0, m.index) : out
    const tail = m ? out.slice(m.index) : ''
    out = (head ? `${head}, ${suffix}` : suffix) + tail
  }
  if (s.mode === 'furry' && !out.startsWith('fur dataset') && !out.startsWith('background dataset')) out = `fur dataset, ${out}`
  return out
}

/** NovelAI adds negative nsfw only for non-safe models with a UC preset and no nsfw in the positive prompt. */
export const naiAddsNsfw = (s: DocSettings, prompt: string) => !modelInfo(s.model).safe && !!ucText(s.model, s.ucPreset) && !prompt.toLowerCase().includes('nsfw')

/** NovelAI prepends the UC preset; its nsfw check uses the positive after quality tags but before the Furry prefix. */
export function composeUc(uc: string, s: DocSettings, prompt: string): string {
  const head = ucText(s.model, s.ucPreset)
  const body = !head ? uc : uc ? `${head}, ${uc}` : head
  return naiAddsNsfw(s, prompt) ? `nsfw, ${body}` : body
}

/** NovelAI resets omitted Comment parameters to defaults on import, so include every generation parameter. */
export function naiComment(doc: Doc) {
  const s = effectiveSettings(doc.settings)
  const info = modelInfo(s.model)
  const g: GenParams = s.gen
  const withQuality = composePrompt(basePrompt(doc), { ...s, mode: 'anime' })
  const prompt = composePrompt(basePrompt(doc), s)
  const uc = composeUc(exportString(doc.base.uc), s, withQuality)
  const chars = doc.characters.filter((c) => c.enabled)
  const centers = (c: Doc['characters'][number]) => [modelCenter(s.model, c.center)]
  const legacyUc = !!g.legacyUc
  const sigma = varietySigma(s.model, g)
  return {
    prompt,
    steps: g.steps,
    height: g.height,
    width: g.width,
    scale: g.scale,
    uncond_scale: 0,
    cfg_rescale: g.cfgRescale,
    // Omit random seeds so NovelAI does not import them as a fixed seed.
    ...(g.seed === null ? {} : { seed: g.seed }),
    n_samples: 1,
    noise_schedule: effectiveNoise(s.model, g),
    ...(sigma === undefined ? {} : { skip_cfg_above_sigma: sigma }),
    v4_prompt: {
      caption: { base_caption: prompt, char_captions: chars.map((c) => ({ char_caption: characterPrompt(c), centers: centers(c) })) },
      use_coords: s.useCoords,
      use_order: true,
      legacy_uc: legacyUc,
    },
    v4_negative_prompt: {
      caption: { base_caption: uc, char_captions: chars.map((c) => ({ char_caption: exportString(c.uc), centers: centers(c) })) },
      use_coords: false,
      use_order: false,
      legacy_uc: legacyUc,
    },
    sampler: g.sampler,
    ...(info.transparency ? { tag_hint_transparent_background: s.transparent } : {}),
    tag_hint_uc_preset: hintNumber(s.ucPreset),
    tag_hint_qt: hintNumber(s.qualityTags),
    version: 1,
    uc,
    request_type: 'PromptGenerateRequest',
  }
}

/** NovelAI Description is the composed positive prompt; Comment is a JSON string, not a nested object. */
export function naiMetadata(doc: Doc): Record<string, string> {
  const comment = naiComment(doc)
  return {
    Description: comment.prompt,
    Software: 'NovelAI',
    Source: sourceString(effectiveSettings(doc.settings)),
    Comment: JSON.stringify(comment),
  }
}

const SIG = 'stealth_pngcomp'

async function gzip(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new CompressionStream('gzip'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

/** NovelAI stealth payloads prefix gzip JSON with the signature and a 32-bit big-endian length in bits, not bytes. */
export async function stealthPayload(meta: Record<string, string>): Promise<Uint8Array> {
  const gz = await gzip(new TextEncoder().encode(JSON.stringify(meta)))
  const out = new Uint8Array(SIG.length + 4 + gz.length)
  out.set([...SIG].map((c) => c.charCodeAt(0)))
  new DataView(out.buffer).setUint32(SIG.length, gz.length * 8)
  out.set(gz, SIG.length + 4)
  return out
}

/** NovelAI reads alpha bits column-first; encode 1 as 255 and 0 as 254 so metadata remains visually opaque. */
export function writeStealthAlpha(rgba: Uint8ClampedArray | Uint8Array, width: number, height: number, payload: Uint8Array): boolean {
  const bits = payload.length * 8
  if (bits > width * height) return false
  for (let i = 0; i < width * height; i++) {
    const idx = ((i % height) * width + Math.floor(i / height)) * 4 + 3
    rgba[idx] = i < bits ? 254 | ((payload[i >> 3] >> (7 - (i & 7))) & 1) : 255
  }
  return true
}

const INK = '#2a2d3a'
const INK_2 = '#5b6070'
const GRID = '#d5d8e0'
const BG = '#eef0f4'
const FONT = '"IBM Plex Sans Variable", "IBM Plex Sans", "PingFang SC", "Microsoft YaHei", sans-serif'
const MONO = '"IBM Plex Mono", ui-monospace, monospace'

export function cardSize(gen: Pick<GenParams, 'width' | 'height'>, bits: number) {
  const ratio = gen.height / gen.width
  let w = 384
  while (w * Math.round(w * ratio) < bits) w += 64
  return { width: w, height: Math.round(w * ratio) }
}

function drawCard(g: CanvasRenderingContext2D, w: number, h: number, doc: Doc) {
  const s = effectiveSettings(doc.settings)
  const u = w / 384
  g.fillStyle = BG
  g.fillRect(0, 0, w, h)
  g.strokeStyle = GRID
  g.lineWidth = Math.max(1, u)
  for (const f of [1 / 3, 2 / 3]) {
    g.beginPath()
    g.moveTo(Math.round(w * f) + 0.5, 0)
    g.lineTo(Math.round(w * f) + 0.5, h)
    g.moveTo(0, Math.round(h * f) + 0.5)
    g.lineTo(w, Math.round(h * f) + 0.5)
    g.stroke()
  }
  const pad = 20 * u
  g.fillStyle = INK
  g.font = `600 ${30 * u}px ${FONT}`
  g.textBaseline = 'top'
  let title = doc.meta.title.trim() || '未命名'
  while (title.length > 1 && g.measureText(title).width > w - pad * 2) title = title.slice(0, -2) + '…'
  g.fillText(title, pad, pad)

  const chars = doc.characters.map((c, i) => ({ c, n: i + 1 })).filter(({ c }) => c.enabled)
  if (s.useCoords) {
    const r = 17 * u
    for (const { c, n } of chars) {
      const x = c.center.x * w
      const y = c.center.y * h
      g.beginPath()
      g.arc(x, y, r, 0, Math.PI * 2)
      g.fillStyle = '#fff'
      g.fill()
      g.lineWidth = 3 * u
      g.strokeStyle = INK
      g.stroke()
      g.fillStyle = INK
      g.font = `700 ${17 * u}px ${MONO}`
      g.textAlign = 'center'
      g.textBaseline = 'middle'
      g.fillText(String(n), x, y + u)
      g.textAlign = 'start'
    }
  }
  const sampler = s.gen.sampler === 'k_euler_ancestral' ? 'Euler a' : s.gen.sampler.replace(/^k_/, '')
  const lines = [`${s.gen.width}×${s.gen.height} · ${s.gen.steps} steps · ${sampler}`]
  if (chars.length) lines.unshift(`${chars.length} 个角色 · ${s.useCoords ? 'Custom' : "AI's Choice"}`)
  g.fillStyle = INK_2
  g.textBaseline = 'alphabetic'
  lines.forEach((line, i) => {
    g.font = `${i === lines.length - 1 ? '' : '500 '}${17 * u}px ${i === lines.length - 1 ? MONO : FONT}`
    g.fillText(line, pad, h - pad - (lines.length - 1 - i) * 26 * u)
  })
}

export async function naiImageBlob(doc: Doc): Promise<Blob> {
  const payload = await stealthPayload(naiMetadata(doc))
  const { width, height } = cardSize(effectiveSettings(doc.settings).gen, payload.length * 8)
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const g = canvas.getContext('2d', { willReadFrequently: true })
  if (!g) throw new Error('canvas 2d 不可用')
  await document.fonts?.ready
  drawCard(g, width, height, doc)
  const img = g.getImageData(0, 0, width, height)
  writeStealthAlpha(img.data, width, height, payload)
  g.putImageData(img, 0, 0)
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob 失败'))), 'image/png'))
}
