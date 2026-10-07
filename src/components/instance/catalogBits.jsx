import { useState } from 'react'
import { WarningCircle, Monitor, HardDrives } from '@phosphor-icons/react'

const vn = (lang, vi, en) => (lang === 'vi' ? vi : en)

export function Box({ c, title, icon: Icon, children }) {
  return (
    <div className="rounded-xl" style={{ background: c.surface, border: `1px solid ${c.border}` }}>
      <div className="flex items-center gap-1.5 px-3.5 pt-3">
        {Icon && <Icon size={12} weight="duotone" style={{ color: c.accent }} />}
        <span className="text-[10px] font-bold uppercase tracking-[0.14em]" style={{ color: c.label }}>{title}</span>
      </div>
      <div className="px-3.5 py-3">{children}</div>
    </div>
  )
}

const ENV_KINDS = {
  client: { vi: 'Máy khách', en: 'Client', color: '#a78bfa', bg: 'rgba(167,139,250,0.16)', icons: ['client'] },
  server: { vi: 'Máy chủ', en: 'Server', color: '#22d3ee', bg: 'rgba(34,211,238,0.14)', icons: ['server'] },
  both: { vi: 'Cả hai', en: 'Both', color: '#4ade80', bg: 'rgba(74,222,128,0.14)', icons: ['client', 'server'] },
}

export function EnvChip({ c, env, lang, title }) {
  const kind = ENV_KINDS[env]
  if (!kind) return null
  return (
    <span
      className="h-5 px-1.5 rounded-md text-[9px] font-bold uppercase shrink-0 inline-flex items-center gap-1"
      style={{ background: kind.bg, color: kind.color }}
      title={title || (lang === 'vi' ? 'Mod chạy ở máy khách hay máy chủ' : 'Client or server side mod')}
    >
      {kind.icons.map((side) =>
        side === 'client' ? (
          <Monitor key={side} size={11} weight="duotone" />
        ) : (
          <HardDrives key={side} size={11} weight="duotone" />
        ),
      )}
      {vn(lang, kind.vi, kind.en)}
    </span>
  )
}

export function Chips({ c, items, max = 0 }) {
  const [open, setOpen] = useState(false)
  const list = [...new Set((items || []).filter(Boolean))]
  if (!list.length) return <span className="text-[10px]" style={{ color: c.faint }}>—</span>
  const shown = max && !open ? list.slice(0, max) : list
  return (
    <div className="flex flex-wrap gap-1.5">
      {shown.map((item) => (
        <span
          key={String(item)}
          className="h-6 px-2 rounded-md flex items-center text-[10px] font-semibold"
          style={{ background: c.input, border: `1px solid ${c.border}`, color: c.label }}
        >
          {item}
        </span>
      ))}
      {max && !open && list.length > max && (
        <button
          onClick={() => setOpen(true)}
          className="h-6 px-2 rounded-md text-[10px] font-bold"
          style={{ background: 'transparent', border: `1px dashed ${c.border}`, color: c.accent }}
        >
          +{list.length - max}
        </button>
      )}
    </div>
  )
}

export function Stat({ c, label, value }) {
  return (
    <div className="rounded-xl px-3.5 py-2.5 flex flex-col gap-1" style={{ background: c.surface, border: `1px solid ${c.border}` }}>
      <span className="text-[9px] font-bold uppercase tracking-[0.14em]" style={{ color: c.faint }}>{label}</span>
      <span className="text-[12px] font-bold truncate" style={{ color: c.text }}>{value}</span>
    </div>
  )
}

export function Leader({ c, label, value, title }) {
  return (
    <div className="flex items-end gap-2 min-w-0">
      <span className="text-[10px] shrink-0" style={{ color: c.faint }}>{label}</span>
      <span
        className="flex-1 h-px mb-[5px] min-w-[12px]"
        style={{ backgroundImage: `linear-gradient(to right, ${c.border} 0 2px, transparent 2px 5px)`, backgroundSize: '5px 1px', backgroundRepeat: 'repeat-x' }}
      />
      <span className="text-[11px] font-mono shrink-0 max-w-[58%] truncate" style={{ color: c.text }} title={title || String(value)}>{value}</span>
    </div>
  )
}

export function Banner({ c, text }) {
  return (
    <div className="flex items-start gap-2 rounded-lg px-3 py-2" style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.28)' }}>
      <WarningCircle size={13} weight="duotone" className="shrink-0 mt-0.5" style={{ color: '#f87171' }} />
      <span className="text-[10px] leading-relaxed" style={{ color: '#f87171' }}>{text}</span>
    </div>
  )
}

const ENV_LABELS = {
  required: ['Bắt buộc', 'Required'],
  optional: ['Tùy chọn', 'Optional'],
  unsupported: ['Không hỗ trợ', 'Unsupported'],
}

export function EnvRow({ c, label, value, lang }) {
  const pair = ENV_LABELS[value]
  const ok = value === 'required'
  const bad = value === 'unsupported'
  return (
    <div className="flex items-center gap-2">
      <span className="text-[10px]" style={{ color: c.faint }}>{label}</span>
      <span className="text-[10px] font-semibold" style={{ color: bad ? '#f87171' : ok ? '#4ade80' : c.label }}>
        {pair ? vn(lang, pair[0], pair[1]) : value}
      </span>
    </div>
  )
}

const RELEASE_LABELS = {
  release: ['ổn định', 'release'],
  beta: ['thử nghiệm', 'beta'],
  alpha: ['alpha', 'alpha'],
}

export function ReleaseChip({ c, type, lang }) {
  if (!type || type === 'release') return null
  const pair = RELEASE_LABELS[type]
  const color = type === 'alpha' ? '#f87171' : '#fbbf24'
  return (
    <span
      className="text-[9px] font-bold px-1 py-0.5 rounded shrink-0 uppercase"
      style={{ background: `${color}22`, color }}
      title={pair ? vn(lang, pair[0], pair[1]) : type}
    >
      {type}
    </span>
  )
}

export function gameVersionList(detail, hit) {
  const list = detail?.gameVersions?.length ? detail.gameVersions : hit?.gameVersions || []
  return [...new Set(list.filter(Boolean))].reverse()
}

export function followersOf(detail, hit) {
  const n = detail?.followers ?? hit?.followers
  return n ? compact(n) : '—'
}

export function bytes(n) {
  const v = Number(n) || 0
  if (!v) return ''
  if (v >= 1048576) return `${Math.round(v / 104857.6) / 10} MB`
  if (v >= 1024) return `${Math.round(v / 102.4) / 10} KB`
  return `${v} B`
}

export function compact(n) {
  const v = Number(n) || 0
  if (v >= 1e9) return `${Math.round(v / 1e8) / 10}B`
  if (v >= 1e6) return `${Math.round(v / 1e5) / 10}M`
  if (v >= 1e3) return `${Math.round(v / 100) / 10}K`
  return String(v)
}
