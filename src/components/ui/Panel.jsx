import { formatBytes } from '../../lib/status'

export function Section({ c, title, hint, action, children }) {
  return (
    <section className="flex flex-col gap-2.5">
      <div className="flex items-center gap-3">
        <h2 className="text-[10px] font-bold uppercase tracking-[0.16em] shrink-0" style={{ color: c.label }}>{title}</h2>
        <span className="h-px flex-1" style={{ background: c.border }} />
        {hint && <span className="text-[10px] font-mono shrink-0" style={{ color: c.faint }}>{hint}</span>}
        {action}
      </div>
      {children}
    </section>
  )
}

export function Card({ c, className = '', children }) {
  return (
    <div className={`rounded-xl ${className}`} style={{ background: c.surface, border: `1px solid ${c.border}` }}>
      {children}
    </div>
  )
}

export function Meter({ c, label, used, total, color }) {
  const pct = total > 0 ? Math.min(100, Math.round((used / total) * 100)) : 0
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: c.label }}>{label}</span>
        <span className="text-[10px] font-mono tabular-nums" style={{ color: c.text }}>
          {formatBytes(used)}<span style={{ color: c.faint }}> / {formatBytes(total)}</span>
        </span>
      </div>
      <div className="h-1.5 rounded-full overflow-hidden" style={{ background: c.input }}>
        <div className="h-full rounded-full transition-[width] duration-500" style={{ width: `${pct}%`, background: color }} />
      </div>
    </div>
  )
}

export function Fact({ c, label, value, mono = true, title }) {
  return (
    <div className="flex items-baseline gap-3 min-w-0">
      <span className="text-[10px] shrink-0 w-[104px]" style={{ color: c.faint }}>{label}</span>
      <span
        className={`text-[11px] truncate ${mono ? 'font-mono' : ''}`}
        style={{ color: c.text }}
        title={title || (typeof value === 'string' ? value : undefined)}
      >
        {value}
      </span>
    </div>
  )
}

export function Skeleton({ c, w = '60%' }) {
  return <span className="inline-block h-2.5 rounded-full" style={{ width: w, background: c.input }} />
}
