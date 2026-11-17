import { SidebarLeftIcon } from '@hugeicons/core-free-icons'
import { Icon } from '@/components/icon'
import { useAssistantMode } from '@/store/assistant-mode'
import { ChatPanel } from '@/components/ai-chat/chat-panel'
import { useChat } from '@/store/chat'
import { usePrefs } from '@/store/prefs'
import { CharacterInspector } from './character-inspector'
import { Inspector } from './inspector'
import { MultiInspector } from './multi-inspector'
import { SectionInspector } from './section-inspector'
import { TemplatePanel } from './template-panel'

const ASIDE = 'flex h-full min-h-0 flex-col border-r border-line bg-shell'

export function AssistantColumn() {
  const mode = useAssistantMode()
  const chatOpen = useChat((s) => s.open)
  const pinned = usePrefs((s) => s.chatPinned)
  const aiShown = chatOpen && (pinned || mode === 'library')
  const covered = mode !== 'library' || aiShown
  return (
    <aside className={ASIDE} data-mode={mode} data-ai={aiShown ? '' : undefined} data-testid="assistant">
      <div className="relative min-h-0 flex-1">
        {/* transition-all also animates inherited visibility, leaving hidden controls over the inspector; exclude visibility. */}
        <div className="absolute inset-0 flex flex-col data-[hidden]:invisible [&_.transition-all]:transition" data-hidden={covered ? '' : undefined} inert={covered} data-testid="assist-library">
          <TemplatePanel />
        </div>
        {mode !== 'library' && !aiShown && (
          <div className="absolute inset-0">
            {mode === 'multi' ? <MultiInspector /> : mode === 'tag' ? <Inspector /> : mode === 'character' ? <CharacterInspector /> : <SectionInspector />}
          </div>
        )}
        {chatOpen && <ChatPanel shown={aiShown} />}
      </div>
    </aside>
  )
}

export function AssistantRail() {
  return (
    <button
      type="button"
      className="flex h-full w-full flex-col items-center gap-2 border-r border-line bg-shell pt-2.5 text-ink-2 hover:bg-surface-2 hover:text-ink-1"
      onClick={() => usePrefs.getState().set({ assistOpen: true })}
      aria-label="展开助手栏"
      data-testid="assist-rail"
    >
      <Icon icon={SidebarLeftIcon} size={16} />
      <span className="text-[11px] tracking-[0.3em] [writing-mode:vertical-rl]">助手</span>
    </button>
  )
}
