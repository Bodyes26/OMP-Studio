//! Spostamento della sessione senza riscrivere il JSONL (R-MI-14).
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use tauri::State;

const MAX: u64 = 12 * 1024 * 1024;

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Redirect {
    pub machine: String,
    pub source_path: String,
    pub target_path: String,
    pub project_path: String,
    pub model: Option<String>,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct Arrival { source_path: String, target_path: String }

fn roots() -> Result<PathBuf, String> {
    Ok(crate::omp_ops::agent_dir().ok_or("omp session directory unavailable")?.join("sessions"))
}
fn id(value: &str) -> Result<String, String> {
    uuid::Uuid::parse_str(value).map(|uuid| uuid.hyphenated().to_string()).map_err(|_| "Invalid session id".into())
}
fn read<T: serde::de::DeserializeOwned>(path: &Path) -> Result<Option<T>, String> {
    match std::fs::read(path) {
        Ok(bytes) => serde_json::from_slice(&bytes).map(Some).map_err(|e| e.to_string()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}
fn write<T: Serialize>(path: &Path, record: &T) -> Result<(), String> {
    crate::fs_atomic::atomic_write(path, &serde_json::to_vec(record).map_err(|e| e.to_string())?)
}
fn marker(session: &str, suffix: &str) -> Result<PathBuf, String> {
    Ok(roots()?.join(format!(".studio-{session}.{suffix}")))
}
fn checked_source(session: &str, cwd: &str) -> Result<PathBuf, String> {
    let root = roots()?.canonicalize().map_err(|e| e.to_string())?;
    let path = crate::omp_ops::find_session_file_in(&root, session).ok_or("Session transcript not found")?;
    let path = path.canonicalize().map_err(|e| e.to_string())?;
    if !path.starts_with(&root) || path.metadata().map_err(|e| e.to_string())?.len() > MAX {
        return Err("Session transcript is outside its folder or too large to transfer".into());
    }
    let info = crate::session_index::parse_session_file(&path).ok_or("Invalid session transcript")?;
    if info.session_id != session || crate::session_index::normalize_path_for_compare(&info.project_path) != crate::session_index::normalize_path_for_compare(cwd) {
        return Err("The session does not belong to the workspace".into());
    }
    Ok(path)
}

pub(crate) fn moved(session: &str) -> Result<Option<Redirect>, String> {
    let Ok(session) = id(session) else { return Ok(None); };
    read(&marker(&session, "moved")?)
}

pub(crate) fn allow_implicit_resume(cwd: &str) -> bool {
    let Ok(root) = roots() else { return true };
    let Ok(entries) = std::fs::read_dir(root) else { return true };
    let wanted = crate::session_index::normalize_path_for_compare(cwd);
    !entries.flatten().any(|entry| {
        let name = entry.file_name();
        if !name.to_string_lossy().ends_with(".moved") { return false; }
        read::<Redirect>(&entry.path()).ok().flatten()
            .is_some_and(|moved| crate::session_index::normalize_path_for_compare(&moved.source_path) == wanted)
    })
}

pub(crate) fn moved_notice(session: &str, cwd: &str) -> Result<Option<String>, String> {
    let Ok(session) = id(session) else { return Ok(None); };
    if let Some(target) = moved(&session)? { return Err(format!("This session is read-only here. Continue on {}", target.machine)); }
    let Some(note) = read::<Arrival>(&marker(&session, "arrival")?)? else { return Ok(None); };

    if crate::session_index::normalize_path_for_compare(&note.target_path) != crate::session_index::normalize_path_for_compare(cwd) {
        return Err("Resume this session from its destination workspace".into());
    }
    Ok(Some(format!("The previous messages describe another machine. This workspace now runs on {}. Paths under {:?} in the transcript now refer to the corresponding paths under {:?}. Use the current operating system and root for all tool calls.", std::env::consts::OS, note.source_path, cwd)))
}

pub(crate) fn arrival_path(session: &str) -> Option<String> {
    let session = id(session).ok()?;
    read::<Arrival>(&marker(&session, "arrival").ok()?).ok().flatten().map(|record| record.target_path)
}

#[tauri::command]
pub(crate) fn session_move_redirect(session: String) -> Result<Option<Redirect>, String> { moved(&session) }
#[tauri::command]
pub(crate) fn session_move_recover(project_path: String, session: String) -> Result<String, String> {
    let session = id(&session)?;
    let target = moved(&session)?.ok_or("Session transfer has not started")?;
    if target.source_path != project_path { return Err("Session transfer belongs to a different workspace".into()); }
    std::fs::read_to_string(checked_source(&session, &project_path)?).map_err(|e| e.to_string())
}

#[tauri::command]
pub(crate) fn session_move_export(manager: State<'_, crate::rpc::RpcManager>, project_path: String, session: String,
    rpc_id: u64, target: Redirect) -> Result<String, String> {
    let session = id(&session)?;
    if target.source_path != project_path { return Err("Session transfer belongs to a different workspace".into()); }
    let path = checked_source(&session, &project_path)?;
    let marker = marker(&session, "moved")?;
    manager.freeze_for_move(rpc_id, &session, &project_path, || {
        if let Some(existing) = read::<Redirect>(&marker)? {
            if existing.machine != target.machine || existing.project_path != target.project_path { return Err("Session already moved to a different workspace".into()); }
        } else {
            write(&marker, &target)?;
        }
        Ok(())
    })?;
    std::fs::read_to_string(path).map_err(|e| e.to_string())
}

#[tauri::command]
pub(crate) fn session_move_import(manager: State<'_, crate::rpc::RpcManager>, project_path: String, session: String,
    source_path: String, transcript: String) -> Result<(), String> {
    let session = id(&session)?;
    if transcript.len() as u64 > MAX || !Path::new(&project_path).is_dir() { return Err("Invalid destination or transcript size".into()); }
    let header: serde_json::Value = serde_json::from_str(transcript.lines().next().ok_or("Empty transcript")?).map_err(|e| e.to_string())?;
    if header.get("type").and_then(|v| v.as_str()) != Some("session") || header.get("id").and_then(|v| v.as_str()) != Some(session.as_str()) ||
        header.get("cwd").and_then(|v| v.as_str()).map(crate::session_index::normalize_path_for_compare) != Some(crate::session_index::normalize_path_for_compare(&source_path)) {
        return Err("Transcript metadata does not match the transfer".into());
    }
    manager.with_open_gate(|| {
        if let Some(existing) = arrival_path(&session) {
            if existing != project_path { return Err("The destination already has this session".into()); }
            if crate::omp_ops::session_transcript_exists(&session) { return Ok(()); }
        } else if crate::omp_ops::session_transcript_exists(&session) { return Err("The destination already has this session".into()); }
        let dir = roots()?.join(crate::session_index::session_folder_candidates(&project_path).into_iter().next().ok_or("Invalid workspace path")?);
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        let target = dir.join(format!("{}_{session}.jsonl", crate::link::epoch_ms()));
        write(&marker(&session, "arrival")?, &Arrival { source_path, target_path: project_path })?;
        crate::fs_atomic::atomic_write(&target, transcript.as_bytes())
    })
}
