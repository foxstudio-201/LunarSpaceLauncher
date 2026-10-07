import { useState, useEffect, useRef, useCallback } from 'react'
import { Play, Stop, ArrowsClockwise, ArrowDown, Copy, MagnifyingGlass, Minus, Plus } from '@phosphor-icons/react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { Unicode11Addon } from '@xterm/addon-unicode11'
import { SearchAddon } from '@xterm/addon-search'
import { showToast } from '../../lib/toast'

const isElectron = typeof window !== 'undefined' && window.electronAPI

const TERM_THEME = {
  background: '#0a0a0a',
  foreground: '#22c55e',
  cursor: '#a78bfa',
  cursorAccent: '#0a0a0a',
  selectionBackground: 'rgba(255,255,255,0.3)',
  selectionInactiveBackground: 'rgba(255,255,255,0.2)',
  black: '#0a0a0a',
  red: '#ef4444',
  green: '#22c55e',
  yellow: '#eab308',
  blue: '#3b82f6',
  magenta: '#a78bfa',
  cyan: '#06b6d4',
  white: '#e5e5e5',
  brightBlack: '#6b7280',
  brightRed: '#f87171',
  brightGreen: '#4ade80',
  brightYellow: '#facc15',
  brightBlue: '#60a5fa',
  brightMagenta: '#c4b5fd',
  brightCyan: '#67e8f9',
  brightWhite: '#ffffff',
}

const PRELUDE = '\x1b[1m\x1b[33mcontainer@terver~ \x1b[0m'

function formatStatus(state) {
  if (state === 'offline' || state === 'stopped') return 'Offline'
  if (state === 'running') return 'Running'
  if (state === 'starting') return 'Starting'
  if (state === 'stopping') return 'Stopping'
  return state
}

export default function ConsolePage({ server, theme, lang, onServerUpdate }) {
  const textColor = theme === 'light' ? '#111' : '#fff'
  const labelColor = theme === 'light' ? '#555' : 'rgba(255,255,255,0.6)'
  const borderColor = theme === 'light' ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.08)'
  const cardBg = theme === 'light' ? '#fff' : '#111111'
  const inputBg = theme === 'light' ? '#fafafa' : '#0a0a0a'

  const [serverState, setServerState] = useState(server?.status || 'stopped')
  const [command, setCommand] = useState('')
  const [isAtBottom, setIsAtBottom] = useState(true)
  const [errorMsg, setErrorMsg] = useState('')
  const [wsConnected, setWsConnected] = useState(false)
  const [selectionTop, setSelectionTop] = useState(null)
  const [hasSelection, setHasSelection] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchText, setSearchText] = useState('')
  const [fontSize, setFontSize] = useState(12)
  const [wsPing, setWsPing] = useState(0)

  const termRef = useRef(null)
  const termElRef = useRef(null)
  const fitRef = useRef(null)
  const searchRef = useRef(null)
  const lastStatusRef = useRef(null)
  const seenLinesRef = useRef(new Set())
  const isFirstLineRef = useRef(true)
  const atLineStartRef = useRef(true)
  const autoScrollRef = useRef(true)
  const commandRef = useRef('')
  const wsPongAtRef = useRef(0)
  const fontSizeRef = useRef(12)
  const lastSnapRef = useRef('')

  commandRef.current = command
  autoScrollRef.current = isAtBottom
  fontSizeRef.current = fontSize

  const ensureTerminal = useCallback(() => {
    if (termRef.current || !termElRef.current) return termRef.current
    const term = new Terminal({
      theme: TERM_THEME,
      fontFamily: 'Menlo, Monaco, "Courier New", monospace',
      fontSize: fontSizeRef.current,
      lineHeight: 1.25,
      allowTransparency: true,
      cursorBlink: false,
      convertEol: false,
      scrollback: 5000,
      disableStdin: true,
      macOptionIsMeta: true,
      allowProposedApi: true,
    })
    const fit = new FitAddon()
    const search = new SearchAddon()
    const unicode = new Unicode11Addon()
    term.loadAddon(fit)
    term.loadAddon(search)
    term.loadAddon(unicode)
    term.open(termElRef.current)
    try { term.unicode.activeVersion = '11' } catch {}
    termRef.current = term
    fitRef.current = fit
    searchRef.current = search
    try { fit.fit() } catch {}
    term.write('\x1b[?25l')

    term.attachCustomKeyEventHandler((e) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === 'c' || e.key === 'C')) {
        if (term.hasSelection()) {
          const text = term.getSelection()
          if (window.electronAPI?.clipboardWrite) {
            window.electronAPI.clipboardWrite(text)
          } else if (navigator.clipboard?.writeText) {
            navigator.clipboard.writeText(text).catch(() => {})
          }
          term.clearSelection()
          return false
        }
      }
      return true
    })

    term.onSelectionChange(() => {
      const has = !!term.hasSelection()
      setHasSelection(has)
      if (!has) { setSelectionTop(null); return }
      try {
        const pos = term.getSelectionPosition()
        const el = termElRef.current
        if (pos && el) {
          const rect = el.getBoundingClientRect()
          const core = term._core
          const cellH = core?._renderService?.dimensions?.css?.cell?.height || 18
          const row = pos.end.y ?? pos.start.y ?? 0
          const top = Math.max(8, row * cellH - rect.height * 0.15)
          setSelectionTop(Math.min(top, Math.max(8, rect.height - 48)))
        }
      } catch { setSelectionTop(40) }
    })
    term.onScroll(() => {
      const buf = term.buffer.active
      const atBottom = buf.viewportY >= buf.baseY
      setIsAtBottom(atBottom)
      autoScrollRef.current = atBottom
    })
    return term
  }, [])

function isTpsProbeNoise(text) {
  const s = String(text ?? '')
  if (!s) return false
  if (/^\[(Install|Daemon|Schedule|Terver)/i.test(s)) return false
  return /Mean TPS:\s*[\d.]+/i.test(s)
    || /Mean tick time:/i.test(s)
    || /System chat:.*(?:Overall|Dim )/i.test(s)
    || /TPS from last/i.test(s)
    || /\bTPS\s*[:=]\s*[\d.]+/i.test(s)
    || /\bMSPT\s*[:=]?\s*[\d.]+/i.test(s)
    || /\bavg\s+TPS\s*[:=]?\s*[\d.]+/i.test(s)
    || /Target tick rate:\s*[\d.]+/i.test(s)
    || /Percentiles:\s*P\d+/i.test(s)
    || /The game is running normally/i.test(s)
    || /Average time per tick:\s*[\d.]+\s*ms/i.test(s)
    || /Target:\s*[\d.]+\s*ms\s*\)/i.test(s)
}

  const writeLine = useCallback((text, { prelude = false, dedupeKey = null } = {}) => {
    const term = termRef.current
    if (!term) return
    const rawStr = String(text ?? '')
    const keptLines = rawStr.split(/\r?\n/).filter((l) => !isTpsProbeNoise(l))
    if (!keptLines.some((l) => l.length)) return
    const filtered = keptLines.join('\n')
    const normKey = filtered.replace(/\r/g, '').replace(/\x1b\[\?25h/g, '').replace(/\x1b\[\?25l/g, '').trimEnd()
    const key = normKey ? `line:${normKey}` : (dedupeKey || null)
    if (key) {
      if (seenLinesRef.current.has(key)) return
      seenLinesRef.current.add(key)
      if (seenLinesRef.current.size > 4000) {
        seenLinesRef.current = new Set([...seenLinesRef.current].slice(-2000))
      }
    }
    let processed = filtered.replace(/\x1b\[\?25h/g, '').replace(/\x1b\[\?25l/g, '')
    processed = processed
      .replace(/container@pterodactyl~/g, 'container@terver')
      .replace(/container@calagopus~/g, 'container@terver')
      .replace(/@calagopus~/g, '@terver')
      .replace(/\[Calagopus Daemon\]/g, '[Terver Daemon]')
      .replace(/\[Calagopus\]/g, '[Terver]')
      .replace(/Calagopus Daemon/g, 'Terver Daemon')
      .replace(/calagopus daemon/gi, 'Terver Daemon')
    if (prelude && !processed.includes('\x1b[1m\x1b[33m') && !processed.includes('container@')) {
      processed = `${PRELUDE}${processed}`
    }
    if (isFirstLineRef.current) {
      isFirstLineRef.current = false
    } else if (!atLineStartRef.current && !processed.startsWith('\r') && !processed.startsWith('\n')) {
      term.write('\r\n')
    }
    processed = processed.replace(/\r?\n/g, '\r\n')
    term.write(processed)
    if (!processed.endsWith('\r\n')) term.write('\r\n')
    atLineStartRef.current = true
    if (autoScrollRef.current) term.scrollToBottom()
  }, [])

  const resetConsole = useCallback(() => {
    const term = termRef.current
    if (term) {
      try { term.reset() } catch {}
      try { term.write('\x1b[?25l') } catch {}
    }
    lastStatusRef.current = null
    seenLinesRef.current = new Set()
    isFirstLineRef.current = true
    atLineStartRef.current = true
    lastSnapRef.current = ''
    autoScrollRef.current = true
    setHasSelection(false)
    setSelectionTop(null)
    setIsAtBottom(true)
  }, [])

  useEffect(() => {
    if (!termElRef.current) return
    ensureTerminal()
    const onResize = () => { try { fitRef.current?.fit() } catch {} }
    window.addEventListener('resize', onResize)
    const ro = new ResizeObserver(onResize)
    if (termElRef.current) ro.observe(termElRef.current)
    return () => {
      window.removeEventListener('resize', onResize)
      ro.disconnect()
      try { termRef.current?.dispose() } catch {}
      termRef.current = null
      fitRef.current = null
      searchRef.current = null
      isFirstLineRef.current = true
      atLineStartRef.current = true
      lastStatusRef.current = null
      seenLinesRef.current = new Set()
    }
  }, [ensureTerminal])

  useEffect(() => {
    const term = termRef.current
    if (!term) return
    term.options.fontSize = fontSize
    requestAnimationFrame(() => {
      try { fitRef.current?.fit() } catch {}
      try { term.refresh(0, term.rows - 1) } catch {}
    })
  }, [fontSize])

  useEffect(() => {
    resetConsole()
    wsPongAtRef.current = 0
    setWsConnected(false)
    setWsPing(0)
    setErrorMsg('')
    setCommand('')
    setSearchOpen(false)
    setSearchText('')
    setServerState(server?.status || 'stopped')
  }, [server?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!isElectron || !server?.id || !window.electronAPI.onServerLogReset) return
    const cleanup = window.electronAPI.onServerLogReset(({ serverId }) => {
      if (serverId !== server.id) return
      resetConsole()
    })
    return () => { if (typeof cleanup === 'function') cleanup() }
  }, [server?.id, resetConsole])

  useEffect(() => {
    if (!isElectron || !server?.id || !window.electronAPI.onWingsWsEvent) return
    const cleanup = window.electronAPI.onWingsWsEvent(({ serverId, event, payload }) => {
      if (serverId !== server.id) return
      if (event === 'auth success') {
        setWsConnected(true)
        setErrorMsg('')
        wsPongAtRef.current = Date.now()
        return
      }
      if (event === 'close') { setWsConnected(false); return }
      if (event === 'error') { setErrorMsg(payload?.message || 'WS error'); return }
      if (event === 'pong' || event === 'ping') { wsPongAtRef.current = Date.now(); return }
      if (event === 'status') {
        const st = payload?.state
        const mapped = st === 'offline' || st === 'stopped' ? 'stopped' : st
        if (mapped === 'running') setServerState('running')
        else if (mapped === 'starting') setServerState('starting')
        else if (mapped === 'stopping') setServerState('stopping')
        else if (mapped === 'stopped') setServerState('stopped')
        const key = `status:${st}`
        if (lastStatusRef.current !== st) {
          lastStatusRef.current = st
          writeLine(`Server marked as ${formatStatus(st)}...`, { prelude: true, dedupeKey: key })
        }
        return
      }
      if (event === 'console output' || event === 'install output') {
        let text = ''
        const lines = payload?.lines
        if (typeof lines === 'string') text = lines
        else if (Array.isArray(lines)) text = lines.join('\r\n')
        else if (Array.isArray(payload?.args)) text = payload.args.join('\r\n')
        if (!text) return
        const parts = text.split(/\r?\n/)
        for (const part of parts) {
          if (part) writeLine(part, { dedupeKey: `line:${part.replace(/\r/g, '').trimEnd()}` })
        }
        return
      }
      if (event === 'daemon message') {
        const a = payload?.args
        const msg = Array.isArray(a) ? a.join(' ') : (a || String(payload || ''))
        writeLine(`[Daemon] ${msg}`, { prelude: true })
        return
      }
      if (event === 'daemon error' || event === 'jwt error') {
        const a = payload?.args
        const msg = Array.isArray(a) ? a.join(' ') : (a || JSON.stringify(payload || {}))
        writeLine(`\x1b[1m\x1b[41m${msg}\x1b[0m`, { prelude: true })
        return
      }
    })
    return () => { if (typeof cleanup === 'function') cleanup() }
  }, [server?.id, writeLine])

  useEffect(() => {
    if (!isElectron || !server?.id) return
    let cancelled = false
    wsPongAtRef.current = 0
    const connect = async () => {
      try {
        const res = await window.electronAPI.wingsWsConnect(server.id)
        if (cancelled) return
        if (res && res.ok === false) setErrorMsg(res.error || 'WS connect failed')
      } catch (err) { if (!cancelled) setErrorMsg(err.message) }
    }
    connect()
    const backfill = async () => {
      if (cancelled) return
      try {
        const st = await window.electronAPI.wingsServerState(server.id).catch(() => null)
        if (cancelled) return
        const state = st?.state
        const offline = !state || state === 'offline' || state === 'stopped' || state === 'null'
        if (offline) return
        const res = await window.electronAPI.wingsServerLogs(server.id, 500)
        if (!cancelled && res?.ok && typeof res.logs === 'string' && res.logs) {
          for (const line of res.logs.split('\n')) {
            if (cancelled) return
            if (line) writeLine(line)
          }
        }
        const res2 = await window.electronAPI.serverGetLogs(server.id)
        if (cancelled || !res2?.ok || !Array.isArray(res2.logs)) return
        for (const entry of res2.logs) {
          if (cancelled) return
          if (entry?.message) writeLine(entry.message)
        }
      } catch {}
    }
    const t = setTimeout(backfill, 800)
    return () => {
      cancelled = true
      clearTimeout(t)
      try { window.electronAPI.wingsWsDisconnect(server.id) } catch {}
    }
  }, [server?.id, writeLine])

  useEffect(() => {
    if (!isElectron || !server?.id) return
    const fetchState = async () => {
      try {
        const res = await window.electronAPI.wingsServerState(server.id)
        if (res?.ok && res?.state) {
          const st = res.state
          const mapped = st === 'offline' || st === 'stopped' ? 'stopped' : st
          setServerState(mapped)
        }
      } catch {}
    }
    fetchState()
    const interval = setInterval(fetchState, 5000)
    return () => clearInterval(interval)
  }, [server?.id])

  useEffect(() => {
    if (!isElectron || !server?.id || !window.electronAPI.onServerProgress) return
    const cleanup = window.electronAPI.onServerProgress(({ serverId, percent, message }) => {
      if (serverId !== server.id) return
      writeLine(`[${percent}%] ${message}`, { dedupeKey: `pct:${percent}:${message}` })
      if (percent >= 100) {
        setServerState('stopped')
        setTimeout(async () => {
          try {
            const res = await window.electronAPI.getServerConfig(serverId)
            if (res?.ok && res.server && typeof onServerUpdate === 'function') onServerUpdate(res.server)
          } catch {}
        }, 1500)
      } else if (percent === 0 && String(message).toLowerCase().includes('fail')) {
        setServerState('error')
      } else if (percent > 0) {
        setServerState('installing')
      }
    })
    return () => { if (typeof cleanup === 'function') cleanup() }
  }, [server?.id, writeLine, onServerUpdate])

  useEffect(() => {
    if (!isElectron || !server?.id || !window.electronAPI.onServerLog) return
    const cleanup = window.electronAPI.onServerLog(({ serverId, message }) => {
      if (serverId !== server.id || !message) return
      writeLine(message)
    })
    return () => { if (typeof cleanup === 'function') cleanup() }
  }, [server?.id, writeLine])

  useEffect(() => {
    if (!isElectron || !server?.id || !window.electronAPI.onServerLogSnapshot) return
    const cleanup = window.electronAPI.onServerLogSnapshot(({ serverId, logs }) => {
      if (serverId !== server.id || typeof logs !== 'string' || !logs) return
      if (logs === lastSnapRef.current) return
      const prevSet = lastSnapRef.current ? new Set(lastSnapRef.current.split('\n')) : null
      lastSnapRef.current = logs
      for (const line of logs.split('\n')) {
        if (!line) continue
        if (prevSet && prevSet.has(line)) continue
        writeLine(line)
      }
    })
    return () => { if (typeof cleanup === 'function') cleanup() }
  }, [server?.id, writeLine])

  useEffect(() => {
    if (!wsConnected) { setWsPing(0); return }
    const iv = setInterval(() => {
      const age = Date.now() - wsPongAtRef.current
      if (wsPongAtRef.current && age < 30000) setWsPing(age > 1500 ? age : Math.max(1, Math.round(age / 10)))
    }, 5000)
    return () => clearInterval(iv)
  }, [wsConnected])

  const handlePower = async (action) => {
    if (!isElectron) return
    setErrorMsg('')
    const next = action === 'stop' || action === 'kill' ? 'stopping' : 'starting'
    setServerState(next)
    try {
      let res2
      if (action === 'start') {
        res2 = await window.electronAPI.startGameServer(server.id)
      } else if (action === 'stop') {
        res2 = await window.electronAPI.stopGameServer(server.id)
      } else if (action === 'kill') {
        res2 = await window.electronAPI.killGameServer(server.id)
      } else {
        res2 = await window.electronAPI.wingsServerPower(server.id, action)
      }
      if (!res2?.ok) {
        setErrorMsg(res2?.error || 'Power action failed')
        setServerState('stopped')
        showToast(res2?.error || (lang === 'vi' ? 'Thao tác thất bại' : 'Action failed'), 'error')
      } else {
        const msg = action === 'start' ? (lang === 'vi' ? 'Đang khởi động server…' : 'Starting server…')
          : action === 'restart' ? (lang === 'vi' ? 'Đang khởi động lại server…' : 'Restarting server…')
          : action === 'kill' ? (lang === 'vi' ? 'Đang force stop server…' : 'Force stopping server…')
          : (lang === 'vi' ? 'Đang dừng server…' : 'Stopping server…')
        showToast(msg, 'success')
        if (action === 'start' || action === 'restart') {
          setServerState('starting')
          try { await window.electronAPI.wingsWsConnect(server.id) } catch {}
        }
      }
    } catch (err) {
      setErrorMsg(err.message || 'Power action failed')
      setServerState('stopped')
      showToast(err.message || (lang === 'vi' ? 'Thao tác thất bại' : 'Action failed'), 'error')
    }
  }

  const handleSendCommand = async () => {
    const cmd = commandRef.current.trim()
    if (!cmd || !isElectron) return
    try {
      const sent = window.electronAPI.wingsWsSend
        ? await window.electronAPI.wingsWsSend(server.id, 'send command', [cmd])
        : null
      if (!sent?.ok) {
        const res = await window.electronAPI.wingsServerCommand(server.id, cmd)
        if (!res?.ok) setErrorMsg(res?.error || 'Command failed')
      }
      setCommand('')
    } catch (err) {
      setErrorMsg(err.message || 'Command failed')
    }
  }

  const copySelection = useCallback(async () => {
    try {
      const term = termRef.current
      if (!term) return
      const text = term.getSelection()
      if (!text) return
      if (window.electronAPI?.clipboardWrite) {
        await window.electronAPI.clipboardWrite(text)
      } else if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text)
      }
      term.clearSelection()
      setHasSelection(false)
      setSelectionTop(null)
    } catch {}
  }, [])

  const scrollToBottom = useCallback(() => {
    try { termRef.current?.scrollToBottom() } catch {}
    setIsAtBottom(true)
    autoScrollRef.current = true
  }, [])

  const runSearch = useCallback((dir = 1) => {
    const s = searchRef.current
    if (!s || !searchText) return
    if (dir > 0) s.findNext(searchText, { incremental: true })
    else s.findPrevious(searchText)
  }, [searchText])

  const stateColors = {
    running: '#22c55e',
    starting: '#eab308',
    installing: '#eab308',
    stopping: '#eab308',
    stopped: '#ef4444',
    offline: '#ef4444',
    error: '#ef4444',
  }
  const isOffline = serverState === 'stopped' || serverState === 'offline' || serverState === 'error'
  const killable = serverState === 'stopping'

  const powerBtn = 'flex items-center justify-center gap-1.5 px-4 py-1.5 rounded-lg text-[11px] font-semibold transition-all hover:opacity-85 active:scale-95 min-w-[88px]'

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="shrink-0 flex items-center gap-3 px-4 py-2.5" style={{ borderBottom: `1px solid ${borderColor}`, background: cardBg }}>
        <div className="flex flex-col min-w-0">
          <span className="text-[13px] font-semibold truncate" style={{ color: textColor }}>
            {server?.name || 'Server'}
          </span>
          {server?.description ? (
            <span className="text-[10px] truncate" style={{ color: labelColor }}>{server.description}</span>
          ) : null}
        </div>
        <div className="flex-1" />
        <div className="flex items-center gap-2">
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
      </div>

      {errorMsg && (
        <div className="shrink-0 px-4 py-2 text-[11px] font-medium flex items-center gap-2" style={{ background: 'rgba(239,68,68,0.15)', color: '#ef4444', borderBottom: '1px solid rgba(239,68,68,0.3)' }}>
          <span className="flex-1">{errorMsg}</span>
          <button onClick={() => setErrorMsg('')} className="text-[10px] opacity-70 hover:opacity-100">X</button>
        </div>
      )}

      <div className="flex-1 min-h-0 flex flex-col p-2" style={{ background: cardBg, margin: '8px', borderRadius: '12px', border: `1px solid ${borderColor}` }}>
        <div className="flex flex-row justify-between items-center mb-2 text-xs shrink-0" style={{ color: labelColor }}>
          <div className="flex flex-row items-center gap-2">
            <span
              className="rounded-full size-3 animate-pulse"
              style={{ background: wsConnected ? '#22c55e' : '#ef4444' }}
            />
            {wsConnected
              ? (lang === 'vi' ? `Đã kết nối` : `Connected`)
              : (lang === 'vi' ? `Ngắt kết nối` : `Disconnected`)}
            {wsConnected && wsPing > 0 ? ` · ${wsPing}ms` : ''}
          </div>
          <div className="flex flex-row items-center gap-1">
            <button
              onClick={() => setSearchOpen((v) => !v)}
              className="p-1.5 rounded transition-colors hover:opacity-80"
              style={{ background: searchOpen ? 'rgba(167,139,250,0.15)' : 'transparent', color: searchOpen ? '#a78bfa' : labelColor }}
              title={lang === 'vi' ? 'Tìm trong console' : 'Search console'}
            >
              <MagnifyingGlass size={14} />
            </button>
            <button
              onClick={() => setFontSize((s) => Math.max(10, s - 1))}
              className="p-1.5 rounded transition-colors hover:opacity-80"
              style={{ color: labelColor }}
              title="A-"
            >
              <Minus size={14} />
            </button>
            <span className="text-[10px] font-mono px-0.5 min-w-[28px] text-center" style={{ color: labelColor }}>{fontSize}px</span>
            <button
              onClick={() => setFontSize((s) => Math.min(24, s + 1))}
              className="p-1.5 rounded transition-colors hover:opacity-80"
              style={{ color: labelColor }}
              title="A+"
            >
              <Plus size={14} />
            </button>
          </div>
        </div>

        {searchOpen && (
          <div className="flex flex-row gap-2 mb-2 shrink-0">
            <input
              autoFocus
              value={searchText}
              onChange={(e) => {
                setSearchText(e.target.value)
                searchRef.current?.findNext(e.target.value, { incremental: true })
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  if (e.shiftKey) runSearch(-1)
                  else runSearch(1)
                }
                if (e.key === 'Escape') { setSearchOpen(false); setSearchText(''); searchRef.current?.clearDecorations?.() }
              }}
              placeholder={lang === 'vi' ? 'Tìm...' : 'Search...'}
              className="flex-1 px-2 py-1 rounded text-[11px] outline-none font-mono"
              style={{ background: inputBg, border: `1px solid ${borderColor}`, color: textColor }}
            />
            <button onClick={() => runSearch(-1)} className="px-2 py-1 rounded text-[11px]" style={{ background: 'rgba(255,255,255,0.08)', color: labelColor }}>↑</button>
            <button onClick={() => runSearch(1)} className="px-2 py-1 rounded text-[11px]" style={{ background: 'rgba(255,255,255,0.08)', color: labelColor }}>↓</button>
          </div>
        )}

        <div className="flex-1 min-h-0 relative overflow-hidden" style={{ background: '#0a0a0a', borderRadius: '8px' }}>
          <div ref={termElRef} className="absolute inset-0" />
          {selectionTop !== null && hasSelection && (
            <div
              className="absolute left-1/2 -translate-x-1/2 z-10 shadow-md"
              style={{ top: selectionTop }}
            >
              <button
                onClick={copySelection}
                aria-label="Copy selection"
                className="flex items-center justify-center w-9 h-9 rounded-lg transition-all hover:opacity-85"
                style={{ background: cardBg, border: `1px solid ${borderColor}`, color: textColor }}
                title="Copy"
              >
                <Copy size={14} weight="duotone" />
              </button>
            </div>
          )}
          {!isAtBottom && (
            <div className="absolute bottom-3 right-3 z-10">
              <button
                onClick={scrollToBottom}
                className="flex items-center justify-center w-8 h-8 rounded-full shadow-md transition-all hover:opacity-85"
                style={{ background: cardBg, border: `1px solid ${borderColor}`, color: textColor }}
                title={lang === 'vi' ? 'Cuộn xuống cuối' : 'Scroll to bottom'}
              >
                <ArrowDown size={14} weight="duotone" />
              </button>
            </div>
          )}
        </div>

        <div className="w-full mt-3 flex flex-row gap-2 shrink-0">
          <input
            value={command}
            onChange={(e) => setCommand(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleSendCommand() }}
            placeholder={lang === 'vi' ? 'Nhập lệnh...' : 'Enter command...'}
            aria-label={lang === 'vi' ? 'Nhập lệnh console' : 'Console command input'}
            disabled={!wsConnected || isOffline}
            className="flex-1 px-3 py-2 rounded-lg text-[12px] outline-none font-mono disabled:opacity-40"
            style={{ background: inputBg, border: `1px solid ${borderColor}`, color: '#22c55e' }}
            autoCorrect="off"
            autoCapitalize="none"
          />
          <button
            onClick={handleSendCommand}
            disabled={!command.trim() || !wsConnected || isOffline}
            className="px-4 py-2 rounded-lg text-[11px] font-semibold transition-all hover:opacity-85 active:scale-95 disabled:opacity-40"
            style={{ background: '#a78bfa', color: '#fff' }}
          >
            {lang === 'vi' ? 'Gửi' : 'Send'}
          </button>
        </div>
      </div>

      <div className="shrink-0 px-4 py-1.5 flex items-center gap-3 text-[10px]" style={{ color: labelColor, borderTop: `1px solid ${borderColor}` }}>
        <span className="flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full" style={{ background: stateColors[serverState] || '#888' }} />
          {formatStatus(serverState)}
        </span>
        <span className="flex-1" />
        <span style={{ color: stateColors[serverState] || '#888' }}>{serverState}</span>
      </div>
    </div>
  )
}
