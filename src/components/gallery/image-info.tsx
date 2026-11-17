import { useMemo, type ClipboardEvent, type ReactNode } from 'react'
import { SubSection } from '@/components/assistant/panel'
import { CopyButton } from '@/components/copy-button'
import { Tip } from '@/components/tip'
import { tokenFacet, toggleFacet } from '@/lib/gallery'
import { exportDoc, type OutToken } from '@/lib/nai'
import { SAMPLER_NAMES } from '@/lib/nai-image'
import { modelName } from '@/lib/nai-models'
import { effectiveSettings } from '@/lib/nai-write'
import { formatTime } from '@/lib/format-time'
import { cn } from '@/lib/utils'
import { factsFor, useGalleryUi } from '@/store/gallery'
import type { GenImage } from '@/store/gen'

const formatSize = (b: number) => (b >= 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(2)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`)
const FORMAT: Record<string, string> = { 'image/webp': 'WebP', 'image/png': 'PNG', 'image/jpeg': 'JPEG' }

export function InfoSection({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <SubSection id={id} title={title}>
      {children}
    </SubSection>
  )
}

export function ImagePrompts({ img, filterable }: { img: GenImage; filterable?: boolean }) {
  const boxes = useMemo(() => exportDoc(img.doc).filter((b) => b.text), [img])
  if (!boxes.length) return null
  return (
    <InfoSection id="img-sec-prompt" title="Prompt">
      <div className="overflow-hidden rounded-(--section-radius) border border-line bg-work" data-testid="gallery-prompts">
        {boxes.map((b, i) => (
          <div key={b.key} className={cn('px-3 py-2.5', i > 0 && 'border-t border-line')}>
            <div className="mb-1 flex min-h-6 items-center gap-2">
              <span className="truncate text-[13px] font-semibold" style={b.field === 'uc' ? { color: 'oklch(var(--section-tint-l) 0.12 var(--hue-uc))' } : { color: 'var(--ink-1)' }}>
                {b.label}
              </span>
              <CopyButton text={b.text} what={`「${b.label}」`} className="ml-auto" />
            </div>
            {filterable && b.field === 'prompt' ? <PromptChips img={img} tokens={b.tokens} /> : <div className="x-out">{b.text}</div>}
          </div>
        ))}
      </div>
    </InfoSection>
  )
}

interface ChipItem {
  tok: Extract<OutToken, { k: 'tag' }>
  weight: string
  before: string
  after: string
}

function chipItems(tokens: readonly OutToken[]): ChipItem[] {
  const out: ChipItem[] = []
  let before = ''
  let weight = ''
  for (const t of tokens) {
    if (t.k === 'sep') before += t.t
    else if (t.k === 'open') {
      before += t.t
      weight = t.t.replace(/::$/, '')
    } else if (t.k === 'close') {
      if (out.length) out[out.length - 1].after += t.t
      weight = ''
    } else {
      out.push({ tok: t, weight, before, after: '' })
      before = ''
    }
  }
  return out
}

function chipsText(items: readonly ChipItem[], a: number, b: number): string {
  let s = ''
  for (let i = a; i <= b; i++) {
    const it = items[i]
    const before = i === a ? it.before.replace(/^, /, '') : it.before
    s += (i === a && it.weight && !before.includes('::') ? `${it.weight}::` : '') + before + it.tok.t + it.after
    if (i === b && it.weight && !it.after) s += '::'
  }
  return s
}

const CHIP = 'inline-flex max-w-full items-start gap-1 rounded-md border px-1.5 py-0.5 text-[12px] leading-4 break-words transition-colors duration-(--dur)'

function PromptChips({ img, tokens }: { img: GenImage; tokens: OutToken[] }) {
  const filters = useGalleryUi((s) => s.filters)
  const items = useMemo(() => chipItems(tokens), [tokens])
  const facts = factsFor(img)
  const pick = (key: 'artist' | 'character' | 'tag', value: string, exclude: boolean) => {
    if (window.getSelection()?.toString()) return
    const ui = useGalleryUi.getState()
    ui.set({ viewing: null, inStack: null, filters: { ...ui.filters, [key]: toggleFacet(ui.filters[key], value, exclude) } })
  }
  // Browsers insert newlines between selected chips; reconstruct multi-chip copies from the exported prompt.
  const onCopy = (e: ClipboardEvent<HTMLDivElement>) => {
    const sel = window.getSelection()
    if (!sel || sel.isCollapsed) return
    const hit = [...e.currentTarget.querySelectorAll<HTMLElement>('[data-chip-i]')].filter((n) => sel.containsNode(n, true)).map((n) => Number(n.dataset.chipI))
    if (hit.length < 2) return
    e.preventDefault()
    e.clipboardData.setData('text/plain', chipsText(items, hit[0], hit[hit.length - 1]))
  }
  return (
    <div className="x-out flex flex-wrap gap-1" onCopy={onCopy} data-testid="gallery-prompt-chips">
      {items.map((it, i) => {
        const fac = tokenFacet(it.tok, facts)
        const on = !!fac && filters[fac.key].on.includes(fac.value)
        return (
          <span
            className={cn(
              CHIP,
              !fac
                ? 'border-line bg-work text-ink-2'
                : on
                  ? 'border-transparent bg-[color-mix(in_srgb,var(--accent)_22%,var(--work))] text-ink-1 hover:bg-[color-mix(in_srgb,var(--accent)_30%,var(--work))]'
                  : 'border-line bg-work text-ink-1 hover:bg-[color-mix(in_srgb,var(--ink-1)_12%,var(--work))]',
            )}
            onClick={fac ? () => pick(fac.key, fac.value, false) : undefined}
            onContextMenu={fac ? (e) => (e.preventDefault(), pick(fac.key, fac.value, true)) : undefined}
            key={i}
            data-chip-i={i}
            data-testid="gallery-prompt-chip"
            data-facet={fac?.key}
            data-value={fac?.value}
            data-active={on ? '' : undefined}
          >
            {it.weight && <span className="text-[11px] text-ink-2 tabular-nums select-none">{it.weight}</span>}
            {it.tok.t}
          </span>
        )
      })}
    </div>
  )
}

export function ImageParams({ img }: { img: GenImage }) {
  const s = effectiveSettings(img.doc.settings)
  const g = s.gen
  const chips: [string, string][] = [
    [modelName(s.model) + (s.model === 'v5-full' && s.effort === 'medium' ? ' · Medium' : ''), '模型'],
    [`${img.width} × ${img.height}`, '尺寸（宽 × 高）'],
    [`${g.steps} 步`, '步数（Steps）'],
    [`引导 ${g.scale}`, 'Prompt Guidance：越高越贴近 prompt'],
    ...(g.cfgRescale ? [[`Rescale ${g.cfgRescale}`, 'Prompt Guidance Rescale'] as [string, string]] : []),
    [SAMPLER_NAMES[g.sampler] ?? g.sampler, '采样器（Sampler）'],
    [`seed ${img.seed}`, 'Seed：参数相同时，同一个 Seed 生成同一张图'],
  ]
  return (
    <InfoSection id="img-sec-params" title="参数">
      <div className="flex flex-wrap gap-1.5" data-testid="gallery-params">
        {chips.map(([text, tip]) => (
          <Tip key={tip} label={tip}>
            <span className="inline-flex h-6 cursor-default items-center rounded-md border border-line bg-work px-2 text-[12px] text-ink-1 tabular-nums">{text}</span>
          </Tip>
        ))}
      </div>
    </InfoSection>
  )
}

export function ImageProps({ img, batch, imported }: { img: GenImage; batch: number; imported?: boolean }) {
  return (
    <InfoSection id="img-sec-props" title="属性">
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 text-[12px]" data-testid="gallery-props">
        {img.version != null && !imported && <Prop k="版本">v{img.version}</Prop>}
        <Prop k="大小">{formatSize(img.size)}</Prop>
        <Prop k="格式">{FORMAT[img.mime] ?? (img.mime || '—')}</Prop>
        <Prop k="尺寸">
          {img.width} × {img.height}
        </Prop>
        {batch > 1 && (
          <Prop k="第几张">
            {img.index + 1} / {batch}
          </Prop>
        )}
        <Prop k={imported ? '导入时间' : '生成时间'}>{formatTime(img.createdAt)}</Prop>
      </dl>
    </InfoSection>
  )
}

function Prop({ k, children }: { k: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-ink-2">{k}</dt>
      <dd className="text-ink-1 tabular-nums">{children}</dd>
    </>
  )
}
