use std::collections::HashMap;
use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::Path;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use rusqlite::{Connection, OpenFlags};
use serde::Serialize;
use std::path::PathBuf;
use std::process::Command;
use tauri::command;
#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;
fn get_db_path(db_name: &str) -> PathBuf {
    let home = std::env::var("USERPROFILE").unwrap_or_default();
    let mut path = PathBuf::from(home);
    path.push(".omp");
    if db_name != "stats.db" && db_name != "autoqa.db" {
        path.push("agent");
    }
    path.push(db_name);
    path
}

fn open_readonly_db(db_name: &str) -> Result<Connection, String> {
    let path = get_db_path(db_name);
    let conn = Connection::open_with_flags(&path, OpenFlags::SQLITE_OPEN_READ_WRITE)
        .map_err(|e| format!("Cannot open db {}: {}", db_name, e))?;
    
    conn.execute_batch(
        "PRAGMA query_only = ON;
         PRAGMA busy_timeout = 3000;"
    ).map_err(|e| e.to_string())?;

    Ok(conn)
}

fn get_omp_binary() -> String {
    let local_app_data = std::env::var("LOCALAPPDATA").unwrap_or_default();
    if !local_app_data.is_empty() {
        format!("{}\\omp\\omp.exe", local_app_data)
    } else {
        "omp.exe".to_string()
    }
}

/// Nome del tema che Studio scrive e possiede. NON deve coincidere con uno dei
/// 100 temi builtin di `omp`: per un nome builtin `loadThemeJson` restituisce
/// sempre l'oggetto compilato nel binario e il file su disco viene ignorato,
/// watcher compreso (packages/coding-agent/src/modes/theme/theme.ts:2026-2030).
pub const STUDIO_THEME_NAME: &str = "omp-studio";

/// `~/.omp/agent`, rilocabile con `PI_CODING_AGENT_DIR` come fa `omp`.
pub fn agent_dir() -> Option<PathBuf> {
    if let Ok(dir) = std::env::var("PI_CODING_AGENT_DIR") {
        if !dir.is_empty() {
            return Some(PathBuf::from(dir));
        }
    }
    let home = std::env::var("USERPROFILE").ok()?;
    if home.is_empty() {
        return None;
    }
    let mut path = PathBuf::from(home);
    path.push(".omp");
    path.push("agent");
    Some(path)
}

/// L'unico file che Studio scrive dentro `~/.omp` (vedi docs/DECISIONS.md).
pub fn studio_theme_file() -> Option<PathBuf> {
    let mut path = agent_dir()?;
    path.push("themes");
    path.push(format!("{}.json", STUDIO_THEME_NAME));
    Some(path)
}

/// Scrive il tema selezionato come tema custom di `omp`. Le sessioni lanciate
/// da Studio hanno `theme.dark: omp-studio` nell'overlay, quindi il watcher di
/// `omp` osserva proprio questo file: riscriverlo ricolora le TUI gia' aperte.
#[command]
pub async fn theme_apply(theme: serde_json::Value) -> Result<(), String> {
    let path = studio_theme_file().ok_or("Impossibile risolvere ~/.omp/agent")?;
    let dir = path.parent().ok_or("Percorso tema senza cartella")?;
    std::fs::create_dir_all(dir).map_err(|e| format!("Cartella temi: {}", e))?;

    let mut theme = theme;
    let obj = theme.as_object_mut().ok_or("Il tema non e' un oggetto JSON")?;
    obj.insert("name".into(), serde_json::Value::String(STUDIO_THEME_NAME.into()));
    obj.remove("$schema");

    let body = serde_json::to_string_pretty(&theme).map_err(|e| e.to_string())?;
    std::fs::write(&path, body).map_err(|e| format!("Scrittura tema: {}", e))
}

/// Il tema attivo nella configurazione dell'utente (`theme.dark` di
/// `config.yml`), letto per far partire Studio con l'aspetto che l'utente ha
/// gia' scelto in `omp`. Lettura riga per riga: una dipendenza YAML per due
/// chiavi non si giustifica.
#[command]
pub async fn omp_user_theme() -> Result<Option<String>, String> {
    let mut path = agent_dir().ok_or("Impossibile risolvere ~/.omp/agent")?;
    path.push("config.yml");
    let Ok(text) = std::fs::read_to_string(&path) else {
        return Ok(None);
    };

    let mut in_theme = false;
    for line in text.lines() {
        if !line.starts_with([' ', '\t']) {
            in_theme = line.trim_end() == "theme:";
            continue;
        }
        if in_theme {
            if let Some(value) = line.trim().strip_prefix("dark:") {
                let name = value.trim().trim_matches(['"', '\'']).to_string();
                return Ok(if name.is_empty() { None } else { Some(name) });
            }
        }
    }
    Ok(None)
}

#[derive(Serialize)]
pub struct UsageReport {
    raw_json: serde_json::Value,
}

#[command]
pub async fn usage_snapshot(_force: bool) -> Result<UsageReport, String> {
    let local_app_data = std::env::var("LOCALAPPDATA").unwrap_or_default();
    let omp_path = if !local_app_data.is_empty() {
        format!("{}\\omp\\omp.exe", local_app_data)
    } else {
        "omp.exe".to_string()
    };

    let mut cmd = Command::new(&omp_path);
    cmd.arg("usage").arg("--json");

    #[cfg(target_os = "windows")]
    {
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    let output = cmd.output().map_err(|e| e.to_string())?;
    
    if output.status.success() {
        let json_str = String::from_utf8_lossy(&output.stdout);
        let parsed: serde_json::Value = serde_json::from_str(&json_str).map_err(|e| e.to_string())?;
        Ok(UsageReport { raw_json: parsed })
    } else {
        Err(String::from_utf8_lossy(&output.stderr).to_string())
    }
}

const SESSION_TAIL_BYTES: u64 = 256 * 1024;
const ACTIVE_SESSION_MAX_AGE: Duration = Duration::from_secs(30 * 60);

fn read_session_tail(path: &Path, length: u64) -> std::io::Result<(String, bool)> {
    let tail_length = length.min(SESSION_TAIL_BYTES);
    let tail_start = length - tail_length;
    let mut file = File::open(path)?;
    file.seek(SeekFrom::Start(tail_start))?;

    // La coda da 256 KiB evita di rileggere file da molti MB a ogni apertura del popover.
    let mut bytes = Vec::with_capacity(tail_length as usize);
    let mut tail = file.take(tail_length);
    tail.read_to_end(&mut bytes)?;

    Ok((String::from_utf8_lossy(&bytes).into_owned(), tail_start > 0))
}

fn assistant_provider_model(jsonl_tail: &str, starts_mid_line: bool) -> Option<(String, String)> {
    let mut lines = jsonl_tail.lines();
    if starts_mid_line {
        lines.next();
    }

    lines.rev().find_map(|line| {
        let value: serde_json::Value = serde_json::from_str(line).ok()?;
        if value.get("type")?.as_str()? != "message" {
            return None;
        }

        let message = value.get("message")?;
        if message.get("role")?.as_str()? != "assistant" {
            return None;
        }

        Some((
            message.get("provider")?.as_str()?.to_string(),
            message.get("model")?.as_str()?.to_string(),
        ))
    })
}

fn provider_host(breadcrumb_name: &str) -> &'static str {
    if breadcrumb_name.starts_with("wt-0MP57UD10-") {
        "OMP Studio"
    } else if breadcrumb_name.starts_with("wt-") {
        "Windows Terminal"
    } else if breadcrumb_name.starts_with("pts-") {
        "Terminale"
    } else if breadcrumb_name.starts_with("tmux-") {
        "tmux"
    } else if breadcrumb_name.starts_with("zellij-") {
        "Zellij"
    } else if breadcrumb_name.starts_with("kitty-") {
        "Kitty"
    } else if breadcrumb_name.starts_with("wezterm-") {
        "WezTerm"
    } else if breadcrumb_name.starts_with("cmux-") {
        "cmux"
    } else if breadcrumb_name.starts_with("apple-") {
        "Terminal.app"
    } else {
        "Sconosciuto"
    }
}

fn project_from_cwd(cwd: &str) -> String {
    let Some(project) = cwd.rsplit(['\\', '/']).find(|segment| !segment.is_empty()) else {
        return String::new();
    };

    if project.ends_with(':') {
        String::new()
    } else {
        project.to_string()
    }
}

#[derive(Serialize)]
pub struct ProviderHost {
    pub provider: String,
    pub model: String,
    pub host: String,
    pub project: String,
    pub last_active_ms: i64,
}

#[command]
pub async fn provider_hosts() -> Result<Vec<ProviderHost>, String> {
    let Some(mut terminal_sessions) = agent_dir() else {
        return Ok(Vec::new());
    };
    terminal_sessions.push("terminal-sessions");

    let entries = match std::fs::read_dir(&terminal_sessions) {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(error) => return Err(format!("Lettura sessioni terminale: {}", error)),
    };

    let mut hosts = HashMap::<PathBuf, ProviderHost>::new();
    for entry in entries {
        let entry = match entry {
            Ok(entry) => entry,
            Err(_) => continue,
        };
        let is_file = match entry.file_type() {
            Ok(file_type) => file_type.is_file(),
            Err(_) => false,
        };
        if !is_file {
            continue;
        }

        let breadcrumb_name = entry.file_name().to_string_lossy().into_owned();
        let breadcrumb = match std::fs::read_to_string(entry.path()) {
            Ok(breadcrumb) => breadcrumb,
            Err(_) => continue,
        };
        let mut lines = breadcrumb.trim().split('\n');
        let Some(cwd) = lines.next() else {
            continue;
        };
        let Some(jsonl_path) = lines.next() else {
            continue;
        };
        if lines
            .next()
            .is_some_and(|line| line.trim_end_matches('\r') == "fresh")
        {
            continue;
        }

        let session_path = PathBuf::from(jsonl_path.trim_end_matches('\r'));
        let metadata = match std::fs::metadata(&session_path) {
            Ok(metadata) => metadata,
            Err(_) => continue,
        };
        let modified = match metadata.modified() {
            Ok(modified) => modified,
            Err(_) => continue,
        };

        // Una sessione ferma oltre 30 minuti non consuma quota adesso.
        let age = match SystemTime::now().duration_since(modified) {
            Ok(age) => age,
            Err(_) => Duration::ZERO,
        };
        if age > ACTIVE_SESSION_MAX_AGE {
            continue;
        }
        let last_active_ms = match modified.duration_since(UNIX_EPOCH) {
            Ok(duration) => duration.as_millis().min(i64::MAX as u128) as i64,
            Err(_) => continue,
        };

        let (tail, starts_mid_line) = match read_session_tail(&session_path, metadata.len()) {
            Ok(tail) => tail,
            Err(_) => continue,
        };
        let Some((provider, model)) = assistant_provider_model(&tail, starts_mid_line) else {
            continue;
        };

        let dedupe_key = match std::fs::canonicalize(&session_path) {
            Ok(path) => path,
            Err(_) => session_path.clone(),
        };
        let candidate = ProviderHost {
            provider,
            model,
            host: provider_host(&breadcrumb_name).to_string(),
            project: project_from_cwd(cwd.trim_end_matches('\r')),
            last_active_ms,
        };

        if let Some(existing) = hosts.get(&dedupe_key) {
            if existing.last_active_ms >= candidate.last_active_ms {
                continue;
            }
        }
        hosts.insert(dedupe_key, candidate);
    }

    let mut hosts = hosts.into_values().collect::<Vec<_>>();
    hosts.sort_by(|left, right| right.last_active_ms.cmp(&left.last_active_ms));
    Ok(hosts)
}

#[derive(Serialize)]
pub struct SessionEntry {
    pub id: String,
    pub title: String,
    pub created_at: i64,
}

#[command]
pub async fn sessions_list(project_path: String) -> Result<Vec<SessionEntry>, String> {
    let conn = open_readonly_db("history.db")?;
    
    let mut stmt = conn.prepare(
        "SELECT session_id, prompt, MIN(created_at) as created_at 
         FROM history 
         WHERE cwd = ? AND prompt NOT LIKE '/%' 
         GROUP BY session_id 
         ORDER BY created_at DESC 
         LIMIT 50"
    ).map_err(|e| e.to_string())?;

    let iter = stmt.query_map([&project_path], |row| {
        Ok(SessionEntry {
            id: row.get(0)?,
            title: row.get(1)?,
            created_at: row.get(2)?,
        })
    }).map_err(|e| e.to_string())?;

    let mut sessions = Vec::new();
    for row in iter {
        if let Ok(s) = row {
            sessions.push(s);
        }
    }
    
    Ok(sessions)
}

#[command]
pub async fn sessions_search(query: String, project_path: Option<String>) -> Result<Vec<SessionEntry>, String> {
    let conn = open_readonly_db("history.db")?;
    
    let sql = if project_path.is_some() {
        "SELECT h.session_id, h.prompt, h.created_at 
         FROM history_fts f 
         JOIN history h ON f.rowid = h.id 
         WHERE history_fts MATCH ? AND h.cwd = ? 
         GROUP BY h.session_id 
         ORDER BY h.created_at DESC LIMIT 50"
    } else {
        "SELECT h.session_id, h.prompt, h.created_at 
         FROM history_fts f 
         JOIN history h ON f.rowid = h.id 
         WHERE history_fts MATCH ? 
         GROUP BY h.session_id 
         ORDER BY h.created_at DESC LIMIT 50"
    };

    let mut stmt = conn.prepare(sql).map_err(|e| e.to_string())?;

    let mut sessions = Vec::new();

    if let Some(path) = project_path {
        let iter = stmt.query_map(rusqlite::params![query, path], |row| {
            Ok(SessionEntry {
                id: row.get(0)?,
                title: row.get(1)?,
                created_at: row.get(2)?,
            })
        }).map_err(|e| e.to_string())?;
        for row in iter {
            if let Ok(s) = row {
                sessions.push(s);
            }
        }
    } else {
        let iter = stmt.query_map([&query], |row| {
            Ok(SessionEntry {
                id: row.get(0)?,
                title: row.get(1)?,
                created_at: row.get(2)?,
            })
        }).map_err(|e| e.to_string())?;
        for row in iter {
            if let Ok(s) = row {
                sessions.push(s);
            }
        }
    }

    Ok(sessions)
}
#[derive(Serialize)]
pub struct OmpUpdateCheck {
    pub has_update: bool,
    pub current_version: String,
    pub latest_version: String,
    pub message: String,
}

#[command]
pub async fn get_omp_version() -> Result<String, String> {
    let omp_path = get_omp_binary();
    let mut cmd = Command::new(&omp_path);
    cmd.arg("--version");
    #[cfg(target_os = "windows")]
    {
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    let output = cmd.output().map_err(|e| format!("Failed to run omp: {}", e))?;
    let stdout = String::from_utf8_lossy(&output.stdout);
    let trimmed = stdout.trim();
    let ver = trimmed.trim_start_matches("omp").trim_start_matches('/').trim_start_matches('v').trim();
    if ver.is_empty() {
        Err("Unable to parse version".to_string())
    } else {
        Ok(ver.to_string())
    }
}

#[command]
pub async fn check_omp_update() -> Result<OmpUpdateCheck, String> {
    let omp_path = get_omp_binary();
    let mut cmd = Command::new(&omp_path);
    cmd.arg("update").arg("--check");
    #[cfg(target_os = "windows")]
    {
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    let output = cmd.output().map_err(|e| format!("Failed to check omp update: {}", e))?;
    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    let combined = format!("{}\n{}", stdout, stderr);

    let current_version = get_omp_version().await.unwrap_or_else(|_| "unknown".to_string());
    let has_update = !combined.contains("Already up to date") && (combined.contains("Update available") || combined.contains("-->") || combined.contains("new version"));

    Ok(OmpUpdateCheck {
        has_update,
        current_version,
        latest_version: "".to_string(),
        message: combined.trim().to_string(),
    })
}

#[command]
pub async fn run_omp_update() -> Result<String, String> {
    let omp_path = get_omp_binary();
    let mut cmd = Command::new(&omp_path);
    cmd.arg("update");
    #[cfg(target_os = "windows")]
    {
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    let output = cmd.output().map_err(|e| format!("Failed to run omp update: {}", e))?;
    if output.status.success() {
        let stdout = String::from_utf8_lossy(&output.stdout);
        Ok(stdout.trim().to_string())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr);
        Err(stderr.trim().to_string())
    }
}
