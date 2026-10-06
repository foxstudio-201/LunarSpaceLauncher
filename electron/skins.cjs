const { app } = require('electron')
const https = require('https')
const fs = require('fs')
const path = require('path')

const UA = 'LunarSpaceLauncher/1.0'
const TTL = 12 * 3600 * 1000
const MISS_TTL = 6 * 3600 * 1000

const cacheDir = () => path.join(app.getPath('userData'), 'skin-cache')
const indexFile = () => path.join(cacheDir(), 'index.json')

function readIndex() {
  try {
    const data = JSON.parse(fs.readFileSync(indexFile(), 'utf8'))
    return data && typeof data === 'object' ? data : {}
  } catch {
    return {}
  }
}

function writeIndex(data) {
  try {
    fs.mkdirSync(cacheDir(), { recursive: true })
    fs.writeFileSync(indexFile(), JSON.stringify(data), 'utf8')
  } catch {}
}

function fetchBuffer(url, depth = 0) {
  return new Promise((resolve) => {
    if (depth > 4) return resolve(null)
    const target = new URL(String(url).replace(/^http:/, 'https:'))
    https
      .get({ hostname: target.hostname, path: target.pathname + target.search, headers: { 'User-Agent': UA } }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume()
          resolve(fetchBuffer(new URL(res.headers.location, target).toString(), depth + 1))
          return
        }
        if (res.statusCode !== 200) {
          res.resume()
          return resolve(null)
        }
        const chunks = []
        res.on('data', (chunk) => chunks.push(chunk))
        res.on('end', () => resolve(Buffer.concat(chunks)))
      })
      .on('error', () => resolve(null))
  })
}

async function fetchJson(url) {
  const buffer = await fetchBuffer(url)
  if (!buffer) return null
  try {
    return JSON.parse(buffer.toString('utf8'))
  } catch {
    return null
  }
}

function skinUrlFromProfile(profile) {
  const property = (profile?.properties || []).find((item) => item?.name === 'textures')
  if (!property?.value) return ''
  try {
    const decoded = JSON.parse(Buffer.from(property.value, 'base64').toString('utf8'))
    return decoded?.textures?.SKIN?.url || ''
  } catch {
    return ''
  }
}

async function mojangTexture(uuid) {
  if (!uuid) return ''
  const clean = String(uuid).replace(/-/g, '')
  if (!/^[0-9a-fA-F]{32}$/.test(clean)) return ''
  const profile = await fetchJson(`https://sessionserver.mojang.com/session/minecraft/profile/${clean}`)
  return skinUrlFromProfile(profile)
}

async function elyTexture(uuid) {
  if (!uuid) return ''
  const clean = String(uuid).replace(/-/g, '')
  if (!/^[0-9a-fA-F]{32}$/.test(clean)) return ''
  const profile = await fetchJson(`https://authserver.ely.by/sessionserver/session/minecraft/profile/${clean}`)
  return skinUrlFromProfile(profile)
}

async function textureFor({ uuid, name, provider }) {
  if (provider === 'ely' && uuid) {
    const url = await elyTexture(uuid)
    if (url) return url
  }
  if (provider === 'microsoft' && uuid) {
    const url = await mojangTexture(uuid)
    if (url) return url
  }
  const clean = String(name || '').trim()
  if (!/^[A-Za-z0-9_]{3,16}$/.test(clean)) return ''
  const account = await fetchJson(`https://api.mojang.com/users/profiles/minecraft/${encodeURIComponent(clean)}`)
  return mojangTexture(account?.id)
}

function cacheKey({ uuid, name, provider }) {
  if (provider === 'ely' && uuid) return `e-${String(uuid).replace(/-/g, '').toLowerCase()}`
  if (provider === 'microsoft' && uuid) return `m-${String(uuid).replace(/-/g, '').toLowerCase()}`
  return `n-${String(name || '').trim().toLowerCase()}`
}

function dataUrl(file) {
  try {
    return `data:image/png;base64,${fs.readFileSync(file).toString('base64')}`
  } catch {
    return ''
  }
}

async function resolve(input = {}) {
  const key = cacheKey(input)
  if (!key || key.length < 4) return { ok: true, data: '' }
  const index = readIndex()
  const hit = index[key]
  if (hit) {
    const age = Date.now() - (hit.at || 0)
    if (hit.file && age < TTL && fs.existsSync(hit.file)) {
      return { ok: true, data: dataUrl(hit.file), cached: true }
    }
    if (!hit.file && age < MISS_TTL) return { ok: true, data: '', cached: true }
  }
  const url = await textureFor(input)
  if (!url) {
    index[key] = { file: '', at: Date.now() }
    writeIndex(index)
    return { ok: true, data: '' }
  }
  const buffer = await fetchBuffer(url)
  if (!buffer || buffer.length < 64 || buffer.readUInt32BE(0) !== 0x89504e47) return { ok: true, data: '' }
  const file = path.join(cacheDir(), `${key}.png`)
  try {
    fs.mkdirSync(cacheDir(), { recursive: true })
    fs.writeFileSync(file, buffer)
    index[key] = { file, at: Date.now() }
    writeIndex(index)
  } catch {
    return { ok: true, data: `data:image/png;base64,${buffer.toString('base64')}` }
  }
  return { ok: true, data: dataUrl(file) }
}

module.exports = { resolve }
