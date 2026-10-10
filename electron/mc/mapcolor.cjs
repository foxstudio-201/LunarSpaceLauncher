const EXACT = {
  'minecraft:air': null,
  'minecraft:cave_air': null,
  'minecraft:void_air': null,
  'minecraft:water': [58, 105, 220],
  'minecraft:bubble_column': [58, 105, 220],
  'minecraft:lava': [214, 92, 18],
  'minecraft:stone': [125, 125, 125],
  'minecraft:cobblestone': [110, 110, 110],
  'minecraft:mossy_cobblestone': [96, 112, 82],
  'minecraft:dirt': [134, 96, 67],
  'minecraft:coarse_dirt': [120, 85, 58],
  'minecraft:rooted_dirt': [143, 105, 74],
  'minecraft:farmland': [124, 89, 58],
  'minecraft:dirt_path': [148, 122, 65],
  'minecraft:grass_block': [110, 168, 76],
  'minecraft:podzol': [89, 109, 45],
  'minecraft:mycelium': [111, 99, 111],
  'minecraft:moss_block': [89, 130, 53],
  'minecraft:sand': [219, 207, 163],
  'minecraft:red_sand': [190, 102, 33],
  'minecraft:sandstone': [216, 203, 155],
  'minecraft:red_sandstone': [183, 97, 29],
  'minecraft:gravel': [131, 127, 126],
  'minecraft:clay': [160, 166, 179],
  'minecraft:snow': [250, 250, 250],
  'minecraft:snow_block': [250, 250, 250],
  'minecraft:powder_snow': [250, 250, 250],
  'minecraft:ice': [145, 183, 250],
  'minecraft:packed_ice': [141, 180, 250],
  'minecraft:blue_ice': [116, 167, 253],
  'minecraft:frosted_ice': [140, 180, 250],
  'minecraft:bedrock': [60, 60, 60],
  'minecraft:obsidian': [20, 18, 29],
  'minecraft:crying_obsidian': [42, 20, 70],
  'minecraft:netherrack': [111, 54, 52],
  'minecraft:nether_bricks': [44, 21, 26],
  'minecraft:soul_sand': [81, 62, 50],
  'minecraft:soul_soil': [75, 57, 46],
  'minecraft:basalt': [73, 72, 77],
  'minecraft:blackstone': [42, 35, 40],
  'minecraft:end_stone': [219, 222, 158],
  'minecraft:end_stone_bricks': [218, 224, 162],
  'minecraft:purpur_block': [169, 125, 169],
  'minecraft:chorus_plant': [93, 58, 93],
  'minecraft:magma_block': [142, 63, 24],
  'minecraft:glowstone': [253, 226, 141],
  'minecraft:sea_lantern': [206, 226, 222],
  'minecraft:shroomlight': [241, 146, 70],
  'minecraft:sculk': [16, 34, 41],
  'minecraft:sculk_catalyst': [14, 44, 50],
  'minecraft:tuff': [108, 109, 102],
  'minecraft:deepslate': [80, 80, 84],
  'minecraft:cobbled_deepslate': [77, 77, 80],
  'minecraft:dripstone_block': [134, 108, 92],
  'minecraft:calcite': [223, 224, 220],
  'minecraft:andesite': [136, 136, 137],
  'minecraft:diorite': [188, 188, 190],
  'minecraft:granite': [154, 110, 92],
  'minecraft:amethyst_block': [133, 96, 191],
  'minecraft:honey_block': [250, 180, 42],
  'minecraft:slime_block': [112, 192, 90],
  'minecraft:hay_block': [166, 140, 22],
  'minecraft:bookshelf': [156, 128, 82],
  'minecraft:crafting_table': [126, 90, 55],
  'minecraft:furnace': [110, 110, 110],
  'minecraft:glass': [190, 220, 235],
  'minecraft:tinted_glass': [45, 45, 52],
  'minecraft:mud': [60, 60, 66],
  'minecraft:muddy_mangrove_roots': [70, 62, 50],
  'minecraft:sponge': [196, 200, 66],
  'minecraft:wet_sponge': [170, 186, 62],
  'minecraft:bamboo_block': [140, 165, 62],
  'minecraft:nether_wart_block': [114, 20, 21],
  'minecraft:warped_wart_block': [22, 118, 121],
  'minecraft:crimson_nylium': [125, 26, 40],
  'minecraft:warped_nylium': [43, 111, 99],
}

const COLORS = {
  white: [249, 255, 254],
  orange: [240, 118, 19],
  magenta: [190, 70, 190],
  light_blue: [58, 175, 217],
  yellow: [248, 198, 39],
  lime: [112, 185, 25],
  pink: [237, 141, 172],
  gray: [62, 68, 71],
  light_gray: [142, 142, 134],
  cyan: [21, 137, 145],
  purple: [121, 42, 172],
  blue: [53, 57, 157],
  brown: [114, 71, 40],
  green: [84, 109, 27],
  red: [161, 39, 34],
  black: [29, 29, 33],
}

const LEAF = { oak: [60, 118, 40], spruce: [52, 88, 48], birch: [128, 167, 85], jungle: [48, 110, 34], acacia: [122, 156, 62], dark_oak: [56, 96, 38], mangrove: [66, 122, 58], cherry: [226, 155, 190], azalea: [84, 130, 60], pale_oak: [136, 150, 116] }
const WOOD = { oak: [162, 130, 79], spruce: [114, 84, 48], birch: [216, 213, 186], jungle: [154, 110, 79], acacia: [168, 90, 50], dark_oak: [66, 43, 20], mangrove: [120, 55, 43], cherry: [226, 178, 173], crimson: [103, 51, 76], warped: [43, 105, 99], bamboo: [193, 175, 84], pale_oak: [216, 205, 180] }

const shade = (rgb, factor) => [
  Math.max(0, Math.min(255, Math.round(rgb[0] * factor))),
  Math.max(0, Math.min(255, Math.round(rgb[1] * factor))),
  Math.max(0, Math.min(255, Math.round(rgb[2] * factor))),
]

const woodOf = (name) => {
  const key = Object.keys(WOOD).find((id) => name.startsWith(`${id}_`))
  return key ? WOOD[key] : [150, 115, 75]
}
const leafOf = (name) => {
  const key = Object.keys(LEAF).find((id) => name.startsWith(`${id}_`))
  return key ? LEAF[key] : [62, 118, 44]
}
const colorWordOf = (name) => {
  const word = Object.keys(COLORS).filter((id) => id !== 'light_gray' && id !== 'light_blue').find((id) => name.startsWith(`${id}_`))
  if (word) return COLORS[word]
  if (name.startsWith('light_blue_')) return COLORS.light_blue
  if (name.startsWith('light_gray_')) return COLORS.light_gray
  return null
}

const hashColor = (name) => {
  let hash = 2166136261
  for (let i = 0; i < name.length; i += 1) {
    hash ^= name.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  const hue = (hash >>> 0) % 360
  const light = 34 + ((hash >>> 9) % 22)
  const sat = 22 + ((hash >>> 17) % 20)
  const c = sat / 100
  const l = light / 100
  const k = (n) => (n + hue / 30) % 12
  const a = c * Math.min(l, 1 - l)
  const f = (n) => l - a * Math.max(-1, Math.min(Math.min(k(n) - 3, 9 - k(n)), 1))
  return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)]
}

const CACHE = new Map()

function blockColor(raw) {
  if (!raw) return null
  const name = String(raw).toLowerCase()
  if (CACHE.has(name)) return CACHE.get(name)
  let out = EXACT[name] ?? null
  if (out === undefined) out = null
  if (!out && !(name in EXACT)) {
    if (name.includes('leaves')) out = leafOf(name)
    else if (/_log$|_wood$|_hyphae$|_stem$/.test(name)) out = woodOf(name)
    else if (name.includes('planks')) out = woodOf(name)
    else if (name.includes('water')) out = EXACT['minecraft:water']
    else if (name.includes('lava') || name.includes('magma')) out = EXACT['minecraft:lava']
    else if (name.includes('glass')) out = shade(colorWordOf(name) || [190, 220, 235], 1)
    else if (name.includes('wool') || name.includes('carpet') || name.includes('concrete') || name.includes('terracotta') || name.includes('glazed')) out = colorWordOf(name)
    else if (name.includes('sand')) out = EXACT['minecraft:sand']
    else if (name.includes('dirt') || name.includes('soil')) out = EXACT['minecraft:dirt']
    else if (name.includes('stone') || name.includes('deepslate')) out = EXACT['minecraft:stone']
    else if (name.includes('brick')) out = [150, 97, 83]
    else if (name.includes('_ore$') || name.endsWith('_ore')) out = shade([125, 125, 125], 0.92)
    else if (name.includes('snow')) out = EXACT['minecraft:snow']
    else if (name.includes('ice')) out = EXACT['minecraft:ice']
    else if (name.includes('grass') || name.includes('moss') || name.includes('fern')) out = EXACT['minecraft:grass_block']
    else if (name.includes('flower') || name.includes('sapling') || name.includes('bush') || name.includes('crop') || name.includes('wheat') || name.includes('carrots') || name.includes('potatoes') || name.includes('beetroots')) out = [122, 168, 72]
    else if (name.includes('slab') || name.includes('stairs') || name.includes('wall') || name.includes('fence')) out = woodOf(name)
    if (!out) out = hashColor(name)
  }
  CACHE.set(name, out)
  return out
}

const IS_AIR = (name) => name.endsWith(':air') || name.includes('air') || name === 'minecraft:void_air'

const isAirBlock = (name) => {
  if (!name) return true
  const text = String(name).toLowerCase()
  return text === 'minecraft:air' || text === 'minecraft:cave_air' || text === 'minecraft:void_air' || IS_AIR(text)
}

module.exports = { blockColor, isAirBlock, hashColor }
