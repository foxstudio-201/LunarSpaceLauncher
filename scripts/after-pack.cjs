const fs = require('fs')
const path = require('path')

exports.afterPack = async (context) => {
  if (context.electronPlatformName !== 'win32') return
  const file = path.join(context.appOutDir, 'resources', 'app-update.yml')
  if (fs.existsSync(file)) return
  const publish = Array.isArray(context.packager.config.publish) ? context.packager.config.publish : []
  const config = publish.find((item) => item && item.provider && item.provider !== 'generic')
  if (!config) return
  const lines = [`provider: ${config.provider}`]
  for (const [key, value] of Object.entries(config)) {
    if (key !== 'provider' && typeof value === 'string') lines.push(`${key}: ${value}`)
  }
  lines.push(`updaterCacheDirName: ${context.packager.appInfo.updaterCacheDirName}`)
  fs.writeFileSync(file, `${lines.join('\n')}\n`, 'utf8')
  console.log(`[afterPack] wrote ${file}`)
}
