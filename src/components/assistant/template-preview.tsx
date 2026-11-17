import { useMemo, useState, type CSSProperties, type ReactNode } from 'react'
import { ChipFace, chipAttrs } from '@/components/editor/chip-face'
import { sectionTint, sectionVars } from '@/components/editor/labels'
import { useTemplateImage } from '@/lib/template-images'
import { cn } from '@/lib/utils'
import { GenderIcon } from '@/components/gender'
import type { CharacterTemplate, SectionTemplate } from '@/store/library'
import type { Chip, Section, SectionColor } from '@/types'

export function TemplateImage({ imageKey, className, style, testId = 'template-image' }: { imageKey: string | undefined; className?: string; style?: CSSProperties; testId?: string }) {
  const url = useTemplateImage(imageKey)
  const [loaded, setLoaded] = useState<string | null>(null)
  return (
    <div className={cn('overflow-hidden bg-surface-2', className)} style={style} data-testid={testId}>
      {url && (
        <img
          src={url}
          alt=""
          draggable={false}
          className="size-full object-cover transition-opacity duration-200"
          style={{ objectPosition: '50% 30%', opacity: loaded === url ? 1 : 0 }}
          onLoad={() => setLoaded(url)}
        />
      )}
    </div>
  )
}

export const TemplateChips = ({ t }: { t: SectionTemplate }) => <ReadonlyChips id={t.id} chips={t.chips} color={t.color} />

export function ReadonlyChips({ id, chips: list, color }: { id: string; chips: readonly Omit<Chip, 'id'>[]; color: SectionColor }) {
  const chips = useMemo(() => list.map((c, i): Chip => ({ ...c, id: `${id}:${i}` })), [id, list])
  return (
    <div className="flex flex-wrap gap-1" style={sectionVars(color)}>
      {chips.map((c) => (
        <span key={c.id} className="chip tpl-chip" {...chipAttrs(c)} data-chip-id={undefined} data-testid="template-chip">
          <ChipFace chip={c} />
        </span>
      ))}
    </div>
  )
}

export function PreviewBody({ imageKey, color, name, meta, note, children }: { imageKey?: string; color: string; name: string; meta: ReactNode; note?: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2" data-testid="template-preview">
      {imageKey && <TemplateImage imageKey={imageKey} className="h-[140px] w-full rounded-md" />}
      <div className="flex min-w-0 items-center gap-1.5">
        <span className="size-2 shrink-0 rounded-full" style={{ background: color }} />
        <span className="shrink-0 text-[13px] font-semibold text-ink-1">{name}</span>
        <span className="truncate text-[11px] text-ink-2">{meta}</span>
      </div>
      {note && <p className="text-[12px] leading-[1.55] whitespace-pre-wrap text-ink-2">{note}</p>}
      {children}
    </div>
  )
}

export function CharacterSections({ t }: { t: Pick<CharacterTemplate, 'id' | 'prompt' | 'uc'> }) {
  const row = (s: Section, uc: boolean) => (
    <div key={s.id} className="flex flex-col gap-1" data-testid="char-tpl-section">
      <div className={cn('flex items-center gap-1.5 text-[11px]', s.muted && 'opacity-55')}>
        <span className="font-semibold" style={{ color: sectionTint(s.color) }}>
          {s.name}
        </span>
        <span className="text-ink-2">
          {uc ? '负面' : '正面'} · {s.chips.length}
          {s.muted && ' · 未启用'}
        </span>
      </div>
      {s.chips.length > 0 && <ReadonlyChips id={`${t.id}:${s.id}`} chips={s.chips} color={s.color} />}
    </div>
  )
  return (
    <div className="flex flex-col gap-2">
      {t.prompt.map((s) => row(s, false))}
      {t.uc.map((s) => row(s, true))}
    </div>
  )
}

export const charTemplateCounts = (t: Pick<CharacterTemplate, 'prompt' | 'uc'>) => {
  const all = [...t.prompt, ...t.uc]
  return `${all.length} 个区块 · ${all.reduce((n, s) => n + s.chips.length, 0)} 个 tag`
}

export function CharacterPreview({ t }: { t: CharacterTemplate }) {
  return (
    <PreviewBody
      imageKey={t.imageKey}
      color={sectionTint(t.color)}
      name={t.name}
      meta={
        <span className="inline-flex items-center gap-1">
          <GenderIcon gender={t.gender} extra={t.genderExtra} size={14} />
          {t.work?.trim() || '无所属作品'} · {[...t.prompt, ...t.uc].reduce((n, s) => n + s.chips.length, 0)} 个 tag
        </span>
      }
      note={t.note}
    >
      <CharacterSections t={t} />
    </PreviewBody>
  )
}

export function TemplatePreview({ t }: { t: SectionTemplate }) {
  return (
    <PreviewBody imageKey={t.imageKey} color={sectionTint(t.color)} name={t.name} meta={`${t.folder ? `${t.folder} · ` : ''}${t.chips.length} 个 tag`} note={t.note}>
      <TemplateChips t={t} />
    </PreviewBody>
  )
}
