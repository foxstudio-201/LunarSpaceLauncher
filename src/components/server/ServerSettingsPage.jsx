import { useState, useEffect } from 'react'
import { Warning, Trash, ArrowClockwise, PencilSimple, Package } from '@phosphor-icons/react'
import { showToast } from '../../lib/toast'
import { t } from '../../i18n/translations'
import ServerPackPage from '../instance/ServerPackPage'

const isElectron = typeof window !== 'undefined' && window.electronAPI

const btn = 'px-3 py-1 rounded-lg text-[11px] font-semibold transition-all duration-150 hover:opacity-80 active:scale-95'

export default function ServerSettingsPage({ server, theme, lang, onBack, onServerDeleted, onServerUpdate }) {
  const textColor = theme === 'light' ? '#111' : '#fff'
  const labelColor = theme === 'light' ? '#555' : 'rgba(255,255,255,0.6)'
  const borderColor = theme === 'light' ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.08)'

  const [name, setName] = useState(server?.name || '')
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [showReinstallConfirm, setShowReinstallConfirm] = useState(false)
  const [showPack, setShowPack] = useState(false)

  const handleRename = async () => {
    if (!isElectron || !name.trim()) return
    try {
      await window.electronAPI.wingsSyncConfig(server.id, { name: name.trim() })
      showToast(lang === 'vi' ? 'Đã đổi tên server' : 'Server renamed', 'success')
      onServerUpdate?.({ ...server, name: name.trim() })
    } catch {
      showToast(t(lang, 'toast.failed'), 'error')
    }
  }

  const handleReinstall = async () => {
    if (!isElectron) return
    try {
      const res = await window.electronAPI.installServer(server.id)
      if (res?.ok) {
        showToast(t(lang, 'toast.reinstalling'), 'success')
        onServerUpdate?.({ ...server, status: 'installing', installProgress: 0 })
      } else {
        showToast(res?.error || t(lang, 'toast.failed'), 'error')
      }
      setShowReinstallConfirm(false)
    } catch {
      showToast(t(lang, 'toast.failed'), 'error')
    }
  }

  const handleDelete = async () => {
    if (!isElectron) return
    try { await window.electronAPI.wingsDeleteServer(server.id) } catch {}
    try { await window.electronAPI.removeServerConfig(server.id) } catch {}
    setShowDeleteConfirm(false)
    showToast(t(lang, 'toast.deleted'), 'success')
    if (onServerDeleted) onServerDeleted()
    if (onBack) onBack()
  }

  if (showPack) {
    return (
      <ServerPackPage
        instance={{ id: server.id, name: server.name, version: server.version, memoryMb: server.resources?.memory || 4096 }}
        serverId={server.id}
        theme={theme}
        lang={lang}
        onClose={() => setShowPack(false)}
      />
    )
  }

  return (
    <div className="h-full flex flex-col overflow-y-auto p-4 gap-4">
      <h2 className="text-sm font-bold" style={{ color: textColor }}>{lang === 'vi' ? 'Cài đặt server' : 'Server Settings'}</h2>

      {/* Rename */}
      <div className="p-3 rounded-xl" style={{ background: theme === 'light' ? 'rgba(0,0,0,0.03)' : 'rgba(255,255,255,0.04)', border: `1px solid ${borderColor}` }}>
        <div className="flex items-center gap-2 mb-2">
          <PencilSimple size={14} weight="duotone" style={{ color: '#a78bfa' }} />
          <label className="text-[11px] font-semibold" style={{ color: textColor }}>{lang === 'vi' ? 'Đổi tên' : 'Rename Server'}</label>
        </div>
        <div className="flex gap-2">
          <input value={name} onChange={e => setName(e.target.value)} className="flex-1 px-3 py-1.5 rounded-lg text-[11px] outline-none transition-colors focus:border-[#a78bfa]" style={{ background: theme === 'light' ? '#fff' : '#1a1a1a', border: `1px solid ${borderColor}`, color: textColor }} />
          <button onClick={handleRename} className={`${btn}`} style={{ background: '#a78bfa', color: '#fff' }}>{lang === 'vi' ? 'Lưu' : 'Save'}</button>
        </div>
      </div>

      {/* Reinstall */}
      <div className="p-3 rounded-xl" style={{ background: theme === 'light' ? 'rgba(0,0,0,0.03)' : 'rgba(255,255,255,0.04)', border: `1px solid ${borderColor}` }}>
        <div className="flex items-center gap-2 mb-2">
          <ArrowClockwise size={14} weight="duotone" style={{ color: '#f59e0b' }} />
          <label className="text-[11px] font-semibold" style={{ color: textColor }}>{lang === 'vi' ? 'Cài lại server' : 'Reinstall Server'}</label>
        </div>
        <p className="text-[10px] mb-2" style={{ color: labelColor }}>{lang === 'vi' ? 'Chạy lại script cài đặt. Dữ liệu trong thư mục gốc sẽ bị xóa.' : 'Re-run the install script. Data in the root directory will be wiped.'}</p>
        {showReinstallConfirm ? (
          <div className="flex gap-2">
            <button onClick={handleReinstall} className={btn} style={{ background: '#f59e0b', color: '#fff' }}>{lang === 'vi' ? 'Xác nhận' : 'Confirm'}</button>
            <button onClick={() => setShowReinstallConfirm(false)} className={btn} style={{ background: borderColor, color: labelColor }}>{lang === 'vi' ? 'Hủy' : 'Cancel'}</button>
          </div>
        ) : (
          <button onClick={() => setShowReinstallConfirm(true)} className={btn} style={{ background: '#f59e0b20', color: '#f59e0b' }}>{lang === 'vi' ? 'Cài lại' : 'Reinstall'}</button>
        )}
      </div>

      <div className="p-3 rounded-xl" style={{ background: theme === 'light' ? 'rgba(0,0,0,0.03)' : 'rgba(255,255,255,0.04)', border: `1px solid ${borderColor}` }}>
        <div className="flex items-center gap-2 mb-2">
          <Package size={14} weight="duotone" style={{ color: '#a78bfa' }} />
          <label className="text-[11px] font-semibold" style={{ color: textColor }}>{lang === 'vi' ? 'Xuất serverpack' : 'Export server pack'}</label>
        </div>
        <p className="text-[10px] mb-2" style={{ color: labelColor }}>
          {lang === 'vi'
            ? 'Mở trang chọn tệp dạng cây rồi đóng gói thành zip để up lên hosting. Cây tệp lấy từ chính thư mục server này.'
            : 'Open the file-tree picker and pack a zip to upload to hosting. The tree reads from this server folder.'}
        </p>
        <button onClick={() => setShowPack(true)} className={btn} style={{ background: '#a78bfa', color: '#fff' }}>
          {lang === 'vi' ? 'Mở trang xuất serverpack' : 'Open export page'}
        </button>
      </div>

      {/* Delete */}
      <div className="p-3 rounded-xl" style={{ background: '#ef444410', border: '1px solid #ef444430' }}>
        <div className="flex items-center gap-2 mb-2">
          <Trash size={14} weight="duotone" style={{ color: '#ef4444' }} />
          <label className="text-[11px] font-semibold" style={{ color: '#ef4444' }}>{lang === 'vi' ? 'Xóa server' : 'Delete Server'}</label>
        </div>
        <p className="text-[10px] mb-2" style={{ color: labelColor }}>{lang === 'vi' ? 'Chuyển server vào thùng rác của launcher (khôi phục được). Chỉ xoá hẳn ở trang Thùng rác.' : 'Moves the server to the launcher trash (recoverable). Permanent delete happens in the Trash page.'}</p>
        {showDeleteConfirm ? (
          <div className="flex gap-2">
            <button onClick={handleDelete} className={btn} style={{ background: '#ef4444', color: '#fff' }}>{lang === 'vi' ? 'Chuyển vào thùng rác' : 'Move to trash'}</button>
            <button onClick={() => setShowDeleteConfirm(false)} className={btn} style={{ background: borderColor, color: labelColor }}>{lang === 'vi' ? 'Hủy' : 'Cancel'}</button>
          </div>
        ) : (
          <button onClick={() => setShowDeleteConfirm(true)} className={btn} style={{ background: '#ef444420', color: '#ef4444' }}>{lang === 'vi' ? 'Xóa' : 'Delete'}</button>
        )}
      </div>
    </div>
  )
}
