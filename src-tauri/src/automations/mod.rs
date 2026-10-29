pub mod calendar;
pub mod engine;
pub mod events;
pub mod model;
pub mod quota;
pub mod runner;
pub mod secrets;
pub mod storage;

pub use engine::Engine;
pub use model::*;

use parking_lot::RwLock;
use std::sync::{Arc, LazyLock};
use tauri::{command, AppHandle, Emitter, Manager};

static ENGINE: LazyLock<RwLock<Option<Arc<Engine>>>> = LazyLock::new(|| RwLock::new(None));

pub fn init(app: AppHandle) -> Result<(), String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Percorso app_data_dir non disponibile: {}", e))?;
    let db_path = data_dir.join("automations.db");
    let outputs_dir = data_dir.join("automation_outputs");

    let engine = Engine::new(app.clone(), db_path, outputs_dir)?;
    *ENGINE.write() = Some(engine);
    Ok(())
}

pub fn shutdown() {
    if let Some(engine) = ENGINE.read().as_ref() {
        engine.shutdown();
    }
}

pub fn active_count() -> usize {
    ENGINE.read().as_ref().map_or(0, |e| e.active_count())
}

pub fn interactive_active_count() -> usize {
    ENGINE.read().as_ref().map_or(0, |e| e.interactive_active_count())
}

pub fn is_project_locked(path: &str, excluding_execution: Option<&str>) -> bool {
    ENGINE
        .read()
        .as_ref()
        .map_or(false, |e| e.is_project_locked(path, excluding_execution))
}

pub fn interactive_admission(path: &str) -> Result<(), String> {
    if let Some(engine) = ENGINE.read().as_ref() {
        engine.interactive_admission(path)
    } else {
        Ok(())
    }
}

pub fn release_interactive_admission(path: &str) {
    if let Some(engine) = ENGINE.read().as_ref() {
        engine.release_interactive_admission(path);
    }
}

pub fn resume_admission(execution_id: &str) -> Result<bool, String> {
    let engine = get_engine()?;
    engine.resume_admission(execution_id)
}

pub fn resume_release(execution_id: &str) -> Result<(), String> {
    let engine = get_engine()?;
    engine.resume_release(execution_id)
}

pub fn is_execution_terminal(execution_id: &str) -> bool {
    ENGINE
        .read()
        .as_ref()
        .map_or(false, |e| e.is_execution_terminal(execution_id))
}

pub fn project_path_for_id(project_id: &str) -> Option<String> {
    ENGINE
        .read()
        .as_ref()
        .and_then(|e| e.project_path_for_id(project_id))
}

pub fn canonical_root_for_path(path: &str) -> String {
    ENGINE
        .read()
        .as_ref()
        .map_or_else(|| path.to_string(), |e| e.canonical_root_for_path(path))
}

pub fn host_handshake(host_epoch: &str) -> Result<Vec<String>, String> {
    let engine = get_engine()?;
    engine.host_handshake(host_epoch)
}

pub fn extend_human_wait(run_id: &str, execution_id: &str, minutes: u64) -> Result<i64, String> {
    let engine = get_engine()?;
    engine.extend_human_wait(run_id, execution_id, minutes)
}

fn get_engine() -> Result<Arc<Engine>, String> {
    ENGINE
        .read()
        .as_ref()
        .cloned()
        .ok_or_else(|| "Motore automazioni non ancora inizializzato".to_string())
}

fn is_definition_in_owner_scope(def: &AutomationDefinition, owner: &crate::lane_bridge::BridgeOwner) -> bool {
    if owner.owner_kind == "terminal" || (owner.lane_id.is_none() && owner.cwd.is_empty()) {
        return true;
    }
    let owner_norm = engine::normalize_project_path(&owner.cwd);
    if owner_norm.is_empty() {
        return true;
    }
    let targets = &def.targets;
    if targets.project_paths.iter().any(|p| engine::normalize_project_path(p) == owner_norm) {
        return true;
    }
    if !targets.cwd.is_empty() && engine::normalize_project_path(&targets.cwd) == owner_norm {
        return true;
    }
    false
}

/// Ponte per richieste provenienti da agenti esterni (lane_bridge / HTTP).
/// Rispetta il vincolo AUT-000A, AUT-002, AUT-061: le modifiche possono essere SOLO proposte come bozze,
/// nessuna attivazione, esecuzione o cancellazione diretta da parte degli agenti.
pub fn agent_request(
    owner: &crate::lane_bridge::BridgeOwner,
    action: &str,
    body: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let engine = get_engine()?;
    let now = storage::chrono_now_ms();

    match action {
        "list" => {
            let mut defs = engine.storage().get_definitions().map_err(|e| e.to_string())?;
            defs.retain(|d| is_definition_in_owner_scope(d, owner));
            Ok(serde_json::json!({
                "ok": true,
                "text": format!("Trovate {} automazioni.", defs.len()),
                "details": defs,
            }))
        }
        "get" => {
            let id = body
                .get("id")
                .and_then(|v| v.as_str())
                .ok_or_else(|| "Parametro 'id' mancante".to_string())?;

            if let Some(def) = engine.storage().get_definition(id) {
                if !is_definition_in_owner_scope(&def, owner) {
                    return Ok(serde_json::json!({
                        "ok": false,
                        "text": format!("Automazione '{}' fuori dallo scope autorizzato dell'agente.", id),
                    }));
                }
                Ok(serde_json::json!({
                    "ok": true,
                    "text": format!("Automazione '{}' trovata.", def.name),
                    "details": def,
                }))
            } else {
                Ok(serde_json::json!({
                    "ok": false,
                    "text": format!("Automazione '{}' non trovata.", id),
                }))
            }
        }
        "runs" => {
            let mut runs = engine.storage().get_occurrences(20).map_err(|e| e.to_string())?;
            let owner_norm = engine::normalize_project_path(&owner.cwd);
            runs.retain(|r| {
                is_definition_in_owner_scope(&r.definition, owner)
                    || (!owner_norm.is_empty() && r.targets.iter().any(|t| engine::normalize_project_path(&t.path) == owner_norm))
            });
            Ok(serde_json::json!({
                "ok": true,
                "text": format!("Trovate {} esecuzioni recenti.", runs.len()),
                "details": runs,
            }))
        }
        "propose_create" => {
            let def_val = body.get("definition").unwrap_or(&body);
            let mut def: AutomationDefinition = serde_json::from_value(def_val.clone())
                .map_err(|e| format!("Formato JSON definizione non valido per propose_create: {}", e))?;

            let owner_norm = engine::normalize_project_path(&owner.cwd);
            if !owner_norm.is_empty() && owner.owner_kind != "terminal" {
                if def.targets.project_paths.is_empty() {
                    def.targets.project_paths = vec![owner.cwd.clone()];
                    def.targets.source = "selected".to_string();
                } else if !def.targets.project_paths.iter().any(|p| engine::normalize_project_path(p) == owner_norm) {
                    return Ok(serde_json::json!({
                        "ok": false,
                        "text": format!("Non puoi proporre automazioni che agiscono su percorsi fuori dallo scope ({})", owner.cwd),
                    }));
                }
            }

            let draft = AutomationDraft {
                id: storage::uuid_v4(),
                definition: def,
                base_revision: None,
                conversation: Vec::new(),
                created_at: now,
                updated_at: now,
                source: format!("agent:{}", owner.owner_id),
            };

            engine.storage().save_draft(&draft)?;

            // Notifica la UI per mostrare la nuova bozza in revisione (AUT-002)
            let _ = engine.app().emit(
                "automations://review",
                serde_json::json!({
                    "draftId": draft.id
                }),
            );
            let _ = engine.app().emit("automations://changed", ());

            Ok(serde_json::json!({
                "ok": true,
                "text": "Bozza creata e proposta per la revisione utente nella UI di OMP Studio.",
                "details": {
                    "draftId": draft.id,
                    "definition": draft.definition
                }
            }))
        }
        "propose_update" => {
            let id = body
                .get("id")
                .and_then(|v| v.as_str())
                .ok_or_else(|| "Parametro 'id' mancante per propose_update".to_string())?;

            let existing = engine
                .storage()
                .get_definition(id)
                .ok_or_else(|| format!("Automazione '{}' non trovata", id))?;

            if !is_definition_in_owner_scope(&existing, owner) {
                return Ok(serde_json::json!({
                    "ok": false,
                    "text": format!("Automazione '{}' fuori dallo scope autorizzato dell'agente.", id),
                }));
            }

            let def_val = body.get("definition")
                .ok_or_else(|| "Campo 'definition' mancante per propose_update".to_string())?;
            let mut updated_def: AutomationDefinition = serde_json::from_value(def_val.clone())
                .map_err(|e| format!("Formato JSON definizione non valido per propose_update: {}", e))?;
            updated_def.id = existing.id.clone();
            updated_def.revision = existing.revision;
            updated_def.updated_at = now;

            let draft = AutomationDraft {
                id: storage::uuid_v4(),
                definition: updated_def,
                base_revision: Some(existing.revision),
                conversation: Vec::new(),
                created_at: now,
                updated_at: now,
                source: format!("agent:{}", owner.owner_id),
            };

            engine.storage().save_draft(&draft)?;

            let _ = engine.app().emit(
                "automations://review",
                serde_json::json!({
                    "draftId": draft.id
                }),
            );
            let _ = engine.app().emit("automations://changed", ());

            Ok(serde_json::json!({
                "ok": true,
                "text": "Aggiornamento proposto come bozza per la revisione utente nella UI di OMP Studio.",
                "details": {
                    "draftId": draft.id,
                    "definition": draft.definition
                }
            }))
        }
        "projects" => {
            let operation = body.get("operation").and_then(|v| v.as_str()).unwrap_or("list");
            match operation {
                "list" => {
                    let projects = engine.storage().get_registered_projects().map_err(|e| e.to_string())?;
                    Ok(serde_json::json!({
                        "ok": true,
                        "text": format!("Catalogo progetti ({} registrati).", projects.len()),
                        "details": projects,
                    }))
                }
                "open" | "close" => {
                    let path = body
                        .get("path")
                        .and_then(|v| v.as_str())
                        .ok_or_else(|| "Parametro 'path' obbligatorio per open/close".to_string())?;

                    // Scope check: perimetro dell'agente o destinatari autorizzati
                    let target_norm = engine::normalize_project_path(path);
                    let owner_cwd_norm = engine::normalize_project_path(&owner.cwd);
                    let allowed = target_norm == owner_cwd_norm
                        || owner.owner_kind == "terminal"
                        || owner.lane_id.is_none();

                    if !allowed {
                        return Ok(serde_json::json!({
                            "ok": false,
                            "text": format!(
                                "Operazione non autorizzata sul percorso '{}': fuori dallo scope dell'agente (AUT-086).",
                                path
                            ),
                        }));
                    }

                    let execution_id = body.get("executionId").and_then(|v| v.as_str());
                    let req = engine.request_project_operation(operation, path, execution_id)?;

                    let msg = if req.status == "deferred" {
                        "Chiusura del progetto differita al termine dell'esecuzione (AUT-091)."
                    } else if operation == "open" {
                        "Richiesta apertura progetto inviata a Studio."
                    } else {
                        "Richiesta chiusura progetto inviata a Studio."
                    };

                    Ok(serde_json::json!({
                        "ok": true,
                        "text": msg,
                        "details": req,
                    }))
                }
                _ => Ok(serde_json::json!({
                    "ok": false,
                    "text": format!("Operazione '{}' non supportata. Valide: 'list', 'open', 'close'.", operation),
                })),
            }
        }
        "event" => {
            // AUT-014: whitelist per eventi agente emessi da PTY/bridge autenticato
            let kind = body
                .get("kind")
                .and_then(|v| v.as_str())
                .ok_or_else(|| "Parametro 'kind' mancante".to_string())?;

            if kind != "agentFinished" && kind != "agentQuota" && kind != "agentError" {
                return Ok(serde_json::json!({
                    "ok": false,
                    "text": format!("Tipo evento '{}' non consentito. Whitelist ammessa: 'agentFinished', 'agentQuota', 'agentError' (AUT-014).", kind),
                }));
            }

            // Autorità: solo terminal / sessione interattiva reale, escludi automation / readonly / Lab
            if owner.owner_kind != "terminal" && owner.owner_kind != "agent" {
                return Ok(serde_json::json!({
                    "ok": false,
                    "text": "Autorità insufficiente per emettere eventi agente (AUT-014).",
                }));
            }

            if let Some(lane) = &owner.lane_id {
                let lane_lower = lane.to_lowercase();
                if lane_lower.starts_with("lab-") || lane_lower.contains("readonly") {
                    return Ok(serde_json::json!({
                        "ok": false,
                        "text": "Eventi ignorati per corsie Lab o readonly (AUT-014).",
                    }));
                }
            }

            // Ricava canonical project path dal project_id autenticato o dalla cwd
            let project_path = owner
                .project_id
                .as_deref()
                .and_then(|pid| engine.project_path_for_id(pid))
                .unwrap_or_else(|| owner.cwd.clone());

            let detail = body.get("detail").and_then(|v| v.as_str()).map(str::to_string);

            let ev = AutomationEvent {
                kind: kind.to_string(),
                at: now,
                project_path: if project_path.is_empty() { None } else { Some(project_path) },
                paths: Vec::new(),
                branch: None,
                commit: None,
                origin: Some("interactive".to_string()),
                detail,
            };

            let definitions = engine.storage().get_definitions().unwrap_or_default();
            for def in &definitions {
                if def.state == "enabled" && engine.event_matches_definition(&ev, def) {
                    engine.enqueue_occurrence(def, ev.clone(), now);
                }
            }

            Ok(serde_json::json!({
                "ok": true,
                "text": format!("Evento agente '{}' registrato e processato (AUT-014).", kind),
            }))
        }
        _ => Ok(serde_json::json!({
            "ok": false,
            "text": format!(
                "Azione '{}' non consentita per gli agenti. L'attivazione, esecuzione e cancellazione delle automazioni possono avvenire solo su conferma esplicita dell'utente nella UI (AUT-002, AUT-061).",
                action
            ),
        })),
    }
}


// =========================================================================
// COMANDI TAURI
// =========================================================================

#[command]
pub async fn automations_snapshot() -> Result<AutomationSnapshot, String> {
    let engine = get_engine()?;
    Ok(engine.get_snapshot())
}

#[command]
pub async fn automations_save_draft(draft: AutomationDraft) -> Result<AutomationDraft, String> {
    let engine = get_engine()?;
    let mut d = draft;
    d.updated_at = storage::chrono_now_ms();
    engine.storage().save_draft(&d)?;
    let _ = engine.app().emit("automations://changed", ());
    Ok(d)
}

#[command]
pub async fn automations_activate(
    draft_id: String,
    expected_revision: Option<u64>,
) -> Result<AutomationDefinition, String> {
    let engine = get_engine()?;
    let draft = engine
        .storage()
        .get_draft(&draft_id)
        .ok_or_else(|| format!("Bozza '{}' non trovata", draft_id))?;

    let mut def = draft.definition;

    if let Some(_base_rev) = draft.base_revision {
        if let Some(existing) = engine.storage().get_definition(&def.id) {
            let exp = expected_revision.unwrap_or(0);
            if exp > 0 && existing.revision != exp {
                return Err(format!(
                    "Conflitto di revisione: attesa revisione {} ma l'automazione ha revisione {} (AUT-067)",
                    exp, existing.revision
                ));
            }
            def.revision = existing.revision + 1;
        } else {
            def.revision = 1;
        }
    } else {
        def.revision = 1;
    }

    def.state = "enabled".to_string();
    def.updated_at = storage::chrono_now_ms();

    // Salva la nuova definizione
    engine.storage().save_definition(&def)?;

    // Elimina la bozza ora attivata
    let _ = engine.storage().delete_draft(&draft_id);

    // AUT-067: Annulla le occorrenze pendenti come superate
    if let Ok(runs) = engine.storage().get_occurrences(50) {
        for mut r in runs {
            if r.automation_id == def.id && r.state == "waiting" {
                r.state = "superseded".to_string();
                for exec in &mut r.executions {
                    if exec.state == "waiting" {
                        exec.state = "superseded".to_string();
                        exec.reason = Some("Superata da una nuova revisione dell'automazione".to_string());
                    }
                }
                let _ = engine.storage().save_occurrence(&r);
            }
        }
    }

    let _ = engine.app().emit("automations://changed", ());
    Ok(def)
}

#[command]
pub async fn automations_set_state(id: String, state: String) -> Result<(), String> {
    let engine = get_engine()?;
    engine.storage().set_definition_state(&id, &state)?;

    // Se disabilitata o archiviata, annulla le pendenti (AUT-068)
    if state == "disabled" || state == "archived" {
        if let Ok(runs) = engine.storage().get_occurrences(50) {
            for mut r in runs {
                if r.automation_id == id && r.state == "waiting" {
                    r.state = "interrupted".to_string();
                    for exec in &mut r.executions {
                        if exec.state == "waiting" {
                            exec.state = "interrupted".to_string();
                            exec.reason = Some("Automazione disattivata o archiviata".to_string());
                        }
                    }
                    let _ = engine.storage().save_occurrence(&r);
                }
            }
        }
    }

    let _ = engine.app().emit("automations://changed", ());
    Ok(())
}

#[command]
pub async fn automations_delete(id: String, delete_history: bool) -> Result<(), String> {
    let engine = get_engine()?;
    engine.storage().delete_definition(&id, delete_history)?;
    let _ = engine.app().emit("automations://changed", ());
    Ok(())
}

#[command]
pub async fn automations_run_now(
    id: String,
    target_paths: Option<Vec<String>>,
) -> Result<AutomationOccurrence, String> {
    let engine = get_engine()?;
    engine.run_now(&id, target_paths)
}

#[command]
pub async fn automations_cancel(run_id: String, execution_id: Option<String>) -> Result<(), String> {
    let engine = get_engine()?;
    engine.cancel(&run_id, execution_id.as_deref())
}

#[command]
pub async fn automations_acknowledge(run_id: String, resolve_unknown: Option<bool>) -> Result<(), String> {
    let engine = get_engine()?;
    engine
        .storage()
        .acknowledge_occurrence(&run_id, resolve_unknown.unwrap_or(false))?;
    let _ = engine.app().emit("automations://changed", ());
    Ok(())
}

#[command]
pub async fn automations_settings(settings: AutomationSettings) -> Result<(), String> {
    let engine = get_engine()?;
    engine.storage().save_settings(&settings)?;
    let _ = engine.app().emit("automations://changed", ());
    Ok(())
}

#[command]
pub async fn automations_update_context(context: AutomationContext) -> Result<(), String> {
    let engine = get_engine()?;
    engine.update_context(context)
}

#[command]
pub async fn automations_event(event: AutomationEvent) -> Result<(), String> {
    let engine = get_engine()?;
    let now = storage::chrono_now_ms();
    let definitions = engine.storage().get_definitions().unwrap_or_default();
    for def in &definitions {
        if def.state == "enabled" {
            engine.enqueue_occurrence(def, event.clone(), now);
        }
    }
    Ok(())
}

#[command]
pub async fn automations_ai_pending() -> Result<Vec<AutomationAiRequest>, String> {
    let engine = get_engine()?;
    Ok(engine.get_pending_ai_requests())
}

#[command]
pub async fn automations_ai_update(update: AutomationAiUpdate) -> Result<AutomationOccurrence, String> {
    let engine = get_engine()?;
    engine.handle_ai_update(update)
}

#[command]
pub async fn automations_output(
    execution_id: String,
    offset: Option<u64>,
    limit: Option<u64>,
) -> Result<AutomationOutput, String> {
    let engine = get_engine()?;
    engine
        .storage()
        .read_output(&execution_id, offset.unwrap_or(0), limit)
}

#[command]
pub async fn automations_preview(definition: AutomationDefinition) -> Result<AutomationPreview, String> {
    let engine = get_engine()?;
    engine.preview(&definition)
}

#[command]
pub async fn automations_export(ids: Vec<String>) -> Result<String, String> {
    let engine = get_engine()?;
    engine.export_definitions(&ids)
}

#[command]
pub async fn automations_import(json: String) -> Result<Vec<AutomationDraft>, String> {
    let engine = get_engine()?;
    engine.import_definitions(&json)
}

#[command]
pub async fn automations_secret_put(id: String, value: String) -> Result<(), String> {
    secrets::put(&id, &value)
}

#[command]
pub async fn automations_secret_delete(id: String) -> Result<(), String> {
    secrets::remove(&id)
}

#[command]
pub async fn automations_project_result(
    request_id: String,
    ok: bool,
    detail: Option<String>,
) -> Result<(), String> {
    let engine = get_engine()?;
    engine.resolve_project_request(&request_id, ok, detail.as_deref())
}

#[command]
pub async fn automations_project_pending() -> Result<Vec<AutomationProjectRequest>, String> {
    let engine = get_engine()?;
    Ok(engine.get_pending_project_requests())
}

#[command]
pub async fn automations_title_claim(id: String) -> Result<bool, String> {
    let engine = get_engine()?;
    Ok(engine.claim_title_slot(&id))
}

#[command]
pub async fn automations_title_release(id: String) -> Result<(), String> {
    let engine = get_engine()?;
    engine.release_title_slot(&id);
    Ok(())
}

#[command]
pub async fn automations_resume_admission(execution_id: String) -> Result<bool, String> {
    let engine = get_engine()?;
    engine.resume_admission(&execution_id)
}

#[command]
pub async fn automations_resume_release(execution_id: String) -> Result<(), String> {
    let engine = get_engine()?;
    engine.resume_release(&execution_id)
}

#[command]
pub async fn automations_is_execution_terminal(execution_id: String) -> Result<bool, String> {
    let engine = get_engine()?;
    Ok(engine.is_execution_terminal(&execution_id))
}

#[command]
pub async fn automations_project_path_for_id(project_id: String) -> Result<Option<String>, String> {
    let engine = get_engine()?;
    Ok(engine.project_path_for_id(&project_id))
}

#[command]
pub async fn automations_host_handshake(host_epoch: String) -> Result<Vec<String>, String> {
    let engine = get_engine()?;
    engine.host_handshake(&host_epoch)
}

#[command]
pub async fn automations_extend_wait(
    run_id: String,
    execution_id: String,
    minutes: u64,
) -> Result<i64, String> {
    let engine = get_engine()?;
    engine.extend_human_wait(&run_id, &execution_id, minutes)
}

#[command]
pub async fn automations_canonical_root(path: String) -> Result<String, String> {
    let engine = get_engine()?;
    Ok(engine.canonical_root_for_path(&path))
}
