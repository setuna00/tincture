import {
  AiBackgroundEraserIcon,
  BubbleChatCancelIcon,
  ImageAdd01Icon,
  ImagesIcon,
  ImageUpscaleIcon,
  PaintBrush01Icon,
  PaletteIcon,
  PencilLineIcon,
  PenTool03Icon,
  SmileIcon,
  SparklesIcon,
} from '@hugeicons/core-free-icons'
import type { IconSvgElement } from '@hugeicons/react'
import type { GenLabel, ImageAction } from '@/lib/nai-tools'
import type { GenImage } from '@/store/gen'
import { ACTION_NAME } from '@/store/image-actions'

export { ACTION_NAME }

export const ACTION_ICON: Record<ImageAction, IconSvgElement> = {
  upscale: ImageUpscaleIcon,
  enhance: SparklesIcon,
  variations: ImagesIcon,
  'bg-removal': AiBackgroundEraserIcon,
  lineart: PenTool03Icon,
  sketch: PencilLineIcon,
  colorize: PaletteIcon,
  emotion: SmileIcon,
  declutter: BubbleChatCancelIcon,
}

export const INPAINT_ICON = PaintBrush01Icon

export const ACTION_DESC: Record<ImageAction, string> = {
  upscale: '将这张图放大 2 倍，结果作为新图加入历史',
  enhance: '以这张图为底图，按当前 prompt 和参数放大后重画细节，结果作为新图加入历史',
  variations: '以这张图为底图生成相似的图，结果加入历史',
  'bg-removal': '去掉背景只留人物，结果作为新图加入历史',
  lineart: '描出这张图的线稿，结果作为新图加入历史',
  sketch: '将这张图变成草图，结果作为新图加入历史',
  colorize: '给线稿或草图上色，结果作为新图加入历史',
  emotion: '改变角色的表情，结果作为新图加入历史',
  declutter: '去掉图上的文字和对话框，结果作为新图加入历史',
}

export const ACTION_RUNNING: Record<ImageAction, string> = {
  upscale: '放大中',
  enhance: 'Enhance 中',
  variations: '生成变体中',
  'bg-removal': '去背景中',
  lineart: '描线稿中',
  sketch: '转草图中',
  colorize: '上色中',
  emotion: '改表情中',
  declutter: '去文字中',
}

const LABEL_ACTION: Record<Exclude<GenLabel, 'inpaint'>, ImageAction> = {
  upscale: 'upscale',
  enhanced: 'enhance',
  variations: 'variations',
  'bg-removal': 'bg-removal',
  declutter: 'declutter',
  'declutter-keep-bubbles': 'declutter',
  lineart: 'lineart',
  sketch: 'sketch',
  colorize: 'colorize',
  emotion: 'emotion',
}

export function badgeOf(img: GenImage): { icon: IconSvgElement; name: string } | null {
  if (!img.label) return null
  if (img.label === 'import') return { icon: ImageAdd01Icon, name: '导入' }
  if (img.label === 'inpaint') return { icon: INPAINT_ICON, name: '重绘' }
  const a = LABEL_ACTION[img.label]
  return a ? { icon: ACTION_ICON[a], name: img.label === 'declutter-keep-bubbles' ? '去文字（保留对话框）' : ACTION_NAME[a] } : null
}

export function runningText(action: ImageAction, progress: number | null): string {
  return progress === null ? `${ACTION_RUNNING[action]}…` : `${ACTION_RUNNING[action]} ${Math.round(progress * 100)}%`
}

export const SLIDER =
  'flex-1 **:data-[slot=slider-track]:bg-line-strong **:data-[slot=slider-range]:bg-lamp-text **:data-[slot=slider-thumb]:size-3.5 **:data-[slot=slider-thumb]:rounded-full **:data-[slot=slider-thumb]:border-lamp-text **:data-[slot=slider-thumb]:bg-lamp'
