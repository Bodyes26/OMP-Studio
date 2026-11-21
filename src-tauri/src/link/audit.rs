//! Registro delle azioni remote (R-MI-39): cosa un'altra macchina ha fatto
//! fare a questa. Si registra solo cio' che cambia qualcosa o esegue (tutto
//! tranne l'ambito Lettura): le letture sarebbero migliaia di righe e non
//! dicono nulla su chi ha toccato la macchina. Le voci durano 30 giorni.
use std::{io::{BufRead, Write}, path::{Path, PathBuf}, sync::atomic::{AtomicU64, Ordering}};
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use serde_json::Value;

pub(crate) const RETENTION_MS: u64 = 30 * 24 * 60 * 60 * 1000;
const PRUNE_EVERY_MS: u64 = 60 * 60 * 1000;
/// Tetto delle voci restituite in una lettura: la risposta deve stare comoda
/// sotto il limite di una chiamata del collegamento anche da remoto.
const MAX_ENTRIES: usize = 2000;

static WRITE: Mutex<()> = Mutex::new(());
static LAST_PRUNE: AtomicU64 = AtomicU64::new(0);

/// Comandi che non sono azioni ma il loro rumore di fondo: i tasti di un
/// terminale gia' aperto (l'apertura si registra), le dimensioni, la chiusura
/// di una vista, la sessione segnata come vista.
pub(crate) fn is_noise(action: &str) -> bool {
    matches!(action, "pty_write" | "pty_resize" | "pty_close" | "rpc_close" | "mark_session_seen"
        // Le interrogazioni di un job remoto: il job si registra all'avvio.
        | "exec_start" | "exec_nightly_ready" | "exec_status" | "exec_artifact_chunk"
        | "omp_sync_snapshot" | "session_move_redirect")
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Entry {
    pub at: u64,
    pub machine_id: String,
    pub machine_name: String,
    pub action: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub project_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub project_name: Option<String>,
}

pub(crate) fn path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    use tauri::Manager;
    Ok(app.path().app_data_dir().map_err(|error| error.to_string())?.join("link-audit.jsonl"))
}

/// Aggiunge una voce. Un errore di scrittura non deve mai far fallire
/// l'azione registrata: finisce nel log di Studio e basta.
pub(crate) fn record(app: &tauri::AppHandle, entry: Entry) {
    let result = path(app).and_then(|path| append(&path, &entry, entry.at));
    if let Err(error) = result {
        crate::studio_log::info("link", format!("Registro azioni remote: {error}"));
    }
}

pub(crate) fn append(path: &Path, entry: &Entry, now: u64) -> Result<(), String> {
    let _guard = WRITE.lock();
    if let Some(parent) = path.parent() { std::fs::create_dir_all(parent).map_err(|error| error.to_string())?; }
    if now.saturating_sub(LAST_PRUNE.load(Ordering::Relaxed)) >= PRUNE_EVERY_MS {
        prune_locked(path, now)?;
        LAST_PRUNE.store(now, Ordering::Relaxed);
    }
    let mut line = serde_json::to_vec(entry).map_err(|error| error.to_string())?;
    line.push(b'\n');
    let mut file = std::fs::OpenOptions::new().create(true).append(true).open(path).map_err(|error| error.to_string())?;
    file.write_all(&line).map_err(|error| error.to_string())
}

/// Toglie le voci oltre i 30 giorni e le righe illeggibili (file troncato da
/// uno spegnimento a meta' scrittura).
fn prune_locked(path: &Path, now: u64) -> Result<(), String> {
    let entries = match read_all(path) {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(error.to_string()),
    };
    let kept: Vec<_> = entries.into_iter().filter(|entry| now.saturating_sub(entry.at) <= RETENTION_MS).collect();
    let mut bytes = Vec::new();
    for entry in &kept {
        bytes.extend(serde_json::to_vec(entry).map_err(|error| error.to_string())?);
        bytes.push(b'\n');
    }
    crate::fs_atomic::atomic_write(path, &bytes)
}

fn read_all(path: &Path) -> std::io::Result<Vec<Entry>> {
    let file = std::fs::File::open(path)?;
    Ok(std::io::BufReader::new(file).lines().map_while(Result::ok)
        .filter_map(|line| serde_json::from_str(&line).ok()).collect())
}

/// Voci piu' recenti prima, filtrate per macchina e progetto, entro 30 giorni.
pub(crate) fn query(path: &Path, machine_id: Option<&str>, project_id: Option<&str>, now: u64) -> Result<Vec<Entry>, String> {
    let entries = match read_all(path) {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(error) => return Err(error.to_string()),
    };
    Ok(entries.into_iter().rev()
        .filter(|entry| now.saturating_sub(entry.at) <= RETENTION_MS)
        .filter(|entry| machine_id.is_none_or(|id| entry.machine_id == id))
        .filter(|entry| project_id.is_none_or(|id| entry.project_id.as_deref() == Some(id)))
        .take(MAX_ENTRIES)
        .collect())
}

/// Progetto toccato da un'azione, secondo i progetti pubblicati dalla
/// finestra dell'host: per `projectId` diretto, altrimenti per il percorso
/// (copia, cartella di lavoro, file) piu' lungo che sta dentro un progetto.
pub(crate) fn resolve_project(snapshot: Option<&Value>, args: &Value) -> (Option<String>, Option<String>) {
    let args = args.get("command").filter(|value| value.is_object()).unwrap_or(args);
    let Some(projects) = snapshot.and_then(|value| value.get("projects")).and_then(Value::as_array) else {
        return (args.get("projectId").and_then(Value::as_str).map(str::to_owned), None);
    };
    let named = |project: &Value| (
        project.get("id").and_then(Value::as_str).map(str::to_owned),
        project.get("name").and_then(Value::as_str).map(str::to_owned),
    );
    if let Some(id) = args.get("projectId").and_then(Value::as_str) {
        if let Some(project) = projects.iter().find(|project| project.get("id").and_then(Value::as_str) == Some(id)) {
            return named(project);
        }
        return (Some(id.to_owned()), None);
    }
    let candidates: Vec<String> = ["projectPath", "cwd", "path", "root", "workspacePath", "filePath"].iter()
        .filter_map(|key| args.get(*key).and_then(Value::as_str)).map(normalize).collect();
    let mut best: Option<(&Value, usize)> = None;
    for project in projects {
        let Some(root) = project.get("canonicalProjectPath").and_then(Value::as_str).map(normalize) else { continue };
        if root.is_empty() { continue; }
        let inside = candidates.iter().any(|candidate| candidate == &root
            || candidate.strip_prefix(root.as_str()).is_some_and(|rest| rest.starts_with('/')));
        if inside && best.is_none_or(|(_, length)| root.len() > length) { best = Some((project, root.len())); }
    }
    best.map(|(project, _)| named(project)).unwrap_or((None, None))
}

fn normalize(path: &str) -> String {
    let path = path.replace('\\', "/");
    let path = path.trim_end_matches('/');
    if cfg!(windows) || cfg!(target_os = "macos") { path.to_lowercase() } else { path.to_owned() }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn entry(at: u64, machine: &str, project: Option<&str>) -> Entry {
        Entry { at, machine_id: machine.into(), machine_name: machine.into(), action: "file_write".into(),
            project_id: project.map(str::to_owned), project_name: None }
    }

    fn temp(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("omp-link-audit-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir.join("audit.jsonl")
    }

    #[test]
    fn entries_older_than_thirty_days_are_dropped_and_newest_come_first() {
        let path = temp("retention");
        let now = RETENTION_MS * 3;
        // Nessuna potatura mentre si preparano le voci.
        LAST_PRUNE.store(u64::MAX, Ordering::Relaxed);
        append(&path, &entry(now - RETENTION_MS - 1, "pc", None), now - RETENTION_MS - 1).unwrap();
        append(&path, &entry(now - 10, "pc", Some("a")), now - 10).unwrap();
        append(&path, &entry(now - 5, "laptop", Some("b")), now - 5).unwrap();
        let all = query(&path, None, None, now).unwrap();
        assert_eq!(all.iter().map(|entry| entry.at).collect::<Vec<_>>(), vec![now - 5, now - 10]);
        assert_eq!(query(&path, Some("pc"), None, now).unwrap().len(), 1);
        assert_eq!(query(&path, None, Some("b"), now).unwrap()[0].machine_id, "laptop");
        // La potatura riscrive il file senza la voce scaduta.
        LAST_PRUNE.store(0, Ordering::Relaxed);
        append(&path, &entry(now, "pc", None), now).unwrap();
        assert_eq!(std::fs::read_to_string(&path).unwrap().lines().count(), 3);
    }

    #[test]
    fn a_truncated_line_does_not_hide_the_others() {
        let path = temp("truncated");
        let good = serde_json::to_string(&entry(100, "pc", None)).unwrap();
        std::fs::write(&path, format!("{good}\n{{\"at\":1")).unwrap();
        assert_eq!(query(&path, None, None, 200).unwrap().len(), 1);
    }

    #[test]
    fn project_is_resolved_by_id_or_by_the_longest_containing_path() {
        let snapshot = json!({ "projects": [
            { "id": "p1", "name": "Sito", "canonicalProjectPath": "/Users/m/repos/sito" },
            { "id": "p2", "name": "Sito docs", "canonicalProjectPath": "/Users/m/repos/sito/docs" },
            { "id": "p3", "name": "Sitoweb", "canonicalProjectPath": "/Users/m/repos/sitoweb" },
        ]});
        assert_eq!(resolve_project(Some(&snapshot), &json!({ "projectId": "p1" })), (Some("p1".into()), Some("Sito".into())));
        assert_eq!(resolve_project(Some(&snapshot), &json!({ "path": "/Users/m/repos/sito/docs/a.md" })).0.as_deref(), Some("p2"));
        assert_eq!(resolve_project(Some(&snapshot), &json!({ "path": "/Users/m/repos/sitoweb/x" })).0.as_deref(), Some("p3"));
        assert_eq!(resolve_project(Some(&snapshot), &json!({ "command": { "kind": "send_prompt", "projectId": "p3" } })).1.as_deref(), Some("Sitoweb"));
        assert_eq!(resolve_project(Some(&snapshot), &json!({ "path": "/tmp/x" })), (None, None));
    }
}
