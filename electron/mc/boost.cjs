const fs = require('fs')
const fsp = fs.promises
const path = require('path')
const { UA } = require('./net.cjs')

const AIKAR_FLAGS = [
  '-XX:+UseG1GC',
  '-XX:+ParallelRefProcEnabled',
  '-XX:MaxGCPauseMillis=200',
  '-XX:+UnlockExperimentalVMOptions',
  '-XX:+DisableExplicitGC',
  '-XX:+AlwaysPreTouch',
  '-XX:G1NewSizePercent=30',
  '-XX:G1MaxNewSizePercent=40',
  '-XX:G1HeapRegionSize=8M',
  '-XX:G1ReservePercent=20',
  '-XX:G1HeapWastePercent=5',
  '-XX:G1MixedGCCountTarget=4',
  '-XX:InitiatingHeapOccupancyPercent=15',
  '-XX:G1MixedGCLiveThresholdPercent=90',
  '-XX:G1RSetUpdatingPauseTimePercent=5',
  '-XX:SurvivorRatio=32',
  '-XX:+PerfDisableSharedMem',
  '-XX:MaxTenuringThreshold=1',
  '-Dusing.aikars.flags=https://mcflags.emc.gs',
  '-Daikars.new.flags=true',
]

function jvmFlags(memoryMb) {
  const mem = Math.max(512, Number(memoryMb) || 2048)
  return [`-Xms${mem}M`, ...AIKAR_FLAGS]
}

const PERF_MODS = {
  fabric: [
    { slug: 'sodium', name: 'Sodium' },
    { slug: 'lithium', name: 'Lithium' },
    { slug: 'ferrite-core', name: 'FerriteCore' },
  ],
  quilt: [
    { slug: 'sodium', name: 'Sodium' },
    { slug: 'lithium', name: 'Lithium' },
    { slug: 'ferrite-core', name: 'FerriteCore' },
  ],
  forge: [
    { slug: 'embeddium', name: 'Embeddium' },
    { slug: 'ferrite-core', name: 'FerriteCore' },
  ],
  neoforge: [
    { slug: 'embeddium', name: 'Embeddium' },
    { slug: 'ferrite-core', name: 'FerriteCore' },
  ],
}

const LOADERS_BY_KIND = {
  fabric: ['fabric', 'quilt'],
  quilt: ['quilt', 'fabric'],
  forge: ['forge', 'neoforge'],
  neoforge: ['neoforge', 'forge'],
}

async function modrinthVersions({ slug, game, loaders }) {
  const url = `https://api.modrinth.com/v2/project/${encodeURIComponent(slug)}/version?loaders=${encodeURIComponent(JSON.stringify(loaders))}&game_versions=${encodeURIComponent(JSON.stringify([game]))}`
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(25000) })
  if (!res.ok) return []
  const rows = await res.json()
  return Array.isArray(rows) ? rows : []
}

async function installPerfMods({ dir, game, loader, onProgress, onLog }) {
  const list = PERF_MODS[loader] || []
  const loaders = LOADERS_BY_KIND[loader] || (loader ? [loader] : [])
  if (!list.length) return { ok: false, reason: 'unsupported', installed: [], skipped: [], failed: [] }
  const modsDir = path.join(dir, 'mods')
  await fsp.mkdir(modsDir, { recursive: true })
  const installed = []
  const skipped = []
  const failed = []
  for (let i = 0; i < list.length; i += 1) {
    const mod = list[i]
    onProgress?.({ phase: 'download', label: 'boost', done: i, total: list.length, file: mod.name })
    try {
      const existing = (await fsp.readdir(modsDir)).filter((n) => n.endsWith('.jar') || n.endsWith('.jar.disabled'))
      const token = mod.slug.replace(/-/g, '')
      const found = existing.find((n) => n.toLowerCase().replace(/-/g, '').includes(token))
      if (found) {
        skipped.push({ name: mod.name, file: found, reason: 'exists' })
        onLog?.(`[LunarSpace] ${mod.name}: đã có (${found})`)
        continue
      }
      const versions = await modrinthVersions({ slug: mod.slug, game, loaders })
      if (!versions.length) {
        failed.push({ name: mod.name, error: `không có bản cho ${loader} ${game}` })
        continue
      }
      const version = versions[0]
      const file = (version.files || []).find((f) => f.primary) || (version.files || [])[0]
      if (!file?.url) {
        failed.push({ name: mod.name, error: 'không có tệp tải' })
        continue
      }
      const dest = path.join(modsDir, file.filename)
      const res = await fetch(file.url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(120000) })
      if (!res.ok) {
        failed.push({ name: mod.name, error: `HTTP ${res.status}` })
        continue
      }
      await fsp.writeFile(dest, Buffer.from(await res.arrayBuffer()))
      installed.push({ name: mod.name, file: file.filename, version: version.version_number })
      onLog?.(`[LunarSpace] ${mod.name} ${version.version_number} → ${file.filename}`)
    } catch (err) {
      failed.push({ name: mod.name, error: err.message })
    }
  }
  onProgress?.({ phase: 'clear' })
  return { ok: failed.length === 0, installed, skipped, failed }
}

async function setHighPriority(pid) {
  if (process.platform !== 'win32' || !pid) return false
  try {
    const { execFile } = require('child_process')
    execFile(
      'powershell',
      ['-NoProfile', '-Command', `try { (Get-Process -Id ${Number(pid)} -ErrorAction Stop).PriorityClass = 'High' } catch {}`],
      { windowsHide: true, timeout: 8000 },
      () => {},
    )
    return true
  } catch {
    return false
  }
}

module.exports = { jvmFlags, AIKAR_FLAGS, installPerfMods, PERF_MODS, setHighPriority }
