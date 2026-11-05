use crate::mc::content::{self, CF, Kind, cf_file_alts, cf_file_url, cf_json, cf_sha1};
use crate::net::{DownloadTask, ProgressFn};
use anyhow::{anyhow, Result};
use serde_json::Value;
use std::path::{Path, PathBuf};

#[derive(Clone, Debug)]
pub struct PackFile {
    pub rel: String,
    pub url: String,
    pub sha1: Option<String>,
    pub size: u64,
    pub alts: Vec<String>,
}

#[derive(Clone, Debug)]
pub struct ModpackPlan {
    pub name: String,
    pub summary: String,
    pub version: String,
    pub mc: String,
    pub loader: String,
    pub loader_version: Option<String>,
    pub source: String,
    pub zip_path: PathBuf,
    pub files: Vec<PackFile>,
    pub overrides: Vec<String>,
    pub listed: usize,
    pub extras: usize,
    pub missing: Vec<String>,
}

fn read_zip_json(zip: &mut zip::ZipArchive<std::fs::File>, name: &str) -> Option<String> {
    let mut entry = zip.by_name(name).ok()?;
    let mut text = String::new();
    std::io::Read::read_to_string(&mut entry, &mut text).ok()?;
    Some(text)
}

fn zip_entry_names(zip: &zip::ZipArchive<std::fs::File>) -> Vec<String> {
    (0..zip.len())
        .filter_map(|i| {
            zip.name_for_index(i)
                .map(|name| name.trim_end_matches('/').to_string())
        })
        .collect()
}

pub fn extract_overrides(zip_path: &Path, prefixes: &[String], target_dir: &Path) -> Result<Vec<String>> {
    let file = std::fs::File::open(zip_path)?;
    let mut zip = zip::ZipArchive::new(file)?;
    let mut written = Vec::new();
    let mut buffers: Vec<(PathBuf, Vec<u8>)> = Vec::new();
    for index in 0..zip.len() {
        let mut entry = zip.by_index(index)?;
        if entry.is_dir() {
            continue;
        }
        let Some(name) = entry.enclosed_name() else {
            continue;
        };
        let text = name.to_string_lossy().replace('\\', "/");
        let Some(prefix) = prefixes.iter().find(|p| {
            text.to_lowercase()
                .starts_with(&format!("{}/", p.trim_end_matches('/').to_lowercase()))
        }) else {
            continue;
        };
        let rel = text
            .strip_prefix(prefix.as_str())
            .unwrap_or(&text)
            .trim_start_matches('/')
            .to_string();
        if rel.is_empty() || rel.contains("..") {
            continue;
        }
        let target = target_dir.join(rel.replace('/', "\\"));
        if let Some(parent) = target.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let mut data = Vec::new();
        std::io::Read::read_to_end(&mut entry, &mut data)?;
        buffers.push((target.clone(), data));
        written.push(target.to_string_lossy().into_owned());
    }
    for (target, data) in buffers {
        std::fs::write(target, data)?;
    }
    Ok(written)
}

pub fn parse_mrpack(zip_path: &Path) -> Result<ModpackPlan> {
    let file = std::fs::File::open(zip_path)?;
    let mut zip = zip::ZipArchive::new(file)?;
    let raw = read_zip_json(&mut zip, "modrinth.index.json")
        .ok_or_else(|| anyhow!("Tệp .mrpack không có modrinth.index.json"))?;
    let index: Value = serde_json::from_str(&raw)?;
    let deps = index.get("dependencies").cloned().unwrap_or(Value::Null);
    let mc = deps
        .get("minecraft")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    let mut loader = "vanilla".to_string();
    let mut loader_version = None;
    for (key, id) in [
        ("fabric-loader", "fabric"),
        ("quilt-loader", "quilt"),
        ("forge", "forge"),
        ("neoforge", "neoforge"),
    ] {
        if let Some(version) = deps.get(key).and_then(Value::as_str) {
            loader = id.to_string();
            loader_version = Some(version.to_string());
            if id == "forge" {
                loader_version = Some(format!("{mc}-{version}"));
            }
            break;
        }
    }
    let overrides = ["overrides", "client-overrides"]
        .iter()
        .map(|v| v.to_string())
        .collect::<Vec<_>>();
    let mut files = Vec::new();
    let mut missing = Vec::new();
    let listed = index
        .get("files")
        .and_then(Value::as_array)
        .map(|v| v.len())
        .unwrap_or(0);
    for entry in index
        .get("files")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default()
    {
        let rel = entry
            .get("path")
            .and_then(Value::as_str)
            .unwrap_or("")
            .replace('\\', "/");
        if rel.is_empty() {
            continue;
        }
        if entry
            .pointer("/env/client")
            .and_then(Value::as_str)
            == Some("unsupported")
        {
            continue;
        }
        let url = entry
            .get("downloads")
            .and_then(Value::as_array)
            .and_then(|v| v.first())
            .and_then(Value::as_str)
            .unwrap_or("");
        if url.is_empty() {
            if !overrides.iter().any(|p| rel.to_lowercase().starts_with(&format!("{p}/"))) {
                missing.push(rel);
            }
            continue;
        }
        files.push(PackFile {
            rel,
            url: url.to_string(),
            sha1: entry.pointer("/hashes/sha1").and_then(Value::as_str).map(str::to_string),
            size: entry.get("fileSize").and_then(Value::as_u64).unwrap_or(0),
            alts: Vec::new(),
        });
    }
    Ok(ModpackPlan {
        name: index
            .get("name")
            .and_then(Value::as_str)
            .unwrap_or("Modpack")
            .to_string(),
        summary: index
            .get("summary")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string(),
        version: index
            .get("versionId")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string(),
        mc,
        loader,
        loader_version,
        source: "modrinth".into(),
        zip_path: zip_path.to_path_buf(),
        files,
        overrides,
        listed,
        extras: 0,
        missing,
    })
}

fn split_cf_loader(raw: &str) -> (String, Option<String>) {
    let lower = raw.to_lowercase();
    for id in ["neoforge", "forge", "fabric", "quilt"] {
        if lower.starts_with(&format!("{id}-")) {
            return (id.to_string(), Some(raw[id.len() + 1..].to_string()));
        }
    }
    ("vanilla".into(), None)
}

pub async fn parse_curseforge_zip(zip_path: &Path, on_log: impl Fn(String)) -> Result<ModpackPlan> {
    let file = std::fs::File::open(zip_path)?;
    let mut zip = zip::ZipArchive::new(file)?;
    let raw = read_zip_json(&mut zip, "manifest.json")
        .ok_or_else(|| anyhow!("Tệp modpack không có manifest.json"))?;
    let manifest: Value = serde_json::from_str(&raw)?;
    let mc = manifest
        .pointer("/minecraft/version")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    let loader_raw = manifest
        .pointer("/minecraft/modLoaders/0/id")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    let (loader, mut loader_version) = split_cf_loader(&loader_raw);
    if loader == "forge" {
        if let Some(version) = loader_version.as_ref() {
            loader_version = Some(if version.starts_with(&format!("{mc}-")) {
                version.clone()
            } else {
                format!("{mc}-{version}")
            });
        }
    }
    let entries = manifest
        .get("files")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let mut files = Vec::new();
    let mut resolved = std::collections::HashMap::new();
    let mut ids = Vec::new();
    for entry in &entries {
        if let Some(file_id) = entry.get("fileID").and_then(Value::as_u64) {
            ids.push(file_id);
        }
    }
    for chunk in ids.chunks(100) {
        let body = serde_json::json!({ "fileIds": chunk });
        if let Ok(res) = crate::net::client()
            .post(format!("{CF}/mods/files"))
            .json(&body)
            .send()
            .await
        {
            if let Ok(data) = res.json::<Value>().await {
                for file in data.get("data").and_then(Value::as_array).cloned().unwrap_or_default() {
                    if let Some(id) = file.get("id").and_then(Value::as_u64) {
                        resolved.insert(id, file);
                    }
                }
            }
        }
    }
    for entry in &entries {
        let Some(file_id) = entry.get("fileID").and_then(Value::as_u64) else {
            continue;
        };
        let file_id_num = file_id;
        let mut file = resolved.get(&file_id_num).cloned();
        if file.is_none() {
            if let Some(project_id) = entry.get("projectID").and_then(Value::as_u64) {
                if let Ok(data) =
                    cf_json(&format!("{CF}/mods/{project_id}/files/{file_id_num}")).await
                {
                    file = data.get("data").cloned();
                }
            }
        }
        let Some(file) = file else {
            on_log(format!("[XyoLauncher] Không đọc được tệp CurseForge {file_id}"));
            continue;
        };
        let Some(url) = cf_file_url(&file) else {
            continue;
        };
        let name = file
            .get("fileName")
            .and_then(Value::as_str)
            .unwrap_or("mod.jar")
            .to_string();
        files.push(PackFile {
            rel: format!("mods/{name}"),
            url,
            sha1: cf_sha1(&file),
            size: file.get("fileLength").and_then(Value::as_u64).unwrap_or(0),
            alts: cf_file_alts(&file),
        });
    }
    let overrides = vec!["overrides".to_string(), "client-overrides".to_string()];
    let extras = zip_entry_names(&zip)
        .iter()
        .filter(|name| name.to_lowercase().starts_with("overrides/"))
        .count();
    let name = manifest
        .get("name")
        .and_then(Value::as_str)
        .filter(|v| !v.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| {
            zip_path
                .file_stem()
                .map(|v| v.to_string_lossy().into_owned())
                .unwrap_or_else(|| "Modpack".into())
        });
    Ok(ModpackPlan {
        name,
        summary: manifest
            .get("author")
            .and_then(Value::as_str)
            .map(|a| format!("Bởi {a}"))
            .unwrap_or_default(),
        version: manifest
            .get("version")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string(),
        mc,
        loader,
        loader_version,
        source: "curseforge".into(),
        zip_path: zip_path.to_path_buf(),
        listed: entries.len(),
        files,
        overrides,
        extras,
        missing: Vec::new(),
    })
}

pub async fn parse_pack_file(zip_path: &Path, on_log: impl Fn(String)) -> Result<ModpackPlan> {
    let is_mrpack = zip_path
        .extension()
        .map(|e| e.to_string_lossy().eq_ignore_ascii_case("mrpack"))
        .unwrap_or(false);
    if is_mrpack {
        return parse_mrpack(zip_path);
    }
    let has_manifest = {
        let file = std::fs::File::open(zip_path)?;
        let mut zip = zip::ZipArchive::new(file)?;
        let has = zip.by_name("modrinth.index.json").is_ok();
        let has_cf = zip.by_name("manifest.json").is_ok();
        if has {
            return parse_mrpack(zip_path);
        }
        has_cf
    };
    if !has_manifest {
        return Err(anyhow!("Tệp không phải modpack (.mrpack hoặc zip có manifest.json)"));
    }
    parse_curseforge_zip(zip_path, on_log).await
}

pub async fn resolve(
    store: &crate::store::Store,
    source: &str,
    pack_id: &str,
    file_id: &str,
    progress: Option<ProgressFn>,
    on_log: impl Fn(String) + Clone,
) -> Result<ModpackPlan> {
    let cache = store.data_dir.join("pack-cache");
    let _ = std::fs::create_dir_all(&cache);
    if source == "curseforge" {
        let data = cf_json(&format!(
            "{CF}/mods/{}/files/{}",
            urlencode(pack_id),
            urlencode(file_id)
        ))
        .await?;
        let file = data
            .get("data")
            .cloned()
            .ok_or_else(|| anyhow!("Không đọc được tệp modpack."))?;
        let name = file
            .get("fileName")
            .and_then(Value::as_str)
            .unwrap_or("pack.zip")
            .to_string();
        let target = cache.join(format!("cf-{}-{}", file_id, crate::util::safe_name(&name)));
        if !target.is_file() {
            let url = cf_file_url(&file).ok_or_else(|| anyhow!("Tệp modpack không cho tải trực tiếp."))?;
            let mut last = anyhow!("Tải modpack thất bại");
            for alt in cf_file_alts(&file) {
                match crate::net::download_one(&alt, &target, None, std::sync::Arc::new(|_| {})).await {
                    Ok(_) => {
                        last = anyhow!("");
                        break;
                    }
                    Err(err) => last = err,
                }
            }
            if !last.to_string().is_empty() {
                return Err(last);
            }
        }
        return parse_curseforge_zip(&target, on_log).await;
    }
    let version = crate::net::fetch_json(&format!(
        "{}/version/{}",
        content::MODRINTH,
        urlencode(file_id)
    ))
    .await?;
    let file = content::pick_file(version.get("files").unwrap_or(&Value::Null))
        .ok_or_else(|| anyhow!("Không đọc được tệp modpack."))?;
    let name = file
        .get("filename")
        .and_then(Value::as_str)
        .unwrap_or("pack.mrpack");
    let url = file
        .get("url")
        .and_then(Value::as_str)
        .ok_or_else(|| anyhow!("Tệp modpack không có link tải."))?;
    let target = cache.join(format!("mr-{}-{}", file_id, crate::util::safe_name(name)));
    if !target.is_file() {
        crate::net::download_one(url, &target, file.get("sha1").and_then(Value::as_str), std::sync::Arc::new(|_| {})).await?;
    }
    let _ = progress;
    parse_mrpack(&target)
}

fn urlencode(value: &str) -> String {
    value
        .bytes()
        .map(|b| {
            if b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b'.' | b'~') {
                (b as char).to_string()
            } else {
                format!("%{b:02X}")
            }
        })
        .collect()
}

pub struct ApplyResult {
    pub downloaded: usize,
    pub failed: Vec<String>,
    pub overrides: usize,
    pub errors: Vec<String>,
    pub owned: Vec<Value>,
}

pub async fn apply(
    plan: &ModpackPlan,
    instance_dir: &Path,
    progress: Option<ProgressFn>,
    on_log: impl Fn(String),
) -> Result<ApplyResult> {
    std::fs::create_dir_all(instance_dir)?;
    let tasks: Vec<DownloadTask> = plan
        .files
        .iter()
        .map(|file| DownloadTask {
            url: file.url.clone(),
            dest: instance_dir.join(file.rel.replace('/', "\\")),
            sha1: file.sha1.clone(),
            size: file.size,
            skip_hash: file.sha1.is_none(),
            name: file.rel.clone(),
        })
        .collect();
    let total = tasks.len();
    let report = crate::net::download_all(tasks, 12, progress, "modpack", false).await;
    let failed: Vec<String> = report
        .errors
        .iter()
        .filter_map(|(file, _)| file.file_name().map(|v| v.to_string_lossy().into_owned()))
        .collect();
    if !failed.is_empty() {
        on_log(format!(
            "[XyoLauncher] Tải lỗi {} tệp: {}",
            failed.len(),
            failed.iter().take(6).cloned().collect::<Vec<_>>().join(", ")
        ));
    }
    let overrides = extract_overrides(&plan.zip_path, &plan.overrides, instance_dir)?;
    let mut owned = Vec::new();
    for file in &plan.files {
        if failed.iter().any(|name| name == Path::new(&file.rel).file_name().map(|v| v.to_string_lossy().into_owned()).unwrap_or_default().as_str()) {
            continue;
        }
        owned.push(serde_json::json!({"rel": file.rel, "sha1": file.sha1, "size": file.size}));
    }
    for rel in &overrides {
        let rel = Path::new(rel)
            .strip_prefix(instance_dir)
            .map(|p| p.to_string_lossy().replace('\\', "/"))
            .unwrap_or_else(|_| rel.clone());
        owned.push(serde_json::json!({"rel": rel}));
    }
    Ok(ApplyResult {
        downloaded: total - failed.len(),
        failed,
        overrides: overrides.len(),
        errors: report
            .errors
            .iter()
            .map(|(file, error)| format!("{error} ({})", file.display()))
            .collect(),
        owned,
    })
}

pub fn write_marker(instance_dir: &Path, plan: &ModpackPlan, applied: &ApplyResult) {
    let marker = serde_json::json!({
        "source": plan.source,
        "name": plan.name,
        "version": plan.version,
        "mc": plan.mc,
        "loader": plan.loader,
        "loaderVersion": plan.loader_version,
        "summary": plan.summary,
        "mods": plan.files.iter().filter(|f| f.rel.starts_with("mods/")).count(),
        "missing": plan.missing.len(),
        "applied": {
            "downloaded": applied.downloaded,
            "failed": applied.failed.len(),
            "overrides": applied.overrides,
        },
        "owned": applied.owned,
        "installedAt": crate::util::now_iso(),
    });
    crate::store::write_json_atomic(&instance_dir.join(".lunaspace-modpack.json"), &marker);
}

pub async fn versions(source: &str, id: &str) -> Result<Vec<crate::models::ContentVersion>> {
    content::versions(Kind::Modpacks, source, id).await
}
