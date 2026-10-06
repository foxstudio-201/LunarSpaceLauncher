const DARK = {
  bg: '#0a0a0a',
  bar: '#0d0d10',
  surface: '#101014',
  text: '#ffffff',
  label: 'rgba(255,255,255,0.6)',
  faint: 'rgba(255,255,255,0.35)',
  border: 'rgba(255,255,255,0.08)',
  input: 'rgba(255,255,255,0.05)',
  hover: 'rgba(255,255,255,0.06)',
  accent: '#a78bfa',
  pixel: false,
  ink: '#000000',
  shadow: '0 14px 34px rgba(0,0,0,0.42)',
  shadowSm: '0 1px 2px rgba(0,0,0,0.25)',
}

const LIGHT = {
  bg: '#f0eff0',
  bar: '#f0eff0',
  surface: '#ffffff',
  text: '#111111',
  label: '#555555',
  faint: 'rgba(0,0,0,0.4)',
  border: 'rgba(0,0,0,0.08)',
  input: 'rgba(0,0,0,0.04)',
  hover: 'rgba(0,0,0,0.04)',
  accent: '#8b5cf6',
  pixel: false,
  ink: '#111111',
  shadow: '0 12px 28px rgba(0,0,0,0.12)',
  shadowSm: '0 1px 2px rgba(0,0,0,0.12)',
}

const dither = (color, opacity) =>
  `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='4' height='4'%3E%3Cg fill='${encodeURIComponent(color)}' fill-opacity='${opacity}'%3E%3Crect width='2' height='2'/%3E%3Crect x='2' y='2' width='2' height='2'/%3E%3C/g%3E%3C/svg%3E")`

const PIXEL_DARK = {
  bg: '#0a0d12',
  bar: '#0f131a',
  surface: `${dither('#9fb4cc', '0.05')} #171c24`,
  text: '#e6ebf2',
  label: '#9fabb8',
  faint: '#7b8794',
  border: '#39434f',
  input: '#1f252e',
  hover: '#262d38',
  accent: '#7ba3cc',
  pixel: true,
  ink: '#04060a',
  shadow: '3px 3px 0 0 #04060a',
  shadowSm: '2px 2px 0 0 #04060a',
}

const PIXEL_LIGHT = {
  bg: '#edf2f9',
  bar: '#e4ebf5',
  surface: `${dither('#1d4ed8', '0.06')} #ffffff`,
  text: '#0d1728',
  label: '#3c5273',
  faint: '#61779a',
  border: '#1b3458',
  input: '#dde6f2',
  hover: '#d2ddec',
  accent: '#1d4ed8',
  pixel: true,
  ink: '#1b3458',
  shadow: '3px 3px 0 0 #1b3458',
  shadowSm: '2px 2px 0 0 #1b3458',
}

const SURFACE_COLOR = {
  'default-dark': DARK.bg,
  'default-light': LIGHT.bg,
  'pixel-dark': PIXEL_DARK.bg,
  'pixel-light': PIXEL_LIGHT.bg,
}

let currentSkin = 'default'

const domSkin = () => {
  if (typeof document === 'undefined') return currentSkin
  return document.documentElement.getAttribute('data-skin') === 'pixel' ? 'pixel' : 'default'
}

export function setPaletteSkin(skin) {
  currentSkin = skin === 'pixel' ? 'pixel' : 'default'
  if (typeof document !== 'undefined') {
    document.documentElement.setAttribute('data-skin', currentSkin)
  }
}

export function currentPaletteSkin() {
  return domSkin()
}

export function surfaceColor(theme, skin = domSkin()) {
  return SURFACE_COLOR[`${skin}-${theme === 'light' ? 'light' : 'dark'}`] || DARK.bg
}

export function palette(theme) {
  if (domSkin() === 'pixel') return theme === 'light' ? PIXEL_LIGHT : PIXEL_DARK
  return theme === 'light' ? LIGHT : DARK
}
