import { useState, useEffect, useCallback, useRef } from 'react'
import { AppProvider, useApp } from './i18n/AppContext'
import TitleBar from './components/TitleBar'
import Sidebar, { RAIL_W, RAIL_W_COLLAPSED } from './components/Sidebar'
import SplashScreen from './components/SplashScreen'
import TooltipProvider from './components/ui/TooltipProvider'
import CrashModal from './components/ui/CrashModal'
import { ToastProvider, useToast } from './components/ui/Toast'
import { progressLabel, progressPercent } from './components/ui/ProgressBar'
import HomePage from './components/pages/HomePage'
import VersionsPage from './components/pages/VersionsPage'
import ModpackPage from './components/pages/ModpackPage'
import AccountsPage from './components/pages/AccountsPage'
import SettingsPage from './components/pages/SettingsPage'
import InstancePanel from './components/instance/InstancePanel'
import { launchBannerLines } from './lib/asciiLogo'
import * as api from './api/client.js'

const SPLASH_MIN_MS = 1000
const SPLASH_FADE_MS = 380
const PAGE_FADE_MS = 200
const DEFAULT_MEMORY = 4096

const vn = (lang, vi, en) => (lang === 'vi' ? vi : en)

function fileNameOf(value) {
  if (!value) return ''
  const parts = String(value).split(/[\\/]/)
  return parts[parts.length - 1]
}

function AppContent() {
  const { lang, theme } = useApp()
  const toast = useToast()

  const [version, setVersion] = useState('')
  const [system, setSystem] = useState(null)
  const [storage, setStorage] = useState({ sharedDir: '', defaultInstanceDir: '', javaPath: '' })
  const [instances, setInstances] = useState([])
  const [accounts, setAccounts] = useState([])
  const [activeAccountId, setActiveAccountId] = useState(null)
  const [versions, setVersions] = useState([])
  const [latest, setLatest] = useState(null)
  const [source, setSource] = useState('mojang')
  const [snapshots, setSnapshots] = useState(false)
  const [versionsLoading, setVersionsLoading] = useState(true)
  const [versionsError, setVersionsError] = useState('')

  const [displayPage, setDisplayPage] = useState('home')
  const [activePage, setActivePage] = useState('home')
  const [phase, setPhase] = useState('idle')
  const [selectedInstance, setSelectedInstance] = useState(null)
  const [showDropdown, setShowDropdown] = useState(false)
  const [railCollapsed, setRailCollapsed] = useState(false)

  const [progress, setProgress] = useState({})
  const [packProgress, setPackProgress] = useState({})
  const [logs, setLogs] = useState({})
  const [launchError, setLaunchError] = useState({})
  const [instancesError, setInstancesError] = useState('')
  const [crashes, setCrashes] = useState({})
  const [update, setUpdate] = useState({ phase: 'idle', current: '' })
  const [openCrash, setOpenCrash] = useState(null)

  const [boot, setBoot] = useState('splash')
  const [bootStatus, setBootStatus] = useState('boot')

  const selectedRef = useRef(null)
  const snapshotsRef = useRef(false)
  const speedRef = useRef({})
  const instancesRef = useRef([])
  const versionRef = useRef('')
  const langRef = useRef(lang)
  const packsRef = useRef(new Set())

  const refreshInstances = useCallback(async () => {
    try {
      const res = await api.listInstances()
      if (res?.ok === false) {
        setInstancesError(res.error || 'error')
        return
      }
      setInstancesError('')
      const list = res?.instances || []
      setInstances(list)
      if (res?.sharedDir) setStorage((s) => ({ ...s, sharedDir: res.sharedDir, defaultInstanceDir: res.defaultInstanceDir || s.defaultInstanceDir }))
      const current = selectedRef.current
      if (current) {
        const fresh = list.find((i) => i.id === current.id)
        if (fresh && fresh !== current) setSelectedInstance(fresh)
        if (!fresh) {
          setSelectedInstance(null)
          selectedRef.current = null
        }
      }
    } catch (err) {
      setInstancesError(err?.message || 'error')
    }
  }, [])

  useEffect(() => {
    selectedRef.current = selectedInstance
  }, [selectedInstance])

  useEffect(() => {
    instancesRef.current = instances
  }, [instances])

  useEffect(() => {
    langRef.current = lang
  }, [lang])

  useEffect(() => {
    const inst = selectedInstance
    api
      .discordSelect(inst ? { name: inst.name, version: inst.version, loader: inst.loader, loaderVersion: inst.loaderVersion || null } : null)
      .catch(() => {})
  }, [selectedInstance])

  useEffect(() => {
    versionRef.current = version
  }, [version])

  const loadVersions = useCallback(async (withSnapshots, force) => {
    setVersionsLoading(true)
    try {
      const res = await api.listVersions({ snapshots: withSnapshots, force })
      setVersions(res?.versions || [])
      setLatest(res?.latest || null)
      setSource(res?.source || 'mojang')
      setVersionsError('')
    } catch (err) {
      setVersionsError(err?.message || 'error')
    } finally {
      setVersionsLoading(false)
    }
  }, [])

  useEffect(() => {
    snapshotsRef.current = snapshots
  }, [snapshots])

  useEffect(() => {
    if (window.electronAPI?.getVersion) window.electronAPI.getVersion().then(setVersion).catch(() => {})
    api.systemInfo().then((s) => { if (s?.ok) setSystem(s) }).catch(() => {})
    api.storage().then((s) => { if (s?.ok) setStorage(s) }).catch(() => {})
    api.listAccounts().then((res) => {
      if (res?.ok) {
        setAccounts(res.accounts || [])
        setActiveAccountId(res.activeAccountId || null)
      }
    }).catch(() => {})
    refreshInstances()
    loadVersions(false, true)
  }, [refreshInstances, loadVersions])

  useEffect(() => {
    const off = api.onLauncherEvent((ev) => {
      if (!ev) return
      const L = langRef.current
      const nameOf = (id) => instancesRef.current.find((i) => i.id === id)?.name || ''
      if (ev.type === 'modpack') {
        setPackProgress((p) => ({ ...p, [ev.token]: { ...(p[ev.token] || {}), ...ev } }))
        const key = `dl:pack:${ev.token}`
        const who = ev.name || ''
        if (ev.phase === 'error') {
          packsRef.current.delete(ev.token)
          toast.finish(key, {
            tone: 'bad',
            title: vn(L, 'Cài modpack thất bại', 'Modpack install failed'),
            message: ev.error || who,
          })
        } else if (ev.phase === 'done') {
          packsRef.current.delete(ev.token)
          toast.finish(key, {
            tone: 'ok',
            title: vn(L, 'Cài modpack xong', 'Modpack installed'),
            message: [who, ev.total ? vn(L, `${ev.total} tệp`, `${ev.total} files`) : ''].filter(Boolean).join(' · '),
          })
        } else if (ev.phase === 'clear') {
          toast.dismiss(key)
        } else {
          packsRef.current.add(ev.token)
          const stage = ev.phase === 'install'
            ? vn(L, 'Đang chuẩn bị…', 'Preparing…')
            : progressLabel({ phase: 'download', label: ev.label }, L)
          toast.download(key, {
            title: vn(L, 'Đang cài modpack', 'Installing modpack'),
            message: [who, stage].filter(Boolean).join(' · '),
            percent: progressPercent(ev),
            indeterminate: !ev.totalBytes && !ev.total,
            detail: fileNameOf(ev.file),
          })
        }
        if (ev.phase === 'done' || ev.phase === 'error') refreshInstances()
        return
      }
      if (ev.type === 'progress') {
        const key = `dl:${ev.id}`
        const who = nameOf(ev.id)
        if (ev.phase === 'error') {
          toast.finish(key, {
            tone: 'bad',
            title: vn(L, 'Tải thất bại', 'Download failed'),
            message: [who, ev.error].filter(Boolean).join(' · '),
          })
        } else if (ev.phase === 'done') {
          const summary = ev.summary || {}
          const detail = summary.format
            ? `${summary.identified}/${summary.mods} mod · ${Math.round((summary.bytes || 0) / 104857.6) / 10} MB`
            : summary.versionId
              ? summary.versionId
              : summary.total !== undefined
                ? vn(L, `thêm ${summary.added} · có sẵn ${summary.existed}`, `added ${summary.added} · kept ${summary.existed}`)
                : summary.libraries !== undefined
                  ? vn(L, `${summary.libraries} thư viện · ${summary.objects} tài nguyên`, `${summary.libraries} libraries · ${summary.objects} assets`)
                  : ''
          toast.finish(key, {
            tone: 'ok',
            title: ev.label === 'content'
              ? vn(L, 'Đã tải xong', 'Download finished')
              : ev.label === 'export'
                ? vn(L, 'Đã xuất profile', 'Profile exported')
                : progressLabel({ phase: 'done' }, L) || vn(L, 'Tải xong', 'Download finished'),
            message: [who, detail].filter(Boolean).join(' · '),
          })
        } else if (ev.phase === 'clear') {
          toast.dismiss(key)
        } else if (!packsRef.current.size) {
          toast.download(key, {
            title: progressLabel(ev, L) || vn(L, 'Đang tải…', 'Downloading…'),
            message: who,
            percent: progressPercent(ev),
            indeterminate: !ev.totalBytes && !ev.total,
            detail: fileNameOf(ev.file),
          })
        }
        if (ev.phase === 'clear') {
          setProgress((p) => {
            if (!p[ev.id]) return p
            const next = { ...p }
            delete next[ev.id]
            return next
          })
          return
        }
        if (ev.phase === 'download') {
          const sample = speedRef.current[ev.id] || { at: Date.now(), bytes: 0, speed: 0 }
          const now = Date.now()
          const dt = (now - sample.at) / 1000
          const bytes = ev.bytesDone || 0
          if (dt >= 0.4 && bytes >= sample.bytes) {
            const instant = (bytes - sample.bytes) / dt
            sample.speed = sample.speed ? sample.speed * 0.5 + instant * 0.5 : instant
            sample.at = now
            sample.bytes = bytes
            speedRef.current[ev.id] = sample
          }
        } else {
          delete speedRef.current[ev.id]
        }
        setProgress((p) => ({ ...p, [ev.id]: { ...(p[ev.id] || {}), ...ev, speed: speedRef.current[ev.id]?.speed || 0 } }))
        if (ev.phase === 'done') {
          const doneId = ev.id
          setTimeout(() => {
            setProgress((p) => {
              if (!p[doneId]) return p
              const next = { ...p }
              delete next[doneId]
              return next
            })
          }, 1200)
        }
        if (ev.phase === 'done' || ev.phase === 'error') refreshInstances()
        return
      }
      if (ev.type === 'update') {
        setUpdate(ev)
        const key = 'dl:update'
        if (ev.event === 'available') {
          toast.download(key, {
            title: vn(L, 'Có bản cập nhật mới', 'Update available'),
            message: `v${ev.version || ''}`,
            indeterminate: true,
            duration: 0,
          })
        } else if (ev.event === 'progress') {
          toast.download(key, {
            title: vn(L, 'Đang tải bản cập nhật', 'Downloading update'),
            message: `v${ev.version || ''}`,
            percent: ev.percent || 0,
            indeterminate: !ev.totalBytes,
            detail: ev.totalBytes
              ? `${Math.round((ev.bytesDone || 0) / 104857.6) / 10} / ${Math.round(ev.totalBytes / 104857.6) / 10} MB`
              : '',
          })
        } else if (ev.event === 'ready') {
          toast.finish(key, {
            tone: 'ok',
            title: vn(L, 'Đã tải xong bản cập nhật', 'Update downloaded'),
            message: vn(L, `v${ev.version || ''} · sẽ tự cài khi bạn thoát launcher`, `v${ev.version || ''} · installs when you quit the launcher`),
            duration: 9000,
          })
        } else if (ev.event === 'error') {
          toast.finish(key, {
            tone: 'bad',
            title: vn(L, 'Cập nhật lỗi', 'Update failed'),
            message: ev.error || '',
          })
        }
        return
      }
      if (ev.type === 'log-clear') {
        setLogs((l) => ({ ...l, [ev.id]: [] }))
        return
      }
      if (ev.type === 'banner') {
        const inst = instancesRef.current.find((i) => i.id === ev.id) || selectedRef.current
        setLogs((l) => ({ ...l, [ev.id]: launchBannerLines(inst, versionRef.current) }))
        return
      }
      if (ev.type === 'log') {
        setLogs((l) => ({ ...l, [ev.id]: [...(l[ev.id] || []), ev.line].slice(-600) }))
        return
      }
      if (ev.type === 'crash') {
        setCrashes((prev) => ({ ...prev, [ev.id]: ev.crash }))
        setOpenCrash(ev.id)
        toast.notify({
          tone: 'warn',
          title: vn(langRef.current, 'Game gặp sự cố', 'Game crashed'),
          message: [instancesRef.current.find((i) => i.id === ev.id)?.name, ev.crash?.summary].filter(Boolean).join(' · '),
          duration: 7000,
        })
        return
      }
      if (ev.type === 'created' || ev.type === 'exit' || ev.type === 'state') refreshInstances()
    })
    return off
  }, [refreshInstances])

  useEffect(() => {
    let alive = true
    const fadeTimer = setTimeout(() => {
      if (!alive) return
      setBoot('leaving')
      setTimeout(() => { if (alive) setBoot('done') }, SPLASH_FADE_MS)
    }, SPLASH_MIN_MS)
    return () => { alive = false; clearTimeout(fadeTimer) }
  }, [])

  useEffect(() => {
    if (boot === 'done') return
    setBootStatus(versionsLoading ? 'versions' : 'ready')
  }, [versionsLoading, boot])

  const navigateTo = useCallback((page) => {
    setPhase('fading-out')
    setTimeout(() => {
      setDisplayPage(page)
      setActivePage(page)
      setPhase('fading-in')
      setTimeout(() => setPhase('idle'), PAGE_FADE_MS)
    }, PAGE_FADE_MS)
  }, [])

  const handleSelectInstance = useCallback((inst) => {
    setSelectedInstance(inst)
    setShowDropdown(false)
    navigateTo('instance-overview')
  }, [navigateTo])

  const handleBack = useCallback(() => {
    setSelectedInstance(null)
    navigateTo('home')
  }, [navigateTo])

  const handleCreate = useCallback(async (payload) => {
    const res = await api.createInstance(payload)
    if (!res?.ok) return res
    await refreshInstances()
    setSelectedInstance(res.instance)
    setProgress((p) => ({ ...p, [res.instance.id]: { phase: 'start', label: 'start', done: 0, total: 0 } }))
    setPhase('fading-out')
    setTimeout(() => {
      setDisplayPage('instance-overview')
      setActivePage('instance-overview')
      setPhase('fading-in')
      setTimeout(() => setPhase('idle'), PAGE_FADE_MS)
    }, PAGE_FADE_MS)
    return res
  }, [refreshInstances])

  const handleLaunch = useCallback(async (instance, username) => {
    setLaunchError((e) => ({ ...e, [instance.id]: '' }))
    setOpenCrash((current) => (current === instance.id ? null : current))
    setCrashes((prev) => {
      if (!prev[instance.id]) return prev
      const next = { ...prev }
      delete next[instance.id]
      return next
    })
    const res = await api.launchInstance({ id: instance.id, username })
    if (!res?.ok) {
      const message = res?.error || vn(langRef.current, 'Không khởi chạy được.', 'Could not launch.')
      setLaunchError((e) => ({ ...e, [instance.id]: message }))
      toast.notify({
        tone: 'bad',
        title: vn(langRef.current, 'Không khởi chạy được', 'Launch failed'),
        message: [instance.name, message].filter(Boolean).join(' · '),
        duration: 8000,
      })
    }
    await refreshInstances()
    return res
  }, [refreshInstances])

  const handleStop = useCallback(async (instance) => {
    await api.stopInstance({ id: instance.id })
    await refreshInstances()
  }, [refreshInstances])

  const handleRestart = useCallback(async (instance) => {
    await api.stopInstance({ id: instance.id })
    for (let i = 0; i < 40; i++) {
      await new Promise((resolve) => setTimeout(resolve, 300))
      const res = await api.listInstances()
      const row = res?.instances?.find((x) => x.id === instance.id)
      if (row && !row.running && row.status !== 'running' && row.status !== 'stopping') break
    }
    await refreshInstances()
    return handleLaunch(instance)
  }, [handleLaunch, refreshInstances])

  const handleRemove = useCallback(async (id, deleteFiles) => {
    await api.removeInstance({ id, deleteFiles })
    await refreshInstances()
    if (selectedRef.current?.id === id || selectedInstance?.id === id) {
      setSelectedInstance(null)
      navigateTo('home')
    }
  }, [refreshInstances, navigateTo, selectedInstance])

  const handleSaveSettings = useCallback(async (patch) => {
    if (!window.electronAPI?.saveSettings) return
    await window.electronAPI.saveSettings(patch)
    if (patch.sharedDir !== undefined || patch.javaPath !== undefined) {
      const s = await api.storage()
      if (s?.ok) setStorage(s)
      api.systemInfo().then((info) => { if (info?.ok) setSystem(info) }).catch(() => {})
    }
  }, [])

  const isFadingOut = phase === 'fading-out'
  const opacityClass = isFadingOut ? 'opacity-0' : 'opacity-100'
  const transitionClass = `transition-opacity duration-200 ${opacityClass}`

  const isInInstance = displayPage.startsWith('instance-') && !!selectedInstance
  const railW = railCollapsed ? RAIL_W_COLLAPSED : RAIL_W

  const instancesWithLive = instances.map((i) => ({ ...i, status: i.running ? 'running' : i.status }))

  const activeAccount = accounts.find((a) => a.id === activeAccountId) || null

  const shared = {
    theme,
    lang,
    instances: instancesWithLive,
    accounts,
    activeAccountId,
    activeAccount,
    onAccountsChanged: (list, id) => { setAccounts(list || []); setActiveAccountId(id || null) },
    selectedInstance,
    onSelectInstance: handleSelectInstance,
    onNavigate: navigateTo,
    toast,
    update,
    progress,
    packProgress,
    onRefreshInstances: refreshInstances,
    launchError,
    logs,
    crashes,
    onOpenCrash: setOpenCrash,
    onLaunch: handleLaunch,
    onStop: handleStop,
    onRestart: handleRestart,
  }

  return (
    <div className="w-screen h-screen flex flex-col overflow-hidden relative z-10" style={{ background: 'transparent' }}>
      <TitleBar version={version} system={system} instance={isInInstance ? selectedInstance : null} />

      {instancesError && (
        <div
          className="shrink-0 px-4 py-1.5 text-[11px] font-medium"
          style={{ background: 'rgba(239,68,68,0.12)', color: '#f87171', borderBottom: '1px solid rgba(239,68,68,0.25)' }}
        >
          {lang === 'vi' ? 'Không đọc được danh sách phiên bản: ' : 'Could not read instances: '}
          {instancesError}
        </div>
      )}

      <div className="flex flex-1 overflow-hidden relative pt-11">
        <Sidebar
          theme={theme}
          lang={lang}
          version={version}
          instances={instancesWithLive}
          account={activeAccount}
          selectedInstance={selectedInstance}
          dropdownOpen={showDropdown}
          onToggleDropdown={() => setShowDropdown((v) => !v)}
          onSelectInstance={handleSelectInstance}
          isInInstance={isInInstance}
          displayPage={displayPage}
          activePage={activePage}
          onNavigate={navigateTo}
          onBack={handleBack}
          collapsed={railCollapsed}
          onToggleCollapsed={() => setRailCollapsed((v) => !v)}
        />

        <div
          className="flex-1 overflow-hidden"
          style={{ marginLeft: railW, transition: 'margin-left 300ms cubic-bezier(0.4, 0, 0.2, 1)' }}
        >
          <div className={`h-full ${transitionClass}`}>
            {displayPage === 'home' && (
              <HomePage
                {...shared}
                system={system}
                versions={versions}
                latest={latest}
                loading={versionsLoading}
                sharedDir={storage.sharedDir}
                onOpenVersions={() => navigateTo('versions')}
              />
            )}
            {displayPage === 'versions' && (
              <VersionsPage
                {...shared}
                versions={versions}
                latest={latest}
                source={source}
                loading={versionsLoading}
                error={versionsError}
                snapshots={snapshots}
                defaultInstanceDir={storage.defaultInstanceDir}
                onToggleSnapshots={(value) => { setSnapshots(value); loadVersions(value, false) }}
                onRefresh={() => loadVersions(snapshotsRef.current, true)}
                onOpenAccounts={() => navigateTo('accounts')}
                onCreate={handleCreate}
              />
            )}
            {displayPage === 'modpacks' && (
              <ModpackPage {...shared} defaultInstanceDir={storage.defaultInstanceDir} />
            )}
            {displayPage === 'accounts' && <AccountsPage {...shared} />}
            {displayPage === 'settings' && (
              <SettingsPage
                {...shared}
                system={system}
                version={version}
                storage={storage}
                onSave={handleSaveSettings}
              />
            )}
            {isInInstance && (
              <InstancePanel
                key={selectedInstance.id}
                {...shared}
                instance={selectedInstance}
                account={activeAccount}
                displayPage={displayPage}
                onBack={handleBack}
                onOpenAccounts={() => navigateTo('accounts')}
                onRemove={handleRemove}
                onSaveInstance={(patch) => setSelectedInstance((s) => (s ? { ...s, ...patch } : s))}
              />
            )}
          </div>
        </div>
      </div>

      {boot !== 'done' && (
        <SplashScreen lang={lang} leaving={boot === 'leaving'} status={bootStatus} version={version} />
      )}

      {openCrash && crashes[openCrash] && (
        <CrashModal
          crash={crashes[openCrash]}
          theme={theme}
          lang={lang}
          onClose={() => setOpenCrash(null)}
        />
      )}

      <TooltipProvider />
    </div>
  )
}

function App() {
  return (
    <AppProvider>
      <ToastProvider>
        <AppContent />
      </ToastProvider>
    </AppProvider>
  )
}

export default App
