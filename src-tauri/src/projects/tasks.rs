//! Gestione I/O atomica e watcher per i task di progetto in `.omp/tasks.json`.
//!
//! Garantisce che:
//! 1. Il file viva all'interno del progetto in `.omp/tasks.json`.
//! 2. Sia automaticamente inserito in `.omp/.gitignore` per evitare commit involontari.
//! 3. Le scritture siano atomiche (scrittura su file temporaneo + rename) per prevenire corruzioni e conflitti I/O.
//! 4. Le modifiche esterne (da terminale/TUI o da tool OMP) siano rilevate da un file watcher e notificate alla GUI via `project-tasks-changed`.

use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};
use notify::{Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use parking_lot::Mutex;
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ProjectTasksChangedEvent {
    pub project_path: String,
}

pub struct ProjectTasksState {
    watchers: Mutex<HashMap<String, RecommendedWatcher>>,
    pub last_studio_writes: Mutex<HashMap<String, Instant>>,
}

impl ProjectTasksState {
    pub fn new() -> Self {
        Self {
            watchers: Mutex::new(HashMap::new()),
            last_studio_writes: Mutex::new(HashMap::new()),
        }
    }
}

/// Risolve il percorso della cartella `.omp` per un progetto.
fn project_omp_dir(project_path: &str) -> PathBuf {
    Path::new(project_path).join(".omp")
}

/// Risolve il percorso di `.omp/tasks.json` per un progetto.
fn project_tasks_file(project_path: &str) -> PathBuf {
    project_omp_dir(project_path).join("tasks.json")
}

/// Assicura che la cartella `.omp` e il relativo `.gitignore` esistano e contengano `tasks.json`.
fn ensure_auto_ignore(omp_dir: &Path) -> Result<(), String> {
    if !omp_dir.exists() {
        fs::create_dir_all(omp_dir).map_err(|e| format!("Impossibile creare cartella .omp: {}", e))?;
    }

    let gitignore_path = omp_dir.join(".gitignore");
    let needs_entry = if gitignore_path.exists() {
        match fs::read_to_string(&gitignore_path) {
            Ok(content) => !content.lines().any(|line| {
                let trimmed = line.trim();
                trimmed == "tasks.json" || trimmed == "/tasks.json" || trimmed == "*"
            }),
            Err(_) => true,
        }
    } else {
        true
    };

    if needs_entry {
        let entry = "\n# OMP Studio: task locali non versionati\ntasks.json\ntasks.json.tmp*\n";
        let mut existing = fs::read_to_string(&gitignore_path).unwrap_or_default();
        existing.push_str(entry);
        fs::write(&gitignore_path, existing)
            .map_err(|e| format!("Impossibile aggiornare .omp/.gitignore: {}", e))?;
    }

    Ok(())
}
/// Legge il file `.omp/tasks.json` del progetto. Ritorna stringa vuota se non esiste.
#[tauri::command]
pub async fn project_tasks_read(project_path: String) -> Result<String, String> {
    let file = project_tasks_file(&project_path);
    if !file.exists() {
        return Ok(String::new());
    }
    let content = fs::read_to_string(&file)
        .map_err(|e| format!("Errore lettura .omp/tasks.json: {}", e))?;
    Ok(content)
}

/// Scrive in modo atomico il file `.omp/tasks.json`.
#[tauri::command]
pub async fn project_tasks_write(
    project_path: String,
    content: String,
    state: State<'_, ProjectTasksState>,
) -> Result<(), String> {
    let omp_dir = project_omp_dir(&project_path);
    ensure_auto_ignore(&omp_dir)?;

    let target_file = omp_dir.join("tasks.json");
    let temp_name = format!("tasks.json.tmp.{}", std::process::id());
    let temp_file = omp_dir.join(&temp_name);

    fs::write(&temp_file, &content)
        .map_err(|e| format!("Errore scrittura file temporaneo dei task: {}", e))?;

    // Registra il timestamp dell'I/O di Studio per silenziare l'eco del file watcher
    let norm_key = project_path.replace('\\', "/").to_lowercase();
    state.last_studio_writes.lock().insert(norm_key, Instant::now());

    // Rename atomico (su Windows fs::rename sovrascrive se usiamo movefileex o se rimuoviamo con fallback)
    if let Err(err) = fs::rename(&temp_file, &target_file) {
        // Fallback per filesystem Windows in cui la destinazione già esiste
        let _ = fs::remove_file(&target_file);
        fs::rename(&temp_file, &target_file)
            .map_err(|e| format!("Errore atomizzazione tasks.json (orig: {}, fallback: {})", err, e))?;
    }

    Ok(())
}

/// Registra un watcher filesystem sulla cartella `.omp` per notificare modifiche esterne a `tasks.json`.
#[tauri::command]
pub async fn project_tasks_watch(
    project_path: String,
    app_handle: AppHandle,
    state: State<'_, ProjectTasksState>,
) -> Result<(), String> {
    let norm_key = project_path.replace('\\', "/").to_lowercase();
    let mut watchers = state.watchers.lock();
    if watchers.contains_key(&norm_key) {
        return Ok(());
    }

    let omp_dir = project_omp_dir(&project_path);
    ensure_auto_ignore(&omp_dir)?;

    let path_clone = project_path.clone();
    let app_clone = app_handle.clone();

    let mut watcher = notify::recommended_watcher(move |res: Result<Event, notify::Error>| {
        if let Ok(event) = res {
            let is_tasks_file = event.paths.iter().any(|p| {
                p.file_name()
                    .and_then(|n| n.to_str())
                    .map(|n| n == "tasks.json")
                    .unwrap_or(false)
            });

            if !is_tasks_file {
                return;
            }

            // Ignora se non è una modifica o creazione
            match event.kind {
                EventKind::Create(_) | EventKind::Modify(_) => {}
                _ => return,
            }

            // Verifica se la scrittura è avvenuta da Studio negli ultimi 450 ms
            let norm = path_clone.replace('\\', "/").to_lowercase();
            if let Some(state_ref) = app_clone.try_state::<ProjectTasksState>() {
                if let Some(&last_write) = state_ref.last_studio_writes.lock().get(&norm) {
                    if last_write.elapsed() < Duration::from_millis(450) {
                        return;
                    }
                }
            }

            // Notifica il frontend dell'avvenuto cambiamento
            let _ = app_clone.emit(
                "project-tasks-changed",
                ProjectTasksChangedEvent {
                    project_path: path_clone.clone(),
                },
            );
        }
    })
    .map_err(|e| format!("Impossibile creare watcher per .omp: {}", e))?;

    watcher
        .watch(&omp_dir, RecursiveMode::NonRecursive)
        .map_err(|e| format!("Impossibile osservare cartella .omp: {}", e))?;

    watchers.insert(norm_key, watcher);
    Ok(())
}

/// Rimuove il watcher filesystem per il progetto specificato.
#[tauri::command]
pub async fn project_tasks_unwatch(
    project_path: String,
    state: State<'_, ProjectTasksState>,
) -> Result<(), String> {
    let norm_key = project_path.replace('\\', "/").to_lowercase();
    state.watchers.lock().remove(&norm_key);
    Ok(())
}
