const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('lunarInstaller', {
  state: () => ipcRenderer.invoke('luns:installer-state'),
  chooseDir: () => ipcRenderer.invoke('luns:installer-dir'),
  start: (payload) => ipcRenderer.invoke('luns:installer-start', payload || {}),
  launch: () => ipcRenderer.invoke('luns:installer-launch'),
  minimize: () => ipcRenderer.invoke('luns:installer-minimize'),
  quit: () => ipcRenderer.invoke('luns:installer-quit'),
  uninstall: (payload) => ipcRenderer.invoke('luns:installer-uninstall', payload || {}),
  onEvent: (callback) => {
    const handler = (_event, payload) => callback(payload)
    ipcRenderer.on('luns:installer-event', handler)
    return () => ipcRenderer.removeListener('luns:installer-event', handler)
  },
})
