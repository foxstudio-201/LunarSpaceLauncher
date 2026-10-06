import { useApp } from '../i18n/AppContext'

export default function TitleBar() {
  const { theme } = useApp()
  const isDark = theme !== 'light'

  const textColor = isDark ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.5)'
  const textHover = isDark ? 'rgba(255,255,255,0.9)' : 'rgba(0,0,0,0.9)'
  const hoverBg = isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)'
  const closeHoverBg = 'rgba(239,68,68,0.8)'

  const handleMinimize = () => window.electronAPI?.minimizeWindow?.()
  const handleClose = () => window.electronAPI?.closeWindow?.()

  return (
    <div className="drag-region flex items-center justify-end h-11 px-4 fixed top-0 left-0 right-0" style={{ zIndex: 9999 }}>
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
