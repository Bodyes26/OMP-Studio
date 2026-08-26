use rusqlite::{Connection, OpenFlags};
use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::fs::File;
use std::io::{BufRead, BufReader, Read, Seek, SeekFrom};
#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;
use std::path::Path;
use std::path::PathBuf;
use std::process::Command;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::command;
fn get_user_home() -> Option<String> {
    if let Ok(home) = std::env::var("HOME") {
        if !home.is_empty() {
            return Some(home);
        }
    }
    if let Ok(home) = std::env::var("USERPROFILE") {
        if !home.is_empty() {
            return Some(home);
        }
    }
    None
}

fn get_db_path(db_name: &str) -> Option<PathBuf> {
    if db_name != "stats.db" && db_name != "autoqa.db" {
        let mut path = agent_dir()?;
        path.push(db_name);
        Some(path)
    } else {
        let home = get_user_home()?;
        let mut path = PathBuf::from(home);
        path.push(".omp");
        path.push(db_name);
        Some(path)
    }
}

fn open_readonly_db(db_name: &str) -> Result<Connection, String> {
    let path = get_db_path(db_name)
        .ok_or_else(|| format!("Percorso db {} non risolvibile", db_name))?;
    if !path.exists() {
        return Err(format!("File db {} non esiste", path.display()));
    }
    let conn = Connection::open_with_flags(
        &path,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .map_err(|e| format!("Cannot open db {}: {}", db_name, e))?;

    conn.execute_batch(
        "PRAGMA query_only = ON;
         PRAGMA busy_timeout = 3000;",
    )
    .map_err(|e| e.to_string())?;

    Ok(conn)
}

pub fn get_omp_binary() -> String {
    #[cfg(target_os = "windows")]
    {
        let local_app_data = std::env::var("LOCALAPPDATA").unwrap_or_default();
        if !local_app_data.is_empty() {
            let win_path = format!("{}\\omp\\omp.exe", local_app_data);
            if Path::new(&win_path).exists() {
                return win_path;
            }
        }
        "omp.exe".to_string()
    }
    #[cfg(not(target_os = "windows"))]
    {
        if let Ok(home) = std::env::var("HOME") {
            let candidate_paths = [
                format!("{}/.bun/bin/omp", home),
                format!("{}/.omp/bin/omp", home),
                format!("{}/.local/bin/omp", home),
                format!("{}/.cargo/bin/omp", home),
                "/usr/local/bin/omp".to_string(),
                "/opt/homebrew/bin/omp".to_string(),
            ];
            for path in candidate_paths {
                if Path::new(&path).exists() {
                    return path;
                }
            }
        }
        "omp".to_string()
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
    let home = get_user_home()?;
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
/// da Studio hanno `theme.dark` e `theme.light` puntati al tema scritto da
/// `theme_apply` nell'overlay, quindi ogni modalita' della TUI usa la stessa
/// scelta.
fn theme_apply_sync(theme: serde_json::Value) -> Result<(), String> {
    let path = studio_theme_file().ok_or("Impossibile risolvere ~/.omp/agent")?;
    let dir = path.parent().ok_or("Percorso tema senza cartella")?;
    std::fs::create_dir_all(dir).map_err(|e| format!("Cartella temi: {}", e))?;

    let mut theme = theme;
    let obj = theme
        .as_object_mut()
        .ok_or("Il tema non e' un oggetto JSON")?;
    obj.insert(
        "name".into(),
        serde_json::Value::String(STUDIO_THEME_NAME.into()),
    );
    obj.remove("$schema");

    let body = serde_json::to_string_pretty(&theme).map_err(|e| e.to_string())?;
    std::fs::write(&path, body).map_err(|e| format!("Scrittura tema: {}", e))
}

#[command]
pub async fn theme_apply(theme: serde_json::Value) -> Result<(), String> {
    tokio::task::spawn_blocking(move || theme_apply_sync(theme))
        .await
        .map_err(|e| format!("Task theme_apply: {}", e))?
}

/// Il tema attivo nella configurazione dell'utente (`theme.dark` di
/// `config.yml`), letto per far partire Studio con l'aspetto che l'utente ha
/// gia' scelto in `omp`. Se `theme.dark` non e' presente, usa `theme.light`
/// come fallback.
fn omp_user_theme_sync() -> Result<Option<String>, String> {
    let mut path = agent_dir().ok_or("Impossibile risolvere ~/.omp/agent")?;
    path.push("config.yml");
    let Ok(text) = std::fs::read_to_string(&path) else {
        return Ok(None);
    };

    let mut in_theme = false;
    let mut dark = None;
    let mut light = None;
    for line in text.lines() {
        if !line.starts_with([' ', '\t']) {
            in_theme = line.trim_end() == "theme:";
            continue;
        }
        if !in_theme {
            continue;
        }
        if let Some(value) = line.trim().strip_prefix("dark:") {
            let name = value.trim().trim_matches(['"', '\'']).to_string();
            if !name.is_empty() {
                dark = Some(name);
            }
        } else if let Some(value) = line.trim().strip_prefix("light:") {
            let name = value.trim().trim_matches(['"', '\'']).to_string();
            if !name.is_empty() {
                light = Some(name);
            }
        }
    }
    Ok(dark.or(light))
}

#[command]
pub async fn omp_user_theme() -> Result<Option<String>, String> {
    tokio::task::spawn_blocking(omp_user_theme_sync)
        .await
        .map_err(|e| format!("Task omp_user_theme: {}", e))?
}

#[derive(Serialize)]
pub struct UsageReport {
    raw_json: serde_json::Value,
}

fn usage_snapshot_sync() -> Result<UsageReport, String> {
    let omp_path = get_omp_binary();

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
        let parsed: serde_json::Value =
            serde_json::from_str(&json_str).map_err(|e| e.to_string())?;
        Ok(UsageReport { raw_json: parsed })
    } else {
        Err(String::from_utf8_lossy(&output.stderr).to_string())
    }
}

#[command]
pub async fn usage_snapshot(_force: bool) -> Result<UsageReport, String> {
    tokio::task::spawn_blocking(usage_snapshot_sync)
        .await
        .map_err(|e| format!("Task usage_snapshot: {}", e))?
}

const SESSION_TAIL_BYTES: u64 = 256 * 1024;
const ACTIVE_SESSION_MAX_AGE: Duration = Duration::from_secs(120);

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

fn assistant_providers_in_tail(jsonl_tail: &str, starts_mid_line: bool) -> Option<(String, String)> {
    let mut lines = jsonl_tail.lines();
    if starts_mid_line {
        lines.next();
    }

    for line in lines.rev() {
        let Ok(value) = serde_json::from_str::<serde_json::Value>(line) else {
            continue;
        };
        let event_type = value.get("type").and_then(|t| t.as_str());
        if event_type == Some("model_change") {
            if let (Some(provider), Some(model)) = (
                value.get("provider").and_then(|p| p.as_str()),
                value.get("model").and_then(|m| m.as_str()),
            ) {
                return Some((provider.to_string(), model.to_string()));
            }
            continue;
        }

        if event_type != Some("message") {
            continue;
        }

        let Some(message) = value.get("message") else {
            continue;
        };
        if message.get("role").and_then(|r| r.as_str()) != Some("assistant") {
            continue;
        }

        let Some(provider) = message.get("provider").and_then(|p| p.as_str()) else {
            continue;
        };
        let Some(model) = message.get("model").and_then(|m| m.as_str()) else {
            continue;
        };

        return Some((provider.to_string(), model.to_string()));
    }

    None
}

fn collect_subagent_sessions(dir: &Path, depth: usize, out: &mut Vec<PathBuf>) {
    if depth > 4 {
        return;
    }
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_file() {
            if path.extension().and_then(|ext| ext.to_str()) == Some("jsonl") {
                out.push(path);
            }
        } else if path.is_dir() {
            collect_subagent_sessions(&path, depth + 1, out);
        }
    }
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

fn provider_hosts_sync() -> Result<Vec<ProviderHost>, String> {
    let Some(mut terminal_sessions) = agent_dir() else {
        return Ok(Vec::new());
    };
    terminal_sessions.push("terminal-sessions");

    let entries = match std::fs::read_dir(&terminal_sessions) {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(error) => return Err(format!("Lettura sessioni terminale: {}", error)),
    };

    let mut hosts = HashMap::<(String, String), ProviderHost>::new();
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
        let is_studio_breadcrumb = breadcrumb_name.starts_with("wt-0MP57UD10-");
        let breadcrumb = match std::fs::read_to_string(entry.path()) {
            Ok(breadcrumb) => breadcrumb,
            Err(_) => continue,
        };
        let mut lines = breadcrumb.trim().split('\n');
        let Some(cwd) = lines.next() else {
            if is_studio_breadcrumb {
                let _ = std::fs::remove_file(entry.path());
            }
            continue;
        };
        let Some(jsonl_path) = lines.next() else {
            if is_studio_breadcrumb {
                let _ = std::fs::remove_file(entry.path());
            }
            continue;
        };
        if lines
            .next()
            .is_some_and(|line| line.trim_end_matches('\r') == "fresh")
        {
            continue;
        }

        let session_path = PathBuf::from(jsonl_path.trim_end_matches('\r'));
        if !session_path.exists() {
            if is_studio_breadcrumb {
                let _ = std::fs::remove_file(entry.path());
            }
            continue;
        }

        let mut session_files = vec![session_path.clone()];
        let subagents_dir = session_path.with_extension("");
        if subagents_dir.is_dir() {
            collect_subagent_sessions(&subagents_dir, 0, &mut session_files);
        }

        let project_name = project_from_cwd(cwd.trim_end_matches('\r'));
        let host_name = provider_host(&breadcrumb_name).to_string();

        for file_path in session_files {
            let metadata = match std::fs::metadata(&file_path) {
                Ok(metadata) => metadata,
                Err(_) => continue,
            };
            let modified = match metadata.modified() {
                Ok(modified) => modified,
                Err(_) => continue,
            };

            // Una sessione ferma oltre 2 minuti non consuma quota adesso.
            let age = match SystemTime::now().duration_since(modified) {
                Ok(age) => age,
                Err(_) => Duration::ZERO,
            };
            if age > ACTIVE_SESSION_MAX_AGE {
                if is_studio_breadcrumb {
                    let _ = std::fs::remove_file(entry.path());
                }
                continue;
            }
            let last_active_ms = match modified.duration_since(UNIX_EPOCH) {
                Ok(duration) => duration.as_millis().min(i64::MAX as u128) as i64,
                Err(_) => continue,
            };

            let (tail, starts_mid_line) = match read_session_tail(&file_path, metadata.len()) {
                Ok(tail) => tail,
                Err(_) => continue,
            };

            if let Some((provider, model)) = assistant_providers_in_tail(&tail, starts_mid_line) {
                let dedupe_key = (project_name.clone(), provider.clone());
                let candidate = ProviderHost {
                    provider,
                    model,
                    host: host_name.clone(),
                    project: project_name.clone(),
                    last_active_ms,
                };

                if let Some(existing) = hosts.get(&dedupe_key) {
                    if existing.last_active_ms >= candidate.last_active_ms {
                        continue;
                    }
                }
                hosts.insert(dedupe_key, candidate);
            }
        }
    }
    let mut hosts = hosts.into_values().collect::<Vec<_>>();
    hosts.sort_by(|left, right| right.last_active_ms.cmp(&left.last_active_ms));
    Ok(hosts)
}
#[command]
pub async fn provider_hosts() -> Result<Vec<ProviderHost>, String> {
    tokio::task::spawn_blocking(provider_hosts_sync)
        .await
        .map_err(|e| format!("Task provider_hosts: {}", e))?
}

#[derive(Serialize)]
pub struct SessionEntry {
    pub id: String,
    pub title: String,
    pub created_at: i64,
}

fn normalize_path_for_compare(path: &str) -> String {
    path.replace('\\', "/").trim_end_matches('/').to_lowercase()
}

fn scan_sessions_from_disk(
    project_path: &str,
    query: Option<&str>,
    titles: &HashMap<String, String>,
) -> Vec<SessionEntry> {
    let Some(agent) = agent_dir() else {
        return Vec::new();
    };
    let sessions_root = agent.join("sessions");
    if !sessions_root.exists() {
        return Vec::new();
    }

    let target_norm = normalize_path_for_compare(project_path);
    let query_lower = query.map(|q| q.trim().to_lowercase());
    let mut found = Vec::new();

    let Ok(dir_entries) = std::fs::read_dir(&sessions_root) else {
        return Vec::new();
    };

    for folder_entry in dir_entries.flatten() {
        let folder_path = folder_entry.path();
        if !folder_path.is_dir() {
            continue;
        }
        let Ok(files) = std::fs::read_dir(&folder_path) else {
            continue;
        };
        for file_entry in files.flatten() {
            let path = file_entry.path();
            if path.extension().and_then(|ext| ext.to_str()) != Some("jsonl") {
                continue;
            }

            let Ok(file) = File::open(&path) else {
                continue;
            };
            let reader = BufReader::new(file);
            let mut header_title = None;
            let mut session_id = None;
            let mut session_cwd = None;
            let mut first_prompt = None;

            for line in reader.lines().take(20).flatten() {
                let Ok(val) = serde_json::from_str::<serde_json::Value>(&line) else {
                    continue;
                };
                let entry_type = val.get("type").and_then(|t| t.as_str()).unwrap_or("");
                if entry_type == "title" {
                    if let Some(t) = val.get("title").and_then(|t| t.as_str()) {
                        if !t.is_empty() {
                            header_title = Some(t.to_string());
                        }
                    }
                } else if entry_type == "session" {
                    if let Some(id) = val.get("id").and_then(|i| i.as_str()) {
                        session_id = Some(id.to_string());
                    }
                    if let Some(cwd) = val.get("cwd").and_then(|c| c.as_str()) {
                        session_cwd = Some(cwd.to_string());
                    }
                    if header_title.is_none() {
                        if let Some(t) = val.get("title").and_then(|t| t.as_str()) {
                            if !t.is_empty() {
                                header_title = Some(t.to_string());
                            }
                        }
                    }
                } else if entry_type == "message" && first_prompt.is_none() {
                    let role = val
                        .get("message")
                        .and_then(|m| m.get("role"))
                        .and_then(|r| r.as_str());
                    if role == Some("user") {
                        if let Some(content) = val.get("message").and_then(|m| m.get("content")) {
                            if let Some(text) = content.as_str() {
                                first_prompt = Some(text.to_string());
                            } else if let Some(arr) = content.as_array() {
                                for part in arr {
                                    if part.get("type").and_then(|t| t.as_str()) == Some("text") {
                                        if let Some(txt) = part.get("text").and_then(|t| t.as_str()) {
                                            first_prompt = Some(txt.to_string());
                                            break;
                                        }
                                    }
                                }
                            }
                        }
                    }
                }

                if session_id.is_some() && session_cwd.is_some() && first_prompt.is_some() {
                    break;
                }
            }

            if let (Some(id), Some(cwd)) = (session_id, session_cwd) {
                if normalize_path_for_compare(&cwd) == target_norm {
                    let title = titles
                        .get(&id)
                        .cloned()
                        .or(header_title)
                        .or(first_prompt)
                        .unwrap_or_else(|| "Nuova sessione".to_string());

                    let matches = match &query_lower {
                        None => true,
                        Some(q) if q.is_empty() => true,
                        Some(q) => title.to_lowercase().contains(q) || id.to_lowercase().contains(q),
                    };

                    if matches {
                        let mtime = file_entry
                            .metadata()
                            .and_then(|m| m.modified())
                            .ok()
                            .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                            .map(|d| d.as_secs() as i64)
                            .unwrap_or(0);

                        found.push(SessionEntry {
                            id,
                            title,
                            created_at: mtime,
                        });
                    }
                }
            }
        }
    }

    found
}

fn sessions_list_sync(project_path: String) -> Result<Vec<SessionEntry>, String> {
    let mut titles = HashMap::new();
    let mut history_sessions = Vec::new();

    if let Ok(conn) = open_readonly_db("history.db") {
        if let Ok(mut title_stmt) = conn.prepare("SELECT session_id, title FROM session_titles") {
            if let Ok(iter) = title_stmt.query_map([], |row| Ok((row.get(0)?, row.get(1)?))) {
                for row in iter.flatten() {
                    titles.insert(row.0, row.1);
                }
            }
        }

        if let Ok(mut stmt) = conn.prepare(
            "SELECT session_id, prompt, MIN(created_at) as created_at 
             FROM history 
             WHERE cwd = ? AND prompt NOT LIKE '/%' 
             GROUP BY session_id 
             ORDER BY created_at DESC 
             LIMIT 50",
        ) {
            if let Ok(iter) = stmt.query_map([&project_path], |row| {
                Ok(SessionEntry {
                    id: row.get(0)?,
                    title: row.get(1)?,
                    created_at: row.get(2)?,
                })
            }) {
                for row in iter.flatten() {
                    history_sessions.push(row);
                }
            }
        }
    }

    let mut sessions = scan_sessions_from_disk(&project_path, None, &titles);
    let mut seen: HashSet<String> = sessions.iter().map(|s| s.id.clone()).collect();

    for mut h in history_sessions {
        if !seen.contains(&h.id) {
            if let Some(t) = titles.get(&h.id) {
                h.title = t.clone();
            }
            seen.insert(h.id.clone());
            sessions.push(h);
        }
    }

    sessions.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    sessions.truncate(50);

    Ok(sessions)
}

#[command]
pub async fn sessions_list(project_path: String) -> Result<Vec<SessionEntry>, String> {
    tokio::task::spawn_blocking(move || sessions_list_sync(project_path))
        .await
        .map_err(|e| format!("Task sessions_list: {}", e))?
}

pub fn sanitize_fts_query(query: &str) -> String {
    // Rimuove o raddoppia i doppi apici e racchiude tra virgolette per evitare errori di sintassi FTS
    let escaped = query.replace('"', "\"\"");
    format!("\"{}\"", escaped)
}

fn sessions_search_sync(
    query: String,
    project_path: Option<String>,
) -> Result<Vec<SessionEntry>, String> {
    let trimmed_query = query.trim().to_string();
    let mut titles = HashMap::new();
    let mut history_sessions = Vec::new();

    if !trimmed_query.is_empty() {
        if let Ok(conn) = open_readonly_db("history.db") {
            if let Ok(mut title_stmt) = conn.prepare("SELECT session_id, title FROM session_titles") {
                if let Ok(iter) = title_stmt.query_map([], |row| Ok((row.get(0)?, row.get(1)?))) {
                    for row in iter.flatten() {
                        titles.insert(row.0, row.1);
                    }
                }
            }

            let fts_query = sanitize_fts_query(&trimmed_query);
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

            if let Ok(mut stmt) = conn.prepare(sql) {
                if let Some(path) = &project_path {
                    if let Ok(iter) = stmt.query_map(rusqlite::params![fts_query, path], |row| {
                        Ok(SessionEntry {
                            id: row.get(0)?,
                            title: row.get(1)?,
                            created_at: row.get(2)?,
                        })
                    }) {
                        for row in iter.flatten() {
                            history_sessions.push(row);
                        }
                    }
                } else if let Ok(iter) = stmt.query_map([&fts_query], |row| {
                    Ok(SessionEntry {
                        id: row.get(0)?,
                        title: row.get(1)?,
                        created_at: row.get(2)?,
                    })
                }) {
                    for row in iter.flatten() {
                        history_sessions.push(row);
                    }
                }
            }
        }
    }

    let mut sessions = if let Some(path) = &project_path {
        scan_sessions_from_disk(path, Some(&trimmed_query), &titles)
    } else {
        Vec::new()
    };

    let mut seen: HashSet<String> = sessions.iter().map(|s| s.id.clone()).collect();
    let query_lower = trimmed_query.to_lowercase();

    for mut h in history_sessions {
        if !seen.contains(&h.id) {
            if let Some(t) = titles.get(&h.id) {
                h.title = t.clone();
            }
            if h.title.to_lowercase().contains(&query_lower) || h.id.to_lowercase().contains(&query_lower) {
                seen.insert(h.id.clone());
                sessions.push(h);
            }
        }
    }

    sessions.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    sessions.truncate(50);

    Ok(sessions)
}

#[command]
pub async fn sessions_search(
    query: String,
    project_path: Option<String>,
) -> Result<Vec<SessionEntry>, String> {
    tokio::task::spawn_blocking(move || sessions_search_sync(query, project_path))
        .await
        .map_err(|e| format!("Task sessions_search: {}", e))?
}

fn get_omp_version_sync() -> Result<String, String> {
    let omp_path = get_omp_binary();
    let mut cmd = Command::new(&omp_path);
    cmd.arg("--version");
    #[cfg(target_os = "windows")]
    {
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    let output = cmd
        .output()
        .map_err(|e| format!("Failed to run omp: {}", e))?;
    let stdout = String::from_utf8_lossy(&output.stdout);
    let trimmed = stdout.trim();
    let ver = trimmed
        .trim_start_matches("omp")
        .trim_start_matches('/')
        .trim_start_matches('v')
        .trim();
    if ver.is_empty() {
        Err("Unable to parse version".to_string())
    } else {
        Ok(ver.to_string())
    }
}

#[command]
pub async fn get_omp_version() -> Result<String, String> {
    tokio::task::spawn_blocking(get_omp_version_sync)
        .await
        .map_err(|e| format!("Task get_omp_version: {}", e))?
}
#[derive(Serialize)]
pub struct OmpUpdateCheck {
    pub has_update: bool,
    pub current_version: String,
    pub latest_version: String,
    pub message: String,
}

/// Rimuove sequenze di escape ANSI (es. colori picocolors/chalk) da una stringa
fn strip_ansi(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut chars = s.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '\x1b' {
            if let Some(&'[') = chars.peek() {
                chars.next();
                while let Some(&next) = chars.peek() {
                    chars.next();
                    if next.is_ascii_alphabetic() {
                        break;
                    }
                }
                continue;
            }
        }
        out.push(c);
    }
    out
}

/// Analizza l'output del comando `omp update --check`
pub fn parse_omp_update_check(
    stdout: &str,
    stderr: &str,
    exit_success: bool,
    fallback_current_version: &str,
) -> Result<OmpUpdateCheck, String> {
    let clean_stdout = strip_ansi(stdout);
    let clean_stderr = strip_ansi(stderr);
    let combined = format!("{}\n{}", clean_stdout, clean_stderr).trim().to_string();
    let lower = combined.to_lowercase();

    // Se il processo e' fallito o l'output segnala un errore esplicito, riportiamo l'errore
    if !exit_success || lower.contains("failed to check for updates") {
        let err_msg = if !combined.is_empty() {
            combined
        } else {
            "Controllo aggiornamenti OMP fallito senza output".to_string()
        };
        return Err(err_msg);
    }

    // Estrazione versione corrente da "Current version: <ver>" se presente
    let mut current_version = fallback_current_version.to_string();
    for line in combined.lines() {
        let trimmed_line = line.trim();
        if let Some(idx) = trimmed_line.to_lowercase().find("current version:") {
            let ver_part = trimmed_line[idx + "current version:".len()..].trim();
            let candidate = ver_part
                .split_whitespace()
                .next()
                .unwrap_or("")
                .trim_start_matches('v');
            if !candidate.is_empty() {
                current_version = candidate.to_string();
                break;
            }
        }
    }

    // Caso 1: OMP e' gia' aggiornato ("Already up to date")
    if lower.contains("already up to date") {
        return Ok(OmpUpdateCheck {
            has_update: false,
            current_version: current_version.clone(),
            latest_version: current_version,
            message: combined,
        });
    }

    // Caso 2: Rilevamento nuova versione disponibile
    let mut has_update = false;
    let mut latest_version = String::new();

    for line in combined.lines() {
        let trimmed_line = line.trim();
        let lower_line = trimmed_line.to_lowercase();

        // Pattern: "New version available: 18.0.5"
        if let Some(idx) = lower_line.find("new version available:") {
            has_update = true;
            let ver_part = trimmed_line[idx + "new version available:".len()..].trim();
            if let Some(candidate) = ver_part.split_whitespace().next() {
                latest_version = candidate.trim_start_matches('v').to_string();
            }
            break;
        }

        // Pattern: "Update available: 18.0.5" o "Update available"
        if let Some(idx) = lower_line.find("update available") {
            has_update = true;
            let after = trimmed_line[idx + "update available".len()..]
                .trim_start_matches(':')
                .trim();
            if let Some((_, right)) = after.split_once("->") {
                if let Some(candidate) = right.trim().split_whitespace().next() {
                    latest_version = candidate.trim_start_matches('v').to_string();
                }
            } else if let Some(candidate) = after.split_whitespace().next() {
                latest_version = candidate.trim_start_matches('v').to_string();
            }
            break;
        }

        // Pattern: "Switching to canary 18.1.0"
        if let Some(idx) = lower_line.find("switching to") {
            has_update = true;
            let after = trimmed_line[idx + "switching to".len()..].trim();
            for token in after.split_whitespace() {
                if token.chars().any(|c| c.is_ascii_digit()) {
                    latest_version = token.trim_start_matches('v').to_string();
                    break;
                }
            }
            break;
        }

        // Pattern con frecce "-->" o "->"
        if trimmed_line.contains("-->") || trimmed_line.contains("->") {
            has_update = true;
            let right = if let Some((_, r)) = trimmed_line.split_once("-->") {
                r
            } else if let Some((_, r)) = trimmed_line.split_once("->") {
                r
            } else {
                ""
            };
            if let Some(candidate) = right.trim().split_whitespace().next() {
                latest_version = candidate.trim_start_matches('v').to_string();
            }
            break;
        }
    }

    // Se non identificato riga per riga ma contiene "new version" o "update available"
    if !has_update && (lower.contains("new version") || lower.contains("update available")) {
        has_update = true;
    }

    Ok(OmpUpdateCheck {
        has_update,
        current_version,
        latest_version,
        message: combined,
    })
}

fn check_omp_update_sync() -> Result<OmpUpdateCheck, String> {
    let omp_path = get_omp_binary();
    let mut cmd = Command::new(&omp_path);
    cmd.arg("update").arg("--check");
    #[cfg(target_os = "windows")]
    {
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    let current_version = get_omp_version_sync().unwrap_or_else(|_| "unknown".to_string());

    let output = cmd
        .output()
        .map_err(|e| format!("Impossibile verificare aggiornamenti OMP: {}", e))?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);

    parse_omp_update_check(&stdout, &stderr, output.status.success(), &current_version)
}

#[command]
pub async fn check_omp_update() -> Result<OmpUpdateCheck, String> {
    tokio::task::spawn_blocking(check_omp_update_sync)
        .await
        .map_err(|e| format!("Task check_omp_update: {}", e))?
}

fn run_omp_update_sync() -> Result<String, String> {
    let omp_path = get_omp_binary();
    let mut cmd = Command::new(&omp_path);
    cmd.arg("update");
    #[cfg(target_os = "windows")]
    {
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    let output = cmd
        .output()
        .map_err(|e| format!("Impossibile eseguire l'aggiornamento di OMP: {}", e))?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    let combined = format!("{}\n{}", stdout, stderr);
    let cleaned = strip_ansi(&combined).trim().to_string();

    if output.status.success() {
        Ok(cleaned)
    } else {
        let msg = if !cleaned.is_empty() {
            cleaned
        } else {
            format!("Aggiornamento OMP fallito con codice {:?}", output.status.code())
        };
        Err(msg)
    }
}

#[command]
pub async fn run_omp_update() -> Result<String, String> {
    tokio::task::spawn_blocking(run_omp_update_sync)
        .await
        .map_err(|e| format!("Task run_omp_update: {}", e))?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn estrae_ultimo_provider_dalla_coda() {
        let tail = r#"
{"type":"message","message":{"role":"assistant","provider":"openai-codex","model":"gpt-5.6-terra"}}
{"type":"message","message":{"role":"assistant","provider":"anthropic","model":"claude-opus-4-8"}}
{"type":"message","message":{"role":"assistant","provider":"google-antigravity","model":"gemini-3.7-flash"}}
"#;
        let provider = assistant_providers_in_tail(tail, false);
        assert_eq!(
            provider,
            Some((
                "google-antigravity".to_string(),
                "gemini-3.7-flash".to_string()
            ))
        );
    }

    #[test]
    fn estrae_model_change_recente() {
        let tail = r#"
{"type":"message","message":{"role":"assistant","provider":"openai-codex","model":"gpt-5.6-terra"}}
{"type":"model_change","provider":"google-antigravity","model":"gemini-3.7-flash"}
"#;
        let provider = assistant_providers_in_tail(tail, false);
        assert_eq!(
            provider,
            Some((
                "google-antigravity".to_string(),
                "gemini-3.7-flash".to_string()
            ))
        );
    }

    #[test]
    fn restituisce_none_senza_messaggi_assistant() {
        let tail = r#"
{"type":"message","message":{"role":"user","content":"ciao"}}
{"type":"custom","customType":"notice","data":{}}
"#;
        let provider = assistant_providers_in_tail(tail, false);
        assert_eq!(provider, None);
    }

    #[test]
    fn test_parse_omp_update_check_con_nuova_versione() {
        let stdout = "Current version: 18.0.4\nNew version available: 18.0.5\n";
        let res = parse_omp_update_check(stdout, "", true, "18.0.4").expect("parsing riuscito");
        assert!(res.has_update);
        assert_eq!(res.current_version, "18.0.4");
        assert_eq!(res.latest_version, "18.0.5");
    }

    #[test]
    fn test_parse_omp_update_check_con_ansi() {
        let stdout = "\x1b[2mCurrent version: 18.0.4\x1b[22m\n\x1b[36mNew version available: 18.0.5\x1b[39m\n";
        let res = parse_omp_update_check(stdout, "", true, "18.0.4").expect("parsing riuscito");
        assert!(res.has_update);
        assert_eq!(res.current_version, "18.0.4");
        assert_eq!(res.latest_version, "18.0.5");
    }

    #[test]
    fn test_parse_omp_update_check_gia_aggiornato() {
        let stdout = "\u{2714} Already up to date\n";
        let res = parse_omp_update_check(stdout, "", true, "18.0.4").expect("parsing riuscito");
        assert!(!res.has_update);
        assert_eq!(res.current_version, "18.0.4");
    }

    #[test]
    fn test_parse_omp_update_check_switching_canary() {
        let stdout = "Current version: 18.0.4\nSwitching to canary 18.1.0 (downgrade from 18.0.4)\n";
        let res = parse_omp_update_check(stdout, "", true, "18.0.4").expect("parsing riuscito");
        assert!(res.has_update);
        assert_eq!(res.latest_version, "18.1.0");
    }

    #[test]
    fn test_parse_omp_update_check_fallito() {
        let stderr = "Failed to check for updates: network timeout\n";
        let res = parse_omp_update_check("", stderr, false, "18.0.4");
        assert!(res.is_err());
    }

    #[test]
    fn test_sanitize_fts_query_evita_caratteri_speciali() {
        let q = sanitize_fts_query("errore: \"crash\" (subito)");
        assert_eq!(q, "\"errore: \"\"crash\"\" (subito)\"");

        let simple = sanitize_fts_query("ricerca");
        assert_eq!(simple, "\"ricerca\"");
    }

    #[test]
    fn test_sqlite_readonly_impedisce_scritture() {
        let temp_dir = std::env::temp_dir();
        let unique_name = format!(
            "test_omp_readonly_{}_{}.db",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos()
        );
        let db_path = temp_dir.join(unique_name);
        let _ = std::fs::remove_file(&db_path);

        // Crea db di test iniziale
        {
            let conn = Connection::open(&db_path).expect("creazione db test");
            conn.execute_batch(
                "CREATE TABLE IF NOT EXISTS test (id INTEGER PRIMARY KEY, val TEXT);
                 INSERT INTO test (val) VALUES ('valore iniziale');",
            )
            .expect("setup tabelle");
        }

        // Apre con le modalita' read-only di open_readonly_db
        let conn = Connection::open_with_flags(
            &db_path,
            OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
        )
        .expect("apertura readonly");
        conn.execute_batch("PRAGMA query_only = ON; PRAGMA busy_timeout = 3000;")
            .expect("pragma setup");

        // Verifica che la lettura funzioni
        let val: String = conn
            .query_row("SELECT val FROM test WHERE id = 1", [], |r| r.get(0))
            .expect("lettura consentita");
        assert_eq!(val, "valore iniziale");

        // Verifica che qualsiasi scrittura fallisca categoricamente (read-only)
        let write_result = conn.execute("INSERT INTO test (val) VALUES ('tentativo write')", []);
        assert!(write_result.is_err(), "La scrittura su db readonly DEVE fallire");

        let update_result = conn.execute("UPDATE test SET val = 'modificato' WHERE id = 1", []);
        assert!(update_result.is_err(), "L'update su db readonly DEVE fallire");

        // Pulizia
        let _ = std::fs::remove_file(db_path);
    }
}
