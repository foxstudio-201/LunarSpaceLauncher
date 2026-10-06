import { useEffect, useMemo, useState } from 'react'
import {
  Play, Stop, Cube, ArrowRight, FolderOpen,
  Check, Minus, ArrowsClockwise, Clock, Memory, CalendarBlank,
} from '@phosphor-icons/react'
import { useApp } from '../../i18n/AppContext'
import { t } from '../../i18n/translations'
import { palette } from '../../lib/palette'
import { formatBytes, formatDate, timeAgo, statusColor, statusKey, formatPlaytime } from '../../lib/status'
import PageHeader from '../ui/PageHeader'
import { Section, Card, Fact, Meter, Skeleton } from '../ui/Panel'
import { LOADERS, loaderIcon } from '../../api/client'
import * as api from '../../api/client.js'

const vn = (lang, vi, en) => (lang === 'vi' ? vi : en)

export default function HomePage({
  theme, lang, system, versions, latest, loading, instances,
  onSelectInstance, onOpenVersions, sharedDir, progress, launchError, onLaunch, onStop,
}) {
  const { setTheme } = useApp()
  const c = palette(theme)

  const [loaderInfo, setLoaderInfo] = useState(null)
  const [runtimes, setRuntimes] = useState(null)

  const releases = useMemo(() => (versions || []).slice(0, 9), [versions])
  const latestRelease = latest?.release || releases[0]?.id || null
  const latestRow = releases.find((v) => v.id === latestRelease) || releases[0] || null

  useEffect(() => {
    let alive = true
    const load = async () => {
      const entries = await Promise.all(
        LOADERS.map(async (loader) => {
          if (loader.id === 'vanilla') return [loader.id, { supported: true, build: latestRelease, stable: true, games: null, vanilla: true }]
          const [gamesRes, buildsRes] = await Promise.all([
            api.listLoaderGames({ kind: loader.id }).catch(() => null),
            latestRelease
              ? api.listLoaderVersions({ kind: loader.id, game: latestRelease }).catch(() => null)
              : Promise.resolve(null),
          ])
          const games = gamesRes?.games || []
          const build = buildsRes?.versions?.[0] || null
          return [loader.id, {
            supported: !!build,
            build: build?.version || null,
            buildNumber: build?.build ?? null,
            stable: !!build?.stable,
            games: games.length || null,
          }]
        }),
      )
      if (alive) setLoaderInfo(Object.fromEntries(entries))
    }
    load()
    api.listJavaRuntimes({}).then((res) => {
      if (!alive) return
      const items = (res?.items || []).filter((r) => r.installed)
      setRuntimes({ count: items.length, bytes: items.reduce((sum, r) => sum + (r.bytes || 0), 0), list: items })
    }).catch(() => {})
    return () => { alive = false }
  }, [latestRelease])

  const running = instances.filter((i) => i.status === 'running').length
  const disk = system?.disk || { total: 0, free: 0 }
  const ramUsed = system ? system.totalMem - system.freeMem : 0
  const activeInstance = instances.find((i) => i.status === 'running') || instances.find((i) => i.status === 'starting') || instances[0] || null
  const activeStarting = activeInstance?.status === 'starting'
  const activeRunning = activeInstance?.status === 'running'
  const activeBusy = activeRunning || activeStarting
  const installing = activeInstance?.status === 'installing'
  const activeProgress = activeInstance ? progress[activeInstance.id] : null
  const activeError = activeInstance ? launchError[activeInstance.id] : ''
  const orderedInstances = [...instances].sort((a, b) => new Date(b.lastPlayed || b.created || 0) - new Date(a.lastPlayed || a.created || 0))

  return (
    <div data-surface className="h-full overflow-y-auto" style={{ background: c.bg }}>
      <PageHeader
        theme={theme}
        title={t(lang, 'home.title')}
        subtitle={`${versions.length} ${vn(lang, 'bản phát hành', 'releases')} · ${instances.length} ${vn(lang, 'phiên bản đã tạo', 'instances')} · ${vn(lang, 'mới nhất', 'latest')} ${latestRelease || '—'}`}
      >
        <button
          onClick={onOpenVersions}
          className="h-9 px-3 rounded-lg text-xs font-semibold flex items-center gap-2 transition-colors"
          style={{ background: c.input, border: `1px solid ${c.border}`, color: c.label }}
        >
          <Cube size={14} weight="duotone" />
          {t(lang, 'sidebar.versions')}
          <ArrowRight size={12} />
        </button>
        <button
          onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}
          data-tip={t(lang, 'settings.theme')}
          className="w-9 h-9 rounded-lg flex items-center justify-center transition-all hover:opacity-80 active:scale-95"
          style={{ background: c.input, border: `1px solid ${c.border}`, color: c.label }}
        >
          {theme === 'light' ? (
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
            </svg>
          ) : (
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <circle cx="12" cy="12" r="4" />
              <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
            </svg>
          )}
        </button>
      </PageHeader>

      <div className="p-6">
        <div className="max-w-5xl mx-auto flex flex-col gap-6">
          <Section c={c} title={vn(lang, 'Sẵn sàng chơi', 'Ready to play')} hint={`${running ? `${running} ${vn(lang, 'đang chạy', 'running')}` : vn(lang, 'không có tiến trình', 'nothing running')}`}>
            <div className="group relative rounded-xl overflow-hidden transition-transform duration-300 hover:scale-[1.005]" style={{ border: `1px solid ${c.border}` }}>
              <img
                src="./Minecraft_backgound.png"
                alt=""
                className="absolute inset-0 w-full h-full object-cover transition-transform duration-700 group-hover:scale-[1.04]"
              />
              <div className="absolute inset-0" style={{ background: 'linear-gradient(100deg, rgba(0,0,0,0.95) 0%, rgba(0,0,0,0.78) 44%, rgba(0,0,0,0.42) 100%)' }} />
              <div className="relative z-10 p-5 flex flex-col gap-4">
                {activeInstance ? (
                  <>
                    <div className="flex items-center gap-4">
                      <button
                        disabled={!!(activeProgress && activeProgress.phase !== 'done') || activeInstance.status === 'stopping'}
                        onClick={() => (activeBusy ? onStop(activeInstance) : onLaunch(activeInstance))}
                        className="relative w-[84px] h-[84px] rounded-2xl flex items-center justify-center overflow-hidden shrink-0 transition-all duration-200 hover:scale-[1.05] active:scale-95 disabled:opacity-60"
                        style={{
                          background: activeStarting || installing ? 'rgba(234,179,8,0.94)' : activeRunning ? 'rgba(239,68,68,0.94)' : 'rgba(34,197,94,0.94)',
                          border: `2px solid ${activeStarting || installing ? '#eab308' : activeRunning ? '#ef4444' : '#22c55e'}`,
                          boxShadow: `0 0 20px ${activeStarting || installing ? 'rgba(234,179,8,0.42)' : activeRunning ? 'rgba(239,68,68,0.4)' : 'rgba(34,197,94,0.36)'}`,
                          color: activeStarting || installing ? '#1a1405' : activeRunning ? '#fff' : '#04140a',
                        }}
                        data-tip={activeBusy ? t(lang, 'instance.stop') : t(lang, 'home.playNow')}
                      >
                        {activeRunning ? <Stop size={34} weight="fill" /> : <Play size={38} weight="fill" />}
                        {activeStarting && <span className="absolute inset-0 rounded-2xl launch-pulse" style={{ background: 'rgba(234,179,8,0.35)' }} />}
                        {(activeStarting || installing) && (
                          <span className="absolute inset-0 flex items-center justify-center">
                            <ArrowsClockwise size={32} weight="bold" className="animate-spin" />
                          </span>
                        )}
                      </button>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="w-1.5 h-1.5 rounded-full" style={{ background: statusColor(activeInstance.status) }} />
                          <span className="text-[10px] font-semibold uppercase tracking-[0.16em]" style={{ color: 'rgba(255,255,255,0.6)' }}>
                            {t(lang, statusKey(activeInstance.status))}
                          </span>
                        </div>
                        <p className="text-2xl font-bold truncate" style={{ color: '#fff' }}>{activeInstance.name}</p>
                        <div className="mt-2 flex items-center gap-1.5 flex-wrap">
                          <Chip>{activeInstance.loader}{activeInstance.loaderVersion ? ` ${activeInstance.loaderVersion}` : ''}</Chip>
                          <Chip>{activeInstance.version}</Chip>
                          <Chip>{activeInstance.memoryMb} MB</Chip>
                          {activeStarting && <Chip dim>{vn(lang, 'đang nạp game…', 'loading the game…')}</Chip>}
                        </div>
                        {(activeProgress || activeError) && (
                          <p className="mt-2 text-[10px] font-mono truncate" style={{ color: activeError ? '#f87171' : 'rgba(255,255,255,0.7)' }}>
                            {activeError || activeProgress.file || ''}
                          </p>
                        )}
                      </div>
                      <button
                        onClick={() => onSelectInstance(activeInstance)}
                        className="shrink-0 h-9 px-3.5 rounded-lg text-[11px] font-semibold self-start transition-colors"
                        style={{ background: 'rgba(255,255,255,0.16)', border: '1px solid rgba(255,255,255,0.2)', color: '#fff' }}
                      >
                        {vn(lang, 'Mở', 'Open')}
                      </button>
                    </div>

                    <div className="h-px" style={{ background: 'rgba(255,255,255,0.12)' }} />

                    <div className="flex items-center gap-8">
                      {[
                        { icon: <Memory size={16} weight="duotone" />, label: 'RAM', value: `${activeInstance.memoryMb} MB` },
                        { icon: <Cube size={16} weight="duotone" />, label: vn(lang, 'Trình tải', 'Loader'), value: activeInstance.loaderVersion ? `${activeInstance.loader} ${activeInstance.loaderVersion}` : activeInstance.loader },
                        { icon: <Clock size={16} weight="duotone" />, label: vn(lang, 'Thời gian chơi', 'Playtime'), value: formatPlaytime(activeInstance.playtimeMs) },
                        { icon: <CalendarBlank size={16} weight="duotone" />, label: vn(lang, 'Lần chơi cuối', 'Last played'), value: activeInstance.lastPlayed ? timeAgo(activeInstance.lastPlayed, lang) : vn(lang, 'chưa chơi', 'never played') },
                      ].map((s) => (
                        <div key={s.label} className="flex items-center gap-2">
                          <span style={{ color: 'rgba(255,255,255,0.6)' }}>{s.icon}</span>
                          <div>
                            <p className="text-[9px] font-semibold uppercase tracking-wide" style={{ color: 'rgba(255,255,255,0.55)' }}>{s.label}</p>
                            <p className="text-[12px] font-bold truncate" style={{ color: '#fff' }}>{s.value}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </>
                ) : (
                  <div className="flex items-center gap-5 py-3">
                    <span className="w-20 h-20 rounded-2xl flex items-center justify-center shrink-0" style={{ background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.16)' }}>
                      <Cube size={30} weight="duotone" color="#fff" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-xl font-bold" style={{ color: '#fff' }}>{vn(lang, 'Chưa có phiên bản nào', 'No instances yet')}</p>
                      <p className="mt-1 text-[12px]" style={{ color: 'rgba(255,255,255,0.66)' }}>
                        {vn(lang, `Tạo phiên bản từ Minecraft ${latestRelease || '—'} để bắt đầu chơi.`, `Create an instance from Minecraft ${latestRelease || '—'} to get started.`)}
                      </p>
                      <p className="mt-3 text-[10px] font-mono" style={{ color: 'rgba(255,255,255,0.5)' }}>
                        {versions.length} {vn(lang, 'bản phát hành', 'releases')} · {LOADERS.length} {vn(lang, 'trình tải', 'loaders')} {vn(lang, 'sẵn sàng', 'available')}
                      </p>
                    </div>
                    <button
                      onClick={onOpenVersions}
                      className="shrink-0 h-10 px-4 rounded-lg text-[12px] font-bold"
                      style={{ background: 'rgba(255,255,255,0.94)', color: '#111' }}
                    >
                      {t(lang, 'versions.create')}
                    </button>
                  </div>
                )}
              </div>
            </div>
          </Section>

          <Section
            c={c}
            title={vn(lang, 'Bản phát hành', 'Releases')}
            hint={`${versions.length} ${vn(lang, 'bản', 'total')}`}
            action={(
              <button onClick={onOpenVersions} className="text-[10px] font-semibold flex items-center gap-1 shrink-0" style={{ color: c.accent }}>
                {vn(lang, 'Xem tất cả', 'View all')}
                <ArrowRight size={11} />
              </button>
            )}
          >
            <div className="grid grid-cols-[1.15fr_1fr] gap-3">
              <Card c={c} className="p-4 flex flex-col gap-3.5">
                <div className="flex items-start gap-3.5">
                  <span className="w-12 h-12 rounded-xl flex items-center justify-center shrink-0" style={{ background: c.input, border: `1px solid ${c.border}` }}>
                    <img src="./loader-icon/vanilla.png" alt="" className="w-8 h-8 object-contain" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-xl font-bold font-mono tabular-nums leading-none" style={{ color: c.text }}>{latestRelease || '—'}</span>
                      <span className="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase" style={{ background: 'rgba(167,139,250,0.16)', color: c.accent }}>
                        {vn(lang, 'mới nhất', 'latest')}
                      </span>
                    </div>
                    <p className="mt-1.5 text-[11px]" style={{ color: c.label }}>
                      {vn(lang, 'Phát hành', 'Released')} {formatDate(latestRow?.releaseTime, lang) || '—'}
                      {latestRow?.releaseTime ? ` · ${timeAgo(latestRow.releaseTime, lang)}` : ''}
                    </p>
                    {latest?.snapshot && (
                      <p className="mt-0.5 text-[10px] font-mono" style={{ color: c.faint }}>
                        {vn(lang, 'Bản thử nghiệm', 'Snapshot')}: {latest.snapshot}
                      </p>
                    )}
                  </div>
                </div>

                <div className="flex flex-col gap-1 pt-3" style={{ borderTop: `1px solid ${c.border}` }}>
                  <p className="text-[10px] font-semibold uppercase tracking-wide mb-1" style={{ color: c.faint }}>
                    {vn(lang, 'Trình tải hỗ trợ bản này', 'Loaders for this release')}
                  </p>
                  {LOADERS.map((loader) => {
                    const info = loaderInfo?.[loader.id]
                    return (
                      <div key={loader.id} className="flex items-center gap-2.5 h-7">
                        <img src={loaderIcon(loader.id)} alt="" className="w-4 h-4 object-contain shrink-0" />
                        <span className="text-[11px] font-semibold w-16 shrink-0" style={{ color: c.text }}>{loader.name}</span>
                        {!info ? (
                          <Skeleton c={c} w="130px" />
                        ) : info.supported ? (
                          <>
                            <Check size={11} weight="bold" style={{ color: '#22c55e' }} />
                            <span className="text-[11px] font-mono tabular-nums" style={{ color: c.label }}>{info.build}</span>
                          </>
                        ) : (
                          <>
                            <Minus size={11} weight="bold" style={{ color: c.faint }} />
                            <span className="text-[10px]" style={{ color: c.faint }}>{vn(lang, 'chưa phát hành cho bản này', 'not released for this version')}</span>
                          </>
                        )}
                        {info?.games ? (
                          <span className="ml-auto text-[10px] font-mono tabular-nums shrink-0" style={{ color: c.faint }}>
                            {info.games} {vn(lang, 'phiên bản', 'versions')}
                          </span>
                        ) : null}
                      </div>
                    )
                  })}
                </div>

                <button
                  onClick={onOpenVersions}
                  className="h-9 rounded-lg text-[11px] font-bold transition-all hover:opacity-90 active:scale-[0.99]"
                  style={{ background: c.accent, color: '#0a0a0a' }}
                >
                  {vn(lang, `Tạo phiên bản với ${latestRelease || ''}`, `Create with ${latestRelease || ''}`)}
                </button>
              </Card>

              <Card c={c} className="p-2">
                {loading && !releases.length ? (
                  <div className="p-2 flex flex-col gap-2">
                    {[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} c={c} w={`${80 - i * 8}%`} />)}
                  </div>
                ) : releases.length === 0 ? (
                  <p className="px-3 py-6 text-[11px]" style={{ color: c.label }}>
                    {vn(lang, 'Không tải được danh sách phiên bản.', 'Could not load the release list.')}
                  </p>
                ) : (
                  releases.map((v, i) => {
                    const isLatest = i === 0
                    return (
                      <div key={v.id} className="relative flex items-center gap-3 h-8 px-2 rounded-lg" style={{ background: isLatest ? c.input : 'transparent' }}>
                        {i < releases.length - 1 && (
                          <span className="absolute w-px" style={{ left: 14, top: 16, bottom: -16, background: c.border }} />
                        )}
                        <span
                          className="relative z-10 w-1.5 h-1.5 rounded-full shrink-0 ml-[3px]"
                          style={{ background: isLatest ? c.accent : c.faint, boxShadow: isLatest ? `0 0 0 3px ${c.accent}22` : 'none' }}
                        />
                        <span className="text-[11px] font-bold font-mono tabular-nums w-[74px] shrink-0" style={{ color: isLatest ? c.accent : c.text }}>{v.id}</span>
                        <span className="text-[10px] font-mono shrink-0" style={{ color: c.faint }}>{formatDate(v.releaseTime, lang) || '—'}</span>
                        <span className="ml-auto text-[10px] font-mono shrink-0" style={{ color: c.faint }}>{timeAgo(v.releaseTime, lang)}</span>
                      </div>
                    )
                  })
                )}
              </Card>
            </div>
          </Section>

          <Section c={c} title={vn(lang, 'Trình tải mod', 'Mod loaders')} hint={vn(lang, 'bản mới nhất cho', 'latest build for') + ` ${latestRelease || '—'}`}>
            <div className="grid grid-cols-3 gap-3">
              {LOADERS.map((loader) => {
                const info = loaderInfo?.[loader.id]
                return (
                  <Card key={loader.id} c={c} className="p-3.5 flex items-start gap-3">
                    <span className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0" style={{ background: c.input, border: `1px solid ${c.border}` }}>
                      <img src={loaderIcon(loader.id)} alt="" className="w-6 h-6 object-contain" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-bold" style={{ color: c.text }}>{loader.name}</p>
                      <p className="text-[10px] truncate" style={{ color: c.faint }}>{loader.desc}</p>
                      <p className="mt-1.5 text-[10px] font-mono tabular-nums" style={{ color: c.label }}>
                        {!info ? (
                          <Skeleton c={c} w="90px" />
                        ) : info.build ? (
                          <>
                            {info.build}
                            {info.vanilla ? (
                              <span style={{ color: c.faint }}> · {vn(lang, 'bản gốc', 'vanilla')}</span>
                            ) : info.stable ? (
                              <span style={{ color: '#22c55e' }}> · {vn(lang, 'ổn định', 'stable')}</span>
                            ) : (
                              <span style={{ color: '#eab308' }}> · {vn(lang, 'thử nghiệm', 'beta')}</span>
                            )}
                          </>
                        ) : (
                          <span style={{ color: c.faint }}>{vn(lang, 'không có build', 'no build')}</span>
                        )}
                      </p>
                    </div>
                  </Card>
                )
              })}
            </div>
          </Section>

          {orderedInstances.length > 0 && (
            <Section c={c} title={vn(lang, 'Phiên bản của bạn', 'Your instances')} hint={`${orderedInstances.length} ${vn(lang, 'phiên bản', 'instances')}`}>
              <Card c={c}>
                {orderedInstances.map((inst, i) => {
                  const busy = inst.status === 'running' || inst.status === 'stopping'
                  return (
                    <div
                      key={inst.id}
                      className="group flex items-center gap-3 px-3.5 h-12"
                      style={{ borderTop: i === 0 ? 'none' : `1px solid ${c.border}` }}
                    >
                      <img src={loaderIcon(inst.loader)} alt="" className="w-6 h-6 rounded object-contain shrink-0" />
                      <button onClick={() => onSelectInstance(inst)} className="min-w-0 flex-1 text-left">
                        <p className="text-[11px] font-bold truncate" style={{ color: c.text }}>{inst.name}</p>
                        <p className="text-[10px] font-mono truncate" style={{ color: c.faint }}>
                          {inst.loader}{inst.loaderVersion ? ` ${inst.loaderVersion}` : ''} · {inst.version} · {inst.memoryMb} MB
                        </p>
                      </button>
                      <span className="hidden md:flex items-center gap-1.5 text-[10px] font-mono shrink-0" style={{ color: c.faint }}>
                        <Clock size={11} />
                        {inst.lastPlayed ? timeAgo(inst.lastPlayed, lang) : vn(lang, 'chưa chơi', 'never played')}
                      </span>
                      <span className="flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[10px] font-bold shrink-0"
                        style={{ background: `${statusColor(inst.status)}22`, color: statusColor(inst.status) }}>
                        <span className="w-1.5 h-1.5 rounded-full" style={{ background: statusColor(inst.status) }} />
                        {t(lang, statusKey(inst.status))}
                      </span>
                      <button
                        disabled={inst.status === 'installing'}
                        onClick={() => (busy ? onStop(inst) : onLaunch(inst))}
                        data-tip={busy ? t(lang, 'instance.stop') : t(lang, 'instance.launch')}
                        className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 transition-colors disabled:opacity-40"
                        style={{ background: busy ? 'rgba(239,68,68,0.14)' : 'rgba(34,197,94,0.14)', color: busy ? '#ef4444' : '#22c55e' }}
                      >
                        {busy ? <Stop size={13} weight="fill" /> : <Play size={13} weight="fill" />}
                      </button>
                    </div>
                  )
                })}
              </Card>
            </Section>
          )}

          <Section c={c} title={vn(lang, 'Hệ thống & lưu trữ', 'System & storage')}>
            <div className="grid grid-cols-2 gap-3">
              <Card c={c} className="p-4 flex flex-col gap-3.5">
                {system ? (
                  <>
                    <Meter c={c} label={t(lang, 'home.ram')} used={ramUsed} total={system.totalMem} color={c.accent} />
                    <Meter c={c} label={t(lang, 'home.disk')} used={disk.total - disk.free} total={disk.total} color="#22c55e" />
                    <div className="flex flex-col gap-1.5 pt-1" style={{ borderTop: `1px solid ${c.border}` }}>
                      <Fact c={c} label={t(lang, 'home.cpu')} value={`${system.cpuThreads} ${t(lang, 'home.cores')}`} />
                      <Fact c={c} label={vn(lang, 'Kiến trúc', 'Arch')} value={`${system.platform} ${system.arch}`} />
                    </div>
                    <p className="text-[9px] font-mono truncate" style={{ color: c.faint }} title={system.cpuModel}>{system.cpuModel}</p>
                  </>
                ) : (
                  <div className="flex flex-col gap-2.5">
                    {[0, 1, 2, 3].map((i) => <Skeleton key={i} c={c} w={`${85 - i * 10}%`} />)}
                  </div>
                )}
              </Card>

              <Card c={c} className="p-4 flex flex-col gap-2.5">
                <Fact c={c} label={vn(lang, 'Thư mục chung', 'Shared folder')} value={sharedDir || '—'} title={sharedDir} />
                <Fact c={c} label={vn(lang, 'Dung lượng tài nguyên', 'Assets on disk')} value={system ? formatBytes(system.cacheBytes || 0) : '—'} />
                <Fact
                  c={c}
                  label="Java"
                  value={runtimes ? `${runtimes.count} ${vn(lang, 'bản', 'runtimes')} · ${formatBytes(runtimes.bytes)}` : '—'}
                  title={runtimes?.list?.map((r) => `Java ${r.major} (${r.name})`).join(', ')}
                />
                <Fact c={c} label={vn(lang, 'Java mặc định', 'Java override')} value={vn(lang, 'Java tải kèm', 'bundled runtime')} mono={false} />
                <button
                  onClick={() => api.revealPath(sharedDir).catch(() => {})}
                  className="mt-auto h-8 rounded-lg text-[10px] font-semibold flex items-center justify-center gap-1.5 transition-colors"
                  style={{ background: c.input, border: `1px solid ${c.border}`, color: c.label }}
                >
                  <FolderOpen size={12} weight="duotone" />
                  {t(lang, 'settings.openFolder')}
                </button>
              </Card>
            </div>
          </Section>

          {!system && (
            <span className="flex items-center gap-2 text-[10px]" style={{ color: c.faint }}>
              <ArrowsClockwise size={11} className="animate-spin" />
              {vn(lang, 'Đang đọc thông tin hệ thống…', 'Reading system info…')}
            </span>
          )}
        </div>
      </div>
    </div>
  )
}

function Chip({ children, dim }) {
  return (
    <span
      className="px-1.5 py-0.5 rounded text-[10px] font-mono"
      style={{
        background: dim ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.12)',
        border: '1px solid rgba(255,255,255,0.16)',
        color: dim ? 'rgba(255,255,255,0.6)' : 'rgba(255,255,255,0.82)',
      }}
    >
      {children}
    </span>
  )
}
