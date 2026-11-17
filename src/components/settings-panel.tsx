// Effort Medium locks effective parameters; update saved values separately so switching back to High restores them.
import { characterLabel } from '@/lib/character-label'
import { createContext, useContext, useEffect, useRef, useState, type CSSProperties, type HTMLAttributes, type KeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { ArrowLeftRightIcon, Maximize01Icon, RectangleHorizontalIcon, RectangleVerticalIcon, SquareIcon, UndoIcon } from '@hugeicons/core-free-icons'
import { QUALITY_LABEL, UC_LABEL } from '@/components/editor/labels'
import { useDraftField } from '@/components/draft-field'
import { Icon } from '@/components/icon'
import { Seg } from '@/components/seg'
import { Button } from '@/components/ui/button'
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '@/components/ui/select'
import { SliderSteps } from '@/components/slider-steps'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Tip } from '@/components/tip'
import { fillDocDefaults } from '@/lib/doc-defaults'
import { GEN_LIMITS, V5_SIZES, characterPrompt, fitSize, sizeShape } from '@/lib/nai'
import { maxSamplesForSize } from '@/lib/nai-api'
import { SAMPLER_NAMES } from '@/lib/nai-image'
import { MODELS, SAMPLERS, canPosition, defaultGen, defaultNoise, effectiveNoise, modelInfo, noiseOptions, qualityOptions, snapCenter, switchModel, ucOptions } from '@/lib/nai-models'
import { MEDIUM_FIXED, effectiveSettings } from '@/lib/nai-write'
import { useActions, useDoc } from '@/store/context'
import { useDocId, useSelectedImage } from '@/store/gen'
import { useConnected } from '@/store/nai'
import { usePrefs } from '@/store/prefs'
import { useTabs } from '@/store/tabs'
import type { Character, Doc, DocSettings, GenParams, ModelId, NoiseSchedule, QualityPreset, UcPreset } from '@/types'

interface SettingsTarget {
  s: DocSettings
  update(patch: Partial<DocSettings>): void
  updateGen(patch: Partial<GenParams>, coalesce?: string): void
}
const TargetCtx = createContext<SettingsTarget | null>(null)
const useTarget = () => useContext(TargetCtx)!

export function SettingsPanel() {
  const s = useDoc(settingsOf)
  const actions = useActions()
  return (
    <TargetCtx.Provider value={{ s, update: actions.updateSettings, updateGen: actions.updateGen }}>
      <div className="@container" data-testid="settings-page">
        <div className="grid grid-cols-1 gap-2 p-2 @min-[600px]:grid-cols-2">
          <div className="flex min-w-0 flex-col gap-2">
            <ModelCard />
            <PresetCard />
          </div>
          <ImageCard gen />
          <div className="min-w-0 @min-[600px]:col-span-2">
            <PositionCard />
          </div>
        </div>
      </div>
    </TargetCtx.Provider>
  )
}

/** Read the latest defaults for each update so rapid slider changes cannot overwrite other pending field edits. */
const setDefaults = (f: (s: DocSettings) => DocSettings) => usePrefs.getState().set({ docDefaults: f(fillDocDefaults(usePrefs.getState().docDefaults)) })
const DEFAULTS_TARGET = {
  update: (patch: Partial<DocSettings>) => setDefaults((s) => ({ ...(patch.model ? switchModel(s, patch.model) : s), ...patch })),
  updateGen: (patch: Partial<GenParams>) =>
    setDefaults((s) => {
      const gen = { ...s.gen, ...patch }
      if (patch.sampler !== undefined && patch.sampler !== s.gen.sampler && !('noiseSchedule' in patch)) delete gen.noiseSchedule
      return { ...s, gen }
    }),
}

export function DefaultSettingsCards() {
  const saved = usePrefs((p) => p.docDefaults)
  const s = fillDocDefaults(saved)
  return (
    <TargetCtx.Provider value={{ s, ...DEFAULTS_TARGET }}>
      <AsSection.Provider value>
        <div className="grid grid-cols-2 items-start gap-x-5 gap-y-7 max-md:grid-cols-1" data-testid="doc-defaults-cards">
          <div className="flex min-w-0 flex-col gap-7">
            <ModelCard />
            <PresetCard />
          </div>
          <ImageCard seed={false} />
        </div>
      </AsSection.Provider>
    </TargetCtx.Provider>
  )
}

const AsSection = createContext(false)

function Card({ title, sub, action, children, testId }: { title: string; sub?: string; action?: ReactNode; children: ReactNode; testId: string }) {
  if (useContext(AsSection))
    return (
      <section className="flex min-w-0 flex-col gap-2" data-testid={testId}>
        <header className="flex min-h-5 items-baseline gap-2 px-1">
          <h2 className="shrink-0 text-[13px] font-semibold text-ink-1">{title}</h2>
          {sub && <span className="min-w-0 truncate text-[12px] text-ink-2">{sub}</span>}
          {action && <span className="-my-1 ml-auto self-center">{action}</span>}
        </header>
        <div className="rounded-lg border border-line-strong px-4 py-2">{children}</div>
      </section>
    )
  return (
    <section className="rounded-(--section-radius) border border-line bg-work px-2.5 pt-2 pb-2.5" data-testid={testId}>
      <header className="mb-1 flex items-baseline gap-2">
        <span className="text-[13px] font-semibold text-ink-1">{title}</span>
        {sub && <span className="truncate text-[11px] text-ink-2">{sub}</span>}
        {action && <span className="-my-1 ml-auto self-center">{action}</span>}
      </header>
      {children}
    </section>
  )
}

const HINTS: Record<string, string> = {
  模型: '生成所用的模型；各模型的参数分别保存',
  Effort: 'Medium 花费的 Anlas 和 Opus 额度更少，部分参数不可调',
  模式: 'Anime：动漫风格；Furry：兽人及其他非人类角色',
  质量: '生成时在正面 prompt 末尾添加一组质量 tag',
  'UC 预设': '生成时在负面 prompt 开头添加一组预设内容',
  透明背景: '生成时在正面 prompt 中添加 transparent background',
  NSFW: '在正面 prompt 最前面添加 nsfw，复制时包含',
  尺寸: '宽 × 高，按 64 取整；Opus 订阅下超过 1024 × 1024 像素需花费 Anlas',
  张数: '一次生成的张数；Opus 订阅下多于 1 张需花费 Anlas',
  步数: '去噪的步数，步数越多细节越多、耗时越长；Opus 订阅下超过 28 步需花费 Anlas',
  引导: '图像贴合 prompt 的程度，值越高越贴合',
  'Variety+': '形体成形后才启用引导，提高多样性和饱和度，可能降低与 prompt 的相关性',
  Rescale: '减轻引导过高造成的过饱和',
  采样: '去噪所用的算法，画风和所需步数各不相同',
  噪声调度: '各步去噪力度的分配方式',
  'Legacy UC': '旧版的负面 prompt 处理方式，NAI 标注为不推荐',
  Seed: '参数相同时，同一个 Seed 生成同一张图；留空为随机',
  位置: "AI's Choice：由 AI 决定角色位置；Custom：手动指定每个角色的位置",
}

function Row({ label, children, testId }: { label: string; children: ReactNode; testId?: string }) {
  return (
    <div className="flex min-h-[30px] min-w-0 items-center gap-2 text-[12px]" data-testid={testId}>
      <Tip label={HINTS[label]}>
        <span className="w-[58px] shrink-0 cursor-default text-ink-2" data-hint={HINTS[label] ? '' : undefined}>
          {label}
        </span>
      </Tip>
      {children}
    </div>
  )
}

function Reveal({ open, children, testId }: { open: boolean; children: ReactNode; testId?: string }) {
  return (
    <div
      className="grid transition-[grid-template-rows,opacity] duration-200"
      style={{ gridTemplateRows: open ? '1fr' : '0fr', opacity: open ? 1 : 0 }}
      inert={!open}
      data-open={open ? '' : undefined}
      data-testid={testId}
    >
      <div className="min-h-0 overflow-hidden">{children}</div>
    </div>
  )
}

const TRIGGER = 'h-7 w-full min-w-0 text-[12px]'
const settingsOf = (s: { doc: Doc }) => s.doc.settings

const MODEL_GROUPS = [
  { group: 'new', label: '新模型' },
  { group: 'legacy', label: '旧模型' },
] as const

function ModelCard() {
  const { s, update } = useTarget()
  const full = s.model === 'v5-full'
  const medium = full && s.effort === 'medium'
  const nsfwOn = usePrefs((p) => p.nsfw !== 'off')
  return (
    <Card title="模型" testId="settings-model">
      <Row label="模型">
        <Select value={s.model} onValueChange={(v) => update({ model: v as ModelId })}>
          <SelectTrigger size="sm" className={TRIGGER} aria-label="模型" data-testid="set-model">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {MODEL_GROUPS.map(({ group, label }) => (
              <SelectGroup key={group}>
                <SelectLabel>{label}</SelectLabel>
                {Object.values(MODELS)
                  .filter((m) => m.group === group)
                  .map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.name}
                    </SelectItem>
                  ))}
              </SelectGroup>
            ))}
          </SelectContent>
        </Select>
      </Row>
      {/* NovelAI supports Effort only for Full models; disable it for Curated. */}
      <Row label="Effort">
        <Tip label={full ? undefined : '仅 V5 Full 支持 Effort'}>
          <span>
            <Seg value={full ? s.effort : 'high'} onChange={(v) => update({ effort: v })} options={{ high: 'High', medium: 'Medium' }} disabled={!full} testId="set-effort" />
          </span>
        </Tip>
      </Row>
      {medium && (
        <p className="mb-1 ml-[66px] text-[11px] leading-relaxed text-ink-2" data-testid="medium-hint">
          Medium：步数固定为 {MEDIUM_FIXED.steps} · Euler Ancestral · UC 预设 Heavy · 无 Rescale；自定义 UC 和角色 UC 不生效
        </p>
      )}
      <Row label="模式">
        <Seg value={s.mode} onChange={(v) => update({ mode: v })} options={{ anime: 'Anime', furry: 'Furry' }} testId="set-mode" />
      </Row>
      <Reveal open={nsfwOn} testId="doc-nsfw-row">
        <Row label="NSFW">
          <Switch checked={!!s.nsfw} onCheckedChange={(v) => update({ nsfw: v })} aria-label="NSFW" data-testid="doc-nsfw" />
        </Row>
      </Reveal>
    </Card>
  )
}

function PresetCard() {
  const { s, update } = useTarget()
  const eff = effectiveSettings(s)
  const medium = eff.effort === 'medium'
  return (
    <Card title="Prompt 预设" sub="生成时由 NAI 添加至 prompt" testId="settings-preset">
      <Row label="质量">
        <Select value={eff.qualityTags} onValueChange={(v) => update({ qualityTags: v as QualityPreset })}>
          <SelectTrigger size="sm" className={TRIGGER} aria-label="质量标签" data-testid="quality-preset">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {qualityOptions(s.model).map((k) => (
              <SelectItem key={k} value={k}>
                {QUALITY_LABEL[k]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Row>
      <Row label="UC 预设">
        <Select value={eff.ucPreset} onValueChange={(v) => update({ ucPreset: v as UcPreset })} disabled={medium}>
          <SelectTrigger size="sm" className={TRIGGER} aria-label="UC 预设" data-testid="uc-preset">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {ucOptions(s.model).map((k) => (
              <SelectItem key={k} value={k}>
                {UC_LABEL[k]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Row>
      {/* NovelAI supports transparency only in V5. */}
      <Reveal open={modelInfo(s.model).transparency} testId="transparent-row">
        <Row label="透明背景">
          <Switch checked={eff.transparent} onCheckedChange={(v) => update({ transparent: v })} aria-label="透明背景" data-testid="set-transparent" />
        </Row>
      </Reveal>
    </Card>
  )
}

const SLIDER =
  'flex-1 **:data-[slot=slider-track]:bg-line-strong **:data-[slot=slider-range]:bg-lamp-text **:data-[slot=slider-thumb]:size-3.5 **:data-[slot=slider-thumb]:rounded-full **:data-[slot=slider-thumb]:border-lamp-text **:data-[slot=slider-thumb]:bg-lamp'

const sizeKey = (w: number, h: number) => `${w}x${h}`
const PRESET_OF = new Map(V5_SIZES.flatMap(({ group, sizes }) => sizes.map(([w, h]) => [sizeKey(w, h), group] as const)))
type Shape = 'Landscape' | 'Portrait' | 'Square'
const SHAPES: { k: Shape; label: string; icon: typeof SquareIcon }[] = [
  { k: 'Landscape', label: '横图', icon: RectangleHorizontalIcon },
  { k: 'Portrait', label: '竖图', icon: RectangleVerticalIcon },
  { k: 'Square', label: '方图', icon: SquareIcon },
]
const sizesOf = (group: string) => V5_SIZES.find((x) => x.group === group)?.sizes ?? []

function SizeRows({ width, height, onChange }: { width: number; height: number; onChange: (w: number, h: number) => void }) {
  const group = PRESET_OF.get(sizeKey(width, height))
  const shape = sizeShape(width, height) as Shape
  const last = useRef<{ long: number; short: number } | null>(null)
  useEffect(() => {
    if (width !== height) last.current = { long: Math.max(width, height), short: Math.min(width, height) }
  }, [width, height])
  const pickGroup = (g: string) => {
    const sizes = sizesOf(g)
    const [w, h] = sizes.find(([w, h]) => sizeShape(w, h) === shape) ?? sizes[0]
    onChange(w, h)
  }
  const pickShape = (k: Shape) => {
    if (group) {
      const hit = sizesOf(group).find(([w, h]) => sizeShape(w, h) === k)
      if (hit) onChange(hit[0], hit[1])
      return
    }
    const st = GEN_LIMITS.sizeStep
    if (k === 'Square') {
      const side = Math.min(Math.max(st, Math.round(Math.sqrt(width * height) / st) * st), Math.floor(Math.sqrt(GEN_LIMITS.maxPixels) / st) * st)
      return onChange(side, side)
    }
    const d = width !== height ? { long: Math.max(width, height), short: Math.min(width, height) } : (last.current ?? { long: 1216, short: 832 })
    onChange(k === 'Landscape' ? d.long : d.short, k === 'Landscape' ? d.short : d.long)
  }
  return (
    <>
      {/* NovelAI dimensions use multiples of 64; changing one side must also respect the total pixel limit. */}
      <Row label="尺寸">
        <NumField
          value={width}
          onCommit={(v) => {
            if (v === null) return
            const [w, h] = fitSize(v, height)
            onChange(w, h)
          }}
          step={GEN_LIMITS.sizeStep}
          label="宽"
          testId="set-width"
        />
        <span className="text-ink-3">×</span>
        <NumField
          value={height}
          onCommit={(v) => {
            if (v === null) return
            const [h, w] = fitSize(v, width)
            onChange(w, h)
          }}
          step={GEN_LIMITS.sizeStep}
          label="高"
          testId="set-height"
        />
        <Tip label="宽高对调">
          <Button variant="ghost" size="icon-sm" className="text-ink-2" onClick={() => onChange(height, width)} disabled={width === height} aria-label="宽高对调" data-testid="set-swap">
            <Icon icon={ArrowLeftRightIcon} size={16} />
          </Button>
        </Tip>
      </Row>
      <Row label="">
        <Select value={group ?? ''} onValueChange={pickGroup}>
          <SelectTrigger size="sm" className={TRIGGER} aria-label="尺寸档位" data-testid="set-size">
            <SelectValue placeholder="自定义" />
          </SelectTrigger>
          <SelectContent>
            {V5_SIZES.map(({ group: g }) => (
              <SelectItem key={g} value={g}>
                {g}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Tabs value={shape} onValueChange={(v) => pickShape(v as Shape)} data-testid="set-shape">
          <TabsList className="rounded-md p-0.5 group-data-horizontal/tabs:h-7">
            {SHAPES.map(({ k, label, icon }) => {
              const off = !!group && !sizesOf(group).some(([w, h]) => sizeShape(w, h) === k)
              return (
                <Tip key={k} label={off ? `${group} 无${label}` : label}>
                  <span className="inline-flex">
                    <TabsTrigger value={k} disabled={off} className="h-6 rounded-[4px] px-2" aria-label={label} data-testid={`set-shape-${k}`}>
                      <Icon icon={icon} size={14} />
                    </TabsTrigger>
                  </span>
                </Tip>
              )
            })}
          </TabsList>
        </Tabs>
      </Row>
    </>
  )
}

const aiDefaults = (m: ModelId): Partial<GenParams> => {
  const d = defaultGen(m)
  return { steps: d.steps, scale: d.scale, seed: null, sampler: d.sampler, cfgRescale: d.cfgRescale, noiseSchedule: undefined, varietyPlus: false, legacyUc: false }
}

function ImageCard({ seed = true, gen = false }: { seed?: boolean; gen?: boolean }) {
  const { s, updateGen } = useTarget()
  const connected = useConnected()
  const extra = gen && connected
  const eff = effectiveSettings(s)
  const g = eff.gen
  const medium = eff.effort === 'medium'
  const info = modelInfo(s.model)
  const samplers = [...SAMPLERS.recommended, ...SAMPLERS.other]
  const { steps, scale, cfgRescale } = GEN_LIMITS
  const defaults = aiDefaults(s.model)
  const isDefault = (Object.keys(defaults) as (keyof GenParams)[]).every((k) => (s.gen[k] ?? false) === (defaults[k] ?? false))
  const reset = extra && (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex">
          <Button variant="ghost" size="icon-sm" className="text-ink-2" disabled={isDefault} onClick={() => updateGen(defaults)} aria-label="重置为模型默认" data-testid="gen-reset">
            <Icon icon={UndoIcon} size={16} />
          </Button>
        </span>
      </TooltipTrigger>
      <TooltipContent>重置为模型默认（{info.noiseSchedule ? '步数、引导、Seed、采样、Rescale、噪声调度、Variety+' : '步数、引导、Seed、采样、Rescale'}）</TooltipContent>
    </Tooltip>
  )
  return (
    <Card title="图像" action={reset} testId="settings-image">
      <SizeRows width={g.width} height={g.height} onChange={(w, h) => updateGen({ width: w, height: h })} />
      {extra && <CountRow />}
      <SliderRow label="步数" value={g.steps} {...steps} disabled={medium} round={(v) => Math.round(v)} onChange={(v, key) => updateGen({ steps: v }, key)} testId="set-steps" />
      {/* NovelAI allows guidance above the slider maximum through numeric input (uncapMax). */}
      <SliderRow label="引导" value={g.scale} {...scale} uncapMax round={(v) => Math.round(v * 10) / 10} onChange={(v, key) => updateGen({ scale: v }, key)} testId="set-scale" />
      <ScaleWarning scale={g.scale} model={s.model} onReset={() => updateGen({ scale: defaultGen(s.model).scale })} />
      {/* NovelAI exposes Variety+ (cfgDelay) only for V4.x. */}
      <Reveal open={info.varietySigma !== null} testId="variety-row">
        <Row label="Variety+">
          <Switch checked={!!g.varietyPlus} onCheckedChange={(v) => updateGen({ varietyPlus: v })} aria-label="Variety+" data-testid="set-variety" />
        </Row>
      </Reveal>
      <SliderRow label="Rescale" value={g.cfgRescale} {...cfgRescale} disabled={medium} round={(v) => Math.round(v * 50) / 50} onChange={(v, key) => updateGen({ cfgRescale: v }, key)} testId="set-rescale" />
      <Row label="采样">
        <Select value={g.sampler} onValueChange={(v) => updateGen({ sampler: v })} disabled={medium}>
          <SelectTrigger size="sm" className={TRIGGER} aria-label="采样" data-testid="set-sampler">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectLabel>推荐</SelectLabel>
              {SAMPLERS.recommended.map((k) => (
                <SelectItem key={k} value={k}>
                  {SAMPLER_NAMES[k]}
                </SelectItem>
              ))}
            </SelectGroup>
            <SelectGroup>
              <SelectLabel>其他</SelectLabel>
              {SAMPLERS.other.map((k) => (
                <SelectItem key={k} value={k}>
                  {SAMPLER_NAMES[k]}
                </SelectItem>
              ))}
              {!samplers.includes(g.sampler) && <SelectItem value={g.sampler}>{SAMPLER_NAMES[g.sampler] ?? g.sampler}</SelectItem>}
            </SelectGroup>
          </SelectContent>
        </Select>
      </Row>
      {/* NovelAI exposes noise schedules only for V4.x; supported values and defaults depend on the sampler. */}
      <Reveal open={info.noiseSchedule && noiseOptions(s.model, g.sampler).length > 0} testId="noise-row">
        <Row label="噪声调度">
          <Select value={effectiveNoise(s.model, g)} onValueChange={(v) => updateGen({ noiseSchedule: v as NoiseSchedule })}>
            <SelectTrigger size="sm" className={TRIGGER} aria-label="噪声调度" data-testid="set-noise">
              <SelectValue>{effectiveNoise(s.model, g)}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {noiseOptions(s.model, g.sampler).map((n) => (
                <SelectItem key={n} value={n}>
                  {n}
                  {n === defaultNoise(g.sampler) && <span className="text-[11px] text-ink-2">推荐</span>}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Row>
      </Reveal>
      {/* NovelAI exposes Legacy Prompt Conditioning Mode only for V4. */}
      <Reveal open={info.legacyUc} testId="legacy-uc-row">
        <Row label="Legacy UC">
          <Switch checked={!!g.legacyUc} onCheckedChange={(v) => updateGen({ legacyUc: v })} aria-label="Legacy UC" data-testid="set-legacy-uc" />
        </Row>
      </Reveal>
      {seed && (
        <Row label="Seed">
          <NumField
            value={g.seed}
            onCommit={(v) => {
              if (v !== null && (!Number.isInteger(v) || v < 0 || v > GEN_LIMITS.seedMax)) return
              updateGen({ seed: v })
            }}
            allowEmpty
            placeholder="随机"
            className="flex-1 text-left"
            label="Seed"
            testId="set-seed"
          />
          {extra && <SeedButton seed={g.seed} onSet={(v) => updateGen({ seed: v })} />}
        </Row>
      )}
    </Card>
  )
}

function ScaleWarning({ scale, model, onReset }: { scale: number; model: ModelId; onReset: () => void }) {
  const [lo, hi] = modelInfo(model).scaleRecommended
  const text = scale > hi ? '引导过高，图像可能过饱和、模糊' : scale < lo ? '引导过低，图像可能杂乱、不合常理' : ''
  const last = useRef(text)
  if (text) last.current = text
  return (
    <Reveal open={!!text} testId="scale-warning">
      <p className="mb-1 ml-[66px] text-[11px] leading-relaxed text-warn">
        {last.current}
        <button type="button" className="ml-1.5 text-ink-2 underline decoration-line-strong underline-offset-2 hover:text-ink-1" onClick={onReset} data-testid="scale-reset">
          重置为默认
        </button>
      </p>
    </Reveal>
  )
}

function CountRow() {
  const { s, updateGen } = useTarget()
  const g = effectiveSettings(s).gen
  const max = maxSamplesForSize(g.width, g.height)
  const n = Math.min(s.gen.nSamples ?? 1, max)
  const options = Object.fromEntries(Array.from({ length: max }, (_, i) => [String(i + 1), String(i + 1)])) as Record<string, string>
  return (
    <Row label="张数" testId="set-count">
      <Seg value={String(n)} onChange={(v) => updateGen({ nSamples: Number(v) })} options={options} testId="set-count-seg" />
    </Row>
  )
}

function SeedButton({ seed, onSet }: { seed: number | null; onSet: (v: number | null) => void }) {
  const tabId = useTabs((t) => t.activeId)
  const img = useSelectedImage(useDocId(tabId))
  if (seed !== null)
    return (
      <Button variant="outline" size="sm" className="shrink-0 text-[12px] text-ink-2" onClick={() => onSet(null)} data-testid="seed-clear">
        清空
      </Button>
    )
  return (
    <Button variant="outline" size="sm" className="shrink-0 text-[12px] text-ink-2" disabled={!img} onClick={() => img && onSet(img.seed)} data-testid="seed-use-current">
      使用当前图的 Seed
    </Button>
  )
}

function SliderRow({
  label,
  value,
  min,
  max,
  step,
  round,
  uncapMax,
  disabled,
  onChange,
  testId,
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  round: (v: number) => number
  uncapMax?: boolean
  disabled?: boolean
  onChange: (v: number, coalesce?: string) => void
  testId: string
}) {
  const clamp = (v: number, cap = true) => Math.max(min, cap ? Math.min(max, round(v)) : round(v))
  return (
    <Row label={label} testId={testId}>
      <SliderSteps className={SLIDER} value={value} min={min} max={max} step={step} disabled={disabled} onChange={(v) => onChange(clamp(v, !uncapMax), `gen:${testId}`)} label={label} testId={`${testId}-slider`} />
      <NumField value={value} onCommit={(v) => v !== null && onChange(clamp(v, !uncapMax))} step={step} disabled={disabled} label={label} />
    </Row>
  )
}

/** An empty seed is stored as null to request a random seed. */
function NumField({
  value,
  onCommit,
  step = 1,
  allowEmpty,
  placeholder,
  disabled,
  className = 'w-[52px] text-center',
  label,
  testId,
}: {
  value: number | null
  onCommit: (v: number | null) => void
  step?: number
  allowEmpty?: boolean
  placeholder?: string
  disabled?: boolean
  className?: string
  label: string
  testId?: string
}) {
  const field = useDraftField({
    value: value === null ? '' : String(value),
    onCommit: (t) => {
      if (!t) return allowEmpty ? onCommit(null) : undefined
      const v = Number(t)
      if (Number.isFinite(v)) onCommit(v)
    },
  })
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && value !== null) {
      e.preventDefault()
      field.reset()
      onCommit(Math.round((value + (e.key === 'ArrowUp' ? step : -step)) * 100) / 100)
    } else field.props.onKeyDown(e)
  }
  return (
    <input
      className={`h-7 min-w-0 rounded-md border border-line bg-surface-2/60 px-1.5 text-[12px] text-ink-1 tabular-nums outline-none placeholder:font-sans placeholder:text-ink-3 focus:border-lamp-text disabled:opacity-50 ${className}`}
      placeholder={placeholder}
      inputMode="decimal"
      disabled={disabled}
      {...field.props}
      onKeyDown={onKeyDown}
      aria-label={label}
      data-testid={testId}
    />
  )
}

const charsOf = (s: { doc: Doc }) => s.doc.characters

function PositionCard() {
  const useCoords = useDoc((s) => s.doc.settings.useCoords)
  const model = useDoc((s) => s.doc.settings.model)
  const grid = !modelInfo(model).freePosition
  const w = useDoc((s) => s.doc.settings.gen.width)
  const h = useDoc((s) => s.doc.settings.gen.height)
  const chars = useDoc(charsOf)
  const actions = useActions()
  const [open, setOpen] = useState(false)
  const enabled = chars.map((c, i) => ({ c, n: i + 1 })).filter(({ c }) => c.enabled)
  // NovelAI V4.x disables explicit positioning when only one character is enabled.
  const one = useCoords && grid && enabled.length === 1
  const canAdjust = useCoords && canPosition(model, enabled.length)
  const at = (c: Character) => (grid ? snapCenter(c.center) : c.center)
  const k = Math.min(104 / w, 132 / h)
  return (
    <Card title="角色位置" testId="settings-position">
      <Row label="位置">
        <Seg value={useCoords ? 'custom' : 'ai'} onChange={(v) => actions.updateSettings({ useCoords: v === 'custom' })} options={{ ai: "AI's Choice", custom: 'Custom' }} testId="set-coords" />
      </Row>
      <div className="mt-1.5 flex items-start gap-3">
        <Tip label={canAdjust ? '点击调整位置' : undefined}>
          <button
            type="button"
            className="pos-canvas pos-mini shrink-0"
            style={{ width: Math.round(w * k), height: Math.round(h * k) }}
            data-off={useCoords ? undefined : ''}
            data-grid={grid ? '' : undefined}
            disabled={!canAdjust}
            onClick={() => setOpen(true)}
            aria-label="调整角色位置"
            data-testid="pos-mini"
          >
            {useCoords && enabled.map(({ c, n }) => <Dot key={c.id} n={n} x={at(c).x} y={at(c).y} />)}
          </button>
        </Tip>
        <div className="flex min-w-0 flex-1 flex-col gap-1.5 pt-0.5">
          {enabled.map(({ c, n }) => (
            <div key={c.id} className="flex min-w-0 items-center gap-1.5 text-[12px]">
              <span className="imp-badge shrink-0">{n}</span>
              <span className="truncate">{characterLabel({ characters: chars }, c)}</span>
            </div>
          ))}
          {!enabled.length && <p className="text-[11px] text-ink-2">暂无已启用的角色</p>}
          {one && <p className="text-[11px] leading-relaxed text-ink-2" data-testid="pos-one">{modelInfo(model).name}：仅 1 个角色时无法调整位置</p>}
          <Button variant="outline" size="xs" className="mt-0.5 self-start text-ink-2" disabled={!canAdjust} onClick={() => setOpen(true)} data-testid="pos-open">
            <Icon icon={Maximize01Icon} size={14} />
            调整位置
          </Button>
        </div>
      </div>
      <Dialog open={open && canAdjust} onOpenChange={setOpen}>
        <PositionEditor chars={enabled} w={w} h={h} grid={grid} />
      </Dialog>
    </Card>
  )
}

function Dot({ n, x, y, big, hl, dragging, ...rest }: { n: number; x: number; y: number; big?: boolean; hl?: boolean; dragging?: boolean } & HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className="pos-dot"
      data-big={big ? '' : undefined}
      data-hl={hl ? '' : undefined}
      data-drag={dragging ? '' : undefined}
      style={{ left: `${x * 100}%`, top: `${y * 100}%` } as CSSProperties}
      {...rest}
    >
      {n}
    </span>
  )
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v))
const round3 = (v: number) => Math.round(v * 1000) / 1000

function PositionEditor({ chars, w, h, grid }: { chars: { c: Character; n: number }[]; w: number; h: number; grid: boolean }) {
  const allChars = useDoc(charsOf)
  const actions = useActions()
  const canvas = useRef<HTMLDivElement>(null)
  const [hl, setHl] = useState<string | null>(null)
  const [drag, setDrag] = useState<{ id: string; x: number; y: number; dx: number; dy: number } | null>(null)

  const place = (c: { x: number; y: number }) => (grid ? snapCenter(c) : c)
  const at = (e: ReactPointerEvent) => {
    const r = canvas.current!.getBoundingClientRect()
    return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height }
  }
  const onDown = (c: Character) => (e: ReactPointerEvent<HTMLSpanElement>) => {
    if (e.button !== 0) return
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    const p = at(e)
    const o = place(c.center)
    setDrag({ id: c.id, x: o.x, y: o.y, dx: p.x - o.x, dy: p.y - o.y })
  }
  const onMove = (e: ReactPointerEvent) => {
    if (!drag) return
    const p = at(e)
    const q = place({ x: clamp01(p.x - drag.dx), y: clamp01(p.y - drag.dy) })
    setDrag({ ...drag, x: q.x, y: q.y })
  }
  const onUp = () => {
    if (!drag) return
    const c = chars.find(({ c }) => c.id === drag.id)?.c
    if (c && (round3(drag.x) !== c.center.x || round3(drag.y) !== c.center.y)) actions.updateCharacter(drag.id, { center: { x: round3(drag.x), y: round3(drag.y) } })
    setDrag(null)
  }

  return (
    <DialogContent
      className="w-auto max-w-[calc(100%-2rem)] gap-0 overflow-hidden rounded-xl bg-work p-0 text-ink-1 shadow-(--shadow-pop) ring-line sm:max-w-[calc(100%-2rem)]"
      data-testid="pos-dialog"
    >
      <header className="flex items-baseline gap-2.5 py-3 pr-11 pl-4">
        <DialogTitle className="text-[13px] font-semibold">角色位置</DialogTitle>
        <span className="text-[12px] text-ink-2">
          {w} × {h}
        </span>
        <DialogDescription className="sr-only">拖动圆点调整角色位置</DialogDescription>
      </header>
      <div className="flex gap-4 border-y border-line bg-shell p-4">
        <div
          ref={canvas}
          className="pos-canvas shrink-0"
          style={{ aspectRatio: `${w} / ${h}`, width: `min(560px, calc((100dvh - 200px) * ${(w / h).toFixed(4)}))` }}
          data-grid={grid ? '' : undefined}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={() => setDrag(null)}
          data-testid="pos-canvas"
        >
          {chars.map(({ c, n }) => {
            const d = drag?.id === c.id ? drag : null
            return (
              <Dot
                key={c.id}
                n={n}
                x={d ? d.x : place(c.center).x}
                y={d ? d.y : place(c.center).y}
                big
                hl={hl === c.id || !!d}
                dragging={!!d}
                onPointerDown={onDown(c)}
                onPointerEnter={() => setHl(c.id)}
                onPointerLeave={() => setHl(null)}
                data-testid="pos-dot"
              />
            )
          })}
        </div>
        <ul className="flex w-[220px] flex-col gap-0.5">
          {chars.map(({ c, n }) => (
            <li
              key={c.id}
              className="pos-row"
              data-hl={hl === c.id || drag?.id === c.id ? '' : undefined}
              onPointerEnter={() => setHl(c.id)}
              onPointerLeave={() => setHl(null)}
              data-testid="pos-row"
            >
              <span className="imp-badge mt-px shrink-0">{n}</span>
              <span className="flex min-w-0 flex-col">
                <span className="truncate text-[13px] font-medium">{characterLabel({ characters: allChars }, c)}</span>
                <span className="truncate text-[11px] text-ink-2">{characterPrompt(c) || '（正面为空）'}</span>
              </span>
            </li>
          ))}
        </ul>
      </div>
      <footer className="flex items-center gap-2.5 py-2.5 pr-3.5 pl-4">
        <span className="flex-1 text-[12px] text-ink-2">拖动圆点调整位置</span>
        <DialogClose asChild>
          <Button size="lg" className="px-3 font-semibold" data-testid="pos-done">
            完成
          </Button>
        </DialogClose>
      </footer>
    </DialogContent>
  )
}
