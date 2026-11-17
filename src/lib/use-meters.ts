import { useMemo } from 'react'
import { lengthPlan, scaleParts } from './nai-length'
import { useTokenCounts } from './token-count'
import type { Doc, Gender, SectionColor } from '@/types'

export interface MeterSeg {
  name: string
  color: SectionColor | null
  gender?: Gender
  nsfw?: boolean
  n: number
}

export interface MeterData {
  own?: number
  total?: number
  limit: number
  parts: MeterSeg[]
  others: { name: string; n: number }[]
}

export const isOver = (m: MeterData) => m.total !== undefined && m.total > m.limit

const NONE: { key: string; text: string }[] = []

export function useMeters(doc: Doc, active: boolean): { meters: Map<string, MeterData>; failed: boolean } {
  const plan = useMemo(() => lengthPlan(doc), [doc])
  const items = useMemo(
    () => (active ? plan.boxes.flatMap((b) => [{ key: b.key, text: b.text }, ...b.parts.map((p) => ({ key: `${b.key}/${p.id}`, text: p.text }))]) : NONE),
    [plan, active],
  )
  const { counts, failed } = useTokenCounts(items, plan.tokenizer)
  const meters = useMemo(() => {
    const own = new Map<string, number | undefined>()
    const raw = new Map<string, (number | undefined)[]>()
    let i = 0
    for (const b of plan.boxes) {
      own.set(b.key, counts[i++])
      raw.set(b.key, b.parts.map(() => counts[i++]))
    }
    const total = (field: 'prompt' | 'uc') => {
      const list = plan.boxes.filter((b) => b.field === field).map((b) => own.get(b.key))
      return list.some((n) => n === undefined) ? undefined : list.reduce<number>((a, n) => a + n!, 0)
    }
    const totals = { prompt: total('prompt'), uc: total('uc') }
    const out = new Map<string, MeterData>()
    for (const b of plan.boxes) {
      const o = own.get(b.key)
      // T5 adds </s> to every independently counted segment; remove it before apportioning the whole prompt's count.
      const r = raw.get(b.key)!.map((n) => (n === undefined || plan.tokenizer !== 't5' ? n : Math.max(0, n - 1)))
      const parts = o === undefined || r.some((n) => n === undefined) ? [] : scaleParts(r as number[], o).map((n, k) => ({ name: b.parts[k].name, color: b.parts[k].color, gender: b.parts[k].gender, nsfw: b.parts[k].nsfw, n }))
      const others = plan.boxes.filter((x) => x.field === b.field && x.key !== b.key).map((x) => ({ name: x.name, n: own.get(x.key) ?? 0 }))
      out.set(b.key, { own: o, total: totals[b.field], limit: plan.limit, parts: parts.filter((p) => p.n > 0), others: others.filter((x) => x.n > 0) })
    }
    return out
  }, [plan, counts])
  return { meters, failed }
}
