export const TEXT_HINT = '逗号分隔，末尾逗号可有可无 · 点击外部 / Ctrl+↵ / Esc 完成并拆分为 tag'

export function subscribePanelFocus(update: () => void) {
  const events = ['pointerover', 'pointerout', 'focusin', 'focusout']
  for (const event of events) document.addEventListener(event, update, true)
  window.addEventListener('resize', update)
  return () => {
    for (const event of events) document.removeEventListener(event, update, true)
    window.removeEventListener('resize', update)
  }
}
