const fs = require('fs')
const fsp = fs.promises
const path = require('path')
const os = require('os')
const net = require('net')
const { spawn } = require('child_process')
const { downloadOne } = require('./net.cjs')

const EGGS_DIR = path.join(__dirname, 'eggs', 'minecraft')
const EGG_IDS = ['vanilla', 'paper', 'purpur', 'spigot', 'forge', 'fabric', 'neoforge']
const LOADER_EGG = { vanilla: 'vanilla', paper: 'paper', purpur: 'purpur', spigot: 'spigot', forge: 'forge', fabric: 'fabric', neoforge: 'neoforge' }
const ARGS_EGGS = new Set(['forge', 'neoforge'])
const MAX_LINES = 3000

const running = new Map()
const buffers = new Map()
const eggCache = new Map()
const javaDirCache = new Map()

function readEgg(id) {
  const key = EGG_IDS.includes(id) ? id : 'vanilla'
  if (eggCache.has(key)) return eggCache.get(key)
  try {
    const egg = JSON.parse(fs.readFileSync(path.join(EGGS_DIR, `${key}.json`), 'utf8'))
    eggCache.set(key, egg)
    return egg
  } catch {
    return null
  }
}

function eggList() {
  return EGG_IDS.map((id) => {
    const egg = readEgg(id)
    return {
      id,
      name: egg?.name || id,
      description: egg?.description || '',
      startup: egg?.startup || '',
      variables: (egg?.variables || []).map((v) => ({
        name: v.name,
        env: v.env_variable,
        value: v.default_value,
        editable: v.user_editable !== false,
        rules: v.rules || '',
      })),
    }
  })
}

function eggForLoader(loader) {
  return LOADER_EGG[String(loader || '').toLowerCase()] || 'vanilla'
}

function javaMajorFor(raw) {
  const low = String(raw || '').trim().toLowerCase()
  if (!low || low === 'latest' || low === 'snapshot') return 0
  const m = low.match(/^(\d+)\.(\d+)/)
  if (m) {
    const major = parseInt(m[1], 10)
    const minor = parseInt(m[2], 10)
    if (major >= 25) return 25
    if (major === 1) {
      if (minor > 21) return 25
      if (minor === 21) {
        const patch = parseInt((low.split('.')[2] || '0').replace(/\D.*/, ''), 10) || 0
        return patch >= 9 ? 25 : 21
      }
      if (minor === 20) {
        const patch = parseInt((low.split('.')[2] || '0').replace(/\D.*/, ''), 10) || 0
        return patch >= 5 ? 21 : 17
      }
      if (minor >= 17) return 17
      if (minor >= 13) return 16
      return 8
    }
    if (major >= 21 && major <= 24) return 21
  }
  return 0
}

function findBash() {
  if (process.platform !== 'win32') {
    for (const c of ['/bin/bash', '/usr/bin/bash', '/bin/sh', '/usr/bin/sh']) if (fs.existsSync(c)) return c
    return 'bash'
  }
  const wins = [
    'C:\\Program Files\\Git\\bin\\bash.exe',
    'C:\\Program Files (x86)\\Git\\bin\\bash.exe',
    path.join(os.homedir(), 'AppData', 'Local', 'Programs', 'Git', 'bin', 'bash.exe'),
    'C:\\Program Files\\Git\\usr\\bin\\bash.exe',
  ]
  for (const w of wins) if (fs.existsSync(w)) return w
  return null
}

function rewriteInstallScript(script, serverDir) {
  const posixDir = serverDir.replace(/\\/g, '/')
  let s = String(script || '')
  s = s.replace(/\/mnt\/server/g, posixDir)
  s = s.replace(/\/home\/container/g, posixDir)
  const shim = [
    'apt() { if command -v curl >/dev/null 2>&1 && command -v jq >/dev/null 2>&1; then echo "[basic] skip apt (curl/jq present): $*"; return 0; fi; echo "[basic] apt not available (need root or preinstall curl/jq): $*"; return 1; }',
    'apt-get() { apt "$@"; }',
    'export DEBIAN_FRONTEND=noninteractive',
    'export DISPLAY=',
    'export CI=true',
    '',
  ].join('\n')
  s = s.replace(/^#!.*\r?\n/, '')
  s = s.replace(/java\s+-jar\s+installer\.jar(?!\s+--installServer)/g, 'java -jar installer.jar --installServer')
  return '#!/usr/bin/env bash\nset -o pipefail\n' + shim + s
}

function buildEggEnv(egg, vars) {
  const cfg = vars || {}
  const canonical = cfg.MC_VERSION || cfg.MINECRAFT_VERSION || cfg.VANILLA_VERSION || cfg.DL_VERSION || ''
  const env = {}
  for (const v of egg?.variables || []) {
    const name = v.env_variable
    let value = ''
    if (name === 'SERVER_JARFILE') value = cfg.SERVER_JARFILE || v.default_value || 'server.jar'
    else if (/^(MC_VERSION|MINECRAFT_VERSION|VANILLA_VERSION|DL_VERSION)$/.test(name)) value = canonical || v.default_value || 'latest'
    else value = cfg[name] !== undefined && cfg[name] !== '' ? cfg[name] : v.default_value || ''
    env[name] = value
  }
  return env
}

function envMcVersion(env, vars) {
  return (
    env?.MC_VERSION ||
    env?.MINECRAFT_VERSION ||
    env?.VANILLA_VERSION ||
    env?.DL_VERSION ||
    vars?.MC_VERSION ||
    ''
  )
}

async function manifestJavaMajor(metaDir, mc) {
  const { getManifest, getVersionJson } = require('./meta.cjs')
  const { manifest } = await getManifest({ metaDir })
  let id = mc
  if (!id || /^(latest|snapshot)$/i.test(id)) id = mc === 'snapshot' ? manifest.latest?.snapshot : manifest.latest?.release
  const entry = (manifest.versions || []).find((v) => v.id === id)
  if (!entry) return 0
  const json = await getVersionJson({ metaDir, version: entry.id, url: entry.url })
  return Number(json?.javaVersion?.majorVersion) || 0
}

async function ensureTools({ toolsDir, onLog }) {
  const dir = path.join(toolsDir, 'tools')
  await fsp.mkdir(dir, { recursive: true })
  const jqBin = path.join(dir, process.platform === 'win32' ? 'jq.exe' : 'jq')
  if (!fs.existsSync(jqBin)) {
    const url =
      process.platform === 'win32'
        ? 'https://github.com/jqlang/jq/releases/latest/download/jq-windows-amd64.exe'
        : process.arch === 'arm64'
          ? 'https://github.com/jqlang/jq/releases/latest/download/jq-linux-arm64'
          : 'https://github.com/jqlang/jq/releases/latest/download/jq-linux-amd64'
    try {
      onLog?.('[Install] Downloading jq (basic tools)...')
      await downloadOne({ url, dest: jqBin }, () => {})
      if (process.platform !== 'win32') await fsp.chmod(jqBin, 0o755).catch(() => {})
    } catch (err) {
      onLog?.(`[Install] WARNING: jq download failed: ${err.message}`)
      return { dir, jq: null }
    }
  }
  try {
    await fsp.chmod(jqBin, 0o755)
  } catch {}
  return { dir, jq: jqBin }
}

function findJavaBin(root) {
  try {
    const stack = [root]
    while (stack.length) {
      const d = stack.pop()
      let entries
      try {
        entries = fs.readdirSync(d, { withFileTypes: true })
      } catch {
        continue
      }
      for (const e of entries) {
        const p = path.join(d, e.name)
        if (!e.isDirectory()) continue
        if (e.name === 'bin') {
          const j = process.platform === 'win32' ? path.join(p, 'java.exe') : path.join(p, 'java')
          if (fs.existsSync(j)) return j
        } else if (!e.name.startsWith('.') && e.name !== 'bin') {
          stack.push(p)
        }
      }
    }
  } catch {}
  return null
}

async function ensureJava({ root, major, onLog, onProgress }) {
  const ver = Number(major) > 0 ? Number(major) : 21
  const cached = javaDirCache.get(ver)
  if (cached && fs.existsSync(cached)) return cached
  const base = path.join(root, 'java')
  const dir = path.join(base, `jdk-${ver}`)
  const existing = findJavaBin(dir)
  if (existing) {
    javaDirCache.set(ver, existing)
    return existing
  }
  const osName = process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'mac' : 'linux'
  const arch = process.arch === 'arm64' ? 'aarch64' : 'x64'
  const isZip = osName === 'windows'
  const url = `https://api.adoptium.net/v3/binary/latest/${ver}/ga/${osName}/${arch}/jre/hotspot/normal/eclipse`
  const archive = path.join(base, `jdk-${ver}.${isZip ? 'zip' : 'tar.gz'}`
  )
  await fsp.mkdir(base, { recursive: true })
  await fsp.mkdir(dir, { recursive: true })
  onLog?.(`[Java] Downloading Java ${ver} (${osName}/${arch})...`)
  await downloadOne({ url, dest: archive }, (delta) => onProgress?.(delta))
  onLog?.(`[Java] Extracting Java ${ver}...`)
  if (isZip) {
    await new Promise((resolve, reject) => {
      const proc = spawn('powershell.exe', ['-NoProfile', '-Command', `Expand-Archive -LiteralPath '${archive}' -DestinationPath '${dir}' -Force`], { windowsHide: true })
      proc.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`Expand-Archive exit ${code}`))))
      proc.on('error', reject)
    })
  } else {
    await new Promise((resolve, reject) => {
      const proc = spawn('tar', ['-xzf', archive, '-C', dir], { windowsHide: true })
      proc.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`tar exit ${code}`))))
      proc.on('error', reject)
    })
  }
  await fsp.unlink(archive).catch(() => {})
  const bin = findJavaBin(dir)
  if (!bin) throw new Error(`Java ${ver} extract failed: binary not found in ${dir}`)
  javaDirCache.set(ver, bin)
  onLog?.(`[Java] Java ${ver} ready: ${bin}`)
  return bin
}

function isInstallerJar(name) {
  return /installer/i.test(String(name || ''))
}

function materializeWinArgs(dir) {
  const win = path.join(dir, 'win_args.txt')
  if (fs.existsSync(win)) return 'win_args.txt'
  const unix = path.join(dir, 'unix_args.txt')
  if (!fs.existsSync(unix)) return null
  try {
    const text = fs.readFileSync(unix, 'utf8')
    const fixed = text
      .split(/\r?\n/)
      .map((line) => (line.includes('.jar') && line.includes(':') ? line.split(':').map((part) => part.trim()).filter(Boolean).join(';') : line))
      .join('\n')
    fs.writeFileSync(win, fixed, 'utf8')
    return 'win_args.txt'
  } catch {
    return null
  }
}

function pickLaunch(dir, jarFile) {
  const jar = jarFile || 'server.jar'
  if (process.platform === 'win32') {
    const winArgs = materializeWinArgs(dir)
    if (winArgs) return { mode: 'args', file: winArgs }
  }
  if (fs.existsSync(path.join(dir, 'unix_args.txt'))) return { mode: 'args', file: 'unix_args.txt' }
  if (fs.existsSync(path.join(dir, jar))) return { mode: 'jar' }
  let jars = []
  try {
    jars = fs.readdirSync(dir).filter((f) => f.endsWith('.jar') && !isInstallerJar(f))
  } catch {}
  if (jars.length) return { mode: 'jar', file: jars[0] }
  return { mode: 'missing', file: null }
}

function copyTree({ sourceDir, targetDir, include, onProgress }) {
  const list = (include || []).filter(Boolean)
  let done = 0
  return (async () => {
    for (const rel of list) {
      const safe = String(rel).split('\\').join('/').replace(/^\/+/, '')
      if (!safe || safe.split('/').some((part) => !part || part === '..' || part === '.')) continue
      const from = path.join(sourceDir, ...safe.split('/'))
      const to = path.join(targetDir, ...safe.split('/'))
      try {
        const st = await fsp.stat(from)
        if (!st.isFile()) continue
        await fsp.mkdir(path.dirname(to), { recursive: true })
        await fsp.copyFile(from, to)
        done += 1
        onProgress?.({ done, total: list.length, file: safe })
      } catch {}
    }
    return done
  })()
}

function defaultInclude(files) {
  return (files || []).filter((f) => f.def).map((f) => f.rel)
}

async function installServer({ dir, eggId, vars, root, onLog, onProgress }) {
  const egg = readEgg(eggId)
  if (!egg) throw new Error(`Không có egg "${eggId}".`)
  const script = egg.scripts?.installation?.script
  if (!script) throw new Error(`Egg ${eggId} không có script cài đặt.`)
  const bash = findBash()
  if (!bash) throw new Error('Không tìm thấy bash. Trên Windows cần cài Git for Windows (Git Bash).')

  const env = buildEggEnv(egg, vars)
  const mc = envMcVersion(env, vars)
  let major = javaMajorFor(mc)
  if (!major || /^(latest|snapshot)$/i.test(String(mc))) {
    major = await manifestJavaMajor(path.join(root, 'meta'), mc).catch(() => 0)
  }
  if (!major) major = 21
  onLog?.(`[Install] Egg: ${egg.name} · Minecraft ${mc || '?'} · Java ${major}`)

  const tools = await ensureTools({ toolsDir: root, onLog })
  const javaBin = await ensureJava({
    root,
    major,
    onLog,
    onProgress: (delta) => onProgress?.({ phase: 'java', delta }),
  })

  const rewrite = rewriteInstallScript(script, dir)
  const scriptPath = path.join(dir, '_install.sh')
  await fsp.writeFile(scriptPath, rewrite, { mode: 0o755 })

  const pathDirs = [tools.dir, path.dirname(javaBin)].filter(Boolean)
  const spawnEnv = { ...process.env, ...env, TZ: process.env.TZ || 'UTC' }
  spawnEnv.PATH = [...pathDirs, spawnEnv.PATH || ''].join(path.delimiter)
  spawnEnv.JAVA_HOME = path.dirname(path.dirname(javaBin))

  const code = await new Promise((resolve, reject) => {
    let proc
    try {
      proc = spawn(bash, [scriptPath], { cwd: dir, env: spawnEnv, windowsHide: true })
    } catch (err) {
      reject(err)
      return
    }
    const emit = (chunk) => {
      for (const line of chunk.toString('utf8').split(/\r?\n/)) if (line) onLog?.(`[Install] ${line}`)
    }
    proc.stdout?.on('data', emit)
    proc.stderr?.on('data', emit)
    proc.on('error', reject)
    proc.on('exit', (exit) => resolve(exit ?? -1))
  })
  if (code !== 0) throw new Error(`Script cài đặt egg trả về mã ${code}.`)

  const jarFile = env.SERVER_JARFILE || 'server.jar'
  if (ARGS_EGGS.has(eggId)) {
    try {
      const group = eggId === 'neoforge' ? 'neoforged' : 'minecraftforge'
      const libRoot = path.join(dir, 'libraries', 'net', group)
      const dirs = fs.existsSync(libRoot) ? fs.readdirSync(libRoot).filter((n) => fs.statSync(path.join(libRoot, n)).isDirectory()) : []
      let found = null
      for (const sub of dirs) {
        const inner = fs.readdirSync(path.join(libRoot, sub)).filter((n) => fs.statSync(path.join(libRoot, sub, n)).isDirectory())
        for (const build of inner) {
          if (fs.existsSync(path.join(libRoot, sub, build, 'unix_args.txt'))) found = { sub, build }
        }
      }
      if (!found) onLog?.('[Install] WARNING: không thấy unix_args.txt trong libraries')
      else {
        const src = path.join(libRoot, found.sub, found.build)
        if (!fs.existsSync(path.join(dir, 'unix_args.txt'))) {
          await fsp.copyFile(path.join(src, 'unix_args.txt'), path.join(dir, 'unix_args.txt'))
          onLog?.(`[Install] Created unix_args.txt from libraries/net/${group}/${found.sub}/${found.build}`)
        }
        const serverJar = fs.readdirSync(src).find((f) => f.endsWith('-server.jar') && !isInstallerJar(f))
        if (serverJar && !fs.existsSync(path.join(dir, jarFile))) {
          await fsp.copyFile(path.join(src, serverJar), path.join(dir, jarFile))
          onLog?.(`[Install] Created ${jarFile} from ${serverJar}`)
        }
      }
    } catch (err) {
      onLog?.(`[Install] WARNING: post-process args: ${err.message}`)
    }
  }

  await writeEula(dir)
  await writeProperties(dir, vars || {})
  onLog?.('[Install] Installing process is completed')
  return { ok: true, java: javaBin, javaMajor: major, mc, jarFile, env }
}

async function writeEula(dir) {
  const file = path.join(dir, 'eula.txt')
  let need = true
  try {
    need = !/eula\s*=\s*true/i.test(await fsp.readFile(file, 'utf8'))
  } catch {}
  if (need) {
    await fsp.writeFile(file, '#By changing the setting below to TRUE you are indicating your agreement to our EULA (https://aka.ms/MinecraftEULA)\neula=true\n')
  }
}

async function writeProperties(dir, vars) {
  const port = Number(vars.port) || 25565
  const props = [
    `server-port=${port}`,
    `query.port=${port}`,
    'server-ip=',
    `level-name=${vars['level-name'] || 'world'}`,
    `gamemode=${vars.gamemode || 'survival'}`,
    `difficulty=${vars.difficulty || 'easy'}`,
    `max-players=${vars['max-players'] || 20}`,
    `online-mode=${vars['online-mode'] === false || vars['online-mode'] === 'false' ? 'false' : 'true'}`,
    `motd=${String(vars.motd || 'A Minecraft Server').replace(/\r?\n/g, ' ')}`,
    'enable-query=true',
    'eula=true',
  ].join('\n')
  await fsp.writeFile(path.join(dir, 'server.properties'), `${props}\n`)
}

function freePort(start = 25565) {
  return new Promise((resolve) => {
    let port = start
    const tryPort = () => {
      const server = net.createServer()
      server.once('error', () => {
        port += 1
        if (port > start + 50) resolve(start)
        else tryPort()
      })
      server.once('listening', () => server.close(() => resolve(port)))
      server.listen(port, '0.0.0.0')
    }
    tryPort()
  })
}

function pushLine(id, line) {
  const bucket = buffers.get(id) || { list: [], seq: 0 }
  bucket.list.push(line)
  bucket.seq += 1
  if (bucket.list.length > MAX_LINES) bucket.list.splice(0, bucket.list.length - MAX_LINES)
  buffers.set(id, bucket)
}

function serverLogs(id, since = 0, limit = 500) {
  const bucket = buffers.get(id) || { list: [], seq: 0 }
  const start = Math.max(0, since - (bucket.seq - bucket.list.length))
  const lines = since > 0 ? bucket.list.slice(start) : bucket.list.slice(-limit)
  return { lines, cursor: bucket.seq }
}

function clearLogs(id) {
  buffers.set(id, { list: [], seq: (buffers.get(id)?.seq || 0) + 1 })
}

async function startServer({ id, dir, eggId, jarFile, ramMb, javaBin, onLog, onExit }) {
  if (running.has(id)) return { ok: true, already: true }
  const launch = pickLaunch(dir, jarFile)
  if (launch.mode === 'missing') return { ok: false, error: 'Chưa có tệp server — cài đặt egg trước.' }
  const mem = Math.max(512, Number(ramMb) || 2048)
  const args = [
    `-Xms${Math.min(128, mem)}M`,
    `-Xmx${mem}M`,
    '-XX:MaxRAMPercentage=95.0',
    '-Dterminal.jline=false',
    '-Dterminal.ansi=true',
  ]
  if (launch.mode === 'args') args.push(`@${launch.file}`, 'nogui')
  else args.push('-jar', launch.file || jarFile || 'server.jar', 'nogui')

  onLog?.(`[Daemon] ${javaBin} ${args.join(' ')}`)
  const proc = spawn(javaBin, args, {
    cwd: dir,
    env: { ...process.env, TZ: process.env.TZ || 'UTC' },
    windowsHide: true,
  })
  const entry = { proc, stopping: false, startedAt: Date.now() }
  running.set(id, entry)

  let bufOut = ''
  let bufErr = ''
  const handle = (chunk, isErr) => {
    const raw = isErr ? (bufErr += chunk.toString('utf8')) : (bufOut += chunk.toString('utf8'))
    const parts = raw.split(/\r?\n/)
    const partial = parts.pop()
    if (isErr) bufErr = partial
    else bufOut = partial
    for (const line of parts) {
      if (!line) continue
      pushLine(id, line)
      onLog?.(line)
      if (/Done \(|For help, type/.test(line)) entry.ready = true
    }  }
  proc.stdout?.on('data', (d) => handle(d, false))
  proc.stderr?.on('data', (d) => handle(d, true))
  proc.on('error', (err) => {
    running.delete(id)
    onLog?.(`[Daemon] Spawn failed: ${err.message}`)
    onExit?.(-1, null, err.message)
  })
  proc.on('exit', (code, signal) => {
    running.delete(id)
    onLog?.(`[Daemon] Server stopped (exit ${code ?? -1}${signal ? ` · ${signal}` : ''})`)
    onExit?.(code ?? -1, signal, '')
  })
  return { ok: true, args, mode: launch.mode, file: launch.file }
}

function stopServer(id, force = false) {
  const entry = running.get(id)
  if (!entry) return { ok: false, error: 'Server không chạy.' }
  entry.stopping = true
  try {
    if (!force && entry.proc.stdin?.writable) {
      entry.proc.stdin.write('stop\n')
      return { ok: true, mode: 'stop' }
    }
    entry.proc.kill()
    return { ok: true, mode: 'kill' }
  } catch (err) {
    return { ok: false, error: err.message }
  }
}

function sendCommand(id, command) {
  const entry = running.get(id)
  if (!entry) return { ok: false, error: 'Server không chạy.' }
  try {
    entry.proc.stdin?.write(`${String(command || '').replace(/[\r\n]+/g, ' ')}\n`)
    pushLine(id, `> ${command}`)
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err.message }
  }
}

function statusOf(id) {
  const entry = running.get(id)
  if (!entry) return { running: false, state: 'stopped', uptime: 0, pid: null }
  return {
    running: true,
    state: entry.ready ? 'running' : entry.stopping ? 'stopping' : 'starting',
    uptime: Date.now() - entry.startedAt,
    pid: entry.proc.pid || null,
  }
}

function runningIds() {
  return [...running.keys()]
}

function stopAll() {
  for (const [id, entry] of running) {
    try {
      if (entry.proc.stdin?.writable) entry.proc.stdin.write('stop\n')
      else entry.proc.kill()
    } catch {}
  }
}

module.exports = {
  EGG_IDS,
  eggList,
  eggForLoader,
  readEgg,
  javaMajorFor,
  findBash,
  rewriteInstallScript,
  buildEggEnv,
  ensureTools,
  ensureJava,
  pickLaunch,
  materializeWinArgs,
  copyTree,
  defaultInclude,
  installServer,
  writeEula,
  writeProperties,
  freePort,
  startServer,
  stopServer,
  sendCommand,
  statusOf,
  runningIds,
  stopAll,
  serverLogs,
  clearLogs,
  pushLine,
}
