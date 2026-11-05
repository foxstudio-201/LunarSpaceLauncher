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

    fn payload(&mut self, kind: u8) -> Result<Value> {
        Ok(match kind {
            TAG_BYTE => json!(self.i8()?),
            TAG_SHORT => json!(self.i16()?),
            TAG_INT => json!(self.i32()?),
            TAG_LONG => json!(self.i64()?.to_string()),
            TAG_FLOAT => json!(self.f32()?),
            TAG_DOUBLE => json!(self.f64()?),
            TAG_BYTE_ARRAY => {
                let size = self.i32()?.max(0) as usize;
                let mut out = Vec::with_capacity(size);
                for _ in 0..size {
                    out.push(json!(self.i8()?));
                }
                Value::Array(out)
            }
            TAG_STRING => json!(self.text()?),
            TAG_LIST => {
                let item_type = self.u8()?;
                let size = self.i32()?.max(0) as usize;
                let mut out = Vec::with_capacity(size.min(65536));
                for _ in 0..size {
                    out.push(json!({
                        "type": type_name(item_type),
                        "name": "",
                        "value": self.payload(item_type)?,
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
                        "value": self.payload(child_type)?,
                    }));
                }
                Value::Array(out)
            }
            TAG_INT_ARRAY => {
                let size = self.i32()?.max(0) as usize;
                let mut out = Vec::with_capacity(size.min(65536));
                for _ in 0..size {
                    out.push(json!(self.i32()?));
                }
                Value::Array(out)
            }
            TAG_LONG_ARRAY => {
                let size = self.i32()?.max(0) as usize;
                let mut out = Vec::with_capacity(size.min(65536));
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
        "value": reader.payload(TAG_COMPOUND)?,
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
