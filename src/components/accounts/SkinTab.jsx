import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  ArrowClockwise,
  ArrowCounterClockwise,
  ArrowsOutCardinal,
  CaretLeft,
  CaretRight,
  Check,
  CornersIn,
  Drop,
  Eraser,
  Eye,
  EyeSlash,
  Eyedropper,
  FloppyDisk,
  FlipHorizontal,
  GridFour,
  Hand,
  ImageSquare,
  Palette,
  SlidersHorizontal,
  Info,
  PaintBucket,
  PencilSimple,
  Trash,
  UploadSimple,
  User,
  Warning,
} from '@phosphor-icons/react'
import { palette } from '../../lib/palette'
import { t } from '../../i18n/translations'
import HeadSkin from '../ui/HeadSkin'
import Select from '../ui/Select'
import ConfirmModal from '../ui/ConfirmModal'
import ColorPanel from './ColorPanel'
import SkinViewer3D from './SkinViewer3D'
import * as api from '../../api/client.js'

const PARTS = [
  ['head', 'accounts.skin.part.head'],
  ['body', 'accounts.skin.part.body'],
  ['rightArm', 'accounts.skin.part.rightArm'],
  ['leftArm', 'accounts.skin.part.leftArm'],
  ['rightLeg', 'accounts.skin.part.rightLeg'],
  ['leftLeg', 'accounts.skin.part.leftLeg'],
  ['cape', 'accounts.skin.part.cape'],
]

function paintImage(canvas, dataUrl, width, height, done) {
  if (!canvas) return
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  ctx.clearRect(0, 0, width, height)
  if (!dataUrl) {
    done?.()
    return
  }
  const image = new Image()
  image.onload = () => {
    ctx.imageSmoothingEnabled = false
    ctx.clearRect(0, 0, width, height)
    ctx.drawImage(image, 0, 0, width, height)
    done?.()
  }
  image.onerror = () => done?.()
  image.src = dataUrl
}

function canvasBlank(canvas) {
  if (!canvas) return true
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] !== 0) return false
  }
  return true
}

export default function SkinTab({ theme, lang, accounts, activeAccountId, heads = {}, notify, onChanged, visible = true, onClose }) {
  const c = palette(theme)
  const offline = useMemo(() => (accounts || []).filter((account) => account.type === 'offline'), [accounts])
  const [selectedId, setSelectedId] = useState('')
  const selected = offline.find((account) => account.id === selectedId) || offline[0] || null
  const active = selected && selected.id === activeAccountId

  const [asset, setAsset] = useState('skin')
  const [mode, setMode] = useState('draw')
  const [model, setModel] = useState('classic')
  const [paintLayer, setPaintLayer] = useState('inner')
  const [outerVisible, setOuterVisible] = useState(true)
  const [modelGrid, setModelGrid] = useState(false)
  const [hiddenParts, setHiddenParts] = useState([])
  const [toolsOpen, setToolsOpen] = useState(true)
  const [colorsOpen, setColorsOpen] = useState(true)
  const [settingsMenu, setSettingsMenu] = useState(false)
  const [settingsPos, setSettingsPos] = useState(null)
  const [touched, setTouched] = useState({ skin: false, cape: false })
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [resetting, setResetting] = useState(false)
  const [error, setError] = useState('')
  const [flash, setFlash] = useState('')
  const [resetAsk, setResetAsk] = useState(false)
  const [tool, setTool] = useState('pencil')
  const [color, setColor] = useState('#ffffff')
  const [alpha, setAlpha] = useState(255)
  const [recent, setRecent] = useState([])
  const [textureVersion, setTextureVersion] = useState(0)
  const [mirrorMode, setMirrorMode] = useState('off')
  const [brushSize, setBrushSize] = useState(1)
  const [brushSoft, setBrushSoft] = useState(false)
  const [, setHistoryVersion] = useState(0)

  const skinCanvasRef = useRef(null)
  const capeCanvasRef = useRef(null)
  const settingsTriggerRef = useRef(null)
  const skinFileRef = useRef(null)
  const capeFileRef = useRef(null)
  const historyRef = useRef({ skin: [], cape: [], redo: { skin: [], cape: [] } })

  const canvasFor = useCallback((key) => (key === 'cape' ? capeCanvasRef.current : skinCanvasRef.current), [])

  useEffect(() => {
    if (!selectedId && offline[0]) setSelectedId(offline[0].id)
    if (selectedId && !offline.some((account) => account.id === selectedId)) setSelectedId(offline[0]?.id || '')
  }, [offline, selectedId])

  useEffect(() => {
    skinCanvasRef.current?.getContext('2d', { willReadFrequently: true })
    capeCanvasRef.current?.getContext('2d', { willReadFrequently: true })
  }, [])

  useEffect(() => {
    if (!selected) return undefined
    let cancelled = false
    setLoading(true)
    setError('')
    setFlash('')
    api.skinRead({ uuid: selected.uuid }).then((res) => {
      if (cancelled) return
      const data = res?.ok ? res : {}
      setModel(data.model === 'slim' ? 'slim' : 'classic')
      setTouched({ skin: false, cape: false })
      historyRef.current = { skin: [], cape: [], redo: { skin: [], cape: [] } }
      setHistoryVersion((value) => value + 1)
      setError(res?.ok === false ? res.error || '' : '')
      paintImage(skinCanvasRef.current, data.skin, 64, 64, () => setTextureVersion((value) => value + 1))
      paintImage(capeCanvasRef.current, data.cape, 64, 32, () => setTextureVersion((value) => value + 1))
    }).catch((err) => {
      if (!cancelled) setError(err.message || String(err))
    }).finally(() => {
      if (!cancelled) setLoading(false)
    })
  return () => {
      cancelled = true
    }
  }, [selected?.uuid])

  useEffect(() => {
    if (!flash) return undefined
    const timer = setTimeout(() => setFlash(''), 2600)
    return () => clearTimeout(timer)
  }, [flash])

  useEffect(() => {
    if (!visible) return undefined
    const onKey = (event) => {
      if (!(event.ctrlKey || event.metaKey)) return
      if (event.key.toLowerCase() === 'z') {
        event.preventDefault()
        if (event.shiftKey) redo()
        else undo()
      } else if (event.key.toLowerCase() === 'y') {
        event.preventDefault()
        redo()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const pushHistoryFor = useCallback((key) => {
    const canvas = canvasFor(key)
    if (!canvas) return
    const stack = historyRef.current[key]
    stack.push(canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, canvas.width, canvas.height))
    if (stack.length > 40) stack.shift()
    historyRef.current.redo[key] = []
    setHistoryVersion((value) => value + 1)
  }, [canvasFor])

  const markEdited = useCallback((key) => {
    setTouched((value) => ({ ...value, [key]: true }))
    setTextureVersion((value) => value + 1)
  }, [])

  const undo = useCallback(() => {
    const canvas = canvasFor(asset)
    if (!canvas) return
    const stack = historyRef.current[asset]
    if (!stack.length) return
    historyRef.current.redo[asset].push(canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, canvas.width, canvas.height))
    canvas.getContext('2d', { willReadFrequently: true }).putImageData(stack.pop(), 0, 0)
    setHistoryVersion((value) => value + 1)
    markEdited(asset)
  }, [asset, canvasFor, markEdited])

  const redo = useCallback(() => {
    const canvas = canvasFor(asset)
    if (!canvas) return
    const redoStack = historyRef.current.redo[asset]
    if (!redoStack.length) return
    const stack = historyRef.current[asset]
    stack.push(canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, canvas.width, canvas.height))
    canvas.getContext('2d', { willReadFrequently: true }).putImageData(redoStack.pop(), 0, 0)
    setHistoryVersion((value) => value + 1)
    markEdited(asset)
  }, [asset, canvasFor, markEdited])

  const addRecent = useCallback((value) => {
    const pixel = value.replace('#', '')
    const hex = `#${pixel.toLowerCase()}`
    setRecent((list) => [hex, ...list.filter((item) => item !== hex)].slice(0, 10))
  }, [])

  const handleStrokeStart = useCallback((key) => {
    pushHistoryFor(key)
  }, [pushHistoryFor])

  const handleStrokeEnd = useCallback((key) => {
    setTouched((value) => ({ ...value, [key]: true }))
    if (tool !== 'eraser') addRecent(color)
    setTextureVersion((value) => value + 1)
  }, [addRecent, color, tool])

  const handlePick = useCallback((hex, value) => {
    setColor(hex)
    setAlpha(value)
    setTool('pencil')
    addRecent(hex)
  }, [addRecent])

  const selectAsset = useCallback((next) => {
    setAsset(next)
    setMode('draw')
    if (next === 'cape') setHiddenParts((list) => list.filter((key) => key !== 'cape'))
  }, [])

  const togglePart = useCallback((key) => {
    setHiddenParts((list) => (list.includes(key) ? list.filter((item) => item !== key) : [...list, key]))
  }, [])

  const toggleOuter = useCallback(() => {
    setOuterVisible((value) => !value)
    if (outerVisible && paintLayer === 'outer') setPaintLayer('inner')
  }, [outerVisible, paintLayer])

  const openSettings = useCallback(() => {
    if (settingsMenu) {
      setSettingsMenu(false)
      return
    }
    const rect = settingsTriggerRef.current?.getBoundingClientRect()
    if (!rect) return
    const width = 300
    const left = Math.min(Math.max(8, rect.right - width), window.innerWidth - width - 8)
    setSettingsPos({ left, bottom: window.innerHeight - rect.top + 8 })
    setSettingsMenu(true)
  }, [settingsMenu])

  useEffect(() => {
    if (!settingsMenu) return undefined
    const close = () => setSettingsMenu(false)
    const onKey = (event) => { if (event.key === 'Escape') close() }
    window.addEventListener('resize', close)
    window.addEventListener('scroll', close, true)
    document.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('resize', close)
      window.removeEventListener('scroll', close, true)
      document.removeEventListener('keydown', onKey)
    }
  }, [settingsMenu])

  const upload = (file, target) => {
    if (!file) return
    if (!/^image\/png$/i.test(file.type)) {
      setError(t(lang, target === 'skin' ? 'accounts.skin.invalidSkin' : 'accounts.skin.invalidCape'))
      return
    }
    const reader = new FileReader()
    reader.onload = () => {
      const image = new Image()
      image.onload = () => {
        const expected = target === 'skin' ? [64, 64] : [64, 32]
        if (image.width !== expected[0] || image.height !== expected[1]) {
          setError(t(lang, target === 'skin' ? 'accounts.skin.invalidSkin' : 'accounts.skin.invalidCape'))
          return
        }
        const canvas = canvasFor(target)
        if (!canvas) return
        const ctx = canvas.getContext('2d', { willReadFrequently: true })
        pushHistoryFor(target)
        ctx.clearRect(0, 0, canvas.width, canvas.height)
        ctx.imageSmoothingEnabled = false
        ctx.drawImage(image, 0, 0, canvas.width, canvas.height)
        setTouched((value) => ({ ...value, [target]: true }))
        selectAsset(target)
        setError('')
        setFlash(t(lang, 'accounts.skin.uploaded'))
        setTextureVersion((value) => value + 1)
      }
      image.src = String(reader.result || '')
    }
    reader.readAsDataURL(file)
  }

  const save = async () => {
    if (!selected || saving) return
    setSaving(true)
    setError('')
    try {
      const skin = canvasBlank(skinCanvasRef.current) ? null : skinCanvasRef.current.toDataURL('image/png')
      const cape = canvasBlank(capeCanvasRef.current) ? null : capeCanvasRef.current.toDataURL('image/png')
      const res = await api.skinSave({ uuid: selected.uuid, name: selected.name, model, skin, cape })
      if (!res?.ok) throw new Error(res?.error || 'save failed')
      setTouched({ skin: false, cape: false })
      setFlash(t(lang, 'accounts.skin.saved').replace('{name}', selected.name))
      notify?.(t(lang, 'accounts.skin.saved').replace('{name}', selected.name))
      onChanged?.()
      setTextureVersion((value) => value + 1)
    } catch (err) {
      setError(err.message || String(err))
    } finally {
      setSaving(false)
    }
  }

  const reset = async () => {
    if (!selected || resetting) return
    setResetAsk(false)
    setResetting(true)
    setError('')
    const res = await api.skinRemove({ uuid: selected.uuid })
    if (!res?.ok) {
      setError(res?.error || 'reset failed')
      setResetting(false)
      return
    }
    paintImage(skinCanvasRef.current, null, 64, 64)
    paintImage(capeCanvasRef.current, null, 64, 32)
    setModel('classic')
    setTouched({ skin: false, cape: false })
    historyRef.current = { skin: [], cape: [], redo: { skin: [], cape: [] } }
    setHistoryVersion((value) => value + 1)
    setFlash(t(lang, 'accounts.skin.resetDone'))
    onChanged?.()
    setTextureVersion((value) => value + 1)
    setResetting(false)
  }

  const canUndo = historyRef.current[asset].length > 0
  const canRedo = historyRef.current.redo[asset].length > 0
  const dirty = touched.skin || touched.cape

  if (!offline.length) {
    return (
      <div className="flex-1 min-h-0 flex items-center justify-center px-6">
        <div className="text-center max-w-sm">
          <User size={30} weight="duotone" className="mx-auto mb-3" style={{ color: c.faint }} />
          <p className="text-sm font-semibold" style={{ color: c.text }}>{t(lang, 'accounts.skin.noOffline')}</p>
          <p className="text-[11px] mt-1" style={{ color: c.label }}>{t(lang, 'accounts.skin.noOfflineHint')}</p>
        </div>
      </div>
    )
  }

  const toolButton = (id, Icon, label) => {
    const activeTool = tool === id
    return (
      <button
        key={id}
        type="button"
        data-tip={label}
        onClick={() => setTool(id)}
        className="h-8 w-8 rounded-md flex items-center justify-center"
        style={{ background: activeTool ? c.accent : c.input, color: activeTool ? c.ink : c.label, border: `1px solid ${activeTool ? c.accent : c.border}` }}
      >
        <Icon size={15} weight="duotone" />
      </button>
    )
  }

      const layerNode = (
    <>
{asset === 'skin' && (
          <div className="mb-4">
            <span className="block text-[10px] font-bold uppercase tracking-wide mb-1.5" style={{ color: c.faint }}>{t(lang, 'accounts.skin.layer')}</span>
            <div className="grid grid-cols-2 gap-2">
              {['inner', 'outer'].map((item) => (
                <button
                  key={item}
                  type="button"
                  onClick={() => { setPaintLayer(item); if (item === 'outer') setOuterVisible(true) }}
                  className="h-8 rounded-lg text-[10px] font-semibold"
                  style={{ background: paintLayer === item ? c.accent : c.input, color: paintLayer === item ? c.ink : c.label, border: `1px solid ${paintLayer === item ? c.accent : c.border}` }}
                >
                  {t(lang, item === 'inner' ? 'accounts.skin.layer.inner' : 'accounts.skin.layer.outer')}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={toggleOuter}
              className="mt-2 w-full h-8 px-2.5 rounded-lg flex items-center justify-between text-[10px] font-semibold"
              style={{ background: c.input, color: c.label, border: `1px solid ${c.border}` }}
            >
              <span className="flex items-center gap-1.5">
                {outerVisible ? <Eye size={13} style={{ color: c.accent }} /> : <EyeSlash size={13} />}
                {t(lang, 'accounts.skin.layer.show')}
              </span>
              <span className="relative w-7 h-4 rounded-full shrink-0" style={{ background: outerVisible ? c.accent : c.surface, border: `1px solid ${outerVisible ? c.accent : c.border}` }}>
                <span className="absolute top-[1px] w-3 h-3 rounded-full transition-all duration-150" style={{ left: outerVisible ? 'calc(100% - 13px)' : '1px', background: outerVisible ? c.ink : c.faint }} />
              </span>
            </button>
          </div>
        )}

            </>
  )

  const partsNode = (
    <>
{asset === 'skin' && (
          <div className="mb-4">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[10px] font-bold uppercase tracking-wide" style={{ color: c.faint }}>{t(lang, 'accounts.skin.parts')}</span>
              <button type="button" onClick={() => setHiddenParts([])} className="text-[9px] font-semibold" style={{ color: c.accent }}>{t(lang, 'accounts.skin.partsAll')}</button>
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              {PARTS.map(([key, label]) => {
                const hidden = hiddenParts.includes(key)
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => togglePart(key)}
                    className="h-7 px-2 rounded-md text-[9px] font-semibold flex items-center justify-between gap-1"
                    style={{ background: hidden ? c.input : c.surface, color: hidden ? c.faint : c.text, border: `1px solid ${c.border}` }}
                  >
                    <span className="truncate">{t(lang, label)}</span>
                    {hidden ? <EyeSlash size={11} /> : <Eye size={11} style={{ color: c.accent }} />}
                  </button>
                )
              })}
            </div>
          </div>
        )}

    </>
  )

  const settingsNode = (
    <>
        <div className="text-[10px] font-bold uppercase tracking-wide mb-2" style={{ color: c.faint }}>{t(lang, 'accounts.skin.selectAccount')}</div>
        <div className="rounded-xl overflow-hidden mb-4" style={{ border: `1px solid ${c.border}`, background: c.surface }}>
          {offline.map((account, index) => {
            const on = account.id === selected?.id
            return (
              <button
                key={account.id}
                type="button"
                onClick={() => setSelectedId(account.id)}
                className="w-full flex items-center gap-2.5 px-3 py-2.5 text-left"
                style={{ borderTop: index === 0 ? 'none' : `1px solid ${c.border}`, background: on ? c.input : 'transparent' }}
              >
                <HeadSkin name={account.name} uuid={account.uuid} type={account.type} size={30} radius={7} theme={theme} customSkin={heads[account.uuid] || ''} />
                <span className="min-w-0 flex-1">
                  <span className="block text-[11px] font-semibold truncate" style={{ color: c.text }}>{account.name}</span>
                  <span className="block text-[9px] font-mono truncate" style={{ color: c.faint }}>{account.uuid}</span>
                </span>
                {account.id === activeAccountId && <Check size={13} weight="bold" style={{ color: c.accent }} />}
              </button>
            )
          })}
        </div>

        {selected && !active && (
          <div className="flex items-start gap-2 px-2.5 py-2 rounded-lg text-[10px] mb-3" style={{ background: c.input, color: c.label, border: `1px solid ${c.border}` }}>
            <Info size={12} weight="duotone" style={{ color: c.accent, marginTop: 1 }} />
            <span>{t(lang, 'accounts.skin.notActive')}</span>
          </div>
        )}

        <div className="flex flex-col gap-2">
          <button
            type="button"
            onClick={save}
            disabled={!selected || saving || loading}
            className="h-9 rounded-lg text-[11px] font-bold flex items-center justify-center gap-2 disabled:opacity-40"
            style={{ background: c.accent, color: c.ink }}
          >
            <FloppyDisk size={14} weight="duotone" />
            {saving ? t(lang, 'accounts.skin.saving') : t(lang, 'accounts.skin.save')}
          </button>
          <button
            type="button"
            onClick={() => setResetAsk(true)}
            disabled={!selected || loading || resetting}
            className="h-9 rounded-lg text-[11px] font-semibold flex items-center justify-center gap-2 disabled:opacity-40"
            style={{ background: 'transparent', color: '#f87171', border: `1px solid ${c.border}` }}
          >
            <Trash size={14} />
            {t(lang, 'accounts.skin.reset')}
          </button>
        </div>

        {flash && <div className="mt-3 text-[10px] flex items-center gap-1.5" style={{ color: '#4ade80' }}><Check size={12} weight="bold" />{flash}</div>}
        {error && <div className="mt-2 text-[10px] flex items-start gap-1.5" style={{ color: '#f87171' }}><Warning size={12} weight="duotone" style={{ marginTop: 1 }} />{error}</div>}
        {loading && <div className="mt-3 text-[10px]" style={{ color: c.label }}>{t(lang, 'accounts.skin.loading')}</div>}
        {dirty && !loading && <div className="mt-2 text-[10px]" style={{ color: c.faint }}>{t(lang, 'accounts.skin.edited')}</div>}
        <div className="mt-4 pt-3 text-[9px] leading-relaxed" style={{ borderTop: `1px solid ${c.border}`, color: c.faint }}>
          {t(lang, 'accounts.skin.applyNote')}
        </div>

    </>
  )

  const assetTabsNode = (
            <div className="flex items-center gap-1.5 mb-3 flex-wrap">
              {['skin', 'cape'].map((item) => (
                <button
                  key={item}
                  type="button"
                  onClick={() => selectAsset(item)}
                  className="h-8 px-3 rounded-lg text-[11px] font-semibold flex items-center gap-1.5"
                  style={{ background: asset === item ? c.accent : c.input, color: asset === item ? c.ink : c.label, border: `1px solid ${asset === item ? c.accent : c.border}` }}
                >
                  <ImageSquare size={13} weight="duotone" />
                  {t(lang, item === 'skin' ? 'accounts.skin.asset.skin' : 'accounts.skin.asset.cape')}
                </button>
              ))}
              {asset === 'cape' && <span className="text-[10px] ml-auto" style={{ color: c.label }}>{t(lang, 'accounts.skin.capeNote')}</span>}
            </div>


  )

  const toolbarNode = (
            <div className="flex items-center gap-1.5">
              {toolButton('pencil', PencilSimple, t(lang, 'accounts.skin.tool.pencil'))}
              {toolButton('eraser', Eraser, t(lang, 'accounts.skin.tool.eraser'))}
              {toolButton('fill', PaintBucket, t(lang, 'accounts.skin.tool.fill'))}
              {toolButton('picker', Eyedropper, t(lang, 'accounts.skin.tool.picker'))}
              {toolButton('rotate', Hand, t(lang, 'accounts.skin.tool.rotate'))}
              {toolButton('pan', ArrowsOutCardinal, t(lang, 'accounts.skin.tool.pan'))}
              <div style={{ width: 78 }}>
                <Select
                  theme={theme}
                  value={brushSize}
                  onChange={(value) => setBrushSize(Number(value))}
                  options={[1, 2, 3, 4, 5, 6, 8].map((value) => ({ value, label: `${value} px` }))}
                />
              </div>
              <button type="button" data-tip={t(lang, 'accounts.skin.brush.mode')} onClick={() => setBrushSoft((value) => !value)} className="h-8 px-2 rounded-md text-[10px] font-semibold flex items-center gap-1.5" style={{ background: brushSoft ? c.accent : c.input, color: brushSoft ? c.ink : c.label, border: `1px solid ${brushSoft ? c.accent : c.border}` }}>
                <Drop size={14} weight="duotone" />
                {t(lang, brushSoft ? 'accounts.skin.brush.soft' : 'accounts.skin.brush.pixel')}
              </button>
              <span className="w-px h-6 mx-1" style={{ background: c.border }} />
              <button type="button" data-tip={t(lang, 'accounts.skin.undo')} onClick={undo} disabled={!canUndo} className="h-8 w-8 rounded-md flex items-center justify-center disabled:opacity-30" style={{ background: c.input, color: c.label, border: `1px solid ${c.border}` }}><ArrowCounterClockwise size={15} /></button>
              <button type="button" data-tip={t(lang, 'accounts.skin.redo')} onClick={redo} disabled={!canRedo} className="h-8 w-8 rounded-md flex items-center justify-center disabled:opacity-30" style={{ background: c.input, color: c.label, border: `1px solid ${c.border}` }}><ArrowClockwise size={15} /></button>
              <div style={{ width: 142 }}>
                <Select
                  theme={theme}
                  value={mirrorMode}
                  onChange={setMirrorMode}
                  panelWidth={190}
                  options={['off', 'x', 'y', 'z'].map((value) => ({
                    value,
                    label: t(lang, `accounts.skin.mirror.${value}`),
                    node: <FlipHorizontal size={13} weight={value === 'off' ? 'regular' : 'bold'} style={{ color: value === 'off' ? c.label : c.accent }} />,
                  }))}
                />
              </div>
              <button type="button" data-tip={t(lang, 'accounts.skin.modelGrid')} onClick={() => setModelGrid((value) => !value)} className="h-8 w-8 rounded-md flex items-center justify-center" style={{ background: modelGrid ? c.accent : c.input, color: modelGrid ? c.ink : c.label, border: `1px solid ${modelGrid ? c.accent : c.border}` }}><GridFour size={15} /></button>
              <button type="button" onClick={() => { pushHistoryFor(asset); const canvas = canvasFor(asset); if (canvas) canvas.getContext('2d', { willReadFrequently: true }).clearRect(0, 0, canvas.width, canvas.height); markEdited(asset) }} className="h-8 px-2.5 rounded-md text-[10px] whitespace-nowrap" style={{ background: c.input, color: c.label, border: `1px solid ${c.border}` }}>{t(lang, 'accounts.skin.clear')}</button>
            </div>


  )

  const uploadNode = (

          <div className="grid md:grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => skinFileRef.current?.click()}
              className="rounded-xl p-5 text-left min-h-[150px] flex flex-col justify-between"
              style={{ background: c.surface, border: `1px dashed ${c.border}`, color: c.text }}
            >
              <UploadSimple size={24} weight="duotone" style={{ color: c.accent }} />
              <span>
                <span className="block text-sm font-bold">{t(lang, 'accounts.skin.uploadSkin')}</span>
                <span className="block text-[10px] mt-1" style={{ color: c.label }}>{t(lang, 'accounts.skin.uploadHint')}</span>
              </span>
            </button>
            <button
              type="button"
              onClick={() => capeFileRef.current?.click()}
              className="rounded-xl p-5 text-left min-h-[150px] flex flex-col justify-between"
              style={{ background: c.surface, border: `1px dashed ${c.border}`, color: c.text }}
            >
              <UploadSimple size={24} weight="duotone" style={{ color: c.accent }} />
              <span>
                <span className="block text-sm font-bold">{t(lang, 'accounts.skin.uploadCape')}</span>
                <span className="block text-[10px] mt-1" style={{ color: c.label }}>{t(lang, 'accounts.skin.uploadHint')}</span>
              </span>
            </button>
          </div>

  )

  const colorPanelNode = (
              <ColorPanel
                theme={theme}
                lang={lang}
                color={color}
                alpha={alpha}
                recent={recent}
                onChange={(hex, value) => {
                  setColor(hex)
                  setAlpha(value)
                  if (tool === 'rotate') setTool('pencil')
                }}
                onCommit={(hex) => addRecent(hex)}
              />
  )

    return (
      <div className="flex-1 min-h-0 flex flex-col overflow-hidden" style={{ background: c.bg }}>
        <div className="shrink-0 flex items-center gap-2 pl-8 pr-3 py-2 flex-wrap" style={{ borderBottom: `1px solid ${c.border}`, background: c.surface }}>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-bold truncate" style={{ color: c.text }}>{selected?.name || '—'}</div>
            <div className="text-[10px]" style={{ color: c.label }}>{t(lang, 'accounts.skin.subtitle')}</div>
          </div>
          <div className="flex gap-0.5 p-0.5 rounded-lg" style={{ background: c.input, border: `1px solid ${c.border}` }}>
            {['draw', 'upload'].map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => setMode(item)}
                className="h-7 px-2.5 rounded-md text-[10px] font-semibold"
                style={{ background: mode === item ? c.accent : 'transparent', color: mode === item ? c.ink : c.label }}
              >
                {t(lang, item === 'draw' ? 'accounts.skin.mode.draw' : 'accounts.skin.mode.upload')}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => onClose?.()}
            className="h-8 px-2.5 rounded-lg text-[10px] font-semibold flex items-center gap-1.5"
            style={{ background: c.input, color: c.text, border: `1px solid ${c.border}` }}
          >
            <CornersIn size={14} />
            {t(lang, 'accounts.skin.backToList')}
          </button>
        </div>

        <div className="flex-1 min-h-0 p-3 flex flex-col gap-2">
          {mode === 'upload' ? (
            <div className="h-full overflow-y-auto">{uploadNode}</div>
          ) : (
            <>
              <div className="flex-1 min-h-0 relative">
              <SkinViewer3D
                fill
                wide
                theme={theme}
                lang={lang}
                skinCanvasRef={skinCanvasRef}
                capeCanvasRef={capeCanvasRef}
                model={model}
                asset={asset}
                paintLayer={paintLayer}
                outerVisible={outerVisible}
                hiddenParts={hiddenParts}
                showGrid={modelGrid}
                tool={tool}
                color={color}
                alpha={alpha}
                mirrorMode={mirrorMode}
                brushSize={brushSize}
                brushSoft={brushSoft}
                loupeRight={colorsOpen ? 238 : 12}
                gizmoLeft={toolsOpen ? 306 : 12}
                version={textureVersion}
                onStrokeStart={handleStrokeStart}
                onStrokeEnd={handleStrokeEnd}
                onPick={handlePick}
              />

              {toolsOpen ? (
                <div
                  className="absolute left-2 top-2 bottom-2 w-[286px] z-20 rounded-xl flex flex-col overflow-hidden"
                  style={{ background: c.bg, border: `1px solid ${c.border}`, boxShadow: '0 18px 48px rgba(0,0,0,0.32)' }}
                >
                  <div className="shrink-0 h-9 px-3 flex items-center justify-between" style={{ borderBottom: `1px solid ${c.border}`, background: c.surface }}>
                    <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide" style={{ color: c.label }}>
                      <SlidersHorizontal size={13} />
                      {t(lang, 'accounts.skin.tools')}
                    </span>
                    <button type="button" data-tip={t(lang, 'accounts.skin.panel.hideTools')} onClick={() => setToolsOpen(false)} className="w-6 h-6 rounded-md flex items-center justify-center" style={{ color: c.label }}>
                      <CaretLeft size={13} weight="bold" />
                    </button>
                  </div>
                  <div className="flex-1 min-h-0 overflow-y-auto p-3">
                    {assetTabsNode}
                    {settingsNode}
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  data-tip={t(lang, 'accounts.skin.panel.showTools')}
                  onClick={() => setToolsOpen(true)}
                  className="absolute left-2 top-2 z-20 h-9 px-2.5 rounded-lg flex items-center gap-1.5 text-[10px] font-semibold"
                  style={{ background: c.surface, color: c.text, border: `1px solid ${c.border}`, boxShadow: '0 10px 28px rgba(0,0,0,0.25)' }}
                >
                  <SlidersHorizontal size={14} />
                  {t(lang, 'accounts.skin.tools')}
                </button>
              )}

              {colorsOpen ? (
                <div className="absolute right-2 top-2 bottom-2 w-[218px] z-20 flex flex-col">
                  <div className="flex-1 min-h-0 overflow-y-auto">
                    {colorPanelNode}
                  </div>
                  <button
                    type="button"
                    data-tip={t(lang, 'accounts.skin.panel.hideColors')}
                    onClick={() => setColorsOpen(false)}
                    className="absolute top-2 right-2 z-30 w-7 h-7 rounded-md flex items-center justify-center"
                    style={{ background: c.surface, border: `1px solid ${c.border}`, color: c.label }}
                  >
                    <CaretRight size={13} weight="bold" />
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  data-tip={t(lang, 'accounts.skin.panel.showColors')}
                  onClick={() => setColorsOpen(true)}
                  className="absolute right-2 top-2 z-20 h-9 px-2.5 rounded-lg flex items-center gap-1.5 text-[10px] font-semibold"
                  style={{ background: c.surface, color: c.text, border: `1px solid ${c.border}`, boxShadow: '0 10px 28px rgba(0,0,0,0.25)' }}
                >
                  <Palette size={14} />
                  {t(lang, 'accounts.skin.colors')}
                </button>
              )}

              </div>

              <div
                className="shrink-0 flex justify-center overflow-x-auto rounded-xl p-1.5"
                style={{ background: c.surface, border: `1px solid ${c.border}` }}
              >
                <div className="flex items-center gap-2">
                  {toolbarNode}
                  <span className="w-px h-6 mx-1" style={{ background: c.border }} />
                  <button
                    ref={settingsTriggerRef}
                    type="button"
                    onClick={openSettings}
                    className="h-8 px-2.5 rounded-md text-[10px] font-semibold flex items-center gap-1.5 whitespace-nowrap"
                    style={{ background: settingsMenu ? c.accent : c.input, color: settingsMenu ? c.ink : c.label, border: `1px solid ${settingsMenu ? c.accent : c.border}` }}
                  >
                    <SlidersHorizontal size={14} />
                    {t(lang, 'accounts.skin.settings')}
                  </button>
                </div>
              </div>
            </>
          )}
        </div>

        {settingsMenu && settingsPos && createPortal(
          <>
            <div className="fixed inset-0" style={{ zIndex: 9998 }} onClick={() => setSettingsMenu(false)} />
            <div
              className="fixed overflow-y-auto rounded-xl p-3 flex flex-col gap-3"
              style={{ left: settingsPos.left, bottom: settingsPos.bottom, width: 300, maxHeight: '70vh', zIndex: 9999, background: c.surface, border: `1px solid ${c.border}`, boxShadow: '0 16px 40px rgba(0,0,0,0.45)' }}
            >
              <div>
                <span className="block text-[10px] font-bold uppercase tracking-wide mb-1.5" style={{ color: c.faint }}>{t(lang, 'accounts.skin.model')}</span>
                <div className="grid grid-cols-2 gap-2">
                  {['classic', 'slim'].map((item) => (
                    <button
                      key={item}
                      type="button"
                      onClick={() => setModel(item)}
                      className="h-8 rounded-lg text-[10px] font-semibold"
                      style={{ background: model === item ? c.accent : c.input, color: model === item ? c.ink : c.label, border: `1px solid ${model === item ? c.accent : c.border}` }}
                    >
                      {t(lang, item === 'classic' ? 'accounts.skin.model.classic' : 'accounts.skin.model.slim')}
                    </button>
                  ))}
                </div>
              </div>
              {layerNode}
              {partsNode}
            </div>
          </>,
          document.body,
        )}

        <input ref={skinFileRef} type="file" accept="image/png" style={{ display: 'none' }} onChange={(event) => { upload(event.target.files?.[0], 'skin'); event.target.value = '' }} />
        <input ref={capeFileRef} type="file" accept="image/png" style={{ display: 'none' }} onChange={(event) => { upload(event.target.files?.[0], 'cape'); event.target.value = '' }} />

        <div style={{ display: 'none' }}>
          <canvas ref={skinCanvasRef} width={64} height={64} />
          <canvas ref={capeCanvasRef} width={64} height={32} />
        </div>

        <ConfirmModal
          theme={theme}
          lang={lang}
          open={resetAsk}
          title={t(lang, 'accounts.skin.reset')}
          message={t(lang, 'accounts.skin.resetAsk')}
          confirmLabel={t(lang, 'accounts.skin.resetYes')}
          cancelLabel={t(lang, 'accounts.skin.cancel')}
          busy={resetting}
          onCancel={() => setResetAsk(false)}
          onConfirm={reset}
        />
      </div>
    )
  }
