use crate::store::Store;
use anyhow::{anyhow, Result};
use base64::Engine;
use serde_json::{Value, json};
use std::path::{Path, PathBuf};

const SKIN_API: &str = "https://lunarspace.site";
const SKIN_KEY: &str = "c2eca935db7123fde240472662d8b0b76654d8267850a87e";
const MAX_DATA: usize = 3 * 1024 * 1024;

fn dir_for(store: &Store) -> PathBuf {
    store.shared_dir().join("skins")
}

fn file_for(store: &Store, uuid: &str, kind: &str) -> Option<PathBuf> {
    let id = crate::util::safe_id(uuid);
    if id.is_empty() {
        return None;
    }
    Some(dir_for(store).join(if kind == "cape" {
        format!("{id}-cape.png")
    } else {
        format!("{id}.png")
    }))
}

fn meta_for(store: &Store, uuid: &str) -> Option<PathBuf> {
    let id = crate::util::safe_id(uuid);
    (!id.is_empty()).then(|| dir_for(store).join(format!("{id}.json")))
}

#[derive(Clone, Debug, Default)]
pub struct CustomSkin {
    pub uuid: String,
    pub name: String,
    pub model: String,
    pub updated_at: Option<String>,
    pub skin: Option<PathBuf>,
    pub cape: Option<PathBuf>,
}

pub fn read_custom(store: &Store, uuid: &str) -> CustomSkin {
    let meta = meta_for(store, uuid)
        .and_then(|path| std::fs::read_to_string(path).ok())
        .and_then(|raw| serde_json::from_str::<Value>(&raw).ok())
        .unwrap_or(Value::Null);
    CustomSkin {
        uuid: crate::util::safe_id(uuid),
        name: meta
            .get("name")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string(),
        model: if meta.get("model").and_then(Value::as_str) == Some("slim") {
            "slim".into()
        } else {
            "classic".into()
        },
        updated_at: meta
            .get("updatedAt")
            .and_then(Value::as_str)
            .map(str::to_string),
        skin: file_for(store, uuid, "skin").filter(|p| p.is_file()),
        cape: file_for(store, uuid, "cape").filter(|p| p.is_file()),
    }
}

pub fn model_sync(store: &Store, uuid: &str) -> String {
    let skin = read_custom(store, uuid);
    skin.model
}

pub fn custom_sync(store: &Store, uuid: &str) -> bool {
    file_for(store, uuid, "skin").map(|p| p.is_file()).unwrap_or(false)
        || file_for(store, uuid, "cape").map(|p| p.is_file()).unwrap_or(false)
}

fn png_size(bytes: &[u8]) -> Option<(u32, u32)> {
    if bytes.len() < 24 || &bytes[..8] != b"\x89PNG\r\n\x1a\n" {
        return None;
    }
    let width = u32::from_be_bytes([bytes[16], bytes[17], bytes[18], bytes[19]]);
    let height = u32::from_be_bytes([bytes[20], bytes[21], bytes[22], bytes[23]]);
    Some((width, height))
}

pub fn save_custom(
    store: &Store,
    uuid: &str,
    name: &str,
    model: &str,
    skin: Option<Vec<u8>>,
    cape: Option<Vec<u8>>,
) -> Result<CustomSkin> {
    if uuid.trim().is_empty() {
        return Err(anyhow!("Thiếu UUID tài khoản"));
    }
    if let Some(data) = skin.as_ref() {
        if data.len() > MAX_DATA {
            return Err(anyhow!("Ảnh quá lớn"));
        }
        match png_size(data) {
            Some((64, 64)) => {}
            _ => return Err(anyhow!("Skin phải có kích thước 64×64")),
        }
    }
    if let Some(data) = cape.as_ref() {
        if data.len() > MAX_DATA {
            return Err(anyhow!("Ảnh quá lớn"));
        }
        match png_size(data) {
            Some((64, 32)) => {}
            _ => return Err(anyhow!("Cape phải có kích thước 64×32")),
        }
    }
    let dir = dir_for(store);
    std::fs::create_dir_all(&dir)?;
    let skin_file = file_for(store, uuid, "skin").unwrap();
    let cape_file = file_for(store, uuid, "cape").unwrap();
    match skin {
        Some(data) => std::fs::write(&skin_file, data)?,
        None => {
            let _ = std::fs::remove_file(&skin_file);
        }
    }
    match cape {
        Some(data) => std::fs::write(&cape_file, data)?,
        None => {
            let _ = std::fs::remove_file(&cape_file);
        }
    }
    let updated = crate::util::now_iso();
    if skin_file.is_file() || cape_file.is_file() {
        let meta = json!({
            "uuid": crate::util::safe_id(uuid),
            "name": name,
            "model": if model == "slim" { "slim" } else { "classic" },
            "hasSkin": skin_file.is_file(),
            "hasCape": cape_file.is_file(),
            "updatedAt": updated,
        });
        crate::store::write_json_atomic(&meta_for(store, uuid).unwrap(), &meta);
        let _ = invalidate_head(store, uuid);
    } else if let Some(meta) = meta_for(store, uuid) {
        let _ = std::fs::remove_file(meta);
    }
    Ok(read_custom(store, uuid))
}

pub fn remove_custom(store: &Store, uuid: &str) -> CustomSkin {
    let previous = read_custom(store, uuid);
    if let Some(file) = file_for(store, uuid, "skin") {
        let _ = std::fs::remove_file(file);
    }
    if let Some(file) = file_for(store, uuid, "cape") {
        let _ = std::fs::remove_file(file);
    }
    if let Some(file) = meta_for(store, uuid) {
        let _ = std::fs::remove_file(file);
    }
    let _ = invalidate_head(store, uuid);
    previous
}

fn skin_url_from_profile(profile: &Value) -> Option<String> {
    let properties = profile.get("properties")?.as_array()?;
    let property = properties
        .iter()
        .find(|p| p.get("name").and_then(Value::as_str) == Some("textures"))?;
    let value = property.get("value")?.as_str()?;
    let decoded = base64::engine::general_purpose::STANDARD.decode(value).ok()?;
    let json: Value = serde_json::from_slice(&decoded).ok()?;
    json.pointer("/textures/SKIN/url")
        .and_then(Value::as_str)
        .map(str::to_string)
}

async fn mojang_texture(uuid: &str) -> Option<String> {
    let clean: String = uuid.chars().filter(|c| c.is_ascii_hexdigit()).collect();
    if clean.len() != 32 {
        return None;
    }
    let profile = crate::net::fetch_json(&format!(
        "https://sessionserver.mojang.com/session/minecraft/profile/{clean}"
    ))
    .await
    .ok()?;
    skin_url_from_profile(&profile)
}

async fn ely_texture(uuid: &str) -> Option<String> {
    let clean: String = uuid.chars().filter(|c| c.is_ascii_hexdigit()).collect();
    if clean.len() != 32 {
        return None;
    }
    let profile = crate::net::fetch_json(&format!(
        "https://authserver.ely.by/sessionserver/session/minecraft/profile/{clean}"
    ))
    .await
    .ok()?;
    skin_url_from_profile(&profile)
}

fn cache_key(uuid: &str, name: &str, provider: &str) -> String {
    let clean: String = uuid.chars().filter(|c| c.is_ascii_hexdigit()).collect();
    if (provider == "microsoft" || provider == "ely") && !clean.is_empty() {
        return format!(
            "{}-{}",
            if provider == "ely" { "e" } else { "m" },
            clean.to_lowercase()
        );
    }
    format!("n-{}", name.trim().to_lowercase())
}

pub async fn resolve_remote(
    store: &Store,
    uuid: &str,
    name: &str,
    provider: &str,
) -> Option<PathBuf> {
    let key = cache_key(uuid, name, provider);
    if key.len() < 4 {
        return None;
    }
    let cache_dir = store.skin_cache_dir();
    let _ = std::fs::create_dir_all(&cache_dir);
    let index_file = cache_dir.join("index.json");
    let mut index: serde_json::Map<String, Value> = std::fs::read_to_string(&index_file)
        .ok()
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or_default();
    if let Some(hit) = index.get(&key) {
        let at = hit.get("at").and_then(Value::as_i64).unwrap_or(0);
        let age = chrono::Utc::now().timestamp_millis() - at;
        if let Some(file) = hit.get("file").and_then(Value::as_str).filter(|f| !f.is_empty()) {
            if age < 12 * 3600 * 1000 && Path::new(file).is_file() {
                return Some(PathBuf::from(file));
            }
        } else if age < 6 * 3600 * 1000 {
            return None;
        }
    }
    let mut url = String::new();
    if provider == "ely" {
        if let Some(found) = ely_texture(uuid).await {
            url = found;
        }
    }
    if url.is_empty() && provider == "microsoft" {
        if let Some(found) = mojang_texture(uuid).await {
            url = found;
        }
    }
    if url.is_empty() {
        let clean = name.trim();
        if clean.len() >= 3 && clean.len() <= 16 {
            if let Ok(profile) = crate::net::fetch_json(&format!(
                "https://api.mojang.com/users/profiles/minecraft/{}",
                clean
            ))
            .await
            {
                if let Some(id) = profile.get("id").and_then(Value::as_str) {
                    if let Some(found) = mojang_texture(id).await {
                        url = found;
                    }
                }
            }
        }
    }
    if url.is_empty() {
        let clean_uuid: String = uuid.chars().filter(|c| c.is_ascii_hexdigit()).collect();
        let clean_name = name.trim();
        let avatar_url = if (provider == "microsoft" || provider == "ely") && !clean_uuid.is_empty() {
            Some(format!("https://crafthead.net/avatar/{clean_uuid}"))
        } else if clean_name.len() >= 3 && clean_name.len() <= 16 {
            Some(format!("https://crafthead.net/avatar/{clean_name}"))
        } else {
            None
        };
        if let Some(avatar_url) = avatar_url {
            if let Ok(bytes) = crate::net::fetch_bytes(&avatar_url, MAX_DATA).await {
                if image::load_from_memory(&bytes).is_ok() {
                    let file = cache_dir.join(format!("avatar-{key}.png"));
                    if std::fs::write(&file, bytes).is_ok() {
                        index.insert(
                            key,
                            json!({"file": file.to_string_lossy(), "at": chrono::Utc::now().timestamp_millis()}),
                        );
                        let _ = std::fs::write(&index_file, serde_json::to_string(&index).unwrap_or_default());
                        return Some(file);
                    }
                }
            }
        }
        index.insert(key, json!({"file": "", "at": chrono::Utc::now().timestamp_millis()}));
        let _ = std::fs::write(&index_file, serde_json::to_string(&index).unwrap_or_default());
        return None;
    }
    let bytes = match crate::net::fetch_bytes(&url, MAX_DATA).await {
        Ok(bytes) if png_size(&bytes).is_some() => bytes,
        _ => return None,
    };
    let file = cache_dir.join(format!("{key}.png"));
    if std::fs::write(&file, bytes).is_ok() {
        index.insert(
            key,
            json!({"file": file.to_string_lossy(), "at": chrono::Utc::now().timestamp_millis()}),
        );
        let _ = std::fs::write(&index_file, serde_json::to_string(&index).unwrap_or_default());
    }
    Some(file)
}

fn front_cache_path(store: &Store, uuid: &str) -> Option<PathBuf> {
    let id = crate::util::safe_id(uuid);
    (!id.is_empty()).then(|| store.skin_cache_dir().join(format!("front-{id}.png")))
}

fn head_cache_path(store: &Store, uuid: &str) -> Option<PathBuf> {
    let id = crate::util::safe_id(uuid);
    (!id.is_empty()).then(|| store.skin_cache_dir().join(format!("head-{id}.png")))
}

fn invalidate_head(store: &Store, uuid: &str) -> std::io::Result<()> {
    if let Some(file) = head_cache_path(store, uuid) {
        let _ = std::fs::remove_file(file);
    }
    if let Some(file) = front_cache_path(store, uuid) {
        let _ = std::fs::remove_file(file);
    }
    Ok(())
}

pub fn head_png(store: &Store, skin_path: &Path, uuid: &str) -> Option<PathBuf> {
    let target = head_cache_path(store, uuid)?;
    if target.is_file() {
        return Some(target);
    }
    let is_avatar = skin_path
        .file_name()
        .map(|name| name.to_string_lossy().starts_with("avatar-"))
        .unwrap_or(false);
    let source = image::open(skin_path).ok()?.to_rgba8();
    if is_avatar {
        let scaled = image::imageops::resize(&source, 32, 32, image::imageops::FilterType::Nearest);
        let _ = std::fs::create_dir_all(target.parent()?);
        scaled.save(&target).ok()?;
        return Some(target);
    }
    if source.width() < 64 || source.height() < 32 {
        return None;
    }
    let mut head = image::RgbaImage::new(8, 8);
    for y in 0..8 {
        for x in 0..8 {
            head.put_pixel(x, y, *source.get_pixel(8 + x, 8 + y));
        }
    }
    if source.height() >= 64 {
        for y in 0..8 {
            for x in 0..8 {
                let pixel = *source.get_pixel(40 + x, 8 + y);
                if pixel[3] > 0 {
                    head.put_pixel(x, y, pixel);
                }
            }
        }
    }
    let scaled = image::imageops::resize(&head, 32, 32, image::imageops::FilterType::Nearest);
    let _ = std::fs::create_dir_all(target.parent()?);
    scaled.save(&target).ok()?;
    Some(target)
}

pub fn front_png(store: &Store, skin_path: &Path, uuid: &str) -> Option<PathBuf> {
    let target = front_cache_path(store, uuid)?;
    if target.is_file() {
        return Some(target);
    }
    let source = image::open(skin_path).ok()?.to_rgba8();
    if source.width() < 64 || source.height() < 32 {
        return None;
    }
    let mut canvas = image::RgbaImage::new(16, 32);
    let mut blit = |dest_x: u32, dest_y: u32, src_x: u32, src_y: u32, w: u32, h: u32| {
        for y in 0..h {
            for x in 0..w {
                let pixel = *source.get_pixel(src_x + x, src_y + y);
                if pixel[3] > 0 {
                    canvas.put_pixel(dest_x + x, dest_y + y, pixel);
                }
            }
        }
    };
    // Base layer, then overlay layer for the front-facing character.
    blit(4, 0, 8, 8, 8, 8);
    blit(4, 8, 20, 20, 8, 12);
    blit(0, 8, 44, 20, 4, 12);
    blit(12, 8, 36, 52, 4, 12);
    blit(4, 20, 4, 20, 4, 12);
    blit(8, 20, 20, 52, 4, 12);
    blit(4, 0, 40, 8, 8, 8);
    blit(4, 8, 20, 36, 8, 12);
    blit(0, 8, 44, 36, 4, 12);
    blit(12, 8, 52, 52, 4, 12);
    blit(4, 20, 4, 36, 4, 12);
    blit(8, 20, 4, 52, 4, 12);
    let scaled = image::imageops::resize(&canvas, 128, 256, image::imageops::FilterType::Nearest);
    let _ = std::fs::create_dir_all(target.parent()?);
    scaled.save(&target).ok()?;
    Some(target)
}

pub async fn share(
    uuid: &str,
    name: &str,
    model: &str,
    skin: Option<String>,
    cape: Option<String>,
) -> Result<Value> {
    if name.trim().is_empty() {
        return Err(anyhow!("Thiếu tên tài khoản"));
    }
    let res = crate::net::client()
        .post(format!("{SKIN_API}/api-skin"))
        .timeout(std::time::Duration::from_secs(6))
        .json(&json!({
            "key": SKIN_KEY,
            "name": name.trim(),
            "uuid": uuid,
            "model": if model == "slim" { "slim" } else { "classic" },
            "skin": skin,
            "cape": cape,
        }))
        .send()
        .await?;
    let status = res.status();
    let data: Value = res.json().await.unwrap_or(Value::Null);
    if !status.is_success() || data.get("ok").and_then(Value::as_bool) != Some(true) {
        return Err(anyhow!(
            "{}",
            data.get("error")
                .and_then(Value::as_str)
                .unwrap_or("Chia sẻ skin thất bại")
        ));
    }
    Ok(data)
}

pub fn file_data_url(path: &Path) -> Option<String> {
    let bytes = std::fs::read(path).ok()?;
    Some(format!(
        "data:image/png;base64,{}",
        base64::engine::general_purpose::STANDARD.encode(bytes)
    ))
}
