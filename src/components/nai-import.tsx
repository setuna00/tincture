import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react'
import { toast } from 'sonner'
import { FileImportIcon, ImageUpload01Icon } from '@hugeicons/core-free-icons'
import { PAGES } from '@/components/app-rail'
import { ChipFace, chipAttrs } from '@/components/editor/chip-face'
import { QUALITY_LABEL, UC_LABEL, sectionTint, sectionVars } from '@/components/editor/labels'
import { GenderIcon } from '@/components/gender'
import { useGenderOptions } from '@/lib/use-gender-options'
import { Icon } from '@/components/icon'
import { Seg } from '@/components/seg'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tip } from '@/components/tip'
import { genderLabel, takeGender } from '@/lib/gender'
import { parsePrompt, toChip } from '@/lib/nai'
import {
  IMPORT_TYPES,
  SAMPLER_NAMES,
  buildImportedDoc,
  defaultPicks,
  importItems,
  importSections,
  takeNsfw,
  type ImportItem,
  type ImportType,
  type ParsedNaiImage,
} from '@/lib/nai-image'
import { findAiJson } from '@/lib/ai-doc'
import { pasteAiReply, pasteImports, type OpenDialog } from '@/lib/paste-import'
import { NOT_AI_REPLY, importAiFile, importAiText, isJsonFile, useAiImport } from '@/store/ai-import'
import { closeImport, importImageFiles, isImage, useImport, type PendingImport } from '@/store/import'
import { askImageFiles, intakeRefFiles, useIntake } from '@/store/intake'
import { refFilesIn } from '@/store/ref-files'
import { ImageIntake } from '@/components/image-intake'
import { importToGallery } from '@/store/gallery'
import { newDocSettings, usePrefs } from '@/store/prefs'
import { getDocStore, useTabs } from '@/store/tabs'
import { useUi } from '@/store/ui'
import type { Chip } from '@/types'
import { maxCharacters, modelName } from '@/lib/nai-models'

export function NaiImportHost() {
  usePasteImport()
  return (
    <>
      <DropOverlay />
      <ImageIntake />
      <ImportDialog />
    </>
  )
}

function DropOverlay() {
  const [show, setShow] = useState(false)
  const [json, setJson] = useState(false)
  // Vibe files and ZIPs may have no MIME type during browser drag events.
  const [other, setOther] = useState(false)
  const [gallery, setGallery] = useState(false)
  useEffect(() => {
    let depth = 0
    let internal = false
    const external = (e: DragEvent) => !internal && !!e.dataTransfer?.types.includes('Files')
    const owner = () => document.querySelector('[data-own-drop]')
    const onStart = () => void (internal = true)
    const onEnd = () => void (internal = false)
    const onEnter = (e: DragEvent) => {
      if (!external(e) || owner()) return
      depth++
      const items = [...e.dataTransfer!.items].filter((i) => i.kind === 'file')
      setJson(items.some((i) => i.type === 'application/json'))
      setOther(items.length > 0 && !items.some((i) => i.type === 'application/json' || i.type.startsWith('image/')))
      setGallery(onGalleryPage())
      setShow(true)
    }
    const onLeave = (e: DragEvent) => {
      if (!external(e) || owner()) return
      depth = Math.max(0, depth - 1)
      if (!depth) setShow(false)
    }
    const onOver = (e: DragEvent) => {
      if (!external(e)) return
      e.preventDefault()
      const own = owner()
      if (!own) e.dataTransfer!.dropEffect = 'copy'
      else if (!own.contains(e.target as Node)) e.dataTransfer!.dropEffect = 'none'
    }
    const onDrop = (e: DragEvent) => {
      if (!external(e)) return
      e.preventDefault()
      depth = 0
      setShow(false)
      if (owner()) return
      const files = [...e.dataTransfer!.files]
      const refs = refFilesIn(files)
      if (refs.vibes.length || refs.zip) {
        if (openDialog() !== 'none') return
        return void intakeRefFiles(refs.vibes, refs.zip)
      }
      if (files[0] && isJsonFile(files[0])) {
        if (openDialog() === 'other') return
        if (!onEditorPage()) location.hash = '/'
        return void importAiFile(files[0])
      }
      if (onGalleryPage() && openDialog() === 'none') return void importToGallery(files)
      void (useImport.getState().open ? importImageFiles(files) : askImageFiles(files))
    }
    const on = [
      ['dragstart', onStart],
      ['dragend', onEnd],
      ['dragenter', onEnter],
      ['dragleave', onLeave],
      ['dragover', onOver],
      ['drop', onDrop],
    ] as const
    for (const [t, f] of on) window.addEventListener(t, f as EventListener)
    return () => {
      for (const [t, f] of on) window.removeEventListener(t, f as EventListener)
    }
  }, [])
  return (
    <div className="imp-drop" data-show={show ? '' : undefined} aria-hidden data-testid="drop-overlay">
      <div className="imp-drop-card">
        <Icon icon={json || other ? FileImportIcon : ImageUpload01Icon} size={26} className="text-ink-2" />
        <span className="text-[13px] font-semibold text-ink-1">{json ? '松开以导入 AI 的回答' : other ? '松开以导入文件' : gallery ? '松开以导入图库' : '松开以导入图片'}</span>
        <span className="text-[12px] text-ink-2">
          {json ? '先列出改动，选择后应用到当前文档' : other ? 'Vibe Transfer 文件和精准参考 ZIP 将直接加入当前文档' : gallery ? '可一次拖入多张 NAI 图片' : '松开后选择这张图片的用途'}
        </span>
      </div>
    </div>
  )
}

function openDialog(): OpenDialog {
  const n = document.querySelectorAll('[data-slot$=dialog-content][data-state=open]').length
  if (!n) return 'none'
  if (n === 1 && (useImport.getState().open || useIntake.getState().open)) return 'import'
  if (n === 1 && useAiImport.getState().open) return 'ai'
  return 'other'
}

const onGalleryPage = () => location.hash.replace(/^#\/?/, '') === 'gallery'

function onEditorPage() {
  const raw = location.hash.replace(/^#\/?/, '')
  return !PAGES.some((p) => p.id !== 'editor' && p.id === (raw === 'search' ? 'discover' : raw))
}

/** Listen during window bubbling so React paste handlers can consume template images or prompt text first. */
function usePasteImport() {
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const cd = e.clipboardData
      if (!cd) return
      const text = cd.getData('text/plain')
      const dialog = openDialog()
      if (text && pasteAiReply({ handled: e.defaultPrevented, aiReply: !!findAiJson(text), dialog, onEditor: onEditorPage() })) {
        e.preventDefault()
        importAiText(text, '粘贴的回答')
        return
      }
      if (text && !e.defaultPrevented && dialog === 'ai' && !useAiImport.getState().plan) return useAiImport.setState({ error: NOT_AI_REPLY })
      const images = [...cd.files].filter(isImage)
      if (!pasteImports({ handled: e.defaultPrevented, hasText: !!text, images: images.length, dialog })) return
      e.preventDefault()
      void (useImport.getState().open ? importImageFiles(images) : askImageFiles(images))
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [])
}

function ImportDialog() {
  const { pending, open } = useImport()
  return (
    <Dialog open={open && !!pending} onOpenChange={(o) => !o && closeImport()}>
      {pending && <ImportForm key={pending.url} p={pending} />}
    </Dialog>
  )
}

type Items = Record<ImportType, ImportItem[]>
const typeOf = (items: Items, it: ImportItem) => (Object.keys(items) as ImportType[]).find((t) => items[t].includes(it))!

const UC_TINT: CSSProperties = { color: 'oklch(var(--section-tint-l) 0.12 var(--hue-uc))' }
const shortSource = (s: string) => s.replace(/^NovelAI Diffusion\s*/i, '').replace(/\s*[0-9A-F]{8}$/i, '') || s

function ImportForm({ p: { file, url, parsed } }: { p: PendingImport }) {
  const items = useMemo(() => importItems(parsed), [parsed])
  const [picks, setPicks] = useState(() => defaultPicks(parsed))
  const [hover, setHover] = useState<ImportType | null>(null)
  const isStart = useTabs((s) => s.starts.includes(s.activeId))
  const [target, setTarget] = useState<'new' | 'current'>('new')
  const [append, setAppend] = useState(false)
  const exts = useGenderOptions()
  const nsfwOn = usePrefs((p) => p.nsfw !== 'off')
  const leadNsfw = useMemo(() => nsfwOn && takeNsfw(importSections(parsed.prompt)).nsfw, [nsfwOn, parsed])
  const toCurrent = !isStart && target === 'current'
  const contentRef = useRef<HTMLDivElement>(null)

  const toggle = (it: ImportItem, on: boolean) =>
    setPicks((s) => {
      const n = new Set(s)
      if (on) n.add(it)
      else n.delete(it)
      return n
    })
  const typeState = (t: ImportType) => {
    const n = items[t].filter((it) => picks.has(it)).length
    return n === 0 ? false : n === items[t].length ? true : ('indeterminate' as const)
  }
  const toggleType = (t: ImportType) => {
    const on = typeState(t) !== true
    setPicks((s) => {
      const n = new Set(s)
      for (const it of items[t]) if (on) n.add(it)
      else n.delete(it)
      return n
    })
  }
  const itemProps = (it: ImportItem) => ({ on: picks.has(it), hl: hover !== null && hover === typeOf(items, it), onChange: (v: boolean) => toggle(it, v), testId: it })

  const charPicked = items.chars.filter((it) => picks.has(it)).length
  const summary = useSummary(picks, items, toCurrent, append, charPicked)

  const doImport = () => {
    // The dialog remains mounted during fade-out; reject repeat submissions to avoid importing the same data twice.
    if (!picks.size || !useImport.getState().open) return
    const tabs = useTabs.getState()
    const store = toCurrent ? getDocStore(tabs.activeId) : null
    const { doc, dropped } = buildImportedDoc(parsed, picks, { base: store?.getState().doc ?? null, appendChars: append, genders: exts, nsfw: nsfwOn }, newDocSettings())
    useUi.getState().blur()
    if (store) {
      const before = store.getState().doc
      store.getState().replaceDoc(doc)
      // If later edits exist, restore through a new undo step so those edits remain recoverable.
      const undoImport = () => {
        if (store.getState().doc === doc) store.temporal.getState().undo()
        else store.getState().replaceDoc(before)
      }
      toast('已从图片导入到当前文档', { action: { label: '撤销', onClick: undoImport } })
    } else {
      tabs.openInTab(isStart ? tabs.activeId : tabs.newTab(), doc)
    }
    if (dropped) toast(`角色数超出上限（${maxCharacters(doc.settings.model)}），${dropped} 个未导入`)
    if (location.hash.replace(/^#\/?/, '')) location.hash = '/'
    closeImport()
  }
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== 'Enter' || e.nativeEvent.isComposing) return
    const el = e.target as HTMLElement
    if (el.closest('button:not([role=checkbox])')) return
    e.preventDefault()
    doImport()
  }

  const { gen } = parsed
  const charRow = parsed.characters.length > 0

  return (
    <DialogContent
      ref={contentRef}
      className="grid max-h-[calc(100dvh-64px)] w-[900px] max-w-[calc(100%-2rem)] grid-rows-[auto_auto_minmax(0,1fr)_auto] gap-0 overflow-hidden rounded-xl bg-work p-0 text-ink-1 shadow-(--shadow-pop) ring-line sm:max-w-[calc(100%-2rem)]"
      onOpenAutoFocus={(e) => {
        e.preventDefault()
        contentRef.current?.focus()
      }}
      onKeyDown={onKeyDown}
      data-testid="import-dialog"
    >
      <header className="flex items-center gap-2.5 py-3 pr-11 pl-4">
        <DialogTitle className="shrink-0 text-[13px] font-semibold">从图片导入</DialogTitle>
        <Tip label={file.name}>
          <span className="min-w-0 truncate text-[12px] text-ink-2">
            {file.name}
          </span>
        </Tip>
        <DialogDescription className="sr-only">勾选要导入的内容</DialogDescription>
      </header>

      <div>
        <div className="flex flex-wrap items-center gap-1.5 px-4 pb-3" data-testid="import-types">
          <span className="mr-1 text-[12px] text-ink-2">导入内容</span>
          {IMPORT_TYPES.map(({ type, label }) => {
            const st = typeState(type)
            const total = items[type].length
            const n = items[type].filter((it) => picks.has(it)).length
            return (
              <Tip key={type} label={total ? undefined : type === 'settings' ? '仅支持 V4 及以上的参数' : '此图片中无此项'}>
                <label
                  className="imp-type"
                  data-hover={hover === type ? '' : undefined}
                  data-disabled={total ? undefined : ''}
                  onPointerEnter={() => total && setHover(type)}
                  onPointerLeave={() => setHover(null)}
                  data-testid={`import-type-${type}`}
                  data-state={st === 'indeterminate' ? 'mixed' : st ? 'on' : 'off'}
                >
                  <Checkbox checked={st} disabled={!total} onCheckedChange={() => toggleType(type)} />
                  {label}
                  {st === 'indeterminate' && (
                    <span className="text-[11px] text-ink-2">
                      {n}/{total}
                    </span>
                  )}
                </label>
              </Tip>
            )
          })}
        </div>
        {!parsed.v4 && (
          <p className="px-4 pb-2.5 text-[12px] text-ink-2" data-testid="import-not-v5">
            此图片由 {shortSource(parsed.source) || '旧版模型'} 生成：正面、负面、角色按原文导入，参数不导入（质量标签、UC 预设仅支持 V4 及以上的写法）
          </p>
        )}
      </div>

      <ScrollArea className="min-h-0 border-y border-line">
        <div className="grid grid-cols-[224px_minmax(0,1fr)]">
          <aside className="flex flex-col gap-3 border-r border-line bg-shell p-3.5">
            <Thumb url={url} parsed={parsed} />
            <div className="flex flex-col gap-0.5" data-testid="import-params">
              {items.settings.length > 0 && <div className="mt-0.5 mb-1 text-[11px] font-semibold text-ink-2">参数</div>}
              {items.settings.includes('model') && <ParamRow {...itemProps('model')} label="模型" value={parsed.model === 'v5-full' ? `V5 Full · ${parsed.effort === 'medium' ? 'Medium' : 'High'}` : modelName(parsed.model)} />}
              {items.settings.includes('size') && <ParamRow {...itemProps('size')} label="尺寸" value={`${gen.width}×${gen.height}`} mono />}
              {items.settings.includes('steps') && <ParamRow {...itemProps('steps')} label="步数" value={gen.steps} mono />}
              {items.settings.includes('scale') && <ParamRow {...itemProps('scale')} label="引导" value={gen.scale} mono />}
              {items.settings.includes('rescale') && <ParamRow {...itemProps('rescale')} label="Rescale" value={gen.cfgRescale} mono />}
              {items.settings.includes('sampler') && <ParamRow {...itemProps('sampler')} label="采样" value={SAMPLER_NAMES[gen.sampler] ?? gen.sampler} />}
              {items.settings.includes('noise') && <ParamRow {...itemProps('noise')} label="噪声调度" value={parsed.noise} mono />}
              {items.settings.includes('variety') && <ParamRow {...itemProps('variety')} label="Variety+" value={parsed.variety ? '开' : '关'} />}
              {items.seed.length > 0 && <ParamRow {...itemProps('seed')} label="Seed" value={gen.seed} mono />}
            </div>
          </aside>

          <div className="flex min-w-0 flex-col gap-4 px-4 py-3.5">
            <section>
              <div className="mb-2 flex flex-wrap items-center gap-x-3.5 gap-y-1">
                <span className="text-[13px] font-semibold">正面</span>
                <Item {...itemProps('prompt')} label="文本" value={countLabel(parsed.prompt, leadNsfw ? 1 : 0)} />
                {items.settings.includes('mode') && <Item {...itemProps('mode')} label="模式" value={parsed.mode === 'furry' ? 'Furry' : 'Anime'} />}
                {items.settings.includes('quality') && <Item {...itemProps('quality')} label="质量" value={QUALITY_LABEL[parsed.quality] + (parsed.transparent ? ' · 透明背景' : '')} />}
              </div>
              <Dim on={picks.has('prompt')} hl={hover === 'prompt'}>
                <Preview text={parsed.prompt} drop={leadNsfw ? 1 : 0} testId="import-preview-prompt" />
              </Dim>
              {parsed.stripped.mode && <Stripped what="模式 Furry：已从开头移除" text={parsed.stripped.mode} />}
              {leadNsfw && <Stripped what="NSFW：已从开头移除" text="nsfw" />}
              {parsed.stripped.quality && <Stripped what={`质量 ${QUALITY_LABEL[parsed.quality]}${parsed.transparent ? ' · 透明背景' : ''}：已从末尾移除`} text={parsed.stripped.quality} />}
            </section>

            <section>
              <div className="mb-1.5 flex flex-wrap items-center gap-x-3.5 gap-y-1">
                <span className="text-[13px] font-semibold" style={UC_TINT}>
                  负面
                </span>
                <Item {...itemProps('uc')} label="文本" value={countLabel(parsed.uc)} />
                {items.uc.includes('ucPreset') && <Item {...itemProps('ucPreset')} label="UC 预设" value={UC_LABEL[parsed.ucPreset]} />}
              </div>
              {parsed.uc.trim() && (
                <Dim on={picks.has('uc')} hl={hover === 'uc'}>
                  <Preview text={parsed.uc} testId="import-preview-uc" />
                </Dim>
              )}
              {parsed.stripped.uc && <Stripped what={`UC 预设 ${UC_LABEL[parsed.ucPreset]}：已从开头移除`} text={parsed.stripped.uc} />}
            </section>

            {charRow && (
              <section>
                <div className="mb-2 flex flex-wrap items-center gap-x-3.5 gap-y-1">
                  <span className="text-[13px] font-semibold">角色</span>
                  {items.settings.includes('coords') && <Item {...itemProps('coords')} label="位置" value={parsed.useCoords ? 'Custom' : "AI's Choice"} />}
                  {toCurrent && charPicked > 0 && (
                    <Seg value={append ? 'append' : 'replace'} onChange={(v) => setAppend(v === 'append')} options={{ replace: '替换', append: '追加' }} testId="import-append" />
                  )}
                </div>
                <div className="flex flex-col gap-1.5">
                  {parsed.characters.map((ch, i) => {
                    const it = `char:${i}` as const
                    const { on, hl, onChange } = itemProps(it)
                    // NovelAI metadata has no gender field; infer it from leading girl/boy tags and remove the inferred prefix from the preview.
                    const g = takeGender(importSections(ch.prompt), exts)
                    return (
                      <div key={i} className="imp-hl flex items-start gap-2 rounded-lg" data-hl={hl ? '' : undefined} data-testid="import-char">
                        <label className="flex shrink-0 items-center gap-1.5 pt-1.5 pl-0.5">
                          <Checkbox checked={on} onCheckedChange={(v) => onChange(v === true)} data-testid={`import-item-${it}`} />
                          <span className="imp-badge">{i + 1}</span>
                          <GenderIcon gender={g.gender} extra={g.genderExtra} size={14} />
                        </label>
                        <div className="imp-dim flex min-w-0 flex-1 flex-col gap-1" data-off={on ? undefined : ''}>
                          <Preview text={ch.prompt} drop={g.taken.length} />
                          {g.taken.length > 0 && <Stripped what={`性别 ${genderLabel(g)}：已从开头移除`} text={g.taken.join(', ')} />}
                          {ch.uc.trim() && <Preview text={ch.uc} uc />}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </section>
            )}
          </div>
        </div>
      </ScrollArea>

      <footer className="flex items-center gap-2.5 py-2.5 pr-3.5 pl-4">
        {!isStart && (
          <>
            <span className="text-[12px] text-ink-2">导入到</span>
            <Seg value={target} onChange={(v) => setTarget(v as 'new' | 'current')} options={{ new: '新 tab', current: '当前文档' }} testId="import-target" />
          </>
        )}
        <span className="min-w-0 flex-1 truncate text-right text-[12px] text-ink-2" data-testid="import-summary">
          {summary}
        </span>
        <Button variant="outline" size="lg" onClick={closeImport}>
          取消
        </Button>
        <Button size="lg" className="px-3 font-semibold" disabled={!picks.size} onClick={doImport} data-testid="import-submit">
          导入 <span className="font-mono text-[11px] opacity-60">↵</span>
        </Button>
      </footer>
    </DialogContent>
  )
}

function useSummary(picks: Set<ImportItem>, items: Items, toCurrent: boolean, append: boolean, charPicked: number): ReactNode {
  const activeId = useTabs((s) => s.activeId)
  if (!picks.size) return '未勾选任何内容'
  if (!toCurrent) return null
  const doc = getDocStore(activeId).getState().doc
  const parts: ReactNode[] = []
  const blocks = (n: number) => (n ? ` ${n} 个区块` : '')
  if (picks.has('prompt')) parts.push(<b key="p">正面{blocks(doc.base.prompt.length)}</b>)
  if (picks.has('uc')) parts.push(<b key="u">负面{blocks(doc.base.uc.length)}</b>)
  if (picks.has('ucPreset')) parts.push('UC 预设')
  if (charPicked && !append && doc.characters.length) parts.push(<b key="c">{doc.characters.length} 个角色</b>)
  const settings = items.settings.filter((it) => picks.has(it)).length
  if (settings) parts.push(`参数 ${settings} 项`)
  if (picks.has('seed')) parts.push('Seed')
  const out: ReactNode[] = []
  if (parts.length) out.push('将替换：', ...parts.flatMap((x, i) => (i ? [' · ', x] : [x])))
  if (charPicked && append) out.push(out.length ? '；' : '', `追加 ${charPicked} 个角色`)
  return <span className="[&_b]:font-medium [&_b]:text-ink-1">{out}</span>
}

const countLabel = (text: string, drop = 0) => {
  const n = parsePrompt(text).length - drop
  return n ? `${n} 个 tag` : '空'
}

function Item({ on, hl, onChange, label, value, testId, mono }: { on: boolean; hl: boolean; onChange: (v: boolean) => void; label: string; value: ReactNode; testId: string; mono?: boolean }) {
  return (
    <label className="imp-item" data-off={on ? undefined : ''} data-hl={hl ? '' : undefined}>
      <Checkbox checked={on} onCheckedChange={(v) => onChange(v === true)} data-testid={`import-item-${testId}`} />
      <span className="text-ink-2">{label}</span>
      <span className={mono ? 'text-[12px] font-medium' : 'font-medium'}>{value}</span>
    </label>
  )
}

function ParamRow(props: { on: boolean; hl: boolean; onChange: (v: boolean) => void; label: string; value: ReactNode; testId: string; mono?: boolean }) {
  return (
    <label className="imp-item imp-param" data-off={props.on ? undefined : ''} data-hl={props.hl ? '' : undefined}>
      <Checkbox checked={props.on} onCheckedChange={(v) => props.onChange(v === true)} data-testid={`import-item-${props.testId}`} />
      <span className="flex-1 text-ink-2">{props.label}</span>
      <span className={`truncate ${props.mono ? 'text-[12px] font-medium' : 'font-medium'}`}>{props.value}</span>
    </label>
  )
}

function Dim({ on, hl, children }: { on: boolean; hl: boolean; children: ReactNode }) {
  return (
    <div className="imp-hl rounded-lg" data-hl={hl ? '' : undefined}>
      <div className="imp-dim" data-off={on ? undefined : ''}>
        {children}
      </div>
    </div>
  )
}

function Preview({ text, uc, testId, drop = 0 }: { text: string; uc?: boolean; testId?: string; drop?: number }) {
  const chips = useMemo(() => parsePrompt(text).map((c, i): Chip => ({ ...toChip(c), id: `p${i}` })).slice(drop), [text, drop])
  if (!chips.length) return <span className="text-[12px] text-ink-2">（空）</span>
  return (
    <div className="imp-sec" style={sectionVars('slate')} data-testid={testId}>
      <div className="imp-sec-h">
        {uc && <span style={UC_TINT}>负面 ›</span>}
        <i style={{ background: sectionTint('slate') }} />
        <span style={{ color: sectionTint('slate') }}>导入</span>
        <span className="font-normal text-ink-2">{chips.length}</span>
      </div>
      <div className="flex flex-wrap gap-1">
        {chips.map((c) => (
          <span key={c.id} className="chip tpl-chip" {...chipAttrs(c)} data-chip-id={undefined}>
            <ChipFace chip={c} />
          </span>
        ))}
      </div>
    </div>
  )
}

function Stripped({ what, text }: { what: string; text: string }) {
  return (
    <Tip label={`${what} ${text}`}>
      <p className="mt-1.5 truncate text-[11px] text-ink-2" data-testid="import-stripped">
        {what} <s className="decoration-ink-3/60">{text}</s>
      </p>
    </Tip>
  )
}

function Thumb({ url, parsed }: { url: string; parsed: ParsedNaiImage }) {
  const { width: w, height: h } = parsed.gen
  return (
    <div>
      <div className="relative mx-auto overflow-hidden rounded-lg border border-line bg-surface-2" style={{ aspectRatio: `${w} / ${h}`, width: `min(100%, ${Math.round((320 * w) / h)}px)` }}>
        <img src={url} alt="" className="absolute inset-0 size-full object-cover" draggable={false} />
        {parsed.useCoords &&
          parsed.characters.map((c, i) => (
            <span key={i} className="imp-dot" style={{ left: `${c.center.x * 100}%`, top: `${c.center.y * 100}%` }} data-testid="import-dot">
              {i + 1}
            </span>
          ))}
      </div>
      <div className="mt-1.5 flex justify-between text-[11px] text-ink-2">
        <span className="tabular-nums">
          {w} × {h}
        </span>
        <span>{shortSource(parsed.source)}</span>
      </div>
    </div>
  )
}
