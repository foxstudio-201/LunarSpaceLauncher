use crate::mc::paths::{Paths, java_exe, platform_key};
use crate::models::{JavaRuntime, Progress};
use crate::net::{DownloadTask, ProgressFn};
use anyhow::{anyhow, Result};
use serde_json::Value;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tokio::process::Command;

pub const INDEX_URL: &str =
    "https://launchermeta.mojang.com/v1/products/java-runtime/2ec0cc96c44e5a76b9c8b7c39df7210883d12871/all.json";
const MARKER: &str = "lunaspace-runtime.json";
const ZULU_API: &str = "https://api.azul.com/metadata/v1/zulu/packages/";

pub fn major_of(name: &str) -> Option<u32> {
    let digits: String = name.chars().take_while(|c| c.is_ascii_digit()).collect();
    digits.parse().ok()
}

pub fn is_runtime_component(component: &str) -> bool {
    component != "minecraft-java-exe"
        && (component.starts_with("java-runtime") || component == "jre-legacy")
}

pub fn runtime_dir(paths: &Paths, component: &str) -> PathBuf {
    paths.runtime.join(format!("{}-{}", component, platform_key()))
}

pub fn java_path_for(dir: &Path) -> PathBuf {
    dir.join("bin").join(java_exe())
}

fn read_marker(dir: &Path) -> Option<Value> {
    std::fs::read_to_string(dir.join(MARKER))
        .ok()
        .and_then(|raw| serde_json::from_str(&raw).ok())
}

pub async fn get_index(meta_dir: &Path, force: bool) -> Result<Value> {
    let file = meta_dir.join("java-runtimes.json");
    if !force {
        if let Ok(raw) = std::fs::read_to_string(&file) {
            if let Ok(value) = serde_json::from_str::<Value>(&raw) {
                if value.get("platforms").is_some() {
                    return Ok(value);
                }
            }
        }
    }
    let index = crate::net::fetch_json(INDEX_URL).await?;
    if index.get(platform_key()).is_none() {
        return Err(anyhow!("Manifest Java không có nền tảng này"));
    }
    let _ = std::fs::create_dir_all(meta_dir);
    let _ = std::fs::write(
        &file,
        serde_json::to_string(&index).unwrap_or_else(|_| "{}".into()),
    );
    Ok(index)
}

pub struct RuntimeComponent {
    pub component: String,
    pub name: String,
    pub released: String,
    pub manifest_url: String,
    pub manifest_sha1: String,
    pub manifest_size: u64,
}

pub async fn find_component(
    meta_dir: &Path,
    component: &str,
    force: bool,
) -> Result<Option<RuntimeComponent>> {
    let index = get_index(meta_dir, force).await?;
    let Some(list) = index
        .get(platform_key())
        .and_then(|p| p.get(component))
        .and_then(Value::as_array)
    else {
        return Ok(None);
    };
    let Some(entry) = list.first() else {
        return Ok(None);
    };
    let manifest = entry.get("manifest").cloned().unwrap_or(Value::Null);
    Ok(Some(RuntimeComponent {
        component: component.to_string(),
        name: manifest
            .get("name")
            .and_then(Value::as_str)
            .or_else(|| entry.pointer("/version/name").and_then(Value::as_str))
            .unwrap_or(component)
            .to_string(),
        released: entry
            .pointer("/version/released")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string(),
        manifest_url: manifest
            .get("url")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string(),
        manifest_sha1: manifest
            .get("sha1")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string(),
        manifest_size: manifest.get("size").and_then(Value::as_u64).unwrap_or(0),
    }))
}

pub async fn component_for_major(meta_dir: &Path, major: u32) -> Result<Option<String>> {
    let index = get_index(meta_dir, false).await?;
    let Some(platform) = index.get(platform_key()).and_then(Value::as_object) else {
        return Ok(None);
    };
    let mut candidates: Vec<(String, u32)> = Vec::new();
    for (component, list) in platform {
        if !is_runtime_component(component) || component.contains("snapshot") {
            continue;
        }
        let Some(name) = list
            .get(0)
            .and_then(|v| v.pointer("/version/name"))
            .and_then(Value::as_str)
        else {
            continue;
        };
        if let Some(value) = major_of(name) {
            candidates.push((component.clone(), value));
        }
    }
    if let Some((component, _)) = candidates.iter().find(|(_, value)| *value == major) {
        return Ok(Some(component.clone()));
    }
    Ok(candidates
        .iter()
        .filter(|(_, value)| *value < major)
        .max_by_key(|(_, value)| *value)
        .map(|(component, _)| component.clone()))
}

async fn is_ready(dir: &Path, manifest_sha1: &str) -> bool {
    let Some(marker) = read_marker(dir) else {
        return false;
    };
    if marker.get("manifestSha1").and_then(Value::as_str) != Some(manifest_sha1) {
        return false;
    }
    tokio::fs::metadata(java_path_for(dir))
        .await
        .map(|m| m.is_file())
        .unwrap_or(false)
}

pub struct InstalledRuntime {
    pub java_path: PathBuf,
    pub dir: PathBuf,
    pub component: String,
    pub name: String,
    pub major: u32,
    pub bytes: u64,
    pub cached: bool,
}

pub async fn install_runtime(
    paths: &Paths,
    meta_dir: &Path,
    component: &str,
    progress: Option<ProgressFn>,
) -> Result<InstalledRuntime> {
    let entry = find_component(meta_dir, component, false)
        .await?
        .ok_or_else(|| {
            anyhow!(
                "Máy chủ Minecraft không có Java runtime \"{component}\" cho nền tảng {}",
                platform_key()
            )
        })?;
    let dir = runtime_dir(paths, component);
    if is_ready(&dir, &entry.manifest_sha1).await {
        return Ok(InstalledRuntime {
            java_path: java_path_for(&dir),
            dir,
            component: component.to_string(),
            name: entry.name.clone(),
            major: major_of(&entry.name).unwrap_or(0),
            bytes: 0,
            cached: true,
        });
    }
    let manifest = crate::net::fetch_json(&entry.manifest_url).await?;
    let files = manifest
        .get("files")
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default();
    let mut tasks = Vec::new();
    let mut executables = Vec::new();
    let mut expected_bytes = 0u64;
    for (rel, info) in &files {
        let dest = dir.join(rel.replace('/', std::path::MAIN_SEPARATOR_STR));
        match info.get("type").and_then(Value::as_str).unwrap_or("") {
            "directory" => {
                let _ = tokio::fs::create_dir_all(&dest).await;
                continue;
            }
            "link" => continue,
            _ => {}
        }
        let Some(raw) = info.pointer("/downloads/raw") else {
            continue;
        };
        let Some(url) = raw.get("url").and_then(Value::as_str) else {
            continue;
        };
        let size = raw.get("size").and_then(Value::as_u64).unwrap_or(0);
        expected_bytes += size;
        if info.get("executable").and_then(Value::as_bool) == Some(true) {
            executables.push(dest.clone());
        }
        tasks.push(DownloadTask {
            url: url.to_string(),
            dest,
            sha1: raw.get("sha1").and_then(Value::as_str).map(str::to_string),
            size,
            skip_hash: true,
            name: String::new(),
        });
    }
    let report = crate::net::download_all(tasks.clone(), 16, progress, "java", false).await;
    if let Some((file, error)) = report.errors.first() {
        return Err(anyhow!(
            "Tải Java {} lỗi: {error} ({})",
            entry.name,
            file.display()
        ));
    }
    if let Some(parent) = dir.join("bin").parent() {
        let _ = tokio::fs::create_dir_all(parent).await;
    }
    let marker = serde_json::json!({
        "component": component,
        "platform": platform_key(),
        "name": entry.name,
        "released": entry.released,
        "manifestSha1": entry.manifest_sha1,
        "files": tasks.len(),
        "bytes": expected_bytes,
        "installedAt": crate::util::now_iso(),
    });
    crate::store::write_json_atomic(&dir.join(MARKER), &marker);
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        for path in &executables {
            if let Ok(meta) = std::fs::metadata(path) {
                let mut perms = meta.permissions();
                perms.set_mode(perms.mode() | 0o111);
                let _ = std::fs::set_permissions(path, perms);
            }
        }
    }
    #[cfg(not(unix))]
    let _ = executables;
    Ok(InstalledRuntime {
        java_path: java_path_for(&dir),
        dir,
        component: component.to_string(),
        name: entry.name.clone(),
        major: major_of(&entry.name).unwrap_or(0),
        bytes: expected_bytes,
        cached: false,
    })
}

pub async fn managed_java(
    paths: &Paths,
    meta_dir: &Path,
    component: Option<&str>,
    major: Option<u32>,
) -> Option<InstalledRuntime> {
    if let Some(component) = component {
        if let Ok(Some(entry)) = find_component(meta_dir, component, false).await {
            let dir = runtime_dir(paths, component);
            if is_ready(&dir, &entry.manifest_sha1).await {
                return Some(InstalledRuntime {
                    java_path: java_path_for(&dir),
                    dir,
                    component: component.to_string(),
                    name: entry.name.clone(),
                    major: major_of(&entry.name).unwrap_or(0),
                    bytes: 0,
                    cached: true,
                });
            }
        }
    }
    let runtimes = list_runtimes(paths).await;
    let hit = runtimes.into_iter().find(|r| {
        r.installed && r.kind.as_deref() != Some("zulu") && major.map(|m| r.major == m).unwrap_or(true)
    })?;
    Some(InstalledRuntime {
        java_path: PathBuf::from(&hit.java_path),
        dir: PathBuf::from(&hit.dir),
        component: hit.component,
        name: hit.name,
        major: hit.major,
        bytes: 0,
        cached: true,
    })
}

pub async fn list_runtimes(paths: &Paths) -> Vec<JavaRuntime> {
    let meta_dir = paths.meta.clone();
    let index = get_index(&meta_dir, false).await.ok();
    let mut out = Vec::new();
    if let Some(platform) = index
        .as_ref()
        .and_then(|i| i.get(platform_key()))
        .and_then(Value::as_object)
    {
        for (component, list) in platform {
            if !is_runtime_component(component) {
                continue;
            }
            let Some(entry) = list.get(0) else { continue };
            let dir = runtime_dir(paths, component);
            let installed = java_path_for(&dir).is_file();
            let marker = read_marker(&dir);
            out.push(JavaRuntime {
                component: component.clone(),
                name: entry
                    .pointer("/version/name")
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .to_string(),
                major: major_of(
                    entry
                        .pointer("/version/name")
                        .and_then(Value::as_str)
                        .unwrap_or(""),
                )
                .unwrap_or(0),
                installed,
                dir: dir.to_string_lossy().into_owned(),
                java_path: java_path_for(&dir).to_string_lossy().into_owned(),
                bytes: if installed {
                    crate::util::dir_size(&dir).await
                } else {
                    0
                },
                download_bytes: entry
                    .pointer("/manifest/size")
                    .and_then(Value::as_u64)
                    .unwrap_or(0),
                installed_at: marker
                    .as_ref()
                    .and_then(|m| m.get("installedAt"))
                    .and_then(Value::as_str)
                    .map(str::to_string),
                kind: None,
            });
        }
    }
    if let Ok(mut entries) = tokio::fs::read_dir(&paths.runtime).await {
        while let Ok(Some(entry)) = entries.next_entry().await {
            let name = entry.file_name().to_string_lossy().into_owned();
            if !name.starts_with("zulu-") {
                continue;
            }
            let dir = entry.path();
            let Some(marker) = read_marker(&dir) else { continue };
            if marker.get("kind").and_then(Value::as_str) != Some("zulu") {
                continue;
            }
            let Some(java) = find_java_in_tree(&dir, 3) else {
                continue;
            };
            let major = marker.get("major").and_then(Value::as_u64).unwrap_or(0) as u32;
            let package_type = marker
                .get("packageType")
                .and_then(Value::as_str)
                .unwrap_or("jre");
            out.push(JavaRuntime {
                component: name.clone(),
                name: format!(
                    "Zulu {} {}",
                    package_type.to_uppercase(),
                    marker.get("version").and_then(Value::as_str).unwrap_or("")
                ),
                major,
                installed: true,
                dir: dir.to_string_lossy().into_owned(),
                java_path: java.to_string_lossy().into_owned(),
                bytes: crate::util::dir_size(&dir).await,
                download_bytes: 0,
                installed_at: marker
                    .get("installedAt")
                    .and_then(Value::as_str)
                    .map(str::to_string),
                kind: Some("zulu".into()),
            });
        }
    }
    out.sort_by(|a, b| b.major.cmp(&a.major).then_with(|| a.component.cmp(&b.component)));
    out
}

pub async fn remove_runtime(paths: &Paths, component: &str) -> Result<()> {
    let dir = runtime_dir(paths, component);
    if read_marker(&dir).is_none() {
        return Err(anyhow!("Runtime này không do XyoLauncher quản lý."));
    }
    tokio::fs::remove_dir_all(&dir).await?;
    Ok(())
}

pub async fn remove_zulu(paths: &Paths, dir: &str) -> Result<()> {
    let target = PathBuf::from(dir);
    let root = paths.runtime.canonicalize().unwrap_or_else(|_| paths.runtime.clone());
    let resolved = target.canonicalize().unwrap_or_else(|_| target.clone());
    if !resolved.starts_with(&root) {
        return Err(anyhow!("Thư mục ngoài runtime."));
    }
    let marker = read_marker(&resolved).ok_or_else(|| anyhow!("Không phải Java do XyoLauncher tải."))?;
    if marker.get("kind").and_then(Value::as_str) != Some("zulu") {
        return Err(anyhow!("Không phải Java do XyoLauncher tải."));
    }
    tokio::fs::remove_dir_all(&resolved).await?;
    Ok(())
}

#[derive(Clone, Debug)]
pub struct JavaInfo {
    pub path: PathBuf,
    pub major: u32,
    pub raw: String,
}

pub struct JavaSearch {
    pub ok: bool,
    pub java: Option<JavaInfo>,
    pub all: Vec<JavaInfo>,
    pub error: String,
}

async fn probe(exe: &Path) -> Option<JavaInfo> {
    let mut cmd = Command::new(exe);
    cmd.arg("-version");
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000);
    }
    let output = tokio::time::timeout(std::time::Duration::from_secs(8), cmd.output())
        .await
        .ok()?
        .ok()?;
    let text = format!(
        "{}{}",
        String::from_utf8_lossy(&output.stderr),
        String::from_utf8_lossy(&output.stdout)
    );
    static RE: once_cell::sync::Lazy<regex::Regex> =
        once_cell::sync::Lazy::new(|| regex::Regex::new(r#"version "(\d+)(?:\.(\d+))?"#).unwrap());
    let caps = RE.captures(&text)?;
    let first: u32 = caps[1].parse().ok()?;
    let major = if first >= 9 {
        first
    } else {
        caps.get(2)
            .and_then(|m| m.as_str().parse().ok())
            .unwrap_or(8)
    };
    Some(JavaInfo {
        path: exe.to_path_buf(),
        major,
        raw: text.lines().next().unwrap_or("").trim().to_string(),
    })
}

fn java_hints() -> Vec<PathBuf> {
    [
        "C:/Program Files/Java",
        "C:/Program Files/Eclipse Adoptium",
        "C:/Program Files/Microsoft",
        "C:/Program Files/Zulu",
        "C:/Program Files/BellSoft",
        "C:/Program Files/Amazon Corretto",
        "C:/Program Files/Temurin",
        "C:/Program Files/Common Files/Oracle/Java",
        "C:/Program Files (x86)/Java",
        "C:/Program Files (x86)/Eclipse Adoptium",
    ]
    .iter()
    .map(PathBuf::from)
    .collect()
}

fn scan_java_dirs() -> Vec<PathBuf> {
    let mut out = Vec::new();
    for root in java_hints() {
        let Ok(entries) = std::fs::read_dir(&root) else {
            continue;
        };
        for entry in entries.flatten() {
            if !entry.path().is_dir() {
                continue;
            }
            out.push(entry.path().join("bin").join(java_exe()));
            if let Ok(inner) = std::fs::read_dir(entry.path()) {
                for sub in inner.flatten() {
                    if sub.path().is_dir() {
                        out.push(sub.path().join("bin").join(java_exe()));
                    }
                }
            }
        }
    }
    out.push(PathBuf::from(
        "C:/Program Files/Common Files/Oracle/Java/javapath/java.exe",
    ));
    out.push(PathBuf::from("C:/ProgramData/Oracle/Java/javapath/java.exe"));
    if let Ok(path) = std::env::var("PATH") {
        for dir in path.split(if cfg!(windows) { ';' } else { ':' }) {
            if !dir.trim().is_empty() {
                out.push(PathBuf::from(dir).join(java_exe()));
            }
        }
    }
    out
}

pub async fn candidates(explicit: Option<&str>) -> Vec<PathBuf> {
    let mut list = Vec::new();
    if let Some(explicit) = explicit.filter(|v| !v.trim().is_empty()) {
        list.push(PathBuf::from(explicit));
    }
    if let Ok(home) = std::env::var("JAVA_HOME") {
        if !home.trim().is_empty() {
            list.push(PathBuf::from(home).join("bin").join(java_exe()));
        }
    }
    list.extend(scan_java_dirs());
    list.push(PathBuf::from(java_exe()));
    list.sort();
    list.dedup();
    list
}

pub async fn find_java(explicit: Option<&str>, required: u32) -> JavaSearch {
    let paths = candidates(explicit).await;
    let mut found = Vec::new();
    for exe in paths {
        if exe != Path::new(java_exe()) && tokio::fs::metadata(&exe).await.is_err() {
            continue;
        }
        if let Some(info) = probe(&exe).await {
            if !found.iter().any(|f: &JavaInfo| f.path == info.path) {
                found.push(info);
            }
        }
    }
    if found.is_empty() {
        return JavaSearch {
            ok: false,
            java: None,
            all: found,
            error: "Không tìm thấy Java trên máy. Hãy chọn đường dẫn Java trong Hệ thống.".into(),
        };
    }
    let mut ok_list: Vec<&JavaInfo> = found.iter().filter(|j| j.major >= required).collect();
    ok_list.sort_by_key(|j| j.major);
    if let Some(best) = ok_list.first() {
        return JavaSearch {
            ok: true,
            java: Some((*best).clone()),
            all: found,
            error: String::new(),
        };
    }
    let best = found.iter().max_by_key(|j| j.major).cloned();
    JavaSearch {
        ok: false,
        java: best.clone(),
        all: found,
        error: format!(
            "Cần Java {required} nhưng máy chỉ có Java {}. Hãy chọn Java {required}+ trong Hệ thống.",
            best.map(|j| j.major).unwrap_or(0)
        ),
    }
}

pub struct ZuluPackage {
    pub name: String,
    pub url: String,
    pub version: String,
    pub major: u32,
}

pub async fn zulu_packages(major: u32, kind: &str) -> Result<Vec<ZuluPackage>> {
    let os = if cfg!(windows) {
        "windows"
    } else if cfg!(target_os = "macos") {
        "macos"
    } else {
        "linux"
    };
    let arch = if cfg!(target_arch = "aarch64") {
        "aarch64"
    } else if cfg!(target_arch = "x86") {
        "x86"
    } else {
        "x64"
    };
    let archive_type = if cfg!(windows) { "zip" } else { "tar.gz" };
    let url = format!(
        "{ZULU_API}?java_version={major}&os={os}&arch={arch}&archive_type={archive_type}&java_package_type={}&release_status=ga&availability_types=CA&latest=true&page_size=40",
        if kind == "jdk" { "jdk" } else { "jre" }
    );
    let rows = crate::net::fetch_json(&url).await?;
    let list = rows.as_array().cloned().unwrap_or_default();
    let mut out: Vec<ZuluPackage> = list
        .iter()
        .filter(|row| {
            row.get("download_url").and_then(Value::as_str).is_some()
                && !row
                    .get("name")
                    .and_then(Value::as_str)
                    .map(|n| n.contains("-fx") || n.contains("-crac"))
                    .unwrap_or(false)
        })
        .filter_map(|row| {
            let name = row.get("name")?.as_str()?.to_string();
            let url = row.get("download_url")?.as_str()?.to_string();
            let parts = row
                .get("java_version")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default();
            let version = parts
                .iter()
                .take(3)
                .filter_map(|v| {
                    v.as_str()
                        .map(str::to_string)
                        .or_else(|| v.as_u64().map(|n| n.to_string()))
                })
                .collect::<Vec<_>>()
                .join(".");
            let major = parts
                .first()
                .and_then(Value::as_u64)
                .map(|v| v as u32)
                .unwrap_or(major);
            Some(ZuluPackage {
                name,
                url,
                version,
                major,
            })
        })
        .collect();
    out.sort_by(|a, b| b.version.cmp(&a.version));
    Ok(out)
}

pub async fn install_zulu(
    paths: &Paths,
    major: u32,
    kind: &str,
    progress: Option<ProgressFn>,
) -> Result<(PathBuf, JavaRuntime)> {
    let kind = if kind == "jdk" { "jdk" } else { "jre" };
    let list = zulu_packages(major, kind).await?;
    let pkg = list
        .first()
        .ok_or_else(|| anyhow!("Không tìm thấy bản Zulu {major} {} cho nền tảng này.", kind.to_uppercase()))?;
    let dir = paths
        .runtime
        .join(format!("zulu-{}-{}-{}", major, kind, platform_key()));
    let _ = tokio::fs::remove_dir_all(&dir).await;
    tokio::fs::create_dir_all(&dir).await?;
    let archive = paths.runtime.join(&pkg.name);
    let counter = Arc::new(std::sync::atomic::AtomicU64::new(0));
    let cb = progress.clone();
    crate::net::download_one(
        &pkg.url,
        &archive,
        None,
        Arc::new({
            let cb = cb.clone();
            move |delta| {
                let total = counter.fetch_add(delta, std::sync::atomic::Ordering::Relaxed) + delta;
                if let Some(cb) = cb.as_ref() {
                    cb(Progress {
                        label: "zulu".into(),
                        bytes_done: total,
                        ..Default::default()
                    });
                }
            }
        }),
    )
    .await?;
    #[cfg(windows)]
    extract_zip(&archive, &dir)?;
    #[cfg(not(windows))]
    extract_tar_gz(&archive, &dir)?;
    let _ = std::fs::remove_file(&archive);
    let java_path =
        find_java_in_tree(&dir, 3).ok_or_else(|| anyhow!("Không tìm thấy java trong gói Zulu vừa tải."))?;
    let marker = serde_json::json!({
        "kind": "zulu",
        "packageType": kind,
        "major": major,
        "package": pkg.name,
        "version": pkg.version,
        "installedAt": crate::util::now_iso(),
    });
    crate::store::write_json_atomic(&dir.join(MARKER), &marker);
    let info = JavaRuntime {
        component: dir
            .file_name()
            .map(|v| v.to_string_lossy().into_owned())
            .unwrap_or_default(),
        name: format!("Zulu {} {}", kind.to_uppercase(), pkg.version),
        major,
        installed: true,
        dir: dir.to_string_lossy().into_owned(),
        java_path: java_path.to_string_lossy().into_owned(),
        bytes: crate::util::dir_size(&dir).await,
        download_bytes: 0,
        installed_at: Some(crate::util::now_iso()),
        kind: Some("zulu".into()),
    };
    Ok((java_path, info))
}

#[cfg(target_os = "linux")]
pub async fn ensure_temurin(paths: &Paths, major: u32) -> Result<PathBuf> {
    let arch = if cfg!(target_arch = "aarch64") {
        "aarch64"
    } else {
        "x64"
    };
    let dir = paths
        .runtime
        .join(format!("temurin-{major}-jre-linux-{arch}"));
    if let Some(java) = find_java_in_tree(&dir, 3) {
        return Ok(java);
    }
    tokio::fs::create_dir_all(&paths.runtime).await?;
    let archive = paths
        .runtime
        .join(format!("temurin-{major}-jre-linux-{arch}.tar.gz"));
    let url = format!(
        "https://api.adoptium.net/v3/binary/latest/{major}/ga/linux/{arch}/jre/hotspot/normal/eclipse"
    );
    crate::net::download_one(&url, &archive, None, std::sync::Arc::new(|_| {})).await?;
    extract_tar_gz(&archive, &dir)?;
    let _ = std::fs::remove_file(&archive);
    find_java_in_tree(&dir, 3)
        .ok_or_else(|| anyhow!("Không tìm thấy java trong gói Temurin vừa tải."))
}

#[cfg(not(windows))]
fn extract_tar_gz(archive: &Path, dest: &Path) -> Result<()> {
    let file = std::fs::File::open(archive)?;
    let mut tar = tar::Archive::new(flate2::read::GzDecoder::new(file));
    tar.unpack(dest)?;
    Ok(())
}

fn find_java_in_tree(root: &Path, depth: u32) -> Option<PathBuf> {
    let direct = root.join("bin").join(java_exe());
    if direct.is_file() {
        return Some(direct);
    }
    if depth == 0 {
        return None;
    }
    let entries = std::fs::read_dir(root).ok()?;
    for entry in entries.flatten() {
        if entry.path().is_dir() {
            if let Some(found) = find_java_in_tree(&entry.path(), depth - 1) {
                return Some(found);
            }
        }
    }
    None
}

pub fn extract_zip(archive: &Path, dest: &Path) -> Result<()> {
    let file = std::fs::File::open(archive)?;
    let mut zip = zip::ZipArchive::new(file)?;
    for index in 0..zip.len() {
        let mut entry = zip.by_index(index)?;
        let Some(path) = entry.enclosed_name() else {
            continue;
        };
        let target = dest.join(path);
        if entry.is_dir() {
            std::fs::create_dir_all(&target)?;
        } else if let Some(parent) = target.parent() {
            std::fs::create_dir_all(parent)?;
            let mut out = std::fs::File::create(&target)?;
            std::io::copy(&mut entry, &mut out)?;
        }
    }
    Ok(())
}
