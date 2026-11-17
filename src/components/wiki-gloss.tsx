import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { ArrowDown01Icon, ArrowRight01Icon, LinkSquare02Icon } from '@hugeicons/core-free-icons'
import { Icon } from '@/components/icon'
import { lookupTag } from '@/lib/tagdb'
import { getWiki, peekWiki, wikiPageUrl, type WikiResult } from '@/lib/wiki'
import { englishIn, type Gloss } from '@/lib/wiki-zh'

export type GlossVariant = 'card' | 'panel'
const TID = { card: 'discover', panel: 'gloss' } as const

type State = 'loading' | 'error' | WikiResult

function withTags(text: string, variant: GlossVariant): ReactNode[] {
  const out: ReactNode[] = []
  let rest = text
  for (const en of englishIn(text)) {
    const i = rest.indexOf(en)
    const t = i < 0 ? undefined : lookupTag(en.toLowerCase())
    if (!t) continue
    out.push(
      rest.slice(0, i),
      variant === 'card' ? (
        <span key={out.length} className="font-medium">
          {en}
        </span>
      ) : (
        <GlossTag key={out.length} en={en} zh={t.zh} />
      ),
    )
    rest = rest.slice(i + en.length)
  }
  out.push(rest)
  return out
}

function GlossTag({ en, zh }: { en: string; zh?: string }) {
  const has = !!zh && zh !== en
  return (
    <span className="gloss-tag" data-has-zh={has ? '' : undefined}>
      {has && <span className="gl-zh gl-pre">{zh}</span>}
      <span className="gl-en">{en}</span>
      {has && <span className="gl-zh gl-post">{zh}</span>}
    </span>
  )
}

function ZhGloss({ g, variant }: { g: Gloss; variant: GlossVariant }) {
  const tid = `${TID[variant]}-zh`
  if ('text' in g && !('mod' in g))
    return (
      <p className={variant === 'card' ? 'text-[13px] leading-relaxed text-ink-1' : 'text-[13px] leading-relaxed text-ink-2'} data-testid={tid}>
        {withTags(g.text, variant)}
      </p>
    )
  const c = g as Extract<Gloss, { mod: string }>
  const cosplay = c.mod === 'cosplay'
  const quote = cosplay ? lookupTag(c.base)?.zh : c.text
  const [a, b] = cosplay ? [c.base, c.mod] : [c.mod, c.base]
  return (
    <div data-testid={tid} data-compound="">
      <div className="font-mono text-[13px] text-ink-1">
        {a} <span className="text-ink-3">+</span> {b}
      </div>
      {quote && (
        <p className="mt-1 border-l-2 border-line-strong pl-2 text-[13px] leading-relaxed text-ink-2">
          <span className="mr-1.5 font-mono text-[12px] text-ink-2">{c.base}</span>
          {withTags(quote, variant)}
        </p>
      )}
    </div>
  )
}

const WikiLink = ({ name, label = 'Danbooru wiki（英文原文）', className = '' }: { name: string; label?: string; className?: string }) => (
  <a href={wikiPageUrl(name)} target="_blank" rel="noreferrer" className={`inline-flex items-center gap-1 text-[11px] text-ink-2 hover:text-ink-1 ${className}`}>
    {label}
    <Icon icon={LinkSquare02Icon} size={14} />
  </a>
)

export function WikiBlock({ name, gloss, variant = 'card' }: { name: string; gloss?: Gloss; variant?: GlossVariant }) {
  const [open, setOpen] = useState(false)
  const tid = TID[variant]
  if (!gloss && variant === 'card')
    return (
      <div className="border-t border-line pt-2 select-text">
        <WikiEn name={name} />
        <WikiLink name={name} className="mt-1" />
      </div>
    )
  return (
    <div className={variant === 'card' ? 'border-t border-line pt-2 select-text' : 'select-text'} {...(variant === 'panel' && { 'data-testid': 'gloss', 'data-has-zh': gloss ? '' : undefined })}>
      {gloss && <ZhGloss g={gloss} variant={variant} />}
      <div className={`${gloss ? 'mt-1.5 ' : ''}flex items-center gap-2`}>
        <button
          type="button"
          className="inline-flex items-center gap-1 text-[11px] text-ink-2 transition-colors hover:text-ink-1"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
          data-testid={`${tid}-en-toggle`}
        >
          <Icon icon={open ? ArrowDown01Icon : ArrowRight01Icon} size={14} />
          英文原文
        </button>
        <WikiLink name={name} label="Danbooru wiki" className="ml-auto" />
      </div>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div key="en" className="overflow-hidden" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.18 }}>
            <div className="pt-1.5">
              <WikiEn name={name} folded testId={`${tid}-wiki`} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function WikiEn({ name, folded, testId = 'discover-wiki' }: { name: string; folded?: boolean; testId?: string }) {
  const [st, setSt] = useState<State>(() => peekWiki(name) ?? 'loading')
  const [n, setN] = useState(0)
  useEffect(() => {
    let alive = true
    setSt(peekWiki(name) ?? 'loading')
    getWiki(name)
      .then((r) => alive && setSt(r))
      .catch(() => alive && setSt('error'))
    return () => {
      alive = false
    }
  }, [name, n])
  return (
    <div
      className={folded ? 'text-[12px] leading-relaxed text-ink-3' : 'text-[12px] leading-relaxed text-ink-2'}
      data-testid={testId}
      data-state={typeof st === 'string' ? st : 'paras' in st ? 'ok' : 'missing'}
    >
      {st === 'loading' && <p className="text-ink-2">正在获取 Danbooru wiki…</p>}
      {st === 'error' && (
        <p className="text-ink-2">
          无法获取 Danbooru wiki
          <button type="button" className="ml-1.5 text-ink-2 underline underline-offset-2 hover:text-ink-1" onClick={() => setN((x) => x + 1)}>
            重试
          </button>
        </p>
      )}
      {typeof st !== 'string' && 'missing' in st && <p className="text-ink-2">此 tag 在 Danbooru 上暂无 wiki</p>}
      {typeof st !== 'string' && 'paras' in st && (
        <div className="page-in flex flex-col gap-1.5">
          {st.paras.map((p, i) => (
            <p key={i}>{p}</p>
          ))}
        </div>
      )}
    </div>
  )
}

export function AutoHeight({ children, className }: { children: ReactNode; className?: string }) {
  const inner = useRef<HTMLDivElement>(null)
  const [h, setH] = useState<number | null>(null)
  const [ready, setReady] = useState(false)
  useLayoutEffect(() => {
    const el = inner.current
    if (!el) return
    setH(el.offsetHeight)
    const ro = new ResizeObserver(() => setH(el.offsetHeight))
    ro.observe(el)
    const id = requestAnimationFrame(() => setReady(true))
    return () => {
      ro.disconnect()
      cancelAnimationFrame(id)
    }
  }, [])
  return (
    <div className={className} style={{ height: h ?? undefined, overflow: 'hidden', transition: ready ? 'height 150ms var(--ease-out)' : undefined }}>
      <div ref={inner}>{children}</div>
    </div>
  )
}
