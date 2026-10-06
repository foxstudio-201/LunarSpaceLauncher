import { useCallback, useEffect, useState } from 'react'
import { User, Plus, Check, Trash, Copy, Warning, Info } from '@phosphor-icons/react'
import { t } from '../../i18n/translations'
import { palette } from '../../lib/palette'
import PageHeader from '../ui/PageHeader'
import HeadSkin from '../ui/HeadSkin'
import * as api from '../../api/client.js'

const MC_NAME = /^[A-Za-z0-9_]{3,16}$/

export default function AccountsPage({ theme, lang, accounts, activeAccountId, onAccountsChanged }) {
  const c = palette(theme)
  const [draft, setDraft] = useState('')
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState('')
  const [flash, setFlash] = useState(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!flash) return undefined
    const id = setTimeout(() => setFlash(null), 2600)
    return () => clearTimeout(id)
  }, [flash])

  const notify = (message, tone = 'ok') => setFlash({ message, tone })

  const apply = useCallback(async (res, okMessage) => {
    if (!res?.ok) {
      setError(res?.error || 'error')
      return false
    }
    setError('')
    onAccountsChanged?.(res.accounts, res.activeAccountId)
    if (okMessage) notify(okMessage)
    return true
  }, [onAccountsChanged])

  const add = async () => {
    const name = draft.trim()
    if (!MC_NAME.test(name)) {
      setError(t(lang, 'accounts.nameRule'))
      return
    }
    setBusy(true)
    const res = await api.addAccount({ name })
    setBusy(false)
    const ok = await apply(res, res?.duplicate ? t(lang, 'accounts.duplicate') : t(lang, 'accounts.added'))
    if (ok) {
      setDraft('')
      setAdding(false)
    }
  }

  const setActive = async (id) => {
    const res = await api.setActiveAccount({ id })
    await apply(res)
  }

  const remove = async (account) => {
    const res = await api.removeAccount({ id: account.id })
    await apply(res, t(lang, 'accounts.removed'))
  }

  const copyUuid = (uuid) => {
    api.copyText(uuid).then(() => notify(t(lang, 'accounts.uuidCopied'))).catch(() => {})
  }

  const list = accounts || []

  return (
    <div data-surface className="h-full flex flex-col overflow-hidden" style={{ background: c.bg }}>
      <PageHeader theme={theme} title={t(lang, 'accounts.title')} subtitle={t(lang, 'accounts.subtitle')}>
        {flash && (
          <span
            className="text-[10px] px-2 py-1 rounded-md font-semibold"
            style={{
              background: flash.tone === 'bad' ? 'rgba(239,68,68,0.14)' : 'rgba(167,139,250,0.14)',
              color: flash.tone === 'bad' ? '#f87171' : c.accent,
            }}
          >
            {flash.message}
          </span>
        )}
        <span className="text-[10px] font-mono" style={{ color: c.faint }}>
          {list.length} {t(lang, 'files.items')}
        </span>
        <button
          onClick={() => { setAdding((v) => !v); setError('') }}
          className="h-9 px-3 rounded-lg text-xs font-semibold flex items-center gap-2"
          style={{ background: c.accent, color: '#12081f' }}
        >
          <Plus size={14} weight="bold" />
          {t(lang, 'accounts.add')}
        </button>
      </PageHeader>

      <div className="flex-1 min-h-0 overflow-y-auto px-6 py-4">
        <div className="max-w-3xl mx-auto flex flex-col gap-3">
          <div className="flex items-start gap-2 px-3 py-2 rounded-lg text-[11px]" style={{ background: c.input, border: `1px solid ${c.border}`, color: c.label }}>
            <Info size={13} weight="duotone" style={{ color: c.accent, marginTop: 1 }} />
            <span>{t(lang, 'accounts.offlineHint')}</span>
          </div>

          {adding && (
            <div className="flex flex-col gap-2 rounded-xl p-3" style={{ background: c.surface, border: `1px solid ${c.accent}` }}>
              <div className="flex items-center gap-2">
                <HeadSkin name={draft.trim() || 'steve'} size={36} radius={8} theme={theme} />
                <input
                  autoFocus
                  value={draft}
                  maxLength={16}
                  onChange={(e) => { setDraft(e.target.value); setError('') }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') add()
                    if (e.key === 'Escape') { setAdding(false); setDraft(''); setError('') }
                  }}
                  placeholder={t(lang, 'accounts.namePlaceholder')}
                  className="flex-1 h-9 px-3 rounded-lg text-xs outline-none"
                  style={{ background: c.input, border: `1px solid ${c.border}`, color: c.text }}
                />
                <button
                  disabled={busy || !MC_NAME.test(draft.trim())}
                  onClick={add}
                  className="h-9 px-3 rounded-lg text-xs font-bold disabled:opacity-40"
                  style={{ background: c.accent, color: '#12081f' }}
                >
                  {t(lang, 'files.create')}
                </button>
                <button
                  onClick={() => { setAdding(false); setDraft(''); setError('') }}
                  className="h-9 px-2 rounded-lg text-xs font-semibold"
                  style={{ color: c.label }}
                >
                  {t(lang, 'files.cancel')}
                </button>
              </div>
              <p className="text-[10px]" style={{ color: error ? '#f87171' : c.faint }}>
                {error || t(lang, 'accounts.nameRule')}
              </p>
            </div>
          )}

          {!adding && error && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg text-[11px]" style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', color: '#f87171' }}>
              <Warning size={13} weight="duotone" />
              {error}
            </div>
          )}

          {list.length === 0 ? (
            <div className="text-center py-16">
              <User size={28} weight="duotone" className="mx-auto mb-3" style={{ color: c.faint }} />
              <p className="text-sm" style={{ color: c.label }}>{t(lang, 'accounts.empty')}</p>
              <p className="text-[10px] mt-1" style={{ color: c.faint }}>{t(lang, 'accounts.emptyHint')}</p>
            </div>
          ) : (
            <div className="rounded-xl overflow-hidden" style={{ background: c.surface, border: `1px solid ${c.border}` }}>
              {list.map((account, i) => {
                const active = account.id === activeAccountId
                return (
                  <div
                    key={account.id}
                    className="flex items-center gap-3 px-3.5 py-3"
                    style={{ borderTop: i === 0 ? 'none' : `1px solid ${c.border}` }}
                  >
                    <HeadSkin name={account.name} uuid={account.uuid} size={40} radius={9} theme={theme} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="text-xs font-bold truncate" style={{ color: c.text }}>{account.name}</p>
                        <span className="text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded shrink-0" style={{ background: c.input, color: c.label }}>
                          {t(lang, 'accounts.offline')}
                        </span>
                      </div>
                      <button
                        onClick={() => copyUuid(account.uuid)}
                        data-tip={t(lang, 'accounts.copyUuid')}
                        className="group flex items-center gap-1.5 mt-0.5 max-w-full"
                      >
                        <span className="text-[10px] font-mono truncate" style={{ color: c.faint }}>{account.uuid}</span>
                        <Copy size={11} style={{ color: c.faint }} />
                      </button>
                    </div>
                    {active ? (
                      <span className="flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-bold shrink-0" style={{ background: 'rgba(167,139,250,0.15)', color: c.accent }}>
                        <Check size={11} weight="bold" />
                        {t(lang, 'accounts.active')}
                      </span>
                    ) : (
                      <button
                        onClick={() => setActive(account.id)}
                        className="h-7 px-2.5 rounded-md text-[10px] font-semibold shrink-0"
                        style={{ background: c.input, border: `1px solid ${c.border}`, color: c.label }}
                      >
                        {t(lang, 'accounts.use')}
                      </button>
                    )}
                    <button
                      onClick={() => remove(account)}
                      data-tip={t(lang, 'accounts.remove')}
                      className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0"
                      style={{ color: '#ef4444' }}
                    >
                      <Trash size={14} />
                    </button>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
