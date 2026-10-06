import { useEffect, useMemo, useState } from 'react'
import { ArrowsClockwise, Globe, Check, MagnifyingGlass, FolderOpen, WarningCircle, SpinnerGap, PlayCircle } from '@phosphor-icons/react'
import { t } from '../../i18n/translations'
import { palette } from '../../lib/palette'
import { formatDate } from '../../lib/status'
import PageHeader from '../ui/PageHeader'
import ProgressBar from '../ui/ProgressBar'
import Select from '../ui/Select'
import HeadSkin from '../ui/HeadSkin'
import * as api from '../../api/client.js'

const MEMORY_STEPS = [1024, 2048, 3072, 4096, 6144, 8192, 12288, 16384]
const DRAFT_KEY = 'luns.version-draft'

function readDraft() {
  try {
    return JSON.parse(sessionStorage.getItem(DRAFT_KEY)) || {}
  } catch {
    return {}
  }
}

export default function VersionsPage({
  theme, lang, versions, latest, source, loading, error, snapshots, defaultInstanceDir,
  progress, activeAccount, onToggleSnapshots, onRefresh, onOpenAccounts, onCreate,
}) {
  const c = palette(theme)
  const draft = readDraft()
  const [loader, setLoader] = useState(draft.loader || 'vanilla')
  const [builds, setBuilds] = useState([])
  const [build, setBuild] = useState(draft.build || '')
  const [buildsLoading, setBuildsLoading] = useState(false)
  const [buildsError, setBuildsError] = useState('')
  const [picked, setPicked] = useState(draft.picked || null)
  const [query, setQuery] = useState('')
  const [visible, setVisible] = useState(50)
  const [name, setName] = useState(draft.name || '')
  const [dir, setDir] = useState(draft.dir || '')
  const [memoryMb, setMemoryMb] = useState(draft.memoryMb || 4096)
  const [demo, setDemo] = useState(!!draft.demo)
  const [busy, setBusy] = useState(false)
  const [formError, setFormError] = useState('')
  const [supported, setSupported] = useState(null)
  const [gamesLoading, setGamesLoading] = useState(false)
  const [noBuilds, setNoBuilds] = useState(false)

  useEffect(() => {
    if (loader === 'vanilla') {
      setSupported(null)
      return undefined
    }
    let alive = true
    setGamesLoading(true)
    api
      .listLoaderGames({ kind: loader })
      .then((res) => {
        if (!alive) return
        const games = res?.games || []
        setSupported(games.length ? new Set(games.map((g) => g.version)) : null)
      })
      .catch(() => { if (alive) setSupported(null) })
      .finally(() => { if (alive) setGamesLoading(false) })
    return () => { alive = false }
  }, [loader])

  const activeLoader = api.LOADERS.find((l) => l.id === loader) || api.LOADERS[0]

  useEffect(() => {
    if (!picked || !supported || supported.has(picked)) return
    const missing = picked
    setPicked(null)
    setFormError(
      `${activeLoader.name} ${lang === 'vi' ? 'không hỗ trợ Minecraft' : 'does not support Minecraft'} ${missing}`,
    )
  }, [picked, supported, activeLoader.name, lang])

  useEffect(() => {
    try {
      sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ loader, build, picked, name, dir, memoryMb, demo }))
    } catch {}
  }, [loader, build, picked, name, dir, memoryMb, demo])

  useEffect(() => {
    setVisible(50)
  }, [query, snapshots])

  useEffect(() => {
    if (loader === 'vanilla' || !picked) {
      setBuilds([])
      setBuild('')
      setBuildsError('')
      setNoBuilds(false)
      return undefined
    }
    let alive = true
    setBuildsLoading(true)
    setBuildsError('')
    setNoBuilds(false)
    api
      .listLoaderVersions({ kind: loader, game: picked })
      .then((res) => {
        if (!alive) return
        const rows = res?.versions || []
        setBuilds(rows)
        setBuild((prev) => (rows.some((r) => r.version === prev) ? prev : (rows[0]?.version || '')))
        setNoBuilds(!rows.length)
      })
      .catch((err) => {
        if (alive) setBuildsError(err?.message || 'error')
      })
      .finally(() => {
        if (alive) setBuildsLoading(false)
      })
    return () => { alive = false }
  }, [loader, picked, lang])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    const rows = q ? versions.filter((v) => v.id.toLowerCase().includes(q)) : versions
    return rows
  }, [versions, query])

  const slug = String(name || (picked ? `${activeLoader.name}-${picked}` : 'instance')).replace(/[^\w.-]+/g, '-')
  const targetDir = dir || (defaultInstanceDir ? `${defaultInstanceDir}\\${slug}` : '')
  const activeProgress = progress ? Object.values(progress).find((p) => p.phase !== 'done' && p.phase !== 'error') : null

  const pickDir = async () => {
    try {
      const res = await api.chooseDirectory({ defaultPath: dir || defaultInstanceDir })
      if (res?.ok) setDir(res.path)
      else if (res?.error) setFormError(res.error)
    } catch (err) {
      setFormError(err.message)
    }
  }

  const submit = async () => {
    setFormError('')
    if (!picked) return setFormError(lang === 'vi' ? 'Chưa chọn phiên bản game.' : 'Pick a game version.')
    const label = name.trim() || `${activeLoader.name} ${picked}`
    if (loader !== 'vanilla' && !build) {
      return setFormError(lang === 'vi' ? 'Chưa chọn bản build của loader.' : 'Pick a loader build.')
    }
    setBusy(true)
    try {
      const res = await onCreate({
        name: label,
        version: picked,
        loader,
        loaderVersion: loader === 'vanilla' ? null : build,
        memoryMb,
        demo,
        dir: targetDir,
      })
      if (!res?.ok) setFormError(res?.error || 'error')
    } catch (err) {
      setFormError(err?.message || 'error')
    } finally {
      setBusy(false)
    }
  }

  const disabled = busy || !!activeProgress

  return (
    <div data-surface className="h-full flex flex-col overflow-hidden" style={{ background: c.bg }}>
      <PageHeader theme={theme} title={t(lang, 'versions.title')} subtitle={t(lang, 'versions.subtitle')}>
        <span
          className="h-9 px-2.5 rounded-lg text-[10px] font-semibold flex items-center gap-1.5"
          style={{ background: c.input, border: `1px solid ${c.border}`, color: c.label }}
        >
          <Globe size={12} weight="duotone" />
          {source === 'mojang' ? t(lang, 'versions.sourceMojang') : source}
        </span>
        <button
          onClick={() => onToggleSnapshots(!snapshots)}
          className="h-9 px-3 rounded-lg text-[11px] font-semibold transition-colors"
          style={{
            background: snapshots ? 'rgba(167,139,250,0.14)' : c.input,
            border: `1px solid ${snapshots ? 'rgba(167,139,250,0.42)' : c.border}`,
            color: snapshots ? c.accent : c.label,
          }}
        >
          {t(lang, 'versions.snapshots')}
        </button>
        <button
          onClick={onRefresh}
          data-tip={lang === 'vi' ? 'Làm mới' : 'Refresh'}
          className="w-9 h-9 rounded-lg flex items-center justify-center transition-all hover:opacity-80 active:scale-95"
          style={{ background: c.input, border: `1px solid ${c.border}`, color: c.label }}
        >
          <ArrowsClockwise size={15} className={loading ? 'animate-spin' : ''} />
        </button>
      </PageHeader>

      <div className="flex-1 min-h-0 flex overflow-hidden">
        <div className="flex-1 min-w-0 flex flex-col px-6 py-4 gap-3">
          <div className="flex items-center gap-2">
            <div className="relative flex-1 max-w-sm">
              <MagnifyingGlass size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: c.label }} />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t(lang, 'home.search')}
                className="w-full h-9 pl-9 pr-3 rounded-lg text-xs outline-none"
                style={{ background: c.input, border: `1px solid ${c.border}`, color: c.text }}
              />
            </div>
            <span className="text-[10px] font-mono" style={{ color: c.faint }}>
              {filtered.length} {lang === 'vi' ? 'kết quả' : 'results'}
            </span>
            {loader !== 'vanilla' && (
              <span className="text-[10px] font-mono" style={{ color: gamesLoading ? c.faint : supported ? c.accent : '#f87171' }}>
                {gamesLoading
                  ? (lang === 'vi' ? 'đang kiểm tra hỗ trợ…' : 'checking support…')
                  : supported
                    ? `${activeLoader.name} ${lang === 'vi' ? 'hỗ trợ' : 'supports'} ${supported.size} ${lang === 'vi' ? 'phiên bản' : 'versions'}`
                    : (lang === 'vi' ? 'không đọc được danh sách hỗ trợ' : 'support list unavailable')}
              </span>
            )}
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto pr-1" style={{ outline: 'none' }}>
            {loading && versions.length === 0 ? (
              <p className="text-xs text-center py-16" style={{ color: c.label }}>{t(lang, 'versions.loading')}</p>
            ) : error && versions.length === 0 ? (
              <div className="text-center py-16">
                <p className="text-sm mb-4" style={{ color: '#f87171' }}>{error}</p>
                <button onClick={onRefresh} className="px-5 py-2 rounded-lg text-xs font-semibold" style={{ background: 'rgba(167,139,250,0.15)', color: c.accent }}>
                  {t(lang, 'versions.retry')}
                </button>
              </div>
            ) : (
              <div className="flex flex-col gap-1">
                {filtered.slice(0, visible).map((v) => {
                  const active = picked === v.id
                  const isLatest = v.id === latest?.release
                  const unsupported = !!supported && !supported.has(v.id)
                  return (
                    <button
                      key={v.id}
                      onClick={() => { if (!unsupported) setPicked(v.id) }}
                      disabled={unsupported}
                      className={`group relative flex items-center gap-3 h-11 px-3 rounded-lg text-left transition-colors ${unsupported ? 'cursor-not-allowed' : ''}`}
                      style={{
                        background: active ? 'rgba(167,139,250,0.12)' : 'transparent',
                        border: `1px solid ${active ? 'rgba(167,139,250,0.45)' : 'transparent'}`,
                        opacity: unsupported ? 0.45 : 1,
                      }}
                    >
                      <img src="./loader-icon/vanilla.png" alt="" className="w-5 h-5 rounded object-contain shrink-0" />
                      <span className="text-xs font-bold font-mono w-32 shrink-0" style={{ color: active ? c.accent : c.text }}>{v.id}</span>
                      <span
                        className="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase shrink-0"
                        style={{
                          background: v.type === 'release' ? 'rgba(34,197,94,0.14)' : 'rgba(234,179,8,0.14)',
                          color: v.type === 'release' ? '#22c55e' : '#eab308',
                        }}
                      >
                        {v.type === 'release' ? t(lang, 'home.release') : t(lang, 'home.snapshot')}
                      </span>
                      {isLatest && (
                        <span className="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase shrink-0"
                          style={{ background: 'rgba(167,139,250,0.16)', color: c.accent }}>
                          Latest
                        </span>
                      )}
                      {unsupported && (
                        <span className="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase shrink-0"
                          style={{ background: 'rgba(239,68,68,0.14)', color: '#f87171' }}>
                          {lang === 'vi' ? 'không hỗ trợ' : 'unsupported'}
                        </span>
                      )}
                      <span className="ml-auto text-[10px] font-mono shrink-0" style={{ color: c.faint }}>
                        {formatDate(v.releaseTime, lang) || '—'}
                      </span>
                      {active && <Check size={14} weight="bold" className="shrink-0" style={{ color: c.accent }} />}
                    </button>
                  )
                })}
                {filtered.length > visible && (
                  <button
                    onClick={() => setVisible((v) => v + 80)}
                    className="h-9 mt-1 rounded-lg text-[11px] font-semibold"
                    style={{ background: c.input, border: `1px solid ${c.border}`, color: c.label }}
                  >
                    {lang === 'vi' ? `Hiện thêm (${filtered.length - visible})` : `Show more (${filtered.length - visible})`}
                  </button>
                )}
              </div>
            )}
          </div>
        </div>

        <aside className="w-[320px] shrink-0 border-l flex flex-col overflow-hidden" style={{ borderColor: c.border }}>
          <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4 flex flex-col gap-4">
          <div className="flex items-center gap-2">
            <img src={`./${activeLoader.image}`} alt="" className="w-7 h-7 rounded-lg object-contain" />
            <div className="min-w-0">
              <p className="text-xs font-bold" style={{ color: c.text }}>{t(lang, 'versions.create')}</p>
              <p className="text-[10px] truncate" style={{ color: c.faint }}>{t(lang, 'versions.pickLoader')}</p>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            {api.LOADERS.map((l) => {
              const active = l.id === loader
              return (
                <button
                  key={l.id}
                  onClick={() => setLoader(l.id)}
                  className="flex-1 h-9 rounded-lg text-[11px] font-semibold transition-colors"
                  style={{
                    background: active ? 'rgba(167,139,250,0.14)' : c.input,
                    border: `1px solid ${active ? 'rgba(167,139,250,0.42)' : c.border}`,
                    color: active ? c.accent : c.label,
                  }}
                >
                  {l.name}
                </button>
              )
            })}
          </div>

          {loader !== 'vanilla' && (
            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: c.faint }}>
                {lang === 'vi' ? 'Bản build loader' : 'Loader build'}
              </label>
              {!picked ? (
                <p className="text-[10px]" style={{ color: c.faint }}>
                  {lang === 'vi' ? 'Chọn phiên bản game trước.' : 'Pick a game version first.'}
                </p>
              ) : buildsLoading ? (
                <span className="flex items-center gap-2 text-[10px]" style={{ color: c.label }}>
                  <SpinnerGap size={12} className="animate-spin" />
                  {lang === 'vi' ? 'Đang tải build…' : 'Loading builds…'}
                </span>
              ) : builds.length ? (
                <Select
                  theme={theme}
                  value={build}
                  onChange={setBuild}
                  placeholder={lang === 'vi' ? 'Chọn build…' : 'Select build…'}
                  options={builds.map((b) => ({
                    value: b.version,
                    label: b.version,
                    hint: b.build ? `build ${b.build}` : '',
                    tags: [
                      ...(b.latest ? ['latest'] : []),
                      b.stable ? (lang === 'vi' ? 'ổn định' : 'stable') : (lang === 'vi' ? 'thử nghiệm' : 'beta'),
                    ],
                  }))}
                />
              ) : noBuilds ? (
                <div className="flex flex-col gap-1">
                  <p className="text-[10px] font-semibold" style={{ color: '#f87171' }}>
                    {activeLoader.name} {lang === 'vi' ? 'không có bản build cho Minecraft' : 'has no build for Minecraft'} {picked}
                  </p>
                  <p className="text-[10px] leading-relaxed" style={{ color: c.faint }}>
                    {lang === 'vi'
                      ? 'Loader này không phát hành cho phiên bản game đó. Chọn phiên bản khác (bản có tag "không hỗ trợ" sẽ không dùng được).'
                      : 'This loader has no release for that game version. Pick another version (rows tagged "unsupported" will not work).'}
                  </p>
                </div>
              ) : (
                <p className="text-[10px]" style={{ color: '#f87171' }}>{buildsError}</p>
              )}
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            <label className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: c.faint }}>
              {t(lang, 'versions.pickVersion')}
            </label>
            <div className="h-9 px-2.5 rounded-lg flex items-center gap-2" style={{ background: c.input, border: `1px solid ${c.border}` }}>
              <span className="text-[11px] font-mono font-bold" style={{ color: picked ? c.accent : c.faint }}>
                {picked || (lang === 'vi' ? 'chưa chọn' : 'not selected')}
              </span>
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: c.faint }}>
              {lang === 'vi' ? 'Tên phiên bản' : 'Instance name'}
            </label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={picked ? `${activeLoader.name} ${picked}` : 'my-instance'}
              className="h-9 px-2.5 rounded-lg text-[11px] outline-none"
              style={{ background: c.input, border: `1px solid ${c.border}`, color: c.text }}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: c.faint }}>
              {lang === 'vi' ? 'Thư mục lưu instance' : 'Install folder'}
            </label>
            <div className="flex items-center gap-1.5">
              <div className="flex-1 min-w-0 h-9 px-2.5 rounded-lg flex items-center" style={{ background: c.input, border: `1px solid ${c.border}` }}>
                <span className="text-[10px] font-mono truncate" style={{ color: c.label }} title={targetDir}>{targetDir || '—'}</span>
              </div>
              <button
                onClick={pickDir}
                data-tip={t(lang, 'settings.openFolder')}
                className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
                style={{ background: c.input, border: `1px solid ${c.border}`, color: c.label }}
              >
                <FolderOpen size={14} weight="duotone" />
              </button>
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: c.faint }}>
              {t(lang, 'settings.memory')} · {memoryMb} MB
            </label>
            <input
              type="range"
              min="1024"
              max="16384"
              step="512"
              value={memoryMb}
              onChange={(e) => setMemoryMb(Number(e.target.value))}
              className="w-full accent-[#a78bfa]"
            />
            <div className="flex items-center gap-1">
              {MEMORY_STEPS.slice(0, 5).map((step) => (
                <button
                  key={step}
                  onClick={() => setMemoryMb(step)}
                  className="flex-1 h-6 rounded text-[9px] font-mono"
                  style={{
                    background: memoryMb === step ? 'rgba(167,139,250,0.16)' : c.input,
                    color: memoryMb === step ? c.accent : c.faint,
                  }}
                >
                  {step >= 1024 ? `${step / 1024}G` : step}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: c.faint }}>
              {t(lang, 'instance.settings.player')}
            </label>
            <div
              className="h-9 px-2.5 rounded-lg flex items-center gap-2"
              style={{ background: c.input, border: `1px solid ${c.border}` }}
            >
              {activeAccount ? (
                <>
                  <HeadSkin name={activeAccount.name} uuid={activeAccount.uuid} size={20} radius={5} theme={theme} />
                  <span className="text-[11px] font-medium truncate" style={{ color: c.text }}>{activeAccount.name}</span>
                  <span className="flex-1" />
                  <button onClick={onOpenAccounts} className="text-[10px] font-semibold shrink-0" style={{ color: c.accent }}>
                    {t(lang, 'instance.settings.changeAccount')}
                  </button>
                </>
              ) : (
                <>
                  <span className="text-[10px] flex-1" style={{ color: '#f59e0b' }}>{t(lang, 'instance.settings.noAccount')}</span>
                  <button onClick={onOpenAccounts} className="text-[10px] font-semibold shrink-0" style={{ color: c.accent }}>
                    {t(lang, 'instance.settings.addAccount')}
                  </button>
                </>
              )}
            </div>
          </div>

          <div
            className="flex items-center gap-3 px-2.5 py-2 rounded-lg"
            style={{ background: demo ? 'rgba(167,139,250,0.1)' : c.input, border: `1px solid ${demo ? 'rgba(167,139,250,0.42)' : c.border}` }}
          >
            <PlayCircle size={14} weight="duotone" style={{ color: demo ? c.accent : c.faint }} />
            <div className="flex-1 min-w-0">
              <p className="text-[11px] font-semibold" style={{ color: demo ? c.accent : c.text }}>
                {t(lang, 'versions.demo')}
              </p>
              <p className="text-[9px] leading-tight" style={{ color: c.faint }}>{t(lang, 'versions.demoHint')}</p>
            </div>
            <button
              onClick={() => setDemo((v) => !v)}
              aria-pressed={demo}
              data-tip={t(lang, 'versions.demo')}
              className="relative w-9 h-5 rounded-full shrink-0 transition-colors"
              style={{ background: demo ? c.accent : c.input, border: `1px solid ${c.border}` }}
            >
              <span
                className="absolute top-0.5 w-3.5 h-3.5 rounded-full transition-all"
                style={{ left: demo ? 18 : 3, background: demo ? '#12081f' : c.label }}
              />
            </button>
          </div>

          <p className="text-[9px] leading-relaxed" style={{ color: c.faint }}>
            {lang === 'vi'
              ? 'Tài nguyên gốc (client jar, thư viện, assets) tải vào thư mục dùng chung và tái sử dụng cho mọi phiên bản.'
              : 'Game files (client jar, libraries, assets) are downloaded once into the shared folder and reused by every version.'}
          </p>
        </div>

        <div className="shrink-0 px-5 py-3 flex flex-col gap-2.5" style={{ borderTop: `1px solid ${c.border}`, background: c.surface }}>
          {formError && (
            <div className="flex items-start gap-2 rounded-lg px-2.5 py-2" style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.28)' }}>
              <WarningCircle size={13} weight="duotone" className="shrink-0 mt-0.5" style={{ color: '#f87171' }} />
              <span className="text-[10px] leading-relaxed" style={{ color: '#f87171' }}>{formError}</span>
            </div>
          )}

          {activeProgress && <ProgressBar theme={theme} lang={lang} progress={activeProgress} />}

          <button
            onClick={submit}
            disabled={disabled}
            className="h-10 rounded-lg text-xs font-bold transition-all hover:opacity-90 active:scale-95 disabled:opacity-50"
            style={{ background: c.accent, color: '#0a0a0a' }}
          >
            {busy || activeProgress ? (lang === 'vi' ? 'Đang tạo…' : 'Creating…') : t(lang, 'versions.create')}
          </button>
        </div>
      </aside>
      </div>
    </div>
  )
}
