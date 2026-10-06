import { Cpu, Memory, Cube, Pulse } from '@phosphor-icons/react'
import { useApp } from '../i18n/AppContext'
import { t } from '../i18n/translations'
import { statusColor, statusKey, formatBytes } from '../lib/status'
import { palette } from '../lib/palette'

function StatusDot({ color }) {
  return (
    <span className="relative flex h-2 w-2 shrink-0">
      <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75" style={{ background: color }} />
      <span className="relative inline-flex rounded-full h-2 w-2" style={{ background: color }} />
    </span>
  )
}

export default function TitleBar({ version, instance, system }) {
  const { lang, theme } = useApp()
  const c = palette(theme)
  const isDark = theme !== 'light'

  const textColor = isDark ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.5)'
  const textHover = isDark ? 'rgba(255,255,255,0.9)' : 'rgba(0,0,0,0.9)'
  const hoverBg = isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)'
  const closeHoverBg = 'rgba(239,68,68,0.8)'
  const statBg = c.input
  const statBorder = c.border

  const ramUsed = system ? system.totalMem - system.freeMem : 0
  const cpuColor = '#3b82f6'
  const ramColor = '#a78bfa'
  const instColor = statusColor(instance?.status)

  const handleMinimize = () => window.electronAPI?.minimizeWindow?.()
  const handleClose = () => window.electronAPI?.closeWindow?.()

  const chip = { background: statBg, border: `1px solid ${statBorder}` }

  return (
    <div className="drag-region flex items-center justify-between h-11 px-4 fixed top-0 left-0 right-0" style={{ zIndex: 9999 }}>
      <div className="flex items-center gap-3 no-drag" style={{ marginLeft: '72px' }} />

      <div className="absolute left-1/2 -translate-x-1/2 no-drag flex items-center gap-2 whitespace-nowrap">
        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg shrink-0" style={chip}>
          <StatusDot color="#22c55e" />
          <Cube size={12} weight="duotone" style={{ color: '#22c55e' }} />
          <span className="text-[10px] font-medium brand-pixel" style={{ color: '#22c55e' }}>
            LunarSpace
          </span>
        </div>

        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg shrink-0" style={chip}>
          <Pulse size={12} style={{ color: cpuColor }} />
          <span className="text-[10px] font-medium" style={{ color: cpuColor }}>
            {version ? `v${version}` : '—'}
          </span>
        </div>

        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg shrink-0" style={chip}>
          <Cpu size={12} weight="duotone" style={{ color: cpuColor }} />
          <span className="text-[10px] font-medium" style={{ color: isDark ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.65)' }}>
            {system ? `${system.cpuThreads} ${lang === 'vi' ? 'nhân' : 'cores'}` : '—'}
          </span>
        </div>

        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg shrink-0" style={chip}>
          <Memory size={12} weight="duotone" style={{ color: ramColor }} />
          <span className="text-[10px] font-medium" style={{ color: isDark ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.65)' }}>
            {system ? `${formatBytes(ramUsed)} / ${formatBytes(system.totalMem)}` : '—'}
          </span>
        </div>

        {instance && (
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg shrink-0" style={chip}>
            <span className="w-1.5 h-1.5 rounded-full" style={{ background: instColor }} />
            <span className="text-[10px] font-medium max-w-[140px] truncate" style={{ color: isDark ? 'rgba(255,255,255,0.75)' : 'rgba(0,0,0,0.7)' }}>
              {instance.name}
            </span>
            {instance.version && (
              <span className="text-[10px] font-mono" style={{ color: isDark ? 'rgba(255,255,255,0.45)' : 'rgba(0,0,0,0.45)' }}>
                {instance.version}
              </span>
            )}
            <span className="text-[10px] font-semibold" style={{ color: instColor }}>
              {t(lang, statusKey(instance.status))}
            </span>
          </div>
        )}
      </div>

      <div className="no-drag flex items-center gap-1">
        <button
          onClick={handleMinimize}
          data-tip="Minimize"
          className="w-8 h-7 flex items-center justify-center rounded transition-colors"
          style={{ color: textColor }}
          onMouseEnter={(e) => { e.currentTarget.style.color = textHover; e.currentTarget.style.background = hoverBg }}
          onMouseLeave={(e) => { e.currentTarget.style.color = textColor; e.currentTarget.style.background = 'transparent' }}
        >
          <svg width="10" height="1" viewBox="0 0 10 1" fill="currentColor"><rect width="10" height="1" /></svg>
        </button>
        <button
          onClick={handleClose}
          data-tip="Close"
          className="w-8 h-7 flex items-center justify-center rounded transition-colors"
          style={{ color: textColor }}
          onMouseEnter={(e) => { e.currentTarget.style.color = '#fff'; e.currentTarget.style.background = closeHoverBg }}
          onMouseLeave={(e) => { e.currentTarget.style.color = textColor; e.currentTarget.style.background = 'transparent' }}
        >
          <svg width="10" height="10" viewBox="0 0 10 10" stroke="currentColor" strokeWidth="1.5">
            <line x1="0" y1="0" x2="10" y2="10" />
            <line x1="10" y1="0" x2="0" y2="10" />
          </svg>
        </button>
      </div>
    </div>
  )
}
