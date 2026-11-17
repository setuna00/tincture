import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { toast } from 'sonner'
import { IMAGE_FILE_LIMIT, IMAGE_MAX_PIXELS, ZIP_FILE_LIMIT } from '@/lib/import-budget'
import { TooLargeError } from '@/lib/inflate'
import { BUNDLE_ID, VIBE_ID, VIBE_MAX_ENTRIES, VIBE_TEXT_LIMIT } from '@/lib/vibe-file'
import { writeZip } from '@/lib/zip'
import type { DocStore } from './doc'
import { defaultSettings } from './doc'
import { importImageFiles, useImport } from './import'
import { askImageFiles, useIntake } from './intake'
import { importCharacterZip, importVibeFiles } from './ref-files'
import { putRefImage, putRefImageAs } from './ref-images'
import { assetStore } from './storage'

vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { error: vi.fn() }) }))
vi.mock('./storage', () => ({ assetStore: { set: vi.fn() }, imageStore: {} }))
vi.mock('./gallery', () => ({ externalRecord: vi.fn(), importToGallery: vi.fn() }))
vi.mock('./gen', () => ({ byNewest: vi.fn(), useGen: {}, withDoc: vi.fn() }))
vi.mock('./prefs', () => ({ usePrefs: {}, newDocSettings: vi.fn() }))
vi.mock('./nai', () => ({ useNai: {} }))
vi.mock('./right-panel', () => ({ useToolsMenu: {} }))
vi.mock('./tabs', () => ({ getDocStore: vi.fn(), useTabs: {} }))

const updateSettings = vi.fn()
const store = { getState: () => ({ doc: { settings: defaultSettings() }, updateSettings }) } as unknown as DocStore

function fileWithSize(size: number, name: string, type: string, data: BlobPart[] = []) {
  const file = new File(data, name, { type })
  Object.defineProperty(file, 'size', { value: size })
  return file
}

function png(width = IMAGE_MAX_PIXELS + 1, height = 1) {
  const b = new Uint8Array(33)
  b.set([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82])
  new DataView(b.buffer).setUint32(16, width)
  new DataView(b.buffer).setUint32(20, height)
  return b
}

beforeEach(() => {
  vi.clearAllMocks()
  useImport.setState({ pending: null, open: false })
  useIntake.setState({ pending: null, open: false })
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('import entry points', () => {
  it.each([importImageFiles, askImageFiles])('reports oversized files without creating a preview or changing pending imports', async (importFiles) => {
    const file = fileWithSize(IMAGE_FILE_LIMIT + 1, 'large.png', 'image/png')
    const previous = { file: new File([], 'previous.png'), url: 'blob:previous', parsed: null, source: 'other' as const }
    useIntake.setState({ pending: previous, open: true })
    const preview = vi.spyOn(URL, 'createObjectURL')
    const full = vi.spyOn(file, 'arrayBuffer')
    await importFiles([file])
    expect(toast.error).toHaveBeenCalledWith('无法读取图片信息', { description: '文件过大' })
    expect(useIntake.getState().pending).toBe(previous)
    expect(useImport.getState().pending).toBeNull()
    expect(preview).not.toHaveBeenCalled()
    expect(full).not.toHaveBeenCalled()
  })

  it('rejects oversized dimensions before intake preview decoding', async () => {
    const file = new File([png()], 'large.png', { type: 'image/png' })
    const decode = vi.fn()
    vi.stubGlobal('createImageBitmap', decode)
    const preview = vi.spyOn(URL, 'createObjectURL')
    await askImageFiles([file])
    expect(toast.error).toHaveBeenCalledWith('无法读取图片信息', { description: '文件过大' })
    expect(preview).not.toHaveBeenCalled()
    expect(decode).not.toHaveBeenCalled()
  })
})

describe('reference file budgets', () => {
  it('rejects a ZIP one byte over the raw cap before reading', async () => {
    const file = fileWithSize(ZIP_FILE_LIMIT + 1, 'refs.zip', 'application/zip')
    const read = vi.spyOn(file, 'arrayBuffer')
    await importCharacterZip(store, file)
    expect(read).not.toHaveBeenCalled()
    expect(updateSettings).not.toHaveBeenCalled()
    expect(toast.error).toHaveBeenCalledWith('无法导入精准参考 ZIP', { description: '文件过大' })
  })

  it('reads a ZIP just under the raw cap and preserves malformed ZIP handling', async () => {
    const file = fileWithSize(ZIP_FILE_LIMIT - 1, 'refs.zip', 'application/zip', [writeZip([]) as BlobPart])
    const read = vi.spyOn(file, 'arrayBuffer')
    await importCharacterZip(store, file)
    expect(read).toHaveBeenCalledOnce()
    expect(toast.error).toHaveBeenCalledWith('无法导入精准参考 ZIP', { description: '缺少 metadata.json' })
  })

  it('reports oversized Vibe JSON before text()', async () => {
    const file = fileWithSize(VIBE_TEXT_LIMIT + 1, 'large.naiv4vibe', 'application/json')
    const read = vi.spyOn(file, 'text')
    await importVibeFiles(store, [file])
    expect(read).not.toHaveBeenCalled()
    expect(updateSettings).not.toHaveBeenCalled()
    expect(toast.error).toHaveBeenCalledWith('无法导入 Vibe Transfer 文件', { description: '文件过大' })
  })

  it('reports oversized bundles without writing any references', async () => {
    const text = JSON.stringify({ identifier: BUNDLE_ID, vibes: Array(VIBE_MAX_ENTRIES + 1).fill({ identifier: VIBE_ID, type: 'image', image: 'AA==' }) })
    await importVibeFiles(store, [new File([text], 'large.naiv4vibebundle')])
    expect(assetStore.set).not.toHaveBeenCalled()
    expect(updateSettings).not.toHaveBeenCalled()
    expect(toast.error).toHaveBeenCalledWith('无法导入 Vibe Transfer 文件', { description: '文件过大' })
  })

  it('does not swallow an embedded PNG budget failure and retry it as a plain image', async () => {
    await importVibeFiles(store, [new File([png()], 'large.png', { type: 'image/png' })])
    expect(assetStore.set).not.toHaveBeenCalled()
    expect(updateSettings).not.toHaveBeenCalled()
    expect(toast.error).toHaveBeenCalledWith('无法导入 Vibe Transfer 文件', { description: '文件过大' })
  })

  it('rejects oversized images inside ZIPs before decoding', async () => {
    const data = writeZip([
      { name: 'ref.png', data: png() },
      { name: 'metadata.json', data: new TextEncoder().encode(JSON.stringify([{ filename: 'ref.png' }])) },
    ])
    const decode = vi.fn()
    vi.stubGlobal('createImageBitmap', decode)
    await importCharacterZip(store, new File([data as BlobPart], 'refs.zip'))
    expect(decode).not.toHaveBeenCalled()
    expect(updateSettings).not.toHaveBeenCalled()
    expect(toast.error).toHaveBeenCalledWith('无法导入精准参考 ZIP', { description: '文件过大' })
  })
})

describe('reference storage decode budgets', () => {
  it.each(['image', 'thumbnail'])('checks %s dimensions before decoding or storing', async (kind) => {
    const blob = new Blob([png()])
    const decode = vi.fn()
    vi.stubGlobal('createImageBitmap', decode)
    await expect(kind === 'image' ? putRefImage(blob) : putRefImageAs('id', blob)).rejects.toBeInstanceOf(TooLargeError)
    expect(decode).not.toHaveBeenCalled()
    expect(assetStore.set).not.toHaveBeenCalled()
  })

  it('closes a reference bitmap rejected by the fallback check', async () => {
    const close = vi.fn()
    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue({ width: IMAGE_MAX_PIXELS + 1, height: 1, close }))
    await expect(putRefImageAs('oversized-fallback', new Blob(['unknown']))).rejects.toBeInstanceOf(TooLargeError)
    expect(close).toHaveBeenCalledOnce()
    expect(assetStore.set).not.toHaveBeenCalled()
  })

  it('stores references just below the fallback pixel cap', async () => {
    const close = vi.fn()
    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue({ width: IMAGE_MAX_PIXELS - 1, height: 1, close }))
    await expect(putRefImageAs('under-fallback', new Blob(['unknown']))).resolves.toEqual({ width: IMAGE_MAX_PIXELS - 1, height: 1 })
    expect(close).toHaveBeenCalledOnce()
    expect(assetStore.set).toHaveBeenCalledOnce()
  })
})
