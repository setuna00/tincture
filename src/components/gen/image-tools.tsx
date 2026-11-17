import { useMemo, useRef, useState, type ReactNode } from 'react'
import { useStore } from 'zustand'
import { ArrowDown01Icon } from '@hugeicons/core-free-icons'
import { Anlas, PricePill } from '@/components/anlas'
import { useAfterMenu } from '@/components/after-menu'
import { composing } from '@/components/draft-field'
import { Icon } from '@/components/icon'
import { Seg } from '@/components/seg'
import { Tip } from '@/components/tip'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuShortcut, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { PopoverAnchor } from '@/components/ui/popover'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { SliderSteps } from '@/components/slider-steps'
import { naiModelId, PRICE_TOO_LONG } from '@/lib/nai-api'
import { inpaintModelId } from '@/lib/nai-inpaint'
import { activeRefs } from '@/lib/nai-refs'
import { modelInfo, modelName, refModelFor } from '@/lib/nai-models'
import {
  actionRefSettings,
  CANNOT,
  DEFRY_LABELS,
  DIRECTOR_TOOLS,
  EMOTIONS,
  defaultEnhanceScale,
  enhancePriceParts,
  enhanceScales,
  toolPrice,
  upscalePrice,
  variationsCount,
  variationsPriceParts,
  type ActionPrice,
  type Emotion,
  type ImageAction,
} from '@/lib/nai-tools'
import { effectiveSettings } from '@/lib/nai-write'
import { cn } from '@/lib/utils'
import { imageBlob, useGen, vibeEncoded, type GenImage } from '@/store/gen'
import { runAction, type ActionOptions } from '@/store/image-actions'
import { openInpaint } from '@/store/inpaint'
import { accountOf, useNai } from '@/store/nai'
import { useVibeCodes } from '@/store/ref-images'
import { getDocStore } from '@/store/tabs'
import type { Doc } from '@/types'
import { useToolsMenu } from '@/store/right-panel'
import { addReference, type RefKind } from '@/store/refs'
import { ACTION_DESC, ACTION_ICON, ACTION_NAME, INPAINT_ICON, SLIDER } from './action-meta'
import { useInpaintPrice } from './inpaint-price'
import { PriceParts } from './price-parts'
import { REF_KINDS, REF_META, switchHint } from './ref-meta'
import { SpendConfirm, SpendPopover } from './spend-confirm'

type Opener = 'upscale' | 'enhance' | 'variations' | 'more'

export function ImageTools({ tabId, docId, img }: { tabId: string; docId: string; img: GenImage }) {
  const account = useNai((s) => accountOf(s.account))
  const lost = !!img.missing
  const busy = useGen((s) => !!s.running) || lost
  const hasPrompt = img.model !== ''
  // NovelAI Enhance uses the current editor prompt and parameters, so price and Max availability follow the current model.
  const doc = useStore(getDocStore(tabId), (s) => s.doc)
  const v5 = modelInfo(effectiveSettings(doc.settings).model).group === 'new'
  // Reusable Vibe codes avoid encoding charges; Enhance uses the current model, while variations use the source version model.
  const have = useVibeCodes((v) => v.have)
  const prices = useMemo(() => {
    const scales = enhanceScales(img.width, img.height, v5)
    const p: Record<ImageAction, number> = {
      upscale: upscalePrice(img.width, img.height),
      enhance: enhancePriceParts(doc, img, { scale: defaultEnhanceScale(scales), strength: ENHANCE_DEFAULT.strength }, account, encodedFor(have, doc)).total,
      variations: variationsPriceParts(img.doc, img, account, encodedFor(have, img.doc)).total,
      'bg-removal': 0,
      lineart: 0,
      sketch: 0,
      colorize: 0,
      emotion: 0,
      declutter: 0,
    }
    for (const t of DIRECTOR_TOOLS) p[t] = toolPrice(t, img.width, img.height, account)
    return p
  }, [img, doc, account, v5, have])
  const inpaint = useInpaintPrice(tabId, img).price
  const noInpaint = !inpaintModelId(doc.settings)
  const [ask, setAsk] = useState<{ open: boolean; at: Opener; action: ImageAction; o: ActionOptions } | null>(null)
  const close = () => setAsk((a) => a && { ...a, open: false })
  const open = ask?.open ? ask : null

  const start = (at: Opener, action: ImageAction) => {
    if (prices[action] === 0 && !HAS_OPTIONS.has(action)) return void runAction(tabId, docId, img, action)
    setAsk({ open: true, at, action, o: defaultOptions(action, enhanceScales(img.width, img.height, v5)) })
  }
  const pop = (at: Opener, anchor: ReactNode) => (
    <SpendPopover
      open={open?.at === at}
      onCancel={close}
      anchor={
        <PopoverAnchor asChild>
          <span className="flex">{anchor}</span>
        </PopoverAnchor>
      }
    >
      {ask?.at === at && (
        <ToolConfirm
          action={ask.action}
          o={ask.o}
          onChange={(p) => setAsk((a) => a && { ...a, o: { ...a.o, ...p } })}
          img={img}
          doc={doc}
          v5={v5}
          prices={prices}
          account={account}
          onCancel={close}
          onRun={() => (close(), void runAction(tabId, docId, img, ask.action, ask.o))}
        />
      )}
    </SpendPopover>
  )

  const busyTip = lost ? '图片文件已丢失' : busy ? '已有图片在生成' : null
  const main = (a: Opener & ImageAction, cannot?: string) => {
    const p = prices[a]
    const no = p === CANNOT
    return pop(
      a,
      <Tip
        label={
          busyTip ??
          (no ? (
            cannot
          ) : (
            <span className="inline-flex items-center gap-1.5">
              {ACTION_NAME[a]} <Anlas n={p} />
            </span>
          ))
        }
      >
        <span className="flex">
          <ToolButton icon={ACTION_ICON[a]} name={ACTION_NAME[a]} price={no ? null : p} disabled={busy || no} active={open?.at === a} onClick={() => start(a, a)} testId={`tool-${a}`} />
        </span>
      </Tip>,
    )
  }
  return (
    <div className="-ml-2 flex h-8 min-w-0 items-center gap-0.5" data-testid="image-tools">
      {main('upscale', '图大于 1536 × 2048，无法放大')}
      {main('enhance', '图大于 1536 × 2048，无法 Enhance')}
      {hasPrompt && main('variations', '图大于 1536 × 2048，无法生成变体')}
      <Tip
        label={
          busyTip ??
          (noInpaint ? (
            '当前模型无法重绘'
          ) : inpaint === PRICE_TOO_LONG ? (
            '当前参数生成耗时过长'
          ) : (
            <span className="inline-flex items-center gap-1.5">
              重绘 <Anlas n={inpaint} />
            </span>
          ))
        }
      >
        <span className="flex">
          <ToolButton
            icon={INPAINT_ICON}
            name="重绘"
            price={noInpaint || inpaint === PRICE_TOO_LONG ? null : inpaint}
            disabled={busy || noInpaint || inpaint === PRICE_TOO_LONG}
            onClick={() => void openInpaint(tabId, docId, img)}
            testId="tool-inpaint"
          />
        </span>
      </Tip>
      {pop(
        'more',
        <MoreMenu
          imgId={img.id}
          prices={prices}
          busy={busy}
          busyTip={busyTip}
          active={open?.at === 'more'}
          model={doc.settings.model}
          onPick={(t) => start('more', t)}
          onRef={(k) => void imageBlob(img).then((b) => addReference(getDocStore(tabId), k, b))}
        />,
      )}
    </div>
  )
}

const encodedFor = (have: Set<string>, doc: Doc) => vibeEncoded(have, naiModelId(effectiveSettings(doc.settings)))

function refsLine(doc: Doc): string | null {
  const { vibes, characters } = activeRefs(actionRefSettings(doc))
  const parts = [vibes.length && `Vibe Transfer ${vibes.length} 张`, characters.length && `精准参考 ${characters.length} 张`].filter(Boolean)
  return parts.length ? `将带上${vibes.length ? ' ' : ''}${parts.join('、')}` : null
}

const HAS_OPTIONS = new Set<ImageAction>(['enhance', 'colorize', 'emotion', 'declutter'])
const ENHANCE_DEFAULT = { strength: 0.5, noise: 0 }

function defaultOptions(action: ImageAction, scales: ReturnType<typeof enhanceScales>): ActionOptions {
  if (action === 'enhance') return { scale: defaultEnhanceScale(scales), ...ENHANCE_DEFAULT }
  if (action === 'emotion') return { emotion: 'neutral', defry: 0 }
  if (action === 'colorize') return { prompt: '', defry: 0 }
  return {}
}

function ToolButton({
  icon,
  name,
  price,
  active,
  testId,
  more,
  className,
  ...rest
}: { icon?: Parameters<typeof Icon>[0]['icon']; name: string; price?: number | null; active?: boolean; testId: string; more?: boolean } & React.ComponentProps<typeof Button>) {
  return (
    <Button
      variant="ghost"
      className={cn('h-7 gap-1 px-2 text-[12px] font-normal whitespace-nowrap text-ink-1 @max-[430px]:px-1.5', active && 'bg-surface-2', className)}
      aria-label={name}
      data-testid={testId}
      {...rest}
    >
      {icon && <Icon icon={icon} size={16} className="text-ink-2" />}
      <span className={cn(more ? '@max-[430px]:hidden' : '@max-[300px]:hidden')}>{name}</span>
      {more && <Icon icon={ArrowDown01Icon} size={14} className="text-ink-2" />}
      {price != null && <PricePill n={price} className="ml-0.5 @max-[530px]:hidden" testId={`${testId}-price`} />}
    </Button>
  )
}

function MoreMenu({
  imgId,
  prices,
  busy,
  busyTip,
  active,
  model,
  onPick,
  onRef,
}: {
  imgId: string
  prices: Record<ImageAction, number>
  busy: boolean
  busyTip: string | null
  active: boolean
  model: Doc['settings']['model']
  onPick: (t: ImageAction) => void
  onRef: (k: RefKind) => void
}) {
  // Wait for menu focus restoration before opening the popover, or that focus change dismisses it as an outside interaction.
  const menu = useAfterMenu()
  const open = useToolsMenu((s) => s.openFor === imgId) && !busy
  return (
    <span className="flex">
      <DropdownMenu open={open} onOpenChange={(o) => useToolsMenu.setState({ openFor: o ? imgId : null })}>
        <Tip label={busyTip ?? '更多'}>
          <span className="flex">
            <DropdownMenuTrigger asChild disabled={busy}>
              <ToolButton name="更多" more disabled={busy} active={active} testId="tool-more" />
            </DropdownMenuTrigger>
          </span>
        </Tip>
        <DropdownMenuContent
          align="start"
          className="w-auto min-w-56"
          data-testid="tool-more-menu"
          onCloseAutoFocus={menu.onCloseAutoFocus}
        >
          {REF_KINDS.map((k) => {
            const hint = k === 'base' ? null : switchHint(modelName(model), modelName(refModelFor(model, k)))
            return (
              <DropdownMenuItem key={k} className="whitespace-nowrap" onSelect={() => onRef(k)} data-testid={`tool-ref-${k}`}>
                <Icon icon={REF_META[k].icon} size={14} className="text-ink-2" />
                {REF_META[k].add}
                {hint && <DropdownMenuShortcut className="pl-4 text-[12px] tracking-normal text-ink-3">{hint}</DropdownMenuShortcut>}
              </DropdownMenuItem>
            )
          })}
          <DropdownMenuSeparator />
          <DropdownMenuLabel className="text-[11px] font-semibold text-ink-2">Director Tools</DropdownMenuLabel>
          {DIRECTOR_TOOLS.map((t) => (
            <DropdownMenuItem key={t} className="whitespace-nowrap" onSelect={() => menu.later(() => onPick(t))} data-testid={`tool-${t}`}>
              <Icon icon={ACTION_ICON[t]} size={14} className="text-ink-2" />
              {ACTION_NAME[t]}
              <DropdownMenuShortcut className="pl-4 text-(--price-text) group-focus/dropdown-menu-item:text-(--price-text)">
                <Anlas n={prices[t]} />
              </DropdownMenuShortcut>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </span>
  )
}

function ToolConfirm({
  action,
  o,
  onChange: set,
  img,
  doc,
  v5,
  prices,
  account,
  onCancel,
  onRun,
}: {
  action: ImageAction
  o: ActionOptions
  onChange: (p: Partial<ActionOptions>) => void
  img: GenImage
  doc: Doc
  v5: boolean
  prices: Record<ImageAction, number>
  account: ReturnType<typeof accountOf>
  onCancel: () => void
  onRun: () => void
}) {
  const scales = useMemo(() => enhanceScales(img.width, img.height, v5), [img, v5])
  const have = useVibeCodes((v) => v.have)
  const parts: ActionPrice | null =
    action === 'enhance'
      ? enhancePriceParts(doc, img, { scale: o.scale ?? 1, strength: o.strength ?? 0.5 }, account, encodedFor(have, doc))
      : action === 'variations'
        ? variationsPriceParts(img.doc, img, account, encodedFor(have, img.doc))
        : null
  const price = parts ? parts.total : prices[action]
  const refs = action === 'enhance' ? refsLine(doc) : action === 'variations' ? refsLine(img.doc) : null
  const go = useRef<HTMLButtonElement>(null)
  const name = ACTION_NAME[action]
  const count = action === 'variations' ? variationsCount(img.width, img.height) : 1
  return (
    <SpendConfirm
      title={name}
      desc={`${ACTION_DESC[action]}${count > 1 ? `（${count} 张）` : ''}`}
      notes={
        <>
          {refs && (
            <p className="text-[12px] leading-[18px] text-ink-3" data-testid="tool-confirm-refs">
              {refs}
            </p>
          )}
          {parts && price !== CANNOT && parts.total !== parts.gen && (
            <div className="text-[12px] leading-[18px] text-ink-3">
              <PriceParts parts={parts} label={name} />
            </div>
          )}
        </>
      }
      label={name}
      price={price}
      onRun={onRun}
      onCancel={onCancel}
      runRef={go}
      align="start"
      ids={{ box: 'tool-confirm', cancel: 'tool-cancel', run: 'tool-run', price: 'tool-run-price' }}
      data={{ 'data-action': action }}
    >
      {action === 'enhance' && (
        <div className="flex flex-col gap-1">
          <OptRow label="放大">
            <Seg
              value={String(o.scale)}
              onChange={(v) => set({ scale: v === 'max' ? 'max' : Number(v) })}
              options={Object.fromEntries(scales.map((k) => [String(k), k === 'max' ? 'Max' : `${k}×`]))}
              testId="tool-enhance-scale"
            />
          </OptRow>
          <SliderOpt label="强度" value={o.strength ?? 0.5} min={0.01} max={0.99} step={0.01} onChange={(v) => set({ strength: v })} testId="tool-enhance-strength" />
          <SliderOpt label="噪声" value={o.noise ?? 0} min={0} max={0.99} step={0.01} onChange={(v) => set({ noise: v })} testId="tool-enhance-noise" />
        </div>
      )}
      {action === 'colorize' && (
        <div className="flex flex-col gap-1">
          <OptRow label="Prompt">
            <input
              className="h-7 min-w-0 flex-1 rounded-md border border-line bg-surface-2/60 px-2 text-[12px] text-ink-1 outline-none placeholder:text-ink-3 focus:border-lamp-text"
              value={o.prompt ?? ''}
              placeholder="选填"
              onChange={(e) => set({ prompt: e.target.value })}
              onKeyDown={(e) => {
                if (e.key !== 'Enter' || composing(e) || e.repeat) return
                e.preventDefault()
                go.current?.click()
              }}
              data-testid="tool-colorize-prompt"
            />
          </OptRow>
          <DefryOpt label="强度" value={o.defry ?? 0} onChange={(v) => set({ defry: v })} testId="tool-colorize-defry" />
        </div>
      )}
      {action === 'emotion' && (
        <div className="flex flex-col gap-1">
          <OptRow label="表情">
            <Select value={o.emotion} onValueChange={(v) => set({ emotion: v as Emotion })}>
              <SelectTrigger size="sm" className="h-7 flex-1 text-[12px]" data-testid="tool-emotion-pick">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="max-h-72">
                {EMOTIONS.map(([id, zh]) => (
                  <SelectItem key={id} value={id} className="text-[12px]">
                    {zh}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </OptRow>
          <DefryOpt label="程度" value={o.defry ?? 0} onChange={(v) => set({ defry: v })} testId="tool-emotion-defry" />
        </div>
      )}
      {action === 'declutter' && (
        <label className="flex cursor-pointer items-center gap-2 text-[12px] text-ink-1">
          <Checkbox checked={!!o.keepBubbles} onCheckedChange={(v) => set({ keepBubbles: v === true })} data-testid="tool-declutter-keep" />
          保留对话框
        </label>
      )}
    </SpendConfirm>
  )
}

function OptRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-h-[30px] min-w-0 items-center gap-2 text-[12px]">
      <span className="w-[44px] shrink-0 text-ink-2">{label}</span>
      {children}
    </div>
  )
}

function SliderOpt({ label, value, min, max, step, onChange, testId }: { label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void; testId: string }) {
  return (
    <OptRow label={label}>
      <SliderSteps className={SLIDER} value={value} min={min} max={max} step={step} onChange={(v) => onChange(Math.round(v * 100) / 100)} label={label} testId={testId} />
      <span className="w-8 shrink-0 text-right text-ink-1 tabular-nums">{value.toFixed(2)}</span>
    </OptRow>
  )
}

function DefryOpt({ label, value, onChange, testId }: { label: string; value: number; onChange: (v: number) => void; testId: string }) {
  return (
    <OptRow label={label}>
      <SliderSteps className={SLIDER} value={value} min={0} max={5} step={1} onChange={onChange} label={label} testId={testId} />
      <span className="w-8 shrink-0 text-right text-ink-1">{DEFRY_LABELS[value]}</span>
    </OptRow>
  )
}
