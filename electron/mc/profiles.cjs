const fs = require('fs')
const fsp = fs.promises
const path = require('path')
const crypto = require('crypto')

const FILE_NAME = 'launcher_profiles.json'
const MANAGED_KEY = 'lunarSpaceManaged'
const PROFILES_FORMAT = 2
const LAUNCHER_FORMAT = 21
const PROFILE_ICON = 'data:image/png;base64,'

function profileFor(instance, previous, now) {
  return {
    name: instance.name,
    type: 'custom',
    created: previous?.created || instance.created || now,
    lastUsed: instance.lastPlayed || previous?.lastUsed || now,
    icon: instance.icon || previous?.icon || PROFILE_ICON,
    gameDir: instance.dir,
    lastVersionId: instance.versionId,
    javaArgs: `-Xmx${instance.memoryMb || 2048}M${instance.jvmArgs ? ` ${instance.jvmArgs}` : ''}`,
    ...(instance.loaderVersion ? { lunarSpaceLoader: `${instance.loader}-${instance.loaderVersion}` } : {}),
  }
}

function build(existing, instances, version) {
  const now = new Date().toISOString()
  const profiles = { ...(existing?.profiles || {}) }
  const managed = Array.isArray(existing?.[MANAGED_KEY]) ? existing[MANAGED_KEY] : []

  for (const id of managed) {
    if (!instances.some((i) => i.id === id)) delete profiles[id]
  }
  for (const instance of instances) {
    profiles[instance.id] = profileFor(instance, profiles[instance.id], now)
  }

  return {
    ...(existing || {}),
    profiles,
    settings: {
      enableSnapshots: false,
      enableAdvanced: true,
      keepLauncherOpen: false,
      showGameLog: false,
      showMenu: false,
      soundOn: false,
      locale: 'en_US',
      ...(existing?.settings || {}),
    },
    version: 3,
    clientToken: existing?.clientToken || crypto.randomUUID(),
    selectedUser: existing?.selectedUser ?? null,
    authenticationDatabase: existing?.authenticationDatabase || {},
    launcherVersion: { name: version || '1.0.0', format: LAUNCHER_FORMAT, profilesFormat: PROFILES_FORMAT },
    [MANAGED_KEY]: instances.map((i) => i.id),
  }
}

async function read(file) {
  try {
    return JSON.parse(await fsp.readFile(file, 'utf8'))
  } catch {
    return null
  }
}

function scopedTo(data, instanceId) {
  const profile = data.profiles?.[instanceId]
  return {
    ...data,
    profiles: profile ? { [instanceId]: profile } : {},
    [MANAGED_KEY]: profile ? [instanceId] : [],
  }
}

async function writeLauncherProfiles({ shared, instances = [], version = '1.0.0', alsoDirs = true }) {
  if (!shared) return { ok: false, error: 'Thiếu thư mục dùng chung.' }
  const file = path.join(shared, FILE_NAME)
  const next = build(await read(file), instances, version)
  const text = JSON.stringify(next, null, 2)

  await fsp.mkdir(shared, { recursive: true })
  await fsp.writeFile(file, text, 'utf8')

  if (alsoDirs) {
    for (const instance of instances) {
      if (!instance.dir) continue
      try {
        await fsp.mkdir(instance.dir, { recursive: true })
        const own = JSON.stringify(scopedTo(next, instance.id), null, 2)
        await fsp.writeFile(path.join(instance.dir, FILE_NAME), own, 'utf8')
      } catch {}
    }
  }

  return { ok: true, file, profiles: Object.keys(next.profiles).length }
}

function profilesPath(shared) {
  return path.join(shared, FILE_NAME)
}

module.exports = { writeLauncherProfiles, profilesPath, FILE_NAME }
