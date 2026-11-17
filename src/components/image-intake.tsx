import type { ReactNode } from 'react'
import { Album02Icon, FileImportIcon, MagicWand01Icon } from '@hugeicons/core-free-icons'
import type { IconSvgElement } from '@hugeicons/react'
import { Icon } from '@/components/icon'
import { Tip } from '@/components/tip'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { modelName, refModelFor } from '@/lib/nai-models'
import { IMPORT_ISSUE } from '@/store/import'
import { closeIntake, intakeDirectorTools, intakeGallery, intakeImportPrompt, intakeRef, useIntake } from '@/store/intake'
import { useConnected } from '@/store/nai'
import { getDocStore, useTabs } from '@/store/tabs'
import { REF_KINDS, REF_META, switchHint } from './gen/ref-meta'

export function ImageIntake() {
  const { pending, open } = useIntake()
  const connected = useConnected()
  const issue = pending && pending.source !== 'nai' ? IMPORT_ISSUE[pending.source] : null
  const model = useTabs((t) => (t.starts.includes(t.activeId) ? null : getDocStore(t.activeId).getState().doc.settings.model)) ?? 'v5-full'
  return (
    <Dialog open={open && !!pending} onOpenChange={(o) => !o && closeIntake()}>
      {pending && (
        <DialogContent className="flex w-[440px] max-w-[calc(100%-2rem)] gap-4 p-4 sm:max-w-[440px]" data-testid="image-intake">
          <img src={pending.url} alt="" className="h-[150px] w-[104px] shrink-0 rounded-md border border-line object-contain" style={{ background: 'var(--surface-2)' }} draggable={false} />
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <DialogTitle className="text-[14px] font-semibold text-ink-1">用这张图做什么</DialogTitle>
            <DialogDescription className="sr-only">选择这张图片的用途</DialogDescription>
            <div className="flex flex-col gap-1">
              <Option icon={FileImportIcon} title="导入 prompt" desc={issue?.title ?? '读取图片中的 prompt 和参数'} disabledHint={issue?.description} onClick={intakeImportPrompt} testId="intake-import" />
              {connected &&
                REF_KINDS.map((k) => {
                  const hint = k === 'base' ? null : switchHint(modelName(model), modelName(refModelFor(model, k)))
                  return <Option key={k} icon={REF_META[k].icon} title={REF_META[k].add} desc={hint ? `${REF_META[k].desc}，${hint}` : REF_META[k].desc} onClick={() => void intakeRef(k)} testId={`intake-ref-${k}`} />
                })}
              {connected && <Option icon={MagicWand01Icon} title="用 Director Tools 处理…" desc="图片将加入当前文档的历史" onClick={() => void intakeDirectorTools()} testId="intake-tools" />}
              <Option icon={Album02Icon} title="只加入图库" desc="不改动当前文档" onClick={intakeGallery} testId="intake-gallery" />
            </div>
          </div>
        </DialogContent>
      )}
    </Dialog>
  )
}

function Option({ icon, title, desc, disabledHint, onClick, testId }: { icon: IconSvgElement; title: ReactNode; desc: string; disabledHint?: string; onClick: () => void; testId: string }) {
  const button = (
    <button
      type="button"
      className="flex w-full items-start gap-2.5 rounded-md px-2.5 py-2 text-left outline-none transition-colors duration-150 enabled:hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-(--accent-text) disabled:pointer-events-none disabled:opacity-60"
      disabled={!!disabledHint}
      aria-description={disabledHint}
      onClick={onClick}
      data-testid={testId}
    >
      <Icon icon={icon} size={16} className="mt-px shrink-0 text-ink-2" />
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="text-[13px] font-semibold text-ink-1">{title}</span>
        <span className="text-[12px] text-ink-2">{desc}</span>
      </span>
    </button>
  )
  if (!disabledHint) return button
  return (
    <Tip label={disabledHint}>
      <span className="block cursor-default">{button}</span>
    </Tip>
  )
}
