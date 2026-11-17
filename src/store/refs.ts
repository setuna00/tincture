// NAI allows only one copy of each Vibe Transfer reference image.
import { toast } from 'sonner'
import { create } from 'zustand'
import { TooLargeError } from '@/lib/inflate'
import { modelName, refModelFor } from '@/lib/nai-models'
import { baseImageSize, CHARACTER_REF_DEFAULT, vibeDefaults } from '@/lib/nai-refs'
import type { Doc } from '@/types'
import type { DocStore } from './doc'
import { putRefImage } from './ref-images'

export type RefKind = 'base' | 'vibe' | 'character'

export const useRefFlash = create<{ kind: RefKind | null; n: number }>(() => ({ kind: null, n: 0 }))

const ADDED: Record<RefKind, string> = { base: '已设为底图', vibe: '已添加为 Vibe Transfer', character: '已添加为精准参考' }

export async function addReference(store: DocStore, kind: RefKind, blob: Blob) {
  let ref
  try {
    ref = await putRefImage(blob)
  } catch (e) {
    return void toast.error('无法读取图片', e instanceof TooLargeError ? { description: '文件过大' } : undefined)
  }
  const before = store.getState().doc
  const s = before.settings
  if (kind === 'vibe' && s.vibes?.some((v) => v.image === ref.image)) return void toast('这张图已添加为 Vibe Transfer')
  let text = ADDED[kind]
  let switched = false
  if (kind === 'base') {
    const size = baseImageSize(ref, s.gen)
    store.getState().updateSettings({ baseImage: ref, ...(size ? { gen: { ...s.gen, ...size } } : {}) })
    if (size) text += `，尺寸已改为 ${size.width} × ${size.height}`
  } else {
    const model = refModelFor(s.model, kind)
    switched = model !== s.model
    if (kind === 'vibe') store.getState().updateSettings({ model, vibes: [...(s.vibes ?? []), { ...ref, ...vibeDefaults(model) }] })
    else store.getState().updateSettings({ model, characterRefs: [...(s.characterRefs ?? []), { ...ref, ...CHARACTER_REF_DEFAULT }] })
    if (switched) text += `，模型已切换为 ${modelName(model)}`
  }
  const after = store.getState().doc
  useRefFlash.setState((f) => ({ kind, n: f.n + 1 }))
  if (!switched) return void toast(text)
  // Use temporal undo only if nothing changed afterward; otherwise restore reference settings without undoing unrelated edits.
  const undo = () => {
    if (store.getState().doc === after) return store.temporal.getState().undo()
    const keep: Partial<Doc['settings']> = kind === 'vibe' ? { vibes: before.settings.vibes } : { characterRefs: before.settings.characterRefs }
    store.getState().updateSettings({ model: before.settings.model, ...keep })
  }
  toast(text, { action: { label: '撤销', onClick: undo } })
}
