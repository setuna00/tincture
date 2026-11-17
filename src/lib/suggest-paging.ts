export const SUGGEST_PAGE = 10
export const SUGGEST_MAX = 60

export type PageKey = 'down' | 'up' | 'pageDown' | 'pageUp'

const KEYS: Record<string, PageKey> = { ArrowDown: 'down', ArrowUp: 'up', PageDown: 'pageDown', PageUp: 'pageUp' }
export const pageKey = (key: string): PageKey | undefined => KEYS[key]
export const isSuggestKey = (key: string) => key in KEYS

export const pageOf = (index: number, size = SUGGEST_PAGE) => (index > 0 ? Math.floor(index / size) : 0)
export const pageCount = (n: number, size = SUGGEST_PAGE) => Math.max(1, Math.ceil(n / size))

/** cmdk handles moves within a page; intercept only page boundaries and PageUp/PageDown to avoid double movement. */
export function pageMove(index: number, n: number, key: PageKey, size = SUGGEST_PAGE): number | null {
  if (n <= 0) return null
  const i = Math.min(Math.max(index, 0), n - 1)
  const page = pageOf(i, size)
  if (key === 'down' || key === 'up') {
    const next = key === 'down' ? (i + 1) % n : (i - 1 + n) % n
    return pageOf(next, size) === page ? null : next
  }
  const to = key === 'pageDown' ? page + 1 : page - 1
  return to < 0 || to >= pageCount(n, size) ? null : to * size
}
