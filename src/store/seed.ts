import { safeStorage } from './storage'

export const RELEASE = import.meta.env.MODE === 'release'

export const SEED_EXAMPLES = !RELEASE && safeStorage.getItem('pe:seed') === 'examples'

const VOLATILE = new Set(['id', 'createdAt', 'templateId', 'templateEdited'])

export function fingerprint(x: unknown): string {
  const norm = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(norm)
    if (v && typeof v === 'object') {
      const out: Record<string, unknown> = {}
      for (const k of Object.keys(v).sort()) {
        const val = (v as Record<string, unknown>)[k]
        if (VOLATILE.has(k) || val === undefined || val === null || val === false) continue
        out[k] = norm(val)
      }
      return out
    }
    return v
  }
  return JSON.stringify(norm(x))
}

export function withoutUntouched<T extends { createdAt: number }>(list: T[] | undefined, examples: T[], print: (t: T) => string = fingerprint): T[] {
  const prints = new Set(examples.map(print))
  return (list ?? []).filter((t) => !(t.createdAt === 0 && prints.has(print(t))))
}
