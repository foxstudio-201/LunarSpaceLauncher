const fs = require('fs')
const fsp = fs.promises
const path = require('path')
const crypto = require('crypto')
const { ZipWriter, cfFileIdFromUrl } = require('./zip.cjs')
const { MODRINTH, CF, cfJson, normName } = require('./modpack.cjs')
const { UA } = require('./net.cjs')

const SKIP_TOP = new Set(['logs', 'crash-reports', 'screenshots', 'instance.json', 'launcher_profiles.json'])

const PLAN_FILES = ['.lunaspace-modpack.json']

const FORMATS = {
  mrpack: { ext: '.mrpack', label: 'Modrinth .mrpack' },
  curseforge: { ext: '.zip', label: 'CurseForge .zip' },
  zip: { ext: '.zip', label: 'Zip cơ bản' },
}

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

function sha1(buf) {
  return crypto.createHash('sha1').update(buf).digest('hex')
}

function loaderKey(loader) {
  const value = String(loader || '').toLowerCase()
  return ['forge', 'fabric', 'quilt', 'neoforge'].includes(value) ? value : null
}

async function walk(root, rel = '', out = [], skipExtra = null) {
  const dir = path.join(root, rel)
  let entries = []
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const entry of entries) {
    const next = rel ? `${rel}/${entry.name}` : entry.name
    if (!rel && SKIP_TOP.has(entry.name)) continue
    if (!rel && skipExtra && skipExtra.has(entry.name)) continue
    if (entry.name.startsWith('.')) continue
    if (entry.isDirectory()) {
      await walk(root, next, out, skipExtra)
    } else if (entry.isFile()) {
      out.push(next)
    }
  }
  return out
}

async function readPlan(dir) {
  for (const name of PLAN_FILES) {
    try {
      const raw = await fsp.readFile(path.join(dir, name), 'utf8')
      const data = JSON.parse(raw)
      const files = Array.isArray(data?.files) ? data.files : []
      if (files.length) return { ...data, files }
    } catch {}
  }
  return null
}

async function modrinthLookup(hashes) {
  const found = new Map()
  const list = [...new Set(hashes.filter(Boolean))]
  for (let i = 0; i < list.length; i += 200) {
    const chunk = list.slice(i, i + 200)
    try {
      const res = await postJson(`${MODRINTH}/version_files`, { hashes: chunk, algorithm: 'sha1' })
      for (const [hash, version] of Object.entries(res || {})) {
        const file = (version.files || []).find((f) => f.hashes?.sha1 === hash) || (version.files || [])[0]
        if (file?.url) found.set(hash, { url: file.url, size: file.file_size || 0, sha1: file.hashes?.sha1 || hash, sha512: file.hashes?.sha512 || '' })
      }
    } catch {}
  }
  return found
}

async function curseforgeIds(fileIds) {
  const found = new Map()
  const list = [...new Set(fileIds.filter(Boolean))]
  for (let i = 0; i < list.length; i += 50) {
    const chunk = list.slice(i, i + 50)
    try {
      const res = await cfJson(`${CF}/mods/files`, { method: 'POST', body: JSON.stringify({ fileIds: chunk }) })
      for (const file of res?.data || []) {
        if (file?.id && file?.modId) found.set(Number(file.id), Number(file.modId))
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 240))
  }
  return found
}

function fileSha1(file) {
  const list = file?.hashes || []
  const hit = list.find((h) => h.algo === 1 || h.type === 1 || String(h.algo).toLowerCase() === 'sha1' || String(h.type).toLowerCase() === 'sha1')
  return hit?.value ? String(hit.value).toLowerCase() : ''
}

const LOADER_TOKENS = /^(forge|fabric|quilt|neoforge|mc|minecraft|common|universal)$/i
const VERSION_TOKEN = /^v?\d+(\.\d+)*([a-z]\d*)?$/i

function searchQuery(rel) {
  const base = path.basename(rel).replace(/\.jar$/i, '').replace(/[[(][^\])]*[\])]/g, ' ')
  const parts = base.split(/[\s\-_.]+/).filter(Boolean)
  const kept = []
  for (const part of parts) {
    if (LOADER_TOKENS.test(part) || VERSION_TOKEN.test(part)) break
    kept.push(part)
  }
  return (kept.length ? kept : parts.slice(0, 3)).join(' ').trim()
}

function nameScore(query, name) {
  const a = normName(query)
  const b = normName(name)
  if (!a || !b) return 0
  if (a === b) return 3
  if (b.startsWith(a) || a.startsWith(b)) return 2
  if (b.includes(a) || a.includes(b)) return 1
  return 0
}

const CF_GAME_ID = 432

const CF_LOADER_TYPE = { forge: 1, fabric: 4, quilt: 5, neoforge: 6 }

async function curseforgeResolve({ rel, sha1, mc, loader, cache }) {
  const key = searchQuery(rel).toLowerCase()
  if (!key || key.length < 3) return null
  if (cache.has(key)) {
    const candidates = cache.get(key)
    for (const entry of candidates) {
      const hit = entry.files.find((f) => f.sha1 && f.sha1 === sha1)
      if (hit) return { projectId: entry.projectId, fileId: hit.id, url: hit.url }
    }
    return null
  }
  const candidates = []
  try {
    const search = await cfJson(
      `${CF}/mods/search?gameId=${CF_GAME_ID}&classId=6&searchFilter=${encodeURIComponent(key)}&pageSize=8` +
        (mc ? `&gameVersion=${encodeURIComponent(mc)}` : ''),
    )
    for (const project of search?.data || []) {
      const files = (project.latestFiles || []).map((f) => ({ id: Number(f.id), sha1: fileSha1(f), url: f.downloadUrl || '' }))
      candidates.push({ projectId: Number(project.id), name: project.name || '', files, score: nameScore(key, project.name || '') })
    }
    candidates.sort((a, b) => b.score - a.score)
  } catch {}
  for (const entry of candidates) {
    if (entry.files.some((f) => f.sha1 === sha1)) {
      cache.set(key, candidates)
      const hit = entry.files.find((f) => f.sha1 === sha1)
      return { projectId: entry.projectId, fileId: hit.id, url: hit.url }
    }
  }
  const filter = [
    mc ? `gameVersion=${encodeURIComponent(mc)}` : '',
    loader ? `modLoaderType=${CF_LOADER_TYPE[loader] || ''}` : '',
  ]
    .filter(Boolean)
    .join('&')
  for (const entry of candidates) {
    const collected = []
    for (let page = 0; page < 3; page += 1) {
      try {
        const query = [`pageSize=50`, `index=${page * 50}`, filter].filter(Boolean).join('&')
        const data = await cfJson(`${CF}/mods/${entry.projectId}/files?${query}`)
        const files = (data?.data || []).map((f) => ({ id: Number(f.id), sha1: fileSha1(f), url: f.downloadUrl || '' }))
        collected.push(...files)
        const hit = files.find((f) => f.sha1 === sha1)
        if (hit) {
          entry.files = collected
          cache.set(key, candidates)
          return { projectId: entry.projectId, fileId: hit.id, url: hit.url }
        }
        if (files.length < 50) break
      } catch {
        break
      }
    }
    if (collected.length) entry.files = collected
  }
  cache.set(key, candidates)
  return null
}

function mrpackIndex({ name, version, mc, loader, loaderVersion, files }) {
  const dependencies = { minecraft: mc || '1.20.1' }
  const key = loaderKey(loader)
  if (key && loaderVersion) dependencies[key] = loaderVersion
  return {
    formatVersion: 1,
    game: 'minecraft',
    versionId: version || '1.0.0',
    name: name || 'Modpack',
    summary: '',
    files,
    dependencies,
  }
}

function cfManifest({ name, version, mc, loader, loaderVersion, project }) {
  const id = loaderKey(loader)
  const modLoaders = id && loaderVersion ? [{ id: `${id}-${loaderVersion}`, primary: true }] : []
  return {
    minecraft: { version: mc || '1.20.1', modLoaders },
    manifestType: 'minecraftModpack',
    manifestVersion: 1,
    name: name || 'Modpack',
    version: version || '1.0.0',
    author: project?.author || 'LunarSpace Launcher',
    files: [],
    overrides: 'overrides',
  }
}

function modlistHtml(rows) {
  const items = rows.map((r) => `<li><a href="${r.url}">${r.name}</a></li>`).join('\n')
  return `<ul>\n${items}\n</ul>\n`
}

async function exportProfile({ entry, format = 'zip', targetPath, onProgress, onLog } = {}) {
  const dir = entry?.dir
  if (!dir) throw new Error('Phiên bản chưa có thư mục.')
  const kind = FORMATS[format] ? format : 'zip'
  const plan = kind === 'zip' ? null : await readPlan(dir)
  const mc = plan?.mc || entry.version || ''
  const loader = plan?.loader || entry.loader || 'vanilla'
  const loaderVersion = plan?.loaderVersion || entry.loaderVersion || ''
  const packName = plan?.name || entry.name || 'Modpack'
  const packVersion = plan?.version || '1.0.0'

  const files = await walk(dir, '', [], kind === 'zip' ? null : new Set(['saves']))
  const mods = files.filter((rel) => /^mods\/.+\.jar$/i.test(rel))
  const others = files.filter((rel) => !/^mods\//i.test(rel))

  const planByRel = new Map()
  for (const file of plan?.files || []) {
    const rel = String(file.rel || '').split(path.sep).join('/')
    if (rel) planByRel.set(rel, file)
    if (file.name) planByRel.set(`mods/${file.name}`, file)
  }

  const report = { identified: 0, overrides: 0, skipped: 0 }
  const zip = new ZipWriter(targetPath)
  const total = files.length
  let done = 0
  const tick = (rel) => {
    done += 1
    onProgress?.({ phase: 'download', label: 'export', done, total, file: rel })
  }

  try {
    if (kind === 'zip') {
      zip.addBuffer(
        'lunarspace-profile.json',
        JSON.stringify(
          {
            formatVersion: 1,
            exportedBy: 'LunarSpace Launcher',
            name: entry.name,
            minecraft: entry.version,
            loader: entry.loader,
            loaderVersion: entry.loaderVersion || null,
            exportedAt: new Date().toISOString(),
          },
          null,
          2,
        ),
      )
      for (const rel of files) {
        zip.addFile(rel, path.join(dir, rel))
        tick(rel)
      }
      report.overrides = total
    } else if (kind === 'mrpack') {
      const hashOf = new Map()
      for (const rel of mods) {
        try {
          hashOf.set(rel, sha1(await fsp.readFile(path.join(dir, rel))))
        } catch {}
      }
      const found = await modrinthLookup([...hashOf.values()])
      const indexFiles = []
      const overrideMods = []
      const cfCache = new Map()
      for (const rel of mods) {
        const size = await fsp.stat(path.join(dir, rel)).then((st) => st.size).catch(() => 0)
        const hash = hashOf.get(rel) || ''
        const mr = hash ? found.get(hash) : null
        const planUrl = planByRel.get(rel)?.url || ''
        if (mr) {
          indexFiles.push({
            path: rel,
            hashes: { sha1: hash, ...(mr.sha512 ? { sha512: mr.sha512 } : {}) },
            downloads: [mr.url],
            fileSize: mr.size || size,
          })
          report.identified += 1
        } else if (planUrl) {
          indexFiles.push({ path: rel, hashes: { sha1: hash }, downloads: [planUrl], fileSize: size })
          report.identified += 1
        } else {
          const cf = await curseforgeResolve({ rel, sha1: hash, mc, loader, cache: cfCache })
          if (cf?.url) {
            indexFiles.push({ path: rel, hashes: { sha1: hash }, downloads: [cf.url], fileSize: size })
            report.identified += 1
          } else {
            overrideMods.push(rel)
          }
        }
        tick(rel)
      }
      zip.addBuffer(
        'modrinth.index.json',
        JSON.stringify(mrpackIndex({ name: packName, version: packVersion, mc, loader, loaderVersion, files: indexFiles }), null, 2),
      )
      for (const rel of [...others, ...overrideMods]) {
        zip.addFile(`overrides/${rel}`, path.join(dir, rel))
        report.overrides += 1
      }
      onLog?.(`[LunarSpace] Xuất .mrpack: ${report.identified}/${mods.length} mod tham chiếu được, ${report.overrides} tệp trong overrides.`)
    } else {
      const cfCache = new Map()
      const fileIds = new Map()
      for (const rel of mods) {
        const id = cfFileIdFromUrl(planByRel.get(rel)?.url || '')
        if (id) fileIds.set(rel, id)
      }
      const projects = await curseforgeIds([...fileIds.values()])
      const manifest = cfManifest({ name: packName, version: packVersion, mc, loader, loaderVersion, project: plan })
      const rows = []
      const overrideMods = []
      for (const rel of mods) {
        const size = await fsp.stat(path.join(dir, rel)).then((st) => st.size).catch(() => 0)
        let projectId = 0
        let fileId = fileIds.get(rel) || 0
        let url = ''
        if (fileId) {
          projectId = projects.get(fileId) || 0
          url = `https://www.curseforge.com/projects/${projectId}`
        }
        if (!projectId || !fileId) {
          let hash = ''
          try {
            hash = sha1(await fsp.readFile(path.join(dir, rel)))
          } catch {}
          const cf = hash ? await curseforgeResolve({ rel, sha1: hash, mc, loader, cache: cfCache }) : null
          if (cf) {
            projectId = cf.projectId
            fileId = cf.fileId
            url = cf.url || url
          } else {
            projectId = 0
            fileId = 0
          }
        }
        if (projectId && fileId) {
          manifest.files.push({ projectID: projectId, fileID: fileId, required: true })
          rows.push({ name: rel.replace(/^mods\//, ''), url: url || `https://www.curseforge.com/projects/${projectId}` })
          report.identified += 1
        } else {
          overrideMods.push(rel)
        }
        void size
        tick(rel)
      }
      zip.addBuffer('manifest.json', JSON.stringify(manifest, null, 2))
      if (rows.length) zip.addBuffer('modlist.html', modlistHtml(rows))
      for (const rel of [...others, ...overrideMods]) {
        zip.addFile(`overrides/${rel}`, path.join(dir, rel))
        report.overrides += 1
      }
      onLog?.(`[LunarSpace] Xuất zip CurseForge: ${report.identified}/${mods.length} mod theo ID, ${report.overrides} tệp trong overrides.`)
    }

    const out = zip.close()
    return {
      ok: true,
      format: kind,
      path: targetPath,
      bytes: out.bytes,
      entries: out.entries,
      mods: mods.length,
      identified: report.identified,
      overrides: report.overrides,
      name: packName,
      version: packVersion,
    }
  } catch (err) {
    try {
      zip.close()
    } catch {}
    try {
      await fsp.unlink(targetPath)
    } catch {}
    throw err
  }
}

module.exports = { exportProfile, FORMATS }
