const fs = require('fs')
const fsp = fs.promises
const path = require('path')
const AdmZip = require('adm-zip')
const { downloadAll, fetchJson, isFresh } = require('./net.cjs')
const { getVersionJson, getManifest } = require('./meta.cjs')
const javaModule = require('./java.cjs')

const OS_NAME = process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'osx' : 'linux'
const OS_ARCH = process.arch === 'ia32' ? 'x86' : process.arch === 'arm64' ? 'arm64' : 'x86_64'

function pathsFor(sharedDir) {
  return {
    shared: sharedDir,
    meta: path.join(sharedDir, 'meta'),
    versions: path.join(sharedDir, 'versions'),
    libraries: path.join(sharedDir, 'libraries'),
    assets: path.join(sharedDir, 'assets'),
    assetsIndexes: path.join(sharedDir, 'assets', 'indexes'),
    assetsObjects: path.join(sharedDir, 'assets', 'objects'),
    natives: path.join(sharedDir, 'natives'),
    runtime: path.join(sharedDir, 'runtime'),
  }
}

function ruleAllows(rules) {
  if (!Array.isArray(rules) || rules.length === 0) return true
  let allowed = false
  for (const rule of rules) {
    const osOk = !rule.os || (
      (!rule.os.name || rule.os.name === OS_NAME) &&
      (!rule.os.arch || rule.os.arch === OS_ARCH) &&
      (!rule.os.version || new RegExp(rule.os.version).test(process.getSystemVersion?.() || ''))
    )
    const featOk = !rule.features || Object.values(rule.features).every((v) => v === false)
    if (osOk && featOk) allowed = rule.action === 'allow'
  }
  return allowed
}

async function loadVersionJson(id, ctx) {
  for (const file of [path.join(ctx.paths.meta, 'versions', `${id}.json`), path.join(ctx.paths.versions, id, `${id}.json`)]) {
    try {
      return JSON.parse(await fsp.readFile(file, 'utf8'))
    } catch {}
  }
  const { manifest } = await getManifest({ metaDir: ctx.paths.meta })
  const entry = manifest.versions.find((v) => v.id === id)
  if (!entry) throw new Error(`Không tìm thấy phiên bản ${id} trong manifest Mojang`)
  return getVersionJson({ metaDir: ctx.paths.meta, version: id, url: entry.url })
}

function libKey(name) {
  const parts = String(name).split(':')
  const classifier = parts.length > 3 ? parts[3] : ''
  return `${parts[0]}:${parts[1]}${classifier ? `:${classifier}` : ''}`
}

function mergeVersion(parent, child) {
  const childKeys = new Set((child.libraries || []).map((lib) => libKey(lib.name)))
  const parentLibs = (parent.libraries || []).filter((lib) => !childKeys.has(libKey(lib.name)))
  const jvm = [...(parent.arguments?.jvm || []), ...(child.arguments?.jvm || [])]
  const game = [...(parent.arguments?.game || []), ...(child.arguments?.game || [])]
  return {
    _id: child.id,
    _jarId: parent._jarId,
    id: child.id,
    mainClass: child.mainClass || parent.mainClass,
    libraries: [...parentLibs, ...(child.libraries || [])],
    arguments: { jvm, game },
    minecraftArguments: child.minecraftArguments || parent.minecraftArguments,
    assetIndex: child.assetIndex || parent.assetIndex,
    assets: child.assets || parent.assets,
    downloads: child.downloads || parent.downloads,
    javaVersion: child.javaVersion || parent.javaVersion,
    type: child.type || parent.type,
    releaseTime: child.releaseTime || parent.releaseTime,
  }
}

async function resolveChain(id, ctx) {
  const json = await loadVersionJson(id, ctx)
  if (!json.inheritsFrom) return { ...json, _id: json.id || id, _jarId: json.id || id }
  const parent = await resolveChain(json.inheritsFrom, ctx)
  return mergeVersion(parent, json)
}

function mavenTask(lib, paths) {
  const parts = String(lib.name).split(':')
  const [group, artifact, version, classifier] = parts
  const file = `${artifact}-${version}${classifier ? `-${classifier}` : ''}.jar`
  const rel = path.join(group.replace(/\./g, '/'), artifact, version, file)
  const base = String(lib.url || 'https://libraries.minecraft.net/').replace(/\/?$/, '/')
  return { url: `${base}${rel.split(path.sep).join('/')}`, dest: path.join(paths.libraries, rel) }
}

function libraryTasks(version, paths) {
  const artifacts = []
  const natives = []
  for (const lib of version.libraries || []) {
    if (!ruleAllows(lib.rules)) continue
    const dl = lib.downloads || {}
    if (dl.artifact) {
      artifacts.push({
        url: dl.artifact.url,
        dest: path.join(paths.libraries, dl.artifact.path),
        sha1: dl.artifact.sha1,
        size: dl.artifact.size,
      })
      if (/:natives-/.test(lib.name)) natives.push(path.join(paths.libraries, dl.artifact.path))
    }
    if (lib.natives) {
      const raw = lib.natives[OS_NAME]
      if (raw) {
        const classifier = raw.replace('${arch}', process.arch === 'ia32' ? '32' : '64')
        const entry = dl.classifiers?.[classifier]
        if (entry) {
          const dest = path.join(paths.libraries, entry.path)
          artifacts.push({ url: entry.url, dest, sha1: entry.sha1, size: entry.size })
          natives.push(dest)
        } else if (!dl.artifact) {
          const parts = String(lib.name).split(':')
          const [group, artifact, version] = parts
          const rel = path.join(group.replace(/\./g, '/'), artifact, version, `${artifact}-${version}-${classifier}.jar`)
          const base = String(lib.url || 'https://libraries.minecraft.net/').replace(/\/?$/, '/')
          const dest = path.join(paths.libraries, rel)
          artifacts.push({ url: `${base}${rel.split(path.sep).join('/')}`, dest })
          natives.push(dest)
        }
      }
    }
    if (!dl.artifact && !dl.classifiers && !lib.natives) artifacts.push(mavenTask(lib, paths))
  }
  return { artifacts, natives }
}

async function assetTasks(version, paths, ctx) {
  const index = version.assetIndex
  if (!index) return { indexTask: null, objects: [], indexJson: null }
  const indexFile = path.join(paths.assetsIndexes, `${index.id}.json`)
  const indexTask = { url: index.url, dest: indexFile, sha1: index.sha1, size: index.size }
  let indexJson = null
  try {
    indexJson = JSON.parse(await fsp.readFile(indexFile, 'utf8'))
  } catch {}
  if (!indexJson) {
    if (ctx.dryRun) {
      try {
        indexJson = await fetchJson(index.url)
      } catch {
        return { indexTask, objects: [], indexJson: null }
      }
    } else {
      const res = await downloadAll([indexTask], { onProgress: ctx.onProgress, signal: ctx.signal, label: 'index', concurrency: 4 })
      if (res.errors.length) throw new Error(`Không tải được asset index ${index.id}: ${res.errors[0].error}`)
      indexJson = JSON.parse(await fsp.readFile(indexFile, 'utf8'))
    }
  }
  const objects = Object.values(indexJson.objects || {}).map((obj) => ({
    url: `https://resources.download.minecraft.net/${obj.hash.slice(0, 2)}/${obj.hash}`,
    dest: path.join(paths.assetsObjects, obj.hash.slice(0, 2), obj.hash),
    sha1: obj.hash,
    size: obj.size,
    skipHash: true,
  }))
  return { indexTask, objects, indexJson }
}

async function extractNatives(jars, destDir) {
  await fsp.mkdir(destDir, { recursive: true })
  let count = 0
  for (const jar of jars) {
    try {
      const zip = new AdmZip(jar)
      for (const entry of zip.getEntries()) {
        if (entry.isDirectory) continue
        const name = entry.entryName
        if (name.startsWith('META-INF/') || name.includes('..')) continue
        const out = path.join(destDir, name)
        await fsp.mkdir(path.dirname(out), { recursive: true })
        await fsp.writeFile(out, entry.getData())
        count += 1
      }
    } catch {}
  }
  return count
}

async function ensureLaunchFiles({ versionId, paths, onProgress, signal }) {
  const chain = await resolveChain(versionId, { paths, dryRun: true })
  const { artifacts, natives } = libraryTasks(chain, paths)
  const clientDownload = chain.downloads?.client
  const jarPath = path.join(paths.versions, chain._jarId, `${chain._jarId}.jar`)
  const tasks = [...artifacts]
  if (clientDownload) {
    tasks.push({ url: clientDownload.url, dest: jarPath, sha1: clientDownload.sha1, size: clientDownload.size })
  }

  const nativesDir = path.join(paths.natives, chain._id)
  let nativesOk = false
  try {
    nativesOk = (await fsp.readdir(nativesDir)).length > 0
  } catch {}
  await fsp.mkdir(nativesDir, { recursive: true })

  const checks = await Promise.all(tasks.map(async (task) => ({ task, fresh: await isFresh(task) })))
  const missing = checks.filter((c) => !c.fresh).map((c) => c.task)

  try {
    const vanillaJson = await loadVersionJson(chain._jarId, { paths, dryRun: true })
    const vanillaDir = path.join(paths.versions, chain._jarId)
    await fsp.mkdir(vanillaDir, { recursive: true })
    await fsp.writeFile(path.join(vanillaDir, `${chain._jarId}.json`), JSON.stringify(vanillaJson, null, 2), 'utf8')
  } catch {}

  if (!missing.length && (nativesOk || !natives.length)) {
    return { chain, errors: [], downloaded: 0, nativesDir, repaired: false }
  }

  const res = await downloadAll(missing, { concurrency: 12, onProgress, signal, label: 'libraries' })
  if (!res.errors.length && !nativesOk && natives.length) {
    await extractNatives(natives, nativesDir)
  }
  return { chain, errors: res.errors, downloaded: missing.length - res.skipped, nativesDir, repaired: true }
}

async function install({ versionId, paths, onProgress, signal, dryRun = false }) {
  const ctx = { paths, onProgress, signal, dryRun }
  const chain = await resolveChain(versionId, ctx)
  const { artifacts, natives } = libraryTasks(chain, paths)
  const { objects } = await assetTasks(chain, paths, ctx)

  const clientDownload = chain.downloads?.client
  const jarPath = path.join(paths.versions, chain._jarId, `${chain._jarId}.jar`)
  const clientTask = clientDownload
    ? { url: clientDownload.url, dest: jarPath, sha1: clientDownload.sha1, size: clientDownload.size }
    : null

  const summary = {
    versionId: chain._id,
    jarId: chain._jarId,
    libraries: artifacts.length,
    objects: objects.length,
    hasClient: !!clientTask,
    javaMajor: chain.javaVersion?.majorVersion || 8,
    javaComponent: chain.javaVersion?.component || null,
  }

  if (dryRun) {
    return { chain, summary, nativesDir: path.join(paths.natives, chain._id), errors: [] }
  }

  try {
    const vanillaJson = await loadVersionJson(chain._jarId, ctx)
    const vanillaDir = path.join(paths.versions, chain._jarId)
    await fsp.mkdir(vanillaDir, { recursive: true })
    await fsp.writeFile(path.join(vanillaDir, `${chain._jarId}.json`), JSON.stringify(vanillaJson, null, 2), 'utf8')
  } catch {}

  const nativeDir = path.join(paths.natives, chain._id)
  await fsp.mkdir(nativeDir, { recursive: true })
  const errors = []

  if (clientTask) {
    const res = await downloadAll([clientTask], { onProgress, signal, label: 'client', concurrency: 1 })
    errors.push(...res.errors)
  }
  if (artifacts.length) {
    const res = await downloadAll(artifacts, { onProgress, signal, label: 'libraries', concurrency: 12 })
    errors.push(...res.errors)
  }
  if (objects.length) {
    const res = await downloadAll(objects, { onProgress, signal, label: 'assets', concurrency: 20 })
    errors.push(...res.errors)
  }
  if (natives.length) {
    await extractNatives(natives, nativeDir)
  }

  let java = null
  const component = chain.javaVersion?.component
  if (component) {
    try {
      const runtime = await javaModule.installRuntime({
        paths,
        metaDir: paths.meta,
        component,
        onProgress,
        signal,
      })
      java = {
        component,
        name: runtime.name,
        major: runtime.major,
        javaPath: runtime.javaPath,
        bytes: runtime.bytes,
        cached: runtime.cached,
      }
    } catch (err) {
      java = { component, error: err.message }
    }
  }

  return { chain, summary: { ...summary, java }, nativesDir: nativeDir, jarPath, errors }
}

module.exports = {
  OS_NAME,
  OS_ARCH,
  pathsFor,
  ruleAllows,
  resolveChain,
  libraryTasks,
  assetTasks,
  extractNatives,
  ensureLaunchFiles,
  install,
}
