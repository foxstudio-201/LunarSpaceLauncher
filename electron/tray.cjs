const { app, Tray, Menu, nativeImage } = require('electron')
const path = require('path')
const fs = require('fs')

const TEXT = {
  vi: {
    open: 'Mở LunarSpace Launcher',
    hide: 'Ẩn launcher',
    quit: 'Thoát LunarSpace',
    playing: 'Đang chơi',
  },
  en: {
    open: 'Open LunarSpace Launcher',
    hide: 'Hide launcher',
    quit: 'Quit LunarSpace',
    playing: 'Playing',
  },
}

let tray = null
let handlers = { getWindow: () => null, getRunning: () => [], getLang: () => 'vi', onQuit: () => app.quit() }

function iconPath() {
  const packaged = path.join(process.resourcesPath || '', 'icon.png')
  if (packaged && fs.existsSync(packaged)) return packaged
  return path.join(__dirname, '..', 'public', 'icon.png')
}

function buildMenu() {
  const lang = handlers.getLang() === 'en' ? 'en' : 'vi'
  const t = TEXT[lang]
  const win = handlers.getWindow()
  const visible = !!win && !win.isDestroyed() && win.isVisible()
  const running = handlers.getRunning()
  const items = []
  if (running.length) items.push({ label: `${t.playing}: ${running.join(', ')}`, enabled: false })
  items.push({ label: visible ? t.hide : t.open, click: () => toggle() })
  items.push({ type: 'separator' })
  items.push({ label: t.quit, click: () => handlers.onQuit() })
  return Menu.buildFromTemplate(items)
}

function toggle() {
  const win = handlers.getWindow()
  if (!win || win.isDestroyed()) return
  if (win.isVisible()) handlers.onHide()
  else handlers.onShow()
  refresh()
}

function create(options = {}) {
  handlers = { ...handlers, ...options }
  if (tray) return tray
  try {
    const image = nativeImage.createFromPath(iconPath())
    tray = new Tray(image.isEmpty() ? nativeImage.createEmpty() : image.resize({ width: 16, height: 16 }))
  } catch (err) {
    console.error('[lunaspace] tray failed:', err?.message || err)
    return null
  }
  tray.setToolTip('LunarSpace Launcher')
  tray.setContextMenu(buildMenu())
  tray.on('click', () => toggle())
  tray.on('double-click', () => handlers.onShow())
  return tray
}

function refresh() {
  if (!tray || tray.isDestroyed()) return
  const running = handlers.getRunning()
  tray.setToolTip(running.length ? `LunarSpace Launcher · ${TEXT[handlers.getLang() === 'en' ? 'en' : 'vi'].playing}: ${running.join(', ')}` : 'LunarSpace Launcher')
  tray.setContextMenu(buildMenu())
}

function destroy() {
  if (tray && !tray.isDestroyed()) tray.destroy()
  tray = null
}

module.exports = { create, refresh, destroy }
