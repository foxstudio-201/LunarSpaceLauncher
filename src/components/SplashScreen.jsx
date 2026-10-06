import { useLayoutEffect } from 'react'
import { LOGO_ROWS } from '../lib/asciiLogo'

const STATUS = {
  boot: { vi: 'Đang khởi động…', en: 'Starting…' },
  versions: { vi: 'Đang tải phiên bản…', en: 'Loading versions…' },
  ready: { vi: 'Sẵn sàng', en: 'Ready' },
}

const SUBTITLE = { vi: 'Trình khởi chạy Minecraft', en: 'Minecraft Launcher' }

export default function SplashScreen({ lang, leaving, status = 'boot', version }) {
  useLayoutEffect(() => {
    document.getElementById('boot-splash')?.remove()
  }, [])

  const label = STATUS[status]?.[lang] || STATUS[status]?.en || ''

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={label}
      data-splash={leaving ? 'leaving' : 'on'}
      className={`splash-root${leaving ? ' splash-leaving' : ''}`}
    >
      <div className="splash-blob splash-blob-a" />
      <div className="splash-blob splash-blob-b" />

      <div className="splash-center">
        <div className="splash-glow" />
        <div className="splash-ascii" role="img" aria-label="LunarSpace">
          {LOGO_ROWS.map((row, i) => (
            <span className="splash-ascii-row" key={i} style={{ '--i': i }}>{row}</span>
          ))}
        </div>
        <p className="splash-sub">{SUBTITLE[lang] || SUBTITLE.en}</p>
      </div>

      <div className="splash-foot">
        <p className="splash-status">{label}</p>
        <div className="splash-track">
          <div className="splash-sweep" />
        </div>
        <p className="splash-version">{version ? `v${version}` : ''}</p>
      </div>
    </div>
  )
}
