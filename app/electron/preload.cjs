const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('luzzleDesktop', {
  isDesktop: true,
  platform: process.platform,
  getSecret: () => ipcRenderer.invoke('luzzle:secret:get'),
  setSecret: (val) => ipcRenderer.invoke('luzzle:secret:set', String(val ?? '')),
  writeAutoBackup: (json, day) => ipcRenderer.invoke('luzzle:backup:auto', String(json ?? ''), String(day ?? '')),
  openBackupsFolder: () => ipcRenderer.invoke('luzzle:backup:open-dir'),
  onMenuAction: (cb) => {
    const handler = (_ev, action, payload) => cb(action, payload)
    ipcRenderer.on('luzzle:menu', handler)
    return () => ipcRenderer.removeListener('luzzle:menu', handler)
  },
})
