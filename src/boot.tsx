// Import stores only after acquiring the app lock so they cannot read stale data or overwrite another page.
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import { loadCharWorks } from './lib/char-works'
import { initTagDb, setNsfwLevel } from './lib/tagdb'
import { gcTemplateImages } from './lib/template-images'
import { applyTokenOverrides, loadTokenOverrides } from './lib/token-overrides'
import { useLibrary } from './store/library'
import { applyPrefsToRoot, NSFW_MAX_LEVEL, usePrefs } from './store/prefs'

applyTokenOverrides(loadTokenOverrides())
applyPrefsToRoot(usePrefs.getState())
usePrefs.subscribe((p) => applyPrefsToRoot(p))
setNsfwLevel(NSFW_MAX_LEVEL[usePrefs.getState().nsfw])
usePrefs.subscribe((p) => setNsfwLevel(NSFW_MAX_LEVEL[p.nsfw]))
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => applyPrefsToRoot(usePrefs.getState()))
new MutationObserver(() => applyPrefsToRoot(usePrefs.getState())).observe(document.documentElement, {
  attributes: true,
  attributeFilter: ['data-theme'],
})

export const ready = initTagDb().finally(() => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
  setTimeout(() => void loadCharWorks(), 0)
})

const templateImageKeys = () => {
  const lib = useLibrary.getState()
  return [...lib.sectionTemplates, ...lib.characterTemplates].flatMap((t) => (t.imageKey ? [t.imageKey] : []))
}
const imagesAtStart = templateImageKeys()
setTimeout(() => void gcTemplateImages(imagesAtStart, templateImageKeys), 3000)
