const { app, BrowserWindow, ipcMain, shell, clipboard, safeStorage, dialog } = require('electron')
const path = require('path')
const fs = require('fs')

const isDev = process.env.NODE_ENV === 'development'

let mainWindow = null
let settingsCache = null

const settingsFile = () => path.join(app.getPath('userData'), 'settings.json')

function readSettings() {
  if (settingsCache) return settingsCache
  try {
    settingsCache = JSON.parse(fs.readFileSync(settingsFile(), 'utf8')) || {}
  } catch {
    settingsCache = {}
  }
  return settingsCache
}

function writeSettings(next) {
  settingsCache = { ...readSettings(), ...next }
  try {
    fs.mkdirSync(app.getPath('userData'), { recursive: true })
    fs.writeFileSync(settingsFile(), JSON.stringify(settingsCache, null, 2), 'utf8')
  } catch (err) {
    console.error('[lunaspace] failed to persist settings', err)
  }
  return settingsCache
}

function encrypt(value) {
  if (typeof value !== 'string' || !value) return null
  try {
    if (safeStorage.isEncryptionAvailable()) {
      return { v: 1, enc: true, data: safeStorage.encryptString(value).toString('base64') }
    }
  } catch {}
  return { v: 1, enc: false, data: value }
}

function decrypt(stored) {
  if (!stored || typeof stored !== 'object' || typeof stored.data !== 'string') return ''
  try {
    if (stored.enc) return safeStorage.decryptString(Buffer.from(stored.data, 'base64'))
    return stored.data
  } catch {
    return ''
  }
}

const launcher = require('./launcher.cjs')
const presence = require('./presence.cjs')
const updater = require('./updater.cjs')
const installer = require('./installer.cjs')
const tokenStore = require('./auth.cjs')
const skins = require('./skins.cjs')
const tray = require('./tray.cjs')

let hiddenForGame = false

function showWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return
  hiddenForGame = false
  mainWindow.show()
  mainWindow.focus()
}

function hideWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return
  hiddenForGame = false
  mainWindow.hide()
}

function syncGameWindow(payload) {
  if (!mainWindow || mainWindow.isDestroyed()) return
  if (payload?.type !== 'state' && payload?.type !== 'exit') return
  tray.refresh()
  if (readSettings().hideOnLaunch === false) return
  const running = (launcher.runningIds().ids || []).length > 0
  if (running && mainWindow.isVisible()) {
    hiddenForGame = true
    mainWindow.hide()
    return
  }
  if (!running && hiddenForGame) showWindow()
}

function emitLauncher(payload) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('luns:launcher-event', payload)
  syncGameWindow(payload)
}

function registerIpc() {
  ipcMain.handle('settings:get', () => readSettings())
  ipcMain.handle('settings:set', (_e, patch) => {
    const next = writeSettings(patch || {})
    presence.configure(next)
    updater.configure(next)
    return next
  })

  ipcMain.handle('update:status', () => ({ ok: true, ...updater.status() }))
  ipcMain.handle('update:check', () => ({ ...updater.check() }))
  ipcMain.handle('update:download', () => ({ ...updater.download() }))
  ipcMain.handle('update:install', () => ({ ...updater.install() }))

  ipcMain.handle('secret:set', (_e, { name, value }) => {
    if (!name) return { ok: false, error: 'Missing secret name.' }
    const current = readSettings()
    const secrets = { ...(current.secrets || {}) }
    if (value === '' || value === null || value === undefined) delete secrets[name]
    else secrets[name] = encrypt(value)
    writeSettings({ secrets })
    return { ok: true }
  })
  ipcMain.handle('secret:get', (_e, { name }) => {
    const current = readSettings()
    return { value: name ? decrypt(current.secrets?.[name]) : '' }
  })

  ipcMain.handle('discord:state', () => presence.status())
  ipcMain.handle('discord:select', (_e, instance) => {
    presence.selecting(instance || null)
    return { ok: true }
  })

  ipcMain.handle('app:info', () => ({
    version: app.getVersion(),
    platform: process.platform,
    isDev,
  }))

  ipcMain.handle('launcher:accounts', () => launcher.accountsList(readSettings()))
  ipcMain.handle('launcher:account-add', (_e, opts) => {
    const current = readSettings()
    const res = launcher.accountAdd({ name: (opts || {}).name, accounts: current.accounts, activeAccountId: current.activeAccountId })
    if (res.ok) writeSettings({ accounts: res.accounts, activeAccountId: res.activeAccountId })
    return res
  })
  ipcMain.handle('launcher:account-remove', (_e, opts) => {
    const current = readSettings()
    const res = launcher.accountRemove({ id: (opts || {}).id, accounts: current.accounts, activeAccountId: current.activeAccountId })
    if (res.ok) {
      tokenStore.setToken((opts || {}).id, null)
      writeSettings({ accounts: res.accounts, activeAccountId: res.activeAccountId })
    }
    return res
  })
  ipcMain.handle('launcher:account-signin', async (_e, opts) => {
    const current = readSettings()
    const res = await launcher.accountSignIn({
      ...(opts || {}),
      parent: mainWindow,
      accounts: current.accounts,
      activeAccountId: current.activeAccountId,
    })
    if (res.ok) writeSettings({ accounts: res.accounts, activeAccountId: res.activeAccountId })
    return res
  })
  ipcMain.handle('launcher:account-refresh', (_e, opts) => launcher.accountRefresh({ id: (opts || {}).id, accounts: readSettings().accounts }))
  ipcMain.handle('skin:resolve', (_e, opts) => skins.resolve(opts || {}))
  ipcMain.handle('launcher:account-active', (_e, opts) => {
    const current = readSettings()
    const res = launcher.accountSetActive({ id: (opts || {}).id, accounts: current.accounts, activeAccountId: current.activeAccountId })
    if (res.ok) writeSettings({ accounts: res.accounts, activeAccountId: res.activeAccountId })
    return res
  })

  ipcMain.handle('launcher:versions', (_e, opts) => launcher.getVersions({ ...(opts || {}), settings: readSettings() }))
  ipcMain.handle('launcher:loaders', (_e, opts) => launcher.getLoaderVersions({ ...(opts || {}), settings: readSettings() }))
  ipcMain.handle('launcher:loader-games', (_e, opts) => launcher.getLoaderGames(opts || {}))
  ipcMain.handle('launcher:instances', () => launcher.listInstances(readSettings()))
  ipcMain.handle('launcher:system', () => launcher.systemInfo(readSettings()))
  ipcMain.handle('launcher:storage', () => {
    const settings = readSettings()
    const { shared, defaultInstanceDir } = launcher.storageFor(settings)
    const profilesFile = launcher.launcherProfilesFile(settings)
    return {
      ok: true,
      sharedDir: shared,
      defaultInstanceDir,
      javaPath: settings.javaPath || '',
      launcherProfiles: profilesFile,
      launcherProfilesReady: fs.existsSync(profilesFile),
    }
  })
  ipcMain.handle('launcher:create', (_e, opts) => launcher.createInstance({ ...(opts || {}), settings: readSettings() }, emitLauncher))
  ipcMain.handle('launcher:update', (_e, opts) => launcher.updateInstance({ ...(opts || {}), settings: readSettings(), emit: emitLauncher }))
  ipcMain.handle('launcher:remove', (_e, opts) => launcher.removeInstance({ ...(opts || {}), settings: readSettings() }))
  ipcMain.handle('launcher:launch', (_e, opts) => launcher.launchInstance({ ...(opts || {}), settings: readSettings() }, emitLauncher))
  ipcMain.handle('launcher:stop', (_e, opts) => launcher.stopInstance(opts || {}, emitLauncher))
  ipcMain.handle('launcher:logs', (_e, opts) => launcher.getLogs(opts || {}))
  ipcMain.handle('launcher:running', () => launcher.runningIds())
  ipcMain.handle('launcher:dir', (_e, opts) => launcher.listDir(opts || {}))
  ipcMain.handle('launcher:toggle-file', (_e, opts) => launcher.toggleFile(opts || {}))
  ipcMain.handle('launcher:delete-file', (_e, opts) => launcher.deleteFile(opts || {}))
  ipcMain.handle('launcher:delete-files', (_e, opts) => launcher.deleteFiles(opts || {}))
  ipcMain.handle('launcher:trash-files', (_e, opts) => launcher.trashFiles(opts || {}))
  ipcMain.handle('launcher:trash-list', (_e, opts) => launcher.listTrash(opts || {}))
  ipcMain.handle('launcher:trash-restore', (_e, opts) => launcher.restoreTrash(opts || {}))
  ipcMain.handle('launcher:trash-purge', (_e, opts) => launcher.purgeTrash(opts || {}))
  ipcMain.handle('launcher:create-entry', (_e, opts) => launcher.createEntry(opts || {}))
  ipcMain.handle('launcher:import-paths', (_e, opts) => launcher.importPaths(opts || {}))
  ipcMain.handle('launcher:move-entry', (_e, opts) => launcher.moveEntry(opts || {}))
  ipcMain.handle('launcher:read-file', (_e, opts) => launcher.readTextFile(opts || {}))
  ipcMain.handle('launcher:write-file', (_e, opts) => launcher.writeTextFile(opts || {}))
  ipcMain.handle('launcher:runtimes', (_e, opts) => launcher.listJavaRuntimes(readSettings(), !!(opts || {}).force))
  ipcMain.handle('launcher:runtime-install', (_e, opts) => launcher.installJavaRuntime({ ...(opts || {}), settings: readSettings() }))
  ipcMain.handle('launcher:runtime-remove', (_e, opts) => launcher.removeJavaRuntime({ ...(opts || {}), settings: readSettings() }))

  ipcMain.handle('launcher:modpack-search', (_e, opts) => launcher.modpackSearch(opts || {}))
  ipcMain.handle('launcher:modpack-tags', (_e, opts) => launcher.modpackTags(opts || {}))
  ipcMain.handle('launcher:modpack-versions', (_e, opts) => launcher.modpackVersions(opts || {}))
  ipcMain.handle('launcher:modpack-resolve', (_e, opts) => launcher.modpackResolve({ ...(opts || {}), settings: readSettings() }))
  ipcMain.handle('launcher:modpack-import', (_e, opts) => launcher.modpackImport({ ...(opts || {}), settings: readSettings() }))
  ipcMain.handle('launcher:modpack-install', (_e, opts) => launcher.modpackInstall({ ...(opts || {}), settings: readSettings() }, emitLauncher))
  ipcMain.handle('launcher:modpack-repair', (_e, opts) => launcher.modpackRepair(opts || {}, emitLauncher))

  ipcMain.handle('launcher:content-search', (_e, opts) => launcher.contentSearch(opts || {}))
  ipcMain.handle('launcher:instance-mod-env', (_e, opts) => launcher.instanceModEnvs(opts || {}))
  ipcMain.handle('launcher:host-status', (_e, opts) => launcher.hostStatus(opts || {}))
  ipcMain.handle('launcher:host-install-agent', () => launcher.hostInstallAgent(emitLauncher))
  ipcMain.handle('launcher:host-set-token', (_e, opts) => launcher.hostSetToken(opts || {}))
  ipcMain.handle('launcher:host-start', (_e, opts) => launcher.hostStart(opts || {}, emitLauncher))
  ipcMain.handle('launcher:host-stop', () => launcher.hostStop())
  ipcMain.handle('launcher:content-versions', (_e, opts) => launcher.contentVersions(opts || {}))
  ipcMain.handle('launcher:export-profile', async (_e, { id, format } = {}) => {
    const settings = readSettings()
    const list = launcher.listInstances(settings)
    const entry = (list?.instances || []).find((i) => i.id === id)
    if (!entry) return { ok: false, error: 'Không tìm thấy phiên bản.' }
    const ext = format === 'mrpack' ? 'mrpack' : 'zip'
    const safe = String(entry.name || 'profile').replace(/[\/:*?"<>|]/g, '_').trim() || 'profile'
    const picked = await dialog.showSaveDialog(mainWindow, {
      title: 'Xuất profile',
      defaultPath: path.join(app.getPath('documents'), `${safe}.${ext}`),
      filters:
        format === 'mrpack'
          ? [{ name: 'Modrinth modpack', extensions: ['mrpack'] }]
          : [{ name: 'Zip', extensions: ['zip'] }],
    })
    if (picked.canceled || !picked.filePath) return { ok: false, canceled: true }
    return launcher.exportProfile({ id, format, targetPath: picked.filePath, settings }, emitLauncher)
  })

  ipcMain.handle('launcher:serverpack-plan', (_e, opts) => launcher.serverpackPlan({ ...(opts || {}), settings: readSettings() }))
  ipcMain.handle('launcher:instance-tree', (_e, opts) => launcher.instanceTree(opts || {}))
  ipcMain.handle('launcher:serverpack-walk', (_e, opts) => launcher.serverpackWalk(opts || {}))
  ipcMain.handle('launcher:serverpack-export', async (_e, { name, ...rest } = {}) => {
    const safe = String(name || 'serverpack').replace(/[\/:*?"<>|]/g, '_').trim() || 'serverpack'
    const picked = await dialog.showSaveDialog(mainWindow, {
      title: 'Xuất serverpack',
      defaultPath: path.join(app.getPath('documents'), `${safe}-serverpack.zip`),
      filters: [{ name: 'Zip', extensions: ['zip'] }],
      buttonLabel: 'Xuất',
    })
    if (picked.canceled || !picked.filePath) return { ok: false, canceled: true }
    return launcher.serverpackExport({ ...rest, targetPath: picked.filePath, settings: readSettings() }, emitLauncher)
  })

  ipcMain.handle('launcher:content-project', (_e, opts) => launcher.contentProject(opts || {}))
  ipcMain.handle('launcher:content-changelog', (_e, opts) => launcher.contentChangelog(opts || {}))
  ipcMain.handle('launcher:content-install', (_e, opts) => launcher.contentInstall(opts || {}, emitLauncher))

  ipcMain.handle('launcher:choose-modpack', async () => {
    const res = await dialog.showOpenDialog(mainWindow, {
      title: 'Chọn tệp modpack',
      properties: ['openFile'],
      filters: [{ name: 'Modpack', extensions: ['mrpack', 'zip'] }],
      buttonLabel: 'Chọn tệp',
    })
    if (res.canceled || !res.filePaths?.length) return { ok: false, canceled: true }
    return { ok: true, path: res.filePaths[0] }
  })

  ipcMain.handle('launcher:crash', (_e, opts) => launcher.getCrash(opts || {}))
  ipcMain.handle('launcher:upload-log', (_e, opts) => launcher.uploadLog(opts || {}))

  ipcMain.handle('launcher:save-log', async (_e, { text, name } = {}) => {
    const res = await dialog.showSaveDialog(mainWindow, {
      title: 'Lưu log về máy',
      defaultPath: name || 'lunaspace-log.txt',
      filters: [{ name: 'Log', extensions: ['log', 'txt'] }],
      buttonLabel: 'Lưu',
    })
    if (res.canceled || !res.filePath) return { ok: false, canceled: true }
    try {
      await fs.promises.writeFile(res.filePath, String(text ?? ''), 'utf8')
      return { ok: true, path: res.filePath }
    } catch (err) {
      return { ok: false, error: err.message }
    }
  })

  ipcMain.handle('launcher:choose-dir', async (_e, { defaultPath } = {}) => {
    const res = await dialog.showOpenDialog(mainWindow, {
      title: 'Chọn thư mục lưu instance',
      defaultPath: defaultPath || app.getPath('documents'),
      properties: ['openDirectory', 'createDirectory'],
      buttonLabel: 'Chọn thư mục',
    })
    if (res.canceled || !res.filePaths?.length) return { ok: false, canceled: true }
    return { ok: true, path: res.filePaths[0] }
  })

  ipcMain.handle('launcher:choose-java', async () => {
    const res = await dialog.showOpenDialog(mainWindow, {
      title: 'Chọn java.exe',
      properties: ['openFile'],
      filters: process.platform === 'win32' ? [{ name: 'Java', extensions: ['exe'] }] : [],
      buttonLabel: 'Chọn Java',
    })
    if (res.canceled || !res.filePaths?.length) return { ok: false, canceled: true }
    return { ok: true, path: res.filePaths[0] }
  })

  ipcMain.handle('launcher:reveal', async (_e, { target } = {}) => {
    if (!target) return { ok: false }
    try {
      await fs.promises.access(target)
      shell.showItemInFolder(target)
      return { ok: true }
    } catch {
      try {
        await shell.openPath(path.dirname(target))
        return { ok: true }
      } catch {
        return { ok: false }
      }
    }
  })

  ipcMain.handle('clipboard:write', (_e, text) => {
    try {
      clipboard.writeText(String(text ?? ''))
      return { ok: true }
    } catch {
      return { ok: false }
    }
  })

  ipcMain.handle('shell:open', (_e, url) => {
    try {
      const parsed = new URL(String(url))
      if (!/^https?:$/.test(parsed.protocol)) return { ok: false, error: 'Only http(s) links are allowed.' }
      shell.openExternal(parsed.toString())
      return { ok: true }
    } catch (err) {
      return { ok: false, error: err?.message || 'Invalid URL.' }
    }
  })

  ipcMain.handle('win:minimize', () => { mainWindow?.minimize(); return { ok: true } })
  ipcMain.handle('win:close', () => { mainWindow?.close(); return { ok: true } })
  ipcMain.handle('win:quit', () => { app.quit(); return { ok: true } })
}

function createWindow() {
  const saved = readSettings()
  const bootTheme = saved.theme === 'light' ? 'light' : 'dark'
  const bootLang = saved.language === 'en' ? 'en' : 'vi'
  const bootSkin = saved.skin === 'pixel' ? 'pixel' : 'default'
  const BOOT_BG = {
    'dark-default': '#0a0a0a',
    'light-default': '#f5f5f5',
    'dark-pixel': '#0a0d12',
    'light-pixel': '#edf2f9',
  }
  const withBootParams = (raw) => {
    const url = new URL(raw)
    url.searchParams.set('theme', bootTheme)
    url.searchParams.set('lang', bootLang)
    url.searchParams.set('skin', bootSkin)
    return url.toString()
  }

  mainWindow = new BrowserWindow({
    width: 1145,
    height: 720,
    resizable: false,
    maximizable: false,
    show: false,
    backgroundColor: BOOT_BG[`${bootTheme}-${bootSkin}`] || '#0a0a0a',
    frame: false,
    titleBarStyle: 'hidden',
    autoHideMenuBar: true,
    icon: path.join(__dirname, '..', 'public', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false,
    },
  })

  mainWindow.once('ready-to-show', () => mainWindow.show())

  if (isDev && process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(withBootParams(process.env.VITE_DEV_SERVER_URL))
  } else if (isDev) {
    mainWindow.loadURL(withBootParams('http://localhost:5175'))
    mainWindow.webContents.openDevTools({ mode: 'detach' })
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'), {
      query: { theme: bootTheme, lang: bootLang },
    })
  }

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

const MODE = installer.detectMode()

if (MODE !== 'app') {
  installer.run(MODE)
} else {
  app.whenReady().then(() => {
    registerIpc()
    createWindow()
    tray.create({
      getWindow: () => mainWindow,
      getRunning: () => {
        const ids = launcher.runningIds().ids || []
        if (!ids.length) return []
        const list = launcher.listInstances(readSettings())?.instances || []
        return ids.map((id) => list.find((item) => item.id === id)?.name || id)
      },
      getLang: () => (readSettings().language === 'en' ? 'en' : 'vi'),
      onShow: showWindow,
      onHide: hideWindow,
      onQuit: () => app.quit(),
    })
    presence.configure(readSettings())
    presence.idle()
    updater.init({ settings: readSettings(), onEvent: emitLauncher })
    launcher.syncProfiles(readSettings()).catch(() => {})

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

  app.on('before-quit', () => {
    updater.autoInstall()
    updater.shutdown()
    presence.shutdown()
    tray.destroy()
    try {
      launcher.hostStop()
    } catch {}
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}
