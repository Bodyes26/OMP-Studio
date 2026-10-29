use crate::automations::model::*;
use parking_lot::Mutex;
use rusqlite::{params, Connection};
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::sync::Arc;

pub struct Storage {
    conn: Arc<Mutex<Connection>>,
    outputs_dir: PathBuf,
}

impl Storage {
    pub fn open(db_path: &Path, outputs_dir: &Path) -> Result<Self, String> {
        if let Some(parent) = db_path.parent() {
            fs::create_dir_all(parent).map_err(|e| format!("Creazione cartella db automazioni: {}", e))?;
        }
        fs::create_dir_all(outputs_dir)
            .map_err(|e| format!("Creazione cartella output automazioni: {}", e))?;

        let conn = Connection::open(db_path)
            .map_err(|e| format!("Apertura database automazioni ({}): {}", db_path.display(), e))?;

        conn.execute_batch(
            "PRAGMA journal_mode = WAL;
             PRAGMA foreign_keys = ON;
             PRAGMA busy_timeout = 5000;",
        )
        .map_err(|e| format!("Configurazione PRAGMA automazioni: {}", e))?;

        let storage = Self {
            conn: Arc::new(Mutex::new(conn)),
            outputs_dir: outputs_dir.to_path_buf(),
        };

        storage.init_tables()?;
        Ok(storage)
    }

    fn init_tables(&self) -> Result<(), String> {
        let conn = self.conn.lock();
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS settings (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                data_json TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS definitions (
                id TEXT PRIMARY KEY,
                revision INTEGER NOT NULL,
                name TEXT NOT NULL,
                description TEXT NOT NULL DEFAULT '',
                state TEXT NOT NULL,
                origin TEXT NOT NULL DEFAULT 'user',
                data_json TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS definition_versions (
                automation_id TEXT NOT NULL,
                revision INTEGER NOT NULL,
                definition_json TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                PRIMARY KEY (automation_id, revision)
            );

            CREATE TABLE IF NOT EXISTS drafts (
                id TEXT PRIMARY KEY,
                automation_id TEXT,
                base_revision INTEGER,
                definition_json TEXT NOT NULL,
                conversation_json TEXT NOT NULL DEFAULT '[]',
                source TEXT NOT NULL DEFAULT 'user',
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS occurrences (
                id TEXT PRIMARY KEY,
                automation_id TEXT NOT NULL,
                revision INTEGER NOT NULL,
                name TEXT NOT NULL,
                scheduled_at INTEGER NOT NULL,
                created_at INTEGER NOT NULL,
                deadline INTEGER NOT NULL,
                state TEXT NOT NULL,
                acknowledged INTEGER NOT NULL DEFAULT 0,
                requires_review INTEGER NOT NULL DEFAULT 0,
                reasons_json TEXT NOT NULL DEFAULT '[]',
                targets_json TEXT NOT NULL DEFAULT '[]',
                definition_json TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS executions (
                id TEXT PRIMARY KEY,
                run_id TEXT NOT NULL,
                state TEXT NOT NULL,
                targets_json TEXT NOT NULL DEFAULT '[]',
                reason TEXT,
                started_at INTEGER,
                finished_at INTEGER,
                exit_code INTEGER,
                model TEXT,
                session_id TEXT,
                result TEXT,
                question TEXT,
                output_truncated INTEGER NOT NULL DEFAULT 0,
                active_duration_ms INTEGER NOT NULL DEFAULT 0,
                active_since INTEGER,
                human_deadline INTEGER,
                FOREIGN KEY (run_id) REFERENCES occurrences(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS registered_projects (
                id TEXT PRIMARY KEY,
                path TEXT NOT NULL UNIQUE,
                name TEXT NOT NULL,
                open INTEGER NOT NULL DEFAULT 0,
                workspace_paths_json TEXT DEFAULT '[]'
            );

            CREATE TABLE IF NOT EXISTS project_requests (
                request_id TEXT PRIMARY KEY,
                operation TEXT NOT NULL,
                path TEXT NOT NULL,
                execution_id TEXT,
                status TEXT NOT NULL,
                created_at INTEGER NOT NULL
            );",
        )
        .map_err(|e| format!("Inizializzazione tabelle automazioni: {}", e))?;

        let _ = conn.execute("ALTER TABLE executions ADD COLUMN active_duration_ms INTEGER NOT NULL DEFAULT 0", []);
        let _ = conn.execute("ALTER TABLE executions ADD COLUMN human_deadline INTEGER", []);
        let _ = conn.execute("ALTER TABLE executions ADD COLUMN active_since INTEGER", []);
        let _ = conn.execute("ALTER TABLE registered_projects ADD COLUMN workspace_paths_json TEXT DEFAULT '[]'", []);

        Ok(())
    }

    /// Riconcilia lo stato dopo un crash o riavvio anomalo (AUT-046, AUT-106):
    /// Le occorrenze in stato running o waiting vengono marcate unknown e sospendono la regola.
    pub fn reconcile_crash(&self) -> Result<Vec<String>, String> {
        let conn = self.conn.lock();
        let mut suspended_defs = Vec::new();

        // Trova le occorrenze rimaste aperte in running o waiting
        let mut stmt = conn
            .prepare(
                "SELECT id, automation_id, state FROM occurrences WHERE state IN ('running', 'waiting')",
            )
            .map_err(|e| e.to_string())?;

        let rows = stmt
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                ))
            })
            .map_err(|e| e.to_string())?;

        let pending_runs: Vec<(String, String, String)> = rows.flatten().collect();
        drop(stmt);

        for (run_id, automation_id, _state) in pending_runs {
            // Aggiorna l'occorrenza
            let _ = conn.execute(
                "UPDATE occurrences SET state = 'unknown', requires_review = 1 WHERE id = ?1",
                params![run_id],
            );

            // Aggiorna le singole esecuzioni pendenti
            let _ = conn.execute(
                "UPDATE executions SET state = 'unknown', reason = 'Arresto anomalo di Studio: esito non verificato' WHERE run_id = ?1 AND state IN ('running', 'waiting')",
                params![run_id],
            );

            // AUT-046: Sospendi la regola fino a revisione esplicita dell'utente
            let _ = conn.execute(
                "UPDATE definitions SET state = 'suspended', updated_at = ?2 WHERE id = ?1 AND state = 'enabled'",
                params![automation_id, chrono_now_ms()],
            );

            suspended_defs.push(automation_id);
        }

        Ok(suspended_defs)
    }

    // --- IMPOSTAZIONI ---

    pub fn get_settings(&self) -> AutomationSettings {
        let conn = self.conn.lock();
        let res: Result<String, _> =
            conn.query_row("SELECT data_json FROM settings WHERE id = 1", [], |r| r.get(0));

        match res {
            Ok(json_str) => serde_json::from_str(&json_str).unwrap_or_default(),
            Err(_) => AutomationSettings::default(),
        }
    }

    pub fn save_settings(&self, settings: &AutomationSettings) -> Result<(), String> {
        let json = serde_json::to_string(settings).map_err(|e| e.to_string())?;
        let conn = self.conn.lock();
        conn.execute(
            "INSERT INTO settings (id, data_json) VALUES (1, ?1)
             ON CONFLICT(id) DO UPDATE SET data_json = excluded.data_json",
            params![json],
        )
        .map_err(|e| format!("Salvataggio impostazioni automazioni: {}", e))?;
        Ok(())
    }

    // --- DEFINIZIONI ---

    pub fn get_definitions(&self) -> Result<Vec<AutomationDefinition>, String> {
        let conn = self.conn.lock();
        let mut stmt = conn
            .prepare("SELECT data_json FROM definitions ORDER BY updated_at DESC")
            .map_err(|e| format!("Errore prepare query definizioni: {}", e))?;

        let rows = stmt
            .query_map([], |row| row.get::<_, String>(0))
            .map_err(|e| format!("Errore query definizioni: {}", e))?;

        let mut out = Vec::new();
        for item in rows.flatten() {
            if let Ok(def) = serde_json::from_str::<AutomationDefinition>(&item) {
                out.push(def);
            }
        }
        Ok(out)
    }

    pub fn get_definition(&self, id: &str) -> Option<AutomationDefinition> {
        let conn = self.conn.lock();
        let res: Result<String, _> = conn.query_row(
            "SELECT data_json FROM definitions WHERE id = ?1",
            params![id],
            |r| r.get(0),
        );
        res.ok().and_then(|j| serde_json::from_str(&j).ok())
    }

    pub fn save_definition(&self, def: &AutomationDefinition) -> Result<(), String> {
        let json = serde_json::to_string(def).map_err(|e| e.to_string())?;
        let conn = self.conn.lock();

        conn.execute(
            "INSERT INTO definitions (id, revision, name, description, state, origin, data_json, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
             ON CONFLICT(id) DO UPDATE SET
                revision = excluded.revision,
                name = excluded.name,
                description = excluded.description,
                state = excluded.state,
                origin = excluded.origin,
                data_json = excluded.data_json,
                updated_at = excluded.updated_at",
            params![
                def.id,
                def.revision as i64,
                def.name,
                def.description,
                def.state,
                def.origin,
                json,
                def.created_at,
                def.updated_at
            ],
        )
        .map_err(|e| format!("Salvataggio definizione automazione: {}", e))?;

        // Salva versione storica immutabile (AUT-067)
        let _ = conn.execute(
            "INSERT INTO definition_versions (automation_id, revision, definition_json, created_at)
             VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT(automation_id, revision) DO UPDATE SET definition_json = excluded.definition_json",
            params![def.id, def.revision as i64, json, def.updated_at],
        );

        Ok(())
    }

    pub fn get_definition_version(&self, id: &str, revision: u64) -> Option<AutomationDefinition> {
        let conn = self.conn.lock();
        let res: Result<String, _> = conn.query_row(
            "SELECT definition_json FROM definition_versions WHERE automation_id = ?1 AND revision = ?2",
            params![id, revision as i64],
            |r| r.get(0),
        );
        res.ok().and_then(|j| serde_json::from_str(&j).ok())
    }

    pub fn set_definition_state(&self, id: &str, state: &str) -> Result<(), String> {
        let mut def = self
            .get_definition(id)
            .ok_or_else(|| format!("Automazione '{}' non trovata", id))?;
        def.state = state.to_string();
        def.updated_at = chrono_now_ms();
        self.save_definition(&def)
    }

    pub fn delete_definition(&self, id: &str, delete_history: bool) -> Result<(), String> {
        let mut conn = self.conn.lock();
        let tx = conn.transaction().map_err(|e| format!("Inizio transazione cancellazione: {}", e))?;

        tx.execute("DELETE FROM definitions WHERE id = ?1", params![id])
            .map_err(|e| format!("Errore cancellazione definizione: {}", e))?;

        // Rimuovi bozze collegate
        let _ = tx.execute("DELETE FROM drafts WHERE automation_id = ?1", params![id]);

        if delete_history {
            // Raccogli le esecuzioni per eliminare i file di output
            let mut stmt = tx
                .prepare("SELECT e.id FROM executions e JOIN occurrences o ON e.run_id = o.id WHERE o.automation_id = ?1")
                .map_err(|e| e.to_string())?;
            let exec_ids: Vec<String> = stmt
                .query_map(params![id], |r| r.get(0))
                .map_err(|e| e.to_string())?
                .flatten()
                .collect();
            drop(stmt);

            for eid in exec_ids {
                let log_path = self.outputs_dir.join(format!("{}.log", eid));
                let _ = fs::remove_file(log_path);
            }

            tx.execute("DELETE FROM occurrences WHERE automation_id = ?1", params![id])
                .map_err(|e| format!("Errore cancellazione occorrenze: {}", e))?;
            tx.execute("DELETE FROM definition_versions WHERE automation_id = ?1", params![id])
                .map_err(|e| format!("Errore cancellazione versioni: {}", e))?;
        }

        tx.commit().map_err(|e| format!("Commit cancellazione: {}", e))?;
        Ok(())
    }

    pub fn get_drafts(&self) -> Result<Vec<AutomationDraft>, String> {
        let conn = self.conn.lock();
        let mut stmt = conn
            .prepare("SELECT id, automation_id, base_revision, definition_json, conversation_json, source, created_at, updated_at FROM drafts ORDER BY updated_at DESC")
            .map_err(|e| format!("Errore prepare query bozze: {}", e))?;

        let rows = stmt.query_map([], |row| {
            let id: String = row.get(0)?;
            let _automation_id: Option<String> = row.get(1)?;
            let base_revision: Option<i64> = row.get(2)?;
            let def_json: String = row.get(3)?;
            let conv_json: String = row.get(4)?;
            let source: String = row.get(5)?;
            let created_at: i64 = row.get(6)?;
            let updated_at: i64 = row.get(7)?;

            let definition = serde_json::from_str::<AutomationDefinition>(&def_json)
                .map_err(|e| rusqlite::Error::FromSqlConversionFailure(3, rusqlite::types::Type::Text, Box::new(e)))?;
            let conversation = serde_json::from_str::<Vec<AssistantMessage>>(&conv_json)
                .unwrap_or_default();

            Ok(AutomationDraft {
                id,
                definition,
                base_revision: base_revision.map(|r| r as u64),
                conversation,
                created_at,
                updated_at,
                source,
            })
        }).map_err(|e| format!("Errore query bozze: {}", e))?;

        Ok(rows.flatten().collect())
    }

    pub fn get_draft(&self, id: &str) -> Option<AutomationDraft> {
        let conn = self.conn.lock();
        let res = conn.query_row(
            "SELECT id, automation_id, base_revision, definition_json, conversation_json, source, created_at, updated_at FROM drafts WHERE id = ?1",
            params![id],
            |row| {
                let id: String = row.get(0)?;
                let _automation_id: Option<String> = row.get(1)?;
                let base_revision: Option<i64> = row.get(2)?;
                let def_json: String = row.get(3)?;
                let conv_json: String = row.get(4)?;
                let source: String = row.get(5)?;
                let created_at: i64 = row.get(6)?;
                let updated_at: i64 = row.get(7)?;

                let definition = serde_json::from_str::<AutomationDefinition>(&def_json)
                    .map_err(|e| rusqlite::Error::FromSqlConversionFailure(3, rusqlite::types::Type::Text, Box::new(e)))?;
                let conversation = serde_json::from_str::<Vec<AssistantMessage>>(&conv_json)
                    .unwrap_or_default();

                Ok(AutomationDraft {
                    id,
                    definition,
                    base_revision: base_revision.map(|r| r as u64),
                    conversation,
                    created_at,
                    updated_at,
                    source,
                })
            },
        );
        res.ok()
    }

    pub fn save_draft(&self, draft: &AutomationDraft) -> Result<(), String> {
        let def_json = serde_json::to_string(&draft.definition).map_err(|e| e.to_string())?;
        let conv_json = serde_json::to_string(&draft.conversation).map_err(|e| e.to_string())?;
        let conn = self.conn.lock();

        let automation_id = if draft.base_revision.is_some() {
            Some(draft.definition.id.clone())
        } else {
            None
        };

        conn.execute(
            "INSERT INTO drafts (id, automation_id, base_revision, definition_json, conversation_json, source, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
             ON CONFLICT(id) DO UPDATE SET
                automation_id = excluded.automation_id,
                base_revision = excluded.base_revision,
                definition_json = excluded.definition_json,
                conversation_json = excluded.conversation_json,
                source = excluded.source,
                updated_at = excluded.updated_at",
            params![
                draft.id,
                automation_id,
                draft.base_revision.map(|r| r as i64),
                def_json,
                conv_json,
                draft.source,
                draft.created_at,
                draft.updated_at
            ],
        )
        .map_err(|e| format!("Salvataggio bozza: {}", e))?;

        Ok(())
    }

    pub fn delete_draft(&self, id: &str) -> Result<(), String> {
        let conn = self.conn.lock();
        conn.execute("DELETE FROM drafts WHERE id = ?1", params![id])
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    // --- OCCORRENZE ED ESECUZIONI ---

    pub fn get_occurrences(&self, limit: usize) -> Result<Vec<AutomationOccurrence>, String> {
        let conn = self.conn.lock();
        let mut stmt = conn
            .prepare(
                "SELECT id, automation_id, revision, name, scheduled_at, created_at, deadline, state, acknowledged, requires_review, reasons_json, targets_json, definition_json
                 FROM occurrences ORDER BY scheduled_at DESC, created_at DESC LIMIT ?1",
            )
            .map_err(|e| format!("Errore prepare query occorrenze: {}", e))?;

        let rows = stmt.query_map(params![limit as i64], |row| {
            let id: String = row.get(0)?;
            let automation_id: String = row.get(1)?;
            let revision: i64 = row.get(2)?;
            let name: String = row.get(3)?;
            let scheduled_at: i64 = row.get(4)?;
            let created_at: i64 = row.get(5)?;
            let deadline: i64 = row.get(6)?;
            let state: String = row.get(7)?;
            let acknowledged: i32 = row.get(8)?;
            let requires_review: i32 = row.get(9)?;
            let reasons_json: String = row.get(10)?;
            let targets_json: String = row.get(11)?;
            let def_json: String = row.get(12)?;

            let reasons = serde_json::from_str::<Vec<AutomationEvent>>(&reasons_json).unwrap_or_default();
            let targets = serde_json::from_str::<Vec<ResolvedAutomationTarget>>(&targets_json).unwrap_or_default();
            let definition = serde_json::from_str::<AutomationDefinition>(&def_json)
                .map_err(|e| rusqlite::Error::FromSqlConversionFailure(12, rusqlite::types::Type::Text, Box::new(e)))?;

            Ok(AutomationOccurrence {
                id,
                automation_id,
                revision: revision as u64,
                name,
                scheduled_at,
                created_at,
                deadline,
                state,
                reasons,
                targets,
                executions: Vec::new(),
                definition,
                acknowledged: acknowledged != 0,
                requires_review: requires_review != 0,
            })
        }).map_err(|e| format!("Errore query occorrenze: {}", e))?;

        let mut occurrences: Vec<AutomationOccurrence> = rows.flatten().collect();

        // Popola esecuzioni per ciascuna occorrenza
        for occ in &mut occurrences {
            occ.executions = self.get_executions_for_run_locked(&conn, &occ.id);
        }

        Ok(occurrences)
    }

    fn get_executions_for_run_locked(&self, conn: &Connection, run_id: &str) -> Vec<AutomationExecution> {
        let mut stmt = match conn.prepare(
            "SELECT id, run_id, state, targets_json, reason, started_at, finished_at, exit_code, model, session_id, result, question, output_truncated, active_duration_ms, active_since, human_deadline
             FROM executions WHERE run_id = ?1",
        ) {
            Ok(s) => s,
            Err(_) => return Vec::new(),
        };

        let rows = stmt.query_map(params![run_id], |row| {
            let id: String = row.get(0)?;
            let run_id: String = row.get(1)?;
            let state: String = row.get(2)?;
            let targets_json: String = row.get(3)?;
            let reason: Option<String> = row.get(4)?;
            let started_at: Option<i64> = row.get(5)?;
            let finished_at: Option<i64> = row.get(6)?;
            let exit_code: Option<i32> = row.get(7)?;
            let model: Option<String> = row.get(8)?;
            let session_id: Option<String> = row.get(9)?;
            let result: Option<String> = row.get(10)?;
            let question: Option<String> = row.get(11)?;
            let output_truncated: i32 = row.get(12)?;
            let active_dur: i64 = row.get::<_, Option<i64>>(13)?.unwrap_or(0);
            let active_since: Option<i64> = row.get(14)?;
            let human_deadline: Option<i64> = row.get(15)?;

            let targets = serde_json::from_str::<Vec<ResolvedAutomationTarget>>(&targets_json).unwrap_or_default();

            Ok(AutomationExecution {
                id,
                run_id,
                targets,
                state,
                reason,
                started_at,
                finished_at,
                exit_code,
                model,
                session_id,
                result,
                question,
                output_truncated: output_truncated != 0,
                active_duration_ms: active_dur.max(0) as u64,
                active_since,
                human_deadline,
            })
        });

        rows.map(|iter| iter.flatten().collect()).unwrap_or_default()
    }

    pub fn get_occurrence(&self, id: &str) -> Option<AutomationOccurrence> {
        let conn = self.conn.lock();
        let res = conn.query_row(
            "SELECT id, automation_id, revision, name, scheduled_at, created_at, deadline, state, acknowledged, requires_review, reasons_json, targets_json, definition_json
             FROM occurrences WHERE id = ?1",
            params![id],
            |row| {
                let id: String = row.get(0)?;
                let automation_id: String = row.get(1)?;
                let revision: i64 = row.get(2)?;
                let name: String = row.get(3)?;
                let scheduled_at: i64 = row.get(4)?;
                let created_at: i64 = row.get(5)?;
                let deadline: i64 = row.get(6)?;
                let state: String = row.get(7)?;
                let acknowledged: i32 = row.get(8)?;
                let requires_review: i32 = row.get(9)?;
                let reasons_json: String = row.get(10)?;
                let targets_json: String = row.get(11)?;
                let def_json: String = row.get(12)?;

                let reasons = serde_json::from_str::<Vec<AutomationEvent>>(&reasons_json).unwrap_or_default();
                let targets = serde_json::from_str::<Vec<ResolvedAutomationTarget>>(&targets_json).unwrap_or_default();
                let definition = serde_json::from_str::<AutomationDefinition>(&def_json)
                    .map_err(|e| rusqlite::Error::FromSqlConversionFailure(12, rusqlite::types::Type::Text, Box::new(e)))?;

                Ok(AutomationOccurrence {
                    id,
                    automation_id,
                    revision: revision as u64,
                    name,
                    scheduled_at,
                    created_at,
                    deadline,
                    state,
                    reasons,
                    targets,
                    executions: Vec::new(),
                    definition,
                    acknowledged: acknowledged != 0,
                    requires_review: requires_review != 0,
                })
            },
        );

        if let Ok(mut occ) = res {
            occ.executions = self.get_executions_for_run_locked(&conn, &occ.id);
            Some(occ)
        } else {
            None
        }
    }

    pub fn save_occurrence(&self, occ: &AutomationOccurrence) -> Result<(), String> {
        let reasons_json = serde_json::to_string(&occ.reasons).map_err(|e| e.to_string())?;
        let targets_json = serde_json::to_string(&occ.targets).map_err(|e| e.to_string())?;
        let def_json = serde_json::to_string(&occ.definition).map_err(|e| e.to_string())?;

        let conn = self.conn.lock();

        conn.execute(
            "INSERT INTO occurrences (id, automation_id, revision, name, scheduled_at, created_at, deadline, state, acknowledged, requires_review, reasons_json, targets_json, definition_json)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)
             ON CONFLICT(id) DO UPDATE SET
                state = excluded.state,
                acknowledged = excluded.acknowledged,
                requires_review = excluded.requires_review,
                targets_json = excluded.targets_json",
            params![
                occ.id,
                occ.automation_id,
                occ.revision as i64,
                occ.name,
                occ.scheduled_at,
                occ.created_at,
                occ.deadline,
                occ.state,
                if occ.acknowledged { 1 } else { 0 },
                if occ.requires_review { 1 } else { 0 },
                reasons_json,
                targets_json,
                def_json
            ],
        )
        .map_err(|e| format!("Salvataggio occorrenza: {}", e))?;

        // Aggiorna/inserisce le singole esecuzioni
        for exec in &occ.executions {
            let exec_targets = serde_json::to_string(&exec.targets).unwrap_or_else(|_| "[]".to_string());
            conn.execute(
                "INSERT INTO executions (id, run_id, state, targets_json, reason, started_at, finished_at, exit_code, model, session_id, result, question, output_truncated, active_duration_ms, active_since, human_deadline)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16)
                 ON CONFLICT(id) DO UPDATE SET
                    state = excluded.state,
                    reason = excluded.reason,
                    started_at = excluded.started_at,
                    finished_at = excluded.finished_at,
                    exit_code = excluded.exit_code,
                    model = excluded.model,
                    session_id = excluded.session_id,
                    result = excluded.result,
                    question = excluded.question,
                    output_truncated = excluded.output_truncated,
                    active_duration_ms = excluded.active_duration_ms,
                    active_since = excluded.active_since,
                    human_deadline = excluded.human_deadline",
                params![
                    exec.id,
                    exec.run_id,
                    exec.state,
                    exec_targets,
                    exec.reason,
                    exec.started_at,
                    exec.finished_at,
                    exec.exit_code,
                    exec.model,
                    exec.session_id,
                    exec.result,
                    exec.question,
                    if exec.output_truncated { 1 } else { 0 },
                    exec.active_duration_ms as i64,
                    exec.active_since,
                    exec.human_deadline
                ],
            )
            .map_err(|e| format!("Salvataggio esecuzione: {}", e))?;
        }

        Ok(())
    }

    pub fn acknowledge_occurrence(&self, id: &str, resolve_unknown: bool) -> Result<(), String> {
        let conn = self.conn.lock();
        if resolve_unknown {
            conn.execute(
                "UPDATE occurrences SET acknowledged = 1, requires_review = 0, state = CASE WHEN state = 'unknown' THEN 'interrupted' ELSE state END WHERE id = ?1",
                params![id],
            )
            .map_err(|e| e.to_string())?;

            let _ = conn.execute(
                "UPDATE executions SET state = CASE WHEN state = 'unknown' THEN 'interrupted' ELSE state END WHERE run_id = ?1",
                params![id],
            );
        } else {
            conn.execute(
                "UPDATE occurrences SET acknowledged = 1, requires_review = 0 WHERE id = ?1",
                params![id],
            )
            .map_err(|e| e.to_string())?;
        }
        Ok(())
    }

    pub fn set_execution_update(
        &self,
        update: &AutomationAiUpdate,
        human_wait_minutes: Option<u64>,
    ) -> Result<AutomationOccurrence, String> {
        let conn = self.conn.lock();

        let (run_id, current_state, _started_at, active_since, active_dur): (String, String, Option<i64>, Option<i64>, i64) = conn
            .query_row(
                "SELECT run_id, state, started_at, active_since, active_duration_ms FROM executions WHERE id = ?1",
                params![update.execution_id],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)),
            )
            .map_err(|e| format!("Esecuzione '{}' non trovata: {}", update.execution_id, e))?;

        let now = chrono_now_ms();
        let is_final = update.state == "completed"
            || update.state == "error"
            || update.state == "timeout"
            || update.state == "interrupted"
            || update.state == "skipped";

        // Se l'esecuzione è già terminale, ignora aggiornamenti tardivi
        let is_current_terminal = current_state == "completed"
            || current_state == "error"
            || current_state == "timeout"
            || current_state == "interrupted"
            || current_state == "skipped"
            || current_state == "unknown";
        if is_current_terminal {
            drop(conn);
            return self
                .get_occurrence(&run_id)
                .ok_or_else(|| format!("Occorrenza '{}' non trovata", run_id));
        }

        // Calcola durata attiva, active_since e human_deadline preservando started_at originale
        let (new_active_duration, new_active_since, human_deadline) = if update.state == "needsInput" {
            let added = if let Some(as_ts) = active_since {
                (now - as_ts).max(0) as u64
            } else {
                0
            };
            let h_deadline = human_wait_minutes.unwrap_or(60) as i64 * 60_000 + now;
            (active_dur as u64 + added, None, Some(h_deadline))
        } else if update.state == "running" {
            (active_dur as u64, Some(now), None)
        } else if is_final {
            let added = if let Some(as_ts) = active_since {
                (now - as_ts).max(0) as u64
            } else {
                0
            };
            (active_dur as u64 + added, None, None)
        } else {
            (active_dur as u64, active_since, None)
        };

        conn.execute(
            "UPDATE executions SET
                state = ?1,
                session_id = COALESCE(?2, session_id),
                model = COALESCE(?3, model),
                result = COALESCE(?4, result),
                question = COALESCE(?5, question),
                reason = COALESCE(?6, reason),
                finished_at = CASE WHEN ?7 THEN ?8 ELSE finished_at END,
                active_duration_ms = ?9,
                active_since = ?10,
                human_deadline = ?11
             WHERE id = ?12",
            params![
                update.state,
                update.session_id,
                update.model,
                update.result,
                update.question,
                update.reason,
                is_final,
                now,
                new_active_duration as i64,
                new_active_since,
                human_deadline,
                update.execution_id
            ],
        )
        .map_err(|e| e.to_string())?;

        // Aggiorna lo stato aggregato dell'occorrenza DIRETTAMENTE da SQLite sotto lock
        // senza sovrascrivere esecuzioni parallele di sibling worker
        let mut stmt = conn
            .prepare("SELECT state FROM executions WHERE run_id = ?1")
            .map_err(|e| e.to_string())?;
        let states: Vec<String> = stmt
            .query_map(params![run_id], |r| r.get(0))
            .map_err(|e| e.to_string())?
            .flatten()
            .collect();
        drop(stmt);

        let (agg_state, req_review) = compute_aggregated_state(&states);
        conn.execute(
            "UPDATE occurrences SET state = ?1, requires_review = CASE WHEN ?2 THEN 1 ELSE requires_review END WHERE id = ?3",
            params![agg_state, req_review, run_id],
        )
        .map_err(|e| e.to_string())?;

        drop(conn);

        self.get_occurrence(&run_id)
            .ok_or_else(|| format!("Occorrenza '{}' non trovata", run_id))
    }

    pub fn extend_human_wait(&self, execution_id: &str, additional_minutes: u64) -> Result<i64, String> {
        let conn = self.conn.lock();
        let (state, human_deadline): (String, Option<i64>) = conn
            .query_row(
                "SELECT state, human_deadline FROM executions WHERE id = ?1",
                params![execution_id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .map_err(|e| format!("Esecuzione '{}' non trovata: {}", execution_id, e))?;

        if state != "needsInput" {
            return Err(format!(
                "L'esecuzione '{}' non e' in stato 'needsInput' (stato attuale: {})",
                execution_id, state
            ));
        }

        let now = chrono_now_ms();
        let current_deadline = human_deadline.unwrap_or(now);
        let new_deadline = current_deadline.max(now) + (additional_minutes as i64 * 60_000);

        conn.execute(
            "UPDATE executions SET human_deadline = ?1 WHERE id = ?2",
            params![new_deadline, execution_id],
        )
        .map_err(|e| format!("Aggiornamento proroga deadline: {}", e))?;

        Ok(new_deadline)
    }

    // --- PROGETTI REGISTRATI ---

    pub fn get_registered_projects(&self) -> Result<Vec<AutomationProject>, String> {
        let conn = self.conn.lock();
        let mut stmt = conn
            .prepare("SELECT id, path, name, open, workspace_paths_json FROM registered_projects ORDER BY name ASC")
            .map_err(|e| format!("Errore prepare query progetti registrati: {}", e))?;

        let rows = stmt.query_map([], |row| {
            let id: String = row.get(0)?;
            let path: String = row.get(1)?;
            let name: String = row.get(2)?;
            let open: i32 = row.get(3)?;
            let wp_json: Option<String> = row.get(4).unwrap_or(None);
            let workspace_paths = wp_json
                .and_then(|j| serde_json::from_str(&j).ok())
                .unwrap_or_default();

            Ok(AutomationProject {
                id,
                path,
                name,
                open: open != 0,
                workspace_paths,
            })
        }).map_err(|e| format!("Errore query progetti registrati: {}", e))?;

        Ok(rows.flatten().collect())
    }

    pub fn save_registered_projects(&self, projects: &[AutomationProject]) -> Result<(), String> {
        let conn = self.conn.lock();
        for p in projects {
            let wp_json = serde_json::to_string(&p.workspace_paths).unwrap_or_else(|_| "[]".to_string());
            conn.execute(
                "INSERT INTO registered_projects (id, path, name, open, workspace_paths_json)
                 VALUES (?1, ?2, ?3, ?4, ?5)
                 ON CONFLICT(path) DO UPDATE SET
                    name = excluded.name,
                    open = excluded.open,
                    workspace_paths_json = excluded.workspace_paths_json",
                params![p.id, p.path, p.name, if p.open { 1 } else { 0 }, wp_json],
            )
            .map_err(|e| format!("Salvataggio progetto registrato: {}", e))?;
        }
        Ok(())
    }

    pub fn set_project_open(&self, path: &str, open: bool) {
        let conn = self.conn.lock();
        let norm = path.replace('\\', "/").trim_end_matches('/').to_lowercase();
        let _ = conn.execute(
            "UPDATE registered_projects SET open = ?1 WHERE LOWER(REPLACE(path, '\\', '/')) = ?2",
            params![if open { 1 } else { 0 }, norm],
        );
    }

    pub fn save_project_request(&self, req: &AutomationProjectRequest) -> Result<(), String> {
        let conn = self.conn.lock();
        conn.execute(
            "INSERT INTO project_requests (request_id, operation, path, execution_id, status, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)
             ON CONFLICT(request_id) DO UPDATE SET
                status = excluded.status",
            params![
                req.request_id,
                req.operation,
                req.path,
                req.execution_id,
                req.status,
                req.created_at
            ],
        )
        .map_err(|e| format!("Salvataggio richiesta progetto: {}", e))?;
        Ok(())
    }

    pub fn delete_project_request(&self, request_id: &str) -> Result<(), String> {
        let conn = self.conn.lock();
        conn.execute(
            "DELETE FROM project_requests WHERE request_id = ?1",
            params![request_id],
        )
        .map_err(|e| format!("Eliminazione richiesta progetto: {}", e))?;
        Ok(())
    }

    pub fn get_project_requests(&self) -> Result<Vec<AutomationProjectRequest>, String> {
        let conn = self.conn.lock();
        let mut stmt = conn
            .prepare(
                "SELECT request_id, operation, path, execution_id, status, created_at
                 FROM project_requests ORDER BY created_at ASC",
            )
            .map_err(|e| format!("Prepare query richieste progetti: {}", e))?;

        let rows = stmt
            .query_map([], |row| {
                Ok(AutomationProjectRequest {
                    request_id: row.get(0)?,
                    operation: row.get(1)?,
                    path: row.get(2)?,
                    execution_id: row.get(3)?,
                    status: row.get(4)?,
                    created_at: row.get(5)?,
                })
            })
            .map_err(|e| format!("Query richieste progetti: {}", e))?;

        Ok(rows.flatten().collect())
    }

    // --- OUTPUT E RETENTION (AUT-065, AUT-089) ---

    pub fn append_output(
        &self,
        execution_id: &str,
        text: &str,
        max_run_bytes: u64,
    ) -> Result<(usize, bool), String> {
        let path = self.outputs_dir.join(format!("{}.log", execution_id));
        let mut file = OpenOptions::new()
            .create(true)
            .append(true)
            .read(true)
            .open(&path)
            .map_err(|e| format!("Apertura log output: {}", e))?;

        let current_len = file.metadata().map(|m| m.len()).unwrap_or(0);
        if current_len >= max_run_bytes {
            self.mark_output_truncated(execution_id);
            return Ok((0, true));
        }

        let remaining = (max_run_bytes - current_len) as usize;
        let bytes = text.as_bytes();
        let (to_write, truncated) = if bytes.len() > remaining {
            (&bytes[..remaining], true)
        } else {
            (bytes, false)
        };

        file.write_all(to_write)
            .map_err(|e| format!("Scrittura log output: {}", e))?;

        if truncated {
            self.mark_output_truncated(execution_id);
        }

        Ok((to_write.len(), truncated))
    }

    fn mark_output_truncated(&self, execution_id: &str) {
        let conn = self.conn.lock();
        let _ = conn.execute(
            "UPDATE executions SET output_truncated = 1 WHERE id = ?1",
            params![execution_id],
        );
    }

    pub fn read_output(
        &self,
        execution_id: &str,
        offset: u64,
        limit: Option<u64>,
    ) -> Result<AutomationOutput, String> {
        let path = self.outputs_dir.join(format!("{}.log", execution_id));
        let default_limit = 64 * 1024; // 64 KiB
        let req_limit = limit.unwrap_or(default_limit).min(1024 * 1024);

        if !path.exists() {
            let conn = self.conn.lock();
            let state: Option<String> = conn
                .query_row(
                    "SELECT state FROM executions WHERE id = ?1",
                    params![execution_id],
                    |r| r.get(0),
                )
                .ok();

            let is_ended = state.as_deref().map_or(true, |s| {
                s == "completed" || s == "error" || s == "timeout" || s == "interrupted" || s == "skipped"
            });

            return Ok(AutomationOutput {
                text: String::new(),
                next_offset: offset,
                truncated: false,
                end: is_ended,
            });
        }

        let mut file = File::open(&path).map_err(|e| format!("Lettura log: {}", e))?;
        let file_len = file.metadata().map(|m| m.len()).unwrap_or(0);

        if offset >= file_len {
            let conn = self.conn.lock();
            let (state, truncated): (Option<String>, i32) = conn
                .query_row(
                    "SELECT state, output_truncated FROM executions WHERE id = ?1",
                    params![execution_id],
                    |r| Ok((r.get(0)?, r.get(1)?)),
                )
                .unwrap_or((None, 0));

            let is_ended = state.as_deref().map_or(true, |s| {
                s == "completed" || s == "error" || s == "timeout" || s == "interrupted" || s == "skipped"
            });

            return Ok(AutomationOutput {
                text: String::new(),
                next_offset: offset,
                truncated: truncated != 0,
                end: is_ended,
            });
        }

        file.seek(SeekFrom::Start(offset))
            .map_err(|e| format!("Seek log: {}", e))?;

        let to_read = (file_len - offset).min(req_limit) as usize;
        let mut buffer = vec![0u8; to_read];
        file.read_exact(&mut buffer)
            .map_err(|e| format!("Lettura buffer log: {}", e))?;

        let text = String::from_utf8_lossy(&buffer).to_string();
        let next_offset = offset + to_read as u64;

        let conn = self.conn.lock();
        let (state, truncated): (Option<String>, i32) = conn
            .query_row(
                "SELECT state, output_truncated FROM executions WHERE id = ?1",
                params![execution_id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap_or((None, 0));

        let is_ended = next_offset >= file_len
            && state.as_deref().map_or(true, |s| {
                s == "completed" || s == "error" || s == "timeout" || s == "interrupted" || s == "skipped"
            });

        Ok(AutomationOutput {
            text,
            next_offset,
            truncated: truncated != 0,
            end: is_ended,
        })
    }

    pub fn cleanup_retention(&self, retention_days: u32, total_bytes_cap: u64) {
        let cutoff_ms = chrono_now_ms() - (retention_days as i64 * 86_400_000);
        let conn = self.conn.lock();

        // 1. Trova occorrenze vecchie ma che non richiedono attenzione (AUT-065: attenzione non persa prima di revisione)
        let mut stmt = match conn.prepare(
            "SELECT id FROM occurrences WHERE scheduled_at < ?1 AND requires_review = 0 AND acknowledged = 1",
        ) {
            Ok(s) => s,
            Err(_) => return,
        };

        let old_run_ids: Vec<String> = stmt
            .query_map(params![cutoff_ms], |r| r.get(0))
            .map(|iter| iter.flatten().collect())
            .unwrap_or_default();
        drop(stmt);

        for rid in &old_run_ids {
            // Elimina i log associati
            let mut exec_stmt = match conn.prepare("SELECT id FROM executions WHERE run_id = ?1") {
                Ok(s) => s,
                Err(_) => continue,
            };
            let exec_ids: Vec<String> = exec_stmt
                .query_map(params![rid], |r| r.get(0))
                .map(|iter| iter.flatten().collect())
                .unwrap_or_default();
            drop(exec_stmt);

            for eid in exec_ids {
                let log_path = self.outputs_dir.join(format!("{}.log", eid));
                let _ = fs::remove_file(log_path);
            }

            let _ = conn.execute("DELETE FROM occurrences WHERE id = ?1", params![rid]);
        }

        // 2. Controllo spazio totale cartella output
        if let Ok(entries) = fs::read_dir(&self.outputs_dir) {
            let mut files = Vec::new();
            let mut total_size: u64 = 0;
            for entry in entries.flatten() {
                if let Ok(meta) = entry.metadata() {
                    if meta.is_file() {
                        total_size += meta.len();
                        files.push((entry.path(), meta.modified().ok(), meta.len()));
                    }
                }
            }

            if total_size > total_bytes_cap {
                // Ordina per data modifica crescente (piu' vecchi prima)
                files.sort_by_key(|f| f.1);
                for (p, _, size) in files {
                    if total_size <= total_bytes_cap {
                        break;
                    }
                    if fs::remove_file(&p).is_ok() {
                        total_size = total_size.saturating_sub(size);
                    }
                }
            }
        }
    }
}

impl AutomationOccurrence {
    /// Ricalcola lo stato complessivo dell'occorrenza in base agli stati delle esecuzioni.
    pub fn recompute_state(&mut self) {
        if self.executions.is_empty() {
            return;
        }

        // Se almeno una esecuzione chiede input umano -> needsInput (AUT-028, AUT-044)
        if self.executions.iter().any(|e| e.state == "needsInput") {
            self.state = "needsInput".to_string();
            return;
        }

        // Se almeno una è ancora in running -> running
        if self.executions.iter().any(|e| e.state == "running") {
            self.state = "running".to_string();
            return;
        }

        // Se almeno una è ancora in waiting -> waiting
        if self.executions.iter().any(|e| e.state == "waiting") {
            self.state = "waiting".to_string();
            return;
        }

        // Se almeno una ha esito unknown -> unknown
        if self.executions.iter().any(|e| e.state == "unknown") {
            self.state = "unknown".to_string();
            self.requires_review = true;
            return;
        }

        // Se tutte sono finite
        let all_completed = self.executions.iter().all(|e| e.state == "completed");
        let any_error = self.executions.iter().any(|e| e.state == "error" || e.state == "timeout");

        if all_completed {
            self.state = "completed".to_string();
        } else if any_error {
            self.state = "error".to_string();
        } else if self.executions.iter().any(|e| e.state == "interrupted") {
            self.state = "interrupted".to_string();
        } else if self.executions.iter().any(|e| e.state == "skipped") {
            self.state = "skipped".to_string();
        }
    }
}

pub fn chrono_now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}


pub fn uuid_v4() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let now = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_nanos();
    let pid = std::process::id();
    static COUNTER: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(1);
    let count = COUNTER.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    format!("{:016x}{:08x}{:08x}", now, pid, count)
}

fn compute_aggregated_state(states: &[String]) -> (String, bool) {
    if states.is_empty() {
        return ("completed".to_string(), false);
    }
    if states.iter().any(|s| s == "needsInput") {
        return ("needsInput".to_string(), false);
    }
    if states.iter().any(|s| s == "running") {
        return ("running".to_string(), false);
    }
    if states.iter().any(|s| s == "waiting") {
        return ("waiting".to_string(), false);
    }
    if states.iter().any(|s| s == "unknown") {
        return ("unknown".to_string(), true);
    }
    if states.iter().all(|s| s == "completed") {
        return ("completed".to_string(), false);
    }
    if states.iter().any(|s| s == "error" || s == "timeout") {
        return ("error".to_string(), false);
    }
    if states.iter().any(|s| s == "interrupted") {
        return ("interrupted".to_string(), false);
    }
    ("skipped".to_string(), false)
}
