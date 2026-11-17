import { useMemo } from 'react'
import { AddSquareIcon, Delete02Icon, PinIcon, PinOffIcon, ViewIcon, ViewOffSlashIcon } from '@hugeicons/core-free-icons'
import { useSelectedLock } from '@/components/editor/random-ops'
import { useDraftField } from '@/components/draft-field'
import { Icon } from '@/components/icon'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { ChipFace, chipAttrs } from '@/components/editor/chip-face'
import { useGroupOps } from '@/components/editor/group-ops'
import { sectionTint, sectionVars } from '@/components/editor/labels'
import { clampWeight, formatWeight, WEIGHT_STEP, WEIGHT_STEP_COARSE } from '@/lib/nai'
import { useActions, useDoc } from '@/store/context'
import { allSections } from '@/store/doc'
import { useUi } from '@/store/ui'
import type { Chip, Section } from '@/types'
import { InspectorHeader } from './inspector'
import { PRESETS, weightText } from './weight'

export function MultiInspector() {
  const ids = useUi((s) => s.selectedChipIds)
  const doc = useDoc((s) => s.doc)
  const picked = useMemo(() => {
    const want = new Set(ids)
    return allSections(doc).flatMap((section) => section.chips.filter((c) => want.has(c.id)).map((chip) => ({ chip, section })))
  }, [doc, ids])
  if (picked.length < 2) return null
  const pickedIds = picked.map((p) => p.chip.id)
  return (
    <section className="flex h-full min-h-0 flex-col bg-shell" data-testid="multi-inspector">
      <InspectorHeader label={`选中 ${picked.length} 个 tag`} onClose={() => useUi.getState().setSelection([])} testId="multi-close" />
      <ScrollArea className="min-h-0 flex-1">
        <div className="px-3 pt-1 pb-4">
          <Head picked={picked} />
          <div className="mt-5">
            <GroupWeight chips={picked.map((p) => p.chip)} />
          </div>
          <div className="my-4 border-t border-line" />
          <ExtractButton ids={pickedIds} />
        </div>
      </ScrollArea>
      <Footer chips={picked.map((p) => p.chip)} />
    </section>
  )
}

function Head({ picked }: { picked: { chip: Chip; section: Section }[] }) {
  const sections = [...new Map(picked.map((p) => [p.section.id, p.section])).values()]
  return (
    <div className="mt-2 flex flex-col gap-2.5">
      <div className="flex flex-wrap gap-1" data-testid="multi-chips">
        {picked.map(({ chip, section }) => (
          <span key={chip.id} className="chip tpl-chip" style={sectionVars(section.color)} {...chipAttrs(chip)} data-chip-id={undefined} data-testid="multi-chip">
            <ChipFace chip={chip} />
          </span>
        ))}
      </div>
      <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[12px] text-ink-2" data-testid="multi-meta">
        <span>
          <span className="tabular-nums">{picked.length}</span> 个 tag · 来自
        </span>
        {sections.map((s, i) => (
          <span key={s.id} className="flex items-center gap-1">
            <span className="size-2 rounded-full" style={{ background: sectionTint(s.color) }} />
            {s.name + (i < sections.length - 1 ? '、' : '')}
          </span>
        ))}
      </p>
    </div>
  )
}

/** NovelAI does not apply tag weights to Text:, so exclude it from group weight edits. */
function GroupWeight({ chips }: { chips: Chip[] }) {
  const actions = useActions()
  const weighted = chips.filter((c) => c.type !== 'textrender')
  const skipped = chips.length - weighted.length
  const ids = weighted.map((c) => c.id)
  const ws = weighted.map((c) => c.weight)
  const lo = Math.min(...ws)
  const hi = Math.max(...ws)
  const common = lo === hi ? lo : null
  const setAll = (w: number) => {
    field.reset()
    actions.setWeight(ids, clampWeight(w))
  }
  const field = useDraftField({
    value: common !== null ? weightText(common) : '',
    onCommit: (t) => {
      const v = Number(t.replace('−', '-'))
      if (t && Number.isFinite(v)) setAll(v)
    },
  })
  if (!weighted.length) return <p className="text-[12px] text-ink-2">所选均为 Text: 文字渲染，无权重</p>
  const step = (d: number) => {
    field.reset()
    actions.adjustWeight(ids, d)
  }
  return (
    <div className="flex flex-col" data-testid="multi-weight">
      <div className="flex items-center">
        <span className="text-[12px] font-medium text-ink-2">权重</span>
        {common === null && (
          <span className="ml-2 text-[11px] text-ink-2 tabular-nums" data-testid="multi-weight-range">
            {formatWeight(lo)} – {formatWeight(hi)}
          </span>
        )}
        <div className="ml-auto flex items-center gap-1">
          <Button variant="outline" size="icon" className="text-[13px] text-ink-2" onClick={() => step(-WEIGHT_STEP)} aria-label="各自降低权重" data-testid="multi-weight-down">
            −
          </Button>
          <input
            className="h-7 w-[60px] rounded-md border border-line bg-surface-2/60 text-center font-mono text-[13px] text-ink-1 tabular-nums outline-none placeholder:font-sans placeholder:text-[12px] placeholder:text-ink-3 focus:border-lamp-text"
            placeholder="混合"
            inputMode="decimal"
            {...field.props}
            onKeyDown={(e) => {
              if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
                e.preventDefault()
                step((e.key === 'ArrowUp' ? 1 : -1) * (e.shiftKey ? WEIGHT_STEP_COARSE : WEIGHT_STEP))
              } else field.props.onKeyDown(e)
            }}
            aria-label="全部设成"
            data-testid="multi-weight-input"
          />
          <Button variant="outline" size="icon" className="text-[13px] text-ink-2" onClick={() => step(WEIGHT_STEP)} aria-label="各自提高权重" data-testid="multi-weight-up">
            +
          </Button>
        </div>
      </div>
      <p className="mt-1.5 flex flex-col text-[11px] leading-relaxed text-ink-2">
        <span>− / + 各自加减，保留差值</span>
        <span>输入或点击下方数值：全部设为同一值</span>
        {skipped > 0 && <span>{skipped} 个 Text: 无权重，不参与调整</span>}
      </p>
      <div className="mt-3 grid grid-cols-6 gap-1" role="group" aria-label="全部设成">
        {PRESETS.map((p) => (
          <button
            key={p}
            type="button"
            className="h-7 rounded-md border border-line font-mono text-[12px] text-ink-2 tabular-nums transition-colors hover:border-line-strong hover:bg-surface-2 hover:text-ink-1 data-[on]:border-lamp-text data-[on]:bg-lamp-text/12 data-[on]:text-lamp-text"
            data-on={common === p ? '' : undefined}
            aria-pressed={common === p}
            aria-label={String(p)}
            onClick={() => setAll(p)}
            data-testid="multi-weight-preset"
          >
            {p < 0 ? `−${-p}` : p}
          </button>
        ))}
      </div>
    </div>
  )
}

function ExtractButton({ ids }: { ids: string[] }) {
  const ops = useGroupOps()
  return (
    <Button variant="outline" className="w-full" onClick={() => ops.extract(ids)} data-testid="multi-extract">
      <Icon icon={AddSquareIcon} size={14} />
      提取为新区块
    </Button>
  )
}

function Footer({ chips }: { chips: Chip[] }) {
  const actions = useActions()
  const ops = useGroupOps()
  const ids = chips.map((c) => c.id)
  const allOff = chips.every((c) => c.disabled)
  const lock = useSelectedLock(ids)
  return (
    <footer className="@container flex shrink-0 items-center gap-1.5 border-t border-line px-3 py-2.5">
      <Button variant="outline" onClick={() => actions.toggleDisabled(ids)} data-testid="multi-toggle-disabled">
        <Icon icon={allOff ? ViewIcon : ViewOffSlashIcon} size={14} />
        {allOff ? '启用' : '禁用'}
      </Button>
      {lock.visible && (
        <Button variant="outline" onClick={lock.toggle} data-testid="multi-lock">
          <Icon icon={lock.locked ? PinOffIcon : PinIcon} size={14} />
          <span>
            {lock.locked ? '解锁' : '锁定'}
            <span className="@max-[15.75rem]:hidden">（L）</span>
          </span>
        </Button>
      )}
      <Button variant="destructive" className="ml-auto" onClick={() => ops.remove(ids)} data-testid="multi-delete">
        <Icon icon={Delete02Icon} size={14} />
        删除 {chips.length} 个
      </Button>
    </footer>
  )
}
