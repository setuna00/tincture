import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { toast } from 'sonner'

const { fake, shown } = vi.hoisted(() => {
  const box = () => {
    const b = {
      value: '',
      fail: false,
      get: vi.fn(async () => b.value),
      set: vi.fn(async (v: string) => {
        if (b.fail) throw new Error('系统加密不可用')
        b.value = v
      }),
    }
    return b
  }
  return { fake: { enabled: true, token: box(), aiKeys: box() }, shown: new Set<string>() }
})
vi.mock('@/lib/desktop', () => ({ get desktop() { return fake.enabled ? fake : undefined } }))
vi.mock('sonner', () => ({
  toast: {
    error: vi.fn((_: string, o: { id: string }) => shown.add(o.id)),
    dismiss: vi.fn((id: string) => shown.delete(id)),
    getToasts: () => [...shown].map((id) => ({ id })),
  },
}))

const data = new Map<string, string>()
vi.stubGlobal('localStorage', {
  getItem: (k: string) => data.get(k) ?? null,
  setItem: (k: string, v: string) => void data.set(k, v),
  removeItem: (k: string) => void data.delete(k),
})
const { safeStorage, startSecrets } = await import('./storage')

const aiState = (services: object[], extra: object = {}) => JSON.stringify({ state: { services, current: null, rules: [], analysis: false, ...extra }, version: 1 })
const flush = () => new Promise((ok) => setTimeout(ok, 0))

beforeAll(async () => {
  data.set('pe:ai', aiState([{ id: 'ai_1', preset: 'deepseek', url: '', model: 'deepseek-chat', key: 'sk-old-1' }, { id: 'ai_2', preset: 'novelai', url: '', model: 'glm-4-6', key: '' }]))
  data.set('pe:nai', JSON.stringify({ state: { token: 'pst-old', stream: false }, version: 1 }))
  await startSecrets()
})

describe('API Key（pe:ai）', () => {
  it('启动时：localStorage 里的明文搬进加密存储，localStorage 只留空的；读的时候拼回去', () => {
    expect(fake.aiKeys.value).toBe('{"ai_1":"sk-old-1"}')
    expect(data.get('pe:ai')).not.toContain('sk-old-1')
    expect(JSON.parse(data.get('pe:ai')!).state.services.map((s: { key: string }) => s.key)).toEqual(['', ''])
    const back = JSON.parse(safeStorage.getItem('pe:ai')!)
    expect(back.state.services.map((s: { key: string }) => s.key)).toEqual(['sk-old-1', ''])
    expect(back.version).toBe(1)
  })

  it('写：key 变了交给主进程（{ 服务 id: key }），别的设置照旧进 localStorage；没变不重复存', async () => {
    fake.aiKeys.set.mockClear()
    safeStorage.setItem('pe:ai', aiState([{ id: 'ai_1', preset: 'deepseek', url: '', model: 'deepseek-chat', key: 'sk-new-1' }, { id: 'ai_3', preset: 'custom', url: 'http://localhost:11434/v1', model: 'qwen3', key: 'k3' }], { analysis: true }))
    await flush()
    expect(fake.aiKeys.value).toBe('{"ai_1":"sk-new-1","ai_3":"k3"}')
    const local = data.get('pe:ai')!
    expect(local).not.toMatch(/sk-new-1|"k3"/)
    expect(JSON.parse(local).state).toMatchObject({ analysis: true, services: [{ id: 'ai_1', key: '' }, { id: 'ai_3', key: '', url: 'http://localhost:11434/v1' }] })
    safeStorage.setItem('pe:ai', aiState([{ id: 'ai_1', preset: 'deepseek', url: '', model: 'deepseek-reasoner', key: 'sk-new-1' }, { id: 'ai_3', preset: 'custom', url: '', model: 'qwen3', key: 'k3' }]))
    expect(fake.aiKeys.set).toHaveBeenCalledTimes(1)
  })

  it('一个 key 都没有了 = 删掉加密的那份（set 空串）', async () => {
    safeStorage.setItem('pe:ai', aiState([{ id: 'ai_2', preset: 'novelai', url: '', model: 'glm-4-6', key: '' }]))
    await flush()
    expect(fake.aiKeys.set).toHaveBeenLastCalledWith('')
    expect(fake.aiKeys.value).toBe('')
  })

  it('主进程存不进去：提示仅在本次运行中保留，localStorage 里不留 key', async () => {
    fake.aiKeys.fail = true
    safeStorage.setItem('pe:ai', aiState([{ id: 'ai_1', preset: 'deepseek', url: '', model: 'deepseek-chat', key: 'sk-x' }]))
    await flush()
    expect(shown.has('secret-failed:pe:ai')).toBe(true)
    expect(toast.error).toHaveBeenCalledWith('无法用系统加密保存 API Key，仅在本次运行中保留', { id: 'secret-failed:pe:ai' })
    expect(data.get('pe:ai')).not.toContain('sk-x')
    fake.aiKeys.fail = false
  })
})

describe('NAI token（pe:nai）照旧', () => {
  it('启动时搬走明文；写进来的 token 交给主进程，localStorage 里是空的', async () => {
    expect(fake.token.value).toBe('pst-old')
    expect(JSON.parse(data.get('pe:nai')!).state).toEqual({ token: '', stream: false })
    expect(JSON.parse(safeStorage.getItem('pe:nai')!).state.token).toBe('pst-old')
    safeStorage.setItem('pe:nai', JSON.stringify({ state: { token: 'pst-new', stream: true }, version: 1 }))
    await flush()
    expect(fake.token.value).toBe('pst-new')
    expect(JSON.parse(data.get('pe:nai')!).state).toEqual({ token: '', stream: true })
  })

  it('localStorage 被清过：token 照样拼得出来', () => {
    data.delete('pe:nai')
    expect(JSON.parse(safeStorage.getItem('pe:nai')!).state.token).toBe('pst-new')
  })
})

describe('密钥存储失败的恢复边界', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    data.clear()
    shown.clear()
    fake.enabled = true
    for (const box of [fake.token, fake.aiKeys]) {
      box.value = ''
      box.fail = false
      box.get.mockReset().mockImplementation(async () => box.value)
    }
  })
  afterEach(() => { fake.enabled = true })

  const cases = [
    { key: 'pe:nai', box: fake.token, label: 'NAI 令牌', state: (secret: string) => JSON.stringify({ state: { token: secret, stream: true }, version: 1 }) },
    { key: 'pe:ai', box: fake.aiKeys, label: 'API Key', state: (secret: string) => aiState([{ id: 'ai_1', key: secret, model: 'test-model' }], { analysis: true }) },
  ]

  describe.each(cases)('$label', ({ key, box, label, state }) => {
    it.each(['get', 'set'] as const)('迁移 %s 失败后编辑：旧明文原样保留，新值仅留在内存', async (operation) => {
      const original = state('legacy-secret-marker')
      data.set(key, original)
      if (operation === 'get') box.get.mockRejectedValueOnce(new Error('Unavailable'))
      else box.fail = true
      const storage = await import('./storage')
      const write = vi.spyOn(localStorage, 'setItem')
      try {
        await storage.startSecrets()
        expect(storage.safeStorage.getItem(key)).toBe(original)
        expect(toast.error).toHaveBeenCalledWith(`无法用系统加密保存 ${label}，仅在本次运行中保留`, { id: `secret-failed:${key}` })
        for (const secret of ['edited-secret-marker', 'second-edit-marker']) {
          const edited = state(secret)
          storage.safeStorage.setItem(key, edited)
          await flush()
          expect(storage.safeStorage.getItem(key)).toBe(edited)
          expect(data.get(key)).toBe(original)
        }
        expect(write).not.toHaveBeenCalled()
      } finally {
        write.mockRestore()
      }
    })

    it('加密迁移成功后写入失败：保留内存新值，持久化内容不含密钥', async () => {
      data.set(key, state('legacy-secret-marker'))
      const storage = await import('./storage')
      await storage.startSecrets()
      expect(box.value).toContain('legacy-secret-marker')
      expect(data.get(key)).not.toContain('legacy-secret-marker')
      box.fail = true
      for (const secret of ['edited-secret-marker', 'second-edit-marker']) {
        const edited = state(secret)
        storage.safeStorage.setItem(key, edited)
        await flush()
        expect(storage.safeStorage.getItem(key)).toBe(edited)
        expect(data.get(key)).not.toContain(secret)
      }
      expect(box.value).toContain('legacy-secret-marker')
      expect(toast.error).toHaveBeenCalledWith(`无法用系统加密保存 ${label}，仅在本次运行中保留`, { id: `secret-failed:${key}` })
    })

    it('没有桌面桥：明文继续保存到浏览器 localStorage', async () => {
      fake.enabled = false
      const storage = await import('./storage')
      await storage.startSecrets()
      const value = state('browser-secret-marker')
      storage.safeStorage.setItem(key, value)
      expect(data.get(key)).toBe(value)
      expect(storage.safeStorage.getItem(key)).toBe(value)
      expect(box.set).not.toHaveBeenCalled()
      expect(toast.error).not.toHaveBeenCalled()
    })
  })
})
