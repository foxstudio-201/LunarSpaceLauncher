const fs = require('fs')
const path = require('path')
const zlib = require('zlib')

const CRC_TABLE = (() => {
  const table = new Int32Array(256)
  for (let i = 0; i < 256; i += 1) {
    let c = i
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[i] = c
  }
  return table
})()

function crcUpdate(crc, buf) {
  let c = crc
  for (let i = 0; i < buf.length; i += 1) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return c
}

const STORED_EXT = new Set([
  '.jar', '.zip', '.mrpack', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.bmp',
  '.ogg', '.mp3', '.mp4', '.m4a', '.wav', '.7z', '.gz', '.xz', '.zst', '.br', '.pack', '.ddp',
])

const MAX_DEFLATE = 24 * 1024 * 1024
const CHUNK = 64 * 1024
const LIMIT_32 = 0xffffffff

function timeParts(date) {
  const d = date || new Date()
  const time = ((d.getHours() & 0x1f) << 11) | ((d.getMinutes() & 0x3f) << 5) | ((d.getSeconds() / 2) & 0x1f)
  const day = (((Math.max(1980, d.getFullYear()) - 1980) & 0x7f) << 9) | (((d.getMonth() + 1) & 0x0f) << 5) | (d.getDate() & 0x1f)
  return { time: time & 0xffff, date: day & 0xffff }
}

class ZipWriter {
  constructor(filePath) {
    this.fd = fs.openSync(filePath, 'w')
    this.offset = 0
    this.entries = []
  }

  put(buf) {
    fs.writeSync(this.fd, buf, 0, buf.length, this.offset)
    this.offset += buf.length
  }

  localHeader({ name, method, useDescriptor, size, crc, mtime }) {
    const { time, date } = timeParts(mtime)
    const nameBuf = Buffer.from(name, 'utf8')
    const head = Buffer.alloc(30)
    head.writeUInt32LE(0x04034b50, 0)
    head.writeUInt16LE(20, 4)
    head.writeUInt16LE(0x0800 | (useDescriptor ? 0x0008 : 0), 6)
    head.writeUInt16LE(method, 8)
    head.writeUInt16LE(time, 10)
    head.writeUInt16LE(date, 12)
    head.writeUInt32LE(useDescriptor ? 0 : crc >>> 0, 14)
    head.writeUInt32LE(useDescriptor ? 0 : size >>> 0, 18)
    head.writeUInt32LE(useDescriptor ? 0 : size >>> 0, 22)
    head.writeUInt16LE(nameBuf.length, 26)
    head.writeUInt16LE(0, 28)
    this.put(head)
    this.put(nameBuf)
  }

  push(entry) {
    if (entry.size > LIMIT_32 || this.offset > LIMIT_32) {
      throw new Error('Gói xuất vượt 4GB — chưa hỗ trợ định dạng zip64.')
    }
    this.entries.push(entry)
  }

  addFile(zipPath, absPath) {
    const name = zipPath.split(path.sep).join('/')
    const stat = fs.statSync(absPath)
    const method = STORED_EXT.has(path.extname(absPath).toLowerCase()) ? 0 : 8
    const mtime = stat.mtime

    if (method === 8 && stat.size <= MAX_DEFLATE) {
      const raw = fs.readFileSync(absPath)
      const deflated = zlib.deflateRawSync(raw, { level: 6 })
      const crc = (crcUpdate(~0, raw) ^ 0xffffffff) >>> 0
      const start = this.offset
      this.localHeader({ name, method: 8, useDescriptor: false, size: deflated.length, crc, mtime })
      this.put(deflated)
      this.push({ name, method: 8, crc, comp: deflated.length, size: raw.length, offset: start, mtime })
      return
    }

    const start = this.offset
    this.localHeader({ name, method: 0, useDescriptor: true, size: 0, crc: 0, mtime })
    let crc = ~0
    let size = 0
    const fd = fs.openSync(absPath, 'r')
    try {
      const buf = Buffer.allocUnsafe(CHUNK)
      for (;;) {
        const read = fs.readSync(fd, buf, 0, CHUNK, size)
        if (!read) break
        const slice = read === CHUNK ? buf : buf.subarray(0, read)
        crc = crcUpdate(crc, slice)
        this.put(slice)
        size += read
      }
    } finally {
      fs.closeSync(fd)
    }
    const finalCrc = (crc ^ 0xffffffff) >>> 0
    const desc = Buffer.alloc(16)
    desc.writeUInt32LE(0x08074b50, 0)
    desc.writeUInt32LE(finalCrc, 4)
    desc.writeUInt32LE(size >>> 0, 8)
    desc.writeUInt32LE(size >>> 0, 12)
    this.put(desc)
    this.push({ name, method: 0, crc: finalCrc, comp: size, size, offset: start, mtime })
  }

  addBuffer(zipPath, buffer, mtime) {
    const name = zipPath.split(path.sep).join('/')
    const raw = Buffer.isBuffer(buffer) ? buffer : Buffer.from(String(buffer), 'utf8')
    const deflated = zlib.deflateRawSync(raw, { level: 6 })
    const crc = (crcUpdate(~0, raw) ^ 0xffffffff) >>> 0
    const start = this.offset
    this.localHeader({ name, method: 8, useDescriptor: false, size: deflated.length, crc, mtime })
    this.put(deflated)
    this.push({ name, method: 8, crc, comp: deflated.length, size: raw.length, offset: start, mtime })
  }

  close() {
    const cdStart = this.offset
    for (const entry of this.entries) {
      const { time, date } = timeParts(entry.mtime)
      const nameBuf = Buffer.from(entry.name, 'utf8')
      const head = Buffer.alloc(46)
      head.writeUInt32LE(0x02014b50, 0)
      head.writeUInt16LE(20, 4)
      head.writeUInt16LE(20, 6)
      head.writeUInt16LE(0x0800 | (entry.method === 0 ? 0x0008 : 0), 8)
      head.writeUInt16LE(entry.method, 10)
      head.writeUInt16LE(time, 12)
      head.writeUInt16LE(date, 14)
      head.writeUInt32LE(entry.crc >>> 0, 16)
      head.writeUInt32LE(entry.comp >>> 0, 20)
      head.writeUInt32LE(entry.size >>> 0, 24)
      head.writeUInt16LE(nameBuf.length, 28)
      head.writeUInt16LE(0, 30)
      head.writeUInt16LE(0, 32)
      head.writeUInt16LE(0, 34)
      head.writeUInt16LE(0, 36)
      head.writeUInt32LE(0, 38)
      head.writeUInt32LE(entry.offset >>> 0, 42)
      this.put(head)
      this.put(nameBuf)
    }
    const cdSize = this.offset - cdStart
    const eocd = Buffer.alloc(22)
    eocd.writeUInt32LE(0x06054b50, 0)
    eocd.writeUInt16LE(0, 4)
    eocd.writeUInt16LE(0, 6)
    eocd.writeUInt16LE(this.entries.length, 8)
    eocd.writeUInt16LE(this.entries.length, 10)
    eocd.writeUInt32LE(cdSize, 12)
    eocd.writeUInt32LE(cdStart, 16)
    eocd.writeUInt16LE(0, 20)
    this.put(eocd)
    fs.closeSync(this.fd)
    return { entries: this.entries.length, bytes: this.offset }
  }
}

const ZIP_HOSTS = {
  mediafilez: 'https://mediafilez.forgecdn.net/files',
  edge: 'https://edge.forgecdn.net/files',
}

function cfFileIdFromUrl(url) {
  const m = String(url || '').match(/\/(?:files|cdn)\/(\d{4})\/(\d+)\//)
  if (!m) return null
  const id = Number(`${m[1]}${m[2]}`)
  return Number.isFinite(id) && id > 0 ? id : null
}

module.exports = { ZipWriter, crcUpdate, cfFileIdFromUrl, ZIP_HOSTS }
