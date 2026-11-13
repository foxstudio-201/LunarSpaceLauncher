// Lucian UX/UI Prompt #256 · MIT License (c) 2026 Seokwoooo · https://lucianlabs.dev/uxui-prompt/#256
import { useEffect, useRef, useState } from 'react'
import { palette } from '../lib/palette'
import ParticleWord from './ParticleWord'

const REVEAL_ATTR = 'xyo-reveal'

/**
 * Màn đếm % của splash. Khi đạt 100%, toàn bộ chữ/thanh tiến trình mờ hẳn đi
 * rồi mới bàn giao cho bước tách màn (SplitReveal) chạy sau cùng.
 */
export default function Preloader({ theme, lang, onComplete }) {
  const c = palette(theme)
  const [value, setValue] = useState(0)
  const [visible, setVisible] = useState(false)
  const [done, setDone] = useState(false)
  const timerRef = useRef(0)
  const doneRef = useRef(false)

  // Crossfade: video splash mờ dần 280ms, khối loading hiện dần 280ms.
  useEffect(() => {
    const id = requestAnimationFrame(() => setVisible(true))
    return () => cancelAnimationFrame(id)
  }, [])

  useEffect(() => {
    const reduced =
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches

    document.documentElement.setAttribute(REVEAL_ATTR, 'hold')

    const finish = () => {
      if (doneRef.current) return
      doneRef.current = true
      // Ẩn hẳn chữ + thanh loading trước, rồi mới bàn giao bước kế tiếp.
      setDone(true)
      const wait = reduced ? 20 : 360
      timerRef.current = window.setTimeout(() => {
        document.documentElement.removeAttribute(REVEAL_ATTR)
        onComplete?.()
      }, wait)
    }

    if (reduced) {
      setValue(100)
      finish()
      return () => {
        window.clearTimeout(timerRef.current)
      }
    }

    let current = 0
    const step = () => {
      current = Math.min(
        100,
        current + (Math.random() < 0.18 ? 0 : 2 + Math.floor(Math.random() * (current > 80 ? 4 : 9))),
      )
      setValue(current)
      if (current < 100) {
        timerRef.current = window.setTimeout(step, Math.random() < 0.12 ? 260 : 45)
      } else {
        timerRef.current = window.setTimeout(finish, 320)
      }
    }
    timerRef.current = window.setTimeout(step, 45)

    return () => {
      window.clearTimeout(timerRef.current)
      document.documentElement.removeAttribute(REVEAL_ATTR)
    }
  }, [onComplete])

  const inkRaw = theme === 'light' ? c.ink : c.bg
  const ink = !inkRaw || inkRaw === 'transparent' ? (theme === 'light' ? '#171a20' : '#0c0e12') : inkRaw
  const fg = theme === 'light' ? '#F4F5F8' : c.text
  const muted = theme === 'light' ? 'rgba(244,245,248,.62)' : c.label
  const line = theme === 'light' ? 'rgba(244,245,248,.20)' : c.border

  return (
    <div
      className={`u256${visible ? ' is-ready' : ''}${done ? ' is-done' : ''}`}
      style={{ '--u256-ink': ink, '--u256-fg': fg, '--u256-muted': muted, '--u256-line': line }}
    >
      <style>{`
.u256{position:fixed;inset:0;z-index:10000;overflow:hidden;background:transparent}
.u256-ld{position:absolute;inset:0;z-index:2;pointer-events:auto}
.u256-hf{position:absolute;left:0;right:0;height:50.5%;background:var(--u256-ink)}
.u256-hf.u256-a{top:0}
.u256-hf.u256-b{bottom:0}
.u256 .u256-ct,.u256 .u256-bn,.u256 .u256-cen{opacity:0;transition:opacity 280ms ease}
.u256.is-ready .u256-ct,.u256.is-ready .u256-bn,.u256.is-ready .u256-cen{opacity:1}
.u256.is-done .u256-ct,.u256.is-done .u256-bn,.u256.is-done .u256-cen{opacity:0}
.u256-bn{position:absolute;left:20px;top:20px;color:var(--u256-fg);font-size:13px;font-weight:900;letter-spacing:-.01em}
.u256-ct{position:absolute;left:20px;right:20px;bottom:26px;color:var(--u256-fg)}
.u256-ct small{display:block;font-size:10.5px;font-weight:700;color:var(--u256-muted)}
.u256-n{font-size:74px;line-height:.9;font-weight:900;letter-spacing:-.05em;font-variant-numeric:tabular-nums}
.u256-n i{font-style:normal;font-size:24px;margin-left:2px;vertical-align:top}
.u256-br{margin-top:12px;height:2px;background:var(--u256-line)}
.u256-br i{display:block;height:100%;width:0;background:var(--u256-fg)}
.u256-cen{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);z-index:3;width:min(94vw,1120px);height:300px;pointer-events:none}
.u256-cen b{font-size:24px;font-weight:800;letter-spacing:-.02em;color:var(--u256-fg);line-height:1.1}
.u256-cen span{font-size:10.5px;font-weight:600;letter-spacing:.2em;text-transform:uppercase;color:var(--u256-muted)}
@media (prefers-reduced-motion:reduce){
  .u256 .u256-ct,.u256 .u256-bn,.u256 .u256-cen{transition:none}
}
[${REVEAL_ATTR}] .xyo-rise{opacity:0;transform:translateY(16px);transition:opacity .6s,transform .8s cubic-bezier(.2,.8,.2,1);transition-delay:var(--d,0s)}
[${REVEAL_ATTR}="on"] .xyo-rise{opacity:1;transform:none}
[${REVEAL_ATTR}] .xyo-rise-photo{opacity:0;transform:scale(1.08);clip-path:inset(12% 8% 12% 8% round 14px);transition:opacity .6s,transform 1.2s cubic-bezier(.2,.8,.2,1),clip-path 1.1s cubic-bezier(.2,.8,.2,1);transition-delay:var(--d,0s)}
[${REVEAL_ATTR}="on"] .xyo-rise-photo{opacity:1;transform:none;clip-path:inset(0 0 0 0 round 14px)}
@media (prefers-reduced-motion:reduce){
  [${REVEAL_ATTR}] .xyo-rise,[${REVEAL_ATTR}] .xyo-rise-photo{transition:none;opacity:1;transform:none;clip-path:none}
}
      `}</style>

      <div
        className="u256-ld"
        role="progressbar"
        aria-label={lang === 'en' ? 'Loading launcher' : 'Đang tải launcher'}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={value}
      >
        <div className="u256-hf u256-a" />
        <div className="u256-hf u256-b" />
        <div className="u256-cen">
          <ParticleWord />
        </div>
        <div className="u256-bn">XyoLauncher</div>
        <div className="u256-ct">
          <small>{lang === 'en' ? 'Loading launcher' : 'Đang tải launcher'}</small>
          <div className="u256-n">
            <span>{value}</span>
            <i>%</i>
          </div>
          <div className="u256-br">
            <i style={{ width: `${value}%` }} />
          </div>
        </div>
      </div>
    </div>
  )
}
