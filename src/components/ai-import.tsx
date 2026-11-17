import { useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { toast } from 'sonner'
import { AlertCircleIcon, FileSyncIcon } from '@hugeicons/core-free-icons'
import { ChipFace, chipAttrs } from '@/components/editor/chip-face'
import { sectionTint, sectionVars } from '@/components/editor/labels'
import { GenderIcon } from '@/components/gender'
import { Icon } from '@/components/icon'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tip } from '@/components/tip'
import { applyPlan, markedChips, pickedSummary, planTitle, type AiChange, type AiGroup, type AiPlan } from '@/lib/ai-doc'
import { chipLiteral } from '@/lib/nai'
import { cn } from '@/lib/utils'
import { AGENT_SOURCE, closeAiImport, importAiFile, isJsonFile, settleAgent, useAiImport } from '@/store/ai-import'
import { getDocStore } from '@/store/tabs'
import { recordAiVersion } from '@/store/versions'
import { useUi } from '@/store/ui'
import type { Chip, Doc, Section } from '@/types'

export function AiImportHost() {
  const open = useAiImport((s) => s.open)
  const plan = useAiImport((s) => s.plan)
  return (
    <Dialog open={open} onOpenChange={(o) => !o && closeAiImport()}>
      {plan ? <PlanForm plan={plan} /> : <PasteForm />}
    </Dialog>
  )
}

const UC_TINT = { color: 'oklch(var(--section-tint-l) 0.12 var(--hue-uc))' }

function PasteForm() {
  const error = useAiImport((s) => s.error)
  const [over, setOver] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const readFile = (f: File | undefined) => {
    if (!f) return
    if (!isJsonFile(f)) return useAiImport.setState({ error: `「${f.name}」不是 .json 文件` })
    void importAiFile(f)
  }
  return (
    <DialogContent className="sm:max-w-[480px]" data-own-drop data-testid="ai-paste">
      <div className="flex flex-col gap-1">
        <DialogTitle className="text-[13px] font-semibold">导入 AI 的回答</DialogTitle>
        <DialogDescription className="text-[12px] text-ink-2">先列出改动，选择后应用到当前文档</DialogDescription>
      </div>
      <button
        type="button"
        className={cn('flex items-center gap-2 rounded-md border border-dashed px-3 py-2.5 text-left text-[12px] text-ink-2 transition-colors', over ? 'border-lamp-text bg-lamp-text/8' : 'border-line-strong hover:bg-surface-2')}
        onClick={() => input.current?.click()}
        onDragOver={(e) => (e.preventDefault(), setOver(true))}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault()
          setOver(false)
          readFile(e.dataTransfer.files[0])
        }}
        data-testid="ai-paste-drop"
      >
        <Icon icon={FileSyncIcon} size={14} className="text-ink-2" />
        Ctrl+V 粘贴 AI 的回答，或拖入 .json 文件、点击选择文件
      </button>
      <input ref={input} type="file" accept=".json,application/json" className="hidden" onChange={(e) => readFile(e.target.files?.[0])} data-testid="ai-paste-file" />
      <p className="flex min-h-[18px] items-center gap-1.5 text-[12px] text-destructive transition-opacity duration-150 data-[empty]:opacity-0" data-empty={error ? undefined : ''} data-testid="ai-paste-error">
        {error && (
          <>
            <Icon icon={AlertCircleIcon} size={14} />
            {error}
          </>
        )}
      </p>
    </DialogContent>
  )
}

const GROUPS: { g: AiGroup; label: string }[] = [
  { g: 'prompt', label: '正面' },
  { g: 'uc', label: '负面' },
  { g: 'char', label: '角色' },
  { g: 'settings', label: '参数' },
]

function PlanForm({ plan }: { plan: AiPlan }) {
  const tabId = useAiImport((s) => s.tabId)
  const fromAgent = useAiImport((s) => s.source === AGENT_SOURCE)
  const store = getDocStore(tabId)
  const doc = store.getState().doc
  const [picks, setPicks] = useState(() => new Set(plan.changes.filter((c) => c.defaultOn).map((c) => c.key)))
  const [seen, setSeen] = useState(plan)
  if (seen !== plan) {
    setSeen(plan)
    setPicks(new Set(plan.changes.filter((c) => c.defaultOn).map((c) => c.key)))
  }
  const contentRef = useRef<HTMLDivElement>(null)
  const toggle = (key: string, on: boolean) =>
    setPicks((p) => {
      const n = new Set(p)
      if (on) n.add(key)
      else n.delete(key)
      return n
    })
  const summary = pickedSummary(plan, picks)

  const apply = () => {
    // The dialog remains mounted while fading out; reject repeat submissions to avoid applying duplicate section IDs.
    if (!picks.size || !useAiImport.getState().open) return
    const before = store.getState().doc
    const next = applyPlan(before, plan, picks)
    useUi.getState().blur()
    store.getState().applyDoc(next)
    const after = store.getState().doc
    // If later edits exist, restore through a new undo step so those edits remain recoverable.
    const undo = () => {
      if (store.getState().doc === after) store.temporal.getState().undo()
      else store.getState().replaceDoc(before)
    }
    toast(`已应用 ${fromAgent ? 'AI 代理的' : 'AI 的'} ${picks.size} 处修改`, { action: { label: '撤销', onClick: undo } })
    if (after !== before) void recordAiVersion(after, picks.size, useAiImport.getState().request || undefined)
    useAiImport.getState().onApplied?.(picks.size, plan.changes.length, after)
    settleAgent({ applied: [...picks] })
    closeAiImport()
  }
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== 'Enter' || e.nativeEvent.isComposing) return
    if ((e.target as HTMLElement).closest('button:not([role=checkbox])')) return
    e.preventDefault()
    apply()
  }

  return (
    <DialogContent
      ref={contentRef}
      className="grid max-h-[calc(100dvh-64px)] w-[760px] max-w-[calc(100%-2rem)] grid-cols-[minmax(0,1fr)] grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden rounded-xl bg-work p-0 text-ink-1 shadow-(--shadow-pop) ring-line sm:max-w-[calc(100%-2rem)]"
      onOpenAutoFocus={(e) => {
        e.preventDefault()
        contentRef.current?.focus()
      }}
      onKeyDown={onKeyDown}
      data-own-drop
      data-testid="ai-import"
    >
      <header className="flex items-center gap-2.5 py-3 pr-11 pl-4">
        <DialogTitle className="shrink-0 text-[13px] font-semibold">{fromAgent ? 'AI 代理的修改' : '导入 AI 的回答'}</DialogTitle>
        <span className="min-w-0 truncate text-[12px] text-ink-2">{doc.meta.title}</span>
        <DialogDescription className="sr-only">勾选要应用到当前文档的改动</DialogDescription>
      </header>
      <ScrollArea className="min-h-0 border-y border-line">
        <div className="flex animate-in flex-col gap-4 px-4 py-3.5 duration-150 fade-in-0">
          {plan.comment && <Analysis text={plan.comment} />}
          <Summary plan={plan} />
          {GROUPS.map(({ g, label }) => {
            const list = plan.changes.filter((c) => c.group === g)
            if (!list.length) return null
            return (
              <section key={g} data-testid={`ai-group-${g}`}>
                <div className="mb-1.5 text-[13px] font-semibold" style={g === 'uc' ? UC_TINT : undefined}>
                  {label}
                </div>
                <div className="flex flex-col divide-y divide-dashed divide-line">
                  {list.map((c) => (
                    <Row key={c.key} change={c} doc={doc} on={picks.has(c.key)} onChange={(v) => toggle(c.key, v)} />
                  ))}
                </div>
              </section>
            )
          })}
        </div>
      </ScrollArea>
      <footer className="flex items-center gap-2.5 py-2.5 pr-3.5 pl-4">
        <span className="min-w-0 flex-1 truncate text-right text-[12px] text-ink-2" data-testid="ai-import-summary">
          {summary ? (
            <>
              将修改：<span className="font-medium text-ink-1">{summary}</span>
            </>
          ) : (
            '未勾选任何改动'
          )}
        </span>
        <Button variant="outline" size="lg" onClick={closeAiImport}>
          取消
        </Button>
        <Button size="lg" className="px-3 font-semibold" disabled={!picks.size} onClick={apply} data-testid="ai-import-apply">
          应用 <span className="font-mono text-[11px] opacity-60">↵</span>
        </Button>
      </footer>
    </DialogContent>
  )
}

function Analysis({ text }: { text: string }) {
  return (
    <div className="rounded-lg border border-line-strong px-2.5 py-2 text-[12px] leading-[1.7]" data-testid="ai-import-comment">
      <div className="font-semibold text-ink-1">AI 的分析</div>
      <p className="break-words whitespace-pre-wrap text-ink-1 select-text">{text}</p>
    </div>
  )
}

function Summary({ plan }: { plan: AiPlan }) {
  return (
    <div className="rounded-lg border border-line bg-shell px-2.5 py-2 text-[12px] leading-[1.7] text-ink-2" data-testid="ai-import-overview">
      <div className="font-semibold text-ink-1">{planTitle(plan)}</div>
      {plan.changes.map((c) => (
        <Tip key={c.key} label={c.line}>
          <div className="truncate">
            · {c.line}
          </div>
        </Tip>
      ))}
      {plan.skipped.map((t) => (
        <Tip key={t} label={t}>
          <div className="truncate text-ink-2">
            · {t}
          </div>
        </Tip>
      ))}
    </div>
  )
}

const charIndex = (doc: Doc, id: string) => doc.characters.findIndex((c) => c.id === id) + 1

function Row({ change: c, doc, on, onChange }: { change: AiChange; doc: Doc; on: boolean; onChange: (v: boolean) => void }) {
  const charId = c.kind === 'char' ? c.charId : c.kind === 'newChar' || c.kind === 'deleteChar' ? null : c.kind === 'setting' ? null : c.box.kind === 'char' ? c.box.charId : null
  const badge = charId ? <span className="imp-badge size-4 text-[11px]">{charIndex(doc, charId)}</span> : null
  return (
    <div className="flex items-start gap-2 py-2 first:pt-0.5" data-testid="ai-change" data-kind={c.kind}>
      <Checkbox className="mt-0.5" checked={on} onCheckedChange={(v) => onChange(v === true)} aria-label={c.title} data-testid="ai-change-check" />
      <div className="imp-dim flex min-w-0 flex-1 flex-col gap-1.5" data-off={on ? undefined : ''}>
        <Body c={c} badge={badge} />
      </div>
    </div>
  )
}

function Head({ children }: { children: ReactNode }) {
  return <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[13px] font-semibold">{children}</div>
}
export const Tint = ({ s, children }: { s: Section; children?: ReactNode }) => (
  <>
    <i className="size-[7px] shrink-0 rounded-[2px]" style={{ background: sectionTint(s.color) }} />
    <span style={{ color: sectionTint(s.color) }}>{children ?? s.name}</span>
  </>
)
const Gray = ({ children }: { children: ReactNode }) => <span className="text-[12px] font-normal text-ink-2">{children}</span>

function Body({ c, badge }: { c: AiChange; badge: ReactNode }) {
  switch (c.kind) {
    case 'section': {
      const marks = markedChips(c.diff)
      return (
        <>
          <Head>
            {badge}
            {badge && <span className="text-ink-2">{c.title.split(' › ')[0]} ›</span>}
            <Tint s={c.before} />
            {c.diff.rename && <Gray>→ {c.diff.rename[1]}</Gray>}
            <Gray>{c.counts}</Gray>
          </Head>
          <Card section={c.after} marks={marks} />
          {c.diff.removed.length > 0 && (
            <p className="text-[12px] text-ink-2" data-testid="ai-removed">
              移除{' '}
              {c.diff.removed.map((x) => (
                <s key={x.id} className="mr-1.5 decoration-ink-3/60">
                  {chipLiteral(x)}
                </s>
              ))}
            </p>
          )}
        </>
      )
    }
    case 'newSection':
      return (
        <>
          <Head>
            {badge}
            <span>新区块</span>
            <Tint s={c.section} />
            <Gray>{c.afterName ? `放在「${c.afterName}」后面` : '放在最后'}</Gray>
          </Head>
          <Card section={c.section} />
        </>
      )
    case 'deleteSection':
      return (
        <>
          <Head>
            {badge}
            <span>删除区块</span>
            <s className="inline-flex items-center gap-1.5 decoration-ink-1 decoration-[1.5px]">
              <Tint s={c.section} />
            </s>
          </Head>
          <div className="opacity-50">
            <Card section={c.section} />
          </div>
        </>
      )
    case 'char':
      return (
        <Head>
          {badge}
          <span>{c.title}</span>
          <Gray>{c.parts.join('，')}</Gray>
        </Head>
      )
    case 'newChar':
      return (
        <>
          <Head>
            <span>新角色</span>
            <GenderIcon gender={c.character.gender} extra={c.character.genderExtra} size={14} />
            <span>{c.title}</span>
          </Head>
          {[...c.character.prompt, ...c.character.uc].map((s) => (
            <Card key={s.id} section={s} title />
          ))}
        </>
      )
    case 'deleteChar':
      return (
        <Head>
          <span>删除角色</span>
          <s className="decoration-ink-1 decoration-[1.5px]">{c.title}</s>
        </Head>
      )
    case 'setting':
      return (
        <div className="flex items-center gap-2 text-[13px]">
          <span className="w-16 shrink-0 text-ink-2">{c.title}</span>
          <span className="text-[12px] font-medium">
            {c.from} → {c.to}
          </span>
        </div>
      )
  }
}

function Card({ section, marks, title }: { section: Section; marks?: Set<string>; title?: boolean }) {
  return (
    <div className="imp-sec" style={sectionVars(section.color)}>
      {title && (
        <div className="imp-sec-h">
          <i style={{ background: sectionTint(section.color) }} />
          <span style={{ color: sectionTint(section.color) }}>{section.name}</span>
        </div>
      )}
      <div className="flex flex-wrap gap-1">
        {section.chips.map((ch: Chip) => (
          <span key={ch.id} className="chip tpl-chip" {...chipAttrs(ch)} data-chip-id={undefined} data-ai-mark={marks?.has(ch.id) ? '' : undefined} data-testid="ai-chip">
            <ChipFace chip={ch} />
          </span>
        ))}
      </div>
    </div>
  )
}
