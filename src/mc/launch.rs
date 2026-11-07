use crate::mc::auth::LaunchAuth;
use crate::mc::install::{
    chain_forge_bootstrap, chain_jar, game_arg_value, library_classpath_entries, rule_allows,
    split_args,
};
use crate::mc::paths::Paths;
use crate::platform::HideConsole;
#[cfg(windows)]
use crate::util::hex;
use crate::util::strip_ansi;
use anyhow::{anyhow, Result};
use serde_json::Value;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::Arc;
use tokio::io::{AsyncBufReadExt, BufReader};

fn has_wide(value: &str) -> bool {
    !value.chars().all(|c| c.is_ascii())
}

fn junction_path(link_dir: &Path, target: &str) -> Option<PathBuf> {
    #[cfg(not(windows))]
    {
        let _ = (link_dir, target);
        None
    }

    #[cfg(windows)]
    {
        use sha1::{Digest, Sha1};
        let mut hasher = Sha1::new();
        hasher.update(target.as_bytes());
        let name = hex(&hasher.finalize())[..12].to_string();
        let link = link_dir.join(name);
        if link.exists() {
            return Some(link);
        }
        let _ = std::fs::create_dir_all(link_dir);
        if std::os::windows::fs::symlink_dir(target, &link).is_ok() {
            return Some(link);
        }
        // The cmd fallback must never see shell metacharacters from the target path.
        if target
            .chars()
            .any(|c| matches!(c, '&' | '|' | '<' | '>' | '^' | '%' | '!' | '"') || c as u32 == 39)
        {
            return None;
        }
        let ok = std::process::Command::new("cmd")
            .args(["/C", "mklink", "/J"])
            .arg(&link)
            .arg(target)
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .hide_console()
            .status()
            .map(|s| s.success())
            .unwrap_or(false);
        ok.then_some(link)
    }
}

pub fn ascii_safe_path(value: &Path, link_dir: Option<&Path>) -> PathBuf {
    let text = value.to_string_lossy().into_owned();
    if !has_wide(&text) {
        return value.to_path_buf();
    }
    if let Some(link_dir) = link_dir {
        if let Some(link) = junction_path(link_dir, &text) {
            return link;
        }
    }
    value.to_path_buf()
}

fn substitute(tokens: Vec<String>, map: &std::collections::HashMap<String, String>) -> Vec<String> {
    static RE: once_cell::sync::Lazy<regex::Regex> =
        once_cell::sync::Lazy::new(|| regex::Regex::new(r"\$\{([^}]+)\}").unwrap());
    tokens
        .into_iter()
        .map(|token| {
            RE.replace_all(&token, |caps: &regex::Captures| {
                map.get(&caps[1]).cloned().unwrap_or_default()
            })
            .to_string()
        })
        .collect()
}

fn flatten_arguments(list: &Value) -> Vec<String> {
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

fn client_extra_jar(chain: &Value, paths: &Paths) -> Option<PathBuf> {
    let mc = game_arg_value(chain, "--fml.mcVersion")?;
    let mcp = game_arg_value(chain, "--fml.mcpVersion")?;
    let file = paths
        .libraries
        .join("net")
        .join("minecraft")
        .join("client")
        .join(format!("{mc}-{mcp}"))
        .join(format!("client-{mc}-{mcp}-extra.jar"));
    file.is_file().then_some(file)
}

pub struct LaunchPlan {
    pub args: Vec<String>,
    pub classpath: String,
    pub uuid: String,
    pub path_fix: Option<(String, String)>,
}

pub struct LaunchOptions<'a> {
    pub chain: &'a Value,
    pub paths: &'a Paths,
    pub natives_dir: &'a Path,
    pub link_dir: Option<&'a Path>,
    pub instance_dir: &'a Path,
    pub username: &'a str,
    pub memory_mb: u32,
    pub extra_jvm: Vec<String>,
    pub auth: Option<&'a LaunchAuth>,
    pub demo: bool,
    pub quick_play: Option<(&'a str, &'a str, Option<u16>)>,
    pub skin: Option<(&'a Path, &'a str, &'a str, &'a str)>,
}

pub fn build_launch(options: LaunchOptions<'_>) -> Result<LaunchPlan> {
    let mut instance_dir = options.instance_dir.to_path_buf();
    let mut natives_dir = options.natives_dir.to_path_buf();
    let mut assets = options.paths.assets.clone();
    let mut libraries = options.paths.libraries.clone();
    let mut versions = options.paths.versions.clone();

    let safe_instance = ascii_safe_path(&instance_dir, options.link_dir);
    let safe_assets = ascii_safe_path(&assets, options.link_dir);
    let safe_natives = ascii_safe_path(&natives_dir, options.link_dir);
    let safe_libraries = ascii_safe_path(&libraries, options.link_dir);
    let safe_versions = ascii_safe_path(&versions, options.link_dir);
    let mut path_fix = None;
    if safe_instance != instance_dir {
        path_fix = Some((instance_dir.to_string_lossy().into_owned(), safe_instance.to_string_lossy().into_owned()));
    } else if safe_natives != natives_dir {
        path_fix = Some((natives_dir.to_string_lossy().into_owned(), safe_natives.to_string_lossy().into_owned()));
    } else if safe_assets != assets {
        path_fix = Some((assets.to_string_lossy().into_owned(), safe_assets.to_string_lossy().into_owned()));
    } else if safe_libraries != libraries {
        path_fix = Some((libraries.to_string_lossy().into_owned(), safe_libraries.to_string_lossy().into_owned()));
    }
    instance_dir = safe_instance;
    natives_dir = safe_natives;
    assets = safe_assets;
    libraries = safe_libraries;
    versions = safe_versions;

    let forge_bootstrap = chain_forge_bootstrap(options.chain);
    let extra_client = if forge_bootstrap {
        client_extra_jar(options.chain, options.paths)
    } else {
        None
    };
    let mut cp_entries = library_classpath_entries(options.chain, options.paths);
    let own_id = options
        .chain
        .get("_id")
        .and_then(Value::as_str)
        .unwrap_or("");
    let jar_id = options
        .chain
        .get("_jarId")
        .and_then(Value::as_str)
        .unwrap_or(own_id);
    let own_jar = options.paths.versions.join(own_id).join(format!("{own_id}.jar"));
    let use_jar = if own_jar.is_file() {
        own_jar
    } else {
        options.paths.versions.join(jar_id).join(format!("{jar_id}.jar"))
    };
    if !forge_bootstrap {
        cp_entries.push(use_jar);
    }
    if let Some(extra) = extra_client {
        cp_entries.push(extra);
    }
    cp_entries.push(natives_dir.clone());
    // Remove library entries pointing at non-existent files (keeps classpath clean).
    let classpath = cp_entries
        .iter()
        .filter(|p| p.is_file() || *p == &natives_dir)
        .map(|p| p.to_string_lossy().into_owned())
        .collect::<Vec<_>>()
        .join(if cfg!(windows) { ";" } else { ":" });

    let auth = options.auth;
    let uuid = auth
        .map(|a| a.uuid.clone())
        .unwrap_or_else(|| crate::store::offline_uuid(options.username));
    let mut map = std::collections::HashMap::new();
    let entries = [
        ("auth_player_name", options.username.to_string()),
        (
            "version_name",
            options.chain.get("id").and_then(Value::as_str).unwrap_or("").to_string(),
        ),
        ("game_directory", instance_dir.to_string_lossy().into_owned()),
        ("assets_root", assets.to_string_lossy().into_owned()),
        ("game_assets", assets.to_string_lossy().into_owned()),
        (
            "assets_index_name",
            options
                .chain
                .pointer("/assetIndex/id")
                .and_then(Value::as_str)
                .or_else(|| options.chain.get("assets").and_then(Value::as_str))
                .unwrap_or("legacy")
                .to_string(),
        ),
        ("auth_uuid", uuid.clone()),
        (
            "auth_access_token",
            auth.map(|a| a.access_token.clone()).unwrap_or_else(|| "0".into()),
        ),
        (
            "auth_session",
            auth.map(|a| format!("token:{}", a.access_token))
                .unwrap_or_else(|| "0".into()),
        ),
        ("clientid", "0".into()),
        (
            "auth_xuid",
            auth.map(|a| a.xuid.clone()).unwrap_or_else(|| "0".into()),
        ),
        (
            "user_type",
            auth.map(|a| a.user_type.clone()).unwrap_or_else(|| "legacy".into()),
        ),
        (
            "version_type",
            options.chain.get("type").and_then(Value::as_str).unwrap_or("release").to_string(),
        ),
        ("user_properties", "{}".into()),
        ("natives_directory", natives_dir.to_string_lossy().into_owned()),
        ("launcher_name", "XyoLauncher".into()),
        ("launcher_version", "2.0.0".into()),
        ("classpath", classpath.clone()),
        (
            "classpath_separator",
            if cfg!(windows) { ";" } else { ":" }.into(),
        ),
        ("library_directory", libraries.to_string_lossy().into_owned()),
        ("resolution_width", "1280".into()),
        ("resolution_height", "720".into()),
        ("quickPlayPath", "".into()),
    ];
    for (key, value) in entries {
        map.insert(key.to_string(), value);
    }

    let jvm_list = options
        .chain
        .pointer("/arguments/jvm")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let mut jvm = if !jvm_list.is_empty() {
        substitute(flatten_arguments(&Value::Array(jvm_list)), &map)
    } else {
        vec![
            format!("-Djava.library.path={}", natives_dir.display()),
            "-Dminecraft.launcher.brand=XyoLauncher".into(),
            "-Dminecraft.launcher.version=2.0.0".into(),
            "-cp".into(),
            classpath.clone(),
        ]
    };
    if forge_bootstrap {
        if let Some(at) = jvm.iter().position(|arg| arg.starts_with("-DignoreList=")) {
            let list = jvm[at].trim_start_matches("-DignoreList=");
            let mut parts: Vec<String> = list.split(',').filter(|p| !p.is_empty()).map(str::to_string).collect();
            let id = options.chain.get("id").and_then(Value::as_str).unwrap_or("");
            if id.to_ascii_lowercase().starts_with("neoforge-") {
                if !parts.iter().any(|p| p == "neoforge-") {
                    parts.push("neoforge-".into());
                }
            } else if id.contains("forge-") && !parts.iter().any(|p| p == "forge-") {
                parts.push("forge-".into());
            }
            jvm[at] = format!("-DignoreList={}", parts.join(","));
        }
    }

    let game_list = options
        .chain
        .pointer("/arguments/game")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let mut game = if !game_list.is_empty() {
        substitute(flatten_arguments(&Value::Array(game_list)), &map)
    } else {
        substitute(
            options
                .chain
                .get("minecraftArguments")
                .and_then(Value::as_str)
                .unwrap_or("")
                .split_whitespace()
                .map(str::to_string)
                .collect(),
            &map,
        )
    };

    if let Some(auth) = auth {
        if let Some(agent) = auth.java_agent.as_ref() {
            jvm.push(agent.clone());
        }
    }
    if let Some((dir, skin_uuid, skin_name, model)) = options.skin {
        jvm.push(format!("-Dlunar.skinDir={}", dir.display()));
        jvm.push(format!("-Dlunar.skinUuid={skin_uuid}"));
        jvm.push(format!("-Dlunar.skinName={skin_name}"));
        jvm.push(format!("-Dlunar.skinModel={model}"));
    }
    if options.demo && !game.iter().any(|arg| arg == "--demo") {
        game.push("--demo".into());
    }
    if let Some((kind, value, port)) = options.quick_play {
        if kind == "world" {
            game.push("--quickPlaySingleplayer".into());
            game.push(value.to_string());
        } else if kind == "server" {
            game.push("--quickPlayMultiplayer".into());
            game.push(format!("{}:{}", value, port.unwrap_or(25565)));
        }
    }

    let mut args = vec![format!("-Xmx{}M", options.memory_mb.max(512))];
    args.extend(options.extra_jvm.into_iter().filter(|v| !v.trim().is_empty()));
    args.push("-Dfile.encoding=UTF-8".into());
    args.push("-Dsun.stdout.encoding=UTF-8".into());
    args.push("-Dsun.stderr.encoding=UTF-8".into());
    args.extend(jvm);
    let main_class = options
        .chain
        .get("mainClass")
        .and_then(Value::as_str)
        .ok_or_else(|| anyhow!("Phiên bản thiếu mainClass"))?;
    args.push(main_class.to_string());
    args.extend(game);
    let _ = versions;
    Ok(LaunchPlan {
        args,
        classpath,
        uuid,
        path_fix,
    })
}

pub type LogFn = Arc<dyn Fn(String) + Send + Sync>;
pub type ExitFn = Arc<dyn Fn(i32) + Send + Sync>;

pub fn spawn_game(
    java_path: &Path,
    args: &[String],
    cwd: &Path,
    on_log: LogFn,
    on_exit: ExitFn,
) -> Result<u32> {
    let mut command = tokio::process::Command::new(java_path);
    command
        .args(args)
        .current_dir(cwd)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .hide_console();
    #[cfg(unix)]
    command.process_group(0);
    let mut child = command.spawn()?;
    let pid = child.id().unwrap_or(0);
    if let Some(stdout) = child.stdout.take() {
        let log = on_log.clone();
        tokio::spawn(async move {
            let mut lines = BufReader::new(stdout).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                let clean = strip_ansi(&line);
                if !clean.trim().is_empty() {
                    log(clean);
                }
            }
        });
    }
    if let Some(stderr) = child.stderr.take() {
        let log = on_log.clone();
        tokio::spawn(async move {
            let mut lines = BufReader::new(stderr).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                let clean = strip_ansi(&line);
                if !clean.trim().is_empty() {
                    log(clean);
                }
            }
        });
    }
    tokio::spawn(async move {
        let code = child.wait().await.map(|s| s.code().unwrap_or(-1)).unwrap_or(-1);
        on_exit(code);
    });
    Ok(pid)
}

pub fn kill_tree(pid: u32) {
    #[cfg(windows)]
    {
        let _ = std::process::Command::new("taskkill")
            .args(["/pid", &pid.to_string(), "/T", "/F"])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .hide_console()
            .status();
    }

    #[cfg(unix)]
    {
        if pid == 0 {
            return;
        }
        unsafe {
            if libc::kill(-(pid as i32), libc::SIGKILL) != 0 {
                libc::kill(pid as i32, libc::SIGKILL);
            }
        }
    }

    #[cfg(not(any(windows, unix)))]
    let _ = pid;
}

pub fn latest_world_folder(instance_dir: &Path) -> Option<String> {
    let saves = instance_dir.join("saves");
    let entries = std::fs::read_dir(saves).ok()?;
    let mut best: Option<(String, std::time::SystemTime)> = None;
    for entry in entries.flatten() {
        if !entry.path().is_dir() {
            continue;
        }
        let Ok(meta) = std::fs::metadata(entry.path().join("level.dat")) else {
            continue;
        };
        let modified = meta.modified().unwrap_or(std::time::UNIX_EPOCH);
        let name = entry.file_name().to_string_lossy().into_owned();
        if best.as_ref().map(|(_, m)| modified > *m).unwrap_or(true) {
            best = Some((name, modified));
        }
    }
    best.map(|(name, _)| name)
}

