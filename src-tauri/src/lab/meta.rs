//! Gestione dei metadati del prototipo (.lab/meta.json e .lab/preview-status.json).

use super::types::LabMeta;
use std::fs;
use std::path::Path;
use tauri::command;

/// Legge il contenuto del file `.lab/meta.json` del prototipo, se presente.
#[command]
pub async fn lab_meta_read(workspace_path: String) -> Result<Option<LabMeta>, String> {
    tokio::task::spawn_blocking(move || {
        let meta_file = Path::new(&workspace_path).join(".lab").join("meta.json");
        if !meta_file.exists() {
            return Ok(None);
        }
        let content = match fs::read_to_string(&meta_file) {
            Ok(c) => c,
            Err(_) => return Ok(None),
        };
        match serde_json::from_str::<LabMeta>(&content) {
            Ok(meta) => Ok(Some(meta)),
            Err(_) => Ok(None),
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Scrive in modo atomico lo stato di compilazione e runtime in `.lab/preview-status.json`.
#[command]
pub async fn lab_preview_status_write(
    workspace_path: String,
    status: serde_json::Value,
) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        let lab_dir = Path::new(&workspace_path).join(".lab");
        fs::create_dir_all(&lab_dir)
            .map_err(|e| format!("Creazione cartella .lab in {} fallita: {e}", lab_dir.display()))?;

        let status_path = lab_dir.join("preview-status.json");
        let bytes = serde_json::to_vec_pretty(&status)
            .map_err(|e| format!("Serializzazione preview-status fallita: {e}"))?;

        crate::fs_atomic::atomic_write(&status_path, &bytes)
    })
    .await
    .map_err(|e| e.to_string())?
}
