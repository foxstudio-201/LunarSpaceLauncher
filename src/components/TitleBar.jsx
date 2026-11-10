import { useEffect, useState } from 'react'
import { palette } from '../lib/palette'
import { useApp } from '../i18n/AppContext'

// Bố cục theo titlebar của bản Rust: icon + tên 2 dòng bên trái, 3 nút điều khiển bên phải.
export default function TitleBar() {
  const { theme } = useApp()
  const c = palette(theme)
  const [maximized, setMaximized] = useState(false)

  useEffect(() => {
    let alive = true
    window.electronAPI?.isMaximized?.().then((value) => {
      if (alive && typeof value === 'boolean') setMaximized(value)
    }).catch(() => {})
    const off = window.electronAPI?.onMaximizedChange?.((value) => setMaximized(!!value))
    return () => {
      alive = false
      off?.()
    }
  }, [])

  const minimize = () => window.electronAPI?.minimizeWindow?.()
  const toggleMax = () => window.electronAPI?.maximizeWindow?.()
  const close = () => window.electronAPI?.closeWindow?.()

  return (
    <div
      className="xyo-titlebar drag-region fixed top-0 left-0 right-0 z-[9999] flex h-11 items-center"
      style={{ background: c.bg, borderBottom: `1px solid ${c.borderSoft}` }}
      onDoubleClick={toggleMax}
    >
      <div className="flex h-full flex-1 items-center gap-[10px] pl-4">
        <img
          src="./icon.png"
          alt=""
          aria-hidden
          draggable={false}
          className="h-7 w-7 rounded-[7px] object-cover"
        />
        <div className="flex flex-col justify-center leading-none">
          <span className="text-[13px] font-semibold" style={{ color: c.text }}>XyoLauncher</span>
          <span className="mt-[3px] text-[8.5px] font-medium tracking-[0.14em]" style={{ color: c.faint }}>LAUNCHER</span>
        </div>
      </div>

      <div className="no-drag flex items-center gap-[2px] pr-2">
        <button
          type="button"
          onClick={minimize}
          aria-label="Thu nhỏ"
          data-tip="Thu nhỏ"
          className="flex h-7 w-[38px] items-center justify-center rounded-md transition-colors"
          style={{ color: c.muted || c.label }}
          onMouseEnter={(e) => { e.currentTarget.style.background = c.hover; e.currentTarget.style.color = c.text }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = c.muted || c.label }}
        >
          <svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
            <line x1="2.5" y1="6.5" x2="10.5" y2="6.5" />
          </svg>
        </button>

        <button
          type="button"
          onClick={toggleMax}
          aria-label={maximized ? 'Thu nhỏ cửa sổ' : 'Phóng to'}
          data-tip={maximized ? 'Thu nhỏ cửa sổ' : 'Phóng to'}
          className="flex h-7 w-[38px] items-center justify-center rounded-md transition-colors"
          style={{ color: c.muted || c.label }}
          onMouseEnter={(e) => { e.currentTarget.style.background = c.hover; e.currentTarget.style.color = c.text }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = c.muted || c.label }}
        >
          {maximized ? (
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round">
              <rect x="1.2" y="3.2" width="7.4" height="7.4" rx="1.4" />
              <path d="M4 3.2V2.4A1.2 1.2 0 0 1 5.2 1.2h5.4a1.2 1.2 0 0 1 1.2 1.2v5.4A1.2 1.2 0 0 1 10.6 9h-.8" />
            </svg>
          ) : (
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round">
              <rect x="2" y="2" width="8" height="8" rx="1.6" />
            </svg>
          )}
        </button>

        <button
          type="button"
          onClick={close}
          aria-label="Đóng"
          data-tip="Đóng"
          className="flex h-7 w-[38px] items-center justify-center rounded-md transition-colors"
          style={{ color: c.muted || c.label }}
          onMouseEnter={(e) => { e.currentTarget.style.background = c.bad; e.currentTarget.style.color = '#ffffff' }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = c.muted || c.label }}
        >
          <svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
            <line x1="3" y1="3" x2="10" y2="10" />
            <line x1="10" y1="3" x2="3" y2="10" />
          </svg>
        </button>
      </div>
    </div>
  )
}
