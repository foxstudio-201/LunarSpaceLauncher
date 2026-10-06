const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron')
const path = require('path')
const fs = require('fs')
const os = require('os')
const { execFile, spawn } = require('child_process')

const APP_EXE = 'LunarSpace Launcher.exe'
const APP_NAME = 'LunarSpace Launcher'
const PUBLISHER = 'LunarSpace'
const UNINSTALL_KEY = 'Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\LunarSpaceLauncher'
const SHELL_KEY = 'Software\\LunarSpace\\LunarSpace Launcher'
const WIN = { width: 860, height: 640 }

const hooks = !app.isPackaged
const hookEnv = (name) => (hooks && process.env[name] ? process.env[name] : '')

const localAppData = () => process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local')

const defaultInstallDir = () => hookEnv('LUNAR_INSTALL_DIR') || path.join(localAppData(), 'Programs', APP_NAME)

const sourceDir = () => hookEnv('LUNAR_INSTALL_SOURCE') || path.dirname(process.execPath)

const systemWrites = () => !(hooks && process.env.LUNAR_INSTALL_NOSYS === '1')

function reg(args) {
  return new Promise((resolve) => {
    execFile('reg.exe', args, { windowsHide: true }, (err, stdout) => resolve(err ? '' : String(stdout || '')))
  })
}

function parseRegValues(text) {
  const values = {}
  for (const line of String(text).split(/\r?\n/)) {
    const match = line.match(/^\s+(.+?)\s+(REG_[A-Z_]+)\s+(.*)$/)
    if (match) values[match[1].trim()] = match[3].trim()
  }
  return values
}

async function readInstalled() {
  if (process.platform !== 'win32') return null
  const fake = hookEnv('LUNAR_INSTALL_INSTALLED')
  if (fake) return { version: fake, dir: defaultInstallDir() }
  const text = await reg(['query', `HKCU\\${UNINSTALL_KEY}`, '/s'])
  if (!text) return null
  const values = parseRegValues(text)
  if (!values.DisplayVersion) return null
  return { version: values.DisplayVersion, dir: values.InstallLocation || defaultInstallDir() }
}

function readSettings() {
  try {
    return JSON.parse(fs.readFileSync(path.join(app.getPath('userData'), 'settings.json'), 'utf8')) || {}
  } catch {
    return {}
  }
}

function licenseText() {
  for (const file of [path.join(process.resourcesPath, 'license.txt'), path.join(__dirname, '..', 'build-resources', 'license-vi.txt')]) {
    try {
      return fs.readFileSync(file, 'utf8')
    } catch {}
  }
  return ''
}

function collectFiles(root, rel = '', out = []) {
  for (const entry of fs.readdirSync(path.join(root, rel), { withFileTypes: true })) {
    const next = rel ? path.join(rel, entry.name) : entry.name
    if (entry.isDirectory()) collectFiles(root, next, out)
    else if (entry.isFile()) out.push({ rel: next, size: fs.statSync(path.join(root, next)).size })
  }
  return out
}

function scanSource() {
  const prev = process.noAsar
  process.noAsar = true
  try {
    return collectFiles(sourceDir())
  } catch {
    return []
  } finally {
    process.noAsar = prev
  }
}

function copyStream(from, to, onBytes) {
  return new Promise((resolve, reject) => {
    const read = fs.createReadStream(from)
    const write = fs.createWriteStream(to)
    read.on('data', (chunk) => onBytes(chunk.length))
    read.on('error', reject)
    write.on('error', reject)
    write.on('close', resolve)
    read.pipe(write)
  })
}

async function copyTree(src, dest, files, onProgress) {
  const total = files.reduce((sum, file) => sum + file.size, 0)
  let done = 0
  let tick = 0
  for (const file of files) {
    const target = path.join(dest, file.rel)
    await fs.promises.mkdir(path.dirname(target), { recursive: true })
    await copyStream(path.join(src, file.rel), target, (bytes) => {
      done += bytes
      const now = Date.now()
      if (now - tick > 90) {
        tick = now
        onProgress(done, total, file.rel)
      }
    })
    onProgress(done, total, file.rel)
  }
  return total
}

function shortcutPaths() {
  const startMenu = path.join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs')
  return [
    path.join(app.getPath('desktop'), `${APP_NAME}.lnk`),
    path.join(startMenu, `${APP_NAME}.lnk`),
  ]
}

function createShortcuts(installDir) {
  if (process.platform !== 'win32') return
  const target = path.join(installDir, APP_EXE)
  for (const link of shortcutPaths()) {
    try {
      fs.mkdirSync(path.dirname(link), { recursive: true })
      shell.writeShortcutLink(link, 'create', { target, cwd: installDir, icon: target, iconIndex: 0, description: APP_NAME })
    } catch {}
  }
}

function removeShortcuts() {
  if (process.platform !== 'win32') return
  for (const link of shortcutPaths()) {
    try {
      fs.rmSync(link, { force: true })
    } catch {}
  }
}

async function writeUninstallEntry(dir, version, sizeKb) {
  const key = `HKCU\\${UNINSTALL_KEY}`
  const exe = path.join(dir, APP_EXE)
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, '')
  const values = [
    ['DisplayName', 'REG_SZ', APP_NAME],
    ['DisplayVersion', 'REG_SZ', version],
    ['Publisher', 'REG_SZ', PUBLISHER],
    ['InstallLocation', 'REG_SZ', dir],
    ['DisplayIcon', 'REG_SZ', `${exe},0`],
    ['UninstallString', 'REG_SZ', `"${exe}" --uninstall`],
    ['QuietUninstallString', 'REG_SZ', `"${exe}" --uninstall --quiet`],
    ['InstallDate', 'REG_SZ', today],
    ['EstimatedSize', 'REG_DWORD', String(Math.max(1, Math.round(sizeKb)))],
    ['NoModify', 'REG_DWORD', '1'],
    ['NoRepair', 'REG_DWORD', '1'],
  ]
  await reg(['add', key, '/f'])
  for (const [name, type, value] of values) {
    await reg(['add', key, '/v', name, '/t', type, '/d', value, '/f'])
  }
  const shellKey = `HKCU\\${SHELL_KEY}`
  await reg(['add', shellKey, '/v', 'InstallLocation', '/t', 'REG_SZ', '/d', dir, '/f'])
  await reg(['add', shellKey, '/v', 'Version', '/t', 'REG_SZ', '/d', version, '/f'])
}

async function removeRegistry() {
  await reg(['delete', `HKCU\\${UNINSTALL_KEY}`, '/f'])
  await reg(['delete', `HKCU\\${SHELL_KEY}`, '/f'])
}

function spawnCleanup(dirs) {
  const file = path.join(os.tmpdir(), `lunarspace-uninstall-${Date.now()}.cmd`)
  const lines = [
    '@echo off',
    'setlocal',
    'ping 127.0.0.1 -n 3 >nul',
    ...dirs.map((dir) => `rmdir /s /q "${dir}" 2>nul`),
    'del /f /q "%~f0" 2>nul',
    'exit /b 0',
  ]
  fs.writeFileSync(file, lines.join('\r\n'), 'utf8')
  spawn('cmd.exe', ['/c', file], { detached: true, stdio: 'ignore', windowsHide: true }).unref()
}

const state = {
  mode: 'install',
  phase: 'ready',
  appVersion: '',
  installedVersion: '',
  sourceDir: '',
  installDir: '',
  license: '',
  destFree: 0,
  needFree: 0,
  percent: 0,
  bytesDone: 0,
  totalBytes: 0,
  file: '',
  step: '',
  error: '',
  launched: false,
  removeData: false,
  autoStart: false,
}

let installerWindow = null
let running = false

const snapshot = () => ({ ...state })

function emit() {
  if (installerWindow && !installerWindow.isDestroyed()) installerWindow.webContents.send('luns:installer-event', snapshot())
}

function setState(patch, notify = true) {
  Object.assign(state, patch)
  if (notify) emit()
}

function bootParams() {
  const saved = readSettings()
  const theme = saved.theme === 'light' ? 'light' : 'dark'
  const lang = saved.language === 'en' ? 'en' : 'vi'
  const skin = saved.skin === 'pixel' ? 'pixel' : 'default'
  return { theme, lang, skin }
}

function loadWindow(win, page) {
  const isDev = process.env.NODE_ENV === 'development'
  const { theme, lang, skin } = bootParams()
  const query = { theme, lang, skin }
  if (isDev && process.env.VITE_DEV_SERVER_URL) {
    const url = new URL(page, process.env.VITE_DEV_SERVER_URL)
    for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value)
    return win.loadURL(url.toString())
  }
  if (isDev) {
    const url = new URL(page, 'http://localhost:5175')
    for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value)
    return win.loadURL(url.toString())
  }
  return win.loadFile(path.join(__dirname, '..', 'dist', page), { query })
}

function createWindow() {
  const { theme, skin } = bootParams()
  const BOOT_BG = {
    'dark-default': '#0a0a0a',
    'light-default': '#f5f5f5',
    'dark-pixel': '#0a0d12',
    'light-pixel': '#edf2f9',
  }
  installerWindow = new BrowserWindow({
    width: WIN.width,
    height: WIN.height,
    useContentSize: true,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    show: false,
    frame: false,
    backgroundColor: BOOT_BG[`${theme}-${skin}`] || '#0a0a0a',
    title: APP_NAME,
    icon: path.join(__dirname, '..', 'public', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'installer-preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false,
    },
  })
  installerWindow.once('ready-to-show', () => installerWindow.show())
  installerWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })
  installerWindow.on('closed', () => {
    installerWindow = null
  })
  return installerWindow
}

async function freeSpace(dir) {
  let target = dir
  for (let i = 0; i < 8; i += 1) {
    try {
      const stat = await fs.promises.statfs(target)
      return stat.bavail * stat.bsize
    } catch {
      const parent = path.dirname(target)
      if (parent === target) break
      target = parent
    }
  }
  return 0
}

function targetLocked(dir) {
  const exe = path.join(dir, APP_EXE)
  if (!fs.existsSync(exe)) return false
  try {
    fs.closeSync(fs.openSync(exe, 'r+'))
    return false
  } catch {
    return true
  }
}

async function waitTargetFree(dir) {
  for (let i = 0; i < 6; i += 1) {
    if (!targetLocked(dir)) return true
    await new Promise((resolve) => setTimeout(resolve, 400))
  }
  return !targetLocked(dir)
}

async function runInstall(dir) {
  if (running) return { ok: false, error: 'busy' }
  running = true
  const prevAsar = process.noAsar
  process.noAsar = true
  try {
    const source = state.sourceDir
    if (!source || !fs.existsSync(source)) throw new Error('missing source')

    const files = collectFiles(source)
    const total = files.reduce((sum, file) => sum + file.size, 0)
    const free = await freeSpace(dir)
    if (free && free < total * 1.1) throw new Error('no space')

    if (!(await waitTargetFree(dir))) throw new Error('running')

    setState({ phase: 'copy', installDir: dir, percent: 0, bytesDone: 0, totalBytes: total, file: '', step: 'files', error: '' })

    await fs.promises.mkdir(dir, { recursive: true })
    const bytes = await copyTree(source, dir, files, (done, all, file) => {
      setState({ bytesDone: done, totalBytes: all, percent: Math.min(93, Math.round((done / (all || 1)) * 93)), file, step: 'files' })
    })

    setState({ percent: 95, step: 'shortcuts', file: '' })
    if (systemWrites()) createShortcuts(dir)

    setState({ percent: 98, step: 'registry', file: '' })
    if (systemWrites()) await writeUninstallEntry(dir, state.appVersion, bytes / 1024)

    setState({ phase: 'done', percent: 100, step: 'done', bytesDone: bytes, totalBytes: bytes, file: '' })
    return { ok: true }
  } catch (err) {
    const busy = ['EBUSY', 'EPERM', 'EACCES'].includes(err?.code)
    const code = busy ? 'running' : err?.message || 'unknown'
    setState({ phase: 'error', error: code })
    return { ok: false, error: code }
  } finally {
    process.noAsar = prevAsar
    running = false
  }
}

function launchInstalled() {
  const exe = path.join(state.installDir, APP_EXE)
  if (!fs.existsSync(exe)) {
    setState({ phase: 'error', error: 'missing exe' })
    return { ok: false }
  }
  try {
    spawn(exe, [], { detached: true, stdio: 'ignore' }).unref()
  } catch (err) {
    setState({ phase: 'error', error: err?.message || 'launch failed' })
    return { ok: false }
  }
  setState({ launched: true })
  setTimeout(() => app.quit(), 300)
  return { ok: true }
}

async function runUninstall(removeData) {
  if (running) return { ok: false }
  running = true
  try {
    const installed = await readInstalled()
    const dir = installed?.dir || path.dirname(app.getPath('exe'))
    const dirs = [dir]
    if (removeData) dirs.push(app.getPath('userData'))
    if (systemWrites()) {
      removeShortcuts()
      await removeRegistry()
      spawnCleanup(dirs)
    }
    setState({ phase: 'done', percent: 100, step: 'removed', installDir: dir })
    setTimeout(() => app.quit(), 600)
    return { ok: true }
  } catch (err) {
    setState({ phase: 'error', error: err?.message || 'unknown' })
    return { ok: false }
  } finally {
    running = false
  }
}

function registerIpc() {
  ipcMain.handle('luns:installer-state', () => snapshot())
  ipcMain.handle('luns:installer-dir', async () => {
    const picked = await dialog.showOpenDialog(installerWindow, {
      title: 'Chọn thư mục cài đặt',
      defaultPath: state.installDir,
      properties: ['openDirectory', 'createDirectory'],
      buttonLabel: 'Chọn thư mục',
    })
    if (picked.canceled || !picked.filePaths?.length) return { ok: false, canceled: true }
    const dir = path.join(picked.filePaths[0], APP_NAME)
    setState({ installDir: dir })
    return { ok: true, dir }
  })
  ipcMain.handle('luns:installer-start', (_e, payload) => runInstall(String((payload || {}).dir || state.installDir)))
  ipcMain.handle('luns:installer-launch', () => launchInstalled())
  ipcMain.handle('luns:installer-minimize', () => {
    installerWindow?.minimize()
    return { ok: true }
  })
  ipcMain.handle('luns:installer-quit', () => {
    app.quit()
    return { ok: true }
  })
  ipcMain.handle('luns:installer-uninstall', (_e, payload) => runUninstall(!!(payload || {}).removeData))
}

async function startInstall() {
  const args = process.argv.slice(1)
  const fromUpdate = args.includes('--update') || args.includes('--updated')
  const installed = await readInstalled()
  const version = app.getVersion()
  const dir = installed?.dir || defaultInstallDir()
  const source = sourceDir()

  let mode = 'install'
  if (installed) mode = installed.version === version ? 'repair' : 'update'
  if (mode === 'install' && fromUpdate) mode = 'update'

  let needFree = 0
  try {
    needFree = scanSource().reduce((sum, file) => sum + file.size, 0)
  } catch {}

  Object.assign(state, {
    mode,
    phase: mode === 'install' ? 'license' : 'ready',
    appVersion: version,
    installedVersion: installed?.version || '',
    sourceDir: source,
    installDir: dir,
    license: mode === 'install' ? licenseText() : '',
    needFree,
    destFree: await freeSpace(dir),
    autoStart: fromUpdate,
  })

  registerIpc()
  createWindow()
  return loadWindow(installerWindow, 'installer.html')
}

async function startUninstall() {
  const installed = await readInstalled()
  Object.assign(state, {
    mode: 'uninstall',
    phase: 'confirm',
    appVersion: app.getVersion(),
    installedVersion: installed?.version || app.getVersion(),
    installDir: installed?.dir || path.dirname(app.getPath('exe')),
  })
  registerIpc()
  createWindow()
  return loadWindow(installerWindow, 'installer.html')
}

function detectMode() {
  const args = process.argv.slice(1)
  if (args.includes('--uninstall')) return 'uninstall'
  if (process.env.PORTABLE_EXECUTABLE_DIR) return 'install'
  if (hooks && args.includes('--install')) return 'install'
  return 'app'
}

function run(mode) {
  app.on('window-all-closed', () => app.quit())
  app.whenReady().then(() => (mode === 'uninstall' ? startUninstall() : startInstall()))
  app.on('second-instance', () => {
    if (installerWindow && !installerWindow.isDestroyed()) installerWindow.focus()
  })
}

module.exports = { detectMode, run }
