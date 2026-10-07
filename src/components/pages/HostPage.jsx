import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Cloud, ArrowsClockwise, Copy, Check, DownloadSimple, LinkSimple,
  WarningCircle, Plugs, Key, Terminal, Desktop, CaretDown, ArrowSquareOut,
} from '@phosphor-icons/react'
import { palette } from '../../lib/palette'
import PageHeader from '../ui/PageHeader'
import Select from '../ui/Select'
import ProgressBar from '../ui/ProgressBar'
import * as api from '../../api/client.js'

const vn = (lang, vi, en) => (lang === 'vi' ? vi : en)
const TOKEN_URL = 'https://dashboard.ngrok.com/get-started/your-authtoken'

const TONE = {
  idle: { color: '#71717a', bg: 'rgba(113,113,122,0.12)' },
  ready: { color: '#a78bfa', bg: 'rgba(167,139,250,0.14)' },
  live: { color: '#22c55e', bg: 'rgba(34,197,94,0.14)' },
  warn: { color: '#fbbf24', bg: 'rgba(251,191,36,0.12)' },
  bad: { color: '#f87171', bg: 'rgba(239,68,68,0.12)' },
}

function Eyebrow({ c, children }) {
  return (
    <span className="text-[9px] font-bold uppercase tracking-[0.16em]" style={{ color: c.faint }}>
      {children}
    </span>
  )
}

function RouteNode({ c, label, value, sub, tone, title }) {
  const t = TONE[tone]
  return (
    <div className="flex flex-col gap-1 min-w-0">
      <span className="flex items-center gap-1.5">
        <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: t.color }} />
        <span className="text-[9px] font-bold uppercase tracking-[0.14em]" style={{ color: c.faint }}>
          {label}
        </span>
      </span>
      <span className="text-[13px] font-bold font-mono truncate" style={{ color: value ? t.color : c.faint }} title={title}>
        {value || '—'}
      </span>
      <span className="text-[9px] truncate" style={{ color: c.faint }}>{sub}</span>
    </div>
  )
}

function Hop({ c, tone }) {
  const t = TONE[tone]
  return (
    <div className="flex items-center shrink-0 px-2.5" aria-hidden="true">
      <span className="h-px flex-1" style={{ background: tone === 'live' || tone === 'ready' ? t.color : c.border, opacity: tone === 'idle' ? 1 : 0.6 }} />
      <span className="w-1 h-1 rotate-45 shrink-0 mx-0.5" style={{ background: tone === 'live' || tone === 'ready' ? t.color : c.border }} />
      <span className="h-px flex-1" style={{ background: tone === 'live' || tone === 'ready' ? t.color : c.border, opacity: tone === 'idle' ? 1 : 0.6 }} />
    </div>
  )
}

export default function HostPage({ theme, lang, instances = [], onNavigate }) {
  const c = palette(theme)
  const [status, setStatus] = useState(null)
  const [loading, setLoading] = useState(true)
  const [picked, setPicked] = useState('')
  const [token, setToken] = useState('')
  const [showToken, setShowToken] = useState(false)
  const [listenPort, setListenPort] = useState(25565)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)
  const [install, setInstall] = useState(null)
  const [logOpen, setLogOpen] = useState(false)

  const running = (instances || []).filter((i) => i.status === 'running')
  const activeId = picked || running[0]?.id || instances[0]?.id || ''
  const activeInstance = instances.find((i) => i.id === activeId) || null

  const load = useCallback(async () => {
    setLoading(true)
    const res = await api.hostStatus({ instanceId: activeId || undefined }).catch((err) => ({ ok: false, error: err.message }))
    setStatus(res?.ok ? res : null)
    if (res?.ok) setError('')
    else if (res?.error) setError(res.error)
    setLoading(false)
  }, [activeId])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    const off = api.onLauncherEvent?.((ev) => {
      if (ev?.type === 'host-progress') setInstall({ done: ev.done, total: ev.total, file: ev.file })
      if (ev?.type === 'host') {
        setBusy('')
        if (ev.state === 'started') setInstall(null)
        if (ev.state === 'stopped' && ev.exit?.code) setError(vn(lang, 'Đường truyền tự dừng — xem log bên dưới.', 'The tunnel stopped on its own — see the log below.'))
        load()
      }
    })
    return () => off?.()
  }, [lang, load])

  const detected = status?.detected || null
  const tunnel = status?.tunnel || null
  const agent = status?.agent || null
  const address = tunnel?.address || ''
  const live = !!tunnel?.running
  const hasAgent = !!agent?.installed
  const hasToken = !!status?.hasToken
  const connections = tunnel?.relay?.connections || 0

  const missing = []
  if (!detected?.port) missing.push(vn(lang, 'world chưa mở cho LAN', 'world not opened to LAN'))
  if (!hasAgent) missing.push(vn(lang, 'chưa có agent ngrok', 'ngrok agent missing'))
  if (!hasToken) missing.push(vn(lang, 'chưa có authtoken', 'authtoken missing'))
  const canStart = missing.length === 0 && !live

  const instanceOptions = useMemo(
    () => (instances || []).map((i) => ({
      value: i.id,
      label: i.name,
      hint: `${i.version}${i.loader && i.loader !== 'vanilla' ? ` · ${i.loader}` : ''}`,
      icon: i.icon || undefined,
    })),
    [instances],
  )

  const copyAddress = useCallback(async () => {
    if (!address) return
    try {
      await navigator.clipboard.writeText(address)
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    } catch {
      setError(vn(lang, 'Không copy được — hãy copy tay.', 'Copy failed — copy it manually.'))
    }
  }, [address, lang])

  const installAgent = useCallback(async () => {
    setError('')
    setBusy('agent')
    setInstall({ done: 0, total: 0 })
    const res = await api.hostInstallAgent().catch((err) => ({ ok: false, error: err.message }))
    setBusy('')
    setInstall(null)
    if (!res?.ok) return setError(res?.error || 'error')
    load()
  }, [load])

  const saveToken = useCallback(async () => {
    setError('')
    setBusy('token')
    const res = await api.hostSetToken({ token }).catch((err) => ({ ok: false, error: err.message }))
    setBusy('')
    if (!res?.ok) return setError(res?.error || 'error')
    setToken('')
    setShowToken(false)
    load()
  }, [token, load])

  const start = useCallback(async () => {
    setError('')
    setBusy('start')
    setLogOpen(true)
    const res = await api.hostStart({ instanceId: activeId, listenPort, targetPort: detected?.port }).catch((err) => ({ ok: false, error: err.message }))
    setBusy('')
    if (!res?.ok) {
      setError(res?.error || 'error')
      return
    }
    load()
  }, [activeId, listenPort, detected?.port, load])

  const stop = useCallback(async () => {
    setBusy('stop')
    await api.hostStop().catch(() => {})
    setBusy('')
    setLogOpen(true)
    load()
  }, [load])

  const worldTone = detected?.port ? 'ready' : 'warn'
  const relayTone = live ? 'live' : detected?.port ? 'ready' : 'idle'
  const agentTone = live ? 'live' : hasAgent && hasToken ? 'ready' : hasAgent || hasToken ? 'warn' : 'idle'
  const addressTone = address ? 'live' : 'idle'
  const log = tunnel?.log || []

  return (
    <div data-surface className="h-full flex flex-col overflow-hidden" style={{ background: c.bg }}>
      <PageHeader
        theme={theme}
        title="Host"
        subtitle={vn(lang, 'Chia sẻ world cho bạn bè qua internet', 'Share your world over the internet')}
      >
        <span
          className="h-9 px-2.5 rounded-lg text-[10px] font-semibold flex items-center gap-1.5"
          style={{
            background: live ? TONE.live.bg : c.input,
            border: `1px solid ${live ? 'rgba(34,197,94,0.32)' : c.border}`,
            color: live ? TONE.live.color : c.label,
          }}
        >
          <span className="w-1.5 h-1.5 rounded-full" style={{ background: live ? TONE.live.color : c.faint }} />
          {live
            ? `${vn(lang, 'đang mở', 'live')}${connections ? ` · ${connections}` : ''}`
            : vn(lang, 'chưa mở', 'offline')}
        </span>
        <button
          onClick={load}
          data-tip={vn(lang, 'Đọc lại log game', 'Re-read the game log')}
          className="w-9 h-9 rounded-lg flex items-center justify-center transition-all hover:opacity-80 active:scale-95"
          style={{ background: c.input, border: `1px solid ${c.border}`, color: c.label }}
        >
          <ArrowsClockwise size={15} className={loading ? 'animate-spin' : ''} />
        </button>
      </PageHeader>

      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="max-w-4xl mx-auto p-6 flex flex-col gap-4">

          <section className="rounded-xl px-4 py-3.5 flex items-start gap-1" style={{ background: c.surface, border: `1px solid ${c.border}` }}>
            <div className="flex-1 min-w-0">
              <RouteNode
                c={c}
                label={vn(lang, 'World', 'World')}
                value={detected?.port ? `:${detected.port}` : ''}
                sub={detected?.port
                  ? `${detected.dedicated ? vn(lang, 'server riêng', 'dedicated') : vn(lang, 'mở LAN', 'LAN')}${detected.at ? ` · ${detected.at}` : ''}`
                  : vn(lang, 'chưa mở cho LAN', 'not opened to LAN')}
                tone={worldTone}
                title={detected?.line || ''}
              />
            </div>
            <Hop c={c} tone={detected?.port ? (live ? 'live' : 'ready') : 'idle'} />
            <div className="flex-1 min-w-0">
              <RouteNode
                c={c}
                label={vn(lang, 'Cầu nối', 'Relay')}
                value={`:${listenPort}`}
                sub={live ? vn(lang, 'đang chuyển tiếp', 'forwarding') : vn(lang, 'cổng cố định', 'fixed port')}
                tone={relayTone}
                title={vn(lang, 'Cổng cầu nối không đổi dù game dùng cổng nào', 'The relay port never changes, whatever port the game picks')}
              />
            </div>
            <Hop c={c} tone={relayTone === 'idle' ? 'idle' : 'ready'} />
            <div className="flex-1 min-w-0">
              <RouteNode
                c={c}
                label="ngrok"
                value={live ? vn(lang, 'đang chạy', 'running') : hasAgent && hasToken ? vn(lang, 'sẵn sàng', 'ready') : ''}
                sub={hasAgent ? (agent.version || vn(lang, 'đã tải', 'installed')) : vn(lang, 'chưa tải agent', 'agent missing')}
                tone={agentTone}
              />
            </div>
            <Hop c={c} tone={address ? 'live' : 'idle'} />
            <div className="flex-1 min-w-0">
              <RouteNode
                c={c}
                label={vn(lang, 'Địa chỉ', 'Address')}
                value={address ? vn(lang, 'sẵn sàng', 'ready') : ''}
                sub={address ? address.split(':')[0] : vn(lang, 'chưa có', 'none yet')}
                tone={addressTone}
                title={address}
              />
            </div>
          </section>

          <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_330px] gap-4 items-start">
            <section className="rounded-xl overflow-hidden" style={{ background: c.surface, border: `1px solid ${c.border}` }}>
              <div className="px-4 py-3 flex items-center gap-2" style={{ borderBottom: `1px solid ${c.border}` }}>
                <Desktop size={14} weight="duotone" style={{ color: c.accent }} />
                <p className="text-[12px] font-bold flex-1" style={{ color: c.text }}>
                  {missing.length ? vn(lang, `Còn ${missing.length} bước`, `${missing.length} steps left`) : vn(lang, 'Đã sẵn sàng', 'Ready')}
                </p>
                {!missing.length && <Check size={13} weight="bold" style={{ color: '#22c55e' }} />}
              </div>

              <div className="px-4 py-3 flex flex-col gap-1">
                <div className="flex items-center gap-3 py-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-[11px] font-semibold" style={{ color: c.text }}>
                      {vn(lang, 'World để chia sẻ', 'World to share')}
                    </p>
                    <p className="text-[10px] truncate" style={{ color: detected?.port ? c.faint : '#fbbf24' }}>
                      {detected?.port
                        ? vn(lang, 'đọc cổng từ log game', 'port read from the game log')
                        : vn(lang, 'vào game, mở world rồi bấm “Mở cho LAN”', 'open the world in game and hit “Open to LAN”')}
                    </p>
                  </div>
                  <span className="w-[190px] shrink-0" style={{ opacity: live ? 0.55 : 1, pointerEvents: live ? 'none' : 'auto' }}>
                    <Select
                      theme={theme}
                      value={activeId}
                      onChange={setPicked}
                      options={instanceOptions}
                      placeholder={vn(lang, 'Chọn phiên bản', 'Pick an instance')}
                      disabled={live}
                    />
                  </span>
                </div>

                <div className="flex items-center gap-3 py-2" style={{ borderTop: `1px solid ${c.border}` }}>
                  <div className="flex-1 min-w-0">
                    <p className="text-[11px] font-semibold" style={{ color: c.text }}>Agent ngrok</p>
                    <p className="text-[10px] font-mono truncate" style={{ color: hasAgent ? c.faint : c.text }}>
                      {hasAgent ? agent.version || vn(lang, 'đã tải', 'installed') : vn(lang, 'chưa tải · ~32 MB', 'not installed · ~32 MB')}
                    </p>
                  </div>
                  {hasAgent ? (
                    <Check size={14} weight="bold" className="shrink-0" style={{ color: '#22c55e' }} />
                  ) : (
                    <button
                      onClick={installAgent}
                      disabled={busy === 'agent'}
                      className="h-8 px-3 rounded-lg text-[11px] font-bold flex items-center gap-1.5 shrink-0 disabled:opacity-60"
                      style={{ background: c.accent, color: '#0a0a0a' }}
                    >
                      {busy === 'agent' ? <ArrowsClockwise size={12} className="animate-spin" /> : <DownloadSimple size={13} weight="bold" />}
                      {vn(lang, 'Tải agent', 'Download')}
                    </button>
                  )}
                </div>

                <div className="flex flex-col gap-2 py-2" style={{ borderTop: `1px solid ${c.border}` }}>
                  <div className="flex items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-[11px] font-semibold" style={{ color: c.text }}>Authtoken ngrok</p>
                      <p className="text-[10px] truncate" style={{ color: c.faint }}>
                        {hasToken
                          ? vn(lang, 'đã lưu, mã hoá bằng Windows', 'saved, encrypted with Windows')
                          : vn(lang, 'dán token từ dashboard', 'paste the token from your dashboard')}
                      </p>
                    </div>
                    {hasToken && !showToken ? (
                      <button
                        onClick={() => setShowToken(true)}
                        className="h-8 px-2.5 rounded-lg text-[10px] font-semibold shrink-0"
                        style={{ background: c.input, border: `1px solid ${c.border}`, color: c.label }}
                      >
                        {vn(lang, 'Đổi token', 'Replace')}
                      </button>
                    ) : (
                      <button
                        onClick={() => api.openExternal(TOKEN_URL).catch(() => {})}
                        className="h-8 px-2.5 rounded-lg text-[10px] font-semibold flex items-center gap-1.5 shrink-0"
                        style={{ background: c.input, border: `1px solid ${c.border}`, color: c.label }}
                      >
                        <Key size={12} weight="duotone" />
                        {vn(lang, 'Lấy token', 'Get token')}
                        <ArrowSquareOut size={10} />
                      </button>
                    )}
                  </div>
                  {(!hasToken || showToken) && (
                    <span className="flex items-center gap-2">
                      <input
                        value={token}
                        onChange={(e) => setToken(e.target.value)}
                        placeholder="2abc…"
                        type="password"
                        className="flex-1 min-w-0 h-8 px-2.5 rounded-lg text-[10px] font-mono outline-none"
                        style={{ background: c.input, border: `1px solid ${c.border}`, color: c.text }}
                      />
                      <button
                        onClick={saveToken}
                        disabled={busy === 'token' || !token.trim()}
                        className="h-8 px-3 rounded-lg text-[11px] font-bold shrink-0 disabled:opacity-50"
                        style={{ background: c.accent, color: '#0a0a0a' }}
                      >
                        {vn(lang, 'Lưu', 'Save')}
                      </button>
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-3 py-2" style={{ borderTop: `1px solid ${c.border}` }}>
                  <div className="flex-1 min-w-0">
                    <p className="text-[11px] font-semibold" style={{ color: c.text }}>
                      {vn(lang, 'Cổng cầu nối', 'Relay port')}
                    </p>
                    <p className="text-[10px]" style={{ color: c.faint }}>
                      {vn(lang, 'cố định, không phải sửa khi game đổi cổng', 'fixed, so the game can change ports freely')}
                    </p>
                  </div>
                  <input
                    type="number"
                    min={1024}
                    max={65535}
                    value={listenPort}
                    onChange={(e) => setListenPort(Number(e.target.value) || 25565)}
                    disabled={live}
                    className="w-[86px] h-8 px-2.5 rounded-lg text-[11px] font-mono text-right outline-none disabled:opacity-60 shrink-0"
                    style={{ background: c.input, border: `1px solid ${c.border}`, color: c.text }}
                  />
                </div>

                {install && busy === 'agent' && (
                  <div className="pb-2">
                    <ProgressBar theme={theme} lang={lang} progress={{ label: 'agent', phase: 'download', ...install }} />
                  </div>
                )}
              </div>
            </section>

            <section
              className="rounded-xl p-4 flex flex-col gap-3"
              style={{
                background: address ? TONE.live.bg : c.surface,
                border: `1px solid ${address ? 'rgba(34,197,94,0.34)' : c.border}`,
              }}
            >
              <div className="flex items-center gap-2">
                <LinkSimple size={14} weight="duotone" style={{ color: address ? TONE.live.color : c.accent }} />
                <Eyebrow c={c}>{vn(lang, 'Địa chỉ chia sẻ', 'Share address')}</Eyebrow>
                {live && (
                  <span className="ml-auto flex items-center gap-1.5 text-[9px] font-bold uppercase" style={{ color: TONE.live.color }}>
                    <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: TONE.live.color }} />
                    live
                  </span>
                )}
              </div>

              {address ? (
                <>
                  <button
                    onClick={copyAddress}
                    title={vn(lang, 'Bấm để copy', 'Click to copy')}
                    className="group flex items-center gap-2 text-left min-w-0"
                  >
                    <span className="min-w-0 flex-1 text-[19px] leading-tight font-mono font-bold break-all" style={{ color: c.text }}>
                      {address}
                    </span>
                    <span
                      className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 transition-transform group-active:scale-95"
                      style={{ background: copied ? '#22c55e' : c.input, border: `1px solid ${copied ? '#22c55e' : c.border}`, color: copied ? '#0a0a0a' : c.label }}
                    >
                      {copied ? <Check size={14} weight="bold" /> : <Copy size={14} weight="bold" />}
                    </span>
                  </button>
                  <p className="text-[10px] leading-relaxed" style={{ color: c.label }}>
                    {vn(lang, 'Bạn bè: Minecraft → Multiplayer → Add Server → dán địa chỉ trên.', 'Friends: Minecraft → Multiplayer → Add Server → paste the address.')}
                    {` ${vn(lang, 'Cần cùng phiên bản', 'Same version required')}${activeInstance ? ` (${activeInstance.version}${activeInstance.loader && activeInstance.loader !== 'vanilla' ? ` · ${activeInstance.loader}` : ''})` : ''}.`}
                  </p>
                  <div className="flex items-center gap-3 text-[10px] font-mono" style={{ color: c.label }}>
                    <span>{connections} {vn(lang, 'kết nối đang mở', 'open connections')}</span>
                    <button onClick={stop} disabled={busy === 'stop'} className="ml-auto text-[10px] font-bold disabled:opacity-60" style={{ color: TONE.bad.color }}>
                      {vn(lang, 'Tắt đường truyền', 'Stop tunnel')}
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <p className="text-[12px] font-semibold" style={{ color: c.text }}>
                    {vn(lang, 'Chưa có địa chỉ để chia sẻ', 'No address to share yet')}
                  </p>
                  <p className="text-[10px] leading-relaxed" style={{ color: c.label }}>
                    {missing.length
                      ? `${vn(lang, 'Còn thiếu', 'Still missing')}: ${missing.join(', ')}.`
                      : vn(lang, 'Bật đường truyền để lấy địa chỉ gửi bạn bè.', 'Start the tunnel to get an address for your friends.')}
                  </p>
                  <button
                    onClick={start}
                    disabled={!canStart || busy === 'start'}
                    className="h-9 rounded-lg text-[11px] font-bold flex items-center justify-center gap-2 disabled:opacity-50"
                    style={{ background: c.accent, color: '#0a0a0a' }}
                  >
                    {busy === 'start' ? <ArrowsClockwise size={13} className="animate-spin" /> : <Plugs size={13} weight="bold" />}
                    {vn(lang, 'Bật đường truyền', 'Start tunnel')}
                  </button>
                </>
              )}

              <p className="text-[9px] leading-relaxed pt-1" style={{ color: c.faint, borderTop: `1px solid ${c.border}` }}>
                {vn(
                  lang,
                  'ngrok free: địa chỉ đổi mỗi lần bật lại (phải gửi lại cho bạn bè) và giới hạn 1GB/tháng.',
                  'ngrok free: the address changes on every restart (resend it) and traffic is capped at 1GB/month.',
                )}
              </p>
            </section>
          </div>

          {error && (
            <div className="flex items-start gap-2 rounded-lg px-3 py-2" style={{ background: TONE.bad.bg, border: `1px solid rgba(239,68,68,0.28)` }}>
              <WarningCircle size={13} weight="duotone" className="shrink-0 mt-0.5" style={{ color: TONE.bad.color }} />
              <span className="text-[10px] leading-relaxed break-words min-w-0" style={{ color: TONE.bad.color }}>{error}</span>
            </div>
          )}

          {log.length > 0 && (
            <section className="rounded-xl overflow-hidden" style={{ background: c.surface, border: `1px solid ${c.border}` }}>
              <button
                onClick={() => setLogOpen((v) => !v)}
                className="w-full px-4 py-2.5 flex items-center gap-2 text-left"
              >
                <Terminal size={13} weight="duotone" style={{ color: c.accent }} />
                <span className="text-[10px] font-bold uppercase tracking-[0.14em] flex-1" style={{ color: c.label }}>
                  {vn(lang, 'Log ngrok', 'ngrok log')}
                </span>
                <span className="text-[10px] font-mono" style={{ color: c.faint }}>{log.length}</span>
                <CaretDown size={12} weight="bold" className="transition-transform" style={{ color: c.faint, transform: logOpen ? 'rotate(180deg)' : 'none' }} />
              </button>
              {logOpen && (
                <div className="px-4 pb-3 flex flex-col gap-1 max-h-[200px] overflow-y-auto" style={{ borderTop: `1px solid ${c.border}` }}>
                  {log.map((line, i) => (
                    <span key={i} className="text-[10px] font-mono break-all pt-1" style={{ color: c.label }}>{line}</span>
                  ))}
                </div>
              )}
            </section>
          )}

          {!log.length && (
            <p className="text-[10px] flex items-center gap-1.5" style={{ color: c.faint }}>
              <Cloud size={12} weight="duotone" />
              {vn(lang, 'Log ngrok sẽ hiện ở đây sau khi bật đường truyền.', 'The ngrok log shows up here once you start the tunnel.')}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
