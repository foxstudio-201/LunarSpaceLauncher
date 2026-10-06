import { useCallback, useEffect, useState } from 'react'
import {
  Translate, MoonStars, Sun, Coffee, DownloadSimple, Trash, ArrowsClockwise,
  SpinnerGap, CheckCircle, FloppyDisk, HardDrive, WarningCircle, DiscordLogo,
  SquaresFour,
} from '@phosphor-icons/react'
import { useApp } from '../../i18n/AppContext'
import { t } from '../../i18n/translations'
import { palette } from '../../lib/palette'
import { formatBytes, formatDate } from '../../lib/status'
import PageHeader from '../ui/PageHeader'
import Switch from '../ui/Switch'
import { Card, Fact, Meter, Section, Skeleton } from '../ui/Panel'
import * as api from '../../api/client.js'

const vn = (lang, vi, en) => (lang === 'vi' ? vi : en)

const JAVA_TARGETS = {
  'java-runtime-epsilon': '26.x',
  'java-runtime-delta': '1.20.5 – 1.21.x',
  'java-runtime-beta': '1.18 – 1.20.4',
  'java-runtime-gamma': '1.18 – 1.20.4',
  'jre-legacy': '≤ 1.16.5',
}

function Row({ c, icon, title, desc, children }) {
  return (
    <div className="flex items-center gap-4 px-4 py-3.5" style={{ borderTop: `1px solid ${c.border}` }}>
      {icon && (
        <span className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ background: c.input, color: c.accent }}>
          {icon}
        </span>
      )}
      <div className="min-w-0 flex-1">
        <p className="text-xs font-semibold" style={{ color: c.text }}>{title}</p>
        {desc && <p className="text-[10px] break-all" style={{ color: c.faint }}>{desc}</p>}
      </div>
      <div className="shrink-0 flex items-center gap-2">{children}</div>
    </div>
  )
}

function Segmented({ c, value, onChange, options }) {
  return (
    <div className="flex items-center gap-1 p-0.5 rounded-lg" style={{ background: c.input, border: `1px solid ${c.border}` }}>
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className="h-7 px-3 rounded-md text-[11px] font-semibold transition-colors"
          style={{
            background: value === o.value ? c.surface : 'transparent',
            color: value === o.value ? c.accent : c.label,
            boxShadow: value !== o.value ? 'none' : c.pixel ? `1px 1px 0 0 ${c.ink}` : '0 1px 2px rgba(0,0,0,0.25)',
          }}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

const smallBtn = (c) => ({ background: c.input, border: `1px solid ${c.border}`, color: c.label })

export default function SettingsPage({ theme, lang, version, system, storage, onSave, update: updateEvent }) {
  const { setLang, setTheme, skin, setSkin } = useApp()
  const c = palette(theme)
  const [javaPath, setJavaPath] = useState(storage?.javaPath || '')
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')
  const [runtimes, setRuntimes] = useState([])
  const [platform, setPlatform] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState('')
  const [confirming, setConfirming] = useState('')
  const [richPresence, setRichPresence] = useState(true)
  const [discord, setDiscord] = useState({ enabled: true, connected: false, user: null })
  const [upd, setUpd] = useState({ enabled: true, phase: 'idle', current: version || '', version: '', percent: 0, error: '' })

  useEffect(() => {
    api.updateStatus().then((res) => { if (res?.ok) setUpd((u) => ({ ...u, ...res })) }).catch(() => {})
  }, [])

  useEffect(() => {
    if (updateEvent?.type === 'update') setUpd((u) => ({ ...u, ...updateEvent }))
  }, [updateEvent])

  const updateState = upd.phase || 'idle'
  const updateBusy = updateState === 'checking' || updateState === 'downloading'
  const toggleAutoUpdate = async (next) => {
    setUpd((u) => ({ ...u, enabled: next }))
    await onSave({ autoUpdate: next })
  }
  const runUpdateCheck = async () => {
    setUpd((u) => ({ ...u, phase: 'checking', error: '' }))
    const res = await api.updateCheck().catch((err) => ({ ok: false, error: err.message }))
    if (!res?.ok) setUpd((u) => ({ ...u, phase: 'error', error: res?.error || 'error' }))
  }
  const runUpdateInstall = async () => { await api.updateInstall().catch(() => {}) }
  const updateStatusText = () => {
    if (updateState === 'unsupported') return vn(lang, 'Chỉ tự cập nhật ở bản đã cài (Setup), không áp dụng khi chạy mã nguồn.', 'Auto-update only works in the installed build (Setup), not from source.')
    if (updateState === 'checking') return vn(lang, 'Đang kiểm tra bản mới…', 'Checking for updates…')
    if (updateState === 'available') return vn(lang, `Có bản mới v${upd.version} — đang tải…`, `v${upd.version} available — downloading…`)
    if (updateState === 'downloading') return vn(lang, `Đang tải v${upd.version} · ${Math.round(upd.percent || 0)}%`, `Downloading v${upd.version} · ${Math.round(upd.percent || 0)}%`)
    if (updateState === 'ready') return vn(lang, `Đã tải v${upd.version} — sẽ tự cài khi bạn thoát launcher.`, `v${upd.version} downloaded — installs when you quit the launcher.`)
    if (updateState === 'error') return upd.error || vn(lang, 'Cập nhật lỗi.', 'Update failed.')
    if (updateState === 'current') return vn(lang, 'Bạn đang dùng bản mới nhất.', 'You are on the latest version.')
    return vn(lang, 'Chưa kiểm tra.', 'Not checked yet.')
  }

  useEffect(() => {
    setJavaPath(storage?.javaPath || '')
  }, [storage?.javaPath])

  const loadSettings = useCallback(async () => {
    if (!window.electronAPI?.getSettings) return
    const s = await window.electronAPI.getSettings().catch(() => null)
    if (s) {
      setRichPresence(s.discordRpc !== false)
    }
  }, [])

  const loadDiscord = useCallback(async () => {
    try {
      setDiscord(await api.discordState())
    } catch {}
  }, [])

  useEffect(() => {
    loadSettings()
    loadDiscord()
    const timer = setInterval(loadDiscord, 5000)
    return () => clearInterval(timer)
  }, [loadSettings, loadDiscord])

  const toggleRichPresence = async (next) => {
    setRichPresence(next)
    await onSave({ discordRpc: next })
    setDiscord((d) => ({ ...d, enabled: next }))
    setTimeout(loadDiscord, 400)
  }

  const loadRuntimes = useCallback(async (force) => {
    setLoading(true)
    try {
      const res = await api.listJavaRuntimes({ force: !!force })
      setRuntimes(res?.items || [])
      setPlatform(res?.platform || '')
      setError(res?.ok === false ? (res.error || 'error') : '')
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadRuntimes(false)
  }, [loadRuntimes])

  const save = async () => {
    setError('')
    try {
      await onSave({ javaPath: javaPath.trim() })
      setSaved(true)
      setTimeout(() => setSaved(false), 1800)
    } catch (err) {
      setError(err.message)
    }
  }

  const pickJava = async () => {
    try {
      const res = await api.chooseJava()
      if (res?.ok) setJavaPath(res.path)
    } catch (err) {
      setError(err.message)
    }
  }

  const installRuntime = async (component) => {
    setBusy(component)
    setError('')
    try {
      const res = await api.installJavaRuntime({ component })
      if (!res?.ok) setError(res?.error || 'error')
      await loadRuntimes(true)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy('')
    }
  }

  const removeRuntime = async (component) => {
    setBusy(component)
    setError('')
    try {
      const res = await api.removeJavaRuntime({ component })
      if (!res?.ok) setError(res?.error || 'error')
      setConfirming('')
      await loadRuntimes(true)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy('')
    }
  }

  const installed = runtimes.filter((r) => r.installed)
  const installedBytes = installed.reduce((sum, r) => sum + (r.bytes || 0), 0)
  const disk = system?.disk || { total: 0, free: 0 }
  const ramUsed = system ? system.totalMem - system.freeMem : 0
  const byMajor = runtimes.reduce((acc, r) => {
    acc[r.major] = acc[r.major] || r
    return acc
  }, {})

  return (
    <div data-surface className="h-full overflow-y-auto" style={{ background: c.bg }}>
      <PageHeader
        theme={theme}
        title={t(lang, 'settings.title')}
        subtitle={vn(lang, 'Cấu hình launcher và thông tin máy', 'Launcher configuration and machine info')}
      >
        <button
          onClick={save}
          className="h-9 px-3.5 rounded-lg text-xs font-bold flex items-center gap-2 transition-all active:scale-95"
          style={{ background: saved ? 'rgba(34,197,94,0.18)' : c.accent, color: saved ? '#22c55e' : '#0a0a0a' }}
        >
          {saved ? <CheckCircle size={14} weight="fill" /> : <FloppyDisk size={14} weight="duotone" />}
          {saved ? t(lang, 'settings.saved') : t(lang, 'settings.save')}
        </button>
      </PageHeader>

      <div className="p-6">
        <div className="max-w-3xl mx-auto flex flex-col gap-6">
          {error && (
            <div className="flex items-start gap-2 rounded-lg px-3 py-2" style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.28)' }}>
              <WarningCircle size={13} weight="duotone" className="shrink-0 mt-0.5" style={{ color: '#f87171' }} />
              <span className="text-[10px] leading-relaxed" style={{ color: '#f87171' }}>{error}</span>
            </div>
          )}

          <Section c={c} title={vn(lang, 'Giao diện', 'Appearance')} hint={vn(lang, 'áp dụng ngay', 'applies instantly')}>
            <Card c={c}>
              <div style={{ marginTop: -1 }}>
                <Row c={c} icon={<Translate size={15} weight="duotone" />} title={t(lang, 'settings.language')}>
                  <Segmented
                    c={c}
                    value={lang}
                    onChange={setLang}
                    options={[{ value: 'vi', label: 'Tiếng Việt' }, { value: 'en', label: 'English' }]}
                  />
                </Row>
                <Row
                  c={c}
                  icon={theme === 'light' ? <Sun size={15} weight="duotone" /> : <MoonStars size={15} weight="duotone" />}
                  title={t(lang, 'settings.theme')}
                  desc={
                    skin === 'pixel'
                      ? vn(lang, 'Pixel dùng nền giấy + mực đậm để nổi khối', 'Pixel uses paper + heavy ink for contrast')
                      : undefined
                  }
                >
                  <Segmented
                    c={c}
                    value={theme}
                    onChange={setTheme}
                    options={[
                      { value: 'dark', label: t(lang, 'settings.theme.dark') },
                      { value: 'light', label: t(lang, 'settings.theme.light') },
                    ]}
                  />
                </Row>
                <Row
                  c={c}
                  icon={<SquaresFour size={15} weight="duotone" />}
                  title={t(lang, 'settings.skin')}
                  desc={
                    skin === 'pixel'
                      ? vn(lang, '8-bit: viền đậm 2px, bóng cứng, chữ pixel', '8-bit: 2px heavy borders, hard shadows, pixel type')
                      : vn(lang, 'Giao diện phẳng, bo góc như hiện tại', 'Flat rounded interface, as now')
                  }
                >
                  <Segmented
                    c={c}
                    value={skin}
                    onChange={setSkin}
                    options={[
                      { value: 'default', label: t(lang, 'settings.skin.default') },
                      { value: 'pixel', label: t(lang, 'settings.skin.pixel') },
                    ]}
                  />
                </Row>
              </div>
            </Card>
          </Section>

          <Section c={c} title="Discord" hint={richPresence ? (discord.connected ? vn(lang, 'đã kết nối', 'connected') : vn(lang, 'chờ Discord', 'waiting for Discord')) : vn(lang, 'đang tắt', 'disabled')}>
            <Card c={c}>
              <div style={{ marginTop: -1 }}>
                <Row
                  c={c}
                  icon={<DiscordLogo size={15} weight="duotone" />}
                  title={vn(lang, 'Rich Presence', 'Rich Presence')}
                  desc={
                    richPresence
                      ? discord.connected
                        ? vn(lang, `Bạn bè thấy hoạt động của bạn${discord.user ? ` (${discord.user})` : ''}`, `Friends can see your activity${discord.user ? ` (${discord.user})` : ''}`)
                        : vn(lang, 'Chưa mở Discord — launcher sẽ tự kết nối khi Discord chạy', 'Discord is closed — the launcher connects automatically once it runs')
                      : vn(lang, 'Đang tắt — bật để hiện hoạt động cho bạn bè', 'Off — enable to show your activity to friends')
                  }
                >
                  <Switch c={c} checked={richPresence} onChange={toggleRichPresence} />
                </Row>
                <Row
                  c={c}
                  icon={<DiscordLogo size={15} weight="duotone" />}
                  title={vn(lang, 'Cộng đồng LunarSpace', 'LunarSpace community')}
                  desc={discord.invite || vn(lang, 'Tham gia server Discord để nhận hỗ trợ và bản cập nhật', 'Join the Discord server for support and updates')}
                >
                  <button
                    onClick={() => api.openExternal(discord.invite).catch(() => {})}
                    disabled={!/^https?:\/\//i.test(String(discord.invite || ''))}
                    className="h-8 px-3 rounded-lg text-[11px] font-semibold flex items-center gap-1.5 disabled:opacity-50"
                    style={{ background: c.accent, color: '#0a0a0a' }}
                  >
                    <DiscordLogo size={13} weight="bold" />
                    {vn(lang, 'Tham gia Discord', 'Join Discord')}
                  </button>
                </Row>
                <Row
                  c={c}
                  icon={<DiscordLogo size={15} weight="duotone" />}
                  title={vn(lang, 'Đang hiển thị', 'Currently showing')}
                  desc={vn(lang, 'Tên phiên bản, Minecraft + trình tải, thời gian đã chơi', 'Instance name, Minecraft + loader, elapsed play time')}
                >
                  <span className="text-[10px] font-mono max-w-[220px] truncate text-right" style={{ color: c.label }}>
                    {richPresence && discord.activity
                      ? [discord.activity.details, discord.activity.state].filter(Boolean).join(' · ')
                      : vn(lang, 'chưa có hoạt động', 'no activity yet')}
                  </span>
                </Row>
              </div>
            </Card>
          </Section>

          <Section
            c={c}
            title={vn(lang, 'Java', 'Java')}
            hint={installed.length ? `${installed.length} ${vn(lang, 'bản', 'runtimes')} · ${formatBytes(installedBytes)}` : vn(lang, 'chưa tải bản nào', 'none installed')}
            action={(
              <button
                onClick={() => loadRuntimes(true)}
                data-tip={vn(lang, 'Làm mới', 'Refresh')}
                className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0"
                style={{ background: c.input, border: `1px solid ${c.border}`, color: c.label }}
              >
                <ArrowsClockwise size={13} className={loading ? 'animate-spin' : ''} />
              </button>
            )}
          >
            <Card c={c}>
              {loading && !runtimes.length ? (
                <div className="p-4 flex flex-col gap-2.5">
                  {[0, 1, 2, 3].map((i) => <Skeleton key={i} c={c} w={`${82 - i * 9}%`} />)}
                </div>
              ) : runtimes.length === 0 ? (
                <p className="px-4 py-6 text-[11px]" style={{ color: c.label }}>
                  {vn(lang, 'Không có bản Java nào cho nền tảng này.', 'No Java runtime for this platform.')}
                </p>
              ) : (
                runtimes.map((rt, i) => {
                  const isBusy = busy === rt.component
                  const first = byMajor[rt.major] === rt
                  return (
                    <div
                      key={rt.component}
                      className="flex items-center gap-3 px-4 h-12"
                      style={{ borderTop: i === 0 ? 'none' : `1px solid ${c.border}`, opacity: first ? 1 : 0.72 }}
                    >
                      <Coffee size={15} weight="duotone" style={{ color: rt.installed ? '#22c55e' : c.faint }} />
                      <div className="min-w-0 flex-1">
                        <p className="text-[11px] font-semibold truncate" style={{ color: c.text }}>
                          Java {rt.major}
                          <span className="ml-2 font-mono text-[10px] tabular-nums" style={{ color: c.faint }}>{rt.name}</span>
                          {JAVA_TARGETS[rt.component] && (
                            <span className="ml-2 px-1.5 py-0.5 rounded text-[9px] font-bold" style={{ background: c.input, color: c.label }}>
                              {JAVA_TARGETS[rt.component]}
                            </span>
                          )}
                        </p>
                        <p className="text-[10px] font-mono truncate" style={{ color: c.faint }}>
                          {rt.installed
                            ? `${formatBytes(rt.bytes)}${rt.installedAt ? ` · ${formatDate(rt.installedAt, lang)}` : ''} · ${rt.component}`
                            : `${rt.component}${rt.released ? ` · ${formatDate(rt.released, lang)}` : ''}`}
                        </p>
                      </div>
                      {isBusy ? (
                        <span className="flex items-center gap-1.5 text-[10px] shrink-0" style={{ color: c.accent }}>
                          <SpinnerGap size={12} className="animate-spin" />
                          {vn(lang, 'đang tải…', 'downloading…')}
                        </span>
                      ) : rt.installed ? (
                        <span className="text-[10px] font-bold shrink-0" style={{ color: '#22c55e' }}>
                          {vn(lang, 'đã có', 'installed')}
                        </span>
                      ) : (
                        <span className="text-[10px] shrink-0" style={{ color: c.faint }}>
                          {vn(lang, 'chưa tải', 'not installed')}
                        </span>
                      )}
                      {confirming === rt.component ? (
                        <div className="flex items-center gap-1.5 shrink-0">
                          <button onClick={() => setConfirming('')} className="h-7 px-2 rounded-md text-[10px] font-semibold" style={smallBtn(c)}>
                            {vn(lang, 'Huỷ', 'Cancel')}
                          </button>
                          <button
                            onClick={() => removeRuntime(rt.component)}
                            className="h-7 px-2 rounded-md text-[10px] font-bold"
                            style={{ background: '#ef4444', color: '#fff' }}
                          >
                            {vn(lang, 'Xoá', 'Delete')}
                          </button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1.5 shrink-0">
                          {!rt.installed && (
                            <button
                              disabled={!!busy}
                              onClick={() => installRuntime(rt.component)}
                              className="h-7 px-2.5 rounded-lg text-[10px] font-bold flex items-center gap-1 disabled:opacity-50"
                              style={{ background: c.accent, color: '#0a0a0a' }}
                            >
                              <DownloadSimple size={12} weight="bold" />
                              {vn(lang, 'Tải', 'Get')}
                            </button>
                          )}
                          {rt.installed && (
                            <button
                              disabled={!!busy}
                              onClick={() => setConfirming(rt.component)}
                              data-tip={vn(lang, 'Xoá Java này', 'Delete this runtime')}
                              className="w-7 h-7 rounded-lg flex items-center justify-center disabled:opacity-50"
                              style={{ color: '#ef4444' }}
                            >
                              <Trash size={13} />
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })
              )}
            </Card>

            <Card c={c}>
              <div style={{ marginTop: -1 }}>
                <Row
                  c={c}
                  icon={<HardDrive size={15} weight="duotone" />}
                  title={vn(lang, 'Ghi đè Java (nâng cao)', 'Java override (advanced)')}
                  desc={javaPath || vn(lang, 'Để trống = dùng Java tải kèm ở trên', 'Empty = use the bundled runtime above')}
                >
                  <input
                    value={javaPath}
                    onChange={(e) => setJavaPath(e.target.value)}
                    placeholder={t(lang, 'settings.java.placeholder')}
                    className="w-52 h-8 px-3 rounded-lg text-[11px] outline-none"
                    style={{ background: c.input, border: `1px solid ${c.border}`, color: c.text }}
                  />
                  <button onClick={pickJava} className="h-8 px-3 rounded-lg text-[11px] font-semibold" style={smallBtn(c)}>
                    {vn(lang, 'Chọn', 'Browse')}
                  </button>
                </Row>
              </div>
            </Card>
          </Section>

          <Section
            c={c}
            title={vn(lang, 'Cập nhật', 'Updates')}
            hint={updateState === 'ready' ? vn(lang, 'sẵn sàng', 'ready') : version ? `v${version}` : undefined}
          >
            <Card c={c}>
              <div style={{ marginTop: -1 }}>
                <Row
                  c={c}
                  icon={<ArrowsClockwise size={15} weight="duotone" />}
                  title={t(lang, 'settings.autoUpdate')}
                  desc={t(lang, 'settings.autoUpdateHint')}
                >
                  <Switch c={c} checked={upd.enabled !== false} onChange={toggleAutoUpdate} />
                </Row>
                <Row
                  c={c}
                  icon={<DownloadSimple size={15} weight="duotone" />}
                  title={vn(lang, 'Phiên bản launcher', 'Launcher version')}
                  desc={updateStatusText()}
                >
                  {updateState === 'ready' ? (
                    <button
                      onClick={runUpdateInstall}
                      className="h-8 px-3 rounded-lg text-[11px] font-bold flex items-center gap-1.5"
                      style={{ background: c.accent, color: '#0a0a0a' }}
                    >
                      {vn(lang, 'Cài & khởi động lại', 'Install & restart')}
                    </button>
                  ) : (
                    <button
                      onClick={runUpdateCheck}
                      disabled={updateBusy || updateState === 'unsupported'}
                      className="h-8 px-3 rounded-lg text-[11px] font-semibold flex items-center gap-1.5 disabled:opacity-50"
                      style={{ background: c.input, border: `1px solid ${c.border}`, color: c.label }}
                    >
                      <ArrowsClockwise size={12} weight="bold" className={updateBusy ? 'animate-spin' : ''} />
                      {vn(lang, 'Kiểm tra', 'Check')}
                    </button>
                  )}
                </Row>
              </div>
            </Card>
          </Section>

          <Section c={c} title={vn(lang, 'Máy tính', 'Machine')} hint={platform || undefined}>
            <div className="grid grid-cols-2 gap-3">
              <Card c={c} className="p-4 flex flex-col gap-3.5">
                {system ? (
                  <>
                    <Meter c={c} label={t(lang, 'home.ram')} used={ramUsed} total={system.totalMem} color={c.accent} />
                    <Meter c={c} label={t(lang, 'home.disk')} used={disk.total - disk.free} total={disk.total} color="#22c55e" />
                  </>
                ) : (
                  <div className="flex flex-col gap-3">
                    {[0, 1].map((i) => <Skeleton key={i} c={c} w={`${88 - i * 12}%`} />)}
                  </div>
                )}
              </Card>

              <Card c={c} className="p-4 flex flex-col gap-2.5">
                {system ? (
                  <>
                    <Fact c={c} label={t(lang, 'home.cpu')} value={`${system.cpuThreads} ${t(lang, 'home.cores')}`} />
                    <Fact c={c} label={vn(lang, 'Nền tảng', 'Platform')} value={`${system.platform} ${system.arch}`} />
                    <Fact c={c} label={vn(lang, 'Dung lượng RAM', 'Total RAM')} value={formatBytes(system.totalMem)} />
                    <Fact c={c} label={vn(lang, 'Ổ đĩa trống', 'Free disk')} value={formatBytes(disk.free)} />
                    <Fact c={c} label={vn(lang, 'Tài nguyên đã tải', 'Downloaded assets')} value={formatBytes(system.cacheBytes || 0)} />
                    <Fact c={c} label={vn(lang, 'Java tải kèm', 'Bundled Java')} value={`${installed.length} ${vn(lang, 'bản', 'runtimes')} · ${formatBytes(installedBytes)}`} />
                  </>
                ) : (
                  <div className="flex flex-col gap-2.5">
                    {[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} c={c} w={`${80 - i * 7}%`} />)}
                  </div>
                )}
              </Card>
            </div>
          </Section>

          <Section c={c} title={vn(lang, 'Về LunarSpace', 'About LunarSpace')} hint={version ? `v${version}` : undefined}>
            <Card c={c} className="p-4 flex flex-col gap-2.5">
              <Fact c={c} label={vn(lang, 'Phiên bản launcher', 'Launcher version')} value={version ? `v${version}` : '—'} />
              <Fact c={c} label={vn(lang, 'Nền tảng', 'Platform')} value={system ? `${system.platform} ${system.arch}` : '—'} />
              <Fact c={c} label={vn(lang, 'Nhà phát triển', 'Made by')} value="LunarSpace" mono={false} />
              <p className="pt-2 text-[10px] leading-relaxed" style={{ color: c.faint, borderTop: `1px solid ${c.border}` }}>
                {vn(
                  lang,
                  'Java được tải tự động theo phiên bản game và dùng chung cho mọi phiên bản cùng nhóm. Vào tab Phiên bản để tạo phiên bản mới.',
                  'Java is downloaded automatically per game version and shared across versions. Open the Versions tab to create a new instance.',
                )}
              </p>
            </Card>
          </Section>
        </div>
      </div>
    </div>
  )
}
