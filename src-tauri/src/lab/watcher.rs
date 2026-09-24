//! Watcher del workspace per l'anteprima del Laboratorio.
//!
//! Ascolta ricorsivamente le modifiche nel workspace escludendo `.git`, `.lab`,
//! `node_modules` e `dist`. Applica un debounce di 150 ms ed emette l'evento
//! Tauri `lab://changed` con payload `{ key, paths }`.

use super::types::LabChangedEvent;
use notify::{Config, Event, RecommendedWatcher, RecursiveMode, Watcher};
use parking_lot::Mutex;
use std::collections::{HashMap, HashSet};
use std::path::{Component, Path, PathBuf};
use std::sync::LazyLock;
use std::time::Duration;
use tauri::{command, AppHandle, Emitter};

struct WatcherHandle {
    _watcher: RecommendedWatcher,
    _task: tokio::task::JoinHandle<()>,
    stop_tx: Option<tokio::sync::oneshot::Sender<()>>,
}

impl Drop for WatcherHandle {
    fn drop(&mut self) {
        if let Some(tx) = self.stop_tx.take() {
            let _ = tx.send(());
        }
        self._task.abort();
    }
}

static ACTIVE_WATCHERS: LazyLock<Mutex<HashMap<String, WatcherHandle>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

/// Verifica se un percorso fa parte delle directory da ignorare.
fn is_ignored_path(path: &Path) -> bool {
    for comp in path.components() {
        if let Component::Normal(os_str) = comp {
            if let Some(s) = os_str.to_str() {
                if s == ".git" || s == ".lab" || s == "node_modules" || s == "dist" {
                    return true;
                }
            }
        }
    }
    false
}

/// Avvia l'ascolto ricorsivo delle modifiche nel workspace specificato.
/// Se esiste gia' un watcher con la stessa chiave, lo sostituisce.
#[command]
pub async fn lab_watch_start(
    app: AppHandle,
    workspace_path: String,
    key: String,
) -> Result<(), String> {
    // Interrompi eventuale watcher precedente per la stessa chiave
    lab_watch_stop(key.clone()).await?;

    let ws_path = PathBuf::from(&workspace_path);
    if !ws_path.is_dir() {
        return Err(format!(
            "Cartella workspace non valida per il watcher: {}",
            ws_path.display()
        ));
    }

    let canonical_ws = ws_path.canonicalize().unwrap_or_else(|_| ws_path.clone());
    let (tx_events, mut rx_events) = tokio::sync::mpsc::unbounded_channel::<Vec<String>>();
    let (stop_tx, mut stop_rx) = tokio::sync::oneshot::channel::<()>();

    let canonical_for_cb = canonical_ws.clone();
    let raw_for_cb = ws_path.clone();

    let mut watcher = RecommendedWatcher::new(
        move |res: Result<Event, notify::Error>| {
            if let Ok(event) = res {
                let mut valid_paths = Vec::new();
                for p in event.paths {
                    if is_ignored_path(&p) {
                        continue;
                    }
                    let rel = p
                        .strip_prefix(&canonical_for_cb)
                        .or_else(|_| p.strip_prefix(&raw_for_cb))
                        .map(|rel| rel.to_string_lossy().replace('\\', "/"))
                        .unwrap_or_else(|_| p.to_string_lossy().replace('\\', "/"));

                    if !rel.is_empty() {
                        valid_paths.push(rel);
                    }
                }
                if !valid_paths.is_empty() {
                    let _ = tx_events.send(valid_paths);
                }
            }
        },
        Config::default(),
    )
    .map_err(|e| format!("Inizializzazione watcher fallita: {e}"))?;

    watcher
        .watch(&ws_path, RecursiveMode::Recursive)
        .map_err(|e| format!("Avvio watch su {} fallito: {e}", ws_path.display()))?;

    let key_clone = key.clone();
    let task = tokio::spawn(async move {
        let mut pending_paths: HashSet<String> = HashSet::new();

        loop {
            tokio::select! {
                _ = &mut stop_rx => {
                    break;
                }
                msg = rx_events.recv() => {
                    match msg {
                        Some(paths) => {
                            for p in paths {
                                pending_paths.insert(p);
                            }

                            // Debounce di 150 ms
                            loop {
                                tokio::select! {
                                    _ = &mut stop_rx => {
                                        return;
                                    }
                                    more = tokio::time::timeout(Duration::from_millis(150), rx_events.recv()) => {
                                        match more {
                                            Ok(Some(paths)) => {
                                                for p in paths {
                                                    pending_paths.insert(p);
                                                }
                                            }
                                            _ => {
                                                // 150 ms di inattivita': emetti le modifiche accumulate
                                                break;
                                            }
                                        }
                                    }
                                }
                            }

                            if !pending_paths.is_empty() {
                                let mut sorted_paths: Vec<String> = pending_paths.drain().collect();
                                sorted_paths.sort();
                                let payload = LabChangedEvent {
                                    key: key_clone.clone(),
                                    paths: sorted_paths,
                                };
                                let _ = app.emit("lab://changed", &payload);
                            }
                        }
                        None => break,
                    }
                }
            }
        }
    });

    let handle = WatcherHandle {
        _watcher: watcher,
        _task: task,
        stop_tx: Some(stop_tx),
    };

    ACTIVE_WATCHERS.lock().insert(key, handle);
    Ok(())
}

/// Ferma il watcher associato a `key`.
#[command]
pub async fn lab_watch_stop(key: String) -> Result<(), String> {
    let mut watchers = ACTIVE_WATCHERS.lock();
    watchers.remove(&key);
    Ok(())
}
