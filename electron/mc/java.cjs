const fs = require('fs')
const fsp = fs.promises
const path = require('path')
const { fetchJson, downloadAll, sha1File } = require('./net.cjs')

const INDEX_URL = 'https://launchermeta.mojang.com/v1/products/java-runtime/2ec0cc96c44e5a76b9c8b7c39df7210883d12871/all.json'
const MARKER = 'lunaspace-runtime.json'
const EXCLUDED = new Set(['minecraft-java-exe'])
const RUNTIME_CONCURRENCY = 16

const javaExeName = () => (process.platform === 'win32' ? 'java.exe' : 'java')

function platformKey() {
  if (process.platform === 'win32') {
    if (process.arch === 'arm64') return 'windows-arm64'
    return process.arch === 'ia32' ? 'windows-x86' : 'windows-x64'
  }
  if (process.platform === 'darwin') return process.arch === 'arm64' ? 'mac-os-arm64' : 'mac-os'
  return process.arch === 'ia32' ? 'linux-i386' : 'linux'
}

function majorOf(name) {
  const match = String(name || '').match(/^(\d+)/)
  return match ? Number(match[1]) : null
}

function isRuntimeComponent(component) {
  return !EXCLUDED.has(component) && (component.startsWith('java-runtime') || component === 'jre-legacy')
}

function runtimeDir(paths, component) {
  return path.join(paths.runtime, `${component}-${platformKey()}`)
}

function javaPathFor(dir) {
  return path.join(dir, 'bin', javaExeName())
}

async function readMarker(dir) {
  try {
    return JSON.parse(await fsp.readFile(path.join(dir, MARKER), 'utf8'))
  } catch {
    return null
  }
}

async function getIndex({ metaDir, force = false } = {}) {
  const file = path.join(metaDir, 'java-runtimes.json')
  if (!force) {
    try {
      const cached = JSON.parse(await fsp.readFile(file, 'utf8'))
      if (cached?.platforms) return cached
    } catch {}
  }
  const index = await fetchJson(INDEX_URL)
  if (!index?.[platformKey()]) throw new Error('Manifest Java không có nền tảng này')
  try {
    await fsp.mkdir(metaDir, { recursive: true })
    await fsp.writeFile(file, JSON.stringify(index), 'utf8')
  } catch {}
  return index
}

async function findComponent({ metaDir, component, force } = {}) {
  if (!component) return null
  const index = await getIndex({ metaDir, force })
  const list = index?.[platformKey()]?.[component]
  if (!Array.isArray(list) || !list.length) return null
  const entry = list[0]
  return {
    component,
    platform: platformKey(),
    name: entry.version?.name || '',
    released: entry.version?.released || '',
    manifest: entry.manifest,
  }
}

async function componentForMajor({ metaDir, major } = {}) {
  const index = await getIndex({ metaDir })
  const platformIndex = index?.[platformKey()] || {}
  const candidates = []
  for (const [component, list] of Object.entries(platformIndex)) {
    if (!isRuntimeComponent(component) || component.includes('snapshot')) continue
    const value = majorOf(list?.[0]?.version?.name)
    if (value) candidates.push({ component, major: value })
  }
  const exact = candidates.find((c) => c.major === major)
  if (exact) return exact.component
  return candidates.filter((c) => c.major < major).sort((a, b) => b.major - a.major)[0]?.component || null
}

async function isReady(dir, manifestSha1) {
  const marker = await readMarker(dir)
  if (!marker || marker.manifestSha1 !== manifestSha1) return false
  try {
    await fsp.access(javaPathFor(dir))
    return true
  } catch {
    return false
  }
}

async function installRuntime({ paths, metaDir, component, onProgress, signal, force = false } = {}) {
  const entry = await findComponent({ metaDir, component, force })
  if (!entry) throw new Error(`Máy chủ Minecraft không có Java runtime "${component}" cho nền tảng ${platformKey()}`)

  const dir = runtimeDir(paths, component)
  if (!force && (await isReady(dir, entry.manifest.sha1))) {
    return { javaPath: javaPathFor(dir), dir, component, name: entry.name, bytes: 0, cached: true }
  }

  const manifest = await fetchJson(entry.manifest.url)
  const files = manifest?.files || {}
  const tasks = []
  const executables = []
  let expectedBytes = 0

  for (const [rel, info] of Object.entries(files)) {
    const dest = path.join(dir, ...rel.split('/'))
    if (info?.type === 'directory') {
      await fsp.mkdir(dest, { recursive: true })
      continue
    }
    if (info?.type === 'link') continue
    const raw = info?.downloads?.raw
    if (!raw?.url) continue
    expectedBytes += raw.size || 0
    tasks.push({ url: raw.url, dest, sha1: raw.sha1, size: raw.size, skipHash: true })
    if (info.executable) executables.push(dest)
  }

  const result = await downloadAll(tasks, {
    concurrency: RUNTIME_CONCURRENCY,
    onProgress: (p) => onProgress?.({ ...p, label: 'java', major: majorOf(entry.name), runtime: entry.name }),
    signal,
    label: 'java',
  })

  if (result.errors.length) {
    throw new Error(`Tải Java ${entry.name} lỗi: ${result.errors[0].error}`)
  }

  if (process.platform !== 'win32') {
    for (const file of executables) {
      try {
        await fsp.chmod(file, 0o755)
      } catch {}
    }
  }

  await fsp.writeFile(
    path.join(dir, MARKER),
    JSON.stringify({
      component,
      platform: entry.platform,
      name: entry.name,
      released: entry.released,
      manifestSha1: entry.manifest.sha1,
      files: tasks.length,
      bytes: expectedBytes,
      installedAt: new Date().toISOString(),
    }, null, 2),
    'utf8',
  )

  return { javaPath: javaPathFor(dir), dir, component, name: entry.name, major: majorOf(entry.name), bytes: expectedBytes, cached: false }
}

async function managedJava({ paths, metaDir, component, major, force } = {}) {
  if (component) {
    try {
      const entry = await findComponent({ metaDir, component, force })
      if (entry) {
        const dir = runtimeDir(paths, component)
        if (await isReady(dir, entry.manifest.sha1)) {
          return { ok: true, javaPath: javaPathFor(dir), dir, component, name: entry.name, major: majorOf(entry.name) }
        }
      }
    } catch {}
  }
  const installed = await listRuntimes({ paths, metaDir, force })
  const match = installed.find((r) => r.installed && (major ? r.major === major : true))
  if (match) return { ok: true, javaPath: match.javaPath, dir: match.dir, component: match.component, name: match.name, major: match.major }
  return { ok: false, error: `Chưa có Java ${major || ''} tải kèm.` }
}

async function dirSize(dir) {
  let total = 0
  for (const entry of await fsp.readdir(dir, { withFileTypes: true }).catch(() => [])) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) total += await dirSize(full)
    else total += (await fsp.stat(full).catch(() => ({ size: 0 }))).size
  }
  return total
}

async function listRuntimes({ paths, metaDir, force = false } = {}) {
  let index
  try {
    index = await getIndex({ metaDir, force })
  } catch {
    index = null
  }
  const platform = platformKey()
  const platformIndex = index?.[platform] || {}
  const items = []
  for (const [component, list] of Object.entries(platformIndex)) {
    if (!isRuntimeComponent(component)) continue
    const entry = Array.isArray(list) ? list[0] : null
    if (!entry) continue
    const dir = runtimeDir(paths, component)
    const marker = await readMarker(dir)
    let installed = false
    try {
      await fsp.access(javaPathFor(dir))
      installed = true
    } catch {}
    items.push({
      component,
      name: entry.version?.name || '',
      released: entry.version?.released || '',
      major: majorOf(entry.version?.name),
      downloadBytes: entry.manifest?.size || 0,
      dir,
      javaPath: javaPathFor(dir),
      installed,
      bytes: installed ? await dirSize(dir) : 0,
      installedAt: marker?.installedAt || null,
    })
  }
  items.sort((a, b) => (b.major || 0) - (a.major || 0) || a.component.localeCompare(b.component))
  return items
}

async function removeRuntime({ paths, component }) {
  if (!component) return { ok: false, error: 'Thiếu component.' }
  const dir = runtimeDir(paths, component)
  try {
    await fsp.access(path.join(dir, MARKER))
    await fsp.rm(dir, { recursive: true, force: true })
    return { ok: true }
  } catch {
    return { ok: false, error: 'Runtime này không do LunarSpace quản lý.' }
  }
}

async function verifyRuntime(dir, manifestSha1) {
  return isReady(dir, manifestSha1)
}

module.exports = {
  INDEX_URL,
  platformKey,
  majorOf,
  runtimeDir,
  javaPathFor,
  getIndex,
  findComponent,
  componentForMajor,
  installRuntime,
  managedJava,
  listRuntimes,
  removeRuntime,
  verifyRuntime,
  sha1File,
}
