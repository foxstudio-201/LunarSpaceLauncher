import { useCallback, useEffect, useRef, useState } from 'react'
import Preloader from './Preloader'
import SplitReveal from './onboarding/SplitReveal'
import { palette } from '../lib/palette'

// Splash: 156 frame JPEG 1280x720 @30fps. Frames are fetched one by one and
// turned into ImageBitmaps that are explicitly closed once passed, so Blink's
// image cache never holds all 156 decoded frames (~100MB RSS).
const FRAME_COUNT = 156
const FPS = 30
const FRAME_MS = 1000 / FPS
const PRELOAD_AHEAD = 6
const frameUrl = (index) => `./splash/frame_${String(index).padStart(3, '0')}.jpg`

function CanvasFrames({ dim, onDone, onFail }) {
  const ref = useRef(null)

  useEffect(() => {
    const cv = ref.current
    if (!cv) return undefined
    const ctx = cv.getContext('2d', { alpha: false })
    if (!ctx || typeof createImageBitmap !== 'function') {
      onFail()
      return undefined
    }

    let disposed = false
    let ended = false
    let raf = 0
    let shown = 0
    const bitmaps = new Map()
    const pending = new Map()
    const startedAt = performance.now()
    const total = FRAME_COUNT * FRAME_MS

    const dpr = () => 1
    const size = () => {
      const scale = dpr()
      cv.width = Math.max(1, Math.round(window.innerWidth * scale))
      cv.height = Math.max(1, Math.round(window.innerHeight * scale))
    }
    size()

    const draw = (bmp) => {
      if (!bmp) return
      const W = cv.width
      const H = cv.height
      const iw = bmp.width
      const ih = bmp.height
      const scale = Math.max(W / iw, H / ih)
      const w = iw * scale
      const h = ih * scale
      ctx.drawImage(bmp, (W - w) / 2, (H - h) / 2, w, h)
    }

    const release = (keep) => {
      for (const [index, bmp] of bitmaps) {
        if (index < keep - 3) {
          bmp.close?.()
          bitmaps.delete(index)
        }
      }
    }

    const load = (index) => {
      if (index < 1 || index > FRAME_COUNT) return Promise.resolve(null)
      if (bitmaps.has(index)) return Promise.resolve(bitmaps.get(index))
      if (pending.has(index)) return pending.get(index)
      const bytes =
        window.electronAPI?.splashFrame
          ? window.electronAPI.splashFrame(index)
          : fetch(frameUrl(index), { cache: 'no-store' }).then((res) => {
              if (!res.ok) throw new Error(`frame ${index}`)
              return res.arrayBuffer()
            })
      const job = Promise.resolve(bytes)
        .then((data) => {
          if (!data) throw new Error(`frame ${index}`)
          const view = data instanceof Uint8Array ? data : new Uint8Array(data)
          return createImageBitmap(new Blob([view], { type: 'image/jpeg' }))
        })
        .then((bmp) => {
          pending.delete(index)
          if (disposed || ended) {
            bmp.close?.()
            return null
          }
          bitmaps.set(index, bmp)
          release(shown)
          if (index === shown) draw(bmp)
          return bmp
        })
        .catch(() => {
          pending.delete(index)
          if (index === 1 && !ended) onFail()
          return null
        })
      pending.set(index, job)
      return job
    }

    const finish = () => {
      if (ended) return
      ended = true
      if (raf) cancelAnimationFrame(raf)
      for (const bmp of bitmaps.values()) bmp.close?.()
      bitmaps.clear()
      pending.clear()
      // Drop the canvas backing store immediately; the preloader covers the
      // screen for the next ~1.25s, so the splash surface is no longer needed.
      cv.width = 1
      cv.height = 1
      onDone()
    }

    const timer = setTimeout(finish, total)

    const tick = (now) => {
      if (ended) return
      const elapsed = now - startedAt
      const index = Math.min(FRAME_COUNT, Math.floor(elapsed / FRAME_MS) + 1)
      if (index !== shown) {
        shown = index
        const bmp = bitmaps.get(index)
        if (bmp) draw(bmp)
        load(index)
        for (let k = index + 1; k <= index + PRELOAD_AHEAD; k += 1) load(k)
      }
      if (elapsed >= total) {
        finish()
        return
      }
      raf = requestAnimationFrame(tick)
    }

    load(1).then((bmp) => {
      if (ended || disposed || !bmp) return
      shown = 1
      draw(bmp)
      for (let k = 2; k <= 1 + PRELOAD_AHEAD; k += 1) load(k)
      raf = requestAnimationFrame(tick)
    })

    const onResize = () => {
      size()
      const bmp = bitmaps.get(shown)
      if (bmp) draw(bmp)
    }
    window.addEventListener('resize', onResize)

    return () => {
      disposed = true
      clearTimeout(timer)
      if (raf) cancelAnimationFrame(raf)
      window.removeEventListener('resize', onResize)
      for (const bmp of bitmaps.values()) bmp.close?.()
      bitmaps.clear()
    }
  }, [onDone, onFail])

  return (
    <canvas
      ref={ref}
      aria-hidden
      className="absolute inset-0 h-full w-full"
      style={{ opacity: dim ? 0 : 1, transition: 'opacity 280ms ease', pointerEvents: 'none' }}
    />
  )
}

function StaticFallback({ dim, onDone }) {
  useEffect(() => {
    const timer = setTimeout(onDone, FRAME_COUNT * FRAME_MS)
    return () => clearTimeout(timer)
  }, [onDone])
  return (
    <img
      src="./splash/frame_001.jpg"
      alt=""
      aria-hidden
      draggable={false}
      className="absolute inset-0 h-full w-full object-cover"
      style={{ opacity: dim ? 0 : 1, transition: 'opacity 280ms ease', pointerEvents: 'none' }}
    />
  )
}

export default function SplashScreen({ theme, lang, hold = false, onComplete }) {
  const c = palette(theme)
  const [phase, setPhase] = useState('video')
  const [mode, setMode] = useState('canvas')
  const finishFrames = useCallback(() => setPhase('loading'), [])
  const canvasFailed = useCallback(() => setMode('static'), [])

  useEffect(() => {
    document.getElementById('boot-splash')?.remove()
  }, [])

  useEffect(() => {
    if (phase !== 'reveal') return undefined
    document.documentElement.setAttribute('xyo-reveal', 'on')
    return () => document.documentElement.removeAttribute('xyo-reveal')
  }, [phase])

  // Loading chạy xong (chữ/% đã mờ hẳn) mới chuyển sang bước tách màn riêng.
  const finishLoading = useCallback(() => {
    if (hold) onComplete?.()
    else setPhase('reveal')
  }, [hold, onComplete])

  const inkBase = theme === 'light' ? c.ink : c.bg
  const ink = !inkBase || inkBase === 'transparent' ? (theme === 'light' ? '#171a20' : '#0c0e12') : inkBase

  return (
    <div
      className="fixed inset-0 z-[100] overflow-hidden"
      style={{ background: phase === 'reveal' ? 'transparent' : '#0c0e12' }}
    >
      {mode === 'canvas' && (
        <CanvasFrames dim={phase !== 'video'} onDone={finishFrames} onFail={canvasFailed} />
      )}
      {mode === 'static' && <StaticFallback dim={phase !== 'video'} onDone={finishFrames} />}

      {phase === 'loading' && (
        <Preloader theme={theme} lang={lang} onComplete={finishLoading} />
      )}
      {phase === 'reveal' && (
        <SplitReveal ink={ink} holdMs={150} onComplete={onComplete} />
      )}
    </div>
  )
}
