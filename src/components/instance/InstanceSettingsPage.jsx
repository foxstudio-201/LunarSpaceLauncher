import { useEffect, useState } from 'react'
import { GearSix, FolderOpen, Trash, Terminal, FloppyDisk, CheckCircle, WarningCircle, PlayCircle, UserCircle, RocketLaunch, Lightning, Package, X, FileArrowUp, ArrowsClockwise, SpinnerGap, Coffee } from '@phosphor-icons/react'
import { t } from '../../i18n/translations'
import { palette } from '../../lib/palette'
import HeadSkin from '../ui/HeadSkin'
import Select from '../ui/Select'
import * as api from '../../api/client.js'

const EXPORT_FORMATS = [
  {
    id: 'serverpack',
    vi: 'Serverpack — tệp .zip',
    en: 'Server pack — .zip file',
    hintVi: 'Mở trang chọn nội dung dạng cây: tick từng thư mục/tệp, tự tải tệp server theo đúng phiên bản, và tab cấu hình server.properties ghi thẳng vào gói.',
    hintEn: 'Opens a tree picker: tick folders/files, auto-downloads the matching server file, and a server.properties tab written into the pack.',
  },
  {
    id: 'mrpack',
    vi: 'Modrinth — tệp .mrpack',
    en: 'Modrinth — .mrpack file',
    hintVi: 'Chuẩn Modrinth: mod tham chiếu bằng URL, phần còn lại nằm trong overrides/. Mod không tra được sẽ được nhúng vào overrides.',
    hintEn: 'Modrinth standard: mods are referenced by URL, everything else lands in overrides/. Unmatched mods are embedded in overrides.',
  },
  {
    id: 'curseforge',
    vi: 'CurseForge — tệp .zip',
    en: 'CurseForge — .zip file',
    hintVi: 'Chuẩn CurseForge: manifest.json + overrides/. Mod tra được projectID/fileID sẽ được tham chiếu, còn lại vào overrides/.',
    hintEn: 'CurseForge standard: manifest.json + overrides/. Mods with a known projectID/fileID are referenced, the rest go to overrides/.',
  },
  {
    id: 'zip',
    vi: 'Zip cơ bản',
    en: 'Basic zip',
    hintVi: 'Nén mod, config, gói tài nguyên, shader… của phiên bản (bỏ saves và logs) + lunarspace-profile.json để nhận diện khi nhập lại.',
    hintEn: 'Zips the instance mods, configs, resource packs and shader packs (saves and logs excluded) plus lunarspace-profile.json for re-import.',
  },
]

function Switch({ on, onClick, c, tip }) {
  return (
    <button
      onClick={onClick}
      aria-pressed={on}
      data-tip={tip}
      className="relative w-9 h-5 rounded-full transition-colors shrink-0"
      style={{ background: on ? c.accent : c.input, border: `1px solid ${c.border}` }}
    >
      <span
        className="absolute top-0.5 w-3.5 h-3.5 rounded-full transition-all"
        style={{ left: on ? 18 : 3, background: on ? '#12081f' : c.label }}
      />
    </button>
  )
}

function boostModsHint(lang, loader, game) {
  const set = BOOST_MODS[loader]
  if (!set) {
    return lang === 'vi'
      ? 'Loader này chưa có bộ mod tăng FPS phù hợp.'
      : 'No FPS mod set for this loader yet.'
  }
  const head = lang === 'vi' ? 'Cài từ Modrinth vào thư mục mods' : 'Installs from Modrinth into mods/'
  return `${head}: ${set.join(' + ')} — ${lang === 'vi' ? 'đây mới là phần tăng FPS thật' : 'this is what actually raises FPS'}${game ? ` (${loader} ${game})` : ''}.`
}

const BOOST_MODS = {
  fabric: ['Sodium', 'Lithium', 'FerriteCore', 'ModernFix', 'EntityCulling', 'ImmediatelyFast', 'Dynamic FPS'],
  quilt: ['Sodium', 'Lithium', 'FerriteCore', 'ModernFix', 'EntityCulling', 'ImmediatelyFast', 'Dynamic FPS'],
  forge: ['Embeddium', 'FerriteCore', 'ModernFix', 'EntityCulling', 'ImmediatelyFast', 'Clumps'],
  neoforge: ['Embeddium', 'FerriteCore', 'ModernFix', 'EntityCulling', 'ImmediatelyFast', 'Clumps'],
}

const JVM_DEFAULT = '-XX:+UseG1GC -XX:MaxGCPauseMillis=50'

export default function InstanceSettingsPage({ instance, theme, lang, account, onNavigate, onRemove, onOpenAccounts, onSaveInstance }) {
  const c = palette(theme)
  const loader = api.LOADERS.find((l) => l.id === instance.loader) || api.LOADERS[0]

  const [name, setName] = useState(instance.name)
  const [memory, setMemory] = useState(instance.memoryMb || 2048)
  const [jvm, setJvm] = useState(instance.jvmArgs || JVM_DEFAULT)
  const [boostOn, setBoost] = useState(!!instance.boost)
  const [boostMods, setBoostMods] = useState(!!instance.boostMods)
  const [saved, setSaved] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)
  const [exportFormat, setExportFormat] = useState('mrpack')
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState('')
  const [exportDone, setExportDone] = useState(null)
  const [error, setError] = useState('')
  const [confirming, setConfirming] = useState(false)
  const [deleteFiles, setDeleteFiles] = useState(true)
  const [builds, setBuilds] = useState([])
  const [build, setBuild] = useState(instance.loaderVersion || '')
  const [buildsLoading, setBuildsLoading] = useState(false)
  const [loaderAsk, setLoaderAsk] = useState(false)
  const [loaderBusy, setLoaderBusy] = useState(false)
  const [loaderNote, setLoaderNote] = useState('')
  const [javaPath, setJavaPath] = useState(instance.javaPath || '')
  const [javaList, setJavaList] = useState([])

  useEffect(() => {
    if (!instance.loader || instance.loader === 'vanilla') return undefined
    let alive = true
    setBuildsLoading(true)
    api
      .listLoaderVersions({ kind: instance.loader, game: instance.version })
      .then((res) => {
        if (!alive) return
        setBuilds(res?.versions || [])
      })
      .catch(() => {})
      .finally(() => {
        if (alive) setBuildsLoading(false)
      })
    return () => {
      alive = false
    }
  }, [instance.id, instance.loader, instance.version])

  useEffect(() => {
    setBuild(instance.loaderVersion || '')
  }, [instance.id, instance.loaderVersion])

  useEffect(() => {
    setJavaPath(instance.javaPath || '')
  }, [instance.id, instance.javaPath])

  useEffect(() => {
    let alive = true
    api
      .javaOptions()
      .then((res) => {
        if (!alive) return
        const zulu = (res?.zulu || []).map((item) => ({ value: item.javaPath, label: item.name }))
        const managed = (res?.managed || []).map((item) => ({ value: item.javaPath, label: item.name }))
        const external = (res?.external || []).map((item) => ({ value: item.javaPath, label: `Java ${item.major} (máy này) · ${item.name}` }))
        setJavaList([...zulu, ...managed, ...external])
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [instance.id])

  useEffect(() => {
    setName(instance.name)
    setMemory(instance.memoryMb || 2048)
    setJvm(instance.jvmArgs || JVM_DEFAULT)
    setBoost(!!instance.boost)
    setBoostMods(!!instance.boostMods)
  }, [instance.id, instance.name, instance.memoryMb, instance.jvmArgs, instance.boost, instance.boostMods])

  const save = async () => {
    setError('')
    try {
      const res = await api.updateInstance({ id: instance.id, patch: { name, memoryMb: memory, jvmArgs: jvm, boost: boostOn, boostMods, javaPath } })
      if (!res?.ok) return setError(res?.error || 'error')
      onSaveInstance?.(res.instance)
      setSaved(true)
      setTimeout(() => setSaved(false), 1800)
    } catch (err) {
      setError(err.message)
    }
  }

  const changeLoader = async () => {
    setLoaderAsk(false)
    setLoaderBusy(true)
    setLoaderNote('')
    const res = await api.changeLoaderVersion({ id: instance.id, loaderVersion: build }).catch((err) => ({ ok: false, error: err.message }))
    setLoaderBusy(false)
    if (!res?.ok) {
      setError(res?.error || 'error')
      return
    }
    onSaveInstance?.(res.instance)
    setLoaderNote(t(lang, 'instance.settings.loaderDone'))
    setTimeout(() => setLoaderNote(''), 2600)
  }

  const remove = async () => {
    try {
      await onRemove(instance.id, deleteFiles)
    } catch (err) {
      setError(err.message)
    }
  }

  const rowStyle = { borderTop: `1px solid ${c.border}` }
  const javaOptions = [
    { value: '', label: t(lang, 'instance.settings.javaAuto') },
    ...javaList,
  ]

  const buildOptions = builds.map((row) => {
    const marks = []
    if (row.version === instance.loaderVersion) marks.push(t(lang, 'instance.settings.loaderCurrent'))
    else if (row.latest) marks.push(t(lang, 'instance.settings.loaderLatest'))
    return {
      value: row.version,
      label: marks.length ? `${row.version} · ${marks.join(', ')}` : row.version,
      node: <img src={`./${loader.image}`} alt="" className="w-4 h-4 object-contain" />,
    }
  })

  const runExport = async () => {
    if (exporting) return
    if (exportFormat === 'serverpack') {
      setExportOpen(false)
      onNavigate?.('instance-serverpack')
      return
    }
    setExporting(true)
    setExportError('')
    setExportDone(null)
    const res = await api.exportProfile({ id: instance.id, format: exportFormat }).catch((err) => ({ ok: false, error: err.message }))
    setExporting(false)
    if (!res?.ok) {
      if (!res?.canceled) setExportError(res?.error || 'error')
      return
    }
    setExportDone(res)
    onSaveInstance?.()
  }

  return (
    <div data-surface className="h-full flex flex-col overflow-hidden" style={{ background: c.bg }}>
      <div className="shrink-0 px-6 py-3.5 flex items-center gap-3" style={{ borderBottom: `1px solid ${c.border}` }}>
        <GearSix size={16} weight="duotone" style={{ color: c.accent }} />
        <h1 className="text-sm font-bold" style={{ color: c.text }}>{t(lang, 'instance.settings')}</h1>
        <span className="px-2 py-0.5 rounded-md text-[10px] font-mono" style={{ background: c.input, color: c.label }}>
          {instance.id}
        </span>
        <div className="flex-1" />
        <button
          onClick={save}
          className="h-8 px-3.5 rounded-lg text-[11px] font-bold flex items-center gap-1.5 transition-all active:scale-95"
          style={{ background: saved ? 'rgba(34,197,94,0.18)' : c.accent, color: saved ? '#22c55e' : '#0a0a0a' }}
        >
          {saved ? <CheckCircle size={13} weight="fill" /> : <FloppyDisk size={13} weight="duotone" />}
          {saved ? t(lang, 'settings.saved') : t(lang, 'settings.save')}
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-6 py-4">
        <div className="max-w-3xl mx-auto flex flex-col gap-4">
          {error && (
            <div className="flex items-start gap-2 rounded-lg px-3 py-2" style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.28)' }}>
              <WarningCircle size={13} weight="duotone" className="shrink-0 mt-0.5" style={{ color: '#f87171' }} />
              <span className="text-[10px] leading-relaxed" style={{ color: '#f87171' }}>{error}</span>
            </div>
          )}

          <section className="rounded-xl overflow-hidden" style={{ background: c.surface, border: `1px solid ${c.border}` }}>
            <div className="flex items-center gap-4 px-4 py-3.5">
              <img src={`./${loader.image}`} alt="" className="w-8 h-8 rounded-lg object-contain" />
              <div className="flex-1 min-w-0">
                <p className="text-xs font-bold" style={{ color: c.text }}>{instance.name}</p>
                <p className="text-[10px] font-mono" style={{ color: c.faint }}>
                  {loader.name}{instance.loaderVersion ? ` ${instance.loaderVersion}` : ''} · {instance.version}
                </p>
              </div>
              <span className="text-[10px] font-mono" style={{ color: c.label }}>{instance.created?.slice(0, 10)}</span>
            </div>

            {instance.loader !== 'vanilla' && (
              <div className="flex items-center gap-4 px-4 py-3.5" style={rowStyle}>
                <ArrowsClockwise size={16} weight="duotone" className="shrink-0" style={{ color: c.accent }} />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold" style={{ color: c.text }}>{t(lang, 'instance.settings.loaderVersion')}</p>
                  <p className="text-[10px]" style={{ color: loaderNote ? c.accent : c.faint }}>
                    {loaderNote || (buildsLoading ? t(lang, 'instance.settings.loaderLoading') : t(lang, 'instance.settings.loaderHint'))}
                  </p>
                </div>
                <div className="w-60 shrink-0">
                  <Select
                    theme={theme}
                    value={build}
                    options={buildOptions}
                    onChange={setBuild}
                    placeholder={buildsLoading ? t(lang, 'instance.settings.loaderLoading') : '—'}
                    disabled={loaderBusy || buildsLoading || !builds.length}
                  />
                </div>
                <button
                  onClick={() => setLoaderAsk(true)}
                  disabled={loaderBusy || !build || build === (instance.loaderVersion || '')}
                  className="h-8 px-3 rounded-lg text-[11px] font-bold shrink-0 flex items-center gap-1.5 disabled:opacity-40"
                  style={{ background: c.accent, color: '#0a0a0a' }}
                >
                  {loaderBusy ? (
                    <SpinnerGap size={13} weight="bold" className="animate-spin" />
                  ) : (
                    <ArrowsClockwise size={13} weight="bold" />
                  )}
                  {loaderBusy ? t(lang, 'instance.settings.loaderBusy') : t(lang, 'instance.settings.loaderChange')}
                </button>
              </div>
            )}

            {loaderAsk && (
              <div className="px-4 py-3" style={rowStyle}>
                <div className="rounded-lg p-3 flex flex-col gap-3" style={{ background: c.input, border: `1px solid ${c.border}` }}>
                  <p className="text-[11px] leading-relaxed" style={{ color: c.text }}>
                    {t(lang, 'instance.settings.loaderConfirmBody')}
                  </p>
                  <p className="text-[10px] font-mono" style={{ color: c.label }}>
                    {loader.name} {instance.loaderVersion || '—'} → {build}
                  </p>
                  <p className="text-[10px] leading-relaxed" style={{ color: c.faint }}>
                    {t(lang, 'instance.settings.loaderConfirmHint')}
                  </p>
                  <div className="flex items-center gap-2 justify-end">
                    <button
                      onClick={() => setLoaderAsk(false)}
                      className="h-8 px-3 rounded-lg text-[11px] font-semibold"
                      style={{ background: c.input, border: `1px solid ${c.border}`, color: c.label }}
                    >
                      {t(lang, 'files.cancel')}
                    </button>
                    <button
                      onClick={changeLoader}
                      className="h-8 px-3.5 rounded-lg text-[11px] font-bold"
                      style={{ background: c.accent, color: '#0a0a0a' }}
                    >
                      {t(lang, 'instance.settings.loaderApply')}
                    </button>
                  </div>
                </div>
              </div>
            )}

            <div className="flex items-center gap-4 px-4 py-3.5" style={rowStyle}>
              <Coffee size={16} weight="duotone" className="shrink-0" style={{ color: c.accent }} />
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold" style={{ color: c.text }}>{t(lang, 'instance.settings.java')}</p>
                <p className="text-[10px]" style={{ color: c.faint }}>{t(lang, 'instance.settings.javaHint')}</p>
              </div>
              <div className="w-72 shrink-0">
                <Select
                  theme={theme}
                  value={javaPath}
                  options={javaOptions}
                  onChange={setJavaPath}
                  placeholder={t(lang, 'instance.settings.javaAuto')}
                />
              </div>
            </div>

            <div className="flex items-center gap-4 px-4 py-3.5" style={rowStyle}>
              <FolderOpen size={16} weight="duotone" style={{ color: c.accent }} />
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold" style={{ color: c.text }}>{t(lang, 'instance.settings.runDir')}</p>
                <p className="text-[10px] font-mono break-all" style={{ color: c.faint }}>{instance.dir}</p>
              </div>
              <button
                onClick={() => api.revealPath(instance.dir).catch(() => {})}
                className="h-8 px-3 rounded-lg text-[11px] font-semibold shrink-0"
                style={{ background: c.input, border: `1px solid ${c.border}`, color: c.label }}
              >
                {t(lang, 'settings.openFolder')}
              </button>
            </div>

            <div className="flex items-center gap-4 px-4 py-3.5" style={rowStyle}>
              <Package size={16} weight="duotone" style={{ color: c.accent }} />
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold" style={{ color: c.text }}>{t(lang, 'instance.settings.export')}</p>
                <p className="mt-0.5 text-[10px] leading-relaxed" style={{ color: c.faint }}>{t(lang, 'instance.settings.exportHint')}</p>
              </div>
              <button
                onClick={() => { setExportError(''); setExportDone(null); setExportOpen(true) }}
                className="h-8 px-3 rounded-lg text-[11px] font-semibold shrink-0"
                style={{ background: c.input, border: `1px solid ${c.border}`, color: c.label }}
              >
                {t(lang, 'instance.settings.exportOpen')}
              </button>
            </div>

            <div className="flex items-center gap-4 px-4 py-3.5" style={rowStyle}>
              <GearSix size={16} weight="duotone" style={{ color: c.accent }} />
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold" style={{ color: c.text }}>{t(lang, 'instance.settings.instanceName')}</p>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={t(lang, 'instance.settings.instanceName')}
                  className="mt-1.5 w-full h-8 px-2.5 rounded-lg text-[11px] outline-none"
                  style={{ background: c.input, border: `1px solid ${c.border}`, color: c.text }}
                />
              </div>
            </div>

            <div className="flex items-center gap-4 px-4 py-3.5" style={rowStyle}>
              {account ? (
                <HeadSkin name={account.name} uuid={account.uuid} type={account.type} size={16} radius={5} theme={theme} />
              ) : (
                <UserCircle size={16} weight="duotone" style={{ color: c.accent }} />
              )}
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold" style={{ color: c.text }}>{t(lang, 'instance.settings.player')}</p>
                {account ? (
                  <>
                    <p className="text-[10px] font-mono mt-0.5 truncate" style={{ color: c.faint }}>
                      {account.name} · {account.uuid}
                    </p>
                    <p className="mt-0.5 text-[10px]" style={{ color: c.faint }}>{t(lang, 'instance.settings.playerFrom')}</p>
                  </>
                ) : (
                  <p className="mt-0.5 text-[10px]" style={{ color: '#f59e0b' }}>{t(lang, 'instance.settings.noAccount')}</p>
                )}
              </div>
              <button
                onClick={onOpenAccounts}
                className="h-8 px-3 rounded-lg text-[11px] font-semibold shrink-0"
                style={{ background: account ? c.input : c.accent, border: account ? `1px solid ${c.border}` : 'none', color: account ? c.label : '#12081f' }}
              >
                {account ? t(lang, 'instance.settings.changeAccount') : t(lang, 'instance.settings.addAccount')}
              </button>
            </div>

            {instance.demo && (
              <div className="flex items-center gap-4 px-4 py-3.5" style={rowStyle}>
                <PlayCircle size={16} weight="duotone" style={{ color: c.accent }} />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold" style={{ color: c.accent }}>{t(lang, 'versions.demo')}</p>
                  <p className="mt-0.5 text-[10px]" style={{ color: c.faint }}>{t(lang, 'instance.settings.demoOn')}</p>
                </div>
              </div>
            )}

            <div className="flex items-center gap-4 px-4 py-3.5" style={rowStyle}>
              <RocketLaunch size={16} weight="duotone" style={{ color: boostOn ? c.accent : c.label }} />
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold" style={{ color: boostOn ? c.accent : c.text }}>
                  {t(lang, 'instance.settings.boost')}
                </p>
                <p className="mt-0.5 text-[10px] leading-relaxed" style={{ color: c.faint }}>
                  {t(lang, 'instance.settings.boostHint')}
                </p>
              </div>
              <Switch on={boostOn} onClick={() => setBoost((v) => !v)} c={c} tip={t(lang, 'instance.settings.boost')} />
            </div>

            <div className="flex items-center gap-4 px-4 py-3.5" style={rowStyle}>
              <Lightning size={16} weight="duotone" style={{ color: boostMods ? c.accent : c.label }} />
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold" style={{ color: boostMods ? c.accent : c.text }}>
                  {t(lang, 'instance.settings.boostMods')}
                </p>
                <p className="mt-0.5 text-[10px] leading-relaxed" style={{ color: c.faint }}>
                  {boostModsHint(lang, instance.loader, instance.version)}
                </p>
              </div>
              <Switch on={boostMods} onClick={() => setBoostMods((v) => !v)} c={c} tip={t(lang, 'instance.settings.boostMods')} />
            </div>

            <div className="flex items-center gap-4 px-4 py-3.5" style={rowStyle}>
              <Terminal size={16} weight="duotone" style={{ color: c.accent }} />
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold" style={{ color: c.text }}>{t(lang, 'instance.settings.jvm')}</p>
                <input
                  value={jvm}
                  onChange={(e) => setJvm(e.target.value)}
                  className="mt-1 w-full h-8 px-2.5 rounded-lg text-[11px] font-mono outline-none"
                  style={{ background: c.input, border: `1px solid ${c.border}`, color: c.text }}
                />
                {boostOn && (
                  <p className="mt-1 text-[10px]" style={{ color: c.accent }}>{t(lang, 'instance.settings.jvmBoostNote')}</p>
                )}
              </div>
            </div>

            <div className="flex items-center gap-4 px-4 py-3.5" style={rowStyle}>
              <Terminal size={16} weight="duotone" style={{ color: c.accent }} />
              <div className="flex-1">
                <p className="text-xs font-semibold" style={{ color: c.text }}>{t(lang, 'settings.memory')}</p>
                <input
                  type="range"
                  min="1024"
                  max="16384"
                  step="512"
                  value={memory}
                  onChange={(e) => setMemory(Number(e.target.value))}
                  className="mt-2 w-full accent-[#a78bfa]"
                />
              </div>
              <span className="w-20 text-right text-[11px] font-mono" style={{ color: c.text }}>{memory} MB</span>
            </div>
          </section>

          <section className="rounded-xl p-4 flex flex-col gap-3" style={{ background: c.surface, border: '1px solid rgba(239,68,68,0.28)' }}>
            <div className="flex items-center gap-4">
              <Trash size={18} weight="duotone" style={{ color: '#ef4444' }} />
              <div className="flex-1">
                <p className="text-xs font-semibold" style={{ color: c.text }}>{t(lang, 'instance.settings.delete')}</p>
                <p className="text-[10px]" style={{ color: c.faint }}>{instance.name} · {instance.version}</p>
              </div>
              {!confirming && (
                <button
                  onClick={() => setConfirming(true)}
                  className="h-8 px-3.5 rounded-lg text-[11px] font-bold"
                  style={{ background: 'rgba(239,68,68,0.14)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.28)' }}
                >
                  {t(lang, 'instance.settings.delete')}
                </button>
              )}
            </div>

            {confirming && (
              <div className="rounded-lg p-3 flex flex-col gap-3" style={{ background: c.input, border: `1px solid ${c.border}` }}>
                <p className="text-[11px] leading-relaxed" style={{ color: c.text }}>
                  {lang === 'vi'
                    ? `Xoá "${instance.name}" khỏi launcher?`
                    : `Remove "${instance.name}" from the launcher?`}
                </p>
                <label className="flex items-center gap-2 text-[11px] cursor-pointer" style={{ color: c.label }}>
                  <input
                    type="checkbox"
                    checked={deleteFiles}
                    onChange={(e) => setDeleteFiles(e.target.checked)}
                    className="accent-[#ef4444]"
                  />
                  {lang === 'vi' ? 'Xoá luôn thư mục instance trên ổ đĩa' : 'Also delete the instance folder on disk'}
                </label>
                <p className="text-[9px] font-mono break-all" style={{ color: c.faint }}>{instance.dir}</p>
                <div className="flex items-center gap-2 justify-end">
                  <button
                    onClick={() => setConfirming(false)}
                    className="h-8 px-3 rounded-lg text-[11px] font-semibold"
                    style={{ background: c.input, border: `1px solid ${c.border}`, color: c.label }}
                  >
                    {lang === 'vi' ? 'Huỷ' : 'Cancel'}
                  </button>
                  <button
                    onClick={remove}
                    className="h-8 px-3.5 rounded-lg text-[11px] font-bold"
                    style={{ background: '#ef4444', color: '#fff' }}
                  >
                    {lang === 'vi' ? 'Xoá' : 'Delete'}
                  </button>
                </div>
              </div>
            )}
          </section>
        </div>
      </div>

      {exportOpen && (
        <div
          className="modal-backdrop fixed inset-0 z-[210] flex items-center justify-center p-6"
          onClick={() => { if (!exporting) setExportOpen(false) }}
        >
          <div
            className="modal-content w-full max-w-[540px] rounded-2xl flex flex-col overflow-hidden"
            style={{ background: c.surface, border: `1px solid ${c.border}` }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2 px-4 py-3" style={{ borderBottom: `1px solid ${c.border}` }}>
              <Package size={15} weight="duotone" style={{ color: c.accent }} />
              <p className="text-[12px] font-bold flex-1" style={{ color: c.text }}>{t(lang, 'instance.settings.export')}</p>
              <button
                onClick={() => { if (!exporting) setExportOpen(false) }}
                className="w-6 h-6 rounded-md flex items-center justify-center"
                style={{ color: c.faint }}
              >
                <X size={13} weight="bold" />
              </button>
            </div>

            <div className="p-4 flex flex-col gap-2.5">
              {EXPORT_FORMATS.map((option) => {
                const on = exportFormat === option.id
                return (
                  <button
                    key={option.id}
                    onClick={() => { setExportFormat(option.id); setExportDone(null); setExportError('') }}
                    className="w-full text-left rounded-xl px-3.5 py-3 flex items-start gap-3 transition-colors"
                    style={{
                      background: on ? 'rgba(167,139,250,0.08)' : c.input,
                      border: `1px solid ${on ? 'rgba(167,139,250,0.4)' : c.border}`,
                    }}
                  >
                    <span
                      className="w-4 h-4 rounded-full shrink-0 mt-0.5 flex items-center justify-center"
                      style={{ border: `1px solid ${on ? c.accent : c.border}` }}
                    >
                      {on && <span className="w-2 h-2 rounded-full" style={{ background: c.accent }} />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[11px] font-bold" style={{ color: on ? c.accent : c.text }}>
                        {lang === 'vi' ? option.vi : option.en}
                      </span>
                      <span className="mt-0.5 block text-[10px] leading-relaxed" style={{ color: c.label }}>
                        {lang === 'vi' ? option.hintVi : option.hintEn}
                      </span>
                    </span>
                  </button>
                )
              })}

              {exportError && (
                <div className="flex items-start gap-2 rounded-lg px-3 py-2" style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.28)' }}>
                  <WarningCircle size={13} weight="duotone" className="shrink-0 mt-0.5" style={{ color: '#f87171' }} />
                  <span className="text-[10px] leading-relaxed" style={{ color: '#f87171' }}>{exportError}</span>
                </div>
              )}

              {exportDone && (
                <div className="rounded-lg px-3 py-2.5 flex flex-col gap-1" style={{ background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.3)' }}>
                  <div className="flex items-center gap-2">
                    <CheckCircle size={13} weight="fill" style={{ color: '#22c55e' }} />
                    <span className="text-[10px] font-semibold" style={{ color: '#22c55e' }}>
                      {Math.round((exportDone.bytes || 0) / 104857.6) / 10} MB
                      {exportDone.mods ? ` · ${exportDone.identified}/${exportDone.mods} mod` : ''}
                    </span>
                    <button
                      onClick={() => api.revealPath(exportDone.path).catch(() => {})}
                      className="ml-auto text-[10px] font-bold shrink-0"
                      style={{ color: c.accent }}
                    >
                      {t(lang, 'settings.openFolder')}
                    </button>
                  </div>
                  <p className="text-[9px] font-mono break-all" style={{ color: c.label }}>{exportDone.path}</p>
                </div>
              )}
            </div>

            <div className="px-4 py-3 flex items-center gap-2 justify-end" style={{ borderTop: `1px solid ${c.border}` }}>
              <button
                onClick={() => setExportOpen(false)}
                disabled={exporting}
                className="h-8 px-3 rounded-lg text-[11px] font-semibold disabled:opacity-50"
                style={{ background: c.input, border: `1px solid ${c.border}`, color: c.label }}
              >
                {lang === 'vi' ? 'Đóng' : 'Close'}
              </button>
              <button
                onClick={runExport}
                disabled={exporting}
                className="h-8 px-4 rounded-lg text-[11px] font-bold flex items-center gap-2 disabled:opacity-60"
                style={{ background: c.accent, color: '#0a0a0a' }}
              >
                {exporting ? <ArrowsClockwise size={13} weight="bold" className="animate-spin" /> : <FileArrowUp size={13} weight="bold" />}
                {exporting
                  ? (lang === 'vi' ? 'Đang xuất…' : 'Exporting…')
                  : exportFormat === 'serverpack'
                    ? (lang === 'vi' ? 'Mở trang serverpack' : 'Open server pack page')
                    : (lang === 'vi' ? 'Xuất profile' : 'Export profile')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
