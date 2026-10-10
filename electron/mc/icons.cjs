const fs = require('fs')
const fsp = fs.promises
const path = require('path')
const crypto = require('crypto')
const AdmZip = require('adm-zip')

const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif' }
const MAX_BYTES = 700 * 1024

const stripSuffix = (name) => String(name || '').replace(/\.disabled$/i, '').replace(/\.rpo$/i, '').replace(/\.txt$/i, '')

const metaIcons = (zip) => {
  const out = []
  const fabric = (() => { try { return zip.readAsText('fabric.mod.json') } catch { return '' } })()
  if (fabric) {
    try {
      const data = JSON.parse(fabric)
      if (data.icon) out.push(...(typeof data.icon === 'string' ? [data.icon] : Object.values(data.icon)))
      if (data.id) out.push(`assets/${data.id}/icon.png`, `assets/${data.id}/logo.png`, `${data.id}.png`)
    } catch {}
  }
  const quilt = (() => { try { return zip.readAsText('quilt.mod.json') } catch { return '' } })()
  if (quilt) {
    try {
      const data = JSON.parse(quilt)
      const icon = data?.quilt_loader?.metadata?.icon
      if (icon) out.push(...(typeof icon === 'string' ? [icon] : Object.values(icon)))
    } catch {}
  }
  for (const name of ['META-INF/neoforge.mods.toml', 'META-INF/mods.toml']) {
    const text = (() => { try { return zip.readAsText(name) } catch { return '' } })()
    if (!text) continue
    const match = text.match(/logoFile\s*=\s*["']([^"']+)["']/i)
    if (match) out.push(match[1])
    break
  }
  return out.filter((item) => typeof item === 'string' && item)
}

const readEntry = (zip, name) => {
  const entry = (() => { try { return zip.getEntry(name) } catch { return null } })()
  if (!entry || entry.isDirectory) return null
  const data = (() => { try { return entry.getData() } catch { return null } })()
  if (!data || !data.length || data.length > MAX_BYTES) return null
  return data
}

const extract = (file) => {
  const zip = (() => { try { return new AdmZip(file) } catch { return null } })()
  if (!zip) return null
  for (const name of [...metaIcons(zip), 'pack.png', 'icon.png', 'logo.png']) {
    const data = readEntry(zip, name)
    const ext = path.extname(name).toLowerCase()
    if (data && MIME[ext]) return { mime: MIME[ext], ext, data }
  }
  for (const entry of zip.getEntries()) {
    if (entry.isDirectory || !MIME[path.extname(entry.entryName).toLowerCase()]) continue
    if (!/(^|\/)(icon|logo|pack)\.(png|jpe?g|webp)$/i.test(entry.entryName)) continue
    const data = readEntry(zip, entry.entryName)
    if (data) return { mime: MIME[path.extname(entry.entryName).toLowerCase()], ext: path.extname(entry.entryName).toLowerCase(), data }
  }
  return null
}

function iconReader(cacheDir) {
  const memory = new Map()
  return async function icon(name, dir) {
    if (!name || !dir) return ''
    const file = await resolvePath(name, dir)
    if (!file) return ''
    const stat = await fsp.stat(file).catch(() => null)
    if (!stat || !stat.isFile()) return ''
    const key = iconKey(file, stat)
    if (memory.has(key)) return memory.get(key)
    const cached = await readCached(cacheDir, key)
    if (cached) {
      memory.set(key, cached)
      return cached
    }
    const found = extract(file)
    if (!found) {
      memory.set(key, '')
      return ''
    }
    await saveIcon(cacheDir, key, found.ext, found.data)
    const uri = `data:${found.mime};base64,${found.data.toString('base64')}`
    memory.set(key, uri)
    return uri
  }
}

function iconKey(file, stat) {
  return crypto.createHash('sha1').update(`${file}|${stat.mtimeMs}|${stat.size}`).digest('hex')
}

function iconPath(name, dir) {
  return path.join(dir, stripSuffix(name))
}

async function resolvePath(name, dir) {
  const stripped = path.join(dir, stripSuffix(name))
  const raw = path.join(dir, String(name))
  const ok = await fsp.stat(stripped).then((st) => st.isFile()).catch(() => false)
  if (ok) return stripped
  const okRaw = await fsp.stat(raw).then((st) => st.isFile()).catch(() => false)
  return okRaw ? raw : ''
}

async function readCached(cacheDir, key) {
  for (const ext of Object.keys(MIME)) {
    const data = await fsp.readFile(path.join(cacheDir, `${key}${ext}`)).catch(() => null)
    if (data && data.length) return `data:${MIME[ext]};base64,${data.toString('base64')}`
  }
  return ''
}

async function saveIcon(cacheDir, key, ext, data) {
  await fsp.mkdir(cacheDir, { recursive: true }).catch(() => {})
  await fsp.writeFile(path.join(cacheDir, `${key}${ext}`), data).catch(() => {})
}

function uriFor(ext, data) {
  return `data:${MIME[ext] || 'image/png'};base64,${data.toString('base64')}`
}


function iconUrlReader(cacheDir) {
  const memory = new Map()
  return async function iconUrl(name, dir) {
    if (!name || !dir) return ''
    const file = await resolvePath(name, dir)
    if (!file) return ''
    const stat = await fsp.stat(file).catch(() => null)
    if (!stat || !stat.isFile()) return ''
    const key = iconKey(file, stat)
    if (memory.has(key)) return memory.get(key)
    for (const ext of Object.keys(MIME)) {
      const hit = await fsp.stat(path.join(cacheDir, `${key}${ext}`)).catch(() => null)
      if (hit?.isFile()) {
        const url = `lsicon://i/${key}${ext}`
        memory.set(key, url)
        return url
      }
    }
    const found = extract(file)
    if (!found) {
      memory.set(key, '')
      return ''
    }
    await saveIcon(cacheDir, key, found.ext, found.data)
    const url = `lsicon://i/${key}${found.ext}`
    memory.set(key, url)
    return url
  }
}

module.exports = { iconReader, iconUrlReader, stripSuffix, iconKey, iconPath, resolvePath, readCached, saveIcon, uriFor, MIME, MAX_BYTES }
