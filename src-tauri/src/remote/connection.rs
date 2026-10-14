//! Gestione della connessione WebSocket verso il relay, battito e riconnessione.
//!
//! Rispetta i requisiti di Gate R44:
//! - Una sola connessione attiva alla volta;
//! - Autorizzazione tramite `Authorization: Bearer <credential>`;
//! - Negoziazione con `hello` e `welcome`;
//! - Watchdog d'inattivita' a 70 s;
//! - Invio dell'istantanea di stato (`snapshot`) coalescente con `seq` riavviato a 1 per connessione;
//! - Coda limitata (64) per i risultati dei comandi (`command_result`);
//! - Backoff progressivo con jitter (1, 2, 5, 10, 30, 60 s + fino al 20% di jitter).

use std::collections::VecDeque;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use futures_util::{SinkExt, StreamExt};
use parking_lot::Mutex;
use tauri::{AppHandle, Emitter};
use tokio::sync::{watch, Notify};
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::http::HeaderValue;
use tokio_tungstenite::tungstenite::protocol::frame::coding::CloseCode as WsCloseCode;
use tokio_tungstenite::tungstenite::protocol::CloseFrame;
use tokio_tungstenite::tungstenite::Message;

use crate::remote::config::{validate_and_normalize_relay_url, RemoteConfig};
use crate::remote::protocol::{
    close_code, current_platform, CommandError, HealthResponse, HostFrame, HostInfo, ProtocolId,
    RelayProtocolRange, RelayToHostFrame, RemoteCommandEvent, RemoteConnection, RemoteStatus,
    UpdateNeeded, FEATURES, HEARTBEAT_TIMEOUT_MS, PROTOCOL_NAME, PROTOCOL_VERSION,
};

/// Tabella dei ritardi base di backoff (in secondi).
pub const BACKOFF_SCHEDULE_SECS: &[u64] = &[1, 2, 5, 10, 30, 60];

/// Calcola il ritardo base di backoff in secondi per un determinato tentativo.
pub fn backoff_base_secs(attempt: usize) -> u64 {
    if attempt < BACKOFF_SCHEDULE_SECS.len() {
        BACKOFF_SCHEDULE_SECS[attempt]
    } else {
        60
    }
}

/// Generatore pseudo-casuale deterministico e leggero per la quota di jitter (0.0 ..= 1.0).
pub fn pseudo_random_fraction() -> f64 {
    static SEED: AtomicU64 = AtomicU64::new(0);
    let mut state = SEED.fetch_add(0x9E3779B97F4A7C15, Ordering::Relaxed);
    if state == 0 {
        state = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_nanos() as u64)
            .unwrap_or(123456789);
    }
    state ^= state << 13;
    state ^= state >> 7;
    state ^= state << 17;
    (state as f64) / (u64::MAX as f64)
}

/// Calcola il ritardo in millisecondi per un tentativo dato con una specifica frazione di jitter (0.0 ..= 0.20).
pub fn backoff_delay_ms_with_jitter(attempt: usize, jitter_fraction: f64) -> u64 {
    let base_secs = backoff_base_secs(attempt);
    let base_ms = base_secs * 1000;
    let clamped_jitter = jitter_fraction.clamp(0.0, 0.20);
    let jitter_ms = (base_ms as f64 * clamped_jitter).round() as u64;
    base_ms + jitter_ms
}

/// Calcola il ritardo effettivo in millisecondi applicando un jitter fino al 20%.
pub fn compute_backoff_delay_ms(attempt: usize) -> u64 {
    let jitter_frac = pseudo_random_fraction() * 0.20;
    backoff_delay_ms_with_jitter(attempt, jitter_frac)
}

/// Azione risultante dalla chiusura o caduta della connessione.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum CloseOutcome {
    Revoked(String),
    Incompatible(String),
    WaitReplaced(u64),
    Backoff(String),
}

/// Mappa il codice di chiusura ricevuto nell'azione appropriata.
pub fn map_close_code(code: Option<u16>, reason: Option<&str>) -> CloseOutcome {
    match code {
        Some(close_code::UNAUTHORIZED) | Some(close_code::REVOKED) => CloseOutcome::Revoked(
            reason
                .unwrap_or("Macchina o credenziale revocata dal relay")
                .to_string(),
        ),
        Some(close_code::INCOMPATIBLE) => CloseOutcome::Incompatible(
            reason
                .unwrap_or("Versione del protocollo non compatibile con il relay")
                .to_string(),
        ),
        Some(close_code::REPLACED) => CloseOutcome::WaitReplaced(60_000),
        Some(other) => {
            let msg = reason.unwrap_or(match other {
                close_code::PROTOCOL_ERROR => "Errore di protocollo",
                1000 => "Chiusura normale",
                _ => "Connessione chiusa dal relay",
            });
            CloseOutcome::Backoff(format!("{msg} (codice {other})"))
        }
        None => CloseOutcome::Backoff(reason.unwrap_or("Connessione interrotta").to_string()),
    }
}

/// Elemento per la coda dei risultati dei comandi.
#[derive(Clone, Debug)]
pub struct PendingCommandResult {
    pub command_id: String,
    pub ok: bool,
    pub error: Option<CommandError>,
}

/// Hook di test per catturare gli eventi in memoria senza WebView.
pub type CommandHook = Arc<dyn Fn(RemoteCommandEvent) + Send + Sync>;
pub type StatusHook = Arc<dyn Fn(RemoteStatus) + Send + Sync>;

/// Stato condiviso del gestore della connessione.
pub struct ConnectionContext {
    pub app: Option<AppHandle>,
    pub status: Mutex<RemoteStatus>,
    pub config: Mutex<RemoteConfig>,
    pub latest_state: Mutex<Option<serde_json::Value>>,
    pub command_results: Mutex<VecDeque<PendingCommandResult>>,
    pub snapshot_notify: Arc<Notify>,
    pub command_result_notify: Arc<Notify>,
    pub reconnect_notify: Arc<Notify>,
    pub shutdown_sender: Mutex<Option<watch::Sender<bool>>>,
    pub abort_handle: Mutex<Option<tokio::task::AbortHandle>>,
    pub session_id: AtomicU64,
    pub operation_epoch: AtomicU64,
    pub command_hook: Mutex<Option<CommandHook>>,
    pub status_hook: Mutex<Option<StatusHook>>,
    pub http_client: reqwest::Client,
}

impl ConnectionContext {
    pub fn new(app: Option<AppHandle>, config: RemoteConfig) -> Arc<Self> {
        let paired = config.credential.is_some() && config.relay_url.is_some();
        let connection = if !config.enabled {
            RemoteConnection::Disabled
        } else if !paired {
            RemoteConnection::Unpaired
        } else {
            RemoteConnection::Connecting
        };

        let initial_status = RemoteStatus {
            enabled: config.enabled,
            relay_url: config.relay_url.clone(),
            machine_name: config.machine_name.clone(),
            host_id: config.host_id.clone(),
            paired,
            connection,
            last_error: None,
            retry_at: None,
            clients: Vec::new(),
            relay_version: None,
            relay_protocol: None,
            update_needed: None,
        };

        Arc::new(Self {
            app,
            status: Mutex::new(initial_status),
            config: Mutex::new(config),
            latest_state: Mutex::new(None),
            command_results: Mutex::new(VecDeque::with_capacity(64)),
            snapshot_notify: Arc::new(Notify::new()),
            command_result_notify: Arc::new(Notify::new()),
            reconnect_notify: Arc::new(Notify::new()),
            shutdown_sender: Mutex::new(None),
            abort_handle: Mutex::new(None),
            session_id: AtomicU64::new(0),
            operation_epoch: AtomicU64::new(0),
            command_hook: Mutex::new(None),
            status_hook: Mutex::new(None),
            http_client: reqwest::Client::builder()
                .timeout(Duration::from_secs(10))
                .build()
                .unwrap_or_default(),
        })
    }

    /// Verifica se la sessione indicata corrisponde a quella attualmente attiva.
    pub fn is_session_current(&self, session_id: u64) -> bool {
        self.session_id.load(Ordering::SeqCst) == session_id
    }

    /// Incrementa e restituisce la nuova epoca operativa per invalidare richieste concorrenti.
    pub fn next_epoch(&self) -> u64 {
        self.operation_epoch.fetch_add(1, Ordering::SeqCst) + 1
    }

    /// Restituisce l'epoca operativa corrente.
    pub fn current_epoch(&self) -> u64 {
        self.operation_epoch.load(Ordering::SeqCst)
    }

    /// Aggiorna lo stato ed emette `remote://status` verso la finestra principale.
    pub fn emit_status_update(&self) {
        let current = self.status.lock().clone();
        if let Some(app) = &self.app {
            let _ = app.emit_to("main", "remote://status", &current);
        }
        if let Some(hook) = self.status_hook.lock().as_ref() {
            hook(current);
        }
    }

    /// Emette un comando remoto verso la finestra principale.
    pub fn emit_command_event(&self, event: RemoteCommandEvent) {
        if let Some(app) = &self.app {
            let _ = app.emit_to("main", "remote://command", &event);
        }
        if let Some(hook) = self.command_hook.lock().as_ref() {
            hook(event);
        }
    }

    /// Accoda il risultato di un comando nella coda limitata a 64 elementi.
    /// Se non si e' connessi, il risultato viene scartato perche' il relay e' gia' andato in timeout.
    pub fn queue_command_result(&self, command_id: String, ok: bool, error: Option<CommandError>) {
        let is_connected = self.status.lock().connection == RemoteConnection::Connected;
        if !is_connected {
            // Drop immediato: il relay ha gia' chiuso la finestra del comando
            return;
        }

        let mut queue = self.command_results.lock();
        if queue.len() >= 64 {
            if let Some(dropped) = queue.pop_front() {
                eprintln!(
                    "[remote] Coda risultati piena (64): scartato risultato per comando {}",
                    dropped.command_id
                );
            }
        }
        queue.push_back(PendingCommandResult {
            command_id,
            ok,
            error,
        });
        drop(queue);
        self.command_result_notify.notify_one();
    }
}

/// Interrompe la connessione in corso, abortisce il task ed incrementa l'identificatore di sessione.
pub fn stop_connection_task(ctx: &ConnectionContext) {
    ctx.session_id.fetch_add(1, Ordering::SeqCst);
    if let Some(sender) = ctx.shutdown_sender.lock().take() {
        let _ = sender.send(true);
    }
    if let Some(abort) = ctx.abort_handle.lock().take() {
        abort.abort();
    }
}

/// Avvia il loop asincrono di connessione (un solo task alla volta).
pub fn start_connection_task(ctx: Arc<ConnectionContext>) -> tauri::async_runtime::JoinHandle<()> {
    // Interrompiamo ed abortiamo qualsiasi sessione o task precedente
    stop_connection_task(&ctx);

    let session_id = ctx.session_id.fetch_add(1, Ordering::SeqCst) + 1;
    let (shutdown_tx, shutdown_rx) = watch::channel(false);
    *ctx.shutdown_sender.lock() = Some(shutdown_tx);

    let ctx_clone = ctx.clone();
    let handle = tauri::async_runtime::spawn(async move {
        connection_loop(ctx_clone, shutdown_rx, session_id).await;
    });
    *ctx.abort_handle.lock() = Some(handle.inner().abort_handle());
    handle
}

/// Loop principale di gestione della connessione con tentativi e backoff.
async fn connection_loop(
    ctx: Arc<ConnectionContext>,
    mut shutdown_rx: watch::Receiver<bool>,
    session_id: u64,
) {
    let mut attempt = 0usize;

    loop {
        if !ctx.is_session_current(session_id) || *shutdown_rx.borrow() {
            break;
        }

        // Verifica se abilitato e configurato
        let (enabled, relay_url_opt, credential_opt, machine_name) = {
            let cfg = ctx.config.lock();
            (
                cfg.enabled,
                cfg.relay_url.clone(),
                cfg.credential.clone(),
                cfg.machine_name.clone(),
            )
        };

        if !enabled {
            if ctx.is_session_current(session_id) {
                let mut st = ctx.status.lock();
                st.connection = RemoteConnection::Disabled;
                st.retry_at = None;
                st.clients.clear();
                drop(st);
                ctx.emit_status_update();
            }
            break;
        }

        let (relay_url, credential) = match (relay_url_opt, credential_opt) {
            (Some(url), Some(cred)) => (url, cred),
            _ => {
                if ctx.is_session_current(session_id) {
                    let mut st = ctx.status.lock();
                    st.connection = RemoteConnection::Unpaired;
                    st.paired = false;
                    st.retry_at = None;
                    st.clients.clear();
                    drop(st);
                    ctx.emit_status_update();
                }
                break;
            }
        };

        let normalized = match validate_and_normalize_relay_url(&relay_url) {
            Ok(n) => n,
            Err(e) => {
                if ctx.is_session_current(session_id) {
                    let mut st = ctx.status.lock();
                    st.connection = RemoteConnection::Waiting;
                    st.last_error = Some(e);
                    st.retry_at = None;
                    drop(st);
                    ctx.emit_status_update();
                }
                break;
            }
        };

        // Segnala stato di connessione in corso
        if ctx.is_session_current(session_id) {
            let mut st = ctx.status.lock();
            st.connection = RemoteConnection::Connecting;
            st.paired = true;
            st.relay_url = Some(normalized.http_url.clone());
            st.machine_name = machine_name.clone();
            st.retry_at = None;
            drop(st);
            ctx.emit_status_update();
        }

        // Tentativo di connessione WebSocket
        let session_result = run_single_session(
            &ctx,
            &normalized.ws_url,
            &credential,
            &machine_name,
            &mut shutdown_rx,
            session_id,
        )
        .await;

        // Se lo shutdown e' stato richiesto o la sessione e' superata, esci pulito
        if *shutdown_rx.borrow() || !ctx.is_session_current(session_id) {
            break;
        }

        // Valuta l'esito della sessione
        match session_result {
            Ok(()) => {
                // Uscita normale pulita
                break;
            }
            Err(outcome) => match outcome {
                CloseOutcome::Revoked(reason) => {
                    if ctx.is_session_current(session_id) {
                        let mut st = ctx.status.lock();
                        st.connection = RemoteConnection::Revoked;
                        st.last_error = Some(reason);
                        st.retry_at = None;
                        st.clients.clear();
                        drop(st);
                        ctx.emit_status_update();
                    }
                    // Nessun ritentativo: la credenziale e' revocata
                    break;
                }
                CloseOutcome::Incompatible(reason) => {
                    if ctx.is_session_current(session_id) {
                        let mut st = ctx.status.lock();
                        st.connection = RemoteConnection::Incompatible;
                        st.last_error = Some(reason);
                        st.retry_at = None;
                        st.clients.clear();
                        drop(st);
                        ctx.emit_status_update();
                    }

                    // Interroga /healthz per sapere chi aggiornare
                    check_relay_health_incompatible(&ctx, &normalized.http_url, session_id).await;
                    // Nessun ritentativo fino a nuovo aggiornamento/avvio
                    break;
                }
                CloseOutcome::WaitReplaced(delay_ms) => {
                    let now_ms = SystemTime::now()
                        .duration_since(UNIX_EPOCH)
                        .map(|d| d.as_millis() as i64)
                        .unwrap_or(0);
                    let retry_at = now_ms + delay_ms as i64;
                    if ctx.is_session_current(session_id) {
                        let mut st = ctx.status.lock();
                        st.connection = RemoteConnection::Waiting;
                        st.last_error =
                            Some("Sessione sostituita da un'altra connessione".to_string());
                        st.retry_at = Some(retry_at);
                        st.clients.clear();
                        drop(st);
                        ctx.emit_status_update();
                    }

                    tokio::select! {
                        biased;
                        _ = shutdown_rx.changed() => break,
                        _ = ctx.reconnect_notify.notified() => {},
                        _ = tokio::time::sleep(Duration::from_millis(delay_ms)) => {},
                    }
                    attempt = 0;
                }
                CloseOutcome::Backoff(err_msg) => {
                    let delay_ms = compute_backoff_delay_ms(attempt);
                    let now_ms = SystemTime::now()
                        .duration_since(UNIX_EPOCH)
                        .map(|d| d.as_millis() as i64)
                        .unwrap_or(0);
                    let retry_at = now_ms + delay_ms as i64;
                    if ctx.is_session_current(session_id) {
                        let mut st = ctx.status.lock();
                        st.connection = RemoteConnection::Waiting;
                        st.last_error = Some(err_msg);
                        st.retry_at = Some(retry_at);
                        st.clients.clear();
                        drop(st);
                        ctx.emit_status_update();
                    }

                    tokio::select! {
                        biased;
                        _ = shutdown_rx.changed() => break,
                        _ = ctx.reconnect_notify.notified() => {},
                        _ = tokio::time::sleep(Duration::from_millis(delay_ms)) => {},
                    }
                    attempt = attempt.saturating_add(1);
                }
            },
        }
    }
}

/// Esegue una singola sessione WebSocket dall'handshake fino alla chiusura.
pub(crate) async fn run_single_session(
    ctx: &ConnectionContext,
    ws_url: &str,
    credential: &str,
    machine_name: &str,
    shutdown_rx: &mut watch::Receiver<bool>,
    session_id: u64,
) -> Result<(), CloseOutcome> {
    if *shutdown_rx.borrow() || !ctx.is_session_current(session_id) {
        return Ok(());
    }

    let mut request = match ws_url.into_client_request() {
        Ok(r) => r,
        Err(e) => {
            return Err(CloseOutcome::Backoff(format!(
                "URL WebSocket non valido: {e}"
            )))
        }
    };

    let auth_header = match HeaderValue::from_str(&format!("Bearer {credential}")) {
        Ok(h) => h,
        Err(e) => {
            return Err(CloseOutcome::Backoff(format!(
                "Intestazione autorizzazione non valida: {e}"
            )))
        }
    };
    request.headers_mut().insert("Authorization", auth_header);

    // Connessione con timeout di 15 secondi, in gara con la cancellazione
    let connect_future = tokio_tungstenite::connect_async(request);
    let (ws_stream, _response) = tokio::select! {
        biased;
        _ = shutdown_rx.changed() => {
            return Ok(());
        }
        connect_res = tokio::time::timeout(Duration::from_secs(15), connect_future) => {
            match connect_res {
                Ok(Ok(pair)) => pair,
                Ok(Err(tokio_tungstenite::tungstenite::Error::Http(resp))) => {
                    let status = resp.status();
                    if status == tokio_tungstenite::tungstenite::http::StatusCode::UNAUTHORIZED
                        || status == tokio_tungstenite::tungstenite::http::StatusCode::FORBIDDEN
                    {
                        return Err(CloseOutcome::Revoked(format!(
                            "Handshake rifiutato con codice HTTP {status}: credenziale revocata o non autorizzata"
                        )));
                    }
                    if status == tokio_tungstenite::tungstenite::http::StatusCode::UPGRADE_REQUIRED {
                        return Err(CloseOutcome::Incompatible(
                            "Handshake rifiutato con codice HTTP 426 (Upgrade Required): protocollo incompatibile".to_string()
                        ));
                    }
                    return Err(CloseOutcome::Backoff(format!(
                        "Handshake HTTP rifiutato con stato {status}"
                    )));
                }
                Ok(Err(e)) => {
                    return Err(CloseOutcome::Backoff(format!(
                        "Impossibile collegarsi al relay: {e}"
                    )));
                }
                Err(_) => {
                    return Err(CloseOutcome::Backoff(
                        "Timeout durante la connessione al relay".to_string(),
                    ));
                }
            }
        }
    };

    if *shutdown_rx.borrow() || !ctx.is_session_current(session_id) {
        return Ok(());
    }

    let (mut write_half, mut read_half) = ws_stream.split();

    // Invio immediato del frame `hello`, in gara con la cancellazione
    let hello_frame = HostFrame::Hello {
        protocol: ProtocolId {
            name: PROTOCOL_NAME.to_string(),
            version: PROTOCOL_VERSION,
        },
        features: FEATURES.iter().map(|s| s.to_string()).collect(),
        host: HostInfo {
            name: machine_name.to_string(),
            platform: current_platform().to_string(),
            app_version: env!("CARGO_PKG_VERSION").to_string(),
        },
    };

    let hello_json = serde_json::to_string(&hello_frame)
        .map_err(|e| CloseOutcome::Backoff(format!("Serializzazione frame hello fallita: {e}")))?;

    tokio::select! {
        biased;
        _ = shutdown_rx.changed() => {
            return Ok(());
        }
        send_res = write_half.send(Message::Text(hello_json.into())) => {
            if let Err(e) = send_res {
                return Err(CloseOutcome::Backoff(format!(
                    "Invio frame hello fallito: {e}"
                )));
            }
        }
    }

    // Attesa del primo frame: deve essere `welcome` entro 5 s, in gara con la cancellazione
    let welcome_timeout = Duration::from_millis(crate::remote::protocol::HELLO_TIMEOUT_MS);
    let welcome_msg = tokio::select! {
        biased;
        _ = shutdown_rx.changed() => {
            return Ok(());
        }
        welcome_res = tokio::time::timeout(welcome_timeout, read_half.next()) => {
            match welcome_res {
                Ok(Some(Ok(msg))) => msg,
                Ok(Some(Err(e))) => {
                    return Err(CloseOutcome::Backoff(format!(
                        "Errore durante l'attesa del benvenuto: {e}"
                    )));
                }
                Ok(None) => {
                    return Err(CloseOutcome::Backoff(
                        "Connessione chiusa prima del frame di benvenuto".to_string(),
                    ));
                }
                Err(_) => {
                    return Err(CloseOutcome::Backoff(
                        "Timeout in attesa del benvenuto dal relay".to_string(),
                    ));
                }
            }
        }
    };

    let welcome_frame = match welcome_msg {
        Message::Text(text) => match serde_json::from_str::<RelayToHostFrame>(&text) {
            Ok(RelayToHostFrame::Welcome {
                protocol: _,
                relay,
                features: _,
                heartbeat_ms: _,
                clients,
            }) => (relay, clients),
            Ok(other) => {
                return Err(CloseOutcome::Backoff(format!(
                    "Frame iniziale inatteso: {:?}",
                    other
                )));
            }
            Err(e) => {
                return Err(CloseOutcome::Backoff(format!(
                    "Parsing frame benvenuto fallito: {e}"
                )));
            }
        },
        Message::Close(cf) => {
            let code = cf.as_ref().map(|c| c.code.into());
            let reason = cf.as_ref().map(|c| c.reason.as_ref());
            return Err(map_close_code(code, reason));
        }
        _ => {
            return Err(CloseOutcome::Backoff(
                "Messaggio iniziale non di testo ricevuto dal relay".to_string(),
            ));
        }
    };

    // Se l'utente ha disabilitato durante l'attesa del benvenuto, non aggiorniamo lo stato
    if !ctx.is_session_current(session_id) || *shutdown_rx.borrow() {
        return Ok(());
    }

    // Benvenuto ricevuto con successo: stato connesso
    {
        let mut st = ctx.status.lock();
        st.connection = RemoteConnection::Connected;
        st.clients = welcome_frame.1;
        st.relay_version = Some(welcome_frame.0.version);
        st.relay_protocol = Some(RelayProtocolRange {
            min: welcome_frame.0.protocol.min,
            max: welcome_frame.0.protocol.max,
        });
        st.update_needed = None;
        st.last_error = None;
        st.retry_at = None;
    }
    ctx.emit_status_update();

    // `seq` riparte da 1 per ogni connessione
    let mut seq = 1u64;

    // Se esiste gia' uno stato della macchina, lo inviamo subito dopo il benvenuto
    let initial_snapshot = ctx.latest_state.lock().clone();
    if let Some(state) = initial_snapshot {
        if !ctx.is_session_current(session_id) || *shutdown_rx.borrow() {
            return Ok(());
        }
        let snapshot_frame = HostFrame::Snapshot { seq, state };
        seq += 1;
        if let Ok(json) = serde_json::to_string(&snapshot_frame) {
            tokio::select! {
                biased;
                _ = shutdown_rx.changed() => {
                    return Ok(());
                }
                send_res = write_half.send(Message::Text(json.into())) => {
                    let _ = send_res;
                }
            }
        }
    }

    // Loop della sessione attiva con watchdog d'inattivita' a 70 s persistente.
    // Il timer viene resettato SOLO alla ricezione di frame in ingresso, in modo che
    // un traffico unidirezionale in uscita non mascheri la caduta del collegamento.
    let heartbeat_dur = Duration::from_millis(HEARTBEAT_TIMEOUT_MS);
    let watchdog = tokio::time::sleep(heartbeat_dur);
    tokio::pin!(watchdog);

    loop {
        if !ctx.is_session_current(session_id) {
            return Ok(());
        }

        tokio::select! {
            biased;

            // Segnale di chiusura/arresto
            _ = shutdown_rx.changed() => {
                if *shutdown_rx.borrow() {
                    let _ = write_half.send(Message::Close(Some(CloseFrame {
                        code: WsCloseCode::Normal,
                        reason: "".into(),
                    }))).await;
                    return Ok(());
                }
            }

            // Richiesta esplicita di riconnessione (es. cambio nome macchina)
            _ = ctx.reconnect_notify.notified() => {
                let _ = write_half.send(Message::Close(Some(CloseFrame {
                    code: WsCloseCode::Normal,
                    reason: "".into(),
                }))).await;
                return Err(CloseOutcome::Backoff("Riconnessione richiesta".to_string()));
            }

            // Watchdog d'inattivita': scade se nessun frame viene ricevuto per 70 s
            () = &mut watchdog => {
                return Err(CloseOutcome::Backoff(
                    "Nessun battito dal relay per 70 s (heartbeat timeout)".to_string(),
                ));
            }

            // Frame in arrivo dal relay
            msg_res = read_half.next() => {
                match msg_res {
                    None => {
                        return Err(CloseOutcome::Backoff("Flusso WebSocket terminato dal relay".to_string()));
                    }
                    Some(Err(e)) => {
                        return Err(CloseOutcome::Backoff(format!("Errore WebSocket in lettura: {e}")));
                    }
                    Some(Ok(msg)) => {
                        // Reset del watchdog SOLO alla ricezione di frame in ingresso
                        watchdog.as_mut().reset(tokio::time::Instant::now() + heartbeat_dur);

                        if !ctx.is_session_current(session_id) || *shutdown_rx.borrow() {
                            return Ok(());
                        }

                        match msg {
                            Message::Text(text) => {
                                match serde_json::from_str::<RelayToHostFrame>(&text) {
                                    Ok(RelayToHostFrame::Ping { seq: ping_seq, .. }) => {
                                        let pong = HostFrame::Pong { seq: ping_seq };
                                        if let Ok(pong_json) = serde_json::to_string(&pong) {
                                            let _ = write_half.send(Message::Text(pong_json.into())).await;
                                        }
                                    }
                                    Ok(RelayToHostFrame::Clients { clients }) => {
                                        if ctx.is_session_current(session_id) {
                                            ctx.status.lock().clients = clients;
                                            ctx.emit_status_update();
                                        }
                                    }
                                    Ok(RelayToHostFrame::Command { command_id, device, command }) => {
                                        if ctx.is_session_current(session_id) {
                                            let event = RemoteCommandEvent { command_id, device, command };
                                            ctx.emit_command_event(event);
                                        }
                                    }
                                    Ok(RelayToHostFrame::Welcome { relay, clients, .. }) => {
                                        if ctx.is_session_current(session_id) {
                                            let mut st = ctx.status.lock();
                                            st.clients = clients;
                                            st.relay_version = Some(relay.version);
                                            st.relay_protocol = Some(RelayProtocolRange {
                                                min: relay.protocol.min,
                                                max: relay.protocol.max,
                                            });
                                            drop(st);
                                            ctx.emit_status_update();
                                        }
                                    }
                                    Err(err) => {
                                        eprintln!("[remote] Frame relay non riconosciuto: {err}");
                                    }
                                }
                            }
                            Message::Close(cf) => {
                                let code = cf.as_ref().map(|c| c.code.into());
                                let reason = cf.as_ref().map(|c| c.reason.as_ref());
                                return Err(map_close_code(code, reason));
                            }
                            Message::Ping(payload) => {
                                let _ = write_half.send(Message::Pong(payload)).await;
                            }
                            Message::Pong(_) => {}
                            Message::Binary(_) => {}
                            Message::Frame(_) => {}
                        }
                    }
                }
            }

            // Notifica di nuovo stato macchina disponibile (coalescenza ultimo stato)
            _ = ctx.snapshot_notify.notified() => {
                let latest = ctx.latest_state.lock().clone();
                if let Some(state) = latest {
                    let snapshot_frame = HostFrame::Snapshot { seq, state };
                    seq += 1;
                    if let Ok(json) = serde_json::to_string(&snapshot_frame) {
                        let _ = write_half.send(Message::Text(json.into())).await;
                    }
                }
            }

            // Notifica di risultati di comandi da inviare
            _ = ctx.command_result_notify.notified() => {
                let pending_items: Vec<PendingCommandResult> = {
                    let mut queue = ctx.command_results.lock();
                    queue.drain(..).collect()
                };
                for pending in pending_items {
                    let frame = HostFrame::CommandResult {
                        command_id: pending.command_id,
                        ok: pending.ok,
                        error: pending.error,
                    };
                    if let Ok(json) = serde_json::to_string(&frame) {
                        let _ = write_half.send(Message::Text(json.into())).await;
                    }
                }
            }
        }
    }
}

/// Chiamata HTTP GET a `{relayUrl}/healthz` dopo una chiusura 4426 incompatibile.
async fn check_relay_health_incompatible(
    ctx: &ConnectionContext,
    relay_http_url: &str,
    session_id: u64,
) {
    let healthz_url = format!("{}/healthz", relay_http_url.trim_end_matches('/'));
    let resp = ctx
        .http_client
        .get(&healthz_url)
        .timeout(Duration::from_secs(5))
        .send()
        .await;

    if !ctx.is_session_current(session_id) {
        return;
    }

    if let Ok(res) = resp {
        if res.status().is_success() {
            if let Ok(health) = res.json::<HealthResponse>().await {
                if !ctx.is_session_current(session_id) {
                    return;
                }
                let mut st = ctx.status.lock();
                st.relay_version = Some(health.version);
                st.relay_protocol = Some(RelayProtocolRange {
                    min: health.protocol.min,
                    max: health.protocol.max,
                });
                if PROTOCOL_VERSION > health.protocol.max {
                    st.update_needed = Some(UpdateNeeded::Relay);
                } else if PROTOCOL_VERSION < health.protocol.min {
                    st.update_needed = Some(UpdateNeeded::Studio);
                } else {
                    st.update_needed = None;
                }
                drop(st);
                ctx.emit_status_update();
            }
        }
    }
}
