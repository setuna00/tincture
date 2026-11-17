import { useState } from 'react'
import { ArrowDown01Icon, Book02Icon, BookPlusIcon, Tick02Icon } from '@hugeicons/core-free-icons'
import { Icon } from '@/components/icon'
import { Button } from '@/components/ui/button'
import { Command, CommandGroup, CommandItem, CommandList, CommandInput } from '@/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Tip } from '@/components/tip'
import { cn } from '@/lib/utils'

export interface WorkSuggestion {
  label: string
  from: string
}

export function WorkPicker({
  value,
  onChange,
  works,
  suggestions = [],
  variant,
  placeholder = '无所属作品',
  testId,
}: {
  value: string
  onChange: (work: string) => void
  works: string[]
  suggestions?: WorkSuggestion[]
  variant: 'field' | 'inline'
  placeholder?: string
  testId: string
}) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const typed = q.trim()
  const list = value && !works.includes(value) ? [...works, value].sort((a, b) => a.localeCompare(b, 'zh')) : works
  const sugg = suggestions.filter((s) => !list.includes(s.label))
  const pick = (w: string) => {
    onChange(w)
    setOpen(false)
    setQ('')
  }
  const tick = (on: boolean) => <Icon icon={Tick02Icon} size={14} className={cn('ml-auto shrink-0 text-ink-2', !on && 'invisible')} />
  const fromTag = (label: string) => suggestions.find((s) => s.label === label)?.from
  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o)
        if (!o) setQ('')
      }}
    >
      <PopoverTrigger asChild>
        {variant === 'field' ? (
          <Button variant="outline" role="combobox" aria-expanded={open} className="h-7 w-full justify-between px-2.5 text-[13px] font-normal" data-testid={testId}>
            <span className="flex min-w-0 items-center gap-1.5">
              <Icon icon={Book02Icon} size={14} className="shrink-0 text-ink-2" />
              <span className={cn('truncate', !value && 'text-ink-3')} data-testid={`${testId}-value`}>
                {value || placeholder}
              </span>
            </span>
            <Icon icon={ArrowDown01Icon} size={14} className="shrink-0 text-ink-2" />
          </Button>
        ) : (
          <Tip label="作品：用于模板库分组和查找相关角色">
            <button
              type="button"
              role="combobox"
              aria-expanded={open}
              className="-ml-1.5 flex h-6 max-w-full items-center gap-1 self-start rounded-md border border-transparent px-1.5 text-[12px] text-ink-2 transition-colors duration-(--dur-fast) hover:border-line hover:text-ink-1 aria-expanded:border-lamp-text"
              data-testid={testId}
            >
              <Icon icon={Book02Icon} size={14} className="shrink-0 text-ink-2" />
              <span className={cn('truncate', !value && 'text-ink-3')} data-testid={`${testId}-value`}>
                {value || placeholder}
              </span>
              <Icon icon={ArrowDown01Icon} size={14} className="shrink-0 text-ink-2" />
            </button>
          </Tip>
        )}
      </PopoverTrigger>
      <PopoverContent align="start" className={cn('p-0', variant === 'field' ? 'w-(--radix-popover-trigger-width)' : 'w-64')} data-testid={`${testId}-menu`}>
        <Command>
          <CommandInput placeholder="搜索，或输入新名字新建作品" value={q} onValueChange={setQ} data-testid={`${testId}-search`} />
          <CommandList className="max-h-64">
            {sugg.length > 0 && (
              <CommandGroup heading="按角色 tag">
                {sugg.map((s) => (
                  <CommandItem key={s.label} value={`tag ${s.label} ${s.from}`} onSelect={() => pick(s.label)} data-testid={`${testId}-suggestion`}>
                    <span className="flex min-w-0 items-center gap-1.5">
                      <span className="truncate">{s.label}</span>
                      <span className="truncate text-[11px] text-ink-2">{s.from}</span>
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            <CommandGroup heading={list.length ? '已有作品' : undefined}>
              {list.map((w) => (
                <CommandItem key={w} value={w} onSelect={() => pick(w)} data-testid={`${testId}-option`} data-work={w}>
                  <span className="flex min-w-0 items-center gap-1.5">
                    <span className="truncate">{w}</span>
                    {fromTag(w) && <span className="truncate text-[11px] text-ink-2">{fromTag(w)}</span>}
                  </span>
                  {tick(value === w)}
                </CommandItem>
              ))}
              <CommandItem value="无所属作品" onSelect={() => pick('')} data-testid={`${testId}-none`}>
                <span className="text-ink-2">无所属作品</span>
                {tick(!value)}
              </CommandItem>
            </CommandGroup>
            {typed && !list.includes(typed) && !sugg.some((s) => s.label === typed) && (
              <CommandGroup forceMount>
                <CommandItem forceMount value={'新建 ' + typed} onSelect={() => pick(typed)} data-testid={`${testId}-create`}>
                  <Icon icon={BookPlusIcon} size={14} className="shrink-0 text-ink-2" />
                  <span className="truncate">
                    新建作品「<b className="font-medium">{typed}</b>」
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
