use anyhow::{anyhow, Result};
use image::RgbaImage;
use serde_json::Value;
use std::collections::HashMap;
use std::io::Read;
use std::path::{Path, PathBuf};

fn node_value<'a>(list: &'a Value, name: &str) -> Option<&'a Value> {
    list.as_array()?
        .iter()
        .find(|node| node.get("name").and_then(Value::as_str) == Some(name))
        .and_then(|node| node.get("value"))
}

fn nbt_longs(value: &Value) -> Vec<u64> {
    value
        .as_array()
        .map(|rows| {
            rows.iter()
                .filter_map(|item| {
                    item.as_str()
                        .and_then(|text| text.parse::<i64>().ok())
                        .map(|number| number as u64)
                        .or_else(|| item.as_u64())
                })
                .collect()
        })
        .unwrap_or_default()
}

fn bits_for(len: usize, minimum: u32) -> u32 {
    if len <= 1 {
        return 0;
    }
    let mut bits = 1u32;
    while (1usize << bits) < len {
        bits += 1;
    }
    bits.max(minimum)
}

fn unpack_non_crossing(longs: &[u64], bits: u32, count: usize) -> Vec<u16> {
    if bits == 0 {
        return vec![0; count];
    }
    let per = (64 / bits) as usize;
    if per == 0 {
        return vec![0; count];
    }
    let mask = (1u64 << bits) - 1;
    let mut out = Vec::with_capacity(count);
    for index in 0..count {
        let word = longs.get(index / per).copied().unwrap_or(0);
        let offset = ((index % per) as u32 * bits) as u32;
        out.push(((word >> offset) & mask) as u16);
    }
    out
}

fn unpack_crossing(longs: &[u64], bits: u32, count: usize) -> Vec<u16> {
    if bits == 0 {
        return vec![0; count];
    }
    let mask = (1u64 << bits) - 1;
    let mut out = Vec::with_capacity(count);
    for index in 0..count {
        let bit = index as u64 * bits as u64;
        let word_index = (bit / 64) as usize;
        let offset = (bit % 64) as u32;
        let mut value = longs.get(word_index).copied().unwrap_or(0) as u128 >> offset;
        if offset + bits > 64 {
            value |= (longs.get(word_index + 1).copied().unwrap_or(0) as u128) << (64 - offset);
        }
        out.push((value & mask as u128) as u16);
    }
    out
}

struct Interner {
    names: Vec<String>,
    lookup: HashMap<String, u16>,
}

impl Interner {
    fn new() -> Self {
        Self {
            names: Vec::new(),
            lookup: HashMap::new(),
        }
    }

    fn intern(&mut self, name: &str) -> u16 {
        if let Some(id) = self.lookup.get(name) {
            return *id;
        }
        let id = self.names.len() as u16;
        self.names.push(name.to_string());
        self.lookup.insert(name.to_string(), id);
        id
    }

    fn name(&self, id: u16) -> &str {
        self.names.get(id as usize).map(String::as_str).unwrap_or("stone")
    }
}

#[derive(Clone, Copy, Default)]
struct MapSurface {
    height: i32,
    block: u16,
    biome: u16,
    water_depth: u16,
    floor: u16,
}

struct ParsedSection {
    y: i32,
    names: Vec<String>,
    ids: Vec<u16>,
    blocks: Vec<u16>,
    biome_ids: Vec<u16>,
    biome_indices: Vec<u16>,
    legacy_biomes: Vec<u16>,
}

impl ParsedSection {
    fn block(&self, x: usize, y: usize, z: usize) -> u16 {
        self.blocks
            .get((y * 16 + z) * 16 + x)
            .copied()
            .unwrap_or(0)
    }

    fn name(&self, local: u16) -> &str {
        self.names.get(local as usize).map(String::as_str).unwrap_or("air")
    }

    fn global(&self, local: u16) -> u16 {
        self.ids.get(local as usize).copied().unwrap_or(0)
    }

    fn biome(&self, x: usize, y: usize, z: usize, fallback: u16) -> u16 {
        if self.biome_indices.is_empty() {
            if self.legacy_biomes.len() >= 256 {
                return self.legacy_biomes.get(z * 16 + x).copied().unwrap_or(fallback);
            }
            return fallback;
        }
        if self.biome_indices.len() >= 64 {
            let index = (y / 4) * 16 + (z / 4) * 4 + (x / 4);
            let local = self.biome_indices.get(index).copied().unwrap_or(0);
            self.biome_ids.get(local as usize).copied().unwrap_or(fallback)
        } else if self.biome_indices.len() >= 256 {
            let local = self.biome_indices.get(z * 16 + x).copied().unwrap_or(0);
            self.biome_ids.get(local as usize).copied().unwrap_or(fallback)
        } else {
            self.biome_ids.first().copied().unwrap_or(fallback)
        }
    }
}

fn palette_names(value: &Value, interner: &mut Interner) -> (Vec<String>, Vec<u16>) {
    let mut names = Vec::new();
    let mut ids = Vec::new();
    for item in value.as_array().cloned().unwrap_or_default() {
        let name = if let Some(text) = item.as_str() {
            text.to_string()
        } else {
            item.get("value")
                .and_then(|payload| node_value(payload, "Name"))
                .and_then(Value::as_str)
                .unwrap_or("minecraft:air")
                .to_string()
        };
        let name = normalize(&name);
        ids.push(interner.intern(&name));
        names.push(name);
    }
    if names.is_empty() {
        names.push("air".into());
        ids.push(interner.intern("air"));
    }
    (names, ids)
}

fn biome_palette(value: &Value, interner: &mut Interner) -> (Vec<String>, Vec<u16>) {
    let mut names = Vec::new();
    let mut ids = Vec::new();
    for item in value.as_array().cloned().unwrap_or_default() {
        let name = item
            .as_str()
            .map(str::to_string)
            .or_else(|| item.get("value").and_then(Value::as_str).map(str::to_string))
            .unwrap_or_else(|| "minecraft:plains".to_string());
        let name = normalize(&name);
        ids.push(interner.intern(&name));
        names.push(name);
    }
    if names.is_empty() {
        names.push("plains".into());
        ids.push(interner.intern("plains"));
    }
    (names, ids)
}

fn normalize(name: &str) -> String {
    let name = name.trim();
    let name = name.rsplit_once(':').map(|(_, path)| path).unwrap_or(name);
    name.to_lowercase()
}

fn is_air(name: &str) -> bool {
    name == "air" || name == "cave_air" || name == "void_air"
}

fn is_water(name: &str) -> bool {
    matches!(name, "water" | "still_water" | "flowing_water" | "bubble_column")
}

fn is_ignored(name: &str) -> bool {
    if name.is_empty() {
        return true;
    }
    if matches!(
        name,
        "grass"
            | "short_grass"
            | "tall_grass"
            | "fern"
            | "large_fern"
            | "dead_bush"
            | "sugar_cane"
            | "wheat"
            | "carrots"
            | "potatoes"
            | "beetroots"
            | "torchflower"
            | "pitcher_plant"
            | "dandelion"
            | "poppy"
            | "blue_orchid"
            | "allium"
            | "azure_bluet"
            | "red_tulip"
            | "orange_tulip"
            | "white_tulip"
            | "pink_tulip"
            | "oxeye_daisy"
            | "cornflower"
            | "lily_of_the_valley"
            | "wither_rose"
            | "sunflower"
            | "lilac"
            | "rose_bush"
            | "peony"
            | "lily_pad"
            | "vine"
            | "glow_lichen"
            | "sculk_vein"
            | "seagrass"
            | "tall_seagrass"
            | "kelp"
            | "kelp_plant"
            | "twisting_vines"
            | "weeping_vines"
            | "cave_vines"
            | "cave_vines_plant"
            | "hanging_roots"
            | "big_dripleaf"
            | "small_dripleaf"
            | "leaf_litter"
            | "pale_hanging_moss"
            | "firefly_bush"
            | "bush"
            | "short_dry_grass"
            | "tall_dry_grass"
            | "wildflowers"
            | "sweet_berry_bush"
            | "torch"
            | "wall_torch"
            | "redstone_torch"
            | "redstone_wall_torch"
            | "soul_torch"
            | "soul_wall_torch"
            | "lantern"
            | "soul_lantern"
            | "rail"
            | "powered_rail"
            | "detector_rail"
            | "activator_rail"
            | "redstone_wire"
            | "tripwire"
            | "carpet"
            | "moss_carpet"
            | "snow_carpet"
    ) {
        return true;
    }
    name.ends_with("_carpet")
        || name.ends_with("_sapling")
        || name.ends_with("_flower")
        || name.ends_with("_tulip")
        || name.ends_with("_sign")
        || name.ends_with("_banner")
        || name.ends_with("_button")
        || name.ends_with("_pressure_plate")
        || name.ends_with("_torch")
}

fn biome_from_id(id: i64) -> &'static str {
    match id as u8 {
        0 => "ocean",
        1 => "plains",
        2 => "desert",
        3 => "windswept_hills",
        4 => "forest",
        5 => "taiga",
        6 => "swamp",
        7 => "river",
        8 => "nether_wastes",
        9 => "the_end",
        10 => "frozen_ocean",
        11 => "frozen_river",
        12 => "snowy_plains",
        13 => "snowy_mountains",
        14 => "mushroom_fields",
        15 => "mushroom_field_shore",
        16 => "beach",
        17 => "desert_hills",
        18 => "wooded_hills",
        19 => "taiga_hills",
        20 => "mountain_edge",
        21 => "jungle",
        22 => "jungle_hills",
        23 => "jungle_edge",
        24 => "deep_ocean",
        25 => "stony_shore",
        26 => "snowy_beach",
        27 => "birch_forest",
        28 => "birch_forest_hills",
        29 => "dark_forest",
        30 => "snowy_taiga",
        31 => "snowy_taiga_hills",
        32 => "giant_tree_taiga",
        33 => "giant_tree_taiga_hills",
        34 => "wooded_mountains",
        35 => "savanna",
        36 => "savanna_plateau",
        37 => "badlands",
        38 => "wooded_badlands",
        39 => "badlands_plateau",
        40 => "small_end_islands",
        41 => "end_midlands",
        42 => "end_highlands",
        43 => "end_barrens",
        44 => "warm_ocean",
        45 => "lukewarm_ocean",
        46 => "cold_ocean",
        47 => "deep_warm_ocean",
        48 => "deep_lukewarm_ocean",
        49 => "deep_cold_ocean",
        50 => "deep_frozen_ocean",
        127 => "sunflower_plains",
        129 => "windswept_forest",
        130 => "windswept_savanna",
        131 => "savanna_plateau",
        132 => "badlands",
        133 => "eroded_badlands",
        140 => "ice_spikes",
        149 => "jungle",
        151 => "bamboo_jungle",
        155 => "mushroom_fields",
        160 => "dark_forest",
        168 => "mangrove_swamp",
        _ => "plains",
    }
}

struct BiomeInfo {
    temperature: f32,
    humidity: f32,
    water: [u8; 3],
    grass: Option<[u8; 3]>,
    foliage: Option<[u8; 3]>,
}

fn biome_info(name: &str) -> BiomeInfo {
    let (temperature, humidity, water, grass, foliage) = match name {
        "plains" | "sunflower_plains" => (0.8, 0.4, [0x3F, 0x76, 0xE4], None, None),
        "snowy_plains" | "ice_spikes" | "snowy_beach" => (0.0, 0.5, [0x3D, 0x57, 0xD6], None, None),
        "desert" | "desert_hills" => (2.0, 0.0, [0x32, 0xA5, 0x98], None, None),
        "forest" | "flower_forest" | "wooded_hills" => (0.7, 0.8, [0x3F, 0x76, 0xE4], None, None),
        "birch_forest" | "birch_forest_hills" | "old_growth_birch_forest" => {
            (0.6, 0.6, [0x3F, 0x76, 0xE4], None, None)
        }
        "dark_forest" | "roofed_forest" => (0.7, 0.8, [0x3F, 0x76, 0xE4], None, None),
        "taiga" | "taiga_hills" => (0.25, 0.8, [0x28, 0x70, 0x82], None, None),
        "snowy_taiga" | "snowy_taiga_hills" => (0.05, 0.8, [0x3D, 0x57, 0xD6], None, None),
        "old_growth_pine_taiga" | "giant_tree_taiga" | "giant_tree_taiga_hills" => {
            (0.3, 0.8, [0x28, 0x70, 0x82], None, None)
        }
        "old_growth_spruce_taiga" | "wooded_mountains" => (0.25, 0.8, [0x28, 0x70, 0x82], None, None),
        "jungle" | "jungle_hills" | "sparse_jungle" | "jungle_edge" => {
            (0.95, 0.9, [0x53, 0xA2, 0xD1], None, None)
        }
        "bamboo_jungle" => (0.95, 0.9, [0x14, 0xA2, 0xC5], None, None),
        "swamp" => (0.8, 0.9, [0x61, 0x7B, 0x64], Some([0x6A, 0x70, 0x39]), Some([0x6A, 0x70, 0x39])),
        "mangrove_swamp" => (0.8, 0.9, [0x3A, 0x7A, 0x6A], Some([0x6A, 0x70, 0x39]), Some([0x8D, 0xBF, 0x70])),
        "badlands" | "badlands_plateau" | "wooded_badlands" | "eroded_badlands" => {
            (2.0, 0.0, [0x4E, 0x7F, 0x81], Some([0x90, 0x81, 0x4D]), Some([0x9E, 0x81, 0x4D]))
        }
        "savanna" | "savanna_plateau" | "windswept_savanna" => {
            (1.2, 0.0, [0x2C, 0x8B, 0x9C], None, None)
        }
        "meadow" => (0.5, 0.8, [0x0E, 0x4E, 0xCF], None, None),
        "cherry_grove" => (0.5, 0.8, [0x5D, 0xB7, 0xEF], Some([0xB6, 0xDB, 0xB4]), Some([0xB6, 0xDB, 0xB4])),
        "pale_garden" => (0.7, 0.8, [0x3F, 0x76, 0xE4], Some([0x77, 0x82, 0x72]), Some([0x87, 0x8D, 0x7A])),
        "mushroom_fields" | "mushroom_field_shore" => {
            (0.9, 1.0, [0x3F, 0x76, 0xE4], Some([0x55, 0xC9, 0x3F]), Some([0x55, 0xC9, 0x3F]))
        }
        "beach" => (0.8, 0.4, [0x3F, 0x76, 0xE4], None, None),
        "stony_shore" | "mountain_edge" => (0.2, 0.3, [0x3F, 0x76, 0xE4], None, None),
        "windswept_hills" | "windswept_gravelly_hills" | "windswept_forest" => {
            (0.2, 0.3, [0x3F, 0x76, 0xE4], None, None)
        }
        "grove" => (0.5, 0.8, [0x3D, 0x57, 0xD6], None, None),
        "snowy_slopes" | "frozen_peaks" | "jagged_peaks" => (0.0, 0.5, [0x3D, 0x57, 0xD6], None, None),
        "stony_peaks" => (1.0, 0.3, [0x3F, 0x76, 0xE4], None, None),
        "lush_caves" => (0.5, 0.5, [0x3F, 0x76, 0xE4], None, None),
        "dripstone_caves" | "deep_dark" => (0.8, 0.4, [0x3F, 0x76, 0xE4], None, None),
        "ocean" | "deep_ocean" | "river" => (0.5, 0.5, [0x3F, 0x76, 0xE4], None, None),
        "warm_ocean" | "deep_warm_ocean" => (0.5, 0.5, [0x43, 0xD5, 0xEE], None, None),
        "lukewarm_ocean" | "deep_lukewarm_ocean" => (0.5, 0.5, [0x45, 0xAD, 0xF2], None, None),
        "cold_ocean" | "deep_cold_ocean" => (0.5, 0.5, [0x3D, 0x57, 0xD6], None, None),
        "frozen_ocean" | "deep_frozen_ocean" | "frozen_river" => {
            (0.0, 0.5, [0x39, 0x38, 0xC9], None, None)
        }
        "nether_wastes" | "crimson_forest" | "warped_forest" | "soul_sand_valley" | "basalt_deltas" => {
            (2.0, 0.0, [0x3F, 0x76, 0xE4], None, None)
        }
        "the_end" | "small_end_islands" | "end_midlands" | "end_highlands" | "end_barrens" => {
            (0.5, 0.5, [0x3F, 0x76, 0xE4], None, None)
        }
        _ => {
            let lower = name.to_lowercase();
            if lower.contains("frozen") || lower.contains("snow") || lower.contains("ice") {
                (0.0, 0.5, [0x3D, 0x57, 0xD6], None, None)
            } else if lower.contains("desert") || lower.contains("badlands") {
                (2.0, 0.0, [0x32, 0xA5, 0x98], None, None)
            } else if lower.contains("jungle") {
                (0.95, 0.9, [0x53, 0xA2, 0xD1], None, None)
            } else if lower.contains("swamp") {
                (0.8, 0.9, [0x61, 0x7B, 0x64], Some([0x6A, 0x70, 0x39]), Some([0x6A, 0x70, 0x39]))
            } else if lower.contains("savanna") {
                (1.2, 0.0, [0x2C, 0x8B, 0x9C], None, None)
            } else if lower.contains("taiga") {
                (0.25, 0.8, [0x28, 0x70, 0x82], None, None)
            } else if lower.contains("ocean") || lower.contains("river") {
                (0.5, 0.5, [0x3F, 0x76, 0xE4], None, None)
            } else {
                (0.7, 0.5, [0x3F, 0x76, 0xE4], None, None)
            }
        }
    };
    BiomeInfo {
        temperature,
        humidity,
        water,
        grass,
        foliage,
    }
}

struct ColorMaps {
    grass: RgbaImage,
    foliage: RgbaImage,
}

impl ColorMaps {
    fn sample(image: &RgbaImage, temperature: f32, humidity: f32) -> [u8; 3] {
        let temperature = temperature.clamp(0.0, 1.0);
        let humidity = (humidity.clamp(0.0, 1.0) * temperature).clamp(0.0, 1.0);
        let x = ((1.0 - temperature) * 255.0).round() as u32;
        let y = ((1.0 - humidity) * 255.0).round() as u32;
        let pixel = image.get_pixel(x.min(image.width() - 1), y.min(image.height() - 1));
        [pixel[0], pixel[1], pixel[2]]
    }

    fn grass(&self, temperature: f32, humidity: f32) -> [u8; 3] {
        Self::sample(&self.grass, temperature, humidity)
    }

    fn foliage(&self, temperature: f32, humidity: f32) -> [u8; 3] {
        Self::sample(&self.foliage, temperature, humidity)
    }
}

fn read_zip_entry<R: Read + std::io::Seek>(zip: &mut zip::ZipArchive<R>, name: &str) -> Option<Vec<u8>> {
    let mut entry = zip.by_name(name).ok()?;
    if entry.size() > 2 * 1024 * 1024 {
        return None;
    }
    let mut data = Vec::new();
    entry.read_to_end(&mut data).ok()?;
    Some(data)
}

fn load_colormaps(shared: &Path, hints: &[String]) -> Option<ColorMaps> {
    let mut candidates: Vec<PathBuf> = Vec::new();
    for hint in hints.iter().filter(|hint| !hint.trim().is_empty()) {
        candidates.push(shared.join("versions").join(hint).join(format!("{hint}.jar")));
    }
    if let Ok(entries) = std::fs::read_dir(shared.join("versions")) {
        let mut jars: Vec<(std::time::SystemTime, PathBuf)> = Vec::new();
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                if let Ok(children) = std::fs::read_dir(&path) {
                    for child in children.flatten() {
                        let jar = child.path();
                        if jar.extension().map(|ext| ext.to_string_lossy().eq_ignore_ascii_case("jar")).unwrap_or(false) {
                            if let Ok(meta) = child.metadata() {
                                if let Ok(modified) = meta.modified() {
                                    jars.push((modified, jar));
                                }
                            }
                        }
                    }
                }
            } else if path.extension().map(|ext| ext.to_string_lossy().eq_ignore_ascii_case("jar")).unwrap_or(false) {
                if let Ok(meta) = entry.metadata() {
                    if let Ok(modified) = meta.modified() {
                        jars.push((modified, path));
                    }
                }
            }
        }
        jars.sort_by(|a, b| b.0.cmp(&a.0));
        candidates.extend(jars.into_iter().map(|(_, path)| path));
    }
    for jar in candidates {
        let Ok(file) = std::fs::File::open(&jar) else { continue };
        let Ok(mut zip) = zip::ZipArchive::new(file) else { continue };
        let grass = read_zip_entry(&mut zip, "assets/minecraft/textures/colormap/grass.png")
            .and_then(|data| image::load_from_memory(&data).ok())
            .map(|image| image.to_rgba8());
        let foliage = read_zip_entry(&mut zip, "assets/minecraft/textures/colormap/foliage.png")
            .and_then(|data| image::load_from_memory(&data).ok())
            .map(|image| image.to_rgba8());
        if let (Some(grass), Some(foliage)) = (grass, foliage) {
            if grass.width() >= 2 && grass.height() >= 2 && foliage.width() >= 2 && foliage.height() >= 2 {
                return Some(ColorMaps { grass, foliage });
            }
        }
    }
    None
}

fn fallback_grass(temperature: f32, humidity: f32) -> [u8; 3] {
    let cold = [0x8F, 0xB0, 0x7A];
    let warm = [0x91, 0xBD, 0x59];
    let dry = [0xBF, 0xA3, 0x5C];
    let t = ((temperature + 0.5) / 2.5).clamp(0.0, 1.0);
    let h = humidity.clamp(0.0, 1.0);
    let base = [
        (cold[0] as f32 * (1.0 - t) + warm[0] as f32 * t) as u8,
        (cold[1] as f32 * (1.0 - t) + warm[1] as f32 * t) as u8,
        (cold[2] as f32 * (1.0 - t) + warm[2] as f32 * t) as u8,
    ];
    let dry_t = (1.0 - h) * 0.55;
    [
        (base[0] as f32 * (1.0 - dry_t) + dry[0] as f32 * dry_t) as u8,
        (base[1] as f32 * (1.0 - dry_t) + dry[1] as f32 * dry_t) as u8,
        (base[2] as f32 * (1.0 - dry_t) + dry[2] as f32 * dry_t) as u8,
    ]
}

struct Tone {
    grass: [u8; 3],
    foliage: [u8; 3],
    water: [u8; 3],
}

fn tone_for(biome: &str, maps: Option<&ColorMaps>) -> Tone {
    let info = biome_info(biome);
    let grass = info.grass.unwrap_or_else(|| {
        maps.map(|maps| maps.grass(info.temperature, info.humidity))
            .unwrap_or_else(|| fallback_grass(info.temperature, info.humidity))
    });
    let foliage = info.foliage.unwrap_or_else(|| {
        maps.map(|maps| maps.foliage(info.temperature, info.humidity))
            .unwrap_or_else(|| fallback_grass(info.temperature, info.humidity))
    });
    Tone {
        grass,
        foliage,
        water: info.water,
    }
}

fn mix(a: [u8; 3], b: [u8; 3], t: f32) -> [u8; 3] {
    let t = t.clamp(0.0, 1.0);
    [
        (a[0] as f32 * (1.0 - t) + b[0] as f32 * t) as u8,
        (a[1] as f32 * (1.0 - t) + b[1] as f32 * t) as u8,
        (a[2] as f32 * (1.0 - t) + b[2] as f32 * t) as u8,
    ]
}

fn scale(color: [u8; 3], factor: f32) -> [u8; 3] {
    [
        (color[0] as f32 * factor).clamp(0.0, 255.0) as u8,
        (color[1] as f32 * factor).clamp(0.0, 255.0) as u8,
        (color[2] as f32 * factor).clamp(0.0, 255.0) as u8,
    ]
}

fn leaves_color(name: &str, tone: &Tone) -> [u8; 3] {
    if name.contains("cherry") {
        return [0xF1, 0xA7, 0xC8];
    }
    if name.contains("azalea") {
        return [0x6F, 0xB2, 0x4B];
    }
    if name.contains("spruce") {
        return scale(tone.foliage, 0.72);
    }
    if name.contains("birch") {
        return mix(tone.foliage, [0xA8, 0xC2, 0x76], 0.45);
    }
    if name.contains("jungle") {
        return mix(tone.foliage, [0x59, 0xC9, 0x3C], 0.35);
    }
    if name.contains("mangrove") {
        return mix(tone.foliage, [0x74, 0xA5, 0x4B], 0.3);
    }
    if name.contains("pale") {
        return [0x87, 0x8D, 0x7A];
    }
    tone.foliage
}

fn wood_color(name: &str) -> [u8; 3] {
    if name.contains("spruce") {
        [0x6B, 0x50, 0x33]
    } else if name.contains("birch") {
        [0xD7, 0xCF, 0xB8]
    } else if name.contains("jungle") {
        [0x9A, 0x6B, 0x4B]
    } else if name.contains("acacia") {
        [0xB0, 0x5D, 0x33]
    } else if name.contains("dark_oak") {
        [0x4A, 0x33, 0x1E]
    } else if name.contains("cherry") {
        [0xE2, 0xB2, 0xAC]
    } else if name.contains("mangrove") {
        [0x5C, 0x37, 0x2D]
    } else if name.contains("crimson") {
        [0x7A, 0x3C, 0x50]
    } else if name.contains("warped") {
        [0x2B, 0x6E, 0x69]
    } else if name.contains("bamboo") {
        [0xC5, 0xB6, 0x5A]
    } else {
        [0xA1, 0x82, 0x4F]
    }
}

fn dye_color(name: &str) -> Option<[u8; 3]> {
    let colors: [(&str, [u8; 3]); 16] = [
        ("white", [0xE9, 0xEC, 0xEC]),
        ("light_gray", [0x8E, 0x8E, 0x86]),
        ("gray", [0x3E, 0x44, 0x47]),
        ("black", [0x14, 0x15, 0x19]),
        ("brown", [0x72, 0x47, 0x28]),
        ("red", [0xA1, 0x27, 0x22]),
        ("orange", [0xF0, 0x76, 0x13]),
        ("yellow", [0xF8, 0xC6, 0x27]),
        ("lime", [0x70, 0xB9, 0x19]),
        ("green", [0x54, 0x6D, 0x1B]),
        ("cyan", [0x15, 0x89, 0x91]),
        ("light_blue", [0x3A, 0xAF, 0xD9]),
        ("blue", [0x35, 0x39, 0x9D]),
        ("purple", [0x79, 0x2A, 0xAC]),
        ("magenta", [0xBD, 0x44, 0xB3]),
        ("pink", [0xED, 0x8D, 0xAC]),
    ];
    for (key, color) in colors {
        if name.starts_with(key) || name.contains(&format!("_{key}")) || name.starts_with(&format!("{key}_")) {
            return Some(color);
        }
    }
    None
}

fn block_color(name: &str, tone: &Tone) -> [u8; 4] {
    if name.contains("water") {
        return [tone.water[0], tone.water[1], tone.water[2], 255];
    }
    if name.contains("lava") {
        return [0xD8, 0x5A, 0x14, 255];
    }
    if name.contains("magma") {
        return [0x9C, 0x43, 0x1B, 255];
    }
    if name == "snow"
        || name == "snow_block"
        || name == "snow_layer"
        || name == "powder_snow"
        || name == "powder_snow_cauldron"
    {
        return [0xE8, 0xF0, 0xF6, 255];
    }
    if name == "ice" || name.contains("frosted_ice") {
        return [0x9B, 0xC4, 0xE8, 212];
    }
    if name == "packed_ice" {
        return [0xA9, 0xC8, 0xEE, 230];
    }
    if name == "blue_ice" {
        return [0x74, 0x9F, 0xE3, 240];
    }
    if name.contains("leaves") {
        let color = leaves_color(name, tone);
        return [color[0], color[1], color[2], 255];
    }
    if name.contains("grass_block") || name == "grass" || name == "fern" {
        return [tone.grass[0], tone.grass[1], tone.grass[2], 255];
    }
    if name == "podzol" {
        return [0x6B, 0x4B, 0x2A, 255];
    }
    if name == "mycelium" {
        return [0x8A, 0x7C, 0x8E, 255];
    }
    if name == "moss_block" || name == "moss_carpet" || name == "azalea_leaves" {
        return [0x59, 0x8A, 0x33, 255];
    }
    if name.contains("dirt") || name == "farmland" || name == "rooted_dirt" || name == "coarse_dirt" {
        return [0x86, 0x60, 0x43, 255];
    }
    if name == "mud" || name == "muddy_mangrove_roots" || name == "packed_mud" {
        return [0x3D, 0x37, 0x33, 255];
    }
    if name == "clay" {
        return [0xA0, 0xA6, 0xB3, 255];
    }
    if name.contains("red_sand") {
        return [0xBC, 0x69, 0x2D, 255];
    }
    if name.contains("sandstone") {
        return [0xD8, 0xC8, 0x9B, 255];
    }
    if name.contains("sand") || name == "suspicious_sand" {
        return [0xDB, 0xCF, 0xA3, 255];
    }
    if name == "gravel" || name == "suspicious_gravel" {
        return [0x82, 0x7F, 0x7C, 255];
    }
    if name.contains("terracotta") {
        if let Some(color) = dye_color(name) {
            return [color[0], color[1], color[2], 255];
        }
        return [0x98, 0x5E, 0x43, 255];
    }
    if name.contains("deepslate") {
        return [0x50, 0x50, 0x54, 255];
    }
    if name == "tuff" {
        return [0x6C, 0x6D, 0x66, 255];
    }
    if name == "calcite" {
        return [0xDF, 0xE0, 0xDC, 255];
    }
    if name == "dripstone_block" {
        return [0x86, 0x6B, 0x5B, 255];
    }
    if name.contains("stone") || name == "cobblestone" || name == "andesite" || name == "diorite" || name == "granite" {
        return [0x7D, 0x7D, 0x7D, 255];
    }
    if name == "bedrock" || name == "obsidian" || name == "crying_obsidian" {
        return [0x2B, 0x2A, 0x33, 255];
    }
    if name == "netherrack" {
        return [0x6E, 0x2C, 0x2C, 255];
    }
    if name == "soul_sand" || name == "soul_soil" {
        return [0x5A, 0x45, 0x38, 255];
    }
    if name == "nether_wart_block" {
        return [0x78, 0x14, 0x14, 255];
    }
    if name.contains("nylium") {
        if name.contains("warped") {
            return [0x2B, 0x6E, 0x69, 255];
        }
        return [0x82, 0x2C, 0x2C, 255];
    }
    if name == "basalt" || name == "smooth_basalt" || name == "blackstone" {
        return [0x4A, 0x4A, 0x4E, 255];
    }
    if name == "end_stone" {
        return [0xDB, 0xDE, 0x9E, 255];
    }
    if name == "purpur_block" || name == "purpur_pillar" {
        return [0xAA, 0x7A, 0xAA, 255];
    }
    if name == "sculk" || name == "sculk_catalyst" || name == "sculk_shrieker" {
        return [0x1B, 0x2F, 0x33, 255];
    }
    if name.contains("amethyst") {
        return [0xA0, 0x78, 0xC8, 255];
    }
    if name.contains("log") || name.contains("wood") || name.ends_with("_stem") || name.ends_with("_hyphae") {
        let color = wood_color(name);
        return [color[0], color[1], color[2], 255];
    }
    if name.contains("planks") {
        let color = wood_color(name);
        return [color[0], color[1], color[2], 255];
    }
    if name.contains("wool") || name.contains("concrete") || name.contains("glazed") {
        if let Some(color) = dye_color(name) {
            return [color[0], color[1], color[2], 255];
        }
        return [0xB8, 0xB8, 0xB8, 255];
    }
    if name.contains("glass") {
        if let Some(color) = dye_color(name) {
            return [color[0], color[1], color[2], 190];
        }
        return [0xC8, 0xD8, 0xE2, 190];
    }
    if name.contains("copper") {
        return [0x9C, 0x6A, 0x50, 255];
    }
    if name.contains("quartz") {
        return [0xE3, 0xDF, 0xD6, 255];
    }
    if name.contains("nether_brick") {
        return [0x2D, 0x16, 0x1C, 255];
    }
    if name.contains("end_stone") {
        return [0xDB, 0xDE, 0x9E, 255];
    }
    if name.contains("purpur") {
        return [0xAA, 0x7A, 0xAA, 255];
    }
    if name.contains("sculk") {
        return [0x1B, 0x2F, 0x33, 255];
    }
    if name.contains("mushroom_block") {
        return [0xB0, 0x8F, 0x7A, 255];
    }
    if name == "mushroom_stem" {
        return [0xC4, 0xBB, 0xAC, 255];
    }
    if name.contains("hay_block") {
        return [0xB8, 0x9B, 0x38, 255];
    }
    if name.contains("pumpkin") {
        return [0xD9, 0x8C, 0x1E, 255];
    }
    if name.contains("melon") {
        return [0x6D, 0xA5, 0x36, 255];
    }
    if name == "cactus" {
        return [0x5B, 0x8B, 0x3C, 255];
    }
    if name.contains("bamboo_block") || name.contains("bamboo_planks") {
        return [0xC5, 0xB6, 0x5A, 255];
    }
    if name.contains("wool")
        || name.contains("concrete")
        || name.contains("terracotta")
        || name.contains("glass")
    {
        if let Some(color) = dye_color(name) {
            return [color[0], color[1], color[2], if name.contains("glass") { 190 } else { 255 }];
        }
    }
    [0x6E, 0x73, 0x6A, 255]
}

fn parse_section(
    payload: &Value,
    data_version: i64,
    interner: &mut Interner,
    legacy_biomes: Option<&[u16]>,
) -> Option<ParsedSection> {
    let y = node_value(payload, "Y").and_then(Value::as_i64).unwrap_or(0) as i32;
    let mut names = Vec::new();
    let mut ids = Vec::new();
    let mut blocks = Vec::new();
    let mut biome_ids = Vec::new();
    let mut biome_indices = Vec::new();
    let mut legacy = Vec::new();

    if let Some(block_states) = node_value(payload, "block_states") {
        let (palette_names, palette_ids) = palette_names(
            node_value(block_states, "palette").unwrap_or(&Value::Null),
            interner,
        );
        names = palette_names;
        ids = palette_ids;
        let data = node_value(block_states, "data").map(nbt_longs).unwrap_or_default();
        let bits = bits_for(names.len(), 4);
        blocks = if bits == 0 || data.is_empty() {
            vec![0; 4096]
        } else {
            unpack_non_crossing(&data, bits, 4096)
        };
        if let Some(biomes) = node_value(payload, "biomes") {
            let (_, bids) = biome_palette(
                node_value(biomes, "palette").unwrap_or(&Value::Null),
                interner,
            );
            biome_ids = bids;
            let bdata = node_value(biomes, "data").map(nbt_longs).unwrap_or_default();
            let bbits = bits_for(biome_ids.len(), 1);
            biome_indices = if bbits == 0 || bdata.is_empty() {
                vec![0; 64]
            } else {
                unpack_non_crossing(&bdata, bbits, 64)
            };
        }
    } else if let Some(palette) = node_value(payload, "Palette") {
        let (palette_names, palette_ids) = palette_names(palette, interner);
        names = palette_names;
        ids = palette_ids;
        let data = node_value(payload, "BlockStates").map(nbt_longs).unwrap_or_default();
        let bits = bits_for(names.len(), 4);
        blocks = if bits == 0 || data.is_empty() {
            vec![0; 4096]
        } else if data_version >= 2529 {
            unpack_non_crossing(&data, bits, 4096)
        } else {
            unpack_crossing(&data, bits, 4096)
        };
    } else {
        return None;
    }

    if biome_indices.is_empty() {
        if let Some(legacy_biomes) = legacy_biomes {
            legacy = legacy_biomes.to_vec();
        }
    }

    Some(ParsedSection {
        y,
        names,
        ids,
        blocks,
        biome_ids,
        biome_indices,
        legacy_biomes: legacy,
    })
}

fn legacy_block_name(id: u8) -> &'static str {
    match id {
        0 => "air",
        1 => "stone",
        2 => "grass_block",
        3 => "dirt",
        4 => "cobblestone",
        7 => "bedrock",
        8 | 9 => "water",
        10 | 11 => "lava",
        12 => "sand",
        13 => "gravel",
        17 => "oak_log",
        18 => "oak_leaves",
        24 => "sandstone",
        31 => "short_grass",
        37 | 38 => "dandelion",
        50 => "torch",
        78 => "snow_layer",
        79 => "ice",
        80 => "snow",
        81 => "cactus",
        82 => "clay",
        83 => "sugar_cane",
        87 => "netherrack",
        88 => "soul_sand",
        89 => "glowstone",
        98 => "stone_bricks",
        110 => "mycelium",
        111 => "lily_pad",
        121 => "end_stone",
        159 => "terracotta",
        161 => "jungle_leaves",
        162 => "jungle_log",
        174 => "packed_ice",
        175 => "sunflower",
        _ => "stone",
    }
}

fn legacy_sections(level: &Value, interner: &mut Interner, biomes: &[u16]) -> Vec<ParsedSection> {
    let Some(blocks) = node_value(level, "Blocks").and_then(Value::as_array) else {
        return Vec::new();
    };
    if blocks.len() < 16 * 4096 {
        return Vec::new();
    }
    let mut sections = Vec::new();
    for section_index in 0..16usize {
        let mut names: Vec<String> = Vec::new();
        let mut ids: Vec<u16> = Vec::new();
        let mut indices = Vec::with_capacity(4096);
        let mut lookup: HashMap<u8, u16> = HashMap::new();
        for local in 0..4096usize {
            let id = blocks
                .get(section_index * 4096 + local)
                .and_then(Value::as_i64)
                .unwrap_or(0) as u8;
            let palette_index = if let Some(index) = lookup.get(&id) {
                *index
            } else {
                let index = ids.len() as u16;
                let name = legacy_block_name(id).to_string();
                ids.push(interner.intern(&name));
                names.push(name);
                lookup.insert(id, index);
                index
            };
            indices.push(palette_index);
        }
        sections.push(ParsedSection {
            y: section_index as i32,
            names,
            ids,
            blocks: indices,
            biome_ids: Vec::new(),
            biome_indices: Vec::new(),
            legacy_biomes: biomes.to_vec(),
        });
    }
    sections
}

fn parse_chunk(root: &Value, interner: &mut Interner) -> Option<(i32, i32, Vec<MapSurface>)> {
    let root_payload = root.get("value")?;
    let level = node_value(root_payload, "Level");
    let data = level.unwrap_or(root_payload);
    let data_version = node_value(data, "DataVersion")
        .or_else(|| node_value(root_payload, "DataVersion"))
        .and_then(Value::as_i64)
        .unwrap_or(0);
    let x = node_value(data, "xPos")
        .or_else(|| node_value(root_payload, "xPos"))
        .and_then(Value::as_i64)
        .unwrap_or(0) as i32;
    let z = node_value(data, "zPos")
        .or_else(|| node_value(root_payload, "zPos"))
        .and_then(Value::as_i64)
        .unwrap_or(0) as i32;

    let mut legacy_biome_names: Vec<String> = Vec::new();
    if let Some(biomes) = node_value(data, "Biomes").and_then(Value::as_array) {
        for value in biomes.iter().take(256) {
            let id = value.as_i64().unwrap_or(0);
            legacy_biome_names.push(biome_from_id(id).to_string());
        }
    }
    let legacy_biome_ids: Vec<u16> = legacy_biome_names
        .iter()
        .map(|name| interner.intern(name))
        .collect();

    let mut sections: Vec<ParsedSection> = Vec::new();
    let sections_value = node_value(data, "sections").or_else(|| node_value(data, "Sections"));
    if let Some(list) = sections_value.and_then(Value::as_array) {
        for section_node in list {
            let Some(payload) = section_node.get("value") else { continue };
            if let Some(section) = parse_section(
                payload,
                data_version,
                interner,
                if legacy_biome_ids.is_empty() { None } else { Some(&legacy_biome_ids) },
            ) {
                sections.push(section);
            }
        }
    }
    if sections.is_empty() && !legacy_biome_ids.is_empty() {
        sections = legacy_sections(data, interner, &legacy_biome_ids);
    }
    if sections.is_empty() {
        let heights = crate::mc::world::heightmap_from_nbt(root)?;
        let water = interner.intern("water");
        let sand = interner.intern("sand");
        let grass = interner.intern("grass_block");
        let stone = interner.intern("stone");
        let snow = interner.intern("snow");
        let plains = interner.intern("plains");
        let mut surfaces = Vec::with_capacity(256);
        for zi in 0..16usize {
            for xi in 0..16usize {
                let height = heights.get(zi * 16 + xi).copied().unwrap_or(64) as i32;
                let coastal = heights
                    .get(zi * 16 + xi.saturating_sub(1))
                    .copied()
                    .unwrap_or(0);
                if height <= 63 {
                    let depth = (64 - height).clamp(1, 40) as u16;
                    surfaces.push(MapSurface {
                        height: 63,
                        block: water,
                        biome: plains,
                        water_depth: depth,
                        floor: sand,
                    });
                } else {
                    let block = if height >= 120 {
                        snow
                    } else if height <= 66 || coastal <= 63 {
                        sand
                    } else if height >= 100 {
                        stone
                    } else {
                        grass
                    };
                    surfaces.push(MapSurface {
                        height,
                        block,
                        biome: plains,
                        water_depth: 0,
                        floor: block,
                    });
                }
            }
        }
        return Some((x, z, surfaces));
    }

    sections.sort_by(|a, b| b.y.cmp(&a.y));
    let water_id = interner.intern("water");
    let default_biome = interner.intern("plains");
    let mut surfaces = Vec::with_capacity(256);
    for zi in 0..16usize {
        for xi in 0..16usize {
            let mut surface: Option<MapSurface> = None;
            let mut water_top: Option<i32> = None;
            let mut water_biome = default_biome;
            'outer: for section in &sections {
                for ly in (0..16usize).rev() {
                    let local = section.block(xi, ly, zi);
                    let name = section.name(local);
                    if is_air(name) {
                        continue;
                    }
                    let world_y = section.y * 16 + ly as i32;
                    if water_top.is_none() {
                        if is_water(name) {
                            water_top = Some(world_y);
                            water_biome = section.biome(xi, ly, zi, default_biome);
                            continue;
                        }
                        if is_ignored(name) {
                            continue;
                        }
                        let biome = section.biome(xi, ly, zi, default_biome);
                        surface = Some(MapSurface {
                            height: world_y,
                            block: section.global(local),
                            biome,
                            water_depth: 0,
                            floor: section.global(local),
                        });
                        break 'outer;
                    } else {
                        if is_water(name) || is_ignored(name) {
                            continue;
                        }
                        let top = water_top.unwrap_or(world_y);
                        surface = Some(MapSurface {
                            height: top,
                            block: water_id,
                            biome: water_biome,
                            water_depth: (top - world_y).clamp(1, 255) as u16,
                            floor: section.global(local),
                        });
                        break 'outer;
                    }
                }
            }
            if surface.is_none() {
                if let Some(top) = water_top {
                    surface = Some(MapSurface {
                        height: top,
                        block: water_id,
                        biome: water_biome,
                        water_depth: 32,
                        floor: water_id,
                    });
                }
            }
            surfaces.push(surface.unwrap_or_default());
        }
    }
    Some((x, z, surfaces))
}

fn parse_region(
    path: &Path,
    interner: &mut Interner,
) -> Vec<(i32, i32, Vec<MapSurface>)> {
    let Ok(bytes) = std::fs::read(path) else {
        return Vec::new();
    };
    if bytes.len() < 8192 {
        return Vec::new();
    }
    let name = path.file_stem().map(|v| v.to_string_lossy().into_owned()).unwrap_or_default();
    let mut parts = name.split('.');
    let _ = parts.next();
    let rx: i32 = parts.next().and_then(|v| v.parse().ok()).unwrap_or(0);
    let rz: i32 = parts.next().and_then(|v| v.parse().ok()).unwrap_or(0);
    let mut out = Vec::new();
    for chunk_index in 0..1024usize {
        let at = chunk_index * 4;
        if at + 4 > bytes.len() {
            break;
        }
        let offset_sectors = ((bytes[at] as usize) << 16) | ((bytes[at + 1] as usize) << 8) | bytes[at + 2] as usize;
        let sectors = bytes[at + 3] as usize;
        if offset_sectors == 0 || sectors == 0 {
            continue;
        }
        let start = offset_sectors.saturating_mul(4096);
        if start + 5 > bytes.len() {
            continue;
        }
        let length = u32::from_be_bytes([bytes[start], bytes[start + 1], bytes[start + 2], bytes[start + 3]]) as usize;
        if length < 2 || start + 4 + length > bytes.len() {
            continue;
        }
        let compression = bytes[start + 4];
        let payload = &bytes[start + 5..start + 4 + length];
        let raw = match compression {
            1 => {
                let mut decoder = flate2::read::GzDecoder::new(payload);
                let mut out = Vec::new();
                if decoder.read_to_end(&mut out).is_err() {
                    continue;
                }
                out
            }
            2 => {
                let mut decoder = flate2::read::ZlibDecoder::new(payload);
                let mut out = Vec::new();
                if decoder.read_to_end(&mut out).is_err() {
                    continue;
                }
                out
            }
            3 => payload.to_vec(),
            _ => continue,
        };
        let Ok(root) = crate::mc::world::parse_bytes(&raw) else {
            continue;
        };
        if let Some((_, _, surfaces)) = parse_chunk(&root, interner) {
            let cx = rx * 32 + (chunk_index % 32) as i32;
            let cz = rz * 32 + (chunk_index / 32) as i32;
            out.push((cx, cz, surfaces));
        }
    }
    out
}

pub fn build(
    world_dir: &Path,
    shared: &Path,
    version_hints: &[String],
    target: &Path,
) -> Result<(u32, u32, usize, i32, i32, i32, i32)> {
    let regions = world_dir.join("region");
    let mut entries: Vec<PathBuf> = std::fs::read_dir(&regions)
        .map(|items| {
            items
                .flatten()
                .map(|item| item.path())
                .filter(|path| {
                    path.extension()
                        .map(|ext| ext.to_string_lossy().eq_ignore_ascii_case("mca"))
                        .unwrap_or(false)
                })
                .collect()
        })
        .unwrap_or_default();
    if entries.is_empty() {
        return Err(anyhow!("World chưa có tệp region nào."));
    }
    entries.sort();
    let mut interner = Interner::new();
    let parse_budget = 4096usize;
    let mut chunks = Vec::new();
    for path in &entries {
        let mut region = parse_region(path, &mut interner);
        region.retain(|(_, _, surfaces)| {
            surfaces
                .iter()
                .any(|surface| surface.height != 0 || surface.block != 0)
        });
        if region.is_empty() {
            continue;
        }
        if chunks.len() + region.len() > parse_budget {
            region.truncate(parse_budget.saturating_sub(chunks.len()));
        }
        chunks.extend(region);
        if chunks.len() >= parse_budget {
            break;
        }
    }
    if chunks.is_empty() {
        return Err(anyhow!("Không đọc được dữ liệu địa hình. World có thể dùng định dạng mới hơn."));
    }
    let min_cx = chunks.iter().map(|(x, _, _)| *x).min().unwrap_or(0);
    let max_cx = chunks.iter().map(|(x, _, _)| *x).max().unwrap_or(0);
    let min_cz = chunks.iter().map(|(_, z, _)| *z).min().unwrap_or(0);
    let max_cz = chunks.iter().map(|(_, z, _)| *z).max().unwrap_or(0);
    let chunks_x = (max_cx - min_cx + 1) as u32;
    let chunks_z = (max_cz - min_cz + 1) as u32;
    let width = chunks_x * 16;
    let height = chunks_z * 16;
    if width == 0 || height == 0 || width > 4096 || height > 4096 {
        return Err(anyhow!("Kích thước bản đồ quá lớn."));
    }
    let maps = load_colormaps(shared, version_hints);
    let mut tones: HashMap<u16, Tone> = HashMap::new();
    let mut chunk_map: HashMap<(i32, i32), Vec<MapSurface>> = HashMap::new();
    for (cx, cz, surfaces) in chunks {
        chunk_map.insert((cx, cz), surfaces);
    }
    let mut image = RgbaImage::from_pixel(width, height, image::Rgba([0, 0, 0, 0]));
    for cz in 0..chunks_z {
        for cx in 0..chunks_x {
            let key = (min_cx + cx as i32, min_cz + cz as i32);
            let Some(surfaces) = chunk_map.get(&key) else { continue };
            for zi in 0..16usize {
                for xi in 0..16usize {
                    let index = zi * 16 + xi;
                    let surface = surfaces.get(index).copied().unwrap_or_default();
                    if surface.height == 0 && surface.block == 0 {
                        continue;
                    }
                    let block_name = interner.name(surface.block);
                    let biome_name = interner.name(surface.biome);
                    let tone = tones.entry(surface.biome).or_insert_with(|| tone_for(biome_name, maps.as_ref()));
                    let mut color = block_color(block_name, tone);
                    if is_water(block_name) {
                        let depth = surface.water_depth.max(1) as f32;
                        let factor = (depth / 16.0).clamp(0.0, 1.0);
                        let floor_name = interner.name(surface.floor);
                        let floor_color = block_color(floor_name, tone);
                        let deep = scale(tone.water, 0.30);
                        let shallow = mix(tone.water, [floor_color[0], floor_color[1], floor_color[2]], (1.0 - factor) * 0.55);
                        let mut rgb = mix(shallow, deep, factor * 0.6);
                        if depth <= 4.0 && floor_name.contains("sand") {
                            rgb = mix(rgb, [0x6F, 0xD0, 0xD8], 0.18);
                        }
                        color = [rgb[0], rgb[1], rgb[2], (145.0 + 100.0 * factor) as u8];
                    } else {
                        let left = surfaces
                            .get(zi * 16 + xi.saturating_sub(1))
                            .map(|row| row.height)
                            .unwrap_or(surface.height);
                        let up = surfaces
                            .get(zi.saturating_sub(1) * 16 + xi)
                            .map(|row| row.height)
                            .unwrap_or(surface.height);
                        let slope = ((surface.height - left) + (surface.height - up)).clamp(-12, 12);
                        let factor = 1.0 + slope as f32 * 0.012;
                        color[0] = (color[0] as f32 * factor).clamp(0.0, 255.0) as u8;
                        color[1] = (color[1] as f32 * factor).clamp(0.0, 255.0) as u8;
                        color[2] = (color[2] as f32 * factor).clamp(0.0, 255.0) as u8;
                    }
                    image.put_pixel(cx * 16 + xi as u32, cz * 16 + zi as u32, image::Rgba(color));
                }
            }
        }
    }
    image.save(target)?;
    Ok((
        width,
        height,
        chunk_map.len(),
        min_cx,
        min_cz,
        max_cx,
        max_cz,
    ))
}

#[cfg(test)]
mod render_tests {
    use super::*;
    use serde_json::json;

    fn encode_blocks(indices: &[u16]) -> Vec<String> {
        let mut longs = vec![0u64; 4096 / 16];
        for (i, value) in indices.iter().enumerate() {
            let word = i / 16;
            let offset = (i % 16) * 4;
            longs[word] |= (*value as u64 & 0xF) << offset;
        }
        longs.into_iter().map(|value| value.to_string()).collect()
    }

    fn node(kind: &str, name: &str, value: Value) -> Value {
        json!({"type": kind, "name": name, "value": value})
    }

    #[test]
    fn snow_layer_and_water_depth_are_detected() {
        let mut blocks = vec![0u16; 4096];
        let at = |x: usize, y: usize, z: usize| (y * 16 + z) * 16 + x;
        blocks[at(0, 0, 0)] = 1;
        blocks[at(0, 1, 0)] = 2;
        blocks[at(1, 0, 0)] = 4;
        for y in 1..=3 {
            blocks[at(1, y, 0)] = 3;
        }
        for y in 0..=3 {
            blocks[at(2, y, 0)] = 3;
        }
        let palette = json!([
            node("compound", "", json!([node("string", "Name", json!("minecraft:air"))])),
            node("compound", "", json!([node("string", "Name", json!("minecraft:grass_block"))])),
            node("compound", "", json!([node("string", "Name", json!("minecraft:snow_layer"))])),
            node("compound", "", json!([node("string", "Name", json!("minecraft:water"))])),
            node("compound", "", json!([node("string", "Name", json!("minecraft:sand"))]))
        ]);
        let block_states = node("compound", "block_states", json!([
            node("list", "palette", palette),
            node("longArray", "data", json!(encode_blocks(&blocks)))
        ]));
        let biomes = node("compound", "biomes", json!([
            node("list", "palette", json!([node("string", "", json!("minecraft:plains"))]))
        ]));
        let section = node("compound", "", json!([
            node("byte", "Y", json!(0)),
            block_states,
            biomes
        ]));
        let root = node("compound", "", json!([
            node("int", "DataVersion", json!(3465)),
            node("int", "xPos", json!(0)),
            node("int", "zPos", json!(0)),
            node("list", "sections", json!([section]))
        ]));
        let mut interner = Interner::new();
        let (_, _, surfaces) = parse_chunk(&root, &mut interner).expect("chunk");
        let snow = surfaces[0];
        assert_eq!(interner.name(snow.block), "snow_layer");
        assert_eq!(snow.height, 1);
        assert_eq!(snow.water_depth, 0);
        let shallow = surfaces[1];
        assert_eq!(interner.name(shallow.block), "water");
        assert_eq!(shallow.height, 3);
        assert_eq!(shallow.water_depth, 3);
        assert_eq!(interner.name(shallow.floor), "sand");
        let deep = surfaces[2];
        assert_eq!(interner.name(deep.block), "water");
        assert_eq!(deep.water_depth, 32);
    }
}
