import { useEffect } from 'react'
import { SidebarRightIcon } from '@hugeicons/core-free-icons'
import { CopyPane } from '@/components/export-panel'
import { GenPane } from '@/components/gen/gen-page'
import { Icon } from '@/components/icon'
import { ParamsRoot } from '@/components/params-panel'
import { Tip } from '@/components/tip'
import { Button } from '@/components/ui/button'
import { useDocId, useGen } from '@/store/gen'
import { usePrefs } from '@/store/prefs'
import { useRightTab, type RightTab } from '@/store/right-panel'
import { loadVersions } from '@/store/versions'

const TABS: { id: RightTab; label: string; sub?: string }[] = [
  { id: 'gen', label: '图片生成', sub: '(API)' },
  { id: 'copy', label: '提示词复制' },
]

export function RightPanel({ tabId }: { tabId: string }) {
  const tab = useRightTab()
  const docId = useDocId(tabId)
  useEffect(() => {
    void useGen.getState().load(docId)
    void loadVersions(docId)
  }, [docId])
  return (
    <aside className="flex h-full min-h-0 flex-col bg-shell" data-testid="export-panel" data-tab={tab}>
      <header className="flex h-11 shrink-0 items-stretch border-b border-line pr-1.5 pl-1">
        <nav className="flex" aria-label="右栏">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              className="page-tab gap-1 px-3 text-[14px]"
              data-active={tab === t.id ? '' : undefined}
              aria-current={tab === t.id ? 'page' : undefined}
              onClick={() => usePrefs.getState().set({ rightTab: t.id })}
              data-testid={`right-tab-${t.id}`}
            >
              {t.label}
              {t.sub && <span className="text-[12px] font-medium opacity-70">{t.sub}</span>}
            </button>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-0.5">
          <Tip label="收起右栏">
            <Button variant="ghost" size="icon-sm" className="text-ink-2" onClick={() => usePrefs.getState().set({ exportOpen: false })} aria-label="收起右栏" data-testid="export-collapse">
              <Icon icon={SidebarRightIcon} size={16} />
            </Button>
          </Tip>
        </div>
      </header>
      <ParamsRoot>
        <div key={tab} className="page-in flex min-h-0 flex-1 flex-col">
          {tab === 'gen' ? <GenPane tabId={tabId} docId={docId} /> : <CopyPane />}
        </div>
      </ParamsRoot>
    </aside>
  )
}
