use crate::models::{Account, Instance, Settings};
use crate::util::{now_iso, safe_name, strip_json_nulls};
use anyhow::{anyhow, Result};
use serde_json::{json, Map, Value};
use std::path::{Path, PathBuf};
use std::sync::RwLock;

pub struct Store {
    pub data_dir: PathBuf,
    settings: RwLock<Settings>,
    instances: RwLock<Vec<Instance>>,
    tokens: RwLock<Map<String, Value>>,
}

impl Store {
    pub fn load() -> Self {
        let data_dir = data_dir();
        let _ = std::fs::create_dir_all(&data_dir);
        let settings = std::fs::read_to_string(data_dir.join("settings.json"))
            .ok()
            .and_then(|raw| serde_json::from_str::<Settings>(&raw).ok())
            .unwrap_or_default();
        let mut instances = std::fs::read_to_string(data_dir.join("instances.json"))
            .ok()
            .and_then(|raw| serde_json::from_str::<Vec<Instance>>(&raw).ok())
            .unwrap_or_default();
        for entry in &mut instances {
            if matches!(
                entry.status.as_str(),
                "running" | "starting" | "stopping" | "installing"
            ) {
                entry.status = "ready".into();
            }
            entry.running = false;
        }
        let tokens = std::fs::read_to_string(data_dir.join("tokens.json"))
            .ok()
            .and_then(|raw| serde_json::from_str::<Map<String, Value>>(&raw).ok())
            .unwrap_or_default();
        Self {
            data_dir,
            settings: RwLock::new(settings),
            instances: RwLock::new(instances),
            tokens: RwLock::new(tokens),
        }
    }

    pub fn settings(&self) -> Settings {
        self.settings.read().unwrap().clone()
    }

    pub fn settings_value(&self) -> Value {
        serde_json::to_value(self.settings()).unwrap_or(Value::Null)
    }

    pub fn mutate_settings(&self, patch: Value) -> Settings {
        {
            let mut settings = self.settings.write().unwrap();
            let mut current = serde_json::to_value(&*settings).unwrap_or_else(|_| json!({}));
            merge_object(&mut current, &patch);
            if let Ok(next) = serde_json::from_value::<Settings>(current) {
                *settings = next;
            }
        }
        let next = self.settings.read().unwrap().clone();
        self.persist_settings();
        next
    }

    pub fn set_settings(&self, next: Settings) {
        *self.settings.write().unwrap() = next;
        self.persist_settings();
    }

    pub fn persist_settings(&self) {
        let settings = self.settings.read().unwrap().clone();
        let value = serde_json::to_value(settings).unwrap_or_else(|_| json!({}));
        write_json_atomic(&self.data_dir.join("settings.json"), &value);
    }

    pub fn shared_dir(&self) -> PathBuf {
        let settings = self.settings.read().unwrap();
        if let Some(dir) = settings.shared_dir.as_deref().filter(|d| !d.trim().is_empty()) {
            return PathBuf::from(dir);
        }
        self.data_dir.join("shared")
    }

    pub fn default_instance_dir(&self) -> PathBuf {
        let docs = dirs::document_dir().unwrap_or_else(|| self.data_dir.clone());
        let legacy = docs.join("LunarSpace").join("instances");
        if legacy.exists() {
            return legacy;
        }
        docs.join("XyoLauncher").join("instances")
    }

    pub fn instances(&self) -> Vec<Instance> {
        self.instances.read().unwrap().clone()
    }

    pub fn find_instance(&self, id: &str) -> Option<Instance> {
        self.instances
            .read()
            .unwrap()
            .iter()
            .find(|entry| entry.id == id)
            .cloned()
    }

    pub fn find_instance_by_dir(&self, dir: &Path) -> Option<Instance> {
        let target = comparable_path(dir);
        self.instances
            .read()
            .unwrap()
            .iter()
            .find(|entry| comparable_path(Path::new(&entry.dir)) == target)
            .cloned()
    }

    pub fn add_instance(&self, instance: Instance) {
        {
            let mut list = self.instances.write().unwrap();
            list.retain(|entry| entry.id != instance.id);
            list.insert(0, instance.clone());
        }
        self.persist_instances();
        self.write_instance_file(&instance);
    }

    pub fn update_instance(&self, id: &str, patch: Value) -> Option<Instance> {
        let updated = {
            let mut list = self.instances.write().unwrap();
            let at = list.iter().position(|entry| entry.id == id)?;
            let mut value = serde_json::to_value(&list[at]).ok()?;
            merge_object(&mut value, &patch);
            let next: Instance = serde_json::from_value(value).ok()?;
            list[at] = next.clone();
            next
        };
        self.persist_instances();
        self.write_instance_file(&updated);
        Some(updated)
    }

    pub fn remove_instance(&self, id: &str) -> Option<Instance> {
        let removed = {
            let mut list = self.instances.write().unwrap();
            let at = list.iter().position(|entry| entry.id == id)?;
            list.remove(at)
        };
        self.persist_instances();
        Some(removed)
    }

    pub fn persist_instances(&self) {
        let list = self.instances();
        let mut value = serde_json::to_value(list).unwrap_or_else(|_| json!([]));
        strip_json_nulls(&mut value);
        write_json_atomic(&self.data_dir.join("instances.json"), &value);
    }

    pub fn write_instance_file(&self, instance: &Instance) {
        if instance.dir.trim().is_empty() {
            return;
        }
        let mut value = serde_json::to_value(instance).unwrap_or(Value::Null);
        if let Some(obj) = value.as_object_mut() {
            obj.insert(
                "sharedDir".into(),
                Value::String(self.shared_dir().to_string_lossy().into_owned()),
            );
            obj.remove("running");
        }
        write_json_atomic(&Path::new(&instance.dir).join("instance.json"), &value);
    }

    pub fn accounts(&self) -> Vec<Account> {
        self.settings.read().unwrap().accounts.clone()
    }

    pub fn active_account_id(&self) -> Option<String> {
        let settings = self.settings.read().unwrap();
        let active = settings.active_account_id.clone();
        let exists = active
            .as_ref()
            .map(|id| settings.accounts.iter().any(|a| &a.id == id))
            .unwrap_or(false);
        if exists {
            active
        } else {
            settings.accounts.first().map(|a| a.id.clone())
        }
    }

    pub fn active_account(&self) -> Option<Account> {
        let id = self.active_account_id()?;
        self.accounts().into_iter().find(|a| a.id == id)
    }

    pub fn set_accounts(&self, accounts: Vec<Account>, active: Option<String>) {
        let mut settings = self.settings.read().unwrap().clone();
        settings.accounts = accounts;
        settings.active_account_id = active;
        self.set_settings(settings);
    }

    pub fn token(&self, id: &str) -> Option<Value> {
        let raw = self.tokens.read().unwrap().get(id).cloned()?;
        let encoded = raw.as_str()?;
        let decoded = unseal(encoded)?;
        serde_json::from_str(&decoded).ok()
    }

    pub fn set_token(&self, id: &str, value: Option<Value>) {
        {
            let mut tokens = self.tokens.write().unwrap();
            match value {
                Some(value) => {
                    let text = serde_json::to_string(&value).unwrap_or_default();
                    tokens.insert(id.to_string(), Value::String(seal(&text)));
                }
                None => {
                    tokens.remove(id);
                }
            }
        }
        let tokens = self.tokens.read().unwrap().clone();
        write_json_atomic(&self.data_dir.join("tokens.json"), &Value::Object(tokens));
    }

    pub fn accounts_setup(&self) -> (Vec<Account>, Option<String>) {
        let settings = self.settings.read().unwrap();
        let active = settings.active_account_id.clone();
        let exists = active
            .as_ref()
            .map(|id| settings.accounts.iter().any(|a| &a.id == id))
            .unwrap_or(false);
        let active = if exists {
            active
        } else {
            settings.accounts.first().map(|a| a.id.clone())
        };
        (settings.accounts.clone(), active)
    }

    pub fn icon_cache_dir(&self) -> PathBuf {
        self.data_dir.join("icon-cache")
    }

    pub fn skin_cache_dir(&self) -> PathBuf {
        self.data_dir.join("skin-cache")
    }

    pub fn write_launcher_profiles(&self) {
        let shared = self.shared_dir();
        let _ = std::fs::create_dir_all(&shared);
        let file = shared.join("launcher_profiles.json");
        let mut existing: Value = std::fs::read_to_string(&file)
            .ok()
            .and_then(|raw| serde_json::from_str(&raw).ok())
            .unwrap_or_else(|| json!({}));
        let instances = self.instances();
        let now = now_iso();
        let mut profiles = existing
            .get("profiles")
            .and_then(Value::as_object)
            .cloned()
            .unwrap_or_default();
        let managed: Vec<String> = instances.iter().map(|i| i.id.clone()).collect();
        for (key, _) in profiles.clone() {
            if !managed.contains(&key) {
                profiles.remove(&key);
            }
        }
        for instance in &instances {
            let previous = profiles.get(&instance.id).cloned().unwrap_or_else(|| json!({}));
            let created = previous
                .get("created")
                .cloned()
                .or_else(|| instance.created.clone().map(Value::String))
                .unwrap_or_else(|| Value::String(now.clone()));
            let last_used = instance
                .last_played
                .clone()
                .or_else(|| previous.get("lastUsed").and_then(Value::as_str).map(str::to_string))
                .unwrap_or_else(|| now.clone());
            let icon = instance
                .icon
                .clone()
                .or_else(|| previous.get("icon").and_then(Value::as_str).map(str::to_string))
                .unwrap_or_else(|| "data:image/png;base64,".into());
            let mut java_args = format!("-Xmx{}M", instance.memory_mb.max(512));
            if let Some(extra) = instance.jvm_args.as_deref().filter(|v| !v.trim().is_empty()) {
                java_args.push(' ');
                java_args.push_str(extra);
            }
            let mut profile = json!({
                "name": instance.name,
                "type": "custom",
                "created": created,
                "lastUsed": last_used,
                "icon": icon,
                "gameDir": instance.dir,
                "lastVersionId": instance.version_id,
                "javaArgs": java_args,
            });
            if let Some(loader) = instance.loader_version.as_deref() {
                profile["lunarSpaceLoader"] = Value::String(format!("{}-{}", instance.loader, loader));
            }
            profiles.insert(instance.id.clone(), profile);
        }
        existing["profiles"] = Value::Object(profiles);
        if existing.get("settings").is_none() {
            existing["settings"] = json!({
                "enableSnapshots": false,
                "enableAdvanced": true,
                "keepLauncherOpen": false,
                "showGameLog": false,
                "showMenu": false,
                "soundOn": false,
                "locale": "en_US"
            });
        }
        existing["version"] = json!(3);
        existing["launcherVersion"] = json!({
            "name": "2.0.0",
            "format": 21,
            "profilesFormat": 2
        });
        existing["lunarSpaceManaged"] = json!(managed);
        write_json_atomic(&file, &existing);
        for instance in &instances {
            if instance.dir.trim().is_empty() {
                continue;
            }
            let mut scoped = existing.clone();
            let has = scoped["profiles"]
                .as_object()
                .map(|p| p.contains_key(&instance.id))
                .unwrap_or(false);
            let profile = if has {
                json!({ instance.id.clone(): scoped["profiles"][&instance.id].clone() })
            } else {
                json!({})
            };
            scoped["profiles"] = profile;
            scoped["lunarSpaceManaged"] = if has { json!([instance.id]) } else { json!([]) };
            write_json_atomic(&Path::new(&instance.dir).join("launcher_profiles.json"), &scoped);
        }
    }
}

pub fn data_dir() -> PathBuf {
    let base = std::env::var("APPDATA")
        .map(PathBuf::from)
        .unwrap_or_else(|_| dirs::data_dir().unwrap_or_else(|| PathBuf::from(".")));
    let brand = base.join("XyoLauncher");
    if brand.exists() {
        return brand;
    }
    // Keep existing installs readable after the rename.
    let legacy = base.join("lunaspace-launcher");
    if legacy.exists() {
        return legacy;
    }
    brand
}

pub fn merge_object(target: &mut Value, patch: &Value) {
    match (target, patch) {
        (Value::Object(target), Value::Object(patch)) => {
            for (key, value) in patch {
                merge_object(target.entry(key.clone()).or_insert(Value::Null), value);
            }
        }
        (target, patch) => *target = patch.clone(),
    }
}

pub fn write_json_atomic(file: &Path, value: &Value) {
    if let Some(parent) = file.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let temp = file.with_extension(format!("tmp{}", std::process::id()));
    let text = serde_json::to_string_pretty(value).unwrap_or_else(|_| "{}".into());
    if std::fs::write(&temp, text).is_ok() {
        let _ = std::fs::rename(&temp, file);
    }
}

pub fn write_text_atomic(file: &Path, text: &str) -> Result<()> {
    if let Some(parent) = file.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let temp = file.with_extension(format!("tmp{}", std::process::id()));
    std::fs::write(&temp, text)?;
    std::fs::rename(&temp, file)?;
    Ok(())
}

pub fn comparable_path(path: &Path) -> String {
    path.to_string_lossy().replace('/', "\\").to_ascii_lowercase()
}

pub fn new_instance_id(loader: &str, version: &str) -> String {
    let millis = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let base = (millis % 1_000_000_000) as u64;
    format!("{}-{}-{}", loader, version, base.to_string().chars().rev().take(7).collect::<String>())
}

pub fn instance_dir_for(name: &str, default_dir: &Path) -> PathBuf {
    default_dir.join(safe_name(name))
}

pub fn offline_uuid(name: &str) -> String {
    use md5::{Digest, Md5};
    let mut hasher = Md5::new();
    hasher.update(format!("OfflinePlayer:{name}").as_bytes());
    let mut hash = hasher.finalize();
    hash[6] = (hash[6] & 0x0f) | 0x30;
    hash[8] = (hash[8] & 0x3f) | 0x80;
    let hex = crate::util::hex(&hash);
    format!(
        "{}-{}-{}-{}-{}",
        &hex[0..8],
        &hex[8..12],
        &hex[12..16],
        &hex[16..20],
        &hex[20..32]
    )
}

pub fn uuid_dashed(raw: &str) -> String {
    let clean: String = raw.chars().filter(|c| c.is_ascii_hexdigit()).collect();
    if clean.len() != 32 {
        return raw.to_string();
    }
    format!(
        "{}-{}-{}-{}-{}",
        &clean[0..8],
        &clean[8..12],
        &clean[12..16],
        &clean[16..20],
        &clean[20..32]
    )
}

pub fn validate_mc_name(name: &str) -> bool {
    let len = name.chars().count();
    (3..=16).contains(&len)
        && name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_')
}

pub fn safe_join(root: &Path, rel: &str) -> Result<PathBuf> {
    let base = root.canonicalize().unwrap_or_else(|_| root.to_path_buf());
    let cleaned = rel.trim_start_matches('/').replace(char::from(92), "/");
    if cleaned.trim().is_empty() || cleaned.trim() == "." {
        return Ok(base);
    }
    let relative = Path::new(&cleaned);
    if relative.is_absolute()
        || relative.components().any(|part| {
            matches!(
                part,
                std::path::Component::ParentDir | std::path::Component::Prefix(_)
            )
        })
    {
        return Err(anyhow!("Đường dẫn không hợp lệ"));
    }
    let target = base.join(relative);
    if let Some(parent) = target.parent() {
        if let Ok(canonical) = parent.canonicalize() {
            if !canonical.starts_with(&base) {
                return Err(anyhow!("Đường dẫn không hợp lệ"));
            }
        }
    }
    if target.exists() {
        if let Ok(canonical) = target.canonicalize() {
            if !canonical.starts_with(&base) {
                return Err(anyhow!("Đường dẫn không hợp lệ"));
            }
        }
    }
    Ok(target)
}

impl Store {
    pub fn remove_setting(&self, key: &str) {
        let mut settings = self.settings.read().unwrap().clone();
        settings.extra.remove(key);
        self.set_settings(settings);
    }
}

pub fn account_payload(account: &Account) -> Value {
    json!({
        "id": account.id,
        "name": account.name,
        "uuid": account.uuid,
        "type": account.kind,
    })
}

#[cfg(windows)]
fn seal(text: &str) -> String {
    use std::ffi::c_void;
    #[repr(C)]
    struct Blob {
        cb_data: u32,
        pb_data: *mut u8,
    }
    #[link(name = "crypt32")]
    unsafe extern "system" {
        fn CryptProtectData(
            data_in: *const Blob,
            desc: *const u16,
            entropy: *const Blob,
            reserved: *mut c_void,
            prompt: *mut c_void,
            flags: u32,
            data_out: *mut Blob,
        ) -> i32;
    }
    #[link(name = "kernel32")]
    unsafe extern "system" {
        fn LocalFree(mem: *mut c_void) -> *mut c_void;
    }
    let mut bytes = text.as_bytes().to_vec();
    let input = Blob {
        cb_data: bytes.len() as u32,
        pb_data: bytes.as_mut_ptr(),
    };
    let mut output = Blob {
        cb_data: 0,
        pb_data: std::ptr::null_mut(),
    };
    let ok = unsafe {
        CryptProtectData(
            &input,
            std::ptr::null(),
            std::ptr::null(),
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            1,
            &mut output,
        )
    };
    if ok == 0 || output.pb_data.is_null() {
        use base64::Engine;
        return format!("plain:{}", base64::engine::general_purpose::STANDARD.encode(text));
    }
    let encrypted = unsafe { std::slice::from_raw_parts(output.pb_data, output.cb_data as usize) };
    use base64::Engine;
    let out = format!(
        "dpapi:{}",
        base64::engine::general_purpose::STANDARD.encode(encrypted)
    );
    unsafe {
        LocalFree(output.pb_data as *mut c_void);
    }
    out
}

#[cfg(windows)]
fn unseal(text: &str) -> Option<String> {
    use std::ffi::c_void;
    #[repr(C)]
    struct Blob {
        cb_data: u32,
        pb_data: *mut u8,
    }
    #[link(name = "crypt32")]
    unsafe extern "system" {
        fn CryptUnprotectData(
            data_in: *const Blob,
            desc: *mut *mut u16,
            entropy: *const Blob,
            reserved: *mut c_void,
            prompt: *mut c_void,
            flags: u32,
            data_out: *mut Blob,
        ) -> i32;
    }
    #[link(name = "kernel32")]
    unsafe extern "system" {
        fn LocalFree(mem: *mut c_void) -> *mut c_void;
    }
    use base64::Engine;
    if let Some(raw) = text.strip_prefix("plain:") {
        let bytes = base64::engine::general_purpose::STANDARD.decode(raw).ok()?;
        return String::from_utf8(bytes).ok();
    }
    let raw = text.strip_prefix("dpapi:")?;
    let mut bytes = base64::engine::general_purpose::STANDARD.decode(raw).ok()?;
    let input = Blob {
        cb_data: bytes.len() as u32,
        pb_data: bytes.as_mut_ptr(),
    };
    let mut output = Blob {
        cb_data: 0,
        pb_data: std::ptr::null_mut(),
    };
    let ok = unsafe {
        CryptUnprotectData(
            &input,
            std::ptr::null_mut(),
            std::ptr::null(),
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            1,
            &mut output,
        )
    };
    if ok == 0 || output.pb_data.is_null() {
        return None;
    }
    let plain = unsafe { std::slice::from_raw_parts(output.pb_data, output.cb_data as usize) };
    let out = String::from_utf8(plain.to_vec()).ok();
    unsafe {
        LocalFree(output.pb_data as *mut c_void);
    }
    out
}

#[cfg(not(windows))]
fn seal(text: &str) -> String {
    use base64::Engine;
    format!(
        "plain:{}",
        base64::engine::general_purpose::STANDARD.encode(text)
    )
}

#[cfg(not(windows))]
fn unseal(text: &str) -> Option<String> {
    use base64::Engine;
    let raw = text.strip_prefix("plain:")?;
    let bytes = base64::engine::general_purpose::STANDARD.decode(raw).ok()?;
    String::from_utf8(bytes).ok()
}


#[cfg(test)]
mod security_tests {
    use super::*;

    fn temp_root(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("xyo-test-{}-{}", name, uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn safe_join_blocks_traversal() {
        let root = temp_root("join");
        assert!(safe_join(&root, "mods/a.jar").is_ok());
        assert!(safe_join(&root, "../outside.txt").is_err());
        assert!(safe_join(&root, "mods/../../outside.txt").is_err());
        assert!(safe_join(&root, "C:\\Windows\\system32").is_err());
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn offline_uuid_is_version3() {
        let uuid = offline_uuid("Player");
        let clean: String = uuid.chars().filter(|c| *c != '-').collect();
        assert_eq!(clean.len(), 32);
        assert_eq!(&clean[12..13], "3");
        assert!(matches!(&clean[16..17], "8" | "9" | "a" | "b"));
    }

    #[test]
    fn mc_name_validation() {
        assert!(validate_mc_name("Player_1"));
        assert!(!validate_mc_name("ab"));
        assert!(!validate_mc_name("bad name"));
        assert!(!validate_mc_name("toolong_name_1234"));
    }
}
