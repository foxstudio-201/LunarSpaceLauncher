import { useCallback, useEffect, useState } from 'react'
import { Archive, Clock, FolderOpen, ArrowsClockwise, Trash, Cube, WarningCircle, PencilSimple } from '@phosphor-icons/react'
import { t } from '../../i18n/translations'
import { palette } from '../../lib/palette'
import { formatBytes, formatDate } from '../../lib/status'
import WorldEditorPage from './WorldEditorPage'
import * as api from '../../api/client.js'

const vn = (lang, vi, en) => (lang === 'vi' ? vi : en)

export default function SavesPage({ instance, theme, lang }) {
  const c = palette(theme)
  const [entries, setEntries] = useState([])
  const [details, setDetails] = useState({})
  const [error, setError] = useState('')
  const [selected, setSelected] = useState('')
  const [askDelete, setAskDelete] = useState(null)
  const [busy, setBusy] = useState('')
  const [note, setNote] = useState('')

  const load = useCallback(async () => {
    try {
      const res = await api.listDir({ id: instance.id, rel: 'saves' })
      if (!res?.ok) return setError(res?.error || 'error')
      const worlds = (res.entries || []).filter((entry) => entry.dir)
      setEntries(worlds)
      setError('')
      worlds.slice(0, 12).forEach((entry) => {
        api.worldTree({ id: instance.id, world: entry.name })
          .then((info) => { if (info?.ok) setDetails((prev) => ({ ...prev, [entry.name]: info.world })) })
          .catch(() => {})
      })
    } catch (err) {
      setError(err.message)
    }
  }, [instance.id])

  useEffect(() => {
    load()
  }, [load])

  const reveal = (entry, event) => {
    event?.stopPropagation()
    api.revealPath(`${instance.dir}\\saves\\${entry.name}`).catch(() => {})
  }

  const removeWorld = async () => {
    if (!askDelete) return
    setBusy('delete')
    const res = await api.trashFiles({ id: instance.id, rels: [`saves/${askDelete.name}`] })
      .catch((err) => ({ ok: false, error: err.message }))
    setBusy('')
    if (!res?.ok || res.failed?.length) {
      setNote(res?.error || res?.failed?.[0]?.error || 'error')
      setAskDelete(null)
      return
    }
    setAskDelete(null)
    setNote(vn(lang, `Đã chuyển “${askDelete.name}” vào thùng rác — khôi phục ở trang Thùng rác.`, `“${askDelete.name}” moved to the trash — restore it from the Trash page.`))
    await load()
  }

  if (selected) {
    return (
      <WorldEditorPage
        instance={instance}
        world={selected}
        theme={theme}
        lang={lang}
        onClose={() => { setSelected(''); load() }}
      />
    )
  }

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
          {entries.length} {vn(lang, 'thế giới', 'worlds')}
        </span>
        <button
          onClick={load}
          title={vn(lang, 'Làm mới', 'Refresh')}
          className="w-8 h-8 rounded-lg flex items-center justify-center"
          style={{ background: c.input, border: `1px solid ${c.border}`, color: c.label }}
        >
          <ArrowsClockwise size={14} />
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-6 py-4">
        <div className="max-w-5xl mx-auto flex flex-col gap-3">
          {note && (
            <p className="text-[10px] px-3 py-2 rounded-lg" style={{ background: `${c.accent}14`, border: `1px solid ${c.accent}33`, color: c.label }}>
              {note}
            </p>
          )}
          {error ? (
            <p className="text-[11px] px-3 py-2 rounded-lg" style={{ background: 'rgba(239,68,68,0.1)', color: '#f87171' }}>{error}</p>
          ) : entries.length === 0 ? (
            <div className="text-center py-16">
              <Archive size={28} weight="duotone" className="mx-auto mb-3" style={{ color: c.faint }} />
              <p className="text-sm" style={{ color: c.label }}>{t(lang, 'instance.saves.empty')}</p>
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-3">
              {entries.map((entry) => {
                const info = details[entry.name]
                const summary = info?.summary || {}
                return (
                  <div
                    key={entry.name}
                    role="button"
                    tabIndex={0}
                    onClick={() => setSelected(entry.name)}
                    onKeyDown={(e) => { if (e.key === 'Enter') setSelected(entry.name) }}
                    className="group rounded-xl overflow-hidden text-left transition-all hover:-translate-y-0.5 cursor-pointer"
                    style={{ background: c.surface, border: `1px solid ${c.border}` }}
                  >
                    <div className="relative h-24">
                      <img src="./Minecraft_backgound.png" alt="" className="absolute inset-0 w-full h-full object-cover" />
                      <div className="absolute inset-0" style={{ background: 'linear-gradient(to top, rgba(0,0,0,0.88), rgba(0,0,0,0.25))' }} />
                      <span className="absolute bottom-2 left-3 right-3">
                        <span className="block text-xs font-bold text-white truncate">{summary.name || entry.name}</span>
                        {summary.name && summary.name !== entry.name ? (
                          <span className="block text-[9px] font-mono truncate" style={{ color: 'rgba(255,255,255,0.65)' }}>saves/{entry.name}</span>
                        ) : null}
                      </span>
                      <span className="absolute top-2 left-2 h-5 px-1.5 rounded-md text-[9px] font-bold inline-flex items-center gap-1" style={{ background: 'rgba(0,0,0,0.55)', color: '#fff' }}>
                        <Cube size={10} weight="duotone" />
                        {summary.version || '—'}
                      </span>
                      <div className="absolute top-2 right-2 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={(e) => reveal(entry, e)}
                          title={vn(lang, 'Mở thư mục', 'Open folder')}
                          className="w-6 h-6 rounded-lg flex items-center justify-center"
                          style={{ background: 'rgba(0,0,0,0.55)' }}
                        >
                          <FolderOpen size={12} weight="duotone" color="#fff" />
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); setAskDelete(entry) }}
                          title={vn(lang, 'Xoá thế giới', 'Delete world')}
                          className="w-6 h-6 rounded-lg flex items-center justify-center"
                          style={{ background: 'rgba(239,68,68,0.75)' }}
                        >
                          <Trash size={12} weight="duotone" color="#fff" />
                        </button>
                      </div>
                    </div>
                    <div className="px-3 py-2.5 flex flex-col gap-1.5">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-mono" style={{ color: c.label }}>
                          {info ? formatBytes(info.bytes) : '…'}
                        </span>
                        <span className="flex items-center gap-1 text-[10px] font-mono" style={{ color: c.faint }}>
                          <Clock size={11} />
                          {formatDate(entry.mtime, lang) || '—'}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-[9px] font-mono" style={{ color: c.faint }}>
                          {info ? `${info.players} ${vn(lang, 'người chơi', 'players')} · ${info.files.length} ${vn(lang, 'tệp NBT', 'NBT files')}` : vn(lang, 'đang đọc…', 'reading…')}
                        </span>
                        <div className="flex-1" />
                        <span className="text-[9px] font-bold inline-flex items-center gap-1" style={{ color: c.accent }}>
                          <PencilSimple size={11} weight="duotone" />
                          {vn(lang, 'Sửa NBT', 'Edit NBT')}
                        </span>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {askDelete && (
        <div className="modal-backdrop fixed inset-0 z-[210] flex items-center justify-center p-6" onClick={() => { if (!busy) setAskDelete(null) }}>
          <div
            className="modal-content w-full max-w-[460px] rounded-2xl overflow-hidden"
            style={{ background: c.surface, border: '1px solid rgba(239,68,68,0.35)' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-4 py-3 flex items-center gap-2" style={{ borderBottom: `1px solid ${c.border}` }}>
              <Trash size={15} weight="duotone" style={{ color: '#ef4444' }} />
              <p className="text-[12px] font-bold flex-1" style={{ color: c.text }}>
                {vn(lang, 'Xoá thế giới', 'Delete world')}
              </p>
              <button onClick={() => { if (!busy) setAskDelete(null) }} style={{ color: c.faint }}>
                <span className="text-[13px] font-bold">✕</span>
              </button>
            </div>
            <div className="p-4 flex flex-col gap-3">
              <p className="text-[11px] leading-relaxed" style={{ color: c.text }}>
                {vn(
                  lang,
                  `Chuyển “${askDelete.name}” vào thùng rác của launcher? Toàn bộ thế giới (region, playerdata, level.dat) sẽ được giữ nguyên và khôi phục được ở trang Thùng rác.`,
                  `Move “${askDelete.name}” to the launcher trash? The whole world (region, playerdata, level.dat) is kept and can be restored from the Trash page.`,
                )}
              </p>
              <p className="text-[9px] font-mono break-all" style={{ color: c.faint }}>{`saves\\${askDelete.name}`}</p>
              <div className="flex items-center justify-end gap-2">
                <button
                  onClick={() => setAskDelete(null)}
                  disabled={!!busy}
                  className="h-8 px-3 rounded-lg text-[11px] font-semibold disabled:opacity-50"
                  style={{ background: c.input, border: `1px solid ${c.border}`, color: c.label }}
                >
                  {vn(lang, 'Huỷ', 'Cancel')}
                </button>
                <button
                  onClick={removeWorld}
                  disabled={!!busy}
                  className="h-8 px-4 rounded-lg text-[11px] font-bold disabled:opacity-50"
                  style={{ background: '#ef4444', color: '#fff' }}
                >
                  {vn(lang, 'Chuyển vào thùng rác', 'Move to trash')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
