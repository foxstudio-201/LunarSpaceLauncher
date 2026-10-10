import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  MapTrifold, Globe, Flame, Star, Mountains, Sparkle, DownloadSimple, FolderOpen, SidebarSimple,
  ArrowsClockwise, ArrowsOut, ArrowsIn, CursorClick, WarningCircle, CheckCircle, X, Cube, Trash,
} from '@phosphor-icons/react'
import { palette } from '../../lib/palette'
import { formatBytes } from '../../lib/status'
import * as api from '../../api/client.js'
import { Drop, Field, Btn, Toggle, Grid, Note, Empty, Section } from './nbt/kit'

const vn = (lang, vi, en) => (lang === 'vi' ? vi : en)

const DIMS = [
  { key: 'overworld', label: 'Thế giới thường', labelEn: 'Overworld', icon: Globe },
  { key: 'nether', label: 'Nether', labelEn: 'Nether', icon: Flame },
  { key: 'end', label: 'The End', labelEn: 'The End', icon: Star },
]

const STYLES = [
  { value: 'xaero', label: 'Xaero (màu theo texture)', labelEn: 'Xaero (texture colours)' },
  { value: 'table', label: 'Bảng màu đơn giản', labelEn: 'Simple colour table' },
]

const SCALES = [
  { value: '0', label: 'Tự động' },
  { value: '1', label: '1 px = 1 block' },
  { value: '2', label: '1 px = 2 block' },
  { value: '4', label: '1 px = 4 block' },
  { value: '8', label: '1 px = 8 block' },
  { value: '16', label: '1 px = 16 block' },
]

export default function MapPage({ instance, theme, lang }) {
  const c = palette(theme)
  const [worlds, setWorlds] = useState([])
  const [world, setWorld] = useState('')
  const [dims, setDims] = useState({})
  const [cachedList, setCachedList] = useState([])
  const [dimension, setDimension] = useState('overworld')
  const [scale, setScale] = useState('0')
  const [style, setStyle] = useState('xaero')
  const [shading, setShading] = useState(true)
  const [trim, setTrim] = useState(true)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState(null)
  const [result, setResult] = useState(null)
  const [note, setNote] = useState(null)
  const [loading, setLoading] = useState(true)
  const [zoom, setZoom] = useState(1)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const zoomRef = useRef(1)
  const offsetRef = useRef({ x: 0, y: 0 })
  const [pointer, setPointer] = useState(null)
  const [panelOpen, setPanelOpen] = useState(true)
  const drag = useRef(null)
  const token = useRef(0)
  const viewRef = useRef(null)

  const loadInfo = useCallback(async () => {
    setLoading(true)
    const res = await api.mapInfo({ id: instance.id }).catch((err) => ({ ok: false, error: err.message }))
    setLoading(false)
    if (!res?.ok) {
      setNote({ tone: 'bad', text: res?.error || 'error' })
      setWorlds([])
      return
    }
    setWorlds(res.worlds || [])
    setWorld(res.world || res.worlds?.[0]?.name || '')
    setDims(res.dims || {})
    setCachedList([])
    setResult(null)
  }, [instance.id])

  useEffect(() => { loadInfo() }, [loadInfo])

  const loadWorld = useCallback(async (name) => {
    if (!name) return
    const res = await api.mapWorldInfo({ id: instance.id, world: name }).catch((err) => ({ ok: false, error: err.message }))
    if (!res?.ok) {
      setDims({})
      setCachedList([])
      return
    }
    setDims(res.dims || {})
    setCachedList(res.cached || [])
  }, [instance.id])

  useEffect(() => {
    if (!world) return
    const local = worlds.find((item) => item.name === world)
    setResult(null)
    setCachedList(local?.cached || [])
    if (local?.dims && Object.keys(local.dims).length) setDims(local.dims)
    loadWorld(world)
  }, [world, worlds, loadWorld])

  useEffect(() => {
    const off = api.onLauncherEvent((ev) => {
      if (!ev || ev.type !== 'map' || !token.current || ev.token !== token.current) return
      if (ev.phase === 'progress' || ev.phase === 'done') {
        setProgress({ done: ev.done || 0, total: ev.total || 0, chunks: ev.chunks || 0 })
      }
      if (ev.phase === 'error') {
        token.current = 0
        setProgress(null)
      }
    })
    return off
  }, [])

  const wheelHandler = useRef(null)
  wheelHandler.current = (event) => {
    event.preventDefault()
    zoomAt(event.clientX, event.clientY, event.deltaY < 0 ? 1.15 : 0.87)
  }

  useEffect(() => {
    const node = viewRef.current
    if (!node) return undefined
    const handler = (event) => wheelHandler.current?.(event)
    node.addEventListener('wheel', handler, { passive: false })
    return () => node.removeEventListener('wheel', handler)
  }, [])

  useEffect(() => {
    if (!world || !cachedList.length) return
    const wanted = Number(scale) || 0
    const hit = cachedList.find((item) => item.dimension === dimension && item.trim === trim && (!wanted || item.scale === wanted))
    if (!hit) return
    setResult({
      ok: true,
      cached: true,
      file: `${hit.name}.png`,
      url: `lsmap://m/${hit.name}.png`,
      meta: { ...hit, bytes: hit.bytes || 0 },
    })
  }, [cachedList, dimension, trim, scale, world])

  useEffect(() => {
    setResult(null)
    setProgress(null)
    setNote(null)
    applyView(1, { x: 0, y: 0 })
    token.current = 0
  }, [instance.id])

  const centreZoom = (factor) => {
    const box = viewRef.current?.getBoundingClientRect()
    if (!box) return
    zoomAt(box.left + box.width / 2, box.top + box.height / 2, factor)
  }

  const dimensionInfo = dims[dimension] || null

  const run = async (fresh = false) => {
    if (!world || busy) return
    setBusy(true)
    setNote(null)
    setResult(null)
    setProgress({ done: 0, total: dims[dimension]?.regions || 0, chunks: 0 })
    const id = Date.now()
    token.current = id
    const res = await api.mapRender({
      id: instance.id,
      world,
      dimension,
      scale: Number(scale) || 0,
      shading,
      trim,
      fresh,
      style,
      token: id,
    }).catch((err) => ({ ok: false, error: err.message }))
    setBusy(false)
    token.current = 0
    setProgress(null)
    if (!res?.ok) {
      setNote({ tone: res?.canceled ? 'warn' : 'bad', text: res?.canceled ? vn(lang, 'Đã huỷ dựng bản đồ.', 'Render cancelled.') : res?.error || 'error' })
      return
    }
    setResult(res)
    applyView(1, { x: 0, y: 0 })
    setNote({
      tone: 'ok',
      text: res.cached
        ? vn(lang, 'Đã lấy bản đồ từ bộ đệm.', 'Loaded from cache.')
        : vn(lang, `Dựng xong ${res.meta.regions} vùng · ${res.meta.chunks} chunk · ${(res.meta.ms / 1000).toFixed(1)}s`, `Rendered ${res.meta.regions} regions · ${res.meta.chunks} chunks · ${(res.meta.ms / 1000).toFixed(1)}s`),
    })
  }

  const meta = result?.meta || null

  const applyView = (nextZoom, nextOffset) => {
    zoomRef.current = nextZoom
    offsetRef.current = nextOffset
    setZoom(nextZoom)
    setOffset(nextOffset)
  }

  const zoomAt = (clientX, clientY, factor) => {
    const box = viewRef.current?.getBoundingClientRect()
    if (!box) return
    const px = clientX - box.left
    const py = clientY - box.top
    const z0 = zoomRef.current
    const o0 = offsetRef.current
    const z1 = Math.max(0.08, Math.min(8, z0 * factor))
    applyView(z1, {
      x: px - ((px - o0.x) / z0) * z1,
      y: py - ((py - o0.y) / z0) * z1,
    })
  }

  const fitToView = () => {
    const box = viewRef.current?.getBoundingClientRect()
    const info = result?.meta
    if (!box || !info) return
    const next = Math.max(0.08, Math.min(4, Math.min((box.width - 32) / info.width, (box.height - 32) / info.height)))
    applyView(next, { x: (box.width - info.width * next) / 2, y: (box.height - info.height * next) / 2 })
  }

  const onPointerDown = (event) => {
    if (!result) return
    drag.current = { x: event.clientX - offsetRef.current.x, y: event.clientY - offsetRef.current.y }
    try {
      event.currentTarget.setPointerCapture?.(event.pointerId)
    } catch {}
  }
  const onPointerMove = (event) => {
    if (result && meta) {
      const box = event.currentTarget.getBoundingClientRect()
      const px = Math.round((event.clientX - box.left - offset.x) / zoom)
      const py = Math.round((event.clientY - box.top - offset.y) / zoom)
      if (px >= 0 && py >= 0 && px < meta.width && py < meta.height) {
        setPointer({ x: meta.originX + px * meta.scale, z: meta.originZ + py * meta.scale })
      } else {
        setPointer(null)
      }
    }
    if (!drag.current) return
    applyView(zoomRef.current, { x: event.clientX - drag.current.x, y: event.clientY - drag.current.y })
  }
  const onPointerUp = () => { drag.current = null }

  const save = async () => {
    if (!result?.file) return
    const res = await api.mapSave({ file: result.file.split(/[\\/]/).pop(), name: `${instance.name}-${world}-${dimension}` }).catch((err) => ({ ok: false, error: err.message }))
    if (res?.canceled) return
    setNote(res?.ok
      ? { tone: 'ok', text: vn(lang, `Đã lưu ảnh: ${res.path}`, `Saved: ${res.path}`) }
      : { tone: 'bad', text: res?.error || 'error' })
  }

  const dimLabel = DIMS.find((item) => item.key === dimension)

  return (
    <div data-surface className="h-full flex flex-col overflow-hidden" style={{ background: c.bg }}>
      <div className="shrink-0 flex items-center gap-3 px-5 h-14" style={{ borderBottom: `1px solid ${c.border}` }}>
        <MapTrifold size={18} weight="duotone" style={{ color: c.accent }} />
        <div className="min-w-0">
          <h1 className="text-[13.5px] font-bold" style={{ color: c.text }}>{vn(lang, 'Bản đồ thế giới', 'World map')}</h1>
          <p className="text-[11px] truncate" style={{ color: c.faint }}>
            {instance.name} · saves/ · {worlds.length} {vn(lang, 'thế giới', 'worlds')}
          </p>
        </div>
        <div className="flex-1" />
        {pointer ? (
          <span className="h-8 px-3 rounded-md text-[11.5px] font-mono inline-flex items-center gap-2" style={{ background: c.input, border: `1px solid ${c.border}`, color: c.text }}>
            <CursorClick size={13} weight="duotone" style={{ color: c.accent }} />
            X {pointer.x} · Z {pointer.z}
          </span>
        ) : null}
        <button
          onClick={loadInfo}
          title={vn(lang, 'Quét lại', 'Rescan')}
          className="w-9 h-9 rounded-lg flex items-center justify-center"
          style={{ background: c.input, border: `1px solid ${c.border}`, color: c.label }}
        >
          <ArrowsClockwise size={15} weight="bold" className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {note ? (
        <div className="shrink-0 px-5 py-2.5 flex items-center gap-2" style={{ borderBottom: `1px solid ${c.border}`, background: note.tone === 'ok' ? 'rgba(34,197,94,0.08)' : note.tone === 'warn' ? 'rgba(251,191,36,0.08)' : 'rgba(239,68,68,0.08)' }}>
          {note.tone === 'ok' ? <CheckCircle size={14} weight="fill" style={{ color: '#22c55e' }} /> : <WarningCircle size={14} weight="duotone" style={{ color: note.tone === 'warn' ? '#fbbf24' : '#f87171' }} />}
          <span className="text-[11.5px] truncate" style={{ color: note.tone === 'ok' ? '#22c55e' : note.tone === 'warn' ? '#fbbf24' : '#f87171' }}>{note.text}</span>
          <span className="flex-1" />
          <button onClick={() => setNote(null)} style={{ color: c.faint }}><X size={13} weight="bold" /></button>
        </div>
      ) : null}

      <div className="flex-1 min-h-0 flex relative">
        <button
          type="button"
          onClick={() => setPanelOpen((value) => !value)}
          aria-expanded={panelOpen}
          title={vn(lang, panelOpen ? 'Thu gọn bảng' : 'Mở bảng', panelOpen ? 'Collapse panel' : 'Show panel')}
          className="absolute top-3 z-40 w-6 h-6 rounded-md flex items-center justify-center transition-[left,background-color] duration-200 ease-out"
          style={{
            left: panelOpen ? 306 : 2,
            background: panelOpen ? c.input : c.bar,
            border: `1px solid ${c.border}`,
            color: panelOpen ? c.label : c.accent,
          }}
        >
          <SidebarSimple size={14} weight="duotone" className={`transition-transform duration-300 ${panelOpen ? '' : 'rotate-180'}`} />
        </button>
        <aside
          aria-hidden={!panelOpen}
          className="shrink-0 overflow-hidden transition-[width] duration-200 ease-out"
          style={{ width: panelOpen ? 318 : 0, borderRight: `1px solid ${panelOpen ? c.border : 'transparent'}`, background: c.bar }}
        >
        <div className="w-[318px] h-full overflow-y-auto px-3.5 pt-3.5 pb-8 flex flex-col gap-3 [&>*]:shrink-0">
          <Section c={c} title={vn(lang, 'Nguồn', 'Source')} icon={Cube}>
            <Field c={c} label={vn(lang, 'Thế giới', 'World')}>
              <Drop
                c={c}
                theme={theme}
                value={world}
                onChange={setWorld}
                disabled={!worlds.length}
                placeholder={vn(lang, 'Chưa có thế giới', 'No worlds')}
                options={worlds.map((item) => ({ value: item.name, label: item.name }))}
              />
            </Field>
            <Field c={c} label={vn(lang, 'Chiều không gian', 'Dimension')}>
              <Grid cols={3}>
                {DIMS.map((item) => {
                  const on = dimension === item.key
                  const info = dims[item.key]
                  return (
                    <button
                      key={item.key}
                      onClick={() => setDimension(item.key)}
                      disabled={!info}
                      title={info ? `${info.regions} vùng · ${info.blocks.minX},${info.blocks.minZ} → ${info.blocks.maxX},${info.blocks.maxZ}` : vn(lang, 'Không có dữ liệu', 'No data')}
                      className="h-[52px] rounded-md flex flex-col items-center justify-center gap-0.5 disabled:opacity-35"
                      style={{
                        background: on ? `${c.accent}1f` : c.surface,
                        border: `1px solid ${on ? `${c.accent}55` : c.border}`,
                        color: on ? c.accent : c.label,
                      }}
                    >
                      <item.icon size={16} weight="duotone" />
                      <span className="text-[10px] font-semibold">{lang === 'vi' ? item.label : item.labelEn}</span>
                      <span className="text-[9.5px] font-mono">{info ? info.regions : '—'}</span>
                    </button>
                  )
                })}
              </Grid>
            </Field>
            <Field
              c={c}
              label={vn(lang, 'Tỉ lệ', 'Resolution')}
              hint={dimensionInfo ? vn(lang, `Vùng: X ${dimensionInfo.blocks.minX}…${dimensionInfo.blocks.maxX} · Z ${dimensionInfo.blocks.minZ}…${dimensionInfo.blocks.maxZ} (tự động ≈ ${dimensionInfo.autoWidth}px)`, `Area: X ${dimensionInfo.blocks.minX}…${dimensionInfo.blocks.maxX} · Z ${dimensionInfo.blocks.minZ}…${dimensionInfo.blocks.maxZ} (auto ≈ ${dimensionInfo.autoWidth}px)`) : undefined}
            >
              <Drop
                c={c}
                theme={theme}
                value={scale}
                onChange={setScale}
                options={SCALES.map((item) => ({ value: item.value, label: item.label }))}
              />
            </Field>
            <Field c={c} label={vn(lang, 'Kiểu màu', 'Colour style')}>
              <Drop
                c={c}
                theme={theme}
                value={style}
                onChange={setStyle}
                options={STYLES.map((item) => ({ value: item.value, label: lang === 'vi' ? item.label : item.labelEn }))}
              />
            </Field>
            <Grid cols={2}>
              <Toggle c={c} on={shading} label={vn(lang, 'Đổ bóng địa hình', 'Terrain shading')} onClick={() => setShading((value) => !value)} />
              <Toggle c={c} on={trim} label={vn(lang, 'Chỉ vùng chính', 'Main area only')} onClick={() => setTrim((value) => !value)} title={vn(lang, 'Bỏ các chunk lẻ ở rìa', 'Ignore stray chunks at the edges')} />
            </Grid>
            <Btn
              c={c}
              wide
              tone="accent"
              icon={Mountains}
              disabled={!world || busy}
              onClick={() => run(false)}
            >
              {busy ? vn(lang, 'Đang dựng…', 'Rendering…') : result ? vn(lang, 'Dựng lại', 'Render again') : vn(lang, 'Dựng bản đồ', 'Render map')}
            </Btn>
            <Grid cols={2}>
              <Btn c={c} size="sm" icon={ArrowsClockwise} disabled={!world || busy} onClick={() => run(true)} title={vn(lang, 'Bỏ qua bộ đệm, dựng lại từ đầu', 'Ignore cache and rebuild')}>
                {vn(lang, 'Tạo mới', 'Rebuild')}
              </Btn>
              <Btn
                c={c}
                size="sm"
                tone="danger"
                icon={Trash}
                disabled={busy}
                onClick={async () => {
                  const res = await api.mapClear({ id: instance.id, world }).catch(() => null)
                  setResult(null)
                  setNote(res?.ok ? { tone: 'ok', text: vn(lang, `Đã xoá ${res.removed} tệp bộ đệm của thế giới này.`, `Removed ${res.removed} cached files for this world.`) } : { tone: 'bad', text: res?.error || 'error' })
                  if (world) loadWorld(world)
                }}
              >
                {vn(lang, 'Xoá bộ đệm', 'Clear cache')}
              </Btn>
            </Grid>
            {busy ? (
              <Btn c={c} wide size="sm" icon={X} tone="danger" onClick={() => api.mapCancel().catch(() => {})}>
                {vn(lang, 'Huỷ', 'Cancel')}
              </Btn>
            ) : null}
          </Section>

          {progress ? (
            <Section c={c} title={vn(lang, 'Tiến trình', 'Progress')} icon={Sparkle}>
              <div className="h-2 rounded-full overflow-hidden" style={{ background: c.surface }}>
                <div
                  className="h-2 rounded-full transition-[width] duration-200"
                  style={{ width: `${progress.total ? Math.round((progress.done / progress.total) * 100) : 4}%`, background: c.accent }}
                />
              </div>
              <Empty c={c}>
                {vn(lang, `${progress.done}/${progress.total} vùng · ${progress.chunks} chunk`, `${progress.done}/${progress.total} regions · ${progress.chunks} chunks`)}
              </Empty>
            </Section>
          ) : null}

          {meta ? (
            <Section c={c} title={vn(lang, 'Bản đồ hiện tại', 'Current map')} icon={MapTrifold}>
              <div className="flex flex-col gap-1 text-[11px] font-mono" style={{ color: c.label }}>
                <span>{vn(lang, 'Kích thước', 'Size')}: <span style={{ color: c.text }}>{meta.width}×{meta.height} px</span></span>
                <span>{vn(lang, 'Tỉ lệ', 'Scale')}: <span style={{ color: c.text }}>1 px = {meta.scale} block</span></span>
                <span>{vn(lang, 'Vùng', 'Regions')}: <span style={{ color: c.text }}>{meta.regions} · {meta.chunks} chunk</span></span>
                <span>{vn(lang, 'Tệp', 'File')}: <span style={{ color: c.text }}>{formatBytes(meta.bytes || 0)}</span></span>
                {meta.ms ? <span>{vn(lang, 'Thời gian', 'Time')}: <span style={{ color: c.text }}>{(meta.ms / 1000).toFixed(2)}s</span></span> : null}
                <span>{vn(lang, 'Bộ đệm', 'Cache')}: <span style={{ color: result?.cached ? '#4ade80' : c.text }}>{result?.cached ? vn(lang, 'có', 'hit') : vn(lang, 'mới dựng', 'fresh')}</span></span>
              </div>
              <Grid cols={2}>
                <Btn c={c} size="sm" icon={DownloadSimple} tone="ok" onClick={save}>{vn(lang, 'Lưu ảnh PNG', 'Save PNG')}</Btn>
                <Btn c={c} size="sm" icon={FolderOpen} onClick={() => api.mapReveal().catch(() => {})}>{vn(lang, 'Mở thư mục', 'Open folder')}</Btn>
              </Grid>
              <Grid cols={3}>
                <Btn c={c} size="sm" icon={ArrowsIn} onClick={() => centreZoom(1 / 1.25)}>{vn(lang, 'Nhỏ', 'Out')}</Btn>
                <Btn c={c} size="sm" icon={ArrowsOut} onClick={() => centreZoom(1.25)}>{vn(lang, 'Lớn', 'In')}</Btn>
                <Btn c={c} size="sm" onClick={fitToView}>{vn(lang, 'Vừa khung', 'Fit')}</Btn>
              </Grid>
              <Empty c={c}>{vn(lang, 'Kéo để di chuyển, lăn chuột để phóng to.', 'Drag to pan, scroll to zoom.')}</Empty>
            </Section>
          ) : null}

          <Note c={c} tone="info" icon={Sparkle}>
            {vn(
              lang,
              'Bản đồ lấy khối cao nhất của từng cột (top-down), tô màu theo vật liệu. Vùng chưa khám phá để trống. Kết quả được lưu đệm nên lần sau mở lại là tức thì.',
              'The map uses the top-most block of each column, coloured by material. Unexplored areas stay empty. Results are cached, so reopening is instant.',
            )}
          </Note>
        </div>
        </aside>

        <div ref={viewRef} className="flex-1 min-w-0 relative overflow-hidden" style={{ background: c.input }}>
          {!result ? (
            <div className="h-full flex flex-col items-center justify-center gap-3 px-8 text-center">
              <MapTrifold size={34} weight="duotone" style={{ color: c.faint }} />
              <p className="text-[13px] font-semibold" style={{ color: c.label }}>
                {loading ? vn(lang, 'Đang quét thế giới…', 'Scanning worlds…') : worlds.length ? vn(lang, 'Chọn thế giới rồi bấm “Dựng bản đồ”', 'Pick a world then press “Render map”') : vn(lang, 'Instance này chưa có thế giới nào', 'This instance has no worlds yet')}
              </p>
              {dimensionInfo ? (
                <p className="text-[11px] font-mono" style={{ color: c.faint }}>
                  {lang === 'vi' ? dimLabel?.label : dimLabel?.labelEn} · {dimensionInfo.regions} {vn(lang, 'vùng', 'regions')} · {vn(lang, 'tự động', 'auto')} ≈ {dimensionInfo.autoWidth} px
                </p>
              ) : null}
            </div>
          ) : (
            <div
              className="h-full w-full overflow-hidden"
              style={{ cursor: drag.current ? 'grabbing' : 'grab' }}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerLeave={() => { onPointerUp(); setPointer(null) }}
            >
              <img
                src={result.url}
                alt=""
                draggable={false}
                className="select-none"
                style={{
                  position: 'absolute',
                  left: 0,
                  top: 0,
                  width: meta.width,
                  height: meta.height,
                  maxWidth: 'none',
                  maxHeight: 'none',
                  transform: `translate(${offset.x}px, ${offset.y}px) scale(${zoom})`,
                  transformOrigin: '0 0',
                  imageRendering: zoom >= 3 ? 'pixelated' : 'auto',
                }}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
