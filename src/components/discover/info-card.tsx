import { WikiBlock } from '@/components/wiki-gloss'
import { countLabel } from '@/lib/tagdb'
import type { Catalog } from '@/lib/discover'
import { useWikiZh } from './data'
import type { TagEntry } from '@/types'

const CAT: Record<string, string> = { general: '通用', meta: '元信息', character: '角色', copyright: '作品', artist: '画师' }
const MAX_WORDS = 6

export function InfoCard({ t, catalog, used }: { t: TagEntry; catalog: Catalog; used?: string[] }) {
  const ups = catalog.parents.get(t.name) ?? []
  const downs = catalog.children.get(t.name) ?? []
  const atoms = catalog.atomsOf.get(t.name) ?? []
  const gloss = useWikiZh()?.gloss(t.name)
  return (
    <div className="flex flex-col gap-2" data-testid="discover-card" data-name={t.name}>
      <div>
        <div className="tn items-baseline gap-2" data-has-zh={t.zh ? '' : undefined}>
          <span className="tn-en text-[16px] font-semibold text-ink-1">{t.name}</span>
          {t.zh && <span className="tn-zh text-[13px]">{t.zh}</span>}
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <span className="meta-chip">{t.nai ? 'NAI 特殊' : (CAT[t.category] ?? t.category)}</span>
          {atoms.map((a) => (
            <span key={a} className="meta-chip">
              {a}
            </span>
          ))}
          <span className="ml-auto text-[12px] text-ink-2 tabular-nums">{t.nai ? 'NAI' : `${countLabel(t)} 作品`}</span>
        </div>
      </div>
      <WikiBlock key={t.name} name={t.name} gloss={gloss} />
      <dl className="grid grid-cols-[44px_minmax(0,1fr)] gap-x-2 gap-y-1 border-t border-line pt-2 text-[12px] leading-relaxed">
        <dt className="text-ink-2">上位词</dt>
        <dd className="text-ink-2" data-testid="discover-card-up">
          {words(ups)}
        </dd>
        <dt className="text-ink-2">下位词</dt>
        <dd className="text-ink-2" data-testid="discover-card-down">
          {words(downs)}
        </dd>
        <dt className="text-ink-2">已使用</dt>
        <dd className={used ? 'text-ink-2' : 'text-ink-3'} data-testid="discover-card-used">
          {used ? (used.length > 4 ? `${used.slice(0, 4).join('、')} 等 ${used.length} 处` : used.join('、')) : '未使用'}
        </dd>
      </dl>
    </div>
  )
}

const words = (l: string[]) => (l.length ? (l.length > MAX_WORDS ? `${l.slice(0, MAX_WORDS).join(' · ')} 等 ${l.length} 个` : l.join(' · ')) : '—')
