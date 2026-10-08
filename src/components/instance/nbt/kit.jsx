import { useEffect, useState } from 'react'
import { CaretDown, CaretRight } from '@phosphor-icons/react'
import { TYPE_TONE, typeLabel, num } from '../../../lib/nbt'
import Select from '../../ui/Select'

export function TypeChip({ type, size = 10 }) {
  const tone = TYPE_TONE[type] || 'var(--c-label)'
  return (
    <span
      className="h-[18px] px-1.5 rounded font-bold uppercase tracking-wide shrink-0 inline-flex items-center font-mono"
      style={{ background: `${tone}1f`, color: tone, fontSize: size }}
    >
      {type === 'compound' ? '{}' : type === 'list' ? '[]' : typeLabel(type)}
    </span>
  )
}

export function Section({ c, title, icon: Icon, right, children, defaultOpen = true }) {
  const [on, setOn] = useState(defaultOpen)
  return (
    <div className="rounded-lg overflow-hidden" style={{ background: c.input, border: `1px solid ${c.border}` }}>
      <button
        onClick={() => setOn((prev) => !prev)}
        className="w-full flex items-center gap-2 px-3 h-9"
        style={{ borderBottom: on ? `1px solid ${c.border}` : '1px solid transparent' }}
      >
        {on ? <CaretDown size={12} weight="bold" style={{ color: c.faint }} /> : <CaretRight size={12} weight="bold" style={{ color: c.faint }} />}
        {Icon ? <Icon size={15} weight="duotone" style={{ color: c.accent }} /> : null}
        <span className="text-[11px] font-bold uppercase tracking-wider" style={{ color: c.label }}>{title}</span>
        <span className="flex-1" />
        {right}
      </button>
      {on ? <div className="p-3 flex flex-col gap-2.5">{children}</div> : null}
    </div>
  )
}

export function Field({ c, label, hint, children, right }) {
  return (
    <label className="flex flex-col gap-1.5 min-w-0">
      <span className="flex items-center gap-1.5">
        <span className="text-[10.5px] font-bold uppercase tracking-wider truncate" style={{ color: c.faint }}>{label}</span>
        <span className="flex-1" />
        {right}
      </span>
      {children}
      {hint ? <span className="text-[10px] leading-snug" style={{ color: c.faint }}>{hint}</span> : null}
    </label>
  )
}

const inputStyle = (c) => ({
  background: c.surface,
  border: `1px solid ${c.border}`,
  color: c.text,
})

export function TextField({ c, value, onChange, placeholder, mono = true, disabled, onBlur, title, ariaLabel }) {
  return (
    <input
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value)}
      onBlur={onBlur}
      onWheel={(e) => e.currentTarget.blur()}
      placeholder={placeholder}
      disabled={disabled}
      title={title}
      aria-label={ariaLabel}
      spellCheck={false}
      className={`h-8 px-2.5 rounded-md text-[12.5px] outline-none w-full disabled:opacity-50 ${mono ? 'font-mono' : ''}`}
      style={inputStyle(c)}
    />
  )
}

export function NumField({ c, value, onChange, min, max, step = 1, disabled, ariaLabel }) {
  const [text, setText] = useState(String(value ?? ''))
  useEffect(() => setText(String(value ?? '')), [value])
  const commit = () => {
    const parsed = Number(text)
    if (!Number.isFinite(parsed)) {
      setText(String(value ?? ''))
      return
    }
    const next = Math.max(min ?? -Infinity, Math.min(max ?? Infinity, parsed))
    setText(String(next))
    if (next !== num(value)) onChange(next)
  }
  return (
    <div className="flex items-center gap-1 min-w-0">
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onWheel={(e) => e.currentTarget.blur()}
        onKeyDown={(e) => { if (e.key === 'Enter') commit() }}
        disabled={disabled}
        inputMode="decimal"
        aria-label={ariaLabel}
        spellCheck={false}
        className="h-8 px-2.5 rounded-md text-[12.5px] font-mono outline-none w-full disabled:opacity-50"
        style={inputStyle(c)}
      />
      {step ? (
        <span className="flex flex-col shrink-0">
          <button
            onClick={() => onChange(Math.min(max ?? Infinity, num(value) + step))}
            className="h-[16px] w-[18px] flex items-center justify-center text-[9px] leading-none rounded-t"
            style={{ background: c.surface, border: `1px solid ${c.border}`, color: c.label }}
          >
            ▲
          </button>
          <button
            onClick={() => onChange(Math.max(min ?? -Infinity, num(value) - step))}
            className="h-[16px] w-[18px] flex items-center justify-center text-[9px] leading-none rounded-b"
            style={{ background: c.surface, border: `1px solid ${c.border}`, borderTop: 'none', color: c.label }}
          >
            ▼
          </button>
        </span>
      ) : null}
    </div>
  )
}

export function Drop({ c, theme, value, onChange, options, disabled, placeholder, down }) {
  return (
    <Select
      theme={theme}
      size="lg"
      value={value}
      onChange={onChange}
      options={options}
      disabled={disabled}
      placeholder={placeholder}
      direction={down ? 'down' : 'auto'}
    />
  )
}

export function Toggle({ c, on, label, icon: Icon, onClick, tone, disabled, title }) {
  const color = tone || c.accent
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className="h-8 rounded-md text-[11.5px] font-semibold flex items-center gap-2 px-2.5 min-w-0 disabled:opacity-40"
      style={{
        background: on ? `${color}1f` : c.surface,
        border: `1px solid ${on ? `${color}55` : c.border}`,
        color: on ? color : c.label,
      }}
    >
      {Icon ? <Icon size={14} weight="duotone" className="shrink-0" /> : null}
      <span className="truncate">{label}</span>
    </button>
  )
}

export function Btn({ c, children, onClick, tone = 'ghost', icon: Icon, disabled, title, wide, size = 'md' }) {
  const tones = {
    ghost: { background: c.surface, border: `1px solid ${c.border}`, color: c.label },
    accent: { background: c.accent, border: `1px solid ${c.accent}`, color: c.ink },
    danger: { background: 'rgba(239,68,68,0.14)', border: '1px solid rgba(239,68,68,0.35)', color: '#f87171' },
    warn: { background: 'rgba(251,191,36,0.14)', border: '1px solid rgba(251,191,36,0.35)', color: '#fbbf24' },
    ok: { background: 'rgba(34,197,94,0.14)', border: '1px solid rgba(34,197,94,0.35)', color: '#4ade80' },
  }
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`rounded-md font-semibold inline-flex items-center justify-center gap-1.5 disabled:opacity-40 ${wide ? 'w-full' : ''} ${size === 'sm' ? 'h-7 px-2.5 text-[11px]' : 'h-8 px-3 text-[11.5px]'}`}
      style={tones[tone] || tones.ghost}
    >
      {Icon ? <Icon size={size === 'sm' ? 12 : 14} weight="duotone" className="shrink-0" /> : null}
      <span className="truncate">{children}</span>
    </button>
  )
}

export function Note({ c, tone = 'info', children, icon: Icon }) {
  const tones = {
    info: { background: `${c.accent}12`, border: `1px solid ${c.accent}30`, color: c.label },
    ok: { background: 'rgba(34,197,94,0.10)', border: '1px solid rgba(34,197,94,0.30)', color: '#4ade80' },
    bad: { background: 'rgba(239,68,68,0.10)', border: '1px solid rgba(239,68,68,0.30)', color: '#f87171' },
    warn: { background: 'rgba(251,191,36,0.10)', border: '1px solid rgba(251,191,36,0.30)', color: '#fbbf24' },
  }
  return (
    <div className="px-2.5 py-2 rounded-md flex items-start gap-2" style={tones[tone]}>
      {Icon ? <Icon size={13} weight="duotone" className="mt-[1px] shrink-0" /> : null}
      <span className="text-[11px] leading-relaxed">{children}</span>
    </div>
  )
}

export function Grid({ cols = 2, children }) {
  return <div className="grid gap-2.5" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>{children}</div>
}

export function KeyHint({ c, children }) {
  return (
    <span className="text-[10px] font-mono px-1.5 py-0.5 rounded" style={{ background: c.surface, border: `1px solid ${c.border}`, color: c.faint }}>
      {children}
    </span>
  )
}

export function Empty({ c, children }) {
  return <p className="text-[11px] font-mono leading-relaxed py-1" style={{ color: c.faint }}>{children}</p>
}

export const toneDot = (color) => (
  <span className="rounded-sm shrink-0" style={{ width: 10, height: 10, background: `${color}33`, border: `1.5px solid ${color}` }} />
)
