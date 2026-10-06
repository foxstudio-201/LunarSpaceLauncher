import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Minus, X, DownloadSimple, HardDrives, FolderSimple, CheckCircle, Warning, ArrowsClockwise, Trash, CircleNotch, ArrowRight } from '@phosphor-icons/react'
import { palette } from '../lib/palette'
import { t } from '../i18n/translations'
import { formatBytes } from '../lib/status'
import bgArt from '../../LunarSpace_backgound_app_install.png'

const FILL = {
  run: { from: '#7c5cf6', to: '#a78bfa', glow: 'rgba(167,139,250,0.55)' },
  done: { from: '#15803d', to: '#22c55e', glow: 'rgba(34,197,94,0.5)' },
  failed: { from: '#b91c1c', to: '#ef4444', glow: 'rgba(239,68,68,0.5)' },
}

const ERROR_KEYS = {
  running: 'installer.err.running',
  'no space': 'installer.err.space',
  'missing source': 'installer.err.source',
  'missing exe': 'installer.err.source',
}

function Row({ c, icon: Icon, label, value, title, action, mono = true }) {
  return (
    <div className="flex items-center gap-3 min-w-0">
      {Icon && <Icon size={13} weight="duotone" style={{ color: c.faint }} className="shrink-0" />}
      <span className="text-[10px] font-semibold uppercase tracking-[0.12em] shrink-0" style={{ color: c.label }}>{label}</span>
      <span className={`text-[12px] truncate flex-1 ${mono ? 'font-mono' : ''}`} style={{ color: c.text }} title={title || value}>{value}</span>
      {action}
    </div>
  )
}

function Step({ c, active, done, label }) {
  return (
    <div className="flex items-center gap-2">
      <span
        className="w-1.5 h-1.5 rounded-full shrink-0"
        style={{ background: done ? '#22c55e' : active ? c.accent : c.input, border: `1px solid ${done ? '#22c55e' : active ? c.accent : c.border}` }}
      />
      <span className="text-[10px] font-medium" style={{ color: done || active ? c.text : c.faint }}>{label}</span>
    </div>
  )
}

export default function InstallerApp() {
  const lang = window.__boot?.lang === 'en' ? 'en' : 'vi'
  const theme = window.__boot?.theme === 'light' ? 'light' : 'dark'
  const c = palette(theme)
  const tr = useCallback((key) => t(lang, key), [lang])

  const [state, setState] = useState(null)
  const [agree, setAgree] = useState(false)
  const [removeData, setRemoveData] = useState(false)
  const [busy, setBusy] = useState(false)
  const startedRef = useRef(false)

  useEffect(() => {
    let alive = true
    window.lunarInstaller?.state().then((next) => {
      if (alive && next) setState(next)
    })
    const off = window.lunarInstaller?.onEvent((next) => setState(next))
    return () => {
      alive = false
      if (typeof off === 'function') off()
    }
  }, [])

  const start = useCallback(async () => {
    if (startedRef.current) return
    startedRef.current = true
    setBusy(true)
    await window.lunarInstaller?.start({ dir: state?.installDir })
    setBusy(false)
  }, [state?.installDir])

  useEffect(() => {
    if (!state?.autoStart || state.mode === 'uninstall' || state.phase !== 'ready') return
    const timer = setTimeout(start, 900)
    return () => clearTimeout(timer)
  }, [state?.autoStart, state?.mode, state?.phase, start])

  const phase = state?.phase || 'ready'
  const installing = phase === 'copy'
  const mode = state?.mode || 'install'
  const licenseStep = phase === 'license'
  const canStart = !installing && !busy && (mode !== 'install' || agree)

  const free = useMemo(() => (state?.destFree ? formatBytes(state.destFree) : ''), [state?.destFree])
  const need = useMemo(() => (state?.needFree ? formatBytes(state.needFree) : ''), [state?.needFree])

  const kindKey = { install: 'installer.kind.install', update: 'installer.kind.update', repair: 'installer.kind.repair', uninstall: 'installer.kind.uninstall' }[mode] || 'installer.kind.install'
  const accentBar = phase === 'error' ? FILL.failed : phase === 'done' ? FILL.done : FILL.run

  const stepLabel = {
    closing: tr('installer.step.closing'),
    files: tr('installer.step.files'),
    shortcuts: tr('installer.step.shortcuts'),
    registry: tr('installer.step.registry'),
    done: tr('installer.step.done'),
    removed: tr('installer.step.removed'),
  }[state?.step] || tr('installer.step.files')

  const errorText = phase === 'error' ? tr(ERROR_KEYS[state?.error] || 'installer.err.unknown') : ''

  const btn = (primary) =>
    primary
      ? { background: c.accent, color: '#0a0a0a', border: `1px solid ${c.accent}` }
      : { background: 'transparent', color: c.label, border: `1px solid ${c.border}` }

  return (
    <div className="h-screen flex flex-col overflow-hidden" style={{ background: c.bg, color: c.text }}>
      <header className="drag-region flex items-center gap-2.5 h-11 px-3 shrink-0" style={{ borderBottom: `1px solid ${c.border}` }}>
        <img src="./icon.png" alt="" className="w-4 h-4 shrink-0" />
        <span className="text-[11px] font-semibold tracking-wide">{tr('installer.title')}</span>
        <span className="text-[10px] font-mono px-1.5 py-0.5 rounded" style={{ background: c.input, color: c.faint }}>v{state?.appVersion || ''}</span>
        <div className="flex-1" />
        <button className="no-drag w-8 h-8 rounded-md flex items-center justify-center transition-colors" style={{ color: c.label }} onClick={() => window.lunarInstaller?.minimize()} aria-label="Minimize">
          <Minus size={13} />
        </button>
        <button
          className="no-drag w-8 h-8 rounded-md flex items-center justify-center transition-colors"
          style={{ color: c.label }}
          onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(239,68,68,0.85)'; e.currentTarget.style.color = '#fff' }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = c.label }}
          onClick={() => window.lunarInstaller?.quit()}
          aria-label="Close"
        >
          <X size={13} />
        </button>
      </header>

      <div className="relative shrink-0" style={{ height: 196 }}>
        <img src={bgArt} alt="" className="absolute inset-0 w-full h-full object-cover" style={{ objectPosition: 'center 61%' }} />
        <div className="absolute inset-0" style={{ background: 'linear-gradient(180deg, rgba(6,7,11,0.42) 0%, rgba(6,7,11,0.04) 36%, rgba(6,7,11,0.1) 66%, rgba(6,7,11,0.82) 100%)' }} />
        <div className="relative h-full flex flex-col justify-between px-6 py-4">
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-bold uppercase tracking-[0.22em] px-2 py-1 rounded" style={{ background: 'rgba(6,7,11,0.6)', color: '#c4b5fd', border: '1px solid rgba(167,139,250,0.35)' }}>
              {tr(kindKey)}
            </span>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {mode === 'update' ? (
              <>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded" style={{ background: 'rgba(6,7,11,0.62)', color: 'rgba(255,255,255,0.78)' }}>v{state?.installedVersion || '?'}</span>
                <ArrowRight size={11} style={{ color: 'rgba(255,255,255,0.65)' }} />
                <span className="text-[10px] font-mono px-2 py-0.5 rounded" style={{ background: c.accent, color: '#0a0a0a' }}>v{state?.appVersion || ''}</span>
              </>
            ) : (
              <span className="text-[10px] font-mono px-2 py-0.5 rounded" style={{ background: c.accent, color: '#0a0a0a' }}>v{state?.appVersion || ''}</span>
            )}
            {need && (
              <span className="flex items-center gap-1.5 text-[10px] font-mono px-2 py-0.5 rounded" style={{ background: 'rgba(6,7,11,0.62)', color: 'rgba(255,255,255,0.78)' }}>
                <HardDrives size={10} />
                {need}
              </span>
            )}
          </div>
        </div>
      </div>

      <main className="flex-1 overflow-y-auto px-6 py-3.5 flex flex-col gap-4">
        {phase === 'error' ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center">
            <Warning size={30} weight="duotone" style={{ color: '#ef4444' }} />
            <span className="text-[13px] font-semibold" style={{ color: c.text }}>{errorText}</span>
            <span className="text-[11px] font-mono" style={{ color: c.faint }}>{state?.error || ''}</span>
          </div>
        ) : phase === 'done' ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center">
            <CheckCircle size={34} weight="duotone" style={{ color: '#22c55e' }} />
            <span className="text-[14px] font-semibold">{mode === 'uninstall' ? tr('installer.removed') : tr('installer.done')}</span>
            <span className="text-[11px]" style={{ color: c.label }}>{mode === 'uninstall' ? tr('installer.uninstallNote') : tr('installer.doneHint')}</span>
          </div>
        ) : installing ? (
          <div className="flex-1 flex flex-col justify-center gap-4">
            <div className="flex items-end justify-between gap-3">
              <span className="text-[11px] font-semibold">{stepLabel}</span>
              <span className="text-[34px] leading-none font-mono tabular-nums" style={{ color: c.accent }}>
                {state?.percent || 0}<span className="text-[16px]" style={{ color: c.faint }}>%</span>
              </span>
            </div>
            <div
              className="pbar-track h-2"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={state?.percent || 0}
              style={{ '--pbar-track': c.input, '--pbar-from': accentBar.from, '--pbar-to': accentBar.to, '--pbar-glow': accentBar.glow }}
            >
              <div className="pbar-fill" style={{ width: `${state?.percent || 0}%` }} />
              <div className="pbar-head" style={{ left: `${state?.percent || 0}%` }} />
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-[10px] font-mono truncate" style={{ color: c.faint }}>{state?.file || ''}</span>
              <span className="text-[10px] font-mono tabular-nums shrink-0" style={{ color: c.label }}>
                {formatBytes(state?.bytesDone || 0)} / {formatBytes(state?.totalBytes || 0)}
              </span>
            </div>
            <div className="flex flex-col gap-2 mt-1">
              <Step c={c} active={state?.step === 'files' || state?.step === 'closing'} done={state?.step !== 'files' && state?.step !== 'closing'} label={tr('installer.step.files')} />
              <Step c={c} active={state?.step === 'shortcuts'} done={state?.step === 'registry' || state?.step === 'done'} label={tr('installer.step.shortcuts')} />
              <Step c={c} active={state?.step === 'registry'} done={state?.step === 'done'} label={tr('installer.step.registry')} />
            </div>
          </div>
        ) : mode === 'uninstall' ? (
          <div className="flex flex-col gap-4">
            <span className="text-[13px] font-semibold">{tr('installer.uninstallConfirm')}</span>
            <span className="text-[11px] leading-relaxed" style={{ color: c.label }}>{tr('installer.uninstallNote')}</span>
            <Row c={c} icon={FolderSimple} label={tr('installer.dest')} value={state?.installDir || ''} />
            <button
              type="button"
              onClick={() => setRemoveData(!removeData)}
              className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-left"
              style={{ background: c.surface, border: `1px solid ${removeData ? '#ef4444' : c.border}` }}
            >
              <span className="w-4 h-4 rounded flex items-center justify-center shrink-0" style={{ background: removeData ? '#ef4444' : 'transparent', border: `1px solid ${removeData ? '#ef4444' : c.border}` }}>
                {removeData && <CheckCircle size={11} weight="fill" style={{ color: '#0a0a0a' }} />}
              </span>
              <span className="text-[11px]" style={{ color: removeData ? c.text : c.label }}>{tr('installer.removeData')}</span>
            </button>
          </div>
        ) : (
          <div className={`flex-1 min-h-0 flex flex-col gap-4${licenseStep ? '' : ' justify-center'}`}>
            <Row
              c={c}
              icon={FolderSimple}
              label={tr('installer.dest')}
              value={state?.installDir || ''}
              action={(
                <button
                  className="no-drag px-2.5 py-1 rounded-md text-[10px] font-semibold shrink-0"
                  style={btn(false)}
                  onClick={async () => {
                    const res = await window.lunarInstaller?.chooseDir()
                    if (res?.ok) setState((prev) => ({ ...prev, installDir: res.dir }))
                  }}
                >
                  {tr('installer.change')}
                </button>
              )}
            />
            <div className="grid grid-cols-3 gap-3">
              <div className="px-3 py-2.5 rounded-lg" style={{ background: c.surface, border: `1px solid ${c.border}` }}>
                <div className="text-[9px] font-semibold uppercase tracking-[0.14em]" style={{ color: c.faint }}>{tr('installer.size')}</div>
                <div className="text-[13px] font-mono tabular-nums mt-1">{need || '—'}</div>
              </div>
              <div className="px-3 py-2.5 rounded-lg" style={{ background: c.surface, border: `1px solid ${c.border}` }}>
                <div className="text-[9px] font-semibold uppercase tracking-[0.14em]" style={{ color: c.faint }}>{tr('installer.freeSpace')}</div>
                <div className="text-[13px] font-mono tabular-nums mt-1">{free || '—'}</div>
              </div>
              <div className="px-3 py-2.5 rounded-lg" style={{ background: c.surface, border: `1px solid ${c.border}` }}>
                <div className="text-[9px] font-semibold uppercase tracking-[0.14em]" style={{ color: c.faint }}>{tr('installer.version')}</div>
                <div className="text-[13px] font-mono tabular-nums mt-1">v{state?.appVersion || ''}</div>
              </div>
            </div>
            <div className="px-3 py-2.5 rounded-lg text-[11px] leading-relaxed" style={{ background: c.surface, border: `1px solid ${c.border}`, color: c.label }}>
              {mode === 'install' ? tr('installer.freshNote') : tr('installer.updateNote')}
            </div>
            {licenseStep && (
              <div className="flex-1 min-h-0 flex flex-col gap-2">
                <div className="flex items-center gap-3">
                  <span className="text-[10px] font-bold uppercase tracking-[0.16em] shrink-0" style={{ color: c.label }}>{tr('installer.license')}</span>
                  <span className="h-px flex-1" style={{ background: c.border }} />
                  <span className="text-[10px] font-mono shrink-0" style={{ color: c.faint }}>{tr('installer.licenseHint')}</span>
                </div>
                <pre
                  className="license-text flex-1 min-h-[64px] text-[10px] leading-[1.55] font-mono whitespace-pre-wrap overflow-y-auto px-3 py-2.5 rounded-lg m-0"
                  style={{ background: c.input, border: `1px solid ${c.border}`, color: c.label }}
                >
                  {state?.license || ''}
                </pre>
                <button
                  type="button"
                  onClick={() => setAgree(!agree)}
                  className="flex items-center gap-2.5 cursor-pointer"
                >
                  <span className="w-4 h-4 rounded flex items-center justify-center shrink-0" style={{ background: agree ? c.accent : 'transparent', border: `1px solid ${agree ? c.accent : c.border}` }}>
                    {agree && <CheckCircle size={11} weight="fill" style={{ color: '#0a0a0a' }} />}
                  </span>
                  <span className="text-[11px] text-left" style={{ color: agree ? c.text : c.label }}>{tr('installer.agree')}</span>
                </button>
              </div>
            )}
          </div>
        )}
      </main>

      <footer className="shrink-0 flex items-center gap-2.5 px-6 h-[68px]" style={{ borderTop: `1px solid ${c.border}` }}>
        <span className="text-[10px] truncate flex-1" style={{ color: c.faint }}>
          {phase === 'error'
            ? ''
            : phase === 'done'
            ? (mode === 'uninstall' ? '' : state?.installDir || '')
            : installing
              ? tr('installer.keepOpen')
              : mode === 'uninstall'
                ? tr('installer.keepData')
                : licenseStep
                  ? tr('installer.updateHint')
                  : tr('installer.readyHint')}
        </span>

        {phase === 'error' ? (
          <>
            <button className="px-3.5 py-2 rounded-lg text-[11px] font-semibold" style={btn(false)} onClick={() => window.lunarInstaller?.quit()}>
              {tr('installer.close')}
            </button>
            <button
              className="px-3.5 py-2 rounded-lg text-[11px] font-semibold flex items-center gap-2"
              style={btn(true)}
              onClick={() => { startedRef.current = false; start() }}
            >
              <ArrowsClockwise size={12} weight="bold" />
              {tr('installer.retry')}
            </button>
          </>
        ) : phase === 'done' ? (
          <>
            <button className="px-3.5 py-2 rounded-lg text-[11px] font-semibold" style={btn(false)} onClick={() => window.lunarInstaller?.quit()}>
              {tr('installer.close')}
            </button>
            {mode !== 'uninstall' && (
              <button className="px-3.5 py-2 rounded-lg text-[11px] font-semibold" style={btn(true)} onClick={() => window.lunarInstaller?.launch()}>
                {tr('installer.open')}
              </button>
            )}
          </>
        ) : installing ? (
          <button className="px-3.5 py-2 rounded-lg text-[11px] font-semibold flex items-center gap-2" style={btn(true)} disabled>
            <CircleNotch size={12} weight="bold" className="animate-spin" />
            {tr('installer.working')}
          </button>
        ) : (
          <>
            <button className="px-3.5 py-2 rounded-lg text-[11px] font-semibold" style={btn(false)} onClick={() => window.lunarInstaller?.quit()}>
              {tr('installer.cancel')}
            </button>
            {mode === 'uninstall' ? (
              <button
                className="px-3.5 py-2 rounded-lg text-[11px] font-semibold flex items-center gap-2"
                style={{ background: '#ef4444', color: '#fff', border: '1px solid #ef4444' }}
                onClick={async () => { setBusy(true); await window.lunarInstaller?.uninstall({ removeData }); setBusy(false) }}
                disabled={busy}
              >
                <Trash size={12} weight="bold" />
                {tr('installer.uninstall')}
              </button>
            ) : (
              <button
                className="px-3.5 py-2 rounded-lg text-[11px] font-semibold flex items-center gap-2 disabled:opacity-40"
                style={btn(true)}
                disabled={!canStart}
                onClick={start}
              >
                <DownloadSimple size={12} weight="bold" />
                {mode === 'update' ? tr('installer.update') : mode === 'repair' ? tr('installer.repair') : tr('installer.install')}
              </button>
            )}
          </>
        )}
      </footer>
    </div>
  )
}
