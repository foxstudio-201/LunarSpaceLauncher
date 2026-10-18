import { useEffect, useState } from 'react'
import { Warning } from '@phosphor-icons/react'
import { t } from '../../i18n/translations'
import { palette } from '../../lib/palette'

export default function ConfirmModal({
  theme, lang, open, title, message, confirmLabel, cancelLabel, busy = false, tone = 'danger', onCancel, onConfirm,
}) {
  const c = palette(theme)
  const [mounted, setMounted] = useState(open)
  const [closing, setClosing] = useState(false)

  useEffect(() => {
    if (open) {
      setMounted(true)
      setClosing(false)
      return undefined
    }
    if (!mounted) return undefined
    setClosing(true)
    const timer = setTimeout(() => setMounted(false), 170)
    return () => clearTimeout(timer)
  }, [open, mounted])

  useEffect(() => {
    if (!mounted) return undefined
    const onKey = (event) => {
      if (event.key === 'Escape' && open && !busy) onCancel?.()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [mounted, open, busy, onCancel])

  if (!mounted) return null

  const accent = tone === 'danger' ? '#ef4444' : c.accent

  return (
    <div
      className={`modal-backdrop fixed inset-0 z-[210] flex items-center justify-center p-6${closing ? ' closing' : ''}`}
      style={{ pointerEvents: closing ? 'none' : 'auto' }}
      onClick={() => { if (!busy) onCancel?.() }}
      onContextMenu={(event) => { event.preventDefault(); if (!busy) onCancel?.() }}
    >
      <div
        className={`modal-content w-full max-w-sm rounded-2xl p-5 flex flex-col gap-3${closing ? ' closing' : ''}`}
        style={{ background: c.bg, border: `1px solid ${c.border}` }}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center gap-2">
          <Warning size={17} weight="duotone" style={{ color: accent }} />
          <p className="text-sm font-bold" style={{ color: c.text }}>{title || t(lang, 'files.confirmTitle')}</p>
        </div>
        <p className="text-[11px] leading-relaxed" style={{ color: c.label }}>{message}</p>
        <div className="flex justify-end gap-2 pt-1">
          <button
            onClick={() => onCancel?.()}
            disabled={busy}
            className="h-9 px-3 rounded-lg text-[11px] font-semibold disabled:opacity-40"
            style={{ background: c.surface, border: `1px solid ${c.border}`, color: c.label }}
          >
            {cancelLabel || t(lang, 'files.cancel')}
          </button>
          <button
            onClick={() => onConfirm?.()}
            disabled={busy}
            className="h-9 px-3 rounded-lg text-[11px] font-bold disabled:opacity-40"
            style={{ background: accent, color: '#fff' }}
          >
            {confirmLabel || t(lang, 'files.toTrash')}
          </button>
        </div>
      </div>
    </div>
  )
}
