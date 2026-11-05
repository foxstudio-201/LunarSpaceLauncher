use std::path::{Path, PathBuf};

pub fn now_iso() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

pub fn safe_name(value: &str) -> String {
    value
        .chars()
        .map(|c| {
            if c.is_alphanumeric() || c == '.' || c == '-' || c == '_' {
                c
            } else {
                '-'
            }
        })
        .collect()
}

pub fn safe_id(value: &str) -> String {
    value
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '_' || *c == '-')
        .collect()
}

pub fn strip_ansi(text: &str) -> String {
    static RE: once_cell::sync::Lazy<regex::Regex> =
        once_cell::sync::Lazy::new(|| regex::Regex::new("\u{1b}\\[[0-9;]*m").unwrap());
    RE.replace_all(text, "").to_string()
}

pub fn strip_minecraft_codes(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut chars = text.chars();
    while let Some(c) = chars.next() {
        if c == '§' {
            chars.next();
        } else {
            out.push(c);
        }
    }
    out.trim().to_string()
}

pub fn html_to_text(html: &str) -> String {
    static RE: once_cell::sync::Lazy<regex::Regex> =
        once_cell::sync::Lazy::new(|| regex::Regex::new(r"(?is)<[^>]*>").unwrap());
    let text = RE.replace_all(html, "\n");
    let text = html_escape::decode_html_entities(&text);
    text.lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .collect::<Vec<_>>()
        .join("\n")
}

pub fn markdown_to_text(md: &str) -> String {
    static LINK: once_cell::sync::Lazy<regex::Regex> =
        once_cell::sync::Lazy::new(|| regex::Regex::new(r"\[([^\]]*)\]\(([^)]*)\)").unwrap());
    static TAG: once_cell::sync::Lazy<regex::Regex> =
        once_cell::sync::Lazy::new(|| regex::Regex::new(r"(?m)^#{1,6}\s*").unwrap());
    static BOLD: once_cell::sync::Lazy<regex::Regex> =
        once_cell::sync::Lazy::new(|| regex::Regex::new(r"[*_`~]{1,3}").unwrap());
    let text = LINK.replace_all(md, "$1");
    let text = TAG.replace_all(&text, "");
    let text = BOLD.replace_all(&text, "");
    text.lines()
        .map(str::trim)
        .collect::<Vec<_>>()
        .join("\n")
        .trim()
        .to_string()
}

pub fn format_bytes(bytes: u64) -> String {
    const UNITS: [&str; 5] = ["B", "KB", "MB", "GB", "TB"];
    let mut value = bytes as f64;
    let mut unit = 0;
    while value >= 1024.0 && unit < UNITS.len() - 1 {
        value /= 1024.0;
        unit += 1;
    }
    if unit == 0 {
        format!("{} {}", bytes, UNITS[unit])
    } else {
        format!("{value:.1} {}", UNITS[unit])
    }
}

pub async fn dir_size(dir: &Path) -> u64 {
    let Ok(mut entries) = tokio::fs::read_dir(dir).await else {
        return 0;
    };
    let mut total = 0u64;
    while let Ok(Some(entry)) = entries.next_entry().await {
        let path = entry.path();
        let Ok(meta) = entry.metadata().await else { continue };
        if meta.is_dir() {
            total += Box::pin(dir_size(&path)).await;
        } else {
            total += meta.len();
        }
    }
    total
}

pub async fn sha1_file(path: &Path) -> Option<String> {
    use sha1::{Digest, Sha1};
    let data = tokio::fs::read(path).await.ok()?;
    let mut hasher = Sha1::new();
    hasher.update(&data);
    Some(hex(&hasher.finalize()))
}

pub async fn copy_dir(source: &Path, target: &Path) -> std::io::Result<()> {
    tokio::fs::create_dir_all(target).await?;
    let mut stack = vec![(source.to_path_buf(), target.to_path_buf())];
    while let Some((from, to)) = stack.pop() {
        let mut entries = tokio::fs::read_dir(&from).await?;
        while let Some(entry) = entries.next_entry().await? {
            let src = entry.path();
            let dst = to.join(entry.file_name());
            let ty = entry.file_type().await?;
            if ty.is_dir() {
                tokio::fs::create_dir_all(&dst).await?;
                stack.push((src, dst));
            } else if ty.is_file() {
                if let Some(parent) = dst.parent() {
                    tokio::fs::create_dir_all(parent).await?;
                }
                let _ = tokio::fs::copy(&src, &dst).await;
            }
        }
    }
    Ok(())
}

pub fn expand_home(value: &str) -> PathBuf {
    if let Some(rest) = value.strip_prefix("~/") {
        if let Some(home) = dirs::home_dir() {
            return home.join(rest);
        }
    }
    PathBuf::from(value)
}

pub fn hex(bytes: &[u8]) -> String {
    let mut out = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        use std::fmt::Write;
        let _ = write!(out, "{byte:02x}");
    }
    out
}

pub fn strip_json_nulls(value: &mut serde_json::Value) {
    if let Some(map) = value.as_object_mut() {
        map.retain(|_, v| !v.is_null());
        for v in map.values_mut() {
            strip_json_nulls(v);
        }
    } else if let Some(list) = value.as_array_mut() {
        for v in list {
            strip_json_nulls(v);
        }
    }
}

pub fn read_lines_tail(path: &Path, max_bytes: u64) -> std::io::Result<String> {
    use std::io::{Read, Seek, SeekFrom};
    let mut file = std::fs::File::open(path)?;
    let len = file.metadata()?.len();
    let start = len.saturating_sub(max_bytes);
    file.seek(SeekFrom::Start(start))?;
    let mut buf = Vec::new();
    file.read_to_end(&mut buf)?;
    Ok(String::from_utf8_lossy(&buf).to_string())
}
