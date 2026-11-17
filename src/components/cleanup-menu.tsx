import { useMemo } from 'react'
import { toast } from 'sonner'
import { Alert02Icon } from '@hugeicons/core-free-icons'
import { Icon } from '@/components/icon'
import { Tip } from '@/components/tip'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuShortcut, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { aliasFixes, naiDupChips } from '@/lib/cleanup'
import { cn } from '@/lib/utils'
import { useActions, useDoc } from '@/store/context'
import { useLibrary } from '@/store/library'

const listed = (xs: string[], n = 6) =>
  xs
    .slice(0, n)
    .map((x) => x.replace(/ /g, ' '))
    .join('、') + (xs.length > n ? ` 等 ${xs.length} 个` : '')

export function CleanupMenu() {
  const doc = useDoc((s) => s.doc)
  const actions = useActions()
  const variants = useLibrary((s) => s.variants)
  const fixes = useMemo(() => aliasFixes(doc, variants), [doc, variants])
  const dups = useMemo(() => naiDupChips(doc), [doc])
  const total = fixes.length + dups.length
  const fixAliases = () => {
    actions.updateChips(fixes.map((f) => ({ id: f.id, patch: { text: f.to, type: f.type } })))
    toast.success(`已将 ${fixes.length} 个别名替换为正式写法`, { description: `${listed(fixes.map((f) => `${f.from} → ${f.to}`), 3)} · Ctrl+Z 撤销` })
  }
  const removeDups = () => {
    actions.removeChips(dups.map((c) => c.id))
    toast.success(`已移除 ${dups.length} 个与 NAI 重复的 tag`, { description: `${listed(dups.map((c) => c.text), 4)} · Ctrl+Z 撤销` })
  }
  const summary = [dups.length && `与 NAI 重复 ${dups.length}`, fixes.length && `别名 ${fixes.length}`].filter(Boolean).join(' · ')
  return (
    <div
      className={cn(
        'grid transition-[grid-template-columns,opacity,margin] duration-200 ease-(--ease-out) motion-reduce:transition-none',
        total ? 'grid-cols-[1fr] opacity-100' : '-mr-3 grid-cols-[0fr] opacity-0',
      )}
      aria-hidden={!total}
      inert={!total}
    >
      <div className="min-w-0 overflow-hidden">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Tip label={`可整理：${summary}`}>
              <Button variant="ghost" size="sm" className="gap-1 text-warn hover:text-warn aria-expanded:text-warn" aria-label="整理" data-testid="cleanup-button">
                <Icon icon={Alert02Icon} size={14} />
                <span className="tabular-nums">{total}</span>
              </Button>
            </Tip>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52" data-testid="cleanup-menu">
            <Tip side="left" label={dups.length ? `移除 NAI 出图时会自动添加的 tag：${listed(dups.map((c) => c.text))}。带权重的 tag 不移除` : undefined}>
              <DropdownMenuItem disabled={!dups.length} onSelect={removeDups} data-testid="remove-nai-dups">
                NAI 去重
                <DropdownMenuShortcut className="tabular-nums">{dups.length}</DropdownMenuShortcut>
              </DropdownMenuItem>
            </Tip>
            <Tip side="left" label={fixes.length ? `权重不变：${listed(fixes.map((f) => `${f.from} → ${f.to}`))}` : undefined}>
              <DropdownMenuItem disabled={!fixes.length} onSelect={fixAliases} data-testid="fix-aliases">
                别名替换为正式写法
                <DropdownMenuShortcut className="tabular-nums">{fixes.length}</DropdownMenuShortcut>
              </DropdownMenuItem>
            </Tip>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  )
}
