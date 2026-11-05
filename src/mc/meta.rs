use crate::mc::paths::Paths;
use crate::models::{LoaderRow, VersionEntry};
use anyhow::{anyhow, Result};
use serde_json::Value;
use std::path::Path;

pub const MANIFEST_URL: &str = "https://launchermeta.mojang.com/mc/game/version_manifest_v2.json";
pub const LUNAR_API: &str = "https://lunarspace.site";
const FORGE_META: &str = "https://files.minecraftforge.net/net/minecraftforge/forge/maven-metadata.json";
const FORGE_PROMOS: &str = "https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json";
const NEO_MIRROR: &str = "https://maven.neoforged.net/releases/net/neoforged";

fn read_cache(file: &Path) -> Option<Value> {
    std::fs::read_to_string(file)
        .ok()
        .and_then(|raw| serde_json::from_str(&raw).ok())
}

fn write_cache(file: &Path, value: &Value) {
    if let Some(parent) = file.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let _ = std::fs::write(
        file,
        serde_json::to_string(value).unwrap_or_else(|_| "{}".into()),
    );
}

pub async fn get_manifest(meta_dir: &Path, force: bool) -> Result<(Value, bool)> {
    let file = meta_dir.join("version_manifest_v2.json");
    if !force {
        if let Some(cached) = read_cache(&file) {
            if cached.get("versions").and_then(Value::as_array).is_some() {
                return Ok((cached, true));
            }
        }
    }
    match crate::net::fetch_json(MANIFEST_URL).await {
        Ok(manifest) => {
            write_cache(&file, &manifest);
            Ok((manifest, false))
        }
        Err(err) => {
            if let Some(cached) = read_cache(&file) {
                Ok((cached, true))
            } else {
                Err(anyhow!(
                    "Không tải được danh sách phiên bản từ Mojang: {err}"
                ))
            }
        }
    }
}

pub async fn list_versions(
    meta_dir: &Path,
    snapshots: bool,
    force: bool,
) -> Result<(Vec<VersionEntry>, Value)> {
    let (manifest, _cached) = get_manifest(meta_dir, force).await?;
    let latest = manifest.get("latest").cloned().unwrap_or(Value::Null);
    let list = manifest
        .get("versions")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default()
        .into_iter()
        .filter(|row| {
            snapshots
                || row.get("type").and_then(Value::as_str).unwrap_or("") == "release"
        })
        .filter_map(|row| {
            Some(VersionEntry {
                id: row.get("id")?.as_str()?.to_string(),
                kind: row.get("type")?.as_str()?.to_string(),
                release_time: row
                    .get("releaseTime")
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .to_string(),
                url: row.get("url")?.as_str()?.to_string(),
            })
        })
        .collect();
    Ok((list, latest))
}

pub async fn get_version_json(paths: &Paths, id: &str, url: Option<&str>) -> Result<Value> {
    let meta_file = paths.meta.join("versions").join(format!("{id}.json"));
    if let Some(cached) = read_cache(&meta_file) {
        return Ok(cached);
    }
    let local = paths.versions.join(id).join(format!("{id}.json"));
    if let Some(cached) = read_cache(&local) {
        return Ok(cached);
    }
    let url = match url {
        Some(url) => url.to_string(),
        None => {
            let (manifest, _) = get_manifest(&paths.meta, false).await?;
            manifest
                .get("versions")
                .and_then(Value::as_array)
                .and_then(|rows| {
                    rows.iter()
                        .find(|row| row.get("id").and_then(Value::as_str) == Some(id))
                })
                .and_then(|row| row.get("url"))
                .and_then(Value::as_str)
                .map(str::to_string)
                .ok_or_else(|| anyhow!("Không tìm thấy phiên bản {id} trong manifest Mojang"))?
        }
    };
    let json = crate::net::fetch_json(&url).await?;
    write_cache(&meta_file, &json);
    Ok(json)
}

fn version_parts(value: &str) -> Vec<u64> {
    value
        .split(['.', '-', '+'])
        .filter_map(|part| part.parse::<u64>().ok())
        .collect()
}

fn version_at_least(value: &str, min: &str) -> bool {
    let a = version_parts(value);
    let b = version_parts(min);
    for i in 0..a.len().max(b.len()) {
        let x = *a.get(i).unwrap_or(&0);
        let y = *b.get(i).unwrap_or(&0);
        if x != y {
            return x > y;
        }
    }
    true
}

pub async fn list_loader_versions(kind: &str, game: &str) -> Result<Vec<LoaderRow>> {
    match kind {
        "vanilla" | "" => Ok(Vec::new()),
        "fabric" | "quilt" => {
            let url = if kind == "fabric" {
                format!("https://meta.fabricmc.net/v2/versions/loader/{game}")
            } else {
                format!("https://meta.quiltmc.org/v3/versions/loader/{game}")
            };
            let rows = match crate::net::fetch_json(&url).await {
                Ok(Value::Array(rows)) => rows,
                Ok(_) => return Ok(Vec::new()),
                Err(err) => {
                    let text = err.to_string();
                    if text.contains("400") || text.contains("404") || text.contains("422") {
                        return Ok(Vec::new());
                    }
                    return Err(err);
                }
            };
            let mut out: Vec<LoaderRow> = rows
                .iter()
                .filter_map(|row| {
                    let loader = row.get("loader")?;
                    let version = loader
                        .get("version")
                        .and_then(Value::as_str)
                        .or_else(|| row.get("version").and_then(Value::as_str))?
                        .to_string();
                    let stable = loader
                        .get("stable")
                        .and_then(Value::as_bool)
                        .unwrap_or(!version.contains('-'));
                    Some(LoaderRow {
                        id: version.clone(),
                        version,
                        stable,
                        latest: false,
                        build: loader.get("build").and_then(Value::as_u64).map(|v| v.to_string()),
                        ..Default::default()
                    })
                })
                .collect();
            out.sort_by(|a, b| {
                b.stable
                    .cmp(&a.stable)
                    .then_with(|| b.version.cmp(&a.version))
            });
            out.truncate(60);
            if let Some(first) = out.first_mut() {
                first.latest = true;
            }
            Ok(out)
        }
        "forge" => {
            if !version_at_least(game, "1.5.2") {
                return Ok(Vec::new());
            }
            let (meta, promos) = tokio::join!(
                crate::net::fetch_json(FORGE_META),
                crate::net::fetch_json(FORGE_PROMOS)
            );
            let meta = meta?;
            let promos = promos.unwrap_or(Value::Null);
            let all = meta
                .get(game)
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default();
            let latest = promos
                .get("promos")
                .and_then(|p| p.get(format!("{game}-latest")))
                .and_then(Value::as_str)
                .map(str::to_string);
            let recommended = promos
                .get("promos")
                .and_then(|p| p.get(format!("{game}-recommended")))
                .and_then(Value::as_str)
                .map(str::to_string);
            let mut rows: Vec<LoaderRow> = all
                .iter()
                .rev()
                .filter_map(|id| {
                    let id = id.as_str()?;
                    let display = id
                        .strip_prefix(&format!("{game}-"))
                        .unwrap_or(id)
                        .trim_end_matches(&format!("-{game}"))
                        .to_string();
                    Some(LoaderRow {
                        id: id.to_string(),
                        version: display.clone(),
                        stable: recommended
                            .as_ref()
                            .map(|v| display == *v)
                            .unwrap_or(false),
                        latest: latest.as_ref().map(|v| display == *v).unwrap_or(false),
                        ..Default::default()
                    })
                })
                .collect();
            if !rows.is_empty() && !rows.iter().any(|r| r.latest) {
                rows[0].latest = true;
            }
            rows.truncate(60);
            Ok(rows)
        }
        "neoforge" => neoforge_versions(game).await,
        "lunar" => lunar_versions(Some(game)).await,
        other => Err(anyhow!("Loader không hỗ trợ: {other}")),
    }
}

async fn neoforge_meta() -> Result<(Vec<String>, Vec<String>)> {
    let modern = crate::net::fetch_text(&format!("{NEO_MIRROR}/neoforge/maven-metadata.xml"))
        .await
        .unwrap_or_default();
    let legacy = crate::net::fetch_text(&format!("{NEO_MIRROR}/forge/maven-metadata.xml"))
        .await
        .unwrap_or_default();
    Ok((xml_versions(&modern), xml_versions(&legacy)))
}

fn xml_versions(text: &str) -> Vec<String> {
    static RE: once_cell::sync::Lazy<regex::Regex> =
        once_cell::sync::Lazy::new(|| regex::Regex::new(r"<version>([^<]+)</version>").unwrap());
    RE.captures_iter(text)
        .map(|c| c[1].to_string())
        .collect()
}

pub fn neoforge_game_of(version: &str) -> Option<String> {
    let raw = version.split(['-', '+']).next().unwrap_or("");
    let parts: Vec<&str> = raw.split('.').collect();
    if parts.len() < 3 || !parts.iter().all(|p| p.chars().all(|c| c.is_ascii_digit())) {
        return None;
    }
    let nums: Vec<u64> = parts.iter().filter_map(|p| p.parse().ok()).collect();
    if nums.len() < 3 {
        return None;
    }
    if nums[0] >= 26 {
        let mut parts = vec![nums[0].to_string(), nums[1].to_string()];
        if nums[2] > 0 {
            parts.push(nums[2].to_string());
        }
        Some(parts.join("."))
    } else {
        let mut parts = vec!["1".to_string(), nums[0].to_string()];
        if nums[1] > 0 {
            parts.push(nums[1].to_string());
        }
        Some(parts.join("."))
    }
}

async fn neoforge_versions(game: &str) -> Result<Vec<LoaderRow>> {
    let (modern, legacy) = neoforge_meta().await?;
    let prerelease = |v: &str| {
        (v.contains("-alpha") || v.contains("-snapshot") || v.contains("+snapshot") || v.contains("pre"))
            && !v.contains("-beta")
    };
    let mut rows = Vec::new();
    for version in &modern {
        if prerelease(version) {
            continue;
        }
        if neoforge_game_of(version).as_deref() != Some(game) {
            continue;
        }
        let build = version
            .split(['-', '+'])
            .next()
            .and_then(|v| v.split('.').next_back())
            .unwrap_or("");
        rows.push(LoaderRow {
            id: version.clone(),
            version: build.to_string(),
            beta: version.contains("-beta"),
            ..Default::default()
        });
    }
    if game == "1.20.1" {
        for version in &legacy {
            let Some(cut) = version.find('-') else { continue };
            if &version[..cut] != "1.20.1" {
                continue;
            }
            rows.push(LoaderRow {
                id: version.clone(),
                version: version[cut + 1..].to_string(),
                legacy: true,
                ..Default::default()
            });
        }
    }
    rows.sort_by(|a, b| b.version.cmp(&a.version));
    let stable = rows.iter().find(|r| !r.beta).map(|r| r.id.clone());
    let latest = rows.first().map(|r| r.id.clone());
    for row in &mut rows {
        row.stable = stable.as_ref() == Some(&row.id);
        row.latest = latest.as_ref() == Some(&row.id);
    }
    rows.truncate(80);
    Ok(rows)
}

async fn lunar_versions(game: Option<&str>) -> Result<Vec<LoaderRow>> {
    let url = match game {
        Some(game) => format!("{LUNAR_API}/api-v2/versions?mc={game}"),
        None => format!("{LUNAR_API}/api-v2/versions"),
    };
    let json = crate::net::fetch_json(&url).await?;
    let rows = json
        .get("versions")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    Ok(rows
        .iter()
        .enumerate()
        .filter_map(|(index, row)| {
            let version = row.get("version")?.as_str()?.to_string();
            Some(LoaderRow {
                id: row
                    .get("id")
                    .and_then(Value::as_str)
                    .unwrap_or(&version)
                    .to_string(),
                version,
                stable: row.get("channel").and_then(Value::as_str).unwrap_or("stable")
                    == "stable",
                latest: index == 0,
                minecraft: row
                    .get("minecraft")
                    .and_then(Value::as_str)
                    .map(str::to_string),
                published_at: row
                    .get("published_at")
                    .and_then(Value::as_str)
                    .map(str::to_string),
                ..Default::default()
            })
        })
        .collect())
}

pub async fn list_loader_games(kind: &str) -> Result<Vec<Value>> {
    match kind {
        "" | "vanilla" => Ok(Vec::new()),
        "fabric" | "quilt" => {
            let url = if kind == "fabric" {
                "https://meta.fabricmc.net/v2/versions/game"
            } else {
                "https://meta.quiltmc.org/v3/versions/game"
            };
            let rows = match crate::net::fetch_json(url).await {
                Ok(Value::Array(rows)) => rows,
                _ => return Ok(Vec::new()),
            };
            Ok(rows
                .iter()
                .filter_map(|row| {
                    let version = row.get("version")?.as_str()?.to_string();
                    Some(serde_json::json!({
                        "version": version,
                        "stable": row.get("stable").and_then(Value::as_bool).unwrap_or(true)
                    }))
                })
                .collect())
        }
        "forge" => {
            let meta = crate::net::fetch_json(FORGE_META).await?;
            let mut games: Vec<Value> = meta
                .as_object()
                .map(|map| {
                    map.keys()
                        .filter(|v| version_at_least(v, "1.5.2"))
                        .map(|v| serde_json::json!({"version": v, "stable": true}))
                        .collect()
                })
                .unwrap_or_default();
            games.sort_by(|a, b| {
                let av = a.get("version").and_then(Value::as_str).unwrap_or("");
                let bv = b.get("version").and_then(Value::as_str).unwrap_or("");
                version_parts(bv).cmp(&version_parts(av))
            });
            Ok(games)
        }
        "neoforge" => {
            let (modern, legacy) = neoforge_meta().await?;
            let mut set = std::collections::BTreeSet::new();
            for version in modern {
                if !version.contains("-alpha") && !version.contains("snapshot") {
                    if let Some(game) = neoforge_game_of(&version) {
                        set.insert(game);
                    }
                }
            }
            if legacy.iter().any(|v| v.starts_with("1.20.1-")) {
                set.insert("1.20.1".into());
            }
            let mut games: Vec<Value> = set
                .into_iter()
                .map(|v| serde_json::json!({"version": v, "stable": true}))
                .collect();
            games.sort_by(|a, b| {
                let av = a.get("version").and_then(Value::as_str).unwrap_or("");
                let bv = b.get("version").and_then(Value::as_str).unwrap_or("");
                version_parts(bv).cmp(&version_parts(av))
            });
            Ok(games)
        }
        "lunar" => {
            let rows = lunar_versions(None).await?;
            let mut seen = std::collections::BTreeMap::new();
            for row in rows {
                if let Some(game) = row.minecraft {
                    seen.entry(game).or_insert(row.stable);
                }
            }
            let mut games: Vec<Value> = seen
                .into_iter()
                .map(|(version, stable)| serde_json::json!({"version": version, "stable": stable}))
                .collect();
            games.sort_by(|a, b| {
                let av = a.get("version").and_then(Value::as_str).unwrap_or("");
                let bv = b.get("version").and_then(Value::as_str).unwrap_or("");
                version_parts(bv).cmp(&version_parts(av))
            });
            Ok(games)
        }
        _ => Ok(Vec::new()),
    }
}

pub async fn get_loader_profile(
    kind: &str,
    game: &str,
    loader: &str,
    meta_dir: &Path,
) -> Result<Value> {
    let url = match kind {
        "fabric" => format!("https://meta.fabricmc.net/v2/versions/loader/{game}/{loader}/profile/json"),
        "quilt" => format!("https://meta.quiltmc.org/v3/versions/loader/{game}/{loader}/profile/json"),
        other => return Err(anyhow!("Loader không hỗ trợ: {other}")),
    };
    let key_file = meta_dir
        .join("versions")
        .join(format!("{kind}-{loader}-{game}.json"));
    if let Some(cached) = read_cache(&key_file) {
        if cached
            .get("libraries")
            .and_then(Value::as_array)
            .map(|v| !v.is_empty())
            .unwrap_or(false)
        {
            return Ok(cached);
        }
    }
    let json = crate::net::fetch_json(&url).await?;
    if json
        .get("libraries")
        .and_then(Value::as_array)
        .map(|v| v.is_empty())
        .unwrap_or(true)
    {
        return Err(anyhow!("Không lấy được profile {kind} {loader}"));
    }
    write_cache(&key_file, &json);
    if let Some(id) = json.get("id").and_then(Value::as_str) {
        write_cache(&meta_dir.join("versions").join(format!("{id}.json")), &json);
    }
    Ok(json)
}

pub async fn resolve_loader_full_id(kind: &str, game: &str, id_or_version: &str) -> String {
    match kind {
        "forge" => {
            let raw = id_or_version.to_string();
            if raw.starts_with(&format!("{game}-")) {
                return raw;
            }
            if let Ok(meta) = crate::net::fetch_json(FORGE_META).await {
                if let Some(all) = meta.get(game).and_then(Value::as_array) {
                    let guess = format!("{game}-{raw}");
                    if all.iter().any(|v| v.as_str() == Some(&guess)) {
                        return guess;
                    }
                    if let Some(found) = all.iter().find(|v| {
                        v.as_str()
                            .map(|s| {
                                s.strip_prefix(&format!("{game}-"))
                                    .unwrap_or(s)
                                    .trim_end_matches(&format!("-{game}"))
                                    == raw
                            })
                            .unwrap_or(false)
                    }) {
                        if let Some(s) = found.as_str() {
                            return s.to_string();
                        }
                    }
                }
            }
            format!("{game}-{raw}")
        }
        "neoforge" => {
            if let Ok(rows) = neoforge_versions(game).await {
                if rows.iter().any(|r| r.id == id_or_version) {
                    return id_or_version.to_string();
                }
                if let Some(hit) = rows.iter().find(|r| r.version == id_or_version) {
                    return hit.id.clone();
                }
            }
            id_or_version.to_string()
        }
        _ => id_or_version.to_string(),
    }
}
