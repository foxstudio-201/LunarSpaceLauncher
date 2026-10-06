const { contextBridge, ipcRenderer, webUtils } = require('electron')

const on = (channel) => (callback) => {
  if (typeof callback !== 'function') return () => {}
  const listener = (_event, payload) => callback(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

contextBridge.exposeInMainWorld('electronAPI', {
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (patch) => ipcRenderer.invoke('settings:set', patch),
  setSecret: (name, value) => ipcRenderer.invoke('secret:set', { name, value }),
  getSecret: (name) => ipcRenderer.invoke('secret:get', { name }).then((r) => r?.value || ''),
  getAppInfo: () => ipcRenderer.invoke('app:info'),
  discordState: () => ipcRenderer.invoke('discord:state'),
  discordSelect: (instance) => ipcRenderer.invoke('discord:select', instance),
  getVersion: async () => (await ipcRenderer.invoke('app:info'))?.version || '',
  getPlatform: async () => (await ipcRenderer.invoke('app:info'))?.platform || '',

  listVersions: (opts) => ipcRenderer.invoke('launcher:versions', opts),
  listLoaderVersions: (opts) => ipcRenderer.invoke('launcher:loaders', opts),
  listLoaderGames: (opts) => ipcRenderer.invoke('launcher:loader-games', opts),
  listInstances: () => ipcRenderer.invoke('launcher:instances'),
  listAccounts: () => ipcRenderer.invoke('launcher:accounts'),
  addAccount: (opts) => ipcRenderer.invoke('launcher:account-add', opts),
  removeAccount: (opts) => ipcRenderer.invoke('launcher:account-remove', opts),
  setActiveAccount: (opts) => ipcRenderer.invoke('launcher:account-active', opts),
  systemInfo: () => ipcRenderer.invoke('launcher:system'),
  storage: () => ipcRenderer.invoke('launcher:storage'),
  createInstance: (opts) => ipcRenderer.invoke('launcher:create', opts),
  updateInstance: (opts) => ipcRenderer.invoke('launcher:update', opts),
  removeInstance: (opts) => ipcRenderer.invoke('launcher:remove', opts),
  launchInstance: (opts) => ipcRenderer.invoke('launcher:launch', opts),
  stopInstance: (opts) => ipcRenderer.invoke('launcher:stop', opts),
  instanceLogs: (opts) => ipcRenderer.invoke('launcher:logs', opts),
  runningInstances: () => ipcRenderer.invoke('launcher:running'),
  listDir: (opts) => ipcRenderer.invoke('launcher:dir', opts),
  toggleFile: (opts) => ipcRenderer.invoke('launcher:toggle-file', opts),
  deleteFile: (opts) => ipcRenderer.invoke('launcher:delete-file', opts),
  deleteFiles: (opts) => ipcRenderer.invoke('launcher:delete-files', opts),
  trashFiles: (opts) => ipcRenderer.invoke('launcher:trash-files', opts),
  listTrash: (opts) => ipcRenderer.invoke('launcher:trash-list', opts),
  restoreTrash: (opts) => ipcRenderer.invoke('launcher:trash-restore', opts),
  purgeTrash: (opts) => ipcRenderer.invoke('launcher:trash-purge', opts),
  createEntry: (opts) => ipcRenderer.invoke('launcher:create-entry', opts),
  importPaths: (opts) => ipcRenderer.invoke('launcher:import-paths', opts),
  moveEntry: (opts) => ipcRenderer.invoke('launcher:move-entry', opts),
  pathForFile: (file) => {
    try {
      return webUtils.getPathForFile(file)
    } catch {
      return ''
    }
  },
  readFile: (opts) => ipcRenderer.invoke('launcher:read-file', opts),
  writeFile: (opts) => ipcRenderer.invoke('launcher:write-file', opts),
  listJavaRuntimes: (opts) => ipcRenderer.invoke('launcher:runtimes', opts),
  installJavaRuntime: (opts) => ipcRenderer.invoke('launcher:runtime-install', opts),
  removeJavaRuntime: (opts) => ipcRenderer.invoke('launcher:runtime-remove', opts),

  modpackSearch: (opts) => ipcRenderer.invoke('launcher:modpack-search', opts),
  modpackVersions: (opts) => ipcRenderer.invoke('launcher:modpack-versions', opts),
  modpackResolve: (opts) => ipcRenderer.invoke('launcher:modpack-resolve', opts),
  modpackImport: (opts) => ipcRenderer.invoke('launcher:modpack-import', opts),
  modpackInstall: (opts) => ipcRenderer.invoke('launcher:modpack-install', opts),
  modpackRepair: (opts) => ipcRenderer.invoke('launcher:modpack-repair', opts),
  chooseModpack: () => ipcRenderer.invoke('launcher:choose-modpack'),
  exportProfile: (opts) => ipcRenderer.invoke('launcher:export-profile', opts),
  updateStatus: () => ipcRenderer.invoke('update:status'),
  updateCheck: () => ipcRenderer.invoke('update:check'),
  updateDownload: () => ipcRenderer.invoke('update:download'),
  updateInstall: () => ipcRenderer.invoke('update:install'),
  contentSearch: (opts) => ipcRenderer.invoke('launcher:content-search', opts),
  contentVersions: (opts) => ipcRenderer.invoke('launcher:content-versions', opts),
  contentProject: (opts) => ipcRenderer.invoke('launcher:content-project', opts),
  contentChangelog: (opts) => ipcRenderer.invoke('launcher:content-changelog', opts),
  contentInstall: (opts) => ipcRenderer.invoke('launcher:content-install', opts),

  getCrash: (opts) => ipcRenderer.invoke('launcher:crash', opts),
  uploadLog: (opts) => ipcRenderer.invoke('launcher:upload-log', opts),
  saveLog: (opts) => ipcRenderer.invoke('launcher:save-log', opts),

  chooseDirectory: (opts) => ipcRenderer.invoke('launcher:choose-dir', opts),
  chooseJava: () => ipcRenderer.invoke('launcher:choose-java'),
  revealPath: (target) => ipcRenderer.invoke('launcher:reveal', { target }),
  onLauncherEvent: on('luns:launcher-event'),

  clipboardWrite: (text) => ipcRenderer.invoke('clipboard:write', text),
  openExternal: (url) => ipcRenderer.invoke('shell:open', url),

  minimizeWindow: () => ipcRenderer.invoke('win:minimize'),
  closeWindow: () => ipcRenderer.invoke('win:close'),
  quitApp: () => ipcRenderer.invoke('win:quit'),
})
