use crate::fs_atomic::atomic_write;
use serde_json::{Map, Value};
use std::fs;
use std::path::PathBuf;
use std::sync::{LazyLock, Mutex};
use tauri::{command, AppHandle, Manager};

const STORE_FILE_NAME: &str = "lanes.json";
const STORE_KEY: &str = "laneState";

// Unico accesso a lanes.json: il frontend non apre il plugin store su questo
// file (la sua save usa fs::write). Il lock serializza le due webview e la
// scrittura passa da fs_atomic, senza finestre di troncamento del file canonico.
static LANE_STORE_LOCK: LazyLock<Mutex<()>> = LazyLock::new(|| Mutex::new(()));

fn store_path(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|directory| directory.join(STORE_FILE_NAME))
        .map_err(|error| format!("Percorso store corsie non disponibile: {error}"))
}

fn read_document(app: &AppHandle) -> Result<Option<Value>, String> {
    let path = store_path(app)?;
    if !path.exists() {
        return Ok(None);
    }
    let bytes = fs::read(&path).map_err(|error| format!("Lettura {}: {error}", path.display()))?;
    let root: Value = serde_json::from_slice(&bytes)
        .map_err(|error| format!("JSON {} non valido: {error}", path.display()))?;
    let object = root
        .as_object()
        .ok_or_else(|| format!("{} non contiene un oggetto store", path.display()))?;
    Ok(object.get(STORE_KEY).cloned())
}

#[command]
pub async fn lanes_store_read(app: AppHandle) -> Result<Option<Value>, String> {
    tokio::task::spawn_blocking(move || {
        let _guard = LANE_STORE_LOCK
            .lock()
            .map_err(|_| "Lock dello store corsie non disponibile".to_string())?;
        read_document(&app)
    })
    .await
    .map_err(|error| format!("Lettura store corsie interrotta: {error}"))?
}

#[command]
pub async fn lanes_store_write_atomic(app: AppHandle, document: Value) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        let _guard = LANE_STORE_LOCK
            .lock()
            .map_err(|_| "Lock dello store corsie non disponibile".to_string())?;
        let path = store_path(&app)?;
        let parent = path
            .parent()
            .ok_or_else(|| "Percorso store corsie senza directory".to_string())?;
        fs::create_dir_all(parent)
            .map_err(|error| format!("Creazione {}: {error}", parent.display()))?;

        let mut root = Map::new();
        root.insert(STORE_KEY.to_string(), document);
        let bytes = serde_json::to_vec_pretty(&Value::Object(root))
            .map_err(|error| format!("Serializzazione store corsie: {error}"))?;
        atomic_write(&path, &bytes)
    })
    .await
    .map_err(|error| format!("Salvataggio store corsie interrotto: {error}"))?
}
