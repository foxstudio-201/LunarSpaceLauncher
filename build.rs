fn main() {
    println!("cargo:rerun-if-changed=assets/img/icon.ico");
    if std::path::Path::new("assets/img/icon.ico").exists() {
        let mut res = winresource::WindowsResource::new();
        res.set_icon("assets/img/icon.ico");
        res.set("FileDescription", "XyoLauncher");
        res.set("ProductName", "XyoLauncher");
        res.set("LegalCopyright", "Copyright (c) 2026 XyoLauncher");
        let _ = res.compile();
    }
}
