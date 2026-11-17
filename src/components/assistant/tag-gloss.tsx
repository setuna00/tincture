import { memo, useState } from 'react'
import { AutoHeight, WikiBlock } from '@/components/wiki-gloss'
import { glossTarget } from '@/lib/tag-gloss'
import { lookupTag } from '@/lib/tagdb'
import { loadWikiZh, useWikiZhPack } from '@/lib/wiki-zh-pack'
import type { Chip } from '@/types'
import { prefetchRenamedCatalog, renamedCatalogReady, useRenamedCatalog } from './renamed-catalog'

let packAsked = false
function prefetchOnChipHover(e: PointerEvent) {
  const el = (e.target as Element | null)?.closest?.('[data-testid=chip]')
  if (!el) return
  if (!packAsked) {
    packAsked = true
    void loadWikiZh()
  }
  const text = el.querySelector('.chip-text')?.textContent
  if (text && lookupTag(text)?.old === 2) prefetchRenamedCatalog()
  if (renamedCatalogReady()) document.removeEventListener('pointerover', prefetchOnChipHover)
}
if (typeof document !== 'undefined') document.addEventListener('pointerover', prefetchOnChipHover, { passive: true })

export const TagGloss = memo(TagGlossInner, (a, b) => a.chip.text === b.chip.text && a.chip.type === b.chip.type && a.base === b.base)

function TagGlossInner({ chip, base }: { chip: Pick<Chip, 'text' | 'type'>; base: string | null }) {
  const target = glossTarget(chip, base, lookupTag)
  const zh = useWikiZhPack(!!target)
  const rn = useRenamedCatalog(!!target?.renamed)
  const ready = zh.done && (!target?.renamed || rn.done)
  const [late] = useState(!ready)
  if (!target) return null
  const name = target.renamed ? (rn.catalog?.renamedTo.get(target.name) ?? target.name) : target.name
  const gloss = ready ? zh.pack?.gloss(name) : undefined
  const show = ready && (!!gloss || !target.nai)
  return (
    <AutoHeight>
      {show && (
        <div className={`pt-3${late ? ' page-in' : ''}`} data-name={name}>
          <WikiBlock variant="panel" name={name} gloss={gloss} />
        </div>
      )}
    </AutoHeight>
  )
}
