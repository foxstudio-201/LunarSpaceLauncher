const fs = require('fs')
const fsp = fs.promises
const path = require('path')
const crypto = require('crypto')
const { spawn, execFile } = require('child_process')
const { OS_NAME, ruleAllows } = require('./install.cjs')

const JAVA_HINTS = [
  'C:/Program Files/Java',
  'C:/Program Files/Eclipse Adoptium',
  'C:/Program Files/Microsoft',
  'C:/Program Files/Zulu',
  'C:/Program Files/BellSoft',
  'C:/Program Files/Amazon Corretto',
  'C:/Program Files/Temurin',
  'C:/Program Files/Common Files/Oracle/Java',
  'C:/Program Files (x86)/Java',
  'C:/Program Files (x86)/Eclipse Adoptium',
]

const JAVA_SHIMS = [
  'C:/Program Files/Common Files/Oracle/Java/javapath/java.exe',
  'C:/ProgramData/Oracle/Java/javapath/java.exe',
]

const javaExe = () => (process.platform === 'win32' ? 'java.exe' : 'java')

function regJavaHomes() {
  if (process.platform !== 'win32') return Promise.resolve([])
  const keys = [
    'HKLM\\SOFTWARE\\JavaSoft\\JDK',
    'HKLM\\SOFTWARE\\JavaSoft\\Java Development Kit',
    'HKLM\\SOFTWARE\\JavaSoft\\Java Runtime Environment',
    'HKLM\\SOFTWARE\\WOW6432Node\\JavaSoft\\Java Runtime Environment',
  ]
  const out = []
  return Promise.all(keys.map((key) => new Promise((resolve) => {
    execFile('reg', ['query', key, '/s', '/v', 'JavaHome'], { timeout: 5000, windowsHide: true }, (err, stdout) => {
      if (err || !stdout) return resolve()
      for (const line of stdout.split(/\r?\n/)) {
        const match = line.match(/JavaHome\s+REG_SZ\s+(.+)/)
        if (match) out.push(path.join(match[1].trim(), 'bin', javaExe()))
      }
      resolve()
    })
  }))).then(() => out)
}

function probe(exe) {
  return new Promise((resolve) => {
    execFile(exe, ['-version'], { timeout: 8000, windowsHide: true }, (err, stdout, stderr) => {
      const text = `${stderr || ''}${stdout || ''}`
      const match = text.match(/version "(\d+)(?:\.(\d+))?/)
      if (!match) return resolve(null)
      const major = Number(match[1]) >= 9 ? Number(match[1]) : Number(match[2] || 8)
      resolve({ path: exe, major, raw: text.split(/\r?\n/)[0] || '' })
    })
  })
}

async function candidates(explicit) {
  const list = []
  if (explicit) list.push(explicit)
  if (process.env.JAVA_HOME) list.push(path.join(process.env.JAVA_HOME, 'bin', javaExe()))
  if (process.platform === 'win32') {
    list.push(...JAVA_SHIMS)
    list.push(...(await regJavaHomes()))
    for (const root of JAVA_HINTS) {
      let entries = []
      try {
        entries = await fsp.readdir(root, { withFileTypes: true })
      } catch {
        continue
      }
      for (const entry of entries) {
        if (!entry.isDirectory()) continue
        list.push(path.join(root, entry.name, 'bin', javaExe()))
        try {
          for (const inner of await fsp.readdir(path.join(root, entry.name), { withFileTypes: true })) {
            if (inner.isDirectory()) list.push(path.join(root, entry.name, inner.name, 'bin', javaExe()))
          }
        } catch {}
      }
    }
  }
  list.push(javaExe())
  return [...new Set(list)]
}

let javaCache = null

async function findJava({ explicit, required = 8 } = {}) {
  if (javaCache && !explicit && Date.now() - javaCache.at < 10000) {
    return pickBest(javaCache.list, required)
  }
  const probes = await Promise.all((await candidates(explicit)).map(async (exe) => {
    try {
      await fsp.access(exe)
    } catch {
      if (exe !== javaExe()) return null
    }
    return probe(exe)
  }))
  const list = probes.filter(Boolean)
  javaCache = { at: Date.now(), list }
  return pickBest(list, required)
}

function pickBest(list, required) {
  if (!list.length) return { ok: false, error: 'Không tìm thấy Java trên máy. Hãy chọn đường dẫn Java trong Hệ thống.' }
  const ok = list.filter((j) => j.major >= required).sort((a, b) => a.major - b.major)
  if (ok.length) return { ok: true, java: ok[0], all: list }
  const best = list.sort((a, b) => b.major - a.major)[0]
  return {
    ok: false,
    java: best,
    all: list,
    error: `Cần Java ${required} nhưng máy chỉ có Java ${best.major}. Hãy chọn Java ${required}+ trong Hệ thống.`,
  }
}

function offlineUuid(name) {
  const hash = crypto.createHash('md5').update(`OfflinePlayer:${name}`, 'utf8').digest()
  hash[6] = (hash[6] & 0x0f) | 0x30
  hash[8] = (hash[8] & 0x3f) | 0x80
  const hex = hash.toString('hex')
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join('-')
}

function flatten(list) {
  const out = []
  for (const item of list || []) {
    if (typeof item === 'string') out.push(item)
    else if (item && ruleAllows(item.rules)) out.push(...(Array.isArray(item.value) ? item.value : [item.value]))
  }
  return out
}

function substitute(tokens, map) {
  return tokens.map((token) => String(token).replace(/\$\{([^}]+)\}/g, (_m, key) => (map[key] !== undefined ? String(map[key]) : '')))
}

function gameArgValue(chain, key) {
  const list = chain.arguments?.game
  if (!Array.isArray(list)) return null
  for (let i = 0; i < list.length; i += 1) {
    if (list[i] !== key) continue
    const next = list[i + 1]
    return typeof next === 'string' ? next : null
  }
  return null
}

function clientExtraJar({ chain, paths }) {
  const mc = gameArgValue(chain, '--fml.mcVersion')
  const mcp = gameArgValue(chain, '--fml.mcpVersion')
  if (!mc || !mcp) return null
  const file = path.join(paths.libraries, 'net', 'minecraft', 'client', `${mc}-${mcp}`, `client-${mc}-${mcp}-extra.jar`)
  return fs.existsSync(file) ? file : null
}

function buildLaunch({ chain, paths, nativesDir, instanceDir, username, memoryMb, extraJvm = [], auth = null, demo = false }) {
  const ownJarExists = fs.existsSync(path.join(paths.versions, chain._id, `${chain._id}.jar`))
  const forgeBootstrap = (chain.arguments?.jvm || []).some((arg) => typeof arg === 'string' && arg.includes('client-extra'))
  const extraClient = forgeBootstrap ? clientExtraJar({ chain, paths }) : null

  const classpath = [
    ...(chain.libraries || [])
      .filter((lib) => ruleAllows(lib.rules))
      .filter((lib) => {
        const dl = lib.downloads || {}
        if (dl.artifact) return true
        if (lib.natives || dl.classifiers) return false
        return true
      })
      .map((lib) => {
        const dl = lib.downloads?.artifact
        if (dl) return path.join(paths.libraries, dl.path)
        const parts = String(lib.name).split(':')
        const [group, artifact, version, classifier] = parts
        const rel = path.join(group.replace(/\./g, '/'), artifact, version, `${artifact}-${version}${classifier ? `-${classifier}` : ''}.jar`)
        return path.join(paths.libraries, rel)
      }),
    ...(forgeBootstrap
      ? []
      : [
          path.join(
            paths.versions,
            ownJarExists ? chain._id : chain._jarId,
            `${ownJarExists ? chain._id : chain._jarId}.jar`,
          ),
        ]),
    ...(extraClient ? [extraClient] : []),
    nativesDir,
  ].join(process.platform === 'win32' ? ';' : ':')

  const uuid = auth?.uuid || offlineUuid(username)
  const map = {
    auth_player_name: username,
    version_name: chain.id,
    game_directory: instanceDir,
    assets_root: paths.assets,
    game_assets: paths.assets,
    assets_index_name: chain.assetIndex?.id || chain.assets || 'legacy',
    auth_uuid: uuid,
    auth_access_token: auth?.accessToken || '0',
    auth_session: auth?.accessToken ? `token:${auth.accessToken}` : '0',
    clientid: '0',
    auth_xuid: auth?.xuid || '0',
    user_type: auth?.userType || 'legacy',
    version_type: chain.type || 'release',
    user_properties: '{}',
    natives_directory: nativesDir,
    launcher_name: 'LunarSpace',
    launcher_version: '1.0.0',
    classpath,
    classpath_separator: process.platform === 'win32' ? ';' : ':',
    library_directory: paths.libraries,
    resolution_width: '1280',
    resolution_height: '720',
    quickPlayPath: '',
  }

  const jvm = chain.arguments?.jvm?.length
    ? substitute(flatten(chain.arguments.jvm), map)
    : [
        `-Djava.library.path=${nativesDir}`,
        '-Dminecraft.launcher.brand=LunarSpace',
        '-Dminecraft.launcher.version=1.0.0',
        '-cp',
        classpath,
      ]

  if (forgeBootstrap) {
    const at = jvm.findIndex((a) => typeof a === 'string' && a.startsWith('-DignoreList='))
    if (at >= 0) {
      const parts = jvm[at].slice('-DignoreList='.length).split(',').filter(Boolean)
      const missing = []
      if (/^neoforge-/i.test(chain.id)) {
        if (!parts.includes('neoforge-')) missing.push('neoforge-')
      } else if (/(^|-)forge-/i.test(chain.id) && !parts.includes('forge-')) {
        missing.push('forge-')
      }
      if (missing.length) jvm[at] = `-DignoreList=${[...parts, ...missing].join(',')}`
    }
  }

  const game = chain.arguments?.game?.length
    ? substitute(flatten(chain.arguments.game), map)
    : substitute(String(chain.minecraftArguments || '').split(' ').filter(Boolean), map)

  if (demo && !game.includes('--demo')) game.push('--demo')

  const jvmArgs = [`-Xmx${memoryMb}M`, ...extraJvm.filter(Boolean), ...jvm]
  return { args: [...jvmArgs, chain.mainClass, ...game], classpath, uuid }
}

function stripAnsi(text) {
  return text.replace(/\u001b\[[0-9;]*m/g, '')
}

function killTree(pid) {
  if (process.platform === 'win32') {
    try {
      execFile('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true }, () => {})
    } catch {}
    return
  }
  try {
    process.kill(-pid, 'SIGTERM')
  } catch {
    try {
      process.kill(pid, 'SIGTERM')
    } catch {}
  }
}

function spawnGame({ javaPath, args, cwd, onLog, onExit }) {
  const child = spawn(javaPath, args, {
    cwd,
    windowsHide: true,
    detached: process.platform !== 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const push = (chunk) => {
    const lines = stripAnsi(chunk.toString('utf8')).split(/\r?\n/).filter((l) => l.length)
    for (const line of lines) onLog(line)
  }
  child.stdout.on('data', push)
  child.stderr.on('data', push)
  child.on('error', (err) => {
    onLog(`[LunarSpace] Không chạy được Java: ${err.message}`)
    onExit(-1)
  })
  child.on('exit', (code, signal) => onExit(code ?? -1, signal))
  return child
}

module.exports = { findJava, buildLaunch, spawnGame, killTree, offlineUuid, javaCacheReset: () => { javaCache = null } }
