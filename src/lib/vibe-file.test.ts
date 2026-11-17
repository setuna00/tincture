import { describe, expect, it } from 'vitest'
import { bundleFile, characterZipEntries, embeddedVibeText, isVibeFileName, isZipFile, modelOfApi, paramsKey, parseCharacterZip, parseVibeText, vibeFile } from './vibe-file'
import { readZip, writeZip } from './zip'

const IMG = btoa('fake png bytes')
const hex = async (s: string) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))].map((b) => b.toString(16).padStart(2, '0')).join('')
const HASHED = [IMG, 'information_extracted:0.7', 'information_extracted:0.7,mask:"m"', 'information_extracted:1', 'E', 'E2']
const pre = new Map(await Promise.all(HASHED.map(async (x) => [x, await hex(x)] as const)))
const sha = (s: string) => pre.get(s)!

const naiFile = {
  identifier: 'novelai-vibe-transfer',
  version: 1,
  type: 'image',
  image: IMG,
  id: sha(IMG),
  encodings: {
    'v4-5full': {
      [sha('information_extracted:0.7')]: { encoding: 'ENC-45F-07', params: { information_extracted: 0.7 } },
      [sha('information_extracted:0.7,mask:"m"')]: { encoding: 'ENC-MASK', params: { information_extracted: 0.7, mask: 'm' } },
    },
    v4curated: { [sha('information_extracted:1')]: { encoding: 'ENC-4C-1', params: { information_extracted: 1 } } },
  },
  name: 'abc-def',
  thumbnail: 'data:image/jpeg;base64,AAAA',
  createdAt: 1762300000000,
  importInfo: { model: 'nai-diffusion-4-5-full', information_extracted: 0.7, strength: 0.45 },
}

describe('.naiv4vibe', () => {
  it('读 NAI 的文件：原图、缩略图、编码按模型 / 信息量，跳过带蒙版的', () => {
    const [v] = parseVibeText(JSON.stringify(naiFile))!
    expect(v.image).toBe(IMG)
    expect(v.thumbnail).toBe('data:image/jpeg;base64,AAAA')
    expect(v.encodings).toEqual([
      { model: 'v45-full', info: 0.7, data: 'ENC-45F-07' },
      { model: 'v4-curated', info: 1, data: 'ENC-4C-1' },
    ])
    expect([v.model, v.info, v.strength]).toEqual(['v45-full', 0.7, 0.45])
  })

  it('只有编码的：信息量取 importInfo，没有原图', () => {
    const f = { ...naiFile, type: 'encoding', image: undefined, thumbnail: undefined, id: sha('E'), encodings: { 'v4-5curated': { unknown: { encoding: 'E' } } }, importInfo: { model: 'nai-diffusion-4-5-curated', information_extracted: 0.5, strength: 0.6 } }
    const [v] = parseVibeText(JSON.stringify(f))!
    expect(v.image).toBeUndefined()
    expect(v.encodings).toEqual([{ model: 'v45-curated', info: 0.5, data: 'E' }])
    expect(v.info).toBe(0.5)
  })

  it('不认的：不是 JSON、identifier 不对、image 类型没有图、encoding 类型没有编码', () => {
    expect(parseVibeText('nope')).toBeNull()
    expect(parseVibeText(JSON.stringify({ identifier: 'x' }))).toBeNull()
    expect(parseVibeText(JSON.stringify({ ...naiFile, image: '' }))).toBeNull()
    expect(parseVibeText(JSON.stringify({ ...naiFile, type: 'encoding', encodings: {} }))).toBeNull()
  })

  it('写出来 NAI 认：id = sha256(图的 base64)，参数键 = sha256("information_extracted:0.7")，createdAt 是毫秒数', async () => {
    expect(await paramsKey(0.7)).toBe(sha('information_extracted:0.7'))
    const f = await vibeFile({ image: IMG, thumbnail: 'data:image/png;base64,BB', encodings: [{ model: 'v45-full', info: 0.7, data: 'X' }], model: 'v45-full', info: 0.7, strength: 0.6, createdAt: 5 })
    const o = JSON.parse(f.text)
    expect(o.id).toBe(sha(IMG))
    expect(f.name).toBe(`${o.id.slice(0, 6)}-${o.id.slice(-6)}.naiv4vibe`)
    expect(o.type).toBe('image')
    expect(o.encodings['v4-5full'][sha('information_extracted:0.7')]).toEqual({ encoding: 'X', params: { information_extracted: 0.7 } })
    expect(o.importInfo).toEqual({ model: 'nai-diffusion-4-5-full', information_extracted: 0.7, strength: 0.6 })
    expect(o.createdAt).toBe(5)
    expect(parseVibeText(f.text)![0]).toMatchObject({ image: IMG, encodings: [{ model: 'v45-full', info: 0.7, data: 'X' }], strength: 0.6 })
  })

  it('没编过也能写（encodings 空）；只有编码的写成 encoding 类型、id = sha256(编码)', async () => {
    const a = JSON.parse((await vibeFile({ image: IMG, encodings: [], model: 'v4-full', info: 1, strength: 0.6, createdAt: 0 })).text)
    expect(a.encodings).toEqual({})
    const b = JSON.parse((await vibeFile({ encodings: [{ model: 'v4-full', info: 1, data: 'E2' }], model: 'v4-full', info: 1, strength: 0.6, createdAt: 0 })).text)
    expect([b.type, b.id, b.image]).toEqual(['encoding', sha('E2'), undefined])
    expect(b.encodings).toEqual({ v4full: { unknown: { encoding: 'E2', params: { information_extracted: 1 } } } })
  })

  it('bundle：文件名是日期，读回来几张', async () => {
    const one = { image: IMG, encodings: [], model: 'v45-full' as const, info: 0.7, strength: 0.6, createdAt: 0 }
    const f = await bundleFile([one, { ...one, image: btoa('other') }], new Date('2026-11-04T10:00:00Z'))
    expect(f.name).toBe('2026-11-04.naiv4vibebundle')
    expect(JSON.parse(f.text).identifier).toBe('novelai-vibe-transfer-bundle')
    expect(parseVibeText(f.text)!.map((v) => v.image)).toEqual([IMG, btoa('other')])
  })

  it('图片里藏的（naidata = base64 JSON）', () => {
    const text = JSON.stringify(naiFile)
    const b64 = btoa(String.fromCharCode(...new TextEncoder().encode(text)))
    expect(embeddedVibeText(b64)).toBe(text)
    expect(embeddedVibeText(btoa('{"identifier":"other"}'))).toBeNull()
    expect(embeddedVibeText(undefined)).toBeNull()
  })

  it('文件名 / 类型 / 模型', () => {
    expect([isVibeFileName('a.naiv4vibe'), isVibeFileName('a.NAIV4VIBEBUNDLE'), isVibeFileName('a.naiv4vibebundle.png')]).toEqual([true, true, false])
    expect([isZipFile({ name: 'r.zip', type: '' }), isZipFile({ name: 'x', type: 'application/x-zip-compressed' }), isZipFile({ name: 'a.png', type: 'image/png' })]).toEqual([true, true, false])
    expect([modelOfApi('nai-diffusion-4-curated-preview'), modelOfApi('nai-diffusion-5-full-medium'), modelOfApi('x')]).toEqual(['v4-curated', 'v5-full', undefined])
  })
})

describe('精准参考 ZIP', () => {
  it('写出来再读回来（文件名 reference_N.扩展名、metadata.json）', async () => {
    const a = new Uint8Array([1, 2, 3])
    const b = new Uint8Array([9, 8])
    const zip = writeZip(
      characterZipEntries([
        { type: 'image/png', data: a, description: 'character', strength: 0.8, fidelity: 0.5, enabled: true },
        { type: 'image/webp', data: b, description: 'style', strength: 1, fidelity: 1, enabled: false },
      ]),
    )
    const entries = await readZip(zip)
    expect(entries.map((e) => e.name)).toEqual(['reference_1.png', 'reference_2.webp', 'metadata.json'])
    const meta = JSON.parse(new TextDecoder().decode(entries[2].data))
    expect(meta[0]).toEqual({ filename: 'reference_1.png', description: 'character', fidelity: 0.5, strength: 0.8, information_extracted: 1, enabled: true })
    const items = parseCharacterZip(entries)!
    expect(items.map((i) => [i.filename, [...i.data], i.description, i.strength, i.fidelity, i.enabled])).toEqual([
      ['reference_1.png', [1, 2, 3], 'character', 0.8, 0.5, true],
      ['reference_2.webp', [9, 8], 'style', 1, 1, false],
    ])
  })

  it('NAI 的 metadata：缺 enabled = 开、不认的类型按角色和画风、找不到图的跳过；没有 metadata.json = null', () => {
    const meta = [
      { filename: 'a.png', description: 'character&style', strength: 0.7, fidelity: 0.9, information_extracted: 1 },
      { filename: 'b.png', description: 'background', strength: 1, fidelity: 1 },
      { filename: 'missing.png', description: 'style' },
    ]
    const entries = [
      { name: 'a.png', data: new Uint8Array([1]) },
      { name: 'b.png', data: new Uint8Array([2]) },
      { name: 'metadata.json', data: new TextEncoder().encode(JSON.stringify(meta)) },
    ]
    const items = parseCharacterZip(entries)!
    expect(items.map((i) => [i.filename, i.description, i.enabled])).toEqual([
      ['a.png', 'character&style', true],
      ['b.png', 'character&style', true],
    ])
    expect(parseCharacterZip(entries.slice(0, 2))).toBeNull()
  })
})
