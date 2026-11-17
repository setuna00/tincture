import { useEffect, useState, useSyncExternalStore } from 'react'
import { useHotkeys } from 'react-hotkeys-hook'
import { useStore } from 'zustand'
import { AppRail, PAGES, type Page } from '@/components/app-rail'
import { AiImportHost } from '@/components/ai-import'
import { NaiImportHost } from '@/components/nai-import'
import { AccountStatus } from '@/components/gen/account-status'
import { Toaster } from '@/components/ui/sonner'
import { ConfirmHost } from '@/components/confirm'
import { TooltipProvider } from '@/components/ui/tooltip'
import { ArtistsHint, ArtistsPage } from '@/pages/artists-page'
import { EditorPage } from '@/pages/editor-page'
import { GalleryHint, GalleryPage } from '@/pages/gallery-page'
import { LibraryHint, LibraryPage } from '@/pages/library-page'
import { Playground } from '@/pages/playground'
import { DiscoverHint, DiscoverPage } from '@/pages/discover-page'
import { subscribePanelFocus, TEXT_HINT } from '@/lib/status-hints'
import { GachaHint, GachaPage } from '@/pages/gacha-page'
import { SettingsPage } from '@/pages/settings-page'
import { startAgentBridge } from '@/store/agent'
import { allSections, findChip, findSection } from '@/store/doc'
import { useDnd } from '@/store/dnd'
import { usePrefs } from '@/store/prefs'
import { RELEASE } from '@/store/seed'
import { useStartView } from '@/store/start'
import { getDocStore, useTabs } from '@/store/tabs'
import { useUi } from '@/store/ui'

export const VERSION = __APP_VERSION__

function usePage(): [Page, (p: Page) => void] {
  const read = (): Page => {
    const raw = location.hash.replace(/^#\/?/, '')
    const h = raw === 'search' ? 'discover' : raw
    return PAGES.some((p) => p.id === h) ? (h as Page) : 'editor'
  }
  const [page, setPage] = useState<Page>(read)
  useEffect(() => {
    const on = () => setPage(read())
    window.addEventListener('hashchange', on)
    return () => window.removeEventListener('hashchange', on)
  }, [])
  return [page, (p) => (location.hash = p === 'editor' ? '/' : `/${p}`)]
}

export default function App() {
  const [page, setPage] = usePage()
  useHotkeys('mod+s', (e) => e.preventDefault(), { enableOnFormTags: true, enableOnContentEditable: true })
  useEffect(startAgentBridge, [])

  return (
    <TooltipProvider delayDuration={500}>
      <div className="grid h-full min-h-0 grid-cols-[var(--rail-w)_minmax(0,1fr)] grid-rows-[minmax(0,1fr)_24px] bg-shell">
        <AppRail page={page} onPage={setPage} />
        <main className="min-h-0 min-w-0">
          {page === 'editor' && <EditorPage />}
          {page === 'gallery' && <GalleryPage />}
          {page === 'discover' && <DiscoverPage />}
          {page === 'gacha' && <GachaPage />}
          {page === 'artists' && <ArtistsPage />}
          {page === 'library' && <LibraryPage />}
          {!RELEASE && page === 'playground' && <Playground />}
          {page === 'settings' && <SettingsPage />}
        </main>
        <StatusBar page={page} />
      </div>
      <NaiImportHost />
      <AiImportHost />
      <Toaster position="bottom-center" offset={page === 'gacha' ? { bottom: 100 } : undefined} />
      <ConfirmHost />
    </TooltipProvider>
  )
}

function StatusBar({ page }: { page: Page }) {
  const activeId = useTabs((s) => s.activeId)
  const isStart = useTabs((s) => s.starts.includes(s.activeId))
  const picking = useStartView((s) => s.picking === activeId)
  return (
    <footer className="flex min-w-0 items-center gap-4 border-t border-line bg-shell px-3 text-[12px] whitespace-nowrap text-ink-2 tabular-nums" data-testid="status-bar">
      {page === 'editor' && (isStart ? <span>新标签页</span> : <DocStatus id={activeId} />)}
      {page === 'editor' && !isStart && <StatusHint id={activeId} />}
      {page === 'editor' && isStart && (
        <StatusText state={picking ? 'start-pick' : 'start'} />
      )}
      {page === 'gacha' && <GachaHint />}
      {page === 'gallery' && <GalleryHint />}
      {page === 'library' && <LibraryHint />}
      {page === 'discover' && <DiscoverHint />}
      {page === 'artists' && <ArtistsHint />}
      <span className="ml-auto flex items-center gap-4">
        <AccountStatus />
        <span>{VERSION}</span>
      </span>
    </footer>
  )
}

const HINTS = {
  'drag-chip': '碰到相邻 tag 时交换位置 · 拖动到其他区块显示插入线 · 松开放下 · Esc 取消',
  'drag-section': '上下拖动排序 · Esc 取消',
  'drag-character': '上下拖动排序（拖动时仅显示角色头部）· 松开放下 · Esc 取消',
  'drag-template': '放在区块上半 / 下半 = 插入到其前 / 后 · Esc 取消',
  'drag-char-template': '拖动到角色区：放在角色卡上半 / 下半 = 添加到其前 / 后 · Esc 取消',
  'drag-random-char': '拖动到编辑区：添加为新角色框（加在最后）· Esc 取消',
  'drag-artist': '放在区块里 = 添加到插入线处 · 放在区块之间 = 新建「画师」区块 · Esc 取消',
  tag: '滚轮 ±0.05 · Shift+滚轮 ±0.25 · 双击编辑 · 双击权重数字重置为 1 · Del 删除 · Ctrl / Shift+点击 多选 · Esc 返回区块',
  multi: 'Ctrl+点击 加选 / 取消 · Shift+点击 连选 · 滚轮 各自 ±0.05 · 拖动 整组移动 · Del 删除 · Esc 清空选择',
  text: TEXT_HINT,
  section: '单击 tag 选中 · 拖动 ⠿ 排序 · 双击名字重命名 · Esc 取消选中',
  random: 'R 重抽 · L 锁定 / 解锁整块 · 单击 tag 选中 · 拖动 ⠿ 排序 · Esc 取消选中',
  'random-tag': 'R 重抽选中项 · L 锁定 / 解锁 · 滚轮 ±0.05 · Del 删除 · Ctrl / Shift+点击 多选 · Esc 返回区块',
  character: '点击 ♀ / ♂ 切换性别 · 拖动 ⠿ 排序 · 单击其中的区块 / tag 选中 · Esc 取消选中',
  none: '单击区块或 tag 选中 · Ctrl+K 搜索模板 · Ctrl+D fork · Ctrl+Z 撤销',
  start: '↑↓ 选择 · ↵ 打开 · 搜索框为空时 ↵ 新建',
  'start-pick': '点击预设或按 1–5 新建 · Esc 返回',
} as const

const libraryActive = () => !!document.querySelector<HTMLElement>('[data-testid="assist-library"]:not([inert]):is(:hover, :focus-within)')?.checkVisibility()
const chatActive = () => !!document.querySelector<HTMLElement>('[data-testid="ai-chat"]:not([inert]):is(:hover, :focus-within)')?.checkVisibility()

function StatusText({ state }: { state: keyof typeof HINTS }) {
  const active = useSyncExternalStore(subscribePanelFocus, libraryActive)
  const chat = useSyncExternalStore(subscribePanelFocus, chatActive)
  const sendKey = usePrefs((s) => s.chatSendKey)
  const characters = usePrefs((s) => s.libraryTab === 'characters')
  const library = active && (state === 'none' || state === 'start')
  const hint =
    state === 'start'
      ? '单击 查看详情 · ↑↓ 选择 · ↵ 展开 · Esc 收起'
      : characters
        ? '单击 查看详情 · 拖动到角色区 添加 · ↑↓ 选择 · ↵ 展开 / 添加 · Esc 收起'
        : '单击 查看详情 · 拖动到编辑区 插入 · ↑↓ 选择 · ↵ 展开 / 插入 · Esc 收起'
  return (
    <span className="truncate max-sm:hidden" data-testid="status-hint" data-state={chat ? 'ai-chat' : library ? 'library' : state}>
      {chat ? (sendKey === 'enter' ? 'Enter 发送 · Shift+Enter 换行' : 'Shift+Enter 发送 · Enter 换行') : library ? hint : HINTS[state]}
    </span>
  )
}

function StatusHint({ id }: { id: string }) {
  const key = useDnd((s) => (s.dragging ? (`drag-${s.dragging}` as const) : null))
  const sel = useUi((s) =>
    s.textEditing ? 'text' : s.selectedChipIds.length > 1 ? 'multi' : s.selectedChipId ? 'tag' : s.focusSectionId ? 'section' : s.focusCharacterId ? 'character' : 'none',
  )
  const focus = useUi((s) => s.focusSectionId)
  const chip = useUi((s) => s.selectedChipId)
  const random = useStore(getDocStore(id), (s) => (sel === 'section' && focus ? !!findSection(s.doc, focus)?.section.random : sel === 'tag' && chip ? !!findChip(s.doc, chip)?.section.random : false))
  const state = key ?? (random ? (sel === 'tag' ? 'random-tag' : 'random') : sel)
  return (
    <StatusText state={state} />
  )
}

function DocStatus({ id }: { id: string }) {
  const store = getDocStore(id)
  const past = useStore(store.temporal, (s) => s.pastStates.length)
  const future = useStore(store.temporal, (s) => s.futureStates.length)
  const chips = useStore(store, (s) => allSections(s.doc).reduce((n, sec) => n + sec.chips.length, 0))
  return (
    <>
      <span data-testid="history-count">
        撤销 {past} · 重做 {future}
      </span>
      <span>{chips} 个 tag</span>
    </>
  )
}
