import { useCallback, useEffect, useRef, useState } from 'react'
import { X, Sparkle, CircleNotch, ArrowSquareOut, WarningCircle, ArrowsClockwise } from '@phosphor-icons/react'
import { t } from '../../i18n/translations'
import { palette } from '../../lib/palette'
import RichText from '../instance/RichText.jsx'
import * as api from '../../api/client.js'

const formatDate = (value, lang) => {
  if (!value) return ''
  try {
    return new Date(value).toLocaleDateString(lang === 'en' ? 'en-US' : 'vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' })
  } catch {
    return ''
  }
}

export default function ReleaseNotesModal({ theme, lang, version, onClose }) {
  const c = palette(theme)
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const bodyRef = useRef(null)

  const load = useCallback(async (force) => {
    setLoading(true)
    setError('')
    const res = await api.releaseNotes({ version, force: !!force }).catch((err) => ({ ok: false, error: err.message }))
    setLoading(false)
    if (!res?.ok) {
      setError(res?.error || 'error')
      return
    }
    setData(res)
  }, [version])

  useEffect(() => {
    load(false)
  }, [load])

  useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = 0
  }, [data, loading])

  useEffect(() => {
    const onKey = (event) => {
      if (event.key === 'Escape') onClose?.()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const hasImages = /!\[|<img/i.test(data?.body || '')

  return (
    <div className="modal-backdrop fixed inset-0 z-[230] flex items-center justify-center p-6" onClick={() => onClose?.()}>
      <div
        className="modal-content w-full max-w-[640px] max-h-[86vh] rounded-2xl flex flex-col overflow-hidden"
        style={{ background: c.surface, border: `1px solid ${c.border}` }}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="shrink-0 flex items-center gap-2 px-4 py-3" style={{ borderBottom: `1px solid ${c.border}` }}>
          <Sparkle size={16} weight="duotone" style={{ color: c.accent }} />
          <p className="text-[12px] font-bold flex-1" style={{ color: c.text }}>{t(lang, 'whatsnew.title')}</p>
          {version && (
            <span className="px-2 py-0.5 rounded-md text-[10px] font-bold font-mono" style={{ background: c.input, border: `1px solid ${c.border}`, color: c.accent }}>
              v{version}
            </span>
          )}
          <button onClick={() => onClose?.()} className="w-6 h-6 rounded-md flex items-center justify-center" style={{ color: c.label }}>
            <X size={13} weight="bold" />
          </button>
        </div>

        <div ref={bodyRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          {loading ? (
            <div className="flex items-center gap-2 py-8 justify-center text-[11px]" style={{ color: c.label }}>
              <CircleNotch size={14} weight="bold" className="animate-spin" style={{ color: c.accent }} />
              {t(lang, 'whatsnew.loading')}
            </div>
          ) : error ? (
            <div className="flex flex-col gap-3 py-4">
              <div className="flex items-start gap-2 px-3 py-2 rounded-lg text-[11px]" style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', color: '#f87171' }}>
                <WarningCircle size={13} weight="duotone" style={{ marginTop: 1 }} />
                <span className="flex-1">{error}</span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => load(true)}
                  className="h-8 px-3 rounded-lg text-[11px] font-bold flex items-center gap-1.5"
                  style={{ background: c.input, border: `1px solid ${c.border}`, color: c.text }}
                >
                  <ArrowsClockwise size={12} weight="bold" />
                  {t(lang, 'whatsnew.retry')}
                </button>
                <a
                  href={`https://github.com/foxstudio-201/LunarSpaceLauncher/releases/tag/v${version}`}
                  onClick={(event) => { event.preventDefault(); api.openExternal(`https://github.com/foxstudio-201/LunarSpaceLauncher/releases/tag/v${version}`).catch(() => {}) }}
                  className="h-8 px-3 rounded-lg text-[11px] font-semibold flex items-center gap-1.5"
                  style={{ color: c.label }}
                >
                  <ArrowSquareOut size={12} weight="bold" />
                  {t(lang, 'whatsnew.github')}
                </a>
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-2 text-[10.5px]" style={{ color: c.faint }}>
                <span className="font-bold" style={{ color: c.label }}>{data?.name || `v${version}`}</span>
                {data?.publishedAt && <span>· {formatDate(data.publishedAt, lang)}</span>}
                {data?.cached && <span>· {t(lang, 'whatsnew.offline')}</span>}
              </div>
              {data?.body ? (
                <RichText raw={data.body} c={c} className="whatsnew-body" style={{ fontSize: 12.5, lineHeight: 1.55 }} />
              ) : (
                <p className="text-[11px]" style={{ color: c.faint }}>{t(lang, 'whatsnew.empty')}</p>
              )}
              {hasImages && <p className="text-[10px]" style={{ color: c.faint }}>{t(lang, 'whatsnew.images')}</p>}
            </div>
          )}
        </div>

        <div className="shrink-0 flex items-center gap-2 px-4 py-3" style={{ borderTop: `1px solid ${c.border}` }}>
          <span className="flex-1 text-[10px]" style={{ color: c.faint }}>{t(lang, 'whatsnew.once')}</span>
          {data?.htmlUrl && (
            <button
              onClick={() => api.openExternal(data.htmlUrl).catch(() => {})}
              className="h-8 px-3 rounded-lg text-[11px] font-semibold flex items-center gap-1.5"
              style={{ background: c.input, border: `1px solid ${c.border}`, color: c.label }}
            >
              <ArrowSquareOut size={12} weight="bold" />
              {t(lang, 'whatsnew.github')}
            </button>
          )}
          <button
            onClick={() => onClose?.()}
            className="h-8 px-3.5 rounded-lg text-[11px] font-bold"
            style={{ background: c.accent, color: '#12081f' }}
          >
            {t(lang, 'whatsnew.ok')}
          </button>
        </div>
      </div>
    </div>
  )
}
