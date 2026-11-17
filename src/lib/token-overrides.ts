import { safeStorage } from '@/store/storage'

const KEY = 'pe:tokens'
let applied: string[] = []

export function loadTokenOverrides(): Record<string, string> {
  try {
    return JSON.parse(safeStorage.getItem(KEY) ?? '{}') as Record<string, string>
  } catch {
    return {}
  }
}

export function applyTokenOverrides(o: Record<string, string>) {
  const style = document.documentElement.style
  for (const k of applied) if (!(k in o)) style.removeProperty(k)
  for (const [k, v] of Object.entries(o)) style.setProperty(k, v)
  applied = Object.keys(o)
}

export function saveTokenOverrides(o: Record<string, string>) {
  safeStorage.setItem(KEY, JSON.stringify(o))
  applyTokenOverrides(o)
}

export function clearTokenOverrides() {
  safeStorage.removeItem(KEY)
  applyTokenOverrides({})
}
