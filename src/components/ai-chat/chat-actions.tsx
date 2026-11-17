import { Fragment, useMemo, useState } from 'react'
import { MagicWand01Icon } from '@hugeicons/core-free-icons'
import { Icon } from '@/components/icon'
import { Tip } from '@/components/tip'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuShortcut, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { CHAT_ACTIONS, chatCheck, unknownWords } from '@/lib/ai-chat'
import { currentService, useAi } from '@/store/ai'
import { sendAction, useChat } from '@/store/chat'
import { useDoc } from '@/store/context'
import { useLibrary } from '@/store/library'

const NONE = '暂无未识别的 tag'

function useUnknownCount(): number {
  const doc = useDoc((s) => s.doc)
  const variants = useLibrary((s) => s.variants)
  return useMemo(() => unknownWords(chatCheck(doc, variants)).length, [doc, variants])
}

function useBlocked() {
  const busy = useChat((s) => !!s.sending)
  const noService = useAi((s) => !currentService(s))
  return { busy, noService, off: busy || noService }
}

export function ActionsMenu() {
  const { noService, off } = useBlocked()
  const [open, setOpen] = useState(false)
  return (
    <DropdownMenu open={open && !off} onOpenChange={(o) => setOpen(o && !off)}>
      <DropdownMenuTrigger asChild>
        <Tip side="bottom" label={noService ? '未设置 AI 服务' : '常用要求'}>
          <button type="button" className="chat-rules chat-wand" aria-disabled={off || undefined} aria-label="常用要求" data-testid="ai-chat-actions-menu-btn">
            <Icon icon={MagicWand01Icon} size={15} />
          </button>
        </Tip>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" className="w-44" data-testid="ai-chat-actions-menu">
        <ActionItems onPick={() => setOpen(false)} />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function ActionItems({ onPick }: { onPick: () => void }) {
  const n = useUnknownCount()
  return (
    <>
      <DropdownMenuLabel className="text-[11px] font-normal text-ink-3">常用要求</DropdownMenuLabel>
      {CHAT_ACTIONS.map((a) => {
        const zero = a.id === 'spelling' && !n
        const item = (
          <DropdownMenuItem
            disabled={zero}
            onSelect={() => {
              onPick()
              void sendAction(a.id)
            }}
            data-testid="ai-chat-action-item"
            data-action={a.id}
          >
            {a.name}
            {a.id === 'spelling' ? <DropdownMenuShortcut className="tabular-nums">{n}</DropdownMenuShortcut> : !a.edit && <DropdownMenuShortcut>问答</DropdownMenuShortcut>}
          </DropdownMenuItem>
        )
        return zero ? (
          <Tip key={a.id} side="right" label={NONE}>
            <div>{item}</div>
          </Tip>
        ) : (
          <Fragment key={a.id}>{item}</Fragment>
        )
      })}
    </>
  )
}

export function EmptyActions() {
  const n = useUnknownCount()
  const { off } = useBlocked()
  return (
    <div className="mt-3 grid w-full max-w-[300px] grid-cols-3 gap-2" data-testid="ai-chat-actions">
      {CHAT_ACTIONS.map((a) => {
        const zero = a.id === 'spelling' && !n
        return (
          <Tip key={a.id} label={zero && !off ? NONE : undefined}>
            <span className="flex min-w-0">
              <Button variant="outline" size="lg" className="w-full min-w-0 font-normal" disabled={off || zero} onClick={() => void sendAction(a.id)} data-testid="ai-chat-action" data-action={a.id}>
                {a.name}
                {a.id === 'spelling' && <span className="text-ink-3 tabular-nums">{n}</span>}
              </Button>
            </span>
          </Tip>
        )
      })}
    </div>
  )
}
