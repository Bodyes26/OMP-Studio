//! Osservatore nativo degli eventi di progetto, filesystem e Git per OMP Studio.
//! Implementa la specifica AUT-004, AUT-007, AUT-008, AUT-013, AUT-016, AUT-017, AUT-018, AUT-075, AUT-095.
//!
//! Fornisce a NativeCore il rilevamento in tempo reale di:
//! - Modifiche file ricorsive su radici approvate (notify) con filtri glob e quiete configurabile;
//! - Transizioni Git locali (commit, cambio branch, dirty, clean) senza interazioni remote;
//! - Protezione da symlink escape e percorsi di rete non supportati;
//! - Soppressione percorsi attivi e riallineamento anti-autociclo;
//! - Tracciamento dell'attività locale per i filtri di ammissione.

use super::model::{
    AutomationDefinition, AutomationEvent, AutomationProject, AutomationTrigger,
};
use notify::{EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::mpsc::{channel, Receiver, Sender};
use std::time::{Duration, Instant};

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;

/// Intervallo di polling Git di sicurezza (quando non vi sono eventi filesystem su .git).
const GIT_POLL_INTERVAL_MS: i64 = 2500;

/// Timeout massimo per un singolo comando Git locale in lettura.
const GIT_COMMAND_TIMEOUT: Duration = Duration::from_millis(2000);

/// Preset predefiniti di esclusione (AUT-095): modificabili o sovrascrivibili via trigger.
const DEFAULT_EXCLUDE_PATTERNS: &[&str] = &[
    "**/.git/**",
    "**/node_modules/**",
    ".git/**",
    "node_modules/**",
    ".git",
    "node_modules",
];

/// Stato interno per il debounce e raggruppamento delle modifiche file (AUT-018).
#[derive(Debug, Clone)]
struct PendingFileBurst {
    definition_id: String,
    trigger_id: String,
    project_path: Option<String>,
    first_event_at_ms: i64,
    last_event_at_ms: i64,
    paths: HashSet<String>,
    changes: HashSet<String>,
    quiet_ms: i64,
    max_wait_ms: i64,
}

/// Stato Git memorizzato per singolo progetto per tracciare transizioni ed evitare replay.
#[derive(Debug, Clone)]
struct ProjectGitState {
    project_path: PathBuf,
    last_commit: Option<String>,
    last_branch: Option<String>,
    last_is_dirty: Option<bool>,
    baseline_initialized: bool,
    in_flight: bool,
    needs_check: bool,
    last_poll_ms: i64,
}

/// Esito di una lettura Git in background per evitare blocchi dell'engine (AUT-013).
#[derive(Debug)]
struct GitPollResult {
    project_path: PathBuf,
    commit: Option<String>,
    branch: Option<String>,
    is_dirty: bool,
    commit_msg: Option<String>,
    error: Option<String>,
}

/// Metadati di una radice approvata e monitorata dal file watcher.
#[derive(Debug, Clone)]
struct WatchedRoot {
    raw_path: PathBuf,
    canonical_path: PathBuf,
}

/// Evento osservato dal motore nativo, opzionalmente attribuito a una specifica definizione (AUT-004, AUT-018).
#[derive(Debug, Clone)]
pub struct ObservedAutomationEvent {
    pub automation_id: Option<String>,
    pub event: AutomationEvent,
}

/// Osservatore principale di eventi filesystem, Git e attività per il motore di automazioni.
pub struct Observer {
    watcher: Option<RecommendedWatcher>,
    file_rx: Receiver<Result<notify::Event, notify::Error>>,
    git_tx: Sender<GitPollResult>,
    git_rx: Receiver<GitPollResult>,
    watched_roots: HashMap<PathBuf, WatchedRoot>,
    git_states: HashMap<PathBuf, ProjectGitState>,
    activity_ledger: HashMap<PathBuf, i64>,
    suppressed_paths: HashSet<PathBuf>,
    known_projects: HashMap<String, AutomationProject>,
    definitions: Vec<AutomationDefinition>,
    pending_file_bursts: HashMap<String, PendingFileBurst>,
    queued_lifecycle_events: Vec<ObservedAutomationEvent>,
    studio_started_emitted: bool,
    errors: HashSet<String>,
}
impl Observer {
    /// Inizializza un nuovo Observer configurando i canali asincroni e il watcher di sistema.
    pub fn new() -> Self {
        let (file_tx, file_rx) = channel();
        let mut errors = HashSet::new();

        let watcher = match notify::recommended_watcher(move |res: Result<notify::Event, notify::Error>| {
            let _ = file_tx.send(res);
        }) {
            Ok(w) => Some(w),
            Err(e) => {
                errors.insert(format!("Inizializzazione watcher filesystem fallita: {e}"));
                None
            }
        };

        let (git_tx, git_rx) = channel();

        Self {
            watcher,
            file_rx,
            git_tx,
            git_rx,
            watched_roots: HashMap::new(),
            git_states: HashMap::new(),
            activity_ledger: HashMap::new(),
            suppressed_paths: HashSet::new(),
            known_projects: HashMap::new(),
            definitions: Vec::new(),
            pending_file_bursts: HashMap::new(),
            queued_lifecycle_events: Vec::new(),
            studio_started_emitted: false,
            errors,
        }
    }

    /// Aggiorna l'insieme dei progetti, definizioni attive e percorsi soppressi.
    /// Riallinea i watcher approvati, gestisce l'apertura progetti e previene cicli.
    pub fn update(
        &mut self,
        projects: &[AutomationProject],
        definitions: &[AutomationDefinition],
        suppressed_paths: &[String],
    ) {
        // 1. Aggiorna i percorsi soppressi correnti e riallinea quelli rilasciati (AUT-017)
        let new_suppressed: HashSet<PathBuf> = suppressed_paths.iter().map(PathBuf::from).collect();
        for previously_suppressed in &self.suppressed_paths {
            if !new_suppressed.contains(previously_suppressed) {
                // Percorso appena uscito dalla soppressione: riallinea il baseline per non generare eventi sui suoi output
                if let Some(git_state) = self.git_states.get_mut(previously_suppressed) {
                    git_state.needs_check = true;
                    git_state.baseline_initialized = false;
                }
            }
        }
        self.suppressed_paths = new_suppressed;

        // 2. Rileva apertura progetti per il trigger 'projectOpened'
        let mut current_known = HashMap::new();
        for proj in projects {
            let path_buf = PathBuf::from(&proj.path);
            let was_open = self.known_projects.get(&proj.id).map(|p| p.open).unwrap_or(false);
            if proj.open && !was_open {
                // Progetto appena aperto: emetti se vi sono definizioni interessate
                for def in definitions {
                    if def.state != "enabled" {
                        continue;
                    }
                    for trig in &def.triggers {
                        if trig.kind == "projectOpened" && definition_targets_project(def, &proj.path) {
                            self.queued_lifecycle_events.push(ObservedAutomationEvent {
                                automation_id: Some(def.id.clone()),
                                event: AutomationEvent {
                                    kind: "projectOpened".to_string(),
                                    at: now_millis(),
                                    project_path: Some(proj.path.clone()),
                                    paths: vec![],
                                    branch: None,
                                    commit: None,
                                    origin: Some("interactive".to_string()),
                                    detail: Some(format!("Apertura del progetto {}", proj.name)),
                                },
                            });
                        }
                    }
                }
            }
            current_known.insert(proj.id.clone(), proj.clone());

            // Assicura la presenza nello stato Git
            self.git_states.entry(path_buf).or_insert_with(|| ProjectGitState {
                project_path: PathBuf::from(&proj.path),
                last_commit: None,
                last_branch: None,
                last_is_dirty: None,
                baseline_initialized: false,
                in_flight: false,
                needs_check: true,
                last_poll_ms: 0,
            });
        }
        self.known_projects = current_known;

        // 3. Salva le definizioni abilitate e pulisci burst obsoleti
        self.definitions = definitions
            .iter()
            .filter(|d| d.state == "enabled")
            .cloned()
            .collect();

        let active_def_ids: HashSet<String> = self.definitions.iter().map(|d| d.id.clone()).collect();
        self.pending_file_bursts.retain(|_k, burst| active_def_ids.contains(&burst.definition_id));

        // 4. Calcola le radici locali approvate da monitorare
        let mut required_roots: HashSet<PathBuf> = HashSet::new();

        for def in &self.definitions {
            for trig in &def.triggers {
                if trig.kind == "file" {
                    if !trig.roots.is_empty() {
                        for r in &trig.roots {
                            required_roots.insert(PathBuf::from(r));
                        }
                    } else if !def.targets.project_paths.is_empty() {
                        for p in &def.targets.project_paths {
                            required_roots.insert(PathBuf::from(p));
                        }
                    } else {
                        for p in projects {
                            required_roots.insert(PathBuf::from(&p.path));
                        }
                    }
                } else if matches!(trig.kind.as_str(), "gitCommit" | "gitBranch" | "gitDirty" | "gitClean") {
                    for p in projects {
                        required_roots.insert(PathBuf::from(&p.path));
                    }
                }
            }
        }

        self.synchronize_watched_roots(required_roots);
    }

    /// Raccoglie ed emette gli eventi pronti nell'istante temporale specificato.
    /// Non blocca indefinitamente il thread chiamante.
    pub fn poll(&mut self, now_ms: i64) -> Vec<ObservedAutomationEvent> {
        let mut emitted_events = Vec::new();

        // 1. Emetti 'studioStarted' al primo tick se presente
        if !self.studio_started_emitted {
            self.studio_started_emitted = true;
            for def in &self.definitions {
                for trig in &def.triggers {
                    if trig.kind == "studioStarted" {
                        emitted_events.push(ObservedAutomationEvent {
                            automation_id: Some(def.id.clone()),
                            event: AutomationEvent {
                                kind: "studioStarted".to_string(),
                                at: now_ms,
                                project_path: None,
                                paths: vec![],
                                branch: None,
                                commit: None,
                                origin: Some("interactive".to_string()),
                                detail: Some("Avvio della sessione di OMP Studio".to_string()),
                            },
                        });
                    }
                }
            }
        }

        // 2. Accoda eventi di ciclo di vita raccolti durante l'update
        emitted_events.append(&mut self.queued_lifecycle_events);

        // 3. Elabora eventi filesystem pendenti dal canale notify
        self.drain_filesystem_events(now_ms);

        // 4. Elabora i risultati dei controlli Git asincroni completati
        self.drain_git_results(now_ms, &mut emitted_events);

        // 5. Pianifica nuovi controlli Git se necessari
        self.schedule_git_checks(now_ms);

        // 6. Rilascia i burst di file che hanno raggiunto la quiete o il tempo massimo di attesa (AUT-018)
        self.flush_file_bursts(now_ms, &mut emitted_events);

        emitted_events
    }

    /// Verifica lo stato dirty attuale di un progetto monitorato (AUT-007).
    pub fn is_dirty(&self, project_path: &str) -> Option<bool> {
        let p = Path::new(project_path);
        if let Some(state) = self.git_states.get(p) {
            if let Some(dirty) = state.last_is_dirty {
                return Some(dirty);
            }
        }

        // Se non ancora pronto, effettua una verifica bounded diretta
        if p.exists() && !is_network_path(p) {
            if let Ok(out) = run_git_bounded(p, &["status", "--porcelain"], Duration::from_millis(1500)) {
                if out.status.success() {
                    let s = String::from_utf8_lossy(&out.stdout);
                    let dirty = s.lines().any(|l| !l.trim().is_empty());
                    return Some(dirty);
                }
            }
        }
        None
    }

    /// Determina se vi e' stata attivita' locale nel progetto dal momento `since_ms` (AUT-007).
    /// Il lavoro gia' committato non scompare dal filtro attivita'.
    pub fn has_local_activity(&self, project_path: &str, since_ms: i64) -> bool {
        let p = Path::new(project_path);
        if let Some(&activity_time) = self.activity_ledger.get(p) {
            if activity_time >= since_ms {
                return true;
            }
        }

        // Controlla anche la presenza di commit locali recenti nel periodo
        if self.has_commits_since(project_path, since_ms, &[]) {
            return true;
        }

        false
    }

    /// Verifica la presenza di commit locali dal momento `since_ms`, con eventuale filtro autori (AUT-007).
    pub fn has_commits_since(&self, project_path: &str, since_ms: i64, authors: &[String]) -> bool {
        let p = Path::new(project_path);
        if !p.exists() || is_network_path(p) {
            return false;
        }

        let since_secs = (since_ms / 1000).max(0);
        let since_arg = format!("--since={since_secs}");
        let args = ["log", &since_arg, "--format=%an"];

        let output = match run_git_bounded(p, &args, GIT_COMMAND_TIMEOUT) {
            Ok(out) if out.status.success() => out,
            _ => return false,
        };

        let stdout = String::from_utf8_lossy(&output.stdout);
        let commit_authors: Vec<&str> = stdout
            .lines()
            .map(str::trim)
            .filter(|l| !l.is_empty())
            .collect();

        if commit_authors.is_empty() {
            return false;
        }

        if authors.is_empty() {
            return true;
        }

        for ca in commit_authors {
            for a in authors {
                if ca.eq_ignore_ascii_case(a.trim()) {
                    return true;
                }
            }
        }

        false
    }

    /// Restituisce la lista degli errori correnti di monitoraggio (AUT-075).
    pub fn monitoring_errors(&self) -> Vec<String> {
        let mut errs: Vec<String> = self.errors.iter().cloned().collect();
        errs.sort();
        errs
    }

    /// Rimuove la soppressione su un percorso e riallinea il baseline senza generare falsi eventi (AUT-017).
    pub fn clear_suppression(&mut self, path: &str) {
        let p = PathBuf::from(path);
        self.suppressed_paths.remove(&p);

        if let Some(state) = self.git_states.get_mut(&p) {
            state.baseline_initialized = false;
            state.in_flight = false;
            state.needs_check = true;
            state.last_poll_ms = 0;
        }

        // Elimina eventuali burst parziali registrati sul percorso soppresso
        self.pending_file_bursts.retain(|_k, burst| {
            if let Some(proj) = &burst.project_path {
                proj != path
            } else {
                true
            }
        });
    }

    /// Restituisce il branch attualmente noto per il progetto.
    pub fn current_branch(&self, project_path: &str) -> Option<String> {
        self.git_states
            .get(Path::new(project_path))
            .and_then(|s| s.last_branch.clone())
    }

    /// Restituisce l'hash del commit attualmente noto per il progetto.
    pub fn current_commit(&self, project_path: &str) -> Option<String> {
        self.git_states
            .get(Path::new(project_path))
            .and_then(|s| s.last_commit.clone())
    }

    // --- Helper interni ---

    /// Sincronizza i percorsi osservati da notify con l'insieme approvato corrente.
    fn synchronize_watched_roots(&mut self, required_roots: HashSet<PathBuf>) {
        let watcher = match self.watcher.as_mut() {
            Some(w) => w,
            None => return,
        };

        // Rimuovi radici non piu' richieste
        let current_roots: Vec<PathBuf> = self.watched_roots.keys().cloned().collect();
        for r in current_roots {
            if !required_roots.contains(&r) {
                let _ = watcher.unwatch(&r);
                self.watched_roots.remove(&r);
            }
        }

        // Aggiungi nuove radici validate
        for r in required_roots {
            if self.watched_roots.contains_key(&r) {
                continue;
            }

            // Escludi cartelle di rete (AUT-016)
            if is_network_path(&r) {
                self.errors.insert(format!(
                    "Cartella di rete non supportata come sorgente eventi: {}",
                    r.display()
                ));
                continue;
            }

            if !r.exists() {
                self.errors.insert(format!("Percorso approvato non trovato su disco: {}", r.display()));
                continue;
            }

            let canonical = match std::fs::canonicalize(&r) {
                Ok(c) => c,
                Err(e) => {
                    self.errors.insert(format!("Risoluzione canonica di {} fallita: {e}", r.display()));
                    continue;
                }
            };

            match watcher.watch(&r, RecursiveMode::Recursive) {
                Ok(_) => {
                    self.watched_roots.insert(
                        r.clone(),
                        WatchedRoot {
                            raw_path: r,
                            canonical_path: canonical,
                        },
                    );
                }
                Err(e) => {
                    self.errors.insert(format!("Avvio monitoraggio su {} fallito: {e}", r.display()));
                }
            }
        }
    }

    /// Drena e analizza gli eventi dal file watcher.
    fn drain_filesystem_events(&mut self, now_ms: i64) {
        while let Ok(msg) = self.file_rx.try_recv() {
            let event = match msg {
                Ok(ev) => ev,
                Err(e) => {
                    self.errors.insert(format!("Errore dal watcher di sistema: {e}"));
                    continue;
                }
            };

            let change_type = classify_notify_kind(&event.kind);

            for path in event.paths {
                // Escludi percorsi di rete o soppressi (AUT-017)
                if is_network_path(&path) || is_path_suppressed(&path, &self.suppressed_paths) {
                    continue;
                }

                // Trova la radice approvata di appartenenza
                let root_entry = self
                    .watched_roots
                    .values()
                    .find(|entry| path.starts_with(&entry.raw_path) || path.starts_with(&entry.canonical_path));

                let root = match root_entry {
                    Some(r) => r,
                    None => continue,
                };

                // Protezione contro symlink escape (AUT-095)
                if check_symlink_escape(&path, &root.canonical_path, &root.raw_path) {
                    continue;
                }

                let norm_rel = calculate_relative_path(&path, &root.raw_path);

                // Se la modifica e' interna a .git, risveglia il controllo Git per il progetto senza emettere eventi file
                if is_git_internal_path(&norm_rel) {
                    if let Some(git_state) = self.git_states.get_mut(&root.raw_path) {
                        git_state.needs_check = true;
                    }
                    continue;
                }

                // Aggiorna l'attivita' locale rilevata sul progetto (AUT-007)
                self.activity_ledger.insert(root.raw_path.clone(), now_ms);

                // Distribuisci l'evento ai trigger file compatibili delle definizioni abilitate
                for def in &self.definitions {
                    for trig in &def.triggers {
                        if trig.kind != "file" {
                            continue;
                        }

                        // Se il trigger specifica radici esplicite (anche esterne autorizzate), verifica corrispondenza
                        let matches_scope = if !trig.roots.is_empty() {
                            trig.roots.iter().any(|r| {
                                normalize_path_for_compare(Path::new(r)) == normalize_path_for_compare(&root.raw_path)
                            })
                        } else {
                            definition_targets_project(def, &root.raw_path.to_string_lossy())
                        };

                        if !matches_scope {
                            continue;
                        }

                        // Verifica filtro change tipo (create, modify, remove)
                        if !trig.changes.is_empty() && !trig.changes.iter().any(|c| c == change_type) {
                            continue;
                        }

                        // Verifica pattern di esclusione (AUT-095)
                        let is_excluded = if trig.exclude_patterns.is_empty() {
                            matches_any_pattern(&norm_rel, DEFAULT_EXCLUDE_PATTERNS)
                        } else {
                            trig.exclude_patterns.iter().any(|pat| glob_match(pat, &norm_rel))
                        };

                        if is_excluded {
                            continue;
                        }

                        // Verifica pattern di inclusione
                        if !trig.include_patterns.is_empty() {
                            let is_included = trig.include_patterns.iter().any(|pat| glob_match(pat, &norm_rel));
                            if !is_included {
                                continue;
                            }
                        }

                        // Registra o accoda nel burst di eventi pendenti per applicare quiete e max wait (AUT-018)
                        let burst_key = format!("{}:{}:{}", def.id, trig.id, root.raw_path.display());
                        let quiet_ms = (def.policy.file_quiet_seconds as i64 * 1000).max(500);
                        let max_wait_ms = (def.policy.file_max_wait_seconds as i64 * 1000).max(quiet_ms);

                        let burst = self.pending_file_bursts.entry(burst_key).or_insert_with(|| PendingFileBurst {
                            definition_id: def.id.clone(),
                            trigger_id: trig.id.clone(),
                            project_path: Some(root.raw_path.to_string_lossy().to_string()),
                            first_event_at_ms: now_ms,
                            last_event_at_ms: now_ms,
                            paths: HashSet::new(),
                            changes: HashSet::new(),
                            quiet_ms,
                            max_wait_ms,
                        });

                        burst.last_event_at_ms = now_ms;
                        burst.paths.insert(norm_rel.clone());
                        burst.changes.insert(change_type.to_string());
                    }
                }
            }
        }
    }

    /// Elabora i risultati dei controlli Git asincroni.
    fn drain_git_results(&mut self, now_ms: i64, emitted_events: &mut Vec<ObservedAutomationEvent>) {
        while let Ok(res) = self.git_rx.try_recv() {
            let state = match self.git_states.get_mut(&res.project_path) {
                Some(s) => s,
                None => continue,
            };

            state.in_flight = false;
            state.needs_check = false;

            if let Some(err) = res.error {
                self.errors.insert(format!("Git check {} fallito: {err}", res.project_path.display()));
                continue;
            }

            // Se il progetto e' soppresso (esecuzioni automazione attive), riallinea silenziosamente (AUT-017)
            if is_path_suppressed(&res.project_path, &self.suppressed_paths) {
                state.last_commit = res.commit;
                state.last_branch = res.branch;
                state.last_is_dirty = Some(res.is_dirty);
                continue;
            }

            // Baseline iniziale all'avvio: nessun replay di eventi avvenuti mentre l'app era spenta (AUT-075)
            if !state.baseline_initialized {
                state.last_commit = res.commit;
                state.last_branch = res.branch;
                state.last_is_dirty = Some(res.is_dirty);
                state.baseline_initialized = true;
                continue;
            }

            let proj_path_str = res.project_path.to_string_lossy().to_string();

            // 1. Nuovo commit locale (AUT-013) - emesso globalmente per il progetto (None)
            if let (Some(new_c), Some(old_c)) = (&res.commit, &state.last_commit) {
                if new_c != old_c && !new_c.is_empty() {
                    self.activity_ledger.insert(res.project_path.clone(), now_ms);

                    emitted_events.push(ObservedAutomationEvent {
                        automation_id: None,
                        event: AutomationEvent {
                            kind: "gitCommit".to_string(),
                            at: now_ms,
                            project_path: Some(proj_path_str.clone()),
                            paths: vec![],
                            branch: res.branch.clone(),
                            commit: Some(new_c.clone()),
                            origin: Some("external".to_string()),
                            detail: res.commit_msg.clone(),
                        },
                    });
                }
            }

            // 2. Cambio branch (AUT-013) - emesso globalmente per il progetto (None)
            if let (Some(new_b), Some(old_b)) = (&res.branch, &state.last_branch) {
                if new_b != old_b && !new_b.is_empty() {
                    self.activity_ledger.insert(res.project_path.clone(), now_ms);

                    emitted_events.push(ObservedAutomationEvent {
                        automation_id: None,
                        event: AutomationEvent {
                            kind: "gitBranch".to_string(),
                            at: now_ms,
                            project_path: Some(proj_path_str.clone()),
                            paths: vec![],
                            branch: Some(new_b.clone()),
                            commit: res.commit.clone(),
                            origin: Some("external".to_string()),
                            detail: Some(format!("Cambio branch verso {new_b}")),
                        },
                    });
                }
            }

            // 3. Transizioni dirty / clean (AUT-013) - emesse globalmente per il progetto (None)
            if let Some(old_dirty) = state.last_is_dirty {
                if old_dirty != res.is_dirty {
                    self.activity_ledger.insert(res.project_path.clone(), now_ms);

                    let trig_kind = if res.is_dirty { "gitDirty" } else { "gitClean" };
                    let detail_msg = if res.is_dirty {
                        "Modifiche non salvate rilevate nel working tree"
                    } else {
                        "Working tree ritornato allo stato pulito"
                    };

                    emitted_events.push(ObservedAutomationEvent {
                        automation_id: None,
                        event: AutomationEvent {
                            kind: trig_kind.to_string(),
                            at: now_ms,
                            project_path: Some(proj_path_str.clone()),
                            paths: vec![],
                            branch: res.branch.clone(),
                            commit: res.commit.clone(),
                            origin: Some("external".to_string()),
                            detail: Some(detail_msg.to_string()),
                        },
                    });
                }
            }

            state.last_commit = res.commit;
            state.last_branch = res.branch;
            state.last_is_dirty = Some(res.is_dirty);
        }
    }

    /// Avvia letture Git su thread worker bounded per i progetti che lo richiedono.
    fn schedule_git_checks(&mut self, now_ms: i64) {
        for (path, state) in self.git_states.iter_mut() {
            if state.in_flight {
                continue;
            }

            let interval_elapsed = now_ms - state.last_poll_ms >= GIT_POLL_INTERVAL_MS;
            if state.needs_check || interval_elapsed {
                state.in_flight = true;
                state.last_poll_ms = now_ms;

                let tx = self.git_tx.clone();
                let proj_path = path.clone();

                std::thread::Builder::new()
                    .name("omp-git-observer".to_string())
                    .spawn(move || {
                        let result = check_git_project(&proj_path);
                        let _ = tx.send(result);
                    })
                    .map_err(|e| {
                        state.in_flight = false;
                        self.errors.insert(format!("Creazione worker thread Git fallita: {e}"));
                    })
                    .ok();
            }
        }
    }

    /// Rilascia gli eventi file pendenti che hanno concluso la quiete o superato il tempo massimo di attesa.
    fn flush_file_bursts(&mut self, now_ms: i64, emitted_events: &mut Vec<ObservedAutomationEvent>) {
        let mut ready_keys = Vec::new();

        for (key, burst) in &self.pending_file_bursts {
            let quiet_elapsed = now_ms - burst.last_event_at_ms >= burst.quiet_ms;
            let max_wait_elapsed = now_ms - burst.first_event_at_ms >= burst.max_wait_ms;

            if quiet_elapsed || max_wait_elapsed {
                ready_keys.push(key.clone());
            }
        }

        for key in ready_keys {
            if let Some(burst) = self.pending_file_bursts.remove(&key) {
                let mut sorted_paths: Vec<String> = burst.paths.into_iter().collect();
                sorted_paths.sort();

                let count = sorted_paths.len();
                let detail = if count == 1 {
                    format!("Rilevata modifica sul file {}", sorted_paths[0])
                } else {
                    format!("Rilevate modifiche raggruppate su {count} file")
                };

                emitted_events.push(ObservedAutomationEvent {
                    automation_id: Some(burst.definition_id),
                    event: AutomationEvent {
                        kind: "file".to_string(),
                        at: burst.first_event_at_ms,
                        project_path: burst.project_path,
                        paths: sorted_paths,
                        branch: None,
                        commit: None,
                        origin: Some("external".to_string()),
                        detail: Some(detail),
                    },
                });
            }
        }
    }
}

impl Default for Observer {
    fn default() -> Self {
        Self::new()
    }
}

// --- Funzioni di utilità e controlli di sicurezza ---

/// Determina se un percorso risiede su una condivisione di rete (AUT-016).
fn is_network_path(p: &Path) -> bool {
    let s = p.to_string_lossy();
    s.starts_with(r"\\") || s.starts_with("//") || s.starts_with(r"\\?\UNC\")
}

/// Rileva se un symlink o giunzione punta all'esterno della radice approvata (AUT-095).
fn check_symlink_escape(path: &Path, canonical_root: &Path, raw_root: &Path) -> bool {
    if let Ok(canon) = std::fs::canonicalize(path) {
        if !canon.starts_with(canonical_root) {
            return true;
        }
    } else if !path.starts_with(raw_root) {
        return true;
    }
    false
}

/// Normalizza il percorso relativo eliminando separatori iniziali e uniformando a '/'.
fn calculate_relative_path(path: &Path, root: &Path) -> String {
    let rel = path.strip_prefix(root).unwrap_or(path);
    rel.to_string_lossy().replace('\\', "/").trim_start_matches('/').to_string()
}

/// Rileva se il percorso e' interno alla directory di controllo versione .git.
fn is_git_internal_path(rel_path: &str) -> bool {
    rel_path == ".git"
        || rel_path.starts_with(".git/")
        || rel_path.contains("/.git/")
        || rel_path.ends_with("/.git")
}

/// Verifica se un percorso e' attualmente soppresso per prevenire auto-attivazioni (AUT-017).
fn is_path_suppressed(path: &Path, suppressed: &HashSet<PathBuf>) -> bool {
    if suppressed.is_empty() {
        return false;
    }
    let norm = normalize_path_for_compare(path);
    for s in suppressed {
        let s_norm = normalize_path_for_compare(s);
        if norm == s_norm
            || norm.starts_with(&format!("{s_norm}/"))
            || s_norm.starts_with(&format!("{norm}/"))
        {
            return true;
        }
    }
    false
}

/// Normalizzazione per confronto (case-insensitive su Windows).
fn normalize_path_for_compare(p: &Path) -> String {
    let s = p.to_string_lossy().replace('\\', "/");
    #[cfg(target_os = "windows")]
    {
        s.to_lowercase()
    }
    #[cfg(not(target_os = "windows"))]
    {
        s
    }
}

/// Classifica il tipo di modifica dal notify::EventKind.
fn classify_notify_kind(kind: &EventKind) -> &'static str {
    match kind {
        EventKind::Create(_) => "create",
        EventKind::Modify(_) => "modify",
        EventKind::Remove(_) => "remove",
        _ => "modify",
    }
}

/// Verifica se una definizione si applica a un dato percorso di progetto.
fn definition_targets_project(def: &AutomationDefinition, project_path: &str) -> bool {
    let norm_proj = normalize_path_for_compare(Path::new(project_path));

    for ex in &def.targets.exclude_paths {
        if normalize_path_for_compare(Path::new(ex)) == norm_proj {
            return false;
        }
    }

    if !def.targets.project_paths.is_empty() {
        return def.targets.project_paths.iter().any(|p| normalize_path_for_compare(Path::new(p)) == norm_proj);
    }

    true
}

/// Verifica se il branch corrente soddisfa i criteri configurati.
fn branch_matches(current_branch: Option<&str>, branches: &[String]) -> bool {
    if branches.is_empty() {
        return true;
    }
    match current_branch {
        Some(b) => branches.iter().any(|pattern| pattern == b || glob_match(pattern, b)),
        None => false,
    }
}

/// Restituisce il timestamp unix corrente in millisecondi.
fn now_millis() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

// --- Esecuzione comandi Git sicura e bounded (AUT-013) ---

/// Esegue un comando Git in sola lettura con timeout rigoroso, senza shell o PowerShell.
fn run_git_bounded(
    cwd: &Path,
    args: &[&str],
    timeout: Duration,
) -> Result<std::process::Output, String> {
    let mut cmd = std::process::Command::new("git");
    cmd.current_dir(cwd);
    cmd.args(args);
    cmd.env("GIT_TERMINAL_PROMPT", "0");
    cmd.env("GCM_INTERACTIVE", "Never");
    cmd.env("LC_ALL", "C");

    #[cfg(target_os = "windows")]
    {
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    let mut child = cmd
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| format!("Avvio di git fallito in {}: {e}", cwd.display()))?;

    let start = Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(_status)) => {
                let output = child
                    .wait_with_output()
                    .map_err(|e| format!("Lettura output git fallita: {e}"))?;
                return Ok(output);
            }
            Ok(None) => {
                if start.elapsed() >= timeout {
                    let _ = child.kill();
                    return Err(format!("Timeout su git {:?}", args));
                }
                std::thread::sleep(Duration::from_millis(20));
            }
            Err(e) => {
                let _ = child.kill();
                return Err(format!("Errore nel monitoraggio del processo git: {e}"));
            }
        }
    }
}

/// Ispezione completa ma veloce dello stato locale Git di un progetto.
fn check_git_project(project_path: &Path) -> GitPollResult {
    // 1. Commit HEAD hash: git rev-parse HEAD
    let commit = match run_git_bounded(project_path, &["rev-parse", "HEAD"], GIT_COMMAND_TIMEOUT) {
        Ok(out) if out.status.success() => {
            let s = String::from_utf8_lossy(&out.stdout).trim().to_string();
            if s.is_empty() {
                None
            } else {
                Some(s)
            }
        }
        _ => None,
    };

    // 2. Branch corrente: git rev-parse --abbrev-ref HEAD
    let branch = match run_git_bounded(project_path, &["rev-parse", "--abbrev-ref", "HEAD"], GIT_COMMAND_TIMEOUT) {
        Ok(out) if out.status.success() => {
            let s = String::from_utf8_lossy(&out.stdout).trim().to_string();
            if s.is_empty() || s == "HEAD" {
                None
            } else {
                Some(s)
            }
        }
        _ => None,
    };

    // 3. Verifica modifiche non committate (dirty): git status --porcelain
    let (is_dirty, status_err) = match run_git_bounded(project_path, &["status", "--porcelain"], GIT_COMMAND_TIMEOUT) {
        Ok(out) if out.status.success() => {
            let s = String::from_utf8_lossy(&out.stdout);
            let has_modifications = s.lines().any(|l| !l.trim().is_empty());
            (has_modifications, None)
        }
        Ok(out) => {
            let err = String::from_utf8_lossy(&out.stderr).trim().to_string();
            (false, Some(err))
        }
        Err(e) => (false, Some(e)),
    };

    // 4. Titolo dell'ultimo commit per detail: git log -1 --format=%s
    let commit_msg = match run_git_bounded(project_path, &["log", "-1", "--format=%s"], GIT_COMMAND_TIMEOUT) {
        Ok(out) if out.status.success() => {
            let s = String::from_utf8_lossy(&out.stdout).trim().to_string();
            if s.is_empty() {
                None
            } else {
                Some(s)
            }
        }
        _ => None,
    };

    GitPollResult {
        project_path: project_path.to_path_buf(),
        commit,
        branch,
        is_dirty,
        commit_msg,
        error: status_err,
    }
}

// --- Matching pattern Glob autonomo e robusto (AUT-095) ---

/// Verifica se un percorso soddisfa almeno uno dei pattern forniti.
fn matches_any_pattern(path: &str, patterns: &[&str]) -> bool {
    patterns.iter().any(|pat| glob_match(pat, path))
}

/// Motore glob ricorsivo per '*' (singolo segmento), '**' (segmenti multipli) e '?'.
pub fn glob_match(pattern: &str, path: &str) -> bool {
    let p_norm = path.replace('\\', "/").trim_matches('/').to_string();
    let pat_norm = pattern.replace('\\', "/").trim_matches('/').to_string();

    #[cfg(target_os = "windows")]
    let (p_norm, pat_norm) = (p_norm.to_lowercase(), pat_norm.to_lowercase());

    // Se il pattern non contiene '/' ed e' semplice (es. "*.ts" o "README.md"), verifica l'ultimo segmento
    if !pat_norm.contains('/') && pat_norm != "**" {
        let last_segment = p_norm.rsplit('/').next().unwrap_or(&p_norm);
        return match_wildcard(pat_norm.as_bytes(), last_segment.as_bytes());
    }

    let pat_segs: Vec<&str> = pat_norm.split('/').filter(|s| !s.is_empty()).collect();
    let text_segs: Vec<&str> = p_norm.split('/').filter(|s| !s.is_empty()).collect();

    match_segments(&pat_segs, &text_segs)
}

/// Confronto ricorsivo per segmenti di percorso.
fn match_segments(pat_segs: &[&str], text_segs: &[&str]) -> bool {
    if pat_segs.is_empty() {
        return text_segs.is_empty();
    }

    if pat_segs[0] == "**" {
        for i in 0..=text_segs.len() {
            if match_segments(&pat_segs[1..], &text_segs[i..]) {
                return true;
            }
        }
        return false;
    }

    if text_segs.is_empty() {
        return false;
    }

    if match_wildcard(pat_segs[0].as_bytes(), text_segs[0].as_bytes()) {
        return match_segments(&pat_segs[1..], &text_segs[1..]);
    }

    false
}

/// Wildcard matcher standard per singolo segmento di caratteri.
fn match_wildcard(pat: &[u8], text: &[u8]) -> bool {
    let mut p = 0;
    let mut t = 0;
    let mut star_p = None;
    let mut star_t = None;

    while t < text.len() {
        if p < pat.len() && (pat[p] == text[t] || pat[p] == b'?') {
            p += 1;
            t += 1;
        } else if p < pat.len() && pat[p] == b'*' {
            star_p = Some(p);
            p += 1;
            star_t = Some(t);
        } else if let (Some(sp), Some(st)) = (star_p, star_t) {
            p = sp + 1;
            t = st + 1;
            star_t = Some(t);
        } else {
            return false;
        }
    }

    while p < pat.len() && pat[p] == b'*' {
        p += 1;
    }

    p == pat.len()
}
