import { useEffect, useMemo, useRef, useState, type ClipboardEvent, type DragEvent } from 'react'
import { toast } from 'sonner'
import { create } from 'zustand'
import { ArrowDown01Icon, Delete02Icon, Exchange01Icon, Folder01Icon, FolderAddIcon, ImageUpload01Icon, Tick02Icon } from '@hugeicons/core-free-icons'
import { GenderSelect } from '@/components/gender'
import { Icon } from '@/components/icon'
import { Button } from '@/components/ui/button'
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { Command, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { knownWorks, templateFromPrompt, workSuggestions } from '@/lib/char-template'
import { useCharWorks, WORK_CTX } from '@/lib/char-works'
import { genderValueOfPrompt, sameGender, type GenderValue } from '@/lib/gender'
import { parsePrompt, toChip } from '@/lib/nai'
import { prepareImage, saveTemplateImage } from '@/lib/template-images'
import { useGenderOptions } from '@/lib/use-gender-options'
import { cn } from '@/lib/utils'
import { nextCharColor } from '@/store/doc'
import { useLibrary, type CharacterTemplate, type SectionTemplate } from '@/store/library'
import { TemplateImage } from './template-preview'
import { WorkPicker } from './work-picker'

type Kind = 'section' | 'character'
interface Draft {
  work: string
  onCreated?: (t: CharacterTemplate) => void
}
const useTemplateEdit = create<{ id: string | null; kind: Kind; draft: Draft | null; n: number }>()(() => ({ id: null, kind: 'section', draft: null, n: 0 }))
export const openTemplateEdit = (id: string, kind: Kind = 'section') => useTemplateEdit.setState((s) => ({ id, kind, draft: null, n: s.n + 1 }))
export const openTemplateCreate = (draft: Draft) => useTemplateEdit.setState((s) => ({ id: null, kind: 'character', draft, n: s.n + 1 }))
export function templateSaved(t: SectionTemplate | CharacterTemplate, kind: Kind = 'section') {
  toast.success(`已保存为${kind === 'character' ? '角色' : '区块'}模板「${t.name}」`, {
    action: { label: '编辑', onClick: () => openTemplateEdit(t.id, kind) },
  })
}
const closeTemplateEdit = () => useTemplateEdit.setState({ id: null, draft: null })

export const normFolder = (s: string) =>
  s
    .split('/')
    .map((p) => p.trim())
    .filter(Boolean)
    .join('/')

type Target = { kind: 'section'; t: SectionTemplate } | { kind: 'character'; t: CharacterTemplate } | { kind: 'new'; draft: Draft }
const subject = (x: Target | null) => (!x ? null : x.kind === 'new' ? x.draft : x.t)
const BLANK: Pick<CharacterTemplate, 'id' | 'name' | 'note' | 'imageKey'> = { id: '', name: '' }

export function TemplateEditDialog() {
  const id = useTemplateEdit((s) => s.id)
  const kind = useTemplateEdit((s) => s.kind)
  const draft = useTemplateEdit((s) => s.draft)
  const n = useTemplateEdit((s) => s.n)
  const section = useLibrary((s) => (id && kind === 'section' ? s.sectionTemplates.find((x) => x.id === id) : undefined))
  const character = useLibrary((s) => (id && kind === 'character' ? s.characterTemplates.find((x) => x.id === id) : undefined))
  const target: Target | null = draft ? { kind: 'new', draft } : section ? { kind: 'section', t: section } : character ? { kind: 'character', t: character } : null
  const [shown, setShown] = useState(target)
  if (target && subject(target) !== subject(shown)) setShown(target)
  return (
    <Dialog open={!!target} onOpenChange={(o) => !o && closeTemplateEdit()}>
      {shown && <EditForm key={n} target={shown} />}
    </Dialog>
  )
}

type Img = { kind: 'keep' } | { kind: 'none' } | { kind: 'new'; blob: Blob; url: string }

function EditForm({ target }: { target: Target }) {
  const isNew = target.kind === 'new'
  const t = target.kind === 'new' ? BLANK : target.t
  const isChar = target.kind !== 'section'
  const [name, setName] = useState(t.name)
  const [folder, setFolder] = useState(target.kind === 'section' ? target.t.folder : target.kind === 'new' ? target.draft.work : (target.t.work ?? ''))
  const [note, setNote] = useState(t.note ?? '')
  const [img, setImg] = useState<Img>(t.imageKey ? { kind: 'keep' } : { kind: 'none' })
  const [gender, setGender] = useState<GenderValue>({ gender: 'other' })
  const [positive, setPositive] = useState('')
  const [negative, setNegative] = useState('')
  const read = useRef<GenderValue>({ gender: 'other' })
  const genderDefs = useGenderOptions()
  const [over, setOver] = useState(false)
  const depth = useRef(0)
  const file = useRef<HTMLInputElement>(null)
  const nameRef = useRef<HTMLInputElement>(null)
  const saving = useRef(false)
  const templates = useLibrary((s) => s.sectionTemplates)
  const characters = useLibrary((s) => s.characterTemplates)
  const charsReady = useCharWorks()
  const works = useMemo(() => knownWorks(characters, []), [characters])
  const draftPrompt = useMemo(() => (isNew ? [{ id: 'd', name: '', color: 'slate' as const, muted: false, chips: parsePrompt(positive).map(toChip) }] : []), [isNew, positive])
  const suggestions = useMemo(
    () => (!charsReady ? [] : target.kind === 'character' ? workSuggestions(target.t, WORK_CTX) : isNew ? workSuggestions({ prompt: draftPrompt }, WORK_CTX) : []),
    [target, isNew, draftPrompt, charsReady],
  )
  const onPositive = (text: string) => {
    setPositive(text)
    const g = genderValueOfPrompt(text, genderDefs)
    if (sameGender(g, read.current)) return
    read.current = g
    if (g.gender !== 'other') setGender(g)
  }
  const folders = useMemo(() => {
    const all = new Set<string>()
    for (const x of templates) {
      const parts = x.folder.split('/').filter(Boolean)
      parts.forEach((_, i) => all.add(parts.slice(0, i + 1).join('/')))
    }
    return [...all].sort((a, b) => a.localeCompare(b, 'zh'))
  }, [templates])

  const newUrl = img.kind === 'new' ? img.url : null
  useEffect(() => () => void (newUrl && URL.revokeObjectURL(newUrl)), [newUrl])

  const take = async (f: File | undefined) => {
    if (!f) return
    if (!f.type.startsWith('image/')) return void toast.error('不是图片文件')
    try {
      const blob = await prepareImage(f)
      setImg({ kind: 'new', blob, url: URL.createObjectURL(blob) })
    } catch {
      toast.error('无法读取此图片')
    }
  }

  const create = async (draft: Draft) => {
    if (saving.current || !name.trim()) return
    saving.current = true
    let imageKey: string | undefined
    try {
      if (img.kind === 'new') imageKey = await saveTemplateImage(img.blob)
    } catch {
      return void toast.error('无法保存配图')
    } finally {
      saving.current = false
    }
    closeTemplateEdit()
    const lib = useLibrary.getState()
    const color = nextCharColor(lib.characterTemplates.map((x) => x.color))
    const tpl = lib.saveCharacterTemplate(templateFromPrompt({ name, gender, positive, negative, color, note, work: folder, imageKey }))
    draft.onCreated?.(tpl)
    toast(`已创建角色模板「${tpl.name}」`, { action: { label: '撤销', onClick: () => useLibrary.getState().removeCharacterTemplate(tpl.id) } })
  }

  const save = async () => {
    if (target.kind === 'new') return create(target.draft)
    if (saving.current) return
    saving.current = true
    let imageKey: string | undefined
    try {
      imageKey = img.kind === 'keep' ? t.imageKey : img.kind === 'none' ? undefined : await saveTemplateImage(img.blob)
    } catch {
      return void toast.error('无法保存配图')
    } finally {
      saving.current = false
    }
    const common = { name: name.trim() || t.name, note: note.trim() || undefined, imageKey }
    closeTemplateEdit()
    if (common.name === t.name && common.note === t.note && common.imageKey === t.imageKey) {
      if (target.kind === 'section' ? folder === target.t.folder : (folder.trim() || undefined) === (target.t.work?.trim() || undefined)) return
    }
    const lib = useLibrary.getState()
    if (target.kind === 'section') {
      const old = lib.updateSectionTemplate(t.id, { ...common, folder })
      if (old) toast(`已保存区块模板「${common.name}」`, { action: { label: '撤销', onClick: () => useLibrary.getState().putSectionTemplate(old) } })
    } else {
      const old = lib.updateCharacterTemplate(t.id, { ...common, work: folder.trim() || undefined })
      if (old) toast(`已保存角色模板「${common.name}」`, { action: { label: '撤销', onClick: () => useLibrary.getState().putCharacterTemplate(old) } })
    }
  }

  const files = (e: DragEvent) => e.dataTransfer.types.includes('Files')
  const drag = {
    onDragEnter: (e: DragEvent) => {
      if (!files(e)) return
      depth.current++
      setOver(true)
    },
    onDragLeave: (e: DragEvent) => {
      if (!files(e)) return
      depth.current = Math.max(0, depth.current - 1)
      if (!depth.current) setOver(false)
    },
    onDragOver: (e: DragEvent) => {
      if (!files(e)) return
      e.preventDefault()
      e.dataTransfer.dropEffect = 'copy'
    },
    onDrop: (e: DragEvent) => {
      if (!files(e)) return
      e.preventDefault()
      depth.current = 0
      setOver(false)
      void take([...e.dataTransfer.files].find((f) => f.type.startsWith('image/')) ?? e.dataTransfer.files[0])
    },
  }
  const onPaste = (e: ClipboardEvent) => {
    const f = [...e.clipboardData.files].find((x) => x.type.startsWith('image/'))
    if (!f) return
    const inText = (e.target as HTMLElement).closest('input, textarea')
    if (inText && e.clipboardData.getData('text/plain')) return
    e.preventDefault()
    void take(f)
  }
  const onKeyDown = (e: React.KeyboardEvent) => {
    e.stopPropagation()
    if (e.defaultPrevented) return
    const field = (e.target as HTMLElement).tagName
    if (e.key === 'Enter' && !e.nativeEvent.isComposing && (field === 'INPUT' || e.ctrlKey || e.metaKey)) {
      e.preventDefault()
      void save()
    }
  }

  const hasImg = img.kind !== 'none'
  return (
    <DialogContent
      className="w-[600px] max-w-[calc(100%-2rem)] gap-0 overflow-hidden rounded-xl bg-work p-0 text-ink-1 shadow-(--shadow-pop) ring-line sm:max-w-[calc(100%-2rem)]"
      onOpenAutoFocus={(e) => {
        e.preventDefault()
        nameRef.current?.focus()
      }}
      onPaste={onPaste}
      onKeyDown={onKeyDown}
      data-own-drop=""
      data-testid="template-edit"
      {...drag}
    >
      <header className="flex items-center py-3 pr-11 pl-4">
        <DialogTitle className="text-[13px] font-semibold">{isNew ? '新建角色模板' : isChar ? '编辑角色模板' : '编辑区块模板'}</DialogTitle>
        <DialogDescription className="sr-only">{isNew ? '名字、性别、作品、正面、负面、备注和配图' : isChar ? '名字、作品、备注和配图' : '名字、目录、备注和配图'}</DialogDescription>
      </header>
      <div className="flex gap-4 px-4 pt-1 pb-4">
        <div className="flex w-[200px] shrink-0 flex-col gap-1.5">
          {hasImg ? (
            <div className={cn('tpl-drop group/img relative overflow-hidden rounded-lg', over && 'tpl-drop-over')} data-testid="template-edit-image">
              {img.kind === 'new' ? (
                <img src={img.url} alt="" className="block h-[267px] w-full object-cover" style={{ objectPosition: '50% 30%' }} />
              ) : (
                <TemplateImage imageKey={t.imageKey} className="h-[267px] w-full" />
              )}
              <div className="absolute inset-x-0 bottom-0 flex justify-end gap-1.5 bg-gradient-to-t from-black/50 to-transparent px-2 pt-7 pb-2 opacity-0 transition-opacity duration-(--dur) group-hover/img:opacity-100 group-focus-within/img:opacity-100">
                <button type="button" className="tpl-img-btn" onClick={() => file.current?.click()} data-testid="template-edit-replace">
                  <Icon icon={Exchange01Icon} size={14} />
                  更换
                </button>
                <button type="button" className="tpl-img-btn" onClick={() => setImg({ kind: 'none' })} aria-label="移除配图" data-testid="template-edit-remove">
                  <Icon icon={Delete02Icon} size={14} />
                  移除
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              className={cn('tpl-drop tpl-drop-empty grid h-[267px] w-full place-items-center rounded-lg text-center', over && 'tpl-drop-over')}
              onClick={() => file.current?.click()}
              data-testid="template-edit-drop"
            >
              <span className="flex flex-col items-center gap-1.5 text-[12px] leading-relaxed text-ink-2">
                <Icon icon={ImageUpload01Icon} size={20} className="text-ink-3" />
                <span>
                  拖入图片、Ctrl+V 粘贴
                  <br />
                  或<span className="text-ink-2 underline underline-offset-2">点击选择文件</span>
                </span>
              </span>
            </button>
          )}
          <p className="text-[11px] leading-relaxed text-ink-2">{hasImg ? '也可拖入或 Ctrl+V 更换 · ' : ''}缩放至长边 1024 后保存在本机，不写入文档</p>
          <input
            ref={file}
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => {
              void take(e.target.files?.[0])
              e.target.value = ''
            }}
            data-testid="template-edit-file"
          />
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <div className="flex items-end gap-2">
            <label className="flex min-w-0 flex-1 flex-col gap-1">
              <span className="text-[12px] font-medium text-ink-2">名字</span>
              <Input ref={nameRef} className="h-7 text-[13px] md:text-[13px]" value={name} onChange={(e) => setName(e.target.value)} onFocus={(e) => e.currentTarget.select()} data-testid="template-edit-name" />
            </label>
            {isNew && (
              <div className="flex shrink-0 flex-col gap-1">
                <span className="text-[12px] font-medium text-ink-2">性别</span>
                <GenderSelect value={gender} onChange={setGender} variant="field" testId="template-edit-gender" />
              </div>
            )}
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-[12px] font-medium text-ink-2">{isChar ? '作品' : '目录'}</span>
            {isChar ? (
              <WorkPicker value={folder} onChange={setFolder} works={works} suggestions={suggestions} variant="field" testId="template-edit-work" />
            ) : (
              <FolderPicker value={folder} onChange={setFolder} folders={folders} />
            )}
          </div>
          {isNew && (
            <>
              <label className="flex flex-col gap-1">
                <span className="text-[12px] font-medium text-ink-2">正面</span>
                <Textarea
                  className="max-h-[148px] min-h-[72px] text-[13px] leading-[1.55] md:text-[13px]"
                  value={positive}
                  placeholder="输入或粘贴 prompt，逗号分隔"
                  spellCheck={false}
                  onChange={(e) => onPositive(e.target.value)}
                  data-testid="template-edit-prompt"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[12px] font-medium text-ink-2">负面</span>
                <Textarea
                  className="max-h-[96px] min-h-[52px] text-[13px] leading-[1.55] md:text-[13px]"
                  value={negative}
                  placeholder="输入或粘贴 prompt，逗号分隔"
                  spellCheck={false}
                  onChange={(e) => setNegative(e.target.value)}
                  data-testid="template-edit-uc"
                />
              </label>
            </>
          )}
          <label className="flex flex-1 flex-col gap-1">
            <span className="text-[12px] font-medium text-ink-2">备注</span>
            <Textarea
              className={cn('flex-1 text-[13px] leading-[1.55] md:text-[13px]', isNew ? 'min-h-[52px]' : 'min-h-[84px]')}
              value={note}
              placeholder={isChar ? '使用场景、同框注意事项等，添加时复制到角色' : '使用场景、权重搭配等，插入时复制到区块'}
              onChange={(e) => setNote(e.target.value)}
              data-testid="template-edit-note"
            />
          </label>
        </div>
      </div>
      <footer className="flex items-center gap-2 border-t border-line py-2.5 pr-3.5 pl-4">
        <span className="flex-1 text-[12px] text-ink-2" data-testid="template-edit-footnote">
          {isNew
            ? '区块、颜色请在编辑器中修改：添加后修改，在角色面板点击「覆盖」'
            : isChar
              ? '区块、性别、颜色请在编辑器中修改：添加后修改，在角色面板点击「覆盖」'
              : 'tag 请在编辑器中修改：插入后修改，在区块面板点击「覆盖」'}
        </span>
        <DialogClose asChild>
          <Button variant="outline" size="lg" data-testid="template-edit-cancel">
            取消
          </Button>
        </DialogClose>
        <Button size="lg" className="px-3 font-semibold" disabled={isNew && !name.trim()} onClick={() => void save()} data-testid="template-edit-save">
          {isNew ? '创建' : '保存'}
        </Button>
      </footer>
    </DialogContent>
  )
}

export function FolderPicker({ value, onChange, folders }: { value: string; onChange: (v: string) => void; folders: string[] }) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const list = value && !folders.includes(value) ? [...folders, value].sort((a, b) => a.localeCompare(b, 'zh')) : folders
  const typed = normFolder(q)
  const pick = (f: string) => {
    onChange(f)
    setOpen(false)
    setQ('')
  }
  const tick = (on: boolean) => <Icon icon={Tick02Icon} size={14} className={cn('ml-auto shrink-0 text-ink-2', !on && 'invisible')} />
  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o)
        if (!o) setQ('')
      }}
    >
      <PopoverTrigger asChild>
        <Button variant="outline" role="combobox" aria-expanded={open} className="h-7 w-full justify-between px-2.5 text-[13px] font-normal" data-testid="template-edit-folder">
          <span className="flex min-w-0 items-center gap-1.5">
            <Icon icon={Folder01Icon} size={14} className="shrink-0 text-ink-2" />
            <span className={cn('truncate', !value && 'text-ink-3')} data-testid="template-edit-folder-value">
              {value || '根目录'}
            </span>
          </span>
          <Icon icon={ArrowDown01Icon} size={14} className="shrink-0 text-ink-2" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-(--radix-popover-trigger-width) p-0" data-testid="template-edit-folder-menu">
        <Command>
          <CommandInput placeholder="搜索，或输入新名字新建（/ 分层）" value={q} onValueChange={setQ} data-testid="template-edit-folder-search" />
          <CommandList className="max-h-60">
            <CommandGroup>
              <CommandItem value="根目录" onSelect={() => pick('')} data-testid="template-edit-folder-option">
                <span className="text-ink-2">根目录</span>
                {tick(value === '')}
              </CommandItem>
              {list.map((f) => {
                const depth = f.split('/').length - 1
                return (
                  <CommandItem key={f} value={f} onSelect={() => pick(f)} data-testid="template-edit-folder-option" data-path={f}>
                    <span className="flex min-w-0 items-center gap-1.5" style={q ? undefined : { paddingLeft: depth * 14 }}>
                      <Icon icon={Folder01Icon} size={14} className="shrink-0 text-ink-2" />
                      <span className="truncate">{q ? f : f.slice(f.lastIndexOf('/') + 1)}</span>
                    </span>
                    {tick(value === f)}
                  </CommandItem>
                )
              })}
            </CommandGroup>
            {typed && !list.includes(typed) && (
              <CommandGroup forceMount>
                <CommandItem forceMount value={'新建 ' + typed} onSelect={() => pick(typed)} data-testid="template-edit-folder-create">
                  <Icon icon={FolderAddIcon} size={14} className="shrink-0 text-ink-2" />
                  <span className="truncate">
                    新建目录「<b className="font-medium">{typed}</b>」
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
