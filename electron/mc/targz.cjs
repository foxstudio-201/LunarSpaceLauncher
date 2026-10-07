const fs = require('fs')
const fsp = fs.promises
const path = require('path')
const zlib = require('zlib')

const BLOCK = 512

function octal(value, length) {
  const text = value.toString(8)
  return `${'0'.repeat(Math.max(0, length - 1 - text.length))}${text}\0`
}

function header({ name, size, mtime, type }) {
  const buf = Buffer.alloc(BLOCK)
  const write = (text, offset, length) => buf.write(text.slice(0, length).padEnd(length, '\0'), offset, length, 'utf8')
  write(name, 0, 100)
  write(octal(type === '5' ? 0o755 : 0o644, 8), 100, 8)
  write(octal(0, 8), 108, 8)
  write(octal(0, 8), 116, 8)
  write(octal(type === '5' ? 0 : size, 12), 124, 12)
  write(octal(Math.floor((mtime || Date.now()) / 1000), 12), 136, 12)
  write('        ', 148, 8)
  write(type, 156, 1)
  write('ustar\0', 257, 6)
  write('00', 263, 2)
  let sum = 0
  for (const byte of buf) sum += byte
  write(octal(sum, 7), 148, 8)
  return buf
}

async function walk(root, rel, out, ignored) {
  let entries = []
  try {
    entries = await fsp.readdir(path.join(root, rel), { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    const next = rel ? `${rel}/${entry.name}` : entry.name
    if (ignored.some((prefix) => next === prefix.replace(/\/$/, '') || next.startsWith(prefix))) continue
    if (entry.isDirectory()) {
      out.push({ rel: next, dir: true })
      await walk(root, next, out, ignored)
    } else if (entry.isFile()) {
      out.push({ rel: next, dir: false })
    }
  }
}

async function createTarGz({ sourceDir, targetPath, ignoredFiles = [], onProgress, signal }) {
  const ignore = (ignoredFiles || [])
    .map((item) => String(item || '').trim())
    .filter(Boolean)
    .map((item) => (item.endsWith('/') ? item : item))
  const items = []
  await walk(sourceDir, '', items, ignore)
  const total = items.length
  let done = 0
  let bytesProcessed = 0
  const gzip = zlib.createGzip({ level: 6 })
  const out = fs.createWriteStream(targetPath)
  gzip.pipe(out)
  const finished = new Promise((resolve, reject) => {
    out.on('close', resolve)
    out.on('error', reject)
    gzip.on('error', reject)
  })
  const writeBlock = (buf) =>
    new Promise((resolve) => {
      if (!gzip.write(buf)) gzip.once('drain', resolve)
      else resolve()
    })
  for (const item of items) {
    if (signal?.aborted) throw new Error('Đã huỷ sao lưu.')
    const full = path.join(sourceDir, ...item.rel.split('/'))
    let stat = null
    try {
      stat = await fsp.stat(full)
    } catch {
      continue
    }
    const name = item.dir ? `${item.rel}/` : item.rel
    await writeBlock(header({ name, size: stat.size, mtime: stat.mtimeMs, type: item.dir ? '5' : '0' }))
    if (!item.dir) {
      const data = await fsp.readFile(full)
      await writeBlock(data)
      const pad = (BLOCK - (data.length % BLOCK)) % BLOCK
      if (pad) await writeBlock(Buffer.alloc(pad))
      bytesProcessed += data.length
    }
    done += 1
    onProgress?.({ files_processed: done, bytes_processed: bytesProcessed, files_total: total })
  }
  await writeBlock(Buffer.alloc(BLOCK * 2))
  gzip.end()
  await finished
  return { files: total, bytes: bytesProcessed }
}

function parseOctal(buf) {
  const text = buf.toString('utf8').replace(/\0.*$/, '').trim()
  return text ? parseInt(text, 8) || 0 : 0
}

async function extractTarGz({ archivePath, targetDir, truncateDirectory = false, onProgress }) {
  const gunzip = zlib.createGunzip()
  const input = fs.createReadStream(archivePath)
  input.pipe(gunzip)
  const chunks = []
  for await (const chunk of gunzip) chunks.push(chunk)
  const buf = Buffer.concat(chunks)
  const base = path.resolve(targetDir)
  if (truncateDirectory) {
    let entries = []
    try {
      entries = await fsp.readdir(base)
    } catch {}
    for (const name of entries) {
      await fsp.rm(path.join(base, name), { recursive: true, force: true })
    }
  }
  let offset = 0
  let files = 0
  let bytesProcessed = 0
  while (offset + BLOCK <= buf.length) {
    const block = buf.subarray(offset, offset + BLOCK)
    if (block.every((byte) => byte === 0)) break
    const name = block.subarray(0, 100).toString('utf8').replace(/\0.*$/, '')
    const size = parseOctal(block.subarray(124, 136))
    const type = block.subarray(156, 157).toString('utf8')
    offset += BLOCK
    if (!name) break
    const target = path.resolve(base, name)
    if (!target.startsWith(base)) {
      offset += Math.ceil(size / BLOCK) * BLOCK
      continue
    }
    if (type === '5') {
      await fsp.mkdir(target, { recursive: true })
    } else if (size > 0) {
      const data = buf.subarray(offset, offset + size)
      await fsp.mkdir(path.dirname(target), { recursive: true })
      await fsp.writeFile(target, data)
      files += 1
      bytesProcessed += size
      onProgress?.({ files_processed: files, bytes_processed: bytesProcessed, bytes_total: buf.length })
    }
    offset += Math.ceil(size / BLOCK) * BLOCK
  }
  return { files, bytes: bytesProcessed }
}

module.exports = { createTarGz, extractTarGz }
