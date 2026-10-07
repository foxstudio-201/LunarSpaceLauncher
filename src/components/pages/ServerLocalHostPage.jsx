import { useCallback, useEffect, useState } from 'react'
import {
  ChartLineUp, Terminal, Files, Database, Clock, Users, Archive, Network, Play, GearSix,
  ArrowLeft, Plus, Trash, Cube, ArrowClockwise, Stop, X, HardDrives, WarningCircle,
} from '@phosphor-icons/react'
import ServerPanel from '../server/ServerPanel'
import ToastHost from '../server/ToastHost'
import Select from '../ui/Select'
import { palette } from '../../lib/palette'
import * as api from '../../api/client.js'

const SERVER_PANEL_PAGES = [
  { key: 'server-overview', icon: ChartLineUp, label: 'Overview', labelVi: 'Tổng quan' },
  { key: 'server-console', icon: Terminal, label: 'Console', labelVi: 'Bảng điều khiển' },
  { key: 'server-files', icon: Files, label: 'Files', labelVi: 'Tệp tin' },
  { key: 'server-databases', icon: Database, label: 'Databases', labelVi: 'Cơ sở dữ liệu' },
  { key: 'server-schedules', icon: Clock, label: 'Schedules', labelVi: 'Lịch trình' },
  { key: 'server-users', icon: Users, label: 'Users', labelVi: 'Người dùng' },
  { key: 'server-backups', icon: Archive, label: 'Backups', labelVi: 'Sao lưu' },
  { key: 'server-network', icon: Network, label: 'Network', labelVi: 'Mạng' },
  { key: 'server-startup', icon: Play, label: 'Startup', labelVi: 'Khởi động' },
  { key: 'server-settings', icon: GearSix, label: 'Settings', labelVi: 'Cài đặt' },
]

const LOADERS = ['vanilla', 'paper', 'purpur', 'spigot', 'forge', 'neoforge', 'fabric']

const vn = (lang, vi, en) => (lang === 'vi' ? vi : en)

const EGG_LABEL = {
  vanilla: 'Vanilla',
  paper: 'Paper',
  purpur: 'Purpur',
  spigot: 'Spigot',
  forge: 'Forge',
  neoforge: 'NeoForge',
  fabric: 'Fabric',
}

function statusColor(status) {
  if (status === 'running') return '#22c55e'
  if (status === 'installing' || status === 'starting' || status === 'stopping') return '#eab308'
  if (status === 'error') return '#ef4444'
  return '#71717a'
}

function statusLabel(status, lang) {
  const map = {
    running: ['Trực tuyến', 'Online'],
    starting: ['Đang khởi động', 'Starting'],
    stopping: ['Đang tắt', 'Stopping'],
    installing: ['Đang cài', 'Installing'],
    error: ['Lỗi', 'Error'],
    stopped: ['Đã tắt', 'Offline'],
    offline: ['Ngoại tuyến', 'Offline'],
  }
  const item = map[status] || map.stopped
  return vn(lang, item[0], item[1])
}

export default function ServerLocalHostPage({ theme, lang, instances, server, displayPage, onSelect, onUpdate, onDeleted }) {
  const c = palette(theme)
  const [servers, setServers] = useState([])
  const [eggs, setEggs] = useState([])
  const [creating, setCreating] = useState(false)
  const [deleting, setDeleting] = useState(null)
  const [busy, setBusy] = useState('')
  const [trashOpen, setTrashOpen] = useState(false)
  const [trashItems, setTrashItems] = useState([])
  const [trashBusy, setTrashBusy] = useState('')
  const [purgeAsk, setPurgeAsk] = useState(null)

  const loadTrash = useCallback(async (open) => {
    const res = await api.serverLocalTrash().catch(() => null)
    setTrashItems(res?.items || [])
    if (open) setTrashOpen(true)
  }, [])

  const refresh = useCallback(async () => {
    const res = await api.getServerConfigs().catch(() => null)
    if (res?.ok) setServers(res.servers || [])
    return res
  }, [])

  useEffect(() => {
    refresh()
    loadTrash(false)
    api.serverTestEggs().then((res) => { if (res?.ok) setEggs(res.eggs || []) }).catch(() => {})
  }, [refresh, loadTrash])

  useEffect(() => {
    const timer = setInterval(refresh, 3000)
    return () => clearInterval(timer)
  }, [refresh])

  useEffect(() => {
    if (!server) return
    const fresh = servers.find((item) => item.id === server.id)
    if (fresh && fresh.status !== server.status && onUpdate) onUpdate(fresh)
  }, [servers, server, onUpdate])

  const power = async (srv, action) => {
    setBusy(`${srv.id}:${action}`)
    const res =
      action === 'start'
        ? await api.startGameServer(srv.id).catch((err) => ({ ok: false, error: err.message }))
        : action === 'stop'
          ? await api.stopGameServer(srv.id).catch((err) => ({ ok: false, error: err.message }))
          : action === 'kill'
            ? await api.killGameServer(srv.id).catch((err) => ({ ok: false, error: err.message }))
            : await api.wingsServerPower(srv.id, action).catch((err) => ({ ok: false, error: err.message }))
    setBusy('')
    await refresh()
    return res
  }

  const removeServer = async () => {
    if (!deleting) return
    setBusy('delete')
    await api.wingsDeleteServer(deleting.id).catch(() => {})
    await api.removeServerConfig(deleting.id).catch(() => {})
    const wasOpen = server && server.id === deleting.id
    setDeleting(null)
    setBusy('')
    await refresh()
    await loadTrash(false)
    if (wasOpen) onDeleted?.()
  }

  const restoreTrash = async (item) => {
    setTrashBusy(item.trashId)
    const res = await api.serverLocalRestore(item.trashId).catch((err) => ({ ok: false, error: err.message }))
    setTrashBusy('')
    if (!res?.ok) return
    await refresh()
    await loadTrash(false)
    if (res.server) onSelect?.(res.server)
  }

  const purgeTrash = async () => {
    if (!purgeAsk) return
    setTrashBusy(purgeAsk.trashId)
    await api.serverLocalPurge(purgeAsk.trashId).catch(() => {})
    setPurgeAsk(null)
    setTrashBusy('')
    await loadTrash(false)
  }

  if (server) {
    const live = servers.find((item) => item.id === server.id) || server
    return (
      <div data-surface className="h-full relative overflow-hidden" style={{ background: c.bg }}>
        <ServerPanel
          key={live.id}
          server={live}
          theme={theme}
          lang={lang}
          displayPage={displayPage}
          onBack={() => onDeleted?.()}
          onServerDeleted={() => { onDeleted?.(); refresh() }}
          onServerUpdate={(next) => { onUpdate?.(next); refresh() }}
        />
        <ToastHost theme={theme} />
      </div>
    )
  }

  return (
    <div data-surface className="h-full flex flex-col overflow-hidden" style={{ background: c.bg }}>
      <div className="shrink-0 flex items-center gap-3 px-6 py-3.5" style={{ borderBottom: `1px solid ${c.border}` }}>
        <HardDrives size={20} weight="duotone" style={{ color: c.accent }} />
        <div className="min-w-0">
          <h1 className="text-base font-bold truncate" style={{ color: c.text }}>ServerLocalHost</h1>
          <p className="text-[11px] truncate" style={{ color: c.label }}>
            {vn(
              lang,
              'Chạy server Minecraft ngay trên máy đúng cơ chế egg (không Docker) để test trước khi up lên hosting.',
              'Run a Minecraft server locally with the exact egg mechanism (no Docker) to test before uploading.',
            )}
          </p>
        </div>
        <div className="flex-1" />
        <button
          onClick={() => loadTrash(true)}
          className="h-9 px-3 rounded-xl text-[11px] font-semibold inline-flex items-center gap-1.5"
          style={{ background: c.input, border: `1px solid ${c.border}`, color: c.label }}
        >
          <Trash size={14} weight="duotone" />
          {vn(lang, 'Thùng rác', 'Trash')}
          {trashItems.length > 0 && <span className="font-mono">({trashItems.length})</span>}
        </button>
        <button
          onClick={() => setCreating(true)}
          className="h-9 px-3.5 rounded-xl text-[11px] font-bold inline-flex items-center gap-1.5"
          style={{ background: c.accent, color: c.ink }}
        >
          <Plus size={14} weight="bold" />
          {vn(lang, 'Tạo server', 'Create server')}
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto p-4">
        {servers.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center gap-6">
            <div className="flex flex-col items-center gap-3">
              <HardDrives size={40} weight="duotone" style={{ color: c.label, opacity: 0.4 }} />
              <p className="text-sm font-semibold" style={{ color: c.text }}>
                {vn(lang, 'Chưa có server nào', 'No servers yet')}
              </p>
              <p className="text-[11px] text-center max-w-sm" style={{ color: c.label }}>
                {vn(
                  lang,
                  'Tạo server từ một instance (copy mods/config theo mặc định serverpack) hoặc server trống, rồi cài bằng script egg và chạy thử ngay trên máy.',
                  'Create a server from an instance (copies mods/config per serverpack defaults) or empty, install it with the egg script and run it locally.',
                )}
              </p>
            </div>
            <button
              onClick={() => setCreating(true)}
              className="h-11 px-6 rounded-xl text-[13px] font-bold inline-flex items-center gap-2"
              style={{ background: c.accent, color: c.ink }}
            >
              <Plus size={16} weight="bold" />
              {vn(lang, 'Tạo server', 'Create server')}
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
            {servers.map((srv) => {
              const color = statusColor(srv.status)
              const running = srv.status === 'running'
              return (
                <div
                  key={srv.id}
                  className="rounded-2xl overflow-hidden flex flex-col"
                  style={{ background: c.surface, border: `1px solid ${c.border}` }}
                >
                  <div className="flex items-center gap-3 px-3.5 py-3">
                    <div className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0" style={{ background: 'rgba(167,139,250,0.12)' }}>
                      <Cube size={22} weight="duotone" style={{ color: c.accent }} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-bold truncate" style={{ color: c.text }}>{srv.name}</p>
                      <p className="text-[10px] font-mono truncate" style={{ color: c.label }}>
                        {EGG_LABEL[srv.egg] || srv.egg}{srv.version ? ` · ${srv.version}` : ''} · 127.0.0.1:{srv.port}
                      </p>
                    </div>
                    <span className="h-6 px-2 rounded-lg text-[10px] font-bold inline-flex items-center gap-1.5 shrink-0" style={{ background: `${color}22`, color }}>
                      <span className="w-1.5 h-1.5 rounded-full" style={{ background: color }} />
                      {statusLabel(srv.status, lang)}
                    </span>
                  </div>

                  <div className="flex items-center gap-2 px-3.5 pb-3.5">
                    <button
                      onClick={() => onSelect?.(srv)}
                      className="h-8 px-3 rounded-lg text-[11px] font-bold inline-flex items-center gap-1.5"
                      style={{ background: c.accent, color: c.ink }}
                    >
                      <ChartLineUp size={13} weight="bold" />
                      {vn(lang, 'Quản lý', 'Manage')}
                    </button>
                    {running ? (
                      <button
                        onClick={() => power(srv, 'stop')}
                        disabled={!!busy}
                        className="h-8 px-3 rounded-lg text-[11px] font-semibold inline-flex items-center gap-1.5 disabled:opacity-45"
                        style={{ background: 'rgba(239,68,68,0.14)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.3)' }}
                      >
                        <Stop size={12} weight="fill" />
                        {vn(lang, 'Dừng', 'Stop')}
                      </button>
                    ) : (
                      <button
                        onClick={() => power(srv, 'start')}
                        disabled={!!busy}
                        className="h-8 px-3 rounded-lg text-[11px] font-semibold inline-flex items-center gap-1.5 disabled:opacity-45"
                        style={{ background: c.input, border: `1px solid ${c.border}`, color: c.label }}
                      >
                        <Play size={12} weight="fill" />
                        {vn(lang, 'Chạy', 'Start')}
                      </button>
                    )}
                    <button
                      onClick={() => power(srv, 'restart')}
                      disabled={!!busy}
                      className="h-8 px-3 rounded-lg text-[11px] font-semibold inline-flex items-center gap-1.5 disabled:opacity-45"
                      style={{ background: c.input, border: `1px solid ${c.border}`, color: c.label }}
                    >
                      <ArrowClockwise size={12} weight="bold" />
                      {vn(lang, 'Chạy lại', 'Restart')}
                    </button>
                    <div className="flex-1" />
                    <button
                      onClick={() => setDeleting(srv)}
                      title={vn(lang, 'Xoá server', 'Delete server')}
                      className="w-8 h-8 rounded-lg flex items-center justify-center"
                      style={{ background: c.input, border: `1px solid ${c.border}`, color: c.label }}
                    >
                      <Trash size={13} weight="duotone" />
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {trashOpen && (
        <div className="modal-backdrop fixed inset-0 z-[210] flex items-center justify-center p-6" onClick={() => setTrashOpen(false)}>
          <div className="modal-content w-full max-w-[640px] rounded-2xl flex flex-col overflow-hidden" style={{ background: c.surface, border: `1px solid ${c.border}` }} onClick={(e) => e.stopPropagation()}>
            <div className="px-4 py-3 flex items-center gap-2" style={{ borderBottom: `1px solid ${c.border}` }}>
              <Trash size={15} weight="duotone" style={{ color: c.accent }} />
              <p className="text-[12px] font-bold flex-1" style={{ color: c.text }}>
                {vn(lang, 'Thùng rác server', 'Server trash')}
                {trashItems.length > 0 && <span className="ml-2 font-mono text-[10px]" style={{ color: c.faint }}>{trashItems.length}</span>}
              </p>
              <button onClick={() => setTrashOpen(false)} style={{ color: c.faint }}>
                <X size={13} weight="bold" />
              </button>
            </div>
            <div className="max-h-[60vh] overflow-y-auto p-3 flex flex-col gap-2">
              <p className="px-1 text-[10px] leading-relaxed" style={{ color: c.faint }}>
                {vn(
                  lang,
                  'Xoá server chỉ chuyển thư mục vào đây — khôi phục được. “Xoá hẳn” mới xoá vĩnh viễn khỏi ổ đĩa.',
                  'Deleting a server only moves its folder here — recoverable. “Delete forever” removes it permanently.',
                )}
              </p>
              {trashItems.length === 0 && (
                <p className="px-1 py-6 text-center text-[11px]" style={{ color: c.label }}>
                  {vn(lang, 'Thùng rác trống', 'Trash is empty')}
                </p>
              )}
              {trashItems.map((item) => (
                <div key={item.trashId} className="rounded-xl px-3 py-2.5 flex items-center gap-3" style={{ background: c.input, border: `1px solid ${c.border}` }}>
                  <Cube size={18} weight="duotone" style={{ color: c.accent }} />
                  <div className="flex-1 min-w-0">
                    <p className="text-[11px] font-bold truncate" style={{ color: c.text }}>{item.name}</p>
                    <p className="text-[9px] font-mono truncate" style={{ color: c.label }}>
                      {item.eggId || '?'}{item.mc ? ` · ${item.mc}` : ''} · {Math.round((item.bytes || 0) / 104857.6) / 10} MB · {new Date(item.at).toLocaleString('vi-VN')}
                    </p>
                    {!item.restorable && (
                      <p className="text-[9px]" style={{ color: '#f59e0b' }}>
                        {vn(lang, 'Bản cũ — chỉ xoá hẳn, không khôi phục tự động.', 'Old entry — delete only, cannot auto-restore.')}
                      </p>
                    )}
                  </div>
                  <button
                    onClick={() => restoreTrash(item)}
                    disabled={!item.restorable || !!trashBusy}
                    className="h-7 px-2.5 rounded-lg text-[10px] font-bold disabled:opacity-40 shrink-0"
                    style={{ background: c.accent, color: c.ink }}
                  >
                    {vn(lang, 'Khôi phục', 'Restore')}
                  </button>
                  <button
                    onClick={() => setPurgeAsk(item)}
                    disabled={!!trashBusy}
                    className="h-7 px-2.5 rounded-lg text-[10px] font-bold disabled:opacity-40 shrink-0"
                    style={{ background: 'rgba(239,68,68,0.14)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.3)' }}
                  >
                    {vn(lang, 'Xoá hẳn', 'Delete forever')}
                  </button>
                </div>
              ))}
            </div>
            <div className="px-4 py-3 flex justify-end" style={{ borderTop: `1px solid ${c.border}` }}>
              <button onClick={() => setTrashOpen(false)} className="h-8 px-3 rounded-lg text-[11px] font-semibold" style={{ background: c.input, border: `1px solid ${c.border}`, color: c.label }}>
                {vn(lang, 'Đóng', 'Close')}
              </button>
            </div>
          </div>
        </div>
      )}

      {purgeAsk && (
        <div className="modal-backdrop fixed inset-0 z-[220] flex items-center justify-center p-6" onClick={() => setPurgeAsk(null)}>
          <div className="modal-content w-full max-w-[440px] rounded-2xl" style={{ background: c.surface, border: '1px solid rgba(239,68,68,0.35)' }} onClick={(e) => e.stopPropagation()}>
            <div className="px-4 py-3 flex items-center gap-2" style={{ borderBottom: `1px solid ${c.border}` }}>
              <Trash size={15} weight="duotone" style={{ color: '#ef4444' }} />
              <p className="text-[12px] font-bold flex-1" style={{ color: c.text }}>{vn(lang, 'Xoá hẳn server', 'Delete forever')}</p>
            </div>
            <div className="p-4 flex flex-col gap-3">
              <p className="text-[11px] leading-relaxed" style={{ color: c.text }}>
                {vn(lang, `Xoá vĩnh viễn “${purgeAsk.name}” khỏi ổ đĩa? Không hoàn tác được.`, `Permanently delete “${purgeAsk.name}” from disk? This cannot be undone.`)}
              </p>
              <div className="flex items-center justify-end gap-2">
                <button onClick={() => setPurgeAsk(null)} className="h-8 px-3 rounded-lg text-[11px] font-semibold" style={{ background: c.input, border: `1px solid ${c.border}`, color: c.label }}>
                  {vn(lang, 'Huỷ', 'Cancel')}
                </button>
                <button onClick={purgeTrash} disabled={!!trashBusy} className="h-8 px-3 rounded-lg text-[11px] font-bold disabled:opacity-50" style={{ background: '#ef4444', color: '#fff' }}>
                  {vn(lang, 'Xoá vĩnh viễn', 'Delete forever')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {creating && (
        <CreateServerModal
          c={c}
          theme={theme}
          lang={lang}
          instances={instances}
          eggs={eggs}
          onClose={() => setCreating(false)}
          onCreated={async (id) => {
            setCreating(false)
            const res = await refresh()
            const created = (res?.servers || []).find((item) => item.id === id)
            if (created) onSelect?.(created)
            api.installServer(id).then(() => refresh()).catch(() => {})
          }}
        />
      )}

      {deleting && (
        <div className="modal-backdrop fixed inset-0 z-[210] flex items-center justify-center p-6" onClick={() => setDeleting(null)}>
          <div className="modal-content w-full max-w-[460px] rounded-2xl" style={{ background: c.surface, border: `1px solid ${c.border}` }} onClick={(e) => e.stopPropagation()}>
            <div className="px-4 py-3 flex items-center gap-2" style={{ borderBottom: `1px solid ${c.border}` }}>
              <Trash size={15} weight="duotone" style={{ color: '#ef4444' }} />
              <p className="text-[12px] font-bold flex-1" style={{ color: c.text }}>
                {vn(lang, 'Xoá server', 'Delete server')}
              </p>
              <button onClick={() => setDeleting(null)} style={{ color: c.faint }}>
                <X size={13} weight="bold" />
              </button>
            </div>
            <div className="p-4 flex flex-col gap-3">
              <p className="text-[11px] leading-relaxed" style={{ color: c.text }}>
                {vn(lang, `Xoá “${deleting.name}”? Thư mục server được chuyển vào thùng rác của launcher (khôi phục được).`, `Delete “${deleting.name}”? The folder is moved to the launcher trash (recoverable).`)}
              </p>
              <p className="text-[9px] font-mono break-all" style={{ color: c.faint }}>{deleting.dir}</p>
              <div className="flex items-center justify-end gap-2">
                <button onClick={() => setDeleting(null)} className="h-8 px-3 rounded-lg text-[11px] font-semibold" style={{ background: c.input, border: `1px solid ${c.border}`, color: c.label }}>
                  {vn(lang, 'Huỷ', 'Cancel')}
                </button>
                <button onClick={removeServer} disabled={busy === 'delete'} className="h-8 px-3 rounded-lg text-[11px] font-bold disabled:opacity-50" style={{ background: '#ef4444', color: '#fff' }}>
                  {vn(lang, 'Xoá', 'Delete')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function CreateServerModal({ c, theme, lang, instances, eggs, onClose, onCreated }) {
  const [instanceId, setInstanceId] = useState('')
  const [eggId, setEggId] = useState('vanilla')
  const [name, setName] = useState('')
  const [mc, setMc] = useState('')
  const [port, setPort] = useState(25565)
  const [ramMb, setRamMb] = useState(4096)
  const [withContent, setWithContent] = useState(true)
  const [suggest, setSuggest] = useState(null)
  const [busy, setBusy] = useState(false)
  const [info, setInfo] = useState('')

  useEffect(() => {
    if (instanceId) return
    api.serverTestSuggest({}).then((res) => {
      if (res?.ok && res.port) setPort(res.port)
    }).catch(() => {})
  }, [instanceId])

  useEffect(() => {
    if (!instanceId) return
    api.serverTestSuggest({ instanceId }).then((res) => {
      if (!res?.ok) return
      setSuggest(res)
      setEggId(res.eggId)
      setMc(res.mc || '')
      setPort(res.port || 25565)
      setRamMb(res.ramMb || 4096)
      setName(`${instances.find((i) => i.id === instanceId)?.name || 'Server'} · test`)
    }).catch(() => {})
  }, [instanceId])

  const create = async () => {
    setBusy(true)
    let include = []
    let skipped = 0
    if (withContent && instanceId) {
      setInfo(vn(lang, 'Đang lấy danh sách tệp mặc định…', 'Collecting default file list…'))
      const res = await api.serverTestDefaults({ instanceId }).catch(() => null)
      include = res?.include || []
      skipped = res?.removed || 0
    }
    setInfo(
      skipped
        ? vn(lang, `Đang tạo thư mục + chép ${include.length} tệp (đã bỏ ${skipped} mod chỉ chạy client)…`, `Creating folder + copying ${include.length} files (${skipped} client-only mods skipped)…`)
        : vn(lang, `Đang tạo thư mục + chép ${include.length} tệp…`, `Creating folder + copying ${include.length} files…`),
    )
    const res = await api.serverTestCreate({
      name: name || 'Server test',
      eggId,
      mc,
      loaderVersion: suggest?.loaderVersion || '',
      ramMb,
      port,
      include,
      instanceId: instanceId || undefined,
      vars: {
        MC_VERSION: mc,
        NEOFORGE_VERSION: eggId === 'neoforge' ? suggest?.loaderVersion || '' : '',
        FORGE_VERSION: eggId === 'forge' ? suggest?.loaderVersion || '' : '',
        SERVER_JARFILE: 'server.jar',
      },
    }).catch((err) => ({ ok: false, error: err.message }))
    setBusy(false)
    if (!res?.ok) {
      setInfo(res?.error || 'error')
      return
    }
    onCreated?.(res.server.id)
  }

  return (
    <div className="modal-backdrop fixed inset-0 z-[210] flex items-center justify-center p-6" onClick={() => { if (!busy) onClose() }}>
      <div className="modal-content w-full max-w-[560px] rounded-2xl flex flex-col overflow-hidden" style={{ background: c.surface, border: `1px solid ${c.border}` }} onClick={(e) => e.stopPropagation()}>
        <div className="px-4 py-3 flex items-center gap-2" style={{ borderBottom: `1px solid ${c.border}` }}>
          <HardDrives size={15} weight="duotone" style={{ color: c.accent }} />
          <p className="text-[12px] font-bold flex-1" style={{ color: c.text }}>{vn(lang, 'Tạo server', 'Create server')}</p>
          <button onClick={() => { if (!busy) onClose() }} style={{ color: c.faint }}>
            <X size={13} weight="bold" />
          </button>
        </div>
        <div className="p-4 grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1 min-w-0">
            <span className="text-[10px] font-semibold" style={{ color: c.label }}>{vn(lang, 'Instance nguồn', 'Source instance')}</span>
            <Select
              theme={theme}
              value={instanceId}
              onChange={setInstanceId}
              options={[{ value: '', label: vn(lang, '— Server trống —', '— Empty server —') }, ...(instances || []).map((i) => ({ value: i.id, label: `${i.name} · ${i.version}` }))]}
            />
            <span className="text-[9px]" style={{ color: c.faint }}>
              {vn(lang, 'Lấy mods/config theo danh sách mặc định của serverpack.', 'Copies mods/config per serverpack defaults.')}
            </span>
          </label>
          <label className="flex flex-col gap-1 min-w-0">
            <span className="text-[10px] font-semibold" style={{ color: c.label }}>Egg</span>
            <Select theme={theme} value={eggId} onChange={setEggId} options={LOADERS.map((l) => ({ value: l, label: `${EGG_LABEL[l]} (${l}.json)` }))} />
          </label>
          <label className="flex flex-col gap-1 min-w-0">
            <span className="text-[10px] font-semibold" style={{ color: c.label }}>{vn(lang, 'Tên server', 'Server name')}</span>
            <input value={name} onChange={(e) => setName(e.target.value)} className="h-8 px-2.5 rounded-lg text-[11px] outline-none" style={{ background: c.input, border: `1px solid ${c.border}`, color: c.text }} />
          </label>
          <label className="flex flex-col gap-1 min-w-0">
            <span className="text-[10px] font-semibold" style={{ color: c.label }}>{vn(lang, 'Phiên bản Minecraft', 'Minecraft version')}</span>
            <input value={mc} onChange={(e) => setMc(e.target.value)} className="h-8 px-2.5 rounded-lg text-[11px] font-mono outline-none" style={{ background: c.input, border: `1px solid ${c.border}`, color: c.text }} />
          </label>
          <label className="flex flex-col gap-1 min-w-0">
            <span className="text-[10px] font-semibold" style={{ color: c.label }}>{vn(lang, 'Cổng', 'Port')}</span>
            <input type="number" value={port} onChange={(e) => setPort(Number(e.target.value))} className="h-8 px-2.5 rounded-lg text-[11px] font-mono outline-none" style={{ background: c.input, border: `1px solid ${c.border}`, color: c.text }} />
          </label>
          <label className="flex flex-col gap-1 min-w-0">
            <span className="text-[10px] font-semibold" style={{ color: c.label }}>RAM (MB)</span>
            <input type="number" value={ramMb} onChange={(e) => setRamMb(Number(e.target.value))} className="h-8 px-2.5 rounded-lg text-[11px] font-mono outline-none" style={{ background: c.input, border: `1px solid ${c.border}`, color: c.text }} />
          </label>
          <label className="col-span-2 flex items-center gap-2 text-[11px]" style={{ color: c.label }}>
            <input type="checkbox" checked={withContent} onChange={(e) => setWithContent(e.target.checked)} disabled={!instanceId} />
            {vn(lang, 'Chép mods/config của instance vào server (mặc định serverpack)', 'Copy the instance mods/config into the server (serverpack defaults)')}
          </label>
          {suggest && (
            <p className="col-span-2 text-[10px] leading-relaxed" style={{ color: c.faint }}>
              {vn(
                lang,
                `Loader ${suggest.loader} → egg ${suggest.eggId} · Java ${suggest.javaMajor} · cổng trống ${suggest.port}.`,
                `Loader ${suggest.loader} → egg ${suggest.eggId} · Java ${suggest.javaMajor} · free port ${suggest.port}.`,
              )}
            </p>
          )}
          {info && (
            <p className="col-span-2 text-[10px] inline-flex items-center gap-1" style={{ color: c.accent }}>
              <WarningCircle size={11} weight="duotone" />
              {info}
            </p>
          )}
        </div>
        <div className="px-4 py-3 flex items-center gap-2 justify-end" style={{ borderTop: `1px solid ${c.border}` }}>
          <button onClick={onClose} disabled={busy} className="h-8 px-3 rounded-lg text-[11px] font-semibold disabled:opacity-50" style={{ background: c.input, border: `1px solid ${c.border}`, color: c.label }}>
            {vn(lang, 'Huỷ', 'Cancel')}
          </button>
          <button onClick={create} disabled={busy} className="h-8 px-4 rounded-lg text-[11px] font-bold inline-flex items-center gap-2 disabled:opacity-50" style={{ background: c.accent, color: c.ink }}>
            {busy ? <ArrowClockwise size={12} weight="bold" className="animate-spin" /> : <Plus size={12} weight="bold" />}
            {vn(lang, 'Tạo server', 'Create')}
          </button>
        </div>
      </div>
    </div>
  )
}
