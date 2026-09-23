//! Ponte omp -> Studio per i diagrammi.
//!
//! L'estensione `studio-diagram` (caricata con `-e` nelle sessioni lanciate
//! da Studio) scrive un file JSON per ogni diagramma in
//! `%LOCALAPPDATA%/omp-studio/diagrams`. Questo modulo osserva la cartella,
//! legge i nuovi file e li inoltra al frontend con l'evento
//! `diagram://new`: la colonna centrale mostra la whiteboard Mermaid.

use std::path::PathBuf;
use std::time::Duration;

use notify::{RecursiveMode, Watcher};
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};

/// Cartella di scambio condivisa con l'estensione. Deve restare allineata
/// con `extensions/studio-diagram.ts`.
pub fn diagrams_dir() -> Option<PathBuf> {
    if cfg!(target_os = "windows") {
        let local = std::env::var("LOCALAPPDATA").ok()?;
        Some(PathBuf::from(local).join("omp-studio").join("diagrams"))
    } else {
        let home = std::env::var("HOME").ok()?;
        Some(PathBuf::from(home).join(".omp-studio").join("diagrams"))
    }
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
pub struct DiagramPayload {
    pub id: String,
    pub title: String,
    pub mermaid: String,
    pub cwd: String,
    pub session_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub lane_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub project_id: Option<String>,
}

fn read_diagram(path: &std::path::Path) -> Option<DiagramPayload> {
    let text = std::fs::read_to_string(path).ok()?;
    let value: serde_json::Value = serde_json::from_str(&text).ok()?;
    // Un file parziale o corrotto viene ignorato: il prossimo evento di
    // scrittura lo rileggera' completo. Nessun errore visibile all'utente.
    let id = value.get("id")?.as_str()?.to_string();
    let title = value
        .get("title")
        .and_then(|v| v.as_str())
        .unwrap_or("Diagram")
        .to_string();
    let mermaid = value.get("mermaid")?.as_str()?.to_string();
    if mermaid.trim().is_empty() {
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
    Some(DiagramPayload {
        id,
        title,
        mermaid,
        cwd,
        session_id,
        lane_id,
        project_id,
    })
}

pub struct DiagramWatcherState {
    /// Ultimo file gia' notificato: evita doppioni quando il watcher riceve
    /// piu' eventi per la stessa scrittura (create + modify sono tipici).
    last_seen: Mutex<Option<(PathBuf, u64)>>,
}

impl DiagramWatcherState {
    pub fn new() -> Self {
        Self {
            last_seen: Mutex::new(None),
        }
    }
}

fn scan_and_emit(app: &AppHandle, state: &DiagramWatcherState) {
    let Some(dir) = diagrams_dir() else { return };
    let Ok(entries) = std::fs::read_dir(&dir) else {
        return;
    };

    // Solo file .json: la cartella cresce nel tempo, ma ogni giro scandisce
    // solo l'elenco dei nomi (pochi file, lettura economica).
    let mut newest: Option<(PathBuf, u64)> = None;
    for entry in entries.flatten() {
        let path = entry.path();
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

    let Some((path, stamp)) = newest else { return };
    {
        let guard = state.last_seen.lock();
        if let Some((last_path, last_stamp)) = guard.as_ref() {
            if *last_path == path && *last_stamp >= stamp {
                return;
            }
        }
    }

    if let Some(payload) = read_diagram(&path) {
        // Il frontend filtra per progetto attivo usando `cwd`.
        let _ = app.emit("diagram://new", &payload);
        *state.last_seen.lock() = Some((path, stamp));
    }
}

/// Avvia il watcher all'avvio dell'app. Un thread dedicato con polling di
/// 500 ms su una cartella locale: nessuna dipendenza async, costo nullo.
pub fn spawn_watcher(app: AppHandle) {
    std::thread::spawn(move || {
        let state = DiagramWatcherState::new();

        // Se la cartella non esiste ancora (nessun diagramma mai inviato),
        // il watcher su di essa fallirebbe: si crea subito, e' vuota e
        // innocua, cancellabile dall'utente come qualsiasi file di Studio.
        if let Some(dir) = diagrams_dir() {
            let _ = std::fs::create_dir_all(&dir);
        }

        loop {
            // notify richiede che il Watcher viva per tutta la durata del
            // loop: lo ricreiamo a ogni giro per assorbire cancellazioni
            // della cartella da parte dell'utente.
            if let Some(dir) = diagrams_dir() {
                if let Ok(mut watcher) = notify::recommended_watcher(|_| {}) {
                    if watcher.watch(&dir, RecursiveMode::NonRecursive).is_ok() {
                        scan_and_emit(&app, &state);
                        // Il watcher resta vivo finche' `watcher` esiste:
                        // teniamolo in vita per il periodo di poll.
                        std::thread::sleep(Duration::from_millis(500));
                        drop(watcher);
                        continue;
                    }
                }
            }
            // Cartella assente o watcher fallito: ripiega su polling puro.
            scan_and_emit(&app, &state);
            std::thread::sleep(Duration::from_millis(500));
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_read_diagram_with_lane_and_project_id() {
        let dir = std::env::temp_dir().join(format!("omp-test-diag-1-{}", std::process::id()));
        let _ = std::fs::create_dir_all(&dir);
        let path = dir.join("test_diagram.json");
        let content = serde_json::json!({
            "id": "diag-123",
            "title": "Architettura Flusso",
            "mermaid": "graph TD\nA-->B",
            "cwd": "C:/repos/portalino",
            "session_id": "sess-456",
            "lane_id": "wt-feature",
            "project_id": "proj-coldiretti"
        });
        std::fs::write(&path, content.to_string()).unwrap();
        let payload = read_diagram(&path).expect("lettura diagramma fallita");
        assert_eq!(payload.id, "diag-123");
        assert_eq!(payload.title, "Architettura Flusso");
        assert_eq!(payload.mermaid, "graph TD\nA-->B");
        assert_eq!(payload.cwd, "C:/repos/portalino");
        assert_eq!(payload.session_id, "sess-456");
        assert_eq!(payload.lane_id, Some("wt-feature".to_string()));
        assert_eq!(payload.project_id, Some("proj-coldiretti".to_string()));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn test_read_diagram_supports_camel_case_identifiers() {
        let dir = std::env::temp_dir().join(format!("omp-test-diag-2-{}", std::process::id()));
        let _ = std::fs::create_dir_all(&dir);
        let path = dir.join("test_diagram_camel.json");
        let content = serde_json::json!({
            "id": "diag-camel",
            "title": "Diagramma Camel",
            "mermaid": "flowchart LR\nX-->Y",
            "cwd": "C:/repos/.omp-wt-portalino-lane",
            "session_id": "sess-789",
            "laneId": "lane-secondaria",
            "projectId": "proj-main"
        });
        std::fs::write(&path, content.to_string()).unwrap();
        let payload = read_diagram(&path).expect("lettura diagramma fallita");
        assert_eq!(payload.lane_id, Some("lane-secondaria".to_string()));
        assert_eq!(payload.project_id, Some("proj-main".to_string()));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn test_read_diagram_legacy_without_lane_fields() {
        let dir = std::env::temp_dir().join(format!("omp-test-diag-3-{}", std::process::id()));
        let _ = std::fs::create_dir_all(&dir);
        let path = dir.join("test_diagram_legacy.json");
        let content = serde_json::json!({
            "id": "diag-legacy",
            "title": "Legacy",
            "mermaid": "stateDiagram-v2\n[*]-->S1",
            "cwd": "C:/repos/portalino",
            "session_id": "sess-legacy"
        });
        std::fs::write(&path, content.to_string()).unwrap();
        let payload = read_diagram(&path).expect("lettura diagramma legacy fallita");
        assert_eq!(payload.lane_id, None);
        assert_eq!(payload.project_id, None);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
