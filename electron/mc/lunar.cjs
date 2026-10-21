const fsp = require('fs').promises
const path = require('path')
const { fetchJson, downloadAll } = require('./net.cjs')

const API_BASE = String(process.env.LUNARLOADER_API || 'https://lunarspace.site').replace(/\/+$/, '')
const cache = new Map()

async function apiJson(pathname, ttl = 60000) {
  const now = Date.now()
  const hit = cache.get(pathname)
  if (hit && now - hit.at < ttl) return hit.value
  const value = await fetchJson(API_BASE + pathname)
  if (!value || value.ok === false) {
    throw new Error(value?.error || `API LunarLoader trả về dữ liệu không hợp lệ`)
  }
  cache.set(pathname, { at: now, value })
  return value
}

async function listVersions(game) {
  if (!game) return []
  const json = await apiJson(`/api-v2/versions?mc=${encodeURIComponent(game)}`)
  const rows = Array.isArray(json.versions) ? json.versions : []
  return rows.map((row, index) => ({
    version: String(row.version || ''),
    build: null,
    stable: String(row.channel || 'stable') === 'stable',
    latest: index === 0,
    minecraft: String(row.minecraft || ''),
    publishedAt: row.published_at || null,
    id: row.id || null,
  })).filter((row) => row.version)
}

async function listGames() {
  const json = await apiJson('/api-v2/versions', 120000)
  const rows = Array.isArray(json.versions) ? json.versions : []
  const games = new Map()
  for (const row of rows) {
    const version = String(row.minecraft || '')
    if (!version) continue
    const current = games.get(version)
    if (!current || (current.channel !== 'stable' && row.channel === 'stable')) {
      games.set(version, { version, stable: String(row.channel || 'stable') === 'stable' })
    }
  }
  return [...games.values()].sort((a, b) => b.version.localeCompare(a.version, undefined, { numeric: true }))
}

async function latest({ game, version }) {
  const query = new URLSearchParams({ mc: String(game || '') })
  if (version) query.set('version', String(version))
  return apiJson(`/api-v2/latest?${query.toString()}`, 30000)
}

async function install({ game, version, paths, onProgress, signal }) {
  if (!paths?.libraries || !paths?.versions) throw new Error('Thiếu đường dẫn cài đặt')
  const manifest = await latest({ game, version })
  if (manifest.api !== 2) throw new Error('API LunarLoader không hỗ trợ giao thức này')
  if (!manifest.profile || !manifest.install) throw new Error('Bản phát hành thiếu profile cài đặt')

  const versionId = String(manifest.install.version_id || manifest.profile.id || '')
  if (!versionId) throw new Error('Manifest thiếu version_id')

  const libraries = Array.isArray(manifest.install.libraries) ? manifest.install.libraries : []
  if (!libraries.length) throw new Error('Manifest không có thư viện nào để tải')

  const tasks = libraries
    .filter((lib) => lib && lib.url && lib.path)
    .map((lib) => ({
      url: String(lib.url),
      dest: path.join(paths.libraries, String(lib.path)),
      sha1: lib.sha1 ? String(lib.sha1) : undefined,
      size: Number(lib.size) || 0,
    }))

  const concurrency = Math.max(1, Number(process.env.LUNARLOADER_CONCURRENCY) || 8)
  const result = await downloadAll(tasks, {
    concurrency,
    onProgress: (p) => onProgress?.({ label: 'lunarloader', ...p }),
    signal,
  })
  if (result.errors.length) {
    const first = result.errors[0]
    throw new Error(`Tải ${path.basename(first.file)} thất bại: ${first.error}`)
  }

  const dir = path.join(paths.versions, versionId)
  await fsp.mkdir(dir, { recursive: true })
  await fsp.writeFile(path.join(dir, `${versionId}.json`), JSON.stringify(manifest.profile, null, 2), 'utf8')

  return {
    versionId,
    release: manifest.release,
    profile: manifest.profile,
    summary: {
      files: tasks.length,
      bytes: tasks.reduce((sum, task) => sum + (task.size || 0), 0),
    },
  }
}

function clearCache() {
  cache.clear()
}

module.exports = { API_BASE, listVersions, listGames, latest, install, clearCache }
