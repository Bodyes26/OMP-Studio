//! Gestione degli indici dei prototipi (progetto e bozze globali).
//!
//! Entrambi gli indici condividono la struttura `{ version: 1, prototypes: [...] }`.
//! Le scritture passano da `fs_atomic::atomic_write` e sono serializzate da un mutex per file.
//! File inesistente = indice vuoto; JSON invalido = errore esplicito senza sovrascritture.

use super::paths::{canonical_project_path, drafts_index_path, lab_root, project_index_path};
use super::types::{LabIndexEntry, LabIndexFile, LabIndexPatch, LabPrototypeStatus};
use super::util::now_iso8601;
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use parking_lot::Mutex;
use std::sync::{Arc, LazyLock};
use tauri::command;

static INDEX_LOCKS: LazyLock<Mutex<HashMap<PathBuf, Arc<Mutex<()>>>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

/// Ottiene o crea il mutex associato al file di indice specificato.
fn get_file_lock(path: &Path) -> Arc<Mutex<()>> {
    let mut locks = INDEX_LOCKS.lock();
    locks
        .entry(path.to_path_buf())
        .or_insert_with(|| Arc::new(Mutex::new(())))
        .clone()
}

/// Risolve il percorso dell'indice per un eventuale percorso di progetto,
/// oppure per l'indice globale delle bozze se `project_path` e' `None`.
pub fn resolve_index_path(project_path: Option<&str>) -> Result<PathBuf, String> {
    match project_path {
        Some(path_str) => {
            let path = Path::new(path_str);
            if !path.exists() {
                return Err(format!(
                    "Cartella di progetto non esistente: {}",
                    path.display()
                ));
            }
            Ok(project_index_path(path))
        }
        None => drafts_index_path()
            .ok_or_else(|| "Radice del Laboratorio non disponibile per le bozze".to_string()),
    }
}

/// Legge un file di indice. Se non esiste restituisce un indice vuoto.
/// Se il file esiste ma contiene JSON non valido, restituisce un errore esplicito.
pub fn read_index(path: &Path) -> Result<LabIndexFile, String> {
    if !path.exists() {
        return Ok(LabIndexFile::default());
    }
    let content = fs::read_to_string(path)
        .map_err(|e| format!("Impossibile leggere l'indice in {}: {e}", path.display()))?;
    serde_json::from_str(&content).map_err(|e| {
        format!(
            "Indice dei prototipi corrotto o non valido in {}: {e}",
            path.display()
        )
    })
}

/// Scrive in modo atomico il file di indice serializzando l'accesso tramite mutex.
pub fn write_index(path: &Path, file: &LabIndexFile) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| {
            format!(
                "Impossibile creare la cartella dell'indice in {}: {e}",
                parent.display()
            )
        })?;
    }
    let json_bytes = serde_json::to_vec_pretty(file)
        .map_err(|e| format!("Serializzazione indice fallita: {e}"))?;
    crate::fs_atomic::atomic_write(path, &json_bytes)
}

/// Inserisce il blocco `.omp/lab/` in coda al `.gitignore` del progetto se il progetto e'
/// un repository git e `.omp/lab/` (o `.omp/`) non e' gia' ignorato.
pub fn ensure_project_gitignore(project_path: &Path) -> Result<(), String> {
    let canonical = canonical_project_path(project_path);
    let git_dir = canonical.join(".git");
    if !git_dir.exists() {
        return Ok(());
    }

    let gitignore_path = canonical.join(".gitignore");
    if gitignore_path.exists() {
        let content = fs::read_to_string(&gitignore_path).map_err(|e| {
            format!(
                "Impossibile leggere .gitignore in {}: {e}",
                gitignore_path.display()
            )
        })?;

        for line in content.lines() {
            let trimmed = line.trim();
            if trimmed == ".omp/lab/"
                || trimmed == ".omp/lab"
                || trimmed == ".omp/"
                || trimmed == ".omp"
                || trimmed == "/.omp/lab/"
                || trimmed == "/.omp/lab"
                || trimmed == "/.omp/"
                || trimmed == "/.omp"
            {
                return Ok(());
            }
        }

        let mut new_content = content;
        if !new_content.is_empty() && !new_content.ends_with('\n') {
            new_content.push('\n');
        }
        new_content.push_str("\n# OMP Studio Lab (indice locale dei prototipi)\n.omp/lab/\n");
        crate::fs_atomic::atomic_write(&gitignore_path, new_content.as_bytes())
    } else {
        let content = "# OMP Studio Lab (indice locale dei prototipi)\n.omp/lab/\n";
        crate::fs_atomic::atomic_write(&gitignore_path, content.as_bytes())
    }
}

/// Ritorna l'elenco delle voci dell'indice per il progetto o per le bozze.
#[command]
pub async fn lab_index_list(project_path: Option<String>) -> Result<Vec<LabIndexEntry>, String> {
    tokio::task::spawn_blocking(move || {
        let index_path = resolve_index_path(project_path.as_deref())?;
        let lock = get_file_lock(&index_path);
        let _guard = lock.lock();
        let index_file = read_index(&index_path)?;
        Ok(index_file.prototypes)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Aggiorna i campi specificati di una voce nell'indice.
#[command]
pub async fn lab_index_update(
    project_path: Option<String>,
    id: String,
    patch: LabIndexPatch,
) -> Result<LabIndexEntry, String> {
    tokio::task::spawn_blocking(move || {
        let index_path = resolve_index_path(project_path.as_deref())?;
        let lock = get_file_lock(&index_path);
        let _guard = lock.lock();
        let mut index_file = read_index(&index_path)?;

        let entry = index_file
            .prototypes
            .iter_mut()
            .find(|e| e.id == id)
            .ok_or_else(|| format!("Prototipo {id} non trovato nell'indice"))?;

        if let Some(title) = patch.title {
            entry.title = title;
        }
        if let Some(summary) = patch.summary {
            entry.summary = summary;
        }
        if let Some(status) = patch.status {
            match status {
                LabPrototypeStatus::Closed => {
                    if entry.status != LabPrototypeStatus::Closed {
                        entry.closed_at = Some(now_iso8601());
                    }
                }
                LabPrototypeStatus::Active => {
                    entry.closed_at = None;
                }
            }
            entry.status = status;
        }
        if let Some(last_rev) = patch.last_revision {
            entry.last_revision = last_rev;
        }
        entry.updated_at = now_iso8601();

        let updated_entry = entry.clone();
        write_index(&index_path, &index_file)?;
        Ok(updated_entry)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Rimuove una voce dall'indice e opzionalmente ne cancella il workspace (solo se sotto `<root>/prototypes`).
#[command]
pub async fn lab_index_remove(
    project_path: Option<String>,
    id: String,
    delete_workspace: bool,
) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        let index_path = resolve_index_path(project_path.as_deref())?;
        let lock = get_file_lock(&index_path);
        let _guard = lock.lock();
        let mut index_file = read_index(&index_path)?;

        let pos = index_file
            .prototypes
            .iter()
            .position(|e| e.id == id)
            .ok_or_else(|| format!("Prototipo {id} non trovato nell'indice"))?;

        let entry = index_file.prototypes.remove(pos);
        write_index(&index_path, &index_file)?;

        if delete_workspace {
            let root = lab_root().ok_or("Radice Lab non disponibile")?;
            let allowed_prototypes_dir = root.join("prototypes");
            let ws_path = PathBuf::from(&entry.workspace_path);

            // Verifica di sicurezza rigorosa: cancella SOLO cartelle che stanno dentro <root>/prototypes
            let canonical_allowed = allowed_prototypes_dir
                .canonicalize()
                .unwrap_or(allowed_prototypes_dir);
            let canonical_ws = ws_path.canonicalize().unwrap_or(ws_path);

            if canonical_ws.starts_with(&canonical_allowed) && canonical_ws != canonical_allowed {
                if canonical_ws.exists() {
                    fs::remove_dir_all(&canonical_ws).map_err(|e| {
                        format!(
                            "Impossibile eliminare il workspace in {}: {e}",
                            canonical_ws.display()
                        )
                    })?;
                }
            } else {
                return Err(format!(
                    "Cancellazione negata: il workspace {} non e' contenuto nella directory sicura dei prototipi",
                    entry.workspace_path
                ));
            }
        }
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Sposta una bozza dall'indice globale all'indice del progetto di destinazione.
#[command]
pub async fn lab_prototype_associate(
    id: String,
    target_project_path: String,
) -> Result<LabIndexEntry, String> {
    tokio::task::spawn_blocking(move || {
        let target_project = Path::new(&target_project_path);
        if !target_project.exists() {
            return Err(format!(
                "Cartella di progetto di destinazione non esistente: {}",
                target_project.display()
            ));
        }

        let drafts_path = drafts_index_path()
            .ok_or_else(|| "Radice del Laboratorio non disponibile".to_string())?;
        let target_index_path = project_index_path(target_project);

        // Blocca entrambi gli indici in ordine deterministico per evitare deadlock
        let drafts_lock = get_file_lock(&drafts_path);
        let target_lock = get_file_lock(&target_index_path);

        let (_first_guard, _second_guard) = if drafts_path < target_index_path {
            let g1 = drafts_lock.lock();
            let g2 = target_lock.lock();
            (g1, g2)
        } else {
            let g1 = target_lock.lock();
            let g2 = drafts_lock.lock();
            (g1, g2)
        };

        let mut drafts_file = read_index(&drafts_path)?;
        let pos = drafts_file
            .prototypes
            .iter()
            .position(|e| e.id == id)
            .ok_or_else(|| format!("Prototipo {id} non trovato nelle bozze"))?;

        let mut entry = drafts_file.prototypes.remove(pos);
        entry.updated_at = now_iso8601();

        let mut target_file = read_index(&target_index_path)?;
        // Se per qualche motivo esisteva gia' una voce con lo stesso id nel target, aggiornala o aggiungila
        if let Some(existing) = target_file.prototypes.iter_mut().find(|e| e.id == id) {
            *existing = entry.clone();
        } else {
            target_file.prototypes.push(entry.clone());
        }

        write_index(&drafts_path, &drafts_file)?;
        write_index(&target_index_path, &target_file)?;

        // Aggiorna .gitignore nel progetto target se git repo
        let _ = ensure_project_gitignore(target_project);

        Ok(entry)
    })
    .await
    .map_err(|e| e.to_string())?
}
