export const POP_ALGOS = ['rep', 'hit', 'total'] as const
export type PopAlgo = (typeof POP_ALGOS)[number]
export type ArtistAlgo = 'count' | PopAlgo
export const ARTIST_ALGOS: readonly ArtistAlgo[] = ['count', ...POP_ALGOS]
export const isPopAlgo = (a: unknown): a is PopAlgo => (POP_ALGOS as readonly unknown[]).includes(a)

/** Scores follow list.json.gz row order; null excludes a row. Integer scales are rep x100, hit x1000, total x1. */
export interface PopularityFile {
  v: 1
  until: string
  algos: Record<PopAlgo, { s: (number | null)[]; a: (number | null)[] }>
}

export function rankOrder(values: readonly (number | null)[]): number[] {
  const out: number[] = []
  for (let i = 0; i < values.length; i++) if (values[i] !== null) out.push(i)
  return out.sort((a, b) => values[b]! - values[a]! || a - b)
}

export const ARTIST_ALGO_LABEL: Record<ArtistAlgo, string> = { count: '作品数', rep: '代表作人气', hit: '好评率', total: '总人气' }
