const fs = require('fs')
const fsp = fs.promises
const path = require('path')
const { Readable, Transform } = require('stream')
const { pipeline } = require('stream/promises')

const API_BASE = String(process.env.LUNAR_API || process.env.LUNARLOADER_API || 'https://lunarspace.site').replace(/\/+$/, '')
const API_KEY = String(process.env.LUNAR_MODPACK_KEY || '')
const UA = 'LunarSpaceLauncher'

function headers(extra = {}) {
  const out = { Accept: 'application/json', 'User-Agent': UA, ...extra }
  if (API_KEY) out['X-Lunar-Key'] = API_KEY
  return out
}

async function json(pathname, options = {}) {
  const res = await fetch(`${API_BASE}${pathname}`, {
    ...options,
    headers: headers(options.body ? { 'Content-Type': 'application/json' } : {}),
    signal: AbortSignal.timeout(options.timeout || 30000),
  })
  const text = await res.text()
  let data = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    data = null
  }
  if (!res.ok || data?.ok === false) {
    throw new Error(data?.error || `HTTP ${res.status}`)
  }
  return data || {}
}

function mapHit(row) {
  return {
    id: String(row.id || ''),
    packId: String(row.packId || ''),
    versionId: String(row.versionId || ''),
    slug: String(row.slug || row.id || ''),
    source: 'lunar',
    name: String(row.name || 'Modpack'),
    author: String(row.author || 'LunarSpace'),
    summary: String(row.summary || ''),
    description: String(row.description || ''),
    icon: String(row.icon || ''),
    downloads: Number(row.downloads || 0),
    versionCount: Math.max(1, Number(row.versionCount || 1)),
    follows: 0,
    gameVersions: row.minecraft ? [String(row.minecraft)] : [],
    loaders: row.loader ? [String(row.loader)] : [],
    categories: [],
    updated: String(row.updated_at || row.created_at || ''),
    created: String(row.created_at || ''),
    page: String(row.page || ''),
    download: String(row.download || ''),
    version: String(row.version || ''),
    size: Number(row.size || 0),
  }
}

async function search({ query = '', sort = 'newest', offset = 0, limit = 24, game, loader } = {}) {
  const params = new URLSearchParams({
    q: query,
    sort: sort === 'downloads' ? 'downloads' : sort === 'name' ? 'name' : 'newest',
    offset: String(Math.max(0, Number(offset) || 0)),
    limit: String(Math.max(1, Math.min(60, Number(limit) || 24))),
  })
  if (game) params.set('game', String(game))
  if (loader) params.set('loader', String(loader))
  const data = await json(`/api/lunar-modpacks?${params.toString()}`)
  return {
    hits: (data.hits || []).map(mapHit),
    total: Number(data.total || 0),
  }
}

async function project(id) {
  if (!id) throw new Error('Thiếu modpack.')
  const data = await json(`/api/lunar-modpacks/${encodeURIComponent(id)}`)
  const row = data.project || {}
  const hit = mapHit(row)
  return {
    ...hit,
    descriptionRaw: String(row.description_html || row.description || ''),
    descriptionFormat: row.description_html ? 'html' : 'plain',
    gallery: Array.isArray(row.gallery) ? row.gallery : [],
    links: hit.page ? [{ type: 'website', url: hit.page }] : [],
    creators: hit.author ? [{ name: hit.author }] : [],
    dateModified: hit.updated,
    dateCreated: hit.created,
  }
}

async function versions(id) {
  if (!id) throw new Error('Thiếu modpack.')
  const data = await json(`/api/lunar-modpacks/${encodeURIComponent(id)}/versions`)
  return (data.versions || []).map((row) => ({
    id: String(row.id || id),
    packId: String(row.packId || ''),
    name: String(row.name || row.versionNumber || '1.0.0'),
    versionNumber: String(row.versionNumber || row.name || '1.0.0'),
    gameVersions: Array.isArray(row.gameVersions) ? row.gameVersions : [],
    loaders: Array.isArray(row.loaders) ? row.loaders : [],
    downloads: Number(row.downloads || 0),
    datePublished: String(row.datePublished || ''),
    files: Array.isArray(row.files) ? row.files : [],
  }))
}

function downloadUrl(id) {
  return `${API_BASE}/api/lunar-modpacks/${encodeURIComponent(id)}/download`
}

async function download({ id, dest, onProgress } = {}) {
  if (!id) throw new Error('Thiếu modpack.')
  if (!dest) throw new Error('Thiếu đường dẫn tải.')
  await fsp.mkdir(path.dirname(dest), { recursive: true })
  const url = downloadUrl(id)
  const headers = { 'User-Agent': UA, Accept: '*/*' }

  const streamFull = async (response) => {
    if (!response.ok || !response.body) {
      throw new Error(`Tải modpack thất bại (HTTP ${response.status})`)
    }
    const total = Number(response.headers.get('content-length') || 0)
    let done = 0
    const counter = new Transform({
      transform(chunk, _encoding, callback) {
        done += chunk.length
        onProgress?.({ done, total })
        callback(null, chunk)
      },
    })
    await pipeline(Readable.fromWeb(response.body), counter, fs.createWriteStream(dest))
    return { ok: true, path: dest, bytes: done || (await fsp.stat(dest)).size }
  }

  let total = 0
  try {
    const head = await fetch(url, { method: 'HEAD', headers, signal: AbortSignal.timeout(30000) })
    if (head.ok) total = Number(head.headers.get('content-length') || 0)
  } catch {}

  if (!total) {
    const response = await fetch(url, { headers, signal: AbortSignal.timeout(600000) })
    return streamFull(response)
  }

  const handle = await fsp.open(dest, 'w')
  let offset = 0
  try {
    while (offset < total) {
      const end = Math.min(offset + 8388608 - 1, total - 1)
      const response = await fetch(url, {
        headers: { ...headers, Range: `bytes=${offset}-${end}` },
        signal: AbortSignal.timeout(120000),
      })
      if (response.status === 200) {
        await handle.close()
        return streamFull(response)
      }
      if (response.status !== 206) {
        throw new Error(`Tải modpack thất bại (HTTP ${response.status})`)
      }
      const contentRange = String(response.headers.get('content-range') || '')
      const rangeMatch = contentRange.match(/\/(\d+)$/)
      if (rangeMatch) total = Number(rangeMatch[1]) || total
      const buffer = Buffer.from(await response.arrayBuffer())
      if (!buffer.length) break
      let written = 0
      while (written < buffer.length) {
        const result = await handle.write(buffer, written, buffer.length - written, offset + written)
        written += result.bytesWritten
      }
      offset += written
      onProgress?.({ done: offset, total })
    }
    return { ok: true, path: dest, bytes: offset }
  } finally {
    await handle.close().catch(() => {})
  }
}

async function upload({ zipPath, meta = {}, iconPath = '', iconBuffer = null, onProgress } = {}) {
  if (!zipPath) throw new Error('Thiếu tệp modpack.')
  const stat = await fsp.stat(zipPath)
  if (!stat.isFile() || !stat.size) throw new Error('Tệp modpack rỗng.')
  let icon = ''
  let iconRaw = Buffer.isBuffer(iconBuffer) ? iconBuffer : null
  if (!iconRaw && iconPath) {
    try {
      iconRaw = await fsp.readFile(iconPath)
    } catch {}
  }
  if (iconRaw && iconRaw.length > 0 && iconRaw.length <= 786432) {
    icon = `data:image/png;base64,${iconRaw.toString('base64')}`
  }
  const start = await json('/api/lunar-modpacks/start', {
    method: 'POST',
    body: JSON.stringify({
      name: String(meta.name || 'Modpack'),
      packKey: String(meta.packKey || ''),
      author: String(meta.author || ''),
      summary: String(meta.summary || ''),
      description: String(meta.description || ''),
      minecraft: String(meta.minecraft || ''),
      loader: String(meta.loader || 'vanilla'),
      loaderVersion: String(meta.loaderVersion || ''),
      version: String(meta.version || '1.0.0'),
      changelog: String(meta.changelog || ''),
      descriptionFormat: String(meta.descriptionFormat || 'plain'),
      size: stat.size,
      ...(icon ? { icon } : {}),
      ...(Array.isArray(meta.images) && meta.images.length ? { images: meta.images } : {}),
      ...(Array.isArray(meta.gallery) && meta.gallery.length ? { gallery: meta.gallery } : {}),
    }),
    timeout: 60000,
  })
  const uploadId = String(start.upload_id || '')
  if (!uploadId) throw new Error('Server không trả upload_id.')
  const chunkSize = Math.max(65536, Math.min(8388608, Number(start.chunk_size) || 4194304))
  const fd = await fsp.open(zipPath, 'r')
  try {
    let offset = 0
    onProgress?.({ done: 0, total: stat.size, phase: 'upload' })
    while (offset < stat.size) {
      const length = Math.min(chunkSize, stat.size - offset)
      const buffer = Buffer.allocUnsafe(length)
      await fd.read(buffer, 0, length, offset)
      const res = await fetch(`${API_BASE}/api/lunar-modpacks/chunk?id=${encodeURIComponent(uploadId)}&offset=${offset}`, {
        method: 'PUT',
        headers: headers({ 'Content-Type': 'application/octet-stream' }),
        body: buffer,
        signal: AbortSignal.timeout(120000),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok || !data?.ok) {
        throw new Error(data?.error || `Tải lên thất bại (HTTP ${res.status})`)
      }
      offset = Number(data.received || offset + length)
      onProgress?.({ done: offset, total: stat.size, phase: 'upload' })
    }
  } finally {
    await fd.close()
  }
  const finish = await json(`/api/lunar-modpacks/finish?id=${encodeURIComponent(uploadId)}`, {
    method: 'POST',
    timeout: 120000,
  })
  return { ok: true, modpack: mapHit(finish.modpack || {}), url: String(finish.modpack?.page || '') }
}

module.exports = { search, project, versions, download, downloadUrl, upload, API_BASE }
