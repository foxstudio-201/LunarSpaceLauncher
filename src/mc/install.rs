use crate::mc::paths::{Paths, OS_ARCH, OS_NAME, maven_rel};
use crate::mc::meta::{get_manifest, get_version_json};
use crate::net::{DownloadTask, ProgressFn};
use anyhow::{anyhow, Result};
use serde_json::{Map, Value, json};
use std::path::PathBuf;
use std::sync::Arc;

pub fn rule_allows(rules: &Value) -> bool {
    let Some(list) = rules.as_array() else {
        return true;
    };
    if list.is_empty() {
        return true;
    }
    let mut allowed = false;
    for rule in list {
        let os_ok = match rule.get("os") {
            None => true,
            Some(os) => {
                let name_ok = os
                    .get("name")
                    .and_then(Value::as_str)
                    .map(|name| name == OS_NAME)
                    .unwrap_or(true);
                let arch_ok = os
                    .get("arch")
                    .and_then(Value::as_str)
                    .map(|arch| arch == OS_ARCH || (OS_ARCH == "x86_64" && arch == "x64"))
                    .unwrap_or(true);
                let version_ok = os
                    .get("version")
                    .and_then(Value::as_str)
                    .and_then(|pattern| regex::Regex::new(pattern).ok())
                    .map(|re| re.is_match(system_version().as_str()))
                    .unwrap_or(true);
                name_ok && arch_ok && version_ok
            }
        };
        let features_ok = rule
            .get("features")
            .and_then(Value::as_object)
            .map(|map| map.values().all(|v| v.as_bool() == Some(false)))
            .unwrap_or(true);
        if os_ok && features_ok {
            allowed = rule.get("action").and_then(Value::as_str) == Some("allow");
        }
    }
    allowed
}

fn system_version() -> String {
    std::env::var("OS").unwrap_or_else(|_| "10.0.26200".into())
}

pub async fn load_version_json(paths: &Paths, id: &str) -> Result<Value> {
    let candidates = [
        paths.meta.join("versions").join(format!("{id}.json")),
        paths.versions.join(id).join(format!("{id}.json")),
    ];
    for file in candidates {
        if let Ok(raw) = std::fs::read_to_string(&file) {
            if let Ok(value) = serde_json::from_str::<Value>(&raw) {
                return Ok(value);
            }
        }
    }
    let (manifest, _) = get_manifest(&paths.meta, false).await?;
    let url = manifest
        .get("versions")
        .and_then(Value::as_array)
        .and_then(|rows| {
            rows.iter()
                .find(|row| row.get("id").and_then(Value::as_str) == Some(id))
        })
        .and_then(|row| row.get("url"))
        .and_then(Value::as_str)
        .ok_or_else(|| anyhow!("Không tìm thấy phiên bản {id} trong manifest Mojang"))?
        .to_string();
    get_version_json(paths, id, Some(&url)).await
}

fn lib_key(name: &str) -> String {
    let parts: Vec<&str> = name.split(':').collect();
    let classifier = parts.get(3).copied().unwrap_or("");
    format!(
        "{}:{}{}",
        parts.first().copied().unwrap_or(""),
        parts.get(1).copied().unwrap_or(""),
        if classifier.is_empty() {
            String::new()
        } else {
            format!(":{classifier}")
        }
    )
}

fn merge_version(parent: &Value, child: &Value) -> Value {
    let child_keys: std::collections::HashSet<String> = child
        .get("libraries")
        .and_then(Value::as_array)
        .map(|libs| {
            libs.iter()
                .filter_map(|lib| lib.get("name").and_then(Value::as_str))
                .map(lib_key)
                .collect()
        })
        .unwrap_or_default();
    let parent_libs: Vec<Value> = parent
        .get("libraries")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default()
        .into_iter()
        .filter(|lib| {
            lib.get("name")
                .and_then(Value::as_str)
                .map(|name| !child_keys.contains(&lib_key(name)))
                .unwrap_or(true)
        })
        .collect();
    let child_libs = child
        .get("libraries")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let parent_jvm = parent
        .pointer("/arguments/jvm")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let child_jvm = child
        .pointer("/arguments/jvm")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let parent_game = parent
        .pointer("/arguments/game")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let child_game = child
        .pointer("/arguments/game")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();

    let mut out = child.clone();
    if let Some(obj) = out.as_object_mut() {
        let pick = |key: &str| -> Value {
            child
                .get(key)
                .filter(|v| !v.is_null())
                .or_else(|| parent.get(key))
                .cloned()
                .unwrap_or(Value::Null)
        };
        obj.insert("id".into(), child.get("id").cloned().unwrap_or(Value::Null));
        obj.insert(
            "_id".into(),
            child
                .get("id")
                .cloned()
                .unwrap_or_else(|| Value::String("".into())),
        );
        obj.insert("_jarId".into(), parent.get("_jarId").cloned().unwrap_or(Value::Null));
        obj.insert("mainClass".into(), pick("mainClass"));
        obj.insert(
            "libraries".into(),
            Value::Array(parent_libs.into_iter().chain(child_libs).collect()),
        );
        obj.insert(
            "arguments".into(),
            json!({
                "jvm": parent_jvm.into_iter().chain(child_jvm).collect::<Vec<_>>(),
                "game": parent_game.into_iter().chain(child_game).collect::<Vec<_>>(),
            }),
        );
        obj.insert("minecraftArguments".into(), pick("minecraftArguments"));
        obj.insert("assetIndex".into(), pick("assetIndex"));
        obj.insert("assets".into(), pick("assets"));
        obj.insert("downloads".into(), pick("downloads"));
        obj.insert("javaVersion".into(), pick("javaVersion"));
        obj.insert("type".into(), pick("type"));
        obj.insert("releaseTime".into(), pick("releaseTime"));
    }
    out
}

pub async fn resolve_chain(paths: &Paths, id: &str) -> Result<Value> {
    let json = load_version_json(paths, id).await?;
    match json.get("inheritsFrom").and_then(Value::as_str) {
        None => {
            let mut out = json.clone();
            if let Some(obj) = out.as_object_mut() {
                let own = obj
                    .get("id")
                    .cloned()
                    .unwrap_or_else(|| Value::String(id.to_string()));
                obj.insert("_id".into(), own.clone());
                obj.insert("_jarId".into(), own);
            }
            Ok(out)
        }
        Some(parent_id) => {
            let parent = Box::pin(resolve_chain(paths, parent_id)).await?;
            let mut merged = merge_version(&parent, &json);
            if let Some(obj) = merged.as_object_mut() {
                obj.insert("_id".into(), Value::String(id.to_string()));
                obj.insert(
                    "_jarId".into(),
                    parent.get("_jarId").cloned().unwrap_or(Value::String(parent_id.into())),
                );
            }
            Ok(merged)
        }
    }
}

struct LibTasks {
    artifacts: Vec<DownloadTask>,
    natives: Vec<PathBuf>,
}

fn library_tasks(version: &Value, paths: &Paths) -> LibTasks {
    let mut artifacts = Vec::new();
    let mut natives = Vec::new();
    let Some(libs) = version.get("libraries").and_then(Value::as_array) else {
        return LibTasks { artifacts, natives };
    };
    for lib in libs {
        if !rule_allows(lib.get("rules").unwrap_or(&Value::Null)) {
            continue;
        }
        let name = lib.get("name").and_then(Value::as_str).unwrap_or("");
        let downloads = lib.get("downloads").cloned().unwrap_or(Value::Null);
        if let Some(artifact) = downloads.get("artifact") {
            if let Some(url) = artifact.get("url").and_then(Value::as_str) {
                if let Some(path) = artifact.get("path").and_then(Value::as_str) {
                    let dest = paths.libraries.join(path.replace('/', "\\"));
                    artifacts.push(DownloadTask {
                        url: url.to_string(),
                        dest: dest.clone(),
                        sha1: artifact.get("sha1").and_then(Value::as_str).map(str::to_string),
                        size: artifact.get("size").and_then(Value::as_u64).unwrap_or(0),
                        skip_hash: false,
                        name: name.to_string(),
                    });
                    if name.contains(":natives-") {
                        natives.push(dest);
                    }
                }
            }
        }
        if let Some(natives_map) = lib.get("natives").and_then(Value::as_object) {
            if let Some(raw) = natives_map.get(OS_NAME).and_then(Value::as_str) {
                let classifier = raw.replace("${arch}", "64");
                if let Some(entry) = downloads
                    .get("classifiers")
                    .and_then(|c| c.get(&classifier))
                {
                    if let (Some(url), Some(path)) = (
                        entry.get("url").and_then(Value::as_str),
                        entry.get("path").and_then(Value::as_str),
                    ) {
                        let dest = paths.libraries.join(path.replace('/', "\\"));
                        artifacts.push(DownloadTask {
                            url: url.to_string(),
                            dest: dest.clone(),
                            sha1: entry.get("sha1").and_then(Value::as_str).map(str::to_string),
                            size: entry.get("size").and_then(Value::as_u64).unwrap_or(0),
                            skip_hash: false,
                            name: name.to_string(),
                        });
                        natives.push(dest);
                    }
                } else if downloads.get("artifact").is_none() {
                    if let Some(rel) = maven_rel(&format!("{name}:{classifier}")) {
                        let base = lib
                            .get("url")
                            .and_then(Value::as_str)
                            .unwrap_or("https://libraries.minecraft.net/")
                            .trim_end_matches('/')
                            .to_string();
                        let dest = paths.libraries.join(rel.replace('/', "\\"));
                        artifacts.push(DownloadTask {
                            url: format!("{base}/{rel}"),
                            dest: dest.clone(),
                            sha1: None,
                            size: 0,
                            skip_hash: true,
                            name: name.to_string(),
                        });
                        natives.push(dest);
                    }
                }
            }
        }
        let has_dl = downloads.get("artifact").is_some()
            || downloads.get("classifiers").is_some()
            || lib.get("natives").is_some();
        if !has_dl {
            if let Some(rel) = maven_rel(name) {
                let base = lib
                    .get("url")
                    .and_then(Value::as_str)
                    .unwrap_or("https://libraries.minecraft.net/")
                    .trim_end_matches('/')
                    .to_string();
                artifacts.push(DownloadTask {
                    url: format!("{base}/{rel}"),
                    dest: paths.libraries.join(rel.replace('/', "\\")),
                    sha1: None,
                    size: 0,
                    skip_hash: true,
                    name: name.to_string(),
                });
            }
        }
    }
    LibTasks { artifacts, natives }
}

async fn asset_tasks(
    version: &Value,
    paths: &Paths,
    progress: Option<ProgressFn>,
) -> Result<Vec<DownloadTask>> {
    let Some(index) = version.get("assetIndex") else {
        return Ok(Vec::new());
    };
    let Some(id) = index.get("id").and_then(Value::as_str) else {
        return Ok(Vec::new());
    };
    let index_file = paths.assets_indexes.join(format!("{id}.json"));
    if !index_file.is_file() {
        let task = DownloadTask {
            url: index
                .get("url")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string(),
            dest: index_file.clone(),
            sha1: index.get("sha1").and_then(Value::as_str).map(str::to_string),
            size: index.get("size").and_then(Value::as_u64).unwrap_or(0),
            skip_hash: false,
            name: String::new(),
        };
        let report = crate::net::download_all(vec![task], 1, progress, "index", false).await;
        if let Some((_, error)) = report.errors.first() {
            return Err(anyhow!("Không tải được asset index {id}: {error}"));
        }
    }
    let raw = std::fs::read_to_string(&index_file)?;
    let index_json: Value = serde_json::from_str(&raw)?;
    let Some(objects) = index_json.get("objects").and_then(Value::as_object) else {
        return Ok(Vec::new());
    };
    let mut tasks = Vec::with_capacity(objects.len());
    for object in objects.values() {
        let Some(hash) = object.get("hash").and_then(Value::as_str) else {
            continue;
        };
        if hash.len() < 3 {
            continue;
        }
        tasks.push(DownloadTask {
            url: format!(
                "https://resources.download.minecraft.net/{}/{}",
                &hash[..2],
                hash
            ),
            dest: paths.assets_objects.join(&hash[..2]).join(hash),
            sha1: Some(hash.to_string()),
            size: object.get("size").and_then(Value::as_u64).unwrap_or(0),
            skip_hash: true,
            name: String::new(),
        });
    }
    Ok(tasks)
}

fn extract_natives(jars: &[PathBuf], dest: &std::path::Path) -> usize {
    let _ = std::fs::create_dir_all(dest);
    let mut count = 0;
    for jar in jars {
        let Ok(file) = std::fs::File::open(jar) else {
            continue;
        };
        let Ok(mut archive) = zip::ZipArchive::new(file) else {
            continue;
        };
        for index in 0..archive.len() {
            let Ok(mut entry) = archive.by_index(index) else {
                continue;
            };
            if entry.is_dir() {
                continue;
            }
            let Some(name) = entry.enclosed_name() else {
                continue;
            };
            let text = name.to_string_lossy();
            if text.starts_with("META-INF/") {
                continue;
            }
            let target = dest.join(name);
            if let Some(parent) = target.parent() {
                let _ = std::fs::create_dir_all(parent);
            }
            if let Ok(mut out) = std::fs::File::create(&target) {
                let _ = std::io::copy(&mut entry, &mut out);
                count += 1;
            }
        }
    }
    count
}

pub struct InstallResult {
    pub chain: Value,
    pub errors: Vec<String>,
    pub downloaded: usize,
    pub natives_dir: PathBuf,
    pub repaired: bool,
    pub summary: Value,
}

pub async fn ensure_launch_files(
    paths: &Paths,
    version_id: &str,
    progress: Option<ProgressFn>,
) -> Result<InstallResult> {
    let chain = resolve_chain(paths, version_id).await?;
    let libs = library_tasks(&chain, paths);
    let client = chain.pointer("/downloads/client").cloned().unwrap_or(Value::Null);
    let jar_id = chain
        .get("_jarId")
        .and_then(Value::as_str)
        .unwrap_or(version_id);
    let mut tasks = libs.artifacts;
    if let Some(url) = client.get("url").and_then(Value::as_str) {
        tasks.push(DownloadTask {
            url: url.to_string(),
            dest: paths.versions.join(jar_id).join(format!("{jar_id}.jar")),
            sha1: client.get("sha1").and_then(Value::as_str).map(str::to_string),
            size: client.get("size").and_then(Value::as_u64).unwrap_or(0),
            skip_hash: false,
            name: String::new(),
        });
    }
    if let Ok(vanilla) = load_version_json(paths, jar_id).await {
        let dir = paths.versions.join(jar_id);
        let _ = std::fs::create_dir_all(&dir);
        let _ = crate::store::write_json_atomic(&dir.join(format!("{jar_id}.json")), &vanilla);
    }
    let natives_dir = paths
        .natives
        .join(chain.get("_id").and_then(Value::as_str).unwrap_or(version_id));
    let _ = std::fs::create_dir_all(&natives_dir);
    let natives_ok = std::fs::read_dir(&natives_dir)
        .map(|mut d| d.next().is_some())
        .unwrap_or(false);
    let mut to_download = Vec::new();
    for task in &tasks {
        if !crate::net::is_fresh(task).await {
            to_download.push(task.clone());
        }
    }
    if to_download.is_empty() && (natives_ok || libs.natives.is_empty()) {
        return Ok(InstallResult {
            summary: json!({"versionId": chain.get("_id"), "javaMajor": chain.pointer("/javaVersion/majorVersion")}),
            chain,
            errors: Vec::new(),
            downloaded: 0,
            natives_dir,
            repaired: false,
        });
    }
    let report = crate::net::download_all(to_download, 12, progress, "libraries", false).await;
    if report.errors.is_empty() && !natives_ok && !libs.natives.is_empty() {
        extract_natives(&libs.natives, &natives_dir);
    }
    Ok(InstallResult {
        summary: json!({"versionId": chain.get("_id"), "javaMajor": chain.pointer("/javaVersion/majorVersion")}),
        errors: report
            .errors
            .iter()
            .map(|(file, error)| format!("{error} ({})", file.display()))
            .collect(),
        downloaded: report.total - report.skipped,
        chain,
        natives_dir,
        repaired: true,
    })
}

pub async fn install(
    paths: &Paths,
    version_id: &str,
    progress: Option<ProgressFn>,
    force: bool,
) -> Result<InstallResult> {
    paths.ensure()?;
    let chain = resolve_chain(paths, version_id).await?;
    let libs = library_tasks(&chain, paths);
    let asset_tasks = asset_tasks(&chain, paths, progress.clone()).await?;
    let jar_id = chain
        .get("_jarId")
        .and_then(Value::as_str)
        .unwrap_or(version_id);
    let client = chain.pointer("/downloads/client").cloned().unwrap_or(Value::Null);
    let mut errors = Vec::new();
    let summary = json!({
        "versionId": chain.get("_id"),
        "jarId": jar_id,
        "libraries": libs.artifacts.len(),
        "objects": asset_tasks.len(),
        "hasClient": client.get("url").is_some(),
        "javaMajor": chain.pointer("/javaVersion/majorVersion").and_then(Value::as_u64).unwrap_or(8),
        "javaComponent": chain.pointer("/javaVersion/component"),
    });

    if let Ok(vanilla) = load_version_json(paths, jar_id).await {
        let dir = paths.versions.join(jar_id);
        let _ = std::fs::create_dir_all(&dir);
        let _ = crate::store::write_json_atomic(&dir.join(format!("{jar_id}.json")), &vanilla);
    }

    if let Some(url) = client.get("url").and_then(Value::as_str) {
        let task = DownloadTask {
            url: url.to_string(),
            dest: paths.versions.join(jar_id).join(format!("{jar_id}.jar")),
            sha1: client.get("sha1").and_then(Value::as_str).map(str::to_string),
            size: client.get("size").and_then(Value::as_u64).unwrap_or(0),
            skip_hash: false,
            name: String::new(),
        };
        let report = crate::net::download_all(vec![task], 1, progress.clone(), "client", force).await;
        errors.extend(
            report
                .errors
                .iter()
                .map(|(file, error)| format!("{error} ({})", file.display())),
        );
    }

    {
        let forced_prefixes = [
            "vn.lunar:",
            "net.fabricmc:",
            "org.quiltmc:",
            "net.minecraftforge:",
            "cpw.mods:",
        ];
        let (forced, normal): (Vec<_>, Vec<_>) = libs
            .artifacts
            .into_iter()
            .partition(|task| forced_prefixes.iter().any(|p| task.name.starts_with(p)));
        let normal_report =
            crate::net::download_all(normal, 12, progress.clone(), "libraries", false).await;
        errors.extend(
            normal_report
                .errors
                .iter()
                .map(|(file, error)| format!("{error} ({})", file.display())),
        );
        if force {
            let forced_report =
                crate::net::download_all(forced, 12, progress.clone(), "libraries", true).await;
            errors.extend(
                forced_report
                    .errors
                    .iter()
                    .map(|(file, error)| format!("{error} ({})", file.display())),
            );
        }
    }

    if !asset_tasks.is_empty() {
        let report = crate::net::download_all(asset_tasks, 20, progress.clone(), "assets", false).await;
        errors.extend(
            report
                .errors
                .iter()
                .map(|(file, error)| format!("{error} ({})", file.display())),
        );
    }

    let natives_dir = paths
        .natives
        .join(chain.get("_id").and_then(Value::as_str).unwrap_or(version_id));
    if !libs.natives.is_empty() {
        extract_natives(&libs.natives, &natives_dir);
    }

    let mut java_info = Value::Null;
    if let Some(component) = chain
        .pointer("/javaVersion/component")
        .and_then(Value::as_str)
    {
        match crate::mc::java::install_runtime(paths, &paths.meta, component, progress.clone()).await {
            Ok(runtime) => {
                java_info = json!({
                    "component": component,
                    "name": runtime.name,
                    "major": runtime.major,
                    "javaPath": runtime.java_path,
                    "bytes": runtime.bytes,
                    "cached": runtime.cached,
                });
            }
            Err(err) => {
                java_info = json!({"component": component, "error": err.to_string()});
            }
        }
    }
    let mut summary = summary;
    summary["java"] = java_info;
    Ok(InstallResult {
        chain,
        errors,
        downloaded: 0,
        natives_dir,
        repaired: true,
        summary,
    })
}

pub fn split_args(list: &Value) -> Vec<String> {
    let mut out = Vec::new();
    let Some(items) = list.as_array() else {
        return out;
    };
    for item in items {
        if let Some(text) = item.as_str() {
            out.push(text.to_string());
        } else if rule_allows(item.get("rules").unwrap_or(&Value::Null)) {
            match item.get("value") {
                Some(Value::Array(values)) => {
                    out.extend(values.iter().filter_map(|v| v.as_str().map(str::to_string)));
                }
                Some(Value::String(text)) => out.push(text.clone()),
                _ => {}
            }
        }
    }
    out
}

pub fn game_arg_value(chain: &Value, key: &str) -> Option<String> {
    let list = chain.pointer("/arguments/game")?.as_array()?;
    for pair in list.windows(2) {
        if pair[0].as_str() == Some(key) {
            return pair[1].as_str().map(str::to_string);
        }
    }
    None
}

pub fn library_classpath_entries(chain: &Value, paths: &Paths) -> Vec<PathBuf> {
    let mut out = Vec::new();
    let Some(libs) = chain.get("libraries").and_then(Value::as_array) else {
        return out;
    };
    for lib in libs {
        if !rule_allows(lib.get("rules").unwrap_or(&Value::Null)) {
            continue;
        }
        let downloads = lib.get("downloads").cloned().unwrap_or(Value::Null);
        if let Some(path) = downloads.pointer("/artifact/path").and_then(Value::as_str) {
            out.push(paths.libraries.join(path.replace('/', "\\")));
            continue;
        }
        if lib.get("natives").is_some() || downloads.get("classifiers").is_some() {
            continue;
        }
        if let Some(name) = lib.get("name").and_then(Value::as_str) {
            if let Some(rel) = maven_rel(name) {
                out.push(paths.libraries.join(rel.replace('/', "\\")));
            }
        }
    }
    out
}

pub fn chain_jar(chain: &Value, paths: &Paths) -> PathBuf {
    let own_id = chain
        .get("_id")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    let jar_id = chain
        .get("_jarId")
        .and_then(Value::as_str)
        .unwrap_or(&own_id)
        .to_string();
    let own_jar = paths.versions.join(&own_id).join(format!("{own_id}.jar"));
    if own_jar.is_file() {
        own_jar
    } else {
        paths.versions.join(&jar_id).join(format!("{jar_id}.jar"))
    }
}

pub fn chain_forge_bootstrap(chain: &Value) -> bool {
    chain
        .pointer("/arguments/jvm")
        .and_then(Value::as_array)
        .map(|args| {
            args.iter().any(|arg| {
                arg.as_str()
                    .map(|text| text.contains("client-extra"))
                    .unwrap_or(false)
            })
        })
        .unwrap_or(false)
}

pub fn base_url_of(url: &str) -> String {
    url.rsplit_once('/').map(|(base, _)| base.to_string()).unwrap_or_default()
}

pub fn object_clone(value: &Value) -> Map<String, Value> {
    value.as_object().cloned().unwrap_or_default()
}

pub type SharedProgress = Arc<dyn Fn(crate::models::Progress) + Send + Sync>;
