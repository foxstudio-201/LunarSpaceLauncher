import { useApp } from '../../i18n/AppContext'

// Port từ src/ui/pages/settings.rs::theme_switch_sized của bản Rust.
const SIZES = {
  lg: { w: 104, h: 44 },
  sm: { w: 74, h: 30 },
}

const STARS = [
  [13, 10, 2],
  [26, 25, 1.5],
  [37, 12, 2],
  [19, 31, 1.5],
  [45, 27, 1],
  [9, 21, 1],
]

export default function ThemeSwitch({ size = 'lg' }) {
  const { theme, setTheme } = useApp()
  const night = theme === 'dark'
  const { w: sw, h: sh } = SIZES[size] || SIZES.lg

  const pad = Math.round(sh * 0.1136)
  const knob = sh - pad * 2
  const travel = sw - pad * 2 - knob
  const s = knob / 34
  const knobLeft = night ? pad + travel : pad

  return (
    <button
      type="button"
      role="switch"
      aria-checked={night}
      aria-label="Chế độ sáng / tối"
      onClick={() => setTheme(night ? 'light' : 'dark')}
      className="relative shrink-0 cursor-pointer overflow-hidden rounded-full"
      style={{
        width: sw,
        height: sh,
        border: 'none',
        padding: 0,
        background: 'linear-gradient(180deg, #5DB7FF 0%, #9ED8FF 100%)',
      }}
    >
      {/* bầu trời đêm */}
      <span
        aria-hidden
        className="absolute inset-0 rounded-full"
        style={{
          background: 'linear-gradient(180deg, #141A3A 0%, #232C5C 100%)',
          opacity: night ? 1 : 0,
          transition: 'opacity 800ms ease',
        }}
      />

      {/* sao */}
      <span
        aria-hidden
        className="absolute inset-0"
        style={{
          opacity: night ? 1 : 0,
          transform: `translateY(${night ? 0 : -14 * s}px)`,
          transition: `opacity 600ms ease, transform 600ms cubic-bezier(0.34, 1.45, 0.64, 1)`,
        }}
      >
        {STARS.map(([x, y, r], index) => (
          <span
            key={index}
            className="xyo-twinkle absolute rounded-full"
            style={{
              left: x * s,
              top: y * s,
              width: r * s,
              height: r * s,
              background: '#ffffff',
              animationDelay: `${index * 0.22}s`,
            }}
          />
        ))}
      </span>

      {/* quầng sáng quanh nút */}
      <span
        aria-hidden
        className="pointer-events-none absolute"
        style={{
          left: knobLeft + knob / 2,
          top: sh / 2,
          transition: `left 900ms cubic-bezier(0.34, 1.45, 0.64, 1)`,
        }}
      >
        {[26, 32, 38].map((diameter) => (
          <span
            key={diameter}
            className="absolute rounded-full"
            style={{
              left: -(diameter * s) / 2,
              top: -(diameter * s) / 2,
              width: diameter * s,
              height: diameter * s,
              background: 'rgba(255,255,255,0.06)',
            }}
          />
        ))}
      </span>

      {/* mây ban ngày */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          opacity: night ? 0 : 1,
          transform: `translateY(${night ? 36 * s : 0}px)`,
          transition: 'opacity 800ms ease, transform 800ms cubic-bezier(0.34, 1.45, 0.64, 1)',
        }}
      >
        {[
          { right: 6, bottom: 6, w: 42, h: 16, color: '#FFFFFF' },
          { right: 24, bottom: 3, w: 30, h: 15, color: '#FFFFFF' },
          { right: 38, bottom: 9, w: 24, h: 13, color: '#FFFFFF' },
          { right: 16, bottom: 0, w: 30, h: 11, color: '#E3F1FF' },
        ].map((cloud, index) => (
          <span
            key={index}
            className="absolute rounded-full"
            style={{
              right: cloud.right * s,
              bottom: cloud.bottom * s,
              width: cloud.w * s,
              height: cloud.h * s,
              background: cloud.color,
            }}
          />
        ))}
      </span>

      {/* nút trượt: mặt trời / mặt trăng */}
      <span
        aria-hidden
        className="absolute overflow-hidden rounded-full"
        style={{
          left: knobLeft,
          top: pad,
          width: knob,
          height: knob,
          background: 'linear-gradient(140deg, #FFF1A8 0%, #F8A91E 100%)',
          transition: `left 900ms cubic-bezier(0.34, 1.45, 0.64, 1)`,
          boxShadow: '0 2px 6px rgba(20, 30, 60, 0.35)',
        }}
      >
        {/* mặt trời: đốm sáng */}
        <span
          className="absolute rounded-full"
          style={{
            left: 4 * s,
            top: 3 * s,
            width: 15 * s,
            height: 15 * s,
            background: 'rgba(255,255,255,0.53)',
            opacity: night ? 0 : 1,
            transition: 'opacity 800ms ease',
          }}
        />
        {/* mặt trăng */}
        <span
          className="absolute inset-0 rounded-full"
          style={{
            background: 'linear-gradient(140deg, #F4F6FB 0%, #A9B0C2 100%)',
            opacity: night ? 1 : 0,
            transform: `translateX(${night ? 0 : knob}px)`,
            transition: 'opacity 800ms ease, transform 800ms cubic-bezier(0.34, 1.45, 0.64, 1)',
          }}
        >
          {[
            [9, 7, 9],
            [20, 18, 6],
            [10, 21, 4],
          ].map(([x, y, d], index) => (
            <span
              key={index}
              className="absolute rounded-full"
              style={{ left: x * s, top: y * s, width: d * s, height: d * s, background: '#A3AABC' }}
            />
          ))}
        </span>
      </span>
    </button>
  )
}
