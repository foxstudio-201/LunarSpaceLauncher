import { createContext, useCallback, useContext, useMemo, useReducer, useRef } from 'react'
import {
  CheckCircle, WarningCircle, Info, DownloadSimple, X, ArrowsClockwise, Sparkle,
} from '@phosphor-icons/react'
import { palette } from '../../lib/palette'
import { useApp } from '../../i18n/AppContext'
import { formatBytes, formatSpeed } from '../../lib/status'

const MAX_VISIBLE = 5
const EXIT_MS = 200
const BURST_MS = 200

const vn = (lang, vi, en) => (lang === 'vi' ? vi : en)

const TONE_COLOR = {
  ok: '#22c55e',
  bad: '#f87171',
  warn: '#fbbf24',
  info: null,
  load: null,
}

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
  const storeRef = useRef({ items: [], keys: new Map(), timers: new Map() })
  const seqRef = useRef(0)
  const burstRef = useRef({ at: 0, count: 0 })
  const [tick, force] = useReducer((x) => x + 1, 0)

  const clearTimer = useCallback((id) => {
    const t = storeRef.current.timers.get(id)
    if (!t) return
    clearTimeout(t)
    storeRef.current.timers.delete(id)
  }, [])

  const drop = useCallback((id) => {
    const s = storeRef.current
    const item = s.items.find((x) => x.id === id)
    if (!item) return
    s.items = s.items.filter((x) => x.id !== id)
    if (item.key && s.keys.get(item.key) === id) s.keys.delete(item.key)
    clearTimer(id)
    force()
  }, [clearTimer])

  const close = useCallback((id) => {
    const s = storeRef.current
    const item = s.items.find((x) => x.id === id)
    if (!item || item.state === 'out') return
    item.state = 'out'
    clearTimer(id)
    force()
    setTimeout(() => drop(id), EXIT_MS)
  }, [clearTimer, drop])

  const dismiss = useCallback((target) => {
    const item = storeRef.current.items.find((x) => x.id === target || x.key === target)
    if (!item || item.finished || item.state === 'out') return
    close(item.id)
  }, [close])

  const arm = useCallback((id, duration) => {
    clearTimer(id)
    if (!duration) return
    storeRef.current.timers.set(id, setTimeout(() => close(id), duration))
  }, [clearTimer, close])

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
    s.items = [...s.items, item]
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
    }, opts.duration ?? 4200)
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

const TINTS = {
  dark: { from: '#7c5cf6', to: '#a78bfa', glow: 'rgba(167,139,250,0.55)' },
  light: { from: '#6d28d9', to: '#8b5cf6', glow: 'rgba(139,92,246,0.5)' },
  done: { from: '#15803d', to: '#22c55e', glow: 'rgba(34,197,94,0.5)' },
  failed: { from: '#b91c1c', to: '#ef4444', glow: 'rgba(239,68,68,0.5)' },
}

function alpha(color, a) {
  const value = String(color || '')
  if (!value.startsWith('#')) return value
  const hex = value.slice(1)
  const full = hex.length === 3 ? hex.split('').map((x) => x + x).join('') : hex
  const n = Number.parseInt(full, 16)
  if (!Number.isFinite(n)) return value
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`
}

function ToastHost({ api, storeRef, tick }) {
  const { lang, theme } = useApp()
  const items = storeRef.current.items
  void tick

  return (
    <div className="fixed bottom-4 right-4 z-[300] flex flex-col gap-2.5 pointer-events-none" style={{ width: 348 }}>
      {items.map((item) => (
        <ToastCard key={item.id} item={item} c={palette(theme)} theme={theme} lang={lang} onClose={api.close} />
      ))}
    </div>
  )
}

function ToastCard({ item, c, theme, lang, onClose }) {
  const tone = item.tone || 'info'
  const base = TONE_COLOR[tone] || c.accent
  const Icon = item.finished && tone === 'ok' ? Sparkle : TONE_ICON[tone] || Info
  const percent = Math.max(0, Math.min(100, item.percent ?? 0))
  const spin = tone === 'load' && !item.finished
  const hasBar = !item.finished || percent > 0
  const tint = tone === 'bad' ? TINTS.failed : tone === 'ok' ? TINTS.done : TINTS[theme] || TINTS.dark
  const light = theme === 'light'

  return (
    <div
      className={`pointer-events-auto w-full ${item.state === 'out' ? 'toast-out' : 'toast-in'}`}
      style={{ animationDelay: item.state === 'out' ? '0ms' : `${item.delay || 0}ms` }}
      role="status"
      aria-live="polite"
    >
      <div
        className="relative flex flex-col gap-2 rounded-xl px-3 py-2.5 overflow-hidden"
        style={{
          background: `linear-gradient(${alpha(base, light ? 0.07 : 0.06)}, ${alpha(base, light ? 0.07 : 0.06)}), ${c.surface}`,
          border: `1px solid ${alpha(base, light ? 0.5 : 0.42)}`,
          boxShadow: c.pixel
            ? c.shadow
            : `0 14px 34px ${light ? 'rgba(0,0,0,0.14)' : 'rgba(0,0,0,0.42)'}, 0 6px 22px ${alpha(base, light ? 0.16 : 0.14)}`,
        }}
      >
        <div className="flex items-start gap-2.5">
          <span
            className="w-6 h-6 rounded-md flex items-center justify-center shrink-0 mt-[1px]"
            style={{ background: alpha(base, light ? 0.14 : 0.16), border: `1px solid ${alpha(base, 0.36)}` }}
          >
            <Icon size={13} weight="bold" className={spin ? 'toast-spin' : ''} style={{ color: base }} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-bold leading-tight truncate" style={{ color: c.text }} title={item.title}>{item.title}</p>
            {item.message && (
              <p className="mt-0.5 text-[10px] leading-relaxed line-clamp-2" style={{ color: c.label }}>{item.message}</p>
            )}
          </div>
          <button
            onClick={() => onClose(item.id)}
            title={vn(lang, 'Đóng', 'Dismiss')}
            className="w-5 h-5 rounded flex items-center justify-center shrink-0 transition-opacity hover:opacity-100"
            style={{ color: c.faint, opacity: 0.7 }}
          >
            <X size={10} weight="bold" />
          </button>
        </div>

        {hasBar && (
          <div className="flex flex-col gap-1.5 pl-[34px]">
            <div
              className="pbar-track h-1"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={item.indeterminate ? undefined : Math.round(percent)}
              style={{ '--pbar-track': alpha(base, light ? 0.12 : 0.14), '--pbar-from': tint.from, '--pbar-to': tint.to, '--pbar-glow': tint.glow }}
            >
              {item.indeterminate ? (
                <div className="pbar-indeterminate" />
              ) : (
                <>
                  <div className={`pbar-fill${item.finished ? ' pbar-still' : ''}`} style={{ width: `${percent}%` }} />
                  {!item.finished && percent > 0.5 && <div className="pbar-head" style={{ left: `${percent}%` }} />}
                </>
              )}
            </div>
            <div className="flex items-center gap-2">
              {!item.finished && (
                <span className="text-[9px] font-mono tabular-nums shrink-0" style={{ color: c.faint }}>{Math.round(percent)}%</span>
              )}
              {!item.finished && item.speed > 1024 && (
                <span className="text-[9px] font-mono font-semibold shrink-0" style={{ color: base }}>{formatSpeed(item.speed)}</span>
              )}
              {!item.finished && item.detail && (
                <span className="text-[9px] font-mono truncate ml-auto" style={{ color: c.faint }} title={item.detail}>{item.detail}</span>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export const toastMaxVisible = MAX_VISIBLE
