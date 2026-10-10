const zlib = require('zlib')

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

const paeth = (a, b, c) => {
  const p = a + b - c
  const pa = Math.abs(p - a)
  const pb = Math.abs(p - b)
  const pc = Math.abs(p - c)
  if (pa <= pb && pa <= pc) return a
  return pb <= pc ? b : c
}

function unfilter(raw, width, height, bytesPerPixel, bytesPerRow) {
  const out = Buffer.alloc(height * bytesPerRow)
  let offset = 0
  for (let y = 0; y < height; y += 1) {
    const filter = raw[offset]
    offset += 1
    const line = raw.subarray(offset, offset + bytesPerRow)
    offset += bytesPerRow
    const target = out.subarray(y * bytesPerRow, (y + 1) * bytesPerRow)
    const prev = y ? out.subarray((y - 1) * bytesPerRow, y * bytesPerRow) : null
    for (let x = 0; x < bytesPerRow; x += 1) {
      const rawByte = line[x]
      const left = x >= bytesPerPixel ? target[x - bytesPerPixel] : 0
      const up = prev ? prev[x] : 0
      const upLeft = prev && x >= bytesPerPixel ? prev[x - bytesPerPixel] : 0
      let value
      switch (filter) {
        case 0:
          value = rawByte
          break
        case 1:
          value = rawByte + left
          break
        case 2:
          value = rawByte + up
          break
        case 3:
          value = rawByte + ((left + up) >> 1)
          break
        case 4:
          value = rawByte + paeth(left, up, upLeft)
          break
        default:
          value = rawByte
      }
      target[x] = value & 0xff
    }
  }
  return out
}

const scaleSample = (value, depth) => {
  if (depth === 8) return value
  if (depth === 16) return value
  const max = (1 << depth) - 1
  return Math.round((value * 255) / max)
}

function decode(buffer) {
  if (!buffer || buffer.length < 70) return null
  for (let i = 0; i < 8; i += 1) if (buffer[i] !== SIGNATURE[i]) return null
  let offset = 8
  let width = 0
  let height = 0
  let depth = 8
  let colorType = 6
  let interlace = 0
  let palette = null
  let transparency = null
  const idat = []
  while (offset + 8 <= buffer.length) {
    const length = buffer.readUInt32BE(offset)
    const type = buffer.toString('ascii', offset + 4, offset + 8)
    const data = buffer.subarray(offset + 8, offset + 8 + length)
    if (type === 'IHDR') {
      width = data.readUInt32BE(0)
      height = data.readUInt32BE(4)
      depth = data[8]
      colorType = data[9]
      interlace = data[12]
    } else if (type === 'PLTE') {
      palette = Buffer.from(data)
    } else if (type === 'tRNS') {
      transparency = Buffer.from(data)
    } else if (type === 'IDAT') {
      idat.push(Buffer.from(data))
    } else if (type === 'IEND') {
      break
    }
    offset += 12 + length
    if (!width || !height) continue
  }
  if (!width || !height || interlace !== 0) return null
  const channels = colorType === 2 ? 3 : colorType === 6 ? 4 : colorType === 4 ? 2 : 1
  const bitsPerPixel = channels * depth
  const bytesPerPixel = Math.max(1, Math.ceil(bitsPerPixel / 8))
  const bytesPerRow = Math.ceil((width * bitsPerPixel) / 8)
  let inflated
  try {
    inflated = zlib.inflateSync(Buffer.concat(idat))
  } catch {
    return null
  }
  if (inflated.length < (bytesPerRow + 1) * height) return null
  const pixels = unfilter(inflated, width, height, bytesPerPixel, bytesPerRow)
  const out = Buffer.alloc(width * height * 4)
  const readChannel = (row, index) => {
    if (depth === 8) return row[index]
    if (depth === 16) return row[index * 2]
    const perByte = 8 / depth
    const byte = row[Math.floor(index / perByte)]
    const shift = 8 - depth * ((index % perByte) + 1)
    return (byte >> shift) & ((1 << depth) - 1)
  }
  for (let y = 0; y < height; y += 1) {
    const row = pixels.subarray(y * bytesPerRow, (y + 1) * bytesPerRow)
    for (let x = 0; x < width; x += 1) {
      const at = (y * width + x) * 4
      if (colorType === 3) {
        const index = readChannel(row, x)
        const p = index * 3
        out[at] = palette && p + 2 < palette.length ? palette[p] : 0
        out[at + 1] = palette && p + 2 < palette.length ? palette[p + 1] : 0
        out[at + 2] = palette && p + 2 < palette.length ? palette[p + 2] : 0
        out[at + 3] = transparency && index < transparency.length ? transparency[index] : 255
        continue
      }
      if (colorType === 6 || colorType === 2) {
        const base = x * channels
        out[at] = scaleSample(readChannel(row, base), depth)
        out[at + 1] = scaleSample(readChannel(row, base + 1), depth)
        out[at + 2] = scaleSample(readChannel(row, base + 2), depth)
        out[at + 3] = colorType === 6 ? scaleSample(readChannel(row, base + 3), depth) : 255
        continue
      }
      const grey = scaleSample(readChannel(row, x * channels), depth)
      out[at] = grey
      out[at + 1] = grey
      out[at + 2] = grey
      out[at + 3] = colorType === 4 ? scaleSample(readChannel(row, x * channels + 1), depth) : 255
    }
  }
  return { width, height, data: out }
}

function average(buffer) {
  const image = decode(buffer)
  if (!image) return null
  let r = 0
  let g = 0
  let b = 0
  let weight = 0
  let opaque = 0
  const total = image.width * image.height
  for (let i = 0; i < total; i += 1) {
    const alpha = image.data[i * 4 + 3]
    if (alpha < 16) continue
    if (alpha > 200) opaque += 1
    const factor = alpha / 255
    r += image.data[i * 4] * factor
    g += image.data[i * 4 + 1] * factor
    b += image.data[i * 4 + 2] * factor
    weight += factor
  }
  if (!weight) return null
  return {
    rgb: [Math.round(r / weight), Math.round(g / weight), Math.round(b / weight)],
    coverage: opaque / total,
  }
}

module.exports = { decode, average }
