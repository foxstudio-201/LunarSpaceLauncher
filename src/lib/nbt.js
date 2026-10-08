export const TYPE_TONE = {
  byte: '#22d3ee',
  short: '#2dd4bf',
  int: '#60a5fa',
  long: '#818cf8',
  float: '#fbbf24',
  double: '#fb923c',
  string: '#4ade80',
  list: '#a78bfa',
  compound: '#f472b6',
  byteArray: '#94a3b8',
  intArray: '#94a3b8',
  longArray: '#94a3b8',
}

const LABELS = {
  byte: 'Byte',
  short: 'Short',
  int: 'Int',
  long: 'Long',
  float: 'Float',
  double: 'Double',
  string: 'String',
  list: 'List',
  compound: 'Compound',
  byteArray: 'Byte[]',
  intArray: 'Int[]',
  longArray: 'Long[]',
}

export const PRIMITIVES = ['byte', 'short', 'int', 'long', 'float', 'double', 'string']
export const NUMERIC = ['byte', 'short', 'int', 'long', 'float', 'double']
export const INTEGERS = ['byte', 'short', 'int', 'long']
export const ARRAYS = ['byteArray', 'intArray', 'longArray']
export const CONTAINERS = ['compound', 'list']
export const ALL_TYPES = [...PRIMITIVES, ...CONTAINERS, ...ARRAYS]

export const ARRAY_ELEMENT = { byteArray: 'byte', intArray: 'int', longArray: 'long' }

export const typeLabel = (type) => LABELS[type] || type
export const num = (value) => Number(value) || 0
export const clamp = (value, lo, hi) => Math.max(lo, Math.min(hi, value))
export const isNumericType = (type) => NUMERIC.includes(type)
export const isContainer = (type) => CONTAINERS.includes(type)
export const isArrayType = (type) => ARRAYS.includes(type)

export function parseNumber(raw) {
  const text = String(raw ?? '').trim()
  if (!text) return 0
  const sign = text.startsWith('-') ? -1 : 1
  const body = text.replace(/^[+-]/, '')
  if (/^0[xX][0-9a-fA-F]+$/.test(body)) return sign * parseInt(body.slice(2), 16)
  if (/^0[bB][01]+$/.test(body)) return sign * parseInt(body.slice(2), 2)
  if (/^0[oO][0-7]+$/.test(body)) return sign * parseInt(body.slice(2), 8)
  return sign * Number(body)
}

function intValue(type, raw) {
  const n = Math.trunc(parseNumber(raw))
  if (!Number.isFinite(n)) return 0
  if (type === 'byte') {
    if (n > 127 && n <= 255) return n - 256
    return clamp(n, -128, 127)
  }
  if (type === 'short') {
    if (n > 32767 && n <= 65535) return n - 65536
    return clamp(n, -32768, 32767)
  }
  return clamp(n, -2147483648, 2147483647)
}

export function longValue(raw) {
  const text = String(raw ?? '0').trim().replace(/[lL]$/, '')
  if (!text) return '0'
  const sign = text.startsWith('-') ? -1n : 1n
  const body = text.replace(/^[+-]/, '')
  try {
    if (/^0[xX][0-9a-fA-F]+$/.test(body)) return (sign * BigInt(`0x${body.slice(2)}`)).toString()
    if (/^0[bB][01]+$/.test(body)) return (sign * BigInt(`0b${body.slice(2)}`)).toString()
    if (/^0[oO][0-7]+$/.test(body)) return (sign * BigInt(`0o${body.slice(2)}`)).toString()
    return (sign * BigInt(body)).toString()
  } catch {
    return '0'
  }
}

export function coerceScalar(type, raw) {
  if (type === 'string') return String(raw ?? '')
  if (type === 'long') return longValue(raw)
  if (type === 'float' || type === 'double') {
    const n = parseNumber(raw)
    return Number.isFinite(n) ? n : 0
  }
  if (INTEGERS.includes(type)) return intValue(type, raw)
  return raw
}

export function defaultFor(type) {
  if (type === 'string') return ''
  if (isContainer(type) || isArrayType(type)) return []
  if (type === 'long') return '0'
  return 0
}

export const newTag = (type, name = '', value) => ({
  type,
  name,
  value: value === undefined ? defaultFor(type) : value,
})

export function cloneNode(node) {
  if (!node) return null
  return {
    type: node.type,
    name: node.name,
    value: isContainer(node.type) || isArrayType(node.type)
      ? node.value.map((item) => (typeof item === 'object' ? cloneNode(item) : item))
      : node.value,
  }
}

export function valueText(type, value) {
  if (isContainer(type) || isArrayType(type)) return snbtCompact({ type, name: '', value })
  return String(value ?? '')
}

export function convertValue(from, to, value) {
  if (from === to) return value
  if (to === 'string') return valueText(from, value)
  if (from === 'string') {
    if (to === 'compound' || to === 'list') return []
    if (isArrayType(to)) return [coerceScalar(ARRAY_ELEMENT[to], value)]
    return coerceScalar(to, value)
  }
  if (from === 'compound') {
    if (to === 'list') return value.map((item) => cloneNode(item))
    return defaultFor(to)
  }
  if (from === 'list') {
    if (to === 'compound') return value.map((item) => cloneNode(item))
    if (to === 'string') return value.map((item) => valueText(item.type, item.value)).join(', ')
    if (isArrayType(to)) return value.filter((item) => !isContainer(item.type)).map((item) => coerceScalar(ARRAY_ELEMENT[to], item.value))
    if (PRIMITIVES.includes(to)) {
      const first = value.find((item) => !isContainer(item.type))
      return coerceScalar(to, first ? first.value : '')
    }
    return defaultFor(to)
  }
  if (isArrayType(from)) {
    if (to === 'string') return value.join(', ')
    if (to === 'list') return value.map((item) => newTag(ARRAY_ELEMENT[from], '', coerceScalar(ARRAY_ELEMENT[from], item)))
    if (isArrayType(to)) return value.map((item) => coerceScalar(ARRAY_ELEMENT[to], item))
    if (NUMERIC.includes(to)) return coerceScalar(to, value[0] ?? 0)
    return defaultFor(to)
  }
  if (to === 'list') return [newTag(from, '', coerceScalar(from, value))]
  if (isArrayType(to)) return [coerceScalar(ARRAY_ELEMENT[to], value)]
  if (to === 'compound') return [newTag(from, 'value', coerceScalar(from, value))]
  return coerceScalar(to, value)
}

export const convertNode = (node, to) => ({ type: to, name: node.name, value: convertValue(node.type, to, node.value) })

export function walk(tree, path) {
  if (!tree) return null
  if (!path) return tree
  let node = tree
  for (const segment of String(path).split('|')) {
    if (!node || !Array.isArray(node.value)) return null
    if (segment.startsWith('#')) node = node.value[Number(segment.slice(1))]
    else node = node.value.find((item) => item && item.name === segment)
    if (!node) return null
  }
  return node
}

export const stepPath = (path, segment) => (path ? `${path}|${segment}` : segment)

export function parentOf(path) {
  const index = String(path).lastIndexOf('|')
  return index === -1 ? '' : String(path).slice(0, index)
}

export function labelOf(path, node) {
  const segment = String(path).split('|').pop() || ''
  if (segment.startsWith('#')) return `[${segment.slice(1)}]`
  return node?.name || segment
}

export function countOf(node) {
  if (!node || !Array.isArray(node.value)) return 0
  return node.value.length
}

export function summaryOf(node) {
  if (!node || !Array.isArray(node.value)) return String(node?.value ?? '')
  if (node.type === 'list') return `${node.value.length}`
  if (node.type === 'compound') return `${node.value.length}`
  if (isArrayType(node.type)) return `${node.value.length}`
  return ''
}

export function childIndexOf(path, parent) {
  const segment = String(path).split('|').pop() || ''
  if (segment.startsWith('#')) return Number(segment.slice(1))
  return Array.isArray(parent?.value) ? parent.value.findIndex((item) => item.name === segment) : -1
}

export function pathOf(parentPath, parent, index) {
  if (parent?.type === 'list') return stepPath(parentPath, `#${index}`)
  return stepPath(parentPath, parent.value[index].name)
}

function pathStack(target) {
  const segments = String(target).split('|')
  const chain = ['']
  let acc = ''
  for (const segment of segments) {
    acc = acc ? `${acc}|${segment}` : segment
    chain.push(acc)
  }
  return chain
}

export const expandChain = (target) => pathStack(target)

export function ensureChild(base, key, type) {
  if (!base && key === undefined) return base
  return stepPath(base, key)
}

const quote = (value) =>
  `"${String(value ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t')}"`

const NON_FINITE = (value) => {
  const n = Number(value)
  if (Number.isFinite(n)) return ''
  if (Number.isNaN(n)) return 'NaN'
  return n > 0 ? 'Infinity' : '-Infinity'
}

const floatText = (value) => {
  const special = NON_FINITE(value)
  if (special) return special
  const text = String(Number(value))
  if (text.includes('e') || text.includes('E') || text.includes('.')) return text
  return `${text}.0`
}

export function snbtValue(node) {
  switch (node.type) {
    case 'byte':
      return `${Math.trunc(num(node.value))}b`
    case 'short':
      return `${Math.trunc(num(node.value))}s`
    case 'int':
      return `${Math.trunc(num(node.value))}`
    case 'long':
      return `${String(node.value ?? '0').replace(/[lL]$/, '')}L`
    case 'float':
      return NON_FINITE(node.value) ? NON_FINITE(node.value) : `${floatText(node.value)}f`
    case 'double':
      return NON_FINITE(node.value) ? NON_FINITE(node.value) : `${floatText(node.value)}d`
    case 'string':
      return quote(node.value)
    case 'byteArray':
      return `[B;${(node.value || []).map((item) => `${Math.trunc(num(item))}b`).join(',')}]`
    case 'intArray':
      return `[I;${(node.value || []).map((item) => `${Math.trunc(num(item))}`).join(',')}]`
    case 'longArray':
      return `[L;${(node.value || []).map((item) => `${String(item ?? '0').replace(/[lL]$/, '')}L`).join(',')}]`
    case 'list':
      return `[${(node.value || []).map((item) => snbtValue(item)).join(',')}]`
    case 'compound':
      return `{${(node.value || []).map((item) => `${quote(item.name)}:${snbtValue(item)}`).join(',')}}`
    default:
      return String(node.value ?? '')
  }
}

export const snbtCompact = (node) => snbtValue(node)

export function snbtPretty(node, level = 0) {
  const pad = '  '.repeat(level)
  const padIn = '  '.repeat(level + 1)
  if (node.type === 'compound') {
    if (!node.value.length) return '{}'
    const body = node.value.map((item) => `${padIn}${quote(item.name)}: ${snbtPretty(item, level + 1)}`).join(',\n')
    return `{\n${body}\n${pad}}`
  }
  if (node.type === 'list') {
    if (!node.value.length) return '[]'
    const body = node.value.map((item) => `${padIn}${snbtPretty(item, level + 1)}`).join(',\n')
    return `[\n${body}\n${pad}]`
  }
  return snbtValue(node)
}

export function snbtDocument(root) {
  if (!root) return ''
  if (root.type === 'compound') {
    return `{\n${root.value.map((item) => `  ${quote(item.name)}: ${snbtPretty(item, 1)}`).join(',\n')}\n}`
  }
  return snbtPretty(root, 0)
}

function tokenize(source) {
  const tokens = []
  let i = 0
  const text = String(source ?? '')
  while (i < text.length) {
    const ch = text[i]
    if (ch === ' ' || ch === '\n' || ch === '\r' || ch === '\t') {
      i += 1
      continue
    }
    if ('{}[]:;,'.includes(ch)) {
      tokens.push({ kind: ch })
      i += 1
      continue
    }
    if (ch === '"' || ch === "'") {
      let j = i + 1
      let out = ''
      while (j < text.length && text[j] !== ch) {
        if (text[j] === '\\' && j + 1 < text.length) {
          const next = text[j + 1]
          out += next === 'n' ? '\n' : next === 't' ? '\t' : next === 'r' ? '\r' : next
          j += 2
          continue
        }
        out += text[j]
        j += 1
      }
      if (j >= text.length) throw new Error('Chuỗi chưa đóng nháy.')
      tokens.push({ kind: 'string', text: out })
      i = j + 1
      continue
    }
    let j = i
    while (j < text.length && !'{}[]:;,"\' \n\r\t'.includes(text[j])) j += 1
    tokens.push({ kind: 'word', text: text.slice(i, j) })
    i = j
  }
  return tokens
}

function wordNode(raw) {
  const text = String(raw)
  if (/^(true|false)$/i.test(text)) return newTag('byte', '', /^true$/i.test(text) ? 1 : 0)
  if (/^[-+]?(nan|infinity)$/i.test(text)) {
    const negative = text.startsWith('-')
    if (/nan$/i.test(text)) return newTag('double', '', NaN)
    return newTag('double', '', negative ? -Infinity : Infinity)
  }
  if (/^[+-]?[0-9]+[bB]$/.test(text)) return newTag('byte', '', intValue('byte', text.slice(0, -1)))
  if (/^[+-]?[0-9]+[sS]$/.test(text)) return newTag('short', '', intValue('short', text.slice(0, -1)))
  if (/^[+-]?[0-9]+[lL]$/.test(text)) return newTag('long', '', longValue(text.slice(0, -1)))
  if (/^[+-]?[0-9.]*[0-9][eE]?[+-]?[0-9]*[fF]$/.test(text)) return newTag('float', '', coerceScalar('float', text.slice(0, -1)))
  if (/^[+-]?[0-9.]*[0-9][eE]?[+-]?[0-9]*[dD]$/.test(text)) return newTag('double', '', coerceScalar('double', text.slice(0, -1)))
  if (/^0[xX][0-9a-fA-F]+$/.test(text) || /^0[bB][01]+$/.test(text)) return newTag('int', '', intValue('int', text))
  if (/^[+-]?[0-9]+$/.test(text)) return newTag('int', '', intValue('int', text))
  if (/^[+-]?([0-9]*\.[0-9]+|[0-9]+\.[0-9]*|[0-9]+[eE][+-]?[0-9]+)$/.test(text)) return newTag('double', '', coerceScalar('double', text))
  return newTag('string', '', text)
}

function parseTokens(tokens) {
  let at = 0
  const peek = () => tokens[at]
  const take = () => tokens[at++]
  const expect = (kind) => {
    const token = take()
    if (!token || token.kind !== kind) throw new Error(`Cần “${kind}” trong SNBT.`)
    return token
  }

  const parseValue = () => {
    const token = peek()
    if (!token) throw new Error('SNBT thiếu giá trị.')
    if (token.kind === '{') return parseCompound()
    if (token.kind === '[') return parseCollection()
    if (token.kind === 'string') {
      take()
      return newTag('string', '', token.text)
    }
    if (token.kind === 'word') {
      take()
      return wordNode(token.text)
    }
    throw new Error(`SNBT gặp ký tự lạ “${token.kind}”.`)
  }

  const parseCompound = () => {
    expect('{')
    const value = []
    if (peek() && peek().kind === '}') {
      take()
      return newTag('compound', '', value)
    }
    for (;;) {
      const token = peek()
      if (!token) throw new Error('Compound chưa đóng ngoặc.')
      let name = ''
      if (token.kind === 'string' || token.kind === 'word') {
        const after = tokens[at + 1]
        if (after && after.kind === ':') {
          name = token.text
          at += 2
        }
      }
      const node = parseValue()
      value.push({ type: node.type, name, value: node.value })
      const sep = peek()
      if (sep && sep.kind === ',') {
        take()
        continue
      }
      expect('}')
      break
    }
    return newTag('compound', '', value)
  }

  const parseCollection = () => {
    expect('[')
    const first = peek()
    if (first && first.kind === ']') {
      take()
      return newTag('list', '', [])
    }
    if (first && first.kind === 'word' && /^[BIL]$/.test(first.text)) {
      const marker = first.text
      const after = tokens[at + 1]
      if (after && after.kind === ';') {
        at += 2
        const type = marker === 'B' ? 'byteArray' : marker === 'I' ? 'intArray' : 'longArray'
        const element = ARRAY_ELEMENT[type]
        const value = []
        for (;;) {
          const token = take()
          if (!token) throw new Error('Mảng chưa đóng ngoặc.')
          if (token.kind === ']') break
          if (token.kind === ',') continue
          if (token.kind !== 'word' && token.kind !== 'string') throw new Error('Phần tử mảng không hợp lệ.')
          value.push(coerceScalar(element, token.text.replace(/[bBsSlL]$/, '')))
        }
        return newTag(type, '', value)
      }
    }
    const items = []
    let elementType = ''
    for (;;) {
      const node = parseValue()
      if (!elementType) elementType = node.type
      items.push({ type: node.type, name: '', value: node.value })
      const sep = peek()
      if (sep && sep.kind === ',') {
        take()
        continue
      }
      expect(']')
      break
    }
    const mismatched = items.find((item) => item.type !== elementType)
    if (mismatched) {
      if (!PRIMITIVES.includes(elementType) || !PRIMITIVES.includes(mismatched.type)) {
        throw new Error('List NBT chỉ chứa một kiểu tag.')
      }
      for (const item of items) {
        if (item.type !== elementType) {
          const converted = convertValue(item.type, elementType, item.value)
          item.type = elementType
          item.value = converted
        }
      }
    }
    return newTag('list', '', items)
  }

  const token = peek()
  if (!token) throw new Error('SNBT rỗng.')
  if (token.kind === '{') return parseCompound()
  if (token.kind === '[') return parseCollection()
  if (token.kind === 'word' || token.kind === 'string') return wordNode(token.text)
  throw new Error('SNBT phải bắt đầu bằng compound “{”.')
}

export function snbtParse(source) {
  const root = parseTokens(tokenize(source))
  if (root.type !== 'compound') throw new Error('Tệp NBT phải là compound ở gốc.')
  root.name = ''
  return root
}

export function snbtParseValue(source) {
  return parseTokens(tokenize(source))
}

export function uuidFromIntArray(value) {
  const numbers = (value || []).map((item) => Number(item) >>> 0)
  if (numbers.length !== 4) return ''
  const hex = numbers.map((item) => item.toString(16).padStart(8, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

export function uuidToIntArray(text) {
  const hex = String(text || '').replace(/[^0-9a-fA-F]/g, '')
  if (hex.length !== 32) return null
  const out = []
  for (let i = 0; i < 4; i += 1) {
    const chunk = parseInt(hex.slice(i * 8, i * 8 + 8), 16)
    out.push(chunk > 2147483647 ? chunk - 4294967296 : chunk)
  }
  return out
}

export function statsOf(root) {
  const counts = {}
  let nodes = 0
  let depth = 0
  let leaves = 0
  const walkStats = (node, level) => {
    nodes += 1
    counts[node.type] = (counts[node.type] || 0) + 1
    depth = Math.max(depth, level)
    if (isContainer(node.type)) {
      for (const child of node.value) walkStats(child, level + 1)
    } else if (isArrayType(node.type)) {
      counts[node.type] = counts[node.type]
    } else {
      leaves += 1
    }
  }
  walkStats(root, 0)
  return { nodes, counts, depth, leaves }
}

const ITEM_WORDS = { minecraft: '' }

export function prettyId(id) {
  const text = String(id || '').replace(/^minecraft:/, '')
  if (!text) return id || '—'
  const words = text.split('_').join(' ')
  return words.charAt(0).toUpperCase() + words.slice(1)
}

export const ITEM_WORDS_HINT = ITEM_WORDS

export const EFFECT_NAMES = [
  [1, 'Speed'], [2, 'Slowness'], [3, 'Haste'], [4, 'Mining Fatigue'], [5, 'Strength'], [6, 'Instant Health'],
  [7, 'Instant Damage'], [8, 'Jump Boost'], [9, 'Nausea'], [10, 'Regeneration'], [11, 'Resistance'],
  [12, 'Fire Resistance'], [13, 'Water Breathing'], [14, 'Invisibility'], [15, 'Blindness'], [16, 'Night Vision'],
  [17, 'Hunger'], [18, 'Weakness'], [19, 'Poison'], [20, 'Wither'], [21, 'Health Boost'], [22, 'Absorption'],
  [23, 'Saturation'], [24, 'Glowing'], [25, 'Levitation'], [26, 'Luck'], [27, 'Unluck'], [28, 'Slow Falling'],
  [29, 'Conduit Power'], [30, "Dolphin's Grace"], [31, 'Bad Omen'], [32, 'Hero of the Village'], [33, 'Darkness'],
  [34, 'Trial Omen'], [35, 'Raid Omen'], [36, 'Wind Charged'], [37, 'Weaving'], [38, 'Oozing'], [39, 'Infested'],
]

export const ATTR_NAMES = [
  'minecraft:generic.max_health',
  'minecraft:generic.follow_range',
  'minecraft:generic.knockback_resistance',
  'minecraft:generic.movement_speed',
  'minecraft:generic.flying_speed',
  'minecraft:generic.attack_damage',
  'minecraft:generic.attack_knockback',
  'minecraft:generic.attack_speed',
  'minecraft:generic.armor',
  'minecraft:generic.armor_toughness',
  'minecraft:generic.luck',
  'minecraft:generic.max_absorption',
  'minecraft:generic.scale',
  'minecraft:generic.step_height',
  'minecraft:generic.gravity',
  'minecraft:generic.jump_strength',
  'minecraft:generic.safe_fall_distance',
  'minecraft:generic.fall_damage_multiplier',
  'minecraft:generic.burning_time',
  'minecraft:player.block_break_speed',
  'minecraft:player.block_interaction_range',
  'minecraft:player.entity_interaction_range',
  'minecraft:player.mining_efficiency',
  'minecraft:player.sneaking_speed',
  'minecraft:player.sweeping_damage_ratio',
  'minecraft:player.water_movement_efficiency',
  'minecraft:generic.oxygen_bonus',
  'minecraft:generic.movement_efficiency',
]

export const ITEM_IDS = [
  'minecraft:diamond', 'minecraft:netherite_ingot', 'minecraft:golden_apple', 'minecraft:enchanted_golden_apple',
  'minecraft:elytra', 'minecraft:netherite_sword', 'minecraft:netherite_pickaxe', 'minecraft:netherite_axe',
  'minecraft:netherite_shovel', 'minecraft:netherite_helmet', 'minecraft:netherite_chestplate',
  'minecraft:netherite_leggings', 'minecraft:netherite_boots', 'minecraft:shield', 'minecraft:bow',
  'minecraft:crossbow', 'minecraft:trident', 'minecraft:totem_of_undying', 'minecraft:shulker_box',
  'minecraft:ender_chest', 'minecraft:crafting_table', 'minecraft:furnace', 'minecraft:torch',
  'minecraft:oak_log', 'minecraft:stone', 'minecraft:dirt', 'minecraft:cobblestone', 'minecraft:chest',
  'minecraft:beacon', 'minecraft:anvil', 'minecraft:enchanting_table', 'minecraft:brewing_stand',
  'minecraft:experience_bottle', 'minecraft:dragon_egg', 'minecraft:nether_star', 'minecraft:bedrock',
  'minecraft:command_block', 'minecraft:barrier', 'minecraft:light', 'minecraft:spawner',
]

export const GAMERULES = [
  ['doDaylightCycle', 'bool'], ['doWeatherCycle', 'bool'], ['doMobSpawning', 'bool'], ['doMobLoot', 'bool'],
  ['doTileDrops', 'bool'], ['doEntityDrops', 'bool'], ['keepInventory', 'bool'], ['mobGriefing', 'bool'],
  ['naturalRegeneration', 'bool'], ['doFireTick', 'bool'], ['doImmediateRespawn', 'bool'], ['drowningDamage', 'bool'],
  ['fallDamage', 'bool'], ['fireDamage', 'bool'], ['freezeDamage', 'bool'], ['showDeathMessages', 'bool'],
  ['announceAdvancements', 'bool'], ['commandBlockOutput', 'bool'], ['commandBlocksEnabled', 'bool'],
  ['sendCommandFeedback', 'bool'], ['logAdminCommands', 'bool'], ['reducedDebugInfo', 'bool'], ['spectatorsGenerateChunks', 'bool'],
  ['doInsomnia', 'bool'], ['doPatrolSpawning', 'bool'], ['doTraderSpawning', 'bool'], ['doWardenSpawning', 'bool'],
  ['doVinesSpread', 'bool'], ['doLimitedCrafting', 'bool'], ['forgiveDeadPlayers', 'bool'], ['universalAnger', 'bool'],
  ['disableElytraMovementCheck', 'bool'], ['disableRaids', 'bool'], ['playersSleepingPercentage', 'int'],
  ['randomTickSpeed', 'int'], ['spawnRadius', 'int'], ['maxEntityCramming', 'int'], ['maxCommandChainLength', 'int'],
  ['maxCommandForkCount', 'int'], ['commandModificationBlockLimit', 'int'], ['snowAccumulationHeight', 'int'],
]
