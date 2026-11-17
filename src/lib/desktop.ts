export interface DesktopApp {
  setTheme(theme: { shell: string; symbol: string }): void
  /** Tokens must remain in OS-encrypted storage; reject writes when OS encryption is unavailable. */
  token: { get(): Promise<string>; set(token: string): Promise<void> }
  /** AI keys use the same encrypted storage as NAI tokens; the payload is a service-id-to-key JSON map. */
  aiKeys: { get(): Promise<string>; set(keys: string): Promise<void> }
  pickFolder(current: string): Promise<string | null>
  dragOut: {
    find(key: string): Promise<string | null>
    write(file: { key: string; name: string; ext: string; bytes: Uint8Array }): Promise<string>
    start(paths: string[], icon: Uint8Array, scale: number): void
    onEnd(cb: () => void): void
  }
  flash(): void
  /** The main process hides the window and awaits cb so generation and pending library writes finish before exit. */
  onBeforeClose(cb: () => Promise<void>): void
}

export const desktop: DesktopApp | undefined = typeof window !== 'undefined' ? (window as { peApp?: DesktopApp }).peApp : undefined

/** Electron requires hex colors; CSS tokens may use oklch. */
function toHex(color: string, ctx: CanvasRenderingContext2D): string {
  ctx.clearRect(0, 0, 1, 1)
  ctx.fillStyle = color
  ctx.fillRect(0, 0, 1, 1)
  const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data
  return `#${[r, g, b].map((n) => n.toString(16).padStart(2, '0')).join('')}`
}

export function syncWindowTheme() {
  if (!desktop) return
  const ctx = document.createElement('canvas').getContext('2d', { willReadFrequently: true })
  if (!ctx) return
  let last = ''
  const send = () => {
    const css = getComputedStyle(document.documentElement)
    const dim = document.documentElement.hasAttribute('data-dim')
    const theme = { shell: toHex(css.getPropertyValue('--shell'), ctx), symbol: dim ? '#e6e6e6' : toHex(css.getPropertyValue('--ink-1'), ctx) }
    const key = `${theme.shell}${theme.symbol}`
    if (key === last) return
    last = key
    desktop!.setTheme(theme)
  }
  new MutationObserver(send).observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'style', 'data-dim'] })
  send()
}
