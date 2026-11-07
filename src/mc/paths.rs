use std::path::{Path, PathBuf};

#[derive(Clone, Debug)]
pub struct Paths {
    pub shared: PathBuf,
    pub meta: PathBuf,
    pub versions: PathBuf,
    pub libraries: PathBuf,
    pub assets: PathBuf,
    pub assets_indexes: PathBuf,
    pub assets_objects: PathBuf,
    pub natives: PathBuf,
    pub runtime: PathBuf,
}

impl Paths {
    pub fn new(shared: impl AsRef<Path>) -> Self {
        let shared = shared.as_ref().to_path_buf();
        let assets = shared.join("assets");
        Self {
            meta: shared.join("meta"),
            versions: shared.join("versions"),
            libraries: shared.join("libraries"),
            assets_indexes: assets.join("indexes"),
            assets_objects: assets.join("objects"),
            natives: shared.join("natives"),
            runtime: shared.join("runtime"),
            assets,
            shared,
        }
    }

    pub fn ensure(&self) -> std::io::Result<()> {
        for dir in [
            &self.shared,
            &self.meta,
            &self.versions,
            &self.libraries,
            &self.assets,
            &self.assets_indexes,
            &self.assets_objects,
            &self.natives,
            &self.runtime,
        ] {
            std::fs::create_dir_all(dir)?;
        }
        Ok(())
    }
}

#[cfg(target_os = "windows")]
pub const OS_NAME: &str = "windows";
#[cfg(target_os = "macos")]
pub const OS_NAME: &str = "osx";
#[cfg(all(unix, not(target_os = "macos")))]
pub const OS_NAME: &str = "linux";

#[cfg(target_arch = "aarch64")]
pub const OS_ARCH: &str = "arm64";
#[cfg(target_arch = "x86")]
pub const OS_ARCH: &str = "x86";
#[cfg(target_arch = "x86_64")]
pub const OS_ARCH: &str = "x86_64";

pub fn platform_key() -> &'static str {
    #[cfg(target_os = "windows")]
    {
        if cfg!(target_arch = "aarch64") {
            "windows-arm64"
        } else if cfg!(target_arch = "x86") {
            "windows-x86"
        } else {
            "windows-x64"
        }
    }
    #[cfg(target_os = "macos")]
    {
        if cfg!(target_arch = "aarch64") {
            "mac-os-arm64"
        } else {
            "mac-os"
        }
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        if cfg!(target_arch = "aarch64") {
            "linux-arm64"
        } else if cfg!(target_arch = "x86") {
            "linux-i386"
        } else {
            "linux"
        }
    }
}

pub fn java_exe() -> &'static str {
    if cfg!(windows) {
        "java.exe"
    } else {
        "java"
    }
}

pub fn maven_rel(name: &str) -> Option<String> {
    let parts: Vec<&str> = name.split(':').collect();
    if parts.len() < 3 {
        return None;
    }
    let classifier = parts.get(3).copied().unwrap_or("");
    Some(format!(
        "{}/{}/{}/{}-{}{}.jar",
        parts[0].replace('.', "/"),
        parts[1],
        parts[2],
        parts[1],
        parts[2],
        if classifier.is_empty() {
            String::new()
        } else {
            format!("-{classifier}")
        }
    ))
}
