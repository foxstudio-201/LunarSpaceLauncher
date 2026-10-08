const fs = require('fs')
const fsp = fs.promises
const zlib = require('zlib')

const TAG = {
  end: 0,
  byte: 1,
  short: 2,
  int: 3,
  long: 4,
  float: 5,
  double: 6,
  byteArray: 7,
  string: 8,
  list: 9,
  compound: 10,
  intArray: 11,
  longArray: 12,
}

const NAMES = Object.fromEntries(Object.entries(TAG).map(([key, value]) => [value, key]))

const NESTED = new Set(['list', 'compound'])
const NUMERIC_ARRAY = new Set(['byteArray', 'intArray', 'longArray'])

const isGzip = (buffer) => buffer.length > 2 && buffer[0] === 0x1f && buffer[1] === 0x8b

function parser(buffer) {
  let offset = 0
  const byte = () => buffer.readInt8(offset++)
  const ubyte = () => buffer.readUInt8(offset++)
  const short = () => {
    const value = buffer.readInt16BE(offset)
    offset += 2
    return value
  }
  const ushort = () => {
    const value = buffer.readUInt16BE(offset)
    offset += 2
    return value
  }
  const int = () => {
    const value = buffer.readInt32BE(offset)
    offset += 4
    return value
  }
  const long = () => {
    const value = buffer.readBigInt64BE(offset)
    offset += 8
    return value.toString()
  }
  const float = () => {
    const value = buffer.readFloatBE(offset)
    offset += 4
    return value
  }
  const double = () => {
    const value = buffer.readDoubleBE(offset)
    offset += 8
    return value
  }
  const text = () => {
    const size = ushort()
    const value = size ? buffer.toString('utf8', offset, offset + size) : ''
    offset += size
    return value
  }

  const payload = (type) => {
    switch (type) {
      case TAG.byte:
        return byte()
      case TAG.short:
        return short()
      case TAG.int:
        return int()
      case TAG.long:
        return long()
      case TAG.float:
        return float()
      case TAG.double:
        return double()
      case TAG.byteArray: {
        const size = int()
        const out = []
        for (let i = 0; i < size; i += 1) out.push(byte())
        return out
      }
      case TAG.string:
        return text()
      case TAG.list: {
        const itemType = ubyte()
        const size = int()
        const out = []
        for (let i = 0; i < size; i += 1) out.push({ type: NAMES[itemType], name: '', value: payload(itemType) })
        return out
      }
      case TAG.compound: {
        const out = []
        for (;;) {
          const childType = ubyte()
          if (childType === TAG.end) break
          const name = text()
          out.push({ type: NAMES[childType], name, value: payload(childType) })
        }
        return out
      }
      case TAG.intArray: {
        const size = int()
        const out = []
        for (let i = 0; i < size; i += 1) out.push(int())
        return out
      }
      case TAG.longArray: {
        const size = int()
        const out = []
        for (let i = 0; i < size; i += 1) out.push(long())
        return out
      }
      default:
        throw new Error(`Tag không hỗ trợ: ${type}`)
    }
  }

  const type = ubyte()
  if (type !== TAG.compound) throw new Error('Tệp NBT không bắt đầu bằng compound.')
  const name = text()
  return { type: 'compound', name, value: payload(TAG.compound) }
}

function writer() {
  const chunks = []
  const push = (buffer) => chunks.push(buffer)
  const ubyte = (value) => push(Buffer.from([value & 0xff]))
  const short = (value) => {
    const buffer = Buffer.alloc(2)
    buffer.writeInt16BE(value)
    push(buffer)
  }
  const ushort = (value) => {
    const buffer = Buffer.alloc(2)
    buffer.writeUInt16BE(value)
    push(buffer)
  }
  const int = (value) => {
    const buffer = Buffer.alloc(4)
    buffer.writeInt32BE(value)
    push(buffer)
  }
  const long = (value) => {
    const buffer = Buffer.alloc(8)
    let big = 0n
    try {
      big = BigInt(typeof value === 'string' ? value.trim() || '0' : Math.trunc(Number(value)))
    } catch {
      big = 0n
    }
    buffer.writeBigInt64BE(big)
    push(buffer)
  }
  const float = (value) => {
    const buffer = Buffer.alloc(4)
    buffer.writeFloatBE(Number(value) || 0)
    push(buffer)
  }
  const double = (value) => {
    const buffer = Buffer.alloc(8)
    buffer.writeDoubleBE(Number(value) || 0)
    push(buffer)
  }
  const text = (value) => {
    const string = String(value ?? '')
    const buffer = Buffer.from(string, 'utf8')
    ushort(buffer.length)
    push(buffer)
  }
  const payload = (type, value) => {
    switch (type) {
      case 'byte':
        return ubyte(Number(value) || 0)
      case 'short':
        return short(Number(value) || 0)
      case 'int':
        return int(Number(value) || 0)
      case 'long':
        return long(value)
      case 'float':
        return float(value)
      case 'double':
        return double(value)
      case 'string':
        return text(value)
      case 'byteArray': {
        const list = Array.isArray(value) ? value : []
        int(list.length)
        for (const item of list) ubyte(Number(item) || 0)
        return undefined
      }
      case 'intArray': {
        const list = Array.isArray(value) ? value : []
        int(list.length)
        for (const item of list) int(Number(item) || 0)
        return undefined
      }
      case 'longArray': {
        const list = Array.isArray(value) ? value : []
        int(list.length)
        for (const item of list) long(item)
        return undefined
      }
      case 'list': {
        const list = Array.isArray(value) ? value : []
        const itemType = list.length ? TAG[list[0].type] : TAG.end
        ubyte(itemType)
        int(list.length)
        for (const item of list) payload(item.type, item.value)
        return undefined
      }
      case 'compound': {
        const list = Array.isArray(value) ? value : []
        for (const item of list) {
          ubyte(TAG[item.type])
          text(item.name)
          payload(item.type, item.value)
        }
        ubyte(TAG.end)
        return undefined
      }
      default:
        throw new Error(`Tag không hỗ trợ: ${type}`)
    }
  }
  return {
    root(node) {
      ubyte(TAG.compound)
      text(node.name || '')
      payload('compound', node.value || [])
      return Buffer.concat(chunks)
    },
  }
}

const parse = (buffer) => parser(isGzip(buffer) ? zlib.gunzipSync(buffer) : buffer)

const serialize = (root) => writer().root(root)

async function readFile(file) {
  const raw = await fsp.readFile(file)
  return parse(raw)
}

async function writeFile(file, root, { gzip = true, backup = true } = {}) {
  const rootNode = { type: 'compound', name: '', value: Array.isArray(root) ? root : root.value || [] }
  const body = serialize(rootNode)
  const out = gzip ? zlib.gzipSync(body, { level: 6 }) : body
  if (backup) {
    const exists = await fsp.stat(file).then(() => true).catch(() => false)
    if (exists) await fsp.copyFile(file, `${file}.bak`).catch(() => {})
  }
  await fsp.writeFile(file, out)
  return { bytes: out.length }
}

const typeNames = NAMES

module.exports = { TAG, typeNames, parse, serialize, readFile, writeFile, isGzip, NESTED, NUMERIC_ARRAY }
