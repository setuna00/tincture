import { useState, type ReactNode } from 'react'
import { ArrowDown01Icon, Cancel01Icon, Copy01Icon, DicesIcon, Image01Icon, PinIcon, Refresh01Icon, ShoppingBasket01Icon } from '@hugeicons/core-free-icons'
import { toast } from 'sonner'
import { Icon } from '@/components/icon'
import { Button } from '@/components/ui/button'
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuLabel, ContextMenuSeparator, ContextMenuShortcut, ContextMenuTrigger } from '@/components/ui/context-menu'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import type { GachaTemplate } from '@/lib/gacha-templates'
import { cn } from '@/lib/utils'
import { useDiscover } from '@/store/discover'
import { clearSelection, splitTagKey, useGachaRun, type Results } from '@/store/gacha'
import { asText, charName, copyLine, copyNaiImage, dropTags, insertIntoCurrent, openInNewTab, rerollTags, rollPools, toggleLockTags } from './data'
import { CountBlock, PoolCard } from './pool-card'

const NONE: never[] = []

function Group({ label, n, children }: { label: string; n: number; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-(--section-gap)">
      <header className="flex items-center gap-2 pt-1">
        <span className="label-caps">{label}</span>
        <span className="text-[11px] text-ink-2 tabular-nums">{n}</span>
        <span className="h-px flex-1 bg-line" />
      </header>
      {children}
    </section>
  )
}

function ago(at: number) {
  const m = Math.floor((Date.now() - at) / 60000)
  if (m < 1) return '刚刚'
  if (m < 60) return `${m} 分钟前`
  const d = new Date(at)
  return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`
}

function History({ c }: { c: GachaTemplate }) {
  const history = useGachaRun((s) => s.history[c.id] ?? NONE)
  const current = useGachaRun((s) => s.results[c.id])
  const summary = (r: Results) =>
    c.pools
      .map((p) => r[p.id]?.map((d) => (p.kind === 'char' ? charName(d.tag) : d.tag)).join(', ') || '—')
      .join(' · ')
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="lg" className="shrink-0 gap-1 bg-work pr-1.5 text-[12px] text-ink-2" disabled={!history.length} data-testid="gacha-history">
          最近
          <span className="text-[11px] text-ink-2 tabular-nums">{history.length}</span>
          <Icon icon={ArrowDown01Icon} size={14} className="text-ink-2" />
        </Button>
      </DropdownMenuTrigger>
      {/* Restoring trigger focus makes the next Space reopen the menu instead of drawing; suppress focus restoration. */}
      <DropdownMenuContent align="end" className="w-[360px]" onCloseAutoFocus={(e) => e.preventDefault()} data-testid="gacha-history-menu">
        <DropdownMenuLabel className="font-normal text-ink-3">点击恢复该组结果</DropdownMenuLabel>
        {history.map((h, i) => (
          <DropdownMenuItem
            key={h.at + i}
            className={cn('gap-2 text-[12px]', h.results === current && 'bg-surface-2')}
            onSelect={() => {
              const run = useGachaRun.getState()
              run.set({ results: { ...run.results, [c.id]: h.results }, rollSeq: run.rollSeq + 1 })
            }}
            data-testid="gacha-history-row"
          >
            <span className="w-14 shrink-0 text-[11px] text-ink-2">{ago(h.at)}</span>
            <span className={cn('truncate', h.results === current ? 'text-ink-1' : 'text-ink-2')}>{summary(h.results)}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function CopySplit({ c }: { c: GachaTemplate }) {
  return (
    <span className="flex">
      <Button variant="outline" className="h-7 rounded-r-none bg-work px-3 text-[13px]" onClick={() => void copyLine(c)} data-testid="gacha-copy">
        <Icon icon={Copy01Icon} size={14} />
        复制
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" className="h-7 w-7 rounded-l-none border-l-0 bg-work px-0" aria-label="更多复制方式" data-testid="gacha-copy-more">
            <Icon icon={ArrowDown01Icon} size={16} />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-48" onCloseAutoFocus={(e) => e.preventDefault()}>
          <DropdownMenuItem onSelect={() => void copyNaiImage(c)} data-testid="gacha-copy-nai-image">
            <Icon size={14} icon={Image01Icon} />
            复制为 NAI 图
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </span>
  )
}

export function GachaCenter({ c }: { c: GachaTemplate }) {
  const hasChars = c.pools.some((p) => p.kind === 'char')
  return (
    <main className="flex min-w-0 flex-1 flex-col bg-work" data-testid="gacha-center" data-tpl={c.id}>
      <header className="app-drag flex items-start gap-3 pt-5 pr-[max(1.5rem,var(--wco-w))] pb-3 pl-6">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="truncate text-[17px] leading-tight font-semibold text-ink-1" data-testid="gacha-title">
            {c.name}
          </span>
          <span className="truncate text-[12px] text-ink-2" data-testid="gacha-summary">
            {c.summary}
          </span>
        </div>
        <span className="ml-auto">
          <History c={c} />
        </span>
      </header>
      <SelectionMenu c={c}>
        <div
          key={c.id}
          className="flex min-h-0 flex-1 animate-in flex-col gap-5 overflow-auto px-6 pb-6 duration-150 fade-in-0"
          // React portal clicks bubble here; require DOM containment before clearing selection.
          onClick={(e) => e.currentTarget.contains(e.target as Node) && clearSelection()}
          data-testid="gacha-pools"
        >
          <Group label="正面 Prompt" n={c.pools.length}>
            {hasChars && <CountBlock c={c} />}
            {c.pools.map((p) => (
              <PoolCard key={p.id} c={c} p={p} />
            ))}
          </Group>
        </div>
      </SelectionMenu>
      <footer className="flex shrink-0 items-center gap-2.5 border-t border-line bg-shell px-6 py-3" data-testid="gacha-footer">
        <CopySplit c={c} />
        <Button variant="outline" className="h-7 bg-work px-3 text-[13px]" onClick={() => insertIntoCurrent(c)} data-testid="gacha-insert">
          插入到当前 tab
        </Button>
        <Button variant="outline" className="h-7 bg-work px-3 text-[13px]" onClick={() => openInNewTab(c)} data-testid="gacha-open">
          在新 tab 中打开
        </Button>
        <Button className="ml-auto h-7 w-[240px] shrink-0 gap-2 text-[13px] font-semibold max-lg:w-[180px]" onClick={() => rollPools(c)} data-testid="gacha-roll">
          <Icon icon={DicesIcon} size={14} />
          抽一组
          <kbd className="ml-1 rounded-sm bg-black/15 px-1 text-[11px]">Space</kbd>
        </Button>
      </footer>
    </main>
  )
}

export function onTagClick(e: React.MouseEvent, key: string) {
  const run = useGachaRun.getState()
  if (e.ctrlKey || e.metaKey) {
    const has = run.selTags.includes(key)
    return run.set({ selTags: has ? run.selTags.filter((k) => k !== key) : [...run.selTags, key], selPools: [], anchor: key })
  }
  if (e.shiftKey && run.anchor) {
    const all = [...document.querySelectorAll<HTMLElement>('[data-testid=gacha-pools] [data-tag-key]')].map((el) => el.dataset.tagKey!)
    const a = all.indexOf(run.anchor)
    const b = all.indexOf(key)
    if (a >= 0 && b >= 0) return run.set({ selTags: all.slice(Math.min(a, b), Math.max(a, b) + 1), selPools: [] })
  }
  run.set({ selTags: [key], selPools: [], anchor: key })
}

function SelectionMenu({ c, children }: { c: GachaTemplate; children: ReactNode }) {
  const [keys, setKeys] = useState<string[]>([])
  const tags = keys.map((k) => splitTagKey(k)[1])
  const results = useGachaRun.getState().results[c.id] ?? {}
  const allLocked = keys.every((k) => {
    const [pid, tag] = splitTagKey(k)
    return results[pid]?.find((d) => d.tag === tag)?.locked
  })
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(asText(c, keys).join(', '))
      toast(`已复制 ${keys.length} 个 tag`)
    } catch {
      toast.error('复制失败：无剪贴板权限')
    }
  }
  return (
    <ContextMenu onOpenChange={(o) => o && setKeys(useGachaRun.getState().selTags)}>
      <ContextMenuTrigger asChild>
        <div
          className="flex min-h-0 flex-1 flex-col"
          onClickCapture={(e) => {
            const el = (e.target as Element).closest<HTMLElement>('[data-tag-key]')
            if (!el) return
            e.stopPropagation()
            onTagClick(e, el.dataset.tagKey!)
          }}
          onContextMenu={(e) => {
            const el = (e.target as Element).closest<HTMLElement>('[data-tag-key]')
            const run = useGachaRun.getState()
            if (el) {
              const key = el.dataset.tagKey!
              if (!run.selTags.includes(key)) run.set({ selTags: [key], selPools: [], anchor: key })
            } else if (!run.selTags.length) e.preventDefault()
          }}
        >
          {children}
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-52" data-testid="gacha-menu">
        <ContextMenuLabel className="truncate font-normal text-ink-3">{keys.length === 1 ? tags[0] : `${keys.length} 个 tag`}</ContextMenuLabel>
        <ContextMenuItem onSelect={() => rerollTags(c, keys)} data-testid="gacha-menu-reroll">
          <Icon size={14} icon={Refresh01Icon} />
          重抽{keys.length > 1 ? `选中的 ${keys.length} 个` : ''}
          <ContextMenuShortcut>R</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => toggleLockTags(c, keys)} data-testid="gacha-menu-lock">
          <Icon size={14} icon={PinIcon} />
          {allLocked ? '解锁' : '锁定'}
          <ContextMenuShortcut>L</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={() => dropTags(c, keys)} data-testid="gacha-menu-drop">
          <Icon size={14} icon={Cancel01Icon} />
          本次移除
          <ContextMenuShortcut>Del</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem
          onSelect={() => {
            useDiscover.getState().addCart(asText(c, keys))
            toast(`已加入购物车 · ${keys.length} 个（位于百科页）`)
          }}
          data-testid="gacha-menu-cart"
        >
          <Icon size={14} icon={ShoppingBasket01Icon} />
          加入购物车
        </ContextMenuItem>
        <ContextMenuItem onSelect={copy} data-testid="gacha-menu-copy">
          <Icon size={14} icon={Copy01Icon} />
          复制
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}
