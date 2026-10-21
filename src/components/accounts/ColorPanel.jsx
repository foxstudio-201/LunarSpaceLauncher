import { useEffect, useRef, useState } from 'react'
import { palette } from '../../lib/palette'
import { t } from '../../i18n/translations'
import { hexToRgb, hsvToRgb, normalizeHex, rgbToHex, rgbToHsv } from './skinColor'

export const SKIN_COLORS = [
  '#ffffff', '#d9d9d9', '#9a9a9a', '#4a4a4a', '#101010',
  '#f2c9a0', '#d99b6c', '#9c5a34', '#5c3320', '#ffd6b0',
  '#e74c3c', '#f39c12', '#f1c40f', '#2ecc71', '#1abc9c',
  '#3498db', '#9b59b6', '#e84393', '#6d4c41', '#c0392b',
  '#16a085', '#2c3e50', '#95a5a6', '#ecf0f1',
]

const CHECKER = 'repeating-conic-gradient(rgba(128,128,128,0.22) 0% 25%, rgba(128,128,128,0.05) 0% 50%) 0 0 / 10px 10px'

const clamp = (value, min, max) => Math.max(min, Math.min(max, value))

export default function ColorPanel({ theme, lang, color, alpha, recent = [], onChange, onCommit }) {
  const c = palette(theme)
  const squareRef = useRef(null)
  const dragRef = useRef('')
  const [hsv, setHsv] = useState(() => {
    const rgb = hexToRgb(color)
    return rgbToHsv(rgb.r, rgb.g, rgb.b)
  })
  const [hexText, setHexText] = useState(normalizeHex(color) || '#ffffff')
  const emittedRef = useRef(normalizeHex(color) || '#ffffff')
  const hsvRef = useRef(hsv)
  const alphaRef = useRef(alpha)
  hsvRef.current = hsv
  alphaRef.current = alpha

  useEffect(() => {
    const hex = normalizeHex(color) || '#ffffff'
    if (emittedRef.current === hex) return
    emittedRef.current = hex
    const rgb = hexToRgb(hex)
    setHsv(rgbToHsv(rgb.r, rgb.g, rgb.b))
  }, [color])

  useEffect(() => {
    setHexText(normalizeHex(color) || '#ffffff')
  }, [color])

  useEffect(() => {
    const canvas = squareRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    const w = canvas.width
    const h = canvas.height
    const { r, g, b } = hsvToRgb(hsv.h, 1, 1)
    ctx.fillStyle = `rgb(${r}, ${g}, ${b})`
    ctx.fillRect(0, 0, w, h)
    const white = ctx.createLinearGradient(0, 0, w, 0)
    white.addColorStop(0, 'rgba(255,255,255,1)')
    white.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = white
    ctx.fillRect(0, 0, w, h)
    const black = ctx.createLinearGradient(0, 0, 0, h)
    black.addColorStop(0, 'rgba(0,0,0,0)')
    black.addColorStop(1, 'rgba(0,0,0,1)')
    ctx.fillStyle = black
    ctx.fillRect(0, 0, w, h)
  }, [hsv.h])

  const emit = (nextHsv, nextAlpha, commit = false) => {
    const rgb = hsvToRgb(nextHsv.h, nextHsv.s, nextHsv.v)
    const hex = rgbToHex(rgb.r, rgb.g, rgb.b)
    emittedRef.current = hex
    setHsv(nextHsv)
    onChange?.(hex, nextAlpha)
    if (commit) onCommit?.(hex, nextAlpha)
  }

  const pointOf = (event) => {
    const rect = event.currentTarget.getBoundingClientRect()
    return {
      x: clamp((event.clientX - rect.left) / rect.width, 0, 1),
      y: clamp((event.clientY - rect.top) / rect.height, 0, 1),
    }
  }

  const squareAt = (event, commit = false) => {
    const point = pointOf(event)
    emit({ ...hsvRef.current, s: point.x, v: 1 - point.y }, alphaRef.current, commit)
  }

  const hueAt = (event, commit = false) => {
    const point = pointOf(event)
    emit({ ...hsvRef.current, h: point.x * 360 }, alphaRef.current, commit)
  }

  const alphaAt = (event, commit = false) => {
    const point = pointOf(event)
    onChange?.(normalizeHex(color) || '#ffffff', Math.round(point.x * 255))
    if (commit) onCommit?.(normalizeHex(color) || '#ffffff', Math.round(point.x * 255))
  }

  const start = (kind, handler) => (event) => {
    if (event.button !== undefined && event.button !== 0) return
    event.preventDefault()
    event.currentTarget.setPointerCapture?.(event.pointerId)
    dragRef.current = kind
    handler(event, false)
  }

  const move = (kind, handler) => (event) => {
    if (dragRef.current !== kind) return
    handler(event, false)
  }

  const end = (kind, handler) => (event) => {
    if (dragRef.current !== kind) return
    dragRef.current = ''
    handler(event, true)
  }

  const commitHex = () => {
    const hex = normalizeHex(hexText)
    if (!hex) {
      setHexText(normalizeHex(color) || '#ffffff')
      return
    }
    emittedRef.current = hex
    const rgb = hexToRgb(hex)
    setHsv(rgbToHsv(rgb.r, rgb.g, rgb.b))
    onChange?.(hex, alphaRef.current)
    onCommit?.(hex, alphaRef.current)
  }

  const applyExternal = (value) => {
    const hex = normalizeHex(value) || '#ffffff'
    emittedRef.current = hex
    const pixel = hexToRgb(hex)
    setHsv(rgbToHsv(pixel.r, pixel.g, pixel.b))
    onChange?.(hex, 255)
    onCommit?.(hex, 255)
  }

  const rgb = hexToRgb(color)
  const preview = rgbaPreview(rgb, alpha)

  return (
    <aside className="w-full lg:w-[218px] shrink-0 rounded-xl p-3 flex flex-col gap-3" style={{ background: c.surface, border: `1px solid ${c.border}` }}>
      <div className="text-[10px] font-bold uppercase tracking-wide" style={{ color: c.faint }}>{t(lang, 'accounts.skin.color.title')}</div>

      <div
        className="relative rounded-lg overflow-hidden touch-none select-none"
        style={{ aspectRatio: '200 / 132', border: `1px solid ${c.border}`, cursor: 'crosshair' }}
        onPointerDown={start('sv', squareAt)}
        onPointerMove={move('sv', squareAt)}
        onPointerUp={end('sv', squareAt)}
        onPointerCancel={() => { dragRef.current = '' }}
      >
        <canvas ref={squareRef} width={200} height={132} style={{ display: 'block', width: '100%', height: '100%' }} />
        <span
          className="absolute w-3.5 h-3.5 rounded-full pointer-events-none"
          style={{
            left: `clamp(7px, ${hsv.s * 100}%, calc(100% - 7px))`,
            top: `clamp(7px, ${(1 - hsv.v) * 100}%, calc(100% - 7px))`,
            transform: 'translate(-50%, -50%)',
            border: '2px solid #fff',
            boxShadow: '0 0 0 1px rgba(0,0,0,0.6)',
            background: color,
          }}
        />
      </div>

      <div>
        <div className="text-[9px] font-bold uppercase tracking-wide mb-1" style={{ color: c.faint }}>{t(lang, 'accounts.skin.color.hue')}</div>
        <div
          className="relative h-3 rounded-full touch-none select-none"
          style={{ background: 'linear-gradient(90deg, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00)', border: `1px solid ${c.border}`, cursor: 'pointer' }}
          onPointerDown={start('hue', hueAt)}
          onPointerMove={move('hue', hueAt)}
          onPointerUp={end('hue', hueAt)}
          onPointerCancel={() => { dragRef.current = '' }}
        >
          <span
            className="absolute w-3 h-3 rounded-full pointer-events-none"
            style={{ left: `clamp(6px, ${(hsv.h / 360) * 100}%, calc(100% - 6px))`, top: 6, transform: 'translate(-50%, -50%)', background: '#fff', border: '1px solid rgba(0,0,0,0.5)' }}
          />
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between mb-1">
          <span className="text-[9px] font-bold uppercase tracking-wide" style={{ color: c.faint }}>{t(lang, 'accounts.skin.color.alpha')}</span>
          <span className="text-[9px] font-mono" style={{ color: c.label }}>{Math.round((alpha / 255) * 100)}%</span>
        </div>
        <div
          className="relative h-3 rounded-full touch-none select-none"
          style={{ ...checkerBackground, border: `1px solid ${c.border}`, cursor: 'pointer' }}
          onPointerDown={start('alpha', alphaAt)}
          onPointerMove={move('alpha', alphaAt)}
          onPointerUp={end('alpha', alphaAt)}
          onPointerCancel={() => { dragRef.current = '' }}
        >
          <span className="absolute inset-0 rounded-full" style={{ background: `linear-gradient(90deg, rgba(${rgb.r},${rgb.g},${rgb.b},0), rgb(${rgb.r},${rgb.g},${rgb.b}))` }} />
          <span
            className="absolute w-3 h-3 rounded-full pointer-events-none"
            style={{ left: `clamp(6px, ${(alpha / 255) * 100}%, calc(100% - 6px))`, top: 6, transform: 'translate(-50%, -50%)', background: '#fff', border: '1px solid rgba(0,0,0,0.5)' }}
          />
        </div>
      </div>

      <div className="flex items-center gap-2">
        <span className="w-9 h-9 rounded-lg shrink-0" style={{ ...checkerBackground, border: `1px solid ${c.border}` }}>
          <span className="block w-full h-full rounded-lg" style={{ background: preview }} />
        </span>
        <input
          data-color-hex="1"
          value={hexText}
          onChange={(event) => setHexText(event.target.value)}
          onBlur={commitHex}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.currentTarget.blur()
            if (event.key === 'Escape') {
              setHexText(normalizeHex(color) || '#ffffff')
              event.currentTarget.blur()
            }
          }}
          spellCheck={false}
          className="min-w-0 flex-1 h-8 rounded-lg px-2 text-[11px] font-mono outline-none"
          style={{ background: c.input, color: c.text, border: `1px solid ${c.border}` }}
        />
      </div>

      <div className="grid grid-cols-8 gap-1.5">
        {SKIN_COLORS.map((item) => (
          <button
            key={item}
            type="button"
            title={item}
            onClick={() => applyExternal(item)}
            className="aspect-square rounded-[4px]"
            style={{
              background: item,
              border: normalizeHex(color) === item ? `2px solid ${c.accent}` : `1px solid ${c.border}`,
            }}
          />
        ))}
      </div>

      {recent.length > 0 && (
        <div>
          <div className="text-[9px] font-bold uppercase tracking-wide mb-1" style={{ color: c.faint }}>{t(lang, 'accounts.skin.color.recent')}</div>
          <div className="flex flex-wrap gap-1.5">
            {recent.map((item) => (
              <button
                key={item}
                type="button"
                title={item}
                onClick={() => applyExternal(item)}
                className="w-5 h-5 rounded-[4px]"
                style={{ background: item, border: normalizeHex(color) === item ? `2px solid ${c.accent}` : `1px solid ${c.border}` }}
              />
            ))}
          </div>
        </div>
      )}
    </aside>
  )
}

const checkerBackground = {
  backgroundImage: CHECKER,
}

function rgbaPreview(rgb, alpha) {
  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${Math.max(0, Math.min(255, alpha)) / 255})`
}
