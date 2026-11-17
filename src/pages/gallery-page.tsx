import { useEffect, useMemo } from 'react'
import { useHotkeys } from 'react-hotkeys-hook'
import { Album02Icon } from '@hugeicons/core-free-icons'
import { Icon } from '@/components/icon'
import { NamerContext, openSide, overlayOpen, scopeLabel, useGalleryView } from '@/components/gallery/data'
import { GalleryDetail } from '@/components/gallery/detail'
import { GalleryGrid } from '@/components/gallery/grid'
import { GalleryHeader } from '@/components/gallery/header'
import { GalleryMenu } from '@/components/gallery/menu'
import { GalleryNav, GalleryRail } from '@/components/gallery/nav'
import { SideBar, SideBySide } from '@/components/gallery/side-by-side'
import { GalleryViewer, ViewerBar } from '@/components/gallery/viewer'
import { SIDE_MAX, type Entry, type Stack } from '@/lib/gallery-stacks'
import { cn } from '@/lib/utils'
import { purgeImages, toggleFav, trashImages, useGallery, useGalleryUi, useMarks } from '@/store/gallery'
import { usePrefs } from '@/store/prefs'

const SLIDE = 'transition-[grid-template-columns] duration-200 ease-(--ease-out) motion-reduce:transition-none'

export function GalleryPage() {
  useEffect(() => void useGallery.getState().load(), [])
  const view = useGalleryView()
  const { loaded, all, scoped, searched, visible, entries, groups, tpls, dirs, narrowed, namer, order } = view
  const leftOpen = usePrefs((s) => s.galleryLeftOpen)
  const rightOpen = usePrefs((s) => s.galleryRightOpen)
  const scope = useGalleryUi((s) => s.scope)
  const query = useGalleryUi((s) => s.query)
  const filters = useGalleryUi((s) => s.filters)
  const sortBy = usePrefs((s) => s.gallerySortBy)
  const sortDir = usePrefs((s) => s.gallerySortDir)
  const viewing = useGalleryUi((s) => s.viewing)
  const side = useGalleryUi((s) => s.side)
  const label = scopeLabel(scope, groups, dirs, tpls)
  const inStack = useGalleryUi((s) => s.inStack)
  const stack = useMemo(() => (inStack ? (entries.find((e) => e.kind === 'stack' && e.stack.key === inStack) as { kind: 'stack'; stack: Stack } | undefined)?.stack : undefined), [entries, inStack])
  useEffect(() => {
    if (inStack && loaded && !stack) useGalleryUi.getState().set({ inStack: null })
  }, [inStack, loaded, stack])
  const gridEntries: Entry[] = useMemo(() => (stack ? order(stack.items.map((img) => ({ kind: 'one' as const, img }))) : entries), [stack, entries, order])
  const shown = useMemo(() => gridEntries.map((e) => (e.kind === 'one' ? e.img : e.stack.cover)), [gridEntries])
  const viewItems = viewing && !shown.some((x) => x.id === viewing) ? visible : shown
  const sideImgs = useMemo(() => {
    if (!side) return []
    const set = new Set(side)
    const order = entries.flatMap((e) => (e.kind === 'one' ? [e.img] : e.stack.items))
    return order.filter((x) => set.has(x.id)).slice(0, SIDE_MAX)
  }, [side, entries])

  useEffect(() => {
    if (!loaded) return
    const gone = (scope.startsWith('doc:') && !groups.some((g) => `doc:${g.tabId}` === scope)) || (scope.startsWith('dir:') && !dirs.some((d) => `dir:${d.id}` === scope)) || (scope.startsWith('tpl:') && !tpls.some((t) => `tpl:${t.id}` === scope))
    if (gone) useGalleryUi.getState().set({ scope: 'all', selected: [], anchor: null, viewing: null, side: null, inStack: null })
  }, [loaded, scope, groups, dirs, tpls])
  const visibleKey = visible.map((x) => x.id).join()
  useEffect(() => {
    const vis = new Set(visibleKey.split(','))
    const ui = useGalleryUi.getState()
    const sel = ui.selected.filter((id) => vis.has(id))
    if (sel.length !== ui.selected.length) ui.set({ selected: sel })
    if (ui.viewing && !vis.has(ui.viewing)) ui.set({ viewing: null })
    if (ui.side) {
      const s = ui.side.filter((id) => vis.has(id))
      if (s.length !== ui.side.length) ui.set({ side: s.length > 1 ? s : null })
    }
  }, [visibleKey])

  useHotkeys('f', () => !overlayOpen() && useGalleryUi.getState().scope !== 'trash' && toggleFav(useGalleryUi.getState().selected))
  useHotkeys(['delete', 'backspace'], () => {
    if (overlayOpen()) return
    const ids = useGalleryUi.getState().selected
    if (!ids.length) return
    if (ids.every((id) => id in useMarks.getState().trash)) void purgeImages(ids)
    else void trashImages(ids)
  })
  useHotkeys('shift+space', (e) => {
    const ui = useGalleryUi.getState()
    if (overlayOpen() || ui.side || ui.viewing) return
    e.preventDefault()
    openSide(ui.selected)
  })

  const empty = !loaded
    ? null
    : !all.length
      ? { title: '暂无图片', sub: '在编辑器中生成的图片和拖入此处的 NAI 图片显示在此处' }
      : !scoped.length
        ? {
            title: scope === 'fav' ? '暂无收藏的图片' : scope === 'trash' ? '回收站中暂无图片' : '暂无图片',
            sub: scope === 'fav' ? '选中图片后按 F 收藏' : scope.startsWith('dir:') ? '将图片拖至左栏的合集，或右键选择「加入合集」' : '',
          }
        : !visible.length
          ? { title: query.trim() ? `未找到匹配「${query.trim()}」的图片` : '未找到符合筛选条件的图片', sub: '' }
          : null

  return (
    <NamerContext value={namer}>
    <div
      className={cn('grid h-full min-h-0 grid-cols-[var(--gl)_minmax(0,1fr)_var(--gr)]', SLIDE, leftOpen ? '[--gl:var(--lib-tree-w)]' : '[--gl:30px]', rightOpen ? '[--gr:var(--gallery-detail-w)]' : '[--gr:30px]')}
      data-testid="gallery-page"
    >
      <div className="min-h-0 overflow-hidden">{leftOpen ? <GalleryNav all={all} groups={groups} tpls={tpls} dirs={dirs} /> : <GalleryRail side="left" />}</div>
      <section className="relative flex min-h-0 min-w-0 flex-col bg-work">
        {viewing ? (
          <ViewerBar items={viewItems} id={viewing} />
        ) : side ? (
          <SideBar shown={sideImgs.length} total={side.length} />
        ) : (
          <>
            <GalleryHeader label={label} total={scoped.length} shown={visible.length} narrowed={narrowed} scoped={scoped} searched={searched} stack={stack} />
          </>
        )}
        <div className="relative flex min-h-0 flex-1 flex-col">
          {!loaded ? (
            <p className="m-auto text-[13px] text-ink-3">加载中…</p>
          ) : empty ? (
            <div className="page-in m-auto flex flex-col items-center gap-2 pb-16 text-center" data-testid="gallery-empty">
              {!all.length && <Icon icon={Album02Icon} size={32} className="mb-1 text-ink-3" />}
              <span className="text-[13px] text-ink-2">{empty.title}</span>
              {empty.sub && <span className="text-[12px] text-ink-2">{empty.sub}</span>}
            </div>
          ) : (
            <GalleryMenu all={all} entries={gridEntries}>
              <div className="flex min-h-0 flex-1 flex-col">
                <GalleryGrid entries={gridEntries} resetKey={JSON.stringify([scope, query, filters, sortBy, sortDir])} hidden={!!viewing || !!side} />
              </div>
            </GalleryMenu>
          )}
          {side && !viewing && <SideBySide imgs={sideImgs} />}
          {viewing && <GalleryViewer items={viewItems} id={viewing} />}
        </div>
      </section>
      <div className="min-h-0 overflow-hidden">{rightOpen ? <GalleryDetail all={all} entries={entries} scopeLabel={label} scopeCount={scoped.length} /> : <GalleryRail side="right" />}</div>
    </div>
    </NamerContext>
  )
}

export function GalleryHint() {
  const viewing = useGalleryUi((s) => !!s.viewing)
  const side = useGalleryUi((s) => !!s.side)
  const inStack = useGalleryUi((s) => !!s.inStack)
  const inTrash = useGalleryUi((s) => s.scope === 'trash')
  const del = inTrash ? 'Del 永久删除' : 'Del 移至回收站'
  return (
    <span className="truncate max-sm:hidden" data-testid="status-hint" data-state={viewing ? 'gallery-view' : side ? 'gallery-side' : 'gallery'}>
      {viewing
        ? `← → 上一张 / 下一张 · 单击 看大图 · Ctrl+滚轮 缩放 · 放大后拖动 平移 · 双击 贴合${inTrash ? '' : ' · F 收藏'} · Esc 返回`
        : side
          ? 'Ctrl+滚轮 缩放 · Shift+拖动 平移 · 双击 看大图 · Esc 返回'
          : inTrash
            ? inStack
              ? `单击选中 · Ctrl / Shift+点击 多选 · 双击 看大图 · ${del} · Esc 返回`
              : `单击选中 · Ctrl / Shift+点击 多选 · 拖动空白处框选 · 空格 / ↵ 看大图 · 双击叠 查看全部 · ${del} · Ctrl+滚轮 缩放`
            : inStack
              ? `单击选中 · Ctrl / Shift+点击 多选 · 双击 看大图 · F2 重命名 · F 收藏 · ${del} · Esc 返回`
              : `单击选中 · Ctrl / Shift+点击 多选 · 拖动空白处框选 · 空格 / ↵ 看大图 · 双击叠 查看全部 · 停在叠上滚动 换着看 · Shift+空格 并排看 · F2 重命名 · F 收藏 · ${del} · Ctrl+滚轮 缩放`}
    </span>
  )
}
