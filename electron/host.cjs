
const fs = require('fs')
const fsp = fs.promises
const path = require('path')
const net = require('net')
const { spawn } = require('child_process')
const AdmZip = require('adm-zip')
const { downloadAll } = require('./mc/net.cjs')

const AGENT_URL = 'https://bin.equinox.io/c/bNyj1mQVY4c/ngrok-v3-stable-windows-amd64.zip'
const AGENT_EXE = process.platform === 'win32' ? 'ngrok.exe' : 'ngrok'
const LOG_KEEP = 40

const TAIL_BYTES = 512 * 1024
const LAN_RE = /Local game hosted on port (\d+)/
const SERVER_RE = /Starting Minecraft server on [^:\s]*:(\d+)/
const LINE_TIME_RE = /^\[(\d{2}:\d{2}:\d{2})\]/
const STOP_RE = /Stopping (?:the )?server|Stopping server/

const relays = new Map()

async function readTail(file, bytes = TAIL_BYTES) {
  let handle
  try {
    handle = await fsp.open(file, 'r')
  } catch {
    return ''
  }
  try {
    const stat = await handle.stat()
    const start = Math.max(0, stat.size - bytes)
    const buffer = Buffer.alloc(stat.size - start)
    await handle.read(buffer, 0, buffer.length, start)
    return buffer.toString('utf8')
  } catch {
    return ''
  } finally {
    await handle.close().catch(() => {})
  }
}

async function latestLog(instanceDir) {
  const dir = path.join(instanceDir, 'logs')
  const candidates = [path.join(dir, 'latest.log')]
  try {
    const names = await fsp.readdir(dir)
    const dated = names
      .filter((name) => /^\d{4}-\d{2}-\d{2}-\d+\.log$/.test(name))
      .sort()
      .reverse()
      .slice(0, 2)
      .map((name) => path.join(dir, name))
    candidates.push(...dated)
  } catch {}
  for (const file of candidates) {
    const exists = await fsp.stat(file).then((st) => st.size > 0).catch(() => false)
    if (exists) return file
  }
  return null
}

async function detectPort(instanceDir) {
  const file = await latestLog(instanceDir)
  if (!file) return null
  const text = await readTail(file)
  if (!text) return null
  const lines = text.split(/\r?\n/)
  let found = null
  let stopped = false
  for (const line of lines) {
    const lan = line.match(LAN_RE)
    const server = lan ? null : line.match(SERVER_RE)
    const port = lan ? Number(lan[1]) : server ? Number(server[1]) : null
    if (port) {
      found = { port, at: line.match(LINE_TIME_RE)?.[1] || '', dedicated: !lan, line: line.trim().slice(0, 160) }
      stopped = false
      continue
    }
    if (found && STOP_RE.test(line)) stopped = true
  }
  if (!found) return null
  return { ...found, stopped, log: file }
}

function relayStatus(listenPort) {
  const relay = relays.get(listenPort)
  if (!relay) return { running: false, listenPort, targetPort: null, connections: 0, total: 0 }
  return {
    running: true,
    listenPort,
    targetPort: relay.targetPort,
    connections: relay.connections.size,
    total: relay.total,
  }
}

function relayStart({ targetPort, listenPort = 25565 } = {}) {
  return new Promise((resolve) => {
    if (!targetPort) return resolve({ ok: false, error: 'Chưa có cổng của world để nối tới.' })
    if (relays.has(listenPort)) {
      const relay = relays.get(listenPort)
      if (relay.targetPort === targetPort) return resolve({ ok: true, ...relayStatus(listenPort) })
      return resolve({ ok: false, error: `Cổng ${listenPort} đang dùng cho world ở cổng ${relay.targetPort}.` })
    }
    const connections = new Set()
    const relay = { targetPort, connections, total: 0, server: null }
    const server = net.createServer((socket) => {
      const upstream = net.connect({ host: '127.0.0.1', port: targetPort })
      connections.add(socket)
      relay.total += 1
      const drop = () => {
        connections.delete(socket)
        socket.destroy()
        upstream.destroy()
      }
      socket.on('error', drop)
      socket.on('close', drop)
      upstream.on('error', drop)
      upstream.on('close', drop)
      socket.pipe(upstream)
      upstream.pipe(socket)
    })
    server.on('error', (err) => {
      relays.delete(listenPort)
      resolve({ ok: false, error: err.message })
    })
    server.listen(listenPort, '127.0.0.1', () => {
      relay.server = server
      relays.set(listenPort, relay)
      resolve({ ok: true, ...relayStatus(listenPort) })
    })
  })
}

function relayStop({ listenPort = 25565 } = {}) {
  const relay = relays.get(listenPort)
  if (!relay) return { ok: true, ...relayStatus(listenPort) }
  relays.delete(listenPort)
  for (const socket of relay.connections) socket.destroy()
  relay.server?.close()
  return { ok: true, ...relayStatus(listenPort) }
}

function relayStopAll() {
  for (const listenPort of [...relays.keys()]) relayStop({ listenPort })
}

const tunnel = { child: null, address: '', startedAt: 0, webAddr: '', targetPort: 0, listenPort: 0, log: [], error: '', onExit: null }

function agentPath(dir) {
  return path.join(dir, AGENT_EXE)
}

async function agentStatus(dir) {
  const exe = agentPath(dir)
  const exists = await fsp.stat(exe).then((st) => st.size > 0).catch(() => false)
  return { installed: exists, path: exe, url: AGENT_URL }
}

async function agentInstall({ dir, onProgress }) {
  await fsp.mkdir(dir, { recursive: true })
  const zipPath = path.join(dir, 'ngrok.zip')
  const res = await downloadAll([{ url: AGENT_URL, dest: zipPath }], { concurrency: 1, label: 'agent', onProgress })
  if (res.errors.length) {
    await fsp.rm(zipPath, { force: true }).catch(() => {})
    throw new Error(res.errors[0].error || 'Tải agent thất bại')
  }
  const zip = new AdmZip(zipPath)
  const entry = zip.getEntries().find((e) => e.entryName.toLowerCase().endsWith(AGENT_EXE))
  if (!entry) throw new Error(`Tệp tải về không có ${AGENT_EXE}`)
  await fsp.writeFile(agentPath(dir), entry.getData())
  await fsp.rm(zipPath, { force: true }).catch(() => {})
  return { ok: true, path: agentPath(dir) }
}

async function agentVersion(dir) {
  const exe = agentPath(dir)
  const exists = await fsp.stat(exe).then(() => true).catch(() => false)
  if (!exists) return ''
  return new Promise((resolve) => {
    const child = spawn(exe, ['version'], { windowsHide: true })
    let out = ''
    child.stdout?.on('data', (chunk) => { out += chunk.toString() })
    child.on('error', () => resolve(''))
    child.on('exit', () => resolve(out.trim().split(/\r?\n/)[0] || ''))
    setTimeout(() => { try { child.kill() } catch {} resolve(out.trim()) }, 8000)
  })
}

async function freePort() {
  return new Promise((resolve) => {
    const probe = net.createServer()
    probe.on('error', () => resolve(0))
    probe.listen(0, '127.0.0.1', () => {
      const port = probe.address().port
      probe.close(() => resolve(port))
    })
  })
}

function pushLog(line) {
  const text = String(line || '').trim()
  if (!text) return
  tunnel.log.push(text)
  if (tunnel.log.length > LOG_KEEP) tunnel.log.splice(0, tunnel.log.length - LOG_KEEP)
}

async function readTunnelAddress() {
  if (!tunnel.webAddr) return ''
  try {
    const res = await fetch(`http://${tunnel.webAddr}/api/tunnels`, { signal: AbortSignal.timeout(4000) })
    const data = await res.json()
    const hit = (data?.tunnels || []).find((t) => t.proto === 'tcp') || (data?.tunnels || [])[0]
    const url = String(hit?.public_url || '')
    return url ? url.replace(/^tcp:\/\//, '') : ''
  } catch {
    return ''
  }
}

async function tunnelStart({ dir, token, targetPort, listenPort = 25565, onExit }) {
  if (tunnel.child) return { ok: false, error: 'Đường truyền đang chạy.' }
  if (!token) return { ok: false, error: 'Chưa có authtoken của ngrok.' }
  const exe = agentPath(dir)
  const exists = await fsp.stat(exe).then((st) => st.size > 0).catch(() => false)
  if (!exists) return { ok: false, error: 'Chưa tải agent ngrok.' }
  const relayed = await relayStart({ targetPort, listenPort })
  if (!relayed.ok) return relayed
  const webPort = await freePort()
  if (!webPort) {
    relayStop({ listenPort })
    return { ok: false, error: 'Không tìm được cổng trống cho ngrok.' }
  }
  tunnel.webAddr = `127.0.0.1:${webPort}`
  tunnel.targetPort = targetPort
  tunnel.listenPort = listenPort
  tunnel.onExit = onExit || null
  tunnel.log = []
  tunnel.error = ''
  tunnel.address = ''
  const configFile = path.join(dir, 'ngrok.yml')
  await fsp.writeFile(
    configFile,
    `version: 3\nagent:\n  authtoken: ${token}\n  web_addr: ${tunnel.webAddr}\n`,
    'utf8',
  )
  const child = spawn(
    exe,
    ['--config', configFile, 'tcp', String(listenPort), '--log', 'stdout', '--log-level', 'info'],
    { windowsHide: true },
  )
  tunnel.child = child
  tunnel.startedAt = Date.now()
  child.stdout?.on('data', (chunk) => String(chunk).split(/\r?\n/).forEach(pushLog))
  child.stderr?.on('data', (chunk) => String(chunk).split(/\r?\n/).forEach(pushLog))
  child.on('error', (err) => {
    tunnel.error = err.message
    pushLog(`[lỗi] ${err.message}`)
  })
  child.on('exit', (code) => {
    tunnel.child = null
    tunnel.address = ''
    tunnel.startedAt = 0
    relayStopAll()
    pushLog(`[ngrok đã thoát, mã ${code}]`)
    const cb = tunnel.onExit
    tunnel.onExit = null
    if (code) {
      const readable = tunnel.log
        .map((line) => line.match(/^ERROR:\s*(\S.*)$/)?.[1])
        .filter((text) => text && !/^https?:\/\//.test(text))
        .shift()
      tunnel.error = readable || `ngrok thoát với mã ${code}`
    }
    cb?.({ code, log: tunnel.log.slice(-12) })
  })
  for (let i = 0; i < 20; i += 1) {
    await new Promise((r) => setTimeout(r, 700))
    if (!tunnel.child) break
    tunnel.address = await readTunnelAddress()
    if (tunnel.address) break
  }
  if (!tunnel.child) return { ok: false, error: tunnel.error || 'ngrok không khởi động được.', log: tunnel.log.slice(-12) }
  return { ok: true, ...tunnelStatus() }
}

function tunnelStop() {
  if (tunnel.child) {
    tunnel.onExit = null
    try {
      tunnel.child.kill()
    } catch {}
    tunnel.child = null
  }
  tunnel.address = ''
  tunnel.startedAt = 0
  relayStopAll()
  return { ok: true, ...tunnelStatus() }
}

function tunnelStatus() {
  return {
    running: !!tunnel.child,
    address: tunnel.address,
    startedAt: tunnel.startedAt,
    targetPort: tunnel.targetPort,
    listenPort: tunnel.listenPort,
    log: tunnel.log.slice(-12),
    error: tunnel.error,
    relay: relayStatus(tunnel.listenPort),
  }
}

module.exports = {
  detectPort,
  relayStart,
  relayStop,
  relayStopAll,
  relayStatus,
  latestLog,
  agentStatus,
  agentInstall,
  agentVersion,
  tunnelStart,
  tunnelStop,
  tunnelStatus,
  agentPath,
}
