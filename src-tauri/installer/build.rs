use std::path::PathBuf;

fn main() {
    // Il setup NSIS si incorpora per percorso (include_bytes! in src/payload.rs),
    // senza copiarlo. Senza OMP_INSTALLER_PAYLOAD (cargo check, clippy) si
    // incorpora un file vuoto e l'installer lo segnala all'avvio invece di
    // installare: la build di pubblicazione passa sempre il setup vero.
    println!("cargo:rerun-if-env-changed=OMP_INSTALLER_PAYLOAD");
    let payload = match std::env::var_os("OMP_INSTALLER_PAYLOAD") {
        Some(path) => {
            let path = std::fs::canonicalize(PathBuf::from(path))
                .expect("OMP_INSTALLER_PAYLOAD non punta a un file esistente");
            println!("cargo:rerun-if-changed={}", path.display());
            path
        }
        None => {
            let empty = PathBuf::from(std::env::var("OUT_DIR").unwrap()).join("payload-vuoto.exe");
            std::fs::write(&empty, []).expect("payload vuoto non scrivibile");
            empty
        }
    };
    println!("cargo:rustc-env=OMP_INSTALLER_PAYLOAD_FILE={}", payload.display());

    tauri_build::build();
}
