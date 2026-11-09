import { palette } from '../../lib/palette'

export default function PageHeader({ theme, title, subtitle, children }) {
  const c = palette(theme)
  return (
    <div
      className="xyo-rise xyo-glass shrink-0 sticky top-0 z-20"
      style={{
        background: c.bg === 'transparent' ? 'rgba(10, 12, 16, 0.55)' : `${c.bg}ee`,
        WebkitBackdropFilter: c.bg === 'transparent' ? 'blur(28px) saturate(1.25) brightness(1.04)' : undefined,
        borderBottom: `1px solid ${c.border}`,
        '--d': '.25s',
      }}
    >
      <div className="px-6 py-3.5 flex items-center gap-3">
        <div className="min-w-0">
          <h1 className="text-base font-bold truncate" style={{ color: c.text }}>{title}</h1>
          {subtitle && <p className="text-[11px] truncate" style={{ color: c.label }}>{subtitle}</p>}
        </div>
        <div className="flex-1" />
        {children}
      </div>
    </div>
  )
}
