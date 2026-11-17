import { ArrowDown01Icon, FemaleSymbolIcon, MaleSymbolIcon, UserIcon } from '@hugeicons/core-free-icons'
import { cn } from 'cn'
import { Icon } from '@/components/icon'
import { DROPDOWN_KIT, type MenuKit } from '@/components/menu-kit'
import { Button } from '@/components/ui/button'
import { Tip } from '@/components/tip'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { defTags, GENDER_LABEL, genderLabel, GENDERS, menuDefs, sameGender, valueOfDef, type GenderValue } from '@/lib/gender'
import { useGenderOptions } from '@/lib/use-gender-options'
import type { Gender, GenderExtra } from '@/types'
import { GENDER_TAG } from '@/types'

const ICON = { female: FemaleSymbolIcon, male: MaleSymbolIcon, other: UserIcon } as const

export function GenderIcon({ gender, extra, size = 14, className }: { gender: Gender; extra?: GenderExtra; size?: number; className?: string }) {
  return (
    <Tip label={extra?.name}>
      <span className={cn('gender-icon', className)} data-g={gender} aria-hidden>
        <Icon icon={ICON[gender]} size={size} />
      </span>
    </Tip>
  )
}

export function GenderName({ value, className }: { value: GenderValue; className?: string }) {
  if (!value.genderExtra) return null
  return (
    <span className={cn('gender-name', className)} data-g={value.gender} data-testid="gender-name">
      {value.genderExtra.name}
    </span>
  )
}

export function GenderRadioItems({ value, onChange, kit: K = DROPDOWN_KIT }: { value: GenderValue; onChange: (v: GenderValue) => void; kit?: MenuKit }) {
  const defs = menuDefs(useGenderOptions(), value)
  const keyOf = (v: GenderValue) => {
    if (!v.genderExtra) return v.gender
    const i = defs.findIndex((d) => sameGender(valueOfDef(d), v))
    return i >= 0 ? `x${i}` : ''
  }
  return (
    <K.RadioGroup
      value={keyOf(value)}
      onValueChange={(k) => {
        if ((GENDERS as string[]).includes(k)) onChange({ gender: k as Gender })
        else if (k.startsWith('x')) onChange(valueOfDef(defs[Number(k.slice(1))]))
      }}
    >
      {GENDERS.map((g) => (
        <K.RadioItem key={g} value={g} data-testid={`gender-${g}`}>
          <GenderIcon gender={g} size={14} />
          {GENDER_LABEL[g]}
          <span className="ml-auto pl-3 text-[11px] text-ink-2">{GENDER_TAG[g] ?? '不添加'}</span>
        </K.RadioItem>
      ))}
      {defs.length > 0 && <K.Separator />}
      {defs.map((d, i) => (
        <K.RadioItem key={`x${i}`} value={`x${i}`} data-testid={`gender-ext-${d.name}`}>
          <GenderIcon gender={d.gender} size={14} />
          <span className="shrink-0 whitespace-nowrap">{d.name}</span>
          <span className="ml-auto min-w-0 truncate pl-3 text-[11px] text-ink-2">{defTags(d)}</span>
        </K.RadioItem>
      ))}
    </K.RadioGroup>
  )
}

export function GenderSelect({ value, onChange, testId, variant = 'button' }: { value: GenderValue; onChange: (v: GenderValue) => void; testId: string; variant?: 'button' | 'field' }) {
  const exts = useGenderOptions()
  const field = variant === 'field'
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size={field ? 'default' : 'xs'}
          className={field ? 'h-7 min-w-24 justify-between gap-1.5 px-2.5 text-[13px] font-normal' : 'gap-1'}
          data-testid={testId}
        >
          <span className={cn('flex min-w-0 items-center', field ? 'gap-1.5' : 'gap-1')}>
            <GenderIcon gender={value.gender} size={14} />
            <span className={cn('truncate', value.genderExtra && 'gender-name')} data-g={value.gender} data-testid={`${testId}-value`}>
              {genderLabel(value)}
            </span>
          </span>
          <Icon icon={ArrowDown01Icon} size={14} className="text-ink-2" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className={exts.length || value.genderExtra ? 'w-76' : 'w-44'}>
        <DropdownMenuLabel className="font-normal text-ink-3">性别</DropdownMenuLabel>
        <GenderRadioItems value={value} onChange={onChange} />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
