// Lucian UX/UI Prompt #080 · MIT License (c) 2026 Seokwoooo · https://lucianlabs.dev/uxui-prompt/#080
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { palette } from '../../lib/palette'
import * as api from '../../api/client.js'

const vn = (lang, vi, en) => (lang === 'vi' ? vi : en)

// Ba quỹ đạo nghiêng: bán kính, độ nghiêng, tốc độ, màu và kích thước hành tinh.
const ORBITS = [
  { d: 210, tilt: -18, radius: 105, speed: 5.5, color: '#22C3A6', size: 12 },
  { d: 150, tilt: 24, radius: 75, speed: 3.6, color: '#FF6B8B', size: 10 },
  { d: 100, tilt: -58, radius: 50, speed: 2.2, color: '#FFB547', size: 9 },
]

const STYLE = `
.u080,.u080 *,.u080 *::before,.u080 *::after{box-sizing:border-box}
.u080{
  position:relative;width:340px;height:390px;display:flex;flex-direction:column;align-items:center;
  padding:26px 24px 22px;border-radius:30px;
  background:radial-gradient(80% 60% at 50% 35%,color-mix(in srgb,var(--ux-accent) 14%,transparent),transparent 70%),var(--ux-surface);
  box-shadow:0 0 0 1px var(--ux-line),0 30px 60px -36px var(--ux-shadow-strong);
  overflow:hidden;color:var(--ux-ink);
  font-family:"Be Vietnam Pro",Pretendard,-apple-system,BlinkMacSystemFont,"Apple SD Gothic Neo","Segoe UI",Roboto,"Noto Sans KR",sans-serif;
  -webkit-font-smoothing:antialiased;letter-spacing:-.01em;word-break:keep-all;overflow-wrap:break-word;
}
.u080 button{font:inherit;color:inherit;cursor:pointer}
.u080 :focus-visible{outline:2px solid var(--ux-accent);outline-offset:3px}
.u080-sys{position:relative;width:230px;height:200px;flex:none}
.u080-o{position:absolute;left:50%;top:50%;width:var(--d);height:var(--d);margin:calc(var(--d) / -2) 0 0 calc(var(--d) / -2);transform:rotate(var(--t)) scaleY(.38);transition:transform .7s var(--ux-ease),opacity .5s}
.u080-o::before{content:"";position:absolute;inset:0;border-radius:50%;border:1.5px solid color-mix(in srgb,var(--ux-ink) 14%,transparent)}
.u080-p{position:absolute;left:0;top:0;width:var(--s);height:var(--s);margin:calc(var(--s) / -2) 0 0 calc(var(--s) / -2);border-radius:50%;background:var(--c);box-shadow:0 0 12px var(--c);transition:opacity .4s}
.u080.is-done .u080-p{opacity:0}
.u080-core{position:absolute;z-index:1;left:50%;top:50%;width:56px;height:56px;margin:-28px 0 0 -28px;border-radius:50%;background:radial-gradient(circle at 38% 32%,#fff,#B7A4FF 40%,#5B3FD9);box-shadow:0 0 30px color-mix(in srgb,var(--ux-accent) 60%,transparent);animation:u080-breath 2.2s ease-in-out infinite;display:grid;place-items:center;transition:background .5s,width .6s var(--ux-spring),height .6s var(--ux-spring),margin .6s var(--ux-spring)}
@keyframes u080-breath{50%{transform:scale(1.08);box-shadow:0 0 44px color-mix(in srgb,var(--ux-accent) 70%,transparent)}}
.u080-core svg{width:34px;height:34px;fill:none;stroke:#fff;stroke-width:3.2;stroke-linecap:round;stroke-linejoin:round}
.u080-core path{stroke-dasharray:30;stroke-dashoffset:30;transition:stroke-dashoffset .5s var(--ux-ease) .35s}
.u080-wave{position:absolute;left:50%;top:50%;width:84px;height:84px;margin:-42px 0 0 -42px;border-radius:50%;border:2px solid var(--ux-mint);opacity:0}
.u080.is-done .u080-o{transform:rotate(var(--t)) scaleY(.38) scale(0);opacity:0}
.u080.is-done .u080-core{width:84px;height:84px;margin:-42px 0 0 -42px;background:var(--ux-mint);box-shadow:0 0 0 0 transparent;animation:none}
.u080.is-done .u080-core path{stroke-dashoffset:0}
.u080.is-done .u080-wave{animation:u080-wave 1.1s var(--ux-ease) .3s 2}
@keyframes u080-wave{from{transform:scale(1);opacity:.7}to{transform:scale(2.4);opacity:0}}
.u080.is-paused .u080-core{animation-play-state:paused}
.u080-msg{width:100%;text-align:center}
.u080-t{position:relative;height:26px;width:100%;margin-top:14px;text-align:center}
.u080-t b{position:absolute;left:0;right:0;font-size:18px;font-weight:850;letter-spacing:-.04em;transition:opacity .3s,transform .45s var(--ux-spring)}
.u080-t b.out{opacity:0;transform:translateY(-10px)}
.u080-t b.in{opacity:0;transform:translateY(10px)}
.u080-sub{margin:4px 0 0;font-size:13px;font-weight:650;color:var(--ux-ink-3);font-variant-numeric:tabular-nums}
.u080-note{margin:10px 0 0;font-size:10.5px;line-height:1.5;text-align:center;color:var(--ux-ink-3)}
.u080-b{margin-top:auto;height:46px;padding:0 20px;border:0;border-radius:999px;background:var(--ux-surface-2);color:var(--ux-ink);font-size:14px;font-weight:750;transition:transform .3s var(--ux-spring),background-color .3s,color .3s}
.u080-b:active{transform:scale(.95)}
.u080-b:focus-visible{outline:2px solid var(--ux-accent);outline-offset:2px}
.u080-b:disabled{opacity:.55;pointer-events:none}
.u080.is-done .u080-b{background:var(--ux-ink);color:var(--ux-page)}
.u080-actions{display:flex;gap:8px;width:100%;margin-top:auto}
.u080-actions .u080-b{flex:1;min-width:0;margin-top:0;padding:0 10px}
.u080-b--primary{background:var(--ux-accent);color:var(--ux-accent-ink)}
.u080-b--danger{background:var(--ux-danger);color:#fff}
@media (prefers-reduced-motion:reduce){
  .u080,.u080 *,.u080 *::before,.u080 *::after{animation-duration:.001ms!important;animation-iteration-count:1!important;transition-duration:.001ms!important}
}
`

export default function LegacySyncModal({ theme, lang, info, onClose, onSynced }) {
  const c = palette(theme)
  const dark = theme !== 'light'
  const [mode, setMode] = useState('ask')
  const [sub, setSub] = useState('')

  const titleRef = useRef(null)
  const planetEls = useRef([])
  const doneRef = useRef(false)
  const pausedRef = useRef(false)
  const runningRef = useRef(false)
  const stepRef = useRef(-1)
  const aliveRef = useRef(true)

  const steps = useMemo(
    () => (lang === 'vi'
      ? ['Đang kết nối dữ liệu cũ', 'Đang đồng bộ tệp', 'Sắp xong']
      : ['Connecting to old data', 'Syncing files', 'Almost there']),
    [lang],
  )

  const planets = useMemo(() => {
    const list = []
    ORBITS.forEach((o, i) => {
      ;[0, Math.PI].forEach((ph, k) => {
        list.push({ o, ph: ph + i, k, size: k ? o.size - 4 : o.size, opacity: k ? 0.7 : 1 })
      })
    })
    return list
  }, [])

  const title = useCallback((text) => {
    const wrap = titleRef.current
    if (!wrap) return
    const old = wrap.querySelector('b:not(.out)')
    const next = document.createElement('b')
    next.textContent = text
    next.className = 'in'
    wrap.appendChild(next)
    void next.offsetWidth
    next.className = ''
    if (old) {
      old.className = 'out'
      setTimeout(() => old.remove(), 450)
    }
  }, [])

  useEffect(() => {
    aliveRef.current = true
    return () => {
      aliveRef.current = false
    }
  }, [])

  // Tiêu đề đầu tiên (chưa chạy hiệu ứng chuyển).
  useEffect(() => {
    const wrap = titleRef.current
    if (!wrap || wrap.childElementCount) return
    const first = document.createElement('b')
    first.textContent = vn(lang, 'Đồng bộ dữ liệu cũ?', 'Sync old data?')
    wrap.appendChild(first)
    setSub(vn(lang, `Tìm thấy dữ liệu ${info?.legacyName || 'LunarSpace Launcher'}`, `Found ${info?.legacyName || 'LunarSpace Launcher'} data`))
  }, [lang, info])

  // Hành tinh quay quanh lõi; dừng cập nhật khi đã xong.
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return undefined
    let frame = 0
    let last = performance.now()
    let t = 0
    const loop = (now) => {
      const dt = (now - last) / 1000
      last = now
      if (!doneRef.current && !pausedRef.current) {
        t += dt
        planets.forEach((p, idx) => {
          const el = planetEls.current[idx]
          if (!el) return
          const a = p.ph + (t * Math.PI * 2) / p.o.speed
          const tl = (p.o.tilt * Math.PI) / 180
          const x = Math.cos(a) * p.o.radius
          const y = Math.sin(a) * p.o.radius * 0.38
          const rx = x * Math.cos(tl) - y * Math.sin(tl)
          const ry = x * Math.sin(tl) + y * Math.cos(tl)
          el.style.transform = `translate(${(115 + rx).toFixed(1)}px, ${(100 + ry).toFixed(1)}px)`
          el.style.zIndex = Math.sin(a) < 0 ? 0 : 2
        })
      }
      frame = requestAnimationFrame(loop)
    }
    frame = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(frame)
  }, [planets])

  useEffect(() => {
    const off = api.onLegacyProgress((ev) => {
      if (!ev || !aliveRef.current) return
      if (ev.phase === 'scan') {
        setSub(vn(lang, 'Đang quét dữ liệu cũ…', 'Scanning old data…'))
        return
      }
      if (ev.phase === 'copy') {
        const total = ev.total || 0
        const done = ev.done || 0
        const p = total > 0 ? done / total : 0
        const step = p >= 0.86 ? 2 : p >= 0.18 ? 1 : 0
        if (step !== stepRef.current) {
          stepRef.current = step
          title(steps[step])
        }
        setSub(`${done} / ${total} ${vn(lang, 'tệp', 'files')}`)
      }
    })
    return off
  }, [lang, steps, title])

  useEffect(() => {
    const onKey = (event) => {
      if (event.key !== 'Escape') return
      if (mode === 'confirm') {
        setMode('ask')
        title(vn(lang, 'Đồng bộ dữ liệu cũ?', 'Sync old data?'))
        setSub(vn(lang, `Tìm thấy dữ liệu ${info?.legacyName || 'LunarSpace Launcher'}`, `Found ${info?.legacyName || 'LunarSpace Launcher'} data`))
      } else if (mode === 'done' || mode === 'removed' || mode === 'stopped' || mode === 'error') {
        onClose?.()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [mode, lang, info, title, onClose])

  const startSync = useCallback(async () => {
    if (runningRef.current) return
    runningRef.current = true
    doneRef.current = false
    pausedRef.current = false
    stepRef.current = 0
    setMode('sync')
    setSub(vn(lang, 'Đang quét dữ liệu cũ…', 'Scanning old data…'))
    title(steps[0])
    const res = await api.legacySync().catch((err) => ({ ok: false, error: err?.message }))
    runningRef.current = false
    if (!aliveRef.current) return
    if (res?.ok && res.cancelled) {
      doneRef.current = true
      pausedRef.current = true
      setMode('stopped')
      title(vn(lang, 'Đã dừng đồng bộ', 'Sync stopped'))
      setSub(vn(lang, 'Bạn có thể đồng bộ lại sau', 'You can restart anytime'))
      return
    }
    if (!res?.ok) {
      doneRef.current = true
      setMode('error')
      title(vn(lang, 'Đồng bộ thất bại', 'Sync failed'))
      setSub(res?.error || vn(lang, 'Đã xảy ra lỗi', 'Something went wrong'))
      return
    }
    doneRef.current = true
    setMode('done')
    title(vn(lang, 'Đồng bộ hoàn tất', 'Sync complete'))
    setSub(vn(lang, `${res.files || 0} tệp · vừa xong`, `${res.files || 0} files · just now`))
    onSynced?.()
  }, [lang, steps, title, onSynced])

  const cancelSync = useCallback(() => {
    api.legacyCancel().catch(() => {})
  }, [])

  const askDecline = useCallback(() => {
    setMode('confirm')
    title(vn(lang, 'Xoá dữ liệu cũ?', 'Delete old data?'))
    setSub(vn(lang, 'Toàn bộ dữ liệu LunarSpace Launcher sẽ bị xoá vĩnh viễn.', 'All LunarSpace Launcher data will be deleted permanently.'))
  }, [lang, title])

  const backToAsk = useCallback(() => {
    setMode('ask')
    title(vn(lang, 'Đồng bộ dữ liệu cũ?', 'Sync old data?'))
    setSub(vn(lang, `Tìm thấy dữ liệu ${info?.legacyName || 'LunarSpace Launcher'}`, `Found ${info?.legacyName || 'LunarSpace Launcher'} data`))
  }, [lang, info, title])

  const decline = useCallback(async () => {
    setMode('deleting')
    title(vn(lang, 'Đang xoá dữ liệu cũ', 'Deleting old data'))
    setSub(vn(lang, 'Vui lòng chờ…', 'Hang on a moment'))
    const res = await api.legacyDecline().catch((err) => ({ ok: false, error: err?.message }))
    if (!aliveRef.current) return
    doneRef.current = true
    if (!res?.ok) {
      setMode('error')
      title(vn(lang, 'Xoá thất bại', 'Delete failed'))
      setSub(res?.error || vn(lang, 'Đã xảy ra lỗi', 'Something went wrong'))
      return
    }
    setMode('removed')
    title(vn(lang, 'Đã xoá dữ liệu cũ', 'Old data deleted'))
    setSub(vn(lang, 'XyoLauncher sẽ dùng dữ liệu hiện tại', 'XyoLauncher keeps the current data'))
    onSynced?.()
  }, [lang, title, onSynced])

  const vars = {
    '--ux-page': c.bg && c.bg !== 'transparent' ? c.bg : dark ? '#0c0e12' : '#f4f5f8',
    '--ux-surface': c.surface,
    '--ux-surface-2': c.input,
    '--ux-surface-3': c.hover,
    '--ux-ink': c.text,
    '--ux-ink-2': c.label,
    '--ux-ink-3': c.faint,
    '--ux-line': c.border,
    '--ux-line-2': c.faint,
    '--ux-accent': c.accent,
    '--ux-accent-2': c.info,
    '--ux-accent-soft': `color-mix(in srgb, ${c.accent} 12%, transparent)`,
    '--ux-accent-ink': c.onAccent,
    '--ux-mint': c.ok,
    '--ux-warn': c.warn,
    '--ux-danger': c.bad,
    '--ux-shadow-strong': dark ? 'rgba(0,0,0,.72)' : 'rgba(40,30,80,.3)',
    '--ux-ease': 'cubic-bezier(.2,.8,.2,1)',
    '--ux-spring': 'cubic-bezier(.34,1.45,.64,1)',
  }

  const done = mode === 'done' || mode === 'removed'
  const cardClass = `ux u080${done ? ' is-done' : ''}${mode === 'stopped' ? ' is-paused' : ''}`

  return (
    <div
      className="modal-backdrop fixed inset-0 z-[240] flex items-center justify-center p-6"
      onClick={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.preventDefault()}
    >
      <style>{STYLE}</style>
      <div className={cardClass} style={vars} role="dialog" aria-modal="true" aria-label={vn(lang, 'Đồng bộ dữ liệu cũ', 'Sync old data')}>
        <div className="u080-sys" aria-hidden="true">
          {ORBITS.map((o, i) => (
            <div key={i} className="u080-o" style={{ '--d': `${o.d}px`, '--t': `${o.tilt}deg` }} />
          ))}
          {planets.map((p, i) => (
            <i
              key={i}
              ref={(el) => { planetEls.current[i] = el }}
              className="u080-p"
              style={{ '--c': p.o.color, '--s': `${p.size}px`, opacity: p.opacity }}
            />
          ))}
          <span className="u080-wave" />
          <span className="u080-core">
            <svg viewBox="0 0 34 34"><path d="M9 17.5l5.5 5.5L25.5 12" /></svg>
          </span>
        </div>

        <div className="u080-msg" role="status" aria-live="polite">
          <div className="u080-t" ref={titleRef} />
          <p className="u080-sub" title={mode === 'ask' ? info?.legacyPath || '' : ''}>{sub}</p>
        </div>

        {mode === 'ask' && (
          <>
            <p className="u080-note">
              {vn(
                lang,
                'Không đồng bộ sẽ xoá dữ liệu cũ.',
                'Skipping deletes the old launcher data.',
              )}
            </p>
            <div className="u080-actions">
              <button type="button" className="u080-b" onClick={askDecline}>
                {vn(lang, 'Không đồng bộ', 'Skip')}
              </button>
              <button type="button" className="u080-b u080-b--primary" onClick={startSync}>
                {vn(lang, 'Đồng bộ', 'Sync')}
              </button>
            </div>
          </>
        )}

        {mode === 'confirm' && (
          <div className="u080-actions">
            <button type="button" className="u080-b" onClick={backToAsk}>
              {vn(lang, 'Quay lại', 'Back')}
            </button>
            <button type="button" className="u080-b u080-b--danger" onClick={decline}>
              {vn(lang, 'Xoá', 'Delete')}
            </button>
          </div>
        )}

        {mode === 'sync' && (
          <button type="button" className="u080-b" onClick={cancelSync}>
            {vn(lang, 'Huỷ', 'Cancel')}
          </button>
        )}

        {(mode === 'done' || mode === 'removed') && (
          <button type="button" className="u080-b" onClick={() => onClose?.()}>
            {vn(lang, 'Đóng', 'Close')}
          </button>
        )}

        {mode === 'stopped' && (
          <button type="button" className="u080-b" onClick={startSync}>
            {vn(lang, 'Đồng bộ lại', 'Sync again')}
          </button>
        )}

        {mode === 'error' && (
          <div className="u080-actions">
            <button type="button" className="u080-b" onClick={() => onClose?.()}>
              {vn(lang, 'Đóng', 'Close')}
            </button>
            <button type="button" className="u080-b u080-b--primary" onClick={startSync}>
              {vn(lang, 'Thử lại', 'Retry')}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
