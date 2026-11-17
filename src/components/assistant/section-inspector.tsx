import { characterLabel } from '@/lib/character-label'
import { useMemo, useState, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { toast } from 'sonner'
import { Delete02Icon, DicesIcon, FileSyncIcon, FolderLibraryIcon, ToggleOffIcon, ToggleOnIcon } from '@hugeicons/core-free-icons'
import { useDraftField } from '@/components/draft-field'
import { Icon } from '@/components/icon'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { ScrollArea } from '@/components/ui/scroll-area'
import { boxLabel, sectionTint } from '@/components/editor/labels'
import { useSectionOps } from '@/components/editor/section-card'
import { LangText } from '@/components/tag-name'
import { conflictChecker, isNegativeTag } from '@/lib/recommend'
import { lookupTag, npmi } from '@/lib/tagdb'
import { linkState, templateChips } from '@/lib/template-link'
import { matchTemplates, type MatchContext } from '@/lib/template-match'
import { useActions, useDoc, useDocStore } from '@/store/context'
import { applyRandom, lockRandom, rerollRandom } from '@/components/editor/random-ops'
import { CountControl, GenderToggles, MainActions, PopSlider, PopStepper, WeightSeg } from '@/components/gacha/controls'
import { resolveLiveSource, workChars } from '@/components/gacha/data'
import { CharWorks, Scope } from '@/components/gacha/scope'
import { Tip } from '@/components/tip'
import { useArtistData, useArtistPopularity } from '@/lib/artist-db'
import { usePrefs } from '@/store/prefs'
import { useCharWorks } from '@/lib/char-works'
import { popBasis, usesPopularity, type GachaPool } from '@/lib/gacha'
import { charWorksOf, charWorksScope, hasScope, poolOfRule, scopeOfPool, type RandomOp } from '@/lib/random-block'
import { charOfSection, findSection } from '@/store/doc'
import { useLibrary, type SectionTemplate } from '@/store/library'
import { useUi } from '@/store/ui'
import type { RandomRule, Section, SectionColor } from '@/types'
import { SECTION_COLORS } from '@/types'
import { InspectorHeader } from './inspector'
import { SubSection } from './panel'
import { dragId, TemplateRow, useInsertTemplate } from './template-panel'
import { templateSaved } from './template-edit'
import { TemplateImage } from './template-preview'

const MATCH: MatchContext = {
  group: (n) => lookupTag(n)?.group,
  npmi,
  isNegative: (n) => isNegativeTag(n, lookupTag(n)),
  conflicts: (present) => conflictChecker(present, lookupTag),
}

export function SectionInspector() {
  const id = useUi((s) => s.focusSectionId)
  const section = useDoc((s) => (id ? (findSection(s.doc, id)?.section ?? null) : null))
  const where = useDoc((s) => {
    const f = id ? findSection(s.doc, id) : null
    return f ? `${f.box.field}\n${boxLabel(s.doc, f.box)}` : null
  })
  if (!section || !where) return null
  if (section.random) return <RandomInspector key={section.id} section={section} />
  const [field, label] = where.split('\n')
  return (
    <section className="flex h-full min-h-0 flex-col bg-shell" data-testid="section-inspector">
      <InspectorHeader label="选中的区块" onClose={() => useUi.getState().focusSection(null)} testId="section-inspector-close" />
      <ScrollArea className="min-h-0 flex-1">
        <div className="px-3 pt-1 pb-4">
        <Head key={section.id} section={section} where={label} />
        <div className="mt-5 flex flex-col gap-4">
          <Colors section={section} />
          <Ops section={section} />
        </div>
        <div className="my-4 border-t border-line" />
        <Related section={section} negative={field === 'uc'} />
        </div>
      </ScrollArea>
      <Footer section={section} />
    </section>
  )
}

function Head({ section, where, random }: { section: Section; where: string; random?: boolean }) {
  const actions = useActions()
  const active = section.chips.filter((c) => !c.disabled).length
  const field = useDraftField({ value: section.name, enterBlurs: true, onCommit: (name) => name && actions.updateSection(section.id, { name }) })
  return (
    <div className="flex flex-col">
      <div className="-ml-1.5 flex items-center gap-1">
        {random ? (
          <span className="ml-1.5 grid shrink-0" style={{ color: sectionTint(section.color) }}>
            <Icon icon={DicesIcon} size={14} />
          </span>
        ) : (
          <span className="ml-1.5 size-2.5 shrink-0 rounded-full" style={{ background: sectionTint(section.color) }} />
        )}
        <input
          className="min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-1 py-0.5 text-[16px] leading-snug font-semibold text-ink-1 outline-none hover:border-line focus:border-lamp-text focus:bg-surface-2/60"
          {...field.props}
          onKeyDown={(e) => {
            e.stopPropagation()
            field.props.onKeyDown(e)
          }}
          aria-label="区块名"
          data-testid="section-inspector-name"
        />
      </div>
      <p className="mt-1 flex items-center gap-1.5 text-[12px] text-ink-2" data-testid="section-inspector-meta">
        <span>{where}</span>
        {!random && (
          <>
            <span>·</span>
            <span className="tabular-nums">
              {active}
              {active !== section.chips.length && <span className="opacity-60">/{section.chips.length}</span>}
            </span>
            <span>个 tag</span>
          </>
        )}
        {section.muted && <span className="meta-chip ml-auto">未启用 · 不导出</span>}
      </p>
      <Note section={section} />
      {!random && <Source section={section} />}
    </div>
  )
}

export function NoteField({ value, onCommit, label, testId }: { value: string | undefined; onCommit: (note: string | undefined) => void; label: string; testId: string }) {
  const field = useDraftField({ value: value ?? '', multiline: true, select: false, onCommit: (v) => onCommit(v || undefined) })
  return (
    <textarea
      rows={1}
      className="mt-1.5 -ml-1.5 w-[calc(100%+0.375rem)] resize-none rounded-md border border-transparent bg-transparent px-1 py-0.5 text-[13px] leading-[1.55] text-ink-2 transition-colors duration-(--dur-fast) outline-none [field-sizing:content] placeholder:text-ink-3 hover:border-line focus:border-lamp-text focus:bg-surface-2/60 focus:text-ink-1"
      placeholder="添加备注…"
      spellCheck={false}
      {...field.props}
      onKeyDown={(e) => {
        e.stopPropagation()
        field.props.onKeyDown(e)
      }}
      aria-label={label}
      data-testid={testId}
    />
  )
}

function Note({ section }: { section: Section }) {
  const actions = useActions()
  return <NoteField value={section.note} onCommit={(note) => actions.updateSection(section.id, { note })} label="区块备注" testId="section-note" />
}

function Source({ section }: { section: Section }) {
  const templates = useLibrary((s) => s.sectionTemplates)
  const { state, template } = linkState(section, templates)
  return (
    <SourceCard show={!!template && state === 'clean'} imageKey={template?.imageKey} testId="section-source">
      来自模板 <b className="font-medium text-ink-2">{template?.name}</b>
      {template?.folder && <span> · {template.folder}</span>}
    </SourceCard>
  )
}

export function SourceCard({ show, imageKey, testId, children }: { show: boolean; imageKey?: string; testId: string; children: ReactNode }) {
  return (
    <AnimatePresence initial={false}>
      {show && (
        <motion.div
          key="clean"
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ duration: 0.2, ease: [0.2, 0, 0, 1] }}
          className="overflow-hidden"
        >
          <div className="pt-3">
            <div className="overflow-hidden rounded-lg border border-line bg-work" data-testid={testId}>
              {imageKey && <TemplateImage imageKey={imageKey} className="h-[150px] w-full" />}
              <div className="flex items-center px-2.5 py-1.5">
                <span className="min-w-0 truncate text-[12px] text-ink-2">{children}</span>
              </div>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

export function ColorRow({ value, onPick, label, testId, children }: { value: SectionColor; onPick: (c: SectionColor) => void; label: string; testId: string; children?: ReactNode }) {
  return (
    <div className="flex items-start">
      <span className="text-[12px] leading-[18px] font-medium text-ink-2">颜色</span>
      <div className="ml-auto flex flex-col items-end gap-2.5">
        <div className="grid grid-cols-6 gap-x-2 gap-y-2" role="radiogroup" aria-label={label}>
          {(Object.keys(SECTION_COLORS) as SectionColor[]).map((c) => (
            <Tip key={c} label={SECTION_COLORS[c].label}>
              <button
                type="button"
                role="radio"
                aria-checked={c === value}
                aria-label={SECTION_COLORS[c].label}
                className="size-[18px] rounded-full ring-offset-2 ring-offset-shell transition-shadow hover:ring-2 hover:ring-line-strong data-[on]:ring-2 data-[on]:ring-(--c)"
                style={{ background: sectionTint(c), '--c': sectionTint(c) } as React.CSSProperties}
                data-on={c === value ? '' : undefined}
                onClick={() => onPick(c)}
                data-testid={testId}
              />
            </Tip>
          ))}
        </div>
        {children}
      </div>
    </div>
  )
}

function Colors({ section }: { section: Section }) {
  const actions = useActions()
  const char = useDoc((s) => {
    const id = charOfSection(s.doc, section.id)
    return id ? (s.doc.characters.find((c) => c.id === id) ?? null) : null
  })
  return (
    <ColorRow value={section.color} onPick={(c) => actions.updateSection(section.id, { color: c })} label="区块颜色" testId="section-color">
      {char && (
        <label className="flex cursor-pointer items-center gap-1.5 text-[12px] text-ink-2" data-testid="section-inspector-follow">
          <Checkbox
            checked={!section.ownColor}
            onCheckedChange={(on) => (on === true ? actions.followCharacterColor(section.id) : actions.updateSection(section.id, { ownColor: true }))}
          />
          跟随角色「{char.name.trim() || '角色'}」的颜色
          <span className="size-2.5 rounded-full" style={{ background: sectionTint(char.color) }} />
        </label>
      )}
    </ColorRow>
  )
}

function Ops({ section }: { section: Section }) {
  const ops = useSectionOps()
  const actions = useActions()
  const templates = useLibrary((s) => s.sectionTemplates)
  const { state, template } = linkState(section, templates)
  const edited = state === 'edited' && template
  /** Library writes are outside document undo; toast undo must restore both the template and its edited link state. */
  const overwrite = (t: SectionTemplate, keep: boolean) => {
    const old = useLibrary.getState().updateSectionTemplate(t.id, {
      chips: templateChips(section.chips),
      note: section.note || undefined,
      color: section.color,
      imageKey: keep ? t.imageKey : undefined,
    })
    actions.updateSection(section.id, { templateEdited: undefined })
    if (old)
      toast(`已覆盖区块模板「${t.name}」`, {
        action: {
          label: '撤销',
          onClick: () => {
            useLibrary.getState().putSectionTemplate(old)
            actions.updateSection(section.id, { templateEdited: true })
          },
        },
      })
  }
  return (
    <SaveOps
      edited={!!edited}
      cleanName={state === 'clean' ? template?.name : undefined}
      saveLabel={edited ? '保存为新模板' : '保存为区块模板'}
      onSave={() => ops.saveTemplate(section)}
      overwrite={
        edited && (
          <OverwriteButton
            name={template.name}
            imageKey={template.imageKey}
            subject="区块"
            what="区块的 tag、备注、颜色"
            onRun={(keep) => overwrite(template, keep)}
            testId="section-overwrite"
          />
        )
      }
      hint={edited ? `从模板「${template.name}」插入后已修改` : ''}
      testId="section"
    />
  )
}

export function SaveOps({ edited, cleanName, saveLabel, onSave, overwrite, hint, testId }: { edited: boolean; cleanName?: string; saveLabel: string; onSave: () => void; overwrite: ReactNode; hint: string; testId: string }) {
  return (
    <div className="flex flex-col">
      <motion.div key={edited ? 'edited' : 'plain'} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.16 }} className={edited ? 'grid grid-cols-2 gap-2' : 'flex'}>
        <Tip label={cleanName !== undefined ? `与模板「${cleanName}」相同` : undefined}>
          <span className="flex w-full min-w-0">
            <Button variant="outline" className="w-full min-w-0" onClick={onSave} disabled={cleanName !== undefined} data-testid={`${testId}-inspector-save`}>
              <Icon icon={FolderLibraryIcon} size={14} />
              <span className="truncate">{saveLabel}</span>
            </Button>
          </span>
        </Tip>
        {edited && overwrite}
      </motion.div>
      <AnimatePresence initial={false}>
        {edited && (
          <motion.p
            key="hint"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: [0.2, 0, 0, 1] }}
            className="overflow-hidden"
          >
            <span className="block truncate pt-1.5 text-[11px] text-ink-2" data-testid={`${testId}-edited-hint`}>
              {hint}
            </span>
          </motion.p>
        )}
      </AnimatePresence>
    </div>
  )
}

export function OverwriteButton({ name, imageKey, subject, what, onRun, testId }: { name: string; imageKey?: string; subject: string; what: string; onRun: (keepImage: boolean) => void; testId: string }) {
  const [open, setOpen] = useState(false)
  const [keepImage, setKeepImage] = useState(true)
  const run = (keep: boolean) => {
    setOpen(false)
    onRun(keep)
  }
  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o)
        if (o) setKeepImage(true)
      }}
    >
      <PopoverTrigger asChild>
        <Tip label={`用此${subject}覆盖模板「${name}」`}>
          <Button variant="outline" className="w-full min-w-0" data-testid={testId}>
            <Icon icon={FileSyncIcon} size={14} />
            <span className="truncate">覆盖原模板</span>
          </Button>
        </Tip>
      </PopoverTrigger>
      <PopoverContent align="end" className="flex w-64 flex-col gap-3 p-3" data-testid={`${testId}-confirm`}>
        <p className="text-[12px] leading-relaxed text-ink-2">
          用此{what}覆盖模板「<b className="font-medium text-ink-1">{name}</b>」
        </p>
        {imageKey && (
          <label className="flex cursor-pointer items-center gap-2.5">
            <Checkbox checked={keepImage} onCheckedChange={(v) => setKeepImage(v === true)} data-testid={`${testId}-keep-image`} />
            <TemplateImage imageKey={imageKey} className="h-10 w-[30px] shrink-0 rounded-sm" />
            <span className="text-[13px] text-ink-1">保留原配图</span>
          </label>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
            取消
          </Button>
          <Button size="sm" className="font-semibold" onClick={() => run(!!imageKey && keepImage)} data-testid={`${testId}-run`}>
            覆盖
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}

function Related({ section, negative }: { section: Section; negative: boolean }) {
  const templates = useLibrary((s) => s.sectionTemplates)
  const insert = useInsertTemplate()
  const tags = section.chips.map((c) => c.text).join('\n')
  const matches = useMemo(() => matchTemplates(tags ? tags.split('\n') : [], templates, negative, MATCH, 8), [tags, templates, negative])
  return (
    <SubSection id="related-templates" title="相关区块模板" hint={matches.length ? '按本区块的 tag · 点击查看详情' : undefined}>
      {matches.length ? (
        <div className="-mx-1 flex flex-col" data-testid="related-templates">
          {matches.map((m) => (
            <TemplateRow
              key={m.template.id}
              t={m.template}
              depth={0}
              dragId={dragId('rel', m.template.id)}
              onInsert={insert}
              note={<LangText en={`+ ${m.added.join(', ')}`} zh={`+ ${m.added.map((n) => lookupTag(n)?.zh ?? n).join('，')}`} />}
            />
          ))}
        </div>
      ) : (
        <p className="text-[11px] leading-relaxed text-ink-2">
          {section.chips.length ? '暂无相关模板' : '区块中添加 tag 后显示相关模板'}
        </p>
      )}
    </SubSection>
  )
}

function Footer({ section }: { section: Section }) {
  const actions = useActions()
  const ops = useSectionOps()
  return (
    <footer className="flex shrink-0 items-center justify-between border-t border-line px-3 py-2.5">
      <Button variant="outline" onClick={() => actions.updateSection(section.id, { muted: !section.muted })} data-testid="section-inspector-mute">
        <Icon icon={section.muted ? ToggleOnIcon : ToggleOffIcon} size={14} />
        {section.muted ? '启用' : '停用'}
      </Button>
      <Button variant="destructive" onClick={() => ops.remove(section)} data-testid="section-inspector-delete">
        <Icon icon={Delete02Icon} size={14} />
        删除区块
      </Button>
    </footer>
  )
}

const NO_OFF: never[] = []

function RandomInspector({ section }: { section: Section }) {
  const store = useDocStore()
  const rule = section.random!
  useArtistData((s) => s.list)
  useArtistPopularity(usesPopularity(rule.source))
  usePrefs((s) => s.nsfw)
  useCharWorks()
  const where = useDoc((s) => {
    const f = findSection(s.doc, section.id)
    if (!f) return ''
    const field = f.box.field === 'prompt' ? '正面' : '负面'
    if (f.box.kind === 'base') return `${f.box.field === 'prompt' ? '正面 Prompt' : '负面 UC'} · 随机区块`
    const box = f.box
    const c = s.doc.characters.find((c) => c.id === box.charId)
    return `${c ? characterLabel(s.doc, c) : '角色'} · ${field} · 随机区块`
  })
  const scoped = hasScope(rule)
  const isChar = rule.kind === 'char'
  const pool = poolOfRule(rule, resolveLiveSource)
  const view: GachaPool = pool ?? { ...poolOfRule({ ...rule, source: [], sourceTags: [] }, resolveLiveSource)!, source: rule.source, sourceTags: rule.source.map(() => []) }
  const set = (patch: Partial<RandomRule>, key?: string) => store.getState().setRandom(section.id, { rule: { ...rule, ...patch } }, key)
  const run = (op: RandomOp, patch: Partial<RandomRule>) => void applyRandom(store, section.id, op, patch)
  const save = () => {
    const t = useLibrary.getState().saveSectionTemplate({ name: section.name, color: section.color, chips: templateChips(section.chips), ...(section.note ? { note: section.note } : {}) })
    templateSaved(t)
  }
  return (
    <section className="flex h-full min-h-0 flex-col bg-shell" data-testid="random-inspector" data-kind={rule.kind}>
      <InspectorHeader label="选中的随机区块" onClose={() => useUi.getState().focusSection(null)} testId="section-inspector-close" />
      <ScrollArea className="min-h-0 flex-1">
        <div className="px-3 pt-1 pb-4">
          <Head key={section.id} section={section} where={where} random />
          <div className="mt-4 flex flex-col gap-3">
            <MainActions
              label="重抽"
              onRoll={() => void rerollRandom(store, section.id)}
              rollTestId="random-roll"
              rollDisabled={!scoped || !!rule.lockAll}
              locked={!!rule.lockAll}
              onLock={() => lockRandom(store, section.id)}
              lockTestId="random-lock-all"
            />
            <div className="flex flex-col gap-2.5">
              {isChar ? (
                <CharWorks works={charWorksOf(rule)} total={pool ? view.tags.length : null} color={section.color} onChange={(works) => run({ kind: 'range' }, charWorksScope(works, (s) => workChars(s) ?? []))} />
              ) : (
                <PanelRow label="抽几个">
                  <CountControl value={rule.count} size={view.tags.length} onChange={(count) => run({ kind: 'fit' }, { count })} testId="random-count" />
                </PanelRow>
              )}
              <PanelRow
                label="抽法"
                below={
                  <div className="pb-3.5">
                    <PopSlider value={rule.popularity} onChange={(popularity) => set({ popularity }, `rnd-pop:${section.id}`)} basis={popBasis(rule)} testId="random-pop-slider" />
                  </div>
                }
              >
                <PopStepper value={rule.popularity} onChange={(popularity) => set({ popularity })} testId="random-pop" />
              </PanelRow>
              {rule.kind === 'artist' && (
                <PanelRow label="权重">
                  <WeightSeg value={rule.weight ?? 'none'} onChange={(weight) => run({ kind: 'reweigh' }, { weight })} />
                </PanelRow>
              )}
              {isChar && (
                <PanelRow label="性别">
                  <GenderToggles value={rule.genders ?? ['canon']} onChange={(genders) => run({ kind: 'regender' }, { genders })} testId="random-genders" />
                </PanelRow>
              )}
            </div>
          </div>
          {!isChar && (
            <>
              <div className="my-4 border-t border-line" />
              <Scope
                pool={{ ...view, name: section.name }}
                color={section.color}
                off={rule.off ?? NO_OFF}
                onPool={(next) => run({ kind: 'range' }, scopeOfPool(next))}
                onOff={(off) => run({ kind: 'range' }, { off: off.length ? off : undefined })}
                undo={() => store.temporal.getState().undo()}
              />
            </>
          )}
          <div className="my-4 border-t border-line" />
          <div className="flex flex-col gap-4">
            <Colors section={section} />
            <Button variant="outline" className="w-full" onClick={save} data-testid="random-save-template">
              <Icon icon={FolderLibraryIcon} size={14} />
              保存为区块模板
            </Button>
          </div>
        </div>
      </ScrollArea>
      <Footer section={section} />
    </section>
  )
}

function PanelRow({ label, children, below }: { label: string; children: ReactNode; below?: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex min-h-[30px] items-center gap-3">
        <span className="shrink-0 text-[12px] font-medium text-ink-2">{label}</span>
        <div className="ml-auto flex items-center gap-1.5">{children}</div>
      </div>
      {below}
    </div>
  )
}
