const { execFile } = require('child_process')
const fs = require('fs')
const path = require('path')

const KEY = 'HKCU\\Software\\Microsoft\\DirectX\\UserGpuPreferences'
const PORTABLE_CHASSIS = [8, 9, 10, 14, 30, 31]
const DISCRETE_GPU = /nvidia|geforce|rtx|gtx|quadro|radeon|arc a/i

let cached = null

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

async function detect() {
  if (cached) return cached
  cached = { laptop: false, gpus: [], wanted: false }
  if (process.platform !== 'win32') return cached
  const chassis = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', '(Get-CimInstance Win32_SystemEnclosure).ChassisTypes -join ","'])
  const gpus = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', '(Get-CimInstance Win32_VideoController).Name -join ";"'])
  const types = chassis.split(',').map((n) => parseInt(n.trim(), 10)).filter((n) => Number.isFinite(n))
  cached.laptop = types.some((t) => PORTABLE_CHASSIS.includes(t))
  cached.gpus = gpus.split(';').map((s) => s.trim()).filter(Boolean)
  cached.wanted = cached.gpus.length >= 2 && DISCRETE_GPU.test(cached.gpus.join(' '))
  return cached
}

async function ensureGameGpu(javaPath) {
  try {
    if (process.platform !== 'win32' || !javaPath) return false
    const info = await detect()
    if (!info.wanted) return false
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
