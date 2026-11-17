import { toast } from 'sonner'
import { baseName, canMoveFolder, cleanName, dissolve, folderPaths, inPath, joinPath, parentPath, relocate, remapOpenFolders, renamedPath, workNames } from '@/lib/library-ops'
import { confirmDelete } from '@/store/confirm'
import { useLibrary, type LibraryUndo } from '@/store/library'
import { usePrefs } from '@/store/prefs'
import { folderNode, kindOf, NONE, pathOf, useLibPage, workNode, type Kind } from './state'

const folderLabel = (p: string) => p || '根目录'
const workLabel = (w: string) => w || '无所属作品'

function undoToast(text: string, u: LibraryUndo, back?: { open?: { before: Record<string, boolean>; after: Record<string, boolean> }; node?: { from: string; to: string } }) {
  toast(text, {
    action: {
      label: '撤销',
      onClick: () => {
        useLibrary.getState().undoLibrary(u)
        if (back?.open && usePrefs.getState().openFolders === back.open.after) usePrefs.getState().set({ openFolders: back.open.before })
        if (back?.node && useLibPage.getState().node === back.node.to) useLibPage.getState().set({ node: back.node.from, selected: [] })
      },
    },
  })
}

function remapFolders(fn: (folder: string) => string) {
  const u = useLibrary.getState().remapFolders(fn)
  const before = usePrefs.getState().openFolders
  const after = remapOpenFolders(before, fn)
  usePrefs.getState().set({ openFolders: after })
  return { u, open: { before, after } }
}

export function moveTemplates(kind: Kind, ids: string[], target: string) {
  const lib = useLibrary.getState()
  const u = kind === 's' ? lib.moveSectionTemplates(ids, target) : lib.moveCharacterTemplates(ids, target)
  if (!u.count) return
  undoToast(`已将 ${u.count} 个模板移至「${kind === 's' ? folderLabel(target) : workLabel(target)}」`, u)
}

export function mergeInto(node: string, name: string): { name: string; count: number } | null {
  const p = pathOf(node)
  const lib = useLibrary.getState()
  if (kindOf(node) === 's') {
    const to = renamedPath(p, name)
    if (!cleanName(name) || to === p || !folderPaths(lib.sectionTemplates.map((t) => t.folder)).includes(to)) return null
    return { name: baseName(to), count: lib.sectionTemplates.filter((t) => inPath(t.folder, to) || inPath(t.folder, p)).length }
  }
  const to = name.trim()
  if (!to || to === p || !workNames(lib.characterTemplates.map((t) => t.work)).includes(to)) return null
  return { name: to, count: lib.characterTemplates.filter((t) => t.work?.trim() === to || t.work?.trim() === p).length }
}

export function renameNode(node: string, name: string) {
  const p = pathOf(node)
  const set = useLibPage.getState().set
  if (kindOf(node) === 's') {
    const to = renamedPath(p, name)
    if (!cleanName(name) || to === p) return
    const merged = folderPaths(useLibrary.getState().sectionTemplates.map((t) => t.folder)).includes(to)
    const { u, open } = remapFolders(relocate(p, to))
    set({ node: folderNode(to) })
    undoToast(merged ? `「${baseName(p)}」已并入「${baseName(to)}」· ${u.count} 个模板` : `已重命名为「${baseName(to)}」`, u, { open, node: { from: node, to: folderNode(to) } })
  } else {
    const to = name.trim()
    if (!to || to === p) return
    const merged = workNames(useLibrary.getState().characterTemplates.map((t) => t.work)).includes(to)
    const u = useLibrary.getState().remapWorks((w) => (w === p ? to : w))
    const before = usePrefs.getState().openFolders
    const closed = before[`work-closed:${p}`]
    if (closed !== undefined) {
      const { [`work-closed:${p}`]: _old, ...rest } = before
      usePrefs.getState().set({ openFolders: { ...rest, [`work-closed:${to}`]: closed } })
    }
    set({ node: workNode(to) })
    const total = useLibrary.getState().characterTemplates.filter((t) => t.work === to).length
    undoToast(merged ? `「${p}」已并入「${to}」· ${total} 个角色模板` : `已重命名为「${to}」`, u, {
      open: closed !== undefined ? { before, after: usePrefs.getState().openFolders } : undefined,
      node: { from: node, to: workNode(to) },
    })
  }
}

export function moveFolder(from: string, into: string) {
  if (!canMoveFolder(from, into)) return
  const to = joinPath(into, baseName(from))
  const merged = folderPaths(useLibrary.getState().sectionTemplates.map((t) => t.folder)).includes(to)
  const { u, open } = remapFolders(relocate(from, to))
  const page = useLibPage.getState()
  const followed = page.node === folderNode(from) || pathOf(page.node).startsWith(`${from}/`)
  if (followed) page.set({ node: folderNode(relocate(from, to)(pathOf(page.node))) })
  undoToast(merged ? `「${baseName(from)}」已并入「${to}」· ${u.count} 个模板` : `已将目录「${baseName(from)}」移至「${folderLabel(into)}」`, u, {
    open,
    node: followed ? { from: page.node, to: useLibPage.getState().node } : undefined,
  })
}

export async function deleteNode(node: string) {
  const p = pathOf(node)
  if (!p || p === NONE) return
  const lib = useLibrary.getState()
  if (kindOf(node) === 's') {
    const inside = lib.sectionTemplates.filter((t) => t.folder === p || t.folder.startsWith(`${p}/`)).length
    const subs = folderPaths(lib.sectionTemplates.map((t) => t.folder)).filter((f) => parentPath(f) === p).map(baseName)
    const up = folderLabel(parentPath(p))
    const ok = await confirmDelete({
      title: `删除目录「${baseName(p)}」？`,
      body: `其中的 ${inside} 个模板${subs.length ? `连同子目录 ${subs.join(' / ')} ` : ''}将移至「${up}」。`,
      action: '删除目录',
    })
    if (!ok) return
    const { u, open } = remapFolders(dissolve(p))
    const to = folderNode(parentPath(p))
    useLibPage.getState().set({ node: to, selected: [] })
    undoToast(`已删除目录「${baseName(p)}」，${u.count} 个模板已移至「${up}」`, u, { open, node: { from: node, to } })
  } else {
    const inside = lib.characterTemplates.filter((t) => t.work?.trim() === p).length
    const ok = await confirmDelete({
      title: `删除作品「${p}」？`,
      body: `其中的 ${inside} 个角色模板将移至「无所属作品」。`,
      action: '删除作品',
    })
    if (!ok) return
    const u = useLibrary.getState().remapWorks((w) => (w === p ? '' : w))
    const to = workNode('')
    useLibPage.getState().set({ node: to, selected: [] })
    undoToast(`已删除作品「${p}」，${u.count} 个角色模板已移至「无所属作品」`, u, { node: { from: node, to } })
  }
}

export async function deleteTemplates(kind: Kind, ids: string[]) {
  if (!ids.length) return
  const lib = useLibrary.getState()
  const what = kind === 's' ? '区块模板' : '角色模板'
  const one = ids.length === 1 ? (kind === 's' ? lib.sectionTemplates : lib.characterTemplates).find((t) => t.id === ids[0])?.name : null
  const ok = await confirmDelete({
    title: one ? `删除${what}「${one}」？` : `删除 ${ids.length} 个${what}？`,
    body: `文档中已${kind === 's' ? '插入的区块' : '添加的角色'}不受影响。`,
    action: '删除模板',
  })
  if (!ok) return
  const u = kind === 's' ? lib.removeTemplates(ids, []) : lib.removeTemplates([], ids)
  useLibPage.getState().set({ selected: [], anchor: null })
  undoToast(one ? `已删除模板「${one}」` : `已删除 ${u.count} 个模板`, u)
}

