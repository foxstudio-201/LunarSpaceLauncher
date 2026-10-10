const fs = require('fs')
const fsp = fs.promises
const path = require('path')
const zlib = require('zlib')
const { Worker } = require('worker_threads')
const nbt = require('./nbt.cjs')
const { blockColor, isAirBlock } = require('./mapcolor.cjs')
const { SurfacePalette } = require('./mapsurface.cjs')

const WORKER = path.join(__dirname, 'mapworker.cjs')
const REGION_BLOCKS = 512
const DIMS = { overworld: '', nether: 'DIM-1', end: 'DIM1' }
const MAX_PX = 6000
const SCALES = [1, 2, 4, 8, 16, 32, 64]

const cancelFlag = { value: false }
const setCancel = (value) => { cancelFlag.value = !!value }

const isCancelled = () => cancelFlag.value

async function regionFiles(dir) {
  const list = await fsp.readdir(dir).catch(() => [])
  const out = []
  for (const name of list) {
    const match = name.match(/^r\.(-?\d+)\.(-?\d+)\.mca$/i)
    if (!match) continue
    const file = path.join(dir, name)
    const stat = await fsp.stat(file).catch(() => null)
    if (!stat?.isFile()) continue
    out.push({ x: Number(match[1]), z: Number(match[2]), file, size: stat.size, mtime: stat.mtimeMs })
  }
  out.sort((a, b) => (a.z - b.z) || (a.x - b.x))
  return out
}

function chunkGrid(regions) {
  const cells = new Map()
  const xs = new Map()
  const zs = new Map()
  const occupied = new Set()
  let minCx = Infinity
  let maxCx = -Infinity
  let minCz = Infinity
  let maxCz = -Infinity
  for (const region of regions) {
    const fd = fs.openSync(region.file, 'r')
    const head = Buffer.alloc(4096)
    try {
      fs.readSync(fd, head, 0, 4096, 0)
    } catch {
      fs.closeSync(fd)
      continue
    }
    fs.closeSync(fd)
    const list = []
    for (let index = 0; index < 1024; index += 1) {
      const offset = head.readUIntBE(index * 4, 3)
      const sectors = head.readUIntBE(index * 4 + 3, 1)
      if (!offset || !sectors) continue
      const cxi = index % 32
      const czi = Math.floor(index / 32)
      list.push((czi << 5) | cxi)
      const cx = region.x * 32 + cxi
      const cz = region.z * 32 + czi
      xs.set(cx, (xs.get(cx) || 0) + 1)
      zs.set(cz, (zs.get(cz) || 0) + 1)
      occupied.add(`${cx},${cz}`)
      if (cx < minCx) minCx = cx
      if (cx > maxCx) maxCx = cx
      if (cz < minCz) minCz = cz
      if (cz > maxCz) maxCz = cz
    }
    cells.set(`${region.x},${region.z}`, list)
  }
  return { cells, xs, zs, occupied, minCx, maxCx, minCz, maxCz }
}

function mainBox(occupied) {
  const seen = new Set()
  const groups = []
  for (const key of occupied) {
    if (seen.has(key)) continue
    const queue = [key]
    seen.add(key)
    const cells = []
    while (queue.length) {
      const current = queue.pop()
      cells.push(current)
      const [cx, cz] = current.split(',').map(Number)
      for (let dx = -1; dx <= 1; dx += 1) {
        for (let dz = -1; dz <= 1; dz += 1) {
          if (!dx && !dz) continue
          const next = `${cx + dx},${cz + dz}`
          if (seen.has(next) || !occupied.has(next)) continue
          seen.add(next)
          queue.push(next)
        }
      }
    }
    groups.push(cells)
  }
  if (!groups.length) return null
  groups.sort((a, b) => b.length - a.length)
  const largest = groups[0].length
  const minSize = Math.max(8, Math.round(largest * 0.01))
  let minCx = Infinity
  let maxCx = -Infinity
  let minCz = Infinity
  let maxCz = -Infinity
  for (const group of groups) {
    if (group.length < minSize) continue
    for (const cell of group) {
      const [cx, cz] = cell.split(',').map(Number)
      if (cx < minCx) minCx = cx
      if (cx > maxCx) maxCx = cx
      if (cz < minCz) minCz = cz
      if (cz > maxCz) maxCz = cz
    }
  }
  if (!Number.isFinite(minCx)) return null
  return { minCx, maxCx, minCz, maxCz }
}

function trimAxis(counts, total, budgetRatio) {
  const keys = [...counts.keys()].sort((a, b) => a - b)
  if (keys.length <= 2) return [keys[0] ?? 0, keys[keys.length - 1] ?? 0]
  const values = keys.map((key) => counts.get(key) || 0)
  const sorted = [...values].sort((a, b) => a - b)
  const median = sorted[Math.floor(sorted.length / 2)] || 1
  const density = Math.max(1, Math.floor(median * 0.06))
  let budget = Math.max(1, Math.floor(total * budgetRatio))
  let lo = 0
  let hi = keys.length - 1
  let spent = 0
  while (lo < hi) {
    const left = counts.get(keys[lo]) || 0
    const right = counts.get(keys[hi]) || 0
    if (left > density && right > density) break
    if (left <= right) {
      if (spent + left > budget) break
      spent += left
      lo += 1
    } else {
      if (spent + right > budget) break
      spent += right
      hi -= 1
    }
  }
  return [keys[lo], keys[hi]]
}

function bboxOf(regions) {
  const xs = regions.map((r) => r.x)
  const zs = regions.map((r) => r.z)
  return { minRx: Math.min(...xs), maxRx: Math.max(...xs), minRz: Math.min(...zs), maxRz: Math.max(...zs) }
}

const originKey = (dir) => {
  const text = path.resolve(dir).toLowerCase()
  let hash = 2166136261
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(36)
}

const signature = (regions) => {
  let hash = 2166136261
  const text = regions.map((r) => `${r.x},${r.z},${r.size},${Math.round(r.mtime)}`).join(';')
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(36)
}

function pickScale(box, requested) {
  const spanBlocks = (Math.max(box.maxRx - box.minRx, box.maxRz - box.minRz) + 1) * REGION_BLOCKS
  if (requested && requested > 0) return Math.min(64, Math.max(1, Math.round(requested)))
  const fit = SCALES.find((scale) => spanBlocks / scale <= MAX_PX)
  return fit || 64
}

const unpackLongs = (values) => values.map((item) => BigInt(item))

const readIndex = (values, index, bits, per) => {
  const li = Math.floor(index / per)
  const raw = values[li]
  if (raw === undefined) return 0
  const shift = BigInt((index % per) * bits)
  const mask = (1n << BigInt(bits)) - 1n
  return Number((raw >> shift) & mask)
}

function buildSection(section) {
  const entry = (name) => section.value.find((item) => item.name === name)
  const y = Number(entry('Y')?.value ?? 0)
  const states = entry('block_states') || entry('BlockStates')
  if (!states || !Array.isArray(states.value)) return null
  const paletteNode = states.value.find((item) => item.name === 'palette') || states.value.find((item) => item.name === 'Palette')
  const palette = (paletteNode?.value || []).map((node) => {
    const name = node.value.find((item) => item.name === 'Name')
    return name ? String(name.value) : 'minecraft:air'
  })
  if (!palette.length) return null
  const dataNode = states.value.find((item) => item.name === 'data') || states.value.find((item) => item.name === 'Data')
  const longs = Array.isArray(dataNode?.value) ? dataNode.value : []
  const bits = palette.length > 1 ? Math.max(4, Math.ceil(Math.log2(palette.length))) : 0
  const values = bits && longs.length ? unpackLongs(longs) : null
  const per = bits ? Math.floor(64 / bits) : 0
  return { y, palette, bits, values, per }
}

function biomeReader(section) {
  const entry = (name) => section.value.find((item) => item.name === name)
  const node = entry('biomes')
  if (!node || !Array.isArray(node.value)) return null
  const paletteNode = node.value.find((item) => item.name === 'palette')
  const dataNode = node.value.find((item) => item.name === 'data')
  const palette = (paletteNode?.value || []).map((item) => String(item.value ?? ''))
  if (!palette.length) return null
  if (palette.length === 1 || !dataNode?.value?.length) return () => palette[0]
  const bits = Math.max(1, Math.ceil(Math.log2(palette.length)))
  const values = unpackLongs(dataNode.value)
  const per = Math.max(1, Math.floor(64 / bits))
  return (x, y, z) => {
    const index = ((y >> 2) & 3) * 16 + ((z >> 2) & 3) * 4 + ((x >> 2) & 3)
    const slot = readIndex(values, index, bits, per)
    return palette[slot] || palette[0]
  }
}

const WATERISH = (name) => {
  const text = String(name || '')
  return text === 'minecraft:water' || text === 'minecraft:bubble_column' || text.endsWith(':water')
}

function chunkColumns(root, palette) {
  if (!palette) return legacyColumns(root)
  const colors = new Int32Array(256).fill(-1)
  const heights = new Int16Array(256)
  const sectionsNode = root.value.find((item) => item.name === 'sections') || root.value.find((item) => item.name === 'Sections')
  const sections = (sectionsNode?.value || []).map((section) => ({ section, built: buildSection(section), biome: biomeReader(section) }))
    .filter((item) => item.built)
    .sort((a, b) => b.built.y - a.built.y)
  let remaining = 256
  for (const entry of sections) {
    if (!remaining) break
    const built = entry.built
    const biomeOf = entry.biome || (() => '')
    if (built.palette.length === 1) {
      const name = built.palette[0]
      if (isAirBlock(name)) continue
      const packed = resolveColor(palette, name, biomeOf(0, built.y * 16 + 15, 0))
      if (packed === null) continue
      for (let i = 0; i < 256; i += 1) {
        if (colors[i] !== -1) continue
        colors[i] = packed
        heights[i] = built.y * 16 + 15
        remaining -= 1
      }
      continue
    }
    if (!built.values) continue
    for (let i = 0; i < 256; i += 1) {
      if (colors[i] !== -1) continue
      const x = i & 15
      const z = i >> 4
      for (let y = 15; y >= 0; y -= 1) {
        const index = readIndex(built.values, (y * 16 + z) * 16 + x, built.bits, built.per)
        const name = built.palette[index]
        if (!name || isAirBlock(name)) continue
        const biome = biomeOf(x, built.y * 16 + y, z)
        let packed = resolveColor(palette, name, biome)
        if (packed === null) continue
        if (WATERISH(name)) {
          let depth = 0
          for (let below = y - 1; below >= 0; below -= 1) {
            const idx2 = readIndex(built.values, (below * 16 + z) * 16 + x, built.bits, built.per)
            if (!WATERISH(built.palette[idx2])) break
            depth += 1
          }
          if (depth) packed = darken(packed, Math.min(1, depth / 14) * 0.32)
        }
        colors[i] = packed
        heights[i] = built.y * 16 + y
        remaining -= 1
        break
      }
    }
  }
  return { colors, heights }
}

function darken(packed, amount) {
  const factor = 1 - amount
  return (Math.round(((packed >> 16) & 255) * factor) << 16) | (Math.round(((packed >> 8) & 255) * factor) << 8) | Math.round((packed & 255) * factor)
}

function resolveColor(palette, name, biome) {
  const value = palette.colorFor(name, biome || 'minecraft:plains')
  if (value === 'skip') return null
  if (!value) {
    const fallback = blockColor(name)
    return fallback ? (fallback[0] << 16) | (fallback[1] << 8) | fallback[2] : null
  }
  return (value[0] << 16) | (value[1] << 8) | value[2]
}

function legacyColumns(root) {
  const colors = new Int32Array(256).fill(-1)
  const heights = new Int16Array(256)
  const sectionsNode = root.value.find((item) => item.name === 'sections') || root.value.find((item) => item.name === 'Sections')
  const sections = (sectionsNode?.value || []).map(buildSection).filter(Boolean).sort((a, b) => b.y - a.y)
  let remaining = 256
  for (const section of sections) {
    if (!remaining) break
    if (section.palette.length === 1) {
      const name = section.palette[0]
      if (isAirBlock(name)) continue
      const rgb = blockColor(name)
      if (!rgb) continue
      const packed = (rgb[0] << 16) | (rgb[1] << 8) | rgb[2]
      for (let i = 0; i < 256; i += 1) {
        if (colors[i] !== -1) continue
        colors[i] = packed
        heights[i] = section.y * 16 + 15
        remaining -= 1
      }
      continue
    }
    if (!section.values) continue
    for (let i = 0; i < 256; i += 1) {
      if (colors[i] !== -1) continue
      const x = i & 15
      const z = i >> 4
      for (let y = 15; y >= 0; y -= 1) {
        const index = readIndex(section.values, (y * 16 + z) * 16 + x, section.bits, section.per)
        const name = section.palette[index]
        if (!name || isAirBlock(name)) continue
        const rgb = blockColor(name)
        if (!rgb) continue
        colors[i] = (rgb[0] << 16) | (rgb[1] << 8) | rgb[2]
        heights[i] = section.y * 16 + y
        remaining -= 1
        break
      }
    }
  }
  return { colors, heights }
}

function readChunks(file) {
  const buf = fs.readFileSync(file)
  const out = []
  for (let index = 0; index < 1024; index += 1) {
    const offset = buf.readUIntBE(index * 4, 3) * 4096
    const sectors = buf.readUIntBE(index * 4 + 3, 1)
    if (!offset || !sectors) continue
    if (offset + 5 > buf.length) continue
    const length = buf.readUInt32BE(offset)
    if (!length || offset + 4 + length > buf.length) continue
    const compression = buf.readUInt8(offset + 4)
    const payload = buf.subarray(offset + 5, offset + 4 + length)
    let raw = payload
    try {
      if (compression === 2) raw = zlib.inflateSync(payload)
      else if (compression === 1) raw = zlib.gunzipSync(payload)
      else if (compression === 3) continue
    } catch {
      continue
    }
    try {
      const root = nbt.parse(raw)
      const status = root.value.find((item) => item.name === 'Status')
      const legacy = root.value.find((item) => item.name === 'Level')
      if (status && typeof status.value === 'string' && !String(status.value).endsWith('full')) continue
      out.push(legacy ? legacy.value : root.value)
    } catch {}
  }
  return out
}

function renderRegion({ file, scale, regionX, regionZ, palette }) {
  const slot = Math.floor(REGION_BLOCKS / scale)
  const rgb = Buffer.alloc(slot * slot * 4, 0)
  const heights = new Int16Array(slot * slot).fill(-1)
  const cells = Math.ceil(16 / scale)
  let chunks = 0
  for (const chunk of readChunks(file)) {
    const pick = (name) => chunk.find((item) => item.name === name)
    const cx = Number(pick('xPos')?.value ?? NaN)
    const cz = Number(pick('zPos')?.value ?? NaN)
    if (!Number.isFinite(cx) || !Number.isFinite(cz)) continue
    const cxi = cx - regionX * 32
    const czi = cz - regionZ * 32
    if (cxi < 0 || cxi > 31 || czi < 0 || czi > 31) continue
    const { colors, heights: chunkHeights } = chunkColumns({ value: chunk }, palette)
    chunks += 1
    const baseX = cxi * 16
    const baseZ = czi * 16
    const startCellX = Math.floor(baseX / scale)
    const startCellZ = Math.floor(baseZ / scale)
    for (let cell = 0; cell < cells; cell += 1) {
      const px = startCellX + cell
      if (px >= slot) break
      const blockX = Math.max(baseX, px * scale)
      const xIn = blockX - baseX
      if (xIn > 15) continue
      for (let cell2 = 0; cell2 < cells; cell2 += 1) {
        const pz = startCellZ + cell2
        if (pz >= slot) break
        const blockZ = Math.max(baseZ, pz * scale)
        const zIn = blockZ - baseZ
        if (zIn > 15) continue
        const col = zIn * 16 + xIn
        const packed = colors[col]
        const py = pz * slot + px
        if (packed === -1) continue
        const at = py * 4
        rgb[at] = (packed >> 16) & 255
        rgb[at + 1] = (packed >> 8) & 255
        rgb[at + 2] = packed & 255
        rgb[at + 3] = 255
        heights[py] = chunkHeights[col]
      }
    }
  }
  return { rgb, heights, chunks, slot }
}

function cropToContent(rgb, width, height) {
  let minX = width
  let minY = height
  let maxX = -1
  let maxY = -1
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (!rgb[(y * width + x) * 4 + 3]) continue
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }
  }
  if (maxX < 0) return { rgb, width, height, dx: 0, dy: 0 }
  const pad = 4
  minX = Math.max(0, minX - pad)
  minY = Math.max(0, minY - pad)
  maxX = Math.min(width - 1, maxX + pad)
  maxY = Math.min(height - 1, maxY + pad)
  const w = maxX - minX + 1
  const h = maxY - minY + 1
  if (w === width && h === height) return { rgb, width, height, dx: 0, dy: 0 }
  const out = Buffer.alloc(w * h * 4, 0)
  for (let y = 0; y < h; y += 1) {
    rgb.copy(out, y * w * 4, ((y + minY) * width + minX) * 4, ((y + minY) * width + minX + w) * 4)
  }
  return { rgb: out, width: w, height: h, dx: minX, dy: minY }
}

function applyShading(rgb, heights, width, height, scale) {
  const out = Buffer.from(rgb)
  const strength = 0.055 / Math.max(1, Math.sqrt(scale))
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x
      const h = heights[index]
      if (h < 0) continue
      const at = index * 4
      if (!rgb[at + 3]) continue
      const east = x + 1 < width ? heights[index + 1] : -1
      const west = x > 0 ? heights[index - 1] : -1
      const south = y + 1 < height ? heights[index + width] : -1
      const north = y > 0 ? heights[index - width] : -1
      const slopeX = (east >= 0 ? east : h) - (west >= 0 ? west : h)
      const slopeZ = (south >= 0 ? south : h) - (north >= 0 ? north : h)
      let factor = 1 - (slopeX + slopeZ) * strength
      factor = Math.max(0.72, Math.min(1.22, factor))
      if (factor === 1) continue
      out[at] = clampByte(rgb[at] * factor)
      out[at + 1] = clampByte(rgb[at + 1] * factor)
      out[at + 2] = clampByte(rgb[at + 2] * factor)
      out[at + 3] = 255
    }
  }
  return out
}

const clampByte = (value) => (value > 255 ? 255 : value < 0 ? 0 : Math.round(value))

const CRC_TABLE = (() => {
  const table = new Int32Array(256)
  for (let i = 0; i < 256; i += 1) {
    let c = i
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[i] = c
  }
  return table
})()

function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i += 1) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const head = Buffer.alloc(8)
  head.writeUInt32BE(data.length, 0)
  head.write(type, 4, 'ascii')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0)
  return Buffer.concat([head, data, crc])
}

function toPng(rgb, width, height) {
  const stride = width * 4
  const raw = Buffer.alloc((stride + 1) * height)
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0
    rgb.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride)
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  const idat = zlib.deflateSync(raw, { level: 6 })
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

function spawnWorker(surface) {
  return new Worker(WORKER, { workerData: { surface } })
}

function primeIndex(surface) {
  return new Promise((resolve) => {
    const worker = new Worker(WORKER, { workerData: { surface } })
    let finished = false
    const finish = () => {
      if (finished) return
      finished = true
      clearTimeout(timer)
      worker.terminate().catch(() => {})
      resolve()
    }
    const timer = setTimeout(finish, 120000)
    worker.on('message', (message) => {
      if (!message) return
      if (message.ready) {
        worker.postMessage({ prime: true })
        return
      }
      if (message.primed) finish()
    })
    worker.on('error', finish)
  })
}

async function renderMap({ dir, dimension = 'overworld', scale: requested, shading = true, trim = true, fresh = false, cacheDir, surface = null, onProgress, concurrency = 4 }) {
  setCancel(false)
  const sub = DIMS[dimension] || ''
  const regionDir = path.join(dir, ...(sub ? [sub] : []), 'region')
  const regions = await regionFiles(regionDir)
  if (!regions.length) return { ok: false, error: 'Thế giới này chưa có vùng nào được tạo (thư mục region trống).' }
  const grid = chunkGrid(regions)
  if (!Number.isFinite(grid.minCx)) return { ok: false, error: 'Không đọc được chunk nào trong thư mục region.' }
  const box = trim ? mainBox(grid.occupied) : null
  const minCx = box ? box.minCx : grid.minCx
  const maxCx = box ? box.maxCx : grid.maxCx
  const minCz = box ? box.minCz : grid.minCz
  const maxCz = box ? box.maxCz : grid.maxCz
  const spanChunks = Math.max(maxCx - minCx, maxCz - minCz) + 1
  const scale = requested && requested > 0
    ? Math.min(64, Math.max(1, Math.round(requested)))
    : (SCALES.find((value) => (spanChunks * 16) / value <= MAX_PX) || 64)
  const originX = minCx * 16
  const originZ = minCz * 16
  const width = Math.ceil(((maxCx + 1) * 16 - originX) / scale)
  const height = Math.ceil(((maxCz + 1) * 16 - originZ) / scale)
  if (width * height > 40_000_000) {
    return { ok: false, error: `Bản đồ quá lớn (${width}×${height}px). Hãy chọn tỉ lệ nhỏ hơn.` }
  }
  const sig = signature(regions)
  const origin = originKey(dir)
  const stamp = { origin, scale, width, height, originX, originZ, minCx, maxCx, minCz, maxCz, trim: !!trim }

  if (cacheDir && !fresh) {
    const cached = await readCache(cacheDir, dir, dimension, scale, sig, trim, surface?.jars?.length ? 'x' : 't')
    if (cached) return cached
  }

  const rgb = Buffer.alloc(width * height * 4, 0)
  const heights = new Int16Array(width * height).fill(-1)
  const slot = Math.ceil(REGION_BLOCKS / scale)
  let cursor = 0
  let done = 0
  let chunks = 0
  const jarCount = surface?.jars?.length || 0
  const workers = Math.max(1, Math.min(concurrency, regions.length))
  const started = Date.now()
  const jobs = regions.map((region, index) => ({ id: index, file: region.file, scale, regionX: region.x, regionZ: region.z }))
  let nextJob = 0
  let lastEmit = 0
  if (surface?.jars?.length) await primeIndex(surface)
  const pool = Array.from({ length: workers }, () => spawnWorker(surface))
  const blit = (message) => {
    const region = regions[message.id]
    const ox = Math.round((region.x * REGION_BLOCKS - originX) / scale)
    const oz = Math.round((region.z * REGION_BLOCKS - originZ) / scale)
    const source = Buffer.from(new Uint8Array(message.rgb))
    const hview = new Int16Array(message.heights)
    const fromX = Math.max(0, -ox)
    const toX = Math.min(slot, width - ox)
    const spanX = Math.max(0, toX - fromX)
    if (spanX) {
      const destX = ox + fromX
      for (let y = 0; y < slot; y += 1) {
        const ty = oz + y
        if (ty < 0 || ty >= height) continue
        const from = y * slot + fromX
        const dest = ty * width + destX
        source.copy(rgb, dest * 4, from * 4, (from + spanX) * 4)
        heights.set(hview.subarray(from, from + spanX), dest)
      }
    }
    chunks += message.chunks || 0
    done += 1
    const now = Date.now()
    if (onProgress && (now - lastEmit > 140 || done === regions.length)) {
      lastEmit = now
      onProgress({ done, total: regions.length, chunks, region: `${region.x},${region.z}` })
    }
  }
  await Promise.all(
    pool.map(
      (worker) =>
        new Promise((resolve) => {
          let ready = false
          const feed = () => {
            if (isCancelled() || nextJob >= jobs.length) {
              worker.postMessage({ quit: true })
              resolve()
              return
            }
            const job = jobs[nextJob]
            nextJob += 1
            worker.postMessage(job)
          }
          worker.on('message', (message) => {
            if (!message) return
            if (message.ready) {
              ready = true
              feed()
              return
            }
            if (message.done) return
            if (!ready) return
            if (message.failed) {
              done += 1
            } else {
              blit(message)
            }
            feed()
          })
          worker.on('error', () => {
            if (nextJob < jobs.length) feed()
            else resolve()
          })
        }),
    ),
  )
  await Promise.all(pool.map((worker) => worker.terminate().catch(() => {})))
  if (isCancelled()) return { ok: false, canceled: true }

  const shaded = shading ? applyShading(rgb, heights, width, height, scale) : rgb
  const cropped = cropToContent(shaded, width, height)
  const finalWidth = cropped.width
  const finalHeight = cropped.height
  const originXFinal = originX + cropped.dx * scale
  const originZFinal = originZ + cropped.dy * scale
  const png = toPng(cropped.rgb, finalWidth, finalHeight)
  let file = ''
  if (cacheDir) {
    await fsp.mkdir(cacheDir, { recursive: true }).catch(() => {})
    file = path.join(cacheDir, `${cacheName(dir, dimension, scale, sig, trim, surface?.jars?.length ? 'x' : 't')}.png`)
    await fsp.writeFile(file, png).catch(() => {})
    await fsp.writeFile(file.replace(/\.png$/, '.json'), JSON.stringify({ ...stamp, width: finalWidth, height: finalHeight, originX: originXFinal, originZ: originZFinal, dimension, chunks, regions: regions.length, shaded: !!shading, sig, bytes: png.length, mtime: Date.now() }), 'utf8').catch(() => {})
  }
  return {
    ok: true,
    cached: false,
    file,
    url: file ? `lsmap://m/${path.basename(file)}` : '',
    meta: {
      ...stamp,
      width: finalWidth,
      height: finalHeight,
      originX: originXFinal,
      originZ: originZFinal,
      chunks,
      regions: regions.length,
      shaded: !!shading,
      bytes: png.length,
      ms: Date.now() - started,
      dimension,
    },
  }
}

const safeName = (value) => String(value).replace(/[^A-Za-z0-9._-]+/g, '_').slice(-60)
const cacheName = (dir, dimension, scale, sig, trim, style = 'x') => `map__${safeName(path.basename(dir))}__${originKey(dir)}__${dimension}__s${scale}__${sig}${trim ? '' : '_full'}_v5${style}`

function pngIsSound(buffer) {
  if (!buffer || buffer.length < 60) return false
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
  for (let i = 0; i < signature.length; i += 1) if (buffer[i] !== signature[i]) return false
  const width = buffer.readUInt32BE(16)
  const height = buffer.readUInt32BE(20)
  const type = buffer[25]
  const idat = buffer.readUInt32BE(33)
  if (!width || !height || (type !== 2 && type !== 6)) return false
  try {
    const raw = zlib.inflateSync(buffer.subarray(41, 41 + idat))
    return raw.length === (width * (type === 6 ? 4 : 3) + 1) * height
  } catch {
    return false
  }
}

async function readCache(cacheDir, dir, dimension, scale, sig, trim, style = 'x') {
  const file = path.join(cacheDir, `${cacheName(dir, dimension, scale, sig, trim, style)}.png`)
  const stat = await fsp.stat(file).catch(() => null)
  if (!stat?.isFile()) return null
  const payload = await fsp.readFile(file).catch(() => null)
  if (!pngIsSound(payload)) return null
  const raw = await fsp.readFile(file.replace(/\.png$/, '.json'), 'utf8').catch(() => '')
  let meta = {}
  try {
    meta = raw ? JSON.parse(raw) : {}
  } catch {
    meta = {}
  }
  return {
    ok: true,
    cached: true,
    file,
    url: `lsmap://m/${path.basename(file)}`,
    meta: { ...meta, dimension, scale, bytes: stat.size },
  }
}

async function clearCache({ dir, cacheDir, all = false }) {
  if (!cacheDir) return { ok: false, error: 'Không có thư mục bộ đệm.' }
  const list = await fsp.readdir(cacheDir).catch(() => [])
  const origin = dir ? originKey(dir) : ''
  let removed = 0
  for (const name of list) {
    if (!name.startsWith('map__')) continue
    if (!all && origin && !name.includes(`__${origin}__`)) continue
    await fsp.unlink(path.join(cacheDir, name)).catch(() => {})
    removed += 1
  }
  return { ok: true, removed }
}

async function mapInfo({ dir, cacheDir }) {
  const dims = {}
  for (const dimension of Object.keys(DIMS)) {
    const sub = DIMS[dimension]
    const regionDir = path.join(dir, ...(sub ? [sub] : []), 'region')
    const regions = await regionFiles(regionDir)
    if (!regions.length) continue
    const grid = chunkGrid(regions)
    if (!Number.isFinite(grid.minCx)) continue
    const spanChunks = Math.max(grid.maxCx - grid.minCx, grid.maxCz - grid.minCz) + 1
    const autoScale = SCALES.find((value) => (spanChunks * 16) / value <= MAX_PX) || 64
    dims[dimension] = {
      regions: regions.length,
      blocks: {
        minX: grid.minCx * 16,
        minZ: grid.minCz * 16,
        maxX: (grid.maxCx + 1) * 16,
        maxZ: (grid.maxCz + 1) * 16,
      },
      autoScale,
      autoWidth: Math.ceil(((grid.maxCx + 1) * 16 - grid.minCx * 16) / autoScale),
    }
  }
  const cached = []
  if (cacheDir) {
    const origin = originKey(dir)
    const list = await fsp.readdir(cacheDir).catch(() => [])
    for (const name of list.filter((item) => item.endsWith('.json') && item.startsWith('map__'))) {
      const raw = await fsp.readFile(path.join(cacheDir, name), 'utf8').catch(() => '')
      try {
        const meta = JSON.parse(raw)
        if (meta?.origin !== origin) continue
        const png = await fsp.stat(path.join(cacheDir, name.replace(/\.json$/, '.png'))).catch(() => null)
        if (!png?.isFile()) continue
        cached.push({ ...meta, bytes: meta.bytes || png?.size || 0, name: name.replace(/\.json$/, '') })
      } catch {}
    }
  }
  return { ok: true, dims, cached: cached.sort((a, b) => (b.mtime || 0) - (a.mtime || 0)).slice(0, 12) }
}

module.exports = { renderMap, mapInfo, clearCache, primeIndex, setCancel, isCancelled, regionFiles, bboxOf, pickScale, renderRegion, toPng, pngIsSound, DIMS, REGION_BLOCKS }
