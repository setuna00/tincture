import { toast } from 'sonner'
import { desktop } from '@/lib/desktop'
import { buildFilename, type FilenameMeta } from '@/lib/filename-template'
import { basePrompt, characterPrompt } from '@/lib/nai'
import { toPngBlob } from '@/lib/png-encode'
import { imageBlob, type GenImage } from '@/store/gen'
import { nameNow } from '@/store/gallery-names'
import { useNai } from '@/store/nai'

function filenameMeta(img: GenImage): FilenameMeta {
  return {
    prompt: basePrompt(img.doc),
    name: nameNow(img),
    seed: img.seed,
    date: new Date(img.createdAt),
    model: img.model,
    width: img.width,
    height: img.height,
    index: img.index,
    id: img.id,
    type: '',
    characters: img.doc.characters.filter((c) => c.enabled && characterPrompt(c)).map((c) => ({ name: c.name.trim() || undefined, prompt: characterPrompt(c) })),
  }
}

export const SAVE_LABEL = desktop ? '另存为…' : '下载'

const extOf = (type: string) => (type === 'image/png' ? 'png' : type === 'image/jpeg' ? 'jpg' : 'webp')

export function exportName(img: GenImage): string {
  const nai = useNai.getState()
  return buildFilename(filenameMeta(img), { on: nai.filenameTemplateOn, text: nai.filenameTemplate })
}

export async function exportFile(img: GenImage): Promise<{ blob: Blob; name: string; ext: string; pngFailed: boolean }> {
  const nai = useNai.getState()
  let blob = await imageBlob(img)
  let pngFailed = false
  if (nai.imageFormat === 'png' && blob.type !== 'image/png') {
    try {
      blob = await toPngBlob(blob)
    } catch {
      pngFailed = true
    }
  }
  return { blob, name: exportName(img), ext: extOf(blob.type), pngFailed }
}

export async function downloadImage(img: GenImage) {
  let file: Awaited<ReturnType<typeof exportFile>>
  try {
    file = await exportFile(img)
  } catch {
    toast.error('无法读取图片')
    return
  }
  if (file.pngFailed) toast.error('无法转换为 PNG', { description: '已下载原图' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(file.blob)
  a.download = `${file.name}.${file.ext}`
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}

export async function copyImage(img: GenImage): Promise<boolean> {
  try {
    // Use PNG for image clipboard support; putting conversion inside ClipboardItem preserves user activation.
    const png = imageBlob(img).then((b) => (b.type === 'image/png' ? b : toPngBlob(b)))
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })])
    toast.success('已复制图片')
    return true
  } catch {
    toast.error('复制失败：无剪贴板权限')
    return false
  }
}
