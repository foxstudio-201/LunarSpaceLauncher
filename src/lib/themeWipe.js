const REVEAL_MS = 620
const FADE_MS = 260
const LAYER_ID = 'lunaspace-theme-wipe'

let running = false

export function themeWipe(color, apply) {
  const doc = typeof document !== 'undefined' ? document : null
  if (running || !doc || !doc.body || typeof doc.body.animate !== 'function') {
    apply()
    return
  }
  running = true
  doc.documentElement.setAttribute('data-wiping', '')

  const w = window.innerWidth
  const h = window.innerHeight
  const cx = w * 0.5 - Math.min(72, w * 0.06)
  const cy = h * 0.5 + Math.min(52, h * 0.075)
  const start = 28
  const far = Math.max(
    Math.hypot(cx, cy),
    Math.hypot(w - cx, cy),
    Math.hypot(cx, h - cy),
    Math.hypot(w - cx, h - cy),
  )
  const end = far * 1.16

  const layer = doc.createElement('div')
  layer.id = LAYER_ID
  layer.setAttribute('aria-hidden', 'true')
  layer.style.cssText = 'position:fixed;inset:0;z-index:0;pointer-events:none;overflow:hidden'

  const disc = doc.createElement('div')
  disc.style.cssText =
    `position:absolute;left:${cx}px;top:${cy}px;width:${end * 2}px;height:${end * 2}px;` +
    `margin-left:${-end}px;margin-top:${-end}px;border-radius:50%;will-change:transform;` +
    `transform:scale(${start / end});` +
    `background:radial-gradient(circle closest-side, ${color} 0%, ${color} 74%, ${color}00 100%)`
  layer.appendChild(disc)
  doc.body.insertBefore(layer, doc.body.firstChild)

  let settled = false
  const cleanup = () => {
    if (settled) return
    settled = true
    layer.remove()
    doc.documentElement.removeAttribute('data-wiping')
    running = false
  }

  let grow
  try {
    grow = disc.animate(
      [{ transform: `scale(${start / end})` }, { transform: 'scale(1)' }],
      { duration: REVEAL_MS, easing: 'cubic-bezier(0.33, 0, 0.2, 1)', fill: 'forwards' },
    )
  } catch {
    cleanup()
    apply()
    return
  }

  grow.onfinish = () => {
    apply()
    try {
      const out = layer.animate([{ opacity: 1 }, { opacity: 0 }], {
        duration: FADE_MS,
        easing: 'ease-out',
        fill: 'forwards',
      })
      out.onfinish = cleanup
    } catch {
      cleanup()
    }
    setTimeout(cleanup, FADE_MS + 400)
  }
  setTimeout(() => {
    if (running && !settled) {
      apply()
      cleanup()
    }
  }, REVEAL_MS + FADE_MS + 700)
}
