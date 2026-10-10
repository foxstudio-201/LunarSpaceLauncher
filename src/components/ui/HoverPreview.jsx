import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  CalendarBlank, DownloadSimple, Heart, Package, SealCheck, Clock, Tag, GearSix, CursorClick,
} from '@phosphor-icons/react'
import { palette } from '../../lib/palette'
import { timeAgo, formatDate } from '../../lib/status'
import { compact } from '../instance/catalogBits'
import { loaderIcon } from '../../api/client'

const WIDTH = 330
const GAP = 18
const MARGIN = 10
const DELAY = 300

export default function HoverPreview({ theme, lang, hit, kind, load, children, disabled = false }) {
  const c = palette(theme)
  const vn = (vi, en) => (lang === 'vi' ? vi : en)
  const [open, setOpen] = useState(false)
  const [data, setData] = useState(null)
  const [pos, setPos] = useState(null)
  const boxRef = useRef(null)
  const point = useRef({ x: 0, y: 0 })
  const timer = useRef(0)
  const token = useRef(0)

  const place = useCallback(() => {
    const box = boxRef.current
    if (!box) return
    const rect = box.getBoundingClientRect()
    const vw = window.innerWidth
    const vh = window.innerHeight
    const limitX = Math.max(MARGIN, vw - rect.width - MARGIN)
    const limitY = Math.max(MARGIN, vh - rect.height - MARGIN)

    let left = point.current.x + GAP
    if (left > limitX) {
      const flipped = point.current.x - rect.width - GAP
      left = flipped >= MARGIN ? flipped : Math.min(Math.max(MARGIN, flipped), limitX)
    }

    let top = point.current.y + GAP
    if (top > limitY) {
      const flipped = point.current.y - rect.height - GAP
      top = flipped >= MARGIN ? flipped : limitY
    }

    setPos({ left, top })
  }, [])

  useLayoutEffect(() => {
    if (open) place()
  }, [open, data, place])

  useEffect(() => {
    if (!open) return undefined
    const hide = () => setOpen(false)
    window.addEventListener('scroll', hide, true)
    window.addEventListener('blur', hide)
    return () => {
      window.removeEventListener('scroll', hide, true)
      window.removeEventListener('blur', hide)
    }
  }, [open])

  useEffect(() => () => window.clearTimeout(timer.current), [])

  const enter = (event) => {
    if (disabled) return
    point.current = { x: event.clientX, y: event.clientY }
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => {
      setOpen(true)
      if (data || !load) return
      const id = ++token.current
      load().then((res) => {
        if (token.current !== id) return
        if (res?.ok) setData(res.preview)
      }).catch(() => {})
    }, DELAY)
  }

  const move = (event) => {
    if (disabled) return
    point.current = { x: event.clientX, y: event.clientY }
    if (open) place()
  }

  const leave = () => {
    window.clearTimeout(timer.current)
    setOpen(false)
  }

  const base = (() => {
    const merged = { ...(hit || {}), ...(data || {}) }
    if (!merged.author && hit?.author) merged.author = hit.author
    if (!merged.categories?.length && hit?.categories?.length) merged.categories = hit.categories
    if (!merged.loaders?.length && hit?.loaders?.length) merged.loaders = hit.loaders
    if (!merged.gameVersions?.length && hit?.gameVersions?.length) merged.gameVersions = hit.gameVersions
    if (!merged.downloads && hit?.downloads) merged.downloads = hit.downloads
    if (!merged.followers && hit?.followers) merged.followers = hit.followers
    if (!merged.updated && hit?.updated) merged.updated = hit.updated
    if (!merged.summary && hit?.summary) merged.summary = hit.summary
    if (!merged.icon && hit?.icon) merged.icon = hit.icon
    if (!merged.name && hit?.name) merged.name = hit.name
    return merged
  })()
  const gallery = (base.gallery || []).filter((item) => item?.url)
  const versions = base.gameVersions || []
  const categories = base.categories || []
  const loaders = base.loaders || []

  const body = (
    <div
      ref={boxRef}
      className="hover-preview fixed z-[240] pointer-events-none rounded-xl overflow-hidden"
      style={{
        left: pos?.left ?? -9999,
        top: pos?.top ?? -9999,
        width: WIDTH,
        background: c.surface,
        border: `1px solid ${c.border}`,
        boxShadow: '0 22px 60px rgba(0,0,0,0.5), 0 0 0 1px rgba(167,139,250,0.08)',
        visibility: pos ? 'visible' : 'hidden',
      }}
    >
      <div className="relative" style={{ height: 138, background: c.input }}>
        {gallery.length > 1 ? (
          <>
            <div
              className="preview-track flex gap-2 h-full"
              style={{ width: 'max-content', '--preview-duration': `${Math.max(18, gallery.length * 7)}s` }}
            >
              {[...gallery, ...gallery].map((item, i) => (
                <img
                  key={`${item.url}-${i}`}
                  src={item.url}
                  alt=""
                  loading="lazy"
                  className="h-full w-[208px] object-cover shrink-0"
                  style={{ background: c.surface }}
                />
              ))}
            </div>
            <span className="absolute inset-0 preview-edge pointer-events-none" />
          </>
        ) : gallery.length === 1 ? (
          <img src={gallery[0].url} alt="" className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center gap-3">
            {base.icon ? (
              <img src={base.icon} alt="" className="w-16 h-16 rounded-xl object-cover" style={{ border: `1px solid ${c.border}`, background: c.surface }} />
            ) : (
              <Package size={30} weight="duotone" style={{ color: c.faint }} />
            )}
          </div>
        )}
        {base.source ? (
          <span
            className="absolute top-2 right-2 h-5 px-1.5 rounded text-[9px] font-bold uppercase tracking-wide inline-flex items-center"
            style={{ background: 'rgba(0,0,0,0.6)', color: '#fff' }}
          >
            {base.source === 'curseforge' ? 'CurseForge' : 'Modrinth'}
          </span>
        ) : null}
      </div>

      <div className="p-3 flex flex-col gap-2.5">
        <div className="flex items-start gap-2.5">
          {base.icon ? (
            <img src={base.icon} alt="" className="w-10 h-10 rounded-lg object-cover shrink-0" style={{ border: `1px solid ${c.border}`, background: c.input }} />
          ) : (
            <span className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0" style={{ background: c.input, border: `1px solid ${c.border}` }}>
              <Package size={18} weight="duotone" style={{ color: c.faint }} />
            </span>
          )}
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-bold leading-tight line-clamp-2" style={{ color: c.text }}>{base.name || '—'}</p>
            <div className="mt-1 flex items-center gap-1.5 flex-wrap">
              {base.author ? <span className="text-[10.5px] truncate max-w-[150px]" style={{ color: c.faint }}>{base.author}</span> : null}
              {kind ? (
                <span className="h-[17px] px-1.5 rounded text-[9px] font-bold uppercase inline-flex items-center" style={{ background: `${c.accent}1c`, color: c.accent }}>
                  {kind === 'mods' ? vn('Mod', 'Mod') : kind === 'shaderpacks' ? 'Shader' : kind === 'resourcepacks' ? vn('Gói tài nguyên', 'Resource pack') : 'Modpack'}
                </span>
              ) : null}
              {base.license ? (
                <span className="h-[17px] px-1.5 rounded text-[9px] font-bold inline-flex items-center gap-1" style={{ background: c.input, color: c.label }}>
                  <SealCheck size={10} weight="duotone" />
                  {base.license}
                </span>
              ) : null}
            </div>
          </div>
        </div>

        {base.summary ? (
          <p className="text-[11px] leading-relaxed line-clamp-3" style={{ color: c.label }}>{base.summary}</p>
        ) : null}

        <div className="grid grid-cols-2 gap-2">
          <Stat c={c} icon={DownloadSimple} label={vn('Lượt tải', 'Downloads')} value={compact(base.downloads)} />
          <Stat c={c} icon={Heart} label={vn('Theo dõi', 'Followers')} value={base.followers ? compact(base.followers) : '—'} />
          <Stat c={c} icon={Clock} label={vn('Cập nhật', 'Updated')} value={timeAgo(base.updated, lang) || '—'} />
          <Stat c={c} icon={CalendarBlank} label={vn('Phát hành', 'Published')} value={formatDate(base.published ? Date.parse(base.published) : 0, lang) || '—'} />
        </div>

        {categories.length ? (
          <div className="flex items-start gap-1.5">
            <Tag size={12} weight="duotone" className="mt-[3px] shrink-0" style={{ color: c.faint }} />
            <div className="flex flex-wrap gap-1">
              {categories.slice(0, 5).map((item) => (
                <span key={item} className="h-[18px] px-1.5 rounded text-[10px] inline-flex items-center" style={{ background: c.input, border: `1px solid ${c.border}`, color: c.label }}>
                  {item}
                </span>
              ))}
            </div>
          </div>
        ) : null}

        {(loaders.length || versions.length) ? (
          <div className="flex items-center gap-2 pt-2" style={{ borderTop: `1px solid ${c.border}` }}>
            <div className="flex items-center gap-1 shrink-0">
              {loaders.slice(0, 4).map((item) => (
                <span key={item} className="w-[18px] h-[18px] rounded flex items-center justify-center" style={{ background: c.input }}>
                  <img src={loaderIcon(item)} alt={item} className="w-3 h-3 object-contain" />
                </span>
              ))}
            </div>
            <span className="text-[10px] font-mono truncate flex-1" style={{ color: c.label }}>
              {versions.slice(0, 5).join(' · ')}{versions.length > 5 ? ` +${versions.length - 5}` : ''}
            </span>
            <span className="flex items-center gap-1 text-[10px] shrink-0" style={{ color: c.faint }}>
              <CursorClick size={11} weight="duotone" />
              {vn('Bấm xem chi tiết', 'Click for details')}
            </span>
          </div>
        ) : null}

        {!data && load ? (
          <div className="flex items-center gap-1.5 text-[10px]" style={{ color: c.faint }}>
            <GearSix size={11} weight="duotone" className="animate-spin" />
            {vn('Đang tải thông tin dự án…', 'Loading project info…')}
          </div>
        ) : null}
      </div>
    </div>
  )

  return (
    <>
      <div onMouseEnter={enter} onMouseMove={move} onMouseLeave={leave} onClick={leave}>
        {children}
      </div>
      {open ? createPortal(body, document.body) : null}
    </>
  )
}

function Stat({ c, icon: Icon, label, value }) {
  return (
    <div className="rounded-md px-2 py-1.5 flex items-center gap-1.5 min-w-0" style={{ background: c.input, border: `1px solid ${c.border}` }}>
      <Icon size={12} weight="duotone" className="shrink-0" style={{ color: c.accent }} />
      <span className="min-w-0">
        <span className="block text-[9px] font-bold uppercase tracking-wider truncate" style={{ color: c.faint }}>{label}</span>
        <span className="block text-[11.5px] font-mono truncate" style={{ color: c.text }}>{value}</span>
      </span>
    </div>
  )
}
