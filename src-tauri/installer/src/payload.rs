//! Setup NSIS incorporato e sua estrazione in una cartella temporanea.

use std::io;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

/// Setup NSIS di Tauri, incorporato da build.rs. Vuoto nelle build senza
/// OMP_INSTALLER_PAYLOAD (cargo check, clippy).
pub static PAYLOAD: &[u8] = include_bytes!(env!("OMP_INSTALLER_PAYLOAD_FILE"));

pub fn available() -> bool {
    !PAYLOAD.is_empty()
}

/// Setup estratto in una cartella propria, cancellata quando il valore esce di scena.
pub struct ExtractedSetup {
    dir: PathBuf,
    pub exe: PathBuf,
}

impl ExtractedSetup {
    pub fn new() -> io::Result<Self> {
        if !available() {
            return Err(io::Error::new(io::ErrorKind::NotFound, "setup NSIS assente"));
        }
        let nanos = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
        let dir = std::env::temp_dir().join(format!("omp-studio-setup-{}-{nanos}", std::process::id()));
        // create_dir e non create_dir_all: una cartella gia' esistente non e' nostra.
        std::fs::create_dir(&dir)?;
        let exe = dir.join("OMP Studio setup.exe");
        if let Err(error) = std::fs::write(&exe, PAYLOAD) {
            let _ = std::fs::remove_dir_all(&dir);
            return Err(error);
        }
        Ok(Self { dir, exe })
    }
}

impl Drop for ExtractedSetup {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.dir);
    }
}
