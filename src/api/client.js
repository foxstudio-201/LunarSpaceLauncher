const bridge = typeof window !== 'undefined' ? window.electronAPI : null

export const LOADERS = [
  { id: 'vanilla', name: 'Vanilla', image: 'loader-icon/vanilla.png', desc: 'Bản gốc Mojang, không mod' },
  { id: 'fabric', name: 'Fabric', image: 'loader-icon/fabric.png', desc: 'Loader nhẹ, cập nhật nhanh' },
  { id: 'quilt', name: 'Quilt', image: 'loader-icon/quilt.png', desc: 'Kế thừa Fabric, hiện đại hơn' },
  { id: 'forge', name: 'Forge', image: 'loader-icon/forge.png', desc: 'Loader lâu đời, nhiều mod nhất' },
  { id: 'neoforge', name: 'NeoForge', image: 'loader-icon/neoforge.png', desc: 'Bản tách từ Forge, hiện đại hơn' },
]

const FORGE_META_URL = 'https://files.minecraftforge.net/net/minecraftforge/forge/maven-metadata.json'
const FORGE_PROMOS_URL = 'https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json'

function forgeDisplay(game, id) {
  let v = String(id)
  if (v.startsWith(`${game}-`)) v = v.slice(game.length + 1)
  if (v.endsWith(`-${game}`)) v = v.slice(0, -(game.length + 1))
  return v
}

const FORGE_MIN_GAME = '1.5.2'

function forgeAtLeast(version, min) {
  const a = String(version).split('.').map((n) => parseInt(n, 10) || 0)
  const b = String(min).split('.').map((n) => parseInt(n, 10) || 0)
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const x = a[i] || 0
    const y = b[i] || 0
    if (x !== y) return x > y
  }
  return true
}

function forgeSupportsGame(game) {
  return forgeAtLeast(game, FORGE_MIN_GAME)
}

export function loaderIcon(loader) {
  const found = LOADERS.find((l) => l.id === loader)
  return `./${found ? found.image : LOADERS[0].image}`
}

const NEEDS_APP = 'Thao tác này chỉ chạy được trong ứng dụng LunarSpace Launcher.'

const cache = new Map()

async function webJson(url) {
  if (cache.has(url)) return cache.get(url)
  const promise = fetch(url, { headers: { Accept: 'application/json' } }).then((res) => {
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return res.json()
  })
  cache.set(url, promise)
  promise.catch(() => cache.delete(url))
  return promise
}

const NEO_MIRROR = 'https://maven.neoforged.net/releases/net/neoforged'

async function webText(url) {
  if (cache.has(url)) return cache.get(url)
  const promise = fetch(url).then((res) => {
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return res.text()
  })
  cache.set(url, promise)
  promise.catch(() => cache.delete(url))
  return promise
}

function neoNumbers(version) {
  return String(version).split(/[-+]/)[0].split('.').map((n) => parseInt(n, 10) || 0)
}

function neoGame(version) {
  const raw = String(version).split(/[-+]/)[0].split('.')
  if (raw.length < 3 || !raw.every((n) => /^\d+$/.test(n))) return null
  const p = raw.map(Number)
  const game = p[0] >= 26
    ? [p[0], p[1], p[2] === 0 ? null : p[2]].filter(Boolean).join('.')
    : ['1', p[0], p[1] === 0 ? null : p[1]].filter(Boolean).join('.')
  return /^\d+(\.\d+)*$/.test(game) ? game : null
}

function neoBuild(version) {
  const p = String(version).split(/[-+]/)[0].split('.')
  return p[p.length - 1]
}

function neoCmp(a, b) {
  const pa = neoNumbers(a)
  const pb = neoNumbers(b)
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0)
  }
  return 0
}

async function neoCatalog() {
  const [modern, legacy] = await Promise.all([
    webText(`${NEO_MIRROR}/neoforge/maven-metadata.xml`).catch(() => ''),
    webText(`${NEO_MIRROR}/forge/maven-metadata.xml`).catch(() => ''),
  ])
  const parse = (xml) => [...String(xml).matchAll(/<version>([^<]+)<\/version>/g)].map((m) => m[1])
  return { modern: parse(modern), legacy: parse(legacy) }
}

export async function listVersions({ snapshots = false, force = false } = {}) {
  if (bridge?.listVersions) return bridge.listVersions({ snapshots, force })
  if (force) cache.delete('manifest')
  const manifest = await (async () => {
    if (!cache.has('manifest')) cache.set('manifest', webJson('https://launchermeta.mojang.com/mc/game/version_manifest_v2.json'))
    return cache.get('manifest')
  })()
  const rows = snapshots ? manifest.versions : manifest.versions.filter((v) => v.type === 'release')
  return {
    ok: true,
    source: 'mojang',
    latest: manifest.latest,
    loaders: LOADERS,
    versions: rows.map((v) => ({ id: v.id, type: v.type, releaseTime: v.releaseTime, url: v.url })),
  }
}

export async function listLoaderVersions({ kind, game } = {}) {
  if (bridge?.listLoaderVersions) return bridge.listLoaderVersions({ kind, game })
  if (kind === 'vanilla') return { ok: true, versions: [] }
  if (kind === 'forge') {
    if (!forgeSupportsGame(game)) return { ok: true, versions: [] }
    const [meta, promos] = await Promise.all([
      webJson(FORGE_META_URL),
      webJson(FORGE_PROMOS_URL).catch(() => ({})),
    ])
    const all = meta?.[game] || []
    const p = promos?.promos || {}
    const latest = p[`${game}-latest`]
    const recommended = p[`${game}-recommended`]
    const rows = all.slice().reverse().map((id) => ({
      version: forgeDisplay(game, id),
      build: null,
      stable: !!(recommended && id.endsWith(`-${recommended}`)),
      latest: !!(latest && id.endsWith(`-${latest}`)),
    }))
    if (rows.length && !rows.some((r) => r.latest)) rows[0] = { ...rows[0], latest: true }
    return { ok: true, versions: rows.slice(0, 60) }
  }
  if (kind === 'neoforge') {
    const { modern, legacy } = await neoCatalog()
    const rows = modern
      .filter((v) => !/-(alpha|snapshot)/i.test(v) && !/\+snapshot/i.test(v))
      .filter((v) => neoGame(v) === game)
      .map((v) => ({ version: neoBuild(v), build: null, beta: /-beta/.test(v) }))
    if (game === '1.20.1') {
      for (const v of legacy) {
        const cut = v.indexOf('-')
        if (cut < 0 || v.slice(0, cut) !== '1.20.1') continue
        rows.push({ version: v.slice(cut + 1), build: null, beta: false })
      }
    }
    rows.sort((a, b) => neoCmp(b.version, a.version))
    const stableRow = rows.find((r) => !r.beta)
    return {
      ok: true,
      versions: rows.slice(0, 80).map((r, i) => ({
        ...r,
        latest: i === 0,
        stable: !!stableRow && stableRow.version === r.version,
      })),
    }
  }
  const url = kind === 'fabric'
    ? `https://meta.fabricmc.net/v2/versions/loader/${game}`
    : `https://meta.quiltmc.org/v3/versions/loader/${game}`
  let rows
  try {
    rows = await webJson(url)
  } catch (err) {
    if (/HTTP (400|404|422)\b/.test(err?.message || '')) return { ok: true, versions: [] }
    throw err
  }
  const versions = (rows || [])
    .map((row) => ({
      version: row.loader?.version || row.version,
      stable: kind === 'fabric' ? !!row.loader?.stable : !String(row.loader?.version || '').includes('-'),
      build: row.loader?.build ?? null,
    }))
    .filter((r) => r.version)
    .sort((a, b) => (Number(b.stable) - Number(a.stable)) || b.version.localeCompare(a.version, undefined, { numeric: true }))
    .slice(0, 60)
  if (versions.length) versions[0] = { ...versions[0], latest: true }
  return { ok: true, versions }
}

export async function listLoaderGames({ kind } = {}) {
  if (bridge?.listLoaderGames) return bridge.listLoaderGames({ kind })
  if (!kind || kind === 'vanilla') return { ok: true, games: [], all: true }
  const url = kind === 'fabric'
    ? 'https://meta.fabricmc.net/v2/versions/game'
    : kind === 'quilt'
      ? 'https://meta.quiltmc.org/v3/versions/game'
      : FORGE_META_URL
  try {
    const rows = await webJson(url)
    const list = kind === 'neoforge'
      ? await neoCatalog().then(({ modern, legacy }) => {
          const games = new Set(modern.filter((v) => !/-(alpha|snapshot)/i.test(v) && !/\+snapshot/i.test(v)).map(neoGame).filter(Boolean))
          if (legacy.some((v) => v.startsWith('1.20.1-'))) games.add('1.20.1')
          return [...games].map((version) => ({ version, stable: true })).sort((a, b) => neoCmp(b.version, a.version))
        })
      : kind === 'forge'
      ? Object.keys(rows || {}).filter(forgeSupportsGame).map((version) => ({ version, stable: true }))
      : (rows || []).map((row) => ({ version: row.version, stable: row.stable !== false })).filter((r) => r.version)
    return { ok: true, games: list, all: list.length === 0 }
  } catch {
    return { ok: true, games: [], all: true }
  }
}

export async function listInstances() {
  if (bridge?.listInstances) return bridge.listInstances()
  return { ok: true, instances: [], loaders: LOADERS, sharedDir: '', defaultInstanceDir: '' }
}

export async function listAccounts() {
  if (bridge?.listAccounts) return bridge.listAccounts()
  return { ok: true, accounts: [], activeAccountId: null }
}

export async function addAccount({ name } = {}) {
  if (bridge?.addAccount) return bridge.addAccount({ name })
  throw new Error(NEEDS_APP)
}

export async function signInAccount({ type, username, password } = {}) {
  if (bridge?.signInAccount) return bridge.signInAccount({ type, username, password })
  throw new Error(NEEDS_APP)
}

export async function refreshAccount({ id } = {}) {
  if (bridge?.refreshAccount) return bridge.refreshAccount({ id })
  throw new Error(NEEDS_APP)
}

export async function resolveSkin({ uuid, name, provider } = {}) {
  if (bridge?.resolveSkin) return bridge.resolveSkin({ uuid, name, provider })
  return { ok: true, data: '' }
}

export async function removeAccount({ id } = {}) {
  if (bridge?.removeAccount) return bridge.removeAccount({ id })
  throw new Error(NEEDS_APP)
}

export async function setActiveAccount({ id } = {}) {
  if (bridge?.setActiveAccount) return bridge.setActiveAccount({ id })
  throw new Error(NEEDS_APP)
}

export async function discordState() {
  if (bridge?.discordState) return bridge.discordState()
  return { enabled: false, connected: false, user: null }
}

export async function discordSelect(instance) {
  if (bridge?.discordSelect) return bridge.discordSelect(instance)
  return { ok: false }
}

export async function systemInfo() {
  if (bridge?.systemInfo) return bridge.systemInfo()
  return { ok: false, reason: 'web' }
}

export async function storage() {
  if (bridge?.storage) return bridge.storage()
  return { ok: true, sharedDir: '', defaultInstanceDir: '', javaPath: '', launcherProfiles: '' }
}

export async function createInstance() {
  if (bridge?.createInstance) return bridge.createInstance(...arguments)
  throw new Error(NEEDS_APP)
}

export async function removeInstance() {
  if (bridge?.removeInstance) return bridge.removeInstance(...arguments)
  throw new Error(NEEDS_APP)
}

export async function updateInstance() {
  if (bridge?.updateInstance) return bridge.updateInstance(...arguments)
  throw new Error(NEEDS_APP)
}

export async function launchInstance() {
  if (bridge?.launchInstance) return bridge.launchInstance(...arguments)
  throw new Error(NEEDS_APP)
}

export async function stopInstance() {
  if (bridge?.stopInstance) return bridge.stopInstance(...arguments)
  throw new Error(NEEDS_APP)
}

export async function instanceLogs({ id } = {}) {
  if (bridge?.instanceLogs) return bridge.instanceLogs({ id })
  return { ok: true, lines: [] }
}

export async function listDir({ id, rel } = {}) {
  if (bridge?.listDir) return bridge.listDir({ id, rel })
  throw new Error(NEEDS_APP)
}

export async function toggleFile({ id, rel, enable, suffix } = {}) {
  if (bridge?.toggleFile) return bridge.toggleFile({ id, rel, enable, suffix })
  throw new Error(NEEDS_APP)
}

export async function deleteFile({ id, rel } = {}) {
  if (bridge?.deleteFile) return bridge.deleteFile({ id, rel })
  throw new Error(NEEDS_APP)
}

export async function deleteFiles({ id, rels } = {}) {
  if (bridge?.deleteFiles) return bridge.deleteFiles({ id, rels })
  throw new Error(NEEDS_APP)
}

export async function trashFiles({ id, rels } = {}) {
  if (bridge?.trashFiles) return bridge.trashFiles({ id, rels })
  throw new Error(NEEDS_APP)
}

export async function listTrash({ id } = {}) {
  if (bridge?.listTrash) return bridge.listTrash({ id })
  throw new Error(NEEDS_APP)
}

export async function restoreTrash({ id, entryId } = {}) {
  if (bridge?.restoreTrash) return bridge.restoreTrash({ id, entryId })
  throw new Error(NEEDS_APP)
}

export async function purgeTrash({ id, ids } = {}) {
  if (bridge?.purgeTrash) return bridge.purgeTrash({ id, ids })
  throw new Error(NEEDS_APP)
}

export async function createEntry({ id, rel, name, dir } = {}) {
  if (bridge?.createEntry) return bridge.createEntry({ id, rel, name, dir })
  throw new Error(NEEDS_APP)
}

export async function importPaths({ id, rel, paths } = {}) {
  if (bridge?.importPaths) return bridge.importPaths({ id, rel, paths })
  throw new Error(NEEDS_APP)
}

export async function moveEntry({ id, from, toRel } = {}) {
  if (bridge?.moveEntry) return bridge.moveEntry({ id, from, toRel })
  throw new Error(NEEDS_APP)
}

export function pathForFile(file) {
  if (bridge?.pathForFile) return bridge.pathForFile(file)
  return ''
}

export async function readFile({ id, rel } = {}) {
  if (bridge?.readFile) return bridge.readFile({ id, rel })
  throw new Error(NEEDS_APP)
}

export async function writeFile({ id, rel, text } = {}) {
  if (bridge?.writeFile) return bridge.writeFile({ id, rel, text })
  throw new Error(NEEDS_APP)
}

export async function listJavaRuntimes(opts) {
  if (bridge?.listJavaRuntimes) return bridge.listJavaRuntimes(opts)
  return { ok: true, platform: 'web', items: [] }
}

export async function installJavaRuntime({ component } = {}) {
  if (bridge?.installJavaRuntime) return bridge.installJavaRuntime({ component })
  throw new Error(NEEDS_APP)
}

export async function removeJavaRuntime({ component } = {}) {
  if (bridge?.removeJavaRuntime) return bridge.removeJavaRuntime({ component })
  throw new Error(NEEDS_APP)
}

const CF_PROXY = 'https://api.curse.tools/v1'
const MODRINTH_API = 'https://api.modrinth.com/v2'
const PACK_LOADER_IDS = ['neoforge', 'forge', 'fabric', 'quilt']

function packLoaders(list) {
  const set = new Set()
  for (const item of list || []) {
    const tokens = String(item || '').toLowerCase().replace(/([a-z])(\d)/g, '$1-$2').split(/[^a-z]+/)
    const hit = PACK_LOADER_IDS.find((id) => tokens.includes(id))
    if (hit) set.add(hit)
  }
  return [...set]
}

const PACK_ENV_FACETS = {
  client: [['client_side:required', 'client_side:optional']],
  server: [['server_side:required', 'server_side:optional']],
  both: [['client_side:required', 'client_side:optional'], ['server_side:required', 'server_side:optional']],
}

function packFacets({ game, loader, category, environment }) {
  const facets = [['project_type:modpack']]
  if (game) facets.push([`versions:${game}`])
  if (loader && loader !== 'vanilla') facets.push([`categories:${loader}`])
  if (category) facets.push([`categories:${category}`])
  const env = PACK_ENV_FACETS[environment]
  if (env) facets.push(...env)
  return JSON.stringify(facets)
}

function tagLabel(slug) {
  return String(slug || '').split('-').map((word) => (word ? word[0].toUpperCase() + word.slice(1) : word)).join(' ')
}

export async function modpackSearch({ source, query = '', sort = 'relevance', offset = 0, limit = 24, game, loader, category, environment } = {}) {
  if (bridge?.modpackSearch) return bridge.modpackSearch({ source, query, sort, offset, limit, game, loader, category, environment })
  try {
    if (source === 'curseforge') {
      const sortField = sort === 'downloads' ? 6 : sort === 'updated' ? 3 : 1
      const categoryId = Number(category) > 0 ? Number(category) : null
      const url =
        `${CF_PROXY}/mods/search?gameId=432&classId=4471&searchFilter=${encodeURIComponent(query)}&sortField=${sortField}&sortOrder=desc&pageSize=${limit}&index=${offset}` +
        (game ? `&gameVersion=${encodeURIComponent(game)}` : '') +
        (loader && loader !== 'vanilla' ? `&modLoaderType=${{ forge: 1, fabric: 4, quilt: 5, neoforge: 6 }[loader] || ''}` : '') +
        (categoryId ? `&categoryId=${categoryId}` : '')
      const data = await webJson(url)
      return {
        ok: true,
        total: data?.pagination?.totalCount || 0,
        hits: (data?.data || []).map((mod) => ({
          source: 'curseforge',
          id: String(mod.id),
          name: mod.name,
          author: (mod.authors || []).map((a) => a.name).join(', '),
          summary: mod.summary || '',
          icon: mod.logo?.thumbnailUrl || '',
          downloads: mod.downloadCount || 0,
          updated: mod.dateModified || null,
          loaders: [],
          gameVersions: [...new Set((mod.latestFilesIndexes || []).map((f) => f.gameVersion).filter(Boolean))],
        })),
      }
    }
    const facets = packFacets({ game, loader, category, environment })
    const index = ['relevance', 'downloads', 'follows', 'newest', 'updated'].includes(sort) ? sort : 'relevance'
    const url = `${MODRINTH_API}/search?query=${encodeURIComponent(query)}&facets=${encodeURIComponent(facets)}&index=${index}&limit=${limit}&offset=${offset}`
    const data = await webJson(url)
    return {
      ok: true,
      total: data.total_hits || 0,
      hits: (data.hits || []).map((hit) => ({
        source: 'modrinth',
        id: hit.project_id,
        name: hit.title,
        author: hit.author || '',
        summary: hit.description || '',
        icon: hit.icon_url || '',
        downloads: hit.downloads || 0,
        updated: hit.date_modified || null,
        loaders: packLoaders(hit.categories),
        gameVersions: hit.versions || [],
      })),
    }
  } catch (err) {
    return { ok: false, error: err.message, hits: [], total: 0 }
  }
}

export async function modpackTags({ source } = {}) {
  if (bridge?.modpackTags) return bridge.modpackTags({ source })
  try {
    if (source === 'curseforge') {
      const data = await webJson(`${CF_PROXY}/categories?gameId=432`)
      const options = (data?.data || [])
        .filter((cat) => cat.classId === 4471)
        .map((cat) => ({ value: String(cat.id), label: cat.name || tagLabel(cat.slug) }))
        .sort((a, b) => a.label.localeCompare(b.label))
      return { ok: true, options, environment: false }
    }
    const list = await webJson(`${MODRINTH_API}/tag/category`)
    const options = (list || [])
      .filter((tag) => tag.project_type === 'modpack')
      .map((tag) => ({ value: tag.name, label: tagLabel(tag.name) }))
      .sort((a, b) => a.label.localeCompare(b.label))
    return { ok: true, options, environment: true }
  } catch (err) {
    return { ok: false, error: err.message, options: [], environment: source !== 'curseforge' }
  }
}

export async function modpackVersions({ source, id } = {}) {
  if (bridge?.modpackVersions) return bridge.modpackVersions({ source, id })
  try {
    if (source === 'curseforge') {
      const data = await webJson(`${CF_PROXY}/mods/${encodeURIComponent(id)}/files?pageSize=50`)
      return {
        ok: true,
        versions: (data?.data || []).map((f) => ({
          id: String(f.id),
          name: f.displayName || f.fileName,
          versionNumber: f.fileName,
          gameVersions: f.gameVersions || [],
          loaders: [],
          date: f.fileDate || null,
          downloads: f.downloadCount || 0,
        })),
      }
    }
    const list = await webJson(`${MODRINTH_API}/project/${encodeURIComponent(id)}/version`)
    return {
      ok: true,
      versions: (list || []).map((v) => ({
        id: v.id,
        name: v.name,
        versionNumber: v.version_number,
        gameVersions: v.game_versions || [],
        loaders: packLoaders(v.loaders),
        date: v.date_published || null,
        downloads: v.downloads || 0,
      })),
    }
  } catch (err) {
    return { ok: false, error: err.message, versions: [] }
  }
}

export async function updateStatus() {
  if (bridge?.updateStatus) return bridge.updateStatus()
  return { ok: false, phase: 'unsupported' }
}

export async function updateCheck() {
  if (bridge?.updateCheck) return bridge.updateCheck()
  return { ok: false, error: NEEDS_APP }
}

export async function updateDownload() {
  if (bridge?.updateDownload) return bridge.updateDownload()
  return { ok: false, error: NEEDS_APP }
}

export async function updateInstall() {
  if (bridge?.updateInstall) return bridge.updateInstall()
  return { ok: false, error: NEEDS_APP }
}

export async function exportProfile(opts = {}) {
  if (bridge?.exportProfile) return bridge.exportProfile(opts)
  return { ok: false, error: NEEDS_APP }
}

export async function contentSearch(opts = {}) {
  if (bridge?.contentSearch) return bridge.contentSearch(opts)
  return { ok: false, error: NEEDS_APP, hits: [], total: 0 }
}

export async function instanceModEnvs(opts = {}) {
  if (bridge?.instanceModEnvs) return bridge.instanceModEnvs(opts)
  return { ok: false, error: NEEDS_APP, envs: {} }
}

export async function hostStatus(opts = {}) {
  if (bridge?.hostStatus) return bridge.hostStatus(opts)
  return { ok: false, error: NEEDS_APP }
}

export async function hostInstallAgent() {
  if (bridge?.hostInstallAgent) return bridge.hostInstallAgent()
  return { ok: false, error: NEEDS_APP }
}

export async function hostSetToken({ token } = {}) {
  if (bridge?.hostSetToken) return bridge.hostSetToken({ token })
  return { ok: false, error: NEEDS_APP }
}

export async function hostStart(opts = {}) {
  if (bridge?.hostStart) return bridge.hostStart(opts)
  return { ok: false, error: NEEDS_APP }
}

export async function hostStop() {
  if (bridge?.hostStop) return bridge.hostStop()
  return { ok: false, error: NEEDS_APP }
}

export async function contentVersions(opts = {}) {
  if (bridge?.contentVersions) return bridge.contentVersions(opts)
  return { ok: false, error: NEEDS_APP, versions: [] }
}

export async function contentProject(opts = {}) {
  if (bridge?.contentProject) return bridge.contentProject(opts)
  return { ok: false, error: NEEDS_APP, project: null }
}

export async function contentChangelog(opts = {}) {
  if (bridge?.contentChangelog) return bridge.contentChangelog(opts)
  return { ok: false, error: NEEDS_APP, text: '', format: 'markdown' }
}

export async function contentInstall(opts = {}) {
  if (bridge?.contentInstall) return bridge.contentInstall(opts)
  throw new Error(NEEDS_APP)
}

export async function modpackResolve(opts = {}) {
  if (bridge?.modpackResolve) return bridge.modpackResolve(opts)
  throw new Error(NEEDS_APP)
}

export async function modpackImport({ filePath } = {}) {
  if (bridge?.modpackImport) return bridge.modpackImport({ filePath })
  throw new Error(NEEDS_APP)
}

export async function modpackInstall(opts = {}) {
  if (bridge?.modpackInstall) return bridge.modpackInstall(opts)
  throw new Error(NEEDS_APP)
}

export async function modpackRepair({ id } = {}) {
  if (bridge?.modpackRepair) return bridge.modpackRepair({ id })
  throw new Error(NEEDS_APP)
}

export async function chooseModpack() {
  if (bridge?.chooseModpack) return bridge.chooseModpack()
  throw new Error(NEEDS_APP)
}

export async function getCrash({ id } = {}) {
  if (bridge?.getCrash) return bridge.getCrash({ id })
  return { ok: false, crash: null }
}

export async function uploadLog({ text, label } = {}) {
  if (bridge?.uploadLog) return bridge.uploadLog({ text, label })
  try {
    const body = new URLSearchParams({ content: String(text || ''), source: label || 'LunarSpace Launcher' })
    const res = await fetch('https://api.mclo.gs/1/log', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body })
    const json = await res.json()
    if (!json?.success) return { ok: false, error: json?.error || `HTTP ${res.status}` }
    return { ok: true, url: json.url }
  } catch (err) {
    return { ok: false, error: err.message }
  }
}

export async function saveLog() {
  if (bridge?.saveLog) return bridge.saveLog(...arguments)
  throw new Error(NEEDS_APP)
}

export async function copyText(text) {
  if (bridge?.clipboardWrite) return bridge.clipboardWrite(text)
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text)
  throw new Error(NEEDS_APP)
}

export async function openExternal(url) {
  if (bridge?.openExternal) return bridge.openExternal(url)
  window.open(url, '_blank', 'noopener')
  return { ok: true }
}

export async function chooseDirectory(opts) {
  if (bridge?.chooseDirectory) return bridge.chooseDirectory(opts)
  throw new Error(NEEDS_APP)
}

export async function chooseJava() {
  if (bridge?.chooseJava) return bridge.chooseJava()
  throw new Error(NEEDS_APP)
}

export async function revealPath(target) {
  if (bridge?.revealPath) return bridge.revealPath(target)
  throw new Error(NEEDS_APP)
}

export function onLauncherEvent(callback) {
  if (bridge?.onLauncherEvent) return bridge.onLauncherEvent(callback)
  return () => {}
}

export const isDesktop = !!bridge
