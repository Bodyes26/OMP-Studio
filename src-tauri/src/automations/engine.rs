use crate::automations::calendar;
use crate::automations::events::{ObservedAutomationEvent, Observer};
use crate::automations::model::*;
use crate::automations::quota;
use crate::automations::runner::{self, CommandOutcome, CommandRequest};
use crate::automations::secrets;
use crate::automations::storage::{chrono_now_ms, uuid_v4, Storage};

use parking_lot::{Mutex, RwLock};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::fs::{self, File};
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tauri::{AppHandle, Emitter};

pub struct Engine {
    app: AppHandle,
    storage: Arc<Storage>,
    context: Arc<RwLock<AutomationContext>>,
    context_ready: Arc<AtomicBool>,
    observer: Arc<Mutex<Option<Observer>>>,
    running_commands: Arc<Mutex<HashMap<String, Arc<AtomicBool>>>>,
    running_ai_executions: Arc<Mutex<std::collections::HashSet<String>>>,
    needs_input_executions: Arc<Mutex<std::collections::HashSet<String>>>,
    project_locks: Arc<Mutex<HashMap<String, String>>>,
    pending_ai_requests: Arc<Mutex<HashMap<String, AutomationAiRequest>>>,
    pending_project_requests: Arc<Mutex<HashMap<String, AutomationProjectRequest>>>,
    notification_history: Arc<Mutex<HashMap<(String, String), i64>>>,
    last_trigger_check_ms: Arc<Mutex<HashMap<String, i64>>>,
    last_retention_check_ms: Arc<Mutex<i64>>,
    active_titles: Arc<Mutex<std::collections::HashSet<String>>>,
    current_host_epoch: Arc<Mutex<Option<String>>>,
    monitoring_since: i64,
    stop_flag: Arc<AtomicBool>,
}

impl Engine {
    pub fn new(app: AppHandle, db_path: PathBuf, outputs_dir: PathBuf) -> Result<Arc<Self>, String> {
        let storage = Arc::new(Storage::open(&db_path, &outputs_dir)?);

        // Crash recovery: riconcilia occorrenze rimaste aperte (AUT-046, AUT-106)
        let suspended = storage.reconcile_crash()?;
        if !suspended.is_empty() {
            println!(
                "[automations] Crash recovery: sospese {} automazioni con esito non verificato",
                suspended.len()
            );
        }

        let now = chrono_now_ms();
        let initial_reqs = storage.get_project_requests()?;
        let mut req_map = HashMap::new();
        for r in initial_reqs {
            req_map.insert(r.request_id.clone(), r);
        }

        let engine = Arc::new(Self {
            app,
            storage,
            context: Arc::new(RwLock::new(AutomationContext::default())),
            context_ready: Arc::new(AtomicBool::new(false)),
            observer: Arc::new(Mutex::new(Some(Observer::new()))),
            running_commands: Arc::new(Mutex::new(HashMap::new())),
            running_ai_executions: Arc::new(Mutex::new(std::collections::HashSet::new())),
            needs_input_executions: Arc::new(Mutex::new(std::collections::HashSet::new())),
            project_locks: Arc::new(Mutex::new(HashMap::new())),
            pending_ai_requests: Arc::new(Mutex::new(HashMap::new())),
            pending_project_requests: Arc::new(Mutex::new(req_map)),
            notification_history: Arc::new(Mutex::new(HashMap::new())),
            last_trigger_check_ms: Arc::new(Mutex::new(HashMap::new())),
            last_retention_check_ms: Arc::new(Mutex::new(0)),
            active_titles: Arc::new(Mutex::new(std::collections::HashSet::new())),
            current_host_epoch: Arc::new(Mutex::new(None)),
            monitoring_since: now,
            stop_flag: Arc::new(AtomicBool::new(false)),
        });

        engine.start_tick_loop();
        Ok(engine)
    }

    pub fn shutdown(&self) {
        self.stop_flag.store(true, Ordering::SeqCst);

        // 1. Segnala ai comandi in corso
        let runners = self.running_commands.lock().clone();
        for (_, cancel) in runners {
            cancel.store(true, Ordering::SeqCst);
        }

        // 2. Chiudi selettivamente l'albero processi di tutte le sessioni AI
        let ai_pending = self.pending_ai_requests.lock().clone();
        for (exec_id, _) in ai_pending {
            crate::rpc::close_automation_execution(&self.app, &exec_id);
        }

        self.running_commands.lock().clear();
        self.running_ai_executions.lock().clear();
        self.needs_input_executions.lock().clear();
        self.pending_ai_requests.lock().clear();
        self.project_locks.lock().clear();
    }

    pub fn app(&self) -> &AppHandle {
        &self.app
    }

    pub fn active_count(&self) -> usize {
        let cmd_count = self.running_commands.lock().len();
        let ai_running = self.running_ai_executions.lock().len();
        let ai_needs_input = self.needs_input_executions.lock().len();
        let title_count = self.active_titles.lock().len();
        cmd_count + ai_running + ai_needs_input + title_count
    }

    pub fn claim_title_slot(&self, id: &str) -> bool {
        let ctx = self.context.read().clone();

        // 1. Precedenza interattiva (AUT-041)
        if ctx.interactive_waiting || (ctx.max_agent_count > 0 && ctx.interactive_agent_count >= ctx.max_agent_count) {
            return false;
        }

        // 2. Precedenza automazioni personali: i titoli attendono solo se ci sono occorrenze AI ammissibili ORA
        if let Ok(occs) = self.storage.get_occurrences(20) {
            let has_admissible_ai = occs.iter().any(|o| {
                o.state == "waiting" && self.is_occurrence_admissible_now(o, &ctx)
            });
            if has_admissible_ai {
                return false;
            }
        }

        // 3. Cap globale AI (CONCURRENCY_SOFT_CAP = 2 o max_agent_count)
        let global_ai_cap = if ctx.max_agent_count > 0 { ctx.max_agent_count } else { 2 };
        let active_ai = self.running_ai_executions.lock().len();
        let mut titles = self.active_titles.lock();
        let total_ai_usage = ctx.interactive_agent_count + active_ai + titles.len();

        if total_ai_usage >= global_ai_cap {
            return false;
        }

        titles.insert(id.to_string());
        drop(titles);

        self.emit_changed();
        true
    }

    fn is_occurrence_admissible_now(&self, occ: &AutomationOccurrence, ctx: &AutomationContext) -> bool {
        if let AutomationAction::Prompt(pa) = &occ.definition.action {
            // Verifica quote
            if !quota::evaluate(&pa.model, &occ.definition.policy.quota).allowed {
                return false;
            }
            // Verifica branch se vincolato
            if !occ.definition.branches.is_empty() {
                let obs_guard = self.observer.lock();
                for t in &occ.targets {
                    if let Some(obs) = obs_guard.as_ref() {
                        if let Some(curr_br) = obs.current_branch(&t.path) {
                            if !occ.definition.branches.iter().any(|b| b == &curr_br) {
                                return false;
                            }
                        }
                    }
                }
            }
            // Verifica disponibilità lock sui target
            let locks = self.project_locks.lock();
            for t in &occ.targets {
                let norm = normalize_project_path(&t.path);
                if locks.contains_key(&norm) || ctx.busy_paths.iter().any(|bp| normalize_project_path(bp) == norm) {
                    return false;
                }
            }
            true
        } else {
            false
        }
    }

    pub fn release_title_slot(&self, id: &str) {
        let removed = self.active_titles.lock().remove(id);
        if removed {
            self.emit_changed();
        }
    }

    pub fn interactive_active_count(&self) -> usize {
        self.context.read().interactive_agent_count
    }

    pub fn update_context(&self, ctx: AutomationContext) -> Result<(), String> {
        // Salva i progetti registrati propagando l'errore SQLite
        self.storage.save_registered_projects(&ctx.projects)?;

        {
            let mut w = self.context.write();
            *w = ctx;
        }

        self.context_ready.store(true, Ordering::SeqCst);
        self.update_observer_targets();
        self.emit_changed();
        Ok(())
    }

    fn update_observer_targets(&self) {
        let definitions = self.storage.get_definitions().unwrap_or_default();
        let registered = self.storage.get_registered_projects().unwrap_or_default();
        let suppressed: Vec<String> = self.project_locks.lock().keys().cloned().collect();

        let mut obs_guard = self.observer.lock();
        if let Some(obs) = obs_guard.as_mut() {
            obs.update(&registered, &definitions, &suppressed);
        }
    }

    fn start_tick_loop(self: &Arc<Self>) {
        let engine = Arc::clone(self);
        std::thread::spawn(move || {
            while !engine.stop_flag.load(Ordering::SeqCst) {
                let now = chrono_now_ms();
                engine.tick(now);
                std::thread::sleep(Duration::from_millis(1000));
            }
        });
    }

    pub fn tick(&self, now_ms: i64) {
        // NON avviare tick/calendario/eventi prima che il primo context sia pronto dall'host
        if !self.context_ready.load(Ordering::SeqCst) {
            return;
        }
        let last_retention = *self.last_retention_check_ms.lock();
        if now_ms - last_retention > 3600_000 {
            *self.last_retention_check_ms.lock() = now_ms;
            let settings = self.storage.get_settings();
            self.storage.cleanup_retention(settings.retention_days, settings.output_total_bytes);
        }

        // 2. Poll eventi dall'Observer (Git, file, agente, studio)
        self.poll_observer_events(now_ms);

        // 3. Valutazione trigger a calendario / intervalli
        self.evaluate_calendar_triggers(now_ms);

        // 4. Controllo scadenze waiting e human input
        self.evaluate_deadlines_and_timeouts(now_ms);

        // 5. Ammissione ed esecuzione lavori in waiting
        self.dispatch_waiting_executions(now_ms);

        // 6. AUT-078: avviso in-run se la riserva quota viene attraversata senza stop (dedup 5min)
        if let Ok(occurrences) = self.storage.get_occurrences(20) {
            for occ in occurrences {
                if occ.state == "running" {
                    if let AutomationAction::Prompt(pa) = &occ.definition.action {
                        let q_eval = quota::evaluate(&pa.model, &occ.definition.policy.quota);
                        if !q_eval.allowed {
                            self.send_notification(
                                &occ.automation_id,
                                &occ.name,
                                "Riserva quota attraversata (AUT-078)",
                                &format!("Durante l'esecuzione, la riserva per il modello '{}' è scesa sotto la soglia richiesta.", pa.model),
                                "quota_crossed_inrun",
                            );
                        }
                    }
                }
            }
        }
    }

    fn poll_observer_events(&self, now_ms: i64) {
        let events = {
            let mut obs_guard = self.observer.lock();
            if let Some(obs) = obs_guard.as_mut() {
                obs.poll(now_ms)
            } else {
                Vec::new()
            }
        };

        if events.is_empty() {
            return;
        }

        let definitions = match self.storage.get_definitions() {
            Ok(d) => d,
            Err(e) => {
                eprintln!("[automations] Errore lettura definizioni SQLite: {}", e);
                return;
            }
        };
        for obs_ev in events {
            if let Some(target_def_id) = &obs_ev.automation_id {
                if let Some(def) = definitions.iter().find(|d| &d.id == target_def_id) {
                    if def.state == "enabled" {
                        let _ = self.enqueue_occurrence(def, obs_ev.event, now_ms);
                    }
                }
            } else {
                for def in &definitions {
                    if def.state == "enabled" && self.event_matches_definition(&obs_ev.event, def) {
                        let _ = self.enqueue_occurrence(def, obs_ev.event.clone(), now_ms);
                    }
                }
            }
        }
    }

    pub fn event_matches_definition(&self, event: &AutomationEvent, def: &AutomationDefinition) -> bool {
        for trigger in &def.triggers {
            if trigger.kind != event.kind {
                continue;
            }

            // Match percorsi per eventi file e git:
            // Non imporre event.project_path == action target su trigger file autorizzati (possono osservare cartelle esterne)
            if trigger.kind != "file" {
                if let Some(p_path) = &event.project_path {
                    let targets = &def.targets;
                    let matches_target = targets.project_paths.is_empty()
                        || targets.project_paths.iter().any(|tp| normalize_project_path(tp) == normalize_project_path(p_path));
                    if !matches_target {
                        continue;
                    }
                }
            }

            // Match branch per eventi git
            if let Some(ev_branch) = &event.branch {
                if !trigger.branches.is_empty() && !trigger.branches.iter().any(|b| b == ev_branch) {
                    continue;
                }
            }

            return true;
        }
        false
    }

    fn evaluate_calendar_triggers(&self, now_ms: i64) {
        let definitions = match self.storage.get_definitions() {
            Ok(d) => d,
            Err(e) => {
                eprintln!("[automations] Errore lettura definizioni SQLite: {}", e);
                return;
            }
        };
        let mut last_checks = self.last_trigger_check_ms.lock();

        for def in &definitions {
            if def.state != "enabled" {
                continue;
            }

            let last_check = last_checks.get(&def.id).copied().unwrap_or(def.created_at);

            for trigger in &def.triggers {
                if trigger.kind == "manual" || trigger.kind == "gitCommit" || trigger.kind == "gitBranch"
                    || trigger.kind == "gitDirty" || trigger.kind == "gitClean" || trigger.kind == "file"
                    || trigger.kind == "agentFinished" || trigger.kind == "agentQuota" || trigger.kind == "agentError"
                    || trigger.kind == "studioStarted" || trigger.kind == "projectOpened"
                {
                    continue;
                }

                // Trova ultima occorrenza terminata per afterFinish (AUT-037)
                let last_finished = if trigger.kind == "afterFinish" {
                    self.storage
                        .get_occurrences(10)
                        .ok()
                        .and_then(|occs| occs.into_iter().find(|o| o.automation_id == def.id && o.state == "completed"))
                        .and_then(|o| o.executions.into_iter().next())
                        .and_then(|e| e.finished_at)
                } else {
                    None
                };

                let occs = calendar::next_occurrences(
                    trigger,
                    &def.policy.timezone,
                    last_check,
                    1,
                    def.created_at,
                    last_finished,
                );

                if let Ok(nexts) = occs {
                    if let Some(&sched_at) = nexts.first() {
                        if sched_at <= now_ms {
                            // Controllo scadenza persa (AUT-009, AUT-040)
                            let wait_limit_ms = (def.policy.max_wait_minutes as i64) * 60_000;
                            if now_ms - sched_at > wait_limit_ms {
                                match def.policy.missed.as_str() {
                                    "notify" => {
                                        self.send_notification(
                                            &def.id,
                                            &def.name,
                                            "Scadenza persa",
                                            &format!(
                                                "L'automazione '{}' ha saltato la scadenza prevista per superamento del tempo massimo.",
                                                def.name
                                            ),
                                            "missed",
                                        );
                                    }
                                    "recover" => {
                                        let recovery_limit = (def.policy.recovery_minutes as i64) * 60_000;
                                        if now_ms - sched_at <= recovery_limit {
                                            let ev = AutomationEvent {
                                                kind: trigger.kind.clone(),
                                                at: sched_at,
                                                project_path: None,
                                                paths: Vec::new(),
                                                branch: None,
                                                commit: None,
                                                origin: Some("automation".to_string()),
                                                detail: Some("Recupero scadenza persa".to_string()),
                                            };
                                            let _ = self.enqueue_occurrence(def, ev, sched_at);
                                        }
                                    }
                                    _ => {} // "ignore"
                                }
                            } else {
                                let ev = AutomationEvent {
                                    kind: trigger.kind.clone(),
                                    at: sched_at,
                                    project_path: None,
                                    paths: Vec::new(),
                                    branch: None,
                                    commit: None,
                                    origin: Some("automation".to_string()),
                                    detail: None,
                                };
                                let _ = self.enqueue_occurrence(def, ev, sched_at);
                            }
                        }
                    }
                }
            }

            last_checks.insert(def.id.clone(), now_ms);
        }
    }

    pub fn enqueue_occurrence(
        &self,
        def: &AutomationDefinition,
        event: AutomationEvent,
        scheduled_at: i64,
    ) -> Result<AutomationOccurrence, String> {
        let now = chrono_now_ms();
        let existing_runs = self.storage.get_occurrences(20)?;

        // Controllo overlap / coalesce (AUT-011, AUT-019, AUT-040)
        let active_run = existing_runs.iter().find(|o| {
            o.automation_id == def.id && (o.state == "running" || o.state == "waiting" || o.state == "needsInput")
        });

        if let Some(existing) = active_run {
            if def.policy.overlap == "skip" {
                return Ok(existing.clone());
            }

            // Coalesce: se c'e' gia' una waiting, aggiungi il motivo senza prolungare la scadenza
            if existing.state == "waiting" {
                let mut updated = existing.clone();
                updated.reasons.push(event);
                self.storage.save_occurrence(&updated)?;
                self.emit_changed();
                return Ok(updated);
            }

            // Se e' in running, controlla se c'e' gia' una pending waiting accodata
            let already_pending = existing_runs.iter().find(|o| o.automation_id == def.id && o.state == "waiting");
            if let Some(pending) = already_pending {
                let mut updated = pending.clone();
                updated.reasons.push(event);
                self.storage.save_occurrence(&updated)?;
                self.emit_changed();
                return Ok(updated);
            }
        }

        // Risolvi i destinatari congelati per questa occorrenza (AUT-072, AUT-073)
        let obs_guard = self.observer.lock();
        let targets = self.resolve_targets(&def.targets, obs_guard.as_ref(), scheduled_at, &def.policy.timezone);
        drop(obs_guard);

        // Se l'insieme dei destinatari e' vuoto: chiude senza eseguire (AUT-087)
        if targets.is_empty() {
            let occ = AutomationOccurrence {
                id: uuid_v4(),
                automation_id: def.id.clone(),
                revision: def.revision,
                name: def.name.clone(),
                scheduled_at,
                created_at: now,
                deadline: scheduled_at + (def.policy.max_wait_minutes as i64) * 60_000,
                state: "completed".to_string(),
                reasons: vec![event],
                targets: Vec::new(),
                executions: Vec::new(),
                definition: def.clone(),
                acknowledged: true,
                requires_review: false,
            };
            self.storage.save_occurrence(&occ)?;
            self.emit_changed();
            return Ok(occ);
        }

        // Crea le esecuzioni
        let run_id = uuid_v4();
        let mut executions = Vec::new();

        if def.targets.mode == "aggregate" {
            executions.push(AutomationExecution {
                id: uuid_v4(),
                run_id: run_id.clone(),
                targets: targets.clone(),
                state: "waiting".to_string(),
                reason: None,
                started_at: None,
                finished_at: None,
                exit_code: None,
                model: None,
                session_id: None,
                result: None,
                question: None,
                human_deadline: None,
                active_duration_ms: 0,
                active_since: None,
                output_truncated: false,
            });
        } else {
            for target in &targets {
                executions.push(AutomationExecution {
                    id: uuid_v4(),
                    run_id: run_id.clone(),
                    targets: vec![target.clone()],
                    state: "waiting".to_string(),
                    reason: None,
                    started_at: None,
                    finished_at: None,
                    exit_code: None,
                    model: None,
                    session_id: None,
                    result: None,
                    question: None,
                    human_deadline: None,
                    active_duration_ms: 0,
                    active_since: None,
                    output_truncated: false,
                });
            }
        }

        let occ = AutomationOccurrence {
            id: run_id,
            automation_id: def.id.clone(),
            revision: def.revision,
            name: def.name.clone(),
            scheduled_at,
            created_at: now,
            deadline: scheduled_at + (def.policy.max_wait_minutes as i64) * 60_000,
            state: "waiting".to_string(),
            reasons: vec![event],
            targets,
            executions,
            definition: def.clone(),
            acknowledged: false,
            requires_review: false,
        };

        self.storage.save_occurrence(&occ)?;
        self.emit_changed();
        Ok(occ)
    }

    fn evaluate_deadlines_and_timeouts(&self, now_ms: i64) {
        let occurrences = match self.storage.get_occurrences(50) {
            Ok(o) => o,
            Err(_) => return,
        };
        for mut occ in occurrences {
            if occ.state == "waiting" {
                if now_ms > occ.deadline {
                    // Timeout attesa risorsa o progetto (AUT-010, AUT-040)
                    for exec in &mut occ.executions {
                        if exec.state == "waiting" {
                            exec.state = "skipped".to_string();
                            exec.reason = Some("Attesa massima superata (risorse o progetti occupati)".to_string());
                            exec.finished_at = Some(now_ms);
                        }
                    }
                    occ.state = "skipped".to_string();
                    let _ = self.storage.save_occurrence(&occ);
                    self.send_notification(
                        &occ.automation_id,
                        &occ.name,
                        "Attesa scaduta",
                        &format!("L'automazione '{}' e' stata saltata per superamento del tempo massimo di attesa.", occ.name),
                        "timeout",
                    );
                    self.emit_changed();
                }
            } else if occ.state == "needsInput" {
                // Timeout attesa risposta umana (AUT-044)
                let limit_ms = (occ.definition.policy.human_wait_minutes as i64) * 60_000;
                for exec in &occ.executions {
                    if exec.state == "needsInput" {
                        let is_expired = if let Some(h_dead) = exec.human_deadline {
                            now_ms > h_dead
                        } else {
                            now_ms - exec.started_at.unwrap_or(now_ms) > limit_ms
                        };

                        if is_expired {
                            crate::rpc::close_automation_execution(&self.app, &exec.id);
                            self.needs_input_executions.lock().remove(&exec.id);
                            self.release_project_locks(&exec.targets);

                            let update = AutomationAiUpdate {
                                execution_id: exec.id.clone(),
                                state: "timeout".to_string(),
                                session_id: None,
                                model: None,
                                result: None,
                                question: None,
                                reason: Some("Tempo di risposta umana scaduto (AUT-044)".to_string()),
                            };
                            let _ = self.storage.set_execution_update(&update, None);
                            self.send_notification(
                                &occ.automation_id,
                                &occ.name,
                                "Risposta scaduta",
                                &format!("L'attesa per l'automazione '{}' e' scaduta senza risposta.", occ.name),
                                "timeout",
                            );
                            self.emit_changed();
                        }
                    }
                }
            } else if occ.state == "running" {
                // Timeout attivo esecuzione AI (AUT-043)
                if matches!(occ.definition.action, AutomationAction::Prompt(_)) {
                    let timeout_limit_ms = (occ.definition.policy.timeout_minutes as i64) * 60_000;
                    for exec in &occ.executions {
                        if exec.state == "running" {
                            let total_active_ms = exec.active_duration_ms as i64
                                + exec.active_since.map(|s| (now_ms - s).max(0)).unwrap_or(0);
                            if total_active_ms > timeout_limit_ms {
                                crate::rpc::close_automation_execution(&self.app, &exec.id);
                                self.running_ai_executions.lock().remove(&exec.id);
                                self.pending_ai_requests.lock().remove(&exec.id);
                                self.release_project_locks(&exec.targets);

                                let update = AutomationAiUpdate {
                                    execution_id: exec.id.clone(),
                                    state: "timeout".to_string(),
                                    session_id: None,
                                    model: None,
                                    result: None,
                                    question: None,
                                    reason: Some("Timeout esecuzione AI superato (AUT-043)".to_string()),
                                };
                                let _ = self.storage.set_execution_update(&update, None);
                                self.send_notification(
                                    &occ.automation_id,
                                    &occ.name,
                                    "Timeout esecuzione",
                                    &format!("L'automazione AI '{}' ha superato il tempo massimo di attività.", occ.name),
                                    "timeout",
                                );
                                self.emit_changed();
                            }
                        }
                    }
                }
            }
        }
    }

    pub fn canonical_root_for_path(&self, path: &str) -> String {
        let norm_path = normalize_project_path(path);
        let ctx = self.context.read();
        for p in &ctx.projects {
            if normalize_project_path(&p.path) == norm_path {
                return p.path.clone();
            }
            for wp in &p.workspace_paths {
                if normalize_project_path(wp) == norm_path {
                    return p.path.clone();
                }
            }
        }
        drop(ctx);

        if let Ok(registered) = self.storage.get_registered_projects() {
            for p in registered {
                if normalize_project_path(&p.path) == norm_path {
                    return p.path.clone();
                }
                for wp in &p.workspace_paths {
                    if normalize_project_path(wp) == norm_path {
                        return p.path.clone();
                    }
                }
            }
        }

        path.to_string()
    }

    fn try_acquire_project_locks(
        &self,
        targets: &[ResolvedAutomationTarget],
        exec_id: &str,
        ctx: &AutomationContext,
    ) -> bool {
        let mut locks = self.project_locks.lock();
        for t in targets {
            let canonical = self.canonical_root_for_path(&t.path);
            let canonical_norm = normalize_project_path(&canonical);
            let norm = normalize_project_path(&t.path);

            if locks.contains_key(&canonical_norm)
                || locks.contains_key(&norm)
                || ctx.busy_paths.iter().any(|bp| {
                    let bp_norm = normalize_project_path(bp);
                    bp_norm == canonical_norm || bp_norm == norm
                })
            {
                return false;
            }
        }

        for t in targets {
            let canonical = self.canonical_root_for_path(&t.path);
            let canonical_norm = normalize_project_path(&canonical);
            let norm = normalize_project_path(&t.path);

            locks.insert(canonical_norm.clone(), exec_id.to_string());
            if canonical_norm != norm {
                locks.insert(norm, exec_id.to_string());
            }
        }
        true
    }

    fn release_project_locks(&self, targets: &[ResolvedAutomationTarget]) {
        let mut locks = self.project_locks.lock();
        for t in targets {
            let canonical = self.canonical_root_for_path(&t.path);
            let canonical_norm = normalize_project_path(&canonical);
            let norm = normalize_project_path(&t.path);

            locks.remove(&canonical_norm);
            locks.remove(&norm);
        }
    }

    pub fn is_project_locked(&self, path: &str, excluding_execution: Option<&str>) -> bool {
        let canonical = self.canonical_root_for_path(path);
        let canonical_norm = normalize_project_path(&canonical);
        let norm = normalize_project_path(path);

        let locks = self.project_locks.lock();
        if let Some(owner) = locks.get(&canonical_norm).or_else(|| locks.get(&norm)) {
            if let Some(ex) = excluding_execution {
                if owner == ex {
                    return false;
                }
            }
            return true;
        }
        false
    }

    pub fn interactive_admission(&self, path: &str) -> Result<(), String> {
        let canonical = self.canonical_root_for_path(path);
        let canonical_norm = normalize_project_path(&canonical);
        let norm = normalize_project_path(path);

        let mut locks = self.project_locks.lock();
        if let Some(owner) = locks.get(&canonical_norm).or_else(|| locks.get(&norm)) {
            if owner != "interactive" {
                return Err(format!(
                    "Progetto '{}' occupato dall'automazione attiva '{}' (AUT-042)",
                    canonical, owner
                ));
            }
        } else {
            locks.insert(canonical_norm.clone(), "interactive".to_string());
            if canonical_norm != norm {
                locks.insert(norm, "interactive".to_string());
            }
        }
        Ok(())
    }

    pub fn release_interactive_admission(&self, path: &str) {
        let canonical = self.canonical_root_for_path(path);
        let canonical_norm = normalize_project_path(&canonical);
        let norm = normalize_project_path(path);

        let mut locks = self.project_locks.lock();
        if locks.get(&canonical_norm).map_or(false, |o| o == "interactive") {
            locks.remove(&canonical_norm);
        }
        if locks.get(&norm).map_or(false, |o| o == "interactive") {
            locks.remove(&norm);
        }
    }

    pub fn project_path_for_id(&self, project_id: &str) -> Option<String> {
        let ctx = self.context.read();
        for p in &ctx.projects {
            if p.id == project_id {
                return Some(p.path.clone());
            }
        }
        drop(ctx);

        if let Ok(registered) = self.storage.get_registered_projects() {
            for p in registered {
                if p.id == project_id {
                    return Some(p.path);
                }
            }
        }

        None
    }

    pub fn request_project_operation(
        &self,
        operation: &str,
        path: &str,
        execution_id: Option<&str>,
    ) -> Result<AutomationProjectRequest, String> {
        if operation != "open" && operation != "close" {
            return Err(format!("Operazione '{}' non valida. Usa 'open' o 'close'.", operation));
        }

        let is_locked = self.is_project_locked(path, None);
        // AUT-091: Propria close deferita fino ad esecuzione conclusa, esito salvato e lock libero
        let status = if operation == "close" && is_locked {
            "deferred".to_string()
        } else {
            "requested".to_string()
        };

        let req = AutomationProjectRequest {
            request_id: uuid_v4(),
            operation: operation.to_string(),
            path: path.to_string(),
            execution_id: execution_id.map(str::to_string),
            status,
            created_at: chrono_now_ms(),
        };

        self.storage.save_project_request(&req)?;
        self.pending_project_requests
            .lock()
            .insert(req.request_id.clone(), req.clone());

        let _ = self.app.emit("automations://project-request", &req);
        self.emit_changed();
        Ok(req)
    }

    pub fn resolve_project_request(
        &self,
        request_id: &str,
        ok: bool,
        _detail: Option<&str>,
    ) -> Result<(), String> {
        let req = self
            .pending_project_requests
            .lock()
            .remove(request_id)
            .ok_or_else(|| format!("Richiesta progetto '{}' non trovata", request_id))?;

        let _ = self.storage.delete_project_request(request_id);

        if ok {
            let is_open = req.operation == "open";
            self.storage.set_project_open(&req.path, is_open);

            // Aggiorna anche il contesto in memoria
            let mut ctx = self.context.write();
            let norm = normalize_project_path(&req.path);
            for p in &mut ctx.projects {
                if normalize_project_path(&p.path) == norm {
                    p.open = is_open;
                }
            }
        }

        self.emit_changed();
        Ok(())
    }

    pub fn get_pending_project_requests(&self) -> Vec<AutomationProjectRequest> {
        self.pending_project_requests.lock().values().cloned().collect()
    }

    fn check_deferred_project_requests(&self, released_paths: &[String]) {
        let mut to_emit = Vec::new();
        {
            let mut reqs = self.pending_project_requests.lock();
            for req in reqs.values_mut() {
                if req.status == "deferred" && req.operation == "close" {
                    let req_norm = normalize_project_path(&req.path);
                    if released_paths.iter().any(|rp| normalize_project_path(rp) == req_norm) {
                        if !self.is_project_locked(&req.path, None) {
                            req.status = "requested".to_string();
                            let _ = self.storage.save_project_request(req);
                            to_emit.push(req.clone());
                        }
                    }
                }
            }
        }

        for req in to_emit {
            let _ = self.app.emit("automations://project-request", &req);
        }
    }

    pub fn resume_admission(&self, execution_id: &str) -> Result<bool, String> {
        let occurrences = self.storage.get_occurrences(50)?;
        let mut target_occ = None;
        for occ in occurrences {
            if occ.executions.iter().any(|e| e.id == execution_id) {
                target_occ = Some(occ);
                break;
            }
        }

        let mut occ = target_occ.ok_or_else(|| format!("Esecuzione '{}' non trovata", execution_id))?;
        {
            let exec = occ.executions.iter().find(|e| e.id == execution_id)
                .ok_or_else(|| format!("Esecuzione '{}' non trovata nell'occorrenza", execution_id))?;
            if exec.state != "needsInput" {
                return Err(format!("L'esecuzione '{}' non e' in attesa di input (stato: {})", execution_id, exec.state));
            }
        }

        let ctx = self.context.read().clone();

        // 1. Precedenza interattiva (AUT-041)
        if ctx.interactive_waiting || (ctx.max_agent_count > 0 && ctx.interactive_agent_count >= ctx.max_agent_count) {
            return Ok(false);
        }

        // 2. Cap globale AI (AUT-041, AUT-044)
        let global_ai_cap = if ctx.max_agent_count > 0 { ctx.max_agent_count } else { 2 };
        let total_ai_usage = ctx.interactive_agent_count
            + self.pending_ai_requests.lock().len()
            + self.active_titles.lock().len();
        if total_ai_usage >= global_ai_cap {
            return Ok(false);
        }
        // 3. Verifica quota pre-ripresa (AUT-032, AUT-078)
        if let AutomationAction::Prompt(pa) = &occ.definition.action {
            let q_eval = quota::evaluate(&pa.model, &occ.definition.policy.quota);
            if !q_eval.allowed {
                return Ok(false);
            }
        }

        // Ammissione concessa: riacquisisce lo slot AI e rimette stato a running
        let targets = {
            let exec = occ.executions.iter_mut().find(|e| e.id == execution_id)
                .ok_or_else(|| format!("Esecuzione '{}' non trovata nell'occorrenza", execution_id))?;
            exec.state = "running".to_string();
            exec.question = None;
            exec.targets.clone()
        };
        occ.recompute_state();
        self.storage.save_occurrence(&occ)?;

        let cwd = targets.first().map(|t| t.path.clone()).unwrap_or_else(|| occ.definition.targets.cwd.clone());
        let ai_req = AutomationAiRequest {
            execution_id: execution_id.to_string(),
            run_id: occ.id.clone(),
            definition: occ.definition.clone(),
            targets,
            context_path: std::env::temp_dir()
                .join(format!("omp-auto-ai-ctx-{}.json", execution_id))
                .to_string_lossy()
                .to_string(),
            cwd,
        };
        self.pending_ai_requests.lock().insert(execution_id.to_string(), ai_req);

        self.emit_changed();
        Ok(true)
    }

    pub fn resume_release(&self, execution_id: &str) -> Result<(), String> {
        self.pending_ai_requests.lock().remove(execution_id);

        let occurrences = self.storage.get_occurrences(50)?;
        for mut occ in occurrences {
            if let Some(exec) = occ.executions.iter_mut().find(|e| e.id == execution_id) {
                if exec.state == "running" {
                    exec.state = "needsInput".to_string();
                    occ.recompute_state();
                    self.storage.save_occurrence(&occ)?;
                    self.emit_changed();
                    break;
                }
            }
        }
        Ok(())
    }

    pub fn is_execution_terminal(&self, execution_id: &str) -> bool {
        if let Ok(occs) = self.storage.get_occurrences(50) {
            for occ in occs {
                if let Some(exec) = occ.executions.iter().find(|e| e.id == execution_id) {
                    return exec.state == "completed"
                        || exec.state == "error"
                        || exec.state == "timeout"
                        || exec.state == "interrupted"
                        || exec.state == "superseded"
                        || exec.state == "skipped";
                }
            }
        }
        false
    }

    pub fn host_handshake(&self, host_epoch: &str) -> Result<Vec<String>, String> {
        let mut epoch_guard = self.current_host_epoch.lock();
        let mut reconciled = Vec::new();

        let needs_reconcile = match epoch_guard.as_deref() {
            Some(prev) => prev != host_epoch,
            None => true,
        };

        if needs_reconcile {
            let occurrences = self.storage.get_occurrences(50)?;
            for mut occ in occurrences {
                let mut changed = false;
                for exec in &mut occ.executions {
                    if exec.state == "running" || exec.state == "needsInput" {
                        exec.state = "unknown".to_string();
                        exec.reason = Some("Host UI riavviato (nuova host_epoch): esito non verificato (AUT-046)".to_string());
                        exec.finished_at = Some(chrono_now_ms());
                        self.release_project_locks(&exec.targets);
                        reconciled.push(exec.id.clone());
                        changed = true;
                    }
                }

                if changed {
                    occ.recompute_state();
                    occ.requires_review = true;
                    let _ = self.storage.save_occurrence(&occ);
                    let _ = self.storage.set_definition_state(&occ.automation_id, "suspended");
                }
            }

            self.pending_ai_requests.lock().clear();
        }

        *epoch_guard = Some(host_epoch.to_string());
        drop(epoch_guard);

        self.emit_changed();
        Ok(reconciled)
    }

    fn dispatch_waiting_executions(&self, now_ms: i64) {
        let settings = self.storage.get_settings();
        let ctx = self.context.read().clone();

        // Controllo priorita' interattivo (AUT-041)
        let interactive_blocked = ctx.interactive_waiting
            || (ctx.max_agent_count > 0 && ctx.interactive_agent_count >= ctx.max_agent_count);

        let active_cmds = self.running_commands.lock().len();
        let active_ai = self.pending_ai_requests.lock().len();

        let mut occurrences = match self.storage.get_occurrences(50) {
            Ok(o) => o,
            Err(e) => {
                eprintln!("[automations] Impossibile recuperare occorrenze SQLite: {}", e);
                return;
            }
        };
        // Ordina per scheduled_at ASC (AUT-103: FIFO fra ammesse)
        occurrences.sort_by_key(|o| o.scheduled_at);

        for mut occ in occurrences {
            if occ.state != "waiting" && occ.state != "running" {
                continue;
            }

            let mut occ_changed = false;

            for exec_idx in 0..occ.executions.len() {
                if occ.executions[exec_idx].state != "waiting" {
                    continue;
                }

                match &occ.definition.action {
                    AutomationAction::Command(ca) => {
                        if active_cmds >= settings.max_commands as usize {
                            continue;
                        }

                        // Verifica lock di progetto (AUT-042, AUT-012)
                        if !self.try_acquire_project_locks(&occ.executions[exec_idx].targets, &occ.executions[exec_idx].id, &ctx) {
                            continue;
                        }

                        // Verifica policy script e hash (AUT-036)
                        if ca.script_policy == "review" {
                            if let Some(err) = self.check_script_approval(ca) {
                                occ.executions[exec_idx].state = "error".to_string();
                                occ.executions[exec_idx].reason = Some(err);
                                occ.executions[exec_idx].finished_at = Some(now_ms);
                                occ_changed = true;
                                continue;
                            }
                        }

                        // Acquisizione atomica all-or-none
                        let exec_id = occ.executions[exec_idx].id.clone();
                        if !self.try_acquire_project_locks(&occ.executions[exec_idx].targets, &exec_id, &ctx) {
                            continue;
                        }

                        occ.executions[exec_idx].state = "running".to_string();
                        occ.executions[exec_idx].started_at = Some(now_ms);
                        occ.state = "running".to_string();
                        occ_changed = true;

                        self.spawn_command_execution(
                            &occ.definition,
                            ca,
                            &occ.executions[exec_idx],
                            &occ.id,
                        );
                    }
                    AutomationAction::Prompt(pa) => {
                        let global_ai_cap = if ctx.max_agent_count > 0 { ctx.max_agent_count } else { 2 };
                        let running_ai = self.running_ai_executions.lock().len();
                        let total_ai_usage = ctx.interactive_agent_count + running_ai + self.active_titles.lock().len();
                        if interactive_blocked || running_ai >= settings.max_ai as usize || total_ai_usage >= global_ai_cap {
                            continue;
                        }

                        // Verifica branch se specificato
                        if !occ.definition.branches.is_empty() {
                            let obs_guard = self.observer.lock();
                            let mut branch_mismatch = false;
                            for t in &occ.executions[exec_idx].targets {
                                if let Some(obs) = obs_guard.as_ref() {
                                    if let Some(curr_br) = obs.current_branch(&t.path) {
                                        if !occ.definition.branches.iter().any(|b| b == &curr_br) {
                                            branch_mismatch = true;
                                            break;
                                        }
                                    }
                                }
                            }
                            drop(obs_guard);
                            if branch_mismatch {
                                continue;
                            }
                        }

                        // Verifica quote native (AUT-030, AUT-031, AUT-032, AUT-076)
                        let q_eval = quota::evaluate(&pa.model, &occ.definition.policy.quota);
                        if !q_eval.allowed {
                            continue;
                        }

                        let exec_id = occ.executions[exec_idx].id.clone();
                        // Acquisizione atomica all-or-none
                        if !self.try_acquire_project_locks(&occ.executions[exec_idx].targets, &exec_id, &ctx) {
                            continue;
                        }

                        occ.executions[exec_idx].state = "running".to_string();
                        occ.executions[exec_idx].started_at = Some(now_ms);
                        occ.executions[exec_idx].active_since = Some(now_ms);
                        occ.state = "running".to_string();
                        occ_changed = true;

                        self.running_ai_executions.lock().insert(exec_id.clone());
                        self.spawn_ai_execution(
                            &occ.definition,
                            pa,
                            &occ.executions[exec_idx],
                            &occ.id,
                        );
                    }
                }
            }

            if occ_changed {
                occ.recompute_state();
                let _ = self.storage.save_occurrence(&occ);
                self.emit_changed();
            }
        }
    }


    fn check_script_approval(&self, ca: &CommandAction) -> Option<String> {
        for file in &ca.watched_files {
            let p = Path::new(file);
            if !p.exists() {
                return Some(format!("File sorvegliato '{}' non trovato", file));
            }
            if let Ok(hash) = hash_file(p) {
                if let Some(approved) = ca.approved_files.get(file) {
                    if &hash != approved {
                        return Some(format!(
                            "Il file script '{}' e' stato modificato e richiede revisione (AUT-036).",
                            file
                        ));
                    }
                } else {
                    return Some(format!("Il file script '{}' non ha un hash approvato.", file));
                }
            }
        }
        None
    }

    fn spawn_command_execution(
        &self,
        def: &AutomationDefinition,
        ca: &CommandAction,
        exec: &AutomationExecution,
        run_id: &str,
    ) {
        let execution_id = exec.id.clone();
        let run_id = run_id.to_string();
        let automation_id = def.id.clone();
        let automation_name = def.name.clone();
        let targets = exec.targets.clone();
        let storage = Arc::clone(&self.storage);
        let app = self.app.clone();
        let engine_locks = Arc::clone(&self.project_locks);
        let engine_running = Arc::clone(&self.running_commands);
        let pending_project_reqs = Arc::clone(&self.pending_project_requests);

        // Risolvi cwd esplicita (AUT-024)
        let cwd_path = if let Some(first) = targets.first() {
            PathBuf::from(&first.path)
        } else if !def.targets.cwd.is_empty() {
            PathBuf::from(&def.targets.cwd)
        } else {
            std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."))
        };

        // Prepara file di contesto OMP_AUTOMATION_CONTEXT (AUT-074)
        let ctx_path = std::env::temp_dir().join(format!("omp-auto-ctx-{}.json", execution_id));
        let ctx_json = serde_json::json!({
            "executionId": execution_id,
            "runId": run_id,
            "automationId": automation_id,
            "automationName": automation_name,
            "targets": targets,
            "action": ca,
        });
        let _ = fs::write(&ctx_path, ctx_json.to_string());

        // Risolvi segreti dal vault OS (AUT-048, AUT-083)
        let mut env = ca.environment.clone();
        let mut secret_err = None;
        for (k, sec_id) in &ca.secret_refs {
            match secrets::get(sec_id) {
                Ok(val) => {
                    env.insert(k.clone(), val);
                }
                Err(e) => {
                    secret_err = Some(format!("Segreto '{}' non accessibile nel vault: {}", sec_id, e));
                    break;
                }
            }
        }

        if let Some(err_msg) = secret_err {
            let mut locks = engine_locks.lock();
            for t in &targets {
                locks.remove(&t.path);
            }
            let _ = fs::remove_file(&ctx_path);

            let update = AutomationAiUpdate {
                execution_id: execution_id.clone(),
                state: "error".to_string(),
                session_id: None,
                model: None,
                result: None,
                question: None,
                reason: Some(err_msg),
            };
            let _ = storage.set_execution_update(&update, None);
            let _ = app.emit("automations://changed", ());
            return;
        }

        let cancel_flag = Arc::new(AtomicBool::new(false));
        engine_running.lock().insert(execution_id.clone(), Arc::clone(&cancel_flag));

        let settings = storage.get_settings();
        let max_output_bytes = settings.output_per_run_bytes;
        let notify_success = def.policy.notify_success;
        let timeout_secs = def.policy.timeout_minutes * 60;

        let request = CommandRequest {
            execution_id: execution_id.clone(),
            cwd: cwd_path,
            action: serde_json::to_value(ca).unwrap_or_default(),
            environment: env,
            timeout: Duration::from_secs(timeout_secs),
            context_path: ctx_path.clone(),
        };

        std::thread::spawn(move || {
            let storage_for_cb = Arc::clone(&storage);
            let eid_for_cb = execution_id.clone();

            let on_output = move |chunk: &str, _is_stderr: bool| {
                let _ = storage_for_cb.append_output(&eid_for_cb, chunk, max_output_bytes);
            };

            let outcome = runner::execute(&request, &cancel_flag, &on_output).unwrap_or_else(|e| CommandOutcome {
                state: "error".to_string(),
                exit_code: Some(1),
                detail: Some(e),
            });

            // Cleanup
            let _ = fs::remove_file(&ctx_path);
            engine_running.lock().remove(&execution_id);
            {
                let mut locks = engine_locks.lock();
                for t in &targets {
                    locks.remove(&normalize_project_path(&t.path));
                }
            }

            // Controlla richieste di chiusura progetto differite (AUT-091)
            let mut reqs = pending_project_reqs.lock();
            for req in reqs.values_mut() {
                if req.status == "deferred" && req.operation == "close" {
                    let req_norm = normalize_project_path(&req.path);
                    if targets.iter().any(|t| normalize_project_path(&t.path) == req_norm) {
                        req.status = "requested".to_string();
                        let _ = app.emit("automations://project-request", &*req);
                    }
                }
            }
            drop(reqs);

            let update = AutomationAiUpdate {
                execution_id: execution_id.clone(),
                state: outcome.state.clone(),
                session_id: None,
                model: None,
                result: outcome.detail.clone(),
                question: None,
                reason: outcome.detail.clone(),
            };
            let _ = storage.set_execution_update(&update, None);

            if outcome.state != "completed" || notify_success {
                let title = if outcome.state == "completed" {
                    format!("Automazione '{}' completata", automation_name)
                } else {
                    format!("Automazione '{}' fallita", automation_name)
                };
                let body = outcome.detail.unwrap_or_default();
                let _ = app.emit(
                    "automations://notification",
                    serde_json::json!({
                        "runId": run_id,
                        "automationId": automation_id,
                        "title": title,
                        "body": body,
                    }),
                );
            }

            let _ = app.emit("automations://changed", ());
        });
    }

    fn spawn_ai_execution(
        &self,
        def: &AutomationDefinition,
        _pa: &PromptAction,
        exec: &AutomationExecution,
        run_id: &str,
    ) {
        let execution_id = exec.id.clone();
        let targets = exec.targets.clone();

        let cwd = if let Some(first) = targets.first() {
            first.path.clone()
        } else if !def.targets.cwd.is_empty() {
            def.targets.cwd.clone()
        } else {
            std::env::current_dir()
                .map(|p| p.to_string_lossy().to_string())
                .unwrap_or_default()
        };

        let ctx_path = std::env::temp_dir()
            .join(format!("omp-auto-ai-ctx-{}.json", execution_id))
            .to_string_lossy()
            .to_string();

        let ai_req = AutomationAiRequest {
            execution_id: execution_id.clone(),
            run_id: run_id.to_string(),
            definition: def.clone(),
            targets,
            context_path: ctx_path,
            cwd,
        };

        // Mantieni la richiesta pending rileggibile per l'host UI (AUT-025, contratto riga 10)
        self.pending_ai_requests
            .lock()
            .insert(execution_id.clone(), ai_req.clone());
        self.running_ai_executions.lock().insert(execution_id.clone());

        let _ = self.app.emit("automations://ai-request", &ai_req);
        self.emit_changed();
    }

    pub fn handle_ai_update(&self, update: AutomationAiUpdate) -> Result<AutomationOccurrence, String> {
        let is_terminal = update.state == "completed"
            || update.state == "error"
            || update.state == "timeout"
            || update.state == "interrupted"
            || update.state == "skipped";

        if is_terminal {
            self.running_ai_executions.lock().remove(&update.execution_id);
            self.needs_input_executions.lock().remove(&update.execution_id);
            self.pending_ai_requests.lock().remove(&update.execution_id);
        } else if update.state == "needsInput" {
            self.running_ai_executions.lock().remove(&update.execution_id);
            self.needs_input_executions.lock().insert(update.execution_id.clone());
        } else if update.state == "running" {
            self.needs_input_executions.lock().remove(&update.execution_id);
            self.running_ai_executions.lock().insert(update.execution_id.clone());
        }

        let occ = self.storage.set_execution_update(&update, None)?;

        // Se terminale, rilascia i lock sui target dell'esecuzione
        if is_terminal {
            if let Some(exec) = occ.executions.iter().find(|e| e.id == update.execution_id) {
                self.release_project_locks(&exec.targets);
                let paths: Vec<String> = exec.targets.iter().map(|t| t.path.clone()).collect();
                self.check_deferred_project_requests(&paths);
            }
        }

        // Se l'AI richiede input umano, invia notifica (AUT-028, AUT-053)
        if update.state == "needsInput" {
            let question = update.question.clone().unwrap_or_else(|| "Richiesta risposta utente".to_string());
            self.send_notification(
                &occ.automation_id,
                &occ.name,
                "Chiede risposta",
                &question,
                "input",
            );
        }

        self.emit_changed();
        Ok(occ)
    }

    pub fn get_pending_ai_requests(&self) -> Vec<AutomationAiRequest> {
        self.pending_ai_requests.lock().values().cloned().collect()
    }

    pub fn cancel(&self, run_id: &str, execution_id: Option<&str>) -> Result<(), String> {
        let occ = self
            .storage
            .get_occurrence(run_id)
            .ok_or_else(|| format!("Occorrenza '{}' non trovata", run_id))?;

        for exec in &occ.executions {
            if let Some(eid) = execution_id {
                if exec.id != eid {
                    continue;
                }
            }

            if exec.state == "running" || exec.state == "waiting" || exec.state == "needsInput" {
                if let Some(cancel) = self.running_commands.lock().get(&exec.id) {
                    cancel.store(true, Ordering::SeqCst);
                } else {
                    crate::rpc::close_automation_execution(&self.app, &exec.id);
                    self.running_ai_executions.lock().remove(&exec.id);
                    self.needs_input_executions.lock().remove(&exec.id);
                    self.pending_ai_requests.lock().remove(&exec.id);
                    self.release_project_locks(&exec.targets);

                    let update = AutomationAiUpdate {
                        execution_id: exec.id.clone(),
                        state: "interrupted".to_string(),
                        session_id: None,
                        model: None,
                        result: Some("Interrotto dall'utente".to_string()),
                        question: None,
                        reason: Some("Interrotto dall'utente".to_string()),
                    };
                    let _ = self.storage.set_execution_update(&update, None);
                }
            }
        }

        self.emit_changed();
        Ok(())
    }

    pub fn extend_human_wait(
        &self,
        _run_id: &str,
        execution_id: &str,
        minutes: u64,
    ) -> Result<i64, String> {
        let new_deadline = self.storage.extend_human_wait(execution_id, minutes)?;
        self.emit_changed();
        Ok(new_deadline)
    }

    pub fn run_now(
        &self,
        id: &str,
        target_paths: Option<Vec<String>>,
    ) -> Result<AutomationOccurrence, String> {
        let mut def = self
            .storage
            .get_definition(id)
            .ok_or_else(|| format!("Automazione '{}' non trovata", id))?;

        if let Some(tp) = target_paths {
            def.targets.project_paths = tp;
            def.targets.source = "selected".to_string();
        }

        let now = chrono_now_ms();
        let ev = AutomationEvent {
            kind: "manual".to_string(),
            at: now,
            project_path: None,
            paths: Vec::new(),
            branch: None,
            commit: None,
            origin: Some("interactive".to_string()),
            detail: Some("Avvio manuale utente".to_string()),
        };

        self.enqueue_occurrence(&def, ev, now)
    }

    pub fn preview(&self, def: &AutomationDefinition) -> Result<AutomationPreview, String> {
        let now = chrono_now_ms();
        let obs_guard = self.observer.lock();
        let targets = self.resolve_targets(&def.targets, obs_guard.as_ref(), now, &def.policy.timezone);
        let mut issues = Vec::new();

        if let Some(obs) = obs_guard.as_ref() {
            issues.extend(obs.monitoring_errors());
        }
        drop(obs_guard);

        if targets.is_empty() {
            issues.push("Nessun destinatario risolto con la configurazione attuale.".to_string());
        }

        // Valida trigger e calcola prossime esecuzioni (AUT-039)
        let mut next_runs = Vec::new();
        let now = chrono_now_ms();
        for trig in &def.triggers {
            if let Err(e) = calendar::validate_trigger(trig, &def.policy.timezone) {
                issues.push(format!("Trigger non valido: {}", e));
            } else if let Ok(occs) =
                calendar::next_occurrences(trig, &def.policy.timezone, now, 5, def.created_at, None)
            {
                next_runs.extend(occs);
            }
        }
        next_runs.sort();
        next_runs.truncate(5);

        // Calcola hash file e verifica compatibilita' OS
        let mut file_hashes = HashMap::new();
        if let AutomationAction::Command(ca) = &def.action {
            let current_os = current_platform();
            if !ca.platforms.is_empty() && !ca.platforms.iter().any(|p| p == current_os) {
                issues.push(format!(
                    "Questa automazione e' configurata per [{}] ma il sistema operativo attuale e' {}.",
                    ca.platforms.join(", "),
                    current_os
                ));
            }

            for file in &ca.watched_files {
                let p = Path::new(file);
                if p.exists() {
                    if let Ok(h) = hash_file(p) {
                        file_hashes.insert(file.clone(), h);
                    }
                } else {
                    issues.push(format!("File '{}' non trovato.", file));
                }
            }

            for (sec_name, sec_id) in &ca.secret_refs {
                match secrets::exists(sec_id) {
                    Ok(true) => {}
                    _ => issues.push(format!(
                        "Segreto '{}' (ID: {}) non trovato nel vault OS (AUT-083).",
                        sec_name, sec_id
                    )),
                }
            }
        }

        Ok(AutomationPreview {
            targets,
            next_runs,
            issues,
            file_hashes,
        })
    }

    pub fn export_definitions(&self, ids: &[String]) -> Result<String, String> {
        let mut defs = Vec::new();
        for id in ids {
            if let Some(def) = self.storage.get_definition(id) {
                // AUT-048, AUT-064: export ordinario senza valori segreti o cronologia
                defs.push(def);
            }
        }
        serde_json::to_string_pretty(&defs).map_err(|e| format!("Errore serializzazione export: {}", e))
    }

    pub fn import_definitions(&self, json_str: &str) -> Result<Vec<AutomationDraft>, String> {
        // Supporta sia array di definizioni che singola definizione
        let parsed_defs: Vec<AutomationDefinition> = if let Ok(arr) = serde_json::from_str::<Vec<AutomationDefinition>>(json_str) {
            arr
        } else if let Ok(single) = serde_json::from_str::<AutomationDefinition>(json_str) {
            vec![single]
        } else {
            return Err("Formato JSON non valido per l'importazione di definizioni.".to_string());
        };

        let now = chrono_now_ms();
        let mut drafts = Vec::new();

        for mut def in parsed_defs {
            // AUT-064: Import come bozza disattivata, revisione esplicita richiesta
            def.id = uuid_v4();
            def.revision = 0;
            def.state = "draft".to_string();
            def.created_at = now;
            def.updated_at = now;
            def.origin = "import".to_string();

            let draft = AutomationDraft {
                id: uuid_v4(),
                definition: def,
                base_revision: None,
                conversation: Vec::new(),
                created_at: now,
                updated_at: now,
                source: "import".to_string(),
            };

            self.storage.save_draft(&draft)?;
            drafts.push(draft);
        }

        self.emit_changed();
        Ok(drafts)
    }

    pub fn get_snapshot(&self) -> AutomationSnapshot {
        let mut errors = Vec::new();
        let obs_guard = self.observer.lock();
        if let Some(obs) = obs_guard.as_ref() {
            errors.extend(obs.monitoring_errors());
        }
        drop(obs_guard);

        let definitions = match self.storage.get_definitions() {
            Ok(d) => d,
            Err(e) => {
                errors.push(format!("Database definizioni non accessibile: {}", e));
                Vec::new()
            }
        };
        let drafts = match self.storage.get_drafts() {
            Ok(d) => d,
            Err(e) => {
                errors.push(format!("Database bozze non accessibile: {}", e));
                Vec::new()
            }
        };
        let runs = match self.storage.get_occurrences(50) {
            Ok(r) => r,
            Err(e) => {
                errors.push(format!("Database cronologia non accessibile: {}", e));
                Vec::new()
            }
        };
        let registered = match self.storage.get_registered_projects() {
            Ok(p) => p,
            Err(e) => {
                errors.push(format!("Database progetti registrati non accessibile: {}", e));
                Vec::new()
            }
        };
        let settings = self.storage.get_settings();

        let now = chrono_now_ms();
        let mut next_runs = HashMap::new();
        for def in &definitions {
            if def.state == "enabled" {
                let mut earliest: Option<i64> = None;
                for trig in &def.triggers {
                    if let Ok(occs) = calendar::next_occurrences(trig, &def.policy.timezone, now, 1, def.created_at, None) {
                        if let Some(&t) = occs.first() {
                            earliest = Some(earliest.map_or(t, |e| e.min(t)));
                        }
                    }
                }
                next_runs.insert(def.id.clone(), earliest);
            } else {
                next_runs.insert(def.id.clone(), None);
            }
        }

        AutomationSnapshot {
            definitions,
            drafts,
            runs,
            settings,
            projects: registered,
            monitoring_since: self.monitoring_since,
            errors,
            next_runs,
            project_requests: self.get_pending_project_requests(),
        }
    }

    fn resolve_targets(
        &self,
        targets: &AutomationTargets,
        observer: Option<&Observer>,
        original_instant_ms: i64,
        timezone: &str,
    ) -> Vec<ResolvedAutomationTarget> {
        let mut candidates = Vec::new();
        let registered = self.storage.get_registered_projects().unwrap_or_default();
        let ctx = self.context.read().clone();

        match targets.source.as_str() {
            "selected" => {
                for p_str in &targets.project_paths {
                    let p = Path::new(p_str);
                    let name = p.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_else(|| p_str.clone());
                    candidates.push(ResolvedAutomationTarget {
                        key: p_str.clone(),
                        project_id: registered.iter().find(|rp| rp.path == *p_str).map(|rp| rp.id.clone()),
                        path: p_str.clone(),
                        name,
                        kind: "project".to_string(),
                    });
                }
            }
            "open" => {
                for rp in &ctx.projects {
                    if rp.open {
                        candidates.push(ResolvedAutomationTarget {
                            key: rp.path.clone(),
                            project_id: Some(rp.id.clone()),
                            path: rp.path.clone(),
                            name: rp.name.clone(),
                            kind: "project".to_string(),
                        });
                    }
                }
            }
            "registered" => {
                for rp in &registered {
                    candidates.push(ResolvedAutomationTarget {
                        key: rp.path.clone(),
                        project_id: Some(rp.id.clone()),
                        path: rp.path.clone(),
                        name: rp.name.clone(),
                        kind: "project".to_string(),
                    });
                }
            }
            "studio" => {
                candidates.push(ResolvedAutomationTarget {
                    key: "studio".to_string(),
                    project_id: None,
                    path: std::env::current_dir().map(|p| p.to_string_lossy().to_string()).unwrap_or_else(|_| ".".to_string()),
                    name: "OMP Studio".to_string(),
                    kind: "studio".to_string(),
                });
            }
            "directory" => {
                let dir_paths = if !targets.project_paths.is_empty() {
                    &targets.project_paths
                } else if !targets.cwd.is_empty() {
                    std::slice::from_ref(&targets.cwd)
                } else {
                    &targets.project_paths
                };
                for d in dir_paths {
                    let p = Path::new(d);
                    let name = p.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_else(|| d.clone());
                    candidates.push(ResolvedAutomationTarget {
                        key: d.clone(),
                        project_id: None,
                        path: d.clone(),
                        name,
                        kind: "directory".to_string(),
                    });
                }
            }
            _ => {}
        }

        // Esclusioni esplicite
        candidates.retain(|c| !targets.exclude_paths.iter().any(|ex| ex == &c.path));

        // Inclusione studio se richiesta
        if targets.include_studio && !candidates.iter().any(|c| c.kind == "studio") {
            candidates.push(ResolvedAutomationTarget {
                key: "studio".to_string(),
                project_id: None,
                path: std::env::current_dir().map(|p| p.to_string_lossy().to_string()).unwrap_or_else(|_| ".".to_string()),
                name: "OMP Studio".to_string(),
                kind: "studio".to_string(),
            });
        }

        // Applicazione filtri di target (AUT-007, AUT-073)
        if !targets.filters.is_empty() {
            candidates.retain(|c| {
                if c.kind != "project" {
                    return true;
                }
                for f in &targets.filters {
                    let passed = match f.kind.as_str() {
                        "dirty" => observer.and_then(|o| o.is_dirty(&c.path)).unwrap_or(false),
                        "activity" => {
                            let cutoff = filter_period_cutoff(&f.period, original_instant_ms, timezone);
                            observer.map(|o| o.has_local_activity(&c.path, cutoff)).unwrap_or(false)
                        }
                        "commit" => {
                            let cutoff = filter_period_cutoff(&f.period, original_instant_ms, timezone);
                            observer.map(|o| o.has_commits_since(&c.path, cutoff, &f.authors)).unwrap_or(false)
                        }
                        _ => true,
                    };
                    if !passed {
                        return false;
                    }
                }
                true
            });
        }

        candidates
    }

    fn send_notification(&self, automation_id: &str, automation_name: &str, title: &str, body: &str, issue_key: &str) {
        let now = chrono_now_ms();
        let mut history = self.notification_history.lock();
        let key = (automation_id.to_string(), issue_key.to_string());

        // Raggruppamento notifiche: max 1 notifica per regola ogni 5 minuti per lo stesso motivo (AUT-053, AUT-102)
        if let Some(&last) = history.get(&key) {
            if now - last < 5 * 60_000 {
                return;
            }
        }
        history.insert(key, now);

        let _ = self.app.emit(
            "automations://notification",
            serde_json::json!({
                "automationId": automation_id,
                "automationName": automation_name,
                "title": title,
                "body": body,
            }),
        );
    }

    fn emit_changed(&self) {
        let _ = self.app.emit("automations://changed", ());
    }

    pub fn storage(&self) -> &Storage {
        &self.storage
    }
}

fn filter_period_cutoff(period: &str, original_instant_ms: i64, timezone: &str) -> i64 {
    match period {
        "today" => {
            // AUT-073: riferito all'istante originale nel fuso della regola
            if let Ok(tz) = calendar::parse_timezone(timezone) {
                if let Some(dt) = chrono::DateTime::from_timestamp_millis(original_instant_ms) {
                    let local = dt.with_timezone(&tz);
                    if let Some(start_of_day) = local.date_naive().and_hms_opt(0, 0, 0) {
                        use chrono::TimeZone;
                        if let Some(sod_dt) = tz.from_local_datetime(&start_of_day).single() {
                            return sod_dt.timestamp_millis();
                        }
                    }
                }
            }
            (original_instant_ms / 86_400_000) * 86_400_000
        }
        "7d" => original_instant_ms - 7 * 86_400_000,
        _ => original_instant_ms - 86_400_000,
    }
}

pub fn hash_file(path: &Path) -> Result<String, String> {
    let mut file = File::open(path).map_err(|e| format!("Apertura file per hash: {}", e))?;
    let mut hasher = Sha256::new();
    let mut buffer = [0u8; 8192];
    loop {
        let n = file.read(&mut buffer).map_err(|e| format!("Lettura file per hash: {}", e))?;
        if n == 0 {
            break;
        }
        hasher.update(&buffer[..n]);
    }
    let result = hasher.finalize();
    Ok(format!("{:x}", result))
}

pub fn current_platform() -> &'static str {
    #[cfg(target_os = "windows")]
    return "windows";
    #[cfg(target_os = "macos")]
    return "macos";
    #[cfg(target_os = "linux")]
    return "linux";
    #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
    return "unknown";
}

pub fn normalize_project_path(path: &str) -> String {
    let normalized = path.replace('\\', "/");
    let trimmed = normalized.trim_end_matches('/');
    #[cfg(target_os = "windows")]
    {
        trimmed.to_lowercase()
    }
    #[cfg(not(target_os = "windows"))]
    {
        trimmed.to_string()
    }
}
