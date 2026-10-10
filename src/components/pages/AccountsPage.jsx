import { useCallback, useEffect, useState } from 'react'
import { User, Plus, Check, Trash, Copy, Warning, Info, ArrowsClockwise, DiscordLogo, X } from '@phosphor-icons/react'
import { t } from '../../i18n/translations'
import { palette } from '../../lib/palette'
import PageHeader from '../ui/PageHeader'
import HeadSkin from '../ui/HeadSkin'
import AddAccountModal from '../accounts/AddAccountModal.jsx'
import DiscordLinkModal from '../accounts/DiscordLinkModal.jsx'
import * as api from '../../api/client.js'

const TYPE_LABELS = {
  offline: 'accounts.kind.offline',
  microsoft: 'accounts.kind.microsoft',
  ely: 'accounts.kind.ely',
}

export default function AccountsPage({ theme, lang, accounts, activeAccountId, onAccountsChanged }) {
  const c = palette(theme)
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState('')
  const [flash, setFlash] = useState(null)
  const [refreshing, setRefreshing] = useState('')
  const [links, setLinks] = useState([])
  const [discord, setDiscord] = useState(null)

  const loadLinks = useCallback(async () => {
    const res = await api.discordLinkList()
    setLinks(res?.ok && Array.isArray(res.items) ? res.items : [])
    return res
  }, [])

  useEffect(() => {
    loadLinks()
  }, [loadLinks])

  useEffect(() => {
    const off = api.onDiscordEvent((event) => {
      if (!event) return
      if (event.type === 'linked') {
        loadLinks()
      } else if (event.type === 'unlinked') {
        loadLinks()
        notify(t(lang, 'discord.unlinked'))
      }
    })
    api.discordLinkPending().then((res) => {
      if (res?.event?.type === 'linked') loadLinks()
    })
    return off
  }, [lang, loadLinks])

  const linkOf = (account) => links.find((item) => item.accountUuid === account.uuid || item.accountId === account.id) || null

  const openDiscord = (options) => setDiscord(options || { start: false })

  const unlink = async (account) => {
    const res = await api.discordLinkUnlink({ accountId: account.id })
    if (!res?.ok) {
      notify(res?.error || 'error', 'bad')
      return
    }
    notify(t(lang, 'discord.unlinked'))
    loadLinks()
  }

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

  const setActive = async (id) => {
    const res = await api.setActiveAccount({ id })
    await apply(res)
  }

  const remove = async (account) => {
    const res = await api.removeAccount({ id: account.id })
    await apply(res, t(lang, 'accounts.removed'))
  }

  const refresh = async (account) => {
    setRefreshing(account.id)
    const res = await api.refreshAccount({ id: account.id })
    setRefreshing('')
    if (!res?.ok) {
      notify(res?.error || 'error', 'bad')
      return
    }
    if (res.offline) notify(t(lang, 'accounts.refresh.offline'), 'bad')
    else notify(t(lang, 'accounts.refresh.done'))
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
          onClick={() => openDiscord({ start: false })}
          className="h-9 px-3 rounded-lg text-xs font-semibold flex items-center gap-2"
          style={{ background: c.input, border: `1px solid ${c.border}`, color: c.text }}
        >
          <DiscordLogo size={14} weight="duotone" style={{ color: '#5865f2' }} />
          {t(lang, 'discord.link')}
        </button>
        <button
          onClick={() => { setAdding(true); setError('') }}
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
            <span>{t(lang, 'accounts.hint')}</span>
          </div>

          {error && (
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
                const online = ['microsoft', 'ely'].includes(account.type)
                return (
                  <div
                    key={account.id}
                    className="flex items-center gap-3 px-3.5 py-3"
                    style={{ borderTop: i === 0 ? 'none' : `1px solid ${c.border}` }}
                  >
                    <HeadSkin name={account.name} uuid={account.uuid} type={account.type} size={40} radius={9} theme={theme} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="text-xs font-bold truncate" style={{ color: c.text }}>{account.name}</p>
                        <span
                          className="text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded shrink-0"
                          style={{ background: online ? 'rgba(167,139,250,0.14)' : c.input, color: online ? c.accent : c.label }}
                        >
                          {t(lang, TYPE_LABELS[account.type] || 'accounts.kind.offline')}
                        </span>
                        {linkOf(account) && (
                          <span
                            className="flex items-center gap-1 text-[9px] font-bold px-1.5 py-0.5 rounded shrink-0"
                            style={{ background: 'rgba(88,101,242,0.16)', color: '#8b95f7' }}
                            data-tip={linkOf(account).discordTag || linkOf(account).discordId}
                          >
                            <DiscordLogo size={10} weight="fill" />
                            {linkOf(account).label || linkOf(account).discordName || linkOf(account).discordTag}
                          </span>
                        )}
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
                    {linkOf(account) ? (
                      <button
                        onClick={() => unlink(account)}
                        data-tip={t(lang, 'discord.unlink')}
                        className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0"
                        style={{ background: 'rgba(88,101,242,0.14)', border: '1px solid rgba(88,101,242,0.4)', color: '#8b95f7' }}
                      >
                        <X size={12} weight="bold" />
                      </button>
                    ) : (
                      <button
                        onClick={() => openDiscord({ accountId: account.id, name: account.name, start: true })}
                        data-tip={t(lang, 'discord.link')}
                        className="h-7 px-2 rounded-md flex items-center gap-1.5 shrink-0 text-[10px] font-bold"
                        style={{ background: 'rgba(88,101,242,0.12)', border: '1px solid rgba(88,101,242,0.35)', color: '#8b95f7' }}
                      >
                        <DiscordLogo size={12} weight="fill" />
                        {t(lang, 'discord.link')}
                      </button>
                    )}
                    {online && (
                      <button
                        onClick={() => refresh(account)}
                        disabled={refreshing === account.id}
                        data-tip={t(lang, 'accounts.refresh')}
                        className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0 disabled:opacity-40"
                        style={{ background: c.input, border: `1px solid ${c.border}`, color: c.label }}
                      >
                        <ArrowsClockwise size={13} weight="bold" className={refreshing === account.id ? 'animate-spin' : ''} />
                      </button>
                    )}
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

      {adding && (
        <AddAccountModal
          theme={theme}
          lang={lang}
          notify={notify}
          onClose={() => setAdding(false)}
          onDiscordLink={({ name }) => openDiscord({ name, start: true })}
          onAdded={async (nextAccounts, nextActive) => {
            setError('')
            onAccountsChanged?.(nextAccounts, nextActive)
          }}
        />
      )}

      {discord && (
        <DiscordLinkModal
          theme={theme}
          lang={lang}
          accounts={list}
          initialAccountId={discord.accountId}
          initialName={discord.name || ''}
          startImmediately={!!discord.start}
          notify={notify}
          onChanged={loadLinks}
          onClose={() => setDiscord(null)}
        />
      )}
    </div>
  )
}

