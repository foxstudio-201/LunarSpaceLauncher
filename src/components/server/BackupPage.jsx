import { useState, useEffect, useRef, useMemo } from 'react'
import {
  Archive, Plus, Trash, ArrowClockwise, Download, Warning, HardDrive,
  PencilSimple, LockSimple, LockSimpleOpen, DotsThreeVertical, X,
} from '@phosphor-icons/react'

const isElectron = typeof window !== 'undefined' && window.electronAPI

function formatBytes(n) {
  if (!n || n <= 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.min(sizes.length - 1, Math.floor(Math.log(n) / Math.log(k)))
  return `${parseFloat((n / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`
}

function formatTime(ts) {
  if (!ts) return '—'
  try {
    const d = new Date(ts)
    return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString()
  } catch {
    return '—'
  }
}

function generateBackupName() {
  const now = new Date()
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  const h = String(now.getHours()).padStart(2, '0')
  const mi = String(now.getMinutes()).padStart(2, '0')
  const s = String(now.getSeconds()).padStart(2, '0')
  const off = now.getTimezoneOffset()
  const sign = off <= 0 ? '+' : '-'
  const oh = String(Math.floor(Math.abs(off) / 60)).padStart(2, '0')
  const om = String(Math.abs(off) % 60).padStart(2, '0')
  return `${y}-${m}-${d} ${h}:${mi}:${s} ${sign}${oh}${om}`
}

function shortChecksum(c) {
  if (!c) return '—'
  const bare = String(c).includes(':') ? String(c).split(':').slice(1).join(':') : String(c)
  return bare.slice(0, 12)
}

function ModalShell({ open, title, icon, theme, lang, onClose, children, footer }) {
  const [render, setRender] = useState(open)
  const [closing, setClosing] = useState(false)
  useEffect(() => {
    if (open) {
      setRender(true)
      setClosing(false)
      return
    }
    if (!render) return
    setClosing(true)
    const t = setTimeout(() => {
      setRender(false)
      setClosing(false)
    }, 220)
    return () => clearTimeout(t)
  }, [open, render])
  if (!render) return null
  const textColor = theme === 'light' ? '#111' : '#fff'
  const labelColor = theme === 'light' ? '#555' : 'rgba(255,255,255,0.6)'
  const borderColor = theme === 'light' ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.08)'
  const modalBg = theme === 'light' ? '#fff' : '#141414'
  return (
    <div
      className={`modal-backdrop fixed inset-0 z-[80] flex items-center justify-center p-4${closing ? ' closing' : ''}`}
      style={{
        background: 'rgba(0,0,0,0.7)',
        backdropFilter: 'blur(4px)',
        WebkitBackdropFilter: 'blur(4px)',
        pointerEvents: closing ? 'none' : 'auto',
      }}
      onClick={() => { if (!closing) onClose?.() }}
    >
      <div
        className={`modal-content w-full max-w-[440px] max-h-[85vh] rounded-2xl overflow-hidden flex flex-col${closing ? ' closing' : ''}`}
        style={{ background: modalBg, border: `1px solid ${borderColor}` }}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 px-4 py-3" style={{ borderBottom: `1px solid ${borderColor}` }}>
          {icon || <Archive size={15} weight="duotone" style={{ color: '#a78bfa' }} />}
          <h3 className="text-xs font-bold" style={{ color: textColor }}>{title}</h3>
          <div className="flex-1" />
          <button onClick={onClose} className="p-1 rounded-lg" style={{ color: labelColor }}>
            <X size={15} weight="bold" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {children}
        </div>
        {footer ? (
          <div className="flex items-center gap-2 px-4 py-3" style={{ borderTop: `1px solid ${borderColor}` }}>
            <div className="flex-1" />
            {footer}
          </div>
        ) : null}
      </div>
    </div>
  )
}

function Field({ label, children, hint, labelColor }) {
  return (
    <div>
      <label className="text-[10px] font-semibold uppercase tracking-wider mb-1 block" style={{ color: labelColor }}>
        {label}
      </label>
      {children}
      {hint ? <div className="text-[10px] mt-1 opacity-60" style={{ color: labelColor }}>{hint}</div> : null}
    </div>
  )
}

export default function BackupPage({ server, theme, lang }) {
  const textColor = theme === 'light' ? '#111' : '#fff'
  const labelColor = theme === 'light' ? '#555' : 'rgba(255,255,255,0.6)'
  const borderColor = theme === 'light' ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.08)'
  const cardBg = theme === 'light' ? 'rgba(0,0,0,0.03)' : 'rgba(255,255,255,0.04)'
  const inputBg = theme === 'light' ? 'rgba(0,0,0,0.04)' : 'rgba(255,255,255,0.06)'
  const inputBorder = theme === 'light' ? 'rgba(0,0,0,0.1)' : 'rgba(255,255,255,0.1)'
  const modalBg = theme === 'light' ? '#fff' : '#141414'

  const [backups, setBackups] = useState([])
  const [busy, setBusy] = useState(false)
  const [busyId, setBusyId] = useState(null)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [progressMap, setProgressMap] = useState({})
  const [restoreProgress, setRestoreProgress] = useState(null)
  const [menuId, setMenuId] = useState(null)
  const [menuPos, setMenuPos] = useState(null)

  const [createOpen, setCreateOpen] = useState(false)
  const [createForm, setCreateForm] = useState({ name: '', ignoredFiles: '' })
  const [creating, setCreating] = useState(false)

  const [editTarget, setEditTarget] = useState(null)
  const [editForm, setEditForm] = useState({ name: '', isLocked: false })
  const [savingEdit, setSavingEdit] = useState(false)

  const [restoreTarget, setRestoreTarget] = useState(null)
  const [restoreOpts, setRestoreOpts] = useState({ truncateDirectory: false, restoreStartup: false })
  const [restoring, setRestoring] = useState(false)

  const [deleteTarget, setDeleteTarget] = useState(null)
  const [deleting, setDeleting] = useState(false)

  const unsubRef = useRef(null)
  const serverId = server?.id || server?.uuid

  const load = async () => {
    if (!isElectron || !serverId) return
    try {
      const res = await window.electronAPI.backupList(serverId)
      if (res?.ok) setBackups(res.backups || [])
      else if (res?.error && res.error !== 'Unauthorized') setError(res.error)
    } catch {}
  }

  useEffect(() => {
    load()
    if (!isElectron) return
    const off = window.electronAPI.onBackupUpdate?.((data) => {
      if (!data || data.serverId !== serverId) return
      const { event, uuid, data: payload } = data
      if (event === 'progress' && uuid) {
        setProgressMap(prev => ({
          ...prev,
          [uuid]: {
            bytes: payload?.bytes_processed || 0,
            total: payload?.bytes_total || 0,
            files: payload?.files_processed || 0,
          },
        }))
        return
      }
      if (event === 'created' && payload) {
        setBackups(prev => {
          if (prev.some(b => b.uuid === payload.uuid)) {
            return prev.map(b => (b.uuid === payload.uuid ? payload : b))
          }
          return [payload, ...prev]
        })
        return
      }
      if (event === 'updated' && payload) {
        setBackups(prev => prev.map(b => (b.uuid === payload.uuid ? payload : b)))
        return
      }
      if (event === 'completed' && uuid) {
        setProgressMap(prev => {
          const next = { ...prev }
          delete next[uuid]
          return next
        })
        load()
        return
      }
      if (event === 'deleted' && uuid) {
        setBackups(prev => prev.filter(b => b.uuid !== uuid))
        return
      }
      if (event === 'restore-started') {
        setRestoreProgress({ bytes: 0, total: 0, files: 0 })
        return
      }
      if (event === 'restore-progress') {
        setRestoreProgress({
          bytes: payload?.bytes_processed || 0,
          total: payload?.bytes_total || 0,
          files: payload?.files_processed || 0,
        })
        return
      }
      if (event === 'restore-completed') {
        setRestoreProgress(null)
        load()
        return
      }
      load()
    })
    unsubRef.current = () => { off?.() }
    return () => { unsubRef.current?.() }
  }, [serverId])

  const closeMenu = () => {
    setMenuId(null)
    setMenuPos(null)
  }

  useEffect(() => {
    if (!menuId) return
    const close = () => {
      setMenuId(null)
      setMenuPos(null)
    }
    window.addEventListener('click', close)
    window.addEventListener('scroll', close, true)
    window.addEventListener('resize', close)
    return () => {
      window.removeEventListener('click', close)
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('resize', close)
    }
  }, [menuId])

  const toggleMenu = (e, id) => {
    e.stopPropagation()
    if (menuId === id) {
      closeMenu()
      return
    }
    const r = e.currentTarget.getBoundingClientRect()
    const menuH = 168
    const openUp = window.innerHeight - r.bottom < menuH + 12 && r.top > menuH + 12
    setMenuPos({
      top: openUp ? r.top - menuH - 4 : r.bottom + 4,
      right: Math.max(8, window.innerWidth - r.right),
      openUp,
    })
    setMenuId(id)
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return backups
    return backups.filter(b =>
      String(b.name || '').toLowerCase().includes(q) ||
      String(b.checksum || '').toLowerCase().includes(q)
    )
  }, [backups, search])

  const openCreate = () => {
    setCreateForm({ name: generateBackupName(), ignoredFiles: '' })
    setCreateOpen(true)
    setError('')
  }

  const handleCreate = async () => {
    if (!isElectron || creating) return
    const name = createForm.name.trim() || generateBackupName()
    const ignoredFiles = createForm.ignoredFiles
      .split('\n')
      .map(x => x.trim())
      .filter(Boolean)
    setError('')
    setCreating(true)
    try {
      const res = await window.electronAPI.backupCreate(serverId, { name, ignoredFiles })
      if (res && res.ok) {
        setCreateOpen(false)
        if (res.backup) {
          setBackups(prev => {
            if (prev.some(b => b.uuid === res.backup.uuid)) return prev.map(b => (b.uuid === res.backup.uuid ? res.backup : b))
            return [res.backup, ...prev]
          })
        }
        load()
      } else {
        setError(res?.error || (lang === 'vi' ? 'Tạo backup thất bại' : 'Create backup failed'))
      }
    } catch (err) {
      setError(err?.message || 'Error')
    } finally {
      setCreating(false)
    }
  }

  const openEdit = (b) => {
    setEditTarget(b)
    setEditForm({ name: b.name || '', isLocked: !!b.isLocked })
    closeMenu()
    setError('')
  }

  const handleEdit = async () => {
    if (!isElectron || !editTarget || savingEdit) return
    const name = editForm.name.trim()
    if (!name) return
    setSavingEdit(true)
    setError('')
    try {
      const res = await window.electronAPI.backupUpdate(serverId, editTarget.uuid, {
        name,
        isLocked: editForm.isLocked,
      })
      if (res && !res.ok && res.error) setError(res.error)
      else {
        setEditTarget(null)
        await load()
      }
    } catch (err) {
      setError(err?.message || 'Error')
    } finally {
      setSavingEdit(false)
    }
  }

  const openRestore = (b) => {
    setRestoreTarget(b)
    setRestoreOpts({ truncateDirectory: false, restoreStartup: false })
    closeMenu()
    setError('')
  }

  const handleRestore = async () => {
    if (!isElectron || !restoreTarget || restoring) return
    setRestoring(true)
    setError('')
    try {
      const res = await window.electronAPI.backupRestore(serverId, restoreTarget.uuid, restoreOpts)
      if (res && !res.ok && res.error) setError(res.error)
      else setRestoreTarget(null)
    } catch (err) {
      setError(err?.message || 'Error')
    } finally {
      setRestoring(false)
    }
  }

  const openDelete = (b) => {
    setDeleteTarget(b)
    closeMenu()
    setError('')
  }

  const handleDelete = async () => {
    if (!isElectron || !deleteTarget || deleting) return
    setDeleting(true)
    setError('')
    try {
      const res = await window.electronAPI.backupDelete(serverId, deleteTarget.uuid)
      if (res && !res.ok && res.error) setError(res.error)
      else {
        setBackups(prev => prev.filter(x => x.uuid !== deleteTarget.uuid))
        setDeleteTarget(null)
      }
    } catch (err) {
      setError(err?.message || 'Error')
    } finally {
      setDeleting(false)
    }
  }

  const handleDownload = async (b) => {
    if (!isElectron || busyId) return
    setError('')
    setBusyId(b.uuid)
    try {
      const res = await window.electronAPI.backupDownload(serverId, b.uuid)
      if (res && res.error) setError(res.error)
    } catch (err) {
      setError(err?.message || 'Error')
    } finally { setBusyId(null) }
  }

  const btnGhost = 'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-all hover:opacity-80 active:scale-95 disabled:opacity-50'
  const btnPrimary = 'inline-flex items-center justify-center gap-1.5 px-4 py-1.5 rounded-lg text-[11px] font-semibold transition-all hover:opacity-80 active:scale-95 disabled:opacity-50'
  const inputCls = 'w-full px-3 py-2 rounded-lg text-[11px] outline-none'

  const inputStyle = {
    background: inputBg,
    border: `1px solid ${inputBorder}`,
    color: textColor,
  }

  return (
    <div className="h-full flex flex-col overflow-hidden p-4 gap-4" style={{ color: textColor }}>
      <div className="flex items-center gap-3 flex-wrap">
        <Archive size={16} weight="duotone" style={{ color: '#a78bfa' }} />
        <h2 className="text-sm font-bold">
          {lang === 'vi' ? 'Sao lưu' : 'Backups'}
        </h2>
        <span className="text-[10px]" style={{ color: labelColor }}>
          {backups.length} · {lang === 'vi' ? 'tối đa dùng chung' : 'shared limit'}
        </span>
        <div className="flex-1" />
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder={lang === 'vi' ? 'Tìm backup…' : 'Search backups…'}
          className="px-3 py-1.5 rounded-lg text-[11px] outline-none w-40"
          style={{ background: inputBg, border: `1px solid ${inputBorder}`, color: textColor }}
        />
        <button
          onClick={openCreate}
          disabled={creating}
          className={btnPrimary}
          style={{ background: '#8b5cf6', color: '#fff' }}
        >
          <Plus size={13} weight="duotone" />
          {creating
            ? (lang === 'vi' ? 'Đang tạo…' : 'Creating…')
            : (lang === 'vi' ? 'Tạo' : 'Create')}
        </button>
      </div>

      {error && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg text-[11px]" style={{ background: '#ef444415', border: '1px solid #ef444430', color: '#ef4444' }}>
          <Warning size={13} weight="duotone" /> {error}
        </div>
      )}

      {restoreProgress && (
        <div className="px-3 py-2 rounded-lg text-[10px]" style={{ background: '#f59e0b15', border: '1px solid #f59e0b30', color: '#f59e0b' }}>
          {lang === 'vi' ? 'Đang khôi phục backup…' : 'Restoring backup…'}
        </div>
      )}

      <div className="flex-1 overflow-y-auto pr-1">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 gap-2">
            <Archive size={40} weight="duotone" style={{ color: labelColor, opacity: 0.3 }} />
            <span className="text-[11px]" style={{ color: labelColor }}>
              {search
                ? (lang === 'vi' ? 'Không tìm thấy backup' : 'No backups match')
                : (lang === 'vi' ? 'Chưa có backup nào' : 'No backups yet')}
            </span>
            {!search && (
              <span className="text-[10px]" style={{ color: labelColor }}>
                {lang === 'vi' ? 'Tạo bản sao lưu tar.gz của toàn bộ thư mục server' : 'Create a tar.gz snapshot of the server directory'}
              </span>
            )}
            {!search && (
              <button onClick={openCreate} className={btnPrimary} style={{ background: '#8b5cf6', color: '#fff' }}>
                <Plus size={13} weight="duotone" />
                {lang === 'vi' ? 'Tạo backup' : 'Create backup'}
              </button>
            )}
          </div>
        ) : (
          <div className="rounded-xl overflow-hidden" style={{ border: `1px solid ${borderColor}` }}>
            <div
              className="grid items-center px-3 py-2 text-[10px] font-bold uppercase tracking-wide"
              style={{
                gridTemplateColumns: 'minmax(120px,2fr) 70px 70px 70px 130px 36px 36px',
                background: cardBg,
                color: labelColor,
                borderBottom: `1px solid ${borderColor}`,
                gap: 8,
              }}
            >
              <span>{lang === 'vi' ? 'Tên' : 'Name'}</span>
              <span>{lang === 'vi' ? 'Checksum' : 'Checksum'}</span>
              <span>{lang === 'vi' ? 'Dung lượng' : 'Size'}</span>
              <span>{lang === 'vi' ? 'File' : 'Files'}</span>
              <span>{lang === 'vi' ? 'Tạo lúc' : 'Created'}</span>
              <span>{lang === 'vi' ? 'Khóa' : 'Lock'}</span>
              <span />
            </div>
            {filtered.map((b) => {
              const isBusy = busyId === b.uuid
              const prog = progressMap[b.uuid]
              const isRunning = b.status === 'running' || b.status === 'pending' || (!!prog && !b.completed)
              const isFailed = b.status === 'failed' || (b.completed && !b.isSuccessful)
              const isDeleting = b.deletionStatus === 'deleting'
              const pct = prog && prog.total > 0
                ? Math.min(100, Math.round((prog.bytes / prog.total) * 100))
                : (prog ? null : null)

              return (
                <div
                  key={b.uuid}
                  className="grid items-center px-3 py-2.5 text-[11px]"
                  style={{
                    gridTemplateColumns: 'minmax(120px,2fr) 70px 70px 70px 130px 36px 36px',
                    borderBottom: `1px solid ${borderColor}`,
                    gap: 8,
                    opacity: isDeleting ? 0.5 : 1,
                    background: menuId === b.uuid ? cardBg : 'transparent',
                  }}
                >
                  <div className="min-w-0 flex items-center gap-2">
                    <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0" style={{ background: '#8b5cf620' }}>
                      <HardDrive size={12} weight="duotone" style={{ color: '#8b5cf6' }} />
                    </div>
                    <div className="min-w-0">
                      <p className="font-semibold truncate">{b.name}</p>
                      {isDeleting && (
                        <p className="text-[10px]" style={{ color: '#f59e0b' }}>
                          {lang === 'vi' ? 'Đang xóa…' : 'Deleting…'}
                        </p>
                      )}
                      {isFailed && !isDeleting && (
                        <p className="text-[10px]" style={{ color: '#ef4444' }}>
                          {lang === 'vi' ? 'Thất bại' : 'Failed'}
                        </p>
                      )}
                    </div>
                  </div>
                  <span className="font-mono truncate" style={{ color: labelColor }} title={b.checksum || ''}>
                    {shortChecksum(b.checksum)}
                  </span>
                  <span style={{ color: labelColor }}>
                    {isRunning && prog ? (
                      <span style={{ color: '#a78bfa' }}>
                        {pct === null ? '…' : `${pct}%`}
                      </span>
                    ) : (
                      formatBytes(b.bytes)
                    )}
                  </span>
                  <span style={{ color: labelColor }}>{b.files || 0}</span>
                  <span style={{ color: labelColor }}>{formatTime(b.created)}</span>
                  <span className="flex items-center justify-center">
                    {b.isLocked
                      ? <LockSimple size={13} weight="fill" style={{ color: '#22c55e' }} />
                      : <LockSimpleOpen size={13} weight="duotone" style={{ color: '#ef4444' }} />}
                  </span>
                  <div className="relative flex items-center justify-center">
                    <button
                      onClick={(e) => toggleMenu(e, b.uuid)}
                      disabled={isBusy || isDeleting}
                      className="p-1 rounded-lg hover:opacity-80 disabled:opacity-40"
                      title={lang === 'vi' ? 'Thao tác' : 'Actions'}
                    >
                      <DotsThreeVertical size={14} weight="bold" style={{ color: labelColor }} />
                    </button>
                    {menuId === b.uuid && menuPos && (
                      <div
                        className="fixed z-[100] min-w-[150px] rounded-xl p-1 space-y-0.5"
                        style={{
                          top: menuPos.top,
                          right: menuPos.right,
                          background: modalBg,
                          border: `1px solid ${inputBorder}`,
                          boxShadow: '0 8px 24px rgba(0,0,0,0.25)',
                        }}
                        onClick={e => e.stopPropagation()}
                      >
                        <button
                          onClick={() => openEdit(b)}
                          disabled={b.isLocked || !b.completed}
                          className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-[11px] text-left hover:opacity-80 disabled:opacity-40"
                          style={{ color: textColor }}
                        >
                          <PencilSimple size={12} /> {lang === 'vi' ? 'Sửa' : 'Edit'}
                        </button>
                        <button
                          onClick={() => handleDownload(b)}
                          disabled={!b.completed || isBusy}
                          className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-[11px] text-left hover:opacity-80 disabled:opacity-40"
                          style={{ color: textColor }}
                        >
                          <Download size={12} /> {lang === 'vi' ? 'Tải về' : 'Download'}
                        </button>
                        <button
                          onClick={() => openRestore(b)}
                          disabled={!b.completed || isBusy}
                          className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-[11px] text-left hover:opacity-80 disabled:opacity-40"
                          style={{ color: '#f97316' }}
                        >
                          <ArrowClockwise size={12} /> {lang === 'vi' ? 'Khôi phục' : 'Restore'}
                        </button>
                        <button
                          onClick={() => openDelete(b)}
                          disabled={b.isLocked || !b.completed || isDeleting}
                          className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-[11px] text-left hover:opacity-80 disabled:opacity-40"
                          style={{ color: '#ef4444' }}
                        >
                          <Trash size={12} /> {lang === 'vi' ? 'Xóa' : 'Delete'}
                        </button>
                      </div>
                    )}
                  </div>
                  {isRunning && (
                    <div className="col-span-7 -mt-1">
                      <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(139,92,246,0.15)' }}>
                        <div
                          className="h-full rounded-full transition-all"
                          style={{
                            width: prog && prog.total > 0
                              ? `${Math.min(100, (prog.bytes / prog.total) * 100)}%`
                              : '40%',
                            background: '#8b5cf6',
                            opacity: prog && prog.total > 0 ? 1 : 0.5,
                          }}
                        />
                      </div>
                      <div className="flex justify-between mt-0.5 text-[9px]" style={{ color: '#a78bfa' }}>
                        <span>
                          {prog
                            ? `${formatBytes(prog.bytes)} / ${formatBytes(prog.total)} · ${prog.files || 0} files`
                            : (lang === 'vi' ? 'Đang đóng gói…' : 'Packing…')}
                        </span>
                        {prog && prog.total > 0 && (
                          <span>{Math.min(100, Math.round((prog.bytes / prog.total) * 100))}%</span>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      <ModalShell
        open={createOpen}
        title={lang === 'vi' ? 'Tạo backup' : 'Create backup'}
        icon={<Archive size={15} weight="duotone" style={{ color: '#a78bfa' }} />}
        theme={theme}
        lang={lang}
        onClose={() => !creating && setCreateOpen(false)}
        footer={
          <>
            <button onClick={() => setCreateOpen(false)} disabled={creating} className={btnGhost} style={{ background: borderColor, color: labelColor }}>
              {lang === 'vi' ? 'Hủy' : 'Cancel'}
            </button>
            <button onClick={handleCreate} disabled={creating} className={btnPrimary} style={{ background: '#a78bfa', color: '#fff' }}>
              {creating ? '…' : (lang === 'vi' ? 'Tạo' : 'Create')}
            </button>
          </>
        }
      >
        <Field label={lang === 'vi' ? 'Tên' : 'Name'} labelColor={labelColor}>
          <input
            className={inputCls}
            style={inputStyle}
            value={createForm.name}
            onChange={e => setCreateForm(f => ({ ...f, name: e.target.value }))}
            placeholder="2026-09-23 12:00:00 +0700"
          />
        </Field>
        <Field
          label={lang === 'vi' ? 'File bỏ qua' : 'Ignored files'}
          labelColor={labelColor}
          hint={lang === 'vi' ? 'Mỗi dòng một đường dẫn tương đối' : 'One relative path per line'}
        >
          <textarea
            className={inputCls}
            style={{ ...inputStyle, minHeight: 80, resize: 'vertical' }}
            value={createForm.ignoredFiles}
            onChange={e => setCreateForm(f => ({ ...f, ignoredFiles: e.target.value }))}
            placeholder={'logs/\nworld/backup'}
          />
        </Field>
        {error && (
          <div className="text-[11px] px-3 py-2 rounded-lg" style={{ background: '#ef444415', border: '1px solid #ef444430', color: '#ef4444' }}>
            {error}
          </div>
        )}
      </ModalShell>

      <ModalShell
        open={!!editTarget}
        title={lang === 'vi' ? 'Sửa backup' : 'Edit backup'}
        icon={<PencilSimple size={15} weight="duotone" style={{ color: '#a78bfa' }} />}
        theme={theme}
        lang={lang}
        onClose={() => !savingEdit && setEditTarget(null)}
        footer={
          <>
            <button onClick={() => setEditTarget(null)} disabled={savingEdit} className={btnGhost} style={{ background: borderColor, color: labelColor }}>
              {lang === 'vi' ? 'Hủy' : 'Cancel'}
            </button>
            <button onClick={handleEdit} disabled={savingEdit || !editForm.name.trim()} className={btnPrimary} style={{ background: '#a78bfa', color: '#fff' }}>
              {savingEdit ? '…' : (lang === 'vi' ? 'Lưu' : 'Save')}
            </button>
          </>
        }
      >
        <Field label={lang === 'vi' ? 'Tên' : 'Name'} labelColor={labelColor}>
          <input
            className={inputCls}
            style={inputStyle}
            value={editForm.name}
            onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))}
          />
        </Field>
        <label className="flex items-center gap-2 text-[11px] cursor-pointer" style={{ color: textColor }}>
          <input
            type="checkbox"
            checked={editForm.isLocked}
            onChange={e => setEditForm(f => ({ ...f, isLocked: e.target.checked }))}
          />
          {lang === 'vi' ? 'Khóa (không cho xóa / retention)' : 'Locked (block delete / retention)'}
        </label>
        {error && (
          <div className="text-[11px] px-3 py-2 rounded-lg" style={{ background: '#ef444415', border: '1px solid #ef444430', color: '#ef4444' }}>
            {error}
          </div>
        )}
      </ModalShell>

      <ModalShell
        open={!!restoreTarget}
        title={lang === 'vi' ? 'Khôi phục backup' : 'Restore backup'}
        icon={<ArrowClockwise size={15} weight="duotone" style={{ color: '#f97316' }} />}
        theme={theme}
        lang={lang}
        onClose={() => !restoring && setRestoreTarget(null)}
        footer={
          <>
            <button onClick={() => setRestoreTarget(null)} disabled={restoring} className={btnGhost} style={{ background: borderColor, color: labelColor }}>
              {lang === 'vi' ? 'Hủy' : 'Cancel'}
            </button>
            <button
              onClick={handleRestore}
              disabled={restoring}
              className={btnPrimary}
              style={{ background: restoreOpts.truncateDirectory ? '#ef4444' : '#a78bfa', color: '#fff' }}
            >
              {restoring ? '…' : (lang === 'vi' ? 'Khôi phục' : 'Restore')}
            </button>
          </>
        }
      >
        <p className="text-[11px]" style={{ color: labelColor }}>
          {lang === 'vi'
            ? `Khôi phục "${restoreTarget?.name || ''}". File hiện tại có thể bị ghi đè.`
            : `Restore "${restoreTarget?.name || ''}". Current files may be overwritten.`}
        </p>
        <label className="flex items-center gap-2 text-[11px] cursor-pointer" style={{ color: textColor }}>
          <input
            type="checkbox"
            checked={restoreOpts.truncateDirectory}
            onChange={e => setRestoreOpts(o => ({ ...o, truncateDirectory: e.target.checked }))}
          />
          {lang === 'vi' ? 'Xóa thư mục server trước khi khôi phục' : 'Truncate server directory before restore'}
        </label>
        <label className="flex items-center gap-2 text-[11px] cursor-pointer" style={{ color: textColor }}>
          <input
            type="checkbox"
            checked={restoreOpts.restoreStartup}
            onChange={e => setRestoreOpts(o => ({ ...o, restoreStartup: e.target.checked }))}
          />
          {lang === 'vi' ? 'Khôi phục startup' : 'Restore startup'}
        </label>
        {error && (
          <div className="text-[11px] px-3 py-2 rounded-lg" style={{ background: '#ef444415', border: '1px solid #ef444430', color: '#ef4444' }}>
            {error}
          </div>
        )}
      </ModalShell>

      <ModalShell
        open={!!deleteTarget}
        title={lang === 'vi' ? 'Xóa backup' : 'Delete backup'}
        icon={<Trash size={15} weight="duotone" style={{ color: '#ef4444' }} />}
        theme={theme}
        lang={lang}
        onClose={() => !deleting && setDeleteTarget(null)}
        footer={
          <>
            <button onClick={() => setDeleteTarget(null)} disabled={deleting} className={btnGhost} style={{ background: borderColor, color: labelColor }}>
              {lang === 'vi' ? 'Hủy' : 'Cancel'}
            </button>
            <button onClick={handleDelete} disabled={deleting} className={btnPrimary} style={{ background: '#ef4444', color: '#fff' }}>
              {deleting ? '…' : (lang === 'vi' ? 'Xóa' : 'Delete')}
            </button>
          </>
        }
      >
        <p className="text-[11px]" style={{ color: labelColor }}>
          {lang === 'vi'
            ? `Xóa vĩnh viễn backup "${deleteTarget?.name || ''}"?`
            : `Permanently delete backup "${deleteTarget?.name || ''}"?`}
        </p>
        {error && (
          <div className="text-[11px] px-3 py-2 rounded-lg" style={{ background: '#ef444415', border: '1px solid #ef444430', color: '#ef4444' }}>
            {error}
          </div>
        )}
      </ModalShell>
    </div>
  )
}
