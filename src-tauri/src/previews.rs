//! Ponte omp -> Studio per le anteprime dei prototipi UI (vibecoding).
//!
//! L'estensione `studio_preview` (caricata con `-e` nelle sessioni lanciate
//! da Studio) scrive un file JSON per ogni prototipo generato in
//! `%LOCALAPPDATA%/omp-studio/previews`. Questo modulo osserva la cartella,
//! legge i nuovi file e li inoltra al frontend con l'evento `preview://new`:
//! la colonna centrale apre l'anteprima sandbox interattiva (per file SVG
//! il rendering e' completamente isolato con sandbox restrittivo privo di script).

use std::path::PathBuf;
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
    Some(PreviewPayload {
        id,
        title,
        file_path,
        cwd,
        session_id,
        lane_id,
        project_id,
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

fn scan_and_emit(app: &AppHandle, state: &PreviewWatcherState) {
    let Some(dir) = previews_dir() else { return };
    let Ok(entries) = std::fs::read_dir(&dir) else {
        return;
    };

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

    if let Some(payload) = read_preview(&path) {
        let _ = app.emit("preview://new", &payload);
        *state.last_seen.lock() = Some((path, stamp));
    }
}

/// Avvia il watcher dei prototipi all'avvio dell'app.
pub fn spawn_watcher(app: AppHandle) {
    std::thread::spawn(move || {
        let state = PreviewWatcherState::new();

        if let Some(dir) = previews_dir() {
            let _ = std::fs::create_dir_all(&dir);
        }

        loop {
            if let Some(dir) = previews_dir() {
                if let Ok(mut watcher) = notify::recommended_watcher(|_| {}) {
                    if watcher.watch(&dir, RecursiveMode::NonRecursive).is_ok() {
                        scan_and_emit(&app, &state);
                        std::thread::sleep(Duration::from_millis(500));
                        drop(watcher);
                        continue;
                    }
                }
            }
            scan_and_emit(&app, &state);
            std::thread::sleep(Duration::from_millis(500));
        }
    });
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
}
