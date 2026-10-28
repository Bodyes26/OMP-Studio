//! Indice SQLite unificato delle sessioni di OMP Studio.
//!
//! Memorizza i metadati delle sessioni (ID, percorsi, mtime, dimensione, primo prompt,
//! titolo OMP, titolo Studio e timestamp) per consentire scansioni incrementali istantanee,
//! query delle sessioni senza titolo per la generazione automatica in background,
//! e sostituzione definitiva della cache in-memory `SESSION_HEADERS` e del file `session-titles.json`.

use rusqlite::{params, Connection, OpenFlags};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs::{self, File};
use std::io::{BufRead, BufReader, Read};
use std::path::Path;
use std::sync::{Arc, LazyLock, Mutex};
use std::time::{Instant, UNIX_EPOCH};
use tauri::{command, AppHandle, Manager};

/// Quante sessioni tornano al massimo alla GUI.
const SESSION_LIST_LIMIT: usize = 50;

/// Righe massime entro cui cercare intestazione e primo prompt.
const HEADER_LINES: usize = 50;

/// Byte massimi da esaminare all'inizio di un transcript jsonl.
const PROMPT_BYTES: u64 = 512 * 1024;

/// Limite caratteri per il titolo o prompt sintetico.
const TITLE_CHARS: usize = 200;

/// Statistiche dell'operazione di refresh incrementale dell'indice.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SessionIndexStats {
    pub scanned: u32,
    pub updated: u32,
    pub removed: u32,
    pub duration_ms: u64,
}

/// Sessione senza titolo candidata per la titolazione automatica.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct UntitledSession {
    pub session_id: String,
    pub prompt: String,
}

/// Voce singola di sessione restituita a `sessions_list`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SessionEntry {
    pub id: String,
    pub title: Option<String>,
    pub prompt: String,
    pub created_at: i64,
}

/// Metadati estratti dalla scansione di un singolo transcript `.jsonl`.
#[derive(Debug, Clone)]
pub struct ParsedSessionInfo {
    pub session_id: String,
    pub project_path: String,
    pub header_title: Option<String>,
    pub first_prompt: Option<String>,
}

/// Normalizza i percorsi per confronti cross-platform (Windows backslash vs slash e case-insensitivity).
pub fn normalize_path_for_compare(path: &str) -> String {
    path.replace('\\', "/").trim_end_matches('/').to_lowercase()
}

/// Tronca il testo alla lunghezza massima accettata per la visualizzazione nella lista.
pub fn truncate_title(text: &str) -> String {
    let trimmed = text.trim();
    match trimmed.char_indices().nth(TITLE_CHARS) {
        Some((cut, _)) => trimmed[..cut].to_string(),
        None => trimmed.to_string(),
    }
}

/// Risolve il titolo applicando la precedenza: 1. omp (history.db), 2. header (jsonl), 3. studio.
pub fn resolve_entry_title(
    omp_title: Option<String>,
    header_title: Option<String>,
    studio_title: Option<String>,
) -> Option<String> {
    omp_title
        .filter(|t| !t.trim().is_empty())
        .map(|t| truncate_title(&t))
        .or_else(|| header_title.filter(|t| !t.trim().is_empty()).map(|t| truncate_title(&t)))
        .or_else(|| studio_title.filter(|t| !t.trim().is_empty()).map(|t| truncate_title(&t)))
}

/// Filtro di ricerca testuale sul titolo, prompt o ID sessione.
pub fn matches_query(entry: &SessionEntry, query_lower: &str) -> bool {
    entry
        .title
        .as_deref()
        .is_some_and(|t| t.to_lowercase().contains(query_lower))
        || entry.prompt.to_lowercase().contains(query_lower)
        || entry.id.to_lowercase().contains(query_lower)
}

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

/// Nomi (minuscoli) che `omp` puo' dare alla cartella delle sessioni di
/// `project_path`: relativo alla home, alla cartella temporanea o assoluto.
/// Li usa anche `stats.db`, che chiama `folder` lo stesso nome.
pub fn session_folder_candidates(project_path: &str) -> Vec<String> {
    let trimmed_proj = project_path.trim_end_matches(['/', '\\']);
    let mut candidates = Vec::with_capacity(3);
    if trimmed_proj.is_empty() {
        return candidates;
    }

    // Formato assoluto dcs: `--<disco>--<percorso>--`
    let abs_raw = trimmed_proj.trim_start_matches(['/', '\\']).replace(['/', '\\', ':'], "-");
    candidates.push(format!("--{}--", abs_raw).to_lowercase());

    let p_norm = trimmed_proj.replace('\\', "/").to_lowercase();

    // Se sotto la home utente
    if let Some(home) = get_user_home() {
        let h_norm = home.trim_end_matches(['/', '\\']).replace('\\', "/").to_lowercase();
        if p_norm == h_norm {
            candidates.push("-".to_string());
        } else if let Some(rel) = p_norm.strip_prefix(&format!("{}/", h_norm)) {
            candidates.push(format!("-{}", rel.replace('/', "-")));
        }
    }

    // Se sotto la cartella temporanea
    let temp_dir = std::env::temp_dir();
    let temp_str = temp_dir.to_string_lossy();
    let t_norm = temp_str.trim_end_matches(['/', '\\']).replace('\\', "/").to_lowercase();
    if p_norm == t_norm {
        candidates.push("-tmp".to_string());
    } else if let Some(rel) = p_norm.strip_prefix(&format!("{}/", t_norm)) {
        candidates.push(format!("-tmp-{}", rel.replace('/', "-")));
    }

    candidates
}

/// Verifica euristica per evitare di aprire cartelle di sessioni di altri progetti.
pub fn session_folder_might_match(folder_name: &str, project_path: &str) -> bool {
    let trimmed_proj = project_path.trim_end_matches(['/', '\\']);
    if trimmed_proj.is_empty() {
        return true;
    }

    let folder_lower = folder_name.to_lowercase();

    // 1. Tolleranza sul nome finale del progetto (basename / slug)
    let normalized_proj = trimmed_proj.replace('\\', "/");
    if let Some(base) = Path::new(&normalized_proj).file_name().and_then(|b| b.to_str()) {
        let base_clean = base.trim().to_lowercase();
        if !base_clean.is_empty() {
            let suffix1 = format!("-{}", base_clean);
            let suffix2 = format!("-{}--", base_clean);
            let exact_dcs = format!("--{}--", base_clean);
            if folder_lower == exact_dcs
                || folder_lower.ends_with(&suffix1)
                || folder_lower.ends_with(&suffix2)
            {
                return true;
            }
        }
    }

    // 2. Controllo contro i candidati esatti calcolati da omp
    if session_folder_candidates(trimmed_proj).contains(&folder_lower) {
        return true;
    }

    // Se la cartella inizia per "home-", "tmp-" o "abs-" (formato legacy con sha256)
    if (folder_lower.starts_with("home-") || folder_lower.starts_with("tmp-") || folder_lower.starts_with("abs-"))
        && folder_lower.len() > 64
    {
        if let Some(base) = Path::new(trimmed_proj).file_name().and_then(|b| b.to_str()) {
            let base_lower = base.to_lowercase();
            if folder_lower.contains(&base_lower) {
                return true;
            }
        }
    }

    let known_encoding = folder_lower.starts_with('-')
        || ((folder_lower.starts_with("home-")
            || folder_lower.starts_with("tmp-")
            || folder_lower.starts_with("abs-"))
            && folder_lower.len() > 64);
    !known_encoding
}

/// Esegue il parsing in un'unica passata delle prime righe del file transcript `.jsonl`.
pub fn parse_session_file(path: &Path) -> Option<ParsedSessionInfo> {
    let file = File::open(path).ok()?;
    let reader = BufReader::new(file.take(PROMPT_BYTES));

    let mut session_id = None;
    let mut project_path = None;
    let mut header_title = None;
    let mut first_prompt = None;

    for line in reader.lines().take(HEADER_LINES).map_while(Result::ok) {
        let Ok(val) = serde_json::from_str::<serde_json::Value>(&line) else {
            continue;
        };

        match val.get("type").and_then(|t| t.as_str()).unwrap_or("") {
            "title" => {
                if let Some(t) = val.get("title").and_then(|t| t.as_str()) {
                    if !t.trim().is_empty() {
                        header_title = Some(truncate_title(t));
                    }
                }
            }
            "session" => {
                if let Some(id) = val.get("id").and_then(|i| i.as_str()) {
                    session_id = Some(id.to_string());
                }
                if let Some(cwd) = val.get("cwd").and_then(|c| c.as_str()) {
                    project_path = Some(cwd.to_string());
                }
                if header_title.is_none() {
                    if let Some(t) = val.get("title").and_then(|t| t.as_str()) {
                        if !t.trim().is_empty() {
                            header_title = Some(truncate_title(t));
                        }
                    }
                }
            }
            "message" => {
                if first_prompt.is_none() {
                    if let Some(message) = val.get("message") {
                        if message.get("role").and_then(|r| r.as_str()) == Some("user") {
                            if let Some(content) = message.get("content") {
                                if let Some(text) = content.as_str() {
                                    first_prompt = Some(truncate_title(text));
                                } else if let Some(arr) = content.as_array() {
                                    for part in arr {
                                        if part.get("type").and_then(|t| t.as_str()) == Some("text") {
                                            if let Some(txt) = part.get("text").and_then(|t| t.as_str()) {
                                                first_prompt = Some(truncate_title(txt));
                                                break;
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
            _ => {}
        }
        if session_id.is_some() && project_path.is_some() && first_prompt.is_some() && header_title.is_some() {
            break;
        }
    }

    Some(ParsedSessionInfo {
        session_id: session_id?,
        project_path: project_path?,
        header_title,
        first_prompt,
    })
}

/// Gestore dell'indice SQLite per le sessioni di Studio.
pub struct SessionIndex {
    conn: Mutex<Connection>,
}

impl SessionIndex {
    /// Inizializza lo schema e le tabelle sul database SQLite indicato.
    /// Ritorna il riferimento al mutex della connessione SQLite interna.
    pub fn conn(&self) -> &Mutex<Connection> {
        &self.conn
    }

    fn init_connection(conn: &Connection) -> Result<(), String> {
        conn.execute_batch(
            "PRAGMA journal_mode = WAL;
             PRAGMA synchronous = NORMAL;
             PRAGMA busy_timeout = 5000;
             CREATE TABLE IF NOT EXISTS sessions (
                 session_id TEXT PRIMARY KEY,
                 path TEXT,
                 project_path TEXT NOT NULL,
                 normalized_project_path TEXT NOT NULL,
                 mtime INTEGER NOT NULL,
                 size INTEGER NOT NULL,
                 header_title TEXT,
                 omp_title TEXT,
                 studio_title TEXT,
                 first_prompt TEXT,
                 created_at INTEGER NOT NULL
             );
             CREATE INDEX IF NOT EXISTS idx_sessions_norm_project ON sessions(normalized_project_path);
             CREATE INDEX IF NOT EXISTS idx_sessions_created ON sessions(created_at DESC);
             CREATE UNIQUE INDEX IF NOT EXISTS idx_sessions_path ON sessions(path) WHERE path IS NOT NULL AND path != '';"
        ).map_err(|e| format!("Inizializzazione schema indice sessioni fallita: {e}"))?;
        Ok(())
    }

    /// Apre o crea il database sul disco in `db_path`.
    pub fn open(db_path: &Path) -> Result<Self, String> {
        if let Some(parent) = db_path.parent() {
            fs::create_dir_all(parent)
                .map_err(|e| format!("Creazione cartella {}: {e}", parent.display()))?;
        }
        let conn = Connection::open(db_path)
            .map_err(|e| format!("Apertura SQLite {}: {e}", db_path.display()))?;
        Self::init_connection(&conn)?;
        Ok(Self {
            conn: Mutex::new(conn),
        })
    }

    /// Crea un indice in-memory (utile per i test unitari veloci e isolati).
    pub fn open_in_memory() -> Result<Self, String> {
        let conn = Connection::open_in_memory()
            .map_err(|e| format!("Apertura SQLite in-memory: {e}"))?;
        Self::init_connection(&conn)?;
        Ok(Self {
            conn: Mutex::new(conn),
        })
    }

    /// Migrazione una tantum da `session-titles.json` verso SQLite.
    pub fn migrate_json_titles(&self, json_path: &Path) -> Result<usize, String> {
        if !json_path.exists() {
            return Ok(0);
        }
        let bytes = fs::read(json_path)
            .map_err(|e| format!("Lettura {}: {e}", json_path.display()))?;
        let titles: HashMap<String, String> = serde_json::from_slice(&bytes)
            .map_err(|e| format!("Parsing {}: {e}", json_path.display()))?;

        let mut count = 0;
        {
            let conn = self.conn.lock().unwrap_or_else(|p| p.into_inner());
            let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
            {
                let mut stmt = tx.prepare(
                    "INSERT INTO sessions (session_id, path, project_path, normalized_project_path, mtime, size, studio_title, created_at)
                     VALUES (?1, '', '', '', 0, 0, ?2, 0)
                     ON CONFLICT(session_id) DO UPDATE SET studio_title = excluded.studio_title;"
                ).map_err(|e| e.to_string())?;

                for (session_id, title) in &titles {
                    let title = title.trim();
                    if !session_id.trim().is_empty() && !title.is_empty() {
                        stmt.execute(params![session_id, title]).map_err(|e| e.to_string())?;
                        count += 1;
                    }
                }
            }
            tx.commit().map_err(|e| e.to_string())?;
        }

        // Rinomina il json originale in .migrated
        let migrated_path = json_path.with_extension("json.migrated");
        if migrated_path.exists() {
            let _ = fs::remove_file(&migrated_path);
        }
        if let Err(_) = fs::rename(json_path, &migrated_path) {
            let _ = fs::remove_file(json_path);
        }

        Ok(count)
    }

    /// Salva o aggiorna il titolo generato da Studio per una determinata sessione.
    pub fn save_title(&self, session_id: &str, title: &str) -> Result<(), String> {
        let conn = self.conn.lock().unwrap_or_else(|p| p.into_inner());
        conn.execute(
            "INSERT INTO sessions (session_id, path, project_path, normalized_project_path, mtime, size, studio_title, created_at)
             VALUES (?1, '', '', '', 0, 0, ?2, 0)
             ON CONFLICT(session_id) DO UPDATE SET studio_title = excluded.studio_title;",
            params![session_id, title],
        ).map_err(|e| format!("Salvataggio titolo sessione su SQLite fallito: {e}"))?;
        Ok(())
    }

    /// Recupera il titolo risolto di una sessione.
    pub fn get_title_for_session(&self, session_id: &str) -> Option<String> {
        let conn = self.conn.lock().unwrap_or_else(|p| p.into_inner());
        let mut stmt = conn.prepare(
            "SELECT omp_title, header_title, studio_title FROM sessions WHERE session_id = ?1"
        ).ok()?;
        let mut rows = stmt.query(params![session_id]).ok()?;
        if let Some(row) = rows.next().ok().flatten() {
            let omp: Option<String> = row.get(0).ok();
            let header: Option<String> = row.get(1).ok();
            let studio: Option<String> = row.get(2).ok();
            return resolve_entry_title(omp, header, studio);
        }
        None
    }

    /// Sincronizza i titoli presenti nella tabella `session_titles` di `history.db`.
    pub fn sync_omp_history_titles(&self, history_db_path: Option<&Path>) -> Result<usize, String> {
        let Some(history_path) = history_db_path else {
            return Ok(0);
        };
        if !history_path.exists() {
            return Ok(0);
        }
        let conn_omp = Connection::open_with_flags(history_path, OpenFlags::SQLITE_OPEN_READ_ONLY)
            .map_err(|e| format!("Apertura {}: {e}", history_path.display()))?;

        let mut stmt = match conn_omp.prepare("SELECT session_id, title FROM session_titles") {
            Ok(s) => s,
            Err(_) => return Ok(0),
        };

        let iter = match stmt.query_map([], |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))) {
            Ok(it) => it,
            Err(_) => return Ok(0),
        };

        let titles: Vec<(String, String)> = iter.flatten().collect();
        if titles.is_empty() {
            return Ok(0);
        }

        let conn = self.conn.lock().unwrap_or_else(|p| p.into_inner());
        let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
        let mut count = 0;
        {
            let mut update_stmt = tx.prepare(
                "UPDATE sessions SET omp_title = ?1 WHERE session_id = ?2 AND (omp_title IS NULL OR omp_title != ?1)"
            ).map_err(|e| e.to_string())?;

            for (session_id, title) in titles {
                if !title.trim().is_empty() {
                    let affected = update_stmt.execute(params![title, session_id]).unwrap_or(0);
                    if affected > 0 {
                        count += affected;
                    }
                }
            }
        }
        tx.commit().map_err(|e| e.to_string())?;
        Ok(count)
    }

    /// Esegue il refresh incrementale dell'indice leggendo la directory delle sessioni.
    pub fn refresh_in_dir(
        &self,
        sessions_dir: &Path,
        history_db: Option<&Path>,
    ) -> Result<SessionIndexStats, String> {
        let started = Instant::now();
        if !sessions_dir.exists() {
            return Ok(SessionIndexStats {
                scanned: 0,
                updated: 0,
                removed: 0,
                duration_ms: started.elapsed().as_millis() as u64,
            });
        }

        // 1. Scoperta di tutti i file .jsonl su disco
        let mut discovered = Vec::new();
        if let Ok(folders) = fs::read_dir(sessions_dir) {
            for folder in folders.flatten() {
                let folder_path = folder.path();
                if !folder_path.is_dir() {
                    continue;
                }
                if let Ok(files) = fs::read_dir(&folder_path) {
                    for file in files.flatten() {
                        let path = file.path();
                        if path.extension().and_then(|e| e.to_str()) != Some("jsonl") {
                            continue;
                        }
                        let Ok(meta) = file.metadata() else {
                            continue;
                        };
                        let mtime = meta
                            .modified()
                            .ok()
                            .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                            .map(|d| d.as_secs() as i64)
                            .unwrap_or(0);
                        let size = meta.len();
                        discovered.push((path, mtime, size));
                    }
                }
            }
        }

        let scanned = discovered.len() as u32;

        // 2. Mappa attuale dei file indicizzati nel DB
        let mut existing_db_files: HashMap<String, (i64, u64)> = HashMap::new();
        {
            let conn = self.conn.lock().unwrap_or_else(|p| p.into_inner());
            let mut stmt = conn
                .prepare("SELECT path, mtime, size FROM sessions WHERE path IS NOT NULL AND path != ''")
                .map_err(|e| e.to_string())?;
            let rows = stmt
                .query_map([], |row| {
                    Ok((row.get::<_, String>(0)?, (row.get::<_, i64>(1)?, row.get::<_, i64>(2)? as u64)))
                })
                .map_err(|e| e.to_string())?;
            for item in rows.flatten() {
                existing_db_files.insert(item.0, item.1);
            }
        }

        // 3. Confronto in memoria per individuare cosa parsare e cosa potare
        let mut to_parse = Vec::new();
        let mut discovered_paths = std::collections::HashSet::with_capacity(discovered.len());

        for (path, mtime, size) in discovered {
            let path_str = path.to_string_lossy().to_string();
            discovered_paths.insert(path_str.clone());

            match existing_db_files.get(&path_str) {
                Some(&(db_mtime, db_size)) if db_mtime == mtime && db_size == size => {
                    // File invariato, nessun re-parse
                }
                _ => {
                    to_parse.push((path, path_str, mtime, size));
                }
            }
        }

        let to_remove: Vec<String> = existing_db_files
            .into_keys()
            .filter(|p| !discovered_paths.contains(p) && !Path::new(p).exists())
            .collect();

        // 4. Parsing dei soli file modificati/nuovi (FUORI dal lock del DB per non bloccare i lettori)
        let mut parsed_items = Vec::with_capacity(to_parse.len());
        for (path, path_str, mtime, size) in to_parse {
            if let Some(info) = parse_session_file(&path) {
                parsed_items.push((path_str, mtime, size, info));
            }
        }

        // 5. Scrittura in transazione batch (poche millisecondi di lock)
        let updated = parsed_items.len() as u32;
        let removed = to_remove.len() as u32;

        {
            let conn = self.conn.lock().unwrap_or_else(|p| p.into_inner());
            let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;

            for rem_path in to_remove {
                let _ = tx.execute("DELETE FROM sessions WHERE path = ?1", params![rem_path]);
            }

            {
                let mut upsert_stmt = tx.prepare(
                    "INSERT INTO sessions (
                         session_id, path, project_path, normalized_project_path,
                         mtime, size, header_title, first_prompt, created_at
                     )
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
                     ON CONFLICT(session_id) DO UPDATE SET
                         path = excluded.path,
                         project_path = excluded.project_path,
                         normalized_project_path = excluded.normalized_project_path,
                         mtime = excluded.mtime,
                         size = excluded.size,
                         header_title = excluded.header_title,
                         first_prompt = excluded.first_prompt,
                         created_at = excluded.created_at;"
                ).map_err(|e| e.to_string())?;

                for (path_str, mtime, size, info) in parsed_items {
                    let norm = normalize_path_for_compare(&info.project_path);
                    let _ = upsert_stmt.execute(params![
                        info.session_id,
                        path_str,
                        info.project_path,
                        norm,
                        mtime,
                        size as i64,
                        info.header_title,
                        info.first_prompt,
                        mtime,
                    ]);
                }
            }

            tx.commit().map_err(|e| e.to_string())?;
        }

        // Sincronizza eventuali titoli OMP
        let _ = self.sync_omp_history_titles(history_db);

        Ok(SessionIndexStats {
            scanned,
            updated,
            removed,
            duration_ms: started.elapsed().as_millis() as u64,
        })
    }

    /// Refresh incrementale usando la directory standard delle sessioni di OMP.
    pub fn refresh(&self) -> Result<SessionIndexStats, String> {
        let agent = crate::omp_ops::agent_dir().ok_or("Directory agent non trovata")?;
        let sessions_dir = agent.join("sessions");
        let history_db = agent.join("history.db");
        self.refresh_in_dir(&sessions_dir, Some(&history_db))
    }

    /// Restituisce le sessioni che hanno un primo prompt ma nessun titolo (ne' OMP ne' Studio),
    /// ordinate dalla piu' recente alla piu' vecchia.
    pub fn untitled(&self, limit: u32) -> Result<Vec<UntitledSession>, String> {
        let conn = self.conn.lock().unwrap_or_else(|p| p.into_inner());
        let mut stmt = conn.prepare(
            "SELECT session_id, first_prompt
             FROM sessions
             WHERE first_prompt IS NOT NULL AND TRIM(first_prompt) != ''
               AND (omp_title IS NULL OR TRIM(omp_title) = '')
               AND (header_title IS NULL OR TRIM(header_title) = '')
               AND (studio_title IS NULL OR TRIM(studio_title) = '')
             ORDER BY created_at DESC
             LIMIT ?1;"
        ).map_err(|e| e.to_string())?;

        let iter = stmt.query_map(params![limit], |row| {
            Ok(UntitledSession {
                session_id: row.get(0)?,
                prompt: row.get(1)?,
            })
        }).map_err(|e| e.to_string())?;

        Ok(iter.flatten().collect())
    }

    /// Aggiornamento rapido dei soli file appartenenti alle cartelle candidate di `project_path`.
    pub fn sync_project_files(&self, sessions_dir: &Path, project_path: &str) -> Result<(), String> {
        if !sessions_dir.exists() {
            return Ok(());
        }
        let Ok(folders) = fs::read_dir(sessions_dir) else {
            return Ok(());
        };

        let mut to_parse = Vec::new();
        {
            let conn = self.conn.lock().unwrap_or_else(|p| p.into_inner());
            let mut check_stmt = conn.prepare("SELECT mtime, size FROM sessions WHERE path = ?1").ok();

            for folder in folders.flatten() {
                let folder_path = folder.path();
                if !folder_path.is_dir() {
                    continue;
                }
                let folder_name = folder_path.file_name().and_then(|n| n.to_str()).unwrap_or("");
                if !session_folder_might_match(folder_name, project_path) {
                    continue;
                }

                let Ok(files) = fs::read_dir(&folder_path) else {
                    continue;
                };
                for file in files.flatten() {
                    let path = file.path();
                    if path.extension().and_then(|e| e.to_str()) != Some("jsonl") {
                        continue;
                    }
                    let Ok(meta) = file.metadata() else {
                        continue;
                    };
                    let mtime = meta
                        .modified()
                        .ok()
                        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                        .map(|d| d.as_secs() as i64)
                        .unwrap_or(0);
                    let size = meta.len();
                    let path_str = path.to_string_lossy().to_string();

                    let up_to_date = check_stmt
                        .as_mut()
                        .and_then(|s| {
                            s.query_row(params![&path_str], |r| {
                                Ok((r.get::<_, i64>(0)?, r.get::<_, i64>(1)? as u64))
                            })
                            .ok()
                        })
                        .is_some_and(|(db_m, db_s)| db_m == mtime && db_s == size);

                    if !up_to_date {
                        to_parse.push((path, path_str, mtime, size));
                    }
                }
            }
        }

        if to_parse.is_empty() {
            return Ok(());
        }

        let mut parsed_items = Vec::with_capacity(to_parse.len());
        for (path, path_str, mtime, size) in to_parse {
            if let Some(info) = parse_session_file(&path) {
                parsed_items.push((path_str, mtime, size, info));
            }
        }

        if parsed_items.is_empty() {
            return Ok(());
        }

        let conn = self.conn.lock().unwrap_or_else(|p| p.into_inner());
        let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
        {
            let mut upsert_stmt = tx.prepare(
                "INSERT INTO sessions (
                     session_id, path, project_path, normalized_project_path,
                     mtime, size, header_title, first_prompt, created_at
                 )
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
                 ON CONFLICT(session_id) DO UPDATE SET
                     path = excluded.path,
                     project_path = excluded.project_path,
                     normalized_project_path = excluded.normalized_project_path,
                     mtime = excluded.mtime,
                     size = excluded.size,
                     header_title = excluded.header_title,
                     first_prompt = excluded.first_prompt,
                     created_at = excluded.created_at;"
            ).map_err(|e| e.to_string())?;

            for (path_str, mtime, size, info) in parsed_items {
                let norm = normalize_path_for_compare(&info.project_path);
                let _ = upsert_stmt.execute(params![
                    info.session_id,
                    path_str,
                    info.project_path,
                    norm,
                    mtime,
                    size as i64,
                    info.header_title,
                    info.first_prompt,
                    mtime,
                ]);
            }
        }
        tx.commit().map_err(|e| e.to_string())?;
        Ok(())
    }

    /// Query delle sessioni per un dato progetto, con filtro di ricerca facoltativo.
    pub fn list_for_project(
        &self,
        project_path: &str,
        query: Option<&str>,
    ) -> Result<Vec<SessionEntry>, String> {
        let norm = normalize_path_for_compare(project_path);
        let conn = self.conn.lock().unwrap_or_else(|p| p.into_inner());
        let mut stmt = conn.prepare(
            "SELECT session_id, header_title, omp_title, studio_title, first_prompt, created_at
             FROM sessions
             WHERE normalized_project_path = ?1
             ORDER BY created_at DESC
             LIMIT 100;"
        ).map_err(|e| e.to_string())?;

        let query_lower = query.map(|q| q.trim().to_lowercase()).filter(|q| !q.is_empty());

        let iter = stmt.query_map(params![norm], |row| {
            let id: String = row.get(0)?;
            let header_title: Option<String> = row.get(1)?;
            let omp_title: Option<String> = row.get(2)?;
            let studio_title: Option<String> = row.get(3)?;
            let first_prompt: Option<String> = row.get(4)?;
            let created_at: i64 = row.get(5)?;

            let title = resolve_entry_title(omp_title, header_title, studio_title);
            let prompt = first_prompt.map(|p| truncate_title(&p)).unwrap_or_default();

            Ok(SessionEntry {
                id,
                title,
                prompt,
                created_at,
            })
        }).map_err(|e| e.to_string())?;

        let mut results = Vec::new();
        for item in iter.flatten() {
            if let Some(q) = &query_lower {
                if !matches_query(&item, q) {
                    continue;
                }
            }
            results.push(item);
            if results.len() >= SESSION_LIST_LIMIT {
                break;
            }
        }

        Ok(results)
    }

    /// Ricerca globale su tutte le sessioni indicizzate.
    pub fn search_all(&self, query: &str) -> Result<Vec<SessionEntry>, String> {
        let query_trimmed = query.trim();
        if query_trimmed.is_empty() {
            return Ok(Vec::new());
        }
        let query_lower = query_trimmed.to_lowercase();

        let conn = self.conn.lock().unwrap_or_else(|p| p.into_inner());
        let mut stmt = conn.prepare(
            "SELECT session_id, header_title, omp_title, studio_title, first_prompt, created_at
             FROM sessions
             ORDER BY created_at DESC
             LIMIT 200;"
        ).map_err(|e| e.to_string())?;

        let iter = stmt.query_map([], |row| {
            let id: String = row.get(0)?;
            let header_title: Option<String> = row.get(1)?;
            let omp_title: Option<String> = row.get(2)?;
            let studio_title: Option<String> = row.get(3)?;
            let first_prompt: Option<String> = row.get(4)?;
            let created_at: i64 = row.get(5)?;

            let title = resolve_entry_title(omp_title, header_title, studio_title);
            let prompt = first_prompt.map(|p| truncate_title(&p)).unwrap_or_default();

            Ok(SessionEntry {
                id,
                title,
                prompt,
                created_at,
            })
        }).map_err(|e| e.to_string())?;

        let mut results = Vec::new();
        for item in iter.flatten() {
            if matches_query(&item, &query_lower) {
                results.push(item);
                if results.len() >= SESSION_LIST_LIMIT {
                    break;
                }
            }
        }

        Ok(results)
    }
}

static SESSION_INDEX: LazyLock<Mutex<Option<Arc<SessionIndex>>>> =
    LazyLock::new(|| Mutex::new(None));

/// Recupera l'istanza globale condivisa dell'indice delle sessioni per l'applicazione.
pub fn get_session_index(app: &AppHandle) -> Result<Arc<SessionIndex>, String> {
    let mut guard = SESSION_INDEX.lock().unwrap_or_else(|p| p.into_inner());
    if let Some(index) = guard.as_ref() {
        return Ok(index.clone());
    }

    let db_path = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Percorso app_data_dir non disponibile: {e}"))?
        .join("studio-sessions.db");

    let index = Arc::new(SessionIndex::open(&db_path)?);

    // Esegui la migrazione una tantum di session-titles.json se presente
    if let Ok(data_dir) = app.path().app_data_dir() {
        let json_path = data_dir.join("session-titles.json");
        let _ = index.migrate_json_titles(&json_path);
    }

    *guard = Some(index.clone());
    Ok(index)
}

/// Comando IPC: aggiorna incrementalmente l'indice delle sessioni su disco.
#[command]
pub async fn session_index_refresh(app: AppHandle) -> Result<SessionIndexStats, String> {
    let index = get_session_index(&app)?;
    tokio::task::spawn_blocking(move || index.refresh())
        .await
        .map_err(|e| format!("Task session_index_refresh fallito: {e}"))?
}

/// Comando IPC: restituisce le sessioni che necessitano di un titolo generato dall'AI.
#[command]
pub async fn session_index_untitled(
    app: AppHandle,
    limit: u32,
) -> Result<Vec<UntitledSession>, String> {
    let index = get_session_index(&app)?;
    tokio::task::spawn_blocking(move || index.untitled(limit))
        .await
        .map_err(|e| format!("Task session_index_untitled fallito: {e}"))?
}

/// Comando IPC: memorizza nell'indice SQLite il titolo generato da Studio per una sessione.
#[command]
pub async fn session_title_save(
    app: AppHandle,
    session_id: String,
    title: String,
) -> Result<(), String> {
    let title: String = title.trim().chars().take(80).collect();
    if session_id.trim().is_empty() || title.is_empty() {
        return Err("Sessione o titolo mancanti".to_string());
    }
    let index = get_session_index(&app)?;
    tokio::task::spawn_blocking(move || index.save_title(&session_id, &title))
        .await
        .map_err(|e| format!("Task session_title_save fallito: {e}"))?
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    #[test]
    fn test_title_migration_from_json() {
        let temp_dir = std::env::temp_dir().join(format!("omp_test_migration_{}", std::process::id()));
        let _ = fs::create_dir_all(&temp_dir);
        let json_path = temp_dir.join("session-titles.json");
        let mut f = File::create(&json_path).unwrap();
        f.write_all(b"{\"s1\": \"Titolo 1\", \"s2\": \"Titolo 2\"}\n").unwrap();
        drop(f);

        let index = SessionIndex::open_in_memory().unwrap();
        let migrated = index.migrate_json_titles(&json_path).unwrap();
        assert_eq!(migrated, 2);
        assert!(!json_path.exists());
        assert!(json_path.with_extension("json.migrated").exists());

        assert_eq!(index.get_title_for_session("s1"), Some("Titolo 1".to_string()));
        assert_eq!(index.get_title_for_session("s2"), Some("Titolo 2".to_string()));
        let _ = fs::remove_dir_all(&temp_dir);
    }

    #[test]
    fn test_incremental_refresh() {
        let temp_dir = std::env::temp_dir().join(format!("omp_test_refresh_{}", std::process::id()));
        let sessions_dir = temp_dir.join("sessions").join("test-proj");
        fs::create_dir_all(&sessions_dir).unwrap();

        let s1_path = sessions_dir.join("s1.jsonl");
        {
            let mut f = File::create(&s1_path).unwrap();
            f.write_all(b"{\"type\":\"session\",\"id\":\"s1\",\"cwd\":\"/repo/test\"}\n").unwrap();
            f.write_all(b"{\"type\":\"message\",\"message\":{\"role\":\"user\",\"content\":\"Primo prompt s1\"}}\n").unwrap();
        }

        let index = SessionIndex::open_in_memory().unwrap();
        // 1. Prima scansione: 1 file scansionato, 1 aggiornato, 0 rimossi
        let stats1 = index.refresh_in_dir(&temp_dir.join("sessions"), None).unwrap();
        assert_eq!(stats1.scanned, 1);
        assert_eq!(stats1.updated, 1);
        assert_eq!(stats1.removed, 0);

        // 2. Seconda scansione senza modifiche: 1 scansionato, 0 aggiornati
        let stats2 = index.refresh_in_dir(&temp_dir.join("sessions"), None).unwrap();
        assert_eq!(stats2.scanned, 1);
        assert_eq!(stats2.updated, 0);
        assert_eq!(stats2.removed, 0);

        // 3. Modifica del file: mtime/dimensione cambiano -> 1 aggiornato
        std::thread::sleep(std::time::Duration::from_millis(50));
        {
            let mut f = fs::OpenOptions::new().append(true).open(&s1_path).unwrap();
            f.write_all(b"{\"type\":\"title\",\"title\":\"Nuovo Titolo\"}\n").unwrap();
        }
        let stats3 = index.refresh_in_dir(&temp_dir.join("sessions"), None).unwrap();
        assert_eq!(stats3.scanned, 1);
        assert_eq!(stats3.updated, 1);
        assert_eq!(stats3.removed, 0);
        assert_eq!(index.get_title_for_session("s1"), Some("Nuovo Titolo".to_string()));

        // 4. Eliminazione del file: file rimosso dall'indice
        fs::remove_file(&s1_path).unwrap();
        let stats4 = index.refresh_in_dir(&temp_dir.join("sessions"), None).unwrap();
        assert_eq!(stats4.scanned, 0);
        assert_eq!(stats4.updated, 0);
        assert_eq!(stats4.removed, 1);
        assert_eq!(index.get_title_for_session("s1"), None);

        let _ = fs::remove_dir_all(&temp_dir);
    }

    #[test]
    fn test_untitled_query_excludes_titled() {
        let index = SessionIndex::open_in_memory().unwrap();
        let conn = index.conn.lock().unwrap();

        // s_untitled: ha primo prompt, nessun titolo
        conn.execute(
            "INSERT INTO sessions (session_id, project_path, normalized_project_path, mtime, size, first_prompt, created_at)
             VALUES ('s_untitled', '/repo', '/repo', 100, 100, 'Serve un titolo', 100)",
            [],
        ).unwrap();

        // s_with_header: ha primo prompt, ha header_title
        conn.execute(
            "INSERT INTO sessions (session_id, project_path, normalized_project_path, mtime, size, header_title, first_prompt, created_at)
             VALUES ('s_with_header', '/repo', '/repo', 200, 100, 'Titolo Header', 'Prompt', 200)",
            [],
        ).unwrap();

        // s_with_omp: ha primo prompt, ha omp_title
        conn.execute(
            "INSERT INTO sessions (session_id, project_path, normalized_project_path, mtime, size, omp_title, first_prompt, created_at)
             VALUES ('s_with_omp', '/repo', '/repo', 300, 100, 'Titolo OMP', 'Prompt', 300)",
            [],
        ).unwrap();

        // s_with_studio: ha primo prompt, ha studio_title
        conn.execute(
            "INSERT INTO sessions (session_id, project_path, normalized_project_path, mtime, size, studio_title, first_prompt, created_at)
             VALUES ('s_with_studio', '/repo', '/repo', 400, 100, 'Titolo Studio', 'Prompt', 400)",
            [],
        ).unwrap();

        // s_no_prompt: senza primo prompt
        conn.execute(
            "INSERT INTO sessions (session_id, project_path, normalized_project_path, mtime, size, created_at)
             VALUES ('s_no_prompt', '/repo', '/repo', 500, 100, 500)",
            [],
        ).unwrap();

        drop(conn);

        let untitled = index.untitled(10).unwrap();
        assert_eq!(untitled.len(), 1);
        assert_eq!(untitled[0].session_id, "s_untitled");
        assert_eq!(untitled[0].prompt, "Serve un titolo");
    }
}
