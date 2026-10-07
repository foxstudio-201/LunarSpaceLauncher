import { useState } from 'react'
import { Play, ArrowsClockwise } from '@phosphor-icons/react'
import { showToast } from '../../lib/toast'

const isElectron = typeof window !== 'undefined' && window.electronAPI

export default function StartupPage({ server, theme, lang }) {
  const textColor = theme === 'light' ? '#111' : '#fff'
  const labelColor = theme === 'light' ? '#555' : 'rgba(255,255,255,0.6)'
  const borderColor = theme === 'light' ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.08)'

  const [startup, setStartup] = useState(server?.startup || 'java -Xms128M -XX:MaxRAMPercentage=95.0 -jar {{SERVER_JARFILE}} nogui')
  const [dockerImage, setDockerImage] = useState(server?.dockerImage || 'ghcr.io/pelican-eggs/yolks:java_21')
  const [envVars, setEnvVars] = useState(server?.config || {})
  const [saved, setSaved] = useState(false)
  const [pruning, setPruning] = useState(false)
  const [pruneMsg, setPruneMsg] = useState('')
  const [pruneBad, setPruneBad] = useState(false)

  const pruneMods = async () => {
    if (!isElectron || !server?.id || pruning) return
    setPruning(true)
    setPruneMsg('')
    setPruneBad(false)
    try {
      const res = await window.electronAPI.serverLocalPruneMods(server.id)
      if (!res?.ok) {
        setPruneBad(true)
        setPruneMsg(res?.error || (lang === 'vi' ? 'Dò thất bại' : 'Scan failed'))
      } else if (!res.count) {
        setPruneMsg(lang === 'vi' ? `Không thấy mod máy khách nào (đã dò ${res.checked} tệp)` : `No client-only mods found (checked ${res.checked})`)
      } else {
        setPruneMsg(lang === 'vi' ? `Đã chuyển ${res.count} mod vào mods/_client-only/` : `Moved ${res.count} mods to mods/_client-only/`)
        showToast(lang === 'vi' ? `Đã tắt ${res.count} mod máy khách — chạy lại server` : `Disabled ${res.count} client mods — start the server again`, 'success')
      }
    } catch (err) {
      setPruneBad(true)
      setPruneMsg(err?.message || 'error')
    }
    setPruning(false)
  }

  const handleSave = async () => {
    if (!isElectron) return
    try {
      await window.electronAPI.wingsSyncConfig(server.id, { startup, docker_image: dockerImage, environment: envVars })
      setSaved(true)
      showToast(lang === 'vi' ? 'Đã lưu cấu hình khởi động' : 'Startup config saved', 'success')
      setTimeout(() => setSaved(false), 2000)
    } catch {
      showToast(lang === 'vi' ? 'Lưu thất bại' : 'Save failed', 'error')
    }
  }

  return (
    <div className="h-full flex flex-col overflow-y-auto p-4 gap-4">
      <div className="flex items-center gap-3">
        <h2 className="text-sm font-bold" style={{ color: textColor }}>{lang === 'vi' ? 'Khởi động' : 'Startup Configuration'}</h2>
        <div className="flex-1" />
        <button
          onClick={handleSave}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-all duration-150 hover:opacity-80 active:scale-95"
          style={{ background: saved ? '#22c55e' : '#8b5cf6', color: '#fff' }}
        >
          {saved ? (lang === 'vi' ? 'Đã lưu!' : 'Saved!') : (lang === 'vi' ? 'Lưu' : 'Save')}
        </button>
      </div>

      {/* Startup Command */}
      <div>
        <label className="text-[11px] font-semibold mb-1 block" style={{ color: labelColor }}>{lang === 'vi' ? 'Lệnh khởi động' : 'Startup Command'}</label>
        <input value={startup} onChange={e => setStartup(e.target.value)} className="w-full px-3 py-2 rounded-lg text-[11px] font-mono outline-none transition-colors focus:border-[#8b5cf6]" style={{ background: theme === 'light' ? '#fff' : '#1a1a1a', border: `1px solid ${borderColor}`, color: textColor }} />
      </div>

      {/* Docker Image */}
      <div>
        <label className="text-[11px] font-semibold mb-1 block" style={{ color: labelColor }}>Docker Image</label>
        <input value={dockerImage} onChange={e => setDockerImage(e.target.value)} className="w-full px-3 py-2 rounded-lg text-[11px] font-mono outline-none transition-colors focus:border-[#8b5cf6]" style={{ background: theme === 'light' ? '#fff' : '#1a1a1a', border: `1px solid ${borderColor}`, color: textColor }} />
      </div>

      {/* Environment Variables */}
      <div>
        <label className="text-[11px] font-semibold mb-2 block" style={{ color: labelColor }}>{lang === 'vi' ? 'Biến môi trường' : 'Environment Variables'}</label>
        {Object.entries(envVars).map(([key, val], i) => (
          <div key={i} className="flex gap-2 mb-2">
            <input value={key} readOnly className="flex-1 px-3 py-1.5 rounded-lg text-[11px] font-mono outline-none" style={{ background: theme === 'light' ? 'rgba(0,0,0,0.03)' : 'rgba(255,255,255,0.04)', border: `1px solid ${borderColor}`, color: labelColor }} />
            <input value={val} onChange={e => { const n = {...envVars}; n[key] = e.target.value; setEnvVars(n) }} className="flex-1 px-3 py-1.5 rounded-lg text-[11px] font-mono outline-none transition-colors focus:border-[#8b5cf6]" style={{ background: theme === 'light' ? '#fff' : '#1a1a1a', border: `1px solid ${borderColor}`, color: textColor }} />
          </div>
        ))}
        <button
          onClick={() => setEnvVars(prev => ({...prev, '': ''}))}
          className="text-[11px] font-semibold mt-1 transition-all duration-150 hover:opacity-70 active:scale-95"
          style={{ color: '#a78bfa' }}
        >+ {lang === 'vi' ? 'Thêm biến' : 'Add variable'}</button>
      </div>
      <div className="mb-6">
        <div className="flex items-center gap-3 mb-2">
          <h3 className="text-xs font-bold" style={{ color: textColor }}>{lang === 'vi' ? 'Mod máy khách' : 'Client-only mods'}</h3>
        </div>
        <p className="text-[11px] mb-2" style={{ color: labelColor }}>
          {lang === 'vi'
            ? 'Mod chỉ chạy ở máy khách (Sodium, Iris, shader, tối ưu hiển thị…) làm server chết ngay khi khởi động. Nút này dò trên Modrinth rồi chuyển chúng vào mods/_client-only/ (khôi phục được).'
            : 'Client-only mods (Sodium, Iris, shaders, render tweaks…) kill the server on startup. This scans Modrinth and moves them to mods/_client-only/ (recoverable).'}
        </p>
        <div className="flex items-center gap-3">
          <button
            onClick={pruneMods}
            disabled={pruning}
            className="px-3 py-1.5 rounded-lg text-[11px] font-semibold disabled:opacity-50"
            style={{ background: '#8b5cf6', color: '#fff' }}
          >
            {pruning
              ? (lang === 'vi' ? 'Đang dò…' : 'Scanning…')
              : (lang === 'vi' ? 'Dò & tắt mod máy khách' : 'Scan & disable client mods')}
          </button>
          {pruneMsg && <span className="text-[11px]" style={{ color: pruneBad ? '#f87171' : '#22c55e' }}>{pruneMsg}</span>}
        </div>
      </div>
    </div>
  )
}
