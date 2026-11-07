use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

pub type JsonMap = Map<String, Value>;

fn default_true() -> bool {
    true
}

#[derive(Clone, Debug, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Account {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub name: String,
    #[serde(default, rename = "type")]
    pub kind: String,
    #[serde(default)]
    pub uuid: String,
    #[serde(default)]
    pub created: Option<String>,
    #[serde(default)]
    pub xuid: Option<String>,
    #[serde(flatten)]
    pub extra: JsonMap,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    #[serde(default)]
    pub accounts: Vec<Account>,
    #[serde(default)]
    pub active_account_id: Option<String>,
    #[serde(default)]
    pub hide_on_launch: bool,
    #[serde(default = "default_dark")]
    pub theme: String,
    #[serde(default = "default_vi")]
    pub language: String,
    #[serde(default)]
    pub font: Option<String>,
    #[serde(default)]
    pub java_path: Option<String>,
    #[serde(default = "default_true")]
    pub auto_update: bool,
    #[serde(default = "default_true")]
    pub discord_rpc: bool,
    #[serde(default)]
    pub shared_dir: Option<String>,
    #[serde(default)]
    pub discord_invite: Option<String>,
    #[serde(default = "default_memory")]
    pub default_memory: u32,
    #[serde(default)]
    pub last_version: Option<String>,
    #[serde(flatten)]
    pub extra: JsonMap,
}

fn default_dark() -> String {
    "dark".into()
}

fn default_vi() -> String {
    "vi".into()
}

fn default_memory() -> u32 {
    4096
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            accounts: Vec::new(),
            active_account_id: None,
            hide_on_launch: false,
            theme: default_dark(),
            language: default_vi(),
            font: None,
            java_path: None,
            auto_update: true,
            discord_rpc: true,
            shared_dir: None,
            discord_invite: None,
            default_memory: default_memory(),
            last_version: None,
            extra: JsonMap::new(),
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Instance {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub version: String,
    #[serde(default)]
    pub loader: String,
    #[serde(default)]
    pub loader_version: Option<String>,
    #[serde(default)]
    pub version_id: Option<String>,
    #[serde(default)]
    pub forge_version: Option<String>,
    #[serde(default = "default_memory")]
    pub memory_mb: u32,
    #[serde(default)]
    pub username: String,
    #[serde(default)]
    pub demo: bool,
    #[serde(default)]
    pub dir: String,
    #[serde(default)]
    pub icon: Option<String>,
    #[serde(default)]
    pub status: String,
    #[serde(default)]
    pub created: Option<String>,
    #[serde(default)]
    pub last_played: Option<String>,
    #[serde(default)]
    pub playtime_ms: u64,
    #[serde(default)]
    pub java_major: Option<u32>,
    #[serde(default)]
    pub java_path: Option<String>,
    #[serde(default)]
    pub jvm_args: Option<String>,
    #[serde(default)]
    pub boost: bool,
    #[serde(default)]
    pub error: Option<String>,
    #[serde(default)]
    pub modpack: Option<Value>,
    #[serde(default)]
    pub recent_servers: Vec<Value>,
    #[serde(default)]
    pub recent_worlds: Vec<Value>,
    #[serde(skip_serializing_if = "std::ops::Not::not", default)]
    pub running: bool,
    #[serde(flatten)]
    pub extra: JsonMap,
}

#[derive(Clone, Debug, Serialize, Deserialize, Default)]
pub struct VersionEntry {
    pub id: String,
    #[serde(rename = "type")]
    pub kind: String,
    #[serde(rename = "releaseTime")]
    pub release_time: String,
    pub url: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct LoaderRow {
    pub id: String,
    pub version: String,
    #[serde(default)]
    pub stable: bool,
    #[serde(default)]
    pub latest: bool,
    #[serde(default)]
    pub build: Option<String>,
    #[serde(default)]
    pub minecraft: Option<String>,
    #[serde(default)]
    pub published_at: Option<String>,
    #[serde(default, rename = "legacy")]
    pub legacy: bool,
    #[serde(default)]
    pub beta: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct AuthSession {
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub uuid: String,
    #[serde(default)]
    pub access_token: String,
    #[serde(default)]
    pub user_type: String,
    #[serde(default)]
    pub xuid: Option<String>,
    #[serde(default)]
    pub expires_at: i64,
    #[serde(default)]
    pub refresh_token: Option<String>,
    #[serde(default)]
    pub client_token: Option<String>,
    #[serde(default)]
    pub java_agent: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Progress {
    #[serde(default)]
    pub label: String,
    #[serde(default)]
    pub done: u64,
    #[serde(default)]
    pub total: u64,
    #[serde(default)]
    pub bytes: u64,
    #[serde(default)]
    pub total_bytes: u64,
    #[serde(default)]
    pub bytes_done: u64,
    #[serde(default)]
    pub skipped: u64,
    #[serde(default)]
    pub file: String,
    #[serde(default)]
    pub final_chunk: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct FileEntry {
    pub name: String,
    pub rel: String,
    pub dir: bool,
    pub size: u64,
    pub modified: i64,
    pub disabled: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JavaRuntime {
    pub component: String,
    pub name: String,
    pub major: u32,
    pub installed: bool,
    pub dir: String,
    pub java_path: String,
    pub bytes: u64,
    pub download_bytes: u64,
    pub installed_at: Option<String>,
    #[serde(default)]
    pub kind: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SystemInfo {
    pub platform: String,
    pub arch: String,
    pub cpu_model: String,
    pub cpu_threads: usize,
    pub total_mem: u64,
    pub free_mem: u64,
    pub disk_total: u64,
    pub disk_free: u64,
    pub shared_dir: String,
    pub cache_bytes: u64,
}

#[derive(Clone, Debug, Serialize, Deserialize, Default)]
pub struct ContentHit {
    pub id: String,
    pub slug: String,
    pub name: String,
    pub summary: String,
    pub icon: String,
    pub downloads: u64,
    pub follows: u64,
    pub author: String,
    pub tags: Vec<String>,
    pub source: String,
    pub kind: String,
    pub updated: String,
    #[serde(default)]
    pub env: Option<String>,
    #[serde(default)]
    pub loaders: Vec<String>,
    #[serde(default)]
    pub game_versions: Vec<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ContentVersion {
    pub id: String,
    pub name: String,
    pub version_number: String,
    pub game_versions: Vec<String>,
    pub loaders: Vec<String>,
    pub downloads: u64,
    pub date_published: String,
    pub changelog: String,
    pub file_name: String,
    pub file_url: String,
    pub file_size: u64,
    pub dependencies: Vec<Value>,
}

pub fn instance_to_value(instance: &Instance) -> Value {
    serde_json::to_value(instance).unwrap_or(Value::Null)
}
