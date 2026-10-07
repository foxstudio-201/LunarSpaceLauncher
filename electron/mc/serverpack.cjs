const fs = require('fs')
const fsp = fs.promises
const path = require('path')
const os = require('os')
const { ZipWriter } = require('./zip.cjs')
const { downloadAll, fetchJson, UA } = require('./net.cjs')
const { getManifest, getVersionJson } = require('./meta.cjs')
const forgeModule = require('./forge.cjs')
const neoforgeModule = require('./neoforge.cjs')

const HIDDEN_ROOT = new Set(['instance.json', '.lunartrash', 'lunarspace-profile.json'])

const NO_EXT = /\.(log|tmp|part|lock)$/i

const TAG_RULES = {
  mods: { tone: 'mod', vi: 'Mod', en: 'Mod', def: true },
  config: { tone: 'config', vi: 'Cấu hình', en: 'Config', def: true },
  defaultconfigs: { tone: 'config', vi: 'Config mặc định', en: 'Default configs', def: true },
  scripts: { tone: 'script', vi: 'Script', en: 'Scripts', def: true },
  kubejs: { tone: 'script', vi: 'KubeJS', en: 'KubeJS', def: true },
  datapacks: { tone: 'data', vi: 'Datapack', en: 'Datapacks', def: true },
  global_packs: { tone: 'data', vi: 'Datapack', en: 'Datapacks', def: true },
  Resourcepacks: { tone: 'pack', vi: 'Gói tài nguyên', en: 'Resource packs', def: false },
  resourcepacks: { tone: 'pack', vi: 'Gói tài nguyên', en: 'Resource packs', def: false },
  shaderpacks: { tone: 'pack', vi: 'Shader', en: 'Shader packs', def: false },
  saves: { tone: 'world', vi: 'Thế giới', en: 'Worlds', def: false },
  world: { tone: 'world', vi: 'Thế giới', en: 'World', def: true },
  world_nether: { tone: 'world', vi: 'Nether', en: 'Nether', def: true },
  world_the_end: { tone: 'world', vi: 'The End', en: 'The End', def: true },
  plugins: { tone: 'script', vi: 'Plugin', en: 'Plugins', def: true },
  logs: { tone: 'noise', vi: 'Log', en: 'Logs', def: false },
  'crash-reports': { tone: 'noise', vi: 'Crash', en: 'Crash reports', def: false },
  screenshots: { tone: 'noise', vi: 'Ảnh chụp', en: 'Screenshots', def: false },
  'local-captures': { tone: 'noise', vi: 'Ảnh chụp', en: 'Captures', def: false },
  libraries: { tone: 'lib', vi: 'Thư viện', en: 'Libraries', def: false },
  versions: { tone: 'lib', vi: 'Phiên bản', en: 'Versions', def: false },
  '.fabric': { tone: 'lib', vi: 'Fabric', en: 'Fabric', def: false },
  '.quilt': { tone: 'lib', vi: 'Quilt', en: 'Quilt', def: false },
  '.mixin.out': { tone: 'noise', vi: 'Tạm', en: 'Temp', def: false },
  '.cache': { tone: 'noise', vi: 'Tạm', en: 'Temp', def: false },
}

const DEFAULT_TAG = { tone: 'other', vi: 'Khác', en: 'Other', def: true }

const CLIENT_TAG = { tone: 'client', vi: 'Máy khách', en: 'Client', def: false }

const TAG_PREFIX = [
  [/^xaero/i, CLIENT_TAG],
  [/^replay_/i, CLIENT_TAG],
  [/^essential/i, CLIENT_TAG],
]

const JUNK_FILE = /(^hs_err_pid|^replay_pid|-stall-|^streams|\.dmp$)/i

const ROOT_FILES = {
  'server.properties': { tone: 'server', vi: 'Máy chủ', en: 'Server', def: false },
  'eula.txt': { tone: 'server', vi: 'Máy chủ', en: 'Server', def: false },
  'ops.json': { tone: 'server', vi: 'Máy chủ', en: 'Server', def: true },
  'whitelist.json': { tone: 'server', vi: 'Máy chủ', en: 'Server', def: true },
  'banned-players.json': { tone: 'server', vi: 'Máy chủ', en: 'Server', def: true },
  'banned-ips.json': { tone: 'server', vi: 'Máy chủ', en: 'Server', def: true },
  'options.txt': { tone: 'client', vi: 'Máy khách', en: 'Client', def: false },
  'optionsof.txt': { tone: 'client', vi: 'Máy khách', en: 'Client', def: false },
  'servers.dat': { tone: 'client', vi: 'Máy khách', en: 'Client', def: false },
  'usercache.json': { tone: 'client', vi: 'Máy khách', en: 'Client', def: false },
  'launcher_profiles.json': { tone: 'client', vi: 'Máy khách', en: 'Client', def: false },
  'realms_persistence.json': { tone: 'client', vi: 'Máy khách', en: 'Client', def: false },
  'modlist.html': { tone: 'client', vi: 'Máy khách', en: 'Client', def: false },
  'icon.png': { tone: 'client', vi: 'Máy khách', en: 'Client', def: false },
  '.lunaspace-modpack.json': { tone: 'client', vi: 'Máy khách', en: 'Client', def: false },
}

const FORGE_MAVEN = 'https://maven.minecraftforge.net/net/minecraftforge/forge'
const NEO_MAVEN = 'https://maven.neoforged.net/releases/net/neoforged'
const FABRIC_META = 'https://meta.fabricmc.net/v2'
const QUILT_META = 'https://meta.quiltmc.org/v3'

const LOADER_KEYS = ['forge', 'fabric', 'quilt', 'neoforge']
const LEGACY_GAME = '1.20.1'

const DEFAULT_PROPS = [
  ['server-ip', ''],
  ['server-port', '25565'],
  ['motd', 'A LunarSpace Server'],
  ['online-mode', 'true'],
  ['max-players', '20'],
  ['view-distance', '10'],
  ['simulation-distance', '10'],
  ['difficulty', 'easy'],
  ['gamemode', 'survival'],
  ['force-gamemode', 'false'],
  ['pvp', 'true'],
  ['hardcore', 'false'],
  ['allow-flight', 'false'],
  ['allow-nether', 'true'],
  ['spawn-monsters', 'true'],
  ['spawn-animals', 'true'],
  ['spawn-npcs', 'true'],
  ['generate-structures', 'true'],
  ['spawn-protection', '16'],
  ['white-list', 'false'],
  ['enforce-whitelist', 'false'],
  ['enable-command-block', 'false'],
  ['player-idle-timeout', '0'],
  ['level-name', 'world'],
  ['level-seed', ''],
  ['level-type', 'minecraft:normal'],
  ['max-world-size', '29999984'],
  ['network-compression-threshold', '256'],
  ['sync-chunk-writes', 'true'],
  ['enable-status', 'true'],
  ['hide-online-players', 'false'],
  ['op-permission-level', '4'],
  ['function-permission-level', '2'],
  ['rate-limit', '0'],
]

const PROP_KEYS = new Set(DEFAULT_PROPS.map(([key]) => key))

function topOf(rel) {
  return String(rel || '').split('/')[0]
}

function isDisabledName(name) {
  return /\.disabled$/i.test(name) || /\.zip\.txt$/i.test(name)
}

function entryTag(rel) {
  const top = topOf(rel)
  if (TAG_RULES[top]) return TAG_RULES[top]
  const byPrefix = TAG_PREFIX.find(([re]) => re.test(top))
  if (byPrefix) return byPrefix[1]
  if (!String(rel).includes('/') && ROOT_FILES[rel]) return ROOT_FILES[rel]
  return DEFAULT_TAG
}

function entryDefault(rel, dir) {
  const name = path.basename(rel)
  if (isDisabledName(name)) return false
  if (!dir && NO_EXT.test(name)) return false
  if (!dir && JUNK_FILE.test(name)) return false
  const top = topOf(rel)
  if (!String(rel).includes('/') && ROOT_FILES[rel]) return ROOT_FILES[rel].def !== false
  const byPrefix = TAG_PREFIX.find(([re]) => re.test(top))
  if (byPrefix) return byPrefix[1].def !== false
  const rule = TAG_RULES[top]
  return rule ? rule.def !== false : true
}

function tagPayload(rel) {
  const tag = entryTag(rel)
  return { tone: tag.tone, tag: tag.vi, tagEn: tag.en }
}

function safeRel(rel) {
  const value = String(rel || '').split('\\').join('/').replace(/^\/+/, '')
  if (!value || value.split('/').some((part) => !part || part === '..' || part === '.')) return ''
  return value
}

async function listTree({ dir, rel = '' }) {
  const base = rel ? safeRel(rel) : ''
  if (base === '' && rel) return { ok: false, error: 'Đường dẫn không hợp lệ.' }
  const target = base ? path.join(dir, ...base.split('/')) : dir
  let entries = []
  try {
    entries = await fsp.readdir(target, { withFileTypes: true })
  } catch (err) {
    return { ok: false, error: `Không đọc được thư mục: ${err.message}`, entries: [] }
  }
  const rows = []
  for (const entry of entries) {
    const child = base ? `${base}/${entry.name}` : entry.name
    if (!base && HIDDEN_ROOT.has(entry.name)) continue
    const dirEntry = entry.isDirectory()
    if (!dirEntry && entry.name.startsWith('.')) continue
    if (dirEntry && entry.name.startsWith('.') && !TAG_RULES[entry.name]) continue
    const st = await fsp.stat(path.join(target, entry.name)).catch(() => null)
    rows.push({
      name: entry.name,
      rel: child,
      dir: dirEntry,
      size: dirEntry ? 0 : st?.size || 0,
      mtime: st?.mtimeMs || 0,
      disabled: isDisabledName(entry.name),
      def: entryDefault(child, dirEntry),
      ...tagPayload(child),
    })
  }
  rows.sort((a, b) => (Number(b.dir) - Number(a.dir)) || a.name.localeCompare(b.name, undefined, { numeric: true }))
  return { ok: true, rel: base, entries: rows }
}

async function scan({ dir, rel = '', out }) {
  const target = rel ? path.join(dir, ...rel.split('/')) : dir
  let entries = []
  try {
    entries = await fsp.readdir(target, { withFileTypes: true })
  } catch {
    return { count: 0, size: 0 }
  }
  let count = 0
  let size = 0
  for (const entry of entries) {
    const child = rel ? `${rel}/${entry.name}` : entry.name
    if (!rel && HIDDEN_ROOT.has(entry.name)) continue
    if (entry.isDirectory()) {
      if (entry.name.startsWith('.') && !TAG_RULES[entry.name]) continue
      const sub = await scan({ dir, rel: child, out })
      out.folders[child] = { count: sub.count, size: sub.size, def: entryDefault(child, true), ...tagPayload(child) }
      count += sub.count
      size += sub.size
      continue
    }
    if (!entry.isFile()) continue
    if (entry.name.startsWith('.')) continue
    const st = await fsp.stat(path.join(target, entry.name)).catch(() => null)
    const bytes = st?.size || 0
    out.files.push({ rel: child, size: bytes, def: entryDefault(child, false) })
    count += 1
    size += bytes
  }
  return { count, size }
}

async function walkFiles({ dir, rel }) {
  const base = safeRel(rel)
  if (!base) return { ok: false, error: 'Đường dẫn không hợp lệ.', files: [] }
  const out = { files: [], folders: {} }
  await scan({ dir, rel: base, out })
  return { ok: true, rel: base, files: out.files.map((f) => ({ rel: f.rel, def: f.def })) }
}

function escapeValue(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/[^\x20-\x7E]/g, (ch) => `\\u${ch.charCodeAt(0).toString(16).padStart(4, '0')}`)
}

function unescapeValue(value) {
  return String(value)
    .replace(/\\u([0-9a-fA-F]{4})/g, (_m, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/\\\\/g, '\\')
}

function parseProperties(text) {
  const map = {}
  for (const line of String(text || '').split(/\r?\n/)) {
    if (!line || line.startsWith('#') || line.startsWith('!')) continue
    const idx = line.indexOf('=')
    if (idx < 1) continue
    map[line.slice(0, idx).trim()] = unescapeValue(line.slice(idx + 1))
  }
  return map
}

function propsText(map, when) {
  const keys = [...PROP_KEYS].filter((key) => map[key] !== undefined)
  const extra = Object.keys(map)
    .filter((key) => !PROP_KEYS.has(key))
    .sort((a, b) => a.localeCompare(b))
  const lines = ['#Minecraft server properties', `#${(when || new Date()).toString()}`]
  for (const key of [...keys, ...extra]) lines.push(`${key}=${escapeValue(map[key])}`)
  return `${lines.join('\n')}\n`
}

function mergeProps(base, patch) {
  const map = { ...base }
  for (const [key, value] of Object.entries(patch || {})) {
    const name = String(key).trim()
    if (!name || /[\r\n=]/.test(name)) continue
    map[name] = String(value ?? '').replace(/[\r\n]+/g, ' ')
  }
  return map
}

async function readInstanceProps(dir) {
  try {
    return parseProperties(await fsp.readFile(path.join(dir, 'server.properties'), 'utf8'))
  } catch {
    return null
  }
}

async function readPackPlan(dir) {
  try {
    const data = JSON.parse(await fsp.readFile(path.join(dir, '.lunaspace-modpack.json'), 'utf8'))
    if (data && typeof data === 'object') return data
  } catch {}
  return null
}

async function probe(url) {
  try {
    const res = await fetch(url, { method: 'HEAD', headers: UA, signal: AbortSignal.timeout(15000) })
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}`, size: 0 }
    const size = Number(res.headers.get('content-length') || 0)
    if (size) return { ok: true, size }
    const range = await fetch(url, { headers: { ...UA, Range: 'bytes=0-0' }, signal: AbortSignal.timeout(15000) }).catch(() => null)
    const total = range?.headers.get('content-range')?.split('/')[1]
    return { ok: true, size: Number(total || 0) }
  } catch (err) {
    return { ok: false, error: err.message, size: 0 }
  }
}

async function vanillaServer({ metaDir, mc }) {
  const { manifest } = await getManifest({ metaDir })
  const entry = (manifest.versions || []).find((v) => v.id === mc)
  if (!entry) throw new Error(`Không có ${mc} trong danh sách Mojang`)
  const json = await getVersionJson({ metaDir, version: mc, url: entry.url })
  const dl = json?.downloads?.server
  if (!dl?.url) throw new Error(`Mojang không phát hành tệp server cho ${mc}`)
  return { name: 'server.jar', url: dl.url, size: dl.size || 0, sha1: dl.sha1 || '' }
}

async function serverBundle({ metaDir, mc, loader, loaderVersion }) {
  const kind = LOADER_KEYS.includes(loader) ? loader : 'vanilla'
  if (!mc) return { ok: false, error: 'Chưa rõ phiên bản Minecraft của instance.' }
  if (kind !== 'vanilla' && !loaderVersion) return { ok: false, error: `Instance thiếu bản ${kind} nên không dựng được tệp server.` }
  try {
    if (kind === 'forge') {
      const full = await forgeModule.resolveFullId({ game: mc, idOrVersion: loaderVersion }).catch(() => `${mc}-${loaderVersion}`)
      const name = `forge-${full}-installer.jar`
      const url = `${FORGE_MAVEN}/${full}/${name}`
      const head = await probe(url)
      return { ok: head.ok, kind, installer: true, name, url, size: head.size, error: head.ok ? '' : head.error, extra: [], start: name }
    }
    if (kind === 'neoforge') {
      const full = await neoforgeModule.resolveFullId({ game: mc, idOrVersion: loaderVersion }).catch(() => loaderVersion)
      const legacy = full.startsWith(`${LEGACY_GAME}-`)
      const group = legacy ? 'forge' : 'neoforge'
      const name = `${group}-${full}-installer.jar`
      const url = `${NEO_MAVEN}/${group}/${full}/${name}`
      const head = await probe(url)
      return { ok: head.ok, kind, installer: true, name, url, size: head.size, error: head.ok ? '' : head.error, extra: [], start: name }
    }
    if (kind === 'quilt') {
      let installer = null
      try {
        const list = await fetchJson(`${QUILT_META}/versions/installer`)
        installer = Array.isArray(list) ? list[0] : null
      } catch {}
      if (!installer?.url) return { ok: false, kind, error: 'Không lấy được bản Quilt Installer.' }
      const name = `quilt-installer-${installer.version}.jar`
      const head = await probe(installer.url)
      const vanilla = await vanillaServer({ metaDir, mc }).catch((err) => ({ error: err.message }))
      return {
        ok: head.ok,
        kind,
        installer: true,
        name,
        url: installer.url,
        size: head.size || installer.file_size || 0,
        error: head.ok ? '' : head.error,
        start: 'quilt-server-launch.jar',
        installArgs: `install server ${mc} ${loaderVersion} --download-server --install-dir=.`,
        extra: vanilla?.url ? [{ name: 'server.jar', url: vanilla.url, size: vanilla.size || 0, sha1: vanilla.sha1 || '' }] : [],
      }
    }
    if (kind === 'fabric') {
      let installer = ''
      try {
        const list = await fetchJson(`${FABRIC_META}/versions/installer`)
        installer = list?.[0]?.version || ''
      } catch {}
      if (!installer) return { ok: false, kind, error: 'Không lấy được bản Fabric installer.' }
      const name = 'fabric-server-launch.jar'
      const url = `${FABRIC_META}/versions/loader/${mc}/${loaderVersion}/${installer}/server/jar`
      const head = await probe(url)
      const vanilla = await vanillaServer({ metaDir, mc }).catch((err) => ({ error: err.message }))
      return {
        ok: head.ok,
        kind,
        installer: false,
        name,
        url,
        size: head.size,
        error: head.ok ? '' : head.error,
        start: name,
        extra: vanilla?.url ? [{ name: 'server.jar', url: vanilla.url, size: vanilla.size || 0, sha1: vanilla.sha1 || '' }] : [],
        props: 'fabric-server-launcher.properties',
      }
    }
    const dl = await vanillaServer({ metaDir, mc })
    return { ok: true, kind: 'vanilla', installer: false, name: dl.name, url: dl.url, size: dl.size, sha1: dl.sha1, error: '', extra: [], start: dl.name }
  } catch (err) {
    return { ok: false, kind, error: err.message }
  }
}

function startScripts(bundle, memoryMb) {
  const ram = Math.max(1024, Number(memoryMb) || 4096)
  const run = bundle.start || bundle.name
  if (bundle.installArgs) {
    const bat = [
      '@echo off',
      `java -jar ${bundle.name} ${bundle.installArgs}`,
      'pause',
    ].join('\r\n')
    const sh = [
      '#!/bin/sh',
      `java -jar ${bundle.name} ${bundle.installArgs}`,
    ].join('\n')
    return { 'install-server.bat': bat, 'install-server.sh': sh, 'run-server.bat': ['@echo off', `java -Xmx${ram}M -jar ${run} nogui`, 'pause'].join('\r\n') }
  }
  if (bundle.installer) {
    const bat = [
      '@echo off',
      `if not exist run.bat java -jar ${bundle.name} --installServer`,
      'call run.bat nogui',
    ].join('\r\n')
    const sh = [
      '#!/bin/sh',
      `[ -f run.sh ] || java -jar ${bundle.name} --installServer`,
      './run.sh nogui',
    ].join('\n')
    return { 'start.bat': bat, 'start.sh': sh }
  }
  const bat = ['@echo off', `java -Xmx${ram}M -jar ${run} nogui`, 'pause'].join('\r\n')
  const sh = ['#!/bin/sh', `java -Xmx${ram}M -jar ${run} nogui`].join('\n')
  return { 'start.bat': bat, 'start.sh': sh }
}

async function plan({ dir, id, name, version, loader, loaderVersion, metaDir, skipServer = false }) {
  const pack = await readPackPlan(dir)
  const mc = pack?.mc || version || ''
  const kind = pack?.loader || loader || 'vanilla'
  const kindVersion = pack?.loaderVersion || loaderVersion || ''
  const out = { files: [], folders: {} }
  await scan({ dir, out })
  const server = skipServer ? { ok: false, skipped: true, error: '' } : await serverBundle({ metaDir, mc, loader: kind, loaderVersion: kindVersion })
  const existing = await readInstanceProps(dir)
  const props = mergeProps(Object.fromEntries(DEFAULT_PROPS), existing || {})
  return {
    ok: true,
    id,
    name: name || pack?.name || 'Instance',
    mc,
    loader: kind,
    loaderVersion: kindVersion,
    files: out.files,
    folders: out.folders,
    totalFiles: out.files.length,
    totalBytes: out.files.reduce((sum, file) => sum + (file.size || 0), 0),
    server,
    props,
    propsOrder: DEFAULT_PROPS.map(([key]) => key),
    propsText: propsText(props),
    hasProps: !!existing,
  }
}

async function exportServerPack({
  dir,
  targetPath,
  include = [],
  props = null,
  raw = null,
  server = null,
  metaDir,
  cacheDir,
  onProgress,
  onLog,
}) {
  const picks = []
  const seen = new Set()
  for (const item of include) {
    const rel = safeRel(item)
    if (!rel || seen.has(rel)) continue
    if (rel === 'server.properties') continue
    seen.add(rel)
    picks.push(rel)
  }

  const zip = new ZipWriter(targetPath)
  const total = picks.length + (server?.download ? (server.extra?.length || 0) + 1 : 0)
  let done = 0
  const tick = (label) => {
    done += 1
    onProgress?.({ phase: 'serverpack', label: 'serverpack', done, total, file: label })
  }

  const report = { files: 0, skipped: 0, server: null, serverError: '' }
  let temp = null

  try {
    for (const rel of picks) {
      const full = path.join(dir, ...rel.split('/'))
      const st = await fsp.stat(full).catch(() => null)
      if (!st?.isFile()) {
        report.skipped += 1
        continue
      }
      zip.addFile(rel, full)
      report.files += 1
      tick(rel)
    }

    const map = raw === null || raw === undefined
      ? mergeProps(Object.fromEntries(DEFAULT_PROPS), props || {})
      : null
    zip.addBuffer('server.properties', raw === null || raw === undefined ? propsText(map) : String(raw))
    if (server?.download) {
      try {
        const base = cacheDir || os.tmpdir()
        await fsp.mkdir(base, { recursive: true })
        temp = await fsp.mkdtemp(path.join(base, 'serverpack-'))
        const tasks = [{ name: server.name, url: server.url, size: server.size || 0, sha1: server.sha1 || '' }]
        for (const extra of server.extra || []) tasks.push({ name: extra.name, url: extra.url, size: extra.size || 0, sha1: extra.sha1 || '' })
        const res = await downloadAll(
          tasks.map((task) => ({ url: task.url, dest: path.join(temp, task.name), size: task.size, sha1: task.sha1 })),
          { concurrency: 3, label: 'server', onProgress: (p) => onProgress?.({ phase: 'download', label: 'server', ...p }) },
        )
        if (res.errors.length) throw new Error(res.errors[0].error)
        const bundle = { ...server, installer: !!server.installer, start: server.start || server.name }
        for (const task of tasks) {
          zip.addFile(task.name, path.join(temp, task.name))
          tick(task.name)
        }
        if (server.props) zip.addBuffer(server.props, `serverJar=${server.start || server.name}\n`)
        for (const [fileName, text] of Object.entries(startScripts(bundle, server.memoryMb))) {
          zip.addBuffer(fileName, text)
        }
        report.server = { name: server.name, kind: server.kind, size: server.size || 0 }
        onLog?.(`[LunarSpace] Serverpack kèm tệp server: ${server.name}`)
      } catch (err) {
        report.serverError = err.message
        onLog?.(`[LunarSpace] Không tải được tệp server: ${err.message}`)
      }
    }

    const out = zip.close()
    return {
      ok: true,
      path: targetPath,
      bytes: out.bytes,
      entries: out.entries,
      files: report.files,
      skipped: report.skipped,
      server: report.server,
      serverError: report.serverError,
    }
  } catch (err) {
    try {
      zip.close()
    } catch {}
    try {
      await fsp.unlink(targetPath)
    } catch {}
    throw err
  } finally {
    if (temp) {
      try {
        await fsp.rm(temp, { recursive: true, force: true })
      } catch {}
    }
  }
}

module.exports = { plan, listTree, walkFiles, exportServerPack, serverBundle, parseProperties, propsText, escapeValue, unescapeValue, readPackPlan, DEFAULT_PROPS }
