import { useMemo, useState, type ReactNode } from 'react'
import { Book02Icon, BookOpen02Icon, BookPlusIcon, Delete02Icon, Folder01Icon, FolderAddIcon, FolderExportIcon, FolderOpenIcon, Layers01Icon, PencilEdit02Icon, UserMultipleIcon } from '@hugeicons/core-free-icons'
import { GenderIcon } from '@/components/gender'
import { Icon } from '@/components/icon'
import { Button } from '@/components/ui/button'
import { Command, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { ScrollArea } from '@/components/ui/scroll-area'
import { sectionTint } from '@/components/editor/labels'
import { PaneHeader } from '@/components/assistant/panel'
import { openTemplateEdit, normFolder } from '@/components/assistant/template-edit'
import { CharacterSections, charTemplateCounts, TemplateChips, TemplateImage } from '@/components/assistant/template-preview'
import { folderPaths, parentPath, workNames } from '@/lib/library-ops'
import type { CharacterTemplate, SectionTemplate } from '@/store/library'
import { deleteNode, deleteTemplates, moveTemplates } from './ops'
import { isGroupNode, kindOf, nodeLabel, pathOf, useLibPage, type Kind } from './state'

export function LibraryDetail({ sections, chars }: { sections: SectionTemplate[]; chars: CharacterTemplate[] }) {
  const node = useLibPage((s) => s.node)
  const selected = useLibPage((s) => s.selected)
  const kind = kindOf(node)
  const picked = kind === 's' ? sections.filter((t) => selected.includes(t.id)) : chars.filter((t) => selected.includes(t.id))
  const n = picked.length
  const what = kind === 's' ? '区块模板' : '角色模板'
  const title = n || pathOf(node) === '' ? what : kind === 's' ? '目录' : '作品'
  const key = n ? picked.map((t) => t.id).join() : node
  return (
    <aside className="flex w-(--lib-detail-w) shrink-0 flex-col border-l border-line bg-shell" data-testid="lib-detail">
      <PaneHeader title={title} corner />
      <ScrollArea className="min-h-0 flex-1">
        <div key={key} className="page-in flex flex-col gap-3 p-4" data-testid="lib-detail-body" data-state={n > 1 ? 'multi' : n ? 'single' : 'node'}>
          {n === 1 ? (
            kind === 's' ? (
              <SectionInfo t={picked[0] as SectionTemplate} />
            ) : (
              <CharInfo t={picked[0] as CharacterTemplate} />
            )
          ) : n > 1 ? (
            <Multi kind={kind} picked={picked} />
          ) : (
            <NodeInfo node={node} sections={sections} chars={chars} />
          )}
        </div>
      </ScrollArea>
      <Footer kind={kind} node={node} ids={picked.map((t) => t.id)} sections={sections} chars={chars} />
    </aside>
  )
}

function Title({ mark, name, meta }: { mark: ReactNode; name: string; meta: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="flex min-w-0 items-center gap-1.5">
        {mark}
        <span className="text-[16px] leading-6 font-semibold break-words text-ink-1" data-testid="lib-detail-name">
          {name}
        </span>
      </span>
      <span className="flex items-center gap-1 text-[12px] text-ink-2">{meta}</span>
    </div>
  )
}

function SectionInfo({ t }: { t: SectionTemplate }) {
  return (
    <>
      {t.imageKey && <TemplateImage imageKey={t.imageKey} className="w-full rounded-md" style={{ height: 170 }} />}
      <Title
        mark={<span className="size-2.5 shrink-0 rounded-full" style={{ background: sectionTint(t.color) }} />}
        name={t.name}
        meta={
          <>
            <Icon icon={Folder01Icon} size={14} />
            {t.folder || '根目录'} · {t.chips.length} 个 tag
          </>
        }
      />
      {t.note && <p className="text-[13px] leading-[1.55] whitespace-pre-wrap text-ink-2">{t.note}</p>}
      <TemplateChips t={t} />
    </>
  )
}

function CharInfo({ t }: { t: CharacterTemplate }) {
  return (
    <>
      {t.imageKey && <TemplateImage imageKey={t.imageKey} className="w-full rounded-md" style={{ height: 170 }} />}
      <Title
        mark={<GenderIcon gender={t.gender} extra={t.genderExtra} size={14} />}
        name={t.name}
        meta={
          <>
            <Icon icon={Book02Icon} size={14} />
            {t.work?.trim() || '无所属作品'} · {charTemplateCounts(t)}
          </>
        }
      />
      {t.note && <p className="text-[13px] leading-[1.55] whitespace-pre-wrap text-ink-2">{t.note}</p>}
      <CharacterSections t={t} />
    </>
  )
}

function Multi({ kind, picked }: { kind: Kind; picked: (SectionTemplate | CharacterTemplate)[] }) {
  return (
    <>
      <span className="text-[16px] font-semibold text-ink-1">
        已选 {picked.length} 个{kind === 's' ? '区块模板' : '角色模板'}
      </span>
      <div className="flex flex-col gap-0.5" data-testid="lib-detail-picked">
        {picked.map((t) => (
          <span key={t.id} className="flex h-7 min-w-0 items-center gap-2 rounded-md bg-surface-2/70 px-2 text-[13px] text-ink-1">
            {'gender' in t ? <GenderIcon gender={t.gender} extra={t.genderExtra} size={14} /> : <span className="size-2 shrink-0 rounded-full" style={{ background: sectionTint(t.color) }} />}
            <span className="truncate">{t.name}</span>
            <span className="ml-auto shrink-0 truncate text-[11px] text-ink-2">{'gender' in t ? t.work?.trim() || '无所属作品' : t.folder || '根目录'}</span>
          </span>
        ))}
      </div>
    </>
  )
}

function NodeInfo({ node, sections, chars }: { node: string; sections: SectionTemplate[]; chars: CharacterTemplate[] }) {
  const kind = kindOf(node)
  const p = pathOf(node)
  const inside = kind === 's' ? sections.filter((t) => (p === '' ? true : p === '∅' ? !t.folder : t.folder === p || t.folder.startsWith(`${p}/`))).length : chars.filter((t) => (p === '' ? true : p === '∅' ? !t.work?.trim() : t.work?.trim() === p)).length
  const subs = kind === 's' && isGroupNode(node) ? folderPaths(sections.map((t) => t.folder)).filter((f) => parentPath(f) === p).length : 0
  const icon = p === '' ? (kind === 's' ? Layers01Icon : UserMultipleIcon) : kind === 's' ? FolderOpenIcon : BookOpen02Icon
  if (p === '') return null
  return (
    <>
      <span className="flex items-center gap-2">
        <Icon icon={icon} size={18} className="text-ink-3" />
        <span className="text-[16px] font-semibold break-all text-ink-1" data-testid="lib-detail-name">
          {nodeLabel(node, true)}
        </span>
      </span>
      <span className="text-[12px] text-ink-2" data-testid="lib-detail-count">
        {inside} 个{kind === 's' ? '区块模板' : '角色模板'}
        {subs ? ` · ${subs} 个子目录` : ''}
      </span>
    </>
  )
}

function Footer({ kind, node, ids, sections, chars }: { kind: Kind; node: string; ids: string[]; sections: SectionTemplate[]; chars: CharacterTemplate[] }) {
  const btn = 'text-[12px]'
  let body: ReactNode = null
  if (ids.length) {
    body = (
      <>
        {ids.length === 1 && (
          <Button variant="outline" size="lg" className={btn} onClick={() => openTemplateEdit(ids[0], kind === 's' ? 'section' : 'character')} data-testid="lib-detail-edit">
            <Icon icon={PencilEdit02Icon} size={14} />
            编辑
          </Button>
        )}
        <MoveButton kind={kind} ids={ids} sections={sections} chars={chars} />
        <Button variant="destructive" size="lg" className={`ml-auto ${btn}`} onClick={() => void deleteTemplates(kind, ids)} data-testid="lib-detail-delete">
          <Icon icon={Delete02Icon} size={14} />
          {ids.length > 1 ? `删除 ${ids.length} 个` : '删除'}
        </Button>
      </>
    )
  } else if (isGroupNode(node)) {
    body = (
      <>
        <Button variant="outline" size="lg" className={btn} onClick={() => useLibPage.getState().set({ renaming: node })} data-testid="lib-detail-rename">
          <Icon icon={PencilEdit02Icon} size={14} />
          重命名
        </Button>
        <Button variant="destructive" size="lg" className={`ml-auto ${btn}`} onClick={() => void deleteNode(node)} data-testid="lib-detail-delete-node">
          <Icon icon={Delete02Icon} size={14} />
          删除{kind === 's' ? '目录' : '作品'}
        </Button>
      </>
    )
  }
  if (!body) return null
  return <footer className="flex items-center gap-2 border-t border-line px-3 py-2.5">{body}</footer>
}

function MoveButton({ kind, ids, sections, chars }: { kind: Kind; ids: string[]; sections: SectionTemplate[]; chars: CharacterTemplate[] }) {
  const open = useLibPage((s) => s.moveOpen)
  const [q, setQ] = useState('')
  const targets = useMemo(() => (kind === 's' ? folderPaths(sections.map((t) => t.folder)) : workNames(chars.map((t) => t.work))), [kind, sections, chars])
  const typed = kind === 's' ? normFolder(q) : q.trim()
  const setOpen = (o: boolean) => {
    useLibPage.getState().set({ moveOpen: o })
    if (!o) setQ('')
  }
  const pick = (target: string) => {
    setOpen(false)
    moveTemplates(kind, ids, target)
  }
  const none = kind === 's' ? '根目录' : '无所属作品'
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="lg" className="text-[12px]" data-testid="lib-detail-move">
          <Icon icon={FolderExportIcon} size={14} />
          移至{ids.length > 1 ? (kind === 's' ? '目录' : '作品') : ''}
        </Button>
      </PopoverTrigger>
      <PopoverContent side="top" align="start" className="w-64 p-0" data-testid="lib-move-menu">
        <Command>
          <CommandInput placeholder={kind === 's' ? '搜索，或输入新名字新建（/ 分层）' : '搜索，或输入新名字新建作品'} value={q} onValueChange={setQ} data-testid="lib-move-search" />
          <CommandList className="max-h-64">
            <CommandGroup heading="移至">
              <CommandItem value={none} onSelect={() => pick('')} data-testid="lib-move-option" data-target="">
                <Icon icon={kind === 's' ? Folder01Icon : Book02Icon} size={14} className="shrink-0 text-ink-2" />
                <span className="text-ink-2">{none}</span>
              </CommandItem>
              {targets.map((t) => (
                <CommandItem key={t} value={t} onSelect={() => pick(t)} data-testid="lib-move-option" data-target={t}>
                  <span className="flex min-w-0 items-center gap-1.5" style={kind === 's' && !q ? { paddingLeft: (t.split('/').length - 1) * 14 } : undefined}>
                    <Icon icon={kind === 's' ? Folder01Icon : Book02Icon} size={14} className="shrink-0 text-ink-2" />
                    <span className="truncate">{kind === 's' && !q ? t.slice(t.lastIndexOf('/') + 1) : t}</span>
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
            {typed && !targets.includes(typed) && (
              <CommandGroup forceMount>
                <CommandItem forceMount value={`新建 ${typed}`} onSelect={() => pick(typed)} data-testid="lib-move-create">
                  <Icon icon={kind === 's' ? FolderAddIcon : BookPlusIcon} size={14} className="shrink-0 text-ink-2" />
                  <span className="truncate">
                    新建{kind === 's' ? '目录' : '作品'}「<b className="font-medium">{typed}</b>」并移入
                  </span>
                </CommandItem>
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
