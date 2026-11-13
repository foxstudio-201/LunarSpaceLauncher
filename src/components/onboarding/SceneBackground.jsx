// Nền thuật toán cho màn hình đăng nhập đầu tiên: bầu trời đêm, sao, dải Ngân Hà,
// mặt trăng, mây trôi, ba lớp núi và mặt biển gợn sóng có phản chiếu.
import { useEffect, useRef } from 'react'

function mulberry32(seed) {
  return function next() {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function ridgeValues(seed, rough) {
  const rnd = mulberry32(seed)
  const n = 96
  const v = new Array(n + 1)
  v[0] = (rnd() - 0.5) * 0.9
  v[n] = (rnd() - 0.5) * 0.9
  let step = n
  let amp = 0.9
  while (step > 1) {
    const half = step >> 1
    for (let i = half; i < n; i += step) v[i] = (v[i - half] + v[i + half]) / 2 + (rnd() - 0.5) * amp
    step = half
    amp *= rough
  }
  return v.map((x) => Math.min(1.15, Math.max(0.02, 0.5 + x)))
}

export default function SceneBackground() {
  const ref = useRef(null)

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return undefined
    const ctx = canvas.getContext('2d')
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    let raf = 0
    let running = false
    let w = 1
    let h = 1
    let t = 0
    let last = 0
    let lastDraw = 0
    let px = 0
    let py = 0
    let tx = 0
    let ty = 0
    let stars = []
    let milky = []
    let clouds = []
    let ridges = []
    let glints = []
    let shoot = { active: false, next: 2.4, t: 0, x: 0.2, y: 0.12, vx: 0.6, vy: 0.2 }
    let sprites = { dot: null, glow: null, cloud: null }

    const makeSprites = () => {
      if (sprites.dot) return
      const dot = document.createElement('canvas')
      dot.width = 24
      dot.height = 24
      let g = dot.getContext('2d')
      let grad = g.createRadialGradient(12, 12, 0, 12, 12, 12)
      grad.addColorStop(0, 'rgba(255,255,255,1)')
      grad.addColorStop(0.28, 'rgba(222,236,255,.85)')
      grad.addColorStop(1, 'rgba(170,205,255,0)')
      g.fillStyle = grad
      g.fillRect(0, 0, 24, 24)

      const glow = document.createElement('canvas')
      glow.width = 128
      glow.height = 128
      g = glow.getContext('2d')
      grad = g.createRadialGradient(64, 64, 0, 64, 64, 64)
      grad.addColorStop(0, 'rgba(255,248,228,.9)')
      grad.addColorStop(0.18, 'rgba(255,240,206,.42)')
      grad.addColorStop(0.52, 'rgba(232,202,142,.11)')
      grad.addColorStop(1, 'rgba(232,202,142,0)')
      g.fillStyle = grad
      g.fillRect(0, 0, 128, 128)

      const cloud = document.createElement('canvas')
      cloud.width = 360
      cloud.height = 140
      g = cloud.getContext('2d')
      const blobs = [
        [70, 88, 64], [140, 70, 72], [220, 84, 62], [292, 94, 50], [180, 98, 70], [112, 98, 54], [250, 104, 44],
      ]
      for (const [bx, by, br] of blobs) {
        const cg = g.createRadialGradient(bx, by, 0, bx, by, br)
        cg.addColorStop(0, 'rgba(196,220,244,.30)')
        cg.addColorStop(0.6, 'rgba(172,202,236,.14)')
        cg.addColorStop(1, 'rgba(162,192,232,0)')
        g.fillStyle = cg
        g.beginPath()
        g.arc(bx, by, br, 0, Math.PI * 2)
        g.fill()
      }
      sprites = { dot, glow, cloud }
    }

    const rebuild = () => {
      const rnd = mulberry32(0x1234abcd + Math.round(w) * 7 + Math.round(h))
      stars = []
      const count = Math.round(Math.min(210, (w * h) / 8200))
      for (let i = 0; i < count; i += 1) {
        stars.push({
          x: rnd(),
          y: Math.pow(rnd(), 1.3) * 0.8,
          s: 0.25 + rnd() * 1.05,
          tw: 0.35 + rnd() * 1.75,
          ph: rnd() * Math.PI * 2,
          big: rnd() < 0.05,
        })
      }
      milky = []
      for (let i = 0; i < 300; i += 1) {
        const u = rnd()
        milky.push({
          x: 0.06 + u * 0.88,
          y: 0.1 + u * 0.52 + (rnd() - 0.5) * 0.11,
          s: 0.35 + rnd() * 1.15,
          a: 0.04 + rnd() * 0.13,
        })
      }
      clouds = [
        { x: 0.06, y: 0.33, s: 1.3, v: 0.0048, a: 0.6 },
        { x: 0.5, y: 0.46, s: 0.92, v: 0.0031, a: 0.44 },
        { x: 0.74, y: 0.26, s: 1.55, v: 0.004, a: 0.34 },
      ]
      ridges = [
        { vals: ridgeValues(11, 0.58), base: 0.655, amp: 0.155, color: '#1e4059', mist: 0.13, depth: 1.4 },
        { vals: ridgeValues(23, 0.54), base: 0.705, amp: 0.115, color: '#112a3f', mist: 0.15, depth: 2.4 },
        { vals: ridgeValues(37, 0.5), base: 0.752, amp: 0.07, color: '#081824', mist: 0.16, depth: 3.4 },
      ]
      glints = []
      for (let i = 0; i < 46; i += 1) {
        glints.push({
          x: rnd(),
          y: Math.pow(rnd(), 1.6),
          s: 1.4 + rnd() * 2.4,
          tw: 0.6 + rnd() * 2.2,
          ph: rnd() * Math.PI * 2,
        })
      }
    }

    const draw = (time) => {
      if (!sprites.dot) makeSprites()
      const horizon = h * 0.742
      const parX = px * 8
      const parY = py * 4
      ctx.clearRect(0, 0, w, h)

      const sky = ctx.createLinearGradient(0, 0, 0, horizon)
      sky.addColorStop(0, '#03060d')
      sky.addColorStop(0.42, '#091422')
      sky.addColorStop(0.72, '#123049')
      sky.addColorStop(1, '#1d4b63')
      ctx.fillStyle = sky
      ctx.fillRect(0, 0, w, horizon + 2)

      for (const d of milky) {
        ctx.globalAlpha = d.a
        const sz = d.s * 6
        ctx.drawImage(sprites.dot, d.x * w - sz / 2, d.y * h - sz / 2, sz, sz)
      }
      ctx.globalAlpha = 1

      for (const st of stars) {
        const twinkle = 0.5 + 0.5 * Math.sin(time * st.tw + st.ph)
        ctx.globalAlpha = 0.3 + 0.7 * twinkle
        const sz = st.big ? st.s * 7 : st.s * 3.6
        ctx.drawImage(sprites.dot, st.x * w - sz / 2, st.y * h - sz / 2, sz, sz)
      }
      ctx.globalAlpha = 1

      if (shoot.active) {
        const k = shoot.t
        const sx = (shoot.x + shoot.vx * k) * w
        const sy = (shoot.y + shoot.vy * k) * h
        const fade = Math.min(1, k * 5) * Math.max(0, 1 - Math.max(0, k - 0.65) / 0.55)
        if (fade > 0.01) {
          const tail = 110 * Math.min(1, k * 3.2)
          const trail = ctx.createLinearGradient(sx - tail, sy - tail * 0.36, sx, sy)
          trail.addColorStop(0, 'rgba(255,255,255,0)')
          trail.addColorStop(0.72, `rgba(214,236,255,${0.42 * fade})`)
          trail.addColorStop(1, `rgba(255,255,255,${0.9 * fade})`)
          ctx.strokeStyle = trail
          ctx.lineWidth = 1.7
          ctx.lineCap = 'round'
          ctx.beginPath()
          ctx.moveTo(sx - tail, sy - tail * 0.36)
          ctx.lineTo(sx, sy)
          ctx.stroke()
        }
      }

      const mx = w * 0.775 + parX * 0.55
      const my = h * 0.235 + parY * 0.55
      const mr = Math.min(w, h) * 0.037
      ctx.drawImage(sprites.glow, mx - mr * 6, my - mr * 6, mr * 12, mr * 12)
      const moon = ctx.createRadialGradient(mx - mr * 0.35, my - mr * 0.4, mr * 0.12, mx, my, mr)
      moon.addColorStop(0, '#fffdf5')
      moon.addColorStop(0.55, '#f5ecd6')
      moon.addColorStop(1, '#dccaa8')
      ctx.fillStyle = moon
      ctx.beginPath()
      ctx.arc(mx, my, mr, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = 'rgba(150,130,100,.16)'
      for (const [dx, dy, cr] of [[-0.3, -0.08, 0.22], [0.26, 0.18, 0.16], [-0.05, 0.44, 0.11], [0.42, -0.36, 0.09]]) {
        ctx.beginPath()
        ctx.arc(mx + dx * mr, my + dy * mr, cr * mr, 0, Math.PI * 2)
        ctx.fill()
      }

      for (const cl of clouds) {
        const x = ((((cl.x + time * cl.v) % 1.4) + 1.4) % 1.4 - 0.22) * w + parX * 0.8
        const size = 360 * cl.s
        ctx.globalAlpha = cl.a
        ctx.drawImage(sprites.cloud, x, cl.y * h + parY * 0.8, size, size * (140 / 360))
      }
      ctx.globalAlpha = 1

      const haze = ctx.createLinearGradient(0, horizon - h * 0.1, 0, horizon + h * 0.02)
      haze.addColorStop(0, 'rgba(30,80,110,0)')
      haze.addColorStop(0.72, 'rgba(122,192,212,.15)')
      haze.addColorStop(1, 'rgba(233,184,114,.10)')
      ctx.fillStyle = haze
      ctx.fillRect(0, horizon - h * 0.1, w, h * 0.12)

      for (const layer of ridges) {
        ctx.beginPath()
        ctx.moveTo(0, h)
        const n = layer.vals.length - 1
        for (let i = 0; i <= n; i += 1) {
          const x = (i / n) * w + parX * layer.depth * 0.5
          const y = h * layer.base - layer.vals[i] * h * layer.amp
          ctx.lineTo(x, y)
        }
        ctx.lineTo(w, h)
        ctx.closePath()
        ctx.fillStyle = layer.color
        ctx.fill()
        const mg = ctx.createLinearGradient(0, h * layer.base - h * layer.amp, 0, h * layer.base)
        mg.addColorStop(0, 'rgba(160,210,230,0)')
        mg.addColorStop(0.72, `rgba(152,202,226,${layer.mist})`)
        mg.addColorStop(1, 'rgba(152,202,226,0)')
        ctx.fillStyle = mg
        ctx.fillRect(0, h * layer.base - h * layer.amp, w, h * layer.amp)
      }

      const water = ctx.createLinearGradient(0, horizon, 0, h)
      water.addColorStop(0, '#0d2c40')
      water.addColorStop(0.34, '#081b2a')
      water.addColorStop(1, '#030b12')
      ctx.fillStyle = water
      ctx.fillRect(0, horizon, w, h - horizon)

      const edge = ctx.createLinearGradient(0, 0, w, 0)
      edge.addColorStop(0, 'rgba(233,184,114,0)')
      edge.addColorStop(0.42, 'rgba(190,225,240,.20)')
      edge.addColorStop(0.76, 'rgba(233,184,114,.30)')
      edge.addColorStop(1, 'rgba(233,184,114,0)')
      ctx.fillStyle = edge
      ctx.fillRect(0, horizon - 0.7, w, 1.4)

      const refW = Math.max(10, mr * 1.7)
      for (let i = 0; i < 26; i += 1) {
        const f = i / 26
        const yy = horizon + Math.pow(f, 1.5) * (h - horizon)
        const spread = 0.35 + f
        const alpha = 0.2 * (1 - f) * (0.55 + 0.45 * Math.sin(time * 1.6 + i * 0.9))
        if (alpha <= 0.004) continue
        const xx = mx + Math.sin(time * 0.8 + i * 0.7) * (5 + i * 1.3)
        ctx.globalAlpha = alpha
        ctx.fillStyle = '#f3e6c4'
        ctx.fillRect(xx - (refW * spread) / 2, yy, refW * spread, 1.25)
      }
      ctx.globalAlpha = 1

      ctx.lineWidth = 1
      for (let i = 0; i < 24; i += 1) {
        const f = i / 24
        const yy = horizon + Math.pow(f, 1.7) * (h - horizon)
        ctx.strokeStyle = `rgba(158,216,236,${0.02 + f * 0.055})`
        ctx.beginPath()
        for (let x = 0; x <= w; x += 30) {
          const y2 = yy + Math.sin(x * 0.006 + time * (0.45 + f * 0.75) + i * 1.3) * (1.3 + f * 2.6)
          if (x === 0) ctx.moveTo(x, y2)
          else ctx.lineTo(x, y2)
        }
        ctx.stroke()
      }

      for (const gl of glints) {
        const sparkle = Math.max(0, Math.sin(time * gl.tw + gl.ph))
        const alpha = 0.04 + sparkle * 0.34
        if (alpha < 0.05) continue
        ctx.globalAlpha = alpha
        const yy = horizon + gl.y * (h - horizon)
        ctx.drawImage(sprites.dot, gl.x * w, yy, gl.s * 2.2, gl.s)
      }
      ctx.globalAlpha = 1

      const vig = ctx.createRadialGradient(w * 0.5, h * 0.45, Math.min(w, h) * 0.2, w * 0.5, h * 0.45, Math.max(w, h) * 0.8)
      vig.addColorStop(0, 'rgba(0,0,0,0)')
      vig.addColorStop(1, 'rgba(2,5,9,.62)')
      ctx.fillStyle = vig
      ctx.fillRect(0, 0, w, h)

      const scrim = ctx.createLinearGradient(0, 0, w * 0.66, 0)
      scrim.addColorStop(0, 'rgba(3,7,12,.74)')
      scrim.addColorStop(0.55, 'rgba(3,7,12,.28)')
      scrim.addColorStop(1, 'rgba(3,7,12,0)')
      ctx.fillStyle = scrim
      ctx.fillRect(0, 0, w * 0.66, h)
    }

    const frame = (now) => {
      raf = 0
      if (!last) last = now
      const dt = Math.min(0.05, (now - last) / 1000)
      last = now
      if (document.hidden) {
        raf = requestAnimationFrame(frame)
        return
      }
      if (now - lastDraw < 21) {
        raf = requestAnimationFrame(frame)
        return
      }
      lastDraw = now
      t += dt
      px += (tx - px) * 0.045
      py += (ty - py) * 0.045
      if (shoot.active) {
        shoot.t += dt
        if (shoot.t > 1.25) {
          shoot.active = false
          shoot.next = 4.5 + Math.random() * 5.5
        }
      } else {
        shoot.next -= dt
        if (shoot.next <= 0) {
          shoot.active = true
          shoot.t = 0
          shoot.x = 0.12 + Math.random() * 0.45
          shoot.y = 0.07 + Math.random() * 0.2
          shoot.vx = 0.5 + Math.random() * 0.28
          shoot.vy = 0.16 + Math.random() * 0.1
        }
      }
      draw(t)
      raf = requestAnimationFrame(frame)
    }

    const start = () => {
      if (reduced || running) return
      running = true
      last = 0
      raf = requestAnimationFrame(frame)
    }
    const stop = () => {
      running = false
      if (raf) cancelAnimationFrame(raf)
      raf = 0
    }

    const resize = () => {
      const rect = canvas.getBoundingClientRect()
      w = Math.max(1, rect.width)
      h = Math.max(1, rect.height)
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      canvas.width = Math.round(w * dpr)
      canvas.height = Math.round(h * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      rebuild()
      draw(t)
    }

    const onPointer = (event) => {
      if (reduced) return
      const x = (event.clientX / Math.max(1, window.innerWidth)) * 2 - 1
      const y = (event.clientY / Math.max(1, window.innerHeight)) * 2 - 1
      tx = Math.max(-1, Math.min(1, x))
      ty = Math.max(-1, Math.min(1, y))
    }
    const onVisibility = () => {
      if (document.hidden) stop()
      else start()
    }

    const observer = new ResizeObserver(resize)
    observer.observe(canvas)
    resize()
    start()
    window.addEventListener('pointermove', onPointer)
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      stop()
      observer.disconnect()
      window.removeEventListener('pointermove', onPointer)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [])

  return <canvas ref={ref} className="onb-scene" aria-hidden="true" />
}
