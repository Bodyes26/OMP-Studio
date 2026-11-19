//! Trasporto della seconda superficie: `omp --mode rpc-ui` su stdio NDJSON.
//!
//! Gemello di `pty/mod.rs`, con tre differenze che contano:
//!
//! 1. **Nessuna shell.** `std::process::Command` diretto sul binario: nel
//!    percorso RPC non serve un terminale e il quoting di PowerShell sarebbe
//!    solo un rischio.
//! 2. **Nessun `WT_SESSION`.** Il breadcrumb serviva a scoprire quale sessione
//!    girava in quale scheda; qui `get_state.sessionId` lo dice.
//! 3. **Il webview non vede il filo grezzo.** Questo modulo riassembla i
//!    `rpc_chunk` e coalesce i delta di streaming, perche' ogni
//!    `message_update` porta il messaggio intero due volte (in
//!    `assistantMessageEvent.partial` e in `message`): inoltrarli tutti
//!    costerebbe O(n^2) byte su IPC per una singola risposta lunga.

use std::collections::{HashMap, VecDeque};
use std::io::{BufRead, BufReader, Write};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU8, Ordering};
use std::sync::{Arc, Weak};
use std::thread;
use std::time::{Duration, Instant};

use base64::Engine;
use parking_lot::Mutex;
use serde::Deserialize;
use tauri::ipc::{Channel, InvokeResponseBody};
use tauri::State;

mod diag;
pub(crate) mod hub;
use diag::RpcStats;
use hub::{ChannelSink, Resume, SessionHub};

/// Tetto di riassemblaggio annunciato dal frame `ready` (64 MiB). Oltre
/// questo un frame logico e' un errore, non un caso da gestire.
const MAX_REASSEMBLED_BYTES: usize = 67_108_864;

/// Finestra di coalescenza dei delta. Portata a 16ms per allinearsi al budget
/// di un frame UI (~60fps), evitando di emettere un frame IPC per singolo token.
/// I punti di riallineamento (frame terminali, cambio di blocco o frame non-delta)
/// svuotano immediatamente il buffer senza ritardi.
const DELTA_WINDOW: Duration = Duration::from_millis(16);

/// Righe di stderr conservate per la diagnostica di crash. Un avvio fallito
/// (binario mancante, provider non autenticato, estensione rotta) altrimenti
/// si manifesterebbe solo come stdin chiuso.
const STDERR_TAIL_LINES: usize = 200;

#[derive(Clone)]
pub struct RpcSession {
    child: Arc<Mutex<Child>>,
    /// `None` dopo `rpc_close`: chiudere stdin e' il modo documentato di far
    /// drenare i comandi accettati e uscire con codice 0.
    stdin: Arc<Mutex<Option<ChildStdin>>>,
    stderr_tail: Arc<Mutex<VecDeque<String>>>,
    protocol: Arc<AtomicU8>,
    abort_signal: Arc<AtomicBool>,
    config_path: Option<std::path::PathBuf>,
    pub pool_path: Option<std::path::PathBuf>,
    pub pid: Option<u32>,
    #[cfg(target_os = "windows")]
    pub job: Option<Arc<crate::process_tree::WindowsJob>>,
    killed: Arc<AtomicBool>,
    #[allow(dead_code)]
    pub scope: String,
    #[allow(dead_code)]
    pub prototype_id: Option<String>,
    #[allow(dead_code)]
    pub session_id: Arc<Mutex<Option<String>>>,
    pub cwd: String,
    pub execution_id: Option<String>,
    pub project_id: Option<String>,
    stats: Arc<RpcStats>,
    /// Distribuisce i frame alle finestre iscritte (MI02).
    hub: Arc<SessionHub>,
    lane_id: Option<String>,
    /// Superficie GUI che una finestra ricaricata puo' riprendere. Le
    /// sessioni di automazione appartengono al loro esecutore e non si
    /// riprendono mai da un'altra apertura.
    adoptable: bool,
}

impl RpcSession {
    pub fn kill_tree(&self) {
        if self.killed.swap(true, Ordering::SeqCst) {
            return;
        }
        self.abort_signal.store(true, Ordering::SeqCst);
        self.stdin.lock().take();
        self.remove_config_file();

        // Figlio gia' raccolto (`try_wait` del registro corsie o di
        // `rpc_close`): il PID puo' essere stato riusato, niente segnali per PID.
        let reaped = self.child.lock().try_wait().ok().flatten().is_some();
        let pid = if reaped { None } else { self.pid };
        #[cfg(not(target_os = "windows"))]
        if reaped {
            if let Some(pgid) = self.pid {
                crate::process_tree::kill_orphaned_group(pgid);
            }
        }
        #[cfg(target_os = "windows")]
        crate::process_tree::kill_process_tree(pid, self.job.as_deref());
        #[cfg(not(target_os = "windows"))]
        crate::process_tree::kill_process_tree(pid);

        let mut child = self.child.lock();
        let _ = child.kill();
        let _ = child.wait();
    }

    /// Vero quando l'albero della sessione non ha piu' processi attivi.
    fn tree_drained(&self) -> bool {
        #[cfg(target_os = "windows")]
        {
            crate::process_tree::job_drained(self.job.as_deref())
        }
        #[cfg(not(target_os = "windows"))]
        {
            // `process_group(0)` all'avvio: il PID di omp e' il PGID dell'albero.
            self.pid
                .is_none_or(|pid| !crate::process_tree::process_group_alive(pid))
        }
    }

    /// Cancella il file di configurazione temporaneo della sessione.
    fn remove_config_file(&self) {
        if let Some(config_file) = self.config_path.as_ref() {
            let _ = std::fs::remove_file(config_file);
        }
        if let Some(pool_file) = self.pool_path.as_ref() {
            let _ = std::fs::remove_file(pool_file);
        }
    }
}

/// Mette omp a capo di un process group proprio: `kill_process_tree` puo'
/// abbattere anche i nipoti (tool, server avviati dall'agente) con un solo
/// segnale a `-pgid`. Effetto collaterale voluto: i figli non ricevono piu' il
/// SIGHUP del terminale da cui e' partito Studio, quindi la chiusura delle
/// sessioni all'uscita dell'app (lib.rs, `RpcManager::close_all`) e' esplicita.
#[cfg(unix)]
fn own_process_group(command: &mut Command) {
    use std::os::unix::process::CommandExt;
    command.process_group(0);
}

/// Proprieta' della corsia per la sessione agente (Gate R27 / PLAN W11). Il
/// registro dei processi non apre handle propri: interroga e ferma la sessione
/// che ha avviato l'albero, quindi non puo' toccare processi altrui.
struct LaneAgentProcess {
    rpc_id: u64,
    session: RpcSession,
}

impl crate::process_tree::LaneProcessControl for LaneAgentProcess {
    fn is_alive(&self) -> bool {
        self.session
            .child
            .lock()
            .try_wait()
            .map(|status| status.is_none())
            .unwrap_or(false)
    }

    fn stop_and_wait(&self) {
        self.session.kill_tree();
        crate::process_tree::unregister_lane_process(
            crate::process_tree::LaneProcessKind::Agent,
            self.rpc_id,
        );
        crate::lane_bridge::revoke_owner("agent", self.rpc_id);
    }

    fn tree_drained(&self) -> bool {
        self.session.tree_drained()
    }
}

pub struct RpcManager {
    sessions: Arc<Mutex<HashMap<u64, RpcSession>>>,
    next_id: Mutex<u64>,
    open_gate: Mutex<()>,
    /// Finestre che seguivano una sessione chiusa con «Nuova chat» o con una
    /// ripresa dallo storico da un'altra finestra: si iscrivono alla sessione
    /// che la sostituisce (F16).
    followers: Arc<Mutex<Vec<Followers>>>,
}

/// Ogni quanto si cercano sessioni rimaste senza finestre oltre `ORPHAN_GRACE`.
const ORPHAN_SWEEP_INTERVAL: Duration = Duration::from_secs(30);
/// Tempo concesso alla sessione sostitutiva per nascere: oltre, chi seguiva
/// riceve la fine del processo come se la chat fosse stata chiusa.
const FOLLOWERS_TTL: Duration = Duration::from_secs(30);

/// Identita' di una superficie GUI: stessa corsia, stessa cartella, stesso
/// prototipo. Due finestre con la stessa identita' condividono il processo.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct SessionIdentity {
    pub scope: String,
    pub cwd: String,
    pub project_id: Option<String>,
    pub lane_id: Option<String>,
    pub prototype_id: Option<String>,
}

impl SessionIdentity {
    fn of(session: &RpcSession) -> Self {
        Self {
            scope: session.scope.clone(),
            cwd: session.cwd.clone(),
            project_id: session.project_id.clone(),
            lane_id: session.lane_id.clone(),
            prototype_id: session.prototype_id.clone(),
        }
    }
}

struct Followers {
    identity: SessionIdentity,
    consumers: Vec<(Option<String>, Box<dyn hub::FrameSink>)>,
    expires: Instant,
}

/// Consumatore che si iscrive a una sessione aperta o ripresa: una WebView
/// (`Channel`) o un'altra istanza (collegamento).
pub(crate) struct NewConsumer {
    pub owner: String,
    make_sink: Box<dyn FnOnce(Arc<RpcStats>) -> Box<dyn hub::FrameSink> + Send>,
}

impl NewConsumer {
    pub(crate) fn channel(channel: Channel<InvokeResponseBody>, owner: String) -> Self {
        Self {
            owner,
            make_sink: Box::new(move |stats| Box::new(ChannelSink::new(channel, stats))),
        }
    }

    pub(crate) fn sink(owner: String, sink: Box<dyn hub::FrameSink>) -> Self {
        Self {
            owner,
            make_sink: Box::new(move |_| sink),
        }
    }
}

/// Esito di una chiusura chiesta da un consumatore.
pub(crate) enum CloseOutcome {
    /// Altre finestre seguono la sessione: chi chiude si stacca e basta.
    Detached,
    /// Era l'ultimo consumatore (o una sostituzione): la sessione va chiusa.
    /// Incorniciata: l'esito `Detached` arriva a ogni chiusura e non deve
    /// trascinarsi dietro la taglia dell'intera sessione.
    Closing(Box<RpcSession>),
    Missing,
}

impl RpcManager {
    pub fn new() -> Self {
        let sessions = Arc::new(Mutex::new(HashMap::new()));
        let followers = Arc::new(Mutex::new(Vec::new()));
        spawn_orphan_reaper(Arc::downgrade(&sessions), Arc::downgrade(&followers));
        RpcManager {
            sessions,
            next_id: Mutex::new(1),
            open_gate: Mutex::new(()),
            followers,
        }
    }

    /// Chiude tutte le sessioni RPC attive rilasciando stdin e terminando i processi figli.
    pub fn close_all(&self) {
        let sessions: Vec<RpcSession> = {
            let mut guard = self.sessions.lock();
            guard.drain().map(|(_, session)| session).collect()
        };

        // In parallelo: ogni albero ha fino a 1.5 s per uscire con SIGTERM e
        // all'uscita dell'app le attese non devono sommarsi.
        let handles: Vec<_> = sessions
            .into_iter()
            .map(|session| thread::spawn(move || session.kill_tree()))
            .collect();
        for handle in handles {
            let _ = handle.join();
        }
    }

    /// Una WebView che si ricarica perde i suoi `Channel`: le sue iscrizioni
    /// cadono, le sessioni restano vive per chi le riapre (`rpc_open`).
    pub fn detach_window(&self, label: &str) {
        self.detach_owner(label);
    }

    /// Toglie un consumatore (WebView o istanza collegata) da tutte le sessioni.
    pub(crate) fn detach_owner(&self, owner: &str) {
        let sessions = self.sessions.lock();
        let mut detached = 0;
        for session in sessions.values() {
            detached += session.hub.detach_owner(owner);
        }
        self.followers.lock().iter_mut().for_each(|followers| {
            followers
                .consumers
                .retain(|(follower, _)| follower.as_deref() != Some(owner))
        });
        if detached > 0 {
            crate::studio_log::info(
                "rpc",
                format!("{owner} scollegato: {detached} sessioni restano vive per chi le riprende"),
            );
        }
    }

    /// Iscrive un consumatore a una sessione gia' viva.
    pub(crate) fn attach(
        &self,
        rpc_id: u64,
        consumer: NewConsumer,
        resume: Resume,
    ) -> Result<hub::Attached, String> {
        let sessions = self.sessions.lock();
        let session = sessions.get(&rpc_id).ok_or_else(|| session_missing(rpc_id))?;
        let sink = (consumer.make_sink)(session.stats.clone());
        session.hub.detach_owner(&consumer.owner);
        session.hub.attach(sink, Some(consumer.owner), resume)
    }

    /// Chiusura chiesta da un consumatore. Con altre finestre iscritte la
    /// sessione resta viva: chi chiude si stacca. Con `replacing` («Nuova
    /// chat», ripresa dallo storico) il processo si chiude e le altre finestre
    /// passano alla sessione che lo sostituisce.
    pub(crate) fn close_for(&self, rpc_id: u64, closer: &str, replacing: bool) -> CloseOutcome {
        let mut sessions = self.sessions.lock();
        let Some(session) = sessions.get(&rpc_id) else {
            return CloseOutcome::Missing;
        };
        if !session.hub.has_owner(closer) {
            return CloseOutcome::Detached;
        }
        if replacing {
            let consumers = session.hub.take_consumers_except(closer);
            if !consumers.is_empty() {
                self.followers.lock().push(Followers {
                    identity: SessionIdentity::of(session),
                    consumers,
                    expires: Instant::now() + FOLLOWERS_TTL,
                });
            }
        } else {
            session.hub.detach_owner(closer);
            if !session.hub.is_orphaned() {
                return CloseOutcome::Detached;
            }
        }
        match sessions.remove(&rpc_id) {
            Some(session) => CloseOutcome::Closing(Box::new(session)),
            None => CloseOutcome::Missing,
        }
    }

    /// Passa alla sessione appena nata le finestre che seguivano quella che
    /// sostituisce: ricevono il nuovo id e poi, come all'avvio, il suo `ready`.
    fn hand_over_followers(&self, identity: &SessionIdentity, rpc_id: u64, hub: &SessionHub) {
        let waiting: Vec<Followers> = {
            let mut followers = self.followers.lock();
            let (matching, rest): (Vec<_>, Vec<_>) = std::mem::take(&mut *followers)
                .into_iter()
                .partition(|followers| &followers.identity == identity);
            *followers = rest;
            matching
        };
        let rebind = serde_json::json!({ "type": "studio_rebind", "rpcId": rpc_id }).to_string();
        for (owner, mut sink) in waiting.into_iter().flat_map(|followers| followers.consumers) {
            if sink.deliver(0, "studio_rebind", &rebind) {
                let _ = hub.attach(sink, owner, Resume::Fresh);
            }
        }
    }

}

fn session_missing(rpc_id: u64) -> String {
    crate::tr!(
        format!("Sessione RPC {} non disponibile", rpc_id),
        format!("RPC session {} not available", rpc_id)
    )
}

/// Chiude le sessioni rimaste senza finestre oltre `ORPHAN_GRACE`: dopo una
/// ricarica nessuno le ha riprese, e il loro omp resterebbe vivo fino
/// all'uscita dell'app. Chiude anche le attese di sostituzione scadute.
fn spawn_orphan_reaper(
    sessions: Weak<Mutex<HashMap<u64, RpcSession>>>,
    followers: Weak<Mutex<Vec<Followers>>>,
) {
    let _ = thread::Builder::new()
        .name("rpc-orphans".to_string())
        .spawn(move || loop {
            thread::sleep(ORPHAN_SWEEP_INTERVAL);
            let (Some(sessions), Some(followers)) = (sessions.upgrade(), followers.upgrade())
            else {
                break;
            };
            let now = Instant::now();
            let expired = take_expired_orphans(&sessions, now);
            let stale = take_expired_followers(&followers, now);
            drop(sessions);
            drop(followers);
            for (rpc_id, session) in expired {
                crate::studio_log::warn(
                    "rpc",
                    format!(
                        "sessione rpc={rpc_id} senza finestre da oltre {:?}: chiusa",
                        hub::ORPHAN_GRACE
                    ),
                );
                crate::lane_bridge::revoke_owner("agent", rpc_id);
                stop_removed_session(session);
            }
            let exit = serde_json::json!({ "type": "studio_exit", "rpcId": null, "code": null, "stderr": [] })
                .to_string();
            for (_, mut sink) in stale.into_iter().flat_map(|followers| followers.consumers) {
                sink.deliver(0, "studio_exit", &exit);
            }
        });
}

fn take_expired_followers(followers: &Mutex<Vec<Followers>>, now: Instant) -> Vec<Followers> {
    let mut guard = followers.lock();
    let (expired, rest): (Vec<_>, Vec<_>) = std::mem::take(&mut *guard)
        .into_iter()
        .partition(|followers| followers.expires <= now);
    *guard = rest;
    expired
}

fn take_expired_orphans(
    sessions: &Mutex<HashMap<u64, RpcSession>>,
    now: Instant,
) -> Vec<(u64, RpcSession)> {
    let mut guard = sessions.lock();
    let expired: Vec<u64> = guard
        .iter()
        .filter(|(_, session)| {
            session
                .hub
                .orphaned_for(now)
                .is_some_and(|orphaned| orphaned >= hub::ORPHAN_GRACE)
        })
        .map(|(id, _)| *id)
        .collect();
    expired
        .into_iter()
        .filter_map(|id| guard.remove(&id).map(|session| (id, session)))
        .collect()
}

/// Chi riapre la stessa corsia, nella stessa cartella e sulla stessa
/// conversazione, si iscrive alla sessione gia' viva invece di avviare un
/// secondo omp sullo stesso progetto: dopo una ricarica della finestra, o
/// quando un'altra istanza apre la chat di un progetto di questa macchina.
struct AdoptionKey<'a> {
    scope: &'a str,
    cwd: &'a str,
    project_id: Option<&'a str>,
    lane_id: Option<&'a str>,
    prototype_id: Option<&'a str>,
    resume: Option<&'a str>,
}

impl AdoptionKey<'_> {
    fn matches(&self, session: &RpcSession, owner: &str) -> bool {
        session.adoptable
            && !session.killed.load(Ordering::SeqCst)
            && session.scope == self.scope
            && session.cwd == self.cwd
            && session.project_id.as_deref() == self.project_id
            && session.lane_id.as_deref() == self.lane_id
            && session.prototype_id.as_deref() == self.prototype_id
            && self
                .resume
                .is_none_or(|wanted| session.session_id.lock().as_deref() == Some(wanted))
            // La stessa finestra iscritta due volte alla stessa sessione non
            // esiste: una sua nuova apertura vuole un processo nuovo.
            && !session.hub.has_owner(owner)
    }

    fn identity(&self) -> SessionIdentity {
        SessionIdentity {
            scope: self.scope.to_string(),
            cwd: self.cwd.to_string(),
            project_id: self.project_id.map(str::to_string),
            lane_id: self.lane_id.map(str::to_string),
            prototype_id: self.prototype_id.map(str::to_string),
        }
    }
}

/// Iscrive il consumatore alla sessione viva con l'identita' cercata. Se non
/// ce n'e' una lo restituisce: allora si avvia un processo nuovo.
fn adopt_session(
    manager: &RpcManager,
    key: &AdoptionKey,
    consumer: NewConsumer,
) -> Result<Result<u64, String>, NewConsumer> {
    let sessions = manager.sessions.lock();
    let Some((rpc_id, session)) = sessions
        .iter()
        .find(|(_, session)| key.matches(session, &consumer.owner))
    else {
        return Err(consumer);
    };
    if session.hub.is_orphaned() {
        session.stats.restart_channel();
    }
    let owner = consumer.owner;
    let sink = (consumer.make_sink)(session.stats.clone());
    let attached = session.hub.attach(sink, Some(owner.clone()), Resume::Fresh);
    Ok(attached.map(|_| {
        crate::studio_log::info(
            "rpc",
            format!("sessione rpc={rpc_id} ripresa da {owner} cwd={}", session.cwd),
        );
        *rpc_id
    }))
}

/// Destinazione (`prewalk.into`) e ripartenza (`prewalk.from`) scelte per la
/// sessione. Assenti: valgono quelle globali di `config.yml`.
#[derive(Debug, Default, Clone)]
pub(crate) struct PrewalkTargets {
    pub into: Option<String>,
    pub from: Option<String>,
}

/// Riscrive in modo atomico il file di configurazione overlay GUI,
/// preservando la base (`tools.approvalMode: yolo`, `tools.intentTracing: true`,
/// `read.defaultLimit: 1200`, `goal.continuationModes` con `rpc`, `ask.timeout: 0`)
/// e aggiornando `prewalk.enabled` con destinazione e ripartenza della sessione.
///
/// `goal.continuationModes`: di default omp fa proseguire da solo un obiettivo
/// (goal mode) solo nel terminale (`interactive`). Senza `rpc` un obiettivo
/// creato dalla chat GUI farebbe un turno e poi si fermerebbe.
///
/// `tools.intentTracing`: da omp 19.0 l'intento dei tool (`i`) e' spento di
/// default fuori dalla TUI, ma la GUI lo mostra in card, vassoio e riga di attivita'.
///
/// `prewalk.into` sta nello stesso file di `enabled`: il watcher di omp risolve
/// la destinazione quando `enabled` passa a vero, e una scrittura separata
/// (o la sola config globale) potrebbe arrivargli dopo.
/// Rifiuta la riscrittura se il percorso appartiene a una configurazione del Laboratorio.
pub(crate) fn set_gui_overlay_prewalk(
    config_path: &std::path::Path,
    enabled: bool,
    targets: &PrewalkTargets,
) -> Result<(), String> {
    if config_path.to_string_lossy().contains("omp-studio-lab-") {
        return Err(crate::tr!(
            "Rifiutata modifica prewalk su configurazione Laboratorio",
            "Prewalk change refused on the Lab configuration"
        )
        .to_string());
    }
    let mut content = String::from(
        "tools:\n  approvalMode: yolo\n  intentTracing: true\nread:\n  defaultLimit: 1200\ngoal:\n  continuationModes:\n    - interactive\n    - rpc\nask:\n  timeout: 0\nprewalk:\n",
    );
    content.push_str(if enabled {
        "  enabled: true\n"
    } else {
        "  enabled: false\n"
    });
    for (key, value) in [("into", &targets.into), ("from", &targets.from)] {
        let Some(selector) = value.as_deref().map(str::trim).filter(|v| !v.is_empty()) else {
            continue;
        };
        // Una stringa JSON e' uno scalare YAML tra virgolette: `@smol` non
        // sarebbe valido come scalare semplice.
        let quoted = serde_json::to_string(selector).map_err(|e| e.to_string())?;
        content.push_str(&format!("  {key}: {quoted}\n"));
    }
    crate::fs_atomic::atomic_write(config_path, content.as_bytes())
}

/// La lingua della UI segue la sessione. Senza locale non si scrive la
/// variabile: l'estensione ricade sull'inglese solo se Studio non ha lingua.
pub(crate) fn apply_studio_locale(command: &mut Command, locale: Option<&str>) {
    if let Some(locale) = locale.map(str::trim).filter(|value| !value.is_empty()) {
        command.env("OMP_STUDIO_LOCALE", locale);
    }
}

/// Genera la configurazione overlay per-sessione per il percorso GUI con prewalk disabilitato di default.
pub(crate) fn write_gui_overlay(rpc_id: u64) -> Result<std::path::PathBuf, String> {
    let overlay_path = std::env::temp_dir().join(format!("omp-studio-gui-overlay-{}.yml", rpc_id));
    set_gui_overlay_prewalk(&overlay_path, false, &PrewalkTargets::default())?;
    Ok(overlay_path)
}

/// Sorgente dell'estensione OMP per sessioni in sola lettura e assistente automazioni.
pub const READONLY_EXTENSION_TS: &str = include_str!("../../../extensions/studio-readonly.ts");

/// Prepara un file di pool account temporaneo per la sessione, disattivando le API key a consumo.
/// Rispetta il file OMP_AUTH_BROKER_ACCOUNT_POOL_FILE eventualmente configurato dall'utente,
/// intersecando le regole esistenti senza allargare gli account OAuth autorizzati (fail-closed).
fn prepare_automation_pool_file(rpc_id: u64) -> Result<std::path::PathBuf, String> {
    let pool_file = std::env::temp_dir().join(format!("omp-auto-pool-{}.json", rpc_id));
    let existing_pool_env = std::env::var("OMP_AUTH_BROKER_ACCOUNT_POOL_FILE").ok();

    let pool_json = if let Some(path_str) = &existing_pool_env {
        let content = std::fs::read_to_string(path_str).map_err(|e| {
            crate::tr!(
                format!(
                    "Impossibile leggere il file pool account esistente '{}': {}",
                    path_str, e
                ),
                format!(
                    "Unable to read the existing account pool file '{}': {}",
                    path_str, e
                )
            )
        })?;
        let mut parsed: serde_json::Value = serde_json::from_str(&content).map_err(|e| {
            crate::tr!(
                format!(
                    "File pool account esistente '{}' non è JSON valido: {}",
                    path_str, e
                ),
                format!(
                    "Existing account pool file '{}' is not valid JSON: {}",
                    path_str, e
                )
            )
        })?;

        if let Some(obj) = parsed.as_object_mut() {
            if let Some(wild) = obj.get_mut("*") {
                if wild.is_boolean() {
                    if wild.as_bool() == Some(true) {
                        *wild = serde_json::json!({ "apiKeys": false });
                    }
                } else if let Some(rule_obj) = wild.as_object_mut() {
                    rule_obj.insert("apiKeys".to_string(), serde_json::Value::Bool(false));
                }
            } else {
                obj.insert("*".to_string(), serde_json::json!({ "apiKeys": false }));
            }

            for (_prov, rule) in obj.iter_mut() {
                if rule.is_array() {
                    let accounts = rule.clone();
                    *rule = serde_json::json!({
                        "accounts": accounts,
                        "apiKeys": false
                    });
                } else if rule.is_boolean() {
                    if rule.as_bool() == Some(true) {
                        *rule = serde_json::json!({ "apiKeys": false });
                    }
                } else if let Some(rule_obj) = rule.as_object_mut() {
                    rule_obj.insert("apiKeys".to_string(), serde_json::Value::Bool(false));
                }
            }
        } else {
            return Err(crate::tr!(
                "Struttura del pool account non valida (atteso oggetto JSON)",
                "Invalid account pool structure (expected a JSON object)"
            )
            .to_string());
        }
        parsed
    } else {
        serde_json::json!({
            "*": { "apiKeys": false }
        })
    };

    let data = serde_json::to_vec(&pool_json).map_err(|e| {
        crate::tr!(
            format!("Serializzazione pool file temporaneo fallita: {}", e),
            format!("Failed to serialize the temporary pool file: {}", e)
        )
    })?;
    std::fs::write(&pool_file, data).map_err(|e| {
        crate::tr!(
            format!("Scrittura pool file temporaneo fallita: {}", e),
            format!("Failed to write the temporary pool file: {}", e)
        )
    })?;

    Ok(pool_file)
}

/// Genera la configurazione per-sessione per automazioni e sola lettura:
/// disattiva fallback del modello (`retry.modelFallback: false`), azzera le catene di fallback,
/// disattiva la promozione di contesto (`contextPromotion.enabled: false`),
/// e per sola lettura disattiva shell, interpreti e MCP.
pub fn write_automation_session_config(
    rpc_id: u64,
    is_read_only: bool,
    readonly_extension_path: Option<&str>,
) -> Result<std::path::PathBuf, String> {
    let mut config_path = std::env::temp_dir();
    config_path.push(format!("omp-studio-auto-{}.yml", rpc_id));

    let mut content = String::new();
    content.push_str(crate::tr!(
        "# Configurazione per-sessione generata da OMP Studio per automazioni\n",
        "# Per-session configuration generated by OMP Studio for automations\n"
    ));
    if is_read_only {
        content.push_str("bash:\n  enabled: false\n\n");
        content.push_str("eval:\n  py: false\n  js: false\n  rb: false\n  jl: false\n\n");
        content.push_str("mcp:\n  enableProjectConfig: false\n\n");
        content.push_str("tools:\n  approvalMode: review\n  xdev: false\n  intentTracing: true\n\n");
    } else {
        content.push_str("tools:\n  approvalMode: review\n  intentTracing: true\n\n");
    }
    content.push_str("read:\n  defaultLimit: 1200\n\n");
    content.push_str("retry:\n  modelFallback: false\n  fallbackChains: {}\n\n");
    content.push_str("contextPromotion:\n  enabled: false\n\n");
    content.push_str("ask:\n  timeout: 0\n\n");
    if let Some(ext_path) = readonly_extension_path {
        let normalized = ext_path.replace('\\', "/");
        content.push_str("extensions:\n");
        content.push_str(&format!("  - \"{}\"\n", normalized));
    }

    std::fs::write(&config_path, content.as_bytes()).map_err(|e| {
        crate::tr!(
            format!(
                "Impossibile generare la configurazione di sessione automazione: {}",
                e
            ),
            format!(
                "Unable to generate the automation session configuration: {}",
                e
            )
        )
    })?;

    Ok(config_path)
}

/// Sorgente dell'estensione OMP per il Laboratorio prototipi (broker scrittura confinata).
pub const LAB_EXTENSION_TS: &str = include_str!("../../../extensions/studio-lab.ts");

/// Valida che un identificatore di prototipo rispetti il contratto:
/// 2-64 caratteri, minuscolo alfanumerico con trattini interni, nessun
/// trattino finale e nessun nome riservato Windows (es. con, nul, com1...).
pub fn is_valid_prototype_id(id: &str) -> bool {
    if id.len() < 2 || id.len() > 64 || id.ends_with('-') {
        return false;
    }
    let mut chars = id.chars();
    match chars.next() {
        Some(c) if c.is_ascii_lowercase() || c.is_ascii_digit() => {}
        _ => return false,
    }
    for c in chars {
        if !c.is_ascii_lowercase() && !c.is_ascii_digit() && c != '-' {
            return false;
        }
    }
    let base = id.split('.').next().unwrap_or("").to_ascii_lowercase();
    !matches!(
        base.as_str(),
        "con"
            | "prn"
            | "aux"
            | "nul"
            | "com1"
            | "com2"
            | "com3"
            | "com4"
            | "com5"
            | "com6"
            | "com7"
            | "com8"
            | "com9"
            | "lpt1"
            | "lpt2"
            | "lpt3"
            | "lpt4"
            | "lpt5"
            | "lpt6"
            | "lpt7"
            | "lpt8"
            | "lpt9"
    )
}

/// Configurazione generata per-sessione per il Laboratorio prototipi.
/// Disattiva shell (`bash`), interpreti host (`eval`), browser generico
/// e configurazioni MCP di progetto, caricando l'estensione confinata dello Step 4.
/// `lanes_extension_path` aggiunge l'estensione delle corsie: dentro il
/// Laboratorio registra il solo `corsia_fatto`, che l'hook fail-closed ammette.
/// NON usa l'overlay globale `approvalMode: yolo`, NON tocca `~/.omp`,
/// e alloca un file temporaneo dedicato per ciascuna sessione.
pub fn write_lab_session_config(
    rpc_id: u64,
    prototype_id: &str,
    lab_extension_path: Option<&str>,
    plan_extension_path: Option<&str>,
    lanes_extension_path: Option<&str>,
) -> Result<std::path::PathBuf, String> {
    let mut config_path = std::env::temp_dir();
    let safe_proto = prototype_id
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' {
                c
            } else {
                '_'
            }
        })
        .collect::<String>();
    config_path.push(format!("omp-studio-lab-{}-{}.yml", rpc_id, safe_proto));

    let mut content = String::new();
    content.push_str(crate::tr!(
        "# Configurazione per-sessione generata da OMP Studio per il Laboratorio prototipi\n",
        "# Per-session configuration generated by OMP Studio for Lab prototypes\n"
    ));
    content.push_str(crate::tr!(
        "# Disattiva shell, interpreti host, browser generico e configurazioni MCP.\n\n",
        "# Disables shell, host interpreters, the general browser and MCP configurations.\n\n"
    ));

    // Disattivazione shell libera
    content.push_str("bash:\n  enabled: false\n\n");

    // Disattivazione interpreti host
    content.push_str("eval:\n  py: false\n  js: false\n  rb: false\n  jl: false\n\n");

    // Browser abilitato per l'ispezione dell'anteprima (limitato dall'estensione)
    content.push_str("browser:\n  enabled: true\n\n");
    // Disattivazione configurazioni MCP di progetto
    content.push_str("mcp:\n  enableProjectConfig: false\n\n");

    // Disattivazione xdev per esporre direttamente i tool confinati del Laboratorio;
    // intentTracing come nella GUI (spento di default in RPC da omp 19.0).
    content.push_str("tools:\n  xdev: false\n  intentTracing: true\n\n");
    // ask.timeout: 0 per disabilitare auto-timeout di ask
    content.push_str("ask:\n  timeout: 0\n\n");

    // Caricamento estensione Laboratorio e Piano (e, se presente, delle corsie). Senza
    // l'estensione confinata non si carica nient'altro: le altre estensioni
    // da sole non avrebbero il gate fail-closed attorno.
    if let Some(ext_path) = lab_extension_path {
        let normalized = ext_path.replace('\\', "/");
        content.push_str("extensions:\n");
        content.push_str(&format!("  - \"{}\"\n", normalized));
        if let Some(plan_path) = plan_extension_path {
            let normalized = plan_path.replace('\\', "/");
            content.push_str(&format!("  - \"{}\"\n", normalized));
        }
        if let Some(lanes_path) = lanes_extension_path {
            let normalized = lanes_path.replace('\\', "/");
            content.push_str(&format!("  - \"{}\"\n", normalized));
        }
    }

    std::fs::write(&config_path, content.as_bytes()).map_err(|e| {
        crate::tr!(
            format!(
                "Impossibile generare la configurazione di sessione Laboratorio: {}",
                e
            ),
            format!("Unable to generate the Lab session configuration: {}", e)
        )
    })?;

    Ok(config_path)
}

/// Filtro eventi chiesto a omp appena e' pronto. `events` e' una lista di
/// ammessi: e' l'unione `RpcAgentEvent` di omp (`modes/rpc/wire/events.ts`)
/// senza `tool_stream_update`. Quel frame e' l'anteprima nativa di `edit`:
/// a ogni token della chiamata omp rispedisce l'anteprima intera (~35 KB),
/// e Studio non la legge. Il 2026-11-02 un `edit` da 41 KB ne ha prodotti
/// 93 MB: omp li ha accodati nel suo file di spool, che rilegge a ~8 KB/s,
/// e risposte ai comandi e fine del turno sono rimaste dietro per ore.
/// Un evento di sessione nuovo di omp non arriva finche' non e' qui.
const EVENT_FILTER_COMMAND: &[u8] =
    b"{\"id\":\"studio-filter-1\",\"type\":\"set_event_filter\",\"events\":[\
\"agent_start\",\"agent_end\",\"turn_start\",\"turn_end\",\
\"message_start\",\"message_update\",\"message_end\",\
\"tool_execution_start\",\"tool_execution_update\",\"tool_execution_end\",\
\"auto_compaction_start\",\"auto_compaction_end\",\
\"manual_compaction_start\",\"manual_compaction_end\",\
\"auto_retry_start\",\"auto_retry_end\",\
\"cache_warming_start\",\"cache_warming_end\",\
\"retry_fallback_applied\",\"retry_fallback_succeeded\",\
\"model_changed\",\"config_warnings_changed\",\
\"advisor_cost_changed\",\"advisor_yielded\",\
\"ttsr_triggered\",\"todo_reminder\",\"todo_auto_clear\",\
\"irc_message\",\"notice\",\"thinking_level_changed\",\
\"goal_updated\",\"queue_update\"\
],\"messageUpdates\":\"delta\"}\n";

/// Vista minima di un frame in arrivo: solo cio' che il trasporto deve
/// decidere. `serde` ignora il resto senza allocarlo.
#[derive(Deserialize)]
struct FramePeek<'a> {
    #[serde(rename = "type")]
    kind: Option<&'a str>,
    #[serde(rename = "sessionId")]
    session_id: Option<&'a str>,
    #[serde(rename = "supportedProtocolVersions")]
    supported_protocol_versions: Option<Vec<u8>>,
    #[serde(rename = "assistantMessageEvent")]
    assistant_message_event: Option<AssistantEventPeek<'a>>,
}

/// Correlazione di una `response`, letta a parte: un `id` di forma inattesa
/// deve degradare solo l'etichetta della scatola nera, mai la `FramePeek`
/// da cui dipendono coalescenza dei delta e sessionId.
#[derive(Deserialize)]
struct ResponsePeek {
    id: Option<String>,
    command: Option<String>,
    success: Option<bool>,
}
#[derive(Deserialize)]
struct TransitionResponsePeek {
    data: Option<TransitionOutcomePeek>,
}


#[derive(Deserialize)]
struct TransitionOutcomePeek {
    cancelled: Option<bool>,
}

#[derive(Deserialize)]
struct AssistantEventPeek<'a> {
    #[serde(rename = "type")]
    kind: &'a str,
    #[serde(rename = "contentIndex")]
    content_index: Option<u32>,
    delta: Option<String>,
}

#[derive(Deserialize)]
struct ChunkFrame {
    #[serde(rename = "chunkId")]
    chunk_id: String,
    index: usize,
    count: usize,
    #[serde(rename = "byteLength")]
    byte_length: usize,
    data: String,
}

/// Sequenza di `rpc_chunk` in corso. Una sola per volta: il protocollo
/// garantisce che i chunk di un frame logico arrivino ininterrotti, quindi
/// una sequenza interlacciata e' un errore da rifiutare, non da tollerare.
struct ChunkAssembly {
    chunk_id: String,
    count: usize,
    byte_length: usize,
    next_index: usize,
    buffer: Vec<u8>,
}

/// Delta accumulati in attesa di essere spediti come un solo frame.
struct DeltaBuffer {
    kind: &'static str,
    content_index: u32,
    text: String,
    since: Instant,
}

impl DeltaBuffer {
    fn into_frame(self) -> String {
        // Serializzato a mano: e' un oggetto di quattro campi, e passare da
        // serde_json::Value per costruirlo allocherebbe una mappa per token.
        let mut out = String::with_capacity(self.text.len() + 96);
        out.push_str("{\"type\":\"studio_delta\",\"kind\":\"");
        out.push_str(self.kind);
        out.push_str("\",\"contentIndex\":");
        out.push_str(&self.content_index.to_string());
        out.push_str(",\"delta\":");
        // `to_string` su una stringa produce un letterale JSON valido con
        // tutti gli escape: e' l'unica parte che non conviene fare a mano.
        out.push_str(&serde_json::Value::String(self.text).to_string());
        out.push('}');
        out
    }
}

fn delta_kind(event_kind: &str) -> Option<&'static str> {
    match event_kind {
        "text_delta" => Some("text"),
        "thinking_delta" => Some("thinking"),
        "toolcall_delta" => Some("toolcall"),
        _ => None,
    }
}

/// Legge stdout riga per riga. Le righe arrivano fino a 1 MiB, quindi
/// `read_until` su un `Vec` che si ridimensiona, non `lines()` con il buffer
/// di default.
struct ReaderLoopArgs {
    stdout: std::process::ChildStdout,
    hub: Arc<SessionHub>,
    stdin: Arc<Mutex<Option<ChildStdin>>>,
    protocol: Arc<AtomicU8>,
    child: Arc<Mutex<Child>>,
    stderr_tail: Arc<Mutex<VecDeque<String>>>,
    sessions: Arc<Mutex<HashMap<u64, RpcSession>>>,
    rpc_id: u64,
    abort_signal: Arc<AtomicBool>,
    session_id: Arc<Mutex<Option<String>>>,
    stats: Arc<RpcStats>,
}

fn reader_loop(args: ReaderLoopArgs) {
    let ReaderLoopArgs {
        stdout,
        hub,
        stdin,
        protocol,
        child,
        stderr_tail,
        sessions,
        rpc_id,
        abort_signal,
        session_id,
        stats,
    } = args;
    let mut reader = BufReader::with_capacity(1 << 16, stdout);
    let mut raw = Vec::with_capacity(1 << 16);
    let mut assembly: Option<ChunkAssembly> = None;
    let mut pending_delta: Option<DeltaBuffer> = None;

    loop {
        raw.clear();
        match reader.read_until(b'\n', &mut raw) {
            Ok(0) => break,
            Ok(_) => {}
            Err(_) => break,
        }
        while raw.last().is_some_and(|b| *b == b'\n' || *b == b'\r') {
            raw.pop();
        }
        if raw.is_empty() {
            continue;
        }
        stats.stdout_line(raw.len());
        // Svuota delta e chunk pendenti se e' arrivato un segnale di abort
        if abort_signal.swap(false, Ordering::SeqCst) {
            pending_delta = None;
            assembly = None;
        }

        let Ok(line) = std::str::from_utf8(&raw) else {
            // stdout di omp e' UTF-8 per contratto: una riga non decodificabile
            // e' corruzione del filo, non un frame da inoltrare.
            continue;
        };
        // I chunk si riassemblano qui: il webview non ne vede mai uno.
        if line.contains("\"rpc_chunk\"") {
            match reassemble(line, &mut assembly) {
                Ok(Some(logical)) => {
                    dispatch(
                        &logical,
                        &hub,
                        &stdin,
                        &protocol,
                        &mut pending_delta,
                        &session_id,
                    );
                }
                Ok(None) => {}
                Err(reason) => {
                    assembly = None;
                    let frame = serde_json::json!({
                        "type": "studio_error",
                        "rpcId": rpc_id,
                        "message": reason,
                    });
                    hub.publish("studio_error", frame.to_string());
                }
            }
            continue;
        }
        // Se arriva una riga ordinaria non-chunk mentre una sequenza era in corso,
        // la sequenza incompleta e' da considerarsi interrotta/annullata.
        if assembly.is_some() {
            assembly = None;
        }

        dispatch(
            line,
            &hub,
            &stdin,
            &protocol,
            &mut pending_delta,
            &session_id,
        );
    }

    if let Some(buffer) = pending_delta.take() {
        hub.publish("studio_delta", buffer.into_frame());
    }
    stats.reader_exited();

    // La morte del processo va raccontata con la sua causa: senza le righe di
    // stderr un avvio fallito (provider non autenticato, estensione rotta) si
    // vedrebbe solo come una superficie che smette di rispondere. Il codice
    // puo' essere `null` se il figlio non e' ancora stato raccolto: e' un
    // dettaglio diagnostico, non un valore su cui ramificare.
    let code = child
        .lock()
        .try_wait()
        .ok()
        .flatten()
        .and_then(|s| s.code());
    let tail: Vec<String> = stderr_tail.lock().iter().cloned().collect();
    // omp uscito da solo: nessuno chiamera' piu' `rpc_close` o `kill_tree` su
    // questa sessione, quindi l'overlay/config temporaneo va tolto qui o resta
    // in %TEMP% per sempre.
    let removed = sessions.lock().remove(&rpc_id);
    if let Some(session) = removed {
        // Una sessione ancora registrata significa che nessuno l'ha chiusa:
        // e' l'uscita che l'utente non ha chiesto e che va spiegata.
        crate::studio_log::warn(
            "rpc",
            format!(
                "omp terminato da solo rpc={} codice={:?} stderr={}",
                rpc_id,
                code,
                tail.last().map(String::as_str).unwrap_or("-")
            ),
        );
        session.kill_tree();
    } else {
        crate::studio_log::info(
            "rpc",
            format!("omp chiuso rpc={} codice={:?}", rpc_id, code),
        );
    }
    crate::lane_bridge::revoke_owner("agent", rpc_id);
    hub.publish(
        "studio_exit",
        serde_json::json!({
            "type": "studio_exit",
            "rpcId": rpc_id,
            "code": code,
            "stderr": tail,
        })
        .to_string(),
    );
}

/// Riassembla una sequenza di `rpc_chunk`. `Ok(Some(_))` quando il frame
/// logico e' completo. Ogni violazione del contratto (chunkId che cambia a
/// meta', indice fuori ordine, lunghezza dichiarata diversa) fa fallire la
/// sequenza invece di consegnare byte plausibili.
fn reassemble(line: &str, assembly: &mut Option<ChunkAssembly>) -> Result<Option<String>, String> {
    let chunk: ChunkFrame = serde_json::from_str(line).map_err(|error| {
        crate::tr!(
            format!("Chunk RPC illeggibile: {}", error),
            format!("Unreadable RPC chunk: {}", error)
        )
    })?;

    if chunk.count == 0 || chunk.index >= chunk.count {
        return Err(crate::tr!(
            format!(
                "Chunk RPC incoerente: index {} su count {}",
                chunk.index, chunk.count
            ),
            format!(
                "Inconsistent RPC chunk: index {} of {}",
                chunk.index, chunk.count
            )
        ));
    }
    if chunk.byte_length > MAX_REASSEMBLED_BYTES {
        return Err(crate::tr!(
            format!(
                "Frame RPC da {} byte oltre il tetto di riassemblaggio",
                chunk.byte_length
            ),
            format!(
                "RPC frame of {} bytes exceeds the reassembly cap",
                chunk.byte_length
            )
        ));
    }

    let current = match assembly.take() {
        Some(current) if current.chunk_id == chunk.chunk_id => {
            if chunk.index != current.next_index || chunk.count != current.count {
                return Err(crate::tr!(
                    format!(
                        "Sequenza di chunk {} interrotta all'indice {}",
                        chunk.chunk_id, chunk.index
                    ),
                    format!(
                        "Chunk sequence {} broken at index {}",
                        chunk.chunk_id, chunk.index
                    )
                ));
            }
            current
        }
        Some(previous) => {
            if chunk.index == 0 {
                // Se la sequenza precedente e' stata troncata e ne inizia una nuova (index 0),
                // scartiamo quella vecchia senza fallire la nuova.
                ChunkAssembly {
                    chunk_id: chunk.chunk_id.clone(),
                    count: chunk.count,
                    byte_length: chunk.byte_length,
                    next_index: 0,
                    buffer: Vec::with_capacity(chunk.byte_length.min(MAX_REASSEMBLED_BYTES)),
                }
            } else {
                return Err(crate::tr!(
                    format!(
                        "Sequenza di chunk {} interlacciata con {}",
                        previous.chunk_id, chunk.chunk_id
                    ),
                    format!(
                        "Chunk sequence {} interleaved with {}",
                        previous.chunk_id, chunk.chunk_id
                    )
                ));
            }
        }
        None => {
            if chunk.index != 0 {
                return Err(crate::tr!(
                    format!(
                        "Sequenza di chunk {} iniziata dall'indice {}",
                        chunk.chunk_id, chunk.index
                    ),
                    format!(
                        "Chunk sequence {} started at index {}",
                        chunk.chunk_id, chunk.index
                    )
                ));
            }
            ChunkAssembly {
                chunk_id: chunk.chunk_id.clone(),
                count: chunk.count,
                byte_length: chunk.byte_length,
                next_index: 0,
                buffer: Vec::with_capacity(chunk.byte_length.min(MAX_REASSEMBLED_BYTES)),
            }
        }
    };

    let mut current = current;
    let decoded = base64::engine::general_purpose::STANDARD
        .decode(chunk.data.as_bytes())
        .map_err(|error| {
            crate::tr!(
                format!("Chunk RPC non decodificabile: {}", error),
                format!("Undecodable RPC chunk: {}", error)
            )
        })?;
    current.buffer.extend_from_slice(&decoded);
    if current.buffer.len() > MAX_REASSEMBLED_BYTES {
        return Err(crate::tr!(
            "Frame RPC oltre il tetto di riassemblaggio",
            "RPC frame exceeds the reassembly cap"
        )
        .to_string());
    }
    current.next_index = chunk.index + 1;

    if current.next_index < current.count {
        *assembly = Some(current);
        return Ok(None);
    }

    if current.buffer.len() != current.byte_length {
        return Err(crate::tr!(
            format!(
                "Frame RPC ricomposto da {} byte invece dei {} dichiarati",
                current.buffer.len(),
                current.byte_length
            ),
            format!(
                "Reassembled RPC frame has {} bytes instead of the declared {}",
                current.buffer.len(),
                current.byte_length
            )
        ));
    }
    String::from_utf8(current.buffer).map(Some).map_err(|_| {
        crate::tr!(
            "Frame RPC ricomposto non e' UTF-8 valido",
            "Reassembled RPC frame is not valid UTF-8"
        )
        .to_string()
    })
}

/// Rimuove la chiave `trace` da qualsiasi oggetto `details` all'interno del frame JSON.
/// Restituisce `true` se almeno una chiave `trace` e' stata rimossa.
fn strip_trace_from_details(value: &mut serde_json::Value) -> bool {
    let mut removed = false;
    match value {
        serde_json::Value::Object(map) => {
            if let Some(serde_json::Value::Object(details)) = map.get_mut("details") {
                if details.remove("trace").is_some() {
                    removed = true;
                }
            }
            for v in map.values_mut() {
                if strip_trace_from_details(v) {
                    removed = true;
                }
            }
        }
        serde_json::Value::Array(arr) => {
            for v in arr.iter_mut() {
                if strip_trace_from_details(v) {
                    removed = true;
                }
            }
        }
        _ => {}
    }
    removed
}

/// Rimuove la traccia di esecuzione shell (`details.trace`) prima dell'inoltro al frontend.
///
/// A partire da omp 18.17, la traccia shell (`display.shellVisualization`) si accumula a ogni
/// secondo nei frame `tool_execution_update` e nei risultati `toolResult`, raggiungendo centinaia
/// di KB per frame durante comandi lunghi (es. MSBuild). Studio non disegna la traccia shell
/// (ha i propri renderer di tool): inoltrarla inonda il canale IPC Rust->WebView.
///
/// Per evitare di rieseguire il parse JSON su tutti i frame (la maggior parte inoltrati come
/// stringa grezza), si effettua prima un controllo rapido a sottostringa: si fa il parse solo
/// se compaiono `"trace"` e uno dei marcatori di tool execution o toolResult. Se nessuna chiave
/// `trace` e' stata effettivamente rimossa, restituisce `None` per preservare il frame byte per
/// byte senza riserializzarlo.
fn strip_shell_trace(line: &str) -> Option<String> {
    if !line.contains("\"trace\"") {
        return None;
    }
    if !line.contains("tool_execution_") && !line.contains("toolResult") {
        return None;
    }
    let mut value: serde_json::Value = serde_json::from_str(line).ok()?;
    if strip_trace_from_details(&mut value) {
        serde_json::to_string(&value).ok()
    } else {
        None
    }
}

/// Instrada un frame logico verso le finestre iscritte alla sessione.
fn dispatch(
    line: &str,
    hub: &SessionHub,
    stdin: &Arc<Mutex<Option<ChildStdin>>>,
    protocol: &Arc<AtomicU8>,
    pending_delta: &mut Option<DeltaBuffer>,
    session_id: &Arc<Mutex<Option<String>>>,
) {
    let peek: Option<FramePeek> = serde_json::from_str(line).ok();
    if let Some(peek) = &peek {
        if let Some(id) = peek.session_id {
            let mut guard = session_id.lock();
            if guard.as_deref() != Some(id) {
                *guard = Some(id.to_string());
            }
        }
        if let Some(event) = &peek.assistant_message_event {
            if let Some(kind) = delta_kind(event.kind) {
                let index = event.content_index.unwrap_or(0);
                let delta = event.delta.as_deref().unwrap_or("");
                // Delta vuoti esistono (`toolcall_delta` con `delta: ""`) e non
                // portano informazione: si scartano prima di allocare.
                if delta.is_empty() {
                    return;
                }
                match pending_delta {
                    Some(buffer) if buffer.kind == kind && buffer.content_index == index => {
                        buffer.text.push_str(delta);
                    }
                    _ => {
                        if let Some(buffer) = pending_delta.take() {
                            hub.publish("studio_delta", buffer.into_frame());
                        }
                        *pending_delta = Some(DeltaBuffer {
                            kind,
                            content_index: index,
                            text: delta.to_string(),
                            since: Instant::now(),
                        });
                    }
                }
                // Si spedisce quando la finestra e' scaduta: nessun timer,
                // e il frame terminale (`text_end`, `toolcall_end`) fa
                // comunque da flush.
                if pending_delta
                    .as_ref()
                    .is_some_and(|buffer| buffer.since.elapsed() >= DELTA_WINDOW)
                {
                    let buffer = pending_delta.take().expect("appena verificato");
                    hub.publish("studio_delta", buffer.into_frame());
                }
                return;
            }
        }
    }

    // Qualsiasi frame che non sia un delta e' un punto di riallineamento:
    // i delta accumulati vanno spediti prima, o arriverebbero dopo il
    // `*_end` che li rende autorevoli.
    if line.contains("\"command\":\"abort\"") {
        *pending_delta = None;
    } else if let Some(buffer) = pending_delta.take() {
        hub.publish("studio_delta", buffer.into_frame());
    }

    if let Some(peek) = &peek {
        if peek.kind == Some("ready") {
            *pending_delta = None;
            let supports_v2 = peek
                .supported_protocol_versions
                .as_ref()
                .is_some_and(|versions| versions.contains(&2));
            if supports_v2 {
                let negotiated = {
                    let mut guard = stdin.lock();
                    match guard.as_mut() {
                        Some(handle) => handle
                            .write_all(
                                b"{\"id\":\"studio-proto-1\",\"type\":\"negotiate_protocol\",\"protocolVersion\":2}\n",
                            )
                            .and_then(|()| handle.flush())
                            .is_ok(),
                        None => false,
                    }
                };
                if negotiated {
                    protocol.store(2, Ordering::Relaxed);
                }
            }
            // `message_update` di omp porta a ogni token l'intero messaggio
            // parziale (in `message` e in `assistantMessageEvent.partial`):
            // mentre il modello scrive un file da 15 KB ogni delta diventa una
            // riga da ~90 KB. omp non riesce a scaricarle sulla pipe, le
            // accoda in un file temporaneo (centinaia di MB) e tutto cio' che
            // segue, risposte ai comandi comprese, arriva con minuti di
            // ritardo: chat ferma e prompt rifiutati dopo 60 s. In modalita'
            // `delta` omp toglie le istantanee e lascia delta, `content` dei
            // `*_end` e `toolCall`, cioe' tutto cio' che Studio usa; la lista
            // di `EVENT_FILTER_COMMAND` toglie le anteprime di `edit`. Un omp
            // che non conosce il comando risponde con un errore senza padrone.
            let mut guard = stdin.lock();
            if let Some(handle) = guard.as_mut() {
                let _ = handle
                    .write_all(EVENT_FILTER_COMMAND)
                    .and_then(|()| handle.flush());
            }
        }
    }

    // Nella scatola nera la `response` porta comando e id: si vede se la
    // risposta a un comando e' arrivata almeno fino a Rust.
    let mut transition_request = None;
    let label: std::borrow::Cow<str> = match peek.as_ref().and_then(|p| p.kind) {
        Some("response") => match serde_json::from_str::<ResponsePeek>(line) {
            Ok(r) => {
                let label = std::borrow::Cow::Owned(format!(
                    "response:{}#{}",
                    r.command.as_deref().unwrap_or("?"),
                    r.id.as_deref().unwrap_or("-")
                ));
                if r.success == Some(true)
                    && matches!(r.command.as_deref(), Some("new_session" | "fork" | "branch"))
                    && !serde_json::from_str::<TransitionResponsePeek>(line).ok()
                        .and_then(|response| response.data)
                        .is_some_and(|data| data.cancelled == Some(true))
                {
                    transition_request = Some(r.id);
                }
                label
            }
            Err(_) => std::borrow::Cow::Borrowed("response"),
        },
        Some(kind) => std::borrow::Cow::Borrowed(kind),
        None => std::borrow::Cow::Borrowed("?"),
    };
    // Invia come JSON nativo solo i frame che sono gia' JSON valido verificato
    // da FramePeek; se la riga non e' JSON valido la si serializza come stringa
    // per non rompere l'eval JS lato WebView.
    let frame = if peek.is_some() {
        strip_shell_trace(line).unwrap_or_else(|| line.to_string())
    } else {
        serde_json::to_string(line).unwrap_or_else(|_| "{}".to_string())
    };
    hub.publish(&label, frame);
    if let Some(request_id) = transition_request {
        hub.conversation_changed(request_id.as_deref());
    }
}
/// Applica `--resume <session_id>` se la sessione indicata possiede un transcript valido;
/// altrimenti, se `continue_last` e' true, applica `--continue`.
fn apply_resume_or_continue(
    command_args: &mut Vec<String>,
    resume: Option<&str>,
    continue_last: bool,
    transcript_exists: impl Fn(&str) -> bool,
) {
    let mut resumed = false;
    if let Some(session_id) = resume.filter(|id| !id.is_empty() && transcript_exists(id)) {
        command_args.push("--resume".to_string());
        command_args.push(session_id.to_string());
        resumed = true;
    }
    if !resumed && continue_last {
        command_args.push("--continue".to_string());
    }
}

#[tauri::command]
// La firma espone i parametri del comando IPC usati dal frontend.
#[allow(clippy::too_many_arguments)]
pub async fn rpc_open(
    cwd: String,
    resume: Option<String>,
    lane_id: Option<String>,
    project_id: Option<String>,
    continue_last: Option<bool>,
    model: Option<String>,
    on_event: Channel<InvokeResponseBody>,
    webview: tauri::Webview,
    manager: State<'_, RpcManager>,
    automation_origin: Option<String>,
    read_only: Option<bool>,
    allowed_roots: Option<Vec<String>>,
    max_cost_usd: Option<f64>,
    prevent_payg: Option<bool>,
    execution_id: Option<String>,
) -> Result<u64, String> {
    open_main_session(
        &manager,
        OpenMainArgs {
            cwd,
            resume,
            lane_id,
            project_id,
            continue_last,
            model,
            automation_origin,
            read_only,
            allowed_roots,
            max_cost_usd,
            prevent_payg,
            execution_id,
        },
        NewConsumer::channel(on_event, webview.label().to_string()),
    )
}

/// Argomenti di `rpc_open`, con gli stessi nomi della finestra: il
/// collegamento fra istanze li inoltra cosi' come sono.
#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct OpenMainArgs {
    pub cwd: String,
    pub resume: Option<String>,
    pub lane_id: Option<String>,
    pub project_id: Option<String>,
    pub continue_last: Option<bool>,
    pub model: Option<String>,
    pub automation_origin: Option<String>,
    pub read_only: Option<bool>,
    pub allowed_roots: Option<Vec<String>>,
    pub max_cost_usd: Option<f64>,
    pub prevent_payg: Option<bool>,
    pub execution_id: Option<String>,
}

pub(crate) fn open_main_session(
    manager: &RpcManager,
    args: OpenMainArgs,
    consumer: NewConsumer,
) -> Result<u64, String> {
    let _opening = manager.open_gate.lock();
    let OpenMainArgs {
        cwd,
        resume,
        lane_id,
        project_id,
        continue_last,
        model,
        automation_origin,
        read_only,
        allowed_roots,
        max_cost_usd,
        prevent_payg,
        execution_id,
    } = args;
    let is_read_only = read_only.unwrap_or(false);
    let is_automation_session =
        is_read_only || execution_id.is_some() || automation_origin.is_some();
    let model_requested = model.as_deref().is_some_and(|m| !m.trim().is_empty());
    let key = AdoptionKey {
        scope: "main",
        cwd: if cwd.is_empty() { "." } else { &cwd },
        project_id: project_id.as_deref(),
        lane_id: lane_id.as_deref(),
        prototype_id: None,
        resume: resume.as_deref().filter(|id| !id.is_empty()),
    };
    let identity = key.identity();
    // Una finestra ricaricata, o un'altra istanza, riapre una superficie GUI
    // che ha gia' un processo: lo si condivide invece di duplicarlo. Un
    // modello esplicito chiede un processo nuovo.
    let consumer = if !is_automation_session && !model_requested {
        match adopt_session(manager, &key, consumer) {
            Ok(adopted) => return adopted,
            Err(consumer) => consumer,
        }
    } else {
        consumer
    };

    let stats = Arc::new(RpcStats::default());
    let hub = Arc::new(SessionHub::new());
    hub.attach(
        (consumer.make_sink)(stats.clone()),
        Some(consumer.owner),
        Resume::Fresh,
    )?;

    let rpc_id = {
        let mut guard = manager.next_id.lock();
        let id = *guard;
        *guard += 1;
        id
    };

    let omp_path = crate::omp_ops::get_omp_binary();

    let readonly_extension = if is_read_only {
        crate::pty::write_extension("studio-readonly.ts", READONLY_EXTENSION_TS)
    } else {
        None
    };

    let overlay_path = if is_automation_session {
        write_automation_session_config(rpc_id, is_read_only, readonly_extension.as_deref())?
    } else {
        write_gui_overlay(rpc_id)?
    };

    let diagram_extension = if is_read_only {
        None
    } else {
        crate::pty::write_extension("studio-diagram.ts", crate::pty::DIAGRAM_EXTENSION_TS)
    };
    let tasks_extension = if is_read_only {
        None
    } else {
        crate::pty::write_extension("studio-tasks.ts", crate::pty::TASKS_EXTENSION_TS)
    };
    let lanes_extension = if is_read_only {
        None
    } else {
        crate::pty::write_extension("studio-lanes.ts", crate::pty::LANES_EXTENSION_TS)
    };
    let plan_extension = if is_read_only {
        None
    } else {
        crate::pty::write_extension("studio-plan.ts", crate::pty::PLAN_EXTENSION_TS)
    };
    let loop_extension = if is_read_only {
        None
    } else {
        crate::pty::write_extension("studio-loop.ts", crate::pty::LOOP_EXTENSION_TS)
    };
    let goal_extension = if is_read_only {
        None
    } else {
        crate::pty::write_extension("studio-goal.ts", crate::pty::GOAL_EXTENSION_TS)
    };
    let headsup_extension = if is_read_only {
        None
    } else {
        crate::pty::write_extension("studio-headsup.ts", crate::pty::HEADSUP_EXTENSION_TS)
    };
    let docs_extension = if is_read_only {
        None
    } else {
        crate::pty::write_extension("studio-docs.ts", crate::pty::DOCS_EXTENSION_TS)
    };
    let automations_extension = if is_read_only {
        None
    } else {
        crate::pty::write_extension(
            "studio-automations.ts",
            crate::pty::AUTOMATIONS_EXTENSION_TS,
        )
    };
    let ask_extension = crate::pty::write_extension("studio-ask.ts", crate::pty::ASK_EXTENSION_TS);

    // Progetto senza cartella (chat temporanea): stesso trattamento del PTY,
    // sessione effimera e nessun `--cwd`.
    let scratchpad = cwd.is_empty();
    let launch_cwd = if scratchpad {
        ".".to_string()
    } else {
        cwd.clone()
    };

    let mut command = Command::new(&omp_path);
    command.arg("--mode").arg("rpc-ui");
    if scratchpad {
        command.arg("--no-session");
    } else {
        command.arg("--cwd").arg(&cwd);
    }
    command.arg("--config").arg(&overlay_path);
    if is_read_only {
        // Disabilita discovery estensioni di progetto prima dell'avvio (AUT-086)
        command.arg("--no-extensions");
        // Limita i tool nativi a sola lettura e interazione
        command
            .arg("--tools")
            .arg("read,grep,glob,todo,ask,web_search");
    }
    if let Some(cost) = max_cost_usd {
        command.arg(format!("--max-cost={}", cost));
    }
    command
        .arg("--append-system-prompt")
        .arg(crate::pty::main_agent_system_prompt());
    if let Some(path) = &readonly_extension {
        command.arg("-e").arg(path);
    }
    if let Some(path) = &diagram_extension {
        command.arg("-e").arg(path);
    }
    if let Some(path) = &tasks_extension {
        command.arg("-e").arg(path);
    }
    if let Some(path) = &lanes_extension {
        command.arg("-e").arg(path);
    }
    if let Some(path) = &plan_extension {
        command.arg("-e").arg(path);
    }
    if let Some(path) = &loop_extension {
        command.arg("-e").arg(path);
    }
    // Proposte dell'agente per l'obiettivo guidato (`/guided-goal`): facoltativa,
    // senza file l'intervista resta con le proposte fisse.
    if let Some(path) = &goal_extension {
        command.arg("-e").arg(path);
    }
    if let Some(path) = &headsup_extension {
        command.arg("-e").arg(path);
    }
    if let Some(path) = &docs_extension {
        command.arg("-e").arg(path);
    }
    if let Some(path) = &automations_extension {
        command.arg("-e").arg(path);
    }
    if let Some(path) = &ask_extension {
        command.arg("-e").arg(path);
    }
    // Applica resume (se sessione valida) oppure continue_last
    let mut session_args = Vec::new();
    apply_resume_or_continue(
        &mut session_args,
        resume.as_deref(),
        continue_last.unwrap_or(false),
        crate::omp_ops::session_transcript_exists,
    );
    for arg in session_args {
        command.arg(arg);
    }
    if let Some(m) = model.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        command.arg("--model").arg(m);
        if prevent_payg.unwrap_or(false) {
            command.arg("--models").arg(m);
        }
    }

    command
        .current_dir(&launch_cwd)
        .env("OMP_STUDIO", "1")
        // Accende `studio-plan.ts`: il Piano della chat GUI. Nel PTY la
        // variabile manca e l'estensione resta inerte (vale il `/plan` nativo).
        .env("OMP_STUDIO_PLAN", "gui")
        // Abilita ask HTML in RPC
        .env("OMP_STUDIO_ASK", "1")
        // Come per il PTY: nessun wizard dentro una sessione di lavoro.
        .env("OMP_SKIP_SETUP", "1");
    if let Some(lane) = &lane_id {
        command.env("OMP_LANE_ID", lane);
    }
    if let Some(proj) = &project_id {
        command.env("OMP_PROJECT_ID", proj);
    }
    apply_studio_locale(
        &mut command,
        crate::desktop_presence::get_current_locale().as_deref(),
    );
    if let Some(root) = crate::pty::resolve_project_root(&cwd) {
        command.env("OMP_STUDIO_PROJECT_ROOT", root);
    }
    if is_read_only {
        command.env("OMP_AUTOMATION_READONLY", "1");
    }
    if let Some(origin) = &automation_origin {
        command.env("OMP_AUTOMATION_ORIGIN", origin);
    }
    if let Some(roots) = &allowed_roots {
        command.env("OMP_AUTOMATION_ROOTS", roots.join(";"));
    }
    if let Some(max_cost) = max_cost_usd {
        command.env("OMP_AUTOMATION_MAX_COST", max_cost.to_string());
    }
    let owned_pool_path = if prevent_payg.unwrap_or(false) {
        command.env("OMP_AUTOMATION_NO_PAYG", "1");
        let pool_file = prepare_automation_pool_file(rpc_id)?;
        command.env(
            "OMP_AUTH_BROKER_ACCOUNT_POOL_FILE",
            pool_file.to_string_lossy().to_string(),
        );
        Some(pool_file)
    } else {
        None
    };
    let bridge_creds = if !is_read_only {
        if let Some(project) = project_id
            .as_ref()
            .map(|value| value.trim())
            .filter(|value| !value.is_empty())
        {
            crate::lane_bridge::issue_token(crate::lane_bridge::BridgeOwner {
                owner_kind: "agent".to_string(),
                owner_id: rpc_id,
                project_id: Some(project.to_string()),
                lane_id: lane_id.clone().filter(|l| !l.trim().is_empty()),
                cwd: cwd.clone(),
            })
        } else {
            None
        }
    } else {
        None
    };
    if let Some((url, token)) = &bridge_creds {
        command.env("OMP_STUDIO_BRIDGE_URL", url);
        command.env("OMP_STUDIO_BRIDGE_TOKEN", token);
    }
    command
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        // CREATE_NO_WINDOW: senza, ogni sessione GUI farebbe lampeggiare una
        // console.
        command.creation_flags(0x08000000);
    }

    #[cfg(not(target_os = "windows"))]
    {
        let current_path = std::env::var("PATH").unwrap_or_default();
        if let Ok(home) = std::env::var("HOME") {
            command.env(
                "PATH",
                format!(
                    "{}/.bun/bin:{}/.cargo/bin:{}/.local/bin:/opt/homebrew/bin:/usr/local/bin:{}",
                    home, home, home, current_path
                ),
            );
        }
    }
    #[cfg(unix)]
    own_process_group(&mut command);

    let _spawn_span = crate::perf_trace::span(
        "boot",
        crate::perf_trace::command_label(&omp_path, ["--mode", "rpc-ui"]),
    );
    let mut child = match command.spawn() {
        Ok(c) => c,
        Err(error) => {
            let _ = std::fs::remove_file(&overlay_path);
            if bridge_creds.is_some() {
                crate::lane_bridge::revoke_owner("agent", rpc_id);
            }
            crate::studio_log::warn(
                "rpc",
                format!(
                    "avvio di omp fallito rpc={} cwd={}: {}",
                    rpc_id, launch_cwd, error
                ),
            );
            return Err(crate::tr!(
                format!("Avvio di omp in modalita' RPC: {}", error),
                format!("Starting omp in RPC mode: {}", error)
            ));
        }
    };

    let pid = child.id();
    crate::studio_log::info(
        "rpc",
        format!(
            "omp avviato rpc={} pid={} cwd={} resume={}",
            rpc_id,
            pid,
            launch_cwd,
            resume.as_deref().unwrap_or("-")
        ),
    );
    #[cfg(target_os = "windows")]
    let job = match crate::process_tree::WindowsJob::create_for_process(pid) {
        Ok(j) => Some(Arc::new(j)),
        Err(e) => {
            eprintln!("[RPC] Avviso: associazione a Job Object fallita: {}", e);
            None
        }
    };

    let stdin = match child.stdin.take() {
        Some(s) => s,
        None => {
            let _ = std::fs::remove_file(&overlay_path);
            let _ = child.kill();
            return Err(
                crate::tr!("stdin di omp non disponibile", "omp stdin unavailable").to_string(),
            );
        }
    };
    let stdout = match child.stdout.take() {
        Some(s) => s,
        None => {
            let _ = std::fs::remove_file(&overlay_path);
            let _ = child.kill();
            return Err(
                crate::tr!("stdout di omp non disponibile", "omp stdout unavailable").to_string(),
            );
        }
    };
    let stderr = match child.stderr.take() {
        Some(s) => s,
        None => {
            let _ = std::fs::remove_file(&overlay_path);
            let _ = child.kill();
            return Err(
                crate::tr!("stderr di omp non disponibile", "omp stderr unavailable").to_string(),
            );
        }
    };

    let stdin = Arc::new(Mutex::new(Some(stdin)));
    let stderr_tail = Arc::new(Mutex::new(VecDeque::with_capacity(STDERR_TAIL_LINES)));
    let protocol = Arc::new(AtomicU8::new(1));
    let abort_signal = Arc::new(AtomicBool::new(false));
    let child = Arc::new(Mutex::new(child));

    let session_id_slot = Arc::new(Mutex::new(resume.clone()));
    let session_execution_id = execution_id.clone().or_else(|| {
        lane_id.as_ref().and_then(|l| {
            if l.starts_with("auto-") {
                Some(l.trim_start_matches("auto-").to_string())
            } else {
                None
            }
        })
    });
    let adoptable = !is_automation_session && session_execution_id.is_none();
    manager.sessions.lock().insert(
        rpc_id,
        RpcSession {
            child: child.clone(),
            stdin: stdin.clone(),
            stderr_tail: stderr_tail.clone(),
            protocol: protocol.clone(),
            abort_signal: abort_signal.clone(),
            config_path: Some(overlay_path),
            pool_path: owned_pool_path,
            pid: Some(pid),
            #[cfg(target_os = "windows")]
            job,
            killed: Arc::new(AtomicBool::new(false)),
            scope: "main".to_string(),
            prototype_id: None,
            session_id: session_id_slot.clone(),
            cwd: launch_cwd.clone(),
            project_id: project_id.clone(),
            execution_id: session_execution_id,
            stats: stats.clone(),
            hub: hub.clone(),
            lane_id: lane_id.clone(),
            adoptable,
        },
    );
    manager.hand_over_followers(&identity, rpc_id, &hub);

    // Proprieta' della corsia (PLAN W11): la sessione agente e i processi che
    // avvia restano nel proprio Job Object e sono attribuiti alla corsia che
    // li ha chiesti. Le sessioni Laboratorio non appartengono a una corsia e
    // non vengono registrate.
    if let Some(project) = project_id
        .as_ref()
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
    {
        let session = manager.sessions.lock().get(&rpc_id).cloned();
        if let Some(session) = session {
            crate::process_tree::register_lane_process(
                crate::process_tree::LaneProcessRegistration {
                    kind: crate::process_tree::LaneProcessKind::Agent,
                    owner_id: rpc_id,
                    project_id: project.to_string(),
                    lane_id: lane_id.clone().unwrap_or_default(),
                    workspace_root: cwd.clone(),
                    pid: Some(pid),
                    label: crate::tr!("Agente", "Agent").to_string(),
                    control: Arc::new(LaneAgentProcess { rpc_id, session }),
                },
            );
        }
    }

    let sessions = manager.sessions.clone();
    let reader_tail = stderr_tail.clone();
    thread::spawn(move || {
        reader_loop(ReaderLoopArgs {
            stdout,
            hub,
            stdin,
            protocol,
            child,
            stderr_tail: reader_tail,
            sessions,
            rpc_id,
            abort_signal,
            session_id: session_id_slot,
            stats,
        });
    });

    thread::spawn(move || {
        for line in BufReader::new(stderr).lines().map_while(Result::ok) {
            let mut tail = stderr_tail.lock();
            if tail.len() == STDERR_TAIL_LINES {
                tail.pop_front();
            }
            tail.push_back(line);
        }
    });

    Ok(rpc_id)
}

/// Genera il prompt di sistema per l'agente del Laboratorio prototipi,
/// interpolando il percorso assoluto reale del progetto ospite in modo sicuro
/// oppure indicando chiaramente che si tratta di una bozza libera senza progetto.
/// Non prescrive la vecchia logica del selettore varianti, la cui orchestrazione
/// e le cui ricette testuali appartengono all'estensione del Laboratorio.
pub fn build_lab_system_prompt(project_path: Option<&str>) -> String {
    let host_instruction = match project_path.map(str::trim).filter(|s| !s.is_empty()) {
        Some(p) => {
            let quoted = serde_json::to_string(p).unwrap_or_else(|_| format!("\"{p}\""));
            format!(
                "- Write only inside the working directory. The original host project at {quoted} is a read-only reference: study its code and UI to match conventions, terminology and data shapes, never modify it. Shell and interpreters are disabled."
            )
        }
        None => {
            "- Write only inside the working directory. This is a standalone draft prototype without an associated host project: do not search for or access an external project repository. Shell and interpreters are disabled.".to_string()
        }
    };

    format!(
        "You are the OMP Studio Lab agent. You build an interactive frontend prototype (React 19 + TypeScript + Tailwind CSS v4) inside your working directory, a standalone Vite project owned by the Lab.\n\
{host_instruction}\n\
- The entry point is src/main.tsx, which imports ./index.css (starting with @import \"tailwindcss\"). Keep it a valid Vite project that runs with npm install && npm run dev.\n\
- react and react-dom are provided. Any other npm package must be added to package.json \"dependencies\" with an exact version; the preview loads it from esm.sh. Prefer few, well-known packages.\n\
- All data is mocked: no real backends, authentication or credentials.\n\
- The preview recompiles after every file write and Studio shows it live to the user in its Preview tab, next to this chat. After changing files call lab_preview_status and fix every compile or runtime error before you finish. You may open the preview URL it returns with the browser tool to inspect or screenshot the result. That URL is for your tools only: never give it to the user or ask them to open a browser; tell them the result is in the Preview tab.\n\
- When the purpose of the prototype becomes clear or changes, call lab_set_summary with a 2-3 line summary of what it does, in the user's language: the main project agent uses it to find this prototype later.\n\
- Every user request becomes one revision: Studio commits when your turn ends. Never run git.\n\
- A user message may end with a <lab-notes> block from Point/Area in the preview: each numbered entry lists the element's file:line:column (the JSX that rendered it, or the component call site), component, selector, classes and text, plus the user's note; numbers match the boxes in the attached frame. Open those lines first instead of searching, and change the shared component when several instances come from one line unless the note says otherwise.\n\
- Reply in the user's language."
    )
}

/// Avvia una sessione OMP confinata per la corsia Laboratorio prototipi.
///
/// Rispetto alla sessione ordinaria:
/// 1. Il cwd del processo e' il workspace del prototipo;
/// 2. Configurazione isolata per-sessione con shell/eval/mcp disattivati e browser abilitato;
/// 3. Prompt di sistema generato da `build_lab_system_prompt` con il progetto ospite reale;
/// 4. Registrazione in `process_tree` come processo `Agent` della corsia (senza token bridge);
/// 5. Nessun `--no-session` o scope legacy: opera come corsia standard.
#[tauri::command]
// La firma espone i parametri del comando IPC usati dal frontend.
#[allow(clippy::too_many_arguments)]
pub async fn rpc_open_lab(
    workspace_path: String,
    project_path: Option<String>,
    prototype_id: String,
    project_id: Option<String>,
    lane_id: Option<String>,
    resume: Option<String>,
    continue_last: Option<bool>,
    model: Option<String>,
    on_event: Channel<InvokeResponseBody>,
    webview: tauri::Webview,
    manager: State<'_, RpcManager>,
) -> Result<u64, String> {
    open_lab_session(
        &manager,
        OpenLabArgs {
            workspace_path,
            project_path,
            prototype_id,
            project_id,
            lane_id,
            resume,
            continue_last,
            model,
        },
        NewConsumer::channel(on_event, webview.label().to_string()),
    )
}

/// Argomenti di `rpc_open_lab`, con gli stessi nomi della finestra.
#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct OpenLabArgs {
    pub workspace_path: String,
    pub project_path: Option<String>,
    pub prototype_id: String,
    pub project_id: Option<String>,
    pub lane_id: Option<String>,
    pub resume: Option<String>,
    pub continue_last: Option<bool>,
    pub model: Option<String>,
}

pub(crate) fn open_lab_session(
    manager: &RpcManager,
    args: OpenLabArgs,
    consumer: NewConsumer,
) -> Result<u64, String> {
    let _opening = manager.open_gate.lock();
    let OpenLabArgs {
        workspace_path,
        project_path,
        prototype_id,
        project_id,
        lane_id,
        resume,
        continue_last,
        model,
    } = args;
    if !is_valid_prototype_id(&prototype_id) {
        return Err(crate::tr!(
            format!("Id prototipo non valido: {:?}", prototype_id),
            format!("Invalid prototype id: {:?}", prototype_id)
        ));
    }

    let ws_path = std::path::Path::new(&workspace_path);
    if !ws_path.is_dir() {
        return Err(crate::tr!(
            format!(
                "Directory del workspace inesistente per la sessione Laboratorio: {}",
                workspace_path
            ),
            format!(
                "Workspace directory does not exist for the Lab session: {}",
                workspace_path
            )
        ));
    }
    let canonical_ws = crate::lab::paths::strip_unc_prefix(
        ws_path
            .canonicalize()
            .unwrap_or_else(|_| ws_path.to_path_buf()),
    );
    let resolved_ws_str = canonical_ws.to_string_lossy().to_string();
    let wanted_project_id = project_id
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty());
    let wanted_lane_id = lane_id.as_deref().map(str::trim).filter(|s| !s.is_empty());
    let key = AdoptionKey {
        scope: "lane",
        cwd: &resolved_ws_str,
        project_id: wanted_project_id,
        lane_id: wanted_lane_id,
        prototype_id: Some(&prototype_id),
        resume: resume.as_deref().filter(|id| !id.is_empty()),
    };
    let identity = key.identity();
    let consumer = if !model.as_deref().is_some_and(|m| !m.trim().is_empty()) {
        match adopt_session(manager, &key, consumer) {
            Ok(adopted) => return adopted,
            Err(consumer) => consumer,
        }
    } else {
        consumer
    };
    let stats = Arc::new(RpcStats::default());
    let hub = Arc::new(SessionHub::new());
    hub.attach(
        (consumer.make_sink)(stats.clone()),
        Some(consumer.owner),
        Resume::Fresh,
    )?;

    let clean_project_path = project_path
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or("");
    let canonical_project_path = if !clean_project_path.is_empty() {
        let p = std::path::Path::new(clean_project_path);
        if !p.is_dir() {
            return Err(crate::tr!(
                format!(
                    "Directory di progetto inesistente per la sessione Laboratorio: {}",
                    clean_project_path
                ),
                format!(
                    "Project directory does not exist for the Lab session: {}",
                    clean_project_path
                )
            ));
        }
        let canon = crate::lab::paths::strip_unc_prefix(
            p.canonicalize().unwrap_or_else(|_| p.to_path_buf()),
        );
        Some(canon.to_string_lossy().to_string())
    } else {
        None
    };

    let omp_path = crate::omp_ops::get_omp_binary();
    let lab_extension =
        crate::pty::write_extension("studio-lab.ts", LAB_EXTENSION_TS).ok_or_else(|| {
            crate::tr!(
                "Impossibile preparare l'estensione del Laboratorio (studio-lab.ts)",
                "Unable to prepare the Lab extension (studio-lab.ts)"
            )
            .to_string()
        })?;
    let plan_extension =
        crate::pty::write_extension("studio-plan.ts", crate::pty::PLAN_EXTENSION_TS).ok_or_else(
            || {
                crate::tr!(
                    "Impossibile preparare l'estensione del Piano (studio-plan.ts)",
                    "Unable to prepare the Plan extension (studio-plan.ts)"
                )
                .to_string()
            },
        )?;
    let lanes_extension =
        crate::pty::write_extension("studio-lanes.ts", crate::pty::LANES_EXTENSION_TS);
    let ask_extension =
        crate::pty::write_extension("studio-ask.ts", crate::pty::ASK_EXTENSION_TS);

    let rpc_id = {
        let mut guard = manager.next_id.lock();
        let id = *guard;
        *guard += 1;
        id
    };

    let lab_config_path = write_lab_session_config(
        rpc_id,
        &prototype_id,
        Some(&lab_extension),
        Some(&plan_extension),
        lanes_extension.as_deref(),
    )?;

    let mut command = Command::new(&omp_path);
    command.arg("--mode").arg("rpc-ui");
    command.arg("--cwd").arg(&resolved_ws_str);
    command.arg("--config").arg(&lab_config_path);

    let lab_prompt = build_lab_system_prompt(canonical_project_path.as_deref());
    let lab_system_prompt = format!("{}\n\n{}", crate::pty::STUDIO_SYSTEM_PROMPT, lab_prompt);
    command
        .arg("--append-system-prompt")
        .arg(&lab_system_prompt);

    command.arg("-e").arg(&lab_extension);
    command.arg("-e").arg(&plan_extension);
    if let Some(path) = &lanes_extension {
        command.arg("-e").arg(path);
    }
    if let Some(path) = &ask_extension {
        command.arg("-e").arg(path);
    }
    let mut session_args = Vec::new();
    apply_resume_or_continue(
        &mut session_args,
        resume.as_deref(),
        continue_last.unwrap_or(false),
        crate::omp_ops::session_transcript_exists,
    );
    for arg in session_args {
        command.arg(arg);
    }
    if let Some(m) = model.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        command.arg("--model").arg(m);
    }

    let effective_lane_id = lane_id
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or("");
    let effective_project_id = project_id
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or("");

    let effective_project_path = canonical_project_path.as_deref().unwrap_or("");

    command
        .current_dir(&resolved_ws_str)
        .env("OMP_STUDIO", "1")
        .env("OMP_STUDIO_PLAN", "gui")
        .env("OMP_STUDIO_ASK", "1")
        .env("OMP_SKIP_SETUP", "1")
        .env("OMP_LAB_SESSION", "1")
        .env("OMP_LAB_WORKSPACE", &resolved_ws_str)
        .env("OMP_LAB_PROJECT_PATH", effective_project_path)
        .env("OMP_LAB_PROTOTYPE_ID", &prototype_id)
        .env("OMP_LANE_ID", effective_lane_id)
        .env("OMP_PROJECT_ID", effective_project_id)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    apply_studio_locale(
        &mut command,
        crate::desktop_presence::get_current_locale().as_deref(),
    );

    // Token del bridge solo per un prototipo di progetto: la bozza libera non
    // ha una corsia da segnare come finita. Il proprietario dentro una corsia
    // puo' chiamare soltanto `fatto` e `stato` (vedi `lane_bridge::authorize`).
    let lab_bridge = if !effective_project_id.is_empty() && !effective_lane_id.is_empty() {
        crate::lane_bridge::issue_token(crate::lane_bridge::BridgeOwner {
            owner_kind: "agent".to_string(),
            owner_id: rpc_id,
            project_id: Some(effective_project_id.to_string()),
            lane_id: Some(effective_lane_id.to_string()),
            cwd: resolved_ws_str.clone(),
        })
    } else {
        None
    };
    if let Some((url, token)) = &lab_bridge {
        command.env("OMP_STUDIO_BRIDGE_URL", url);
        command.env("OMP_STUDIO_BRIDGE_TOKEN", token);
    }

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }

    #[cfg(not(target_os = "windows"))]
    {
        let current_path = std::env::var("PATH").unwrap_or_default();
        if let Ok(home) = std::env::var("HOME") {
            command.env(
                "PATH",
                format!(
                    "{}/.bun/bin:{}/.cargo/bin:{}/.local/bin:/opt/homebrew/bin:/usr/local/bin:{}",
                    home, home, home, current_path
                ),
            );
        }
    }
    #[cfg(unix)]
    own_process_group(&mut command);

    let mut child = match command.spawn() {
        Ok(child) => child,
        Err(error) => {
            let _ = std::fs::remove_file(&lab_config_path);
            if lab_bridge.is_some() {
                crate::lane_bridge::revoke_owner("agent", rpc_id);
            }
            crate::studio_log::warn(
                "rpc",
                format!("avvio di omp Laboratorio fallito rpc={}: {}", rpc_id, error),
            );
            return Err(crate::tr!(
                format!("Avvio di omp per sessione Laboratorio: {}", error),
                format!("Starting omp for the Lab session: {}", error)
            ));
        }
    };

    let pid = child.id();
    crate::studio_log::info(
        "rpc",
        format!(
            "omp Laboratorio avviato rpc={} pid={} cwd={}",
            rpc_id, pid, workspace_path
        ),
    );
    #[cfg(target_os = "windows")]
    let job = match crate::process_tree::WindowsJob::create_for_process(pid) {
        Ok(j) => Some(Arc::new(j)),
        Err(e) => {
            eprintln!("[RPC-Lab] Avviso: associazione a Job Object fallita: {}", e);
            None
        }
    };

    let stdin = match child.stdin.take() {
        Some(s) => s,
        None => {
            let _ = std::fs::remove_file(&lab_config_path);
            let _ = child.kill();
            return Err(
                crate::tr!("stdin di omp non disponibile", "omp stdin unavailable").to_string(),
            );
        }
    };
    let stdout = match child.stdout.take() {
        Some(s) => s,
        None => {
            let _ = std::fs::remove_file(&lab_config_path);
            let _ = child.kill();
            return Err(
                crate::tr!("stdout di omp non disponibile", "omp stdout unavailable").to_string(),
            );
        }
    };
    let stderr = match child.stderr.take() {
        Some(s) => s,
        None => {
            let _ = std::fs::remove_file(&lab_config_path);
            let _ = child.kill();
            return Err(
                crate::tr!("stderr di omp non disponibile", "omp stderr unavailable").to_string(),
            );
        }
    };

    let stdin = Arc::new(Mutex::new(Some(stdin)));
    let stderr_tail = Arc::new(Mutex::new(VecDeque::with_capacity(STDERR_TAIL_LINES)));
    let protocol = Arc::new(AtomicU8::new(1));
    let abort_signal = Arc::new(AtomicBool::new(false));
    let child = Arc::new(Mutex::new(child));

    let session_id_slot = Arc::new(Mutex::new(resume.clone()));
    let session = RpcSession {
        child: child.clone(),
        stdin: stdin.clone(),
        stderr_tail: stderr_tail.clone(),
        protocol: protocol.clone(),
        abort_signal: abort_signal.clone(),
        config_path: Some(lab_config_path),
        pool_path: None,
        pid: Some(pid),
        #[cfg(target_os = "windows")]
        job,
        killed: Arc::new(AtomicBool::new(false)),
        scope: "lane".to_string(),
        prototype_id: Some(prototype_id.clone()),
        session_id: session_id_slot.clone(),
        cwd: resolved_ws_str.clone(),
        project_id: if effective_project_id.is_empty() {
            None
        } else {
            Some(effective_project_id.to_string())
        },
        execution_id: None,
        stats: stats.clone(),
        hub: hub.clone(),
        lane_id: wanted_lane_id.map(str::to_string),
        adoptable: true,
    };

    manager.sessions.lock().insert(rpc_id, session.clone());
    manager.hand_over_followers(&identity, rpc_id, &hub);

    if !effective_project_id.is_empty() {
        crate::process_tree::register_lane_process(crate::process_tree::LaneProcessRegistration {
            kind: crate::process_tree::LaneProcessKind::Agent,
            owner_id: rpc_id,
            project_id: effective_project_id.to_string(),
            lane_id: effective_lane_id.to_string(),
            workspace_root: workspace_path.clone(),
            pid: Some(pid),
            label: crate::tr!("Agente Lab", "Lab agent").to_string(),
            control: Arc::new(LaneAgentProcess { rpc_id, session }),
        });
    }

    let sessions = manager.sessions.clone();
    let reader_tail = stderr_tail.clone();
    thread::spawn(move || {
        reader_loop(ReaderLoopArgs {
            stdout,
            hub,
            stdin,
            protocol,
            child,
            stderr_tail: reader_tail,
            sessions,
            rpc_id,
            abort_signal,
            session_id: session_id_slot,
            stats,
        });
    });

    thread::spawn(move || {
        for line in BufReader::new(stderr).lines().map_while(Result::ok) {
            let mut tail = stderr_tail.lock();
            if tail.len() == STDERR_TAIL_LINES {
                tail.pop_front();
            }
            tail.push_back(line);
        }
    });

    Ok(rpc_id)
}

#[tauri::command]
pub async fn rpc_send(
    rpc_id: u64,
    line: String,
    manager: State<'_, RpcManager>,
) -> Result<(), serde_json::Value> {
    let (stdin, abort_signal, stats, cwd, execution_id, project_id, hub) = {
        let sessions = manager.sessions.lock();
        let session = sessions.get(&rpc_id).ok_or_else(|| session_missing(rpc_id))?;
        (
            session.stdin.clone(),
            session.abort_signal.clone(),
            session.stats.clone(),
            session.cwd.clone(),
            session.execution_id.clone(),
            session.project_id.clone(),
            session.hub.clone(),
        )
    };

    // Risoluzione canonical root (AUT-042): previene il bypass di lock nei worktree
    let canonical_root = project_id
        .as_deref()
        .and_then(crate::automations::project_path_for_id)
        .unwrap_or_else(|| cwd.clone());

    let command = serde_json::from_str::<serde_json::Value>(&line)
        .map_err(|error| format!("Invalid RPC command: {error}"))?;
    let command_type = command.get("type").and_then(serde_json::Value::as_str);
    if matches!(command_type, Some("abort" | "abort_bash")) {
        abort_signal.store(true, Ordering::SeqCst);
    }

    // Il JSON puo' contenere spazi: l'ammissione dipende dal tipo, non dalla
    // serializzazione scelta dal chiamante.
    let is_prompt_or_retry = matches!(command_type, Some("prompt" | "retry"));
    let is_ui_response = command_type == Some("extension_ui_response");
    let answer_id = if is_ui_response {
        Some(command.get("id").and_then(serde_json::Value::as_str)
            .ok_or_else(|| "RPC UI response requires an id".to_string())?)
    } else {
        None
    };
    let send = || {
    let mut auto_admitted_eid: Option<String> = None;

    if (is_prompt_or_retry || is_ui_response) && !canonical_root.is_empty() {
        if let Some(eid) = &execution_id {
            // Rifiuta prompt e retry su esecuzioni ormai terminali (nessuna continuazione fuori dallo scheduler)
            if crate::automations::is_execution_terminal(eid) {
                return Err(crate::tr!(
                    format!(
                        "Esecuzione '{}' già conclusa: continuazione non consentita fuori dallo scheduler.",
                        eid
                    ),
                    format!(
                        "Execution '{}' already finished: continuation outside the scheduler is not allowed.",
                        eid
                    )
                ));
            }

            // Se l'automazione era in needsInput, riacquisisce slot AI e quota prima dell'invio wire
            let admitted = crate::automations::resume_admission(eid)?;
            if !admitted {
                return Err(crate::tr!(
                    "Slot AI attualmente occupato o quota insufficiente. Risposta conservata, riprova a breve.",
                    "AI slot currently busy or quota insufficient. The answer is kept, retry shortly."
                )
                .to_string());
            }
            auto_admitted_eid = Some(eid.clone());

            // Verifica che il progetto non sia conteso da un'altra automazione sulla canonical root
            if crate::automations::is_project_locked(&canonical_root, Some(eid)) {
                let _ = crate::automations::resume_release(eid);
                return Err(crate::tr!(
                    format!(
                        "Progetto '{}' occupato da un'altra automazione attiva (AUT-042)",
                        canonical_root
                    ),
                    format!(
                        "Project '{}' is busy with another running automation (AUT-042)",
                        canonical_root
                    )
                ));
            }
        } else if is_prompt_or_retry {
            // Sessione interattiva: richiede interactive_admission sulla canonical root
            crate::automations::interactive_admission(&canonical_root)?;
        }
    }

    // L'attesa del lock conta come scrittura in corso: se una scrittura
    // precedente e' ferma perche' omp non legge, anche questa lo e'.
    stats.stdin_write_started();
    let result = {
        let mut guard = stdin.lock();
        match guard.as_mut() {
            Some(handle) => handle
                .write_all(line.as_bytes())
                .and_then(|()| handle.write_all(b"\n"))
                .and_then(|()| handle.flush())
                .map_err(|error| {
                    crate::tr!(
                        format!("Scrittura sulla sessione RPC {}: {}", rpc_id, error),
                        format!("Writing to RPC session {}: {}", rpc_id, error)
                    )
                }),
            None => Err(crate::tr!(
                format!("Sessione RPC {} in chiusura", rpc_id),
                format!("RPC session {} is closing", rpc_id)
            )),
        }
    };
    stats.stdin_write_finished();
    if result.is_err() {
        if let Some(eid) = &auto_admitted_eid {
            let _ = crate::automations::resume_release(eid);
        } else if is_prompt_or_retry && execution_id.is_none() && !canonical_root.is_empty() {
            crate::automations::release_interactive_admission(&canonical_root);
        }
    }
    result
    };
    if let Some(id) = answer_id {
        hub.answer_ui_request(id, send)
    } else {
        send().map_err(serde_json::Value::String)
    }
}

/// Libera l'ammissione interattiva e i file temporanei di una sessione gia'
/// tolta dalla mappa.
fn release_removed_session(session: &RpcSession) {
    let canonical_root = session
        .project_id
        .as_deref()
        .and_then(crate::automations::project_path_for_id)
        .unwrap_or_else(|| session.cwd.clone());
    if session.execution_id.is_none() && !canonical_root.is_empty() {
        crate::automations::release_interactive_admission(&canonical_root);
    }
    session.remove_config_file();
}

/// Bloccante: chiude stdin, attende l'uscita di omp fino a tre secondi e
/// abbatte l'albero.
fn shutdown_removed_session(session: &RpcSession) {
    // Chiudere stdin e' la via documentata: omp drena i comandi accettati,
    // dispone la sessione ed esce con codice 0. Il kill resta l'ultima
    // risorsa, non la prima.
    session.stdin.lock().take();
    let deadline = Instant::now() + Duration::from_secs(3);
    loop {
        if let Ok(Some(_)) = session.child.lock().try_wait() {
            break;
        }
        if Instant::now() >= deadline {
            break;
        }
        thread::sleep(Duration::from_millis(50));
    }
    // Con il process group proprio i figli di omp non ricevono piu' segnali
    // dal terminale di Studio: si abbatte l'albero intero, non solo omp.
    // Anche dopo un'uscita pulita di omp: un server avviato in background
    // dall'agente resta nel gruppo e va chiuso con la chat.
    session.kill_tree();
}

fn stop_removed_session(session: RpcSession) {
    release_removed_session(&session);
    shutdown_removed_session(&session);
}

#[tauri::command]
pub async fn rpc_close(
    rpc_id: u64,
    replacing: Option<bool>,
    webview: tauri::Webview,
    manager: State<'_, RpcManager>,
) -> Result<(), String> {
    close_session(&manager, rpc_id, webview.label(), replacing.unwrap_or(false)).await
}

/// Chiusura chiesta da una finestra o da un'istanza collegata: con altri
/// consumatori iscritti la sessione resta viva per loro (R-MI-07).
pub(crate) async fn close_session(
    manager: &RpcManager,
    rpc_id: u64,
    closer: &str,
    replacing: bool,
) -> Result<(), String> {
    match manager.close_for(rpc_id, closer, replacing) {
        CloseOutcome::Detached => Ok(()),
        CloseOutcome::Missing => {
            crate::lane_bridge::revoke_owner("agent", rpc_id);
            Ok(())
        }
        CloseOutcome::Closing(session) => {
            crate::lane_bridge::revoke_owner("agent", rpc_id);
            stop_session_async(rpc_id, *session).await
        }
    }
}

async fn stop_session_async(rpc_id: u64, session: RpcSession) -> Result<(), String> {
    release_removed_session(&session);
    tokio::task::spawn_blocking(move || shutdown_removed_session(&session))
        .await
        .map_err(|error| {
            crate::tr!(
                format!("Chiusura della sessione RPC {}: {}", rpc_id, error),
                format!("Closing RPC session {}: {}", rpc_id, error)
            )
        })
}

/// Chiude la sessione chiunque la segua: automazioni e arresti espliciti.
async fn force_close_session(manager: &RpcManager, rpc_id: u64) -> Result<(), String> {
    crate::lane_bridge::revoke_owner("agent", rpc_id);
    let Some(session) = manager.sessions.lock().remove(&rpc_id) else {
        return Ok(());
    };
    stop_session_async(rpc_id, session).await
}

/// Chiude tutte le sessioni RPC di automazione orfane o aperte da host precedenti.
#[tauri::command]
pub async fn rpc_cleanup_automation_sessions(
    manager: State<'_, RpcManager>,
) -> Result<usize, String> {
    let ids: Vec<u64> = {
        let sessions = manager.sessions.lock();
        sessions
            .iter()
            .filter(|(_, s)| s.execution_id.is_some())
            .map(|(id, _)| *id)
            .collect()
    };
    let count = ids.len();
    for id in ids {
        let _ = force_close_session(&manager, id).await;
    }
    Ok(count)
}

/// Chiude selettivamente la sessione RPC di una specifica esecuzione AI.
/// Usato da NativeCore (engine::cancel, timeout, shutdown) prima di rilasciare i lock.
pub fn close_automation_execution(app: &tauri::AppHandle, execution_id: &str) -> bool {
    use tauri::Manager;
    let manager = app.state::<RpcManager>();
    let rpc_id = {
        let sessions = manager.sessions.lock();
        sessions
            .iter()
            .find(|(_, s)| s.execution_id.as_deref() == Some(execution_id))
            .map(|(id, _)| *id)
    };
    if let Some(id) = rpc_id {
        let session = manager.sessions.lock().remove(&id);
        if let Some(session) = session {
            session.kill_tree();
            if let Some(config_file) = session.config_path.as_ref() {
                let _ = std::fs::remove_file(config_file);
            }
            if let Some(pool_file) = session.pool_path.as_ref() {
                let _ = std::fs::remove_file(pool_file);
            }
            crate::lane_bridge::revoke_owner("agent", id);
            return true;
        }
    }
    false
}

/// Abilita o disabilita il prewalk per una sessione RPC attiva, riscrivendo
/// in modo atomico il file di configurazione overlay per-sessione e preservando
/// i parametri base (tools.approvalMode: yolo, read.defaultLimit: 1200).
/// `into`/`from` sono la destinazione e la ripartenza scelte per la sessione.
/// Rifiuta l'operazione su sessioni del Laboratorio prototipi.
#[tauri::command]
pub async fn rpc_set_prewalk(
    rpc_id: u64,
    enabled: bool,
    into: Option<String>,
    from: Option<String>,
    manager: State<'_, RpcManager>,
) -> Result<(), String> {
    let sessions = Arc::clone(&manager.sessions);
    // La scrittura atomica (con i suoi retry) gira nel pool bloccante, non su un
    // worker async. Il lock resta preso fino alla fine: la chiusura della sessione
    // non puo' cancellare l'overlay fra lettura del percorso e scrittura.
    tokio::task::spawn_blocking(move || {
        let guard = sessions.lock();
        let session = guard.get(&rpc_id).ok_or_else(|| {
            crate::tr!(
                format!("Sessione RPC {} non trovata", rpc_id),
                format!("RPC session {} not found", rpc_id)
            )
        })?;
        if session.scope == "lab" || session.prototype_id.is_some() {
            return Err(crate::tr!(
                "Prewalk non supportato per sessioni Laboratorio",
                "Prewalk is not supported for Lab sessions"
            )
            .to_string());
        }
        let config_path = session.config_path.as_ref().ok_or_else(|| {
            crate::tr!(
                format!(
                    "Nessun file di configurazione per la sessione RPC {}",
                    rpc_id
                ),
                format!("No configuration file for RPC session {}", rpc_id)
            )
        })?;
        set_gui_overlay_prewalk(config_path, enabled, &PrewalkTargets { into, from })
    })
    .await
    .map_err(|error| {
        crate::tr!(
            format!("Scrittura prewalk fallita nel thread di I/O: {}", error),
            format!("Prewalk write failed in the I/O thread: {}", error)
        )
    })?
}

/// Interrompe la sessione RPC specificata in modo atomico, senza toccare le altre sessioni.
#[tauri::command]
pub async fn rpc_abort(rpc_id: u64, manager: State<'_, RpcManager>) -> Result<(), String> {
    let (stdin, abort_signal) = {
        let sessions = manager.sessions.lock();
        let session = sessions.get(&rpc_id).ok_or_else(|| {
            crate::tr!(
                format!("Sessione RPC {} non disponibile", rpc_id),
                format!("RPC session {} not available", rpc_id)
            )
        })?;
        (session.stdin.clone(), session.abort_signal.clone())
    };

    abort_signal.store(true, Ordering::SeqCst);
    let mut guard = stdin.lock();
    let handle = guard.as_mut().ok_or_else(|| {
        crate::tr!(
            format!("Sessione RPC {} in chiusura", rpc_id),
            format!("RPC session {} is closing", rpc_id)
        )
    })?;

    handle
        .write_all(b"{\"id\":\"abort-direct-1\",\"type\":\"abort\"}\n")
        .and_then(|()| handle.write_all(b"{\"id\":\"abort-direct-2\",\"type\":\"abort_bash\"}\n"))
        .and_then(|()| handle.flush())
        .map_err(|error| {
            crate::tr!(
                format!("Invio abort sulla sessione RPC {}: {}", rpc_id, error),
                format!("Sending abort on RPC session {}: {}", rpc_id, error)
            )
        })
}

/// Termina forzatamente la sessione RPC e l'intero albero dei processi figli (SIGKILL/taskkill).
#[tauri::command]
pub async fn rpc_force_kill(rpc_id: u64, manager: State<'_, RpcManager>) -> Result<(), String> {
    crate::lane_bridge::revoke_owner("agent", rpc_id);
    let session = manager.sessions.lock().get(&rpc_id).cloned();
    let session = session.ok_or_else(|| {
        crate::tr!(
            format!("Sessione RPC {} non disponibile", rpc_id),
            format!("RPC session {} not available", rpc_id)
        )
    })?;
    tokio::task::spawn_blocking(move || {
        session.kill_tree();
    })
    .await
    .map_err(|error| {
        crate::tr!(
            format!("Terminazione forzata sessione RPC {}: {}", rpc_id, error),
            format!("Forced termination of RPC session {}: {}", rpc_id, error)
        )
    })
}

/// Termina forzatamente una sessione agente (RPC o PTY) e il relativo albero di processi figli (SIGKILL / Job Object / taskkill).
#[tauri::command]
pub async fn force_kill_session(
    rpc_id: Option<u64>,
    pty_id: Option<u64>,
    rpc_manager: State<'_, RpcManager>,
    pty_manager: State<'_, crate::pty::PtyManager>,
) -> Result<(), String> {
    if let Some(id) = rpc_id {
        return rpc_force_kill(id, rpc_manager).await;
    }
    if let Some(id) = pty_id {
        return crate::pty::pty_force_kill(id, pty_manager).await;
    }
    Err(crate::tr!(
        "Specificare rpc_id o pty_id per force_kill_session",
        "Specify rpc_id or pty_id for force_kill_session"
    )
    .to_string())
}

/// Fotografia del trasporto di una sessione viva, per il rapporto di blocco
/// che il frontend scrive quando un comando resta senza risposta. Arriva per
/// `invoke`, non per il Channel della sessione: deve funzionare proprio
/// quando quel Channel e' fermo.
#[tauri::command]
pub async fn rpc_diagnostics(
    rpc_id: u64,
    manager: State<'_, RpcManager>,
) -> Result<serde_json::Value, String> {
    let session = manager
        .sessions
        .lock()
        .get(&rpc_id)
        .cloned()
        .ok_or_else(|| {
            crate::tr!(
                format!("Sessione RPC {} non disponibile", rpc_id),
                format!("RPC session {} not available", rpc_id)
            )
        })?;
    let child_alive = session
        .child
        .lock()
        .try_wait()
        .ok()
        .map(|status| status.is_none());

    // Due campioni del Job Object: CPU consumata dall'albero di omp nel
    // mezzo secondo, e processi ancora attivi (omp piu' eventuali tool).
    #[cfg(target_os = "windows")]
    let process_tree = match session.job.clone() {
        Some(job) => {
            let first = job.accounting();
            tokio::time::sleep(Duration::from_millis(500)).await;
            match (first, job.accounting()) {
                (Some((before, _)), Some((after, active))) => serde_json::json!({
                    "cpuMsInLast500ms": after.saturating_sub(before) / 10_000,
                    "totalCpuMs": after / 10_000,
                    "activeProcesses": active,
                }),
                _ => serde_json::Value::Null,
            }
        }
        None => serde_json::Value::Null,
    };
    #[cfg(not(target_os = "windows"))]
    let process_tree = serde_json::Value::Null;

    let stderr_tail: Vec<String> = {
        let tail = session.stderr_tail.lock();
        tail.iter()
            .skip(tail.len().saturating_sub(40))
            .cloned()
            .collect()
    };
    Ok(serde_json::json!({
        "rpcId": rpc_id,
        "pid": session.pid,
        "childAlive": child_alive,
        "killed": session.killed.load(Ordering::Relaxed),
        "protocol": session.protocol.load(Ordering::Relaxed),
        "sessionId": session.session_id.lock().clone(),
        "transport": session.stats.snapshot(),
        "processTree": process_tree,
        "stderrTail": stderr_tail,
    }))
}

/// Scrive il rapporto di blocco nella cartella dei log e ne restituisce il
/// percorso, da mostrare all'utente.
#[tauri::command]
pub async fn rpc_write_hang_report(
    report: String,
    app: tauri::AppHandle,
) -> Result<String, String> {
    use tauri::Manager;
    let dir = app
        .path()
        .app_log_dir()
        .map_err(|error| error.to_string())?;
    let path =
        diag::write_hang_report(&dir, &report).map(|path| path.to_string_lossy().into_owned());
    if let Ok(path) = &path {
        crate::studio_log::warn("rpc", format!("comando senza risposta, rapporto {}", path));
    }
    path
}

#[cfg(test)]
mod tests {
    use super::*;

    fn chunk(
        chunk_id: &str,
        index: usize,
        count: usize,
        byte_length: usize,
        payload: &str,
    ) -> String {
        format!(
            r#"{{"type":"rpc_chunk","chunkId":"{}","index":{},"count":{},"byteLength":{},"data":"{}"}}"#,
            chunk_id,
            index,
            count,
            byte_length,
            base64::engine::general_purpose::STANDARD.encode(payload)
        )
    }

    #[test]
    fn riassembla_una_sequenza_completa() {
        let mut assembly = None;
        let logical = r#"{"type":"response","command":"get_state"}"#;
        let (head, tail) = logical.split_at(20);
        assert_eq!(
            reassemble(&chunk("c1", 0, 2, logical.len(), head), &mut assembly),
            Ok(None)
        );
        assert_eq!(
            reassemble(&chunk("c1", 1, 2, logical.len(), tail), &mut assembly),
            Ok(Some(logical.to_string()))
        );
        assert!(assembly.is_none());
    }

    #[test]
    fn rifiuta_una_sequenza_interlacciata() {
        let mut assembly = None;
        let _ = reassemble(&chunk("c1", 0, 2, 10, "0123456789"), &mut assembly);
        assert!(reassemble(&chunk("c2", 1, 2, 10, "0123456789"), &mut assembly).is_err());
    }

    #[test]
    fn recupera_sequenza_nuova_dopo_interruzione() {
        let mut assembly = None;
        let _ = reassemble(&chunk("c1", 0, 2, 10, "0123456789"), &mut assembly);
        let logical = r#"{"type":"response","command":"abort"}"#;
        assert_eq!(
            reassemble(&chunk("c2", 0, 1, logical.len(), logical), &mut assembly),
            Ok(Some(logical.to_string()))
        );
        assert!(assembly.is_none());
    }

    #[test]
    fn rifiuta_un_indice_fuori_ordine() {
        let mut assembly = None;
        assert!(reassemble(&chunk("c1", 1, 2, 10, "0123456789"), &mut assembly).is_err());
    }

    #[test]
    fn rifiuta_una_lunghezza_dichiarata_diversa() {
        let mut assembly = None;
        assert!(reassemble(&chunk("c1", 0, 1, 99, "0123456789"), &mut assembly).is_err());
    }

    #[test]
    fn coniazione_del_frame_di_delta() {
        let buffer = DeltaBuffer {
            kind: "text",
            content_index: 3,
            text: "riga \"citata\"\n".to_string(),
            since: Instant::now(),
        };
        assert_eq!(
            buffer.into_frame(),
            r#"{"type":"studio_delta","kind":"text","contentIndex":3,"delta":"riga \"citata\"\n"}"#
        );
    }

    #[test]
    fn la_lingua_della_sessione_entra_nell_env_e_quella_vuota_no() {
        let mut with_locale = Command::new("omp");
        apply_studio_locale(&mut with_locale, Some("it"));
        let locale: Vec<_> = with_locale
            .get_envs()
            .filter(|(key, _)| *key == "OMP_STUDIO_LOCALE")
            .collect();
        assert_eq!(locale.len(), 1);
        assert_eq!(locale[0].1, Some(std::ffi::OsStr::new("it")));

        let mut absent = Command::new("omp");
        apply_studio_locale(&mut absent, None);
        apply_studio_locale(&mut absent, Some("  "));
        assert!(absent
            .get_envs()
            .all(|(key, _)| key != "OMP_STUDIO_LOCALE"));
    }

    #[test]
    fn validazione_id_prototipo_laboratorio() {
        assert!(is_valid_prototype_id("prototype-1"));
        assert!(is_valid_prototype_id("test-proto-abc"));
        assert!(is_valid_prototype_id("comp3-variant"));
        assert!(is_valid_prototype_id("a1"));

        // Rifiutati
        assert!(!is_valid_prototype_id(""));
        assert!(!is_valid_prototype_id("a"));
        assert!(!is_valid_prototype_id("UpperCase"));
        assert!(!is_valid_prototype_id("proto_with_underscore"));
        assert!(!is_valid_prototype_id("-starts-with-hyphen"));
        assert!(!is_valid_prototype_id("ends-with-hyphen-"));
        assert!(!is_valid_prototype_id("con"));
        assert!(!is_valid_prototype_id("nul"));
        assert!(!is_valid_prototype_id("com1"));
    }

    #[test]
    fn configurazione_laboratorio_disattiva_tool_e_non_ha_yolo() {
        let config_path = write_lab_session_config(
            999,
            "test-proto-config",
            Some("C:/test/extensions/studio-lab.ts"),
            Some("C:/test/extensions/studio-plan.ts"),
            Some("C:/test/extensions/studio-lanes.ts"),
        )
        .expect("scrittura configurazione riuscita");

        assert!(config_path.exists());
        let content = std::fs::read_to_string(&config_path).expect("lettura file riuscita");

        // Verifica tool disattivati
        assert!(content.contains("bash:\n  enabled: false"));
        assert!(content.contains("eval:\n  py: false"));
        assert!(content.contains("browser:\n  enabled: true"));
        assert!(content.contains("mcp:\n  enableProjectConfig: false"));
        assert!(content.contains("tools:\n  xdev: false"));
        assert!(content.contains("ask:\n  timeout: 0"));

        // Verifica estensione caricata
        assert!(content.contains("extensions:"));
        assert!(content.contains("C:/test/extensions/studio-lab.ts"));
        // Il piano e le corsie entrano solo dopo l'estensione confinata, che ne filtra i tool
        let lab_at = content.find("studio-lab.ts").unwrap();
        let plan_at = content
            .find("studio-plan.ts")
            .expect("estensione piano caricata");
        let lanes_at = content
            .find("studio-lanes.ts")
            .expect("estensione corsie caricata");
        assert!(plan_at > lab_at);
        assert!(lanes_at > plan_at);

        // Invariante vincolante: NESSUN overlay yolo
        assert!(!content.contains("approvalMode: yolo"));
        assert!(!content.contains("yolo"));

        // Pulizia
        let _ = std::fs::remove_file(config_path);
    }

    type ChannelLog = Arc<Mutex<Vec<String>>>;

    fn channel_di_prova() -> (Channel<InvokeResponseBody>, ChannelLog) {
        let log: ChannelLog = Arc::new(Mutex::new(Vec::new()));
        let sink = log.clone();
        let channel = Channel::new(move |body| {
            if let InvokeResponseBody::Json(frame) = body {
                sink.lock().push(frame);
            }
            Ok(())
        });
        (channel, log)
    }

    /// Sessione GUI con un processo vero ma innocuo al posto di omp.
    fn sessione_di_prova(lane: &str, session_id: &str, adoptable: bool) -> RpcSession {
        let child = Command::new("git")
            .arg("--version")
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .expect("git disponibile nei test");
        RpcSession {
            child: Arc::new(Mutex::new(child)),
            stdin: Arc::new(Mutex::new(None)),
            stderr_tail: Arc::new(Mutex::new(VecDeque::new())),
            protocol: Arc::new(AtomicU8::new(2)),
            abort_signal: Arc::new(AtomicBool::new(false)),
            config_path: None,
            pool_path: None,
            pid: None,
            #[cfg(target_os = "windows")]
            job: None,
            killed: Arc::new(AtomicBool::new(false)),
            scope: "main".to_string(),
            prototype_id: None,
            session_id: Arc::new(Mutex::new(Some(session_id.to_string()))),
            cwd: "/work/site".to_string(),
            execution_id: None,
            project_id: Some("site".to_string()),
            stats: Arc::new(RpcStats::default()),
            hub: Arc::new(SessionHub::new()),
            lane_id: Some(lane.to_string()),
            adoptable,
        }
    }

    fn chiave<'a>(lane: &'a str, resume: Option<&'a str>) -> AdoptionKey<'a> {
        AdoptionKey {
            scope: "main",
            cwd: "/work/site",
            project_id: Some("site"),
            lane_id: Some(lane),
            prototype_id: None,
            resume,
        }
    }

    fn adopt_orphan(
        manager: &RpcManager,
        key: &AdoptionKey,
        channel: &Channel<InvokeResponseBody>,
        owner: &str,
    ) -> Option<Result<u64, String>> {
        adopt_session(
            manager,
            key,
            NewConsumer::channel(channel.clone(), owner.to_string()),
        )
        .ok()
    }

    /// Un'altra finestra (o istanza) apre la stessa corsia mentre la prima e'
    /// ancora iscritta: condividono lo stesso processo e gli stessi frame.
    #[test]
    fn due_finestre_condividono_la_stessa_chat_e_la_chiusura_di_una_non_ferma_l_altra() {
        let manager = RpcManager::new();
        let session = sessione_di_prova("main", "chat-1", true);
        let hub = session.hub.clone();
        let (mac, mac_received) = channel_di_prova();
        hub.attach(
            Box::new(ChannelSink::new(mac, session.stats.clone())),
            Some("main".into()),
            Resume::Fresh,
        )
        .unwrap();
        hub.publish("ready", r#"{"type":"ready"}"#.into());
        manager.sessions.lock().insert(7, session);

        let (windows, windows_received) = channel_di_prova();
        assert_eq!(
            adopt_orphan(&manager, &chiave("main", None), &windows, "link:pc:main"),
            Some(Ok(7))
        );
        hub.publish("message_end", r#"{"type":"message_end"}"#.into());
        assert_eq!(mac_received.lock().len(), 2);
        assert_eq!(windows_received.lock().len(), 2);

        // Il PC chiude la scheda: il Mac continua a lavorare sulla stessa chat.
        assert!(matches!(
            manager.close_for(7, "link:pc:main", false),
            CloseOutcome::Detached
        ));
        hub.publish("agent_end", r#"{"type":"agent_end"}"#.into());
        assert_eq!(mac_received.lock().len(), 3);
        assert_eq!(windows_received.lock().len(), 2);
        assert!(manager.sessions.lock().contains_key(&7));

        // L'ultima finestra che chiude chiude anche il processo.
        assert!(matches!(
            manager.close_for(7, "main", false),
            CloseOutcome::Closing(_)
        ));
        assert!(!manager.sessions.lock().contains_key(&7));
    }

    /// «Nuova chat» da una finestra: l'altra riceve il nuovo id e poi il
    /// `ready` della sessione che sostituisce quella chiusa (F16).
    #[test]
    fn la_nuova_chat_di_una_finestra_porta_con_se_l_altra() {
        let manager = RpcManager::new();
        let old = sessione_di_prova("main", "chat-1", true);
        let old_hub = old.hub.clone();
        let (mac, mac_received) = channel_di_prova();
        let (windows, _) = channel_di_prova();
        old_hub
            .attach(Box::new(ChannelSink::new(mac, old.stats.clone())), Some("main".into()), Resume::Fresh)
            .unwrap();
        old_hub
            .attach(
                Box::new(ChannelSink::new(windows, old.stats.clone())),
                Some("link:pc:main".into()),
                Resume::Fresh,
            )
            .unwrap();
        let identity = SessionIdentity::of(&old);
        manager.sessions.lock().insert(7, old);

        assert!(matches!(
            manager.close_for(7, "link:pc:main", true),
            CloseOutcome::Closing(_)
        ));
        let new_hub = SessionHub::new();
        manager.hand_over_followers(&identity, 8, &new_hub);
        new_hub.publish("ready", r#"{"type":"ready","new":true}"#.into());

        let frames = mac_received.lock().clone();
        assert_eq!(
            frames,
            vec![
                r#"{"rpcId":8,"type":"studio_rebind"}"#.to_string(),
                r#"{"type":"ready","new":true}"#.to_string()
            ]
        );
    }
    /// Ricarica della finestra: la sessione che lavorava viene ripresa con lo
    /// stesso processo invece di avviarne un secondo sullo stesso progetto.
    #[test]
    fn la_finestra_ricaricata_ritrova_la_sessione_in_corso() {
        let manager = RpcManager::new();
        let session = sessione_di_prova("main", "chat-1", true);
        let hub = session.hub.clone();
        let (before_reload, _) = channel_di_prova();
        hub.attach(
            Box::new(ChannelSink::new(before_reload, session.stats.clone())),
            Some("main".into()),
            Resume::Fresh,
        )
        .unwrap();
        hub.publish("ready", r#"{"type":"ready"}"#.into());
        hub.publish("message_update", r#"{"type":"message_update"}"#.into());
        manager.sessions.lock().insert(7, session);

        let (after_reload, received) = channel_di_prova();
        // Finche' la finestra di prima e' iscritta la sessione non e' orfana.
        assert!(adopt_orphan(
            &manager,
            &chiave("main", Some("chat-1")),
            &after_reload,
            "main"
        )
        .is_none());

        manager.detach_window("main");
        let adopted = adopt_orphan(
            &manager,
            &chiave("main", Some("chat-1")),
            &after_reload,
            "main",
        );
        assert_eq!(adopted, Some(Ok(7)));
        // Riparte dall'handshake e si insedia chiedendo lo stato a omp.
        assert_eq!(
            received.lock().clone(),
            vec![r#"{"type":"ready"}"#.to_string()]
        );
        hub.publish("message_end", r#"{"type":"message_end"}"#.into());
        assert_eq!(received.lock().len(), 2);

        // Una seconda apertura non puo' prendersi la stessa sessione.
        let (other, _) = channel_di_prova();
        assert!(adopt_orphan(&manager, &chiave("main", Some("chat-1")), &other, "main").is_none());
    }

    #[test]
    fn una_sessione_orfana_si_riprende_solo_con_la_stessa_identita() {
        let manager = RpcManager::new();
        manager
            .sessions
            .lock()
            .insert(1, sessione_di_prova("feature", "chat-1", true));
        manager
            .sessions
            .lock()
            .insert(2, sessione_di_prova("auto-run", "chat-2", false));
        let (channel, received) = channel_di_prova();

        assert!(adopt_orphan(&manager, &chiave("main", None), &channel, "main").is_none());
        assert!(adopt_orphan(
            &manager,
            &chiave("feature", Some("chat-9")),
            &channel,
            "main"
        )
        .is_none());
        assert!(adopt_orphan(&manager, &chiave("auto-run", None), &channel, "main").is_none());
        assert!(received.lock().is_empty());
        assert_eq!(
            adopt_orphan(&manager, &chiave("feature", None), &channel, "main"),
            Some(Ok(1))
        );
    }

    #[test]
    fn le_sessioni_che_nessuno_riprende_vengono_chiuse_dopo_la_tolleranza() {
        let sessions = Mutex::new(HashMap::new());
        let orphan = sessione_di_prova("main", "chat-1", true);
        let attached = sessione_di_prova("feature", "chat-2", true);
        let (channel, _) = channel_di_prova();
        attached
            .hub
            .attach(
                Box::new(ChannelSink::new(channel, attached.stats.clone())),
                Some("main".into()),
                Resume::Fresh,
            )
            .unwrap();
        sessions.lock().insert(1, orphan);
        sessions.lock().insert(2, attached);

        assert!(take_expired_orphans(&sessions, Instant::now()).is_empty());
        let later = Instant::now() + hub::ORPHAN_GRACE + Duration::from_secs(1);
        let expired: Vec<u64> = take_expired_orphans(&sessions, later)
            .into_iter()
            .map(|(id, _)| id)
            .collect();
        assert_eq!(expired, vec![1]);
        assert!(sessions.lock().contains_key(&2));
    }

    /// omp che esce da solo (stdout chiuso): la sessione lascia la mappa e il
    /// suo overlay temporaneo non resta in %TEMP%.
    #[test]
    fn uscita_spontanea_di_omp_cancella_la_config_temporanea() {
        let config = std::env::temp_dir().join(format!(
            "omp-studio-gui-overlay-uscita-{}.yml",
            std::process::id()
        ));
        std::fs::write(&config, "tools:\n  approvalMode: yolo\n").unwrap();

        // Un processo qualsiasi che scrive una riga ed esce fa da omp.
        let mut child = Command::new("git")
            .arg("--version")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .expect("git disponibile nei test");
        let stdout = child.stdout.take().unwrap();
        let stdin = Arc::new(Mutex::new(child.stdin.take()));
        let child = Arc::new(Mutex::new(child));
        let stderr_tail = Arc::new(Mutex::new(VecDeque::new()));
        let protocol = Arc::new(AtomicU8::new(1));
        let abort_signal = Arc::new(AtomicBool::new(false));
        let session_id = Arc::new(Mutex::new(None));
        let stats = Arc::new(RpcStats::default());
        let hub = Arc::new(SessionHub::new());
        let sessions = Arc::new(Mutex::new(HashMap::new()));
        sessions.lock().insert(
            77,
            RpcSession {
                child: child.clone(),
                stdin: stdin.clone(),
                stderr_tail: stderr_tail.clone(),
                protocol: protocol.clone(),
                abort_signal: abort_signal.clone(),
                config_path: Some(config.clone()),
                pool_path: None,
                pid: None,
                #[cfg(target_os = "windows")]
                job: None,
                killed: Arc::new(AtomicBool::new(false)),
                scope: "main".to_string(),
                prototype_id: None,
                session_id: session_id.clone(),
                cwd: ".".to_string(),
                execution_id: None,
                project_id: None,
                stats: stats.clone(),
                hub: hub.clone(),
                lane_id: None,
                adoptable: true,
            },
        );

        reader_loop(ReaderLoopArgs {
            stdout,
            hub,
            stdin,
            protocol,
            child: child.clone(),
            stderr_tail,
            sessions: sessions.clone(),
            rpc_id: 77,
            abort_signal,
            session_id,
            stats,
        });
        assert!(sessions.lock().is_empty());
        assert!(!config.exists(), "overlay temporaneo rimasto su disco");
        let _ = child.lock().wait();
    }

    #[test]
    fn overlay_gui_applica_yolo_e_limite_senza_disattivare_la_sintesi() {
        #[derive(Deserialize)]
        struct Overlay {
            tools: OverlayTools,
            ask: OverlayAsk,
            read: OverlayRead,
            prewalk: OverlayPrewalk,
        }

        #[derive(Deserialize)]
        struct OverlayAsk {
            timeout: u64,
        }

        #[derive(Deserialize)]
        struct OverlayTools {
            #[serde(rename = "approvalMode")]
            approval_mode: String,
            #[serde(rename = "intentTracing")]
            intent_tracing: bool,
        }

        #[derive(Deserialize)]
        struct OverlayRead {
            #[serde(rename = "defaultLimit")]
            default_limit: usize,
            summarize: Option<serde_yaml::Value>,
        }

        #[derive(Deserialize)]
        struct OverlayPrewalk {
            enabled: bool,
        }

        let rpc_id = 99001;
        let overlay_path = write_gui_overlay(rpc_id).expect("overlay GUI generabile");
        let content = std::fs::read_to_string(&overlay_path).expect("overlay GUI leggibile");
        let overlay: Overlay = serde_yaml::from_str(&content).expect("overlay GUI YAML valido");

        assert_eq!(overlay.tools.approval_mode, "yolo");
        // omp 19.0 spegne gli intenti in RPC se l'impostazione manca.
        assert!(overlay.tools.intent_tracing);
        assert_eq!(overlay.ask.timeout, 0);
        assert_eq!(overlay.read.default_limit, 1200);
        assert!(overlay.read.summarize.is_none());
        assert!(!overlay.prewalk.enabled);

        let _ = std::fs::remove_file(overlay_path);
    }

    #[test]
    fn overlay_gui_abilita_la_continuazione_dei_goal_in_rpc() {
        #[derive(Deserialize)]
        struct OverlayGoalOnly {
            goal: OverlayGoal,
        }
        #[derive(Deserialize)]
        struct OverlayGoal {
            #[serde(rename = "continuationModes")]
            continuation_modes: Vec<String>,
        }
        #[derive(Deserialize)]
        struct OverlayAskTimeout {
            ask: OverlayAskField,
        }
        #[derive(Deserialize)]
        struct OverlayAskField {
            timeout: u64,
        }

        let rpc_id = 99006;
        let overlay_path = write_gui_overlay(rpc_id).expect("overlay GUI generato");
        for enabled in [true, false] {
            set_gui_overlay_prewalk(&overlay_path, enabled, &PrewalkTargets::default())
                .expect("riscrittura overlay riuscita");
            let content = std::fs::read_to_string(&overlay_path).expect("overlay leggibile");
            let parsed: OverlayGoalOnly =
                serde_yaml::from_str(&content).expect("overlay YAML valido");
            assert_eq!(parsed.goal.continuation_modes, vec!["interactive", "rpc"]);
            let ask: OverlayAskTimeout =
                serde_yaml::from_str(&content).expect("overlay YAML valido");
            assert_eq!(ask.ask.timeout, 0);
        }
        let _ = std::fs::remove_file(overlay_path);
    }

    #[test]
    fn overlay_gui_isolamento_per_sessione() {
        #[derive(Deserialize)]
        struct OverlayPrewalkOnly {
            prewalk: OverlayPrewalk,
        }
        #[derive(Deserialize)]
        struct OverlayPrewalk {
            enabled: bool,
        }

        let rpc_1 = 99002;
        let rpc_2 = 99003;
        let path_1 = write_gui_overlay(rpc_1).expect("overlay 1 generato");
        let path_2 = write_gui_overlay(rpc_2).expect("overlay 2 generato");

        assert_ne!(path_1, path_2);

        // Modifica prewalk solo sulla prima sessione
        set_gui_overlay_prewalk(&path_1, true, &PrewalkTargets::default())
            .expect("modifica prewalk riuscita");

        let content_1 = std::fs::read_to_string(&path_1).expect("overlay 1 leggibile");
        let content_2 = std::fs::read_to_string(&path_2).expect("overlay 2 leggibile");

        let parsed_1: OverlayPrewalkOnly =
            serde_yaml::from_str(&content_1).expect("overlay 1 YAML valido");
        let parsed_2: OverlayPrewalkOnly =
            serde_yaml::from_str(&content_2).expect("overlay 2 YAML valido");

        assert!(parsed_1.prewalk.enabled);
        assert!(!parsed_2.prewalk.enabled);

        let _ = std::fs::remove_file(path_1);
        let _ = std::fs::remove_file(path_2);
    }

    #[test]
    fn overlay_gui_prewalk_attiva_disattiva_mantiene_base() {
        #[derive(Deserialize)]
        struct OverlayFull {
            tools: OverlayTools,
            read: OverlayRead,
            prewalk: OverlayPrewalk,
        }
        #[derive(Deserialize)]
        struct OverlayTools {
            #[serde(rename = "approvalMode")]
            approval_mode: String,
        }
        #[derive(Deserialize)]
        struct OverlayRead {
            #[serde(rename = "defaultLimit")]
            default_limit: usize,
            summarize: Option<serde_yaml::Value>,
        }
        #[derive(Deserialize)]
        struct OverlayPrewalk {
            enabled: bool,
        }

        let rpc_id = 99004;
        let overlay_path = write_gui_overlay(rpc_id).expect("overlay GUI generato");

        // 1. Attiva prewalk: verifica che i parametri base rimangano inalterati
        set_gui_overlay_prewalk(&overlay_path, true, &PrewalkTargets::default())
            .expect("abilitazione prewalk riuscita");
        let content_enabled =
            std::fs::read_to_string(&overlay_path).expect("overlay abilitato leggibile");
        let overlay_enabled: OverlayFull =
            serde_yaml::from_str(&content_enabled).expect("overlay abilitato YAML valido");
        assert_eq!(overlay_enabled.tools.approval_mode, "yolo");
        assert_eq!(overlay_enabled.read.default_limit, 1200);
        assert!(overlay_enabled.read.summarize.is_none());
        assert!(overlay_enabled.prewalk.enabled);

        // 2. Disattiva prewalk: verifica che i parametri base rimangano inalterati
        set_gui_overlay_prewalk(&overlay_path, false, &PrewalkTargets::default())
            .expect("disabilitazione prewalk riuscita");
        let content_disabled =
            std::fs::read_to_string(&overlay_path).expect("overlay disabilitato leggibile");
        let overlay_disabled: OverlayFull =
            serde_yaml::from_str(&content_disabled).expect("overlay disabilitato YAML valido");
        assert_eq!(overlay_disabled.tools.approval_mode, "yolo");
        assert_eq!(overlay_disabled.read.default_limit, 1200);
        assert!(overlay_disabled.read.summarize.is_none());
        assert!(!overlay_disabled.prewalk.enabled);

        let _ = std::fs::remove_file(overlay_path);
    }

    #[test]
    fn overlay_gui_rifiuta_configurazione_laboratorio() {
        let lab_path = std::env::temp_dir().join("omp-studio-lab-99005-prototype.yml");
        let result = set_gui_overlay_prewalk(&lab_path, true, &PrewalkTargets::default());
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(
            err.to_lowercase().contains("laboratorio") || err.to_lowercase().contains("lab"),
            "Atteso errore sulla configurazione Laboratorio, ottenuto: {}",
            err
        );
    }

    #[test]
    fn overlay_gui_prewalk_porta_destinazione_e_ripartenza_della_sessione() {
        #[derive(Deserialize)]
        struct OverlayPrewalkOnly {
            prewalk: OverlayPrewalk,
        }
        #[derive(Deserialize)]
        struct OverlayPrewalk {
            enabled: bool,
            into: Option<String>,
            from: Option<String>,
        }

        let overlay_path = write_gui_overlay(99007).expect("overlay GUI generato");
        let targets = PrewalkTargets {
            into: Some(" @smol ".into()),
            from: Some("openai-codex/gpt-6.1-sol:high".into()),
        };
        set_gui_overlay_prewalk(&overlay_path, true, &targets).expect("armo con destinazione");
        let content = std::fs::read_to_string(&overlay_path).expect("overlay leggibile");
        let parsed: OverlayPrewalkOnly =
            serde_yaml::from_str(&content).expect("overlay YAML valido");
        assert!(parsed.prewalk.enabled);
        assert_eq!(parsed.prewalk.into.as_deref(), Some("@smol"));
        assert_eq!(
            parsed.prewalk.from.as_deref(),
            Some("openai-codex/gpt-6.1-sol:high")
        );

        // Senza scelta di sessione le chiavi spariscono: torna a valere config.yml.
        let blank = PrewalkTargets {
            into: Some("  ".into()),
            from: None,
        };
        set_gui_overlay_prewalk(&overlay_path, false, &blank).expect("disarmo");
        let content = std::fs::read_to_string(&overlay_path).expect("overlay leggibile");
        let parsed: OverlayPrewalkOnly =
            serde_yaml::from_str(&content).expect("overlay YAML valido");
        assert!(!parsed.prewalk.enabled);
        assert!(parsed.prewalk.into.is_none());
        assert!(parsed.prewalk.from.is_none());

        let _ = std::fs::remove_file(overlay_path);
    }

    #[test]
    fn direttiva_round_trip_copre_tutti_gli_invarianti_obbligatori() {
        let prompt = crate::pty::STUDIO_SYSTEM_PROMPT;
        assert!(prompt.contains(
            "Batch every already-identifiable independent read, grep, glob, and LSP call"
        ));
        assert!(prompt.contains("search the entire workspace for the most distinctive exact literal before opening files"));
        assert!(prompt.contains("read only matching files and targeted line ranges"));
        assert!(prompt.contains("Handle a single-file or single-concern task directly"));
        assert!(prompt.contains("never delegate mere reading or file localization"));
        assert!(prompt.contains("at least two substantial independent workstreams"));
        assert!(prompt
            .contains("dispatch them together and continue useful direct work instead of polling"));
        assert!(prompt.contains("Perform one targeted verification after the final edit"));
        assert!(prompt.contains(
            "extract the most distinctive visible text and run one literal workspace search"
        ));
        assert!(prompt.contains("Never promise provider parallelism; use correct serial execution when parallel tool calls are unavailable"));
    }

    #[test]
    fn costruzione_argomenti_resume_o_continue() {
        let run = |resume: Option<&str>, cont: bool, exists: bool| {
            let mut args = Vec::new();
            apply_resume_or_continue(&mut args, resume, cont, |_| exists);
            args
        };

        // 1. Sessione esistente con transcript: applica solo --resume <id>
        assert_eq!(
            run(Some("s-123"), false, true),
            vec!["--resume".to_string(), "s-123".to_string()]
        );
        assert_eq!(
            run(Some("s-123"), true, true),
            vec!["--resume".to_string(), "s-123".to_string()]
        );

        // 2. Sessione specificata ma transcript inesistente: se continue_last=true usa --continue
        assert_eq!(
            run(Some("s-ghost"), true, false),
            vec!["--continue".to_string()]
        );
        assert_eq!(run(Some("s-ghost"), false, false), Vec::<String>::new());

        // 3. Nessuna sessione indicata: con continue_last=true usa --continue
        assert_eq!(run(None, true, true), vec!["--continue".to_string()]);
        assert_eq!(run(None, false, true), Vec::<String>::new());
    }

    #[test]
    fn rimozione_traccia_shell_da_tool_execution_update() {
        // Frame con traccia shell cumulativa in partialResult.details.trace
        let raw_with_trace = r#"{"type":"tool_execution_update","toolCallId":"call_bash_1","toolName":"bash","args":{"command":"cargo build"},"partialResult":{"content":[{"type":"text","text":"Compilazione in corso...\n"}],"details":{"timeoutSeconds":300,"wallTimeMs":1542.5,"trace":{"v":1,"seq":88,"status":"running","rootVpid":1234,"t_ns":1794219436000000,"script":"cargo build","units":[{"id":"u1","cmd":"cargo build","state":"running"}],"history":["h1","h2","h3"]}}}}"#;

        let stripped = strip_shell_trace(raw_with_trace)
            .expect("il frame con trace deve essere ripulito e riserializzato");

        let val: serde_json::Value = serde_json::from_str(&stripped)
            .expect("il frame ripulito deve essere JSON valido");

        // `trace` e' stato rimosso da `details`
        assert!(val["partialResult"]["details"].get("trace").is_none());

        // Gli altri campi di `details` sono intatti
        assert_eq!(val["partialResult"]["details"]["timeoutSeconds"], 300);
        assert_eq!(val["partialResult"]["details"]["wallTimeMs"], 1542.5);

        // Gli altri campi del frame e di partialResult sono intatti
        assert_eq!(val["type"], "tool_execution_update");
        assert_eq!(val["toolCallId"], "call_bash_1");
        assert_eq!(val["toolName"], "bash");
        assert_eq!(val["args"]["command"], "cargo build");
        assert_eq!(
            val["partialResult"]["content"][0]["text"],
            "Compilazione in corso...\n"
        );

        // Frame senza `trace`: deve essere ignorato (None) cosi' da restare byte per byte identico
        let raw_without_trace = r#"{"type":"tool_execution_update","toolCallId":"call_bash_1","toolName":"bash","args":{"command":"cargo build"},"partialResult":{"content":[{"type":"text","text":"Compilazione in corso...\n"}],"details":{"timeoutSeconds":300,"wallTimeMs":1542.5}}}"#;
        assert_eq!(strip_shell_trace(raw_without_trace), None);
    }

    #[test]
    fn rimozione_traccia_shell_altre_forme_e_invarianza_testo() {
        // Frame `tool_execution_end` con `result.details.trace`
        let raw_end = r#"{"type":"tool_execution_end","toolCallId":"call_bash_1","toolName":"bash","result":{"content":[{"type":"text","text":"Fatto\n"}],"details":{"exitCode":0,"wallTimeMs":2000.0,"trace":{"v":1,"seq":120}}}}"#;
        let stripped_end = strip_shell_trace(raw_end).expect("trace deve essere rimosso da tool_execution_end");
        let val_end: serde_json::Value = serde_json::from_str(&stripped_end).unwrap();
        assert!(val_end["result"]["details"].get("trace").is_none());
        assert_eq!(val_end["result"]["details"]["exitCode"], 0);
        assert_eq!(val_end["result"]["details"]["wallTimeMs"], 2000.0);

        // Messaggio toolResult con `message.details.trace`
        let raw_msg = r#"{"type":"message","message":{"role":"toolResult","toolCallId":"call_bash_1","toolName":"bash","content":[{"type":"text","text":"OK"}],"details":{"timeoutSeconds":300,"trace":{"v":1}}}}"#;
        let stripped_msg = strip_shell_trace(raw_msg).expect("trace deve essere rimosso da message.details");
        let val_msg: serde_json::Value = serde_json::from_str(&stripped_msg).unwrap();
        assert!(val_msg["message"]["details"].get("trace").is_none());
        assert_eq!(val_msg["message"]["details"]["timeoutSeconds"], 300);

        // Frame in cui compare la stringa '"trace"' nel testo o negli argomenti, ma non come chiave in details:
        // non deve essere riserializzato, garantendo identita' byte per byte.
        let raw_text_mention = r#"{"type":"tool_execution_update","toolCallId":"call_bash_1","toolName":"bash","args":{"command":"grep \"trace\" log.txt"},"partialResult":{"content":[{"type":"text","text":"stack \"trace\" line 42"}],"details":{"timeoutSeconds":300}}}"#;
        assert_eq!(strip_shell_trace(raw_text_mention), None);
    }
    #[test]
    fn cambiare_conversazione_da_una_finestra_notifica_anche_le_altre_e_non_ripropone_domande_vecchie() {
        for command in ["new_session", "fork", "branch"] {
            let hub = SessionHub::new();
            let stats = Arc::new(RpcStats::default());
            let (first, first_log) = channel_di_prova();
            let (second, second_log) = channel_di_prova();
            hub.attach(Box::new(ChannelSink::new(first, stats.clone())), Some("main".into()), Resume::Fresh).unwrap();
            hub.attach(Box::new(ChannelSink::new(second, stats.clone())), Some("other".into()), Resume::Fresh).unwrap();
            hub.publish("extension_ui_request", r#"{"type":"extension_ui_request","method":"input","id":"old-question"}"#.into());
            dispatch(&serde_json::json!({
                "type": "response", "id": "first-1", "command": command, "success": true, "data": {},
            }).to_string(), &hub, &Arc::new(Mutex::new(None)), &Arc::new(AtomicU8::new(2)),
                &mut None, &Arc::new(Mutex::new(None)));
            assert_eq!(*first_log.lock(), *second_log.lock());
            let event: serde_json::Value = serde_json::from_str(first_log.lock().last().unwrap()).unwrap();
            assert_eq!(event["type"], "studio_session_changed");
            assert_eq!(event["requestId"], "first-1");
            let (late, late_log) = channel_di_prova();
            hub.attach(Box::new(ChannelSink::new(late, stats)), Some("late".into()), Resume::Fresh).unwrap();
            assert!(late_log.lock().is_empty(), "la domanda apparteneva alla conversazione precedente");
        }
    }

    #[test]
    fn una_diramazione_rifiutata_o_annullata_non_cancella_la_conversazione_delle_altre_finestre() {
        for (success, data) in [(false, serde_json::Value::Null), (true, serde_json::json!({ "cancelled": true }))] {
            let hub = SessionHub::new();
            let stats = Arc::new(RpcStats::default());
            hub.publish("extension_ui_request", r#"{"type":"extension_ui_request","method":"input","id":"keep-question"}"#.into());
            dispatch(&serde_json::json!({
                "type": "response", "id": "first-1", "command": "fork", "success": success, "data": data,
            }).to_string(), &hub, &Arc::new(Mutex::new(None)), &Arc::new(AtomicU8::new(2)),
                &mut None, &Arc::new(Mutex::new(None)));
            let (late, log) = channel_di_prova();
            hub.attach(Box::new(ChannelSink::new(late, stats)), Some("late".into()), Resume::Fresh).unwrap();
            let event: serde_json::Value = serde_json::from_str(&log.lock()[0]).unwrap();
            assert_eq!(event["id"], "keep-question");
        }
    }

}
