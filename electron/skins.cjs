const { app } = require('electron')
const https = require('https')
const fs = require('fs')
const fsp = fs.promises
const path = require('path')

const UA = 'LunarSpaceLauncher/1.0'
const TTL = 12 * 3600 * 1000
const MISS_TTL = 6 * 3600 * 1000
const MAX_DATA = 3 * 1024 * 1024

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

function safeId(value) {
  return String(value || '').trim().replace(/[^A-Za-z0-9_-]/g, '')
}

function dirFor(shared) {
  return path.join(shared, 'skins')
}

function fileFor(shared, uuid, kind) {
  const id = safeId(uuid)
  if (!id) return ''
  return path.join(dirFor(shared), kind === 'cape' ? `${id}-cape.png` : `${id}.png`)
}

function metaFor(shared, uuid) {
  const id = safeId(uuid)
  return id ? path.join(dirFor(shared), `${id}.json`) : ''
}

function readMetaSync(shared, uuid) {
  try {
    const raw = fs.readFileSync(metaFor(shared, uuid), 'utf8')
    const data = JSON.parse(raw)
    return data && typeof data === 'object' ? data : null
  } catch {
    return null
  }
}

function pngSize(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 24) return null
  if (buffer[0] !== 0x89 || buffer[1] !== 0x50 || buffer[2] !== 0x4e || buffer[3] !== 0x47) return null
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) }
}

function decode(value) {
  const text = String(value || '')
  const match = text.match(/^data:image\/png;base64,([A-Za-z0-9+/=\s]+)$/)
  if (!match) throw new Error('Ảnh phải là PNG')
  const buffer = Buffer.from(match[1].replace(/\s/g, ''), 'base64')
  if (!buffer.length || buffer.length > MAX_DATA) throw new Error('Ảnh quá lớn')
  const size = pngSize(buffer)
  if (!size) throw new Error('Tệp không phải PNG hợp lệ')
  return { buffer, size }
}

function bufferDataUrl(buffer) {
  return `data:image/png;base64,${buffer.toString('base64')}`
}

async function readFileIfExists(file) {
  try {
    return await fsp.readFile(file)
  } catch {
    return null
  }
}

async function read({ shared, uuid } = {}) {
  const id = safeId(uuid)
  if (!shared || !id) return { ok: false, error: 'Thiếu UUID tài khoản' }
  const meta = readMetaSync(shared, id) || {}
  const skin = await readFileIfExists(fileFor(shared, id, 'skin'))
  const cape = await readFileIfExists(fileFor(shared, id, 'cape'))
  return {
    ok: true,
    uuid: id,
    name: String(meta.name || ''),
    model: meta.model === 'slim' ? 'slim' : 'classic',
    updatedAt: meta.updatedAt || null,
    skin: skin ? bufferDataUrl(skin) : null,
    cape: cape ? bufferDataUrl(cape) : null,
  }
}

async function writeAtomic(file, buffer) {
  await fsp.mkdir(path.dirname(file), { recursive: true })
  const temp = `${file}.${process.pid}.${Date.now()}.tmp`
  await fsp.writeFile(temp, buffer)
  await fsp.rename(temp, file)
}

async function save({ shared, uuid, name, model, skin, cape } = {}) {
  const id = safeId(uuid)
  if (!shared || !id) return { ok: false, error: 'Thiếu UUID tài khoản' }
  let skinData = null
  let capeData = null
  try {
    if (skin) {
      skinData = decode(skin)
      if (skinData.size.width !== 64 || skinData.size.height !== 64) {
        throw new Error('Skin phải có kích thước 64×64')
      }
    }
    if (cape) {
      capeData = decode(cape)
      if (capeData.size.width !== 64 || capeData.size.height !== 32) {
        throw new Error('Cape phải có kích thước 64×32')
      }
    }
  } catch (err) {
    return { ok: false, error: err.message }
  }

  if (skinData) await writeAtomic(fileFor(shared, id, 'skin'), skinData.buffer)
  else await fsp.unlink(fileFor(shared, id, 'skin')).catch(() => {})
  if (capeData) await writeAtomic(fileFor(shared, id, 'cape'), capeData.buffer)
  else await fsp.unlink(fileFor(shared, id, 'cape')).catch(() => {})

  const updatedAt = new Date().toISOString()
  if (!skinData && !capeData) {
    await fsp.unlink(metaFor(shared, id)).catch(() => {})
    return { ok: true, uuid: id, skin: null, cape: null, model: 'classic', updatedAt: null }
  }

  const meta = {
    uuid: id,
    name: String(name || ''),
    model: model === 'slim' ? 'slim' : 'classic',
    hasSkin: !!skinData,
    hasCape: !!capeData,
    updatedAt,
  }
  await writeAtomic(metaFor(shared, id), Buffer.from(JSON.stringify(meta, null, 2), 'utf8'))
  return {
    ok: true,
    uuid: id,
    name: meta.name,
    model: meta.model,
    updatedAt,
    skin: skinData ? bufferDataUrl(skinData.buffer) : null,
    cape: capeData ? bufferDataUrl(capeData.buffer) : null,
  }
}

async function remove({ shared, uuid } = {}) {
  const id = safeId(uuid)
  if (!shared || !id) return { ok: false, error: 'Thiếu UUID tài khoản' }
  await fsp.unlink(fileFor(shared, id, 'skin')).catch(() => {})
  await fsp.unlink(fileFor(shared, id, 'cape')).catch(() => {})
  await fsp.unlink(metaFor(shared, id)).catch(() => {})
  return { ok: true, uuid: id }
}

function modelSync(shared, uuid) {
  const meta = readMetaSync(shared, uuid)
  return meta?.model === 'slim' ? 'slim' : 'classic'
}

function customSync(shared, uuid) {
  const id = safeId(uuid)
  if (!id) return false
  return fs.existsSync(fileFor(shared, id, 'skin')) || fs.existsSync(fileFor(shared, id, 'cape'))
}

module.exports = { resolve, dirFor, read, save, remove, modelSync, customSync, pngSize }
