const { execFile } = require('child_process')
const fs = require('fs')
const path = require('path')

const KEY = 'HKCU\\Software\\Microsoft\\DirectX\\UserGpuPreferences'
const PORTABLE_CHASSIS = [8, 9, 10, 14, 30, 31]
const DISCRETE_GPU = /nvidia|geforce|rtx|gtx|quadro|radeon|arc a/i
const CACHE_TTL = 30 * 24 * 60 * 60 * 1000

let cached = null
let pending = null

function run(file, args) {
  return new Promise((resolve) => {
    try {
      execFile(file, args, { windowsHide: true, timeout: 20000 }, (err, stdout) => {
        resolve(err ? '' : String(stdout || ''))
      })
    } catch {
      resolve('')
    }
  })
}

function readCache(file) {
  if (!file) return null
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'))
    if (!data || !Array.isArray(data.gpus) || !data.gpus.length) return null
    if (Date.now() - Number(data.at || 0) > CACHE_TTL) return null
    return { laptop: !!data.laptop, gpus: data.gpus, wanted: !!data.wanted }
  } catch {
    return null
  }
}

function writeCache(file, info) {
  if (!file) return
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, JSON.stringify({ ...info, at: Date.now() }), 'utf8')
  } catch {}
}

async function inspect(cacheFile) {
  const disk = readCache(cacheFile)
  if (disk) return disk
  const info = { laptop: false, gpus: [], wanted: false }
  if (process.platform !== 'win32') return info
  const chassis = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', '(Get-CimInstance Win32_SystemEnclosure).ChassisTypes -join ","'])
  const gpus = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', '(Get-CimInstance Win32_VideoController).Name -join ";"'])
  const types = chassis.split(',').map((n) => parseInt(n.trim(), 10)).filter((n) => Number.isFinite(n))
  info.laptop = types.some((t) => PORTABLE_CHASSIS.includes(t))
  info.gpus = gpus.split(';').map((s) => s.trim()).filter(Boolean)
  info.wanted = info.gpus.length >= 2 && DISCRETE_GPU.test(info.gpus.join(' '))
  writeCache(cacheFile, info)
  return info
}

async function detect(cacheFile) {
  if (cached) return cached
  if (!pending) {
    pending = inspect(cacheFile)
      .then((info) => {
        cached = info
        return info
      })
      .finally(() => {
        pending = null
      })
  }
  return pending
}

async function ensureGameGpu(javaPath, cacheFile) {
  try {
    if (process.platform !== 'win32' || !javaPath) return false
    if (!cached) {
      detect(cacheFile).catch(() => {})
      return false
    }
    if (!cached.wanted) return false
    const dir = path.dirname(javaPath)
    let wrote = false
    for (const name of ['javaw.exe', 'java.exe']) {
      const exe = path.join(dir, name)
      if (!fs.existsSync(exe)) continue
      const current = await run('reg.exe', ['query', KEY, '/v', exe])
      if (/GpuPreference=2/i.test(current)) continue
      await run('reg.exe', ['add', KEY, '/v', exe, '/t', 'REG_SZ', '/d', 'GpuPreference=2;', '/f'])
      wrote = true
    }
    return wrote
  } catch {
    return false
  }
}

module.exports = { ensureGameGpu, detectGpu: detect }
