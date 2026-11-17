import { characterLabel } from '@/lib/character-label'
import { Fragment, useMemo } from 'react'
import { toast } from 'sonner'
import { Delete02Icon, ToggleOffIcon, ToggleOnIcon } from '@hugeicons/core-free-icons'
import { GenderIcon, GenderSelect } from '@/components/gender'
import { useDraftField } from '@/components/draft-field'
import { Icon } from '@/components/icon'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { useCharacterOps } from '@/components/editor/character-ops'
import { sectionTint } from '@/components/editor/labels'
import { Tip } from '@/components/tip'
import { characterDisplay, knownWorks, relatedCharacters, templateFromCharacter, workSuggestions } from '@/lib/char-template'
import { useCharWorks, WORK_CTX } from '@/lib/char-works'
import { genderTags } from '@/lib/gender'
import { linkState } from '@/lib/template-link'
import { useActions, useDoc } from '@/store/context'
import { useLibrary, type CharacterTemplate } from '@/store/library'
import { useUi } from '@/store/ui'
import type { Character, Section } from '@/types'
import { charDragId, CharacterTemplateRow, useAddCharacter } from './character-library'
import { InspectorHeader } from './inspector'
import { ShowMore, SubSection, useShowMore } from './panel'
import { ColorRow, NoteField, OverwriteButton, SaveOps, SourceCard } from './section-inspector'
import { templateSaved } from './template-edit'
import { WorkPicker } from './work-picker'

export function CharacterInspector() {
  const id = useUi((s) => s.focusCharacterId)
  const c = useDoc((s) => s.doc.characters.find((x) => x.id === id) ?? null)
  const index = useDoc((s) => s.doc.characters.findIndex((x) => x.id === id))
  if (!c) return null
  return (
    <section className="flex h-full min-h-0 flex-col bg-shell" data-testid="character-inspector">
      <InspectorHeader label="选中的角色" onClose={() => useUi.getState().selectCharacter(null)} testId="character-inspector-close" />
      <ScrollArea className="min-h-0 flex-1">
        <div className="px-3 pt-1 pb-4">
          <Head key={c.id} c={c} index={index} />
          <div className="mt-5 flex flex-col gap-4">
            <CharColor c={c} />
            <GenderRow c={c} />
            <Ops c={c} />
          </div>
          <div className="my-4 border-t border-line" />
          <Related c={c} />
        </div>
      </ScrollArea>
      <Footer c={c} />
    </section>
  )
}

function Head({ c, index }: { c: Character; index: number }) {
  const label = useDoc((s) => characterLabel(s.doc, c))
  const actions = useActions()
  const field = useDraftField({ value: c.name, enterBlurs: true, onCommit: (name) => actions.updateCharacter(c.id, { name }) })
  useCharWorks()
  const shown = characterDisplay(c, WORK_CTX)
  return (
    <div className="flex flex-col">
      <div className="-ml-1.5 flex items-center gap-1">
        <GenderIcon gender={c.gender} extra={c.genderExtra} size={14} className="ml-1.5 size-5" />
        <input
          className="min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-1 py-0.5 text-[16px] leading-snug font-semibold text-ink-1 outline-none placeholder:text-ink-3 hover:border-line focus:border-lamp-text focus:bg-surface-2/60"
          placeholder={shown.nameFromTag ? shown.name : label}
          {...field.props}
          onKeyDown={(e) => {
            e.stopPropagation()
            field.props.onKeyDown(e)
          }}
          aria-label="角色名"
          data-testid="character-inspector-name"
        />
        {!c.enabled && <span className="meta-chip shrink-0">未启用 · 不导出</span>}
        <span className="meta-chip shrink-0" data-testid="character-inspector-index">
          角色 {index + 1}
        </span>
      </div>
      <Work c={c} placeholder={shown.workFromTag ? shown.work : undefined} />
      <Composition c={c} />
      <NoteField value={c.note} onCommit={(note) => actions.updateCharacter(c.id, { note })} label="角色备注" testId="character-note" />
      <Source c={c} />
    </div>
  )
}

function Work({ c, placeholder }: { c: Character; placeholder?: string }) {
  const actions = useActions()
  const ready = useCharWorks()
  const templates = useLibrary((s) => s.characterTemplates)
  const chars = useDoc((s) => s.doc.characters)
  const works = useMemo(() => knownWorks(templates, chars), [templates, chars])
  const suggestions = useMemo(() => (ready ? workSuggestions(c, WORK_CTX) : []), [c, ready])
  return (
    <div className="mt-0.5 flex">
      <WorkPicker
        value={c.work?.trim() ?? ''}
        onChange={(work) => actions.updateCharacter(c.id, { work: work || undefined })}
        works={works}
        suggestions={suggestions}
        variant="inline"
        placeholder={placeholder}
        testId="character-work"
      />
    </div>
  )
}

function Composition({ c }: { c: Character }) {
  const go = (s: Section) => {
    useUi.getState().focusSection(s.id)
    document.querySelector(`[data-section-id="${CSS.escape(s.id)}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }
  const row = (label: string, list: Section[]) => (
    <>
      <span className="text-[11px] leading-[22px] text-ink-2">{label}</span>
      {list.length ? (
        <div className="flex flex-wrap gap-1">
          {list.map((s) => (
            <Tip key={s.id} label={`选中区块「${s.name}」${s.muted ? '（未启用）' : ''}`}>
              <button
                type="button"
                className="inline-flex h-[22px] max-w-full items-center gap-1 rounded-md border border-line bg-surface-2 px-[7px] text-[12px] text-ink-1 transition-colors duration-(--dur-fast) hover:border-line-strong hover:bg-surface-3 data-[off]:opacity-55"
                onClick={() => go(s)}
                data-off={s.muted ? '' : undefined}
                data-testid="character-part"
              >
                <span className="size-2 shrink-0 rounded-full" style={{ background: sectionTint(s.color) }} />
                <span className="truncate">{s.name}</span>
                <span className="text-[11px] text-ink-2 tabular-nums">{s.chips.filter((x) => !x.disabled).length}</span>
              </button>
            </Tip>
          ))}
        </div>
      ) : (
        <span className="text-[12px] leading-[22px] text-ink-2">空</span>
      )}
    </>
  )
  return (
    <div className="mt-1.5 grid grid-cols-[auto_1fr] items-start gap-x-2.5 gap-y-1.5" data-testid="character-composition">
      {row('正面', c.prompt)}
      {row('负面', c.uc)}
    </div>
  )
}

function Source({ c }: { c: Character }) {
  const templates = useLibrary((s) => s.characterTemplates)
  const { state, template } = linkState(c, templates)
  return (
    <SourceCard show={!!template && state === 'clean'} imageKey={template?.imageKey} testId="character-source">
      来自角色模板 <b className="font-medium text-ink-2">{template?.name}</b>
      {template?.work && <span> · {template.work}</span>}
    </SourceCard>
  )
}

function CharColor({ c }: { c: Character }) {
  const actions = useActions()
  return (
    <ColorRow value={c.color} onPick={(color) => actions.updateCharacter(c.id, { color })} label="角色颜色" testId="character-inspector-color">
      <span className="text-[11px] text-ink-2">其中的区块默认跟随角色颜色，可单独修改</span>
    </ColorRow>
  )
}

function GenderRow({ c }: { c: Character }) {
  const actions = useActions()
  const tags = genderTags(c)
  return (
    <div className="flex items-start gap-2">
      <span className="shrink-0 text-[12px] leading-6 font-medium text-ink-2">性别</span>
      <div className="ml-auto flex min-w-0 flex-col items-end gap-1.5">
        <GenderSelect value={c} onChange={(v) => actions.updateCharacter(c.id, { gender: v.gender, genderExtra: v.genderExtra })} testId="character-inspector-gender" />
        <span className="text-right text-[11px] text-ink-2" data-testid="character-inspector-gender-hint">
          {tags.length ? (
            <>
              导出时在角色正面最前面添加{' '}
              {tags.map((t, i) => (
                <Fragment key={t}>
                  {i > 0 && ', '}
                  <span className="x-gender font-mono whitespace-nowrap" data-g={c.gender}>
                    {t}
                  </span>
                </Fragment>
              ))}
            </>
          ) : (
            '不添加性别词'
          )}
        </span>
      </div>
    </div>
  )
}

/** Library writes are outside document undo; toast undo must restore both the template and its edited link state. */
function Ops({ c }: { c: Character }) {
  const label = useDoc((s) => characterLabel(s.doc, c))
  const actions = useActions()
  const templates = useLibrary((s) => s.characterTemplates)
  const { state, template } = linkState(c, templates)
  const edited = state === 'edited' && template
  const save = () => {
    const name = label
    const t = useLibrary.getState().saveCharacterTemplate(templateFromCharacter(c, name))
    actions.updateCharacter(c.id, { templateId: t.id, templateEdited: undefined })
    templateSaved(t, 'character')
  }
  const overwrite = (t: CharacterTemplate, keep: boolean) => {
    const { name: _, ...content } = templateFromCharacter(c, t.name)
    const old = useLibrary.getState().updateCharacterTemplate(t.id, { ...content, genderExtra: content.genderExtra, note: c.note || undefined, work: c.work?.trim() || undefined, imageKey: keep ? t.imageKey : undefined })
    actions.updateCharacter(c.id, { templateEdited: undefined })
    if (old)
      toast(`已覆盖角色模板「${t.name}」`, {
        action: {
          label: '撤销',
          onClick: () => {
            useLibrary.getState().putCharacterTemplate(old)
            actions.updateCharacter(c.id, { templateEdited: true })
          },
        },
      })
  }
  return (
    <SaveOps
      edited={!!edited}
      cleanName={state === 'clean' ? template?.name : undefined}
      saveLabel={edited ? '保存为新模板' : '保存为角色模板'}
      onSave={save}
      overwrite={
        edited && <OverwriteButton name={template.name} imageKey={template.imageKey} subject="角色" what="角色的区块、性别、颜色、备注" onRun={(keep) => overwrite(template, keep)} testId="character-overwrite" />
      }
      hint={edited ? `从角色模板「${template.name}」添加后已修改` : ''}
      testId="character"
    />
  )
}

function Related({ c }: { c: Character }) {
  const label = useDoc((s) => characterLabel(s.doc, c))
  const ready = useCharWorks()
  const templates = useLibrary((s) => s.characterTemplates)
  const chars = useDoc((s) => s.doc.characters)
  const add = useAddCharacter()
  const list = useMemo(() => (ready ? relatedCharacters(c, templates, chars, WORK_CTX) : []), [c, templates, chars, ready])
  const { shown, hidden, expand } = useShowMore(list, 8, c.id)
  const name = label
  return (
    <SubSection id="related-characters" title="相关角色" hint={list.length ? `同作品的角色模板 · 单击插入到${name}后面，或拖动到角色区` : undefined}>
      {list.length ? (
        <div className="-mx-1 flex flex-col" data-testid="related-characters">
          {shown.map((r) => (
            <CharacterTemplateRow
              key={r.template.id}
              t={r.template}
              depth={0}
              dragId={charDragId('rel', r.template.id)}
              onAdd={add}
              note={r.why === 'work' ? (r.work ?? '同作品') : '常同时出现'}
              onActivate={() => add(r.template, { after: c.id })}
            />
          ))}
          <div className="px-1 pt-1">
            <ShowMore hidden={hidden} onClick={expand} testId="related-characters-more" />
          </div>
        </div>
      ) : (
        <p className="text-[11px] leading-relaxed text-ink-2" data-testid="related-characters-empty">
          {!ready
            ? '加载中…'
            : templates.length
              ? '暂无同作品的角色模板'
              : '暂无角色模板'}
        </p>
      )}
    </SubSection>
  )
}

function Footer({ c }: { c: Character }) {
  const label = useDoc((s) => characterLabel(s.doc, c))
  const actions = useActions()
  const ops = useCharacterOps()
  return (
    <footer className="flex shrink-0 items-center justify-between border-t border-line px-3 py-2.5">
      <Button variant="outline" onClick={() => actions.updateCharacter(c.id, { enabled: !c.enabled })} data-testid="character-inspector-toggle">
        <Icon icon={c.enabled ? ToggleOffIcon : ToggleOnIcon} size={14} />
        {c.enabled ? '停用' : '启用'}
      </Button>
      <Tip label={`删除「${label}」`}>
        <Button variant="destructive" onClick={() => ops.remove(c)} data-testid="character-inspector-delete">
          <Icon icon={Delete02Icon} size={14} />
          删除角色
        </Button>
      </Tip>
    </footer>
  )
}
