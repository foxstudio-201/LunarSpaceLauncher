// Lucian UX/UI Prompt #070 · MIT License (c) 2026 Seokwoooo · https://lucianlabs.dev/uxui-prompt/#070
import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import {
  CheckCircle, WarningCircle, Info, DownloadSimple, X, Sparkle,
} from '@phosphor-icons/react'
import { palette } from '../../lib/palette'
import { useApp } from '../../i18n/AppContext'
import { formatSpeed } from '../../lib/status'

const MAX_VISIBLE = 5
const EXIT_MS = 450
const BURST_MS = 200
const DEFAULT_DURATION = 4200

const vn = (lang, vi, en) => (lang === 'vi' ? vi : en)

const TONE_ICON = {
  ok: CheckCircle,
  bad: WarningCircle,
  warn: WarningCircle,
  info: Info,
  load: DownloadSimple,
}

const ToastContext = createContext(null)

export function useToast() {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast phải nằm trong ToastProvider.')
  return ctx
}

export function ToastProvider({ children }) {
  const storeRef = useRef({ items: [], keys: new Map() })
  const seqRef = useRef(0)
  const burstRef = useRef({ at: 0, count: 0 })
  const [tick, force] = useReducer((x) => x + 1, 0)

  const drop = useCallback((id) => {
    const s = storeRef.current
    const item = s.items.find((x) => x.id === id)
    if (!item) return
    s.items = s.items.filter((x) => x.id !== id)
    if (item.key && s.keys.get(item.key) === id) s.keys.delete(item.key)
    force()
  }, [])

  const close = useCallback((id) => {
    const s = storeRef.current
    const item = s.items.find((x) => x.id === id)
    if (!item || item.state === 'out') return
    item.state = 'out'
    force()
    setTimeout(() => drop(id), EXIT_MS)
  }, [drop])

  const dismiss = useCallback((target) => {
    const item = storeRef.current.items.find((x) => x.id === target || x.key === target)
    if (!item || item.state === 'out') return
    close(item.id)
  }, [close])

  // Thời gian tự tắt còn lại (ms). 0/Infinity = không tự tắt.
  const arm = useCallback((id, duration) => {
    const item = storeRef.current.items.find((x) => x.id === id)
    if (!item) return
    item.total = duration || 0
    item.left = duration || 0
  }, [])

  const stagger = useCallback(() => {
    const now = Date.now()
    const b = burstRef.current
    if (now - b.at > BURST_MS) {
      burstRef.current = { at: now, count: 0 }
      return 0
    }
    burstRef.current = { at: now, count: b.count + 1 }
    return Math.min(b.count + 1, MAX_VISIBLE - 1) * 45
  }, [])

  const push = useCallback((item, duration) => {
    const s = storeRef.current
    const live = s.items.filter((x) => x.state !== 'out')
    if (live.length >= MAX_VISIBLE) {
      const victim = live.find((x) => x.finished) || live[0]
      if (victim) close(victim.id)
    }
    s.items = [item, ...s.items]
    if (item.key) s.keys.set(item.key, item.id)
    arm(item.id, duration)
    force()
    return item.id
  }, [arm, close])

  const nextId = () => {
    seqRef.current += 1
    return `toast-${seqRef.current}`
  }

  const notify = useCallback((options) => {
    const opts = typeof options === 'string' ? { title: options } : options || {}
    return push({
      id: nextId(),
      key: opts.key || '',
      tone: opts.tone || 'info',
      title: opts.title || '',
      message: opts.message || '',
      delay: stagger(),
      finished: true,
      state: 'in',
      total: 0,
      left: 0,
    }, opts.duration ?? DEFAULT_DURATION)
  }, [push, stagger])

  const download = useCallback((key, patch = {}) => {
    if (!key) return null
    const s = storeRef.current
    const id = s.keys.get(key)
    const item = id ? s.items.find((x) => x.id === id) : null
    if (item) {
      const wasFinished = item.finished
      Object.assign(item, patch)
      item.state = 'in'
      item.finished = !!patch.finished
      if (!item.finished) arm(item.id, 0)
      else if (!wasFinished) arm(item.id, patch.tone === 'bad' ? 9000 : 4000)
      force()
      return item.id
    }
    return push({
      id: nextId(),
      key,
      tone: patch.tone || 'load',
      title: patch.title || '',
      message: patch.message || '',
      percent: patch.percent ?? 0,
      indeterminate: patch.indeterminate ?? true,
      speed: patch.speed || 0,
      detail: patch.detail || '',
      delay: stagger(),
      finished: false,
      state: 'in',
      total: 0,
      left: 0,
    }, 0)
  }, [arm, push, stagger])

  const finish = useCallback((key, patch = {}) => {
    const s = storeRef.current
    const id = s.keys.get(key)
    const item = id ? s.items.find((x) => x.id === id) : null
    if (!item) return null
    const wasFinished = item.finished
    Object.assign(item, patch, {
      finished: true,
      state: 'in',
      indeterminate: false,
      percent: patch.percent ?? (patch.tone === 'bad' ? item.percent : 100),
      speed: 0,
    })
    if (!wasFinished) arm(item.id, patch.duration ?? (patch.tone === 'bad' ? 9000 : 4000))
    force()
    return item.id
  }, [arm])

  const api = useMemo(() => ({ notify, download, finish, dismiss, close }), [notify, download, finish, dismiss, close])

  return (
    <ToastContext.Provider value={api}>
      {children}
      <ToastHost api={api} storeRef={storeRef} tick={tick} />
    </ToastContext.Provider>
  )
}

function ToastHost({ api, storeRef, tick }) {
  const { lang, theme } = useApp()
  const c = palette(theme)
  const [open, setOpen] = useState(false)
  const zoneRef = useRef(null)
  const barRefs = useRef(new Map())
  const openRef = useRef(open)
  openRef.current = open

  const items = storeRef.current.items.filter((x) => x.state !== 'out')
  const exiting = storeRef.current.items.filter((x) => x.state === 'out')

  // Đếm ngược chỉ cho toast trên cùng, dừng khi rê chuột vào (giống bản mẫu).
  useEffect(() => {
    let raf = 0
    let last = performance.now()
    const loop = (now) => {
      const dt = now - last
      last = now
      if (!openRef.current) {
        const s = storeRef.current
        const top = s.items.find((x) => x.state !== 'out')
        if (top && top.left > 0 && top.left !== Infinity) {
          top.left -= dt
          const bar = barRefs.current.get(top.id)
          if (bar && top.total) bar.style.transform = `scaleX(${Math.max(0, top.left / top.total).toFixed(3)})`
          if (top.left <= 0) api.close(top.id)
        }
      }
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [api])

  useEffect(() => {
    if (!items.length) setOpen(false)
  }, [items.length])

  const onEnter = (event) => {
    if (event?.pointerType && event.pointerType !== 'mouse') return
    setOpen(true)
  }
  const onLeave = (event) => {
    const next = event?.relatedTarget
    if (next && zoneRef.current?.contains(next)) return
    setOpen(false)
  }

  let acc = 0
  const layout = items.map((item, index) => {
    let y
    let s
    let o
    if (open) {
      y = -acc
      s = 1
      o = 1
      acc += 68 + 8
    } else {
      y = -index * 14
      s = 1 - index * 0.06
      o = index > 2 ? 0 : 1
    }
    return { item, index, y, s, o }
  })

  return (
    <div className="u070" style={{ position: 'fixed', inset: 0, zIndex: 300, pointerEvents: 'none' }}>
      <style>{`
.u070-zone{position:absolute;right:16px;bottom:16px;width:350px;pointer-events:none}
.u070-catch{position:absolute;left:0;right:0;bottom:0;pointer-events:auto}
.u070-t{position:absolute;left:0;right:0;bottom:0;pointer-events:auto;display:flex;align-items:center;gap:12px;min-height:68px;padding:12px 12px 12px 14px;border-radius:20px;background:${c.surface};box-shadow:0 0 0 1px ${c.border},0 16px 30px -18px rgba(0,0,0,.45);transform-origin:50% 100%;transform:translate(var(--dx,0px),var(--y,0px)) scale(var(--s,1));opacity:var(--o,1);transition:transform .5s cubic-bezier(.34,1.45,.64,1),opacity .35s;touch-action:pan-y;user-select:none;-webkit-user-select:none;cursor:default}
.u070-t.drag{transition:none}
.u070-t.enter{transform:translateY(90px) scale(.9);opacity:0}
.u070-t.leave{opacity:0;pointer-events:none}
.u070-t.leave.side{transform:translate(calc(var(--dir,1) * 420px),var(--y,0px)) rotate(calc(var(--dir,1) * 8deg))}
.u070-t>*{transition:opacity .25s;min-width:0}
.u070-t.back>*{opacity:0}
.u070-ic{width:36px;height:36px;flex:none;border-radius:12px;display:grid;place-items:center;background:color-mix(in srgb,var(--c) 15%,transparent);color:var(--c)}
.u070-ic svg{width:18px;height:18px}
.u070-ic i{width:18px;height:18px;border-radius:50%;border:2.5px solid currentColor;border-right-color:transparent;animation:u070-spin .7s linear infinite}
@keyframes u070-spin{to{transform:rotate(360deg)}}
.u070-tx{flex:1;min-width:0}
.u070-tx b{display:block;font-size:14px;font-weight:780;letter-spacing:-.02em;color:${c.text};overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.u070-tx small{display:block;margin-top:2px;font-size:12.5px;font-weight:600;color:${c.label};white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.u070-x{width:30px;height:30px;flex:none;border:0;padding:0;border-radius:50%;display:grid;place-items:center;background:none;color:${c.label};cursor:pointer}
.u070-x:hover{background:${c.hover};color:${c.text}}
.u070-x svg{width:14px;height:14px}
.u070-bar{position:absolute;left:16px;right:16px;bottom:0;height:2px;border-radius:2px;background:var(--c);opacity:.5;transform-origin:0 50%;transform:scaleX(var(--left,1))}
.u070-live{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}
@media (prefers-reduced-motion:reduce){
  .u070-t{transition:none}
  .u070-t.enter{transform:none;opacity:1}
}
      `}</style>

      <div
        ref={zoneRef}
        className="u070-zone"
        role="region"
        aria-label={vn(lang, 'Thông báo', 'Notifications')}
        onPointerEnter={onEnter}
        onPointerLeave={onLeave}
        onFocus={() => setOpen(true)}
        onBlur={(event) => {
          if (zoneRef.current?.contains(event.relatedTarget)) return
          setOpen(false)
        }}
      >
        <div className="u070-live" aria-live="polite" />
        {items.length > 0 && (
          <div
            className="u070-catch"
            style={{ height: 76 + (open ? Math.max(0, items.length - 1) * 76 : Math.max(0, items.length - 1) * 14) }}
            onPointerEnter={onEnter}
            onPointerLeave={onLeave}
          />
        )}
        {layout.map(({ item, index, y, s, o }) => (
          <ToastCard
            key={item.id}
            item={item}
            index={index}
            y={y}
            s={s}
            o={o}
            stacked={!open}
            c={c}
            lang={lang}
            barRefs={barRefs}
            onEnter={onEnter}
            onLeave={onLeave}
            onClose={api.close}
            onSwipe={(dir) => {
              const el = barRefs.current.get(`${item.id}-el`)
              if (el) {
                el.style.setProperty('--dir', String(dir))
                el.classList.add('side')
              }
              api.close(item.id)
            }}
          />
        ))}
        {exiting.map((item) => (
          <ToastCard
            key={item.id}
            item={item}
            index={-1}
            y={0}
            s={1}
            o={0}
            stacked
            exiting
            c={c}
            lang={lang}
            barRefs={barRefs}
            onClose={api.close}
            onSwipe={() => {}}
          />
        ))}
      </div>
    </div>
  )
}

function ToastCard({ item, index, y, s, o, stacked, exiting, c, lang, barRefs, onClose, onSwipe, onEnter, onLeave }) {
  const tone = item.tone || 'info'
  const Icon = tone === 'ok' && item.finished ? Sparkle : TONE_ICON[tone] || Info
  const base = tone === 'ok' ? c.ok : tone === 'bad' ? c.bad : tone === 'warn' ? c.warn : c.accent
  const spinning = tone === 'load' && !item.finished
  const percent = Math.max(0, Math.min(100, item.percent ?? 0))
  const detail = [
    item.message,
    !item.finished && item.percent !== undefined ? `${Math.round(percent)}%` : '',
    !item.finished && item.speed > 1024 ? formatSpeed(item.speed) : '',
    !item.finished && item.detail ? item.detail : '',
  ].filter(Boolean).join(' · ')

  const elRef = useRef(null)
  const dragRef = useRef({ down: false, sx: 0, dx: 0 })

  useEffect(() => {
    if (elRef.current) barRefs.current.set(`${item.id}-el`, elRef.current)
    return () => barRefs.current.delete(`${item.id}-el`)
  }, [item.id, barRefs])

  const onPointerDown = (event) => {
    if (event.target.closest('button')) return
    dragRef.current = { down: true, sx: event.clientX, dx: 0 }
    elRef.current?.setPointerCapture?.(event.pointerId)
    elRef.current?.classList.add('drag')
  }
  const onPointerMove = (event) => {
    const d = dragRef.current
    if (!d.down) return
    d.dx = event.clientX - d.sx
    if (elRef.current) {
      elRef.current.style.setProperty('--dx', `${d.dx}px`)
      elRef.current.style.setProperty('--o', String(Math.max(0.2, 1 - Math.abs(d.dx) / 260)))
    }
  }
  const endDrag = () => {
    const d = dragRef.current
    if (!d.down) return
    d.down = false
    elRef.current?.classList.remove('drag')
    if (Math.abs(d.dx) > 90) {
      onSwipe(d.dx > 0 ? 1 : -1)
      return
    }
    if (elRef.current) {
      elRef.current.style.setProperty('--dx', '0px')
      elRef.current.style.setProperty('--o', String(o))
    }
  }

  return (
    <div
      ref={elRef}
      className={`u070-t${exiting ? ' leave' : ''}${stacked && index > 0 ? ' back' : ''}`}
      style={{
        '--c': base,
        '--y': `${y}px`,
        '--s': s,
        '--o': o,
        transform: `translate(var(--dx, 0px), ${y}px) scale(${s})`,
        opacity: o,
        '--left': item.total ? Math.max(0, item.left / item.total) : Math.max(0, percent / 100),
        zIndex: 50 - index,
        pointerEvents: stacked && index > 0 ? 'none' : 'auto',
      }}
      role={tone === 'bad' ? 'alert' : 'status'}
      aria-live={tone === 'bad' ? 'assertive' : 'polite'}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onPointerEnter={onEnter}
      onPointerLeave={onLeave}
    >
      <span className="u070-ic" aria-hidden="true">
        {spinning ? <i /> : <Icon size={18} weight="bold" />}
      </span>
      <span className="u070-tx">
        <b title={item.title}>{item.title}</b>
        {detail ? <small title={detail}>{detail}</small> : null}
      </span>
      <button
        type="button"
        className="u070-x"
        aria-label={vn(lang, 'Đóng', 'Dismiss')}
        title={vn(lang, 'Đóng', 'Dismiss')}
        onClick={() => onClose(item.id)}
      >
        <X size={14} weight="bold" />
      </button>
      {item.total || (!item.finished && item.percent !== undefined) ? (
        <span
          className="u070-bar"
          aria-hidden="true"
          ref={(node) => {
            if (node) barRefs.current.set(item.id, node)
            else barRefs.current.delete(item.id)
          }}
        />
      ) : null}
    </div>
  )
}

export const toastMaxVisible = MAX_VISIBLE
