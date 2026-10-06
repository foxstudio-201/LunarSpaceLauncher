const fs = require('fs')
const fsp = fs.promises
const path = require('path')
const AdmZip = require('adm-zip')
const { downloadAll, fetchJson, UA } = require('./net.cjs')

const MODRINTH = 'https://api.modrinth.com/v2'
const CF = 'https://api.curse.tools/v1'
const CF_GAME = 432
const CF_CLASS_MODPACK = 4471
const CF_CLASS_MOD = 6
const LOADER_IDS = ['fabric', 'quilt', 'forge', 'neoforge']
const CF_LOADER_ID = { forge: 1, fabric: 4, quilt: 5, neoforge: 6 }
const SLUG_SUFFIXES = ['-fabric', '-forge', '-neoforge', '-quilt']
const JSON_HEADERS = { ...UA, Accept: 'application/json' }
const MAX_EXTRA_CONCURRENCY = 6

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const CF_MIN_GAP_MS = 220
let cfGateChain = Promise.resolve()
let cfLastAt = 0

function cfGate() {
  cfGateChain = cfGateChain.then(async () => {
    const wait = CF_MIN_GAP_MS - (Date.now() - cfLastAt)
    if (wait > 0) await sleep(wait)
    cfLastAt = Date.now()
  })
  return cfGateChain
}

async function cfFetch(url, { method = 'GET', body, timeout = 30000, tries = 5 } = {}) {
  let lastError = null
  for (let attempt = 0; attempt < tries; attempt += 1) {
    await cfGate()
    try {
      const res = await fetch(url, {
        method,
        headers: body ? { ...JSON_HEADERS, 'Content-Type': 'application/json' } : JSON_HEADERS,
        body,
        signal: AbortSignal.timeout(timeout),
      })
      if (res.status === 429 || res.status >= 500) {
        lastError = new Error(`HTTP ${res.status} for ${url}`)
        await sleep(1200 * 2 ** attempt)
        continue
      }
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`)
      return res
    } catch (err) {
      lastError = err
      if (attempt === tries - 1) break
      await sleep(600 * 2 ** attempt)
    }
  }
  throw lastError || new Error(`Không gọi được ${url}`)
}

async function cfJson(url, opts) {
  const res = await cfFetch(url, opts)
  return res.json()
}

function iso(value) {
  const n = Number(value)
  if (Number.isFinite(n) && n > 0) return new Date(n).toISOString()
  if (typeof value === 'string' && value) return value
  return null
}

function mcVersionsOf(list) {
  return [...new Set((list || []).filter((v) => /^\d+(\.\d+)*$/.test(String(v))))]
}

function loadersOf(list) {
  const set = new Set()
  for (const item of list || []) {
    const value = String(item || '').toLowerCase()
    const hit = LOADER_IDS.find((id) => value === id || value.startsWith(`${id}-`) || value.includes(id))
    if (hit) set.add(hit)
  }
  return [...set]
}

function normName(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '')
}

function modKey(fileName) {
  let name = String(fileName || '').replace(/\.(jar|zip)(\.disabled)?$/i, '')
  name = name.replace(/^v?\d+(\.\d+)+[-_+ ]/, '')
  const cut = name.search(/[-_+ ]v?\d/)
  if (cut > 0) name = name.slice(0, cut)
  const key = normName(name)
  return key.length >= 3 ? key : normName(fileName)
}

async function mapLimit(items, limit, fn) {
  const list = [...items]
  const out = new Array(list.length)
  let cursor = 0
  const lanes = Math.max(1, Math.min(limit, list.length || 1))
  await Promise.all(Array.from({ length: lanes }, async () => {
    for (;;) {
      const index = cursor
      cursor += 1
      if (index >= list.length) return
      out[index] = await fn(list[index], index)
    }
  }))
  return out
}

async function searchModrinth({ query = '', sort = 'relevance', offset = 0, limit = 24 } = {}) {
  const facets = JSON.stringify([['project_type:modpack']])
  const index = ['relevance', 'downloads', 'follows', 'newest', 'updated'].includes(sort) ? sort : 'relevance'
  const url = `${MODRINTH}/search?query=${encodeURIComponent(query)}&facets=${encodeURIComponent(facets)}&index=${index}&limit=${limit}&offset=${offset}`
  const data = await fetchJson(url)
  return {
    total: data.total_hits || 0,
    hits: (data.hits || []).map((hit) => ({
      source: 'modrinth',
      id: hit.project_id,
      slug: hit.slug,
      name: hit.title,
      author: hit.author || '',
      summary: hit.description || '',
      icon: hit.icon_url || '',
      downloads: hit.downloads || 0,
      updated: iso(hit.date_modified),
      loaders: loadersOf(hit.categories),
      gameVersions: hit.versions || [],
    })),
  }
}

async function searchCurseforge({ query = '', sort = 'relevance', offset = 0, limit = 24 } = {}) {
  const sortField = sort === 'downloads' ? 6 : sort === 'updated' ? 3 : 1
  const url =
    `${CF}/mods/search?gameId=${CF_GAME}&classId=${CF_CLASS_MODPACK}` +
    `&searchFilter=${encodeURIComponent(query)}&sortField=${sortField}&sortOrder=desc&pageSize=${limit}&index=${offset}`
  const data = await cfJson(url)
  return {
    total: data?.pagination?.totalCount || 0,
    hits: (data?.data || []).map((mod) => ({
      source: 'curseforge',
      id: String(mod.id),
      slug: String(mod.slug || ''),
      name: mod.name,
      author: (mod.authors || []).map((a) => a.name).join(', '),
      summary: mod.summary || '',
      icon: mod.logo?.thumbnailUrl || '',
      downloads: mod.downloadCount || 0,
      updated: iso(mod.dateModified),
      loaders: loadersOf((mod.latestFilesIndexes || []).map((f) => cfLoaderName(f.modLoader))),
      gameVersions: [...new Set((mod.latestFilesIndexes || []).map((f) => f.gameVersion).filter(Boolean))],
    })),
  }
}

function cfLoaderName(id) {
  if (id === 1) return 'forge'
  if (id === 4) return 'fabric'
  if (id === 5) return 'quilt'
  if (id === 6) return 'neoforge'
  return ''
}

async function versionsModrinth({ id }) {
  const list = await fetchJson(`${MODRINTH}/project/${encodeURIComponent(id)}/version`)
  return (list || []).map((v) => ({
    id: v.id,
    name: v.name,
    versionNumber: v.version_number,
    gameVersions: v.game_versions || [],
    loaders: loadersOf(v.loaders),
    date: iso(v.date_published),
    downloads: v.downloads || 0,
    file: pickFile(v.files),
    dependencies: v.dependencies || [],
  }))
}

function pickFile(files) {
  const list = files || []
  const file = list.find((f) => f.primary) || list[0]
  if (!file) return null
  return { url: file.url, filename: file.filename, size: file.file_size || 0, sha1: file.hashes?.sha1 || null }
}

function cfFileUrl(file) {
  if (file.downloadUrl) return file.downloadUrl
  const id = Number(file.id)
  if (!Number.isFinite(id) || id <= 0) return null
  return `https://mediafilez.forgecdn.net/files/${String(id).slice(0, 4)}/${String(id).slice(4)}/${encodeURIComponent(file.fileName)}`
}

function cfFileUrls(file) {
  const urls = []
  if (file.downloadUrl) urls.push(file.downloadUrl)
  const id = Number(file.id)
  if (Number.isFinite(id) && id > 0) {
    const head = String(id).slice(0, 4)
    const tail = String(id).slice(4)
    const name = encodeURIComponent(file.fileName || '')
    urls.push(`https://mediafilez.forgecdn.net/files/${head}/${tail}/${name}`)
    urls.push(`https://edge.forgecdn.net/files/${head}/${tail}/${name}`)
  }
  return [...new Set(urls.filter(Boolean))]
}

function cfSha1(file) {
  return (file.hashes || []).find((h) => h.algo === 1)?.value || null
}

async function versionsCurseforge({ id }) {
  const data = await cfJson(`${CF}/mods/${encodeURIComponent(id)}/files?pageSize=50`)
  return (data?.data || []).map((f) => ({
    id: String(f.id),
    name: f.displayName || f.fileName,
    versionNumber: f.fileName,
    gameVersions: mcVersionsOf(f.gameVersions),
    loaders: loadersOf([cfLoaderName(f.modLoader)]),
    date: iso(f.fileDate),
    downloads: f.downloadCount || 0,
    releaseType: f.releaseType || 1,
    file: { url: cfFileUrl(f), filename: f.fileName, size: f.fileLength || 0, sha1: cfSha1(f) },
    dependencies: f.dependencies || [],
  }))
}

async function search({ source, ...rest } = {}) {
  return source === 'curseforge' ? searchCurseforge(rest) : searchModrinth(rest)
}

async function versions({ source, id } = {}) {
  return source === 'curseforge' ? versionsCurseforge({ id }) : versionsModrinth({ id })
}

function loaderFromModrinth(deps = {}) {
  if (deps['fabric-loader']) return { loader: 'fabric', loaderVersion: deps['fabric-loader'] }
  if (deps['quilt-loader']) return { loader: 'quilt', loaderVersion: deps['quilt-loader'] }
  if (deps.neoforge) return { loader: 'neoforge', loaderVersion: deps.neoforge }
  if (deps.forge) return { loader: 'forge', loaderVersion: deps.forge }
  return { loader: 'vanilla', loaderVersion: null }
}

function loaderFromCurseforge(manifest = {}) {
  const entry = (manifest.minecraft?.modLoaders || []).find((m) => m.primary) || (manifest.minecraft?.modLoaders || [])[0]
  const raw = String(entry?.id || '')
  const cut = raw.indexOf('-')
  if (cut < 0) return { loader: 'vanilla', loaderVersion: null }
  const kind = raw.slice(0, cut).toLowerCase()
  const version = raw.slice(cut + 1)
  return { loader: LOADER_IDS.includes(kind) ? kind : 'vanilla', loaderVersion: version || null }
}

async function downloadToCache({ url, name, dir, sha1, onProgress }) {
  const dest = path.join(dir, name)
  const res = await downloadAll([{ url, dest, sha1 }], { concurrency: 1, onProgress, label: 'modpack' })
  if (res.errors.length) throw new Error(res.errors[0].error)
  return dest
}

function readEntryText(entries, target) {
  const entry = entries.find((e) => !e.isDirectory && e.entryName.replace(/\\/g, '/').toLowerCase() === target)
  if (!entry) return null
  return entry.getData().toString('utf8')
}

function overridePrefixes(list) {
  const set = []
  for (const item of list) {
    const value = String(item || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')
    if (value && !set.includes(value.toLowerCase())) set.push(value.toLowerCase())
  }
  return set
}

async function extractOverrides({ entries, prefixes, targetDir }) {
  if (!prefixes.length) return 0
  const needles = prefixes.map((p) => `${p}/`)
  let count = 0
  for (const entry of entries) {
    if (entry.isDirectory) continue
    const name = entry.entryName.replace(/\\/g, '/')
    const low = name.toLowerCase()
    const hit = needles.find((p) => low.startsWith(p))
    if (!hit) continue
    const rel = name.slice(hit.length)
    if (!rel || rel.split('/').includes('..')) continue
    const dest = path.join(targetDir, rel)
    await fsp.mkdir(path.dirname(dest), { recursive: true })
    await fsp.writeFile(dest, entry.getData())
    count += 1
  }
  return count
}

function parseModlist(html) {
  const found = new Map()
  const bySlug = new Map()
  const add = (id, slug) => {
    const key = slug ? slug.toLowerCase() : null
    const existing = key ? bySlug.get(key) : null
    if (existing) {
      if (id && !existing.id) existing.id = String(id)
      return
    }
    const mapKey = id ? `id:${id}` : key ? `slug:${key}` : null
    if (!mapKey || found.has(mapKey)) return
    const entry = { id: id ? String(id) : null, slug: key }
    found.set(mapKey, entry)
    if (key) bySlug.set(key, entry)
  }
  const text = String(html || '')
  for (const m of text.matchAll(/curseforge\.com\/minecraft\/mc-mods\/([a-z0-9-_]+)/gi)) add(null, m[1])
  for (const m of text.matchAll(/curseforge\.com\/projects\/(\d+)(?:\/([a-z0-9-_]+))?/gi)) add(m[1], m[2] || null)
  return [...found.values()]
}

async function cfModBySlug(slug) {
  const variants = [slug]
  for (const suffix of SLUG_SUFFIXES) {
    if (slug.endsWith(suffix)) variants.push(slug.slice(0, -suffix.length))
  }
  for (const variant of variants) {
    const data = await cfJson(`${CF}/mods/search?gameId=${CF_GAME}&slug=${encodeURIComponent(variant)}&pageSize=10`)
    const list = (data?.data || []).filter((m) => Number(m.classId) === CF_CLASS_MOD)
    if (!list.length) continue
    const exact = list.find((m) => normName(m.slug) === normName(variant))
    if (exact) return exact
    if (variant !== slug) return list[0]
  }
  const loose = await cfJson(`${CF}/mods/search?gameId=${CF_GAME}&searchFilter=${encodeURIComponent(slug.replace(/-/g, ' '))}&pageSize=20`)
  const list = (loose?.data || []).filter((m) => Number(m.classId) === CF_CLASS_MOD)
  for (const variant of variants) {
    const byName = list.find((m) => normName(m.name) === normName(variant))
    if (byName) return byName
  }
  return null
}

function pickFromIndexes(mod, { mc, loader }) {
  const loaderId = CF_LOADER_ID[loader]
  const all = [...(mod.latestFilesIndexes || []), ...(mod.latestEarlyAccessFilesIndexes || [])]
  const matches = all.filter((row) => {
    if (!row.filename || !/\.jar$/i.test(row.filename)) return false
    if (mc && row.gameVersion !== mc) return false
    if (loaderId && row.modLoader && row.modLoader !== loaderId) return false
    return true
  })
  if (!matches.length) return null
  const sorted = matches.sort((a, b) => (b.fileId || 0) - (a.fileId || 0))
  return sorted.find((row) => (row.releaseType || 1) === 1) || sorted[0]
}

async function cfStrictFile(modId, { mc, loader }) {
  const loaderId = CF_LOADER_ID[loader]
  const query = mc && loaderId
    ? `gameVersion=${encodeURIComponent(mc)}&modLoaderType=${loaderId}`
    : mc
      ? `gameVersion=${encodeURIComponent(mc)}`
      : ''
  const data = await cfJson(`${CF}/mods/${modId}/files?pageSize=50${query ? `&${query}` : ''}`)
  const list = (data?.data || []).filter((f) => {
    if (f.isAvailable === false || !/\.jar$/i.test(f.fileName || '')) return false
    if (mc && (f.gameVersions || []).length && !(f.gameVersions || []).includes(mc)) return false
    return true
  })
  if (!list.length) return null
  const sorted = [...list].sort((a, b) => (b.fileDate || 0) - (a.fileDate || 0))
  return sorted.find((f) => (f.releaseType || 1) === 1) || sorted[0]
}

async function cfModlistFile(mod, { mc, loader }) {
  const fromIndex = pickFromIndexes(mod, { mc, loader })
  if (fromIndex) return { id: fromIndex.fileId, fileName: fromIndex.filename }
  return cfStrictFile(mod.id, { mc, loader })
}

async function modlistExtras({ html, coveredIds, coveredNames, coveredKeys, overrideStems, mc, loader, onLog, onPlan }) {
  const entries = parseModlist(html)
  const pending = entries.filter((e) => !(e.id && coveredIds.has(String(e.id))))
  if (!pending.length) return { files: [], unresolved: [], noMatch: [], listed: entries.length }
  const slugCache = new Map()
  let done = 0
  const results = await mapLimit(pending, MAX_EXTRA_CONCURRENCY, async (entry) => {
    try {
      let mod = entry.id ? { id: Number(entry.id) } : null
      if (!mod && entry.slug) {
        if (!slugCache.has(entry.slug)) slugCache.set(entry.slug, await cfModBySlug(entry.slug))
        mod = slugCache.get(entry.slug)
      }
      if (!mod) return { unresolved: entry.slug || entry.id }
      if (coveredIds.has(String(mod.id))) return null
      if (!entry.id) {
        const full = await cfJson(`${CF}/mods/${mod.id}`).catch(() => null)
        const detail = full?.data
        if (!detail || Number(detail.classId) !== CF_CLASS_MOD) return { unresolved: entry.slug || String(mod.id) }
        mod = detail
      }
      const slug = entry.slug || mod.slug || ''
      if (slug && normName(slug).length >= 5 && overrideStems.some((stem) => stem.includes(normName(slug)))) return null
      const file = await cfModlistFile(mod, { mc, loader })
      if (!file) return { noMatch: slug || String(mod.id) }
      const name = file.fileName
      if (coveredNames.has(name.toLowerCase())) return null
      const key = modKey(name)
      if (coveredKeys.has(key)) {
        onLog?.(`[LunarSpace] Bỏ qua ${name}: mod đã có trong modpack`)
        return null
      }
      const urls = cfFileUrls(file)
      if (!urls.length) return { unresolved: name }
      coveredNames.add(name.toLowerCase())
      coveredKeys.add(key)
      return {
        file: { rel: `mods/${name}`, url: urls[0], alts: urls.slice(1), sha1: cfSha1(file), size: file.fileLength || 0 },
        from: slug || String(mod.id),
      }
    } catch (err) {
      onLog?.(`[LunarSpace] Bỏ qua ${entry.slug || entry.id}: ${err.message}`)
      return { unresolved: entry.slug || entry.id }
    } finally {
      done += 1
      onPlan?.({ done, total: pending.length, label: 'modlist' })
    }
  })
  const files = []
  const unresolved = []
  const noMatch = []
  for (const row of results) {
    if (!row) continue
    if (row.file) files.push({ ...row.file, from: row.from })
    if (row.unresolved) unresolved.push(row.unresolved)
    if (row.noMatch) noMatch.push(row.noMatch)
  }
  return { files, unresolved, noMatch, listed: entries.length }
}

async function planFromMrpack({ zipPath, onLog }) {
  const zip = new AdmZip(zipPath)
  const entries = zip.getEntries()
  const raw = readEntryText(entries, 'modrinth.index.json')
  if (!raw) throw new Error('Tệp .mrpack không có modrinth.index.json')
  const index = JSON.parse(raw)
  const { loader, loaderVersion } = loaderFromModrinth(index.dependencies || {})
  const overrides = ['overrides', 'client-overrides']
  const missing = []
  const files = []
  for (const entry of index.files || []) {
    const rel = String(entry.path || '').replace(/\\/g, '/')
    if (!rel) continue
    if (entry.env?.client === 'unsupported') continue
    const url = (entry.downloads || [])[0]
    if (!url) {
      if (!prefixMatch(overrides, rel)) missing.push(rel)
      continue
    }
    files.push({ rel, url, sha1: entry.hashes?.sha1 || null, size: entry.fileSize || 0 })
  }
  if (missing.length) onLog?.(`[LunarSpace] ${missing.length} tệp trong index không có link tải: ${missing.slice(0, 6).join(', ')}`)
  return {
    name: index.name || 'Modpack',
    summary: index.summary || '',
    version: index.versionId || '',
    mc: index.dependencies?.minecraft || '',
    loader,
    loaderVersion,
    files,
    missing,
    listed: (index.files || []).length,
    extras: 0,
    zipPath,
    overrides,
    source: 'modrinth',
  }
}

function prefixMatch(prefixes, rel) {
  const low = rel.toLowerCase()
  return prefixes.some((p) => low.startsWith(`${p}/`))
}

async function resolveManifestFiles(entries, { onLog, onProgress }) {
  const wanted = entries
    .filter((f) => f.fileID)
    .map((f) => ({ fileId: Number(f.fileID), projectId: Number(f.projectID), optional: f.required === false }))
    .filter((f) => Number.isFinite(f.fileId) && f.fileId > 0)
  const resolved = new Map()
  const chunks = []
  for (let i = 0; i < wanted.length; i += 100) chunks.push(wanted.slice(i, i + 100))
  for (const chunk of chunks) {
    const ids = chunk.map((c) => c.fileId)
    try {
      const res = await cfFetch(`${CF}/mods/files`, {
        method: 'POST',
        body: JSON.stringify({ fileIds: ids }),
        tries: 4,
      })
      const body = await res.json()
      for (const file of body?.data || []) resolved.set(String(file.id), file)
    } catch (err) {
      onLog?.(`[LunarSpace] Lô CurseForge lỗi: ${err.message}`)
    }
    onProgress?.({ label: 'modpack', done: resolved.size, total: wanted.length, file: 'CurseForge' })
  }
  const pending = wanted.filter((c) => !resolved.has(String(c.fileId)))
  if (pending.length) {
    onLog?.(`[LunarSpace] ${pending.length} tệp chưa có trong lô, hỏi từng tệp…`)
    await mapLimit(pending, 3, async (item) => {
      if (!item.projectId) return
      try {
        const data = await cfJson(`${CF}/mods/${item.projectId}/files/${item.fileId}`)
        if (data?.data) resolved.set(String(data.data.id), data.data)
      } catch {}
    })
  }
  return { resolved, wanted }
}

async function planFromCurseforgeZip({ zipPath, onLog, onPlan }) {
  const zip = new AdmZip(zipPath)
  const entries = zip.getEntries()
  const raw = readEntryText(entries, 'manifest.json')
  if (!raw) throw new Error('Tệp zip không có manifest.json của CurseForge')
  const manifest = JSON.parse(raw)
  const { loader, loaderVersion } = loaderFromCurseforge(manifest)
  const mc = manifest.minecraft?.version || ''
  const overrides = overridePrefixes([manifest.overrides || 'overrides'])

  const { resolved } = await resolveManifestFiles(manifest.files || [], { onLog, onPlan })
  const files = []
  const missing = []
  const coveredIds = new Set()
  const coveredNames = new Set()
  const coveredKeys = new Set()
  let unresolvedIds = 0
  let optional = 0
  for (const entry of manifest.files || []) {
    coveredIds.add(String(entry.projectID))
    if (entry.required === false) optional += 1
    const file = resolved.get(String(entry.fileID))
    const urls = file ? cfFileUrls(file) : []
    if (!file || !urls.length) {
      unresolvedIds += 1
      missing.push(entry.fileName || `#${entry.projectID}`)
      continue
    }
    const key = modKey(file.fileName)
    if (coveredNames.has(file.fileName.toLowerCase()) || coveredKeys.has(key)) continue
    coveredNames.add(file.fileName.toLowerCase())
    coveredKeys.add(key)
    files.push({ rel: `mods/${file.fileName}`, url: urls[0], alts: urls.slice(1), sha1: cfSha1(file), size: file.fileLength || 0 })
  }

  const overrideStems = entries
    .filter((e) => !e.isDirectory && /\/mods\/[^/]+\.jar$/i.test(e.entryName.replace(/\\/g, '/')))
    .filter((e) => overrides.some((p) => e.entryName.replace(/\\/g, '/').toLowerCase().startsWith(`${p}/`)))
    .map((e) => normName(e.entryName.replace(/\\/g, '/').split('/').pop()))

  let extras = 0
  let listed = files.length
  let extraUnresolved = []
  let extraNoMatch = []
  const modlist = readEntryText(entries, 'modlist.html')
  if (modlist) {
    const extra = await modlistExtras({
      html: modlist,
      coveredIds,
      coveredNames,
      coveredKeys,
      overrideStems,
      mc,
      loader,
      onLog,
      onPlan,
    })
    listed = extra.listed
    extras = extra.files.length
    extraUnresolved = extra.unresolved
    extraNoMatch = extra.noMatch
    for (const file of extra.files) files.push(file)
    if (extras) onLog?.(`[LunarSpace] modlist.html: thêm ${extras} mod ngoài manifest.json`)
    if (missing.length) {
      if (extraNoMatch.length) onLog?.(`[LunarSpace] ${extraNoMatch.length} mod trong modlist.html không có bản cho ${mc} ${loader}: ${extraNoMatch.slice(0, 6).join(', ')}`)
      if (extraUnresolved.length) onLog?.(`[LunarSpace] ${extraUnresolved.length} mục trong modlist.html không xác định được: ${extraUnresolved.slice(0, 6).join(', ')}`)
    }
  }
  if (missing.length) onLog?.(`[LunarSpace] Không tải được ${missing.length} mod: ${missing.slice(0, 6).join(', ')}`)

  return {
    name: manifest.name || 'Modpack',
    summary: manifest.author ? `Bởi ${manifest.author}` : '',
    version: manifest.version || '',
    mc,
    loader,
    loaderVersion,
    files,
    missing: [...missing, ...extraUnresolved, ...extraNoMatch].filter(Boolean),
    listed,
    extras,
    optional,
    unresolvedManifest: unresolvedIds,
    zipPath,
    overrides,
    source: 'curseforge',
  }
}

async function resolvePlan({ source, packId, fileId, cacheDir, onProgress, onLog }) {
  if (!cacheDir) throw new Error('Thiếu thư mục đệm modpack.')
  await fsp.mkdir(cacheDir, { recursive: true })
  if (source === 'curseforge') {
    const data = await cfJson(`${CF}/mods/${encodeURIComponent(packId)}/files/${encodeURIComponent(fileId)}`)
    const file = data?.data
    if (!file) throw new Error('Không đọc được tệp modpack CurseForge.')
    const url = cfFileUrl(file)
    if (!url) throw new Error('Modpack này không cho tải qua API.')
    const zipPath = await downloadToCache({ url, name: file.fileName, dir: cacheDir, onProgress })
    return planFromCurseforgeZip({ zipPath, onLog })
  }
  const list = await versionsModrinth({ id: packId })
  const version = fileId ? list.find((v) => v.id === fileId) : list[0]
  if (!version?.file?.url) throw new Error('Không tìm thấy bản modpack để tải.')
  const zipPath = await downloadToCache({ url: version.file.url, name: version.file.filename, dir: cacheDir, sha1: version.file.sha1, onProgress })
  return planFromMrpack({ zipPath, onLog })
}

async function repairPlan({ planPath, onProgress, onLog }) {
  const raw = await fsp.readFile(planPath, 'utf8').catch(() => null)
  if (!raw) return { ok: false, error: 'Không có dữ liệu modpack để kiểm tra.' }
  let plan
  try {
    plan = JSON.parse(raw)
  } catch {
    return { ok: false, error: 'Dữ liệu modpack hỏng.' }
  }
  const tasks = (plan.files || []).map((f) => ({
    url: f.url,
    dest: path.join(path.dirname(planPath), f.rel),
    sha1: f.sha1,
    size: f.size,
    alts: f.alts || [],
  }))
  if (!tasks.length) return { ok: true, total: 0, downloaded: 0, repaired: 0, failed: [] }
  const before = await Promise.all(tasks.map((t) => fsp.stat(t.dest).then(() => true).catch(() => false)))
  const missing = before.filter((ok) => !ok).length
  const res = await downloadAll(tasks, { concurrency: 12, onProgress, label: 'modpack' })
  let errors = res.errors
  if (errors.length) {
    const byDest = new Map(tasks.map((t) => [t.dest, t]))
    const retry = errors.flatMap((err) => (byDest.get(err.file)?.alts || []).map((url) => ({ ...byDest.get(err.file), url, alts: [] })))
    if (retry.length) {
      const second = await downloadAll(retry, { concurrency: 6, onProgress, label: 'modpack' })
      const fixed = new Set(retry.map((t) => t.dest))
      errors = [...errors.filter((e) => !fixed.has(e.file)), ...second.errors]
    }
  }
  const failed = [...new Set(errors.map((e) => path.basename(e.file)))]
  onLog?.(`[LunarSpace] Kiểm tra modpack: thiếu ${missing} tệp, đã tải bù ${missing - failed.length}, còn lỗi ${failed.length}.`)
  return { ok: true, total: tasks.length, missing, downloaded: tasks.length - failed.length, repaired: missing - failed.length, failed }
}

async function applyPlan({ plan, instanceDir, onProgress, onLog }) {
  await fsp.mkdir(instanceDir, { recursive: true })
  const tasks = plan.files.map((f) => ({
    url: f.url,
    dest: path.join(instanceDir, f.rel),
    sha1: f.sha1,
    size: f.size,
    alts: f.alts || [],
  }))
  let errors = []
  if (tasks.length) {
    const res = await downloadAll(tasks, { concurrency: 12, onProgress, label: 'modpack' })
    errors = res.errors
  }
  if (errors.length) {
    const byDest = new Map(tasks.map((t) => [t.dest, t]))
    const retry = errors
      .flatMap((err) => (byDest.get(err.file)?.alts || []).map((url) => ({ ...byDest.get(err.file), url, alts: [] })))
    if (retry.length) {
      onLog?.(`[LunarSpace] Thử lại ${retry.length} tệp bằng máy chủ dự phòng…`)
      const second = await downloadAll(retry, { concurrency: 6, onProgress, label: 'modpack' })
      const fixed = new Set(retry.map((t) => t.dest))
      const stillBad = new Set(second.errors.map((e) => e.file))
      errors = [
        ...errors.filter((e) => !fixed.has(e.file)),
        ...second.errors,
      ]
      if (stillBad.size) onLog?.(`[LunarSpace] Còn ${stillBad.size} tệp vẫn lỗi.`)
    }
  }
  const zip = new AdmZip(plan.zipPath)
  const overrides = await extractOverrides({ entries: zip.getEntries(), prefixes: plan.overrides || [], targetDir: instanceDir })
  const failed = [...new Set(errors.map((e) => path.basename(e.file)))]
  if (failed.length) onLog?.(`[LunarSpace] Tải lỗi ${failed.length} tệp: ${failed.slice(0, 6).join(', ')}`)
  return { files: tasks.length, downloaded: tasks.length - failed.length, overrides, errors, failed }
}

module.exports = {
  CF,
  MODRINTH,
  CF_GAME,
  cfJson,
  cfFetch,
  cfFileUrls,
  cfSha1,
  cfLoaderName,
  cfStrictFile,
  cfModlistFile,
  normName,
  pickFile,
  search,
  versions,
  resolvePlan,
  applyPlan,
  repairPlan,
  planFromMrpack,
  planFromCurseforgeZip,
  loaderFromModrinth,
  loaderFromCurseforge,
  cfFileUrl,
  parseModlist,
  normName,
}
