import { characterLabel } from '@/lib/character-label'
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { useHotkeys } from 'react-hotkeys-hook'
import { toast } from 'sonner'
import { confirmDelete } from '@/store/confirm'
import { Add01Icon, ArrowLeft01Icon, ArrowUpRight01Icon, Delete02Icon, Image02Icon, PencilEdit02Icon, Search01Icon } from '@hugeicons/core-free-icons'
import type { IconSvgElement } from '@hugeicons/react'
import { sectionTint } from '@/components/editor/labels'
import { useAfterMenu } from '@/components/after-menu'
import { Icon } from '@/components/icon'
import { importImageFiles } from '@/store/import'
import { LangText } from '@/components/tag-name'
import { Button } from '@/components/ui/button'
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from '@/components/ui/context-menu'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tip } from '@/components/tip'
import { chipLiteral, exportString } from '@/lib/nai'
import { chipZh } from '@/lib/tagdb'
import { cn } from '@/lib/utils'
import { allSections, nextCharColor } from '@/store/doc'
import { useLibrary, type RecentDoc, type SavedDoc } from '@/store/library'
import { DOC_PRESETS, presetDoc, type DocPreset } from '@/store/presets'
import { useStartView } from '@/store/start'
import { getDocStore, tabOfSaved, useTabs } from '@/store/tabs'
import type { Doc, SectionColor } from '@/types'

const countChips = (d: Doc) => allSections(d).reduce((n, s) => n + s.chips.length, 0)

function haystack(title: string, doc: Doc) {
  const tags = allSections(doc).flatMap((s) => s.chips.flatMap((c) => [chipLiteral(c), chipZh(c) ?? '']))
  return [title, ...doc.characters.map((c) => c.name), ...tags].join('\n').toLowerCase()
}

function previewZh(doc: Doc) {
  return doc.base.prompt
    .filter((s) => !s.muted)
    .flatMap((s) => s.chips.filter((c) => !c.disabled).map((c) => chipZh(c) ?? chipLiteral(c)))
    .join('，')
}

function relTime(t: number) {
  const d = new Date(t)
  const now = new Date()
  const min = Math.floor((now.getTime() - t) / 60000)
  if (min < 1) return '刚刚'
  if (min < 60) return `${min} 分钟前`
  const hm = d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
  const days = Math.round((day(now) - day(d)) / 86400000)
  if (days === 0) return `今天 ${hm}`
  if (days === 1) return `昨天 ${hm}`
  if (d.getFullYear() === now.getFullYear()) return `${d.getMonth() + 1}月${d.getDate()}日`
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`
}

const filledSections = (doc: Doc) => doc.base.prompt.filter((s) => s.chips.length)
const characterNames = (doc: Doc) => doc.characters.map((c) => characterLabel(doc, c)).join(' · ')

const PAGE_FADE = { initial: { opacity: 0, y: 6 }, animate: { opacity: 1, y: 0 }, exit: { opacity: 0, y: -4 }, transition: { duration: 0.18, ease: 'easeOut' } } as const

export function StartPage({ tabId }: { tabId: string }) {
  const picking = useStartView((s) => s.picking === tabId)
  const setPicking = (on: boolean) => useStartView.setState({ picking: on ? tabId : null })
  useEffect(() => () => useStartView.setState((s) => (s.picking === tabId ? { picking: null } : s)), [tabId])
  return (
    <ScrollArea className="h-full" data-testid="start-page">
      <AnimatePresence mode="wait" initial={false}>
        {picking ? (
          <motion.div key="pick" {...PAGE_FADE}>
            <PresetPicker tabId={tabId} onBack={() => setPicking(false)} />
          </motion.div>
        ) : (
          <motion.div key="home" {...PAGE_FADE}>
            <StartHome tabId={tabId} onNew={() => setPicking(true)} />
          </motion.div>
        )}
      </AnimatePresence>
    </ScrollArea>
  )
}

function StartHome({ tabId, onNew }: { tabId: string; onNew: () => void }) {
  const openInTab = useTabs((s) => s.openInTab)
  const docs = useLibrary((s) => s.docs)
  const recent = useLibrary((s) => s.recent)
  const [q, setQ] = useState('')
  const [active, setActive] = useState(-1)
  const [expanded, setExpanded] = useState(false)
  const [columns, setColumns] = useState(1)
  const reducedMotion = useReducedMotion()
  const listRef = useRef<HTMLDivElement>(null)
  const gridRef = useRef<HTMLDivElement>(null)
  const resultsId = `start-results-${tabId}`

  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean)
  const match = (title: string, doc: Doc) => {
    if (!words.length) return true
    const hay = haystack(title, doc)
    return words.every((w) => hay.includes(w))
  }
  const mine = [...docs].sort((a, b) => b.savedAt - a.savedAt).filter((d) => match(d.title, d.doc))
  const rec = recent.filter((r) => match(r.title, r.doc))
  const visibleMine = words.length || expanded ? mine : mine.slice(0, columns * 2)
  useLayoutEffect(() => {
    const grid = gridRef.current
    if (!grid) return
    const measure = () => setColumns(getComputedStyle(grid).gridTemplateColumns.split(' ').length)
    const observer = new ResizeObserver(measure)
    observer.observe(grid)
    measure()
    return () => observer.disconnect()
  }, [mine.length])

  const openSaved = (d: SavedDoc) => {
    const open = tabOfSaved(d.id)
    if (open) useTabs.getState().activate(open)
    else openInTab(tabId, structuredClone(d.doc), d.id)
  }
  const openRecent = (r: RecentDoc) => {
    const link = r.savedId && useLibrary.getState().docs.some((d) => d.id === r.savedId) && !tabOfSaved(r.savedId) ? r.savedId : undefined
    openInTab(tabId, structuredClone(r.doc), link)
    useLibrary.getState().removeRecent(r.id)
  }
  const removeDoc = async (d: SavedDoc) => {
    const open = tabOfSaved(d.id)
    if (!(await confirmDelete({ title: `删除「${d.title}」？`, body: open ? '已打开的 tab 保留，变为未保存' : null, action: '删除文档' }))) return
    const index = useLibrary.getState().docs.findIndex((x) => x.id === d.id)
    useLibrary.getState().removeDoc(d.id)
    toast(`已删除「${d.title}」`, { action: { label: '撤销', onClick: () => useLibrary.getState().restoreDoc(d, index) } })
  }
  const renameDoc = (d: SavedDoc, title: string) => {
    const next = title.trim()
    if (!next || next === d.title) return
    const apply = (t: string) => {
      useLibrary.getState().renameDoc(d.id, t)
      const open = tabOfSaved(d.id)
      if (open) getDocStore(open).getState().setTitle(t)
    }
    apply(next)
    toast(`已重命名为「${next}」`, { action: { label: '撤销', onClick: () => apply(d.title) } })
  }

  const results = [...visibleMine.map((d) => () => openSaved(d)), ...rec.map((r) => () => openRecent(r))]
  const resultIds = [...visibleMine.map((d) => `start-doc-${d.id}`), ...rec.map((r) => `start-recent-${r.id}`)]
  const cur = results.length ? Math.min(active, results.length - 1) : -1
  useEffect(() => {
    if (cur < 0) return
    listRef.current?.querySelectorAll('[data-result]')[cur]?.scrollIntoView({ block: 'nearest' })
  }, [cur])
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing || e.ctrlKey || e.altKey || e.metaKey) return
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      if (q) {
        setQ('')
        setActive(-1)
      } else e.currentTarget.blur()
    } else if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && results.length) {
      e.preventDefault()
      setActive(cur < 0 ? (e.key === 'ArrowDown' ? 0 : results.length - 1) : (cur + (e.key === 'ArrowDown' ? 1 : -1) + results.length) % results.length)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (cur >= 0) results[cur]()
      else if (!words.length) onNew()
    }
  }

  return (
    <div ref={listRef} className="mx-auto flex max-w-4xl flex-col gap-7 px-8 py-8 max-md:px-4">
      <header className="flex items-center gap-3">
        <h1 className="mr-auto truncate text-[17px] font-semibold text-ink-1">新标签页</h1>
        <div className="relative w-60 shrink-0 max-sm:w-44">
          <Icon icon={Search01Icon} size={14} className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-ink-3" />
          <Input
            autoFocus
            className="pl-8"
            placeholder="搜索我的文档、最近关闭"
            aria-label="搜索我的文档、最近关闭"
            role="combobox"
            aria-expanded={results.length > 0}
            aria-controls={resultsId}
            aria-activedescendant={resultIds[cur]}
            value={q}
            onChange={(e) => (setQ(e.target.value), setActive(e.target.value.trim() ? 0 : -1))}
            onKeyDown={onKeyDown}
            data-testid="start-search"
          />
        </div>
      </header>

      <section className="flex flex-col gap-2.5">
        <Heading>新建</Heading>
        <div className={GRID}>
          <NewTile primary icon={Add01Icon} title="新建" note={DOC_PRESETS.map((p) => p.name).join(' / ')} onClick={onNew} testId="start-new" />
          <ImportTile />
        </div>
      </section>

      <div className="sr-only" aria-live="polite" data-testid="start-search-status">
        {words.length > 0 && (results.length ? `${results.length} 个结果` : `未找到匹配「${q.trim()}」的文档或记录`)}
      </div>
      <div id={resultsId} role="listbox" aria-label="我的文档、最近关闭" className="flex flex-col gap-7">
        <section className="flex flex-col gap-2.5">
          <Heading count={docs.length}>我的文档</Heading>
          {mine.length ? (
            <div ref={gridRef} className={GRID} data-testid="start-doc-grid">
              {visibleMine.slice(0, columns * 2).map((d, i) => (
                <DocCard key={d.id} d={d} active={cur === i} onOpen={() => openSaved(d)} onRemove={() => void removeDoc(d)} onRename={(title) => renameDoc(d, title)} />
              ))}
              <AnimatePresence initial={false}>
                {visibleMine.length > columns * 2 && (
                  <motion.div key="more" className={cn(GRID, 'col-span-full overflow-hidden')} initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} transition={{ duration: reducedMotion ? 0 : 0.18 }}>
                    {visibleMine.slice(columns * 2).map((d, i) => (
                      <DocCard key={d.id} d={d} active={cur === columns * 2 + i} onOpen={() => openSaved(d)} onRemove={() => void removeDoc(d)} onRename={(title) => renameDoc(d, title)} />
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          ) : (
            <p className="text-[12px] text-ink-2">{docs.length ? `未找到匹配「${q.trim()}」的文档` : '暂无文档 · 在编辑器中点击「保存」或按 Ctrl+S 后显示在此处'}</p>
          )}
          {!words.length && mine.length > columns * 2 && (
            <Button
              variant="link"
              size="sm"
              className="h-auto self-start p-0 text-[12px] text-ink-2 underline underline-offset-2"
              onClick={() => {
                setExpanded(!expanded)
                setActive(-1)
              }}
              data-testid="start-doc-toggle"
            >
              {expanded ? '收回' : `展开全部 ${mine.length} 个`}
            </Button>
          )}
        </section>

        <section className="flex flex-col gap-2.5">
          <Heading>最近关闭</Heading>
          {rec.length ? (
            <div className="border-y border-line">
              {rec.map((r, i) => (
                <RecentRow key={r.id} r={r} unsaved={!!r.savedId && docs.some((d) => d.id === r.savedId)} active={cur === visibleMine.length + i} onOpen={() => openRecent(r)} />
              ))}
            </div>
          ) : (
            <p className="text-[12px] text-ink-2">{recent.length ? `未找到匹配「${q.trim()}」的记录` : '暂无记录 · 已关闭的 tab 显示在此处'}</p>
          )}
        </section>
      </div>
    </div>
  )
}

function PresetPicker({ tabId, onBack }: { tabId: string; onBack: () => void }) {
  const openInTab = useTabs((s) => s.openInTab)
  useHotkeys('escape', onBack, { enableOnFormTags: true })
  useHotkeys('1,2,3,4,5', (e) => {
    if (e.isComposing || e.ctrlKey || e.altKey || e.metaKey) return
    e.preventDefault()
    openInTab(tabId, presetDoc(DOC_PRESETS[Number(e.key) - 1]))
  }, { enableOnFormTags: true }, [tabId, openInTab])
  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6 px-8 py-8 max-md:px-4" data-testid="start-picker">
      <header className="flex items-center gap-2">
        <Button variant="ghost" size="sm" className="-ml-2 text-ink-2" onClick={onBack} data-testid="start-back">
          <Icon icon={ArrowLeft01Icon} size={14} />
          返回
        </Button>
        <h1 className="truncate text-[17px] font-semibold text-ink-1">新建</h1>
      </header>
      <div className="grid grid-cols-5 gap-3 max-md:grid-cols-3">
        {DOC_PRESETS.map((p, i) => (
          <PresetCard key={p.id} p={p} autoFocus={i === 0} onClick={() => openInTab(tabId, presetDoc(p))} />
        ))}
      </div>
    </div>
  )
}

function PresetCard({ p, autoFocus, onClick }: { p: DocPreset; autoFocus: boolean; onClick: () => void }) {
  const primary = p.id === 'blank'
  const blocks = p.pos.length + 1 + p.characters
  const charColors = Array.from({ length: p.characters }).reduce<SectionColor[]>((used) => [...used, nextCharColor(used)], [])
  return (
    <button
      type="button"
      autoFocus={autoFocus}
      onClick={onClick}
      className={cn(
        'flex min-w-0 flex-col gap-2 rounded-lg border p-2 pb-2.5 text-left shadow-(--shadow-card) transition-[background-color,border-color,outline-color] duration-(--dur) outline-2 outline-transparent outline-offset-2 focus-visible:outline-ink-2',
        primary ? 'border-transparent bg-lamp hover:bg-lamp/88' : 'border-line-strong bg-work hover:border-ink-3/60',
      )}
      data-testid="start-preset"
    >
      <span className="flex h-[212px] flex-col gap-[3px] overflow-hidden rounded-md bg-surface-2 px-2 py-2">
        <ThumbLabel>正面</ThumbLabel>
        {p.pos.map(([name, color]) => (
          <ThumbBar key={name} name={name} color={color} />
        ))}
        <ThumbLabel>负面</ThumbLabel>
        <ThumbBar name="负面" color="slate" />
        {p.characters > 0 && <ThumbLabel>角色</ThumbLabel>}
        {charColors.map((c, i) => (
          <ThumbBar key={i} name={`角色 ${i + 1}　外观`} color={c} />
        ))}
      </span>
      <span className="flex items-baseline gap-2 px-1">
        <span className={cn('shrink-0 text-[13px] font-semibold', primary ? 'text-lamp-ink' : 'text-ink-1')}>{p.name}</span>
        <span className={cn('ml-auto truncate text-[11px] tabular-nums', primary ? 'text-lamp-ink/70' : 'text-ink-2')}>{blocks} 个区块</span>
      </span>
    </button>
  )
}

const ThumbLabel = ({ children }: { children: string }) => <span className="mt-0.5 shrink-0 text-[9px] font-semibold text-ink-3">{children}</span>

function ThumbBar({ name, color }: { name: string; color: SectionColor }) {
  return (
    <span className="flex h-[17px] shrink-0 items-center gap-1.5 overflow-hidden rounded-sm border border-line bg-work pr-1.5 text-[11px] whitespace-nowrap text-ink-2">
      <span className="w-[3px] self-stretch" style={{ background: sectionTint(color) }} />
      {name}
    </span>
  )
}

const GRID = 'grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-2.5'

function Heading({ children, count }: { children: string; count?: number }) {
  return (
    <h2 className="flex items-baseline gap-1.5 text-[13px] font-semibold text-ink-1">
      {children}
      {count !== undefined && <span className="text-[11px] font-normal text-ink-2">{count}</span>}
    </h2>
  )
}

function ImportTile() {
  const input = useRef<HTMLInputElement>(null)
  return (
    <>
      <NewTile icon={Image02Icon} title="从图片导入" note="NAI 生成的图片，也可直接拖入窗口" onClick={() => input.current?.click()} testId="start-import" />
      <input
        ref={input}
        type="file"
        accept="image/png,image/webp,image/jpeg"
        hidden
        onChange={(e) => {
          void importImageFiles([...(e.target.files ?? [])])
          e.target.value = ''
        }}
        data-testid="start-import-input"
      />
    </>
  )
}

function NewTile({ icon, title, note, primary, onClick, testId }: { icon: IconSvgElement; title: string; note: string; primary?: boolean; onClick: () => void; testId: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'grid min-w-0 grid-cols-[38px_minmax(0,1fr)] items-center gap-x-3 gap-y-0.5 rounded-lg border px-3.5 py-3 text-left shadow-(--shadow-card) transition-[background-color,border-color,outline-color] duration-(--dur) outline-2 outline-transparent outline-offset-2 focus-visible:outline-ink-2',
        primary ? 'border-transparent bg-lamp hover:bg-lamp/88' : 'border-line-strong bg-work hover:border-ink-3/60',
      )}
      data-testid={testId}
    >
      <span className={cn('row-span-2 grid size-[38px] place-items-center rounded-lg', primary ? 'bg-white/35 text-lamp-ink' : 'bg-surface-2 text-ink-2')}>
        <Icon icon={icon} size={20} />
      </span>
      <span className={cn('truncate text-[13px] font-semibold', primary ? 'text-lamp-ink' : 'text-ink-1')}>{title}</span>
      <span className={cn('truncate text-[12px]', primary ? 'text-lamp-ink/70' : 'text-ink-2')}>{note}</span>
    </button>
  )
}

function SectionTags({ doc }: { doc: Doc }) {
  return (
    <div className="flex flex-wrap gap-x-2.5 gap-y-1 text-[12px] text-ink-2">
      {filledSections(doc).map((s) => (
        <span key={s.id} className="inline-flex items-center gap-1.5 data-[muted]:opacity-50" data-muted={s.muted ? '' : undefined}>
          <span className="size-[7px] rounded-[2px]" style={{ background: sectionTint(s.color) }} />
          {s.name}
          <span className="text-[11px] text-ink-2">{s.chips.length}</span>
        </span>
      ))}
    </div>
  )
}

function DocCard({ d: t, active, onOpen, onRemove, onRename }: { d: SavedDoc; active: boolean; onOpen: () => void; onRemove: () => void; onRename: (title: string) => void }) {
  const en = exportString(t.doc.base.prompt)
  const [editing, setEditing] = useState(false)
  const menu = useAfterMenu({ refocus: false })
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild disabled={editing}>
        <div
          className="group relative flex flex-col gap-1.5 rounded-lg border border-line-strong bg-work px-3.5 py-2.5 shadow-(--shadow-card) transition-[border-color,box-shadow,outline-color] duration-(--dur) hover:border-ink-3/60 outline-2 outline-transparent outline-offset-2 focus-visible:outline-ink-2 data-[active]:outline-(--accent)"
          data-active={active ? '' : undefined}
          data-result=""
          id={`start-doc-${t.id}`}
          role="option"
          aria-selected={active}
          data-testid="start-doc"
        >
          {!editing && <button type="button" className="absolute inset-0 rounded-lg" onClick={onOpen} aria-label={`打开 ${t.title}`} />}
          <div className="pointer-events-none flex items-center gap-2">
            {editing ? (
              <TitleInput initial={t.title} onDone={(v) => (setEditing(false), v !== null && onRename(v))} />
            ) : (
              <span className="truncate text-[13px] font-semibold text-ink-1">{t.title}</span>
            )}
            <span className="ml-auto shrink-0 text-[11px] text-ink-2 tabular-nums">{countChips(t.doc)} 个 tag</span>
          </div>
          <div className="pointer-events-none flex flex-col gap-1">
            <SectionTags doc={t.doc} />
            {t.doc.characters.length > 0 && (
              <span className="truncate text-[12px] text-ink-2">
                {t.doc.characters.length} 个角色：{characterNames(t.doc)}
              </span>
            )}
          </div>
          <p className="pointer-events-none mt-auto truncate pr-11 text-[12px] text-ink-2">{en ? <LangText en={en} zh={previewZh(t.doc)} /> : '（正面为空）'}</p>
          {!editing && (
            <div className="absolute right-2 bottom-2 flex gap-0.5 opacity-0 transition-opacity duration-(--dur) group-focus-within:opacity-100 group-hover:opacity-100">
              <Tip label="重命名">
                <button
                  type="button"
                  className="grid size-5 place-items-center rounded-sm text-ink-2 transition-colors duration-(--dur-fast) hover:text-ink-1"
                  onClick={() => setEditing(true)}
                  aria-label={`重命名 ${t.title}`}
                  data-testid="start-doc-rename"
                >
                  <Icon icon={PencilEdit02Icon} size={16} />
                </button>
              </Tip>
              <Tip label="删除">
                <button
                  type="button"
                  className="grid size-5 place-items-center rounded-sm text-ink-2 transition-colors duration-(--dur-fast) hover:text-danger"
                  onClick={onRemove}
                  aria-label={`删除 ${t.title}`}
                  data-testid="start-doc-remove"
                >
                  <Icon icon={Delete02Icon} size={16} />
                </button>
              </Tip>
            </div>
          )}
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-40" onCloseAutoFocus={menu.onCloseAutoFocus} data-testid="start-doc-menu">
        <ContextMenuItem onSelect={onOpen}>
          <Icon size={14} icon={ArrowUpRight01Icon} />
          打开
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => menu.later(() => setEditing(true))} data-testid="start-doc-menu-rename">
          <Icon size={14} icon={PencilEdit02Icon} />
          重命名
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem variant="destructive" onSelect={onRemove} data-testid="start-doc-menu-delete">
          <Icon size={14} icon={Delete02Icon} />
          删除
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}

function TitleInput({ initial, onDone }: { initial: string; onDone: (v: string | null) => void }) {
  const done = useRef(false)
  const finish = (v: string | null) => {
    if (done.current) return
    done.current = true
    onDone(v)
  }
  return (
    <input
      className="pointer-events-auto h-6 min-w-0 flex-1 rounded-md border border-lamp-text bg-work px-1.5 text-[13px] font-semibold text-ink-1 outline-none"
      defaultValue={initial}
      autoFocus
      onFocus={(e) => e.currentTarget.select()}
      onKeyDown={(e) => {
        if (e.nativeEvent.isComposing) return
        if (e.key === 'Enter') finish(e.currentTarget.value)
        else if (e.key === 'Escape') {
          e.stopPropagation()
          finish(null)
        }
      }}
      onBlur={(e) => finish(e.currentTarget.value)}
      aria-label="文档名"
      data-testid="start-doc-title-input"
    />
  )
}

function RecentRow({ r, active, unsaved, onOpen }: { r: RecentDoc; active: boolean; unsaved: boolean; onOpen: () => void }) {
  return (
    <div id={`start-recent-${r.id}`} role="option" aria-selected={active} className="group border-b border-line last:border-b-0" data-active={active ? '' : undefined} data-result="" data-testid="start-recent">
      <Tip label={`${unsaved ? '含未保存的更改\n' : ''}${new Date(r.closedAt).toLocaleString('zh-CN', { hour12: false })}`}>
        <button
          type="button"
          className="flex h-[34px] w-full items-center gap-2.5 px-3 text-left transition-colors duration-(--dur) group-data-[active]:bg-surface-2 group-data-[active]:ring-1 group-data-[active]:ring-lamp-text group-data-[active]:ring-inset hover:bg-surface-2 focus-visible:ring-1 focus-visible:ring-lamp-text focus-visible:outline-none focus-visible:ring-inset"
          onClick={onOpen}
          aria-label={`打开 ${r.title}${unsaved ? '，含未保存的更改' : ''}`}
        >
          <span className="flex w-[34px] shrink-0 gap-0.5">
            {filledSections(r.doc)
              .slice(0, 6)
              .map((s) => (
                <span key={s.id} className="h-3.5 w-1 rounded-[1.5px]" style={{ background: sectionTint(s.color) }} />
              ))}
          </span>
          <span className="truncate text-[13px] text-ink-2">{r.title}</span>
          {unsaved && <><span className="size-[7px] shrink-0 rounded-full bg-ink-3/60" aria-hidden="true" data-testid="start-recent-unsaved" /><span className="sr-only">含未保存的更改</span></>}
          {r.doc.characters.length > 0 && <span className="truncate text-[12px] text-ink-2 max-sm:hidden">{characterNames(r.doc)}</span>}
          <span className="ml-auto shrink-0 pl-2 text-[11px] text-ink-2 tabular-nums">
            {countChips(r.doc)} 个 tag · {relTime(r.closedAt)}
          </span>
        </button>
      </Tip>
    </div>
  )
}
