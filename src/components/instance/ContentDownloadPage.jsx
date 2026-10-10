import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  MagnifyingGlass, ArrowsClockwise, DownloadSimple, X, Package,
  CheckCircle, WarningCircle, ArrowLeft, CaretRight, Download, CaretDown,
  Info, Tag, Images, ArrowSquareOut, Sparkle, ClockCounterClockwise,
  Users, LinkSimple, Cube,
} from '@phosphor-icons/react'
import { palette } from '../../lib/palette'
import { timeAgo, formatDate } from '../../lib/status'
import Select from '../ui/Select'
import HoverPreview from '../ui/HoverPreview'
import ProgressBar from '../ui/ProgressBar'
import RichText from './RichText'
import { Box, Chips, Stat, Leader, Banner, EnvRow, EnvChip, ReleaseChip, gameVersionList, followersOf, bytes, compact } from './catalogBits'
import { loaderIcon, envIcon } from '../../api/client'
import * as api from '../../api/client.js'

const vn = (lang, vi, en) => (lang === 'vi' ? vi : en)
const PAGE = 20
const FADE_MS = 190

const SOURCES = [
  { id: 'modrinth', name: 'Modrinth' },
  { id: 'curseforge', name: 'CurseForge' },
]

const SORT_LABELS = {
  relevance: ['Liên quan', 'Relevance'],
  downloads: ['Tải nhiều', 'Most downloaded'],
  newest: ['Mới nhất', 'Newest'],
  updated: ['Vừa cập nhật', 'Recently updated'],
}

const ENVS = ['client', 'server', 'both']

const ENV_LABELS = {
  client: ['Máy khách', 'Client'],
  server: ['Máy chủ', 'Server'],
  both: ['Cả hai', 'Both'],
}

const LOADERS = { vanilla: 'Vanilla', fabric: 'Fabric', quilt: 'Quilt', forge: 'Forge', neoforge: 'NeoForge' }

const TABS = {
  mods: [
    { key: 'about', label: ['Tổng quan', 'Overview'], icon: Info },
    { key: 'versions', label: ['Bản phát hành', 'Versions'], icon: Tag },
    { key: 'changelog', label: ['Nhật ký thay đổi', 'Changelog'], icon: ClockCounterClockwise },
    { key: 'gallery', label: ['Thư viện ảnh', 'Gallery'], icon: Images },
  ],
  shaderpacks: [
    { key: 'about', label: ['Tổng quan', 'Overview'], icon: Info },
    { key: 'versions', label: ['Bản phát hành', 'Versions'], icon: Tag },
    { key: 'changelog', label: ['Nhật ký thay đổi', 'Changelog'], icon: ClockCounterClockwise },
    { key: 'gallery', label: ['Thư viện ảnh', 'Gallery'], icon: Images },
  ],
  resourcepacks: [
    { key: 'about', label: ['Tổng quan', 'Overview'], icon: Info },
    { key: 'versions', label: ['Bản phát hành', 'Versions'], icon: Tag },
    { key: 'changelog', label: ['Nhật ký thay đổi', 'Changelog'], icon: ClockCounterClockwise },
    { key: 'gallery', label: ['Thư viện ảnh', 'Gallery'], icon: Images },
  ],
}

export default function ContentDownloadPage({ instance, theme, lang, kind, progress, onBack, onInstalled }) {
  const c = palette(theme)
  const labels = {
    mods: [vn(lang, 'Tải mod', 'Download mods'), vn(lang, 'mod', 'mod')],
    shaderpacks: [vn(lang, 'Tải shader', 'Download shaders'), vn(lang, 'shader', 'shader')],
    resourcepacks: [vn(lang, 'Tải gói tài nguyên', 'Download resource packs'), vn(lang, 'gói tài nguyên', 'resource pack')],
  }[kind] || [vn(lang, 'Tải nội dung', 'Download content'), vn(lang, 'nội dung', 'content')]
  const title = labels[0]
  const noun = labels[1]
  const folder = { mods: 'mods', shaderpacks: 'shaderpacks', resourcepacks: 'resourcepacks' }[kind] || 'mods'
  const tabs = TABS[kind] || TABS.mods

  const [view, setView] = useState('list')
  const [fading, setFading] = useState(false)

  const [source, setSource] = useState('modrinth')
  const [sort, setSort] = useState('relevance')
  const [query, setQuery] = useState('')
  const [applied, setApplied] = useState('')
  const [hits, setHits] = useState([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [filterGame, setFilterGame] = useState(instance?.version || '')
  const [filterLoader, setFilterLoader] = useState(instance?.loader || 'vanilla')
  const [filterTag, setFilterTag] = useState('')
  const [filterEnv, setFilterEnv] = useState('')
  const [tagOptions, setTagOptions] = useState([])
  const [envSupported, setEnvSupported] = useState(false)
  const [stuck, setStuck] = useState(false)
  const [updateAsk, setUpdateAsk] = useState(null)

  const [active, setActive] = useState(null)
  const [detail, setDetail] = useState(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [tab, setTab] = useState('about')
  const [versions, setVersions] = useState([])
  const [versionsLoading, setVersionsLoading] = useState(false)
  const [versionId, setVersionId] = useState('')
  const [installing, setInstalling] = useState('')
  const [installError, setInstallError] = useState('')
  const [done, setDone] = useState(null)
  const [lightbox, setLightbox] = useState(null)
  const [openLog, setOpenLog] = useState('')
  const [logs, setLogs] = useState({})

  const reqRef = useRef(0)
  const listRef = useRef(null)
  const detailRef = useRef(null)

  const live = progress?.[instance.id]
  const picked = useMemo(() => versions.find((v) => v.id === versionId) || null, [versions, versionId])
  const latest = versions[0] || null

  const load = useCallback(async ({ reset = true } = {}) => {
    const id = ++reqRef.current
    setLoading(true)
    setError('')
    const offset = reset ? 0 : hits.length
    const res = await api
      .contentSearch({
        kind,
        source,
        query: applied,
        sort,
        offset,
        limit: PAGE,
        instanceId: instance.id,
        game: filterGame,
        loader: filterLoader,
        category: filterTag,
        environment: envSupported && filterEnv ? filterEnv : '',
      })
      .catch((err) => ({ ok: false, error: err.message }))
    if (id !== reqRef.current) return
    setLoading(false)
    if (!res?.ok) {
      setError(res?.error || 'error')
      if (reset) {
        setHits([])
        setTotal(0)
      }
      return
    }
    setTotal(res.total || 0)
    setHits((prev) => (reset ? res.hits : [...prev, ...res.hits]))
  }, [kind, source, applied, sort, hits.length, instance.id, filterGame, filterLoader, filterTag, filterEnv, envSupported])

  useEffect(() => {
    const timer = setTimeout(() => setApplied(query.trim()), 340)
    return () => clearTimeout(timer)
  }, [query])

  useEffect(() => {
    setHits([])
    load({ reset: true })
  }, [kind, source, applied, sort, filterGame, filterLoader, filterTag, filterEnv])

  useEffect(() => {
    let alive = true
    setFilterTag('')
    setFilterEnv('')
    api.contentTags({ kind, source })
      .then((res) => {
        if (!alive) return
        setTagOptions(res?.options || [])
        setEnvSupported(res?.environment === true)
      })
      .catch(() => {
        if (!alive) return
        setTagOptions([])
        setEnvSupported(false)
      })
    return () => { alive = false }
  }, [kind, source])

  const gameOptions = useMemo(() => {
    const set = new Set()
    if (filterGame) set.add(filterGame)
    if (instance?.version) set.add(instance.version)
    for (const hit of hits) for (const version of hit.gameVersions || []) set.add(version)
    return [...set].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).reverse()
  }, [hits, filterGame, instance?.version])

  const loadMore = useCallback(() => {
    if (loading || !hits.length || hits.length >= total) return
    load({ reset: false })
  }, [loading, hits.length, total, load])

  const onListScroll = useCallback((event) => {
    const el = event.currentTarget
    const next = el.scrollTop > 4
    setStuck((prev) => (prev === next ? prev : next))
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 480) loadMore()
  }, [loadMore])

  const swap = useCallback((next) => {
    setFading(true)
    setTimeout(() => {
      setView(next)
      setFading(false)
    }, FADE_MS)
  }, [])

  const openItem = useCallback(async (hit) => {
    setActive(hit)
    setDetail(null)
    setVersions([])
    setVersionId('')
    setTab('about')
    setDone(null)
    setInstallError('')
    setInstalling('')
    setOpenLog('')
    setLogs({})
    swap('detail')
    setDetailLoading(true)
    setVersionsLoading(true)
    const [proj, vers] = await Promise.all([
      api.contentProject({ kind, source: hit.source, id: hit.id }).catch((err) => ({ ok: false, error: err.message })),
      api.contentVersions({ kind, source: hit.source, id: hit.id, instanceId: instance.id }).catch((err) => ({ ok: false, error: err.message, versions: [] })),
    ])
    setDetailLoading(false)
    setVersionsLoading(false)
    if (proj?.ok) setDetail(proj.project)
    const list = vers?.versions || []
    setVersions(list)
    setVersionId(list[0]?.id || '')
  }, [kind, source, instance.id, swap])

  const closeDetail = useCallback(() => {
    swap('list')
  }, [swap])

  const toggleLog = useCallback(async (version) => {
    const id = version.id
    if (openLog === id) {
      setOpenLog('')
      return
    }
    setOpenLog(id)
    if (logs[id]) return
    setLogs((prev) => ({ ...prev, [id]: { loading: true, text: '', format: 'markdown' } }))
    const res = await api
      .contentChangelog({ source: active?.source, id: active?.id, versionId: id })
      .catch((err) => ({ ok: false, error: err.message, text: '', format: 'markdown' }))
    setLogs((prev) => ({
      ...prev,
      [id]: { loading: false, text: res?.text || '', format: res?.format || 'markdown', error: res?.ok ? '' : res?.error || '' },
    }))
  }, [openLog, logs, active])

  const runInstall = useCallback(async (targetId, which, remove = []) => {
    if (!active || !targetId) return
    setInstallError('')
    setDone(null)
    setInstalling(which)
    const res = await api
      .contentInstall({ kind, source: active.source, id: active.id, versionId: targetId, instanceId: instance.id, remove })
      .catch((err) => ({ ok: false, error: err.message }))
    setInstalling('')
    if (!res?.ok) return setInstallError(res?.error || 'error')
    setDone(res)
    onInstalled?.()
  }, [kind, active, instance.id, onInstalled])

  const install = useCallback(async (targetId, which) => {
    if (!active || !targetId) return
    const target = versions.find((v) => v.id === targetId) || latest || {}
    const check = await api
      .contentInstalled({
        kind,
        source: active.source,
        id: active.id,
        versionId: targetId,
        file: target?.file?.filename || '',
        instanceId: instance.id,
      })
      .catch(() => null)
    const matches = check?.ok ? check.matches || [] : []
    if (matches.length) {
      setUpdateAsk({ targetId, which, matches, version: target?.versionNumber || target?.name || '' })
      return
    }
    await runInstall(targetId, which)
  }, [active, versions, latest, kind, instance.id, runInstall])

  const targetLine = instance.loader && instance.loader !== 'vanilla' && kind === 'mods'
    ? `${instance.version} · ${LOADERS[instance.loader] || instance.loader}${instance.loaderVersion ? ` ${instance.loaderVersion}` : ''}`
    : instance.version

  const shot = (url) => url || ''

  const isMod = kind === 'mods'
  const hasFilter =
    filterTag ||
    filterEnv ||
    filterGame !== (instance?.version || '') ||
    filterLoader !== (instance?.loader || 'vanilla')

  const wide = (vertical) => (vertical ? 'w-full' : 'flex-1 min-w-[140px] max-w-[260px]')

  const filters = (vertical) => (
    <>
      <div className={vertical ? 'flex flex-col gap-2' : 'flex items-center gap-2 flex-wrap'}>
        <div className={wide(vertical)}>
          <Select
            theme={theme}
            value={filterGame}
            options={gameOptions.map((value) => ({ value, label: value, icon: loaderIcon('vanilla') }))}
            onChange={setFilterGame}
            placeholder={vn(lang, 'Mọi phiên bản game', 'Any game version')}
          />
        </div>
        {isMod && (
          <div className={wide(vertical)}>
            <Select
              theme={theme}
              value={filterLoader}
              options={Object.keys(LOADERS).map((value) => ({ value, label: LOADERS[value], icon: loaderIcon(value) }))}
              onChange={setFilterLoader}
              placeholder={vn(lang, 'Mọi loader', 'Any loader')}
            />
          </div>
        )}
        <div className={wide(vertical)}>
          <Select
            theme={theme}
            value={filterTag}
            options={tagOptions}
            onChange={setFilterTag}
            placeholder={vn(lang, 'Mọi thẻ', 'Any tag')}
          />
        </div>
        {isMod && (
          <div className={wide(vertical)}>
            <Select
              theme={theme}
              value={filterEnv}
              options={ENVS.map((value) => ({ value, label: vn(lang, ENV_LABELS[value][0], ENV_LABELS[value][1]), icon: envIcon(value) }))}
              onChange={setFilterEnv}
              disabled={!envSupported}
              placeholder={vn(lang, 'Mọi môi trường', 'Any environment')}
            />
          </div>
        )}
        {hasFilter && (
          <button
            onClick={() => {
              setFilterGame(instance?.version || '')
              setFilterLoader(instance?.loader || 'vanilla')
              setFilterTag('')
              setFilterEnv('')
            }}
            className={vertical ? 'h-9 w-full rounded-lg text-[11px] font-semibold' : 'h-9 px-2.5 rounded-lg text-[11px] font-semibold shrink-0'}
            style={{ background: c.input, border: `1px solid ${c.border}`, color: c.label }}
          >
            {vn(lang, 'Xoá lọc', 'Clear')}
          </button>
        )}
        {isMod && !envSupported && (
          <p className="w-full text-[10px] leading-relaxed" style={{ color: c.faint }}>
            {vn(
              lang,
              'CurseForge không trả về dữ liệu máy khách/máy chủ qua API, nên bộ lọc môi trường chỉ dùng được với Modrinth.',
              'CurseForge’s API exposes no client/server data, so the environment filter only works with Modrinth.',
            )}
          </p>
        )}
      </div>

      <div className={vertical ? 'flex flex-col gap-2' : 'flex items-center gap-2.5'}>
        <label className="relative flex-1 min-w-0 flex items-center">
          <MagnifyingGlass size={14} className="absolute left-3 pointer-events-none" style={{ color: c.faint }} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={vn(lang, 'Tìm theo tên…', 'Search by name…')}
            className="w-full h-9 pl-9 pr-8 rounded-lg text-[11px] outline-none"
            style={{ background: c.input, border: `1px solid ${c.border}`, color: c.text }}
          />
          {query && (
            <button onClick={() => setQuery('')} className="absolute right-2.5" style={{ color: c.faint }}>
              <X size={12} weight="bold" />
            </button>
          )}
        </label>
        <div className={vertical ? 'w-full' : 'w-[168px] shrink-0'}>
          <Select
            theme={theme}
            value={sort}
            onChange={setSort}
            options={['relevance', 'downloads', 'newest', 'updated'].map((value) => ({
              value,
              label: vn(lang, SORT_LABELS[value][0], SORT_LABELS[value][1]),
            }))}
          />
        </div>
        <span className={`${vertical ? '' : 'hidden md:inline '}text-[10px] font-mono tabular-nums shrink-0`} style={{ color: c.faint }}>
          {loading && !hits.length ? '· · ·' : `${hits.length}/${total}`}
        </span>
      </div>
    </>
  )

  return (
    <div data-surface className="h-full flex flex-col overflow-hidden" style={{ background: c.bg }}>
      <div className="shrink-0 flex items-center gap-2 px-3 py-2" style={{ borderBottom: `1px solid ${c.border}`, background: c.bar }}>
        <button
          onClick={view === 'detail' ? closeDetail : onBack}
          title={view === 'detail' ? vn(lang, 'Về danh sách kết quả', 'Back to results') : vn(lang, 'Về danh sách trong phiên bản', 'Back to instance list')}
          className="w-7 h-7 rounded-md flex items-center justify-center shrink-0"
          style={{ background: c.surface, border: `1px solid ${c.border}`, color: c.label }}
        >
          <ArrowLeft size={14} weight="bold" />
        </button>
        <div className="min-w-0 flex-1">
          <p className="text-[12px] font-bold truncate" style={{ color: c.text }}>
            {view === 'detail' && active ? active.name : title}
          </p>
          <p className="text-[10px] truncate" style={{ color: c.faint }}>
            {view === 'detail' && active
              ? `${active.author || '—'} · ${active.source === 'curseforge' ? 'CurseForge' : 'Modrinth'}`
              : `${instance.name} · ${folder}/ · ${vn(lang, 'chỉ bản dùng được cho', 'only builds for')} ${targetLine}`}
          </p>
        </div>
        {view === 'list' && (
          <>
            <div className="flex items-center gap-1 p-0.5 rounded-lg shrink-0" style={{ background: c.input, border: `1px solid ${c.border}` }}>
              {SOURCES.map((s) => {
                const on = source === s.id
                return (
                  <button
                    key={s.id}
                    onClick={() => setSource(s.id)}
                    className="h-7 px-2.5 rounded-md text-[11px] font-semibold transition-colors"
                    style={{
                      background: on ? c.surface : 'transparent',
                      color: on ? c.accent : c.label,
                      border: `1px solid ${on ? 'rgba(167,139,250,0.32)' : 'transparent'}`,
                    }}
                  >
                    {s.name}
                  </button>
                )
              })}
            </div>
            <button
              onClick={() => load({ reset: true })}
              disabled={loading}
              title={vn(lang, 'Tải lại', 'Reload')}
              className="w-7 h-7 rounded-md flex items-center justify-center shrink-0 disabled:opacity-50"
              style={{ background: c.surface, border: `1px solid ${c.border}`, color: c.label }}
            >
              <ArrowsClockwise size={13} weight="bold" className={loading ? 'animate-spin' : ''} />
            </button>
          </>
        )}
      </div>

      <div className={`flex-1 min-h-0 transition-opacity duration-200 ${fading ? 'opacity-0' : 'opacity-100'}`}>
        {view === 'list' ? (
          <div className="h-full flex min-h-0">
            <div ref={listRef} className="flex-1 min-w-0 overflow-y-auto" onScroll={onListScroll}>
            <div className="max-w-5xl mx-auto p-4 flex flex-col gap-3">
              <div className="flex flex-col gap-3">{filters(false)}</div>

              {error && <Banner c={c} text={error} />}

              {loading && !hits.length ? (
                <div className="grid gap-3 grid-cols-1 md:grid-cols-2 xl:grid-cols-3">
                  {Array.from({ length: 6 }).map((_, i) => <SkeletonCard key={i} c={c} />)}
                </div>
              ) : !hits.length ? (
                <div className="py-16 text-center">
                  <Package size={26} weight="duotone" className="mx-auto mb-3" style={{ color: c.faint }} />
                  <p className="text-[12px]" style={{ color: c.label }}>
                    {vn(lang, 'Không có kết quả phù hợp cho phiên bản này', 'Nothing matches this instance version')}
                  </p>
                </div>
              ) : (
                <>
                  <div className="grid gap-3 grid-cols-1 md:grid-cols-2 xl:grid-cols-3">
                    {hits.map((hit) => (
                      <HoverPreview
                        key={`${hit.source}-${hit.id}`}
                        theme={theme}
                        lang={lang}
                        hit={hit}
                        kind={kind}
                        load={() => api.contentPreview({ source: hit.source, id: hit.id })}
                      >
                        <Card c={c} lang={lang} hit={hit} kind={kind} game={instance.version} onOpen={() => openItem(hit)} />
                      </HoverPreview>
                    ))}
                  </div>
                  {hits.length < total && (
                    <button
                      onClick={() => load({ reset: false })}
                      disabled={loading}
                      className="h-9 rounded-lg text-[11px] font-semibold transition-opacity disabled:opacity-50"
                      style={{ background: c.input, border: `1px solid ${c.border}`, color: c.label }}
                    >
                      {loading ? vn(lang, 'Đang tải…', 'Loading…') : vn(lang, 'Tải thêm', 'Load more')}
                    </button>
                  )}
                </>
              )}
            </div>
            </div>
            <aside
              aria-hidden={!stuck}
              className="shrink-0 overflow-hidden transition-[width] duration-200 ease-out"
              style={{ width: stuck ? 236 : 0, visibility: stuck ? 'visible' : 'hidden', borderLeft: `1px solid ${stuck ? c.border : 'transparent'}`, background: c.bar }}
            >
              <div className="w-[236px] h-full overflow-y-auto p-3 flex flex-col gap-3">{filters(true)}</div>
            </aside>
          </div>
        ) : (
          <div ref={detailRef} className="h-full flex flex-col min-h-0">
            <div className="shrink-0 flex flex-col gap-3 px-5 pt-4 pb-3" style={{ borderBottom: `1px solid ${c.border}` }}>
              <div className="flex items-start gap-3.5 max-w-5xl w-full mx-auto">
                {active?.icon ? (
                  <img src={active.icon} alt="" className="w-14 h-14 rounded-xl object-cover shrink-0" style={{ border: `1px solid ${c.border}`, background: c.input }} />
                ) : (
                  <span className="w-14 h-14 rounded-xl flex items-center justify-center shrink-0" style={{ background: c.input, border: `1px solid ${c.border}` }}>
                    <Package size={22} weight="duotone" style={{ color: c.accent }} />
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-[15px] font-bold leading-tight" style={{ color: c.text }}>{active?.name}</p>
                    {kind === 'mods' && (active?.loaders || []).length > 0 && (
                      <span className="flex items-center gap-1">
                        {active.loaders.slice(0, 4).map((l) => (
                          <img key={l} src={loaderIcon(l)} alt={l} className="w-3.5 h-3.5 object-contain" />
                        ))}
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 text-[11px]" style={{ color: c.faint }}>
                    {active?.author || '—'} · {active?.source === 'curseforge' ? 'CurseForge' : 'Modrinth'} · <span className="font-mono">{compact(active?.downloads)}</span> {vn(lang, 'lượt tải', 'downloads')}
                    {active?.updated ? ` · ${timeAgo(active.updated, lang)}` : ''}
                  </p>
                  {(detail?.summary || active?.summary) && (
                    <p className="mt-1.5 text-[11px] leading-relaxed line-clamp-2" style={{ color: c.label }}>
                      {detail?.summary || active?.summary}
                    </p>
                  )}
                </div>
                <div className="shrink-0 flex flex-col items-end gap-1.5">
                  <button
                    onClick={() => latest && install(latest.id, 'latest')}
                    disabled={!latest || !!installing}
                    className="h-9 px-3.5 rounded-lg text-[11px] font-bold flex items-center gap-2 transition-all hover:opacity-90 active:scale-[0.99] disabled:opacity-60"
                    style={{ background: c.accent, color: '#0a0a0a' }}
                  >
                    {installing === 'latest' ? <ArrowsClockwise size={13} weight="bold" className="animate-spin" /> : <Sparkle size={14} weight="fill" />}
                    {vn(lang, 'Tải bản mới nhất', 'Download latest')}
                  </button>
                  {latest && (
                    <span className="text-[9px] font-mono max-w-[220px] truncate" style={{ color: c.faint }} title={latest.file?.filename}>
                      {latest.versionNumber}
                    </span>
                  )}
                </div>
              </div>

              <div className="max-w-5xl w-full mx-auto flex items-center gap-1">
                {tabs.map((t) => {
                  const Icon = t.icon
                  const on = tab === t.key
                  const count = t.key === 'gallery' ? (detail?.gallery || []).length
                    : t.key === 'versions' || t.key === 'changelog' ? versions.length
                      : null
                  return (
                    <button
                      key={t.key}
                      onClick={() => setTab(t.key)}
                      className="relative h-8 px-3 rounded-md text-[11px] font-semibold flex items-center gap-1.5 transition-colors"
                      style={{ background: on ? c.input : 'transparent', color: on ? c.accent : c.label }}
                    >
                      <Icon size={13} weight={on ? 'fill' : 'regular'} />
                      {vn(lang, t.label[0], t.label[1])}
                      {count !== null && (
                        <span className="text-[9px] font-mono px-1 rounded" style={{ background: c.surface, color: c.faint }}>{count}</span>
                      )}
                      {on && <span className="absolute left-2 right-2 -bottom-[3px] h-[2px] rounded-full" style={{ background: c.accent }} />}
                    </button>
                  )
                })}
                <div className="flex-1" />
                {(detail?.links || []).slice(0, 1).map((link) => (
                  <button
                    key={link.url}
                    onClick={() => api.openExternal(link.url).catch(() => {})}
                    className="h-8 px-2.5 rounded-md text-[10px] font-semibold flex items-center gap-1.5"
                    style={{ background: c.surface, border: `1px solid ${c.border}`, color: c.label }}
                  >
                    {link.label}
                    <ArrowSquareOut size={11} />
                  </button>
                ))}
              </div>
            </div>

            <div key={active?.id || 'detail'} className="flex-1 min-h-0 overflow-y-auto">
              <div className="max-w-5xl mx-auto p-5">
                {tab === 'about' && (
                  <div className="flex flex-col gap-5">
                    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
                      <Stat c={c} label={vn(lang, 'Nguồn', 'Source')} value={active?.source === 'curseforge' ? 'CurseForge' : 'Modrinth'} />
                      <Stat c={c} label={vn(lang, 'Lượt tải', 'Downloads')} value={compact(active?.downloads)} />
                      <Stat c={c} label={vn(lang, 'Theo dõi', 'Followers')} value={followersOf(detail, active)} />
                      <Stat c={c} label={vn(lang, 'Phát hành', 'Published')} value={detail?.created ? formatDate(detail.created, lang) : '—'} />
                      <Stat c={c} label={vn(lang, 'Cập nhật', 'Updated')} value={timeAgo(active?.updated, lang) || '—'} />
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_280px] gap-5 items-start">
                      <div className="flex flex-col gap-2 min-w-0">
                        <p className="text-[10px] font-bold uppercase tracking-[0.14em]" style={{ color: c.label }}>
                          {vn(lang, 'Mô tả', 'Description')}
                        </p>
                        {detailLoading && !detail ? (
                          <div className="flex flex-col gap-2 rounded-xl p-4" style={{ background: c.surface, border: `1px solid ${c.border}` }}>
                            {[92, 78, 85, 60, 88, 70].map((w, i) => (
                              <span key={i} className="h-2.5 rounded-full" style={{ background: c.input, width: `${w}%` }} />
                            ))}
                          </div>
                        ) : detail?.descriptionRaw ? (
                          <div className="rounded-xl p-4" style={{ background: c.surface, border: `1px solid ${c.border}` }}>
                            <RichText c={c} raw={detail.descriptionRaw} format={detail.descriptionFormat} />
                          </div>
                        ) : (
                          <div className="rounded-xl p-4" style={{ background: c.surface, border: `1px solid ${c.border}` }}>
                            <p className="text-[11px] whitespace-pre-wrap" style={{ color: c.label }}>
                              {detail?.description || detail?.summary || active?.summary || vn(lang, 'Dự án này không kèm mô tả.', 'This project has no description.')}
                            </p>
                          </div>
                        )}
                      </div>

                      <div className="flex flex-col gap-3 min-w-0 lg:sticky lg:top-0">
                        <Box c={c} title={vn(lang, 'Tương thích', 'Compatibility')} icon={Cube}>
                          <p className="text-[11px] font-semibold mb-2" style={{ color: c.text }}>
                            {vn(lang, 'Minecraft: Java Edition', 'Minecraft: Java Edition')}
                          </p>
                          <Chips c={c} items={gameVersionList(detail, active)} max={8} />
                          {(detail?.loaders || active?.loaders || []).length > 0 && kind === 'mods' && (
                            <div className="mt-3">
                              <p className="text-[10px] font-bold uppercase tracking-[0.12em] mb-1.5" style={{ color: c.faint }}>
                                {vn(lang, 'Trình tải', 'Mod loaders')}
                              </p>
                              <div className="flex flex-wrap items-center gap-1.5">
                                {(detail?.loaders || active?.loaders || []).map((l) => (
                                  <span
                                    key={l}
                                    className="h-6 pl-1.5 pr-2 rounded-md flex items-center gap-1.5 text-[10px] font-semibold"
                                    style={{ background: c.input, border: `1px solid ${c.border}`, color: c.label }}
                                  >
                                    <img src={loaderIcon(l)} alt="" className="w-3 h-3 object-contain" />
                                    {LOADERS[l] || l}
                                  </span>
                                ))}
                              </div>
                            </div>
                          )}
                          {detail?.environment?.client && (
                            <div className="mt-3 flex flex-col gap-1">
                              <EnvRow c={c} label={vn(lang, 'Máy khách', 'Client')} value={detail.environment.client} lang={lang} />
                              <EnvRow c={c} label={vn(lang, 'Máy chủ', 'Server')} value={detail.environment.server} lang={lang} />
                            </div>
                          )}
                        </Box>

                        {(detail?.categories || active?.categories || []).length > 0 && (
                          <Box c={c} title={vn(lang, 'Thẻ', 'Tags')} icon={Tag}>
                            <Chips c={c} items={detail?.categories || active?.categories} />
                          </Box>
                        )}

                        {(detail?.creators || []).length > 0 && (
                          <Box c={c} title={vn(lang, 'Tác giả', 'Creators')} icon={Users}>
                            <div className="flex flex-col gap-2">
                              {detail.creators.map((person) => (
                                <div key={`${person.name}-${person.role}`} className="flex items-center gap-2 min-w-0">
                                  {person.avatar ? (
                                    <img src={person.avatar} alt="" className="w-6 h-6 rounded-md object-cover shrink-0" style={{ border: `1px solid ${c.border}` }} />
                                  ) : (
                                    <span className="w-6 h-6 rounded-md flex items-center justify-center shrink-0" style={{ background: c.input, border: `1px solid ${c.border}` }}>
                                      <Users size={12} style={{ color: c.faint }} />
                                    </span>
                                  )}
                                  <span className="text-[11px] font-semibold truncate" style={{ color: c.text }}>{person.name}</span>
                                  {person.role && (
                                    <span className="ml-auto text-[9px] font-mono shrink-0" style={{ color: c.faint }}>{person.role}</span>
                                  )}
                                </div>
                              ))}
                            </div>
                          </Box>
                        )}

                        {(detail?.links || []).length > 0 && (
                          <Box c={c} title={vn(lang, 'Liên kết', 'Links')} icon={LinkSimple}>
                            <div className="flex flex-col">
                              {detail.links.map((link, i) => (
                                <button
                                  key={link.url}
                                  onClick={() => api.openExternal(link.url).catch(() => {})}
                                  className="flex items-center gap-2 h-8 text-[11px] font-semibold transition-opacity hover:opacity-70"
                                  style={{ color: c.text, borderTop: i ? `1px solid ${c.border}` : 'none' }}
                                >
                                  <span className="truncate">{link.label}</span>
                                  <ArrowSquareOut size={11} className="ml-auto shrink-0" style={{ color: c.faint }} />
                                </button>
                              ))}
                            </div>
                          </Box>
                        )}

                        <Box c={c} title={vn(lang, 'Chi tiết', 'Details')} icon={Info}>
                          <div className="flex flex-col gap-1.5">
                            {detail?.slug && <Leader c={c} label={vn(lang, 'Slug', 'Slug')} value={detail.slug} />}
                            {detail?.license && <Leader c={c} label={vn(lang, 'Giấy phép', 'License')} value={detail.license} />}
                            <Leader
                              c={c}
                              label={vn(lang, 'Trình tải', 'Loaders')}
                              value={(detail?.loaders || active?.loaders || []).map((l) => LOADERS[l] || l).join(', ') || vn(lang, 'Không rõ', 'Unknown')}
                            />
                            <Leader c={c} label={vn(lang, 'Hỗ trợ', 'Supports')} value={vn(lang, `tới ${lastOf(gameVersionList(detail, active))}`, `up to ${lastOf(gameVersionList(detail, active))}`)} />
                            <Leader c={c} label={vn(lang, 'Lượt tải', 'Downloads')} value={compact(detail?.downloads ?? active?.downloads)} />
                            {detail?.created && <Leader c={c} label={vn(lang, 'Phát hành', 'Published')} value={formatDate(detail.created, lang)} />}
                            {detail?.updated && <Leader c={c} label={vn(lang, 'Cập nhật', 'Updated')} value={formatDate(detail.updated, lang)} />}
                            <Leader c={c} label={vn(lang, 'Mã dự án', 'Project ID')} value={String(active?.id || '')} />
                          </div>
                          {detailLoading && (
                            <p className="mt-2 text-[10px]" style={{ color: c.faint }}>{vn(lang, 'Đang đọc thông tin…', 'Loading details…')}</p>
                          )}
                          {!detailLoading && !detail && (
                            <p className="mt-2 text-[10px]" style={{ color: '#f87171' }}>
                              {vn(lang, 'Không đọc được thông tin chi tiết của dự án này.', 'Could not load this project’s details.')}
                            </p>
                          )}
                        </Box>
                      </div>
                    </div>
                  </div>
                )}

                {tab === 'versions' && (
                  <div className="flex flex-col gap-2">
                    <div className="flex items-center gap-2">
                      <p className="text-[10px] font-bold uppercase tracking-[0.14em]" style={{ color: c.label }}>
                        {vn(lang, 'Bản dùng được cho', 'Builds for')} {targetLine}
                      </p>
                      <span className="text-[10px] font-mono" style={{ color: c.faint }}>{versions.length}</span>
                    </div>
                    {versionsLoading ? (
                      <p className="text-[11px] py-6" style={{ color: c.faint }}>{vn(lang, 'Đang đọc danh sách…', 'Loading builds…')}</p>
                    ) : !versions.length ? (
                      <p className="text-[11px] py-6" style={{ color: c.faint }}>
                        {vn(lang, `Không có bản nào cho ${targetLine}`, `No build for ${targetLine}`)}
                      </p>
                    ) : (
                      <div className="rounded-xl overflow-hidden" style={{ border: `1px solid ${c.border}` }}>
                        {versions.map((v, i) => (
                          <VersionRow
                            key={v.id}
                            c={c}
                            lang={lang}
                            version={v}
                            game={instance.version}
                            first={i === 0}
                            installing={installing === v.id}
                            disabled={!!installing}
                            onInstall={() => install(v.id, v.id)}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {tab === 'changelog' && (
                  <div className="flex flex-col gap-2">
                    <div className="flex items-center gap-2">
                      <p className="text-[10px] font-bold uppercase tracking-[0.14em]" style={{ color: c.label }}>
                        {vn(lang, 'Nhật ký thay đổi', 'Changelog')}
                      </p>
                      <span className="text-[10px] font-mono" style={{ color: c.faint }}>{versions.length}</span>
                    </div>
                    {versionsLoading ? (
                      <p className="text-[11px] py-6" style={{ color: c.faint }}>{vn(lang, 'Đang đọc danh sách…', 'Loading builds…')}</p>
                    ) : !versions.length ? (
                      <p className="text-[11px] py-6" style={{ color: c.faint }}>
                        {vn(lang, 'Chưa có bản phát hành nào để xem.', 'No builds to show.')}
                      </p>
                    ) : (
                      <div className="rounded-xl overflow-hidden" style={{ border: `1px solid ${c.border}` }}>
                        {versions.map((v, i) => {
                          const on = openLog === v.id
                          const log = logs[v.id]
                          return (
                            <div key={v.id} style={{ borderTop: i ? `1px solid ${c.border}` : 'none' }}>
                              <button
                                onClick={() => toggleLog(v)}
                                className="w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors"
                                style={{ background: on ? c.input : 'transparent' }}
                              >
                                <span className="w-[3px] h-7 rounded-full shrink-0" style={{ background: i === 0 ? c.accent : c.border }} />
                                <div className="min-w-0 flex-1">
                                  <div className="flex items-center gap-2">
                                    <p className="text-[11px] font-semibold truncate" style={{ color: c.text }} title={v.versionNumber}>
                                      {v.versionNumber}
                                    </p>
                                    {i === 0 && (
                                      <span className="text-[9px] font-bold px-1 py-0.5 rounded shrink-0 uppercase" style={{ background: 'rgba(167,139,250,0.16)', color: c.accent }}>
                                        {vn(lang, 'mới nhất', 'latest')}
                                      </span>
                                    )}
                                    <ReleaseChip c={c} type={v.releaseType} lang={lang} />
                                  </div>
                                  <p className="mt-0.5 text-[9px] font-mono" style={{ color: c.faint }}>
                                    {v.date ? timeAgo(v.date, lang) : ''}
                                    {v.file?.size ? `${v.date ? ' · ' : ''}${bytes(v.file.size)}` : ''}
                                  </p>
                                </div>
                                <CaretDown size={12} weight="bold" className="shrink-0 transition-transform" style={{ color: c.faint, transform: on ? 'rotate(180deg)' : 'none' }} />
                              </button>
                              {on && (
                                <div className="px-4 pb-4 pt-1">
                                  {log?.loading ? (
                                    <div className="flex flex-col gap-2 py-2">
                                      {[88, 72, 80, 55].map((w, k) => (
                                        <span key={k} className="h-2.5 rounded-full" style={{ background: c.input, width: `${w}%` }} />
                                      ))}
                                    </div>
                                  ) : log?.text ? (
                                    <div className="rounded-lg p-3.5" style={{ background: c.surface, border: `1px solid ${c.border}` }}>
                                      <RichText c={c} raw={log.text} format={log.format} />
                                    </div>
                                  ) : (
                                    <div className="rounded-lg px-3.5 py-3 flex items-center gap-2" style={{ background: c.surface, border: `1px solid ${c.border}` }}>
                                      <WarningCircle size={13} weight="duotone" className="shrink-0" style={{ color: c.faint }} />
                                      <span className="text-[10px] flex-1" style={{ color: c.label }}>
                                        {log?.error
                                          ? vn(lang, 'Không đọc được nhật ký thay đổi.', 'Could not load the changelog.')
                                          : vn(lang, 'Bản này không kèm nhật ký thay đổi.', 'This build has no changelog.')}
                                      </span>
                                      {detail?.links?.[0]?.url && (
                                        <button
                                          onClick={() => api.openExternal(detail.links[0].url).catch(() => {})}
                                          className="text-[10px] font-semibold flex items-center gap-1 shrink-0"
                                          style={{ color: c.accent }}
                                        >
                                          {vn(lang, 'Xem trên', 'View on')} {active?.source === 'curseforge' ? 'CurseForge' : 'Modrinth'}
                                          <ArrowSquareOut size={10} />
                                        </button>
                                      )}
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </div>
                )}

                {tab === 'gallery' && (
                  <div className="flex flex-col gap-3">
                    <p className="text-[10px] font-bold uppercase tracking-[0.14em]" style={{ color: c.label }}>
                      {vn(lang, 'Thư viện ảnh', 'Gallery')}
                    </p>
                    {!(detail?.gallery || []).length ? (
                      <p className="text-[11px] py-6" style={{ color: c.faint }}>
                        {vn(lang, 'Dự án này không có ảnh.', 'This project has no images.')}
                      </p>
                    ) : (
                      <div className="grid grid-cols-2 xl:grid-cols-3 gap-3">
                        {detail.gallery.map((g) => (
                          <button
                            key={g.url}
                            onClick={() => setLightbox(g)}
                            className="group rounded-xl overflow-hidden text-left"
                            style={{ border: `1px solid ${c.border}`, background: c.surface }}
                          >
                            <img src={shot(g.url)} alt={g.title} loading="lazy" className="w-full h-36 object-cover transition-transform duration-300 group-hover:scale-[1.03]" />
                            {g.title && <span className="block px-2.5 py-1.5 text-[10px] truncate" style={{ color: c.label }}>{g.title}</span>}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

            <div className="shrink-0 px-5 py-3 flex flex-col gap-2" style={{ borderTop: `1px solid ${c.border}`, background: c.bg }}>
              <div className="max-w-5xl w-full mx-auto flex flex-col gap-2">
                {live && <ProgressBar theme={theme} lang={lang} progress={live} />}
                {installError && <Banner c={c} text={installError} />}
                {done && (
                  <div className="flex items-center gap-2 rounded-lg px-3 py-2" style={{ background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.3)' }}>
                    <CheckCircle size={13} weight="fill" style={{ color: '#22c55e' }} />
                    <span className="text-[10px] font-semibold flex-1 min-w-0 truncate" style={{ color: '#22c55e' }}>
                      {vn(lang, `Đã thêm ${done.added} tệp vào ${folder}/`, `Added ${done.added} file(s) to ${folder}/`)}
                      {done.existed ? vn(lang, ` · ${done.existed} đã có`, ` · ${done.existed} already there`) : ''}
                      {done.failed?.length ? vn(lang, ` · lỗi ${done.failed.length}`, ` · ${done.failed.length} failed`) : ''}
                    </span>
                  </div>
                )}
                {!live && !installError && !done && (
                  <p className="text-[10px]" style={{ color: c.faint }}>
                    {vn(lang, `Tệp sẽ được tải vào ${folder}/ của ${instance.name}.`, `Files are downloaded into ${instance.name}'s ${folder}/.`)}
                  </p>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {updateAsk && (
        <div
          className="modal-backdrop fixed inset-0 z-[210] flex items-center justify-center p-6"
          onClick={() => { if (!installing) setUpdateAsk(null) }}
        >
          <div
            className="modal-content w-full max-w-[480px] rounded-2xl flex flex-col overflow-hidden"
            style={{ background: c.surface, border: `1px solid ${c.border}` }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-4 py-3 flex items-center gap-2" style={{ borderBottom: `1px solid ${c.border}` }}>
              <ArrowsClockwise size={15} weight="duotone" style={{ color: c.accent }} />
              <p className="text-[12px] font-bold flex-1" style={{ color: c.text }}>
                {vn(lang, 'Cập nhật nội dung đã có', 'Update existing content')}
              </p>
              <button onClick={() => { if (!installing) setUpdateAsk(null) }} style={{ color: c.faint }}>
                <X size={13} weight="bold" />
              </button>
            </div>
            <div className="p-4 flex flex-col gap-3">
              <p className="text-[11px] leading-relaxed" style={{ color: c.label }}>
                {vn(
                  lang,
                  `Phiên bản này đã có ${updateAsk.matches.length} tệp của cùng ${noun}. Chọn bản đang có và bản muốn tải:`,
                  `This instance already has ${updateAsk.matches.length} file(s) of the same ${noun}. Pick the current build and the one to install:`,
                )}
              </p>
              <div className="flex flex-col gap-2">
                {updateAsk.matches.map((row) => (
                  <div
                    key={row.file}
                    className="rounded-xl px-2.5 py-2 flex items-center gap-2"
                    style={{ background: c.input, border: `1px solid ${c.border}` }}
                  >
                    <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: '#f59e0b' }} />
                    <div className="min-w-0 flex-1">
                      <p className="text-[11px] font-mono truncate" style={{ color: c.text }} title={row.file}>{row.file}</p>
                      <p className="text-[9px] font-mono truncate" style={{ color: c.faint }}>
                        {vn(lang, 'đang có', 'installed')}{row.version ? ` · ${row.version}` : ''}
                      </p>
                    </div>
                  </div>
                ))}
                {updateAsk.version ? (
                  <div className="rounded-xl px-2.5 py-2 flex items-center gap-2" style={{ background: `${c.accent}14`, border: `1px solid ${c.accent}44` }}>
                    <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: c.accent }} />
                    <div className="min-w-0 flex-1">
                      <p className="text-[11px] font-mono truncate" style={{ color: c.text }}>
                        {vn(lang, 'bản mới', 'new build')}
                      </p>
                      <p className="text-[9px] font-mono truncate" style={{ color: c.faint }}>{updateAsk.version}</p>
                    </div>
                  </div>
                ) : null}
              </div>
              <p className="text-[10px] leading-relaxed" style={{ color: c.faint }}>
                {vn(
                  lang,
                  'Cập nhật sẽ xoá tệp đang có rồi tải bản mới về, tránh hai bản cùng chạy gây xung đột. Giữ bản cũ thì không tải gì cả.',
                  'Update removes the installed file and downloads the new build, so two versions never load at once. Keep downloads nothing.',
                )}
              </p>
            </div>
            <div className="px-4 py-3 flex items-center gap-2 justify-end" style={{ borderTop: `1px solid ${c.border}` }}>
              <button
                onClick={() => setUpdateAsk(null)}
                disabled={!!installing}
                className="h-8 px-3 rounded-lg text-[11px] font-semibold disabled:opacity-50"
                style={{ background: c.input, border: `1px solid ${c.border}`, color: c.label }}
              >
                {vn(lang, 'Giữ bản cũ', 'Keep old')}
              </button>
              <button
                onClick={() => {
                  const ask = updateAsk
                  setUpdateAsk(null)
                  runInstall(ask.targetId, ask.which, ask.matches.map((row) => row.file))
                }}
                disabled={!!installing}
                className="h-8 px-4 rounded-lg text-[11px] font-bold inline-flex items-center gap-2 disabled:opacity-50"
                style={{ background: c.accent, color: c.ink }}
              >
                <ArrowsClockwise size={12} weight="bold" />
                {vn(lang, 'Cập nhật', 'Update')}
              </button>
            </div>
          </div>
        </div>
      )}

      {lightbox && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-8" style={{ background: 'rgba(0,0,0,0.82)' }} onClick={() => setLightbox(null)}>
          <img src={lightbox.url} alt={lightbox.title} className="max-w-full max-h-full rounded-lg" style={{ border: `1px solid ${c.border}` }} />
          <button className="absolute top-5 right-6" style={{ color: '#fff' }} onClick={() => setLightbox(null)}>
            <X size={20} weight="bold" />
          </button>
        </div>
      )}
    </div>
  )
}

function Card({ c, lang, hit, kind, game, onOpen }) {
  const versions = hit.gameVersions || []
  return (
    <button
      onClick={onOpen}
      className="group relative overflow-hidden text-left rounded-xl p-3 flex flex-col gap-2.5 transition-all duration-200 hover:-translate-y-0.5 h-full w-full"
      style={{ background: c.surface, border: `1px solid ${c.border}` }}
    >
      <span className="absolute left-0 top-3 bottom-3 w-[2px] rounded-full opacity-0 group-hover:opacity-40 transition-opacity" style={{ background: c.accent }} />
      <div className="flex items-start gap-2.5">
        {hit.icon ? (
          <img src={hit.icon} alt="" loading="lazy" className="w-11 h-11 rounded-lg object-cover shrink-0" style={{ border: `1px solid ${c.border}`, background: c.input }} />
        ) : (
          <span className="w-11 h-11 rounded-lg flex items-center justify-center shrink-0" style={{ background: c.input, border: `1px solid ${c.border}` }}>
            <Package size={18} weight="duotone" style={{ color: c.faint }} />
          </span>
        )}
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-bold truncate leading-tight" style={{ color: c.text }}>{hit.name}</p>
          <p className="mt-0.5 text-[10px] truncate" style={{ color: c.faint }}>{hit.author || '—'}</p>
        </div>
        <span className="flex items-center gap-1 text-[9px] font-mono tabular-nums shrink-0" style={{ color: c.faint }}>
          <Download size={10} />
          {compact(hit.downloads)}
        </span>
      </div>

      <p className="text-[10px] leading-relaxed line-clamp-2" style={{ color: c.label }}>{hit.summary || '—'}</p>

      <div className="mt-auto flex items-center gap-2 pt-2" style={{ borderTop: `1px solid ${c.border}` }}>
        {kind === 'mods' && <EnvChip c={c} env={hit.environment} lang={lang} />}
        {kind === 'mods' && (hit.loaders || []).length > 0 && (
          <div className="flex items-center gap-1 shrink-0">
            {hit.loaders.slice(0, 4).map((l) => (
              <span key={l} className="w-4 h-4 rounded flex items-center justify-center" style={{ background: c.input }}>
                <img src={loaderIcon(l)} alt={l} className="w-3 h-3 object-contain" />
              </span>
            ))}
          </div>
        )}
        <span className="text-[9px] font-mono truncate" style={{ color: c.label }}>
          {versions.includes(game)
            ? `${game}${versions.length > 1 ? ` +${versions.length - 1}` : ''}`
            : `${versions.slice(0, 3).join(' · ')}${versions.length > 3 ? ` +${versions.length - 3}` : ''}`}
        </span>
        <CaretRight size={11} className="ml-auto shrink-0" style={{ color: c.faint }} />
      </div>
    </button>
  )
}

function VersionRow({ c, lang, version, game, first, installing, disabled, onInstall }) {
  return (
    <div
      className="flex items-center gap-3 px-3 py-2"
      style={{ borderTop: first ? 'none' : `1px solid ${c.border}`, background: first ? 'rgba(167,139,250,0.06)' : 'transparent' }}
    >
      <span className="w-[3px] h-7 rounded-full shrink-0" style={{ background: first ? c.accent : c.border }} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="text-[11px] font-semibold truncate" style={{ color: c.text }} title={version.versionNumber}>{version.versionNumber}</p>
          {first && (
            <span className="text-[9px] font-bold px-1 py-0.5 rounded shrink-0 uppercase" style={{ background: 'rgba(167,139,250,0.16)', color: c.accent }}>
              {vn(lang, 'mới nhất', 'latest')}
            </span>
          )}
          <ReleaseChip c={c} type={version.releaseType} lang={lang} />
        </div>
        <p className="mt-0.5 text-[9px] font-mono truncate" style={{ color: c.faint }}>
          {version.gameVersions?.includes(game) ? game : (version.gameVersions || []).slice(0, 3).join(' · ')}
          {version.file?.size ? ` · ${bytes(version.file.size)}` : ''}
          {version.downloads ? ` · ${compact(version.downloads)} ${vn(lang, 'lượt tải', 'downloads')}` : ''}
          {requiredDeps(version) > 0 ? vn(lang, ` · kèm ${requiredDeps(version)} thư viện`, ` · pulls ${requiredDeps(version)} librar${requiredDeps(version) === 1 ? 'y' : 'ies'}`) : ''}
          {version.date ? ` · ${timeAgo(version.date, lang)}` : ''}
        </p>
      </div>
      <span className="flex items-center gap-0.5 shrink-0">
        {(version.loaders || []).slice(0, 3).map((l) => (
          <img key={l} src={loaderIcon(l)} alt={l} className="w-3.5 h-3.5 object-contain" />
        ))}
      </span>
      <button
        onClick={onInstall}
        disabled={disabled}
        className="h-7 px-2.5 rounded-md text-[10px] font-bold flex items-center gap-1.5 shrink-0 transition-opacity hover:opacity-90 disabled:opacity-50"
        style={{ background: first ? c.accent : c.input, border: `1px solid ${first ? c.accent : c.border}`, color: first ? '#0a0a0a' : c.label }}
      >
        {installing ? <ArrowsClockwise size={11} weight="bold" className="animate-spin" /> : <DownloadSimple size={11} weight="bold" />}
        {vn(lang, 'Tải', 'Get')}
      </button>
    </div>
  )
}

function SkeletonCard({ c }) {
  return (
    <div className="rounded-xl p-3 flex flex-col gap-2.5" style={{ background: c.surface, border: `1px solid ${c.border}` }}>
      <div className="flex items-start gap-2.5">
        <span className="w-11 h-11 rounded-lg shrink-0" style={{ background: c.input }} />
        <span className="flex-1 flex flex-col gap-1.5 pt-1">
          <span className="h-2.5 rounded-full" style={{ background: c.input, width: '70%' }} />
          <span className="h-2 rounded-full" style={{ background: c.input, width: '38%' }} />
        </span>
      </div>
      <span className="h-2 rounded-full" style={{ background: c.input, width: '92%' }} />
      <span className="h-2 rounded-full" style={{ background: c.input, width: '58%' }} />
    </div>
  )
}

function lastOf(list) {
  const arr = list || []
  return arr.length ? arr[arr.length - 1] : '—'
}

function requiredDeps(version) {
  return (version?.dependencies || []).filter((d) => d.dependency_type === 'required' || d.relationType === 3).length
}
