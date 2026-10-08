import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { CaretDown, Check } from '@phosphor-icons/react'
import { palette } from '../../lib/palette'

const PANEL_MAX = 260
const GAP = 6

const SIZES = {
  md: { trigger: 'h-9 px-2.5', label: 'text-[11px]', row: 'h-9 px-2.5', rowText: 'text-[11px]', icon: 16, caret: 12, max: 260 },
  lg: { trigger: 'h-10 px-3', label: 'text-[13px]', row: 'h-11 px-3', rowText: 'text-[13px]', icon: 20, caret: 14, max: 300, minPanel: 240 },
}

export default function Select({ theme, value, options = [], onChange, placeholder = '—', disabled = false, badgeLabel, size = 'md', direction = 'auto' }) {
  const c = palette(theme)
  const scale = SIZES[size] || SIZES.md
  const [open, setOpen] = useState(false)
  const [rect, setRect] = useState(null)
  const [flip, setFlip] = useState(false)
  const [active, setActive] = useState(0)
  const triggerRef = useRef(null)
  const panelRef = useRef(null)

  const selected = options.findIndex((o) => o.value === value)

  const place = useCallback(() => {
    const el = triggerRef.current
    if (!el) return
    const box = el.getBoundingClientRect()
    setRect(box)
    setFlip(direction === 'down' ? false : window.innerHeight - box.bottom < scale.max + GAP + 20)
  }, [direction, scale.max])

  const close = useCallback(() => setOpen(false), [])

  useEffect(() => {
    if (!open) return undefined
    place()
    const onScroll = () => place()
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onScroll)
    return () => {
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onScroll)
    }
  }, [open, place])

  useEffect(() => {
    if (open) setActive(selected >= 0 ? selected : 0)
  }, [open])

  useEffect(() => {
    if (!open) return undefined
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        close()
        return
      }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        setActive((i) => (e.key === 'ArrowDown' ? Math.min(options.length - 1, i + 1) : Math.max(0, i - 1)))
        return
      }
      if (e.key === 'Enter') {
        e.preventDefault()
        const option = options[active]
        if (option) {
          onChange(option.value)
          close()
        }
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, active, options, onChange, close])

  useEffect(() => {
    if (!open || !panelRef.current) return
    const row = panelRef.current.querySelector(`[data-row="${active}"]`)
    if (row) row.scrollIntoView({ block: 'nearest' })
  }, [open, active])

  const selectedOption = selected >= 0 ? options[selected] : null
  const label = selectedOption ? selectedOption.label : placeholder
  const panel = rect && open && (
    <>
      <div className="fixed inset-0" style={{ zIndex: 9998 }} onClick={close} />
      <div
        ref={panelRef}
        className="select-panel fixed overflow-y-auto"
        style={{
          left: rect.left,
          width: scale.minPanel ? Math.max(rect.width, scale.minPanel) : rect.width,
          zIndex: 9999,
          ...(flip
            ? { bottom: window.innerHeight - rect.top + GAP, maxHeight: scale.max }
            : { top: rect.bottom + GAP, maxHeight: scale.max }),
          background: c.surface,
          border: `1px solid ${c.border}`,
          borderRadius: 10,
          boxShadow: '0 16px 40px rgba(0,0,0,0.45), 0 0 0 1px rgba(167,139,250,0.06)',
        }}
      >
        {options.map((option, i) => {
          const isSelected = option.value === value
          const isActive = i === active
          return (
            <button
              key={option.value}
              type="button"
              data-row={i}
              onMouseEnter={() => setActive(i)}
              onClick={() => { onChange(option.value); close() }}
              className={`group relative w-full flex items-center gap-2.5 text-left ${scale.row}`}
              style={{
                background: isSelected ? 'rgba(167,139,250,0.13)' : isActive ? c.hover : 'transparent',
                color: isSelected ? c.accent : c.text,
              }}
            >
              {isActive && !isSelected && (
                <span className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 rounded-full" style={{ height: 16, background: c.accent }} />
              )}
              {option.tone && (
                <span
                  className="rounded-[3px] shrink-0"
                  style={{ width: 12, height: 12, background: `${option.tone}33`, border: `2px solid ${option.tone}` }}
                />
              )}
              {option.node && <span className="shrink-0 inline-flex" style={{ color: option.tone || c.label }}>{option.node}</span>}
              {option.icon && (
                <img src={option.icon} alt="" className="rounded object-contain shrink-0" style={{ width: scale.icon, height: scale.icon }} />
              )}
              <span className={`font-mono truncate flex-1 ${scale.rowText}`}>{option.label}</span>
              {option.hint && (
                <span className="text-[10px] font-mono shrink-0" style={{ color: c.faint }}>{option.hint}</span>
              )}
              {(option.tags || (option.badge ? [option.badge] : [])).map((tag) => (
                <span
                  key={tag}
                  className="px-1.5 py-0.5 rounded text-[10px] font-bold shrink-0 uppercase"
                  style={{
                    background: tag === 'latest' ? 'rgba(167,139,250,0.16)' : c.input,
                    color: tag === 'latest' ? c.accent : c.label,
                  }}
                >
                  {tag}
                </span>
              ))}
              {isSelected && <Check size={scale.caret + 2} weight="bold" className="shrink-0" style={{ color: c.accent }} />}
            </button>
          )
        })}
      </div>
    </>
  )

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={`w-full rounded-lg flex items-center gap-2.5 text-left transition-colors disabled:opacity-50 ${scale.trigger}`}
        style={{ background: c.input, border: `1px solid ${open ? 'rgba(167,139,250,0.42)' : c.border}`, color: c.text }}
      >
        {selectedOption?.tone && (
          <span
            className="rounded-[3px] shrink-0"
            style={{ width: 12, height: 12, background: `${selectedOption.tone}33`, border: `2px solid ${selectedOption.tone}` }}
          />
        )}
        {selectedOption?.node && <span className="shrink-0 inline-flex" style={{ color: selectedOption.tone || c.label }}>{selectedOption.node}</span>}
        {selectedOption?.icon && (
          <img src={selectedOption.icon} alt="" className="rounded object-contain shrink-0" style={{ width: scale.icon, height: scale.icon }} />
        )}
        <span className={`font-mono truncate flex-1 ${scale.label}`}>{label}</span>
        {badgeLabel && (
          <span className="px-1.5 py-0.5 rounded text-[10px] font-bold shrink-0" style={{ background: c.surface, color: c.label }}>
            {badgeLabel}
          </span>
        )}
        <CaretDown
          size={scale.caret}
          weight="bold"
          className="shrink-0 transition-transform duration-200"
          style={{ color: c.label, transform: open ? 'rotate(180deg)' : 'none' }}
        />
      </button>
      {panel && createPortal(panel, document.body)}
    </>
  )
}
