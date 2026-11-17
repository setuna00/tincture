// NovelAI appends quality presets to the positive prompt and prepends UC presets to the negative prompt.
import { useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { toast } from 'sonner'
import { Alert02Icon, MoreHorizontalIcon, SquareLock02Icon } from '@hugeicons/core-free-icons'
import { Icon } from '@/components/icon'
import { Tip } from '@/components/tip'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { chipLiteral, formatWeightShort } from '@/lib/nai'
import { presetChips, presetDupChips, presetParts, presetView } from '@/lib/preset-block'
import { useActions, useDoc } from '@/store/context'
import { makeSection } from '@/store/doc'
import type { BoxField, QualityPreset, UcPreset } from '@/types'
import { QUALITY_LABEL, UC_LABEL } from './labels'

const NAME = { prompt: '质量预设', uc: 'UC 预设' } as const
const FOLD = 8
const LOCKED = 'Effort Medium 固定为 Heavy'

export function PresetBlock({ field }: { field: BoxField }) {
  const actions = useActions()
  const settings = useDoc((s) => s.doc.settings)
  const prompt = useDoc((s) => s.doc.base.prompt)
  const uc = useDoc((s) => s.doc.base.uc)
  const doc = useMemo(() => ({ settings, base: { prompt, uc } }), [settings, prompt, uc])
  const v = useMemo(() => presetView(doc, field), [doc, field])
  const parts = useMemo(() => presetParts(v), [v])
  const dups = useMemo(() => presetDupChips(doc, v), [doc, v])
  const [unfolded, setUnfolded] = useState(false)
  const [last, setLast] = useState<string | null>(null)
  const on = v.id !== 'none'
  const labels: Record<string, string> = field === 'prompt' ? QUALITY_LABEL : UC_LABEL
  const back = last && (v.options as string[]).includes(last) ? last : v.options[0]
  const set = (id: string) => {
    if (id !== 'none') setLast(id)
    actions.updateSettings(field === 'prompt' ? { qualityTags: id as QualityPreset } : { ucPreset: id as UcPreset })
  }
  const toggle = (next: boolean) => {
    if (!next) setLast(v.id)
    set(next ? back : 'none')
  }
  const dedupe = () => {
    actions.removeChips(dups.map((c) => c.id))
    toast.success(`已移除 ${dups.length} 个与 NAI 重复的 tag`, { description: `${dups.map((c) => c.text).join('、')} · Ctrl+Z 撤销` })
  }
  const toSection = () => actions.presetToSection(field, makeSection(`${NAME[field]} ${v.label}`, presetChips(v)))
  const folding = parts.length > FOLD + 1
  const shown = folding && !unfolded ? parts.slice(0, FOLD) : parts

  const inner = useRef<HTMLDivElement>(null)
  const [height, setHeight] = useState<number>()
  useLayoutEffect(() => {
    const el = inner.current
    if (!el) return
    const ro = new ResizeObserver(() => setHeight(el.offsetHeight))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  return (
    <div className="preset-block" data-testid="preset-block" data-field={field} data-off={on ? undefined : ''} onClick={(e) => e.stopPropagation()}>
      <div className="flex min-h-6 items-center gap-1.5">
        <Icon icon={SquareLock02Icon} size={15} className="preset-mark" />
        <span className="preset-name" data-testid="preset-name">
          {NAME[field]}
        </span>
        <Tip label={v.locked ? LOCKED : undefined}>
          <span className="inline-flex">
            <Select value={v.id} onValueChange={set} disabled={v.locked}>
              <SelectTrigger size="sm" className="preset-select" aria-label={NAME[field]} data-testid="preset-select">
                <SelectValue />
              </SelectTrigger>
              <SelectContent position="popper" align="start">
                {v.options.map((k) => (
                  <SelectItem key={k} value={k}>
                    {labels[k]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </span>
        </Tip>
        <span className="flex-1" />
        {dups.length > 0 && (
          <Tip label={`移除区块中与此预设重复的 tag：${dups.map((c) => c.text).join('、')}。带权重的 tag 不移除`}>
            <Button variant="ghost" size="xs" className="gap-1 text-warn hover:text-warn" onClick={dedupe} data-testid="preset-dedupe">
              <Icon icon={Alert02Icon} size={14} />
              去重 <span className="tabular-nums">{dups.length}</span>
            </Button>
          </Tip>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-xs" className="text-ink-2" aria-label="更多" disabled={v.locked} data-testid="preset-more">
              <Icon icon={MoreHorizontalIcon} size={16} />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44" onCloseAutoFocus={(e) => e.preventDefault()}>
            <Tip side="left" label={on ? '预设改为 None，在此位置添加内容相同的区块' : undefined}>
              <DropdownMenuItem disabled={!on} onSelect={toSection} data-testid="preset-to-section">
                转为区块
              </DropdownMenuItem>
            </Tip>
          </DropdownMenuContent>
        </DropdownMenu>
        <Tip
          label={
            v.locked
              ? LOCKED
              : on
                ? v.nsfw
                  ? '已启用 · 关闭后为 None，NAI 不再自动在负面添加 nsfw'
                  : '已启用 · 关闭后为 None'
                : `已关闭 · 点击启用 ${labels[back]}`
          }
        >
          <span className="section-switch ml-1 grid h-5 place-items-center" style={{ '--tint': 'var(--ink-2)' } as CSSProperties}>
            <Switch size="sm" checked={on} onCheckedChange={toggle} disabled={v.locked} aria-label={on ? `关闭${NAME[field]}` : `启用${NAME[field]}`} data-testid="preset-enabled" />
          </span>
        </Tip>
      </div>
      <div className="preset-words" style={{ height }}>
        <div ref={inner}>
          {parts.length > 0 && (
            <div className="preset-body">
              {shown.map((p, i) => {
                const chip = (
                  <span key={i} className="preset-chip" data-testid="preset-chip">
                    {p.weight !== 1 && <span className="preset-chip-w">{formatWeightShort(p.weight)}</span>}
                    {chipLiteral(p)}
                  </span>
                )
                return v.nsfw && i === 0 ? (
                  <Tip key={i} label="正面不含 nsfw 时 NAI 自动添加">
                    {chip}
                  </Tip>
                ) : (
                  chip
                )
              })}
              {folding && (
                <button type="button" className="preset-chip preset-fold" onClick={() => setUnfolded(!unfolded)} data-testid="preset-fold">
                  {unfolded ? '收起' : `+${parts.length - FOLD}`}
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
