import { useEffect, useRef, useState } from 'react'
import Preloader from './Preloader'

// Splash lấy nguyên từ bản Rust: 156 frame JPEG 1280x720 phát 30fps,
// hết frame thì chuyển sang preloader đếm % (Lucian #256) rồi tách đôi trượt ra.
const FRAME_COUNT = 156
const FPS = 30
const FRAME_MS = 1000 / FPS
const PRELOAD_AHEAD = 8

const frameUrl = (index) => `./splash/frame_${String(index).padStart(3, '0')}.jpg`

export default function SplashScreen({ theme, lang, onComplete }) {
  const frameRef = useRef(null)
  const [phase, setPhase] = useState('video')
  const [splitStarted, setSplitStarted] = useState(false)

  useEffect(() => {
    document.getElementById('boot-splash')?.remove()
  }, [])

  useEffect(() => {
    const img = frameRef.current
    if (!img) return undefined

    const warm = new Map()
    const preload = (index) => {
      if (index < 1 || index > FRAME_COUNT || warm.has(index)) return
      const el = new Image()
      el.src = frameUrl(index)
      warm.set(index, el)
      for (const key of warm.keys()) {
        if (key < index - 3) warm.delete(key)
      }
    }

    for (let i = 1; i <= PRELOAD_AHEAD; i += 1) preload(i)

    const startedAt = performance.now()
    let shown = 1
    let raf = 0
    let ended = false

    const finish = () => {
      if (ended) return
      ended = true
      if (raf) cancelAnimationFrame(raf)
      setPhase('loading')
    }
    // rAF có thể bị Chromium hạ tần số; timer này bảo đảm chuyển màn đúng 5.2s.
    const finishTimer = setTimeout(finish, FRAME_COUNT * FRAME_MS)

    const tick = (now) => {
      if (ended) return
      const index = Math.min(FRAME_COUNT, Math.floor((now - startedAt) / FRAME_MS) + 1)
      if (index !== shown) {
        shown = index
        img.src = frameUrl(index)
        for (let k = index + 1; k <= index + PRELOAD_AHEAD; k += 1) preload(k)
      }
      if ((now - startedAt) >= FRAME_COUNT * FRAME_MS) {
        finish()
        return
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)

    return () => {
      clearTimeout(finishTimer)
      if (raf) cancelAnimationFrame(raf)
      warm.clear()
    }
  }, [])

  const loading = phase === 'loading'

  return (
    <div
      className="fixed inset-0 z-[100] overflow-hidden"
      style={{
        background: splitStarted ? 'transparent' : '#0c0e12',
        transition: 'background 0s linear',
      }}
    >
      <img
        ref={frameRef}
        src={frameUrl(1)}
        alt=""
        aria-hidden
        draggable={false}
        className="absolute inset-0 h-full w-full object-cover"
        style={{
          opacity: loading ? 0 : 1,
          transition: 'opacity 280ms ease',
          pointerEvents: 'none',
        }}
      />

      {loading && (
        <Preloader
          theme={theme}
          lang={lang}
          onOpen={() => setSplitStarted(true)}
          onComplete={onComplete}
        />
      )}
    </div>
  )
}
