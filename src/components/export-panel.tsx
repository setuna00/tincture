import { characterLabel } from '@/lib/character-label'
import { memo, useEffect, useMemo, useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { ArrowDown01Icon, SidebarRightIcon, Tick02Icon } from '@hugeicons/core-free-icons'
import { usePrefs } from '@/store/prefs'
import { copyText, CopyButton } from '@/components/copy-button'
import { GenderIcon, GenderName } from '@/components/gender'
import { Icon } from '@/components/icon'
import { DupIcon, LengthMeter, OverIcon, TokenNum } from '@/components/length-meter'
import { useMeters, type MeterData } from '@/lib/use-meters'
import { FOOT, MAIN_BUTTON } from '@/components/foot'
import { ParamsCard, ParamsLayer } from '@/components/params-panel'
import { Tip } from '@/components/tip'
import { Button } from '@/components/ui/button'
import { ButtonGroup } from '@/components/ui/button-group'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { exportDoc, type BoxExport, type OutToken } from '@/lib/nai'
import { dupIndex, naiAdditions, normKey, pieceKey, type DupGroup, type Insertion } from '@/lib/nai-length'
import { naiComment, naiImageBlob } from '@/lib/nai-write'
import { GENDER_LABEL } from '@/lib/gender'
import type { Gender, GenderExtra } from '@/types'
import { chipZh } from '@/lib/tagdb'
import { cn } from '@/lib/utils'
import { useDoc, useDocStore } from '@/store/context'

type Mode = 'en' | 'zh' | 'json'

export function CopyPane() {
  const doc = useDoc((s) => s.doc)
  const [mode, setMode] = useState<Mode>('en')
  const enBoxes = useMemo(() => exportDoc(doc), [doc])
  const boxes = useMemo(() => (mode === 'zh' ? exportDoc(doc, { translate: (c) => chipZh(c) }) : enBoxes), [doc, mode, enBoxes])
  const json = useMemo(() => (mode === 'json' ? JSON.stringify(naiComment(doc), null, 2) : ''), [doc, mode])
  const { meters, failed } = useMeters(doc, mode !== 'json')
  const adds = useMemo(() => {
    const a = naiAdditions(doc)
    const place = (key: string, list: Insertion[]) => {
      const toks = enBoxes.find((b) => b.key === key)?.tokens ?? []
      return list.map((x) => ({ ...locate(toks, x.at), text: x.text, label: x.label }))
    }
    return new Map([
      ['base.prompt', place('base.prompt', a.prompt)],
      ['base.uc', place('base.uc', a.uc)],
    ])
  }, [doc, enBoxes])
  const dups = dupIndex(doc)
  const rowProps = (b: BoxExport) => ({
    meter: meters.get(b.key),
    failed,
    adds: adds.get(b.key) ?? NO_ADDS,
    dup: dups.boxes.get(b.key),
  })

  return (
    <>
      <div className="relative flex min-h-0 flex-1 flex-col">
        <div className="flex h-10 shrink-0 items-center gap-1 pr-2 pl-3">
          <Tabs value={mode} onValueChange={(v) => setMode(v as Mode)}>
            <TabsList className="rounded-md p-0.5 group-data-horizontal/tabs:h-6">
              <TabsTrigger value="en" className="rounded-[4px] px-[7px] text-[11px]" data-testid="export-tab-en">
                EN
              </TabsTrigger>
              <TabsTrigger value="zh" className="rounded-[4px] px-[7px] text-[11px]" data-testid="export-tab-zh">
                中文
              </TabsTrigger>
              <TabsTrigger value="json" className="rounded-[4px] px-[7px] text-[11px]" data-testid="export-tab-json">
                JSON
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
        <ScrollArea className="x-scroll min-h-0 flex-1">
          <div key={mode === 'json' ? 'json' : 'cards'} className="page-in">
            {mode === 'json' ? (
              <div className="px-3 pt-1 pb-3">
                <div className="mb-2 flex items-center gap-2">
                  <span className="shrink-0 text-[13px] font-semibold text-ink-1">NAI 元数据</span>
                  <span className="truncate text-[11px] text-ink-2">「复制为 NAI 图」写入的内容</span>
                  <CopyButton text={json} what=" JSON" className="ml-auto" />
                </div>
                <pre className="x-out x-code rounded-md border border-line bg-work p-2.5 text-[11px]" data-testid="export-json">
                  {json}
                </pre>
              </div>
            ) : (
              <div className="flex flex-col gap-2 px-2 pt-0.5 pb-2" data-testid="export-cards">
                {boxes
                  .filter((b) => !b.char)
                  .map((b) => (
                    <div key={b.key} className={CARD}>
                      <ExportRow box={b} zh={mode === 'zh'} {...rowProps(b)} />
                    </div>
                  ))}
                {doc.characters.map((c) => (
                  <CharCard
                    key={c.id}
                    title={characterLabel(doc, { ...c, name: '' })}
                    name={characterLabel(doc, c)}
                    gender={c.gender}
                    genderExtra={c.genderExtra}
                    enabled={c.enabled}
                    rows={boxes.filter((b) => b.char?.id === c.id)}
                    zh={mode === 'zh'}
                    rowProps={rowProps}
                  />
                ))}
              </div>
            )}
          </div>
        </ScrollArea>
        <ParamsLayer />
      </div>
      <footer className={cn(FOOT, 'border-t border-line')} data-testid="copy-footer">
        <ParamsCard />
        <CopySplit text={boxes.map((b) => `# ${b.label}\n${b.text}`).join('\n\n')} />
      </footer>
    </>
  )
}

function CopySplit({ text }: { text: string }) {
  const store = useDocStore()
  const [done, setDone] = useState(false)
  useEffect(() => {
    if (!done) return
    const t = setTimeout(() => setDone(false), 1200)
    return () => clearTimeout(t)
  }, [done])
  const copy = async () => {
    try {
      // Put the asynchronous image promise inside ClipboardItem to preserve user activation in Safari.
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': naiImageBlob(store.getState().doc) })])
      toast.success('已复制 NAI 图', { description: '在 NAI 中按 Ctrl+V，选择 Import Metadata；导入位置和生成参数需勾选 Settings' })
      setDone(true)
    } catch {
      toast.error('复制失败：无剪贴板权限')
    }
  }
  return (
    <ButtonGroup className="w-full">
      <Button className={cn(MAIN_BUTTON, 'min-w-0 flex-1 gap-1.5')} data-done={done ? '' : undefined} onClick={copy} data-testid="copy-nai-image">
        {done && <Icon icon={Tick02Icon} size={16} className="animate-in duration-150 fade-in-0" />}
        {done ? '已复制' : '复制为 NAI 图'}
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button className="h-11 w-10 rounded-md border-l-black/15 px-0" aria-label="更多复制方式" data-testid="copy-more">
            <Icon icon={ArrowDown01Icon} size={16} />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52" data-testid="copy-menu">
          <DropdownMenuItem onSelect={() => void copyText(text, '全部')} data-testid="copy-all">
            复制全部文本（按框分段）
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </ButtonGroup>
  )
}

export function ExportRail({ blocked = false }: { blocked?: boolean }) {
  return (
    <Tip label={blocked ? '窗口过窄，无法展开右栏' : undefined} side="left">
      <button
        type="button"
        className="flex h-full w-full flex-col items-center gap-2 bg-shell pt-2.5 text-ink-2 transition-colors duration-150 hover:bg-surface-2 hover:text-ink-1 aria-disabled:cursor-default aria-disabled:text-ink-3 aria-disabled:hover:bg-shell aria-disabled:hover:text-ink-3"
        onClick={() => !blocked && usePrefs.getState().set({ exportOpen: true })}
        aria-label="展开右栏"
        aria-disabled={blocked || undefined}
        data-testid="export-rail"
      >
        <Icon icon={SidebarRightIcon} size={16} />
        <span className="text-[11px] tracking-[0.3em] [writing-mode:vertical-rl]">图片生成 · 提示词复制</span>
      </button>
    </Tip>
  )
}

const UC_TINT = { color: 'oklch(var(--section-tint-l) 0.12 var(--hue-uc))' }

const CARD = 'overflow-hidden rounded-(--section-radius) border border-line bg-work'

function CharCard({
  title,
  name,
  gender,
  genderExtra,
  enabled,
  rows,
  zh,
  rowProps,
}: {
  title: string
  name: string
  gender: Gender
  genderExtra?: GenderExtra
  enabled: boolean
  rows: BoxExport[]
  zh: boolean
  rowProps: (b: BoxExport) => Omit<RowProps, 'box' | 'zh' | 'divider'>
}) {
  const named = name.trim() && name.trim() !== title ? name.trim() : null
  const head = (
    <>
      <span className="shrink-0 text-[13px] font-semibold text-ink-2 tabular-nums" data-testid="export-char-index">
        {title}
      </span>
      <span className="flex items-center gap-1 self-center">
        <GenderIcon gender={gender} size={14} />
        <GenderName value={{ gender, genderExtra }} />
      </span>
      {named && (
        <span className="truncate text-[13px] font-semibold text-ink-1" data-testid="export-char-name">
          {named}
        </span>
      )}
    </>
  )
  if (!enabled || rows.every((r) => !r.text))
    return (
      <div className={`${CARD} flex items-baseline gap-2 px-3 py-2 data-[off]:opacity-60`} data-off={enabled ? undefined : ''} data-testid="export-char">
        {head}
        <span className="ml-auto shrink-0 text-[12px] text-ink-2" data-testid="export-char-note">
          {enabled ? '正面为空 · 负面为空' : '未启用 · 不导出'}
        </span>
      </div>
    )
  return (
    <section className={CARD} data-testid="export-char">
      <header className="flex items-baseline gap-2 border-b border-line bg-surface-2 px-3 py-2">{head}</header>
      {rows.map((b, i) => (
        <ExportRow key={b.key} box={b} zh={zh} divider={i > 0} {...rowProps(b)} />
      ))}
    </section>
  )
}

type Added = { i: number; off: number; text: string; label: string }
const NO_ADDS: Added[] = []

function locate(tokens: OutToken[], at: number): { i: number; off: number } {
  let acc = 0
  for (let i = 0; i < tokens.length; i++) {
    if (at < acc + tokens[i].t.length) return { i, off: at - acc }
    acc += tokens[i].t.length
  }
  return { i: tokens.length, off: 0 }
}

interface RowProps {
  box: BoxExport
  zh: boolean
  divider?: boolean
  meter?: MeterData
  failed: boolean
  adds: Added[]
  dup?: { groups: DupGroup[]; keys: Set<string> }
}

const rowSig = (p: RowProps) =>
  [
    p.box.text,
    p.box.label,
    p.zh,
    p.divider,
    p.failed,
    p.meter ? `${p.meter.own}/${p.meter.total}/${p.meter.limit}/${p.meter.parts.map((x) => `${x.name}:${x.color}:${x.n}`).join(',')}/${p.meter.others.map((x) => `${x.name}:${x.n}`).join(',')}` : '',
    p.adds.map((a) => `${a.i}:${a.off}:${a.text}:${a.label}`).join('|'),
    p.dup?.groups.map((g) => `${g.key}:${g.places.join(',')}`).join('|') ?? '',
  ].join('\u0000')

const ExportRow = memo(ExportRowImpl, (a, b) => rowSig(a) === rowSig(b))

function ExportRowImpl({ box, zh, divider, meter, failed, adds, dup }: RowProps) {
  const label = (
    <span className="truncate text-[13px] font-semibold" style={box.field === 'uc' ? UC_TINT : { color: 'var(--ink-1)' }} data-testid="export-label">
      {box.char ? (box.field === 'prompt' ? '正面' : '负面') : box.label}
    </span>
  )
  if (!box.text && !adds.length)
    return (
      <div className="flex items-baseline gap-2 px-3 py-2 data-[divider]:border-t data-[divider]:border-line" data-divider={divider ? '' : undefined} data-testid={`export-${box.key}`}>
        {label}
        <span className="text-[12px] text-ink-2" data-testid="export-empty">
          · 空
        </span>
      </div>
    )
  return (
    <div className="px-3 py-2.5 data-[divider]:border-t data-[divider]:border-line" data-divider={divider ? '' : undefined} data-testid={`export-${box.key}`}>
      <div className="mb-1 flex min-h-6 min-w-0 items-center gap-2">
        {label}
        {meter && <TokenNum m={meter} failed={failed} />}
        {meter && <OverIcon m={meter} />}
        <DupIcon groups={dup?.groups} />
        {/* Exclude NovelAI-injected presets from copied text because NovelAI adds them when generating. */}
        {box.text && <CopyButton text={box.text} what={`「${box.label}」`} className="ml-auto" testId="export-copy" />}
      </div>
      {meter && <LengthMeter m={meter} failed={failed} />}
      <div className="x-out" data-testid="export-text" lang={zh ? 'zh' : 'en'}>
        <Tokens tokens={box.tokens} adds={adds} dupKeys={dup?.keys} />
      </div>
    </div>
  )
}

function AddedText({ text, label, dupKeys }: { text: string; label: string; dupKeys?: Set<string> }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="x-add" data-testid="export-added">
          {text.split(/(,\s*)/).map((piece, i) =>
            i % 2 === 0 && dupKeys?.has(pieceKey(piece)) ? (
              <span key={i} className="x-dup">
                {piece}
              </span>
            ) : (
              piece
            ),
          )}
        </span>
      </TooltipTrigger>
      <TooltipContent>{label} · NAI 出图时添加，复制时不包含</TooltipContent>
    </Tooltip>
  )
}

function Tokens({ tokens, adds = NO_ADDS, dupKeys }: { tokens: OutToken[]; adds?: Added[]; dupKeys?: Set<string> }) {
  const out: ReactNode[] = []
  const added = (a: Added) => <AddedText key={`add${adds.indexOf(a)}`} text={a.text} label={a.label} dupKeys={dupKeys} />
  tokens.forEach((t, i) => {
    const here = adds.filter((a) => a.i === i).sort((x, y) => x.off - y.off)
    let from = 0
    here.forEach((a) => {
      const off = Math.min(a.off, t.t.length)
      if (off > from) out.push(tok(`${i}.${from}`, t, t.t.slice(from, off), dupKeys))
      out.push(added(a))
      from = off
    })
    out.push(tok(`${i}.${from}`, t, from ? t.t.slice(from) : t.t, dupKeys))
  })
  adds.filter((a) => a.i >= tokens.length).forEach((a) => out.push(added(a)))
  return <>{out}</>
}

/** Include gender tags when copying character prompts because NovelAI requires them in the character text. */
function GenderTok({ t, text, dup }: { t: Extract<OutToken, { k: 'tag' }>; text: string; dup?: boolean }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className={dup ? 'x-gender x-dup' : 'x-gender'} data-g={t.gender} data-testid="export-gender">
          {text}
        </span>
      </TooltipTrigger>
      <TooltipContent>性别 {t.gname ?? GENDER_LABEL[t.gender!]} 自动添加 · 复制时包含</TooltipContent>
    </Tooltip>
  )
}

function NsfwTok({ text, dup }: { text: string; dup?: boolean }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className={dup ? 'x-nsfw x-dup' : 'x-nsfw'} data-testid="export-nsfw">
          {text}
        </span>
      </TooltipTrigger>
      <TooltipContent>NSFW 自动添加 · 复制时包含</TooltipContent>
    </Tooltip>
  )
}

function tok(key: string, t: OutToken, text: string, dupKeys?: Set<string>): ReactNode {
  if (t.k === 'tag' && t.gender) return <GenderTok key={key} t={t} text={text} dup={dupKeys?.has(normKey(t.lit))} />
  if (t.k === 'tag' && t.nsfw) return <NsfwTok key={key} text={text} dup={dupKeys?.has(normKey(t.lit))} />
  if (t.k === 'sep')
    return (
      <span key={key} className="x-sep">
        {text}
      </span>
    )
  if (t.k === 'open' || t.k === 'close')
    return (
      <span key={key} className={t.neg ? 'x-neg' : 'x-weight'}>
        {text}
      </span>
    )
  const whole = text === t.t
  const dup = whole && t.type !== 'textrender' && dupKeys?.has(normKey(t.lit))
  let body: ReactNode = text
  if (whole && (t.type === 'artist' || t.type === 'interaction' || t.type === 'meta' || t.type === 'year' || t.type === 'textrender')) {
    const m = t.t.match(/^(artist:|meta:|year |source#|target#|mutual#|Text: )(.*)$/s)
    if (m)
      body = (
        <>
          <span className="x-prefix">{m[1]}</span>
          {m[2]}
        </>
      )
  }
  return dup ? (
    <span key={key} className="x-dup" data-testid="export-dup-tag">
      {body}
    </span>
  ) : (
    <span key={key}>{body}</span>
  )
}
