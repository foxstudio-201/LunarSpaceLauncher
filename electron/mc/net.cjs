const fs = require('fs')
const fsp = fs.promises
const path = require('path')
const crypto = require('crypto')

const UA = { 'User-Agent': 'LunarSpaceLauncher/1.0.0' }

const RANGE_THRESHOLD = 3 * 1024 * 1024
const RANGE_CONNECTIONS = 8
const MAX_ATTEMPTS = 3
const noRangeHosts = new Set()

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function attempt(fn, tries = MAX_ATTEMPTS) {
  let last
  for (let i = 0; i < tries; i++) {
    try {
      return await fn()
    } catch (err) {
      last = err
      if (i < tries - 1) await sleep(250 * 3 ** i)
    }
  }
  throw last
}

async function fetchJson(url, { timeout = 25000 } = {}) {
  const res = await fetch(url, { headers: { Accept: 'application/json', ...UA }, signal: AbortSignal.timeout(timeout) })
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`)
  return res.json()
}

function sha1File(file) {
  return new Promise((resolve) => {
    const hash = crypto.createHash('sha1')
    const stream = fs.createReadStream(file)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('error', () => resolve(null))
    stream.on('end', () => resolve(hash.digest('hex')))
  })
}

async function isFresh(task) {
  try {
    const st = await fsp.stat(task.dest)
    if (task.size && st.size !== task.size) return false
    if (!task.sha1 || task.skipHash) return true
    return (await sha1File(task.dest)) === task.sha1
  } catch {
    return false
  }
}

async function writeAll(handle, buffer, position) {
  let written = 0
  while (written < buffer.length) {
    const { bytesWritten } = await handle.write(buffer, written, buffer.length - written, position + written)
    if (!bytesWritten) throw new Error('Ghi tệp thất bại')
    written += bytesWritten
  }
}

async function rangedDownload(task, onDelta) {
  let host = ''
  try {
    host = new URL(task.url).host
  } catch {}
  if (host && noRangeHosts.has(host)) return false

  const probe = await fetch(task.url, { method: 'HEAD', headers: UA, signal: AbortSignal.timeout(20000) })
  if (!probe.ok) return false
  const size = Number(probe.headers.get('content-length') || 0)
  const accepts = (probe.headers.get('accept-ranges') || '').toLowerCase().includes('bytes')
  if (!size || !accepts || size < RANGE_THRESHOLD) return false

  const test = await fetch(task.url, { headers: { ...UA, Range: 'bytes=0-0' }, signal: AbortSignal.timeout(20000) })
  if (test.status !== 206) {
    if (host) noRangeHosts.add(host)
    return false
  }
  await test.arrayBuffer().catch(() => {})

  const connections = Math.max(2, Math.min(RANGE_CONNECTIONS, Math.ceil(size / (1024 * 1024))))
  const chunk = Math.ceil(size / connections)
  const tmp = `${task.dest}.part`
  await fsp.mkdir(path.dirname(task.dest), { recursive: true })
  const handle = await fsp.open(tmp, 'w')
  try {
    await handle.truncate(size)
    const parts = []
    for (let i = 0; i < connections; i++) {
      const start = i * chunk
      const end = Math.min(size - 1, start + chunk - 1)
      parts.push((async () => {
        const res = await attempt(async () => {
          const res = await fetch(task.url, {
            headers: { ...UA, Range: `bytes=${start}-${end}` },
            signal: AbortSignal.timeout(task.timeout || 180000),
          })
          if (res.status !== 206) throw new Error(`Range không được hỗ trợ (HTTP ${res.status})`)
          return res
        })
        const buf = Buffer.from(await res.arrayBuffer())
        await writeAll(handle, buf, start)
        onDelta?.(buf.length)
      })())
    }
    await Promise.all(parts)
  } finally {
    await handle.close()
  }
  return true
}

async function streamDownload(task, onDelta) {
  await fsp.mkdir(path.dirname(task.dest), { recursive: true })
  const tmp = `${task.dest}.part`
  const res = await fetch(task.url, { headers: UA, signal: AbortSignal.timeout(task.timeout || 180000) })
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${task.url}`)
  const handle = await fsp.open(tmp, 'w')
  const hash = crypto.createHash('sha1')
  let total = 0
  try {
    for await (const chunk of res.body) {
      const buf = Buffer.from(chunk)
      hash.update(buf)
      await writeAll(handle, buf, total)
      total += buf.length
      onDelta?.(buf.length)
    }
  } finally {
    await handle.close()
  }
  if (task.sha1 && hash.digest('hex') !== task.sha1) {
    await fsp.rm(tmp, { force: true })
    throw new Error(`Sai checksum ${path.basename(task.dest)}`)
  }
  await fsp.rename(tmp, task.dest)
  return total
}

async function downloadOne(task, onDelta) {
  if (task.size && task.size >= RANGE_THRESHOLD) {
    const ok = await rangedDownload(task, onDelta).catch(() => false)
    if (ok) {
      const sum = await sha1File(`${task.dest}.part`)
      if (!task.sha1 || sum === task.sha1) {
        await fsp.rename(`${task.dest}.part`, task.dest)
        return task.size
      }
      await fsp.rm(`${task.dest}.part`, { force: true })
    }
  }
  return streamDownload(task, onDelta)
}

async function downloadAll(tasks, { concurrency = 16, onProgress, signal, label } = {}) {
  const queue = [...tasks]
  const total = queue.length
  const totalBytes = tasks.reduce((sum, task) => sum + (task.size || 0), 0)
  let done = 0
  let bytes = 0
  let skipped = 0
  let skippedBytes = 0
  const errors = []
  let last = 0

  const emit = (file, force) => {
    const now = Date.now()
    if (!force && now - last < 100) return
    last = now
    onProgress?.({
      label,
      done,
      total,
      bytes,
      bytesDone: Math.min(totalBytes || Infinity, bytes + skippedBytes),
      totalBytes,
      skipped,
      file,
    })
  }

  const worker = async () => {
    for (;;) {
      if (signal?.aborted) return
      const task = queue.shift()
      if (!task) return
      try {
        if (await isFresh(task)) {
          skipped += 1
          skippedBytes += task.size || 0
        } else {
          await attempt(() => downloadOne(task, (delta) => {
            bytes += delta
            emit(path.basename(task.dest))
          }))
        }
      } catch (err) {
        errors.push({ file: task.dest, url: task.url, error: err?.message || 'download failed' })
      }
      done += 1
      emit(path.basename(task.dest), true)
    }
  }

  const lanes = Math.max(1, Math.min(concurrency, total || 1))
  await Promise.all(Array.from({ length: lanes }, worker))
  onProgress?.({ label, done, total, bytes, bytesDone: bytes + skippedBytes, totalBytes, skipped, final: true })
  return { total, done, bytes, skipped, errors }
}

module.exports = {
  fetchJson,
  sha1File,
  isFresh,
  downloadOne,
  downloadAll,
  RANGE_THRESHOLD,
  RANGE_CONNECTIONS,
  UA,
}
