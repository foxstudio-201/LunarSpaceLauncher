use crate::models::Instance;
use anyhow::{Context as _, Result};
use serde_json::{Value, json};
use std::io::Write;
use std::path::{Path, PathBuf};
use zip::write::SimpleFileOptions;

fn skip_dir(name: &str) -> bool {
    matches!(
        name.to_lowercase().as_str(),
        "logs" | "crash-reports" | "saves" | "screenshots" | ".git"
    )
}

fn options() -> SimpleFileOptions {
    zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated)
}

fn walk(base: &Path) -> Vec<(PathBuf, String)> {
    let mut files = Vec::new();
    let mut stack = vec![base.to_path_buf()];
    while let Some(current) = stack.pop() {
        let Ok(entries) = std::fs::read_dir(&current) else {
            continue;
        };
        for item in entries.flatten() {
            let path = item.path();
            let Ok(file_type) = item.file_type() else { continue };
            if file_type.is_symlink() {
                continue;
            }
            if file_type.is_dir() {
                if skip_dir(&item.file_name().to_string_lossy()) {
                    continue;
                }
                stack.push(path);
            } else if file_type.is_file() {
                let rel = path
                    .strip_prefix(base)
                    .map(|p| p.to_string_lossy().replace('\\', "/"))
                    .unwrap_or_default();
                if !rel.is_empty() && rel != ".lunaspace-modpack.json" {
                    files.push((path, rel));
                }
            }
        }
    }
    files.sort_by(|a, b| a.1.cmp(&b.1));
    files
}

fn add_file(zip: &mut zip::ZipWriter<std::fs::File>, name: &str, path: &Path) -> Result<()> {
    zip.start_file(name, options())?;
    let mut file = std::fs::File::open(path).with_context(|| format!("Mở {}", path.display()))?;
    std::io::copy(&mut file, zip)?;
    Ok(())
}

pub fn export(instance: &Instance, dest: &Path, format: &str) -> Result<Value> {
    if let Some(parent) = dest.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let base = Path::new(&instance.dir);
    if !base.is_dir() {
        anyhow::bail!("Thư mục instance không tồn tại.");
    }
    if format == "mrpack" {
        return export_mrpack(instance, base, dest);
    }
    let out = std::fs::File::create(dest)?;
    let mut zip = zip::ZipWriter::new(out);
    let profile = json!({
        "name": instance.name,
        "version": instance.version,
        "loader": instance.loader,
        "loaderVersion": instance.loader_version,
        "memoryMb": instance.memory_mb,
        "jvmArgs": instance.jvm_args,
        "modpack": instance.modpack,
        "exportedAt": crate::util::now_iso(),
    });
    zip.start_file("lunarspace-profile.json", options())?;
    zip.write_all(serde_json::to_string_pretty(&profile)?.as_bytes())?;
    let files = walk(base);
    let mut count = 0usize;
    for (path, rel) in &files {
        if path == dest {
            continue;
        }
        add_file(&mut zip, rel, path)?;
        count += 1;
    }
    zip.finish()?;
    let size = std::fs::metadata(dest).map(|m| m.len()).unwrap_or(0);
    Ok(json!({"path": dest.to_string_lossy(), "files": count, "size": size, "format": "zip"}))
}

fn export_mrpack(instance: &Instance, base: &Path, dest: &Path) -> Result<Value> {
    let marker = crate::mc::modpack::read_marker(base).unwrap_or(Value::Null);
    let mut index_files = Vec::new();
    let mut indexed = std::collections::HashSet::new();
    if let Some(rows) = marker.get("files").and_then(Value::as_array) {
        for row in rows {
            let Some(rel) = row.get("rel").and_then(Value::as_str) else { continue };
            let Some(url) = row.get("url").and_then(Value::as_str).filter(|url| !url.is_empty()) else {
                continue;
            };
            let Some(sha1) = row.get("sha1").and_then(Value::as_str).filter(|sha1| !sha1.is_empty()) else {
                continue;
            };
            index_files.push(json!({
                "path": rel,
                "hashes": {"sha1": sha1},
                "env": {"client": "required", "server": "required"},
                "downloads": [url],
                "fileSize": row.get("size").and_then(Value::as_u64).unwrap_or(0),
            }));
            indexed.insert(rel.to_string());
        }
    }
    let mut dependencies = serde_json::Map::new();
    dependencies.insert("minecraft".into(), Value::String(instance.version.clone()));
    if let Some(version) = instance.loader_version.as_deref().filter(|v| !v.is_empty()) {
        match instance.loader.as_str() {
            "fabric" => {
                dependencies.insert("fabric-loader".into(), Value::String(version.to_string()));
            }
            "quilt" => {
                dependencies.insert("quilt-loader".into(), Value::String(version.to_string()));
            }
            _ => {}
        }
    }
    let index = json!({
        "formatVersion": 1,
        "game": "minecraft",
        "versionId": marker.get("version").and_then(Value::as_str).unwrap_or(&instance.version),
        "name": instance.name,
        "summary": instance.modpack.as_ref().and_then(|m| m.get("name")).and_then(Value::as_str).unwrap_or(&instance.name),
        "files": index_files,
        "dependencies": dependencies,
    });
    let out = std::fs::File::create(dest)?;
    let mut zip = zip::ZipWriter::new(out);
    zip.start_file("modrinth.index.json", options())?;
    zip.write_all(serde_json::to_string_pretty(&index)?.as_bytes())?;
    let files = walk(base);
    let mut count = 0usize;
    for (path, rel) in &files {
        if indexed.contains(rel) || path == dest {
            continue;
        }
        add_file(&mut zip, &format!("overrides/{rel}"), path)?;
        count += 1;
    }
    zip.finish()?;
    let size = std::fs::metadata(dest).map(|m| m.len()).unwrap_or(0);
    Ok(json!({
        "path": dest.to_string_lossy(),
        "files": count,
        "indexed": indexed.len(),
        "size": size,
        "format": "mrpack",
    }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Read;

    fn names(path: &Path) -> Vec<String> {
        let file = std::fs::File::open(path).unwrap();
        let mut zip = zip::ZipArchive::new(file).unwrap();
        (0..zip.len())
            .filter_map(|i| zip.name_for_index(i).and_then(|n| n.ok()).map(|n| n.to_string()))
            .collect()
    }

    #[test]
    fn exports_zip_and_mrpack() {
        let root = std::env::temp_dir().join(format!("xyo-export-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(root.join("mods")).unwrap();
        std::fs::create_dir_all(root.join("config")).unwrap();
        std::fs::create_dir_all(root.join("saves").join("world")).unwrap();
        std::fs::create_dir_all(root.join("logs")).unwrap();
        std::fs::write(root.join("mods").join("a.jar"), b"jar").unwrap();
        std::fs::write(root.join("config").join("x.txt"), b"cfg").unwrap();
        std::fs::write(root.join("saves").join("world").join("level.dat"), b"lvl").unwrap();
        std::fs::write(root.join("logs").join("latest.log"), b"log").unwrap();
        let marker = json!({
            "source": "modrinth",
            "name": "Test Pack",
            "version": "1.0.0",
            "files": [{
                "rel": "mods/a.jar",
                "url": "https://cdn.modrinth.com/data/x/versions/y/a.jar",
                "sha1": "0123456789abcdef0123456789abcdef01234567",
                "size": 3
            }]
        });
        std::fs::write(root.join(".lunaspace-modpack.json"), marker.to_string()).unwrap();
        let instance = Instance {
            name: "Test Pack".into(),
            version: "1.20.1".into(),
            loader: "fabric".into(),
            loader_version: Some("0.15.0".into()),
            dir: root.to_string_lossy().into_owned(),
            ..Default::default()
        };
        let zip_path = root.join("out.zip");
        let value = export(&instance, &zip_path, "zip").unwrap();
        assert!(value.get("files").and_then(Value::as_u64).unwrap() >= 2);
        let zip_names = names(&zip_path);
        assert!(zip_names.contains(&"mods/a.jar".to_string()));
        assert!(zip_names.contains(&"config/x.txt".to_string()));
        assert!(zip_names.contains(&"lunarspace-profile.json".to_string()));
        assert!(!zip_names.iter().any(|name| name.starts_with("logs/")));
        assert!(!zip_names.iter().any(|name| name.starts_with("saves/")));

        let mr_path = root.join("out.mrpack");
        export(&instance, &mr_path, "mrpack").unwrap();
        let mr_names = names(&mr_path);
        assert!(mr_names.contains(&"modrinth.index.json".to_string()));
        assert!(mr_names.contains(&"overrides/config/x.txt".to_string()));
        assert!(!mr_names.iter().any(|name| name.starts_with("overrides/mods/")));
        let file = std::fs::File::open(&mr_path).unwrap();
        let mut zip = zip::ZipArchive::new(file).unwrap();
        let mut entry = zip.by_name("modrinth.index.json").unwrap();
        let mut text = String::new();
        entry.read_to_string(&mut text).unwrap();
        let index: Value = serde_json::from_str(&text).unwrap();
        assert_eq!(index.pointer("/files/0/path").and_then(Value::as_str), Some("mods/a.jar"));
        assert_eq!(index.pointer("/dependencies/minecraft").and_then(Value::as_str), Some("1.20.1"));
        let _ = std::fs::remove_dir_all(root);
    }
}
