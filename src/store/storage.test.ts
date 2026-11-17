import { beforeEach, describe, expect, it, vi } from 'vitest'

const shown = new Set<string>()
vi.mock('sonner', () => ({
  toast: {
    error: vi.fn((_: string, o: { id: string }) => shown.add(o.id)),
    dismiss: vi.fn((id: string) => shown.delete(id)),
    getToasts: () => [...shown].map((id) => ({ id })),
  },
}))
const { toast } = await import('sonner')
const { notStored, safeStorage } = await import('./storage')

function fakeLocalStorage(cap: number) {
  const data = new Map<string, string>()
  const used = () => [...data].reduce((n, [k, v]) => n + k.length + v.length, 0)
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem(k: string, v: string) {
      if (used() - (data.has(k) ? k.length + data.get(k)!.length : 0) + k.length + v.length > cap) throw new DOMException('full', 'QuotaExceededError')
      data.set(k, v)
    },
    removeItem: (k: string) => void data.delete(k),
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  shown.clear()
})

describe('存储空间满了', () => {
  it('写不进去：报错一次（不重复弹），读到的是新的；腾出地方后补写，提示消失', () => {
    const ls = fakeLocalStorage(100)
    vi.stubGlobal('localStorage', ls)
    safeStorage.setItem('a', 'x'.repeat(50))
    safeStorage.setItem('b', 'y'.repeat(50))
    safeStorage.setItem('b', 'z'.repeat(50))
    expect(toast.error).toHaveBeenCalledTimes(1)
    expect(notStored('b')).toBe(true)
    expect(ls.data.has('b')).toBe(false)
    expect(safeStorage.getItem('b')).toBe('z'.repeat(50))

    safeStorage.removeItem('a')
    expect(ls.data.get('b')).toBe('z'.repeat(50))
    expect(notStored('b')).toBe(false)
    expect(toast.dismiss).toHaveBeenCalledWith('storage-full')
    vi.unstubAllGlobals()
  })

  it('同一个键后来写进去了（内容变小）：提示消失', () => {
    vi.stubGlobal('localStorage', fakeLocalStorage(100))
    safeStorage.setItem('lib', 'x'.repeat(200))
    expect(notStored('lib')).toBe(true)
    safeStorage.setItem('lib', 'x'.repeat(10))
    expect(notStored('lib')).toBe(false)
    expect(toast.dismiss).toHaveBeenCalledWith('storage-full')
    vi.unstubAllGlobals()
  })

  it('提示被关掉了，再写不进去时重新出来', () => {
    vi.stubGlobal('localStorage', fakeLocalStorage(10))
    safeStorage.setItem('k', 'x'.repeat(50))
    shown.clear()
    safeStorage.setItem('k', 'y'.repeat(50))
    expect(toast.error).toHaveBeenCalledTimes(2)
    vi.unstubAllGlobals()
  })

  it('localStorage 不可用（不是空间满）：照旧退回内存，不报错', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('denied')
      },
      setItem: () => {
        throw new Error('denied')
      },
      removeItem: () => {},
    })
    safeStorage.setItem('m', '1')
    expect(safeStorage.getItem('m')).toBe('1')
    expect(toast.error).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
  })
})
