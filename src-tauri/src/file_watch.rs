//! File watcher per i file aperti nell'editor (EXT-011).
//!
//! Supporta piu' superfici/proprietari concorrenti (es. Editor principale, companion,
//! laboratorio, split) unendo i percorsi da osservare nel backend.
//! Osserva le cartelle padre con `RecursiveMode::NonRecursive` e filtra per percorso,
//! sopravvivendo ai salvataggi atomici con rename di molti editor esterni.
//! Applica un debounce di ~200 ms prima di notificare il frontend con `studio://file-changed`.

use notify::{Config, Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::LazyLock;
use std::time::Duration;
use tauri::{command, AppHandle, Emitter};

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FileChangedPayload {
    pub path: String,
}

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

struct WatcherState {
    owners: HashMap<String, Vec<String>>,
    active_handle: Option<WatcherHandle>,
}

static WATCHER_STATE: LazyLock<Mutex<WatcherState>> = LazyLock::new(|| {
    Mutex::new(WatcherState {
        owners: HashMap::new(),
        active_handle: None,
    })
});

/// Unisce i percorsi di tutti gli owner registrati rimuovendo eventuali duplicati.
pub fn union_owner_paths(owners: &HashMap<String, Vec<String>>) -> Vec<String> {
    let mut union = Vec::new();
    let mut seen = HashSet::new();
    for paths in owners.values() {
        for p in paths {
            if seen.insert(p.clone()) {
                union.push(p.clone());
            }
        }
    }
    union
}

/// Rimuove l'eventuale prefisso UNC di Windows (`\\?\`) dal percorso canonico.
pub fn strip_unc_prefix(path: &Path) -> PathBuf {
    let s = path.to_string_lossy();
    if let Some(stripped) = s.strip_prefix(r"\\?\") {
        PathBuf::from(stripped)
    } else {
        path.to_path_buf()
    }
}

/// Normalizza un percorso per il confronto cross-platform.
/// Converte i separatori in '/' ed elimina eventuali slash finali.
/// Su Windows converte in minuscolo per confronto case-insensitive.
pub fn normalize_for_compare(path: &Path) -> String {
    let clean = strip_unc_prefix(path);
    let mut s = clean.to_string_lossy().replace('\\', "/");
    while s.len() > 1 && s.ends_with('/') {
        s.pop();
    }
    #[cfg(target_os = "windows")]
    {
        s = s.to_lowercase();
    }
    s
}

/// Determina se l'evento notificato da notify corrisponde a una mutazione del contenuto o del nome.
pub fn is_change_event(kind: &EventKind) -> bool {
    match kind {
        EventKind::Access(_) => false,
        EventKind::Create(_) | EventKind::Modify(_) | EventKind::Remove(_) | EventKind::Any => true,
        EventKind::Other => true,
    }
}

/// Confronta i percorsi dell'evento con la mappa di lookup e restituisce i percorsi originali corrispondenti.
pub fn filter_matching_paths(
    event_paths: &[PathBuf],
    lookup: &HashMap<String, String>,
) -> Vec<String> {
    let mut matched = Vec::new();
    let mut seen = HashSet::new();
    for p in event_paths {
        let norm = normalize_for_compare(p);
        if let Some(orig) = lookup.get(&norm) {
            if seen.insert(orig.clone()) {
                matched.push(orig.clone());
            }
        }
        let clean = strip_unc_prefix(p);
        let norm_clean = normalize_for_compare(&clean);
        if let Some(orig) = lookup.get(&norm_clean) {
            if seen.insert(orig.clone()) {
                matched.push(orig.clone());
            }
        }
    }
    matched
}

/// Ricostruisce il RecommendedWatcher sulle cartelle genitore dell'unione dei percorsi osservati.
fn rebuild_watcher(app: &AppHandle, all_paths: Vec<String>) -> Result<(), String> {
    let mut state = WATCHER_STATE.lock();
    // Interrompe e rilascia il watcher precedente
    state.active_handle = None;

    if all_paths.is_empty() {
        return Ok(());
    }

    let mut lookup = HashMap::new();
    let mut parent_dirs = HashSet::new();

    for raw in &all_paths {
        let p = Path::new(raw);
        let norm_raw = normalize_for_compare(p);
        lookup.insert(norm_raw, raw.clone());

        if let Ok(canon) = p.canonicalize() {
            let norm_canon = normalize_for_compare(&canon);
            lookup.insert(norm_canon, raw.clone());
        }

        if let Some(parent) = p.parent() {
            if !parent.as_os_str().is_empty() {
                if let Ok(canon_parent) = parent.canonicalize() {
                    parent_dirs.insert(canon_parent);
                }
                parent_dirs.insert(parent.to_path_buf());
            }
        }
    }

    let (tx_events, mut rx_events) = tokio::sync::mpsc::unbounded_channel::<Vec<String>>();
    let (stop_tx, mut stop_rx) = tokio::sync::oneshot::channel::<()>();

    let lookup_cb = lookup.clone();
    let mut watcher = RecommendedWatcher::new(
        move |res: Result<Event, notify::Error>| {
            if let Ok(event) = res {
                if !is_change_event(&event.kind) {
                    return;
                }
                let matched = filter_matching_paths(&event.paths, &lookup_cb);
                if !matched.is_empty() {
                    let _ = tx_events.send(matched);
                }
            }
        },
        Config::default(),
    )
    .map_err(|e| {
        crate::tr!(
            format!("Inizializzazione file watcher fallita: {e}"),
            format!("File watcher initialization failed: {e}")
        )
    })?;

    for dir in &parent_dirs {
        if dir.is_dir() {
            // Osservazione NonRecursive della cartella padre: sopravvive a rename-over atomici
            let _ = watcher.watch(dir, RecursiveMode::NonRecursive);
        }
    }

    let app_handle = app.clone();
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

                            // Debounce di 200 ms per accumulare scritture multiple
                            loop {
                                tokio::select! {
                                    _ = &mut stop_rx => {
                                        return;
                                    }
                                    more = tokio::time::timeout(Duration::from_millis(200), rx_events.recv()) => {
                                        match more {
                                            Ok(Some(paths)) => {
                                                for p in paths {
                                                    pending_paths.insert(p);
                                                }
                                            }
                                            _ => {
                                                // 200 ms senza nuovi eventi: emetti
                                                break;
                                            }
                                        }
                                    }
                                }
                            }

                            for path in pending_paths.drain() {
                                let _ = app_handle.emit("studio://file-changed", FileChangedPayload { path });
                            }
                        }
                        None => break,
                    }
                }
            }
        }
    });

    state.active_handle = Some(WatcherHandle {
        _watcher: watcher,
        _task: task,
        stop_tx: Some(stop_tx),
    });

    Ok(())
}

/// Configura l'insieme dei file aperti da osservare per un determinato proprietario (`owner`).
/// L'ascolto osserva l'unione dei file di tutti i proprietari attivi.
/// Un vettore vuoto per `paths` rimuove il proprietario; se non restano proprietari, il watcher si ferma.
#[command]
pub async fn file_watch_set(
    app: AppHandle,
    owner: String,
    paths: Vec<String>,
) -> Result<(), String> {
    let all_paths = {
        let mut state = WATCHER_STATE.lock();
        if paths.is_empty() {
            state.owners.remove(&owner);
        } else {
            state.owners.insert(owner, paths);
        }
        union_owner_paths(&state.owners)
    };

    rebuild_watcher(&app, all_paths)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::sync::atomic::{AtomicUsize, Ordering};

    fn temp_test_dir(label: &str) -> PathBuf {
        static COUNTER: AtomicUsize = AtomicUsize::new(1);
        let id = COUNTER.fetch_add(1, Ordering::SeqCst);
        let dir = std::env::temp_dir().join(format!("omp-test-file-watch-{label}-{id}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn unione_percorsi_tra_piu_proprietari() {
        let mut owners = HashMap::new();
        owners.insert("editor:1".to_string(), vec!["/progetto/a.rs".to_string(), "/progetto/b.rs".to_string()]);
        owners.insert("editor:2".to_string(), vec!["/progetto/b.rs".to_string(), "/progetto/c.rs".to_string()]);

        let mut uniti = union_owner_paths(&owners);
        uniti.sort();
        assert_eq!(uniti, vec!["/progetto/a.rs", "/progetto/b.rs", "/progetto/c.rs"]);

        // Rimozione di un owner
        owners.remove("editor:1");
        let uniti_dopo = union_owner_paths(&owners);
        assert_eq!(uniti_dopo, vec!["/progetto/b.rs", "/progetto/c.rs"]);
    }

    #[test]
    fn normalizzazione_e_confronto_percorsi() {
        let p1 = Path::new("/foo/bar/baz.txt");
        assert_eq!(normalize_for_compare(p1), "/foo/bar/baz.txt");

        let p2 = Path::new(r"C:\Users\Nome\Progetto\file.rs");
        #[cfg(target_os = "windows")]
        assert_eq!(normalize_for_compare(p2), "c:/users/nome/progetto/file.rs");
        #[cfg(not(target_os = "windows"))]
        assert_eq!(normalize_for_compare(p2), "C:/Users/Nome/Progetto/file.rs");
    }

    #[test]
    fn filtro_eventi_e_modifiche() {
        assert!(!is_change_event(&EventKind::Access(notify::event::AccessKind::Read)));
        assert!(is_change_event(&EventKind::Create(notify::event::CreateKind::File)));
        assert!(is_change_event(&EventKind::Modify(notify::event::ModifyKind::Any)));
        assert!(is_change_event(&EventKind::Remove(notify::event::RemoveKind::File)));

        let mut lookup = HashMap::new();
        lookup.insert("/progetto/src/main.rs".to_string(), "/progetto/src/main.rs".to_string());

        let event_paths = vec![
            PathBuf::from("/progetto/src/other.rs"),
            PathBuf::from("/progetto/src/main.rs"),
        ];

        let matched = filter_matching_paths(&event_paths, &lookup);
        assert_eq!(matched, vec!["/progetto/src/main.rs".to_string()]);
    }

    #[tokio::test]
    async fn watcher_intercetta_modifica_file_su_disco() {
        let dir = temp_test_dir("intercetta");
        let file_path = dir.join("test.txt");
        fs::write(&file_path, "iniziale").unwrap();

        let file_path_str = file_path.to_string_lossy().to_string();
        let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<Vec<String>>();

        let mut lookup = HashMap::new();
        let norm = normalize_for_compare(&file_path);
        lookup.insert(norm.clone(), file_path_str.clone());
        if let Ok(canon) = file_path.canonicalize() {
            lookup.insert(normalize_for_compare(&canon), file_path_str.clone());
        }

        let lookup_cb = lookup.clone();
        let mut watcher = RecommendedWatcher::new(
            move |res: Result<Event, notify::Error>| {
                if let Ok(event) = res {
                    if is_change_event(&event.kind) {
                        let matched = filter_matching_paths(&event.paths, &lookup_cb);
                        if !matched.is_empty() {
                            let _ = tx.send(matched);
                        }
                    }
                }
            },
            Config::default(),
        )
        .unwrap();

        let parent = file_path.parent().unwrap();
        watcher.watch(parent, RecursiveMode::NonRecursive).unwrap();

        // Breve pausa per stabilizzare il watcher prima della scrittura
        tokio::time::sleep(Duration::from_millis(50)).await;
        fs::write(&file_path, "modificato da processo esterno").unwrap();

        // Attende la notifica entro 2 secondi
        let received = tokio::time::timeout(Duration::from_secs(2), rx.recv()).await;
        assert!(received.is_ok(), "Timeout ricezione evento di modifica");
        let list = received.unwrap().expect("canale non chiuso");
        assert!(list.contains(&file_path_str));

        let _ = fs::remove_dir_all(&dir);
    }
}
