const { app, BrowserWindow, ipcMain, shell, clipboard, safeStorage, dialog, protocol } = require('electron')
const path = require('path')
const fs = require('fs')

const isDev = process.env.NODE_ENV === 'development'

let mainWindow = null
let settingsCache = null

protocol.registerSchemesAsPrivileged([
  { scheme: 'lsicon', privileges: { standard: true, secure: true, supportFetchAPI: true, bypassCSP: false } },
  { scheme: 'lsmap', privileges: { standard: true, secure: true, supportFetchAPI: true, bypassCSP: false } },
])

const ICON_MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif' }

function serveCache(request, folder) {
  let name = ''
  try {
    name = decodeURIComponent(new URL(request.url).pathname).replace(/^\/+/, '').replace(/[^A-Za-z0-9._-]/g, '')
  } catch {
    name = ''
  }
  const ext = path.extname(name).toLowerCase()
  if (!name || !ICON_MIME[ext]) return new Response('', { status: 404 })
  const file = path.join(app.getPath('userData'), folder, name)
  try {
    const data = fs.readFileSync(file)
    return new Response(data, { status: 200, headers: { 'Content-Type': ICON_MIME[ext], 'Cache-Control': 'no-cache' } })
  } catch {
    return new Response('', { status: 404 })
  }
}

function serveIcon(request) {
  let key = ''
  try {
    key = decodeURIComponent(new URL(request.url).pathname).replace(/^\/+/, '').replace(/[^A-Za-z0-9._-]/g, '')
  } catch {
    key = ''
  }
  const ext = path.extname(key).toLowerCase()
  if (!key || !ICON_MIME[ext]) return new Response('', { status: 404 })
  const file = path.join(app.getPath('userData'), 'icon-cache', key)
  try {
    const data = fs.readFileSync(file)
    return new Response(data, { status: 200, headers: { 'Content-Type': ICON_MIME[ext], 'Cache-Control': 'no-cache' } })
  } catch {
    return new Response('', { status: 404 })
  }
}

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
const discordLink = require('./discordlink.cjs')
const discordPage = require('./discordpage.cjs')

let hiddenForGame = false
let lastDiscordEvent = null

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

const DISCORD_PENDING_TTL = 20 * 60 * 1000

function discordCredentials() {
  const current = readSettings()
  return {
    apiUrl: current.discord?.apiUrl || discordLink.DEFAULT_API_URL,
    apiKey: decrypt(current.secrets?.discordApiKey) || discordLink.DEFAULT_API_KEY,
  }
}

function readPendingLink() {
  const pending = readSettings().discordPending
  if (!pending?.state) return null
  if (Date.now() - Number(pending.at || 0) > DISCORD_PENDING_TTL) return null
  return pending
}

function writePendingLink(pending) {
  writeSettings({ discordPending: pending })
}

function findAccount(id) {
  const current = readSettings()
  return (Array.isArray(current.accounts) ? current.accounts : []).find((item) => item.id === id) || null
}

function findAccountByName(name) {
  const wanted = String(name || '').trim().toLowerCase()
  if (!wanted) return null
  const current = readSettings()
  return (Array.isArray(current.accounts) ? current.accounts : []).find((item) => String(item.name || '').toLowerCase() === wanted) || null
}

function accountPayload(account) {
  return { id: account.id, name: account.name, uuid: account.uuid, type: account.type }
}

async function resolveLinkAccount(pending, token) {
  const chosen = pending.accountId ? findAccount(pending.accountId) : null
  if (chosen) return { ok: true, account: chosen, created: false }

  let name = discordLink.accountName(pending.name)
  if (!name) {
    const identity = await discordLink.verify(discordCredentials(), token)
    if (!identity.ok) return identity
    name = discordLink.accountName(pending.name || identity.discord?.name, identity.discord?.id)
  }
  if (!name) return { ok: false, error: 'Tên Discord không hợp lệ cho tài khoản Minecraft. Hãy nhập tên tài khoản rồi liên kết lại.' }

  const existing = findAccountByName(name)
  if (existing) return { ok: true, account: existing, created: false }

  const current = readSettings()
  const res = launcher.accountAdd({ name, accounts: current.accounts, activeAccountId: current.activeAccountId })
  if (!res.ok) return res
  writeSettings({ accounts: res.accounts, activeAccountId: res.activeAccountId })
  return { ok: true, account: res.added, created: true }
}

function pushDiscordEvent(payload) {
  lastDiscordEvent = { ...payload, at: Date.now() }
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('luns:discord-event', lastDiscordEvent)
}

async function completeDiscordLink({ token, state }) {
  const pending = readPendingLink()
  if (!pending) {
    pushDiscordEvent({ type: 'token', token, state })
    return { ok: true, type: 'token' }
  }
  if (state && state !== pending.state) {
    pushDiscordEvent({ type: 'failed', error: 'Phiên liên kết không khớp. Hãy bắt đầu lại trong trang Tài khoản.' })
    return { ok: false, error: 'State không khớp.' }
  }

  const resolved = await resolveLinkAccount(pending, token)
  if (!resolved.ok) {
    writePendingLink(null)
    stopLoopback()
    pushDiscordEvent({ type: 'failed', error: resolved.error })
    return resolved
  }
  const account = resolved.account

  const res = await discordLink.linkAccount(discordCredentials(), {
    token,
    linkId: pending.linkId || undefined,
    name: '',
    force: !!pending.force,
    account: accountPayload(account),
  })
  writePendingLink(null)
  stopLoopback()
  if (!res.ok) {
    pushDiscordEvent({ type: 'failed', error: res.error, conflict: res.conflict, holder: res.holder, account, created: resolved.created })
    return res
  }
  pushDiscordEvent({
    type: 'linked',
    link: res.link,
    account,
    created: resolved.created,
    embed: res.embed,
    reopen: res.reopen,
    jumpUrl: res.jumpUrl,
    dm: res.dm,
    role: res.role,
  })
  showWindow()
  return { ok: true, type: 'linked', link: res.link, account }
}

let loopbackServer = null
let loopbackPort = 0
let loopbackTimer = null

function stopLoopback() {
  if (loopbackTimer) {
    clearTimeout(loopbackTimer)
    loopbackTimer = null
  }
  if (loopbackServer) {
    try {
      loopbackServer.close()
    } catch {}
    loopbackServer = null
  }
  loopbackPort = 0
}

function startLoopback(port) {
  if (loopbackServer && loopbackPort === port) return Promise.resolve({ ok: true, port })
  stopLoopback()
  return new Promise((resolve) => {
    const server = require('http').createServer((req, res) => {
      const url = String(req.url || '')
      if (req.method === 'POST' && url.startsWith('/discord/token')) {
        const chunks = []
        let size = 0
        req.on('data', (chunk) => {
          size += chunk.length
          if (size > 16384) {
            req.destroy()
            return
          }
          chunks.push(chunk)
        })
        req.on('end', async () => {
          let body = {}
          try {
            body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
          } catch {}
          console.log(`[liên kết] nhận token từ trình duyệt (${body.access_token ? 'có token' : 'KHÔNG có token'}, state ${body.state ? 'khớp' : 'trống'})`)
          const out = body.error
            ? { ok: false, error: body.error === 'access_denied' ? 'Đã huỷ uỷ quyền Discord.' : `Discord báo lỗi: ${body.error}` }
            : await completeDiscordLink({ token: body.access_token, state: body.state })
          if (!out.ok && !body.error) pushDiscordEvent({ type: 'failed', error: out.error || 'Không hoàn tất được liên kết.' })
          console.log(out.ok ? '[liên kết] hoàn tất ✓' : `[liên kết] thất bại: ${out.error}`)
          const linked = out.link || null
          res.writeHead(200, { 'content-type': 'application/json' })
          res.end(
            JSON.stringify({
              ok: !!out.ok,
              error: out.error || '',
              discord: linked ? { name: linked.discordName, tag: linked.discordTag, avatar: linked.discordAvatar } : null,
              account: linked?.accountName || '',
            }),
          )
        })
        return
      }
      if (req.method === 'GET' && url.startsWith('/font/')) {
        const file = discordPage.fontPath(path.basename(decodeURIComponent(url.split('?')[0])))
        if (!file) {
          res.writeHead(404, { 'content-type': 'text/plain' })
          res.end('')
          return
        }
        res.writeHead(200, { 'content-type': 'font/woff2', 'cache-control': 'max-age=86400' })
        res.end(fs.readFileSync(file))
        return
      }
      if (req.method === 'GET') {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
        res.end(discordPage.loopbackHtml())
        return
      }
      res.writeHead(404, { 'content-type': 'text/plain' })
      res.end('')
    })
    server.on('error', (err) => {
      loopbackServer = null
      loopbackPort = 0
      const busy = err.code === 'EADDRINUSE'
      resolve({
        ok: false,
        error: busy
          ? `Cổng ${port} đang bị chiếm (còn một launcher khác đang chạy). Thoát hẳn launcher — kể cả ở khay hệ thống — rồi mở lại và thử lại.`
          : `Không mở được cổng ${port} để nhận uỷ quyền: ${err.message}`,
      })
    })
    server.listen(port, '127.0.0.1', () => {
      loopbackServer = server
      loopbackPort = port
      loopbackTimer = setTimeout(() => stopLoopback(), DISCORD_PENDING_TTL)
      resolve({ ok: true, port })
    })
  })
}

async function handleDeepLink(raw) {
  const parsed = discordLink.parseDeepLink(raw)
  if (!parsed) return { ok: false, error: 'Liên kết lunarspace:// không hợp lệ.' }
  showWindow()

  if (parsed.kind === 'reopen' || parsed.kind === 'open') {
    pushDiscordEvent({ type: 'open' })
    return { ok: true, type: 'open' }
  }

  if (parsed.kind !== 'discord') {
    pushDiscordEvent({ type: 'failed', error: `Không hỗ trợ liên kết lunarspace://${parsed.kind}.` })
    return { ok: false, error: 'Không hỗ trợ liên kết này.' }
  }

  if (parsed.error) {
    pushDiscordEvent({ type: 'failed', error: parsed.error === 'access_denied' ? 'Đã huỷ uỷ quyền Discord.' : `Discord báo lỗi: ${parsed.error}` })
    return { ok: false, error: parsed.error }
  }
  if (!parsed.token) {
    pushDiscordEvent({ type: 'failed', error: 'Discord không trả về access token.' })
    return { ok: false, error: 'Thiếu access token.' }
  }

  return completeDiscordLink({ token: parsed.token, state: parsed.state })
}

launcher.setBroadcast(emitLauncher)
launcher.serverLocalStart()

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

  ipcMain.handle('discordlink:links', () => discordLink.links(discordCredentials()))
  ipcMain.handle('discordlink:pending', () => {
    const event = lastDiscordEvent
    lastDiscordEvent = null
    return { ok: true, event, pending: readPendingLink() }
  })
  ipcMain.handle('discordlink:start', async (_e, opts) => {
    const wanted = String((opts || {}).accountId || '')
    const account = wanted ? findAccount(wanted) : null
    if (wanted && !account) return { ok: false, error: 'Không tìm thấy tài khoản cần liên kết.' }
    const name = String((opts || {}).name || '').trim()
    if (!account && !name) return { ok: false, error: 'Nhập tên tài khoản hoặc chọn tài khoản có sẵn trước khi liên kết.' }
    const info = await discordLink.botInfo(discordCredentials())
    if (!info.ok) return info
    if (!info.clientId || !info.redirectUri) return { ok: false, error: 'Bot chưa cấu hình CLIENT_ID hoặc redirect URI.' }
    const state = discordLink.newState()
    const authorizeUrl = discordLink.authorizeUrl({ clientId: info.clientId, redirectUri: info.redirectUri, state })
    if (!authorizeUrl) return { ok: false, error: 'Không tạo được liên kết uỷ quyền Discord.' }
    writePendingLink({
      state,
      accountId: account?.id || '',
      accountName: account?.name || '',
      name,
      linkId: String((opts || {}).linkId || ''),
      force: !!(opts || {}).force,
      at: Date.now(),
    })
    let loopback = null
    console.log(`[liên kết] chế độ ${info.mode || 'hosted'}${info.mode === 'loopback' ? ` · cổng ${info.loopbackPort || 53682}` : ''}`)
    if (info.mode === 'loopback') {
      loopback = await startLoopback(info.loopbackPort || 53682)
      if (!loopback.ok) {
        writePendingLink(null)
        return loopback
      }
    }
    return {
      ok: true,
      authorizeUrl,
      state,
      mode: info.mode || 'hosted',
      brand: info.brand,
      redirectUri: info.redirectUri,
      willCreate: !account,
    }
  })
  ipcMain.handle('discordlink:cancel', () => {
    writePendingLink(null)
    stopLoopback()
    return { ok: true }
  })
  ipcMain.handle('discordlink:status', async (_e, opts) => {
    const account = findAccount((opts || {}).accountId)
    if (!account) return { ok: false, error: 'Không tìm thấy tài khoản.' }
    const res = await discordLink.links(discordCredentials())
    if (!res.ok) return res
    const items = Array.isArray(res.items) ? res.items : []
    const link = items.find((item) => item.accountUuid === account.uuid || item.accountId === account.id) || null
    return { ok: true, link }
  })
  ipcMain.handle('discordlink:unlink', async (_e, opts) => {
    const account = findAccount((opts || {}).accountId)
    if (!account) return { ok: false, error: 'Không tìm thấy tài khoản.' }
    const credentials = discordCredentials()
    const list = await discordLink.links(credentials)
    if (!list.ok) return list
    const items = Array.isArray(list.items) ? list.items : []
    const found = items.find((item) => item.accountUuid === account.uuid || item.accountId === account.id)
    if (!found) return { ok: false, error: 'Tài khoản này chưa liên kết Discord.' }
    const res = await discordLink.unlink(credentials, found.id)
    if (res.ok) pushDiscordEvent({ type: 'unlinked', link: found, account })
    return res
  })
  ipcMain.handle('app:focus', () => {
    showWindow()
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

  ipcMain.handle('launcher:server-test-eggs', () => launcher.serverTestEggs())
  ipcMain.handle('launcher:server-test-list', () => launcher.serverTestList())
  ipcMain.handle('launcher:server-test-suggest', (_e, opts) => launcher.serverTestSuggest(opts || {}))
  ipcMain.handle('launcher:server-test-defaults', (_e, opts) => launcher.serverTestDefaultInclude({ ...(opts || {}), settings: readSettings() }))
  ipcMain.handle('launcher:server-test-create', (_e, opts) => launcher.serverTestCreate(opts || {}, emitLauncher))
  ipcMain.handle('launcher:server-test-copy', (_e, opts) => launcher.serverTestCopyFrom({ ...(opts || {}), settings: readSettings() }, emitLauncher))
  ipcMain.handle('launcher:server-test-update', (_e, opts) => launcher.serverTestUpdate(opts || {}))
  ipcMain.handle('launcher:server-test-remove', (_e, opts) => launcher.serverTestRemove(opts || {}))
  ipcMain.handle('launcher:server-test-install', (_e, opts) => launcher.serverTestInstall(opts || {}, emitLauncher))
  ipcMain.handle('launcher:server-test-start', (_e, opts) => launcher.serverTestStart(opts || {}, emitLauncher))
  ipcMain.handle('launcher:server-test-stop', (_e, opts) => launcher.serverTestStop(opts || {}))
  ipcMain.handle('launcher:server-test-command', (_e, opts) => launcher.serverTestCommand(opts || {}))
  ipcMain.handle('launcher:server-test-status', (_e, opts) => launcher.serverTestStatus(opts || {}))
  ipcMain.handle('launcher:server-test-logs', (_e, opts) => launcher.serverTestLogs(opts || {}))
  ipcMain.handle('launcher:server-test-clear-logs', (_e, opts) => launcher.serverTestClearLogs(opts || {}))

  ipcMain.handle('launcher:server-local', (_e, opts) => launcher.serverLocalCall({ ...(opts || {}), settings: readSettings() }))
  ipcMain.handle('launcher:server-local-backup-download', async (_e, { id, uuid, name } = {}) => {
    const safe = String(name || 'backup').replace(/[\\/:*?"<>|]/g, '_').trim() || 'backup'
    const picked = await dialog.showSaveDialog(mainWindow, {
      title: 'Tải backup',
      defaultPath: path.join(app.getPath('downloads'), `${safe}.tar.gz`),
      filters: [{ name: 'Archive', extensions: ['tar.gz', 'gz'] }],
    })
    if (picked.canceled || !picked.filePath) return { ok: false, canceled: true }
    return launcher.serverLocalCall({ method: 'backupDownload', args: [id, uuid, picked.filePath], settings: readSettings() })
  })

  ipcMain.handle('launcher:content-project', (_e, opts) => launcher.contentProject(opts || {}))
  ipcMain.handle('launcher:content-tags', (_e, opts) => launcher.contentTags(opts || {}))
  ipcMain.handle('launcher:folder-icons', (_e, opts) => launcher.folderIcons(opts || {}))
  ipcMain.handle('launcher:world-tree', (_e, opts) => launcher.worldTree(opts || {}))
  ipcMain.handle('launcher:world-read', (_e, opts) => launcher.worldRead(opts || {}))
  ipcMain.handle('launcher:world-write', (_e, opts) => launcher.worldWrite(opts || {}))
  ipcMain.handle('launcher:world-restore', (_e, opts) => launcher.worldRestore(opts || {}))
  ipcMain.handle('launcher:map-info', (_e, opts) => launcher.mapInfo({ ...(opts || {}), settings: readSettings() }))
  ipcMain.handle('launcher:map-world-info', (_e, opts) => launcher.mapWorldInfo({ ...(opts || {}), settings: readSettings() }))
  ipcMain.handle('launcher:map-render', (_e, opts) => launcher.mapRender({ ...(opts || {}), settings: readSettings() }, emitLauncher))
  ipcMain.handle('launcher:map-cancel', () => launcher.mapCancel())
  ipcMain.handle('launcher:map-clear', (_e, opts) => launcher.mapClear({ ...(opts || {}), settings: readSettings() }))
  ipcMain.handle('launcher:map-reveal', () => launcher.mapRevealCache())
  ipcMain.handle('launcher:map-save', async (_e, { file, name } = {}) => {
    const prep = await launcher.mapSave({ file, name })
    if (!prep.ok) return prep
    const picked = await dialog.showSaveDialog(mainWindow, {
      title: 'Lưu ảnh bản đồ',
      defaultPath: path.join(app.getPath('pictures'), prep.suggested),
      filters: [{ name: 'PNG', extensions: ['png'] }],
      buttonLabel: 'Lưu',
    })
    if (picked.canceled || !picked.filePath) return { ok: false, canceled: true }
    try {
      fs.copyFileSync(prep.source, picked.filePath)
      return { ok: true, path: picked.filePath }
    } catch (err) {
      return { ok: false, error: err.message }
    }
  })
  ipcMain.handle('launcher:content-preview', (_e, opts) => launcher.contentPreview(opts || {}))
  ipcMain.handle('launcher:content-changelog', (_e, opts) => launcher.contentChangelog(opts || {}))
  ipcMain.handle('launcher:content-installed', (_e, opts) => launcher.contentInstalled(opts || {}))
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
  const BOOT_BG = { dark: '#0a0d12', light: '#edf2f9' }
  const withBootParams = (raw) => {
    const url = new URL(raw)
    url.searchParams.set('theme', bootTheme)
    url.searchParams.set('lang', bootLang)
    return url.toString()
  }

  mainWindow = new BrowserWindow({
    width: 1145,
    height: 720,
    resizable: false,
    maximizable: false,
    show: false,
    backgroundColor: BOOT_BG[bootTheme] || '#0a0d12',
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

  mainWindow.webContents.on('did-finish-load', () => {
    if (lastDiscordEvent) mainWindow.webContents.send('luns:discord-event', lastDiscordEvent)
  })

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

function registerProtocolClient() {
  try {
    if (isDev) app.setAsDefaultProtocolClient(discordLink.SCHEME, process.execPath, [path.resolve(process.argv[1] || '.')])
    else app.setAsDefaultProtocolClient(discordLink.SCHEME)
  } catch (err) {
    console.error('[lunaspace] không đăng ký được protocol lunarspace://', err)
  }
}

if (MODE !== 'app') {
  installer.run(MODE)
} else if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  registerProtocolClient()

  app.on('second-instance', (_event, argv) => {
    const deep = discordLink.extractDeepLink(argv)
    if (deep) handleDeepLink(deep)
    else showWindow()
  })

  app.on('open-url', (event, url) => {
    event.preventDefault()
    handleDeepLink(url)
  })

  app.whenReady().then(() => {
    protocol.handle('lsicon', serveIcon)
    protocol.handle('lsmap', (request) => serveCache(request, 'map-cache'))
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

    const bootDeep = discordLink.extractDeepLink(process.argv)
    if (bootDeep) setTimeout(() => handleDeepLink(bootDeep), 1200)

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

  app.on('before-quit', () => {
    updater.autoInstall()
    updater.shutdown()
    presence.shutdown()
    tray.destroy()
    stopLoopback()
    try {
      launcher.hostStop()
    } catch {}
    try {
      launcher.serverTestStopAll()
    } catch {}
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}
