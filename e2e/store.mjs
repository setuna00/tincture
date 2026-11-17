// Set the pe-test cookie immediately after creating each context; production rejects it, preventing tests from touching the real library.
import { randomUUID } from 'node:crypto'

export const E2E_URL = process.env.E2E_URL ?? 'http://localhost:5190/'

export async function blockAI(context) {
  await context.route(/novelai\.net|api\.deepseek\.com|openai\.com|anthropic\.com|googleapis\.com|\/api\/ai\//, (route) => route.abort())
}

export async function isolate(context, url = E2E_URL) {
  // Shared-server Vite reloads can replace the page mid-test; suppress them when freezing an unattended run.
  if (process.env.E2E_NO_HMR === '1') await context.route('**/@vite/client', async (route) => {
    const response = await route.fetch()
    await route.fulfill({ response, body: (await response.text()).replaceAll('location.reload()', 'void 0') })
  })
  if (process.env.E2E_BLOCK_AI === '1') await blockAI(context)
  await context.addCookies([{ name: 'pe-test', value: randomUUID().slice(0, 12), url: new URL(url).origin }])
  // Vite HMR adds ?t= to module URLs; importing the loaded URL avoids a second storage instance that reads empty data and never flushes.
  await context.addInitScript(() => {
    performance.setResourceTimingBufferSize(10000)
    window.__peImport = (path) => import(performance.getEntriesByType('resource').map((e) => e.name).find((n) => new URL(n).pathname === path) ?? path)
  })
}

export async function resetStore(page, { theme, prefs, nai, kv = {}, seed = 'examples', idb = true } = {}) {
  const lib = Object.fromEntries(Object.entries(kv).map(([k, v]) => [k, typeof v === 'string' ? v : JSON.stringify(v)]))
  if ((theme || prefs) && !lib['pe:prefs']) lib['pe:prefs'] = JSON.stringify({ state: { ...(theme ? { theme } : {}), ...prefs }, version: 0 })
  await page.evaluate(
    async ({ lib, nai, seed, idb, browserOnly }) => {
      localStorage.clear()
      if (seed) localStorage.setItem('pe:seed', seed)
      if (nai) localStorage.setItem('pe:nai', typeof nai === 'string' ? nai : JSON.stringify(nai))
      if (idb) indexedDB.deleteDatabase('keyval-store')
      if (browserOnly) return void Object.entries(lib).forEach(([k, v]) => localStorage.setItem(k, v))
      const r = await fetch('/api/test/reset', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kv: lib }) })
      if (!r.ok) throw new Error(`/api/test/reset ${r.status}：服务器不是测试模式（npm run dev:test），不在真实图库上跑`)
    },
    { lib, nai, seed, idb, browserOnly: !!process.env.PREVIEW },
  )
}

export const stored = (page, key) => page.evaluate(async (key) => (await window.__peImport('/src/store/storage.ts')).safeStorage.getItem(key), key)

export const settled = (page) => page.evaluate(async () => (await window.__peImport('/src/store/storage.ts')).settleWrites())
