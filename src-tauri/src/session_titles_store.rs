//! Titoli delle sessioni generati da Studio.
//!
//! omp non genera titoli in modalita' RPC (`PI_NO_TITLE=1`), quindi le sessioni
//! della chat grafica restano senza. Per la sessione aperta Studio invia
//! `set_session_name` e omp salva il titolo; per le sessioni chiuse non c'e'
//! modo di scriverlo in omp senza toccarne i file, quindi il titolo vive qui.
//! Nella lista vince comunque il titolo di omp, quando c'e'.

use crate::fs_atomic::atomic_write;
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::{LazyLock, Mutex};
use tauri::{command, AppHandle, Manager};

const STORE_FILE_NAME: &str = "session-titles.json";

/// I titoli generati stanno sotto i 24 caratteri: oltre e' un valore anomalo.
const TITLE_MAX_CHARS: usize = 80;

// Serializza le scritture: la lista puo' ricevere piu' titoli in rapida
// successione e due read-modify-write concorrenti perderebbero un titolo.
static STORE_LOCK: LazyLock<Mutex<()>> = LazyLock::new(|| Mutex::new(()));

fn store_path(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|directory| directory.join(STORE_FILE_NAME))
        .map_err(|error| format!("Percorso titoli sessioni non disponibile: {error}"))
}

/// Titoli per id sessione. Un file assente o illeggibile vale come vuoto: la
/// lista ripiega sul primo messaggio e i titoli si rigenerano.
pub fn load(app: &AppHandle) -> HashMap<String, String> {
    store_path(app)
        .ok()
        .and_then(|path| fs::read(path).ok())
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .unwrap_or_default()
}

#[command]
pub async fn session_title_save(
    app: AppHandle,
    session_id: String,
    title: String,
) -> Result<(), String> {
    let title: String = title.trim().chars().take(TITLE_MAX_CHARS).collect();
    if session_id.trim().is_empty() || title.is_empty() {
        return Err("Sessione o titolo mancanti".to_string());
    }
    tokio::task::spawn_blocking(move || {
        let _guard = STORE_LOCK
            .lock()
            .map_err(|_| "Lock dei titoli sessioni non disponibile".to_string())?;
        let path = store_path(&app)?;
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)
                .map_err(|error| format!("Creazione {}: {error}", parent.display()))?;
        }
        let mut titles = load(&app);
        titles.insert(session_id, title);
        let bytes = serde_json::to_vec_pretty(&titles)
            .map_err(|error| format!("Serializzazione titoli sessioni: {error}"))?;
        atomic_write(&path, &bytes)
    })
    .await
    .map_err(|error| format!("Salvataggio titolo sessione interrotto: {error}"))?
}
