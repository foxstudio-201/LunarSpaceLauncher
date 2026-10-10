const fsp = require('fs').promises
const path = require('path')
const AdmZip = require('adm-zip')
const png = require('./pngread.cjs')
const zlib = require('zlib')

const CACHE_VERSION = 3
const BRIGHTNESS = 1.12
const SKIP_COVERAGE = 0.45

const FIXED_TINTS = {
  'minecraft:spruce_leaves': [97, 153, 97],
  'minecraft:birch_leaves': [128, 167, 85],
  'minecraft:azalea_leaves': [92, 120, 60],
  'minecraft:flowering_azalea_leaves': [92, 120, 60],
  'minecraft:cherry_leaves': [226, 178, 200],
  'minecraft:pale_oak_leaves': [136, 150, 116],
  'minecraft:spruce_leaves_': [97, 153, 97],
}

const GRASS_BLOCKS = new Set([
  'minecraft:grass_block', 'minecraft:grass', 'minecraft:short_grass', 'minecraft:tall_grass', 'minecraft:fern',
  'minecraft:large_fern', 'minecraft:sugar_cane', 'minecraft:potted_fern', 'minecraft:pink_petals',
  'minecraft:wildflowers', 'minecraft:leaf_litter',
])
const FOLIAGE_BLOCKS = new Set([
  'minecraft:oak_leaves', 'minecraft:jungle_leaves', 'minecraft:acacia_leaves', 'minecraft:dark_oak_leaves',
  'minecraft:mangrove_leaves', 'minecraft:vine', 'minecraft:oak_sapling', 'minecraft:jungle_sapling',
  'minecraft:acacia_sapling', 'minecraft:dark_oak_sapling', 'minecraft:lily_pad', 'minecraft:mangrove_roots',
  'minecraft:mangrove_propagule', 'minecraft:azalea', 'minecraft:flowering_azalea',
])
const WATER_BLOCKS = new Set([
  'minecraft:water', 'minecraft:bubble_column', 'minecraft:water_cauldron', 'minecraft:seagrass',
  'minecraft:tall_seagrass', 'minecraft:kelp', 'minecraft:kelp_plant',
])

const parseId = (value) => {
  const clean = String(value || '').split('[')[0]
  const index = clean.indexOf(':')
  if (index === -1) return { ns: 'minecraft', p: clean }
  return { ns: clean.slice(0, index), p: clean.slice(index + 1) }
}

const stripToJson = (text) => {
  const cut = text.indexOf('{')
  return cut === -1 ? '' : text.slice(cut)
}

const clamp255 = (value) => Math.max(0, Math.min(255, Math.round(value)))

class SurfacePalette {
  constructor({ jars = [], cacheDir = '', version = '' } = {}) {
    this.jars = jars.filter((item) => item)
    this.cacheDir = cacheDir
    this.version = version
    this.index = null
    this.zips = new Map()
    this.blockCache = new Map()
    this.biomeCache = new Map()
    this.colormaps = {}
    this.dirty = false
  }

  zip(file) {
    if (!this.zips.has(file)) {
      this.zips.set(file, (() => {
        try {
          return new AdmZip(file)
        } catch {
          return null
        }
      })())
    }
    return this.zips.get(file)
  }

  cachePath() {
    return path.join(this.cacheDir, `surface-${this.version || 'v'}-${CACHE_VERSION}.json`)
  }

  indexPath() {
    return path.join(this.cacheDir, `surface-index-${this.version || 'v'}-${CACHE_VERSION}.json.gz`)
  }

  async saveIndex() {
    if (!this.index || !this.cacheDir) return
    try {
      const payload = JSON.stringify({
        blockstates: Object.fromEntries(this.index.blockstates),
        models: Object.fromEntries(this.index.models),
        textures: Object.fromEntries(this.index.textures),
        biomes: Object.fromEntries(this.index.biomes),
      })
      await fsp.mkdir(this.cacheDir, { recursive: true }).catch(() => {})
      const temp = `${this.indexPath()}.${process.pid}.tmp`
      await fsp.writeFile(temp, zlib.gzipSync(payload, { level: 6 })).catch(() => {})
      await fsp.rename(temp, this.indexPath()).catch(() => {})
    } catch {}
  }

  async load() {
    if (this.loaded) return true
    this.loaded = true
    const raw = await fsp.readFile(this.cachePath(), 'utf8').catch(() => '')
    if (raw) {
      try {
        const data = JSON.parse(raw)
        if (data?.version === CACHE_VERSION) {
          this.blockCache = new Map(Object.entries(data.blocks || {}))
          this.biomeCache = new Map(Object.entries(data.biomes || {}))
          return true
        }
      } catch {}
    }
    return true
  }

  async loadIndex() {
    if (this.index) return true
    const raw = await fsp.readFile(this.indexPath()).catch(() => null)
    if (raw) {
      try {
        const data = JSON.parse(zlib.gunzipSync(raw).toString('utf8'))
        this.index = {
          blockstates: new Map(Object.entries(data.blockstates || {})),
          models: new Map(Object.entries(data.models || {})),
          textures: new Map(Object.entries(data.textures || {})),
          biomes: new Map(Object.entries(data.biomes || {})),
        }
        if (this.index.blockstates.size) return true
      } catch {}
    }
    const index = { blockstates: new Map(), models: new Map(), textures: new Map(), biomes: new Map() }
    for (const jar of this.jars) {
      const zip = this.zip(jar)
      if (!zip) continue
      let entries = []
      try {
        entries = zip.getEntries()
      } catch {
        continue
      }
      for (const entry of entries) {
        if (entry.isDirectory) continue
        const name = entry.entryName
        let match = name.match(/^assets\/([^/]+)\/blockstates\/(.+)\.json$/)
        if (match) {
          const key = `${match[1]}:${match[2]}`
          if (!index.blockstates.has(key)) index.blockstates.set(key, { jar, entry: name })
          continue
        }
        match = name.match(/^assets\/([^/]+)\/models\/(.+)\.json$/)
        if (match) {
          const key = `${match[1]}:${match[2]}`
          if (!index.models.has(key)) index.models.set(key, { jar, entry: name })
          continue
        }
        match = name.match(/^assets\/([^/]+)\/textures\/(.+)\.png$/)
        if (match) {
          const key = `${match[1]}:${match[2]}`
          if (!index.textures.has(key)) index.textures.set(key, { jar, entry: name })
          continue
        }
        match = name.match(/^data\/([^/]+)\/worldgen\/biome\/(.+)\.json$/)
        if (match) {
          const key = `${match[1]}:${match[2]}`
          if (!index.biomes.has(key)) index.biomes.set(key, { jar, entry: name })
        }
      }
    }
    this.index = index
    return true
  }

  readJson(ref) {
    if (!ref) return null
    const zip = this.zip(ref.jar)
    const entry = (() => {
      try {
        return zip?.getEntry(ref.entry)
      } catch {
        return null
      }
    })()
    if (!entry) return null
    try {
      return JSON.parse(stripToJson(entry.getData().toString('utf8')))
    } catch {
      return null
    }
  }

  firstModel(blockId) {
    if (!this.index) return ''
    const data = this.readJson(this.index.blockstates.get(blockId))
    if (!data) return ''
    const variants = data.variants || {}
    const keys = Object.keys(variants)
    if (!keys.length) return ''
    const plain = keys.find((key) => !key.includes('=')) || keys[0]
    const value = variants[plain]
    const list = Array.isArray(value) ? value : [value]
    const first = list.find((item) => item && item.model)
    return first ? String(first.model) : ''
  }

  modelTexture(modelId) {
    if (!this.index) return ''
    let current = modelId
    let found = ''
    const seen = new Set()
    for (let depth = 0; depth < 8 && current; depth += 1) {
      if (seen.has(current)) break
      seen.add(current)
      const data = this.readJson(this.index.models.get(current))
      if (!data) break
      const textures = data.textures || {}
      const pick = textures.top || textures.up || textures.all || textures.end || textures.side || textures.east || textures.north || textures.particle || textures.cross || textures.texture || textures.layer0 || textures.plant || textures.rail
      if (pick && !String(pick).startsWith('#')) found = String(pick)
      current = data.parent ? String(data.parent) : ''
    }
    return found
  }

  textureRef(texture) {
    if (!this.index) return null
    const full = texture.includes(':') ? texture : `minecraft:${texture}`
    const { ns, p } = parseId(full)
    const bare = p.replace(/^block\//, '').replace(/^textures\//, '')
    return this.index.textures.get(`${ns}:block/${bare}`) || this.index.textures.get(`${ns}:${p}`) || null
  }

  resolve(blockId) {
    if (this.blockCache.has(blockId)) return this.blockCache.get(blockId)
    let out = null
    try {
      this.loadIndexSync()
      const model = this.firstModel(blockId)
      const texture = model ? this.modelTexture(model) : ''
      const ref = texture ? this.textureRef(texture) : null
      if (ref) {
        const entry = (() => {
          try {
            return this.zip(ref.jar)?.getEntry(ref.entry)
          } catch {
            return null
          }
        })()
        if (entry) {
          const avg = png.average(entry.getData())
          if (avg) out = { rgb: avg.rgb, coverage: avg.coverage }
        }
      }
    } catch {
      out = null
    }
    this.blockCache.set(blockId, out)
    this.dirty = true
    return out
  }

  biomeEffects(biomeId) {
    if (this.biomeCache.has(biomeId)) return this.biomeCache.get(biomeId)
    if (!this.index) return null
    const data = this.readJson(this.index.biomes.get(biomeId))
    let out = null
    if (data) {
      const raw = data.effects || {}
      out = {
        temperature: Number(data.temperature ?? 0.5),
        downfall: Number(data.downfall ?? 0.5),
        grass: Number.isFinite(raw.grass_color) ? raw.grass_color : null,
        foliage: Number.isFinite(raw.foliage_color) ? raw.foliage_color : null,
        water: Number.isFinite(raw.water_color) ? raw.water_color : 4159204,
      }
    }
    this.biomeCache.set(biomeId, out)
    this.dirty = true
    return out
  }

  colormap(kind) {
    if (this.colormaps[kind] !== undefined) return this.colormaps[kind]
    if (!this.index) return null
    const ref = this.index.textures.get(`minecraft:colormap/${kind}`)
    let map = null
    if (ref) {
      const entry = (() => {
        try {
          return this.zip(ref.jar)?.getEntry(ref.entry)
        } catch {
          return null
        }
      })()
      if (entry) {
        const image = png.decode(entry.getData())
        if (image) map = image
      }
    }
    this.colormaps[kind] = map
    return map
  }

  sampleColormap(kind, temperature, downfall) {
    const map = this.colormap(kind)
    if (!map) return null
    const t = Math.max(0, Math.min(1, temperature))
    const h = Math.max(0, Math.min(1, downfall)) * t
    const x = Math.max(0, Math.min(map.width - 1, Math.floor((1 - t) * (map.width - 1))))
    const y = Math.max(0, Math.min(map.height - 1, Math.floor((1 - h) * (map.height - 1))))
    const at = (y * map.width + x) * 4
    return [map.data[at], map.data[at + 1], map.data[at + 2]]
  }

  loadIndexSync() {
    if (this.index) return
    const index = { blockstates: new Map(), models: new Map(), textures: new Map(), biomes: new Map() }
    for (const jar of this.jars) {
      const zip = this.zip(jar)
      if (!zip) continue
      let entries = []
      try {
        entries = zip.getEntries()
      } catch {
        continue
      }
      for (const entry of entries) {
        if (entry.isDirectory) continue
        const name = entry.entryName
        let match = name.match(/^assets\/([^/]+)\/(blockstates|models|textures)\/(.+)\.(json|png)$/)
        if (match) {
          const kind = match[2]
          const key = `${match[1]}:${match[3]}`
          const target = kind === 'blockstates' ? index.blockstates : kind === 'models' ? index.models : index.textures
          if (!target.has(key)) target.set(key, { jar, entry: name })
          continue
        }
        match = name.match(/^data\/([^/]+)\/worldgen\/biome\/(.+)\.json$/)
        if (match) {
          const key = `${match[1]}:${match[2]}`
          if (!index.biomes.has(key)) index.biomes.set(key, { jar, entry: name })
        }
      }
    }
    this.index = index
  }

  biomeTint(kind, biomeId) {
    const effects = this.biomeEffects(biomeId) || { temperature: 0.5, downfall: 0.5, water: 4159204 }
    if (kind === 'water') {
      const value = effects.water || 4159204
      return [(value >> 16) & 255, (value >> 8) & 255, value & 255]
    }
    const override = kind === 'grass' ? effects.grass : effects.foliage
    if (override !== null && override !== undefined) return [(override >> 16) & 255, (override >> 8) & 255, override & 255]
    return this.sampleColormap(kind, effects.temperature, effects.downfall)
  }

  tintKind(blockId) {
    if (FIXED_TINTS[blockId]) return 'fixed'
    if (WATER_BLOCKS.has(blockId)) return 'water'
    if (GRASS_BLOCKS.has(blockId)) return 'grass'
    if (FOLIAGE_BLOCKS.has(blockId)) return 'foliage'
    const path = blockId.split(':')[1] || ''
    if (/(^|_)leaves($|_)|(^|_)sapling($|_)/.test(path)) return 'foliage'
    if (/water/.test(path)) return 'water'
    if (/(^|_)grass($|_)/.test(path)) return 'grass'
    return null
  }

  colorFor(blockId, biomeId) {
    const known = this.blockCache.get(blockId)
    const info = known === undefined ? this.resolve(blockId) : known
    if (!info) return null
    const liquid = WATER_BLOCKS.has(blockId)
    if (!liquid && info.coverage < SKIP_COVERAGE) return 'skip'
    let rgb = info.rgb
    const kind = this.tintKind(blockId)
    if (kind === 'fixed') {
      const fixed = FIXED_TINTS[blockId]
      rgb = [(rgb[0] * fixed[0]) / 255, (rgb[1] * fixed[1]) / 255, (rgb[2] * fixed[2]) / 255]
    } else if (kind === 'water') {
      const tint = this.biomeTint('water', biomeId)
      rgb = tint ? [tint[0] * 0.98, tint[1] * 0.98, tint[2] * 0.98] : rgb
    } else if (kind) {
      const tint = this.biomeTint(kind, biomeId)
      if (tint) rgb = [(rgb[0] * tint[0]) / 255, (rgb[1] * tint[1]) / 255, (rgb[2] * tint[2]) / 255]
    }
    return [clamp255(rgb[0] * BRIGHTNESS), clamp255(rgb[1] * BRIGHTNESS), clamp255(rgb[2] * BRIGHTNESS)]
  }

  serialize() {
    const blocks = {}
    for (const [key, value] of this.blockCache) {
      if (value === null) continue
      blocks[key] = value
    }
    const biomes = {}
    for (const [key, value] of this.biomeCache) {
      if (value === null) continue
      biomes[key] = value
    }
    return { version: CACHE_VERSION, version_, blocks, biomes }
  }

  async save() {
    if (!this.cacheDir || !this.dirty) return
    this.dirty = false
    await fsp.mkdir(this.cacheDir, { recursive: true }).catch(() => {})
    const payload = {
      version: CACHE_VERSION,
      version_: this.version,
      blocks: Object.fromEntries([...this.blockCache].filter(([, value]) => value).slice(-8000)),
      biomes: Object.fromEntries([...this.biomeCache].filter(([, value]) => value).slice(-4000)),
    }
    const temp = `${this.cachePath()}.${process.pid}.tmp`
    await fsp.writeFile(temp, JSON.stringify(payload), 'utf8').catch(() => {})
    await fsp.rename(temp, this.cachePath()).catch(() => {})
  }
}

module.exports = { SurfacePalette, BRIGHTNESS, SKIP_COVERAGE }
