import { useEffect, useRef, type ReactNode } from 'react'
import { Add01Icon, ArrowDown01Icon, Download04Icon, MoreHorizontalIcon, PaintBoardIcon } from '@hugeicons/core-free-icons'
import { Anlas, PricePill } from '@/components/anlas'
import { REF_KINDS, REF_META, switchHint } from '@/components/gen/ref-meta'
import { useAfterMenu } from '@/components/after-menu'
import { Icon } from '@/components/icon'
import { Stepper } from '@/components/stepper'
import { Tip } from '@/components/tip'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuShortcut, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Switch } from '@/components/ui/switch'
import { naiModelId } from '@/lib/nai-api'
import { modelName, refModelFor } from '@/lib/nai-models'
import {
  CHARACTER_REF_DESC,
  CHARACTER_REF_LABEL,
  CHARACTER_REF_PRICE,
  CHARACTER_REF_TYPES,
  characterBlocked,
  DEFAULT_NOISE,
  DEFAULT_STRENGTH,
  MAX_CHARACTER_REFS,
  refCost,
  VIBE_ENCODE_PRICE,
  VIBE_EXTRA_PRICE,
  VIBE_FREE,
  vibeBlocked,
  vibeFitsModel,
} from '@/lib/nai-refs'
import { effectiveSettings } from '@/lib/nai-write'
import { cn } from '@/lib/utils'
import { useDoc, useDocStore } from '@/store/context'
import { vibeEncoded } from '@/store/gen'
import { useConnected } from '@/store/nai'
import { loadVibeCodes, putRefImage, useRefUrl, useVibeCodes } from '@/store/ref-images'
import { exportCharacterZip, exportVibe, exportVibeBundle, importCharacterZip, importVibeFiles } from '@/store/ref-files'
import { addReference, useRefFlash, type RefKind } from '@/store/refs'
import type { CharacterRef, CharacterRefType, DocSettings, RefImage, VibeRef } from '@/types'

const TIPS = {
  baseStrength: '值越高，结果与底图差异越大',
  noise: '为底图添加噪点后再生成，可增加细节；过高时画面模糊',
  info: '从参考图提取的内容：低时只取氛围和画风，高时包含构图和物件',
  vibeStrength: '参考图对结果的影响程度',
  charStrength: '参考的程度',
  fidelity: '与参考图的贴近程度：高时保留细节，低时只取大概',
  normalize: '多张时按比例缩小强度，使合计不超过 1',
}

const IMAGE_ACCEPT = 'image/png,image/webp,image/jpeg'
const PICK: Record<RefKind, { accept: string; multiple: boolean; desc: string | null }> = {
  base: { accept: IMAGE_ACCEPT, multiple: false, desc: null },
  vibe: { accept: `${IMAGE_ACCEPT},.naiv4vibe,.naiv4vibebundle`, multiple: true, desc: '图片、.naiv4vibe 或 .naiv4vibebundle，可多选' },
  character: { accept: `${IMAGE_ACCEPT},.zip,application/zip`, multiple: false, desc: '图片或 ZIP' },
}

export function RefImages() {
  const connected = useConnected()
  if (!connected) return null
  return <RefBox />
}

function RefBox() {
  const store = useDocStore()
  const s = useDoc((d) => d.doc.settings)
  const have = useVibeCodes((v) => v.have)
  useEffect(() => void loadVibeCodes(), [])
  const n = (s.baseImage ? 1 : 0) + (s.vibes?.length ?? 0) + (s.characterRefs?.length ?? 0)
  const eff = effectiveSettings(s)
  const cost = refCost(eff, Math.max(1, s.gen.nSamples ?? 1), vibeEncoded(have, naiModelId(eff)))
  const file = useRef<HTMLInputElement>(null)
  const kind = useRef<RefKind>('base')
  const pick = (k: RefKind) => {
    kind.current = k
    const el = file.current
    if (!el) return
    el.accept = PICK[k].accept
    el.multiple = PICK[k].multiple
    el.click()
  }
  const picked = (files: File[]) => {
    const k = kind.current
    if (!files.length) return
    if (k === 'vibe') return void importVibeFiles(store, files)
    if (k === 'character' && !files[0].type.startsWith('image/')) return void importCharacterZip(store, files[0])
    void addReference(store, k, files[0])
  }
  const vibeOff = (s.vibes?.length ?? 0) > 0 ? vibeBlocked(s) : null
  const charOff = (s.characterRefs?.length ?? 0) > 0 ? characterBlocked(s) : null
  return (
    <section className="flex flex-col gap-(--section-gap)" data-testid="box-refs">
      <header className="flex items-center gap-2 pt-1">
        <span className="label-caps">参考图</span>
        <span className="text-[11px] text-ink-2 tabular-nums" data-testid="refs-count">
          {n}
        </span>
        <span className="h-px flex-1 bg-line" />
        <AddMenu settings={s} onPick={pick} />
        <input
          ref={file}
          type="file"
          accept={IMAGE_ACCEPT}
          className="hidden"
          onChange={(e) => {
            const fs = [...(e.target.files ?? [])]
            e.target.value = ''
            picked(fs)
          }}
          data-testid="refs-file"
        />
      </header>
      {n > 0 && (
        <div className="flex flex-wrap items-start gap-x-8 gap-y-4">
          {s.baseImage && (
            <Group kind="base" count={null}>
              <BaseTile img={s.baseImage} />
            </Group>
          )}
          {!!s.vibes?.length && (
            <Group
              kind="vibe"
              count={String(s.vibes.length)}
              off={vibeOff === 'model' ? `${modelName(s.model)} 无法使用 Vibe Transfer` : vibeOff === 'character' ? '有精准参考时无法使用 Vibe Transfer' : null}
              price={cost.encode + cost.extraVibes}
              priceTip={[
                cost.encode > 0 && (
                  <span key="e">
                    {cost.encodeCount} 张需编码，每张 <Anlas n={VIBE_ENCODE_PRICE} className="align-[-2px]" />
                  </span>
                ),
                cost.extraVibes > 0 && (
                  <span key="x">
                    启用超过 {VIBE_FREE} 张时，每多 1 张 <Anlas n={VIBE_EXTRA_PRICE} className="align-[-2px]" />
                  </span>
                ),
              ]}
              action={
                s.vibes.some((v) => v.enabled) && (
                  <ExportButton
                    label={s.vibes.some((v) => !v.enabled) ? '导出为 .naiv4vibebundle（不含停用的）' : '导出为 .naiv4vibebundle'}
                    onClick={() => void exportVibeBundle(store.getState().doc.settings)}
                    testId="refs-vibe-export"
                  />
                )
              }
              footer={<NormalizeToggle />}
            >
              {s.vibes.map((v, i) => (
                <VibeTile key={`${v.image}-${i}`} v={v} i={i} settings={s} encoded={vibeEncoded(have, naiModelId(eff))(v)} />
              ))}
            </Group>
          )}
          {!!s.characterRefs?.length && (
            <Group
              kind="character"
              count={`${s.characterRefs.length}/${MAX_CHARACTER_REFS}`}
              off={charOff ? `${modelName(s.model)} 无法使用精准参考` : null}
              price={cost.characters}
              priceTip={
                <span>
                  每张参考图每生成 1 张图 <Anlas n={CHARACTER_REF_PRICE} className="align-[-2px]" />
                </span>
              }
              action={<ExportButton label="导出为 ZIP" onClick={() => void exportCharacterZip(store.getState().doc.settings)} testId="refs-character-export" />}
            >
              {s.characterRefs.map((c, i) => (
                <CharacterTile key={`${c.image}-${i}`} c={c} i={i} />
              ))}
            </Group>
          )}
        </div>
      )}
    </section>
  )
}

function AddMenu({ settings, onPick }: { settings: DocSettings; onPick: (k: RefKind) => void }) {
  const menu = useAfterMenu()
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="xs" className="text-ink-2" data-testid="refs-add">
          <Icon icon={Add01Icon} size={14} />
          添加
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="w-auto min-w-56"
        onCloseAutoFocus={menu.onCloseAutoFocus}
      >
        {REF_KINDS.map((k) => {
          const to = k === 'base' ? settings.model : refModelFor(settings.model, k)
          const hint = switchHint(modelName(settings.model), modelName(to))
          return (
            <DropdownMenuItem key={k} className="items-start gap-2 py-1.5 whitespace-nowrap" onSelect={() => menu.later(() => onPick(k))} data-testid={`refs-add-${k}`}>
              <Icon icon={REF_META[k].icon} size={14} className="mt-px text-ink-2" />
              <span className="flex flex-col">
                <span className="text-[12px] text-ink-1">{k === 'base' && settings.baseImage ? '替换底图' : REF_META[k].name}</span>
                <span className="text-[12px] text-ink-2">{PICK[k].desc ?? REF_META[k].desc}</span>
              </span>
              {hint && <DropdownMenuShortcut className="mt-px pl-4 text-[12px] tracking-normal text-ink-3">{hint}</DropdownMenuShortcut>}
            </DropdownMenuItem>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function Group({ kind, count, off, price, priceTip, action, footer, children }: {
  kind: RefKind
  count: string | null
  off?: string | null
  price?: number
  priceTip?: ReactNode
  action?: ReactNode
  footer?: ReactNode
  children: ReactNode
}) {
  const box = useRef<HTMLDivElement>(null)
  const flash = useRefFlash((f) => (f.kind === kind ? f.n : 0))
  useEffect(() => {
    const el = box.current
    if (!flash || !el) return
    el.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    el.dataset.flash = ''
    const t = setTimeout(() => delete el.dataset.flash, 1200)
    return () => clearTimeout(t)
  }, [flash])
  return (
    <div ref={box} className="ref-group flex flex-col gap-1.5" data-testid={`refs-${kind}`} data-off={off ? '' : undefined}>
      <div className="flex h-5 items-center gap-1.5 text-[12px] whitespace-nowrap text-ink-1">
        <Icon icon={REF_META[kind].icon} size={14} className="text-ink-2" />
        <span className="font-semibold">{REF_META[kind].name}</span>
        {count && <span className="text-ink-2 tabular-nums">{count}</span>}
        {!off && !!price && (
          <Tip label={<span className="flex flex-col gap-0.5">{priceTip}</span>}>
            <span className="ml-0.5 flex">
              <PricePill n={price} testId={`refs-${kind}-price`} />
            </span>
          </Tip>
        )}
        {action}
      </div>
      {off && (
        <div className="w-0 min-w-full text-[12px] leading-4 text-ink-2" data-testid={`refs-${kind}-off`}>
          {off}
        </div>
      )}
      <div className={cn('flex flex-wrap gap-2.5 transition-opacity duration-200', off && 'opacity-45')}>{children}</div>
      {footer && <div className={cn('transition-opacity duration-200', off && 'opacity-45')}>{footer}</div>}
    </div>
  )
}

function Tile({ img, on, onToggle, onReplace, onRemove, onExport, cost, badge, imageTip, dim, note, children, testId }: {
  img: RefImage
  on?: boolean
  onToggle?: (on: boolean) => void
  onReplace: (b: RefImage) => void
  onRemove: () => void
  onExport?: () => void
  cost?: number
  badge?: { text: string; tip: string }
  imageTip?: string
  dim?: boolean
  note?: string
  children: ReactNode
  testId: string
}) {
  const url = useRefUrl(img.image)
  const file = useRef<HTMLInputElement>(null)
  const menu = useAfterMenu()
  const off = on === false || !!dim
  return (
    <div className="flex w-[124px] flex-col gap-1" data-testid={testId} data-off={off ? '' : undefined}>
      <div className="group/ref relative h-[164px] w-[124px] overflow-hidden rounded-md border border-line bg-surface-2">
        <Tip label={imageTip ?? `${img.width} × ${img.height}`}>
          {url ? (
            <img src={url} alt="" draggable={false} className={cn('size-full object-cover transition-opacity duration-200', off && 'opacity-45')} />
          ) : (
            <span className={cn('grid size-full place-items-center text-ink-3 transition-opacity duration-200', off && 'opacity-45')}>{badge && <Icon icon={PaintBoardIcon} size={28} />}</span>
          )}
        </Tip>
        {badge && (
          <Tip label={badge.tip}>
            <span className="absolute top-1 left-1 rounded-[4px] bg-black/60 px-1.5 text-[11px] leading-[18px] text-white" data-testid="ref-badge">
              {badge.text}
            </span>
          </Tip>
        )}
        {cost != null && (
          <Tip
            label={
              <span>
                需编码，生成时将消耗 <Anlas n={cost} className="align-[-2px]" />
              </span>
            }
          >
            <span className="absolute top-1 left-1 flex">
              <PricePill n={cost} tone="on" testId="ref-cost" />
            </span>
          </Tip>
        )}
        {onToggle && (
          <Tip label={on ? '停用' : '启用'}>
            <span className="absolute top-1 right-1 flex">
              <Switch checked={!!on} onCheckedChange={onToggle} aria-label={on ? '停用' : '启用'} data-testid="ref-enabled" />
            </span>
          </Tip>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="absolute right-1 bottom-1 grid size-6 place-items-center rounded-[4px] bg-black/55 text-white opacity-0 transition-opacity duration-150 outline-none group-hover/ref:opacity-100 hover:bg-black/75 focus-visible:opacity-100 data-[state=open]:opacity-100"
              aria-label="更多"
              data-testid="ref-more"
            >
              <Icon icon={MoreHorizontalIcon} size={16} />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-auto min-w-32" onCloseAutoFocus={menu.onCloseAutoFocus}>
            <DropdownMenuItem onSelect={() => menu.later(() => file.current?.click())} data-testid="ref-replace">
              替换图片
            </DropdownMenuItem>
            {onExport && (
              <DropdownMenuItem className="whitespace-nowrap" onSelect={onExport} data-testid="ref-export">
                导出为 .naiv4vibe
              </DropdownMenuItem>
            )}
            <DropdownMenuItem onSelect={onRemove} data-testid="ref-remove">
              移除
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <input
          ref={file}
          type="file"
          accept="image/png,image/webp,image/jpeg"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0]
            e.target.value = ''
            if (f) void putRefImage(f).then(onReplace)
          }}
        />
      </div>
      <div className={cn('flex flex-col gap-1 transition-opacity duration-200', off && 'opacity-45')}>{children}</div>
      {note && (
        <div className="text-[12px] leading-4 text-ink-2" data-testid="ref-note">
          {note}
        </div>
      )}
    </div>
  )
}

function BaseTile({ img }: { img: RefImage }) {
  const store = useDocStore()
  const g = useDoc((d) => d.doc.settings.gen)
  const set = (patch: { strength?: number; noise?: number }, key: string) => store.getState().updateGen(patch, key)
  return (
    <Tile img={img} onReplace={(b) => store.getState().updateSettings({ baseImage: b })} onRemove={() => store.getState().updateSettings({ baseImage: undefined })} testId="ref-tile">
      <Stepper label="强度" tip={TIPS.baseStrength} value={g.strength ?? DEFAULT_STRENGTH} min={0.01} max={0.99} onChange={(v) => set({ strength: v }, 'ref-base-strength')} testId="ref-base-strength" />
      <Stepper label="噪声" tip={TIPS.noise} value={g.noise ?? DEFAULT_NOISE} min={0} max={0.99} onChange={(v) => set({ noise: v }, 'ref-base-noise')} testId="ref-base-noise" />
    </Tile>
  )
}

function VibeTile({ v, i, settings, encoded }: { v: VibeRef; i: number; settings: DocSettings; encoded: boolean }) {
  const store = useDocStore()
  const update = (patch: Partial<VibeRef>, key?: string) => {
    const list = [...(store.getState().doc.settings.vibes ?? [])]
    list[i] = { ...list[i], ...patch }
    store.getState().updateSettings({ vibes: list }, key)
  }
  const remove = () => store.getState().updateSettings({ vibes: (store.getState().doc.settings.vibes ?? []).filter((_, j) => j !== i) })
  const fits = vibeFitsModel(v, settings.model)
  const charged = v.enabled && fits && !vibeBlocked(settings) && !encoded
  const only = !!v.encodedFor
  return (
    <Tile
      img={v}
      on={v.enabled}
      onToggle={(on) => update({ enabled: on })}
      onReplace={(b) => update({ ...b, encodedFor: undefined })}
      onRemove={remove}
      onExport={() => void exportVibe(store.getState().doc.settings, v)}
      cost={charged ? VIBE_ENCODE_PRICE : undefined}
      badge={only ? { text: '仅编码', tip: '只含编码，不含原图，无法重新编码' } : undefined}
      imageTip={only ? '只含编码，不含原图' : undefined}
      dim={only && !fits}
      note={only && !fits ? `仅适用于 ${modelName(v.encodedFor!)}` : undefined}
      testId="ref-tile"
    >
      <Stepper label="信息量" tip={TIPS.info} value={v.informationExtracted} min={0.01} max={1} onChange={(x) => update({ informationExtracted: x }, `ref-vibe-info-${i}`)} disabled={only} testId="ref-vibe-info" />
      <Stepper label="强度" tip={TIPS.vibeStrength} value={v.strength} min={-1} max={1} onChange={(x) => update({ strength: x }, `ref-vibe-strength-${i}`)} testId="ref-vibe-strength" />
    </Tile>
  )
}

function CharacterTile({ c, i }: { c: CharacterRef; i: number }) {
  const store = useDocStore()
  const update = (patch: Partial<CharacterRef>, key?: string) => {
    const list = [...(store.getState().doc.settings.characterRefs ?? [])]
    list[i] = { ...list[i], ...patch }
    store.getState().updateSettings({ characterRefs: list }, key)
  }
  const remove = () => store.getState().updateSettings({ characterRefs: (store.getState().doc.settings.characterRefs ?? []).filter((_, j) => j !== i) })
  return (
    <Tile img={c} on={c.enabled} onToggle={(on) => update({ enabled: on })} onReplace={(b) => update(b)} onRemove={remove} testId="ref-tile">
      <TypeSelect value={c.description} onChange={(d) => update({ description: d })} />
      <Stepper label="强度" tip={TIPS.charStrength} value={c.strength} min={0} max={1} onChange={(x) => update({ strength: x }, `ref-char-strength-${i}`)} testId="ref-char-strength" />
      <Stepper label="Fidelity" tip={TIPS.fidelity} value={c.fidelity} min={0} max={1} onChange={(x) => update({ fidelity: x }, `ref-char-fidelity-${i}`)} testId="ref-char-fidelity" />
    </Tile>
  )
}

function ExportButton({ label, onClick, testId }: { label: string; onClick: () => void; testId: string }) {
  return (
    <Tip label={label}>
      <Button variant="ghost" size="icon-xs" className="ml-0.5 size-[22px] text-ink-2" onClick={onClick} aria-label={label} data-testid={testId}>
        <Icon icon={Download04Icon} size={14} />
      </Button>
    </Tip>
  )
}

/** NovelAI defaults Normalize Reference Strength Values to enabled when the setting is absent. */
function NormalizeToggle() {
  const store = useDocStore()
  const on = useDoc((d) => d.doc.settings.gen.normalizeRefs !== false)
  return (
    <label className="flex h-6 w-fit cursor-pointer items-center gap-1.5 text-[12px] text-ink-1" data-testid="refs-normalize">
      <Checkbox checked={on} onCheckedChange={(v) => store.getState().updateGen({ normalizeRefs: v === true })} data-testid="refs-normalize-check" />
      <Tip label={TIPS.normalize}>
        <span className="cursor-pointer">平衡强度</span>
      </Tip>
    </label>
  )
}

function TypeSelect({ value, onChange }: { value: CharacterRefType; onChange: (v: CharacterRefType) => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex h-6 w-full items-center justify-between rounded-md bg-surface-2 pr-1 pl-2 text-[12px] text-ink-1 outline-none transition-colors duration-150 hover:bg-line focus-visible:ring-2 focus-visible:ring-(--accent-text)"
          data-testid="ref-char-type"
        >
          {CHARACTER_REF_LABEL[value]}
          <Icon icon={ArrowDown01Icon} size={14} className="text-ink-2" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-auto min-w-44">
        <DropdownMenuRadioGroup value={value} onValueChange={(v) => onChange(v as CharacterRefType)}>
          {CHARACTER_REF_TYPES.map((t) => (
            <DropdownMenuRadioItem key={t} value={t} className="whitespace-nowrap" data-testid={`ref-char-type-${t}`}>
              <span className="flex flex-col py-0.5">
                <span className="text-[12px] text-ink-1">{CHARACTER_REF_LABEL[t]}</span>
                <span className="text-[12px] text-ink-2">{CHARACTER_REF_DESC[t]}</span>
              </span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

