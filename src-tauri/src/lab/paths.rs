//! Gestione percorsi per il Laboratorio prototipi.
//!
//! Risolve e memorizza la radice del Laboratorio all'avvio dell'applicazione
//! (`app_local_data_dir()/lab`). Espone funzioni di utilita' per recuperare
//! la radice, l'indice globale delle bozze e i percorsi dei workspace.

use super::types::LabPaths;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;
use tauri::command;

static LAB_ROOT: OnceLock<PathBuf> = OnceLock::new();

/// Inizializza la radice del Laboratorio a partire dalla directory locale dell'app.
pub fn init(app_local_data_dir: PathBuf) {
    let lab_dir = app_local_data_dir.join("lab");
    let _ = LAB_ROOT.set(lab_dir);
}

/// Radice globale del Laboratorio (`<app_local_data_dir>/lab`).
/// Se non ancora inizializzata da Tauri, tenta un fallback sulle variabili d'ambiente.
pub fn lab_root() -> Option<PathBuf> {
    if let Some(root) = LAB_ROOT.get() {
        return Some(root.clone());
    }
    #[cfg(target_os = "windows")]
    if let Ok(local) = std::env::var("LOCALAPPDATA") {
        return Some(PathBuf::from(local).join("omp-studio").join("lab"));
    }
    #[cfg(not(target_os = "windows"))]
    if let Ok(home) = std::env::var("HOME") {
        return Some(
            PathBuf::from(home)
                .join(".local")
                .join("share")
                .join("omp-studio")
                .join("lab"),
        );
    }
    None
}

/// Percorso dell'indice globale delle bozze (`<lab_root>/drafts/prototypes.json`).
pub fn drafts_index_path() -> Option<PathBuf> {
    lab_root().map(|root| root.join("drafts").join("prototypes.json"))
}

/// Risolve il percorso canonico della radice del progetto.
pub fn canonical_project_path(project_path: &Path) -> PathBuf {
    project_path
        .canonicalize()
        .unwrap_or_else(|_| project_path.to_path_buf())
}

/// Percorso dell'indice di progetto (`<canonicalProjectPath>/.omp/lab/prototypes.json`).
pub fn project_index_path(project_path: &Path) -> PathBuf {
    canonical_project_path(project_path)
        .join(".omp")
        .join("lab")
        .join("prototypes.json")
}

/// Percorso del workspace per un prototipo (`<lab_root>/prototypes/<id>`).
pub fn prototype_workspace_path(id: &str) -> Option<PathBuf> {
    lab_root().map(|root| root.join("prototypes").join(id))
}

/// Ritorna la radice dei dati del Laboratorio e il percorso dell'indice bozze globale.
#[command]
pub async fn lab_paths() -> Result<LabPaths, String> {
    let root = lab_root().ok_or_else(|| "Radice del Laboratorio non disponibile".to_string())?;
    let drafts_index = drafts_index_path()
        .ok_or_else(|| "Percorso indice bozze non disponibile".to_string())?;
    Ok(LabPaths {
        root: root.to_string_lossy().to_string(),
        drafts_index: drafts_index.to_string_lossy().to_string(),
    })
}
