import { useEffect, useRef, useState } from 'react'
import {
  Add01Icon,
  AiChat02Icon,
  ArrowDown01Icon,
  ArrowUp02Icon,
  Cancel01Icon,
  ClipboardPasteIcon,
  Copy01Icon,
  Download04Icon,
  FileImportIcon,
  MoreHorizontalIcon,
  PinIcon,
  PinOffIcon,
  StopIcon,
  TextAlignLeftIcon,
  Tick02Icon,
  TimeQuarterPassIcon,
} from '@hugeicons/core-free-icons'
import { AssistCollapse } from '@/components/assistant/panel'
import { useAfterMenu } from '@/components/after-menu'
import { Icon } from '@/components/icon'
import { Tip } from '@/components/tip'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { chatTokens, formatTokens, lastUsage, type ChatConv } from '@/lib/ai-chat'
import { openSettings } from '@/lib/settings-nav'
import { cn } from '@/lib/utils'
import { currentService, serviceName, useAi, type AiServiceConf } from '@/store/ai'
import { copyAiPrompt, importAiPicked, pasteAiReply, saveAiPrompt } from '@/store/ai-import'
import { closeChat, currentConv, docIdOf, loadChats, newConv, openChat, pickedRules, selectConv, sendChat, stopChat, toggleRule, useChat } from '@/store/chat'
import { useLibrary } from '@/store/library'
import { usePrefs } from '@/store/prefs'
import { getDocStore, useTabs } from '@/store/tabs'
import { ActionsMenu } from './chat-actions'
import { ChatList } from './chat-messages'
import { grow, isSendKey } from './compose'
import { ProviderIcon } from './provider-icon'

function useActiveDocId(): string | null {
  const activeId = useTabs((s) => s.activeId)
  const isStart = useTabs((s) => s.starts.includes(s.activeId))
  return isStart ? null : docIdOf(getDocStore(activeId).getState().doc, activeId)
}

export function ChatPanel({ shown }: { shown: boolean }) {
  const entry = usePrefs((s) => s.chatEntry)
  const docId = useActiveDocId()
  useEffect(() => {
    if (docId) void loadChats(docId)
  }, [docId])
  return (
    <aside
      className="absolute inset-0 flex flex-col bg-shell transition-opacity duration-150 data-[hidden]:pointer-events-none data-[hidden]:invisible data-[hidden]:opacity-0"
      data-hidden={shown ? undefined : ''}
      inert={!shown}
      aria-label="问 AI"
      data-testid="ai-chat"
    >
      {entry === 'tab' && <AssistTabs active="ai" />}
      <div className="chat-card" data-testid="ai-chat-card">
        <ChatHead docId={docId} entry={entry} />
        {docId && <ChatBody docId={docId} />}
      </div>
    </aside>
  )
}

export function AssistTabs({ active }: { active: 'library' | 'ai' }) {
  const n = useLibrary((s) => s.sectionTemplates.length + s.characterTemplates.length)
  return (
    <header className="app-drag flex h-9 shrink-0 items-stretch gap-1 border-b border-line pr-1.5 pl-1" data-testid="assist-tabs">
      <button
        type="button"
        className="page-tab gap-1.5 px-2"
        data-active={active === 'library' ? '' : undefined}
        onClick={() => active === 'ai' && closeChat({ restore: false })}
        data-testid="assist-tab-library"
      >
        模板库
        <span className="text-[11px] font-normal text-ink-2 tabular-nums">{n}</span>
      </button>
      <button type="button" className="page-tab gap-1.5 px-2" data-active={active === 'ai' ? '' : undefined} onClick={() => active === 'library' && openChat()} data-testid="assist-tab-ai">
        <Icon icon={AiChat02Icon} size={15} />
        问 AI
      </button>
      <div className="ml-auto flex items-center">
        <AssistCollapse />
      </div>
    </header>
  )
}

const HB = 'size-7 rounded-md text-ink-2 hover:bg-(--chat-hover) hover:text-ink-1 aria-expanded:bg-(--chat-hover) aria-expanded:text-ink-1'

function ChatHead({ docId, entry }: { docId: string | null; entry: 'rail' | 'tab' }) {
  const pinned = usePrefs((s) => s.chatPinned)
  return (
    <header className={cn('chat-head', entry === 'rail' && 'app-drag')} data-testid="ai-chat-head">
      <ModelMenu />
      {docId && <HistoryMenu docId={docId} />}
      <Tip label="新对话">
        <Button variant="ghost" size="icon" className={HB} disabled={!docId} onClick={newConv} aria-label="新对话" data-testid="ai-chat-new">
          <Icon icon={Add01Icon} size={16} />
        </Button>
      </Tip>
      <Tip label={pinned ? '取消固定' : '固定：选中 tag、区块或角色时不切换面板'}>
        <Button
          variant="ghost"
          size="icon"
          className={cn(HB, 'aria-pressed:text-lamp-text')}
          aria-pressed={pinned}
          onClick={() => usePrefs.getState().set({ chatPinned: !pinned })}
          aria-label={pinned ? '取消固定' : '固定'}
          data-testid="ai-chat-pin"
        >
          <Icon icon={pinned ? PinOffIcon : PinIcon} size={16} />
        </Button>
      </Tip>
      <MoreMenu disabled={!docId} />
      {entry === 'rail' && (
        <Tip label="关闭">
          <Button variant="ghost" size="icon" className={HB} onClick={() => closeChat()} aria-label="关闭" data-testid="ai-chat-close">
            <Icon icon={Cancel01Icon} size={16} />
          </Button>
        </Tip>
      )}
    </header>
  )
}

function ModelMenu() {
  const services = useAi((s) => s.services)
  const cur = useAi((s) => currentService(s))
  const conn = useAi((s) => s.conn)
  const groups: [string, AiServiceConf[]][] = (
    [
      ['NAI 令牌', services.filter((x) => x.preset === 'novelai')],
      ['API Key', services.filter((x) => x.preset !== 'novelai')],
    ] as [string, AiServiceConf[]][]
  ).filter(([, l]) => l.length)
  const onOpen = (o: boolean) => {
    if (!o) return
    const st = useAi.getState()
    for (const s of st.services) if (!st.conn[s.id]) void st.check(s.id)
  }
  const pick = (s: AiServiceConf, model?: string) => {
    if (model !== undefined && model !== s.model) useAi.getState().saveService({ ...s, model })
    useAi.getState().setCurrent(s.id)
  }
  return (
    <DropdownMenu onOpenChange={onOpen}>
      <DropdownMenuTrigger asChild>
        <Tip label={cur ? `${serviceName(cur)} · ${cur.model.trim() || '未选择模型'}` : undefined}>
          <button type="button" className="chat-model" data-testid="ai-chat-model">
            <ProviderIcon preset={cur?.preset} size={20} />
            <span className="truncate">{cur ? cur.model.trim() || '未选择模型' : '未设置 AI 服务'}</span>
            <Icon icon={ArrowDown01Icon} size={14} className="shrink-0 text-ink-3" />
          </button>
        </Tip>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" alignOffset={-6} className="w-64" data-testid="ai-chat-model-menu">
        {groups.map(([title, list], gi) => (
          <div key={title}>
            {gi > 0 && <DropdownMenuSeparator />}
            <DropdownMenuLabel className="text-[11px] font-normal text-ink-3">{title}</DropdownMenuLabel>
            {list.map((s) => {
              const c = conn[s.id]
              const models = [...new Set([s.model.trim(), ...(c?.state === 'done' ? c.models.slice(0, 6) : [])])].filter(Boolean)
              return (
                <div key={s.id}>
                  <DropdownMenuItem className="gap-2" onSelect={() => pick(s)} data-testid="ai-chat-service">
                    <ProviderIcon preset={s.preset} size={20} />
                    <span className="truncate">{serviceName(s)}</span>
                    {s.id === cur?.id && <Icon icon={Tick02Icon} size={14} className="ml-auto" />}
                  </DropdownMenuItem>
                  {models.map((m) => {
                    const on = s.id === cur?.id && m === s.model.trim()
                    return (
                      <DropdownMenuItem key={m} className={cn('min-h-6.5 pl-9 text-[12px]', on ? 'font-semibold text-ink-1' : 'text-ink-2')} onSelect={() => pick(s, m)} data-testid="ai-chat-model-option">
                        <span className="truncate">{m}</span>
                      </DropdownMenuItem>
                    )
                  })}
                </div>
              )
            })}
          </div>
        ))}
        {groups.length > 0 && <DropdownMenuSeparator />}
        <DropdownMenuItem onSelect={() => openSettings('ai')} data-testid="ai-chat-manage">
          管理 AI 服务
          <span className="ml-auto pl-4 text-[11px] text-ink-3">设置 → AI</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function HistoryMenu({ docId }: { docId: string }) {
  const list = useChat((s) => s.byDoc[docId])
  const cur = useChat((s) => currentConv(s, docId))
  const menu = useAfterMenu()
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Tip label="对话记录">
          <Button variant="ghost" size="icon" className={HB} aria-label="对话记录" data-testid="ai-chat-history">
            <Icon icon={TimeQuarterPassIcon} size={16} />
          </Button>
        </Tip>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72" onCloseAutoFocus={menu.onCloseAutoFocus} data-testid="ai-chat-history-menu">
        <DropdownMenuItem onSelect={() => menu.later(newConv)}>
          <Icon icon={Add01Icon} size={14} />
          新对话
        </DropdownMenuItem>
        {!!list?.length && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-[11px] font-normal text-ink-3">当前文档的对话</DropdownMenuLabel>
            {list.map((c) => (
              <HistoryRow key={c.id} c={c} current={c.id === cur?.id} />
            ))}
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function HistoryRow({ c, current }: { c: ChatConv; current: boolean }) {
  const n = c.msgs.filter((m) => m.role === 'user').length
  const u = current ? lastUsage(c) : undefined
  const meta = current && c.msgs.length ? formatTokens(chatTokens(c)) : new Date(c.updatedAt).toLocaleDateString()
  return (
    <DropdownMenuItem className={cn('gap-3', current && 'font-semibold')} onSelect={() => selectConv(c.id)} data-testid="ai-chat-conv" data-current={current ? '' : undefined}>
      <span className="min-w-0 flex-1 truncate">{c.title || '未命名对话'}</span>
      <Tip label={u ? `上一轮：输入 ${u.input.toLocaleString('en-US')}（缓存 ${u.cacheRead.toLocaleString('en-US')}）· 输出 ${u.output.toLocaleString('en-US')}` : undefined}>
        <span className="shrink-0 text-[11px] font-normal text-ink-3 tabular-nums" data-testid="ai-chat-conv-meta">
          {n} 条 · {meta}
        </span>
      </Tip>
    </DropdownMenuItem>
  )
}

function MoreMenu({ disabled }: { disabled: boolean }) {
  const [done, setDone] = useState(false)
  const file = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (!done) return
    const t = setTimeout(() => setDone(false), 1200)
    return () => clearTimeout(t)
  }, [done])
  const doc = () => getDocStore(useTabs.getState().activeId).getState().doc
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild disabled={disabled}>
          <Tip label="复制给 AI · 导入 AI 的回答">
            <Button variant="ghost" size="icon" className={cn(HB, done && 'text-lamp-text')} aria-label="复制给 AI · 导入 AI 的回答" data-testid="ai-chat-more">
              <Icon icon={done ? Tick02Icon : MoreHorizontalIcon} size={16} />
            </Button>
          </Tip>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-60" data-testid="ai-chat-more-menu">
          <DropdownMenuLabel className="text-[11px] font-normal text-ink-3">发给 AI · 规则 + 当前文档</DropdownMenuLabel>
          <DropdownMenuItem onSelect={async () => setDone(await copyAiPrompt(doc()))} data-testid="ai-menu-copy">
            <Icon icon={Copy01Icon} size={14} />
            复制
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => saveAiPrompt(doc())} data-testid="ai-menu-download">
            <Icon icon={Download04Icon} size={14} />
            另存为…
            <span className="ml-auto pl-4 text-[11px] text-ink-3">.json</span>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuLabel className="text-[11px] font-normal text-ink-3">AI 的回答</DropdownMenuLabel>
          <DropdownMenuItem onSelect={() => void pasteAiReply()} data-testid="ai-menu-paste">
            <Icon icon={ClipboardPasteIcon} size={14} />
            粘贴
            <span className="ml-auto pl-4 text-[11px] text-ink-3">Ctrl+V</span>
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => file.current?.click()} data-testid="ai-menu-upload">
            <Icon icon={FileImportIcon} size={14} />
            从文件导入…
            <span className="ml-auto pl-4 text-[11px] text-ink-3">.json</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <input
        ref={file}
        type="file"
        accept=".json,application/json"
        className="hidden"
        onChange={(e) => {
          importAiPicked(e.target.files?.[0])
          e.target.value = ''
        }}
        data-testid="ai-menu-file"
      />
    </>
  )
}

function ChatBody({ docId }: { docId: string }) {
  const hasService = useAi((s) => s.services.length > 0)
  const conv = useChat((s) => currentConv(s, docId))
  return (
    <>
      {hasService || conv?.msgs.length ? <ChatList docId={docId} conv={conv} /> : <NoService />}
      <Composer />
    </>
  )
}

function NoService() {
  const doc = () => getDocStore(useTabs.getState().activeId).getState().doc
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-4 text-center" data-testid="ai-chat-no-service">
      <Button size="lg" className="px-3 font-semibold" onClick={() => openSettings('ai')} data-testid="ai-chat-add-service">
        添加 AI 服务
      </Button>
      <div className="flex gap-1">
        <Button variant="ghost" size="sm" className="text-ink-2" onClick={() => void copyAiPrompt(doc())} data-testid="ai-chat-copy">
          <Icon icon={Copy01Icon} size={14} />
          复制给 AI
        </Button>
        <Button variant="ghost" size="sm" className="text-ink-2" onClick={() => void pasteAiReply()} data-testid="ai-chat-paste">
          <Icon icon={ClipboardPasteIcon} size={14} />
          粘贴 AI 的回答
        </Button>
      </div>
    </div>
  )
}

function Composer() {
  const draft = useChat((s) => s.draft)
  const sending = useChat((s) => !!s.sending)
  const focusTick = useChat((s) => s.focusTick)
  const edit = usePrefs((s) => s.chatEdit)
  const sendKey = usePrefs((s) => s.chatSendKey)
  const hasService = useAi((s) => !!currentService(s))
  const ta = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    if (focusTick) ta.current?.focus()
  }, [focusTick])
  useEffect(() => grow(ta.current), [draft])
  const send = () => {
    if (!hasService || sending) return
    sendChat(draft)
  }
  const canSend = hasService && !!draft.trim()
  return (
    <div className="chat-compwrap">
      <div className="chat-comp" data-edit={hasService && edit ? '' : undefined} data-disabled={!hasService ? '' : undefined} data-testid="ai-chat-composer">
        <textarea
          ref={ta}
          rows={1}
          className="chat-ta"
          value={draft}
          disabled={!hasService}
          placeholder={!hasService ? '请先添加 AI 服务' : edit ? '如：背景改成太空，表情更害羞' : '如：这几个 tag 有没有冲突'}
          onChange={(e) => useChat.setState({ draft: e.target.value })}
          onKeyDown={(e) => {
            if (isSendKey(e, sendKey)) {
              e.preventDefault()
              send()
            }
          }}
          aria-label="要求"
          data-testid="ai-chat-input"
        />
        <div className="chat-cbar">
          <ToggleGroup
            type="single"
            value={edit ? 'edit' : 'chat'}
            onValueChange={(v) => v && (usePrefs.getState().set({ chatEdit: v === 'edit' }), ta.current?.focus())}
            className="chat-seg"
            aria-label="回复方式"
            data-testid="ai-chat-mode"
          >
            <Tip label="AI 只回答，不修改文档">
              <ToggleGroupItem value="chat" className="chat-seg-item" data-testid="ai-chat-mode-chat">
                问答
              </ToggleGroupItem>
            </Tip>
            <Tip label="AI 给出修改，可预览、应用">
              <ToggleGroupItem value="edit" className="chat-seg-item" data-k="edit" data-testid="ai-chat-mode-edit">
                修改文档
              </ToggleGroupItem>
            </Tip>
          </ToggleGroup>
          <RulesMenu />
          <ActionsMenu />
          <Tip label={!hasService ? '未设置 AI 服务' : undefined}>
            <span className="ml-auto inline-flex">
              <button
                type="button"
                className="chat-send"
                data-stop={sending ? '' : undefined}
                disabled={!sending && !canSend}
                onClick={() => (sending ? stopChat() : send())}
                aria-label={sending ? '停止' : '发送'}
                data-testid="ai-chat-send"
              >
                <Icon icon={sending ? StopIcon : ArrowUp02Icon} size={sending ? 14 : 16} />
              </button>
            </span>
          </Tip>
        </div>
      </div>
    </div>
  )
}

function RulesMenu() {
  const rules = useAi((s) => s.rules)
  useChat((s) => s.picked)
  const picked = pickedRules()
  const n = rules.filter((r) => picked.has(r.id)).length
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" className="chat-rules" data-testid="ai-chat-rules">
          <Icon icon={TextAlignLeftIcon} size={14} />
          规则 {n}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" className="w-60" data-testid="ai-chat-rules-menu">
        <DropdownMenuLabel className="text-[11px] font-normal text-ink-3">发送时添加的规则</DropdownMenuLabel>
        {rules.map((r) => (
          <DropdownMenuCheckboxItem key={r.id} checked={picked.has(r.id)} onSelect={(e) => e.preventDefault()} onCheckedChange={() => toggleRule(r.id)} data-testid="ai-chat-rule">
            <span className="truncate">{r.name.trim() || '未命名'}</span>
          </DropdownMenuCheckboxItem>
        ))}
        {!rules.length && <DropdownMenuItem disabled>暂无规则</DropdownMenuItem>}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => openSettings('ai', 'rules')} data-testid="ai-chat-rules-manage">
          {rules.length ? '管理规则' : '添加规则'}
          <span className="ml-auto pl-4 text-[11px] text-ink-3">设置 → AI</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
