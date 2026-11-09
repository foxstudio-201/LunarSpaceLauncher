// Bảng màu XyoLauncher — đồng bộ với theme của bản Rust (src/ui/theme.rs).
const XYO_DARK = {
  bg: '#0c0e12',
  bar: '#080a0d',
  surface: '#14171d',
  surfaceActive: '#212630',
  text: '#e8ebf1',
  label: '#99a2b1',
  faint: '#656d7b',
  border: '#242a33',
  borderSoft: '#1b2027',
  input: '#181c23',
  hover: '#1a1e25',
  accent: '#e9b872',
  accentHover: '#f3c98a',
  accentSoft: '#f0c991',
  onAccent: '#1b1409',
  ok: '#22c55e',
  warn: '#f5b84b',
  bad: '#f87171',
  info: '#60a5fa',
  pixel: false,
  ink: '#05070a',
  shadow: '0 14px 34px rgba(0, 0, 0, 0.5)',
  shadowSm: '0 1px 2px rgba(0, 0, 0, 0.3)',
}

const XYO_LIGHT = {
  bg: '#f4f5f8',
  bar: '#ffffff',
  surface: '#ffffff',
  surfaceActive: '#e9ebf1',
  text: '#171a20',
  label: '#5c6472',
  faint: '#8b93a2',
  border: '#dfe3ea',
  borderSoft: '#e9ecf1',
  input: '#f1f2f6',
  hover: '#eef0f4',
  accent: '#c07a2c',
  accentHover: '#a9661f',
  accentSoft: '#b7791f',
  onAccent: '#ffffff',
  ok: '#16a34a',
  warn: '#b77908',
  bad: '#dc2626',
  info: '#2563eb',
  pixel: false,
  ink: '#171a20',
  shadow: '0 12px 28px rgba(0, 0, 0, 0.12)',
  shadowSm: '0 1px 2px rgba(0, 0, 0, 0.12)',
}

const SURFACE_COLOR = {
  'xyo-dark': XYO_DARK.bg,
  'xyo-light': XYO_LIGHT.bg,
}

// Chế độ "nền ảnh": mọi bề mặt là kính mờ, màu cố định (không theo sáng/tối).
const GLASS = {
  bg: 'transparent',
  bar: 'rgba(8, 10, 14, 0.20)',
  surface: 'rgba(10, 13, 19, 0.30)',
  surfaceActive: 'rgba(255, 255, 255, 0.12)',
  text: '#e8ebf1',
  label: 'rgba(232, 235, 241, 0.68)',
  faint: 'rgba(232, 235, 241, 0.42)',
  border: 'rgba(255, 255, 255, 0.10)',
  borderSoft: 'rgba(255, 255, 255, 0.06)',
  input: 'rgba(255, 255, 255, 0.06)',
  hover: 'rgba(255, 255, 255, 0.08)',
  accent: '#e9b872',
  accentHover: '#f3c98a',
  accentSoft: '#f0c991',
  onAccent: '#1b1409',
  ok: '#22c55e',
  warn: '#f5b84b',
  bad: '#f87171',
  info: '#60a5fa',
  pixel: false,
  ink: '#05070a',
  shadow: '0 18px 44px rgba(0, 0, 0, 0.55)',
  shadowSm: '0 1px 2px rgba(0, 0, 0, 0.35)',
}

let backgroundMode = false

export function setBackgroundMode(active) {
  backgroundMode = Boolean(active)
}

export function isBackgroundMode() {
  return backgroundMode
}

const SKIN = 'xyo'

export const currentPaletteSkin = () => SKIN

export function surfaceColor(theme) {
  if (backgroundMode) return 'transparent'
  return SURFACE_COLOR[`${SKIN}-${theme === 'light' ? 'light' : 'dark'}`] || XYO_DARK.bg
}

export function palette(theme) {
  if (backgroundMode) return GLASS
  return theme === 'light' ? XYO_LIGHT : XYO_DARK
}
