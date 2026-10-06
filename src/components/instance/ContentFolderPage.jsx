import { useCallback, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  Check, DotsThreeVertical, FolderOpen, Trash, UploadSimple,
  ArrowsClockwise, Warning, Power, ProhibitInset, DownloadSimple,
} from '@phosphor-icons/react'
import { t } from '../../i18n/translations'
import { palette } from '../../lib/palette'
import { sizeLabel, stampLabel } from '../../lib/files'
import ProgressBar from '../ui/ProgressBar'
import ContentDownloadPage from './ContentDownloadPage'
import * as api from '../../api/client.js'

const vn = (lang, vi, en) => (lang === 'vi' ? vi : en)
const GRID = '1fr 90px 140px 36px'

function fill(lang, key, map) {
  let text = t(lang, key)
  for (const [k, v] of Object.entries(map)) text = text.split(`{${k}}`).join(String(v))
  return text
}

const isFileDrag = (dt) => !!dt && Array.from(dt.types || []).includes('Files')

export default function ContentFolderPage({
  instance, theme, lang, progress,
  folder, icon: Icon, match, suffix = '.disabled',
  actions = null, emptyHint, dropHint, openLabel, note = '', downloadLabel,
}) {
  const [browsing, setBrowsing] = useState(false)
  const c = palette(theme)
  const instProgress = progress?.[instance.id]
  const [entries, setEntries] = useState([])
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [menu, setMenu] = useState(null)
  const [selectMode, setSelectMode] = useState(false)
  const [selected, setSelected] = useState([])
  const [pending, setPending] = useState(null)
  const [flash, setFlash] = useState(null)
  const [osDragging, setOsDragging] = useState(false)
  const [busy, setBusy] = useState(0)

  const hover = theme === 'light' ? 'rgba(139,92,246,0.08)' : 'rgba(167,139,250,0.12)'

  const load = useCallback(async () => {
    if (!instance) return
    setLoading(true)
    try {
      const res = await api.listDir({ id: instance.id, rel: folder })
      if (!res?.ok) {
        setError(res?.error || 'error')
        setEntries([])
      } else {
        setEntries((res.entries || []).filter((e) => match(e)))
        setError('')
      }
    } catch (err) {
      setError(err.message)
      setEntries([])
    }
    setLoading(false)
  }, [instance?.id, folder])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    let depth = 0
    const onEnter = (e) => {
      if (!isFileDrag(e.dataTransfer)) return
      depth += 1
      setOsDragging(true)
    }
    const onOver = (e) => {
      if (isFileDrag(e.dataTransfer)) e.preventDefault()
    }
    const onLeave = () => {
      depth = Math.max(0, depth - 1)
      if (!depth) setOsDragging(false)
    }
    const onEnd = () => {
      depth = 0
      setOsDragging(false)
    }
    document.addEventListener('dragenter', onEnter)
    document.addEventListener('dragover', onOver)
    document.addEventListener('dragleave', onLeave)
    document.addEventListener('drop', onEnd)
    document.addEventListener('dragend', onEnd)
    return () => {
      document.removeEventListener('dragenter', onEnter)
      document.removeEventListener('dragover', onOver)
      document.removeEventListener('dragleave', onLeave)
      document.removeEventListener('drop', onEnd)
      document.removeEventListener('dragend', onEnd)
    }
  }, [])

  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Escape') return
      if (menu) return setMenu(null)
      if (pending) return setPending(null)
      if (selectMode) return setSelectMode(false)
      return undefined
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [menu, pending, selectMode])

  useEffect(() => {
    if (selectMode) {
      setSelected([])
      setPending(null)
    }
  }, [selectMode])

  const notify = (message, tone = 'ok') => {
    setFlash({ message, tone })
    setTimeout(() => setFlash(null), 2600)
  }

  const resetSelection = () => {
    setSelected([])
    setPending(null)
  }

  const setEnabled = async (name, enable) => {
    setMenu(null)
    setBusy((n) => n + 1)
    const res = await api.toggleFile({ id: instance.id, rel: `${folder}/${name}`, enable, suffix })
    setBusy((n) => Math.max(0, n - 1))
    if (!res?.ok) notify(res?.error || 'error', 'bad')
    await load()
  }

  const setMany = async (names, enable) => {
    if (!names.length) return
    setBusy((n) => n + names.length)
    let failed = 0
    for (const name of names) {
      const res = await api.toggleFile({ id: instance.id, rel: `${folder}/${name}`, enable, suffix })
      if (!res?.ok) failed += 1
    }
    setBusy((n) => Math.max(0, n - names.length))
    if (failed) notify(fill(lang, 'mods.failed', { n: failed }), 'bad')
    resetSelection()
    await load()
  }

  const runTrash = async (names) => {
    setPending(null)
    const rels = names.map((name) => `${folder}/${name}`)
    const res = await api.trashFiles({ id: instance.id, rels })
    if (res?.failed?.length) notify(fill(lang, 'files.trashFailed', { n: res.failed.length }), 'bad')
    else notify(fill(lang, 'files.trashed', { n: res?.trashed ?? rels.length }))
    resetSelection()
    await load()
  }

  const importDrop = async (paths) => {
    if (!paths.length) return
    setBusy((n) => n + paths.length)
    const res = await api.importPaths({ id: instance.id, rel: folder, paths })
    setBusy((n) => Math.max(0, n - paths.length))
    if (res?.failed?.length) notify(fill(lang, 'files.importFailed', { n: res.failed.length }), 'bad')
    else notify(fill(lang, 'files.imported', { n: res?.imported ?? paths.length }))
    await load()
  }

  const droppedPaths = (dataTransfer) =>
    Array.from(dataTransfer?.files || [])
      .map((file) => api.pathForFile(file))
      .filter(Boolean)

  const onContainerDrop = async (e) => {
    if (!isFileDrag(e.dataTransfer)) return undefined
    e.preventDefault()
    return importDrop(droppedPaths(e.dataTransfer))
  }

  const toggleSelected = (name) => {
    setSelected((prev) => (prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name]))
  }

  const needle = query.trim().toLowerCase()
  const shown = needle ? entries.filter((entry) => String(entry.name || '').toLowerCase().includes(needle)) : entries
  const allSelected = shown.length > 0 && selected.every((name) => shown.some((entry) => entry.name === name))
  const toggleAll = () => setSelected(allSelected ? [] : entries.map((e) => e.name))

  const onRowClick = (entry) => {
    setMenu(null)
    if (selectMode) return toggleSelected(entry.name)
    return setEnabled(entry.name, !!entry.disabled)
  }

  const reveal = (name) => {
    const target = [instance.dir, folder, name].filter(Boolean).join('\\')
    api.revealPath(target).catch(() => {})
  }

  if (browsing) {
    return (
      <ContentDownloadPage
        instance={instance}
        theme={theme}
        lang={lang}
        kind={folder}
        progress={progress}
        onBack={() => setBrowsing(false)}
        onInstalled={load}
      />
    )
  }

  return (
    <div data-surface className="h-full flex flex-col overflow-hidden relative" style={{ background: c.bg }}>
      {osDragging && (
        <div className="pointer-events-none absolute inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.5)' }}>
          <div
            className="rounded-lg p-8 flex flex-col items-center gap-4"
            style={{ background: c.surface, border: `2px dashed ${c.accent}`, boxShadow: '0 25px 50px -12px rgba(0,0,0,0.5)' }}
          >
            <UploadSimple size={56} weight="fill" style={{ color: c.accent }} />
            <p className="text-xl font-semibold" style={{ color: c.text }}>{t(lang, 'files.dropHere')}</p>
            <p className="text-sm" style={{ color: c.label }}>
              {dropHint} {instance.name}/{folder}
            </p>
          </div>
        </div>
      )}

      <div className="shrink-0 flex items-center gap-2 px-3 py-2" style={{ borderBottom: `1px solid ${c.border}`, background: c.bar }}>
        {downloadLabel && (
          <button
            onClick={() => setBrowsing(true)}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-semibold transition-opacity hover:opacity-85"
            style={{ background: c.accent, color: '#12081f' }}
          >
            <DownloadSimple size={13} weight="bold" />
            {downloadLabel}
          </button>
        )}
        {actions}
        <button
          onClick={load}
          title={t(lang, 'files.reloadList')}
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-medium"
          style={{ background: c.surface, border: `1px solid ${c.border}`, color: c.label }}
        >
          <ArrowsClockwise size={13} weight="bold" />
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
        {busy > 0 && (
          <span className="text-[10px] px-2 py-0.5 rounded" style={{ background: 'rgba(34,197,94,0.15)', color: '#22c55e' }}>
            {fill(lang, 'files.uploading', { n: busy })}
          </span>
        )}
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t(lang, 'files.searchPlaceholder')}
          className="h-7 w-40 px-2 rounded-md text-[11px] outline-none"
          style={{ background: c.input, border: `1px solid ${c.border}`, color: c.text }}
        />
        <span className="text-[10px]" style={{ color: c.label }}>
          {entries.length} {t(lang, 'files.items')}
        </span>
        <button
          onClick={() => reveal('')}
          title={openLabel}
          className="w-7 h-7 rounded-md flex items-center justify-center"
          style={{ background: c.surface, border: `1px solid ${c.border}`, color: c.label }}
        >
          <FolderOpen size={14} weight="duotone" />
        </button>
        <button
          onClick={() => setSelectMode((v) => !v)}
          aria-pressed={selectMode}
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-semibold"
          style={{
            background: selectMode ? hover : c.surface,
            border: `1px solid ${selectMode ? 'rgba(167,139,250,0.42)' : c.border}`,
            color: selectMode ? c.accent : c.label,
          }}
        >
          <Check size={13} weight={selectMode ? 'bold' : 'regular'} />
          {selectMode ? t(lang, 'files.done') : t(lang, 'files.select')}
        </button>
      </div>

      <div className="shrink-0 flex items-center gap-1.5 px-4 py-2.5 mx-3 mt-3 rounded-lg" style={{ background: c.surface, border: `1px solid ${c.border}` }}>
        <Icon size={14} weight="duotone" style={{ color: c.accent }} />
        <span className="text-[12px] font-bold px-1 py-0.5" style={{ color: c.accent }}>~</span>
        <span style={{ color: c.label, opacity: 0.45 }}>/</span>
        <span className="text-[12px] font-medium px-1 py-0.5" style={{ color: c.text }}>{folder}</span>
        <span className="text-[10px] font-mono truncate ml-auto" style={{ color: c.faint }}>{instance.dir}\{folder}</span>
      </div>

      {selectMode && (
        <div className="shrink-0 mx-3 mt-2 flex items-center gap-3 px-3 py-2 rounded-lg" style={{ background: hover, border: '1px solid rgba(167,139,250,0.28)' }}>
          <span className="text-[11px] font-semibold" style={{ color: c.accent }}>
            {selected.length} {t(lang, 'files.selected')}
          </span>
          <button onClick={toggleAll} className="text-[10px] font-semibold px-2 py-0.5 rounded" style={{ background: c.input, border: `1px solid ${c.border}`, color: c.label }}>
            {allSelected ? t(lang, 'files.clearAll') : t(lang, 'files.selectAll')}
          </button>
          <div className="flex-1" />
          <button
            disabled={!selected.length || busy > 0}
            onClick={() => setMany(selected, true)}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[10px] font-bold disabled:opacity-40"
            style={{ background: c.input, border: `1px solid ${c.border}`, color: '#22c55e' }}
          >
            <Power size={12} weight="bold" />
            {t(lang, 'mods.enableAll')}
          </button>
          <button
            disabled={!selected.length || busy > 0}
            onClick={() => setMany(selected, false)}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[10px] font-bold disabled:opacity-40"
            style={{ background: c.input, border: `1px solid ${c.border}`, color: c.label }}
          >
            <ProhibitInset size={12} weight="bold" />
            {t(lang, 'mods.disableAll')}
          </button>
          <button
            disabled={!selected.length || busy > 0}
            onClick={() => setPending({ names: selected })}
            className="flex items-center gap-1.5 px-3 py-1 rounded-md text-[10px] font-bold disabled:opacity-40"
            style={{ background: '#ef4444', color: '#fff' }}
          >
            <Trash size={12} weight="bold" />
            {t(lang, 'files.deleteSelected')}
          </button>
        </div>
      )}

      {pending && (
        <div className="shrink-0 mx-3 mt-2 flex items-center gap-3 px-3 py-2 rounded-lg text-[11px]" style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', color: '#f87171' }}>
          <Warning size={13} weight="duotone" />
          <span className="flex-1">
            {pending.names.length === 1
              ? fill(lang, 'files.confirmTrashOne', { name: pending.names[0] })
              : fill(lang, 'files.confirmTrash', { n: pending.names.length })}
          </span>
          <button
            onClick={() => setPending(null)}
            className="px-2.5 py-1 rounded-md text-[10px] font-semibold"
            style={{ background: c.input, border: `1px solid ${c.border}`, color: c.label }}
          >
            {t(lang, 'files.cancel')}
          </button>
          <button
            onClick={() => runTrash(pending.names)}
            className="px-2.5 py-1 rounded-md text-[10px] font-bold"
            style={{ background: '#ef4444', color: '#fff' }}
          >
            {t(lang, 'files.toTrash')}
          </button>
        </div>
      )}

      {(instProgress || error || note) && (
        <div className="shrink-0 mx-3 mt-2 flex flex-col gap-2 px-3 py-2 rounded-lg" style={{ background: c.surface, border: `1px solid ${c.border}` }}>
          {instProgress && <ProgressBar theme={theme} lang={lang} progress={instProgress} />}
          {note && <span className="text-[10px]" style={{ color: '#22c55e' }}>{note}</span>}
          {error && <span className="text-[10px]" style={{ color: '#f87171' }}>{error}</span>}
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
        <span className="text-right">{t(lang, 'files.modified')}</span>
        <span className="flex justify-end">
          {selectMode && (
            <button
              onClick={toggleAll}
              aria-pressed={allSelected}
              className="w-4 h-4 rounded flex items-center justify-center"
              style={{ border: `1px solid ${allSelected ? c.accent : c.border}`, background: allSelected ? c.accent : 'transparent', color: '#12081f' }}
            >
              {allSelected && <Check size={11} weight="bold" />}
            </button>
          )}
        </span>
      </div>

      <div
        className="flex-1 min-h-0 overflow-y-auto mx-3 mb-3 rounded-b-lg"
        style={{ background: c.surface, borderLeft: `1px solid ${c.border}`, borderRight: `1px solid ${c.border}`, borderBottom: `1px solid ${c.border}`, borderTop: 'none' }}
        onDragOver={(e) => {
          if (!isFileDrag(e.dataTransfer)) return
          e.preventDefault()
        }}
        onDrop={onContainerDrop}
        onScroll={() => (menu ? setMenu(null) : undefined)}
      >
        {loading && !entries.length ? (
          <div className="flex items-center justify-center py-12">
            <span className="text-[12px]" style={{ color: c.label }}>{t(lang, 'home.loading')}</span>
          </div>
        ) : shown.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 gap-2">
            <Icon size={28} weight="duotone" style={{ color: c.label, opacity: 0.4 }} />
            <span className="text-[12px]" style={{ color: c.label }}>{emptyHint}</span>
          </div>
        ) : (
          shown.map((entry) => {
            const isSelected = selected.includes(entry.name)
            const isMenu = menu?.name === entry.name
            const enabled = !entry.disabled
            return (
              <div
                key={entry.name}
                onClick={() => onRowClick(entry)}
                className="grid items-center px-3 cursor-pointer group"
                style={{
                  gridTemplateColumns: GRID,
                  minHeight: 41,
                  borderBottom: `1px solid ${c.border}`,
                  background: isSelected ? hover : 'transparent',
                }}
                onMouseEnter={(e) => { if (!isSelected) e.currentTarget.style.background = hover }}
                onMouseLeave={(e) => { if (!isSelected) e.currentTarget.style.background = 'transparent' }}
              >
                <div className="flex items-center gap-2.5 min-w-0 pr-2">
                  <Icon size={15} weight="duotone" style={{ color: enabled ? c.accent : c.label, opacity: enabled ? 1 : 0.5 }} />
                  <span
                    className="text-[12px] font-medium truncate"
                    style={{ color: enabled ? c.text : c.label, textDecoration: enabled ? 'none' : 'line-through' }}
                  >
                    {entry.name.replace(/\.disabled$/, '').replace(/\.txt$/, '')}
                  </span>
                  {entry.dir && (
                    <span className="text-[9px] font-bold px-1 py-0.5 rounded shrink-0 uppercase" style={{ background: c.input, color: c.label }}>
                      {vn(lang, 'thư mục', 'folder')}
                    </span>
                  )}
                  <span
                    className="text-[9px] font-bold px-1 py-0.5 rounded shrink-0 uppercase"
                    style={{ background: enabled ? 'rgba(34,197,94,0.16)' : c.input, color: enabled ? '#22c55e' : c.label }}
                  >
                    {enabled ? t(lang, 'mods.enabled') : t(lang, 'mods.disabled')}
                  </span>
                </div>
                <span className="text-[11px] text-right font-mono" style={{ color: c.label }}>{entry.dir ? '—' : sizeLabel(entry.size)}</span>
                <span className="text-[11px] text-right font-mono" style={{ color: c.label }}>{stampLabel(entry.mtime)}</span>
                <div className="relative flex items-center justify-end">
                  {selectMode ? (
                    <button
                      aria-pressed={isSelected}
                      className="w-4 h-4 rounded flex items-center justify-center"
                      style={{ border: `1px solid ${isSelected ? c.accent : c.border}`, background: isSelected ? c.accent : 'transparent', color: '#12081f' }}
                    >
                      {isSelected && <Check size={11} weight="bold" />}
                    </button>
                  ) : (
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        setMenu(isMenu ? null : { name: entry.name, rect: e.currentTarget.getBoundingClientRect(), disabled: !!entry.disabled })
                      }}
                      title={t(lang, 'files.actions')}
                      className="p-1 rounded opacity-0 group-hover:opacity-100 transition-opacity"
                      style={{ color: c.label }}
                    >
                      <DotsThreeVertical size={14} weight="bold" />
                    </button>
                  )}
                </div>
              </div>
            )
          })
        )}
      </div>

      {menu && createPortal(
        <>
          <div className="fixed inset-0" style={{ zIndex: 9998 }} onClick={() => setMenu(null)} />
          <div
            className="fixed rounded-md overflow-hidden shadow-xl py-0.5"
            style={{
              zIndex: 9999,
              left: Math.max(8, Math.min(menu.rect.right - 190, window.innerWidth - 198)),
              top: menu.rect.bottom + 4 + 130 > window.innerHeight ? undefined : menu.rect.bottom + 4,
              bottom: menu.rect.bottom + 4 + 130 > window.innerHeight ? window.innerHeight - menu.rect.top + 4 : undefined,
              width: 190,
              background: c.surface,
              border: `1px solid ${c.border}`,
            }}
          >
            <button
              onClick={() => setEnabled(menu.name, menu.disabled)}
              className="w-full flex items-center gap-2 px-3 py-2 text-[11px] text-left"
              style={{ color: c.text }}
              onMouseEnter={(e) => { e.currentTarget.style.background = hover }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
            >
              {menu.disabled ? <Power size={13} /> : <ProhibitInset size={13} />}
              {menu.disabled ? t(lang, 'mods.enable') : t(lang, 'mods.disable')}
            </button>
            <button
              onClick={() => { reveal(menu.name); setMenu(null) }}
              className="w-full flex items-center gap-2 px-3 py-2 text-[11px] text-left"
              style={{ color: c.text }}
              onMouseEnter={(e) => { e.currentTarget.style.background = hover }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
            >
              <FolderOpen size={13} /> {t(lang, 'files.reveal')}
            </button>
            <button
              onClick={() => { setPending({ names: [menu.name] }); setMenu(null) }}
              className="w-full flex items-center gap-2 px-3 py-2 text-[11px] text-left"
              style={{ color: '#ef4444' }}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(239,68,68,0.12)' }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
            >
              <Trash size={13} /> {t(lang, 'files.toTrash')}
            </button>
          </div>
        </>,
        document.body,
      )}
    </div>
  )
}
