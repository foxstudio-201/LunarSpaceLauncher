const { app } = require('electron')
const { spawn } = require('child_process')
const fs = require('fs')

let updater = null
let loadError = null
try {
  updater = require('electron-updater').autoUpdater
} catch (err) {
  loadError = err.message
}

const CHECK_EVERY_MS = 30 * 60 * 1000
const BOOT_DELAY_MS = 12 * 1000

const state = {
  enabled: true,
  supported: false,
  phase: 'idle',
  current: '',
  version: '',
  percent: 0,
  bytesDone: 0,
  totalBytes: 0,
  error: '',
  checkedAt: '',
  releaseNotes: '',
}

let emit = () => {}
let timer = null
let bootTimer = null
let installing = false

function snapshot() {
  return { ...state }
}

function setState(patch, event) {
  Object.assign(state, patch)
  if (event) emit({ type: 'update', ...snapshot(), ...event })
  else emit({ type: 'update', ...snapshot() })
}

function releaseNotes(info) {
  const notes = info?.releaseNotes
  if (!notes) return ''
  if (typeof notes === 'string') return notes.slice(0, 4000)
  if (Array.isArray(notes)) return notes.map((n) => n?.note || '').join('\n').slice(0, 4000)
  return ''
}

function attach() {
  if (!updater) return
  updater.autoDownload = false
  updater.autoInstallOnAppQuit = false
  updater.disableDifferentialDownload = true
  updater.disableWebInstaller = true
  updater.allowPrerelease = false
  updater.logger = null

  updater.on('checking-for-update', () => {
    setState({ phase: 'checking', error: '' }, { event: 'checking' })
  })
  updater.on('update-available', (info) => {
    setState(
      { phase: 'available', version: info?.version || '', releaseNotes: releaseNotes(info), error: '' },
      { event: 'available' },
    )
    if (state.enabled) download()
  })
  updater.on('update-not-available', () => {
    setState({ phase: 'current', version: '', checkedAt: new Date().toISOString(), error: '' }, { event: 'current' })
  })
  updater.on('download-progress', (p) => {
    setState(
      {
        phase: 'downloading',
        percent: Math.max(0, Math.min(100, p?.percent || 0)),
        bytesDone: p?.transferred || 0,
        totalBytes: p?.total || 0,
      },
      { event: 'progress' },
    )
  })
  updater.on('update-downloaded', (info) => {
    setState({ phase: 'ready', version: info?.version || state.version, percent: 100 }, { event: 'ready' })
  })
  updater.on('error', (err) => {
    setState({ phase: 'error', error: String(err?.message || err).slice(0, 300) }, { event: 'error' })
  })
}

function schedule() {
  if (timer) clearInterval(timer)
  if (!state.supported || !state.enabled) return
  timer = setInterval(() => check(), CHECK_EVERY_MS)
}

function check() {
  if (!state.supported) {
    return { ok: false, error: 'Launcher chưa được cài (chỉ cập nhật được khi chạy bản đã cài).' }
  }
  if (state.phase === 'downloading') return { ok: true, phase: state.phase }
  setState({ phase: 'checking', error: '' }, { event: 'checking' })
  updater.checkForUpdates().catch((err) => {
    setState({ phase: 'error', error: String(err?.message || err).slice(0, 300) }, { event: 'error' })
  })
  return { ok: true }
}

function download() {
  if (!state.supported || state.phase === 'downloading') return { ok: false, error: 'Không tải được.' }
  setState({ phase: 'downloading', percent: 0, bytesDone: 0, totalBytes: 0 }, { event: 'progress' })
  updater.downloadUpdate().catch((err) => {
    setState({ phase: 'error', error: String(err?.message || err).slice(0, 300) }, { event: 'error' })
  })
  return { ok: true }
}

function installerFile() {
  const file = updater?.installerPath
  if (!file) return ''
  try {
    return fs.statSync(file).isFile() ? file : ''
  } catch {
    return ''
  }
}

function spawnInstaller() {
  const file = installerFile()
  if (!file) return false
  try {
    spawn(file, ['--update'], { detached: true, stdio: 'ignore' }).unref()
    return true
  } catch {
    return false
  }
}

function install() {
  if (!state.supported) {
    return { ok: false, error: 'Launcher chưa được cài (chỉ cập nhật được khi chạy bản đã cài).' }
  }
  if (installing) return { ok: true }
  if (state.phase !== 'ready') return { ok: false, error: 'Chưa có bản cập nhật nào sẵn sàng.' }
  if (!installerFile()) return { ok: false, error: 'Không tìm thấy bộ cài đã tải.' }
  installing = true
  setImmediate(() => {
    if (!spawnInstaller()) {
      installing = false
      setState({ phase: 'error', error: 'Không mở được trình cài đặt.' }, { event: 'error' })
      return
    }
    setTimeout(() => app.quit(), 350)
  })
  return { ok: true }
}

function autoInstall() {
  if (installing || !state.supported || !state.enabled || state.phase !== 'ready') return false
  installing = true
  if (!spawnInstaller()) {
    installing = false
    return false
  }
  return true
}

function configure(settings = {}) {
  const enabled = settings.autoUpdate !== false
  const changed = enabled !== state.enabled
  state.enabled = enabled
  if (updater) updater.autoDownload = false
  schedule()
  if (changed && enabled && state.supported && state.phase === 'current') check()
  return { ok: true, enabled }
}

function init({ settings, onEvent } = {}) {
  emit = typeof onEvent === 'function' ? onEvent : () => {}
  state.current = app.getVersion()
  state.supported = app.isPackaged
  state.enabled = settings?.autoUpdate !== false
  state.error = loadError ? `Không nạp được trình cập nhật: ${loadError}` : ''
  if (!updater) {
    setState({ phase: 'error' }, { event: 'error' })
    return
  }
  attach()
  if (!state.supported) {
    setState({ phase: 'unsupported' })
    return
  }
  schedule()
  bootTimer = setTimeout(() => {
    if (state.enabled) check()
  }, BOOT_DELAY_MS)
}

function shutdown() {
  if (timer) clearInterval(timer)
  if (bootTimer) clearTimeout(bootTimer)
  timer = null
  bootTimer = null
}

module.exports = { init, configure, check, download, install, autoInstall, status: snapshot, shutdown }
