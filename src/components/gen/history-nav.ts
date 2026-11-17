import type { KeyboardEvent } from 'react'
import { useMarks } from '@/store/gallery-marks'
import { useGen, type GenImage } from '@/store/gen'
import { useVersions, type DocVersion } from '@/store/versions'

export const IMPORT_LABEL = '导入 prompt'

export const stripFollow = { held: false }

export const byOldest = (a: GenImage, b: GenImage) => a.createdAt - b.createdAt || a.index - b.index

export interface HistoryGroup {
  key: string
  v: DocVersion | null
  imported?: GenImage
  images: GenImage[]
  at: number
}

export const importKey = (id: string) => `import:${id}`

export function groupByVersion(list: GenImage[], versions: DocVersion[] | undefined): HistoryGroup[] {
  const byId = new Map((versions ?? []).map((v) => [v.id, v]))
  const imgs = new Map(list.map((x) => [x.id, x]))
  const keyOf = (img: GenImage): string => {
    if (img.versionId) return img.versionId
    let cur: GenImage | undefined = img
    for (let i = 0; cur && i < 64; i++) {
      if (cur.label === 'import') return importKey(cur.id)
      cur = cur.sourceId ? imgs.get(cur.sourceId) : undefined
    }
    return ''
  }
  const groups = new Map<string, HistoryGroup>()
  for (const img of [...list].sort(byOldest)) {
    const key = keyOf(img)
    let g = groups.get(key)
    if (!g) {
      const v = byId.get(key) ?? null
      const imported = key.startsWith('import:') ? imgs.get(key.slice('import:'.length)) : undefined
      groups.set(key, (g = { key, v, imported, images: [], at: v ? v.createdAt : imported ? imported.createdAt : -Infinity }))
    }
    g.images.push(img)
  }
  return [...groups.values()].sort((a, b) => a.at - b.at || (a.v?.n ?? -1) - (b.v?.n ?? -1))
}

export const historyOrder = (list: GenImage[], versions: DocVersion[] | undefined) => groupByVersion(list, versions).flatMap((g) => g.images)

export function selectVersion(docId: string, v: DocVersion) {
  const trash = useMarks.getState().trash
  const first = useGen.getState().history[docId]?.find((x) => x.versionId === v.id && !(x.id in trash))
  useGen.getState().select(docId, first?.id ?? v.id)
}

export function stepHistory(docId: string, delta: 1 | -1) {
  stripFollow.held = false
  const gen = useGen.getState()
  const trash = useMarks.getState().trash
  const list = (gen.history[docId] ?? []).filter((x) => !(x.id in trash))
  const ordered = historyOrder(list, useVersions.getState().byDoc[docId])
  if (!ordered.length) return
  const sel = gen.selected[docId]
  const at = ordered.findIndex((x) => x.id === sel)
  const next = ordered[Math.min(ordered.length - 1, Math.max(0, (at < 0 ? ordered.length - 1 : at) + delta))]
  if (next.id !== sel) gen.select(docId, next.id)
}

export function historyKey(docId: string, e: KeyboardEvent): boolean {
  const delta = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0
  if (!delta || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return false
  e.preventDefault()
  stepHistory(docId, delta)
  return true
}
