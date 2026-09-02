use parking_lot::Mutex;
use rusqlite::{Connection, OpenFlags};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::fs::File;
use std::io::{BufRead, BufReader, Read, Seek, SeekFrom};
#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;
use std::path::Path;
use std::path::PathBuf;
use std::process::Command;
use std::sync::LazyLock;
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

pub(crate) fn open_readonly_db(db_name: &str) -> Result<Connection, String> {
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

/// Le sorgenti di quota aggiuntive (sotto) si fondono qui: il popover mostra
/// qualunque provider trovi in `reports[]`, senza conoscerne nessuno.
#[command]
pub async fn usage_snapshot(_force: bool) -> Result<UsageReport, String> {
    let mut report = tokio::task::spawn_blocking(usage_snapshot_sync)
        .await
        .map_err(|e| format!("Task usage_snapshot: {}", e))??;
    let extra = extra_usage_reports().await;
    merge_extra_reports(&mut report.raw_json, extra, now_ms());
    Ok(report)
}

// --- Sorgenti di quota aggiuntive ---
//
// `omp usage --json` non carica ne' estensioni ne' plugin: il suo percorso CLI
// istanzia un `ModelRegistry` nudo (upstream
// `packages/coding-agent/src/cli/usage-cli.ts:1102`), quindi un provider
// aggiunto da un plugin resta senza report anche quando l'API per leggerne la
// quota esiste. Studio non conosce nessun provider in particolare: esegue il
// comando che l'utente dichiara e si aspetta sullo stdout la stessa forma di
// `omp usage --json`. Cartella assente o vuota: comportamento identico a prima.

const USAGE_SOURCE_TIMEOUT_DEFAULT: u64 = 15;
const USAGE_SOURCE_TIMEOUT_MAX: u64 = 60;
/// Oltre questa soglia lo stdout non e' un report di quota ma un incidente.
const USAGE_SOURCE_MAX_BYTES: usize = 2 * 1024 * 1024;

/// Descrittore in `%LOCALAPPDATA%/omp-studio/usage-sources/<nome>.json`
/// (`~/.omp-studio/usage-sources` altrove).
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct UsageSourceSpec {
    command: String,
    #[serde(default)]
    args: Vec<String>,
    #[serde(default)]
    cwd: Option<String>,
    #[serde(default)]
    timeout_sec: Option<u64>,
    #[serde(default = "usage_source_default_enabled")]
    enabled: bool,
}

fn usage_source_default_enabled() -> bool {
    true
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn usage_sources_dir() -> Option<PathBuf> {
    let base = if cfg!(target_os = "windows") {
        std::env::var("LOCALAPPDATA")
            .ok()
            .filter(|v| !v.trim().is_empty())?
    } else {
        std::env::var("HOME")
            .ok()
            .filter(|v| !v.trim().is_empty())?
    };
    Some(
        PathBuf::from(base)
            .join(if cfg!(target_os = "windows") {
                "omp-studio"
            } else {
                ".omp-studio"
            })
            .join("usage-sources"),
    )
}

/// Descrittori validi, in ordine di nome file: un JSON malformato viene
/// ignorato senza toccare gli altri.
fn usage_source_specs() -> Vec<(String, UsageSourceSpec)> {
    let Some(dir) = usage_sources_dir() else {
        return Vec::new();
    };
    let Ok(entries) = std::fs::read_dir(&dir) else {
        return Vec::new();
    };

    let mut specs: Vec<(String, UsageSourceSpec)> = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("json") {
            continue;
        }
        let Ok(text) = std::fs::read_to_string(&path) else {
            continue;
        };
        match serde_json::from_str::<UsageSourceSpec>(&text) {
            Ok(spec) if spec.enabled => {
                let name = path
                    .file_stem()
                    .map(|s| s.to_string_lossy().to_string())
                    .unwrap_or_default();
                specs.push((name, spec));
            }
            Ok(_) => {}
            Err(e) => eprintln!("[usage-source] {} non valido: {}", path.display(), e),
        }
    }
    specs.sort_by(|a, b| a.0.cmp(&b.0));
    specs
}

/// Accetta le tre forme che una sorgente puo' emettere: `{"reports":[…]}`,
/// un array di report, o un singolo report. Scarta tutto cio' che non ha un
/// `provider` non vuoto.
fn reports_from_source_output(stdout: &[u8]) -> Vec<serde_json::Value> {
    let Ok(value) = serde_json::from_slice::<serde_json::Value>(stdout) else {
        return Vec::new();
    };
    let candidates = match value {
        serde_json::Value::Array(items) => items,
        serde_json::Value::Object(mut map) => match map.remove("reports") {
            Some(serde_json::Value::Array(items)) => items,
            _ => vec![serde_json::Value::Object(map)],
        },
        _ => return Vec::new(),
    };
    candidates
        .into_iter()
        .filter(|item| {
            item.get("provider")
                .and_then(|p| p.as_str())
                .is_some_and(|p| !p.trim().is_empty())
        })
        .collect()
}

/// I report di `omp usage` vincono: una sorgente aggiuntiva non puo' oscurare
/// un provider che ha gia' dati reali.
fn merge_extra_reports(
    snapshot: &mut serde_json::Value,
    extra: Vec<serde_json::Value>,
    now_ms: u64,
) {
    if extra.is_empty() {
        return;
    }
    let Some(root) = snapshot.as_object_mut() else {
        return;
    };
    let list = root
        .entry("reports")
        .or_insert_with(|| serde_json::Value::Array(Vec::new()));
    let Some(list) = list.as_array_mut() else {
        return;
    };

    let mut seen: HashSet<String> = list
        .iter()
        .filter_map(|r| r.get("provider").and_then(|p| p.as_str()))
        .map(|p| p.trim().to_lowercase())
        .collect();

    for mut report in extra {
        let provider = report
            .get("provider")
            .and_then(|p| p.as_str())
            .unwrap_or_default()
            .trim()
            .to_lowercase();
        if provider.is_empty() || !seen.insert(provider) {
            continue;
        }
        if let Some(obj) = report.as_object_mut() {
            obj.entry("fetchedAt")
                .or_insert_with(|| serde_json::Value::from(now_ms));
        }
        list.push(report);
    }
}

async fn run_usage_source(name: &str, spec: &UsageSourceSpec) -> Vec<serde_json::Value> {
    let mut cmd = tokio::process::Command::new(&spec.command);
    cmd.args(&spec.args)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .kill_on_drop(true);
    if let Some(cwd) = &spec.cwd {
        cmd.current_dir(cwd);
    }

    #[cfg(target_os = "windows")]
    {
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    let limit = Duration::from_secs(
        spec.timeout_sec
            .unwrap_or(USAGE_SOURCE_TIMEOUT_DEFAULT)
            .clamp(1, USAGE_SOURCE_TIMEOUT_MAX),
    );

    let mut child = match cmd.spawn() {
        Ok(child) => child,
        Err(e) => {
            eprintln!(
                "[usage-source {}] avvio di `{}` fallito: {}",
                name, spec.command, e
            );
            return Vec::new();
        }
    };

    let mut stdout_buf = Vec::new();
    let mut stderr_buf = Vec::new();

    let read_future = async {
        use tokio::io::AsyncReadExt;
        if let Some(mut stdout) = child.stdout.take() {
            let mut handle = (&mut stdout).take(USAGE_SOURCE_MAX_BYTES as u64 + 1);
            let _ = handle.read_to_end(&mut stdout_buf).await;
        }
        if let Some(mut stderr) = child.stderr.take() {
            let mut handle = (&mut stderr).take(16 * 1024);
            let _ = handle.read_to_end(&mut stderr_buf).await;
        }
        child.wait().await
    };

    match tokio::time::timeout(limit, read_future).await {
        Ok(Ok(status)) if status.success() && stdout_buf.len() <= USAGE_SOURCE_MAX_BYTES => {
            let reports = reports_from_source_output(&stdout_buf);
            if reports.is_empty() {
                eprintln!(
                    "[usage-source {}] nessun report riconosciuto sullo stdout",
                    name
                );
            }
            reports
        }
        Ok(Ok(status)) => {
            eprintln!(
                "[usage-source {}] uscita {:?}, {} byte di stdout: {}",
                name,
                status.code(),
                stdout_buf.len(),
                String::from_utf8_lossy(&stderr_buf).trim()
            );
            Vec::new()
        }
        Ok(Err(e)) => {
            eprintln!(
                "[usage-source {}] errore durante l'esecuzione di `{}`: {}",
                name, spec.command, e
            );
            Vec::new()
        }
        Err(_) => {
            eprintln!("[usage-source {}] scaduto dopo {:?}", name, limit);
            Vec::new()
        }
    }
}

async fn extra_usage_reports() -> Vec<serde_json::Value> {
    let specs = tokio::task::spawn_blocking(usage_source_specs)
        .await
        .unwrap_or_default();
    let mut reports = Vec::new();
    for (name, spec) in &specs {
        reports.extend(run_usage_source(name, spec).await);
    }
    reports
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

/// Vero quando la sessione ha un transcript su disco.
///
/// `omp --resume <id>` cerca il file della sessione: una sessione senza
/// messaggi non ne ha ancora uno (lo scrive col primo messaggio), quindi il
/// resume esce con «Session not found» e la superficie resta senza agente.
/// Il breadcrumb non basta a distinguerli: il marcatore `fresh` manca su molti
/// breadcrumb il cui `.jsonl` non esiste comunque.
fn transcript_exists_in(sessions_root: &Path, session_id: &str) -> bool {
    if session_id.is_empty() {
        return false;
    }
    let Ok(folders) = std::fs::read_dir(sessions_root) else {
        return false;
    };
    for folder in folders.flatten() {
        let Ok(files) = std::fs::read_dir(folder.path()) else {
            continue;
        };
        for file in files.flatten() {
            let path = file.path();
            if path.extension().and_then(|ext| ext.to_str()) != Some("jsonl") {
                continue;
            }
            let Some(stem) = path.file_stem().and_then(|stem| stem.to_str()) else {
                continue;
            };
            // Nome file: `<timestamp>_<sessionId>.jsonl`. `--resume` accetta
            // anche un prefisso dell'id, quindi il confronto lo ammette.
            let candidate = stem.rsplit('_').next().unwrap_or(stem);
            if candidate.starts_with(session_id) {
                return true;
            }
        }
    }
    false
}

pub fn session_transcript_exists(session_id: &str) -> bool {
    let Some(agent) = agent_dir() else {
        return false;
    };
    transcript_exists_in(&agent.join("sessions"), session_id)
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
    pub project_path: String,
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

        let project_path = cwd.trim_end_matches('\r').to_string();
        let project_name = project_from_cwd(&project_path);
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
                let dedupe_key = (project_path.clone(), provider.clone());
                let candidate = ProviderHost {
                    provider,
                    model,
                    host: host_name.clone(),
                    project: project_name.clone(),
                    project_path: project_path.clone(),
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
    hosts.sort_by_key(|right| std::cmp::Reverse(right.last_active_ms));
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

/// Quante sessioni tornano al massimo alla GUI.
const SESSION_LIST_LIMIT: usize = 50;

/// Righe iniziali entro cui cercare intestazione e primo prompt.
const HEADER_LINES: usize = 20;

/// Tetto di byte letti per l'intestazione: `id` e `cwd` stanno nelle prime
/// centinaia di byte, il resto sarebbe solo un transcript da megabyte.
const HEADER_BYTES: u64 = 64 * 1024;

/// Tetto di byte letti quando serve il primo prompt come titolo di ripiego.
const PROMPT_BYTES: u64 = 512 * 1024;

/// Un titolo lungo non si vede comunque nella colonna: oltre questo si taglia.
const TITLE_CHARS: usize = 200;

/// Intestazione di un transcript. `id` e `cwd` vengono scritti alla creazione
/// del file e non cambiano piu': si leggono una volta sola. `title` e' il
/// titolo ricavato dal file stesso (record `title`, `session.title` o primo
/// prompt) e puo' arrivare in un secondo momento.
#[derive(Clone)]
struct CachedSession {
    id: String,
    cwd: String,
    title: Option<String>,
}

/// Cache di processo delle intestazioni. Senza, ogni cambio progetto e ogni
/// ritorno di focus rileggeva tutti i transcript di tutti i progetti: con 700
/// sessioni sono ~70 MB di JSON da parsare, oltre un minuto a freddo.
static SESSION_HEADERS: LazyLock<Mutex<HashMap<PathBuf, CachedSession>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

fn truncate_title(text: &str) -> String {
    let trimmed = text.trim();
    match trimmed.char_indices().nth(TITLE_CHARS) {
        Some((cut, _)) => trimmed[..cut].to_string(),
        None => trimmed.to_string(),
    }
}

/// Legge le sole righe di intestazione e si ferma appena ha `id` e `cwd`.
/// Ritorna `None` se il file non e' un transcript riconoscibile.
fn read_session_header(path: &Path) -> Option<CachedSession> {
    let file = File::open(path).ok()?;
    let reader = BufReader::new(file.take(HEADER_BYTES));
    let mut header_title = None;
    let mut session_id = None;
    let mut session_cwd = None;

    for line in reader.lines().take(HEADER_LINES).map_while(Result::ok) {
        let Ok(val) = serde_json::from_str::<serde_json::Value>(&line) else {
            continue;
        };
        match val.get("type").and_then(|t| t.as_str()).unwrap_or("") {
            "title" => {
                if let Some(t) = val.get("title").and_then(|t| t.as_str()) {
                    if !t.is_empty() {
                        header_title = Some(truncate_title(t));
                    }
                }
            }
            "session" => {
                session_id = val
                    .get("id")
                    .and_then(|i| i.as_str())
                    .map(|i| i.to_string());
                session_cwd = val
                    .get("cwd")
                    .and_then(|c| c.as_str())
                    .map(|c| c.to_string());
                if header_title.is_none() {
                    if let Some(t) = val.get("title").and_then(|t| t.as_str()) {
                        if !t.is_empty() {
                            header_title = Some(truncate_title(t));
                        }
                    }
                }
                if session_id.is_some() && session_cwd.is_some() {
                    break;
                }
            }
            _ => {}
        }
    }

    Some(CachedSession {
        id: session_id?,
        cwd: session_cwd?,
        title: header_title,
    })
}

fn cached_header(path: &Path) -> Option<CachedSession> {
    if let Some(hit) = SESSION_HEADERS.lock().get(path) {
        return Some(hit.clone());
    }
    let header = read_session_header(path)?;
    SESSION_HEADERS
        .lock()
        .insert(path.to_path_buf(), header.clone());
    Some(header)
}

/// Titolo di ripiego: il primo messaggio dell'utente. Costa la lettura di
/// parecchie righe di transcript, quindi si fa solo per le sessioni del
/// progetto cercato e il risultato resta in cache.
fn resolve_title_from_file(path: &Path) -> Option<String> {
    let file = File::open(path).ok()?;
    let reader = BufReader::new(file.take(PROMPT_BYTES));
    let mut prompt = None;

    for line in reader.lines().take(HEADER_LINES).map_while(Result::ok) {
        let Ok(val) = serde_json::from_str::<serde_json::Value>(&line) else {
            continue;
        };
        if val.get("type").and_then(|t| t.as_str()) != Some("message") {
            continue;
        }
        let Some(message) = val.get("message") else {
            continue;
        };
        if message.get("role").and_then(|r| r.as_str()) != Some("user") {
            continue;
        }
        let Some(content) = message.get("content") else {
            continue;
        };
        if let Some(text) = content.as_str() {
            prompt = Some(truncate_title(text));
        } else if let Some(arr) = content.as_array() {
            for part in arr {
                if part.get("type").and_then(|t| t.as_str()) == Some("text") {
                    if let Some(txt) = part.get("text").and_then(|t| t.as_str()) {
                        prompt = Some(truncate_title(txt));
                        break;
                    }
                }
            }
        }
        if prompt.is_some() {
            break;
        }
    }

    let prompt = prompt?;
    if let Some(entry) = SESSION_HEADERS.lock().get_mut(path) {
        entry.title = Some(prompt.clone());
    }
    Some(prompt)
}

fn scan_sessions_from_disk(
    project_path: &str,
    query: Option<&str>,
    titles: &HashMap<String, String>,
) -> Vec<SessionEntry> {
    let Some(agent) = agent_dir() else {
        return Vec::new();
    };
    scan_sessions_in(&agent.join("sessions"), project_path, query, titles)
}

fn scan_sessions_in(
    sessions_root: &Path,
    project_path: &str,
    query: Option<&str>,
    titles: &HashMap<String, String>,
) -> Vec<SessionEntry> {
    let target_norm = normalize_path_for_compare(project_path);

    let Ok(dir_entries) = std::fs::read_dir(sessions_root) else {
        return Vec::new();
    };

    // Fase 1: solo le intestazioni. Scartare il transcript di un altro
    // progetto costa poche centinaia di byte, non l'intero file.
    let mut candidates: Vec<(PathBuf, CachedSession, i64)> = Vec::new();
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
            let Some(header) = cached_header(&path) else {
                continue;
            };
            if normalize_path_for_compare(&header.cwd) != target_norm {
                continue;
            }
            let mtime = file_entry
                .metadata()
                .and_then(|m| m.modified())
                .ok()
                .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                .map(|d| d.as_secs() as i64)
                .unwrap_or(0);
            candidates.push((path, header, mtime));
        }
    }

    candidates.sort_by_key(|right| std::cmp::Reverse(right.2));
    // Senza ricerca la GUI mostra le piu' recenti: il titolo va risolto solo
    // per quelle, non per tutto lo storico del progetto.
    if query.is_none() {
        candidates.truncate(SESSION_LIST_LIMIT);
    }

    let query_lower = query
        .map(|q| q.trim().to_lowercase())
        .filter(|q| !q.is_empty());

    // Fase 2: il titolo. Si legge il transcript solo quando manca sia in
    // history.db sia nell'intestazione.
    let mut found = Vec::with_capacity(candidates.len());
    for (path, header, mtime) in candidates {
        let title = titles
            .get(&header.id)
            .map(|t| truncate_title(t))
            .or(header.title)
            .or_else(|| resolve_title_from_file(&path))
            .unwrap_or_else(|| "Nuova sessione".to_string());

        if let Some(q) = &query_lower {
            if !title.to_lowercase().contains(q) && !header.id.to_lowercase().contains(q) {
                continue;
            }
        }

        found.push(SessionEntry {
            id: header.id,
            title,
            created_at: mtime,
        });
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

    sessions.sort_by_key(|b| std::cmp::Reverse(b.created_at));
    sessions.truncate(SESSION_LIST_LIMIT);

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

    sessions.sort_by_key(|b| std::cmp::Reverse(b.created_at));
    sessions.truncate(SESSION_LIST_LIMIT);

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
                if let Some(candidate) = right.split_whitespace().next() {
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
            if let Some(candidate) = right.split_whitespace().next() {
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
    fn accetta_le_tre_forme_di_output_di_una_sorgente() {
        let wrapped = br#"{"reports":[{"provider":"acme","limits":[]}]}"#;
        let bare_array = br#"[{"provider":"acme"},{"limits":[]}]"#;
        let single = br#"{"provider":"acme","fetchedAt":7}"#;

        assert_eq!(reports_from_source_output(wrapped).len(), 1);
        // Il secondo elemento non ha `provider`: scartato.
        assert_eq!(reports_from_source_output(bare_array).len(), 1);
        assert_eq!(reports_from_source_output(single).len(), 1);

        assert!(reports_from_source_output(b"non json").is_empty());
        assert!(reports_from_source_output(br#"{"provider":"  "}"#).is_empty());
        assert!(reports_from_source_output(b"42").is_empty());
    }

    #[test]
    fn fonde_le_sorgenti_senza_oscurare_i_report_di_omp() {
        let mut snapshot = serde_json::json!({
            "generatedAt": 1,
            "reports": [{ "provider": "anthropic", "limits": [] }]
        });
        let extra = reports_from_source_output(
            br#"[{"provider":"Anthropic","limits":[{"id":"falso"}]},{"provider":"commandcode","limits":[]}]"#,
        );

        merge_extra_reports(&mut snapshot, extra, 1234);

        let reports = snapshot["reports"].as_array().expect("array di report");
        assert_eq!(reports.len(), 2, "il duplicato di anthropic va scartato");
        assert_eq!(reports[0]["provider"], "anthropic");
        assert!(reports[0]["limits"].as_array().unwrap().is_empty());
        assert_eq!(reports[1]["provider"], "commandcode");
        // `fetchedAt` assente nella sorgente: lo timbra Studio.
        assert_eq!(reports[1]["fetchedAt"], 1234);
    }

    #[test]
    fn preserva_il_fetched_at_dichiarato_e_crea_reports_se_manca() {
        let mut snapshot = serde_json::json!({ "generatedAt": 1 });
        let extra = reports_from_source_output(br#"{"provider":"acme","fetchedAt":99}"#);

        merge_extra_reports(&mut snapshot, extra, 1234);

        let reports = snapshot["reports"].as_array().expect("array di report");
        assert_eq!(reports.len(), 1);
        assert_eq!(reports[0]["fetchedAt"], 99);
    }

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
    fn riconosce_le_sessioni_con_transcript_su_disco() {
        let root = std::env::temp_dir().join(format!(
            "omp-studio-sessions-{}-{:?}",
            std::process::id(),
            std::thread::current().id()
        ));
        let _ = std::fs::remove_dir_all(&root);
        let progetto = root.join("-source-repos-app");
        std::fs::create_dir_all(&progetto).unwrap();
        std::fs::write(
            progetto.join("2026-08-28T07-24-00-669Z_01a04741-0d1d-73fa-8437-7b15b016d35c.jsonl"),
            "{}\n",
        )
        .unwrap();
        // Il breadcrumb di una sessione senza messaggi punta a un file che non
        // esiste: nessun `.jsonl`, nessun resume possibile.
        std::fs::write(progetto.join("note.txt"), "non e' un transcript").unwrap();

        assert!(transcript_exists_in(
            &root,
            "01a04741-0d1d-73fa-8437-7b15b016d35c"
        ));
        // `--resume` accetta anche il prefisso dell'id.
        assert!(transcript_exists_in(&root, "01a04741"));
        assert!(!transcript_exists_in(
            &root,
            "01a0473c-187f-74fa-8ac2-f34e6b11fa91"
        ));
        assert!(!transcript_exists_in(&root, ""));
        assert!(!transcript_exists_in(&root.join("inesistente"), "01a04741"));

        let _ = std::fs::remove_dir_all(&root);
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

    #[test]
    fn elenca_solo_le_sessioni_del_progetto_richiesto() {
        let root = std::env::temp_dir().join(format!(
            "omp-studio-scan-{}-{:?}",
            std::process::id(),
            std::thread::current().id()
        ));
        let _ = std::fs::remove_dir_all(&root);
        let mio = root.join("-source-repos-app");
        let altro = root.join("-source-repos-altro");
        std::fs::create_dir_all(&mio).unwrap();
        std::fs::create_dir_all(&altro).unwrap();

        // Titolo dal primo prompt: l'intestazione lo ha vuoto.
        std::fs::write(
            mio.join("2026-08-28T07-24-00-669Z_aaa.jsonl"),
            concat!(
                "{\"type\":\"title\",\"title\":\"\"}\n",
                "{\"type\":\"session\",\"id\":\"aaa\",\"cwd\":\"C:\\\\repos\\\\app\"}\n",
                "{\"type\":\"message\",\"message\":{\"role\":\"user\",\"content\":\"prima domanda\"}}\n",
            ),
        )
        .unwrap();
        // Titolo nell'intestazione: nessuna lettura oltre.
        std::fs::write(
            mio.join("2026-08-28T08-24-00-669Z_bbb.jsonl"),
            concat!(
                "{\"type\":\"title\",\"title\":\"Titolo scritto\"}\n",
                "{\"type\":\"session\",\"id\":\"bbb\",\"cwd\":\"c:/repos/app/\"}\n",
            ),
        )
        .unwrap();
        // Altro progetto: va scartato sulla sola intestazione.
        std::fs::write(
            altro.join("2026-08-28T09-24-00-669Z_ccc.jsonl"),
            "{\"type\":\"session\",\"id\":\"ccc\",\"cwd\":\"C:\\\\repos\\\\altro\"}\n",
        )
        .unwrap();

        let mut titles = HashMap::new();
        titles.insert("aaa".to_string(), "Titolo dal database".to_string());

        let trovate = scan_sessions_in(&root, "C:\\repos\\app", None, &titles);
        let ids: Vec<&str> = trovate.iter().map(|s| s.id.as_str()).collect();
        assert!(ids.contains(&"aaa"), "sessione del progetto assente");
        assert!(ids.contains(&"bbb"), "sessione del progetto assente");
        assert!(!ids.contains(&"ccc"), "sessione di un altro progetto inclusa");

        // history.db ha la precedenza sul contenuto del file.
        let aaa = trovate.iter().find(|s| s.id == "aaa").unwrap();
        assert_eq!(aaa.title, "Titolo dal database");
        let bbb = trovate.iter().find(|s| s.id == "bbb").unwrap();
        assert_eq!(bbb.title, "Titolo scritto");

        // Senza titolo noto si ripiega sul primo prompt dell'utente.
        let senza_titoli = scan_sessions_in(&root, "C:\\repos\\app", None, &HashMap::new());
        let aaa = senza_titoli.iter().find(|s| s.id == "aaa").unwrap();
        assert_eq!(aaa.title, "prima domanda");

        // La ricerca filtra sul titolo risolto.
        let cercate = scan_sessions_in(&root, "C:\\repos\\app", Some("scritto"), &titles);
        assert_eq!(cercate.len(), 1);
        assert_eq!(cercate[0].id, "bbb");

        let _ = std::fs::remove_dir_all(&root);
    }
}
