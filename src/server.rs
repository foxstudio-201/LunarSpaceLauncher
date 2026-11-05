use crate::backend::Backend;
use crate::mc::install;
use crate::mc::meta;
use anyhow::{anyhow, Result};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value, json};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::Arc;

#[derive(Clone, Debug, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ServerEntry {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub egg: String,
    #[serde(default)]
    pub mc: String,
    #[serde(default)]
    pub loader_version: Option<String>,
    #[serde(default = "default_ram")]
    pub ram_mb: u32,
    #[serde(default)]
    pub port: u16,
    #[serde(default)]
    pub dir: String,
    #[serde(default)]
    pub status: String,
    #[serde(default)]
    pub java_major: Option<u32>,
    #[serde(default)]
    pub created: Option<String>,
    #[serde(default)]
    pub last_started: Option<String>,
    #[serde(default)]
    pub include: Vec<String>,
    #[serde(default)]
    pub vars: Value,
    #[serde(default)]
    pub error: Option<String>,
    #[serde(flatten)]
    pub extra: Map<String, Value>,
}

fn default_ram() -> u32 {
    4096
}

pub fn root(backend: &Backend) -> PathBuf {
    backend.store.data_dir.join("servertest")
}

pub fn index_file(backend: &Backend) -> PathBuf {
    root(backend).join("index.json")
}

pub fn load_index(backend: &Backend) -> Vec<ServerEntry> {
    std::fs::read_to_string(index_file(backend))
        .ok()
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or_default()
}

pub fn save_index(backend: &Backend, list: &[ServerEntry]) {
    let value = serde_json::to_value(list).unwrap_or(Value::Array(Vec::new()));
    crate::store::write_json_atomic(&index_file(backend), &value);
}

pub fn find(backend: &Backend, id: &str) -> Option<ServerEntry> {
    load_index(backend).into_iter().find(|entry| entry.id == id)
}

pub fn update(backend: &Backend, id: &str, patch: Value) -> Option<ServerEntry> {
    let mut list = load_index(backend);
    let at = list.iter().position(|entry| entry.id == id)?;
    let mut value = serde_json::to_value(&list[at]).ok()?;
    crate::store::merge_object(&mut value, &patch);
    let next: ServerEntry = serde_json::from_value(value).ok()?;
    list[at] = next.clone();
    save_index(backend, &list);
    Some(next)
}

fn cron_field(field: &str, value: i64, min: i64, max: i64) -> bool {
    for part in field.split(',') {
        let part = part.trim();
        if part == "*" {
            return true;
        }
        if let Some(step) = part.strip_prefix("*/") {
            if let Ok(step) = step.parse::<i64>() {
                if step > 0 && (value - min) % step == 0 {
                    return true;
                }
            }
            continue;
        }
        if let Some((from, to)) = part.split_once('-') {
            if let (Ok(from), Ok(to)) = (from.trim().parse::<i64>(), to.trim().parse::<i64>()) {
                if value >= from && value <= to {
                    return true;
                }
            }
            continue;
        }
        if let Ok(number) = part.parse::<i64>() {
            let number = if max == 7 && number == 7 { 0 } else { number };
            if value == number {
                return true;
            }
        }
    }
    false
}

pub fn cron_matches(expression: &str, now: &chrono::DateTime<chrono::Local>) -> bool {
    use chrono::{Datelike, Timelike};
    let fields: Vec<&str> = expression.split_whitespace().collect();
    if fields.len() != 5 {
        return false;
    }
    let weekday = now.weekday().num_days_from_sunday() as i64;
    cron_field(fields[0], now.minute() as i64, 0, 59)
        && cron_field(fields[1], now.hour() as i64, 0, 23)
        && cron_field(fields[2], now.day() as i64, 1, 31)
        && cron_field(fields[3], now.month() as i64, 1, 12)
        && cron_field(fields[4], weekday, 0, 7)
}

pub fn new_id() -> String {
    format!(
        "srv-{}",
        &uuid::Uuid::new_v4().simple().to_string()[..10]
    )
}

pub fn find_free_port(start: u16) -> u16 {
    for port in start..start.saturating_add(60) {
        if std::net::TcpListener::bind(("0.0.0.0", port)).is_ok() {
            return port;
        }
    }
    start
}

pub fn write_config(entry: &ServerEntry) -> Result<()> {
    let dir = Path::new(&entry.dir);
    std::fs::create_dir_all(dir)?;
    std::fs::write(
        dir.join("eula.txt"),
        "#By changing the setting below to TRUE you are indicating your agreement to our EULA (https://aka.ms/MinecraftEULA)\neula=true\n",
    )?;
    let vars = &entry.vars;
    let port = if entry.port == 0 { 25565 } else { entry.port };
    let online = vars
        .get("online-mode")
        .and_then(Value::as_bool)
        .or_else(|| vars.get("online-mode").and_then(Value::as_str).map(|v| v != "false"))
        .unwrap_or(false);
    let motd = vars
        .get("motd")
        .and_then(Value::as_str)
        .unwrap_or("XyoLauncher Server");
    let gamemode = vars
        .get("gamemode")
        .and_then(Value::as_str)
        .unwrap_or("survival");
    let difficulty = vars
        .get("difficulty")
        .and_then(Value::as_str)
        .unwrap_or("easy");
    let max_players = vars
        .get("max-players")
        .and_then(Value::as_u64)
        .unwrap_or(20);
    let level = vars
        .get("level-name")
        .and_then(Value::as_str)
        .unwrap_or("world");
    let text = format!(
        "server-port={port}\nquery.port={port}\nserver-ip=\nlevel-name={level}\ngamemode={gamemode}\ndifficulty={difficulty}\nmax-players={max_players}\nonline-mode={}\nmotd={}\nenable-query=true\n",
        if online { "true" } else { "false" },
        motd.replace(['\r', '\n'], " ")
    );
    std::fs::write(dir.join("server.properties"), text)?;
    Ok(())
}

async fn download_to(
    backend: &Arc<Backend>,
    id: &str,
    url: &str,
    dest: &Path,
    log: &(dyn Fn(String) + Send + Sync),
) -> Result<()> {
    log(format!("[Cài đặt] Tải {}", url));
    if let Some(parent) = dest.parent() {
        tokio::fs::create_dir_all(parent).await?;
    }
    crate::net::download_one(
        url,
        dest,
        None,
        Arc::new(|_| {}),
    )
    .await?;
    let _ = backend;
    let _ = id;
    Ok(())
}

pub async fn install(
    backend: &Arc<Backend>,
    entry: &ServerEntry,
    log: Arc<dyn Fn(String) + Send + Sync + 'static>,
) -> Result<u32> {
    let dir = PathBuf::from(&entry.dir);
    tokio::fs::create_dir_all(&dir).await?;
    write_config(entry)?;
    let java = backend.server_java(&entry.mc).await?;
    let major = java.major;
    match entry.egg.as_str() {
        "vanilla" => {
            let paths = backend.paths();
            let chain = install::resolve_chain(&paths, &entry.mc).await?;
            let url = chain
                .pointer("/downloads/server/url")
                .and_then(Value::as_str)
                .ok_or_else(|| anyhow!("Phiên bản Minecraft này không có server jar."))?;
            download_to(backend, &entry.id, url, &dir.join("server.jar"), &*log).await?;
        }
        "paper" => {
            let api = format!(
                "https://api.papermc.io/v2/projects/paper/versions/{}/builds",
                entry.mc
            );
            let data = crate::net::fetch_json(&api).await.map_err(|err| {
                anyhow!("Paper chưa hỗ trợ Minecraft {}: {err}", entry.mc)
            })?;
            let builds = data
                .get("builds")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default();
            let latest = builds
                .last()
                .ok_or_else(|| anyhow!("Paper chưa có build cho Minecraft {}.", entry.mc))?;
            let build = latest.get("build").and_then(Value::as_u64).unwrap_or(0);
            let name = latest
                .pointer("/downloads/application/name")
                .and_then(Value::as_str)
                .unwrap_or("paper.jar");
            let url = format!(
                "https://api.papermc.io/v2/projects/paper/versions/{}/builds/{build}/downloads/{name}",
                entry.mc
            );
            download_to(backend, &entry.id, &url, &dir.join("server.jar"), &*log).await?;
        }
        "purpur" => {
            let url = format!(
                "https://api.purpurmc.org/v2/purpur/{}/latest/download",
                entry.mc
            );
            download_to(backend, &entry.id, &url, &dir.join("server.jar"), &*log).await?;
        }
        "fabric" => {
            let loader = match entry.loader_version.clone().filter(|v| !v.is_empty()) {
                Some(loader) => loader,
                None => {
                    let rows = meta::list_loader_versions("fabric", &entry.mc).await?;
                    rows.first()
                        .map(|row| row.version.clone())
                        .ok_or_else(|| anyhow!("Không có Fabric loader cho Minecraft {}.", entry.mc))?
                }
            };
            let url = format!(
                "https://meta.fabricmc.net/v2/versions/loader/{}/{loader}/1.0.1/server/jar",
                entry.mc
            );
            download_to(backend, &entry.id, &url, &dir.join("server.jar"), &*log).await?;
        }
        "forge" | "neoforge" => {
            install_forge_server(backend, entry, &java, &dir, log).await?;
        }
        other => return Err(anyhow!("Loại server không hỗ trợ: {other}")),
    }
    Ok(major)
}

async fn install_forge_server(
    backend: &Arc<Backend>,
    entry: &ServerEntry,
    java: &crate::mc::java::JavaInfo,
    dir: &Path,
    log: Arc<dyn Fn(String) + Send + Sync + 'static>,
) -> Result<()> {
    let loader_version = entry
        .loader_version
        .clone()
        .filter(|v| !v.is_empty())
        .ok_or_else(|| anyhow!("Thiếu phiên bản trình tải."))?;
    let full_id = meta::resolve_loader_full_id(
        if entry.egg == "neoforge" { "neoforge" } else { "forge" },
        &entry.mc,
        &loader_version,
    )
    .await;
    let is_neo = entry.egg == "neoforge";
    let (url, name) = if is_neo {
        let legacy = full_id.starts_with("1.20.1-");
        let (group, artifact) = if legacy {
            ("forge", "forge")
        } else {
            ("neoforge", "neoforge")
        };
        (
            format!(
                "https://maven.neoforged.net/releases/net/neoforged/{group}/{full_id}/{artifact}-{full_id}-installer.jar"
            ),
            format!("{artifact}-{full_id}-installer.jar"),
        )
    } else {
        (
            format!(
                "https://maven.minecraftforge.net/net/minecraftforge/forge/{full_id}/forge-{full_id}-installer.jar"
            ),
            format!("forge-{full_id}-installer.jar"),
        )
    };
    let installer = dir.join(&name);
    download_to(backend, &entry.id, &url, &installer, &*log).await?;
    let mut command = tokio::process::Command::new(&java.path);
    command
        .arg("-jar")
        .arg(&installer)
        .arg("--installServer")
        .arg(dir)
        .current_dir(dir)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .creation_flags(0x08000000);
    let mut child = command.spawn()?;
    for stream in [
        child.stdout.take().map(StreamKind::Out),
        child.stderr.take().map(StreamKind::Err),
    ]
    .into_iter()
    .flatten()
    {
        let log = log.clone();
        tokio::spawn(async move {
            use tokio::io::AsyncBufReadExt;
            match stream {
                StreamKind::Out(stream) => {
                    let mut lines = tokio::io::BufReader::new(stream).lines();
                    while let Ok(Some(line)) = lines.next_line().await {
                        log(format!("[Installer] {}", crate::util::strip_ansi(&line)));
                    }
                }
                StreamKind::Err(stream) => {
                    let mut lines = tokio::io::BufReader::new(stream).lines();
                    while let Ok(Some(line)) = lines.next_line().await {
                        log(format!("[Installer] {}", crate::util::strip_ansi(&line)));
                    }
                }
            }
        });
    }
    let status = tokio::time::timeout(std::time::Duration::from_secs(25 * 60), child.wait())
        .await
        .map_err(|_| anyhow!("Installer chạy quá lâu."))??;
    if !status.success() {
        return Err(anyhow!(
            "Installer kết thúc với mã {}",
            status.code().unwrap_or(-1)
        ));
    }
    // Locate launch args produced by the installer.
    let base = dir
        .join("libraries")
        .join("net")
        .join(if is_neo { "neoforged" } else { "minecraftforge" });
    let mut args_file: Option<PathBuf> = None;
    if let Ok(groups) = std::fs::read_dir(&base) {
        for group in groups.flatten() {
            if !group.path().is_dir() {
                continue;
            }
            if let Ok(versions) = std::fs::read_dir(group.path()) {
                for version in versions.flatten() {
                    if !version.path().is_dir() {
                        continue;
                    }
                    let win = version.path().join("win_args.txt");
                    let unix = version.path().join("unix_args.txt");
                    if win.is_file() {
                        args_file = Some(win);
                    } else if unix.is_file() {
                        args_file = Some(unix);
                    }
                }
            }
        }
    }
    if let Some(file) = args_file {
        let target = dir.join("win_args.txt");
        std::fs::copy(&file, &target)?;
    }
    let _ = std::fs::remove_file(&installer);
    Ok(())
}

enum StreamKind {
    Out(tokio::process::ChildStdout),
    Err(tokio::process::ChildStderr),
}

fn jar_side(path: &Path) -> Option<&'static str> {
    let file = std::fs::File::open(path).ok()?;
    let mut zip = zip::ZipArchive::new(file).ok()?;
    let mut text = String::new();
    for name in ["fabric.mod.json", "quilt.mod.json"] {
        if let Ok(mut entry) = zip.by_name(name) {
            text.clear();
            if entry.take(2 * 1024 * 1024).read_to_string(&mut text).is_ok() {
                if let Ok(value) = serde_json::from_str::<Value>(&text) {
                    let env = value
                        .pointer("/environment")
                        .or_else(|| value.pointer("/quilt_loader/environment"))
                        .and_then(Value::as_str)
                        .unwrap_or("");
                    if env.eq_ignore_ascii_case("client") {
                        return Some("client");
                    }
                    if env.eq_ignore_ascii_case("server") {
                        return Some("server");
                    }
                }
            }
        }
    }
    for name in ["META-INF/mods.toml", "META-INF/neoforge.mods.toml"] {
        if let Ok(mut entry) = zip.by_name(name) {
            text.clear();
            if entry.take(2 * 1024 * 1024).read_to_string(&mut text).is_ok() {
                for line in text.lines() {
                    let line = line.trim().to_lowercase();
                    if line.starts_with("side") && line.contains("client") {
                        return Some("client");
                    }
                    if line.starts_with("side") && line.contains("server") {
                        return Some("server");
                    }
                }
            }
        }
    }
    None
}

pub fn prune_client_mods(entry: &ServerEntry) -> Result<(usize, usize)> {
    let mods = Path::new(&entry.dir).join("mods");
    let target = mods.join("_client-only");
    let mut checked = 0;
    let mut moved = 0;
    let Ok(entries) = std::fs::read_dir(&mods) else {
        return Ok((0, 0));
    };
    for item in entries.flatten() {
        let path = item.path();
        if !path.is_file() {
            continue;
        }
        let name = item.file_name().to_string_lossy().to_lowercase();
        if !name.ends_with(".jar") {
            continue;
        }
        checked += 1;
        if jar_side(&path) == Some("client") {
            std::fs::create_dir_all(&target)?;
            let dest = target.join(item.file_name());
            if std::fs::rename(&path, &dest).is_ok() {
                moved += 1;
            }
        }
    }
    Ok((checked, moved))
}

pub fn launch_command(entry: &ServerEntry, java: &Path) -> (PathBuf, Vec<String>) {
    let dir = PathBuf::from(&entry.dir);
    let ram = format!("-Xmx{}M", entry.ram_mb.max(512));
    let mut extra: Vec<String> = entry
        .vars
        .get("jvmArgs")
        .and_then(Value::as_str)
        .unwrap_or("")
        .split_whitespace()
        .map(str::to_string)
        .collect();
    let args = if entry.egg == "forge" || entry.egg == "neoforge" {
        let args_file = if dir.join("win_args.txt").is_file() {
            "win_args.txt".to_string()
        } else {
            "unix_args.txt".to_string()
        };
        let mut args = vec![ram];
        args.append(&mut extra);
        args.push(format!("@{args_file}"));
        args.push("nogui".into());
        args
    } else {
        let mut args = vec![ram];
        args.append(&mut extra);
        args.push("-jar".into());
        args.push("server.jar".into());
        args.push("nogui".into());
        args
    };
    (dir, args)
}

pub fn detect_port(dir: &Path) -> Option<u16> {
    let log = dir.join("logs").join("latest.log");
    let text = crate::util::read_lines_tail(&log, 2 * 1024 * 1024).ok()?;
    static LAN: once_cell::sync::Lazy<regex::Regex> = once_cell::sync::Lazy::new(|| {
        regex::Regex::new(r"Started serving on (\d+)|Local game hosted on port \[?(\d+)\]?").unwrap()
    });
    static SERVER: once_cell::sync::Lazy<regex::Regex> = once_cell::sync::Lazy::new(|| {
        regex::Regex::new(r"Starting Minecraft server on [^:\s]*:(\d+)").unwrap()
    });
    let mut found = None;
    let mut stopped = false;
    for line in text.lines() {
        if let Some(caps) = LAN.captures(line) {
            let port = caps
                .get(1)
                .or_else(|| caps.get(2))
                .and_then(|m| m.as_str().parse::<u16>().ok());
            if let Some(port) = port {
                found = Some(port);
                stopped = false;
            }
            continue;
        }
        if let Some(caps) = SERVER.captures(line) {
            if let Some(port) = caps.get(1).and_then(|m| m.as_str().parse::<u16>().ok()) {
                found = Some(port);
                stopped = false;
            }
            continue;
        }
        if found.is_some() && line.contains("Stopping server") {
            stopped = true;
        }
    }
    if stopped {
        None
    } else {
        found
    }
}

pub fn backups_dir(backend: &Backend, id: &str) -> PathBuf {
    root(backend).join("backups").join(id)
}

fn read_array(path: &Path) -> Vec<Value> {
    std::fs::read_to_string(path)
        .ok()
        .and_then(|raw| serde_json::from_str::<Vec<Value>>(&raw).ok())
        .unwrap_or_default()
}

fn resolve_uuid(dir: &Path, name: &str) -> String {
    let cache = read_array(&dir.join("usercache.json"));
    if let Some(uuid) = cache
        .iter()
        .find(|row| {
            row.get("name")
                .and_then(Value::as_str)
                .map(|value| value.eq_ignore_ascii_case(name))
                .unwrap_or(false)
        })
        .and_then(|row| row.get("uuid").and_then(Value::as_str))
    {
        return uuid.to_string();
    }
    crate::store::offline_uuid(name)
}

pub fn users(entry: &ServerEntry) -> Result<Value> {
    let dir = Path::new(&entry.dir);
    let whitelist = read_array(&dir.join("whitelist.json"));
    let ops = read_array(&dir.join("ops.json"));
    Ok(json!({
        "whitelist": whitelist.iter().map(|row| json!({
            "name": row.get("name").and_then(Value::as_str).unwrap_or(""),
            "uuid": row.get("uuid").and_then(Value::as_str).unwrap_or(""),
        })).collect::<Vec<_>>(),
        "ops": ops.iter().map(|row| json!({
            "name": row.get("name").and_then(Value::as_str).unwrap_or(""),
            "uuid": row.get("uuid").and_then(Value::as_str).unwrap_or(""),
            "level": row.get("level").and_then(Value::as_u64).unwrap_or(4),
        })).collect::<Vec<_>>(),
        "onlineMode": entry.vars.get("online-mode").and_then(Value::as_bool).unwrap_or(false),
    }))
}

pub fn set_user(entry: &ServerEntry, name: &str, whitelist: bool, op: bool) -> Result<()> {
    let name = name.trim();
    if !crate::store::validate_mc_name(name) {
        return Err(anyhow!("Tên người chơi không hợp lệ."));
    }
    let dir = Path::new(&entry.dir);
    let uuid = resolve_uuid(dir, name);
    let mut white = read_array(&dir.join("whitelist.json"));
    let mut ops = read_array(&dir.join("ops.json"));
    white.retain(|row| {
        !row.get("name")
            .and_then(Value::as_str)
            .map(|value| value.eq_ignore_ascii_case(name))
            .unwrap_or(false)
    });
    ops.retain(|row| {
        !row.get("name")
            .and_then(Value::as_str)
            .map(|value| value.eq_ignore_ascii_case(name))
            .unwrap_or(false)
    });
    if whitelist {
        white.push(json!({"uuid": uuid, "name": name}));
    }
    if op {
        ops.push(json!({"uuid": uuid, "name": name, "level": 4, "bypassesPlayerLimit": false}));
    }
    crate::store::write_json_atomic(&dir.join("whitelist.json"), &Value::Array(white));
    crate::store::write_json_atomic(&dir.join("ops.json"), &Value::Array(ops));
    Ok(())
}

pub fn list_backups(backend: &Backend, id: &str) -> Vec<Value> {
    std::fs::read_to_string(backups_dir(backend, id).join("index.json"))
        .ok()
        .and_then(|raw| serde_json::from_str::<Vec<Value>>(&raw).ok())
        .unwrap_or_default()
}

pub fn create_backup(backend: &Backend, entry: &ServerEntry, name: &str) -> Result<Value> {
    let dir = backups_dir(backend, &entry.id);
    std::fs::create_dir_all(&dir)?;
    let uuid = uuid::Uuid::new_v4().to_string();
    let safe = crate::util::safe_name(if name.trim().is_empty() { "backup" } else { name });
    let file = dir.join(format!("{}-{}.zip", safe, &uuid[..8]));
    let out = std::fs::File::create(&file)?;
    let mut zip = zip::ZipWriter::new(out);
    let options = zip::write::SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated);
    let base = Path::new(&entry.dir);
    let mut stack = vec![base.to_path_buf()];
    while let Some(current) = stack.pop() {
        let Ok(entries) = std::fs::read_dir(&current) else { continue };
        for item in entries.flatten() {
            let path = item.path();
            if path.starts_with(&dir) {
                continue;
            }
            let rel = path
                .strip_prefix(base)
                .map(|p| p.to_string_lossy().replace('\\', "/"))
                .unwrap_or_default();
            if rel.is_empty() {
                continue;
            }
            if item.file_type().map(|t| t.is_dir()).unwrap_or(false) {
                zip.add_directory(format!("{rel}/"), options)?;
                stack.push(path);
            } else {
                zip.start_file(rel, options)?;
                if let Ok(mut file) = std::fs::File::open(&path) {
                    let mut buf = Vec::new();
                    if file.read_to_end(&mut buf).is_ok() {
                        zip.write_all(&buf)?;
                    }
                }
            }
        }
    }
    zip.finish()?;
    let size = std::fs::metadata(&file).map(|m| m.len()).unwrap_or(0);
    let row = json!({
        "id": uuid,
        "name": if name.trim().is_empty() { "Sao lưu".to_string() } else { name.trim().to_string() },
        "file": file.to_string_lossy(),
        "size": size,
        "created": crate::util::now_iso(),
    });
    let mut list = list_backups(backend, &entry.id);
    list.insert(0, row.clone());
    crate::store::write_json_atomic(&dir.join("index.json"), &Value::Array(list));
    Ok(row)
}

pub fn delete_backup(backend: &Backend, id: &str, backup_id: &str) {
    let dir = backups_dir(backend, id);
    let mut list = list_backups(backend, id);
    list.retain(|row| {
        if row.get("id").and_then(Value::as_str) == Some(backup_id) {
            if let Some(file) = row.get("file").and_then(Value::as_str) {
                let _ = std::fs::remove_file(file);
            }
            false
        } else {
            true
        }
    });
    crate::store::write_json_atomic(&dir.join("index.json"), &Value::Array(list));
}

pub fn restore_backup(backend: &Backend, entry: &ServerEntry, backup_id: &str) -> Result<()> {
    let list = list_backups(backend, &entry.id);
    let row = list
        .iter()
        .find(|row| row.get("id").and_then(Value::as_str) == Some(backup_id))
        .ok_or_else(|| anyhow!("Không tìm thấy bản sao lưu."))?;
    let file = row
        .get("file")
        .and_then(Value::as_str)
        .ok_or_else(|| anyhow!("Bản sao lưu bị thiếu."))?;
    let input = std::fs::File::open(file)?;
    let mut archive = zip::ZipArchive::new(input)?;
    let dir = Path::new(&entry.dir);
    for index in 0..archive.len() {
        let mut item = archive.by_index(index)?;
        let Some(path) = item.enclosed_name() else {
            continue;
        };
        let target = dir.join(path);
        if item.is_dir() {
            std::fs::create_dir_all(&target)?;
        } else if let Some(parent) = target.parent() {
            std::fs::create_dir_all(parent)?;
            let mut out = std::fs::File::create(&target)?;
            std::io::copy(&mut item, &mut out)?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod cron_tests {
    use super::*;
    use chrono::TimeZone;

    #[test]
    fn cron_expressions_match_expected_minutes() {
        let at = chrono::Local.with_ymd_and_hms(2026, 11, 6, 4, 30, 0).unwrap();
        assert!(cron_matches("30 4 * * *", &at));
        assert!(cron_matches("*/5 * * * *", &at));
        assert!(!cron_matches("31 4 * * *", &at));
        assert!(cron_matches("0,30 4 * * *", &at));
        assert!(cron_matches("25-35 4 * * *", &at));
        assert!(!cron_matches("0 0 1 * *", &at));
        assert!(!cron_matches("bad", &at));
    }
}

#[cfg(test)]
mod prune_tests {
    use super::*;
    use std::io::Write;

    #[test]
    fn client_only_mods_are_moved() {
        let root = std::env::temp_dir().join(format!("xyo-prune-{}", uuid::Uuid::new_v4()));
        let mods = root.join("mods");
        std::fs::create_dir_all(&mods).unwrap();
        let make = |name: &str, environment: &str| {
            let file = std::fs::File::create(mods.join(name)).unwrap();
            let mut zip = zip::ZipWriter::new(file);
            let options = zip::write::SimpleFileOptions::default();
            zip.start_file("fabric.mod.json", options).unwrap();
            zip.write_all(format!("{{\"id\":\"test\",\"environment\":\"{environment}\"}}").as_bytes()).unwrap();
            zip.finish().unwrap();
        };
        make("client.jar", "client");
        make("server.jar", "server");
        let entry = ServerEntry {
            dir: root.to_string_lossy().into_owned(),
            ..Default::default()
        };
        let (checked, moved) = prune_client_mods(&entry).unwrap();
        assert_eq!(checked, 2);
        assert_eq!(moved, 1);
        assert!(mods.join("_client-only").join("client.jar").is_file());
        assert!(mods.join("server.jar").is_file());
        let _ = std::fs::remove_dir_all(root);
    }
}
