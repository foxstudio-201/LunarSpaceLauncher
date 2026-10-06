const fs = require('fs')
const fsp = fs.promises
const path = require('path')
const { fetchJson } = require('./net.cjs')
const forge = require('./forge.cjs')
const neoforge = require('./neoforge.cjs')

const MANIFEST_URL = 'https://launchermeta.mojang.com/mc/game/version_manifest_v2.json'

const META = {
  fabric: {
    name: 'Fabric',
    loaders: (game) => `https://meta.fabricmc.net/v2/versions/loader/${game}`,
    profile: (game, loader) => `https://meta.fabricmc.net/v2/versions/loader/${game}/${loader}/profile/json`,
    games: 'https://meta.fabricmc.net/v2/versions/game',
    pick: (row) => row.loader?.version,
    stable: (row) => !!row.loader?.stable,
    build: (row) => row.loader?.build ?? null,
  },
  quilt: {
    name: 'Quilt',
    loaders: (game) => `https://meta.quiltmc.org/v3/versions/loader/${game}`,
    profile: (game, loader) => `https://meta.quiltmc.org/v3/versions/loader/${game}/${loader}/profile/json`,
    games: 'https://meta.quiltmc.org/v3/versions/game',
    pick: (row) => row.loader?.version || row.version,
    stable: (row) => !(row.loader?.version || row.version || '').includes('-'),
    build: (row) => row.loader?.build ?? null,
  },
}

async function readCache(file) {
  try {
    return JSON.parse(await fsp.readFile(file, 'utf8'))
  } catch {
    return null
  }
}

async function writeCache(file, data) {
  try {
    await fsp.mkdir(path.dirname(file), { recursive: true })
    await fsp.writeFile(file, JSON.stringify(data), 'utf8')
  } catch {}
}

async function getManifest({ metaDir, force = false } = {}) {
  const file = path.join(metaDir, 'version_manifest_v2.json')
  if (!force) {
    const cached = await readCache(file)
    if (cached?.versions?.length) return { manifest: cached, cached: true }
  }
  try {
    const manifest = await fetchJson(MANIFEST_URL)
    if (!manifest?.versions?.length) throw new Error('Malformed version manifest')
    await writeCache(file, manifest)
    return { manifest, cached: false }
  } catch (err) {
    const cached = await readCache(file)
    if (cached?.versions?.length) return { manifest: cached, cached: true, stale: true }
    throw new Error(`Không tải được danh sách phiên bản từ Mojang: ${err.message}`)
  }
}

async function listVersions({ metaDir, snapshots = false, force = false } = {}) {
  const { manifest, cached, stale } = await getManifest({ metaDir, force })
  const rows = snapshots ? manifest.versions : manifest.versions.filter((v) => v.type === 'release')
  return {
    latest: manifest.latest,
    cached: !!cached,
    stale: !!stale,
    versions: rows.map((v) => ({ id: v.id, type: v.type, releaseTime: v.releaseTime, url: v.url })),
  }
}

async function getVersionJson({ metaDir, version, url }) {
  const file = path.join(metaDir, 'versions', `${version}.json`)
  const cached = await readCache(file)
  if (cached) return cached
  if (!url) throw new Error(`Thiếu URL metadata cho ${version}`)
  const json = await fetchJson(url)
  await writeCache(file, json)
  return json
}

async function listLoaderVersions({ kind, game }) {
  if (kind === 'forge') return forge.listVersions({ game })
  if (kind === 'neoforge') return neoforge.listVersions({ game })
  const spec = META[kind]
  if (!spec) throw new Error(`Loader không hỗ trợ: ${kind}`)
  let rows
  try {
    rows = await fetchJson(spec.loaders(game))
  } catch (err) {
    if (/HTTP (400|404|422)\b/.test(err?.message || '')) return []
    throw err
  }
  if (!Array.isArray(rows)) return []
  const builds = rows
    .map((row) => ({ version: spec.pick(row), stable: spec.stable(row), build: spec.build(row) }))
    .filter((r) => r.version)
    .sort((a, b) => (Number(b.stable) - Number(a.stable)) || b.version.localeCompare(a.version, undefined, { numeric: true }))
    .slice(0, 60)
  if (builds.length) builds[0] = { ...builds[0], latest: true }
  return builds
}

const gamesCache = new Map()

async function listLoaderGames({ kind }) {
  if (kind === 'forge') return forge.listGames()
  if (kind === 'neoforge') return neoforge.listGames()
  const spec = META[kind]
  if (!spec?.games) return []
  if (gamesCache.has(kind)) return gamesCache.get(kind)
  try {
    const rows = await fetchJson(spec.games)
    if (!Array.isArray(rows)) return []
    const games = rows
      .map((row) => ({ version: row.version, stable: row.stable !== false }))
      .filter((row) => row.version)
    gamesCache.set(kind, games)
    return games
  } catch {
    return []
  }
}

async function getLoaderProfile({ kind, game, loader, metaDir }) {
  const spec = META[kind]
  if (!spec) throw new Error(`Loader không hỗ trợ: ${kind}`)
  const keyFile = path.join(metaDir, 'versions', `${kind}-${loader}-${game}.json`)
  const cached = await readCache(keyFile)
  if (cached?.libraries?.length) {
    await writeCache(path.join(metaDir, 'versions', `${cached.id}.json`), cached)
    return cached
  }
  const json = await fetchJson(spec.profile(game, loader))
  if (!json?.libraries?.length) throw new Error(`Không lấy được profile ${spec.name} ${loader}`)
  await writeCache(keyFile, json)
  await writeCache(path.join(metaDir, 'versions', `${json.id}.json`), json)
  return json
}

module.exports = { META, listVersions, getManifest, getVersionJson, listLoaderVersions, listLoaderGames, getLoaderProfile, MANIFEST_URL }
