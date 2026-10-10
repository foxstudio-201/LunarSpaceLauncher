import { useCallback, useEffect, useState } from 'react'
import useProgressive from '../ui/useProgressive'
import { Trash, ArrowCounterClockwise, ListBullets, Warning, CaretRight } from '@phosphor-icons/react'
import { t } from '../../i18n/translations'
import { palette } from '../../lib/palette'
import { fileIcon, sizeLabel, stampLabel } from '../../lib/files'
import * as api from '../../api/client.js'

function fill(lang, key, map) {
  let text = t(lang, key)
  for (const [k, v] of Object.entries(map)) text = text.split(`{${k}}`).join(String(v))
  return text
}

const GRID = '1fr 90px 140px 176px'

export default function TrashPage({ instance, theme, lang }) {
  const c = palette(theme)
  const [entries, setEntries] = useState([])
  const progressive = useProgressive(entries.length, { first: 12 })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [flash, setFlash] = useState(null)
  const [pending, setPending] = useState(null)
  const [busy, setBusy] = useState('')

  const hover = theme === 'light' ? 'rgba(139,92,246,0.08)' : 'rgba(167,139,250,0.12)'

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await api.listTrash({ id: instance.id })
      if (!res?.ok) {
        setError(res?.error || 'error')
        setEntries([])
      } else {
        setEntries(res.entries || [])
      }
    } catch (err) {
      setError(err.message)
      setEntries([])
    }
    setLoading(false)
  }, [instance.id])

  useEffect(() => {
    load()
  }, [load])

  const notify = (message, tone = 'ok') => {
    setFlash({ message, tone })
    setTimeout(() => setFlash(null), 2600)
  }

  const restore = async (entry) => {
    setBusy(entry.id)
    const res = await api.restoreTrash({ id: instance.id, entryId: entry.id })
    setBusy('')
    if (!res?.ok) return notify(res?.error || 'error', 'bad')
    notify(fill(lang, 'trash.restored', { name: entry.name }))
    load()
  }

  const purge = async (targets) => {
    setPending(null)
    const ids = targets === 'all' ? entries.map((e) => e.id) : targets.map((e) => e.id)
    setBusy('purge')
    const res = await api.purgeTrash({ id: instance.id, ids })
    setBusy('')
    if (res?.failed?.length) notify(fill(lang, 'trash.purgeFailed', { n: res.failed.length }), 'bad')
    else notify(fill(lang, 'trash.purged', { n: res?.purged ?? ids.length }))
    load()
  }

  const pendingMessage = () => {
    if (!pending) return ''
    if (pending.all) return fill(lang, 'trash.confirmEmpty', { n: entries.length })
    if (pending.items.length === 1) return fill(lang, 'trash.confirmPurgeOne', { name: pending.items[0].name })
    return fill(lang, 'trash.confirmPurge', { n: pending.items.length })
  }

  return (
    <div data-surface className="h-full flex flex-col overflow-hidden" style={{ background: c.bg }}>
      <div className="shrink-0 flex items-center gap-2 px-3 py-2" style={{ borderBottom: `1px solid ${c.border}`, background: c.bar }}>
        <button
          disabled={!entries.length || busy === 'purge'}
          onClick={() => setPending({ all: true })}
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-semibold transition-opacity hover:opacity-85 disabled:opacity-35"
          style={{ background: '#ef4444', color: '#fff' }}
        >
          <Trash size={13} weight="bold" />
          {t(lang, 'trash.emptyAll')}
        </button>
        <button
          onClick={load}
          title={t(lang, 'files.reloadList')}
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-medium"
          style={{ background: c.surface, border: `1px solid ${c.border}`, color: c.label }}
        >
          <ListBullets size={13} weight="bold" />
          {t(lang, 'files.reloadList')}
        </button>

        <div className="flex-1" />

        {flash && (
          <span
            className="text-[10px] px-2 py-0.5 rounded"
            style={{
              background: flash.tone === 'bad' ? 'rgba(239,68,68,0.2)' : hover,
              color: flash.tone === 'bad' ? '#ef4444' : c.accent,
            }}
          >
            {flash.message}
          </span>
        )}
        <span className="text-[10px]" style={{ color: c.label }}>
          {entries.length} {t(lang, 'files.items')}
        </span>
      </div>

      <div className="shrink-0 flex items-center gap-1.5 px-4 py-2.5 mx-3 mt-3 rounded-lg" style={{ background: c.surface, border: `1px solid ${c.border}` }}>
        <span className="text-[12px] font-bold px-1.5 py-0.5 rounded" style={{ color: c.accent }}>~</span>
        <Trash size={11} style={{ color: c.label, opacity: 0.5 }} />
        <span className="text-[12px] font-medium px-1 py-0.5" style={{ color: c.text }}>
          {t(lang, 'instance.trash')}
        </span>
      </div>

      {pending && (
        <div className="shrink-0 mx-3 mt-2 flex items-center gap-3 px-3 py-2 rounded-lg text-[11px]" style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', color: '#f87171' }}>
          <Warning size={13} weight="duotone" />
          <span className="flex-1">{pendingMessage()}</span>
          <button
            onClick={() => setPending(null)}
            className="px-2.5 py-1 rounded-md text-[10px] font-semibold"
            style={{ background: c.input, border: `1px solid ${c.border}`, color: c.label }}
          >
            {t(lang, 'files.cancel')}
          </button>
          <button
            onClick={() => purge(pending.all ? 'all' : pending.items)}
            className="px-2.5 py-1 rounded-md text-[10px] font-bold"
            style={{ background: '#ef4444', color: '#fff' }}
          >
            {t(lang, 'trash.purge')}
          </button>
        </div>
      )}

      <div
        className="shrink-0 mx-3 mt-3 grid items-center px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider"
        style={{
          gridTemplateColumns: GRID,
          background: c.bar,
          borderTop: `1px solid ${c.border}`,
          borderLeft: `1px solid ${c.border}`,
          borderRight: `1px solid ${c.border}`,
          borderBottom: 'none',
          borderTopLeftRadius: 8,
          borderTopRightRadius: 8,
          color: c.label,
        }}
      >
        <span>{t(lang, 'files.name')}</span>
        <span className="text-right">{t(lang, 'files.size')}</span>
        <span className="text-right">{t(lang, 'trash.deletedAt')}</span>
        <span />
      </div>

      <div className="stream-items flex-1 min-h-0 overflow-y-auto mx-3 mb-3 rounded-b-lg" style={{ background: c.surface, borderLeft: `1px solid ${c.border}`, borderRight: `1px solid ${c.border}`, borderBottom: `1px solid ${c.border}`, borderTop: 'none' }}>
        {error ? (
          <div className="px-3 py-4 text-[11px]" style={{ color: '#ef4444' }}>{error}</div>
        ) : loading ? (
          <div className="flex items-center justify-center py-12">
            <span className="text-[12px]" style={{ color: c.label }}>{t(lang, 'home.loading')}</span>
          </div>
        ) : entries.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 gap-2">
            <Trash size={28} weight="duotone" style={{ color: c.label, opacity: 0.4 }} />
            <span className="text-[12px]" style={{ color: c.label }}>{t(lang, 'trash.empty')}</span>
            <span className="text-[11px]" style={{ color: c.label, opacity: 0.7 }}>{t(lang, 'trash.hint')}</span>
          </div>
        ) : (
          entries.slice(0, progressive).map((entry) => (
            <div
              key={entry.id}
              className="grid items-center px-3 transition-colors"
              style={{ gridTemplateColumns: GRID, minHeight: 46, borderBottom: `1px solid ${c.border}` }}
              onMouseEnter={(e) => { e.currentTarget.style.background = hover }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
            >
              <div className="flex items-center gap-2.5 min-w-0 pr-2">
                {fileIcon(entry.name, entry.dir, c.label)}
                <span className="min-w-0 flex flex-col">
                  <span className="text-[12px] font-medium truncate" style={{ color: c.text }}>{entry.name}</span>
                  <span className="text-[10px] font-mono truncate" style={{ color: c.label, opacity: 0.75 }}>
                    <CaretRight size={9} style={{ display: 'inline', verticalAlign: 'middle' }} />
                    {' '}
                    {entry.rel.split('/').slice(0, -1).join('/') || '.'}
                  </span>
                </span>
              </div>
              <span className="text-[11px] text-right font-mono" style={{ color: c.label }}>
                {entry.dir ? '—' : sizeLabel(entry.size)}
              </span>
              <span className="text-[11px] text-right font-mono" style={{ color: c.label }}>
                {stampLabel(entry.deletedAt)}
              </span>
              <span className="flex items-center justify-end gap-1.5">
                <button
                  disabled={busy === entry.id || busy === 'purge'}
                  onClick={() => restore(entry)}
                  className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[10px] font-semibold disabled:opacity-40"
                  style={{ background: c.input, border: `1px solid ${c.border}`, color: c.accent }}
                >
                  <ArrowCounterClockwise size={12} weight="bold" />
                  {t(lang, 'trash.restore')}
                </button>
                <button
                  disabled={busy === entry.id || busy === 'purge'}
                  onClick={() => setPending({ items: [entry] })}
                  title={t(lang, 'trash.purge')}
                  className="p-1 rounded disabled:opacity-40"
                  style={{ color: '#ef4444' }}
                >
                  <Trash size={13} weight="duotone" />
                </button>
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
