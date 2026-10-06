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

/// Identificatore dell'app (`identifier` in tauri.conf.json): Tauri lo usa come nome
/// della cartella di `app_local_data_dir`.
const APP_IDENTIFIER: &str = "sh.omp.studio";

/// Radice globale del Laboratorio (`<app_local_data_dir>/lab`).
/// Se non ancora inizializzata da Tauri, ricostruisce lo stesso percorso che
/// restituirebbe `app_local_data_dir`: un fallback diverso (prima `omp-studio`)
/// faceva finire i prototipi in una seconda cartella che l'app poi non vedeva.
pub fn lab_root() -> Option<PathBuf> {
    if let Some(root) = LAB_ROOT.get() {
        return Some(root.clone());
    }
    fallback_local_data_dir().map(|dir| dir.join("lab"))
}

/// `%LOCALAPPDATA%\sh.omp.studio` su Windows.
#[cfg(target_os = "windows")]
fn fallback_local_data_dir() -> Option<PathBuf> {
    std::env::var_os("LOCALAPPDATA").map(|local| PathBuf::from(local).join(APP_IDENTIFIER))
}

/// `~/Library/Application Support/sh.omp.studio` su macOS.
#[cfg(target_os = "macos")]
fn fallback_local_data_dir() -> Option<PathBuf> {
    std::env::var_os("HOME").map(|home| {
        PathBuf::from(home)
            .join("Library")
            .join("Application Support")
            .join(APP_IDENTIFIER)
    })
}

/// `$XDG_DATA_HOME/sh.omp.studio`, altrimenti `~/.local/share/sh.omp.studio`.
#[cfg(all(not(target_os = "windows"), not(target_os = "macos")))]
fn fallback_local_data_dir() -> Option<PathBuf> {
    std::env::var_os("XDG_DATA_HOME")
        .map(PathBuf::from)
        .filter(|dir| dir.is_absolute())
        .or_else(|| {
            std::env::var_os("HOME").map(|home| PathBuf::from(home).join(".local").join("share"))
        })
        .map(|dir| dir.join(APP_IDENTIFIER))
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
    let drafts_index =
        drafts_index_path().ok_or_else(|| "Percorso indice bozze non disponibile".to_string())?;
    Ok(LabPaths {
        root: root.to_string_lossy().to_string(),
        drafts_index: drafts_index.to_string_lossy().to_string(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn identificatore_allineato_a_tauri_conf() {
        let conf: serde_json::Value =
            serde_json::from_str(include_str!("../../tauri.conf.json")).unwrap();
        assert_eq!(conf["identifier"].as_str(), Some(APP_IDENTIFIER));
    }

    #[test]
    fn fallback_usa_la_cartella_dell_identificatore() {
        if let Some(dir) = fallback_local_data_dir() {
            assert!(dir.ends_with(APP_IDENTIFIER), "{}", dir.display());
        }
    }
}
