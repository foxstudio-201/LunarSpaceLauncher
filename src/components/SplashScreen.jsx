import { useLayoutEffect } from 'react'
import { LOGO_ROWS } from '../lib/asciiLogo'

const STATUS = {
  boot: { vi: 'Đang khởi động…', en: 'Starting…' },
  versions: { vi: 'Đang tải phiên bản…', en: 'Loading versions…' },
  ready: { vi: 'Sẵn sàng', en: 'Ready' },
}

const SUBTITLE = { vi: 'Trình khởi chạy Minecraft', en: 'Minecraft Launcher' }

function updateLabel(update, lang) {
  const vi = lang !== 'en'
  const phase = update?.phase
  const version = update?.version ? `v${update.version}` : ''
  if (phase === 'checking') return vi ? 'Đang kiểm tra cập nhật…' : 'Checking for updates…'
  if (phase === 'available') return vi ? `Có bản cập nhật ${version}` : `Update ${version} available`
  if (phase === 'downloading') {
    const percent = Math.round(update?.percent || 0)
    return vi ? `Đang tải cập nhật ${version} · ${percent}%` : `Downloading ${version} · ${percent}%`
  }
  if (phase === 'ready' || phase === 'installing') return vi ? 'Đang cài bản cập nhật…' : 'Installing update…'
  return ''
}

function updateProgress(update) {
  const phase = update?.phase
  if (phase === 'downloading') return Math.max(0, Math.min(100, update?.percent || 0))
  if (phase === 'ready' || phase === 'installing') return 100
  return null
}

export default function SplashScreen({ lang, leaving, status = 'boot', version, update }) {
  useLayoutEffect(() => {
    document.getElementById('boot-splash')?.remove()
  }, [])

  const label = updateLabel(update, lang) || STATUS[status]?.[lang] || STATUS[status]?.en || ''
  const progress = updateProgress(update)

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
          {progress === null
            ? <div className="splash-sweep" />
            : <div className="splash-fill" style={{ width: `${progress}%` }} />}
        </div>
        <p className="splash-version">{version ? `v${version}` : ''}</p>
      </div>
    </div>
  )
}
