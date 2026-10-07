import { useState, useEffect, useRef, useCallback, useMemo, memo } from 'react'
import { Memory, Cpu, HardDrive, Lightning, Play, Stop, ArrowsClockwise, Network, Power } from '@phosphor-icons/react'
import { showToast } from '../../lib/toast'

const isElectron = typeof window !== 'undefined' && window.electronAPI

const CHART_WINDOW = 20_000

const SERIES = {
  light: { primary: '#0891b2', secondary: '#d97706', grid: 'rgba(0,0,0,0.09)', tick: '#6b7280' },
  dark: { primary: '#22d3ee', secondary: '#facc15', grid: 'rgba(255,255,255,0.08)', tick: '#9ca3af' },
}

const STATUS_META = {
  running: { color: '#22c55e', labelEn: 'Online', labelVi: 'Trực tuyến' },
  starting: { color: '#eab308', labelEn: 'Starting', labelVi: 'Đang khởi động' },
  stopping: { color: '#eab308', labelEn: 'Stopping', labelVi: 'Đang tắt' },
  installing: { color: '#eab308', labelEn: 'Installing', labelVi: 'Đang cài' },
  stopped: { color: '#ef4444', labelEn: 'Offline', labelVi: 'Ngoại tuyến' },
  offline: { color: '#ef4444', labelEn: 'Offline', labelVi: 'Ngoại tuyến' },
  error: { color: '#ef4444', labelEn: 'Error', labelVi: 'Lỗi' },
}

const ACTION_META = {
  start: { color: '#22c55e', labelEn: 'Server marked as started', labelVi: 'Server đã khởi động', Icon: Play },
  stop: { color: '#ef4444', labelEn: 'Server marked as stopped', labelVi: 'Server đã dừng', Icon: Stop },
  kill: { color: '#dc2626', labelEn: 'Server killed', labelVi: 'Server bị tắt cứng', Icon: Stop },
  restart: { color: '#eab308', labelEn: 'Server restarted', labelVi: 'Server khởi động lại', Icon: ArrowsClockwise },
  install: { color: '#06b6d4', labelEn: 'Server installed', labelVi: 'Server đã cài đặt', Icon: Lightning },
}

function formatBytes(n) {
  if (!n || n <= 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.min(sizes.length - 1, Math.floor(Math.log(n) / Math.log(k)))
  return `${parseFloat((n / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`
}

function formatMB(n) {
  if (!n || n <= 0) return '0 MB'
  if (n >= 1024) return `${Math.round((n / 1024) * 10) / 10} GB`
  return `${Math.round(n)} MB`
}

function formatRate(bytesPerSec) {
  const n = Number(bytesPerSec) || 0
  if (n <= 0) return '0 B/s'
  const k = 1024
  const sizes = ['B/s', 'KB/s', 'MB/s', 'GB/s']
  const i = Math.min(sizes.length - 1, Math.floor(Math.log(n) / Math.log(k)))
  return `${parseFloat((n / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`
}

function formatPercent(v) {
  const n = Number(v) || 0
  return `${Number(n.toFixed(2))}%`
}

function clampPct(n) {
  if (!Number.isFinite(n) || n < 0) return 0
  if (n > 100) return 100
  return Math.round(n * 10) / 10
}

function usageColor(pct) {
  const p = clampPct(pct)
  if (p >= 90) return '#ef4444'
  if (p >= 75) return '#f97316'
  if (p >= 50) return '#eab308'
  return '#22c55e'
}

function niceCeil(value, binary = false) {
  if (!Number.isFinite(value) || value <= 0) return binary ? 1024 : 1
  if (binary) return 2 ** Math.ceil(Math.log2(value))
  const magnitude = 10 ** Math.floor(Math.log10(value))
  return ([1, 2, 4, 5, 10].find((step) => magnitude * step >= value) ?? 10) * magnitude
}

function ema(prev, next, alpha = 0.18) {
  if (prev == null || !Number.isFinite(prev)) return Number(next) || 0
  return prev + ((Number(next) || 0) - prev) * alpha
}

function avgRing(ring, value, max = 6) {
  ring.push(Number(value) || 0)
  if (ring.length > max) ring.shift()
  let sum = 0
  for (const n of ring) sum += n
  return sum / ring.length
}

function fmtDay(ts, lang) {
  const d = new Date(ts)
  const dd = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const yyyy = d.getFullYear()
  return lang === 'vi' ? `${dd}/${mm}/${yyyy}` : `${mm}/${dd}/${yyyy}`
}

function fmtTime(ts) {
  const d = new Date(ts)
  return [d.getHours(), d.getMinutes(), d.getSeconds()].map((n) => String(n).padStart(2, '0')).join(':')
}

function fmtClock(ts) {
  const d = new Date(ts)
  return [d.getHours(), d.getMinutes(), d.getSeconds()].map((n) => String(n).padStart(2, '0')).join(':')
}

function StatusDot({ color }) {
  return (
    <span className="relative flex h-2.5 w-2.5 shrink-0">
      <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75" style={{ background: color }} />
      <span className="relative inline-flex rounded-full h-2.5 w-2.5" style={{ background: color }} />
    </span>
  )
}

const StreamChart = memo(function StreamChart({ samplesRef, seriesColors, seriesIndices, format, binary = false, min = 0, theme, height = 200 }) {
  const wrapRef = useRef(null)
  const canvasRef = useRef(null)
  const yMaxRef = useRef(0)
  const cfgRef = useRef(null)
  const idxMap = seriesIndices || seriesColors.map((_, i) => i)
  cfgRef.current = { samplesRef, seriesColors, idxMap, format, binary, min, theme }

  useEffect(() => {
    const wrap = wrapRef.current
    const canvas = canvasRef.current
    if (!wrap || !canvas) return undefined
    const ctx = canvas.getContext('2d')
    if (!ctx) return undefined
    let raf = 0

    const draw = () => {
      raf = requestAnimationFrame(draw)
      const cfg = cfgRef.current
      if (!cfg) return
      const palette = SERIES[cfg.theme] || SERIES.dark
      const dpr = window.devicePixelRatio || 1
      const w = wrap.clientWidth
      const h = wrap.clientHeight
      if (w < 8 || h < 8) return
      const pw = Math.floor(w * dpr)
      const ph = Math.floor(h * dpr)
      if (canvas.width !== pw || canvas.height !== ph) {
        canvas.width = pw
        canvas.height = ph
        canvas.style.width = `${w}px`
        canvas.style.height = `${h}px`
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, w, h)

      const padLeft = 44
      const padTop = 6
      const padBottom = 6
      const padRight = 4
      const plotW = Math.max(1, w - padLeft - padRight)
      const plotH = Math.max(1, h - padTop - padBottom)
      const end = Date.now()
      const start = end - CHART_WINDOW
      const cutoff = start - 1500
      const samples = cfg.samplesRef.current || []

      let peak = cfg.min
      for (let i = 0; i < samples.length; i++) {
        const s = samples[i]
        if (s.t < cutoff) continue
        for (let k = 0; k < cfg.idxMap.length; k++) {
          const val = s.v[cfg.idxMap[k]]
          if (val != null && val > peak) peak = val
        }
      }
      const wanted = niceCeil(peak * 1.2, cfg.binary)
      if (yMaxRef.current === 0 || wanted > yMaxRef.current || wanted < yMaxRef.current * 0.35) {
        yMaxRef.current = wanted
      }
      const yMax = yMaxRef.current || 1

      ctx.lineWidth = 1
      ctx.font = '9px ui-monospace, monospace'
      ctx.textAlign = 'right'
      ctx.textBaseline = 'middle'
      for (let i = 0; i < 3; i++) {
        const tickVal = (yMax * i) / 2
        const y = padTop + plotH * (1 - tickVal / yMax)
        ctx.strokeStyle = palette.grid
        ctx.beginPath()
        ctx.moveTo(padLeft, y)
        ctx.lineTo(w - padRight, y)
        ctx.stroke()
        ctx.fillStyle = palette.tick
        ctx.fillText(cfg.format(tickVal), padLeft - 6, y)
      }

      const seriesPaths = []
      for (let si = 0; si < cfg.seriesColors.length; si++) {
        const dataIdx = cfg.idxMap[si]
        const color = cfg.seriesColors[si]
        const dash = si === 1 && cfg.seriesColors.length > 1 ? [6, 4] : null
        const pts = []
        for (let i = 0; i < samples.length; i++) {
          const s = samples[i]
          if (s.t < cutoff || s.t > end) continue
          const v = s.v[dataIdx]
          if (v == null || !Number.isFinite(v)) continue
          const x = padLeft + ((s.t - start) / CHART_WINDOW) * plotW
          if (x < padLeft - 4 || x > w - padRight + 4) continue
          const y = padTop + plotH * (1 - Math.max(0, v) / yMax)
          pts.push([x, y])
        }
        if (pts.length === 0) continue
        pts.push([padLeft + plotW, pts[pts.length - 1][1]])
        if (pts[0][0] > padLeft) pts.unshift([padLeft, pts[0][1]])
        if (pts.length < 2) continue
        seriesPaths.push({ color, dash, pts })
      }

      for (const { color, pts } of seriesPaths) {
        const grad = ctx.createLinearGradient(0, padTop, 0, padTop + plotH)
        grad.addColorStop(0, `${color}44`)
        grad.addColorStop(1, `${color}06`)
        ctx.beginPath()
        ctx.moveTo(pts[0][0], pts[0][1])
        for (let i = 1; i < pts.length; i++) {
          const prev = pts[i - 1]
          const curr = pts[i]
          const mx = (prev[0] + curr[0]) / 2
          const my = (prev[1] + curr[1]) / 2
          ctx.quadraticCurveTo(prev[0], prev[1], mx, my)
        }
        ctx.lineTo(pts[pts.length - 1][0], pts[pts.length - 1][1])
        ctx.lineTo(pts[pts.length - 1][0], padTop + plotH)
        ctx.lineTo(pts[0][0], padTop + plotH)
        ctx.closePath()
        ctx.fillStyle = grad
        ctx.fill()
      }

      for (const { color, dash, pts } of seriesPaths) {
        ctx.beginPath()
        ctx.moveTo(pts[0][0], pts[0][1])
        for (let i = 1; i < pts.length; i++) {
          const prev = pts[i - 1]
          const curr = pts[i]
          const mx = (prev[0] + curr[0]) / 2
          const my = (prev[1] + curr[1]) / 2
          ctx.quadraticCurveTo(prev[0], prev[1], mx, my)
        }
        ctx.lineTo(pts[pts.length - 1][0], pts[pts.length - 1][1])
        ctx.strokeStyle = color
        ctx.lineWidth = 2
        ctx.lineJoin = 'round'
        ctx.lineCap = 'round'
        ctx.setLineDash(dash || [])
        ctx.stroke()
        ctx.setLineDash([])
      }
    }

    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [])

  return (
    <div ref={wrapRef} className="relative w-full h-full" style={{ minHeight: height }}>
      <canvas ref={canvasRef} className="absolute inset-0 block w-full h-full" />
    </div>
  )
})

function SeriesKey({ color, dash }) {
  return (
    <svg width={14} height={2} viewBox="0 0 14 2" className="shrink-0 overflow-visible" aria-hidden>
      <line x1={1} y1={1} x2={13} y2={1} stroke={color} strokeWidth={2} strokeLinecap="round" strokeDasharray={dash} />
    </svg>
  )
}

const ChartBlock = memo(function ChartBlock({ theme, title, value, legend, Icon, iconColor, offline, offlineLabel, children }) {
  const cardBg = theme === 'light' ? '#fff' : '#111111'
  const borderColor = theme === 'light' ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.08)'
  const labelColor = theme === 'light' ? '#555' : 'rgba(255,255,255,0.6)'
  const textColor = theme === 'light' ? '#111' : '#fff'
  const iconBg = theme === 'light' ? 'rgba(0,0,0,0.04)' : 'rgba(255,255,255,0.06)'

  return (
    <div className="min-w-0 flex flex-col rounded-xl overflow-hidden" style={{ background: cardBg, border: `1px solid ${borderColor}` }}>
      <div className="border-b px-4 py-3" style={{ borderColor }}>
        <div className="flex flex-col items-start gap-1 sm:flex-row sm:items-center sm:justify-between sm:gap-2">
          <h3 className="flex min-w-0 max-w-full items-center gap-2 text-sm font-semibold" style={{ color: textColor }}>
            <span
              className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0"
              style={{ background: iconBg }}
            >
              <Icon size={14} weight="duotone" style={{ color: iconColor }} />
            </span>
            <span className="truncate">{title}</span>
          </h3>
          {!offline && value != null && value !== undefined && (
            <span className="shrink-0 text-sm font-mono font-semibold tabular-nums" style={{ color: iconColor }}>
              {value}
            </span>
          )}
          {!offline && legend && (
            <span className="flex max-w-full flex-col items-start gap-1 text-xs sm:flex-row sm:items-center sm:gap-3">
              {legend}
            </span>
          )}
        </div>
      </div>
      <div className="relative min-h-[240px] flex-1 px-3 pt-3 pb-2">
        {offline ? (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2" style={{ color: labelColor, background: 'transparent' }}>
            <Power size={28} weight="duotone" />
            <span className="text-sm">{offlineLabel}</span>
          </div>
        ) : (
          children
        )}
      </div>
    </div>
  )
})

function ClockCard({ theme, lang }) {
  const textColor = theme === 'light' ? '#111' : '#fff'
  const labelColor = theme === 'light' ? '#555' : 'rgba(255,255,255,0.6)'
  const cardBg = theme === 'light' ? '#fff' : '#111111'
  const borderColor = theme === 'light' ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.08)'
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const iv = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(iv)
  }, [])

  return (
    <div className="px-4 pt-4 pb-3 text-center" style={{ borderBottom: `1px solid ${borderColor}`, background: cardBg }}>
      <p className="text-[10px] uppercase font-bold tracking-widest" style={{ color: labelColor }}>
        {lang === 'vi' ? 'Thời gian' : 'Time'}
      </p>
      <p className="text-3xl font-bold font-mono tracking-tight" style={{ color: textColor }}>{fmtClock(now)}</p>
      <p className="text-xs mt-0.5" style={{ color: labelColor }}>{fmtDay(now, lang)}</p>
    </div>
  )
}

function GaugeCard({ label, percent, detail, color, Icon, theme }) {
  const cardBg = theme === 'light' ? '#fff' : '#111111'
  const borderColor = theme === 'light' ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.08)'
  const textColor = theme === 'light' ? '#111' : '#fff'
  const labelColor = theme === 'light' ? '#555' : 'rgba(255,255,255,0.6)'
  const track = theme === 'light' ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.08)'

  const size = 110
  const stroke = 9
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const dash = (clampPct(percent) / 100) * c

  return (
    <div className="flex-1 min-w-0 rounded-xl p-4 flex flex-col items-center gap-2" style={{ background: cardBg, border: `1px solid ${borderColor}` }}>
      <div className="flex items-center gap-1.5 self-start">
        <Icon size={14} weight="duotone" style={{ color }} />
        <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: labelColor }}>{label}</span>
      </div>
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90">
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={track} strokeWidth={stroke} />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke={color}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={`${dash} ${c - dash}`}
            style={{ transition: 'stroke-dasharray 0.4s ease' }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-lg font-bold leading-none" style={{ color: textColor }}>{clampPct(percent)}%</span>
        </div>
      </div>
      <p className="text-[11px] font-mono text-center" style={{ color: labelColor }}>{detail}</p>
    </div>
  )
}

function groupHistory(history, lang) {
  const groups = []
  const byDay = new Map()
  for (const item of history) {
    const key = fmtDay(item.at, lang)
    if (!byDay.has(key)) {
      const g = { day: key, items: [] }
      byDay.set(key, g)
      groups.push(g)
    }
    byDay.get(key).items.push(item)
  }
  return groups
}

export default function OverviewPage({ server, theme, lang, onServerUpdate }) {
  const textColor = theme === 'light' ? '#111' : '#fff'
  const labelColor = theme === 'light' ? '#555' : 'rgba(255,255,255,0.6)'
  const cardBg = theme === 'light' ? '#fff' : '#111111'
  const borderColor = theme === 'light' ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.08)'
  const histBg = theme === 'light' ? 'rgba(0,0,0,0.03)' : 'rgba(255,255,255,0.04)'

  const [status, setStatus] = useState(server?.status || 'stopped')
  const [util, setUtil] = useState({})
  const [history, setHistory] = useState([])
  const [tps, setTps] = useState(null)
  const [wsConnected, setWsConnected] = useState(false)
  const [netSpeeds, setNetSpeeds] = useState({ rxSpeed: 0, txSpeed: 0 })
  const [smooth, setSmooth] = useState({ cpu: null, mem: null, tx: null, rx: null })
  const statusRef = useRef(status)
  statusRef.current = status
  const netPrevRef = useRef(null)
  const wasOfflineRef = useRef(false)
  const smoothRef = useRef({ cpu: null, mem: null, tx: null, rx: null })
  const samplesRef = useRef([])
  const rateHistRef = useRef({ tx: [], rx: [] })
  const pollingRef = useRef(false)

  const meta = STATUS_META[status] || STATUS_META.stopped
  const statusColor = meta.color
  const statusLabel = lang === 'vi' ? meta.labelVi : meta.labelEn

  const bgImage = server?.game === 'terraria' ? './terraria_backgound.png' : './Minecraft_backgound.png'
  const gameIcon = server?.game === 'terraria' ? './terraria_icon.png' : './minecraft_icon.png'

  const memLimit = (server?.resources?.memory || 0) * 1024 * 1024
  const cpuLimit = server?.resources?.cpuPercent || 100
  const diskLimit = (server?.resources?.disk || 0) * 1024 * 1024

  const memUsed = util.memory_bytes || util.memoryUsage || 0
  const cpuUsed = util.cpu_absolute ?? util.cpuUsage ?? 0
  const diskUsed = util.disk_bytes || util.diskUsage || 0

  const memPct = memLimit > 0 ? (memUsed / memLimit) * 100 : 0
  const cpuPct = cpuLimit > 0 ? (cpuUsed / cpuLimit) * 100 : 0
  const diskPct = diskLimit > 0 ? (diskUsed / diskLimit) * 100 : 0

  const tpsValue = status === 'running' ? (tps != null ? tps : (server?.lastTps ?? null)) : null
  const tpsDisplay = tpsValue != null ? tpsValue : 0
  const tpsPct = (tpsDisplay / 20) * 100
  const tpsColor = tpsValue == null
    ? (status === 'running' ? '#eab308' : '#6b7280')
    : tpsValue >= 19 ? '#22c55e' : tpsValue >= 15 ? '#eab308' : tpsValue >= 10 ? '#f97316' : '#ef4444'
  const tpsLabel = tpsValue != null ? `${tpsDisplay.toFixed(1)} / 20.0` : (status === 'running' ? 'đang đo mean… / 20.0' : '0.0 / 20.0')

  const isOffline = status === 'stopped' || status === 'offline' || status === 'error'
  const killable = status === 'stopping'
  const powerBtn = 'flex items-center justify-center gap-1.5 px-4 py-1.5 rounded-lg text-[11px] font-semibold transition-all hover:opacity-85 active:scale-95 min-w-[88px]'

  useEffect(() => {
    setStatus(server?.status || 'stopped')
  }, [server?.status])

  const handlePower = useCallback(async (action) => {
    if (!isElectron || !server?.id) return
    const next = action === 'stop' || action === 'kill' ? 'stopping' : 'starting'
    setStatus(next)
    try {
      let res2
      if (action === 'start') res2 = await window.electronAPI.startGameServer(server.id)
      else if (action === 'stop') res2 = await window.electronAPI.stopGameServer(server.id)
      else if (action === 'kill') res2 = await window.electronAPI.killGameServer(server.id)
      else res2 = await window.electronAPI.wingsServerPower(server.id, action)
      if (!res2?.ok) {
        setStatus('stopped')
        showToast(res2?.error || (lang === 'vi' ? 'Thao tác thất bại' : 'Action failed'), 'error')
      } else {
        const msg = action === 'start' ? (lang === 'vi' ? 'Đang khởi động server…' : 'Starting server…')
          : action === 'restart' ? (lang === 'vi' ? 'Đang khởi động lại server…' : 'Restarting server…')
          : action === 'kill' ? (lang === 'vi' ? 'Đang force stop server…' : 'Force stopping server…')
          : (lang === 'vi' ? 'Đang dừng server…' : 'Stopping server…')
        showToast(msg, 'success')
        if (action === 'start' || action === 'restart') {
          setStatus('starting')
          try { await window.electronAPI.wingsWsConnect(server.id) } catch {}
        }
        if (typeof onServerUpdate === 'function') {
          try {
            const cfg = await window.electronAPI.getServerConfig(server.id)
            if (cfg?.ok && cfg.server) onServerUpdate(cfg.server)
          } catch {}
        }
      }
    } catch (err) {
      setStatus('stopped')
      showToast(err.message || (lang === 'vi' ? 'Thao tác thất bại' : 'Action failed'), 'error')
    }
  }, [server?.id, lang, onServerUpdate])

  const pushChartSample = useCallback((cpu, mem, tx, rx) => {
    const t = Date.now()
    const next = samplesRef.current
    next.push({ t, v: [cpu, mem, tx, rx] })
    const cutoff = t - (CHART_WINDOW + 4000)
    if (next[0] && next[0].t < cutoff) {
      let i = 0
      while (i < next.length && next[i].t < cutoff) i++
      if (i > 0) next.splice(0, i)
    }
  }, [])

  useEffect(() => {
    if (!isElectron || !server?.id) return
    let cancelled = false
    let historyTick = 0
    samplesRef.current = []
    wasOfflineRef.current = false
    netPrevRef.current = null
    rateHistRef.current = { tx: [], rx: [] }
    smoothRef.current = { cpu: null, mem: null, tx: null, rx: null }

    const loadHistory = async () => {
      try {
        const res = await window.electronAPI.getServerHistory?.(server.id)
        if (!cancelled && res?.ok) setHistory(res.history || [])
      } catch {}
    }
    const loadTps = async () => {
      try {
        const res = await window.electronAPI.getServerTps?.(server.id)
        if (!cancelled && res?.ok) setTps(res.tps ?? null)
      } catch {}
    }
    const loadWs = async () => {
      try {
        const res = await window.electronAPI.wingsWsStatus?.(server.id)
        if (!cancelled && res?.ok) setWsConnected(!!res.connected && !!res.authenticated)
      } catch {}
    }
    const poll = async () => {
      if (pollingRef.current) return
      pollingRef.current = true
      try {
        const res = await window.electronAPI.getServerStatus(server.id)
        if (cancelled || !res?.ok) return
        const resources = res.resources || {}
        const nextStatus = res.status || null
        const nextTps = res.tps !== undefined ? res.tps ?? null : undefined

        const running = nextStatus === 'running' || nextStatus === 'starting' || nextStatus === 'stopping'
        const cpuRaw = Number(resources.cpu_absolute ?? resources.cpuUsage ?? 0) || 0
        const memRaw = Number(resources.memory_bytes || resources.memoryUsage || 0) || 0
        const net = resources.network
        let rxSpeed = 0
        let txSpeed = 0
        if (running && net) {
          const rx = Number(net.rx_bytes) || 0
          const tx = Number(net.tx_bytes) || 0
          const nowTs = Date.now()
          const prev = netPrevRef.current
          if (prev && nowTs > prev.t) {
            const elapsed = (nowTs - prev.t) / 1000
            if (rx >= prev.rx) rxSpeed = Math.max(0, (rx - prev.rx) / elapsed)
            if (tx >= prev.tx) txSpeed = Math.max(0, (tx - prev.tx) / elapsed)
          }
          netPrevRef.current = { rx, tx, t: nowTs }
        } else if (!running) {
          netPrevRef.current = null
        }

        const s = smoothRef.current
        if (running) {
          s.cpu = ema(s.cpu, cpuRaw)
          s.mem = ema(s.mem, memRaw)
          s.tx = ema(s.tx, avgRing(rateHistRef.current.tx, txSpeed))
          s.rx = ema(s.rx, avgRing(rateHistRef.current.rx, rxSpeed))
          wasOfflineRef.current = false
          pushChartSample(s.cpu, s.mem, s.tx, s.rx)
        } else if (!wasOfflineRef.current) {
          wasOfflineRef.current = true
          s.cpu = 0
          s.mem = 0
          s.tx = 0
          s.rx = 0
          rateHistRef.current = { tx: [], rx: [] }
          pushChartSample(0, 0, 0, 0)
        }

        setUtil(resources)
        if (nextStatus) setStatus(nextStatus)
        if (nextTps !== undefined) setTps(nextTps)
        setSmooth({ cpu: s.cpu, mem: s.mem, tx: s.tx, rx: s.rx })
        setNetSpeeds({ rxSpeed: s.rx || 0, txSpeed: s.tx || 0 })

        if (nextStatus && nextStatus !== server.status && typeof onServerUpdate === 'function') {
          try {
            const cfg = await window.electronAPI.getServerConfig(server.id)
            if (!cancelled && cfg?.ok && cfg.server) onServerUpdate(cfg.server)
          } catch {}
        }
      } catch {
      } finally {
        pollingRef.current = false
      }
      historyTick++
      if (historyTick % 5 === 1) {
        try {
          const hr = await window.electronAPI.getServerHistory?.(server.id)
          if (!cancelled && hr?.ok) setHistory(hr.history || [])
        } catch {}
      }
      if (historyTick % 3 === 1) loadTps()
      if (historyTick % 3 === 2) loadWs()
    }
    loadHistory()
    loadTps()
    loadWs()
    if (server.status === 'running' || server.status === 'starting') {
      window.electronAPI.wingsWsConnect(server.id).catch(() => {})
    }
    poll()
    const iv = setInterval(poll, 1000)
    const offTps = typeof window.electronAPI.onServerTps === 'function'
      ? window.electronAPI.onServerTps(({ serverId, tps: v }) => {
          if (!cancelled && serverId === server.id) setTps(v ?? null)
        })
      : null
    const offWs = typeof window.electronAPI.onWingsWsEvent === 'function'
      ? window.electronAPI.onWingsWsEvent((data) => {
          if (cancelled || !data || data.serverId !== server.id) return
          if (data.event === 'auth success') setWsConnected(true)
          else if (data.event === 'close' || data.event === 'error') setWsConnected(false)
        })
      : null
    return () => {
      cancelled = true
      clearInterval(iv)
      if (typeof offTps === 'function') offTps()
      if (typeof offWs === 'function') offWs()
    }
  }, [server?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const groups = groupHistory(history, lang).slice(0, 20)
  const totalEvents = history.length
  const offlineLoad = isOffline
  const offlineLabel = lang === 'vi' ? 'Ngoại tuyến' : 'Offline'
  const palette = SERIES[theme] || SERIES.dark
  const colorsPrimary = useMemo(() => [palette.primary], [palette.primary])
  const colorsNetwork = useMemo(() => [palette.primary, palette.secondary], [palette.primary, palette.secondary])
  const formatPct = useMemo(() => (v) => `${Number(Number(v).toFixed(0))}%`, [])
  const formatMem = useMemo(() => (v) => formatBytes(v), [])
  const formatNet = useMemo(() => (v) => formatRate(v), [])
  const idxCpu = useMemo(() => [0], [])
  const idxMem = useMemo(() => [1], [])
  const idxNet = useMemo(() => [2, 3], [])
  const memLegend = theme === 'light' ? '#555' : 'rgba(255,255,255,0.6)'
  const memValue = theme === 'light' ? '#111' : '#fff'

  const cpuDisplay = offlineLoad ? offlineLabel : formatPercent(smooth.cpu ?? cpuUsed)
  const memDisplay = offlineLoad ? offlineLabel : formatBytes(smooth.mem ?? memUsed)
  const netLegend = offlineLoad ? null : (
    <>
      <span className="flex items-center gap-1.5 text-xs whitespace-nowrap" style={{ color: palette.primary }}>
        <SeriesKey color={palette.primary} />
        <span style={{ color: memLegend }}>Outbound</span>
        <span className="font-mono tabular-nums" style={{ color: memValue }}>
          {formatRate(netSpeeds.txSpeed)}
        </span>
      </span>
      <span className="flex items-center gap-1.5 text-xs whitespace-nowrap" style={{ color: palette.secondary }}>
        <SeriesKey color={palette.secondary} dash="6 4" />
        <span style={{ color: memLegend }}>Inbound</span>
        <span className="font-mono tabular-nums" style={{ color: memValue }}>
          {formatRate(netSpeeds.rxSpeed)}
        </span>
      </span>
    </>
  )

  return (
    <div className="h-full overflow-y-auto p-4 flex flex-col gap-4">
      {/* Top: hero 2/3 + history 1/3 */}
      <div className="grid grid-cols-3 gap-4 shrink-0">
        {/* Hero */}
        <div className="col-span-2 rounded-2xl overflow-hidden relative group transition-all hover:shadow-xl" style={{ border: `1px solid ${borderColor}`, minHeight: 280 }}>
          <img src={bgImage} alt="" className="absolute inset-0 w-full h-full object-cover transition-transform duration-500 group-hover:scale-110" />
          <div className="absolute inset-0" style={{ background: 'linear-gradient(to top, rgba(0,0,0,0.92) 0%, rgba(0,0,0,0.55) 45%, rgba(0,0,0,0.25) 100%)' }} />
          <div className="relative z-10 h-full p-5 flex flex-col justify-between min-h-[280px]">
            <div className="flex items-start gap-3">
              <img src={gameIcon} alt="" className="w-14 h-14 rounded-2xl object-contain shadow-lg" style={{ background: 'rgba(0,0,0,0.35)' }} />
              <div className="flex-1 min-w-0">
                <h2 className="text-xl font-bold text-white truncate">{server?.name || 'Server'}</h2>
                <p className="text-xs text-white/60 truncate">{server?.egg || server?.game || ''}{server?.version ? ` · ${server.version}` : ''}</p>
              </div>
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-full" style={{ background: 'rgba(0,0,0,0.45)', border: `1px solid ${statusColor}44` }}>
                <StatusDot color={statusColor} />
                <span className="text-[11px] font-bold" style={{ color: statusColor }}>{statusLabel}</span>
              </div>
            </div>

            {/* Power — same 3 buttons as Console */}
            <div className="flex flex-wrap items-center gap-2 mt-4">
              <button
                onClick={() => handlePower('start')}
                disabled={!isOffline}
                className={powerBtn}
                style={{ background: '#22c55e', color: '#fff', opacity: isOffline ? 1 : 0.4, cursor: isOffline ? 'pointer' : 'not-allowed' }}
              >
                <Play size={13} weight="fill" /> {lang === 'vi' ? 'Khởi động' : 'Start'}
              </button>
              <button
                onClick={() => handlePower('restart')}
                disabled={isOffline || !wsConnected}
                className={powerBtn}
                style={{ background: '#374151', color: '#e5e7eb', opacity: !isOffline && wsConnected ? 1 : 0.4, cursor: !isOffline && wsConnected ? 'pointer' : 'not-allowed' }}
              >
                <ArrowsClockwise size={13} weight="duotone" /> {lang === 'vi' ? 'Khởi động lại' : 'Restart'}
              </button>
              <button
                onClick={() => handlePower(killable ? 'kill' : 'stop')}
                disabled={isOffline}
                className={powerBtn}
                style={{ background: killable ? '#dc2626' : '#ef4444', color: '#fff', opacity: isOffline ? 0.4 : 1, cursor: isOffline ? 'not-allowed' : 'pointer' }}
              >
                <Stop size={13} weight="fill" /> {killable ? (lang === 'vi' ? 'Tắt cứng' : 'Kill') : (lang === 'vi' ? 'Dừng' : 'Stop')}
              </button>
            </div>

            <div className="flex flex-wrap items-end gap-6 mt-4">
              <div>
                <p className="text-[10px] uppercase font-bold tracking-wider text-white/50">{lang === 'vi' ? 'Địa chỉ' : 'Address'}</p>
                <p className="text-sm font-mono text-white/90">127.0.0.1:{server?.port || 25565}</p>
              </div>
              <div>
                <p className="text-[10px] uppercase font-bold tracking-wider text-white/50">{lang === 'vi' ? 'Mã' : 'UUID'}</p>
                <p className="text-[11px] font-mono text-white/70 truncate max-w-[220px]">{server?.id || ''}</p>
              </div>
              <div>
                <p className="text-[10px] uppercase font-bold tracking-wider text-white/50">{lang === 'vi' ? 'Tạo lúc' : 'Created'}</p>
                <p className="text-[11px] font-mono text-white/70">{server?.createdAt ? fmtDay(server.createdAt, lang) : '—'}</p>
              </div>
            </div>
          </div>
        </div>

        {/* History / clock */}
        <div className="col-span-1 rounded-2xl flex flex-col overflow-hidden" style={{ border: `1px solid ${borderColor}`, background: cardBg, minHeight: 280 }}>
          <ClockCard theme={theme} lang={lang} />
          <div className="flex-1 overflow-y-auto px-2 py-2 min-h-0" style={{ maxHeight: 200 }}>
            <p className="text-[10px] uppercase font-bold tracking-wider px-2 mb-1.5" style={{ color: labelColor }}>
              {lang === 'vi' ? `Lịch sử (${totalEvents})` : `History (${totalEvents})`}
            </p>
            {groups.length === 0 ? (
              <p className="text-[11px] px-2 py-4 text-center" style={{ color: labelColor }}>
                {lang === 'vi' ? 'Chưa có sự kiện khởi động/dừng' : 'No start/stop events yet'}
              </p>
            ) : (
              groups.map((g) => (
                <div key={g.day} className="mb-2">
                  <p className="text-[10px] font-bold px-2 py-1 rounded-md" style={{ background: histBg, color: labelColor }}>{g.day}</p>
                  <div className="mt-1 flex flex-col gap-0.5">
                    {g.items.map((item, i) => {
                      const am = ACTION_META[item.action] || ACTION_META.start
                      const Icon = am.Icon || Play
                      return (
                        <div key={`${item.at}-${i}`} className="flex items-start gap-2 px-2 py-1.5 rounded-lg" style={{ background: histBg }}>
                          <span className="w-5 h-5 rounded-md flex items-center justify-center shrink-0 mt-0.5" style={{ background: `${am.color}22` }}>
                            <Icon size={11} weight="fill" style={{ color: am.color }} />
                          </span>
                          <div className="min-w-0 flex-1">
                            <p className="text-[11px] font-semibold leading-tight" style={{ color: textColor }}>
                              {lang === 'vi' ? am.labelVi : am.labelEn}
                            </p>
                            <p className="text-[10px] font-mono" style={{ color: labelColor }}>{fmtTime(item.at)}</p>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Resource gauges — outer wrapper has NO card background/border */}
      <div className="flex flex-row gap-3 shrink-0">
        <GaugeCard
          theme={theme}
          label="RAM"
          percent={memPct}
          detail={`${formatBytes(memUsed)} / ${formatBytes(memLimit)}`}
          color={usageColor(memPct)}
          Icon={Memory}
        />
        <GaugeCard
          theme={theme}
          label="CPU"
          percent={cpuPct}
          detail={`${Math.round(cpuUsed * 10) / 10}% / ${cpuLimit}%`}
          color={usageColor(cpuPct)}
          Icon={Cpu}
        />
        <GaugeCard
          theme={theme}
          label="Disk"
          percent={diskPct}
          detail={`${formatMB(Math.round(diskUsed / (1024 * 1024)))} / ${formatMB(server?.resources?.disk || 0)}`}
          color={usageColor(diskPct)}
          Icon={HardDrive}
        />
        <GaugeCard
          theme={theme}
          label="TPS (mean)"
          percent={tpsPct}
          detail={tpsLabel}
          color={tpsColor}
          Icon={Lightning}
        />
      </div>

      {/* Chart blocks — CPU Load / Memory Load / Network (Calagopus ChartBlock) */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 shrink-0 items-stretch">
        <ChartBlock
          theme={theme}
          title="CPU Load"
          value={cpuDisplay}
          Icon={Cpu}
          iconColor={palette.primary}
          offline={offlineLoad}
          offlineLabel={offlineLabel}
        >
          <StreamChart
            samplesRef={samplesRef}
            seriesColors={colorsPrimary}
            seriesIndices={idxCpu}
            format={formatPct}
            binary={false}
            min={10}
            theme={theme}
            height={220}
          />
        </ChartBlock>
        <ChartBlock
          theme={theme}
          title="Memory Load"
          value={memDisplay}
          Icon={Memory}
          iconColor={palette.primary}
          offline={offlineLoad}
          offlineLabel={offlineLabel}
        >
          <StreamChart
            samplesRef={samplesRef}
            seriesColors={colorsPrimary}
            seriesIndices={idxMem}
            format={formatMem}
            binary
            min={64 * 1024 * 1024}
            theme={theme}
            height={220}
          />
        </ChartBlock>
        <ChartBlock
          theme={theme}
          title="Network"
          legend={netLegend}
          Icon={Network}
          iconColor={palette.primary}
          offline={offlineLoad}
          offlineLabel={offlineLabel}
        >
          <StreamChart
            samplesRef={samplesRef}
            seriesColors={colorsNetwork}
            seriesIndices={idxNet}
            format={formatNet}
            binary
            min={1024}
            theme={theme}
            height={220}
          />
        </ChartBlock>
      </div>
    </div>
  )
}
