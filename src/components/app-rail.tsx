import { AiChat02Icon, Album02Icon, BookOpen01Icon, DicesIcon, FolderManagementIcon, Moon02Icon, PaintBoardIcon, PencilEdit02Icon, Settings02Icon, SlidersHorizontalIcon, Sun03Icon, TranslateIcon } from '@hugeicons/core-free-icons'
import type { IconSvgElement } from '@hugeicons/react'
import type { ReactNode } from 'react'
import { useHotkeys } from 'react-hotkeys-hook'
import { Icon } from '@/components/icon'
import { Kbd } from '@/components/ui/kbd'
import { DropdownMenu, DropdownMenuContent, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { toggleChat, useChat } from '@/store/chat'
import { useAssistantMode } from '@/store/assistant-mode'
import { usePrefs, type ChipLang } from '@/store/prefs'
import { RELEASE } from '@/store/seed'
import { useTabs } from '@/store/tabs'
import logo from '../../assets/logo/tincture-32.svg'

export type Page = 'editor' | 'gallery' | 'discover' | 'gacha' | 'artists' | 'library' | 'playground' | 'settings'
const ALL_PAGES: { id: Page; label: string; icon: IconSvgElement }[] = [
  { id: 'editor', label: '编辑器', icon: PencilEdit02Icon },
  { id: 'gallery', label: '图库', icon: Album02Icon },
  { id: 'discover', label: '百科', icon: BookOpen01Icon },
  { id: 'gacha', label: '抽卡', icon: DicesIcon },
  { id: 'artists', label: '画师库', icon: PaintBoardIcon },
  { id: 'library', label: '模板管理', icon: FolderManagementIcon },
  { id: 'playground', label: '设计台', icon: SlidersHorizontalIcon },
  { id: 'settings', label: '设置', icon: Settings02Icon },
]
export const PAGES = RELEASE ? ALL_PAGES.filter((p) => p.id !== 'playground') : ALL_PAGES
const TOP_PAGES = PAGES.filter((p) => p.id !== 'settings')
const SETTINGS = PAGES.find((p) => p.id === 'settings')!

export const CHIP_LANG_LABEL: Record<ChipLang, string> = {
  'en-zh': '英文在前',
  'zh-en': '中文在前',
  en: '只显示英文',
  zh: '只显示中文',
}
/** TooltipTrigger replaces data-state, so persistent selection and menu state must use ARIA attributes. */
const ITEM =
  'grid size-10 min-w-0 shrink-0 place-items-center rounded-md p-0 text-ink-2 transition-[background-color,color] duration-(--dur-fast) hover:bg-surface-2 hover:text-ink-2 aria-checked:bg-surface-2 aria-checked:text-ink-1 aria-expanded:bg-surface-2 aria-expanded:text-ink-1'

function RailTip({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <Tooltip disableHoverableContent>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side="right" sideOffset={6} className="flex items-center gap-2">
        {label}
      </TooltipContent>
    </Tooltip>
  )
}

export function AppRail({ page, onPage }: { page: Page; onPage: (p: Page) => void }) {
  const chipLang = usePrefs((s) => s.chipLang)
  const theme = usePrefs((s) => s.theme)
  const set = usePrefs((s) => s.set)
  const dark = theme === 'dark' || (theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches)
  const chatEntry = usePrefs((s) => s.chatEntry)
  const chatOpen = useChat((s) => s.open)
  const assistOpen = usePrefs((s) => s.assistOpen)
  const isStart = useTabs((s) => s.starts.includes(s.activeId))
  const mode = useAssistantMode()
  const pinned = usePrefs((s) => s.chatPinned)
  const chatShown = !isStart && chatOpen && assistOpen && page === 'editor' && (pinned || mode === 'library')
  const toggle = () => toggleChat(page === 'editor', () => onPage('editor'))
  useHotkeys('mod+l', toggle, { preventDefault: true, enableOnFormTags: true, enableOnContentEditable: true }, [page, onPage])

  return (
    <nav className="rail-scheme row-span-2 flex min-h-0 flex-col items-center gap-0.5 border-r border-line pb-1.5" data-testid="app-rail">
      <div className="app-drag grid h-9 shrink-0 place-items-center self-stretch">
        <img src={logo} alt="Tincture" className="size-5" draggable={false} />
      </div>
      <ToggleGroup type="single" orientation="vertical" spacing={0.5} value={page} onValueChange={(v) => v && onPage(v as Page)} className="flex-col">
        {TOP_PAGES.map((p) => (
          <RailTip key={p.id} label={p.label}>
            <ToggleGroupItem value={p.id} className={ITEM} aria-label={p.label} data-testid={`page-${p.id}`}>
              <Icon icon={p.icon} size={24} className="size-6" />
            </ToggleGroupItem>
          </RailTip>
        ))}
      </ToggleGroup>

      <div className="flex-1" />

      {chatEntry === 'rail' && (
        <RailTip
          label={isStart ? '请先新建或打开文档' :
            <>
              问 AI<Kbd>Ctrl L</Kbd>
            </>
          }
        >
          <span className="inline-flex">
            <button type="button" disabled={isStart} className={`${ITEM} chat-rail-btn disabled:pointer-events-none disabled:opacity-40`} aria-pressed={chatShown} onClick={toggle} aria-label="问 AI" data-testid="rail-ai">
              <Icon icon={AiChat02Icon} size={24} className="size-6" />
            </button>
          </span>
        </RailTip>
      )}
      <DropdownMenu>
        <RailTip label={`tag 显示语言：${CHIP_LANG_LABEL[chipLang]}`}>
          <DropdownMenuTrigger className={ITEM} aria-label="显示语言" data-testid="chip-lang">
            <Icon icon={TranslateIcon} size={24} className="size-6" />
          </DropdownMenuTrigger>
        </RailTip>
        <DropdownMenuContent side="right" align="end" className="w-36">
          <DropdownMenuLabel>tag 显示语言</DropdownMenuLabel>
          <DropdownMenuRadioGroup value={chipLang} onValueChange={(v) => set({ chipLang: v as ChipLang })}>
            {(Object.keys(CHIP_LANG_LABEL) as ChipLang[]).map((k) => (
              <DropdownMenuRadioItem key={k} value={k} data-testid={`chip-lang-${k}`}>
                {CHIP_LANG_LABEL[k]}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      <RailTip label={dark ? '切换到浅色' : '切换到深色'}>
        <button type="button" className={ITEM} onClick={() => set({ theme: dark ? 'light' : 'dark' })} aria-label={dark ? '切换到浅色' : '切换到深色'} data-testid="theme-toggle">
          <Icon icon={dark ? Sun03Icon : Moon02Icon} size={24} className="size-6" />
        </button>
      </RailTip>
      <ToggleGroup type="single" orientation="vertical" value={page} onValueChange={(v) => v && onPage(v as Page)} className="flex-col">
        <RailTip label={SETTINGS.label}>
          <ToggleGroupItem value={SETTINGS.id} className={ITEM} aria-label={SETTINGS.label} data-testid="rail-settings">
            <Icon icon={SETTINGS.icon} size={24} className="size-6" />
          </ToggleGroupItem>
        </RailTip>
      </ToggleGroup>
    </nav>
  )
}
