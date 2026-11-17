export type SettingsPageId = 'account' | 'gen' | 'defaults' | 'content' | 'ai' | 'library' | 'about'

let pending: { page: SettingsPageId; target: string } | null = null

export function openSettings(page: SettingsPageId, target = '') {
  pending = { page, target }
  location.hash = '/settings'
}

/** React StrictMode calls state initializers twice; consume the target in an effect, not during initialization. */
export const pendingSettingsPage = () => pending?.page ?? null
export const pendingSettingsTarget = () => pending?.target ?? ''
export const clearSettingsPage = () => void (pending = null)
