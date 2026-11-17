import { toast } from 'sonner'
import { restore, toTrash } from '@/lib/gallery'
import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import type { GalleryMarks } from '@/lib/gallery'
import type { GalleryDir } from '@/lib/gallery-stacks'
import { safeStorage } from './storage'

interface MarksState extends GalleryMarks {
  recent: string[]
  dirs: GalleryDir[]
  /** Stack-name keys use v:<versionId> for versions and imp:<content> for imported groups; image-name keys are image IDs. */
  stackNames: Record<string, string>
  imageNames: Record<string, string>
  covers: Record<string, number>
}

export const useMarks = create<MarksState>()(
  persist(() => ({ fav: {}, trash: {}, recent: [] as string[], dirs: [] as GalleryDir[], stackNames: {} as Record<string, string>, imageNames: {} as Record<string, string>, covers: {} as Record<string, number> }), {
    name: 'pe:gallery',
    version: 1,
    storage: createJSONStorage(() => safeStorage),
  }),
)

export const pickCover = (id: string) => useMarks.setState((s) => ({ covers: { ...s.covers, [id]: Date.now() } }))

export function moveImagesToTrash(ids: readonly string[], onUndo?: () => void) {
  const fresh = ids.filter((id) => !(id in useMarks.getState().trash))
  if (!fresh.length) return
  useMarks.setState(toTrash(useMarks.getState(), fresh, Date.now()))
  toast(fresh.length > 1 ? `已将 ${fresh.length} 张图片移至回收站` : '已将图片移至回收站', {
    id: 'gallery-trash',
    action: {
      label: '撤销',
      onClick: () => {
        useMarks.setState(restore(useMarks.getState(), fresh))
        onUndo?.()
      },
    },
  })
}
