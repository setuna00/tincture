import { useEffect, useMemo, useRef, useState } from 'react'
import { Add01Icon, Folder01Icon, Search01Icon, Tick02Icon } from '@hugeicons/core-free-icons'
import { toast } from 'sonner'
import { Icon } from '@/components/icon'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { ScrollArea } from '@/components/ui/scroll-area'
import { addTags, ensurePath, findListNode, nodeChain, walk, type UserList } from '@/lib/lists'
import { cn } from '@/lib/utils'
import { useDiscover } from '@/store/discover'
import { useLists } from '@/store/lists'
import type { Catalog } from '@/lib/discover'
import { listTagOf, mergedNote, normalizeListTags, rowTagOf } from './data'
import { SEL_BG } from './tree'

interface Target {
  listId: string
  nodeId: string
}
interface Row {
  listId: string
  nodeId: string
  title: string
  path: string
  depth: number
}

const SHOW_MAX = 200

export function PutDialog({ catalog }: { catalog: Catalog | null }) {
  const put = useDiscover((s) => s.put)
  const [shown, setShown] = useState(put)
  if (put && put !== shown) setShown(put)
  return (
    <Dialog open={!!put} onOpenChange={(o) => !o && useDiscover.getState().set({ put: null })}>
      {shown && catalog && <PutForm key={shown.tags.join('|') + shown.from} tags={shown.tags} from={shown.from} catalog={catalog} />}
    </Dialog>
  )
}

function PutForm({ tags, from, catalog }: { tags: string[]; from: string; catalog: Catalog }) {
  const lists = useLists((s) => s.lists)
  const rows = useMemo(() => {
    const out: Row[] = []
    for (const l of lists) walk(l.nodes, (n) => out.push({ listId: l.id, nodeId: n.id, title: n.title, path: nodeChain(l.nodes, n.id).map((x) => x.title).join(' / '), depth: nodeChain(l.nodes, n.id).length }))
    return out
  }, [lists])
  const [q, setQ] = useState('')
  const query = q.trim().toLowerCase()
  const shownRows = query ? rows.filter((r) => r.path.toLowerCase().includes(query)) : rows
  const [target, setTarget] = useState<Target | null>(() => {
    const last = useDiscover.getState().lastPut
    if (last && rows.some((r) => r.listId === last.listId && r.nodeId === last.nodeId)) return last
    return rows[0] ? { listId: rows[0].listId, nodeId: rows[0].nodeId } : null
  })
  const createIn: UserList | undefined = lists.find((l) => l.id === target?.listId) ?? lists[0]
  const typedPath = q
    .split('/')
    .map((s) => s.trim())
    .filter(Boolean)
    .join(' / ')
  const canCreate = !!typedPath && !!createIn && !rows.some((r) => r.listId === createIn.id && r.path === typedPath)
  const [creating, setCreating] = useState(false)
  const isNew = creating && canCreate
  const sel = isNew ? null : rows.find((r) => r.listId === target?.listId && r.nodeId === target?.nodeId)
  const node = sel ? findListNode(lists.find((l) => l.id === sel.listId)!.nodes, sel.nodeId) : undefined
  const inNode = useMemo(() => new Set(node?.tags.map((x) => x.toLowerCase()) ?? []), [node])
  const has = (t: string) => inNode.has(listTagOf(t, catalog).toLowerCase())
  const skip = useMemo(() => tags.filter((t) => inNode.has(listTagOf(t, catalog).toLowerCase())).length, [tags, inNode, catalog])
  const add = tags.length - skip
  const listName = (id: string) => lists.find((l) => l.id === id)?.name ?? ''

  useEffect(() => {
    if (!query) return setCreating(false)
    if (shownRows.length && !shownRows.some((r) => r.listId === target?.listId && r.nodeId === target?.nodeId)) setTarget({ listId: shownRows[0].listId, nodeId: shownRows[0].nodeId })
    setCreating(!shownRows.length && canCreate)
  }, [query]) // eslint-disable-line react-hooks/exhaustive-deps

  const listRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    listRef.current?.querySelector('[data-on]')?.scrollIntoView({ block: 'nearest' })
  }, [target, isNew])

  const submit = (t: Target | null = target, asNew = isNew) => {
    const listId = asNew ? createIn?.id : t?.listId
    if (!listId) return
    let added: string[] = []
    let nodeId = t?.nodeId ?? ''
    const norm = normalizeListTags(tags, catalog)
    useLists.getState().editNodes(listId, (nodes) => {
      let ns = nodes
      if (asNew) {
        const r = ensurePath(ns, null, typedPath.replace(/ \/ /g, '/'))
        ns = r.nodes
        nodeId = r.node!.id
      }
      const a = addTags(ns, nodeId, norm.tags)
      added = a.added
      return a.nodes
    })
    const l = useLists.getState().lists.find((x) => x.id === listId)!
    const where = `${l.name} › ${nodeChain(l.nodes, nodeId)
      .map((n) => n.title)
      .join(' / ')}`
    useDiscover.getState().set({ put: null, lastPut: { listId, nodeId } })
    const skipped = norm.tags.length - added.length
    const note = mergedNote(norm.merged)
    toast(added.length ? `已加入「${where}」· ${added.length} 个${skipped ? `（${skipped} 个已存在）` : ''}` : `均已在「${where}」中`, {
      description: note ?? undefined,
      action: added.length || asNew ? { label: '撤销', onClick: () => useLists.getState().undo() } : undefined,
    })
  }
  const move = (d: number) => {
    if (!shownRows.length) return
    const i = shownRows.findIndex((r) => r.listId === target?.listId && r.nodeId === target?.nodeId)
    const next = shownRows[Math.max(0, Math.min(shownRows.length - 1, (i < 0 ? -1 : i) + d))]
    setCreating(false)
    setTarget({ listId: next.listId, nodeId: next.nodeId })
  }

  let lastList = ''
  return (
    <DialogContent
      className="w-[600px] max-w-[calc(100%-2rem)] gap-0 overflow-hidden rounded-xl bg-work p-0 text-ink-1 shadow-(--shadow-pop) ring-line sm:max-w-[calc(100%-2rem)]"
      style={{ width: 680 }}
      data-testid="discover-put"
    >
      <div className="border-b border-line px-4 py-3">
        <DialogTitle className="text-[13px] font-semibold">加入 list</DialogTitle>
        <DialogDescription className="mt-0.5 text-[12px] text-ink-2">{from} · 跳过节点中已有的 tag</DialogDescription>
      </div>
      <div className="grid" style={{ gridTemplateColumns: '260px minmax(0, 1fr)', height: 360 }}>
        <div className="flex min-h-0 flex-col border-r border-line">
          <p className="px-3 pt-2.5 pb-1 text-[11px] text-ink-2">待加入 {tags.length} 个</p>
          <ScrollArea className="min-h-0 flex-1">
            <div className="px-1.5 pb-2" data-testid="discover-put-tags">
              {tags.slice(0, SHOW_MAX).map((t) => {
                const r = rowTagOf(t)
                const on = has(t)
                return (
                  <div key={t} className={cn('flex h-7 items-center gap-1.5 rounded-md px-1.5 transition-opacity duration-(--dur)', on && 'opacity-45')} data-testid="discover-put-tag" data-name={t} data-skip={on ? '' : undefined}>
                    <span className="tn min-w-0 flex-1 text-[13px]" data-has-zh={r.zh ? '' : undefined}>
                      <span className="tn-en text-ink-1">{t}</span>
                      {r.zh && <span className="tn-zh text-[12px]">{r.zh}</span>}
                    </span>
                    {on && <span className="shrink-0 text-[11px] text-ink-2">已存在</span>}
                  </div>
                )
              })}
              {tags.length > SHOW_MAX && (
                <p className="px-1.5 pt-1.5 text-[11px] leading-relaxed text-ink-2" data-testid="discover-put-more">
                  …还有 {(tags.length - SHOW_MAX).toLocaleString()} 个
                  {skip > 0 && `（共 ${skip.toLocaleString()} 个已存在）`}
                </p>
              )}
            </div>
          </ScrollArea>
        </div>
        <div className="flex min-h-0 flex-col">
          <p className="px-3 pt-2.5 pb-1 text-[11px] text-ink-2">加入到节点</p>
          <div className="relative mx-3 shrink-0">
            <span className="pointer-events-none absolute inset-y-0 left-0 grid w-8 place-items-center text-ink-3">
              <Icon icon={Search01Icon} size={14} />
            </span>
            <input
              className="h-8 w-full rounded-md border border-line bg-transparent pr-2 pl-8 text-[13px] text-ink-1 outline-none placeholder:text-ink-3 focus:border-lamp-text"
              placeholder="搜索节点，或输入新名字新建（/ 分层）"
              value={q}
              autoFocus
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.nativeEvent.isComposing) return
                if (e.key === 'ArrowDown') {
                  e.preventDefault()
                  if (isNew) return
                  const last = shownRows[shownRows.length - 1]
                  if (canCreate && last && last.listId === target?.listId && last.nodeId === target?.nodeId) setCreating(true)
                  else move(1)
                } else if (e.key === 'ArrowUp') {
                  e.preventDefault()
                  if (isNew) {
                    setCreating(false)
                    const last = shownRows[shownRows.length - 1]
                    if (last) setTarget({ listId: last.listId, nodeId: last.nodeId })
                  } else move(-1)
                } else if (e.key === 'Enter') {
                  e.preventDefault()
                  if (isNew || (sel && add > 0)) submit()
                }
              }}
              data-testid="discover-put-search"
            />
          </div>
          <ScrollArea className="mt-1.5 min-h-0 flex-1">
            <div ref={listRef} className="px-1.5 pb-1.5" data-testid="discover-put-nodes">
              {shownRows.map((r) => {
                const on = !isNew && r.listId === target?.listId && r.nodeId === target?.nodeId
                const head = r.listId !== lastList
                lastList = r.listId
                return (
                  <div key={`${r.listId}:${r.nodeId}`}>
                    {head && <p className="mt-1 px-2 pt-1 pb-0.5 text-[11px] text-ink-2">{listName(r.listId)}</p>}
                    <div
                      role="option"
                      aria-selected={on}
                      className={cn('flex h-7 cursor-default items-center gap-2 rounded-md pr-2 text-[13px] transition-colors duration-(--dur-fast)', !on && 'hover:bg-surface-2')}
                      style={{ paddingLeft: 8 + (query ? 0 : (r.depth - 1) * 14), ...(on ? SEL_BG : {}) }}
                      onClick={() => {
                        setCreating(false)
                        setTarget({ listId: r.listId, nodeId: r.nodeId })
                      }}
                      onDoubleClick={() => submit({ listId: r.listId, nodeId: r.nodeId }, false)}
                      data-testid="discover-put-node"
                      data-path={r.path}
                      data-on={on ? '' : undefined}
                    >
                      <Icon icon={Folder01Icon} size={14} className="shrink-0 text-ink-2" />
                      <span className={cn('min-w-0 flex-1 truncate text-ink-1', on && 'font-medium')}>{query ? r.path : r.title}</span>
                      {on && <Icon icon={Tick02Icon} size={14} className="shrink-0 text-ink-2" />}
                    </div>
                  </div>
                )
              })}
              {canCreate && (
                <div
                  role="option"
                  aria-selected={isNew}
                  className={cn('mt-1 flex h-7 cursor-default items-center gap-2 rounded-md px-2 text-[13px] transition-colors duration-(--dur-fast)', !isNew && 'hover:bg-surface-2')}
                  style={isNew ? SEL_BG : undefined}
                  onClick={() => setCreating(true)}
                  onDoubleClick={() => submit(null, true)}
                  data-testid="discover-put-create"
                  data-on={isNew ? '' : undefined}
                >
                  <Icon icon={Add01Icon} size={14} className="shrink-0 text-ink-2" />
                  <span className="min-w-0 truncate text-ink-2">
                    在「{createIn!.name}」新建节点「<b className="font-medium text-ink-1">{typedPath}</b>」
                  </span>
                </div>
              )}
              {!shownRows.length && !canCreate && <p className="px-2 py-6 text-center text-[12px] text-ink-2">暂无节点。输入名字即可新建</p>}
            </div>
          </ScrollArea>
        </div>
      </div>
      <div className="flex items-center gap-2 border-t border-line px-4 py-2.5">
        <span className="min-w-0 truncate text-[12px] text-ink-2" data-testid="discover-put-summary">
          {isNew ? (
            <>
              新建「{typedPath}」并加入 <b className="font-semibold text-ink-1">{tags.length}</b> 个
            </>
          ) : sel ? (
            <>
              添加 <b className="font-semibold text-ink-1">{add}</b> 个到「{listName(sel.listId)} › {sel.path}」{skip > 0 && <span className="text-ink-2"> · 跳过 {skip} 个已存在的</span>}
            </>
          ) : (
            <span className="text-ink-2">请选择节点</span>
          )}
        </span>
        <Button variant="ghost" size="sm" className="ml-auto h-7 text-[12px]" onClick={() => useDiscover.getState().set({ put: null })}>
          取消
        </Button>
        <Button size="sm" className="h-7 text-[12px]" disabled={!isNew && (!sel || add === 0)} onClick={() => submit()} data-testid="discover-put-ok">
          加入
        </Button>
      </div>
    </DialogContent>
  )
}
