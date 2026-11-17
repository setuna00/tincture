import { useMemo } from 'react'
import { create } from 'zustand'
import { toast } from 'sonner'
import { newId } from '@/lib/nai'
import { groupBatches, versionKey } from '@/lib/versions'
import type { Doc } from '@/types'
import type { DocStore } from './doc'
import { BROWSER_ONLY, imageStore, versionStore, type DocVersion, type GenImage } from './storage'

export type { DocVersion }

interface VersionsState {
  byDoc: Record<string, DocVersion[] | undefined>
}

export const useVersions = create<VersionsState>()(() => ({ byDoc: {} }))

const loads = new Map<string, Promise<DocVersion[]>>()

export function loadVersions(docId: string): Promise<DocVersion[]> {
  const have = useVersions.getState().byDoc[docId]
  if (have) return Promise.resolve(have)
  let p = loads.get(docId)
  if (!p) {
    p = versionStore
      .list(docId)
      .catch(() => [] as DocVersion[])
      .then((list) => {
        const cur = useVersions.getState().byDoc[docId]
        if (cur) return cur
        useVersions.setState((s) => ({ byDoc: { ...s.byDoc, [docId]: list } }))
        return list
      })
      .finally(() => loads.delete(docId))
    loads.set(docId, p)
  }
  return p
}

export function latestVersion(docId: string): number | undefined {
  const list = useVersions.getState().byDoc[docId]
  return list?.length ? list[list.length - 1].n : undefined
}

export const findVersion = (list: readonly DocVersion[], doc: Doc) => {
  const key = versionKey(doc)
  return list.find((v) => versionKey(v.snapshot) === key)
}

export function recordVersion(doc: Doc, info: { kind: 'gen' } | { kind: 'ai'; aiRequest?: string; aiCount: number }): DocVersion | null {
  const docId = doc.meta.docId!
  const list = useVersions.getState().byDoc[docId] ?? []
  const same = findVersion(list, doc)
  if (same) return info.kind === 'gen' ? same : null
  const v: DocVersion = {
    id: newId('ver'),
    docId,
    n: Math.max(0, ...list.map((x) => x.n)) + 1,
    kind: info.kind,
    createdAt: Date.now(),
    snapshot: structuredClone(doc),
    ...(info.kind === 'ai' ? { aiCount: info.aiCount, ...(info.aiRequest ? { aiRequest: info.aiRequest } : {}) } : {}),
  }
  useVersions.setState((s) => ({ byDoc: { ...s.byDoc, [docId]: [...list, v] } }))
  void versionStore.put(v)
  return v
}

export async function recordAiVersion(doc: Doc, aiCount: number, aiRequest?: string) {
  await loadVersions(doc.meta.docId!)
  recordVersion(doc, { kind: 'ai', aiCount, aiRequest })
}

export const isCurrentVersion = (doc: Doc, v: DocVersion) => versionKey(doc) === versionKey(v.snapshot)

export function useMatchedVersion(docId: string, doc: Doc): DocVersion | null | undefined {
  const list = useVersions((s) => s.byDoc[docId])
  return useMemo(() => (list ? (findVersion(list, doc) ?? null) : undefined), [list, doc])
}

export const nextVersionN = (list: readonly DocVersion[] | undefined) => Math.max(0, ...(list ?? []).map((v) => v.n)) + 1

export function revertToVersion(store: DocStore, v: DocVersion) {
  const before = store.getState().doc
  if (isCurrentVersion(before, v)) return
  const snap = structuredClone(v.snapshot)
  store.getState().replaceDoc({ ...snap, meta: before.meta })
  const after = store.getState().doc
  const undo = () => {
    if (store.getState().doc === after) store.temporal.getState().undo()
    else store.getState().replaceDoc(before)
  }
  toast(`已导入 v${v.n} 的 prompt`, { id: `revert-${v.docId}`, action: { label: '撤销', onClick: undo } })
}

export async function adoptLegacyImages(docId: string, images: GenImage[]): Promise<GenImage[]> {
  if (!BROWSER_ONLY) return images
  const orphans = images.filter((x) => !x.versionId && !x.label)
  if (!orphans.length) return images
  const list = await loadVersions(docId)
  const { versions, of } = groupBatches(orphans, list)
  const made = versions.map((v): DocVersion => ({ id: newId('ver'), docId, n: v.n, kind: 'gen', createdAt: v.createdAt, snapshot: v.snapshot }))
  const all = [...list, ...made]
  useVersions.setState((s) => ({ byDoc: { ...s.byDoc, [docId]: all } }))
  for (const v of made) await versionStore.put(v)
  return Promise.all(
    images.map(async (img) => {
      const n = of.get(img.id)
      const v = n === undefined ? undefined : all.find((x) => x.n === n)
      if (!v) return img
      const next = { ...img, versionId: v.id, version: v.n }
      await imageStore.put(next, await imageStore.blob(img.id)).catch(() => {})
      return next
    }),
  )
}
