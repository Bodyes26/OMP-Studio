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
