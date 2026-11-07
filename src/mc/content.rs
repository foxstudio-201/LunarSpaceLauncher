use crate::models::{ContentHit, ContentVersion, Progress};
use crate::net::{DownloadTask, ProgressFn};
use anyhow::{anyhow, Result};
use serde_json::Value;
use std::path::{Path, PathBuf};

pub const MODRINTH: &str = "https://api.modrinth.com/v2";
pub const CF: &str = "https://api.curse.tools/v1";
pub const CF_GAME: u32 = 432;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Kind {
    Mods,
    Resourcepacks,
    Shaderpacks,
    Modpacks,
}

impl Kind {
    pub fn parse(value: &str) -> Result<Self> {
        Ok(match value {
            "mods" => Self::Mods,
            "resourcepacks" => Self::Resourcepacks,
            "shaderpacks" => Self::Shaderpacks,
            "modpacks" => Self::Modpacks,
            other => return Err(anyhow!("Loại nội dung không hợp lệ: {other}")),
        })
    }

    pub fn mr(self) -> &'static str {
        match self {
            Self::Mods => "mod",
            Self::Resourcepacks => "resourcepack",
            Self::Shaderpacks => "shader",
            Self::Modpacks => "modpack",
        }
    }

    pub fn cf(self) -> u32 {
        match self {
            Self::Mods => 6,
            Self::Resourcepacks => 12,
            Self::Shaderpacks => 6552,
            Self::Modpacks => 4471,
        }
    }

    pub fn folder(self) -> &'static str {
        match self {
            Self::Mods => "mods",
            Self::Resourcepacks => "resourcepacks",
            Self::Shaderpacks => "shaderpacks",
            Self::Modpacks => "modpacks",
        }
    }

    pub fn loader_filter(self) -> bool {
        self == Self::Mods
    }
}

pub fn cf_loader_id(loader: &str) -> Option<u32> {
    match loader {
        "forge" => Some(1),
        "fabric" => Some(4),
        "quilt" => Some(5),
        "neoforge" => Some(6),
        _ => None,
    }
}

pub fn cf_loader_name(id: u64) -> &'static str {
    match id {
        1 => "forge",
        4 => "fabric",
        5 => "quilt",
        6 => "neoforge",
        _ => "",
    }
}

pub fn cf_file_url(file: &Value) -> Option<String> {
    if let Some(url) = file.get("downloadUrl").and_then(Value::as_str).filter(|v| !v.is_empty()) {
        return Some(url.to_string());
    }
    let id = file.get("id").and_then(Value::as_u64)?;
    let name = file.get("fileName").and_then(Value::as_str).unwrap_or("");
    let text = id.to_string();
    if text.len() <= 4 {
        return None;
    }
    Some(format!(
        "https://mediafilez.forgecdn.net/files/{}/{}/{}",
        &text[..4],
        &text[4..],
        urlencode(name)
    ))
}

pub fn cf_file_alts(file: &Value) -> Vec<String> {
    let mut out = Vec::new();
    if let Some(url) = file.get("downloadUrl").and_then(Value::as_str) {
        out.push(url.to_string());
    }
    if let Some(id) = file.get("id").and_then(Value::as_u64) {
        let text = id.to_string();
        if text.len() > 4 {
            let name = urlencode(file.get("fileName").and_then(Value::as_str).unwrap_or(""));
            out.push(format!(
                "https://mediafilez.forgecdn.net/files/{}/{}/{}",
                &text[..4],
                &text[4..],
                name
            ));
            out.push(format!(
                "https://edge.forgecdn.net/files/{}/{}/{}",
                &text[..4],
                &text[4..],
                name
            ));
        }
    }
    out.sort();
    out.dedup();
    out
}

pub fn cf_sha1(file: &Value) -> Option<String> {
    file.get("hashes")
        .and_then(Value::as_array)?
        .iter()
        .find(|h| h.get("algo").and_then(Value::as_u64) == Some(1))
        .and_then(|h| h.get("value"))
        .and_then(Value::as_str)
        .map(str::to_string)
}

fn urlencode(value: &str) -> String {
    let mut out = String::new();
    for byte in value.bytes() {
        if byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.' | b'~') {
            out.push(byte as char);
        } else {
            out.push_str(&format!("%{byte:02X}"));
        }
    }
    out
}

pub fn iso(value: &Value) -> String {
    if let Some(number) = value.as_i64() {
        if number > 0 {
            if let Some(dt) = chrono::DateTime::from_timestamp_millis(number) {
                return dt.to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
            }
        }
    }
    value.as_str().unwrap_or("").to_string()
}

pub fn loaders_of(list: &Value) -> Vec<String> {
    let mut set = std::collections::BTreeSet::new();
    let Some(items) = list.as_array() else {
        return Vec::new();
    };
    for item in items {
        let raw = item.as_str().unwrap_or("").to_lowercase();
        let normalized = regex::Regex::new(r"([a-z])(\d)").unwrap().replace_all(&raw, "$1-$2");
        let tokens: Vec<&str> = normalized
            .split(|c: char| !c.is_ascii_alphabetic())
            .collect();
        for loader in ["neoforge", "forge", "fabric", "quilt"] {
            if tokens.contains(&loader) {
                set.insert(loader.to_string());
            }
        }
    }
    set.into_iter().collect()
}

fn env_kind(client: Option<&str>, server: Option<&str>) -> String {
    let ok = |v: Option<&str>| matches!(v, Some("required") | Some("optional"));
    match (ok(client), ok(server)) {
        (true, true) => "both",
        (true, false) => "client",
        (false, true) => "server",
        _ => "",
    }
    .to_string()
}

fn tag_noise(tag: &str) -> bool {
    matches!(
        tag,
        "fabric" | "quilt" | "forge" | "neoforge" | "client" | "server" | "datapack"
    )
}

fn prettify_tag(slug: &str) -> String {
    slug.split('-')
        .map(|part| {
            let mut chars = part.chars();
            match chars.next() {
                Some(first) => first.to_uppercase().collect::<String>() + chars.as_str(),
                None => String::new(),
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

fn mr_facets(
    kind: Kind,
    game: Option<&str>,
    loader: Option<&str>,
    category: Option<&str>,
    environment: Option<&str>,
) -> String {
    let mut facets: Vec<Vec<String>> = vec![vec![format!("project_type:{}", kind.mr())]];
    if let Some(game) = game.filter(|v| !v.is_empty()) {
        facets.push(vec![format!("versions:{game}")]);
    }
    if kind.loader_filter() {
        if let Some(loader) = loader.filter(|v| !v.is_empty() && *v != "vanilla") {
            facets.push(vec![format!("categories:{loader}")]);
        }
    }
    if let Some(category) = category.filter(|v| !v.is_empty()) {
        facets.push(vec![format!("categories:{category}")]);
    }
    match environment.unwrap_or("") {
        "client" => facets.push(vec![
            "client_side:required".into(),
            "client_side:optional".into(),
        ]),
        "server" => facets.push(vec![
            "server_side:required".into(),
            "server_side:optional".into(),
        ]),
        "both" => {
            facets.push(vec![
                "client_side:required".into(),
                "client_side:optional".into(),
            ]);
            facets.push(vec![
                "server_side:required".into(),
                "server_side:optional".into(),
            ]);
        }
        _ => {}
    }
    serde_json::to_string(&facets).unwrap_or_else(|_| "[]".into())
}

pub struct SearchResult {
    pub total: u64,
    pub hits: Vec<ContentHit>,
}

pub async fn search(
    kind: Kind,
    source: &str,
    query: &str,
    sort: &str,
    offset: u32,
    limit: u32,
    game: Option<&str>,
    loader: Option<&str>,
    category: Option<&str>,
    environment: Option<&str>,
) -> Result<SearchResult> {
    if source == "lunar" {
        if kind != Kind::Modpacks {
            return Err(anyhow!("LunarModpack chỉ hỗ trợ modpack."));
        }
        let sort = match sort {
            "downloads" => "downloads",
            "name" => "name",
            _ => "newest",
        };
        let mut url = format!(
            "{}/api/lunar-modpacks?q={}&sort={sort}&offset={offset}&limit={limit}",
            crate::mc::meta::LUNAR_API,
            urlencode(query)
        );
        if let Some(game) = game.filter(|v| !v.is_empty()) {
            url.push_str(&format!("&game={}", urlencode(game)));
        }
        if let Some(loader) = loader.filter(|v| !v.is_empty()) {
            url.push_str(&format!("&loader={}", urlencode(loader)));
        }
        let data = crate::net::fetch_json(&url).await?;
        let total = data.get("total").and_then(Value::as_u64).unwrap_or(0);
        let hits = data
            .get("hits")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default()
            .iter()
            .map(|row| {
                let id = row
                    .get("packId")
                    .and_then(Value::as_str)
                    .or_else(|| row.get("id").and_then(Value::as_str))
                    .unwrap_or("")
                    .to_string();
                ContentHit {
                    id,
                    slug: row
                        .get("slug")
                        .and_then(Value::as_str)
                        .unwrap_or("")
                        .to_string(),
                    name: row
                        .get("name")
                        .and_then(Value::as_str)
                        .unwrap_or("Modpack")
                        .to_string(),
                    summary: row
                        .get("summary")
                        .and_then(Value::as_str)
                        .unwrap_or("")
                        .to_string(),
                    icon: row
                        .get("icon")
                        .and_then(Value::as_str)
                        .unwrap_or("")
                        .to_string(),
                    downloads: row.get("downloads").and_then(Value::as_u64).unwrap_or(0),
                    follows: 0,
                    author: row
                        .get("author")
                        .and_then(Value::as_str)
                        .unwrap_or("LunarSpace")
                        .to_string(),
                    tags: Vec::new(),
                    source: "lunar".into(),
                    kind: kind.folder().into(),
                    updated: iso(&row.get("updated_at").cloned().unwrap_or(Value::Null)),
                    env: None,
                    loaders: row
                        .get("loader")
                        .and_then(Value::as_str)
                        .filter(|v| !v.is_empty())
                        .map(|v| vec![v.to_string()])
                        .unwrap_or_default(),
                    game_versions: row
                        .get("minecraft")
                        .and_then(Value::as_str)
                        .filter(|v| !v.is_empty())
                        .map(|v| vec![v.to_string()])
                        .unwrap_or_default(),
                }
            })
            .collect();
        return Ok(SearchResult { total, hits });
    }
    if source == "curseforge" {
        let sort_field = match sort {
            "downloads" => 6,
            "updated" => 3,
            "newest" => 11,
            _ => 1,
        };
        let loader_id = if kind.loader_filter() {
            loader.and_then(cf_loader_id)
        } else {
            None
        };
        let mut url = format!(
            "{CF}/mods/search?gameId={CF_GAME}&classId={}&searchFilter={}&sortField={sort_field}&sortOrder=desc&pageSize={limit}&index={offset}",
            kind.cf(),
            urlencode(query)
        );
        if let Some(game) = game.filter(|v| !v.is_empty()) {
            url.push_str(&format!("&gameVersion={}", urlencode(game)));
        }
        if let Some(loader) = loader_id {
            url.push_str(&format!("&modLoaderType={loader}"));
        }
        if let Some(category) = category.filter(|v| v.parse::<u64>().is_ok()) {
            url.push_str(&format!("&categoryId={category}"));
        }
        let data = cf_json(&url).await?;
        let total = data
            .pointer("/pagination/totalCount")
            .and_then(Value::as_u64)
            .unwrap_or(0);
        let hits = data
            .get("data")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default()
            .iter()
            .map(|mod_row| {
                let authors = mod_row
                    .get("authors")
                    .and_then(Value::as_array)
                    .map(|list| {
                        list.iter()
                            .filter_map(|a| a.get("name").and_then(Value::as_str))
                            .collect::<Vec<_>>()
                            .join(", ")
                    })
                    .unwrap_or_default();
                let indexes = mod_row
                    .get("latestFilesIndexes")
                    .and_then(Value::as_array)
                    .cloned()
                    .unwrap_or_default();
                let loaders = loaders_of(&Value::Array(
                    indexes
                        .iter()
                        .filter_map(|f| {
                            f.get("modLoader")
                                .and_then(Value::as_u64)
                                .map(|id| Value::String(cf_loader_name(id).into()))
                        })
                        .collect(),
                ));
                let game_versions: Vec<String> = indexes
                    .iter()
                    .filter_map(|f| f.get("gameVersion").and_then(Value::as_str).map(str::to_string))
                    .collect::<std::collections::BTreeSet<_>>()
                    .into_iter()
                    .collect();
                ContentHit {
                    id: mod_row.get("id").map(|v| v.to_string()).unwrap_or_default(),
                    slug: mod_row
                        .get("slug")
                        .and_then(Value::as_str)
                        .unwrap_or("")
                        .to_string(),
                    name: mod_row
                        .get("name")
                        .and_then(Value::as_str)
                        .unwrap_or("")
                        .to_string(),
                    summary: mod_row
                        .get("summary")
                        .and_then(Value::as_str)
                        .unwrap_or("")
                        .to_string(),
                    icon: mod_row
                        .pointer("/logo/thumbnailUrl")
                        .and_then(Value::as_str)
                        .unwrap_or("")
                        .to_string(),
                    downloads: mod_row
                        .get("downloadCount")
                        .and_then(Value::as_u64)
                        .unwrap_or(0),
                    follows: 0,
                    author: authors,
                    tags: mod_row
                        .get("categories")
                        .and_then(Value::as_array)
                        .map(|list| {
                            list.iter()
                                .filter_map(|c| {
                                    c.get("name")
                                        .and_then(Value::as_str)
                                        .or_else(|| c.get("slug").and_then(Value::as_str))
                                })
                                .map(str::to_string)
                                .collect()
                        })
                        .unwrap_or_default(),
                    source: "curseforge".into(),
                    kind: kind.folder().into(),
                    updated: iso(&mod_row.get("dateModified").cloned().unwrap_or(Value::Null)),
                    env: None,
                    loaders,
                    game_versions,
                }
            })
            .collect();
        return Ok(SearchResult { total, hits });
    }

    let index = match sort {
        "downloads" | "follows" | "newest" | "updated" => sort,
        _ => "relevance",
    };
    let url = format!(
        "{MODRINTH}/search?query={}&facets={}&index={index}&limit={limit}&offset={offset}",
        urlencode(query),
        urlencode(&mr_facets(kind, game, loader, category, environment))
    );
    let data = crate::net::fetch_json(&url).await?;
    let total = data.get("total_hits").and_then(Value::as_u64).unwrap_or(0);
    let hits = data
        .get("hits")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default()
        .iter()
        .map(|hit| {
            let categories: Vec<String> = hit
                .get("categories")
                .and_then(Value::as_array)
                .map(|list| {
                    list.iter()
                        .filter_map(|c| c.as_str())
                        .filter(|c| !tag_noise(&c.to_lowercase()))
                        .map(prettify_tag)
                        .collect()
                })
                .unwrap_or_default();
            ContentHit {
                id: hit
                    .get("project_id")
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .to_string(),
                slug: hit
                    .get("slug")
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .to_string(),
                name: hit
                    .get("title")
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .to_string(),
                summary: hit
                    .get("description")
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .to_string(),
                icon: hit
                    .get("icon_url")
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .to_string(),
                downloads: hit.get("downloads").and_then(Value::as_u64).unwrap_or(0),
                follows: hit.get("follows").and_then(Value::as_u64).unwrap_or(0),
                author: hit
                    .get("author")
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .to_string(),
                tags: categories,
                source: "modrinth".into(),
                kind: kind.folder().into(),
                updated: iso(&hit.get("date_modified").cloned().unwrap_or(Value::Null)),
                env: Some(env_kind(
                    hit.get("client_side").and_then(Value::as_str),
                    hit.get("server_side").and_then(Value::as_str),
                )),
                loaders: loaders_of(hit.get("categories").unwrap_or(&Value::Null)),
                game_versions: hit
                    .get("versions")
                    .and_then(Value::as_array)
                    .map(|list| {
                        list.iter()
                            .filter_map(|v| v.as_str().map(str::to_string))
                            .collect()
                    })
                    .unwrap_or_default(),
            }
        })
        .collect();
    Ok(SearchResult { total, hits })
}

pub async fn cf_json(url: &str) -> Result<Value> {
    let res = crate::net::client().get(url).send().await?;
    let status = res.status();
    let body: Value = res.json().await.unwrap_or(Value::Null);
    if !status.is_success() {
        let message = body
            .get("error")
            .and_then(Value::as_str)
            .unwrap_or("CurseForge API lỗi");
        return Err(anyhow!("{message} (HTTP {status})"));
    }
    Ok(body)
}

pub fn pick_file(files: &Value) -> Option<Value> {
    let list = files.as_array()?;
    let file = list
        .iter()
        .find(|f| f.get("primary").and_then(Value::as_bool) == Some(true))
        .or_else(|| list.first())?;
    Some(serde_json::json!({
        "url": file.get("url").cloned().unwrap_or(Value::Null),
        "filename": file.get("filename").cloned().unwrap_or(Value::Null),
        "size": file.get("file_size").cloned().unwrap_or(Value::Null),
        "sha1": file.pointer("/hashes/sha1").cloned().unwrap_or(Value::Null),
    }))
}

pub async fn versions(kind: Kind, source: &str, id: &str) -> Result<Vec<ContentVersion>> {
    if source == "lunar" {
        let data = crate::net::fetch_json(&format!(
            "{}/api/lunar-modpacks/{}/versions",
            crate::mc::meta::LUNAR_API,
            urlencode(id)
        ))
        .await?;
        let mut out = Vec::new();
        for row in data
            .get("versions")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default()
        {
            let version_id = row
                .get("id")
                .map(|v| v.to_string().trim_matches('"').to_string())
                .unwrap_or_default();
            let version_number = row
                .get("versionNumber")
                .and_then(Value::as_str)
                .or_else(|| row.get("name").and_then(Value::as_str))
                .unwrap_or("1.0.0")
                .to_string();
            let game_versions = row
                .get("gameVersions")
                .and_then(Value::as_array)
                .map(|list| {
                    list.iter()
                        .filter_map(|v| v.as_str().map(str::to_string))
                        .collect::<Vec<_>>()
                })
                .filter(|list| !list.is_empty())
                .or_else(|| {
                    row.get("minecraft")
                        .and_then(Value::as_str)
                        .map(|v| vec![v.to_string()])
                })
                .unwrap_or_default();
            let loaders = row
                .get("loaders")
                .and_then(Value::as_array)
                .map(|list| {
                    list.iter()
                        .filter_map(|v| v.as_str().map(str::to_string))
                        .collect::<Vec<_>>()
                })
                .filter(|list| !list.is_empty())
                .or_else(|| {
                    row.get("loader")
                        .and_then(Value::as_str)
                        .map(|v| vec![v.to_string()])
                })
                .unwrap_or_default();
            out.push(ContentVersion {
                id: version_id.clone(),
                name: version_number.clone(),
                version_number,
                game_versions,
                loaders,
                downloads: row.get("downloads").and_then(Value::as_u64).unwrap_or(0),
                date_published: iso(&row.get("datePublished").cloned().unwrap_or(Value::Null)),
                changelog: row
                    .get("changelog")
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .to_string(),
                file_name: format!("{version_id}.zip"),
                file_url: format!(
                    "{}/api/lunar-modpacks/{}/download",
                    crate::mc::meta::LUNAR_API,
                    urlencode(&version_id)
                ),
                file_size: row
                    .get("size")
                    .and_then(Value::as_u64)
                    .or_else(|| {
                        row.get("files")
                            .and_then(Value::as_array)
                            .and_then(|list| list.first())
                            .and_then(|file| file.get("size"))
                            .and_then(Value::as_u64)
                    })
                    .unwrap_or(0),
                dependencies: Vec::new(),
            });
        }
        return Ok(out);
    }
    if source == "curseforge" {
        let data = cf_json(&format!(
            "{CF}/mods/{}/files?pageSize=50",
            urlencode(id)
        ))
        .await?;
        let mut out = Vec::new();
        for file in data
            .get("data")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default()
        {
            let game_versions: Vec<String> = file
                .get("gameVersions")
                .and_then(Value::as_array)
                .map(|list| {
                    list.iter()
                        .filter_map(|v| v.as_str())
                        .filter(|v| {
                            v.chars().next().map(|c| c.is_ascii_digit()).unwrap_or(false)
                        })
                        .map(str::to_string)
                        .collect()
                })
                .unwrap_or_default();
            let loader = file
                .get("modLoader")
                .and_then(Value::as_u64)
                .map(cf_loader_name)
                .unwrap_or("")
                .to_string();
            let loaders = if loader.is_empty() {
                Vec::new()
            } else {
                vec![loader]
            };
            out.push(ContentVersion {
                id: file.get("id").map(|v| v.to_string()).unwrap_or_default(),
                name: file
                    .get("displayName")
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .to_string(),
                version_number: file
                    .get("fileName")
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .to_string(),
                game_versions,
                loaders,
                downloads: file.get("downloadCount").and_then(Value::as_u64).unwrap_or(0),
                date_published: iso(&file.get("fileDate").cloned().unwrap_or(Value::Null)),
                changelog: String::new(),
                file_name: file
                    .get("fileName")
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .to_string(),
                file_url: cf_file_url(&file).unwrap_or_default(),
                file_size: file.get("fileLength").and_then(Value::as_u64).unwrap_or(0),
                dependencies: file
                    .get("dependencies")
                    .and_then(Value::as_array)
                    .cloned()
                    .unwrap_or_default(),
            });
        }
        return Ok(out);
    }
    let list = crate::net::fetch_json(&format!(
        "{MODRINTH}/project/{}/version",
        urlencode(id)
    ))
    .await?;
    let mut out = Vec::new();
    for v in list.as_array().cloned().unwrap_or_default() {
        let Some(file) = pick_file(v.get("files").unwrap_or(&Value::Null)) else {
            continue;
        };
        out.push(ContentVersion {
            id: v.get("id").and_then(Value::as_str).unwrap_or("").to_string(),
            name: v.get("name").and_then(Value::as_str).unwrap_or("").to_string(),
            version_number: v
                .get("version_number")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string(),
            game_versions: v
                .get("game_versions")
                .and_then(Value::as_array)
                .map(|list| {
                    list.iter()
                        .filter_map(|v| v.as_str().map(str::to_string))
                        .collect()
                })
                .unwrap_or_default(),
            loaders: loaders_of(v.get("loaders").unwrap_or(&Value::Null)),
            downloads: v.get("downloads").and_then(Value::as_u64).unwrap_or(0),
            date_published: iso(&v.get("date_published").cloned().unwrap_or(Value::Null)),
            changelog: crate::util::markdown_to_text(
                v.get("changelog").and_then(Value::as_str).unwrap_or(""),
            ),
            file_name: file
                .get("filename")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string(),
            file_url: file
                .get("url")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string(),
            file_size: file.get("size").and_then(Value::as_u64).unwrap_or(0),
            dependencies: v
                .get("dependencies")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default(),
        });
    }
    Ok(out)
}

pub async fn project(source: &str, id: &str, kind: Kind) -> Result<Value> {
    if source == "lunar" {
        let data = crate::net::fetch_json(&format!(
            "{}/api/lunar-modpacks/{}",
            crate::mc::meta::LUNAR_API,
            urlencode(id)
        ))
        .await?;
        let row = data.get("project").cloned().unwrap_or(Value::Null);
        let description = row
            .get("description_html")
            .and_then(Value::as_str)
            .map(crate::util::html_to_text)
            .or_else(|| {
                row.get("description")
                    .and_then(Value::as_str)
                    .map(str::to_string)
            })
            .unwrap_or_default();
        return Ok(serde_json::json!({
            "id": id,
            "source": "lunar",
            "name": row.get("name"),
            "summary": row.get("summary"),
            "description": description,
            "icon": row.get("icon"),
            "downloads": row.get("downloads"),
            "website": row.get("page"),
            "author": row.get("author"),
            "gallery": row.get("gallery").cloned().unwrap_or_else(|| serde_json::json!([])),
            "kind": kind.folder(),
        }));
    }
    if source == "curseforge" {
        let data = cf_json(&format!("{CF}/mods/{}/description", urlencode(id))).await?;
        let raw = data.get("data").and_then(Value::as_str).unwrap_or("");
        let description = crate::util::html_to_text(raw);
        let mod_data = cf_json(&format!("{CF}/mods/{}", urlencode(id))).await?;
        let row = mod_data.get("data").cloned().unwrap_or(Value::Null);
        let indexes = row
            .get("latestFilesIndexes")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        let loaders = loaders_of(&Value::Array(
            indexes
                .iter()
                .filter_map(|f| {
                    f.get("modLoader")
                        .and_then(Value::as_u64)
                        .map(|id| Value::String(cf_loader_name(id).into()))
                })
                .collect(),
        ));
        let game_versions: Vec<String> = indexes
            .iter()
            .filter_map(|f| f.get("gameVersion").and_then(Value::as_str).map(str::to_string))
            .collect::<std::collections::BTreeSet<_>>()
            .into_iter()
            .collect();
        let categories: Vec<String> = row
            .get("categories")
            .and_then(Value::as_array)
            .map(|list| {
                list.iter()
                    .filter_map(|c| {
                        c.get("name")
                            .and_then(Value::as_str)
                            .or_else(|| c.get("slug").and_then(Value::as_str))
                    })
                    .map(str::to_string)
                    .collect()
            })
            .unwrap_or_default();
        let creators: Vec<Value> = row
            .get("authors")
            .and_then(Value::as_array)
            .map(|list| {
                list.iter()
                    .filter_map(|a| a.get("name").and_then(Value::as_str))
                    .map(|name| serde_json::json!({"name": name, "role": "Tác giả", "avatar": null}))
                    .collect()
            })
            .unwrap_or_default();
        let mut links = Vec::new();
        for (label, key) in [
            ("Trang dự án", "websiteUrl"),
            ("Wiki", "wikiUrl"),
            ("Báo lỗi", "issuesUrl"),
            ("Mã nguồn", "sourceUrl"),
        ] {
            if let Some(url) = row
                .pointer(&format!("/links/{key}"))
                .and_then(Value::as_str)
                .filter(|v| !v.is_empty())
            {
                links.push(serde_json::json!({"label": label, "url": url}));
            }
        }
        return Ok(serde_json::json!({
            "id": id,
            "source": "curseforge",
            "name": row.get("name"),
            "summary": row.get("summary"),
            "description": description,
            "descriptionRaw": raw,
            "descriptionFormat": "html",
            "icon": row.pointer("/logo/thumbnailUrl"),
            "downloads": row.get("downloadCount"),
            "followers": 0,
            "website": row.pointer("/links/websiteUrl"),
            "author": creators.iter().filter_map(|c| c.get("name").and_then(Value::as_str)).collect::<Vec<_>>().join(", "),
            "gallery": [],
            "loaders": loaders,
            "categories": categories,
            "gameVersions": game_versions,
            "license": row.pointer("/license/name"),
            "slug": row.get("slug"),
            "created": row.get("dateCreated"),
            "updated": row.get("dateModified"),
            "creators": creators,
            "links": links,
            "kind": kind.folder(),
        }));
    }
    let row = crate::net::fetch_json(&format!("{MODRINTH}/project/{}", urlencode(id))).await?;
    let members = row
        .get("members")
        .and_then(Value::as_array)
        .map(|list| {
            list.iter()
                .filter_map(|m| m.get("username").and_then(Value::as_str))
                .collect::<Vec<_>>()
                .join(", ")
        })
        .unwrap_or_default();
    let body = row.get("body").and_then(Value::as_str).unwrap_or("");
    let mut links = Vec::new();
    for (label, key) in [
        ("Trang dự án", "source_url"),
        ("Wiki", "wiki_url"),
        ("Báo lỗi", "issues_url"),
        ("Discord", "discord_url"),
    ] {
        if let Some(url) = row
            .get(key)
            .and_then(Value::as_str)
            .filter(|v| !v.is_empty())
        {
            links.push(serde_json::json!({"label": label, "url": url}));
        }
    }
    let creators: Vec<Value> = row
        .get("members")
        .and_then(Value::as_array)
        .map(|list| {
            list.iter()
                .filter_map(|m| {
                    let name = m.get("username").and_then(Value::as_str)?;
                    Some(serde_json::json!({
                        "name": name,
                        "role": m.get("role").and_then(Value::as_str).unwrap_or("Thành viên"),
                        "avatar": m.pointer("/user/avatar_url").cloned().unwrap_or(Value::Null),
                    }))
                })
                .collect()
        })
        .unwrap_or_default();
    Ok(serde_json::json!({
        "id": id,
        "source": "modrinth",
        "name": row.get("title"),
        "summary": row.get("description"),
        "description": crate::util::markdown_to_text(body),
        "descriptionRaw": body,
        "descriptionFormat": "markdown",
        "icon": row.get("icon_url"),
        "downloads": row.get("downloads"),
        "followers": row.get("followers"),
        "website": row.get("source_url"),
        "author": members,
        "gallery": row.get("gallery"),
        "loaders": row.get("loaders"),
        "categories": row.get("categories"),
        "gameVersions": row.get("game_versions"),
        "license": row.pointer("/license/id"),
        "slug": row.get("slug"),
        "created": row.get("published"),
        "updated": row.get("updated"),
        "creators": creators,
        "links": links,
        "kind": kind.folder(),
    }))
}

pub struct InstallTask {
    pub url: String,
    pub dest: PathBuf,
    pub sha1: Option<String>,
    pub size: u64,
    pub alts: Vec<String>,
    pub name: String,
}

pub struct ContentPlan {
    pub folder: String,
    pub tasks: Vec<InstallTask>,
    pub deps: usize,
    pub missing: usize,
}

async fn mr_version_detail(version_id: &str) -> Result<Value> {
    crate::net::fetch_json(&format!("{MODRINTH}/version/{}", urlencode(version_id))).await
}

fn mr_file_task(kind: Kind, version: &Value, root: &Path) -> Option<InstallTask> {
    let file = pick_file(version.get("files")?)?;
    let raw_name = file.get("filename")?.as_str()?;
    let filename = std::path::Path::new(raw_name)
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .filter(|name| !name.is_empty())?;
    let url = file.get("url")?.as_str()?.to_string();
    let rel = format!("{}/{filename}", kind.folder());
    Some(InstallTask {
        url,
        dest: root.join(rel.replace('/', std::path::MAIN_SEPARATOR_STR)),
        sha1: file.get("sha1").and_then(Value::as_str).map(str::to_string),
        size: file.get("size").and_then(Value::as_u64).unwrap_or(0),
        alts: Vec::new(),
        name: filename,
    })
}

async fn mr_dependencies(
    version: &Value,
    kind: Kind,
    game: Option<&str>,
    loader: Option<&str>,
    root: &Path,
) -> Vec<InstallTask> {
    let mut out = Vec::new();
    let Some(deps) = version.get("dependencies").and_then(Value::as_array) else {
        return out;
    };
    for dep in deps {
        let dep_kind = dep
            .get("dependency_type")
            .and_then(Value::as_str)
            .unwrap_or("required");
        if dep_kind != "required" {
            continue;
        }
        let Some(project_id) = dep.get("project_id").and_then(Value::as_str) else {
            continue;
        };
        if kind == Kind::Mods {
            // Dependencies of mods are always mods.
        }
        let detail = if let Some(version_id) = dep.get("version_id").and_then(Value::as_str) {
            mr_version_detail(version_id).await.ok()
        } else {
            let mut url = format!(
                "{MODRINTH}/project/{}/version?loaders={}&game_versions={}",
                urlencode(project_id),
                urlencode(&serde_json::to_string(&[loader.unwrap_or("fabric")]).unwrap_or_else(|_| "[]".into())),
                urlencode(&serde_json::to_string(&[game.unwrap_or("")]).unwrap_or_else(|_| "[]".into()))
            );
            url.push_str("");
            crate::net::fetch_json(&url)
                .await
                .ok()
                .and_then(|value| value.as_array().and_then(|list| list.first().cloned()))
        };
        if let Some(detail) = detail {
            if let Some(task) = mr_file_task(kind, &detail, root) {
                out.push(task);
            }
        }
    }
    out
}

async fn cf_dependencies(
    file: &Value,
    kind: Kind,
    game: Option<&str>,
    loader: Option<&str>,
    root: &Path,
) -> Vec<InstallTask> {
    let mut out = Vec::new();
    let Some(deps) = file.get("dependencies").and_then(Value::as_array) else {
        return out;
    };
    for dep in deps {
        if dep.get("relationType").and_then(Value::as_u64) != Some(3) {
            continue;
        }
        let Some(mod_id) = dep.get("modId").and_then(Value::as_u64) else {
            continue;
        };
        let mut url = format!("{CF}/mods/{mod_id}/files?pageSize=50");
        if let Some(game) = game.filter(|v| !v.is_empty()) {
            url.push_str(&format!("&gameVersion={}", urlencode(game)));
        }
        if let Some(loader) = loader.and_then(cf_loader_id) {
            url.push_str(&format!("&modLoaderType={loader}"));
        }
        let Ok(data) = cf_json(&url).await else {
            continue;
        };
        let Some(file_row) = data
            .get("data")
            .and_then(Value::as_array)
            .and_then(|list| list.first())
        else {
            continue;
        };
        if let (Some(file_url), Some(name)) = (
            cf_file_url(file_row),
            file_row.get("fileName").and_then(Value::as_str),
        ) {
            let name = std::path::Path::new(name)
                .file_name()
                .map(|value| value.to_string_lossy().into_owned())
                .unwrap_or_else(|| "download.bin".into());
            out.push(InstallTask {
                url: file_url,
                dest: root.join(kind.folder()).join(&name),
                sha1: cf_sha1(file_row),
                size: file_row.get("fileLength").and_then(Value::as_u64).unwrap_or(0),
                alts: cf_file_alts(file_row),
                name,
            });
        }
    }
    out
}

pub async fn plan(
    kind: Kind,
    source: &str,
    id: &str,
    version_id: &str,
    game: Option<&str>,
    loader: Option<&str>,
    root: &Path,
) -> Result<ContentPlan> {
    let mut tasks = Vec::new();
    let mut deps = 0usize;
    if source == "curseforge" {
        let data = cf_json(&format!(
            "{CF}/mods/{}/files/{}",
            urlencode(id),
            urlencode(version_id)
        ))
        .await?;
        let file = data
            .get("data")
            .cloned()
            .ok_or_else(|| anyhow!("Không đọc được tệp đã chọn."))?;
        let Some(url) = cf_file_url(&file) else {
            return Err(anyhow!("Tệp này không cho tải trực tiếp."));
        };
        let name = file
            .get("fileName")
            .and_then(Value::as_str)
            .and_then(|value| std::path::Path::new(value).file_name().map(|n| n.to_string_lossy().into_owned()))
            .unwrap_or_else(|| "download.bin".into());
        tasks.push(InstallTask {
            url,
            dest: root.join(kind.folder()).join(&name),
            sha1: cf_sha1(&file),
            size: file.get("fileLength").and_then(Value::as_u64).unwrap_or(0),
            alts: cf_file_alts(&file),
            name,
        });
        let extra = cf_dependencies(&file, kind, game, loader, root).await;
        deps = extra.len();
        tasks.extend(extra);
    } else {
        let version = mr_version_detail(version_id).await?;
        let task = mr_file_task(kind, &version, root)
            .ok_or_else(|| anyhow!("Không đọc được tệp đã chọn."))?;
        tasks.push(task);
        let extra = mr_dependencies(&version, kind, game, loader, root).await;
        deps = extra.len();
        tasks.extend(extra);
    }
    let mut seen = std::collections::HashSet::new();
    tasks.retain(|task| {
        let key = task.name.to_lowercase();
        seen.insert(key)
    });
    let missing = tasks
        .iter()
        .filter(|task| !task.dest.is_file())
        .count();
    Ok(ContentPlan {
        folder: kind.folder().into(),
        tasks,
        deps,
        missing,
    })
}

pub struct InstallSummary {
    pub added: usize,
    pub existed: usize,
    pub failed: Vec<String>,
    pub total: usize,
}

pub async fn install(
    plan: &ContentPlan,
    progress: Option<ProgressFn>,
    mut on_log: impl FnMut(String),
) -> InstallSummary {
    let tasks: Vec<DownloadTask> = plan
        .tasks
        .iter()
        .map(|task| DownloadTask {
            url: task.url.clone(),
            dest: task.dest.clone(),
            sha1: task.sha1.clone(),
            size: task.size,
            skip_hash: task.sha1.is_none(),
            name: task.name.clone(),
        })
        .collect();
    let existed = plan.tasks.iter().filter(|t| t.dest.is_file()).count();
    let total = tasks.len();
    let report = crate::net::download_all(tasks, 6, progress, "content", false).await;
    let failed: Vec<String> = report
        .errors
        .iter()
        .filter_map(|(file, _)| file.file_name().map(|v| v.to_string_lossy().into_owned()))
        .collect();
    on_log(format!(
        "[XyoLauncher] Nội dung: thêm {} tệp{}{}",
        total.saturating_sub(failed.len()).saturating_sub(existed),
        if existed > 0 {
            format!(" ({existed} đã có)")
        } else {
            String::new()
        },
        if failed.is_empty() {
            String::new()
        } else {
            format!(" · lỗi {}", failed.len())
        }
    ));
    InstallSummary {
        added: total.saturating_sub(failed.len()).saturating_sub(existed),
        existed,
        failed,
        total,
    }
}

pub fn tags_modrinth(kind: Kind) -> impl std::future::Future<Output = Result<Vec<Value>>> + Send {
    let kind = kind;
    async move {
        let list = crate::net::fetch_json(&format!("{MODRINTH}/tag/category")).await?;
        Ok(list
            .as_array()
            .cloned()
            .unwrap_or_default()
            .into_iter()
            .filter(|tag| {
                tag.get("project_type").and_then(Value::as_str) == Some(kind.mr())
            })
            .map(|tag| {
                let name = tag
                    .get("name")
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .to_string();
                let slug = tag
                    .get("name")
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .to_string();
                serde_json::json!({"value": slug, "label": name})
            })
            .collect())
    }
}

pub fn env_display(env: Option<&str>) -> &'static str {
    match env {
        Some("client") => "Client",
        Some("server") => "Server",
        Some("both") => "Client + Server",
        _ => "",
    }
}

pub fn cache_icon(store: &crate::store::Store, url: &str) -> Option<PathBuf> {
    if url.is_empty() {
        return None;
    }
    use sha1::{Digest, Sha1};
    let mut hasher = Sha1::new();
    hasher.update(url.as_bytes());
    let hash = crate::util::hex(&hasher.finalize());
    let ext = url
        .split('?')
        .next()
        .and_then(|u| u.rsplit('.').next())
        .filter(|e| matches!(*e, "png" | "jpg" | "jpeg" | "webp" | "gif"))
        .unwrap_or("png");
    let dir = store.icon_cache_dir();
    let file = dir.join(format!("{hash}.{ext}"));
    if file.is_file() {
        return Some(file);
    }
    None
}

pub fn progress_percent(progress: &Progress) -> f32 {
    if progress.total_bytes > 0 {
        (progress.bytes_done as f32 / progress.total_bytes as f32 * 100.0).clamp(0.0, 100.0)
    } else if progress.total > 0 {
        (progress.done as f32 / progress.total as f32 * 100.0).clamp(0.0, 100.0)
    } else {
        0.0
    }
}
