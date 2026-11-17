import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from 'zustand'
import { ArrowDataTransferHorizontalIcon, ArrowRight01Icon, Cancel01Icon, Delete02Icon, PinIcon, PinOffIcon, Redo02Icon, Search01Icon, Undo02Icon, ViewIcon, ViewOffSlashIcon } from '@hugeicons/core-free-icons'
import { useSelectedLock } from '@/components/editor/random-ops'
import { useDraftField } from '@/components/draft-field'
import { Icon } from '@/components/icon'
import { Button } from '@/components/ui/button'
import { CommandItem } from '@/components/ui/command'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Slider } from '@/components/ui/slider'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { ChipFace, chipAttrs } from '@/components/editor/chip-face'
import { ArtistMedia, CollectionsButton, FavButton, Lightbox } from '@/components/artist-media'
import { useArtistData, useArtistPosts } from '@/lib/artist-db'
import { placeholderStyle, useArtistImage } from '@/lib/artist-images'
import { coverFirstPosts, type RatingMode } from '@/lib/danbooru-core'
import { chipLiteral, clampWeight, NAI_SPECIAL_TAGS, parsePrompt, WEIGHT_STEP, WEIGHT_STEP_COARSE } from '@/lib/nai'
import { useGuesses } from '@/components/editor/guesses'
import { TagSuggest, useTagSuggest } from '@/components/editor/tag-suggest'
import { aliasOf, chipCategory, chipZh, countLabel, lookupTag, relatedTags } from '@/lib/tagdb'
import { useActions, useDoc, useDocStore } from '@/store/context'
import { findChip, findSection } from '@/store/doc'
import { newCollectionInArtistLibrary, openInArtistLibrary } from '@/store/artist-nav'
import { toast } from 'sonner'
import { useLibrary, variantBase } from '@/store/library'
import { usePrefs } from '@/store/prefs'
import { useUi } from '@/store/ui'
import type { Chip, ChipCategory, ChipType, TagEntry } from '@/types'
import { sectionVars } from '@/components/editor/labels'
import { Tip } from '@/components/tip'
import { useSelectedChip } from './focus'
import { AssistCollapse, PaneHeader, ShowMore, SubSection, useShowMore } from './panel'
import { useRenamedCatalog } from './renamed-catalog'
import { TagGloss } from './tag-gloss'
import { PRESETS, weightText } from './weight'

const SLIDER_MIN = -1
const SLIDER_MAX = 3
const ALT_VISIBLE = 8

const CATEGORY_LABEL: Record<ChipCategory, string> = {
  general: '通用',
  artist: '画师',
  copyright: '作品',
  character: '角色',
  meta: '元信息',
  text: '自然语言',
}

export function Inspector() {
  const sel = useSelectedChip()
  const select = useUi((s) => s.select)
  if (!sel) return null
  return (
    <section className="flex h-full min-h-0 flex-col bg-shell" data-testid="inspector-panel">
      <InspectorHeader label="选中的 tag" onClose={() => select(null)} testId="inspector-close" />
      <ScrollArea className="min-h-0 flex-1" data-testid="inspector">
        <div className="px-3 pt-1 pb-4">
          <Selected key={sel.chip.id} chip={sel.chip} />
        </div>
      </ScrollArea>
      <ChipActions chip={sel.chip} />
    </section>
  )
}

export function InspectorHeader({ label, onClose, testId }: { label: string; onClose: () => void; testId: string }) {
  return (
    <PaneHeader title={label}>
      <HistoryButtons />
      <Button variant="ghost" size="icon-xs" className="ml-1 text-ink-2" onClick={onClose} aria-label="取消选中" data-testid={testId}>
        <Icon icon={Cancel01Icon} size={16} />
      </Button>
      <AssistCollapse />
    </PaneHeader>
  )
}

function HistoryButtons() {
  const store = useDocStore()
  const past = useStore(store.temporal, (s) => s.pastStates.length)
  const future = useStore(store.temporal, (s) => s.futureStates.length)
  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="ghost" size="icon-xs" className="text-ink-2" disabled={!past} onClick={() => store.temporal.getState().undo()} aria-label="撤销" data-testid="inspector-undo">
            <Icon icon={Undo02Icon} size={16} />
          </Button>
        </TooltipTrigger>
        <TooltipContent>撤销 Ctrl+Z</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="ghost" size="icon-xs" className="text-ink-2" disabled={!future} onClick={() => store.temporal.getState().redo()} aria-label="重做" data-testid="inspector-redo">
            <Icon icon={Redo02Icon} size={16} />
          </Button>
        </TooltipTrigger>
        <TooltipContent>重做 Ctrl+Shift+Z</TooltipContent>
      </Tooltip>
    </>
  )
}

function Selected({ chip }: { chip: Chip }) {
  const base = useBase(chip)
  // NovelAI treats Text: as rendered text, without tag weights or replacement candidates.
  if (chip.type === 'textrender')
    return (
      <div className="flex flex-col">
        <Title chip={chip} />
        <div className="mt-2.5 flex">
          <span className="meta-chip" data-testid="inspector-category">
            文字渲染
          </span>
        </div>
        <div className="mt-4 flex flex-col gap-1 text-[12px] leading-relaxed text-ink-2" data-testid="inspector-textrender-hint">
          <p>导出时排在此框末尾，不带权重</p>
          <p>双击 chip 编辑：↵ 完成，Shift+↵ 换行</p>
        </div>
      </div>
    )
  return (
    <div className="flex flex-col">
      {chipCategory(chip) === 'artist' ? <ArtistHead chip={chip} /> : <TagHead chip={chip} />}
      <TagGloss chip={chip} base={base} />
      <div className="mt-5">
        <WeightControl chip={chip} />
      </div>
      <div className="my-4 border-t border-line" />
      <Replace chip={chip} />
    </div>
  )
}

function useBase(chip: Chip) {
  const variants = useLibrary((s) => s.variants)
  return variantBase(chip.text, variants, (t) => !!lookupTag(t)) ?? (chip.type === 'tag' || chip.type === 'interaction' ? (aliasOf(chip.text) ?? null) : null)
}

function useAlias(chip: Chip) {
  const variants = useLibrary((s) => s.variants)
  if (chip.type !== 'tag' && chip.type !== 'interaction') return undefined
  return variantBase(chip.text, variants, (t) => !!lookupTag(t)) ? undefined : aliasOf(chip.text)
}

function Title({ chip }: { chip: Chip }) {
  const literal = chipLiteral(chip)
  const prefix = literal.endsWith(chip.text) ? literal.slice(0, literal.length - chip.text.length) : ''
  return (
    <h3 className="text-[16px] leading-snug font-semibold tracking-[-0.005em] break-words whitespace-pre-line text-ink-1 select-text" data-testid="inspector-literal">
      {prefix && <span className="font-mono text-[13px] font-normal text-ink-2">{prefix}</span>}
      {chip.text}
    </h3>
  )
}

function MetaChips({ chip, base, alias, count }: { chip: Chip; base: string | null; alias?: string; count?: string }) {
  const name = base ?? chip.text
  const cat = chipCategory(base ? { ...chip, text: base } : chip)
  const nai = chip.type === 'year' || NAI_SPECIAL_TAGS.has(name) || !!lookupTag(name)?.nai
  const catLabel = chip.type === 'year' ? '年份' : nai ? 'NAI 特殊' : CATEGORY_LABEL[cat]
  const catHint = nai ? 'NAI 专用 tag（质量、美学、复杂度、年份等），非 Danbooru tag' : `Danbooru 类别：${CATEGORY_LABEL[cat]}`
  const official = chip.type === 'year' || !!lookupTag(chip.text)
  const unknown = !official && !base && (chip.type === 'tag' || chip.type === 'interaction')
  const sourceHint = official ? '官方 tag（Danbooru / NAI）' : alias ? `Danbooru 别名，正式写法为「${alias}」` : base ? `「${base}」的自定义写法` : '不在 tag 库中，也不是已保存的自定义写法'
  return (
    <div className="flex items-center gap-1.5">
      {!unknown && (
        <Tip label={catHint}>
          <span className="meta-chip" data-testid="inspector-category">
            {catLabel}
          </span>
        </Tip>
      )}
      <Tip label={sourceHint}>
        <span className="meta-chip" data-testid="inspector-source">
          {official ? '官方' : unknown ? '未识别' : alias ? '别名' : '自定义'}
        </span>
      </Tip>
      {count && (
        <Tip label={count === 'NAI' ? 'NAI 专用 tag，Danbooru 无作品数' : 'Danbooru 作品数'}>
          <span className="ml-auto text-[11px] text-ink-2 tabular-nums">
            {count}
          </span>
        </Tip>
      )}
    </div>
  )
}

function TagHead({ chip }: { chip: Chip }) {
  const base = useBase(chip)
  const alias = useAlias(chip)
  const tag = lookupTag(chip.text)
  const zh = chipZh(chip)
  const baseZh = !zh && base && base !== chip.text ? chipZh({ ...chip, text: base }) : undefined
  return (
    <div className="flex flex-col">
      <div className="tn-stack" data-has-zh={zh ? '' : undefined}>
        <div className="tn-stack-en">
          <Title chip={chip} />
        </div>
        {zh && (
          <p className="tn-stack-zh mt-0.5 text-[13px] leading-snug text-ink-2" data-testid="inspector-zh">
            {zh}
          </p>
        )}
      </div>
      {zh ? null : (
        base &&
        base !== chip.text && (
          <p className="mt-0.5 text-[12px] leading-snug text-ink-2" data-testid="inspector-zh">
            「{base}」{baseZh ? ` ${baseZh}` : ''} 的写法
          </p>
        )
      )}
      <div className="mt-2.5">
        <MetaChips chip={chip} base={base} alias={alias} count={tag ? countLabel(tag) : undefined} />
      </div>
    </div>
  )
}

function useRenamedSwap(chip: Chip) {
  const t = chip.type === 'tag' || chip.type === 'interaction' ? lookupTag(chip.text) : undefined
  const { catalog } = useRenamedCatalog(t?.old === 2)
  return t?.old === 2 ? catalog?.swapTo.get(t.name) : undefined
}

function SwapHint({ chip, to }: { chip: Chip; to?: string }) {
  const actions = useActions()
  const [last, setLast] = useState(to)
  if (to && to !== last) setLast(to)
  const shown = to ?? last
  return (
    <div className="swap-hint" data-on={to ? '' : undefined} inert={!to} data-testid="swap-hint">
      <div className="swap-hint-inner">
        {shown && (
          <div className="flex items-center gap-2 pl-0.5 text-[12px] leading-snug text-ink-2" data-testid="alias-hint">
            <Icon icon={ArrowDataTransferHorizontalIcon} size={14} className="shrink-0 text-ink-2" />
            <span className="min-w-0 flex-1 break-words">
              正式写法 <span className="font-medium text-ink-1">{shown}</span>
            </span>
            <Button size="sm" variant="outline" className="shrink-0" onClick={() => actions.updateChip(chip.id, { text: shown, type: replacedType(chip, lookupTag(shown)) })} data-testid="alias-replace">
              替换为正式写法
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}

function ArtistHead({ chip }: { chip: Chip }) {
  const listed = useArtistData((s) => !!s.list?.index.has(chip.text))
  return listed ? <ListedArtistHead chip={chip} /> : <PlainArtistHead chip={chip} />
}

const ARTIST_MEDIA_W = 272

function ListedArtistHead({ chip }: { chip: Chip }) {
  const name = chip.text
  const mode: RatingMode = usePrefs((s) => s.nsfw !== 'off') ? 'all' : 'sfw'
  const got = useArtistPosts(name, mode, true, 0)
  const posts = Array.isArray(got) ? coverFirstPosts(name, mode, got) : []
  const [zoom, setZoom] = useState<number | null>(null)
  const tag = lookupTag(name)
  const zh = chipZh(chip)
  return (
    <div className="flex flex-col" data-testid="inspector-artist">
      <ArtistMedia name={name} posts={posts.slice(0, 3)} pool={Array.isArray(got) ? got : undefined} loading={got === undefined} failed={got === 'failed'} width={ARTIST_MEDIA_W} onOpen={setZoom} className="rounded-md" />
      <div className="mt-3 flex items-start gap-2">
        <div className="tn-stack min-w-0 flex-1" data-has-zh={zh ? '' : undefined}>
          <div className="tn-stack-en">
            <Title chip={chip} />
          </div>
          {zh && <p className="tn-stack-zh mt-0.5 text-[13px] leading-snug text-ink-2">{zh}</p>}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <FavButton name={name} testId="inspector-artist-star" />
          <CollectionsButton name={name} testId="inspector-artist-collections" onNewCollection={() => newCollectionInArtistLibrary(name)} />
        </div>
      </div>
      <div className="mt-2.5">
        <MetaChips chip={chip} base={null} count={tag ? `${countLabel(tag)} 张作品` : undefined} />
      </div>
      <button
        type="button"
        className="mt-2.5 inline-flex items-center gap-1 self-start text-[12px] text-ink-2 transition-colors duration-(--dur-fast) hover:text-ink-1"
        onClick={() => openInArtistLibrary(name)}
        data-testid="inspector-artist-open"
      >
        在画师库中查看
        <Icon icon={ArrowRight01Icon} size={14} />
      </button>
      {zoom !== null && <Lightbox name={name} posts={posts} start={zoom} onClose={() => setZoom(null)} />}
    </div>
  )
}

function PlainArtistHead({ chip }: { chip: Chip }) {
  const img = useArtistImage(chip.text)
  const tag = lookupTag(chip.text)
  return (
    <div className="flex gap-3">
      {img ? (
        <img src={img} alt={chip.text} className="aspect-[3/4] w-[72px] shrink-0 rounded-md object-cover" data-testid="inspector-artist-image" />
      ) : (
        <div className="grid aspect-[3/4] w-[72px] shrink-0 place-items-end rounded-md p-1.5 text-[11px] font-bold text-white/90" style={placeholderStyle(chip.text)} data-testid="inspector-artist-image">
          {chip.text.slice(0, 2).toUpperCase()}
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="tn-stack" data-has-zh={chipZh(chip) ? '' : undefined}>
          <div className="tn-stack-en">
            <Title chip={chip} />
          </div>
          {chipZh(chip) && <p className="tn-stack-zh mt-0.5 text-[13px] leading-snug text-ink-2">{chipZh(chip)}</p>}
        </div>
        <div className="mt-2.5">
          <MetaChips chip={chip} base={null} />
        </div>
        {tag && <span className="mt-auto pt-2 text-[11px] text-ink-2 tabular-nums">{countLabel(tag)} 张作品</span>}
      </div>
    </div>
  )
}

const pos = (w: number) => ((Math.max(SLIDER_MIN, Math.min(SLIDER_MAX, w)) - SLIDER_MIN) / (SLIDER_MAX - SLIDER_MIN)) * 100

function WeightControl({ chip }: { chip: Chip }) {
  const actions = useActions()
  const w = chip.weight
  const field = useDraftField({
    value: weightText(w),
    onCommit: (t) => {
      const v = Number(t.replace('−', '-'))
      if (t && Number.isFinite(v)) actions.setWeight([chip.id], clampWeight(v))
    },
  })
  const step = (d: number) => {
    field.reset()
    actions.adjustWeight([chip.id], d)
  }
  const from = Math.min(pos(1), pos(w))
  const to = Math.max(pos(1), pos(w))

  return (
    <div className="flex flex-col" data-testid="inspector-weight">
      <div className="flex items-center">
        <span className="text-[12px] font-medium text-ink-2">权重</span>
        <div className="ml-auto flex items-center gap-1">
          <Button variant="outline" size="icon" className="text-[13px] text-ink-2" onClick={() => step(-WEIGHT_STEP)} aria-label="降低权重">
            −
          </Button>
          <input
            className="h-7 w-[60px] rounded-md border border-line bg-surface-2/60 text-center font-mono text-[13px] text-ink-1 tabular-nums outline-none focus:border-lamp-text"
            inputMode="decimal"
            {...field.props}
            onKeyDown={(e) => {
              if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
                e.preventDefault()
                step((e.key === 'ArrowUp' ? 1 : -1) * (e.shiftKey ? WEIGHT_STEP_COARSE : WEIGHT_STEP))
              } else field.props.onKeyDown(e)
            }}
            aria-label="权重数值"
            data-testid="inspector-weight-input"
          />
          <Button variant="outline" size="icon" className="text-[13px] text-ink-2" onClick={() => step(WEIGHT_STEP)} aria-label="提高权重">
            +
          </Button>
        </div>
      </div>

      <div className="relative mt-3 flex h-5 items-center">
        <span className="pointer-events-none absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-line-strong" />
        <span className="pointer-events-none absolute top-1/2 h-1 -translate-y-1/2 rounded-full bg-lamp-text" style={{ left: `${from}%`, width: `${to - from}%` }} data-testid="weight-fill" />
        <span className="pointer-events-none absolute top-1/2 h-3 w-px -translate-y-1/2 bg-ink-3" style={{ left: `${pos(1)}%` }} />
        <Slider
          className="relative z-[1] **:data-[slot=slider-range]:opacity-0 **:data-[slot=slider-thumb]:size-3.5 **:data-[slot=slider-thumb]:rounded-full **:data-[slot=slider-thumb]:border-lamp-text **:data-[slot=slider-thumb]:bg-lamp **:data-[slot=slider-track]:bg-transparent"
          value={[Math.max(SLIDER_MIN, Math.min(SLIDER_MAX, w))]}
          min={SLIDER_MIN}
          max={SLIDER_MAX}
          step={0.05}
          onValueChange={([v]) => {
            field.reset()
            actions.setWeight([chip.id], Math.round(v * 100) / 100, true)
          }}
          onDoubleClick={(e) => {
            if (!(e.target as HTMLElement).closest('[data-slot=slider-thumb]')) return
            field.reset()
            actions.setWeight([chip.id], 1)
          }}
          aria-label="权重滑杆"
          data-testid="weight-slider"
        />
      </div>

      <div className="mt-3 grid grid-cols-6 gap-1" role="group" aria-label="常用权重">
        {PRESETS.map((p) => (
          <button
            key={p}
            type="button"
            className="h-7 rounded-md border border-line font-mono text-[12px] text-ink-2 tabular-nums transition-colors hover:border-line-strong hover:bg-surface-2 hover:text-ink-1 data-[on]:border-lamp-text data-[on]:bg-lamp-text/12 data-[on]:text-lamp-text"
            data-on={w === p ? '' : undefined}
            aria-pressed={w === p}
            aria-label={String(p)}
            onClick={() => {
              field.reset()
              actions.setWeight([chip.id], p)
            }}
            data-testid="weight-preset"
          >
            {p < 0 ? `−${-p}` : p}
          </button>
        ))}
      </div>
    </div>
  )
}

export function replacedType(chip: Chip, tag?: TagEntry): ChipType {
  if (tag?.category === 'artist') return 'artist'
  return chip.type === 'interaction' ? 'interaction' : 'tag'
}

function Replace({ chip }: { chip: Chip }) {
  const actions = useActions()
  const base = useBase(chip)
  const alias = useAlias(chip)
  const renamedSwap = useRenamedSwap(chip)
  const variants = useLibrary((s) => s.variants)
  const addVariant = useLibrary((s) => s.addVariant)
  const [draft, setDraft] = useState('')
  const showAlts = chip.type === 'tag' || chip.type === 'interaction'
  const negative = useDoc((s) => {
    const f = findChip(s.doc, chip.id)
    return !!f && findSection(s.doc, f.section.id)?.box.field === 'uc'
  })
  const present = useDoc((s) => findChip(s.doc, chip.id)?.section.chips.map((c) => c.text).join('\n') ?? '')
  const sectionColor = useDoc((s) => findChip(s.doc, chip.id)?.section.color)
  const guesses = useGuesses(chip.text, showAlts && !base)
  const exclude = useMemo(() => present.split('\n'), [present])
  const related = useMemo(() => {
    if (showAlts && base) return relatedTags(base, 24, { negative, exclude })
    return guesses.filter((t) => !exclude.includes(t.name))
  }, [showAlts, base, negative, exclude, guesses])
  const custom = base ? (variants[base] ?? []) : []
  function removeVariant(base: string, text: string) {
    const lib = useLibrary.getState()
    const index = lib.variants[base]?.indexOf(text) ?? -1
    if (index < 0) return
    lib.removeVariant(base, text)
    toast(`已删除写法「${text}」`, { action: { label: '撤销', onClick: () => lib.restoreVariant(base, text, index) } })
  }
  const replace = (text: string) => actions.updateChip(chip.id, { text, type: replacedType(chip, lookupTag(text)) })
  const rel = useShowMore(related, ALT_VISIBLE, chip.id)
  const cus = useShowMore(custom, ALT_VISIBLE, chip.id)

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <span className="text-[12px] font-medium text-ink-2">替换 tag</span>
        <ReplaceSearch chip={chip} />
        <SwapHint chip={chip} to={alias ?? renamedSwap} />
      </div>

      {showAlts && (
        <SubSection id="related" title={base ? '官方替换候选' : '可能是'} hint={related.length ? (base ? '同档在前 · 点击替换' : '字面相近的官方 tag · 点击替换') : undefined}>
          {related.length ? (
            <div className="flex flex-col items-start gap-1.5" style={sectionColor && sectionVars(sectionColor)}>
              <div className="flex flex-wrap gap-1.5">
                {rel.shown.map((t) => {
                  const c: Chip = { id: t.name, text: t.name, type: 'tag', weight: 1, disabled: false }
                  return (
                    <button key={t.name} type="button" className="chip alt-chip" {...chipAttrs(c)} data-chip-id={undefined} onClick={() => replace(t.name)} data-testid="related-chip">
                      <ChipFace chip={c} />
                    </button>
                  )
                })}
              </div>
              <ShowMore hidden={rel.hidden} onClick={rel.expand} testId="related-more" />
            </div>
          ) : (
            <p className="text-[11px] text-ink-2">{base ? '暂无同组的官方 tag' : '未找到相近的官方 tag'}</p>
          )}
        </SubSection>
      )}

      {showAlts && (
        <SubSection id="custom" title="自定义写法" hint={base ? `「${base}」· 点击替换` : undefined}>
          {base ? (
            <div className="flex flex-col items-start gap-1.5">
              <div className="flex flex-wrap items-center gap-1.5">
                {base !== chip.text && (
                  <button type="button" className="variant-chip" data-official="" onClick={() => replace(base)} data-testid="variant-base">
                    {base}
                    <span className="text-[11px] text-ink-2">官方</span>
                  </button>
                )}
                {cus.shown.map((v) => (
                  <span key={v} className="variant-chip" data-current={v === chip.text ? '' : undefined} data-testid="variant-chip">
                    <button type="button" onClick={() => replace(v)}>
                      {v}
                    </button>
                    <button type="button" className="variant-x" aria-label={`删除写法 ${v}`} onClick={() => removeVariant(base, v)}>
                      ×
                    </button>
                  </span>
                ))}
                <input
                  className="tag-input"
                  placeholder="+ 写法"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && draft.trim()) {
                      addVariant(base, draft)
                      setDraft('')
                    }
                  }}
                  data-testid="variant-input"
                />
              </div>
              <ShowMore hidden={cus.hidden} onClick={cus.expand} testId="custom-more" />
            </div>
          ) : (
            <p className="text-[11px] leading-relaxed text-ink-2">「{chip.text}」不在 tag 库中，也不是官方 tag 的写法</p>
          )}
        </SubSection>
      )}
    </div>
  )
}

const CUSTOM = '自定义：'

function ReplaceSearch({ chip }: { chip: Chip }) {
  const actions = useActions()
  const variants = useLibrary((s) => s.variants)
  const [q, setQ] = useState('')
  const [focused, setFocused] = useState(false)
  const s = useTagSuggest(q, chip.text)
  const inputRef = useRef<HTMLInputElement>(null)
  const query = q.trim()

  const lower = query.toLowerCase()
  const custom = s.searching
    ? Object.entries(variants)
        .flatMap(([base, list]) => list.map((text) => ({ text, base })))
        .filter((h) => h.text !== chip.text && (h.text.toLowerCase().includes(lower) || h.base.toLowerCase().includes(lower)))
        .slice(0, 6)
    : []
  const firstCustom = !s.results.length && custom[0] ? CUSTOM + custom[0].text : ''
  useEffect(() => {
    if (firstCustom) s.setSelected(firstCustom)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firstCustom])

  const done = () => {
    setQ('')
    inputRef.current?.blur()
  }
  const replaceWith = (tag: TagEntry) => {
    actions.updateChip(chip.id, { text: tag.name, type: replacedType(chip, tag) })
    done()
  }
  const replaceCustom = (text: string) => {
    actions.updateChip(chip.id, { text, type: replacedType(chip) })
    done()
  }
  const replaceRaw = () => {
    const p = parsePrompt(query)[0]
    if (!p) return
    actions.updateChip(chip.id, {
      text: p.text,
      type: p.type,
      interaction: p.interaction ?? (p.type === 'interaction' ? chip.interaction : undefined),
      ...(p.type === 'textrender' && { weight: 1 }),
    })
    done()
  }
  const confirm = () => {
    if (!query) return
    if (s.selected.startsWith(CUSTOM)) return replaceCustom(s.selected.slice(CUSTOM.length))
    const fallback = custom[0]?.text
    const apply = (tag: TagEntry | undefined) => (tag ? replaceWith(tag) : fallback ? replaceCustom(fallback) : replaceRaw())
    const r = s.pickLatest()
    if (r instanceof Promise) r.then(apply)
    else apply(r)
  }

  return (
    <TagSuggest
      s={s}
      open={focused}
      onPick={replaceWith}
      extra={custom.map((h) => ({
        value: CUSTOM + h.text,
        node: (
          <CommandItem value={CUSTOM + h.text} onSelect={() => replaceCustom(h.text)} className="gap-2 [&>svg:last-child]:hidden">
            <span className="size-2 shrink-0 rounded-full border border-dashed border-ink-3" />
            <span className="truncate">{h.text}</span>
            <span className="ml-auto shrink-0 rounded bg-surface-2 px-1 text-[11px] text-ink-2">自定义</span>
          </CommandItem>
        ),
      }))}
      hints={
        <>
          <span>↵ 替换</span>
          <span>⇧↵ 保留原文</span>
          <span>权重不变</span>
        </>
      }
      contentClassName="w-(--radix-popover-trigger-width) min-w-64"
      sideOffset={4}
      testId="replace-suggest"
    >
      <div className="flex h-7 items-center gap-1.5 rounded-md border border-line bg-surface-2/60 px-2 focus-within:border-lamp-text">
        <Icon icon={Search01Icon} size={14} className="shrink-0 text-ink-3" />
        <input
          ref={inputRef}
          className="min-w-0 flex-1 bg-transparent text-[12px] text-ink-1 outline-none placeholder:text-ink-3"
          placeholder="搜索官方 / 自定义 tag…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing) return
            if (e.key === 'Enter') {
              e.preventDefault()
              if (e.shiftKey || !s.searching) {
                if (query) replaceRaw()
              } else confirm()
            } else if (e.key === 'Escape') {
              e.stopPropagation()
              done()
            }
          }}
          data-testid="replace-input"
        />
      </div>
    </TagSuggest>
  )
}

function ChipActions({ chip }: { chip: Chip }) {
  const lock = useSelectedLock([chip.id])
  const actions = useActions()
  const select = useUi((s) => s.select)
  return (
    <footer className="@container flex shrink-0 items-center gap-1.5 border-t border-line px-3 py-2.5">
      <Button variant="outline" onClick={() => actions.toggleDisabled([chip.id])} data-testid="inspector-toggle-disabled">
        <Icon icon={chip.disabled ? ViewIcon : ViewOffSlashIcon} size={14} />
        {chip.disabled ? '启用' : '禁用'}
      </Button>
      {lock.visible && (
        <Button variant="outline" onClick={lock.toggle} data-testid="inspector-lock">
          <Icon icon={lock.locked ? PinOffIcon : PinIcon} size={14} />
          <span>
            {lock.locked ? '解锁' : '锁定'}
            <span className="@max-[15.75rem]:hidden">（L）</span>
          </span>
        </Button>
      )}
      <Button
        variant="destructive"
        className="ml-auto"
        onClick={() => {
          actions.removeChips([chip.id])
          select(null)
        }}
        data-testid="inspector-delete"
      >
        <Icon icon={Delete02Icon} size={14} />
        删除
      </Button>
    </footer>
  )
}
