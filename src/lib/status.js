export function statusColor(status) {
  if (status === 'running') return '#22c55e'
  if (status === 'installing' || status === 'stopping' || status === 'starting') return '#eab308'
  if (status === 'error') return '#ef4444'
  return '#6b7280'
}

export function statusKey(status) {
  if (status === 'running') return 'instance.status.running'
  if (status === 'starting') return 'instance.status.starting'
  if (status === 'stopping') return 'instance.status.stopping'
  if (status === 'installing') return 'instance.status.installing'
  if (status === 'error') return 'instance.status.error'
  return 'instance.status.ready'
}

export function formatBytes(bytes) {
  const n = Number(bytes) || 0
  if (n >= 1073741824) return `${Math.round((n / 1073741824) * 10) / 10} GB`
  if (n >= 1048576) return `${Math.round(n / 1048576)} MB`
  return `${Math.round(n / 1024)} KB`
}

export function formatSpeed(bps) {
  const n = Number(bps) || 0
  if (n >= 1048576) return `${Math.round((n / 1048576) * 10) / 10} MB/s`
  if (n >= 1024) return `${Math.round(n / 1024)} KB/s`
  return `${Math.round(n)} B/s`
}

export function formatDate(value, lang) {
  if (!value) return null
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleDateString(lang === 'vi' ? 'vi-VN' : 'en-US', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
}

export function formatPlaytime(ms) {
  const total = Math.round((Number(ms) || 0) / 60000)
  if (total < 60) return `${total}m`
  const h = Math.floor(total / 60)
  const m = total % 60
  return `${h}h ${m}m`
}

export function timeAgo(value, lang) {
  if (!value) return null
  const then = new Date(value).getTime()
  if (Number.isNaN(then)) return null
  const days = Math.floor((Date.now() - then) / 86400000)
  if (days < 0) return lang === 'vi' ? 'sắp tới' : 'soon'
  if (days === 0) return lang === 'vi' ? 'hôm nay' : 'today'
  if (days === 1) return lang === 'vi' ? 'hôm qua' : 'yesterday'
  if (days < 30) return lang === 'vi' ? `${days} ngày trước` : `${days} days ago`
  const months = Math.floor(days / 30)
  if (months < 12) return lang === 'vi' ? `${months} tháng trước` : `${months} months ago`
  return lang === 'vi' ? `${Math.floor(months / 12)} năm trước` : `${Math.floor(months / 12)} years ago`
}
