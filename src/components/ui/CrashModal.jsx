import { useCallback, useEffect, useState } from 'react'
import {
  WarningOctagon, Copy, UploadSimple, DownloadSimple, X,
  CheckCircle, SpinnerGap, FileText,
} from '@phosphor-icons/react'
import { palette } from '../../lib/palette'
import * as api from '../../api/client.js'

const vn = (lang, vi, en) => (lang === 'vi' ? vi : en)

export default function CrashModal({ crash, theme, lang, onClose }) {
  const c = palette(theme)
  const a = crash?.analysis || {}
  const [busy, setBusy] = useState('')
  const [uploadUrl, setUploadUrl] = useState('')
  const [savedPath, setSavedPath] = useState('')
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const copy = useCallback(async () => {
    try {
      await api.copyText(crash.logText || '')
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    } catch (err) {
      setError(err.message)
    }
  }, [crash])

  const upload = useCallback(async () => {
    setBusy('upload')
    setError('')
    setUploadUrl('')
    try {
      const res = await api.uploadLog({ text: crash.logText || '', label: `LunarSpace Launcher · ${crash.id}` })
      if (res?.ok) setUploadUrl(res.url)
      else setError(res?.error || vn(lang, 'Gửi log thất bại.', 'Upload failed.'))
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy('')
    }
  }, [crash, lang])

  const save = useCallback(async () => {
    setBusy('save')
    setError('')
    setSavedPath('')
    try {
      const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')
      const res = await api.saveLog({ text: crash.logText || '', name: `lunarspace-${crash.id}-${stamp}.log` })
      if (res?.ok) setSavedPath(res.path)
      else if (!res?.canceled) setError(res?.error || vn(lang, 'Không lưu được log.', 'Could not save the log.'))
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy('')
    }
  }, [crash, lang])

  const reveal = (target) => api.revealPath(target).catch(() => {})
  const openUrl = (url) => api.openExternal(url).catch(() => {})

  const btn = 'h-9 px-3 rounded-lg text-[11px] font-semibold flex items-center justify-center gap-1.5 transition-all active:scale-95 disabled:opacity-50'

  const title = lang === 'vi' ? a.title : (a.titleEn || a.title)
  const hint = lang === 'vi' ? a.hint : (a.hintEn || a.hint)

  return (
    <div
      className="modal-backdrop fixed inset-0 z-[200] flex items-center justify-center p-6"
      onClick={onClose}
    >
      <div
        className="modal-content w-full max-w-[620px] max-h-[86vh] flex flex-col rounded-2xl overflow-hidden"
        style={{ background: c.surface, border: `1px solid ${c.border}`, boxShadow: '0 24px 60px rgba(0,0,0,0.55)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="shrink-0 flex items-center gap-3 px-5 py-3.5" style={{ borderBottom: `1px solid ${c.border}` }}>
          <span className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0" style={{ background: 'rgba(239,68,68,0.14)' }}>
            <WarningOctagon size={18} weight="duotone" style={{ color: '#ef4444' }} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-bold" style={{ color: c.text }}>
              {vn(lang, 'Game khởi chạy thất bại', 'The game failed to start')}
            </p>
            <p className="text-[10px] truncate" style={{ color: c.faint }}>
              {crash?.id} · {vn(lang, 'mã thoát', 'exit code')} {crash?.code}
            </p>
          </div>
          <button
            onClick={onClose}
            data-tip={vn(lang, 'Đóng', 'Close')}
            className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 transition-colors"
            style={{ background: c.input, border: `1px solid ${c.border}`, color: c.label }}
          >
            <X size={14} weight="bold" />
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4 flex flex-col gap-3.5">
          <div className="rounded-xl p-3.5 flex flex-col gap-2" style={{ background: c.input, borderLeft: `2px solid #ef4444` }}>
            <p className="text-[11px] font-bold" style={{ color: '#f87171' }}>{title}</p>
            {a.exception && (
              <p className="text-[11px] font-mono break-all leading-relaxed" style={{ color: c.text }}>
                {a.exception}{a.exceptionMessage ? `: ${a.exceptionMessage}` : ''}
              </p>
            )}
            <p className="text-[11px] leading-relaxed" style={{ color: c.label }}>{hint}</p>
          </div>

          {a.chain?.length > 1 && (
            <div className="flex flex-col gap-1">
              <p className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: c.faint }}>
                {vn(lang, 'Chuỗi lỗi', 'Error chain')}
              </p>
              {a.chain.slice(0, 5).map((line, i) => (
                <p key={i} className="text-[10px] font-mono break-all leading-relaxed" style={{ color: c.label }}>
                  {i === 0 ? '· ' : '↳ '}{line}
                </p>
              ))}
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            <div className="flex items-center gap-2">
              <p className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: c.faint }}>
                {vn(lang, 'Đoạn log liên quan', 'Relevant log')}
              </p>
              <span className="text-[10px] font-mono" style={{ color: c.faint }}>
                {a.excerpt?.length || 0} {vn(lang, 'dòng', 'lines')}
              </span>
            </div>
            <pre
              className="text-[10px] leading-relaxed font-mono rounded-lg p-3 max-h-[190px] overflow-auto whitespace-pre-wrap break-all"
              style={{ background: '#0a0a0a', border: `1px solid ${c.border}`, color: '#d1d5db' }}
            >
{(a.excerpt || []).join('\n')}
            </pre>
          </div>

          {uploadUrl && (
            <div className="rounded-lg px-3 py-2 flex items-center gap-2" style={{ background: 'rgba(34,197,94,0.12)', border: '1px solid rgba(34,197,94,0.3)' }}>
              <CheckCircle size={14} weight="fill" style={{ color: '#22c55e' }} className="shrink-0" />
              <span className="text-[11px] font-mono truncate flex-1" style={{ color: '#4ade80' }}>{uploadUrl}</span>
              <button onClick={() => openUrl(uploadUrl)} className="h-7 px-2 rounded-md text-[10px] font-bold shrink-0" style={{ background: 'rgba(34,197,94,0.2)', color: '#4ade80' }}>
                {vn(lang, 'Mở', 'Open')}
              </button>
              <button
                onClick={() => api.copyText(uploadUrl).catch(() => {})}
                className="h-7 px-2 rounded-md text-[10px] font-bold shrink-0"
                style={{ background: 'rgba(34,197,94,0.2)', color: '#4ade80' }}
              >
                {vn(lang, 'Chép link', 'Copy link')}
              </button>
            </div>
          )}

          {savedPath && (
            <div className="rounded-lg px-3 py-2 flex items-center gap-2" style={{ background: 'rgba(34,197,94,0.12)', border: '1px solid rgba(34,197,94,0.3)' }}>
              <CheckCircle size={14} weight="fill" style={{ color: '#22c55e' }} className="shrink-0" />
              <span className="text-[10px] font-mono truncate flex-1" style={{ color: '#4ade80' }}>{savedPath}</span>
              <button onClick={() => reveal(savedPath)} className="h-7 px-2 rounded-md text-[10px] font-bold shrink-0" style={{ background: 'rgba(34,197,94,0.2)', color: '#4ade80' }}>
                {vn(lang, 'Mở thư mục', 'Show')}
              </button>
            </div>
          )}

          {error && (
            <p className="text-[11px] rounded-lg px-3 py-2" style={{ background: 'rgba(239,68,68,0.12)', color: '#f87171' }}>{error}</p>
          )}
        </div>

        <div className="shrink-0 px-5 py-3 flex items-center gap-2 flex-wrap" style={{ borderTop: `1px solid ${c.border}` }}>
          <button onClick={copy} className={btn} style={{ background: c.input, border: `1px solid ${c.border}`, color: c.text }}>
            {copied ? <CheckCircle size={14} weight="fill" style={{ color: '#22c55e' }} /> : <Copy size={14} weight="duotone" />}
            {copied ? vn(lang, 'Đã chép', 'Copied') : vn(lang, 'Chép log', 'Copy log')}
          </button>
          <button onClick={upload} disabled={!!busy} className={btn} style={{ background: c.accent, color: '#0a0a0a' }}>
            {busy === 'upload' ? <SpinnerGap size={14} className="animate-spin" /> : <UploadSimple size={14} weight="bold" />}
            {busy === 'upload' ? vn(lang, 'Đang gửi…', 'Uploading…') : 'mclo.gs'}
          </button>
          <button onClick={save} disabled={!!busy} className={btn} style={{ background: c.input, border: `1px solid ${c.border}`, color: c.text }}>
            {busy === 'save' ? <SpinnerGap size={14} className="animate-spin" /> : <DownloadSimple size={14} weight="bold" />}
            {vn(lang, 'Tải log về máy', 'Download log')}
          </button>
          {(crash?.crashReport || crash?.jvmError) && (
            <button
              onClick={() => reveal(crash.crashReport || crash.jvmError)}
              data-tip={crash.crashReport || crash.jvmError}
              className={btn}
              style={{ background: 'rgba(167,139,250,0.14)', color: c.accent }}
            >
              <FileText size={14} weight="duotone" />
              {crash.crashReport ? 'crash-report' : 'hs_err'}
            </button>
          )}
          <span className="flex-1" />
          <button onClick={onClose} className="h-9 px-3.5 rounded-lg text-[11px] font-bold" style={{ background: c.input, border: `1px solid ${c.border}`, color: c.label }}>
            {vn(lang, 'Đóng', 'Close')}
          </button>
        </div>
      </div>
    </div>
  )
}
