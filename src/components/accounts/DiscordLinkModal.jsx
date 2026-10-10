import { useCallback, useEffect, useRef, useState } from 'react'
import { X, DiscordLogo, CircleNotch, Warning, CheckCircle, ArrowSquareOut, ArrowClockwise } from '@phosphor-icons/react'
import { t } from '../../i18n/translations'
import { palette } from '../../lib/palette'
import HeadSkin from '../ui/HeadSkin'
import * as api from '../../api/client.js'

export default function DiscordLinkModal({ theme, lang, accounts = [], initialAccountId, initialName = '', startImmediately = false, notify, onChanged, onClose }) {
  const c = palette(theme)
  const tr = (key, vars) => {
    const raw = t(lang, key)
    if (!vars) return raw
    return raw.replace(/\{(\w+)\}/g, (match, name) => (vars[name] === undefined ? match : String(vars[name])))
  }
  const list = accounts || []

  const [name, setName] = useState(initialName || '')
  const [phase, setPhase] = useState('idle')
  const [error, setError] = useState('')
  const [conflict, setConflict] = useState(null)
  const [authorizeUrl, setAuthorizeUrl] = useState('')
  const [result, setResult] = useState(null)
  const [created, setCreated] = useState(false)
  const [started, setStarted] = useState(false)
  const mounted = useRef(true)

  const known = list.find((item) => String(item.name || '').toLowerCase() === name.trim().toLowerCase()) || null
  const preview = known || (initialAccountId ? list.find((item) => item.id === initialAccountId) : null)

  useEffect(() => () => { mounted.current = false }, [])

  useEffect(() => {
    const onKey = (event) => {
      if (event.key === 'Escape' && phase !== 'waiting') onClose?.()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [phase, onClose])

  const finish = useCallback((link) => {
    if (!mounted.current) return
    setResult(link || null)
    setPhase('done')
    notify?.(tr('discord.success', { name: link?.accountName || name.trim() || '' }))
    onChanged?.()
  }, [name, notify, onChanged, tr])

  useEffect(() => {
    const off = api.onDiscordEvent((event) => {
      if (!event) return
      if (event.type === 'linked') {
        setCreated(!!event.created)
        finish(event.link)
        return
      }
      if (event.type === 'failed') {
        setPhase('error')
        setError(event.error || 'error')
        setConflict(event.conflict ? event.holder || {} : null)
      }
    })
    return off
  }, [finish])

  const start = useCallback(async (options = {}) => {
    const clean = (options.name ?? name).trim()
    if (!clean && !preview) {
      setError(tr('discord.accountNameNeeded'))
      return
    }
    setPhase('starting')
    setError('')
    setConflict(null)
    const res = await api.discordLinkStart({
      accountId: known ? known.id : initialAccountId || '',
      name: known ? '' : clean,
      force: !!options.force,
    })
    if (!res?.ok) {
      setPhase('error')
      setError(res?.error || 'error')
      return
    }
    setAuthorizeUrl(res.authorizeUrl || '')
    setPhase('waiting')
    api.openExternal(res.authorizeUrl).catch(() => {})
    api.appFocus?.()
  }, [name, known, initialAccountId, preview, tr])

  useEffect(() => {
    if (!startImmediately || started) return
    setStarted(true)
    start()
  }, [startImmediately, started, start])

  const override = () => start({ force: true })

  const cancelWaiting = async () => {
    await api.discordLinkCancel()
    setPhase('idle')
    setError('')
  }

  const input = { background: c.input, border: `1px solid ${c.border}`, color: c.text }
  const busy = phase === 'starting'

  return (
    <div className="modal-backdrop fixed inset-0 z-[220] flex items-center justify-center p-6" onClick={() => { if (!busy && phase !== 'waiting') onClose?.() }}>
      <div
        className="modal-content w-full max-w-[520px] rounded-2xl flex flex-col overflow-hidden"
        style={{ background: c.surface, border: `1px solid ${c.border}` }}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center gap-2 px-4 py-3" style={{ borderBottom: `1px solid ${c.border}` }}>
          <DiscordLogo size={16} weight="duotone" style={{ color: '#5865f2' }} />
          <p className="text-[12px] font-bold flex-1" style={{ color: c.text }}>{tr('discord.title')}</p>
          <button onClick={() => { if (!busy && phase !== 'waiting') onClose?.() }} disabled={phase === 'waiting'} className="w-6 h-6 rounded-md flex items-center justify-center disabled:opacity-30" style={{ color: c.label }}>
            <X size={13} weight="bold" />
          </button>
        </div>

        <div className="px-4 py-3 flex flex-col gap-3 overflow-y-auto">
          {phase === 'done' ? (
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-2.5 px-3 py-3 rounded-xl" style={{ background: c.input, border: `1px solid ${c.accent}` }}>
                <CheckCircle size={18} weight="duotone" style={{ color: c.accent }} />
                <div className="min-w-0">
                  <p className="text-[12px] font-bold" style={{ color: c.text }}>{tr('discord.successTitle')}</p>
                  <p className="text-[10.5px] truncate" style={{ color: c.label }}>
                    {result?.discordTag || result?.discordName} → {result?.accountName || name.trim()}
                  </p>
                </div>
                {result?.discordAvatar && <img src={result.discordAvatar} alt="" className="w-9 h-9 rounded-full ml-auto" style={{ border: `1px solid ${c.border}` }} />}
              </div>
              {created && <p className="text-[10.5px]" style={{ color: c.accent }}>{tr('discord.accountCreated', { name: result?.accountName || name.trim() })}</p>}
              {result?.movedFrom && <p className="text-[10.5px]" style={{ color: c.faint }}>{tr('discord.movedFrom', { name: result.movedFrom })}</p>}
              {result?.replaced && !result?.movedFrom && <p className="text-[10.5px]" style={{ color: c.faint }}>{tr('discord.replaced')}</p>}
              <p className="text-[10.5px] leading-relaxed" style={{ color: c.faint }}>{tr('discord.waitingHint')}</p>
            </div>
          ) : (
            <>
              <p className="text-[10.5px] leading-relaxed" style={{ color: c.faint }}>{tr('discord.hint')}</p>

              <div className="flex items-center gap-2.5">
                <HeadSkin name={name.trim()} uuid={known?.uuid} type={known?.type} size={38} radius={9} theme={theme} />
                <div className="min-w-0 flex-1">
                  <p className="text-[10px] font-bold mb-1" style={{ color: c.label }}>{tr('discord.accountName')}</p>
                  <input
                    autoFocus
                    value={name}
                    maxLength={16}
                    disabled={busy || phase === 'waiting'}
                    onChange={(event) => { setName(event.target.value); setError('') }}
                    onKeyDown={(event) => { if (event.key === 'Enter' && !busy && phase !== 'waiting') start({}) }}
                    placeholder={tr('discord.accountNamePlaceholder')}
                    className="w-full h-9 px-3 rounded-lg text-xs outline-none"
                    style={input}
                  />
                </div>
              </div>
              <p className="text-[10px] -mt-1" style={{ color: c.faint }}>
                {known ? tr('discord.accountExists', { name: known.name }) : tr('discord.accountWillCreate')}
              </p>

              {phase === 'waiting' ? (
                <div className="flex flex-col gap-2 px-3 py-3 rounded-xl" style={{ background: c.input, border: `1px solid ${c.border}` }}>
                  <div className="flex items-center gap-2 text-[11px] font-semibold" style={{ color: c.text }}>
                    <CircleNotch size={13} weight="bold" className="animate-spin" style={{ color: c.accent }} />
                    {tr('discord.waiting')}
                  </div>
                  <p className="text-[10px] leading-relaxed" style={{ color: c.faint }}>{tr('discord.waitingHint')}</p>
                  <div className="flex items-center gap-2 mt-1">
                    <button
                      onClick={() => { if (authorizeUrl) api.openExternal(authorizeUrl).catch(() => {}) }}
                      className="h-8 px-3 rounded-lg text-[10.5px] font-semibold flex items-center gap-1.5"
                      style={{ background: c.accent, color: '#12081f' }}
                    >
                      <ArrowSquareOut size={12} weight="bold" />
                      {tr('discord.reopenAuth')}
                    </button>
                    <button
                      onClick={() => api.appFocus?.()}
                      className="h-8 px-3 rounded-lg text-[10.5px] font-semibold flex items-center gap-1.5"
                      style={{ background: c.input, border: `1px solid ${c.border}`, color: c.label }}
                    >
                      <ArrowClockwise size={12} weight="bold" />
                      {tr('discord.reopen')}
                    </button>
                    <button onClick={cancelWaiting} className="h-8 px-2.5 rounded-lg text-[10.5px] font-semibold ml-auto" style={{ color: c.faint }}>
                      {tr('discord.cancel')}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex items-start gap-2 px-3 py-2.5 rounded-xl text-[10.5px] leading-relaxed" style={{ background: c.input, border: `1px solid ${c.border}`, color: c.label }}>
                  <ArrowSquareOut size={13} weight="duotone" style={{ color: c.accent, marginTop: 1 }} />
                  <span>{tr('discord.webHint')}</span>
                </div>
              )}

              {error && (
                <div className="flex items-start gap-2 px-3 py-2 rounded-lg text-[10.5px]" style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', color: '#f87171' }}>
                  <Warning size={13} weight="duotone" style={{ marginTop: 1 }} />
                  <div className="flex-1">
                    <span>{error}</span>
                    {conflict && (
                      <button onClick={override} className="block mt-1.5 h-7 px-2.5 rounded-md text-[10px] font-bold" style={{ background: 'rgba(239,68,68,0.2)', color: '#fca5a5' }}>
                        {tr('discord.override')}
                      </button>
                    )}
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {phase !== 'done' && phase !== 'waiting' && (
          <div className="flex items-center gap-2 px-4 py-3" style={{ borderTop: `1px solid ${c.border}` }}>
            <span className="flex-1 text-[10px]" style={{ color: c.faint }}>{tr('discord.subtitle')}</span>
            <button onClick={() => onClose?.()} className="h-8 px-3 rounded-lg text-[11px] font-semibold" style={{ color: c.label }}>
              {t(lang, 'files.cancel')}
            </button>
            <button
              onClick={() => start({})}
              disabled={busy}
              className="h-8 px-3.5 rounded-lg text-[11px] font-bold flex items-center gap-2 disabled:opacity-40"
              style={{ background: c.accent, color: '#12081f' }}
            >
              {busy ? <CircleNotch size={12} weight="bold" className="animate-spin" /> : <DiscordLogo size={12} weight="bold" />}
              {tr('discord.webVerify')}
            </button>
          </div>
        )}
        {phase === 'done' && (
          <div className="flex items-center gap-2 px-4 py-3" style={{ borderTop: `1px solid ${c.border}` }}>
            <span className="flex-1" />
            <button onClick={() => onClose?.()} className="h-8 px-3.5 rounded-lg text-[11px] font-bold" style={{ background: c.accent, color: '#12081f' }}>
              {t(lang, 'files.done')}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
