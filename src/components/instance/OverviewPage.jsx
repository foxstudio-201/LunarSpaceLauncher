import { useEffect, useState } from 'react'
import {
  Play, Stop, Clock, CalendarBlank, Cube, Memory, FolderOpen, Terminal, ArrowsClockwise,
  PuzzlePiece, Archive, Image, PaintBrush, CaretRight,
} from '@phosphor-icons/react'
import { t } from '../../i18n/translations'
import { palette } from '../../lib/palette'
import { statusColor, statusKey, formatPlaytime, formatDate, timeAgo } from '../../lib/status'
import ProgressBar from '../ui/ProgressBar'
import { Card, Fact } from '../ui/Panel'
import * as api from '../../api/client.js'

const vn = (lang, vi, en) => (lang === 'vi' ? vi : en)

export default function OverviewPage({
  instance, theme, lang, progress, launchError, onLaunch, onStop, onRestart, onNavigate,
}) {
  const c = palette(theme)
  const loader = api.LOADERS.find((l) => l.id === instance.loader) || api.LOADERS[0]
  const running = instance.status === 'running'
  const starting = instance.status === 'starting'
  const stopping = instance.status === 'stopping'
  const installing = instance.status === 'installing'
  const busy = running || starting
  const locked = installing || stopping
  const instProgress = progress[instance.id]
  const error = launchError[instance.id]

  const [content, setContent] = useState(null)

  useEffect(() => {
    let alive = true
    const folders = ['mods', 'saves', 'resourcepacks', 'shaderpacks']
    Promise.all(folders.map((folder) => api.listDir({ id: instance.id, rel: folder }).catch(() => null)))
      .then((results) => {
        if (!alive) return
        const counts = {}
        folders.forEach((folder, i) => {
          const entries = results[i]?.entries
          counts[folder] = Array.isArray(entries) ? entries.length : null
        })
        setContent(counts)
      })
    return () => { alive = false }
  }, [instance.id])

  const reveal = () => api.revealPath(instance.dir).catch(() => {})

  return (
    <div data-surface className="h-full overflow-y-auto" style={{ background: c.bg }}>
      <div className="p-6">
        <div className="max-w-4xl mx-auto flex flex-col gap-5">
          <div className="group relative rounded-2xl overflow-hidden transition-transform duration-300 hover:scale-[1.005]" style={{ border: `1px solid ${c.border}` }}>
            <img
              src="./Minecraft_backgound.png"
              alt=""
              className="absolute inset-0 w-full h-full object-cover transition-transform duration-700 group-hover:scale-[1.04]"
            />
            <div className="absolute inset-0" style={{ background: 'linear-gradient(105deg, rgba(0,0,0,0.95) 0%, rgba(0,0,0,0.76) 48%, rgba(0,0,0,0.36) 100%)' }} />
            <div className="relative z-10 px-6 py-6 flex items-center gap-5">
              <div className="relative shrink-0">
                {running && <div className="absolute inset-0 rounded-2xl launch-pulse" style={{ background: 'rgba(34,197,94,0.34)', filter: 'blur(14px)' }} />}
                {starting && <div className="absolute -inset-1.5 rounded-3xl launch-pulse" style={{ background: 'rgba(234,179,8,0.45)', filter: 'blur(18px)' }} />}
                <button
                  disabled={locked}
                  onClick={() => (busy ? onStop(instance) : onLaunch(instance))}
                  className="relative w-[76px] h-[76px] rounded-2xl flex items-center justify-center overflow-hidden transition-all duration-200 hover:scale-[1.04] active:scale-95 disabled:opacity-60"
                  style={{
                    background: locked || starting ? 'rgba(234,179,8,0.94)' : running ? 'rgba(239,68,68,0.94)' : 'rgba(34,197,94,0.94)',
                    border: `2px solid ${locked || starting ? '#eab308' : running ? '#ef4444' : '#22c55e'}`,
                    boxShadow: `0 0 18px ${locked || starting ? 'rgba(234,179,8,0.45)' : running ? 'rgba(239,68,68,0.45)' : 'rgba(34,197,94,0.4)'}`,
                    color: locked || starting ? '#1a1405' : running ? '#fff' : '#04140a',
                  }}
                  data-tip={busy ? t(lang, 'instance.stop') : t(lang, 'instance.launch')}
                >
                  {running ? <Stop size={30} weight="fill" /> : <Play size={32} weight="fill" />}
                  {(installing || starting) && (
                    <span className="absolute inset-0 flex items-center justify-center">
                      <ArrowsClockwise size={28} weight="bold" className="animate-spin" />
                    </span>
                  )}
                </button>
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full" style={{ background: statusColor(instance.status) }} />
                  <p className="text-[10px] font-semibold uppercase tracking-[0.18em]" style={{ color: 'rgba(255,255,255,0.55)' }}>
                    {t(lang, statusKey(instance.status))}
                  </p>
                </div>
                <p className="text-xl font-bold truncate" style={{ color: '#fff' }}>{instance.name}</p>
                <div className="mt-1.5 flex items-center gap-2 flex-wrap">
                  <span className="flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[10px] font-semibold"
                    style={{ background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.14)', color: 'rgba(255,255,255,0.8)' }}>
                    <img src={api.loaderIcon(instance.loader)} alt="" className="w-3.5 h-3.5 rounded object-contain" />
                    {loader.name}{instance.loaderVersion ? ` ${instance.loaderVersion}` : ''}
                  </span>
                  <span className="px-2 py-0.5 rounded-md text-[10px] font-mono"
                    style={{ background: 'rgba(167,139,250,0.16)', border: '1px solid rgba(167,139,250,0.3)', color: '#c4b5fd' }}>
                    {instance.version}
                  </span>
                  <span className="px-2 py-0.5 rounded-md text-[10px] font-mono"
                    style={{ background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.14)', color: 'rgba(255,255,255,0.7)' }}>
                    {instance.memoryMb} MB
                  </span>
                  {starting && (
                    <span className="px-2 py-0.5 rounded-md text-[10px] font-bold"
                      style={{ background: 'rgba(234,179,8,0.2)', border: '1px solid rgba(234,179,8,0.4)', color: '#fde047' }}>
                      {vn(lang, 'đang nạp game…', 'loading the game…')}
                    </span>
                  )}
                </div>
                {(instProgress || error) && (
                  <div className="mt-3 max-w-md">
                    <ProgressBar theme={theme} lang={lang} progress={error ? { phase: 'error', error } : instProgress} compact />
                  </div>
                )}
              </div>
              <div className="shrink-0 flex flex-col items-end gap-1.5 self-start">
                <button
                  disabled={!running}
                  onClick={() => onRestart(instance)}
                  className="h-9 px-3 rounded-lg text-[11px] font-semibold flex items-center gap-1.5 disabled:opacity-40"
                  style={{ background: 'rgba(255,255,255,0.14)', border: '1px solid rgba(255,255,255,0.18)', color: '#fff' }}
                >
                  <ArrowsClockwise size={14} weight="duotone" />
                  {lang === 'vi' ? 'Khởi động lại' : 'Restart'}
                </button>
                <button
                  onClick={reveal}
                  data-tip={instance.dir}
                  className="h-9 px-3 rounded-lg text-[11px] font-semibold flex items-center gap-1.5"
                  style={{ background: 'rgba(255,255,255,0.14)', border: '1px solid rgba(255,255,255,0.18)', color: '#fff' }}
                >
                  <FolderOpen size={14} weight="duotone" />
                  {lang === 'vi' ? 'Thư mục' : 'Folder'}
                </button>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-4 gap-3">
            {[
              { icon: <Memory size={15} weight="duotone" />, label: 'RAM', value: `${instance.memoryMb} MB` },
              { icon: <Cube size={15} weight="duotone" />, label: t(lang, 'versions.pickLoader'), value: instance.loaderVersion ? `${loader.name} ${instance.loaderVersion}` : loader.name },
              { icon: <Clock size={15} weight="duotone" />, label: t(lang, 'instance.playtime'), value: formatPlaytime(instance.playtimeMs) },
              { icon: <CalendarBlank size={15} weight="duotone" />, label: t(lang, 'instance.lastPlayed'), value: formatDate(instance.lastPlayed, lang) || t(lang, 'common.never') },
            ].map((s) => (
              <div key={s.label} className="rounded-xl p-3.5 flex flex-col gap-1.5" style={{ background: c.surface, border: `1px solid ${c.border}` }}>
                <span className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide" style={{ color: c.faint }}>
                  <span style={{ color: c.accent }}>{s.icon}</span>
                  {s.label}
                </span>
                <span className="text-sm font-bold truncate" style={{ color: c.text }}>{s.value}</span>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Card c={c} className="p-4 flex flex-col gap-2.5">
              <p className="text-[10px] font-bold uppercase tracking-[0.16em]" style={{ color: c.label }}>
                {vn(lang, 'Chi tiết phiên bản', 'Instance details')}
              </p>
              <div className="flex flex-col gap-2 pt-2" style={{ borderTop: `1px solid ${c.border}` }}>
                <Fact c={c} label={vn(lang, 'Mã phiên bản', 'Version id')} value={instance.versionId || instance.id} />
                <Fact c={c} label="Java" value={instance.javaMajor ? `${instance.javaMajor}+` : '—'} />
                <Fact c={c} label={vn(lang, 'Người chơi', 'Player')} value={instance.username || 'Player'} />
                <Fact c={c} label={vn(lang, 'Thời gian chơi', 'Playtime')} value={formatPlaytime(instance.playtimeMs)} />
                <Fact c={c} label={vn(lang, 'Lần chơi cuối', 'Last played')} value={instance.lastPlayed ? `${formatDate(instance.lastPlayed, lang)} · ${timeAgo(instance.lastPlayed, lang)}` : t(lang, 'common.never')} />
                <Fact c={c} label={vn(lang, 'Ngày tạo', 'Created')} value={instance.created ? `${formatDate(instance.created, lang)} · ${timeAgo(instance.created, lang)}` : '—'} />
                <Fact c={c} label={vn(lang, 'Thư mục chạy', 'Run folder')} value={instance.dir} title={instance.dir} />
              </div>
            </Card>

            <Card c={c} className="p-4 flex flex-col gap-2.5">
              <p className="text-[10px] font-bold uppercase tracking-[0.16em]" style={{ color: c.label }}>
                {vn(lang, 'Nội dung', 'Contents')}
              </p>
              <div className="flex flex-col gap-2.5 pt-2" style={{ borderTop: `1px solid ${c.border}` }}>
                {[
                  { key: 'mods', page: 'instance-mods', icon: <PuzzlePiece size={13} weight="duotone" />, label: vn(lang, 'Mod', 'Mods') },
                  { key: 'saves', page: 'instance-saves', icon: <Archive size={13} weight="duotone" />, label: vn(lang, 'Bản lưu thế giới', 'World saves') },
                  { key: 'resourcepacks', page: 'instance-resourcepacks', icon: <Image size={13} weight="duotone" />, label: vn(lang, 'Gói tài nguyên', 'Resource packs') },
                  { key: 'shaderpacks', page: 'instance-shaderpacks', icon: <PaintBrush size={13} weight="duotone" />, label: vn(lang, 'Shader', 'Shaders') },
                ].map((row) => (
                  <button
                    key={row.key}
                    type="button"
                    onClick={() => onNavigate?.(row.page)}
                    className="flex items-center gap-2.5 text-left rounded-md -mx-1.5 px-1.5 py-0.5 transition-colors"
                    style={{ color: c.label }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = c.hover }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
                  >
                    <span style={{ color: c.accent }}>{row.icon}</span>
                    <span className="text-[11px] flex-1" style={{ color: c.label }}>{row.label}</span>
                    <span className="text-[11px] font-mono tabular-nums" style={{ color: c.text }}>
                      {content && content[row.key] !== null && content[row.key] !== undefined ? content[row.key] : '—'}
                    </span>
                    <CaretRight size={11} style={{ color: c.faint }} />
                  </button>
                ))}
              </div>
              <p className="mt-auto pt-2 text-[10px] leading-relaxed" style={{ color: c.faint, borderTop: `1px solid ${c.border}` }}>
                {vn(lang, 'Mở tab tương ứng ở sidebar để xem và chỉnh sửa.', 'Open the matching sidebar tab to inspect and edit.')}
              </p>
            </Card>
          </div>

          <div className="rounded-xl p-4 flex items-center gap-3" style={{ background: c.surface, border: `1px solid ${c.border}` }}>
            <Terminal size={16} weight="duotone" style={{ color: c.accent }} />
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold" style={{ color: c.text }}>
                {lang === 'vi' ? 'Nhật ký khởi chạy' : 'Launch logs'}
              </p>
              <p className="text-[10px] truncate" style={{ color: c.faint }}>
                {lang === 'vi' ? 'Mở tab Console trong sidebar để xem log trực tiếp.' : 'Open the Console tab in the sidebar for live logs.'}
              </p>
            </div>
            <span className="text-[10px] font-mono" style={{ color: c.faint }}>Java {instance.javaMajor || '—'}+</span>
          </div>
        </div>
      </div>
    </div>
  )
}
