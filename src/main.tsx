// Stores write whole snapshots, so concurrent pages can overwrite each other; acquire pe-app before importing stores.
// Hydrate backend storage before importing stores because their initializers synchronously read persisted state.
import { createRoot } from 'react-dom/client'
import { toast } from 'sonner'
import './index.css'
import { desktop, syncWindowTheme } from './lib/desktop'
import { applyTokenOverrides, loadTokenOverrides } from './lib/token-overrides'
import { BootError, loadStorage, safeStorage, settleWrites, startStorage } from './store/storage'

syncWindowTheme()

const LOCK = 'pe-app'

let booted: Promise<unknown> | undefined
const boot = () => (booted ??= start())
const hold = () => new Promise<never>(() => {})

if (!navigator.locks) void boot()
else
  navigator.locks
    .request(LOCK, { ifAvailable: true }, (lock) => {
      if (lock) {
        void boot()
        return hold()
      }
      const notice = loadStorage()
        .catch(() => {})
        .then(() => showNotice('已在另一个浏览器标签页中打开', '关闭另一个标签页后将自动加载', 'other-tab'))
      void navigator.locks.request(LOCK, () => {
        void boot().finally(() => void notice.then((n) => n.close()))
        return hold()
      })
    })
    .catch(boot)

async function start() {
  let notice: Notice | null = null
  let migrated = null
  for (;;) {
    try {
      migrated = await startStorage(() => {
        notice ??= showNotice('正在将数据移至图库文件夹', '', 'migrating')
        return (done, total) => notice?.set('正在将数据移至图库文件夹', `${done} / ${total}`)
      })
      break
    } catch (e) {
      if (e instanceof BootError) {
        const [title, sub] =
          e.kind === 'offline'
            ? ['无法连接本地服务', '本地服务启动后将自动加载']
            : e.kind === 'locked'
              ? ['图库文件夹已被另一个窗口使用', '关闭另一个窗口后将自动加载']
              : ['无法打开图库文件夹', e.dir ?? '']
        if (notice) notice.set(title, sub)
        else notice = showNotice(title, sub, 'boot-error')
        await new Promise((r) => setTimeout(r, 2000))
        continue
      }
      console.error(e)
      const msg = '无法将数据移至图库文件夹'
      if (notice) notice.set(msg, '浏览器中的数据未改动，请刷新页面重试')
      else showNotice(msg, '浏览器中的数据未改动，请刷新页面重试', 'boot-error')
      return hold()
    }
  }
  const { ready } = await import('./boot')
  await ready
  // Wait for generation and all document/image/chat writes before allowing Electron to exit; unload keepalive cannot guarantee persistence.
  desktop?.onBeforeClose(async () => {
    const [{ flushDocWrites }, { useGen }] = await Promise.all([import('./store/tabs'), import('./store/gen')])
    flushDocWrites()
    if (useGen.getState().running)
      await new Promise<void>((done) => {
        const off = useGen.subscribe((s) => {
          if (s.running) return
          off()
          done()
        })
      })
    flushDocWrites()
    await settleWrites()
  })
  ;(notice as Notice | null)?.close()
  if (migrated) setTimeout(() => toast('已将数据移至图库文件夹'), 300)
}

interface Notice {
  set(title: string, sub: string): void
  close(): void
}

function showNotice(title: string, sub: string, testId: string): Notice {
  applyTokenOverrides(loadTokenOverrides())
  applyStoredTheme()
  const el = document.createElement('div')
  document.body.append(el)
  const root = createRoot(el)
  const render = (t: string, s: string) =>
    root.render(
      <div className="fixed inset-0 z-50 grid place-items-center bg-shell transition-opacity duration-200 data-closing:opacity-0" data-testid={testId}>
        <div className="flex animate-in flex-col items-center gap-1.5 duration-200 fade-in-0">
          <p className="text-[13px] font-medium text-ink-1">{t}</p>
          {s && <p className="text-[13px] text-ink-2 tabular-nums">{s}</p>}
        </div>
      </div>,
    )
  render(title, sub)
  return {
    set: render,
    close() {
      el.firstElementChild?.setAttribute('data-closing', '')
      setTimeout(() => {
        root.unmount()
        el.remove()
      }, 200)
    },
  }
}

/** Read theme without importing stores, which must wait for storage hydration and the app lock. */
function applyStoredTheme() {
  let theme = 'system'
  try {
    let raw = safeStorage.getItem('pe:prefs')
    try {
      raw ??= localStorage.getItem('pe:prefs')
    } catch {
    }
    theme = (JSON.parse(raw ?? '{}') as { state?: { theme?: string } }).state?.theme ?? theme
  } catch {
  }
  const root = document.documentElement
  const forced = root.getAttribute('data-theme')
  const dark = forced ? forced === 'dark' : theme === 'system' ? matchMedia('(prefers-color-scheme: dark)').matches : theme === 'dark'
  root.classList.toggle('dark', dark)
}
