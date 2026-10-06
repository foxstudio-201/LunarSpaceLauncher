export default function Switch({ checked, onChange, disabled = false, c }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="relative w-10 h-[22px] rounded-full transition-colors shrink-0 disabled:opacity-50"
      style={{ background: checked ? c.accent : c.input, border: `1px solid ${checked ? c.accent : c.border}` }}
    >
      <span
        className="absolute top-[2px] w-4 h-4 rounded-full transition-all duration-200"
        style={{ left: checked ? 20 : 2, background: checked ? '#0a0a0a' : c.label }}
      />
    </button>
  )
}
