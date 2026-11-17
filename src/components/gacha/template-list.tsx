import type { GachaTemplate } from '@/lib/gacha-templates'
import { cn } from '@/lib/utils'
import { SEL_BG } from '@/components/library/tree'
import { clearSelection, useGacha } from '@/store/gacha'

export function TemplateList({ templates, activeId }: { templates: readonly GachaTemplate[]; activeId: string }) {
  return (
    <aside className="flex w-[220px] shrink-0 flex-col border-r border-line bg-shell" data-testid="gacha-templates">
      <header className="app-drag flex h-9 shrink-0 items-center gap-1.5 border-b border-line px-3">
        <span className="pane-title">抽卡</span>
      </header>
      <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-auto p-2">
        {templates.map((t) => {
          const on = t.id === activeId
          return (
            <button
              key={t.id}
              type="button"
              className={cn('flex flex-col gap-0.5 rounded-md px-2.5 py-[7px] text-left transition-colors duration-(--dur-fast)', !on && 'hover:bg-surface-2')}
              style={on ? SEL_BG : undefined}
              onClick={() => {
                useGacha.getState().setActiveTemplate(t.id)
                clearSelection()
              }}
              aria-current={on ? 'true' : undefined}
              data-testid="gacha-template"
              data-tpl={t.id}
            >
              <span className={cn('text-[13px] text-ink-1', on && 'font-semibold')}>{t.name}</span>
              <span className="truncate text-[11px] text-ink-2">{t.summary}</span>
            </button>
          )
        })}
      </div>
    </aside>
  )
}
