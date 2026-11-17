import { useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Cancel01Icon, Search01Icon } from '@hugeicons/core-free-icons'
import { Icon } from '@/components/icon'
import { TagName } from '@/components/tag-name'
import { Input } from '@/components/ui/input'
import { countLabel, lookupTag, searchTags, type Suggestion } from '@/lib/tagdb'
import { atomVisible, findNode, occurrences, UNASSIGNED, UNASSIGNED_PATH, type Catalog, type ListNode } from '@/lib/discover'
import { cn } from '@/lib/utils'
import type { UserList } from '@/lib/lists'
import { NSFW_MAX_LEVEL, usePrefs } from '@/store/prefs'
import type { TagEntry } from '@/types'
import { customPlaces } from './data'

const FETCH = 40
const SHOW = 10

export function tagPaths(c: Catalog, tree: ListNode, name: string, maxLevel = 3): string[] {
  const atoms = c.atomsOf.get(name)
  if (atoms) return occurrences(tree, atoms.filter((a) => atomVisible(c, a, maxLevel)))
  return c.unassigned.some((t) => t.name === name) ? [UNASSIGNED_PATH] : []
}

export function placesOf(c: Catalog, tree: ListNode, custom: UserList | null, name: string, maxLevel: number): { paths: string[]; rows?: string[] } {
  return custom ? customPlaces(tree, name, c) : { paths: tagPaths(c, tree, name, maxLevel) }
}

interface Hit {
  tag: TagEntry
  from?: string
  paths: string[]
}

function locatable(results: Suggestion[], q: string, c: Catalog, tree: ListNode, custom: UserList | null, maxLevel: number): Hit[] {
  const out: Hit[] = []
  const seen = new Set<string>()
  for (const { tag } of results) {
    const renamed = tag.old === 2 ? c.renamedTo.get(tag.name) : undefined
    const t = renamed ? (lookupTag(renamed) ?? tag) : tag
    if (seen.has(t.name)) continue
    const paths = placesOf(c, tree, custom, t.name, maxLevel).paths
    if (!paths.length) continue
    seen.add(t.name)
    out.push({ tag: t, from: renamed ? tag.name : undefined, paths })
  }
  if (custom) {
    const k = q.trim().toLowerCase()
    const walk = (n: ListNode) => {
      for (const w of n.tags) {
        const name = w.toLowerCase()
        if (!lookupTag(name) && name.includes(k) && !seen.has(name)) {
          seen.add(name)
          out.push({ tag: { name: w, zh: '', category: 'general', count: -1 }, paths: customPlaces(tree, name, c).paths })
        }
      }
      n.children.forEach(walk)
    }
    tree.children.forEach(walk)
  }
  return out.slice(0, SHOW)
}

export function DiscoverSearch({ catalog, tree, custom, onLocate }: { catalog: Catalog | null; tree: ListNode; custom: UserList | null; onLocate: (name: string) => void }) {
  const [q, setQ] = useState('')
  const [results, setResults] = useState<{ q: string; list: Suggestion[] }>({ q: '', list: [] })
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  const maxLevel = NSFW_MAX_LEVEL[usePrefs((s) => s.nsfw)]
  useEffect(() => {
    if (!q.trim()) {
      setResults({ q: '', list: [] })
      return
    }
    let alive = true
    searchTags(q, FETCH).then((r) => {
      if (!alive) return
      setResults({ q, list: r })
      setActive(0)
    })
    return () => {
      alive = false
    }
  }, [q])
  const hits = useMemo(() => (catalog && results.q ? locatable(results.list, results.q, catalog, tree, custom, maxLevel) : []), [catalog, results, tree, custom, maxLevel])
  const pick = (h: Hit | undefined) => {
    if (!h) return
    setOpen(false)
    onLocate(h.tag.name.toLowerCase())
    input.current?.blur()
  }
  const settled = results.q === q
  const show = open && !!q.trim() && !!catalog && (hits.length > 0 || settled)
  const label = (h: Hit) => {
    const leaf = h.paths[0] === UNASSIGNED_PATH ? UNASSIGNED : (findNode(tree, h.paths[0])?.title ?? '')
    return h.paths.length > 1 ? `${leaf} · ${h.paths.length} 处` : leaf
  }
  return (
    <div className="relative" data-locate-keep="">
      <span className="pointer-events-none absolute inset-y-0 left-0 grid w-8 place-items-center text-ink-3">
        <Icon icon={Search01Icon} size={14} />
      </span>
      <Input
        ref={input}
        className="pr-7 pl-8"
        placeholder="搜索 tag / 中文 / 拼音"
        value={q}
        onChange={(e) => {
          setQ(e.target.value)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault()
            setActive((a) => Math.min(a + 1, hits.length - 1))
          } else if (e.key === 'ArrowUp') {
            e.preventDefault()
            setActive((a) => Math.max(a - 1, 0))
          } else if (e.key === 'Enter') {
            e.preventDefault()
            pick(hits[active])
          } else if (e.key === 'Escape') {
            if (open && q) setOpen(false)
            else setQ('')
          }
        }}
        data-testid="discover-search"
      />
      {q && (
        <button
          type="button"
          className="absolute inset-y-0 right-1.5 my-auto grid size-5 place-items-center rounded-sm text-ink-2 hover:text-ink-1"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            setQ('')
            input.current?.focus()
          }}
          aria-label="清空搜索"
        >
          <Icon icon={Cancel01Icon} size={14} />
        </button>
      )}
      <AnimatePresence>
        {show && (
          <motion.div
            initial={{ opacity: 0, y: -2 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.12 }}
            className="absolute top-full left-0 z-40 mt-1 w-[min(360px,calc(100vw-80px))] rounded-lg border border-line bg-popover p-1 shadow-md"
            onMouseDown={(e) => e.preventDefault()}
            role="listbox"
            data-testid="discover-search-results"
          >
            {hits.map((h, i) => (
              <div
                key={h.tag.name}
                role="option"
                aria-selected={i === active}
                className={cn('flex h-8 cursor-default items-center gap-2 rounded-md px-2 text-[13px]', i === active && 'bg-surface-2')}
                onMouseEnter={() => setActive(i)}
                onClick={() => pick(h)}
                data-testid="discover-search-hit"
                data-name={h.tag.name}
              >
                <TagName en={h.tag.name} zh={h.tag.zh} className="min-w-0 flex-1" />
                {h.from && (
                  <span className="shrink-0 text-[11px] text-ink-2" data-testid="discover-search-from">
                    旧写法 {h.from}
                  </span>
                )}
                <span className="max-w-32 shrink-0 truncate text-[11px] text-ink-2">{label(h)}</span>
                <span className={cn('w-9 shrink-0 text-right text-[11px] text-ink-2 tabular-nums')}>{h.tag.count < 0 ? '未识别' : countLabel(h.tag)}</span>
              </div>
            ))}
            {hits.length || !settled ? (
              <p className="px-2 pt-1 pb-0.5 text-[11px] text-ink-2">↵ 跳转到第一处 · 多处出现时可在下方逐个跳转</p>
            ) : (
              <p className="px-2 py-2 text-[12px] text-ink-2" data-testid="discover-search-none">
                此 list 中未找到匹配「{q.trim()}」的 tag
              </p>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
