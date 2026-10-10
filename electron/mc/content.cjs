const path = require('path')
const fsp = require('fs').promises
const { downloadAll, fetchJson, sha1File, UA } = require('./net.cjs')
const filehash = require('./filehash.cjs')
const {
  MODRINTH,
  CF,
  CF_GAME,
  cfJson,
  cfFileUrls,
  cfSha1,
  cfLoaderName,
  cfStrictFile,
  normName,
  pickFile,
  tagIcon,
} = require('./modpack.cjs')

const CF_LOADER_ID = { forge: 1, fabric: 4, quilt: 5, neoforge: 6 }

const ENV_FACETS = {
  client: [['client_side:required', 'client_side:optional']],
  server: [['server_side:required', 'server_side:optional']],
  both: [['client_side:required', 'client_side:optional'], ['server_side:required', 'server_side:optional']],
}

const contentTagsCache = { modrinth: {}, curseforge: {} }
const previewCache = new Map()
const PREVIEW_CAP = 300

const KINDS = {
  mods: { mr: 'mod', cf: 6, folder: 'mods', loaderFilter: true },
  shaderpacks: { mr: 'shader', cf: 6552, folder: 'shaderpacks', loaderFilter: false },
  resourcepacks: { mr: 'resourcepack', cf: 12, folder: 'resourcepacks', loaderFilter: false },
  modpacks: { mr: 'modpack', cf: 4471, folder: 'modpacks', loaderFilter: false },
}

const iso = (value) => {
  const n = Number(value)
  if (Number.isFinite(n) && n > 0) return new Date(n).toISOString()
  if (typeof value === 'string' && value) return value
  return null
}

const stripCodes = (value) => String(value || '').replace(/§./g, '').trim()

const loadersOf = (list) => {
  const set = new Set()
  for (const item of list || []) {
    const tokens = String(item || '').toLowerCase().replace(/([a-z])(\d)/g, '$1-$2').split(/[^a-z]+/)
    const hit = ['neoforge', 'forge', 'fabric', 'quilt'].find((id) => tokens.includes(id))
    if (hit) set.add(hit)
  }
  return [...set]
}

const envKind = (clientSide, serverSide) => {
  const ok = (value) => value === 'required' || value === 'optional'
  const client = ok(clientSide)
  const server = ok(serverSide)
  if (client && server) return 'both'
  if (client) return 'client'
  if (server) return 'server'
  return ''
}

const MOD_JAR_RE = /\.jar(\.disabled)?$/i

async function postJson(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json', ...UA },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30000),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

async function projectHashes({ hashes: list = [] } = {}) {
  const out = new Map()
  const keys = (list || []).filter(Boolean)
  if (!keys.length) return out
  for (let i = 0; i < keys.length; i += 200) {
    try {
      const res = await postJson(`${MODRINTH}/version_files`, { hashes: keys.slice(i, i + 200), algorithm: 'sha1' })
      for (const [hash, version] of Object.entries(res || {})) {
        if (!version?.project_id) continue
        out.set(hash, {
          projectId: version.project_id,
          versionId: version.id || '',
          version: version.version_number || '',
          source: 'modrinth',
        })
      }
    } catch {}
  }
  return out
}

async function localOwners({ dir, names, cacheDir } = {}) {
  const list = (names || []).filter((name) => MOD_JAR_RE.test(name))
  const out = new Map()
  if (!dir || !list.length) return out
  const byName = await filehash.hashes({ dir, names: list, cacheDir })
  const byHash = new Map()
  for (const [name, hash] of byName) if (hash) byHash.set(hash, name)
  if (!byHash.size) return out
  const known = await filehash.projects({
    sha1List: [...byHash.keys()],
    cacheDir,
    fetcher: async (missing) => {
      const found = new Map()
      for (let i = 0; i < missing.length; i += 200) {
        try {
          const res = await postJson(`${MODRINTH}/version_files`, { hashes: missing.slice(i, i + 200), algorithm: 'sha1' })
          for (const [hash, version] of Object.entries(res || {})) {
            if (version?.project_id) {
              found.set(hash, { projectId: version.project_id, versionId: version.id, version: version.version_number || '' })
            }
          }
        } catch {}
      }
      return found
    },
  })
  for (const [hash, row] of known) {
    const name = byHash.get(hash)
    if (name) out.set(name, row)
  }
  return out
}

async function modEnvs({ dir, names, cacheDir } = {}) {
  const list = (names || []).filter((name) => MOD_JAR_RE.test(name))
  if (!dir || !list.length) return {}
  const owner = await localOwners({ dir, names: list, cacheDir })
  if (!owner.size) return {}
  const ids = [...new Set([...owner.values()].map((row) => row.projectId))]
  const sides = new Map()
  for (let i = 0; i < ids.length; i += 100) {
    try {
      const res = await fetchJson(`${MODRINTH}/projects?ids=${encodeURIComponent(JSON.stringify(ids.slice(i, i + 100)))}`)
      for (const project of res || []) sides.set(project.id, project)
    } catch {}
  }
  const out = {}
  for (const [name, row] of owner) {
    const project = sides.get(row.projectId)
    const env = project ? envKind(project.client_side, project.server_side) : ''
    if (env) out[name] = env
  }
  return out
}

async function installed({ kind, source, id, versionId, file, game, loader, root, cacheDir } = {}) {
  const entry = spec(kind)
  const dir = path.join(root, entry.folder)
  const bare = (name) => String(name || '').replace(/\.disabled$/i, '')
  let names = []
  try {
    names = (await fsp.readdir(dir)).filter((name) => MOD_JAR_RE.test(name) && bare(name) !== bare(file))
  } catch {
    return { matches: [] }
  }
  if (!names.length) return { matches: [] }
  if (source !== 'curseforge') {
    const owner = await localOwners({ dir, names, cacheDir })
    const matches = []
    for (const name of names) {
      const row = owner.get(name)
      if (row && row.projectId === id && row.versionId !== versionId) matches.push({ file: name, version: row.version })
    }
    return { matches }
  }
  try {
    const loaderId = entry.loaderFilter && loader && loader !== 'vanilla' ? CF_LOADER_ID[loader] : null
    const filter = `&pageSize=50${game ? `&gameVersion=${encodeURIComponent(game)}` : ''}${loaderId ? `&modLoaderType=${loaderId}` : ''}`
    const known = new Map()
    for (let page = 0; page < 4; page += 1) {
      const res = await cfJson(`${CF}/mods/${encodeURIComponent(id)}/files?index=${page * 50}${filter}`)
      const rows = res?.data || []
      for (const row of rows) if (row?.fileName) known.set(bare(row.fileName).toLowerCase(), stripCodes(row.displayName || '') || row.fileName)
      if (rows.length < 50) break
    }
    return { matches: names.filter((name) => known.has(bare(name).toLowerCase())).map((name) => ({ file: name, version: known.get(bare(name).toLowerCase()) })) }
  } catch {
    return { matches: [] }
  }
}

function spec(kind) {
  const entry = KINDS[kind]
  if (!entry) throw new Error(`Loại nội dung không hợp lệ: ${kind}`)
  return entry
}

function mrFacets({ kind, game, loader, category, environment }) {
  const entry = spec(kind)
  const facets = [[`project_type:${entry.mr}`]]
  if (game) facets.push([`versions:${game}`])
  if (entry.loaderFilter && loader && loader !== 'vanilla') facets.push([`categories:${loader}`])
  if (category) facets.push([`categories:${category}`])
  const env = ENV_FACETS[environment]
  if (env) facets.push(...env)
  return JSON.stringify(facets)
}

async function searchModrinth({ kind, game, loader, category, environment, query = '', sort = 'relevance', offset = 0, limit = 20 }) {
  const index = ['relevance', 'downloads', 'follows', 'newest', 'updated'].includes(sort) ? sort : 'relevance'
  const url = `${MODRINTH}/search?query=${encodeURIComponent(query)}&facets=${encodeURIComponent(mrFacets({ kind, game, loader, category, environment }))}&index=${index}&limit=${limit}&offset=${offset}`
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
      followers: hit.follows || 0,
      updated: iso(hit.date_modified),
      loaders: loadersOf(hit.categories),
      environment: envKind(hit.client_side, hit.server_side),
      categories: (hit.categories || []).filter((tag) => !TAG_NOISE.has(String(tag).toLowerCase())).map(prettifyTag),
      gameVersions: hit.versions || [],
    })),
  }
}

async function searchCurseforge({ kind, game, loader, category, query = '', sort = 'relevance', offset = 0, limit = 20 }) {
  const entry = spec(kind)
  const sortField = sort === 'downloads' ? 6 : sort === 'updated' ? 3 : 1
  const loaderId = entry.loaderFilter && loader ? CF_LOADER_ID[loader] : null
  const categoryId = Number(category) > 0 ? Number(category) : null
  const url =
    `${CF}/mods/search?gameId=${CF_GAME}&classId=${entry.cf}` +
    `&searchFilter=${encodeURIComponent(query)}&sortField=${sortField}&sortOrder=desc&pageSize=${limit}&index=${offset}` +
    (game ? `&gameVersion=${encodeURIComponent(game)}` : '') +
    (loaderId ? `&modLoaderType=${loaderId}` : '') +
    (categoryId ? `&categoryId=${categoryId}` : '')
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
      followers: 0,
      updated: iso(mod.dateModified),
      loaders: loadersOf((mod.latestFilesIndexes || []).map((f) => cfLoaderName(f.modLoader))),
      categories: (mod.categories || []).map((cat) => cat.name || prettifyTag(cat.slug)),
      gameVersions: [...new Set((mod.latestFilesIndexes || []).map((f) => f.gameVersion).filter(Boolean))],
    })),
  }
}

async function search({ kind, source, ...rest } = {}) {
  return source === 'curseforge' ? searchCurseforge({ kind, ...rest }) : searchModrinth({ kind, ...rest })
}

async function contentTags({ kind, source } = {}) {
  const entry = spec(kind)
  if (source === 'curseforge') {
    if (!contentTagsCache.curseforge[kind]) {
      const data = await cfJson(`${CF}/categories?gameId=${CF_GAME}`)
      contentTagsCache.curseforge[kind] = (data?.data || [])
        .filter((cat) => cat.classId === entry.cf)
        .map((cat) => {
          const label = cat.name || prettifyTag(cat.slug)
          return { value: String(cat.id), label, icon: tagIcon('', label, cat.slug || cat.name) }
        })
        .sort((a, b) => a.label.localeCompare(b.label))
    }
    return { options: contentTagsCache.curseforge[kind], environment: false }
  }
  if (!contentTagsCache.modrinth[kind]) {
    const list = await fetchJson(`${MODRINTH}/tag/category`)
    contentTagsCache.modrinth[kind] = (list || [])
      .filter((tag) => tag.project_type === entry.mr)
      .map((tag) => {
        const label = prettifyTag(tag.name)
        return { value: tag.name, label, icon: tagIcon(tag.icon, label, tag.name) }
      })
      .sort((a, b) => a.label.localeCompare(b.label))
  }
  return { options: contentTagsCache.modrinth[kind], environment: kind === 'mods' }
}

function mrVersion(v) {
  return {
    id: v.id,
    name: v.name,
    versionNumber: v.version_number,
    releaseType: v.version_type || '',
    gameVersions: v.game_versions || [],
    loaders: loadersOf(v.loaders),
    date: iso(v.date_published),
    downloads: v.downloads || 0,
    file: pickFile(v.files),
    dependencies: v.dependencies || [],
  }
}

async function versionsModrinth({ id, game, loader, kind }) {
  const entry = spec(kind)
  const params = []
  if (game) params.push(`game_versions=${encodeURIComponent(JSON.stringify([game]))}`)
  if (entry.loaderFilter && loader && loader !== 'vanilla') params.push(`loaders=${encodeURIComponent(JSON.stringify([loader]))}`)
  const list = await fetchJson(`${MODRINTH}/project/${encodeURIComponent(id)}/version${params.length ? `?${params.join('&')}` : ''}`)
  return (list || []).map(mrVersion)
}

async function versionsCurseforge({ id, game, loader, kind }) {
  const entry = spec(kind)
  const loaderId = entry.loaderFilter && loader ? CF_LOADER_ID[loader] : null
  const query =
    (game ? `&gameVersion=${encodeURIComponent(game)}` : '') + (loaderId ? `&modLoaderType=${loaderId}` : '')
  let data = await cfJson(`${CF}/mods/${encodeURIComponent(id)}/files?pageSize=50${query}`)
  let list = data?.data || []
  if (!list.length) {
    data = await cfJson(`${CF}/mods/${encodeURIComponent(id)}/files?pageSize=50`)
    list = data?.data || []
  }
  return list.map((f) => ({
    id: String(f.id),
    name: stripCodes(f.displayName || f.fileName),
    versionNumber: stripCodes(f.displayName || f.fileName),
    releaseType: ['release', 'beta', 'alpha'][Number(f.releaseType) - 1] || '',
    gameVersions: f.gameVersions || [],
    loaders: loadersOf([cfLoaderName(f.modLoader)]),
    date: iso(f.fileDate),
    downloads: f.downloadCount || 0,
    file: cfFileUrls(f).length ? { url: cfFileUrls(f)[0], alts: cfFileUrls(f).slice(1), filename: f.fileName, size: f.fileLength || 0, sha1: cfSha1(f) } : null,
    dependencies: f.dependencies || [],
  }))
}

async function versions({ kind, source, id, game, loader } = {}) {
  if (!id) throw new Error('Thiếu dự án.')
  const list = source === 'curseforge'
    ? await versionsCurseforge({ id, game, loader, kind })
    : await versionsModrinth({ id, game, loader, kind })
  return list.filter((v) => v.file?.url)
}

function cfFileToTask({ kind, file }) {
  const url = cfFileUrls(file)[0]
  if (!url) return null
  return {
    rel: `${spec(kind).folder}/${file.fileName}`,
    url,
    alts: cfFileUrls(file).slice(1),
    sha1: cfSha1(file),
    size: file.fileLength || 0,
    name: file.fileName,
  }
}

function mrFileToTask({ kind, version }) {
  const file = version.file
  if (!file?.url) return null
  return {
    rel: `${spec(kind).folder}/${file.filename}`,
    url: file.url,
    alts: [],
    sha1: file.sha1,
    size: file.size || 0,
    name: file.filename,
  }
}

async function mrDependencies({ version, kind, game, loader }) {
  const out = []
  const seen = new Set()
  for (const dep of version.dependencies || []) {
    if (dep.dependency_type !== 'required') continue
    try {
      if (dep.version_id) {
        const detail = await fetchJson(`${MODRINTH}/version/${encodeURIComponent(dep.version_id)}`)
        const v = mrVersion(detail)
        const task = mrFileToTask({ kind, version: v })
        if (task && !seen.has(task.name.toLowerCase())) {
          seen.add(task.name.toLowerCase())
          out.push({ ...task, requirement: 'modrinth' })
        }
        continue
      }
      if (!dep.project_id) continue
      const list = await versionsModrinth({ id: dep.project_id, game, loader, kind })
      if (!list.length) continue
      const task = mrFileToTask({ kind, version: list[0] })
      if (task && !seen.has(task.name.toLowerCase())) {
        seen.add(task.name.toLowerCase())
        out.push({ ...task, requirement: 'modrinth' })
      }
    } catch {}
  }
  return out
}

async function cfDependencies({ file, kind, game, loader }) {
  const out = []
  const seen = new Set()
  for (const dep of file.dependencies || []) {
    if (dep.relationType !== 3) continue
    try {
      const resolved = await cfStrictFile(dep.modId, { mc: game, loader })
      if (!resolved) continue
      const task = cfFileToTask({ kind, file: resolved })
      if (task && !seen.has(task.name.toLowerCase())) {
        seen.add(task.name.toLowerCase())
        out.push({ ...task, requirement: 'curseforge' })
      }
    } catch {}
  }
  return out
}


function htmlToText(html) {
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6]|tr)>/gi, '\n')
    .replace(/<li[^>]*>/gi, '• ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .split('\n')
    .map((line) => line.trim())
    .filter((line, i, arr) => line || (i > 0 && arr[i - 1]))
    .join('\n')
    .trim()
}

function markdownToText(md) {
  return String(md || '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}#{1,6}\s*/gm, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/(^|\s)[*_]([^*_]+)[*_]/g, '$1$2')
    .replace(/^\s{0,3}>\s?/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '• ')
    .replace(/`{1,3}/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function cleanDescription(text) {
  return String(text || '')
    .replace(/^(about|description|overview|tổng quan|mô tả)\s*:?\s*\n+/i, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

const TAG_NOISE = new Set(['fabric', 'quilt', 'forge', 'neoforge', 'client', 'server', 'datapack'])

function prettifyTag(slug) {
  return String(slug || '')
    .split('-')
    .map((word) => (word ? word[0].toUpperCase() + word.slice(1) : word))
    .join(' ')
}

const CF_CLASS_URL = {
  mods: 'mc-mods',
  shaderpacks: 'shaders',
  resourcepacks: 'texture-packs',
  modpacks: 'modpacks',
}

function mrCreators(teamId) {
  if (!teamId) return Promise.resolve([])
  return fetchJson(`${MODRINTH}/team/${encodeURIComponent(teamId)}/members`)
    .then((list) =>
      (list || [])
        .map((m) => ({
          name: m.user?.name || m.user?.username || '',
          role: m.role || '',
          avatar: m.user?.avatar_url || '',
        }))
        .filter((m) => m.name),
    )
    .catch(() => [])
}

function uniqueByUrl(list) {
  const seen = new Set()
  const out = []
  for (const item of list || []) {
    const url = String(item?.url || '').trim()
    if (!url || seen.has(url)) continue
    seen.add(url)
    out.push(item)
  }
  return out
}

async function projectModrinth({ id }) {
  const d = await fetchJson(`${MODRINTH}/project/${encodeURIComponent(id)}`)
  const creators = await mrCreators(d.team)
  return {
    source: 'modrinth',
    id: String(d.id || id),
    slug: d.slug || '',
    name: d.title || '',
    summary: d.description || '',
    description: cleanDescription(markdownToText(htmlToText(d.body || ''))),
    descriptionRaw: d.body || '',
    descriptionFormat: 'markdown',
    icon: d.icon_url || '',
    downloads: d.downloads || 0,
    followers: d.followers || 0,
    updated: iso(d.updated),
    created: iso(d.published),
    license: d.license?.name || d.license?.id || '',
    loaders: d.loaders || [],
    gameVersions: d.game_versions || [],
    categories: [...(d.categories || []), ...(d.additional_categories || [])]
      .filter((tag) => !TAG_NOISE.has(String(tag).toLowerCase()))
      .map(prettifyTag),
    environment: { client: d.client_side || '', server: d.server_side || '' },
    creators,
    status: d.status || '',
    gallery: uniqueByUrl((d.gallery || []).map((g) => ({ url: g.url, title: g.title || '' }))).slice(0, 12),
    links: uniqueByUrl([
      { label: 'Modrinth', url: `https://modrinth.com/project/${d.slug || d.id}` },
      ...(d.source_url ? [{ label: 'Mã nguồn', url: d.source_url }] : []),
      ...(d.issues_url ? [{ label: 'Báo lỗi', url: d.issues_url }] : []),
      ...(d.wiki_url ? [{ label: 'Wiki', url: d.wiki_url }] : []),
      ...(d.discord_url ? [{ label: 'Discord', url: d.discord_url }] : []),
      ...(d.donation_urls || []).slice(0, 1).map((don) => ({ label: 'Ủng hộ', url: don.url })),
    ]),
  }
}

async function projectCurseforge({ id, kind }) {
  const data = await cfJson(`${CF}/mods/${encodeURIComponent(id)}`)
  const m = data?.data
  if (!m) throw new Error('Không đọc được thông tin dự án.')
  const index = m.latestFilesIndexes || []
  let description = m.description || ''
  try {
    const full = await cfJson(`${CF}/mods/${encodeURIComponent(id)}/description`)
    if (full?.data) description = full.data
  } catch {}
  const extra = m.links || {}
  return {
    source: 'curseforge',
    id: String(m.id || id),
    slug: m.slug || '',
    name: m.name || '',
    summary: m.summary || '',
    description: cleanDescription(htmlToText(description)),
    descriptionRaw: description,
    descriptionFormat: 'html',
    icon: m.logo?.thumbnailUrl || '',
    downloads: m.downloadCount || 0,
    followers: 0,
    updated: iso(m.dateModified),
    created: iso(m.dateCreated),
    license: '',
    loaders: loadersOf(index.map((f) => cfLoaderName(f.modLoader))),
    gameVersions: [...new Set(index.map((f) => f.gameVersion).filter(Boolean))],
    categories: (m.categories || []).map((cat) => cat.name || prettifyTag(cat.slug)),
    environment: { client: '', server: '' },
    creators: (m.authors || []).map((a) => ({ name: a.name, role: '', avatar: '' })).filter((a) => a.name),
    status: '',
    gallery: uniqueByUrl((m.screenshots || []).map((s) => ({ url: s.url || s.thumbnailUrl, title: s.title || '' }))).slice(0, 12),
    links: uniqueByUrl([
      { label: 'CurseForge', url: `https://www.curseforge.com/minecraft/${CF_CLASS_URL[kind] || 'mc-mods'}/${m.slug || m.id}` },
      ...(extra.websiteUrl ? [{ label: 'Website', url: extra.websiteUrl }] : []),
      ...(extra.sourceUrl ? [{ label: 'Mã nguồn', url: extra.sourceUrl }] : []),
      ...(extra.issuesUrl ? [{ label: 'Báo lỗi', url: extra.issuesUrl }] : []),
      ...(extra.wikiUrl ? [{ label: 'Wiki', url: extra.wikiUrl }] : []),
    ]),
  }
}

async function project({ kind, source, id } = {}) {
  spec(kind)
  if (!id) throw new Error('Thiếu dự án.')
  return source === 'curseforge' ? projectCurseforge({ id, kind }) : projectModrinth({ id })
}

async function changelog({ source, id, versionId } = {}) {
  if (!versionId) throw new Error('Thiếu bản phát hành.')
  if (source === 'curseforge') {
    try {
      const data = await cfJson(
        `${CF}/mods/${encodeURIComponent(id)}/files/${encodeURIComponent(versionId)}/changelog`,
      )
      return { text: String(data?.data || ''), format: 'html' }
    } catch {
      return { text: '', format: 'html' }
    }
  }
  const v = await fetchJson(`${MODRINTH}/version/${encodeURIComponent(versionId)}`)
  return { text: String(v?.changelog || ''), format: 'markdown' }
}

async function plan({ kind, source, id, versionId, game, loader, root } = {}) {
  const entry = spec(kind)
  if (!id) throw new Error('Thiếu dự án.')
  let main = null
  if (source === 'curseforge') {
    const data = await cfJson(`${CF}/mods/${encodeURIComponent(id)}/files/${encodeURIComponent(versionId)}`)
    const file = data?.data
    if (!file) throw new Error('Không đọc được tệp đã chọn.')
    main = { file, task: cfFileToTask({ kind, file }) }
    if (!main.task) throw new Error('Tệp này không cho tải trực tiếp.')
    const deps = await cfDependencies({ file, kind, game, loader })
    return finalize({ kind, main: main.task, deps, root })
  }
  const detail = await fetchJson(`${MODRINTH}/version/${encodeURIComponent(versionId)}`)
  const version = mrVersion(detail)
  const task = mrFileToTask({ kind, version })
  if (!task) throw new Error('Không đọc được tệp đã chọn.')
  const deps = await mrDependencies({ version, kind, game, loader })
  return finalize({ kind, main: task, deps, root })
}

async function finalize({ kind, main, deps, root }) {
  const tasks = [main]
  const seen = new Set([main.name.toLowerCase()])
  for (const dep of deps) {
    if (seen.has(dep.name.toLowerCase())) continue
    seen.add(dep.name.toLowerCase())
    tasks.push(dep)
  }
  let missing = 0
  if (root) {
    for (const task of tasks) {
      try {
        await fsp.access(path.join(root, task.rel))
      } catch {
        missing += 1
      }
    }
  }
  return { folder: spec(kind).folder, tasks, deps: tasks.length - 1, missing: root ? missing : tasks.length }
}

async function install({ plan: prepared, root, onProgress, onLog }) {
  if (!prepared?.tasks?.length) return { added: 0, failed: [], existed: 0 }
  const targets = prepared.tasks.map((task) => ({
    url: task.url,
    dest: path.join(root, task.rel),
    sha1: task.sha1,
    size: task.size,
    alts: task.alts || [],
  }))
  const before = await Promise.all(targets.map((t) => fsp.stat(t.dest).then(() => true).catch(() => false)))
  const existing = before.filter(Boolean).length
  const res = await downloadAll(targets, { concurrency: 6, onProgress, label: 'content' })
  let errors = res.errors
  if (errors.length) {
    const byDest = new Map(targets.map((t) => [t.dest, t]))
    const retry = errors.flatMap((err) => (byDest.get(err.file)?.alts || []).map((url) => ({ ...byDest.get(err.file), url, alts: [] })))
    if (retry.length) {
      const second = await downloadAll(retry, { concurrency: 4, onProgress, label: 'content' })
      const fixed = new Set(retry.map((t) => t.dest))
      errors = [...errors.filter((e) => !fixed.has(e.file)), ...second.errors]
    }
  }
  const failed = [...new Set(errors.map((e) => path.basename(e.file)))]
  const added = targets.length - failed.length - existing
  onLog?.(`[LunarSpace] Nội dung: thêm ${Math.max(0, added)} tệp${existing ? ` (${existing} đã có)` : ''}${failed.length ? ` · lỗi ${failed.length}` : ''}`)
  return { added: Math.max(0, added), existed: existing, failed, total: targets.length }
}

async function mrPreview(id) {
  const project = await fetchJson(`${MODRINTH}/project/${encodeURIComponent(id)}`)
  return {
    source: 'modrinth',
    id: project.id,
    slug: project.slug || '',
    name: project.title || '',
    icon: project.icon_url || '',
    summary: stripCodes(project.description || ''),
    downloads: project.downloads || 0,
    followers: project.followers || 0,
    published: iso(project.published),
    updated: iso(project.updated),
    license: project.license?.name || project.license?.id || '',
    categories: (project.categories || []).filter((tag) => !TAG_NOISE.has(String(tag).toLowerCase())).map(prettifyTag),
    loaders: project.loaders || [],
    gameVersions: project.game_versions || [],
    gallery: (project.gallery || [])
      .map((item) => ({ url: item.url, title: stripCodes(item.title || ''), featured: !!item.featured }))
      .slice(0, 8),
    links: {
      source: project.source_url || '',
      issues: project.issues_url || '',
      wiki: project.wiki_url || '',
      discord: project.discord_url || '',
    },
  }
}

async function cfPreview(id) {
  const data = await cfJson(`${CF}/mods/${encodeURIComponent(id)}`)
  const mod = data?.data
  if (!mod) throw new Error('Không tìm thấy dự án này trên CurseForge.')
  const indexes = mod.latestFilesIndexes || []
  return {
    source: 'curseforge',
    id: String(mod.id),
    slug: String(mod.slug || ''),
    name: mod.name || '',
    icon: mod.logo?.thumbnailUrl || '',
    summary: stripCodes(mod.summary || ''),
    downloads: mod.downloadCount || 0,
    followers: 0,
    published: iso(mod.dateCreated),
    updated: iso(mod.dateModified),
    license: '',
    categories: (mod.categories || []).map((cat) => cat.name || prettifyTag(cat.slug)),
    loaders: loadersOf(indexes.map((file) => cfLoaderName(file.modLoader))),
    gameVersions: [...new Set(indexes.map((file) => file.gameVersion).filter(Boolean))],
    gallery: (mod.screenshots || [])
      .map((shot) => ({ url: shot.thumbnailUrl || shot.url, title: stripCodes(shot.title || '') }))
      .slice(0, 8),
    links: {
      source: mod.links?.websiteUrl || '',
      issues: mod.links?.issuesUrl || '',
      wiki: mod.links?.wikiUrl || '',
      discord: '',
    },
  }
}

async function projectPreview({ source = 'modrinth', id } = {}) {
  if (!id) return { ok: false, error: 'Thiếu mã dự án.' }
  const key = `${source}:${String(id)}`
  if (previewCache.has(key)) return { ok: true, preview: previewCache.get(key) }
  try {
    const preview = source === 'curseforge' ? await cfPreview(id) : await mrPreview(id)
    if (previewCache.size >= PREVIEW_CAP) previewCache.delete(previewCache.keys().next().value)
    previewCache.set(key, preview)
    return { ok: true, preview }
  } catch (err) {
    return { ok: false, error: err.message }
  }
}

module.exports = {
  KINDS, spec, search, contentTags, versions, project, changelog, plan, install, installed, modEnvs,
  normName, cfLoaderName, projectPreview, projectHashes,
}
