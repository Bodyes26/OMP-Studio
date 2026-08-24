//! Ponte omp -> Studio per le anteprime dei prototipi UI (vibecoding).
//!
//! L'estensione `studio_preview` (caricata con `-e` nelle sessioni lanciate
//! da Studio) scrive un file JSON per ogni prototipo generato in
//! `%LOCALAPPDATA%/omp-studio/previews`. Questo modulo osserva la cartella,
//! legge i nuovi file e li inoltra al frontend con l'evento
//! `preview://new`: la colonna centrale apre l'anteprima sandbox interattiva.

use std::path::PathBuf;
use std::time::Duration;

use notify::{RecursiveMode, Watcher};
use parking_lot::Mutex;
use serde::Serialize;
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

#[derive(Serialize, Clone)]
pub struct PreviewPayload {
    pub id: String,
    pub title: String,
    pub file_path: String,
    pub cwd: String,
    pub session_id: String,
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
    Some(PreviewPayload {
        id,
        title,
        file_path,
        cwd,
        session_id,
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
