// Lucian UX/UI Prompt #378 · MIT License (c) 2026 Seokwoooo · https://lucianlabs.dev/uxui-prompt/#378
import { useEffect, useRef } from 'react'

const WORDS = ['XyoLauncher', 'Almost ready', 'Minecraft']
const STEP = 2
const MAX_PARTICLES = 1500

/**
 * Hàng trăm hạt sáng bay vào xếp thành chữ, rê chuột thì bị đẩy ra,
 * bấm (hoặc tự động) thì bay sang chữ kế tiếp.
 */
export default function ParticleWord({ words = WORDS, intervalMs = 2600 }) {
  const canvasRef = useRef(null)
  const stateRef = useRef({ wi: 0, timer: 0, ptr: null })

  useEffect(() => {
    const cv = canvasRef.current
    if (!cv) return undefined
    const cx = cv.getContext('2d')
    const reduced =
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches

    let W = 420
    let H = 200
    let dpr = Math.min(2, window.devicePixelRatio || 1)
    const P = []

    const sizeCanvas = () => {
      const rect = cv.getBoundingClientRect()
      W = Math.max(200, Math.round(rect.width) || 420)
      H = Math.max(120, Math.round(rect.height) || 200)
      dpr = Math.min(2, window.devicePixelRatio || 1)
      cv.width = W * dpr
      cv.height = H * dpr
      cx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    sizeCanvas()

    // Vẽ chữ vào canvas phụ để lấy điểm, cỡ chữ co theo bề ngang để chữ to và vừa khung.
    const targets = (word) => {
      const o = document.createElement('canvas')
      o.width = W
      o.height = H
      const c = o.getContext('2d')
      let size = Math.min(160, Math.floor(H * 0.86))
      c.font = `900 ${size}px system-ui,-apple-system,"Segoe UI",sans-serif`
      const measured = c.measureText(word).width || 1
      if (measured > W * 0.96) size = Math.max(18, Math.floor(size * ((W * 0.96) / measured)))
      c.fillStyle = '#fff'
      c.font = `900 ${size}px system-ui,-apple-system,"Segoe UI",sans-serif`
      c.textAlign = 'center'
      c.textBaseline = 'middle'
      c.fillText(word, W / 2, H / 2)

      const d = c.getImageData(0, 0, W, H).data
      const pts = []
      for (let y = 0; y < H; y += STEP) {
        for (let x = 0; x < W; x += STEP) {
          if (d[(y * W + x) * 4 + 3] > 128) pts.push([x, y])
        }
      }
      for (let k = pts.length - 1; k > 0; k -= 1) {
        const j = (Math.random() * (k + 1)) | 0
        const t = pts[k]
        pts[k] = pts[j]
        pts[j] = t
      }
      return pts
    }

    const spawn = (x, y) => ({
      x,
      y,
      vx: 0,
      vy: 0,
      tx: x,
      ty: y,
      h: 250 + Math.random() * 80,
    })

    const assign = () => {
      const pts = targets(words[stateRef.current.wi % words.length]).slice(0, MAX_PARTICLES)
      // Chỉ dùng đúng số hạt cho các điểm của chữ — không còn hạt bay vòng quanh.
      while (P.length < pts.length) P.push(spawn(Math.random() * W, Math.random() * H))
      P.length = pts.length
      P.forEach((p, i) => {
        p.tx = pts[i][0] + (Math.random() - 0.5) * 1.5
        p.ty = pts[i][1] + (Math.random() - 0.5) * 1.5
      })
    }

    const draw = () => {
      cx.clearRect(0, 0, W, H)
      cx.globalCompositeOperation = 'lighter'
      P.forEach((p) => {
        const sp = Math.min(1, Math.hypot(p.vx, p.vy) / 300)
        cx.fillStyle = `hsla(${(p.h - sp * 60).toFixed(0)},92%,${(74 + sp * 18).toFixed(0)}%,0.95)`
        cx.fillRect(p.x - 1.5, p.y - 1.5, 3, 3)
      })
      cx.globalCompositeOperation = 'source-over'
    }

    let vis = true
    let raf = 0
    let last = 0

    const frame = (now) => {
      raf = 0
      if (!vis) return
      const dt = Math.min(0.033, Math.max(0, (now - last) / 1000))
      last = now
      P.forEach((p) => {
        let ax = (p.tx - p.x) * 38 - p.vx * 7.5
        let ay = (p.ty - p.y) * 38 - p.vy * 7.5
        const ptr = stateRef.current.ptr
        if (ptr) {
          const dx = p.x - ptr.x
          const dy = p.y - ptr.y
          const d2 = dx * dx + dy * dy
          if (d2 < 3600) {
            const f = ((1 - d2 / 3600) * 9000) / (Math.sqrt(d2) + 6)
            ax += (dx * f) / 40
            ay += (dy * f) / 40
          }
        }
        p.vx += ax * dt
        p.vy += ay * dt
        p.x += p.vx * dt
        p.y += p.vy * dt
      })
      draw()
      raf = requestAnimationFrame(frame)
    }

    const run = () => {
      if (reduced) {
        P.forEach((p) => {
          p.x = p.tx
          p.y = p.ty
        })
        draw()
        return
      }
      if (!raf && vis) {
        last = performance.now()
        raf = requestAnimationFrame(frame)
      }
    }

    const nextWord = () => {
      stateRef.current.wi = (stateRef.current.wi + 1) % words.length
      assign()
      P.forEach((p) => {
        p.vx += (Math.random() - 0.5) * 260
        p.vy += (Math.random() - 0.5) * 260
      })
      run()
    }

    const loc = (event) => {
      const r = cv.getBoundingClientRect()
      return { x: (event.clientX - r.left) * (W / (r.width || 1)), y: (event.clientY - r.top) * (H / (r.height || 1)) }
    }
    const onMove = (event) => {
      stateRef.current.ptr = loc(event)
    }
    const onLeave = () => {
      stateRef.current.ptr = null
    }
    const onClick = () => nextWord()

    cv.addEventListener('pointermove', onMove)
    cv.addEventListener('pointerleave', onLeave)
    cv.addEventListener('click', onClick)

    let io = null
    if ('IntersectionObserver' in window) {
      io = new IntersectionObserver((entries) => {
        vis = entries[0].isIntersecting
        if (vis) run()
      })
      io.observe(cv)
    }

    const onResize = () => {
      sizeCanvas()
      assign()
      run()
    }
    window.addEventListener('resize', onResize)

    assign()
    run()
    stateRef.current.timer = window.setInterval(nextWord, intervalMs)

    return () => {
      window.clearInterval(stateRef.current.timer)
      if (raf) cancelAnimationFrame(raf)
      io?.disconnect()
      window.removeEventListener('resize', onResize)
      cv.removeEventListener('pointermove', onMove)
      cv.removeEventListener('pointerleave', onLeave)
      cv.removeEventListener('click', onClick)
    }
  }, [words, intervalMs])

  return (
    <div className="u378">
      <style>{`
.u378{position:relative;width:100%;height:100%;overflow:hidden}
.u378-cv{position:absolute;inset:0;width:100%;height:100%;touch-action:none;cursor:pointer;pointer-events:auto}
      `}</style>
      <canvas
        ref={canvasRef}
        className="u378-cv"
        role="img"
        aria-label="XyoLauncher, Almost ready, Minecraft — hạt sáng xếp thành chữ"
      />
    </div>
  )
}
