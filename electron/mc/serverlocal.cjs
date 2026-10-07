const fs = require('fs')
const fsp = fs.promises
const path = require('path')
const crypto = require('crypto')
const { spawn } = require('child_process')
const servertest = require('./servertest.cjs')
const cron = require('./cron.cjs')
const { createTarGz, extractTarGz } = require('./targz.cjs')

let hooks = { root: () => '', metaDir: () => '', emit: () => {} }
function configure(next) {
  hooks = { ...hooks, ...next }
}
const root = () => hooks.root()
const emit = (payload) => hooks.emit(payload)

const installState = new Map()
const historyCache = new Map()
const resourceCache = new Map()
const diskCache = new Map()
const tpsCache = new Map()
const tpsTimer = new Map()
let scheduler = null

const indexFile = () => path.join(root(), 'index.json')

function readIndex() {
  try {
    const list = JSON.parse(fs.readFileSync(indexFile(), 'utf8'))
    return Array.isArray(list) ? list : []
  } catch {
    return []
  }
}

function writeIndex(list) {
  try {
    fs.mkdirSync(root(), { recursive: true })
    fs.writeFileSync(indexFile(), JSON.stringify(list, null, 2), 'utf8')
  } catch {}
  return list
}

function find(id) {
  const entry = readIndex().find((item) => item.id === id)
  if (!entry) throw new Error('Không tìm thấy server.')
  return entry
}

function update(id, patch) {
  const list = readIndex().map((item) => (item.id === id ? { ...item, ...patch } : item))
  writeIndex(list)
  return list.find((item) => item.id === id)
}

function safeJoin(dir, rel) {
  const base = path.resolve(dir)
  const target = path.resolve(base, String(rel || '').replace(/^[/\\]+/, ''))
  if (target !== base && !target.startsWith(base + path.sep)) throw new Error('Đường dẫn không hợp lệ.')
  return target
}

function eggOf(entry) {
  return servertest.readEgg(entry.eggId) || null
}

function javaMajorFor(entry) {
  return servertest.javaMajorFor(entry.mc || '') || 21
}

function statusOf(entry) {
  if (installState.get(entry.id)) return 'installing'
  const state = servertest.statusOf(entry.id)
  return state.running ? state.state : 'stopped'
}

function pushHistory(id, action) {
  const entry = find(id)
  const list = [...(entry.history || []), { action, at: Date.now() }].slice(-300)
  update(id, { history: list })
  historyCache.set(id, list)
  return list
}

async function resourceSample(entry) {
  const state = servertest.statusOf(entry.id)
  if (!state.running || !state.pid) {
    resourceCache.delete(entry.id)
    return { cpu_absolute: 0, memory_bytes: 0, network: { rx_bytes: 0, tx_bytes: 0 } }
  }
  const cached = resourceCache.get(entry.id)
  const now = Date.now()
  if (cached && now - cached.at < 1000) return cached.value
  const pid = state.pid
  const raw = await new Promise((resolve) => {
    const script = `$p=Get-Process -Id ${pid} -ErrorAction SilentlyContinue; if($p){'{0}|{1}' -f $p.WorkingSet64,$p.TotalProcessorTime.TotalMilliseconds}`
    let out = ''
    let proc
    try {
      proc = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true })
    } catch {
      resolve('')
      return
    }
    proc.stdout?.on('data', (chunk) => { out += chunk.toString('utf8') })
    proc.on('error', () => resolve(''))
    proc.on('exit', () => resolve(out.trim()))
  })
  let memory = 0
  let cpuMs = 0
  if (raw.includes('|')) {
    const [memText, cpuText] = raw.split('|')
    memory = Number(memText) || 0
    cpuMs = Number(cpuText) || 0
  }
  const prev = cached?.cpuMs
  const cpuPercent = prev !== undefined && cpuMs >= prev ? ((cpuMs - prev) / Math.max(1, now - cached.at)) * 100 : 0
  const value = {
    cpu_absolute: Math.max(0, Math.min(100, Math.round(cpuPercent * 10) / 10)),
    memory_bytes: memory,
    network: { rx_bytes: 0, tx_bytes: 0 },
  }
  resourceCache.set(entry.id, { at: now, cpuMs, value })
  return value
}

async function diskUsage(entry) {
  const cached = diskCache.get(entry.id)
  const now = Date.now()
  if (cached && now - cached.at < 30000) return cached
  let bytes = 0
  const stack = [entry.dir]
  while (stack.length) {
    const dir = stack.pop()
    let entries = []
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const item of entries) {
      const full = path.join(dir, item.name)
      if (item.isDirectory()) stack.push(full)
      else {
        try {
          bytes += (await fsp.stat(full)).size
        } catch {}
      }
    }
  }
  const value = { bytes, at: now }
  diskCache.set(entry.id, value)
  return value
}

function volumeTotal() {
  try {
    const info = fs.statfsSync(root())
    return Number(info.bsize) * Number(info.blocks)
  } catch {
    return 0
  }
}

function tpsCommand(eggId) {
  if (eggId === 'paper' || eggId === 'purpur') return 'tps'
  if (eggId === 'neoforge') return 'neoforge tps'
  if (eggId === 'forge') return 'forge tps'
  return null
}

function parseTps(line) {
  let hit = /Overall\s*:\s*([\d.,]+)\s*TPS/i.exec(line)
  if (hit) return Number(hit[1].replace(',', '.'))
  hit = /Mean TPS\s*:\s*([\d.,]+)/i.exec(line)
  if (hit) return Number(hit[1].replace(',', '.'))
  hit = /TPS from last 1m[^:]*:\s*([\d.,]+)/i.exec(line)
  if (hit) return Number(hit[1].replace(',', '.'))
  hit = /There are\s+([\d.,]+)\s+ticks? behind/i.exec(line)
  if (hit) return null
  return null
}

function watchTps(entry) {
  if (tpsTimer.has(entry.id)) return
  const command = tpsCommand(entry.eggId)
  if (!command) return
  const timer = setInterval(async () => {
    const state = servertest.statusOf(entry.id)
    if (!state.running) {
      clearInterval(timer)
      tpsTimer.delete(entry.id)
      return
    }
    const before = servertest.serverLogs(entry.id, 0, 1).cursor
    servertest.sendCommand(entry.id, command)
    const started = Date.now()
    const read = () => {
      const { lines } = servertest.serverLogs(entry.id, before)
      for (const line of lines) {
        const value = parseTps(line)
        if (value !== null && value !== undefined) {
          tpsCache.set(entry.id, value)
          emit({ type: 'server-tps', serverId: entry.id, tps: value })
          return true
        }
      }
      return false
    }
    for (let i = 0; i < 12; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 250))
      if (read()) break
      if (Date.now() - started > 3000) break
    }
  }, 15000)
  tpsTimer.set(entry.id, timer)
}

function dockerImage(entry) {
  return entry.dockerImage || `ghcr.io/pelican-eggs/yolks:java_${javaMajorFor(entry)}`
}

function view(entry) {
  const egg = eggOf(entry)
  const port = Number(entry.port) || 25565
  const state = statusOf(entry)
  const tps = tpsCache.get(entry.id)
  return {
    id: entry.id,
    name: entry.name,
    egg: entry.eggId,
    eggName: egg?.name || entry.eggId,
    game: 'minecraft',
    version: entry.mc || '',
    description: `${egg?.name || entry.eggId}${entry.mc ? ` · Minecraft ${entry.mc}` : ''}`,
    status: state === 'installing' ? 'installing' : state,
    port,
    createdAt: entry.createdAt,
    startup: entry.startup || egg?.startup || '',
    dockerImage: dockerImage(entry),
    config: { ...(entry.vars || {}) },
    allocations: entry.allocations || [{ ip: '0.0.0.0', port }],
    databases: entry.databases || [],
    resources: {
      memory: Math.max(0, Number(entry.ramMb) || 4096),
      cpuPercent: 100,
      disk: Math.round(volumeTotal() / 1048576),
    },
    lastTps: tps ?? null,
    installProgress: entry.installProgress ?? 0,
    installMessage: entry.installMessage || '',
    installed: !!entry.installed,
    dir: entry.dir,
    javaMajor: javaMajorFor(entry),
    sourceInstanceId: entry.sourceInstanceId || null,
    copied: entry.copied || 0,
  }
}

function configs() {
  return { ok: true, servers: readIndex().map(view) }
}

function config(id) {
  try {
    return { ok: true, server: view(find(id)) }
  } catch (err) {
    return { ok: false, error: err.message }
  }
}

async function status(id) {
  let entry
  try {
    entry = find(id)
  } catch (err) {
    return { ok: false, error: err.message }
  }
  const resources = await resourceSample(entry)
  const disk = (await diskUsage(entry)) || { bytes: 0 }
  return {
    ok: true,
    status: statusOf(entry),
    resources: { ...resources, disk_bytes: disk.bytes },
    tps: tpsCache.get(id) ?? null,
  }
}

function state(id) {
  try {
    return { ok: true, state: statusOf(find(id)) }
  } catch (err) {
    return { ok: false, error: err.message }
  }
}

function history(id) {
  try {
    const entry = find(id)
    return { ok: true, history: entry.history || [] }
  } catch (err) {
    return { ok: false, error: err.message }
  }
}

function logs(id, lines = 500) {
  const { lines: list } = servertest.serverLogs(id, 0, Number(lines) || 500)
  return { ok: true, logs: list.join('\n') }
}

function logEntries(id) {
  const { lines: list } = servertest.serverLogs(id, 0, 500)
  return { ok: true, logs: list.map((message) => ({ message })) }
}

function command(id, text) {
  return servertest.sendCommand(id, text)
}

async function power(id, action) {
  let entry
  try {
    entry = find(id)
  } catch (err) {
    return { ok: false, error: err.message }
  }
  if (action === 'install') return install(id)
  if (action === 'start') {
    const jarFile = entry.serverJarFile || entry.vars?.SERVER_JARFILE || 'server.jar'
    const launch = servertest.pickLaunch(entry.dir, jarFile)
    if (launch.mode === 'missing') {
      emit({ type: 'server-log', serverId: id, message: '[Daemon] Chưa có tệp server — chạy script cài đặt egg trước…' })
      const res = await install(id)
      if (!res?.ok) return res
      entry = find(id)
    }
    const res = await servertest.startServer({
      id,
      dir: entry.dir,
      eggId: entry.eggId,
      jarFile: entry.serverJarFile || entry.vars?.SERVER_JARFILE || 'server.jar',
      ramMb: entry.ramMb,
      javaBin: entry.javaBin && fs.existsSync(entry.javaBin) ? entry.javaBin : await servertest.ensureJava({ root: root(), major: javaMajorFor(entry) }),
      onLog: (line) => emit({ type: 'server-log', serverId: id, message: line }),
      onExit: (code, signal) => {
        emit({ type: 'wings-ws', serverId: id, event: 'status', payload: { state: 'stopped' } })
        emit({ type: 'server-log-snapshot', serverId: id, logs: servertest.serverLogs(id, 0, 500).lines.join('\n') })
        pushHistory(id, code === 0 ? 'stop' : 'kill')
      },
    })
    if (res?.ok) {
      pushHistory(id, 'start')
      watchTps(entry)
      emit({ type: 'wings-ws', serverId: id, event: 'auth success', payload: {} })
      emit({ type: 'wings-ws', serverId: id, event: 'status', payload: { state: 'starting' } })
      const startedAt = Date.now()
      const heartbeat = setInterval(() => {
        const state = servertest.statusOf(id)
        if (!state.running || state.state !== 'starting') {
          clearInterval(heartbeat)
          return
        }
        const secs = Math.round((Date.now() - startedAt) / 1000)
        emit({
          type: 'server-log',
          serverId: id,
          message: `[Daemon] Đang khởi động (${secs}s) — pack mod lớn (đặc biệt có Sinytra Connector) có thể mất 1-3 phút và không in gì trong lúc nạp. Chờ dòng "Done (" là xong.`,
        })
      }, 20000)
      if (heartbeat.unref) heartbeat.unref()
      return { ok: true }
    }
    return res
  }
  if (action === 'restart') {
    await servertest.stopServer(id)
    for (let i = 0; i < 40; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 500))
      if (!servertest.statusOf(id).running) break
    }
    pushHistory(id, 'restart')
    return power(id, 'start')
  }
  if (action === 'kill') {
    const res = servertest.stopServer(id, true)
    pushHistory(id, 'kill')
    return res
  }
  const res = servertest.stopServer(id)
  if (res.ok) {
    pushHistory(id, 'stop')
    emit({ type: 'wings-ws', serverId: id, event: 'status', payload: { state: 'stopping' } })
  }
  return res
}

async function install(id) {
  let entry
  try {
    entry = find(id)
  } catch (err) {
    return { ok: false, error: err.message }
  }
  if (servertest.statusOf(id).running) return { ok: false, error: 'Server đang chạy — dừng trước khi cài.' }
  installState.set(id, true)
  servertest.clearLogs(id)
  update(id, { status: 'installing', installProgress: 0, installMessage: '' })
  const progress = (percent, message) => {
    const value = Math.max(0, Math.min(100, Math.round(percent)))
    update(id, { installProgress: value, installMessage: message })
    emit({ type: 'server-progress', serverId: id, percent: value, message })
    emit({ type: 'server-log', serverId: id, message: `[${value}%] ${message}` })
  }
  progress(3, 'Chuẩn bị cài đặt (basic, không Docker)…')
  try {
    const { paths } = { paths: { meta: hooks.metaDir() } }
    const res = await servertest.installServer({
      dir: entry.dir,
      eggId: entry.eggId,
      vars: { ...(entry.vars || {}), port: entry.port },
      root: root(),
      metaDir: paths.meta,
      onLog: (line) => {
        servertest.pushLine(id, line)
        emit({ type: 'server-log', serverId: id, message: line })
        if (/\[Java\]/.test(line)) progress(20, line.replace('[Java] ', ''))
        else if (/\[Install\]/.test(line)) {
          const clean = line.replace('[Install] ', '').trim()
          const noise = /^\s*\d|Total\s+%|Dload|--:--|^\d+\s*$|^[0-9.,]+\s*[kKMG]?$/.test(clean)
          if (!noise && clean.length > 6 && clean.length < 160) progress(Math.min(88, 45 + Math.random() * 30), clean)
        }
      },
      onProgress: (info) => {
        if (info?.phase === 'java') progress(25, 'Đang tải Java…')
      },
    })
    progress(95, 'Ghi eula.txt và server.properties…')
    update(id, {
      installed: true,
      javaBin: res.java,
      serverJarFile: res.jarFile,
      mc: res.mc || entry.mc,
      installProgress: 100,
      installMessage: 'Cài đặt hoàn tất',
      status: 'stopped',
    })
    pushHistory(id, 'install')
    progress(100, 'Cài đặt hoàn tất')
    return { ok: true }
  } catch (err) {
    update(id, { status: 'error', installProgress: 0, installMessage: err.message })
    progress(0, `Cài đặt thất bại: ${err.message}`)
    return { ok: false, error: err.message }
  } finally {
    installState.delete(id)
    diskCache.delete(id)
  }
}

async function fileList(id, rel = '/') {
  let entry
  try {
    entry = find(id)
  } catch (err) {
    return { ok: false, error: err.message, files: [] }
  }
  let target
  try {
    target = safeJoin(entry.dir, rel === '/' ? '' : rel)
  } catch (err) {
    return { ok: false, error: err.message, files: [] }
  }
  let items = []
  try {
    items = await fsp.readdir(target, { withFileTypes: true })
  } catch (err) {
    return { ok: false, error: err.message, files: [] }
  }
  const files = []
  for (const item of items) {
    const full = path.join(target, item.name)
    const stat = await fsp.stat(full).catch(() => null)
    files.push({
      name: item.name,
      is_dir: item.isDirectory(),
      size: stat?.size || 0,
      modified: stat?.mtime ? stat.mtime.toISOString() : null,
    })
  }
  files.sort((a, b) => Number(b.is_dir) - Number(a.is_dir) || a.name.localeCompare(b.name))
  return { ok: true, files }
}

async function fileRead(id, rel) {
  let entry
  try {
    entry = find(id)
  } catch (err) {
    return { ok: false, error: err.message }
  }
  let target
  try {
    target = safeJoin(entry.dir, rel)
  } catch (err) {
    return { ok: false, error: err.message }
  }
  const stat = await fsp.stat(target).catch(() => null)
  if (!stat) return { ok: false, error: 'Không tìm thấy tệp.' }
  if (stat.isDirectory()) return { ok: true, content: '', is_dir: true }
  try {
    return { ok: true, content: await fsp.readFile(target, 'utf8'), is_dir: false }
  } catch (err) {
    return { ok: false, error: err.message, is_dir: false }
  }
}

async function fileWrite(id, rel, content) {
  let entry
  try {
    entry = find(id)
  } catch (err) {
    return { ok: false, error: err.message }
  }
  try {
    const target = safeJoin(entry.dir, rel)
    await fsp.mkdir(path.dirname(target), { recursive: true })
    await fsp.writeFile(target, String(content ?? ''), 'utf8')
    diskCache.delete(id)
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err.message }
  }
}

async function fileDelete(id, rel) {
  let entry
  try {
    entry = find(id)
  } catch (err) {
    return { ok: false, error: err.message }
  }
  try {
    const target = safeJoin(entry.dir, rel)
    await fsp.rm(target, { recursive: true, force: true })
    diskCache.delete(id)
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err.message }
  }
}

async function fileCreate(id, rel, name, isDir) {
  let entry
  try {
    entry = find(id)
  } catch (err) {
    return { ok: false, error: err.message }
  }
  const clean = String(name || '').trim()
  if (!clean || /[\\/]/.test(clean)) return { ok: false, error: 'Tên không hợp lệ.' }
  try {
    const dir = safeJoin(entry.dir, rel === '/' ? '' : rel)
    const target = path.join(dir, clean)
    if (isDir) await fsp.mkdir(target, { recursive: true })
    else {
      await fsp.mkdir(path.dirname(target), { recursive: true })
      await fsp.writeFile(target, '', 'utf8')
    }
    diskCache.delete(id)
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err.message }
  }
}

async function fileMove(id, from, to) {
  let entry
  try {
    entry = find(id)
  } catch (err) {
    return { ok: false, error: err.message }
  }
  try {
    const source = safeJoin(entry.dir, from)
    const target = safeJoin(entry.dir, to)
    await fsp.mkdir(path.dirname(target), { recursive: true })
    await fsp.rename(source, target)
    diskCache.delete(id)
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err.message }
  }
}

async function fileUpload(id, rel, data) {
  let entry
  try {
    entry = find(id)
  } catch (err) {
    return { ok: false, error: err.message }
  }
  try {
    const target = safeJoin(entry.dir, rel)
    await fsp.mkdir(path.dirname(target), { recursive: true })
    await fsp.writeFile(target, Buffer.from(data))
    diskCache.delete(id)
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err.message }
  }
}

function syncConfig(id, patch = {}) {
  let entry
  try {
    entry = find(id)
  } catch (err) {
    return { ok: false, error: err.message }
  }
  const next = {}
  if (typeof patch.name === 'string' && patch.name.trim()) next.name = patch.name.trim()
  if (typeof patch.startup === 'string') next.startup = patch.startup
  if (typeof patch.docker_image === 'string') next.dockerImage = patch.docker_image
  if (patch.environment && typeof patch.environment === 'object') next.vars = { ...(entry.vars || {}), ...patch.environment }
  if (Array.isArray(patch.allocations)) next.allocations = patch.allocations
  if (patch.limits && typeof patch.limits === 'object') {
    if (patch.limits.memory) next.ramMb = Math.max(512, Number(patch.limits.memory) || entry.ramMb)
  }
  return { ok: true, server: view(update(id, next)) }
}

async function remove(id) {
  const entry = find(id)
  servertest.stopServer(id, true)
  const trash = path.join(root(), '.trash')
  await fsp.mkdir(trash, { recursive: true }).catch(() => {})
  const stamp = Date.now().toString(36)
  const target = path.join(trash, `${id}-${stamp}`)
  try {
    await fsp.writeFile(path.join(entry.dir, TRASH_META), JSON.stringify({ ...entry, deletedAt: new Date().toISOString() }, null, 2), 'utf8')
  } catch {}
  await fsp.rename(entry.dir, target).catch(() => {})
  writeIndex(readIndex().filter((item) => item.id !== id))
  installState.delete(id)
  historyCache.delete(id)
  resourceCache.delete(id)
  diskCache.delete(id)
  tpsCache.delete(id)
  return { ok: true, trashId: `${id}-${stamp}` }
}

const TRASH_META = 'lunarspace-server.json'
const trashRoot = () => path.join(root(), '.trash')

async function dirSize(dir) {
  let bytes = 0
  const stack = [dir]
  while (stack.length) {
    const current = stack.pop()
    let entries = []
    try {
      entries = await fsp.readdir(current, { withFileTypes: true })
    } catch {
      continue
    }
    for (const item of entries) {
      const full = path.join(current, item.name)
      if (item.isDirectory()) stack.push(full)
      else {
        try {
          bytes += (await fsp.stat(full)).size
        } catch {}
      }
    }
  }
  return bytes
}

async function trashList() {
  let names = []
  try {
    names = await fsp.readdir(trashRoot())
  } catch {
    return { ok: true, items: [] }
  }
  const items = []
  for (const name of names) {
    const full = path.join(trashRoot(), name)
    const stat = await fsp.stat(full).catch(() => null)
    if (!stat?.isDirectory()) continue
    let meta = null
    try {
      meta = JSON.parse(await fsp.readFile(path.join(full, TRASH_META), 'utf8'))
    } catch {}
    items.push({
      trashId: name,
      id: meta?.id || '',
      name: meta?.name || name.replace(/-[a-z0-9]+$/i, ''),
      eggId: meta?.eggId || '',
      mc: meta?.mc || '',
      port: meta?.port || 0,
      bytes: await dirSize(full),
      at: meta?.deletedAt ? new Date(meta.deletedAt).getTime() : stat.mtimeMs,
      restorable: !!meta,
    })
  }
  items.sort((a, b) => (b.at || 0) - (a.at || 0))
  return { ok: true, items }
}

async function trashRestore(trashId) {
  const source = path.join(trashRoot(), String(trashId || ''))
  const stat = await fsp.stat(source).catch(() => null)
  if (!stat?.isDirectory()) return { ok: false, error: 'Không tìm thấy bản trong thùng rác.' }
  let meta = null
  try {
    meta = JSON.parse(await fsp.readFile(path.join(source, TRASH_META), 'utf8'))
  } catch {}
  if (!meta?.id) return { ok: false, error: 'Bản này quá cũ (thiếu thông tin) — không khôi phục tự động được.' }
  const list = readIndex()
  const id = list.some((item) => item.id === meta.id) ? `st-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}` : meta.id
  const dir = path.join(root(), 'servers', id)
  try {
    await fsp.mkdir(path.join(root(), 'servers'), { recursive: true })
    await fsp.rename(source, dir)
  } catch (err) {
    return { ok: false, error: `Không khôi phục được: ${err.message}` }
  }
  const entry = { ...meta, id, dir, status: 'stopped' }
  delete entry.deletedAt
  try {
    await fsp.rm(path.join(dir, TRASH_META), { force: true })
  } catch {}
  writeIndex([entry, ...list])
  diskCache.delete(id)
  emit({ type: 'server-log', serverId: id, message: `[Daemon] Đã khôi phục server từ thùng rác: ${entry.name}` })
  return { ok: true, server: view(entry) }
}

async function trashPurge(trashId) {
  const target = path.join(trashRoot(), String(trashId || ''))
  const stat = await fsp.stat(target).catch(() => null)
  if (!stat?.isDirectory()) return { ok: false, error: 'Không tìm thấy bản trong thùng rác.' }
  try {
    await fsp.rm(target, { recursive: true, force: true })
  } catch (err) {
    return { ok: false, error: `Không xoá được: ${err.message}` }
  }
  return { ok: true }
}

const backupDir = (id) => path.join(root(), 'backups', id)
const backupIndex = (id) => path.join(backupDir(id), 'index.json')

function readBackups(id) {
  try {
    const list = JSON.parse(fs.readFileSync(backupIndex(id), 'utf8'))
    return Array.isArray(list) ? list : []
  } catch {
    return []
  }
}

function writeBackups(id, list) {
  fs.mkdirSync(backupDir(id), { recursive: true })
  fs.writeFileSync(backupIndex(id), JSON.stringify(list, null, 2), 'utf8')
  return list
}

function backupList(id) {
  try {
    find(id)
  } catch (err) {
    return { ok: false, error: err.message }
  }
  return { ok: true, backups: readBackups(id) }
}

async function backupCreate(id, { name, ignoredFiles } = {}) {
  let entry
  try {
    entry = find(id)
  } catch (err) {
    return { ok: false, error: err.message }
  }
  const uuid = crypto.randomUUID()
  const ignored = Array.isArray(ignoredFiles) ? ignoredFiles : []
  const backup = {
    uuid,
    name: name || new Date().toLocaleString('sv-SE'),
    ignoredFiles: ignored,
    checksum: '',
    bytes: 0,
    files: 0,
    created: Date.now(),
    completed: false,
    isSuccessful: false,
    isLocked: false,
    status: 'running',
  }
  writeBackups(id, [backup, ...readBackups(id)])
  emit({ type: 'backup-update', serverId: id, event: 'created', uuid, data: backup })
  const file = path.join(backupDir(id), `${uuid}.tar.gz`)
  try {
    const res = await createTarGz({
      sourceDir: entry.dir,
      targetPath: file,
      ignoredFiles: ignored,
      onProgress: (p) => emit({ type: 'backup-update', serverId: id, event: 'progress', uuid, data: p }),
    })
    const stat = await fsp.stat(file)
    const hash = crypto.createHash('sha256')
    await new Promise((resolve) => {
      const stream = fs.createReadStream(file)
      stream.on('data', (chunk) => hash.update(chunk))
      stream.on('end', resolve)
      stream.on('error', resolve)
    })
    const done = {
      ...backup,
      checksum: `sha256:${hash.digest('hex')}`,
      bytes: stat.size,
      files: res.files,
      completed: true,
      isSuccessful: true,
      status: 'completed',
    }
    writeBackups(id, readBackups(id).map((item) => (item.uuid === uuid ? done : item)))
    emit({ type: 'backup-update', serverId: id, event: 'completed', uuid, data: done })
    return { ok: true, backup: done }
  } catch (err) {
    const failed = { ...backup, completed: true, isSuccessful: false, status: 'failed' }
    writeBackups(id, readBackups(id).map((item) => (item.uuid === uuid ? failed : item)))
    emit({ type: 'backup-update', serverId: id, event: 'completed', uuid, data: failed })
    return { ok: false, error: err.message }
  }
}

function backupUpdate(id, uuid, patch = {}) {
  const list = readBackups(id)
  if (!list.some((item) => item.uuid === uuid)) return { ok: false, error: 'Không tìm thấy backup.' }
  const next = list.map((item) => (item.uuid === uuid ? { ...item, ...patch } : item))
  writeBackups(id, next)
  const updated = next.find((item) => item.uuid === uuid)
  emit({ type: 'backup-update', serverId: id, event: 'updated', uuid, data: updated })
  return { ok: true, backup: updated }
}

async function backupRestore(id, uuid, opts = {}) {
  let entry
  try {
    entry = find(id)
  } catch (err) {
    return { ok: false, error: err.message }
  }
  const backup = readBackups(id).find((item) => item.uuid === uuid)
  if (!backup) return { ok: false, error: 'Không tìm thấy backup.' }
  if (servertest.statusOf(id).running) return { ok: false, error: 'Dừng server trước khi khôi phục.' }
  const file = path.join(backupDir(id), `${uuid}.tar.gz`)
  emit({ type: 'backup-update', serverId: id, event: 'restore-started', uuid, data: {} })
  try {
    const res = await extractTarGz({
      archivePath: file,
      targetDir: entry.dir,
      truncateDirectory: !!opts.truncateDirectory,
      onProgress: (p) => emit({ type: 'backup-update', serverId: id, event: 'restore-progress', uuid, data: p }),
    })
    emit({ type: 'backup-update', serverId: id, event: 'restore-completed', uuid, data: res })
    diskCache.delete(id)
    return { ok: true, restored: res }
  } catch (err) {
    emit({ type: 'backup-update', serverId: id, event: 'restore-completed', uuid, data: {} })
    return { ok: false, error: err.message }
  }
}

async function backupDelete(id, uuid) {
  const list = readBackups(id)
  const backup = list.find((item) => item.uuid === uuid)
  if (!backup) return { ok: false, error: 'Không tìm thấy backup.' }
  if (backup.isLocked) return { ok: false, error: 'Backup đang bị khoá.' }
  await fsp.rm(path.join(backupDir(id), `${uuid}.tar.gz`), { force: true }).catch(() => {})
  writeBackups(id, list.filter((item) => item.uuid !== uuid))
  emit({ type: 'backup-update', serverId: id, event: 'deleted', uuid, data: {} })
  return { ok: true }
}

async function backupDownload(id, uuid, targetPath) {
  const file = path.join(backupDir(id), `${uuid}.tar.gz`)
  try {
    await fsp.copyFile(file, targetPath)
    return { ok: true, path: targetPath }
  } catch (err) {
    return { ok: false, error: err.message }
  }
}

const scheduleFile = () => path.join(root(), 'schedules.json')

function readSchedules() {
  try {
    const list = JSON.parse(fs.readFileSync(scheduleFile(), 'utf8'))
    return Array.isArray(list) ? list : []
  } catch {
    return []
  }
}

function writeSchedules(list) {
  try {
    fs.mkdirSync(root(), { recursive: true })
    fs.writeFileSync(scheduleFile(), JSON.stringify(list, null, 2), 'utf8')
  } catch {}
  return list
}

function scheduleList(id) {
  const list = readSchedules()
    .filter((item) => item.serverId === id)
    .map((item) => ({ ...item, humanCron: item.humanCron || cron.describe(item.cron) }))
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
  return { ok: true, schedules: list }
}

function schedulePreview(expr) {
  const text = String(expr || '').trim()
  if (!cron.parseCron(text)) return { ok: true, valid: false, human: '', nextRunAt: null }
  return { ok: true, valid: true, human: cron.describe(text), nextRunAt: cron.nextRun(text) }
}

function scheduleCreate(id, payload = {}) {
  if (!cron.parseCron(payload.cron)) return { ok: false, error: 'Cron không hợp lệ.' }
  const item = {
    id: crypto.randomUUID(),
    serverId: id,
    name: payload.name || 'Schedule',
    cron: payload.cron,
    humanCron: cron.describe(payload.cron),
    isActive: payload.isActive !== false,
    steps: payload.steps || [],
    createdAt: Date.now(),
    nextRunAt: cron.nextRun(payload.cron),
    lastRunAt: 0,
    lastStatus: '',
    lastError: '',
  }
  writeSchedules([item, ...readSchedules()])
  emit({ type: 'schedule-update', serverId: id, ...item })
  return { ok: true, schedule: item }
}

function scheduleUpdate(scheduleId, payload = {}) {
  const list = readSchedules()
  const current = list.find((item) => item.id === scheduleId)
  if (!current) return { ok: false, error: 'Không tìm thấy lịch trình.' }
  if (payload.cron && !cron.parseCron(payload.cron)) return { ok: false, error: 'Cron không hợp lệ.' }
  const next = {
    ...current,
    ...payload,
    humanCron: cron.describe(payload.cron || current.cron),
    nextRunAt: cron.nextRun(payload.cron || current.cron),
  }
  writeSchedules(list.map((item) => (item.id === scheduleId ? next : item)))
  emit({ type: 'schedule-update', serverId: next.serverId, ...next })
  return { ok: true, schedule: next }
}

function scheduleToggle(scheduleId, isActive) {
  const list = readSchedules()
  const current = list.find((item) => item.id === scheduleId)
  if (!current) return { ok: false, error: 'Không tìm thấy lịch trình.' }
  const next = { ...current, isActive: !!isActive }
  writeSchedules(list.map((item) => (item.id === scheduleId ? next : item)))
  emit({ type: 'schedule-update', serverId: next.serverId, ...next })
  return { ok: true }
}

function scheduleDelete(scheduleId) {
  const list = readSchedules()
  const current = list.find((item) => item.id === scheduleId)
  if (!current) return { ok: false, error: 'Không tìm thấy lịch trình.' }
  writeSchedules(list.filter((item) => item.id !== scheduleId))
  emit({ type: 'schedule-deleted', id: scheduleId })
  return { ok: true }
}

async function runSteps(schedule) {
  const entry = find(schedule.serverId)
  writeSchedules(readSchedules().map((item) => (item.id === schedule.id ? { ...item, isProcessing: true } : item)))
  emit({ type: 'schedule-update', serverId: schedule.serverId, ...schedule, isProcessing: true })
  let error = ''
  for (const step of schedule.steps || []) {
    if (step.delay) await new Promise((resolve) => setTimeout(resolve, Math.min(600, Number(step.delay) || 0) * 1000))
    try {
      if (step.action === 'command' && step.command) await command(schedule.serverId, step.command)
      else if (step.action === 'power' && step.power) await power(schedule.serverId, step.power)
      else if (step.action === 'backup') await backupCreate(schedule.serverId, { name: step.backupName, ignoredFiles: step.ignoredFiles })
    } catch (err) {
      error = err.message
      if (!step.continueOnFailure) break
    }
  }
  const list = readSchedules()
  const current = list.find((item) => item.id === schedule.id) || schedule
  const next = {
    ...current,
    isProcessing: false,
    lastRunAt: Date.now(),
    lastStatus: error ? 'failed' : 'success',
    lastError: error,
    nextRunAt: cron.nextRun(current.cron),
  }
  writeSchedules(list.map((item) => (item.id === schedule.id ? next : item)))
  emit({ type: 'schedule-update', serverId: next.serverId, ...next })
  emit({ type: 'schedule-ran', id: schedule.id, ...next })
  return { ok: !error, error }
}

function scheduleRun(scheduleId) {
  const schedule = readSchedules().find((item) => item.id === scheduleId)
  if (!schedule) return { ok: false, error: 'Không tìm thấy lịch trình.' }
  runSteps(schedule).catch(() => {})
  return { ok: true }
}

function startScheduler() {
  if (scheduler) return
  scheduler = setInterval(() => {
    const now = Date.now()
    const list = readSchedules()
    for (const item of list) {
      if (item.isActive === false || item.isProcessing) continue
      const next = Number(item.nextRunAt || 0)
      if (next && next <= now) runSteps(item).catch(() => {})
    }
  }, 20000)
  if (scheduler.unref) scheduler.unref()
}

function stopScheduler() {
  if (scheduler) clearInterval(scheduler)
  scheduler = null
}

function wsConnect(id) {
  emit({ type: 'wings-ws', serverId: id, event: 'auth success', payload: {} })
  emit({ type: 'wings-ws', serverId: id, event: 'status', payload: { state: statusOf(find(id)) } })
  return { ok: true }
}

function wsDisconnect() {
  return { ok: true }
}

function wsStatus(id) {
  try {
    const state = statusOf(find(id))
    return { ok: true, connected: true, authenticated: true, state }
  } catch (err) {
    return { ok: false, error: err.message, connected: false, authenticated: false }
  }
}

function wsSend(id, event, args) {
  if (event === 'send command') {
    const text = Array.isArray(args) ? args[0] : args
    return command(id, text)
  }
  return { ok: true }
}

function databaseSetup() {
  return { ok: false, error: 'Server chạy local không có MySQL — dùng panel hosting để tạo database.' }
}

async function pruneClientMods(id) {
  let entry
  try {
    entry = find(id)
  } catch (err) {
    return { ok: false, error: err.message, moved: [] }
  }
  const modsDir = path.join(entry.dir, 'mods')
  const names = (await fsp.readdir(modsDir).catch(() => [])).filter((name) => /\.jar(\.disabled)?$/i.test(name))
  if (!names.length) return { ok: true, moved: [], count: 0, checked: 0 }
  const envs = await require('./content.cjs').modEnvs({ dir: modsDir, names }).catch(() => ({}))
  const { isClientOnlyJar, declaredSide } = require('./modscan.cjs')
  const flagged = new Map()
  for (const name of names) {
    if (envs[name] === 'client') flagged.set(name, 'modrinth')
    else if (isClientOnlyJar(path.join(modsDir, name))) flagged.set(name, 'lwjgl')
    else if (declaredSide(path.join(modsDir, name))?.env === 'client') flagged.set(name, 'metadata')
  }
  if (!flagged.size) return { ok: true, moved: [], count: 0, checked: names.length }
  const dest = path.join(modsDir, '_client-only')
  await fsp.mkdir(dest, { recursive: true })
  const moved = []
  const lwjgl = []
  for (const [name, reason] of flagged) {
    try {
      await fsp.rename(path.join(modsDir, name), path.join(dest, name))
      moved.push(name)
      if (reason === 'lwjgl') lwjgl.push(name)
    } catch {}
  }
  diskCache.delete(id)
  for (const name of lwjgl) {
    emit({ type: 'server-log', serverId: id, message: `[Daemon] Mod client-only (chứa thư viện đồ hoạ LWJGL, server không chạy được): ${name}` })
  }
  emit({ type: 'server-log', serverId: id, message: `[Daemon] Đã chuyển ${moved.length} mod client-only vào mods/_client-only/` })
  return { ok: true, moved, count: moved.length, checked: names.length, lwjgl, dest }
}

function tps(id) {
  return { ok: true, tps: tpsCache.get(id) ?? null }
}

function historyPushAll() {
  return historyCache
}

module.exports = {
  configure,
  configs,
  config,
  status,
  state,
  history,
  logs,
  logEntries,
  command,
  power,
  install,
  fileList,
  fileRead,
  fileWrite,
  fileDelete,
  fileCreate,
  fileMove,
  fileUpload,
  syncConfig,
  remove,
  trashList,
  trashRestore,
  trashPurge,
  backupList,
  backupCreate,
  backupUpdate,
  backupRestore,
  backupDelete,
  backupDownload,
  scheduleList,
  schedulePreview,
  scheduleCreate,
  scheduleUpdate,
  scheduleToggle,
  scheduleDelete,
  scheduleRun,
  startScheduler,
  stopScheduler,
  wsConnect,
  wsDisconnect,
  wsStatus,
  wsSend,
  databaseSetup,
  pruneClientMods,
  tps,
  view,
  diskCache,
  historyPushAll,
}
