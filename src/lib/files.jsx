import { File, Folder } from '@phosphor-icons/react'

export function fileIcon(name, isDir, accent, size = 16) {
  if (isDir) return <Folder size={size} weight="fill" style={{ color: '#eab308', flexShrink: 0 }} />
  return <File size={size} weight="duotone" style={{ color: accent, flexShrink: 0 }} />
}

export function sizeLabel(bytes) {
  const n = Number(bytes) || 0
  if (n < 1024) return `${n} B`
  if (n < 1048576) return `${Math.round((n / 1024) * 10) / 10} KB`
  if (n < 1073741824) return `${Math.round((n / 1048576) * 10) / 10} MB`
  return `${Math.round((n / 1073741824) * 10) / 10} GB`
}

export function stampLabel(ms) {
  if (!ms) return '—'
  const d = new Date(ms)
  if (Number.isNaN(d.getTime())) return '—'
  const p = (v) => String(v).padStart(2, '0')
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`
}
