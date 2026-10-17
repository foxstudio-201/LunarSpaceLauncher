import { useEffect, useMemo, useState } from 'react'
import {
  Play, Stop, Clock, CalendarBlank, Cube, Memory, FolderOpen, Terminal, ArrowsClockwise,
  PuzzlePiece, Archive, Image, PaintBrush, CaretRight, MapTrifold, Package, ChartLineUp,
  CloudArrowDown, ArrowSquareOut, WarningCircle,
} from '@phosphor-icons/react'
import { t } from '../../i18n/translations'
import { palette } from '../../lib/palette'
import { statusColor, statusKey, formatPlaytime, formatDate, timeAgo } from '../../lib/status'
import ProgressBar from '../ui/ProgressBar'
import { Card, Fact } from '../ui/Panel'
import Select from '../ui/Select'
import RichText from './RichText'
import * as api from '../../api/client.js'

const vn = (lang, vi, en) => (lang === 'vi' ? vi : en)

const compact = (value, lang) => {
  const n = Number(value)
  if (!Number.isFinite(n)) return '—'
  try {
    return new Intl.NumberFormat(lang === 'vi' ? 'vi-VN' : 'en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(n)
  } catch {
    return String(n)
  }
}

const normText = (value) => String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '')

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
  const [pack, setPack] = useState(null)
  const [packDetail, setPackDetail] = useState(null)
  const [packVersions, setPackVersions] = useState([])
  const [packLoading, setPackLoading] = useState(false)
  const [packTick, setPackTick] = useState(0)
  const [tab, setTab] = useState('info')
  const [pickId, setPickId] = useState('')
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [updateBusy, setUpdateBusy] = useState(false)
  const [updateError, setUpdateError] = useState('')

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

  useEffect(() => {
    let alive = true
    setPack(null)
    setPackDetail(null)
    setPackVersions([])
    setPickId('')
    setUpdateError('')
    api.modpackInstanceInfo({ id: instance.id })
      .then(async (info) => {
        if (!alive) return
        setPack(info || { ok: false, isModpack: false })
        if (!info?.ok || !info.isModpack || !info.projectId) return
        setPackLoading(true)
        const [proj, vers] = await Promise.all([
          api.contentProject({ kind: 'modpacks', source: info.source, id: info.projectId }).catch(() => null),
          api.modpackVersions({ source: info.source, id: info.projectId }).catch(() => null),
        ])
        if (!alive) return
        if (proj?.ok) setPackDetail(proj.project)
        setPackVersions(vers?.versions || [])
        setPackLoading(false)
      })
      .catch(() => {
        if (alive) setPack({ ok: false, isModpack: false })
      })
    return () => { alive = false }
  }, [instance.id, packTick])

  const isModpack = !!(pack?.ok && pack?.isModpack)

  const usable = useMemo(() => {
    const sorted = [...packVersions].sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0))
    const own = sorted.filter((v) => (!v.gameVersions?.length || v.gameVersions.includes(instance.version)) && (!v.loaders?.length || v.loaders.includes(instance.loader)))
    return own.length ? own : sorted
  }, [packVersions, instance.version, instance.loader])

  const installedName = pack?.marker?.version || ''
  const latest = usable[0] || null
  const installedVersion = useMemo(() => {
    if (!usable.length) return null
    if (pack?.installedVersionId) {
      const hit = usable.find((v) => v.id === pack.installedVersionId)
      if (hit) return hit
    }
    const want = normText(installedName)
    if (!want) return null
    return usable.find((v) => {
      const a = normText(v.name)
      const b = normText(v.versionNumber)
      return (a && (a.includes(want) || want.includes(a))) || (b && (b.includes(want) || want.includes(b)))
    }) || null
  }, [usable, pack, installedName])
  const hasUpdate = !!(latest && installedVersion && latest.id !== installedVersion.id && new Date(latest.date || 0) > new Date(installedVersion.date || 0))
  const defaultPick = hasUpdate ? latest?.id : installedVersion?.id || latest?.id || ''
  const pickValue = pickId || defaultPick
  const pickedVersion = usable.find((v) => v.id === pickValue) || null
  const pageLink = packDetail?.links?.[0]?.url || (pack?.source === 'curseforge'
    ? `https://www.curseforge.com/minecraft/modpacks/${packDetail?.slug || pack?.projectId || ''}`
    : `https://modrinth.com/modpack/${packDetail?.slug || pack?.projectId || ''}`)
  const updating = updateBusy || (!locked && instProgress?.label === 'update')
  const canUpdate = !!pickValue && !busy && !locked && !updateBusy

  const reveal = () => api.revealPath(instance.dir).catch(() => {})

  const runUpdate = async () => {
    setConfirmOpen(false)
    setUpdateError('')
    setUpdateBusy(true)
    try {
      const res = await api.modpackInstanceUpdate({ id: instance.id, versionId: pickValue })
      if (!res?.ok) setUpdateError(res?.error || vn(lang, 'Cập nhật thất bại.', 'Update failed.'))
      else {
        setPickId('')
        setPackTick((value) => value + 1)
      }
    } catch (err) {
      setUpdateError(err.message)
    } finally {
      setUpdateBusy(false)
    }
  }

  const tabDefs = [
    { key: 'info', icon: Package, label: vn(lang, 'Thông tin', 'Info') },
    { key: 'overview', icon: ChartLineUp, label: vn(lang, 'Tổng quan', 'Overview') },
  ]

  return (
    <div data-surface className="h-full flex flex-col" style={{ background: c.bg }}>
      {isModpack && (
        <div className="shrink-0" style={{ borderBottom: `1px solid ${c.border}`, background: c.bg }}>
          <div className="max-w-4xl mx-auto px-6 pt-3 pb-2 flex items-center gap-1">
            {tabDefs.map((tabDef) => {
              const Icon = tabDef.icon
              const on = tab === tabDef.key
              return (
                <button
                  key={tabDef.key}
                  onClick={() => setTab(tabDef.key)}
                  className="relative h-8 px-3 rounded-md text-[11px] font-semibold flex items-center gap-1.5 transition-colors"
                  style={{ background: on ? c.input : 'transparent', color: on ? c.accent : c.label }}
                >
                  <Icon size={13} weight={on ? 'fill' : 'regular'} />
                  {tabDef.label}
                  {on && <span className="absolute left-2 right-2 -bottom-[3px] h-[2px] rounded-full" style={{ background: c.accent }} />}
                </button>
              )
            })}
          </div>
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="p-6">
          <div className="max-w-4xl mx-auto flex flex-col gap-5">
          {isModpack && tab === 'info' && (
            <div className="flex flex-col gap-4">
              <div className="rounded-xl p-4 flex items-start gap-4" style={{ background: c.surface, border: `1px solid ${c.border}` }}>
                <div className="w-16 h-16 rounded-xl overflow-hidden shrink-0 flex items-center justify-center" style={{ background: c.input, border: `1px solid ${c.border}` }}>
                  {packDetail?.icon
                    ? <img src={packDetail.icon} alt="" className="w-full h-full object-cover" />
                    : <Package size={26} weight="duotone" style={{ color: c.faint }} />}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-base font-bold truncate" style={{ color: c.text }}>
                      {packDetail?.name || pack?.marker?.name || instance.name}
                    </p>
                    <span
                      className="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wide"
                      style={{
                        background: pack?.source === 'curseforge' ? 'rgba(245,158,11,0.16)' : 'rgba(34,197,94,0.16)',
                        border: `1px solid ${pack?.source === 'curseforge' ? 'rgba(245,158,11,0.4)' : 'rgba(34,197,94,0.4)'}`,
                        color: pack?.source === 'curseforge' ? '#fbbf24' : '#4ade80',
                      }}
                    >
                      {pack?.source === 'curseforge' ? 'CurseForge' : 'Modrinth'}
                    </span>
                    {hasUpdate && (
                      <span className="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wide" style={{ background: 'rgba(167,139,250,0.16)', border: `1px solid ${c.accent}55`, color: c.accent }}>
                        {vn(lang, 'Có bản mới', 'Update available')}
                      </span>
                    )}
                    {installedVersion && !hasUpdate && (
                      <span className="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wide" style={{ background: 'rgba(34,197,94,0.14)', border: '1px solid rgba(34,197,94,0.35)', color: '#4ade80' }}>
                        {vn(lang, 'Mới nhất', 'Up to date')}
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-[11px] leading-relaxed line-clamp-2" style={{ color: c.label }}>
                    {packDetail?.summary || (packLoading ? vn(lang, 'Đang tải thông tin modpack…', 'Loading modpack info…') : '')}
                  </p>
                  <div className="mt-2 flex items-center gap-1.5 flex-wrap">
                    <span className="px-2 py-0.5 rounded-md text-[10px] font-mono" style={{ background: c.input, border: `1px solid ${c.border}`, color: c.label }}>
                      {pack?.marker?.mc || instance.version}
                    </span>
                    <span className="flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-semibold" style={{ background: c.input, border: `1px solid ${c.border}`, color: c.label }}>
                      <img src={api.loaderIcon(pack?.marker?.loader || instance.loader)} alt="" className="w-3 h-3 rounded object-contain" />
                      {loader.name}
                    </span>
                    {Number.isFinite(Number(packDetail?.downloads)) && (
                      <span className="px-2 py-0.5 rounded-md text-[10px] font-mono" style={{ background: c.input, border: `1px solid ${c.border}`, color: c.label }}>
                        {compact(packDetail.downloads, lang)} {vn(lang, 'lượt tải', 'downloads')}
                      </span>
                    )}
                    {packDetail?.updated && (
                      <span className="text-[10px]" style={{ color: c.faint }}>{vn(lang, 'Cập nhật', 'Updated')} {timeAgo(packDetail.updated, lang)}</span>
                    )}
                  </div>
                </div>
                {(pack?.projectId || (packDetail?.links || []).length > 0) && (
                  <button
                    onClick={() => api.openExternal(pageLink).catch(() => {})}
                    className="h-8 px-2.5 rounded-md text-[10px] font-semibold flex items-center gap-1.5 shrink-0"
                    style={{ background: c.surface, border: `1px solid ${c.border}`, color: c.label }}
                  >
                    {vn(lang, 'Trang modpack', 'Pack page')}
                    <ArrowSquareOut size={11} />
                  </button>
                )}
              </div>

              <div className="grid grid-cols-4 gap-3">
                {[
                  { label: vn(lang, 'Nguồn', 'Source'), value: pack?.source === 'curseforge' ? 'CurseForge' : 'Modrinth' },
                  { label: vn(lang, 'Đã cài', 'Installed'), value: installedName || '—' },
                  { label: vn(lang, 'Bản mới nhất', 'Latest'), value: latest ? latest.name || latest.versionNumber : '—' },
                  { label: vn(lang, 'Tệp trong pack', 'Pack files'), value: pack?.marker?.files ? String(pack.marker.files) : '—' },
                ].map((cell) => (
                  <div key={cell.label} className="rounded-xl p-3.5 flex flex-col gap-1.5 min-w-0" style={{ background: c.surface, border: `1px solid ${c.border}` }}>
                    <span className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: c.faint }}>{cell.label}</span>
                    <span className="text-sm font-bold truncate" style={{ color: c.text }} title={cell.value}>{cell.value}</span>
                  </div>
                ))}
              </div>

              <div className="rounded-xl p-4 flex flex-col gap-3" style={{ background: c.surface, border: `1px solid ${c.border}` }}>
                <div className="flex items-center gap-2">
                  <CloudArrowDown size={16} weight="duotone" style={{ color: c.accent }} />
                  <p className="text-xs font-bold" style={{ color: c.text }}>{vn(lang, 'Cập nhật modpack', 'Update modpack')}</p>
                </div>
                {!pack?.projectId ? (
                  <div className="flex items-start gap-2">
                    <WarningCircle size={14} weight="duotone" style={{ color: '#fbbf24', marginTop: 1 }} />
                    <p className="text-[11px] leading-relaxed" style={{ color: c.label }}>
                      {pack?.resolveError || vn(lang, 'Không xác định được modpack nguồn trên nền tảng đã tải về nên chưa thể kiểm tra cập nhật.', 'Could not match this modpack on its source platform, so update checks are unavailable.')}
                    </p>
                  </div>
                ) : (
                  <>
                    <div className="flex items-center gap-2 flex-wrap">
                      <div className="w-80">
                        <Select
                          theme={theme}
                          value={pickValue}
                          onChange={(value) => { setPickId(value); setUpdateError('') }}
                          options={usable.map((v) => ({ value: v.id, label: `${v.name || v.versionNumber} · ${String(v.date || '').slice(0, 10)}${v.id === installedVersion?.id ? vn(lang, ' · đã cài', ' · installed') : ''}` }))}
                          placeholder={vn(lang, 'Chọn bản phát hành', 'Pick a release')}
                        />
                      </div>
                      <button
                        disabled={!canUpdate}
                        onClick={() => setConfirmOpen(true)}
                        className="h-9 px-3 rounded-lg text-[11px] font-bold flex items-center gap-1.5 disabled:opacity-40"
                        style={{ background: c.accent, color: '#fff' }}
                      >
                        <CloudArrowDown size={14} weight="duotone" />
                        {hasUpdate ? vn(lang, 'Cập nhật', 'Update') : vn(lang, 'Cài lại bản này', 'Reinstall version')}
                      </button>
                      {installedName && (
                        <span className="text-[10px]" style={{ color: c.faint }}>
                          {vn(lang, 'Đang cài', 'Installed')}: <b style={{ color: c.label }}>{installedName}</b>
                        </span>
                      )}
                    </div>
                    {updateError && <p className="text-[11px]" style={{ color: '#f87171' }}>{updateError}</p>}
                    {(updateBusy || instProgress?.label === 'update') && (
                      <ProgressBar theme={theme} lang={lang} progress={instProgress || { phase: 'download', label: 'update' }} compact />
                    )}
                    <p className="text-[10px] leading-relaxed" style={{ color: c.faint }}>
                      {vn(
                        lang,
                        'Hãy tắt game trước khi cập nhật. Tệp pack cũ không còn trong bản mới sẽ được chuyển vào Thùng rác (khôi phục được); tệp bạn sửa tay được giữ nguyên.',
                        'Close the game before updating. Old pack files missing from the new version are moved to Trash (recoverable); files you edited are kept.',
                      )}
                    </p>
                  </>
                )}
              </div>

              <Card c={c} className="p-4 flex flex-col gap-2.5">
                <p className="text-[10px] font-bold uppercase tracking-[0.16em]" style={{ color: c.label }}>
                  {vn(lang, 'Mô tả modpack', 'Modpack description')}
                </p>
                <div className="pt-2" style={{ borderTop: `1px solid ${c.border}` }}>
                  {packLoading && !packDetail ? (
                    <div className="flex flex-col gap-2 py-1">
                      {[92, 78, 85, 60, 88, 70].map((w, i) => (
                        <span key={i} className="h-2.5 rounded-full" style={{ background: c.input, width: `${w}%` }} />
                      ))}
                    </div>
                  ) : !packDetail ? (
                    <p className="py-2 text-[11px]" style={{ color: c.faint }}>
                      {vn(lang, 'Không tải được mô tả từ nền tảng đã tải modpack.', 'Could not load the description from the source platform.')}
                    </p>
                  ) : (
                    <div className="max-h-[460px] overflow-y-auto pr-2">
                      <RichText
                        raw={packDetail?.descriptionRaw || packDetail?.description || ''}
                        format={packDetail?.descriptionFormat === 'html' ? 'html' : 'markdown'}
                        c={c}
                        className="text-[12px] leading-relaxed"
                      />
                    </div>
                  )}
                </div>
              </Card>

              {(packDetail?.gallery || []).length > 0 && (
                <div className="grid grid-cols-4 gap-2">
                  {(packDetail.gallery || []).slice(0, 4).map((shot) => (
                    <img
                      key={shot.url}
                      src={shot.url}
                      alt={shot.title || ''}
                      title={shot.title || ''}
                      className="w-full h-28 object-cover rounded-lg"
                      style={{ border: `1px solid ${c.border}` }}
                    />
                  ))}
                </div>
              )}
            </div>
          )}

          {(!isModpack || tab === 'overview') && (
            <>
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
                      { key: 'map', page: 'instance-map', icon: <MapTrifold size={13} weight="duotone" />, label: vn(lang, 'Bản đồ thế giới', 'World map') },
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
            </>
          )}
          </div>
        </div>
      </div>

      {confirmOpen && (
        <div
          className="modal-backdrop fixed inset-0 z-[210] flex items-center justify-center p-6"
          style={{ background: 'rgba(0,0,0,0.72)' }}
          onClick={() => setConfirmOpen(false)}
        >
          <div
            className="w-full max-w-md rounded-2xl p-5 flex flex-col gap-3"
            style={{ background: c.bg, border: `1px solid ${c.border}` }}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center gap-2">
              <CloudArrowDown size={17} weight="duotone" style={{ color: c.accent }} />
              <p className="text-sm font-bold" style={{ color: c.text }}>
                {hasUpdate ? vn(lang, 'Cập nhật modpack?', 'Update modpack?') : vn(lang, 'Cài lại modpack?', 'Reinstall modpack?')}
              </p>
            </div>
            <div className="rounded-lg p-3 text-[11px] flex flex-col gap-1" style={{ background: c.input, border: `1px solid ${c.border}`, color: c.label }}>
              <span>{vn(lang, 'Bản đang cài', 'Installed')}: <b style={{ color: c.text }}>{installedName || '—'}</b></span>
              <span>{vn(lang, 'Chuyển sang', 'Switch to')}: <b style={{ color: c.accent }}>{pickedVersion?.name || pickedVersion?.versionNumber || '—'}</b></span>
            </div>
            <p className="text-[10px] leading-relaxed" style={{ color: c.faint }}>
              {vn(
                lang,
                'Tệp pack cũ không còn trong bản mới sẽ được chuyển vào Thùng rác (khôi phục được). Tệp bạn sửa tay được giữ nguyên. Tiến trình sẽ chạy trong nền và báo khi xong.',
                'Old pack files missing from the new version are moved to Trash (recoverable). Files you edited are kept. The process runs in the background and reports when done.',
              )}
            </p>
            <div className="flex justify-end gap-2 pt-1">
              <button
                onClick={() => setConfirmOpen(false)}
                className="h-9 px-3 rounded-lg text-[11px] font-semibold"
                style={{ background: c.surface, border: `1px solid ${c.border}`, color: c.label }}
              >
                {vn(lang, 'Huỷ', 'Cancel')}
              </button>
              <button
                onClick={runUpdate}
                className="h-9 px-3 rounded-lg text-[11px] font-bold"
                style={{ background: c.accent, color: '#fff' }}
              >
                {vn(lang, 'Bắt đầu', 'Start')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
