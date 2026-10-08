const { app } = require('electron')
const fs = require('fs')
const fsp = fs.promises
const path = require('path')
const os = require('os')
const { listVersions, listLoaderVersions, listLoaderGames, getLoaderProfile } = require('./mc/meta.cjs')
const { pathsFor, install, resolveChain, ensureLaunchFiles } = require('./mc/install.cjs')
const { findJava, buildLaunch, spawnGame, killTree, offlineUuid } = require('./mc/launch.cjs')
const { writeLauncherProfiles, profilesPath } = require('./mc/profiles.cjs')
const javaModule = require('./mc/java.cjs')
const { analyzeExit, uploadToMclogs } = require('./mc/crash.cjs')
const forgeMod = require('./mc/forge.cjs')
const neoMod = require('./mc/neoforge.cjs')
const boost = require('./mc/boost.cjs')
const presence = require('./presence.cjs')
const modpack = require('./mc/modpack.cjs')
const content = require('./mc/content.cjs')
const contentIcons = require('./mc/icons.cjs')
const iconRemote = require('./mc/iconremote.cjs')
const nbt = require('./mc/nbt.cjs')
const host = require('./host.cjs')
const profileExport = require('./mc/export.cjs')
const serverpack = require('./mc/serverpack.cjs')
const servertest = require('./mc/servertest.cjs')
const serverlocal = require('./mc/serverlocal.cjs')

let broadcast = () => {}

function setBroadcast(fn) {
  if (typeof fn === 'function') broadcast = fn
  serverlocal.configure({ emit: (payload) => broadcast(payload) })
}

async function serverLocalCall({ method, args = [], settings } = {}) {
  serverlocal.configure({
    root: () => serverTestRoot(),
    metaDir: () => storageFor(settings).paths.meta,
  })
  const fn = serverlocal[method]
  if (typeof fn !== 'function') return { ok: false, error: `Không hỗ trợ: ${method}` }
  try {
    return await fn(...(Array.isArray(args) ? args : [args]))
  } catch (err) {
    return { ok: false, error: err.message }
  }
}

function serverLocalStart() {
  serverlocal.configure({ root: () => serverTestRoot(), metaDir: () => storageFor({}).paths.meta })
  serverlocal.startScheduler()
  return { ok: true }
}
const tokenStore = require('./auth.cjs')
const msAuth = require('./msAuth.cjs')
const elyAuth = require('./elyAuth.cjs')

const running = new Map()
const stoppingIds = new Set()
const crashes = new Map()
const logs = new Map()
const pendingPacks = new Map()
const MAX_PENDING_PACKS = 12
const installingIds = new Set()
const PACK_PLAN_FILE = '.lunaspace-modpack.json'
const modEnvCache = new Map()

const indexFile = () => path.join(app.getPath('userData'), 'instances.json')

function storageFor(settings = {}) {
  const shared = settings.sharedDir || path.join(app.getPath('userData'), 'shared')
  const paths = pathsFor(shared)
  const defaultInstanceDir = path.join(app.getPath('documents') || app.getPath('userData'), 'LunarSpace', 'instances')
  return { paths, shared, defaultInstanceDir }
}

function readIndex() {
  try {
    return JSON.parse(fs.readFileSync(indexFile(), 'utf8')) || []
  } catch {
    return []
  }
}

function writeIndex(list) {
  try {
    fs.mkdirSync(path.dirname(indexFile()), { recursive: true })
    fs.writeFileSync(indexFile(), JSON.stringify(list, null, 2), 'utf8')
  } catch {}
  return list
}

function updateEntry(id, patch) {
  const list = readIndex().map((i) => (i.id === id ? { ...i, ...patch } : i))
  writeIndex(list)
  return list.find((i) => i.id === id)
}

async function syncProfiles(settings) {
  const { shared } = storageFor(settings)
  try {
    return await writeLauncherProfiles({ shared, instances: readIndex(), version: app.getVersion() })
  } catch (err) {
    return { ok: false, error: err.message }
  }
}

function launcherProfilesFile(settings) {
  const { shared } = storageFor(settings)
  return profilesPath(shared)
}

function pushLog(id, line) {
  const buf = logs.get(id) || []
  buf.push(line)
  if (buf.length > 600) buf.splice(0, buf.length - 600)
  logs.set(id, buf)
}

async function getVersions({ snapshots = false, force = false, settings } = {}) {
  const { paths } = storageFor(settings)
  const res = await listVersions({ metaDir: paths.meta, snapshots, force })
  return {
    ok: true,
    latest: res.latest,
    cached: res.cached,
    stale: res.stale,
    source: 'mojang',
    versions: res.versions,
  }
}

async function getLoaderVersions({ kind, game, settings } = {}) {
  if (kind === 'vanilla') return { ok: true, versions: [] }
  const rows = await listLoaderVersions({ kind, game })
  return { ok: true, versions: rows }
}

async function getLoaderGames({ kind } = {}) {
  if (!kind || kind === 'vanilla') return { ok: true, games: [], all: true }
  const games = await listLoaderGames({ kind })
  return { ok: true, games, all: games.length === 0 }
}

const iconLookups = new Set()

function scheduleInstanceIcon(entry) {
  if (!entry?.id || !entry?.dir || iconLookups.has(entry.id)) return
  const planFile = path.join(entry.dir, PACK_PLAN_FILE)
  try {
    if (!fs.existsSync(planFile)) return
  } catch {
    return
  }
  iconLookups.add(entry.id)
  fsp
    .readFile(planFile, 'utf8')
    .then((raw) => JSON.parse(raw))
    .then(async (plan) => {
      const name = String(plan?.name || '').trim()
      if (!name) return
      const source = plan?.source === 'modrinth' ? 'modrinth' : 'curseforge'
      const res = await content.search({ kind: 'modpacks', source, query: name, limit: 8 })
      const norm = (value) => String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '')
      const hits = res?.hits || []
      const hit = hits.find((item) => norm(item.name) === norm(name)) || hits.find((item) => plan?.slug && norm(item.slug) === norm(plan.slug))
      if (!hit?.icon) return
      const list = readIndex()
      const at = list.findIndex((item) => item.id === entry.id)
      if (at < 0 || list[at].icon) return
      list[at].icon = hit.icon
      writeIndex(list)
    })
    .catch(() => {})
}

function listInstances(settings) {
  const { shared, defaultInstanceDir } = storageFor(settings)
  const index = readIndex()
  let dirty = false
  const list = index.map((entry) => {
    const isRunning = running.has(entry.id)
    const row = { ...entry, running: isRunning }
    if (!row.icon) {
      const local = path.join(entry.dir, 'icon.png')
      try {
        if (fs.existsSync(local)) row.icon = `file:///${String(entry.dir).split('\\').join('/')}/icon.png`
      } catch {}
    }
    if (!row.icon) scheduleInstanceIcon(entry)
    if (!isRunning && !installingIds.has(entry.id) && (entry.status === 'running' || entry.status === 'stopping' || entry.status === 'starting' || entry.status === 'installing')) {
      row.status = 'ready'
      dirty = true
    }
    return row
  })
  if (dirty) writeIndex(list.map(({ running: _running, ...rest }) => rest))
  return { ok: true, instances: list, sharedDir: shared, defaultInstanceDir }
}

async function systemInfo(settings) {
  const { paths, shared } = storageFor(settings)
  const cpus = os.cpus() || []
  let disk = { total: 0, free: 0 }
  try {
    await fsp.mkdir(shared, { recursive: true })
    const st = await fsp.statfs(shared)
    disk = { total: st.blocks * st.bsize, free: st.bavail * st.bsize }
  } catch {}
  let cacheBytes = 0
  try {
    cacheBytes = await dirSize(shared)
  } catch {}
  return {
    ok: true,
    platform: process.platform,
    arch: process.arch,
    cpuModel: cpus[0]?.model || '',
    cpuThreads: cpus.length,
    totalMem: os.totalmem(),
    freeMem: os.freemem(),
    disk,
    sharedDir: shared,
    cacheBytes,
  }
}

async function dirSize(dir) {
  let total = 0
  const entries = await fsp.readdir(dir, { withFileTypes: true }).catch(() => [])
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) total += await dirSize(full)
    else total += (await fsp.stat(full).catch(() => ({ size: 0 }))).size
  }
  return total
}

async function resolveTarget({ version, loader = 'vanilla', loaderVersion, settings }) {
  const { paths } = storageFor(settings)
  if (loader === 'vanilla') return { versionId: version, profile: null }
  if (loader === 'forge' || loader === 'neoforge') return { versionId: null, profile: null }
  const profile = await getLoaderProfile({ kind: loader, game: version, loader: loaderVersion, metaDir: paths.meta })
  return { versionId: profile.id, profile }
}

function loaderModule(loader) {
  if (loader !== 'neoforge') return forgeMod
  return {
    ...neoMod,
    installerMode: forgeMod.installerMode,
    runInstaller: forgeMod.runInstaller,
    detectInstalledId: forgeMod.detectInstalledId,
  }
}

function clearLog(id, emit) {
  logs.set(id, [])
  emit?.({ type: 'log-clear', id })
}

async function installForge({ entry, paths, settings, emit }) {
  const mod = loaderModule(entry.loader)
  const game = entry.version
  const forgeId = entry.forgeVersion || entry.loaderVersion
  const name = entry.loader === 'neoforge' ? 'NeoForge' : 'Forge'
  if (!forgeId) throw new Error(`Thiếu phiên bản ${name}`)

  await ensureLaunchFiles({
    versionId: game,
    paths,
    onProgress: (p) => emit?.({ type: 'progress', id: entry.id, phase: 'download', ...p }),
  })

  const chain = await resolveChain(game, { paths, dryRun: true })
  const resolved = await resolveJavaFor({ instanceId: entry.id, chain, paths, settings, emit })
  if (!resolved.ok) throw new Error(resolved.error)

  const forgeDir = path.join(paths.shared, 'forge-installer')
  await fsp.mkdir(forgeDir, { recursive: true })
  const fullId = await mod.resolveFullId({ game, idOrVersion: forgeId })
  const installer = await mod.ensureInstaller({
    game,
    forgeId,
    dir: forgeDir,
    onProgress: (p) => emit?.({ type: 'progress', id: entry.id, phase: 'download', ...p }),
  })

  const installed = await mod.findInstalled({ versionsDir: paths.versions, game, idOrVersion: forgeId })
  if (installed) {
    emit?.({ type: 'progress', id: entry.id, phase: 'clear' })
    return installed
  }

  const mode = mod.installerMode(installer)
  emit?.({ type: 'progress', id: entry.id, phase: 'download', label: 'forge', done: 0, total: 0, totalBytes: 0, bytesDone: 0 })
  const log = (line) => {
    pushLog(entry.id, line)
    emit?.({ type: 'log', id: entry.id, line })
  }

  if (mode === 'legacy') {
    log(`[LunarSpace] Đang cài ${name} ${forgeId} (installer cũ, Java ${resolved.java.major})…`)
    const created = await forgeMod.installLegacy({
      jarPath: installer,
      game,
      fullId,
      versionsDir: paths.versions,
      librariesDir: paths.libraries,
      onLog: log,
    })
    emit?.({ type: 'progress', id: entry.id, phase: 'clear' })
    clearLog(entry.id, emit)
    log(`[LunarSpace] Forge đã cài: ${created}`)
    return created
  }
  if (mode === 'none') throw new Error(`Bản ${name} ${forgeId} không có installer để cài tự động.`)

  const before = new Set(await fsp.readdir(paths.versions).catch(() => []))
  const attempts = await javaCandidates({ primary: resolved.java, paths })
  let lastRun = null
  for (const java of attempts) {
    log(`[LunarSpace] Đang cài ${name} ${forgeId} (Java ${java.major})…`)
    lastRun = await mod.runInstaller({ javaPath: java.path, installer, root: paths.shared, onLog: log })
    if (lastRun.ok) break
    if (!lastRun.invalidOutputs) {
      emit?.({ type: 'progress', id: entry.id, phase: 'clear' })
      throw new Error(`Installer ${name} kết thúc với mã ${lastRun.code}`)
    }
    log(`[LunarSpace] Java ${java.major} tạo tệp không khớp hash của ${name}, thử Java khác…`)
  }
  emit?.({ type: 'progress', id: entry.id, phase: 'clear' })
  if (!lastRun?.ok) throw new Error(`Installer ${name} không tạo được tệp khớp với bản phát hành.`)

  const created =
    (await mod.findInstalled({ versionsDir: paths.versions, game, idOrVersion: forgeId })) ||
    (await forgeMod.detectInstalledId({ versionsDir: paths.versions, before, game }))
  if (!created) throw new Error(`Không tìm thấy phiên bản ${name} sau khi cài`)
  clearLog(entry.id, emit)
  log(`[LunarSpace] ${name} đã cài: ${created}`)
  return created
}

async function createInstance({ name, version, loader = 'vanilla', loaderVersion, memoryMb = 2048, dir, username = 'Player', demo = false, icon = '', awaitInstall = false, settings }, emit) {
  if (!name || !version) return { ok: false, error: 'Thiếu tên hoặc phiên bản.' }
  const { paths, defaultInstanceDir } = storageFor(settings)
  const instanceDir = dir || path.join(defaultInstanceDir, String(name).replace(/[^\w.-]+/g, '-'))

  let target
  try {
    target = await resolveTarget({ version, loader, loaderVersion, settings })
  } catch (err) {
    return { ok: false, error: err.message }
  }

  try {
    await fsp.mkdir(instanceDir, { recursive: true })
    for (const sub of ['mods', 'config', 'saves', 'resourcepacks', 'shaderpacks', 'logs']) {
      await fsp.mkdir(path.join(instanceDir, sub), { recursive: true })
    }
  } catch (err) {
    return { ok: false, error: `Không tạo được thư mục instance: ${err.message}` }
  }

  const existing = readIndex().find((i) => path.resolve(i.dir) === path.resolve(instanceDir))
  if (existing) return { ok: false, error: 'Thư mục này đã có một instance của LunarSpace.' }

  const entry = {
    id: `${loader}-${version}-${Date.now().toString(36)}`,
    name: String(name),
    version: String(version),
    loader,
    loaderVersion: loaderVersion || null,
    versionId: target.versionId,
    forgeVersion: loader === 'forge' || loader === 'neoforge' ? (loaderVersion || null) : undefined,
    memoryMb: Number(memoryMb) || 2048,
    username: String(username || 'Player'),
    demo: !!demo,
    dir: instanceDir,
    ...(icon ? { icon: String(icon) } : {}),
    status: 'installing',
    created: new Date().toISOString(),
    lastPlayed: null,
    playtimeMs: 0,
  }

  await fsp.writeFile(
    path.join(instanceDir, 'instance.json'),
    JSON.stringify({ ...entry, sharedDir: paths.shared }, null, 2),
    'utf8',
  )
  writeIndex([entry, ...readIndex()])
  await syncProfiles(settings)
  emit?.({ type: 'created', instance: entry })

  const install = runInstall(entry, settings, emit)
  if (awaitInstall) await install
  else install.catch(() => {})
  return { ok: true, instance: entry }
}

async function runInstall(entry, settings, emit) {
  const { paths } = storageFor(settings)
  installingIds.add(entry.id)
  emit?.({ type: 'progress', id: entry.id, phase: 'start', label: 'start' })
  try {
    let versionId = entry.versionId
    if ((entry.loader === 'forge' || entry.loader === 'neoforge') && !versionId) {
      versionId = await installForge({ entry, paths, settings, emit })
      updateEntry(entry.id, { versionId })
    }
    const result = await install({
      versionId,
      paths,
      onProgress: (p) => emit?.({ type: 'progress', id: entry.id, phase: 'download', ...p }),
    })
    if (result.errors.length) {
      const first = result.errors[0]
      updateEntry(entry.id, { status: 'error', error: `${first.error} (${path.basename(first.file)})` })
      emit?.({ type: 'progress', id: entry.id, phase: 'error', error: first.error, errors: result.errors.length })
      return
    }
    updateEntry(entry.id, { status: 'ready', javaMajor: result.summary.javaMajor })
    await syncProfiles(settings)
    emit?.({
      type: 'progress',
      id: entry.id,
      phase: 'done',
      summary: result.summary,
      nativesDir: result.nativesDir,
    })
  } catch (err) {
    updateEntry(entry.id, { status: 'error', error: err.message })
    emit?.({ type: 'progress', id: entry.id, phase: 'error', error: err.message })
  } finally {
    installingIds.delete(entry.id)
  }
}

function safeJoin(root, rel) {
  const base = path.resolve(root)
  const full = path.resolve(base, rel || '.')
  if (full !== base && !full.startsWith(base + path.sep)) throw new Error('Đường dẫn không hợp lệ')
  return full
}

function findEntry(id) {
  const entry = readIndex().find((i) => i.id === id)
  if (!entry) throw new Error('Không tìm thấy instance.')
  return entry
}

async function listDir({ id, rel = '' } = {}) {
  let entry
  try {
    entry = findEntry(id)
  } catch (err) {
    return { ok: false, error: err.message }
  }
  let target
  try {
    target = safeJoin(entry.dir, rel)
  } catch (err) {
    return { ok: false, error: err.message }
  }
  let dirents = []
  try {
    dirents = await fsp.readdir(target, { withFileTypes: true })
  } catch (err) {
    return { ok: false, error: `Không đọc được thư mục: ${err.message}` }
  }
  const entries = []
  for (const dirent of dirents) {
    if (dirent.name === 'instance.json' || dirent.name === TRASH_DIR) continue
    const full = path.join(target, dirent.name)
    const st = await fsp.stat(full).catch(() => null)
    const disabled = !!disabledMarker(dirent.name)
    entries.push({
      name: dirent.name,
      dir: dirent.isDirectory(),
      size: st?.size || 0,
      mtime: st?.mtimeMs || 0,
      disabled,
    })
  }
  entries.sort((a, b) => (Number(b.dir) - Number(a.dir)) || a.name.localeCompare(b.name))
  return {
    ok: true,
    root: entry.dir,
    rel: path.relative(entry.dir, target).split(path.sep).join('/'),
    entries,
  }
}

function disabledMarker(name) {
  if (name.endsWith('.disabled')) return '.disabled'
  if (/\.zip\.txt$/i.test(name)) return '.txt'
  return null
}

async function toggleFile({ id, rel, enable, suffix = '.disabled' } = {}) {
  let entry
  try {
    entry = findEntry(id)
  } catch (err) {
    return { ok: false, error: err.message }
  }
  try {
    const full = safeJoin(entry.dir, rel)
    const name = path.basename(full)
    const marker = disabledMarker(name)
    const isDisabled = !!marker
    const wantDisabled = typeof enable === 'boolean' ? !enable : !isDisabled
    if (wantDisabled === isDisabled) return { ok: true }
    if (wantDisabled) {
      await fsp.rename(full, `${full}${suffix}`)
    } else {
      await fsp.rename(full, full.slice(0, -marker.length))
    }
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err.message }
  }
}

async function deleteFile({ id, rel } = {}) {
  let entry
  try {
    entry = findEntry(id)
  } catch (err) {
    return { ok: false, error: err.message }
  }
  try {
    const full = safeJoin(entry.dir, rel)
    const st = await fsp.stat(full)
    if (st.isDirectory()) await fsp.rm(full, { recursive: true, force: true })
    else await fsp.unlink(full)
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err.message }
  }
}

const TRASH_DIR = '.lunartrash'

function trashPaths(rootDir) {
  const root = path.join(rootDir, TRASH_DIR)
  return { root, items: path.join(root, 'items'), manifest: path.join(root, 'entries.json') }
}

async function readTrash(rootDir) {
  try {
    const raw = JSON.parse(await fsp.readFile(trashPaths(rootDir).manifest, 'utf8'))
    return Array.isArray(raw) ? raw : []
  } catch {
    return []
  }
}

async function writeTrash(rootDir, list) {
  const { root, manifest } = trashPaths(rootDir)
  await fsp.mkdir(root, { recursive: true })
  await fsp.writeFile(manifest, JSON.stringify(list, null, 2), 'utf8')
}

function uniqueName(existing, name) {
  if (!existing.has(name)) return name
  const dot = name.lastIndexOf('.')
  const base = dot > 0 ? name.slice(0, dot) : name
  const ext = dot > 0 ? name.slice(dot) : ''
  for (let i = 1; i < 500; i += 1) {
    const candidate = `${base} (${i})${ext}`
    if (!existing.has(candidate)) return candidate
  }
  return `${base}-${Date.now().toString(36)}${ext}`
}

async function trashFiles({ id, rels } = {}) {
  let entry
  try {
    entry = findEntry(id)
  } catch (err) {
    return { ok: false, error: err.message }
  }
  const list = Array.isArray(rels) ? rels : []
  const { items } = trashPaths(entry.dir)
  await fsp.mkdir(items, { recursive: true })
  const manifest = await readTrash(entry.dir)
  const failed = []
  let trashed = 0
  for (const rel of list) {
    try {
      const full = safeJoin(entry.dir, rel)
      const st = await fsp.stat(full)
      const entryId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
      await fsp.rename(full, path.join(items, entryId))
      manifest.unshift({
        id: entryId,
        name: path.basename(full),
        rel,
        dir: st.isDirectory(),
        size: st.isDirectory() ? 0 : st.size,
        deletedAt: Date.now(),
      })
      trashed += 1
    } catch (err) {
      failed.push({ rel, error: err.message })
    }
  }
  await writeTrash(entry.dir, manifest)
  return { ok: failed.length === 0, trashed, failed }
}

async function listTrash({ id } = {}) {
  let entry
  try {
    entry = findEntry(id)
  } catch (err) {
    return { ok: false, error: err.message }
  }
  const manifest = await readTrash(entry.dir)
  const { items } = trashPaths(entry.dir)
  const entries = []
  for (const item of manifest) {
    try {
      await fsp.access(path.join(items, item.id))
      entries.push(item)
    } catch {}
  }
  entries.sort((a, b) => (b.deletedAt || 0) - (a.deletedAt || 0))
  return { ok: true, entries }
}

async function restoreTrash({ id, entryId } = {}) {
  let entry
  try {
    entry = findEntry(id)
  } catch (err) {
    return { ok: false, error: err.message }
  }
  const { items } = trashPaths(entry.dir)
  const manifest = await readTrash(entry.dir)
  const item = manifest.find((x) => x.id === entryId)
  if (!item) return { ok: false, error: 'Mục này không còn trong thùng rác.' }
  try {
    const src = path.join(items, item.id)
    const parent = safeJoin(entry.dir, path.dirname(item.rel) === '.' ? '' : path.dirname(item.rel))
    await fsp.mkdir(parent, { recursive: true })
    const taken = new Set(await fsp.readdir(parent))
    const name = uniqueName(taken, item.name)
    const dest = path.join(parent, name)
    await fsp.rename(src, dest)
    await writeTrash(entry.dir, manifest.filter((x) => x.id !== entryId))
    return { ok: true, rel: [path.relative(entry.dir, parent).split(path.sep).join('/'), name].filter(Boolean).join('/') }
  } catch (err) {
    return { ok: false, error: `Không khôi phục được: ${err.message}` }
  }
}

async function purgeTrash({ id, ids } = {}) {
  let entry
  try {
    entry = findEntry(id)
  } catch (err) {
    return { ok: false, error: err.message }
  }
  const { items } = trashPaths(entry.dir)
  const manifest = await readTrash(entry.dir)
  const targets = Array.isArray(ids) ? ids : manifest.map((x) => x.id)
  const failed = []
  const removed = new Set()
  for (const entryId of targets) {
    try {
      await fsp.rm(path.join(items, entryId), { recursive: true, force: true })
      removed.add(entryId)
    } catch (err) {
      failed.push({ id: entryId, error: err.message })
    }
  }
  await writeTrash(entry.dir, manifest.filter((x) => !removed.has(x.id)))
  return { ok: failed.length === 0, purged: removed.size, failed }
}

function validName(name) {
  const value = String(name || '').trim()
  if (!value || value === '.' || value === '..') return null
  if (/[\\/:*?"<>|]/.test(value)) return null
  return value
}

async function createEntry({ id, rel = '', name, dir = false } = {}) {
  let entry
  try {
    entry = findEntry(id)
  } catch (err) {
    return { ok: false, error: err.message }
  }
  const clean = validName(name)
  if (!clean) return { ok: false, error: 'Tên không hợp lệ.' }
  try {
    const parent = safeJoin(entry.dir, rel)
    await fsp.mkdir(parent, { recursive: true })
    const full = path.join(parent, clean)
    if (dir) await fsp.mkdir(full)
    else await fsp.writeFile(full, '', { flag: 'wx' })
    return { ok: true, rel: [rel, clean].filter(Boolean).join('/'), name: clean }
  } catch (err) {
    if (err.code === 'EEXIST') return { ok: false, error: 'Đã có tệp hoặc thư mục cùng tên.' }
    return { ok: false, error: `Không tạo được: ${err.message}` }
  }
}

async function importPaths({ id, rel = '', paths } = {}) {
  let entry
  try {
    entry = findEntry(id)
  } catch (err) {
    return { ok: false, error: err.message }
  }
  const sources = (Array.isArray(paths) ? paths : []).filter(Boolean)
  if (!sources.length) return { ok: false, error: 'Không có tệp nào để thêm.' }
  let target
  try {
    target = safeJoin(entry.dir, rel)
    await fsp.mkdir(target, { recursive: true })
  } catch (err) {
    return { ok: false, error: err.message }
  }
  const failed = []
  let imported = 0
  for (const from of sources) {
    try {
      const src = path.resolve(from)
      const st = await fsp.stat(src)
      if (st.isDirectory() && (target === src || target.startsWith(src + path.sep))) {
        throw new Error('Không thể sao chép thư mục vào chính nó')
      }
      const taken = new Set(await fsp.readdir(target))
      const name = uniqueName(taken, path.basename(src))
      const dest = path.join(target, name)
      if (st.isDirectory()) await fsp.cp(src, dest, { recursive: true })
      else await fsp.copyFile(src, dest)
      imported += 1
    } catch (err) {
      failed.push({ path: from, error: err.message })
    }
  }
  return { ok: failed.length === 0, imported, failed }
}

async function moveEntry({ id, from, toRel = '' } = {}) {
  let entry
  try {
    entry = findEntry(id)
  } catch (err) {
    return { ok: false, error: err.message }
  }
  try {
    const src = safeJoin(entry.dir, from)
    const destDir = safeJoin(entry.dir, toRel)
    if (path.dirname(src) === destDir) return { ok: true, rel: from }
    if (destDir === src || destDir.startsWith(src + path.sep)) {
      return { ok: false, error: 'Không thể chuyển thư mục vào chính nó.' }
    }
    await fsp.mkdir(destDir, { recursive: true })
    const taken = new Set(await fsp.readdir(destDir))
    const name = uniqueName(taken, path.basename(src))
    await fsp.rename(src, path.join(destDir, name))
    return { ok: true, rel: [toRel, name].filter(Boolean).join('/') }
  } catch (err) {
    return { ok: false, error: `Không chuyển được: ${err.message}` }
  }
}

const MC_NAME = /^[A-Za-z0-9_]{3,16}$/

function accountsList({ accounts, activeAccountId } = {}) {
  const list = Array.isArray(accounts) ? accounts : []
  const active = list.some((a) => a.id === activeAccountId) ? activeAccountId : list[0]?.id || null
  return { ok: true, accounts: list, activeAccountId: active }
}

function accountAdd({ name, type, uuid: profileUuid, xuid, accounts, activeAccountId } = {}) {
  const kind = ['microsoft', 'ely'].includes(type) ? type : 'offline'
  const list = Array.isArray(accounts) ? accounts.slice() : []

  if (kind !== 'offline') {
    const clean = String(name || '').trim()
    if (!clean || !profileUuid) return { ok: false, error: 'Hồ sơ tài khoản không hợp lệ.' }
    const existing = list.find((a) => a.type === kind && a.uuid === profileUuid)
    const entry = { ...(existing || {}), id: existing?.id || `${kind}-${String(profileUuid).slice(0, 8)}`, type: kind, name: clean, uuid: profileUuid }
    if (xuid) entry.xuid = xuid
    if (!existing) list.push(entry)
    else list[list.indexOf(existing)] = entry
    return { ok: true, accounts: list, activeAccountId: activeAccountId || entry.id, added: entry, duplicate: !!existing }
  }

  const clean = String(name || '').trim()
  if (!MC_NAME.test(clean)) {
    return { ok: false, error: 'Tên chỉ gồm chữ, số, gạch dưới và dài 3–16 ký tự.' }
  }
  const uuid = offlineUuid(clean)
  const existing = list.find((a) => a.uuid === uuid)
  if (existing) {
    return { ok: true, accounts: list, activeAccountId: existing.id, duplicate: true }
  }
  const entry = { id: `off-${uuid.slice(0, 8)}`, name: clean, type: 'offline', uuid, created: new Date().toISOString() }
  list.push(entry)
  return { ok: true, accounts: list, activeAccountId: activeAccountId || entry.id, added: entry }
}

function accountRemove({ id, accounts, activeAccountId } = {}) {
  const list = (Array.isArray(accounts) ? accounts : []).filter((a) => a.id !== id)
  const active = activeAccountId === id ? list[0]?.id || null : activeAccountId
  return { ok: true, accounts: list, activeAccountId: active }
}

function accountSetActive({ id, accounts, activeAccountId } = {}) {
  const list = Array.isArray(accounts) ? accounts : []
  if (!list.some((a) => a.id === id)) return { ok: false, error: 'Không tìm thấy tài khoản.' }
  return { ok: true, accounts: list, activeAccountId: id }
}

function resolveAccount(settings) {
  const { accounts, activeAccountId } = accountsList(settings || {})
  return accounts.find((a) => a.id === activeAccountId) || null
}

async function accountAuth(account) {
  if (!account || !['microsoft', 'ely'].includes(account.type)) {
    return { ok: true, name: account?.name, uuid: account?.uuid, accessToken: '0', userType: 'legacy' }
  }

  const stored = tokenStore.getToken(account.id)

  if (account.type === 'microsoft') {
    const left = stored?.expiresAt ? stored.expiresAt - Date.now() : 0
    if (stored?.accessToken && left > 5 * 60 * 1000) {
      return {
        ok: true,
        name: stored.name || account.name,
        uuid: stored.uuid || account.uuid,
        accessToken: stored.accessToken,
        userType: 'msa',
        xuid: stored.xuid || '0',
      }
    }
    if (!stored?.refreshToken) return { ok: false, error: 'Phiên Microsoft đã hết hạn. Hãy đăng nhập lại tài khoản này.' }
    const res = await msAuth.refresh(stored.refreshToken)
    if (!res.ok) return { ok: false, error: res.error }
    tokenStore.setToken(account.id, res.session)
    return {
      ok: true,
      name: res.session.name,
      uuid: res.session.uuid,
      accessToken: res.session.accessToken,
      userType: 'msa',
      xuid: res.session.xuid || '0',
    }
  }

  let session = stored
  const alive = await elyAuth.validate({ accessToken: session?.accessToken, clientToken: session?.clientToken })
  if (!alive) {
    const res = await elyAuth.refresh({ accessToken: session?.accessToken, clientToken: session?.clientToken })
    if (!res.ok) return { ok: false, error: res.error }
    session = res.session
    tokenStore.setToken(account.id, session)
  }
  const injector = await elyAuth.ensureInjector()
  if (!injector.ok) return { ok: false, error: injector.error }
  return {
    ok: true,
    name: session.name || account.name,
    uuid: session.uuid || account.uuid,
    accessToken: session.accessToken,
    userType: 'mojang',
    javaAgent: `-javaagent:${injector.jar}=${elyAuth.AUTHLIB_API}`,
  }
}

async function accountRefresh({ id, accounts } = {}) {
  const account = (Array.isArray(accounts) ? accounts : []).find((a) => a.id === id)
  if (!account) return { ok: false, error: 'Không tìm thấy tài khoản.' }
  if (!['microsoft', 'ely'].includes(account.type)) return { ok: true, offline: true }
  const res = await accountAuth(account)
  return res.ok ? { ok: true, session: { name: res.name, uuid: res.uuid } } : res
}

function finishSignIn(type, session, accounts, activeAccountId) {
  const out = accountAdd({ type, name: session.name, uuid: session.uuid, xuid: session.xuid, accounts, activeAccountId })
  if (!out.ok) return out
  tokenStore.setToken(out.added.id, session)
  return { ...out, session: { name: session.name, uuid: session.uuid } }
}

async function accountSignIn({ type, parent, username, password, accounts, activeAccountId } = {}) {
  if (type === 'microsoft') {
    const res = await msAuth.login(parent)
    if (!res.ok) return res
    return finishSignIn('microsoft', res.session, accounts, activeAccountId)
  }
  if (type === 'ely') {
    const res = await elyAuth.login({ username, password })
    if (!res.ok) return res
    const injector = await elyAuth.ensureInjector()
    if (!injector.ok) return { ok: false, error: injector.error }
    return finishSignIn('ely', res.session, accounts, activeAccountId)
  }
  return { ok: false, error: 'Loại tài khoản không hợp lệ.' }
}

async function readTextFile({ id, rel } = {}) {
  let entry
  try {
    entry = findEntry(id)
  } catch (err) {
    return { ok: false, error: err.message }
  }
  let full
  try {
    full = safeJoin(entry.dir, rel)
  } catch (err) {
    return { ok: false, error: err.message }
  }
  const MAX = 4 * 1024 * 1024
  try {
    const st = await fsp.stat(full)
    if (st.isDirectory()) return { ok: false, error: 'Đây là thư mục, không mở được.' }
    if (st.size > MAX) return { ok: false, error: `Tệp lớn hơn ${Math.round(MAX / 1024 / 1024)} MB, không mở bằng trình soạn thảo.` }
    const buf = await fsp.readFile(full)
    if (buf.subarray(0, 8000).includes(0)) return { ok: false, error: 'Tệp nhị phân, không mở bằng trình soạn thảo.' }
    return { ok: true, text: buf.toString('utf8'), size: st.size }
  } catch (err) {
    return { ok: false, error: `Không đọc được tệp: ${err.message}` }
  }
}

async function writeTextFile({ id, rel, text } = {}) {
  let entry
  try {
    entry = findEntry(id)
  } catch (err) {
    return { ok: false, error: err.message }
  }
  try {
    const full = safeJoin(entry.dir, rel)
    await fsp.writeFile(full, String(text ?? ''), 'utf8')
    return { ok: true }
  } catch (err) {
    return { ok: false, error: `Không ghi được tệp: ${err.message}` }
  }
}

async function deleteFiles({ id, rels } = {}) {
  let entry
  try {
    entry = findEntry(id)
  } catch (err) {
    return { ok: false, error: err.message }
  }
  const list = Array.isArray(rels) ? rels : []
  const failed = []
  let deleted = 0
  for (const rel of list) {
    try {
      const full = safeJoin(entry.dir, rel)
      const st = await fsp.stat(full)
      if (st.isDirectory()) await fsp.rm(full, { recursive: true, force: true })
      else await fsp.unlink(full)
      deleted += 1
    } catch (err) {
      failed.push({ rel, error: err.message })
    }
  }
  return { ok: failed.length === 0, deleted, failed }
}

async function findCrashArtifacts(dir) {
  const out = { crashReport: null, jvmError: null }
  try {
    const entries = await fsp.readdir(path.join(dir, 'crash-reports'))
    const reports = entries.filter((name) => name.endsWith('.txt'))
    if (reports.length) {
      const stats = await Promise.all(reports.map(async (name) => ({ name, at: (await fsp.stat(path.join(dir, 'crash-reports', name))).mtimeMs })))
      stats.sort((a, b) => b.at - a.at)
      out.crashReport = path.join(dir, 'crash-reports', stats[0].name)
    }
  } catch {}
  try {
    const files = (await fsp.readdir(dir)).filter((name) => /^hs_err_pid\d+\.log$/.test(name))
    if (files.length) {
      const stats = await Promise.all(files.map(async (name) => ({ name, at: (await fsp.stat(path.join(dir, name))).mtimeMs })))
      stats.sort((a, b) => b.at - a.at)
      out.jvmError = path.join(dir, stats[0].name)
    }
  } catch {}
  return out
}

async function reportCrash({ id, dir, code, emit }) {
  const lines = logs.get(id) || []
  const analysis = analyzeExit(lines, code)
  const artifacts = await findCrashArtifacts(dir)
  const crash = {
    id,
    at: new Date().toISOString(),
    code,
    analysis,
    logText: lines.join('\n'),
    crashReport: artifacts.crashReport,
    jvmError: artifacts.jvmError,
  }
  crashes.set(id, crash)
  emit?.({ type: 'crash', id, crash })
  return crash
}

function getCrash({ id }) {
  const crash = crashes.get(id)
  return crash ? { ok: true, crash } : { ok: false, crash: null }
}

async function uploadLog({ text, label }) {
  return uploadToMclogs(text || '', label)
}

async function updateInstance({ id, patch = {}, settings, emit } = {}) {
  const entry = readIndex().find((i) => i.id === id)
  if (!entry) return { ok: false, error: 'Không tìm thấy instance.' }
  const allowed = {}
  if (patch.name !== undefined) allowed.name = String(patch.name).trim() || entry.name
  if (patch.username !== undefined) allowed.username = String(patch.username).trim() || 'Player'
  if (patch.memoryMb !== undefined) allowed.memoryMb = Math.max(512, Number(patch.memoryMb) || 2048)
  if (patch.jvmArgs !== undefined) allowed.jvmArgs = String(patch.jvmArgs)
  if (patch.demo !== undefined) allowed.demo = !!patch.demo
  if (patch.boost !== undefined) allowed.boost = !!patch.boost
  if (patch.boostMods !== undefined) allowed.boostMods = !!patch.boostMods
  const next = updateEntry(id, allowed)
  try {
    await fsp.writeFile(path.join(entry.dir, 'instance.json'), JSON.stringify(next, null, 2), 'utf8')
  } catch {}
  await syncProfiles(settings)

  const log = (line) => {
    pushLog(id, line)
    emit?.({ type: 'log', id, line })
  }
  if (patch.boostMods) {
    emit?.({ type: 'progress', id, phase: 'download', label: 'boost', done: 0, total: 0 })
    const res = await boost.installPerfMods({
      dir: entry.dir,
      game: next.version,
      loader: next.loader,
      onProgress: (p) => emit?.({ type: 'progress', id, ...p }),
      onLog: log,
    })
    emit?.({ type: 'progress', id, phase: 'clear' })
    if (!res.ok && res.reason === 'unsupported') {
      log('[LunarSpace] Tăng FPS: loader này chưa có mod tăng FPS phù hợp.')
    } else if (res.failed?.length) {
      log(`[LunarSpace] Tăng FPS: ${res.failed.length} mod không cài được (${res.failed.map((f) => f.name).join(', ')}).`)
    } else if (res.installed?.length) {
      log(`[LunarSpace] Tăng FPS: đã cài ${res.installed.map((m) => m.name).join(', ')}.`)
    }
    next.boostResult = { installed: res.installed || [], skipped: res.skipped || [], failed: res.failed || [], reason: res.reason || null }
  }
  return { ok: true, instance: next }
}

async function removeInstance({ id, deleteFiles = false, settings } = {}) {
  const entry = readIndex().find((i) => i.id === id)
  if (!entry) return { ok: false, error: 'Không tìm thấy instance.' }
  if (running.has(id)) killTree(running.get(id).pid)
  running.delete(id)
  logs.delete(id)
  const list = readIndex().filter((i) => i.id !== id)
  writeIndex(list)
  if (deleteFiles) {
    try {
      await fsp.access(path.join(entry.dir, 'instance.json'))
      await fsp.rm(entry.dir, { recursive: true, force: true })
    } catch {}
  }
  const profiles = await syncProfiles(settings)
  return { ok: true, instances: list, profiles }
}

async function resolveJavaFor({ instanceId, chain, paths, settings, emit }) {
  const required = chain.javaVersion?.majorVersion || 8
  let component = chain.javaVersion?.component || null

  if (settings?.javaPath) {
    const manual = await findJava({ explicit: settings.javaPath, required })
    if (manual.ok) return { ok: true, java: manual.java, source: 'manual' }
    emit?.({ type: 'log', id: instanceId, line: `[LunarSpace] Java chỉ định không chạy được (${manual.error}). Chuyển sang Java tải kèm.` })
  }

  if (!component) {
    const installed = await javaModule.managedJava({ paths, metaDir: paths.meta, major: required })
    if (installed.ok) {
      return { ok: true, java: { path: installed.javaPath, major: installed.major, raw: `Java ${installed.name}` }, source: 'managed' }
    }
    component = await javaModule.componentForMajor({ metaDir: paths.meta, major: required }).catch(() => null)
  }

  if (component) {
    const managed = await javaModule.managedJava({ paths, metaDir: paths.meta, component, major: required })
    if (managed.ok) {
      return { ok: true, java: { path: managed.javaPath, major: managed.major, raw: `Java ${managed.name}` }, source: 'managed' }
    }
    try {
      emit?.({ type: 'progress', id: instanceId, phase: 'download', label: 'java', major: required, done: 0, total: 0, totalBytes: 0, bytesDone: 0 })
      const runtime = await javaModule.installRuntime({
        paths,
        metaDir: paths.meta,
        component,
        onProgress: (p) => emit?.({ type: 'progress', id: instanceId, phase: 'download', ...p }),
      })
      emit?.({ type: 'progress', id: instanceId, phase: 'clear' })
      return { ok: true, java: { path: runtime.javaPath, major: runtime.major, raw: `Java ${runtime.name}` }, source: 'managed' }
    } catch (err) {
      emit?.({ type: 'progress', id: instanceId, phase: 'clear' })
      emit?.({ type: 'log', id: instanceId, line: `[LunarSpace] Không tải được Java ${required}: ${err.message}` })
    }
  }

  const fallback = await findJava({ required })
  if (fallback.ok) return { ok: true, java: fallback.java, source: 'system' }
  return { ok: false, error: fallback.error }
}

async function javaCandidates({ primary, paths, limit = 3 }) {
  const out = [{ path: primary.path, major: primary.major }]
  const seen = new Set([path.resolve(primary.path)])
  let runtimes = []
  try {
    runtimes = await javaModule.listRuntimes({ paths, metaDir: paths.meta })
  } catch {}
  const others = (runtimes || [])
    .filter((r) => r.installed && r.javaPath && !seen.has(path.resolve(r.javaPath)))
    .sort((a, b) => (a.major || 0) - (b.major || 0))
  for (const r of others) {
    if (out.length >= limit) break
    if (seen.has(path.resolve(r.javaPath))) continue
    seen.add(path.resolve(r.javaPath))
    out.push({ path: r.javaPath, major: r.major })
  }
  return out
}

async function launchInstance(opts, emit) {
  const entry = readIndex().find((i) => i.id === (opts || {}).id) || null
  if (entry) presence.starting(entry)
  const res = await runLaunch(opts, emit)
  if (res?.ok) presence.playing(entry || { name: 'LunarSpace', version: '', loader: 'vanilla' })
  else presence.stopped()
  return res
}

async function runLaunch({ id, username, demo: demoOverride, settings }, emit) {
  const { paths } = storageFor(settings)
  const entry = readIndex().find((i) => i.id === id)
  if (!entry) return { ok: false, error: 'Không tìm thấy instance.' }
  if (running.has(id)) return { ok: false, error: 'Instance đang chạy.' }

  if (!entry.versionId && (entry.loader === 'forge' || entry.loader === 'neoforge')) {
    try {
      const versionId = await installForge({ entry, paths, settings, emit })
      updateEntry(entry.id, { versionId, status: 'ready', error: null })
      entry.versionId = versionId
    } catch (err) {
      updateEntry(entry.id, { status: 'error', error: err.message })
      return { ok: false, error: err.message }
    }
  }

  let chain
  try {
    chain = await resolveChain(entry.versionId, { paths, dryRun: true })
  } catch (err) {
    return { ok: false, error: `Chưa cài xong phiên bản: ${err.message}` }
  }

  try {
    const repair = await ensureLaunchFiles({
      versionId: entry.versionId,
      paths,
      onProgress: (p) => emit?.({ type: 'progress', id, phase: 'download', ...p }),
    })
    if (repair.errors.length) {
      emit?.({ type: 'progress', id, phase: 'clear' })
      return { ok: false, error: `Không tải được tệp cần thiết: ${repair.errors[0].error}` }
    }
    if (repair.repaired) {
      emit?.({ type: 'progress', id, phase: 'clear' })
      chain = repair.chain
    }
  } catch (err) {
    emit?.({ type: 'progress', id, phase: 'clear' })
    return { ok: false, error: `Không kiểm tra được tệp game: ${err.message}` }
  }

  const required = chain.javaVersion?.majorVersion || 8
  const resolved = await resolveJavaFor({ instanceId: entry.id, chain, paths, settings, emit })
  if (!resolved.ok) return { ok: false, error: resolved.error }
  const found = { java: resolved.java }

  const account = resolveAccount(settings)
  const auth = await accountAuth(account)
  if (!auth.ok) return { ok: false, error: auth.error }
  const nativesDir = path.join(paths.natives, chain._id)
  const player = String(auth.name || username || entry.username || 'Player')
  const demo = !!(entry.demo || demoOverride)
  const emitLog = (line) => {
    pushLog(entry.id, line)
    emit?.({ type: 'log', id: entry.id, line })
  }
  const userJvm = entry.jvmArgs ? entry.jvmArgs.split(/\s+/).filter(Boolean) : []
  const { args, pathFix } = buildLaunch({
    chain,
    paths,
    nativesDir,
    linkDir: path.join(app.getPath('userData'), 'links'),
    instanceDir: entry.dir,
    username: player,
    memoryMb: entry.memoryMb || 2048,
    extraJvm: [...(auth.javaAgent ? [auth.javaAgent] : []), ...(entry.boost ? [...boost.jvmFlags(entry.memoryMb || 2048), ...userJvm] : userJvm)],
    auth,
    demo,
  })

  logs.set(id, [])
  if (pathFix) {
    pushLog(
      id,
      `[LunarSpace] Đường dẫn có ký tự đặc biệt (một số bản Java không đọc được) — dùng đường dẫn rút gọn: ${pathFix.to}`,
    )
  }
  emit?.({ type: 'banner', id })

  updateEntry(id, { status: 'starting' })
  emit?.({ type: 'state', id, status: 'starting' })

  let settled = false
  let settleTimer = null
  const markRunning = () => {
    if (settled) return
    settled = true
    clearTimeout(settleTimer)
    updateEntry(id, { status: 'running' })
    emit?.({ type: 'state', id, status: 'running' })
  }
  settleTimer = setTimeout(markRunning, 10000)

  const startedAt = Date.now()
  let child
  try {
    child = spawnGame({
      javaPath: found.java.path,
      args,
      cwd: entry.dir,
      onLog: (line) => {
        markRunning()
        pushLog(id, line)
        emit?.({ type: 'log', id, line })
      },
      onExit: (code) => {
        settled = true
        clearTimeout(settleTimer)
        running.delete(id)
        const elapsed = Date.now() - startedAt
        const current = readIndex().find((i) => i.id === id)
        updateEntry(id, {
          status: 'ready',
          lastPlayed: new Date().toISOString(),
          playtimeMs: (current?.playtimeMs || 0) + elapsed,
        })
        syncProfiles(settings).catch(() => {})
        pushLog(id, `[LunarSpace] Tiến trình kết thúc (code ${code})`)
        emit?.({ type: 'log', id, line: `[LunarSpace] Tiến trình kết thúc (code ${code})` })
        emit?.({ type: 'exit', id, code })
        presence.stopped()
        const userStopped = stoppingIds.delete(id)
        if (!userStopped && code !== 0) {
          reportCrash({ id, dir: entry.dir, code, emit }).catch(() => {})
        }
      },
    })
  } catch (err) {
    return { ok: false, error: err.message }
  }

  if (entry.boost) {
    boost.setHighPriority(child.pid).then((done) => {
      if (done) emitLog(`[LunarSpace] Tăng FPS: đã đặt ưu tiên cao cho tiến trình game (pid ${child.pid}).`)
    })
  }

  running.set(id, { pid: child.pid, startedAt })
  await syncProfiles(settings)
  emit?.({ type: 'state', id, status: 'starting', pid: child.pid })
  return { ok: true, pid: child.pid, java: found.java.major, versionId: chain.id }
}

function stopInstance({ id }, emit) {
  const child = running.get(id)
  const entry = readIndex().find((i) => i.id === id)
  if (!child) {
    if (entry && (entry.status === 'running' || entry.status === 'stopping' || entry.status === 'starting')) {
      updateEntry(id, { status: 'ready' })
      emit?.({ type: 'state', id, status: 'ready' })
      return { ok: true, alreadyStopped: true }
    }
    return { ok: false, error: 'Instance không chạy.' }
  }
  updateEntry(id, { status: 'stopping' })
  stoppingIds.add(id)
  emit?.({ type: 'state', id, status: 'stopping' })
  killTree(child.pid)
  setTimeout(() => {
    if (!running.has(id)) return
    running.delete(id)
    const current = readIndex().find((i) => i.id === id)
    if (current && (current.status === 'running' || current.status === 'stopping' || current.status === 'starting')) {
      updateEntry(id, { status: 'ready' })
    }
    emit?.({ type: 'state', id, status: 'ready' })
    emit?.({ type: 'log', id, line: '[LunarSpace] Buộc dừng tiến trình game.' })
  }, 12000)
  return { ok: true }
}

function getLogs({ id }) {
  return { ok: true, lines: logs.get(id) || [] }
}

function runningIds() {
  return { ok: true, ids: [...running.keys()] }
}

async function listJavaRuntimes(settings, force = false) {
  const { paths } = storageFor(settings)
  try {
    return { ok: true, platform: javaModule.platformKey(), items: await javaModule.listRuntimes({ paths, metaDir: paths.meta, force }) }
  } catch (err) {
    return { ok: false, error: err.message, platform: javaModule.platformKey(), items: [] }
  }
}

async function installJavaRuntime({ component, settings }) {
  if (!component) return { ok: false, error: 'Thiếu component.' }
  const { paths } = storageFor(settings)
  try {
    const runtime = await javaModule.installRuntime({ paths, metaDir: paths.meta, component })
    return { ok: true, runtime }
  } catch (err) {
    return { ok: false, error: err.message }
  }
}

async function removeJavaRuntime({ component, settings }) {
  const { paths } = storageFor(settings)
  return javaModule.removeRuntime({ paths, component })
}

function rememberPack(plan) {
  const token = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
  pendingPacks.set(token, plan)
  while (pendingPacks.size > MAX_PENDING_PACKS) pendingPacks.delete(pendingPacks.keys().next().value)
  return token
}

function packView(plan, token) {
  return {
    token,
    name: plan.name,
    summary: plan.summary || '',
    version: plan.version || '',
    mc: plan.mc,
    loader: plan.loader,
    loaderVersion: plan.loaderVersion,
    source: plan.source,
    mods: plan.files.length,
    listed: plan.listed || plan.files.length,
    extras: plan.extras || 0,
    missing: (plan.missing || []).length,
    overrides: (plan.overrides || []).length,
    profileFiles: plan.profileFiles || 0,
  }
}

function packNotes() {
  const notes = []
  return { notes, onLog: (line) => { if (line) notes.push(line) } }
}

function normalizePackPlan(plan) {
  if (!plan.mc) throw new Error('Modpack không ghi rõ phiên bản Minecraft.')
  if (plan.loader !== 'vanilla' && !plan.loaderVersion) {
    plan.loader = 'vanilla'
    plan.loaderVersion = null
  }
  if (!plan.name) plan.name = 'Modpack'
  return plan
}

async function modpackSearch({ source, query = '', sort = 'relevance', offset = 0, limit = 24, game, loader, category, environment } = {}) {
  try {
    const res = await modpack.search({ source, query, sort, offset, limit, game, loader, category, environment })
    return { ok: true, ...res }
  } catch (err) {
    return { ok: false, error: err.message, hits: [], total: 0 }
  }
}

async function modpackTags({ source } = {}) {
  try {
    return { ok: true, ...(await modpack.packTags({ source })) }
  } catch (err) {
    return { ok: false, error: err.message, options: [], environment: source !== 'curseforge' }
  }
}

async function modpackVersions({ source, id } = {}) {
  if (!id) return { ok: false, error: 'Thiếu modpack.', versions: [] }
  try {
    return { ok: true, versions: await modpack.versions({ source, id }) }
  } catch (err) {
    return { ok: false, error: err.message, versions: [] }
  }
}

async function modpackResolve({ source, packId, fileId, settings } = {}) {
  if (!packId) return { ok: false, error: 'Thiếu modpack.' }
  const { shared } = storageFor(settings)
  const { notes, onLog } = packNotes()
  try {
    const plan = await modpack.resolvePlan({
      source,
      packId,
      fileId,
      cacheDir: path.join(shared, 'modpacks'),
      onLog,
    })
    normalizePackPlan(plan)
    plan.notes = notes
    return { ok: true, plan: packView(plan, rememberPack(plan)) }
  } catch (err) {
    return { ok: false, error: err.message }
  }
}

async function modpackImport({ filePath } = {}) {
  if (!filePath) return { ok: false, error: 'Thiếu tệp modpack.' }
  const { notes, onLog } = packNotes()
  try {
    let plan
    if (path.extname(filePath).toLowerCase() === '.mrpack') {
      plan = await modpack.planFromMrpack({ zipPath: filePath, onLog })
    } else {
      plan = await modpack.planFromCurseforgeZip({ zipPath: filePath, onLog })
    }
    normalizePackPlan(plan)
    plan.notes = notes
    if (!plan.files.length && !(plan.overrides || []).length) throw new Error('Gói này không có tệp nào để cài.')
    return { ok: true, plan: packView(plan, rememberPack(plan)) }
  } catch (err) {
    return { ok: false, error: err.message }
  }
}

async function modpackInstall({ token, name, dir, icon = '', memoryMb = 4096, settings } = {}, emit) {
  const plan = pendingPacks.get(token)
  if (!plan) return { ok: false, error: 'Modpack đã hết hạn chờ, hãy chọn lại.' }

  const stream = (extra) => emit?.({ type: 'modpack', token, name: name || plan.name, ...extra })
  const mirror = (ev) => {
    emit?.(ev)
    if (ev?.type !== 'progress') return
    stream({
      phase: ev.phase === 'done' ? 'install-done' : ev.phase,
      label: ev.label,
      done: ev.done,
      total: ev.total,
      bytesDone: ev.bytesDone,
      totalBytes: ev.totalBytes,
      file: ev.file,
      error: ev.error,
    })
  }

  stream({ phase: 'install', label: 'start', done: 0, total: 0 })
  const created = await createInstance(
    {
      name: name || plan.name,
      version: plan.mc,
      loader: plan.loader,
      loaderVersion: plan.loaderVersion,
      memoryMb,
      dir,
      icon,
      awaitInstall: true,
      settings,
    },
    mirror,
  )
  if (!created.ok) {
    stream({ phase: 'error', error: created.error })
    return created
  }
  pendingPacks.delete(token)

  const entry = created.instance
  const log = (line) => {
    pushLog(entry.id, line)
    emit?.({ type: 'log', id: entry.id, line })
  }
  const modpackMeta = {
    name: plan.name,
    version: plan.version || '',
    source: plan.source,
    loader: plan.loader,
    loaderVersion: plan.loaderVersion || null,
    mods: plan.files.length,
    missing: (plan.missing || []).length,
  }
  for (const note of plan.notes || []) log(note)

  try {
    stream({ phase: 'download', label: 'modpack', done: 0, total: plan.files.length, bytesDone: 0, totalBytes: 0 })
    const res = await modpack.applyPlan({
      plan,
      instanceDir: entry.dir,
      onProgress: (p) => stream(p),
      onLog: log,
    })
    const applied = {
      planned: plan.files.length,
      downloaded: res.downloaded,
      overrides: res.overrides,
      profileFiles: plan.profileFiles || 0,
      failed: res.failed.length,
      failedNames: res.failed.slice(0, 8),
      missing: (plan.missing || []).length,
      missingNames: (plan.missing || []).slice(0, 8),
      extras: plan.extras || 0,
    }
    try {
      await fsp.writeFile(
        path.join(entry.dir, PACK_PLAN_FILE),
        JSON.stringify({ name: plan.name, source: plan.source, version: plan.version || '', mc: plan.mc, loader: plan.loader, files: plan.files, missing: plan.missing || [] }),
        'utf8',
      )
    } catch {}
    const fresh = updateEntry(entry.id, { modpack: { ...modpackMeta, applied: { downloaded: res.downloaded, failed: res.failed.length } } })
    updateEntry(entry.id, { status: 'ready', error: null })
    stream({ phase: 'done', label: 'modpack', done: res.files, total: res.files })
    await syncProfiles(settings)
    return { ok: true, applied, instance: { ...(fresh || entry), modpack: modpackMeta, status: 'ready' } }
  } catch (err) {
    log(`[LunarSpace] Lỗi modpack: ${err.message}`)
    updateEntry(entry.id, { modpack: modpackMeta, status: 'error', error: err.message })
    stream({ phase: 'error', error: err.message })
    return { ok: false, error: err.message, instance: { ...entry, modpack: modpackMeta } }
  }
}

async function modpackRepair({ id } = {}, emit) {
  let entry
  try {
    entry = findEntry(id)
  } catch (err) {
    return { ok: false, error: err.message }
  }
  const planPath = path.join(entry.dir, PACK_PLAN_FILE)
  const log = (line) => {
    pushLog(entry.id, line)
    emit?.({ type: 'log', id: entry.id, line })
  }
  try {
    const res = await modpack.repairPlan({
      planPath,
      onProgress: (p) => emit?.({ type: 'progress', id: entry.id, phase: 'download', label: 'repair', ...p }),
      onLog: log,
    })
    emit?.({ type: 'progress', id: entry.id, phase: 'clear' })
    return res
  } catch (err) {
    emit?.({ type: 'progress', id: entry.id, phase: 'clear' })
    return { ok: false, error: err.message }
  }
}

async function instanceModEnvs({ id, serverId } = {}) {
  let src
  try {
    src = serverpackSource({ id, serverId })
  } catch (err) {
    return { ok: false, error: err.message, envs: {} }
  }
  try {
    const dir = path.join(src.dir, 'mods')
    const names = (await fsp.readdir(dir)).filter((name) => /\.jar(\.disabled)?$/i.test(name))
    if (!names.length) return { ok: true, envs: {} }
    const parts = []
    for (const name of names) {
      const st = await fsp.stat(path.join(dir, name)).catch(() => null)
      parts.push(`${name}:${st ? `${st.size}:${st.mtimeMs}` : 'x'}`)
    }
    const key = parts.join('|')
    const cached = modEnvCache.get(src.key)
    if (cached && cached.key === key) return { ok: true, envs: cached.envs }
    const envs = await content.modEnvs({ dir, names })
    const { declaredSide, isClientOnlyJar } = require('./mc/modscan.cjs')
    for (const name of names) {
      if (envs[name]) continue
      const declared = declaredSide(path.join(dir, name))
      if (declared?.env) envs[name] = declared.env
      else if (isClientOnlyJar(path.join(dir, name))) envs[name] = 'client'
    }
    modEnvCache.set(src.key, { key, envs })
    return { ok: true, envs }
  } catch (err) {
    return { ok: false, error: err.message, envs: {} }
  }
}

const HOST_TOKEN_ID = 'host:ngrok'

const hostToolsDir = () => path.join(app.getPath('userData'), 'tools')

function hostHasToken() {
  return !!String(tokenStore.getToken(HOST_TOKEN_ID)?.token || '')
}

async function hostStatus({ instanceId } = {}) {
  let entry = null
  try {
    entry = instanceId ? findEntry(instanceId) : null
  } catch {}
  const agent = await host.agentStatus(hostToolsDir())
  const tunnel = host.tunnelStatus()
  const version = agent.installed && !tunnel.running ? await host.agentVersion(hostToolsDir()) : ''
  return {
    ok: true,
    agent: { ...agent, version },
    hasToken: hostHasToken(),
    instance: entry ? { id: entry.id, name: entry.name } : null,
    detected: entry ? await host.detectPort(entry.dir) : null,
    tunnel,
  }
}

async function hostInstallAgent(emit) {
  try {
    const res = await host.agentInstall({
      dir: hostToolsDir(),
      onProgress: (p) => emit?.({ type: 'host-progress', ...p }),
    })
    return { ok: true, path: res.path, version: await host.agentVersion(hostToolsDir()) }
  } catch (err) {
    return { ok: false, error: err.message }
  }
}

function hostSetToken({ token } = {}) {
  const value = String(token || '').trim()
  tokenStore.setToken(HOST_TOKEN_ID, value ? { token: value } : null)
  return { ok: true, hasToken: !!value }
}

async function hostStart({ instanceId, listenPort = 25565, targetPort } = {}, emit) {
  let entry
  try {
    entry = findEntry(instanceId)
  } catch (err) {
    return { ok: false, error: err.message }
  }
  let port = Number(targetPort) || 0
  if (!port) {
    const detected = await host.detectPort(entry.dir)
    port = detected?.port || 0
  }
  if (!port) {
    return { ok: false, error: 'Chưa thấy cổng world trong log — mở world rồi bấm "Mở cho LAN" trước.' }
  }
  const started = await host.tunnelStart({
    dir: hostToolsDir(),
    token: tokenStore.getToken(HOST_TOKEN_ID)?.token || '',
    targetPort: port,
    listenPort: Number(listenPort) || 25565,
    onExit: (info) => emit?.({ type: 'host', state: 'stopped', ...host.tunnelStatus(), exit: info }),
  })
  if (started.ok) emit?.({ type: 'host', state: 'started', ...started, instanceId: entry.id })
  return started
}

function hostStop() {
  return host.tunnelStop()
}

async function contentSearch({ kind, source, query = '', sort = 'relevance', offset = 0, limit = 20, instanceId, game, loader, category = '', environment = '' } = {}) {
  let entry = null
  try {
    entry = instanceId ? findEntry(instanceId) : null
  } catch (err) {
    return { ok: false, error: err.message, hits: [], total: 0 }
  }
  try {
    const res = await content.search({
      kind,
      source,
      query,
      sort,
      offset,
      limit,
      game: game === undefined ? entry?.version || '' : game,
      loader: loader === undefined ? entry?.loader || 'vanilla' : loader,
      category,
      environment,
    })
    return { ok: true, ...res, target: entry ? { game: entry.version, loader: entry.loader, name: entry.name } : null }
  } catch (err) {
    return { ok: false, error: err.message, hits: [], total: 0 }
  }
}

async function contentTags({ kind, source } = {}) {
  try {
    return { ok: true, ...(await content.contentTags({ kind, source })) }
  } catch (err) {
    return { ok: false, error: err.message, options: [], environment: false }
  }
}

let contentIconReader = null
let contentIconDir = ''

async function folderBytes(dir, cap = 40000) {
  let total = 0
  let seen = 0
  const walk = async (current) => {
    if (seen > cap) return
    const entries = await fsp.readdir(current, { withFileTypes: true }).catch(() => [])
    for (const entry of entries) {
      if (seen > cap) return
      const full = path.join(current, entry.name)
      if (entry.isDirectory()) {
        await walk(full)
        continue
      }
      const st = await fsp.stat(full).catch(() => null)
      if (st?.isFile()) {
        total += st.size
        seen += 1
      }
    }
  }
  await walk(dir)
  return { bytes: total, truncated: seen > cap }
}

function worldDirOf(entry, world) {
  const name = String(world || '').replace(/[\\/]/g, '').trim()
  if (!name || name === '.' || name === '..') return null
  return path.join(entry.dir, 'saves', name)
}

function worldFileOf(dir, file) {
  const rel = String(file || '').replace(/\\/g, '/').replace(/^\/+/, '')
  if (!rel || rel.split('/').some((part) => !part || part === '..' || part === '.')) return null
  return path.join(dir, ...rel.split('/'))
}

async function worldTree({ id, world } = {}) {
  let entry
  try {
    entry = findEntry(id)
  } catch (err) {
    return { ok: false, error: err.message }
  }
  const dir = worldDirOf(entry, world)
  if (!dir) return { ok: false, error: 'Tên thế giới không hợp lệ.' }
  const stat = await fsp.stat(dir).catch(() => null)
  if (!stat?.isDirectory()) return { ok: false, error: 'Không tìm thấy thế giới này.' }

  const files = []
  const add = async (rel) => {
    const full = path.join(dir, ...rel.split('/'))
    const info = await fsp.stat(full).catch(() => null)
    if (info?.isFile()) {
      const backup = await fsp.stat(`${full}.bak`).catch(() => null)
      files.push({ rel, size: info.size, mtime: info.mtimeMs, bak: backup?.size || 0 })
    }
  }
  await add('level.dat')
  await add('level.dat_old')
  for (const sub of ['playerdata', 'data', 'DIM-1/data', 'DIM1/data']) {
    const list = await fsp.readdir(path.join(dir, ...sub.split('/'))).catch(() => [])
    for (const name of list.filter((item) => /\.dat$/i.test(item)).sort()) await add(`${sub}/${name}`)
  }

  const summary = {}
  try {
    const root = await nbt.readFile(path.join(dir, 'level.dat'))
    const data = (root.value || []).find((node) => node.name === 'Data')
    const pick = (key) => (data?.value || []).find((node) => node.name === key)
    summary.name = pick('LevelName')?.value || String(world)
    summary.version = pick('version')?.value ?? null
    summary.lastPlayed = String(pick('LastPlayed')?.value || '')
    summary.gameType = pick('GameType')?.value ?? null
    summary.difficulty = pick('Difficulty')?.value ?? null
    summary.hardcore = !!pick('hardcore')?.value
    summary.allowCommands = !!pick('allowCommands')?.value
    summary.dayTime = pick('DayTime')?.value ?? null
    summary.seed = String(pick('RandomSeed')?.value ?? '')
    summary.spawn = ['SpawnX', 'SpawnY', 'SpawnZ'].map((key) => Number(pick(key)?.value ?? 0))
    summary.hasPlayer = !!(data?.value || []).find((node) => node.name === 'Player')
  } catch (err) {
    summary.error = err.message
  }

  const size = await folderBytes(dir)
  return {
    ok: true,
    world: {
      name: String(world),
      dir,
      files,
      summary,
      players: files.filter((file) => file.rel.startsWith('playerdata/')).length,
      bytes: size.bytes,
      partial: size.truncated,
      running: entry.status === 'running',
    },
  }
}

async function worldRead({ id, world, file } = {}) {
  let entry
  try {
    entry = findEntry(id)
  } catch (err) {
    return { ok: false, error: err.message }
  }
  const dir = worldDirOf(entry, world)
  if (!dir) return { ok: false, error: 'Tên thế giới không hợp lệ.' }
  const full = worldFileOf(dir, file)
  if (!full) return { ok: false, error: 'Đường dẫn tệp không hợp lệ.' }
  try {
    const stat = await fsp.stat(full)
    const root = await nbt.readFile(full)
    return { ok: true, file: String(file), bytes: stat.size, root }
  } catch (err) {
    return { ok: false, error: `Không đọc được tệp NBT: ${err.message}` }
  }
}

async function worldWrite({ id, world, file, root } = {}) {
  let entry
  try {
    entry = findEntry(id)
  } catch (err) {
    return { ok: false, error: err.message }
  }
  const dir = worldDirOf(entry, world)
  if (!dir) return { ok: false, error: 'Tên thế giới không hợp lệ.' }
  const full = worldFileOf(dir, file)
  if (!full) return { ok: false, error: 'Đường dẫn tệp không hợp lệ.' }
  if (!root || !Array.isArray(root.value)) return { ok: false, error: 'Dữ liệu NBT không hợp lệ.' }
  try {
    const res = await nbt.writeFile(full, root, { gzip: true, backup: true })
    return { ok: true, bytes: res.bytes, backup: `${path.basename(full)}.bak` }
  } catch (err) {
    return { ok: false, error: `Không ghi được tệp NBT: ${err.message}` }
  }
}

async function worldRestore({ id, world, file } = {}) {
  let entry
  try {
    entry = findEntry(id)
  } catch (err) {
    return { ok: false, error: err.message }
  }
  const dir = worldDirOf(entry, world)
  if (!dir) return { ok: false, error: 'Tên thế giới không hợp lệ.' }
  const full = worldFileOf(dir, file)
  if (!full) return { ok: false, error: 'Đường dẫn tệp không hợp lệ.' }
  const backup = `${full}.bak`
  const info = await fsp.stat(backup).catch(() => null)
  if (!info?.isFile()) return { ok: false, error: 'Chưa có bản sao .bak cho tệp này.' }
  try {
    const parsed = await nbt.readFile(backup)
    await fsp.copyFile(backup, full)
    return { ok: true, bytes: info.size, root: parsed }
  } catch (err) {
    return { ok: false, error: `Không khôi phục được: ${err.message}` }
  }
}

async function folderIcons({ id, folder = 'mods', names = [], remote = true } = {}) {
  let entry
  try {
    entry = findEntry(id)
  } catch (err) {
    return { ok: false, error: err.message, icons: {} }
  }
  const safe = String(folder || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')
  if (!/^[A-Za-z0-9._-]+$/.test(safe)) return { ok: false, error: 'Thư mục không hợp lệ.', icons: {} }
  const dir = path.join(entry.dir, safe)
  const cacheDir = path.join(app.getPath('userData'), 'icon-cache')
  if (!contentIconReader || contentIconDir !== cacheDir) {
    contentIconReader = contentIcons.iconReader(cacheDir)
    contentIconDir = cacheDir
  }
  const list = (Array.isArray(names) ? names : []).slice(0, 400)
  const out = {}
  await Promise.all(
    list.map(async (name) => {
      const uri = await contentIconReader(name, dir).catch(() => '')
      if (uri) out[name] = uri
    }),
  )
  const missing = list.filter((name) => !out[name])
  if (remote && missing.length) {
    const extra = await iconRemote.remoteIcons({ dir, names: missing, folder: safe, cacheDir }).catch(() => ({}))
    Object.assign(out, extra)
  }
  return { ok: true, icons: out }
}

async function contentVersions({ kind, source, id, instanceId } = {}) {
  let entry = null
  try {
    entry = instanceId ? findEntry(instanceId) : null
  } catch (err) {
    return { ok: false, error: err.message, versions: [] }
  }
  try {
    const versions = await content.versions({
      kind,
      source,
      id,
      game: entry?.version || '',
      loader: entry?.loader || 'vanilla',
    })
    return { ok: true, versions }
  } catch (err) {
    return { ok: false, error: err.message, versions: [] }
  }
}

async function exportProfile({ id, format = 'zip', targetPath } = {}, emit) {
  let entry
  try {
    entry = findEntry(id)
  } catch (err) {
    return { ok: false, error: err.message }
  }
  if (!targetPath) return { ok: false, error: 'Thiếu đường dẫn lưu.' }
  const log = (line) => {
    pushLog(entry.id, line)
    emit?.({ type: 'log', id: entry.id, line })
  }
  emit?.({ type: 'progress', id: entry.id, phase: 'download', label: 'export', done: 0, total: 0, totalBytes: 0, bytesDone: 0 })
  try {
    const res = await profileExport.exportProfile({
      entry,
      format,
      targetPath,
      onProgress: (p) => emit?.({ type: 'progress', id: entry.id, ...p }),
      onLog: log,
    })
    emit?.({ type: 'progress', id: entry.id, phase: 'done', label: 'export', summary: res })
    return res
  } catch (err) {
    log(`[LunarSpace] Xuất profile lỗi: ${err.message}`)
    emit?.({ type: 'progress', id: entry.id, phase: 'error', error: err.message })
    return { ok: false, error: err.message }
  }
}

function serverpackSource({ id, serverId } = {}) {
  if (serverId) {
    const entry = findServerTest(serverId)
    return {
      key: `st:${entry.id}`,
      id: entry.id,
      dir: entry.dir,
      name: entry.name,
      version: entry.mc || '',
      loader: entry.eggId,
      loaderVersion: entry.loaderVersion || '',
    }
  }
  const entry = findEntry(id)
  return {
    key: `in:${entry.id}`,
    id: entry.id,
    dir: entry.dir,
    name: entry.name,
    version: entry.version,
    loader: entry.loader,
    loaderVersion: entry.loaderVersion || entry.forgeVersion || '',
  }
}

async function serverpackPlan({ id, serverId, settings } = {}) {
  let src
  try {
    src = serverpackSource({ id, serverId })
  } catch (err) {
    return { ok: false, error: err.message }
  }
  const { paths } = storageFor(settings)
  try {
    return await serverpack.plan({
      dir: src.dir,
      id: src.key,
      name: src.name,
      version: src.version,
      loader: src.loader,
      loaderVersion: src.loaderVersion,
      metaDir: paths.meta,
      skipServer: !!serverId,
    })
  } catch (err) {
    return { ok: false, error: err.message }
  }
}

async function instanceTree({ id, serverId, rel = '' } = {}) {
  let src
  try {
    src = serverpackSource({ id, serverId })
  } catch (err) {
    return { ok: false, error: err.message, entries: [] }
  }
  return serverpack.listTree({ dir: src.dir, rel })
}

async function serverpackWalk({ id, serverId, rel = '' } = {}) {
  let src
  try {
    src = serverpackSource({ id, serverId })
  } catch (err) {
    return { ok: false, error: err.message, files: [] }
  }
  return serverpack.walkFiles({ dir: src.dir, rel })
}

async function serverpackExport({ id, serverId, include = [], props = null, raw = null, server = null, targetPath, settings } = {}, emit) {
  let src
  try {
    src = serverpackSource({ id, serverId })
  } catch (err) {
    return { ok: false, error: err.message }
  }
  if (!targetPath) return { ok: false, error: 'Thiếu đường dẫn lưu.' }
  const { paths, shared } = storageFor(settings)
  const log = (line) => {
    if (serverId) servertest.pushLine(serverId, line)
    else pushLog(src.id, line)
    emit?.({ type: 'log', id: src.id, line })
  }
  emit?.({ type: 'progress', id: src.id, phase: 'serverpack', label: 'serverpack', done: 0, total: include.length })
  try {
    const res = await serverpack.exportServerPack({
      dir: src.dir,
      targetPath,
      include,
      props,
      raw,
      server,
      metaDir: paths.meta,
      cacheDir: path.join(shared, 'serverpack'),
      onProgress: (p) => emit?.({ type: 'progress', id: src.id, ...p }),
      onLog: log,
    })
    emit?.({ type: 'progress', id: src.id, phase: 'done', label: 'serverpack', summary: res })
    return res
  } catch (err) {
    log(`[LunarSpace] Xuất serverpack lỗi: ${err.message}`)
    emit?.({ type: 'progress', id: src.id, phase: 'error', error: err.message })
    return { ok: false, error: err.message }
  }
}

async function contentProject({ kind, source, id } = {}) {
  try {
    return { ok: true, project: await content.project({ kind, source, id }) }
  } catch (err) {
    return { ok: false, error: err.message }
  }
}

const serverTestRoot = () => path.join(app.getPath('userData'), 'servertest')
const serverTestIndexFile = () => path.join(serverTestRoot(), 'index.json')

function readServerTests() {
  try {
    const list = JSON.parse(fs.readFileSync(serverTestIndexFile(), 'utf8'))
    return Array.isArray(list) ? list : []
  } catch {
    return []
  }
}

function writeServerTests(list) {
  try {
    fs.mkdirSync(serverTestRoot(), { recursive: true })
    fs.writeFileSync(serverTestIndexFile(), JSON.stringify(list, null, 2), 'utf8')
  } catch {}
  return list
}

function findServerTest(id) {
  const entry = readServerTests().find((s) => s.id === id)
  if (!entry) throw new Error('Không tìm thấy server thử.')
  return entry
}

function serverTestView(entry) {
  const status = servertest.statusOf(entry.id)
  return { ...entry, ...status, logs: undefined }
}

async function serverTestEggs() {
  return { ok: true, eggs: servertest.eggList(), bash: servertest.findBash(), platform: process.platform }
}

async function serverTestList() {
  const list = readServerTests().map(serverTestView)
  list.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))
  return { ok: true, servers: list }
}

async function resolveLoaderVersion({ mc, loader, loaderVersion }) {
  const raw = String(loaderVersion || '')
  if (!raw) return ''
  try {
    if (loader === 'neoforge') return await neoMod.resolveFullId({ game: mc, idOrVersion: raw })
    if (loader === 'forge') return await forgeMod.resolveFullId({ game: mc, idOrVersion: raw })
  } catch {}
  return raw
}

async function serverTestSuggest({ instanceId } = {}) {
  let entry = null
  try {
    entry = instanceId ? findEntry(instanceId) : null
  } catch {}
  let mc = entry?.version || ''
  let loader = entry?.loader || 'vanilla'
  let loaderVersion = entry?.loaderVersion || entry?.forgeVersion || ''
  if (entry) {
    const pack = await serverpack.readPackPlan(entry.dir).catch(() => null)
    if (pack?.mc) mc = pack.mc
    if (pack?.loader) loader = pack.loader
    if (pack?.loaderVersion) loaderVersion = pack.loaderVersion
  }
  const eggId = servertest.eggForLoader(loader)
  const port = await servertest.freePort(25565)
  const fullVersion = await resolveLoaderVersion({ mc, loader, loaderVersion })
  const vars = servertest.buildEggEnv(servertest.readEgg(eggId), {
    SERVER_JARFILE: 'server.jar',
    MC_VERSION: mc,
    NEOFORGE_VERSION: eggId === 'neoforge' ? fullVersion : '',
    FORGE_VERSION: eggId === 'forge' ? fullVersion : '',
  })
  return {
    ok: true,
    instanceId: entry?.id || null,
    mc,
    loader,
    loaderVersion: fullVersion,
    buildVersion: loaderVersion,
    eggId,
    port,
    ramMb: entry?.memoryMb || 4096,
    javaMajor: servertest.javaMajorFor(mc) || 21,
    vars,
    eggs: servertest.eggList(),
  }
}

async function filterClientOnlyMods(instanceDir, include) {
  const modsDir = path.join(instanceDir, 'mods')
  const rels = include.filter((rel) => /^mods\/[^/]+\.jar$/i.test(rel))
  if (!rels.length) return { include, removed: 0, names: [] }
  const { isClientOnlyJar, declaredSide } = require('./mc/modscan.cjs')
  const envs = await content.modEnvs({ dir: modsDir, names: rels.map((rel) => rel.slice('mods/'.length)) }).catch(() => ({}))
  const removed = []
  const kept = include.filter((rel) => {
    if (!/^mods\/[^/]+\.jar$/i.test(rel)) return true
    const name = rel.slice('mods/'.length)
    const full = path.join(modsDir, name)
    if (envs[name] === 'client' || declaredSide(full)?.env === 'client' || isClientOnlyJar(full)) {
      removed.push(name)
      return false
    }
    return true
  })
  return { include: kept, removed: removed.length, names: removed }
}

async function serverTestDefaultInclude({ instanceId, settings } = {}) {
  let entry
  try {
    entry = findEntry(instanceId)
  } catch (err) {
    return { ok: false, error: err.message, include: [] }
  }
  try {
    const plan = await serverpack.plan({
      dir: entry.dir,
      id: entry.id,
      name: entry.name,
      version: entry.version,
      loader: entry.loader,
      loaderVersion: entry.loaderVersion || entry.forgeVersion || '',
      metaDir: storageFor(settings).paths.meta,
    })
    const base = plan.files.filter((f) => f.def).map((f) => f.rel)
    const filtered = await filterClientOnlyMods(entry.dir, base)
    return { ok: true, include: filtered.include, total: plan.files.length, removed: filtered.removed, skippedMods: filtered.names }
  } catch (err) {
    return { ok: false, error: err.message, include: [] }
  }
}

async function serverTestCreate({ name, eggId, mc, loaderVersion, ramMb, port, include, instanceId, vars } = {}, emit) {
  const egg = servertest.readEgg(eggId)
  if (!egg) return { ok: false, error: `Egg "${eggId}" không tồn tại.` }
  const id = `st-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
  const dir = path.join(serverTestRoot(), 'servers', id)
  try {
    await fsp.mkdir(dir, { recursive: true })
  } catch (err) {
    return { ok: false, error: `Không tạo được thư mục server: ${err.message}` }
  }

  let sourceDir = null
  if (instanceId) {
    try {
      sourceDir = findEntry(instanceId).dir
    } catch {
      sourceDir = null
    }
  }

  const merged = {
    SERVER_JARFILE: 'server.jar',
    MC_VERSION: mc || '',
    NEOFORGE_VERSION: eggId === 'neoforge' ? await resolveLoaderVersion({ mc, loader: 'neoforge', loaderVersion }) : '',
    FORGE_VERSION: eggId === 'forge' ? await resolveLoaderVersion({ mc, loader: 'forge', loaderVersion }) : '',
    ...(vars || {}),
  }
  merged.port = await servertest.freePort(Number(port) || 25565)
  const entry = {
    id,
    name: name || `${egg.name} test`,
    eggId,
    dir,
    mc: merged.MC_VERSION,
    loaderVersion: loaderVersion || '',
    ramMb: Math.max(512, Number(ramMb) || 4096),
    port: merged.port,
    vars: merged,
    sourceInstanceId: sourceDir ? instanceId : null,
    createdAt: new Date().toISOString(),
    installed: false,
  }

  if (sourceDir && Array.isArray(include) && include.length) {
    emit?.({ type: 'progress', id, phase: 'servertest-copy', done: 0, total: include.length })
    const copied = await servertest.copyTree({
      sourceDir,
      targetDir: dir,
      include,
      onProgress: (p) => emit?.({ type: 'progress', id, phase: 'servertest-copy', ...p }),
    })
    entry.copied = copied
  }

  writeServerTests([entry, ...readServerTests()])
  emit?.({ type: 'progress', id, phase: 'clear' })
  return { ok: true, server: serverTestView(entry) }
}

async function serverTestCopyFrom({ id, instanceId, include } = {}, emit) {
  let entry
  try {
    entry = findServerTest(id)
  } catch (err) {
    return { ok: false, error: err.message }
  }
  if (servertest.statusOf(id).running) return { ok: false, error: 'Dừng server trước khi chép nội dung.' }
  let source
  try {
    source = findEntry(instanceId)
  } catch (err) {
    return { ok: false, error: err.message }
  }
  const list = Array.isArray(include) && include.length ? include : (await serverTestDefaultInclude({ instanceId })).include
  const copied = await servertest.copyTree({
    sourceDir: source.dir,
    targetDir: entry.dir,
    include: list,
    onProgress: (p) => emit?.({ type: 'progress', id, phase: 'servertest-copy', ...p }),
  })
  const next = readServerTests().map((s) => (s.id === id ? { ...s, copied, sourceInstanceId: instanceId, updatedAt: new Date().toISOString() } : s))
  writeServerTests(next)
  emit?.({ type: 'progress', id, phase: 'clear' })
  return { ok: true, copied, total: list.length }
}

async function serverTestUpdate({ id, patch = {} } = {}) {
  let entry
  try {
    entry = findServerTest(id)
  } catch (err) {
    return { ok: false, error: err.message }
  }
  const allowed = ['name', 'ramMb', 'port', 'vars', 'mc', 'loaderVersion']
  const next = { ...entry }
  for (const key of allowed) {
    if (patch[key] === undefined) continue
    if (key === 'ramMb') next.ramMb = Math.max(512, Number(patch.ramMb) || 4096)
    else if (key === 'port') next.port = Number(patch.port) || 25565
    else if (key === 'vars') next.vars = { ...(entry.vars || {}), ...(patch.vars || {}) }
    else next[key] = patch[key]
  }
  next.updatedAt = new Date().toISOString()
  writeServerTests(readServerTests().map((s) => (s.id === id ? next : s)))
  if (!servertest.statusOf(id).running && next.installed) {
    await servertest.writeProperties(next.dir, { ...next.vars, port: next.port }).catch(() => {})
  }
  return { ok: true, server: serverTestView(next) }
}

async function serverTestRemove({ id } = {}) {
  let entry
  try {
    entry = findServerTest(id)
  } catch (err) {
    return { ok: false, error: err.message }
  }
  servertest.stopServer(id, true)
  const trash = path.join(serverTestRoot(), '.trash')
  try {
    await fsp.mkdir(trash, { recursive: true })
    await fsp.rename(entry.dir, path.join(trash, `${id}-${Date.now().toString(36)}`))
  } catch (err) {
    return { ok: false, error: `Không chuyển được vào thùng rác: ${err.message}` }
  }
  writeServerTests(readServerTests().filter((s) => s.id !== id))
  return { ok: true, trash }
}

async function serverTestInstall({ id } = {}, emit) {
  let entry
  try {
    entry = findServerTest(id)
  } catch (err) {
    return { ok: false, error: err.message }
  }
  if (servertest.statusOf(id).running) return { ok: false, error: 'Server đang chạy — dừng trước khi cài.' }
  const log = (line) => {
    servertest.pushLine(id, line)
    emit?.({ type: 'servertest-log', id, line })
  }
  emit?.({ type: 'progress', id, phase: 'servertest-install', done: 0, total: 0 })
  servertest.clearLogs(id)
  try {
    const res = await servertest.installServer({
      dir: entry.dir,
      eggId: entry.eggId,
      vars: { ...entry.vars, port: entry.port },
      root: serverTestRoot(),
      onLog: log,
      onProgress: (p) => emit?.({ type: 'progress', id, phase: 'servertest-java', delta: p.delta || 0 }),
    })
    const updated = { ...entry, installed: true, javaBin: res.java, serverJarFile: res.jarFile, installedAt: new Date().toISOString() }
    writeServerTests(readServerTests().map((s) => (s.id === id ? updated : s)))
    emit?.({ type: 'progress', id, phase: 'clear' })
    return { ok: true, server: serverTestView(updated) }
  } catch (err) {
    log(`[Install] LỖI: ${err.message}`)
    emit?.({ type: 'progress', id, phase: 'servertest-error', error: err.message })
    emit?.({ type: 'progress', id, phase: 'clear' })
    return { ok: false, error: err.message }
  }
}

async function serverTestStart({ id } = {}, emit) {
  let entry
  try {
    entry = findServerTest(id)
  } catch (err) {
    return { ok: false, error: err.message }
  }
  const log = (line) => {
    emit?.({ type: 'servertest-log', id, line })
  }
  try {
    const javaBin =
      entry.javaBin && fs.existsSync(entry.javaBin)
        ? entry.javaBin
        : await servertest.ensureJava({
            root: serverTestRoot(),
            major: servertest.javaMajorFor(entry.mc) || 21,
            onLog: log,
          })
    await servertest.writeProperties(entry.dir, { ...entry.vars, port: entry.port })
    const res = await servertest.startServer({
      id: entry.id,
      dir: entry.dir,
      eggId: entry.eggId,
      jarFile: entry.serverJarFile || entry.vars?.SERVER_JARFILE || 'server.jar',
      ramMb: entry.ramMb,
      javaBin,
      onLog: log,
      onExit: (code, signal) => emit?.({ type: 'servertest-exit', id, code, signal }),
    })
    writeServerTests(readServerTests().map((s) => (s.id === id ? { ...s, javaBin, lastStart: new Date().toISOString() } : s)))
    return { ...res, server: serverTestView({ ...entry, javaBin }) }
  } catch (err) {
    log(`[Daemon] LỖI: ${err.message}`)
    return { ok: false, error: err.message }
  }
}

async function serverTestStop({ id, force = false } = {}) {
  return servertest.stopServer(id, force)
}

async function serverTestCommand({ id, command } = {}) {
  return servertest.sendCommand(id, command)
}

async function serverTestStatus({ id } = {}) {
  const list = readServerTests()
  if (id) {
    const entry = list.find((s) => s.id === id)
    if (!entry) return { ok: false, error: 'Không tìm thấy server thử.' }
    return { ok: true, server: serverTestView(entry) }
  }
  return { ok: true, servers: list.map(serverTestView) }
}

async function serverTestLogs({ id, since = 0, limit = 500 } = {}) {
  return { ok: true, ...servertest.serverLogs(id, since, limit) }
}

async function serverTestClearLogs({ id } = {}) {
  servertest.clearLogs(id)
  return { ok: true }
}

async function serverTestStopAll() {
  servertest.stopAll()
  return { ok: true, ids: servertest.runningIds() }
}

async function contentChangelog({ source, id, versionId } = {}) {
  try {
    return { ok: true, ...(await content.changelog({ source, id, versionId })) }
  } catch (err) {
    return { ok: false, error: err.message, text: '', format: 'markdown' }
  }
}

async function contentInstalled({ kind, source, id, versionId, file, instanceId } = {}) {
  let entry
  try {
    entry = findEntry(instanceId)
  } catch (err) {
    return { ok: false, error: err.message, matches: [] }
  }
  try {
    const res = await content.installed({
      kind,
      source,
      id,
      versionId,
      file,
      game: entry.version,
      loader: entry.loader,
      root: entry.dir,
    })
    return { ok: true, ...res }
  } catch (err) {
    return { ok: false, error: err.message, matches: [] }
  }
}

async function contentInstall({ kind, source, id, versionId, instanceId, remove = [] } = {}, emit) {
  let entry
  try {
    entry = findEntry(instanceId)
  } catch (err) {
    return { ok: false, error: err.message }
  }
  const log = (line) => {
    pushLog(entry.id, line)
    emit?.({ type: 'log', id: entry.id, line })
  }
  try {
    const prepared = await content.plan({
      kind,
      source,
      id,
      versionId,
      game: entry.version,
      loader: entry.loader,
      root: entry.dir,
    })
    emit?.({ type: 'progress', id: entry.id, phase: 'download', label: 'content', done: 0, total: prepared.tasks.length, bytesDone: 0, totalBytes: 0 })
    const res = await content.install({
      plan: prepared,
      root: entry.dir,
      onProgress: (p) => emit?.({ type: 'progress', id: entry.id, phase: 'download', label: 'content', ...p }),
      onLog: log,
    })
    const removed = []
    if (Array.isArray(remove) && remove.length) {
      for (const name of remove) {
        const base = path.basename(String(name))
        if (!base || res.failed?.includes(base)) continue
        try {
          await fsp.unlink(path.join(entry.dir, prepared.folder, base))
          removed.push(base)
        } catch {}
      }
      if (removed.length) log(`[LunarSpace] Đã xoá bản cũ: ${removed.join(', ')}`)
    }
    emit?.({ type: 'progress', id: entry.id, phase: 'done', label: 'content', summary: res })
    return { ok: true, ...res, folder: prepared.folder, removed }
  } catch (err) {
    emit?.({ type: 'progress', id: entry.id, phase: 'clear' })
    log(`[LunarSpace] Tải nội dung lỗi: ${err.message}`)
    return { ok: false, error: err.message }
  }
}

module.exports = {
  storageFor,
  launcherProfilesFile,
  syncProfiles,
  getVersions,
  getLoaderVersions,
  getLoaderGames,
  listInstances,
  systemInfo,
  createInstance,
  updateInstance,
  removeInstance,
  listDir,
  toggleFile,
  deleteFile,
  deleteFiles,
  trashFiles,
  listTrash,
  restoreTrash,
  purgeTrash,
  createEntry,
  importPaths,
  moveEntry,
  accountsList,
  accountAdd,
  accountRemove,
  accountSetActive,
  accountAuth,
  accountRefresh,
  accountSignIn,
  resolveAccount,
  readTextFile,
  writeTextFile,
  launchInstance,
  stopInstance,
  getLogs,
  runningIds,
  getCrash,
  uploadLog,
  listJavaRuntimes,
  installJavaRuntime,
  removeJavaRuntime,
  modpackSearch,
  modpackTags,
  modpackVersions,
  modpackResolve,
  modpackImport,
  modpackInstall,
  modpackRepair,
  exportProfile,
  serverpackPlan,
  instanceTree,
  serverpackWalk,
  serverpackExport,
  serverTestEggs,
  serverTestList,
  serverTestSuggest,
  serverTestDefaultInclude,
  serverTestCreate,
  serverTestCopyFrom,
  serverTestUpdate,
  serverTestRemove,
  serverTestInstall,
  serverTestStart,
  serverTestStop,
  serverTestCommand,
  serverTestStatus,
  serverTestLogs,
  serverTestClearLogs,
  serverTestStopAll,
  serverLocalCall,
  serverLocalStart,
  setBroadcast,
  contentSearch,
  contentTags,
  folderIcons,
  worldTree,
  worldRead,
  worldWrite,
  worldRestore,
  instanceModEnvs,
  hostStatus,
  hostInstallAgent,
  hostSetToken,
  hostStart,
  hostStop,
  contentVersions,
  contentProject,
  contentChangelog,
  contentInstalled,
  contentInstall,
}
