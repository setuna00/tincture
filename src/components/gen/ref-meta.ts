import { Image02Icon, PaintBoardIcon, UserSquareIcon } from '@hugeicons/core-free-icons'
import type { IconSvgElement } from '@hugeicons/react'
import type { RefKind } from '@/store/refs'

export const REF_META: Record<RefKind, { icon: IconSvgElement; name: string; add: string; desc: string }> = {
  base: { icon: Image02Icon, name: '底图', add: '作为底图', desc: '以这张图为底图生成' },
  vibe: { icon: PaintBoardIcon, name: 'Vibe Transfer', add: '添加为 Vibe Transfer', desc: '参考整体氛围和画风' },
  character: { icon: UserSquareIcon, name: '精准参考', add: '添加为精准参考', desc: '参考角色或画风' },
}

export const REF_KINDS: RefKind[] = ['base', 'vibe', 'character']

export const switchHint = (from: string, to: string) => (from === to ? null : `将切换到 ${to.split(' ')[0]}`)
