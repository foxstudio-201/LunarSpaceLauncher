const fsp = require('fs').promises
const path = require('path')
const crypto = require('crypto')
const { fetchJson, UA } = require('./net.cjs')
const content = require('./content.cjs')
const icons = require('./icons.cjs')

const MODRINTH = 'https://api.modrinth.com/v2'
const KIND_BY_FOLDER = { mods: 'mods', resourcepacks: 'resourcepacks', shaderpacks: 'shaderpacks' }
const NOISE = new Set(['build', 'snapshot', 'beta', 'alpha', 'rc', 'pre', 'all', 'universal', 'mc', 'fabric', 'forge', 'neoforge', 'quilt', 'release', 'final', 'stable', 'lib', 'library', 'v', 'outdated', 'new', 'old', 'copy', 'backup', 'fixed', 'edit', 'patched'])

async function sha1File(file) {
  return new Promise((resolve) => {
    const hash = crypto.createHash('sha1')
    const stream = require('fs').createReadStream(file)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('end', () => resolve(hash.digest('hex')))
    stream.on('error', () => resolve(''))
  })
}

function words(file) {
  const base = String(file)
    .replace(/§./g, '')
    .replace(/\.(disabled|rpo|txt|zip|jar)$/gi, '')
    .replace(/\.(disabled|rpo|txt)$/gi, '')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
  return base
    .split(/[-_+.\s]+/)
    .filter((part) => part && !NOISE.has(part.toLowerCase()) && !/\d/.test(part))
}

const norm = (value) => String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '')

const firstWord = (value) => {
  const text = String(value || '')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .split(/[-_+.\s]+/)
    .find((part) => part && !/^\d/.test(part))
  return norm(text || '')
}

const matches = (query, candidate) => {
  const q = norm(query)
  const c = norm(candidate)
  if (!q || q.length < 4) return false
  if (c === q || c.startsWith(q) || q.startsWith(c)) return true
  const head = firstWord(query)
  const other = firstWord(candidate)
  return head.length >= 3 && other.length >= 3 && (head === other || head.includes(other) || other.includes(head))
}

async function pool(items, limit, worker) {
  const out = []
  let index = 0
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (index < items.length) {
        const i = index
        index += 1
        out[i] = await worker(items[i])
      }
    }),
  )
  return out
}

async function remoteIcons({ dir, names = [], folder = 'mods', cacheDir, limit = 120 }) {
  const out = {}
  const targets = []
  const store = await loadUrls(cacheDir)
  for (const name of names.slice(0, limit)) {
    const file = await icons.resolvePath(name, dir)
    if (!file) continue
    const stat = await fsp.stat(file).catch(() => null)
    if (!stat || !stat.isFile()) continue
    const key = icons.iconKey(file, stat)
    const cached = await icons.readCached(cacheDir, key)
    if (cached) {
      out[name] = cached
      continue
    }
    if (store.urls[key]) {
      out[name] = store.urls[key]
      continue
    }
    targets.push({ name, file, key, stat })
  }
  if (!targets.length) return out

  const hashes = new Map()
  for (const item of targets) {
    const hash = await sha1File(item.file)
    if (hash) hashes.set(item.key, hash)
  }
  const byHash = new Map()
  const list = [...hashes.entries()]
  for (let i = 0; i < list.length; i += 200) {
    const chunk = list.slice(i, i + 200)
    try {
      const res = await fetch(`${MODRINTH}/version_files`, {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json', ...UA },
        body: JSON.stringify({ hashes: chunk.map(([, hash]) => hash), algorithm: 'sha1' }),
        signal: AbortSignal.timeout(20000),
      })
      if (res.ok) {
        const data = await res.json()
        for (const [hash, version] of Object.entries(data || {})) {
          if (version?.project_id) byHash.set(hash, version.project_id)
        }
      }
    } catch {}
  }

  const projectIcons = new Map()
  const ids = [...new Set([...byHash.values()])]
  for (let i = 0; i < ids.length; i += 100) {
    try {
      const listProjects = await fetchJson(`${MODRINTH}/projects?ids=${encodeURIComponent(JSON.stringify(ids.slice(i, i + 100)))}`)
      for (const project of listProjects || []) {
        if (project?.icon_url) projectIcons.set(project.id, project.icon_url)
      }
    } catch {}
  }

  const urls = new Map()
  const unresolved = []
  for (const item of targets) {
    const projectId = byHash.get(hashes.get(item.key))
    const url = projectId ? projectIcons.get(projectId) : ''
    if (url) urls.set(item.name, url)
    else unresolved.push(item)
  }

  const kind = KIND_BY_FOLDER[folder]
  if (kind) {
    const named = unresolved.slice(0, 30)
    const found = await pool(named, 4, async (item) => {
      const query = words(path.basename(item.file)).join(' ')
      if (!query) return null
      try {
        const res = await content.search({ kind, source: 'modrinth', query, limit: 6 })
        const hit = (res.hits || []).find((h) => matches(query, h.name) || matches(query, h.slug))
        if (hit?.icon) return { name: item.name, key: item.key, url: hit.icon }
      } catch {}
      try {
        const res = await content.search({ kind, source: 'curseforge', query, limit: 6 })
        const hit = (res.hits || []).find((h) => matches(query, h.name) || matches(query, h.slug))
        return hit?.icon ? { name: item.name, key: item.key, url: hit.icon } : null
      } catch {
        return null
      }
    })
    for (const item of found) {
      if (!item) continue
      urls.set(item.name, item.url)
      store.urls[item.key] = item.url
    }
  }

  for (const [name, url] of urls) out[name] = url
  await saveUrls(cacheDir, store)
  return out
}

const urlStorePath = (cacheDir) => path.join(cacheDir, 'remote-urls.json')

async function loadUrls(cacheDir) {
  const raw = await fsp.readFile(urlStorePath(cacheDir), 'utf8').catch(() => '')
  if (!raw) return { urls: {} }
  try {
    const data = JSON.parse(raw)
    if (data && typeof data.urls === 'object' && data.urls) return { urls: data.urls }
  } catch {}
  return { urls: {} }
}

async function saveUrls(cacheDir, store) {
  await fsp.mkdir(cacheDir, { recursive: true }).catch(() => {})
  const entries = Object.entries(store.urls || {})
  const trimmed = entries.slice(-2000)
  await fsp.writeFile(urlStorePath(cacheDir), JSON.stringify({ urls: Object.fromEntries(trimmed) }, null, 2), 'utf8').catch(() => {})
}

module.exports = { remoteIcons }
