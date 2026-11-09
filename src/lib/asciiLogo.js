// Wordmark dạng khối cho XyoLauncher (thay cho logo chữ "XyoLauncher" cũ).
const GLYPHS = {
  X: ['█   █', ' █ █ ', '  █  ', ' █ █ ', '█   █'],
  Y: ['█   █', ' █ █ ', '  █  ', '  █  ', '  █  '],
  O: [' ███ ', '█   █', '█   █', '█   █', ' ███ '],
  L: ['█    ', '█    ', '█    ', '█    ', '█████'],
  A: [' ███ ', '█   █', '█████', '█   █', '█   █'],
  U: ['█   █', '█   █', '█   █', '█   █', ' ███ '],
  N: ['█   █', '██  █', '█ █ █', '█  ██', '█   █'],
  C: [' ████', '█    ', '█    ', '█    ', ' ████'],
  H: ['█   █', '█   █', '█████', '█   █', '█   █'],
  E: ['█████', '█    ', '████ ', '█    ', '█████'],
  R: ['████ ', '█   █', '████ ', '█  █ ', '█   █'],
}

const WORD = 'XYOLAUNCHER'

export const LOGO_ROWS = Array.from({ length: 5 }, (_, row) =>
  WORD.split('')
    .map((ch) => GLYPHS[ch][row])
    .join(' '),
)

const ROW_COLORS = [223, 216, 179, 214, 208]
const RESET = '\x1b[0m'
const DIM = '\x1b[38;5;240m'
const SOFT = '\x1b[38;5;245m'
const LABEL = '\x1b[38;5;179m'

export const BANNER_MARK = '\u200b\u200b'

const dot = () => `${DIM}·${RESET}`

export function bannerVersion(appVersion) {
  return appVersion ? `v${appVersion}` : 'v2.0.0'
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
    `  ${LABEL}XyoLauncher${RESET} ${DIM}${bannerVersion(appVersion)}${RESET}`,
    `  ${parts}`,
    '',
  ].map((line) => `${BANNER_MARK}${line}`)
}

export default LOGO_ROWS
