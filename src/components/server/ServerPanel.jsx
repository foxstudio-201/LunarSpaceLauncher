import { useState, useEffect } from 'react'
import ConsolePage from './ConsolePage'
import OverviewPage from './OverviewPage'
import FileManagerPage from './FileManagerPage'
import DatabasePage from './DatabasePage'
import SchedulePage from './SchedulePage'
import UserPage from './UserPage'
import BackupPage from './BackupPage'
import NetworkPage from './NetworkPage'
import StartupPage from './StartupPage'
import ServerSettingsPage from './ServerSettingsPage'
import { t } from '../../i18n/translations'

function InstallingOverlay({ theme, lang, progress, message }) {
  const textColor = theme === 'light' ? '#111' : '#fff'
  const labelColor = theme === 'light' ? '#555' : 'rgba(255,255,255,0.6)'
  const pct = Math.max(0, Math.min(100, progress ?? 0))
  return (
    <div className="absolute inset-0 z-50 flex flex-col items-center justify-center gap-4 backdrop-blur-sm" style={{ background: theme === 'light' ? 'rgba(245,245,245,0.92)' : 'rgba(10,10,10,0.92)' }}>
      <svg className="w-10 h-10 animate-spin" viewBox="0 0 50 50">
        <circle cx="25" cy="25" r="20" fill="none" stroke={theme === 'light' ? 'rgba(0,0,0,0.1)' : 'rgba(255,255,255,0.1)'} strokeWidth="4" />
        <path d="M25 5 A20 20 0 0 1 45 25" fill="none" stroke="#a78bfa" strokeWidth="4" strokeLinecap="round" />
      </svg>
      <p className="text-sm font-bold" style={{ color: textColor }}>{t(lang, 'install.wait')}</p>
      <p className="text-[11px] max-w-xs text-center" style={{ color: labelColor }}>{t(lang, 'install.pleaseWait')}</p>
      <div className="w-64 max-w-[80vw]">
        <div className="w-full h-1.5 rounded-full overflow-hidden" style={{ background: theme === 'light' ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.1)' }}>
          <div className="h-full rounded-full transition-all duration-300" style={{ width: `${pct}%`, background: '#a78bfa' }} />
        </div>
        <div className="flex justify-between mt-1.5">
          <span className="text-[10px]" style={{ color: labelColor }}>{message || ''}</span>
          <span className="text-[10px] font-semibold" style={{ color: '#a78bfa' }}>{pct}%</span>
        </div>
      </div>
    </div>
  )
}

export default function ServerPanel({ server, theme, lang, displayPage, onBack, onServerDeleted, onServerUpdate }) {
  const props = { server, theme, lang, onServerUpdate }
  const [installProgress, setInstallProgress] = useState({ percent: server?.installProgress ?? 0, message: server?.installMessage || '' })

  useEffect(() => {
    setInstallProgress({ percent: server?.installProgress ?? 0, message: server?.installMessage || '' })
  }, [server?.id, server?.installProgress, server?.installMessage])

  useEffect(() => {
    if (!window.electronAPI?.onServerProgress || !server?.id) return
    const cleanup = window.electronAPI.onServerProgress(({ serverId, percent, message }) => {
      if (serverId !== server.id) return
      setInstallProgress({ percent, message })
      if (percent >= 100 && typeof onServerUpdate === 'function') {
        setTimeout(async () => {
          try {
            const res = await window.electronAPI.getServerConfig(serverId)
            if (res?.ok && res.server) onServerUpdate(res.server)
          } catch {}
        }, 1200)
      }
    })
    return () => { if (typeof cleanup === 'function') cleanup() }
  }, [server?.id, onServerUpdate])

  const showOverlay = server?.status === 'installing'

  const pageKey = server?.id || 'none'
  let page
  switch (displayPage) {
    case 'server-overview': page = <OverviewPage key={`overview-${pageKey}`} {...props} />; break
    case 'server-console': page = <ConsolePage key={`console-${pageKey}`} {...props} />; break
    case 'server-files': page = <FileManagerPage key={`files-${pageKey}`} {...props} />; break
    case 'server-databases': page = <DatabasePage key={`db-${pageKey}`} {...props} />; break
    case 'server-schedules': page = <SchedulePage key={`sched-${pageKey}`} {...props} />; break
    case 'server-users': page = <UserPage key={`users-${pageKey}`} {...props} />; break
    case 'server-backups': page = <BackupPage key={`backup-${pageKey}`} {...props} />; break
    case 'server-network': page = <NetworkPage key={`net-${pageKey}`} {...props} />; break
    case 'server-startup': page = <StartupPage key={`startup-${pageKey}`} {...props} />; break
    case 'server-settings': page = <ServerSettingsPage key={`settings-${pageKey}`} {...props} onBack={onBack} onServerDeleted={onServerDeleted} />; break
    default: page = <OverviewPage key={`overview-${pageKey}`} {...props} />
  }

  if (showOverlay && displayPage !== 'server-console') {
    return (
      <div className="relative h-full">
        <div className="absolute inset-0 pointer-events-none opacity-0" aria-hidden>{page}</div>
        <InstallingOverlay theme={theme} lang={lang} progress={installProgress.percent} message={installProgress.message} />
      </div>
    )
  }

  return page
}
