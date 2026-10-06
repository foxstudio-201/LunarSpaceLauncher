const fs = require('fs')
const fsp = fs.promises
const path = require('path')
const { downloadAll, UA } = require('./net.cjs')

const MIRROR = 'https://maven.neoforged.net/releases/net/neoforged'
const MODERN = { group: 'neoforge', artifact: 'neoforge' }
const LEGACY = { group: 'forge', artifact: 'forge', game: '1.20.1' }

let cache = null

function versionsFromXml(text) {
  const out = []
  const re = /<version>([^<]+)<\/version>/g
  let match = re.exec(text)
  while (match) {
    out.push(match[1])
    match = re.exec(text)
  }
  return out
}

async function fetchXml(url) {
  const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(30000) })
  if (!res.ok) throw new Error(`HTTP ${res.status} cho ${url}`)
  return res.text()
}

async function getMeta({ force = false } = {}) {
  if (cache && !force) return cache
  const [modern, legacy] = await Promise.all([
    fetchXml(`${MIRROR}/${MODERN.group}/maven-metadata.xml`).then(versionsFromXml).catch(() => []),
    fetchXml(`${MIRROR}/${LEGACY.group}/maven-metadata.xml`).then(versionsFromXml).catch(() => []),
  ])
  if (!modern.length && !legacy.length) throw new Error('Không tải được danh sách bản NeoForge')
  cache = { modern, legacy }
  return cache
}

const isPrerelease = (version) => /-alpha|-snapshot|\+snapshot|pre/i.test(version)

function parts(version) {
  return version.split(/[-+]/)[0].split('.')
}

const NUMERIC = /^\d+(\.\d+)*$/

function gameOfModern(version) {
  const p = parts(version)
  if (p.length < 3 || !p.every((n) => /^\d+$/.test(n))) return null
  const game = Number(p[0]) >= 26
    ? [p[0], p[1], p[2] === '0' ? null : p[2]].filter(Boolean).join('.')
    : ['1', p[0], p[1] === '0' ? null : p[1]].filter(Boolean).join('.')
  return NUMERIC.test(game) ? game : null
}

function buildOfModern(version) {
  const p = parts(version)
  return p[p.length - 1]
}

function compareBuild(a, b) {
  const pa = String(a).split('.').map((n) => parseInt(n, 10) || 0)
  const pb = String(b).split('.').map((n) => parseInt(n, 10) || 0)
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0)
  }
  return 0
}

function rowsFor({ game, meta }) {
  const rows = []
  for (const version of meta.modern) {
    if (isPrerelease(version) && !/-beta/.test(version)) continue
    if (gameOfModern(version) !== game) continue
    rows.push({
      id: version,
      version: buildOfModern(version),
      legacy: false,
      beta: /-beta/.test(version),
    })
  }
  if (game === LEGACY.game) {
    for (const version of meta.legacy) {
      const cut = version.indexOf('-')
      if (cut < 0 || version.slice(0, cut) !== LEGACY.game) continue
      rows.push({ id: version, version: version.slice(cut + 1), legacy: true, beta: false })
    }
  }
  rows.sort((a, b) => compareBuild(b.version, a.version))
  return rows
}

async function listGames({ force = false } = {}) {
  const meta = await getMeta({ force })
  const games = new Set()
  for (const version of meta.modern) {
    if (isPrerelease(version) && !/-beta/.test(version)) continue
    const game = gameOfModern(version)
    if (game) games.add(game)
  }
  if (meta.legacy.some((v) => v.startsWith(`${LEGACY.game}-`))) games.add(LEGACY.game)
  return [...games]
    .map((version) => ({ version, stable: true }))
    .sort((a, b) => {
      const toNums = (v) => String(v).split('.').map((n) => parseInt(n, 10) || 0)
      const pa = toNums(a.version)
      const pb = toNums(b.version)
      for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
        if ((pa[i] || 0) !== (pb[i] || 0)) return (pb[i] || 0) - (pa[i] || 0)
      }
      return 0
    })
}

async function listVersions({ game, force = false }) {
  const meta = await getMeta({ force })
  const rows = rowsFor({ game, meta })
  const stableRow = rows.find((r) => !r.beta)
  return rows.slice(0, 80).map((row) => ({
    id: row.id,
    version: row.version,
    build: null,
    stable: !!(stableRow && stableRow.id === row.id),
    latest: row.id === rows[0]?.id,
  }))
}

async function resolveFullId({ game, idOrVersion }) {
  const meta = await getMeta()
  const raw = String(idOrVersion)
  const rows = rowsFor({ game, meta })
  if (rows.some((r) => r.id === raw)) return raw
  const byBuild = rows.find((r) => r.version === raw)
  if (byBuild) return byBuild.id
  return game === LEGACY.game ? `${LEGACY.game}-${raw}` : raw
}

function artifactOf({ game, full }) {
  const legacy = full.startsWith(`${LEGACY.game}-`)
  const spec = legacy ? LEGACY : MODERN
  return {
    legacy,
    url: `${MIRROR}/${spec.group}/${full}/${spec.artifact}-${full}-installer.jar`,
    name: `${spec.artifact}-${full}-installer.jar`,
  }
}

async function ensureInstaller({ game, forgeId, dir, onProgress }) {
  const full = await resolveFullId({ game, idOrVersion: forgeId })
  const target = artifactOf({ game, full })
  const dest = path.join(dir, target.name)
  let sha1 = null
  try {
    const res = await fetch(`${target.url}.sha1`, { headers: UA, signal: AbortSignal.timeout(20000) })
    if (res.ok) sha1 = (await res.text()).trim().slice(0, 40)
  } catch {}
  const res = await downloadAll([{ url: target.url, dest, sha1 }], { concurrency: 1, onProgress, label: 'forge' })
  if (res.errors.length) throw new Error(res.errors[0].error)
  return dest
}

async function findInstalled({ versionsDir, game, idOrVersion, forgeId }) {
  idOrVersion = idOrVersion || forgeId
  const meta = await getMeta().catch(() => null)
  const raw = String(idOrVersion)
  let build = raw
  if (meta) {
    const rows = rowsFor({ game, meta })
    const hit = rows.find((r) => r.id === raw || r.version === raw)
    if (hit) build = hit.version
  }
  let names = []
  try {
    names = await fsp.readdir(versionsDir)
  } catch {
    return null
  }
  const match = names.find((name) => /neoforge/i.test(name) && name.includes(build))
  if (!match) return null
  try {
    await fsp.access(path.join(versionsDir, match, `${match}.json`))
    return match
  } catch {
    return null
  }
}

module.exports = {
  MIRROR,
  getMeta,
  gameOfModern,
  listGames,
  listVersions,
  resolveFullId,
  ensureInstaller,
  findInstalled,
  LEGACY_GAME: LEGACY.game,
}
