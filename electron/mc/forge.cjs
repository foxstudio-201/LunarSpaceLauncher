const fs = require('fs')
const fsp = fs.promises
const path = require('path')
const { spawn } = require('child_process')
const AdmZip = require('adm-zip')
const { downloadAll, fetchJson, UA } = require('./net.cjs')

const MAVEN = 'https://maven.minecraftforge.net/net/minecraftforge/forge'
const META_URL = 'https://files.minecraftforge.net/net/minecraftforge/forge/maven-metadata.json'
const PROMOS_URL = 'https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json'
const MIN_GAME = '1.5.2'

let cache = null

function atLeast(version, min) {
  const a = String(version).split('.').map((n) => parseInt(n, 10) || 0)
  const b = String(min).split('.').map((n) => parseInt(n, 10) || 0)
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const x = a[i] || 0
    const y = b[i] || 0
    if (x !== y) return x > y
  }
  return true
}

async function getMeta({ force = false } = {}) {
  if (cache && !force) return cache
  const [meta, promos] = await Promise.all([
    fetchJson(META_URL).catch(() => null),
    fetchJson(PROMOS_URL).catch(() => null),
  ])
  if (!meta) throw new Error('Không tải được danh sách bản Forge')
  cache = { meta, promos: promos?.promos || {} }
  return cache
}

function displayVersion(game, id) {
  let v = String(id)
  if (v.startsWith(`${game}-`)) v = v.slice(game.length + 1)
  if (v.endsWith(`-${game}`)) v = v.slice(0, -(game.length + 1))
  return v
}

async function listVersions({ game, force = false }) {
  if (!atLeast(game, MIN_GAME)) return []
  const { meta, promos } = await getMeta({ force })
  const all = meta[game] || []
  const latest = promos[`${game}-latest`] || null
  const recommended = promos[`${game}-recommended`] || null
  const rows = all.slice().reverse().map((id) => ({
    id,
    version: displayVersion(game, id),
    build: null,
    stable: !!(recommended && id.endsWith(`-${recommended}`)),
    latest: !!(latest && id.endsWith(`-${latest}`)),
  }))
  if (rows.length && !rows.some((r) => r.latest)) rows[0] = { ...rows[0], latest: true }
  return rows.slice(0, 60)
}

async function listGames({ force = false } = {}) {
  const { meta } = await getMeta({ force })
  return Object.keys(meta)
    .filter((version) => atLeast(version, MIN_GAME))
    .map((version) => ({ version, stable: true }))
}

function installerMode(jarPath) {
  let raw
  try {
    raw = new AdmZip(jarPath).readAsText('install_profile.json')
  } catch {
    return 'none'
  }
  try {
    return JSON.parse(raw).versionInfo ? 'legacy' : 'modern'
  } catch {
    return 'none'
  }
}

const MIRRORS = ['https://libraries.minecraft.net/', 'https://maven.minecraftforge.net/']

function libRel(name, classifier) {
  const parts = String(name).split(':')
  if (parts.length < 3) return null
  const [group, artifact, version] = parts
  return `${group.replace(/\./g, '/')}/${artifact}/${version}/${artifact}-${version}${classifier ? `-${classifier}` : ''}.jar`
}

async function reachable(url) {
  try {
    const res = await fetch(url, { method: 'HEAD', headers: UA, signal: AbortSignal.timeout(20000) })
    return res.ok
  } catch {
    return false
  }
}

async function resolveMirrors(libraries) {
  await Promise.all((libraries || []).map(async (lib) => {
    if (lib.downloads?.artifact || lib.downloads?.classifiers) return
    const rel = libRel(lib.name, String(lib.name).split(':')[3])
    if (!rel) return
    const bases = [...new Set([lib.url && String(lib.url).replace(/\/?$/, '/'), ...MIRRORS].filter(Boolean))]
    for (const base of bases) {
      if (await reachable(base + rel)) {
        lib.url = base
        return
      }
    }
  }))
}

async function placeUniversal({ jarPath, install, fullId, dest }) {
  if (fs.existsSync(dest)) return true
  try {
    const data = new AdmZip(jarPath).readFile(install.filePath)
    if (data) {
      await fsp.mkdir(path.dirname(dest), { recursive: true })
      await fsp.writeFile(dest, data)
      return true
    }
  } catch {}
  const urls = [`${MAVEN}/${fullId}/forge-${fullId}-universal.jar`]
  for (const url of urls) {
    try {
      const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(60000) })
      if (!res.ok) continue
      await fsp.mkdir(path.dirname(dest), { recursive: true })
      await fsp.writeFile(dest, Buffer.from(await res.arrayBuffer()))
      return true
    } catch {}
  }
  return false
}

async function installLegacy({ jarPath, game, fullId, versionsDir, librariesDir, onLog }) {
  const profile = JSON.parse(new AdmZip(jarPath).readAsText('install_profile.json'))
  const versionInfo = profile.versionInfo
  if (!versionInfo?.id) throw new Error('Installer Forge cũ thiếu versionInfo')
  const id = versionInfo.id

  const install = profile.install || {}
  if (install.path && install.filePath && install.path.includes(':')) {
    const rel = `net/minecraftforge/forge/${fullId}/forge-${fullId}-universal.jar`
    const dest = path.join(librariesDir, rel)
    const ok = await placeUniversal({ jarPath, install, fullId, dest })
    if (!ok) throw new Error(`Không lấy được ${install.filePath} của Forge ${fullId}`)
    for (const lib of versionInfo.libraries || []) {
      if (lib.name === install.path && !lib.downloads?.artifact) {
        lib.downloads = { artifact: { url: `${MAVEN}/${fullId}/forge-${fullId}-universal.jar`, path: rel } }
      }
    }
  }

  await resolveMirrors(versionInfo.libraries)

  if (!versionInfo.inheritsFrom) {
    let vanilla = null
    try {
      vanilla = JSON.parse(await fsp.readFile(path.join(versionsDir, game, `${game}.json`), 'utf8'))
    } catch {}
    if (vanilla) {
      if (!versionInfo.assetIndex && vanilla.assetIndex) versionInfo.assetIndex = vanilla.assetIndex
      if (!versionInfo.assets && vanilla.assets) versionInfo.assets = vanilla.assets
    }
  }

  const dir = path.join(versionsDir, id)
  await fsp.mkdir(dir, { recursive: true })
  await fsp.writeFile(path.join(dir, `${id}.json`), JSON.stringify(versionInfo, null, 2), 'utf8')

  if (!versionInfo.inheritsFrom) {
    const dst = path.join(dir, `${id}.jar`)
    if (!fs.existsSync(dst)) {
      try {
        await fsp.copyFile(path.join(versionsDir, game, `${game}.jar`), dst)
        if (install.stripMeta) {
          const zip = new AdmZip(dst)
          const signed = zip.getEntries().filter((e) => /^META-INF\/[^/]+\.(SF|DSA|RSA|EC)$/i.test(e.entryName))
          if (signed.length) {
            for (const entry of signed) zip.deleteFile(entry.entryName)
            zip.writeZip(dst)
            onLog?.(`[LunarSpace] Đã bỏ ${signed.length} tệp chữ ký khỏi jar gốc`)
          }
        }
      } catch (err) {
        onLog?.(`[LunarSpace] Không sao chép được jar gốc: ${err.message}`)
      }
    }
  }
  return id
}

async function resolveFullId({ game, idOrVersion, force = false }) {
  const { meta } = await getMeta({ force })
  const all = meta[game] || []
  const raw = String(idOrVersion)
  if (all.includes(raw)) return raw
  const guess = `${game}-${raw}`
  if (all.includes(guess)) return guess
  const match = all.find((x) => displayVersion(game, x) === raw)
  return match || guess
}

async function ensureInstaller({ game, forgeId, dir, onProgress }) {
  const full = await resolveFullId({ game, idOrVersion: forgeId })
  const name = `forge-${full}-installer.jar`
  const dest = path.join(dir, name)
  let sha1 = null
  try {
    const res = await fetch(`${MAVEN}/${full}/${name}.sha1`, { headers: UA, signal: AbortSignal.timeout(20000) })
    if (res.ok) sha1 = (await res.text()).trim().slice(0, 40)
  } catch {}
  const url = `${MAVEN}/${full}/${name}`
  const res = await downloadAll([{ url, dest, sha1 }], { concurrency: 1, onProgress, label: 'forge', signal: undefined })
  if (res.errors.length) throw new Error(res.errors[0].error)
  return dest
}

function runInstaller({ javaPath, installer, root, onLog, timeout = 15 * 60 * 1000 }) {
  return new Promise((resolve) => {
    let child
    try {
      child = spawn(javaPath, ['-jar', installer, '--installClient', root], {
        cwd: root,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      })
    } catch (err) {
      onLog(`[LunarSpace] Không chạy được installer Forge: ${err.message}`)
      return resolve({ ok: false, code: -1 })
    }
    let settled = false
    let invalidOutputs = false
    const done = (code) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({ ok: code === 0, code, invalidOutputs })
    }
    const timer = setTimeout(() => {
      onLog('[LunarSpace] Installer Forge chạy quá lâu, dừng lại.')
      try {
        child.kill()
      } catch {}
      done(-1)
    }, timeout)
    const push = (chunk) => {
      for (const line of chunk.toString('utf8').split(/\r?\n/)) {
        const clean = line.replace(/\u001b\[[0-9;]*m/g, '').trimEnd()
        if (/invalid outputs/i.test(clean)) invalidOutputs = true
        if (clean) onLog(clean)
      }
    }
    child.stdout.on('data', push)
    child.stderr.on('data', push)
    child.on('error', (err) => {
      onLog(`[LunarSpace] Lỗi installer Forge: ${err.message}`)
      done(-1)
    })
    child.on('exit', (code) => done(code ?? -1))
  })
}

async function detectInstalledId({ versionsDir, before, game }) {
  let after = []
  try {
    after = await fsp.readdir(versionsDir)
  } catch {
    return null
  }
  const created = after.filter((name) => !before.has(name))
  const forgeLike = created.find((name) => /forge/i.test(name) && name.includes(game))
  return forgeLike || created.find((name) => /forge/i.test(name)) || null
}

async function versionJsonExists(versionsDir, id) {
  try {
    await fsp.access(path.join(versionsDir, id, `${id}.json`))
    return true
  } catch {
    return false
  }
}

async function findInstalled({ versionsDir, game, forgeId, idOrVersion }) {
  forgeId = forgeId || idOrVersion
  let names = []
  try {
    names = await fsp.readdir(versionsDir)
  } catch {
    return null
  }
  const full = await resolveFullId({ game, idOrVersion: forgeId })
  const display = displayVersion(game, full)
  const match = names.find((name) => /forge/i.test(name) && name.includes(game) && name.includes(display))
  if (match && (await versionJsonExists(versionsDir, match))) return match
  return null
}

module.exports = {
  MAVEN,
  META_URL,
  PROMOS_URL,
  getMeta,
  displayVersion,
  resolveFullId,
  listVersions,
  listGames,
  installerMode,
  installLegacy,
  ensureInstaller,
  runInstaller,
  detectInstalledId,
  versionJsonExists,
  findInstalled,
}
