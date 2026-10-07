const AdmZip = require('adm-zip')

const LWJGL_NESTED = /^META-INF\/jars\/lwjgl[-_.]/i
const LWJGL_PACKAGE = /^org\/lwjgl\//
const LWJGL_NATIVE = /^(windows|linux|macos|freebsd)\/[^/]+\/org\/lwjgl\//

function openZip(file) {
  try {
    return new AdmZip(file)
  } catch {
    return null
  }
}

function isClientOnlyJar(file) {
  const zip = openZip(file)
  if (!zip) return false
  let entries = []
  try {
    entries = zip.getEntries()
  } catch {
    return false
  }
  for (const entry of entries) {
    const name = entry.entryName
    if (LWJGL_NESTED.test(name) || LWJGL_PACKAGE.test(name) || LWJGL_NATIVE.test(name)) return true
  }
  return false
}

function readText(zip, name) {
  try {
    return zip.readAsText(name)
  } catch {
    return ''
  }
}

function declaredSide(file) {
  const zip = openZip(file)
  if (!zip) return null

  const fabric = readText(zip, 'fabric.mod.json')
  if (fabric) {
    try {
      const environment = String(JSON.parse(fabric).environment || '*').toLowerCase()
      if (environment === 'client') return { env: 'client', source: 'fabric.mod.json: environment = client' }
      if (environment === 'server') return { env: 'server', source: 'fabric.mod.json: environment = server' }
      return { env: 'both', source: 'fabric.mod.json: environment = *' }
    } catch {}
  }

  const quilt = readText(zip, 'quilt.mod.json')
  if (quilt) {
    try {
      const environment = String(JSON.parse(quilt)?.quilt_loader?.metadata?.environment || '*').toLowerCase()
      if (environment === 'client') return { env: 'client', source: 'quilt.mod.json: environment = client' }
      if (environment === 'server') return { env: 'server', source: 'quilt.mod.json: environment = server' }
      return { env: 'both', source: 'quilt.mod.json: environment = *' }
    } catch {}
  }

  const toml = [readText(zip, 'META-INF/neoforge.mods.toml'), readText(zip, 'META-INF/mods.toml')].filter(Boolean).join('\n')
  if (!toml) return null
  if (/clientSideOnly\s*=\s*true/i.test(toml)) return { env: 'client', source: 'mods.toml: clientSideOnly = true' }
  const side = /side\s*=\s*"(client|server|both|\*)"/i.exec(toml)
  if (side) {
    const value = side[1].toLowerCase()
    if (value === 'client') return { env: 'client', source: 'mods.toml: side = client' }
    if (value === 'server') return { env: 'server', source: 'mods.toml: side = server' }
    return { env: 'both', source: 'mods.toml: side = both' }
  }
  return { env: null, source: 'mods.toml: không khai báo side' }
}

module.exports = { isClientOnlyJar, declaredSide }
