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

/// Un panic in un salvataggio precedente avvelena il mutex ma non il file (la
/// scrittura e' atomica): si recupera il lock invece di rifiutare per sempre
/// letture e scritture dello store fino al riavvio.
fn lane_store_lock() -> std::sync::MutexGuard<'static, ()> {
    LANE_STORE_LOCK
        .lock()
        .unwrap_or_else(|poison| poison.into_inner())
}

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
        let _guard = lane_store_lock();
        read_document(&app)
    })
    .await
    .map_err(|error| format!("Lettura store corsie interrotta: {error}"))?
}

#[command]
pub async fn lanes_store_write_atomic(app: AppHandle, document: Value) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        let _guard = lane_store_lock();
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

/// Copia `lanes.json` accanto a se' prima che il frontend lo riscriva dopo aver
/// scartato record non validi: e' l'unico posto in cui quei record restano
/// recuperabili. Restituisce il percorso della copia.
fn backup_store_file(path: &std::path::Path, stamp_ms: u128) -> Result<PathBuf, String> {
    let parent = path
        .parent()
        .ok_or_else(|| "Percorso store corsie senza directory".to_string())?;
    let mut target = parent.join(format!("{STORE_FILE_NAME}.bak-{stamp_ms}"));
    let mut suffix = 1;
    // Due copie nello stesso millisecondo non devono sovrascriversi.
    while target.exists() {
        target = parent.join(format!("{STORE_FILE_NAME}.bak-{stamp_ms}-{suffix}"));
        suffix += 1;
    }
    let bytes = fs::read(path).map_err(|error| format!("Lettura {}: {error}", path.display()))?;
    atomic_write(&target, &bytes)?;
    Ok(target)
}

#[command]
pub async fn lanes_store_backup(app: AppHandle) -> Result<String, String> {
    tokio::task::spawn_blocking(move || {
        let _guard = lane_store_lock();
        let path = store_path(&app)?;
        if !path.exists() {
            return Err(format!(
                "{} non esiste: nessuna copia da fare",
                path.display()
            ));
        }
        let stamp_ms = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|elapsed| elapsed.as_millis())
            .unwrap_or(0);
        backup_store_file(&path, stamp_ms).map(|target| target.to_string_lossy().to_string())
    })
    .await
    .map_err(|error| format!("Copia store corsie interrotta: {error}"))?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn backup_copia_il_file_senza_sovrascrivere_copie_precedenti() {
        let dir = std::env::temp_dir().join(format!(
            "omp-lanes-backup-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&dir).unwrap();
        let store = dir.join(STORE_FILE_NAME);
        fs::write(&store, br#"{"laneState":{"lanes":[]}}"#).unwrap();

        let first = backup_store_file(&store, 42).unwrap();
        let second = backup_store_file(&store, 42).unwrap();
        assert_ne!(first, second);
        assert_eq!(fs::read(&first).unwrap(), fs::read(&store).unwrap());
        assert_eq!(fs::read(&second).unwrap(), fs::read(&store).unwrap());
        assert!(first
            .file_name()
            .unwrap()
            .to_string_lossy()
            .starts_with("lanes.json.bak-42"));

        fs::remove_dir_all(&dir).unwrap();
    }
}
