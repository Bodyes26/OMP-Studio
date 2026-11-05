//! Ponte omp -> Studio per le anteprime dei prototipi UI (vibecoding).
//!
//! L'estensione `studio_preview` (caricata con `-e` nelle sessioni lanciate
//! da Studio) scrive un file JSON per ogni prototipo generato in
//! `%LOCALAPPDATA%/omp-studio/previews`. Questo modulo osserva la cartella,
//! legge i nuovi file e li inoltra al frontend con l'evento `preview://new`:
//! la colonna centrale apre l'anteprima sandbox interattiva (per file SVG
//! il rendering e' completamente isolato con sandbox restrittivo privo di script).

use std::path::{Path, PathBuf};
use std::time::Duration;

use notify::{RecursiveMode, Watcher};
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};

/// Cartella di scambio condivisa con l'estensione.
pub fn previews_dir() -> Option<PathBuf> {
    if cfg!(target_os = "windows") {
        let local = std::env::var("LOCALAPPDATA").ok()?;
        Some(PathBuf::from(local).join("omp-studio").join("previews"))
    } else {
        let home = std::env::var("HOME").ok()?;
        Some(PathBuf::from(home).join(".omp-studio").join("previews"))
    }
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
pub struct PreviewPayload {
    pub id: String,
    pub title: String,
    pub file_path: String,
    pub cwd: String,
    pub session_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub lane_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub project_id: Option<String>,
    #[serde(default)]
    pub snapshot: bool,
}

fn read_preview(path: &std::path::Path) -> Option<PreviewPayload> {
    let text = std::fs::read_to_string(path).ok()?;
    let value: serde_json::Value = serde_json::from_str(&text).ok()?;
    let id = value.get("id")?.as_str()?.to_string();
    let title = value
        .get("title")
        .and_then(|v| v.as_str())
        .unwrap_or("Prototipo")
        .to_string();
    let file_path = value
        .get("file_path")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    if file_path.trim().is_empty() {
        return None;
    }
    let cwd = value
        .get("cwd")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let session_id = value
        .get("session_id")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let lane_id = value
        .get("lane_id")
        .or_else(|| value.get("laneId"))
        .and_then(|v| v.as_str())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());
    let project_id = value
        .get("project_id")
        .or_else(|| value.get("projectId"))
        .and_then(|v| v.as_str())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());
    let snapshot = value
        .get("snapshot")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    Some(PreviewPayload {
        id,
        title,
        file_path,
        cwd,
        session_id,
        lane_id,
        project_id,
        snapshot,
    })
}

pub struct PreviewWatcherState {
    last_seen: Mutex<Option<(PathBuf, u64)>>,
}

impl PreviewWatcherState {
    pub fn new() -> Self {
        Self {
            last_seen: Mutex::new(None),
        }
    }
}

/// JSON di anteprima piu' recente nella cartella di scambio, con il suo mtime in ms.
fn newest_preview(dir: &std::path::Path) -> Option<(PathBuf, u64)> {
    let entries = std::fs::read_dir(dir).ok()?;
    let mut newest: Option<(PathBuf, u64)> = None;
    for entry in entries.flatten() {
        let path = entry.path();
        let file_name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
        if file_name.starts_with('.') || file_name.ends_with(".ack.json") {
            continue;
        }
        if path.extension().and_then(|e| e.to_str()) != Some("json") {
            continue;
        }
        let Ok(meta) = entry.metadata() else { continue };
        let Ok(modified) = meta.modified() else {
            continue;
        };
        let stamp = modified
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0);
        if newest.as_ref().map(|(_, t)| stamp > *t).unwrap_or(true) {
            newest = Some((path, stamp));
        }
    }
    newest
}

/// Anteprima da inoltrare: la piu' recente, se non e' gia' stata vista.
fn pending_preview(state: &PreviewWatcherState, dir: &std::path::Path) -> Option<(PathBuf, u64)> {
    let (path, stamp) = newest_preview(dir)?;
    if let Some((last_path, last_stamp)) = state.last_seen.lock().as_ref() {
        if *last_path == path && *last_stamp >= stamp {
            return None;
        }
    }
    Some((path, stamp))
}

fn scan_and_emit(app: &AppHandle, state: &PreviewWatcherState) {
    let started = std::time::Instant::now();
    let Some(dir) = previews_dir() else { return };
    let Some((path, stamp)) = pending_preview(state, &dir) else {
        return;
    };
    if let Some(payload) = read_preview(&path) {
        let _ = app.emit("preview://new", &payload);
        *state.last_seen.lock() = Some((path, stamp));
        crate::perf_trace::record("watch", "previews scan", started.elapsed());
    }
}

fn setup_previews_watcher(
    dir: &std::path::Path,
    tx: std::sync::mpsc::Sender<()>,
) -> (Option<notify::RecommendedWatcher>, bool) {
    let Ok(mut watcher) = notify::recommended_watcher(move |_res| {
        let _ = tx.send(());
    }) else {
        return (None, false);
    };

    // Se la cartella `previews` esiste, la osserviamo direttamente in modalita' non ricorsiva:
    // `newest_preview` legge solo i file diretti senza scendere in sottocartelle (PERF-14).
    if dir.exists() && watcher.watch(dir, RecursiveMode::NonRecursive).is_ok() {
        return (Some(watcher), true);
    }

    // Se la cartella non esiste ancora, osserviamo il genitore (~/.omp-studio)
    // in modo NON ricorsivo solo per accorgerci di quando la cartella viene creata,
    // per poi passare a osservare direttamente il target.
    if let Some(parent) = dir.parent() {
        if parent.exists() && watcher.watch(parent, RecursiveMode::NonRecursive).is_ok() {
            return (Some(watcher), false);
        }
    }

    if watcher.watch(dir, RecursiveMode::NonRecursive).is_ok() {
        return (Some(watcher), true);
    }

    (None, false)
}

/// Avvia il watcher dei prototipi all'avvio dell'app. Un thread a eventi con
/// debounce di 150 ms e controllo di sicurezza ogni 60 s (PERF-14): nessun polling a 2 Hz.
pub fn spawn_watcher(app: AppHandle) {
    std::thread::spawn(move || {
        let state = PreviewWatcherState::new();

        let Some(dir) = previews_dir() else { return };
        let _ = std::fs::create_dir_all(&dir);

        // I JSON rimasti da sessioni precedenti non vanno riproposti a ogni
        // avvio: puntano spesso a file ormai spariti e riaprirebbero
        // un'anteprima vuota che l'utente ha gia' chiuso. Si mostrano solo
        // le anteprime prodotte dopo l'avvio.
        *state.last_seen.lock() = newest_preview(&dir);

        let (tx, rx) = std::sync::mpsc::channel();
        let (mut watcher, mut watching_target) = setup_previews_watcher(&dir, tx.clone());

        loop {
            // Timeout allungato a 60 s per ridurre i risvegli periodici a riposo (PERF-14).
            match rx.recv_timeout(Duration::from_secs(60)) {
                Ok(()) => {
                    // Debounce di 150 ms per raggruppare scritture rapide dello stesso file
                    std::thread::sleep(Duration::from_millis(150));
                    while rx.try_recv().is_ok() {}

                    // Se stavamo osservando il genitore in attesa della creazione della cartella,
                    // passiamo a osservare direttamente il target non appena esiste.
                    if !watching_target && dir.exists() {
                        let (new_watcher, target) = setup_previews_watcher(&dir, tx.clone());
                        if new_watcher.is_some() {
                            watcher = new_watcher;
                            watching_target = target;
                        }
                    }

                    scan_and_emit(&app, &state);
                }
                Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {
                    // Rescan di sicurezza periodico ogni 60 s (PERF-14)
                    if !dir.exists() || watcher.is_none() || !watching_target {
                        let _ = std::fs::create_dir_all(&dir);
                        let (new_watcher, target) = setup_previews_watcher(&dir, tx.clone());
                        if new_watcher.is_some() {
                            watcher = new_watcher;
                            watching_target = target;
                        }
                    }
                    scan_and_emit(&app, &state);
                }
                Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => {
                    break;
                }
            }
        }
    });
}

/// Scrive atomicamente il file di ack `<id>.ack.json` nella cartella previews.
/// Valida il charset dell'identificatore per prevenire directory traversal.
fn studio_preview_ack_sync(id: String, ack: serde_json::Value) -> Result<(), String> {
    let clean_id = id.trim();
    if clean_id.is_empty() || clean_id.len() > 128 {
        return Err("Identificatore preview non valido o troppo lungo".to_string());
    }
    if !clean_id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_') {
        return Err("Identificatore preview contiene caratteri non ammessi".to_string());
    }

    let Some(dir) = previews_dir() else {
        return Err("Impossibile risolvere la cartella delle anteprime".to_string());
    };
    if let Err(e) = std::fs::create_dir_all(&dir) {
        return Err(format!("Impossibile creare la cartella delle anteprime: {e}"));
    }
    // Un ack arrivato dopo che lo strumento ha smesso di attenderlo non verrebbe mai letto:
    // si eliminano qui gli ack orfani, cosi' la cartella non cresce senza limite.
    prune_stale_acks(&dir);

    let ack_file = dir.join(format!("{clean_id}.ack.json"));
    let tmp_file = dir.join(format!(
        ".{clean_id}.ack.json.tmp.{}.{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0)
    ));

    let json_bytes = serde_json::to_vec_pretty(&ack)
        .map_err(|e| format!("Serializzazione ack fallita: {e}"))?;

    std::fs::write(&tmp_file, &json_bytes)
        .map_err(|e| format!("Scrittura file temporaneo fallita: {e}"))?;

    if let Err(err) = std::fs::rename(&tmp_file, &ack_file) {
        let _ = std::fs::remove_file(&ack_file);
        if let Err(e) = std::fs::rename(&tmp_file, &ack_file) {
            let _ = std::fs::remove_file(&tmp_file);
            return Err(format!("Rinomina file ack fallita: {e} (tentativo iniziale: {err})"));
        }
    }

    Ok(())
}

/// Scrive atomicamente il file di ack `<id>.ack.json` nella cartella previews.
/// Sposta l'I/O su thread pool con spawn_blocking per non bloccare l'event loop Tauri.
#[tauri::command]
pub async fn studio_preview_ack(id: String, ack: serde_json::Value) -> Result<(), String> {
    tokio::task::spawn_blocking(move || studio_preview_ack_sync(id, ack))
        .await
        .map_err(|e| format!("Task studio_preview_ack fallito: {e}"))?
}

fn prune_stale_acks(dir: &Path) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    let max_age = std::time::Duration::from_secs(600);
    for entry in entries.flatten() {
        let path = entry.path();
        let is_ack = path
            .file_name()
            .and_then(|n| n.to_str())
            .is_some_and(|n| n.ends_with(".ack.json"));
        if !is_ack {
            continue;
        }
        let stale = entry
            .metadata()
            .and_then(|m| m.modified())
            .ok()
            .and_then(|t| t.elapsed().ok())
            .is_some_and(|age| age > max_age);
        if stale {
            let _ = std::fs::remove_file(&path);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_read_preview_with_lane_and_project_id() {
        let dir = std::env::temp_dir().join(format!("omp-test-prev-1-{}", std::process::id()));
        let _ = std::fs::create_dir_all(&dir);
        let path = dir.join("test_preview.json");
        let content = serde_json::json!({
            "id": "prev-123",
            "title": "Card Widget",
            "file_path": "proto/card-widget.html",
            "cwd": "C:/repos/portalino",
            "session_id": "sess-456",
            "lane_id": "lane-worktree-1",
            "project_id": "proj-1"
        });
        std::fs::write(&path, content.to_string()).unwrap();
        let payload = read_preview(&path).expect("lettura preview fallita");
        assert_eq!(payload.id, "prev-123");
        assert_eq!(payload.title, "Card Widget");
        assert_eq!(payload.file_path, "proto/card-widget.html");
        assert_eq!(payload.cwd, "C:/repos/portalino");
        assert_eq!(payload.session_id, "sess-456");
        assert_eq!(payload.lane_id, Some("lane-worktree-1".to_string()));
        assert_eq!(payload.project_id, Some("proj-1".to_string()));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn test_read_preview_supports_camel_case_identifiers() {
        let dir = std::env::temp_dir().join(format!("omp-test-prev-2-{}", std::process::id()));
        let _ = std::fs::create_dir_all(&dir);
        let path = dir.join("test_preview_camel.json");
        let content = serde_json::json!({
            "id": "prev-camel",
            "title": "Card Camel",
            "file_path": "proto/camel.html",
            "cwd": "C:/repos/.omp-wt-portalino-lane",
            "session_id": "sess-789",
            "laneId": "wt-ui",
            "projectId": "proj-ui"
        });
        std::fs::write(&path, content.to_string()).unwrap();
        let payload = read_preview(&path).expect("lettura preview fallita");
        assert_eq!(payload.lane_id, Some("wt-ui".to_string()));
        assert_eq!(payload.project_id, Some("proj-ui".to_string()));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn test_read_preview_legacy_without_lane_fields() {
        let dir = std::env::temp_dir().join(format!("omp-test-prev-3-{}", std::process::id()));
        let _ = std::fs::create_dir_all(&dir);
        let path = dir.join("test_preview_legacy.json");
        let content = serde_json::json!({
            "id": "prev-legacy",
            "title": "Legacy Preview",
            "file_path": "proto/legacy.html",
            "cwd": "C:/repos/portalino",
            "session_id": "sess-legacy"
        });
        std::fs::write(&path, content.to_string()).unwrap();
        let payload = read_preview(&path).expect("lettura preview legacy fallita");
        assert_eq!(payload.lane_id, None);
        assert_eq!(payload.project_id, None);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn test_startup_seed_skips_old_previews_but_emits_new_ones() {
        let dir = std::env::temp_dir().join(format!("omp-test-prev-4-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let base = std::time::SystemTime::now() - Duration::from_secs(60);
        let old = dir.join("old.json");
        std::fs::write(&old, "{}").unwrap();
        std::fs::File::options()
            .write(true)
            .open(&old)
            .unwrap()
            .set_modified(base)
            .unwrap();

        // Stato come dopo l'avvio: l'anteprima preesistente non va riemessa.
        let state = PreviewWatcherState::new();
        *state.last_seen.lock() = newest_preview(&dir);
        assert!(pending_preview(&state, &dir).is_none());

        // Un'anteprima prodotta dopo l'avvio va invece inoltrata.
        let new = dir.join("new.json");
        std::fs::write(&new, "{}").unwrap();
        std::fs::File::options()
            .write(true)
            .open(&new)
            .unwrap()
            .set_modified(base + Duration::from_secs(30))
            .unwrap();
        let (path, _) = pending_preview(&state, &dir).expect("nuova anteprima non rilevata");
        assert_eq!(path, new);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn test_read_preview_with_snapshot() {
        let dir = std::env::temp_dir().join(format!("omp-test-prev-snap-{}", std::process::id()));
        let _ = std::fs::create_dir_all(&dir);
        let path = dir.join("test_preview_snap.json");
        let content = serde_json::json!({
            "id": "prev-snap",
            "title": "Snap Card",
            "file_path": "proto/snap.html",
            "cwd": "C:/repos/portalino",
            "session_id": "sess-snap",
            "snapshot": true
        });
        std::fs::write(&path, content.to_string()).unwrap();
        let payload = read_preview(&path).expect("lettura preview snapshot fallita");
        assert!(payload.snapshot);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn test_newest_preview_ignores_ack_and_hidden_files() {
        let dir = std::env::temp_dir().join(format!("omp-test-prev-ack-{}", std::process::id()));
        let _ = std::fs::create_dir_all(&dir);
        let ack_file = dir.join("test1.ack.json");
        std::fs::write(&ack_file, "{}").unwrap();
        let tmp_file = dir.join(".tmp_preview.json");
        std::fs::write(&tmp_file, "{}").unwrap();
        assert!(newest_preview(&dir).is_none());

        let valid = dir.join("real.json");
        std::fs::write(&valid, "{}").unwrap();
        let (path, _) = newest_preview(&dir).expect("real.json deve essere trovato");
        assert_eq!(path, valid);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn test_studio_preview_ack_id_validation() {
        assert!(studio_preview_ack_sync("".to_string(), serde_json::json!({})).is_err());
        assert!(studio_preview_ack_sync("../bad_id".to_string(), serde_json::json!({})).is_err());
        assert!(studio_preview_ack_sync("bad id with spaces".to_string(), serde_json::json!({})).is_err());
    }
}
