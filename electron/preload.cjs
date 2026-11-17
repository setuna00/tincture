// Electron's sandboxed preload requires CommonJS, so this bridge must remain a .cjs file.
const { contextBridge, ipcRenderer } = require('electron')

if (process.argv.includes('--pe-dark')) {
  const mark = () => document.documentElement?.classList.add('dark')
  if (document.documentElement) mark()
  // Preload can run before the root element exists; observe its creation to apply the theme before the first paint.
  new MutationObserver((_, ob) => {
    if (!document.documentElement) return
    mark()
    ob.disconnect()
  }).observe(document, { childList: true })
}

contextBridge.exposeInMainWorld('peApp', {
  setTheme: (theme) => ipcRenderer.send('pe:theme', theme),
  token: {
    get: () => ipcRenderer.invoke('pe:token-get'),
    set: (token) => ipcRenderer.invoke('pe:token-set', token),
  },
  aiKeys: {
    get: () => ipcRenderer.invoke('pe:ai-keys-get'),
    set: (keys) => ipcRenderer.invoke('pe:ai-keys-set', keys),
  },
  pickFolder: (current) => ipcRenderer.invoke('pe:pick-folder', current),
  flash: () => ipcRenderer.send('pe:flash'),
  dragOut: {
    find: (key) => ipcRenderer.invoke('pe:drag-find', key),
    write: (file) => ipcRenderer.invoke('pe:drag-write', file),
    start: (paths, icon, scale) => ipcRenderer.send('pe:drag-start', { paths, icon, scale }),
    onEnd: (cb) => ipcRenderer.on('pe:drag-end', () => cb()),
  },
  // Await the renderer flush before acknowledging close; echo the attempt id so reopening invalidates stale acknowledgements.
  onBeforeClose: (cb) => {
    ipcRenderer.on('pe:before-close', async (_e, id) => {
      try {
        await cb()
      } finally {
        ipcRenderer.send('pe:close-ready', id)
      }
    })
    ipcRenderer.send('pe:can-flush')
  },
})
