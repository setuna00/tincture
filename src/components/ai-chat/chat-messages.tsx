import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { AiChat02Icon, ArrowDown02Icon, ArrowLeft01Icon, ArrowRight01Icon, CheckListIcon, Copy01Icon, PencilEdit01Icon, RepeatIcon } from '@hugeicons/core-free-icons'
import { Icon } from '@/components/icon'
import { Tint } from '@/components/ai-import'
import { Tip } from '@/components/tip'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { altOf, altText, docKey, proseOf, userOf, type ChatAction, type ChatAiMsg, type ChatAlt, type ChatConv, type ChatMsg, type ChatUserMsg } from '@/lib/ai-chat'
import type { AiChange } from '@/lib/ai-doc'
import { chipLiteral, formatWeight } from '@/lib/nai'
import { cn } from '@/lib/utils'
import { openSettings } from '@/lib/settings-nav'
import { aiOptions } from '@/store/ai-import'
import {
  applyCard,
  cardPlan,
  openCardInTab,
  previewCard,
  regenChat,
  resendEdited,
  retryChat,
  setAlt,
  toggleCardExpanded,
  undoCard,
  useChat,
  type ChatSending,
} from '@/store/chat'
import { useDoc } from '@/store/context'
import { usePrefs } from '@/store/prefs'
import { EmptyActions } from './chat-actions'
import { ChatMd } from './chat-md'
import { grow, isSendKey } from './compose'
import { ProviderIcon } from './provider-icon'

const near = (el: HTMLElement) => el.scrollHeight - el.scrollTop - el.clientHeight < 60

export function ChatList({ docId, conv }: { docId: string; conv: ChatConv | null }) {
  const sending = useChat((s) => (s.sending && s.sending.docId === docId && s.sending.convId === conv?.id ? s.sending : null))
  const busy = useChat((s) => !!s.sending)
  const wrap = useRef<HTMLDivElement>(null)
  const viewport = () => wrap.current?.querySelector<HTMLElement>('[data-slot=scroll-area-viewport]') ?? null
  const [away, setAway] = useState(false)
  const stick = useRef(true)
  useLayoutEffect(() => {
    const v = viewport()
    if (v && stick.current) v.scrollTop = v.scrollHeight
  })
  useEffect(() => {
    stick.current = true
    const v = viewport()
    if (v) v.scrollTop = v.scrollHeight
  }, [conv?.id])
  useEffect(() => {
    const v = viewport()
    if (!v) return
    const on = () => {
      stick.current = near(v)
      setAway(!near(v))
    }
    v.addEventListener('scroll', on, { passive: true })
    return () => v.removeEventListener('scroll', on)
  }, [])
  const msgs = conv?.msgs ?? []
  const lastAi = msgs.findLast((m) => m.role === 'ai')?.id
  const last = msgs.at(-1)?.id
  return (
    <div ref={wrap} className="relative min-h-0 flex-1" data-testid="ai-chat-list">
      <ScrollArea className="h-full">
        {msgs.length || sending ? (
          <div className="flex flex-col gap-[18px] px-3.5 pt-4 pb-2">
            {msgs.map((m) => (
              <Msg key={m.id} m={m} msgs={msgs} isLastAi={m.id === lastAi} isLast={m.id === last} busy={busy} />
            ))}
            {sending && <Streaming s={sending} />}
          </div>
        ) : (
          <div className="page-in absolute inset-0 flex flex-col items-center justify-center gap-2 px-3 pb-16 text-center" data-testid="ai-chat-empty">
            <Icon icon={AiChat02Icon} size={32} className="mb-1 text-ink-3" />
            <p className="text-[13px] text-ink-2">暂无对话</p>
            <EmptyActions />
          </div>
        )}
      </ScrollArea>
      <button
        type="button"
        className="chat-latest"
        data-hidden={away ? undefined : ''}
        onClick={() => viewport()?.scrollTo({ top: viewport()!.scrollHeight, behavior: 'smooth' })}
        data-testid="ai-chat-latest"
      >
        <Icon icon={ArrowDown02Icon} size={14} />
        跳至最新
      </button>
    </div>
  )
}

function Msg({ m, msgs, isLastAi, isLast, busy }: { m: ChatMsg; msgs: ChatMsg[]; isLastAi: boolean; isLast: boolean; busy: boolean }) {
  if (m.role === 'note')
    return (
      <div className="chat-note" data-testid="ai-chat-note">
        {m.text}
      </div>
    )
  if (m.role === 'user') return <UserMsg m={m} isLast={isLast} busy={busy} />
  return <AiMsg m={m} msgs={msgs} isLastAi={isLastAi} busy={busy} />
}

const copy = (text: string) => void navigator.clipboard?.writeText(text).catch(() => {})

function IconBtn({ icon, label, onClick, disabled, children, testId }: { icon: Parameters<typeof Icon>[0]['icon']; label: string; onClick: () => void; disabled?: boolean; children?: string; testId?: string }) {
  return (
    <Tip label={label}>
      <button type="button" className="chat-ib" onClick={onClick} disabled={disabled} aria-label={label} data-testid={testId}>
        <Icon icon={icon} size={14} />
        {children && <span>{children}</span>}
      </button>
    </Tip>
  )
}

function UserMsg({ m, isLast, busy }: { m: ChatUserMsg; isLast: boolean; busy: boolean }) {
  const editing = useChat((s) => s.editing === m.id)
  if (editing) return <UserEditor m={m} />
  return (
    <>
      <div className="chat-u" data-testid="ai-chat-user" data-mode={m.edit ? 'edit' : 'chat'}>
        <Tip label={m.edit ? '修改文档' : '问答'}>
          <div className="chat-bubble select-text" data-edit={m.edit ? '' : undefined}>
            {m.text}
          </div>
        </Tip>
        {!!m.action?.found.length && <Attached a={m.action} />}
        <div className="chat-uacts">
          <IconBtn icon={PencilEdit01Icon} label="编辑并重新发送" disabled={busy} onClick={() => useChat.setState({ editing: m.id })} testId="ai-chat-edit" />
          <IconBtn icon={Copy01Icon} label="复制" onClick={() => copy(m.text)} />
        </div>
      </div>
      {m.failedReply && (
        <div className="chat-a text-ink-1" data-testid="ai-chat-failed-reply">
          <AiHead preset={m.failedReply.preset} label={m.failedReply.label} />
          <ChatMd text={m.failedReply.raw} />
        </div>
      )}
      {m.failed && (
        <div className="chat-err" data-stopped={m.failureKind === 'stopped' ? '' : undefined} data-reply={m.failedReply ? '' : undefined} data-testid="ai-chat-error">
          <span className="select-text">{m.failed}</span>
          {(m.failureKind === 'unauthorized' || m.failureKind === 'quota') && (
            <Button variant="link" size="xs" className="h-auto p-0 text-ink-2" onClick={() => openSettings('ai')} data-testid="ai-chat-error-settings">
              设置 → AI
            </Button>
          )}
          {isLast && (
            <Button variant="outline" size="xs" disabled={busy} onClick={() => retryChat(m.id)} data-testid="ai-chat-retry">
              重试
            </Button>
          )}
        </div>
      )}
    </>
  )
}

function Attached({ a }: { a: ChatAction }) {
  const what = a.id === 'dedupe' ? '重复' : '未识别'
  const words = a.found.slice(0, 12).map((w) => w.replace(/ /g, ' ')).join('、') + (a.found.length > 12 ? ` 等 ${a.found.length} 个` : '')
  return (
    <Tip side="bottom" label={`${what}：${words}`}>
      <div className="chat-attach" data-testid="ai-chat-attach">
        <Icon icon={CheckListIcon} size={13} />
        已附 tag 库检查 · {what} {a.found.length}
      </div>
    </Tip>
  )
}

function UserEditor({ m }: { m: ChatUserMsg }) {
  const [text, setText] = useState(m.text)
  const sendKey = usePrefs((s) => s.chatSendKey)
  const ta = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    const t = ta.current
    if (!t) return
    t.focus()
    t.setSelectionRange(t.value.length, t.value.length)
  }, [])
  useEffect(() => grow(ta.current, 240), [text])
  const cancel = () => useChat.setState({ editing: null })
  return (
    <div className="chat-ueditor" data-testid="ai-chat-user-editor">
      <textarea
        ref={ta}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (isSendKey(e, sendKey)) {
            e.preventDefault()
            resendEdited(m.id, text)
          } else if (e.key === 'Escape') {
            e.stopPropagation()
            cancel()
          }
        }}
        aria-label="编辑要求"
      />
      <div className="flex items-center gap-1.5">
        <span className="mr-auto text-[11px] text-ink-3">将从此处分出新对话</span>
        <Button variant="ghost" size="sm" className="text-ink-2" onClick={cancel}>
          取消
        </Button>
        <Button size="sm" className="font-semibold" disabled={!text.trim()} onClick={() => resendEdited(m.id, text)} data-testid="ai-chat-resend">
          发送
        </Button>
      </div>
    </div>
  )
}

function AiHead({ preset, label }: { preset: string; label: string }) {
  return (
    <div className="chat-ahead">
      <ProviderIcon preset={preset} size={16} />
      <span className="truncate">{label}</span>
    </div>
  )
}

function AiMsg({ m, msgs, isLastAi, busy }: { m: ChatAiMsg; msgs: ChatMsg[]; isLastAi: boolean; busy: boolean }) {
  const a = altOf(m)
  const user = userOf(msgs, m)
  const text = altText(a, user?.edit ?? false)
  const many = m.alts.length > 1
  return (
    <div className="chat-a" data-testid="ai-chat-ai">
      <AiHead preset={a.preset} label={a.label} />
      {text && <ChatMd text={text} />}
      {a.hidden && <div className="text-[12px] text-ink-3" data-testid="ai-chat-hidden">已隐藏 AI 给出的修改</div>}
      {a.card && user && <ChangeCard key={m.alt} m={m} a={a} user={user} />}
      <div className="chat-aacts" data-keep={many ? '' : undefined}>
        <IconBtn icon={Copy01Icon} label="复制" onClick={() => copy(proseOf(a.raw) || a.raw)} />
        {isLastAi && (
          <IconBtn icon={RepeatIcon} label="重新生成" disabled={busy} onClick={() => regenChat(m.id)} testId="ai-chat-regen">
            重新生成
          </IconBtn>
        )}
        {many && (
          <span className="chat-alt" data-testid="ai-chat-alts">
            <IconBtn icon={ArrowLeft01Icon} label="上一个" disabled={m.alt === 0} onClick={() => setAlt(m.id, m.alt - 1)} testId="ai-chat-alt-prev" />
            <span className="tabular-nums">
              {m.alt + 1} / {m.alts.length}
            </span>
            <IconBtn icon={ArrowRight01Icon} label="下一个" disabled={m.alt === m.alts.length - 1} onClick={() => setAlt(m.id, m.alt + 1)} testId="ai-chat-alt-next" />
          </span>
        )}
      </div>
    </div>
  )
}

function Streaming({ s }: { s: ChatSending }) {
  const prose = proseOf(s.text)
  const gen = s.edit && /```/.test(s.text)
  return (
    <div className="chat-a" data-testid="ai-chat-streaming">
      <AiHead preset={s.preset} label={s.label} />
      {prose && <ChatMd text={prose} />}
      {gen ? (
        <div className="chat-card-box" data-testid="ai-chat-generating">
          <div className="chat-gen">
            <span>生成修改中…</span>
            <span className="chat-gen-bar" />
          </div>
        </div>
      ) : (
        !prose && (
          <div className="chat-wait" data-testid="ai-chat-wait">
            <i />
            <i />
            <i />
            <span>{s.thinking ? `已收到 ${s.thinking.toLocaleString('en-US')} 字` : '等待中…'}</span>
          </div>
        )
      )}
    </div>
  )
}

const STATUS: Record<string, string> = { applied: '已应用', reviewed: '已部分应用', branch: '已在新 tab 中打开', here: '已应用' }

function ChangeCard({ m, a, user }: { m: ChatAiMsg; a: ChatAlt; user: ChatUserMsg }) {
  const card = a.card!
  const [plan] = useState(() => cardPlan(user, a))
  const nowKey = useDoc((s) => (card.status === 'applied' ? docKey(s.doc, aiOptions()) : ''))
  const canUndo = card.status === 'applied' && card.afterKey === nowKey
  const shown = card.expanded ? plan.changes : plan.changes.slice(0, 5)
  return (
    <div className="chat-card-box" data-testid="ai-change-card" data-status={card.status}>
      <div className="chat-card-h">
        <span>{plan.changes.length ? `修改 ${plan.changes.length} 处` : '未修改任何内容'}</span>
        {STATUS[card.status] && (
          <span className="chat-pill" data-testid="ai-chat-card-status">
            {STATUS[card.status]}
            {canUndo && (
              <>
                {' · '}
                <button type="button" onClick={() => undoCard(m.id)} data-testid="ai-chat-card-undo">
                  撤销
                </button>
              </>
            )}
          </span>
        )}
      </div>
      <div className="chat-changes">
        {shown.map((c) => (
          <Change key={c.key} c={c} />
        ))}
        {plan.changes.length > 5 && (
          <button type="button" className="chat-more" onClick={() => toggleCardExpanded(m.id)} data-testid="ai-chat-card-more">
            {card.expanded ? '收起' : `展开全部 ${plan.changes.length} 处`}
          </button>
        )}
        {plan.skipped.map((t) => (
          <div key={t} className="text-[12px] text-ink-2">
            {t}
          </div>
        ))}
      </div>
      {plan.changes.length > 0 && (
        <div className="chat-acts">
          <Button variant={card.status === 'none' ? 'default' : 'outline'} size="sm" className="font-semibold" onClick={() => applyCard(m.id)} data-testid="ai-chat-card-apply">
            应用
          </Button>
          <Button variant="outline" size="sm" onClick={() => previewCard(m.id)} data-testid="ai-chat-card-preview">
            预览
          </Button>
          <Button variant="ghost" size="sm" className="text-ink-2" onClick={() => openCardInTab(m.id)} data-testid="ai-chat-card-tab">
            在新 tab 中打开
          </Button>
        </div>
      )}
    </div>
  )
}

function Change({ c }: { c: AiChange }) {
  const chips: [string, string][] = []
  let title = ''
  if (c.kind === 'section') {
    title = c.title
    for (const x of c.diff.added) chips.push(['add', `+ ${chipLiteral(x)}`])
    for (const x of c.diff.removed) chips.push(['rm', chipLiteral(x)])
    for (const r of c.diff.reweighted) chips.push(['w', `${chipLiteral(r.chip)} ${formatWeight(r.from)} → ${formatWeight(r.chip.weight)}`])
    for (const x of c.diff.disabled) chips.push(['w', `禁用 ${chipLiteral(x)}`])
    for (const x of c.diff.enabled) chips.push(['w', `启用 ${chipLiteral(x)}`])
    if (c.diff.rename) chips.push(['w', `重命名为「${c.diff.rename[1]}」`])
    if (!chips.length) chips.push(['w', '调整顺序'])
  } else if (c.kind === 'newSection') {
    title = `新区块「${c.section.name}」`
    for (const x of c.section.chips) chips.push(['add', `+ ${chipLiteral(x)}`])
  } else if (c.kind === 'setting') {
    title = c.title
    chips.push(['w', `${c.from} → ${c.to}`])
  } else title = c.line
  return (
    <div className="grid gap-1" data-testid="ai-chat-change" data-kind={c.kind}>
      <div className="flex flex-wrap items-center gap-x-1.5 text-[12px] font-medium text-ink-2" data-testid="ai-chat-change-head">
        {c.kind === 'section' ? (
          <>
            {c.box.kind === 'char' && <span>{c.title.split(' › ')[0]} ›</span>}
            <Tint s={c.before} />
          </>
        ) : c.kind === 'newSection' ? (
          <>新区块<Tint s={c.section} /></>
        ) : title}
      </div>
      {chips.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {chips.map(([k, t], i) => (
            <span key={i} className={cn('chat-chip', k)}>
              {t}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
