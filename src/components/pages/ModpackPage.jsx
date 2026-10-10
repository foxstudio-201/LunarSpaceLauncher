import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  MagnifyingGlass, ArrowsClockwise, DownloadSimple, X, FileArrowUp,
  CheckCircle, FolderOpen, Package, ArrowLeft, Info, Tag, Images,
  ClockCounterClockwise, Sparkle, ArrowSquareOut, Cube, LinkSimple, Users, CaretDown,
  WarningCircle,
} from '@phosphor-icons/react'
import { palette } from '../../lib/palette'
import { timeAgo, formatDate } from '../../lib/status'
import PageHeader from '../ui/PageHeader'
import Select from '../ui/Select'
import HoverPreview from '../ui/HoverPreview'
import useVirtual from '../ui/useVirtual'
import useProgressive from '../ui/useProgressive'
import ProgressBar from '../ui/ProgressBar'
import RichText from '../instance/RichText'
import {
  Box, Chips, Stat, Leader, Banner, EnvRow, ReleaseChip, gameVersionList, followersOf, bytes, compact,
} from '../instance/catalogBits'
import { loaderIcon, envIcon } from '../../api/client'
import * as api from '../../api/client.js'

const vn = (lang, vi, en) => (lang === 'vi' ? vi : en)
const PAGE = 24
const FADE_MS = 190
const DEFAULT_MEMORY = 4096
const OUTER_LOADERS = ['forge', 'neoforge', 'fabric', 'quilt']

const KIND = 'modpacks'

const SOURCES = [
  { id: 'modrinth', name: 'Modrinth', host: 'modrinth.com' },
  { id: 'curseforge', name: 'CurseForge', host: 'curseforge.com' },
]

const SORTS = {
  modrinth: ['relevance', 'downloads', 'follows', 'newest', 'updated'],
  curseforge: ['relevance', 'downloads', 'updated'],
}

const SORT_LABELS = {
  relevance: ['Liên quan', 'Relevance'],
  downloads: ['Tải nhiều', 'Most downloaded'],
  follows: ['Theo dõi', 'Most followed'],
  newest: ['Mới nhất', 'Newest'],
  updated: ['Vừa cập nhật', 'Recently updated'],
}

const LOADERS = { vanilla: 'Vanilla', fabric: 'Fabric', quilt: 'Quilt', forge: 'Forge', neoforge: 'NeoForge' }

const ENVS = ['client', 'server', 'both']

const ENV_LABELS = {
  client: ['Máy khách', 'Client'],
  server: ['Máy chủ', 'Server'],
  both: ['Cả hai', 'Both'],
}

const MODPACK_EXT = /\.(mrpack|zip)$/i

const TABS = [
  { key: 'about', label: ['Tổng quan', 'Overview'], icon: Info },
  { key: 'versions', label: ['Bản phát hành', 'Versions'], icon: Tag },
  { key: 'changelog', label: ['Nhật ký thay đổi', 'Changelog'], icon: ClockCounterClockwise },
  { key: 'gallery', label: ['Thư viện ảnh', 'Gallery'], icon: Images },
]

export default function ModpackPage({ theme, lang, defaultInstanceDir, packProgress, onRefreshInstances, onSelectInstance }) {
  const c = palette(theme)

  const [source, setSource] = useState('modrinth')
  const [sort, setSort] = useState('relevance')
  const [filterGame, setFilterGame] = useState('')
  const [filterLoaderOuter, setFilterLoaderOuter] = useState('')
  const [filterTag, setFilterTag] = useState('')
  const [filterEnv, setFilterEnv] = useState('')
  const [tagOptions, setTagOptions] = useState([])
  const [envSupported, setEnvSupported] = useState(true)
  const [query, setQuery] = useState('')
  const [applied, setApplied] = useState('')
  const [hits, setHits] = useState([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [listError, setListError] = useState('')

  const [view, setView] = useState('list')
  const [fading, setFading] = useState(false)
  const [stuck, setStuck] = useState(false)
  const [selected, setSelected] = useState(null)
  const [detail, setDetail] = useState(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [tab, setTab] = useState('about')
  const [versions, setVersions] = useState([])
  const [versionsLoading, setVersionsLoading] = useState(false)
  const progressiveVersions = useProgressive(versions.length, { first: 12 })
  const [filterMc, setFilterMc] = useState('')
  const [filterLoader, setFilterLoader] = useState('')
  const [versionId, setVersionId] = useState('')
  const [gallery, setGallery] = useState(null)
  const [openLog, setOpenLog] = useState('')
  const [logs, setLogs] = useState({})

  const [imported, setImported] = useState(null)
  const [importOpen, setImportOpen] = useState(false)
  const [dropActive, setDropActive] = useState(false)
  const [dropError, setDropError] = useState('')
  const [token, setToken] = useState('')
  const [name, setName] = useState('')
  const [memory, setMemory] = useState(DEFAULT_MEMORY)
  const [dir, setDir] = useState('')
  const [stage, setStage] = useState('')
  const [installError, setInstallError] = useState('')
  const [created, setCreated] = useState(null)
  const [result, setResult] = useState(null)

  const reqRef = useRef(0)
  const listRef = useRef(null)
  const gridWrapRef = useRef(null)
  const gridRef = useRef(null)
  const detailRef = useRef(null)

  const load = useCallback(async ({ reset = true } = {}) => {
    const id = ++reqRef.current
    setLoading(true)
    setListError('')
    const offset = reset ? 0 : hits.length
    const res = await api.modpackSearch({
      source,
      query: applied,
      sort,
      offset,
      limit: PAGE,
      game: filterGame || undefined,
      loader: filterLoaderOuter || undefined,
      category: filterTag || undefined,
      environment: envSupported && filterEnv ? filterEnv : undefined,
    }).catch((err) => ({ ok: false, error: err.message }))
    if (id !== reqRef.current) return
    setLoading(false)
    if (!res?.ok) {
      setListError(res?.error || 'error')
      if (reset) {
        setHits([])
        setTotal(0)
      }
      return
    }
    setTotal(res.total || 0)
    setHits((prev) => (reset ? res.hits : [...prev, ...res.hits]))
  }, [source, applied, sort, filterGame, filterLoaderOuter, filterTag, filterEnv, envSupported, hits.length])

  const loadMore = useCallback(() => {
    if (loading || !hits.length || hits.length >= total) return
    load({ reset: false })
  }, [loading, hits.length, total, load])

  const virtual = useVirtual({
    containerRef: listRef,
    wrapRef: gridWrapRef,
    contentRef: gridRef,
    count: hits.length,
    mode: 'grid',
    rowHeight: 176,
    gap: 12,
    overscan: 3,
  })

  const onListScroll = useCallback((event) => {
    const el = event.currentTarget
    const next = el.scrollTop > 4
    setStuck((prev) => (prev === next ? prev : next))
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 480) loadMore()
  }, [loadMore])

  useEffect(() => {
    const timer = setTimeout(() => setApplied(query.trim()), 340)
    return () => clearTimeout(timer)
  }, [query])

  useEffect(() => {
    setHits([])
    load({ reset: true })
  }, [source, applied, sort, filterGame, filterLoaderOuter, filterTag, filterEnv])

  useEffect(() => {
    let alive = true
    api.modpackTags({ source })
      .then((res) => {
        if (!alive) return
        setTagOptions(res?.options || [])
        setEnvSupported(res?.environment !== false)
      })
      .catch(() => {
        if (alive) setTagOptions([])
      })
    return () => { alive = false }
  }, [source])

  const pickSource = useCallback((next) => {
    if (next === source) return
    setSource(next)
    setFilterTag('')
    setFilterEnv('')
  }, [source])

  const swap = useCallback((next) => {
    setFading(true)
    setTimeout(() => {
      setView(next)
      setFading(false)
    }, FADE_MS)
  }, [])

  const reset = useCallback(() => {
    setDetail(null)
    setVersions([])
    setVersionId('')
    setTab('about')
    setOpenLog('')
    setLogs({})
    setInstallError('')
    setCreated(null)
    setResult(null)
    setStage('')
    setImported(null)
  }, [])

  const outerGameOptions = [...new Set((hits || []).flatMap((hit) => hit.gameVersions || []))].sort().reverse()
  const mcOptions = [...new Set(versions.flatMap((v) => v.gameVersions || []))].sort().reverse()
  const loaderOptions = [...new Set(versions.flatMap((v) => v.loaders || []))]
  const shownVersions = versions.filter((v) => {
    if (filterMc && !(v.gameVersions || []).includes(filterMc)) return false
    if (filterLoader && !(v.loaders || []).includes(filterLoader)) return false
    return true
  })

  const openHit = useCallback(async (hit) => {
    reset()
    setSelected(hit)
    setName(hit.name)
    setMemory(DEFAULT_MEMORY)
    setDir('')
    swap('detail')
    setDetailLoading(true)
    setVersionsLoading(true)
    const [proj, vers] = await Promise.all([
      api.contentProject({ kind: KIND, source: hit.source, id: hit.id }).catch((err) => ({ ok: false, error: err.message })),
      api.modpackVersions({ source: hit.source, id: hit.id }).catch((err) => ({ ok: false, error: err.message, versions: [] })),
    ])
    setDetailLoading(false)
    setVersionsLoading(false)
    if (proj?.ok) setDetail(proj.project)
    const list = vers?.versions || []
    if (!list.length && vers?.error) setInstallError(vers.error)
    setVersions(list)
    setVersionId(list[0]?.id || '')
  }, [reset, swap])

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
      .contentChangelog({ source: selected?.source, id: selected?.id, versionId: id })
      .catch((err) => ({ ok: false, error: err.message, text: '', format: 'markdown' }))
    setLogs((prev) => ({
      ...prev,
      [id]: { loading: false, text: res?.text || '', format: res?.format || 'markdown', error: res?.ok ? '' : res?.error || '' },
    }))
  }, [openLog, logs, selected])

  const acceptFile = useCallback((path) => {
    const filename = String(path || '').split(/[\\/]/).pop()
    if (!MODPACK_EXT.test(filename)) {
      setDropError(vn(lang, 'Chỉ nhận tệp .mrpack hoặc .zip (CurseForge hay bản xuất profile của LunarSpace).', 'Only .mrpack, CurseForge .zip or a LunarSpace profile export.'))
      return
    }
    reset()
    setDropError('')
    setImported({ path, name: filename })
    setSelected(null)
    setName(filename.replace(MODPACK_EXT, ''))
    setMemory(DEFAULT_MEMORY)
    setDir('')
    setImportOpen(false)
    swap('detail')
  }, [lang, reset, swap])

  const pickFile = useCallback(async () => {
    setDropError('')
    try {
      const res = await api.chooseModpack()
      if (!res?.ok) {
        if (res?.error) setDropError(res.error)
        return
      }
      acceptFile(res.path)
    } catch (err) {
      setDropError(err.message)
    }
  }, [acceptFile])

  const onDropFile = useCallback((e) => {
    e.preventDefault()
    setDropActive(false)
    const file = e.dataTransfer?.files?.[0]
    if (!file) return
    const path = api.pathForFile(file)
    if (!path) {
      setDropError(vn(lang, 'Không đọc được đường dẫn tệp.', 'Could not read the file path.'))
      return
    }
    acceptFile(path)
  }, [acceptFile, lang])

  const chooseFolder = useCallback(async () => {
    const res = await api.chooseDirectory({ defaultPath: defaultInstanceDir }).catch(() => null)
    if (res?.ok) setDir(res.path)
  }, [defaultInstanceDir])

  useEffect(() => {
    if (!importOpen) return undefined
    const onKey = (e) => {
      if (e.key === 'Escape') setImportOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [importOpen])

  const live = token ? packProgress?.[token] : null
  const busy = stage === 'resolve' || stage === 'import' || stage === 'install'

  const install = useCallback(async (targetVersionId) => {
    setInstallError('')
    setCreated(null)
    setResult(null)
    let res
    if (imported) {
      setStage('import')
      res = await api.modpackImport({ filePath: imported.path })
      if (res?.ok) {
        const info = { profile: res.plan?.source === 'profile', files: res.plan?.profileFiles || 0 }
        setImported((prev) => (prev ? { ...prev, ...info } : prev))
      }
    } else {
      if (!selected) return
      setStage('resolve')
      res = await api.modpackResolve({ source: selected.source, packId: selected.id, fileId: targetVersionId || versionId || undefined })
    }
    if (!res?.ok) {
      setStage('')
      return setInstallError(res?.error || 'error')
    }
    setStage('install')
    setToken(res.plan.token)
    const out = await api.modpackInstall({
      token: res.plan.token,
      name: name.trim() || res.plan.name,
      dir: dir || undefined,
      icon: selected?.icon || '',
      memoryMb: memory,
    })
    setStage('')
    setToken('')
    if (!out?.ok) return setInstallError(out?.error || 'error')
    setCreated(out.instance)
    setResult(out.applied || null)
    setImported(null)
    onRefreshInstances?.()
  }, [imported, selected, versionId, name, dir, memory, onRefreshInstances])

  const picked = useMemo(() => versions.find((v) => v.id === versionId) || versions[0] || null, [versions, versionId])
  const latest = versions[0] || null
  const subject = selected || (imported ? { import: true, name: imported.name } : null)

  const loaderText = (version, hit) => {
    const list = version?.loaders?.length ? version.loaders : hit?.loaders || []
    return list.length ? list.map((l) => LOADERS[l] || l).join(', ') : '—'
  }

  const filters = (vertical) => (
    <>
      <div className={vertical ? 'flex flex-col gap-2' : 'flex items-center gap-2 flex-wrap'}>
        <div className={vertical ? 'w-full' : 'w-[170px]'}>
          <Select
            theme={theme}
            value={filterGame}
            options={outerGameOptions.map((game) => ({ value: game, label: game, icon: loaderIcon('vanilla') }))}
            onChange={setFilterGame}
            placeholder={vn(lang, 'Mọi phiên bản game', 'Any game version')}
          />
        </div>
        <div className={vertical ? 'w-full' : 'w-[140px]'}>
          <Select
            theme={theme}
            value={filterLoaderOuter}
            options={OUTER_LOADERS.map((item) => ({ value: item, label: item, icon: loaderIcon(item) }))}
            onChange={setFilterLoaderOuter}
            placeholder={vn(lang, 'Mọi loader', 'Any loader')}
          />
        </div>
        <div className={vertical ? 'w-full' : 'w-[150px]'}>
          <Select
            theme={theme}
            value={filterTag}
            options={tagOptions}
            onChange={setFilterTag}
            placeholder={vn(lang, 'Mọi thẻ', 'Any tag')}
          />
        </div>
        <div className={vertical ? 'w-full' : 'w-[160px]'}>
          <Select
            theme={theme}
            value={filterEnv}
            options={ENVS.map((value) => ({ value, label: vn(lang, ENV_LABELS[value][0], ENV_LABELS[value][1]), icon: envIcon(value) }))}
            onChange={setFilterEnv}
            disabled={!envSupported}
            placeholder={vn(lang, 'Mọi môi trường', 'Any environment')}
          />
        </div>
        {(filterGame || filterLoaderOuter || filterTag || filterEnv) && (
          <button
            onClick={() => { setFilterGame(''); setFilterLoaderOuter(''); setFilterTag(''); setFilterEnv('') }}
            className={vertical ? 'h-9 w-full rounded-lg text-[11px] font-semibold' : 'h-9 px-2.5 rounded-lg text-[11px] font-semibold'}
            style={{ background: c.input, border: `1px solid ${c.border}`, color: c.label }}
          >
            {vn(lang, 'Xoá lọc', 'Clear')}
          </button>
        )}
        {!envSupported && (
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
            placeholder={vn(lang, 'Tìm modpack…', 'Search modpacks…')}
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
            options={(SORTS[source] || SORTS.modrinth).map((value) => ({
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
      {view === 'list' ? (
        <PageHeader
          theme={theme}
          title={vn(lang, 'Modpack', 'Modpacks')}
          subtitle={`${total || '—'} ${vn(lang, 'gói', 'packs')} · ${SOURCES.map((s) => s.name).join(' · ')}`}
        >
          <div className="flex items-center gap-1 p-0.5 rounded-lg" style={{ background: c.input, border: `1px solid ${c.border}` }}>
            {SOURCES.map((s) => {
              const on = source === s.id
              return (
                <button
                  key={s.id}
                  onClick={() => pickSource(s.id)}
                  className="h-8 px-3 rounded-md text-[11px] font-semibold transition-colors"
                  style={{ background: on ? c.surface : 'transparent', color: on ? c.accent : c.label, border: `1px solid ${on ? 'rgba(167,139,250,0.32)' : 'transparent'}` }}
                >
                  {s.name}
                </button>
              )
            })}
          </div>
          <button
            onClick={() => load({ reset: true })}
            data-tip={vn(lang, 'Tải lại', 'Reload')}
            className="w-9 h-9 rounded-lg flex items-center justify-center transition-opacity hover:opacity-80"
            style={{ background: c.input, border: `1px solid ${c.border}`, color: c.label }}
          >
            <ArrowsClockwise size={14} weight={loading ? 'bold' : 'regular'} className={loading ? 'animate-spin' : ''} />
          </button>
          <button
            onClick={() => { setDropError(''); setImportOpen(true) }}
            className="h-9 px-3 rounded-lg text-[11px] font-bold flex items-center gap-2 transition-all hover:opacity-90 active:scale-[0.98]"
            style={{ background: c.accent, color: '#0a0a0a' }}
          >
            <FileArrowUp size={14} weight="bold" />
            {vn(lang, 'Nhập tệp', 'Import file')}
          </button>
        </PageHeader>
      ) : (
        <div className="shrink-0 flex items-center gap-2 px-3 py-2" style={{ borderBottom: `1px solid ${c.border}`, background: c.bar }}>
          <button
            onClick={closeDetail}
            title={vn(lang, 'Về danh sách', 'Back to results')}
            className="w-7 h-7 rounded-md flex items-center justify-center shrink-0"
            style={{ background: c.surface, border: `1px solid ${c.border}`, color: c.label }}
          >
            <ArrowLeft size={14} weight="bold" />
          </button>
          <div className="min-w-0 flex-1">
            <p className="text-[12px] font-bold truncate" style={{ color: c.text }}>
              {selected?.name || imported?.name || vn(lang, 'Modpack', 'Modpacks')}
            </p>
            <p className="text-[10px] truncate" style={{ color: c.faint }}>
              {imported
                ? vn(lang, 'Modpack từ tệp', 'Modpack from file')
                : `${selected?.author || '—'} · ${selected?.source === 'curseforge' ? 'CurseForge' : 'Modrinth'}`}
            </p>
          </div>
          {!imported && latest && (
            <div className="shrink-0 flex flex-col items-end gap-1">
              <button
                onClick={() => install(latest.id)}
                disabled={busy}
                className="h-9 px-3.5 rounded-lg text-[11px] font-bold flex items-center gap-2 transition-all hover:opacity-90 active:scale-[0.99] disabled:opacity-60"
                style={{ background: c.accent, color: '#0a0a0a' }}
              >
                {busy ? <ArrowsClockwise size={13} weight="bold" className="animate-spin" /> : <Sparkle size={14} weight="fill" />}
                {vn(lang, 'Cài bản mới nhất', 'Install latest')}
              </button>
              <span className="text-[9px] font-mono max-w-[220px] truncate" style={{ color: c.faint }} title={latest.versionNumber}>
                {latest.versionNumber}
              </span>
            </div>
          )}
        </div>
      )}

      <div className={`flex-1 min-h-0 transition-opacity duration-200 ${fading ? 'opacity-0' : 'opacity-100'}`}>
        {view === 'list' ? (
          <div className="h-full flex min-h-0">
            <div ref={listRef} className="flex-1 min-w-0 overflow-y-auto" onScroll={onListScroll}>
            <div className="max-w-5xl mx-auto p-6 flex flex-col gap-4">
              <div className="flex flex-col gap-4">{filters(false)}</div>

              {listError && <Banner c={c} text={listError} />}

              {loading && !hits.length ? (
                <div className="grid gap-3 grid-cols-1 md:grid-cols-2 xl:grid-cols-3">
                  {Array.from({ length: 6 }).map((_, i) => <SkeletonCard key={i} c={c} />)}
                </div>
              ) : !hits.length ? (
                <div className="py-16 text-center">
                  <Package size={28} weight="duotone" className="mx-auto mb-3" style={{ color: c.faint }} />
                  <p className="text-sm" style={{ color: c.label }}>
                    {listError ? listError : vn(lang, 'Không tìm thấy modpack nào', 'No modpacks found')}
                  </p>
                </div>
              ) : (
                <>
                  <div ref={gridWrapRef}>
                  <div style={{ height: virtual.padTop }} aria-hidden />
                  <div ref={gridRef} className="stream-items grid gap-3 grid-cols-1 md:grid-cols-2 xl:grid-cols-3">
                    {hits.slice(virtual.start, virtual.end).map((hit) => (
                      <HoverPreview
                        key={`${hit.source}-${hit.id}`}
                        theme={theme}
                        lang={lang}
                        hit={hit}
                        kind="modpacks"
                        load={() => api.contentPreview({ source: hit.source, id: hit.id })}
                      >
                        <PackCard c={c} lang={lang} hit={hit} onOpen={() => openHit(hit)} />
                      </HoverPreview>
                    ))}
                  </div>
                  <div style={{ height: virtual.padBottom }} aria-hidden />
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
          <div ref={detailRef} key={selected?.id || imported?.path || 'detail'} className="h-full flex flex-col min-h-0">
            <div className="shrink-0 flex flex-col gap-3 px-5 pt-4 pb-3" style={{ borderBottom: `1px solid ${c.border}` }}>
              <div className="flex items-start gap-3.5 max-w-5xl w-full mx-auto">
                {imported ? (
                  <span className="w-14 h-14 rounded-xl flex items-center justify-center shrink-0" style={{ background: c.input, border: `1px solid ${c.border}` }}>
                    <FileArrowUp size={22} weight="duotone" style={{ color: c.accent }} />
                  </span>
                ) : selected?.icon ? (
                  <img src={selected.icon} alt="" className="w-14 h-14 rounded-xl object-cover shrink-0" style={{ border: `1px solid ${c.border}`, background: c.input }} />
                ) : (
                  <span className="w-14 h-14 rounded-xl flex items-center justify-center shrink-0" style={{ background: c.input, border: `1px solid ${c.border}` }}>
                    <Package size={22} weight="duotone" style={{ color: c.accent }} />
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-[15px] font-bold leading-tight" style={{ color: c.text }}>{subject?.name || '—'}</p>
                  <p className="mt-0.5 text-[11px]" style={{ color: c.faint }}>
                    {imported ? (
                      <span className="font-mono break-all">{imported.path}</span>
                    ) : (
                      <>
                        {selected?.author || '—'} · {selected?.source === 'curseforge' ? 'CurseForge' : 'Modrinth'} ·{' '}
                        <span className="font-mono">{compact(selected?.downloads)}</span> {vn(lang, 'lượt tải', 'downloads')}
                        {selected?.updated ? ` · ${timeAgo(selected.updated, lang)}` : ''}
                      </>
                    )}
                  </p>
                  {!imported && selected?.summary && (
                    <p className="mt-1.5 text-[11px] leading-relaxed line-clamp-2" style={{ color: c.label }}>{selected.summary}</p>
                  )}
                  {imported && (
                    <p className="mt-1.5 text-[11px] leading-relaxed" style={{ color: c.label }}>
                      {vn(
                        lang,
                        '.mrpack, .zip CurseForge, hoặc bản xuất profile của LunarSpace — mod, config và overrides được đưa vào phiên bản mới.',
                        '.mrpack, CurseForge .zip, or a LunarSpace profile export — mods, configs and overrides go into the new instance.',
                      )}
                    </p>
                  )}
                </div>
              </div>

              {!imported && (
                <div className="max-w-5xl w-full mx-auto flex items-center gap-1">
                  {TABS.map((t) => {
                    const Icon = t.icon
                    const on = tab === t.key
                    const count = t.key === 'gallery' ? (detail?.gallery || []).length : t.key === 'versions' || t.key === 'changelog' ? versions.length : null
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
              )}
            </div>

            <div className="stream-items flex-1 min-h-0 overflow-y-auto">
              <div className="max-w-5xl mx-auto p-5">
                {imported ? (
                  <div className="flex flex-col gap-4">
                    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
                      <Stat c={c} label={vn(lang, 'Nguồn', 'Source')} value={vn(lang, 'Tệp', 'File')} />
                      <Stat c={c} label={vn(lang, 'Định dạng', 'Format')} value={/\.mrpack$/i.test(imported.name) ? 'mrpack' : 'zip'} />
                      <Stat
                        c={c}
                        label={vn(lang, 'Kiểu', 'Type')}
                        value={
                          /\.mrpack$/i.test(imported.name)
                            ? 'Modrinth'
                            : imported.profile
                              ? vn(lang, 'Profile LunarSpace', 'LunarSpace profile')
                              : 'CurseForge'
                        }
                      />
                      <Stat c={c} label={vn(lang, 'Tên', 'Name')} value={name || '—'} />
                      <Stat c={c} label="RAM" value={`${memory} MB`} />
                    </div>
                    <Box c={c} title={vn(lang, 'Tệp đã chọn', 'Selected file')} icon={FileArrowUp}>
                      <p className="text-[11px] font-mono break-all" style={{ color: c.text }}>{imported.path}</p>
                      <p className="mt-2 text-[10px] leading-relaxed" style={{ color: c.label }}>
                        {imported.profile
                          ? vn(
                              lang,
                              `Profile này có ${imported.files} tệp (mod, config, resourcepack…) — sẽ được giải nén vào phiên bản mới.`,
                              `This profile holds ${imported.files} files (mods, configs, resource packs…) — they are unpacked into the new instance.`,
                            )
                          : vn(lang, 'Bấm "Cài đặt modpack" ở dưới để tạo phiên bản từ tệp này.', 'Hit “Install modpack” below to create an instance from this file.')}
                      </p>
                    </Box>
                  </div>
                ) : tab === 'about' && (
                  <div className="flex flex-col gap-5">
                    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
                      <Stat c={c} label={vn(lang, 'Nguồn', 'Source')} value={selected?.source === 'curseforge' ? 'CurseForge' : 'Modrinth'} />
                      <Stat c={c} label={vn(lang, 'Lượt tải', 'Downloads')} value={compact(selected?.downloads)} />
                      <Stat c={c} label={vn(lang, 'Theo dõi', 'Followers')} value={followersOf(detail, selected)} />
                      <Stat c={c} label={vn(lang, 'Phát hành', 'Published')} value={detail?.created ? formatDate(detail.created, lang) : '—'} />
                      <Stat c={c} label={vn(lang, 'Cập nhật', 'Updated')} value={timeAgo(selected?.updated, lang) || '—'} />
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
                              {detail?.description || selected?.summary || vn(lang, 'Gói này không kèm mô tả.', 'This pack has no description.')}
                            </p>
                          </div>
                        )}
                      </div>

                      <div className="flex flex-col gap-3 min-w-0">
                        <Box c={c} title={vn(lang, 'Tương thích', 'Compatibility')} icon={Cube}>
                          <p className="text-[11px] font-semibold mb-2" style={{ color: c.text }}>
                            {vn(lang, 'Minecraft: Java Edition', 'Minecraft: Java Edition')}
                          </p>
                          <Chips c={c} items={gameVersionList(detail, selected)} max={8} />
                          {(detail?.loaders || selected?.loaders || []).length > 0 && (
                            <div className="mt-3">
                              <p className="text-[10px] font-bold uppercase tracking-[0.12em] mb-1.5" style={{ color: c.faint }}>
                                {vn(lang, 'Bản modpack', 'Pack loaders')}
                              </p>
                              <div className="flex flex-wrap items-center gap-1.5">
                                {(detail?.loaders || selected?.loaders || []).map((l) => (
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
                          {picked && (
                            <div className="mt-3 flex flex-col gap-1">
                              <Leader c={c} label={vn(lang, 'Bản đang chọn', 'Selected')} value={picked.versionNumber || '—'} />
                              <Leader c={c} label="Minecraft" value={picked.gameVersions?.[0] || '—'} />
                            </div>
                          )}
                          {detail?.environment?.client && (
                            <div className="mt-3 flex flex-col gap-1">
                              <EnvRow c={c} label={vn(lang, 'Máy khách', 'Client')} value={detail.environment.client} lang={lang} />
                              <EnvRow c={c} label={vn(lang, 'Máy chủ', 'Server')} value={detail.environment.server} lang={lang} />
                            </div>
                          )}
                        </Box>

                        {(detail?.categories || []).length > 0 && (
                          <Box c={c} title={vn(lang, 'Thẻ', 'Tags')} icon={Tag}>
                            <Chips c={c} items={detail.categories} />
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
                                  {person.role && <span className="ml-auto text-[9px] font-mono shrink-0" style={{ color: c.faint }}>{person.role}</span>}
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
                            <Leader c={c} label={vn(lang, 'Trình tải', 'Loaders')} value={loaderText(picked, selected)} />
                            <Leader
                              c={c}
                              label={vn(lang, 'Hỗ trợ', 'Supports')}
                              value={vn(lang, `tới ${gameVersionList(detail, selected)[0] || '—'}`, `up to ${gameVersionList(detail, selected)[0] || '—'}`)}
                            />
                            <Leader c={c} label={vn(lang, 'Lượt tải', 'Downloads')} value={compact(selected?.downloads)} />
                            {detail?.created && <Leader c={c} label={vn(lang, 'Phát hành', 'Published')} value={formatDate(detail.created, lang)} />}
                            {detail?.updated && <Leader c={c} label={vn(lang, 'Cập nhật', 'Updated')} value={formatDate(detail.updated, lang)} />}
                            <Leader c={c} label={vn(lang, 'Mã gói', 'Project ID')} value={String(selected?.id || '')} />
                          </div>
                          {detailLoading && (
                            <p className="mt-2 text-[10px]" style={{ color: c.faint }}>{vn(lang, 'Đang đọc thông tin…', 'Loading details…')}</p>
                          )}
                          {!detailLoading && !detail && (
                            <p className="mt-2 text-[10px]" style={{ color: '#f87171' }}>
                              {vn(lang, 'Không đọc được thông tin chi tiết của gói này.', 'Could not load this pack’s details.')}
                            </p>
                          )}
                        </Box>
                      </div>
                    </div>
                  </div>
                )}

                {!imported && tab === 'versions' && (
                  <div className="flex flex-col gap-2">
                    <div className="flex items-center gap-2">
                      <p className="text-[10px] font-bold uppercase tracking-[0.14em]" style={{ color: c.label }}>
                        {vn(lang, 'Bản modpack', 'Pack versions')}
                      </p>
                      <span className="text-[10px] font-mono" style={{ color: c.faint }}>{versions.length}</span>
                    </div>
                    {!versionsLoading && versions.length > 0 && (
                      <div className="flex items-center gap-2 pb-2 flex-wrap">
                        <div className="w-[160px]">
                          <Select
                            theme={theme}
                            value={filterMc}
                            options={mcOptions.map((mc) => ({ value: mc, label: mc, icon: loaderIcon('vanilla') }))}
                            onChange={setFilterMc}
                            placeholder={vn(lang, 'Mọi phiên bản game', 'Any game version')}
                          />
                        </div>
                        <div className="w-[150px]">
                          <Select
                            theme={theme}
                            value={filterLoader}
                            options={loaderOptions.map((item) => ({ value: item, label: item, icon: loaderIcon(item) }))}
                            onChange={setFilterLoader}
                            placeholder={vn(lang, 'Mọi loader', 'Any loader')}
                          />
                        </div>
                        {(filterMc || filterLoader) && (
                          <button
                            onClick={() => { setFilterMc(''); setFilterLoader('') }}
                            className="h-8 px-2 rounded-lg text-[11px] font-semibold"
                            style={{ background: c.input, border: `1px solid ${c.border}`, color: c.label }}
                          >
                            {vn(lang, 'Xoá lọc', 'Clear')}
                          </button>
                        )}
                        <span className="text-[10px] font-mono ml-auto" style={{ color: c.faint }}>
                          {shownVersions.length}/{versions.length}
                        </span>
                      </div>
                    )}
                    {versionsLoading ? (
                      <p className="text-[11px] py-6" style={{ color: c.faint }}>{vn(lang, 'Đang đọc danh sách…', 'Loading versions…')}</p>
                    ) : !versions.length ? (
                      <p className="text-[11px] py-6" style={{ color: c.faint }}>{vn(lang, 'Không có bản nào cho modpack này.', 'No versions for this modpack.')}</p>
                    ) : (
                      <div className="rounded-xl overflow-hidden" style={{ border: `1px solid ${c.border}` }}>
                        {shownVersions.map((v, i) => (
                          <PackVersionRow
                            key={v.id}
                            c={c}
                            lang={lang}
                            version={v}
                            first={i === 0}
                            selected={v.id === versionId}
                            installing={stage === 'install' && v.id === versionId}
                            disabled={busy}
                            onPick={() => setVersionId(v.id)}
                            onInstall={() => install(v.id)}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {!imported && tab === 'changelog' && (
                  <div className="flex flex-col gap-2">
                    <div className="flex items-center gap-2">
                      <p className="text-[10px] font-bold uppercase tracking-[0.14em]" style={{ color: c.label }}>
                        {vn(lang, 'Nhật ký thay đổi', 'Changelog')}
                      </p>
                      <span className="text-[10px] font-mono" style={{ color: c.faint }}>{versions.length}</span>
                    </div>
                    {versionsLoading ? (
                      <p className="text-[11px] py-6" style={{ color: c.faint }}>{vn(lang, 'Đang đọc danh sách…', 'Loading versions…')}</p>
                    ) : !versions.length ? (
                      <p className="text-[11px] py-6" style={{ color: c.faint }}>{vn(lang, 'Chưa có bản phát hành nào để xem.', 'No builds to show.')}</p>
                    ) : (
                      <div className="rounded-xl overflow-hidden" style={{ border: `1px solid ${c.border}` }}>
                        {versions.slice(0, progressiveVersions).map((v, i) => {
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
                                    <p className="text-[11px] font-semibold truncate" style={{ color: c.text }} title={v.versionNumber}>{v.versionNumber}</p>
                                    {i === 0 && (
                                      <span className="text-[9px] font-bold px-1 py-0.5 rounded shrink-0 uppercase" style={{ background: 'rgba(167,139,250,0.16)', color: c.accent }}>
                                        {vn(lang, 'mới nhất', 'latest')}
                                      </span>
                                    )}
                                    <ReleaseChip c={c} type={v.releaseType} lang={lang} />
                                  </div>
                                  <p className="mt-0.5 text-[9px] font-mono" style={{ color: c.faint }}>
                                    {(v.gameVersions || []).slice(0, 2).join(' · ')}
                                    {v.date ? ` · ${timeAgo(v.date, lang)}` : ''}
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
                                          {vn(lang, 'Xem trên', 'View on')} {selected?.source === 'curseforge' ? 'CurseForge' : 'Modrinth'}
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

                {!imported && tab === 'gallery' && (
                  <div className="flex flex-col gap-3">
                    <p className="text-[10px] font-bold uppercase tracking-[0.14em]" style={{ color: c.label }}>
                      {vn(lang, 'Thư viện ảnh', 'Gallery')}
                    </p>
                    {!(detail?.gallery || []).length ? (
                      <p className="text-[11px] py-6" style={{ color: c.faint }}>
                        {vn(lang, 'Gói này không có ảnh.', 'This pack has no images.')}
                      </p>
                    ) : (
                      <div className="grid grid-cols-2 xl:grid-cols-3 gap-3">
                        {detail.gallery.map((g) => (
                          <button
                            key={g.url}
                            onClick={() => setGallery(g)}
                            className="group rounded-xl overflow-hidden text-left"
                            style={{ border: `1px solid ${c.border}`, background: c.surface }}
                          >
                            <img src={g.url} alt={g.title} loading="lazy" className="w-full h-36 object-cover transition-transform duration-300 group-hover:scale-[1.03]" />
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
                <div className="flex items-end gap-2">
                  <label className="flex flex-col gap-1 min-w-0 flex-1">
                    <span className="text-[9px] font-semibold uppercase tracking-[0.12em]" style={{ color: c.faint }}>
                      {vn(lang, 'Tên phiên bản', 'Instance name')}
                    </span>
                    <input
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      className="w-full h-8 px-2.5 rounded-lg text-[11px] outline-none"
                      style={{ background: c.input, border: `1px solid ${c.border}`, color: c.text }}
                    />
                  </label>
                  <label className="flex flex-col gap-1 w-[104px] shrink-0">
                    <span className="text-[9px] font-semibold uppercase tracking-[0.12em]" style={{ color: c.faint }}>RAM (MB)</span>
                    <input
                      type="number"
                      min={1024}
                      max={32768}
                      step={512}
                      value={memory}
                      onChange={(e) => setMemory(Number(e.target.value) || 0)}
                      className="w-full h-8 px-2.5 rounded-lg text-[11px] font-mono outline-none"
                      style={{ background: c.input, border: `1px solid ${c.border}`, color: c.text }}
                    />
                  </label>
                  <label className="flex flex-col gap-1 min-w-0 flex-1">
                    <span className="text-[9px] font-semibold uppercase tracking-[0.12em]" style={{ color: c.faint }}>
                      {vn(lang, 'Thư mục', 'Folder')}
                    </span>
                    <span className="flex items-center gap-1.5">
                      <input
                        value={dir}
                        onChange={(e) => setDir(e.target.value)}
                        placeholder={defaultInstanceDir ? `${defaultInstanceDir}\\…` : vn(lang, 'Tự động', 'Automatic')}
                        className="min-w-0 flex-1 h-8 px-2.5 rounded-lg text-[10px] font-mono outline-none"
                        style={{ background: c.input, border: `1px solid ${c.border}`, color: c.text }}
                      />
                      <button
                        onClick={chooseFolder}
                        data-tip={vn(lang, 'Chọn thư mục', 'Choose folder')}
                        className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
                        style={{ background: c.input, border: `1px solid ${c.border}`, color: c.label }}
                      >
                        <FolderOpen size={13} weight="duotone" />
                      </button>
                    </span>
                  </label>
                  <button
                    onClick={() => install(picked?.id)}
                    disabled={busy || !subject}
                    className="h-8 px-4 rounded-lg text-[11px] font-bold flex items-center justify-center gap-2 shrink-0 transition-all hover:opacity-90 active:scale-[0.99] disabled:opacity-60"
                    style={{ background: c.accent, color: '#0a0a0a' }}
                  >
                    {busy ? <ArrowsClockwise size={13} weight="bold" className="animate-spin" /> : <DownloadSimple size={14} weight="bold" />}
                    {busy
                      ? stage === 'install'
                        ? vn(lang, 'Đang cài modpack…', 'Installing…')
                        : vn(lang, 'Đang tải gói…', 'Fetching pack…')
                      : vn(lang, 'Cài đặt modpack', 'Install modpack')}
                  </button>
                </div>

                {picked && !imported && (
                  <p className="text-[10px]" style={{ color: c.faint }}>
                    {vn(lang, 'Sẽ cài bản', 'Installing')}{' '}
                    <span className="font-mono" style={{ color: c.label }}>{picked.versionNumber}</span>
                    {picked.gameVersions?.[0] ? ` · Minecraft ${picked.gameVersions[0]}` : ''}
                    {picked.loaders?.length ? ` · ${loaderText(picked, selected)}` : ''}
                  </p>
                )}

                {live && <ProgressBar theme={theme} lang={lang} progress={live} />}
                {installError && <Banner c={c} text={installError} />}
                {created && (
                  <div className="rounded-lg px-2.5 py-2 flex flex-col gap-1" style={{ background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.3)' }}>
                    <div className="flex items-center gap-2">
                      <CheckCircle size={13} weight="fill" style={{ color: '#22c55e' }} />
                      <span className="text-[10px] font-semibold flex-1 min-w-0 truncate" style={{ color: '#22c55e' }}>
                        {vn(lang, 'Đã tạo', 'Created')} {created.name}
                      </span>
                      <button onClick={() => onSelectInstance?.(created)} className="text-[10px] font-bold shrink-0" style={{ color: c.accent }}>
                        {vn(lang, 'Mở', 'Open')}
                      </button>
                    </div>
                    {result && (
                      <p className="text-[10px] font-mono tabular-nums" style={{ color: '#22c55e' }}>
                        {[
                          result.planned ? `${result.downloaded}/${result.planned} mod` : '',
                          result.profileFiles ? `${result.profileFiles} ${vn(lang, 'tệp profile', 'profile files')}` : '',
                          result.extras ? `+${result.extras} modlist.html` : '',
                          result.overrides ? `${result.overrides} overrides` : '',
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </p>
                    )}
                    {result && result.failed + result.missing > 0 && (
                      <p className="text-[10px] leading-relaxed" style={{ color: '#fbbf24' }}>
                        {result.failed + result.missing} {vn(lang, 'mod không tải được:', 'mods could not be downloaded:')}{' '}
                        <span className="font-mono">{[...result.failedNames, ...result.missingNames].slice(0, 3).join(', ')}</span>
                        {vn(lang, ' — xem Console để biết đủ.', ' — see Console for the full list.')}
                      </p>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {importOpen && (
        <div
          className="modal-backdrop fixed inset-0 z-[210] flex items-center justify-center p-6"
          onClick={() => { setImportOpen(false); setDropActive(false); setDropError('') }}
        >
          <div
            className="modal-content w-full max-w-[520px] rounded-2xl flex flex-col overflow-hidden"
            style={{ background: c.surface, border: `1px solid ${c.border}` }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2 px-4 py-3" style={{ borderBottom: `1px solid ${c.border}` }}>
              <FileArrowUp size={15} weight="duotone" style={{ color: c.accent }} />
              <p className="text-[12px] font-bold flex-1" style={{ color: c.text }}>
                {vn(lang, 'Nhập modpack từ tệp', 'Import modpack from file')}
              </p>
              <button
                onClick={() => { setImportOpen(false); setDropActive(false); setDropError('') }}
                className="w-6 h-6 rounded-md flex items-center justify-center"
                style={{ color: c.faint }}
              >
                <X size={13} weight="bold" />
              </button>
            </div>

            <div className="p-4 flex flex-col gap-3">
              <div
                onClick={pickFile}
                onDragOver={(e) => { e.preventDefault(); setDropActive(true) }}
                onDragEnter={(e) => { e.preventDefault(); setDropActive(true) }}
                onDragLeave={() => setDropActive(false)}
                onDrop={onDropFile}
                className="rounded-xl flex flex-col items-center justify-center gap-2 py-9 px-6 text-center cursor-pointer transition-colors"
                style={{
                  border: `2px dashed ${dropActive ? c.accent : c.border}`,
                  background: dropActive ? 'rgba(167,139,250,0.07)' : c.input,
                }}
              >
                <span className="w-12 h-12 rounded-xl flex items-center justify-center" style={{ background: c.surface, border: `1px solid ${c.border}` }}>
                  <FileArrowUp size={20} weight="duotone" style={{ color: c.accent }} />
                </span>
                <p className="text-[12px] font-bold" style={{ color: c.text }}>
                  {vn(lang, 'Kéo thả tệp vào đây', 'Drop the file here')}
                </p>
                <p className="text-[10px]" style={{ color: c.faint }}>
                  {vn(lang, 'hoặc bấm để chọn — .mrpack, .zip (CurseForge)', 'or click to browse — .mrpack, CurseForge .zip')}
                </p>
              </div>

              {dropError && <Banner c={c} text={dropError} />}

              <p className="text-[10px] leading-relaxed" style={{ color: c.faint }}>
                {vn(
                  lang,
                  'Sau khi nhận tệp, bạn đặt tên phiên bản / RAM / thư mục rồi bấm “Cài đặt modpack”.',
                  'Once the file is accepted, set the instance name / RAM / folder then hit “Install modpack”.',
                )}
              </p>
            </div>
          </div>
        </div>
      )}

      {gallery && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-8" style={{ background: 'rgba(0,0,0,0.82)' }} onClick={() => setGallery(null)}>
          <img src={gallery.url} alt={gallery.title} className="max-w-full max-h-full rounded-lg" style={{ border: `1px solid ${c.border}` }} />
          <button className="absolute top-5 right-6" style={{ color: '#fff' }} onClick={() => setGallery(null)}>
            <X size={20} weight="bold" />
          </button>
        </div>
      )}
    </div>
  )
}

function PackCard({ c, lang, hit, onOpen }) {
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
          <DownloadSimple size={10} />
          {compact(hit.downloads)}
        </span>
      </div>

      <p className="text-[10px] leading-relaxed line-clamp-2" style={{ color: c.label }}>{hit.summary || '—'}</p>

      <div className="mt-auto flex items-center gap-2 pt-2" style={{ borderTop: `1px solid ${c.border}` }}>
        <div className="flex items-center gap-1 shrink-0">
          {(hit.loaders || []).slice(0, 4).map((l) => (
            <span key={l} className="w-4 h-4 rounded flex items-center justify-center" style={{ background: c.input }}>
              <img src={loaderIcon(l)} alt={l} className="w-3 h-3 object-contain" />
            </span>
          ))}
        </div>
        <span className="text-[9px] font-mono truncate" style={{ color: c.label }}>
          {versions.slice(0, 3).join(' · ')}{versions.length > 3 ? ` +${versions.length - 3}` : ''}
        </span>
        <span className="ml-auto text-[9px] font-mono shrink-0" style={{ color: c.faint }}>{timeAgo(hit.updated, lang) || ''}</span>
      </div>
    </button>
  )
}

function PackVersionRow({ c, lang, version, first, selected, installing, disabled, onPick, onInstall }) {
  return (
    <div
      className="flex items-center gap-3 px-3 py-2"
      style={{ borderTop: first ? 'none' : `1px solid ${c.border}`, background: selected ? 'rgba(167,139,250,0.06)' : 'transparent' }}
    >
      <button onClick={onPick} className="w-[3px] h-7 rounded-full shrink-0" style={{ background: selected ? c.accent : c.border }} aria-label={version.versionNumber} />
      <button onClick={onPick} className="min-w-0 flex-1 text-left">
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
          {(version.gameVersions || []).slice(0, 2).join(' · ')}
          {version.file?.size ? ` · ${bytes(version.file.size)}` : ''}
          {version.date ? ` · ${timeAgo(version.date, lang)}` : ''}
        </p>
      </button>
      <span className="flex items-center gap-0.5 shrink-0">
        {(version.loaders || []).slice(0, 3).map((l) => (
          <img key={l} src={loaderIcon(l)} alt={l} className="w-3.5 h-3.5 object-contain" />
        ))}
      </span>
      <button
        onClick={onInstall}
        disabled={disabled}
        className="h-7 px-2.5 rounded-md text-[10px] font-bold flex items-center gap-1.5 shrink-0 transition-opacity hover:opacity-90 disabled:opacity-50"
        style={{ background: selected ? c.accent : c.input, border: `1px solid ${selected ? c.accent : c.border}`, color: selected ? '#0a0a0a' : c.label }}
      >
        {installing ? <ArrowsClockwise size={11} weight="bold" className="animate-spin" /> : <DownloadSimple size={11} weight="bold" />}
        {vn(lang, 'Cài', 'Install')}
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
          <span className="h-2.5 rounded-full" style={{ background: c.input, width: '72%' }} />
          <span className="h-2 rounded-full" style={{ background: c.input, width: '40%' }} />
        </span>
      </div>
      <span className="h-2 rounded-full" style={{ background: c.input, width: '92%' }} />
      <span className="h-2 rounded-full" style={{ background: c.input, width: '64%' }} />
    </div>
  )
}
