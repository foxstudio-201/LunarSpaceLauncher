import { useCallback, useEffect, useState } from 'react'
import { Archive, Clock, FolderOpen, ArrowsClockwise } from '@phosphor-icons/react'
import { t } from '../../i18n/translations'
import { palette } from '../../lib/palette'
import { formatBytes, formatDate } from '../../lib/status'
import * as api from '../../api/client.js'

export default function SavesPage({ instance, theme, lang }) {
  const c = palette(theme)
  const [entries, setEntries] = useState([])
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    try {
      const res = await api.listDir({ id: instance.id, rel: 'saves' })
      if (!res?.ok) return setError(res?.error || 'error')
      setEntries((res.entries || []).filter((e) => e.dir))
      setError('')
    } catch (err) {
      setError(err.message)
    }
  }, [instance.id])

  useEffect(() => {
    load()
  }, [load])

  const reveal = (entry) => api.revealPath(`${instance.dir}\\saves\\${entry.name}`).catch(() => {})

  return (
    <div data-surface className="h-full flex flex-col overflow-hidden" style={{ background: c.bg }}>
      <div className="shrink-0 px-6 py-3.5 flex items-center gap-3" style={{ borderBottom: `1px solid ${c.border}` }}>
        <Archive size={16} weight="duotone" style={{ color: c.accent }} />
        <div className="min-w-0">
          <h1 className="text-sm font-bold" style={{ color: c.text }}>{t(lang, 'instance.saves')}</h1>
          <p className="text-[10px] truncate" style={{ color: c.faint }}>{instance.name} · saves/</p>
        </div>
        <div className="flex-1" />
        <span className="text-[10px] font-mono" style={{ color: c.faint }}>
          {entries.length} {lang === 'vi' ? 'thế giới' : 'worlds'}
        </span>
        <button
          onClick={load}
          data-tip={lang === 'vi' ? 'Làm mới' : 'Refresh'}
          className="w-8 h-8 rounded-lg flex items-center justify-center"
          style={{ background: c.input, border: `1px solid ${c.border}`, color: c.label }}
        >
          <ArrowsClockwise size={14} />
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-6 py-4">
        <div className="max-w-4xl mx-auto">
          {error ? (
            <p className="text-[11px] px-3 py-2 rounded-lg" style={{ background: 'rgba(239,68,68,0.1)', color: '#f87171' }}>{error}</p>
          ) : entries.length === 0 ? (
            <div className="text-center py-16">
              <Archive size={28} weight="duotone" className="mx-auto mb-3" style={{ color: c.faint }} />
              <p className="text-sm" style={{ color: c.label }}>{t(lang, 'instance.saves.empty')}</p>
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-3">
              {entries.map((entry) => (
                <button
                  key={entry.name}
                  onClick={() => reveal(entry)}
                  className="group rounded-xl overflow-hidden text-left transition-all hover:-translate-y-0.5"
                  style={{ background: c.surface, border: `1px solid ${c.border}` }}
                >
                  <div className="relative h-24">
                    <img src="./Minecraft_backgound.png" alt="" className="absolute inset-0 w-full h-full object-cover" />
                    <div className="absolute inset-0" style={{ background: 'linear-gradient(to top, rgba(0,0,0,0.86), rgba(0,0,0,0.25))' }} />
                    <span className="absolute bottom-2 left-3 right-3 text-xs font-bold text-white truncate">{entry.name}</span>
                    <span className="absolute top-2 right-2 w-6 h-6 rounded-lg flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity" style={{ background: 'rgba(0,0,0,0.55)' }}>
                      <FolderOpen size={12} weight="duotone" color="#fff" />
                    </span>
                  </div>
                  <div className="px-3 py-2.5 flex items-center justify-between">
                    <span className="text-[10px] font-mono" style={{ color: c.label }}>{formatBytes(entry.size)}</span>
                    <span className="flex items-center gap-1 text-[10px] font-mono" style={{ color: c.faint }}>
                      <Clock size={11} />
                      {formatDate(entry.mtime, lang) || '—'}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
