// NovelAI Vibe ids hash base64 text: original-file base64 for type=image, encoding base64 for type=encoding.
// NovelAI indexes encodings by model and SHA-256 of 'information_extracted:<value>'; encoding-only parameter keys are 'unknown'.
// Embedded NovelAI Vibes use PNG tEXt key naidata containing base64-encoded Vibe or bundle JSON.
import { MODELS } from './nai-models'
import { CHARACTER_REF_TYPES } from './nai-refs'
import { checkFileSize } from './import-budget'
import { inflateBudget, spend, TooLargeError } from './inflate'
import type { CharacterRefType, ModelId } from '@/types'

export const VIBE_ID = 'novelai-vibe-transfer'
export const BUNDLE_ID = 'novelai-vibe-transfer-bundle'
export const VIBE_EXT = '.naiv4vibe'
export const BUNDLE_EXT = '.naiv4vibebundle'
export const CHARACTER_ZIP_NAME = 'reference_images.zip'
export const VIBE_TEXT_LIMIT = 64 * 1024 * 1024
export const VIBE_MAX_ENTRIES = 1000
export const VIBE_ENCODED_LIMIT = 48 * 1024 * 1024

export const vibeImportBudget = () => ({ entries: inflateBudget(VIBE_MAX_ENTRIES), encoded: inflateBudget(VIBE_ENCODED_LIMIT) })
type VibeImportBudget = ReturnType<typeof vibeImportBudget>

function checkVibeText(text: string) {
  if (text.length > VIBE_TEXT_LIMIT) throw new TooLargeError()
  checkFileSize(new Blob([text]), VIBE_TEXT_LIMIT)
}

export async function readVibeFile(file: Blob, budget = vibeImportBudget()) {
  checkFileSize(file, VIBE_TEXT_LIMIT)
  return parseVibeText(await file.text(), budget)
}

const ENC_KEY: Record<ModelId, string> = {
  'v4-curated': 'v4curated',
  'v4-full': 'v4full',
  'v45-curated': 'v4-5curated',
  'v45-full': 'v4-5full',
  'v5-curated': 'v5curated',
  'v5-full': 'v5full',
}
const MODEL_OF_KEY = Object.fromEntries(Object.entries(ENC_KEY).map(([m, k]) => [k, m as ModelId])) as Record<string, ModelId>
const MODEL_OF_API = Object.fromEntries(Object.values(MODELS).map((m) => [m.api, m.id])) as Record<string, ModelId>
export const modelOfApi = (api: unknown): ModelId | undefined => (typeof api === 'string' ? (MODEL_OF_API[api] ?? (api === 'nai-diffusion-5-full-medium' ? 'v5-full' : undefined)) : undefined)

export async function sha256Text(s: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export const paramsKey = (info: number) => sha256Text(`information_extracted:${info}`)

export interface VibeEncoding {
  model: ModelId
  info: number
  data: string
}

export interface ParsedVibe {
  image?: string
  thumbnail?: string
  encodings: VibeEncoding[]
  model?: ModelId
  info?: number
  strength?: number
}

const num = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? x : undefined)

function parseOne(o: unknown, budget: VibeImportBudget): ParsedVibe | null {
  spend(budget.entries, 1)
  if (!o || typeof o !== 'object') return null
  const v = o as Record<string, unknown>
  for (const value of [v.image, v.thumbnail]) if (typeof value === 'string') spend(budget.encoded, value.length)
  if (v.identifier !== VIBE_ID) return null
  const ii = (v.importInfo ?? {}) as Record<string, unknown>
  const out: ParsedVibe = { encodings: [], model: modelOfApi(ii.model), info: num(ii.information_extracted), strength: num(ii.strength) }
  if (typeof v.thumbnail === 'string' && /^data:image\/[^;]+;base64,/.test(v.thumbnail)) out.thumbnail = v.thumbnail
  const encs = (v.encodings && typeof v.encodings === 'object' ? v.encodings : {}) as Record<string, Record<string, { encoding?: unknown; params?: { information_extracted?: unknown; mask?: unknown } }>>
  // Iterate lazily so an oversized object is stopped before materializing all its entries.
  for (const key in encs) {
    spend(budget.entries, 1)
    const byParams = encs[key]
    const model = MODEL_OF_KEY[key]
    if (!byParams || typeof byParams !== 'object') continue
    for (const pk in byParams) {
      const e = byParams[pk]
      spend(budget.entries, 1)
      if (typeof e?.encoding === 'string') spend(budget.encoded, e.encoding.length)
      if (!model) continue
      if (typeof e?.encoding !== 'string' || e.params?.mask != null) continue
      // Encoding-only files use the 'unknown' parameter key; information comes from importInfo, defaulting to 1.
      const info = num(e.params?.information_extracted) ?? (pk === 'unknown' ? (out.info ?? 1) : undefined)
      if (info === undefined) continue
      out.encodings.push({ model, info, data: e.encoding })
    }
  }
  if (v.type === 'image') {
    if (typeof v.image !== 'string' || !v.image) return null
    out.image = v.image
  } else if (v.type === 'encoding') {
    if (!out.encodings.length) return null
    // NovelAI imports only the first encoding from encoding-only files.
    out.encodings = out.encodings.slice(0, 1)
    out.info = out.encodings[0].info
    out.model ??= out.encodings[0].model
  } else return null
  return out
}

export function parseVibeText(text: string, budget = vibeImportBudget()): ParsedVibe[] | null {
  checkVibeText(text)
  let o: unknown
  try {
    o = JSON.parse(text)
  } catch {
    return null
  }
  if (!o || typeof o !== 'object') return null
  const id = (o as { identifier?: unknown }).identifier
  if (id === VIBE_ID) {
    const one = parseOne(o, budget)
    return one ? [one] : null
  }
  if (id === BUNDLE_ID) {
    const list = (o as { vibes?: unknown }).vibes
    if (!Array.isArray(list)) return null
    if (list.length > budget.entries.left) throw new TooLargeError()
    return list.map((v) => parseOne(v, budget)).filter((x): x is ParsedVibe => !!x)
  }
  return null
}

export function embeddedVibeText(naidata: string | undefined): string | null {
  if (!naidata) return null
  if (naidata.length > Math.ceil(VIBE_TEXT_LIMIT / 3) * 4) throw new TooLargeError()
  try {
    const bin = atob(naidata.trim())
    const text = new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)))
    checkVibeText(text)
    const id = (JSON.parse(text) as { identifier?: unknown }).identifier
    return id === VIBE_ID || id === BUNDLE_ID ? text : null
  } catch (e) {
    if (e instanceof TooLargeError) throw e
    return null
  }
}

export interface VibeExport {
  image?: string
  thumbnail?: string
  encodings: VibeEncoding[]
  model: ModelId
  info: number
  strength: number
  createdAt: number
}

/** NovelAI Vibe serialization stores createdAt in milliseconds. */
export async function vibeObject(v: VibeExport) {
  const encodings: Record<string, Record<string, { encoding: string; params?: { information_extracted: number } }>> = {}
  let id: string
  if (v.image) {
    for (const e of v.encodings) (encodings[ENC_KEY[e.model]] ??= {})[await paramsKey(e.info)] = { encoding: e.data, params: { information_extracted: e.info } }
    id = await sha256Text(v.image)
  } else {
    const e = v.encodings[0]
    encodings[ENC_KEY[e.model]] = { unknown: { encoding: e.data, params: { information_extracted: e.info } } }
    id = await sha256Text(e.data)
  }
  return {
    identifier: VIBE_ID,
    version: 1,
    type: v.image ? 'image' : 'encoding',
    ...(v.image ? { image: v.image } : {}),
    id,
    encodings,
    name: `${id.slice(0, 6)}-${id.slice(-6)}`,
    ...(v.thumbnail ? { thumbnail: v.thumbnail } : {}),
    createdAt: v.createdAt,
    importInfo: { model: MODELS[v.model].api, information_extracted: v.info, strength: v.strength },
  }
}

export async function vibeFile(v: VibeExport): Promise<{ name: string; text: string }> {
  const o = await vibeObject(v)
  return { name: `${o.name}${VIBE_EXT}`, text: JSON.stringify(o, null, 2) }
}

export async function bundleFile(vs: VibeExport[], now = new Date()): Promise<{ name: string; text: string }> {
  const vibes = []
  for (const v of vs) vibes.push(await vibeObject(v))
  return { name: `${now.toISOString().slice(0, 10)}${BUNDLE_EXT}`, text: JSON.stringify({ identifier: BUNDLE_ID, version: 1, vibes }, null, 2) }
}

export const isVibeFileName = (name: string) => /\.naiv4vibe(bundle)?$/i.test(name)
export const isZipFile = (f: { name: string; type: string }) => /\.zip$/i.test(f.name) || f.type === 'application/zip' || f.type === 'application/x-zip-compressed'

export interface CharacterZipItem {
  filename: string
  data: Uint8Array
  description: CharacterRefType
  strength: number
  fidelity: number
  enabled: boolean
}

export function parseCharacterZip(entries: { name: string; data: Uint8Array }[]): CharacterZipItem[] | null {
  const meta = entries.find((e) => e.name === 'metadata.json')
  if (!meta) return null
  let list: unknown
  try {
    list = JSON.parse(new TextDecoder().decode(meta.data))
  } catch {
    return null
  }
  if (!Array.isArray(list)) return null
  const files = new Map(entries.map((e) => [e.name, e.data]))
  const out: CharacterZipItem[] = []
  for (const m of list as Record<string, unknown>[]) {
    const data = typeof m?.filename === 'string' ? files.get(m.filename) : undefined
    if (!data) continue
    const d = m.description as CharacterRefType
    out.push({
      filename: m.filename as string,
      data,
      description: CHARACTER_REF_TYPES.includes(d) ? d : 'character&style',
      strength: num(m.strength) ?? 1,
      fidelity: num(m.fidelity) ?? 1,
      enabled: m.enabled !== false,
    })
  }
  return out
}

const EXT: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' }

export function characterZipEntries(items: { type: string; data: Uint8Array; description: CharacterRefType; strength: number; fidelity: number; enabled: boolean }[]) {
  const entries: { name: string; data: Uint8Array }[] = []
  const meta = items.map((c, i) => {
    const filename = `reference_${i + 1}.${EXT[c.type] ?? 'png'}`
    entries.push({ name: filename, data: c.data })
    return { filename, description: c.description, fidelity: c.fidelity, strength: c.strength, information_extracted: 1, enabled: c.enabled }
  })
  entries.push({ name: 'metadata.json', data: new TextEncoder().encode(JSON.stringify(meta, null, 2)) })
  return entries
}
