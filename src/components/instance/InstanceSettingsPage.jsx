import { useEffect, useRef, useState } from 'react'
import { GearSix, FolderOpen, Trash, Terminal, FloppyDisk, CheckCircle, WarningCircle, PlayCircle, UserCircle, RocketLaunch, Lightning, Package, X, FileArrowUp, ArrowsClockwise, SpinnerGap, Coffee, ShareNetwork, Copy, ArrowSquareOut, ImageSquare, TextB, TextItalic, TextUnderline, TextStrikethrough, ListBullets, ListNumbers, Quotes, Code, LinkSimple, ArrowCounterClockwise, ArrowClockwise, TextHOne, TextHTwo, Eraser, Plus, Eye } from '@phosphor-icons/react'
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
  {
    id: 'share',
    vi: 'Chia sẻ lên LunarSpace',
    en: 'Share to LunarSpace',
    hintVi: 'Mở form chia sẻ: ảnh, tên, phiên bản, mô tả… rồi tải instance lên trang Modpack của lunarspace.site. Người khác mở Modpack → LunarModpack để cài.',
    hintEn: 'Opens the share form: image, name, version, description… then uploads the instance to LunarSpace. Others install it from Modpack → LunarModpack.',
  },
]

function readImageFile(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const image = new Image()
    image.onload = () => {
      try {
        const max = 1600
        const scale = Math.min(1, max / Math.max(image.width || 1, image.height || 1))
        const canvas = document.createElement('canvas')
        canvas.width = Math.max(1, Math.round((image.width || 1) * scale))
        canvas.height = Math.max(1, Math.round((image.height || 1) * scale))
        const ctx = canvas.getContext('2d')
        ctx.fillStyle = '#0b0e12'
        ctx.fillRect(0, 0, canvas.width, canvas.height)
        ctx.drawImage(image, 0, 0, canvas.width, canvas.height)
        URL.revokeObjectURL(url)
        resolve(canvas.toDataURL('image/jpeg', 0.84))
      } catch (err) {
        URL.revokeObjectURL(url)
        reject(err)
      }
    }
    image.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('Không đọc được ảnh.'))
    }
    image.src = url
  })
}

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

const SHARE_TOOLS = [
  { cmd: 'bold', icon: TextB, title: ['Đậm', 'Bold'] },
  { cmd: 'italic', icon: TextItalic, title: ['Nghiêng', 'Italic'] },
  { cmd: 'underline', icon: TextUnderline, title: ['Gạch chân', 'Underline'] },
  { cmd: 'strikeThrough', icon: TextStrikethrough, title: ['Gạch ngang', 'Strikethrough'] },
  { cmd: 'formatBlock', value: 'H2', icon: TextHOne, title: ['Tiêu đề lớn', 'Heading 1'] },
  { cmd: 'formatBlock', value: 'H3', icon: TextHTwo, title: ['Tiêu đề nhỏ', 'Heading 2'] },
  { cmd: 'insertUnorderedList', icon: ListBullets, title: ['Gạch đầu dòng', 'Bullet list'] },
  { cmd: 'insertOrderedList', icon: ListNumbers, title: ['Danh sách số', 'Numbered list'] },
  { cmd: 'formatBlock', value: 'BLOCKQUOTE', icon: Quotes, title: ['Trích dẫn', 'Quote'] },
  { cmd: 'formatBlock', value: 'PRE', icon: Code, title: ['Code', 'Code'] },
]

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
  const [reinstallAsk, setReinstallAsk] = useState(false)
  const [loaderBusy, setLoaderBusy] = useState(false)
  const [loaderNote, setLoaderNote] = useState('')
  const [javaPath, setJavaPath] = useState(instance.javaPath || '')
  const [javaList, setJavaList] = useState([])
  const [iconUrl, setIconUrl] = useState(instance.icon && !/^file:/i.test(instance.icon) ? instance.icon : '')
  const [iconBusy, setIconBusy] = useState(false)
  const descRef = useRef(null)
  const inlineFileRef = useRef(null)
  const galleryFileRef = useRef(null)
  const tokenRef = useRef(0)
  const inlineSelectionRef = useRef(null)
  const [shareOpen, setShareOpen] = useState(false)
  const [shareName, setShareName] = useState(instance.name)
  const [shareVersion, setShareVersion] = useState('1.0.0')
  const [shareAuthor, setShareAuthor] = useState(account?.name || '')
  const [shareSummary, setShareSummary] = useState('')
  const [shareDescription, setShareDescription] = useState('')
  const [shareGallery, setShareGallery] = useState([])
  const [shareInlineImages, setShareInlineImages] = useState({})
  const [sharePreview, setSharePreview] = useState('')
  const [shareBusy, setShareBusy] = useState(false)
  const [shareError, setShareError] = useState('')
  const [shareResult, setShareResult] = useState(null)

  useEffect(() => {
    setIconUrl(instance.icon && !/^file:/i.test(instance.icon) ? instance.icon : '')
  }, [instance.id, instance.icon])

  useEffect(() => {
    if (!shareOpen) return
    setShareName(instance.name)
    setShareVersion('1.0.0')
    setShareAuthor(account?.name || '')
    setShareSummary('')
    setShareDescription('')
    setShareGallery([])
    setShareInlineImages((prev) => {
      Object.values(prev).forEach((item) => { if (item?.previewUrl) URL.revokeObjectURL(item.previewUrl) })
      return {}
    })
    setSharePreview('')
    setShareBusy(false)
    setShareError('')
    setShareResult(null)
    tokenRef.current = 0
    requestAnimationFrame(() => {
      if (descRef.current) descRef.current.innerHTML = ''
    })
  }, [shareOpen, instance.id, instance.name, account?.name])

  const changeIcon = async () => {
    if (iconBusy) return
    setIconBusy(true)
    setError('')
    const res = await api.setInstanceIcon({ id: instance.id }).catch((err) => ({ ok: false, error: err.message }))
    setIconBusy(false)
    if (res?.canceled) return res
    if (!res?.ok) {
      setError(res?.error || 'Không đổi được icon.')
      return res
    }
    setIconUrl(res.icon || '')
    onSaveInstance?.({ icon: res.icon || '' })
    return res
  }

  const removeIcon = async () => {
    if (iconBusy) return
    setIconBusy(true)
    const res = await api.clearInstanceIcon({ id: instance.id }).catch((err) => ({ ok: false, error: err.message }))
    setIconBusy(false)
    if (!res?.ok) {
      setError(res?.error || 'Không xoá được icon.')
      return
    }
    setIconUrl('')
    onSaveInstance?.({ icon: '' })
  }

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

  const reinstallLoader = async () => {
    setReinstallAsk(false)
    setLoaderBusy(true)
    setLoaderNote('')
    const res = await api.reinstallLoader({ id: instance.id }).catch((err) => ({ ok: false, error: err.message }))
    setLoaderBusy(false)
    if (!res?.ok) {
      setError(res?.error || 'error')
      return
    }
    onSaveInstance?.(res.instance)
    setLoaderNote(t(lang, 'instance.settings.loaderReinstalled'))
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
    if (exportFormat === 'share') {
      setExportOpen(false)
      setShareOpen(true)
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

  const saveInlineSelection = () => {
    const selection = window.getSelection()
    const editor = descRef.current
    if (selection && editor && selection.rangeCount && editor.contains(selection.anchorNode)) {
      inlineSelectionRef.current = selection.getRangeAt(0).cloneRange()
    }
  }

  const execShare = (command, value = null) => {
    const editor = descRef.current
    if (!editor) return
    editor.focus()
    document.execCommand(command, false, value)
    setShareDescription(editor.innerHTML)
  }

  const addShareLink = () => {
    const url = window.prompt(lang === 'vi' ? 'Nhập URL liên kết:' : 'Enter link URL:', 'https://')
    if (!url) return
    if (!/^https?:\/\//i.test(url)) {
      setShareError(lang === 'vi' ? 'Link phải bắt đầu bằng http:// hoặc https://.' : 'Link must start with http:// or https://.')
      return
    }
    execShare('createLink', url)
  }

  const insertShareImage = async (file) => {
    if (Object.keys(shareInlineImages).length >= 8) {
      setShareError(lang === 'vi' ? 'Tối đa 8 ảnh trong mô tả.' : 'Up to 8 images in the description.')
      return
    }
    try {
      const data = await readImageFile(file)
      const token = `i${++tokenRef.current}`
      const previewUrl = URL.createObjectURL(await (await fetch(data)).blob())
      setShareInlineImages((prev) => ({ ...prev, [token]: { data, previewUrl } }))
      const editor = descRef.current
      editor?.focus()
      const selection = window.getSelection()
      if (selection && inlineSelectionRef.current) {
        selection.removeAllRanges()
        selection.addRange(inlineSelectionRef.current)
      }
      document.execCommand('insertHTML', false, `<img src="${previewUrl}" data-luna-token="${token}" alt="">`)
      setShareDescription(editor?.innerHTML || '')
    } catch (err) {
      setShareError(err.message || 'error')
    }
  }

  const addShareGallery = async (files) => {
    const free = 8 - shareGallery.length
    if (free <= 0) {
      setShareError(lang === 'vi' ? 'Tối đa 8 ảnh preview.' : 'Up to 8 preview images.')
      return
    }
    const picked = Array.from(files || []).slice(0, free)
    for (const file of picked) {
      try {
        const data = await readImageFile(file)
        const token = `g${++tokenRef.current}`
        setShareGallery((prev) => [...prev, { token, data }])
      } catch (err) {
        setShareError(err.message || 'error')
      }
    }
  }

  const submitShare = async () => {
    if (shareBusy) return
    if (!shareName.trim()) {
      setShareError(lang === 'vi' ? 'Nhập tên modpack trước khi chia sẻ.' : 'Enter a modpack name first.')
      return
    }
    const html = descRef.current?.innerHTML || shareDescription
    const inlineImages = Object.entries(shareInlineImages)
      .filter(([token]) => html.includes(token))
      .map(([token, item]) => ({ token, data: item.data }))
    const gallery = shareGallery.map(({ token, data }) => ({ token, data }))
    const mediaSize = inlineImages.reduce((sum, item) => sum + item.data.length, 0)
      + gallery.reduce((sum, item) => sum + item.data.length, 0)
    if (mediaSize > 16 * 1024 * 1024) {
      setShareError(lang === 'vi' ? 'Tổng dung lượng ảnh vượt 16 MB.' : 'Total image size exceeds 16 MB.')
      return
    }
    setShareBusy(true)
    setShareError('')
    setShareResult(null)
    const res = await api.shareInstance({
      id: instance.id,
      name: shareName.trim(),
      author: shareAuthor.trim(),
      summary: shareSummary.trim(),
      description: html,
      descriptionFormat: 'html',
      images: inlineImages,
      gallery,
      version: shareVersion.trim() || '1.0.0',
    }).catch((err) => ({ ok: false, error: err.message }))
    setShareBusy(false)
    if (!res?.ok) {
      setShareError(res?.error || 'error')
      return
    }
    setShareResult(res)
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

            <div className="flex items-center gap-4 px-4 py-3.5" style={rowStyle}>
              <img
                src={iconUrl || `./${loader.image}`}
                alt=""
                className="w-14 h-14 rounded-xl object-cover shrink-0"
                style={{ border: `1px solid ${c.border}`, background: c.input }}
              />
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold" style={{ color: c.text }}>
                  {lang === 'vi' ? 'Icon phiên bản' : 'Instance icon'}
                </p>
                <p className="text-[10px] leading-relaxed" style={{ color: c.faint }}>
                  {lang === 'vi'
                    ? 'Dùng ảnh PNG/JPG/WebP từ máy. Ảnh được cắt vuông và thu về 256×256.'
                    : 'Use a PNG/JPG/WebP image. It is center-cropped and resized to 256×256.'}
                </p>
              </div>
              <button
                onClick={changeIcon}
                disabled={iconBusy}
                className="h-8 px-3 rounded-lg text-[11px] font-bold flex items-center gap-1.5 disabled:opacity-50 shrink-0"
                style={{ background: c.accent, color: '#0a0a0a' }}
              >
                {iconBusy ? <ArrowsClockwise size={13} weight="bold" className="animate-spin" /> : <ImageSquare size={13} weight="duotone" />}
                {lang === 'vi' ? 'Đổi icon' : 'Change icon'}
              </button>
              <button
                onClick={removeIcon}
                disabled={iconBusy || !iconUrl}
                className="h-8 px-3 rounded-lg text-[11px] font-semibold disabled:opacity-35 shrink-0"
                style={{ background: c.input, border: `1px solid ${c.border}`, color: c.label }}
              >
                {lang === 'vi' ? 'Xoá' : 'Remove'}
              </button>
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
                  onClick={() => { setLoaderAsk(true); setReinstallAsk(false) }}
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
                <button
                  onClick={() => { setReinstallAsk(true); setLoaderAsk(false) }}
                  disabled={loaderBusy}
                  title={t(lang, 'instance.settings.loaderReinstallHint')}
                  className="h-8 px-3 rounded-lg text-[11px] font-bold shrink-0 flex items-center gap-1.5 disabled:opacity-40"
                  style={{ background: c.input, border: `1px solid ${c.border}`, color: c.label }}
                >
                  <ArrowsClockwise size={13} weight="bold" />
                  {t(lang, 'instance.settings.loaderReinstall')}
                </button>
              </div>
            )}

            {reinstallAsk && (
              <div className="px-4 py-3" style={rowStyle}>
                <div className="rounded-lg p-3 flex flex-col gap-3" style={{ background: c.input, border: `1px solid ${c.border}` }}>
                  <p className="text-[11px] leading-relaxed" style={{ color: c.text }}>
                    {t(lang, 'instance.settings.loaderReinstallConfirm')}
                  </p>
                  <p className="text-[10px] leading-relaxed" style={{ color: c.faint }}>
                    {t(lang, 'instance.settings.loaderReinstallHint')}
                  </p>
                  <div className="flex items-center gap-2 justify-end">
                    <button
                      onClick={() => setReinstallAsk(false)}
                      className="h-8 px-3 rounded-lg text-[11px] font-semibold"
                      style={{ background: c.input, border: `1px solid ${c.border}`, color: c.label }}
                    >
                      {t(lang, 'files.cancel')}
                    </button>
                    <button
                      onClick={reinstallLoader}
                      className="h-8 px-3.5 rounded-lg text-[11px] font-bold"
                      style={{ background: c.accent, color: '#0a0a0a' }}
                    >
                      {t(lang, 'instance.settings.loaderReinstallApply')}
                    </button>
                  </div>
                </div>
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

              {exportDone?.url && (
                <div className="rounded-lg px-3 py-2.5 flex flex-col gap-2" style={{ background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.3)' }}>
                  <div className="flex items-center gap-2">
                    <CheckCircle size={13} weight="fill" style={{ color: '#22c55e' }} />
                    <span className="text-[10px] font-semibold" style={{ color: '#22c55e' }}>
                      {lang === 'vi' ? 'Đã chia sẻ lên LunarSpace' : 'Shared to LunarSpace'}
                    </span>
                    <span className="ml-auto text-[10px] font-mono" style={{ color: c.label }}>
                      {Math.round((exportDone.bytes || 0) / 104857.6) / 10} MB
                    </span>
                  </div>
                  <p className="text-[9px] font-mono break-all" style={{ color: c.label }}>{exportDone.url}</p>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => api.copyText(exportDone.url).catch(() => {})}
                      className="h-7 px-2.5 rounded-md text-[10px] font-bold flex items-center gap-1"
                      style={{ background: c.input, border: `1px solid ${c.border}`, color: c.label }}
                    >
                      <Copy size={11} /> {lang === 'vi' ? 'Copy link' : 'Copy link'}
                    </button>
                    <button
                      onClick={() => api.openExternal(exportDone.url).catch(() => {})}
                      className="h-7 px-2.5 rounded-md text-[10px] font-bold flex items-center gap-1"
                      style={{ background: c.input, border: `1px solid ${c.border}`, color: c.label }}
                    >
                      <ArrowSquareOut size={11} /> {lang === 'vi' ? 'Mở trang' : 'Open page'}
                    </button>
                  </div>
                </div>
              )}

              {exportDone && !exportDone.url && (
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
                  ? (exportFormat === 'share'
                    ? (lang === 'vi' ? 'Đang chia sẻ…' : 'Sharing…')
                    : (lang === 'vi' ? 'Đang xuất…' : 'Exporting…'))
                  : exportFormat === 'serverpack'
                    ? (lang === 'vi' ? 'Mở trang serverpack' : 'Open server pack page')
                    : exportFormat === 'share'
                      ? (lang === 'vi' ? 'Chia sẻ lên web' : 'Share to web')
                      : (lang === 'vi' ? 'Xuất profile' : 'Export profile')}
              </button>
            </div>
          </div>
        </div>
      )}

      {shareOpen && (
        <div
          className="modal-backdrop fixed inset-0 z-[215] flex items-center justify-center p-4"
          onClick={() => { if (!shareBusy) setShareOpen(false) }}
        >
          <div
            className="modal-content w-full max-w-[640px] max-h-[92vh] rounded-2xl flex flex-col overflow-hidden"
            style={{ background: c.surface, border: `1px solid ${c.border}` }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2 px-4 py-3" style={{ borderBottom: `1px solid ${c.border}` }}>
              <ShareNetwork size={15} weight="duotone" style={{ color: c.accent }} />
              <p className="text-[12px] font-bold flex-1" style={{ color: c.text }}>
                {lang === 'vi' ? 'Chia sẻ modpack lên LunarSpace' : 'Share modpack to LunarSpace'}
              </p>
              <button
                onClick={() => { if (!shareBusy) setShareOpen(false) }}
                className="w-6 h-6 rounded-md flex items-center justify-center"
                style={{ color: c.faint }}
                disabled={shareBusy}
              >
                <X size={13} weight="bold" />
              </button>
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto p-4 flex flex-col gap-3">
              <div className="flex items-center gap-4">
                <img
                  src={iconUrl || `./${loader.image}`}
                  alt=""
                  className="w-20 h-20 rounded-2xl object-cover shrink-0"
                  style={{ background: c.input, border: `1px solid ${c.border}` }}
                />
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-bold" style={{ color: c.text }}>
                    {lang === 'vi' ? 'Ảnh đại diện modpack' : 'Modpack cover'}
                  </p>
                  <p className="mt-1 text-[10px] leading-relaxed" style={{ color: c.faint }}>
                    {lang === 'vi'
                      ? 'Ảnh được lưu trong instance và hiển thị trên web. Dùng PNG/JPG/WebP, tự cắt vuông 256×256.'
                      : 'Stored in the instance and shown on the web. PNG/JPG/WebP, center-cropped to 256×256.'}
                  </p>
                </div>
                <button
                  onClick={async () => {
                    const res = await changeIcon()
                    if (res && !res.ok && !res.canceled) setShareError(res.error || 'error')
                  }}
                  disabled={iconBusy || shareBusy}
                  className="h-8 px-3 rounded-lg text-[11px] font-bold flex items-center gap-1.5 shrink-0 disabled:opacity-50"
                  style={{ background: c.input, border: `1px solid ${c.border}`, color: c.label }}
                >
                  {iconBusy ? <ArrowsClockwise size={13} weight="bold" className="animate-spin" /> : <ImageSquare size={13} weight="duotone" />}
                  {lang === 'vi' ? 'Đổi ảnh' : 'Change image'}
                </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label className="flex flex-col gap-1">
                  <span className="text-[10px] font-semibold" style={{ color: c.label }}>{lang === 'vi' ? 'Tên modpack' : 'Modpack name'}</span>
                  <input value={shareName} onChange={(e) => setShareName(e.target.value)} maxLength={80} className="h-8 px-2.5 rounded-lg text-[11px] outline-none" style={{ background: c.input, border: `1px solid ${c.border}`, color: c.text }} />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-[10px] font-semibold" style={{ color: c.label }}>{lang === 'vi' ? 'Phiên bản modpack' : 'Modpack version'}</span>
                  <input value={shareVersion} onChange={(e) => setShareVersion(e.target.value)} maxLength={40} placeholder="1.0.0" className="h-8 px-2.5 rounded-lg text-[11px] font-mono outline-none" style={{ background: c.input, border: `1px solid ${c.border}`, color: c.text }} />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-[10px] font-semibold" style={{ color: c.label }}>{lang === 'vi' ? 'Người chia sẻ' : 'Author'}</span>
                  <input value={shareAuthor} onChange={(e) => setShareAuthor(e.target.value)} maxLength={40} placeholder={account?.name || ''} className="h-8 px-2.5 rounded-lg text-[11px] outline-none" style={{ background: c.input, border: `1px solid ${c.border}`, color: c.text }} />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-[10px] font-semibold" style={{ color: c.label }}>{lang === 'vi' ? 'Mô tả ngắn' : 'Short summary'}</span>
                  <input value={shareSummary} onChange={(e) => setShareSummary(e.target.value)} maxLength={280} placeholder={lang === 'vi' ? 'Vài dòng giới thiệu…' : 'A short introduction…'} className="h-8 px-2.5 rounded-lg text-[11px] outline-none" style={{ background: c.input, border: `1px solid ${c.border}`, color: c.text }} />
                </label>
              </div>

              <div className="lshare-editor flex flex-col gap-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[10px] font-semibold" style={{ color: c.label }}>{lang === 'vi' ? 'Mô tả đầy đủ' : 'Full description'}</span>
                  <span className="text-[9px]" style={{ color: c.faint }}>{lang === 'vi' ? 'Có thể chèn ảnh vào mô tả' : 'Images can be inserted'}</span>
                </div>
                <div className="rounded-lg overflow-hidden" style={{ border: `1px solid ${c.border}`, background: c.input }}>
                  <div className="flex flex-wrap items-center gap-0.5 px-1.5 py-1" style={{ borderBottom: `1px solid ${c.border}`, background: c.surface }}>
                    <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => execShare('undo')} title={lang === 'vi' ? 'Hoàn tác' : 'Undo'} className="w-7 h-7 rounded-md flex items-center justify-center hover:opacity-70" style={{ color: c.label }}>
                      <ArrowCounterClockwise size={13} />
                    </button>
                    <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => execShare('redo')} title={lang === 'vi' ? 'Làm lại' : 'Redo'} className="w-7 h-7 rounded-md flex items-center justify-center hover:opacity-70" style={{ color: c.label }}>
                      <ArrowClockwise size={13} />
                    </button>
                    <span className="w-px h-5 mx-1" style={{ background: c.border }} />
                    {SHARE_TOOLS.map((tool) => {
                      const Icon = tool.icon
                      return (
                        <button key={`${tool.cmd}-${tool.value || ''}`} type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => execShare(tool.cmd, tool.value || null)} title={lang === 'vi' ? tool.title[0] : tool.title[1]} className="w-7 h-7 rounded-md flex items-center justify-center hover:opacity-70" style={{ color: c.label }}>
                          <Icon size={14} />
                        </button>
                      )
                    })}
                    <span className="w-px h-5 mx-1" style={{ background: c.border }} />
                    <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={addShareLink} title={lang === 'vi' ? 'Chèn liên kết' : 'Insert link'} className="w-7 h-7 rounded-md flex items-center justify-center hover:opacity-70" style={{ color: c.label }}>
                      <LinkSimple size={14} />
                    </button>
                    <button type="button" onMouseDown={(e) => { e.preventDefault(); saveInlineSelection() }} onClick={() => inlineFileRef.current?.click()} title={lang === 'vi' ? 'Chèn ảnh vào mô tả' : 'Insert image'} className="w-7 h-7 rounded-md flex items-center justify-center hover:opacity-70" style={{ color: c.accent }}>
                      <ImageSquare size={14} />
                    </button>
                    <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => execShare('removeFormat')} title={lang === 'vi' ? 'Xoá định dạng' : 'Clear formatting'} className="w-7 h-7 rounded-md flex items-center justify-center hover:opacity-70" style={{ color: c.label }}>
                      <Eraser size={14} />
                    </button>
                    <input ref={inlineFileRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => { const file = e.target.files?.[0]; if (file) insertShareImage(file); e.target.value = '' }} />
                  </div>
                  <div
                    ref={descRef}
                    contentEditable
                    suppressContentEditableWarning
                    role="textbox"
                    aria-multiline="true"
                    onInput={(e) => setShareDescription(e.currentTarget.innerHTML)}
                    className="px-3 py-2.5 text-[11px] leading-relaxed outline-none min-h-[180px] max-h-[340px] overflow-y-auto"
                    style={{ color: c.text }}
                    data-placeholder={lang === 'vi' ? 'Giới thiệu nội dung, mod, cách chơi, lưu ý khi cài…' : 'Content, mods, gameplay, install notes…'}
                  />
                </div>
                <style>{`.lshare-editor [contenteditable]:empty::before{content:attr(data-placeholder);color:var(--faint);pointer-events:none}`}</style>
              </div>

              <div className="flex flex-col gap-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[10px] font-semibold" style={{ color: c.label }}>{lang === 'vi' ? 'Ảnh preview' : 'Preview images'}</span>
                  <button type="button" onClick={() => galleryFileRef.current?.click()} disabled={shareGallery.length >= 8} className="h-7 px-2.5 rounded-md text-[10px] font-bold flex items-center gap-1 disabled:opacity-40" style={{ background: c.input, border: `1px solid ${c.border}`, color: c.label }}>
                    <Plus size={11} /> {lang === 'vi' ? 'Thêm ảnh' : 'Add images'}
                  </button>
                  <input ref={galleryFileRef} type="file" accept="image/png,image/jpeg,image/webp" multiple className="hidden" onChange={(e) => { addShareGallery(e.target.files); e.target.value = '' }} />
                </div>
                {shareGallery.length === 0 ? (
                  <p className="text-[9px] leading-relaxed" style={{ color: c.faint }}>
                    {lang === 'vi' ? 'Thêm vài ảnh chụp để người khác xem trước modpack. Tối đa 8 ảnh.' : 'Add screenshots so others can preview the pack. Up to 8 images.'}
                  </p>
                ) : (
                  <div className="grid grid-cols-4 sm:grid-cols-6 gap-2">
                    {shareGallery.map((item) => (
                      <div key={item.token} className="relative group rounded-lg overflow-hidden" style={{ border: `1px solid ${c.border}` }}>
                        <img src={item.data} alt="" className="w-full h-16 object-cover" />
                        <div className="absolute inset-0 flex items-center justify-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity" style={{ background: 'rgba(0,0,0,0.55)' }}>
                          <button type="button" onClick={() => setSharePreview(item.data)} title="Preview" className="w-6 h-6 rounded-md flex items-center justify-center" style={{ background: 'rgba(255,255,255,0.16)', color: '#fff' }}>
                            <Eye size={11} />
                          </button>
                          <button type="button" onClick={() => setShareGallery((prev) => prev.filter((row) => row.token !== item.token))} title="Remove" className="w-6 h-6 rounded-md flex items-center justify-center" style={{ background: 'rgba(239,68,68,0.72)', color: '#fff' }}>
                            <Trash size={11} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-2 rounded-lg px-3 py-2" style={{ background: c.input, border: `1px solid ${c.border}` }}>
                <span className="text-[9px] font-mono px-1.5 py-0.5 rounded" style={{ background: c.surface, color: c.label }}>MC {instance.version}</span>
                <span className="text-[9px] font-mono px-1.5 py-0.5 rounded" style={{ background: c.surface, color: c.label }}>{instance.loader}{instance.loaderVersion ? ` ${instance.loaderVersion}` : ''}</span>
                <span className="text-[9px] font-mono px-1.5 py-0.5 rounded" style={{ background: c.surface, color: c.label }}>{instance.memoryMb} MB</span>
              </div>

              {shareError && (
                <div className="flex items-start gap-2 rounded-lg px-3 py-2" style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.28)' }}>
                  <WarningCircle size={13} weight="duotone" className="shrink-0 mt-0.5" style={{ color: '#f87171' }} />
                  <span className="text-[10px] leading-relaxed" style={{ color: '#f87171' }}>{shareError}</span>
                </div>
              )}

              {shareResult && (
                <div className="rounded-lg px-3 py-2.5 flex flex-col gap-2" style={{ background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.3)' }}>
                  <div className="flex items-center gap-2">
                    <CheckCircle size={13} weight="fill" style={{ color: '#22c55e' }} />
                    <span className="text-[10px] font-semibold" style={{ color: '#22c55e' }}>
                      {lang === 'vi' ? 'Đã chia sẻ lên LunarSpace' : 'Shared to LunarSpace'}
                    </span>
                    <span className="ml-auto text-[10px] font-mono" style={{ color: c.label }}>
                      {Math.round((shareResult.bytes || 0) / 104857.6) / 10} MB
                    </span>
                  </div>
                  <p className="text-[9px] font-mono break-all" style={{ color: c.label }}>{shareResult.url}</p>
                  <div className="flex items-center gap-2">
                    <button onClick={() => api.copyText(shareResult.url).catch(() => {})} className="h-7 px-2.5 rounded-md text-[10px] font-bold flex items-center gap-1" style={{ background: c.input, border: `1px solid ${c.border}`, color: c.label }}>
                      <Copy size={11} /> Copy link
                    </button>
                    <button onClick={() => api.openExternal(shareResult.url).catch(() => {})} className="h-7 px-2.5 rounded-md text-[10px] font-bold flex items-center gap-1" style={{ background: c.input, border: `1px solid ${c.border}`, color: c.label }}>
                      <ArrowSquareOut size={11} /> {lang === 'vi' ? 'Mở trang' : 'Open page'}
                    </button>
                  </div>
                </div>
              )}
            </div>

            <div className="px-4 py-3 flex items-center gap-2 justify-end" style={{ borderTop: `1px solid ${c.border}` }}>
              <button
                onClick={() => { if (!shareBusy) setShareOpen(false) }}
                disabled={shareBusy}
                className="h-8 px-3 rounded-lg text-[11px] font-semibold disabled:opacity-50"
                style={{ background: c.input, border: `1px solid ${c.border}`, color: c.label }}
              >
                {lang === 'vi' ? 'Đóng' : 'Close'}
              </button>
              {!shareResult && (
                <button
                  onClick={submitShare}
                  disabled={shareBusy || !shareName.trim()}
                  className="h-8 px-4 rounded-lg text-[11px] font-bold flex items-center gap-2 disabled:opacity-60"
                  style={{ background: c.accent, color: '#0a0a0a' }}
                >
                  {shareBusy ? <ArrowsClockwise size={13} weight="bold" className="animate-spin" /> : <ShareNetwork size={13} weight="bold" />}
                  {shareBusy
                    ? (lang === 'vi' ? 'Đang chia sẻ…' : 'Sharing…')
                    : (lang === 'vi' ? 'Chia sẻ lên web' : 'Share to web')}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {sharePreview && (
        <div
          className="fixed inset-0 z-[230] flex items-center justify-center p-8"
          style={{ background: 'rgba(0,0,0,0.82)' }}
          onClick={() => setSharePreview('')}
        >
          <img src={sharePreview} alt="" className="max-w-full max-h-full rounded-xl object-contain" style={{ border: `1px solid ${c.border}` }} onClick={(e) => e.stopPropagation()} />
        </div>
      )}
    </div>
  )
}
