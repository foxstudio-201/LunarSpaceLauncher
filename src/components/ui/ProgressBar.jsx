import { palette } from '../../lib/palette'
import { formatBytes, formatSpeed } from '../../lib/status'

const LABELS = {
  start: { vi: 'Đang chuẩn bị…', en: 'Preparing…' },
  index: { vi: 'Đang tải asset index…', en: 'Downloading asset index…' },
  client: { vi: 'Đang tải client jar…', en: 'Downloading client jar…' },
  libraries: { vi: 'Đang tải thư viện…', en: 'Downloading libraries…' },
  assets: { vi: 'Đang tải tài nguyên…', en: 'Downloading assets…' },
  java: { vi: 'Đang tải Java…', en: 'Downloading Java…' },
  forge: { vi: 'Đang cài Forge…', en: 'Installing Forge…' },
  boost: { vi: 'Đang cài mod tăng FPS…', en: 'Installing FPS mods…' },
  install: { vi: 'Đang cài phiên bản…', en: 'Installing version…' },
  'install-done': { vi: 'Đã cài xong phiên bản', en: 'Version installed' },
  modpack: { vi: 'Đang cài modpack…', en: 'Installing modpack…' },
  repair: { vi: 'Đang tải bù mod thiếu…', en: 'Re-downloading missing mods…' },
  content: { vi: 'Đang tải nội dung…', en: 'Downloading content…' },
  export: { vi: 'Đang xuất profile…', en: 'Exporting profile…' },
  serverpack: { vi: 'Đang xuất serverpack…', en: 'Exporting server pack…' },
  server: { vi: 'Đang tải tệp server…', en: 'Downloading server file…' },
  done: { vi: 'Cài đặt hoàn tất', en: 'Install finished' },
  error: { vi: 'Cài đặt lỗi', en: 'Install failed' },
}

const FILL = {
  dark: { from: '#7c5cf6', to: '#a78bfa', glow: 'rgba(167,139,250,0.55)' },
  light: { from: '#6d28d9', to: '#8b5cf6', glow: 'rgba(139,92,246,0.5)' },
  done: { from: '#15803d', to: '#22c55e', glow: 'rgba(34,197,94,0.5)' },
  failed: { from: '#b91c1c', to: '#ef4444', glow: 'rgba(239,68,68,0.5)' },
}

export function progressLabel(progress, lang) {
  if (!progress) return ''
  const key = progress.phase === 'download' ? progress.label : progress.phase
  const base = LABELS[key]?.[lang] || LABELS[key]?.en || ''
  if (key === 'java' && progress.major) return `${base} (Java ${progress.major})`
  return base
}

export function progressPercent(progress) {
  if (!progress) return 0
  if (progress.totalBytes > 0 && progress.bytesDone !== undefined) {
    return Math.max(0, Math.min(100, (progress.bytesDone / progress.totalBytes) * 100))
  }
  if (progress.total > 0) return Math.max(0, Math.min(100, (progress.done / progress.total) * 100))
  return progress.phase === 'done' ? 100 : 0
}

export default function ProgressBar({ theme, lang, progress, compact = false }) {
  const c = palette(theme)
  if (!progress) return null

  const failed = progress.phase === 'error'
  const done = progress.phase === 'done'
  const pct = done ? 100 : Math.round(progressPercent(progress))
  const color = failed ? '#ef4444' : done ? '#22c55e' : c.accent
  const speed = progress.speed
  const unknown = !failed && !done && !progress.totalBytes && !progress.total
  const tint = failed ? FILL.failed : done ? FILL.done : theme === 'light' ? FILL.light : FILL.dark
  const showHead = !failed && !done && !unknown && pct > 0.5

  return (
    <div className="flex flex-col gap-1.5 w-full">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[10px] font-semibold uppercase tracking-wide" style={{ color }}>
          {progressLabel(progress, lang)}
        </span>
        {!failed && !done && (
          <span className="text-[10px] font-mono" style={{ color: c.faint }}>
            {progress.totalBytes > 0
              ? `${formatBytes(progress.bytesDone || 0)} / ${formatBytes(progress.totalBytes)}`
              : progress.total > 0
                ? `${progress.done || 0}/${progress.total}`
                : ''}
            {progress.totalBytes > 0 || progress.total > 0 ? ` · ${pct}%` : ''}
          </span>
        )}
        {!failed && !done && speed > 1024 && (
          <span className="text-[10px] font-mono font-semibold" style={{ color: c.accent }}>
            {formatSpeed(speed)}
          </span>
        )}
      </div>

      {!failed && (
        <div
          className="pbar-track h-1.5"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={unknown ? undefined : pct}
          style={{ '--pbar-track': c.input, '--pbar-from': tint.from, '--pbar-to': tint.to, '--pbar-glow': tint.glow }}
        >
          {unknown ? (
            <div className="pbar-indeterminate" />
          ) : (
            <>
              <div className={`pbar-fill${done ? ' pbar-still' : ''}`} style={{ width: `${pct}%` }} />
              {showHead && <div className="pbar-head" style={{ left: `${pct}%` }} />}
            </>
          )}
        </div>
      )}

      {!compact && progress.file && !done && !failed && (
        <span className="text-[9px] font-mono truncate" style={{ color: c.faint }}>{progress.file}</span>
      )}
      {failed && progress.error && (
        <span className="text-[10px] leading-relaxed" style={{ color: '#f87171' }}>{progress.error}</span>
      )}
    </div>
  )
}
