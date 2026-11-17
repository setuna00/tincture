import { useRef, useState, type Ref } from 'react'
import { Delete02Icon, FloppyDiskIcon } from '@hugeicons/core-free-icons'
import { PricePill } from '@/components/anlas'
import { useRunGuard } from '@/components/gen/run-guard'
import { Icon } from '@/components/icon'
import { Button } from '@/components/ui/button'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { useConfirm, type ConfirmAsk, type ConfirmChoice } from '@/store/confirm'

export function ConfirmHost() {
  const ask = useConfirm((s) => s.ask)
  const [last, setLast] = useState<ConfirmAsk | null>(null)
  if (ask && ask !== last) setLast(ask)
  const shown = ask ?? last
  const saveRef = useRef<HTMLButtonElement>(null)
  const choiceRef = useRef<ConfirmChoice>('cancel')
  const close = (choice: ConfirmChoice) => {
    if (!ask) return
    choiceRef.current = choice
    ask.resolve(choice)
    useConfirm.setState({ ask: null })
  }
  const save = shown?.kind === 'save'
  const spend = shown?.kind === 'spend'
  return (
    <AlertDialog open={!!ask} onOpenChange={(o) => !o && close('cancel')}>
      <AlertDialogContent
        className="gap-4 border border-line bg-work p-5 shadow-(--shadow-pop) ring-0 sm:max-w-[380px]"
        onOpenAutoFocus={(e) => {
          if (!save && !spend) return
          e.preventDefault()
          saveRef.current?.focus()
        }}
        onCloseAutoFocus={(e) => {
          if (choiceRef.current !== 'cancel' || !shown?.refocus?.isConnected) return
          e.preventDefault()
          shown.refocus.focus()
        }}
        data-testid="confirm-dialog"
      >
        <AlertDialogHeader className="gap-1.5">
          <AlertDialogTitle className="text-[13px] font-semibold text-ink-1">{shown?.title}</AlertDialogTitle>
          <AlertDialogDescription className="text-[13px] leading-relaxed text-ink-2">{shown?.body}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={() => close('cancel')} data-testid="confirm-cancel">
            取消
          </AlertDialogCancel>
          {spend ? (
            <SpendAction ref={saveRef} action={shown?.action ?? ''} price={shown?.price ?? 0} onRun={() => close('ok')} />
          ) : save ? (
            <>
              <Button variant="outline" onClick={() => close('discard')} data-testid="confirm-discard">
                不保存
              </Button>
              <AlertDialogAction ref={saveRef} className="font-semibold" onClick={() => close('ok')} data-testid="confirm-ok">
                <Icon icon={FloppyDiskIcon} size={14} />
                {shown?.action}
              </AlertDialogAction>
            </>
          ) : (
            <AlertDialogAction variant="destructive" className="font-semibold" onClick={() => close('ok')} data-testid="confirm-ok">
              <Icon icon={Delete02Icon} size={14} />
              {shown?.action}
            </AlertDialogAction>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

/** Guard the focused spend action so repeated Enter presses cannot bypass Anlas confirmation. */
function SpendAction({ ref, action, price, onRun }: { ref: Ref<HTMLButtonElement>; action: string; price: number; onRun: () => void }) {
  const guard = useRunGuard(onRun)
  return (
    <Button ref={ref} className="gap-1.5 font-semibold" {...guard} data-testid="confirm-ok">
      {action}
      <PricePill n={price} tone="on" />
    </Button>
  )
}
