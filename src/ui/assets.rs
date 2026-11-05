use gpui::{AssetSource, Result, SharedString};
use std::borrow::Cow;
use std::path::{Path, PathBuf};

pub fn assets_root() -> PathBuf {
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            let candidate = dir.join("assets");
            if candidate.is_dir() {
                return candidate;
            }
        }
    }
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("assets")
}

pub struct FileAssets {
    root: PathBuf,
}

impl FileAssets {
    pub fn new() -> Self {
        Self {
            root: assets_root(),
        }
    }
}

impl AssetSource for FileAssets {
    fn load(&self, path: &str) -> Result<Option<Cow<'static, [u8]>>> {
        let file = self.root.join(path.trim_start_matches('/'));
        match std::fs::read(&file) {
            Ok(bytes) => Ok(Some(Cow::Owned(bytes))),
            Err(_) => Ok(None),
        }
    }

    fn list(&self, path: &str) -> Result<Vec<SharedString>> {
        let dir = self.root.join(path.trim_start_matches('/'));
        let Ok(entries) = std::fs::read_dir(dir) else {
            return Ok(Vec::new());
        };
        Ok(entries
            .flatten()
            .map(|entry| SharedString::from(entry.file_name().to_string_lossy().into_owned()))
            .collect())
    }
}

pub fn load_fonts(cx: &mut gpui::App) {
    let root = assets_root().join("fonts");
    let mut fonts: Vec<Cow<'static, [u8]>> = Vec::new();
    if let Ok(entries) = std::fs::read_dir(&root) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()).map(|e| e.eq_ignore_ascii_case("ttf") || e.eq_ignore_ascii_case("otf")).unwrap_or(false) {
                if let Ok(bytes) = std::fs::read(&path) {
                    fonts.push(Cow::Owned(bytes));
                }
            }
        }
    }
    if !fonts.is_empty() {
        let _ = cx.text_system().add_fonts(fonts);
    }
}

pub fn icon_path(name: &str) -> String {
    format!("icons/{name}.svg")
}

pub fn image_path(rel: &str) -> PathBuf {
    assets_root().join("img").join(rel)
}

pub fn exists(rel: &str) -> bool {
    Path::new(&assets_root().join(rel)).exists()
}
