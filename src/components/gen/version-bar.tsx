import { useEffect, useMemo, useState, type ReactNode, type Ref } from 'react'
import { useStore } from 'zustand'
import { Delete02Icon, Copy01Icon, Download04Icon, GitForkIcon, SproutIcon, Tick02Icon } from '@hugeicons/core-free-icons'
import { Icon } from '@/components/icon'
import { Tip } from '@/components/tip'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { versionChanges, type ChangeGroup } from '@/lib/versions'
import { cn } from '@/lib/utils'
import { useFollowing, useGen, useSelectedImage, useSelectedVersion, useShownHistory, type GenImage } from '@/store/gen'
import { getDocStore } from '@/store/tabs'
import { isCurrentVersion, loadVersions, revertToVersion, useVersions, type DocVersion } from '@/store/versions'
import { byOldest, IMPORT_LABEL } from './history-nav'
import { copyImage, downloadImage, SAVE_LABEL } from './image-io'
import { badgeOf } from './action-meta'
import { ImageTools } from './image-tools'
import { AiMark } from './version-tag'

export function VersionBar({ tabId, docId, barRef, stuck }: { tabId: string; docId: string; barRef?: Ref<HTMLDivElement>; stuck: boolean }) {
  const img = useSelectedImage(docId)
  const v = useSelectedVersion(docId)
  const following = useFollowing(docId)
  const show = !following && (!!v || !!img)
  return (
    <div
      ref={barRef}
      className={cn(
        'sticky top-0 z-10 grid bg-shell transition-[grid-template-rows,opacity,box-shadow] duration-200 ease-(--ease-out) motion-reduce:transition-none',
        show ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0',
        show && stuck && 'shadow-[0_1px_0_var(--line)]',
      )}
      aria-hidden={!show}
      inert={!show}
    >
      <div className="@container min-h-0 overflow-hidden">{(v || img) && <Bar tabId={tabId} docId={docId} v={v} img={!v || img?.versionId === v.id ? img : null} />}</div>
    </div>
  )
}

function Bar({ tabId, docId, v, img }: { tabId: string; docId: string; v: DocVersion | null; img: GenImage | null }) {
  const list = useShownHistory(docId)
  const mine = useMemo(() => (v ? (list?.filter((x) => x.versionId === v.id && (!x.label || x.label === 'inpaint')).sort(byOldest) ?? []) : []), [list, v])
  const at = img ? mine.findIndex((x) => x.id === img.id) : -1
  const store = getDocStore(tabId)
  const doc = useStore(store, (s) => s.doc)
  const same = useMemo(() => !v || isCurrentVersion(doc, v), [doc, v])
  const badge = img && img.label !== 'inpaint' ? badgeOf(img) : null
  return (
    <div className="flex flex-col border-t border-line px-3 pt-1.5 pb-2 @max-[380px]:px-2" data-testid="version-bar" data-version={v?.n}>
      <div className="flex h-8 min-w-0 items-center gap-2 text-[12px] text-ink-2 tabular-nums @max-[380px]:gap-1.5">
        <span className="flex min-w-0 items-center gap-2 @max-[380px]:gap-1.5">
          {v && <VersionNumber docId={docId} v={v} changes={!badge} />}
          {mine.length > 1 && at >= 0 && (
            <span className="shrink-0" data-testid="version-bar-index">
              {at + 1} / {mine.length}
            </span>
          )}
          {img && badge && <ResultInfo docId={docId} img={img} badge={badge} />}
          {img && !badge && (
            <>
              <span className="shrink-0">·</span>
              <SeedCopy seed={img.seed} />
              <Action label="使用此 Seed" onClick={() => store.getState().updateGen({ seed: img.seed })} testId="gen-use-seed">
                <Icon icon={SproutIcon} size={16} />
              </Action>
            </>
          )}
        </span>
        <span className="ml-auto flex shrink-0 items-center gap-0.5" data-testid="version-bar-actions">
          {v && !same && !badge && (
            <Button variant="outline" size="sm" className="mr-0.5 h-7 animate-in px-2.5 text-[12px] duration-150 fade-in-0" onClick={() => revertToVersion(store, v)} data-testid="version-revert">
              {IMPORT_LABEL}
            </Button>
          )}
          {img && <ImageActions img={img} onTrash={list?.some((x) => x.id === img.id) ? () => useGen.getState().remove(docId, img.id) : undefined} />}
        </span>
      </div>
      <div className="empty:hidden" data-testid="version-bar-tools">
        {img && <ImageTools key={img.id} tabId={tabId} docId={docId} img={img} />}
      </div>
    </div>
  )
}

function ResultInfo({ docId, img, badge }: { docId: string; img: GenImage; badge: NonNullable<ReturnType<typeof badgeOf>> }) {
  const list = useShownHistory(docId)
  const src = img.sourceId ? list?.find((x) => x.id === img.sourceId) : undefined
  return (
    <>
      <span className="flex shrink-0 items-center gap-1 rounded-[5px] bg-line px-1.5 py-[3px] text-ink-1" data-testid="version-bar-label">
        <Icon icon={badge.icon} size={14} className="text-ink-2" />
        {badge.name}
      </span>
      <span className="truncate" data-testid="version-bar-size">
        {img.width} × {img.height}
      </span>
      {src && (
        <>
          <span className="shrink-0">·</span>
          <Tip label="跳至原图">
            <button
              type="button"
              className="shrink-0 rounded-sm text-ink-1 underline decoration-ink-3 underline-offset-[3px] outline-none transition-colors duration-150 hover:decoration-ink-2 focus-visible:ring-2 focus-visible:ring-(--accent-text)"
              onClick={() => useGen.getState().select(docId, src.id)}
              data-testid="version-bar-source"
            >
              原图
            </button>
          </Tip>
        </>
      )}
    </>
  )
}

function SeedCopy({ seed }: { seed: number }) {
  const [done, setDone] = useState(false)
  useEffect(() => {
    if (!done) return
    const t = setTimeout(() => setDone(false), 1200)
    return () => clearTimeout(t)
  }, [done])
  return (
    <Tip label="复制 Seed">
      <button
        type="button"
        className="flex min-w-0 items-center gap-1 rounded-sm font-mono text-ink-1 underline decoration-ink-3 decoration-dashed underline-offset-[3px] outline-none transition-colors duration-150 hover:decoration-ink-2 focus-visible:ring-2 focus-visible:ring-(--accent-text) data-[done]:text-lamp-text"
        onClick={() => void navigator.clipboard.writeText(String(seed)).then(() => setDone(true), () => {})}
        data-testid="version-bar-seed"
        data-done={done ? '' : undefined}
      >
        <span className="truncate">{seed}</span>
        {done && <Icon icon={Tick02Icon} size={14} className="shrink-0 animate-in duration-150 fade-in-0" />}
      </button>
    </Tip>
  )
}

function ImageActions({ img, onTrash }: { img: GenImage; onTrash?: () => void }) {
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const t = setTimeout(() => setCopied(false), 1200)
    return () => clearTimeout(t)
  }, [copied])
  return (
    <>
      <Action label="复制图片" onClick={() => void copyImage(img).then((ok) => ok && setCopied(true))} disabled={img.missing} testId="gen-copy">
        <Icon icon={copied ? Tick02Icon : Copy01Icon} size={16} className={copied ? 'text-lamp-text' : undefined} />
      </Action>
      <Action label={SAVE_LABEL} onClick={() => void downloadImage(img)} disabled={img.missing} testId="gen-download">
        <Icon icon={Download04Icon} size={16} />
      </Action>
      {onTrash && (
        <Action label="移至回收站（Del）" onClick={onTrash} testId="gen-trash">
          <Icon icon={Delete02Icon} size={16} />
        </Action>
      )}
    </>
  )
}

function Action({ label, onClick, disabled, testId, children }: { label: string; onClick: () => void; disabled?: boolean; testId: string; children: ReactNode }) {
  return (
    <Tip label={label}>
      <Button variant="ghost" size="icon-sm" className="text-ink-2" onClick={onClick} disabled={disabled} aria-label={label} data-testid={testId}>
        {children}
      </Button>
    </Tip>
  )
}

function VersionNumber({ docId, v, changes }: { docId: string; v: DocVersion; changes: boolean }) {
  const versions = useVersions((s) => s.byDoc[docId])
  const fork = v.n === 1 ? v.snapshot.meta.forkedFrom : undefined
  const forkVersions = useVersions((s) => (fork?.version ? s.byDoc[fork.docId] : undefined))
  useEffect(() => {
    if (changes && fork?.version) void loadVersions(fork.docId)
  }, [changes, fork?.docId, fork?.version])
  const base = v.n > 1 ? versions?.find((x) => x.n === v.n - 1) : fork?.version ? forkVersions?.find((x) => x.n === fork.version) : undefined
  const groups = useMemo(() => (changes && base ? versionChanges(base.snapshot, v.snapshot) : []), [changes, base, v])
  const req = v.kind === 'ai' ? v.aiRequest?.trim() : undefined
  const against = v.n > 1 ? `与 v${v.n - 1} 相比` : fork?.version ? `与「${fork.title?.trim() || '未命名'}」v${fork.version} 相比` : ''
  const forked = v.kind !== 'ai' && !!fork?.version
  const label = (
    <span className="flex shrink-0 cursor-default items-center gap-1 text-[13px] font-semibold text-ink-1" data-testid="version-bar-n" data-changes={groups.length || undefined}>
      v{v.n}
      {v.kind === 'ai' && <AiMark size={14} />}
      {forked && <Icon icon={GitForkIcon} size={14} className="text-ink-2" />}
    </span>
  )
  if (!groups.length && !req) return label
  return (
    <Tooltip>
      <TooltipTrigger asChild>{label}</TooltipTrigger>
      <TooltipContent side="top" className="max-w-[360px]" data-testid="version-bar-changes-tip">
        <div className="flex flex-col gap-0.5 text-left">
          {req && <div>{req}</div>}
          {against && groups.length > 0 && <div className="opacity-70">{against}</div>}
          {groups.map((g, i) => (
            <div key={i} className="flex flex-wrap items-baseline gap-x-1.5">
              <Group g={g} />
            </div>
          ))}
        </div>
      </TooltipContent>
    </Tooltip>
  )
}

function Group({ g }: { g: ChangeGroup }): ReactNode {
  return (
    <>
      {g.scope && <span>{g.scope}：</span>}
      {g.parts.map((p, i) => (
        <span key={i} className={cn(i > 0 && 'ml-1.5', p.kind !== 'set' && 'font-mono', p.kind === 'del' && 'text-ink-2 line-through', (p.kind === 'add' || p.kind === 'weight') && 'text-ink-1')} data-kind={p.kind}>
          {p.kind === 'add' ? `+${p.text}` : p.text}
        </span>
      ))}
    </>
  )
}
