import { useEffect, useState } from 'react'
import {
  X, User, WindowsLogo, ShieldCheck, Globe, Eye, EyeSlash, CircleNotch,
  Warning, CheckCircle, DiscordLogo, ArrowSquareOut,
} from '@phosphor-icons/react'
import { t } from '../../i18n/translations'
import { palette } from '../../lib/palette'
import HeadSkin from '../ui/HeadSkin'
import * as api from '../../api/client.js'

const MC_NAME = /^[A-Za-z0-9_]{3,16}$/

const KINDS = [
  { id: 'offline', icon: User, label: 'accounts.kind.offline', desc: 'accounts.offline.desc' },
  { id: 'microsoft', icon: WindowsLogo, label: 'accounts.kind.microsoft', desc: 'accounts.ms.desc' },
  { id: 'ely', icon: Globe, label: 'accounts.kind.ely', desc: 'accounts.ely.desc' },
  { id: 'discord', icon: DiscordLogo, label: 'accounts.kind.discord', desc: 'accounts.discord.desc', tone: '#5865f2' },
]

export default function AddAccountModal({ theme, lang, onClose, onAdded, onDiscordLink, notify }) {
  const c = palette(theme)
  const tr = (key) => t(lang, key)
  const [kind, setKind] = useState('offline')
  const [name, setName] = useState('')
  const [user, setUser] = useState('')
  const [pass, setPass] = useState('')
  const [showPass, setShowPass] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [discordName, setDiscordName] = useState('')

  const discord = kind === 'discord'

  useEffect(() => {
    const onKey = (event) => {
      if (event.key === 'Escape' && !busy) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [busy, onClose])

  const pick = (id) => {
    if (busy) return
    setKind(id)
    setError('')
  }

  const done = (res, message) => {
    if (!res?.ok) {
      setError(res?.error || 'error')
      return
    }
    onAdded?.(res.accounts, res.activeAccountId)
    notify?.(message, 'ok')
    onClose()
  }

  const submitOffline = async () => {
    const clean = name.trim()
    if (!MC_NAME.test(clean)) {
      setError(tr('accounts.nameRule'))
      return
    }
    setBusy(true)
    const res = await api.addAccount({ name: clean })
    setBusy(false)
    done(res, res?.duplicate ? tr('accounts.duplicate') : tr('accounts.added'))
  }

  const submitMicrosoft = async () => {
    setBusy(true)
    setError('')
    const res = await api.signInAccount({ type: 'microsoft' })
    setBusy(false)
    done(res, tr('accounts.ms.added'))
  }

  const submitEly = async () => {
    if (!user.trim() || !pass) {
      setError(tr('accounts.ely.needBoth'))
      return
    }
    setBusy(true)
    setError('')
    const res = await api.signInAccount({ type: 'ely', username: user.trim(), password: pass })
    setBusy(false)
    setPass('')
    done(res, tr('accounts.ely.added'))
  }

  const submitDiscord = () => {
    onDiscordLink?.({ name: discordName.trim() })
    onClose()
  }

  const canSubmit =
    kind === 'offline' ? MC_NAME.test(name.trim())
      : kind === 'microsoft' ? true
        : kind === 'ely' ? !!user.trim() && !!pass
          : true

  const submit = kind === 'offline' ? submitOffline : kind === 'microsoft' ? submitMicrosoft : kind === 'ely' ? submitEly : submitDiscord
  const input = { background: c.input, border: `1px solid ${c.border}`, color: c.text }
  const active = KINDS.find((item) => item.id === kind)

  return (
    <div
      className="modal-backdrop fixed inset-0 z-[210] flex items-center justify-center p-6"
      onClick={() => { if (!busy) onClose() }}
    >
      <div
        className="modal-content w-full max-w-[560px] rounded-2xl flex flex-col overflow-hidden"
        style={{ background: c.surface, border: `1px solid ${c.border}` }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 px-4 py-3" style={{ borderBottom: `1px solid ${c.border}` }}>
          <User size={15} weight="duotone" style={{ color: c.accent }} />
          <p className="text-[12px] font-bold flex-1" style={{ color: c.text }}>{tr('accounts.modal.title')}</p>
          <button onClick={() => { if (!busy) onClose() }} className="w-6 h-6 rounded-md flex items-center justify-center" style={{ color: c.label }}>
            <X size={13} weight="bold" />
          </button>
        </div>

        <div className="grid grid-cols-4 gap-2 px-4 pt-3">
          {KINDS.map((item) => {
            const on = kind === item.id
            const Icon = item.icon
            const tint = item.tone || c.accent
            return (
              <button
                key={item.id}
                onClick={() => pick(item.id)}
                className="flex flex-col items-start gap-1.5 px-2.5 py-2.5 rounded-xl text-left transition-colors"
                style={{ background: on ? c.input : 'transparent', border: `1px solid ${on ? tint : c.border}` }}
              >
                <Icon size={15} weight="duotone" style={{ color: on ? tint : c.label }} />
                <span className="text-[11px] font-bold" style={{ color: on ? c.text : c.label }}>{tr(item.label)}</span>
              </button>
            )
          })}
        </div>

        <div className="px-4 py-3 flex flex-col gap-3">
          <p className="text-[10.5px] leading-relaxed" style={{ color: c.faint }}>
            {tr(active.desc)}
          </p>

          {kind === 'offline' && (
            <div className="flex items-center gap-2.5">
              <HeadSkin name={name.trim()} size={38} radius={9} theme={theme} />
              <input
                autoFocus
                value={name}
                maxLength={16}
                onChange={(e) => { setName(e.target.value); setError('') }}
                onKeyDown={(e) => { if (e.key === 'Enter' && canSubmit && !busy) submit() }}
                placeholder={tr('accounts.namePlaceholder')}
                className="flex-1 h-9 px-3 rounded-lg text-xs outline-none"
                style={input}
              />
            </div>
          )}

          {kind === 'microsoft' && (
            <div className="flex flex-col gap-2">
              <div className="flex items-start gap-2 px-3 py-2 rounded-lg text-[10.5px] leading-relaxed" style={{ background: c.input, border: `1px solid ${c.border}`, color: c.label }}>
                <ShieldCheck size={13} weight="duotone" style={{ color: c.accent, marginTop: 1 }} />
                <span>{tr('accounts.ms.note')}</span>
              </div>
              {busy && (
                <div className="flex items-center gap-2 text-[11px]" style={{ color: c.label }}>
                  <CircleNotch size={13} weight="bold" className="animate-spin" style={{ color: c.accent }} />
                  {tr('accounts.ms.waiting')}
                </div>
              )}
            </div>
          )}

          {kind === 'ely' && (
            <div className="flex flex-col gap-2">
              <input
                autoFocus
                value={user}
                onChange={(e) => { setUser(e.target.value); setError('') }}
                placeholder={tr('accounts.ely.user')}
                className="h-9 px-3 rounded-lg text-xs outline-none"
                style={input}
              />
              <div className="relative">
                <input
                  value={pass}
                  onChange={(e) => { setPass(e.target.value); setError('') }}
                  onKeyDown={(e) => { if (e.key === 'Enter' && canSubmit && !busy) submit() }}
                  type={showPass ? 'text' : 'password'}
                  placeholder={tr('accounts.ely.pass')}
                  className="w-full h-9 pl-3 pr-9 rounded-lg text-xs outline-none"
                  style={input}
                />
                <button
                  type="button"
                  onClick={() => setShowPass((v) => !v)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 w-6 h-6 flex items-center justify-center"
                  style={{ color: c.faint }}
                  aria-label={tr('accounts.ely.togglePass')}
                >
                  {showPass ? <EyeSlash size={13} /> : <Eye size={13} />}
                </button>
              </div>
              <div className="flex items-start gap-2 px-3 py-2 rounded-lg text-[10.5px] leading-relaxed" style={{ background: c.input, border: `1px solid ${c.border}`, color: c.label }}>
                <ShieldCheck size={13} weight="duotone" style={{ color: c.accent, marginTop: 1 }} />
                <span>{tr('accounts.ely.injector')}</span>
              </div>
            </div>
          )}

          {discord && (
            <div className="flex items-center gap-2.5">
              <HeadSkin name={discordName.trim()} size={38} radius={9} theme={theme} />
              <div className="min-w-0 flex-1">
                <p className="text-[10px] font-bold mb-1" style={{ color: c.label }}>{tr('discord.accountName')}</p>
                <input
                  autoFocus
                  value={discordName}
                  maxLength={16}
                  disabled={busy}
                  onChange={(e) => { setDiscordName(e.target.value); setError('') }}
                  onKeyDown={(e) => { if (e.key === 'Enter' && !busy) submitDiscord() }}
                  placeholder={tr('discord.accountNamePlaceholder')}
                  className="w-full h-9 px-3 rounded-lg text-xs outline-none"
                  style={input}
                />
              </div>
            </div>
          )}

          {discord && (
            <div className="flex items-start gap-2 px-3 py-2 rounded-lg text-[10.5px] leading-relaxed" style={{ background: c.input, border: `1px solid ${c.border}`, color: c.label }}>
              <ArrowSquareOut size={13} weight="duotone" style={{ color: '#5865f2', marginTop: 1 }} />
              <span>{tr('discord.accountWillCreate')}</span>
            </div>
          )}

          {error && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg text-[11px]" style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', color: '#f87171' }}>
              <Warning size={13} weight="duotone" />
              <span className="flex-1">{error}</span>
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 px-4 py-3" style={{ borderTop: `1px solid ${c.border}` }}>
          <span className="flex-1 text-[10px]" style={{ color: c.faint }}>
            {discord
              ? tr('discord.subtitle')
              : kind === 'offline' ? tr('accounts.nameRule') : kind === 'microsoft' ? tr('accounts.ms.hint') : tr('accounts.ely.hint')}
          </span>
          <button onClick={() => { if (!busy) onClose() }} className="h-8 px-3 rounded-lg text-[11px] font-semibold" style={{ color: c.label }}>
            {tr('files.cancel')}
          </button>
          <button
            onClick={submit}
            disabled={busy || !canSubmit}
            className="h-8 px-3.5 rounded-lg text-[11px] font-bold flex items-center gap-2 disabled:opacity-40"
            style={{ background: discord ? '#5865f2' : c.accent, color: discord ? '#ffffff' : '#12081f' }}
          >
            {busy ? (
              <CircleNotch size={12} weight="bold" className="animate-spin" />
            ) : discord ? (
              <DiscordLogo size={12} weight="bold" />
            ) : (
              <CheckCircle size={12} weight="bold" />
            )}
            {discord ? tr('discord.webVerify') : kind === 'offline' ? tr('files.create') : tr('accounts.login')}
          </button>
        </div>
      </div>
    </div>
  )
}
