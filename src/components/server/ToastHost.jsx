import { useState, useEffect, useRef, useCallback } from 'react'
import { subscribeToasts } from '../../lib/toast'

const MAX_TOASTS = 4
const EXIT_MS = 300

const COLORS = {
  info: '#2496ed',
  success: '#22c55e',
  error: '#ef4444',
  warning: '#f59e0b',
}

const ICONS = {
  info: 'M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z',
  success: 'M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z',
  error: 'M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z',
  warning: 'M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z',
}

function ToastItem({ toast, theme, leaving, onManualClose }) {
  const [entered, setEntered] = useState(false)

  useEffect(() => {
    const raf = requestAnimationFrame(() => setEntered(true))
    return () => cancelAnimationFrame(raf)
  }, [])

  const c = COLORS[toast.type] || COLORS.info
  const shown = entered && !leaving

  return (
    <div
      className="flex items-center gap-3 px-4 py-3 rounded-xl shadow-lg transition-all duration-300 pointer-events-auto"
      style={{
        background: theme === 'light' ? '#fff' : '#1a1a1a',
        border: `1px solid ${c}30`,
        transform: shown ? 'translateX(0)' : 'translateX(120%)',
        opacity: shown ? 1 : 0,
        minWidth: '300px',
        maxWidth: '400px',
      }}
    >
      <svg className="w-5 h-5 shrink-0" style={{ color: c }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d={ICONS[toast.type] || ICONS.info} />
      </svg>
      <span className="text-xs flex-1" style={{ color: theme === 'light' ? '#111' : '#fff' }}>{toast.message}</span>
      <button
        onClick={onManualClose}
        className="w-5 h-5 flex items-center justify-center shrink-0 transition-opacity hover:opacity-70"
        style={{ color: theme === 'light' ? '#555' : 'rgba(255,255,255,0.6)' }}
      >
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
      </button>
    </div>
  )
}

export default function ToastHost({ theme }) {
  const [toasts, setToasts] = useState([])
  const [leavingIds, setLeavingIds] = useState(() => new Set())
  const timersRef = useRef(new Map())
  const leavingRef = useRef(new Set())

  const clearToastTimer = useCallback((id) => {
    const t = timersRef.current.get(id)
    if (t) {
      clearTimeout(t.auto)
      clearTimeout(t.exit)
      timersRef.current.delete(id)
    }
  }, [])

  const removeToast = useCallback((id) => {
    clearToastTimer(id)
    leavingRef.current.delete(id)
    setLeavingIds((prev) => {
      if (!prev.has(id)) return prev
      const next = new Set(prev)
      next.delete(id)
      return next
    })
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [clearToastTimer])

  const beginExit = useCallback((id) => {
    if (leavingRef.current.has(id)) return
    leavingRef.current.add(id)
    setLeavingIds((prev) => {
      const next = new Set(prev)
      next.add(id)
      return next
    })
    const timers = timersRef.current.get(id)
    if (timers) {
      clearTimeout(timers.auto)
      clearTimeout(timers.exit)
    }
    const exit = setTimeout(() => removeToast(id), EXIT_MS)
    timersRef.current.set(id, { auto: null, exit })
  }, [removeToast])

  const startAutoTimer = useCallback((toast) => {
    clearToastTimer(toast.id)
    const auto = setTimeout(() => beginExit(toast.id), toast.duration || 4500)
    timersRef.current.set(toast.id, { auto, exit: null })
  }, [beginExit, clearToastTimer])

  useEffect(() => {
    const unsub = subscribeToasts((toast) => {
      if (!toast._born) toast._born = Date.now()
      startAutoTimer(toast)
      setToasts((prev) => [...prev, toast])
    })
    return () => {
      unsub()
      timersRef.current.forEach((t) => {
        clearTimeout(t.auto)
        clearTimeout(t.exit)
      })
      timersRef.current.clear()
    }
  }, [startAutoTimer])

  useEffect(() => {
    if (toasts.length <= MAX_TOASTS) return
    const active = toasts.filter((t) => !leavingIds.has(t.id))
    if (active.length <= MAX_TOASTS) return
    const toClose = active.slice(0, active.length - MAX_TOASTS)
    toClose.forEach((t, i) => {
      setTimeout(() => beginExit(t.id), i * 180)
    })
  }, [toasts, leavingIds, beginExit])

  useEffect(() => {
    const iv = setInterval(() => {
      const now = Date.now()
      setToasts((prev) => {
        let changed = false
        const next = prev.filter((t) => {
          const born = t._born || 0
          const maxLife = (t.duration || 4500) + EXIT_MS + 4000
          if (born && now - born > maxLife) {
            clearToastTimer(t.id)
            leavingRef.current.delete(t.id)
            changed = true
            return false
          }
          return true
        })
        if (changed) {
          setLeavingIds((prevLeave) => {
            const nextLeave = new Set(prevLeave)
            for (const t of prev) {
              if (!next.includes(t)) nextLeave.delete(t.id)
            }
            return nextLeave
          })
        }
        return changed ? next : prev
      })
    }, 2000)
    return () => clearInterval(iv)
  }, [clearToastTimer])

  if (!toasts.length) return null

  return (
    <div className="fixed bottom-5 right-5 z-[80] flex flex-col gap-2 pointer-events-none">
      {toasts.map((toast) => (
        <ToastItem
          key={toast.id}
          toast={toast}
          theme={theme}
          leaving={leavingIds.has(toast.id)}
          onManualClose={() => beginExit(toast.id)}
        />
      ))}
    </div>
  )
}
