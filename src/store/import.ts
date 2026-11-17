// Keep state exports outside component modules so React Fast Refresh does not reload the entire page.
import { create } from 'zustand'
import { toast } from 'sonner'
import { TooLargeError } from '@/lib/inflate'
import { metaSource, parseNaiImage, readImageMeta, type ImageMeta, type ParsedNaiImage } from '@/lib/nai-image'

export interface PendingImport {
  file: File
  url: string
  parsed: ParsedNaiImage
}
export const useImport = create<{ pending: PendingImport | null; open: boolean }>(() => ({ pending: null, open: false }))
export const closeImport = () => useImport.setState({ open: false })

export const isImage = (f: File) => f.type.startsWith('image/') || /\.(png|webp|jpe?g)$/i.test(f.name)

const unsupportedSource = (name: string) => ({
  title: `此图片由 ${name} 生成，不是 NAI 图片`,
  description: '仅支持读取 NAI 生成的图片',
})
export const IMPORT_ISSUE = {
  other: { title: '未读取到图片信息', description: '请使用 NAI 下载的原图，或在 NAI 中点击「复制」' },
  webui: unsupportedSource('WebUI（A1111 / Forge）'),
  comfyui: unsupportedSource('ComfyUI'),
  large: { title: '无法读取图片信息', description: '文件过大' },
}

export async function readMetaOrLarge(file: Blob): Promise<ImageMeta | 'large' | null> {
  try {
    return await readImageMeta(file)
  } catch (e) {
    return e instanceof TooLargeError ? 'large' : null
  }
}

export async function importImageFiles(files: File[]) {
  const file = files[0]
  if (!file) return
  if (files.length > 1) toast('一次只能导入一张图片，已读取第一张')
  if (!isImage(file)) return void toast.error('不是图片文件', { description: '支持从 NAI 生成的 PNG（以及 WebP / JPG）导入 prompt 和参数' })
  const meta = await readMetaOrLarge(file)
  const src = meta === 'large' ? meta : meta && metaSource(meta)
  if (src !== 'nai' || !meta || meta === 'large') {
    const issue = IMPORT_ISSUE[src && src !== 'nai' ? src : 'other']
    return void toast.error(issue.title, { description: issue.description })
  }
  const prev = useImport.getState().pending
  if (prev) URL.revokeObjectURL(prev.url)
  useImport.setState({ pending: { file, url: URL.createObjectURL(file), parsed: parseNaiImage(meta) }, open: true })
}
