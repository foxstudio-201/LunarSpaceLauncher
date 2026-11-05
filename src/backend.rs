use crate::mc::{auth, content, install, java, launch, meta, modpack, paths::Paths, skins, world};
use crate::models::*;
use crate::store::{self, Store};
use crate::util::*;
use anyhow::{anyhow, Result};
use async_channel::{Receiver, Sender};
use parking_lot::Mutex;
use serde_json::{Value, json};
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};

#[derive(Clone, Debug)]
pub struct RunningGame {
    pub pid: u32,
    pub started_at: i64,
    pub stopped: bool,
}

#[derive(Clone)]
pub struct ServerProc {
    pub pid: u32,
    pub stdin: Arc<tokio::sync::Mutex<tokio::process::ChildStdin>>,
    pub started_at: i64,
}

#[derive(Default)]
pub struct HostState {
    pub pid: Option<u32>,
    pub address: String,
    pub listen_port: u16,
    pub target_port: u16,
    pub started_at: i64,
    pub log: Vec<String>,
    pub error: String,
    pub relay: Option<tokio::task::JoinHandle<()>>,
}

pub struct Backend {
    pub store: Arc<Store>,
    pub runtime: tokio::runtime::Runtime,
    pub events: Sender<Value>,
    running: Mutex<HashMap<String, RunningGame>>,
    installing: Mutex<HashSet<String>>,
    stopping: Mutex<HashSet<String>>,
    logs: Mutex<HashMap<String, Vec<String>>>,
    servers: Mutex<HashMap<String, ServerProc>>,
    server_logs: Mutex<HashMap<String, Vec<String>>>,
    host: Mutex<HostState>,
    presence: Mutex<Option<crate::discord::Discord>>,
}

fn ok(mut value: Value) -> Value {
    if let Some(obj) = value.as_object_mut() {
        obj.insert("ok".into(), Value::Bool(true));
    }
    value
}

fn fail(message: impl Into<String>) -> Value {
    json!({"ok": false, "error": message.into()})
}

impl Backend {
    pub fn new(store: Arc<Store>, events: Sender<Value>) -> Arc<Self> {
        if let Some(token) = store
            .settings()
            .extra
            .get("hostToken")
            .and_then(Value::as_str)
            .filter(|token| !token.trim().is_empty())
        {
            store.set_token("host-token", Some(json!({"token": token})));
        }
        store.remove_setting("hostToken");
        let runtime = tokio::runtime::Builder::new_multi_thread()
            .worker_threads(6)
            .enable_all()
            .build()
            .expect("tokio runtime");
        let rpc = store.settings().discord_rpc;
        Arc::new(Self {
            store,
            runtime,
            events,
            running: Mutex::new(HashMap::new()),
            installing: Mutex::new(HashSet::new()),
            stopping: Mutex::new(HashSet::new()),
            logs: Mutex::new(HashMap::new()),
            servers: Mutex::new(HashMap::new()),
            server_logs: Mutex::new(HashMap::new()),
            host: Mutex::new(HostState::default()),
            presence: Mutex::new(if rpc { Some(crate::discord::Discord::start()) } else { None }),
        })
    }

    pub fn emit(&self, value: Value) {
        let _ = self.events.try_send(value);
    }

    pub fn spawn<F>(self: &Arc<Self>, future: F)
    where
        F: std::future::Future<Output = ()> + Send + 'static,
    {
        self.runtime.spawn(future);
    }

    pub fn request<F, T>(self: &Arc<Self>, future: F) -> Receiver<T>
    where
        F: std::future::Future<Output = T> + Send + 'static,
        T: Send + 'static,
    {
        let (tx, rx) = async_channel::bounded(1);
        self.runtime.spawn(async move {
            let result = future.await;
            let _ = tx.send(result).await;
        });
        rx
    }

    pub fn paths(&self) -> Paths {
        Paths::new(self.store.shared_dir())
    }

    pub fn progress_fn(self: &Arc<Self>, id: String, phase: String) -> crate::net::ProgressFn {
        let tx = self.events.clone();
        Arc::new(move |progress: Progress| {
            let _ = tx.try_send(json!({
                "type": "progress",
                "id": id,
                "phase": phase,
                "label": progress.label,
                "done": progress.done,
                "total": progress.total,
                "bytes": progress.bytes,
                "bytesDone": progress.bytes_done,
                "totalBytes": progress.total_bytes,
                "skipped": progress.skipped,
                "file": progress.file,
            }));
        })
    }

    pub fn push_log(&self, id: &str, line: &str) {
        let mut logs = self.logs.lock();
        let buffer = logs.entry(id.to_string()).or_default();
        buffer.push(line.to_string());
        if buffer.len() > 1200 {
            let overflow = buffer.len() - 1200;
            buffer.drain(0..overflow);
        }
    }

    pub fn logs_of(&self, id: &str) -> Vec<String> {
        self.logs.lock().get(id).cloned().unwrap_or_default()
    }

    pub fn running_ids(&self) -> Vec<String> {
        self.running.lock().keys().cloned().collect()
    }

    // ---------- settings ----------
    pub fn settings(&self) -> Value {
        self.store.settings_value()
    }

    pub fn settings_set(self: &Arc<Self>, patch: Value) -> Value {
        let settings = self.store.mutate_settings(patch);
        let mut presence = self.presence.lock();
        if settings.discord_rpc {
            if presence.is_none() {
                *presence = Some(crate::discord::Discord::start());
            }
        } else if let Some(client) = presence.as_ref() {
            client.clear();
        }
        let value = serde_json::to_value(&settings).unwrap_or(Value::Null);
        ok(json!({"settings": value}))
    }

    pub fn discord_update(&self, value: Value) {
        let settings = self.store.settings();
        let presence = self.presence.lock();
        let Some(client) = presence.as_ref() else {
            return;
        };
        if !settings.discord_rpc {
            client.clear();
            return;
        }
        if value.is_null() {
            client.set(crate::discord::PresenceActivity {
                details: "XyoLauncher".into(),
                state: "Đang ở màn hình chính".into(),
                small_image: String::new(),
                small_text: String::new(),
                started: chrono::Utc::now().timestamp(),
            });
            return;
        }
        let name = value.get("name").and_then(Value::as_str).unwrap_or("Minecraft");
        let version = value.get("version").and_then(Value::as_str).unwrap_or("");
        let loader = value.get("loader").and_then(Value::as_str).unwrap_or("vanilla");
        let loader_version = value.get("loaderVersion").and_then(Value::as_str).unwrap_or("");
        let status = value.get("status").and_then(Value::as_str).unwrap_or("ready");
        let loader_name = match loader {
            "fabric" => "Fabric",
            "quilt" => "Quilt",
            "forge" => "Forge",
            "neoforge" => "NeoForge",
            "lunar" => "LunarLoader",
            _ => "Vanilla",
        };
        let loader_line = if loader_version.is_empty() {
            loader_name.to_string()
        } else {
            format!("{loader_name} {loader_version}")
        };
        let state = match status {
            "playing" => format!("Đang chơi Minecraft {version} · {loader_line}"),
            "starting" => format!("Đang khởi động Minecraft {version}…"),
            _ => format!("Sẵn sàng chơi · Minecraft {version}"),
        };
        client.set(crate::discord::PresenceActivity {
            details: name.to_string(),
            state,
            small_image: loader.to_string(),
            small_text: loader_line,
            started: chrono::Utc::now().timestamp(),
        });
    }

    pub fn update_check(self: &Arc<Self>) -> Receiver<Value> {
        self.request(async move {
            let result = crate::net::fetch_json(
                "https://api.github.com/repos/foxstudio-201/LunarSpaceLauncher/releases/latest",
            )
            .await;
            match result {
                Ok(value) => {
                    let latest = value
                        .get("tag_name")
                        .and_then(Value::as_str)
                        .unwrap_or("")
                        .trim_start_matches('v')
                        .to_string();
                    let notes = value
                        .get("body")
                        .and_then(Value::as_str)
                        .unwrap_or("")
                        .chars()
                        .take(4000)
                        .collect::<String>();
                    let url = value
                        .get("html_url")
                        .and_then(Value::as_str)
                        .unwrap_or("")
                        .to_string();
                    let newer = version_cmp(&latest, "2.0.0") > 0;
                    ok(json!({"latest": latest, "current": "2.0.0", "newer": newer, "notes": notes, "url": url}))
                }
                Err(err) => fail(err.to_string()),
            }
        })
    }

    // ---------- system ----------
    pub fn system_info(self: &Arc<Self>) -> Receiver<Value> {
        let shared = self.paths().shared.clone();
        self.request(async move {
            let _ = tokio::fs::create_dir_all(&shared).await;
            let mut sys = sysinfo::System::new_all();
            sys.refresh_all();
            let cpu_model = sys
                .cpus()
                .first()
                .map(|cpu| cpu.brand().to_string())
                .unwrap_or_default();
            let disks = sysinfo::Disks::new_with_refreshed_list();
            let disk = disks
                .iter()
                .find(|disk| {
                    let mount = disk.mount_point().to_string_lossy().to_lowercase();
                    shared.to_string_lossy().to_lowercase().starts_with(&mount)
                })
                .or_else(|| disks.first());
            let cache_bytes = dir_size(&shared).await;
            ok(json!({
                "platform": "win32",
                "arch": std::env::consts::ARCH,
                "cpuModel": cpu_model,
                "cpuThreads": sys.cpus().len(),
                "totalMem": sys.total_memory(),
                "freeMem": sys.free_memory(),
                "disk": {
                    "total": disk.map(|d| d.total_space()).unwrap_or(0),
                    "free": disk.map(|d| d.available_space()).unwrap_or(0),
                },
                "sharedDir": shared.to_string_lossy(),
                "cacheBytes": cache_bytes,
            }))
        })
    }

    pub fn storage(&self) -> Value {
        let paths = self.paths();
        ok(json!({
            "sharedDir": paths.shared.to_string_lossy(),
            "defaultInstanceDir": self.store.default_instance_dir().to_string_lossy(),
            "metaDir": paths.meta.to_string_lossy(),
        }))
    }

    // ---------- versions ----------
    pub fn versions(self: &Arc<Self>, snapshots: bool, force: bool) -> Receiver<Value> {
        let meta_dir = self.paths().meta;
        self.request(async move {
            match meta::list_versions(&meta_dir, snapshots, force).await {
                Ok((versions, latest)) => ok(json!({
                    "versions": versions,
                    "latest": latest,
                    "source": "mojang",
                })),
                Err(err) => fail(err.to_string()),
            }
        })
    }

    pub fn loader_versions(self: &Arc<Self>, kind: String, game: String) -> Receiver<Value> {
        self.request(async move {
            match meta::list_loader_versions(&kind, &game).await {
                Ok(rows) => ok(json!({"versions": rows})),
                Err(err) => fail(err.to_string()),
            }
        })
    }

    pub fn loader_games(self: &Arc<Self>, kind: String) -> Receiver<Value> {
        self.request(async move {
            match meta::list_loader_games(&kind).await {
                Ok(games) => ok(json!({"games": games, "all": games.is_empty()})),
                Err(err) => fail(err.to_string()),
            }
        })
    }

    // ---------- instances ----------
    pub fn instances(&self) -> Value {
        let mut list = self.store.instances();
        let running = self.running.lock().clone();
        for entry in &mut list {
            entry.running = running.contains_key(&entry.id);
            if entry.running {
                entry.status = "running".into();
            }
        }
        ok(json!({
            "instances": list,
            "sharedDir": self.paths().shared.to_string_lossy(),
            "defaultInstanceDir": self.store.default_instance_dir().to_string_lossy(),
        }))
    }

    async fn resolve_version_id(self: &Arc<Self>, version: &str, loader: &str, loader_version: &str) -> Result<Option<String>> {
        let paths = self.paths();
        if loader == "vanilla" || loader.is_empty() {
            return Ok(Some(version.to_string()));
        }
        if loader == "forge" || loader == "neoforge" {
            return Ok(None);
        }
        if loader == "lunar" {
            let id = format!("lunarloader-{version}");
            let file = paths.versions.join(&id).join(format!("{id}.json"));
            return Ok(file.is_file().then_some(id));
        }
        let json = meta::get_loader_profile(
            loader,
            version,
            loader_version,
            &paths.meta,
        )
        .await?;
        Ok(json.get("id").and_then(Value::as_str).map(str::to_string))
    }

    pub fn create_instance(self: &Arc<Self>, opts: Value) -> Receiver<Value> {
        let this = self.clone();
        self.request(async move {
            let name = opts.get("name").and_then(Value::as_str).unwrap_or("").trim().to_string();
            let version = opts.get("version").and_then(Value::as_str).unwrap_or("").to_string();
            if name.is_empty() || version.is_empty() {
                return fail("Thiếu tên hoặc phiên bản.");
            }
            let loader = opts
                .get("loader")
                .and_then(Value::as_str)
                .unwrap_or("vanilla")
                .to_string();
            let loader_version = opts
                .get("loaderVersion")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string();
            if loader != "vanilla" && loader != "lunar" && loader_version.is_empty() {
                return fail("Chưa chọn phiên bản trình tải mod.");
            }
            let memory = opts
                .get("memoryMb")
                .and_then(Value::as_u64)
                .unwrap_or(this.store.settings().default_memory as u64) as u32;
            let dir = opts
                .get("dir")
                .and_then(Value::as_str)
                .filter(|v| !v.trim().is_empty())
                .map(PathBuf::from)
                .unwrap_or_else(|| store::instance_dir_for(&name, &this.store.default_instance_dir()));
            let username = opts
                .get("username")
                .and_then(Value::as_str)
                .unwrap_or("Player")
                .to_string();
            let demo = opts.get("demo").and_then(Value::as_bool).unwrap_or(false);
            let icon = opts.get("icon").and_then(Value::as_str).unwrap_or("").to_string();
            let await_install = opts
                .get("awaitInstall")
                .and_then(Value::as_bool)
                .unwrap_or(false);
            if this.store.find_instance_by_dir(&dir).is_some() {
                return fail("Thư mục này đã có một instance của XyoLauncher.");
            }
            let version_id = match this.resolve_version_id(&version, &loader, &loader_version).await {
                Ok(value) => value,
                Err(err) => return fail(err.to_string()),
            };
            for sub in ["mods", "config", "saves", "resourcepacks", "shaderpacks", "logs"] {
                if let Err(err) = tokio::fs::create_dir_all(dir.join(sub)).await {
                    return fail(format!("Không tạo được thư mục instance: {err}"));
                }
            }
            let entry = Instance {
                id: store::new_instance_id(&loader, &version),
                name: name.clone(),
                version: version.clone(),
                loader: loader.clone(),
                loader_version: (!loader_version.is_empty()).then(|| loader_version.clone()),
                version_id,
                forge_version: if loader == "forge" || loader == "neoforge" {
                    Some(loader_version.clone())
                } else {
                    None
                },
                memory_mb: memory.max(512),
                username,
                demo,
                dir: dir.to_string_lossy().into_owned(),
                icon: (!icon.is_empty()).then_some(icon),
                status: "installing".into(),
                created: Some(now_iso()),
                ..Default::default()
            };
            this.store.add_instance(entry.clone());
            this.store.write_launcher_profiles();
            this.emit(json!({"type": "created", "instance": entry}));
            if await_install {
                this.run_install(&entry.id).await;
                let fresh = this.store.find_instance(&entry.id).unwrap_or(entry);
                return ok(json!({"instance": fresh}));
            }
            let background = this.clone();
            let id = entry.id.clone();
            this.spawn(async move {
                background.run_install(&id).await;
            });
            ok(json!({"instance": entry}))
        })
    }

    pub async fn run_install(self: &Arc<Self>, id: &str) {
        let Some(entry) = self.store.find_instance(id) else {
            return;
        };
        self.installing.lock().insert(id.to_string());
        self.emit(json!({"type": "progress", "id": id, "phase": "start", "label": "start"}));
        let paths = self.paths();
        let progress = self.progress_fn(id.to_string(), "download".into());
        let result: Result<Value> = async {
            let mut version_id = entry.version_id.clone();
            if version_id.is_none() {
                version_id = Some(
                    self.install_forge_or_neoforge(&entry, &paths, progress.clone())
                        .await?,
                );
                self.store
                    .update_instance(id, json!({"versionId": version_id}));
            } else if entry.loader == "lunar" {
                let installed = self.install_lunar(&entry, &paths, progress.clone()).await?;
                version_id = Some(installed);
                self.store
                    .update_instance(id, json!({"versionId": version_id}));
            }
            let Some(version_id) = version_id else {
                return Err(anyhow!("Chưa có phiên bản để cài."));
            };
            let result = install::install(&paths, &version_id, Some(progress), false).await?;
            if let Some(error) = result.errors.first() {
                return Err(anyhow!("{error}"));
            }
            self.store.update_instance(
                id,
                json!({
                    "status": "ready",
                    "error": Value::Null,
                    "javaMajor": result.summary.get("javaMajor"),
                }),
            );
            self.store.write_launcher_profiles();
            Ok(result.summary)
        }
        .await;
        self.installing.lock().remove(id);
        match result {
            Ok(summary) => {
                self.emit(json!({
                    "type": "progress",
                    "id": id,
                    "phase": "done",
                    "summary": summary,
                }));
            }
            Err(err) => {
                self.store
                    .update_instance(id, json!({"status": "error", "error": err.to_string()}));
                self.emit(json!({
                    "type": "progress",
                    "id": id,
                    "phase": "error",
                    "error": err.to_string(),
                }));
            }
        }
    }

    async fn install_lunar(
        self: &Arc<Self>,
        entry: &Instance,
        paths: &Paths,
        progress: crate::net::ProgressFn,
    ) -> Result<String> {
        let mut url = format!(
            "https://lunarspace.site/api-v2/latest?mc={}",
            urlencode(&entry.version)
        );
        if let Some(version) = entry.loader_version.as_deref() {
            url.push_str(&format!("&version={}", urlencode(version)));
        }
        let manifest = crate::net::fetch_json(&url).await?;
        let version_id = manifest
            .pointer("/install/version_id")
            .and_then(Value::as_str)
            .or_else(|| manifest.pointer("/profile/id").and_then(Value::as_str))
            .ok_or_else(|| anyhow!("Manifest LunarLoader thiếu version_id"))?;
        let profile = manifest
            .get("profile")
            .cloned()
            .ok_or_else(|| anyhow!("Bản phát hành thiếu profile cài đặt"))?;
        let libraries = manifest
            .pointer("/install/libraries")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        if libraries.is_empty() {
            return Err(anyhow!("Manifest không có thư viện nào để tải"));
        }
        let mut tasks = Vec::new();
        for lib in &libraries {
            let (Some(url), Some(path)) = (
                lib.get("url").and_then(Value::as_str),
                lib.get("path").and_then(Value::as_str),
            ) else {
                continue;
            };
            tasks.push(crate::net::DownloadTask {
                url: url.to_string(),
                dest: paths.libraries.join(path.replace('/', "\\")),
                sha1: lib.get("sha1").and_then(Value::as_str).map(str::to_string),
                size: lib.get("size").and_then(Value::as_u64).unwrap_or(0),
                skip_hash: lib.get("sha1").is_none(),
                name: lib.get("name").and_then(Value::as_str).unwrap_or("").to_string(),
            });
        }
        let report = crate::net::download_all(tasks, 8, Some(progress), "lunarloader", false).await;
        if let Some((_, error)) = report.errors.first() {
            return Err(anyhow!("Tải LunarLoader thất bại: {error}"));
        }
        let dir = paths.versions.join(version_id);
        tokio::fs::create_dir_all(&dir).await?;
        store::write_json_atomic(&dir.join(format!("{version_id}.json")), &profile);
        Ok(version_id.to_string())
    }

    async fn install_forge_or_neoforge(
        self: &Arc<Self>,
        entry: &Instance,
        paths: &Paths,
        progress: crate::net::ProgressFn,
    ) -> Result<String> {
        let is_neo = entry.loader == "neoforge";
        let label = if is_neo { "NeoForge" } else { "Forge" };
        let loader_version = entry
            .loader_version
            .clone()
            .or_else(|| entry.forge_version.clone())
            .ok_or_else(|| anyhow!("Thiếu phiên bản {label}"))?;
        install::install(paths, &entry.version, Some(progress.clone()), false).await?;
        let full_id = meta::resolve_loader_full_id(
            if is_neo { "neoforge" } else { "forge" },
            &entry.version,
            &loader_version,
        )
        .await;
        let installer_dir = paths.shared.join("forge-installer");
        tokio::fs::create_dir_all(&installer_dir).await?;
        let (installer_url, installer_name) = if is_neo {
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
        let installer = installer_dir.join(&installer_name);
        let sha_url = format!("{installer_url}.sha1");
        let sha = crate::net::fetch_text(&sha_url)
            .await
            .ok()
            .map(|text| text.trim().chars().take(40).collect::<String>())
            .filter(|v| v.len() == 40);
        if !installer.is_file() {
            crate::net::download_one(&installer_url, &installer, sha.as_deref(), std::sync::Arc::new(|_| {})).await?;
        }
        // Detect legacy installation profile.
        let legacy_profile = {
            let file = std::fs::File::open(&installer).ok();
            file.and_then(|file| zip::ZipArchive::new(file).ok().map(|mut zip| {
                zip.by_name("install_profile.json")
                    .ok()
                    .and_then(|mut entry| {
                        let mut text = String::new();
                        std::io::Read::read_to_string(&mut entry, &mut text).ok()?;
                        serde_json::from_str::<Value>(&text).ok()
                    })
            }))
            .flatten()
        };
        if let Some(profile) = legacy_profile.as_ref().filter(|p| p.get("versionInfo").is_some()) {
            self.install_legacy_forge(&installer, profile, &full_id, entry, paths)
                .await?;
            let id = profile
                .pointer("/versionInfo/id")
                .and_then(Value::as_str)
                .ok_or_else(|| anyhow!("Installer Forge cũ thiếu versionInfo"))?;
            return Ok(id.to_string());
        }

        let java = self
            .java_for_version(&entry.version, &entry.id, entry.java_path.clone())
            .await?;
        let before: HashSet<String> = std::fs::read_dir(&paths.versions)
            .map(|entries| {
                entries
                    .flatten()
                    .map(|e| e.file_name().to_string_lossy().into_owned())
                    .collect()
            })
            .unwrap_or_default();
        let log_tx = self.events.clone();
        let id_for_log = entry.id.clone();
        let log_fn = Arc::new(move |line: String| {
            let _ = log_tx.try_send(json!({
                "type": "log",
                "id": id_for_log,
                "line": line,
            }));
        });
        let args = vec![
            "-jar".to_string(),
            installer.to_string_lossy().into_owned(),
            "--installClient".into(),
            paths.shared.to_string_lossy().into_owned(),
        ];
        let mut command = tokio::process::Command::new(&java.path);
        command
            .args(&args)
            .current_dir(&paths.shared)
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .creation_flags(0x08000000);
        let mut child = command.spawn()?;
        let stdout = child.stdout.take();
        let stderr = child.stderr.take();
        if let Some(stream) = stdout {
            let log_fn = log_fn.clone();
            tokio::spawn(async move {
                use tokio::io::AsyncBufReadExt;
                let mut lines = tokio::io::BufReader::new(stream).lines();
                while let Ok(Some(line)) = lines.next_line().await {
                    log_fn(strip_ansi(&line));
                }
            });
        }
        if let Some(stream) = stderr {
            let log_fn = log_fn.clone();
            tokio::spawn(async move {
                use tokio::io::AsyncBufReadExt;
                let mut lines = tokio::io::BufReader::new(stream).lines();
                while let Ok(Some(line)) = lines.next_line().await {
                    log_fn(strip_ansi(&line));
                }
            });
        }
        let status = tokio::time::timeout(std::time::Duration::from_secs(15 * 60), child.wait())
            .await
            .map_err(|_| anyhow!("Installer {label} chạy quá lâu, dừng lại."))??;
        if !status.success() {
            return Err(anyhow!("Installer {label} kết thúc với mã {}", status.code().unwrap_or(-1)));
        }
        let after = std::fs::read_dir(&paths.versions)
            .map(|entries| {
                entries
                    .flatten()
                    .map(|e| e.file_name().to_string_lossy().into_owned())
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();
        let needle = if is_neo { "neoforge" } else { "forge" };
        let created = after
            .iter()
            .filter(|name| !before.contains(*name))
            .find(|name| {
                name.to_lowercase().contains(needle)
                    && (name.contains(&entry.version) || name.to_lowercase().contains(&full_id.to_lowercase()))
            })
            .cloned()
            .or_else(|| {
                after.iter().find(|name| {
                    name.to_lowercase().contains(needle) && name.contains(&entry.version)
                }).cloned()
            })
            .ok_or_else(|| anyhow!("Không tìm thấy phiên bản {label} sau khi cài"))?;
        Ok(created)
    }

    async fn install_legacy_forge(
        self: &Arc<Self>,
        installer: &Path,
        profile: &Value,
        full_id: &str,
        entry: &Instance,
        paths: &Paths,
    ) -> Result<()> {
        let version_info = profile
            .get("versionInfo")
            .cloned()
            .ok_or_else(|| anyhow!("Installer Forge cũ thiếu versionInfo"))?;
        let id = version_info
            .get("id")
            .and_then(Value::as_str)
            .ok_or_else(|| anyhow!("Installer Forge cũ thiếu versionInfo"))?;
        let dir = paths.versions.join(id);
        tokio::fs::create_dir_all(&dir).await?;
        let mut info = version_info.clone();
        if let Some(install) = profile.get("install") {
            if let (Some(path_name), Some(file_path)) = (
                install.get("path").and_then(Value::as_str),
                install.get("filePath").and_then(Value::as_str),
            ) {
                let rel = format!(
                    "net/minecraftforge/forge/{full_id}/forge-{full_id}-universal.jar"
                );
                let dest = paths.libraries.join(rel.replace('/', "\\"));
                if !dest.is_file() {
                    let data = {
                        let file = std::fs::File::open(installer)?;
                        let mut zip = zip::ZipArchive::new(file)?;
                        let mut entry_zip = zip.by_name(file_path)?;
                        let mut data = Vec::new();
                        std::io::Read::read_to_end(&mut entry_zip, &mut data)?;
                        data
                    };
                    if let Some(parent) = dest.parent() {
                        tokio::fs::create_dir_all(parent).await?;
                    }
                    tokio::fs::write(&dest, data).await?;
                }
                if let Some(libs) = info.get_mut("libraries").and_then(Value::as_array_mut) {
                    for lib in libs {
                        if lib.get("name").and_then(Value::as_str) == Some(path_name)
                            && lib.get("downloads").is_none()
                        {
                            lib["downloads"] = json!({
                                "artifact": {
                                    "url": format!("https://maven.minecraftforge.net/{rel}"),
                                    "path": rel
                                }
                            });
                        }
                    }
                }
            }
        }
        if let Some(libs) = info.get_mut("libraries").and_then(Value::as_array_mut) {
            for lib in libs.iter_mut() {
                if lib.get("downloads").is_some() {
                    continue;
                }
                if let Some(name) = lib.get("name").and_then(Value::as_str) {
                    let is_forge = name.starts_with("net.minecraftforge:")
                        || name.starts_with("cpw.mods:");
                    let base = if is_forge {
                        "https://maven.minecraftforge.net/"
                    } else {
                        "https://libraries.minecraft.net/"
                    };
                    if let Some(obj) = lib.as_object_mut() {
                        obj.insert("url".into(), Value::String(base.into()));
                    }
                }
            }
        }
        if info.get("inheritsFrom").is_none() {
            let vanilla_file = paths.versions.join(&entry.version).join(format!("{}.json", entry.version));
            if let Ok(raw) = std::fs::read_to_string(&vanilla_file) {
                if let Ok(vanilla) = serde_json::from_str::<Value>(&raw) {
                    if info.get("assetIndex").is_none() {
                        info["assetIndex"] = vanilla.get("assetIndex").cloned().unwrap_or(Value::Null);
                    }
                    if info.get("assets").is_none() {
                        info["assets"] = vanilla.get("assets").cloned().unwrap_or(Value::Null);
                    }
                }
            }
        }
        store::write_json_atomic(&dir.join(format!("{id}.json")), &info);
        if info.get("inheritsFrom").is_none() {
            let target = dir.join(format!("{id}.jar"));
            if !target.is_file() {
                let vanilla = paths
                    .versions
                    .join(&entry.version)
                    .join(format!("{}.jar", entry.version));
                if vanilla.is_file() {
                    tokio::fs::copy(&vanilla, &target).await?;
                    let _ = strip_signatures(&target);
                }
            }
        }
        let _ = version_info;
        Ok(())
    }

    pub fn update_instance(&self, id: &str, patch: Value) -> Value {
        match self.store.update_instance(id, patch) {
            Some(instance) => {
                self.store.write_launcher_profiles();
                ok(json!({"instance": instance}))
            }
            None => fail("Không tìm thấy instance."),
        }
    }

    pub fn remove_instance(self: &Arc<Self>, id: &str, delete_files: bool) -> Value {
        let Some(entry) = self.store.find_instance(id) else {
            return fail("Không tìm thấy instance.");
        };
        if let Some(game) = self.running.lock().get(id) {
            launch::kill_tree(game.pid);
        }
        self.store.remove_instance(id);
        self.store.write_launcher_profiles();
        if delete_files {
            let dir = PathBuf::from(&entry.dir);
            let trash_dir = self.store.data_dir.join("trash-instances");
            let _ = std::fs::create_dir_all(&trash_dir);
            let target = trash_dir.join(format!(
                "{}-{}",
                safe_name(&entry.name),
                chrono::Utc::now().timestamp()
            ));
            if std::fs::rename(&dir, &target).is_err() {
                let _ = std::fs::remove_dir_all(&dir);
            }
        }
        ok(json!({"removed": true}))
    }

    // ---------- java ----------
    pub fn java_catalog(self: &Arc<Self>) -> Receiver<Value> {
        let paths = self.paths();
        self.request(async move {
            let _ = java::get_index(&paths.meta, false).await;
            let runtimes = java::list_runtimes(&paths).await;
            ok(json!({"runtimes": runtimes, "javaPath": Value::Null}))
        })
    }

    pub fn install_runtime(self: &Arc<Self>, component: String) -> Receiver<Value> {
        let paths = self.paths();
        let progress = self.progress_fn("java".into(), "download".into());
        self.request(async move {
            match java::install_runtime(&paths, &paths.meta, &component, Some(progress)).await {
                Ok(runtime) => ok(json!({
                    "javaPath": runtime.java_path,
                    "name": runtime.name,
                    "major": runtime.major,
                })),
                Err(err) => fail(err.to_string()),
            }
        })
    }

    pub fn remove_runtime(self: &Arc<Self>, component: String, kind: String, dir: String) -> Receiver<Value> {
        let paths = self.paths();
        self.request(async move {
            let result = if kind == "zulu" {
                java::remove_zulu(&paths, &dir).await
            } else {
                java::remove_runtime(&paths, &component).await
            };
            match result {
                Ok(_) => ok(json!({})),
                Err(err) => fail(err.to_string()),
            }
        })
    }

    pub fn install_zulu(self: &Arc<Self>, major: u32, kind: String) -> Receiver<Value> {
        let paths = self.paths();
        let progress = self.progress_fn("java".into(), "download".into());
        self.request(async move {
            match java::install_zulu(&paths, major, &kind, Some(progress)).await {
                Ok((_, info)) => ok(json!({"runtime": info})),
                Err(err) => fail(err.to_string()),
            }
        })
    }

    pub fn java_options(self: &Arc<Self>) -> Receiver<Value> {
        let settings = self.store.settings();
        let paths = self.paths();
        self.request(async move {
            let search = java::find_java(settings.java_path.as_deref(), 8).await;
            let runtimes = java::list_runtimes(&paths).await;
            ok(json!({
                "java": search.java.map(|j| json!({"path": j.path, "major": j.major, "raw": j.raw})),
                "all": search.all.into_iter().map(|j| json!({"path": j.path, "major": j.major, "raw": j.raw})).collect::<Vec<_>>(),
                "runtimes": runtimes,
            }))
        })
    }

    async fn java_for_version(
        self: &Arc<Self>,
        version_id: &str,
        instance_id: &str,
        instance_java: Option<String>,
    ) -> Result<java::JavaInfo> {
        let paths = self.paths();
        let chain = install::resolve_chain(&paths, version_id).await?;
        let required = chain
            .pointer("/javaVersion/majorVersion")
            .and_then(Value::as_u64)
            .unwrap_or(8) as u32;
        let component = chain
            .pointer("/javaVersion/component")
            .and_then(Value::as_str)
            .map(str::to_string);
        if let Some(explicit) = instance_java {
            let found = java::find_java(Some(&explicit), required).await;
            if found.ok {
                if let Some(info) = found.java {
                    return Ok(info);
                }
            }
        }
        if let Some(explicit) = self.store.settings().java_path {
            let found = java::find_java(Some(&explicit), required).await;
            if found.ok {
                if let Some(info) = found.java {
                    return Ok(info);
                }
            }
        }
        if let Some(managed) = java::managed_java(&paths, &paths.meta, component.as_deref(), Some(required)).await {
            return Ok(java::JavaInfo {
                path: managed.java_path,
                major: managed.major,
                raw: format!("Java {}", managed.name),
            });
        }
        let component = match component {
            Some(component) => Some(component),
            None => java::component_for_major(&paths.meta, required).await.ok().flatten(),
        };
        if let Some(component) = component {
            let progress = self.progress_fn(instance_id.to_string(), "download".into());
            if let Ok(runtime) =
                java::install_runtime(&paths, &paths.meta, &component, Some(progress)).await
            {
                return Ok(java::JavaInfo {
                    path: runtime.java_path,
                    major: runtime.major,
                    raw: format!("Java {}", runtime.name),
                });
            }
        }
        let found = java::find_java(None, required).await;
        if found.ok {
            if let Some(info) = found.java {
                return Ok(info);
            }
        }
        Err(anyhow!(found.error))
    }

    // ---------- launch ----------
    pub fn launch(self: &Arc<Self>, opts: Value) -> Receiver<Value> {
        let this = self.clone();
        self.request(async move { this.run_launch(opts).await })
    }

    async fn run_launch(self: &Arc<Self>, opts: Value) -> Value {
        let id = opts.get("id").and_then(Value::as_str).unwrap_or("").to_string();
        let Some(entry) = self.store.find_instance(&id) else {
            return fail("Không tìm thấy instance.");
        };
        if self.running.lock().contains_key(&id) {
            return fail("Instance đang chạy.");
        }
        if self.installing.lock().contains(&id) {
            return fail("Instance đang cài đặt.");
        }
        let paths = self.paths();
        self.store
            .update_instance(&id, json!({"status": "starting", "error": Value::Null}));
        self.logs.lock().insert(id.clone(), Vec::new());
        self.emit(json!({"type": "state", "id": id, "status": "starting"}));
        self.push_log_emit(&id, "[XyoLauncher] Đang chuẩn bị khởi chạy…");

        let mut version_id = match entry.version_id.clone() {
            Some(v) => v,
            None => {
                self.emit(json!({"type": "progress", "id": id, "phase": "start", "label": "start"}));
                match self.install_forge_or_neoforge(&entry, &paths, self.progress_fn(id.clone(), "download".into())).await {
                    Ok(v) => {
                        self.store.update_instance(&id, json!({"versionId": v}));
                        v
                    }
                    Err(err) => {
                        self.store.update_instance(&id, json!({"status": "error", "error": err.to_string()}));
                        return fail(err.to_string());
                    }
                }
            }
        };
        if entry.loader == "lunar" {
            let dir = paths.versions.join(&version_id);
            if !dir.join(format!("{version_id}.json")).is_file() {
                match self.install_lunar(&entry, &paths, self.progress_fn(id.clone(), "download".into())).await {
                    Ok(v) => {
                        version_id = v;
                        self.store.update_instance(&id, json!({"versionId": version_id}));
                    }
                    Err(err) => return fail(err.to_string()),
                }
            }
        }
        let progress = self.progress_fn(id.clone(), "download".into());
        match install::ensure_launch_files(&paths, &version_id, Some(progress)).await {
            Ok(result) => {
                if let Some(error) = result.errors.first() {
                    self.store
                        .update_instance(&id, json!({"status": "error", "error": error}));
                    return fail(format!("Không tải được tệp cần thiết: {error}"));
                }
                self.emit(json!({"type": "progress", "id": id, "phase": "clear"}));
            }
            Err(err) => {
                self.emit(json!({"type": "progress", "id": id, "phase": "clear"}));
                return fail(format!("Chưa cài xong phiên bản: {err}"));
            }
        }
        let chain = match install::resolve_chain(&paths, &version_id).await {
            Ok(chain) => chain,
            Err(err) => return fail(err.to_string()),
        };
        let java = match self.java_for_version(&version_id, &id, entry.java_path.clone()).await {
            Ok(java) => java,
            Err(err) => {
                self.store.update_instance(&id, json!({"status": "error", "error": err.to_string()}));
                return fail(err.to_string());
            }
        };
        let account = self.store.active_account();
        let auth = match auth::auth_for(&self.store, account.as_ref()).await {
            Ok(auth) => auth,
            Err(err) => {
                self.store.update_instance(&id, json!({"status": "error", "error": err.to_string()}));
                return fail(format!("Đăng nhập thất bại: {err}"));
            }
        };
        let username = if auth.name.is_empty() {
            entry.username.clone()
        } else {
            auth.name.clone()
        };
        let mut extra_jvm: Vec<String> = Vec::new();
        if entry.boost {
            extra_jvm.extend(boost_flags(entry.memory_mb));
        }
        if let Some(extra) = entry.jvm_args.as_deref() {
            extra_jvm.extend(extra.split_whitespace().map(str::to_string));
        }
        let skin = account.as_ref().and_then(|a| {
            if a.kind == "offline" && skins::custom_sync(&self.store, &a.uuid) {
                Some((self.store.shared_dir().join("skins"), a.uuid.clone(), a.name.clone(), skins::model_sync(&self.store, &a.uuid)))
            } else {
                None
            }
        });
        let natives_dir = paths
            .natives
            .join(chain.get("_id").and_then(Value::as_str).unwrap_or(&version_id));
        let plan = match launch::build_launch(launch::LaunchOptions {
            chain: &chain,
            paths: &paths,
            natives_dir: &natives_dir,
            link_dir: Some(&self.store.data_dir.join("links")),
            instance_dir: Path::new(&entry.dir),
            username: &username,
            memory_mb: entry.memory_mb.max(512),
            extra_jvm,
            auth: Some(&auth),
            demo: entry.demo,
            quick_play: None,
            skin: skin.as_ref().map(|(dir, uuid, name, model)| (dir.as_path(), uuid.as_str(), name.as_str(), model.as_str())),
        }) {
            Ok(plan) => plan,
            Err(err) => return fail(err.to_string()),
        };
        if let Some((from, to)) = plan.path_fix {
            self.push_log_emit(&id, &format!("[XyoLauncher] Đường dẫn có ký tự đặc biệt — dùng đường dẫn rút gọn: {to}"));
            let _ = from;
        }
        let tx = self.events.clone();
        let log_id = id.clone();
        let log_fn: launch::LogFn = {
            let this = self.clone();
            Arc::new(move |line: String| {
                this.push_log(&log_id, &line);
                let _ = tx.try_send(json!({"type": "log", "id": log_id, "line": line}));
            })
        };
        let started = chrono::Utc::now().timestamp_millis();
        let mut command = tokio::process::Command::new(&java.path);
        command
            .args(&plan.args)
            .current_dir(&entry.dir)
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .creation_flags(0x08000000);
        let mut child = match command.spawn() {
            Ok(child) => child,
            Err(err) => {
                self.store
                    .update_instance(&id, json!({"status": "error", "error": err.to_string()}));
                return fail(format!("Không chạy được Java: {err}"));
            }
        };
        let real_pid = child.id().unwrap_or(0);
        if let Some(stdout) = child.stdout.take() {
            let log = log_fn.clone();
            tokio::spawn(async move {
                use tokio::io::AsyncBufReadExt;
                let mut lines = tokio::io::BufReader::new(stdout).lines();
                while let Ok(Some(line)) = lines.next_line().await {
                    let clean = strip_ansi(&line);
                    if !clean.trim().is_empty() {
                        log(clean);
                    }
                }
            });
        }
        if let Some(stderr) = child.stderr.take() {
            let log = log_fn.clone();
            tokio::spawn(async move {
                use tokio::io::AsyncBufReadExt;
                let mut lines = tokio::io::BufReader::new(stderr).lines();
                while let Ok(Some(line)) = lines.next_line().await {
                    let clean = strip_ansi(&line);
                    if !clean.trim().is_empty() {
                        log(clean);
                    }
                }
            });
        }
        self.running.lock().insert(
            id.clone(),
            RunningGame {
                pid: real_pid,
                started_at: started,
                stopped: false,
            },
        );
        if entry.boost {
            launch::set_high_priority(real_pid);
        }
        self.store
            .update_instance(&id, json!({"status": "running"}));
        self.emit(json!({"type": "state", "id": id, "status": "running", "pid": real_pid}));
        self.store.write_launcher_profiles();
        let this = self.clone();
        let launch_id = id.clone();
        let started_at = started;
        tokio::spawn(async move {
            let code = child.wait().await.map(|s| s.code().unwrap_or(-1)).unwrap_or(-1);
            this.on_game_exit(&launch_id, code, started_at).await;
        });
        ok(json!({"pid": real_pid, "java": java.major, "versionId": version_id}))
    }

    fn push_log_emit(&self, id: &str, line: &str) {
        self.push_log(id, line);
        self.emit(json!({"type": "log", "id": id, "line": line}));
    }

    async fn on_game_exit(self: &Arc<Self>, id: &str, code: i32, started_at: i64) {
        self.running.lock().remove(id);
        let elapsed = chrono::Utc::now().timestamp_millis() - started_at;
        if let Some(entry) = self.store.find_instance(id) {
            self.store.update_instance(
                id,
                json!({
                    "status": "ready",
                    "lastPlayed": now_iso(),
                    "playtimeMs": entry.playtime_ms + elapsed.max(0) as u64,
                }),
            );
        }
        self.push_log_emit(id, &format!("[XyoLauncher] Tiến trình kết thúc (code {code})"));
        self.emit(json!({"type": "exit", "id": id, "code": code}));
        self.store.write_launcher_profiles();
        let stopped = self.stopping.lock().remove(id);
        self.emit(json!({"type": "state", "id": id, "status": "ready"}));
        let _ = stopped;
        if code != 0 {
            let crash = analyze_crash(&self.logs_of(id));
            if crash.get("kind").and_then(Value::as_str) != Some("none") {
                self.emit(json!({"type": "crash", "id": id, "crash": crash}));
            }
        }
    }

    pub fn stop_instance(self: &Arc<Self>, id: String) -> Value {
        let mut running = self.running.lock();
        let Some(game) = running.get_mut(&id) else {
            return fail("Instance không chạy.");
        };
        game.stopped = true;
        let pid = game.pid;
        self.stopping.lock().insert(id.clone());
        self.store.update_instance(&id, json!({"status": "stopping"}));
        self.emit(json!({"type": "state", "id": id, "status": "stopping"}));
        drop(running);
        launch::kill_tree(pid);
        ok(json!({"stopped": true}))
    }

    pub fn instance_logs(&self, id: &str) -> Value {
        ok(json!({"lines": self.logs_of(id)}))
    }

    // ---------- files ----------
    pub fn list_dir(&self, id: &str, rel: &str) -> Value {
        let Some(entry) = self.store.find_instance(id) else {
            return fail("Không tìm thấy instance.");
        };
        let root = PathBuf::from(&entry.dir);
        let target = match store::safe_join(&root, rel) {
            Ok(path) => path,
            Err(err) => return fail(err.to_string()),
        };
        let Ok(entries) = std::fs::read_dir(&target) else {
            return fail("Không đọc được thư mục.");
        };
        let mut rows = Vec::new();
        for item in entries.flatten() {
            let name = item.file_name().to_string_lossy().into_owned();
            if name == "instance.json" || name == ".lunartrash" {
                continue;
            }
            let Ok(meta) = item.metadata() else { continue };
            let disabled = name.ends_with(".disabled");
            rows.push(json!({
                "name": name,
                "rel": if rel.trim_matches('/').is_empty() { name.clone() } else { format!("{}/{}", rel.trim_matches('/'), name) },
                "dir": meta.is_dir(),
                "size": if meta.is_dir() { 0 } else { meta.len() },
                "mtime": meta.modified().ok()
                    .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                    .map(|d| d.as_millis() as i64)
                    .unwrap_or(0),
                "disabled": disabled,
            }));
        }
        rows.sort_by(|a, b| {
            let ad = a.get("dir").and_then(Value::as_bool).unwrap_or(false);
            let bd = b.get("dir").and_then(Value::as_bool).unwrap_or(false);
            bd.cmp(&ad).then_with(|| {
                a.get("name").and_then(Value::as_str).unwrap_or("").to_lowercase()
                    .cmp(&b.get("name").and_then(Value::as_str).unwrap_or("").to_lowercase())
            })
        });
        ok(json!({"entries": rows, "root": entry.dir, "rel": rel}))
    }

    pub fn toggle_file(&self, id: &str, rel: &str, enable: bool) -> Value {
        match self.file_path(id, rel) {
            Ok(full) => {
                let name = full.file_name().map(|v| v.to_string_lossy().into_owned()).unwrap_or_default();
                let marker = if name.ends_with(".disabled") {
                    Some(".disabled")
                } else if name.to_lowercase().ends_with(".zip.txt") {
                    Some(".txt")
                } else {
                    None
                };
                let is_disabled = marker.is_some();
                let want_disabled = !enable;
                if want_disabled == is_disabled {
                    return ok(json!({}));
                }
                let result = if want_disabled {
                    std::fs::rename(&full, full.with_file_name(format!("{name}.disabled")))
                } else {
                    let marker = marker.unwrap_or(".disabled");
                    std::fs::rename(&full, full.with_file_name(&name[..name.len() - marker.len()]))
                };
                match result {
                    Ok(_) => ok(json!({})),
                    Err(err) => fail(err.to_string()),
                }
            }
            Err(err) => fail(err.to_string()),
        }
    }

    fn file_path(&self, id: &str, rel: &str) -> Result<PathBuf> {
        let entry = self.store.find_instance(id).ok_or_else(|| anyhow!("Không tìm thấy instance."))?;
        store::safe_join(Path::new(&entry.dir), rel)
    }

    pub fn trash_files(&self, id: &str, rels: Vec<String>) -> Value {
        let Some(entry) = self.store.find_instance(id) else {
            return fail("Không tìm thấy instance.");
        };
        let root = PathBuf::from(&entry.dir);
        let items_dir = root.join(".lunartrash").join("items");
        if std::fs::create_dir_all(&items_dir).is_err() {
            return fail("Không tạo được thùng rác.");
        }
        let manifest_file = root.join(".lunartrash").join("entries.json");
        let mut manifest: Vec<Value> = std::fs::read_to_string(&manifest_file)
            .ok()
            .and_then(|raw| serde_json::from_str(&raw).ok())
            .unwrap_or_default();
        let mut trashed = 0;
        let mut failed = Vec::new();
        for rel in &rels {
            let Ok(full) = store::safe_join(&root, rel) else {
                failed.push(json!({"rel": rel, "error": "Đường dẫn không hợp lệ"}));
                continue;
            };
            let Ok(meta) = std::fs::metadata(&full) else {
                failed.push(json!({"rel": rel, "error": "Không tìm thấy"}));
                continue;
            };
            let entry_id = format!(
                "{}-{}",
                chrono::Utc::now().timestamp_millis().to_string(),
                &uuid::Uuid::new_v4().to_string()[..6]
            );
            if std::fs::rename(&full, items_dir.join(&entry_id)).is_ok() {
                manifest.insert(
                    0,
                    json!({
                        "id": entry_id,
                        "name": full.file_name().map(|v| v.to_string_lossy().into_owned()).unwrap_or_default(),
                        "rel": rel,
                        "dir": meta.is_dir(),
                        "size": if meta.is_dir() { 0 } else { meta.len() },
                        "deletedAt": chrono::Utc::now().timestamp_millis(),
                    }),
                );
                trashed += 1;
            } else {
                failed.push(json!({"rel": rel, "error": "Không chuyển được vào thùng rác"}));
            }
        }
        store::write_json_atomic(&manifest_file, &Value::Array(manifest));
        ok(json!({"trashed": trashed, "failed": failed}))
    }

    pub fn list_trash(&self, id: &str) -> Value {
        let Some(entry) = self.store.find_instance(id) else {
            return fail("Không tìm thấy instance.");
        };
        let root = PathBuf::from(&entry.dir).join(".lunartrash");
        let manifest: Vec<Value> = std::fs::read_to_string(root.join("entries.json"))
            .ok()
            .and_then(|raw| serde_json::from_str(&raw).ok())
            .unwrap_or_default();
        let items = root.join("items");
        let entries: Vec<Value> = manifest
            .into_iter()
            .filter(|item| {
                item.get("id")
                    .and_then(Value::as_str)
                    .map(|id| items.join(id).exists())
                    .unwrap_or(false)
            })
            .collect();
        ok(json!({"entries": entries}))
    }

    pub fn restore_trash(&self, id: &str, entry_id: &str) -> Value {
        let Some(entry) = self.store.find_instance(id) else {
            return fail("Không tìm thấy instance.");
        };
        let root = PathBuf::from(&entry.dir);
        let trash_root = root.join(".lunartrash");
        let manifest_file = trash_root.join("entries.json");
        let mut manifest: Vec<Value> = std::fs::read_to_string(&manifest_file)
            .ok()
            .and_then(|raw| serde_json::from_str(&raw).ok())
            .unwrap_or_default();
        let Some(item) = manifest
            .iter()
            .find(|item| item.get("id").and_then(Value::as_str) == Some(entry_id))
            .cloned()
        else {
            return fail("Mục này không còn trong thùng rác.");
        };
        let rel = item.get("rel").and_then(Value::as_str).unwrap_or("");
        let name = item.get("name").and_then(Value::as_str).unwrap_or("restored");
        let parent_rel = Path::new(rel)
            .parent()
            .map(|p| p.to_string_lossy().replace('\\', "/"))
            .unwrap_or_default();
        let Ok(parent) = store::safe_join(&root, &parent_rel) else {
            return fail("Đường dẫn không hợp lệ.");
        };
        if std::fs::create_dir_all(&parent).is_err() {
            return fail("Không tạo được thư mục đích.");
        }
        let unique = unique_name(&parent, name);
        if std::fs::rename(trash_root.join("items").join(entry_id), parent.join(&unique)).is_err() {
            return fail("Không khôi phục được.");
        }
        manifest.retain(|row| row.get("id").and_then(Value::as_str) != Some(entry_id));
        store::write_json_atomic(&manifest_file, &Value::Array(manifest));
        let rel = [parent_rel.as_str(), unique.as_str()]
            .iter()
            .filter(|v| !v.is_empty())
            .cloned()
            .collect::<Vec<_>>()
            .join("/");
        ok(json!({"rel": rel}))
    }

    pub fn purge_trash(&self, id: &str, ids: Vec<String>) -> Value {
        let Some(entry) = self.store.find_instance(id) else {
            return fail("Không tìm thấy instance.");
        };
        let trash_root = PathBuf::from(&entry.dir).join(".lunartrash");
        let manifest_file = trash_root.join("entries.json");
        let mut manifest: Vec<Value> = std::fs::read_to_string(&manifest_file)
            .ok()
            .and_then(|raw| serde_json::from_str(&raw).ok())
            .unwrap_or_default();
        let targets: HashSet<String> = if ids.is_empty() {
            manifest
                .iter()
                .filter_map(|item| item.get("id").and_then(Value::as_str).map(str::to_string))
                .collect()
        } else {
            ids.into_iter().collect()
        };
        let mut purged = 0;
        for entry_id in &targets {
            let path = trash_root.join("items").join(entry_id);
            let result = if path.is_dir() {
                std::fs::remove_dir_all(&path)
            } else {
                std::fs::remove_file(&path)
            };
            if result.is_ok() {
                purged += 1;
            }
        }
        manifest.retain(|row| {
            row.get("id")
                .and_then(Value::as_str)
                .map(|id| !targets.contains(id))
                .unwrap_or(true)
        });
        store::write_json_atomic(&manifest_file, &Value::Array(manifest));
        ok(json!({"purged": purged}))
    }

    pub fn create_entry(&self, id: &str, rel: &str, name: &str, dir: bool) -> Value {
        let clean = name.trim();
        if clean.is_empty()
            || clean == "."
            || clean == ".."
            || clean.chars().any(|c| "\\/:*?\"<>|".contains(c))
        {
            return fail("Tên không hợp lệ.");
        }
        let Ok(parent) = self.file_path(id, rel) else {
            return fail("Đường dẫn không hợp lệ.");
        };
        let _ = std::fs::create_dir_all(&parent);
        let target = parent.join(clean);
        let result = if dir {
            std::fs::create_dir(&target)
        } else {
            std::fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&target)
                .map(|_| ())
        };
        match result {
            Ok(_) => ok(json!({"name": clean})),
            Err(err) if err.kind() == std::io::ErrorKind::AlreadyExists => {
                fail("Đã có tệp hoặc thư mục cùng tên.")
            }
            Err(err) => fail(format!("Không tạo được: {err}")),
        }
    }

    pub async fn import_paths(&self, id: &str, rel: &str, paths: Vec<PathBuf>) -> Value {
        let Ok(target) = self.file_path(id, rel) else {
            return fail("Đường dẫn không hợp lệ.");
        };
        let _ = std::fs::create_dir_all(&target);
        let mut imported = 0;
        let mut failed = Vec::new();
        for source in paths {
            if !source.exists() {
                failed.push(json!({"path": source, "error": "Không tìm thấy"}));
                continue;
            }
            let name = source
                .file_name()
                .map(|v| v.to_string_lossy().into_owned())
                .unwrap_or_default();
            let name = unique_name(&target, &name);
            let dest = target.join(&name);
            let result = if source.is_dir() {
                let source = source.clone();
                let dest = dest.clone();
                tokio::task::spawn_blocking(move || copy_dir_sync(&source, &dest))
                    .await
                    .unwrap_or_else(|e| Err(std::io::Error::other(e.to_string())))
            } else {
                std::fs::copy(&source, &dest).map(|_| ())
            };
            match result {
                Ok(_) => imported += 1,
                Err(err) => failed.push(json!({"path": source, "error": err.to_string()})),
            }
        }
        ok(json!({"imported": imported, "failed": failed}))
    }

    pub fn move_entry(&self, id: &str, from: &str, to_rel: &str) -> Value {
        let Ok(src) = self.file_path(id, from) else {
            return fail("Đường dẫn không hợp lệ.");
        };
        let Ok(dest_dir) = self.file_path(id, to_rel) else {
            return fail("Đường dẫn không hợp lệ.");
        };
        if src.parent() == Some(dest_dir.as_path()) {
            return ok(json!({"rel": from}));
        }
        if dest_dir == src || dest_dir.starts_with(&src) {
            return fail("Không thể chuyển thư mục vào chính nó.");
        }
        let _ = std::fs::create_dir_all(&dest_dir);
        let name = src
            .file_name()
            .map(|v| v.to_string_lossy().into_owned())
            .unwrap_or_default();
        let name = unique_name(&dest_dir, &name);
        match std::fs::rename(&src, dest_dir.join(&name)) {
            Ok(_) => {
                let new_rel = [to_rel, name.as_str()]
                    .iter()
                    .filter(|v| !v.is_empty())
                    .cloned()
                    .collect::<Vec<_>>()
                    .join("/");
                ok(json!({"rel": new_rel}))
            }
            Err(err) => fail(format!("Không chuyển được: {err}")),
        }
    }

    pub async fn read_text_file(&self, id: &str, rel: &str) -> Value {
        let Ok(path) = self.file_path(id, rel) else {
            return fail("Đường dẫn không hợp lệ.");
        };
        match tokio::fs::read(&path).await {
            Ok(bytes) => {
                if bytes.len() > 8 * 1024 * 1024 {
                    return fail("Tệp quá lớn để mở.");
                }
                let text = String::from_utf8_lossy(&bytes).to_string();
                ok(json!({"text": text, "size": bytes.len()}))
            }
            Err(err) => fail(format!("Không đọc được tệp: {err}")),
        }
    }

    pub fn import_paths_req(self: &Arc<Self>, id: String, rel: String, paths: Vec<PathBuf>) -> Receiver<Value> {
        let this = self.clone();
        self.request(async move { this.import_paths(&id, &rel, paths).await })
    }

    pub fn read_text_req(self: &Arc<Self>, id: String, rel: String) -> Receiver<Value> {
        let this = self.clone();
        self.request(async move { this.read_text_file(&id, &rel).await })
    }

    pub fn write_text_req(self: &Arc<Self>, id: String, rel: String, text: String) -> Receiver<Value> {
        let this = self.clone();
        self.request(async move { this.write_text_file(&id, &rel, &text).await })
    }

    pub async fn write_text_file(&self, id: &str, rel: &str, text: &str) -> Value {
        let Ok(path) = self.file_path(id, rel) else {
            return fail("Đường dẫn không hợp lệ.");
        };
        match tokio::fs::write(&path, text).await {
            Ok(_) => ok(json!({"bytes": text.len()})),
            Err(err) => fail(format!("Không ghi được tệp: {err}")),
        }
    }

    // ---------- accounts ----------
    pub fn accounts(&self) -> Value {
        let (accounts, active) = self.store.accounts_setup();
        ok(json!({"accounts": accounts, "activeAccountId": active}))
    }

    pub fn account_add_offline(&self, name: &str) -> Value {
        let clean = name.trim();
        if !store::validate_mc_name(clean) {
            return fail("Tên chỉ gồm chữ, số, gạch dưới và dài 3–16 ký tự.");
        }
        let uuid = store::offline_uuid(clean);
        let mut accounts = self.store.accounts();
        if let Some(existing) = accounts.iter().find(|a| a.uuid == uuid) {
            return ok(json!({"accounts": accounts, "activeAccountId": existing.id, "duplicate": true}));
        }
        let entry = Account {
            id: format!("off-{}", &uuid[..8]),
            name: clean.to_string(),
            kind: "offline".into(),
            uuid: uuid.clone(),
            created: Some(now_iso()),
            ..Default::default()
        };
        accounts.push(entry.clone());
        let active = self.store.active_account_id().or(Some(entry.id.clone()));
        self.store.set_accounts(accounts.clone(), active.clone());
        ok(json!({"accounts": accounts, "activeAccountId": active, "added": entry}))
    }

    pub fn account_remove(&self, id: &str) -> Value {
        let accounts: Vec<Account> = self
            .store
            .accounts()
            .into_iter()
            .filter(|a| a.id != id)
            .collect();
        let active = if self.store.active_account_id().as_deref() == Some(id) {
            accounts.first().map(|a| a.id.clone())
        } else {
            self.store.active_account_id()
        };
        self.store.set_accounts(accounts.clone(), active.clone());
        self.store.set_token(id, None);
        ok(json!({"accounts": accounts, "activeAccountId": active}))
    }

    pub fn account_set_active(&self, id: &str) -> Value {
        if !self.store.accounts().iter().any(|a| a.id == id) {
            return fail("Không tìm thấy tài khoản.");
        }
        self.store
            .mutate_settings(json!({"activeAccountId": id}));
        let (accounts, active) = self.store.accounts_setup();
        ok(json!({"accounts": accounts, "activeAccountId": active}))
    }

    fn add_auth_account(&self, session: &AuthSession, kind: &str) -> Value {
        let mut accounts = self.store.accounts();
        let id = accounts
            .iter()
            .find(|a| a.kind == kind && a.uuid == session.uuid)
            .map(|a| a.id.clone())
            .unwrap_or_else(|| format!("{}-{}", kind, &session.uuid[..8.min(session.uuid.len())]));
        let entry = Account {
            id: id.clone(),
            name: session.name.clone(),
            kind: kind.into(),
            uuid: session.uuid.clone(),
            xuid: session.xuid.clone(),
            created: Some(now_iso()),
            ..Default::default()
        };
        let duplicate = accounts.iter().any(|a| a.id == id);
        if let Some(existing) = accounts.iter_mut().find(|a| a.id == id) {
            *existing = entry.clone();
        } else {
            accounts.push(entry.clone());
        }
        let active = self.store.active_account_id().or(Some(id.clone()));
        self.store.set_accounts(accounts.clone(), active.clone());
        self.store
            .set_token(&id, Some(serde_json::to_value(session).unwrap_or(Value::Null)));
        ok(json!({
            "accounts": accounts,
            "activeAccountId": active,
            "added": entry,
            "duplicate": duplicate,
            "session": {"name": session.name, "uuid": session.uuid},
        }))
    }

    pub fn start_ms_login(self: &Arc<Self>) -> Receiver<Value> {
        let this = self.clone();
        self.request(async move {
            match auth::start_device_code().await {
                Ok(device) => {
                    let url = device.verification_uri.clone();
                    let code = device.user_code.clone();
                    let _ = open::that(&url);
                    let tx = this.events.clone();
                    let poll_device = device.clone();
                    this.runtime.spawn(async move {
                        match auth::wait_device_token(&poll_device).await {
                            Ok(ms) => match auth::build_ms_session(&ms).await {
                                Ok(session) => {
                                    let result = {
                                        // Account is added through an event; the UI applies it.
                                        json!({"session": session})
                                    };
                                    let _ = tx.send(json!({"type": "ms_login", "ok": true, "data": result})).await;
                                }
                                Err(err) => {
                                    let _ = tx.send(json!({"type": "ms_login", "ok": false, "error": err.to_string()})).await;
                                }
                            },
                            Err(err) => {
                                let _ = tx.send(json!({"type": "ms_login", "ok": false, "error": err.to_string()})).await;
                            }
                        }
                    });
                    ok(json!({
                        "userCode": code,
                        "verificationUri": url,
                        "expiresIn": device.expires_in,
                    }))
                }
                Err(err) => fail(err.to_string()),
            }
        })
    }

    pub fn complete_ms_login(&self, session: AuthSession) -> Value {
        self.add_auth_account(&session, "microsoft")
    }

    pub fn ely_login(self: &Arc<Self>, username: String, password: String) -> Receiver<Value> {
        let this = self.clone();
        self.request(async move {
            match auth::ely_login(&username, &password).await {
                Ok(login) => {
                    if let Err(err) = auth::ensure_injector(&this.store).await {
                        return fail(err.to_string());
                    }
                    let session = AuthSession {
                        name: login.name,
                        uuid: login.uuid,
                        access_token: login.access_token,
                        user_type: "mojang".into(),
                        expires_at: login.expires_at,
                        client_token: Some(login.client_token),
                        ..Default::default()
                    };
                    this.add_auth_account(&session, "ely")
                }
                Err(err) => fail(err.to_string()),
            }
        })
    }

    pub fn account_refresh(self: &Arc<Self>, id: String) -> Receiver<Value> {
        let accounts = self.store.accounts();
        let account = accounts.into_iter().find(|a| a.id == id);
        let this = self.clone();
        self.request(async move {
            let Some(account) = account else {
                return fail("Không tìm thấy tài khoản.");
            };
            if account.kind == "offline" {
                return ok(json!({"offline": true}));
            }
            match auth::auth_for(&this.store, Some(&account)).await {
                Ok(auth) => ok(json!({"session": {"name": auth.name, "uuid": auth.uuid}})),
                Err(err) => fail(err.to_string()),
            }
        })
    }

    pub fn resolve_skin(self: &Arc<Self>, uuid: String, name: String, provider: String) -> Receiver<Value> {
        let this = self.clone();
        self.request(async move {
            match skins::resolve_remote(&this.store, &uuid, &name, &provider).await {
                Some(path) => ok(json!({"path": path, "data": skins::file_data_url(&path)})),
                None => ok(json!({"path": Value::Null, "data": ""})),
            }
        })
    }

    pub fn skin_read(&self, uuid: &str) -> Value {
        let custom = skins::read_custom(&self.store, uuid);
        ok(json!({
            "uuid": custom.uuid,
            "name": custom.name,
            "model": custom.model,
            "updatedAt": custom.updated_at,
            "skinPath": custom.skin,
            "capePath": custom.cape,
            "skin": custom.skin.as_deref().and_then(skins::file_data_url),
            "cape": custom.cape.as_deref().and_then(skins::file_data_url),
        }))
    }

    pub fn skin_save(self: &Arc<Self>, uuid: String, name: String, model: String, skin_path: Option<String>, cape_path: Option<String>) -> Receiver<Value> {
        let this = self.clone();
        self.request(async move {
            let skin = skin_path
                .as_deref()
                .and_then(|p| std::fs::read(p).ok());
            let cape = cape_path
                .as_deref()
                .and_then(|p| std::fs::read(p).ok());
            match skins::save_custom(&this.store, &uuid, &name, &model, skin, cape) {
                Ok(custom) => {
                    let skin_data = custom.skin.as_deref().and_then(skins::file_data_url);
                    let cape_data = custom.cape.as_deref().and_then(skins::file_data_url);
                    if let Some(skin) = skin_data.clone() {
                        if let Some(cape) = cape_data.clone() {
                            let _ = skins::share(&uuid, &name, &model, Some(skin), Some(cape)).await;
                        } else {
                            let _ = skins::share(&uuid, &name, &model, Some(skin), None).await;
                        }
                    }
                    ok(json!({
                        "uuid": custom.uuid,
                        "name": custom.name,
                        "model": custom.model,
                        "skin": skin_data,
                        "cape": cape_data,
                    }))
                }
                Err(err) => fail(err.to_string()),
            }
        })
    }

    pub fn skin_remove(&self, uuid: &str) -> Value {
        let previous = skins::remove_custom(&self.store, uuid);
        let _ = previous;
        ok(json!({"uuid": uuid}))
    }

    // ---------- content ----------
    pub fn content_search(self: &Arc<Self>, opts: Value) -> Receiver<Value> {
        let kind = opts.get("kind").and_then(Value::as_str).unwrap_or("mods").to_string();
        let source = opts.get("source").and_then(Value::as_str).unwrap_or("modrinth").to_string();
        let query = opts.get("query").and_then(Value::as_str).unwrap_or("").to_string();
        let sort = opts.get("sort").and_then(Value::as_str).unwrap_or("relevance").to_string();
        let offset = opts.get("offset").and_then(Value::as_u64).unwrap_or(0) as u32;
        let limit = opts.get("limit").and_then(Value::as_u64).unwrap_or(20) as u32;
        let game = opts.get("game").and_then(Value::as_str).map(str::to_string);
        let loader = opts.get("loader").and_then(Value::as_str).map(str::to_string);
        let category = opts.get("category").and_then(Value::as_str).map(str::to_string);
        let environment = opts.get("environment").and_then(Value::as_str).map(str::to_string);
        self.request(async move {
            let Ok(kind) = content::Kind::parse(&kind) else {
                return fail("Loại nội dung không hợp lệ.");
            };
            match content::search(
                kind,
                &source,
                &query,
                &sort,
                offset,
                limit,
                game.as_deref(),
                loader.as_deref(),
                category.as_deref(),
                environment.as_deref(),
            )
            .await
            {
                Ok(result) => ok(json!({"total": result.total, "hits": result.hits})),
                Err(err) => fail(err.to_string()),
            }
        })
    }

    pub fn content_versions(self: &Arc<Self>, kind: String, source: String, id: String) -> Receiver<Value> {
        self.request(async move {
            let Ok(kind) = content::Kind::parse(&kind) else {
                return fail("Loại nội dung không hợp lệ.");
            };
            match content::versions(kind, &source, &id).await {
                Ok(list) => ok(json!({"versions": list})),
                Err(err) => fail(err.to_string()),
            }
        })
    }

    pub fn content_project(self: &Arc<Self>, kind: String, source: String, id: String) -> Receiver<Value> {
        self.request(async move {
            let Ok(kind) = content::Kind::parse(&kind) else {
                return fail("Loại nội dung không hợp lệ.");
            };
            match content::project(&source, &id, kind).await {
                Ok(value) => ok(value),
                Err(err) => fail(err.to_string()),
            }
        })
    }

    pub fn content_tags(self: &Arc<Self>, kind: String, source: String) -> Receiver<Value> {
        self.request(async move {
            let Ok(parsed) = content::Kind::parse(&kind) else {
                return fail("Loại nội dung không hợp lệ.");
            };
            if source == "curseforge" {
                match content::cf_json(&format!(
                    "https://api.curse.tools/v1/categories?gameId=432"
                ))
                .await
                {
                    Ok(data) => {
                        let options: Vec<Value> = data
                            .get("data")
                            .and_then(Value::as_array)
                            .map(|rows| {
                                rows.iter()
                                    .filter(|row| {
                                        row.get("classId").and_then(Value::as_u64)
                                            == Some(parsed.cf() as u64)
                                    })
                                    .filter_map(|row| {
                                        Some(json!({
                                            "value": row.get("id")?.to_string(),
                                            "label": row.get("name").and_then(Value::as_str)?,
                                        }))
                                    })
                                    .collect()
                            })
                            .unwrap_or_default();
                        ok(json!({"options": options, "environment": false}))
                    }
                    Err(err) => fail(err.to_string()),
                }
            } else {
                match content::tags_modrinth(parsed).await {
                    Ok(options) => ok(json!({"options": options, "environment": true})),
                    Err(err) => fail(err.to_string()),
                }
            }
        })
    }

    pub fn content_plan(self: &Arc<Self>, opts: Value) -> Receiver<Value> {
        let this = self.clone();
        self.request(async move {
            let kind = opts.get("kind").and_then(Value::as_str).unwrap_or("mods").to_string();
            let source = opts.get("source").and_then(Value::as_str).unwrap_or("modrinth").to_string();
            let id = opts.get("id").and_then(Value::as_str).unwrap_or("").to_string();
            let version_id = opts.get("versionId").and_then(Value::as_str).unwrap_or("").to_string();
            let instance_id = opts.get("instanceId").and_then(Value::as_str).unwrap_or("").to_string();
            let game = opts.get("game").and_then(Value::as_str).map(str::to_string);
            let loader = opts.get("loader").and_then(Value::as_str).map(str::to_string);
            let Some(entry) = this.store.find_instance(&instance_id) else {
                return fail("Không tìm thấy instance.");
            };
            let Ok(kind) = content::Kind::parse(&kind) else {
                return fail("Loại nội dung không hợp lệ.");
            };
            match content::plan(
                kind,
                &source,
                &id,
                &version_id,
                game.as_deref(),
                loader.as_deref(),
                Path::new(&entry.dir),
            )
            .await
            {
                Ok(plan) => ok(json!({
                    "folder": plan.folder,
                    "deps": plan.deps,
                    "missing": plan.missing,
                    "tasks": plan.tasks.iter().map(|t| json!({
                        "name": t.name,
                        "url": t.url,
                        "size": t.size,
                        "rel": t.dest.strip_prefix(&entry.dir).unwrap_or(Path::new("")).to_string_lossy(),
                    })).collect::<Vec<_>>(),
                })),
                Err(err) => fail(err.to_string()),
            }
        })
    }

    pub fn content_install(self: &Arc<Self>, opts: Value) -> Receiver<Value> {
        let this = self.clone();
        self.request(async move {
            let kind = opts.get("kind").and_then(Value::as_str).unwrap_or("mods").to_string();
            let source = opts.get("source").and_then(Value::as_str).unwrap_or("modrinth").to_string();
            let id = opts.get("id").and_then(Value::as_str).unwrap_or("").to_string();
            let version_id = opts.get("versionId").and_then(Value::as_str).unwrap_or("").to_string();
            let instance_id = opts.get("instanceId").and_then(Value::as_str).unwrap_or("").to_string();
            let game = opts.get("game").and_then(Value::as_str).map(str::to_string);
            let loader = opts.get("loader").and_then(Value::as_str).map(str::to_string);
            let Some(entry) = this.store.find_instance(&instance_id) else {
                return fail("Không tìm thấy instance.");
            };
            let Ok(kind) = content::Kind::parse(&kind) else {
                return fail("Loại nội dung không hợp lệ.");
            };
            let plan = match content::plan(
                kind,
                &source,
                &id,
                &version_id,
                game.as_deref(),
                loader.as_deref(),
                Path::new(&entry.dir),
            )
            .await
            {
                Ok(plan) => plan,
                Err(err) => return fail(err.to_string()),
            };
            let progress = this.progress_fn(instance_id.clone(), "download".into());
            let summary = content::install(&plan, Some(progress), |_| {}).await;
            this.emit(json!({"type": "content-installed", "id": instance_id}));
            ok(json!({
                "added": summary.added,
                "existed": summary.existed,
                "failed": summary.failed,
                "total": summary.total,
            }))
        })
    }

    pub fn modpack_versions(self: &Arc<Self>, id: String) -> Receiver<Value> {
        let this = self.clone();
        self.request(async move {
            let Some(entry) = this.store.find_instance(&id) else {
                return fail("Không tìm thấy instance.");
            };
            let dir = PathBuf::from(&entry.dir);
            let Some(marker) = modpack::read_marker(&dir) else {
                return fail("Không tìm thấy thông tin modpack.");
            };
            let source = marker.get("source").and_then(Value::as_str).unwrap_or("").to_string();
            let project_id = marker.get("projectId").and_then(Value::as_str).unwrap_or("").to_string();
            if project_id.is_empty() || !matches!(source.as_str(), "modrinth" | "curseforge") {
                return fail("Modpack này không hỗ trợ cập nhật tự động.");
            }
            match crate::mc::content::versions(crate::mc::content::Kind::Modpacks, &source, &project_id).await {
                Ok(rows) => ok(json!({
                    "versions": rows,
                    "current": marker.get("versionId").cloned().unwrap_or(Value::Null),
                    "source": source,
                })),
                Err(err) => fail(err.to_string()),
            }
        })
    }

    pub fn modpack_repair(self: &Arc<Self>, id: String) -> Receiver<Value> {
        let this = self.clone();
        self.request(async move {
            let Some(entry) = this.store.find_instance(&id) else {
                return fail("Không tìm thấy instance.");
            };
            let dir = PathBuf::from(&entry.dir);
            match modpack::repair(&dir).await {
                Ok((missing, repaired, failed)) => ok(json!({
                    "missing": missing,
                    "repaired": repaired,
                    "failed": failed,
                })),
                Err(err) => fail(err.to_string()),
            }
        })
    }

    pub fn modpack_update(self: &Arc<Self>, id: String, version_id: String) -> Receiver<Value> {
        let this = self.clone();
        self.request(async move {
            let Some(entry) = this.store.find_instance(&id) else {
                return fail("Không tìm thấy instance.");
            };
            let dir = PathBuf::from(&entry.dir);
            let Some(marker) = modpack::read_marker(&dir) else {
                return fail("Không tìm thấy thông tin modpack.");
            };
            let source = marker.get("source").and_then(Value::as_str).unwrap_or("").to_string();
            let project_id = marker.get("projectId").and_then(Value::as_str).unwrap_or("").to_string();
            if project_id.is_empty() || !matches!(source.as_str(), "modrinth" | "curseforge") {
                return fail("Modpack này không hỗ trợ cập nhật tự động.");
            }
            let version_id = if version_id.is_empty() {
                marker.get("versionId").and_then(Value::as_str).unwrap_or("").to_string()
            } else {
                version_id
            };
            let versions = match crate::mc::content::versions(
                crate::mc::content::Kind::Modpacks,
                &source,
                &project_id,
            )
            .await
            {
                Ok(rows) => rows,
                Err(err) => return fail(err.to_string()),
            };
            let target = versions.iter().find(|row| row.id == version_id).cloned();
            let Some(target) = target else {
                return fail("Không tìm thấy phiên bản modpack.");
            };
            let mut plan = match modpack::resolve(
                &this.store,
                &source,
                &project_id,
                &target.id,
                None,
                |_| {},
            )
            .await
            {
                Ok(plan) => plan,
                Err(err) => return fail(err.to_string()),
            };
            if plan.mc != entry.version || plan.loader != entry.loader {
                return fail(format!(
                    "Bản {} dùng Minecraft {}{} — hãy tạo phiên bản mới để nâng cấp.",
                    target.version_number,
                    plan.mc,
                    if plan.loader.is_empty() { String::new() } else { format!(" / {}", plan.loader) }
                ));
            }
            if plan.loader_version != entry.loader_version {
                return fail("Bản cập nhật dùng phiên bản loader khác — hãy cài lại loader trước.");
            }
            plan.project_id = project_id.clone();
            plan.version_id = target.id.clone();
            plan.slug = marker.get("slug").and_then(Value::as_str).unwrap_or("").to_string();
            plan.project_url = marker.get("projectUrl").and_then(Value::as_str).unwrap_or("").to_string();
            let keep: Vec<String> = plan.files.iter().map(|file| file.rel.clone()).collect();
            let removed = modpack::remove_unowned(&dir, &keep).await;
            let applied = match modpack::apply(&plan, &dir, None, |_| {}).await {
                Ok(applied) => applied,
                Err(err) => return fail(err.to_string()),
            };
            modpack::write_marker(&dir, &plan, &applied);
            let _ = this.store.update_instance(
                &id,
                json!({"modpack": {
                    "source": plan.source,
                    "name": plan.name,
                    "version": plan.version,
                    "projectId": plan.project_id,
                    "versionId": plan.version_id,
                }}),
            );
            let _ = this.store.write_launcher_profiles();
            this.emit(json!({"type": "instances-changed"}));
            ok(json!({
                "version": plan.version,
                "name": plan.name,
                "downloaded": applied.downloaded,
                "removed": removed.len(),
                "failed": applied.failed,
            }))
        })
    }

    pub fn mods_inventory(self: &Arc<Self>, id: String) -> Receiver<Value> {
        let this = self.clone();
        self.request(async move {
            let Some(entry) = this.store.find_instance(&id) else {
                return fail("Không tìm thấy instance.");
            };
            let dir = Path::new(&entry.dir).join("mods");
            let _ = tokio::fs::create_dir_all(&dir).await;
            let mut rows: Vec<Value> = Vec::new();
            if let Ok(mut entries) = tokio::fs::read_dir(&dir).await {
                while let Ok(Some(item)) = entries.next_entry().await {
                    let name = item.file_name().to_string_lossy().into_owned();
                    if !name.to_lowercase().ends_with(".jar") && !name.to_lowercase().ends_with(".jar.disabled") {
                        continue;
                    }
                    let meta = item.metadata().await.ok();
                    let size = meta.as_ref().map(|m| m.len()).unwrap_or(0);
                    let modified = meta
                        .as_ref()
                        .and_then(|m| m.modified().ok())
                        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                        .map(|d| d.as_millis() as i64)
                        .unwrap_or(0);
                    rows.push(json!({
                        "name": name,
                        "rel": format!("mods/{name}"),
                        "size": size,
                        "mtime": modified,
                        "disabled": name.ends_with(".disabled"),
                        "title": strip_minecraft_codes(name.trim_end_matches(".disabled").trim_end_matches(".jar")),
                        "icon": Value::Null,
                        "source": Value::Null,
                    }));
                }
            }
            // Identify installed mods by SHA1 through Modrinth for real titles/icons.
            let files: Vec<(usize, PathBuf)> = rows
                .iter()
                .enumerate()
                .filter_map(|(index, row)| {
                    row.get("rel")
                        .and_then(Value::as_str)
                        .map(|rel| (index, dir.join(Path::new(rel).file_name().unwrap_or_default())))
                })
                .collect();
            if !files.is_empty() {
                use futures_util::stream::{self, StreamExt};
                let hashes: Vec<(usize, String)> = stream::iter(files)
                    .map(|(index, path)| async move {
                        (index, crate::util::sha1_file(&path).await.unwrap_or_default())
                    })
                    .buffer_unordered(8)
                    .collect()
                    .await;
                let wanted: Vec<String> = hashes
                    .iter()
                    .map(|(_, hash)| hash.clone())
                    .filter(|hash| !hash.is_empty())
                    .collect();
                if !wanted.is_empty() {
                    let body = json!({"hashes": wanted, "algorithm": "sha1"});
                    if let Ok(res) = crate::net::client()
                        .post("https://api.modrinth.com/v2/version_files")
                        .json(&body)
                        .send()
                        .await
                    {
                        if let Ok(map) = res.json::<Value>().await {
                            if let Some(map) = map.as_object() {
                                let mut project_ids: Vec<String> = Vec::new();
                                for (index, hash) in &hashes {
                                    let Some(info) = map.get(hash) else { continue };
                                    let project_id = info.get("project_id").and_then(Value::as_str).unwrap_or("");
                                    if !project_id.is_empty() && !project_ids.contains(&project_id.to_string()) {
                                        project_ids.push(project_id.to_string());
                                    }
                                    if let Some(row) = rows.get_mut(*index) {
                                        row["projectId"] = Value::String(project_id.to_string());
                                        if let Some(name) = info.get("name").and_then(Value::as_str) {
                                            row["title"] = Value::String(name.to_string());
                                        }
                                        if let Some(version) = info.get("version_number").and_then(Value::as_str) {
                                            row["versionNumber"] = Value::String(version.to_string());
                                        }
                                    }
                                }
                                if !project_ids.is_empty() {
                                    let ids = serde_json::to_string(&project_ids).unwrap_or_else(|_| "[]".into());
                                    let url = format!("https://api.modrinth.com/v2/projects?ids={}", urlencode(&ids));
                                    if let Ok(Ok(projects)) = crate::net::fetch_json(&url).await.map(|v| Ok::<Value, anyhow::Error>(v)) {
                                        if let Some(projects) = projects.as_array() {
                                            for row in rows.iter_mut() {
                                                let Some(project_id) = row.get("projectId").and_then(Value::as_str) else { continue };
                                                if let Some(project) = projects.iter().find(|p| p.get("id").and_then(Value::as_str) == Some(project_id)) {
                                                    if let Some(title) = project.get("title").and_then(Value::as_str) {
                                                        row["title"] = Value::String(title.to_string());
                                                    }
                                                    if let Some(icon) = project.get("icon_url").and_then(Value::as_str) {
                                                        row["icon"] = Value::String(icon.to_string());
                                                    }
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
            rows.sort_by(|a, b| {
                a.get("title").and_then(Value::as_str).unwrap_or("").to_lowercase()
                    .cmp(&b.get("title").and_then(Value::as_str).unwrap_or("").to_lowercase())
            });
            ok(json!({"mods": rows}))
        })
    }

    // ---------- modpacks ----------
    pub fn modpack_install(self: &Arc<Self>, opts: Value) -> Receiver<Value> {
        let this = self.clone();
        self.request(async move {
            let source = opts.get("source").and_then(Value::as_str).unwrap_or("modrinth").to_string();
            let pack_id = opts.get("packId").and_then(Value::as_str).unwrap_or("").to_string();
            let file_id = opts.get("fileId").and_then(Value::as_str).unwrap_or("").to_string();
            let name = opts.get("name").and_then(Value::as_str).unwrap_or("").to_string();
            let slug = opts.get("slug").and_then(Value::as_str).unwrap_or("").to_string();
            let memory = opts.get("memoryMb").and_then(Value::as_u64).unwrap_or(4096) as u32;
            let token = opts.get("token").and_then(Value::as_str).unwrap_or("").to_string();
            if pack_id.is_empty() || file_id.is_empty() {
                return fail("Thiếu gói modpack.");
            }
            let this_emit = this.events.clone();
            let token_emit = token.clone();
            let log = move |message: String| {
                let _ = this_emit.try_send(json!({"type": "modpack", "token": token_emit, "phase": "install", "message": message}));
            };
            let mut plan = match modpack::resolve(
                &this.store,
                &source,
                &pack_id,
                &file_id,
                None,
                log.clone(),
            )
            .await
            {
                Ok(plan) => plan,
                Err(err) => {
                    this.emit(json!({"type": "modpack", "token": token, "phase": "error", "error": err.to_string()}));
                    return fail(err.to_string());
                }
            };
            plan.project_id = pack_id.clone();
            plan.version_id = file_id.clone();
            plan.slug = slug.clone();
            plan.project_url = if source == "modrinth" && !slug.is_empty() {
                format!("https://modrinth.com/modpack/{slug}")
            } else {
                String::new()
            };
            if plan.mc.is_empty() || plan.loader == "vanilla" && plan.files.iter().any(|f| f.rel.starts_with("mods/")) {
                // Some packs omit dependencies; fall back to the instance selection in the UI later.
            }
            let display_name = if name.trim().is_empty() { plan.name.clone() } else { name.trim().to_string() };
            let dir = store::instance_dir_for(&display_name, &this.store.default_instance_dir());
            if this.store.find_instance_by_dir(&dir).is_some() {
                return fail("Thư mục này đã có một instance của XyoLauncher.");
            }
            for sub in ["mods", "config", "saves", "resourcepacks", "shaderpacks", "logs"] {
                tokio::fs::create_dir_all(dir.join(sub)).await.ok();
            }
            let version_id = if plan.loader == "vanilla" {
                Some(plan.mc.clone())
            } else if plan.loader == "forge" || plan.loader == "neoforge" {
                None
            } else {
                let loader_version = plan.loader_version.clone().unwrap_or_default();
                match this.resolve_version_id(&plan.mc, &plan.loader, &loader_version).await {
                    Ok(value) => value,
                    Err(err) => return fail(err.to_string()),
                }
            };
            let entry = Instance {
                id: store::new_instance_id(&plan.loader, &plan.mc),
                name: display_name,
                version: plan.mc.clone(),
                loader: plan.loader.clone(),
                loader_version: plan.loader_version.clone(),
                version_id,
                forge_version: if plan.loader == "forge" || plan.loader == "neoforge" { plan.loader_version.clone() } else { None },
                memory_mb: memory,
                username: "Player".into(),
                dir: dir.to_string_lossy().into_owned(),
                status: "installing".into(),
                created: Some(now_iso()),
                modpack: Some(json!({
                    "source": plan.source,
                    "name": plan.name,
                    "version": plan.version,
                })),
                ..Default::default()
            };
            this.store.add_instance(entry.clone());
            this.store.write_launcher_profiles();
            this.emit(json!({"type": "created", "instance": entry}));
            let this_task = this.clone();
            let entry_task = entry.clone();
            let token_task = token.clone();
            let plan_task = plan.clone();
            this.runtime.spawn(async move {
                let plan = plan_task;
                let emit_progress = {
                    let tx = this_task.events.clone();
                    let token = token_task.clone();
                    Arc::new(move |p: Progress| {
                        let mut value = serde_json::to_value(&p).unwrap_or(Value::Null);
                        if let Some(obj) = value.as_object_mut() {
                            obj.insert("type".into(), Value::String("modpack".into()));
                            obj.insert("token".into(), Value::String(token.clone()));
                            obj.insert("phase".into(), Value::String("download".into()));
                        }
                        let _ = tx.try_send(value);
                    }) as crate::net::ProgressFn
                };
                let applied = modpack::apply(&plan, &dir, Some(emit_progress), |_| {}).await;
                match applied {
                    Ok(applied) => {
                        modpack::write_marker(&dir, &plan, &applied);
                        // install game files in background
                        let id = entry_task.id.clone();
                        this_task.run_install(&id).await;
                        this_task.emit(json!({
                            "type": "modpack",
                            "token": token_task,
                            "phase": "done",
                            "name": plan.name,
                            "total": applied.downloaded,
                            "phaseDetail": "done",
                        }));
                        this_task.emit(json!({"type": "instances-changed"}));
                    }
                    Err(err) => {
                        let id = entry_task.id.clone();
                        this_task.store.update_instance(&id, json!({"status": "error", "error": err.to_string()}));
                        this_task.emit(json!({"type": "modpack", "token": token_task, "phase": "error", "error": err.to_string()}));
                    }
                }
            });
            ok(json!({"instance": entry, "plan": {"name": plan.name, "version": plan.version, "mc": plan.mc, "loader": plan.loader, "files": plan.listed}}))
        })
    }

    pub fn modpack_import_file(self: &Arc<Self>, path: String, name: String, memory: u32, token: String) -> Receiver<Value> {
        let this = self.clone();
        self.request(async move {
            let this_emit = this.events.clone();
            let token_emit = token.clone();
            let log = move |message: String| {
                let _ = this_emit.try_send(json!({"type": "modpack", "token": token_emit, "phase": "install", "message": message}));
            };
            let plan = match modpack::parse_pack_file(Path::new(&path), log).await {
                Ok(plan) => plan,
                Err(err) => return fail(err.to_string()),
            };
            let display_name = if name.trim().is_empty() { plan.name.clone() } else { name.trim().to_string() };
            let dir = store::instance_dir_for(&display_name, &this.store.default_instance_dir());
            if this.store.find_instance_by_dir(&dir).is_some() {
                return fail("Thư mục này đã có một instance của XyoLauncher.");
            }
            for sub in ["mods", "config", "saves", "resourcepacks", "shaderpacks", "logs"] {
                tokio::fs::create_dir_all(dir.join(sub)).await.ok();
            }
            let version_id = if plan.loader == "vanilla" {
                Some(plan.mc.clone())
            } else if plan.loader == "forge" || plan.loader == "neoforge" {
                None
            } else {
                this.resolve_version_id(&plan.mc, &plan.loader, plan.loader_version.as_deref().unwrap_or("")).await.ok().flatten()
            };
            let entry = Instance {
                id: store::new_instance_id(&plan.loader, &plan.mc),
                name: display_name,
                version: plan.mc.clone(),
                loader: plan.loader.clone(),
                loader_version: plan.loader_version.clone(),
                version_id,
                forge_version: if plan.loader == "forge" || plan.loader == "neoforge" { plan.loader_version.clone() } else { None },
                memory_mb: memory.max(1024),
                username: "Player".into(),
                dir: dir.to_string_lossy().into_owned(),
                status: "installing".into(),
                created: Some(now_iso()),
                modpack: Some(json!({"source": plan.source, "name": plan.name, "version": plan.version})),
                ..Default::default()
            };
            this.store.add_instance(entry.clone());
            this.store.write_launcher_profiles();
            this.emit(json!({"type": "created", "instance": entry}));
            let this_task = this.clone();
            let entry_task = entry.clone();
            let token_task = token.clone();
            let plan_task = plan.clone();
            this.runtime.spawn(async move {
                let plan = plan_task;
                let emit_progress = {
                    let tx = this_task.events.clone();
                    let token = token_task.clone();
                    Arc::new(move |p: Progress| {
                        let mut value = serde_json::to_value(&p).unwrap_or(Value::Null);
                        if let Some(obj) = value.as_object_mut() {
                            obj.insert("type".into(), Value::String("modpack".into()));
                            obj.insert("token".into(), Value::String(token.clone()));
                            obj.insert("phase".into(), Value::String("download".into()));
                        }
                        let _ = tx.try_send(value);
                    }) as crate::net::ProgressFn
                };
                match modpack::apply(&plan, &dir, Some(emit_progress), |_| {}).await {
                    Ok(applied) => {
                        modpack::write_marker(&dir, &plan, &applied);
                        let id = entry_task.id.clone();
                        this_task.run_install(&id).await;
                        this_task.emit(json!({"type": "modpack", "token": token_task, "phase": "done", "name": plan.name}));
                        this_task.emit(json!({"type": "instances-changed"}));
                    }
                    Err(err) => {
                        this_task.emit(json!({"type": "modpack", "token": token_task, "phase": "error", "error": err.to_string()}));
                    }
                }
            });
            ok(json!({"instance": entry, "plan": {"name": plan.name, "version": plan.version, "mc": plan.mc, "loader": plan.loader, "files": plan.listed}}))
        })
    }

    // ---------- worlds ----------
    pub fn world_list(&self, id: &str) -> Value {
        let Some(entry) = self.store.find_instance(id) else {
            return fail("Không tìm thấy instance.");
        };
        let dir = Path::new(&entry.dir);
        let mut worlds = world::worlds(&self.store, dir);
        for item in &mut worlds {
            item.size = world::folder_bytes(&dir.join("saves").join(&item.folder), 2 * 1024 * 1024 * 1024);
        }
        ok(json!({"worlds": worlds}))
    }

    pub fn world_tree(&self, id: &str, folder: &str) -> Value {
        let Some(entry) = self.store.find_instance(id) else {
            return fail("Không tìm thấy instance.");
        };
        match world::list_tree(Path::new(&entry.dir), &format!("saves/{folder}")) {
            Ok(items) => ok(json!({"entries": items})),
            Err(err) => fail(err.to_string()),
        }
    }

    pub fn world_read(&self, id: &str, folder: &str, file: &str) -> Value {
        let Some(entry) = self.store.find_instance(id) else {
            return fail("Không tìm thấy instance.");
        };
        match world::read_world_file(Path::new(&entry.dir), folder, file) {
            Ok(root) => ok(json!({"root": root})),
            Err(err) => fail(err.to_string()),
        }
    }

    pub fn world_write(&self, id: &str, folder: &str, file: &str, root: Value) -> Value {
        let Some(entry) = self.store.find_instance(id) else {
            return fail("Không tìm thấy instance.");
        };
        match world::write_world_file(Path::new(&entry.dir), folder, file, &root) {
            Ok(bytes) => ok(json!({"bytes": bytes})),
            Err(err) => fail(err.to_string()),
        }
    }

    pub fn world_map(self: &Arc<Self>, id: String, folder: String) -> Receiver<Value> {
        let this = self.clone();
        self.request(async move {
            let Some(entry) = this.store.find_instance(&id) else {
                return fail("Không tìm thấy instance.");
            };
            let store = this.store.clone();
            let dir = PathBuf::from(&entry.dir);
            let result = tokio::task::spawn_blocking(move || {
                crate::mc::world::render_map(&store, &dir, &folder)
            })
            .await;
            match result {
                Ok(Ok(meta)) => ok(meta),
                Ok(Err(err)) => fail(err.to_string()),
                Err(err) => fail(err.to_string()),
            }
        })
    }

    pub fn world_restore(&self, id: &str, folder: &str, file: &str) -> Value {
        let Some(entry) = self.store.find_instance(id) else {
            return fail("Không tìm thấy instance.");
        };
        match world::restore_world_file(Path::new(&entry.dir), folder, file) {
            Ok(_) => ok(json!({})),
            Err(err) => fail(err.to_string()),
        }
    }


    // ---------- local servers ----------
    pub async fn server_java(self: &Arc<Self>, mc: &str) -> Result<java::JavaInfo> {
        self.java_for_version(mc, "server", None).await
    }

    pub fn servers(&self) -> Value {
        let running = self.servers.lock();
        let mut list = crate::server::load_index(self);
        for entry in &mut list {
            if running.contains_key(&entry.id) {
                entry.status = "online".into();
            } else if entry.status == "online" || entry.status == "starting" || entry.status == "stopping" {
                entry.status = "offline".into();
            }
        }
        ok(json!({"servers": list}))
    }

    pub fn server_create(self: &Arc<Self>, opts: Value) -> Receiver<Value> {
        let this = self.clone();
        self.request(async move {
            let mut name = opts.get("name").and_then(Value::as_str).unwrap_or("").trim().to_string();
            let mut egg = opts.get("egg").and_then(Value::as_str).unwrap_or("vanilla").to_string();
            let mut mc = opts.get("mc").and_then(Value::as_str).unwrap_or("").to_string();
            let mut loader_version = opts
                .get("loaderVersion")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string();
            let mut include: Vec<String> = opts
                .get("include")
                .and_then(Value::as_array)
                .map(|rows| rows.iter().filter_map(|v| v.as_str().map(str::to_string)).collect())
                .unwrap_or_else(|| vec!["mods".into(), "config".into(), "defaultconfigs".into(), "scripts".into()]);
            let instance_id = opts
                .get("instanceId")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string();
            let mut from_instance: Option<Instance> = None;
            if !instance_id.is_empty() {
                if let Some(instance) = this.store.find_instance(&instance_id) {
                    if mc.is_empty() {
                        mc = instance.version.clone();
                    }
                    if opts.get("egg").is_none() {
                        egg = match instance.loader.as_str() {
                            "fabric" => "fabric".into(),
                            "forge" => "forge".into(),
                            "neoforge" => "neoforge".into(),
                            "quilt" => "fabric".into(),
                            _ => "vanilla".into(),
                        };
                    }
                    if loader_version.is_empty() {
                        loader_version = instance.loader_version.clone().unwrap_or_default();
                    }
                    if name.is_empty() {
                        name = format!("{} Server", instance.name);
                    }
                    from_instance = Some(instance);
                }
            }
            if name.is_empty() {
                name = "Minecraft Server".into();
            }
            if mc.is_empty() {
                return fail("Chưa chọn phiên bản Minecraft.");
            }
            let ram = opts.get("ramMb").and_then(Value::as_u64).unwrap_or(4096) as u32;
            let port = opts.get("port").and_then(Value::as_u64).unwrap_or(0) as u16;
            let id = crate::server::new_id();
            let root = crate::server::root(this.as_ref());
            let dir = root.join(&id);
            if let Err(err) = tokio::fs::create_dir_all(&dir).await {
                return fail(format!("Không tạo được thư mục server: {err}"));
            }
            let port = if port == 0 { crate::server::find_free_port(25565) } else { port };
            let entry = crate::server::ServerEntry {
                id: id.clone(),
                name,
                egg,
                mc,
                loader_version: (!loader_version.is_empty()).then_some(loader_version),
                ram_mb: ram.max(512),
                port,
                dir: dir.to_string_lossy().into_owned(),
                status: "installing".into(),
                created: Some(now_iso()),
                include: include.clone(),
                vars: json!({"online-mode": false, "motd": "XyoLauncher Server"}),
                ..Default::default()
            };
            if let Some(instance) = from_instance {
                for name in &include {
                    if name == "mods" {
                        let src = Path::new(&instance.dir).join("mods");
                        let dst = dir.join("mods");
                        let _ = tokio::fs::create_dir_all(&dst).await;
                        if let Ok(mut entries) = tokio::fs::read_dir(&src).await {
                            while let Ok(Some(item)) = entries.next_entry().await {
                                let file_name = item.file_name();
                                if file_name.to_string_lossy().ends_with(".jar") {
                                    let _ = tokio::fs::copy(item.path(), dst.join(file_name)).await;
                                }
                            }
                        }
                    } else {
                        let src = Path::new(&instance.dir).join(name);
                        let dst = dir.join(name);
                        if src.is_dir() {
                            let src = src.clone();
                            let dst = dst.clone();
                            let _ = tokio::task::spawn_blocking(move || copy_dir_sync(&src, &dst)).await;
                        }
                    }
                }
            }
            let mut list = crate::server::load_index(this.as_ref());
            list.insert(0, entry.clone());
            crate::server::save_index(this.as_ref(), &list);
            let _ = crate::server::write_config(&entry);
            this.emit(json!({"type": "servers-changed"}));
            let this_task = this.clone();
            let entry_task = entry.clone();
            this.runtime.spawn(async move {
                let log_tx = this_task.events.clone();
                let log_id = entry_task.id.clone();
                let log_this = this_task.clone();
                let log: Arc<dyn Fn(String) + Send + Sync> = Arc::new(move |line: String| {
                    let mut logs = log_this.server_logs.lock();
                    let buffer = logs.entry(log_id.clone()).or_default();
                    buffer.push(line.clone());
                    if buffer.len() > 3000 {
                        let overflow = buffer.len() - 3000;
                        buffer.drain(0..overflow);
                    }
                    drop(logs);
                    let _ = log_tx.try_send(json!({"type": "server-log", "serverId": log_id, "message": line}));
                });
                this_task.emit(json!({"type": "server-progress", "serverId": entry_task.id, "phase": "install", "percent": 0, "message": "Đang cài đặt server…"}));
                match crate::server::install(&this_task, &entry_task, log.clone()).await {
                    Ok(major) => {
                        crate::server::update(&this_task, &entry_task.id, json!({"status": "offline", "javaMajor": major}));
                        this_task.emit(json!({"type": "server-progress", "serverId": entry_task.id, "phase": "done", "percent": 100}));
                        log("[XyoLauncher] Cài đặt server hoàn tất.".into());
                    }
                    Err(err) => {
                        crate::server::update(&this_task, &entry_task.id, json!({"status": "error", "error": err.to_string()}));
                        this_task.emit(json!({"type": "server-progress", "serverId": entry_task.id, "phase": "error", "message": err.to_string()}));
                        log(format!("[XyoLauncher] Cài đặt lỗi: {err}"));
                    }
                }
                this_task.emit(json!({"type": "servers-changed"}));
            });
            ok(json!({"server": entry}))
        })
    }

    pub fn server_start(self: &Arc<Self>, id: String) -> Receiver<Value> {
        let this = self.clone();
        self.request(async move {
            if this.servers.lock().contains_key(&id) {
                return fail("Server đang chạy.");
            }
            let Some(entry) = crate::server::find(this.as_ref(), &id) else {
                return fail("Không tìm thấy server.");
            };
            if entry.status == "installing" {
                return fail("Server đang cài đặt.");
            }
            let java = match this.server_java(&entry.mc).await {
                Ok(java) => java,
                Err(err) => return fail(err.to_string()),
            };
            let (cwd, args) = crate::server::launch_command(&entry, &java.path);
            let mut command = tokio::process::Command::new(&java.path);
            command
                .args(&args)
                .current_dir(&cwd)
                .stdin(std::process::Stdio::piped())
                .stdout(std::process::Stdio::piped())
                .stderr(std::process::Stdio::piped())
                .creation_flags(0x08000000);
            let mut child = match command.spawn() {
                Ok(child) => child,
                Err(err) => return fail(format!("Không chạy được server: {err}")),
            };
            let pid = child.id().unwrap_or(0);
            let stdin = child.stdin.take().map(|stdin| Arc::new(tokio::sync::Mutex::new(stdin)));
            let Some(stdin) = stdin else {
                return fail("Không mở được stdin của server.");
            };
            crate::server::update(this.as_ref(), &id, json!({"status": "starting", "lastStarted": now_iso(), "error": Value::Null}));
            this.emit(json!({"type": "servers-changed"}));
            this.emit(json!({"type": "server-state", "serverId": id, "status": "starting"}));
            this.servers.lock().insert(
                id.clone(),
                ServerProc {
                    pid,
                    stdin,
                    started_at: chrono::Utc::now().timestamp_millis(),
                },
            );
            let log_fn = {
                let this_log = this.clone();
                let id = id.clone();
                Arc::new(move |line: String| {
                    let mut logs = this_log.server_logs.lock();
                    let buffer = logs.entry(id.clone()).or_default();
                    buffer.push(line.clone());
                    if buffer.len() > 3000 {
                        let overflow = buffer.len() - 3000;
                        buffer.drain(0..overflow);
                    }
                    drop(logs);
                    if line.contains("Done (") || line.contains("Done in ") {
                        crate::server::update(this_log.as_ref(), &id, json!({"status": "online"}));
                        this_log.emit(json!({"type": "server-state", "serverId": id, "status": "online"}));
                    }
                    if line.contains("Stopping the server") || line.contains("Stopping server") {
                        crate::server::update(this_log.as_ref(), &id, json!({"status": "stopping"}));
                        this_log.emit(json!({"type": "server-state", "serverId": id, "status": "stopping"}));
                    }
                    this_log.emit(json!({"type": "server-log", "serverId": id, "message": line}));
                }) as Arc<dyn Fn(String) + Send + Sync>
            };
            if let Some(stdout) = child.stdout.take() {
                let log = log_fn.clone();
                tokio::spawn(async move {
                    use tokio::io::AsyncBufReadExt;
                    let mut lines = tokio::io::BufReader::new(stdout).lines();
                    while let Ok(Some(line)) = lines.next_line().await {
                        let clean = strip_ansi(&line);
                        if !clean.trim().is_empty() {
                            log(clean);
                        }
                    }
                });
            }
            if let Some(stderr) = child.stderr.take() {
                let log = log_fn.clone();
                tokio::spawn(async move {
                    use tokio::io::AsyncBufReadExt;
                    let mut lines = tokio::io::BufReader::new(stderr).lines();
                    while let Ok(Some(line)) = lines.next_line().await {
                        let clean = strip_ansi(&line);
                        if !clean.trim().is_empty() {
                            log(clean);
                        }
                    }
                });
            }
            let this_exit = this.clone();
            let exit_id = id.clone();
            tokio::spawn(async move {
                let code = child.wait().await.map(|s| s.code().unwrap_or(-1)).unwrap_or(-1);
                this_exit.servers.lock().remove(&exit_id);
                crate::server::update(this_exit.as_ref(), &exit_id, json!({"status": "offline"}));
                this_exit.emit(json!({"type": "server-state", "serverId": exit_id, "status": "offline", "code": code}));
                this_exit.emit(json!({"type": "servers-changed"}));
            });
            ok(json!({"pid": pid}))
        })
    }

    pub fn server_stop(self: &Arc<Self>, id: String, force: bool) -> Value {
        let Some(proc) = self.servers.lock().get(&id).cloned() else {
            return fail("Server không chạy.");
        };
        if !force {
            let stdin = proc.stdin.clone();
            self.runtime.spawn(async move {
                use tokio::io::AsyncWriteExt;
                let mut guard = stdin.lock().await;
                let _ = guard.write_all(b"stop\n").await;
                let _ = guard.flush().await;
            });
            let this = self.clone();
            let id_timer = id.clone();
            self.runtime.spawn(async move {
                tokio::time::sleep(std::time::Duration::from_secs(15)).await;
                if let Some(proc) = this.servers.lock().get(&id_timer).cloned() {
                    launch::kill_tree(proc.pid);
                }
            });
        } else {
            launch::kill_tree(proc.pid);
        }
        crate::server::update(self.as_ref(), &id, json!({"status": "stopping"}));
        self.emit(json!({"type": "server-state", "serverId": id, "status": "stopping"}));
        ok(json!({}))
    }

    pub fn server_command(self: &Arc<Self>, id: String, command: String) -> Value {
        let Some(proc) = self.servers.lock().get(&id).cloned() else {
            return fail("Server không chạy.");
        };
        self.runtime.spawn(async move {
            use tokio::io::AsyncWriteExt;
            let mut guard = proc.stdin.lock().await;
            let _ = guard.write_all(format!("{command}\n").as_bytes()).await;
            let _ = guard.flush().await;
        });
        ok(json!({}))
    }

    pub fn server_logs(&self, id: &str) -> Value {
        let lines = self.server_logs.lock().get(id).cloned().unwrap_or_default();
        ok(json!({"lines": lines}))
    }

    pub fn server_update(&self, id: &str, patch: Value) -> Value {
        match crate::server::update(self, id, patch) {
            Some(entry) => {
                let _ = crate::server::write_config(&entry);
                ok(json!({"server": entry}))
            }
            None => fail("Không tìm thấy server."),
        }
    }

    pub fn server_remove(self: &Arc<Self>, id: &str, delete_files: bool) -> Value {
        if let Some(proc) = self.servers.lock().get(id).cloned() {
            launch::kill_tree(proc.pid);
        }
        let mut list = crate::server::load_index(self);
        let Some(at) = list.iter().position(|entry| entry.id == id) else {
            return fail("Không tìm thấy server.");
        };
        let entry = list.remove(at);
        crate::server::save_index(self, &list);
        if delete_files {
            let dir = PathBuf::from(&entry.dir);
            let target = self.store.data_dir.join("trash-servers").join(&entry.id);
            let _ = std::fs::create_dir_all(self.store.data_dir.join("trash-servers"));
            if std::fs::rename(&dir, &target).is_err() {
                let _ = std::fs::remove_dir_all(&dir);
            }
        }
        self.emit(json!({"type": "servers-changed"}));
        ok(json!({"removed": true}))
    }

    pub fn server_file_list(&self, id: &str, rel: &str) -> Value {
        let Some(entry) = crate::server::find(self, id) else {
            return fail("Không tìm thấy server.");
        };
        let root = PathBuf::from(&entry.dir);
        let Ok(target) = store::safe_join(&root, rel) else {
            return fail("Đường dẫn không hợp lệ.");
        };
        let Ok(items) = std::fs::read_dir(&target) else {
            return fail("Không đọc được thư mục.");
        };
        let mut rows = Vec::new();
        for item in items.flatten() {
            let name = item.file_name().to_string_lossy().into_owned();
            let Ok(meta) = item.metadata() else { continue };
            rows.push(json!({
                "name": name,
                "rel": if rel.trim_matches('/').is_empty() { name.clone() } else { format!("{}/{}", rel.trim_matches('/'), name) },
                "dir": meta.is_dir(),
                "size": if meta.is_dir() { 0 } else { meta.len() },
            }));
        }
        rows.sort_by(|a, b| {
            b.get("dir").and_then(Value::as_bool).unwrap_or(false)
                .cmp(&a.get("dir").and_then(Value::as_bool).unwrap_or(false))
                .then_with(|| a.get("name").and_then(Value::as_str).unwrap_or("").to_lowercase().cmp(&b.get("name").and_then(Value::as_str).unwrap_or("").to_lowercase()))
        });
        ok(json!({"entries": rows}))
    }

    pub fn server_file_read(&self, id: &str, rel: &str) -> Value {
        let Some(entry) = crate::server::find(self, id) else {
            return fail("Không tìm thấy server.");
        };
        let Ok(path) = store::safe_join(Path::new(&entry.dir), rel) else {
            return fail("Đường dẫn không hợp lệ.");
        };
        match std::fs::read_to_string(&path) {
            Ok(text) if text.len() < 4 * 1024 * 1024 => ok(json!({"text": text})),
            Ok(_) => fail("Tệp quá lớn để mở."),
            Err(err) => fail(err.to_string()),
        }
    }

    pub fn server_file_write(&self, id: &str, rel: &str, text: &str) -> Value {
        let Some(entry) = crate::server::find(self, id) else {
            return fail("Không tìm thấy server.");
        };
        let Ok(path) = store::safe_join(Path::new(&entry.dir), rel) else {
            return fail("Đường dẫn không hợp lệ.");
        };
        match std::fs::write(&path, text) {
            Ok(_) => ok(json!({})),
            Err(err) => fail(err.to_string()),
        }
    }

    pub fn server_file_delete(&self, id: &str, rel: &str) -> Value {
        let Some(entry) = crate::server::find(self, id) else {
            return fail("Không tìm thấy server.");
        };
        let Ok(path) = store::safe_join(Path::new(&entry.dir), rel) else {
            return fail("Đường dẫn không hợp lệ.");
        };
        let result = if path.is_dir() {
            std::fs::remove_dir_all(&path)
        } else {
            std::fs::remove_file(&path)
        };
        match result {
            Ok(_) => ok(json!({})),
            Err(err) => fail(err.to_string()),
        }
    }

    pub fn server_backups(&self, id: &str) -> Value {
        ok(json!({"backups": crate::server::list_backups(self, id)}))
    }

    pub fn server_backup_create(self: &Arc<Self>, id: String, name: String) -> Receiver<Value> {
        let this = self.clone();
        self.request(async move {
            let Some(entry) = crate::server::find(this.as_ref(), &id) else {
                return fail("Không tìm thấy server.");
            };
            let result = tokio::task::spawn_blocking(move || crate::server::create_backup(&this, &entry, &name))
                .await
                .unwrap_or_else(|e| Err(anyhow!("{e}")));
            match result {
                Ok(row) => ok(json!({"backup": row})),
                Err(err) => fail(err.to_string()),
            }
        })
    }

    pub fn server_backup_restore(self: &Arc<Self>, id: String, backup_id: String) -> Receiver<Value> {
        let this = self.clone();
        self.request(async move {
            let Some(entry) = crate::server::find(this.as_ref(), &id) else {
                return fail("Không tìm thấy server.");
            };
            let result = tokio::task::spawn_blocking(move || crate::server::restore_backup(&this, &entry, &backup_id))
                .await
                .unwrap_or_else(|e| Err(anyhow!("{e}")));
            match result {
                Ok(_) => ok(json!({})),
                Err(err) => fail(err.to_string()),
            }
        })
    }

    pub fn server_backup_delete(&self, id: &str, backup_id: &str) -> Value {
        crate::server::delete_backup(self, id, backup_id);
        ok(json!({}))
    }

    // ---------- ngrok host ----------
    pub fn host_status(self: &Arc<Self>, instance_id: Option<String>) -> Value {
        let settings = self.store.settings();
        let token = self
            .store
            .token("host-token")
            .and_then(|value| value.get("token").and_then(Value::as_str).map(str::to_string))
            .unwrap_or_default();
        let _ = settings;
        let dir = self.store.data_dir.join("tools");
        let agent = dir.join("ngrok.exe");
        let detected = instance_id
            .as_deref()
            .and_then(|id| self.store.find_instance(id))
            .and_then(|entry| crate::server::detect_port(Path::new(&entry.dir)));
        let host = self.host.lock();
        ok(json!({
            "running": host.pid.is_some(),
            "address": host.address,
            "startedAt": host.started_at,
            "targetPort": host.target_port,
            "listenPort": host.listen_port,
            "log": host.log.iter().rev().take(16).cloned().collect::<Vec<_>>().into_iter().rev().collect::<Vec<_>>(),
            "error": host.error,
            "agentInstalled": agent.is_file(),
            "hasToken": !token.is_empty(),
            "detectedPort": detected,
        }))
    }

    pub fn host_install_agent(self: &Arc<Self>) -> Receiver<Value> {
        let this = self.clone();
        self.request(async move {
            let dir = this.store.data_dir.join("tools");
            let _ = tokio::fs::create_dir_all(&dir).await;
            let zip_path = dir.join("ngrok.zip");
            let url = "https://bin.equinox.io/c/bNyj1mQVY4c/ngrok-v3-stable-windows-amd64.zip";
            if let Err(err) = crate::net::download_one(url, &zip_path, None, Arc::new(|_| {})).await {
                return fail(err.to_string());
            }
            let dir_task = dir.clone();
            match tokio::task::spawn_blocking(move || crate::mc::java::extract_zip(&zip_path, &dir_task)).await {
                Ok(Ok(_)) => ok(json!({"path": dir.join("ngrok.exe")})),
                Ok(Err(err)) => fail(err.to_string()),
                Err(err) => fail(err.to_string()),
            }
        })
    }

    pub fn host_set_token(&self, token: String) -> Value {
        let trimmed = token.trim().to_string();
        if trimmed.is_empty() {
            self.store.set_token("host-token", None);
        } else {
            self.store
                .set_token("host-token", Some(json!({"token": trimmed})));
        }
        self.store.remove_setting("hostToken");
        ok(json!({}))
    }

    pub fn host_start(self: &Arc<Self>, opts: Value) -> Receiver<Value> {
        let this = self.clone();
        self.request(async move {
            let instance_id = opts.get("instanceId").and_then(Value::as_str).unwrap_or("").to_string();
            let Some(instance) = this.store.find_instance(&instance_id) else {
                return fail("Chưa chọn phiên bản.");
            };
            if this.host.lock().pid.is_some() {
                return fail("Đường truyền đang chạy.");
            }
            let agent = this.store.data_dir.join("tools").join("ngrok.exe");
            if !agent.is_file() {
                return fail("Chưa tải agent ngrok.");
            }
            let token = opts
                .get("token")
                .and_then(Value::as_str)
                .map(str::to_string)
                .or_else(|| {
                    this.store
                        .token("host-token")
                        .and_then(|value| value.get("token").and_then(Value::as_str).map(str::to_string))
                })
                .unwrap_or_default();
            if token.trim().is_empty() {
                return fail("Chưa có authtoken của ngrok.");
            }
            let target = opts
                .get("targetPort")
                .and_then(Value::as_u64)
                .map(|v| v as u16)
                .or_else(|| crate::server::detect_port(Path::new(&instance.dir)));
            let Some(target) = target else {
                return fail("Chưa tìm thấy cổng LAN. Mở world ở chế độ LAN trong game trước.");
            };
            let listen = opts
                .get("listenPort")
                .and_then(Value::as_u64)
                .map(|v| v as u16)
                .unwrap_or(25565);
            // relay
            let listener = match tokio::net::TcpListener::bind(("127.0.0.1", listen)).await {
                Ok(listener) => listener,
                Err(err) => return fail(format!("Không mở được cổng {listen}: {err}")),
            };
            let relay = tokio::spawn(async move {
                loop {
                    let Ok((mut socket, _)) = listener.accept().await else { continue };
                    tokio::spawn(async move {
                        if let Ok(mut upstream) = tokio::net::TcpStream::connect(("127.0.0.1", target)).await {
                            let _ = tokio::io::copy_bidirectional(&mut socket, &mut upstream).await;
                        }
                    });
                }
            });
            // config
            let web_port = crate::server::find_free_port(4040);
            let config = this.store.data_dir.join("tools").join("ngrok.yml");
            let _ = std::fs::write(
                &config,
                format!(
                    "version: 3\nagent:\n  authtoken: {}\n  web_addr: 127.0.0.1:{web_port}\n",
                    token.trim()
                ),
            );
            let mut command = tokio::process::Command::new(&agent);
            command
                .args([
                    "--config",
                    config.to_string_lossy().as_ref(),
                    "tcp",
                    &listen.to_string(),
                    "--log",
                    "stdout",
                    "--log-level",
                    "info",
                ])
                .stdout(std::process::Stdio::piped())
                .stderr(std::process::Stdio::piped())
                .creation_flags(0x08000000);
            let mut child = match command.spawn() {
                Ok(child) => child,
                Err(err) => {
                    relay.abort();
                    return fail(format!("Không chạy được ngrok: {err}"));
                }
            };
            let pid = child.id().unwrap_or(0);
            {
                let mut host = this.host.lock();
                host.pid = Some(pid);
                host.address.clear();
                host.listen_port = listen;
                host.target_port = target;
                host.started_at = chrono::Utc::now().timestamp_millis();
                host.log.clear();
                host.error.clear();
                host.relay = Some(relay);
            }
            let log_fn = {
                let this_log = this.clone();
                Arc::new(move |line: String| {
                    let mut host = this_log.host.lock();
                    host.log.push(line);
                    if host.log.len() > 60 {
                        let overflow = host.log.len() - 60;
                        host.log.drain(0..overflow);
                    }
                }) as Arc<dyn Fn(String) + Send + Sync>
            };
            if let Some(stdout) = child.stdout.take() {
                let log = log_fn.clone();
                tokio::spawn(async move {
                    use tokio::io::AsyncBufReadExt;
                    let mut lines = tokio::io::BufReader::new(stdout).lines();
                    while let Ok(Some(line)) = lines.next_line().await {
                        log(line);
                    }
                });
            }
            if let Some(stderr) = child.stderr.take() {
                let log = log_fn.clone();
                tokio::spawn(async move {
                    use tokio::io::AsyncBufReadExt;
                    let mut lines = tokio::io::BufReader::new(stderr).lines();
                    while let Ok(Some(line)) = lines.next_line().await {
                        log(line);
                    }
                });
            }
            let this_exit = this.clone();
            tokio::spawn(async move {
                let _ = child.wait().await;
                let mut host = this_exit.host.lock();
                host.pid = None;
                host.address.clear();
                host.started_at = 0;
                if let Some(relay) = host.relay.take() {
                    relay.abort();
                }
            });
            // poll ngrok web api
            let mut address = String::new();
            for _ in 0..24 {
                tokio::time::sleep(std::time::Duration::from_millis(700)).await;
                if this.host.lock().pid.is_none() {
                    break;
                }
                if let Ok(value) = crate::net::fetch_json(&format!("http://127.0.0.1:{web_port}/api/tunnels")).await {
                    if let Some(url) = value
                        .get("tunnels")
                        .and_then(Value::as_array)
                        .and_then(|rows| rows.first())
                        .and_then(|row| row.get("public_url"))
                        .and_then(Value::as_str)
                    {
                        address = url.trim_start_matches("tcp://").to_string();
                        break;
                    }
                }
            }
            {
                let mut host = this.host.lock();
                host.address = address.clone();
                if address.is_empty() {
                    host.error = "ngrok chưa trả về địa chỉ. Xem log để biết chi tiết.".into();
                }
            }
            ok(json!({"address": address, "targetPort": target, "listenPort": listen}))
        })
    }

    pub fn host_stop(&self) -> Value {
        {
            let mut host = self.host.lock();
            if let Some(pid) = host.pid.take() {
                launch::kill_tree(pid);
            }
            if let Some(relay) = host.relay.take() {
                relay.abort();
            }
            host.address.clear();
            host.started_at = 0;
        }
        ok(json!({}))
    }

    pub fn host_logs(&self) -> Value {
        let host = self.host.lock();
        ok(json!({"log": host.log.clone(), "error": host.error}))
    }

    // ---------- icon cache ----------
    pub fn cache_instance_icon(self: &Arc<Self>, url: String) -> Receiver<Value> {
        let this = self.clone();
        self.request(async move {
            if url.is_empty() {
                return ok(json!({"path": Value::Null}));
            }
            if let Some(path) = content::cache_icon(&this.store, &url) {
                return ok(json!({"path": path}));
            }
            use sha1::{Digest, Sha1};
            let mut hasher = Sha1::new();
            hasher.update(url.as_bytes());
            let hash = hex(&hasher.finalize());
            let ext = url
                .split('?')
                .next()
                .and_then(|u| u.rsplit('.').next())
                .filter(|e| matches!(*e, "png" | "jpg" | "jpeg" | "webp" | "gif"))
                .unwrap_or("png");
            let dir = this.store.icon_cache_dir();
            let _ = tokio::fs::create_dir_all(&dir).await;
            let file = dir.join(format!("{hash}.{ext}"));
            match crate::net::fetch_bytes(&url, 4 * 1024 * 1024).await {
                Ok(bytes) => {
                    let _ = tokio::fs::write(&file, bytes).await;
                    ok(json!({"path": file}))
                }
                Err(err) => fail(err.to_string()),
            }
        })
    }

    pub fn upload_log_req(self: &Arc<Self>, text: String) -> Receiver<Value> {
        self.request(async move {
            match upload_log(&text).await {
                Ok(url) => ok(json!({"url": url})),
                Err(err) => fail(err.to_string()),
            }
        })
    }

    pub fn set_instance_icon(&self, id: &str, path: &str) -> Value {
        let Some(entry) = self.store.find_instance(id) else {
            return fail("Không tìm thấy instance.");
        };
        match std::fs::read(path) {
            Ok(bytes) => {
                if image::load_from_memory(&bytes).is_err() {
                    return fail("Ảnh không hợp lệ.");
                }
                let target = Path::new(&entry.dir).join("icon.png");
                match std::fs::write(&target, bytes) {
                    Ok(_) => {
                        self.store.update_instance(id, json!({"icon": target.to_string_lossy()}));
                        ok(json!({"path": target}))
                    }
                    Err(err) => fail(err.to_string()),
                }
            }
            Err(err) => fail(err.to_string()),
        }
    }
}

fn strip_signatures(path: &Path) -> Result<()> {
    let file = std::fs::File::open(path)?;
    let mut archive = zip::ZipArchive::new(file)?;
    let temp = path.with_extension("unsigned.tmp");
    let out = std::fs::File::create(&temp)?;
    let mut writer = zip::ZipWriter::new(out);
    let options = zip::write::SimpleFileOptions::default();
    for index in 0..archive.len() {
        let mut entry = archive.by_index(index)?;
        let Ok(name) = entry.name() else {
            continue;
        };
        let name = name.into_owned();
        if name.starts_with("META-INF/")
            && (name.ends_with(".SF") || name.ends_with(".DSA") || name.ends_with(".RSA") || name.ends_with(".EC"))
        {
            continue;
        }
        if entry.is_dir() {
            writer.add_directory(&name, options)?;
            continue;
        }
        writer.start_file(&name, options)?;
        std::io::copy(&mut entry, &mut writer)?;
    }
    writer.finish()?;
    drop(archive);
    std::fs::rename(&temp, path)?;
    Ok(())
}

fn copy_dir_sync(source: &Path, target: &Path) -> std::io::Result<()> {
    std::fs::create_dir_all(target)?;
    for entry in std::fs::read_dir(source)? {
        let entry = entry?;
        let src = entry.path();
        let dst = target.join(entry.file_name());
        if entry.file_type()?.is_dir() {
            copy_dir_sync(&src, &dst)?;
        } else {
            let _ = std::fs::copy(&src, &dst);
        }
    }
    Ok(())
}

fn unique_name(parent: &Path, name: &str) -> String {
    let taken: HashSet<String> = std::fs::read_dir(parent)
        .map(|entries| {
            entries
                .flatten()
                .map(|e| e.file_name().to_string_lossy().into_owned())
                .collect()
        })
        .unwrap_or_default();
    if !taken.contains(name) {
        return name.to_string();
    }
    let (base, ext) = match name.rfind('.') {
        Some(at) if at > 0 => (&name[..at], &name[at..]),
        _ => (name, ""),
    };
    for i in 1..500 {
        let candidate = format!("{base} ({i}){ext}");
        if !taken.contains(&candidate) {
            return candidate;
        }
    }
    format!("{base}-{}{ext}", chrono::Utc::now().timestamp())
}

pub fn boost_flags(memory_mb: u32) -> Vec<String> {
    vec![
        format!("-Xms{}M", memory_mb.max(512)),
        "-XX:+UnlockExperimentalVMOptions".into(),
        "-XX:+UseG1GC".into(),
        "-XX:+ParallelRefProcEnabled".into(),
        "-XX:MaxGCPauseMillis=37".into(),
        "-XX:+DisableExplicitGC".into(),
        "-XX:+AlwaysPreTouch".into(),
        "-XX:G1NewSizePercent=20".into(),
        "-XX:G1MaxNewSizePercent=40".into(),
        "-XX:G1HeapRegionSize=32M".into(),
        "-XX:G1ReservePercent=20".into(),
        "-XX:G1HeapWastePercent=5".into(),
        "-XX:G1MixedGCCountTarget=4".into(),
        "-XX:InitiatingHeapOccupancyPercent=15".into(),
        "-XX:G1MixedGCLiveThresholdPercent=90".into(),
        "-XX:G1RSetUpdatingPauseTimePercent=5".into(),
        "-XX:SurvivorRatio=32".into(),
        "-XX:MaxTenuringThreshold=1".into(),
        "-XX:+PerfDisableSharedMem".into(),
    ]
}

pub fn analyze_crash(lines: &[String]) -> Value {
    let text = lines.join("\n");
    let rules: Vec<(&str, &str, &str, &str, bool)> = vec![
        (
            "java",
            "Java không tương thích",
            "Phiên bản này cần Java mới hơn. Vào Hệ thống → Java tải kèm và tải đúng bản Java cho phiên bản game, hoặc xoá \"Ghi đè Java\" nếu đang trỏ sai.",
            "UnsupportedClassVersionError|class file version|requires Java",
            false,
        ),
        (
            "natives",
            "Thiếu thư viện native của game",
            "Thư mục natives của phiên bản này chưa đủ tệp. Bấm Chơi lại — launcher sẽ tự kiểm tra và tải bù, sau đó giải nén lại natives.",
            "Failed to load a library|UnsatisfiedLinkError|Could not initialize class org\\.lwjgl|GLFW error",
            false,
        ),
        (
            "library",
            "Thiếu tệp thư viện của game",
            "Classpath đang thiếu hoặc hỏng một jar. Bấm Chơi lại để launcher tải bù tệp còn thiếu.",
            "NoClassDefFoundError|ClassNotFoundException|Class path entries reference missing files|ZipException|invalid LOC header",
            false,
        ),
        (
            "mod",
            "Mod không tương thích",
            "Loader báo lỗi mod/mixin. Mở tab Mods, tắt bớt mod vừa thêm rồi chạy lại để tìm mod gây lỗi.",
            "Mod resolution failed|Incompatible mod|Duplicate mod|MixinApplyError|mixin apply failed|requires (?:any version of|version)",
            false,
        ),
        (
            "memory",
            "Hết bộ nhớ (RAM)",
            "Tăng RAM trong Cài đặt phiên bản, hoặc giảm mod/tài nguyên. Đừng đặt RAM cao hơn RAM thực của máy.",
            "OutOfMemoryError|Java heap space|Could not reserve enough space",
            false,
        ),
        (
            "graphics",
            "Lỗi đồ hoạ / driver",
            "Cập nhật driver card đồ hoạ, hoặc chạy bằng GPU rời. Máy ảo/Remote Desktop thường không có OpenGL đủ.",
            "Pixel format not accelerated|WGL|OpenGL|GLFW",
            false,
        ),
        (
            "jvm",
            "JVM bị crash",
            "JVM tự crash (thường do driver hoặc native). Xem tệp hs_err_pid*.log trong thư mục instance để biết chi tiết.",
            "A fatal error has been detected by the Java Runtime Environment|SIGSEGV|hs_err_pid",
            false,
        ),
    ];
    for (kind, title, hint, pattern, _) in rules {
        if let Ok(re) = regex::Regex::new(pattern) {
            if let Some(hit) = re.find(&text) {
                let start = text[..hit.start()].rfind('\n').unwrap_or(0);
                let cause = text[start..].lines().next().unwrap_or("").trim().chars().take(300).collect::<String>();
                return json!({
                    "kind": kind,
                    "title": title,
                    "hint": hint,
                    "cause": cause,
                    "crashed": true,
                });
            }
        }
    }
    let crashed = text.contains("Minecraft has crashed!")
        || text.contains("---- Minecraft Crash Report ----")
        || text.contains("A fatal error has been detected");
    json!({
        "kind": if crashed { "unknown" } else { "none" },
        "title": if crashed { "Game gặp lỗi" } else { "" },
        "hint": if crashed { "Gửi log cho XyoLauncher để được hỗ trợ." } else { "" },
        "cause": "",
        "crashed": crashed,
    })
}

pub async fn upload_log(text: &str) -> Result<String> {
    let res = crate::net::client()
        .post("https://api.mclo.gs/1/log")
        .form(&[("content", text)])
        .send()
        .await?;
    let body: Value = res.json().await.unwrap_or(Value::Null);
    body.get("url")
        .and_then(Value::as_str)
        .map(str::to_string)
        .ok_or_else(|| anyhow!("Không tải log lên được."))
}

pub fn version_cmp(a: &str, b: &str) -> i32 {
    let parse = |v: &str| -> Vec<i64> {
        v.split(['.', '-', '+'])
            .map(|part| part.parse::<i64>().unwrap_or(0))
            .collect()
    };
    let av = parse(a);
    let bv = parse(b);
    for i in 0..av.len().max(bv.len()) {
        let x = *av.get(i).unwrap_or(&0);
        let y = *bv.get(i).unwrap_or(&0);
        if x != y {
            return if x > y { 1 } else { -1 };
        }
    }
    0
}

pub fn urlencode(value: &str) -> String {
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

pub struct BackendHandle(pub Arc<Backend>);


#[cfg(test)]
mod security_tests {
    use super::*;

    #[test]
    fn version_compare() {
        assert_eq!(version_cmp("2.0.0", "1.9.9"), 1);
        assert_eq!(version_cmp("1.0.0", "1.0.0"), 0);
        assert_eq!(version_cmp("1.0.0", "2.0.0"), -1);
        assert_eq!(version_cmp("26.3", "26.2"), 1);
    }

    #[test]
    fn crash_rules_detect_oom() {
        let lines = vec!["java.lang.OutOfMemoryError: Java heap space".to_string()];
        let value = analyze_crash(&lines);
        assert_eq!(value["kind"], "memory");
        assert_eq!(value["crashed"], true);
    }

    #[test]
    fn crash_rules_allow_clean_exit() {
        let lines = vec!["[12:00:00] [Client thread/INFO]: Stopping!".to_string()];
        let value = analyze_crash(&lines);
        assert_eq!(value["kind"], "none");
    }
}
