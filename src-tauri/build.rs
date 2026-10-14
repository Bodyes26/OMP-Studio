fn main() {
    let mut attributes = tauri_build::Attributes::new();

    // tauri-build collega il manifest di Windows (Common Controls v6) solo
    // all'eseguibile: i binari di `cargo test` che toccano codice di Tauri
    // caricano comctl32 v5, che non esporta TaskDialogIndirect, e non partono
    // (STATUS_ENTRYPOINT_NOT_FOUND, tauri-apps/tauri#13419). Lo stesso
    // manifest di tauri-build si incorpora quindi dal linker in ogni artefatto.
    let target_os = std::env::var("CARGO_CFG_TARGET_OS").unwrap_or_default();
    let target_env = std::env::var("CARGO_CFG_TARGET_ENV").unwrap_or_default();
    if target_os == "windows" && target_env == "msvc" {
        attributes = attributes
            .windows_attributes(tauri_build::WindowsAttributes::new_without_app_manifest());
        let manifest = std::path::Path::new(&std::env::var("CARGO_MANIFEST_DIR").unwrap())
            .join("windows-app-manifest.xml");
        println!("cargo:rerun-if-changed={}", manifest.display());
        println!("cargo:rustc-link-arg=/MANIFEST:EMBED");
        println!("cargo:rustc-link-arg=/MANIFESTINPUT:{}", manifest.display());
    }

    tauri_build::try_build(attributes).expect("tauri-build fallito");
}
