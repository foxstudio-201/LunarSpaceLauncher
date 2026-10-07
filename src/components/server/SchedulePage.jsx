import { useState, useEffect, useRef } from 'react'
import {
  Plus, Trash, Play, Pause, PencilSimple, DotsThreeVertical,
  Clock, Terminal, Power, Archive, CaretRight, CaretLeft, X, Warning,
} from '@phosphor-icons/react'

const isElectron = typeof window !== 'undefined' && window.electronAPI

const PRESETS = [
  { label: '*/5 * * * *', vi: 'Mỗi 5 phút', en: 'Every 5 minutes' },
  { label: '0 * * * *', vi: 'Mỗi giờ', en: 'Every hour' },
  { label: '0 0 * * *', vi: 'Hàng ngày 00:00', en: 'Daily 00:00' },
  { label: '0 0 * * 0', vi: 'Hàng tuần CN 00:00', en: 'Weekly Sun 00:00' },
  { label: '0 0 1 * *', vi: 'Hàng tháng ngày 1', en: 'Monthly day 1' },
  { label: '30 3 * * *', vi: 'Hàng ngày 03:30', en: 'Daily 03:30' },
]

const ACTION_OPTIONS = [
  { value: 'command', label: 'Command', vi: 'Lệnh' },
  { value: 'power', label: 'Power', vi: 'Nguồn' },
  { value: 'backup', label: 'Backup', vi: 'Sao lưu' },
]

const POWER_OPTIONS = [
  { value: 'start', vi: 'Khởi động', en: 'Start' },
  { value: 'stop', vi: 'Dừng', en: 'Stop' },
  { value: 'restart', vi: 'Khởi động lại', en: 'Restart' },
  { value: 'kill', vi: 'Tắt cưỡng bức', en: 'Kill' },
]

function emptyStep() {
  return { id: crypto.randomUUID?.() || String(Date.now() + Math.random()), action: 'command', command: '', power: 'start', delay: 0, continueOnFailure: false }
}

function formatTime(ts) {
  if (!ts) return '—'
  try {
    return new Date(ts).toLocaleString()
  } catch {
    return '—'
  }
}

function stepSummary(step, lang) {
  if (step.action === 'command') return `> ${step.command || '…'}`
  if (step.action === 'power') {
    const p = POWER_OPTIONS.find(x => x.value === (step.power || 'start'))
    return `⚡ ${lang === 'vi' ? (p?.vi || 'start') : (p?.en || 'start')}`
  }
  if (step.action === 'backup') return '🗄 archive'
  return step.action
}

export default function SchedulePage({ server, theme, lang }) {
  const textColor = theme === 'light' ? '#111' : '#fff'
  const labelColor = theme === 'light' ? '#555' : 'rgba(255,255,255,0.6)'
  const borderColor = theme === 'light' ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.08)'
  const cardBg = theme === 'light' ? 'rgba(0,0,0,0.03)' : 'rgba(255,255,255,0.04)'
  const inputBg = theme === 'light' ? '#fff' : '#1a1a1a'
  const modalBg = theme === 'light' ? '#fff' : '#141414'

  const [schedules, setSchedules] = useState([])
  const [modal, setModal] = useState(null)
  const [deleteAsk, setDeleteAsk] = useState(null)
  const [preview, setPreview] = useState({ valid: false, human: '', nextRunAt: null })
  const [busyId, setBusyId] = useState(null)
  const [error, setError] = useState('')
  const [openMenu, setOpenMenu] = useState(null)
  const [menuPos, setMenuPos] = useState(null)
  const [modalRender, setModalRender] = useState(false)
  const [modalClosing, setModalClosing] = useState(false)
  const lastModalRef = useRef(null)
  const unsubRef = useRef(null)

  if (modal) lastModalRef.current = modal

  useEffect(() => {
    if (modal) {
      setModalRender(true)
      setModalClosing(false)
      return
    }
    if (!modalRender) return
    setModalClosing(true)
    const t = setTimeout(() => {
      setModalRender(false)
      setModalClosing(false)
      lastModalRef.current = null
    }, 220)
    return () => clearTimeout(t)
  }, [modal, modalRender])

  const viewModal = modal || lastModalRef.current
  const closeModal = () => setModal(null)

  const closeMenu = () => {
    setOpenMenu(null)
    setMenuPos(null)
  }

  const toggleMenu = (e, id) => {
    e.stopPropagation()
    if (openMenu === id) {
      closeMenu()
      return
    }
    const r = e.currentTarget.getBoundingClientRect()
    const menuH = 140
    const openUp = window.innerHeight - r.bottom < menuH + 12 && r.top > menuH + 12
    setMenuPos({
      top: openUp ? r.top - menuH - 4 : r.bottom + 4,
      right: Math.max(8, window.innerWidth - r.right),
    })
    setOpenMenu(id)
  }

  const serverId = server?.id || server?.uuid

  const load = async () => {
    if (!isElectron || !serverId) return
    try {
      const res = await window.electronAPI.scheduleList(serverId)
      if (res?.ok) setSchedules(res.schedules || [])
    } catch {}
  }

  useEffect(() => {
    load()
    if (!isElectron) return
    const off1 = window.electronAPI.onScheduleUpdate?.((sch) => {
      if (!sch || sch.serverId !== serverId) return
      setSchedules(prev => {
        const rest = prev.filter(s => s.id !== sch.id)
        return [...rest, { ...sch, humanCron: sch.humanCron || sch.cron }].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
      })
    })
    const off2 = window.electronAPI.onScheduleDeleted?.(({ id }) => {
      setSchedules(prev => prev.filter(s => s.id !== id))
    })
    const off3 = window.electronAPI.onScheduleRan?.(() => load())
    unsubRef.current = () => { off1?.(); off2?.(); off3?.() }
    return () => { unsubRef.current?.() }
  }, [serverId])

  useEffect(() => {
    if (!modal?.data?.cron || !isElectron) { setPreview({ valid: false, human: '', nextRunAt: null }); return }
    let cancelled = false
    const timer = setTimeout(async () => {
      try {
        const res = await window.electronAPI.schedulePreview(modal.data.cron)
        if (!cancelled && res?.ok) setPreview({ valid: res.valid, human: res.human, nextRunAt: res.nextRunAt })
      } catch {}
    }, 250)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [modal?.data?.cron])

  const openCreate = () => {
    setError('')
    setModal({ mode: 'create', data: { name: '', cron: '*/5 * * * *', isActive: true, steps: [emptyStep()] } })
  }

  const openEdit = (s) => {
    setError('')
    setModal({
      mode: 'edit',
      data: {
        id: s.id,
        name: s.name,
        cron: s.cron,
        isActive: s.isActive !== false,
        steps: (s.steps || []).map(st => ({ ...st, delay: st.delay || 0 })),
      },
    })
  }

  const updateData = (patch) => setModal(m => ({ ...m, data: { ...m.data, ...patch } }))

  const updateStep = (idx, patch) => {
    setModal(m => {
      const steps = m.data.steps.map((s, i) => i === idx ? { ...s, ...patch } : s)
      return { ...m, data: { ...m.data, steps } }
    })
  }

  const addStep = () => setModal(m => ({ ...m, data: { ...m.data, steps: [...m.data.steps, emptyStep()] } }))
  const removeStep = (idx) => setModal(m => ({ ...m, data: { ...m.data, steps: m.data.steps.filter((_, i) => i !== idx) } }))
  const moveStep = (idx, dir) => setModal(m => {
    const steps = [...m.data.steps]
    const j = idx + dir
    if (j < 0 || j >= steps.length) return m
    ;[steps[idx], steps[j]] = [steps[j], steps[idx]]
    return { ...m, data: { ...m.data, steps } }
  })

  const validate = (data) => {
    if (!data.name?.trim()) return lang === 'vi' ? 'Nhập tên lịch trình' : 'Enter schedule name'
    if (!data.cron?.trim()) return lang === 'vi' ? 'Nhập cron' : 'Enter cron expression'
    if (!data.steps?.length) return lang === 'vi' ? 'Thêm ít nhất 1 bước' : 'Add at least one step'
    for (const st of data.steps) {
      if (st.action === 'command' && !st.command?.trim()) return lang === 'vi' ? 'Bước lệnh: nhập command' : 'Command step: enter command'
      if (st.action === 'power' && !st.power) return lang === 'vi' ? 'Bước power: chọn hành động' : 'Power step: choose action'
    }
    return ''
  }

  const handleSave = async () => {
    if (!isElectron || !modal) return
    const data = modal.data
    const err = validate(data)
    if (err) { setError(err); return }
    setError('')
    try {
      const pv = await window.electronAPI.schedulePreview(data.cron.trim())
      if (!pv?.ok || !pv.valid) {
        setError(lang === 'vi' ? 'Cron không hợp lệ' : 'Invalid cron')
        return
      }
      const steps = data.steps.map(st => ({
        id: st.id,
        action: st.action,
        command: st.action === 'command' ? st.command : undefined,
        power: st.action === 'power' ? st.power : undefined,
        backupName: st.action === 'backup' ? st.backupName : undefined,
        ignoredFiles: st.action === 'backup' ? st.ignoredFiles : undefined,
        delay: Number(st.delay) || 0,
        continueOnFailure: !!st.continueOnFailure,
      }))
      const payload = { name: data.name.trim(), cron: data.cron.trim(), isActive: data.isActive !== false, steps }
      let res
      if (modal.mode === 'create') {
        res = await window.electronAPI.scheduleCreate(serverId, payload)
      } else {
        res = await window.electronAPI.scheduleUpdate(data.id, payload)
      }
      if (res?.ok) {
        closeModal()
        await load()
      } else {
        setError(res?.error || (lang === 'vi' ? 'Lưu thất bại' : 'Save failed'))
      }
    } catch (e) {
      setError(e?.message || (lang === 'vi' ? 'Lỗi' : 'Error'))
    }
  }

  const handleToggle = async (s) => {
    if (!isElectron) return
    setBusyId(s.id)
    try {
      await window.electronAPI.scheduleToggle(s.id, !(s.isActive !== false))
      await load()
    } finally { setBusyId(null) }
  }

  const handleRun = async (s) => {
    if (!isElectron) return
    setBusyId(s.id)
    try {
      const res = await window.electronAPI.scheduleRun(s.id)
      if (res && !res.ok && res.error) setError(res.error)
      await load()
    } finally { setBusyId(null); closeMenu() }
  }

  const handleDelete = async (s) => {
    if (!isElectron) return
    setDeleteAsk(s)
  }

  const confirmDelete = async () => {
    const s = deleteAsk
    if (!s) return
    setDeleteAsk(null)
    setBusyId(s.id)
    try {
      await window.electronAPI.scheduleDelete(s.id)
      setSchedules(prev => prev.filter(x => x.id !== s.id))
    } finally { setBusyId(null); closeMenu() }
  }

  const actionIcon = (action) => {
    if (action === 'power') return <Power size={13} weight="duotone" />
    if (action === 'backup') return <Archive size={13} weight="duotone" />
    return <Terminal size={13} weight="duotone" />
  }

  return (
    <div className="h-full flex flex-col overflow-hidden p-4 gap-4">
      <div className="flex items-center gap-3">
        <Clock size={16} weight="duotone" style={{ color: '#a78bfa' }} />
        <h2 className="text-sm font-bold" style={{ color: textColor }}>
          {lang === 'vi' ? 'Lịch trình' : 'Schedules'}
        </h2>
        <div className="flex-1" />
        <button
          onClick={openCreate}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-all hover:opacity-80 active:scale-95"
          style={{ background: '#a78bfa', color: '#fff' }}
        >
          <Plus size={13} weight="duotone" /> {lang === 'vi' ? 'Tạo mới' : 'Create'}
        </button>
      </div>

      {error && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg text-[11px]" style={{ background: '#ef444415', border: '1px solid #ef444430', color: '#ef4444' }}>
          <Warning size={13} weight="duotone" /> {error}
        </div>
      )}

      <div className="flex-1 overflow-y-auto pr-1">
        {schedules.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 gap-2">
            <Clock size={28} weight="light" style={{ color: labelColor }} />
            <span className="text-[11px]" style={{ color: labelColor }}>
              {lang === 'vi' ? 'Chưa có lịch trình' : 'No schedules yet'}
            </span>
            <span className="text-[10px]" style={{ color: labelColor }}>
              {lang === 'vi' ? 'Tạo cron + multi-step: command, power, backup' : 'Create cron + multi-step: command, power, backup'}
            </span>
          </div>
        ) : schedules.map((s) => {
          const active = s.isActive !== false
          const running = !!s.isProcessing
          return (
            <div key={s.id} className="relative mb-2 px-3 py-2.5 rounded-xl" style={{ background: cardBg, border: `1px solid ${borderColor}` }}>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => handleToggle(s)}
                  disabled={busyId === s.id}
                  title={active ? (lang === 'vi' ? 'Tắt' : 'Disable') : (lang === 'vi' ? 'Bật' : 'Enable')}
                  className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 transition-all disabled:opacity-50"
                  style={{ background: active ? '#22c55e20' : '#6b728020' }}
                >
                  {active ? <Play size={12} weight="fill" style={{ color: '#22c55e' }} /> : <Pause size={12} weight="fill" style={{ color: '#9ca3af' }} />}
                </button>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-[11px] font-semibold truncate" style={{ color: textColor }}>{s.name}</p>
                    <span className="text-[9px] px-1.5 py-0.5 rounded-full font-semibold shrink-0" style={{
                      background: running ? '#eab30820' : active ? '#22c55e15' : '#6b728020',
                      color: running ? '#eab308' : active ? '#22c55e' : '#9ca3af',
                    }}>
                      {running ? (lang === 'vi' ? 'Đang chạy' : 'Running') : active ? (lang === 'vi' ? 'Đang bật' : 'Active') : (lang === 'vi' ? 'Đã tắt' : 'Inactive')}
                    </span>
                    {s.lastStatus === 'failed' && (
                      <span className="text-[9px] px-1.5 py-0.5 rounded-full font-semibold" style={{ background: '#ef444420', color: '#ef4444' }}>
                        {lang === 'vi' ? 'Lỗi' : 'Failed'}
                      </span>
                    )}
                    {s.lastStatus === 'success' && (
                      <span className="text-[9px] px-1.5 py-0.5 rounded-full font-semibold" style={{ background: '#22c55e15', color: '#22c55e' }}>
                        OK
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-3 mt-0.5 flex-wrap">
                    <span className="text-[10px] font-mono" style={{ color: '#a78bfa' }}>{s.cron}</span>
                    <span className="text-[10px]" style={{ color: labelColor }}>{s.humanCron || s.cron}</span>
                    <span className="text-[10px]" style={{ color: labelColor }}>
                      {lang === 'vi' ? 'Tiếp:' : 'Next:'} {formatTime(s.nextRunAt)}
                    </span>
                    <span className="text-[10px]" style={{ color: labelColor }}>
                      {lang === 'vi' ? 'Lần cuối:' : 'Last:'} {formatTime(s.lastRunAt)}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                    {(s.steps || []).map((st, i) => (
                      <span key={st.id || i} className="inline-flex items-center gap-1 text-[9px] px-1.5 py-0.5 rounded" style={{ background: inputBg, border: `1px solid ${borderColor}`, color: labelColor }}>
                        {actionIcon(st.action)}
                        {stepSummary(st, lang)}
                        {st.delay > 0 && <span style={{ color: '#f59e0b' }}>+{st.delay}s</span>}
                      </span>
                    ))}
                  </div>
                  {s.lastError && (
                    <p className="text-[10px] mt-1 truncate" style={{ color: '#ef4444' }}>{s.lastError}</p>
                  )}
                </div>

                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={() => handleRun(s)}
                    disabled={busyId === s.id || running}
                    title={lang === 'vi' ? 'Chạy ngay' : 'Run now'}
                    className="p-1.5 rounded-lg transition-all disabled:opacity-40 hover:opacity-80"
                    style={{ background: '#3b82f620', color: '#3b82f6' }}
                  >
                    <Play size={13} weight="fill" />
                  </button>
                  <button
                    onClick={() => openEdit(s)}
                    title={lang === 'vi' ? 'Sửa' : 'Edit'}
                    className="p-1.5 rounded-lg transition-all hover:opacity-80"
                    style={{ background: '#a78bfa20', color: '#a78bfa' }}
                  >
                    <PencilSimple size={13} weight="duotone" />
                  </button>
                  <div>
                    <button
                      onClick={(e) => toggleMenu(e, s.id)}
                      className="p-1.5 rounded-lg transition-all hover:opacity-80"
                      style={{ background: cardBg, color: labelColor }}
                    >
                      <DotsThreeVertical size={13} weight="bold" />
                    </button>
                    {openMenu === s.id && menuPos && (
                      <>
                        <div className="fixed inset-0 z-[90]" onClick={closeMenu} />
                        <div
                          className="fixed z-[100] min-w-[140px] rounded-xl overflow-hidden shadow-xl"
                          style={{
                            top: menuPos.top,
                            right: menuPos.right,
                            background: modalBg,
                            border: `1px solid ${borderColor}`,
                          }}
                          onClick={e => e.stopPropagation()}
                        >
                          <button
                            onClick={() => handleRun(s)}
                            disabled={running}
                            className="w-full px-3 py-2 text-left text-[11px] flex items-center gap-2 disabled:opacity-40"
                            style={{ color: textColor }}
                          >
                            <Play size={12} weight="fill" /> {lang === 'vi' ? 'Chạy ngay' : 'Run now'}
                          </button>
                          <button
                            onClick={() => { openEdit(s); closeMenu() }}
                            className="w-full px-3 py-2 text-left text-[11px] flex items-center gap-2"
                            style={{ color: textColor }}
                          >
                            <PencilSimple size={12} weight="duotone" /> {lang === 'vi' ? 'Sửa' : 'Edit'}
                          </button>
                          <button
                            onClick={() => handleDelete(s)}
                            className="w-full px-3 py-2 text-left text-[11px] flex items-center gap-2"
                            style={{ color: '#ef4444' }}
                          >
                            <Trash size={12} weight="duotone" /> {lang === 'vi' ? 'Xóa' : 'Delete'}
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {modalRender && viewModal && (
        <div
          className={`modal-backdrop fixed inset-0 z-[80] flex items-center justify-center p-4${modalClosing ? ' closing' : ''}`}
          style={{
            background: 'rgba(0,0,0,0.7)',
            backdropFilter: 'blur(4px)',
            WebkitBackdropFilter: 'blur(4px)',
            pointerEvents: modalClosing ? 'none' : 'auto',
          }}
          onClick={() => { if (!modalClosing) closeModal() }}
        >
          <div
            className={`modal-content w-full max-w-[560px] max-h-[85vh] rounded-2xl overflow-hidden flex flex-col${modalClosing ? ' closing' : ''}`}
            style={{ background: modalBg, border: `1px solid ${borderColor}` }}
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center gap-2 px-4 py-3" style={{ borderBottom: `1px solid ${borderColor}` }}>
              <Clock size={15} weight="duotone" style={{ color: '#a78bfa' }} />
              <h3 className="text-xs font-bold" style={{ color: textColor }}>
                {viewModal.mode === 'create'
                  ? (lang === 'vi' ? 'Tạo lịch trình' : 'Create schedule')
                  : (lang === 'vi' ? 'Sửa lịch trình' : 'Edit schedule')}
              </h3>
              <div className="flex-1" />
              <button onClick={closeModal} className="p-1 rounded-lg" style={{ color: labelColor }}>
                <X size={15} weight="bold" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              <div>
                <label className="text-[10px] font-semibold uppercase tracking-wider mb-1 block" style={{ color: labelColor }}>
                  {lang === 'vi' ? 'Tên' : 'Name'}
                </label>
                <input
                  value={viewModal.data.name}
                  onChange={e => updateData({ name: e.target.value })}
                  placeholder={lang === 'vi' ? 'Backup hàng đêm' : 'Nightly backup'}
                  className="w-full px-3 py-2 rounded-lg text-[11px] outline-none"
                  style={{ background: inputBg, border: `1px solid ${borderColor}`, color: textColor }}
                />
              </div>

              <div>
                <label className="text-[10px] font-semibold uppercase tracking-wider mb-1 block" style={{ color: labelColor }}>
                  Cron {lang === 'vi' ? '(5 trường: phút giờ ngày tháng thứ)' : '(5 fields: min hour dom month dow)'}
                </label>
                <input
                  value={viewModal.data.cron}
                  onChange={e => updateData({ cron: e.target.value })}
                  placeholder="*/5 * * * *"
                  className="w-full px-3 py-2 rounded-lg text-[11px] outline-none font-mono"
                  style={{ background: inputBg, border: `1px solid ${preview.valid || !viewModal.data.cron ? borderColor : '#ef444466'}`, color: textColor }}
                />
                <div className="flex flex-wrap gap-1.5 mt-1.5">
                  {PRESETS.map(p => (
                    <button
                      key={p.label}
                      onClick={() => updateData({ cron: p.label })}
                      className="text-[9px] px-2 py-1 rounded-md font-mono transition-all hover:opacity-80"
                      style={{ background: viewModal.data.cron === p.label ? '#a78bfa25' : cardBg, border: `1px solid ${borderColor}`, color: viewModal.data.cron === p.label ? '#a78bfa' : labelColor }}
                      title={lang === 'vi' ? p.vi : p.en}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
                <div className="mt-1.5 flex items-center gap-3 text-[10px]" style={{ color: labelColor }}>
                  <span style={{ color: preview.valid ? '#22c55e' : '#ef4444' }}>
                    {viewModal.data.cron
                      ? (preview.valid ? `✓ ${preview.human || preview.valid}` : (lang === 'vi' ? '✗ Cron không hợp lệ' : '✗ Invalid cron'))
                      : ''}
                  </span>
                  {preview.valid && preview.nextRunAt && (
                    <span>{lang === 'vi' ? 'Chạy tiếp theo:' : 'Next run:'} {formatTime(preview.nextRunAt)}</span>
                  )}
                </div>
              </div>

              <label className="flex items-center gap-2 text-[11px] cursor-pointer" style={{ color: textColor }}>
                <input
                  type="checkbox"
                  checked={viewModal.data.isActive !== false}
                  onChange={e => updateData({ isActive: e.target.checked })}
                  className="rounded"
                />
                {lang === 'vi' ? 'Kích hoạt ngay' : 'Activate immediately'}
              </label>

              <div>
                <div className="flex items-center gap-2 mb-1.5">
                  <label className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: labelColor }}>
                    {lang === 'vi' ? `Các bước (${viewModal.data.steps.length})` : `Steps (${viewModal.data.steps.length})`}
                  </label>
                  <div className="flex-1" />
                  <button onClick={addStep} className="flex items-center gap-1 text-[10px] px-2 py-1 rounded-md font-semibold" style={{ background: '#a78bfa20', color: '#a78bfa' }}>
                    <Plus size={11} weight="bold" /> {lang === 'vi' ? 'Thêm bước' : 'Add step'}
                  </button>
                </div>

                <div className="space-y-2">
                  {viewModal.data.steps.map((st, idx) => (
                    <div key={st.id || idx} className="p-2.5 rounded-xl" style={{ background: cardBg, border: `1px solid ${borderColor}` }}>
                      <div className="flex items-center gap-2 mb-2">
                        <span className="text-[10px] font-bold w-5 text-center rounded" style={{ background: '#a78bfa20', color: '#a78bfa' }}>{idx + 1}</span>
                        <select
                          value={st.action}
                          onChange={e => updateStep(idx, { action: e.target.value })}
                          className="px-2 py-1 rounded-md text-[11px] outline-none"
                          style={{ background: inputBg, border: `1px solid ${borderColor}`, color: textColor }}
                        >
                          {ACTION_OPTIONS.map(a => (
                            <option key={a.value} value={a.value}>{lang === 'vi' ? a.vi : a.label}</option>
                          ))}
                        </select>

                        <div className="flex-1" />

                        <button onClick={() => moveStep(idx, -1)} disabled={idx === 0} className="p-1 disabled:opacity-30" style={{ color: labelColor }} title="Up">
                          <CaretLeft size={12} weight="bold" style={{ transform: 'rotate(-90deg)' }} />
                        </button>
                        <button onClick={() => moveStep(idx, 1)} disabled={idx === viewModal.data.steps.length - 1} className="p-1 disabled:opacity-30" style={{ color: labelColor }} title="Down">
                          <CaretRight size={12} weight="bold" style={{ transform: 'rotate(-90deg)' }} />
                        </button>
                        <button onClick={() => removeStep(idx)} disabled={viewModal.data.steps.length <= 1} className="p-1 disabled:opacity-30" style={{ color: '#ef4444' }} title="Remove">
                          <Trash size={12} weight="duotone" />
                        </button>
                      </div>

                      {st.action === 'command' && (
                        <input
                          value={st.command || ''}
                          onChange={e => updateStep(idx, { command: e.target.value })}
                          placeholder={lang === 'vi' ? 'Lệnh console, ví dụ: say hi' : 'Console command, e.g. say hi'}
                          className="w-full px-2.5 py-1.5 rounded-lg text-[11px] outline-none font-mono mb-2"
                          style={{ background: inputBg, border: `1px solid ${borderColor}`, color: textColor }}
                        />
                      )}

                      {st.action === 'power' && (
                        <select
                          value={st.power || 'start'}
                          onChange={e => updateStep(idx, { power: e.target.value })}
                          className="w-full px-2.5 py-1.5 rounded-lg text-[11px] outline-none mb-2"
                          style={{ background: inputBg, border: `1px solid ${borderColor}`, color: textColor }}
                        >
                          {POWER_OPTIONS.map(p => (
                            <option key={p.value} value={p.value}>{lang === 'vi' ? p.vi : p.en}</option>
                          ))}
                        </select>
                      )}

                      {st.action === 'backup' && (
                        <p className="text-[10px] mb-2" style={{ color: labelColor }}>
                          {lang === 'vi'
                            ? 'Nén thư mục server thành tar.gz trong backups/'
                            : 'Archive server folder to tar.gz under backups/'}
                        </p>
                      )}

                      <div className="flex items-center gap-3 flex-wrap">
                        <label className="flex items-center gap-1.5 text-[10px]" style={{ color: labelColor }}>
                          {lang === 'vi' ? 'Delay (giây):' : 'Delay (sec):'}
                          <input
                            type="number"
                            min="0"
                            max="600"
                            value={st.delay || 0}
                            onChange={e => updateStep(idx, { delay: Math.max(0, Math.min(600, Number(e.target.value) || 0)) })}
                            className="w-16 px-2 py-0.5 rounded-md text-[10px] outline-none font-mono"
                            style={{ background: inputBg, border: `1px solid ${borderColor}`, color: textColor }}
                          />
                        </label>
                        <label className="flex items-center gap-1.5 text-[10px] cursor-pointer" style={{ color: labelColor }}>
                          <input
                            type="checkbox"
                            checked={!!st.continueOnFailure}
                            onChange={e => updateStep(idx, { continueOnFailure: e.target.checked })}
                            className="rounded"
                          />
                          {lang === 'vi' ? 'Tiếp tục nếu lỗi' : 'Continue on failure'}
                        </label>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {error && (
                <div className="text-[11px] px-3 py-2 rounded-lg" style={{ background: '#ef444415', border: '1px solid #ef444430', color: '#ef4444' }}>
                  {error}
                </div>
              )}
            </div>

            <div className="flex items-center gap-2 px-4 py-3" style={{ borderTop: `1px solid ${borderColor}` }}>
              <div className="flex-1" />
              <button onClick={closeModal} disabled={modalClosing} className="px-3 py-1.5 rounded-lg text-[11px] font-semibold" style={{ background: borderColor, color: labelColor }}>
                {lang === 'vi' ? 'Hủy' : 'Cancel'}
              </button>
              <button onClick={handleSave} disabled={modalClosing} className="px-4 py-1.5 rounded-lg text-[11px] font-semibold" style={{ background: '#a78bfa', color: '#fff' }}>
                {lang === 'vi' ? 'Lưu' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      {deleteAsk && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.55)' }} onClick={() => setDeleteAsk(null)}>
          <div
            className="w-full max-w-[440px] rounded-xl overflow-hidden shadow-2xl"
            style={{ background: cardBg, border: '1px solid rgba(239,68,68,0.35)' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2 px-4 py-3" style={{ borderBottom: `1px solid ${borderColor}` }}>
              <Trash size={15} weight="duotone" style={{ color: '#ef4444' }} />
              <p className="text-[12px] font-bold flex-1" style={{ color: textColor }}>{lang === 'vi' ? 'Xóa lịch trình' : 'Delete schedule'}</p>
            </div>
            <div className="px-4 py-3.5">
              <p className="text-[11px] leading-relaxed" style={{ color: textColor }}>
                {lang === 'vi' ? `Xóa lịch trình “${deleteAsk.name}”?` : `Delete schedule “${deleteAsk.name}”?`}
              </p>
            </div>
            <div className="px-4 py-3 flex items-center justify-end gap-2" style={{ borderTop: `1px solid ${borderColor}` }}>
              <button onClick={() => setDeleteAsk(null)} className="px-3 py-1.5 rounded-lg text-[11px] font-semibold" style={{ background: borderColor, color: labelColor }}>
                {lang === 'vi' ? 'Hủy' : 'Cancel'}
              </button>
              <button onClick={confirmDelete} className="px-3.5 py-1.5 rounded-lg text-[11px] font-bold" style={{ background: '#ef4444', color: '#fff' }}>
                {lang === 'vi' ? 'Xóa' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
