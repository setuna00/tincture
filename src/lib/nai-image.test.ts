import { describe, expect, it } from 'vitest'
import { defaultSettings } from '@/store/doc'
import { sampleDoc } from '@/store/sample'
import { MAX_CHARACTERS } from '@/types'
import {
  buildImportedDoc,
  decodeStealthAlpha,
  defaultPicks,
  importItems,
  metaSource,
  parseNaiImage,
  readExifUserComment,
  readPngText,
  UC_PRESET_TEXT,
  type ImageMeta,
  type ImportItem,
} from './nai-image'

function png(chunks: { type: string; data: Uint8Array }[]): Blob {
  const parts: Uint8Array[] = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])]
  for (const c of [...chunks, { type: 'IEND', data: new Uint8Array() }]) {
    const head = new Uint8Array(8)
    new DataView(head.buffer).setUint32(0, c.data.length)
    head.set([...c.type].map((ch) => ch.charCodeAt(0)), 4)
    parts.push(head, c.data, new Uint8Array(4))
  }
  return new Blob(parts as BlobPart[])
}
const enc = (s: string) => new TextEncoder().encode(s)
const cat = (...xs: Uint8Array[]) => {
  const out = new Uint8Array(xs.reduce((n, x) => n + x.length, 0))
  let p = 0
  for (const x of xs) {
    out.set(x, p)
    p += x.length
  }
  return out
}

describe('readPngText', () => {
  it('读 tEXt 和未压缩的 iTXt（NAI 把 prompt 写在 Description / Comment 里）', async () => {
    const blob = png([
      { type: 'tEXt', data: cat(enc('Description'), new Uint8Array([0]), enc('2girls, 1.2::cherry blossoms::')) },
      { type: 'iTXt', data: cat(enc('Comment'), new Uint8Array([0, 0, 0]), new Uint8Array([0]), new Uint8Array([0]), enc('{"uc":"lowres"}')) },
    ])
    expect(await readPngText(blob)).toEqual({ Description: '2girls, 1.2::cherry blossoms::', Comment: '{"uc":"lowres"}' })
  })
  it('tEXt 按 latin1；写的是 UTF-8 时按 UTF-8', async () => {
    const blob = png([
      { type: 'tEXt', data: cat(enc('A'), new Uint8Array([0]), new Uint8Array([0x63, 0x61, 0x66, 0xe9])) },
      { type: 'tEXt', data: cat(enc('B'), new Uint8Array([0]), enc('中文')) },
    ])
    expect(await readPngText(blob)).toEqual({ A: 'café', B: '中文' })
  })
  it('不是 PNG 返回空', async () => {
    expect(await readPngText(new Blob([enc('GIF89a')]))).toEqual({})
  })
})

const BASE =
  '2girls, 1boy, three characters, full body, wide shot, outdoors, stone staircase, daytime, blue sky, distinct outfits, all characters clearly visible, detailed background, high complexity'
const STANDARD = 'very aesthetic, masterpiece, no text'
const LIGHT = 'very aesthetic, amazing quality, no text'
const HEAVY = UC_PRESET_TEXT.heavy
const CHARS = [
  ['girl, short blonde hair, blue eyes, red hoodie, black pleated skirt, white sneakers, smiling, waving', { x: 0.512, y: 0.706 }],
  ['boy, short black hair, green eyes, navy blazer, white shirt, black pants, hands in pockets, neutral expression', { x: 0.137, y: 0.311 }],
  ['girl, long silver hair, purple eyes, green jacket, white skirt, black boots, arms crossed, serious expression', { x: 0.773, y: 0.704 }],
] as const

function meta(o: {
  source?: string
  description: string
  uc: string
  qt?: number | null
  ucp?: number | null
  tb?: boolean | null
  coords?: boolean
  charUc?: string[]
  extra?: Record<string, unknown>
}): ImageMeta {
  const comment = {
    prompt: o.description,
    steps: 28,
    height: 1216,
    width: 832,
    scale: 7,
    cfg_rescale: 0,
    seed: 735531459,
    sampler: 'k_euler_ancestral',
    v4_prompt: { caption: { base_caption: o.description, char_captions: CHARS.map(([c, xy]) => ({ char_caption: c, centers: [xy] })) }, use_coords: o.coords ?? false, use_order: true },
    v4_negative_prompt: { caption: { base_caption: o.uc, char_captions: CHARS.map(([, xy], i) => ({ char_caption: o.charUc?.[i] ?? '', centers: [xy] })) } },
    tag_hint_transparent_background: o.tb ?? null,
    tag_hint_uc_preset: o.ucp === undefined ? 2 : o.ucp,
    tag_hint_qt: o.qt === undefined ? 1 : o.qt,
    uc: o.uc,
    ...o.extra,
  }
  return { Description: o.description, Software: 'NovelAI', Source: o.source ?? 'NovelAI Diffusion V5 0ADF9AB7', Comment: JSON.stringify(comment) }
}

describe('parseNaiImage（样图）', () => {
  it('735531459：Full · Standard · Heavy · Custom 位置 · UC 框空', () => {
    const p = parseNaiImage(meta({ description: `${BASE}, ${STANDARD}`, uc: `nsfw, ${HEAVY}`, coords: true }))
    expect(p).toMatchObject({ v4: true, model: 'v5-full', effort: 'high', mode: 'anime', quality: 'standard', transparent: false, ucPreset: 'heavy', prompt: BASE, uc: '', useCoords: true })
    expect(p.stripped).toEqual({ mode: '', quality: STANDARD, uc: `nsfw, ${HEAVY}` })
    expect(p.characters.map((c) => c.center)).toEqual(CHARS.map(([, xy]) => xy))
    expect(p.characters[1].prompt).toBe(CHARS[1][0])
    expect(p.gen).toEqual({ width: 832, height: 1216, steps: 28, scale: 7, cfgRescale: 0, sampler: 'k_euler_ancestral', seed: 735531459 })
  })
  it('1209116790：Light · 正面末尾 `1.2::smile::,` 剥完留着那个逗号 · UC 框 bad hands', () => {
    const p = parseNaiImage(meta({ description: `${BASE}, 1.2::smile::,, ${LIGHT}`, uc: `nsfw, ${HEAVY}, bad hands, `, qt: 3 }))
    expect(p.quality).toBe('light')
    expect(p.prompt).toBe(`${BASE}, 1.2::smile::,`)
    expect(p.uc).toBe('bad hands, ')
    expect(p.useCoords).toBe(false)
    // NovelAI retains stale Custom centers in metadata even when AI's Choice is selected.
    expect(p.characters[0].center).toEqual({ x: 0.512, y: 0.706 })
  })
  it('2405716865：Curated（DB276663）的 UC 没有 nsfw', () => {
    const p = parseNaiImage(meta({ source: 'NovelAI Diffusion V5 DB276663', description: `${BASE}, ${STANDARD}`, uc: `${HEAVY}, bad hands, ` }))
    expect(p).toMatchObject({ model: 'v5-curated', ucPreset: 'heavy', uc: 'bad hands, ', quality: 'standard', prompt: BASE })
    expect(p.stripped.uc).toBe(HEAVY)
  })
  it('4079949417：Furry · 质量 None · UC None', () => {
    const p = parseNaiImage(meta({ description: `fur dataset, ${BASE}, 1.2::smile::,`, uc: 'bad hands, ', qt: 0, ucp: 0 }))
    expect(p).toMatchObject({ mode: 'furry', quality: 'none', ucPreset: 'none', prompt: `${BASE}, 1.2::smile::,`, uc: 'bad hands, ' })
    expect(p.stripped).toEqual({ mode: 'fur dataset,', quality: '', uc: '' })
  })
  it('2012579807：我们自己拼的图导进 NAI 再出的图（Furry · Light · 角色 2 有负面）', () => {
    const p = parseNaiImage(meta({ description: `fur dataset, test t3, 2girls, ${LIGHT}`, uc: `nsfw, ${HEAVY}, test t3 uc`, qt: 3, coords: true, charUc: ['', 'test t3 char2 uc', ''] }))
    expect(p).toMatchObject({ mode: 'furry', quality: 'light', prompt: 'test t3, 2girls', uc: 'test t3 uc' })
    expect(p.characters.map((c) => c.uc)).toEqual(['', 'test t3 char2 uc', ''])
  })
})

describe('parseNaiImage（规则）', () => {
  it('Effort Medium 按 hash 认', () => {
    expect(parseNaiImage(meta({ source: 'NovelAI Diffusion V5 93F4BD30', description: BASE, uc: '' }))).toMatchObject({ model: 'v5-full', effort: 'medium' })
    expect(parseNaiImage(meta({ source: 'NovelAI Diffusion V5 657484A5', description: BASE, uc: '' }))).toMatchObject({ model: 'v5-full', effort: 'high' })
  })
  it('没有 Source 时用 Comment 里的 model_name + model_hash', () => {
    const m = meta({ description: BASE, uc: '', extra: { model_name: 'NovelAI Diffusion V5', model_hash: '70AB5786' } })
    delete m.Source
    expect(parseNaiImage(m)).toMatchObject({ v4: true, effort: 'medium' })
  })
  it('Text: 存在时质量标签在它前面', () => {
    const p = parseNaiImage(meta({ description: `text, english text, 1girl,, ${STANDARD} Text: Hello, world!\n\nBye`, uc: '' }))
    expect(p.quality).toBe('standard')
    expect(p.prompt).toBe('text, english text, 1girl, Text: Hello, world!\n\nBye')
  })
  it('末尾不是完整的预设原文就不剥', () => {
    const p = parseNaiImage(meta({ description: `${BASE}, masterpiece, no text`, uc: '' }))
    expect(p.quality).toBe('none')
    expect(p.prompt).toBe(`${BASE}, masterpiece, no text`)
  })
  it('整段就是质量标签', () => {
    expect(parseNaiImage(meta({ description: STANDARD, uc: '' }))).toMatchObject({ quality: 'standard', prompt: '' })
  })
  it('hint 对不上时试别的预设', () => {
    expect(parseNaiImage(meta({ description: `${BASE}, ${LIGHT}`, uc: '', qt: 1 }))).toMatchObject({ quality: 'light', prompt: BASE })
  })
  it('hint 是 None 时不猜别的（照 NAI）', () => {
    expect(parseNaiImage(meta({ description: `${BASE}, ${STANDARD}`, uc: '', qt: 0 }))).toMatchObject({ quality: 'none', prompt: `${BASE}, ${STANDARD}` })
  })
  it('透明背景：原文前面多一段 transparent background；质量 None 时整段就是它', () => {
    expect(parseNaiImage(meta({ description: `${BASE}, transparent background, ${STANDARD}`, uc: '', tb: true }))).toMatchObject({ quality: 'standard', transparent: true, prompt: BASE })
    expect(parseNaiImage(meta({ description: `${BASE}, transparent background`, uc: '', qt: 0, tb: true }))).toMatchObject({ quality: 'none', transparent: true, prompt: BASE })
    expect(parseNaiImage(meta({ description: `${BASE}, transparent background, ${STANDARD}`, uc: '' }))).toMatchObject({ transparent: false, prompt: `${BASE}, transparent background` })
  })
  it('UC：Human Focus = Heavy + 4 个词，hint 缺了也先认长的', () => {
    const hf = UC_PRESET_TEXT['human-focus']
    expect(parseNaiImage(meta({ description: BASE, uc: `nsfw, ${hf}, bad hands`, ucp: null }))).toMatchObject({ ucPreset: 'human-focus', uc: 'bad hands' })
    expect(parseNaiImage(meta({ description: BASE, uc: `nsfw, ${hf}`, ucp: 4 }))).toMatchObject({ ucPreset: 'human-focus', uc: '' })
  })
  it('UC：预设是 None 时 nsfw 是用户自己写的，放回去', () => {
    expect(parseNaiImage(meta({ description: BASE, uc: 'nsfw, bad hands', ucp: 0 }))).toMatchObject({ ucPreset: 'none', uc: 'nsfw, bad hands' })
    expect(parseNaiImage(meta({ description: BASE, uc: 'nsfw, bad hands', ucp: 2 }))).toMatchObject({ ucPreset: 'none', uc: 'nsfw, bad hands' })
  })
  it('UC：只有 lowres = 旧版的默认值，当成空', () => {
    expect(parseNaiImage(meta({ description: BASE, uc: 'lowres' }))).toMatchObject({ uc: '', ucPreset: 'none' })
  })
  it('V3 及更早（不是 V4 / V4.5 / V5）：正面 / 负面 / 角色原样，不剥', () => {
    const p = parseNaiImage(meta({ source: 'Stable Diffusion XL C1E1DE52', description: `fur dataset, ${BASE}, ${STANDARD}`, uc: `nsfw, ${HEAVY}` }))
    expect(p).toMatchObject({ v4: false, mode: 'anime', quality: 'none', ucPreset: 'none', prompt: `fur dataset, ${BASE}, ${STANDARD}`, uc: `nsfw, ${HEAVY}` })
    expect(p.characters).toHaveLength(3)
    expect(importItems(p).settings).toEqual([])
  })
  it('缺的生成参数用 V5 默认值，seed 缺了是随机', () => {
    const m = meta({ description: BASE, uc: '' })
    const c = JSON.parse(m.Comment)
    delete c.steps
    delete c.seed
    delete c.sampler
    m.Comment = JSON.stringify(c)
    const p = parseNaiImage(m)
    expect(p.gen).toMatchObject({ steps: 23, sampler: 'k_euler_ancestral', seed: null })
    expect(importItems(p).seed).toEqual([])
  })
})

describe('metaSource', () => {
  it('认 NAI / WebUI / ComfyUI', () => {
    expect(metaSource(meta({ description: BASE, uc: '' }))).toBe('nai')
    expect(metaSource({ parameters: '1girl\nNegative prompt: lowres\nSteps: 20' })).toBe('webui')
    expect(metaSource({ prompt: '{"3":{}}', workflow: '{}' })).toBe('comfyui')
    expect(metaSource({ Title: 'x' })).toBe('other')
  })
})

describe('导入', () => {
  const p = parseNaiImage(meta({ description: `${BASE}, ${STANDARD}`, uc: `nsfw, ${HEAVY}`, coords: true }))
  it('默认勾选：Seed 和空的负面不勾', () => {
    const picks = defaultPicks(p)
    expect(picks.has('seed')).toBe(false)
    expect(picks.has('uc')).toBe(false)
    expect(picks.has('ucPreset')).toBe(true)
    expect(picks.has('char:2')).toBe(true)
    expect(importItems(p).settings).toEqual(['mode', 'quality', 'coords', 'model', 'size', 'steps', 'scale', 'rescale', 'sampler'])
  })
  it('新文档：每个框一个灰色「导入」区块，权重写法保留；角色名留空；不勾的用默认值', () => {
    const q = parseNaiImage(meta({ description: `1girl, 1.2::smile::, ${STANDARD}`, uc: '', qt: 1 }))
    const picks = defaultPicks(q)
    picks.delete('steps')
    const { doc } = buildImportedDoc(q, picks, { base: null, appendChars: false }, defaultSettings())
    expect(doc.meta.title).toBe('未命名')
    expect(doc.base.prompt).toHaveLength(1)
    expect(doc.base.prompt[0]).toMatchObject({ name: '导入', color: 'slate' })
    expect(doc.base.prompt[0].chips.map((c) => [c.text, c.weight])).toEqual([
      ['1girl', 1],
      ['smile', 1.2],
    ])
    expect(doc.base.uc).toEqual([])
    expect(doc.characters.map((c) => c.name)).toEqual(['', '', ''])
    expect(doc.characters[0].center).toEqual({ x: 0.512, y: 0.706 })
    expect(doc.settings.gen.steps).toBe(23)
    expect(doc.settings.gen.seed).toBe(null)
  })
  it('当前文档：勾了的替换，没勾的不动；角色追加 / 替换', () => {
    const base = sampleDoc()
    const picks = new Set<ImportItem>(['char:0', 'quality', 'seed'])
    const replaced = buildImportedDoc(p, picks, { base, appendChars: false }, defaultSettings()).doc
    expect(replaced.base.prompt).toEqual(base.base.prompt)
    expect(replaced.characters).toHaveLength(1)
    expect(replaced.settings).toMatchObject({ qualityTags: 'standard', ucPreset: base.settings.ucPreset })
    expect(replaced.settings.gen.seed).toBe(735531459)
    expect(replaced.meta.title).toBe(base.meta.title)
    const appended = buildImportedDoc(p, picks, { base, appendChars: true }, defaultSettings()).doc
    expect(appended.characters.map((c) => c.name)).toEqual([...base.characters.map((c) => c.name), ''])
  })
  it('追加超过角色上限时截掉', () => {
    const base = sampleDoc()
    base.characters = Array.from({ length: MAX_CHARACTERS - 1 }, () => ({ ...base.characters[0] }))
    const { doc, dropped } = buildImportedDoc(p, defaultPicks(p), { base, appendChars: true }, defaultSettings())
    expect(doc.characters).toHaveLength(MAX_CHARACTERS)
    expect(dropped).toBe(2)
  })
})

async function stealthPixels(json: string, width: number, height: number, compress = true): Promise<Uint8ClampedArray> {
  const raw = enc(json)
  const payload = compress ? new Uint8Array(await new Response(new Blob([raw as BlobPart]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer()) : raw
  const len = payload.length * 8
  const bytes = [...enc(compress ? 'stealth_pngcomp' : 'stealth_pnginfo'), (len >>> 24) & 255, (len >>> 16) & 255, (len >>> 8) & 255, len & 255, ...payload]
  const px = new Uint8ClampedArray(width * height * 4).fill(255)
  bytes.forEach((b, k) => {
    for (let j = 0; j < 8; j++) {
      const i = k * 8 + j
      const x = Math.floor(i / height)
      const y = i % height
      px[(y * width + x) * 4 + 3] = 254 | ((b >> (7 - j)) & 1)
    }
  })
  return px
}

describe('decodeStealthAlpha', () => {
  const json = JSON.stringify({ Description: '1girl, 中文也行', Comment: '{"seed":1}' })
  it('gzip（stealth_pngcomp）', async () => {
    expect(await decodeStealthAlpha(await stealthPixels(json, 40, 30), 40, 30)).toBe(json)
  })
  it('不压缩（stealth_pnginfo）', async () => {
    expect(await decodeStealthAlpha(await stealthPixels(json, 50, 30, false), 50, 30)).toBe(json)
  })
  it('没藏东西 / 图太小', async () => {
    expect(await decodeStealthAlpha(new Uint8ClampedArray(40 * 30 * 4).fill(255), 40, 30)).toBe(null)
    expect(await decodeStealthAlpha(new Uint8ClampedArray(4 * 4 * 4), 4, 4)).toBe(null)
  })
})

describe('readExifUserComment', () => {
  const u32le = (n: number) => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255]
  function webpWithComment(comment: Uint8Array): Uint8Array {
    // TIFF offsets: header 8 bytes; IFD0 at 8 points via 0x8769 to Exif IFD at 26; UserComment data starts at 44.
    const ifd0 = [1, 0, 0x69, 0x87, 4, 0, ...u32le(1), ...u32le(26), ...u32le(0)]
    const exifIfd = [1, 0, 0x86, 0x92, 7, 0, ...u32le(comment.length), ...u32le(44), ...u32le(0)]
    const tiff = new Uint8Array([0x49, 0x49, 42, 0, ...u32le(8), ...ifd0, ...exifIfd, ...comment])
    const pad = tiff.length & 1 ? [0] : []
    const body = [...enc('WEBP'), ...enc('EXIF'), ...u32le(tiff.length), ...tiff, ...pad]
    return new Uint8Array([...enc('RIFF'), ...u32le(body.length), ...body])
  }
  it('UNICODE（UTF-16LE 带 BOM）和 ASCII 两种开头，去掉末尾的 \\0', () => {
    const json = '{"Description":"1girl"}'
    const utf16 = new Uint8Array([...enc('UNICODE\0'), 0xff, 0xfe, ...[...json].flatMap((ch) => [ch.charCodeAt(0), 0]), 0, 0])
    expect(readExifUserComment(webpWithComment(utf16))).toBe(json)
    const ascii = new Uint8Array([...enc('ASCII\0\0\0'), ...enc(json), 0])
    expect(readExifUserComment(webpWithComment(ascii))).toBe(json)
  })
})
