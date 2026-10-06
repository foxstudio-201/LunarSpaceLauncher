import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Play, Stop, ArrowsClockwise, ArrowDown, Copy, MagnifyingGlass, Minus, Plus, Trash, Funnel,
  WarningCircle, WarningOctagon,
} from '@phosphor-icons/react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { Unicode11Addon } from '@xterm/addon-unicode11'
import { SearchAddon } from '@xterm/addon-search'
import { t } from '../../i18n/translations'
import { useApp } from '../../i18n/AppContext'
import { palette, currentPaletteSkin } from '../../lib/palette'
import { statusColor, statusKey } from '../../lib/status'
import { BANNER_MARK } from '../../lib/asciiLogo'

const FONT_STACK = () =>
  currentPaletteSkin() === 'pixel' ? "'VT323', monospace" : 'Menlo, Monaco, "Courier New", monospace'

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

const CURSOR = /\x1b\[\?25[hl]/g
const ANSI_RE = /\x1b\[[0-9;?]*[a-zA-Z]/g

export default function ConsolePage({ instance, theme, lang, logs, launchError, crash, onOpenCrash, onLaunch, onStop, onRestart }) {
  const { skin } = useApp()
  const c = palette(theme)
  const status = instance.status || 'ready'
  const running = status === 'running'
  const stopping = status === 'stopping'
  const busy = running || stopping
  const error = launchError[instance.id]
  const live = logs?.[instance.id] || []

  const [searchOpen, setSearchOpen] = useState(false)
  const [searchText, setSearchText] = useState('')
  const [filter, setFilter] = useState('')
  const [fontSize, setFontSize] = useState(12)
  const [hasSelection, setHasSelection] = useState(false)
  const [isAtBottom, setIsAtBottom] = useState(true)

  const termRef = useRef(null)
  const termElRef = useRef(null)
  const fitRef = useRef(null)
  const searchRef = useRef(null)
  const autoScrollRef = useRef(true)
  const lastLineRef = useRef(null)
  const linesRef = useRef([])
  const filterRef = useRef('')
  const fontSizeRef = useRef(12)

  fontSizeRef.current = fontSize
  filterRef.current = filter
  autoScrollRef.current = isAtBottom

  const matches = useCallback((line) => {
    const f = filterRef.current.trim().toLowerCase()
    if (!f) return true
    return String(line).toLowerCase().includes(f)
  }, [])

  const writeRaw = useCallback((text) => {
    const term = termRef.current
    if (!term) return
    term.write(`${String(text ?? '').replace(CURSOR, '').replace(/\r?\n/g, '\r\n')}\r\n`)
  }, [])

  const writeLines = useCallback((lines) => {
    const term = termRef.current
    if (!term) return
    let i = 0
    while (i < lines.length) {
      if (String(lines[i]).startsWith(BANNER_MARK)) {
        let j = i
        while (j < lines.length && String(lines[j]).startsWith(BANNER_MARK)) j += 1
        const block = lines.slice(i, j).map((line) => String(line).slice(BANNER_MARK.length))
        const width = block.reduce((max, line) => Math.max(max, line.replace(ANSI_RE, '').length), 0)
        const indent = ' '.repeat(Math.max(0, Math.floor((term.cols - width) / 2)))
        for (const line of block) writeRaw(`${indent}${line}`)
        i = j
        continue
      }
      writeRaw(lines[i])
      i += 1
    }
  }, [writeRaw])

  const rewriteAll = useCallback((lines) => {
    const term = termRef.current
    if (!term) return
    try { term.reset() } catch {}
    try { term.write('\x1b[?25l') } catch {}
    writeLines(lines.filter((line) => matches(line)))
    autoScrollRef.current = true
    setIsAtBottom(true)
    try { term.scrollToBottom() } catch {}
  }, [matches, writeLines])

  const ensureTerminal = useCallback(() => {
    if (termRef.current || !termElRef.current) return termRef.current
    const term = new Terminal({
      theme: TERM_THEME,
      fontFamily: FONT_STACK(),
      fontSize: fontSizeRef.current,
      lineHeight: 1.1,
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
      if ((e.ctrlKey || e.metaKey) && (e.key === 'c' || e.key === 'C') && term.hasSelection()) {
        const text = term.getSelection()
        if (window.electronAPI?.clipboardWrite) window.electronAPI.clipboardWrite(text)
        else if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).catch(() => {})
        term.clearSelection()
        return false
      }
      return true
    })
    term.onSelectionChange(() => setHasSelection(!!term.hasSelection()))
    term.onScroll(() => {
      const buf = term.buffer.active
      const atBottom = buf.viewportY >= buf.baseY
      setIsAtBottom(atBottom)
      autoScrollRef.current = atBottom
    })
    return term
  }, [])

  const copySelection = useCallback(async () => {
    try {
      const term = termRef.current
      if (!term) return
      const text = term.getSelection()
      if (!text) return
      if (window.electronAPI?.clipboardWrite) await window.electronAPI.clipboardWrite(text)
      else if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(text)
      term.clearSelection()
      setHasSelection(false)
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

  const clearLog = useCallback(() => {
    try { termRef.current?.reset() } catch {}
    try { termRef.current?.write('\x1b[?25l') } catch {}
    lastLineRef.current = live.length ? live[live.length - 1] : null
    autoScrollRef.current = true
    setIsAtBottom(true)
  }, [live])

  useEffect(() => {
    if (!termElRef.current) return undefined
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
    }
  }, [ensureTerminal])

  useEffect(() => {
    const term = termRef.current
    if (!term) return
    term.options.fontFamily = FONT_STACK()
    term.options.fontSize = fontSize
    requestAnimationFrame(() => {
      try { fitRef.current?.fit() } catch {}
      try { term.refresh(0, term.rows - 1) } catch {}
    })
  }, [skin])

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
    lastLineRef.current = null
    setFilter('')
    setSearchText('')
    setSearchOpen(false)
    setHasSelection(false)
    setIsAtBottom(true)
    autoScrollRef.current = true
    filterRef.current = ''
    const term = termRef.current
    if (term) {
      try { term.reset() } catch {}
      try { term.write('\x1b[?25l') } catch {}
    }
  }, [instance.id])

  linesRef.current = live

  useEffect(() => {
    const term = termRef.current
    if (!term) return
    const last = lastLineRef.current
    if (last != null && live.lastIndexOf(last) === -1) {
      rewriteAll(live)
      lastLineRef.current = live.length ? live[live.length - 1] : null
      return
    }
    const start = last == null ? 0 : live.lastIndexOf(last) + 1
    writeLines(live.slice(start).filter((line) => matches(line)))
    if (live.length) lastLineRef.current = live[live.length - 1]
    if (autoScrollRef.current) {
      try { term.scrollToBottom() } catch {}
    }
  }, [live, matches, writeLines, rewriteAll])

  useEffect(() => {
    rewriteAll(linesRef.current)
    lastLineRef.current = live.length ? live[live.length - 1] : null
  }, [filter, rewriteAll])

  const powerBtn = 'flex items-center justify-center gap-1.5 px-3.5 py-1.5 rounded-lg text-[11px] font-semibold transition-all hover:opacity-85 active:scale-95'
  const stateLabel = t(lang, statusKey(status))
  const color = statusColor(status)

  return (
    <div data-surface className="h-full flex flex-col overflow-hidden" style={{ background: c.bg }}>
      <div className="shrink-0 flex items-center gap-3 px-4 py-2.5" style={{ borderBottom: `1px solid ${c.border}`, background: c.surface }}>
        <div className="flex flex-col min-w-0">
          <span className="text-[13px] font-semibold truncate" style={{ color: c.text }}>{instance.name}</span>
          <span className="text-[10px] truncate" style={{ color: c.faint }}>
            {instance.loader}{instance.loaderVersion ? ` ${instance.loaderVersion}` : ''} · {instance.version}
          </span>
        </div>
        <div className="flex-1" />
        <div className="flex items-center gap-2">
          <button
            onClick={() => onLaunch(instance)}
            disabled={busy}
            className={powerBtn}
            style={{ background: '#22c55e', color: '#fff', opacity: busy ? 0.4 : 1, cursor: busy ? 'not-allowed' : 'pointer' }}
          >
            <Play size={13} weight="fill" /> {t(lang, 'instance.launch')}
          </button>
          <button
            onClick={() => onRestart(instance)}
            disabled={!running}
            className={powerBtn}
            style={{ background: c.input, color: c.text, border: `1px solid ${c.border}`, opacity: running ? 1 : 0.4, cursor: running ? 'pointer' : 'not-allowed' }}
          >
            <ArrowsClockwise size={13} weight="duotone" /> {lang === 'vi' ? 'Khởi động lại' : 'Restart'}
          </button>
          <button
            onClick={() => onStop(instance)}
            disabled={!busy}
            className={powerBtn}
            style={{ background: stopping ? '#dc2626' : '#ef4444', color: '#fff', opacity: busy ? 1 : 0.4, cursor: busy ? 'pointer' : 'not-allowed' }}
          >
            <Stop size={13} weight="fill" />
            {stopping ? (lang === 'vi' ? 'Đang dừng…' : 'Stopping…') : (lang === 'vi' ? 'Dừng' : 'Stop')}
          </button>
        </div>
      </div>

      {error && (
        <div className="shrink-0 px-4 py-2 text-[11px] font-medium flex items-center gap-2" style={{ background: 'rgba(239,68,68,0.15)', color: '#ef4444', borderBottom: '1px solid rgba(239,68,68,0.3)' }}>
          <WarningCircle size={13} weight="duotone" className="shrink-0" />
          <span className="flex-1 break-words leading-snug">{error}</span>
        </div>
      )}

      {!error && crash && (
        <div className="shrink-0 px-4 py-2 flex items-center gap-2" style={{ background: 'rgba(239,68,68,0.12)', borderBottom: '1px solid rgba(239,68,68,0.25)' }}>
          <WarningOctagon size={13} weight="duotone" className="shrink-0" style={{ color: '#f87171' }} />
          <span className="text-[11px] flex-1 truncate" style={{ color: '#f87171' }}>
            {lang === 'vi' ? 'Phiên chạy trước bị lỗi: ' : 'Previous run failed: '}
            {lang === 'vi' ? crash.analysis?.title : (crash.analysis?.titleEn || crash.analysis?.title)}
          </span>
          <button
            onClick={() => onOpenCrash?.(instance.id)}
            className="h-7 px-2.5 rounded-lg text-[10px] font-bold shrink-0"
            style={{ background: 'rgba(239,68,68,0.2)', color: '#f87171', border: '1px solid rgba(239,68,68,0.35)' }}
          >
            {lang === 'vi' ? 'Xem báo cáo lỗi' : 'View crash report'}
          </button>
        </div>
      )}

      <div className="flex-1 min-h-0 flex flex-col m-2 rounded-xl p-2.5" style={{ background: c.surface, border: `1px solid ${c.border}` }}>
        <div className="flex flex-row justify-between items-center mb-2 text-xs shrink-0" style={{ color: c.label }}>
          <div className="flex flex-row items-center gap-2">
            <span className="rounded-full size-2" style={{ background: color }} />
            <span className="text-[11px] font-semibold" style={{ color }}>{stateLabel}</span>
          </div>
          <div className="flex flex-row items-center gap-1">
            <button
              onClick={() => { setSearchOpen((v) => !v); if (searchOpen) searchRef.current?.clearDecorations?.() }}
              data-tip={lang === 'vi' ? 'Tìm trong console' : 'Search console'}
              className="p-1.5 rounded transition-colors hover:opacity-80"
              style={{ background: searchOpen ? 'rgba(167,139,250,0.15)' : 'transparent', color: searchOpen ? c.accent : c.label }}
            >
              <MagnifyingGlass size={14} />
            </button>
            <button onClick={() => setFontSize((s) => Math.max(10, s - 1))} data-tip="A-" className="p-1.5 rounded transition-colors hover:opacity-80" style={{ color: c.label }}>
              <Minus size={14} />
            </button>
            <span className="text-[10px] font-mono px-0.5 min-w-[28px] text-center" style={{ color: c.label }}>{fontSize}px</span>
            <button onClick={() => setFontSize((s) => Math.min(24, s + 1))} data-tip="A+" className="p-1.5 rounded transition-colors hover:opacity-80" style={{ color: c.label }}>
              <Plus size={14} />
            </button>
          </div>
        </div>

        {searchOpen && (
          <div className="flex flex-row gap-2 mb-2 shrink-0">
            <input
              autoFocus
              value={searchText}
              onChange={(e) => { setSearchText(e.target.value); searchRef.current?.findNext(e.target.value, { incremental: true }) }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { if (e.shiftKey) runSearch(-1); else runSearch(1) }
                if (e.key === 'Escape') { setSearchOpen(false); setSearchText(''); searchRef.current?.clearDecorations?.() }
              }}
              placeholder={lang === 'vi' ? 'Tìm...' : 'Search...'}
              className="flex-1 px-2 py-1 rounded text-[11px] outline-none font-mono"
              style={{ background: c.input, border: `1px solid ${c.border}`, color: c.text }}
            />
            <button onClick={() => runSearch(-1)} className="px-2 py-1 rounded text-[11px]" style={{ background: c.input, color: c.label }}>↑</button>
            <button onClick={() => runSearch(1)} className="px-2 py-1 rounded text-[11px]" style={{ background: c.input, color: c.label }}>↓</button>
          </div>
        )}

        <div className="flex-1 min-h-0 relative overflow-hidden" style={{ background: '#0a0a0a', borderRadius: '8px', border: `1px solid ${c.border}` }}>
          <div ref={termElRef} className="absolute inset-0 px-2 py-1.5" />
          {live.length === 0 && !busy && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <span className="text-[11px]" style={{ color: 'rgba(255,255,255,0.32)' }}>{t(lang, 'instance.console.empty')}</span>
            </div>
          )}
          {hasSelection && (
            <div className="absolute left-1/2 -translate-x-1/2 z-10 top-2">
              <button
                onClick={copySelection}
                aria-label="Copy selection"
                data-tip="Copy"
                className="flex items-center justify-center w-8 h-8 rounded-lg transition-all hover:opacity-85"
                style={{ background: c.surface, border: `1px solid ${c.border}`, color: c.text }}
              >
                <Copy size={13} weight="duotone" />
              </button>
            </div>
          )}
          {!isAtBottom && (
            <div className="absolute bottom-3 right-3 z-10">
              <button
                onClick={scrollToBottom}
                data-tip={lang === 'vi' ? 'Cuộn xuống cuối' : 'Scroll to bottom'}
                className="flex items-center justify-center w-8 h-8 rounded-full transition-all hover:opacity-85"
                style={{ background: c.surface, border: `1px solid ${c.border}`, color: c.text }}
              >
                <ArrowDown size={14} weight="duotone" />
              </button>
            </div>
          )}
        </div>

        <div className="w-full mt-2.5 flex flex-row items-center gap-2 shrink-0">
          <div className="relative flex-1">
            <Funnel size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: c.faint }} />
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder={lang === 'vi' ? 'Lọc log…' : 'Filter log…'}
              className="w-full h-8 pl-7 pr-3 rounded-lg text-[12px] outline-none font-mono"
              style={{ background: c.input, border: `1px solid ${c.border}`, color: c.text }}
            />
          </div>
          {filter && (
            <button
              onClick={() => setFilter('')}
              className="h-8 px-3 rounded-lg text-[11px] font-semibold transition-all hover:opacity-85"
              style={{ background: c.input, border: `1px solid ${c.border}`, color: c.label }}
            >
              {lang === 'vi' ? 'Bỏ lọc' : 'Clear filter'}
            </button>
          )}
          <span className="text-[10px] font-mono shrink-0" style={{ color: c.faint }}>
            {live.length} {lang === 'vi' ? 'dòng' : 'lines'}
          </span>
          <button
            onClick={clearLog}
            data-tip={lang === 'vi' ? 'Xoá log' : 'Clear log'}
            className="h-8 px-2.5 rounded-lg flex items-center gap-1.5 text-[11px] font-semibold transition-all hover:opacity-85 shrink-0"
            style={{ background: c.input, border: `1px solid ${c.border}`, color: c.label }}
          >
            <Trash size={13} /> {lang === 'vi' ? 'Xoá' : 'Clear'}
          </button>
        </div>
      </div>

      <div className="shrink-0 px-4 py-1.5 flex items-center gap-3 text-[10px]" style={{ color: c.label, borderTop: `1px solid ${c.border}` }}>
        <span className="flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full" style={{ background: color }} />
          {stateLabel}
        </span>
        <span className="flex-1" />
        <span className="font-mono">{instance.loader}{instance.loaderVersion ? `-${instance.loaderVersion}` : ''}</span>
        <span className="font-mono">{instance.version}</span>
        {instance.javaMajor ? <span className="font-mono" style={{ color: c.faint }}>Java {instance.javaMajor}+</span> : null}
      </div>
    </div>
  )
}
