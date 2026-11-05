use crate::models::FileEntry;
use anyhow::{anyhow, Result};
use serde_json::{Value, json};
use std::io::{Cursor, Read, Write};
use std::path::{Path, PathBuf};

const TAG_END: u8 = 0;
const TAG_BYTE: u8 = 1;
const TAG_SHORT: u8 = 2;
const TAG_INT: u8 = 3;
const TAG_LONG: u8 = 4;
const TAG_FLOAT: u8 = 5;
const TAG_DOUBLE: u8 = 6;
const TAG_BYTE_ARRAY: u8 = 7;
const TAG_STRING: u8 = 8;
const TAG_LIST: u8 = 9;
const TAG_COMPOUND: u8 = 10;
const TAG_INT_ARRAY: u8 = 11;
const TAG_LONG_ARRAY: u8 = 12;

fn type_name(kind: u8) -> &'static str {
    match kind {
        TAG_BYTE => "byte",
        TAG_SHORT => "short",
        TAG_INT => "int",
        TAG_LONG => "long",
        TAG_FLOAT => "float",
        TAG_DOUBLE => "double",
        TAG_BYTE_ARRAY => "byteArray",
        TAG_STRING => "string",
        TAG_LIST => "list",
        TAG_COMPOUND => "compound",
        TAG_INT_ARRAY => "intArray",
        TAG_LONG_ARRAY => "longArray",
        _ => "end",
    }
}

fn type_id(name: &str) -> Result<u8> {
    Ok(match name {
        "byte" => TAG_BYTE,
        "short" => TAG_SHORT,
        "int" => TAG_INT,
        "long" => TAG_LONG,
        "float" => TAG_FLOAT,
        "double" => TAG_DOUBLE,
        "byteArray" => TAG_BYTE_ARRAY,
        "string" => TAG_STRING,
        "list" => TAG_LIST,
        "compound" => TAG_COMPOUND,
        "intArray" => TAG_INT_ARRAY,
        "longArray" => TAG_LONG_ARRAY,
        other => return Err(anyhow!("Tag không hỗ trợ: {other}")),
    })
}

struct Reader<'a> {
    data: &'a [u8],
    at: usize,
}

impl<'a> Reader<'a> {
    fn new(data: &'a [u8]) -> Self {
        Self { data, at: 0 }
    }

    fn ensure(&self, n: usize) -> Result<()> {
        if self.at + n > self.data.len() {
            return Err(anyhow!("Tệp NBT bị cắt ngắn"));
        }
        Ok(())
    }

    fn u8(&mut self) -> Result<u8> {
        self.ensure(1)?;
        let value = self.data[self.at];
        self.at += 1;
        Ok(value)
    }

    fn i8(&mut self) -> Result<i8> {
        Ok(self.u8()? as i8)
    }

    fn i16(&mut self) -> Result<i16> {
        self.ensure(2)?;
        let value = i16::from_be_bytes([self.data[self.at], self.data[self.at + 1]]);
        self.at += 2;
        Ok(value)
    }

    fn u16(&mut self) -> Result<u16> {
        Ok(self.i16()? as u16)
    }

    fn i32(&mut self) -> Result<i32> {
        self.ensure(4)?;
        let value = i32::from_be_bytes([
            self.data[self.at],
            self.data[self.at + 1],
            self.data[self.at + 2],
            self.data[self.at + 3],
        ]);
        self.at += 4;
        Ok(value)
    }

    fn i64(&mut self) -> Result<i64> {
        self.ensure(8)?;
        let mut bytes = [0u8; 8];
        bytes.copy_from_slice(&self.data[self.at..self.at + 8]);
        self.at += 8;
        Ok(i64::from_be_bytes(bytes))
    }

    fn f32(&mut self) -> Result<f32> {
        Ok(f32::from_bits(self.i32()? as u32))
    }

    fn f64(&mut self) -> Result<f64> {
        Ok(f64::from_bits(self.i64()? as u64))
    }

    fn text(&mut self) -> Result<String> {
        let size = self.u16()? as usize;
        self.ensure(size)?;
        let value = String::from_utf8_lossy(&self.data[self.at..self.at + size]).to_string();
        self.at += size;
        Ok(value)
    }

    fn payload(&mut self, kind: u8, depth: u32) -> Result<Value> {
        if depth > 256 {
            return Err(anyhow!("NBT lồng quá sâu"));
        }
        Ok(match kind {
            TAG_BYTE => json!(self.i8()?),
            TAG_SHORT => json!(self.i16()?),
            TAG_INT => json!(self.i32()?),
            TAG_LONG => json!(self.i64()?.to_string()),
            TAG_FLOAT => json!(self.f32()?),
            TAG_DOUBLE => json!(self.f64()?),
            TAG_BYTE_ARRAY => {
                let size = self.i32()?.max(0) as usize;
                if size > 20_000_000 {
                    return Err(anyhow!("Mảng NBT quá lớn"));
                }
                let mut out = Vec::with_capacity(size.min(1_000_000));
                for _ in 0..size {
                    out.push(json!(self.i8()?));
                }
                Value::Array(out)
            }
            TAG_STRING => json!(self.text()?),
            TAG_LIST => {
                let item_type = self.u8()?;
                let size = self.i32()?.max(0) as usize;
                if size > 10_000_000 {
                    return Err(anyhow!("Danh sách NBT quá lớn"));
                }
                let mut out = Vec::with_capacity(size.min(65536));
                for _ in 0..size {
                    out.push(json!({
                        "type": type_name(item_type),
                        "name": "",
                        "value": self.payload(item_type, depth + 1)?,
                    }));
                }
                Value::Array(out)
            }
            TAG_COMPOUND => {
                let mut out = Vec::new();
                loop {
                    let child_type = self.u8()?;
                    if child_type == TAG_END {
                        break;
                    }
                    let name = self.text()?;
                    out.push(json!({
                        "type": type_name(child_type),
                        "name": name,
                        "value": self.payload(child_type, depth + 1)?,
                    }));
                }
                Value::Array(out)
            }
            TAG_INT_ARRAY => {
                let size = self.i32()?.max(0) as usize;
                if size > 20_000_000 {
                    return Err(anyhow!("Mảng NBT quá lớn"));
                }
                let mut out = Vec::with_capacity(size.min(1_000_000));
                for _ in 0..size {
                    out.push(json!(self.i32()?));
                }
                Value::Array(out)
            }
            TAG_LONG_ARRAY => {
                let size = self.i32()?.max(0) as usize;
                if size > 20_000_000 {
                    return Err(anyhow!("Mảng NBT quá lớn"));
                }
                let mut out = Vec::with_capacity(size.min(1_000_000));
                for _ in 0..size {
                    out.push(json!(self.i64()?.to_string()));
                }
                Value::Array(out)
            }
            other => return Err(anyhow!("Tag không hỗ trợ: {other}")),
        })
    }
}

pub fn parse_bytes(raw: &[u8]) -> Result<Value> {
    let is_gzip = raw.len() > 2 && raw[0] == 0x1f && raw[1] == 0x8b;
    let data = if is_gzip {
        let mut decoder = flate2::read::GzDecoder::new(raw);
        let mut out = Vec::new();
        decoder.read_to_end(&mut out)?;
        out
    } else {
        raw.to_vec()
    };
    let mut reader = Reader::new(&data);
    let kind = reader.u8()?;
    if kind != TAG_COMPOUND {
        return Err(anyhow!("Tệp NBT không bắt đầu bằng compound."));
    }
    let name = reader.text()?;
    Ok(json!({
        "type": "compound",
        "name": name,
        "value": reader.payload(TAG_COMPOUND, 0)?,
    }))
}

fn write_payload(out: &mut Vec<u8>, kind: &str, value: &Value) -> Result<()> {
    match kind {
        "byte" => out.push(value.as_i64().unwrap_or(0) as u8),
        "short" => out.extend_from_slice(&(value.as_i64().unwrap_or(0) as i16).to_be_bytes()),
        "int" => out.extend_from_slice(&(value.as_i64().unwrap_or(0) as i32).to_be_bytes()),
        "long" => {
            let text = value
                .as_str()
                .map(str::to_string)
                .unwrap_or_else(|| value.to_string());
            let number: i64 = text.trim().parse().unwrap_or(0);
            out.extend_from_slice(&number.to_be_bytes());
        }
        "float" => out.extend_from_slice(&(value.as_f64().unwrap_or(0.0) as f32).to_bits().to_be_bytes()),
        "double" => out.extend_from_slice(&value.as_f64().unwrap_or(0.0).to_bits().to_be_bytes()),
        "string" => {
            let text = value.as_str().unwrap_or("");
            let bytes = text.as_bytes();
            out.extend_from_slice(&(bytes.len() as u16).to_be_bytes());
            out.extend_from_slice(bytes);
        }
        "byteArray" => {
            let list = value.as_array().cloned().unwrap_or_default();
            out.extend_from_slice(&(list.len() as i32).to_be_bytes());
            for item in list {
                out.push(item.as_i64().unwrap_or(0) as u8);
            }
        }
        "intArray" => {
            let list = value.as_array().cloned().unwrap_or_default();
            out.extend_from_slice(&(list.len() as i32).to_be_bytes());
            for item in list {
                out.extend_from_slice(&(item.as_i64().unwrap_or(0) as i32).to_be_bytes());
            }
        }
        "longArray" => {
            let list = value.as_array().cloned().unwrap_or_default();
            out.extend_from_slice(&(list.len() as i32).to_be_bytes());
            for item in list {
                let number: i64 = item
                    .as_str()
                    .and_then(|v| v.parse().ok())
                    .or_else(|| item.as_i64())
                    .unwrap_or(0);
                out.extend_from_slice(&number.to_be_bytes());
            }
        }
        "list" => {
            let list = value.as_array().cloned().unwrap_or_default();
            let item_kind = list
                .first()
                .and_then(|v| v.get("type"))
                .and_then(Value::as_str)
                .unwrap_or("end");
            out.push(if item_kind == "end" {
                TAG_END
            } else {
                type_id(item_kind)?
            });
            out.extend_from_slice(&(list.len() as i32).to_be_bytes());
            for item in list {
                let kind = item.get("type").and_then(Value::as_str).unwrap_or("end");
                let value = item.get("value").cloned().unwrap_or(Value::Null);
                write_payload(out, kind, &value)?;
            }
        }
        "compound" => {
            let list = value.as_array().cloned().unwrap_or_default();
            for item in list {
                let kind = item.get("type").and_then(Value::as_str).unwrap_or("end");
                let name = item.get("name").and_then(Value::as_str).unwrap_or("");
                out.push(type_id(kind)?);
                let bytes = name.as_bytes();
                out.extend_from_slice(&(bytes.len() as u16).to_be_bytes());
                out.extend_from_slice(bytes);
                write_payload(out, kind, item.get("value").unwrap_or(&Value::Null))?;
            }
            out.push(TAG_END);
        }
        other => return Err(anyhow!("Tag không hỗ trợ: {other}")),
    }
    Ok(())
}

pub fn serialize_root(root: &Value) -> Result<Vec<u8>> {
    let mut out = Vec::new();
    out.push(TAG_COMPOUND);
    let name = root.get("name").and_then(Value::as_str).unwrap_or("");
    out.extend_from_slice(&(name.len() as u16).to_be_bytes());
    out.extend_from_slice(name.as_bytes());
    write_payload(&mut out, "compound", root.get("value").unwrap_or(&Value::Null))?;
    Ok(out)
}

pub fn read_nbt(path: &Path) -> Result<Value> {
    let size = std::fs::metadata(path)?.len();
    if size > 128 * 1024 * 1024 {
        return Err(anyhow!("Tệp NBT quá lớn"));
    }
    let raw = std::fs::read(path)?;
    parse_bytes(&raw)
}

pub fn write_nbt(path: &Path, root: &Value, gzip: bool, backup: bool) -> Result<usize> {
    let body = serialize_root(root)?;
    let out = if gzip {
        let mut encoder = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::new(6));
        encoder.write_all(&body)?;
        encoder.finish()?
    } else {
        body
    };
    if backup && path.is_file() {
        let _ = std::fs::copy(path, path.with_extension("bak"));
    }
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::write(path, &out)?;
    Ok(out.len())
}

fn node_value<'a>(list: &'a Value, name: &str) -> Option<&'a Value> {
    list.as_array()?
        .iter()
        .find(|node| node.get("name").and_then(Value::as_str) == Some(name))
        .and_then(|node| node.get("value"))
}

fn node_kind<'a>(list: &'a Value, name: &str) -> Option<&'a str> {
    list.as_array()?
        .iter()
        .find(|node| node.get("name").and_then(Value::as_str) == Some(name))
        .and_then(|node| node.get("type"))
        .and_then(Value::as_str)
}

fn heightmap_from_nbt(root: &Value) -> Option<Vec<u16>> {
    let root_list = root.get("value")?;
    let data = node_value(root_list, "Level").unwrap_or(root_list);
    let heightmaps = node_value(data, "Heightmaps");
    if let Some(heightmaps) = heightmaps {
        for key in ["MOTION_BLOCKING", "WORLD_SURFACE", "MOTION_BLOCKING_NO_LEAVES"] {
            if let Some(list) = node_value(heightmaps, key) {
                if let Some(array) = list.as_array() {
                    let longs: Vec<u64> = array
                        .iter()
                        .filter_map(|value| {
                            value
                                .as_str()
                                .and_then(|text| text.parse::<i64>().ok())
                                .map(|number| number as u64)
                                .or_else(|| value.as_u64())
                        })
                        .collect();
                    if longs.len() >= 8 {
                        let bits = ((longs.len() * 64) / 256).clamp(4, 12) as u32;
                        let per_long = (64 / bits) as usize;
                        if per_long > 0 {
                            let mut heights = Vec::with_capacity(256);
                            let mask = (1u64 << bits) - 1;
                            for index in 0..256usize {
                                let long_index = index / per_long;
                                let offset = (index % per_long) as u32 * bits;
                                let value = longs
                                    .get(long_index)
                                    .map(|word| (word >> offset) & mask)
                                    .unwrap_or(0) as u16;
                                heights.push(value);
                            }
                            let average = heights.iter().map(|v| *v as u32).sum::<u32>() / 256;
                            let offset = if average > 100 { 64 } else { 0 };
                            if offset > 0 {
                                for height in &mut heights {
                                    *height = height.saturating_sub(offset);
                                }
                            }
                            return Some(heights);
                        }
                    }
                }
            }
        }
    }
    if let Some(list) = node_value(data, "Heightmap") {
        if let Some(array) = list.as_array() {
            if array.len() >= 256 {
                return Some(
                    array
                        .iter()
                        .take(256)
                        .map(|value| value.as_i64().unwrap_or(0).clamp(0, 512) as u16)
                        .collect(),
                );
            }
        }
    }
    None
}

fn parse_region(path: &Path) -> Vec<(i32, i32, Vec<u16>)> {
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
                if std::io::Read::read_to_end(&mut decoder, &mut out).is_err() {
                    continue;
                }
                out
            }
            2 => {
                let mut decoder = flate2::read::ZlibDecoder::new(payload);
                let mut out = Vec::new();
                if std::io::Read::read_to_end(&mut decoder, &mut out).is_err() {
                    continue;
                }
                out
            }
            3 => payload.to_vec(),
            _ => continue,
        };
        let Ok(root) = parse_bytes(&raw) else {
            continue;
        };
        let Some(heights) = heightmap_from_nbt(&root) else {
            continue;
        };
        let cx = (chunk_index % 32) as i32;
        let cz = (chunk_index / 32) as i32;
        out.push((rx * 32 + cx, rz * 32 + cz, heights));
    }
    out
}

fn terrain_color(height: u16) -> [u8; 3] {
    match height {
        0..=61 => [30, 55, 92],
        62..=63 => [40, 82, 132],
        64 => [194, 178, 128],
        65..=95 => {
            let t = (height.saturating_sub(65) as f32 / 30.0).clamp(0.0, 1.0);
            [(86.0 - 26.0 * t) as u8, (124.0 + 8.0 * t) as u8, (72.0 - 22.0 * t) as u8]
        }
        96..=120 => [78, 96, 62],
        121..=160 => [120, 118, 108],
        161..=200 => [154, 152, 146],
        _ => [232, 236, 240],
    }
}

pub fn render_map(store: &crate::store::Store, instance_dir: &Path, world: &str) -> Result<Value> {
    let world_dir = world_dir(instance_dir, world)?;
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
    let stamp = entries
        .iter()
        .filter_map(|path| std::fs::metadata(path).and_then(|m| m.modified()).ok())
        .max()
        .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|duration| duration.as_secs())
        .unwrap_or(0);
    let cache_dir = store.data_dir.join("map-cache");
    std::fs::create_dir_all(&cache_dir)?;
    let key = format!(
        "v4-{}-{}-{}",
        crate::util::safe_name(world),
        crate::util::safe_name(&instance_dir.to_string_lossy()),
        stamp
    );
    let hash = {
        use sha1::{Digest, Sha1};
        let mut hasher = Sha1::new();
        hasher.update(key.as_bytes());
        crate::util::hex(&hasher.finalize())[..16].to_string()
    };
    let target = cache_dir.join(format!("map-{hash}.png"));
    if let Ok(raw) = std::fs::read_to_string(cache_dir.join(format!("map-{hash}.json"))) {
        if let Ok(meta) = serde_json::from_str::<Value>(&raw) {
            if target.is_file() {
                return Ok(meta);
            }
        }
    }

    let mut chunks = Vec::new();
    let mut budget = 4096usize;
    for path in &entries {
        let mut region = parse_region(path);
        if chunks.len() + region.len() > budget {
            region.truncate(budget.saturating_sub(chunks.len()));
        }
        chunks.extend(region);
        if chunks.len() >= budget {
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
    let mut map = std::collections::HashMap::new();
    for (cx, cz, heights) in chunks {
        map.insert((cx, cz), heights);
    }
    let mut image = image::RgbaImage::from_pixel(width, height, image::Rgba([12, 14, 18, 255]));
    for cz in 0..chunks_z {
        for cx in 0..chunks_x {
            let Some(heights) = map.get(&(min_cx + cx as i32, min_cz + cz as i32)) else {
                continue;
            };
            for z in 0..16u32 {
                for x in 0..16u32 {
                    let index = (z * 16 + x) as usize;
                    let h = heights.get(index).copied().unwrap_or(0);
                    let mut rgb = terrain_color(h);
                    let left = heights.get((z * 16 + x.saturating_sub(1)) as usize).copied().unwrap_or(h);
                    let up = heights
                        .get((z.saturating_sub(1) * 16 + x) as usize)
                        .copied()
                        .unwrap_or(h);
                    let shade = ((h as i32 - left as i32) + (h as i32 - up as i32)).clamp(-8, 8);
                    let factor = 1.0 + shade as f32 * 0.025;
                    for channel in &mut rgb {
                        *channel = ((*channel as f32) * factor).clamp(0.0, 255.0) as u8;
                    }
                    image.put_pixel(cx * 16 + x, cz * 16 + z, image::Rgba([rgb[0], rgb[1], rgb[2], 255]));
                }
            }
        }
    }
    image.save(&target)?;
    let meta = serde_json::json!({
        "path": target.to_string_lossy(),
        "width": width,
        "height": height,
        "chunks": map.len(),
        "minChunkX": min_cx,
        "minChunkZ": min_cz,
        "maxChunkX": max_cx,
        "maxChunkZ": max_cz,
    });
    let _ = std::fs::write(
        cache_dir.join(format!("map-{hash}.json")),
        serde_json::to_string(&meta).unwrap_or_default(),
    );
    Ok(meta)
}

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct WorldInfo {
    pub folder: String,
    pub name: String,
    pub size: u64,
    pub modified: u64,
    pub game_mode: Option<i32>,
    pub version: String,
    pub seed: String,
    pub icon: Option<String>,
    pub hardcore: bool,
}

fn find_child<'a>(list: &'a Value, name: &str) -> Option<&'a Value> {
    list.as_array()?
        .iter()
        .find(|node| node.get("name").and_then(Value::as_str) == Some(name))
        .and_then(|node| node.get("value"))
}

pub fn worlds(store: &crate::store::Store, instance_dir: &Path) -> Vec<WorldInfo> {
    let dir = instance_dir.join("saves");
    let Ok(entries) = std::fs::read_dir(&dir) else {
        return Vec::new();
    };
    let mut out = Vec::new();
    for entry in entries.flatten() {
        if !entry.path().is_dir() {
            continue;
        }
        let folder = entry.file_name().to_string_lossy().into_owned();
        let level = entry.path().join("level.dat");
        if !level.is_file() {
            continue;
        }
        let data = read_nbt(&level)
            .ok()
            .and_then(|root| find_child(root.get("value").unwrap_or(&Value::Null), "Data").cloned())
            .unwrap_or(Value::Null);
        let name = find_child(&data, "LevelName")
            .and_then(Value::as_str)
            .unwrap_or(&folder)
            .to_string();
        let game_mode = find_child(&data, "GameType").and_then(Value::as_i64).map(|v| v as i32);
        let version = find_child(&data, "Version")
            .and_then(|v| find_child(v, "Name"))
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string();
        let seed = find_child(&data, "RandomSeed")
            .map(|v| v.as_str().map(str::to_string).unwrap_or_else(|| v.to_string()))
            .unwrap_or_default();
        let hardcore = find_child(&data, "hardcore").and_then(Value::as_i64) == Some(1)
            || find_child(&data, "isHardcore").and_then(Value::as_i64) == Some(1);
        let modified = entry
            .metadata()
            .and_then(|m| m.modified())
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_secs())
            .unwrap_or(0);
        let icon = head_icon(store, &entry.path().join("icon.png"));
        out.push(WorldInfo {
            folder,
            name,
            size: 0,
            modified,
            game_mode,
            version,
            seed,
            icon,
            hardcore,
        });
    }
    out.sort_by(|a, b| b.modified.cmp(&a.modified));
    out
}

fn head_icon(store: &crate::store::Store, source: &Path) -> Option<String> {
    if !source.is_file() {
        return None;
    }
    let dir = store.data_dir.join("world-icons");
    std::fs::create_dir_all(&dir).ok()?;
    use sha1::{Digest, Sha1};
    let mut hasher = Sha1::new();
    hasher.update(source.to_string_lossy().as_bytes());
    hasher.update(std::fs::metadata(source).ok()?.modified().ok()?.duration_since(std::time::UNIX_EPOCH).ok()?.as_millis().to_string().as_bytes());
    let hash = crate::util::hex(&hasher.finalize())[..16].to_string();
    let target = dir.join(format!("{hash}.png"));
    if !target.is_file() {
        std::fs::copy(source, &target).ok()?;
    }
    Some(target.to_string_lossy().into_owned())
}

pub fn world_dir(instance_dir: &Path, folder: &str) -> Result<PathBuf> {
    let base = instance_dir.join("saves");
    let target = crate::store::safe_join(&base, folder)?;
    if target == base {
        return Err(anyhow!("World không hợp lệ"));
    }
    Ok(target)
}

pub fn list_tree(root: &Path, rel: &str) -> Result<Vec<FileEntry>> {
    let dir = crate::store::safe_join(root, rel)?;
    let mut out = Vec::new();
    for entry in std::fs::read_dir(&dir)?.flatten() {
        let meta = entry.metadata()?;
        let rel_path = if rel.trim_matches('/').is_empty() {
            entry.file_name().to_string_lossy().into_owned()
        } else {
            format!("{}/{}", rel.trim_matches('/'), entry.file_name().to_string_lossy())
        };
        out.push(FileEntry {
            name: entry.file_name().to_string_lossy().into_owned(),
            rel: rel_path,
            dir: meta.is_dir(),
            size: if meta.is_dir() { 0 } else { meta.len() },
            modified: meta
                .modified()
                .ok()
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_secs() as i64)
                .unwrap_or(0),
            disabled: false,
        });
    }
    out.sort_by(|a, b| b.dir.cmp(&a.dir).then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase())));
    Ok(out)
}

fn world_data(root: &Value) -> Option<&Vec<Value>> {
    root.get("value")?
        .as_array()?
        .iter()
        .find(|node| node.get("name").and_then(Value::as_str) == Some("Data"))?
        .get("value")?
        .as_array()
}

fn data_node<'a>(data: &'a [Value], name: &str) -> Option<&'a Value> {
    data.iter()
        .find(|node| node.get("name").and_then(Value::as_str) == Some(name))
}

fn data_number(data: &[Value], name: &str) -> i64 {
    data_node(data, name)
        .and_then(|node| node.get("value"))
        .and_then(|value| {
            value
                .as_i64()
                .or_else(|| value.as_str().and_then(|text| text.parse().ok()))
        })
        .unwrap_or(0)
}

fn nested_node<'a>(data: &'a [Value], parent: &str, name: &str) -> Option<&'a Value> {
    data_node(data, parent)?
        .get("value")?
        .as_array()?
        .iter()
        .find(|node| node.get("name").and_then(Value::as_str) == Some(name))
}

pub fn read_world_settings(instance_dir: &Path, world: &str) -> Result<Value> {
    let root = read_world_file(instance_dir, world, "level.dat")?;
    let data = world_data(&root).ok_or_else(|| anyhow!("level.dat không có dữ liệu Data"))?;
    let text = |name: &str| {
        data_node(data, name)
            .and_then(|node| node.get("value"))
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string()
    };
    let mut seed = text("RandomSeed");
    if seed.is_empty() || seed == "0" {
        if let Some(value) = nested_node(data, "WorldGenSettings", "seed") {
            let nested = value
                .get("value")
                .and_then(|v| {
                    v.as_str()
                        .map(str::to_string)
                        .or_else(|| v.as_i64().map(|n| n.to_string()))
                })
                .unwrap_or_default();
            if !nested.is_empty() {
                seed = nested;
            }
        }
    }
    Ok(serde_json::json!({
        "name": text("LevelName"),
        "seed": seed,
        "gameType": data_number(data, "GameType"),
        "difficulty": data_number(data, "Difficulty"),
        "hardcore": data_number(data, "hardcore") != 0,
        "cheats": data_number(data, "allowCommands") != 0,
        "time": text("Time"),
        "dayTime": text("DayTime"),
        "spawnX": data_number(data, "SpawnX"),
        "spawnY": data_number(data, "SpawnY"),
        "spawnZ": data_number(data, "SpawnZ"),
    }))
}

fn set_world_value(root: &mut Value, name: &str, value: Value) -> bool {
    let Some(entries) = root.get_mut("value").and_then(Value::as_array_mut) else {
        return false;
    };
    let Some(data) = entries
        .iter_mut()
        .find(|node| node.get("name").and_then(Value::as_str) == Some("Data"))
    else {
        return false;
    };
    let Some(nodes) = data.get_mut("value").and_then(Value::as_array_mut) else {
        return false;
    };
    let Some(node) = nodes
        .iter_mut()
        .find(|node| node.get("name").and_then(Value::as_str) == Some(name))
    else {
        return false;
    };
    if let Some(object) = node.as_object_mut() {
        object.insert("value".into(), value);
        true
    } else {
        false
    }
}

fn set_world_nested(root: &mut Value, parent: &str, name: &str, value: Value) -> bool {
    let Some(entries) = root.get_mut("value").and_then(Value::as_array_mut) else {
        return false;
    };
    let Some(data) = entries
        .iter_mut()
        .find(|node| node.get("name").and_then(Value::as_str) == Some("Data"))
    else {
        return false;
    };
    let Some(nodes) = data.get_mut("value").and_then(Value::as_array_mut) else {
        return false;
    };
    let Some(compound) = nodes
        .iter_mut()
        .find(|node| node.get("name").and_then(Value::as_str) == Some(parent))
    else {
        return false;
    };
    let Some(children) = compound.get_mut("value").and_then(Value::as_array_mut) else {
        return false;
    };
    let Some(child) = children
        .iter_mut()
        .find(|node| node.get("name").and_then(Value::as_str) == Some(name))
    else {
        return false;
    };
    if let Some(object) = child.as_object_mut() {
        object.insert("value".into(), value);
        true
    } else {
        false
    }
}

pub fn write_world_settings(instance_dir: &Path, world: &str, patch: &Value) -> Result<()> {
    let mut root = read_world_file(instance_dir, world, "level.dat")?;
    if let Some(name) = patch.get("name").and_then(Value::as_str).filter(|v| !v.trim().is_empty()) {
        set_world_value(&mut root, "LevelName", serde_json::json!(name.trim()));
    }
    if let Some(seed) = patch.get("seed").and_then(Value::as_str).filter(|v| !v.trim().is_empty()) {
        if seed.trim().parse::<i64>().is_ok() {
            set_world_value(&mut root, "RandomSeed", serde_json::json!(seed.trim()));
            set_world_nested(&mut root, "WorldGenSettings", "seed", serde_json::json!(seed.trim()));
        }
    }
    if let Some(game) = patch.get("gameType").and_then(Value::as_i64) {
        set_world_value(&mut root, "GameType", serde_json::json!(game));
    }
    if let Some(difficulty) = patch.get("difficulty").and_then(Value::as_i64) {
        set_world_value(&mut root, "Difficulty", serde_json::json!(difficulty));
    }
    if let Some(hardcore) = patch.get("hardcore").and_then(Value::as_bool) {
        set_world_value(&mut root, "hardcore", serde_json::json!(if hardcore { 1 } else { 0 }));
    }
    if let Some(cheats) = patch.get("cheats").and_then(Value::as_bool) {
        set_world_value(&mut root, "allowCommands", serde_json::json!(if cheats { 1 } else { 0 }));
    }
    let path = world_dir(instance_dir, world)?.join("level.dat");
    let bytes = write_nbt(&path, &root, true, true)?;
    let _ = bytes;
    Ok(())
}

pub fn read_world_file(instance_dir: &Path, world: &str, file: &str) -> Result<Value> {
    let dir = world_dir(instance_dir, world)?;
    let path = crate::store::safe_join(&dir, file)?;
    read_nbt(&path)
}

pub fn write_world_file(instance_dir: &Path, world: &str, file: &str, root: &Value) -> Result<usize> {
    let dir = world_dir(instance_dir, world)?;
    let path = crate::store::safe_join(&dir, file)?;
    write_nbt(&path, root, true, true)
}

pub fn restore_world_file(instance_dir: &Path, world: &str, file: &str) -> Result<()> {
    let dir = world_dir(instance_dir, world)?;
    let path = crate::store::safe_join(&dir, file)?;
    let bak = path.with_extension("bak");
    if !bak.is_file() {
        return Err(anyhow!("Không có bản sao lưu"));
    }
    std::fs::copy(&bak, &path)?;
    Ok(())
}

pub fn folder_bytes(root: &Path, cap: u64) -> u64 {
    fn walk(dir: &Path, total: &mut u64, cap: u64) {
        if *total >= cap {
            return;
        }
        let Ok(entries) = std::fs::read_dir(dir) else {
            return;
        };
        for entry in entries.flatten() {
            let Ok(meta) = entry.metadata() else { continue };
            if meta.is_dir() {
                walk(&entry.path(), total, cap);
            } else {
                *total += meta.len();
            }
            if *total >= cap {
                return;
            }
        }
    }
    let mut total = 0;
    walk(root, &mut total, cap);
    total
}


#[cfg(test)]
mod nbt_tests {
    use super::*;

    #[test]
    fn truncated_nbt_is_rejected() {
        assert!(parse_bytes(&[10, 0, 0]).is_err());
        assert!(parse_bytes(&[]).is_err());
    }

    #[test]
    #[ignore]
    fn render_real_world_if_requested() {
        let Ok(instance_dir) = std::env::var("XYO_MAP_INSTANCE") else {
            return;
        };
        let world = std::env::var("XYO_MAP_WORLD").unwrap_or_else(|_| "New World".into());
        let store = crate::store::Store::load();
        let meta = render_map(&store, Path::new(&instance_dir), &world).expect("render map");
        println!("{}", serde_json::to_string_pretty(&meta).unwrap());
    }

    #[test]
    fn nbt_roundtrip() {
        let root = serde_json::json!({
            "type": "compound",
            "name": "",
            "value": [
                {"type": "string", "name": "LevelName", "value": "Test"},
                {"type": "int", "name": "GameType", "value": 1},
                {"type": "compound", "name": "Data", "value": [
                    {"type": "long", "name": "RandomSeed", "value": "123456789"}
                ]}
            ]
        });
        let bytes = serialize_root(&root).unwrap();
        let parsed = parse_bytes(&bytes).unwrap();
        assert_eq!(parsed["value"][0]["name"], "LevelName");
        assert_eq!(parsed["value"][0]["value"], "Test");
    }
}

#[cfg(test)]
mod settings_tests {
    use super::*;

    #[test]
    fn reads_and_writes_nested_seed() {
        let root_dir = std::env::temp_dir().join(format!("xyo-world-{}", uuid::Uuid::new_v4()));
        let world = root_dir.join("saves").join("TestWorld");
        std::fs::create_dir_all(&world).unwrap();
        let root = serde_json::json!({
            "name": "",
            "value": [{
                "type": "compound",
                "name": "Data",
                "value": [
                    {"type": "string", "name": "LevelName", "value": "Test"},
                    {"type": "byte", "name": "Difficulty", "value": 2},
                    {"type": "int", "name": "GameType", "value": 0},
                    {"type": "compound", "name": "WorldGenSettings", "value": [
                        {"type": "long", "name": "seed", "value": "12345"}
                    ]}
                ]
            }]
        });
        write_nbt(&world.join("level.dat"), &root, true, false).unwrap();
        let settings = read_world_settings(&root_dir, "TestWorld").unwrap();
        assert_eq!(settings.get("name").and_then(Value::as_str), Some("Test"));
        assert_eq!(settings.get("seed").and_then(Value::as_str), Some("12345"));
        write_world_settings(
            &root_dir,
            "TestWorld",
            &serde_json::json!({"seed": "999", "gameType": 1}),
        )
        .unwrap();
        let updated = read_world_settings(&root_dir, "TestWorld").unwrap();
        assert_eq!(updated.get("seed").and_then(Value::as_str), Some("999"));
        assert_eq!(updated.get("gameType").and_then(Value::as_i64), Some(1));
        let _ = std::fs::remove_dir_all(root_dir);
    }
}
