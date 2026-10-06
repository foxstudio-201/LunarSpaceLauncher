export const LOGO_ROWS = [
  '█                              ████',
  '█     █   █ ████   ███  ████  █     ████   ███   ████  ███',
  '█     █   █ █   █ █   █ █   █  ███  █   █ █   █ █     █   █',
  '█     █   █ █   █ █   █ █         █ ████  █   █ █     █████',
  '█████  ███  █   █  ████ █     ████  █      ████  ████  ███',
  '                                    █',
]

const ROW_COLORS = [189, 183, 177, 141, 135, 129]
const RESET = '\x1b[0m'
const DIM = '\x1b[38;5;240m'
const SOFT = '\x1b[38;5;245m'
const LABEL = '\x1b[38;5;183m'

export const BANNER_MARK = '\u200b\u200b'

const dot = () => `${DIM}·${RESET}`

export function bannerVersion(appVersion) {
  return appVersion ? `v${appVersion}` : 'v1.0.0'
}

export function launchBannerLines(instance, appVersion) {
  const rows = LOGO_ROWS.map((row, i) => `\x1b[38;5;${ROW_COLORS[i]}m${row}${RESET}`)
  const loader = `${instance?.loader || 'vanilla'}${instance?.loaderVersion ? ` ${instance.loaderVersion}` : ''}`
  const parts = [
    `${SOFT}${instance?.name || 'Minecraft'}${RESET}`,
    `${LABEL}${loader}${RESET}`,
    `${SOFT}Minecraft ${instance?.version || '?'}${RESET}`,
    `${SOFT}Java ${instance?.javaMajor || '?'}${RESET}`,
    `${SOFT}${instance?.memoryMb || 2048} MB${RESET}`,
  ].join(` ${dot()} `)
  return [
    '',
    ...rows,
    `  ${LABEL}LunarSpace${RESET} ${DIM}${bannerVersion(appVersion)}${RESET}`,
    `  ${parts}`,
    '',
  ].map((line) => `${BANNER_MARK}${line}`)
}

export default LOGO_ROWS
