const FIELDS = [
  { min: 0, max: 59 },
  { min: 0, max: 23 },
  { min: 1, max: 31 },
  { min: 1, max: 12 },
  { min: 0, max: 6 },
]

const MONTHS = ['tháng 1', 'tháng 2', 'tháng 3', 'tháng 4', 'tháng 5', 'tháng 6', 'tháng 7', 'tháng 8', 'tháng 9', 'tháng 10', 'tháng 11', 'tháng 12']
const DAYS_VI = ['Chủ nhật', 'Thứ hai', 'Thứ ba', 'Thứ tư', 'Thứ năm', 'Thứ sáu', 'Thứ bảy']

function parseField(text, spec) {
  const values = new Set()
  for (const part of String(text).split(',')) {
    const [range, stepText] = part.split('/')
    const step = stepText ? parseInt(stepText, 10) : 1
    if (!step || step < 1) return null
    let start = spec.min
    let end = spec.max
    if (range !== '*' && range !== '') {
      const [a, b] = range.split('-')
      start = parseInt(a, 10)
      if (b !== undefined) end = parseInt(b, 10)
      else end = start
    }
    if (Number.isNaN(start) || Number.isNaN(end)) return null
    if (start < spec.min || end > spec.max || start > end) return null
    for (let value = start; value <= end; value += step) values.add(value)
  }
  return values
}

function parseCron(expr) {
  const parts = String(expr || '').trim().split(/\s+/)
  if (parts.length !== 5) return null
  const sets = []
  for (let i = 0; i < 5; i += 1) {
    const set = parseField(parts[i], FIELDS[i])
    if (!set || !set.size) return null
    sets.push(set)
  }
  return sets
}

function matches(sets, date) {
  const dow = date.getDay()
  return (
    sets[0].has(date.getMinutes()) &&
    sets[1].has(date.getHours()) &&
    sets[2].has(date.getDate()) &&
    sets[3].has(date.getMonth() + 1) &&
    (sets[4].has(dow) || (dow === 0 && sets[4].has(7)))
  )
}

function nextRun(expr, from = new Date()) {
  const sets = parseCron(expr)
  if (!sets) return null
  const date = new Date(from.getTime())
  date.setSeconds(0, 0)
  date.setMinutes(date.getMinutes() + 1)
  for (let i = 0; i < 366 * 24 * 60; i += 1) {
    if (matches(sets, date)) return date.getTime()
    date.setMinutes(date.getMinutes() + 1)
  }
  return null
}

function describe(expr, lang = 'vi') {
  const parts = String(expr || '').trim().split(/\s+/)
  if (parts.length !== 5 || !parseCron(expr)) return ''
  const [min, hour, dom, month, dow] = parts
  const every = (text) => text.match(/^\*\/(\d+)$/)
  const vi = lang === 'vi'
  const bits = []
  const stepMin = every(min)
  if (min === '*' && hour === '*') bits.push(vi ? 'mỗi phút' : 'every minute')
  else if (stepMin) bits.push(vi ? `mỗi ${stepMin[1]} phút` : `every ${stepMin[1]} minutes`)
  else if (hour === '*' && !Number.isNaN(Number(min))) bits.push(vi ? `phút ${min} mỗi giờ` : `minute ${min} of every hour`)
  else if (!Number.isNaN(Number(min)) && !Number.isNaN(Number(hour))) bits.push(vi ? `lúc ${hour.padStart(2, '0')}:${min.padStart(2, '0')}` : `at ${hour.padStart(2, '0')}:${min.padStart(2, '0')}`)
  else bits.push(`${min} ${hour}`)
  if (dom !== '*') bits.push(vi ? `ngày ${dom}` : `day ${dom}`)
  if (month !== '*') bits.push(vi ? (MONTHS[Number(month) - 1] || `tháng ${month}`) : `month ${month}`)
  if (dow !== '*') {
    const index = Number(dow)
    bits.push(vi ? DAYS_VI[Number.isNaN(index) ? 1 : index % 7] : `weekday ${dow}`)
  }
  return bits.join(', ')
}

function dueSchedules(list, now = Date.now()) {
  const due = []
  for (const item of list) {
    if (item.isActive === false) continue
    const sets = parseCron(item.cron)
    if (!sets) continue
    const last = Number(item.lastRunAt || 0)
    const next = Number(item.nextRunAt || 0)
    if (!next || next <= now) {
      const computed = nextRun(item.cron, new Date(Math.max(last, now - 61 * 1000)))
      if (computed && computed <= now && computed > last) due.push({ ...item, runAt: computed })
      else if (!next && last === 0) due.push({ ...item, runAt: now })
    }
  }
  return due
}

module.exports = { parseCron, nextRun, describe, dueSchedules }
